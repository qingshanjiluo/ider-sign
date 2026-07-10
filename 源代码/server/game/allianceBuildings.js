/**
 * 仙盟建筑逻辑
 */
const { getItems, getItemById } = require('./dataLoader');

const BUILDING_NAMES = { statue: '雕像', spirit_pool: '灵池', garden: '仙园', enlightenment_tree: '悟道树', treasury: '宝阁', gate: '仙门' };
const BUILDING_KEYS = ['statue', 'spirit_pool', 'garden', 'enlightenment_tree', 'treasury', 'gate'];

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

/** 建筑升级消耗（仙盟物资），level 为当前等级，升到 level+1 */
const UPGRADE_COSTS = [0, 5000, 10000, 20000, 35000, 55000, 80000, 110000, 145000, 185000];
const GATE_UPGRADE_COSTS = UPGRADE_COSTS.map(c => Math.floor(c / 2));

function getUpgradeCost(currentLevel, building) {
  const lv = Math.max(1, Math.min(9, intVal(currentLevel, 1)));
  if (building === 'gate') return GATE_UPGRADE_COSTS[lv] || 0;
  return UPGRADE_COSTS[lv] || 0;
}

/** 仙门：成员上限 1级50人，每级+30人 */
function getMemberLimit(gateLevel) {
  const lv = Math.max(1, Math.min(10, intVal(gateLevel, 1)));
  return 50 + (lv - 1) * 30;
}

/** 灵池：属性加成 1%~5% */
function getSpiritPoolBonusPct(level) {
  const lv = Math.max(1, Math.min(10, intVal(level, 1)));
  return 1 + (lv - 1) * 4 / 9;
}

/** 悟道树：经验加成 1%~4% */
function getEnlightenmentBonusPct(level) {
  const lv = Math.max(1, Math.min(10, intVal(level, 1)));
  return 1 + (lv - 1) * 3 / 9;
}

/** 材料捐献价值：1阶3 2阶10 3阶20 4阶40 5阶80 */
const DONATE_TIER_VALUE = { 1: 3, 2: 10, 3: 20, 4: 40, 5: 80 };

const TIER1_IDS = new Set([20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10]);
const TIER2_IDS = new Set([25, 26, 27, 28, 29, 62, 63, 64, 65, 66, 67]);
const TIER3_IDS = new Set([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70]);
const TIER4_IDS = new Set([40, 41, 42, 43, 44, 71]);
const TIER5_IDS = new Set([72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);

function getMaterialTier(item) {
  if (!item || typeof item !== 'object') return 0;
  const id = intVal(item.id, 0);
  const type = String(item.type || '');
  const validTypes = ['herb', 'medicine', 'consumable', 'material'];
  if (!validTypes.includes(type)) return 0;
  if (TIER5_IDS.has(id)) return 5;
  if (TIER4_IDS.has(id)) return 4;
  if (TIER3_IDS.has(id)) return 3;
  if (TIER2_IDS.has(id)) return 2;
  if (TIER1_IDS.has(id)) return 1;
  const q = intVal(item.quality, 1);
  return Math.max(1, Math.min(6, q));
}

function getDonateValue(item, count) {
  const tier = getMaterialTier(item);
  if (tier <= 0) return 0;
  const per = DONATE_TIER_VALUE[tier] || 3;
  return per * Math.max(1, intVal(count, 1));
}

/**
 * 仙园各等级的阶别权重表
 * [T3, T4, T5, T6] — T5 从5级开始出现，T6 从9级开始出现
 */
const GARDEN_TIER_WEIGHTS = {
  1:  [85, 15,  0, 0],
  2:  [78, 22,  0, 0],
  3:  [72, 28,  0, 0],
  4:  [65, 35,  0, 0],
  5:  [60, 36,  4, 0],
  6:  [57, 36,  7, 0],
  7:  [55, 35, 10, 0],
  8:  [53, 35, 12, 0],
  9:  [52, 33, 13, 2],
  10: [52, 35, 10, 3],
};

function getGardenMaxTier(level) {
  const lv = Math.max(1, Math.min(10, intVal(level, 1)));
  if (lv >= 9) return 6;
  if (lv >= 5) return 5;
  return 4;
}

/** 仙园采摘：3-6阶材料池（herb/material/medicine），排除有特殊效果、产出限制或quality>6的物品 */
function getGardenMaterialPool(level) {
  const lv = Math.max(1, Math.min(10, intVal(level, 1)));
  const [w3, w4, w5, w6] = GARDEN_TIER_WEIGHTS[lv] || GARDEN_TIER_WEIGHTS[1];
  const maxTier = getGardenMaxTier(lv);
  const items = getItems() || [];
  const pool = [];
  const materialTypes = ['herb', 'material', 'medicine'];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (!materialTypes.includes(String(it.type || ''))) continue;
    const rawQuality = intVal(it.quality, 1);
    if (rawQuality > 6) continue;
    if (Array.isArray(it.effects) && it.effects.length > 0) continue;
    const tags = Array.isArray(it.tags) ? it.tags : [];
    if (tags.includes('no_dungeon_loot') || tags.includes('no_market') || tags.includes('no_garden')) continue;
    const t = getMaterialTier(it);
    if (t < 3 || t > maxTier) continue;
    const w = t === 6 ? w6 : (t === 5 ? w5 : (t === 4 ? w4 : w3));
    if (w <= 0) continue;
    pool.push({ item: it, tier: t, weight: w });
  }
  return pool;
}

function pickGardenMaterial(level, rng01) {
  const pool = getGardenMaterialPool(level);
  if (pool.length === 0) return null;
  const totalWeight = pool.reduce((s, p) => s + (p.weight || 10), 0);
  let r = (rng01 || Math.random()) * totalWeight;
  for (const p of pool) {
    r -= (p.weight || 10);
    if (r <= 0) return p.item;
  }
  return pool[0]?.item || null;
}

module.exports = {
  BUILDING_NAMES,
  BUILDING_KEYS,
  DONATE_TIER_VALUE,
  GARDEN_TIER_WEIGHTS,
  getUpgradeCost,
  getMemberLimit,
  getSpiritPoolBonusPct,
  getEnlightenmentBonusPct,
  getGardenMaxTier,
  getMaterialTier,
  getDonateValue,
  pickGardenMaterial,
  intVal
};
