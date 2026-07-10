/**
 * 服务端战斗主循环
 *
 * 在线/离线统一处理：所有会话均以 1 回合/tick 速率推进（Worker Thread 执行）
 * Main Thread 只负责 HTTP、BSC 事件存储、DB 结算、自动开局
 * 离线超过 48 小时的玩家停止处理战斗，等待下次上线
 */

const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const bsc = require('./battleSessionCache');
const engine = require('./battleEngine');
const dbAsync = require('../dbAsync');
const config = require('../config');
const mysqlAsyncPool = require('../mysqlAsyncPool');
const accountBanCache = require('./accountBanCache');
const autoBattleIndex = require('./autoBattleIndex');
const { getSkillById, getMapById } = require('./dataLoader');
const settlementLock = require('./settlementLock');
const crypto = require('crypto');
const wsManager = require('../ws');
const ops = require('./playerOps');
const cave = require('./cave');
const offlineStat = require('./offlineStatSettlement');
const { isAutoRestartEnabled } = require('./battleTiming');
const { randomEnemyFromMap } = require('./battleEncounterFactory');
const { isLingjieMap, scaleLingjieEnemyForPlayer, buildLingjieBattleContext } = require('./lingjie');
const { finalizeBattle } = require('./battleSettlementService');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const CPU_COUNT = Math.max(1, intVal((os.cpus() || []).length, 1));
const TICK_INTERVAL_MS = (() => {
  const env = Number(process.env.BATTLE_TICK_INTERVAL_MS);
  if (Number.isFinite(env) && env >= 200) return Math.min(2000, Math.floor(env));
  return 500;
})();
const ONLINE_THRESHOLD_SEC = 5;
const OFFLINE_MAX_SEC = 172800; // 48h
const OFFLINE_HYBRID_ENABLED = !!offlineStat.OFFLINE_HYBRID_ENABLED;
const OFFLINE_REAL_SAMPLE_SEC = Math.max(60, intVal(offlineStat.OFFLINE_REAL_SAMPLE_SEC, 10 * 60));
const OFFLINE_SAMPLE_ROUNDS_PER_RUN = Math.max(1, intVal(offlineStat.OFFLINE_SAMPLE_ROUNDS_PER_RUN, 10));
const WORKER_PROCESSING_TIMEOUT_MS = 15000;
const MAX_WORKER_BATCH_SIZE = (() => {
  const env = Number(process.env.BATTLE_MAX_WORKER_BATCH_SIZE);
  if (Number.isFinite(env) && env >= 200) return Math.min(3000, Math.floor(env));
  if (CPU_COUNT <= 4) return 900;
  if (CPU_COUNT <= 8) return 1200;
  return 1500;
})();
const ONLINE_RESTART_GRACE_SEC = (() => {
  const env = Number(process.env.BATTLE_ONLINE_RESTART_GRACE_SEC);
  if (Number.isFinite(env) && env >= 0) return Math.min(10, Math.floor(env));
  return 0;
})();
const OFFLINE_TICK_SKIP = (() => {
  const env = Number(process.env.BATTLE_OFFLINE_TICK_SKIP);
  if (Number.isFinite(env) && env >= 2) return Math.min(60, Math.floor(env));
  return 10;
})();
const AUTO_INTENT_SWEEP_BATCH_SIZE = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SWEEP_BATCH_SIZE);
  if (Number.isFinite(env) && env >= 50) return Math.min(1000, Math.floor(env));
  return 250;
})();
const AUTO_INTENT_SWEEP_INTERVAL_SEC = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SWEEP_INTERVAL_SEC);
  if (Number.isFinite(env) && env >= 2) return Math.min(60, Math.floor(env));
  return 10;
})();
const AUTO_INTENT_MAX_STARTS_PER_SWEEP = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_MAX_STARTS_PER_SWEEP);
  if (Number.isFinite(env) && env >= 1) return Math.min(1000, Math.floor(env));
  const byBatch = Math.floor(AUTO_INTENT_SWEEP_BATCH_SIZE * 0.8);
  return Math.max(180, Math.min(1000, byBatch));
})();
const AUTO_INTENT_SATURATION_BACKOFF_SEC = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SATURATION_BACKOFF_SEC);
  if (Number.isFinite(env) && env >= 1) return Math.min(120, Math.floor(env));
  return 8;
})();
const AUTO_INTENT_SATURATION_DEFERRED_THRESHOLD = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SATURATION_DEFERRED_THRESHOLD);
  if (Number.isFinite(env) && env >= 1) return Math.min(5000, Math.floor(env));
  return Math.max(120, Math.floor(MAX_WORKER_BATCH_SIZE * 0.25));
})();
const AUTO_INTENT_ACTIVE_SESSION_CAP = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_ACTIVE_SESSION_CAP);
  if (!Number.isFinite(env) || env <= 0) return 0;
  return Math.max(50, Math.min(500000, Math.floor(env)));
})();
const AUTO_INTENT_SHARD_COUNT = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SHARD_COUNT);
  if (!Number.isFinite(env) || env <= 1) return 1;
  return Math.max(1, Math.min(128, Math.floor(env)));
})();
const AUTO_INTENT_SHARD_INDEX = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_SHARD_INDEX);
  const raw = Number.isFinite(env) ? Math.floor(env) : 0;
  if (AUTO_INTENT_SHARD_COUNT <= 1) return 0;
  return ((raw % AUTO_INTENT_SHARD_COUNT) + AUTO_INTENT_SHARD_COUNT) % AUTO_INTENT_SHARD_COUNT;
})();
const OFFLINE_ROUNDS_PER_RUN = (() => {
  const env = Number(process.env.BATTLE_OFFLINE_ROUNDS_PER_RUN);
  if (Number.isFinite(env) && env >= 1) return Math.max(1, Math.floor(env));
  if (CPU_COUNT <= 4) return Math.max(4, Math.min(6, OFFLINE_TICK_SKIP));
  return OFFLINE_TICK_SKIP;
})();
const BATCH_ONLINE_RESERVE_RATIO = (() => {
  const env = Number(process.env.BATTLE_ONLINE_BATCH_RESERVE_RATIO);
  if (!Number.isFinite(env)) return 0.2;
  return Math.max(0, Math.min(0.8, env));
})();
const BATCH_ONLINE_RESERVE_MIN = (() => {
  const env = Number(process.env.BATTLE_ONLINE_BATCH_RESERVE_MIN);
  if (Number.isFinite(env) && env >= 0) return Math.floor(env);
  return Math.max(120, Math.floor(MAX_WORKER_BATCH_SIZE * 0.2));
})();
const MYSQL_ASYNC_AUTO_INTENT_ENABLED = String(process.env.MYSQL_ASYNC_AUTO_INTENT_ENABLED || '1') !== '0';
const WS_STATE_PUSH_EVERY_N_BATCHES = (() => {
  const env = Number(process.env.WS_STATE_PUSH_EVERY_N_BATCHES);
  if (Number.isFinite(env) && env >= 1) return Math.min(20, Math.floor(env));
  return 4;
})();
const WS_IDLE_STATE_PUSH_EVERY_N_TICKS = (() => {
  const env = Number(process.env.WS_IDLE_STATE_PUSH_EVERY_N_TICKS);
  if (Number.isFinite(env) && env >= 1) return Math.min(20, Math.floor(env));
  return 1;
})();
const WS_IDLE_STATE_MIN_INTERVAL_MS = (() => {
  const env = Number(process.env.WS_IDLE_STATE_MIN_INTERVAL_MS);
  if (Number.isFinite(env) && env >= 100) return Math.min(5000, Math.floor(env));
  return 450;
})();
const WS_IDLE_STATE_ONLINE_SOFT_CAP = (() => {
  const env = Number(process.env.WS_IDLE_STATE_ONLINE_SOFT_CAP);
  if (Number.isFinite(env) && env >= 1) return Math.min(100000, Math.floor(env));
  return 120;
})();
const WS_IDLE_STATE_ONLINE_HARD_CAP = (() => {
  const env = Number(process.env.WS_IDLE_STATE_ONLINE_HARD_CAP);
  if (Number.isFinite(env) && env >= 1) return Math.min(100000, Math.floor(env));
  return 260;
})();
const BAN_SCAN_INTERVAL_TICKS = (() => {
  const env = Number(process.env.BATTLE_BAN_SCAN_INTERVAL_TICKS);
  if (Number.isFinite(env) && env >= 1) return Math.min(120, Math.floor(env));
  return 8;
})();
const BAN_SCAN_FULL_SWEEP_SEC = (() => {
  const env = Number(process.env.BATTLE_BAN_SCAN_FULL_SWEEP_SEC);
  if (Number.isFinite(env) && env >= 5) return Math.min(300, Math.floor(env));
  return 45;
})();
const BAN_SCAN_BATCH_MIN = (() => {
  const env = Number(process.env.BATTLE_BAN_SCAN_BATCH_MIN);
  if (Number.isFinite(env) && env >= 1) return Math.min(2000, Math.floor(env));
  return 40;
})();
const PERF_LOG_INTERVAL_SEC = (() => {
  const env = Number(process.env.BATTLE_PERF_LOG_INTERVAL_SEC);
  if (Number.isFinite(env) && env >= 5) return Math.min(300, Math.floor(env));
  return 30;
})();

