/**
 * 玩家操作逻辑（与客户端 game_manager/player 一致，服务端权威）
 */
const { ensureInventoryStructure } = require('./inventoryUtils');
const { calculateExpNeeded, getGrowthForLevel } = require('./exp');
const { getItemById, getItems, getSkills, getTechniques } = require('./dataLoader');
const { recalcAndAssignCombatStats, calcAllPassiveEffects, calcSpiritRootBonuses } = require('./combatUtils');
const { sanitizeEquipmentAffixValuesByQualityTier, maximizeEquipmentForGoldenTuner } = require('./equipmentGen');
const { ensureTalentState, grantTalentPointsForLevel, unlockTalentNode, resetTalentNodes } = require('./talents');

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function ensureTimedBuffs(player) {
  if (!player || typeof player !== 'object') return {};
  if (!player.timed_buffs || typeof player.timed_buffs !== 'object' || Array.isArray(player.timed_buffs)) {
    player.timed_buffs = {};
  }
  return player.timed_buffs;
}

function cleanupTimedBuffs(player) {
  const buffs = ensureTimedBuffs(player);
  const now = nowSec();
  for (const key of Object.keys(buffs)) {
    const b = buffs[key];
    if (!b || typeof b !== 'object') {
      delete buffs[key];
      continue;
    }
    const expiresAt = Math.floor(Number(b.expires_at) || 0);
    const rounds = Math.floor(Number(b.remaining_rounds) || 0);
    const hasRoundLimit = Boolean(b.has_round_limit);
    const tier = _classifyTimedBuffTier(key, Number(b.value) || 0);
    const ignoreRoundLimit = tier === 'taixu';
    if ((expiresAt > 0 && expiresAt <= now) || (!ignoreRoundLimit && hasRoundLimit && rounds <= 0)) {
      delete buffs[key];
    }
  }
  return buffs;
}

function getTimedBuffValue(player, buffKey) {
  if (!buffKey) return 0;
  const buffs = cleanupTimedBuffs(player);
  const b = buffs[String(buffKey)];
  if (!b || typeof b !== 'object') return 0;
  const v = Number(b.value) || 0;
  return Number.isFinite(v) ? v : 0;
}

/**
 * 消耗异常收益追缴债务：优先抵扣本次获得的经验/灵石，防止一次性回档导致等级错乱。
 * 返回值为本次实际可发放收益。
 */
function consumeAbnormalGainRepay(player, gains = {}) {
  if (!player || typeof player !== 'object') {
    return {
      exp: Math.max(0, intVal(gains?.exp, 0)),
      spirit_stones: Math.max(0, intVal(gains?.spirit_stones, 0)),
      repaid_exp: 0,
      repaid_spirit_stones: 0,
      debt_exp_left: 0,
      debt_spirit_left: 0
    };
  }

  let expGain = Math.max(0, intVal(gains?.exp, 0));
  let spiritGain = Math.max(0, intVal(gains?.spirit_stones, 0));

  let debtExp = Math.max(0, intVal(player.abnormal_gain_repay_exp, 0));
  let debtSpirit = Math.max(0, intVal(player.abnormal_gain_repay_spirit, 0));

  let repaidExp = 0;
  let repaidSpirit = 0;

  if (debtExp > 0 && expGain > 0) {
    repaidExp = Math.min(debtExp, expGain);
    debtExp -= repaidExp;
    expGain -= repaidExp;
  }

  if (debtSpirit > 0 && spiritGain > 0) {
    repaidSpirit = Math.min(debtSpirit, spiritGain);
    debtSpirit -= repaidSpirit;
    spiritGain -= repaidSpirit;
  }

  if (debtExp > 0) player.abnormal_gain_repay_exp = debtExp;
  else delete player.abnormal_gain_repay_exp;

  if (debtSpirit > 0) player.abnormal_gain_repay_spirit = debtSpirit;
  else delete player.abnormal_gain_repay_spirit;

  return {
    exp: expGain,
    spirit_stones: spiritGain,
    repaid_exp: repaidExp,
    repaid_spirit_stones: repaidSpirit,
    debt_exp_left: debtExp,
    debt_spirit_left: debtSpirit
  };
}

/** 清除过期的仙盟 buff（灵池祝福、顿悟经验） */
function cleanupAllianceBuffs(player) {
  if (!player || typeof player !== 'object') return;
  const now = nowSec();
  if (player.spirit_pool_buff && typeof player.spirit_pool_buff === 'object') {
    const exp = Math.floor(Number(player.spirit_pool_buff.expires_at) || 0);
    if (exp > 0 && exp <= now) player.spirit_pool_buff = null;
  }
  if (Number(player.enlightenment_buff_expires_at || 0) > 0 && Number(player.enlightenment_buff_expires_at) <= now) {
    player.enlightenment_buff_expires_at = 0;
    player.enlightenment_buff_pct = 0;
  }
}

/** 顿悟经验加成乘数（独立乘区），1.0 或 1 + pct/100 */
function getEnlightenmentExpMult(player) {
  if (!player) return 1;
  const exp = Math.floor(Number(player.enlightenment_buff_expires_at) || 0);
  if (exp <= 0 || exp <= nowSec()) return 1;
  const pct = Number(player.enlightenment_buff_pct) || 0;
  return 1 + pct / 100;
}

/**
 * 太虚/普通丹药的并存规则：
 * - 同档位同值可叠加时长（例如太虚悟道丹+太虚悟道丹）。
 * - 普通与太虚互斥，不叠加时长（后吃覆盖前者并按新丹时长重置）。
 */
const _EXCLUSIVE_TIMED_BUFF_RULES = {
  'exp_gain_pct': { taixuValues: new Set([64]) },
  'drop_rate_pct': { taixuValues: new Set([30]) }
};

function _classifyTimedBuffTier(buffKey, value) {
  const rule = _EXCLUSIVE_TIMED_BUFF_RULES[String(buffKey || '')];
  if (!rule) return 'generic';
  const v = Number(value) || 0;
  if (!Number.isFinite(v) || v <= 0) return 'invalid';
  if (rule.taixuValues.has(v)) return 'taixu';
  if (v > 0 && v < 1) return 'normal';
  return 'other';
}

function sanitizeExpBuffOnLogin(player) {
  // 注意：不再按“单颗最大时长”截断，避免合法叠加被误砍，且避免离线登录时被重置出额外时长。
  const buffs = cleanupTimedBuffs(player);
  let cleaned = false;
  for (const key of Object.keys(_EXCLUSIVE_TIMED_BUFF_RULES)) {
    const b = buffs[key];
    if (!b || typeof b !== 'object') continue;
    const value = Number(b.value) || 0;
    const tier = _classifyTimedBuffTier(key, value);
    const expiresAt = Math.floor(Number(b.expires_at) || 0);
    if (tier === 'invalid' || expiresAt < 0) {
      delete buffs[key];
      cleaned = true;
      continue;
    }
    if (tier === 'taixu' && (Boolean(b.has_round_limit) || Math.floor(Number(b.remaining_rounds) || 0) !== 0)) {
      // 太虚丹仅按时间到期，兼容历史脏数据里的回合限制字段。
      b.has_round_limit = false;
      b.remaining_rounds = 0;
      cleaned = true;
    }
    if (!Number.isFinite(Number(b.remaining_rounds))) {
      b.remaining_rounds = 0;
      cleaned = true;
    }
    if (typeof b.has_round_limit !== 'boolean') {
      b.has_round_limit = !!b.has_round_limit;
      cleaned = true;
    }
  }
  return cleaned;
}

function consumeTimedBuffRounds(player, roundsSpent) {
  const spent = Math.max(0, Math.floor(Number(roundsSpent) || 0));
  if (spent <= 0) {
    cleanupTimedBuffs(player);
    return;
  }
  const buffs = cleanupTimedBuffs(player);
  for (const key of Object.keys(buffs)) {
    const b = buffs[key];
    const tier = _classifyTimedBuffTier(key, Number(b?.value) || 0);
    if (tier === 'taixu') continue;
    const rounds = Math.floor(Number(b.remaining_rounds) || 0);
    if (rounds > 0) {
      b.remaining_rounds = Math.max(0, rounds - spent);
    }
  }
  cleanupTimedBuffs(player);
}

function applyTimedBuff(player, buffKey, value, durationSec, durationRounds) {
  const key = String(buffKey || '').trim();
  if (!key) return false;
  const v = Number(value) || 0;
  const addSec = Math.max(0, Math.floor(Number(durationSec) || 0));
  const addRounds = Math.max(0, Math.floor(Number(durationRounds) || 0));
  if (!Number.isFinite(v) || v <= 0 || (addSec <= 0 && addRounds <= 0)) return false;

  const buffs = cleanupTimedBuffs(player);
  const now = nowSec();
  const old = buffs[key] || {};
  const oldValue = Number(old.value) || 0;
  const oldExpiresAt = Math.floor(Number(old.expires_at) || 0);
  const oldRounds = Math.floor(Number(old.remaining_rounds) || 0);
  const oldHasRoundLimit = Boolean(old.has_round_limit);
  const sameValue = oldValue > 0 && Math.abs(oldValue - v) < 1e-9;
  const newTier = _classifyTimedBuffTier(key, v);
  const oldTier = _classifyTimedBuffTier(key, oldValue);
  const crossTierReplace = newTier !== 'generic' && oldTier !== 'invalid' && newTier !== oldTier;
  const hasRoundLimit = addRounds > 0 || (!crossTierReplace && sameValue && oldHasRoundLimit);

  if (!crossTierReplace && sameValue && oldExpiresAt > now) {
    buffs[key] = {
      value: v,
      expires_at: addSec > 0 ? oldExpiresAt + addSec : 0,
      remaining_rounds: hasRoundLimit ? (oldRounds + addRounds) : 0,
      has_round_limit: hasRoundLimit
    };
  } else {
    buffs[key] = {
      value: v,
      expires_at: addSec > 0 ? now + addSec : 0,
      remaining_rounds: hasRoundLimit ? addRounds : 0,
      has_round_limit: hasRoundLimit
    };
  }
  return true;
}

function computeGrowthForLevelUp(level) {
  return getGrowthForLevel(level);
}

/** 根据等级返回境界品质（1练气 2筑基 3结丹 4元婴 5化神 6合体），用于经验丹/治疗减半等 */
function getRealmQualityFromLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  if (lv <= 120) return 1;
  if (lv <= 160) return 2;
  if (lv <= 200) return 3;
  if (lv <= 240) return 4;
  if (lv <= 280) return 5;
  return 6;
}

