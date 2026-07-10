/**
 * 传人系统 — 旅行青蛙式材料收集
 * - 给传人取名、装备装备
 * - 派往某地图收集特定材质的材料
 * - 判定间隔随传人装备战斗力缩短
 * - 每日体力上限 100，不可增加
 * - 不占用百艺和洞府队列
 */

const { getItemById, getMapById, getMaps, getItems, getEnemyById } = require('./dataLoader');
const { calcEquipCombatPower, calcTotalEquipCombatPower } = require('./onlineUtils');
const { getRealmQualityFromLevel } = require('./combatUtils');
const ops = require('./playerOps');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function clone(v) { return structuredClone(v); }

const MAX_STAMINA = 100;
const BASE_INTERVAL_SEC = 300;
const MIN_INTERVAL_SEC = 60;
const MATERIAL_TYPES = ['草木', '金属', '土石', '液体', '皮质', '玉质'];
const EQUIP_SLOTS = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];

const BEAST_TIER1_ITEMS = [20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10];
const BEAST_TIER2_ITEMS = [25, 26, 27, 28, 29, 4, 10, 62, 63, 64, 65, 66, 67];
const BEAST_TIER3_ITEMS = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70];
const BEAST_TIER4_ITEMS = [40, 41, 42, 43, 44, 71, 169, 178, 182];
const BEAST_TIER5_ITEMS = [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55];

function _getBeastDropPoolByLevel(lv) {
  if (lv <= 120) return BEAST_TIER1_ITEMS;
  if (lv <= 160) return BEAST_TIER2_ITEMS;
  if (lv <= 200) return BEAST_TIER3_ITEMS;
  if (lv <= 240) return BEAST_TIER4_ITEMS;
  return BEAST_TIER5_ITEMS.concat([121]);
}

/** 根据地图敌人的掉落表 + beast 材料池，汇总该地图所有可掉落的材料 itemId，再按 materialFilter 筛选 */
function _buildMapMaterialPool(map, materialFilter) {
  const enemyIds = Array.isArray(map.enemies) ? map.enemies : [];
  const candidateIds = new Set();
  for (const eid of enemyIds) {
    const enemy = getEnemyById(eid);
    if (!enemy || !enemy.id) continue;
    const drops = Array.isArray(enemy.drops) ? enemy.drops : [];
    for (const d of drops) {
      const itemId = intVal(d.itemId, 0);
      if (itemId > 0) candidateIds.add(itemId);
    }
    if (String(enemy.type || '') === 'beast') {
      const pool = _getBeastDropPoolByLevel(intVal(enemy.level, 1));
      for (const id of pool) candidateIds.add(id);
    }
  }
  const filtered = [];
  for (const id of candidateIds) {
    const item = getItemById(id);
    if (!item || !item.id) continue;
    const t = String(item.type || '');
    if (t !== 'material' && t !== 'herb' && t !== 'medicine') continue;
    const mat = String(item.material || '');
    if (mat !== materialFilter) continue;
    filtered.push(id);
  }
  return filtered;
}

/** 扫描材料池中物品的最高品质（quality） */
function _getMaxQualityInPool(pool) {
  let maxQ = 1;
  for (const id of pool) {
    const item = getItemById(id);
    if (item && item.quality) {
      const q = intVal(item.quality, 1);
      if (q > maxQ) maxQ = q;
    }
  }
  return maxQ;
}

/** 判定概率按材料池最高品质：一阶65%，二阶50%，三阶35%，四阶15%，五阶及以上5% */
function _getFindChanceByPool(pool) {
  const maxQ = _getMaxQualityInPool(pool);
  if (maxQ <= 1) return 0.65;
  if (maxQ <= 2) return 0.50;
  if (maxQ <= 3) return 0.35;
  if (maxQ <= 4) return 0.15;
  return 0.05;
}


function _getCheckIntervalSec(combatPower) {
  return Math.max(MIN_INTERVAL_SEC, BASE_INTERVAL_SEC - Math.floor(combatPower / 10));
}

function _getMidnightTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function ensureDiscipleState(player) {
  if (!player.disciple || typeof player.disciple !== 'object') {
    player.disciple = null;
  }
  return player.disciple;
}

function _calcDiscipleCombatPower(disciple) {
  if (!disciple?.equipment) return 0;
  let total = 0;
  for (const slot of EQUIP_SLOTS) {
    total += calcEquipCombatPower(disciple.equipment[slot]);
  }
  return total;
}

function _resetStaminaIfNeeded(disc) {
  const midnight = _getMidnightTs();
  if (intVal(disc.last_stamina_reset, 0) < midnight) {
    disc.stamina = MAX_STAMINA;
    disc.last_stamina_reset = midnight;
  }
}

