const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { createInitialPlayer } = require('../game/initialPlayer');
const { authMiddleware } = require('../middleware/auth');
const ops = require('../game/playerOps');
const { getMapById, getItemById } = require('../game/dataLoader');
const { recalcAndAssignCombatStats } = require('../game/combatUtils');
const { touchActivity } = require('../game/universalTime');
const { settleBackgroundJobsForPlayer } = require('../game/backgroundJobs');
const settlementLock = require('../game/settlementLock');
const { calculateExpNeeded } = require('../game/exp');
const { settleCaveGathering, settleMainFormationServices } = require('../game/cave');
const { getDiscipleStatus } = require('../game/disciple');
const { ensureState } = require('../game/universalTime');
const playerWriteCache = require('../game/playerWriteCache');
const mysqlShadowCanary = require('../mysqlShadowCanary');

/** 为客户端响应中的 player 补充 max_exp 等展示用字段 */
function enrichPlayerForClient(p) {
  if (!p || typeof p !== 'object') return;
  const lv = Math.floor(Number(p.level) || 1);
  p.max_exp = calculateExpNeeded(lv);
}

router.use(authMiddleware);
// 所有返回 player 的响应统一补充 max_exp
router.use((req, res, next) => {
  const orig = res.json.bind(res);
  res.json = function (body) {
    if (body && body.player) enrichPlayerForClient(body.player);
    return orig(body);
  };
  next();
});
// 玩家写操作统一串行：避免与 sync/离线结算并发覆盖背包、装备等字段
router.use(async (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return next();
  let lockLease = null;
  try {
    lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:player:write' });
  } catch (e) {
    console.error('[player/lock] acquire error:', e?.message || e);
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
// 事件循环让步：在密集同步计算间隙释放控制权，避免阻塞其他请求
const _yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));

const TALENT_RESET_ITEM_ID = 160; // 万物之形
const SPIRIT_ROOT_BAN_THRESHOLD = 106;
const CHEAT_BAN_REASON = '珍爱老冯，远离作弊';
const SYNC_MIN_INTERVAL_MS = 2000;
const SYNC_ABUSE_WINDOW_MS = 60 * 1000;
const SYNC_ABUSE_THRESHOLD = 20;
const SYNC_BLOCK_MS = 10 * 60 * 1000;
const _syncThrottle = new Map();
const _syncHeavyTracker = new Map();
const _syncFastCombatRecalcTracker = new Map();
const _syncAllianceContribCache = new Map();
const _syncDeepMaintTracker = new Map();
const SYNC_HEAVY_INTERVAL_SEC = (() => {
  const v = Number(process.env.PLAYER_SYNC_HEAVY_INTERVAL_SEC || process.env.SYNC_HEAVY_INTERVAL_SEC);
  if (Number.isFinite(v) && v >= 30) return Math.min(24 * 60 * 60, Math.floor(v));
  return 3600;
})();
const SYNC_FAST_COMBAT_RECALC_INTERVAL_SEC = (() => {
  const v = Number(process.env.PLAYER_SYNC_FAST_COMBAT_RECALC_INTERVAL_SEC || process.env.SYNC_FAST_COMBAT_RECALC_INTERVAL_SEC);
  if (Number.isFinite(v) && v >= 10) return Math.min(600, Math.floor(v));
  return 600;
})();
const SYNC_ACTIVITY_PERSIST_INTERVAL_SEC = (() => {
  const v = Number(process.env.PLAYER_SYNC_ACTIVITY_PERSIST_INTERVAL_SEC || process.env.SYNC_ACTIVITY_PERSIST_INTERVAL_SEC);
  if (Number.isFinite(v) && v >= 60) return Math.min(3600, Math.floor(v));
  return 600;
})();
const SYNC_FAST_INCLUDE_ALLIANCE_CONTRIB = (() => {
  const raw = String(
    process.env.PLAYER_SYNC_FAST_INCLUDE_ALLIANCE_CONTRIB || process.env.SYNC_FAST_INCLUDE_ALLIANCE_CONTRIB || '0'
  ).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();
const SYNC_ALLIANCE_CONTRIB_CACHE_TTL_SEC = (() => {
  const v = Number(process.env.SYNC_ALLIANCE_CONTRIB_CACHE_TTL_SEC);
  if (Number.isFinite(v) && v >= 5) return Math.min(300, Math.floor(v));
  return 45;
})();
const SYNC_DEEP_MAINT_INTERVAL_SEC = (() => {
  const v = Number(process.env.PLAYER_SYNC_DEEP_MAINT_INTERVAL_SEC || process.env.SYNC_DEEP_MAINT_INTERVAL_SEC);
  if (Number.isFinite(v) && v >= 60) return Math.min(24 * 60 * 60, Math.floor(v));
  return 6 * 60 * 60;
})();
const SYNC_EQUIPMENT_SANITIZE_ENABLED = (() => {
  // 临时关闭装备属性自动回正，需恢复时可设为 1/true/on。
  const raw = String(
    process.env.PLAYER_SYNC_EQUIPMENT_SANITIZE_ENABLED
    || process.env.SYNC_EQUIPMENT_SANITIZE_ENABLED
    || '0'
  ).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();

async function getAllianceContributionCached(allianceId, accountId, nowSec, forceRefresh = false) {
  const alId = Math.max(0, Math.floor(Number(allianceId) || 0));
  const aid = Math.max(0, Math.floor(Number(accountId) || 0));
  if (alId <= 0 || aid <= 0) return 0;
  const now = Math.max(0, Math.floor(Number(nowSec) || (Date.now() / 1000)));
  const key = `${alId}:${aid}`;
  const hit = _syncAllianceContribCache.get(key);
  if (!forceRefresh && hit && Number(hit.expiresAt) > now) {
    return Math.max(0, Math.floor(Number(hit.value) || 0));
  }
  const value = Math.max(0, Math.floor(Number(await db.getAllianceMemberContribution(alId, aid)) || 0));
  _syncAllianceContribCache.set(key, {
    value,
    expiresAt: now + SYNC_ALLIANCE_CONTRIB_CACHE_TTL_SEC,
    touchedAt: now
  });
  return value;
}

function shouldRunDeepMaintenance(accountId, nowSec, force = false) {
  if (force) return true;
  const aid = Math.max(0, Math.floor(Number(accountId) || 0));
  if (aid <= 0) return false;
  const now = Math.max(0, Math.floor(Number(nowSec) || (Date.now() / 1000)));
  const last = Number(_syncDeepMaintTracker.get(aid) || 0);
  return now - last >= SYNC_DEEP_MAINT_INTERVAL_SEC;
}

function markDeepMaintenance(accountId, nowSec) {
  const aid = Math.max(0, Math.floor(Number(accountId) || 0));
  if (aid <= 0) return;
  const now = Math.max(0, Math.floor(Number(nowSec) || (Date.now() / 1000)));
  _syncDeepMaintTracker.set(aid, now);
}

function isSyncFastModeEnabled() {
  const syncRaw = String(process.env.PLAYER_SYNC_FAST_MODE || process.env.SYNC_FAST_MODE || '').trim().toLowerCase();
  if (syncRaw) return !(syncRaw === '0' || syncRaw === 'false' || syncRaw === 'off' || syncRaw === 'no');
  if (!db.isMysql) return true;
  const mysqlRaw = String(
    process.env.MYSQL_SYNC_FAST_MODE || process.env.MYSQL_FAST_SYNC_MODE || '1'
  ).trim().toLowerCase();
  return mysqlRaw !== '0' && mysqlRaw !== 'false' && mysqlRaw !== 'off' && mysqlRaw !== 'no';
}

function shouldForceHeavySync(req) {
  const q = req?.query || {};
  const byFull = parseOptionalBoolean(q.full);
  if (byFull === true) return true;
  const byMode = String(q.mode || '').trim().toLowerCase();
  if (byMode === 'heavy' || byMode === 'full') return true;
  return false;
}

function shouldPreferFastSync(req) {
  const q = req?.query || {};
  const byFast = parseOptionalBoolean(q.fast);
  if (byFast === true) return true;
  const byMode = String(q.mode || '').trim().toLowerCase();
  if (byMode === 'fast' || byMode === 'light') return true;
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [accountId, state] of _syncThrottle.entries()) {
    const blockedUntil = Number(state?.blockedUntil) || 0;
    const lastSeenAt = Number(state?.lastSeenAt) || 0;
    if (blockedUntil > now) continue;
    if (now - lastSeenAt > Math.max(SYNC_BLOCK_MS, 15 * 60 * 1000)) {
      _syncThrottle.delete(accountId);
    }
  }

  const nowSec = Math.floor(now / 1000);
  const staleSec = Math.max(SYNC_HEAVY_INTERVAL_SEC * 3, 2 * 60 * 60);
  for (const [accountId, ts] of _syncHeavyTracker.entries()) {
    if (nowSec - Number(ts || 0) > staleSec) _syncHeavyTracker.delete(accountId);
  }
  for (const [accountId, ts] of _syncFastCombatRecalcTracker.entries()) {
    if (nowSec - Number(ts || 0) > staleSec) _syncFastCombatRecalcTracker.delete(accountId);
  }

  const contribStaleSec = Math.max(SYNC_ALLIANCE_CONTRIB_CACHE_TTL_SEC * 4, 300);
  for (const [key, row] of _syncAllianceContribCache.entries()) {
    const touchedAt = Number(row?.touchedAt) || 0;
    if (nowSec - touchedAt > contribStaleSec) _syncAllianceContribCache.delete(key);
  }

  const deepMaintStaleSec = Math.max(SYNC_DEEP_MAINT_INTERVAL_SEC * 3, 2 * 24 * 60 * 60);
  for (const [accountId, ts] of _syncDeepMaintTracker.entries()) {
    if (nowSec - Number(ts || 0) > deepMaintStaleSec) _syncDeepMaintTracker.delete(accountId);
  }
}, 5 * 60 * 1000);

const ROOT_KEYS_SCAN = ['metal', 'wood', 'water', 'fire', 'earth'];

/** 检测灵根作弊：单项>106 或 2级以下且总和>106，则封号 */
async function scanSpiritRootCheatAndBan(player, accountId) {
  if (!player || typeof player !== 'object') return null;
  if (typeof db.isCheatScanExempt === 'function' && await db.isCheatScanExempt(accountId)) return false;
  const roots = player.spirit_roots || player.base_spirit_roots || player.original_spirit_roots || {};
  let total = 0;
  for (const k of ROOT_KEYS_SCAN) {
    const v = Math.max(0, Math.floor(Number(roots[k]) || 0));
    if (v > SPIRIT_ROOT_BAN_THRESHOLD) return true; // 单项超标
    total += v;
  }
  const level = Math.max(1, Math.floor(Number(player.level) || 1));
  if (level < 2 && total > SPIRIT_ROOT_BAN_THRESHOLD) return true; // 2级以下且总和超标
  return false;
}

function banAccount(accountId, reason) {
  return db.setAccountBanned(accountId, reason, 0);
}

function buildPlayerStateForClient(player) {
  if (!player || typeof player !== 'object') return null;
  const state = {
    name: String(player.name || ''),
    level: Math.max(1, Math.floor(Number(player.level) || 1)),
    exp: Math.max(0, Math.floor(Number(player.exp) || 0)),
    hp: Math.max(0, Math.floor(Number(player.hp) || 0)),
    max_hp: Math.max(0, Math.floor(Number(player.max_hp) || 0)),
    mp: Math.max(0, Math.floor(Number(player.mp) || 0)),
    max_mp: Math.max(0, Math.floor(Number(player.max_mp) || 0)),
    spirit_stones: Math.max(0, Math.floor(Number(player.spirit_stones) || 0)),
    trial_coins: Math.max(0, Math.floor(Number(player.trial_coins) || 0)),
    league_points: Math.max(0, Math.floor(Number(player.league_points) || 0)),
    league_rating: Math.max(0, Math.floor(Number(player.league_rating) || 1000)),
    current_map_id: Math.max(0, Math.floor(Number(player.current_map_id) || 0)),
    rest_until: Math.max(0, Math.floor(Number(player.rest_until) || 0)),
    auto_battle_enabled: !!player.auto_battle_enabled,
    auto_battle_map_id: Math.max(0, Math.floor(Number(player.auto_battle_map_id || player.current_map_id) || 0)),
    sect_id: Math.max(0, Math.floor(Number(player.sect_id) || 0)),
    alliance_id: Math.max(0, Math.floor(Number(player.alliance_id) || 0))
  };
  if (player.baiyi && typeof player.baiyi === 'object') {
    state.baiyi = {
      pending_job: player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object'
        ? structuredClone(player.baiyi.pending_job)
        : null
    };
  }
  if (player.cave && typeof player.cave === 'object') {
    state.cave = {
      gathering: player.cave.gathering && typeof player.cave.gathering === 'object'
        ? structuredClone(player.cave.gathering)
        : null
    };
  }
  if (player.time_state && typeof player.time_state === 'object') {
    state.time_state = {
      last_activity_at: Math.max(0, Math.floor(Number(player.time_state.last_activity_at) || 0))
    };
  }
  return state;
}

function _cloneSyncPayload(payload) {
  if (payload == null) return payload;
  return structuredClone(payload);
}

function _getSyncThrottleState(accountId) {
  const key = Number(accountId) || 0;
  let state = _syncThrottle.get(key);
  if (!state) {
    state = {
      lastAt: 0,
      lastSeenAt: 0,
      windowStart: 0,
      burstCount: 0,
      blockedUntil: 0,
      lastPayload: null
    };
    _syncThrottle.set(key, state);
  }
  return state;
}

function parseOptionalBoolean(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return null;
}

function _rememberSyncPayload(accountId, payload) {
  const now = Date.now();
  const state = _getSyncThrottleState(accountId);
  state.lastAt = now;
  state.lastSeenAt = now;
  state.lastPayload = _cloneSyncPayload(payload);
}

function _handleSyncThrottle(accountId, res) {
  const now = Date.now();
  const state = _getSyncThrottleState(accountId);
  state.lastSeenAt = now;

  const blockedUntil = Number(state.blockedUntil) || 0;
  if (blockedUntil > now) {
    const retryAfter = blockedUntil - now;
    return res.status(429).json({
      ok: false,
      error: '同步过于频繁，已临时限制该账号请求',
      code: 'SYNC_RATE_LIMITED',
      retry_after_ms: retryAfter
    });
  }

  const lastAt = Number(state.lastAt) || 0;
  const interval = now - lastAt;
  if (lastAt > 0 && interval < SYNC_MIN_INTERVAL_MS) {
    if (now - (Number(state.windowStart) || 0) > SYNC_ABUSE_WINDOW_MS) {
      state.windowStart = now;
      state.burstCount = 0;
    }
    state.burstCount = Math.max(0, Number(state.burstCount) || 0) + 1;
    const retryAfter = Math.max(0, SYNC_MIN_INTERVAL_MS - interval);
    if (state.burstCount >= SYNC_ABUSE_THRESHOLD) {
      state.blockedUntil = now + SYNC_BLOCK_MS;
      state.lastPayload = null;
      console.warn('[sync] accountId=%s blocked for %dms due to spam', accountId, SYNC_BLOCK_MS);
      return res.status(429).json({
        ok: false,
        error: '检测到异常高频同步，账号已被临时限制',
        code: 'SYNC_RATE_LIMITED',
        retry_after_ms: SYNC_BLOCK_MS
      });
    }
    if (state.lastPayload) {
      const cached = _cloneSyncPayload(state.lastPayload);
      if (cached && typeof cached === 'object' && cached.offline_battle_report) {
        cached.offline_battle_report = null;
      }
      cached.sync_throttled = true;
      cached.sync_retry_after_ms = retryAfter;
      return res.json(cached);
    }
    return res.status(429).json({
      ok: false,
      error: '同步过于频繁，请稍后再试',
      code: 'SYNC_TOO_FREQUENT',
      retry_after_ms: retryAfter
    });
  }

  if (now - (Number(state.windowStart) || 0) > SYNC_ABUSE_WINDOW_MS) {
    state.windowStart = now;
    state.burstCount = 0;
  }
  return null;
}

// GET /player/ping - 轻量心跳，仅校验 token 有效性和网络可达
router.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// GET /player/state - 轻量状态同步，不做重结算
router.get('/state', async (req, res) => {
  const data = await db.getPlayerByAccountId(req.accountId);
  if (!data) {
    return res.json({ ok: true, hasCharacter: false, player: null });
  }
  // 并行化独立的异步调用，减少串行等待
  const [isCheater, emailInfo] = await Promise.all([
    scanSpiritRootCheatAndBan(data, req.accountId),
    db.getAccountEmail(req.accountId)
  ]);
  if (isCheater) {
    await banAccount(req.accountId, CHEAT_BAN_REASON);
    return res.json({ ok: false, error: `账号已封禁：${CHEAT_BAN_REASON}` });
  }
  const bsc = require('../game/battleSessionCache');
  const activeBattle = bsc.getActiveSessionByAccount(req.accountId);
  const player = buildPlayerStateForClient(data);
  if (player && player.alliance_id > 0) {
    player.alliance_contribution = await getAllianceContributionCached(player.alliance_id, req.accountId, Math.floor(Date.now() / 1000));
  }
  return res.json({
    ok: true,
    hasCharacter: true,
    player,
    active_battle: activeBattle ? { battleId: String(activeBattle.id || '') } : null,
    email_bound: Number(emailInfo.email_verified) === 1,
    ts: Date.now()
  });
});

// GET /player/sync - 拉取完整玩家数据
// 使用 settlementLock 与离线定时器串行，避免并发结算
router.get('/sync', async (req, res) => {
  const throttled = _handleSyncThrottle(req.accountId, res);
  if (throttled) return throttled;
  const _t0 = Date.now();
  const data = await db.getPlayerByAccountId(req.accountId);
  if (!data) {
    mysqlShadowCanary.probePlayerSync(req.accountId, false);
    const payload = { ok: true, hasCharacter: false, player: null };
    _rememberSyncPayload(req.accountId, payload);
    return res.json(payload);
  }
  if (await scanSpiritRootCheatAndBan(data, req.accountId)) {
    await banAccount(req.accountId, CHEAT_BAN_REASON);
    return res.json({ ok: false, error: `账号已封禁：${CHEAT_BAN_REASON}` });
  }

  const bsc = require('../game/battleSessionCache');
  const nowSec = Math.floor(Date.now() / 1000);
  const activeBattle = bsc.getActiveSessionByAccount(req.accountId);
  const emailInfo = await db.getAccountEmail(req.accountId);

  const buildSyncPayload = async (player, {
    offlineBattleReport = null,
    syncFastMode = false,
    heavySettled = false,
    lockFallback = false,
    heavyReason = '',
    deepMaintenanceRun = false
  } = {}) => {
    const alId = Math.floor(Number(player?.alliance_id) || 0);
    if (alId > 0 && (!syncFastMode || SYNC_FAST_INCLUDE_ALLIANCE_CONTRIB)) {
      player.alliance_contribution = await getAllianceContributionCached(alId, req.accountId, nowSec, !syncFastMode);
    }
    const payload = {
      ok: true,
      hasCharacter: true,
      player,
      offline_battle_report: offlineBattleReport,
      active_battle: activeBattle ? { battleId: String(activeBattle.id || '') } : null,
      email_bound: Number(emailInfo.email_verified) === 1,
      ts: Date.now(),
      sync_fast_mode: !!syncFastMode,
      sync_heavy_settled: !!heavySettled,
      sync_deep_maintenance_run: !!deepMaintenanceRun
    };
    if (syncFastMode) {
      const lastHeavyAt = Number(_syncHeavyTracker.get(Number(req.accountId) || 0) || 0);
      const dueIn = Math.max(0, SYNC_HEAVY_INTERVAL_SEC - Math.max(0, nowSec - lastHeavyAt));
      payload.sync_heavy_due_in_sec = dueIn;
      payload.sync_heavy_interval_sec = SYNC_HEAVY_INTERVAL_SEC;
      payload.sync_heavy_reason = String(heavyReason || 'periodic');
    }
    if (lockFallback) payload.sync_heavy_lock_fallback = true;
    return payload;
  };

  const runFastSync = async (player, reason = 'periodic') => {
    ensureState(player);
    const buffsBefore = player.timed_buffs && typeof player.timed_buffs === 'object' && !Array.isArray(player.timed_buffs)
      ? Object.keys(player.timed_buffs).length
      : 0;
    const allianceSpiritBefore = player.spirit_pool_buff ? JSON.stringify(player.spirit_pool_buff) : '';
    const allianceEnlightBefore = `${Math.floor(Number(player.enlightenment_buff_expires_at) || 0)}:${Number(player.enlightenment_buff_pct) || 0}`;
    ops.cleanupTimedBuffs(player);
    const sanitizedFast = ops.sanitizeExpBuffOnLogin(player);
    ops.cleanupAllianceBuffs(player);
    const buffsAfter = player.timed_buffs && typeof player.timed_buffs === 'object' && !Array.isArray(player.timed_buffs)
      ? Object.keys(player.timed_buffs).length
      : 0;
    const allianceSpiritAfter = player.spirit_pool_buff ? JSON.stringify(player.spirit_pool_buff) : '';
    const allianceEnlightAfter = `${Math.floor(Number(player.enlightenment_buff_expires_at) || 0)}:${Number(player.enlightenment_buff_pct) || 0}`;
    const buffsChanged = buffsAfter !== buffsBefore
      || allianceSpiritAfter !== allianceSpiritBefore
      || allianceEnlightAfter !== allianceEnlightBefore
      || sanitizedFast;
    const offlineProjection = bsc.settleOfflineStatProjection(req.accountId, player, nowSec);
    // 领取离线战报改为“保存成功后再 ack”，避免先清后存导致奖励丢失。
    const offlineBattleReport = bsc.getOfflineReport(req.accountId);
    const prevActivity = Number(player.time_state?.last_activity_at) || 0;
    const activityPersistDue = (nowSec - prevActivity) >= SYNC_ACTIVITY_PERSIST_INTERVAL_SEC;
    touchActivity(player, nowSec);
    const aid = Number(req.accountId) || 0;
    const lastFastRecalcAt = Number(_syncFastCombatRecalcTracker.get(aid) || 0);
    const shouldRecalcCombat = nowSec - lastFastRecalcAt >= SYNC_FAST_COMBAT_RECALC_INTERVAL_SEC;
    if (shouldRecalcCombat) {
      await _yieldEventLoop();
      recalcAndAssignCombatStats(player, true);
      _syncFastCombatRecalcTracker.set(aid, nowSec);
    }
    const shouldSave = shouldRecalcCombat
      || !!offlineBattleReport
      || !!(offlineProjection && offlineProjection.applied)
      || buffsChanged;
    if (shouldSave) {
      // 重新读取 writeCache 中最新版本，将 fast sync 的增量改动合并上去，
      // 避免用请求开始时的旧 clone 覆盖并发写入（邮件领取、战斗结算等）。
      const freshPlayer = await db.getPlayerByAccountId(req.accountId);
      if (freshPlayer) {
        if (player.time_state) freshPlayer.time_state = player.time_state;
        if (player.timed_buffs !== undefined) freshPlayer.timed_buffs = player.timed_buffs;
        if (player.spirit_pool_buff !== undefined) freshPlayer.spirit_pool_buff = player.spirit_pool_buff;
        if (player.enlightenment_buff_expires_at !== undefined) freshPlayer.enlightenment_buff_expires_at = player.enlightenment_buff_expires_at;
        if (player.enlightenment_buff_pct !== undefined) freshPlayer.enlightenment_buff_pct = player.enlightenment_buff_pct;
        if (player.exp_buff_until !== undefined) freshPlayer.exp_buff_until = player.exp_buff_until;
        if (shouldRecalcCombat) {
          // 属性重算依赖完整对象，需要在 fresh 上重新计算
          recalcAndAssignCombatStats(freshPlayer, true);
        }
        if (offlineProjection && offlineProjection.applied) {
          // 离线统计投影会修改背包/阵法仓库与异常收益债务，
          // 这里必须合并回 fresh，避免出现“战报有掉落但未入包”。
          freshPlayer.exp = player.exp;
          freshPlayer.spirit_stones = player.spirit_stones;
          if (player.inventory !== undefined) freshPlayer.inventory = player.inventory;
          if (player.cave !== undefined) freshPlayer.cave = player.cave;
          if (Object.prototype.hasOwnProperty.call(player, 'abnormal_gain_repay_exp')) {
            freshPlayer.abnormal_gain_repay_exp = player.abnormal_gain_repay_exp;
          } else {
            delete freshPlayer.abnormal_gain_repay_exp;
          }
          if (Object.prototype.hasOwnProperty.call(player, 'abnormal_gain_repay_spirit')) {
            freshPlayer.abnormal_gain_repay_spirit = player.abnormal_gain_repay_spirit;
          } else {
            delete freshPlayer.abnormal_gain_repay_spirit;
          }
        }
        const saveRet = await db.savePlayerImmediate(req.accountId, 1, freshPlayer);
        if (saveRet && saveRet.conflict) {
          return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
        }
        player = freshPlayer;
      } else {
        const saveRet = await db.savePlayerImmediate(req.accountId, 1, player);
        if (saveRet && saveRet.conflict) {
          return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
        }
      }
      if (offlineBattleReport) bsc.ackOfflineReport(req.accountId, offlineBattleReport);
    } else if (activityPersistDue) {
      await db.updatePlayerLastActivity(req.accountId, nowSec);
    }
    bsc.deactivateOfflineStatMode(req.accountId, nowSec);
    const payload = await buildSyncPayload(player, {
      offlineBattleReport,
      syncFastMode: true,
      heavyReason: reason
    });
    mysqlShadowCanary.probePlayerSync(req.accountId, true);
    _rememberSyncPayload(req.accountId, payload);
    return res.json(payload);
  };

  const fastModeEnabled = isSyncFastModeEnabled();
  const forceHeavy = shouldForceHeavySync(req);
  const forceFast = shouldPreferFastSync(req);
  const aid = Number(req.accountId) || 0;
  const lastHeavyAt = Number(_syncHeavyTracker.get(aid) || 0);
  const heavyDue = nowSec - lastHeavyAt >= SYNC_HEAVY_INTERVAL_SEC;
  const shouldHeavySync = !forceFast && (forceHeavy || !fastModeEnabled || heavyDue);

  // 启动惊群保护：重启后首次请求用快同步立即回复，下一次再做重同步
  // 避免所有蓄积玩家同时触发 heavy sync 阻塞主线程
  if (shouldHeavySync && !forceHeavy && lastHeavyAt === 0 && fastModeEnabled) {
    // 标记一个较短的过期时间，让 30 秒后的下一次 sync 触发 heavy
    _syncHeavyTracker.set(aid, nowSec - SYNC_HEAVY_INTERVAL_SEC + 30);
    return await runFastSync(data, 'cold_start_deferred');
  }

  if (!shouldHeavySync) return await runFastSync(data, 'skip_heavy');

  const lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:player:sync-heavy' });
  if (!lockLease) {
    const latest = await db.getPlayerByAccountId(req.accountId) || data;
    ensureState(latest);
    ops.cleanupTimedBuffs(latest);
    ops.sanitizeExpBuffOnLogin(latest);
    ops.cleanupAllianceBuffs(latest);
    const payload = await buildSyncPayload(latest, {
      syncFastMode: true,
      lockFallback: true,
      heavyReason: 'lock_busy'
    });
    _rememberSyncPayload(req.accountId, payload);
    mysqlShadowCanary.probePlayerSync(req.accountId, true);
    return res.json(payload);
  }
  try {
    const working = await db.getPlayerByAccountId(req.accountId) || data;
    const runDeepMaintenance = shouldRunDeepMaintenance(req.accountId, nowSec, forceHeavy);

    ensureState(working);

    // 混合离线模式：先将统计阶段推导收益入账，再统一读取并清空离线战报。
    const offlineProjection = bsc.settleOfflineStatProjection(req.accountId, working, nowSec);

    // 离线战报：由 gameLoop 后台持续推进累计，保存成功后再确认扣减。
    const offlineBattleReport = bsc.getOfflineReport(req.accountId);

    let syncDirty = !!offlineBattleReport || !!(offlineProjection && offlineProjection.applied);
    const prevActivity = Number(working.time_state?.last_activity_at) || 0;
    const activityPersistDue = (nowSec - prevActivity) >= SYNC_ACTIVITY_PERSIST_INTERVAL_SEC;
    if (!syncDirty) {
      const pendingJob = working.baiyi?.pending_job;
      const hasMaturingJob = pendingJob && Number(pendingJob.finish_at) > 0 && Number(pendingJob.finish_at) <= nowSec;
      const hasGathering = !!(working.cave?.gathering);
      const hasBuffs = !!(working.timed_buffs
        && typeof working.timed_buffs === 'object'
        && !Array.isArray(working.timed_buffs)
        && Object.keys(working.timed_buffs).length > 0);
      if (hasMaturingJob || hasGathering || hasBuffs) syncDirty = true;
    }
    touchActivity(working, nowSec);
    await settleBackgroundJobsForPlayer(req.accountId, working, nowSec);
    settleCaveGathering(working, nowSec);
    const mainServiceResult = settleMainFormationServices(working, nowSec, { allowAutoActivate: true });
    if (mainServiceResult.changed) syncDirty = true;
    const discResult = getDiscipleStatus(working);
    if (discResult.auto_delivered || discResult.settled) syncDirty = true;

    // 让步事件循环，让排队中的轻量请求（如 /state）有机会处理
    await _yieldEventLoop();

    ops.grantTalentPointsForLevel(working);
    ops.cleanupTimedBuffs(working);
    if (ops.sanitizeExpBuffOnLogin(working)) syncDirty = true;
    ops.cleanupAllianceBuffs(working);
    if (runDeepMaintenance) {
      ops.stripInvalidEquipment(working, {
        keepEquipped: true,
        levelAllowance: Math.max(0, Number(working._equip_level_allowance) || 0)
      });
      // 深度维护装备校验较重，再次让步
      await _yieldEventLoop();
      if (SYNC_EQUIPMENT_SANITIZE_ENABLED) {
        const affixSanitize = ops.sanitizeEquipmentAffixesByQualityTier(working);
        if (affixSanitize.changed) {
          syncDirty = true;
          console.log('[sanitize] 装备属性回正 accountId=%s items=%d affixes=%d white_stats=%d',
            req.accountId,
            Number(affixSanitize.changedItems) || 0,
            Number(affixSanitize.correctedAffixes) || 0,
            Number(affixSanitize.correctedWhiteStats) || 0);
        }
      }
      markDeepMaintenance(req.accountId, nowSec);
    }
    ops.stripInvalidSectSkills(working);
    ops.cleanupOrphanedSkillCooldowns(working);
    ops.ensureSkillPresets(working);

    // 属性重算是最重的同步计算，计算前让步
    await _yieldEventLoop();
    recalcAndAssignCombatStats(working, true);

    if (syncDirty) {
      const saveRet = await db.savePlayerImmediate(req.accountId, 1, working);
      if (saveRet && saveRet.conflict) {
        return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
      }
      if (offlineBattleReport) bsc.ackOfflineReport(req.accountId, offlineBattleReport);
    } else if (activityPersistDue) {
      await db.updatePlayerLastActivity(req.accountId, nowSec);
    }
    bsc.deactivateOfflineStatMode(req.accountId, nowSec);
    _syncHeavyTracker.set(Number(req.accountId) || 0, nowSec);
    const _t = Date.now() - _t0;
    console.log('[sync] accountId=%s took %dms heavy=%s deep=%s', req.accountId, _t, shouldHeavySync ? 'yes' : 'no', runDeepMaintenance ? 'yes' : 'no');
    const payload = await buildSyncPayload(working, {
      offlineBattleReport,
      syncFastMode: false,
      heavySettled: true,
      deepMaintenanceRun: runDeepMaintenance
    });
    mysqlShadowCanary.probePlayerSync(req.accountId, true);
    _rememberSyncPayload(req.accountId, payload);
    return res.json(payload);
  } finally {
    await settlementLock.releaseAsync(req.accountId, lockLease);
  }
});

// POST /player/create - 创建角色
// 安全：服务端严格校验五灵根，防止抓包篡改（如 9999 全满）
const ROOT_KEYS = ['metal', 'wood', 'water', 'fire', 'earth'];
const SPIRIT_ROOTS_TOTAL = 100;
const SPIRIT_ROOT_MAX_PER = 100;

function validateAndNormalizeSpiritRoots(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: true, roots: { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 } };
  }
  const roots = {};
  let total = 0;
  for (const k of ROOT_KEYS) {
    const v = Math.max(0, Math.min(SPIRIT_ROOT_MAX_PER, Math.floor(Number(raw[k]) || 0)));
    roots[k] = v;
    total += v;
  }
  if (total !== SPIRIT_ROOTS_TOTAL) {
    return { ok: false, error: `五灵根总和必须为 ${SPIRIT_ROOTS_TOTAL} 点` };
  }
  return { ok: true, roots };
}

router.post('/create', async (req, res) => {
  try {
    const acc = await db.getAccountById(req.accountId);
    if (!acc) {
      return res.status(401).json({ ok: false, error: '登录已失效，请重新登录', code: 'ACCOUNT_NOT_FOUND' });
    }
    const existing = await db.getPlayerByAccountId(req.accountId);
    if (existing) {
      return res.json({ ok: false, error: '已有角色' });
    }
    const { spirit_roots, name: rawName } = req.body || {};
    const rootsResult = validateAndNormalizeSpiritRoots(spirit_roots);
    if (!rootsResult.ok) return res.json({ ok: false, error: rootsResult.error });
    const name = (typeof rawName === 'string' ? rawName : (rawName != null ? String(rawName) : '')).trim();
    if (!name || name.length < 1) {
      return res.json({ ok: false, error: '请输入角色名称' });
    }
    if (name.length > 30) {
      return res.json({ ok: false, error: '角色名不能超过30个字符' });
    }
    if (await db.isPlayerNameTaken(name)) {
      return res.json({ ok: false, error: '该角色名已被使用' });
    }
    let player;
    try {
      player = createInitialPlayer(rootsResult.roots, name);
    } catch (e) {
      console.error('[player/create] createInitialPlayer 异常:', e?.message, e?.stack);
      throw e;
    }
    try {
      const saveRet = await db.savePlayerImmediate(req.accountId, 1, player, { allowInsert: true });
      if (saveRet?.conflict) {
        return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
      }
      if (saveRet?.accountMissing) {
        return res.status(401).json({ ok: false, error: '登录已失效，请重新登录', code: 'ACCOUNT_NOT_FOUND' });
      }
      if (saveRet?.missing) {
        return res.status(409).json({ ok: false, error: '角色创建失败，请重试' });
      }
    } catch (e) {
      console.error('[player/create] savePlayer 异常 accountId=%s:', req.accountId, e?.message, e?.stack);
      throw e;
    }
    return res.json({ ok: true, player });
  } catch (e) {
    console.error('[player/create] 创建角色异常:', e?.message, e?.stack);
    const msg = String(e?.message || '');
    if (msg.includes('FOREIGN KEY') || msg.includes('SQLITE_CONSTRAINT_FOREIGNKEY')) {
      return res.status(401).json({ ok: false, error: '登录已失效，请退出重新登录', code: 'ACCOUNT_NOT_FOUND' });
    }
    return res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});

// POST /player/save - 已废弃：服务端为权威数据源，不接受客户端推送的玩家数据
// 玩家数据仅通过 create/level_up/breakthrough/equip/unequip/use_item/battle_result 更新
router.post('/save', (req, res) => {
  res.json({ ok: true });  // 返回成功，但不写入任何客户端提交的数据
});

// POST /player/agreement_seen - 用户已阅读游戏声明
router.post('/agreement_seen', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  player.agreement_seen = true;
  await db.savePlayer(req.accountId, 1, player);
  // 原子更新写缓存，防止并发 savePlayer 用旧数据覆盖掉 agreement_seen
  const pwc = require('../game/playerWriteCache');
  pwc.patchCached(req.accountId, p => { p.agreement_seen = true; return p; });
  res.json({ ok: true, player });
});

// POST /player/level_up - 升级（服务端运算）
router.post('/level_up', async (req, res) => {
  const _t0 = Date.now();
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const r = ops.levelUp(player);
  if (!r.ok) return res.json(r);
  r.player._combat_dirty = true;
  {
    const saveRet = await db.savePlayerImmediate(req.accountId, 1, r.player);
    if (saveRet && saveRet.conflict) {
      return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
    }
  }
  const _t = Date.now() - _t0;
  console.log('[level_up] accountId=%s took %dms', req.accountId, _t);
  res.json({ ok: true, player: r.player });
});

// POST /player/breakthrough - 突破（服务端运算）
router.post('/breakthrough', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const r = ops.breakthrough(player);
  if (!r.ok) return res.json(r);
  r.player._combat_dirty = true;
  const saveRet = await db.savePlayerImmediate(req.accountId, 1, r.player);
  if (saveRet && saveRet.conflict) {
    return res.status(409).json({ ok: false, error: '数据繁忙，请稍后重试' });
  }
  return res.json({ ok: true, player: r.player, success: r.success, penalty: r.penalty });
});

