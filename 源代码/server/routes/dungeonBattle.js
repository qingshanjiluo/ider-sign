/**
 * 副本多人战斗 API
 * POST /dungeon-battle/start   — 创建副本战斗 (支持组队)
 * POST /dungeon-battle/advance — 推进一步 (服务端处理下一个行动者)
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const settlementLock = require('../game/settlementLock');
const { getDungeonById, getDungeonEnemyById, getSectById, getItemById, getItems, getSkillById, getDungeons } = require('../game/dataLoader');
const { rollEquipmentFromTemplateItem, getPlayerAffixQualityCap } = require('../game/equipmentGen');
const { buildPlayerSnapshot, applyDebuff, recalcAndAssignCombatStats } = require('../game/combatUtils');
const { settleKillTaskProgress } = require('./online');
const CD = require('../game/combatDamage');
const ops = require('../game/playerOps');
const cave = require('../game/cave');
const engine = require('../game/dungeonBattleEngine');
const { touchActivity } = require('../game/universalTime');
const dungeonBattleCache = require('../game/dungeonBattleCache');
const { getNextSettlementTs, getCurrentPeriodIndex, pickPeriodReward } = require('../game/duelRankSeason');
const { checkCommandRate, getCommandDelay } = require('../game/commandRateLimit');
const {
  normalizeSelectedTrialContracts,
  calcTrialContractSummary,
  applyTrialContractsToEnemy,
  applyTrialContractsToBattleState,
  calcTrialCoinReward,
  getTrialContractDungeonMultiplier
} = require('../game/trialContracts');

router.use(authMiddleware);
router.use(async (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return next();
  let lockLease = null;
  try {
    lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:dungeonBattle:write' });
  } catch (e) {
    console.error('[dungeon-battle/lock] acquire error:', e?.message || e);
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

db.cleanupExpiredDungeonBattles().catch(e => console.error('[dungeonBattle] cleanup error:', e));
setInterval(() => db.cleanupExpiredDungeonBattles().catch(() => {}), 5 * 60 * 1000);

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

const DUNGEON_ADVANCE_EVENT_LIMIT = (() => {
  const env = Number(process.env.DUNGEON_ADVANCE_EVENT_LIMIT);
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
    battle_mode: String(state.battle_mode || 'dungeon'),
    dungeon_mode: String(state.dungeon_mode || 'normal'),
    challenge_mode: String(state.challenge_mode || 'normal'),
    dungeon_name: String(state.dungeon_name || ''),
    current_wave: intVal(state.current_wave, 0),
    total_waves: Math.max(1, intVal(state.total_waves, 1)),
    round: Math.max(1, intVal(state.round, 1)),
    turn_queue: Array.isArray(state.turn_queue) ? state.turn_queue.slice(0, 12) : [],
    duel_challenger_sect_name: String(state.duel_challenger_sect_name || ''),
    duel_target_sect_name: String(state.duel_target_sect_name || ''),
    allies: (Array.isArray(state.allies) ? state.allies : []).map(_toUnitLite).filter(Boolean),
    enemies: (Array.isArray(state.enemies) ? state.enemies : []).map(_toUnitLite).filter(Boolean)
  };
}

function _stateToClientByMode(state, lite) {
  if (lite) return _stateToClientLite(state);
  return engine.stateToClient(state);
}

function getDateKeySafe() {
  if (typeof db.getDateKey === 'function') {
    const k = String(db.getDateKey() || '').trim();
    if (k) return k;
  }
  const d = new Date();
  d.setMinutes(d.getMinutes() + 480);
  return d.toISOString().slice(0, 10);
}

function calcRestTime(level) {
  const lv = Number(level) || 1;
  if (lv <= 120) return 5;
  if (lv <= 160) return 10;
  if (lv <= 200) return 15;
  if (lv <= 240) return 20;
  return 25;
}

function clampRestUntil(player, nowSec) {
  if (!player || typeof player !== 'object') return 0;
  const now = intVal(nowSec, Math.floor(Date.now() / 1000));
  const maxRest = calcRestTime(Number(player.level) || 1);
  const raw = intVal(player.rest_until, 0);
  if (raw <= now) return 0;
  return Math.min(raw, now + maxRest);
}

function _getSkillLevel(unit, skillId) {
  const d = unit?.skill_levels?.[String(skillId)];
  if (d && typeof d === 'object') return Math.max(1, intVal(d.level, 1));
  return Math.max(1, intVal(d, 1));
}

function _pickRandomAlive(arr) {
  const alive = (arr || []).filter(u => u && u.alive && Number(u.hp) > 0);
  if (alive.length <= 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

function _calcFireballDamageOnTarget(state, caster, target) {
  const skill = getSkillById(2);
  if (!skill || !skill.id || !caster || !target) return 0;
  const lv = _getSkillLevel(caster, 2);
  const hits = CD.collectSkillDamageHits(skill, lv, state);
  const fallbackHits = hits.length > 0 ? hits : [{ mul: 1.05 + Math.max(0, lv - 1) * 0.05, isSpell: true, opts: {} }];
  let total = 0;
  for (const h of fallbackHits) {
    const res = CD.calcDamage(state, caster, target, 'skill', h.mul, h.isSpell, skill, lv, h.opts || {});
    total += Math.max(0, intVal(res.damage, 0));
  }
  return total;
}

function applyBattleStartTalismanToDungeonState(state, talismanUse) {
  if (!talismanUse?.used || !state || !Array.isArray(state.allies) || !Array.isArray(state.enemies)) return;
  const effects = Array.isArray(talismanUse.item?.effects) ? talismanUse.item.effects : [];
  const caster = state.allies[0] || null; // 当前仅主控角色装配符箓
  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    const type = String(eff.type || '');
    if (type === 'battle_start_apply_slow') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      const mult = Number.isFinite(Number(eff.speedMultiplier)) ? Number(eff.speedMultiplier) : 0.7;
      for (const e of state.enemies) {
        if (!e || !e.alive || Number(e.hp) <= 0) continue;
        e.slow_effect = { duration: dur, speedMultiplier: mult };
      }
    } else if (type === 'battle_start_apply_xurui_allies') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      for (const a of state.allies) {
        if (!a || !a.alive || Number(a.hp) <= 0) continue;
        a.xurui = { active: true, duration: dur };
      }
    } else if (type === 'battle_start_boost_hp_max_allies') {
      const pct = Math.max(0, Number(eff.value) || 0.05);
      for (const a of state.allies) {
        if (!a || !a.alive || Number(a.hp) <= 0) continue;
        const gain = Math.max(1, Math.floor(Math.max(1, Number(a.max_hp) || 1) * pct));
        a.max_hp = Math.max(1, intVal(a.max_hp, 1) + gain);
        a.hp = Math.max(1, intVal(a.hp, 1) + gain);
      }
    } else if (type === 'battle_start_apply_chanfu_enemies') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      const dmgPct = Math.max(0, Number(eff.damagePercent) || 0.16);
      for (const e of state.enemies) {
        if (!e || !e.alive || Number(e.hp) <= 0) continue;
        applyDebuff(e, { type: 'chanfu', stacks: dur, damagePercent: dmgPct, attribute: 'spell_attack' }, state, caster);
      }
    } else if (type === 'battle_start_cast_fireball') {
      const target = _pickRandomAlive(state.enemies);
      if (!target || !caster) continue;
      const dmg = _calcFireballDamageOnTarget(state, caster, target);
      if (dmg > 0) {
        target.hp = Math.max(0, intVal(target.hp, 0) - dmg);
        if (target.hp <= 0) target.alive = false;
      }
    }
  }
}

const CATALYST_ITEM_IDS = [27, 69, 71, 44, 45, 54, 133];
const EQUIP_TYPES = new Set(['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);
const FORMATION_RUNE_ITEM_IDS = [208, 209, 210, 211, 212, 213, 214, 215];

function pick(arr) {
  if (!Array.isArray(arr) || arr.length <= 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(minV, maxV) {
  const lo = Math.min(intVal(minV, 0), intVal(maxV, 0));
  const hi = Math.max(intVal(minV, 0), intVal(maxV, 0));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function clone(v) {
  return structuredClone(v);
}

function addDropItem(player, item, count, drops) {
  if (!item || !item.id) return false;
  const c = Math.max(1, intVal(count, 1));
  const placed = ops.putItemInInventory(player.inventory, clone(item), c);
  if (!placed) return false;
  const eid = intVal(item.id, 0);
  const idx = drops.findIndex(d => intVal(d.item_id, 0) === eid);
  if (idx >= 0) {
    drops[idx].count = intVal(drops[idx].count, 0) + c;
  } else {
    drops.push({ item_id: eid, item_name: String(item.name || '未知物品'), count: c });
  }
  return true;
}

function addFormationDropItem(player, item, count, drops, nowSec = Math.floor(Date.now() / 1000)) {
  if (!item || !item.id) return false;
  const c = Math.max(1, intVal(count, 1));
  const stored = cave.addFormationItems(player, clone(item), c, nowSec);
  if (!stored?.ok || intVal(stored.added, 0) <= 0) return false;
  const eid = intVal(item.id, 0);
  const name = String(item.name || '阵纹');
  const idx = drops.findIndex(d => intVal(d.item_id, 0) === eid && String(d.item_name || '') === name);
  if (idx >= 0) {
    drops[idx].count = intVal(drops[idx].count, 0) + intVal(stored.added, 0);
  } else {
    drops.push({ item_id: eid, item_name: name, count: intVal(stored.added, 0) });
  }
  return true;
}

function buildDungeonClearDrops(dungeonQuality, player, dropMult = 1) {
  const mult = Math.max(1, intVal(dropMult, 1));
  const q = Math.max(1, intVal(dungeonQuality, 1));
  const items = getItems() || [];
  const drops = [];

  // 1) 同阶材料：2~4种，每种2~4个；7阶及以上材料不进入副本池；invite_shop_only 仅邀请商店产出
  const materialPool = items.filter(it => {
    if (!it || !it.id) return false;
    const tags = Array.isArray(it.tags) ? it.tags : [];
    if (tags.includes('invite_shop_only')) return false;
    const t = String(it.type || '');
    const iq = intVal(it.quality, 1);
    if (!['material', 'herb', 'medicine'].includes(t)) return false;
    if (iq !== q || iq >= 7) return false;
    if (CATALYST_ITEM_IDS.includes(intVal(it.id, 0))) return false;
    return true;
  });
  if (materialPool.length > 0) {
    const kindCount = Math.min(materialPool.length, randomInt(2, 4));
    const bag = materialPool.slice();
    for (let i = 0; i < kindCount; i += 1) {
      const idx = Math.floor(Math.random() * bag.length);
      const item = bag[idx];
      bag.splice(idx, 1);
      addDropItem(player, item, Math.max(1, randomInt(2, 4) * mult), drops);
    }
  }

  // 2) 50% 概率掉落 1~2 件同阶制式装备（随机生成词条）
  if (Math.random() < 0.5) {
    const equipPool = items.filter(it => {
      if (!it || !it.id) return false;
      if (!EQUIP_TYPES.has(String(it.type || ''))) return false;
      if (intVal(it.quality, 1) !== q) return false;
      if (Boolean(it.isEx)) return false;
      const tags = Array.isArray(it.tags) ? it.tags : [];
      if (tags.includes('no_dungeon_loot')) return false;
      return true;
    });
    const affixCap = getPlayerAffixQualityCap(intVal(player.level, 1));
    const equipCount = Math.max(1, randomInt(1, 2) * mult);
    for (let i = 0; i < equipCount; i += 1) {
      const template = pick(equipPool);
      if (!template) break;
      const eq = rollEquipmentFromTemplateItem(template, affixCap) || template;
      addDropItem(player, eq, 1, drops);
    }
  }

  // 3) 阶级对应5阶以上催化剂副本：50%概率掉落0~3个同阶催化剂
  if (q >= 5) {
    const catalystPool = items.filter(it => {
      if (!it || !it.id) return false;
      if (!CATALYST_ITEM_IDS.includes(intVal(it.id, 0))) return false;
      const iq = intVal(it.quality, 1);
      return iq === q && iq >= 5 && iq < 7;
    });
    if (catalystPool.length > 0 && Math.random() < 0.5) {
      const cnt = Math.max(0, randomInt(0, 3) * mult);
      if (cnt > 0) addDropItem(player, pick(catalystPool), cnt, drops);
    }
  }

  return drops;
}

function resolveFormationRuneDropCountRangeByDungeon(dungeon) {
  const levelMin = Math.max(1, intVal(dungeon?.level_min, intVal(dungeon?.level_max, 1)));
  // 化神以下：1-2；炼虚以下：2-3；合体及以上：3-4
  if (levelMin >= 321) return { min: 3, max: 4 };
  if (levelMin >= 241) return { min: 2, max: 3 };
  return { min: 1, max: 2 };
}

function buildFormationDungeonRuneDrops(dungeon, player) {
  const range = resolveFormationRuneDropCountRangeByDungeon(dungeon);
  const count = randomInt(range.min, range.max);
  const drops = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const allItems = Array.isArray(getItems()) ? getItems() : [];
  let runePool = allItems.filter((it) => it && it.id && String(it.type || '') === 'array_rune');
  if (runePool.length <= 0) {
    runePool = FORMATION_RUNE_ITEM_IDS
      .map((id) => getItemById(intVal(id, 0)))
      .filter((it) => it && it.id && String(it.type || '') === 'array_rune');
  }
  if (runePool.length <= 0) {
    console.warn('[dungeon-battle] 阵法副本阵纹池为空，未发放阵纹掉落');
    return { drops };
  }

  for (let i = 0; i < count; i += 1) {
    const base = pick(runePool);
    if (!base) continue;
    const item = clone(base);
    addFormationDropItem(player, item, 1, drops, nowSec);
  }
  return { drops };
}

function buildFullStateBattlePlayerSource(player, accountId) {
  const p = player && typeof player === 'object' ? structuredClone(player) : {};
  const maxHp = Math.max(1, intVal(p.max_hp, intVal(p.hp, 1)));
  const maxMp = Math.max(0, intVal(p.max_mp, intVal(p.mp, 0)));
  p.hp = maxHp;
  p.mp = maxMp;
  p.account_id = intVal(accountId, 0);
  return p;
}

function clonePlayerWithBattlePreset(player, presetKey = '') {
  const source = player && typeof player === 'object' ? structuredClone(player) : {};
  const key = String(presetKey || '').trim();
  if (key) ops.tryApplySkillPresetForBattle(source, key);
  return source;
}

function createCityDuelEnemySnapshotFromPlayer(player, accountId) {
  const source = player && typeof player === 'object' ? structuredClone(player) : {};
  source.hp = Math.max(1, intVal(source.max_hp, intVal(source.hp, 1)));
  source.mp = Math.max(0, intVal(source.max_mp, intVal(source.mp, 0)));
  const snap = buildPlayerSnapshot(source, { skipInventory: true, battleMode: 'city_duel', isTeamBattle: false });
  return {
    ...snap,
    __snapshot_ready: true,
    id: Math.max(1, intVal(accountId, 0)),
    name: String(player?.name || `道友#${intVal(accountId, 0)}`),
    type: 'human',
    is_ally: false,
    alive: true
  };
}

function countItemInInventoryById(inv, itemId) {
  const targetId = intVal(itemId, 0);
  if (targetId <= 0) return 0;
  let total = 0;
  for (const page of inv || []) {
    if (!Array.isArray(page)) continue;
    for (const slot of page) {
      if (!slot || !slot.item) continue;
      if (intVal(slot.item.id, 0) !== targetId) continue;
      total += Math.max(1, intVal(slot.count, 1));
    }
  }
  return total;
}

function consumeBattleStartTalisman(player) {
  const equippedId = intVal(player?.equipped_talisman_id, 0);
  if (equippedId <= 0) return { used: false };
  const item = getItemById(equippedId);
  if (!item || !item.id || String(item.type || '') !== 'talisman') {
    player.equipped_talisman_id = 0;
    return { used: false };
  }
  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  if (countItemInInventoryById(player.inventory, equippedId) <= 0) return { used: false };
  const consumed = ops.consumeItemFromInventory(player.inventory, equippedId, 1);
  if (!consumed) return { used: false };
  return { used: true, item_id: equippedId, item_name: String(item.name || '符箓'), item };
}

let _duelListCache = null;
let _duelListCacheAt = 0;
const DUEL_LIST_TTL = 30;

async function _buildDuelList() {
  const now = Math.floor(Date.now() / 1000);
  if (_duelListCache && (now - _duelListCacheAt) < DUEL_LIST_TTL) return _duelListCache;
  const rows = await db.listPlayerBriefAll();
  const list = [];
  for (const row of rows || []) {
    const accountId = intVal(row?.account_id, 0);
    if (accountId <= 0) continue;
    const level = Math.max(1, intVal(row?.level, 1));
    const sectId = intVal(row?.sect_id, 0);
    const sect = sectId > 0 ? (getSectById(sectId) || {}) : {};
    list.push({
      account_id: accountId,
      name: String(row?.name || `道友#${accountId}`),
      level,
      sect_id: sectId,
      sect_name: String(sect?.name || '散修')
    });
  }
  list.sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  _duelListCache = list;
  _duelListCacheAt = now;
  return list;
}

router.get('/city_duel/list', async (req, res) => {
  const meId = intVal(req.accountId, 0);
  const page = Math.max(1, intVal(req.query?.page, 1));
  const pageSize = Math.max(10, Math.min(100, intVal(req.query?.page_size, 30)));
  const keywordRaw = String(req.query?.keyword || '').trim();
  const keyword = keywordRaw.toLowerCase();

  let list = (await _buildDuelList()).filter(e => e.account_id !== meId);
  if (keyword.length > 0) {
    list = list.filter((e) => {
      const name = String(e?.name || '').toLowerCase();
      const sectName = String(e?.sect_name || '').toLowerCase();
      const aid = String(intVal(e?.account_id, 0));
      return name.includes(keyword) || sectName.includes(keyword) || aid.includes(keywordRaw);
    });
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);

  return res.json({
    ok: true,
    list: paged,
    page: safePage,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    keyword: keywordRaw
  });
});

router.get('/city_duel/inspect', async (req, res) => {
  const targetId = intVal(req.query?.target_account_id, 0);
  if (targetId <= 0) return res.json({ ok: false, error: '无效目标' });
  const target = await db.getPlayerByAccountId(targetId);
  if (!target) return res.json({ ok: false, error: '目标玩家不存在' });
  recalcAndAssignCombatStats(target);
  const sectId = intVal(target?.sect_id, 0);
  const sect = sectId > 0 ? (getSectById(sectId) || {}) : {};
  const SLOTS = ['weapon','head','shoulder','chest','legs','hands','ring','amulet','back','talisman'];
  const equipment = {};
  for (const slot of SLOTS) {
    const item = target.equipment?.[slot];
    if (item) {
      equipment[slot] = {
        name: item.name || '未知',
        quality: item.quality || 1,
        subtype: item.subtype || '',
        minPhysDamage: item.minPhysDamage || 0,
        maxPhysDamage: item.maxPhysDamage || 0,
        minSpellDamage: item.minSpellDamage || 0,
        maxSpellDamage: item.maxSpellDamage || 0,
        physDefense: item.physDefense || 0,
        spellDefense: item.spellDefense || 0,
        maxHp: item.maxHp || 0,
        affixes: Array.isArray(item.affixes) ? item.affixes.map(a => ({
          stat: a.stat || '', name: a.name || '', value: a.value || 0,
          quality: a.quality || 1, tier: a.tier || 1
        })) : [],
        setId: item.setId || 0,
        setName: item.setName || ''
      };
    }
  }
  return res.json({
    ok: true,
    name: String(target.name || `道友#${targetId}`),
    level: intVal(target.level, 1),
    sect_name: String(sect?.name || '散修'),
    equipment,
    combat: {
      max_hp: target.max_hp || 0,
      max_mp: target.max_mp || 0,
      min_phys_damage: target.min_phys_damage || 0,
      max_phys_damage: target.max_phys_damage || 0,
      spell_attack: target.min_spell_attack || target.max_spell_attack || 0,
      phys_defense: target.phys_defense || 0,
      spell_defense: target.spell_defense || 0,
      crit_rate: target.crit_rate || 0.05,
      spell_crit_rate: target.spell_crit_rate || 0
    },
    attrs: {
      strength: intVal(target.strength, 0) + intVal(target.attr_bonus?.strength, 0),
      constitution: intVal(target.constitution, 0) + intVal(target.attr_bonus?.constitution, 0),
      bone: intVal(target.bone, 0) + intVal(target.attr_bonus?.bone, 0),
      zhenyuan: intVal(target.zhenyuan, 0) + intVal(target.attr_bonus?.zhenyuan, 0),
      lingli: intVal(target.lingli, 0) + intVal(target.attr_bonus?.lingli, 0),
      agility: intVal(target.agility, 0) + intVal(target.attr_bonus?.agility, 0)
    }
  });
});

router.get('/city_duel/logs', async (req, res) => {
  const page = Math.max(1, intVal(req.query?.page, 1));
  const pageSize = Math.max(1, Math.min(100, intVal(req.query?.page_size, 20)));
  const roleRaw = String(req.query?.role || 'all').toLowerCase();
  const role = (roleRaw === 'challenger' || roleRaw === 'target') ? roleRaw : 'all';
  const result = await db.listCityDuelLogsByAccount(req.accountId, { page, pageSize, role });
  const rows = Array.isArray(result?.list) ? result.list : [];
  const meId = intVal(req.accountId, 0);
  const list = (rows || []).map((r) => {
    const isChallenger = intVal(r.challenger_account_id, 0) === meId;
    const isTarget = intVal(r.target_account_id, 0) === meId;
    const selfWin = intVal(r.winner_account_id, 0) === meId;
    return {
      id: intVal(r.id, 0),
      created_at: intVal(r.created_at, 0),
      challenger_account_id: intVal(r.challenger_account_id, 0),
      target_account_id: intVal(r.target_account_id, 0),
      winner_account_id: intVal(r.winner_account_id, 0),
      challenger_name: String(r.challenger_name || ''),
      target_name: String(r.target_name || ''),
      challenger_level: intVal(r.challenger_level, 1),
      target_level: intVal(r.target_level, 1),
      challenger_sect_name: String(r.challenger_sect_name || '散修'),
      target_sect_name: String(r.target_sect_name || '散修'),
      role: isChallenger ? 'challenger' : (isTarget ? 'target' : 'viewer'),
      self_win: selfWin
    };
  });
  return res.json({
    ok: true,
    list,
    total: intVal(result?.total, 0),
    page: intVal(result?.page, page),
    page_size: intVal(result?.pageSize, pageSize),
    role
  });
});

let _duelRankCache = null;
let _duelRankCacheAt = 0;
const DUEL_RANK_TTL = 30;

async function _buildDuelRank() {
  const now = Math.floor(Date.now() / 1000);
  if (_duelRankCache && (now - _duelRankCacheAt) < DUEL_RANK_TTL) return _duelRankCache;
  const rows = await db.listPlayerBriefAll();
  const list = [];
  for (const row of rows || []) {
    const accountId = intVal(row?.account_id, 0);
    if (accountId <= 0) continue;
    const sectId = intVal(row?.sect_id, 0);
    const sect = sectId > 0 ? (getSectById(sectId) || {}) : {};
    list.push({
      account_id: accountId,
      name: String(row?.name || `道友#${accountId}`),
      level: Math.max(1, intVal(row?.level, 1)),
      sect_name: String(sect?.name || '散修'),
      duel_rank_score: intVal(row?.duel_rank_score, 1000)
    });
  }
  list.sort((a, b) => (b.duel_rank_score - a.duel_rank_score));
  _duelRankCache = list;
  _duelRankCacheAt = now;
  return list;
}

router.get('/city_duel/rank', async (req, res) => {
  const limit = Math.min(100, Math.max(1, intVal(req.query?.limit, 50)));
  const list = await _buildDuelRank();
  const meId = intVal(req.accountId, 0);
  const leaderboard = list.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    account_id: e.account_id,
    name: e.name,
    level: e.level,
    sect_name: e.sect_name,
    duel_rank_score: e.duel_rank_score
  }));
  let myRank = 0;
  let myScore = 1000;
  for (let i = 0; i < list.length; i++) {
    if (intVal(list[i].account_id, 0) === meId) {
      myRank = i + 1;
      myScore = list[i].duel_rank_score;
      break;
    }
  }
  const { total: challengesToday } = await db.countCityDuelChallengesToday(meId);
  const rankEffectiveRemaining = Math.max(0, 5 - challengesToday);
  const nowSec = Math.floor(Date.now() / 1000);
  const nextSettlementTs = getNextSettlementTs();
  const settlementCountdownSec = Math.max(0, nextSettlementTs - nowSec);
  const periodIndex = getCurrentPeriodIndex();
  const periodReward = pickPeriodReward(periodIndex);
  return res.json({
    ok: true,
    leaderboard,
    my_rank: myRank,
    my_score: myScore,
    challenges_today: challengesToday,
    rank_effective_remaining: rankEffectiveRemaining,
    settlement_countdown_sec: settlementCountdownSec,
    period_index: periodIndex,
    period_reward: { name: periodReward.name, count: periodReward.count }
  });
});

router.post('/city_duel/start', async (req, res) => {
  try {
    const targetAccountId = intVal(req.body?.target_account_id, 0);
    if (targetAccountId <= 0) return res.json({ ok: false, error: '目标参数无效' });
    if (targetAccountId === intVal(req.accountId, 0)) return res.json({ ok: false, error: '不能挑战自己' });
    const playerRaw = await db.getPlayerByAccountId(req.accountId);
    if (!playerRaw) return res.json({ ok: false, error: '角色不存在' });
    const target = await db.getPlayerByAccountId(targetAccountId);
    if (!target) return res.json({ ok: false, error: '目标玩家不存在' });
    const myLevel = intVal(playerRaw?.level, 1);
    const targetLevel = intVal(target?.level, 1);
    if (targetLevel < myLevel - 10) {
      return res.json({ ok: false, error: `不能挑战比自己低10级以上的目标（你Lv.${myLevel}，对方Lv.${targetLevel}）` });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const restUntil = clampRestUntil(playerRaw, nowSec);
    if (restUntil !== intVal(playerRaw.rest_until, 0)) {
      playerRaw.rest_until = restUntil;
      await db.savePlayer(req.accountId, 1, playerRaw);
    }
    if (restUntil > nowSec) {
      const remain = Math.max(0, restUntil - nowSec);
      return res.json({ ok: false, error: `调息中，剩余${remain}秒`, rest_remaining_sec: remain });
    }
    const presetApplied = ops.tryApplySkillPresetForBattle(playerRaw, 'duel');
    cave.settleMainFormationServices(playerRaw, nowSec);
    if (presetApplied) await db.savePlayer(req.accountId, 1, playerRaw);
    const { total, perTarget } = await db.countCityDuelChallengesToday(req.accountId, targetAccountId);
    if (perTarget >= 3) return res.json({ ok: false, error: '今日对该玩家挑战次数已达上限（同一目标每天最多3次）' });
    const rankAffected = total < 5;
    const player = buildFullStateBattlePlayerSource(playerRaw, req.accountId);
    const talismanUse = consumeBattleStartTalisman(playerRaw);
    const targetBattleSource = clonePlayerWithBattlePreset(target, 'duel');
    cave.settleMainFormationServices(targetBattleSource, nowSec, { allowAutoActivate: false });
    const enemySnap = createCityDuelEnemySnapshotFromPlayer(targetBattleSource, targetAccountId);
    const playerSect = getSectById(intVal(player?.sect_id, 0)) || {};
    const targetSect = getSectById(intVal(target?.sect_id, 0)) || {};
    const duelDungeon = { id: 0, name: '城池斗法' };
    const battleId = crypto.randomBytes(16).toString('hex');
    const state = engine.createDungeonBattle(duelDungeon, [player], [[enemySnap]], { battleMode: 'city_duel' });
    if (talismanUse.used) applyBattleStartTalismanToDungeonState(state, talismanUse);
    state.battle_mode = 'city_duel';
    state.duel_rank_affected = rankAffected;
    state.duel_challenger_account_id = intVal(req.accountId, 0);
    state.duel_challenger_name = String(playerRaw?.name || `道友#${intVal(req.accountId, 0)}`);
    state.duel_challenger_level = intVal(playerRaw?.level, 1);
    state.duel_challenger_sect_name = String(playerSect?.name || '散修');
    state.duel_target_account_id = targetAccountId;
    state.duel_target_name = String(target?.name || `道友#${targetAccountId}`);
    state.duel_target_level = intVal(target?.level, 1);
    state.duel_target_sect_name = String(targetSect?.name || '散修');
    dungeonBattleCache.removeAllForAccount(req.accountId);
    await db.deleteAllDungeonBattlesForAccount(req.accountId);
    await db.insertCityDuelChallenge(req.accountId, targetAccountId);
    await db.savePlayer(req.accountId, 1, playerRaw);
    await db.saveDungeonBattle(battleId, req.accountId, 0, state);
    dungeonBattleCache.save(battleId, req.accountId, 0, state);
    return res.json({ ok: true, battle_id: battleId, state: engine.stateToClient(state) });
  } catch (err) {
    console.error('[city_duel/start] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '斗法初始化失败' });
  }
});

router.post('/start', async (req, res) => {
  try {
    const { dungeon_id, team_code } = req.body || {};
    const challengeMode = String(req.body?.challenge_mode || 'normal').trim().toLowerCase();
    const isTrialContractMode = challengeMode === 'trial_contract';
    const contractModifierIds = isTrialContractMode
      ? normalizeSelectedTrialContracts(req.body?.contract_modifiers, 6)
      : [];
    const modeRaw = String(req.body?.dungeon_mode || 'normal').trim().toLowerCase();
    const dungeonMode = modeRaw === 'formation' ? 'formation' : 'normal';
    const dungeonId = Number(dungeon_id);
    if (!dungeonId || dungeonId <= 0) return res.json({ ok: false, error: '无效的副本ID' });

    if (isTrialContractMode && team_code) {
      return res.json({ ok: false, error: '危机试炼仅支持单人挑战' });
    }
    if (isTrialContractMode && dungeonMode === 'formation') {
      return res.json({ ok: false, error: '危机试炼暂不支持阵法副本' });
    }

    const dungeon = getDungeonById(dungeonId);
    if (!dungeon || !dungeon.id) return res.json({ ok: false, error: '副本不存在' });

    const dungeonMultiplier = isTrialContractMode
      ? getTrialContractDungeonMultiplier(getDungeons(), dungeonId)
      : 1;
    const contractSummary = isTrialContractMode
      ? calcTrialContractSummary(contractModifierIds, { dungeonMultiplier })
      : { score: 0, dungeonMultiplier: 1, trialCoins: 0, modifiers: [] };

    if (!isTrialContractMode) {
      const completions = await db.getDungeonCompletionsToday(req.accountId, dungeonId);
      const dailyLimit = Number(dungeon.daily_limit) || 2;
      if (completions >= dailyLimit) return res.json({ ok: false, error: '今日次数已用完' });
    }

    dungeonBattleCache.removeAllForAccount(req.accountId);
    await db.deleteAllDungeonBattlesForAccount(req.accountId);

    const allyPlayers = [];
    const player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '角色不存在' });
    const nowSec = Math.floor(Date.now() / 1000);
    const restUntil = clampRestUntil(player, nowSec);
    if (restUntil !== intVal(player.rest_until, 0)) {
      player.rest_until = restUntil;
      await db.savePlayer(req.accountId, 1, player);
    }
    if (restUntil > nowSec) {
      const remain = Math.max(0, restUntil - nowSec);
      return res.json({
        ok: false,
        error: `调息中，剩余${remain}秒`,
        rest_remaining_sec: remain
      });
    }
    const presetApplied = ops.tryApplySkillPresetForBattle(player, 'dungeon');
    cave.settleMainFormationServices(player, nowSec);
    if (presetApplied) await db.savePlayer(req.accountId, 1, player);
    allyPlayers.push(buildFullStateBattlePlayerSource(player, req.accountId));
    const talismanUse = consumeBattleStartTalisman(player);
    await db.savePlayer(req.accountId, 1, player);

    if (!isTrialContractMode && team_code) {
      const team = await db.getDungeonTeam(String(team_code).toUpperCase());
      if (team && team.members) {
        for (const mid of team.members) {
          if (allyPlayers.length >= 3) break;
          if (mid === req.accountId) continue;
          const mp = await db.getPlayerByAccountId(mid);
          if (mp) {
            const teammateBattleSource = clonePlayerWithBattlePreset(mp, 'dungeon');
            cave.settleMainFormationServices(teammateBattleSource, nowSec, { allowAutoActivate: false });
            allyPlayers.push(buildFullStateBattlePlayerSource(teammateBattleSource, mid));
          }
        }
      }
    }

    const monsterIds = dungeon.monster_ids || [];
    const totalWaves = Math.max(1, Number(dungeon.waves) || 1);
    const perWave = Math.max(1, Math.ceil(monsterIds.length / totalWaves));
    const waves = [];
    for (let w = 0; w < totalWaves; w++) {
      const wave = [];
      for (let i = w * perWave; i < Math.min((w + 1) * perWave, monsterIds.length); i++) {
        const e = getDungeonEnemyById(monsterIds[i]);
        if (e && e.id) {
          const inWaveIdx = i - (w * perWave);
          const isBoss = inWaveIdx === (Math.min((w + 1) * perWave, monsterIds.length) - (w * perWave) - 1);
          wave.push(isTrialContractMode ? applyTrialContractsToEnemy(e, contractModifierIds, { isBoss }) : e);
        }
      }
      if (wave.length > 0) waves.push(wave);
    }
    if (waves.length === 0) return res.json({ ok: false, error: '副本没有怪物配置' });

    const battleId = crypto.randomBytes(16).toString('hex');
    const state = engine.createDungeonBattle(dungeon, allyPlayers, waves, { battleMode: 'dungeon' });
    state.dungeon_mode = dungeonMode;
    state.challenge_mode = isTrialContractMode ? 'trial_contract' : 'normal';
    if (isTrialContractMode) {
      applyTrialContractsToBattleState(state, contractModifierIds);
      state.trial_contract_modifiers = contractSummary.modifiers;
      state.trial_contract_score = Number(contractSummary.score || 0);
      state.trial_contract_dungeon_multiplier = Number(contractSummary.dungeonMultiplier || 1);
      state.trial_contract_reward_mult = Number(contractSummary.dungeonMultiplier || 1);
      state.trial_contract_coins = Number(contractSummary.trialCoins || 0);
    }
    if (dungeonMode === 'formation') {
      state.dungeon_name = `${String(dungeon.name || '副本')}·阵法副本`;
    } else if (isTrialContractMode) {
      state.dungeon_name = `${String(dungeon.name || '副本')}·危机试炼`;
    }
    if (talismanUse.used) applyBattleStartTalismanToDungeonState(state, talismanUse);
    await db.saveDungeonBattle(battleId, req.accountId, dungeonId, state);
    dungeonBattleCache.save(battleId, req.accountId, dungeonId, state);

    res.json({
      ok: true,
      battle_id: battleId,
      dungeon_mode: dungeonMode,
      challenge_mode: state.challenge_mode,
      contract_score: Number(state.trial_contract_score || 0),
      contract_reward_mult: Number(state.trial_contract_reward_mult || 1),
      trial_coins: Number(state.trial_contract_coins || 0),
      contract_modifiers: Array.isArray(state.trial_contract_modifiers) ? state.trial_contract_modifiers : [],
      state: engine.stateToClient(state)
    });
  } catch (err) {
    console.error('[dungeon-battle/start] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '副本初始化失败' });
  }
});

router.post('/advance', async (req, res) => {
  const _delay = getCommandDelay(req.accountId);
  if (_delay > COMMAND_MAX_QUEUE_WAIT_MS) {
    return _respondDungeonAdvanceThrottled(req, res, _delay);
  }
  if (_delay > 0) return setTimeout(() => _handleDungeonAdvance(req, res), _delay);
  return _handleDungeonAdvance(req, res);
});

async function _respondDungeonAdvanceThrottled(req, res, delayMs) {
  const liteState = _isLiteStateRequested(req);
  const { battle_id } = req.body || {};
  if (!battle_id) {
    return res.json({
      ok: false,
      error: '缺少 battle_id',
      code: 'ADVANCE_THROTTLED',
      retry_after_ms: Math.floor(Number(delayMs) || 0)
    });
  }
  const battle = dungeonBattleCache.get(battle_id) || await db.getDungeonBattle(battle_id);
  if (!battle || Number(battle.account_id) !== Number(req.accountId) || !battle.state || typeof battle.state !== 'object') {
    return res.json({
      ok: true,
      throttled: true,
      ended: true,
      finished: true,
      victory: false,
      draw: false,
      battle_gone: true,
      state: null,
      events: [{ t: 'system', text: '战斗会话已结束或过期，已停止推进。' }],
      rewards: { exp: 0, spirit_stones: 0, drops: [] }
    });
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

async function _handleDungeonAdvance(req, res) {
  try {
  const liteState = _isLiteStateRequested(req);
  const battleGoneResp = {
    ok: true,
    ended: true,
    finished: true,
    victory: false,
    draw: false,
    battle_gone: true,
    state: null,
    events: [{ t: 'system', text: '战斗会话已结束或过期，已停止推进。' }],
    rewards: { exp: 0, spirit_stones: 0, drops: [] }
  };
  const { battle_id } = req.body || {};
  if (!battle_id) return res.json({ ok: false, error: '缺少 battle_id' });

  const battle = dungeonBattleCache.get(battle_id) || await db.getDungeonBattle(battle_id);
  if (!battle || Number(battle.account_id) !== Number(req.accountId)) {
    return res.json(battleGoneResp);
  }
  if (!battle.state || typeof battle.state !== 'object') {
    await db.deleteDungeonBattle(battle_id);
    return res.json(battleGoneResp);
  }

  const battleMode = String(battle.state.battle_mode || 'dungeon');
  let result;
  try {
    result = engine.advanceTurn(battle.state);
  } catch (advErr) {
    const st = (battle && battle.state && typeof battle.state === 'object') ? battle.state : {};
    const queueLen = Array.isArray(st.turn_queue) ? st.turn_queue.length : -1;
    const allyLen = Array.isArray(st.allies) ? st.allies.length : -1;
    const enemyLen = Array.isArray(st.enemies) ? st.enemies.length : -1;
    console.error('[dungeon-battle/advance] advanceTurn 内部异常 battle=%s account=%s round=%s wave=%s queue=%s allies=%s enemies=%s: %s\n%s',
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
    // 战斗状态已损坏，删除战斗并返回终止响应，避免客户端无限重试
    dungeonBattleCache.remove(battle_id);
    await db.deleteDungeonBattle(battle_id);
    return res.json({
      ok: true,
      ended: true,
      finished: true,
      victory: false,
      draw: false,
      battle_gone: true,
      state: null,
      events: [{ t: 'system', text: '战斗状态异常，已自动终止。请重新开始副本。' }],
      rewards: { exp: 0, spirit_stones: 0, drops: [] }
    });
  }
  if (!result.ok) return res.json(result);
  const isDraw = Boolean(result.draw);

  const rawEvents = Array.isArray(result.events) ? result.events : [];
  const events = rawEvents.length > DUNGEON_ADVANCE_EVENT_LIMIT
    ? rawEvents.slice(rawEvents.length - DUNGEON_ADVANCE_EVENT_LIMIT)
    : rawEvents;
  if (rawEvents.length > DUNGEON_ADVANCE_EVENT_LIMIT) {
    events.unshift({ t: 'system', text: '战斗日志过长，本次仅展示最新片段。' });
  }
  if (battleMode === 'city_duel') {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      if (String(ev.t || '') === 'battle_end') {
        if (isDraw) ev.text = '斗法平局。';
        else if (Boolean(result.victory)) ev.text = '斗法胜利！';
        else ev.text = '斗法落败。';
      }
    }
  }

  const resp = {
    ok: true, state: _stateToClientByMode(result.state, liteState),
    events, ended: Boolean(result.ended), victory: Boolean(result.victory), draw: isDraw
  };

  if (result.ended) {
    dungeonBattleCache.remove(battle_id);
    await db.deleteDungeonBattle(battle_id);
    const p = await db.getPlayerByAccountId(req.accountId);
    if (battleMode === 'city_duel') {
      // 优先从 result.state 取 duel ID，缺失时回退到 battle.state（DB 加载的战斗状态）
      const stRes = result?.state && typeof result.state === 'object' ? result.state : {};
      const stFallback = battle?.state && typeof battle.state === 'object' ? battle.state : {};
      const st = { ...stFallback, ...stRes };
      const challengerId = intVal(st.duel_challenger_account_id, intVal(req.accountId, 0));
      const targetId = intVal(st.duel_target_account_id, 0);
      const winnerId = isDraw ? 0 : (result.victory ? challengerId : targetId);
      if (challengerId > 0 && targetId > 0) {
        await db.createCityDuelLog({
          challenger_account_id: challengerId,
          target_account_id: targetId,
          winner_account_id: winnerId,
          challenger_name: String(st.duel_challenger_name || ''),
          target_name: String(st.duel_target_name || ''),
          challenger_level: intVal(st.duel_challenger_level, 1),
          target_level: intVal(st.duel_target_level, 1),
          challenger_sect_name: String(st.duel_challenger_sect_name || '散修'),
          target_sect_name: String(st.duel_target_sect_name || '散修')
        });
        if (!isDraw && st.duel_rank_affected !== false) {
          const delta = 3;
          for (const [aid, isWinner] of [[challengerId, winnerId === challengerId], [targetId, winnerId === targetId]]) {
            const pp = await db.getPlayerByAccountId(aid);
            if (pp) {
              const cur = intVal(pp.duel_rank_score, 1000);
              pp.duel_rank_score = Math.max(0, cur + (isWinner ? delta : -delta));
              await db.savePlayer(aid, 1, pp);
              if (aid === intVal(req.accountId, 0) && p) p.duel_rank_score = pp.duel_rank_score;
            }
          }
        }
      }
      if (p) {
        const ally = Array.isArray(result?.state?.allies) ? result.state.allies[0] : null;
        if (ally && typeof ally === 'object') {
          p.hp = Math.max(0, Math.floor(Number(ally.hp) || 0));
          p.mp = Math.max(0, Math.floor(Number(ally.mp) || 0));
        }
        if (!result.victory && !isDraw) {
          const maxHp = Math.max(1, Number(p.max_hp) || 1);
          const maxMp = Math.max(0, Number(p.max_mp) || 0);
          p.hp = maxHp;
          p.mp = maxMp;
        }
        await db.savePlayer(req.accountId, 1, p);
        resp.player = p;
      }
      resp.rewards = { exp: 0, spirit_stones: 0 };
      resp.rank_affected = (!isDraw && st.duel_rank_affected !== false);
    } else if (result.victory) {
      const dg0 = getDungeonById(battle.dungeon_id);
      const dungeonMode = String(battle?.state?.dungeon_mode || 'normal') === 'formation' ? 'formation' : 'normal';
      const challengeMode = String(battle?.state?.challenge_mode || 'normal');
      const isTrialContract = challengeMode === 'trial_contract';
      const contractScore = Math.max(0, intVal(battle?.state?.trial_contract_score, 0));
      const dungeonMultiplier = Math.max(1, Number(battle?.state?.trial_contract_dungeon_multiplier) || 1);
      const trialCoins = challengeMode === 'trial_contract'
        ? Math.max(1, intVal(battle?.state?.trial_contract_coins, calcTrialCoinReward(contractScore, dungeonMultiplier)))
        : 0;
      const contractModifiers = Array.isArray(battle?.state?.trial_contract_modifiers) ? battle.state.trial_contract_modifiers : [];

      if (!isTrialContract) {
        const doneCount = await db.getDungeonCompletionsToday(req.accountId, battle.dungeon_id);
        const dLimit = Number(dg0?.daily_limit) || 2;
        if (doneCount >= dLimit) {
          resp.rewards = {
            exp: 0,
            spirit_stones: 0,
            drops: [],
            dungeon_mode: dungeonMode,
            challenge_mode: challengeMode,
            contract_score: contractScore,
            contract_reward_mult: dungeonMultiplier,
            trial_coins: 0,
            contract_modifiers: contractModifiers
          };
          resp.player = p;
          return res.json(resp);
        }
        await db.incrementDungeonCompletions(req.accountId, battle.dungeon_id);
      }

      if (p) {
        const pLv = intVal(p.level, 1);
        if (pLv >= 201 && pLv <= 240) {
          p.breakthrough_spirit_dungeon_count = (Number(p.breakthrough_spirit_dungeon_count) || 0) + 1;
        }
        const dg = getDungeonById(battle.dungeon_id);
        for (const mid of (dg?.monster_ids || [])) {
          settleKillTaskProgress(p, intVal(mid, 0));
        }
        let totalExp = 0;
        for (const mid of (dg?.monster_ids || [])) {
          const em = getDungeonEnemyById(mid);
          if (em) totalExp += Math.max(10, Number(em.exp) || 10);
        }
        let spiritGain = Math.max(10, Math.floor(totalExp * 0.3));
        const enlightenmentMult = ops.getEnlightenmentExpMult ? ops.getEnlightenmentExpMult(p) : 1;
        totalExp = Math.floor(totalExp * enlightenmentMult);
        const dropMult = 1;
        if (!isTrialContract) {
          p.exp = Math.floor((Number(p.exp) || 0) + totalExp);
          p.spirit_stones = Math.floor((Number(p.spirit_stones) || 0) + spiritGain);
        }
        const dungeonQuality = intVal(dg?.quality, 1);
        let clearDrops = [];
        const todayKey = getDateKeySafe();
        const bestRewardDate = String(p.trial_contract_best_reward_date || p.trial_contract_reward_date || '');
        const legacyBest = String(p.trial_contract_reward_date || '') === todayKey
          ? Math.max(0, intVal(p.trial_contract_reward_coins, 0))
          : 0;
        const bestRewardToday = (isTrialContract && bestRewardDate === todayKey)
          ? Math.max(0, intVal(p.trial_contract_best_reward_coins, 0), legacyBest)
          : legacyBest;
        const grantedTrialCoins = isTrialContract
          ? Math.max(0, Math.max(1, intVal(trialCoins, 0)) - bestRewardToday)
          : 0;
        const newBestRewardToday = isTrialContract
          ? Math.max(bestRewardToday, Math.max(1, intVal(trialCoins, 0)))
          : 0;
        if (isTrialContract) {
          clearDrops = [];
          if (grantedTrialCoins > 0) {
            p.trial_coins = Math.max(0, intVal(p.trial_coins, 0) + grantedTrialCoins);
          }
          p.trial_contract_reward_date = todayKey;
          p.trial_contract_best_reward_date = todayKey;
          p.trial_contract_best_reward_coins = newBestRewardToday;
          // 兼容旧字段：同步记录当日最高，便于历史逻辑/脚本读取
          p.trial_contract_reward_coins = newBestRewardToday;
        } else if (dungeonMode === 'formation') {
          const formationDrops = buildFormationDungeonRuneDrops(dg, p);
          clearDrops = formationDrops.drops;
        } else {
          clearDrops = buildDungeonClearDrops(dungeonQuality, p, dropMult);
        }
        touchActivity(p);
        await db.savePlayer(req.accountId, 1, p);
        resp.rewards = {
          exp: isTrialContract ? 0 : totalExp,
          spirit_stones: isTrialContract ? 0 : spiritGain,
          drops: clearDrops,
          dungeon_mode: dungeonMode,
          challenge_mode: challengeMode,
          contract_score: contractScore,
          contract_reward_mult: dungeonMultiplier,
          trial_coins: grantedTrialCoins,
          contract_modifiers: contractModifiers,
          reward_available_today: isTrialContract ? (Math.max(1, intVal(trialCoins, 0)) > bestRewardToday) : true,
          trial_coins_best_today: isTrialContract ? newBestRewardToday : 0,
          trial_coins_gap_filled: isTrialContract ? grantedTrialCoins : 0
        };
        resp.player = p;
      }
    } else if (p && isDraw) {
      const ally = Array.isArray(result?.state?.allies) ? result.state.allies[0] : null;
      if (ally && typeof ally === 'object') {
        p.hp = Math.max(0, Math.floor(Number(ally.hp) || 0));
        p.mp = Math.max(0, Math.floor(Number(ally.mp) || 0));
        await db.savePlayer(req.accountId, 1, p);
        resp.player = p;
      }
    } else if (p) {
      const maxHp = Math.max(1, Number(p.max_hp) || 1);
      const maxMp = Math.max(0, Number(p.max_mp) || 0);
      p.hp = maxHp;
      p.mp = maxMp;
      await db.savePlayer(req.accountId, 1, p);
      resp.player = p;
    }
  } else {
    dungeonBattleCache.save(battle_id, req.accountId, battle.dungeon_id, result.state);
  }

  if (result.ended && resp.player) {
    const nowSecEnd = Math.floor(Date.now() / 1000);
    resp.rest_remaining_sec = Math.max(0, intVal(resp.player.rest_until, 0) - nowSecEnd);
  }

  res.json(resp);
  } catch (err) {
    console.error('[dungeon-battle/advance] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '战斗推进异常' });
  }
}

module.exports = router;
