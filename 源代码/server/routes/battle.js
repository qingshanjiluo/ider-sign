const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const settlementLock = require('../game/settlementLock');
const { getCommandDelay } = require('../game/commandRateLimit');
const { clampRestUntil } = require('../game/battleTiming');
const { isNightmareMap, applyNightmareEnemy, randomEnemyFromMap } = require('../game/battleEncounterFactory');
const { consumeBattleStartTalisman, applyBattleStartTalisman } = require('../game/battleStartEffectsService');
const {
  startBattleSession,
  setAutoRestartIntent,
  pollBattleSession
} = require('../game/battleSessionOrchestrator');
const { executeBattleCommand } = require('../game/battleCommandService');
const { queryBattleState } = require('../game/battleStateService');

const COMMAND_MAX_QUEUE_WAIT_MS = (() => {
  const v = Number(process.env.COMMAND_MAX_QUEUE_WAIT_MS);
  if (Number.isFinite(v) && v >= 0) return Math.min(2000, Math.floor(v));
  return 120;
})();
const BATTLE_START_MAX_QUEUE_WAIT_MS = (() => {
  const v = Number(process.env.BATTLE_START_MAX_QUEUE_WAIT_MS);
  if (Number.isFinite(v) && v >= 0) return Math.min(2000, Math.floor(v));
  return 0;
})();
const BATTLE_POLL_MIN_INTERVAL_MS = (() => {
  const v = Number(process.env.BATTLE_POLL_MIN_INTERVAL_MS);
  if (Number.isFinite(v) && v >= 0) return Math.min(2000, Math.floor(v));
  return 120;
})();
const BATTLE_POLL_CACHE_TTL_MS = (() => {
  const v = Number(process.env.BATTLE_POLL_CACHE_TTL_MS);
  if (Number.isFinite(v) && v >= 50) return Math.min(5000, Math.floor(v));
  return 400;
})();
const BATTLE_POLL_INFLIGHT_RETRY_MS = (() => {
  const v = Number(process.env.BATTLE_POLL_INFLIGHT_RETRY_MS);
  if (Number.isFinite(v) && v >= 20) return Math.min(2000, Math.floor(v));
  return 80;
})();

const _pollInflight = new Set();
const _pollLastAt = new Map();
const _pollCache = new Map();

function _buildPollBusyPayload(accountId, retryAfterMs) {
  const now = Date.now();
  const aid = Number(accountId) || 0;
  const cached = _pollCache.get(aid);
  if (cached && (now - Number(cached.at || 0)) <= BATTLE_POLL_CACHE_TTL_MS) {
    return {
      ...(cached.payload && typeof cached.payload === 'object' ? cached.payload : { ok: true }),
      poll_coalesced: true,
      poll_retry_after_ms: Math.max(0, Math.floor(Number(retryAfterMs) || 0))
    };
  }
  return {
    ok: true,
    active: true,
    events: [],
    poll_coalesced: true,
    poll_retry_after_ms: Math.max(0, Math.floor(Number(retryAfterMs) || 0))
  };
}

setInterval(() => {
  const now = Date.now();
  const staleLastAt = 5 * 60 * 1000;
  const staleCache = Math.max(BATTLE_POLL_CACHE_TTL_MS * 8, 60 * 1000);
  for (const [aid, ts] of _pollLastAt.entries()) {
    if ((now - Number(ts || 0)) > staleLastAt) _pollLastAt.delete(aid);
  }
  for (const [aid, row] of _pollCache.entries()) {
    if ((now - Number(row?.at || 0)) > staleCache) _pollCache.delete(aid);
  }
}, 60 * 1000);