// POST /player/equip - 装备（服务端运算）
router.post('/equip', async (req, res) => {
  const _t0 = Date.now();
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const mainServiceResult = settleMainFormationServices(player, Math.floor(Date.now() / 1000), { allowAutoActivate: true });
  const { page, slot_index: slotIndex, expect_item_id: expectId } = req.body || {};
  const pg = Math.floor(Number(page));
  const si = Math.floor(Number(slotIndex));
  const eid = Number(expectId || 0);
  if (eid > 0) {
    const slot = ops.getSlotItem(player, pg, si);
    if (!slot || Number(slot.id || 0) !== eid) {
      return res.json({ ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' });
    }
  }
  const r = ops.equip(player, pg, si);
  if (!r.ok) {
    if (mainServiceResult.changed) await db.savePlayer(req.accountId, 1, player);
    return res.json(r);
  }
  recalcAndAssignCombatStats(r.player, true);
  await db.savePlayer(req.accountId, 1, r.player);
  const _t = Date.now() - _t0;
  console.log('[equip] accountId=%s took %dms', req.accountId, _t);
  res.json({ ok: true, player: r.player });
});

// POST /player/unequip - 卸下装备（服务端运算）
router.post('/unequip', async (req, res) => {
  const _t0 = Date.now();
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const { slot } = req.body || {};
  const r = ops.unequip(player, String(slot));
  if (!r.ok) return res.json(r);
  recalcAndAssignCombatStats(r.player, true);
  await db.savePlayer(req.accountId, 1, r.player);
  const _t = Date.now() - _t0;
  console.log('[unequip] accountId=%s took %dms', req.accountId, _t);
  res.json({ ok: true, player: r.player });
});

// POST /player/use_item - 使用物品（服务端运算）
router.post('/use_item', async (req, res) => {
  let player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const { page, slot_index: slotIndex, count, expect_item_id: expectId, use_options: useOptionsRaw } = req.body || {};
  const pg = Math.floor(Number(page));
  const si = Math.floor(Number(slotIndex));
  const eid = Number(expectId || 0);
  const useOptions = (useOptionsRaw && typeof useOptionsRaw === 'object' && !Array.isArray(useOptionsRaw)) ? useOptionsRaw : null;

  const verifyExpectItem = (targetPlayer) => {
    if (eid <= 0) return true;
    const slot = ops.getSlotItem(targetPlayer, pg, si);
    return !!(slot && Number(slot.id || 0) === eid);
  };

  if (!verifyExpectItem(player)) {
    return res.json({ ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' });
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = ops.useItem(player, pg, si, Math.floor(Math.max(1, Number(count) || 1)), useOptions);
    if (!r.ok) return res.json(r);
    r.player._combat_dirty = true;
    ops.sortInventory(r.player);

    const saveRet = await db.savePlayerImmediate(req.accountId, 1, r.player);
    if (!saveRet || !saveRet.conflict) {
      return res.json({ ok: true, player: r.player, msg: r.msg, used_count: Math.max(1, Number(r.used_count) || 1) });
    }

    // 并发写冲突：重读最新玩家并重放一次 useItem，避免“返回成功但未落盘”。
    player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '无角色' });
    if (!verifyExpectItem(player)) {
      return res.json({ ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' });
    }
  }

  return res.json({ ok: false, error: '数据繁忙，请稍后重试' });
});

// POST /player/inventory/sort - 背包整理（紧凑+排序）
router.post('/inventory/sort', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  ops.sortInventory(player);
  await db.savePlayer(req.accountId, 1, player);
  res.json({ ok: true, player });
});

// POST /player/inventory/lock - 锁定/解锁背包装备（锁定后不可回收/分解/出售）
router.post('/inventory/lock', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });

  const page = Math.floor(Number(req.body?.page));
  const slotIndex = Math.floor(Number(req.body?.slot_index));
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(slotIndex) || slotIndex < 0) {
    return res.json({ ok: false, error: '锁定槽位参数无效' });
  }

  const hasLockedParam = req.body && Object.prototype.hasOwnProperty.call(req.body, 'locked');
  const lockedVal = parseOptionalBoolean(req.body?.locked);
  if (hasLockedParam && lockedVal == null) {
    return res.json({ ok: false, error: 'locked 参数无效' });
  }

  const r = ops.setEquipmentLock(player, page, slotIndex, hasLockedParam ? lockedVal : null);
  if (!r.ok) return res.json(r);
  ops.sortInventory(player);
  await db.savePlayer(req.accountId, 1, player);
  return res.json({ ok: true, player, locked: !!r.locked });
});

