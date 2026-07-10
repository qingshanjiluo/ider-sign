function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function numVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const LINGJIE_ENVIRONMENTS = {
  inverse_field: {
    id: 'inverse_field',
    name: '逆势天幕',
    effect_desc: '前3次行动内，双方直接伤害降低35%。',
    reward_desc: '怪物经验提高30%。',
    scaling: { hpRatio: 1.35, attackRatio: 0.92, spellRatio: 1.04, defenseRatio: 1.10, agilityRatio: 1.02, expRatio: 1.55 }
  },
  crack_armor: {
    id: 'crack_armor',
    name: '裂甲风蚀',
    effect_desc: '行动后若物防与法防合计过低，将受到基于生命上限的裂甲反噬。',
    reward_desc: '怪物经验提高20%。',
    scaling: { hpRatio: 1.55, attackRatio: 0.95, spellRatio: 0.95, defenseRatio: 1.85, agilityRatio: 0.96, expRatio: 1.65 }
  },
  overload_sea: {
    id: 'overload_sea',
    name: '过载雷海',
    effect_desc: '修士单段伤害过高会触发过载，后续两次行动伤害与速度下降。',
    reward_desc: '阵纹掉落概率变为三倍。',
    scaling: { hpRatio: 1.32, attackRatio: 1.02, spellRatio: 1.00, defenseRatio: 1.08, agilityRatio: 1.14, expRatio: 1.70 }
  },
  shield_break: {
    id: 'shield_break',
    name: '碎盾潮汐',
    effect_desc: '每次行动后叠加破势，按层数持续侵蚀生命并压低输出。',
    reward_desc: '怪物灵石提高35%。',
    scaling: { hpRatio: 1.42, attackRatio: 1.00, spellRatio: 1.06, defenseRatio: 1.18, agilityRatio: 1.00, expRatio: 1.60 }
  },
  attrition_field: {
    id: 'attrition_field',
    name: '衰荣旷野',
    effect_desc: '战斗开始即生效，行动者每次行动后承受15%最大生命的衰荣侵蚀。',
    reward_desc: '通用掉落概率提高25%。',
    scaling: { hpRatio: 1.60, attackRatio: 1.08, spellRatio: 1.02, defenseRatio: 1.24, agilityRatio: 0.98, expRatio: 1.72 }
  },
  mire_swamp: {
    id: 'mire_swamp',
    name: '迟滞泥沼',
    effect_desc: '每次行动后会被抽离法力并承受侵蚀伤害，低法力时惩罚加重。',
    reward_desc: '炼虚期六阶及以上材料掉率提高50%。',
    scaling: { hpRatio: 1.46, attackRatio: 0.98, spellRatio: 1.05, defenseRatio: 1.20, agilityRatio: 0.94, expRatio: 1.62 }
  }
};

const LINGJIE_BASE_REWARD_BONUS = Object.freeze({
  exp_mult: 1.15,
  drop_mult: 1.25,
  rune_drop_mult: 1,
  spirit_stone_mult: 1,
  tier6_drop_mult: 1
});

const LINGJIE_DESIGN_LEVEL = 270;

function getLingjieLevelScaleFactor(playerLevel) {
  const lv = Math.max(1, intVal(playerLevel, 1));
  if (lv <= LINGJIE_DESIGN_LEVEL) {
    return clamp(lv / LINGJIE_DESIGN_LEVEL, 0.7, 1.0);
  }

  // 270级以上改为加速增长：越往后，增速越高，匹配后期大境界的属性跃迁。
  const progress = (lv - LINGJIE_DESIGN_LEVEL) / 120;
  return clamp(1 + progress * 0.9 + progress * progress * 1.1, 1.0, 3.2);
}

function isLingjieMap(map) {
  if (!map || typeof map !== 'object') return false;
  if (map.is_lingjie === true) return true;
  return String(map.realm || '').trim() === 'lingjie';
}

function getLingjieEnvironment(map) {
  if (!isLingjieMap(map)) return null;
  const envId = String(map.lingjie_env || map.environment_id || '').trim();
  return LINGJIE_ENVIRONMENTS[envId] || null;
}

function getLingjieRewardBonus(map) {
  if (!isLingjieMap(map)) {
    return {
      exp_mult: 1,
      drop_mult: 1,
      rune_drop_mult: 1,
      spirit_stone_mult: 1,
      tier6_drop_mult: 1
    };
  }
  const raw = map && typeof map.reward_bonus === 'object' ? map.reward_bonus : {};
  return {
    // 灵界所有地图都享受基础增益，再叠加各图的专项奖励。
    exp_mult: Math.max(0, numVal(raw.exp_mult, LINGJIE_BASE_REWARD_BONUS.exp_mult)),
    drop_mult: Math.max(0, numVal(raw.drop_mult, LINGJIE_BASE_REWARD_BONUS.drop_mult)),
    rune_drop_mult: Math.max(0, numVal(raw.rune_drop_mult, LINGJIE_BASE_REWARD_BONUS.rune_drop_mult)),
    spirit_stone_mult: Math.max(0, numVal(raw.spirit_stone_mult, LINGJIE_BASE_REWARD_BONUS.spirit_stone_mult)),
    tier6_drop_mult: Math.max(0, numVal(raw.tier6_drop_mult, LINGJIE_BASE_REWARD_BONUS.tier6_drop_mult))
  };
}

