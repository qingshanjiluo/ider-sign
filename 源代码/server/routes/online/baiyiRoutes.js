function compareIngredients(selected, required, intVal) {
  const reqMain = Array.isArray(required.main) ? required.main : [];
  if (reqMain.length > 0) {
    const mainRequired = reqMain[0] || {};
    const selectedMain = selected.main || null;
    if (!selectedMain) return false;
    const selectedId = intVal((selectedMain.item || {}).id, 0);
    const requiredId = intVal(mainRequired.itemId, 0);
    if (selectedId !== requiredId) return false;
    if (intVal(selectedMain.count, 1) < intVal(mainRequired.count, 1)) return false;
  } else if (selected.main) {
    return false;
  }
  const selectedSub = Array.isArray(selected.sub) ? selected.sub : [null, null, null, null];
  const selectedSubIds = [];
  for (const sub of selectedSub) {
    if (!sub) continue;
    const itemId = intVal((sub.item || {}).id, 0);
    const count = intVal(sub.count, 1);
    for (let i = 0; i < count; i += 1) selectedSubIds.push(itemId);
  }
  const reqSub = Array.isArray(required.sub) ? required.sub : [];
  const reqSubIds = [];
  for (const ing of reqSub) {
    const itemId = intVal(ing.itemId, 0);
    const count = intVal(ing.count, 1);
    for (let i = 0; i < count; i += 1) reqSubIds.push(itemId);
  }
  selectedSubIds.sort((a, b) => a - b);
  reqSubIds.sort((a, b) => a - b);
  if (selectedSubIds.length !== reqSubIds.length) return false;
  for (let i = 0; i < selectedSubIds.length; i += 1) {
    if (selectedSubIds[i] !== reqSubIds[i]) return false;
  }
  const reqCatalyst = Array.isArray(required.catalyst) ? required.catalyst : [];
  if (reqCatalyst.length > 0) {
    const cReq = reqCatalyst[0] || {};
    const selectedCatalyst = selected.catalyst || null;
    if (!selectedCatalyst) return false;
    const selectedId = intVal((selectedCatalyst.item || {}).id, 0);
    const requiredId = intVal(cReq.itemId, 0);
    if (selectedId !== requiredId) return false;
    if (intVal(selectedCatalyst.count, 1) < intVal(cReq.count, 1)) return false;
  } else if (selected.catalyst) {
    return false;
  }
  return true;
}

function matchAlchemyRecipe(selected, getAlchemyRecipes, intVal) {
  const recipes = getAlchemyRecipes();
  for (const recipe of recipes) {
    if (compareIngredients(selected || {}, recipe.ingredients || {}, intVal)) return recipe;
  }
  return null;
}

function getSelectedIngredientConsumeMap(selected, batchCount, intVal) {
  const out = {};
  const batch = Math.max(1, intVal(batchCount, 1));
  const main = selected.main || null;
  if (main && main.item) {
    const id = intVal(main.item.id, 0);
    const c = Math.max(1, intVal(main.count, 1)) * batch;
    if (id > 0) out[id] = (out[id] || 0) + c;
  }
  const sub = Array.isArray(selected.sub) ? selected.sub : [];
  for (const x of sub) {
    if (!x || !x.item) continue;
    const id = intVal(x.item.id, 0);
    const c = Math.max(1, intVal(x.count, 1)) * batch;
    if (id > 0) out[id] = (out[id] || 0) + c;
  }
  const catalyst = selected.catalyst || null;
  if (catalyst && catalyst.item) {
    const id = intVal(catalyst.item.id, 0);
    const c = Math.max(1, intVal(catalyst.count, 1)) * batch;
    if (id > 0) out[id] = (out[id] || 0) + c;
  }
  return out;
}

const BAIYI_FORBIDDEN_ITEM_IDS = new Set([160, 168]); // 万物之形、作者信物

function getBaiyiForbiddenItemError(itemId, getItemById, intVal) {
  const id = intVal(itemId, 0);
  if (!BAIYI_FORBIDDEN_ITEM_IDS.has(id)) return '';
  const item = getItemById(id);
  const name = item && item.name ? String(item.name) : `物品${id}`;
  return `${name}不能参与百艺相关活动`;
}