const WORKER_COUNT = (() => {
  const env = Number(process.env.BATTLE_WORKERS);
  if (Number.isFinite(env) && env >= 1) return Math.floor(Math.min(env, 16));
  if (CPU_COUNT <= 4) return 2;
  if (CPU_COUNT <= 8) return 3;
  return 4;
})();

// ── Worker Thread Pool ──

const _workers = [];
const _workerReady = [];
const _respawnTimers = [];

function _spawnAllWorkers() {
  for (let i = 0; i < WORKER_COUNT; i++) _spawnOneWorker(i);
}

function _spawnOneWorker(idx) {
  try {
    const w = new Worker(path.join(__dirname, 'battleWorker.js'));
    _workers[idx] = w;
    _workerReady[idx] = true;

    w.on('message', _onWorkerMessage);

    w.on('error', (err) => {
      console.error('[gameLoop] worker[%d] error: %s', idx, err?.message);
      _workerReady[idx] = false;
      _clearWorkerSessions(idx);
      _scheduleRespawn(idx);
    });

    w.on('exit', (code) => {
      _workerReady[idx] = false;
      _clearWorkerSessions(idx);
      if (code !== 0) {
        console.error('[gameLoop] worker[%d] exited with code %d', idx, code);
        _scheduleRespawn(idx);
      }
    });

    console.log('[gameLoop] worker[%d] spawned', idx);
  } catch (err) {
    console.error('[gameLoop] failed to spawn worker[%d]: %s', idx, err?.message);
    _workerReady[idx] = false;
  }
}

let _lastIntentSweepAt = 0;
let _tickCount = 0;
let _sessionRoundRobinCursor = 0;
let _lastBatchSaturationLogAt = 0;
let _autoIntentSweepCursor = 0;
let _autoIntentSweepInFlight = false;
let _autoBattleIndexRebuildStarted = false;
let _autoBattleIndexRebuildTimer = null;
let _lastMysqlAsyncScanErrorLogAt = 0;
let _lastPerfLogAt = 0;
let _autoIntentBackoffUntilSec = 0;
let _lastAutoIntentBackoffLogAt = 0;
const _pendingAutoRestartSessionIds = new Set();
let _banScanCursor = 0;

function _scheduleRespawn(idx) {
  if (_respawnTimers[idx]) return;
  _respawnTimers[idx] = setTimeout(() => {
    _respawnTimers[idx] = null;
    if (!_workerReady[idx] && _interval) _spawnOneWorker(idx);
  }, 1000);
}

function _isAnyWorkerReady() {
  for (let i = 0; i < WORKER_COUNT; i++) { if (_workerReady[i]) return true; }
  return false;
}

function _getReadyWorkerIndices() {
  const indices = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    if (_workerReady[i] && _workers[i]) indices.push(i);
  }
  return indices;
}

function _clearWorkerSessions(idx) {
  const sessions = bsc.getAllActiveSessions();
  for (const s of sessions) {
    if (s._workerProcessing && s._workerIdx === idx) {
      s._workerProcessing = false;
      s._workerSentAt = 0;
    }
  }
}

function _clearAllWorkerProcessing() {
  const sessions = bsc.getAllActiveSessions();
  for (const s of sessions) {
    if (s._workerProcessing) {
      s._workerProcessing = false;
      s._workerSentAt = 0;
    }
  }
}

function getWorkerCount() { return WORKER_COUNT; }

async function _onWorkerMessage(msg) {
  if (msg.type !== 'batchResult' || !Array.isArray(msg.results)) return;

  const nowSec = Math.floor(Date.now() / 1000);

  for (const r of msg.results) {
    try {
      const session = bsc.getSession(r.sessionId);
      if (!session) continue;
      if (session.status !== 'active') continue;
      if (Number(r.runId || 0) !== Number(session._workerRunId || 0)) continue;
      session._workerProcessing = false;
      session._workerSentAt = 0;

      if (r.error) {
        session._errorCount = (session._errorCount || 0) + 1;
        console.error('[gameLoop] worker error sessionId=%s accountId=%s (#%d): %s',
          r.sessionId, session.account_id, session._errorCount, r.error);
        if (session._errorCount >= 3) {
          console.error('[gameLoop] 连续%d次失败，强制终结战斗 sessionId=%s accountId=%s',
            session._errorCount, r.sessionId, session.account_id);
          bsc.finishSession(session.id, { victory: false, rewards: {} });
          bsc.deleteSession(session.id);
        }
        continue;
      }

      if (!r.ok) {
        session._errorCount = (session._errorCount || 0) + 1;
        if (session._errorCount >= 3) {
          console.error('[gameLoop] applyCommand 连续失败，强制终结 sessionId=%s accountId=%s',
            r.sessionId, session.account_id);
          bsc.finishSession(session.id, { victory: false, rewards: {} });
          bsc.deleteSession(session.id);
        }
        continue;
      }

      session.state = r.finalState;
      session._errorCount = 0;

      const lastPoll = Number(session.last_poll_at) || Number(session.started_at) || nowSec;
      const offlineSec = nowSec - lastPoll;
      const isOnline = offlineSec < ONLINE_THRESHOLD_SEC || wsManager.isOnline(session.account_id);

      const eventCount = Array.isArray(r.events) ? r.events.length : 0;
      if (eventCount > 0) {
        if (isOnline) {
          bsc.appendEvents(session.id, (r.prevIdx || 0) + 1, r.events);
          _wsPushEvents(session, r.events, (r.prevIdx || 0) + 1);
        }
      } else if (isOnline) {
        _wsPushIdleState(session);
      }

      const newSeq = (Number(session.last_seq) || 0) + 1;
      if (r.ended) {
        const outcome = { victory: !!r.victory, draw: !!r.draw };
        if (isOnline) {
          const settleResult = await _settleBattleOnline(session, outcome);
          if (!settleResult?.ok) continue;
          if (isAutoRestartEnabled(session)) _scheduleAutoRestart(session, settleResult.rest_remaining_sec || 0);
        } else {
          const settleResult = await _settleBattleOffline(session, outcome);
          if (!settleResult?.ok) continue;
          if (isAutoRestartEnabled(session)) {
            const restSec = settleResult.rest_remaining_sec || 0;
            if (!(await _autoStartNext(session.account_id, session.map_id, 0, restSec, session.last_poll_at, settleResult.player))) {
              bsc.deleteSession(session.id);
            }
          } else {
            bsc.deleteSession(session.id);
          }
        }
      } else {
        bsc.updateSessionState(session.id, {
          state: session.state,
          lastCmdAt: nowSec,
          expiresAt: nowSec + 900,
          lastSeq: newSeq
        });
        if (isOnline && newSeq % 50 === 0) bsc.trimEvents(session.id, 500);
      }
    } catch (err) {
      console.error('[gameLoop] worker result error sessionId=%s:', r.sessionId, err?.message);
    }
  }
}

