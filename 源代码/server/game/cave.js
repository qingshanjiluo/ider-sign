/**
 * 洞府系统：灵田 / 灵矿
 * - 占用百艺队列（采集期间不可炼丹/炼器/制物）
 * - 每分钟 15% 概率产出随机 1-5 阶材料
 * - 灵田产出草木/液体/皮质，灵矿产出土石/金属/玉质
 * - 共享 rare 池，每日零点刷新
 */

const { getItemById, getArrayRunes, getArrayShapes } = require('./dataLoader');
const ops = require('./playerOps');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clone(v) { return structuredClone(v); }

// rare 值：材料产出消耗的灵气
const RARE_COST = { 1: 5, 2: 15, 3: 30, 4: 70, 5: 150 };

// 升级费用（level -> level+1），四级以后固定 150 万
const UPGRADE_COST = {
  1: 200000,
  2: 500000,
  3: 1500000,
  4: 1500000,
  5: 1500000,
  6: 1500000,
  7: 1500000,
  8: 1500000
};

const MAX_LEVEL = 9;
const FORMATION_BOARD_SIZE = 5;
const FORMATION_BOARD_CELLS = FORMATION_BOARD_SIZE * FORMATION_BOARD_SIZE;
const ARRAY_PLATE_TYPE = 'array_plate';
const ARRAY_RUNE_TYPE = 'array_rune';
const MAIN_SKILL_ABADDON = 'MAIN_ABADDON_BREACH';
const MAIN_SKILL_ASCENSION = 'MAIN_ASCENSION';
const MAIN_SKILL_SHENWU = 'MAIN_SHENWU';
const MAIN_SKILL_SHENYUN = 'MAIN_SHENYUN';
const MAIN_SKILL_KUANGYONG = 'MAIN_KUANGYONG';
const MAIN_SKILL_YANMIAN = 'MAIN_YANMIAN';
const MAIN_SKILL_FACHAO = 'MAIN_FACHAO';
const MAIN_SKILL_SHENGUANG = 'MAIN_SHENGUANG';
const MAIN_SKILL_GAIWU = 'MAIN_GAIWU';
const MAIN_SKILL_DAOTI = 'MAIN_DAOTI';
const ABADDON_START_COST = 5000;
const ABADDON_HOURLY_COST = 2000;
const ASCENSION_START_COST = 10000;
const ASCENSION_HOURLY_COST = 1000;
const SHENWU_START_COST = 5000;
const SHENWU_HOURLY_COST = 3000;
const SHENYUN_START_COST = 5000;
const SHENYUN_HOURLY_COST = 3000;
const KUANGYONG_START_COST = 5000;
const KUANGYONG_HOURLY_COST = 2000;
const YANMIAN_START_COST = 5000;
const YANMIAN_HOURLY_COST = 2000;
const FACHAO_START_COST = 5000;
const FACHAO_HOURLY_COST = 2000;
const SHENGUANG_START_COST = 5000;
const SHENGUANG_HOURLY_COST = 2000;
const GAIWU_START_COST = 5000;
const GAIWU_HOURLY_COST = 10000;
const DAOTI_START_COST = 5000;
const DAOTI_HOURLY_COST = 2000;
const MAIN_SERVICE_CONFIG = Object.freeze({
  [MAIN_SKILL_ABADDON]: {
    key: 'abaddon',
    start_cost: ABADDON_START_COST,
    hourly_cost: ABADDON_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1
  },
  [MAIN_SKILL_ASCENSION]: {
    key: 'yangsheng',
    start_cost: ASCENSION_START_COST,
    hourly_cost: ASCENSION_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1
  },
  [MAIN_SKILL_SHENWU]: {
    key: 'shenwu',
    start_cost: SHENWU_START_COST,
    hourly_cost: SHENWU_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0.05,
    wild_drop_rate_mult: 1
  },
  [MAIN_SKILL_SHENYUN]: {
    key: 'shenyun',
    start_cost: SHENYUN_START_COST,
    hourly_cost: SHENYUN_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1.1
  },
  [MAIN_SKILL_KUANGYONG]: {
    key: 'kuangyong',
    start_cost: KUANGYONG_START_COST,
    hourly_cost: KUANGYONG_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0.15,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1
  },
  [MAIN_SKILL_YANMIAN]: {
    key: 'yanmian',
    start_cost: YANMIAN_START_COST,
    hourly_cost: YANMIAN_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 2,
    skill_multi_hit_damage_mul: 0.7
  },
  [MAIN_SKILL_FACHAO]: {
    key: 'fachao',
    start_cost: FACHAO_START_COST,
    hourly_cost: FACHAO_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1,
    battle_bone_floor: 1
  },
  [MAIN_SKILL_SHENGUANG]: {
    key: 'shenguang',
    start_cost: SHENGUANG_START_COST,
    hourly_cost: SHENGUANG_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1,
    spell_absolute_damage_ratio: 0.15
  },
  [MAIN_SKILL_GAIWU]: {
    key: 'gaiwu',
    start_cost: GAIWU_START_COST,
    hourly_cost: GAIWU_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1,
    hourly_exp_gain_equal_cost: true
  },
  [MAIN_SKILL_DAOTI]: {
    key: 'daoti',
    start_cost: DAOTI_START_COST,
    hourly_cost: DAOTI_HOURLY_COST,
    equip_level_allowance: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1,
    overheal_to_temp_shield: true
  }
});
const CARDINAL_DIRS = ['N', 'E', 'S', 'W'];
const DIR_OFFSETS = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};

function _normalizeRotation(v) {
  const n = intVal(v, 0);
  return ((n % 4) + 4) % 4;
}

function _rotateDirCW(dir, turns = 1) {
  const d = String(dir || '').trim().toUpperCase();
  if (!DIR_OFFSETS[d]) return '';
  const order = ['N', 'E', 'S', 'W'];
  const idx = order.indexOf(d);
  if (idx < 0) return '';
  const step = _normalizeRotation(turns);
  return order[(idx + step) % 4];
}

function _rotateArrowDirs(dirs, turns = 1) {
  const step = _normalizeRotation(turns);
  if (step === 0) return _normalizeArrowDirs(dirs);
  const src = _normalizeArrowDirs(dirs);
  const out = [];
  for (const dir of src) {
    const r = _rotateDirCW(dir, step);
    if (!r || out.includes(r)) continue;
    out.push(r);
  }
  return out;
}

const RUNE_ROLL_PCT_MIN = 0;
const RUNE_ROLL_PCT_MAX = 3;

const RUNE_COMBAT_RULES = Object.freeze({
  RUNE_STRIKE: { kind: 'attr_pct', attr: 'strength', base_pct: 1.5, per_link_pct: 0.6 },
  RUNE_GUARD: { kind: 'attr_pct', attr: 'constitution', base_pct: 1.5, per_link_pct: 0.6 },
  RUNE_BONE: { kind: 'attr_pct', attr: 'bone', base_pct: 1.2, per_link_pct: 0.5 },
  RUNE_SWIFT: { kind: 'attr_pct', attr: 'agility', base_pct: 1.0, per_link_pct: 0.5 },
  RUNE_QI: { kind: 'attr_pct', attr: 'zhenyuan', base_pct: 1.5, per_link_pct: 0.6 },
  RUNE_SPIRIT: { kind: 'attr_pct', attr: 'lingli', base_pct: 1.5, per_link_pct: 0.6 },
  RUNE_PHYS_CRIT: { kind: 'phys_crit_rate_pct', base_pct: 0.8, per_link_pct: 0.35 },
  RUNE_SPELL_CRIT: { kind: 'spell_crit_rate_pct', base_pct: 0.8, per_link_pct: 0.35 },
  RUNE_MANA_FLOW: { kind: 'turn_end_mp_pct_of_max_mp', base_pct: 1.2, per_link_pct: 0.6 },
  RUNE_BALANCE: { kind: 'balance_lowest_attr_pct', base_pct: 1.0, per_link_pct: 0.4 }
});

function randomInt(minV, maxV) {
  const lo = Math.min(intVal(minV, 0), intVal(maxV, 0));
  const hi = Math.max(intVal(minV, 0), intVal(maxV, 0));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function _rollRuneEffectPct() {
  return randomInt(RUNE_ROLL_PCT_MIN, RUNE_ROLL_PCT_MAX);
}

let _cachedRuneEffectPool = null;
let _cachedPlateAffixPool = null;
let _cachedShapeMetaById = null;
let _cachedShapeCellsById = null;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _clampRuneRollPct(v) {
  return _clamp(intVal(v, 0), RUNE_ROLL_PCT_MIN, RUNE_ROLL_PCT_MAX);
}

function _buildRuneEffectPool() {
  const cfg = getArrayRunes();
  const out = [];
  for (const effectRaw of (Array.isArray(cfg?.effects) ? cfg.effects : [])) {
    if (!effectRaw || typeof effectRaw !== 'object') continue;
    const effectId = String(effectRaw.effect_id || '').trim();
    if (!effectId) continue;
    const flowCost = Math.max(0, intVal(effectRaw.flow_cost, 0));
    const triggerValue = Math.max(1, intVal(effectRaw.main_trigger_value, Math.max(1, flowCost || 1)));
    out.push({
      effect_id: effectId,
      name: String(effectRaw.name || effectId),
      desc: String(effectRaw.desc || ''),
      flow_cost: flowCost,
      main_trigger_value: triggerValue
    });
  }
  return out;
}

function _getRuneEffectPool() {
  if (!_cachedRuneEffectPool) _cachedRuneEffectPool = _buildRuneEffectPool();
  return _cachedRuneEffectPool;
}

function _pickRandomRuneEffect() {
  const pool = _getRuneEffectPool();
  if (!Array.isArray(pool) || pool.length <= 0) return null;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function _buildPlateAffixPool() {
  const cfg = getArrayRunes();
  const rawPool = Array.isArray(cfg?.main_plate_system?.plate_affix_pool)
    ? cfg.main_plate_system.plate_affix_pool
    : [];
  const out = [];
  for (const affixRaw of rawPool) {
    if (!affixRaw || typeof affixRaw !== 'object') continue;
    const affixId = String(affixRaw.affix_id || '').trim();
    const type = String(affixRaw.type || '').trim();
    if (!affixId || !type) continue;
    if (type !== 'pointed_effect_amp_pct' && type !== 'pointed_all_effect_amp_pct') continue;
    const targetEffectId = String(affixRaw.target_effect_id || '').trim();
    if (type === 'pointed_effect_amp_pct' && !targetEffectId) continue;
    const rollPctByShape = [];
    const rollList = Array.isArray(affixRaw.roll_pct_by_shape)
      ? affixRaw.roll_pct_by_shape
      : (Array.isArray(affixRaw.roll_pct_by_quality) ? affixRaw.roll_pct_by_quality : []);
    for (const raw of rollList) {
      const v = Math.max(0, intVal(raw, 0));
      if (v > 0) rollPctByShape.push(v);
    }
    if (rollPctByShape.length <= 0) continue;
    out.push({
      affix_id: affixId,
      name: String(affixRaw.name || affixId),
      type,
      target_effect_id: targetEffectId,
      roll_pct_by_shape: rollPctByShape
    });
  }
  return out;
}

function _getPlateAffixPool() {
  if (!_cachedPlateAffixPool) _cachedPlateAffixPool = _buildPlateAffixPool();
  return _cachedPlateAffixPool;
}

function _buildShapeMetaById() {
  const map = new Map();
  for (const shapeRaw of (Array.isArray(getArrayShapes()) ? getArrayShapes() : [])) {
    if (!shapeRaw || typeof shapeRaw !== 'object') continue;
    const shapeId = String(shapeRaw.shape_id || '').trim();
    if (!shapeId) continue;
    const unique = [];
    const seen = new Set();
    for (const c of (Array.isArray(shapeRaw.cells) ? shapeRaw.cells : [])) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const x = intVal(c[0], 0);
      const y = intVal(c[1], 0);
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push({ x, y });
    }
    const cellCount = Math.max(1, unique.length);
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    if (unique.length > 0) {
      minX = Math.min(...unique.map((v) => v.x));
      maxX = Math.max(...unique.map((v) => v.x));
      minY = Math.min(...unique.map((v) => v.y));
      maxY = Math.max(...unique.map((v) => v.y));
    }
    const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    let branchCount = 0;
    let endpointCount = 0;
    for (const cell of unique) {
      let deg = 0;
      for (const off of Object.values(DIR_OFFSETS)) {
        const nk = `${cell.x + off.dx},${cell.y + off.dy}`;
        if (seen.has(nk)) deg += 1;
      }
      if (deg >= 3) branchCount += 1;
      if (deg === 1) endpointCount += 1;
    }
    const xSet = new Set(unique.map((v) => v.x));
    const ySet = new Set(unique.map((v) => v.y));
    const isLine = xSet.size <= 1 || ySet.size <= 1;
    const hollowScore = Math.max(0, bboxArea - cellCount);
    let weirdScore = hollowScore + branchCount * 2 + Math.max(0, endpointCount - 2);
    if (!isLine && cellCount >= 3) weirdScore += 1;
    map.set(shapeId, {
      shape_id: shapeId,
      cell_count: cellCount,
      weird_score: Math.max(0, weirdScore)
    });
  }
  return map;
}

function _getShapeMeta(shapeId) {
  if (!_cachedShapeMetaById) _cachedShapeMetaById = _buildShapeMetaById();
  const key = String(shapeId || '').trim();
  if (!key) return { shape_id: '', cell_count: 1, weird_score: 0 };
  return _cachedShapeMetaById.get(key) || { shape_id: key, cell_count: 1, weird_score: 0 };
}

function _buildShapeCellsById() {
  const map = new Map();
  for (const shapeRaw of (Array.isArray(getArrayShapes()) ? getArrayShapes() : [])) {
    if (!shapeRaw || typeof shapeRaw !== 'object') continue;
    const shapeId = String(shapeRaw.shape_id || '').trim();
    if (!shapeId) continue;
    const out = [];
    const seen = new Set();
    for (const c of (Array.isArray(shapeRaw.cells) ? shapeRaw.cells : [])) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const x = intVal(c[0], 0);
      const y = intVal(c[1], 0);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
    }
    if (out.length > 0 && !out.some((v) => intVal(v.x, 0) === 0 && intVal(v.y, 0) === 0)) {
      let sumX = 0;
      let sumY = 0;
      for (const v of out) {
        sumX += intVal(v.x, 0);
        sumY += intVal(v.y, 0);
      }
      const cx = sumX / out.length;
      const cy = sumY / out.length;
      let anchor = out[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const v of out) {
        const dx = intVal(v.x, 0) - cx;
        const dy = intVal(v.y, 0) - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          anchor = v;
        }
      }
      const anchorX = intVal(anchor?.x, 0);
      const anchorY = intVal(anchor?.y, 0);
      for (const v of out) {
        v.x = intVal(v.x, 0) - anchorX;
        v.y = intVal(v.y, 0) - anchorY;
      }
    }
    if (out.length <= 0) out.push({ x: 0, y: 0 });
    map.set(shapeId, out);
  }
  return map;
}

