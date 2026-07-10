/**
 * 装备生成、词缀、锻造逻辑
 */
const { intVal, floatVal, clampi, clampf, randf, randiRange, shuffleArray, deepClone, calculateItemValue } = require('./onlineUtils');

const EQUIPMENT_TYPES_WEAPON = ['剑', '刀', '长兵', '弓', '拳爪', '音律', '节杖'];
const EQUIPMENT_TYPES_ARMOR = ['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
const CATALYST_ITEM_IDS = [27, 69, 71, 44, 45, 54, 133];
const ELEMENTS = ['金', '木', '水', '火', '土', '无', '混元'];
const MAX_AFFIX_TIER = 8;
const ZAOHUA_LOCK_ERROR = '该装备已完成造化，无法再进行属性改造';
const ZAOHUA_NO_EFFECT_RATE = 0.35;
const ZAOHUA_NEGATIVE_RATE = 0.6;
const AFFIX_NAME_POOL = {
  strength: ['蛮力', '开山', '撼岳', '破军'],
  constitution: ['强体', '厚甲', '镇岳', '不灭'],
  bone: ['坚骨', '玄骨', '龙脊', '圣躯'],
  agility: ['迅捷', '灵动', '逐影', '神行'],
  zhenyuan: ['凝元', '聚气', '归一', '太初'],
  lingli: ['灵息', '清辉', '天籁', '道韵'],
  turn_end_mp: ['回灵', '聚法', '凝神', '归元'],
  phys_crit_rate_bonus: ['锋芒', '破势', '贯虹', '必杀'],
  spell_crit_rate_bonus: ['灵犀', '洞玄', '通神', '天启'],
  phys_crit_damage_bonus: ['破甲', '碎骨', '崩山', '绝杀'],
  spell_crit_damage_bonus: ['雷劫', '天罚', '诛邪', '灭世'],
  phys_lifesteal_pct: ['嗜血', '噬魂', '夺魄', '汲命'],
  spell_lifesteal_pct: ['灵噬', '魂吸', '元汲', '神夺'],
  phys_damage_pct: ['破军', '摧城', '裂空', '崩天'],
  spell_damage_pct: ['灵涌', '法威', '道劫', '天诛'],
  phys_flat_damage: ['破锋', '断岳', '裂魂', '灭绝'],
  spell_flat_damage: ['灵穿', '噬元', '裂法', '灭法'],
  phys_defense_pct: ['铁壁', '镇岳', '不破', '天堑'],
  spell_defense_pct: ['灵障', '法护', '道御', '仙佑'],
  phys_defense_flat: ['护体', '镇甲', '玄御', '不动'],
  spell_defense_flat: ['法障', '元御', '天幕', '道藏'],
  phys_splash_pct: ['破浪', '断流', '裂界', '荡灭'],
  spell_splash_pct: ['流光', '湮灭', '天瀑', '寂灭']
};

function getEffectiveTier(level) {
  return Math.min(40, Math.max(1, Math.floor((intVal(level, 1) + 9) / 10)));
}
function getPlayerRealmQuality(level) {
  const t = getEffectiveTier(level);
  if (t <= 12) return 1;
  if (t <= 16) return 2;
  if (t <= 20) return 3;
  if (t <= 24) return 4;
  if (t <= 28) return 5;
  if (t <= 32) return 6;
  if (t <= 36) return 7;
  return 8;
}
function getPlayerAffixQualityCap(level) {
  return clampi(getPlayerRealmQuality(level), 1, MAX_AFFIX_TIER);
}

function isZaohuaLockedEquipment(equipment) {
  if (!equipment || typeof equipment !== 'object') return false;
  return Boolean(equipment.zaohua_locked || equipment.zaohua_state || equipment.zaohua_at);
}
function getRequiredLevelForQuality(quality) {
  const q = intVal(quality, 1);
  if (q === 1) return 1;
  if (q === 2) return 130;
  if (q === 3) return 170;
  if (q === 4) return 210;
  if (q === 5) return 250;
  if (q === 6) return 290;
  if (q === 7) return 330;
  if (q === 8) return 370;
  return 1;
}
function getRequiredLevelForItem(quality, affixes) {
  let maxAffixQuality = 1;
  const arr = Array.isArray(affixes) ? affixes : [];
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue;
    const aq = intVal(a.quality, intVal(a.tier, 1));
    maxAffixQuality = Math.max(maxAffixQuality, clampi(aq, 1, 8));
  }
  const requiredQ = Math.max(clampi(quality, 1, 8), maxAffixQuality);
  return getRequiredLevelForQuality(requiredQ);
}

function getArmorBaseRangesForQuality(quality) {
  const q = intVal(quality, 1);
  if (q === 1) return { hp_min: 30, hp_max: 75, def_min: 37, def_max: 55 };
  if (q === 2) return { hp_min: 180, hp_max: 270, def_min: 92, def_max: 150 };
  if (q === 3) return { hp_min: 450, hp_max: 675, def_min: 337, def_max: 487 };
  if (q === 4) return { hp_min: 1350, hp_max: 1950, def_min: 585, def_max: 950 };
  if (q === 5) return { hp_min: 1688, hp_max: 2438, def_min: 731, def_max: 1188 };
  if (q === 6) return { hp_min: 2363, hp_max: 3413, def_min: 1023, def_max: 1663 };
  if (q === 7) return { hp_min: 3308, hp_max: 4778, def_min: 1432, def_max: 2328 };
  if (q === 8) return { hp_min: 4631, hp_max: 6689, def_min: 2005, def_max: 3259 };
  return getArmorBaseRangesForQuality(1);
}
function getArmorGreenAttrConfig(quality) {
  const q = intVal(quality, 1);
  if (q === 1) return { max_count: 1, value_min: 15, value_max: 33 };
  if (q === 2) return { max_count: 2, value_min: 37, value_max: 72 };
  if (q === 3) return { max_count: 2, value_min: 82, value_max: 117 };
  if (q === 4) return { max_count: 3, value_min: 147, value_max: 216 };
  if (q === 5) return { max_count: 3, value_min: 206, value_max: 302 };
  if (q === 6) return { max_count: 3, value_min: 288, value_max: 423 };
  if (q === 7) return { max_count: 3, value_min: 403, value_max: 592 };
  if (q === 8) return { max_count: 3, value_min: 564, value_max: 829 };
  return getArmorGreenAttrConfig(1);
}
function getTurnEndMpAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 5, value_max: 15 };
  if (q === 2) return { value_min: 15, value_max: 35 };
  if (q === 3) return { value_min: 35, value_max: 60 };
  if (q === 4) return { value_min: 60, value_max: 95 };
  if (q === 5) return { value_min: 95, value_max: 130 };
  if (q === 6) return { value_min: 130, value_max: 170 };
  if (q === 7) return { value_min: 170, value_max: 200 };
  if (q === 8) return { value_min: 200, value_max: 230 };
  return getTurnEndMpAffixConfig(1);
}
function getCritRateAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 1, value_max: 2 };
  if (q === 2) return { value_min: 2, value_max: 4 };
  if (q === 3) return { value_min: 4, value_max: 6 };
  if (q === 4) return { value_min: 6, value_max: 8 };
  if (q === 5) return { value_min: 8, value_max: 9 };
  if (q === 6) return { value_min: 9, value_max: 10 };
  if (q === 7) return { value_min: 10, value_max: 11 };
  if (q === 8) return { value_min: 11, value_max: 12 };
  return getCritRateAffixConfig(1);
}
function getCritDamageAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 1, value_max: 2 };
  if (q === 2) return { value_min: 2, value_max: 3 };
  if (q === 3) return { value_min: 3, value_max: 4 };
  if (q === 4) return { value_min: 4, value_max: 5 };
  if (q === 5) return { value_min: 5, value_max: 6 };
  if (q === 6) return { value_min: 6, value_max: 7 };
  if (q === 7) return { value_min: 7, value_max: 8 };
  if (q === 8) return { value_min: 8, value_max: 9 };
  return getCritDamageAffixConfig(1);
}
/**
 * 物理/法术吸血，值存为百分*10（50=5%）。
 * 先按Q取基础区间，再由T分段映射；高T会在基础上限外做额外抬升（由 getAffixValueRangeForTier 决定）。
 */
function getLifestealAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 5, value_max: 10 };
  if (q === 2) return { value_min: 10, value_max: 15 };
  if (q === 3) return { value_min: 15, value_max: 25 };
  if (q === 4) return { value_min: 20, value_max: 30 };
  if (q === 5) return { value_min: 25, value_max: 35 };
  if (q === 6) return { value_min: 30, value_max: 40 };
  if (q === 7) return { value_min: 35, value_max: 45 };
  if (q === 8) return { value_min: 40, value_max: 55 };
  return getLifestealAffixConfig(1);
}
/**
 * 物理/法术攻击力提高%。
 * 注意：最终T档位区间由 getAffixValueRangeForTier 计算，可能高于此处Q基础区间上限。
 */
function getDamagePctAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 5, value_max: 15 };
  if (q === 2) return { value_min: 15, value_max: 30 };
  if (q === 3) return { value_min: 30, value_max: 50 };
  if (q === 4) return { value_min: 45, value_max: 70 };
  if (q === 5) return { value_min: 60, value_max: 85 };
  if (q === 6) return { value_min: 75, value_max: 95 };
  if (q === 7) return { value_min: 90, value_max: 105 };
  if (q === 8) return { value_min: 100, value_max: 125 };
  return getDamagePctAffixConfig(1);
}
/**
 * 物理/法术防御增加%。
 * 注意：最终T档位区间由 getAffixValueRangeForTier 计算，可能高于此处Q基础区间上限。
 */
function getDefensePctAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 5, value_max: 15 };
  if (q === 2) return { value_min: 15, value_max: 30 };
  if (q === 3) return { value_min: 30, value_max: 50 };
  if (q === 4) return { value_min: 45, value_max: 65 };
  if (q === 5) return { value_min: 60, value_max: 75 };
  if (q === 6) return { value_min: 70, value_max: 85 };
  if (q === 7) return { value_min: 80, value_max: 92 };
  if (q === 8) return { value_min: 90, value_max: 105 };
  return getDefensePctAffixConfig(1);
}
/**
 * 点伤按词缀Q/T映射：Q1T1=15，Q8T8=450。
 * 高Q时采用更小的区间并在T维度更快逼近高值，实现“高值在高Q阶加速收敛”。
 */
function getFlatDamageValueByQualityTier(affixQuality, tier) {
  const q = clampi(intVal(affixQuality, 1), 1, MAX_AFFIX_TIER);
  const t = clampi(intVal(tier, 1), 1, MAX_AFFIX_TIER);
  const qProgress = (q - 1) / (MAX_AFFIX_TIER - 1);
  const tProgress = (t - 1) / (MAX_AFFIX_TIER - 1);

  const tier1Floor = 15 + (420 - 15) * Math.pow(qProgress, 1.5);
  const qualitySpan = 45 - 15 * Math.pow(qProgress, 1.4);
  const tierPower = 1.0 - 0.45 * qProgress;
  const tierFactor = Math.pow(tProgress, tierPower);

  return Math.max(1, Math.round(tier1Floor + qualitySpan * tierFactor));
}
function getFlatDamageAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER);
  return {
    value_min: getFlatDamageValueByQualityTier(q, 1),
    value_max: getFlatDamageValueByQualityTier(q, MAX_AFFIX_TIER)
  };
}
/** 物理/法术溅射，值存为百分*10（150=15%） */
function getSplashPctAffixConfig(quality) {
  const q = clampi(intVal(quality, 1), 1, 8);
  if (q === 1) return { value_min: 10, value_max: 25 };
  if (q === 2) return { value_min: 25, value_max: 40 };
  if (q === 3) return { value_min: 40, value_max: 55 };
  if (q === 4) return { value_min: 55, value_max: 75 };
  if (q === 5) return { value_min: 70, value_max: 90 };
  if (q === 6) return { value_min: 85, value_max: 110 };
  if (q === 7) return { value_min: 100, value_max: 125 };
  if (q === 8) return { value_min: 115, value_max: 140 };
  return getSplashPctAffixConfig(1);
}
function getArmorTypeMultiplier(armorType) {
  const t = String(armorType || 'chest');
  if (t === 'shoulder') return 0.85;
  if (t === 'legs') return 0.70;
  if (t === 'head') return 0.80;
  if (t === 'hands') return 0.70;
  if (t === 'ring') return 0.60;
  if (t === 'amulet') return 0.60;
  if (t === 'back') return 0.65;
  return 1.0;
}
function getFlatAffixTierRatio(tier) {
  const t = clampi(intVal(tier, 1), 1, MAX_AFFIX_TIER);
  const minRatio = 0.25;
  const maxRatio = 0.70;
  return minRatio + (t - 1) * ((maxRatio - minRatio) / (MAX_AFFIX_TIER - 1));
}
function getArmorWhiteDefenseRangeByQuality(quality, armorType, isSpell) {
  const q = clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER);
  const mult = getArmorTypeMultiplier(armorType);
  const base = getArmorBaseRangesForQuality(q);
  const defMin = Math.floor(floatVal(base.def_min, 1) * mult);
  const defMax = Math.floor(floatVal(base.def_max, 1) * mult);
  const rawMin = Math.max(1, Math.min(defMin, defMax));
  const rawMax = Math.max(rawMin, Math.max(defMin, defMax));
  if (!isSpell) return { min: rawMin, max: rawMax };
  const minV = Math.floor(rawMin * 0.8);
  const maxV = Math.floor(rawMax * 0.8);
  return { min: Math.max(1, minV), max: Math.max(1, Math.max(minV, maxV)) };
}
function getFlatDamageAffixRange(affixQuality, tier, stat, ctx = {}) {
  const armorType = String(ctx?.armor_type || 'ring');
  if (armorType !== 'ring' && armorType !== 'amulet') return null;
  const v = getFlatDamageValueByQualityTier(affixQuality, tier);
  return { min: v, max: v };
}
function getDefenseFlatAffixRange(affixQuality, tier, stat, ctx = {}) {
  const armorType = String(ctx?.armor_type || 'chest');
  const isSpell = String(stat || '') === 'spell_defense_flat';
  const refRange = getArmorWhiteDefenseRangeByQuality(affixQuality, armorType, isSpell);
  const ratio = getFlatAffixTierRatio(tier);
  const minV = Math.max(1, Math.floor(refRange.min * ratio));
  const maxV = Math.max(minV, Math.floor(refRange.max * ratio));
  return { min: minV, max: maxV };
}
function getSpecialAffixRange(stat, affixQuality, rollTier, ctx = {}) {
  const s = String(stat || '');
  if (s === 'phys_flat_damage' || s === 'spell_flat_damage') {
    return getFlatDamageAffixRange(affixQuality, rollTier, s, ctx);
  }
  if (s === 'phys_defense_flat') {
    return getDefenseFlatAffixRange(affixQuality, rollTier, s, ctx);
  }
  if (s === 'spell_defense_flat') {
    return getDefenseFlatAffixRange(affixQuality, rollTier, s, ctx);
  }
  return null;
}
function getRealmStatsForQuality(quality) {
  const q = intVal(quality, 1);
  if (q === 1) return { base_attack_min: 12, base_attack_max: 27, base_defense: 4, base_hp: 22, base_agility: 3 };
  if (q === 2) return { base_attack_min: 37, base_attack_max: 67, base_defense: 18, base_hp: 75, base_agility: 6 };
  if (q === 3) return { base_attack_min: 120, base_attack_max: 210, base_defense: 60, base_hp: 225, base_agility: 12 };
  if (q === 4) return { base_attack_min: 300, base_attack_max: 525, base_defense: 150, base_hp: 600, base_agility: 22 };
  if (q === 5) return { base_attack_min: 600, base_attack_max: 1020, base_defense: 375, base_hp: 1500, base_agility: 37 };
  if (q === 6) return { base_attack_min: 840, base_attack_max: 1428, base_defense: 525, base_hp: 2100, base_agility: 52 };
  if (q === 7) return { base_attack_min: 1176, base_attack_max: 2000, base_defense: 735, base_hp: 2940, base_agility: 73 };
  if (q === 8) return { base_attack_min: 1646, base_attack_max: 2800, base_defense: 1029, base_hp: 4116, base_agility: 102 };
  return getRealmStatsForQuality(1);
}
function getWeaponMultipliers(subtype) {
  const s = String(subtype || '剑');
  if (s === '剑') return { phys: 1.0, spell: 1.0 };
  if (s === '刀') return { phys: 1.2, spell: 0.45 };
  if (s === '长兵') return { phys: 1.3, spell: 0.45 };
  if (s === '弓') return { phys: 0.67, spell: 1.22 };
  if (s === '拳爪') return { phys: 1.0, spell: 1.15 };
  if (s === '音律') return { phys: 0.45, spell: 1.3 };
  if (s === '节杖') return { phys: 1.23, spell: 0.75 };
  return { phys: 1.0, spell: 1.0 };
}
function getAffixTierWeightsForQuality(quality) {
  const q = intVal(quality, 1);
  if (q === 1) return [0.38, 0.23, 0.15, 0.10, 0.07, 0.04, 0.02, 0.01];
  if (q === 2) return [0.31, 0.22, 0.16, 0.12, 0.09, 0.05, 0.03, 0.02];
  if (q === 3) return [0.24, 0.20, 0.17, 0.14, 0.11, 0.07, 0.04, 0.03];
  if (q === 4) return [0.19, 0.18, 0.17, 0.15, 0.13, 0.09, 0.06, 0.03];
  if (q === 5) return [0.16, 0.16, 0.16, 0.15, 0.14, 0.11, 0.08, 0.04];
  if (q === 6) return [0.13, 0.14, 0.15, 0.15, 0.15, 0.13, 0.10, 0.05];
  if (q === 7) return [0.11, 0.12, 0.14, 0.15, 0.16, 0.14, 0.12, 0.06];
  return [0.09, 0.10, 0.12, 0.14, 0.16, 0.16, 0.14, 0.09];
}
function rollAffixTier(quality, maxTier = MAX_AFFIX_TIER) {
  const ws = getAffixTierWeightsForQuality(quality);
  const cap = clampi(maxTier, 1, MAX_AFFIX_TIER);
  const useWs = ws.slice(0, Math.max(1, cap));
  let total = 0;
  for (const w of useWs) total += floatVal(w, 0);
  if (total <= 0) return cap;
  const r = randf() * total;
  let acc = 0;
  for (let i = 0; i < useWs.length; i += 1) {
    acc += useWs[i];
    if (r <= acc) return i + 1;
  }
  return cap;
}
function rollAffixRollTier() {
  return randiRange(1, MAX_AFFIX_TIER);
}
function rollAffixCount() {
  const r = randf();
  if (r < 0.45) return 1;
  if (r < 0.75) return 2;
  if (r < 0.93) return 3;
  return 4;
}
function getRarityByAffixCount(affixCount) {
  const c = intVal(affixCount, 1);
  if (c <= 1) return { key: 'green', name: '绿色' };
  if (c === 2) return { key: 'blue', name: '蓝色' };
  return { key: 'purple', name: '紫色' };
}
function getAffixValueRangeForTier(baseMin, baseMax, tier) {
  // T按分段区间映射，t>=6会在基础区间上限外追加抬升，
  // 因此最终T区间可能高于Q配置的value_max（这是当前设计，不是异常）。
  const bMin = Math.max(1, Math.min(intVal(baseMin), intVal(baseMax)));
  const bMax = Math.max(bMin, Math.max(intVal(baseMin), intVal(baseMax)));
  const span = Math.max(1, bMax - bMin);
  const t = clampi(tier, 1, MAX_AFFIX_TIER);
  const lowRatio = (t - 1) / MAX_AFFIX_TIER;
  const highRatio = t / MAX_AFFIX_TIER;
  let outMin = bMin + Math.trunc(span * lowRatio);
  let outMax = bMin + Math.trunc(span * highRatio);
  if (t >= 6) outMax += Math.trunc(span * 0.15 * (t - 5));
  outMin = Math.max(1, outMin);
  outMax = Math.max(outMin, outMax);
  return { min: outMin, max: outMax };
}
function getAffixName(stat, tier) {
  const pool = AFFIX_NAME_POOL[String(stat || '')] || [];
  if (pool.length <= 0) return String(stat || '');
  const idx = Math.max(0, Math.min(pool.length - 1, intVal(tier, 1) - 1));
  const baseName = String(pool[idx]);
  if (intVal(tier, 1) <= pool.length) return baseName;
  return `${baseName}·${intVal(tier, 1)}阶`;
}
function getVisibleAffixesForName(affixes, maxCount = 3) {
  const scored = [];
  for (const a of Array.isArray(affixes) ? affixes : []) {
    if (!a || typeof a !== 'object') continue;
    let n = String(a.name || '').trim();
    if (!n) n = String(a.stat || '').trim();
    if (!n) continue;
    const q = clampi(intVal(a.quality, intVal(a.tier, 1)), 1, MAX_AFFIX_TIER);
    const t = clampi(intVal(a.tier, q), 1, MAX_AFFIX_TIER);
    scored.push({ name: n, quality: q, tier: t, value: intVal(a.value, 0) });
  }
  scored.sort((x, y) => {
    if (x.quality !== y.quality) return y.quality - x.quality;
    if (x.tier !== y.tier) return y.tier - x.tier;
    return y.value - x.value;
  });
  const out = [];
  const seen = new Set();
  for (const s of scored) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s.name);
    if (out.length >= Math.max(0, intVal(maxCount, 3))) break;
  }
  return out;
}
function composeStandardEquipmentName(baseName, affixes) {
  const names = getVisibleAffixesForName(affixes, 3);
  if (names.length <= 0) return baseName;
  if (names.length === 1) return `${names[0]}${baseName}`;
  if (names.length === 2) return `${names[0]}之${names[1]}${baseName}`;
  return `${names[0]}的${names[1]}之${names[2]}${baseName}`;
}
function generateAffixes(quality, poolStats, affixCount, valueMin, valueMax, statScale = {}, maxAffixQuality = MAX_AFFIX_TIER, rollContext = {}) {
  const extraStats = {};
  const affixes = [];
  const picked = Array.isArray(poolStats) ? poolStats.slice() : [];
  shuffleArray(picked);
  const finalCount = Math.min(intVal(affixCount, 1), picked.length);
  for (let i = 0; i < finalCount; i += 1) {
    const stat = String(picked[i]);
    const scale = floatVal(statScale[stat], 1.0);
    const affixQ = rollAffixTier(quality, maxAffixQuality);
    const rollT = rollAffixRollTier();
    const specialRange = getSpecialAffixRange(stat, affixQ, rollT, rollContext);
    let vr;
    if (specialRange) {
      vr = specialRange;
    } else {
      let qCfg = getArmorGreenAttrConfig(affixQ);
      if (stat === 'turn_end_mp') qCfg = getTurnEndMpAffixConfig(affixQ);
      else if (stat === 'phys_crit_rate_bonus' || stat === 'spell_crit_rate_bonus') qCfg = getCritRateAffixConfig(affixQ);
      else if (stat === 'phys_crit_damage_bonus' || stat === 'spell_crit_damage_bonus') qCfg = getCritDamageAffixConfig(affixQ);
      else if (stat === 'phys_lifesteal_pct' || stat === 'spell_lifesteal_pct') qCfg = getLifestealAffixConfig(affixQ);
      else if (stat === 'phys_damage_pct' || stat === 'spell_damage_pct') qCfg = getDamagePctAffixConfig(affixQ);
      else if (stat === 'phys_flat_damage' || stat === 'spell_flat_damage') qCfg = getFlatDamageAffixConfig(affixQ);
      else if (stat === 'phys_defense_pct' || stat === 'spell_defense_pct') qCfg = getDefensePctAffixConfig(affixQ);
      else if (stat === 'phys_splash_pct' || stat === 'spell_splash_pct') qCfg = getSplashPctAffixConfig(affixQ);
      const qMin = intVal(qCfg.value_min, intVal(valueMin, 1));
      const qMax = intVal(qCfg.value_max, intVal(valueMax, qMin));
      const bMin = Math.max(1, Math.trunc(qMin * scale));
      const bMax = Math.max(bMin, Math.trunc(qMax * scale));
      vr = getAffixValueRangeForTier(bMin, bMax, rollT);
    }
    const v = randiRange(vr.min, vr.max);
    extraStats[stat] = v;
    affixes.push({ name: getAffixName(stat, affixQ), stat, quality: affixQ, tier: rollT, value: v });
  }
  return { extra_stats: extraStats, affixes };
}

