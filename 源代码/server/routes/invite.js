/**
 * 邀请系统 API
 */
const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const { getItemById } = require('../game/dataLoader');
const ops = require('../game/playerOps');
const settlementLock = require('../game/settlementLock');

const REGISTER_HOURS_LIMIT = 12;  // 注册时间≤12小时可绑定
const INVITEE_DAYS_REQUIRED = 3;  // 被邀请人注册满3天
const INVITEE_LEVEL_REQUIRED = 100; // 被邀请人等级>100
const POINTS_PER_INVITEE = 10;

// 邀请商店：item_id -> cost
const INVITE_SHOP = {
  128: 10,   // 雅韵丹
  129: 10,   // 脱凡丹
  130: 10,   // 圣战丹
  131: 10,   // 坤元丹
  132: 10,   // 神木丸
  179: 20,   // 改名卡
  101: 100,  // 万象森罗生灭法
  120: 100,  // 最终一战
  160: 100,  // 万物之形
  168: 100,  // 作者信物
  170: 20    // 作者小信物
};
const INVITE_SHOP_MARKET_LOCK_ITEM_IDS = new Set([128, 129, 130, 131, 132]);

router.use(authMiddleware);

function intVal(v, def = 0) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// GET /invite/info - 获取邀请信息（邀请码、我的邀请人、存储等）
router.get('/info', async (req, res) => {
  const inviter = await db.getOrCreateInviter(req.accountId);
  const binding = await db.getInviteBinding(req.accountId);
  let inviterName = null;
  if (binding) {
    const acc = await db.getAccountById(binding.inviter_account_id);
    inviterName = acc ? acc.username : null;
  }
  const storage = await db.getInviterStorage(req.accountId);
  return res.json({
    ok: true,
    invite_code: inviter?.invite_code || '',
    inviter_name: inviterName,
    stored_stones: storage.stored_stones,
    per_person_stones: storage.per_person_stones,
    invite_points: storage.invite_points
  });
});

// POST /invite/generate - 生成/刷新邀请码（幂等，返回当前码）
router.post('/generate', async (req, res) => {
  const inviter = await db.getOrCreateInviter(req.accountId);
  return res.json({ ok: true, invite_code: inviter.invite_code });
});

function acquireLocks(ids) {
  const ordered = [...new Set(ids)].filter(Number.isFinite).sort((a, b) => a - b);
  const acquired = [];
  for (const id of ordered) {
    const lease = settlementLock.tryAcquire(id, { owner: 'route:invite:multi-lock' });
    if (!lease) {
      for (const a of acquired) settlementLock.release(a.id, a.lease);
      return null;
    }
    acquired.push({ id, lease });
  }
  return acquired;
}

// POST /invite/bind - 绑定邀请码（被邀请人调用）
router.post('/bind', async (req, res) => {
  const code = String(req.body?.invite_code || '').trim().toUpperCase();
  if (!code) return res.json({ ok: false, error: '请输入邀请码' });

  const inviteeId = req.accountId;
  const inviterRow = await db.getInviterByCode(code);
  if (!inviterRow) return res.json({ ok: false, error: '邀请码无效' });
  const inviterId = inviterRow.account_id;
  if (inviterId === inviteeId) return res.json({ ok: false, error: '不能绑定自己的邀请码' });

  const held = acquireLocks([inviteeId, inviterId]);
  if (!held) return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  try {
    const acc = await db.getAccountById(inviteeId);
    if (!acc) return res.json({ ok: false, error: '账号不存在' });
      const createdAt = intVal(acc.created_at, 0);
      // 注册时间异常容错：小于10位（如0或1970年），直接拒绝
      if (createdAt < 1000000000) {
        return res.json({ ok: false, error: '账号注册时间异常，请联系客服' });
      }
      const hoursSinceReg = (nowSec() - createdAt) / 3600;
      if (hoursSinceReg > REGISTER_HOURS_LIMIT) {
        return res.json({ ok: false, error: '注册时间超过12小时，无法绑定邀请码' });
      }
    if (await db.getInviteBinding(inviteeId)) return res.json({ ok: false, error: '你已绑定过邀请人' });

    const inviteePlayer = await db.getPlayerByAccountId(inviteeId);
    if (!inviteePlayer) return res.json({ ok: false, error: '请先创建角色后再绑定邀请码' });

    const storage = await db.getInviterStorage(inviterId);
    const perPerson = intVal(storage.per_person_stones, 0);
    const stored = intVal(storage.stored_stones, 0);
    if (perPerson > 0 && stored < perPerson) {
      return res.json({ ok: false, error: '只恨邀请人财力不足' });
    }

    if (perPerson > 0 && !(await db.deductInviterStones(inviterId, perPerson))) {
      return res.json({ ok: false, error: '只恨邀请人财力不足' });
    }

    await db.createInviteBinding(inviteeId, inviterId, perPerson);
    if (perPerson > 0) {
      inviteePlayer.spirit_stones = intVal(inviteePlayer.spirit_stones, 0) + perPerson;
      await db.savePlayer(inviteeId, 1, inviteePlayer);
    }

    const inviterAcc = await db.getAccountById(inviterId);
    return res.json({
      ok: true,
      inviter_name: inviterAcc ? inviterAcc.username : '',
      stones_granted: perPerson,
      player: perPerson > 0 ? await db.getPlayerByAccountId(inviteeId) : null
    });
  } finally {
    for (const row of held) settlementLock.release(row.id, row.lease);
  }
});