function _getShapeCells(shapeId) {
  if (!_cachedShapeCellsById) _cachedShapeCellsById = _buildShapeCellsById();
  const key = String(shapeId || '').trim();
  const cells = key ? _cachedShapeCellsById.get(key) : null;
  return Array.isArray(cells) && cells.length > 0 ? cells : [{ x: 0, y: 0 }];
}

function _calcPieceOccupiedIndexes(piece, anchorIndex, boardSize) {
  const idx = intVal(anchorIndex, -1);
  const size = Math.max(1, intVal(boardSize, FORMATION_BOARD_SIZE));
  const total = size * size;
  if (idx < 0 || idx >= total) return [];
  const anchorX = idx % size;
  const anchorY = Math.floor(idx / size);
  const itemType = _normalizeArrayPieceType(piece?.item_type || piece?.type);
  if (itemType !== ARRAY_PLATE_TYPE) return [idx];
  const cellsRaw = _getShapeCells(String(piece?.shape_id || ''));
  const rot = _normalizeRotation(piece?.rotation || 0);
  const cells = cellsRaw.map((c) => {
    const x0 = intVal(c?.x, 0);
    const y0 = intVal(c?.y, 0);
    if (rot === 1) return { x: y0, y: -x0 };
    if (rot === 2) return { x: -x0, y: -y0 };
    if (rot === 3) return { x: -y0, y: x0 };
    return { x: x0, y: y0 };
  });
  const out = [];
  const seen = new Set();
  for (const c of cells) {
    const x = anchorX + intVal(c?.x, 0);
    const y = anchorY + intVal(c?.y, 0);
    if (x < 0 || x >= size || y < 0 || y >= size) return [];
    const bi = y * size + x;
    if (bi < 0 || bi >= total) return [];
    if (seen.has(bi)) continue;
    seen.add(bi);
    out.push(bi);
  }
  if (out.length <= 0) out.push(idx);
  return out;
}

function _pickDisplayIndexFromOccupied(occupiedIndexes, boardSize) {
  const list = Array.isArray(occupiedIndexes) ? occupiedIndexes : [];
  const size = Math.max(1, intVal(boardSize, FORMATION_BOARD_SIZE));
  const total = size * size;
  const points = [];
  let sumX = 0;
  let sumY = 0;
  for (const raw of list) {
    const idx = intVal(raw, -1);
    if (idx < 0 || idx >= total) continue;
    const x = idx % size;
    const y = Math.floor(idx / size);
    points.push({ idx, x, y });
    sumX += x;
    sumY += y;
  }
  if (points.length <= 0) return -1;
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  let best = points[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist || (dist === bestDist && p.idx < best.idx)) {
      best = p;
      bestDist = dist;
    }
  }
  return best.idx;
}

function _resolveAnchorIndexForDisplay(piece, targetDisplayIndex, boardSize) {
  const target = intVal(targetDisplayIndex, -1);
  const size = Math.max(1, intVal(boardSize, FORMATION_BOARD_SIZE));
  const total = size * size;
  if (target < 0 || target >= total) return -1;

  const itemType = _normalizeArrayPieceType(piece?.item_type || piece?.type);
  if (itemType !== ARRAY_PLATE_TYPE) return target;

  const targetX = target % size;
  const targetY = Math.floor(target / size);
  const cellsRaw = _getShapeCells(String(piece?.shape_id || ''));
  const rot = _normalizeRotation(piece?.rotation || 0);
  const cells = cellsRaw.map((c) => {
    const x0 = intVal(c?.x, 0);
    const y0 = intVal(c?.y, 0);
    if (rot === 1) return { x: y0, y: -x0 };
    if (rot === 2) return { x: -x0, y: -y0 };
    if (rot === 3) return { x: -y0, y: x0 };
    return { x: x0, y: y0 };
  });

  for (const c of cells) {
    const anchorX = targetX - intVal(c?.x, 0);
    const anchorY = targetY - intVal(c?.y, 0);
    if (anchorX < 0 || anchorX >= size || anchorY < 0 || anchorY >= size) continue;
    const anchorIdx = anchorY * size + anchorX;
    const occupied = _calcPieceOccupiedIndexes(piece, anchorIdx, size);
    if (occupied.length <= 0) continue;
    const displayIdx = _pickDisplayIndexFromOccupied(occupied, size);
    if (displayIdx === target) return anchorIdx;
  }
  return -1;
}

function _rollPlateAffixValuePct(rollPctByShape, shapeTier) {
  const list = Array.isArray(rollPctByShape)
    ? rollPctByShape.map((v) => Math.max(0, intVal(v, 0))).filter((v) => v > 0)
    : [];
  if (list.length <= 0) return 0;
  const idx = _clamp(intVal(shapeTier, 1) - 1, 0, list.length - 1);
  const high = list[idx];
  const low = idx > 0 ? list[idx - 1] : high;
  const lo = Math.max(1, Math.min(low, high));
  const hi = Math.max(lo, Math.max(low, high));
  return randomInt(lo, hi);
}

function _rollPlateAffixesForShape(shapeId) {
  const pool = _getPlateAffixPool();
  if (!Array.isArray(pool) || pool.length <= 0) return [];

  const shapeMeta = _getShapeMeta(shapeId);
  const cellCount = Math.max(1, intVal(shapeMeta?.cell_count, 1));
  const weirdScore = Math.max(0, intVal(shapeMeta?.weird_score, 0));

  const shapeTier = _clamp(
    1 + Math.floor((cellCount - 1) / 2) + Math.floor((weirdScore + 1) / 2),
    1,
    5
  );

  let affixCount = 1;
  if (cellCount >= 3 && Math.random() < 0.62) affixCount += 1;
  if ((cellCount >= 4 || weirdScore >= 2) && Math.random() < 0.40) affixCount += 1;
  if (cellCount >= 5 && weirdScore >= 3 && Math.random() < 0.30) affixCount += 1;
  affixCount = _clamp(affixCount, 1, pool.length);

  const bag = pool.slice();
  const out = [];
  while (out.length < affixCount && bag.length > 0) {
    const idx = Math.floor(Math.random() * bag.length);
    const affix = bag.splice(idx, 1)[0];
    if (!affix) continue;
    const valuePct = _rollPlateAffixValuePct(affix.roll_pct_by_shape, shapeTier);
    if (valuePct <= 0) continue;
    out.push({
      bonus_id: String(affix.affix_id || ''),
      name: String(affix.name || affix.affix_id || '阵盘词条'),
      type: String(affix.type || ''),
      target_effect_id: String(affix.target_effect_id || ''),
      value_pct: valuePct,
      source: 'plate_roll'
    });
  }
  return out;
}

function _sanitizePlateAffixList(rawList, { autoRollShapeId = '' } = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const tplById = new Map();
  for (const tpl of _getPlateAffixPool()) {
    tplById.set(String(tpl.affix_id || ''), tpl);
  }

  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const bonusId = String(raw.bonus_id || raw.affix_id || '').trim();
    const tpl = bonusId ? tplById.get(bonusId) : null;
    const type = String(raw.type || tpl?.type || '').trim();
    if (type !== 'pointed_effect_amp_pct' && type !== 'pointed_all_effect_amp_pct') continue;
    const targetEffectId = String(raw.target_effect_id || tpl?.target_effect_id || '').trim();
    if (type === 'pointed_effect_amp_pct' && !targetEffectId) continue;
    const valuePct = Math.max(0, numVal(raw.value_pct, raw.value));
    if (valuePct <= 0) continue;

    const finalBonusId = bonusId || String(tpl?.affix_id || '').trim();
    if (!finalBonusId) continue;
    out.push({
      bonus_id: finalBonusId,
      name: String(raw.name || tpl?.name || finalBonusId),
      type,
      target_effect_id: targetEffectId,
      value_pct: valuePct,
      source: String(raw.source || 'plate_roll')
    });
  }

  if (out.length > 0) return out;
  return _rollPlateAffixesForShape(autoRollShapeId);
}

const LEVEL_DROP_CHANCE = { 1: 0.15, 2: 0.30, 3: 0.50, 4: 0.75, 5: 1.0, 6: 1.0, 7: 1.0, 8: 1.0, 9: 1.0 };
const LEVEL_DROP_COUNT = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 3 };

// rare 上限：等级 -> 上限
function getRareCap(level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, intVal(level, 1)));
  if (lv === 1) return 500;
  if (lv <= 7) return 500 + 500 + (lv - 2) * 1000;
  return 6000 + (lv - 7) * 2000; // lv8=8000, lv9=10000
}

// 材料池（按 material 字段分类，排除限制产出的物品）
const FIELD_MATERIALS = {
  1: [4, 6, 7, 8, 9, 17, 21, 23, 58, 59, 60, 61, 159, 10, 22, 161, 18],
  2: [26, 63, 65, 66, 67, 64, 28],
  3: [32, 33, 68, 35, 36],
  4: [41, 42, 43, 178],
  5: [47, 52, 50]
};

const MINE_MATERIALS = {
  1: [20, 62, 24],
  2: [25, 27, 29],
  3: [37, 38, 69, 70, 39, 30, 31, 34],
  4: [44, 71, 169, 40, 182],
  5: [45, 46, 49, 53, 54, 48, 51]
};

const RUNE_DECOMPOSE_TIER1_REWARD_IDS = Array.from(new Set([
  ...FIELD_MATERIALS[1],
  ...MINE_MATERIALS[1]
]));

const PLATE_DECOMPOSE_TIER2_REWARD_IDS = Array.from(new Set([
  ...FIELD_MATERIALS[2],
  ...MINE_MATERIALS[2]
]));

function _ensureMainServiceState(cave) {
  if (!cave.main_services || typeof cave.main_services !== 'object' || Array.isArray(cave.main_services)) {
    cave.main_services = {};
  }

  const normalizeState = (raw) => {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      active: !!src.active,
      started_at: Math.max(0, intVal(src.started_at, 0)),
      last_fee_at: Math.max(0, intVal(src.last_fee_at, 0)),
      total_spent: Math.max(0, intVal(src.total_spent, 0)),
      last_change_at: Math.max(0, intVal(src.last_change_at, 0))
    };
  };

  const svcRoot = cave.main_services;
  for (const cfg of Object.values(MAIN_SERVICE_CONFIG)) {
    const key = String(cfg?.key || '');
    if (!key) continue;
    if (!svcRoot[key] || typeof svcRoot[key] !== 'object' || Array.isArray(svcRoot[key])) {
      svcRoot[key] = {};
    }
    const entry = svcRoot[key];
    const legacy = normalizeState(entry);
    const srcInstances = entry.instances && typeof entry.instances === 'object' && !Array.isArray(entry.instances)
      ? entry.instances
      : {};
    const instances = {};
    for (const [instanceKeyRaw, stateRaw] of Object.entries(srcInstances)) {
      const instanceKey = String(instanceKeyRaw || '').trim();
      if (!instanceKey) continue;
      instances[instanceKey] = normalizeState(stateRaw);
    }
    entry.instances = instances;

    const states = Object.values(instances);
    if (states.length > 0) {
      entry.active = states.some((s) => !!s.active);
      entry.started_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.started_at, 0))), 0);
      entry.last_fee_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.last_fee_at, 0))), 0);
      entry.total_spent = states.reduce((acc, s) => acc + Math.max(0, intVal(s.total_spent, 0)), 0);
      entry.last_change_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.last_change_at, 0))), 0);
    } else {
      entry.active = legacy.active;
      entry.started_at = legacy.started_at;
      entry.last_fee_at = legacy.last_fee_at;
      entry.total_spent = legacy.total_spent;
      entry.last_change_at = legacy.last_change_at;
    }
  }
  return svcRoot;
}