const INHERIT_ARMOR_TYPES = new Set(['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);
const INHERIT_WEAPON_SUBTYPES = new Set(['剑', '刀', '长兵', '弓', '拳爪', '音律', '节杖']);
const INHERIT_SUBTYPE_LABELS = {
  head: '头盔',
  shoulder: '护肩',
  chest: '胸甲',
  legs: '腿甲',
  hands: '护手',
  ring: '戒指',
  amulet: '项链',
  back: '披风',
  剑: '剑',
  刀: '刀',
  长兵: '长兵',
  弓: '弓',
  拳爪: '拳爪',
  音律: '音律',
  节杖: '节杖'
};

function getInheritSubtypeInfo(equipment, getItemById, intVal) {
  const rawType = String(equipment?.type || '').trim();
  const rawSubtype = String(equipment?.subtype || '').trim();

  if (rawType === 'weapon') {
    let subtype = rawSubtype;
    if (!subtype) {
      const tpl = getItemById(intVal(equipment?.id, 0));
      if (tpl && typeof tpl === 'object') subtype = String(tpl.subtype || '').trim();
    }
    return { group: 'weapon', key: subtype };
  }
  if (INHERIT_WEAPON_SUBTYPES.has(rawType)) return { group: 'weapon', key: rawType };
  if (INHERIT_ARMOR_TYPES.has(rawType)) return { group: 'armor', key: rawType };
  return { group: 'other', key: rawSubtype || rawType };
}

function getInheritSubtypeLabel(info) {
  if (!info || !info.key) return '未知';
  return INHERIT_SUBTYPE_LABELS[info.key] || String(info.key);
}

const ARRAY_PLATE_ITEM_IDS = [200, 201, 202, 203, 204, 205, 206, 207, 216, 217, 218, 219];
const ZAOHUA_ORB_ITEM_ID = 239;

function getValidArrayPlateItemIds(getItemById, intVal) {
  const out = [];
  for (const rawId of ARRAY_PLATE_ITEM_IDS) {
    const itemId = intVal(rawId, 0);
    if (itemId <= 0) continue;
    const item = getItemById(itemId);
    if (item && Object.keys(item).length > 0) out.push(itemId);
  }
  return out;
}

function isExpectedItemMismatch(slotData, expectItemId, intVal) {
  const expected = intVal(expectItemId, 0);
  if (expected <= 0) return false;
  if (!slotData || !slotData.item) return true;
  return intVal(slotData.item.id, 0) !== expected;
}

function makeSlotMismatchResp() {
  return { ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' };
}

function getZaohuaLockedError(equipment, isZaohuaLockedEquipment) {
  if (typeof isZaohuaLockedEquipment !== 'function') return '';
  return isZaohuaLockedEquipment(equipment) ? '该装备已完成造化，无法再进行属性改造' : '';
}

function pickRandomOne(arr) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length <= 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] || null;
}

function createBaiyiJobId(accountId, nowSec) {
  const toInt = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : d;
  };
  const aid = Math.max(0, toInt(accountId, 0));
  const ts = Math.max(0, toInt(nowSec, 0));
  const rand = Math.random().toString(36).slice(2, 10);
  return `${aid}-${ts}-${rand}`;
}

async function persistPlayerImmediateOrConflict(req, res, db, player) {
  const saveRet = await db.savePlayerImmediate(req.accountId, 1, player);
  if (saveRet && saveRet.conflict) {
    if (!res.headersSent) {
      res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
    }
    return false;
  }
  return true;
}