// POST /player/sell_item - 出售物品给系统回收（获得灵石）
router.post('/sell_item', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const page = Math.floor(Number(req.body?.page ?? 0));
  const slotIndex = Math.floor(Number(req.body?.slot_index ?? 0));
  const count = Math.max(1, Math.floor(Number(req.body?.count ?? 1)));
  const expectItemId = Number(req.body?.expect_item_id || 0);
  if (expectItemId > 0) {
    const slot = ops.getSlotItem(player, page, slotIndex);
    if (!slot || Number(slot.id || 0) !== expectItemId) {
      return res.json({ ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' });
    }
  }
  const r = ops.sellItem(player, page, slotIndex, count);
  if (!r.ok) return res.json(r);
  ops.sortInventory(r.player);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player, spirit_stones: r.spirit_stones, item_name: r.item_name, count: r.count });
});

// POST /player/rename - 使用改名卡修改角色名
const RENAME_CARD_ID = 179;
router.post('/rename', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const newName = (typeof req.body?.name === 'string' ? req.body.name : '').trim();
  if (!newName || newName.length < 1) return res.json({ ok: false, error: '请输入新角色名' });
  if (newName.length > 30) return res.json({ ok: false, error: '角色名不能超过30个字符' });
  if (newName === player.name) return res.json({ ok: false, error: '新名称与当前名称相同' });
  if (await db.isPlayerNameTaken(newName)) return res.json({ ok: false, error: '该角色名已被使用' });
  const inv = player.inventory || [];
  let found = false;
  for (let p = 0; p < inv.length; p++) {
    const page = inv[p];
    if (!Array.isArray(page)) continue;
    for (let s = 0; s < page.length; s++) {
      const slot = page[s];
      if (!slot || !slot.item) continue;
      if (Number(slot.item.id) === RENAME_CARD_ID) {
        const cnt = Number(slot.count) || 1;
        if (cnt <= 1) page[s] = null; else slot.count = cnt - 1;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return res.json({ ok: false, error: '背包中没有改名卡' });
  player.name = newName;
  ops.sortInventory(player);
  await db.savePlayer(req.accountId, 1, player);
  res.json({ ok: true, player, msg: `角色已改名为「${newName}」` });
});

// POST /player/decompose_equipment - 分解装备（支持批量），30%几率获得对应阶级催化剂（1阶出2阶催化剂）
router.post('/decompose_equipment', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  let slots = req.body?.slots;
  if (Array.isArray(slots) && slots.length > 0) {
    const results = [];
    let working = player;
    for (const s of slots) {
      const page = Math.floor(Number(s?.page ?? s?.page_idx ?? 0));
      const slotIndex = Math.floor(Number(s?.slot_index ?? s?.slot ?? 0));
      const r = ops.decomposeEquipment(working, page, slotIndex);
      if (!r.ok) return res.json(r);
      working = r.player;
      results.push({ catalyst_dropped: r.catalyst_dropped, catalyst_name: r.catalyst_name });
    }
    ops.sortInventory(working);
    await db.savePlayer(req.accountId, 1, working);
    return res.json({ ok: true, player: working, results });
  }
  const page = Math.floor(Number(req.body?.page ?? 0));
  const slotIndex = Math.floor(Number(req.body?.slot_index ?? 0));
  const expectItemId = Number(req.body?.expect_item_id || 0);
  if (expectItemId > 0) {
    const slot = ops.getSlotItem(player, page, slotIndex);
    if (!slot || Number(slot.id || 0) !== expectItemId) {
      return res.json({ ok: false, error: '背包物品已变动，请刷新后重试', code: 'SLOT_MISMATCH' });
    }
  }
  const r = ops.decomposeEquipment(player, page, slotIndex);
  if (!r.ok) return res.json(r);
  ops.sortInventory(r.player);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player, catalyst_dropped: r.catalyst_dropped, catalyst_name: r.catalyst_name });
});