function ensureCaveState(player) {
  if (!player.cave || typeof player.cave !== 'object') {
    player.cave = {};
  }
  const c = player.cave;
  c.level = Math.max(1, Math.min(MAX_LEVEL, intVal(c.level, 1)));
  const rareCap = getRareCap(c.level);
  c.rare_max = rareCap;
  c.rare_remaining = Math.max(0, Math.min(rareCap, intVal(c.rare_remaining, rareCap)));
  c.last_rare_reset = intVal(c.last_rare_reset, 0);
  if (!Array.isArray(c.today_log)) c.today_log = [];
  c.main_trigger_settle_count_today = Math.max(0, intVal(c.main_trigger_settle_count_today, 0));
  c.main_spirit_today = Math.max(0, intVal(c.main_spirit_today, 0));
  if (!c.gathering || typeof c.gathering !== 'object') c.gathering = null;
  _ensureMainServiceState(c);
  _ensureFormationStateInCave(c);
  return c;
}

function _normalizeArrayPieceType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === ARRAY_PLATE_TYPE || t === 'plate') return ARRAY_PLATE_TYPE;
  if (t === ARRAY_RUNE_TYPE || t === 'rune') return ARRAY_RUNE_TYPE;
  return '';
}

function _normalizeArrowDirs(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const d of list) {
    const dir = String(d || '').trim().toUpperCase();
    if (!DIR_OFFSETS[dir]) continue;
    if (out.includes(dir)) continue;
    out.push(dir);
  }
  return out;
}

function _neighborIndex(index, dir, boardSize) {
  const offset = DIR_OFFSETS[String(dir || '').trim().toUpperCase()];
  if (!offset) return -1;
  const x = index % boardSize;
  const y = Math.floor(index / boardSize);
  const nx = x + offset.dx;
  const ny = y + offset.dy;
  if (nx < 0 || nx >= boardSize || ny < 0 || ny >= boardSize) return -1;
  return ny * boardSize + nx;
}

function _sanitizeFormationPiece(piece, fallbackType = '') {
  if (!piece || typeof piece !== 'object') return null;
  const itemType = _normalizeArrayPieceType(piece.item_type || piece.type || fallbackType);
  if (!itemType) return null;
  const uid = String(piece.uid || '').trim();
  if (!uid) return null;
  const quality = 1;
  const shapeId = String(piece.shape_id || '');
  let flowCost = Math.max(0, intVal(piece.flow_cost, 0));
  let mainTriggerValue = intVal(piece.main_trigger_value, itemType === ARRAY_RUNE_TYPE ? Math.max(1, flowCost || 1) : 0);
  if (itemType === ARRAY_RUNE_TYPE && mainTriggerValue <= 0) mainTriggerValue = 1;
  if (itemType !== ARRAY_RUNE_TYPE && mainTriggerValue < 0) mainTriggerValue = 0;

  let effectId = String(piece.effect_id || '').trim();
  let effectName = String(piece.effect || '').trim();
  let effectDesc = String(piece.effect_desc || '').trim();
  let effectRandomized = itemType === ARRAY_RUNE_TYPE ? !!piece.effect_randomized : false;
  if (itemType === ARRAY_RUNE_TYPE && !effectRandomized) {
    const rolledEffect = _pickRandomRuneEffect();
    if (rolledEffect) {
      effectId = String(rolledEffect.effect_id || effectId);
      effectName = String(rolledEffect.name || effectName || effectId);
      effectDesc = String(rolledEffect.desc || effectDesc);
      flowCost = Math.max(0, intVal(rolledEffect.flow_cost, flowCost));
      mainTriggerValue = Math.max(1, intVal(rolledEffect.main_trigger_value, Math.max(1, flowCost || 1)));
    }
    effectRandomized = true;
  }

  let effectRollPct = intVal(piece.effect_roll_pct, 0);
  if (itemType === ARRAY_RUNE_TYPE) effectRollPct = _clampRuneRollPct(effectRollPct);
  else effectRollPct = 0;
  const plateAffixes = itemType === ARRAY_PLATE_TYPE
    ? _sanitizePlateAffixList(piece.plate_affixes, { autoRollShapeId: shapeId })
    : [];
  return {
    uid,
    item_id: intVal(piece.item_id, 0),
    name: String(piece.name || piece.item_name || (itemType === ARRAY_PLATE_TYPE ? '阵盘' : '阵纹')),
    quality,
    item_type: itemType,
    shape_id: shapeId,
    shape_name: String(piece.shape_name || ''),
    flow_supply: intVal(piece.flow_supply, 0),
    slot: String(piece.slot || ''),
    arrow_dirs: _normalizeArrowDirs(piece.arrow_dirs),
    rotation: _normalizeRotation(piece.rotation || 0),
    effect_id: effectId,
    effect: effectName,
    effect_desc: effectDesc,
    effect_randomized: effectRandomized,
    flow_cost: flowCost,
    main_trigger_value: mainTriggerValue,
    effect_roll_pct: effectRollPct,
    plate_affixes: plateAffixes,
    created_at: intVal(piece.created_at, 0)
  };
}

function _ensureFormationStateInCave(caveState) {
  caveState.formation = caveState.formation && typeof caveState.formation === 'object' ? caveState.formation : {};
  const formation = caveState.formation;
  formation.board_size = FORMATION_BOARD_SIZE;
  formation.next_uid = Math.max(1, intVal(formation.next_uid, 1));

  const used = new Set();
  const board = Array.isArray(formation.board) ? formation.board.slice(0, FORMATION_BOARD_CELLS) : [];
  while (board.length < FORMATION_BOARD_CELLS) board.push(null);
  formation.board = board.map((cell) => {
    const piece = _sanitizeFormationPiece(cell);
    if (!piece) return null;
    if (used.has(piece.uid)) return null;
    used.add(piece.uid);
    return piece;
  });

  const sanitizePool = (arr, expectedType) => {
    const raw = Array.isArray(arr) ? arr : [];
    const out = [];
    for (const pieceRaw of raw) {
      const piece = _sanitizeFormationPiece(pieceRaw, expectedType);
      if (!piece || piece.item_type !== expectedType) continue;
      if (used.has(piece.uid)) continue;
      used.add(piece.uid);
      out.push(piece);
    }
    return out;
  };

  formation.plate_pool = sanitizePool(formation.plate_pool, ARRAY_PLATE_TYPE);
  formation.rune_pool = sanitizePool(formation.rune_pool, ARRAY_RUNE_TYPE);
  return formation;
}

function ensureCaveFormationState(player) {
  const cave = ensureCaveState(player);
  return _ensureFormationStateInCave(cave);
}

function _collectFormationUidSet(formation) {
  const set = new Set();
  for (const cell of Array.isArray(formation.board) ? formation.board : []) {
    if (cell && typeof cell === 'object' && cell.uid) set.add(String(cell.uid));
  }
  for (const piece of Array.isArray(formation.plate_pool) ? formation.plate_pool : []) {
    if (piece && typeof piece === 'object' && piece.uid) set.add(String(piece.uid));
  }
  for (const piece of Array.isArray(formation.rune_pool) ? formation.rune_pool : []) {
    if (piece && typeof piece === 'object' && piece.uid) set.add(String(piece.uid));
  }
  return set;
}

function _allocFormationUid(formation) {
  let next = Math.max(1, intVal(formation.next_uid, 1));
  const used = _collectFormationUidSet(formation);
  let uid = 'af_' + next;
  while (used.has(uid)) {
    next += 1;
    uid = 'af_' + next;
  }
  formation.next_uid = next + 1;
  return uid;
}

function _buildFormationPieceFromItem(formation, item, nowSec) {
  const itemType = _normalizeArrayPieceType(item?.type);
  if (!itemType) return null;
  const quality = 1;
  const shapeId = String(item?.array_shape_id || '');
  const shapeName = String(item?.array_shape_name || '');
  const slot = String(item?.array_slot || item?.array_gua_slot || '');
  const arrowDirs = _normalizeArrowDirs(item?.array_arrow_dirs);

  let flowCost = Math.max(0, intVal(item?.array_flow_cost, 0));
  let triggerValue = intVal(item?.array_trigger_value, itemType === ARRAY_RUNE_TYPE ? Math.max(1, flowCost || 1) : 0);
  let effectId = String(item?.array_effect_id || '');
  let effectName = String(item?.array_effect || '');
  let effectDesc = String(item?.array_effect_desc || '');
  let effectRandomized = false;
  let plateAffixes = [];

  if (itemType === ARRAY_RUNE_TYPE) {
    const rolledEffect = _pickRandomRuneEffect();
    if (rolledEffect) {
      effectId = String(rolledEffect.effect_id || effectId);
      effectName = String(rolledEffect.name || effectName || effectId);
      effectDesc = String(rolledEffect.desc || effectDesc);
      flowCost = Math.max(0, intVal(rolledEffect.flow_cost, flowCost));
      triggerValue = Math.max(1, intVal(rolledEffect.main_trigger_value, Math.max(1, flowCost || 1)));
      effectRandomized = true;
    } else {
      if (triggerValue <= 0) triggerValue = 1;
      if (!effectName) effectName = effectId;
      effectRandomized = true;
    }
  } else {
    if (triggerValue < 0) triggerValue = 0;
    plateAffixes = _sanitizePlateAffixList(item?.plate_affixes || item?.array_plate_affixes, {
      autoRollShapeId: shapeId
    });
  }

  let effectRollPct = intVal(item?.array_effect_roll_pct, intVal(item?.effect_roll_pct, -1));
  if (itemType === ARRAY_RUNE_TYPE) {
    if (effectRollPct < 0) effectRollPct = _rollRuneEffectPct();
    effectRollPct = _clampRuneRollPct(effectRollPct);
  } else {
    effectRollPct = 0;
  }
  return {
    uid: _allocFormationUid(formation),
    item_id: intVal(item?.id, 0),
    name: String(item?.name || (itemType === ARRAY_PLATE_TYPE ? '阵盘' : '阵纹')),
    quality,
    item_type: itemType,
    shape_id: shapeId,
    shape_name: shapeName,
    flow_supply: intVal(item?.array_flow_supply, 0),
    slot,
    arrow_dirs: arrowDirs,
    rotation: 0,
    effect_id: effectId,
    effect: effectName,
    effect_desc: effectDesc,
    effect_randomized: effectRandomized,
    flow_cost: flowCost,
    main_trigger_value: triggerValue,
    effect_roll_pct: effectRollPct,
    plate_affixes: plateAffixes,
    created_at: intVal(nowSec, 0)
  };
}

function _pushPieceToPool(formation, piece) {
  if (!piece || typeof piece !== 'object') return;
  if (piece.item_type === ARRAY_PLATE_TYPE) formation.plate_pool.push(piece);
  else if (piece.item_type === ARRAY_RUNE_TYPE) formation.rune_pool.push(piece);
}

function _removePieceFromPool(pool, uid) {
  if (!Array.isArray(pool) || !uid) return null;
  const idx = pool.findIndex(p => p && String(p.uid || '') === uid);
  if (idx < 0) return null;
  return pool.splice(idx, 1)[0] || null;
}

function _pullPieceFromPools(formation, uid) {
  const fromPlate = _removePieceFromPool(formation.plate_pool, uid);
  if (fromPlate) return fromPlate;
  return _removePieceFromPool(formation.rune_pool, uid);
}

function _resolveBoardPieceAt(formation, index, { ignoreUid = '' } = {}) {
  const idx = intVal(index, -1);
  if (idx < 0 || idx >= FORMATION_BOARD_CELLS) return null;
  const direct = formation.board[idx];
  const ignore = String(ignoreUid || '').trim();
  if (direct && typeof direct === 'object') {
    const uid = String(direct.uid || '').trim();
    if (!ignore || uid !== ignore) return { piece: direct, anchor_index: idx };
  }
  for (let i = 0; i < FORMATION_BOARD_CELLS; i += 1) {
    const root = formation.board[i];
    if (!root || typeof root !== 'object') continue;
    if (_normalizeArrayPieceType(root.item_type) !== ARRAY_PLATE_TYPE) continue;
    const uid = String(root.uid || '').trim();
    if (ignore && uid === ignore) continue;
    const occupied = _calcPieceOccupiedIndexes(root, i, FORMATION_BOARD_SIZE);
    if (occupied.includes(idx)) return { piece: root, anchor_index: i };
  }
  return null;
}

