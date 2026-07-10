function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

const TRIAL_CONTRACT_DEFS = [
  { id: 'hp_boost_s', name: '钢骨I', desc: '敌方生命 +20%', score: 1, hpMul: 1.2 },
  { id: 'hp_boost_l', name: '钢骨II', desc: '敌方生命 +45%', score: 3, hpMul: 1.45 },
  { id: 'atk_boost_s', name: '锋刃I', desc: '敌方物攻/法攻 +20%', score: 2, atkMul: 1.2, spellAtkMul: 1.2 },
  { id: 'atk_boost_l', name: '锋刃II', desc: '敌方物攻/法攻 +40%', score: 4, atkMul: 1.4, spellAtkMul: 1.4 },
  { id: 'def_boost_s', name: '护甲I', desc: '敌方物防/法防 +20%', score: 2, defMul: 1.2, spellDefMul: 1.2 },
  { id: 'def_boost_l', name: '护甲II', desc: '敌方物防/法防 +40%', score: 4, defMul: 1.4, spellDefMul: 1.4 },
  { id: 'spd_boost_s', name: '迅捷I', desc: '敌方身法 +25%', score: 2, agiMul: 1.25 },
  { id: 'spd_boost_l', name: '迅捷II', desc: '敌方身法 +50%', score: 4, agiMul: 1.5 },
  { id: 'all_boost_m', name: '灾厄共鸣', desc: '敌方全属性 +15%', score: 4, hpMul: 1.15, atkMul: 1.15, spellAtkMul: 1.15, defMul: 1.15, spellDefMul: 1.15, agiMul: 1.15 },
  { id: 'hp_atk_mix', name: '血怒', desc: '敌方生命 +30%，攻击 +25%', score: 4, hpMul: 1.3, atkMul: 1.25, spellAtkMul: 1.25 },
  { id: 'spd_atk_mix', name: '狂袭', desc: '敌方身法 +30%，攻击 +20%', score: 4, agiMul: 1.3, atkMul: 1.2, spellAtkMul: 1.2 },
  { id: 'boss_harden', name: '首领坚韧', desc: '每波最后1个敌人生命与防御额外 +30%', score: 3, bossOnly: true, hpMul: 1.3, defMul: 1.3, spellDefMul: 1.3 },
  { id: 'enemy_cc_immune', name: '铁律屏障', desc: '敌方免疫控制（负面抵抗100%）', score: 5, enemyDebuffResist: 1 },
  { id: 'enemy_open_shield', name: '开场护幕', desc: '敌方开场获得25%最大生命临时护盾', score: 3, enemyTempShieldPct: 0.25 },
  { id: 'player_slow_s', name: '步履维艰I', desc: '我方全体被迟缓（行动速度-20%）', score: 2, playerSlowMultiplier: 0.8, playerSlowRounds: 999 },
  { id: 'player_slow_l', name: '步履维艰II', desc: '我方全体被迟缓（行动速度-40%）', score: 4, playerSlowMultiplier: 0.6, playerSlowRounds: 999 },
  { id: 'player_heal_forbidden', name: '绝脉封疗', desc: '我方全体战斗中无法恢复生命', score: 5, playerHealForbidden: true },
  { id: 'player_cd_plus', name: '法诀滞涩', desc: '我方技能初始冷却+1回合', score: 3, playerInitialCooldownAdd: 1 }
];

const DEF_MAP = new Map(TRIAL_CONTRACT_DEFS.map((d) => [d.id, d]));

const TRIAL_CONTRACT_MAX_PICK = 6;
const TRIAL_COIN_BASE = 12;
const TRIAL_COIN_BONUS_CAP = 68;
const TRIAL_COIN_CURVE_K = 7;
const TRIAL_DUNGEON_MULT_MIN = 1;
const TRIAL_DUNGEON_MULT_MAX = 2.5;
const TRIAL_DUNGEON_MULT_CURVE = 1.15;

function getTrialContractDefinitions() {
  return TRIAL_CONTRACT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    desc: d.desc,
    score: intVal(d.score, 1)
  }));
}

function normalizeSelectedTrialContracts(raw, maxPick = 6) {
  const arr = Array.isArray(raw) ? raw : [];
  const picked = [];
  const seen = new Set();
  for (const v of arr) {
    if (picked.length >= maxPick) break;
    const id = String(v || '').trim();
    if (!id || seen.has(id) || !DEF_MAP.has(id)) continue;
    seen.add(id);
    picked.push(id);
  }
  return picked;
}

