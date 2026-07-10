/**
 * 试炼系统 API
 * POST /trial/start   — 开始问心试炼
 * POST /trial/advance — 推进试炼战斗
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const settlementLock = require('../game/settlementLock');
const engine = require('../game/dungeonBattleEngine');
const { checkCommandRate, getCommandDelay } = require('../game/commandRateLimit');
const ops = require('../game/playerOps');
const { getItemById, getDungeons, getSkillById, getTechniqueById } = require('../game/dataLoader');
const {
  getTrialContractDefinitions,
  getTrialContractMaxScore,
  calcTrialCoinReward,
  buildTrialContractDungeonBands
} = require('../game/trialContracts');

router.use(authMiddleware);
router.use(async (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return next();
  let lockLease = null;
  try {
    lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:trial:write' });
  } catch (e) {
    console.error('[trial/lock] acquire error:', e?.message || e);
    return res.status(500).json({ ok: false, error: '服务繁忙，请稍后重试' });
  }
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    settlementLock.releaseAsync(req.accountId, lockLease).catch(() => {});
  };
  res.on('finish', release);
  res.on('close', release);
  next();
});

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function nowSec() { return Math.floor(Date.now() / 1000); }
function pct(v) {
  const n = Number(v) || 0;
  return `${Math.round(n * 100)}%`;
}

function fmtSkillEffect(effect = {}) {
  const t = String(effect.type || '');
  if (!t) return '';
  if (t === 'damage_percent_range') {
    const s = `造成${pct(effect.minValue)}~${pct(effect.maxValue)}法术伤害`;
    return Number(effect.ignoreSpellDefense) > 0
      ? `${s}（无视${pct(effect.ignoreSpellDefense)}法防）`
      : s;
  }
  if (t === 'damage_percent_plus_agility_multi') {
    const base = `造成（物攻${pct(effect.value)}+身法${pct(effect.agilityCoeff)}）物理伤害x${Math.max(1, Number(effect.count) || 3)}`;
    return Number(effect.perHitGrowth) > 0 ? `${base}（每击递增${pct(effect.perHitGrowth)}）` : base;
  }
  if (t === 'gain_temp_shield_max_hp_percent') {
    const pvpPart = effect.pvpValue != null ? `（PVP ${pct(effect.pvpValue)}）` : '';
    return `获得最大生命${pct(effect.value)}的临时护盾${pvpPart}`;
  }
  return '';
}

function fmtTechniqueEffect(effect = {}) {
  const t = String(effect.type || '');
  if (t === 'on_deal_damage_mana_burn') {
    const pve = pct(effect.value ?? effect.mpBurnPct ?? 0);
    const pvp = pct(effect.pvpValue ?? effect.pvpMpBurnPct ?? effect.value ?? 0);
    return `造成伤害时削减目标法力${pve}并追加等量伤害（PVP：削减${pvp}并追加等量法术伤害）`;
  }
  return '';
}

function buildBookEffectText(item = {}) {
  const effects = Array.isArray(item.effects) ? item.effects : [];
  const parts = [];
  for (const eff of effects) {
    const t = String(eff?.type || '');
    if (t === 'learn_skill') {
      const skillId = Number(eff?.value) || 0;
      const sk = getSkillById(skillId);
      if (!sk || !sk.id) continue;
      const effectText = String(sk.description || '').trim() || fmtSkillEffect((Array.isArray(sk.effects) ? sk.effects[0] : {}) || {});
      const cd = Number(sk.cooldown) > 0 ? `，冷却${Number(sk.cooldown)}回合` : '';
      parts.push(`技能【${String(sk.name || skillId)}】：${effectText}${cd}`);
      continue;
    }
    if (t === 'learn_technique') {
      const techId = Number(eff?.value) || 0;
      const tech = getTechniqueById(techId);
      if (!tech || !tech.id) continue;
      const effectText = String(tech.description || '').trim() || fmtTechniqueEffect((Array.isArray(tech.effects) ? tech.effects[0] : {}) || {});
      parts.push(`功法【${String(tech.name || techId)}】：${effectText}`);
    }
  }
  return parts.join('；');
}

const TRIAL_COOLDOWN_SEC = 1800; // 30 min
const TRIAL_COIN_SHOP = [
  // 固定技能/功法书池：试炼商店不出售材料类商品
  { id: 'tc_book_221', item_id: 221, count: 1, cost: 250, desc: '《寂灭》 x1' },
  { id: 'tc_book_222', item_id: 222, count: 1, cost: 350, desc: '《狂澜》 x1' },
  { id: 'tc_book_223', item_id: 223, count: 1, cost: 200, desc: '《御天之气》 x1' },
  { id: 'tc_book_233', item_id: 233, count: 1, cost: 450, desc: '《落星指》 x1' },
  { id: 'tc_book_234', item_id: 234, count: 1, cost: 450, desc: '《爆燃术》 x1' },
  { id: 'tc_book_220', item_id: 220, count: 1, cost: 350, desc: '《夺灵法》 x1' },
  { id: 'tc_book_231', item_id: 231, count: 1, cost: 550, desc: '《目牛术》 x1' },
  { id: 'tc_book_232', item_id: 232, count: 1, cost: 550, desc: '《护体神光》 x1' },
  { id: 'tc_book_235', item_id: 235, count: 1, cost: 550, desc: '《魔神诀》 x1' },
  { id: 'tc_book_237', item_id: 237, count: 1, cost: 700, desc: '《镇岳》 x1' },
  { id: 'tc_book_238', item_id: 238, count: 1, cost: 800, desc: '《波涛意》 x1' },
  { id: 'tc_book_224', item_id: 224, count: 1, cost: 550, desc: '《岿然》 x1' },
  { id: 'tc_book_225', item_id: 225, count: 1, cost: 300, desc: '《荡魔》 x1' },
  { id: 'tc_book_226', item_id: 226, count: 1, cost: 1500, desc: '《命之法则》 x1' },
  { id: 'tc_book_227', item_id: 227, count: 1, cost: 800, desc: '《神象镇狱功》 x1' },
  { id: 'tc_book_228', item_id: 228, count: 1, cost: 1500, desc: '《逆命法则》 x1' },
  { id: 'tc_book_229', item_id: 229, count: 1, cost: 1500, desc: '《体之法则》 x1' },
  { id: 'tc_book_230', item_id: 230, count: 1, cost: 1500, desc: '《灵之法则》 x1' }
];

const activeTrials = new Map();
const TRIAL_ADVANCE_EVENT_LIMIT = (() => {
  const env = Number(process.env.TRIAL_ADVANCE_EVENT_LIMIT);
  if (Number.isFinite(env) && env >= 20) return Math.min(200, Math.floor(env));
  return 60;
})();
const COMMAND_MAX_QUEUE_WAIT_MS = (() => {
  const env = Number(process.env.COMMAND_MAX_QUEUE_WAIT_MS);
  if (Number.isFinite(env) && env >= 0) return Math.min(2000, Math.floor(env));
  return 120;
})();

function _isLiteStateRequested(req) {
  const mode = String(req?.query?.state || '').trim().toLowerCase();
  return mode === 'lite' || mode === 'compact';
}

function _toUnitLite(unit) {
  if (!unit || typeof unit !== 'object') return null;
  return {
    tag: unit.tag,
    name: String(unit.name || '?'),
    level: intVal(unit.level, 1),
    alive: !!unit.alive,
    hp: intVal(unit.hp, 0),
    max_hp: Math.max(1, intVal(unit.max_hp, 1)),
    mp: intVal(unit.mp, 0),
    max_mp: Math.max(0, intVal(unit.max_mp, 0))
  };
}

function _stateToClientLite(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    dungeon_name: String(state.dungeon_name || ''),
    current_wave: intVal(state.current_wave, 0),
    total_waves: Math.max(1, intVal(state.total_waves, 1)),
    round: Math.max(1, intVal(state.round, 1)),
    turn_queue: Array.isArray(state.turn_queue) ? state.turn_queue.slice(0, 12) : [],
    allies: (Array.isArray(state.allies) ? state.allies : []).map(_toUnitLite).filter(Boolean),
    enemies: (Array.isArray(state.enemies) ? state.enemies : []).map(_toUnitLite).filter(Boolean)
  };
}

function _stateToClientByMode(state, lite) {
  if (lite) return _stateToClientLite(state);
  return engine.stateToClient(state);
}
setInterval(() => {
  const now = Date.now();
  for (const [id, b] of activeTrials) {
    if (now - b.created_at > 30 * 60 * 1000) activeTrials.delete(id);
  }
}, 5 * 60 * 1000);

function _buildHeartDemon(player) {
  const str = intVal(player.strength, 10);
  const con = intVal(player.constitution, 10);
  const bone = intVal(player.bone, 10);
  const zhenyuan = intVal(player.zhenyuan, 10);
  const boneMult = 1.0 + (bone / 300.0) * 0.01;
  const avgAtk = Math.floor(str * 0.75 * boneMult);
  const defense = Math.floor(con * 0.25 * boneMult);
  const spellAtk = Math.floor(zhenyuan * 0.8 * boneMult);
  const spellDef = Math.floor(zhenyuan * 0.2 * boneMult);
  const maxHp = Math.floor(con * 5 * boneMult);
  const maxMp = Math.floor(zhenyuan * 3 * boneMult);
  const agility = Math.max(0, intVal(player.agility, 0));
  return {
    id: 35, name: '心魔', type: 'spirit', level: intVal(player.level, 1),
    hp: maxHp, attack: avgAtk, defense,
    spellAttack: spellAtk, spellDefense: spellDef,
    agility, mp: maxMp,
    exp: 0, drops: [],
    skills: [28],
    skill_levels: { '28': { level: Math.max(1, Math.floor(intVal(player.level, 1) / 40)) } }
  };
}

router.get('/contracts', (_req, res) => {
  const maxScore = getTrialContractMaxScore(6);
  const dungeonBands = buildTrialContractDungeonBands(getDungeons());
  const maxDungeonMultiplier = dungeonBands.reduce((m, b) => Math.max(m, Number(b.multiplier) || 1), 1);
  const maxSingleRunCoins = calcTrialCoinReward(maxScore, maxDungeonMultiplier);
  return res.json({
    ok: true,
    modifiers: getTrialContractDefinitions(),
    max_score: maxScore,
    max_single_run_coins: maxSingleRunCoins,
    dungeon_reward_multipliers: dungeonBands.map((b) => ({
      dungeon_id: Number(b.dungeonId) || 0,
      dungeon_name: String(b.name || ''),
      level_min: Number(b.levelMin) || 1,
      multiplier: Number(b.multiplier) || 1,
      index: Number(b.index) || 0,
      total: Number(b.total) || 1
    }))
  });
});

router.get('/shop', (_req, res) => {
  const goods = TRIAL_COIN_SHOP
    .map((g) => {
      const item = getItemById(Number(g.item_id) || 0);
      if (!item || !item.id) return null;
      return {
        id: String(g.id),
        item_id: Number(g.item_id) || 0,
        item_name: String(item.name || g.desc || '未知道具'),
        count: Math.max(1, Number(g.count) || 1),
        cost: Math.max(1, Number(g.cost) || 1),
        desc: String(g.desc || ''),
        effect_text: buildBookEffectText(item)
      };
    })
    .filter(Boolean);
  return res.json({ ok: true, goods });
});

router.post('/shop/buy', async (req, res) => {
  const shopId = String(req.body?.item_id || '').trim();
  const quantity = Math.max(1, Math.min(200, Number(req.body?.quantity) || 1));
  const cfg = TRIAL_COIN_SHOP.find((g) => String(g.id) === shopId);
  if (!cfg) return res.json({ ok: false, error: '无效商品' });

  const item = getItemById(Number(cfg.item_id) || 0);
  if (!item || !item.id) return res.json({ ok: false, error: '商品配置缺失道具' });

  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });

  const totalCost = Math.max(1, Number(cfg.cost) || 1) * quantity;
  const ownCoins = Math.max(0, Number(player.trial_coins) || 0);
  if (ownCoins < totalCost) return res.json({ ok: false, error: `试炼币不足，需要${totalCost}` });

  const totalCount = Math.max(1, Number(cfg.count) || 1) * quantity;
  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const okPut = ops.putItemInInventory(player.inventory, item, totalCount);
  if (!okPut) return res.json({ ok: false, error: '背包空间不足' });

  player.trial_coins = ownCoins - totalCost;
  await db.savePlayer(req.accountId, 1, player);
  return res.json({
    ok: true,
    player,
    bought: {
      item_id: Number(item.id),
      item_name: String(item.name || ''),
      count: totalCount,
      spent: totalCost
    }
  });
});

router.post('/start', async (req, res) => {
  try {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  if (intVal(player.level, 1) < 240) return res.json({ ok: false, error: '问心试炼需元婴大圆满（等级≥240）方可挑战' });

  const lastComplete = intVal(player.heart_trial_last_complete, 0);
  const cur = nowSec();
  if (lastComplete > 0 && (cur - lastComplete) < TRIAL_COOLDOWN_SEC) {
    const remain = TRIAL_COOLDOWN_SEC - (cur - lastComplete);
    return res.json({ ok: false, error: `试炼冷却中，剩余${Math.floor(remain / 60)}分${remain % 60}秒` });
  }

  const demon1 = _buildHeartDemon(player);
  const demon2 = _buildHeartDemon(player);
  const waves = [[demon1], [demon2]];
  const dungeon = { id: 9999, name: '问心试炼' };
  const fullPlayer = structuredClone(player);
  const maxHp = Math.max(1, intVal(fullPlayer.max_hp, intVal(fullPlayer.hp, 1)));
  const maxMp = Math.max(0, intVal(fullPlayer.max_mp, intVal(fullPlayer.mp, 0)));
  fullPlayer.hp = maxHp;
  fullPlayer.mp = maxMp;
  const state = engine.createDungeonBattle(dungeon, [fullPlayer], waves);
  const battleId = crypto.randomUUID();
  activeTrials.set(battleId, { state, account_id: req.accountId, created_at: Date.now() });
  return res.json({ ok: true, battle_id: battleId, state: engine.stateToClient(state) });
  } catch (err) {
    console.error('[trial/start] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '试炼初始化异常' });
  }
});

router.post('/advance', async (req, res) => {
  const _delay = getCommandDelay(req.accountId);
  if (_delay > COMMAND_MAX_QUEUE_WAIT_MS) {
    return _respondTrialAdvanceThrottled(req, res, _delay);
  }
  if (_delay > 0) return setTimeout(() => _handleTrialAdvance(req, res), _delay);
  return _handleTrialAdvance(req, res);
});

function _respondTrialAdvanceThrottled(req, res, delayMs) {
  const liteState = _isLiteStateRequested(req);
  const { battle_id } = req.body || {};
  if (!battle_id) {
    return res.json({
      ok: false,
      error: '缺少 battle_id',
      code: 'TRIAL_ADVANCE_THROTTLED',
      retry_after_ms: Math.floor(Number(delayMs) || 0)
    });
  }
  const battle = activeTrials.get(battle_id);
  if (!battle || battle.account_id !== req.accountId) {
    return res.json({ ok: false, error: '试炼无效或已过期' });
  }
  return res.json({
    ok: true,
    throttled: true,
    retry_after_ms: Math.floor(Number(delayMs) || 0),
    ended: false,
    victory: false,
    draw: false,
    state: _stateToClientByMode(battle.state, liteState),
    events: []
  });
}

async function _handleTrialAdvance(req, res) {
  try {
  const liteState = _isLiteStateRequested(req);
  const { battle_id } = req.body || {};
  if (!battle_id) return res.json({ ok: false, error: '缺少 battle_id' });
  const battle = activeTrials.get(battle_id);
  if (!battle || battle.account_id !== req.accountId) return res.json({ ok: false, error: '试炼无效或已过期' });

  let result;
  try {
    result = engine.advanceTurn(battle.state);
  } catch (advErr) {
    const st = (battle && battle.state && typeof battle.state === 'object') ? battle.state : {};
    const queueLen = Array.isArray(st.turn_queue) ? st.turn_queue.length : -1;
    const allyLen = Array.isArray(st.allies) ? st.allies.length : -1;
    const enemyLen = Array.isArray(st.enemies) ? st.enemies.length : -1;
    console.error('[trial/advance] advanceTurn 内部异常 battle=%s account=%s round=%s wave=%s queue=%s allies=%s enemies=%s: %s\n%s',
      String(battle_id || ''),
      String(req.accountId || ''),
      String(st.round || 0),
      String(st.current_wave || 0),
      String(queueLen),
      String(allyLen),
      String(enemyLen),
      advErr?.message || advErr,
      advErr?.stack || ''
    );
    activeTrials.delete(battle_id);
    return res.json({
      ok: true, ended: true, victory: false, draw: false,
      state: null,
      events: [{ t: 'system', text: '试炼状态异常，已自动终止。' }]
    });
  }
  if (!result.ok) return res.json(result);
  battle.state = result.state;

  if (result.ended) {
    activeTrials.delete(battle_id);
    const player = await db.getPlayerByAccountId(req.accountId);
    if (player && result.victory) {
      player.breakthrough_heart_trial_passed = true;
      player.heart_trial_last_complete = nowSec();
      await db.savePlayer(req.accountId, 1, player);
    } else if (player) {
      player.heart_trial_last_complete = nowSec();
      await db.savePlayer(req.accountId, 1, player);
    }
  }

  const rawEvents = Array.isArray(result.events) ? result.events : [];
  const events = rawEvents.length > TRIAL_ADVANCE_EVENT_LIMIT
    ? rawEvents.slice(rawEvents.length - TRIAL_ADVANCE_EVENT_LIMIT)
    : rawEvents;
  if (rawEvents.length > TRIAL_ADVANCE_EVENT_LIMIT) {
    events.unshift({ t: 'system', text: '战斗日志过长，本次仅展示最新片段。' });
  }

  return res.json({
    ok: true,
    state: _stateToClientByMode(result.state, liteState),
    events,
    ended: Boolean(result.ended),
    victory: Boolean(result.victory),
    draw: Boolean(result.draw)
  });
  } catch (err) {
    console.error('[trial/advance] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '试炼推进异常' });
  }
}

module.exports = router;