function addFormationItems(player, item, count = 1, nowSec = Math.floor(Date.now() / 1000)) {
  const formation = ensureCaveFormationState(player);
  const itemType = _normalizeArrayPieceType(item?.type);
  if (!itemType) return { ok: false, added: 0, error: '非阵法部件' };
  const total = Math.max(1, intVal(count, 1));
  let added = 0;
  for (let i = 0; i < total; i += 1) {
    const piece = _buildFormationPieceFromItem(formation, item, nowSec);
    if (!piece) break;
    _pushPieceToPool(formation, piece);
    added += 1;
  }
  return { ok: added > 0, added, item_type: itemType, formation };
}

function placeFormationPiece(player, pieceUid, targetIndex) {
  const formation = ensureCaveFormationState(player);
  const uid = String(pieceUid || '').trim();
  const idx = intVal(targetIndex, -1);
  if (!uid) return { ok: false, error: '部件参数无效' };
  if (idx < 0 || idx >= FORMATION_BOARD_CELLS) return { ok: false, error: '阵图坐标无效' };
  const piece = _pullPieceFromPools(formation, uid);
  if (!piece) return { ok: false, error: '未找到对应部件' };
  const anchorIdx = _resolveAnchorIndexForDisplay(piece, idx, FORMATION_BOARD_SIZE);
  if (anchorIdx < 0 || anchorIdx >= FORMATION_BOARD_CELLS) {
    _pushPieceToPool(formation, piece);
    return { ok: false, error: '目标区域超出阵图范围' };
  }
  const occupied = _calcPieceOccupiedIndexes(piece, anchorIdx, FORMATION_BOARD_SIZE);
  if (occupied.length <= 0) {
    _pushPieceToPool(formation, piece);
    return { ok: false, error: '目标区域超出阵图范围' };
  }
  for (const oi of occupied) {
    const existing = _resolveBoardPieceAt(formation, oi);
    if (existing) {
      _pushPieceToPool(formation, piece);
      return { ok: false, error: '目标区域已被占用' };
    }
  }
  formation.board[anchorIdx] = piece;
  return { ok: true, formation };
}

function pickFormationPiece(player, sourceIndex) {
  const formation = ensureCaveFormationState(player);
  const idx = intVal(sourceIndex, -1);
  if (idx < 0 || idx >= FORMATION_BOARD_CELLS) return { ok: false, error: '阵图坐标无效' };
  const found = _resolveBoardPieceAt(formation, idx);
  if (!found || !found.piece) return { ok: false, error: '该格没有部件' };
  formation.board[found.anchor_index] = null;
  const piece = found.piece;
  _pushPieceToPool(formation, piece);
  return { ok: true, formation, piece };
}

function moveFormationPiece(player, fromIndex, toIndex) {
  const formation = ensureCaveFormationState(player);
  const from = intVal(fromIndex, -1);
  const to = intVal(toIndex, -1);
  if (from < 0 || from >= FORMATION_BOARD_CELLS || to < 0 || to >= FORMATION_BOARD_CELLS) {
    return { ok: false, error: '阵图坐标无效' };
  }
  const fromResolved = _resolveBoardPieceAt(formation, from);
  if (!fromResolved || !fromResolved.piece) return { ok: false, error: '起始格没有部件' };
  const toAnchor = _resolveAnchorIndexForDisplay(fromResolved.piece, to, FORMATION_BOARD_SIZE);
  if (toAnchor < 0 || toAnchor >= FORMATION_BOARD_CELLS) return { ok: false, error: '目标区域超出阵图范围' };
  if (fromResolved.anchor_index === toAnchor) return { ok: true, formation, swapped: false };

  const occupied = _calcPieceOccupiedIndexes(fromResolved.piece, toAnchor, FORMATION_BOARD_SIZE);
  if (occupied.length <= 0) return { ok: false, error: '目标区域超出阵图范围' };
  const uid = String(fromResolved.piece.uid || '').trim();
  for (const oi of occupied) {
    const existing = _resolveBoardPieceAt(formation, oi, { ignoreUid: uid });
    if (existing) return { ok: false, error: '目标区域已被占用' };
  }

  formation.board[fromResolved.anchor_index] = null;
  formation.board[toAnchor] = fromResolved.piece;
  return { ok: true, formation, swapped: false };
}

function rotateFormationPiece(player, sourceIndex, turns = 1) {
  const formation = ensureCaveFormationState(player);
  const boardSize = Math.max(1, Math.min(9, intVal(formation.board_size, FORMATION_BOARD_SIZE)));
  const totalCells = boardSize * boardSize;
  const idx = intVal(sourceIndex, -1);
  if (idx < 0 || idx >= totalCells) return { ok: false, error: '\u9635\u56fe\u5750\u6807\u65e0\u6548' };

  const found = _resolveBoardPieceAt(formation, idx);
  if (!found || !found.piece) return { ok: false, error: '\u8be5\u683c\u6ca1\u6709\u90e8\u4ef6' };

  const piece = found.piece;
  const uid = String(piece.uid || '').trim();
  if (!uid) return { ok: false, error: '\u90e8\u4ef6\u53c2\u6570\u65e0\u6548' };

  const pieceType = _normalizeArrayPieceType(piece.item_type);
  if (pieceType !== ARRAY_PLATE_TYPE) {
    return { ok: false, error: '\u9635\u7eb9\u4e0d\u53ef\u65cb\u8f6c' };
  }

  const step = _normalizeRotation(turns || 1);
  if (step === 0) return { ok: true, formation, rotation: _normalizeRotation(piece.rotation || 0) };

  const oldRot = _normalizeRotation(piece.rotation || 0);
  const oldDirs = _normalizeArrowDirs(piece.arrow_dirs);
  piece.rotation = _normalizeRotation(oldRot + step);
  piece.arrow_dirs = _rotateArrowDirs(oldDirs, step);

  const toAnchor = _resolveAnchorIndexForDisplay(piece, idx, boardSize);
  if (toAnchor < 0 || toAnchor >= totalCells) {
    piece.rotation = oldRot;
    piece.arrow_dirs = oldDirs;
    return { ok: false, error: '\u65cb\u8f6c\u540e\u8d85\u51fa\u9635\u56fe\u8303\u56f4' };
  }

  const occupied = _calcPieceOccupiedIndexes(piece, toAnchor, boardSize);
  if (occupied.length <= 0) {
    piece.rotation = oldRot;
    piece.arrow_dirs = oldDirs;
    return { ok: false, error: '\u65cb\u8f6c\u540e\u8d85\u51fa\u9635\u56fe\u8303\u56f4' };
  }

  for (const oi of occupied) {
    const existing = _resolveBoardPieceAt(formation, oi, { ignoreUid: uid });
    if (existing) {
      piece.rotation = oldRot;
      piece.arrow_dirs = oldDirs;
      return { ok: false, error: '\u65cb\u8f6c\u540e\u533a\u57df\u88ab\u5360\u7528' };
    }
  }

  if (toAnchor !== found.anchor_index) {
    formation.board[found.anchor_index] = null;
    formation.board[toAnchor] = piece;
  }

  return { ok: true, formation, rotation: _normalizeRotation(piece.rotation || 0) };
}

function clearFormationBoard(player) {
  const formation = ensureCaveFormationState(player);
  const moved = [];
  for (let i = 0; i < FORMATION_BOARD_CELLS; i += 1) {
    const piece = formation.board[i];
    if (!piece || typeof piece !== 'object') continue;
    formation.board[i] = null;
    moved.push(piece);
  }
  for (const piece of moved) _pushPieceToPool(formation, piece);
  return { ok: true, formation, moved_count: moved.length };
}

function _pickRuneDecomposeRewardItem() {
  const ids = Array.isArray(RUNE_DECOMPOSE_TIER1_REWARD_IDS)
    ? RUNE_DECOMPOSE_TIER1_REWARD_IDS
    : [];
  if (ids.length <= 0) return null;
  const itemId = ids[Math.floor(Math.random() * ids.length)];
  const item = getItemById(itemId);
  if (!item || !item.id) return null;
  return item;
}

function _pickPlateDecomposeRewardItem() {
  const ids = Array.isArray(PLATE_DECOMPOSE_TIER2_REWARD_IDS)
    ? PLATE_DECOMPOSE_TIER2_REWARD_IDS
    : [];
  if (ids.length <= 0) return null;
  const itemId = ids[Math.floor(Math.random() * ids.length)];
  const item = getItemById(itemId);
  if (!item || !item.id) return null;
  return item;
}

function _removeRuneByUid(formation, uid) {
  const fromPool = _removePieceFromPool(formation.rune_pool, uid);
  if (fromPool) return { piece: fromPool, source: 'rune_pool', index: -1 };
  for (let i = 0; i < FORMATION_BOARD_CELLS; i += 1) {
    const piece = formation.board[i];
    if (!piece || typeof piece !== 'object') continue;
    if (_normalizeArrayPieceType(piece.item_type) !== ARRAY_RUNE_TYPE) continue;
    if (String(piece.uid || '') !== uid) continue;
    formation.board[i] = null;
    return { piece, source: 'board', index: i };
  }
  return null;
}

function _removePlateByUid(formation, uid) {
  const fromPool = _removePieceFromPool(formation.plate_pool, uid);
  if (fromPool) return { piece: fromPool, source: 'plate_pool', index: -1 };
  for (let i = 0; i < FORMATION_BOARD_CELLS; i += 1) {
    const piece = formation.board[i];
    if (!piece || typeof piece !== 'object') continue;
    if (_normalizeArrayPieceType(piece.item_type) !== ARRAY_PLATE_TYPE) continue;
    if (String(piece.uid || '') !== uid) continue;
    formation.board[i] = null;
    return { piece, source: 'board', index: i };
  }
  return null;
}

function decomposeFormationRune(player, pieceUid) {
  const formation = ensureCaveFormationState(player);
  const uid = String(pieceUid || '').trim();
  if (!uid) return { ok: false, error: '阵纹参数无效' };

  const removed = _removeRuneByUid(formation, uid);
  if (!removed || !removed.piece) return { ok: false, error: '未找到该阵纹' };

  const rewardItem = _pickRuneDecomposeRewardItem();
  if (!rewardItem) {
    if (removed.source === 'rune_pool') formation.rune_pool.push(removed.piece);
    else if (removed.source === 'board' && removed.index >= 0 && removed.index < FORMATION_BOARD_CELLS) formation.board[removed.index] = removed.piece;
    return { ok: false, error: '分解奖励池异常' };
  }

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const placed = ops.putItemInInventory(player.inventory, clone(rewardItem), 1);
  if (!placed) {
    if (removed.source === 'rune_pool') formation.rune_pool.push(removed.piece);
    else if (removed.source === 'board' && removed.index >= 0 && removed.index < FORMATION_BOARD_CELLS) formation.board[removed.index] = removed.piece;
    return { ok: false, error: '背包已满，无法分解' };
  }

  return {
    ok: true,
    formation,
    reward: {
      item_id: intVal(rewardItem.id, 0),
      item_name: String(rewardItem.name || '一阶材料'),
      count: 1,
      tier: Math.max(1, intVal(rewardItem.quality, 1))
    }
  };
}

function decomposeFormationPlate(player, pieceUid) {
  const formation = ensureCaveFormationState(player);
  const uid = String(pieceUid || '').trim();
  if (!uid) return { ok: false, error: '阵盘参数无效' };

  const removed = _removePlateByUid(formation, uid);
  if (!removed || !removed.piece) return { ok: false, error: '未找到该阵盘' };

  const rewardItem = _pickPlateDecomposeRewardItem();
  if (!rewardItem) {
    if (removed.source === 'plate_pool') formation.plate_pool.push(removed.piece);
    else if (removed.source === 'board' && removed.index >= 0 && removed.index < FORMATION_BOARD_CELLS) formation.board[removed.index] = removed.piece;
    return { ok: false, error: '分解奖励池异常' };
  }

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const placed = ops.putItemInInventory(player.inventory, clone(rewardItem), 1);
  if (!placed) {
    if (removed.source === 'plate_pool') formation.plate_pool.push(removed.piece);
    else if (removed.source === 'board' && removed.index >= 0 && removed.index < FORMATION_BOARD_CELLS) formation.board[removed.index] = removed.piece;
    return { ok: false, error: '背包已满，无法分解' };
  }

  return {
    ok: true,
    formation,
    reward: {
      item_id: intVal(rewardItem.id, 0),
      item_name: String(rewardItem.name || '二阶材料'),
      count: 1,
      tier: Math.max(1, intVal(rewardItem.quality, 2))
    }
  };
}

