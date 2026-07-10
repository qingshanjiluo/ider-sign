const cave = require('../../game/cave');
const disciple = require('../../game/disciple');
const discipleBattle = require('../../game/discipleBattle');
const battleSessionCache = require('../../game/battleSessionCache');
const { recalcAndAssignCombatStats } = require('../../game/combatUtils');
const wsManager = require('../../ws');

const DISC_BATTLE_API_ENABLED = false; // 传人比拼接口开关，暂时关停
let _discipleBattleHooksInstalled = false;

function _ensureDiscipleBattleHooks(db) {
  if (_discipleBattleHooksInstalled) return;
  discipleBattle.setOnMatchedCallback(async (roomId, accA, accB) => {
    const pA = await db.getPlayerByAccountId(accA);
    const pB = await db.getPlayerByAccountId(accB);
    if (!pA?.disciple || !pB?.disciple) return;
    const state = discipleBattle.createBattleState(pA, pB, accA, accB);
    state.roomId = roomId;
    discipleBattle.setRoomState(roomId, state);
    discipleBattle.scheduleRoomTimeout(roomId);
    wsManager.pushToPlayer(accA, { type: 'disciple_battle_matched', roomId, state, playerIndex: 0 });
    wsManager.pushToPlayer(accB, { type: 'disciple_battle_matched', roomId, state, playerIndex: 1 });
  });

  discipleBattle.setTimeoutCallback(async (roomId) => {
    const state = discipleBattle.handleTimeout(roomId);
    if (!state) return;
    const push = { type: 'disciple_battle_update', roomId, state };
    wsManager.pushToPlayer(state.players[0].accountId, push);
    wsManager.pushToPlayer(state.players[1].accountId, push);
    if (state.phase === 'ended') {
      await discipleBattle.settleBattle(roomId, state, db);
    }
  });

  _discipleBattleHooksInstalled = true;
}

