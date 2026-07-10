const { getMapById, getEnemyById, getItemById } = require('./dataLoader');
const ops = require('./playerOps');
const { annotateEquipmentPower, isEquipmentItem, scoreEquipmentCollection } = require('./combatUtils');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clone(v) { return structuredClone(v); }

const MATERIAL_TYPES = new Set(['material', 'herb', 'medicine']);
const EQUIP_SLOTS = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
const BEAST_TIER1 = [20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10];
const BEAST_TIER2 = [25, 26, 27, 28, 29, 4, 10, 62, 63, 64, 65, 66, 67];
const BEAST_TIER3 = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70];
const BEAST_TIER4 = [40, 41, 42, 43, 44, 71, 169, 178, 182];
const APPRENTICE_STAMINA_MAX = 180;
const APPRENTICE_BASE_INTERVAL_SEC = 1800;
const APPRENTICE_MIN_INTERVAL_SEC = 300;
const APPRENTICE_LOG_LIMIT = 20;

function getMidnightTs(nowSec) {
  const d = new Date((Math.max(0, intVal(nowSec, 0)) || Math.floor(Date.now() / 1000)) * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function ensureApprenticeState(player, nowSec = Math.floor(Date.now() / 1000)) {
  if (!player || typeof player !== 'object') return null;
  if (!player.lineage_apprentice || typeof player.lineage_apprentice !== 'object' || Array.isArray(player.lineage_apprentice)) {
    player.lineage_apprentice = {};
  }
  const ap = player.lineage_apprentice;
  ap.unlocked = ap.unlocked !== false;
  ap.name = String(ap.name || '未命名传人').slice(0, 24);
  ap.equipment = ap.equipment && typeof ap.equipment === 'object' && !Array.isArray(ap.equipment) ? ap.equipment : {};
  ap.power_total = intVal(ap.power_total, 0);
  ap.stamina_max = Math.max(1, intVal(ap.stamina_max, APPRENTICE_STAMINA_MAX));
  ap.stamina = clamp(intVal(ap.stamina, ap.stamina_max), 0, ap.stamina_max);
  ap.last_stamina_reset = intVal(ap.last_stamina_reset, 0);
  ap.dispatch = ap.dispatch && typeof ap.dispatch === 'object' ? ap.dispatch : null;
  if (!Array.isArray(ap.logs)) ap.logs = [];
  if (ap.logs.length > APPRENTICE_LOG_LIMIT) ap.logs = ap.logs.slice(-APPRENTICE_LOG_LIMIT);
  resetApprenticeDaily(ap, nowSec);
  ap.power_total = scoreEquipmentCollection(ap.equipment);
  return ap;
}

function resetApprenticeDaily(apprentice, nowSec) {
  if (!apprentice || typeof apprentice !== 'object') return;
  const midnight = getMidnightTs(nowSec);
  if (intVal(apprentice.last_stamina_reset, 0) < midnight) {
    apprentice.stamina = Math.max(1, intVal(apprentice.stamina_max, APPRENTICE_STAMINA_MAX));
    apprentice.last_stamina_reset = midnight;
  }
}

function getApprenticeIntervalSec(powerTotal) {
  const power = Math.max(0, intVal(powerTotal, 0));
  const reduced = APPRENTICE_BASE_INTERVAL_SEC - Math.floor(power * 1.2);
  return clamp(reduced, APPRENTICE_MIN_INTERVAL_SEC, APPRENTICE_BASE_INTERVAL_SEC);
}

function _collectMapMaterialCandidates(mapId) {
  const map = getMapById(mapId);
  if (!map || !map.id || !Array.isArray(map.enemies)) return [];
  const dedup = new Map();
  const pushItem = (itemId) => {
    const item = getItemById(itemId);
    if (!item || !item.id) return;
    if (!MATERIAL_TYPES.has(String(item.type || ''))) return;
    dedup.set(Number(item.id), item);
  };

  for (const enemyId of map.enemies) {
    const enemy = getEnemyById(enemyId);
    if (!enemy || !enemy.id) continue;
    const configDrops = Array.isArray(enemy.drops) ? enemy.drops : [];
    for (const row of configDrops) {
      const itemId = intVal(row?.itemId, 0);
      if (itemId > 0) pushItem(itemId);
    }
    if (String(enemy.type || '') === 'beast') {
      const lv = intVal(enemy.level, 1);
      const pool = lv <= 120 ? BEAST_TIER1 : lv <= 160 ? BEAST_TIER2 : lv <= 200 ? BEAST_TIER3 : BEAST_TIER4;
      for (const itemId of pool) pushItem(itemId);
      if (lv >= 241 && lv <= 280) pushItem(121);
    } else if (['spirit'].includes(String(enemy.type || ''))) {
      const lv = intVal(enemy.level, 1);
      if (lv >= 241 && lv <= 280) pushItem(121);
    }
  }

  return Array.from(dedup.values());
}

function buildApprenticeTargetPool(mapId, targetMode, targetValue) {
  const mode = String(targetMode || '');
  const value = String(targetValue || '').trim();
  if (!value || !['material', 'element'].includes(mode)) return [];
  const candidates = _collectMapMaterialCandidates(mapId);
  return candidates.filter((item) => {
    if (mode === 'material') return String(item.material || '') === value;
    if (mode === 'element') return String(item.element || '') === value;
    return false;
  });
}

function _appendLog(apprentice, entry) {
  if (!apprentice || typeof apprentice !== 'object') return;
  apprentice.logs = Array.isArray(apprentice.logs) ? apprentice.logs : [];
  apprentice.logs.push(entry);
  if (apprentice.logs.length > APPRENTICE_LOG_LIMIT) {
    apprentice.logs = apprentice.logs.slice(-APPRENTICE_LOG_LIMIT);
  }
}

function settleApprentice(player, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  if (!apprentice || !apprentice.dispatch) return null;

  const dispatch = apprentice.dispatch;
  const intervalSec = getApprenticeIntervalSec(apprentice.power_total);
  dispatch.interval_sec = intervalSec;
  const lastTick = Math.max(0, intVal(dispatch.last_tick, intVal(dispatch.started_at, nowSec)));
  const elapsed = Math.max(0, nowSec - lastTick);
  const cycles = Math.floor(elapsed / intervalSec);
  if (cycles <= 0 || apprentice.stamina <= 0) return null;

  const pool = buildApprenticeTargetPool(dispatch.map_id, dispatch.target_mode, dispatch.target_value);
  if (pool.length <= 0) {
    dispatch.last_tick = nowSec;
    dispatch.stopped_reason = 'pool_empty';
    apprentice.dispatch = null;
    _appendLog(apprentice, {
      ts: nowSec,
      type: 'stop',
      text: '传人未能找到符合条件的材料，已结束本次搜集'
    });
    return { cycles: 0, used_stamina: 0, drops: [], stopped: true, reason: 'pool_empty' };
  }

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const actualCycles = Math.min(cycles, apprentice.stamina);
  const dropCounts = {};
  let usedStamina = 0;
  let processedCycles = 0;
  let stopped = false;
  let reason = '';

  for (let i = 0; i < actualCycles; i++) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    if (!item || !item.id) continue;
    const placed = ops.putItemInInventory(player.inventory, clone(item), 1);
    if (!placed) {
      stopped = true;
      reason = 'inventory_full';
      break;
    }
    processedCycles += 1;
    usedStamina += 1;
    apprentice.stamina = Math.max(0, apprentice.stamina - 1);
    const key = String(item.id);
    if (dropCounts[key]) dropCounts[key].count += 1;
    else dropCounts[key] = { item_id: Number(item.id), item_name: String(item.name || '未知材料'), count: 1 };
  }

  dispatch.last_tick = lastTick + processedCycles * intervalSec;
  dispatch.interval_sec = intervalSec;
  dispatch.settled_at = nowSec;
  dispatch.total_cycles = intVal(dispatch.total_cycles, 0) + processedCycles;
  dispatch.used_stamina = intVal(dispatch.used_stamina, 0) + usedStamina;

  if (apprentice.stamina <= 0 && !stopped) {
    stopped = true;
    reason = 'stamina_empty';
  }

  const drops = Object.values(dropCounts).sort((a, b) => b.count - a.count);
  if (drops.length > 0) {
    const summary = drops.map((d) => `${d.item_name}x${d.count}`).join('、');
    _appendLog(apprentice, {
      ts: nowSec,
      type: 'gather',
      text: `传人带回：${summary}`
    });
  }
  if (stopped) {
    apprentice.dispatch = null;
    _appendLog(apprentice, {
      ts: nowSec,
      type: 'stop',
      text: reason === 'inventory_full' ? '背包已满，传人已结束搜集' : '传人体力耗尽，今日搜集结束'
    });
  } else {
    apprentice.dispatch = dispatch;
  }

  annotateEquipmentPower(player);
  return { cycles: processedCycles, used_stamina: usedStamina, drops, stopped, reason, interval_sec: intervalSec };
}

function getApprenticeSummary(player, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  if (!apprentice) return null;
  const dispatch = apprentice.dispatch;
  return {
    unlocked: apprentice.unlocked,
    name: apprentice.name,
    equipment: apprentice.equipment,
    power_total: apprentice.power_total,
    stamina: apprentice.stamina,
    stamina_max: apprentice.stamina_max,
    interval_sec: getApprenticeIntervalSec(apprentice.power_total),
    dispatch: dispatch ? {
      map_id: dispatch.map_id,
      map_name: String(getMapById(dispatch.map_id)?.name || ''),
      target_mode: dispatch.target_mode,
      target_value: dispatch.target_value,
      started_at: dispatch.started_at,
      last_tick: dispatch.last_tick
    } : null,
    logs: apprentice.logs
  };
}

function renameApprentice(player, name, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, error: '请输入传人名字' };
  apprentice.name = trimmed.slice(0, 24);
  return { ok: true, apprentice: getApprenticeSummary(player, nowSec) };
}