function _normalizeMainPlateSystemConfig(rawCfg) {
  const cfg = rawCfg && typeof rawCfg === 'object' ? rawCfg : {};
  const enabled = cfg.enabled !== false;
  const requireConnectedRune = cfg.require_connected_rune !== false;
  const settleRaw = cfg.settlement && typeof cfg.settlement === 'object' ? cfg.settlement : {};
  const attenuation = [];
  for (const v of (Array.isArray(settleRaw.attenuation_multipliers) ? settleRaw.attenuation_multipliers : [])) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    attenuation.push(n);
  }
  if (attenuation.length <= 0) attenuation.push(1);
  const outSkills = [];

  for (const skillRaw of (Array.isArray(cfg.main_skills) ? cfg.main_skills : [])) {
    if (!skillRaw || typeof skillRaw !== 'object') continue;
    const skillId = String(skillRaw.skill_id || '').trim();
    if (!skillId) continue;

    const requires = [];
    for (const reqRaw of (Array.isArray(skillRaw.trigger_requires) ? skillRaw.trigger_requires : [])) {
      if (!reqRaw || typeof reqRaw !== 'object') continue;
      const effectId = String(reqRaw.effect_id || '').trim();
      const count = Math.max(1, intVal(reqRaw.count, 0));
      if (!effectId || count <= 0) continue;
      requires.push({ effect_id: effectId, count });
    }
    if (requires.length <= 0) continue;

    const bonuses = [];
    for (const bonusRaw of (Array.isArray(skillRaw.plate_bonus) ? skillRaw.plate_bonus : [])) {
      if (!bonusRaw || typeof bonusRaw !== 'object') continue;
      const bonusId = String(bonusRaw.bonus_id || '').trim();
      const type = String(bonusRaw.type || '').trim();
      if (!bonusId || !type) continue;
      const targetEffectId = String(bonusRaw.target_effect_id || '').trim();
      const valuePct = Number(bonusRaw.value_pct || 0);
      bonuses.push({
        bonus_id: bonusId,
        type,
        target_effect_id: targetEffectId,
        value_pct: Number.isFinite(valuePct) ? valuePct : 0
      });
    }

    outSkills.push({
      skill_id: skillId,
      name: String(skillRaw.name || skillId),
      desc: String(skillRaw.desc || ''),
      trigger_requires: requires,
      reward_base: Math.max(0, intVal(skillRaw.reward?.spirit_stone_base, 0)),
      plate_bonus: bonuses
    });
  }

  return {
    enabled,
    require_connected_rune: requireConnectedRune,
    main_skills: outSkills,
    settlement: {
      mode: String(settleRaw.mode || 'per_minute_tick'),
      base_interval_sec: Math.max(1, intVal(settleRaw.base_interval_sec, 60)),
      daily_trigger_cap_per_account: Math.max(0, intVal(settleRaw.daily_trigger_cap_per_account, 12)),
      daily_spirit_cap_per_account: Math.max(0, intVal(settleRaw.daily_spirit_cap_per_account, 420)),
      attenuation_multipliers: attenuation
    }
  };
}

function _formatMainSkillDisplayName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '阵形·未命名';
  if (raw.startsWith('阵形·')) return raw;
  return `阵形·${raw}`;
}

function _buildFormationRuntime(formation) {
  const boardSize = Math.max(1, Math.min(9, intVal(formation.board_size, FORMATION_BOARD_SIZE)));
  const cellCount = boardSize * boardSize;
  const board = Array.isArray(formation.board) ? formation.board : [];
  const runeCfg = getArrayRunes();
  const effectNameById = new Map();
  for (const effectRaw of (Array.isArray(runeCfg?.effects) ? runeCfg.effects : [])) {
    if (!effectRaw || typeof effectRaw !== 'object') continue;
    const effectId = String(effectRaw.effect_id || '').trim();
    if (!effectId) continue;
    effectNameById.set(effectId, String(effectRaw.name || effectId));
  }
  const mainSystem = _normalizeMainPlateSystemConfig(runeCfg?.main_plate_system);

  const plateByIndex = new Map();
  const allPlates = [];
  const allRunes = [];

  for (let idx = 0; idx < cellCount; idx += 1) {
    const piece = board[idx];
    if (!piece || typeof piece !== 'object') continue;
    if (piece.item_type === ARRAY_PLATE_TYPE) {
      const rolledBonus = _sanitizePlateAffixList(piece.plate_affixes, {
        autoRollShapeId: String(piece.shape_id || '')
      }).map((bonus) => ({
        bonus_id: String(bonus.bonus_id || bonus.affix_id || ''),
        name: String(bonus.name || bonus.bonus_id || '阵盘词条'),
        type: String(bonus.type || ''),
        target_effect_id: String(bonus.target_effect_id || ''),
        target_effect_name: effectNameById.get(String(bonus.target_effect_id || '')) || String(bonus.target_effect_id || ''),
        value_pct: Math.max(0, numVal(bonus.value_pct, 0)),
        source: String(bonus.source || 'plate_roll')
      })).filter((bonus) => !!bonus.bonus_id && bonus.value_pct > 0);

      const p = {
        uid: String(piece.uid || ''),
        board_index: idx,
        plate_affixes: rolledBonus,
        flow_supply: Math.max(0, intVal(piece.flow_supply, 0))
      };
      allPlates.push(p);
      const occupied = _calcPieceOccupiedIndexes(piece, idx, boardSize);
      p.occupied_indexes = occupied.length > 0 ? occupied : [idx];
      if (p.uid) {
        for (const oi of p.occupied_indexes) {
          if (!plateByIndex.has(oi)) plateByIndex.set(oi, p);
        }
      }
    } else if (piece.item_type === ARRAY_RUNE_TYPE) {
      allRunes.push({
        uid: String(piece.uid || ''),
        board_index: idx,
        effect_id: String(piece.effect_id || '').trim(),
        arrow_dirs: _rotateArrowDirs(piece.arrow_dirs, _normalizeRotation(piece.rotation || 0)),
        flow_cost: Math.max(0, intVal(piece.flow_cost, 0)),
        main_trigger_value: Math.max(1, intVal(piece.main_trigger_value, 1)),
        effect_roll_pct: _clampRuneRollPct(piece.effect_roll_pct)
      });
    }
  }

  const plateState = new Map();
  for (const p of allPlates) {
    const rolledPlateBonus = Array.isArray(p.plate_affixes)
      ? p.plate_affixes.map((b) => ({ ...b }))
      : [];
    plateState.set(p.uid, {
      uid: p.uid,
      board_index: p.board_index,
      occupied_indexes: Array.isArray(p.occupied_indexes) ? p.occupied_indexes.slice() : [p.board_index],
      connected_rune_uids: [],
      pointed_rune_uids: [],
      main_trigger_value: 0,
      pointed_effect_counts: Object.create(null),
      active_main_skills: [],
      main_reward_base: 0,
      flow_supply: Math.max(0, intVal(p.flow_supply, 0)),
      rolled_plate_bonus: rolledPlateBonus,
      main_skill_plate_bonus: [],
      active_plate_bonus: rolledPlateBonus
    });
  }

  const runeRuntime = [];
  for (const rune of allRunes) {
    const connectedPlateUids = [];
    const connectedSet = new Set();
    const pointedPlateUids = [];
    const pointedSet = new Set();

    for (const dir of CARDINAL_DIRS) {
      const neighborIdx = _neighborIndex(rune.board_index, dir, boardSize);
      if (neighborIdx < 0) continue;
      const plate = plateByIndex.get(neighborIdx);
      if (!plate || !plate.uid || connectedSet.has(plate.uid)) continue;
      connectedSet.add(plate.uid);
      connectedPlateUids.push(plate.uid);
      const pState = plateState.get(plate.uid);
      if (pState && !pState.connected_rune_uids.includes(rune.uid)) pState.connected_rune_uids.push(rune.uid);
    }

    const isConnected = connectedPlateUids.length > 0;
    const shouldCountForMain = !mainSystem.require_connected_rune || isConnected;

    for (const dir of rune.arrow_dirs) {
      const neighborIdx = _neighborIndex(rune.board_index, dir, boardSize);
      if (neighborIdx < 0) continue;
      const plate = plateByIndex.get(neighborIdx);
      if (!plate || !plate.uid || pointedSet.has(plate.uid)) continue;
      pointedSet.add(plate.uid);
      pointedPlateUids.push(plate.uid);
      const pState = plateState.get(plate.uid);
      if (pState) {
        pState.main_trigger_value += rune.main_trigger_value;
        if (mainSystem.enabled && shouldCountForMain && rune.effect_id) {
          pState.pointed_effect_counts[rune.effect_id] = intVal(pState.pointed_effect_counts[rune.effect_id], 0) + 1;
        }
        if (!pState.pointed_rune_uids.includes(rune.uid)) pState.pointed_rune_uids.push(rune.uid);
      }
    }

    runeRuntime.push({
      uid: rune.uid,
      board_index: rune.board_index,
      effect_id: rune.effect_id,
      effect_name: effectNameById.get(rune.effect_id) || rune.effect_id || '',
      connected_plate_uids: connectedPlateUids,
      pointed_plate_uids: pointedPlateUids,
      linked_plate_count: connectedPlateUids.length,
      pointed_plate_count: pointedPlateUids.length,
      is_connected: isConnected,
      flow_cost: Math.max(0, intVal(rune.flow_cost, 0)),
      main_trigger_value: rune.main_trigger_value,
      effect_roll_pct: rune.effect_roll_pct
    });
  }

  // 流量预算：总耗流超过总导流时，阵纹效果按比例衰减。
  const totalFlowSupply = Array.from(plateState.values())
    .reduce((sum, p) => sum + Math.max(0, intVal(p.flow_supply, 0)), 0);
  const totalFlowCost = runeRuntime
    .reduce((sum, r) => sum + (r.is_connected ? Math.max(0, intVal(r.flow_cost, 0)) : 0), 0);
  const flowEfficiencyRatio = totalFlowCost > 0
    ? Math.max(0, Math.min(1, totalFlowSupply / Math.max(1, totalFlowCost)))
    : 1;
  const flowEfficiencyPct = Math.round(flowEfficiencyRatio * 10000) / 100;
  const flowOverloadRatio = totalFlowCost > totalFlowSupply
    ? Math.max(0, Math.min(1, 1 - flowEfficiencyRatio))
    : 0;

  if (mainSystem.enabled && mainSystem.main_skills.length > 0) {
    const runeByUid = new Map();
    for (const r of runeRuntime) {
      const uid = String(r?.uid || '');
      if (!uid) continue;
      runeByUid.set(uid, r);
    }
    for (const pState of plateState.values()) {
      const activeMainSkills = [];
      let rewardBase = 0;
      let availableRuneUids = Array.isArray(pState.pointed_rune_uids)
        ? pState.pointed_rune_uids.slice()
        : [];
      if (mainSystem.require_connected_rune) {
        availableRuneUids = availableRuneUids.filter((uid) => {
          const rr = runeByUid.get(String(uid || ''));
          return !!rr && rr.is_connected === true;
        });
      }
      for (const skill of mainSystem.main_skills) {
        const reqMap = new Map();
        for (const req of (Array.isArray(skill.trigger_requires) ? skill.trigger_requires : [])) {
          const effectId = String(req?.effect_id || '').trim();
          const need = Math.max(0, intVal(req?.count, 0));
          if (!effectId || need <= 0) continue;
          reqMap.set(effectId, need);
        }
        if (reqMap.size <= 0) continue;

        const poolByEffect = new Map();
        for (const uid of availableRuneUids) {
          const rr = runeByUid.get(String(uid || ''));
          if (!rr) continue;
          const eid = String(rr.effect_id || '').trim();
          if (!reqMap.has(eid)) continue;
          if (!poolByEffect.has(eid)) poolByEffect.set(eid, []);
          poolByEffect.get(eid).push(uid);
        }

        let matched = true;
        const consume = [];
        for (const [effectId, need] of reqMap.entries()) {
          const bucket = Array.isArray(poolByEffect.get(effectId)) ? poolByEffect.get(effectId) : [];
          const have = bucket.length;
          // 严格等于：要求数量必须与配置完全一致
          if (have !== need) {
            matched = false;
            break;
          }
          consume.push(...bucket.slice(0, need));
        }
        if (!matched) continue;

        activeMainSkills.push({
          skill_id: skill.skill_id,
          instance_key: `${String(skill.skill_id || '').trim()}@${String(pState.uid || '').trim()}`,
          plate_uid: String(pState.uid || '').trim(),
          name: _formatMainSkillDisplayName(skill.name),
          desc: skill.desc,
          reward_base: skill.reward_base
        });
        rewardBase += skill.reward_base;

        // 每块阵盘仅触发一个阵形；已计数阵纹不再参与后续阵形
        const consumeSet = new Set(consume.map((u) => String(u || '')));
        availableRuneUids = availableRuneUids.filter((u) => !consumeSet.has(String(u || '')));
        break;
      }

      pState.active_main_skills = activeMainSkills;
      pState.main_reward_base = rewardBase;
      pState.main_skill_plate_bonus = [];
      pState.active_plate_bonus = Array.isArray(pState.rolled_plate_bonus)
        ? pState.rolled_plate_bonus.map((b) => ({ ...b }))
        : [];
    }
  }

  const plateRuntime = Array.from(plateState.values()).map((p) => ({
    uid: p.uid,
    board_index: p.board_index,
    anchor_index: p.board_index,
    occupied_indexes: Array.isArray(p.occupied_indexes) ? p.occupied_indexes.slice() : [p.board_index],
    flow_supply: Math.max(0, intVal(p.flow_supply, 0)),
    connected_rune_uids: p.connected_rune_uids,
    pointed_rune_uids: p.pointed_rune_uids,
    connected_rune_count: p.connected_rune_uids.length,
    pointed_rune_count: p.pointed_rune_uids.length,
    main_trigger_value: p.main_trigger_value,
    pointed_effect_counts: Object.assign({}, p.pointed_effect_counts),
    active_main_skills: p.active_main_skills,
    main_reward_base: p.main_reward_base,
    rolled_plate_bonus: p.rolled_plate_bonus,
    main_skill_plate_bonus: p.main_skill_plate_bonus,
    active_plate_bonus: p.active_plate_bonus
  }));

  const disconnectedCount = runeRuntime.reduce((sum, r) => sum + (r.is_connected ? 0 : 1), 0);
  const totalTriggerValue = plateRuntime.reduce((sum, p) => sum + Math.max(0, intVal(p.main_trigger_value, 0)), 0);
  const activeMainSkillPlates = plateRuntime.reduce((sum, p) => sum + ((Array.isArray(p.active_main_skills) && p.active_main_skills.length > 0) ? 1 : 0), 0);
  const activeMainSkillCount = plateRuntime.reduce((sum, p) => sum + (Array.isArray(p.active_main_skills) ? p.active_main_skills.length : 0), 0);
  const totalMainRewardBase = plateRuntime.reduce((sum, p) => sum + Math.max(0, intVal(p.main_reward_base, 0)), 0);
  return {
    link_rule: 'adjacent-plate-connect',
    plate_arrows_enabled: false,
    runes: runeRuntime,
    plates: plateRuntime,
    summary: {
      total_runes: runeRuntime.length,
      connected_runes: runeRuntime.length - disconnectedCount,
      disconnected_runes: disconnectedCount,
      total_flow_supply: totalFlowSupply,
      total_flow_cost: totalFlowCost,
      flow_efficiency_ratio: flowEfficiencyRatio,
      flow_efficiency_pct: flowEfficiencyPct,
      flow_overload_ratio: flowOverloadRatio,
      total_trigger_value: totalTriggerValue,
      main_system_enabled: mainSystem.enabled,
      active_main_skill_plates: activeMainSkillPlates,
      active_main_skill_count: activeMainSkillCount,
      total_main_reward_base: totalMainRewardBase
    }
  };
}