// ── WebSocket push helpers ──

function _wsPushEvents(session, events, startIndex) {
  if (!wsManager.isOnline(session.account_id)) return;
  if (!wsManager.wantsBattleDetail(session.account_id)) return;
  session._wsIdleStateTickCount = 0;
  session._wsIdleLastSig = '';
  session._wsIdleLastPushAt = 0;
  session._wsDetailBatchCount = (intVal(session._wsDetailBatchCount, 0) + 1);
  const includeState = (session._wsDetailBatchCount % WS_STATE_PUSH_EVERY_N_BATCHES) === 1;
  const payload = {
    type: 'battle_events',
    battleId: session.id,
    events: events.map((ev, i) => ({ index: startIndex + i, ...ev })),
    event_index: intVal(session.state?.event_index, 0)
  };
  if (includeState) payload.state = engine.stateLite(session.state);
  wsManager.pushToPlayer(session.account_id, payload);
}

function _stateBarsLite(state) {
  const p = state?.player || {};
  const e = state?.enemy || {};
  return {
    player: {
      hp: p.hp, max_hp: p.max_hp,
      mp: p.mp, max_mp: p.max_mp,
      action: p.action, action_bar: p.action_bar,
      max_action: p.max_action, max_action_bar: p.max_action_bar
    },
    enemy: {
      hp: e.hp, max_hp: e.max_hp,
      mp: e.mp, max_mp: e.max_mp,
      action: e.action, action_bar: e.action_bar,
      max_action: e.max_action, max_action_bar: e.max_action_bar,
      name: e.name
    }
  };
}

function _stateBarsSig(state, eventIndex) {
  const p = state?.player || {};
  const e = state?.enemy || {};
  const pAct = Math.floor(Number(p.action ?? p.action_bar) || 0);
  const eAct = Math.floor(Number(e.action ?? e.action_bar) || 0);
  return [
    Number(p.hp) || 0,
    Number(p.mp) || 0,
    pAct,
    Number(e.hp) || 0,
    Number(e.mp) || 0,
    eAct,
    Number(eventIndex) || 0
  ].join('|');
}

function _effectiveIdlePushEveryTicks() {
  const online = (typeof wsManager.getOnlineCount === 'function') ? intVal(wsManager.getOnlineCount(), 0) : 0;
  let ticks = WS_IDLE_STATE_PUSH_EVERY_N_TICKS;
  if (online >= WS_IDLE_STATE_ONLINE_HARD_CAP) ticks = Math.max(ticks, 4);
  else if (online >= WS_IDLE_STATE_ONLINE_SOFT_CAP) ticks = Math.max(ticks, 2);
  return ticks;
}

function _wsPushIdleState(session) {
  if (!wsManager.isOnline(session.account_id)) return;
  if (!wsManager.wantsBattleDetail(session.account_id)) return;
  session._wsIdleStateTickCount = intVal(session._wsIdleStateTickCount, 0) + 1;
  const everyTicks = _effectiveIdlePushEveryTicks();
  if ((session._wsIdleStateTickCount % everyTicks) !== 0) return;
  const nowMs = Date.now();
  const lastPushAt = Number(session._wsIdleLastPushAt || 0);
  if ((nowMs - lastPushAt) < WS_IDLE_STATE_MIN_INTERVAL_MS) return;
  const eventIndex = intVal(session.state?.event_index, 0);
  const sig = _stateBarsSig(session.state, eventIndex);
  if (sig === String(session._wsIdleLastSig || '')) return;
  session._wsIdleLastSig = sig;
  session._wsIdleLastPushAt = nowMs;
  wsManager.pushToPlayer(session.account_id, {
    type: 'battle_events',
    battleId: session.id,
    events: [],
    event_index: eventIndex,
    state: _stateBarsLite(session.state)
  });
}

function _wsPushBattleEnd(session, settleData) {
  if (!wsManager.isOnline(session.account_id)) return;
  const sd = settleData || session.result || {};
  const stateForClient = engine.stateToClient(session.state || {});
  const fullPlayer = sd.settle_data?.player || sd.player || null;
  // 精简 player：只推送战斗结算相关字段，避免每次发 ~178KB 完整对象
  // 客户端下次 /sync 时会拉取完整数据
  const litePlayer = fullPlayer ? _buildBattleEndPlayerLite(fullPlayer) : null;
  wsManager.pushToPlayer(session.account_id, {
    type: 'battle_end',
    battleId: session.id,
    active: false,
    finished: true,
    victory: Boolean(sd.victory),
    draw: Boolean(sd.draw),
    rewards: sd.settle_data?.rewards || sd.rewards || {},
    player: litePlayer,
    rest_remaining_sec: intVal(sd.settle_data?.rest_remaining_sec ?? sd.rest_remaining_sec, 0),
    state: stateForClient,
    event_index: intVal(session.state?.event_index, 0)
  });
}

/** 战斗结算精简 player：仅保留客户端需要立即更新的字段 */
const _BATTLE_END_PLAYER_KEYS = [
  // 基础数值
  'name', 'level', 'exp', 'max_exp', 'hp', 'max_hp', 'mp', 'max_mp',
  'spirit_stones', 'trial_coins', 'league_points', 'league_rating',
  // 地图/状态
  'current_map_id', 'auto_battle_map_id', 'rest_until', 'auto_battle_enabled',
  // 技能/秘技升级
  'skill_levels', 'techniques', 'skill_cooldowns',
  // 门派/联盟 ID
  'sect_id', 'alliance_id',
  // 时间状态
  'time_state'
  // 注意：不包含 inventory，避免用战斗时的背包快照覆盖邮件领取等操作的新数据
  // 掉落信息通过 rewards.drops 告知客户端，完整背包由 /sync 同步
];
function _buildBattleEndPlayerLite(player) {
  const lite = {};
  for (const k of _BATTLE_END_PLAYER_KEYS) {
    if (k in player) lite[k] = player[k];
  }
  return lite;
}

