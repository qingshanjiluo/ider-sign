const SECT_TREASURY_MANUAL_REFRESH_DAILY_LIMIT = 15;
const SECT_TREASURY_MANUAL_REFRESH_BASE_COST = 100;
const SECT_BASIC_ARMOR_COST = 400;
const VALID_ARMOR_TYPES = ['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];

function getSectMainElement(intVal, sectId) {
  const s = intVal(sectId, 0);
  if (s === 1) return '混元';
  if (s === 2) return '无';
  if (s === 3) return '金';
  if (s === 4) return '土';
  if (s === 5) return '木';
  if (s === 6) return '火';
  if (s === 7) return '水';
  return '';
}

function getSectTreasurySpecialIds(intVal, sectId) {
  const s = intVal(sectId, 0);
  if (s === 1) return [129];
  if (s === 2) return [128];
  if (s === 3) return [130];
  if (s === 4) return [131];
  if (s === 5) return [132];
  if (s === 6) return [];
  return [];
}

function getSectTreasuryMaterialIds(deps, sectId) {
  const { getItems, intVal } = deps;
  const mainEl = getSectMainElement(intVal, sectId);
  if (!mainEl) return [];
  const allow = mainEl === '混元' ? ['无', '混元'] : [mainEl];
  const out = [];
  for (const item of getItems() || []) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('no_market')) continue;
    const t = String(item.type || '');
    if (!['herb', 'material', 'medicine'].includes(t)) continue;
    const q = intVal(item.quality, 1);
    if (q < 1 || q > 4) continue;
    if (!allow.includes(String(item.element || ''))) continue;
    const idv = intVal(item.id, 0);
    if (idv > 0) out.push(idv);
  }
  return out;
}

function getSectTreasuryItemIds(deps, sectId) {
  const { intVal } = deps;
  return [
    ...getSectTreasurySpecialIds(intVal, sectId),
    ...getSectTreasuryMaterialIds(deps, sectId)
  ];
}

function getSectTreasuryItemCost(deps, itemId, sectId) {
  const { getItemById, calculateItemValue, intVal } = deps;
  const item = getItemById(itemId);
  if (!item || Object.keys(item).length <= 0) return 0;
  const value = calculateItemValue(item);
  if (getSectTreasurySpecialIds(intVal, sectId).includes(intVal(itemId))) return value * 5;
  return value * 10;
}

function ensureSectTreasuryState(player, deps) {
  const { db, intVal } = deps;
  player.sect_treasury = player.sect_treasury && typeof player.sect_treasury === 'object' ? player.sect_treasury : {};
  player.sect_treasury.goods = Array.isArray(player.sect_treasury.goods) ? player.sect_treasury.goods : [];
  player.sect_treasury.refresh_at = intVal(player.sect_treasury.refresh_at, 0);
  player.sect_treasury.sect_id = intVal(player.sect_treasury.sect_id, 0);
  player.sect_treasury.free_basic_weapon_bought_once = Boolean(player.sect_treasury.free_basic_weapon_bought_once);
  const today = db.getDateKey();
  if (String(player.sect_treasury.manual_refresh_date || '') !== today) {
    player.sect_treasury.manual_refresh_date = today;
    player.sect_treasury.manual_refresh_count = 0;
  }
  player.sect_treasury.manual_refresh_count = intVal(player.sect_treasury.manual_refresh_count, 0);
}

function getTreasuryMaterialIdsGlobal(deps) {
  const { getItems, intVal } = deps;
  const out = [];
  for (const item of getItems() || []) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('no_market')) continue;
    const t = String(item.type || '');
    if (!['herb', 'material', 'medicine'].includes(t)) continue;
    const q = intVal(item.quality, 1);
    if (q < 1 || q > 4) continue;
    const idv = intVal(item.id, 0);
    if (idv > 0) out.push(idv);
  }
  return out;
}

function rebuildSectTreasuryGoods(player, sectId, deps) {
  const {
    intVal,
    getItemById,
    calculateItemValue,
    nowSec,
    treasuryGoodsCount,
    treasuryRefreshSeconds
  } = deps;

  ensureSectTreasuryState(player, deps);
  const sid = intVal(sectId, 0);
  const ids = getTreasuryMaterialIdsGlobal(deps);
  const goods = [];
  if (ids.length > 0) {
    for (let i = 0; i < treasuryGoodsCount; i += 1) {
      const itemId = ids[Math.floor(Math.random() * ids.length)];
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) continue;
      const costEach = Math.max(1, calculateItemValue(item) * 10);
      goods.push({
        idx: goods.length,
        item_id: intVal(item.id, 0),
        item_name: String(item.name || '材料'),
        quality: intVal(item.quality, 1),
        cost_each: costEach,
        count: 1
      });
    }
  }
  player.sect_treasury.goods = goods;
  player.sect_treasury.sect_id = sid;
  player.sect_treasury.refresh_at = nowSec() + treasuryRefreshSeconds;
}