function buildLingjieBattleContext(map) {
  const env = getLingjieEnvironment(map);
  if (!env) return null;
  return {
    id: env.id,
    name: env.name,
    effect_desc: String(map.environment_desc || env.effect_desc || ''),
    reward_desc: String(map.reward_desc || env.reward_desc || '')
  };
}

function _scaleBaseByPlayer(baseValue, targetValue, ratio, floorValue = 1) {
  const base = Math.max(floorValue, numVal(baseValue, floorValue));
  const target = Math.max(floorValue, numVal(targetValue, floorValue));
  return Math.max(base, Math.floor(target * Math.max(0, numVal(ratio, 1))));
}

function scaleLingjieEnemyForPlayer(enemy, map, player) {
  if (!isLingjieMap(map) || !enemy || typeof enemy !== 'object' || !player || typeof player !== 'object') {
    return enemy;
  }
  const env = getLingjieEnvironment(map);
  const scaling = env?.scaling || {};
  const playerLevel = Math.max(1, intVal(player.level, 1));
  // 灵界怪的原始设计属性以 270 级为锚点：270 级附近看到接近原始面板，
  // 更低等级按比例下修，270级以上则按加速曲线抬升。
  const factor = getLingjieLevelScaleFactor(playerLevel);
  const pHp = Math.max(1, intVal(player.max_hp || player.hp, 1));
  const pPhysAtk = Math.max(1, intVal(player.max_phys_damage || player.attack || 1, 1));
  const pSpellAtk = Math.max(1, intVal(player.max_spell_attack || player.spell_attack || pPhysAtk, pPhysAtk));
  const pDefense = Math.max(1, intVal(player.phys_defense || player.defense || 1, 1));
  const pSpellDefense = Math.max(1, intVal(player.spell_defense || Math.floor(pDefense * 0.75), 1));
  const pAgility = Math.max(1, intVal(player.agility || 1, 1));
  const pMp = Math.max(0, intVal(player.max_mp || player.mp, 0));
  const profile = enemy.lingjie_profile && typeof enemy.lingjie_profile === 'object' ? enemy.lingjie_profile : {};

  const out = structuredClone(enemy);
  const hpRatio = numVal(profile.hpRatio, scaling.hpRatio || 1.4);
  const attackRatio = numVal(profile.attackRatio, scaling.attackRatio || 1.0);
  const spellRatio = numVal(profile.spellRatio, scaling.spellRatio || attackRatio);
  const defenseRatio = numVal(profile.defenseRatio, scaling.defenseRatio || 1.2);
  const agilityRatio = numVal(profile.agilityRatio, scaling.agilityRatio || 1.0);
  const expRatio = numVal(profile.expRatio, scaling.expRatio || 1.6);

  out.level = Math.max(intVal(out.level, 1), playerLevel);
  out.hp = _scaleBaseByPlayer(numVal(out.hp, 1) * factor, pHp, hpRatio, 1);
  out.attack = _scaleBaseByPlayer(numVal(out.attack, 1) * factor, pPhysAtk, attackRatio, 1);
  out.spellAttack = _scaleBaseByPlayer(numVal(out.spellAttack || out.attack, 1) * factor, pSpellAtk, spellRatio, 0);
  out.defense = _scaleBaseByPlayer(numVal(out.defense, 0) * factor, Math.max(pDefense, pSpellDefense), defenseRatio, 0);
  out.agility = _scaleBaseByPlayer(numVal(out.agility, 1) * (0.88 + factor * 0.08), pAgility, agilityRatio, 1);
  out.mp = _scaleBaseByPlayer(numVal(out.mp, 0) * factor, pMp, clamp((spellRatio + hpRatio) / 2, 0.9, 1.5), 0);
  out.exp = Math.max(1, Math.floor(Math.max(numVal(out.exp, 1) * factor * expRatio, playerLevel * 14 * expRatio)));
  out.drop_multiplier = Math.max(1, numVal(out.drop_multiplier, 1.25));
  out._lingjie_scaled = true;
  out._lingjie_env = env?.id || '';
  out.name = String(out.name || '灵界生灵');
  return out;
}

module.exports = {
  LINGJIE_ENVIRONMENTS,
  isLingjieMap,
  getLingjieEnvironment,
  getLingjieRewardBonus,
  buildLingjieBattleContext,
  scaleLingjieEnemyForPlayer,
  getLingjieLevelScaleFactor
};