function _createEmptyFormationCombatBonus() {
  return {
    attribute_pct: {
      strength: 0,
      constitution: 0,
      bone: 0,
      agility: 0,
      zhenyuan: 0,
      lingli: 0
    },
    phys_crit_rate_pct: 0,
    spell_crit_rate_pct: 0,
    turn_end_mp_pct_of_max_mp: 0,
    balance_lowest_attr_pct: 0,
    abaddon_rebirth_once: false
  };
}

function _calcRunePlateAmpPct(rune, plateByUid) {
  let ampPct = 0;
  const pointed = Array.isArray(rune?.pointed_plate_uids) ? rune.pointed_plate_uids : [];
  const effectId = String(rune?.effect_id || '').trim();
  for (const plateUidRaw of pointed) {
    const plateUid = String(plateUidRaw || '');
    if (!plateUid) continue;
    const plate = plateByUid.get(plateUid);
    if (!plate) continue;
    for (const bonus of (Array.isArray(plate.active_plate_bonus) ? plate.active_plate_bonus : [])) {
      if (!bonus || typeof bonus !== 'object') continue;
      const type = String(bonus.type || '').trim();
      const valuePct = Math.max(0, numVal(bonus.value_pct, 0));
      if (valuePct <= 0) continue;
      if (type === 'pointed_all_effect_amp_pct') {
        ampPct += valuePct;
      } else if (type === 'pointed_effect_amp_pct') {
        const target = String(bonus.target_effect_id || '').trim();
        if (target && target === effectId) ampPct += valuePct;
      }
    }
  }
  return ampPct;
}

function _collectRuntimeMainSkillInstances(runtime) {
  const map = new Map();
  const plates = Array.isArray(runtime?.plates) ? runtime.plates : [];
  for (const plate of plates) {
    const plateUid = String(plate?.uid || '').trim();
    if (!plateUid) continue;
    const skills = Array.isArray(plate?.active_main_skills) ? plate.active_main_skills : [];
    for (const sk of skills) {
      const sid = String(sk?.skill_id || '').trim();
      if (!sid) continue;
      const instanceKey = String(sk?.instance_key || `${sid}@${plateUid}`).trim();
      if (!instanceKey) continue;
      if (!map.has(sid)) map.set(sid, []);
      const list = map.get(sid);
      if (list.some((x) => String(x?.instance_key || '') === instanceKey)) continue;
      list.push({
        skill_id: sid,
        instance_key: instanceKey,
        plate_uid: plateUid,
        name: String(sk?.name || sid),
        desc: String(sk?.desc || '')
      });
    }
  }
  return map;
}

function _refreshServiceEntrySummary(entry) {
  const e = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
  const instances = e.instances && typeof e.instances === 'object' && !Array.isArray(e.instances)
    ? e.instances
    : {};
  const states = Object.values(instances);
  if (states.length <= 0) {
    e.active = false;
    e.started_at = 0;
    e.last_fee_at = 0;
    e.total_spent = 0;
    e.last_change_at = 0;
    e.instances = instances;
    return e;
  }
  e.active = states.some((s) => !!s.active);
  e.started_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.started_at, 0))), 0);
  e.last_fee_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.last_fee_at, 0))), 0);
  e.total_spent = states.reduce((acc, s) => acc + Math.max(0, intVal(s.total_spent, 0)), 0);
  e.last_change_at = states.reduce((acc, s) => Math.max(acc, Math.max(0, intVal(s.last_change_at, 0))), 0);
  e.instances = instances;
  return e;
}

function _getAscensionLevelAllowance(playerLevel) {
  const lv = Math.max(1, intVal(playerLevel, 1));
  if (lv < 250) return 10;
  if (lv < 280) return 8;
  if (lv < 310) return 6;
  if (lv < 340) return 4;
  if (lv < 370) return 3;
  if (lv < 400) return 2;
  return 1;
}

function settleMainFormationServices(player, nowSec = Math.floor(Date.now() / 1000), opts = {}) {
  const out = {
    changed: false,
    has_ascension: false,
    ascension_active: false,
    equip_level_allowance: 0,
    spirit_spent: 0,
    wild_exp_bonus_pct: 0,
    wild_drop_rate_mult: 1,
    combat_mana_burst_pct: 0,
    skill_multi_hit_count: 0,
    skill_multi_hit_damage_mul: 1,
    fachao_enabled: false,
    fachao_bone_floor: 1,
    shenguang_enabled: false,
    shenguang_spell_damage_ratio: 0.15,
    daoti_overheal_to_temp_shield: false,
    gaiwu_exp_gained: 0
  };
  if (!player || typeof player !== 'object') return out;

  const cave = ensureCaveState(player);
  const svcRoot = _ensureMainServiceState(cave);
  const formation = _ensureFormationStateInCave(cave);
  const runtime = _buildFormationRuntime(formation);
  const runtimeInstancesMap = _collectRuntimeMainSkillInstances(runtime);
  out.has_ascension = (runtimeInstancesMap.get(MAIN_SKILL_ASCENSION) || []).length > 0;

  const now = Math.max(0, intVal(nowSec, Math.floor(Date.now() / 1000)));
  let stones = Math.max(0, intVal(player.spirit_stones, 0));
  let gaiwuExpGained = 0;

  for (const [skillId, cfg] of Object.entries(MAIN_SERVICE_CONFIG)) {
    const serviceKey = String(cfg?.key || '');
    if (!serviceKey) continue;
    const entry = svcRoot[serviceKey] && typeof svcRoot[serviceKey] === 'object'
      ? svcRoot[serviceKey]
      : (svcRoot[serviceKey] = { instances: {} });
    if (!entry.instances || typeof entry.instances !== 'object' || Array.isArray(entry.instances)) {
      entry.instances = {};
    }
    const instances = entry.instances;
    const runtimeInstances = Array.isArray(runtimeInstancesMap.get(skillId)) ? runtimeInstancesMap.get(skillId) : [];
    const runtimeKeys = new Set(runtimeInstances.map((it) => String(it.instance_key || '').trim()).filter(Boolean));

    if (runtimeInstances.length > 0 && Object.keys(instances).length <= 0) {
      const hadLegacy = !!entry.active || intVal(entry.started_at, 0) > 0 || intVal(entry.last_fee_at, 0) > 0 || intVal(entry.total_spent, 0) > 0;
      if (hadLegacy) {
        const firstKey = String(runtimeInstances[0].instance_key || '').trim();
        if (firstKey) {
          instances[firstKey] = {
            active: !!entry.active,
            started_at: Math.max(0, intVal(entry.started_at, 0)),
            last_fee_at: Math.max(0, intVal(entry.last_fee_at, 0)),
            total_spent: Math.max(0, intVal(entry.total_spent, 0)),
            last_change_at: Math.max(0, intVal(entry.last_change_at, 0))
          };
          out.changed = true;
        }
      }
    }

    for (const oldKey of Object.keys(instances)) {
      if (runtimeKeys.has(oldKey)) continue;
      const oldSvc = instances[oldKey] || {};
      if (oldSvc.active || oldSvc.started_at > 0 || oldSvc.last_fee_at > 0) {
        out.changed = true;
      }
      delete instances[oldKey];
    }

    for (const inst of runtimeInstances) {
      const ik = String(inst.instance_key || '').trim();
      if (!ik) continue;
      if (!instances[ik] || typeof instances[ik] !== 'object' || Array.isArray(instances[ik])) {
        instances[ik] = { active: false, started_at: 0, last_fee_at: 0, total_spent: 0, last_change_at: 0 };
      }
      const svc = instances[ik];
      svc.active = !!svc.active;
      svc.started_at = Math.max(0, intVal(svc.started_at, 0));
      svc.last_fee_at = Math.max(0, intVal(svc.last_fee_at, 0));
      svc.total_spent = Math.max(0, intVal(svc.total_spent, 0));
      svc.last_change_at = Math.max(0, intVal(svc.last_change_at, 0));

      if (svc.active) {
        if (svc.last_fee_at <= 0) {
          svc.last_fee_at = now;
          out.changed = true;
        }
        let elapsed = now - Math.max(0, intVal(svc.last_fee_at, 0));
        const hourlyCost = Math.max(0, intVal(cfg.hourly_cost, 0));
        while (elapsed >= 3600 && svc.active) {
          if (stones >= hourlyCost) {
            stones -= hourlyCost;
            svc.last_fee_at += 3600;
            svc.total_spent = Math.max(0, intVal(svc.total_spent, 0)) + hourlyCost;
            svc.last_change_at = now;
            out.spirit_spent += hourlyCost;
            if (skillId === MAIN_SKILL_GAIWU && cfg.hourly_exp_gain_equal_cost) {
              const expGain = Math.max(0, intVal(hourlyCost, 0));
              if (expGain > 0) gaiwuExpGained += expGain;
            }
            out.changed = true;
            elapsed = now - Math.max(0, intVal(svc.last_fee_at, 0));
          } else {
            svc.active = false;
            svc.last_change_at = now;
            out.changed = true;
          }
        }
      }
    }
    _refreshServiceEntrySummary(entry);
  }

  if (out.spirit_spent > 0) {
    player.spirit_stones = stones;
  }
  if (gaiwuExpGained > 0) {
    player.exp = Math.max(0, intVal(player.exp, 0)) + gaiwuExpGained;
    out.gaiwu_exp_gained = gaiwuExpGained;
    out.changed = true;
  }

  let allowance = 0;
  let wildExpBonusPct = 0;
  let wildDropRateMult = 1;
  let combatManaBurstPct = 0;
  let skillMultiHitCount = 0;
  let skillMultiHitDamageMul = 1;
  let hasYanmianActive = false;
  let hasFachaoActive = false;
  let fachaoBoneFloor = 1;
  let hasShenguangActive = false;
  let shenguangSpellDamageRatio = 0.15;
  let hasDaotiActive = false;
  for (const [skillId, cfg] of Object.entries(MAIN_SERVICE_CONFIG)) {
    const serviceKey = String(cfg?.key || '');
    if (!serviceKey) continue;
    const entry = svcRoot[serviceKey] || {};
    const instances = entry.instances && typeof entry.instances === 'object' && !Array.isArray(entry.instances)
      ? entry.instances
      : {};
    const activeCount = Object.values(instances).reduce((acc, s) => acc + (s && s.active ? 1 : 0), 0);
    if (activeCount <= 0) continue;

    if (skillId === MAIN_SKILL_YANMIAN) {
      hasYanmianActive = true;
      continue;
    }
    if (skillId === MAIN_SKILL_FACHAO) {
      hasFachaoActive = true;
      fachaoBoneFloor = Math.max(1, intVal(cfg.battle_bone_floor, 1));
      continue;
    }
    if (skillId === MAIN_SKILL_SHENGUANG) {
      hasShenguangActive = true;
      shenguangSpellDamageRatio = Math.max(0, Math.min(1, numVal(cfg.spell_absolute_damage_ratio, 0.15)));
      continue;
    }
    if (skillId === MAIN_SKILL_DAOTI) {
      hasDaotiActive = true;
      continue;
    }
    if (skillId === MAIN_SKILL_GAIWU) {
      continue;
    }
    if (skillId === MAIN_SKILL_ABADDON) {
      continue;
    }

    const levelAllowance = skillId === MAIN_SKILL_ASCENSION
      ? _getAscensionLevelAllowance(player.level)
      : Math.max(0, intVal(cfg.equip_level_allowance, 0));
    allowance += Math.max(0, intVal(levelAllowance, 0)) * activeCount;
    wildExpBonusPct += Math.max(0, numVal(cfg.wild_exp_bonus_pct, 0)) * activeCount;
    for (let i = 0; i < activeCount; i += 1) {
      wildDropRateMult *= Math.max(0, numVal(cfg.wild_drop_rate_mult, 1));
    }
    combatManaBurstPct += Math.max(0, numVal(cfg.combat_mana_burst_pct, 0)) * activeCount;
  }

  if (hasYanmianActive) {
    const ycfg = MAIN_SERVICE_CONFIG[MAIN_SKILL_YANMIAN] || {};
    skillMultiHitCount = Math.max(skillMultiHitCount, Math.max(0, intVal(ycfg.skill_multi_hit_count, 0)));
    const hitMul = Math.max(0, numVal(ycfg.skill_multi_hit_damage_mul, 1));
    if (hitMul > 0 && hitMul < skillMultiHitDamageMul) skillMultiHitDamageMul = hitMul;
  }

  combatManaBurstPct = Math.max(0, Math.min(1, combatManaBurstPct));

  out.ascension_active = allowance > 0;
  out.equip_level_allowance = allowance;
  out.wild_exp_bonus_pct = wildExpBonusPct;
  out.wild_drop_rate_mult = wildDropRateMult;
  out.combat_mana_burst_pct = combatManaBurstPct;
  out.skill_multi_hit_count = skillMultiHitCount;
  out.skill_multi_hit_damage_mul = skillMultiHitDamageMul;
  out.fachao_enabled = hasFachaoActive;
  out.fachao_bone_floor = fachaoBoneFloor;
  out.shenguang_enabled = hasShenguangActive;
  out.shenguang_spell_damage_ratio = shenguangSpellDamageRatio;
  out.daoti_overheal_to_temp_shield = hasDaotiActive;
  if (Math.max(0, intVal(player._equip_level_allowance, 0)) !== allowance) {
    player._equip_level_allowance = allowance;
    out.changed = true;
  }
  const oldSvcEffects = player._formation_service_effects && typeof player._formation_service_effects === 'object'
    ? player._formation_service_effects
    : {};
  const newSvcEffects = {
    wild_exp_bonus_pct: wildExpBonusPct,
    wild_drop_rate_mult: wildDropRateMult,
    combat_mana_burst_pct: combatManaBurstPct,
    skill_multi_hit_count: skillMultiHitCount,
    skill_multi_hit_damage_mul: skillMultiHitDamageMul,
    yanmian_multi2: skillMultiHitCount >= 2,
    yanmian_hit_damage_mul: skillMultiHitDamageMul,
    fachao_enabled: hasFachaoActive,
    fachao_bone_floor: fachaoBoneFloor,
    shenguang_enabled: hasShenguangActive,
    shenguang_spell_damage_ratio: shenguangSpellDamageRatio,
    daoti_overheal_to_temp_shield: hasDaotiActive
  };
  if (
    numVal(oldSvcEffects.wild_exp_bonus_pct, 0) !== newSvcEffects.wild_exp_bonus_pct ||
    numVal(oldSvcEffects.wild_drop_rate_mult, 1) !== newSvcEffects.wild_drop_rate_mult ||
    numVal(oldSvcEffects.combat_mana_burst_pct, 0) !== newSvcEffects.combat_mana_burst_pct ||
    intVal(oldSvcEffects.skill_multi_hit_count, 0) !== newSvcEffects.skill_multi_hit_count ||
    numVal(oldSvcEffects.skill_multi_hit_damage_mul, 1) !== newSvcEffects.skill_multi_hit_damage_mul ||
    !!oldSvcEffects.yanmian_multi2 !== !!newSvcEffects.yanmian_multi2 ||
    numVal(oldSvcEffects.yanmian_hit_damage_mul, 1) !== numVal(newSvcEffects.yanmian_hit_damage_mul, 1) ||
    !!oldSvcEffects.fachao_enabled !== !!newSvcEffects.fachao_enabled ||
    intVal(oldSvcEffects.fachao_bone_floor, 1) !== intVal(newSvcEffects.fachao_bone_floor, 1) ||
    !!oldSvcEffects.shenguang_enabled !== !!newSvcEffects.shenguang_enabled ||
    numVal(oldSvcEffects.shenguang_spell_damage_ratio, 0.15) !== numVal(newSvcEffects.shenguang_spell_damage_ratio, 0.15) ||
    !!oldSvcEffects.daoti_overheal_to_temp_shield !== !!newSvcEffects.daoti_overheal_to_temp_shield
  ) {
    player._formation_service_effects = newSvcEffects;
    out.changed = true;
  }
  return out;
}

