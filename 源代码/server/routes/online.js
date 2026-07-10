const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const { getItemById, getItems, getEnemies, getDungeonEnemies, getAlchemyRecipes, getCraftRecipes, getTechniques, getSkills, getSectById } = require('../game/dataLoader');
const ops = require('../game/playerOps');
const { settleBackgroundJobsForPlayer } = require('../game/backgroundJobs');
const settlementLock = require('../game/settlementLock');
const {
  intVal, floatVal, clampi, clampf, randf, randiRange, shuffleArray, deepClone, nowSec,
  ensurePlayerInventory, countItemInInventory, consumeItemFromInventory, hasEmptyInventorySlot,
  inventoryHasItem, getSectMemberCounts, getSlot, calculateItemValue, readPositiveIntByKeys
} = require('../game/onlineUtils');
const {
  EQUIPMENT_TYPES_WEAPON, EQUIPMENT_TYPES_ARMOR, CATALYST_ITEM_IDS, MAX_AFFIX_TIER,
  getEffectiveTier, getPlayerRealmQuality, getPlayerAffixQualityCap, getRequiredLevelForItem,
  generateWeapon, generateArmor, generateExEquipment, buildAffixesFromExtraStats,
  executeForging, executeUpgrade, executeAffixUpgrade, executeAffixTierReroll, applyAffixesToEquipment, executeReroll, isValidEquipType, isCatalystItem, canBeForgingMaterial,
  executeZaohua, isZaohuaLockedEquipment, rollEquipmentFromTemplateItem, calculateRerollLockExtraCost
} = require('../game/equipmentGen');
const { mountBaiyiRoutes } = require('./online/baiyiRoutes');
const { mountSectCoreRoutes } = require('./online/sectCoreRoutes');
const { mountSectTaskRoutes, settleKillTaskProgress } = require('./online/sectTaskRoutes');
const { mountSectTreasuryRoutes } = require('./online/sectTreasuryRoutes');
const { mountCaveDiscipleRoutes } = require('./online/caveDiscipleRoutes');

// 兑换码奖励：key=兑换码，value=奖励数组。每项为 { itemId, count } 或 { generateSet, quality }
const REWARDS_BY_CODE = {
  '重生之我在艾德尔修仙669': [
    { generateSet: '劫灭-斗战乾坤', quality: 7 }
  ],
  '我们妙音宗数值就是这么填的': [
    { itemId: -1, count: 100 },
    { itemId: 17, count: 10 }
  ]
};

router.use(authMiddleware);

const SECT_TREASURY_REFRESH_SECONDS = 40 * 60;
const SECT_TREASURY_GOODS_COUNT = 20;
const SECT_BASIC_WEAPON_BY_SECT = {
  1: 11, // 青云剑宗 -> 铁剑
  2: 16, // 太上妙音宗 -> 玉笛（音律）
  3: 12, // 傲骨长河门 -> 精钢刀
  4: 13, // 玄黄门 -> 长枪（长兵）
  5: 14, // 神木派 -> 铁爪（拳爪）
  6: 15, // 烛日派 -> 短弓（弓）
  7: 181  // 浩然学宫 -> 竹杖（节杖）
};
const SECT_TASK_SLOTS = 7;
const SECT_TASK_REFRESH_SECONDS = 600;
const SECT_TASK_DAILY_LIMIT = 15;

async function _withAccountLock(req, res, fn) {
  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:online' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    return await Promise.resolve(fn());
  } catch (err) {
    console.error('[online] _withAccountLock 捕获异常:', err?.message, err?.stack);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
}
mountBaiyiRoutes({
  router,
  withAccountLock: _withAccountLock,
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
  equipmentTypesArmor: EQUIPMENT_TYPES_ARMOR,
  maxAffixTier: MAX_AFFIX_TIER,
  ops,
  rewardsByCode: REWARDS_BY_CODE
});

mountSectCoreRoutes({
  router,
  withAccountLock: _withAccountLock,
  db,
  intVal,
  readPositiveIntByKeys,
  getSectById,
  getSkills,
  getTechniques,
  getItemById,
  getSectMemberCounts,
  countItemInInventory,
  consumeItemFromInventory,
  calculateItemValue
});

mountSectTreasuryRoutes({
  router,
  withAccountLock: _withAccountLock,
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
  sectBasicWeaponBySect: SECT_BASIC_WEAPON_BY_SECT,
  treasuryRefreshSeconds: SECT_TREASURY_REFRESH_SECONDS,
  treasuryGoodsCount: SECT_TREASURY_GOODS_COUNT
});

mountSectTaskRoutes({
  router,
  withAccountLock: _withAccountLock,
  db,
  intVal,
  randiRange,
  getEnemies,
  getPlayerRealmQuality,
  nowSec,
  countItemInInventory,
  consumeItemFromInventory,
  taskSlots: SECT_TASK_SLOTS,
  taskRefreshSeconds: SECT_TASK_REFRESH_SECONDS,
  taskDailyLimit: SECT_TASK_DAILY_LIMIT
});

mountCaveDiscipleRoutes({
  router,
  withAccountLock: _withAccountLock,
  db,
  settleBackgroundJobsForPlayer,
  intVal,
  ensurePlayerInventory,
  getItemById,
  ops,
  deepClone
});

module.exports = { router, settleKillTaskProgress, rollEquipmentFromTemplateItem, getPlayerAffixQualityCap };