function generatedEquipmentId() {
  return intVal(Date.now() + Math.floor(Math.random() * 1000000), 10000);
}

function generateWeapon(weaponSubtype, quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const subtype = EQUIPMENT_TYPES_WEAPON.includes(weaponSubtype) ? weaponSubtype : '剑';
  const q = clampi(quality, 1, 8);
  const realmStats = getRealmStatsForQuality(q);
  const stats = {};
  const attackRange = intVal(realmStats.base_attack_max) - intVal(realmStats.base_attack_min);
  const attackMin = intVal(realmStats.base_attack_min) + Math.floor(Math.random() * Math.max(1, Math.trunc(attackRange * 0.3)));
  const attackMax = attackMin + Math.trunc(attackRange * 0.4) + Math.floor(Math.random() * Math.max(1, Math.trunc(attackRange * 0.3)));
  const baseSpell = (floatVal(realmStats.base_attack_min) + floatVal(realmStats.base_attack_max)) / 2.0;
  const wm = getWeaponMultipliers(subtype);
  stats.minAttack = Math.trunc(attackMin * wm.phys);
  stats.maxAttack = Math.trunc(attackMax * wm.phys);
  stats.minSpellAttack = Math.trunc(Math.max(1, baseSpell * wm.spell * (0.85 + Math.random() * 0.10)));
  stats.maxSpellAttack = Math.trunc(Math.max(1, baseSpell * wm.spell * (1.05 + Math.random() * 0.15)));
  if (subtype === '长兵') stats.agility = -Math.trunc(floatVal(realmStats.base_agility) * 0.5);
  if (subtype === '弓') stats.agility = Math.trunc(floatVal(realmStats.base_agility) * 1.5);
  if (subtype === '拳爪') stats.agility = Math.trunc(floatVal(realmStats.base_agility) * 1.2);

  const greenCfg = getArmorGreenAttrConfig(q);
  const affixCount = rollAffixCount();
  const basePool = {
    剑: ['strength', 'agility', 'bone', 'zhenyuan', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    刀: ['strength', 'constitution', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    长兵: ['strength', 'bone', 'constitution', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    弓: ['agility', 'lingli', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    拳爪: ['agility', 'zhenyuan', 'strength', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    音律: ['zhenyuan', 'lingli', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    节杖: ['strength', 'constitution', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus']
  };
  const weaponPool = (basePool[subtype] || basePool.剑).slice();
  if (q >= 3) weaponPool.push('phys_damage_pct', 'spell_damage_pct');
  if (q >= 4) weaponPool.push('phys_lifesteal_pct', 'spell_lifesteal_pct');
  if (q >= 5) weaponPool.push('phys_splash_pct', 'spell_splash_pct');
  const statScale = {
    agility: 1.0, strength: 2.0, constitution: 2.0, bone: 2.0, zhenyuan: 2.0, lingli: 2.0,
    phys_crit_rate_bonus: 1.0, spell_crit_rate_bonus: 1.0,
    phys_lifesteal_pct: 1.0, spell_lifesteal_pct: 1.0,
    phys_damage_pct: 1.0, spell_damage_pct: 1.0,
    phys_splash_pct: 1.0, spell_splash_pct: 1.0
  };
  const affixRoll = generateAffixes(q, weaponPool, affixCount, intVal(greenCfg.value_min), intVal(greenCfg.value_max), statScale, maxAffixQuality, {});
  const extraStats = affixRoll.extra_stats || {};
  const affixes = affixRoll.affixes || [];
  for (const k of Object.keys(extraStats)) {
    stats[k] = intVal(stats[k], 0) + intVal(extraStats[k], 0);
  }

  const weaponNames = {
    剑: ['铁剑', '精钢剑', '灵剑', '法剑', '仙剑'],
    刀: ['钢刀', '精钢刀', '灵刀', '法刀', '仙刀'],
    长兵: ['长枪', '长矛', '长戟', '法枪', '仙枪'],
    弓: ['短弓', '长弓', '灵弓', '法弓', '仙弓'],
    拳爪: ['铁爪', '钢爪', '灵爪', '法爪', '仙爪'],
    音律: ['玉笛', '古琴', '灵笛', '法琴', '仙笛'],
    节杖: ['竹杖', '铁杖', '灵杖', '法杖', '仙杖']
  };
  const qualityNames = ['', '精', '灵', '法', '仙', '神', '神', '圣'];
  const namePrefix = q >= 1 && q < qualityNames.length ? qualityNames[q] : '';
  const baseNames = weaponNames[subtype] || ['武器'];
  const baseName = baseNames[Math.min(q - 1, baseNames.length - 1)];
  const plainBaseName = namePrefix ? `${namePrefix}${baseName}` : baseName;
  const weaponName = composeStandardEquipmentName(plainBaseName, affixes);
  const elementMaterial = {
    剑: { element: '金', material: '金属' },
    刀: { element: '金', material: '金属' },
    长兵: { element: '金', material: '金属' },
    弓: { element: '火', material: '草木' },
    拳爪: { element: '金', material: '金属' },
    音律: { element: '水', material: '玉质' },
    节杖: { element: '水', material: '金属' }
  };
  const em = elementMaterial[subtype] || { element: '无', material: '金属' };
  const rarity = getRarityByAffixCount(affixCount);
  const item = {
    id: generatedEquipmentId(),
    name: weaponName,
    baseName: plainBaseName,
    type: 'weapon',
    subtype,
    element: em.element || '无',
    material: em.material || '金属',
    description: `制式${subtype}，属性随机生成`,
    stats,
    randomExtraStats: extraStats,
    affixes,
    affixCount,
    rarity: rarity.key,
    rarityName: rarity.name,
    quality: q,
    required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateArmor(armorType, quality, maxAffixQuality = MAX_AFFIX_TIER, noAffixes = false) {
  const type = EQUIPMENT_TYPES_ARMOR.includes(armorType) ? armorType : 'chest';
  const q = clampi(quality, 1, 8);
  let multiplier = 1.0;
  if (type === 'shoulder') multiplier = 0.85;
  else if (type === 'legs') multiplier = 0.70;
  else if (type === 'head') multiplier = 0.80;
  else if (type === 'hands') multiplier = 0.70;
  else if (type === 'ring') multiplier = 0.60;
  else if (type === 'amulet') multiplier = 0.60;
  else if (type === 'back') multiplier = 0.65;
  const baseRanges = getArmorBaseRangesForQuality(q);
  const hpMin = Math.trunc(baseRanges.hp_min * multiplier);
  const hpMax = Math.trunc(baseRanges.hp_max * multiplier);
  const defMin = Math.trunc(baseRanges.def_min * multiplier);
  const defMax = Math.trunc(baseRanges.def_max * multiplier);
  let stats = {};
  if ((type === 'ring' || type === 'amulet') && q >= 3) {
    const realmStats = getRealmStatsForQuality(q);
    const weapPhysMin = intVal(realmStats.base_attack_min, 0);
    const weapPhysMax = intVal(realmStats.base_attack_max, 0);
    const weapSpellBase = (weapPhysMin + weapPhysMax) / 2;
    const RING_AMULET_ATTACK_PCT = 0.13;
    const presetIdx = Math.floor(randf() * 3);
    if (presetIdx === 0) {
      stats.maxHp = randiRange(Math.max(1, hpMin), Math.max(1, hpMax));
      const v = randiRange(Math.max(1, defMin), Math.max(1, defMax));
      stats.physDefense = v;
      stats.spellDefense = Math.floor(floatVal(v) * 0.8);
    } else if (presetIdx === 1) {
      const aMin = Math.floor(weapPhysMin * RING_AMULET_ATTACK_PCT * 0.9);
      const bMin = Math.floor(weapPhysMin * RING_AMULET_ATTACK_PCT * 1.1);
      const aMax = Math.floor(weapPhysMax * RING_AMULET_ATTACK_PCT * 0.9);
      const bMax = Math.floor(weapPhysMax * RING_AMULET_ATTACK_PCT * 1.1);
      stats.minAttack = Math.max(1, randiRange(Math.min(aMin, bMin), Math.max(aMin, bMin)));
      stats.maxAttack = Math.max(1, randiRange(Math.min(aMax, bMax), Math.max(aMax, bMax)));
    } else {
      const aMin = Math.floor(weapSpellBase * RING_AMULET_ATTACK_PCT * 0.9);
      const bMin = Math.floor(weapSpellBase * RING_AMULET_ATTACK_PCT * 1.0);
      const aMax = Math.floor(weapSpellBase * RING_AMULET_ATTACK_PCT * 1.0);
      const bMax = Math.floor(weapSpellBase * RING_AMULET_ATTACK_PCT * 1.1);
      stats.minSpellAttack = Math.max(1, randiRange(Math.min(aMin, bMin), Math.max(aMin, bMin)));
      stats.maxSpellAttack = Math.max(1, randiRange(Math.min(aMax, bMax), Math.max(aMax, bMax)));
    }
  } else {
    stats = {
      maxHp: randiRange(Math.max(1, hpMin), Math.max(1, hpMax)),
      physDefense: randiRange(Math.max(1, defMin), Math.max(1, defMax))
    };
    stats.spellDefense = Math.floor(floatVal(stats.physDefense) * 0.8);
  }
  const greenCfg = getArmorGreenAttrConfig(q);
  const baseAttrs = (type === 'ring' || type === 'amulet')
    ? ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli', 'agility', 'phys_crit_damage_bonus', 'spell_crit_damage_bonus']
    : ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli', 'agility'];
  if (type === 'hands') baseAttrs.push('turn_end_mp');
  if (q >= 3) {
    if (type === 'ring' || type === 'amulet') {
      baseAttrs.push('phys_damage_pct', 'spell_damage_pct');
      baseAttrs.push('phys_flat_damage', 'spell_flat_damage');
    }
    else baseAttrs.push('phys_defense_pct', 'spell_defense_pct');
  }
  if (type === 'chest' && q >= 4) {
    baseAttrs.push('phys_defense_flat', 'spell_defense_flat');
  }
  const affixCount = noAffixes ? 0 : rollAffixCount();
  const statScale = {
    agility: 0.5, strength: 1.0, constitution: 1.0, bone: 1.0, zhenyuan: 1.0, lingli: 1.0,
    turn_end_mp: 1.0, phys_crit_damage_bonus: 1.0, spell_crit_damage_bonus: 1.0,
    phys_damage_pct: 1.0, spell_damage_pct: 1.0,
    phys_flat_damage: 1.0, spell_flat_damage: 1.0,
    phys_defense_pct: 1.0, spell_defense_pct: 1.0,
    phys_defense_flat: 1.0, spell_defense_flat: 1.0
  };
  const rollContext = {
    armor_type: type,
    base_phys_defense: intVal(stats.physDefense, 0),
    base_spell_defense: intVal(stats.spellDefense, 0)
  };
  const affixRoll = generateAffixes(
    q,
    baseAttrs,
    affixCount,
    intVal(greenCfg.value_min),
    intVal(greenCfg.value_max),
    statScale,
    maxAffixQuality,
    rollContext
  );
  const extraStats = affixRoll.extra_stats || {};
  const affixes = affixRoll.affixes || [];
  for (const k of Object.keys(extraStats)) stats[k] = intVal(extraStats[k], 0);

  const armorNames = {
    head: ['布帽', '皮帽', '灵帽', '法帽', '仙帽'],
    chest: ['布甲', '皮甲', '灵甲', '法甲', '仙甲'],
    shoulder: ['布肩', '皮肩', '灵肩', '法肩', '仙肩'],
    legs: ['布裤', '皮裤', '灵裤', '法裤', '仙裤'],
    hands: ['布手套', '皮手套', '灵手套', '法手套', '仙手套'],
    ring: ['布戒', '皮戒', '灵戒', '法戒', '仙戒'],
    amulet: ['布符', '皮符', '灵符', '法符', '仙符'],
    back: ['布披', '皮披', '灵披', '法披', '仙披']
  };
  const qualityNames = ['', '精', '灵', '法', '仙', '神', '神', '圣'];
  const namePrefix = q >= 1 && q < qualityNames.length ? qualityNames[q] : '';
  const baseNames = armorNames[type] || ['防具'];
  const baseName = baseNames[Math.min(q - 1, baseNames.length - 1)];
  const plainBaseName = namePrefix ? `${namePrefix}${baseName}` : baseName;
  const armorName = composeStandardEquipmentName(plainBaseName, affixes);
  const elements = ['金', '木', '水', '火', '土', '无'];
  const materials = ['皮质', '金属', '草木', '土石', '玉质'];
  const rarity = getRarityByAffixCount(affixCount);
  const item = {
    id: generatedEquipmentId(),
    name: armorName,
    baseName: plainBaseName,
    type,
    element: elements[Math.floor(Math.random() * elements.length)],
    material: materials[Math.floor(Math.random() * materials.length)],
    description: `制式${type}，属性随机生成`,
    stats,
    randomExtraStats: extraStats,
    affixes,
    affixCount,
    rarity: rarity.key,
    rarityName: rarity.name,
    quality: q,
    required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true
  };
  item.value = calculateItemValue(item);
  return item;
}
function buildAffixesFromExtraStats(extraStats, quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const out = [];
  const ex = extraStats && typeof extraStats === 'object' ? extraStats : {};
  for (const k of Object.keys(ex)) {
    const affixQ = rollAffixTier(quality, maxAffixQuality);
    const rollT = rollAffixRollTier();
    out.push({ name: getAffixName(k, affixQ), stat: k, quality: affixQ, tier: rollT, value: intVal(ex[k], 0) });
  }
  return out;
}
function _exWeaponAffixes(subtype, q, stats, maxAffixQuality) {
  const greenCfg = getArmorGreenAttrConfig(q);
  const affixCount = rollAffixCount();
  const basePool = {
    剑: ['strength', 'agility', 'bone', 'zhenyuan', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    刀: ['strength', 'constitution', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    长兵: ['strength', 'bone', 'constitution', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    弓: ['agility', 'lingli', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    拳爪: ['agility', 'zhenyuan', 'strength', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    音律: ['zhenyuan', 'lingli', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
    节杖: ['strength', 'constitution', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus']
  };
  const weaponPool = (basePool[subtype] || basePool.剑).slice();
  if (q >= 3) weaponPool.push('phys_damage_pct', 'spell_damage_pct');
  if (q >= 4) weaponPool.push('phys_lifesteal_pct', 'spell_lifesteal_pct');
  if (q >= 5) weaponPool.push('phys_splash_pct', 'spell_splash_pct');
  const statScale = {
    agility: 1.0, strength: 2.0, constitution: 2.0, bone: 2.0, zhenyuan: 2.0, lingli: 2.0,
    phys_crit_rate_bonus: 1.0, spell_crit_rate_bonus: 1.0,
    phys_lifesteal_pct: 1.0, spell_lifesteal_pct: 1.0,
    phys_damage_pct: 1.0, spell_damage_pct: 1.0,
    phys_splash_pct: 1.0, spell_splash_pct: 1.0
  };
  const affixRoll = generateAffixes(q, weaponPool, affixCount, intVal(greenCfg.value_min), intVal(greenCfg.value_max), statScale, maxAffixQuality, {});
  const extraStats = affixRoll.extra_stats || {};
  for (const k of Object.keys(extraStats)) {
    stats[k] = intVal(stats[k], 0) + intVal(extraStats[k], 0);
  }
  return { extraStats, affixes: affixRoll.affixes || [], affixCount };
}

function generateWanguchou(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physVal = Math.trunc(baseAvg * 0.1);
  const spellBase = baseAvg * 1.5;
  const stats = {
    minAttack: Math.max(1, physVal),
    maxAttack: Math.max(1, physVal),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('音律', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '万古愁',
    type: 'weapon',
    subtype: '音律',
    element: '无',
    material: '玉质',
    description: 'EX装备。音律类法术每次造成伤害时，随机附带一种负面状态（迟缓/绝脉/恐惧/缠缚/灼魂/寄生），多段伤害每段各触发。',
    flavor: '将进酒，将进酒，与尔同消万古愁。',
    stats,
    randomExtraStats: extraStats,
    affixes,
    affixCount,
    quality: q,
    required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true,
    isEx: true,
    exTemplate: '万古愁',
    tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateFuxiqin(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physVal = Math.trunc(baseAvg * 0.1);
  const spellBase = baseAvg * 1.6;
  const stats = {
    minAttack: Math.max(1, physVal),
    maxAttack: Math.max(1, physVal),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('音律', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '伏羲琴',
    type: 'weapon',
    subtype: '音律',
    element: '混元',
    material: '草木',
    description: 'EX装备。绝唱状态持续时间+1轮；法术攻击的暴击伤害系数增加12%。',
    flavor: '琴长三尺六寸五分，对应周天度数，宽六寸，象征天地六合，五弦对应五行，龙池、凤池分别含八卦与四时之象，泛音法天，散音法地，按音法人，使天人相和，五音相谐。',
    stats,
    randomExtraStats: extraStats,
    affixes,
    affixCount,
    quality: q,
    required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true,
    isEx: true,
    exTemplate: '伏羲琴',
    tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
const SET_META = {
  '劫灭-斗战乾坤': { element: '金', material: '金属', nameFn: (t) => `劫灭-斗战${({ head: '头盔', shoulder: '肩甲', chest: '胸甲', legs: '腿甲', hands: '手套', ring: '戒指', amulet: '项链', back: '披风' }[t] || '防具')}`, flavor: '历尽千劫心未冷，不平则鸣战乾坤' },
  '道妙-气象万千': { element: '无', material: '草木', nameFn: (t) => ({ head: '道妙-青云冠', shoulder: '道妙-流风护肩', chest: '道妙-万象袍', legs: '道妙-尘霭裙', hands: '道妙-朝露手套', amulet: '道妙-明昼链', ring: '道妙-月华戒', back: '道妙-丹霞帔' }[t] || '道妙-气象套件'), flavorFn: (t) => ({ head: '自鸿蒙初判。阴阳既分，清浊乃现。', shoulder: '大块噫气，其名为风，是唯无作，作则万窍怒呺', chest: '在天成象，在地成形，变化见矣。', legs: '尘霭虽微，合阴阳之气，禀动静之机。', hands: '夫露之为物，至轻至重。', amulet: '夫太阳者，天之枢机，道之显象也。', ring: '夫月华之出，非光也，乃道炁之流形。', back: '夫霞者，日精之馀晖也。' }[t] || '') },
  '浩渺-云上青鸾': { element: '木', material: '草木', nameFn: (t) => ({ head: '云上青鸾冠', shoulder: '云上青鸾披带', chest: '云上青鸾袍', legs: '云上青鸾裳', hands: '云上青鸾锦护', ring: '携风环', amulet: '带云坠', back: '青鸾影' }[t] || '浩渺-云上青鸾'), flavor: '木德敷荣，灵物呈瑞。于九霄之上，云海之间，有青鸾焉，栖于苍木之巅，翔于碧落之境，实乃木属之灵，道韵之彰也。' },
  '厉火-焚天炽地': { element: '火', material: '皮质', nameFn: (t) => `厉火-焚天炽地·${({ head: '头盔', shoulder: '肩甲', chest: '胸甲', legs: '腿甲', hands: '手套', ring: '戒指', amulet: '项链', back: '披风' }[t] || '防具')}`, flavor: '厉火所至，焚天炽地。火德刚烈，以皮为载，纳炎灵于一身，战意愈伤愈炽。' },
  '玄黄-永生不灭': { element: '土', material: '金属', nameFn: (t) => `玄黄-永生不灭·${({ head: '头盔', shoulder: '肩甲', chest: '胸甲', legs: '腿甲', hands: '手套', ring: '戒指', amulet: '项链', back: '披风' }[t] || '防具')}`, flavor: '玄黄者，天地之象也。厚德载物，永生不灭。以金为体，以土为用，守正不移。' },
  '异界-终结热寂': { element: '水', material: '皮质', nameFn: (t) => `异界-终结热寂·${({ head: '头盔', shoulder: '肩甲', chest: '胸甲', legs: '腿甲', hands: '手套', ring: '戒指', amulet: '项链', back: '披风' }[t] || '防具')}`, flavor: '热寂之终，异界之门。寒水凝时，万籁俱寂。' },
  '异界-数据入侵': {
    element: '无',
    material: '土石',
    nameFn: (t) => ({
      head: '拉普拉斯妖',
      chest: '泛在计算',
      back: '拒绝服务',
      hands: '渗透测试',
      ring: '逻辑炸弹',
      amulet: '恶意程序',
      legs: '蜂窝网络',
      shoulder: '内存溢出'
    }[t] || '异界-数据入侵'),
    flavor: '异界噪声侵入秩序之网，逻辑崩解，算力失真。'
  },
  '太初-浑天无极': { element: '混元', material: '玉质', nameFn: (t) => `太初-无极${({ head: '头冠', shoulder: '护肩', chest: '法衣', legs: '护腿', hands: '护手', ring: '戒', amulet: '坠', back: '披风' }[t] || '套件')}`, flavor: '太初未分，浑天无极。玉魄承混元，业念归一炁。' }
};

function applyExArmorMultipliers(baseItem) {
  const stats = baseItem.stats || {};
  if (stats.maxHp) stats.maxHp = Math.max(1, Math.trunc(stats.maxHp * 1.1));
  if (stats.physDefense) stats.physDefense = Math.max(1, Math.trunc(stats.physDefense * 1.1));
  if (stats.spellDefense) stats.spellDefense = Math.max(1, Math.trunc(stats.spellDefense * 1.1));
  const t = String(baseItem.type || '');
  if (t === 'ring' || t === 'amulet') {
    if (stats.minAttack) stats.minAttack = Math.max(1, Math.trunc(stats.minAttack * 1.2));
    if (stats.maxAttack) stats.maxAttack = Math.max(1, Math.trunc(stats.maxAttack * 1.2));
    if (stats.minSpellAttack) stats.minSpellAttack = Math.max(1, Math.trunc(stats.minSpellAttack * 1.2));
    if (stats.maxSpellAttack) stats.maxSpellAttack = Math.max(1, Math.trunc(stats.maxSpellAttack * 1.2));
  }
  baseItem.stats = stats;
}

function generateSetPiece(armorType, quality, setId = '劫灭-斗战乾坤', maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const t = EQUIPMENT_TYPES_ARMOR.includes(armorType) ? armorType : 'chest';
  const baseItem = generateArmor(t, q, maxAffixQuality);
  if (!baseItem || Object.keys(baseItem).length <= 0) return {};
  applyExArmorMultipliers(baseItem);
  const greenCfg = getArmorGreenAttrConfig(q);
  const valueMin = intVal(greenCfg.value_min, 15);
  const valueMax = intVal(greenCfg.value_max, 33);
  const baseAttrs = ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli', 'agility'];
  let extra = baseItem.randomExtraStats || {};
  if (Object.keys(extra).length <= 0) {
    const attr = baseAttrs[Math.floor(Math.random() * baseAttrs.length)];
    let vMin = valueMin, vMax = valueMax;
    if (attr === 'agility') { vMin = Math.max(1, Math.trunc(valueMin / 2)); vMax = Math.max(1, Math.trunc(valueMax / 2)); }
    const v = Math.max(1, randiRange(vMin, vMax));
    extra[attr] = v;
    baseItem.stats[attr] = (baseItem.stats[attr] || 0) + v;
    baseItem.randomExtraStats = extra;
  }
  const meta = SET_META[setId] || SET_META['劫灭-斗战乾坤'];
  baseItem.name = meta.nameFn(t);
  baseItem.element = meta.element;
  baseItem.material = meta.material;
  baseItem.description = `套装「${setId}」套件`;
  baseItem.flavor = (meta.flavorFn && meta.flavorFn(t)) || meta.flavor || baseItem.flavor || '';
  baseItem.isEx = true;
  baseItem.exTemplate = setId;
  baseItem.setId = setId;
  baseItem.tags = ['no_dungeon_loot'];
  if (!Array.isArray(baseItem.affixes) || baseItem.affixes.length <= 0) {
    baseItem.affixes = buildAffixesFromExtraStats(baseItem.randomExtraStats || {}, q, maxAffixQuality);
  }
  baseItem.affixCount = baseItem.affixes.length;
  baseItem.required_level = getRequiredLevelForItem(q, baseItem.affixes);
  baseItem.value = calculateItemValue(baseItem);
  return baseItem;
}
function generateZhenhunya(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.0 * 1.4;
  const spellBase = baseAvg * 1.15 * 1.3;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('拳爪', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '镇魂牙',
    type: 'weapon',
    subtype: '拳爪',
    element: '木',
    material: '金属',
    description: 'EX装备。特效：木属性亲和+25。',
    flavor: '夫大道至虚，心性本静。人生而静，天之性也；感而后动，物之扰也。一念既起，则千障丛生，如云蔽日，如尘覆镜。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '镇魂牙', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateWeiyuesha(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.3 * 1.2;
  const spellBase = baseAvg * 0.45 * 1.6;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05)),
    agility: -Math.trunc(floatVal(realm.base_agility) * 0.5)
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('长兵', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '危月煞',
    type: 'weapon',
    subtype: '长兵',
    element: '土',
    material: '金属',
    description: 'EX装备。自身物防/法防减伤公式的基准除数降低1000点（公式：减伤率=1-1/(pow(防御/除数,0.42)+1)），减伤更强；物理防御与法术防御各提高10%。',
    flavor: '煞气垂临，侵扰寰宇。非寻常灾星，乃黑道凶神之属，与天刑、白虎同列，主兵戈、疾疫、土木之殃。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '危月煞', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateWanfajiekong(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.0 * 1.25;
  const spellBase = baseAvg * 1.0 * 1.25;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('剑', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '万法皆空',
    type: 'weapon',
    subtype: '剑',
    element: '混元',
    material: '玉质',
    description: 'EX装备。每次行动后有25%几率触发万法皆空，清除目标身上正面状态，每种状态造成35%基础属性最高项的绝对伤害。',
    flavor: '空者，非空无之空，乃空灵之空，空寂之空。如虚空涵万象，似明镜照万物。虽空而不碍有，虽有而归于空。有与空，相辅相成，相生相灭。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '万法皆空', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateZuiyeyiju(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.2 * 1.25;
  const spellBase = baseAvg * 0.45 * 0.9;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('刀', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '罪业一炬',
    type: 'weapon',
    subtype: '刀',
    element: '火',
    material: '金属',
    description: 'EX装备。造成物理伤害时施加穿心（1轮+技能穿心轮次）；对已被穿心的目标重复施加穿心时，改为根据即将施加的穿心轮次数附带多次必定暴击的物理攻击力20%的物理伤害。',
    flavor: '且夫火者，清净之象，光明之征。能焚秽物，可净浊尘。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '罪业一炬', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}
function generateHuang(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 0.67 * 1.2;
  const spellBase = baseAvg * 1.22 * 1.25;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05)),
    agility: Math.trunc(floatVal(realm.base_agility) * 1.5)
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('弓', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '荒',
    type: 'weapon',
    subtype: '弓',
    element: '火',
    material: '草木',
    description: 'EX装备。蓄力期间可以正常行动，但此期间造成的所有伤害降低50%；使用非蓄力技能时获得12%法术穿透。',
    flavor: '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。荒者，万物未生之始，亦万物归寂之终。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '荒', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateMan(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 0.67 * 1.2;
  const spellBase = baseAvg * 1.22 * 1.25;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05)),
    agility: Math.trunc(floatVal(realm.base_agility) * 1.5)
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('弓', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '蛮',
    type: 'weapon',
    subtype: '弓',
    element: '金',
    material: '金属',
    description: 'EX装备。蓄力技能改为立即释放，但伤害降低50%；若该次蓄力技能击杀目标，则重置该技能冷却。',
    flavor: '其势若蛮雷裂空，弦发无回，箭鸣即决。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '蛮', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateShengguitage(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physVal = Math.trunc(baseAvg * 0.1);
  const spellBase = baseAvg * 1.6;
  const stats = {
    minAttack: Math.max(1, physVal),
    maxAttack: Math.max(1, physVal),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('音律', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '神鬼踏歌',
    type: 'weapon',
    subtype: '音律',
    element: '无',
    material: '金属',
    description: 'EX装备。法术直接伤害获得25%-35%溅射；若没有可溅射目标，则本次法术最终伤害提高13%。',
    flavor: '一曲踏歌，神惊鬼泣；余音未绝，万象俱震。',
    stats,
    randomExtraStats: extraStats,
    affixes,
    affixCount,
    quality: q,
    required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true,
    isEx: true,
    exTemplate: '神鬼踏歌',
    tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateShifangtianhua(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.0 * 1.25;
  const spellBase = baseAvg * 1.0 * 1.25;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('剑', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '十方天华',
    type: 'weapon',
    subtype: '剑',
    element: '混元',
    material: '草木',
    description: 'EX装备。造成的所有伤害均为自适应伤害（按目标较低防御自动判定为物理或法术伤害）。',
    flavor: '十方同辉，天华流照；剑出则万籁归寂。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '十方天华', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateTianyalu(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.2 * 1.25;
  const spellBase = baseAvg * 0.45 * 0.9;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('刀', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '天涯路',
    type: 'weapon',
    subtype: '刀',
    element: '金',
    material: '草木',
    description: 'EX装备。物理暴击率+10%，且多击技能不再衰减。',
    flavor: '天涯路远，刀行无悔。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '天涯路', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateHenbieli(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.0 * 1.4;
  const spellBase = baseAvg * 1.15 * 1.3;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('拳爪', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '恨别离',
    type: 'weapon',
    subtype: '拳爪',
    element: '木',
    material: '草木',
    description: 'EX装备。使用绽放引爆DOT后，按引爆DOT种类数触发离恨回响：每种造成[(物攻上限+法攻)/2]×8%直接伤害；PVP为65%系数；团战对其余敌人额外造成40%余响。',
    flavor: '恨别离，离时恨更生。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '恨别离', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateFeiguang(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.3 * 1.2;
  const spellBase = baseAvg * 0.45 * 1.6;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05)),
    agility: -Math.trunc(floatVal(realm.base_agility) * 0.5)
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('长兵', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '飞光',
    type: 'weapon',
    subtype: '长兵',
    element: '土',
    material: '土石',
    description: 'EX装备。反击伤害提高25%（PVP中为15%）。',
    flavor: '飞光掠影，一刹惊尘。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '飞光', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateChunqiu(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.23 * 1.25;
  const spellBase = baseAvg * 0.75 * 1.2;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('节杖', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '春秋',
    type: 'weapon',
    subtype: '节杖',
    element: '水',
    material: '金属',
    description: 'EX装备。造成伤害后回复伤害量12%的生命值；每次造成伤害时额外造成自身最大生命值3%的附加伤害。',
    flavor: '微言大义，褒贬善恶。一字之褒，荣于华衮；一字之贬，严于斧钺。春秋者，天地之经纬，万世之法度也。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '春秋', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateCangshengbi(quality, maxAffixQuality = MAX_AFFIX_TIER) {
  const q = clampi(quality, 4, 7);
  const realm = getRealmStatsForQuality(q);
  const baseAvg = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
  const physBase = baseAvg * 1.08 * 1.2;
  const spellBase = baseAvg * 1.08 * 1.2;
  const stats = {
    minAttack: Math.max(1, Math.trunc(physBase * 0.95)),
    maxAttack: Math.max(1, Math.trunc(physBase * 1.05)),
    minSpellAttack: Math.max(1, Math.trunc(spellBase * 0.95)),
    maxSpellAttack: Math.max(1, Math.trunc(spellBase * 1.05))
  };
  const { extraStats, affixes, affixCount } = _exWeaponAffixes('节杖', q, stats, maxAffixQuality);
  const item = {
    id: generatedEquipmentId(),
    name: '苍生笔',
    type: 'weapon',
    subtype: '节杖',
    element: '木',
    material: '玉质',
    description: 'EX装备。仅非PVP生效：使用带伤害的治疗技能时，放弃该技能治疗，改为追加目标已损生命18%的诛邪伤害；目标生命低于13%时直接斩灭。',
    flavor: '以笔济世，亦可诛邪。',
    stats, randomExtraStats: extraStats, affixes, affixCount,
    quality: q, required_level: getRequiredLevelForItem(q, affixes),
    isGenerated: true, isEx: true, exTemplate: '苍生笔', tags: ['no_dungeon_loot']
  };
  item.value = calculateItemValue(item);
  return item;
}

function generateExEquipment(templateId, quality, armorTypeOverride = '', maxAffixQuality = MAX_AFFIX_TIER) {
  if (templateId === '苍生笔') return generateCangshengbi(quality, maxAffixQuality);
  if (templateId === '春秋') return generateChunqiu(quality, maxAffixQuality);
  if (templateId === '荒') return generateHuang(quality, maxAffixQuality);
  if (templateId === '蛮') return generateMan(quality, maxAffixQuality);
  if (templateId === '万古愁') return generateWanguchou(quality, maxAffixQuality);
  if (templateId === '神鬼踏歌') return generateShengguitage(quality, maxAffixQuality);
  if (templateId === '伏羲琴') return generateFuxiqin(quality, maxAffixQuality);
  if (templateId === '镇魂牙') return generateZhenhunya(quality, maxAffixQuality);
  if (templateId === '危月煞') return generateWeiyuesha(quality, maxAffixQuality);
  if (templateId === '万法皆空') return generateWanfajiekong(quality, maxAffixQuality);
  if (templateId === '十方天华') return generateShifangtianhua(quality, maxAffixQuality);
  if (templateId === '罪业一炬') return generateZuiyeyiju(quality, maxAffixQuality);
  if (templateId === '天涯路') return generateTianyalu(quality, maxAffixQuality);
  if (templateId === '恨别离') return generateHenbieli(quality, maxAffixQuality);
  if (templateId === '飞光') return generateFeiguang(quality, maxAffixQuality);
  const SET_IDS = ['劫灭-斗战乾坤', '道妙-气象万千', '浩渺-云上青鸾', '厉火-焚天炽地', '玄黄-永生不灭', '异界-终结热寂', '异界-数据入侵', '太初-浑天无极'];
  if (SET_IDS.includes(templateId)) {
    const at = armorTypeOverride || EQUIPMENT_TYPES_ARMOR[Math.floor(Math.random() * EQUIPMENT_TYPES_ARMOR.length)];
    return generateSetPiece(at, quality, templateId, maxAffixQuality);
  }
  return {};
}

function isValidEquipType(equipType) {
  return equipType === 'weapon' || EQUIPMENT_TYPES_WEAPON.includes(equipType) || EQUIPMENT_TYPES_ARMOR.includes(equipType);
}
function isCatalystItem(itemId) {
  return CATALYST_ITEM_IDS.includes(intVal(itemId));
}
function canBeForgingMaterial(item) {
  if (!item || typeof item !== 'object') return false;
  const t = String(item.type || '');
  const q = intVal(item.quality, 1);
  return ['material', 'herb', 'medicine'].includes(t) && q >= 1 && q <= 6;
}
function rollQualityFromMain(mainTier, mainCount) {
  const mt = clampi(mainTier, 1, 8);
  const c = intVal(mainCount, 1);
  if (c <= 0) return mt;
  if (c >= 100) return clampi(mt + 1, 1, 8);
  if (c >= 20) {
    const pPlus = (c - 20) / 80.0;
    if (randf() < pPlus) return clampi(mt + 1, 1, 8);
    return clampi(mt, 1, 8);
  }
  const pSame = 0.5 + (0.5 * (c - 1)) / 19.0;
  if (randf() < pSame) return clampi(mt, 1, 8);
  return clampi(mt - 1, 1, 8);
}
function rollElementFromLing(lingElement, lingTier) {
  if (intVal(lingTier, 1) >= 6) return lingElement ? String(lingElement) : '无';
  let pSame = 0.1 + 0.15 * (intVal(lingTier, 1) - 1);
  if (intVal(lingTier, 1) <= 0) pSame = 0.1;
  if (randf() < pSame) return lingElement ? String(lingElement) : '无';
  return ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
}
function rollExFromCatalyst(catalystTier) {
  const ct = intVal(catalystTier, 1);
  if (ct >= 6) return true;
  let pEx = 0.0;
  if (ct === 3) pEx = 0.1;
  else if (ct === 4) pEx = 0.25;
  else if (ct === 5) pEx = 0.5;
  return randf() < pEx;
}
function executeForging(equipType, mainItem, mainCount, lingItem, catalystItem, maxAffixQuality = MAX_AFFIX_TIER) {
  if (!mainItem || !lingItem || !catalystItem) return {};
  if (!isValidEquipType(equipType)) return {};
  if (!isCatalystItem(intVal(catalystItem.id))) return {};
  const mainTier = clampi(intVal(mainItem.quality, 1), 1, 6);
  const mainCountClamped = clampi(mainCount, 1, 100);
  const lingTier = clampi(intVal(lingItem.quality, 1), 1, 6);
  const catalystTier = clampi(intVal(catalystItem.quality, 1), 1, 6);
  const resultQuality = rollQualityFromMain(mainTier, mainCountClamped);
  const resultElement = rollElementFromLing(String(lingItem.element || '无'), lingTier);
  const resultMaterial = String(mainItem.material || '金属');
  let isEx = resultQuality >= 4 && rollExFromCatalyst(catalystTier);
  if (resultQuality < 4) isEx = false;
  let exTemplateId = '';
  if (isEx) {
    if (equipType === '音律') {
      if (resultMaterial === '玉质' && resultElement === '无') exTemplateId = '万古愁';
      else if (resultMaterial === '金属' && resultElement === '无') exTemplateId = '神鬼踏歌';
      else if (resultMaterial === '草木' && resultElement === '混元') exTemplateId = '伏羲琴';
    } else if (equipType === '拳爪' && resultMaterial === '金属' && resultElement === '木') exTemplateId = '镇魂牙';
    else if (equipType === '拳爪' && resultMaterial === '草木' && resultElement === '木') exTemplateId = '恨别离';
    else if (equipType === '长兵' && resultMaterial === '金属' && resultElement === '土') exTemplateId = '危月煞';
    else if (equipType === '长兵' && resultMaterial === '土石' && resultElement === '土') exTemplateId = '飞光';
    else if (equipType === '剑' && resultMaterial === '玉质' && resultElement === '混元') exTemplateId = '万法皆空';
    else if (equipType === '剑' && resultMaterial === '草木' && resultElement === '混元') exTemplateId = '十方天华';
    else if (equipType === '刀' && resultMaterial === '金属' && resultElement === '火') exTemplateId = '罪业一炬';
    else if (equipType === '刀' && resultMaterial === '草木' && resultElement === '金') exTemplateId = '天涯路';
    else if (equipType === '弓' && resultMaterial === '草木' && resultElement === '火') exTemplateId = '荒';
    else if (equipType === '弓' && resultMaterial === '金属' && resultElement === '金') exTemplateId = '蛮';
    else if (equipType === '节杖' && resultMaterial === '金属' && resultElement === '水') exTemplateId = '春秋';
    else if (equipType === '节杖' && resultMaterial === '玉质' && resultElement === '木') exTemplateId = '苍生笔';
    else if (EQUIPMENT_TYPES_ARMOR.includes(equipType)) {
      if (resultMaterial === '金属' && resultElement === '金') exTemplateId = '劫灭-斗战乾坤';
      else if (resultMaterial === '草木' && resultElement === '无') exTemplateId = '道妙-气象万千';
      else if (resultMaterial === '草木' && resultElement === '木') exTemplateId = '浩渺-云上青鸾';
      else if (resultMaterial === '皮质' && resultElement === '火') exTemplateId = '厉火-焚天炽地';
      else if (resultMaterial === '金属' && resultElement === '土') exTemplateId = '玄黄-永生不灭';
      else if (resultMaterial === '皮质' && resultElement === '水') exTemplateId = '异界-终结热寂';
      else if (resultMaterial === '土石' && resultElement === '无') exTemplateId = '异界-数据入侵';
      else if (resultMaterial === '玉质' && resultElement === '混元') exTemplateId = '太初-浑天无极';
    }
  }
  let equipment = {};
  if (exTemplateId) {
    const armorOverride = EQUIPMENT_TYPES_ARMOR.includes(equipType) ? equipType : '';
    equipment = generateExEquipment(exTemplateId, resultQuality, armorOverride, maxAffixQuality);
    if (equipment && Object.keys(equipment).length > 0) {
      equipment.element = resultElement;
      equipment.material = resultMaterial;
    }
  } else {
    if (EQUIPMENT_TYPES_WEAPON.includes(equipType)) equipment = generateWeapon(equipType, resultQuality, maxAffixQuality);
    else if (equipType === 'weapon') equipment = generateWeapon('剑', resultQuality, maxAffixQuality);
    else equipment = generateArmor(equipType, resultQuality, maxAffixQuality);
    if (equipment && Object.keys(equipment).length > 0) {
      equipment.element = resultElement;
      equipment.material = resultMaterial;
    }
  }
  return equipment || {};
}

function calculateUpgradeSuccessRate(equipment, materialItem, materialCount, mode) {
  const q = clampi(intVal(equipment.quality, 1), 1, 8);
  const mq = clampi(intVal(materialItem.quality, 1), 1, 8);
  const c = clampi(materialCount, 1, 100);
  if (q >= 8) return 0.0;
  if (mode === 'target') {
    if (mq !== q + 1) return 0.0;
    return clampf(c / 20.0, 0.0, 1.0);
  }
  if (mq !== q) return 0.0;
  if (c < 20) return 0.0;
  return clampf((c - 20.0) / 80.0, 0.0, 1.0);
}
function calculateAffixDowngradeSuccessRate(affixQuality, materialItem, materialCount, mode) {
  const q = clampi(intVal(affixQuality, 1), 1, MAX_AFFIX_TIER);
  const mq = clampi(intVal(materialItem?.quality, 1), 1, MAX_AFFIX_TIER);
  const c = clampi(materialCount, 1, 100);
  if (q <= 1) return 0.0;
  if (mode === 'target') {
    if (mq !== q - 1) return 0.0;
    return clampf(c / 50.0, 0.0, 1.0);
  }
  if (mode !== 'current') return 0.0;
  if (mq !== q) return 0.0;
  return clampf(c / 10.0, 0.0, 1.0);
}
function getAffixTierRerollT8Chance(materialQuality) {
  const q = clampi(intVal(materialQuality, 1), 1, MAX_AFFIX_TIER);
  if (q <= 3) return 0.0;
  if (q === 4) return 0.02;
  if (q === 5) return 0.06;
  if (q === 6) return 0.10;
  if (q === 7) return 0.15;
  return 0.20;
}
function getAffixTierRerollBaseWeights(materialQuality) {
  const q = clampi(intVal(materialQuality, 1), 1, MAX_AFFIX_TIER);
  if (q === 1) return [34, 26, 18, 12, 6, 3, 1];
  if (q === 2) return [26, 23, 20, 14, 9, 6, 2];
  if (q === 3) return [20, 20, 20, 16, 12, 8, 4];
  if (q === 4) return [14, 16, 18, 18, 15, 11, 8];
  if (q === 5) return [11, 13, 16, 18, 17, 14, 11];
  if (q === 6) return [9, 11, 14, 17, 18, 16, 15];
  if (q === 7) return [7, 9, 12, 15, 18, 19, 20];
  return [6, 8, 11, 14, 17, 19, 21];
}
function getAffixTierRerollWeights(materialQuality) {
  const q = clampi(intVal(materialQuality, 1), 1, MAX_AFFIX_TIER);
  const base = getAffixTierRerollBaseWeights(q);
  let total = 0;
  for (const w of base) total += Math.max(0, floatVal(w, 0));
  if (total <= 0) total = 1;
  const t8Chance = getAffixTierRerollT8Chance(q);
  const remain = Math.max(0, 1 - t8Chance);
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    out.push(remain * (Math.max(0, floatVal(base[i], 0)) / total));
  }
  out.push(t8Chance);
  return out;
}
function rollTierByWeights(weights) {
  const ws = Array.isArray(weights) ? weights : [];
  let total = 0;
  for (const w of ws) total += Math.max(0, floatVal(w, 0));
  if (total <= 0) return 1;
  const r = randf() * total;
  let acc = 0;
  for (let i = 0; i < ws.length; i += 1) {
    acc += Math.max(0, floatVal(ws[i], 0));
    if (r <= acc) return i + 1;
  }
  return Math.max(1, ws.length);
}
function normalizeAffixes(item) {
  const affixes = Array.isArray(item.affixes) ? item.affixes : [];
  if (affixes.length <= 0) {
    const extra = item.randomExtraStats && typeof item.randomExtraStats === 'object' ? item.randomExtraStats : {};
    return Object.keys(extra).map(stat => ({ name: getAffixName(stat, 1), stat, quality: 1, tier: 1, value: intVal(extra[stat], 0) }));
  }
  const out = [];
  for (const a of affixes) {
    if (!a || typeof a !== 'object') continue;
    const stat = String(a.stat || '');
    const affixQ = clampi(intVal(a.quality, intVal(a.tier, 1)), 1, MAX_AFFIX_TIER);
    const rollT = clampi(intVal(a.tier, affixQ), 1, MAX_AFFIX_TIER);
    const value = intVal(a.value, 0);
    out.push({ name: getAffixName(stat, affixQ), stat, quality: affixQ, tier: rollT, value });
  }
  return out;
}
function affixesToExtraStats(affixes) {
  const out = {};
  for (const a of Array.isArray(affixes) ? affixes : []) {
    if (!a || typeof a !== 'object') continue;
    const stat = String(a.stat || '');
    if (!stat) continue;
    out[stat] = intVal(out[stat], 0) + intVal(a.value, 0);
  }
  return out;
}
function extractBaseStats(item) {
  const baseStats = item.stats && typeof item.stats === 'object' ? deepClone(item.stats) : {};
  const extra = item.randomExtraStats && typeof item.randomExtraStats === 'object' ? item.randomExtraStats : {};
  for (const k of Object.keys(extra)) {
    if (Object.prototype.hasOwnProperty.call(baseStats, k)) baseStats[k] = intVal(baseStats[k], 0) - intVal(extra[k], 0);
  }
  return baseStats;
}
function mergeBaseAndExtra(baseStats, extraStats) {
  const out = deepClone(baseStats || {});
  for (const k of Object.keys(extraStats || {})) out[k] = intVal(out[k], 0) + intVal(extraStats[k], 0);
  return out;
}
function extractBaseStatsFromAffixes(item, affixes) {
  const baseStats = item && item.stats && typeof item.stats === 'object' ? deepClone(item.stats) : {};
  const extra = affixesToExtraStats(affixes);
  for (const k of Object.keys(extra)) {
    if (Object.prototype.hasOwnProperty.call(baseStats, k)) {
      baseStats[k] = intVal(baseStats[k], 0) - intVal(extra[k], 0);
    }
  }
  return baseStats;
}
function areStatMapsEqual(a, b) {
  const left = a && typeof a === 'object' ? a : {};
  const right = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const k of keys) {
    if (intVal(left[k], 0) !== intVal(right[k], 0)) return false;
  }
  return true;
}
function isExEquipment(item) {
  if (!item || typeof item !== 'object') return false;
  if (Boolean(item.isEx) || Boolean(item.is_ex)) return true;
  const tpl = String(item.exTemplate || item.ex_template || '').trim();
  return tpl.length > 0;
}
function sanitizeEquipmentAffixValuesByQualityTier(equipment) {
  if (!equipment || typeof equipment !== 'object') {
    return { changed: false, equipment, correctedAffixCount: 0 };
  }
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) {
    return { changed: false, equipment, correctedAffixCount: 0 };
  }

  const itemQuality = clampi(intVal(equipment.quality, 1), 1, MAX_AFFIX_TIER);
  const isExItem = isExEquipment(equipment);
  const oldAffixes = normalizeAffixes(equipment);
  const oldExtraByAffixes = affixesToExtraStats(oldAffixes);
  const contextItem = deepClone(equipment);
  contextItem.randomExtraStats = oldExtraByAffixes;
  const affixContext = getAffixContext(contextItem, itemQuality);
  const newAffixes = [];
  let correctedAffixCount = 0;
  let affixesChanged = false;

  for (const oldAffix of oldAffixes) {
    if (!oldAffix || typeof oldAffix !== 'object') continue;
    const stat = String(oldAffix.stat || '');
    if (!stat) continue;
    const oldQRaw = intVal(oldAffix.quality, intVal(oldAffix.tier, 1));
    const oldTRaw = intVal(oldAffix.tier, oldQRaw);
    const affixQ = clampi(oldQRaw, 1, MAX_AFFIX_TIER);
    const rollT = clampi(oldTRaw, 1, MAX_AFFIX_TIER);
    const tierRange = getAffixTierRangeByContext(stat, affixQ, rollT, affixContext);
    const minV = intVal(tierRange?.min, 0);
    const maxV = Math.max(minV, intVal(tierRange?.max, minV));
    const oldValue = intVal(oldAffix.value, minV);
    const newValue = clampi(oldValue, minV, maxV);
    if (newValue !== oldValue) correctedAffixCount += 1;
    const newName = getAffixName(stat, affixQ);
    if (newValue !== oldValue || affixQ !== oldQRaw || rollT !== oldTRaw || String(oldAffix.name || '') !== newName) {
      affixesChanged = true;
    }
    newAffixes.push({
      name: newName,
      stat,
      quality: affixQ,
      tier: rollT,
      value: newValue
    });
  }

  const baseOld = extractBaseStatsFromAffixes(equipment, oldAffixes);
  const repairedLegacyWhite = repairRingAmuletLegacyAttackWhiteStats(equipment, baseOld, itemQuality);
  const repairedAnomalyWhite = repairWhiteStatsByRangeAndExMultiplier(equipment, repairedLegacyWhite.stats, itemQuality);
  const correctedWhiteStatCount =
    Math.max(0, intVal(repairedLegacyWhite.correctedStatCount, 0))
    + Math.max(0, intVal(repairedAnomalyWhite.correctedStatCount, 0));
  const extraNew = affixesToExtraStats(newAffixes);
  const statsNew = mergeBaseAndExtra(repairedAnomalyWhite.stats, extraNew);
  const rarity = getRarityByAffixCount(newAffixes.length);
  const requiredLevel = getRequiredLevelForItem(itemQuality, newAffixes);

  const oldStats = equipment.stats && typeof equipment.stats === 'object' ? equipment.stats : {};
  const oldExtra = equipment.randomExtraStats && typeof equipment.randomExtraStats === 'object' ? equipment.randomExtraStats : {};
  const oldAffixCount = intVal(equipment.affixCount, oldAffixes.length);
  const oldRequiredLevel = intVal(equipment.required_level, requiredLevel);
  const oldQuality = intVal(equipment.quality, itemQuality);
  const metadataChanged =
    oldAffixCount !== newAffixes.length ||
    oldRequiredLevel !== requiredLevel ||
    oldQuality !== itemQuality ||
    Boolean(equipment.isEx) !== isExItem ||
    String(equipment.rarity || '') !== String(rarity.key) ||
    String(equipment.rarityName || '') !== String(rarity.name) ||
    !areStatMapsEqual(oldExtra, extraNew) ||
    !areStatMapsEqual(oldStats, statsNew);

  if (!affixesChanged && !metadataChanged) {
    return { changed: false, equipment, correctedAffixCount: 0, correctedWhiteStatCount: 0 };
  }

  const result = deepClone(equipment);
  result.quality = itemQuality;
  result.affixes = newAffixes;
  result.affixCount = newAffixes.length;
  result.randomExtraStats = extraNew;
  result.stats = statsNew;
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = requiredLevel;
  result.isEx = isExItem;
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, newAffixes);
  }
  result.value = calculateItemValue(result);

  return { changed: true, equipment: result, correctedAffixCount, correctedWhiteStatCount };
}
function getAffixContext(item, quality) {
  const equipType = String(item.type || '');
  const q = clampi(intVal(quality, 1), 1, 8);
  const cfg = getArmorGreenAttrConfig(quality);
  if (equipType === 'weapon' || EQUIPMENT_TYPES_WEAPON.includes(equipType)) {
    const subtype = equipType === 'weapon' ? String(item.subtype || '剑') : equipType;
    const basePool = {
      剑: ['strength', 'agility', 'bone', 'zhenyuan', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      刀: ['strength', 'constitution', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      长兵: ['strength', 'bone', 'constitution', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      弓: ['agility', 'lingli', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      拳爪: ['agility', 'zhenyuan', 'strength', 'lingli', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      音律: ['zhenyuan', 'lingli', 'bone', 'agility', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus'],
      节杖: ['strength', 'constitution', 'bone', 'zhenyuan', 'phys_crit_rate_bonus', 'spell_crit_rate_bonus']
    };
    const weaponPool = (basePool[subtype] || basePool.剑).slice();
    if (q >= 3) weaponPool.push('phys_damage_pct', 'spell_damage_pct');
    if (q >= 4) weaponPool.push('phys_lifesteal_pct', 'spell_lifesteal_pct');
    if (q >= 5) weaponPool.push('phys_splash_pct', 'spell_splash_pct');
    return {
      pool_stats: weaponPool,
      value_min: Math.max(1, intVal(cfg.value_min, 15)),
      value_max: Math.max(1, intVal(cfg.value_max, 33)),
      stat_scale: {
        agility: 1.0, strength: 2.0, constitution: 2.0, bone: 2.0, zhenyuan: 2.0, lingli: 2.0,
        phys_crit_rate_bonus: 1.0, spell_crit_rate_bonus: 1.0,
        phys_lifesteal_pct: 1.0, spell_lifesteal_pct: 1.0,
        phys_damage_pct: 1.0, spell_damage_pct: 1.0,
        phys_splash_pct: 1.0, spell_splash_pct: 1.0
      }
    };
  }
  const armorType = String(item.type || '');
  const baseStats = extractBaseStats(item);
  const poolStats = (armorType === 'ring' || armorType === 'amulet')
    ? ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli', 'agility', 'phys_crit_damage_bonus', 'spell_crit_damage_bonus']
    : ['strength', 'constitution', 'bone', 'zhenyuan', 'lingli', 'agility'];
  if (armorType === 'hands') poolStats.push('turn_end_mp');
  if (q >= 3) {
    if (armorType === 'ring' || armorType === 'amulet') {
      poolStats.push('phys_damage_pct', 'spell_damage_pct');
      poolStats.push('phys_flat_damage', 'spell_flat_damage');
    }
    else poolStats.push('phys_defense_pct', 'spell_defense_pct');
  }
  if (armorType === 'chest' && q >= 4) {
    poolStats.push('phys_defense_flat', 'spell_defense_flat');
  }
  return {
    pool_stats: poolStats,
    value_min: Math.max(1, intVal(cfg.value_min, 15)),
    value_max: Math.max(1, intVal(cfg.value_max, 33)),
    armor_type: armorType,
    stat_scale: {
      agility: 0.5, strength: 1.0, constitution: 1.0, bone: 1.0, zhenyuan: 1.0, lingli: 1.0,
      turn_end_mp: 1.0, phys_crit_damage_bonus: 1.0, spell_crit_damage_bonus: 1.0,
      phys_damage_pct: 1.0, spell_damage_pct: 1.0,
      phys_flat_damage: 1.0, spell_flat_damage: 1.0,
      phys_defense_pct: 1.0, spell_defense_pct: 1.0,
      phys_defense_flat: 1.0, spell_defense_flat: 1.0
    },
    base_phys_defense: intVal(baseStats?.physDefense, intVal(item?.stats?.physDefense, 0)),
    base_spell_defense: intVal(baseStats?.spellDefense, intVal(item?.stats?.spellDefense, 0))
  };
}
function calcRollRatio(v, minV, maxV) {
  const lo = intVal(minV, 0);
  const hi = intVal(maxV, 0);
  if (hi <= lo) return 0.0;
  return clampf((floatVal(v, 0) - lo) / (hi - lo), 0.0, 1.0);
}
function ratioToValue(ratio, minV, maxV) {
  const lo = intVal(minV, 0);
  const hi = intVal(maxV, 0);
  if (hi <= lo) return lo;
  return Math.round(lo + clampf(ratio, 0.0, 1.0) * (hi - lo));
}
function getAffixQualityConfigByStat(stat, affixQuality, fallbackMin, fallbackMax) {
  const s = String(stat || '');
  const q = clampi(intVal(affixQuality, 1), 1, MAX_AFFIX_TIER);
  if (s === 'strength' || s === 'constitution' || s === 'bone' || s === 'agility' || s === 'zhenyuan' || s === 'lingli') {
    return getArmorGreenAttrConfig(q);
  }
  if (s === 'turn_end_mp') return getTurnEndMpAffixConfig(q);
  if (s === 'phys_crit_rate_bonus' || s === 'spell_crit_rate_bonus') return getCritRateAffixConfig(q);
  if (s === 'phys_crit_damage_bonus' || s === 'spell_crit_damage_bonus') return getCritDamageAffixConfig(q);
  if (s === 'phys_lifesteal_pct' || s === 'spell_lifesteal_pct') return getLifestealAffixConfig(q);
  if (s === 'phys_damage_pct' || s === 'spell_damage_pct') return getDamagePctAffixConfig(q);
  if (s === 'phys_flat_damage' || s === 'spell_flat_damage') return getFlatDamageAffixConfig(q);
  if (s === 'phys_defense_pct' || s === 'spell_defense_pct') return getDefensePctAffixConfig(q);
  if (s === 'phys_splash_pct' || s === 'spell_splash_pct') return getSplashPctAffixConfig(q);
  return {
    value_min: intVal(fallbackMin, 1),
    value_max: Math.max(intVal(fallbackMin, 1), intVal(fallbackMax, 2))
  };
}
function getAffixTierRangeByContext(stat, affixQuality, rollTier, ctx) {
  const specialRange = getSpecialAffixRange(stat, affixQuality, rollTier, ctx);
  if (specialRange) return specialRange;
  const baseValueMin = intVal(ctx?.value_min, 1);
  const baseValueMax = intVal(ctx?.value_max, baseValueMin);
  const statScale = ctx?.stat_scale || {};
  const qCfg = getAffixQualityConfigByStat(stat, affixQuality, baseValueMin, baseValueMax);
  const scale = floatVal(statScale[String(stat || '')], 1.0);
  const bMin = Math.max(1, Math.trunc(intVal(qCfg.value_min, baseValueMin) * scale));
  const bMax = Math.max(bMin, Math.trunc(intVal(qCfg.value_max, baseValueMax) * scale));
  return getAffixValueRangeForTier(bMin, bMax, rollTier);
}
// 升品当前不改变词缀Q/T和值，仅做字段归一化与命名刷新。
function normalizeAffixesForUpgrade(affixes) {
  const out = [];
  for (const a of affixes) {
    if (!a || typeof a !== 'object') continue;
    const stat = String(a.stat || '');
    const affixQ = clampi(intVal(a.quality, intVal(a.tier, 1)), 1, MAX_AFFIX_TIER);
    const rollT = clampi(intVal(a.tier, affixQ), 1, MAX_AFFIX_TIER);
    const newValue = intVal(a.value, 0);
    out.push({ name: getAffixName(stat, affixQ), stat, quality: affixQ, tier: rollT, value: newValue });
  }
  return out;
}
function remapWhiteStatsByRatio(item, baseStats, oldQuality, newQuality) {
  // 升品仅对白字做“保留roll相对位置”的映射：
  // 在旧品阶区间里计算比例，再投影到新品阶对应白字区间。
  // 词缀Q/T和值不在这里重算（见 normalizeAffixesForUpgrade）。
  const equipType = String(item.type || '');
  const out = deepClone(baseStats || {});

  // ── EX装备：等比缩放，保留EX自定义倍率 ──────────────────────
  // 制式装备用区间映射+clamp，但EX白字超出标准区间，clamp会吃掉EX增幅。
  // 改为按品阶基准中值做纯比例缩放，不经过标准区间clamp。
  if (Boolean(item.isEx)) {
    if (equipType === 'weapon') {
      const realmOld = getRealmStatsForQuality(oldQuality);
      const realmNew = getRealmStatsForQuality(newQuality);
      const oldMid = (floatVal(realmOld.base_attack_min) + floatVal(realmOld.base_attack_max)) / 2;
      const newMid = (floatVal(realmNew.base_attack_min) + floatVal(realmNew.base_attack_max)) / 2;
      const scale = oldMid > 0 ? newMid / oldMid : 1;
      if (baseStats.minAttack != null) out.minAttack = Math.max(1, Math.round(intVal(baseStats.minAttack, 0) * scale));
      if (baseStats.maxAttack != null) out.maxAttack = Math.max(1, Math.round(intVal(baseStats.maxAttack, 0) * scale));
      if (baseStats.minSpellAttack != null) out.minSpellAttack = Math.max(1, Math.round(intVal(baseStats.minSpellAttack, 0) * scale));
      if (baseStats.maxSpellAttack != null) out.maxSpellAttack = Math.max(1, Math.round(intVal(baseStats.maxSpellAttack, 0) * scale));
      return out;
    }
    // EX防具（含饰品）
    const hasPhysAtk = intVal(baseStats.minAttack, 0) > 0 || intVal(baseStats.maxAttack, 0) > 0;
    const hasSpellAtk = intVal(baseStats.minSpellAttack, 0) > 0 || intVal(baseStats.maxSpellAttack, 0) > 0;
    if ((equipType === 'ring' || equipType === 'amulet') && (hasPhysAtk || hasSpellAtk)) {
      const realmOld = getRealmStatsForQuality(oldQuality);
      const realmNew = getRealmStatsForQuality(newQuality);
      const oldMid = (floatVal(realmOld.base_attack_min) + floatVal(realmOld.base_attack_max)) / 2;
      const newMid = (floatVal(realmNew.base_attack_min) + floatVal(realmNew.base_attack_max)) / 2;
      const atkScale = oldMid > 0 ? newMid / oldMid : 1;
      if (hasPhysAtk) {
        out.minAttack = Math.max(1, Math.round(intVal(baseStats.minAttack, 0) * atkScale));
        out.maxAttack = Math.max(1, Math.round(intVal(baseStats.maxAttack, 0) * atkScale));
        delete out.minSpellAttack; delete out.maxSpellAttack;
        delete out.maxHp; delete out.physDefense; delete out.spellDefense;
      } else {
        out.minSpellAttack = Math.max(1, Math.round(intVal(baseStats.minSpellAttack, 0) * atkScale));
        out.maxSpellAttack = Math.max(1, Math.round(intVal(baseStats.maxSpellAttack, 0) * atkScale));
        delete out.minAttack; delete out.maxAttack;
        delete out.maxHp; delete out.physDefense; delete out.spellDefense;
      }
      return out;
    }
    // 防御型EX防具（胸甲/头/肩/腿/手/背/防御型饰品）
    const oldBrEx = getArmorBaseRangesForQuality(oldQuality);
    const newBrEx = getArmorBaseRangesForQuality(newQuality);
    const hpOldMid = (floatVal(oldBrEx.hp_min) + floatVal(oldBrEx.hp_max)) / 2;
    const hpNewMid = (floatVal(newBrEx.hp_min) + floatVal(newBrEx.hp_max)) / 2;
    const hpScale = hpOldMid > 0 ? hpNewMid / hpOldMid : 1;
    const defOldMid = (floatVal(oldBrEx.def_min) + floatVal(oldBrEx.def_max)) / 2;
    const defNewMid = (floatVal(newBrEx.def_min) + floatVal(newBrEx.def_max)) / 2;
    const defScale = defOldMid > 0 ? defNewMid / defOldMid : 1;
    if (baseStats.maxHp != null) out.maxHp = Math.max(1, Math.round(intVal(baseStats.maxHp, 0) * hpScale));
    if (baseStats.physDefense != null) {
      const physDef = Math.max(1, Math.round(intVal(baseStats.physDefense, 0) * defScale));
      out.physDefense = physDef;
      out.spellDefense = Math.floor(floatVal(physDef) * 0.8);
    }
    if (equipType === 'ring' || equipType === 'amulet') {
      delete out.minAttack; delete out.maxAttack;
      delete out.minSpellAttack; delete out.maxSpellAttack;
    }
    return out;
  }

  // ── 制式装备：保留原有区间映射逻辑 ─────────────────────────
  if (equipType === 'weapon') {
    const subtype = String(item.subtype || '剑');
    const wm = getWeaponMultipliers(subtype);
    const realmOld = getRealmStatsForQuality(oldQuality);
    const realmNew = getRealmStatsForQuality(newQuality);
    const oldMinP = Math.trunc(floatVal(realmOld.base_attack_min) * wm.phys * 0.85);
    const oldMaxP = Math.trunc(floatVal(realmOld.base_attack_max) * wm.phys * 1.2);
    const newMinP = Math.trunc(floatVal(realmNew.base_attack_min) * wm.phys * 0.85);
    const newMaxP = Math.trunc(floatVal(realmNew.base_attack_max) * wm.phys * 1.2);
    const oldBaseSpell = (floatVal(realmOld.base_attack_min) + floatVal(realmOld.base_attack_max)) / 2.0;
    const newBaseSpell = (floatVal(realmNew.base_attack_min) + floatVal(realmNew.base_attack_max)) / 2.0;
    const oldMinS = Math.trunc(oldBaseSpell * wm.spell * 0.85);
    const oldMaxS = Math.trunc(oldBaseSpell * wm.spell * 1.2);
    const newMinS = Math.trunc(newBaseSpell * wm.spell * 0.85);
    const newMaxS = Math.trunc(newBaseSpell * wm.spell * 1.2);
    out.minAttack = ratioToValue(calcRollRatio(intVal(baseStats.minAttack, oldMinP), oldMinP, oldMaxP), newMinP, newMaxP);
    out.maxAttack = ratioToValue(calcRollRatio(intVal(baseStats.maxAttack, oldMinP), oldMinP, oldMaxP), newMinP, newMaxP);
    out.minSpellAttack = ratioToValue(calcRollRatio(intVal(baseStats.minSpellAttack, oldMinS), oldMinS, oldMaxS), newMinS, newMaxS);
    out.maxSpellAttack = ratioToValue(calcRollRatio(intVal(baseStats.maxSpellAttack, oldMinS), oldMinS, oldMaxS), newMinS, newMaxS);
    return out;
  }
  let armorMult = 1.0;
  if (equipType === 'shoulder') armorMult = 0.85;
  else if (equipType === 'legs') armorMult = 0.70;
  else if (equipType === 'head') armorMult = 0.80;
  else if (equipType === 'hands') armorMult = 0.70;
  else if (equipType === 'ring') armorMult = 0.60;
  else if (equipType === 'amulet') armorMult = 0.60;
  else if (equipType === 'back') armorMult = 0.65;
  if (equipType === 'ring' || equipType === 'amulet') {
    const hasPhysAttack = intVal(baseStats.minAttack, 0) > 0 || intVal(baseStats.maxAttack, 0) > 0;
    const hasSpellAttack = intVal(baseStats.minSpellAttack, 0) > 0 || intVal(baseStats.maxSpellAttack, 0) > 0;
    const realmOld = getRealmStatsForQuality(oldQuality);
    const realmNew = getRealmStatsForQuality(newQuality);
    const RING_AMULET_ATTACK_PCT = 0.13;
    if (hasPhysAttack) {
      const oldMin = Math.floor(floatVal(realmOld.base_attack_min) * RING_AMULET_ATTACK_PCT * 0.9);
      const oldMax = Math.floor(floatVal(realmOld.base_attack_max) * RING_AMULET_ATTACK_PCT * 1.1);
      const newMin = Math.floor(floatVal(realmNew.base_attack_min) * RING_AMULET_ATTACK_PCT * 0.9);
      const newMax = Math.floor(floatVal(realmNew.base_attack_max) * RING_AMULET_ATTACK_PCT * 1.1);
      out.minAttack = ratioToValue(calcRollRatio(intVal(baseStats.minAttack, oldMin), oldMin, oldMax), newMin, newMax);
      out.maxAttack = ratioToValue(calcRollRatio(intVal(baseStats.maxAttack, oldMin), oldMin, oldMax), newMin, newMax);
      delete out.minSpellAttack;
      delete out.maxSpellAttack;
      delete out.maxHp;
      delete out.physDefense;
      delete out.spellDefense;
    } else if (hasSpellAttack) {
      const spellBaseOld = (floatVal(realmOld.base_attack_min) + floatVal(realmOld.base_attack_max)) / 2.0;
      const spellBaseNew = (floatVal(realmNew.base_attack_min) + floatVal(realmNew.base_attack_max)) / 2.0;
      const oldMin = Math.floor(spellBaseOld * RING_AMULET_ATTACK_PCT * 0.9);
      const oldMax = Math.floor(spellBaseOld * RING_AMULET_ATTACK_PCT * 1.1);
      const newMin = Math.floor(spellBaseNew * RING_AMULET_ATTACK_PCT * 0.9);
      const newMax = Math.floor(spellBaseNew * RING_AMULET_ATTACK_PCT * 1.1);
      out.minSpellAttack = ratioToValue(calcRollRatio(intVal(baseStats.minSpellAttack, oldMin), oldMin, oldMax), newMin, newMax);
      out.maxSpellAttack = ratioToValue(calcRollRatio(intVal(baseStats.maxSpellAttack, oldMin), oldMin, oldMax), newMin, newMax);
      delete out.minAttack;
      delete out.maxAttack;
      delete out.maxHp;
      delete out.physDefense;
      delete out.spellDefense;
    } else {
      const oldBr = getArmorBaseRangesForQuality(oldQuality);
      const newBr = getArmorBaseRangesForQuality(newQuality);
      const oldHpMin = Math.trunc(floatVal(oldBr.hp_min) * armorMult);
      const oldHpMax = Math.trunc(floatVal(oldBr.hp_max) * armorMult);
      const newHpMin = Math.trunc(floatVal(newBr.hp_min) * armorMult);
      const newHpMax = Math.trunc(floatVal(newBr.hp_max) * armorMult);
      const oldDefMin = Math.trunc(floatVal(oldBr.def_min) * armorMult);
      const oldDefMax = Math.trunc(floatVal(oldBr.def_max) * armorMult);
      const newDefMin = Math.trunc(floatVal(newBr.def_min) * armorMult);
      const newDefMax = Math.trunc(floatVal(newBr.def_max) * armorMult);
      out.maxHp = ratioToValue(calcRollRatio(intVal(baseStats.maxHp, oldHpMin), oldHpMin, oldHpMax), newHpMin, newHpMax);
      const physDef = ratioToValue(calcRollRatio(intVal(baseStats.physDefense, oldDefMin), oldDefMin, oldDefMax), newDefMin, newDefMax);
      out.physDefense = physDef;
      out.spellDefense = Math.floor(floatVal(physDef) * 0.8);
      delete out.minAttack;
      delete out.maxAttack;
      delete out.minSpellAttack;
      delete out.maxSpellAttack;
    }
    return out;
  }
  const oldBr = getArmorBaseRangesForQuality(oldQuality);
  const newBr = getArmorBaseRangesForQuality(newQuality);
  const oldHpMin = Math.trunc(floatVal(oldBr.hp_min) * armorMult);
  const oldHpMax = Math.trunc(floatVal(oldBr.hp_max) * armorMult);
  const newHpMin = Math.trunc(floatVal(newBr.hp_min) * armorMult);
  const newHpMax = Math.trunc(floatVal(newBr.hp_max) * armorMult);
  const oldDefMin = Math.trunc(floatVal(oldBr.def_min) * armorMult);
  const oldDefMax = Math.trunc(floatVal(oldBr.def_max) * armorMult);
  const newDefMin = Math.trunc(floatVal(newBr.def_min) * armorMult);
  const newDefMax = Math.trunc(floatVal(newBr.def_max) * armorMult);
  out.maxHp = ratioToValue(calcRollRatio(intVal(baseStats.maxHp, oldHpMin), oldHpMin, oldHpMax), newHpMin, newHpMax);
  out.physDefense = ratioToValue(calcRollRatio(intVal(baseStats.physDefense, oldDefMin), oldDefMin, oldDefMax), newDefMin, newDefMax);
  out.spellDefense = Math.floor(floatVal(out.physDefense) * 0.8);
  return out;
}

function repairRingAmuletLegacyAttackWhiteStats(item, baseStats, quality) {
  // 历史兼容：旧版本戒指/项链攻击白字按0.08系数生成，
  // 现版本按0.13系数。登录纠偏时仅对“明显落在旧区间上限内”的值做比例修复，
  // 避免误伤当前版本已正确生成的装备。
  const equipType = String(item?.type || '');
  const q = clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER);
  if ((equipType !== 'ring' && equipType !== 'amulet') || q < 3) {
    return { stats: deepClone(baseStats || {}), correctedStatCount: 0 };
  }

  const out = deepClone(baseStats || {});
  const realm = getRealmStatsForQuality(q);
  const oldPct = 0.08;
  const newPct = 0.13;
  let correctedStatCount = 0;

  const hasPhysAttack = intVal(out.minAttack, 0) > 0 || intVal(out.maxAttack, 0) > 0;
  const hasSpellAttack = intVal(out.minSpellAttack, 0) > 0 || intVal(out.maxSpellAttack, 0) > 0;

  if (hasPhysAttack) {
    const oldMinLo = Math.floor(floatVal(realm.base_attack_min) * oldPct * 0.9);
    const oldMinHi = Math.floor(floatVal(realm.base_attack_min) * oldPct * 1.1);
    const newMinLo = Math.floor(floatVal(realm.base_attack_min) * newPct * 0.9);
    const newMinHi = Math.floor(floatVal(realm.base_attack_min) * newPct * 1.1);
    const oldMaxLo = Math.floor(floatVal(realm.base_attack_max) * oldPct * 0.9);
    const oldMaxHi = Math.floor(floatVal(realm.base_attack_max) * oldPct * 1.1);
    const newMaxLo = Math.floor(floatVal(realm.base_attack_max) * newPct * 0.9);
    const newMaxHi = Math.floor(floatVal(realm.base_attack_max) * newPct * 1.1);

    const curMinAttack = intVal(out.minAttack, 0);
    if (curMinAttack > 0 && curMinAttack <= oldMinHi) {
      out.minAttack = ratioToValue(calcRollRatio(curMinAttack, oldMinLo, oldMinHi), newMinLo, newMinHi);
      correctedStatCount += 1;
    }

    const curMaxAttack = intVal(out.maxAttack, 0);
    if (curMaxAttack > 0 && curMaxAttack <= oldMaxHi) {
      out.maxAttack = ratioToValue(calcRollRatio(curMaxAttack, oldMaxLo, oldMaxHi), newMaxLo, newMaxHi);
      correctedStatCount += 1;
    }
  } else if (hasSpellAttack) {
    const spellBase = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
    const oldMinLo = Math.floor(spellBase * oldPct * 0.9);
    const oldMinHi = Math.floor(spellBase * oldPct * 1.0);
    const newMinLo = Math.floor(spellBase * newPct * 0.9);
    const newMinHi = Math.floor(spellBase * newPct * 1.0);
    const oldMaxLo = Math.floor(spellBase * oldPct * 1.0);
    const oldMaxHi = Math.floor(spellBase * oldPct * 1.1);
    const newMaxLo = Math.floor(spellBase * newPct * 1.0);
    const newMaxHi = Math.floor(spellBase * newPct * 1.1);

    const curMinSpellAttack = intVal(out.minSpellAttack, 0);
    if (curMinSpellAttack > 0 && curMinSpellAttack <= oldMinHi) {
      out.minSpellAttack = ratioToValue(calcRollRatio(curMinSpellAttack, oldMinLo, oldMinHi), newMinLo, newMinHi);
      correctedStatCount += 1;
    }

    const curMaxSpellAttack = intVal(out.maxSpellAttack, 0);
    if (curMaxSpellAttack > 0 && curMaxSpellAttack <= oldMaxHi) {
      out.maxSpellAttack = ratioToValue(calcRollRatio(curMaxSpellAttack, oldMaxLo, oldMaxHi), newMaxLo, newMaxHi);
      correctedStatCount += 1;
    }
  }

  return { stats: out, correctedStatCount };
}

function getExpectedExBaseWhiteStats(item, quality, baseStats = null) {
  if (!item || !isExEquipment(item)) return null;
  const equipType = String(item.type || '');

  // EX防具（含套装件）白字上限应是确定值：制式上限 * EX倍率。
  // 这里避免通过随机生成样本推导，防止登录深度维护时出现白字来回波动。
  if (EQUIPMENT_TYPES_ARMOR.includes(equipType)) {
    const expected = getStandardMaxWhiteStatsByQuality(item, quality, baseStats || {});
    if (!expected || typeof expected !== 'object') return null;
    const out = deepClone(expected);
    if (intVal(out.maxHp, 0) > 0) out.maxHp = Math.max(1, Math.trunc(intVal(out.maxHp, 0) * 1.1));
    if (intVal(out.physDefense, 0) > 0) out.physDefense = Math.max(1, Math.trunc(intVal(out.physDefense, 0) * 1.1));
    if (intVal(out.spellDefense, 0) > 0) out.spellDefense = Math.max(1, Math.trunc(intVal(out.spellDefense, 0) * 1.1));
    if (equipType === 'ring' || equipType === 'amulet') {
      if (intVal(out.minAttack, 0) > 0) out.minAttack = Math.max(1, Math.trunc(intVal(out.minAttack, 0) * 1.2));
      if (intVal(out.maxAttack, 0) > 0) out.maxAttack = Math.max(1, Math.trunc(intVal(out.maxAttack, 0) * 1.2));
      if (intVal(out.minSpellAttack, 0) > 0) out.minSpellAttack = Math.max(1, Math.trunc(intVal(out.minSpellAttack, 0) * 1.2));
      if (intVal(out.maxSpellAttack, 0) > 0) out.maxSpellAttack = Math.max(1, Math.trunc(intVal(out.maxSpellAttack, 0) * 1.2));
    }
    return out;
  }

  const tpl = String(item.exTemplate || item.ex_template || '').trim();
  if (!tpl) return null;
  const armorOverride = EQUIPMENT_TYPES_ARMOR.includes(equipType) ? equipType : '';
  const sample = generateExEquipment(tpl, clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER), armorOverride, MAX_AFFIX_TIER);
  if (!sample || typeof sample !== 'object' || Object.keys(sample).length <= 0) return null;
  const sampleAffixes = normalizeAffixes(sample);
  return extractBaseStatsFromAffixes(sample, sampleAffixes);
}

function repairWhiteStatsByRangeAndExMultiplier(item, baseStats, quality) {
  const out = deepClone(baseStats || {});
  const stdMax = getStandardMaxWhiteStatsByQuality(item, quality, out);
  const isExItem = isExEquipment(item);
  let exExpected = isExItem ? getExpectedExBaseWhiteStats(item, quality, out) : null;
  if (isExItem && (!exExpected || typeof exExpected !== 'object')) {
    const stdBase = getStandardBaseWhiteStatsByQuality(item, quality, out);
    exExpected = scaleExWhiteStatsOnStandardMax(out, stdMax, stdBase);
  }
  const whiteKeys = ['minAttack', 'maxAttack', 'minSpellAttack', 'maxSpellAttack', 'maxHp', 'physDefense', 'spellDefense'];
  let correctedStatCount = 0;

  for (const key of whiteKeys) {
    const curV = intVal(out[key], 0);
    if (curV <= 0) continue;
    const stdHi = intVal(stdMax?.[key], 0);
    if (stdHi <= 0) continue;

    const exHi = intVal(exExpected?.[key], 0);
    const hasExMultiplierKey = isExItem && exHi > stdHi;

    if (hasExMultiplierKey && curV <= stdHi) {
      // 历史异常：EX升品后倍率丢失到标准区间，补回EX该键上限。
      if (curV !== exHi) {
        out[key] = exHi;
        correctedStatCount += 1;
      }
      continue;
    }

    const hi = hasExMultiplierKey ? exHi : stdHi;
    if (curV > hi) {
      // 历史异常：白字超出该装备应有区间，回正到该区间满值。
      out[key] = hi;
      correctedStatCount += 1;
    }
  }

  const minAtk = intVal(out.minAttack, 0);
  const maxAtk = intVal(out.maxAttack, 0);
  if (minAtk > 0 && maxAtk > 0 && minAtk > maxAtk) {
    out.minAttack = maxAtk;
    correctedStatCount += 1;
  }

  const minSpell = intVal(out.minSpellAttack, 0);
  const maxSpell = intVal(out.maxSpellAttack, 0);
  if (minSpell > 0 && maxSpell > 0 && minSpell > maxSpell) {
    out.minSpellAttack = maxSpell;
    correctedStatCount += 1;
  }

  return { stats: out, correctedStatCount };
}

function resolveStandardBaseName(item) {
  const n = String(item.baseName || '').trim();
  if (n) return n;
  const q = clampi(intVal(item.quality, 1), 1, 8);
  const qualityPrefixes = ['', '精', '灵', '法', '仙', '神', '神', '圣'];
  const prefix = q >= 1 && q < qualityPrefixes.length ? qualityPrefixes[q] : '';
  const equipType = String(item.type || '');
  if (equipType === 'weapon') {
    const subtype = String(item.subtype || '剑');
    const weaponNames = {
      剑: ['铁剑', '精钢剑', '灵剑', '法剑', '仙剑'],
      刀: ['钢刀', '精钢刀', '灵刀', '法刀', '仙刀'],
      长兵: ['长枪', '长矛', '长戟', '法枪', '仙枪'],
      弓: ['短弓', '长弓', '灵弓', '法弓', '仙弓'],
      拳爪: ['铁爪', '钢爪', '灵爪', '法爪', '仙爪'],
      音律: ['玉笛', '古琴', '灵笛', '法琴', '仙笛'],
      节杖: ['竹杖', '铁杖', '灵杖', '法杖', '仙杖']
    };
    const pool = weaponNames[subtype] || ['武器'];
    const base = pool[Math.min(q - 1, pool.length - 1)];
    return prefix ? `${prefix}${base}` : base;
  }
  const armorNames = {
    head: ['布帽', '皮帽', '灵帽', '法帽', '仙帽'],
    chest: ['布甲', '皮甲', '灵甲', '法甲', '仙甲'],
    shoulder: ['布肩', '皮肩', '灵肩', '法肩', '仙肩'],
    legs: ['布裤', '皮裤', '灵裤', '法裤', '仙裤'],
    hands: ['布手套', '皮手套', '灵手套', '法手套', '仙手套'],
    ring: ['布戒', '皮戒', '灵戒', '法戒', '仙戒'],
    amulet: ['布符', '皮符', '灵符', '法符', '仙符'],
    back: ['布披', '皮披', '灵披', '法披', '仙披']
  };
  if (armorNames[equipType]) {
    const pool = armorNames[equipType];
    const base = pool[Math.min(q - 1, pool.length - 1)];
    return prefix ? `${prefix}${base}` : base;
  }
  return String(item.name || '装备').trim();
}
function executeUpgrade(equipment, materialItem, materialCount, mode) {
  if (!equipment || !materialItem) return { ok: false, error: '参数无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备升品' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };
  if (mode !== 'target' && mode !== 'current') return { ok: false, error: '升品模式无效' };
  const oldQuality = clampi(intVal(equipment.quality, 1), 1, 8);
  if (oldQuality >= 8) return { ok: false, error: '装备已达最高阶' };
  const chance = calculateUpgradeSuccessRate(equipment, materialItem, materialCount, mode);
  if (chance <= 0) return { ok: false, error: '材料阶级或数量不满足升品条件' };
  const success = randf() < chance;
  if (!success) return { ok: true, success: false, chance, consume_count: clampi(materialCount, 1, 100) };
  const newQuality = oldQuality + 1;
  const baseOld = extractBaseStats(equipment);
  const baseNew = remapWhiteStatsByRatio(equipment, baseOld, oldQuality, newQuality);
  const affixesOld = normalizeAffixes(equipment);
  const affixesNew = normalizeAffixesForUpgrade(affixesOld);
  const extraNew = affixesToExtraStats(affixesNew);
  const statsNew = mergeBaseAndExtra(baseNew, extraNew);
  const upgraded = deepClone(equipment);
  upgraded.quality = newQuality;
  upgraded.stats = statsNew;
  upgraded.randomExtraStats = extraNew;
  upgraded.affixes = affixesNew;
  upgraded.affixCount = affixesNew.length;
  const rarity = getRarityByAffixCount(affixesNew.length);
  upgraded.rarity = rarity.key;
  upgraded.rarityName = rarity.name;
  upgraded.required_level = getRequiredLevelForItem(newQuality, affixesNew);
  if (!Boolean(upgraded.isEx)) {
    const baseName = resolveStandardBaseName(upgraded);
    upgraded.baseName = baseName;
    upgraded.name = composeStandardEquipmentName(baseName, affixesNew);
  }
  upgraded.value = calculateItemValue(upgraded);
  return { ok: true, success: true, chance, consume_count: clampi(materialCount, 1, 100), equipment: upgraded };
}
function executeAffixUpgrade(equipment, affixIndex, materialItem, materialCount, mode, affixMode = 'upgrade') {
  if (!equipment || !materialItem) return { ok: false, error: '参数无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备词缀处理' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };
  if (mode !== 'target' && mode !== 'current') return { ok: false, error: '材料模式无效' };
  const normalizedAffixMode = String(affixMode || 'upgrade').toLowerCase() === 'downgrade' ? 'downgrade' : 'upgrade';

  const equipQuality = clampi(intVal(equipment.quality, 1), 1, 8);

  const affixesOld = normalizeAffixes(equipment);
  if (affixesOld.length <= 0) return { ok: false, error: '该装备没有可升品词缀' };

  const idx = intVal(affixIndex, -1);
  if (idx < 0 || idx >= affixesOld.length) return { ok: false, error: '词缀索引无效' };

  const targetAffix = affixesOld[idx];
  const stat = String(targetAffix?.stat || '');
  if (!stat) return { ok: false, error: '词缀属性无效，无法升品' };

  const oldAffixQuality = clampi(intVal(targetAffix.quality, intVal(targetAffix.tier, 1)), 1, MAX_AFFIX_TIER);
  if (normalizedAffixMode === 'upgrade' && oldAffixQuality >= MAX_AFFIX_TIER) {
    return { ok: false, error: '词缀已达最高品质（Q8）' };
  }
  if (normalizedAffixMode === 'downgrade' && oldAffixQuality <= 1) {
    return { ok: false, error: '词缀已达最低品质（Q1）' };
  }
  const rollTier = clampi(intVal(targetAffix.tier, oldAffixQuality), 1, MAX_AFFIX_TIER);

  const chance = normalizedAffixMode === 'downgrade'
    ? calculateAffixDowngradeSuccessRate(oldAffixQuality, materialItem, materialCount, mode)
    : calculateUpgradeSuccessRate({ quality: oldAffixQuality }, materialItem, materialCount, mode);
  if (chance <= 0) {
    return {
      ok: false,
      error: normalizedAffixMode === 'downgrade'
        ? '材料阶级或数量不满足降阶条件'
        : '材料阶级或数量不满足升品条件'
    };
  }

  const success = randf() < chance;
  if (!success) {
    return {
      ok: true,
      success: false,
      chance,
      affix_index: idx,
      consume_count: clampi(materialCount, 1, 100)
    };
  }

  const newAffixQuality = normalizedAffixMode === 'downgrade'
    ? (oldAffixQuality - 1)
    : (oldAffixQuality + 1);
  const oldCtx = getAffixContext(equipment, oldAffixQuality);
  const newCtx = getAffixContext(equipment, newAffixQuality);
  const oldRange = getAffixTierRangeByContext(stat, oldAffixQuality, rollTier, oldCtx);
  const newRange = getAffixTierRangeByContext(stat, newAffixQuality, rollTier, newCtx);
  const oldValueRaw = intVal(targetAffix.value, oldRange.min);
  const oldValue = clampi(oldValueRaw, oldRange.min, oldRange.max);
  const rollRatio = calcRollRatio(oldValue, oldRange.min, oldRange.max);
  const newValue = clampi(ratioToValue(rollRatio, newRange.min, newRange.max), newRange.min, newRange.max);

  const affixesNew = affixesOld.map((a, i) => {
    if (i !== idx) return deepClone(a);
    return {
      name: getAffixName(stat, newAffixQuality),
      stat,
      quality: newAffixQuality,
      tier: rollTier,
      value: intVal(newValue, 0)
    };
  });

  const extraNew = affixesToExtraStats(affixesNew);
  const baseOld = extractBaseStats(equipment);
  const statsNew = mergeBaseAndExtra(baseOld, extraNew);

  const result = deepClone(equipment);
  result.stats = statsNew;
  result.randomExtraStats = extraNew;
  result.affixes = affixesNew;
  result.affixCount = affixesNew.length;
  const rarity = getRarityByAffixCount(affixesNew.length);
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = getRequiredLevelForItem(equipQuality, affixesNew);
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, affixesNew);
  }
  result.value = calculateItemValue(result);

  return {
    ok: true,
    success: true,
    chance,
    affix_mode: normalizedAffixMode,
    affix_index: idx,
    old_affix_quality: oldAffixQuality,
    new_affix_quality: newAffixQuality,
    consume_count: clampi(materialCount, 1, 100),
    equipment: result
  };
}
function executeAffixTierReroll(equipment, affixIndex, materialItem, consumeCount = 3) {
  if (!equipment || !materialItem) return { ok: false, error: '参数无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备词缀洗练' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };

  const affixesOld = normalizeAffixes(equipment);
  if (affixesOld.length <= 0) return { ok: false, error: '该装备没有可洗练词缀' };

  const idx = intVal(affixIndex, -1);
  if (idx < 0 || idx >= affixesOld.length) return { ok: false, error: '词缀索引无效' };

  const targetAffix = affixesOld[idx];
  const stat = String(targetAffix?.stat || '');
  if (!stat) return { ok: false, error: '词缀属性无效，无法洗练' };

  const affixQ = clampi(intVal(targetAffix.quality, intVal(targetAffix.tier, 1)), 1, MAX_AFFIX_TIER);
  const oldTier = clampi(intVal(targetAffix.tier, affixQ), 1, MAX_AFFIX_TIER);
  const materialQuality = clampi(intVal(materialItem?.quality, 1), 1, MAX_AFFIX_TIER);
  const weights = getAffixTierRerollWeights(materialQuality);
  const newTier = clampi(rollTierByWeights(weights), 1, MAX_AFFIX_TIER);

  const ctx = getAffixContext(equipment, affixQ);
  const range = getAffixTierRangeByContext(stat, affixQ, newTier, ctx);
  const newValue = randiRange(range.min, range.max);

  const affixesNew = affixesOld.map((a, i) => {
    if (i !== idx) return deepClone(a);
    return {
      name: getAffixName(stat, affixQ),
      stat,
      quality: affixQ,
      tier: newTier,
      value: intVal(newValue, 0)
    };
  });

  const equipQuality = clampi(intVal(equipment.quality, 1), 1, 8);
  const extraNew = affixesToExtraStats(affixesNew);
  const baseOld = extractBaseStats(equipment);
  const statsNew = mergeBaseAndExtra(baseOld, extraNew);

  const result = deepClone(equipment);
  result.stats = statsNew;
  result.randomExtraStats = extraNew;
  result.affixes = affixesNew;
  result.affixCount = affixesNew.length;
  const rarity = getRarityByAffixCount(affixesNew.length);
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = getRequiredLevelForItem(equipQuality, affixesNew);
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, affixesNew);
  }
  result.value = calculateItemValue(result);

  return {
    ok: true,
    success: true,
    affix_index: idx,
    material_quality: materialQuality,
    old_tier: oldTier,
    new_tier: newTier,
    consume_count: Math.max(1, intVal(consumeCount, 3)),
    equipment: result
  };
}
function applyAffixesToEquipment(equipment, nextAffixes) {
  if (!equipment || typeof equipment !== 'object') return { ok: false, error: '目标装备无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备词缀更新' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };

  const normalizedAffixes = [];
  for (const a of Array.isArray(nextAffixes) ? nextAffixes : []) {
    if (!a || typeof a !== 'object') continue;
    const stat = String(a.stat || '').trim();
    if (!stat) continue;
    const affixQ = clampi(intVal(a.quality, intVal(a.tier, 1)), 1, MAX_AFFIX_TIER);
    const rollT = clampi(intVal(a.tier, affixQ), 1, MAX_AFFIX_TIER);
    normalizedAffixes.push({
      name: getAffixName(stat, affixQ),
      stat,
      quality: affixQ,
      tier: rollT,
      value: intVal(a.value, 0)
    });
  }

  const extraNew = affixesToExtraStats(normalizedAffixes);
  const baseOld = extractBaseStats(equipment);
  const statsNew = mergeBaseAndExtra(baseOld, extraNew);
  const equipQuality = clampi(intVal(equipment.quality, 1), 1, 8);

  const result = deepClone(equipment);
  result.stats = statsNew;
  result.randomExtraStats = extraNew;
  result.affixes = normalizedAffixes;
  result.affixCount = normalizedAffixes.length;
  const rarity = getRarityByAffixCount(normalizedAffixes.length);
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = getRequiredLevelForItem(equipQuality, normalizedAffixes);
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, normalizedAffixes);
  }
  result.value = calculateItemValue(result);

  return { ok: true, equipment: result };
}
function calculateRerollLockExtraCost(affixes, lockedIndices) {
  let extraCost = 0;
  const arr = Array.isArray(affixes) ? affixes : [];
  const seen = new Set();
  for (const idxV of Array.isArray(lockedIndices) ? lockedIndices : []) {
    const idx = intVal(idxV, -1);
    if (idx < 0 || idx >= arr.length || seen.has(idx)) continue;
    if (arr[idx] && typeof arr[idx] === 'object') {
      seen.add(idx);
      extraCost += Math.max(1, intVal(arr[idx].quality, intVal(arr[idx].tier, 1)));
    }
  }
  return extraCost;
}
function executeReroll(equipment, lingItem, lockedIndices, maxAffixQuality = MAX_AFFIX_TIER) {
  if (!equipment || !lingItem) return { ok: false, error: '参数无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备洗练' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };
  if (!canBeForgingMaterial(lingItem)) return { ok: false, error: '引灵材料无效' };
  const quality = clampi(intVal(equipment.quality, 1), 1, 8);
  const ctx = getAffixContext(equipment, quality);
  const poolStats = Array.isArray(ctx.pool_stats) ? ctx.pool_stats : [];
  const oldAffixes = normalizeAffixes(equipment);
  const usedStats = {};
  const newAffixes = [];
  const lockedSet = new Set();
  for (const idxV of Array.isArray(lockedIndices) ? lockedIndices : []) {
    const idx = intVal(idxV, -1);
    if (idx < 0 || idx >= oldAffixes.length || lockedSet.has(idx)) continue;
    if (oldAffixes[idx] && typeof oldAffixes[idx] === 'object') {
      lockedSet.add(idx);
      const lockAffix = deepClone(oldAffixes[idx]);
      newAffixes.push(lockAffix);
      usedStats[String(lockAffix.stat || '')] = true;
    }
  }
  let targetCount = Math.max(newAffixes.length, rollAffixCount());
  targetCount = Math.min(targetCount, poolStats.length);
  const candidates = [];
  for (const s of poolStats) {
    const k = String(s);
    if (!usedStats[k]) candidates.push(k);
  }
  shuffleArray(candidates);
  const addCount = Math.max(0, targetCount - newAffixes.length);
  const lingTier = clampi(intVal(lingItem.quality, 1), 1, 8);
  // 引灵材料对百艺重洗“词缀品质Q上限”的影响：
  // 1-3阶材料：基础上限为Q3；4阶及以上：基础上限为材料同阶。
  // 另外 5阶及以上材料有概率额外 +1Q（概率 0.08*(材料阶-4)），但不会超过全局 MAX_AFFIX_TIER。
  const baseAffixQualityCapFromLing = lingTier <= 3 ? 3 : lingTier;
  const effectiveAffixQualityCap = Math.min(baseAffixQualityCapFromLing, maxAffixQuality);
  for (let i = 0; i < Math.min(addCount, candidates.length); i += 1) {
    const stat = String(candidates[i]);
    let affixQ = rollAffixTier(quality, effectiveAffixQualityCap);
    if (lingTier >= 5 && randf() < 0.08 * (lingTier - 4)) affixQ = clampi(affixQ + 1, 1, Math.min(effectiveAffixQualityCap + 1, MAX_AFFIX_TIER));
    const rollT = rollAffixRollTier();
    const vr = getAffixTierRangeByContext(stat, affixQ, rollT, ctx);
    const v = randiRange(vr.min, vr.max);
    newAffixes.push({ name: getAffixName(stat, affixQ), stat, quality: affixQ, tier: rollT, value: v });
  }
  const extraNew = affixesToExtraStats(newAffixes);
  const baseOld = extractBaseStats(equipment);
  const statsNew = mergeBaseAndExtra(baseOld, extraNew);
  const result = deepClone(equipment);
  result.stats = statsNew;
  result.randomExtraStats = extraNew;
  result.affixes = newAffixes;
  result.affixCount = newAffixes.length;
  const rarity = getRarityByAffixCount(newAffixes.length);
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = getRequiredLevelForItem(quality, newAffixes);
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, newAffixes);
  }
  result.value = calculateItemValue(result);
  const extraCost = calculateRerollLockExtraCost(oldAffixes, lockedIndices);
  return { ok: true, equipment: result, consume_count: 1 + extraCost };
}

function executeZaohua(equipment) {
  if (!equipment || typeof equipment !== 'object') return { ok: false, error: '目标装备无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备造化' };
  if (isZaohuaLockedEquipment(equipment)) return { ok: false, error: ZAOHUA_LOCK_ERROR };

  const equipQuality = clampi(intVal(equipment.quality, 1), 1, MAX_AFFIX_TIER);
  const oldAffixes = normalizeAffixes(equipment);
  const affixesNew = oldAffixes.map((a) => deepClone(a));
  const poolStats = Array.isArray(getAffixContext(equipment, equipQuality)?.pool_stats)
    ? getAffixContext(equipment, equipQuality).pool_stats
    : [];
  const nowSec = Math.floor(Date.now() / 1000);
  let zaohuaStdWhiteMax = null;
  let zaohuaExWhiteMax = null;
  const clampZaohuaWhiteStat = (key) => {
    const k = String(key || '');
    if (!k) return;
    const cur = intVal(baseNew[k], 0);
    if (cur <= 0) return;
    if (!zaohuaStdWhiteMax) {
      zaohuaStdWhiteMax = getStandardMaxWhiteStatsByQuality(equipment, equipQuality, baseNew);
    }
    let cap = intVal(zaohuaStdWhiteMax?.[k], 0);
    if (isExEquipment(equipment)) {
      if (zaohuaExWhiteMax === null) {
        zaohuaExWhiteMax = getExpectedExBaseWhiteStats(equipment, equipQuality, baseNew);
        if (!zaohuaExWhiteMax || typeof zaohuaExWhiteMax !== 'object') {
          const stdBase = getStandardBaseWhiteStatsByQuality(equipment, equipQuality, baseNew);
          zaohuaExWhiteMax = scaleExWhiteStatsOnStandardMax(baseNew, zaohuaStdWhiteMax || {}, stdBase || {});
        }
      }
      const exCap = intVal(zaohuaExWhiteMax?.[k], 0);
      if (exCap > cap) cap = exCap;
    }
    if (cap > 0 && cur > cap) baseNew[k] = cap;
  };

  const normalizeZaohuaAttackBounds = () => {
    const minAtk = intVal(baseNew.minAttack, 0);
    const maxAtk = intVal(baseNew.maxAttack, 0);
    if (minAtk > 0 && maxAtk > 0 && minAtk > maxAtk) baseNew.minAttack = maxAtk;
    const minSpell = intVal(baseNew.minSpellAttack, 0);
    const maxSpell = intVal(baseNew.maxSpellAttack, 0);
    if (minSpell > 0 && maxSpell > 0 && minSpell > maxSpell) baseNew.minSpellAttack = maxSpell;
  };

  const noEffectRoll = randf();
  const polarity = noEffectRoll < ZAOHUA_NO_EFFECT_RATE
    ? 'neutral'
    : (randf() < ZAOHUA_NEGATIVE_RATE ? 'negative' : 'positive');
  let effectDesc = '';
  let baseNew = extractBaseStats(equipment);

  if (polarity === 'neutral') {
    effectDesc = '无事发生，装备被造化并锁定';
  } else if (polarity === 'positive') {
    const canAddAffix = affixesNew.length < Math.min(4, poolStats.length);
    if (affixesNew.length > 0 && (randf() < 0.7 || !canAddAffix)) {
      const idx = randiRange(0, affixesNew.length - 1);
      const old = affixesNew[idx];
      const stat = String(old.stat || '');
      const oldQ = clampi(intVal(old.quality, intVal(old.tier, 1)), 1, MAX_AFFIX_TIER);
      const oldT = clampi(intVal(old.tier, oldQ), 1, MAX_AFFIX_TIER);
      const newQ = clampi(oldQ + 1, 1, MAX_AFFIX_TIER);
      const newT = clampi(oldT + (randf() < 0.35 ? 1 : 0), 1, MAX_AFFIX_TIER);
      const range = getAffixTierRangeByContext(stat, newQ, newT, getAffixContext(equipment, newQ));
      const floorVal = Math.max(range.min, Math.floor((range.min + range.max) / 2));
      const newVal = randiRange(floorVal, range.max);
      affixesNew[idx] = { name: getAffixName(stat, newQ), stat, quality: newQ, tier: newT, value: intVal(newVal, 0) };
      effectDesc = `${affixesNew[idx].name}获得正向变异`;
    } else if (canAddAffix) {
      const used = new Set(affixesNew.map((a) => String(a.stat || '')));
      const available = poolStats.filter((s) => !used.has(String(s)));
      if (available.length > 0) {
        const stat = String(available[randiRange(0, available.length - 1)]);
        const q = clampi(rollAffixTier(Math.max(6, equipQuality), MAX_AFFIX_TIER), 1, MAX_AFFIX_TIER);
        const t = clampi(Math.max(4, rollAffixRollTier()), 1, MAX_AFFIX_TIER);
        const range = getAffixTierRangeByContext(stat, q, t, getAffixContext(equipment, q));
        const val = randiRange(Math.max(range.min, Math.floor((range.min + range.max) / 2)), range.max);
        affixesNew.push({ name: getAffixName(stat, q), stat, quality: q, tier: t, value: intVal(val, 0) });
        effectDesc = `新增词缀 ${getAffixName(stat, q)}`;
      }
    }
    if (!effectDesc) {
      const whiteKeys = ['maxHp', 'physDefense', 'spellDefense', 'minAttack', 'maxAttack', 'minSpellAttack', 'maxSpellAttack'];
      const candidates = whiteKeys.filter((k) => intVal(baseNew[k], 0) > 0);
      if (candidates.length > 0) {
        const key = candidates[randiRange(0, candidates.length - 1)];
        const ratio = 1.1 + randf() * 0.08;
        baseNew[key] = Math.max(1, Math.floor(intVal(baseNew[key], 0) * ratio));
        clampZaohuaWhiteStat(key);
        if (key === 'minAttack' || key === 'maxAttack') {
          clampZaohuaWhiteStat('minAttack');
          clampZaohuaWhiteStat('maxAttack');
        }
        if (key === 'minSpellAttack' || key === 'maxSpellAttack') {
          clampZaohuaWhiteStat('minSpellAttack');
          clampZaohuaWhiteStat('maxSpellAttack');
        }
        normalizeZaohuaAttackBounds();
        effectDesc = `白字属性 ${key} 获得提升`;
      }
    }
  } else {
    if (affixesNew.length > 0 && randf() < 0.55) {
      const idx = randiRange(0, affixesNew.length - 1);
      const removed = affixesNew.splice(idx, 1)[0];
      effectDesc = `词缀 ${String(removed?.name || removed?.stat || '未知')} 被腐蚀移除`;
    } else if (affixesNew.length > 0) {
      const idx = randiRange(0, affixesNew.length - 1);
      const old = affixesNew[idx];
      const stat = String(old.stat || '');
      const oldQ = clampi(intVal(old.quality, intVal(old.tier, 1)), 1, MAX_AFFIX_TIER);
      const oldT = clampi(intVal(old.tier, oldQ), 1, MAX_AFFIX_TIER);
      const newQ = clampi(oldQ - 1, 1, MAX_AFFIX_TIER);
      const newT = clampi(oldT - (randf() < 0.4 ? 1 : 0), 1, MAX_AFFIX_TIER);
      const range = getAffixTierRangeByContext(stat, newQ, newT, getAffixContext(equipment, newQ));
      const capVal = Math.max(range.min, Math.floor((range.min + range.max) / 2));
      const newVal = randiRange(range.min, capVal);
      affixesNew[idx] = { name: getAffixName(stat, newQ), stat, quality: newQ, tier: newT, value: intVal(newVal, 0) };
      effectDesc = `${affixesNew[idx].name}出现负向变异`;
    } else {
      const whiteKeys = ['maxHp', 'physDefense', 'spellDefense', 'minAttack', 'maxAttack', 'minSpellAttack', 'maxSpellAttack'];
      const candidates = whiteKeys.filter((k) => intVal(baseNew[k], 0) > 0);
      if (candidates.length > 0) {
        const key = candidates[randiRange(0, candidates.length - 1)];
        const ratio = 0.84 + randf() * 0.08;
        baseNew[key] = Math.max(1, Math.floor(intVal(baseNew[key], 0) * ratio));
        if (key === 'maxAttack' && intVal(baseNew.minAttack, 0) > intVal(baseNew.maxAttack, 0)) baseNew.minAttack = baseNew.maxAttack;
        if (key === 'maxSpellAttack' && intVal(baseNew.minSpellAttack, 0) > intVal(baseNew.maxSpellAttack, 0)) baseNew.minSpellAttack = baseNew.maxSpellAttack;
        effectDesc = `白字属性 ${key} 出现衰减`;
      }
    }
  }

  const extraNew = affixesToExtraStats(affixesNew);
  const statsNew = mergeBaseAndExtra(baseNew, extraNew);
  const result = deepClone(equipment);
  result.stats = statsNew;
  result.randomExtraStats = extraNew;
  result.affixes = affixesNew;
  result.affixCount = affixesNew.length;
  const rarity = getRarityByAffixCount(affixesNew.length);
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = getRequiredLevelForItem(equipQuality, affixesNew);
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, affixesNew);
  }
  result.zaohua_locked = true;
  result.zaohua_state = polarity;
  result.zaohua_effect = effectDesc || (polarity === 'positive' ? '获得正向造化' : '产生负向造化');
  result.zaohua_at = nowSec;
  result.value = calculateItemValue(result);

  return {
    ok: true,
    equipment: result,
    polarity,
    effect: result.zaohua_effect
  };
}

function getStandardMaxWhiteStatsByQuality(item, quality, baseStats = null) {
  const q = clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER);
  const equipType = String(item?.type || '');
  const base = deepClone(baseStats || {});

  if (equipType === 'weapon') {
    const subtype = String(item?.subtype || '剑');
    const wm = getWeaponMultipliers(subtype);
    const realm = getRealmStatsForQuality(q);
    const physMax = Math.max(1, Math.trunc(floatVal(realm.base_attack_max) * wm.phys * 1.2));
    const spellBase = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
    const spellMax = Math.max(1, Math.trunc(spellBase * wm.spell * 1.2));
    base.minAttack = physMax;
    base.maxAttack = physMax;
    base.minSpellAttack = spellMax;
    base.maxSpellAttack = spellMax;
    return base;
  }

  let armorMult = 1.0;
  if (equipType === 'shoulder') armorMult = 0.85;
  else if (equipType === 'legs') armorMult = 0.70;
  else if (equipType === 'head') armorMult = 0.80;
  else if (equipType === 'hands') armorMult = 0.70;
  else if (equipType === 'ring') armorMult = 0.60;
  else if (equipType === 'amulet') armorMult = 0.60;
  else if (equipType === 'back') armorMult = 0.65;

  if (equipType === 'ring' || equipType === 'amulet') {
    const hasPhysAttack = intVal(base.minAttack, 0) > 0 || intVal(base.maxAttack, 0) > 0;
    const hasSpellAttack = intVal(base.minSpellAttack, 0) > 0 || intVal(base.maxSpellAttack, 0) > 0;
    const realm = getRealmStatsForQuality(q);
    const ringAmuletPct = 0.13;
    if (hasPhysAttack) {
      base.minAttack = Math.max(1, Math.floor(floatVal(realm.base_attack_min) * ringAmuletPct * 1.1));
      base.maxAttack = Math.max(1, Math.floor(floatVal(realm.base_attack_max) * ringAmuletPct * 1.1));
      delete base.minSpellAttack;
      delete base.maxSpellAttack;
      delete base.maxHp;
      delete base.physDefense;
      delete base.spellDefense;
      return base;
    }
    if (hasSpellAttack) {
      const spellBase = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
      base.minSpellAttack = Math.max(1, Math.floor(spellBase * ringAmuletPct * 1.0));
      base.maxSpellAttack = Math.max(1, Math.floor(spellBase * ringAmuletPct * 1.1));
      delete base.minAttack;
      delete base.maxAttack;
      delete base.maxHp;
      delete base.physDefense;
      delete base.spellDefense;
      return base;
    }
  }

  const br = getArmorBaseRangesForQuality(q);
  const hpMax = Math.max(1, Math.trunc(floatVal(br.hp_max) * armorMult));
  const defMax = Math.max(1, Math.trunc(floatVal(br.def_max) * armorMult));
  base.maxHp = hpMax;
  base.physDefense = defMax;
  base.spellDefense = Math.floor(floatVal(defMax) * 0.8);
  if (equipType === 'ring' || equipType === 'amulet') {
    delete base.minAttack;
    delete base.maxAttack;
    delete base.minSpellAttack;
    delete base.maxSpellAttack;
  }
  return base;
}

function getStandardBaseWhiteStatsByQuality(item, quality, baseStats = null) {
  const q = clampi(intVal(quality, 1), 1, MAX_AFFIX_TIER);
  const equipType = String(item?.type || '');
  const base = deepClone(baseStats || {});

  if (equipType === 'weapon') {
    const subtype = String(item?.subtype || '剑');
    const wm = getWeaponMultipliers(subtype);
    const realm = getRealmStatsForQuality(q);
    const spellBase = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
    base.minAttack = Math.max(1, Math.trunc(floatVal(realm.base_attack_min) * wm.phys * 0.85));
    base.maxAttack = Math.max(1, Math.trunc(floatVal(realm.base_attack_max) * wm.phys * 1.2));
    base.minSpellAttack = Math.max(1, Math.trunc(spellBase * wm.spell * 0.85));
    base.maxSpellAttack = Math.max(1, Math.trunc(spellBase * wm.spell * 1.2));
    return base;
  }

  let armorMult = 1.0;
  if (equipType === 'shoulder') armorMult = 0.85;
  else if (equipType === 'legs') armorMult = 0.70;
  else if (equipType === 'head') armorMult = 0.80;
  else if (equipType === 'hands') armorMult = 0.70;
  else if (equipType === 'ring') armorMult = 0.60;
  else if (equipType === 'amulet') armorMult = 0.60;
  else if (equipType === 'back') armorMult = 0.65;

  if (equipType === 'ring' || equipType === 'amulet') {
    const hasPhysAttack = intVal(base.minAttack, 0) > 0 || intVal(base.maxAttack, 0) > 0;
    const hasSpellAttack = intVal(base.minSpellAttack, 0) > 0 || intVal(base.maxSpellAttack, 0) > 0;
    const realm = getRealmStatsForQuality(q);
    const ringAmuletPct = 0.13;
    if (hasPhysAttack) {
      base.minAttack = Math.max(1, Math.floor(floatVal(realm.base_attack_min) * ringAmuletPct * 1.0));
      base.maxAttack = Math.max(1, Math.floor(floatVal(realm.base_attack_max) * ringAmuletPct * 1.0));
      delete base.minSpellAttack;
      delete base.maxSpellAttack;
      delete base.maxHp;
      delete base.physDefense;
      delete base.spellDefense;
      return base;
    }
    if (hasSpellAttack) {
      const spellBase = (floatVal(realm.base_attack_min) + floatVal(realm.base_attack_max)) / 2.0;
      base.minSpellAttack = Math.max(1, Math.floor(spellBase * ringAmuletPct * 0.95));
      base.maxSpellAttack = Math.max(1, Math.floor(spellBase * ringAmuletPct * 1.05));
      delete base.minAttack;
      delete base.maxAttack;
      delete base.maxHp;
      delete base.physDefense;
      delete base.spellDefense;
      return base;
    }
  }

  const br = getArmorBaseRangesForQuality(q);
  base.maxHp = Math.max(1, Math.trunc(((floatVal(br.hp_min) + floatVal(br.hp_max)) / 2.0) * armorMult));
  base.physDefense = Math.max(1, Math.trunc(((floatVal(br.def_min) + floatVal(br.def_max)) / 2.0) * armorMult));
  base.spellDefense = Math.floor(floatVal(base.physDefense) * 0.8);
  if (equipType === 'ring' || equipType === 'amulet') {
    delete base.minAttack;
    delete base.maxAttack;
    delete base.minSpellAttack;
    delete base.maxSpellAttack;
  }
  return base;
}

function _getExWhiteMultiplierCap(baseCurrent, standardMax) {
  const cur = baseCurrent && typeof baseCurrent === 'object' ? baseCurrent : {};
  const std = standardMax && typeof standardMax === 'object' ? standardMax : {};
  const hasAtk = intVal(cur.minAttack, 0) > 0 || intVal(cur.maxAttack, 0) > 0
    || intVal(cur.minSpellAttack, 0) > 0 || intVal(cur.maxSpellAttack, 0) > 0
    || intVal(std.minAttack, 0) > 0 || intVal(std.maxAttack, 0) > 0
    || intVal(std.minSpellAttack, 0) > 0 || intVal(std.maxSpellAttack, 0) > 0;
  // 防具EX常见倍率约 1.10；攻击型EX白字做适度放宽但避免异常脏值带入过高倍率。
  return hasAtk ? 1.3 : 1.2;
}

function scaleExWhiteStatsOnStandardMax(baseCurrent, standardMax, standardBase = null) {
  const out = deepClone(standardMax || {});
  const cur = baseCurrent && typeof baseCurrent === 'object' ? baseCurrent : {};
  const whiteRollKeys = ['minAttack', 'maxAttack', 'minSpellAttack', 'maxSpellAttack', 'maxHp', 'physDefense', 'spellDefense'];
  const inferKeysPrimary = ['maxAttack', 'maxSpellAttack', 'maxHp', 'physDefense', 'spellDefense'];
  const inferKeysFallback = ['minAttack', 'minSpellAttack'];

  // 统一推断 EX 倍率，避免按字段分别放大导致重复叠乘与指数膨胀。
  let inferredMult = 1;
  for (const key of inferKeysPrimary) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
    const stdV = intVal(out[key], 0);
    const curV = intVal(cur[key], 0);
    if (stdV <= 0 || curV <= 0) continue;
    inferredMult = Math.max(inferredMult, floatVal(curV, 0) / stdV);
  }
  if (inferredMult <= 1.000001) {
    for (const key of inferKeysFallback) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
      const stdV = intVal(out[key], 0);
      const curV = intVal(cur[key], 0);
      if (stdV <= 0 || curV <= 0) continue;
      inferredMult = Math.max(inferredMult, floatVal(curV, 0) / stdV);
    }
  }
  const cap = _getExWhiteMultiplierCap(cur, out);
  inferredMult = clampf(inferredMult, 1.0, cap);

  for (const key of whiteRollKeys) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
    const stdV = intVal(out[key], 0);
    if (stdV <= 0) continue;
    const tuned = Math.max(1, Math.round(stdV * inferredMult));
    out[key] = tuned;
  }
  return out;
}

function maximizeEquipmentForGoldenTuner(equipment) {
  if (!equipment || typeof equipment !== 'object') return { ok: false, error: '目标装备无效' };
  const equipType = String(equipment.type || '');
  if (!isValidEquipType(equipType)) return { ok: false, error: '仅支持装备调整' };

  const itemQuality = clampi(intVal(equipment.quality, 1), 1, MAX_AFFIX_TIER);
  const oldAffixes = normalizeAffixes(equipment);
  const affixCtx = getAffixContext(equipment, itemQuality);
  const allowedAffixStats = new Set((Array.isArray(affixCtx?.pool_stats) ? affixCtx.pool_stats : []).map(s => String(s)));
  const newAffixes = [];
  let affixesChanged = oldAffixes.length > 0 ? false : false;

  for (const oldAffix of oldAffixes) {
    const stat = String(oldAffix?.stat || '');
    if (!stat) continue;
    // 丢弃不在当前装备词缀池内的历史脏词缀，避免 minAttack/minSpellAttack 等字段被当作词缀叠回白字。
    if (!allowedAffixStats.has(stat)) {
      affixesChanged = true;
      continue;
    }
    const affixQ = clampi(intVal(oldAffix.quality, intVal(oldAffix.tier, 1)), 1, MAX_AFFIX_TIER);
    const rollT = MAX_AFFIX_TIER;
    const range = getAffixTierRangeByContext(stat, affixQ, rollT, affixCtx);
    const newValue = intVal(range?.max, intVal(oldAffix.value, 0));
    const newName = getAffixName(stat, affixQ);
    if (
      intVal(oldAffix.quality, intVal(oldAffix.tier, 1)) !== affixQ ||
      intVal(oldAffix.tier, affixQ) !== rollT ||
      intVal(oldAffix.value, 0) !== newValue ||
      String(oldAffix.name || '') !== newName
    ) {
      affixesChanged = true;
    }
    newAffixes.push({ name: newName, stat, quality: affixQ, tier: rollT, value: newValue });
  }

  const baseOld = extractBaseStatsFromAffixes(equipment, oldAffixes);
  const standardWhiteMax = getStandardMaxWhiteStatsByQuality(equipment, itemQuality, baseOld);
  const standardWhiteBase = getStandardBaseWhiteStatsByQuality(equipment, itemQuality, baseOld);
  const baseNew = Boolean(equipment.isEx)
    ? scaleExWhiteStatsOnStandardMax(baseOld, standardWhiteMax, standardWhiteBase)
    : standardWhiteMax;

  const extraNew = affixesToExtraStats(newAffixes);
  const statsNew = mergeBaseAndExtra(baseNew, extraNew);
  const whiteRollKeys = ['minAttack', 'maxAttack', 'minSpellAttack', 'maxSpellAttack', 'maxHp', 'physDefense', 'spellDefense'];
  for (const key of whiteRollKeys) {
    if (Object.prototype.hasOwnProperty.call(baseNew, key)) {
      statsNew[key] = intVal(baseNew[key], intVal(statsNew[key], 0));
    }
  }
  const minAtk = intVal(statsNew.minAttack, 0);
  const maxAtk = intVal(statsNew.maxAttack, 0);
  if (minAtk > 0 || maxAtk > 0) {
    const lo = Math.max(1, Math.min(minAtk > 0 ? minAtk : maxAtk, maxAtk > 0 ? maxAtk : minAtk));
    const hi = Math.max(lo, minAtk, maxAtk);
    statsNew.minAttack = lo;
    statsNew.maxAttack = hi;
  }
  const minSpell = intVal(statsNew.minSpellAttack, 0);
  const maxSpell = intVal(statsNew.maxSpellAttack, 0);
  if (minSpell > 0 || maxSpell > 0) {
    const lo = Math.max(1, Math.min(minSpell > 0 ? minSpell : maxSpell, maxSpell > 0 ? maxSpell : minSpell));
    const hi = Math.max(lo, minSpell, maxSpell);
    statsNew.minSpellAttack = lo;
    statsNew.maxSpellAttack = hi;
  }

  const oldStats = equipment.stats && typeof equipment.stats === 'object' ? equipment.stats : {};
  const oldExtra = equipment.randomExtraStats && typeof equipment.randomExtraStats === 'object' ? equipment.randomExtraStats : {};
  const rarity = getRarityByAffixCount(newAffixes.length);
  const requiredLevel = getRequiredLevelForItem(itemQuality, newAffixes);
  const metadataChanged =
    !areStatMapsEqual(oldStats, statsNew) ||
    !areStatMapsEqual(oldExtra, extraNew) ||
    intVal(equipment.affixCount, oldAffixes.length) !== newAffixes.length ||
    intVal(equipment.required_level, requiredLevel) !== requiredLevel ||
    String(equipment.rarity || '') !== String(rarity.key) ||
    String(equipment.rarityName || '') !== String(rarity.name);

  if (!affixesChanged && !metadataChanged) {
    return { ok: true, changed: false, equipment };
  }

  const result = deepClone(equipment);
  result.quality = itemQuality;
  result.affixes = newAffixes;
  result.affixCount = newAffixes.length;
  result.randomExtraStats = extraNew;
  result.stats = statsNew;
  result.rarity = rarity.key;
  result.rarityName = rarity.name;
  result.required_level = requiredLevel;
  if (!Boolean(result.isEx)) {
    const baseName = resolveStandardBaseName(result);
    result.baseName = baseName;
    result.name = composeStandardEquipmentName(baseName, newAffixes);
  }
  result.value = calculateItemValue(result);

  return { ok: true, changed: true, equipment: result };
}

function isEquipmentTypeForDrop(typ) {
  const t = String(typ || '');
  return ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'].includes(t);
}
function rollEquipmentFromTemplateItem(templateItem, maxAffixQuality = MAX_AFFIX_TIER) {
  if (!templateItem || typeof templateItem !== 'object') return null;
  const type = String(templateItem.type || '');
  if (!isEquipmentTypeForDrop(type)) return null;
  const q = clampi(intVal(templateItem.quality, 1), 1, 8);
  let out = null;
  if (type === 'weapon') {
    const subtype = String(templateItem.subtype || '剑');
    out = generateWeapon(subtype, q, maxAffixQuality);
  } else {
    out = generateArmor(type, q, maxAffixQuality);
  }
  if (!out || Object.keys(out).length <= 0) return null;
  out.element = String(templateItem.element || out.element || '');
  out.material = String(templateItem.material || out.material || '');
  return out;
}

module.exports = {
  EQUIPMENT_TYPES_WEAPON,
  EQUIPMENT_TYPES_ARMOR,
  CATALYST_ITEM_IDS,
  MAX_AFFIX_TIER,
  getEffectiveTier,
  getPlayerRealmQuality,
  getPlayerAffixQualityCap,
  getRequiredLevelForItem,
  generateWeapon,
  generateArmor,
  generateExEquipment,
  buildAffixesFromExtraStats,
  executeForging,
  executeUpgrade,
  executeAffixUpgrade,
  executeAffixTierReroll,
  applyAffixesToEquipment,
  executeReroll,
  executeZaohua,
  maximizeEquipmentForGoldenTuner,
  sanitizeEquipmentAffixValuesByQualityTier,
  isValidEquipType,
  isZaohuaLockedEquipment,
  isCatalystItem,
  canBeForgingMaterial,
  rollEquipmentFromTemplateItem,
  calculateRerollLockExtraCost
};