const STAT_KEYS = ['strength', 'constitution', 'bone', 'agility', 'zhenyuan', 'lingli'];
const ROOT_KEYS = ['metal', 'wood', 'water', 'fire', 'earth'];
const ROOT_LABELS = { metal: '金灵根', wood: '木灵根', water: '水灵根', fire: '火灵根', earth: '土灵根' };
const ROOT_ALIASES = {
  metal: 'metal', wood: 'wood', water: 'water', fire: 'fire', earth: 'earth',
  '金': 'metal', '木': 'wood', '水': 'water', '火': 'fire', '土': 'earth',
  '金灵根': 'metal', '木灵根': 'wood', '水灵根': 'water', '火灵根': 'fire', '土灵根': 'earth'
};

function normalizeRootType(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lowered = s.toLowerCase();
  return ROOT_ALIASES[lowered] || ROOT_ALIASES[s] || '';
}

function rootLabel(rootType) {
  return ROOT_LABELS[rootType] || String(rootType || '灵根');
}

function ensureOriginalBaseAttributes(player) {
  if (!player.original_base_attributes || typeof player.original_base_attributes !== 'object') {
    player.original_base_attributes = {};
    for (const k of STAT_KEYS) player.original_base_attributes[k] = Number(player[k]) || 10;
  }
  return player.original_base_attributes;
}

function ensureSpiritRootMaps(player) {
  const base = player.base_spirit_roots && typeof player.base_spirit_roots === 'object' ? player.base_spirit_roots : {};
  const original = player.original_spirit_roots && typeof player.original_spirit_roots === 'object' ? player.original_spirit_roots : {};
  const current = player.spirit_roots && typeof player.spirit_roots === 'object' ? player.spirit_roots : {};
  const read = (obj, key) => {
    const n = Number(obj?.[key]);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };
  // 若档案中完全没有任何灵根数据，沿用历史默认值 20；否则缺失键按 0 处理，避免“0 -> 22”跳变
  let hasAnyRootData = false;
  for (const k of ROOT_KEYS) {
    if (read(base, k) != null || read(original, k) != null || read(current, k) != null) {
      hasAnyRootData = true;
      break;
    }
  }
  const missingDefault = hasAnyRootData ? 0 : 20;
  const merged = {};
  for (const k of ROOT_KEYS) {
    const v = read(base, k);
    const ov = read(original, k);
    const cv = read(current, k);
    merged[k] = v != null ? v : (ov != null ? ov : (cv != null ? cv : missingDefault));
  }
  player.base_spirit_roots = { ...merged };
  player.original_spirit_roots = { ...merged };
  player.spirit_roots = { ...merged };
  return player;
}

function readSpiritRootValue(obj, key, fallback = 20) {
  const n = Number(obj?.[key]);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function levelUp(player) {
  if (!player) return { ok: false, error: '无玩家数据' };
  ensureTalentState(player);
  const lv = Number(player.level) || 1;
  const exp = Number(player.exp) || 0;

  if (lv >= 400) return { ok: false, error: '已达到大乘大圆满' };
  if (lv === 320) return { ok: false, error: '炼虚大圆满，暂时无法突破至合体' };
  if ([120, 160, 200, 240, 280].includes(lv)) return { ok: false, error: '请先突破' };

  const expNeeded = calculateExpNeeded(lv);
  if (exp < expNeeded) return { ok: false, error: '经验不足' };

  player.exp = exp - expNeeded;
  player.level = lv + 1;
  const growth = computeGrowthForLevelUp(player.level);

  const attrs = ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli'];
  const oa = player.original_base_attributes || {};
  for (const a of attrs) {
    player[a] = (Number(player[a]) || 10) + growth;
    oa[a] = (Number(oa[a]) || 10) + growth;
  }
  player.original_base_attributes = oa;
  grantTalentPointsForLevel(player);
  recalcAndAssignCombatStats(player);

  return { ok: true, player };
}

function applyAutoLevelUps(player, maxLevels = 1) {
  if (!player || typeof player !== 'object') return;
  const breakpoints = new Set([120, 160, 200, 240, 280]);
  let left = Math.max(0, Math.floor(Number(maxLevels) || 0));
  while (left > 0 && (Number(player.level) || 1) < 400 && !breakpoints.has(Number(player.level) || 1)) {
    const curLv = Number(player.level) || 1;
    if (curLv >= 320) break; // 炼虚大圆满暂不突破
    const lv = Number(player.level) || 1;
    const exp = Number(player.exp) || 0;
    const needed = calculateExpNeeded(lv);
    if (exp < needed) break;
    player.exp = exp - needed;
    player.level = lv + 1;
    const growth = computeGrowthForLevelUp(player.level);
    const attrs = ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli'];
    const oa = player.original_base_attributes || {};
    for (const a of attrs) {
      player[a] = (Number(player[a]) || 10) + growth;
      oa[a] = (Number(oa[a]) || 10) + growth;
    }
    player.original_base_attributes = oa;
    left -= 1;
  }
}

const BREAKTHROUGH_PENALTY = {
  120: 9,  // 练气 -> 筑基
  160: 7,  // 筑基 -> 结丹
  200: 5,  // 结丹 -> 元婴
  240: 4,  // 元婴 -> 化神
};

function recalcStatsForLevel(player) {
  const growthAttrs = ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli'];
  const oldOa = player.original_base_attributes || {};
  const preLevel = Number(player._pre_penalty_level) || 0;
  const oldLevel = preLevel > 0 ? preLevel : (Number(player.level) || 1);

  const oldLevelBase = {};
  for (const a of growthAttrs) oldLevelBase[a] = 10;
  for (let lv = 2; lv <= oldLevel; lv++) {
    const g = computeGrowthForLevelUp(lv);
    for (const a of growthAttrs) oldLevelBase[a] += g;
  }

  const pillBonus = {};
  for (const a of growthAttrs) {
    pillBonus[a] = Math.max(0, (Number(oldOa[a]) || 10) - oldLevelBase[a]);
  }

  const newLevelBase = {};
  for (const a of growthAttrs) newLevelBase[a] = 10;
  const targetLevel = Number(player.level) || 1;
  for (let lv = 2; lv <= targetLevel; lv++) {
    const g = computeGrowthForLevelUp(lv);
    for (const a of growthAttrs) newLevelBase[a] += g;
  }

  const newOa = {};
  for (const k in oldOa) newOa[k] = oldOa[k];
  for (const a of growthAttrs) {
    newOa[a] = newLevelBase[a] + pillBonus[a];
    player[a] = newOa[a];
  }
  player.original_base_attributes = newOa;
  delete player._pre_penalty_level;
}

const EQUIP_SLOTS = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
const GOLDEN_TUNER_SLOT_LABELS = {
  weapon: '武器',
  head: '头部',
  shoulder: '肩部',
  chest: '胸部',
  legs: '腿部',
  hands: '手部',
  ring: '戒指',
  amulet: '项链',
  back: '披风'
};

function parseGoldenTunerSlotType(useOptions) {
  const opts = (useOptions && typeof useOptions === 'object') ? useOptions : {};
  const raw = opts.equip_slot ?? opts.equipSlot ?? opts.slot ?? opts.slot_index ?? opts.slotIndex ?? '';
  const idx = Math.floor(Number(raw) || 0);
  if (idx < 1 || idx > EQUIP_SLOTS.length) return '';
  return EQUIP_SLOTS[idx - 1];
}

function isEquipmentType(type) {
  return EQUIP_SLOTS.includes(String(type || ''));
}

function isLockedEquipmentItem(item) {
  if (!item || typeof item !== 'object') return false;
  return isEquipmentType(item.type) && Boolean(item.locked);
}

function isItemStackable(item) {
  if (!item || typeof item !== 'object') return false;
  const t = String(item.type || '');
  if (isEquipmentType(t)) return false;
  if (t === 'array_plate' || t === 'array_rune') return false;
  if (item.no_stack === true) return false;
  return true;
}

function getItemStackDiscriminator(item) {
  if (!item || typeof item !== 'object') return '';
  return item.invite_shop_no_market ? 'invite_shop_no_market' : '';
}

function getStackableItemKey(item) {
  const itemId = Number(item?.id) || 0;
  if (itemId <= 0) return '';
  const discriminator = getItemStackDiscriminator(item);
  return discriminator ? `${itemId}#${discriminator}` : String(itemId);
}

function getRequiredLevel(item) {
  const r = Number(item.required_level) || 0;
  if (r > 0) return r;
  const q = Math.max(1, Math.min(8, Number(item.quality) || 1));
  const affixes = Array.isArray(item.affixes) ? item.affixes : [];
  const { getRequiredLevelForItem } = require('./equipmentGen');
  return getRequiredLevelForItem(q, affixes);
}

function equip(player, page, slotIndex) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const inv = player.inventory;
  if (!Array.isArray(inv) || page < 0 || page >= inv.length) return { ok: false, error: '无效背包页' };
  const row = inv[page];
  if (!Array.isArray(row) || slotIndex < 0 || slotIndex >= row.length) return { ok: false, error: '无效槽位' };

  const slotData = row[slotIndex];
  if (!slotData || !slotData.item) return { ok: false, error: '该槽位无物品' };

  const item = structuredClone(slotData.item);
  const type = String(item.type || '');
  if (!EQUIP_SLOTS.includes(type)) return { ok: false, error: '非装备类物品' };

  const lv = Number(player.level) || 1;
  const levelAllowance = Math.max(0, intVal(player?._equip_level_allowance, 0));
  const req = getRequiredLevel(item);
  if (lv + levelAllowance < req) return { ok: false, error: '境界不足' };

  const equip = player.equipment || {};
  const oldItem = equip[type];
  if (oldItem) {
    // 卸下旧装备到背包空位
    const placed = putItemInInventory(inv, oldItem, 1);
    if (!placed) return { ok: false, error: '背包已满' };
    equip[type] = null;
  }

  equip[type] = item;
  player.equipment = equip;
  // 背包中该槽可能因历史问题堆叠了装备，这里仅扣除1件，避免整格清空导致“物品消失”
  const slotCount = Math.max(1, Math.floor(Number(slotData.count) || 1));
  if (slotCount <= 1) {
    row[slotIndex] = null;
  } else {
    slotData.count = slotCount - 1;
  }
  return { ok: true, player };
}