function createDisciple(player, name) {
  if (!name || typeof name !== 'string') return { ok: false, error: '请输入传人名字' };
  const trimmed = name.trim().slice(0, 8);
  if (trimmed.length < 1) return { ok: false, error: '名字不能为空' };
  if (player.disciple) return { ok: false, error: '已有传人，无法重复创建' };

  player.disciple = {
    name: trimmed,
    equipment: {},
    combat_power: 0,
    stamina: MAX_STAMINA,
    last_stamina_reset: _getMidnightTs(),
    expedition: null
  };
  return { ok: true, disciple: _getPublicState(player.disciple) };
}

function renameDisciple(player, name) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  if (!name || typeof name !== 'string') return { ok: false, error: '请输入新名字' };
  const trimmed = name.trim().slice(0, 8);
  if (trimmed.length < 1) return { ok: false, error: '名字不能为空' };
  player.disciple.name = trimmed;
  return { ok: true };
}

function equipDisciple(player, slotName, page, slotIndex) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  if (!EQUIP_SLOTS.includes(slotName)) return { ok: false, error: '无效装备栏位' };
  if (player.disciple.expedition) return { ok: false, error: '传人外出中，无法更换装备' };

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const p = intVal(page, 0);
  const s = intVal(slotIndex, 0);
  if (p < 0 || p >= player.inventory.length) return { ok: false, error: '无效背包页' };
  const pageArr = player.inventory[p];
  if (!Array.isArray(pageArr) || s < 0 || s >= pageArr.length) return { ok: false, error: '无效背包格' };
  const slot = pageArr[s];
  if (!slot?.item) return { ok: false, error: '该格子为空' };

  const item = slot.item;
  const itemType = String(item.type || '');
  const itemSubtype = String(item.subtype || '');
  const isWeapon = itemType === 'weapon' || ['剑', '刀', '长兵', '弓', '拳爪', '音律', '节杖'].includes(itemSubtype);
  const isArmor = ['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'].includes(itemType);
  if (!isWeapon && !isArmor) return { ok: false, error: '该物品不是装备' };

  const targetSlot = isWeapon ? 'weapon' : itemType;
  if (slotName !== targetSlot) return { ok: false, error: `该装备应装在${slotName === 'weapon' ? '武器' : slotName}栏` };

  const disc = player.disciple;
  if (!disc.equipment) disc.equipment = {};
  const oldItem = disc.equipment[slotName];

  disc.equipment[slotName] = clone(item);
  pageArr[s] = { item: null, count: 0 };

  if (oldItem && oldItem.id) {
    ops.putItemInInventory(player.inventory, clone(oldItem), 1);
  }

  disc.combat_power = _calcDiscipleCombatPower(disc);
  return { ok: true, disciple: _getPublicState(disc) };
}

function unequipDisciple(player, slotName) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  if (!EQUIP_SLOTS.includes(slotName)) return { ok: false, error: '无效装备栏位' };
  if (player.disciple.expedition) return { ok: false, error: '传人外出中，无法更换装备' };

  const disc = player.disciple;
  if (!disc.equipment) disc.equipment = {};
  const item = disc.equipment[slotName];
  if (!item || !item.id) return { ok: false, error: '该栏位没有装备' };

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const placed = ops.putItemInInventory(player.inventory, clone(item), 1);
  if (!placed) return { ok: false, error: '背包已满，无法卸下' };

  disc.equipment[slotName] = null;
  disc.combat_power = _calcDiscipleCombatPower(disc);
  return { ok: true, disciple: _getPublicState(disc) };
}

function sendExpedition(player, mapId, materialFilter) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const disc = player.disciple;
  if (disc.expedition) return { ok: false, error: '传人已在外出中' };

  _resetStaminaIfNeeded(disc);
  if (disc.stamina <= 0) return { ok: false, error: '传人体力已耗尽，请等待每日刷新' };

  const map = getMapById(mapId);
  if (!map || !map.id) return { ok: false, error: '无效地图' };
  const playerRealm = getRealmQualityFromLevel(intVal(player.level, 1));
  const mapRealm = getRealmQualityFromLevel(intVal(map.level, 1));
  const REALM_NAMES = { 1: '练气', 2: '筑基', 3: '结丹', 4: '元婴', 5: '化神', 6: '合体' };
  if (mapRealm > playerRealm + 1) {
    return { ok: false, error: `传人只能探索不高于自身1阶级的地图（你${REALM_NAMES[playerRealm] || playerRealm + '阶'}，该地图${REALM_NAMES[mapRealm] || mapRealm + '阶'}）` };
  }
  if (!MATERIAL_TYPES.includes(materialFilter)) return { ok: false, error: '无效材质类型，可选：' + MATERIAL_TYPES.join('、') };

  const mapPool = _buildMapMaterialPool(map, materialFilter);
  if (mapPool.length === 0) return { ok: false, error: `${map.name}附近没有${materialFilter}类材料可收集` };

  const now = Math.floor(Date.now() / 1000);
  disc.expedition = {
    map_id: mapId,
    map_name: String(map.name || ''),
    material_filter: materialFilter,
    started_at: now,
    last_check_at: now,
    collected: []
  };
  return { ok: true, disciple: _getPublicState(disc) };
}