// POST /invite/storage - 邀请人设置存储灵石与每人数量
router.post('/storage', async (req, res) => {
  let stored = Math.max(0, intVal(req.body?.stored_stones, 0));
  const perPerson = Math.max(0, intVal(req.body?.per_person_stones, 0));

  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:invite:storage' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    const player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '无角色' });
    const current = intVal(player.spirit_stones, 0);
    const storage = await db.getInviterStorage(req.accountId);
    const currentStored = intVal(storage.stored_stones, 0);
    const diff = stored - currentStored;
    if (diff > current) return res.json({ ok: false, error: '灵石不足' });
    if (diff > 0) {
      player.spirit_stones = current - diff;
      await db.savePlayer(req.accountId, 1, player);
      await db.updateInviterStorage(req.accountId, stored, perPerson);
    } else if (diff < 0) {
      const toReturn = Math.min(-diff, currentStored);
      if (toReturn > 0) {
        player.spirit_stones = current + toReturn;
        await db.savePlayer(req.accountId, 1, player);
      }
      stored = currentStored - toReturn;
      await db.updateInviterStorage(req.accountId, stored, perPerson);
    } else {
      await db.updateInviterStorage(req.accountId, stored, perPerson);
    }
    return res.json({
      ok: true,
      stored_stones: stored,
      per_person_stones: perPerson,
      player: await db.getPlayerByAccountId(req.accountId)
    });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
});

// GET /invite/invitees - 邀请人查看被邀请人列表
router.get('/invitees', async (req, res) => {
  const list = await db.listInvitees(req.accountId);
  const threeDaysSec = INVITEE_DAYS_REQUIRED * 24 * 3600;
  const rows = [];
  for (const r of list) {
    const acc = await db.getAccountById(r.invitee_account_id);
    const regAt = intVal(acc?.created_at ?? r.created_at ?? 0, 0);
    const p = await db.getPlayerByAccountId(r.invitee_account_id);
    const level = intVal(p?.level, 1);
    const daysSinceReg = (nowSec() - regAt) / 86400;
    const canClaim = daysSinceReg >= INVITEE_DAYS_REQUIRED && level > INVITEE_LEVEL_REQUIRED;
    const claimed = await db.hasClaimedInvitePoints(req.accountId, r.invitee_account_id);
    const sg = r.stones_granted;
    rows.push({
      invitee_account_id: r.invitee_account_id,
      username: r.username,
      bound_at: r.bound_at,
      level,
      days_since_reg: Math.floor(daysSinceReg),
      can_claim: canClaim && !claimed,
      claimed,
      stones_granted: sg,
      can_reissue: sg === null
    });
  }
  return res.json({ ok: true, invitees: rows });
});

// POST /invite/claim_points - 邀请人领取某个被邀请人的积分
router.post('/claim_points', async (req, res) => {
  const inviteeId = intVal(req.body?.invitee_account_id, 0);
  if (inviteeId <= 0) return res.json({ ok: false, error: '参数无效' });

  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:invite:claim-points' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    const list = await db.listInvitees(req.accountId);
    const row = list.find((r) => r.invitee_account_id === inviteeId);
    if (!row) return res.json({ ok: false, error: '该玩家不是你的被邀请人' });
    if (await db.hasClaimedInvitePoints(req.accountId, inviteeId)) {
      return res.json({ ok: false, error: '已领取过该被邀请人的积分' });
    }
    const acc = await db.getAccountById(inviteeId);
    const regAt = intVal(acc?.created_at ?? 0, 0);
    const p = await db.getPlayerByAccountId(inviteeId);
    const level = intVal(p?.level, 1);
    const daysSinceReg = (nowSec() - regAt) / 86400;
    if (daysSinceReg < INVITEE_DAYS_REQUIRED) {
      return res.json({ ok: false, error: '被邀请人注册未满3天' });
    }
    if (level <= INVITEE_LEVEL_REQUIRED) {
      return res.json({ ok: false, error: '被邀请人等级需大于100' });
    }
    await db.claimInvitePoints(req.accountId, inviteeId);
    await db.addInviterPoints(req.accountId, POINTS_PER_INVITEE);
    const storage = await db.getInviterStorage(req.accountId);
    return res.json({ ok: true, points_added: POINTS_PER_INVITEE, invite_points: storage.invite_points });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
});

