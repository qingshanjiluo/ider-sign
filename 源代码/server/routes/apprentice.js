const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const settlementLock = require('../game/settlementLock');
const {
  ensureApprenticeState,
  settleApprentice,
  getApprenticeSummary,
  renameApprentice,
  apprenticeEquip,
  apprenticeUnequip,
  startApprenticeDispatch,
  stopApprenticeDispatch
} = require('../game/apprentice');

router.use(authMiddleware);

async function withAccountLock(req, res, fn) {
  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:apprentice' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    return await fn();
  } catch (err) {
    console.error('[apprentice] 路由异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '服务器内部错误' });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
}

router.get('/status', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  const report = settleApprentice(player, now);
  ensureApprenticeState(player, now);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: getApprenticeSummary(player, now), settle_report: report, player });
}));

router.post('/rename', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  settleApprentice(player, now);
  const result = renameApprentice(player, req.body?.name, now);
  if (!result.ok) return res.json(result);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: result.apprentice, player });
}));

router.post('/equip', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  settleApprentice(player, now);
  const page = Math.floor(Number(req.body?.page ?? 0));
  const slotIndex = Math.floor(Number(req.body?.slot_index ?? 0));
  const result = apprenticeEquip(player, page, slotIndex, now);
  if (!result.ok) return res.json(result);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: result.apprentice, player });
}));

router.post('/unequip', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  settleApprentice(player, now);
  const result = apprenticeUnequip(player, req.body?.slot, now);
  if (!result.ok) return res.json(result);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: result.apprentice, player });
}));

router.post('/dispatch/start', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  settleApprentice(player, now);
  const mapId = Math.floor(Number(req.body?.map_id || 0));
  const targetMode = String(req.body?.target_mode || '');
  const targetValue = String(req.body?.target_value || '');
  const result = startApprenticeDispatch(player, mapId, targetMode, targetValue, now);
  if (!result.ok) return res.json(result);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: result.apprentice, player });
}));

router.post('/dispatch/stop', (req, res) => withAccountLock(req, res, async () => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const now = Math.floor(Date.now() / 1000);
  const result = stopApprenticeDispatch(player, now);
  if (!result.ok) return res.json(result);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, apprentice: result.apprentice, report: result.report, player });
}));

module.exports = router;