function ensureSectTreasuryUpToDate(player, sectId, force, deps) {
  const { intVal, nowSec, treasuryGoodsCount } = deps;
  ensureSectTreasuryState(player, deps);
  const sid = intVal(sectId, 0);
  const now = nowSec();
  const needRefresh = force
    || sid <= 0
    || intVal(player.sect_treasury.sect_id, 0) !== sid
    || intVal(player.sect_treasury.refresh_at, 0) <= now
    || !Array.isArray(player.sect_treasury.goods)
    || player.sect_treasury.goods.length !== treasuryGoodsCount;
  if (needRefresh) rebuildSectTreasuryGoods(player, sid, deps);
}

function getSectTreasuryBasicWeaponItemId(deps, sectId) {
  const { intVal, sectBasicWeaponBySect } = deps;
  return intVal(sectBasicWeaponBySect[intVal(sectId, 0)], 0);
}

function getCityTreasurePavilionItemIds(deps) {
  const { getItems, intVal } = deps;
  const out = [];
  for (const item of getItems() || []) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('no_market')) continue;
    const t = String(item.type || '');
    if (!['herb', 'material', 'medicine'].includes(t)) continue;
    const q = intVal(item.quality, 1);
    if (q < 1 || q > 4) continue;
    const idv = intVal(item.id, 0);
    if (idv > 0) out.push(idv);
  }
  return out;
}

function getCityTreasurePavilionPrice(deps, itemId) {
  const { getItemById, calculateItemValue } = deps;
  const item = getItemById(itemId);
  if (!item || Object.keys(item).length <= 0) return 0;
  return calculateItemValue(item) * 30;
}