function _wsPushNewBattle(accountId) {
  if (!wsManager.isOnline(accountId)) return;
  const session = bsc.getActiveSessionByAccount(accountId);
  if (!session) return;
  session._wsDetailBatchCount = 0;
  session._wsIdleStateTickCount = 0;
  session._wsIdleLastSig = '';
  session._wsIdleLastPushAt = 0;
  const stateForClient = engine.stateToClient(session.state || {});
  wsManager.pushToPlayer(accountId, {
    type: 'battle_start',
    battleId: session.id,
    state: stateForClient,
    active: true
  });
}

function _scheduleAutoRestart(session, restSec) {
  if (!session) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const delaySec = Math.max(intVal(restSec, 0), ONLINE_RESTART_GRACE_SEC);
  session.pending_auto_restart = true;
  session.pending_restart_at = nowSec + delaySec;
  session.pending_restart_last_poll_at = Number(session.last_poll_at) || nowSec;
  _pendingAutoRestartSessionIds.add(String(session.id || ''));
}

async function _processPendingAutoRestarts(nowSec) {
  if (_pendingAutoRestartSessionIds.size <= 0) return;
  const doneIds = [];
  for (const sid of _pendingAutoRestartSessionIds) {
    const session = bsc.getSession(sid);
    if (!session || session.status !== 'finished' || session.pending_auto_restart !== true) {
      doneIds.push(sid);
      continue;
    }
    if ((Number(session.pending_restart_at) || 0) > nowSec) continue;
    const started = await _autoStartNext(
      session.account_id,
      session.map_id,
      0,
      0,
      session.pending_restart_last_poll_at || session.last_poll_at
    );
    if (started) {
      doneIds.push(sid);
    } else {
      session.pending_restart_at = nowSec + 1;
    }
  }
  for (const sid of doneIds) {
    _pendingAutoRestartSessionIds.delete(sid);
  }
}

function _calcBanScanBatchSize(sessionCount) {
  if (sessionCount <= 0) return 0;
  const scanIntervalSec = Math.max(0.1, (BAN_SCAN_INTERVAL_TICKS * TICK_INTERVAL_MS) / 1000);
  const targetSteps = Math.max(1, Math.floor(BAN_SCAN_FULL_SWEEP_SEC / scanIntervalSec));
  const dynamicBatch = Math.ceil(sessionCount / targetSteps);
  return Math.max(1, Math.min(sessionCount, Math.max(BAN_SCAN_BATCH_MIN, dynamicBatch)));
}

function _scheduleAutoBattleIndexRebuild(delayMs = 1500) {
  if (_autoBattleIndexRebuildStarted || _autoBattleIndexRebuildTimer) return;
  _autoBattleIndexRebuildStarted = true;
  const delay = Math.max(0, intVal(delayMs, 0));
  _autoBattleIndexRebuildTimer = setTimeout(() => {
    _autoBattleIndexRebuildTimer = null;
    if (!_interval) {
      _autoBattleIndexRebuildStarted = false;
      return;
    }
    autoBattleIndex.rebuildFromDb(_getDb(), { batchSize: AUTO_INTENT_SWEEP_BATCH_SIZE })
      .then((res) => {
        if (res?.ok) {
          console.log('[gameLoop] auto battle redis index rebuilt: indexed=%d', intVal(res?.indexed, 0));
          return;
        }
        _autoBattleIndexRebuildStarted = false;
        if (String(res?.reason || '') === 'disabled_or_redis_not_ready') return;
        console.warn('[gameLoop] auto battle redis index rebuild skipped: %s', res?.reason || 'unknown');
      })
      .catch((err) => {
        _autoBattleIndexRebuildStarted = false;
        console.error('[gameLoop] auto battle redis index rebuild error:', err?.message || err);
      });
  }, delay);
}

function _rowToAutoIntentCandidate(row, nowSec) {
  const accountId = Number(row?.account_id || 0);
  if (accountId <= 0) return null;

  if (typeof row?.data === 'string') {
    let player = null;
    try { player = JSON.parse(row.data || '{}'); } catch { return null; }
    if (!player || player.auto_battle_enabled !== true) return null;
    if (autoBattleIndex.isEnabled()) autoBattleIndex.upsertFromPlayer(accountId, player);
    return {
      accountId,
      mapId: Math.max(1, intVal(player.auto_battle_map_id || player.current_map_id || 1, 1)),
      restSec: Math.max(0, intVal(player.rest_until, 0) - nowSec),
      lastActivity: Number(player?.time_state?.last_activity_at) || nowSec
    };
  }

  const enabled = row?.auto_battle_enabled === true || Number(row?.auto_battle_enabled) === 1;
  if (!enabled) return null;
  return {
    accountId,
    mapId: Math.max(1, intVal(row.auto_battle_map_id || row.current_map_id || 1, 1)),
    restSec: Math.max(0, intVal(row.rest_until, 0) - nowSec),
    lastActivity: Number(row.last_activity_at) || nowSec
  };
}

function _canUseMysqlAsyncAutoIntent() {
  return MYSQL_ASYNC_AUTO_INTENT_ENABLED && String(config.dbDriver || '').toLowerCase() === 'mysql';
}

async function _listAutoBattleRowsViaMysqlAsync(afterAccountId, limit) {
  const after = Math.max(0, intVal(afterAccountId, 0));
  const lim = Math.max(1, Math.min(1000, intVal(limit, 300)));
  const rows = await mysqlAsyncPool.query(`
    SELECT
      account_id,
      COALESCE(auto_battle_enabled,
        CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
      ) AS auto_battle_enabled,
      COALESCE(
        auto_battle_map_id,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_map_id')) AS SIGNED),
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
        1
      ) AS auto_battle_map_id,
      COALESCE(
        current_map_id,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
        1
      ) AS current_map_id,
      COALESCE(
        rest_until,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.rest_until')) AS SIGNED),
        0
      ) AS rest_until,
      COALESCE(
        last_activity_at,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.time_state.last_activity_at')) AS SIGNED),
        updated_at,
        0
      ) AS last_activity_at
    FROM players
    WHERE account_id > ?
      AND COALESCE(auto_battle_enabled,
        CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
      ) = 1
    ORDER BY account_id ASC
    LIMIT ?
  `, [after, lim]);
  return Array.isArray(rows) ? rows : [];
}