/** 背包整理：紧凑空槽、按类型/品质/名称排序，锁定装备优先，装备类不合并，消耗品/材料同ID合并堆叠 */
function sortInventory(player) {
  if (!player || !Array.isArray(player.inventory)) return;
  const inv = ensureInventoryStructure(player.inventory);
  const slots = [];
  for (let p = 0; p < inv.length; p++) {
    const row = inv[p];
    if (!Array.isArray(row)) continue;
    for (let s = 0; s < row.length; s++) {
      const slot = row[s];
      if (slot && slot.item && typeof slot.item === 'object') slots.push({ ...slot, _page: p, _idx: s });
    }
  }
  const typeOrder = (t) => {
    if (isEquipmentType(t)) return 0;
    if (['consumable', 'talisman'].includes(t)) return 1;
    if (['material', 'herb', 'medicine'].includes(t)) return 2;
    return 3;
  };
  const mergeStackable = (list) => {
    const byKey = new Map();
    let nonStackIdx = 0;
    for (const s of list) {
      const it = s.item;
      const stackable = isItemStackable(it);
      if (stackable && it?.id) {
        const key = getStackableItemKey(it) || String(it.id);
        const cur = byKey.get(key);
        if (cur) {
          cur.count = (Number(cur.count) || 0) + Math.max(1, Number(s.count) || 1);
        } else {
          byKey.set(key, { item: structuredClone(it), count: Math.max(1, Number(s.count) || 1) });
        }
      } else {
        byKey.set(`eq_${nonStackIdx++}`, { item: structuredClone(it), count: Math.max(1, Number(s.count) || 1) });
      }
    }
    return Array.from(byKey.values()).map(o => ({ item: o.item, count: o.count }));
  };
  const merged = mergeStackable(slots);
  merged.sort((a, b) => {
    const aLocked = isLockedEquipmentItem(a.item);
    const bLocked = isLockedEquipmentItem(b.item);
    if (aLocked !== bLocked) return aLocked ? -1 : 1;

    const ta = typeOrder(String(a.item?.type || ''));
    const tb = typeOrder(String(b.item?.type || ''));
    if (ta !== tb) return ta - tb;
    const qa = Number(a.item?.quality) || 1;
    const qb = Number(b.item?.quality) || 1;
    if (qb !== qa) return qb - qa;
    const na = String(a.item?.name || '');
    const nb = String(b.item?.name || '');
    if (na !== nb) return na.localeCompare(nb);
    return (Number(a.item?.id) || 0) - (Number(b.item?.id) || 0);
  });
  for (let p = 0; p < inv.length; p++) {
    if (!Array.isArray(inv[p])) inv[p] = new Array(20).fill(null);
    for (let s = 0; s < inv[p].length; s++) inv[p][s] = null;
  }
  let idx = 0;
  const total = 10 * 20;
  for (const s of merged) {
    if (idx >= total) break;
    const p = Math.floor(idx / 20);
    const i = idx % 20;
    inv[p][i] = s;
    idx++;
  }
  player.inventory = inv;
}

function putItemInInventory(inv, item, count) {
  if (!Array.isArray(inv)) return false;
  inv = ensureInventoryStructure(inv);
  if (inv.length < 10) return false; // 结构异常
  const addCount = Math.floor(count || 1);
  const itemId = Number(item && item.id) || 0;
  const stackable = isItemStackable(item);
  const itemStackKey = stackable ? getStackableItemKey(item) : '';
  if (stackable && itemId > 0 && addCount > 0) {
    for (let p = 0; p < inv.length; p++) {
      const row = inv[p];
      if (!Array.isArray(row)) continue;
      for (let s = 0; s < row.length; s++) {
        const slot = row[s];
        if (slot && slot.item && Number(slot.item.id) === itemId) {
          const slotStackKey = getStackableItemKey(slot.item);
          if (slotStackKey !== itemStackKey) continue;
          slot.count = (Number(slot.count) || 0) + addCount;
          return true;
        }
      }
    }
  }
  if (!stackable) {
    let left = Math.max(1, addCount);
    for (let p = 0; p < inv.length && left > 0; p++) {
      const row = inv[p];
      if (!Array.isArray(row)) continue;
      for (let s = 0; s < row.length && left > 0; s++) {
        if (row[s] == null) {
          row[s] = { item: structuredClone(item), count: 1 };
          left -= 1;
        }
      }
    }
    return left <= 0;
  }
  for (let p = 0; p < inv.length; p++) {
    const row = inv[p];
    if (!Array.isArray(row)) continue;
    for (let s = 0; s < row.length; s++) {
      if (row[s] == null) {
        row[s] = { item: structuredClone(item), count: addCount };
        return true;
      }
    }
  }
  return false;
}

function unequip(player, slotType) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!EQUIP_SLOTS.includes(slotType)) return { ok: false, error: '无效装备槽' };

  const equip = player.equipment || {};
  let item = equip[slotType];
  if (!item) return { ok: false, error: '该槽位无装备' };
  if (item.item) item = item.item;  // 兼容 { item, count } 旧格式

  player.inventory = ensureInventoryStructure(player.inventory || []);
  const inv = player.inventory;
  const placed = putItemInInventory(inv, item, 1);
  if (!placed) return { ok: false, error: '背包已满' };

  equip[slotType] = null;
  player.equipment = equip;
  return { ok: true, player };
}

/** 剥离等级不足的装备，突破失败/降级后调用；登录同步时也可调用以修复异常数据 */
function stripInvalidEquipment(player, opts = {}) {
  if (!player || typeof player.equipment !== 'object') return;
  const lv = Number(player.level) || 1;
  const levelAllowance = Math.max(0, intVal(opts.levelAllowance, intVal(player?._equip_level_allowance, 0)));
  const keepEquipped = opts.keepEquipped === true;
  const equip = player.equipment;
  player.inventory = ensureInventoryStructure(player.inventory || []);
  const inv = player.inventory;
  for (const slotType of EQUIP_SLOTS) {
    let item = equip[slotType];
    if (!item) continue;
    if (item.item) item = item.item;
    const req = getRequiredLevel(item);
    if (lv + levelAllowance >= req) continue;
    if (keepEquipped) continue;
    const placed = putItemInInventory(inv, item, 1);
    equip[slotType] = null;
    if (!placed) {
      // 背包满时仍剥离，物品丢失，避免跨阶级穿装备获得非法属性
    }
  }
}

/**
 * 登录同步时清洗历史异常装备：按词缀自身Q/T范围夹值，并回写 stats/randomExtraStats。
 */
function sanitizeEquipmentAffixesByQualityTier(player) {
  if (!player || typeof player !== 'object') {
    return { changed: false, changedItems: 0, correctedAffixes: 0, correctedWhiteStats: 0 };
  }

  let changed = false;
  let changedItems = 0;
  let correctedAffixes = 0;
  let correctedWhiteStats = 0;

  const applySanitize = (item) => {
    if (!item || typeof item !== 'object') {
      return { changed: false, equipment: item, correctedAffixCount: 0, correctedWhiteStatCount: 0 };
    }
    return sanitizeEquipmentAffixValuesByQualityTier(item);
  };

  const equip = player.equipment && typeof player.equipment === 'object' ? player.equipment : {};
  player.equipment = equip;
  for (const slotType of EQUIP_SLOTS) {
    let slotItem = equip[slotType];
    if (!slotItem) continue;
    const wrapped = slotItem && typeof slotItem === 'object' && slotItem.item && typeof slotItem.item === 'object';
    const target = wrapped ? slotItem.item : slotItem;
    const fixed = applySanitize(target);
    if (!fixed.changed) continue;
    if (wrapped) slotItem.item = fixed.equipment;
    else equip[slotType] = fixed.equipment;
    changed = true;
    changedItems += 1;
    correctedAffixes += Math.max(0, Number(fixed.correctedAffixCount) || 0);
    correctedWhiteStats += Math.max(0, Number(fixed.correctedWhiteStatCount) || 0);
  }

  player.inventory = ensureInventoryStructure(player.inventory || []);
  for (const row of player.inventory) {
    if (!Array.isArray(row)) continue;
    for (const slotData of row) {
      if (!slotData || typeof slotData !== 'object' || !slotData.item || typeof slotData.item !== 'object') continue;
      const fixed = applySanitize(slotData.item);
      if (!fixed.changed) continue;
      slotData.item = fixed.equipment;
      changed = true;
      changedItems += 1;
      correctedAffixes += Math.max(0, Number(fixed.correctedAffixCount) || 0);
      correctedWhiteStats += Math.max(0, Number(fixed.correctedWhiteStatCount) || 0);
    }
  }

  return { changed, changedItems, correctedAffixes, correctedWhiteStats };
}

/** 清除非法宗门技能：玩家当前宗门与技能所属宗门不一致的，从 skill_levels/equipped_skills/skill_cooldowns 中移除，修复退宗后技能仍残留在列表中的问题 */
function stripInvalidSectSkills(player) {
  if (!player || typeof player !== 'object') return;
  const skillLevels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  const skills = getSkills() || [];
  const playerSectId = Math.floor(Number(player.sect_id) || 0);
  const toRemove = [];
  for (const skillId of Object.keys(skillLevels)) {
    const sid = Math.floor(Number(skillId) || 0);
    const skill = skills.find(s => Number(s.id) === sid);
    const skillSectId = Math.floor(Number(skill?.sectId) || 0);
    if (skillSectId <= 0) continue;
    if (playerSectId !== skillSectId) toRemove.push(String(skillId));
  }
  if (toRemove.length === 0) return;
  for (const id of toRemove) {
    delete skillLevels[id];
  }
  player.skill_levels = skillLevels;
  const skillCooldowns = player.skill_cooldowns && typeof player.skill_cooldowns === 'object' ? player.skill_cooldowns : {};
  for (const id of toRemove) {
    if (Object.prototype.hasOwnProperty.call(skillCooldowns, id)) delete skillCooldowns[id];
  }
  player.skill_cooldowns = skillCooldowns;
  if (Array.isArray(player.equipped_skills)) {
    const removeSet = new Set(toRemove);
    player.equipped_skills = player.equipped_skills.filter(idv => !removeSet.has(String(Math.floor(Number(idv) || 0))));
  }
  if (toRemove.includes(String(Math.floor(Number(player.key_skill_id) || 0)))) {
    player.key_skill_id = 0;
  }
}

/** 清除技能冷却中的孤儿记录：若某技能的冷却存在于 skill_cooldowns 但不在 skill_levels，则删除，修复退宗后残留的宗门技能冷却 */
function cleanupOrphanedSkillCooldowns(player) {
  if (!player || typeof player !== 'object') return;
  const skillLevels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  const skillCooldowns = player.skill_cooldowns && typeof player.skill_cooldowns === 'object' ? player.skill_cooldowns : {};
  let changed = false;
  for (const skillId of Object.keys(skillCooldowns)) {
    const key = String(skillId);
    if (Object.prototype.hasOwnProperty.call(skillLevels, key)) continue;
    delete skillCooldowns[key];
    changed = true;
  }
  if (changed) player.skill_cooldowns = skillCooldowns;
}

// 筑基丹 ID=1
function countFoundationPills(inv) {
  let c = 0;
  for (const page of inv || []) {
    for (const slot of page || []) {
      if (!slot || !slot.item) continue;
      if (Number(slot.item.id) === 1) c += Number(slot.count) || 1;
    }
  }
  return c;
}