router.use(authMiddleware);
// 与玩家写操作共用账号锁，避免战斗结算与邮件/背包操作并发覆盖
router.use(async (req, res, next) => {
  if (String(req.method || 'GET').toUpperCase() === 'GET') return next();
  let lockLease = null;
  try {
    lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:battle:write' });
  } catch (e) {
    console.error('[battle/lock] acquire error:', e?.message || e);
    return res.status(500).json({ ok: false, error: '服务繁忙，请稍后重试' });
  }
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    settlementLock.releaseAsync(req.accountId, lockLease).catch(() => {});
  };
  res.on('finish', release);
  res.on('close', release);
  next();
});
// POST /battle/start - 开始服务端权威战斗会话
router.post('/start', async (req, res) => {
  try {
  const _delay = getCommandDelay(req.accountId);
  if (_delay > BATTLE_START_MAX_QUEUE_WAIT_MS) {
    return res.json({
      ok: false,
      error: '开始战斗过于频繁，请稍后重试',
      code: 'BATTLE_START_THROTTLED',
      retry_after_ms: _delay
    });
  }
  const resp = await startBattleSession({
    accountId: req.accountId,
    body: req.body,
    helpers: {
      randomEnemyFromMap,
      isNightmareMap,
      applyNightmareEnemy,
      clampRestUntil,
      consumeBattleStartTalisman,
      applyBattleStartTalisman
    }
  });
  return res.json(resp);
  } catch (err) {
    console.error('[battle/start] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '战斗初始化异常' });
  }
});

router.post('/auto_restart', async (req, res) => {
  try {
    const resp = await setAutoRestartIntent({ accountId: req.accountId, body: req.body });
    return res.json(resp);
  } catch (err) {
    console.error('[battle/auto_restart] 异常:', err?.message, err?.stack);
    return res.status(500).json({ ok: false, error: '自动战斗设置异常' });
  }
});

// POST /battle/command - 服务端逐指令推进（服务端控速，变速器无效）
router.post('/command', async (req, res) => {
  try {
  const _delay = getCommandDelay(req.accountId);
  if (_delay > COMMAND_MAX_QUEUE_WAIT_MS) {
    return res.json({
      ok: false,
      error: '操作过于频繁，服务器正在平峰，请稍后重试',
      code: 'COMMAND_THROTTLED',
      retry_after_ms: _delay
    });
  }
  if (_delay > 0) {
    await new Promise(resolve => setTimeout(resolve, _delay));
  }
  await _respondBattleCommand(req, res);
  } catch (err) {
    console.error('[battle/command] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '战斗指令异常' });
  }
});

async function _respondBattleCommand(req, res) {
  try {
  const resp = await executeBattleCommand({ accountId: req.accountId, body: req.body });
  return res.json(resp);
  } catch (err) {
    console.error('[battle/command] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '战斗指令处理异常' });
  }
}

// GET /battle/state/:battleId - 断线重连拉取状态与事件
router.get('/state/:battleId', (req, res) => {
  try {
  const resp = queryBattleState({
    accountId: req.accountId,
    battleId: req.params?.battleId,
    after: req.query?.after
  });
  return res.json(resp);
  } catch (err) {
    console.error('[battle/state] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '战斗状态查询异常' });
  }
});

// GET /battle/poll - 轮询模式拉取服务端推进的事件
router.get('/poll', (req, res) => {
  const aid = Number(req.accountId) || 0;
  const now = Date.now();
  const lastAt = Number(_pollLastAt.get(aid) || 0);
  const sinceLast = now - lastAt;

  if (_pollInflight.has(aid)) {
    return res.json(_buildPollBusyPayload(aid, BATTLE_POLL_INFLIGHT_RETRY_MS));
  }
  if (lastAt > 0 && sinceLast < BATTLE_POLL_MIN_INTERVAL_MS) {
    return res.json(_buildPollBusyPayload(aid, BATTLE_POLL_MIN_INTERVAL_MS - sinceLast));
  }

  _pollInflight.add(aid);
  _pollLastAt.set(aid, now);
  try {
    const resp = pollBattleSession({ accountId: req.accountId, query: req.query });
    _pollCache.set(aid, { at: now, payload: resp });
    return res.json(resp);
  } catch (err) {
    console.error('[battle/poll] 异常:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: '轮询异常' });
  } finally {
    _pollInflight.delete(aid);
  }
});

// 旧接口下线：客户端必须升级到逐指令协议
router.post('/result', (_req, res) => {
  return res.status(426).json({
    ok: false,
    error: '战斗协议已升级，请更新客户端',
    code: 'BATTLE_PROTOCOL_UPGRADE_REQUIRED',
    minVersion: '1.1.0'
  });
});

module.exports = router;