async function _loadAutoIntentRows(dbApi) {
  if (autoBattleIndex.isEnabled()) {
    try {
      const scanned = await autoBattleIndex.scanAfter(_autoIntentSweepCursor, AUTO_INTENT_SWEEP_BATCH_SIZE);
      const rows = Array.isArray(scanned?.rows) ? scanned.rows : [];
      if (rows.length > 0) {
        if (scanned?.wrapped || rows.length < AUTO_INTENT_SWEEP_BATCH_SIZE) {
          _autoIntentSweepCursor = 0;
        } else {
          const next = Number(scanned?.nextCursor || rows[rows.length - 1]?.account_id || 0);
          _autoIntentSweepCursor = next > 0 ? next : 0;
        }
        return rows;
      }
      if (scanned?.wrapped) _autoIntentSweepCursor = 0;
    } catch (err) {
      console.warn('[gameLoop] auto intent redis scan failed, fallback db: %s', err?.message || err);
    }
  }

  if (_canUseMysqlAsyncAutoIntent()) {
    try {
      let rows = await _listAutoBattleRowsViaMysqlAsync(_autoIntentSweepCursor, AUTO_INTENT_SWEEP_BATCH_SIZE);
      if ((!rows || rows.length <= 0) && _autoIntentSweepCursor > 0) {
        _autoIntentSweepCursor = 0;
        rows = await _listAutoBattleRowsViaMysqlAsync(0, AUTO_INTENT_SWEEP_BATCH_SIZE);
      }
      if (Array.isArray(rows) && rows.length > 0) {
        const lastAid = Number(rows[rows.length - 1]?.account_id || 0);
        if (lastAid > 0) _autoIntentSweepCursor = lastAid;
        if (rows.length < AUTO_INTENT_SWEEP_BATCH_SIZE) _autoIntentSweepCursor = 0;
        return rows;
      }
    } catch (err) {
      const nowMs = Date.now();
      if (nowMs - _lastMysqlAsyncScanErrorLogAt >= 30000) {
        _lastMysqlAsyncScanErrorLogAt = nowMs;
        console.warn('[gameLoop] auto intent mysql async scan failed, fallback sync db: %s', err?.message || err);
      }
    }
  }

  let rows = await dbAsync.listAutoBattlePlayerRows(_autoIntentSweepCursor, AUTO_INTENT_SWEEP_BATCH_SIZE);
  if ((!rows || rows.length <= 0) && _autoIntentSweepCursor > 0) {
    _autoIntentSweepCursor = 0;
    rows = await dbAsync.listAutoBattlePlayerRows(0, AUTO_INTENT_SWEEP_BATCH_SIZE);
  }
  if (!Array.isArray(rows) || rows.length <= 0) return [];

  const lastAid = Number(rows[rows.length - 1]?.account_id || 0);
  if (lastAid > 0) _autoIntentSweepCursor = lastAid;
  if (rows.length < AUTO_INTENT_SWEEP_BATCH_SIZE) _autoIntentSweepCursor = 0;
  return rows;
}

async function _processAutoBattleIntentsAsync(nowSec) {
  const dbApi = _getDb();
  const rows = await _loadAutoIntentRows(dbApi);
  if (!Array.isArray(rows) || rows.length <= 0) return;
  let started = 0;
  let activeSessionCount = bsc.getAllActiveSessions().length;
  const capped = AUTO_INTENT_ACTIVE_SESSION_CAP > 0;

  for (const row of rows) {
    if (started >= AUTO_INTENT_MAX_STARTS_PER_SWEEP) break;
    if (capped && activeSessionCount >= AUTO_INTENT_ACTIVE_SESSION_CAP) break;
    const candidate = _rowToAutoIntentCandidate(row, nowSec);
    if (!candidate) continue;
    if (AUTO_INTENT_SHARD_COUNT > 1) {
      const shard = ((candidate.accountId % AUTO_INTENT_SHARD_COUNT) + AUTO_INTENT_SHARD_COUNT) % AUTO_INTENT_SHARD_COUNT;
      if (shard !== AUTO_INTENT_SHARD_INDEX) continue;
    }
    if (bsc.isOfflineStatModeActive(candidate.accountId)) continue;
    if (bsc.getAnySessionByAccount(candidate.accountId)) continue;
    if (!wsManager.isOnline(candidate.accountId) && nowSec - candidate.lastActivity >= OFFLINE_MAX_SEC) continue;
    if (await _autoStartNext(candidate.accountId, candidate.mapId, 0, candidate.restSec, candidate.lastActivity)) {
      started++;
      activeSessionCount++;
    }
  }
}

function _processAutoBattleIntents(nowSec) {
  if (autoBattleIndex.isEnabled() && !_autoBattleIndexRebuildStarted) {
    _scheduleAutoBattleIndexRebuild(0);
  }
  if (nowSec < _autoIntentBackoffUntilSec) return;
  if (nowSec - _lastIntentSweepAt < AUTO_INTENT_SWEEP_INTERVAL_SEC) return;
  if (_autoIntentSweepInFlight) return;
  _lastIntentSweepAt = nowSec;
  _autoIntentSweepInFlight = true;
  _processAutoBattleIntentsAsync(nowSec)
    .catch((err) => {
      console.error('[gameLoop] auto intent sweep error:', err?.message || err);
    })
    .finally(() => {
      _autoIntentSweepInFlight = false;
    });
}

// ── auto-skill pick (Main Thread fallback + export) ──

function _canUseSkillNow(unit, sid) {
  const skillId = Math.max(1, intVal(sid, 0));
  if (skillId <= 0) return false;
  if (!Array.isArray(unit?.equipped_skills) || !unit.equipped_skills.includes(skillId)) return false;
  const skill = getSkillById(skillId);
  if (!skill || !skill.id) return false;
  const req = skill.requirements;
  if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
    const weapType = String(unit.weapon_type || '');
    if (!req.weaponTypes.some(wt => weapType.includes(wt))) return false;
  }
  const cd = intVal(unit.skill_cooldowns?.[String(skillId)], 0);
  if (cd > 0) return false;
  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  return mpCost <= intVal(unit.mp, 0);
}

function pickAutoSkill(state) {
  const p = state.player;
  const equipped = Array.isArray(p.equipped_skills) ? p.equipped_skills : [];
  const lingli = numVal(p.lingli_raw || p.lingli, 10);
  const lingliBonus = Math.min(lingli * 0.0005, 0.2);
  const skillChance = 0.75 + lingliBonus;
  if (Math.random() >= skillChance) return { action: 'attack', skill_id: 0 };
  const rolled = Math.max(0, intVal(equipped[Math.floor(Math.random() * 5)], 0));
  if (rolled <= 0) return { action: 'attack', skill_id: 0 };
  if (_canUseSkillNow(p, rolled)) return { action: 'skill', skill_id: intVal(rolled, 0) };

  const available = [...new Set(equipped.map(sid => intVal(sid, 0)).filter(sid => sid > 0 && _canUseSkillNow(p, sid)))];
  if (available.length <= 0) return { action: 'attack', skill_id: 0 };
  return { action: 'skill', skill_id: available[Math.floor(Math.random() * available.length)] };
}

// ── lazy require db to avoid startup ordering issues ──
let _db;
function _getDb() { if (!_db) _db = require('../db'); return _db; }

function _isFatalSettlementError(settle) {
  const msg = String(settle?.error || '').trim();
  if (!msg) return false;
  return msg === '角色不存在' || msg === '敌人数据异常';
}

function _normalizeOutcome(outcomeLike) {
  if (outcomeLike && typeof outcomeLike === 'object') {
    return {
      victory: Boolean(outcomeLike.victory),
      draw: Boolean(outcomeLike.draw)
    };
  }
  return {
    victory: Boolean(outcomeLike),
    draw: false
  };
}