function consumeItemFromInventory(inv, itemId, count) {
  let remain = count;
  for (let p = 0; p < (inv || []).length; p++) {
    const page = inv[p];
    for (let s = 0; s < (page || []).length; s++) {
      const slot = page[s];
      if (!slot || !slot.item || Number(slot.item.id) !== itemId) continue;
      const n = Number(slot.count) || 1;
      if (n <= remain) {
        page[s] = null;
        remain -= n;
      } else {
        slot.count = n - remain;
        remain = 0;
      }
      if (remain <= 0) return true;
    }
  }
  return remain <= 0;
}

function countItemInInventory(inv, itemId) {
  let total = 0;
  const targetId = Math.floor(Number(itemId) || 0);
  if (targetId <= 0) return 0;
  for (const page of inv || []) {
    if (!Array.isArray(page)) continue;
    for (const slot of page) {
      if (!slot || !slot.item) continue;
      if (Math.floor(Number(slot.item.id) || 0) !== targetId) continue;
      total += Math.max(1, Math.floor(Number(slot.count) || 1));
    }
  }
  return total;
}

function calculateItemValue(item) {
  if (!item || typeof item !== 'object') return 0;
  const val = Number(item.value);
  if (Number.isFinite(val)) return Math.floor(val);
  const quality = Math.floor(Number(item.quality) || 1);
  const t = String(item.type || '');
  let baseValue = 0;
  if (quality === 1) baseValue = 10;
  else if (quality === 2) baseValue = 30;
  else if (quality === 3) baseValue = 100;
  else if (quality === 4) baseValue = 400;
  else if (quality === 5) baseValue = 2000;
  else if (quality === 6) baseValue = 3000;
  else if (quality === 7) baseValue = 5000;
  if (String(item.material || '') === '令牌') return baseValue * 5;
  if (['herb', 'medicine', 'material'].includes(t)) return baseValue;
  if (['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back', 'consumable'].includes(t)) return baseValue * 3;
  if (t === 'book') return baseValue * 5;
  return baseValue;
}

function getSlotItem(player, page, slotIndex) {
  const inv = player?.inventory;
  if (!Array.isArray(inv) || page < 0 || page >= inv.length) return null;
  const row = inv[page];
  if (!Array.isArray(row) || slotIndex < 0 || slotIndex >= row.length) return null;
  const slot = row[slotIndex];
  return slot?.item || null;
}

function setEquipmentLock(player, page, slotIndex, locked = null) {
  const inv = player?.inventory;
  if (!Array.isArray(inv) || page < 0 || page >= inv.length) return { ok: false, error: '无效背包页' };
  const row = inv[page];
  if (!Array.isArray(row) || slotIndex < 0 || slotIndex >= row.length) return { ok: false, error: '无效槽位' };
  const slot = row[slotIndex];
  if (!slot || !slot.item) return { ok: false, error: '该槽位无物品' };
  if (!isEquipmentType(slot.item.type)) return { ok: false, error: '仅装备支持锁定' };

  const current = Boolean(slot.item.locked);
  const next = locked == null ? !current : Boolean(locked);
  if (next) slot.item.locked = true;
  else delete slot.item.locked;
  return { ok: true, player, locked: next };
}

function consumeFromInventorySlot(player, page, slotIndex, count) {
  const inv = player?.inventory;
  if (!Array.isArray(inv) || page < 0 || page >= inv.length) return { ok: false, error: '无效背包页' };
  const row = inv[page];
  if (!Array.isArray(row) || slotIndex < 0 || slotIndex >= row.length) return { ok: false, error: '无效槽位' };
  const slot = row[slotIndex];
  if (!slot || !slot.item) return { ok: false, error: '该槽位无物品' };
  const n = Math.max(1, Number(slot.count) || 1);
  const need = Math.max(1, Math.floor(Number(count) || 1));
  if (need > n) return { ok: false, error: '数量不足' };
  const itemSnapshot = structuredClone(slot.item);
  if (need === n) {
    row[slotIndex] = null;
  } else {
    slot.count = n - need;
  }
  return { ok: true, itemSnapshot, count: need };
}

function sellItem(player, page, slotIndex, count) {
  const slotItem = getSlotItem(player, page, slotIndex);
  if (!slotItem) return { ok: false, error: '该槽位无物品' };
  if (isLockedEquipmentItem(slotItem)) return { ok: false, error: '该装备已锁定，无法回收' };

  const r = consumeFromInventorySlot(player, page, slotIndex, count);
  if (!r.ok) return r;
  const value = calculateItemValue(r.itemSnapshot);
  const totalStones = value * r.count;
  player.spirit_stones = Math.floor((Number(player.spirit_stones) || 0) + totalStones);
  return {
    ok: true,
    player,
    spirit_stones: totalStones,
    item_name: String(r.itemSnapshot.name || '物品'),
    count: r.count
  };
}

// 阶级 -> 催化剂物品ID（2阶寒潭沙27, 3阶丹霞砂69, 4阶九凤丹霞砂71, 5阶百炼封神石45, 6阶鸿蒙太玄砂133）
const CATALYST_BY_TIER = { 2: 27, 3: 69, 4: 71, 5: 45, 6: 133 };

function decomposeEquipment(player, page, slotIndex) {
  const slotItem = getSlotItem(player, page, slotIndex);
  if (!slotItem) return { ok: false, error: '该槽位无物品' };
  if (isLockedEquipmentItem(slotItem)) return { ok: false, error: '该装备已锁定，无法分解' };

  const r = consumeFromInventorySlot(player, page, slotIndex, 1);
  if (!r.ok) return r;
  const item = r.itemSnapshot;
  const itemType = String(item.type || '');
  if (!EQUIP_SLOTS.includes(itemType)) return { ok: false, error: '只能分解装备' };
  const equipQuality = Math.max(1, Math.min(8, Math.floor(Number(item.quality) || 1)));
  // 1阶装备无对应催化剂，出2阶催化剂
  const catalystTier = equipQuality <= 1 ? 2 : Math.min(6, equipQuality);
  const catalystId = CATALYST_BY_TIER[catalystTier];
  if (!catalystId) return { ok: false, error: '催化剂配置异常' };
  player.inventory = ensureInventoryStructure(player.inventory || []);
  const dropped = Math.random() < 0.3;
  if (dropped) {
    const catalystTemplate = getItemById(catalystId);
    if (catalystTemplate && catalystTemplate.id) {
      const added = putItemInInventory(player.inventory, catalystTemplate, 1);
      if (!added) return { ok: false, error: '背包已满，分解失败' };
    }
  }
  return {
    ok: true,
    player,
    catalyst_dropped: dropped,
    catalyst_name: dropped ? String(getItemById(catalystId).name || '催化剂') : null
  };
}

const YUNLING_DAN_ITEM_ID = 5; // 蕴灵丹
const MATERIAL_BOX_RESTRICTED_TAGS = ['gm_only', 'invite_shop_only', 'no_dungeon_loot', 'no_drop'];

function _getMaterialBoxPool(quality) {
  const q = Math.max(1, Math.min(8, Math.floor(Number(quality) || 0)));
  return (getItems() || []).filter(it => {
    if (!it || String(it.type || '') !== 'material') return false;
    if (Math.floor(Number(it.quality) || 0) !== q) return false;
    const tags = Array.isArray(it.tags) ? it.tags : [];
    return !MATERIAL_BOX_RESTRICTED_TAGS.some(t => tags.includes(t));
  });
}

function _rollDecreasingCount(minCount, maxCount) {
  const lo = Math.max(1, Math.floor(Number(minCount) || 1));
  const hi = Math.max(lo, Math.floor(Number(maxCount) || lo));
  if (lo === hi) return lo;

  let totalWeight = 0;
  for (let n = lo; n <= hi; n++) {
    totalWeight += (hi - n + 1);
  }

  let r = Math.random() * totalWeight;
  for (let n = lo; n <= hi; n++) {
    const w = hi - n + 1;
    if (r < w) return n;
    r -= w;
  }
  return hi;
}

function _openMaterialBoxes(player, quality, minCount, maxCount, boxCount) {
  const q = Math.max(1, Math.min(8, Math.floor(Number(quality) || 0)));
  const boxN = Math.max(1, Math.floor(Number(boxCount) || 1));
  const lo = Math.max(1, Math.floor(Number(minCount) || 1));
  const hi = Math.max(lo, Math.floor(Number(maxCount) || lo));

  const pool = _getMaterialBoxPool(q);
  if (pool.length <= 0) {
    return { ok: false, error: `暂无可产出的${q}阶材料` };
  }

  const dropsMap = new Map();
  for (let b = 0; b < boxN; b++) {
    const countThisBox = _rollDecreasingCount(lo, hi);
    for (let i = 0; i < countThisBox; i++) {
      const mat = pool[Math.floor(Math.random() * pool.length)];
      if (!mat || !mat.id) continue;
      const mid = Math.floor(Number(mat.id) || 0);
      if (mid <= 0) continue;
      const old = dropsMap.get(mid);
      if (old) {
        old.count += 1;
      } else {
        dropsMap.set(mid, { id: mid, name: String(mat.name || `材料${mid}`), count: 1, tpl: mat });
      }
    }
  }

  if (dropsMap.size <= 0) {
    return { ok: false, error: '开箱失败，请稍后重试' };
  }

  const inv = ensureInventoryStructure(player.inventory || []);
  const invClone = structuredClone(inv);
  for (const d of dropsMap.values()) {
    if (!putItemInInventory(invClone, d.tpl, d.count)) {
      return { ok: false, error: '背包空间不足，无法开箱' };
    }
  }

  for (const d of dropsMap.values()) {
    if (!putItemInInventory(inv, d.tpl, d.count)) {
      return { ok: false, error: '背包空间不足，无法开箱' };
    }
  }

  const drops = [...dropsMap.values()].map(d => ({ id: d.id, name: d.name, count: d.count }));
  const total = drops.reduce((sum, d) => sum + (Math.floor(Number(d.count) || 0)), 0);
  return { ok: true, drops, total, opened: boxN, quality: q };
}

function breakthrough(player) {
  if (!player) return { ok: false, error: '无玩家数据' };
  ensureTalentState(player);
  ensureSpiritRootMaps(player);
  recalcAndAssignCombatStats(player);
  player.inventory = ensureInventoryStructure(player.inventory || []);
  const lv = Number(player.level) || 1;

  if (lv === 120) return breakthroughFoundation(player);
  if (lv === 160) return breakthroughGoldenCore(player);
  if (lv === 200) return breakthroughNascent(player);
  if (lv === 240) return breakthroughSpirit(player);
  if (lv === 280) return breakthroughRefiningVoid(player);

  return { ok: false, error: '当前等级无法突破' };
}

function _applyBreakthroughPenalty(player, btLevel) {
  if (btLevel >= 200) {
    player.exp = 0;
    recalcAndAssignCombatStats(player);
    return { levelDrop: 0, newLevel: Number(player.level) || btLevel };
  }
  const drop = BREAKTHROUGH_PENALTY[btLevel] || 5;
  player._pre_penalty_level = btLevel;
  player.level = Math.max(1, btLevel - drop);
  player.exp = 0;
  stripInvalidEquipment(player);
  recalcStatsForLevel(player);
  recalcAndAssignCombatStats(player);
  return { levelDrop: drop, newLevel: player.level };
}

