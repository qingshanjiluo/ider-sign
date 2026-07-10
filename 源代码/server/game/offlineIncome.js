const ops = require('./playerOps');
const { ensureInventoryStructure } = require('./inventoryUtils');
const { getItemById } = require('./dataLoader');
const db = require('../dbAsync');

const MATERIAL_TYPES = new Set(['material', 'herb', 'medicine']);
const OFFLINE_CAP_SECONDS = 24 * 3600;
const ONLINE_CHUNK_SECONDS = 5 * 60;
const OFFLINE_GRANT_PER_CHUNK_SECONDS = 2 * 3600;
// 单次结算最多认定 N 分钟在线，防止“离线期间”被误算为在线导致一次爆满
const ONLINE_ELAPSED_CAP_SECONDS = 15 * 60;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function _grantOfflineBankByOnlineTime(st, now) {
  if (!st || typeof st !== 'object') return;
  const n = Math.floor(Number(now) || nowSec());
  const lastCreditAt = Math.floor(Number(st.last_online_credit_at) || 0);
  if (lastCreditAt <= 0) {
    st.last_online_credit_at = n;
    return;
  }
  let onlineElapsed = Math.max(0, n - lastCreditAt);
  onlineElapsed = Math.min(onlineElapsed, ONLINE_ELAPSED_CAP_SECONDS);
  const chunks = Math.floor(onlineElapsed / ONLINE_CHUNK_SECONDS);
  if (chunks <= 0) return;
  const gain = chunks * OFFLINE_GRANT_PER_CHUNK_SECONDS;
  const oldBank = Math.max(0, Math.floor(Number(st.offline_bank_seconds) || 0));
  st.offline_bank_seconds = Math.min(OFFLINE_CAP_SECONDS, oldBank + gain);
  // 无论是否到达上限，在线时长都要消费掉，避免上限后堆积“隐形余额”
  st.last_online_credit_at = lastCreditAt + chunks * ONLINE_CHUNK_SECONDS;
}

function ensureState(player) {
  if (!player || typeof player !== 'object') return null;
  if (!player.offline_income || typeof player.offline_income !== 'object' || Array.isArray(player.offline_income)) {
    player.offline_income = {};
  }
  const st = player.offline_income;
  if (!Number.isFinite(Number(st.last_settle_at)) || Number(st.last_settle_at) <= 0) {
    st.last_settle_at = nowSec();
  }
  if (!Number.isFinite(Number(st.active_until)) || Number(st.active_until) <= 0) {
    st.active_until = st.last_settle_at + OFFLINE_CAP_SECONDS;
  }
  if (!Number.isFinite(Number(st.avg_exp_per_min)) || Number(st.avg_exp_per_min) < 0) {
    st.avg_exp_per_min = 0;
  }
  if (!Number.isFinite(Number(st.avg_spirit_per_min)) || Number(st.avg_spirit_per_min) < 0) {
    st.avg_spirit_per_min = 0;
  }
  if (!Number.isFinite(Number(st.sample_wins)) || Number(st.sample_wins) < 0) {
    st.sample_wins = 0;
  }
  if (!Number.isFinite(Number(st.sample_battles)) || Number(st.sample_battles) < 0) {
    st.sample_battles = 0;
  }
  if (!Number.isFinite(Number(st.offline_bank_seconds)) || Number(st.offline_bank_seconds) < 0) {
    st.offline_bank_seconds = 0;
  }
  if (!Number.isFinite(Number(st.last_online_credit_at)) || Number(st.last_online_credit_at) <= 0) {
    st.last_online_credit_at = nowSec();
  }
  if (!Number.isFinite(Number(st.last_activity_at)) || Number(st.last_activity_at) <= 0) {
    st.last_activity_at = Number(st.last_settle_at) || nowSec();
  }
  if (!Number.isFinite(Number(st.material_total_win_seconds)) || Number(st.material_total_win_seconds) < 0) {
    st.material_total_win_seconds = 0;
  }
  if (!st.material_totals || typeof st.material_totals !== 'object' || Array.isArray(st.material_totals)) {
    st.material_totals = {};
  }
  return st;
}