// ── Online settlement (keeps finished session for client to poll result) ──
async function _settleBattleOnline(session, outcomeLike) {
  const lockLease = settlementLock.tryAcquire(session.account_id, { owner: 'gameLoop:settle-online' });
  if (!lockLease) return false;
  try {
    const outcome = _normalizeOutcome(outcomeLike);
    const settle = await finalizeBattle(session, session.state, outcome);
    if (!settle?.ok) {
      console.error('[gameLoop] online settle rejected accountId=%s: %s',
        session.account_id, settle?.error || 'unknown');
      if (_isFatalSettlementError(settle)) {
        console.warn('[gameLoop] deleting invalid online session accountId=%s sessionId=%s',
          session.account_id, session.id);
        bsc.deleteSession(session.id);
      }
      return { ok: false };
    }
    const resultData = {
      victory: Boolean(outcome.victory),
      draw: Boolean(outcome.draw),
      rewards: settle?.rewards || {},
      settle_data: {
        ok: settle?.ok || false,
        player: settle?.player || null,
        rest_remaining_sec: intVal(settle?.rest_remaining_sec, 0),
        rewards: settle?.rewards || {},
        draw: Boolean(outcome.draw)
      }
    };
    bsc.finishSession(session.id, resultData);
    _wsPushBattleEnd(session, resultData);
    return { ok: true, rest_remaining_sec: intVal(settle?.rest_remaining_sec, 0) };
  } catch (err) {
    console.error('[gameLoop] online settle error accountId=%s:', session.account_id, err?.message);
    return { ok: false };
  } finally {
    settlementLock.release(session.account_id, lockLease);
  }
}

// ── Offline settlement (accumulates report, does NOT finishSession) ──
async function _settleBattleOffline(session, outcomeLike) {
  const lockLease = settlementLock.tryAcquire(session.account_id, { owner: 'gameLoop:settle-offline' });
  if (!lockLease) return null;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const outcome = _normalizeOutcome(outcomeLike);
    const settle = await finalizeBattle(session, session.state, outcome);
    if (!settle?.ok) {
      console.error('[gameLoop] offline settle rejected accountId=%s: %s',
        session.account_id, settle?.error || 'unknown');
      if (_isFatalSettlementError(settle)) {
        console.warn('[gameLoop] deleting invalid offline session accountId=%s sessionId=%s',
          session.account_id, session.id);
        bsc.deleteSession(session.id);
      }
      return { ok: false, rest_remaining_sec: 0 };
    }
    const rewards = settle?.rewards || {};
    const grantRewards = Boolean(outcome.victory) && !Boolean(outcome.draw);
    const rounds = Math.max(1, intVal(session?.state?.round, 1));
    const battleSeconds = Math.max(0.5, rounds * (TICK_INTERVAL_MS / 1000));
    const startedAt = Math.max(0, intVal(session?.started_at, nowSec));
    const observedCycleSeconds = Math.max(0.5, nowSec - startedAt);
    // 离线采样按“逻辑战斗时长”对观测周期限幅，降低调度/排队抖动造成的效率误差。
    const cycleLower = Math.max(0.5, battleSeconds * 0.85);
    const cycleUpper = Math.max(cycleLower, battleSeconds * 1.35);
    const cycleSeconds = Math.max(cycleLower, Math.min(cycleUpper, observedCycleSeconds));
    bsc.accumulateOfflineReport(session.account_id, {
      victory: Boolean(outcome.victory),
      draw: Boolean(outcome.draw),
      exp: grantRewards ? (rewards.exp || 0) : 0,
      exp_base: grantRewards ? (rewards.exp_base_est || 0) : 0,
      spirit_stones: grantRewards ? (rewards.spirit_stones || 0) : 0,
      spirit_base: grantRewards ? (rewards.spirit_base_est || 0) : 0,
      drops: grantRewards ? (rewards.drops || []) : [],
      technique_ups: grantRewards ? (rewards.technique_ups || []) : [],
      skill_ups: grantRewards ? (rewards.skill_ups || []) : [],
      map_id: intVal(session?.map_id || session?.state?.player?.current_map_id, 0),
      battle_seconds: battleSeconds,
      cycle_seconds: cycleSeconds
    });
    return { ok: true, rest_remaining_sec: intVal(settle?.rest_remaining_sec, 0), player: settle?.player || null };
  } catch (err) {
    console.error('[gameLoop] offline settle error accountId=%s:', session.account_id, err?.message);
    return { ok: false, rest_remaining_sec: 0 };
  } finally {
    settlementLock.release(session.account_id, lockLease);
  }
}

// ── Auto-start next battle ──
async function _autoStartNext(accountId, mapId, _unusedVirtualSec, restSec, lastPollAt, _existingPlayerUnused) {
  // 必须持 settlementLock 避免与 HTTP 路由并发读-改-写导致玩家数据回滚
  const lockLease = settlementLock.tryAcquire(accountId, { owner: 'gameLoop:auto-restart' });
  if (!lockLease) return false;
  try {
    // 锁内重新读取最新 player, 避免用锁外传入的旧对象覆盖并发修改
    const player = await dbAsync.getPlayerByAccountId(accountId);
    if (!player) return false;
    const mainServiceResult = cave.settleMainFormationServices(player, Math.floor(Date.now() / 1000), { allowAutoActivate: true });
    const actualMapId = mapId || player.current_map_id || 1;
    const map = getMapById(actualMapId);
    if (!map) return false;
    const enemy = randomEnemyFromMap(actualMapId);
    if (!enemy?.id) return false;
    const finalEnemy = isLingjieMap(map) ? scaleLingjieEnemyForPlayer(enemy, map, player) : enemy;
    // 预设应用仅用于本次战斗投影，不作为持久化触发条件，避免自动续战写放大。
    ops.tryApplySkillPresetForBattle(player, 'grind');
    if (mainServiceResult && mainServiceResult.changed) await dbAsync.savePlayer(accountId, 1, player);
    const battleId = crypto.randomBytes(16).toString('hex');
    const initState = engine.createInitialBattleState(player, finalEnemy, Math.floor(Math.random() * 2147483647));
    initState.enemy_source = 'wild';
    initState.turn_mode = 'action_bar';
    initState.server_driven = true;
    if (isLingjieMap(map)) {
      initState.map_environment = buildLingjieBattleContext(map);
    }
    initState.event_index = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    bsc.createSession(battleId, accountId, actualMapId, finalEnemy.id, 172800, initState);
    const newSession = bsc.getActiveSessionByAccount(accountId);
    if (newSession) {
      newSession.auto_restart = true;
      newSession.next_battle_at = restSec > 0 ? nowSec + restSec : 0;
      if (lastPollAt) newSession.last_poll_at = lastPollAt;
    }
    _wsPushNewBattle(accountId);
    return true;
  } catch (err) {
    console.error('[gameLoop] autoStartNext error accountId=%s:', accountId, err?.message);
    return false;
  } finally {
    settlementLock.release(accountId, lockLease);
  }
}