function breakthroughFoundation(player) {
  const expNeeded = calculateExpNeeded(120);
  if (Number(player.exp) < expNeeded) return { ok: false, error: '经验不足' };

  let rate = 0.15;
  const stored = Number(player.breakthrough_foundation_pills_stored) || 0;
  const invCount = countFoundationPills(player.inventory);
  const total = stored + invCount;
  if (total > 0) {
    const effective = Math.min(total, 5);
    rate += effective * 0.2;
    const consume = Math.min(invCount, 5);
    if (consume > 0) consumeItemFromInventory(player.inventory, 1, consume);
  }
  rate = Math.min(rate, 1);
  player.breakthrough_foundation_pills_stored = 0;

  const roll = Math.random();
  if (roll < rate) {
    player.level = 121;
    grantTalentPointsForLevel(player);
    recalcAndAssignCombatStats(player);
    return { ok: true, player, success: true };
  }
  const penaltyInfo = _applyBreakthroughPenalty(player, 120);
  return { ok: true, player, success: false, penalty: penaltyInfo };
}

function breakthroughGoldenCore(player) {
  const expNeeded = calculateExpNeeded(160);
  if (Number(player.exp) < expNeeded) return { ok: false, error: '经验不足' };

  let rate = 0.05;
  const roots = player.effective_spirit_roots || player.spirit_roots || {};
  const rootValues = Object.values(roots).map(v => Number(v) || 0);
  const hasHighRoot = rootValues.some(v => v > 80);
  if (hasHighRoot) {
    for (const v of rootValues) {
      if (v > 80) rate += (v - 80) * 0.01;
    }
  } else {
    const totalRoot = rootValues.reduce((s, v) => s + v, 0);
    if (totalRoot > 255) rate += Math.min(0.20, (totalRoot - 255) * (0.20 / 20));
  }
  const yunlingStored = Math.min(4, Number(player.breakthrough_yunling_stored) || 0);
  rate += yunlingStored * 0.2;
  player.breakthrough_yunling_stored = 0;
  rate = Math.min(rate, 1);

  const roll = Math.random();
  if (roll < rate) {
    player.level = 161;
    grantTalentPointsForLevel(player);
    recalcAndAssignCombatStats(player);
    return { ok: true, player, success: true };
  }
  const penaltyInfo = _applyBreakthroughPenalty(player, 160);
  return { ok: true, player, success: false, penalty: penaltyInfo };
}

function getTotalSixStats(player) {
  const eq = player.equipment_stats || {};
  const tec = player.technique_stats || {};
  const base = (Number(player.strength) || 0) + (Number(player.constitution) || 0) + (Number(player.bone) || 0) +
    (Number(player.agility) || 0) + (Number(player.zhenyuan) || 0) + (Number(player.lingli) || 0);
  const eqSum = (Number(eq.strength) || 0) + (Number(eq.constitution) || 0) + (Number(eq.bone) || 0) +
    (Number(eq.agility) || 0) + (Number(eq.zhenyuan) || 0) + (Number(eq.lingli) || 0);
  const tecSum = (Number(tec.strength) || 0) + (Number(tec.constitution) || 0) + (Number(tec.bone) || 0) +
    (Number(tec.agility) || 0) + (Number(tec.zhenyuan) || 0) + (Number(tec.lingli) || 0);
  return base + eqSum + tecSum;
}

/** 六维基础属性总和（不含装备/功法等加成） */
function getBaseSixStats(player) {
  ensureOriginalBaseAttributes(player);
  const oa = player.original_base_attributes || {};
  return (Number(oa.strength) || 0) + (Number(oa.constitution) || 0) + (Number(oa.bone) || 0) +
    (Number(oa.agility) || 0) + (Number(oa.zhenyuan) || 0) + (Number(oa.lingli) || 0);
}

function getOwnedSkillCount(player) {
  const levels = (player && typeof player.skill_levels === 'object' && player.skill_levels) ? player.skill_levels : {};
  let count = 0;
  for (const v of Object.values(levels)) {
    const lv = (v && typeof v === 'object') ? Number(v.level) : Number(v);
    if (lv > 0) count += 1;
  }
  if (count > 0) return count;
  const fallback = Array.isArray(player?.skills) ? player.skills : [];
  return new Set(fallback.map(x => Number(x) || 0).filter(x => x > 0)).size;
}

function getOwnedTechniqueCount(player) {
  const levels = (player && typeof player.technique_levels === 'object' && player.technique_levels) ? player.technique_levels : {};
  let count = 0;
  for (const v of Object.values(levels)) {
    const lv = (v && typeof v === 'object') ? Number(v.level) : Number(v);
    if (lv > 0) count += 1;
  }
  if (count > 0) return count;
  const fallback = Array.isArray(player?.techniques) ? player.techniques : [];
  return new Set(fallback.map((x) => {
    if (x && typeof x === 'object') return Number(x.id) || 0;
    return Number(x) || 0;
  }).filter(x => x > 0)).size;
}

function breakthroughNascent(player) {
  const expNeeded = calculateExpNeeded(200);
  if (Number(player.exp) < expNeeded) return { ok: false, error: '经验不足' };

  let rate = 0.05;
  const killBonus = Math.min(0.45, (Number(player.breakthrough_nascent_kill_count) || 0) * 0.003);
  rate += killBonus;

  if (Math.floor(Number(player.spirit_stones) || 0) >= 80000) {
    player.spirit_stones = Math.floor(Number(player.spirit_stones) || 0) - 80000;
    rate += 0.10;
  }

  const nascentRoots = player.effective_spirit_roots || player.spirit_roots || {};
  const nascentRootValues = Object.values(nascentRoots).map(v => Number(v) || 0);
  const nascentHasHighRoot = nascentRootValues.some(v => v > 80);
  const spiritTotal = nascentRootValues.reduce((s, v) => s + v, 0);
  if (nascentHasHighRoot) {
    if (spiritTotal > 360) rate += Math.min(0.15, (spiritTotal - 360) * 0.0075);
  } else {
    if (spiritTotal > 335) rate += Math.min(0.15, (spiritTotal - 335) * (0.15 / 15));
  }

  const sixStats = getBaseSixStats(player);
  if (sixStats > 1500) rate += Math.min(0.25, Math.floor((sixStats - 1500) / 36) * 0.01);
  rate = Math.min(rate, 1);

  const roll = Math.random();
  if (roll < rate) {
    player.level = 201;
    grantTalentPointsForLevel(player);
    recalcAndAssignCombatStats(player);
    return { ok: true, player, success: true };
  }
  player.breakthrough_nascent_kill_count = 0;
  const penaltyInfo = _applyBreakthroughPenalty(player, 200);
  return { ok: true, player, success: false, penalty: penaltyInfo };
}

function breakthroughSpirit(player) {
  const expNeeded = calculateExpNeeded(240);
  if (Number(player.exp) < expNeeded) return { ok: false, error: '经验不足' };

  let rate = 0.05;
  const dungeonBonus = Math.min(0.30, (Number(player.breakthrough_spirit_dungeon_count) || 0) * 0.03);
  rate += dungeonBonus;
  if (player.breakthrough_heart_trial_passed) rate += 0.20;
  const sixStats = getBaseSixStats(player);
  if (sixStats > 5500) rate += Math.min(0.45, Math.floor((sixStats - 5500) / 100) * 0.01);
  rate = Math.min(rate, 1);

  const roll = Math.random();
  if (roll < rate) {
    player.level = 241;
    grantTalentPointsForLevel(player);
    recalcAndAssignCombatStats(player);
    return { ok: true, player, success: true };
  }
  player.breakthrough_spirit_dungeon_count = 0;
  const penaltyInfo = _applyBreakthroughPenalty(player, 240);
  return { ok: true, player, success: false, penalty: penaltyInfo };
}

function breakthroughRefiningVoid(player) {
  const expNeeded = calculateExpNeeded(280);
  if (Number(player.exp) < expNeeded) return { ok: false, error: '经验不足' };

  const sixSum = getBaseSixStats(player);
  const attrRate = sixSum <= 15000
    ? 0
    : (sixSum >= 23000 ? 0.4 : ((sixSum - 15000) / 8000) * 0.4);
  const skillRate = Math.min(0.4, getOwnedSkillCount(player) * (0.4 / 15));
  const techRate = Math.min(0.2, getOwnedTechniqueCount(player) * 0.02);
  const rate = Math.min(1, attrRate + skillRate + techRate);

  const roll = Math.random();
  if (roll < rate) {
    player.level = 281;
    grantTalentPointsForLevel(player);
    recalcAndAssignCombatStats(player);
    return { ok: true, player, success: true };
  }
  const penaltyInfo = _applyBreakthroughPenalty(player, 280);
  return { ok: true, player, success: false, penalty: penaltyInfo };
}