function mountBaiyiRoutes({
  router,
  withAccountLock,
  db,
  intVal,
  clampi,
  deepClone,
  getAlchemyRecipes,
  getCraftRecipes,
  getItemById,
  countItemInInventory,
  consumeItemFromInventory,
  getSlot,
  settleBackgroundJobsForPlayer,
  isValidEquipType,
  isCatalystItem,
  canBeForgingMaterial,
  executeForging,
  executeUpgrade,
  executeAffixUpgrade,
  executeAffixTierReroll,
  applyAffixesToEquipment,
  executeReroll,
  executeZaohua,
  isZaohuaLockedEquipment,
  calculateRerollLockExtraCost,
  getPlayerAffixQualityCap,
  generateExEquipment,
  equipmentTypesArmor,
  maxAffixTier,
  ops,
  rewardsByCode
}) {
  if (!router || typeof router.use !== 'function') {
    throw new Error('mountBaiyiRoutes: router 参数无效');
  }
  if (typeof withAccountLock !== 'function') {
    throw new Error('mountBaiyiRoutes: withAccountLock 参数无效');
  }

  router.post('/alchemy/start', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      player.alchemy = player.alchemy && typeof player.alchemy === 'object' ? player.alchemy : {};
      player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
      const baiyiJob = player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object' ? player.baiyi.pending_job : null;
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) <= now) {
        const finishedSubType = String(baiyiJob.sub_type || '');
        const toCave = finishedSubType.indexOf('array_') === 0;
        await settleBackgroundJobsForPlayer(req.accountId, player, now);
        if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
        return res.json({
          ok: true,
          pending: false,
          mailed: !toCave,
          player,
          msg: toCave ? '刻阵已完成，阵盘/阵纹已收纳至洞府阵库' : '炼药已完成，产物已发送到系统邮件'
        });
      }
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) > now) {
        const remain = Math.max(0, intVal(baiyiJob.finish_at, 0) - now);
        return res.json({ ok: false, pending: true, remaining_sec: remain, error: `百艺行动序列占用中，剩余${remain}秒` });
      }
      const selected = req.body?.selected_ingredients || {};
      const batchCount = Math.max(1, intVal(req.body?.batch_count, 1));
      const consumeMap = getSelectedIngredientConsumeMap(selected, batchCount, intVal);
      for (const k of Object.keys(consumeMap)) {
        const forbiddenErr = getBaiyiForbiddenItemError(k, getItemById, intVal);
        if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      }
      const matched = matchAlchemyRecipe(selected, getAlchemyRecipes, intVal);
      if (Object.keys(consumeMap).length <= 0) return res.json({ ok: false, error: '请先选择药材' });
      if (matched && matched.requires_unlock) {
        const unlocked = Array.isArray(player.alchemy.unlocked_recipes) ? player.alchemy.unlocked_recipes : [];
        const rid = intVal(matched.id, 0);
        const learned = unlocked.some(x => intVal(x, -1) === rid);
        if (!learned) {
          return res.json({ ok: false, error: `尚未学习丹方：${String(matched.name || '未知配方')}` });
        }
      }
      for (const k of Object.keys(consumeMap)) {
        const itemId = intVal(k, 0);
        const need = intVal(consumeMap[k], 0);
        if (itemId <= 0 || need <= 0) return res.json({ ok: false, error: '药材参数无效' });
        if (countItemInInventory(player, itemId) < need) {
          const item = getItemById(itemId);
          const name = item && item.name ? item.name : `物品${itemId}`;
          return res.json({ ok: false, error: `材料不足：${name}（需要${need}）` });
        }
      }
      for (const k of Object.keys(consumeMap)) consumeItemFromInventory(player, intVal(k, 0), intVal(consumeMap[k], 0));
      let resultItemId = 3;
      let resultCount = 1;
      let resultName = '废丹';
      if (matched) {
        resultItemId = intVal((matched.result || {}).id, 3);
        resultCount = Math.max(1, intVal((matched.result || {}).count, 1)) * batchCount;
        resultName = String(matched.name || '未知丹药');
        const unlocked = Array.isArray(player.alchemy.unlocked_recipes) ? player.alchemy.unlocked_recipes : [];
        const rid = intVal(matched.id, 0);
        const exists = unlocked.some(x => intVal(x, -1) === rid);
        if (!exists && rid > 0) unlocked.push(rid);
        player.alchemy.unlocked_recipes = unlocked;
      }
      const resultItem = getItemById(resultItemId);
      if (!resultItem || Object.keys(resultItem).length <= 0) return res.json({ ok: false, error: '配方产物不存在' });
      const baseTime = (matched ? Math.max(1, intVal((matched || {}).time, 20)) : 20) * 2;
      const totalTime = Math.max(1, baseTime * batchCount);
      player.alchemy.is_brewing = true;
      player.alchemy.current_recipe = matched ? intVal((matched || {}).id, 0) : 0;
      player.baiyi.pending_job = {
        job_id: createBaiyiJobId(req.accountId, now),
        type: 'baiyi',
        sub_type: 'alchemy',
        start_at: now,
        finish_at: now + totalTime,
        result_name: resultName,
        result: { item_id: resultItemId, item_name: resultName, count: resultCount }
      };
      player.baiyi.is_crafting = true;
      player.baiyi.sub_type = 'alchemy';
      player.baiyi.progress = 0;
      player.baiyi.total_time = totalTime;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ok: true, pending: true, claimed: false, player, remaining_sec: totalTime, finish_at: now + totalTime });
    });
  });

  router.post('/forging/start', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      player.forging = player.forging && typeof player.forging === 'object' ? player.forging : {};
      player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
      const baiyiJob = player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object' ? player.baiyi.pending_job : null;
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) <= now) {
        const finishedSubType = String(baiyiJob.sub_type || '');
        const toCave = finishedSubType.indexOf('array_') === 0;
        await settleBackgroundJobsForPlayer(req.accountId, player, now);
        if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
        return res.json({
          ok: true,
          pending: false,
          mailed: !toCave,
          player,
          msg: toCave ? '刻阵已完成，阵盘/阵纹已收纳至洞府阵库' : '炼器已完成，产物已发送到系统邮件'
        });
      }
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) > now) {
        const remain = Math.max(0, intVal(baiyiJob.finish_at, 0) - now);
        return res.json({ ok: false, pending: true, remaining_sec: remain, error: `百艺行动序列占用中，剩余${remain}秒` });
      }
      const equipType = String(req.body?.equip_type || '').trim();
      const mainItemId = intVal(req.body?.main_item_id, 0);
      const mainCount = clampi(intVal(req.body?.main_count, 1), 1, 100);
      const lingItemId = intVal(req.body?.ling_item_id, 0);
      const catalystItemId = intVal(req.body?.catalyst_item_id, 0);
      if (!isValidEquipType(equipType) || mainItemId <= 0 || lingItemId <= 0 || catalystItemId <= 0) {
        return res.json({ ok: false, error: '参数无效' });
      }
      const forbiddenMainErr = getBaiyiForbiddenItemError(mainItemId, getItemById, intVal);
      if (forbiddenMainErr) return res.json({ ok: false, error: forbiddenMainErr });
      const forbiddenLingErr = getBaiyiForbiddenItemError(lingItemId, getItemById, intVal);
      if (forbiddenLingErr) return res.json({ ok: false, error: forbiddenLingErr });
      const forbiddenCatalystErr = getBaiyiForbiddenItemError(catalystItemId, getItemById, intVal);
      if (forbiddenCatalystErr) return res.json({ ok: false, error: forbiddenCatalystErr });
      const consumePlan = new Map();
      consumePlan.set(mainItemId, (consumePlan.get(mainItemId) || 0) + mainCount);
      consumePlan.set(lingItemId, (consumePlan.get(lingItemId) || 0) + 1);
      consumePlan.set(catalystItemId, (consumePlan.get(catalystItemId) || 0) + 1);
      for (const [itemId, needCount] of consumePlan.entries()) {
        if (countItemInInventory(player, itemId) < needCount) {
          return res.json({ ok: false, error: '材料不足' });
        }
      }
      const mainItem = getItemById(mainItemId);
      const lingItem = getItemById(lingItemId);
      const catalystItem = getItemById(catalystItemId);
      if (!canBeForgingMaterial(mainItem) || !canBeForgingMaterial(lingItem) || !isCatalystItem(catalystItemId)) {
        return res.json({ ok: false, error: '材料类型无效' });
      }
      const affixCap = getPlayerAffixQualityCap(intVal(player.level, 1));
      const equipment = executeForging(equipType, mainItem, mainCount, lingItem, catalystItem, affixCap);
      if (!equipment || Object.keys(equipment).length <= 0) return res.json({ ok: false, error: '炼器失败' });
      for (const [itemId, needCount] of consumePlan.entries()) {
        if (!consumeItemFromInventory(player, itemId, needCount)) {
          return res.json({ ok: false, error: '材料扣除失败' });
        }
      }
      const quality = clampi(intVal(equipment.quality, 1), 1, 7);
      const totalTime = Math.max(1, quality * 30);
      player.forging.is_forging = true;
      const equipName = equipment && equipment.name ? equipment.name : '装备';
      player.baiyi.pending_job = {
        job_id: createBaiyiJobId(req.accountId, now),
        type: 'baiyi',
        sub_type: 'forging',
        start_at: now,
        finish_at: now + totalTime,
        result_name: equipName,
        result: { equipment: deepClone(equipment) }
      };
      player.baiyi.is_crafting = true;
      player.baiyi.sub_type = 'forging';
      player.baiyi.progress = 0;
      player.baiyi.total_time = totalTime;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ok: true, pending: true, claimed: false, player, remaining_sec: totalTime, finish_at: now + totalTime });
    });
  });

  router.post('/forging/upgrade', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const page = intVal(req.body?.equip_page, -1);
      const slot = intVal(req.body?.equip_slot, -1);
      const expectItemId = intVal(req.body?.expect_item_id, 0);
      const materialItemId = intVal(req.body?.material_item_id, 0);
      const materialCount = clampi(intVal(req.body?.material_count, 1), 1, 100);
      const mode = String(req.body?.mode || '');
      const slotData = getSlot(player, page, slot);
      if (isExpectedItemMismatch(slotData, expectItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!slotData || !slotData.item) return res.json({ ok: false, error: '目标装备不存在' });
      const equipment = slotData.item;
      const zaohuaLockedErr = getZaohuaLockedError(equipment, isZaohuaLockedEquipment);
      if (zaohuaLockedErr) return res.json({ ok: false, error: zaohuaLockedErr });
      const materialItem = getItemById(materialItemId);
      const forbiddenErr = getBaiyiForbiddenItemError(materialItemId, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (!materialItem || Object.keys(materialItem).length <= 0) return res.json({ ok: false, error: '升品材料不存在' });
      if (countItemInInventory(player, materialItemId) < materialCount) return res.json({ ok: false, error: '升品材料数量不足' });
      const result = executeUpgrade(equipment, materialItem, materialCount, mode);
      if (!result.ok) return res.json(result);
      consumeItemFromInventory(player, materialItemId, intVal(result.consume_count, materialCount));
      if (result.success) slotData.item = result.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ...result, player });
    });
  });

  router.post('/forging/upgrade_affix', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const page = intVal(req.body?.equip_page, -1);
      const slot = intVal(req.body?.equip_slot, -1);
      const expectItemId = intVal(req.body?.expect_item_id, 0);
      const affixIndex = intVal(req.body?.affix_index, -1);
      const materialItemId = intVal(req.body?.material_item_id, 0);
      const materialCount = clampi(intVal(req.body?.material_count, 1), 1, 100);
      const mode = String(req.body?.mode || '');
      const affixMode = String(req.body?.affix_mode || req.body?.action || 'upgrade');
      const slotData = getSlot(player, page, slot);
      if (isExpectedItemMismatch(slotData, expectItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!slotData || !slotData.item) return res.json({ ok: false, error: '目标装备不存在' });
      const equipment = slotData.item;
      const zaohuaLockedErr = getZaohuaLockedError(equipment, isZaohuaLockedEquipment);
      if (zaohuaLockedErr) return res.json({ ok: false, error: zaohuaLockedErr });
      const materialItem = getItemById(materialItemId);
      const forbiddenErr = getBaiyiForbiddenItemError(materialItemId, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (!materialItem || Object.keys(materialItem).length <= 0) return res.json({ ok: false, error: '词缀材料不存在' });
      if (countItemInInventory(player, materialItemId) < materialCount) return res.json({ ok: false, error: '词缀材料数量不足' });
      const result = executeAffixUpgrade(equipment, affixIndex, materialItem, materialCount, mode, affixMode);
      if (!result.ok) return res.json(result);
      consumeItemFromInventory(player, materialItemId, intVal(result.consume_count, materialCount));
      if (result.success) slotData.item = result.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ...result, player });
    });
  });

  router.post('/forging/reroll', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const page = intVal(req.body?.equip_page, -1);
      const slot = intVal(req.body?.equip_slot, -1);
      const expectItemId = intVal(req.body?.expect_item_id, 0);
      const lingItemId = intVal(req.body?.ling_item_id, 0);
      const lockIndices = Array.isArray(req.body?.lock_indices) ? req.body.lock_indices.map(x => intVal(x, -1)).filter(x => x >= 0) : [];
      const slotData = getSlot(player, page, slot);
      if (isExpectedItemMismatch(slotData, expectItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!slotData || !slotData.item) return res.json({ ok: false, error: '目标装备不存在' });
      let equipment = slotData.item;
      if (!isValidEquipType(String(equipment?.type || ''))) {
        const templateItem = getItemById(intVal(equipment?.id, 0));
        if (templateItem && typeof templateItem === 'object' && isValidEquipType(String(templateItem.type || ''))) {
          const fixed = deepClone(equipment);
          fixed.type = String(templateItem.type || fixed.type || '');
          if (!fixed.subtype && templateItem.subtype) fixed.subtype = String(templateItem.subtype);
          equipment = fixed;
        }
      }
      const lingItem = getItemById(lingItemId);
      const forbiddenErr = getBaiyiForbiddenItemError(lingItemId, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (!lingItem || Object.keys(lingItem).length <= 0) return res.json({ ok: false, error: '引灵材料不存在' });
      if (!isValidEquipType(String(equipment?.type || ''))) return res.json({ ok: false, error: '仅支持装备洗练' });
      const zaohuaLockedErr = getZaohuaLockedError(equipment, isZaohuaLockedEquipment);
      if (zaohuaLockedErr) return res.json({ ok: false, error: zaohuaLockedErr });
      const currentAffixes = Array.isArray(equipment.affixes) ? equipment.affixes : [];
      const need = 1 + calculateRerollLockExtraCost(currentAffixes, lockIndices);
      if (countItemInInventory(player, lingItemId) < need) return res.json({ ok: false, error: `引灵材料不足（需要 ${need}）` });
      const affixCap = getPlayerAffixQualityCap(intVal(player.level, 1));
      const result = executeReroll(equipment, lingItem, lockIndices, affixCap);
      if (!result.ok) return res.json(result);
      consumeItemFromInventory(player, lingItemId, intVal(result.consume_count, need));
      slotData.item = result.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ...result, player });
    });
  });

  router.post('/forging/reroll_affix_tier', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });

      const page = intVal(req.body?.equip_page, -1);
      const slot = intVal(req.body?.equip_slot, -1);
      const expectItemId = intVal(req.body?.expect_item_id, 0);
      const affixIndex = intVal(req.body?.affix_index, -1);
      const materialItemId = intVal(req.body?.material_item_id, 0);

      const slotData = getSlot(player, page, slot);
      if (isExpectedItemMismatch(slotData, expectItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!slotData || !slotData.item) return res.json({ ok: false, error: '目标装备不存在' });

      let equipment = slotData.item;
      if (!isValidEquipType(String(equipment?.type || ''))) {
        const templateItem = getItemById(intVal(equipment?.id, 0));
        if (templateItem && typeof templateItem === 'object' && isValidEquipType(String(templateItem.type || ''))) {
          const fixed = deepClone(equipment);
          fixed.type = String(templateItem.type || fixed.type || '');
          if (!fixed.subtype && templateItem.subtype) fixed.subtype = String(templateItem.subtype);
          equipment = fixed;
        }
      }
      if (!isValidEquipType(String(equipment?.type || ''))) return res.json({ ok: false, error: '仅支持装备词缀洗练' });
      const zaohuaLockedErr = getZaohuaLockedError(equipment, isZaohuaLockedEquipment);
      if (zaohuaLockedErr) return res.json({ ok: false, error: zaohuaLockedErr });

      const materialItem = getItemById(materialItemId);
      const forbiddenErr = getBaiyiForbiddenItemError(materialItemId, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (!materialItem || Object.keys(materialItem).length <= 0) return res.json({ ok: false, error: '洗练材料不存在' });
      const materialType = String(materialItem.type || '');
      if (!['material', 'herb', 'medicine'].includes(materialType)) return res.json({ ok: false, error: '洗练材料类型无效' });

      const need = 3;
      if (countItemInInventory(player, materialItemId) < need) return res.json({ ok: false, error: `洗练材料不足（需要 ${need}）` });

      const result = executeAffixTierReroll(equipment, affixIndex, materialItem, need);
      if (!result.ok) return res.json(result);

      consumeItemFromInventory(player, materialItemId, intVal(result.consume_count, need));
      slotData.item = result.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ...result, player });
    });
  });

  router.post('/forging/inherit', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });

      const sourcePage = intVal(req.body?.source_equip_page, -1);
      const sourceSlot = intVal(req.body?.source_equip_slot, -1);
      const targetPage = intVal(req.body?.target_equip_page, -1);
      const targetSlot = intVal(req.body?.target_equip_slot, -1);
      const expectSourceItemId = intVal(req.body?.expect_source_item_id, 0);
      const expectTargetItemId = intVal(req.body?.expect_target_item_id, 0);
      const materialItemId = intVal(req.body?.material_item_id, 0);

      if (sourcePage === targetPage && sourceSlot === targetSlot) {
        return res.json({ ok: false, error: '主装备与被继承装备不能是同一件' });
      }

      const sourceSlotData = getSlot(player, sourcePage, sourceSlot);
      const targetSlotData = getSlot(player, targetPage, targetSlot);
      if (isExpectedItemMismatch(sourceSlotData, expectSourceItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (isExpectedItemMismatch(targetSlotData, expectTargetItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!sourceSlotData || !sourceSlotData.item) return res.json({ ok: false, error: '主装备不存在' });
      if (!targetSlotData || !targetSlotData.item) return res.json({ ok: false, error: '被继承装备不存在' });

      let sourceEquipment = sourceSlotData.item;
      if (!isValidEquipType(String(sourceEquipment?.type || ''))) {
        const tpl = getItemById(intVal(sourceEquipment?.id, 0));
        if (tpl && typeof tpl === 'object' && isValidEquipType(String(tpl.type || ''))) {
          const fixed = deepClone(sourceEquipment);
          fixed.type = String(tpl.type || fixed.type || '');
          if (!fixed.subtype && tpl.subtype) fixed.subtype = String(tpl.subtype);
          sourceEquipment = fixed;
        }
      }
      let targetEquipment = targetSlotData.item;
      if (!isValidEquipType(String(targetEquipment?.type || ''))) {
        const tpl = getItemById(intVal(targetEquipment?.id, 0));
        if (tpl && typeof tpl === 'object' && isValidEquipType(String(tpl.type || ''))) {
          const fixed = deepClone(targetEquipment);
          fixed.type = String(tpl.type || fixed.type || '');
          if (!fixed.subtype && tpl.subtype) fixed.subtype = String(tpl.subtype);
          targetEquipment = fixed;
        }
      }
      if (!isValidEquipType(String(sourceEquipment?.type || ''))) return res.json({ ok: false, error: '主装备不是可继承装备' });
      if (!isValidEquipType(String(targetEquipment?.type || ''))) return res.json({ ok: false, error: '被继承装备不是可继承装备' });
      const sourceLockedErr = getZaohuaLockedError(sourceEquipment, isZaohuaLockedEquipment);
      if (sourceLockedErr) return res.json({ ok: false, error: '主装备已完成造化，无法继承' });
      const targetLockedErr = getZaohuaLockedError(targetEquipment, isZaohuaLockedEquipment);
      if (targetLockedErr) return res.json({ ok: false, error: '被继承装备已完成造化，无法继承' });

      const sourceSubtypeInfo = getInheritSubtypeInfo(sourceEquipment, getItemById, intVal);
      const targetSubtypeInfo = getInheritSubtypeInfo(targetEquipment, getItemById, intVal);
      if (!sourceSubtypeInfo.key) return res.json({ ok: false, error: '主装备子类型缺失，无法继承' });
      if (!targetSubtypeInfo.key) return res.json({ ok: false, error: '被继承装备子类型缺失，无法继承' });
      if (sourceSubtypeInfo.group !== targetSubtypeInfo.group || sourceSubtypeInfo.key !== targetSubtypeInfo.key) {
        const sourceLabel = getInheritSubtypeLabel(sourceSubtypeInfo);
        const targetLabel = getInheritSubtypeLabel(targetSubtypeInfo);
        return res.json({ ok: false, error: `被继承装备必须与主装备同子类型（主装备：${sourceLabel}，被继承装备：${targetLabel}）` });
      }

      const sourceAffixes = [];
      for (const a of Array.isArray(sourceEquipment?.affixes) ? sourceEquipment.affixes : []) {
        if (!a || typeof a !== 'object') continue;
        const stat = String(a.stat || '').trim();
        if (!stat) continue;
        const q = clampi(intVal(a.quality, intVal(a.tier, 1)), 1, 8);
        const t = clampi(intVal(a.tier, q), 1, 8);
        sourceAffixes.push({
          stat,
          quality: q,
          tier: t,
          value: intVal(a.value, 0)
        });
      }
      if (sourceAffixes.length <= 0) return res.json({ ok: false, error: '主装备没有可继承词缀' });

      let requiredTier = 1;
      let requiredCount = 0;
      for (const af of sourceAffixes) {
        requiredTier = Math.max(requiredTier, clampi(intVal(af.quality, 1), 1, 8));
        requiredCount += clampi(intVal(af.tier, 1), 1, 8);
      }
      requiredCount = Math.max(1, requiredCount);

      const materialItem = getItemById(materialItemId);
      const forbiddenErr = getBaiyiForbiddenItemError(materialItemId, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (!materialItem || Object.keys(materialItem).length <= 0) return res.json({ ok: false, error: '继承材料不存在' });
      const materialType = String(materialItem.type || '');
      if (!['material', 'herb', 'medicine'].includes(materialType)) {
        return res.json({ ok: false, error: '继承材料类型无效，仅可使用材料/草药/药材' });
      }
      const materialTier = clampi(intVal(materialItem.quality, 1), 1, 8);
      if (materialTier !== requiredTier) {
        return res.json({ ok: false, error: `材料阶级不匹配：需要${requiredTier}阶材料` });
      }
      if (countItemInInventory(player, materialItemId) < requiredCount) {
        const mName = String(materialItem.name || `物品${materialItemId}`);
        return res.json({ ok: false, error: `继承材料不足：${mName}（需要${requiredCount}个）` });
      }

      const targetResult = applyAffixesToEquipment(targetEquipment, deepClone(sourceAffixes));
      if (!targetResult || !targetResult.ok) {
        return res.json({ ok: false, error: targetResult?.error || '被继承装备词缀覆盖失败' });
      }
      const sourceResult = applyAffixesToEquipment(sourceEquipment, []);
      if (!sourceResult || !sourceResult.ok) {
        return res.json({ ok: false, error: sourceResult?.error || '主装备词缀清空失败' });
      }

      if (!consumeItemFromInventory(player, materialItemId, requiredCount)) {
        return res.json({ ok: false, error: '继承材料扣除失败' });
      }

      sourceSlotData.item = sourceResult.equipment;
      targetSlotData.item = targetResult.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({
        ok: true,
        player,
        required_tier: requiredTier,
        consume_count: requiredCount,
        inherited_affix_count: sourceAffixes.length,
        msg: `继承完成，消耗${requiredTier}阶材料x${requiredCount}`
      });
    });
  });

  router.post('/forging/zaohua', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });

      const page = intVal(req.body?.equip_page, -1);
      const slot = intVal(req.body?.equip_slot, -1);
      const expectItemId = intVal(req.body?.expect_item_id, 0);

      const slotData = getSlot(player, page, slot);
      if (isExpectedItemMismatch(slotData, expectItemId, intVal)) return res.json(makeSlotMismatchResp());
      if (!slotData || !slotData.item) return res.json({ ok: false, error: '目标装备不存在' });

      let equipment = slotData.item;
      if (!isValidEquipType(String(equipment?.type || ''))) {
        const templateItem = getItemById(intVal(equipment?.id, 0));
        if (templateItem && typeof templateItem === 'object' && isValidEquipType(String(templateItem.type || ''))) {
          const fixed = deepClone(equipment);
          fixed.type = String(templateItem.type || fixed.type || '');
          if (!fixed.subtype && templateItem.subtype) fixed.subtype = String(templateItem.subtype);
          equipment = fixed;
        }
      }
      if (!isValidEquipType(String(equipment?.type || ''))) return res.json({ ok: false, error: '仅支持装备造化' });
      const zaohuaLockedErr = getZaohuaLockedError(equipment, isZaohuaLockedEquipment);
      if (zaohuaLockedErr) return res.json({ ok: false, error: zaohuaLockedErr });

      const forbiddenErr = getBaiyiForbiddenItemError(ZAOHUA_ORB_ITEM_ID, getItemById, intVal);
      if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
      if (countItemInInventory(player, ZAOHUA_ORB_ITEM_ID) < 1) {
        const orb = getItemById(ZAOHUA_ORB_ITEM_ID);
        const orbName = String(orb?.name || '造化宝珠');
        return res.json({ ok: false, error: `${orbName}不足` });
      }

      const result = executeZaohua(equipment);
      if (!result || !result.ok) return res.json(result || { ok: false, error: '造化失败' });
      if (!consumeItemFromInventory(player, ZAOHUA_ORB_ITEM_ID, 1)) return res.json({ ok: false, error: '造化宝珠扣除失败' });

      slotData.item = result.equipment;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({
        ok: true,
        player,
        equipment: result.equipment,
        polarity: String(result.polarity || ''),
        effect: String(result.effect || ''),
        msg: `造化完成：${String(result.effect || (result.polarity === 'negative' ? '负向变异' : '正向变异'))}`
      });
    });
  });

  // 刻阵：随机制造（不走配方）
  router.post('/baiyi/array/start', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
      const baiyiJob = player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object' ? player.baiyi.pending_job : null;
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) > 0) {
        const remain = Math.max(0, intVal(baiyiJob.finish_at, 0) - now);
        if (remain > 0) {
          return res.json({ ok: false, pending: true, remaining_sec: remain, error: `百艺制作进行中，剩余${remain}秒` });
        }
        const finishedSubType = String(baiyiJob.sub_type || '');
        const toCave = finishedSubType.indexOf('array_') === 0;
        await settleBackgroundJobsForPlayer(req.accountId, player, now);
        if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
        return res.json({
          ok: true,
          pending: false,
          mailed: !toCave,
          player,
          msg: toCave ? '刻阵已完成，阵盘/阵纹已收纳至洞府阵库' : '制作已完成，产物已发送到系统邮件'
        });
      }

      const arrayType = String(req.body?.array_type || '').trim().toLowerCase();
      if (!['plate', 'rune'].includes(arrayType)) {
        return res.json({ ok: false, error: '制造类型无效' });
      }
      if (arrayType === 'rune') {
        return res.json({ ok: false, error: '阵纹已改为掉落获取：野外按地图阶段0.001%~0.05%概率掉落，或挑战阵法副本' });
      }

      const consumeMap = new Map();
      let spiritStoneCost = 0;
      let totalTime = 45;
      let resultItemId = 0;

      spiritStoneCost = 10000;
      totalTime = 60;
      consumeMap.set(24, 2);   // 黑铁
      consumeMap.set(21, 2);   // 青竹
      consumeMap.set(161, 1);  // 灵墨
      const validArrayPlateIds = getValidArrayPlateItemIds(getItemById, intVal);
      resultItemId = intVal(pickRandomOne(validArrayPlateIds), 0);

      if (resultItemId <= 0) return res.json({ ok: false, error: '阵盘配置异常，请稍后重试' });

      const currentStones = intVal(player.spirit_stones, 0);
      if (currentStones < spiritStoneCost) {
        return res.json({ ok: false, error: `灵石不足（需要${spiritStoneCost}）` });
      }

      for (const [itemId, needCount] of consumeMap.entries()) {
        const forbiddenErr = getBaiyiForbiddenItemError(itemId, getItemById, intVal);
        if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
        if (countItemInInventory(player, itemId) < needCount) {
          const item = getItemById(itemId);
          const name = item && item.name ? item.name : `物品${itemId}`;
          return res.json({ ok: false, error: `材料不足：${name}（需要${needCount}）` });
        }
      }

      for (const [itemId, needCount] of consumeMap.entries()) {
        if (!consumeItemFromInventory(player, itemId, needCount)) {
          return res.json({ ok: false, error: '材料扣除失败' });
        }
      }
      player.spirit_stones = currentStones - spiritStoneCost;

      const resultItem = getItemById(resultItemId);
      if (!resultItem || Object.keys(resultItem).length <= 0) {
        return res.json({ ok: false, error: '随机产物不存在' });
      }
      const resultName = String(resultItem.name || '阵盘');
      const subType = 'array_plate_random';

      player.baiyi.pending_job = {
        job_id: createBaiyiJobId(req.accountId, now),
        type: 'baiyi',
        sub_type: subType,
        start_at: now,
        finish_at: now + totalTime,
        result_name: resultName,
        result: { item_id: resultItemId, item_name: resultName, count: 1 }
      };
      player.baiyi.is_crafting = true;
      player.baiyi.current_recipe = null;
      player.baiyi.sub_type = subType;
      player.baiyi.progress = 0;
      player.baiyi.total_time = totalTime;

      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({
        ok: true,
        pending: true,
        claimed: false,
        player,
        remaining_sec: totalTime,
        finish_at: now + totalTime,
        spirit_stone_cost: spiritStoneCost,
        msg: '已开始刻制阵盘'
      });
    });
  });

  // 百艺：制物/制符/刻阵 共享行动序列
  router.post('/baiyi/craft/start', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
      const baiyiJob = player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object' ? player.baiyi.pending_job : null;
      if (baiyiJob && intVal(baiyiJob.finish_at, 0) > 0) {
        const remain = Math.max(0, intVal(baiyiJob.finish_at, 0) - now);
        if (remain > 0) {
          return res.json({ ok: false, pending: true, remaining_sec: remain, error: `百艺制作进行中，剩余${remain}秒` });
        }
        const finishedSubType = String(baiyiJob.sub_type || '');
        const toCave = finishedSubType.indexOf('array_') === 0;
        await settleBackgroundJobsForPlayer(req.accountId, player, now);
        if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
        return res.json({
          ok: true,
          pending: false,
          mailed: !toCave,
          player,
          msg: toCave ? '刻阵已完成，阵盘/阵纹已收纳至洞府阵库' : '制作已完成，产物已发送到系统邮件'
        });
      }
      const recipeId = intVal(req.body?.recipe_id, 0);
      const batchCount = Math.max(1, intVal(req.body?.batch_count, 1));
      if (recipeId <= 0) return res.json({ ok: false, error: '配方无效' });
      const recipes = getCraftRecipes() || [];
      const recipe = recipes.find(r => intVal(r.id, 0) === recipeId);
      if (!recipe) return res.json({ ok: false, error: '配方不存在' });
      const category = String(recipe.category || 'craft_item');
      if (category === 'array_rune') {
        return res.json({ ok: false, error: '阵纹已改为掉落获取：野外按地图阶段0.001%~0.05%概率掉落，或挑战阵法副本' });
      }
      if (category === 'array_plate') {
        return res.json({ ok: false, error: '阵盘已改为卡片随机制造，请前往“百艺-刻阵”页签操作' });
      }
      const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      for (const ing of ingredients) {
        const itemId = intVal(ing.itemId, 0);
        const need = Math.max(1, intVal(ing.count, 1)) * batchCount;
        const forbiddenErr = getBaiyiForbiddenItemError(itemId, getItemById, intVal);
        if (forbiddenErr) return res.json({ ok: false, error: forbiddenErr });
        if (itemId <= 0) continue;
        if (countItemInInventory(player, itemId) < need) {
          const item = getItemById(itemId);
          const name = item && item.name ? item.name : `物品${itemId}`;
          return res.json({ ok: false, error: `材料不足：${name}（需要${need}）` });
        }
      }
      for (const ing of ingredients) {
        const itemId = intVal(ing.itemId, 0);
        const need = Math.max(1, intVal(ing.count, 1)) * batchCount;
        if (itemId > 0) consumeItemFromInventory(player, itemId, need);
      }
      const resultObj = recipe.result && typeof recipe.result === 'object' ? recipe.result : {};
      const resultItemId = intVal(resultObj.id, 0);
      const resultCount = Math.max(1, intVal(resultObj.count, 1)) * batchCount;
      const resultItem = getItemById(resultItemId);
      const resultName = resultItem && resultItem.name ? resultItem.name : String(recipe.display_name || recipe.name || '物品');
      const baseTime = Math.max(1, intVal(recipe.time, 30));
      const totalTime = baseTime * batchCount;
      player.baiyi.pending_job = {
        job_id: createBaiyiJobId(req.accountId, now),
        type: 'baiyi',
        sub_type: category,
        recipe_id: recipeId,
        start_at: now,
        finish_at: now + totalTime,
        result_name: resultName,
        result: { item_id: resultItemId, item_name: resultName, count: resultCount }
      };
      player.baiyi.is_crafting = true;
      player.baiyi.current_recipe = recipeId;
      player.baiyi.sub_type = category;
      player.baiyi.progress = 0;
      player.baiyi.total_time = totalTime;
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ok: true, pending: true, claimed: false, player, remaining_sec: totalTime, finish_at: now + totalTime });
    });
  });

  router.post('/redeem', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const code = String(req.body?.code || '').trim();
      if (!code) return res.json({ ok: false, error: '请输入兑换码' });
      if (await db.hasAccountRedeemed(req.accountId, code)) return res.json({ ok: false, error: '该兑换码已使用' });
      const rewards = rewardsByCode[code];
      if (!rewards || !Array.isArray(rewards)) return res.json({ ok: false, error: '无效兑换码' });
      for (const r of rewards) {
        if (r.generateSet && r.quality) {
          const setId = String(r.generateSet || '');
          const quality = clampi(intVal(r.quality, 7), 4, 7);
          for (const armorType of equipmentTypesArmor) {
            const piece = generateExEquipment(setId, quality, armorType, maxAffixTier);
            if (piece && Object.keys(piece).length > 0) {
              if (!ops.putItemInInventory(player.inventory, deepClone(piece), 1)) return res.json({ ok: false, error: '背包已满，兑换失败' });
            }
          }
          continue;
        }
        const itemId = intVal(r.itemId, 0);
        const count = Math.max(1, intVal(r.count, 1));
        if (itemId === -1) {
          player.spirit_stones = intVal(player.spirit_stones, 0) + count;
          continue;
        }
        const item = getItemById(itemId);
        if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: `奖励物品不存在：${itemId}` });
        for (let i = 0; i < count; i += 1) {
          if (!ops.putItemInInventory(player.inventory, deepClone(item), 1)) return res.json({ ok: false, error: '背包已满，兑换失败' });
        }
      }
      await db.recordAccountRedemption(req.accountId, code);
      if (!await persistPlayerImmediateOrConflict(req, res, db, player)) return;
      return res.json({ ok: true, player });
    });
  });
}

module.exports = { mountBaiyiRoutes };