function apprenticeEquip(player, page, slotIndex, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  const inv = player.inventory;
  if (!Array.isArray(inv) || page < 0 || page >= inv.length) return { ok: false, error: '无效背包页' };
  const row = inv[page];
  if (!Array.isArray(row) || slotIndex < 0 || slotIndex >= row.length) return { ok: false, error: '无效槽位' };
  const slot = row[slotIndex];
  if (!slot || !slot.item) return { ok: false, error: '该槽位无物品' };
  const item = clone(slot.item);
  if (!isEquipmentItem(item)) return { ok: false, error: '只能给传人装备装备' };

  const equipSlot = String(item.type || '');
  const old = apprentice.equipment[equipSlot];
  if (old) {
    const placed = ops.putItemInInventory(player.inventory, clone(old), 1);
    if (!placed) return { ok: false, error: '背包已满' };
  }
  apprentice.equipment[equipSlot] = item;
  const count = Math.max(1, intVal(slot.count, 1));
  if (count <= 1) row[slotIndex] = null;
  else slot.count = count - 1;
  apprentice.power_total = scoreEquipmentCollection(apprentice.equipment);
  annotateEquipmentPower(player);
  return { ok: true, apprentice: getApprenticeSummary(player, nowSec) };
}

function apprenticeUnequip(player, slotName, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  const key = String(slotName || '');
  if (!EQUIP_SLOTS.includes(key)) return { ok: false, error: '无效装备位' };
  const item = apprentice.equipment[key];
  if (!item) return { ok: false, error: '该部位未装备' };
  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const placed = ops.putItemInInventory(player.inventory, clone(item), 1);
  if (!placed) return { ok: false, error: '背包已满' };
  delete apprentice.equipment[key];
  apprentice.power_total = scoreEquipmentCollection(apprentice.equipment);
  annotateEquipmentPower(player);
  return { ok: true, apprentice: getApprenticeSummary(player, nowSec) };
}