// POST /invite/reissue - 邀请人对历史未发灵石的被邀请人手动补发
router.post('/reissue', async (req, res) => {
  const inviteeId = intVal(req.body?.invitee_account_id, 0);
  if (inviteeId <= 0) return res.json({ ok: false, error: '参数无效' });
  const inviterId = req.accountId;

  const held = acquireLocks([inviterId, inviteeId]);
  if (!held) return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  try {
    const list = await db.listInvitees(inviterId);
    const row = list.find(r => r.invitee_account_id === inviteeId);
    if (!row) return res.json({ ok: false, error: '该玩家不是你的被邀请人' });
    if (row.stones_granted !== null) {
      return res.json({ ok: false, error: '该被邀请人已发放过灵石，无需补发' });
    }

    const storage = await db.getInviterStorage(inviterId);
    const perPerson = intVal(storage.per_person_stones, 0);
    if (perPerson <= 0) return res.json({ ok: false, error: '请先设置每人灵石数量' });
    const stored = intVal(storage.stored_stones, 0);
    if (stored < perPerson) return res.json({ ok: false, error: '存储灵石不足' });

    if (!(await db.deductInviterStones(inviterId, perPerson))) {
      return res.json({ ok: false, error: '存储灵石不足（并发冲突）' });
    }

    const inviteePlayer = await db.getPlayerByAccountId(inviteeId);
    if (!inviteePlayer) return res.json({ ok: false, error: '被邀请人角色不存在' });
    inviteePlayer.spirit_stones = intVal(inviteePlayer.spirit_stones, 0) + perPerson;
    await db.savePlayer(inviteeId, 1, inviteePlayer);
    await db.updateInviteBindingStones(inviteeId, perPerson);

    const newStorage = await db.getInviterStorage(inviterId);
    return res.json({
      ok: true,
      stones_granted: perPerson,
      stored_stones: newStorage.stored_stones,
      message: `已向 ${row.username || '该玩家'} 补发 ${perPerson} 灵石`
    });
  } finally {
    for (const row of held) settlementLock.release(row.id, row.lease);
  }
});

// GET /invite/shop - 邀请商店列表
router.get('/shop', async (req, res) => {
  const items = [];
  for (const [itemIdStr, cost] of Object.entries(INVITE_SHOP)) {
    const id = intVal(itemIdStr, 0);
    const item = getItemById(id);
    if (item) items.push({ ...item, invite_cost: cost });
  }
  const storage = await db.getInviterStorage(req.accountId);
  return res.json({ ok: true, items, invite_points: storage.invite_points });
});

// POST /invite/shop/buy - 购买
router.post('/shop/buy', async (req, res) => {
  const itemId = intVal(req.body?.item_id, 0);
  const count = Math.max(1, Math.min(99, intVal(req.body?.count, 1)));
  const costEach = INVITE_SHOP[itemId];
  if (costEach == null) return res.json({ ok: false, error: '邀请商店无此物品' });
  const totalCost = costEach * count;

  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:invite:shop-buy' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    const storage = await db.getInviterStorage(req.accountId);
    if (intVal(storage.invite_points, 0) < totalCost) {
      return res.json({ ok: false, error: '邀请积分不足' });
    }
    const item = getItemById(itemId);
    if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '物品不存在' });
    const player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '无角色' });
    const { hasEmptyInventorySlot, inventoryHasItem, deepClone } = require('../game/onlineUtils');
    if (!hasEmptyInventorySlot(player) && !inventoryHasItem(player, itemId)) {
      return res.json({ ok: false, error: '背包已满' });
    }
    const itemToAdd = deepClone(item);
    if (INVITE_SHOP_MARKET_LOCK_ITEM_IDS.has(itemId)) {
      itemToAdd.invite_shop_no_market = true;
    }
    const added = ops.putItemInInventory(player.inventory, itemToAdd, count);
    if (!added) return res.json({ ok: false, error: '背包已满' });
    if (!(await db.deductInvitePoints(req.accountId, totalCost))) {
      return res.json({ ok: false, error: '邀请积分不足（并发冲突，请重试）' });
    }
    await db.savePlayer(req.accountId, 1, player);
    const newStorage = await db.getInviterStorage(req.accountId);
    return res.json({
      ok: true,
      player,
      invite_points: newStorage.invite_points,
      item_name: item.name,
      count,
      cost: totalCost
    });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
});

module.exports = router;