function getTrialContractMaxScore(maxPick = TRIAL_CONTRACT_MAX_PICK) {
  const top = TRIAL_CONTRACT_DEFS
    .map((d) => intVal(d.score, 0))
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, intVal(maxPick, TRIAL_CONTRACT_MAX_PICK)));
  return top.reduce((s, v) => s + v, 0);
}

function calcTrialCoinReward(score, dungeonMultiplier = 1) {
  const s = Math.max(0, Number(score) || 0);
  const mul = Math.max(1, Number(dungeonMultiplier) || 1);
  const bonus = TRIAL_COIN_BONUS_CAP * (1 - Math.exp(-s / TRIAL_COIN_CURVE_K));
  const coins = Math.max(1, Math.floor((TRIAL_COIN_BASE + bonus) * mul));
  return coins;
}

function buildTrialContractDungeonBands(dungeons) {
  const src = Array.isArray(dungeons) ? dungeons : [];
  const list = src
    .filter((d) => d && Number(d.id) > 0)
    .slice()
    .sort((a, b) => {
      const la = intVal(a.level_min, intVal(a.level_max, 0));
      const lb = intVal(b.level_min, intVal(b.level_max, 0));
      if (la !== lb) return la - lb;
      return intVal(a.id, 0) - intVal(b.id, 0);
    });
  const total = list.length;
  if (total <= 0) return [];
  if (total === 1) {
    const only = list[0];
    return [{
      dungeonId: intVal(only.id, 0),
      name: String(only.name || ''),
      levelMin: intVal(only.level_min, intVal(only.level_max, 1)),
      index: 0,
      total: 1,
      multiplier: 1
    }];
  }
  return list.map((d, idx) => {
    const progress = idx / (total - 1);
    const raw = TRIAL_DUNGEON_MULT_MIN
      + (TRIAL_DUNGEON_MULT_MAX - TRIAL_DUNGEON_MULT_MIN) * Math.pow(progress, TRIAL_DUNGEON_MULT_CURVE);
    const multiplier = Math.max(TRIAL_DUNGEON_MULT_MIN, Number(raw.toFixed(2)));
    return {
      dungeonId: intVal(d.id, 0),
      name: String(d.name || ''),
      levelMin: intVal(d.level_min, intVal(d.level_max, 1)),
      index: idx,
      total,
      multiplier
    };
  });
}

function getTrialContractDungeonMultiplier(dungeons, dungeonId) {
  const id = intVal(dungeonId, 0);
  if (id <= 0) return 1;
  const bands = buildTrialContractDungeonBands(dungeons);
  const hit = bands.find((b) => intVal(b.dungeonId, 0) === id);
  return Math.max(1, Number(hit?.multiplier) || 1);
}

function _mulStat(base, mul, minVal = 1) {
  const b = Math.max(minVal, Number(base) || minVal);
  const m = Number.isFinite(Number(mul)) ? Number(mul) : 1;
  return Math.max(minVal, Math.floor(b * m));
}

function _calcAggregateMultiplier(selectedDefs, key, bossOnly = false) {
  let out = 1;
  for (const d of selectedDefs) {
    if (!!d.bossOnly !== !!bossOnly) continue;
    const v = Number(d[key]);
    if (!Number.isFinite(v) || v <= 0) continue;
    out *= v;
  }
  return out;
}

function calcTrialContractSummary(selectedIds, options = {}) {
  const defs = normalizeSelectedTrialContracts(selectedIds).map((id) => DEF_MAP.get(id)).filter(Boolean);
  const score = defs.reduce((s, d) => s + intVal(d.score, 0), 0);
  const dungeonMultiplier = Math.max(1, Number(options.dungeonMultiplier) || 1);
  const trialCoins = calcTrialCoinReward(score, dungeonMultiplier);
  return {
    score,
    dungeonMultiplier,
    trialCoins,
    modifiers: defs.map((d) => ({ id: d.id, name: d.name, score: intVal(d.score, 1) }))
  };
}