// POST /player/equip_skill - 装备技能
router.post('/equip_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.equipSkill(player, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/unequip_skill - 卸下技能
router.post('/unequip_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.unequipSkill(player, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/set_key_skill - 设置KEY技能（0为清空）
router.post('/set_key_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.setKeySkill(player, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/save_skill_preset - 保存技能预设（grind/dungeon/duel）
router.post('/save_skill_preset', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const { preset, equipped_skills, key_skill_id } = req.body || {};
  const r = ops.saveSkillPreset(player, String(preset || ''), equipped_skills, key_skill_id);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/apply_skill_preset - 应用技能预设到当前装备
router.post('/apply_skill_preset', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const { preset } = req.body || {};
  const r = ops.applySkillPreset(player, String(preset || ''));
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/preset_equip_skill
router.post('/preset_equip_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const preset = String(req.body?.preset || '');
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.presetEquipSkill(player, preset, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/preset_unequip_skill
router.post('/preset_unequip_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const preset = String(req.body?.preset || '');
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.presetUnequipSkill(player, preset, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/preset_set_key_skill
router.post('/preset_set_key_skill', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const preset = String(req.body?.preset || '');
  const skillId = Math.floor(Number(req.body?.skill_id || 0));
  const r = ops.presetSetKeySkill(player, preset, skillId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/set_talisman - 设置战斗符箓（0为清空）
router.post('/set_talisman', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const itemId = Math.floor(Number(req.body?.item_id || 0));
  const r = ops.setTalisman(player, itemId);
  if (!r.ok) return res.json(r);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/set_technique - 设置主修/辅修功法
router.post('/set_technique', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const slot = String(req.body?.slot || 'main').toLowerCase();
  const techniqueId = Math.floor(Number(req.body?.technique_id || 0));
  const r = ops.setTechnique(player, slot, techniqueId);
  if (!r.ok) return res.json(r);
  recalcAndAssignCombatStats(r.player, true);
  await db.savePlayer(req.accountId, 1, r.player);
  res.json({ ok: true, player: r.player });
});

// POST /player/set_map - 设置当前地图（持久化）
router.post('/set_map', async (req, res) => {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const mapId = Math.floor(Number(req.body?.map_id || 0));
  if (mapId <= 0) return res.json({ ok: false, error: '地图参数无效' });
  const map = getMapById(mapId);
  if (!map || !map.id) return res.json({ ok: false, error: '地图不存在' });
  player.current_map_id = mapId;
  if (player.auto_battle_enabled === true) {
    player.auto_battle_map_id = mapId;
  }
  await db.savePlayer(req.accountId, 1, player);
  res.json({ ok: true, player, map_id: mapId, map_name: String(map.name || '') });
});

async function handleDestinyUnlock(req, res) {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  const nodeId = String(req.body?.node_id || '').trim();
  if (!nodeId) return res.json({ ok: false, error: '命途参数无效' });
  ops.grantTalentPointsForLevel(player);
  const r = ops.unlockTalentNode(player, nodeId);
  if (!r.ok) return res.json(r);
  recalcAndAssignCombatStats(player, true);
  await db.savePlayer(req.accountId, 1, player);
  res.json({ ok: true, player, node_id: nodeId });
}

// POST /player/destiny/unlock - 解锁命途节点
router.post('/destiny/unlock', handleDestinyUnlock);

// 兼容旧路径
router.post('/talent/unlock', handleDestinyUnlock);

async function handleDestinyReset(req, res) {
  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色' });
  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const item = getItemById(TALENT_RESET_ITEM_ID);
  if (!item || !item.id) return res.json({ ok: false, error: '洗点材料未配置' });
  const consumed = ops.consumeItemFromInventory(player.inventory, TALENT_RESET_ITEM_ID, 1);
  if (!consumed) return res.json({ ok: false, error: `缺少材料：${String(item.name || '万物之形')}` });
  const r = ops.resetTalentNodes(player);
  if (!r.ok) return res.json(r);
  recalcAndAssignCombatStats(player, true);
  await db.savePlayer(req.accountId, 1, player);
  res.json({
    ok: true,
    player,
    refunded_points: Number(r.refunded_points || 0),
    consumed_item_id: TALENT_RESET_ITEM_ID,
    consumed_item_name: String(item.name || '万物之形'),
    consumed_count: 1
  });
}

// POST /player/destiny/reset - 重置命途（消耗万物之形x1）
router.post('/destiny/reset', handleDestinyReset);

// 兼容旧路径
router.post('/talent/reset', handleDestinyReset);

// POST /player/wipe - 删档（删除当前账号所有角色数据，需 confirm_text 确认）
router.post('/wipe', async (req, res) => {
  const confirmText = String(req.body?.confirm_text || '').trim();
  if (confirmText !== '确认删档') {
    return res.json({ ok: false, error: '请提供 confirm_text=确认删档 以确认操作' });
  }
  const aid = Number(req.accountId) || 0;
  if (aid <= 0) return res.json({ ok: false, error: '未登录' });
  if (typeof db.invalidatePlayerReadCache === 'function') await db.invalidatePlayerReadCache(aid);
  if (typeof playerWriteCache.drainAccountAsync === 'function') {
    await playerWriteCache.drainAccountAsync(aid);
  }
  playerWriteCache.clear(aid);
  try {
    await db.wipeAccountData(aid);
  } catch (e) {
    console.error('[wipe] 删档事务失败:', e?.message || e);
    return res.json({ ok: false, error: '删档失败，请稍后重试' });
  }
  res.json({ ok: true });
});

module.exports = router;