function setMainFormationServiceActive(player, skillId, active, nowSec = Math.floor(Date.now() / 1000), instanceKey = '') {
  if (!player || typeof player !== 'object') return { ok: false, error: '无角色' };
  const sid = String(skillId || '').trim();
  const cfg = MAIN_SERVICE_CONFIG[sid];
  if (!cfg) return { ok: false, error: '无效的主阵技能' };

  const cave = ensureCaveState(player);
  const formation = _ensureFormationStateInCave(cave);
  const runtime = _buildFormationRuntime(formation);
  const runtimeInstancesMap = _collectRuntimeMainSkillInstances(runtime);
  const candidates = Array.isArray(runtimeInstancesMap.get(sid)) ? runtimeInstancesMap.get(sid) : [];
  if (candidates.length <= 0) return { ok: false, error: '当前阵法未激活该主阵条件' };

  const reqInstanceKey = String(instanceKey || '').trim();
  let target = null;
  if (reqInstanceKey) {
    target = candidates.find((x) => String(x.instance_key || '') === reqInstanceKey) || null;
    if (!target) return { ok: false, error: '无效的主阵实例' };
  } else if (candidates.length === 1) {
    target = candidates[0];
  } else {
    const ordered = candidates.slice().sort((a, b) => intVal(a.anchor_index, 0) - intVal(b.anchor_index, 0));
    if (active) {
      target = ordered.find((x) => !x.active) || ordered[0] || null;
    } else {
      target = ordered.find((x) => !!x.active) || ordered[0] || null;
    }
    if (!target) return { ok: false, error: '存在多个同类主阵，请指定实例' };
  }

  const svcRoot = _ensureMainServiceState(cave);
  const serviceKey = String(cfg.key || '');
  const entry = svcRoot[serviceKey] && typeof svcRoot[serviceKey] === 'object'
    ? svcRoot[serviceKey]
    : (svcRoot[serviceKey] = { instances: {} });
  if (!entry.instances || typeof entry.instances !== 'object' || Array.isArray(entry.instances)) {
    entry.instances = {};
  }
  const targetKey = String(target.instance_key || '').trim();
  if (!entry.instances[targetKey] || typeof entry.instances[targetKey] !== 'object' || Array.isArray(entry.instances[targetKey])) {
    entry.instances[targetKey] = { active: false, started_at: 0, last_fee_at: 0, total_spent: 0, last_change_at: 0 };
  }
  const svc = entry.instances[targetKey];
  const now = Math.max(0, intVal(nowSec, Math.floor(Date.now() / 1000)));
  const targetActive = !!active;

  if (targetActive) {
    if (!svc.active) {
      const startCost = Math.max(0, intVal(cfg.start_cost, 0));
      const stones = Math.max(0, intVal(player.spirit_stones, 0));
      if (stones < startCost) return { ok: false, error: `灵石不足（需要${startCost}，当前${stones}）` };
      player.spirit_stones = stones - startCost;
      svc.active = true;
      svc.started_at = now;
      svc.last_fee_at = now;
      svc.total_spent = Math.max(0, intVal(svc.total_spent, 0)) + startCost;
      svc.last_change_at = now;
    }
  } else if (svc.active) {
    svc.active = false;
    svc.last_change_at = now;
  }

  settleMainFormationServices(player, now, { allowAutoActivate: false });
  return { ok: true, service_key: serviceKey, instance_key: targetKey, active: !!svc.active };
}

function getFormationEquipmentLevelAllowance(player) {
  if (!player || typeof player !== 'object') return 0;
  const cave = ensureCaveState(player);
  const svcRoot = _ensureMainServiceState(cave);
  const asc = svcRoot.yangsheng || {};
  const instances = asc.instances && typeof asc.instances === 'object' && !Array.isArray(asc.instances)
    ? asc.instances
    : {};
  const activeCount = Object.values(instances).reduce((acc, s) => acc + (s && s.active ? 1 : 0), 0);
  if (activeCount <= 0) return 0;
  return activeCount * _getAscensionLevelAllowance(player.level);
}

function getFormationWildBattleModifiers(player) {
  if (!player || typeof player !== 'object') {
    return { wild_exp_bonus_pct: 0, wild_drop_rate_mult: 1 };
  }
  const eff = player._formation_service_effects && typeof player._formation_service_effects === 'object'
    ? player._formation_service_effects
    : {};
  return {
    wild_exp_bonus_pct: Math.max(0, numVal(eff.wild_exp_bonus_pct, 0)),
    wild_drop_rate_mult: Math.max(0, numVal(eff.wild_drop_rate_mult, 1))
  };
}

function getFormationCombatBonus(player) {
  const out = _createEmptyFormationCombatBonus();
  if (!player || typeof player !== 'object') return out;

  const cave = ensureCaveState(player);
  const svcRoot = _ensureMainServiceState(cave);
  const formation = _ensureFormationStateInCave(cave);
  const runtime = _buildFormationRuntime(formation);
  const plates = Array.isArray(runtime?.plates) ? runtime.plates : [];
  let hasActiveMain = false;
  const abaddonSvc = svcRoot.abaddon || {};
  const abaddonInstances = abaddonSvc.instances && typeof abaddonSvc.instances === 'object' && !Array.isArray(abaddonSvc.instances)
    ? abaddonSvc.instances
    : {};
  const abaddonServiceActive = Object.values(abaddonInstances).some((s) => !!(s && s.active));
  for (const plate of plates) {
    const activeMainSkills = Array.isArray(plate?.active_main_skills) ? plate.active_main_skills : [];
    if (activeMainSkills.length > 0) hasActiveMain = true;
    for (const sk of activeMainSkills) {
      if (String(sk?.skill_id || '') === MAIN_SKILL_ABADDON && abaddonServiceActive) {
        out.abaddon_rebirth_once = true;
      }
    }
  }

  if (!hasActiveMain) return out;

  const runes = Array.isArray(runtime?.runes) ? runtime.runes : [];
  if (runes.length <= 0) return out;
  const flowEfficiencyRatio = Math.max(0, Math.min(1, numVal(runtime?.summary?.flow_efficiency_ratio, 1)));
  if (flowEfficiencyRatio <= 0) return out;

  const plateByUid = new Map();
  for (const plate of (Array.isArray(runtime?.plates) ? runtime.plates : [])) {
    const uid = String(plate?.uid || '');
    if (!uid) continue;
    plateByUid.set(uid, plate);
  }

  for (const rune of runes) {
    if (!rune || rune.is_connected !== true) continue;
    const effectId = String(rune.effect_id || '').trim();
    if (!effectId) continue;
    const rule = RUNE_COMBAT_RULES[effectId];
    if (!rule) continue;

    const linkedCount = Math.max(0, intVal(rune.linked_plate_count, 0));
    let effectPct = Math.max(0, numVal(rule.base_pct, 0) + linkedCount * numVal(rule.per_link_pct, 0));
    if (effectPct <= 0) continue;

    const plateAmpPct = _calcRunePlateAmpPct(rune, plateByUid);
    const rollPct = _clampRuneRollPct(rune.effect_roll_pct);
    const mult = (1 + plateAmpPct / 100) * (1 + rollPct / 100);
    effectPct *= mult * flowEfficiencyRatio;
    const ratio = Math.max(0, effectPct / 100);

    if (rule.kind === 'attr_pct' && rule.attr && out.attribute_pct.hasOwnProperty(rule.attr)) {
      out.attribute_pct[rule.attr] += ratio;
    } else if (rule.kind === 'phys_crit_rate_pct') {
      out.phys_crit_rate_pct += ratio;
    } else if (rule.kind === 'spell_crit_rate_pct') {
      out.spell_crit_rate_pct += ratio;
    } else if (rule.kind === 'turn_end_mp_pct_of_max_mp') {
      out.turn_end_mp_pct_of_max_mp += ratio;
    } else if (rule.kind === 'balance_lowest_attr_pct') {
      out.balance_lowest_attr_pct += ratio;
    }
  }

  return out;
}