// ── main tick ──
async function tick() {
  _tickCount++;
  const isOfflineTick = (_tickCount % OFFLINE_TICK_SKIP) === 0;
  const nowSec = Math.floor(Date.now() / 1000);
  await _processPendingAutoRestarts(nowSec);
  _processAutoBattleIntents(nowSec);
  const sessions = bsc.getAllActiveSessions();
  if (sessions.length === 0) return;
  const sessionCount = sessions.length;
  const scanStart = _sessionRoundRobinCursor % sessionCount;
  const kickedBanned = new Set();
  if ((_tickCount % BAN_SCAN_INTERVAL_TICKS) === 0) {
    const banScanBatchSize = _calcBanScanBatchSize(sessionCount);
    const banScanStart = _banScanCursor % sessionCount;
    for (let i = 0; i < banScanBatchSize; i++) {
      const session = sessions[(banScanStart + i) % sessionCount];
      if (accountBanCache.isBanned(session.account_id, null)) {
        kickedBanned.add(session.account_id);
        wsManager.pushToPlayer(session.account_id, { type: 'kicked', error: '账号已封禁', code: 'BANNED' });
        wsManager.kickPlayer(session.account_id, 4000, 'Banned');
        bsc.finishSession(session.id, { victory: false, rewards: {} });
        bsc.deleteSession(session.id);
      }
    }
    _banScanCursor = (banScanStart + banScanBatchSize) % sessionCount;
  }
  const nowMs = Date.now();
  const hasReadyWorker = _isAnyWorkerReady();
  let deferredByBatchCap = 0;
  let deferredByOfflineCap = 0;

  const workerBatch = [];
  const onlineReserve = Math.max(
    0,
    Math.min(
      Math.max(0, MAX_WORKER_BATCH_SIZE - 1),
      Math.max(BATCH_ONLINE_RESERVE_MIN, Math.floor(sessionCount * BATCH_ONLINE_RESERVE_RATIO))
    )
  );
  const offlineBatchCap = Math.max(0, MAX_WORKER_BATCH_SIZE - onlineReserve);
  let onlineEnqueued = 0;
  let offlineEnqueued = 0;

  for (let i = 0; i < sessionCount; i++) {
    const session = sessions[(scanStart + i) % sessionCount];
    try {
      if (kickedBanned.has(session.account_id)) continue;
      if (session.status !== 'active') continue;
      if (!session.state?.server_driven) continue;

      if (session._workerProcessing) {
        if (nowMs - (session._workerSentAt || 0) > WORKER_PROCESSING_TIMEOUT_MS) {
          console.warn('[gameLoop] _workerProcessing timeout (%dms), force-clearing accountId=%s sessionId=%s',
            nowMs - (session._workerSentAt || 0), session.account_id, session.id);
          session._workerProcessing = false;
          session._workerSentAt = 0;
        } else {
          continue;
        }
      }

      // 休息时间未到则跳过（死亡后调息，在线/离线统一）
      if (session.next_battle_at && nowSec < session.next_battle_at) continue;

      const lastPoll = Number(session.last_poll_at) || Number(session.started_at) || nowSec;
      const offlineSec = nowSec - lastPoll;
      const isOnline = offlineSec < ONLINE_THRESHOLD_SEC || wsManager.isOnline(session.account_id);

      // ── 48h 离线清理 ──
      if (!isOnline && offlineSec >= OFFLINE_MAX_SEC) {
        console.log('[gameLoop] 48h cleanup accountId=%s', session.account_id);
        bsc.deleteSession(session.id);
        continue;
      }

      // 战斗已结束但尚未结算（行动条推完了）
      if (session.state?.status !== 'active') {
        const draw = Boolean(session.state?.draw);
        const victory = !draw && (session.state?.enemy?.hp ?? 1) <= 0;
        const outcome = { victory, draw };
        if (isOnline) {
          const settleResult = await _settleBattleOnline(session, outcome);
          if (!settleResult?.ok) continue;
          if (isAutoRestartEnabled(session)) _scheduleAutoRestart(session, settleResult.rest_remaining_sec || 0);
        } else {
          const settleResult = await _settleBattleOffline(session, outcome);
          if (!settleResult?.ok) continue;
          if (isAutoRestartEnabled(session)) {
            const restSec = settleResult.rest_remaining_sec || 0;
            if (!(await _autoStartNext(session.account_id, session.map_id, 0, restSec, session.last_poll_at, settleResult.player))) {
              bsc.deleteSession(session.id);
            }
          } else {
            bsc.deleteSession(session.id);
          }
        }
        continue;
      }

      // 混合离线模式：离线超过采样窗口后停止真实推演，转统计结算并释放会话占用。
      if (!isOnline && OFFLINE_HYBRID_ENABLED && offlineSec >= OFFLINE_REAL_SAMPLE_SEC) {
        bsc.activateOfflineStatMode(session.account_id, {
          nowSec,
          mapId: intVal(session?.map_id || session?.state?.player?.current_map_id, 0)
        });
        bsc.deleteSession(session.id);
        continue;
      }

      // 离线玩家非 offlineTick 跳过（结算/重开不受影响，仅跳过 Worker 计算）
      if (!isOnline && !isOfflineTick) continue;

      const rounds = isOnline
        ? 1
        : (OFFLINE_HYBRID_ENABLED ? OFFLINE_SAMPLE_ROUNDS_PER_RUN : OFFLINE_ROUNDS_PER_RUN);

      // ── 发给 Worker 处理（离线玩家一次跑多回合，保持实际速度不变）──
      if (hasReadyWorker && workerBatch.length < MAX_WORKER_BATCH_SIZE) {
        if (!isOnline && offlineEnqueued >= offlineBatchCap) {
          deferredByBatchCap++;
          deferredByOfflineCap++;
          continue;
        }
        const runId = (Number(session._workerRunId) || 0) + 1;
        session._workerRunId = runId;
        session._workerProcessing = true;
        session._workerSentAt = nowMs;
        workerBatch.push({ sessionId: session.id, runId, mode: 'online', state: session.state, rounds });
        if (isOnline) onlineEnqueued++;
        else offlineEnqueued++;
      } else if (hasReadyWorker) {
        deferredByBatchCap++;
      } else {
        const cmd = pickAutoSkill(session.state);
        const result = engine.applyCommand(session.state, cmd);
        if (!result.ok) {
          session._errorCount = (session._errorCount || 0) + 1;
          if (session._errorCount >= 3) {
            console.error('[gameLoop] 主线程 fallback 连续失败，强制终结 sessionId=%s accountId=%s error=%s',
              session.id, session.account_id, result.error || 'unknown');
            bsc.finishSession(session.id, { victory: false, rewards: {} });
            bsc.deleteSession(session.id);
          }
          continue;
        }
        const updatedState = result.state;
        const prevIdx = intVal(session.state.event_index, 0);
        const events = result.events || [];
        updatedState.event_index = prevIdx + events.length;
        session.state = updatedState;
        if (events.length > 0 && isOnline) {
          bsc.appendEvents(session.id, prevIdx + 1, events);
          _wsPushEvents(session, events, prevIdx + 1);
        }
        const newSeq = (Number(session.last_seq) || 0) + 1;
        if (result.ended) {
          const outcome = { victory: !!result.victory, draw: !!result.draw };
          if (isOnline) {
            const settleResult = await _settleBattleOnline(session, outcome);
            if (!settleResult?.ok) continue;
            if (isAutoRestartEnabled(session)) _scheduleAutoRestart(session, settleResult.rest_remaining_sec || 0);
          } else {
            const settleResult = await _settleBattleOffline(session, outcome);
            if (!settleResult?.ok) continue;
            if (isAutoRestartEnabled(session)) {
              const restSec = settleResult.rest_remaining_sec || 0;
              if (!(await _autoStartNext(session.account_id, session.map_id, 0, restSec, session.last_poll_at, settleResult.player))) {
                bsc.deleteSession(session.id);
              }
            } else {
              bsc.deleteSession(session.id);
            }
          }
        } else {
          bsc.updateSessionState(session.id, {
            state: session.state,
            lastCmdAt: nowSec,
            expiresAt: nowSec + 900,
            lastSeq: newSeq
          });
        }
      }
    } catch (err) {
      console.error('[gameLoop] tick error sessionId=%s accountId=%s:',
        session?.id, session?.account_id, err?.message);
    }
  }

  _sessionRoundRobinCursor = (_sessionRoundRobinCursor + Math.max(1, workerBatch.length || deferredByBatchCap || 1)) % sessionCount;

  if (hasReadyWorker && deferredByBatchCap > 0) {
    if (deferredByBatchCap >= AUTO_INTENT_SATURATION_DEFERRED_THRESHOLD) {
      const backoffUntil = nowSec + AUTO_INTENT_SATURATION_BACKOFF_SEC;
      if (backoffUntil > _autoIntentBackoffUntilSec) _autoIntentBackoffUntilSec = backoffUntil;
      if (nowMs - _lastAutoIntentBackoffLogAt >= 5000) {
        _lastAutoIntentBackoffLogAt = nowMs;
        console.warn('[gameLoop] auto-intent backoff %ds due to saturation deferred=%d threshold=%d active=%d enqueued=%d',
          AUTO_INTENT_SATURATION_BACKOFF_SEC,
          deferredByBatchCap,
          AUTO_INTENT_SATURATION_DEFERRED_THRESHOLD,
          sessionCount,
          workerBatch.length);
      }
    }
    const nowMsLog = Date.now();
    if (nowMsLog - _lastBatchSaturationLogAt >= 5000) {
      _lastBatchSaturationLogAt = nowMsLog;
      console.warn('[gameLoop] worker batch saturated: deferred=%d(active=%d, offlineCap=%d) active=%d enqueued=%d [online=%d offline=%d] maxBatch=%d reserve=%d offlineCap=%d offlineTick=%s cursor=%d',
        deferredByBatchCap,
        Math.max(0, deferredByBatchCap - deferredByOfflineCap),
        deferredByOfflineCap,
        sessionCount,
        workerBatch.length,
        onlineEnqueued,
        offlineEnqueued,
        MAX_WORKER_BATCH_SIZE,
        onlineReserve,
        offlineBatchCap,
        isOfflineTick ? 'Y' : 'N',
        _sessionRoundRobinCursor
      );
    }
  }

  if (workerBatch.length > 0) {
    const readyIdx = _getReadyWorkerIndices();
    if (readyIdx.length <= 0) {
      for (const item of workerBatch) {
        const s = bsc.getSession(item.sessionId);
        if (s && Number(s._workerRunId || 0) === Number(item.runId || 0)) {
          s._workerProcessing = false;
          s._workerSentAt = 0;
        }
      }
      return;
    }
    const chunkSize = Math.ceil(workerBatch.length / readyIdx.length);
    for (let wi = 0; wi < readyIdx.length; wi++) {
      const chunk = workerBatch.slice(wi * chunkSize, (wi + 1) * chunkSize);
      if (chunk.length === 0) continue;
      const wIdx = readyIdx[wi];
      for (const item of chunk) {
        const s = bsc.getSession(item.sessionId);
        if (s) s._workerIdx = wIdx;
      }
      try {
        _workers[wIdx].postMessage({ type: 'runBattleBatch', battles: chunk });
      } catch (err) {
        console.error('[gameLoop] failed to send batch to worker[%d]: %s', wIdx, err?.message);
        for (const item of chunk) {
          const s = bsc.getSession(item.sessionId);
          if (s && Number(s._workerRunId || 0) === Number(item.runId || 0)) {
            s._workerProcessing = false;
            s._workerSentAt = 0;
          }
        }
      }
    }
  }

  if (nowSec - _lastPerfLogAt >= PERF_LOG_INTERVAL_SEC) {
    _lastPerfLogAt = nowSec;
    const readyWorkerCnt = _getReadyWorkerIndices().length;
    let processingCnt = 0;
    for (const s of sessions) {
      if (s && s.status === 'active' && s._workerProcessing) processingCnt++;
    }
    console.log('[perf] sessions=%d readyWorkers=%d/%d enqueued=%d online=%d offline=%d processing=%d deferred=%d offlineDeferred=%d offlineTick=%s',
      sessionCount,
      readyWorkerCnt,
      WORKER_COUNT,
      workerBatch.length,
      onlineEnqueued,
      offlineEnqueued,
      processingCnt,
      deferredByBatchCap,
      deferredByOfflineCap,
      isOfflineTick ? 'Y' : 'N'
    );
  }
}