function settleOfflineIncome(player, now = nowSec(), accountId = null) {
  const st = ensureState(player);
  if (!st) return { changed: false, reward: { exp: 0, spirit_stones: 0, minutes: 0, materials: [] } };

  const last = Math.floor(Number(st.last_settle_at) || now);
  const activeUntil = Math.floor(Number(st.active_until) || 0);
  const effectiveNow = activeUntil > 0 ? Math.min(now, activeUntil) : now;
  const elapsedByTime = Math.max(0, effectiveNow - last);
  const bank = Math.max(0, Math.floor(Number(st.offline_bank_seconds) || 0));
  let elapsed = Math.min(elapsedByTime, bank, OFFLINE_CAP_SECONDS);
  if (elapsed < 60 || bank < 60) {
    return { changed: false, reward: { exp: 0, spirit_stones: 0, minutes: 0, materials: [] } };
  }

  // 只按整分钟结算，避免碎片秒数导致频繁小额写入
  const minutes = Math.floor(elapsed / 60);
  const settleSec = minutes * 60;
  if (minutes <= 0) {
    return { changed: false, reward: { exp: 0, spirit_stones: 0, minutes: 0, materials: [] } };
  }

  // 离线收益改为“在线真实战斗胜利样本驱动 + 真实胜率”：
  // 若玩家一直失败或未产生胜利样本，则离线收益为 0，避免空挂吃收益。
  // 胜率 = 胜场/总场次，用于折扣离线收益，反映实际战斗表现。
  const totalBattles = Math.floor(Number(st.sample_battles) || 0);
  const totalWins = Math.max(0, Math.floor(Number(st.sample_wins) || 0));
  const winRate = totalBattles > 0 ? Math.min(1, totalWins / totalBattles) : 0;
  const expPerSec = (Math.max(0, Number(st.avg_exp_per_min) || 0) / 60.0) * winRate;
  const spiritPerSec = (Math.max(0, Number(st.avg_spirit_per_min) || 0) / 60.0) * winRate;
  const buffs = player.timed_buffs && typeof player.timed_buffs === 'object' ? player.timed_buffs : {};
  const expBuff = buffs.exp_gain_pct && typeof buffs.exp_gain_pct === 'object' ? buffs.exp_gain_pct : null;
  const spiritBuff = buffs.spirit_gain_pct && typeof buffs.spirit_gain_pct === 'object' ? buffs.spirit_gain_pct : null;
  const expBuffPct = expBuff ? Math.max(0, Number(expBuff.value) || 0) : 0;
  const spiritBuffPct = spiritBuff ? Math.max(0, Number(spiritBuff.value) || 0) : 0;
  const expBuffUntil = expBuff ? Math.floor(Number(expBuff.expires_at) || 0) : 0;
  const spiritBuffUntil = spiritBuff ? Math.floor(Number(spiritBuff.expires_at) || 0) : 0;
  const expBoostedSec = expBuffUntil > last ? Math.max(0, Math.min(effectiveNow, expBuffUntil) - last) : 0;
  const spiritBoostedSec = spiritBuffUntil > last ? Math.max(0, Math.min(effectiveNow, spiritBuffUntil) - last) : 0;
  let addExp = Math.floor(expPerSec * settleSec + expPerSec * expBuffPct * Math.min(expBoostedSec, settleSec));
  const enlightenmentMult = typeof ops.getEnlightenmentExpMult === 'function' ? ops.getEnlightenmentExpMult(player) : 1;
  addExp = Math.floor(addExp * enlightenmentMult);
  const addSpirit = Math.floor(spiritPerSec * settleSec + spiritPerSec * spiritBuffPct * Math.min(spiritBoostedSec, settleSec));
  const materials = [];
  const totalWinSec = Math.max(0, Number(st.material_total_win_seconds) || 0);
  const matTotals = st.material_totals && typeof st.material_totals === 'object' ? st.material_totals : {};
  player.inventory = ensureInventoryStructure(player.inventory || []);
  if (totalWinSec > 0 && winRate > 0) {
    for (const idKey of Object.keys(matTotals)) {
      const itemId = Math.max(0, Math.floor(Number(idKey) || 0));
      const totalCount = Math.max(0, Number(matTotals[idKey]) || 0);
      if (itemId <= 0 || totalCount <= 0) continue;
      const expected = (totalCount / totalWinSec) * settleSec * winRate;
      let grant = Math.floor(expected);
      const frac = expected - grant;
      if (frac > 0 && Math.random() < frac) grant += 1;
      if (grant <= 0) continue;
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) continue;
      const itemCopy = structuredClone(item);
      const added = ops.putItemInInventory(player.inventory || [], itemCopy, grant);
      if (added) {
        materials.push({
          item_id: itemId,
          item_name: String(item.name || '未知物品'),
          count: grant
        });
      } else if (accountId && typeof db.createMailboxMessage === 'function') {
        Promise.resolve(db.createMailboxMessage(accountId, {
          type: 'offline_material',
          title: '离线材料',
          content: `离线期间获得材料，背包已满，已投递邮件：${String(item.name || '未知物品')} x${grant}`,
          attachments: [{ kind: 'item', item: itemCopy, count: grant }]
        })).catch((e) => {
          console.error('[offline-income] 邮件投递失败 accountId=%s itemId=%s count=%s:', accountId, itemId, grant, e?.message || e);
        });
        materials.push({
          item_id: itemId,
          item_name: String(item.name || '未知物品'),
          count: grant,
          mailed: true
        });
      }
    }
  }

  player.exp = Math.floor((Number(player.exp) || 0) + addExp);
  player.spirit_stones = Math.floor((Number(player.spirit_stones) || 0) + addSpirit);
  st.last_settle_at = last + settleSec;
  st.offline_bank_seconds = Math.max(0, bank - settleSec);
  player.offline_income = st;
  return {
    changed: true,
    reward: { exp: addExp, spirit_stones: addSpirit, minutes, materials }
  };
}