function _getFormationView(formation) {
  const boardSize = Math.max(1, Math.min(9, intVal(formation.board_size, FORMATION_BOARD_SIZE)));
  return {
    board_size: boardSize,
    board: clone(Array.isArray(formation.board) ? formation.board : []),
    plate_pool: clone(Array.isArray(formation.plate_pool) ? formation.plate_pool : []),
    rune_pool: clone(Array.isArray(formation.rune_pool) ? formation.rune_pool : []),
    runtime: _buildFormationRuntime(formation)
  };
}

function getMidnightTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function tryResetRare(cave) {
  const midnight = getMidnightTs();
  if (cave.last_rare_reset < midnight) {
    cave.rare_remaining = getRareCap(cave.level);
    cave.rare_max = getRareCap(cave.level);
    cave.last_rare_reset = midnight;
    cave.today_log = [];
    cave.main_trigger_settle_count_today = 0;
    cave.main_spirit_today = 0;
  }
}

function rollTier() {
  const r = Math.random();
  if (r < 0.40) return 1;
  if (r < 0.70) return 2;
  if (r < 0.88) return 3;
  if (r < 0.97) return 4;
  return 5;
}

function rollMaterial(type) {
  const pool = type === 'field' ? FIELD_MATERIALS : MINE_MATERIALS;
  const tier = rollTier();
  const items = pool[tier];
  if (!items || items.length === 0) return null;
  const itemId = items[Math.floor(Math.random() * items.length)];
  const item = getItemById(itemId);
  if (!item || !item.id) return null;
  return { item, tier };
}

/**
 * 结算洞府采集（登录/sync 时调用）
 * 从 last_tick 到 now，每 60 秒一次判定
 * @returns {object} 结算报告 { ticks, drops: [{item_id, item_name, count}], rare_used }
 */
function settleCaveGathering(player, nowSec) {
  const cave = ensureCaveState(player);
  tryResetRare(cave);

  if (!cave.gathering) {
    _cleanupOrphanedCaveJob(player);
    return null;
  }

  if (cave.rare_remaining <= 0) {
    cave.gathering = null;
    player.cave = cave;
    _cleanupOrphanedCaveJob(player);
    return { ticks: 0, drops: [], rare_used: 0, rare_remaining: 0, auto_stopped: true };
  }

  const g = cave.gathering;
  const lastTick = intVal(g.last_tick, intVal(g.started_at, nowSec));
  const elapsed = Math.max(0, nowSec - lastTick);
  const ticks = Math.floor(elapsed / 60);
  if (ticks <= 0) return null;

  const formation = _ensureFormationStateInCave(cave);
  const runtime = _buildFormationRuntime(formation);
  const mainSystem = _normalizeMainPlateSystemConfig(getArrayRunes()?.main_plate_system);
  const mainSettle = mainSystem.settlement;
  const mainRewardBase = Math.max(0, intVal(runtime?.summary?.total_main_reward_base, 0));
  let mainSettleSecAccumulator = Math.max(0, intVal(g.main_settle_sec_accumulator, 0));

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);

  const chance = LEVEL_DROP_CHANCE[cave.level] || 0.15;
  const dropPerTick = LEVEL_DROP_COUNT[cave.level] || 1;
  const dropCounts = {};
  let rareUsed = 0;
  let actualTicks = 0;
  let mainTriggersSettled = 0;
  let mainSpiritGained = 0;

  for (let i = 0; i < ticks; i++) {
    if (cave.rare_remaining <= 0) break;
    actualTicks++;

    mainSettleSecAccumulator += 60;
    while (mainSettleSecAccumulator >= mainSettle.base_interval_sec) {
      mainSettleSecAccumulator -= mainSettle.base_interval_sec;
      if (!mainSystem.enabled || mainSettle.mode !== 'per_minute_tick') continue;
      if (mainRewardBase <= 0) continue;

      const settledToday = Math.max(0, intVal(cave.main_trigger_settle_count_today, 0));
      const spiritToday = Math.max(0, intVal(cave.main_spirit_today, 0));
      if (mainSettle.daily_trigger_cap_per_account > 0 && settledToday >= mainSettle.daily_trigger_cap_per_account) continue;
      if (mainSettle.daily_spirit_cap_per_account > 0 && spiritToday >= mainSettle.daily_spirit_cap_per_account) continue;

      const attenArr = mainSettle.attenuation_multipliers;
      const attenIdx = Math.max(0, Math.min(attenArr.length - 1, settledToday));
      const mult = Number(attenArr[attenIdx] || 0);
      if (!Number.isFinite(mult) || mult <= 0) {
        cave.main_trigger_settle_count_today = settledToday + 1;
        mainTriggersSettled += 1;
        continue;
      }

      let gain = Math.max(0, Math.floor(mainRewardBase * mult));
      if (mainSettle.daily_spirit_cap_per_account > 0) {
        const remain = Math.max(0, mainSettle.daily_spirit_cap_per_account - spiritToday);
        gain = Math.min(gain, remain);
      }

      cave.main_trigger_settle_count_today = settledToday + 1;
      mainTriggersSettled += 1;
      if (gain <= 0) continue;

      player.spirit_stones = Math.max(0, intVal(player.spirit_stones, 0)) + gain;
      cave.main_spirit_today = spiritToday + gain;
      mainSpiritGained += gain;
    }

    if (Math.random() >= chance) continue;

    for (let d = 0; d < dropPerTick; d++) {
      if (cave.rare_remaining <= 0) break;
      const result = rollMaterial(g.type);
      if (!result) continue;

      const itemQuality = intVal(result.item.quality, result.tier);
      const cost = RARE_COST[itemQuality] || RARE_COST[result.tier] || 5;
      if (cave.rare_remaining < cost) continue;

      const placed = ops.putItemInInventory(player.inventory, clone(result.item), 1);
      if (!placed) continue;

      cave.rare_remaining -= cost;
      rareUsed += cost;
      const key = String(result.item.id);
      if (dropCounts[key]) dropCounts[key].count += 1;
      else dropCounts[key] = { item_id: result.item.id, item_name: String(result.item.name || ''), count: 1 };

      const existing = cave.today_log.find(e => e.item_id === result.item.id);
      if (existing) existing.count += 1;
      else cave.today_log.push({ item_id: result.item.id, item_name: String(result.item.name || ''), tier: itemQuality, count: 1 });
    }
  }

  g.last_tick = lastTick + actualTicks * 60;
  g.main_settle_sec_accumulator = mainSettleSecAccumulator;
  cave.gathering = g;
  player.cave = cave;

  // 灵气耗尽 → 自动停止采集并释放百艺队列
  let autoStopped = false;
  if (cave.rare_remaining <= 0 && cave.gathering) {
    cave.gathering = null;
    player.cave = cave;
    player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
    const job = player.baiyi.pending_job;
    if (job && typeof job === 'object' && _isCaveJob(job)) {
      player.baiyi.pending_job = null;
      player.baiyi.is_crafting = false;
    }
    autoStopped = true;
  }

  const drops = Object.values(dropCounts).sort((a, b) => b.count - a.count);
  return {
    ticks: actualTicks,
    drops,
    rare_used: rareUsed,
    rare_remaining: cave.rare_remaining,
    auto_stopped: autoStopped,
    main_reward_base: mainRewardBase,
    main_triggers_settled: mainTriggersSettled,
    main_spirit_gained: mainSpiritGained,
    main_settle_count_today: cave.main_trigger_settle_count_today,
    main_spirit_today: cave.main_spirit_today
  };
}

/**
 * 开始采集
 */
function _isCaveJob(job) {
  if (!job || typeof job !== 'object') return false;
  const st = String(job.sub_type || '');
  return st === 'cave_field' || st === 'cave_mine';
}

function _cleanupOrphanedCaveJob(player) {
  player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
  const job = player.baiyi.pending_job;
  if (job && typeof job === 'object' && _isCaveJob(job)) {
    player.baiyi.pending_job = null;
    player.baiyi.is_crafting = false;
  }
}

function startGathering(player, type) {
  if (type !== 'field' && type !== 'mine') return { ok: false, error: '无效的采集类型' };

  const cave = ensureCaveState(player);
  tryResetRare(cave);

  if (cave.gathering) return { ok: false, error: '已在采集中，需先停止当前采集' };

  player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
  const baiyiJob = player.baiyi.pending_job;
  if (baiyiJob && typeof baiyiJob === 'object' && !_isCaveJob(baiyiJob)) {
    const remain = Math.max(0, intVal(baiyiJob.finish_at, 0) - Math.floor(Date.now() / 1000));
    return { ok: false, error: remain > 0
      ? `百艺行动序列占用中（炼器/炼药/制物进行中），剩余${remain}秒`
      : '百艺行动序列占用中，请先领取已完成产物' };
  }
  if (cave.rare_remaining <= 0) return { ok: false, error: '灵气已枯竭，请等待每日刷新' };

  const now = Math.floor(Date.now() / 1000);
  cave.gathering = { type, started_at: now, last_tick: now };
  cave.gathering.main_settle_sec_accumulator = 0;

  // 占用百艺队列（设一个非常远的 finish_at）
  player.baiyi.pending_job = {
    type: 'baiyi',
    sub_type: 'cave_' + type,
    start_at: now,
    finish_at: now + 365 * 24 * 3600,
    result_name: type === 'field' ? '灵田采集' : '灵矿采集'
  };

  player.cave = cave;
  return { ok: true, cave };
}

/**
 * 停止采集（先结算再停止）
 */
function stopGathering(player) {
  const cave = ensureCaveState(player);

  if (!cave.gathering) {
    const cleaned = _hasOrphanedCaveJob(player);
    if (cleaned) {
      _cleanupOrphanedCaveJob(player);
      return { ok: true, report: null, cave };
    }
    return { ok: false, error: '当前未在采集' };
  }

  const now = Math.floor(Date.now() / 1000);
  const report = settleCaveGathering(player, now);

  cave.gathering = null;
  player.cave = cave;
  _cleanupOrphanedCaveJob(player);

  return { ok: true, report, cave };
}

function _hasOrphanedCaveJob(player) {
  const job = player.baiyi?.pending_job;
  return job && typeof job === 'object' && _isCaveJob(job);
}

/**
 * 升级洞府
 */
function upgradeCave(player) {
  const cave = ensureCaveState(player);
  if (cave.level >= MAX_LEVEL) return { ok: false, error: '已达最高等级' };

  const cost = UPGRADE_COST[cave.level];
  if (!cost) return { ok: false, error: '无法升级' };

  const stones = intVal(player.spirit_stones, 0);
  if (stones < cost) return { ok: false, error: `灵石不足（需要${cost}，当前${stones}）` };

  player.spirit_stones = stones - cost;
  cave.level += 1;
  cave.rare_max = getRareCap(cave.level);
  player.cave = cave;

  return { ok: true, cave, cost };
}

function getCaveStatus(player) {
  const cave = ensureCaveState(player);
  tryResetRare(cave);
  player.cave = cave;
  const formation = _ensureFormationStateInCave(cave);

  const nextCost = cave.level < MAX_LEVEL ? (UPGRADE_COST[cave.level] || 0) : 0;
  const nextRareCap = cave.level < MAX_LEVEL ? getRareCap(cave.level + 1) : cave.rare_max;

  return {
    level: cave.level,
    max_level: MAX_LEVEL,
    rare_remaining: cave.rare_remaining,
    rare_max: cave.rare_max,
    main_trigger_settle_count_today: cave.main_trigger_settle_count_today,
    main_spirit_today: cave.main_spirit_today,
    main_services: cave.main_services,
    gathering: cave.gathering ? { type: cave.gathering.type, started_at: cave.gathering.started_at } : null,
    upgrade_cost: nextCost,
    next_rare_cap: nextRareCap,
    today_log: Array.isArray(cave.today_log) ? cave.today_log : [],
    formation: _getFormationView(formation)
  };
}

module.exports = {
  ensureCaveState, settleCaveGathering,
  settleMainFormationServices,
  setMainFormationServiceActive,
  getFormationEquipmentLevelAllowance,
  getFormationWildBattleModifiers,
  startGathering, stopGathering, upgradeCave, getCaveStatus,
  ensureCaveFormationState,
  getFormationCombatBonus,
  addFormationItems,
  placeFormationPiece,
  pickFormationPiece,
  moveFormationPiece,
  rotateFormationPiece,
  clearFormationBoard,
  decomposeFormationRune,
  decomposeFormationPlate,
  MAX_LEVEL, UPGRADE_COST, getRareCap
};