function startApprenticeDispatch(player, mapId, targetMode, targetValue, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  const map = getMapById(mapId);
  if (!map || !map.id) return { ok: false, error: '地图不存在' };
  if (apprentice.dispatch) return { ok: false, error: '传人已在搜集中' };
  if (apprentice.stamina <= 0) return { ok: false, error: '传人体力已耗尽，明日再来' };
  const pool = buildApprenticeTargetPool(mapId, targetMode, targetValue);
  if (pool.length <= 0) return { ok: false, error: '该地图没有符合条件的材料' };
  apprentice.dispatch = {
    map_id: intVal(mapId, 0),
    target_mode: String(targetMode || ''),
    target_value: String(targetValue || ''),
    started_at: nowSec,
    last_tick: nowSec,
    interval_sec: getApprenticeIntervalSec(apprentice.power_total),
    total_cycles: 0,
    used_stamina: 0
  };
  _appendLog(apprentice, {
    ts: nowSec,
    type: 'start',
    text: `传人前往${String(map.name || '未知地图')}搜集${String(targetValue || '')}`
  });
  return { ok: true, apprentice: getApprenticeSummary(player, nowSec) };
}

function stopApprenticeDispatch(player, nowSec = Math.floor(Date.now() / 1000)) {
  const apprentice = ensureApprenticeState(player, nowSec);
  if (!apprentice.dispatch) return { ok: false, error: '传人当前未在搜集' };
  const report = settleApprentice(player, nowSec);
  if (apprentice.dispatch) {
    apprentice.dispatch = null;
    _appendLog(apprentice, { ts: nowSec, type: 'stop', text: '你召回了传人' });
  }
  return { ok: true, apprentice: getApprenticeSummary(player, nowSec), report };
}

module.exports = {
  ensureApprenticeState,
  getApprenticeIntervalSec,
  buildApprenticeTargetPool,
  settleApprentice,
  getApprenticeSummary,
  renameApprentice,
  apprenticeEquip,
  apprenticeUnequip,
  startApprenticeDispatch,
  stopApprenticeDispatch
};