function mountCaveDiscipleRoutes({
  router,
  withAccountLock,
  db,
  settleBackgroundJobsForPlayer,
  intVal,
  ensurePlayerInventory,
  getItemById,
  ops,
  deepClone
}) {
  if (!router || typeof router.use !== 'function') {
    throw new Error('mountCaveDiscipleRoutes: router 参数无效');
  }
  if (typeof withAccountLock !== 'function') {
    throw new Error('mountCaveDiscipleRoutes: withAccountLock 参数无效');
  }

  _ensureDiscipleBattleHooks(db);

  async function settleBaiyiIfNeeded(accountId, player, nowSec) {
    const settled = await settleBackgroundJobsForPlayer(accountId, player, nowSec);
    if (settled && settled.changed) await db.savePlayer(accountId, 1, player);
  }

  // ─── 洞府系统 ───
  router.get('/cave/status', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);
      cave.settleMainFormationServices(player, now);
      const report = cave.settleCaveGathering(player, now);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player), settle_report: report });
    });
  });

  router.post('/cave/start', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);
      const type = String(req.body?.type || '').trim();
      const r = cave.startGathering(player, type);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/stop', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = cave.stopGathering(player);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player), report: r.report, player });
    });
  });

  router.post('/cave/upgrade', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = cave.upgradeCave(player);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player), cost: r.cost, player });
    });
  });

  router.post('/cave/formation/place', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const pieceUid = String(req.body?.piece_uid || '').trim();
      const targetIndex = intVal(req.body?.target_index, -1);
      const r = cave.placeFormationPiece(player, pieceUid, targetIndex);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/pick', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const sourceIndex = intVal(req.body?.source_index, -1);
      const r = cave.pickFormationPiece(player, sourceIndex);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/move', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const fromIndex = intVal(req.body?.from_index, -1);
      const toIndex = intVal(req.body?.to_index, -1);
      const r = cave.moveFormationPiece(player, fromIndex, toIndex);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, swapped: !!r.swapped, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/rotate', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const sourceIndex = intVal(req.body?.source_index, -1);
      const turns = intVal(req.body?.turns, 1);
      const r = cave.rotateFormationPiece(player, sourceIndex, turns);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, rotation: Number(r.rotation || 0), ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/clear', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const r = cave.clearFormationBoard(player);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, moved_count: Number(r.moved_count || 0), ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/decompose_rune', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const pieceUid = String(req.body?.piece_uid || '').trim();
      const r = cave.decomposeFormationRune(player, pieceUid);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, reward: r.reward, player, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/decompose_plate', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const pieceUid = String(req.body?.piece_uid || '').trim();
      const r = cave.decomposeFormationPlate(player, pieceUid);
      if (!r.ok) return res.json(r);

      cave.settleMainFormationServices(player, now, { allowAutoActivate: false });
      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, reward: r.reward, player, ...cave.getCaveStatus(player) });
    });
  });

  router.post('/cave/formation/service/set', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const now = Math.floor(Date.now() / 1000);
      await settleBaiyiIfNeeded(req.accountId, player, now);

      const skillId = String(req.body?.skill_id || '').trim();
      const instanceKey = String(req.body?.instance_key || '').trim();
      const active = !!req.body?.active;
      const r = cave.setMainFormationServiceActive(player, skillId, active, now, instanceKey);
      if (!r.ok) return res.json(r);

      recalcAndAssignCombatStats(player, true);

      await db.savePlayer(req.accountId, 1, player);
      const activeBattle = battleSessionCache.getActiveSessionByAccount(req.accountId);
      if (activeBattle && activeBattle.id) {
        battleSessionCache.deleteSession(String(activeBattle.id));
      }

      res.json({
        ok: true,
        service: { skill_id: skillId, instance_key: String(r.instance_key || instanceKey || ''), active },
        battle_session_invalidated: !!(activeBattle && activeBattle.id),
        player,
        ...cave.getCaveStatus(player)
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  传人系统
  // ══════════════════════════════════════════════════════════════
  router.get('/disciple/status', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = disciple.getDiscipleStatus(player);
      await db.savePlayer(req.accountId, 1, player);
      res.json(r);
    });
  });

  router.post('/disciple/create', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = disciple.createDisciple(player, req.body?.name);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json(r);
    });
  });

  router.post('/disciple/rename', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = disciple.renameDisciple(player, req.body?.name);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json(r);
    });
  });

  router.post('/disciple/equip', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const { slot, page, slotIndex } = req.body || {};
      const r = disciple.equipDisciple(player, slot, intVal(page, 0), intVal(slotIndex, 0));
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple/unequip', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = disciple.unequipDisciple(player, req.body?.slot);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple/send', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const { map_id, material_filter } = req.body || {};
      const r = disciple.sendExpedition(player, intVal(map_id, 0), material_filter);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json(r);
    });
  });

  router.post('/disciple/recall', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = disciple.recallDisciple(player);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  传人比拼（宝可梦画风）
  // ══════════════════════════════════════════════════════════════
  router.use('/disciple-battle', (_req, res, next) => {
    if (!DISC_BATTLE_API_ENABLED) return res.json({ ok: false, error: '传人比拼维护中' });
    next();
  });

  router.get('/disciple-battle/status', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.getBattleStatus(player);
      if (r.ok) await db.savePlayer(req.accountId, 1, player);
      res.json(r);
    });
  });

  router.post('/disciple-battle/draw', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.drawManual(player, req.accountId);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple-battle/equip', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.equipSkill(player, req.body?.slotIndex, req.body?.sourceId);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple-battle/unequip', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.unequipSkill(player, req.body?.slotIndex);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple-battle/shop/buy', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.buyPill(player, req.body?.pillId);
      if (!r.ok) return res.json(r);
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ...r, player });
    });
  });

  router.post('/disciple-battle/points-shop/buy', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const r = discipleBattle.buyPointsShopItem(player, req.body?.itemId);
      if (!r.ok) return res.json(r);
      ensurePlayerInventory(player);
      const results = [];
      for (const drop of r.drops) {
        const tpl = getItemById(drop.id);
        if (!tpl || !tpl.id) continue;
        const added = ops.putItemInInventory(player.inventory, deepClone(tpl), drop.count);
        results.push({ name: drop.name, count: drop.count, added });
      }
      await db.savePlayer(req.accountId, 1, player);
      res.json({ ok: true, disciple_battle: r.disciple_battle, results, player });
    });
  });

  router.post('/disciple-battle/match', async (req, res) => {
    const player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '无角色' });
    const r = discipleBattle.joinMatchQueue(req.accountId, player);
    res.json(r);
  });

  router.post('/disciple-battle/cancel-match', (req, res) => {
    discipleBattle.leaveMatchQueue(req.accountId);
    res.json({ ok: true });
  });

  router.get('/disciple-battle/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = discipleBattle.getRoom(roomId);
    if (!room) return res.json({ ok: false, error: '对战已结束' });
    const state = room.state;
    if (!state) return res.json({ ok: false, error: '对战未就绪' });
    const idx = discipleBattle.getPlayerIndex(state, req.accountId);
    if (idx < 0) return res.json({ ok: false, error: '你不是该对战的参与者' });
    res.json({ ok: true, roomId, state, playerIndex: idx });
  });

  router.post('/disciple-battle/action', (req, res) => {
    return withAccountLock(req, res, async () => {
      const { roomId, skillSourceId } = req.body || {};
      const room = discipleBattle.getRoom(roomId);
      if (!room) return res.json({ ok: false, error: '对战已结束' });
      const state = room.state;
      if (!state || state.phase !== 'choose') return res.json({ ok: false, error: '无法行动' });
      const idx = discipleBattle.getPlayerIndex(state, req.accountId);
      if (idx < 0) return res.json({ ok: false, error: '你不是该对战的参与者' });
      const r = discipleBattle.submitChoice(state, idx, intVal(skillSourceId, 0));
      if (!r.ok) return res.json(r);
      const bothReady = state.choices[0] != null && state.choices[1] != null;
      if (bothReady) {
        discipleBattle.resolveTurn(state);
        const push = { type: 'disciple_battle_update', roomId, state };
        wsManager.pushToPlayer(state.players[0].accountId, push);
        wsManager.pushToPlayer(state.players[1].accountId, push);
        if (state.phase === 'choose') {
          discipleBattle.scheduleRoomTimeout(roomId);
        }
        if (state.phase === 'ended') {
          await discipleBattle.settleBattle(roomId, state, db);
        }
      }
      res.json({ ok: true, state });
    });
  });
}

module.exports = { mountCaveDiscipleRoutes };