// 使用物品（部分类型：筑基丹累积、经验丹、回血回蓝、学习技能/功法/配方）
function useItem(player, page, slotIndex, count = 1, useOptions = null) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const inv = player.inventory || [];
  if (page < 0 || page >= inv.length) return { ok: false, error: '无效背包页' };
  const row = inv[page];
  if (!row || slotIndex < 0 || slotIndex >= row.length) return { ok: false, error: '无效槽位' };

  const slot = row[slotIndex];
  if (!slot || !slot.item) return { ok: false, error: '该槽位无物品' };

  const item = slot.item;
  const itemType = String(item.type || '');
  if (itemType !== 'consumable' && itemType !== 'book') return { ok: false, error: '不可使用' };
  cleanupTimedBuffs(player);

  const itemId = Number(item.id) || 0;
  const consumeFromSlot = (useAmt) => {
    const cnt = Number(slot.count) || 1;
    const actual = Math.max(0, Math.min(Math.floor(useAmt || 0), cnt));
    if (actual <= 0) return 0;
    if (cnt <= actual) row[slotIndex] = null; else slot.count = cnt - actual;
    return actual;
  };

  // 筑基丹 ID=1：累积到突破用
  if (itemId === 1) {
    const cap = 5;
    const stored = Number(player.breakthrough_foundation_pills_stored) || 0;
    if (stored >= cap) return { ok: false, error: '筑基丹已服用满 5 枚' };
    const cnt = Number(slot.count) || 1;
    const useAmt = Math.min(Math.max(1, Math.floor(Number(count) || 1)), cnt, cap - stored);
    player.breakthrough_foundation_pills_stored = stored + useAmt;
    consumeFromSlot(useAmt);
    return { ok: true, player, used_count: useAmt, msg: `已服用${useAmt}枚筑基丹 (${player.breakthrough_foundation_pills_stored}/5)` };
  }

  // 蕴灵丹 ID=5：筑基→金丹突破用，纯服用累积（最多4枚，每枚+20%）
  if (itemId === YUNLING_DAN_ITEM_ID) {
    const cap = 4;
    const stored = Number(player.breakthrough_yunling_stored) || 0;
    if (stored >= cap) return { ok: false, error: '蕴灵丹已服用满 4 枚' };
    const cnt = Number(slot.count) || 1;
    const useAmt = Math.min(Math.max(1, Math.floor(Number(count) || 1)), cnt, cap - stored);
    player.breakthrough_yunling_stored = stored + useAmt;
    consumeFromSlot(useAmt);
    return { ok: true, player, used_count: useAmt, msg: `已服用${useAmt}枚蕴灵丹 (${player.breakthrough_yunling_stored}/4)，每枚+20%成功率` };
  }

  // 经验丹等 effects
  const effects = item.effects || [];
  const cnt = Number(slot.count) || 1;
  const requestedUseAmt = Math.min(Math.max(1, Math.floor(Number(count) || 1)), cnt);
  const useOpts = (useOptions && typeof useOptions === 'object' && !Array.isArray(useOptions)) ? useOptions : {};
  let usedCount = null;
  const resultMsgs = [];
  let changed = false;
  let combatDirty = false;
  const setUsedCount = (n) => {
    const val = Math.max(0, Math.floor(Number(n) || 0));
    if (usedCount == null) usedCount = val;
    else usedCount = Math.min(usedCount, val);
  };
  for (const eff of effects) {
    const et = String(eff.type || '');
    const val = eff.value;
    if (et === 'player_exp') {
      const useAmt = requestedUseAmt;
      const addExp = Math.max(0, Math.floor(Number(val) || 0)) * useAmt;
      player.exp = (Number(player.exp) || 0) + addExp;
      setUsedCount(useAmt);
      resultMsgs.push(`获得了${addExp}点经验`);
      changed = true;
      continue;
    }
    if (et === 'random_stat_down') {
      ensureOriginalBaseAttributes(player);
      const useAmt = requestedUseAmt;
      const dec = Math.max(1, Math.floor(Number(val) || 1));
      for (let u = 0; u < useAmt; u++) {
        const stat = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
        const cur = Math.max(1, Number(player[stat]) || 10);
        player[stat] = Math.max(1, cur - dec);
        if (player.original_base_attributes[stat] !== undefined) {
          player.original_base_attributes[stat] = Math.max(1, (player.original_base_attributes[stat] || cur) - dec);
        }
      }
      setUsedCount(useAmt);
      resultMsgs.push(`使用了${useAmt}颗废丹，随机属性降低了`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'random_stat_permanent_boost') {
      ensureOriginalBaseAttributes(player);
      const boost = Math.max(0, Math.floor(Number(val) || 0));
      const maxVal = Math.floor(Number(eff.maxValue) || 999);
      const useAmt = requestedUseAmt;
      let totalBoost = 0;
      let actualUsed = 0;
      for (let u = 0; u < useAmt; u++) {
        const oa = player.original_base_attributes || {};
        const valid = STAT_KEYS.filter(s => (Number(oa[s] ?? player[s]) || 10) < maxVal);
        if (valid.length === 0) break;
        const stat = valid[Math.floor(Math.random() * valid.length)];
        const cur = Math.max(0, Math.floor(Number(oa[stat] ?? player[stat]) || 10));
        const add = Math.min(boost, maxVal - cur);
        if (add <= 0) continue;
        player.original_base_attributes[stat] = cur + add;
        player[stat] = cur + add;
        totalBoost += add;
        actualUsed++;
      }
      if (actualUsed <= 0) continue;
      setUsedCount(actualUsed);
      resultMsgs.push(`使用${actualUsed}颗，随机属性共提高了${totalBoost}点`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'spirit_root_permanent_boost') {
      ensureSpiritRootMaps(player);
      const rootType = String(eff.rootType || '').trim();
      if (!ROOT_KEYS.includes(rootType)) return { ok: false, error: '无效的灵根类型' };
      const boostPer = Math.max(0, Math.floor(Number(val) || 0));
      const maxVal = Math.min(95, Math.floor(Number(eff.maxValue) || 80));
      const useAmt = requestedUseAmt;
      const cur = readSpiritRootValue(player.base_spirit_roots, rootType, 20);
      if (cur >= maxVal) continue;
      const add = Math.min(boostPer * useAmt, maxVal - cur);
      const actualUsed = boostPer > 0 ? Math.max(1, Math.ceil(add / boostPer)) : 0;
      if (actualUsed <= 0 || add <= 0) continue;
      const originCur = readSpiritRootValue(player.original_spirit_roots, rootType, cur);
      player.original_spirit_roots[rootType] = Math.min(maxVal, originCur + add);
      player.base_spirit_roots[rootType] = player.original_spirit_roots[rootType];
      player.spirit_roots[rootType] = player.base_spirit_roots[rootType];
      setUsedCount(actualUsed);
      resultMsgs.push(`使用${actualUsed}颗，灵根永久提高了${add}点`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'random_spirit_root_permanent_boost') {
      ensureSpiritRootMaps(player);
      const boost = Math.max(0, Math.floor(Number(val) || 0));
      const maxVal = Math.min(95, Math.floor(Number(eff.maxValue) || 80));
      const useAmt = requestedUseAmt;
      let totalAdd = 0;
      let actualUsed = 0;
      for (let u = 0; u < useAmt; u++) {
        const valid = ROOT_KEYS.filter(r => readSpiritRootValue(player.base_spirit_roots, r, 20) < maxVal);
        if (valid.length === 0) break;
        const rootType = valid[Math.floor(Math.random() * valid.length)];
        const cur = readSpiritRootValue(player.base_spirit_roots, rootType, 20);
        const add = Math.min(boost, maxVal - cur);
        if (add <= 0) continue;
        player.original_spirit_roots[rootType] = Math.min(maxVal, cur + add);
        player.base_spirit_roots[rootType] = player.original_spirit_roots[rootType];
        player.spirit_roots[rootType] = player.base_spirit_roots[rootType];
        totalAdd += add;
        actualUsed++;
      }
      if (actualUsed <= 0) continue;
      setUsedCount(actualUsed);
      resultMsgs.push(`使用${actualUsed}颗，随机灵根共提高了${totalAdd}点`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'spirit_root_transfer_select') {
      ensureSpiritRootMaps(player);
      const transferPer = Math.max(1, Math.floor(Number(eff.transferValue ?? val) || 5));
      const sourceThreshold = Math.max(0, Math.floor(Number(eff.sourceThreshold) || 95));
      const targetCap = Math.max(1, Math.min(95, Math.floor(Number(eff.targetCap) || 85)));
      const targetRoot = normalizeRootType(useOpts.target_root_type ?? useOpts.targetRootType ?? eff.targetRootType ?? eff.rootType);
      if (!ROOT_KEYS.includes(targetRoot)) {
        return { ok: false, error: '请先选择目标灵根（金/木/水/火/土）' };
      }

      const useAmt = requestedUseAmt;
      const targetBeforeAll = readSpiritRootValue(player.base_spirit_roots, targetRoot, 20);
      let targetPassiveBonus = 0;
      let passiveEffectsForPromote = null;
      try {
        passiveEffectsForPromote = calcAllPassiveEffects(player);
        targetPassiveBonus = Math.max(0, Math.floor(Number(passiveEffectsForPromote?.spirit_root_bonus?.[targetRoot]) || 0));
      } catch (_) {
        targetPassiveBonus = 0;
        passiveEffectsForPromote = null;
      }
      const canDirectRaiseWithoutSource = targetPassiveBonus >= 15;
      const hasSourceAboveThreshold = () => {
        for (const rk of ROOT_KEYS) {
          if (rk === targetRoot) continue;
          const cur = readSpiritRootValue(player.base_spirit_roots, rk, 20);
          if (cur > sourceThreshold) return true;
        }
        return false;
      };

      const tryPromoteByRefineCap = () => {
        if (!passiveEffectsForPromote) return false;
        if (targetPassiveBonus < 15) return false;
        const baseNow = readSpiritRootValue(player.base_spirit_roots, targetRoot, 20);
        if (baseNow !== 85) return false;
        const withRefine = calcSpiritRootBonuses(player?.spirit_roots, passiveEffectsForPromote);
        const effectiveRoot = Math.max(0, Math.floor(Number(withRefine?.[targetRoot]) || 0));
        if (effectiveRoot < 95) return false;
        player.original_spirit_roots[targetRoot] = 100;
        player.base_spirit_roots[targetRoot] = 100;
        player.spirit_roots[targetRoot] = 100;
        return true;
      };

      let actualUsed = 0;
      let directAddedTotal = 0;
      let promotedToPerfectCount = 0;
      const sourceRootCounter = {};

      for (let u = 0; u < useAmt; u++) {
        const targetCur = readSpiritRootValue(player.base_spirit_roots, targetRoot, 20);
        const targetRaiseCap = (targetCur >= targetCap && canDirectRaiseWithoutSource) ? 100 : targetCap;
        let sourceRoot = '';
        let sourceVal = -1;
        for (const rk of ROOT_KEYS) {
          if (rk === targetRoot) continue;
          const cur = readSpiritRootValue(player.base_spirit_roots, rk, 20);
          if (cur > sourceThreshold && cur > sourceVal) {
            sourceVal = cur;
            sourceRoot = rk;
          }
        }

        let moved = 0;
        if (sourceRoot && sourceVal > sourceThreshold && targetCur < targetRaiseCap) {
          moved = Math.min(transferPer, targetRaiseCap - targetCur, sourceVal);
          if (moved > 0) {
            const sourceBase = readSpiritRootValue(player.original_spirit_roots, sourceRoot, sourceVal);
            const targetBase = readSpiritRootValue(player.original_spirit_roots, targetRoot, targetCur);
            const nextSource = Math.max(0, sourceBase - moved);
            const nextTarget = Math.min(targetRaiseCap, targetBase + moved);

            player.original_spirit_roots[sourceRoot] = nextSource;
            player.base_spirit_roots[sourceRoot] = nextSource;
            player.spirit_roots[sourceRoot] = nextSource;

            player.original_spirit_roots[targetRoot] = nextTarget;
            player.base_spirit_roots[targetRoot] = nextTarget;
            player.spirit_roots[targetRoot] = nextTarget;

            sourceRootCounter[sourceRoot] = (sourceRootCounter[sourceRoot] || 0) + moved;
          }
        } else if (targetCur < targetRaiseCap && canDirectRaiseWithoutSource) {
          moved = Math.min(transferPer, targetRaiseCap - targetCur);
          if (moved > 0) {
            const targetBase = readSpiritRootValue(player.original_spirit_roots, targetRoot, targetCur);
            const nextTarget = Math.min(targetRaiseCap, targetBase + moved);
            player.original_spirit_roots[targetRoot] = nextTarget;
            player.base_spirit_roots[targetRoot] = nextTarget;
            player.spirit_roots[targetRoot] = nextTarget;
            directAddedTotal += moved;
          }
        }

        if (moved <= 0) break;
        actualUsed++;

        if (tryPromoteByRefineCap()) promotedToPerfectCount++;
      }

      if (actualUsed <= 0) {
        // 允许“先到85，后补淬炼”的二次使用路径：目标已在上限时可直接触发补正到100
        if (requestedUseAmt > 0 && tryPromoteByRefineCap()) {
          setUsedCount(1);
          const targetAfterAll = readSpiritRootValue(player.base_spirit_roots, targetRoot, targetBeforeAll);
          resultMsgs.push(`使用1颗，${rootLabel(targetRoot)} ${targetBeforeAll}->${targetAfterAll}；与淬炼法叠加后补正至100`);
          changed = true;
          combatDirty = true;
          continue;
        }

        const targetCur = readSpiritRootValue(player.base_spirit_roots, targetRoot, 20);
        if (targetCur >= targetCap) {
          if (!canDirectRaiseWithoutSource && targetCur < 100) {
            return { ok: false, error: `${rootLabel(targetRoot)}基础值已达${targetCap}，需先将对应淬炼补正提升至15后才可继续提升` };
          }
          if (targetCur >= 100) {
            return { ok: false, error: `${rootLabel(targetRoot)}基础值已达上限100` };
          }
          return { ok: false, error: `${rootLabel(targetRoot)}基础值已达上限${targetCap}` };
        }
        if (!canDirectRaiseWithoutSource && !hasSourceAboveThreshold()) {
          return { ok: false, error: `当前无高于${sourceThreshold}点可转移灵根，需先将${rootLabel(targetRoot)}对应淬炼补正提升至15` };
        }
        return { ok: false, error: '当前条件下无法转换，请更换目标灵根后重试' };
      }

      setUsedCount(actualUsed);
      const targetAfterAll = readSpiritRootValue(player.base_spirit_roots, targetRoot, targetBeforeAll);
      const sourceParts = Object.entries(sourceRootCounter)
        .filter(([, moved]) => moved > 0)
        .map(([rk, moved]) => `${rootLabel(rk)}-${moved}`);
      const detailParts = [];
      if (sourceParts.length > 0) detailParts.push(sourceParts.join('，'));
      if (directAddedTotal > 0) detailParts.push(`无高于${sourceThreshold}点灵根时直升+${directAddedTotal}`);
      const detailText = detailParts.length > 0 ? detailParts.join('；') : '灵根已调整';
      const promoteText = promotedToPerfectCount > 0 ? '；与淬炼法叠加后补正至100' : '';
      resultMsgs.push(`使用${actualUsed}颗，${detailText}；${rootLabel(targetRoot)} ${targetBeforeAll}->${targetAfterAll}${promoteText}`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'stat_permanent_boost') {
      ensureOriginalBaseAttributes(player);
      const stat = String(eff.stat || '').trim();
      if (!STAT_KEYS.includes(stat)) return { ok: false, error: '无效的属性类型' };
      const boostPer = Math.max(0, Math.floor(Number(val) || 0));
      const maxVal = Math.floor(Number(eff.maxValue) || 999);
      const useAmt = requestedUseAmt;
      const cur = Math.max(0, Math.floor(Number(player.original_base_attributes[stat] ?? player[stat]) || 10));
      if (cur >= maxVal) continue;
      const totalBoost = Math.min(boostPer * useAmt, maxVal - cur);
      const actualUsed = boostPer > 0 ? Math.max(1, Math.ceil(totalBoost / boostPer)) : 0;
      if (actualUsed <= 0 || totalBoost <= 0) continue;
      player.original_base_attributes[stat] = cur + totalBoost;
      player[stat] = cur + totalBoost;
      setUsedCount(actualUsed);
      resultMsgs.push(`使用${actualUsed}颗，属性永久提高了${totalBoost}点`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'open_material_box') {
      const quality = Math.max(1, Math.min(8, Math.floor(Number(eff.quality ?? val) || 0)));
      const minCount = Math.max(1, Math.floor(Number(eff.minCount) || 1));
      const maxCount = Math.max(minCount, Math.floor(Number(eff.maxCount) || minCount));
      const useAmt = requestedUseAmt;

      const opened = _openMaterialBoxes(player, quality, minCount, maxCount, useAmt);
      if (!opened.ok) return { ok: false, error: opened.error || '开箱失败' };

      setUsedCount(useAmt);
      const dropText = (opened.drops || []).map(d => `${String(d.name || `材料${d.id}`)}x${Math.floor(Number(d.count) || 0)}`).join('，');
      resultMsgs.push(`开启${useAmt}个${quality}阶材料箱，获得${Math.floor(Number(opened.total) || 0)}个材料：${dropText}`);
      changed = true;
      continue;
    }
    if (et === 'timed_buff') {
      const useAmount = requestedUseAmt;
      if (useAmount <= 0) return { ok: false, error: '数量不足' };
      const buffKey = String(eff.buffType || '');
      const durationSecPerPill = Math.max(1, Math.min(24 * 3600, Math.floor(Number(eff.durationSec) || 0)));
      const durationRoundsPerPill = Math.max(0, Math.min(1000, Math.floor(Number(eff.durationRounds) || 0)));
      const totalDurationSec = durationSecPerPill * useAmount;
      const totalDurationRounds = durationRoundsPerPill * useAmount;
      if (!applyTimedBuff(player, buffKey, Number(val) || 0, totalDurationSec, totalDurationRounds)) {
        return { ok: false, error: 'BUFF参数无效' };
      }
      setUsedCount(useAmount);
      resultMsgs.push(`已服用${useAmount}颗，BUFF持续时间已延长`);
      changed = true;
      continue;
    }
    if (et === 'golden_equipment_tuner') {
      const slotType = parseGoldenTunerSlotType(useOpts);
      if (!slotType) {
        return { ok: false, error: '请输入装备部位数字：1武器 2头部 3肩部 4胸部 5腿部 6手部 7戒指 8项链 9披风' };
      }
      const equipBag = (player.equipment && typeof player.equipment === 'object') ? player.equipment : {};
      player.equipment = equipBag;
      const slotItemRaw = equipBag[slotType];
      if (!slotItemRaw) {
        return { ok: false, error: `${GOLDEN_TUNER_SLOT_LABELS[slotType] || slotType}未装备任何物品` };
      }
      const wrapped = slotItemRaw && typeof slotItemRaw === 'object' && slotItemRaw.item && typeof slotItemRaw.item === 'object';
      const targetEquipment = wrapped ? slotItemRaw.item : slotItemRaw;
      const tuned = maximizeEquipmentForGoldenTuner(targetEquipment);
      if (!tuned.ok || !tuned.equipment) {
        return { ok: false, error: tuned.error || '该目标无法使用黄金装备调整器' };
      }
      if (wrapped) slotItemRaw.item = tuned.equipment;
      else equipBag[slotType] = tuned.equipment;
      setUsedCount(1);
      resultMsgs.push(`${GOLDEN_TUNER_SLOT_LABELS[slotType] || slotType}装备已调整为白字满ROLL + 词缀T8满ROLL（EX倍率已保留）`);
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'learn_skill') {
      const sid = Number(val) || 0;
      if (sid <= 0) continue;
      const sl = player.skill_levels || {};
      if (sl[String(sid)]) {
        return { ok: false, error: '已学习过该技能' };
      }
      sl[String(sid)] = { level: 1, exp: 0 };
      player.skill_levels = sl;
      setUsedCount(1);
      resultMsgs.push('学习了技能');
      changed = true;
      continue;
    }
    if (et === 'learn_technique') {
      const tid = Number(val) || 0;
      if (tid <= 0) continue;
      const tl = player.technique_levels || {};
      if (tl[String(tid)]) return { ok: false, error: '已学习过该功法' };
      tl[String(tid)] = { level: 1, exp: 0 };
      player.technique_levels = tl;
      setUsedCount(1);
      resultMsgs.push('学习了功法');
      changed = true;
      combatDirty = true;
      continue;
    }
    if (et === 'learn_recipe') {
      const a = player.alchemy || {};
      const ur = a.unlocked_recipes || [];
      const rid = Number(val) || 0;
      if (rid > 0 && !ur.includes(rid)) ur.push(rid);
      a.unlocked_recipes = ur;
      player.alchemy = a;
      setUsedCount(1);
      resultMsgs.push('学会了配方');
      changed = true;
      continue;
    }
  }

  if (!changed || !usedCount || usedCount <= 0) {
    return { ok: false, error: '该物品暂无可生效的服务端实现，或当前已达使用上限' };
  }
  consumeFromSlot(usedCount);
  if (combatDirty) recalcAndAssignCombatStats(player);
  return { ok: true, player, used_count: usedCount, msg: resultMsgs.join('；') || `成功使用${usedCount}个` };
}

const MAX_EQUIPPED_SKILLS = 5;

function equipSkill(player, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const sid = Math.floor(Number(skillId) || 0);
  if (sid <= 0) return { ok: false, error: '无效技能ID' };

  const skill = (getSkills() || []).find(s => Number(s.id) === sid);
  if (!skill || !skill.id) return { ok: false, error: '技能不存在' };

  const sl = player.skill_levels || {};
  if (!sl[String(sid)] && !sl[sid]) return { ok: false, error: '未学习该技能' };

  let eq = (Array.isArray(player.equipped_skills) ? player.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (eq.includes(sid)) return { ok: false, error: '已装备该技能' };
  if (eq.length >= MAX_EQUIPPED_SKILLS) return { ok: false, error: '技能栏已满（最多5个）' };

  eq = [...eq, sid];
  player.equipped_skills = eq;
  return { ok: true, player };
}

function unequipSkill(player, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const sid = Math.floor(Number(skillId) || 0);
  if (sid <= 0) return { ok: false, error: '无效技能ID' };

  let eq = (Array.isArray(player.equipped_skills) ? player.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (!eq.includes(sid)) return { ok: false, error: '未装备该技能' };

  eq = eq.filter(id => id !== sid);
  player.equipped_skills = eq;
  if (Math.floor(Number(player.key_skill_id) || 0) === sid) {
    player.key_skill_id = 0;
  }
  return { ok: true, player };
}

function setKeySkill(player, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const sid = Math.floor(Number(skillId) || 0);
  if (sid <= 0) {
    player.key_skill_id = 0;
    return { ok: true, player };
  }
  const skill = (getSkills() || []).find(s => Number(s.id) === sid);
  if (!skill || !skill.id) return { ok: false, error: '技能不存在' };
  const eq = (Array.isArray(player.equipped_skills) ? player.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (!eq.includes(sid)) return { ok: false, error: '仅可将已装备技能设为KEY技能' };
  player.key_skill_id = sid;
  return { ok: true, player };
}

function setTechnique(player, slot, techniqueId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!['main', 'sub'].includes(String(slot))) return { ok: false, error: '无效槽位' };

  const tid = Math.floor(Number(techniqueId) || 0);
  const techs = player.techniques && typeof player.techniques === 'object' ? player.techniques : { main: null, sub: null };
  if (!techs.main) techs.main = null;
  if (!techs.sub) techs.sub = null;

  if (tid <= 0) {
    techs[slot] = null;
    player.techniques = techs;
    return { ok: true, player };
  }

  const technique = (getTechniques() || []).find(t => Number(t.id) === tid);
  if (!technique || !technique.id) return { ok: false, error: '功法不存在' };

  const tl = player.technique_levels || {};
  if (!tl[String(tid)] && !tl[tid]) return { ok: false, error: '未学习该功法' };

  const otherSlot = slot === 'main' ? 'sub' : 'main';
  const otherRaw = techs[otherSlot];
  const otherId = (otherRaw && typeof otherRaw === 'object' && otherRaw.id != null) ? Number(otherRaw.id) : Number(otherRaw) || 0;
  if (otherId === tid) return { ok: false, error: '主修与辅修不能使用同一门功法' };

  techs[slot] = { id: tid, name: technique.name || '功法' };
  player.techniques = techs;
  return { ok: true, player };
}

function setTalisman(player, itemId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  const tid = Math.floor(Number(itemId) || 0);
  if (tid <= 0) {
    player.equipped_talisman_id = 0;
    return { ok: true, player };
  }
  const item = getItemById(tid);
  if (!item || !item.id) return { ok: false, error: '符箓不存在' };
  if (String(item.type || '') !== 'talisman') return { ok: false, error: '该物品不是符箓' };
  player.inventory = ensureInventoryStructure(player.inventory || []);
  if (countItemInInventory(player.inventory, tid) <= 0) {
    return { ok: false, error: '背包中没有该符箓' };
  }
  player.equipped_talisman_id = tid;
  return { ok: true, player };
}

const VALID_PRESET_KEYS = ['grind', 'dungeon', 'duel'];

function ensureSkillPresets(player) {
  const needsInit = !player.skill_presets || typeof player.skill_presets !== 'object';
  if (needsInit) player.skill_presets = {};

  const sl = player.skill_levels || {};
  const seedEq = needsInit && Array.isArray(player.equipped_skills)
    ? player.equipped_skills.map(id => Math.floor(Number(id) || 0)).filter(id => id > 0 && (sl[String(id)] || sl[id]))
    : null;
  const seedKey = seedEq ? Math.floor(Number(player.key_skill_id) || 0) : 0;

  for (const k of VALID_PRESET_KEYS) {
    if (!player.skill_presets[k] || typeof player.skill_presets[k] !== 'object') {
      player.skill_presets[k] = seedEq
        ? { equipped_skills: [...seedEq], key_skill_id: seedKey }
        : { equipped_skills: [], key_skill_id: 0 };
    }
    const p = player.skill_presets[k];
    if (Array.isArray(p.equipped_skills)) {
      p.equipped_skills = p.equipped_skills
        .map(id => Math.floor(Number(id) || 0))
        .filter(id => id > 0 && (sl[String(id)] || sl[id]));
    }
    const kid = Math.floor(Number(p.key_skill_id) || 0);
    if (kid > 0 && !(sl[String(kid)] || sl[kid])) p.key_skill_id = 0;
    if (kid > 0 && Array.isArray(p.equipped_skills) && !p.equipped_skills.includes(kid)) p.key_skill_id = 0;
  }
}

function saveSkillPreset(player, preset, equippedSkills, keySkillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!VALID_PRESET_KEYS.includes(preset)) return { ok: false, error: '无效预设名称' };
  if (!Array.isArray(equippedSkills)) return { ok: false, error: '技能列表无效' };
  const sl = player.skill_levels || {};
  const skills = equippedSkills
    .map(id => Math.floor(Number(id) || 0))
    .filter(id => id > 0 && (sl[String(id)] || sl[id]));
  if (skills.length > MAX_EQUIPPED_SKILLS) return { ok: false, error: '技能数量超过上限' };
  const unique = [...new Set(skills)];
  const kid = Math.floor(Number(keySkillId) || 0);
  const finalKey = (kid > 0 && unique.includes(kid)) ? kid : 0;
  ensureSkillPresets(player);
  player.skill_presets[preset] = { equipped_skills: unique, key_skill_id: finalKey };
  return { ok: true, player };
}

function applySkillPreset(player, preset) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!VALID_PRESET_KEYS.includes(preset)) return { ok: false, error: '无效预设名称' };
  ensureSkillPresets(player);
  const p = player.skill_presets[preset];
  if (!p || !Array.isArray(p.equipped_skills) || p.equipped_skills.length === 0) {
    return { ok: false, error: '该预设尚未配置' };
  }
  const sl = player.skill_levels || {};
  const valid = p.equipped_skills
    .map(id => Math.floor(Number(id) || 0))
    .filter(id => id > 0 && (sl[String(id)] || sl[id]));
  player.equipped_skills = valid;
  const kid = Math.floor(Number(p.key_skill_id) || 0);
  player.key_skill_id = (kid > 0 && valid.includes(kid)) ? kid : 0;
  return { ok: true, player };
}

function presetEquipSkill(player, preset, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!VALID_PRESET_KEYS.includes(preset)) return { ok: false, error: '无效预设名称' };
  const sid = Math.floor(Number(skillId) || 0);
  if (sid <= 0) return { ok: false, error: '无效技能ID' };
  const skill = (getSkills() || []).find(s => Number(s.id) === sid);
  if (!skill || !skill.id) return { ok: false, error: '技能不存在' };
  const sl = player.skill_levels || {};
  if (!sl[String(sid)] && !sl[sid]) return { ok: false, error: '未学习该技能' };
  ensureSkillPresets(player);
  const p = player.skill_presets[preset];
  let eq = (Array.isArray(p.equipped_skills) ? p.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (eq.includes(sid)) return { ok: false, error: '已装备该技能' };
  if (eq.length >= MAX_EQUIPPED_SKILLS) return { ok: false, error: '技能栏已满（最多5个）' };
  p.equipped_skills = [...eq, sid];
  return { ok: true, player };
}

function presetUnequipSkill(player, preset, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!VALID_PRESET_KEYS.includes(preset)) return { ok: false, error: '无效预设名称' };
  const sid = Math.floor(Number(skillId) || 0);
  if (sid <= 0) return { ok: false, error: '无效技能ID' };
  ensureSkillPresets(player);
  const p = player.skill_presets[preset];
  let eq = (Array.isArray(p.equipped_skills) ? p.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (!eq.includes(sid)) return { ok: false, error: '未装备该技能' };
  p.equipped_skills = eq.filter(id => id !== sid);
  if (Math.floor(Number(p.key_skill_id) || 0) === sid) p.key_skill_id = 0;
  return { ok: true, player };
}

function presetSetKeySkill(player, preset, skillId) {
  if (!player) return { ok: false, error: '无玩家数据' };
  if (!VALID_PRESET_KEYS.includes(preset)) return { ok: false, error: '无效预设名称' };
  const sid = Math.floor(Number(skillId) || 0);
  ensureSkillPresets(player);
  const p = player.skill_presets[preset];
  if (sid <= 0) { p.key_skill_id = 0; return { ok: true, player }; }
  const skill = (getSkills() || []).find(s => Number(s.id) === sid);
  if (!skill || !skill.id) return { ok: false, error: '技能不存在' };
  const eq = (Array.isArray(p.equipped_skills) ? p.equipped_skills : [])
    .map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
  if (!eq.includes(sid)) return { ok: false, error: '仅可将已装备技能设为主技' };
  p.key_skill_id = sid;
  return { ok: true, player };
}

/** 尝试应用技能预设：若预设已配置则应用并返回 true，否则不修改并返回 false（不报错） */
function tryApplySkillPresetForBattle(player, preset) {
  if (!player || !VALID_PRESET_KEYS.includes(preset)) return false;
  ensureSkillPresets(player);
  const p = player.skill_presets[preset];
  if (!p || !Array.isArray(p.equipped_skills) || p.equipped_skills.length === 0) return false;
  const sl = player.skill_levels || {};
  const valid = p.equipped_skills
    .map(id => Math.floor(Number(id) || 0))
    .filter(id => id > 0 && (sl[String(id)] || sl[id]));
  if (valid.length === 0) return false;
  const kid = Math.floor(Number(p.key_skill_id) || 0);
  const nextKeySkillId = (kid > 0 && valid.includes(kid)) ? kid : 0;
  const currentEquipped = Array.isArray(player.equipped_skills)
    ? player.equipped_skills.map(id => Math.floor(Number(id) || 0)).filter(id => id > 0)
    : [];
  const currentKeySkillId = Math.floor(Number(player.key_skill_id) || 0);

  let changed = currentKeySkillId !== nextKeySkillId;
  if (!changed) {
    if (currentEquipped.length !== valid.length) {
      changed = true;
    } else {
      for (let i = 0; i < valid.length; i += 1) {
        if (currentEquipped[i] !== valid[i]) {
          changed = true;
          break;
        }
      }
    }
  }

  if (!changed) return false;
  player.equipped_skills = valid;
  player.key_skill_id = nextKeySkillId;
  return true;
}

Object.assign(module.exports, {
  levelUp,
  equip,
  unequip,
  stripInvalidEquipment,
  sanitizeEquipmentAffixesByQualityTier,
  stripInvalidSectSkills,
  cleanupOrphanedSkillCooldowns,
  breakthrough,
  useItem,
  equipSkill,
  unequipSkill,
  setKeySkill,
  setTalisman,
  setTechnique,
  applyAutoLevelUps,
  computeGrowthForLevelUp,
  recalcStatsForLevel,
  putItemInInventory,
  ensureInventoryStructure,
  sortInventory,
  setEquipmentLock,
  consumeItemFromInventory,
  cleanupTimedBuffs,
  cleanupAllianceBuffs,
  getEnlightenmentExpMult,
  getTimedBuffValue,
  consumeAbnormalGainRepay,
  consumeTimedBuffRounds,
  sellItem,
  decomposeEquipment,
  grantTalentPointsForLevel,
  unlockTalentNode,
  resetTalentNodes,
  saveSkillPreset,
  applySkillPreset,
  tryApplySkillPresetForBattle,
  ensureSkillPresets,
  presetEquipSkill,
  presetUnequipSkill,
  presetSetKeySkill,
  getSlotItem,
  sanitizeExpBuffOnLogin
});