function settleExpedition(player, nowSec) {
  if (!player.disciple) return null;
  const disc = player.disciple;
  if (!disc.expedition) return null;

  _resetStaminaIfNeeded(disc);
  const exp = disc.expedition;
  const interval = _getCheckIntervalSec(disc.combat_power || 0);
  const lastCheck = intVal(exp.last_check_at, intVal(exp.started_at, nowSec));
  const elapsed = Math.max(0, nowSec - lastCheck);
  const checks = Math.floor(elapsed / interval);
  if (checks <= 0) return null;

  const map = getMapById(exp.map_id);
  const mapPool = _buildMapMaterialPool(map || {}, exp.material_filter);
  const findChance = _getFindChanceByPool(mapPool);

  let checksUsed = 0;
  for (let i = 0; i < checks; i++) {
    if (disc.stamina <= 0) break;
    disc.stamina--;
    checksUsed++;

    if (mapPool.length === 0) continue;
    if (Math.random() >= findChance) continue;

    const itemId = mapPool[Math.floor(Math.random() * mapPool.length)];
    const item = getItemById(itemId);
    if (!item || !item.id) continue;

    const existing = exp.collected.find(c => c.item_id === item.id);
    if (existing) existing.count += 1;
    else exp.collected.push({ item_id: item.id, item_name: String(item.name || ''), count: 1 });
  }

  if (checksUsed <= 0) return null;

  exp.last_check_at = lastCheck + checksUsed * interval;

  if (disc.stamina <= 0) {
    const collected = exp.collected;
    disc.expedition = null;
    return { auto_recalled: true, collected };
  }
  return { settled: true, checksUsed };
}

function recallDisciple(player) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const disc = player.disciple;
  if (!disc.expedition) return { ok: false, error: '传人未在外出中' };

  const now = Math.floor(Date.now() / 1000);
  const sr = settleExpedition(player, now);

  const collected = sr?.auto_recalled
    ? (sr.collected || [])
    : (disc.expedition ? disc.expedition.collected : []);
  disc.expedition = null;

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const delivered = [];
  for (const c of collected) {
    const item = getItemById(c.item_id);
    if (!item || !item.id) continue;
    for (let i = 0; i < c.count; i++) {
      ops.putItemInInventory(player.inventory, clone(item), 1);
    }
    delivered.push({ item_id: c.item_id, item_name: c.item_name, count: c.count });
  }

  return { ok: true, delivered, disciple: _getPublicState(disc) };
}

function getDiscipleStatus(player) {
  const disc = ensureDiscipleState(player);
  if (!disc) return { ok: true, hasDisciple: false };

  _resetStaminaIfNeeded(disc);
  const now = Math.floor(Date.now() / 1000);
  const settleResult = settleExpedition(player, now);

  let autoDelivered = null;
  const settled = !!(settleResult);
  if (settleResult?.auto_recalled) {
    player.inventory = ops.ensureInventoryStructure(player.inventory || []);
    autoDelivered = [];
    for (const c of settleResult.collected) {
      const item = getItemById(c.item_id);
      if (!item || !item.id) continue;
      for (let i = 0; i < c.count; i++) {
        ops.putItemInInventory(player.inventory, clone(item), 1);
      }
      autoDelivered.push({ item_id: c.item_id, item_name: c.item_name, count: c.count });
    }
  }

  return {
    ok: true,
    hasDisciple: true,
    disciple: _getPublicState(disc),
    auto_delivered: autoDelivered,
    settled,
    material_types: MATERIAL_TYPES
  };
}

function _getPublicState(disc) {
  if (!disc) return null;
  _resetStaminaIfNeeded(disc);
  return {
    name: disc.name,
    equipment: disc.equipment || {},
    combat_power: disc.combat_power || 0,
    stamina: disc.stamina,
    max_stamina: MAX_STAMINA,
    check_interval_sec: _getCheckIntervalSec(disc.combat_power || 0),
    expedition: disc.expedition ? {
      map_id: disc.expedition.map_id,
      map_name: disc.expedition.map_name || '',
      material_filter: disc.expedition.material_filter,
      started_at: disc.expedition.started_at,
      collected_count: (disc.expedition.collected || []).reduce((s, c) => s + c.count, 0),
      collected: disc.expedition.collected || []
    } : null
  };
}

module.exports = {
  ensureDiscipleState, createDisciple, renameDisciple,
  equipDisciple, unequipDisciple,
  sendExpedition, settleExpedition, recallDisciple,
  getDiscipleStatus, MATERIAL_TYPES, EQUIP_SLOTS
};