function touchOfflineIncomeAnchor(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return false;
  const n = Math.floor(Number(now) || nowSec());
  _grantOfflineBankByOnlineTime(st, n);
  st.last_settle_at = n;
  st.last_activity_at = n;
  st.active_until = n + OFFLINE_CAP_SECONDS;
  player.offline_income = st;
  return true;
}

function activateOfflineWindow(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return false;
  const n = Math.floor(Number(now) || nowSec());
  st.last_settle_at = n;
  st.last_activity_at = n;
  st.active_until = n + OFFLINE_CAP_SECONDS;
  st.last_online_credit_at = n;
  st.offline_bank_seconds = 0;
  player.offline_income = st;
  return true;
}

function recordBattleForOffline(player, rewardExp, rewardSpiritStones, durationSec, victory, expBuffPct = 0, spiritBuffPct = 0, drops = []) {
  const st = ensureState(player);
  if (!st) return false;
  // 每场战斗都计入总场次，用于真实胜率计算
  st.sample_battles = Math.floor(Number(st.sample_battles) || 0) + 1;
  if (!victory) {
    player.offline_income = st;
    return true;
  }
  const dur = Math.max(1, Math.floor(Number(durationSec) || 1));
  const winsBefore = Math.floor(Number(st.sample_wins) || 0);
  st.sample_wins = winsBefore + 1;
  st.material_total_win_seconds = Math.max(0, Number(st.material_total_win_seconds) || 0) + dur;

  const matTotals = st.material_totals && typeof st.material_totals === 'object' ? st.material_totals : {};
  for (const d of (Array.isArray(drops) ? drops : [])) {
    const itemId = Math.max(0, Math.floor(Number(d?.item_id) || 0));
    const count = Math.max(0, Math.floor(Number(d?.count) || 0));
    if (itemId <= 0 || count <= 0) continue;
    const item = getItemById(itemId);
    if (!item || Object.keys(item).length <= 0) continue;
    const itemType = String(item.type || '');
    if (!MATERIAL_TYPES.has(itemType)) continue;
    matTotals[String(itemId)] = Math.max(0, Number(matTotals[String(itemId)]) || 0) + count;
  }
  st.material_totals = matTotals;

  const expMul = Math.max(1, 1 + Math.max(0, Number(expBuffPct) || 0));
  const spiritMul = Math.max(1, 1 + Math.max(0, Number(spiritBuffPct) || 0));
  // 样本记录使用“去BUFF基线收益”，离线结算阶段再按BUFF有效时段加成，避免无限白嫖
  const expGain = Math.max(0, Number(rewardExp) || 0) / expMul;
  const spiritGain = Math.max(0, Number(rewardSpiritStones) || 0) / spiritMul;
  if (expGain <= 0 && spiritGain <= 0) {
    player.offline_income = st;
    return true;
  }
  const expPerMinNow = (expGain * 60.0) / dur;
  const spiritPerMinNow = (spiritGain * 60.0) / dur;
  const alpha = 0.3; // EMA 权重，兼顾稳定与跟随
  st.avg_exp_per_min = winsBefore <= 0 ? expPerMinNow : (st.avg_exp_per_min * (1 - alpha) + expPerMinNow * alpha);
  st.avg_spirit_per_min = winsBefore <= 0 ? spiritPerMinNow : (st.avg_spirit_per_min * (1 - alpha) + spiritPerMinNow * alpha);
  player.offline_income = st;
  return true;
}

function touchPlayerActivity(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return;
  st.last_activity_at = Math.floor(Number(now) || nowSec());
  player.offline_income = st;
}

module.exports = { settleOfflineIncome, touchOfflineIncomeAnchor, activateOfflineWindow, recordBattleForOffline, touchPlayerActivity };