function mountSectTreasuryRoutes({
  router,
  withAccountLock,
  db,
  intVal,
  clampi,
  nowSec,
  getItems,
  getItemById,
  getTechniques,
  calculateItemValue,
  hasEmptyInventorySlot,
  inventoryHasItem,
  deepClone,
  ops,
  generateWeapon,
  generateArmor,
  getPlayerAffixQualityCap,
  sectBasicWeaponBySect,
  treasuryRefreshSeconds,
  treasuryGoodsCount
}) {
  if (!router || typeof router.use !== 'function') {
    throw new Error('mountSectTreasuryRoutes: router 参数无效');
  }
  if (typeof withAccountLock !== 'function') {
    throw new Error('mountSectTreasuryRoutes: withAccountLock 参数无效');
  }

  const deps = {
    db,
    intVal,
    nowSec,
    getItems,
    getItemById,
    calculateItemValue,
    sectBasicWeaponBySect,
    treasuryRefreshSeconds,
    treasuryGoodsCount
  };

  router.post('/sect/exchange_equipment', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const equipType = String(req.body?.equip_type || '');
      const subtype = String(req.body?.subtype || '');
      const quality = clampi(intVal(req.body?.quality, 1), 1, 8);
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      let hasBasicGe3 = false;
      const techniques = getTechniques() || [];
      const levels = player.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
      for (const t of techniques) {
        if (intVal(t.sectId, 0) !== sid || String(t.sectTier || '') !== 'basic') continue;
        const tid = intVal(t.id, 0);
        const lvData = levels[tid] || levels[String(tid)] || null;
        if (lvData && intVal(lvData.level, 0) >= 3) {
          hasBasicGe3 = true;
          break;
        }
      }
      if (!hasBasicGe3) return res.json({ ok: false, error: '至少一门宗门基础功法达到3级方可兑换兵器库装备' });
      let equipment = {};
      const affixCap = getPlayerAffixQualityCap(intVal(player.level, 1));
      if (equipType === 'weapon') equipment = generateWeapon(subtype, quality, affixCap);
      else if (equipType === 'armor') equipment = generateArmor(subtype, quality, affixCap);
      else return res.json({ ok: false, error: '无效的装备类型' });
      if (!equipment || Object.keys(equipment).length <= 0) return res.json({ ok: false, error: '生成装备失败' });
      const actualValue = calculateItemValue(equipment);
      const actualCost = actualValue * (equipType === 'weapon' ? 5 : 3);
      if (intVal(player.sect_contribution, 0) < actualCost) return res.json({ ok: false, error: `贡献点不足（需要${actualCost}点）` });
      if (!hasEmptyInventorySlot(player)) return res.json({ ok: false, error: '背包已满，无法兑换装备，请先整理背包' });
      player.sect_contribution = intVal(player.sect_contribution, 0) - actualCost;
      const added = ops.putItemInInventory(player.inventory, equipment, 1);
      if (!added) {
        player.sect_contribution += actualCost;
        return res.json({ ok: false, error: '背包已满，已退回贡献点' });
      }
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, equipment, cost: actualCost });
    });
  });

  router.post('/sect/exchange_treasury', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const itemId = intVal(req.body?.item_id, 0);
      const count = Math.max(1, intVal(req.body?.count, 1));
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      const allowed = getSectTreasuryItemIds(deps, sid);
      if (!allowed.includes(itemId)) return res.json({ ok: false, error: '本宗门宝库无此物品' });
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '物品不存在' });
      const costEach = getSectTreasuryItemCost(deps, itemId, sid);
      let exchanged = 0;
      for (let i = 0; i < count; i += 1) {
        if (intVal(player.sect_contribution, 0) < costEach) break;
        if (!hasEmptyInventorySlot(player) && !inventoryHasItem(player, itemId)) break;
        player.sect_contribution = intVal(player.sect_contribution, 0) - costEach;
        const added = ops.putItemInInventory(player.inventory, deepClone(item), 1);
        if (added) exchanged += 1;
        else {
          player.sect_contribution += costEach;
          break;
        }
      }
      if (exchanged <= 0) return res.json({ ok: false, error: `贡献点不足或背包已满（单价${costEach}）` });
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, exchanged, total_cost: exchanged * costEach });
    });
  });

  // POST /sect/treasury/refresh - 手动刷新宗门宝库，每日最多15次，第n次消耗 100*n 灵石
  router.post('/sect/treasury/refresh', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      ensureSectTreasuryState(player, deps);
      const count = intVal(player.sect_treasury.manual_refresh_count, 0);
      if (count >= SECT_TREASURY_MANUAL_REFRESH_DAILY_LIMIT) {
        return res.json({ ok: false, error: `今日手动刷新已达上限（${SECT_TREASURY_MANUAL_REFRESH_DAILY_LIMIT}次）` });
      }
      const cost = SECT_TREASURY_MANUAL_REFRESH_BASE_COST * (count + 1);
      const stones = intVal(player.spirit_stones, 0);
      if (stones < cost) return res.json({ ok: false, error: `灵石不足（需要${cost}）` });
      player.spirit_stones = stones - cost;
      rebuildSectTreasuryGoods(player, sid, deps);
      player.sect_treasury.manual_refresh_count = count + 1;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({
        ok: true,
        goods: player.sect_treasury.goods,
        refresh_at: intVal(player.sect_treasury.refresh_at, 0),
        manual_refresh_count: player.sect_treasury.manual_refresh_count,
        manual_refresh_daily_limit: SECT_TREASURY_MANUAL_REFRESH_DAILY_LIMIT,
        next_cost: SECT_TREASURY_MANUAL_REFRESH_BASE_COST * (count + 2),
        cost,
        player
      });
    });
  });

  router.get('/sect/treasury/list', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      const beforeGoods = JSON.stringify(player.sect_treasury?.goods || []);
      ensureSectTreasuryUpToDate(player, sid, false, deps);
      const afterGoods = JSON.stringify(player.sect_treasury?.goods || []);
      const basicWeaponId = getSectTreasuryBasicWeaponItemId(deps, sid);
      const basicWeapon = getItemById(basicWeaponId);
      const bought = Boolean(player.sect_treasury?.free_basic_weapon_bought_once);
      if (beforeGoods !== afterGoods) {
        await db.savePlayer(req.accountId, 1, player);
      }
      const ARMOR_SLOTS = [
        { type: 'head', name: '头盔' },
        { type: 'shoulder', name: '护肩' },
        { type: 'chest', name: '胸甲' },
        { type: 'legs', name: '腿甲' },
        { type: 'hands', name: '护手' },
        { type: 'ring', name: '戒指' },
        { type: 'amulet', name: '项链' },
        { type: 'back', name: '披风' }
      ];
      return res.json({
        ok: true,
        refresh_at: intVal(player.sect_treasury?.refresh_at, 0),
        goods: player.sect_treasury?.goods || [],
        manual_refresh_count: intVal(player.sect_treasury?.manual_refresh_count, 0),
        manual_refresh_daily_limit: SECT_TREASURY_MANUAL_REFRESH_DAILY_LIMIT,
        manual_refresh_next_cost: SECT_TREASURY_MANUAL_REFRESH_BASE_COST * (intVal(player.sect_treasury?.manual_refresh_count, 0) + 1),
        basic_weapon: {
          item_id: basicWeaponId,
          item_name: String(basicWeapon?.name || '基础武器'),
          bought,
          price: 0
        },
        basic_armor: { slots: ARMOR_SLOTS, cost: 400 },
        player
      });
    });
  });

  router.post('/sect/treasury/buy', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      ensureSectTreasuryUpToDate(player, sid, false, deps);
      const idx = intVal(req.body?.index, -1);
      const count = Math.max(1, intVal(req.body?.count, 1));
      const goods = Array.isArray(player.sect_treasury?.goods) ? player.sect_treasury.goods : [];
      if (idx < 0 || idx >= goods.length) return res.json({ ok: false, error: '商品索引无效' });
      const g = goods[idx] || {};
      const stock = intVal(g.count, 0);
      if (stock <= 0) return res.json({ ok: false, error: '该商品已售罄' });
      const buyCount = Math.min(stock, count);
      const itemId = intVal(g.item_id, 0);
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '商品不存在' });
      const costEach = Math.max(1, intVal(g.cost_each, calculateItemValue(item) * 10));
      const totalCost = costEach * buyCount;
      if (intVal(player.sect_contribution, 0) < totalCost) return res.json({ ok: false, error: `贡献不足（需要${totalCost}）` });
      if (!hasEmptyInventorySlot(player) && !inventoryHasItem(player, itemId)) return res.json({ ok: false, error: '背包已满' });
      player.sect_contribution = intVal(player.sect_contribution, 0) - totalCost;
      const added = ops.putItemInInventory(player.inventory, deepClone(item), buyCount);
      if (!added) {
        player.sect_contribution += totalCost;
        return res.json({ ok: false, error: '背包已满，购买失败' });
      }
      g.count = stock - buyCount;
      goods[idx] = g;
      player.sect_treasury.goods = goods;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, bought_count: buyCount, total_cost: totalCost, item_name: String(item.name || '材料') });
    });
  });

  router.post('/sect/treasury/buy_basic_weapon', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      ensureSectTreasuryState(player, deps);
      if (Boolean(player.sect_treasury.free_basic_weapon_bought_once)) return res.json({ ok: false, error: '账号已领取过基础武器' });
      const itemId = getSectTreasuryBasicWeaponItemId(deps, sid);
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '基础武器未配置' });
      if (!hasEmptyInventorySlot(player) && !inventoryHasItem(player, itemId)) return res.json({ ok: false, error: '背包已满' });
      const added = ops.putItemInInventory(player.inventory, deepClone(item), 1);
      if (!added) return res.json({ ok: false, error: '背包已满' });
      player.sect_treasury.free_basic_weapon_bought_once = true;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, item_name: String(item.name || '基础武器') });
    });
  });

  router.post('/sect/treasury/buy_basic_armor', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sid = intVal(player.sect_id, 0);
      if (sid <= 0) return res.json({ ok: false, error: '未加入宗门' });
      ensureSectTreasuryState(player, deps);
      const armorType = String(req.body?.armor_type || '').toLowerCase();
      if (!VALID_ARMOR_TYPES.includes(armorType)) return res.json({ ok: false, error: '无效的防具部位' });
      const cost = SECT_BASIC_ARMOR_COST;
      if (intVal(player.sect_contribution, 0) < cost) return res.json({ ok: false, error: `贡献不足（需要${cost}）` });
      if (!hasEmptyInventorySlot(player)) return res.json({ ok: false, error: '背包已满' });
      const equipment = generateArmor(armorType, 1, 8, true);
      if (!equipment || Object.keys(equipment).length <= 0) return res.json({ ok: false, error: '生成装备失败' });
      const added = ops.putItemInInventory(player.inventory, equipment, 1);
      if (!added) return res.json({ ok: false, error: '背包已满' });
      player.sect_contribution = intVal(player.sect_contribution, 0) - cost;
      await db.savePlayer(req.accountId, 1, player);
      const slotNames = { head: '头盔', shoulder: '护肩', chest: '胸甲', legs: '腿甲', hands: '护手', ring: '戒指', amulet: '项链', back: '披风' };
      return res.json({ ok: true, player, item_name: String(equipment.name || slotNames[armorType] || '防具'), total_cost: cost });
    });
  });

  router.post('/city/buy', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const itemId = intVal(req.body?.item_id, 0);
      const count = Math.max(1, intVal(req.body?.count, 1));
      const allowed = getCityTreasurePavilionItemIds(deps);
      if (!allowed.includes(itemId)) return res.json({ ok: false, error: '百宝阁无此物品' });
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '物品不存在' });
      const priceEach = getCityTreasurePavilionPrice(deps, itemId);
      const total = priceEach * count;
      if (intVal(player.spirit_stones, 0) < total) return res.json({ ok: false, error: `灵石不足（需要${total}）` });
      if (!hasEmptyInventorySlot(player) && !inventoryHasItem(player, itemId)) return res.json({ ok: false, error: '背包已满，无法购买' });
      player.spirit_stones = intVal(player.spirit_stones, 0) - total;
      const added = ops.putItemInInventory(player.inventory, deepClone(item), count);
      if (!added) {
        player.spirit_stones += total;
        return res.json({ ok: false, error: '背包已满，已退回灵石' });
      }
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, total_cost: total });
    });
  });
}

module.exports = { mountSectTreasuryRoutes };