function applyTrialContractsToEnemy(enemy, selectedIds, options = {}) {
  const src = enemy && typeof enemy === 'object' ? enemy : {};
  const out = structuredClone(src);
  const defs = normalizeSelectedTrialContracts(selectedIds).map((id) => DEF_MAP.get(id)).filter(Boolean);
  const isBoss = !!options.isBoss;
  const hpMul = _calcAggregateMultiplier(defs, 'hpMul', false) * _calcAggregateMultiplier(defs, 'hpMul', isBoss);
  const atkMul = _calcAggregateMultiplier(defs, 'atkMul', false) * _calcAggregateMultiplier(defs, 'atkMul', isBoss);
  const spellAtkMul = _calcAggregateMultiplier(defs, 'spellAtkMul', false) * _calcAggregateMultiplier(defs, 'spellAtkMul', isBoss);
  const defMul = _calcAggregateMultiplier(defs, 'defMul', false) * _calcAggregateMultiplier(defs, 'defMul', isBoss);
  const spellDefMul = _calcAggregateMultiplier(defs, 'spellDefMul', false) * _calcAggregateMultiplier(defs, 'spellDefMul', isBoss);
  const agiMul = _calcAggregateMultiplier(defs, 'agiMul', false) * _calcAggregateMultiplier(defs, 'agiMul', isBoss);

  out.hp = _mulStat(out.hp, hpMul, 1);
  out.maxHp = _mulStat(out.maxHp || out.hp, hpMul, 1);
  out.attack = _mulStat(out.attack, atkMul, 1);
  out.spellAttack = _mulStat(out.spellAttack, spellAtkMul, 0);
  out.defense = _mulStat(out.defense, defMul, 0);
  out.spellDefense = _mulStat(out.spellDefense, spellDefMul, 0);
  out.agility = _mulStat(out.agility, agiMul, 0);
  out.mp = _mulStat(out.mp, 1, 0);
  out.maxMp = _mulStat(out.maxMp || out.mp, 1, 0);
  return out;
}

function applyTrialContractsToBattleState(state, selectedIds) {
  if (!state || typeof state !== 'object') return;
  const defs = normalizeSelectedTrialContracts(selectedIds).map((id) => DEF_MAP.get(id)).filter(Boolean);
  const enemyDebuffResist = defs.reduce((m, d) => Math.max(m, Number(d.enemyDebuffResist) || 0), 0);
  const enemyTempShieldPct = defs.reduce((m, d) => Math.max(m, Number(d.enemyTempShieldPct) || 0), 0);
  const playerSlowMul = defs.reduce((m, d) => {
    const v = Number(d.playerSlowMultiplier);
    if (!Number.isFinite(v) || v <= 0) return m;
    return m <= 0 ? v : Math.min(m, v);
  }, 0);
  const playerSlowRounds = defs.reduce((m, d) => Math.max(m, intVal(d.playerSlowRounds, 0)), 0);
  const playerHealForbidden = defs.some((d) => Boolean(d.playerHealForbidden));
  const playerInitialCooldownAdd = defs.reduce((m, d) => Math.max(m, intVal(d.playerInitialCooldownAdd, 0)), 0);

  if (Array.isArray(state.enemies)) {
    for (const e of state.enemies) {
      if (!e || typeof e !== 'object') continue;
      if (enemyDebuffResist > 0) {
        e.debuff_resistance = Math.max(Number(e.debuff_resistance) || 0, enemyDebuffResist);
      }
      if (enemyTempShieldPct > 0) {
        const addShield = Math.max(1, Math.floor((Math.max(1, Number(e.max_hp) || Number(e.hp) || 1)) * enemyTempShieldPct));
        e.temp_shield = Math.max(0, intVal(e.temp_shield, 0)) + addShield;
      }
    }
  }

  if (Array.isArray(state.allies)) {
    for (const a of state.allies) {
      if (!a || typeof a !== 'object') continue;
      if (playerSlowMul > 0 && playerSlowMul < 1) {
        a.slow_effect = {
          duration: Math.max(1, playerSlowRounds || intVal(a.slow_effect?.duration, 1) || 1),
          speedMultiplier: playerSlowMul
        };
      }
      if (playerHealForbidden) a.heal_forbidden = true;
      if (playerInitialCooldownAdd > 0) {
        const cds = (a.skill_cooldowns && typeof a.skill_cooldowns === 'object') ? a.skill_cooldowns : {};
        for (const sidRaw of (Array.isArray(a.equipped_skills) ? a.equipped_skills : [])) {
          const sid = String(intVal(sidRaw, 0));
          if (!sid || sid === '0') continue;
          cds[sid] = Math.max(0, intVal(cds[sid], 0)) + playerInitialCooldownAdd;
        }
        a.skill_cooldowns = cds;
      }
    }
  }
}

module.exports = {
  getTrialContractDefinitions,
  normalizeSelectedTrialContracts,
  getTrialContractMaxScore,
  calcTrialCoinReward,
  buildTrialContractDungeonBands,
  getTrialContractDungeonMultiplier,
  calcTrialContractSummary,
  applyTrialContractsToEnemy,
  applyTrialContractsToBattleState
};