let _interval = null;
let _tickTimer = null;

function _scheduleTick() {
  if (!_interval) return;
  _tickTimer = setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[gameLoop] tick uncaught error:', err?.message);
    }
    _scheduleTick();
  }, TICK_INTERVAL_MS);
}

function start() {
  if (_interval) return;
  _interval = true;
  _autoIntentSweepCursor = 0;
  _lastIntentSweepAt = 0;
  _autoIntentSweepInFlight = false;
  _banScanCursor = 0;
  _spawnAllWorkers();
  _scheduleTick();
  _scheduleAutoBattleIndexRebuild(1500);
  const readyCnt = _workerReady.filter(Boolean).length;
  console.log('[gameLoop] started, interval=%dms, workers=%d/%d, cpu=%d, offlineMax=%dh, maxBatch=%d, offlineRounds=%d, hybrid=%s(sample=%ds,sampleRounds=%d), autoSweep=%ds',
    TICK_INTERVAL_MS, readyCnt, WORKER_COUNT, CPU_COUNT, OFFLINE_MAX_SEC / 3600,
    MAX_WORKER_BATCH_SIZE, OFFLINE_ROUNDS_PER_RUN,
    OFFLINE_HYBRID_ENABLED ? 'on' : 'off', OFFLINE_REAL_SAMPLE_SEC, OFFLINE_SAMPLE_ROUNDS_PER_RUN,
    AUTO_INTENT_SWEEP_INTERVAL_SEC);
  console.log('[gameLoop] auto-intent cap=%s shard=%d/%d maxStarts=%d backoff=%ds threshold=%d',
    AUTO_INTENT_ACTIVE_SESSION_CAP > 0 ? AUTO_INTENT_ACTIVE_SESSION_CAP : 'off',
    AUTO_INTENT_SHARD_INDEX,
    AUTO_INTENT_SHARD_COUNT,
    AUTO_INTENT_MAX_STARTS_PER_SWEEP,
    AUTO_INTENT_SATURATION_BACKOFF_SEC,
    AUTO_INTENT_SATURATION_DEFERRED_THRESHOLD);
}

function stop() {
  _interval = false;
  if (_tickTimer) {
    clearTimeout(_tickTimer);
    _tickTimer = null;
  }
  for (let i = 0; i < _respawnTimers.length; i++) {
    if (_respawnTimers[i]) { clearTimeout(_respawnTimers[i]); _respawnTimers[i] = null; }
  }
  for (let i = 0; i < _workers.length; i++) {
    if (_workers[i]) {
      try { _workers[i].terminate(); } catch (_) {}
      _workers[i] = null;
      _workerReady[i] = false;
    }
  }
  if (_autoBattleIndexRebuildTimer) {
    clearTimeout(_autoBattleIndexRebuildTimer);
    _autoBattleIndexRebuildTimer = null;
  }
  _autoIntentSweepInFlight = false;
  _autoIntentBackoffUntilSec = 0;
  _lastAutoIntentBackoffLogAt = 0;
  _autoBattleIndexRebuildStarted = false;
  _pendingAutoRestartSessionIds.clear();
  _banScanCursor = 0;
  console.log('[gameLoop] stopped');
}

module.exports = { start, stop, pickAutoSkill, getWorkerCount };
