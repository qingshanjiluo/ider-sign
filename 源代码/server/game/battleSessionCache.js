/**
 * 战斗会话缓存
 *
 * 运行态仍以内存 Map 为主，但关键状态会异步快照到 Redis，
 * 这样服务端重启后可以恢复服务端主导战斗与离线战报。
 */

const config = require('../config');
const redisStore = require('../redisStore');
const ops = require('./playerOps');
const cave = require('./cave');
const offlineStat = require('./offlineStatSettlement');
const { getMapById } = require('./dataLoader');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function numVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clampf(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _isNightmareMap(map) {
  if (!map || typeof map !== 'object') return false;
  if (map.is_nightmare === true) return true;
  const mapId = intVal(map.id, 0);
  if (mapId >= 10000) return true;
  const mapName = String(map.name || '');
  return mapName.startsWith('魇化');
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const OFFLINE_REPORT_TTL_SEC = 7 * 24 * 60 * 60;
const BATTLE_EVENT_HISTORY_LIMIT = (() => {
  const env = Number(process.env.BATTLE_EVENT_HISTORY_LIMIT);
  if (Number.isFinite(env) && env >= 50) return Math.floor(env);
  return 240;
})();
const BATTLE_COMMAND_HISTORY_LIMIT = (() => {
  const env = Number(process.env.BATTLE_COMMAND_HISTORY_LIMIT);
  if (Number.isFinite(env) && env >= 5) return Math.floor(env);
  return 40;
})();
const BATTLE_CACHE_PERSIST_INTERVAL_MS = (() => {
  const env = Number(process.env.BATTLE_CACHE_PERSIST_INTERVAL_MS);
  if (Number.isFinite(env) && env >= 500) return Math.min(30000, Math.floor(env));
  return 8000;
})();
const BATTLE_SNAPSHOT_INCLUDE_EVENTS = String(process.env.BATTLE_SNAPSHOT_INCLUDE_EVENTS || '1') !== '0';
const BATTLE_SNAPSHOT_INCLUDE_COMMANDS = String(process.env.BATTLE_SNAPSHOT_INCLUDE_COMMANDS || '1') !== '0';
const BATTLE_SNAPSHOT_EVENT_LIMIT = (() => {
  const env = Number(process.env.BATTLE_SNAPSHOT_EVENT_LIMIT);
  if (Number.isFinite(env) && env >= 0) return Math.floor(env);
  return 40;
})();
const BATTLE_SNAPSHOT_COMMAND_LIMIT = (() => {
  const env = Number(process.env.BATTLE_SNAPSHOT_COMMAND_LIMIT);
  if (Number.isFinite(env) && env >= 0) return Math.floor(env);
  return 8;
})();

const _sessions = new Map();
const _commands = new Map();
const _events = new Map();
const _accountIndex = new Map();

function _now() { return Math.floor(Date.now() / 1000); }
const SNAPSHOT_KEY = `${String(config.redisKeyPrefix || 'xianxia')}:battle:cache:v1`;
let _persistTimer = null;
let _persistInFlight = false;
let _persistInFlightPromise = null;
let _persistSeq = 0;
let _persistSavedSeq = 0;

function _snapshotSession(session) {
  if (!session || typeof session !== 'object') return null;
  const out = { ...session };
  // Worker 状态不应跨重启保留，否则可能造成会话短时假忙。
  delete out._workerProcessing;
  delete out._workerSentAt;
  delete out._workerIdx;
  delete out._workerRunId;
  delete out._errorCount;
  return out;
}

function _sliceTail(list, keep) {
  const arr = Array.isArray(list) ? list : [];
  const k = Math.max(0, Number(keep) || 0);
  if (k <= 0) return [];
  if (arr.length <= k) return arr;
  return arr.slice(arr.length - k);
}

function _markPersistDirty() {
  _persistSeq += 1;
}

function _snapshot() {
  const sessions = {};
  for (const [sid, session] of _sessions.entries()) {
    const snap = _snapshotSession(session);
    if (snap) sessions[String(sid)] = snap;
  }

  const commands = {};
  if (BATTLE_SNAPSHOT_INCLUDE_COMMANDS && BATTLE_SNAPSHOT_COMMAND_LIMIT > 0) {
    for (const [sid, map] of _commands.entries()) {
      if (!(map instanceof Map) || map.size <= 0) continue;
      commands[String(sid)] = _sliceTail(Array.from(map.entries()), BATTLE_SNAPSHOT_COMMAND_LIMIT);
    }
  }

  const events = {};
  if (BATTLE_SNAPSHOT_INCLUDE_EVENTS && BATTLE_SNAPSHOT_EVENT_LIMIT > 0) {
    for (const [sid, list] of _events.entries()) {
      if (!Array.isArray(list) || list.length <= 0) continue;
      events[String(sid)] = _sliceTail(list, BATTLE_SNAPSHOT_EVENT_LIMIT);
    }
  }

  return {
    saved_at: _now(),
    sessions,
    commands,
    events,
    accountIndex: Object.fromEntries(_accountIndex),
    offlineReports: Object.fromEntries(_offlineReports)
  };
}

function _resetAll() {
  _sessions.clear();
  _commands.clear();
  _events.clear();
  _accountIndex.clear();
  _offlineReports.clear();
}

function _restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  _resetAll();
  const now = _now();
  for (const [sid, session] of Object.entries(snapshot.sessions || {})) {
    if (!session || Number(session.expires_at) <= now) continue;
    const restored = { ...session };
    restored._workerProcessing = false;
    restored._workerSentAt = 0;
    restored._errorCount = 0;
    delete restored._workerIdx;
    delete restored._workerRunId;
    _sessions.set(String(sid), restored);
  }
  for (const [sid, entries] of Object.entries(snapshot.commands || {})) {
    const list = _sliceTail(Array.isArray(entries) ? entries : [], BATTLE_COMMAND_HISTORY_LIMIT);
    _commands.set(String(sid), new Map(list));
  }
  for (const [sid, events] of Object.entries(snapshot.events || {})) {
    _events.set(String(sid), _sliceTail(Array.isArray(events) ? events : [], BATTLE_EVENT_HISTORY_LIMIT));
  }
  for (const [aid, sid] of Object.entries(snapshot.accountIndex || {})) {
    if (_sessions.has(String(sid))) _accountIndex.set(Number(aid), String(sid));
  }
  for (const [aid, report] of Object.entries(snapshot.offlineReports || {})) {
    if (report && typeof report === 'object') _offlineReports.set(Number(aid), report);
  }
}

async function _persistNow() {
  if (!redisStore.isReady()) return false;
  if (_persistInFlight) return _persistInFlightPromise || false;
  if (_persistSavedSeq === _persistSeq) return true;

  _persistInFlight = true;
  const targetSeq = _persistSeq;
  _persistInFlightPromise = (async () => {
    try {
      await redisStore.setJson(SNAPSHOT_KEY, _snapshot());
      _persistSavedSeq = targetSeq;
      return true;
    } catch (err) {
      console.error('[battleSessionCache] persist failed:', err?.message || err);
      return false;
    } finally {
      _persistInFlight = false;
      _persistInFlightPromise = null;
      if (_persistSavedSeq !== _persistSeq && !_persistTimer && redisStore.isReady()) {
        _persistTimer = setTimeout(() => {
          _persistTimer = null;
          _persistNow().catch(() => {});
        }, BATTLE_CACHE_PERSIST_INTERVAL_MS);
      }
    }
  })();
  return _persistInFlightPromise;
}

function _schedulePersist() {
  if (!redisStore.isReady()) return;
  _markPersistDirty();
  if (_persistTimer || _persistInFlight) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    _persistNow().catch(() => {});
  }, BATTLE_CACHE_PERSIST_INTERVAL_MS);
}

async function initPersistence() {
  await redisStore.init();
  if (!redisStore.isReady()) return false;
  try {
    const snapshot = await redisStore.getJson(SNAPSHOT_KEY);
    if (snapshot) _restoreSnapshot(snapshot);
    _cleanup();
    return true;
  } catch (err) {
    console.error('[battleSessionCache] restore failed:', err?.message || err);
    return false;
  }
}

async function flushPersistence() {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  _markPersistDirty();
  return _persistNow();
}

function createSession(id, accountId, mapId, enemyId, ttlSeconds = 900, state = {}) {
  const aid = Number(accountId);
  const oldSid = _accountIndex.get(aid);
  if (oldSid && oldSid !== String(id)) {
    _sessions.delete(oldSid);
    _commands.delete(oldSid);
    _events.delete(oldSid);
  }
  const now = _now();
  const session = {
    id: String(id),
    account_id: aid,
    map_id: mapId,
    enemy_id: enemyId,
    started_at: now,
    expires_at: now + ttlSeconds,
    status: 'active',
    state: state || {},
    last_seq: 0,
    result: {},
    ended_at: 0,
    last_cmd_at: now,
    rng_seed: Math.floor(Math.random() * 2147483647),
    rng_cursor: 0
  };
  _sessions.set(String(id), session);
  _commands.set(String(id), new Map());
  _events.set(String(id), []);
  _accountIndex.set(aid, String(id));
  _schedulePersist();
}

function getSession(id) {
  const s = _sessions.get(String(id));
  if (!s) return null;
  if (s.expires_at <= _now()) {
    deleteSession(id);
    return null;
  }
  return s;
}

function getActiveSessionByAccount(accountId) {
  const sid = _accountIndex.get(Number(accountId));
  if (!sid) return null;
  const s = _sessions.get(sid);
  if (!s || s.status !== 'active' || s.expires_at <= _now()) {
    _accountIndex.delete(Number(accountId));
    if (s) deleteSession(sid);
    return null;
  }
  return s;
}

function getAnySessionByAccount(accountId) {
  const sid = _accountIndex.get(Number(accountId));
  if (!sid) return null;
  const s = _sessions.get(sid);
  if (!s || s.expires_at <= _now()) {
    _accountIndex.delete(Number(accountId));
    if (s) deleteSession(sid);
    return null;
  }
  return s;
}

function updateSessionState(id, { state, lastSeq, status, result, endedAt, lastCmdAt, expiresAt, rngCursor } = {}) {
  const s = _sessions.get(String(id));
  if (!s) return;
  if (state !== undefined && state !== null) s.state = state;
  if (lastSeq !== undefined && lastSeq !== null) s.last_seq = Math.max(0, Number(lastSeq) || 0);
  if (status !== undefined && status !== null) s.status = String(status);
  if (result !== undefined && result !== null) s.result = result;
  if (endedAt !== undefined && endedAt !== null) s.ended_at = Number(endedAt) || 0;
  if (lastCmdAt !== undefined && lastCmdAt !== null) s.last_cmd_at = Number(lastCmdAt) || 0;
  if (expiresAt !== undefined && expiresAt !== null) s.expires_at = Number(expiresAt) || 0;
  if (rngCursor !== undefined && rngCursor !== null) s.rng_cursor = Number(rngCursor) || 0;
  _schedulePersist();
}

function finishSession(id, result = {}) {
  const s = _sessions.get(String(id));
  if (!s) return null;
  // 幂等保护：已完成的会话不重复结算
  if (s.status === 'finished') return s;
  const now = _now();
  s.status = 'finished';
  s.result = result;
  s.ended_at = now;
  s.last_cmd_at = now;
  s.expires_at = now + 120;
  _schedulePersist();
  return s;
}

function deleteSession(id) {
  const sid = String(id);
  const s = _sessions.get(sid);
  if (s) _accountIndex.delete(s.account_id);
  _sessions.delete(sid);
  _commands.delete(sid);
  _events.delete(sid);
  _schedulePersist();
}

function appendCommand(battleId, seq, command, applyResult = {}) {
  const cmds = _commands.get(String(battleId));
  if (!cmds) return;
  cmds.set(Number(seq), {
    battle_id: String(battleId),
    seq: Number(seq),
    command: command || {},
    apply_result: applyResult || {},
    recv_at: _now()
  });
  while (cmds.size > BATTLE_COMMAND_HISTORY_LIMIT) {
    const oldestKey = cmds.keys().next().value;
    if (oldestKey === undefined) break;
    cmds.delete(oldestKey);
  }
  _schedulePersist();
}

function getCommand(battleId, seq) {
  const cmds = _commands.get(String(battleId));
  if (!cmds) return null;
  return cmds.get(Number(seq)) || null;
}

function appendEvents(battleId, startIndex, events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length <= 0) return 0;
  let evtArr = _events.get(String(battleId));
  if (!evtArr) { evtArr = []; _events.set(String(battleId), evtArr); }
  const now = _now();
  for (let i = 0; i < list.length; i++) {
    const idx = Math.max(1, Number(startIndex) || 1) + i;
    evtArr.push({ event_index: idx, event: list[i] || {}, created_at: now });
  }
  if (evtArr.length > BATTLE_EVENT_HISTORY_LIMIT) {
    evtArr.splice(0, evtArr.length - BATTLE_EVENT_HISTORY_LIMIT);
  }
  _schedulePersist();
  return list.length;
}

function listEventsSince(battleId, afterIndex = 0, limit = 200) {
  const evtArr = _events.get(String(battleId));
  if (!evtArr) return [];
  const after = Math.max(0, Number(afterIndex) || 0);
  const maxN = Math.max(1, Math.min(500, Number(limit) || 200));
  const result = [];
  for (const e of evtArr) {
    if (e.event_index > after) {
      result.push(e);
      if (result.length >= maxN) break;
    }
  }
  return result;
}

function getEventWindowInfo(battleId) {
  const evtArr = _events.get(String(battleId));
  if (!evtArr || evtArr.length === 0) {
    return { count: 0, firstIndex: 0, lastIndex: 0 };
  }
  return {
    count: evtArr.length,
    firstIndex: Number(evtArr[0]?.event_index) || 0,
    lastIndex: Number(evtArr[evtArr.length - 1]?.event_index) || 0
  };
}

function _cleanup() {
  const now = _now();
  let changed = false;
  for (const [sid, s] of _sessions) {
    if (s.expires_at <= now) {
      _accountIndex.delete(s.account_id);
      _sessions.delete(sid);
      _commands.delete(sid);
      _events.delete(sid);
      changed = true;
    }
  }
  for (const [aid, report] of _offlineReports) {
    const lastAt = Math.max(
      Number(report?.updated_at) || 0,
      Number(report?.since) || 0,
      Number(report?.delivered_at) || 0
    );
    if (lastAt > 0 && now - lastAt > OFFLINE_REPORT_TTL_SEC) {
      _offlineReports.delete(aid);
      changed = true;
    }
  }
  if (changed) _schedulePersist();
}

setInterval(_cleanup, CLEANUP_INTERVAL_MS);

function getAllActiveSessions() {
  const result = [];
  const now = _now();
  for (const [sid, s] of _sessions) {
    if (s.status === 'active' && s.expires_at > now) result.push(s);
  }
  return result;
}

function getAllSessions() {
  const result = [];
  const now = _now();
  for (const [, s] of _sessions) {
    if (s.expires_at > now) result.push(s);
  }
  return result;
}

function trimEvents(battleId, keepLast = 500) {
  const evtArr = _events.get(String(battleId));
  if (!evtArr || evtArr.length <= keepLast) return;
  _events.set(String(battleId), evtArr.slice(-keepLast));
  _schedulePersist();
}

// ── 离线战报累计 ──
const _offlineReports = new Map();

function _ensureOfflineStatProfile(report, nowSec = _now(), fallbackMapId = 0) {
  if (!report || typeof report !== 'object') return null;
  if (!report.stat_profile || typeof report.stat_profile !== 'object' || Array.isArray(report.stat_profile)) {
    report.stat_profile = {
      enabled: false,
      map_id: Math.max(0, intVal(fallbackMapId, 0)),
      sample_end_at: 0,
      settled_until: intVal(nowSec, _now()),
      sample_battles: 0,
      sample_wins: 0,
      sample_draws: 0,
      sample_elapsed_sec: 0,
      sample_exp_wins_sum: 0,
      sample_spirit_wins_sum: 0,
      sample_exp_base_wins_sum: 0,
      sample_spirit_base_wins_sum: 0,
      est_battles: 0,
      est_wins: 0
    };
  }
  const profile = report.stat_profile;
  const mapId = Math.max(0, intVal(fallbackMapId, 0));
  if (mapId > 0 && intVal(profile.map_id, 0) <= 0) {
    profile.map_id = mapId;
  }
  if (intVal(profile.settled_until, 0) <= 0) {
    profile.settled_until = intVal(nowSec, _now());
  }
  return profile;
}

function accumulateOfflineReport(accountId, data) {
  const aid = Number(accountId);
  let acc = _offlineReports.get(aid);
  if (!acc) {
    acc = {
      battles: 0, wins: 0, losses: 0, draws: 0, total_exp: 0, total_spirit_stones: 0,
      drops: [], technique_ups: [], skill_ups: [], since: _now(), updated_at: _now(),
      stat_profile: null
    };
    _offlineReports.set(aid, acc);
  }
  const nowSec = _now();
  const profile = _ensureOfflineStatProfile(acc, nowSec, intVal(data?.map_id, 0));
  if (!Number.isFinite(Number(acc.draws))) acc.draws = 0;
  acc.battles++;
  acc.updated_at = nowSec;
  if (data.draw) acc.draws++;
  else if (data.victory) acc.wins++;
  else acc.losses++;
  const grantRewards = Boolean(data.victory) && !Boolean(data.draw);
  if (grantRewards) acc.total_exp += Math.max(0, Number(data.exp) || 0);
  if (grantRewards) acc.total_spirit_stones += Math.max(0, Number(data.spirit_stones) || 0);
  if (grantRewards && Array.isArray(data.drops)) {
    for (const d of data.drops) {
      if (!d || !d.item_id) continue;
      const existing = acc.drops.find(x => x.item_id === d.item_id);
      if (existing) existing.count = (existing.count || 0) + (d.count || 1);
      else acc.drops.push({ item_id: d.item_id, item_name: d.item_name || d.name || '', count: d.count || 1 });
    }
  }
  if (grantRewards && Array.isArray(data.technique_ups)) {
    for (const t of data.technique_ups) {
      const ex = acc.technique_ups.find(x => x.id === t.id);
      if (ex) { if (t.level > ex.level) ex.level = t.level; }
      else acc.technique_ups.push({ ...t });
    }
  }
  if (grantRewards && Array.isArray(data.skill_ups)) {
    for (const s of data.skill_ups) {
      const ex = acc.skill_ups.find(x => x.id === s.id);
      if (ex) { if (s.level > ex.level) ex.level = s.level; }
      else acc.skill_ups.push({ ...s });
    }
  }

  if (profile && profile.enabled !== true) {
    profile.sample_battles = Math.max(0, intVal(profile.sample_battles, 0)) + 1;
    if (data.draw) profile.sample_draws = Math.max(0, intVal(profile.sample_draws, 0)) + 1;
    else if (data.victory) profile.sample_wins = Math.max(0, intVal(profile.sample_wins, 0)) + 1;
    const sampledElapsed = Math.max(0.2, numVal(data?.cycle_seconds, numVal(data?.battle_seconds, 1)));
    profile.sample_elapsed_sec = Math.max(0, numVal(profile.sample_elapsed_sec, 0)) + sampledElapsed;
    if (data.victory) {
      profile.sample_exp_wins_sum = Math.max(0, numVal(profile.sample_exp_wins_sum, 0)) + Math.max(0, numVal(data?.exp, 0));
      profile.sample_spirit_wins_sum = Math.max(0, numVal(profile.sample_spirit_wins_sum, 0)) + Math.max(0, numVal(data?.spirit_stones, 0));
      profile.sample_exp_base_wins_sum = Math.max(0, numVal(profile.sample_exp_base_wins_sum, 0))
        + Math.max(0, numVal(data?.exp_base, numVal(data?.exp, 0)));
      profile.sample_spirit_base_wins_sum = Math.max(0, numVal(profile.sample_spirit_base_wins_sum, 0))
        + Math.max(0, numVal(data?.spirit_base, numVal(data?.spirit_stones, 0)));
    }
  }

  _schedulePersist();
  return acc;
}

function activateOfflineStatMode(accountId, options = {}) {
  const aid = Number(accountId);
  if (aid <= 0) return { ok: false, error: 'invalid_account' };

  let acc = _offlineReports.get(aid);
  const nowSec = Math.max(0, intVal(options?.nowSec, _now()));
  if (!acc) {
    acc = {
      battles: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      total_exp: 0,
      total_spirit_stones: 0,
      drops: [],
      technique_ups: [],
      skill_ups: [],
      since: nowSec,
      updated_at: nowSec,
      stat_profile: null
    };
    _offlineReports.set(aid, acc);
  }

  const profile = _ensureOfflineStatProfile(acc, nowSec, intVal(options?.mapId, 0));
  if (!profile) return { ok: false, error: 'profile_init_failed' };

  const mapId = Math.max(0, intVal(options?.mapId, 0));
  if (mapId > 0) profile.map_id = mapId;
  if (profile.enabled !== true) {
    profile.enabled = true;
    profile.sample_end_at = nowSec;
    profile.settled_until = nowSec;
  }

  acc.updated_at = nowSec;
  _schedulePersist();
  return {
    ok: true,
    enabled: true,
    map_id: Math.max(0, intVal(profile.map_id, 0)),
    sample_battles: Math.max(0, intVal(profile.sample_battles, 0))
  };
}

function isOfflineStatModeActive(accountId) {
  const aid = Number(accountId);
  if (aid <= 0) return false;
  const acc = _offlineReports.get(aid);
  if (!acc || typeof acc !== 'object') return false;
  const profile = acc.stat_profile;
  return !!(profile && typeof profile === 'object' && profile.enabled === true);
}

function deactivateOfflineStatMode(accountId, nowSec = _now()) {
  const aid = Number(accountId);
  if (aid <= 0) return false;
  const acc = _offlineReports.get(aid);
  if (!acc || typeof acc !== 'object') return false;
  const profile = _ensureOfflineStatProfile(acc, nowSec, 0);
  if (!profile) return false;
  const ts = Math.max(0, intVal(nowSec, _now()));
  profile.enabled = false;
  profile.settled_until = Math.max(intVal(profile.settled_until, 0), ts);
  acc.updated_at = ts;
  _schedulePersist();
  return true;
}

function _calcAlignedActiveRatioByExpire(expiresAt, startSec, endSec) {
  const s = Math.max(0, intVal(startSec, 0));
  const e = Math.max(s, intVal(endSec, s));
  const exp = Math.max(0, intVal(expiresAt, 0));
  const total = Math.max(1, e - s);
  if (exp <= s) return 0;
  const activeSec = Math.max(0, Math.min(e, exp) - s);
  return clampf(activeSec / total, 0, 1);
}

function _getTaixuAlignedMultiplier(player, buffKey, startSec, endSec, taixuMinValue) {
  const buffs = player && typeof player.timed_buffs === 'object' && !Array.isArray(player.timed_buffs)
    ? player.timed_buffs
    : null;
  if (!buffs) return 1;
  const b = buffs[String(buffKey || '')];
  if (!b || typeof b !== 'object') return 1;
  const value = Math.max(0, numVal(b.value, 0));
  if (value < Math.max(0, numVal(taixuMinValue, 0))) return 1;
  const ratio = _calcAlignedActiveRatioByExpire(intVal(b.expires_at, 0), startSec, endSec);
  if (ratio <= 0) return 1;
  return 1 + value * ratio;
}

function _scaleCountByMultiplier(count, mult) {
  const c = Math.max(0, intVal(count, 0));
  const m = Math.max(0, numVal(mult, 1));
  if (c <= 0 || m <= 0) return 0;
  const raw = c * m;
  const flo = Math.floor(raw);
  const frac = raw - flo;
  if (frac > 0 && Math.random() < frac) return flo + 1;
  return flo;
}

function settleOfflineStatProjection(accountId, player, nowSec = _now()) {
  if (!offlineStat.OFFLINE_HYBRID_ENABLED) return null;

  const aid = Number(accountId);
  if (aid <= 0 || !player || typeof player !== 'object') return null;

  const acc = _offlineReports.get(aid);
  if (!acc || typeof acc !== 'object') return null;

  const profile = _ensureOfflineStatProfile(acc, nowSec, 0);
  if (!profile || profile.enabled !== true) return null;

  const settledStartSec = Math.max(0, intVal(profile.settled_until, nowSec));
  const projection = offlineStat.buildProjectionFromProfile(profile, nowSec);
  const settledEndSec = Math.max(settledStartSec, intVal(projection?.settled_until, settledStartSec));
  const battles = Math.max(0, intVal(projection?.battles, 0));
  if (battles <= 0) {
    const settledUntil = Math.max(0, intVal(projection?.settled_until, intVal(profile.settled_until, nowSec)));
    profile.settled_until = settledUntil;
    acc.updated_at = Math.max(0, intVal(nowSec, _now()));
    _schedulePersist();
    return {
      ok: true,
      applied: false,
      battles: 0,
      wins: 0,
      losses: 0,
      exp_gain: 0,
      spirit_gain: 0,
      drops: []
    };
  }

  const wins = Math.max(0, intVal(projection?.wins, 0));
  const losses = Math.max(0, intVal(projection?.losses, Math.max(0, battles - wins)));
  let expGain = Math.max(0, intVal(projection?.exp_gain, 0));
  let spiritGain = Math.max(0, intVal(projection?.spirit_gain, 0));

  // 统计投影基于去buff样本，这里补回在线乘区并按时间窗对齐到期。
  const taixuExpMult = _getTaixuAlignedMultiplier(player, 'exp_gain_pct', settledStartSec, settledEndSec, 64);
  const taixuDropMult = _getTaixuAlignedMultiplier(player, 'drop_rate_pct', settledStartSec, settledEndSec, 30);
  const enlightPct = Math.max(0, numVal(player?.enlightenment_buff_pct, 0)) / 100;
  const enlightRatio = _calcAlignedActiveRatioByExpire(
    intVal(player?.enlightenment_buff_expires_at, 0),
    settledStartSec,
    settledEndSec
  );
  const enlightMult = 1 + enlightPct * enlightRatio;
  const wildMods = cave.getFormationWildBattleModifiers(player);
  const wildExpMult = 1 + Math.max(0, numVal(wildMods?.wild_exp_bonus_pct, 0));
  const wildDropMult = Math.max(0, numVal(wildMods?.wild_drop_rate_mult, 1));
  const mapId = Math.max(0, intVal(profile?.map_id, intVal(player?.current_map_id, 0)));
  const mapInfo = getMapById(mapId);
  const nightmareDropMult = _isNightmareMap(mapInfo) ? 3.5 : 1.0;
  const expMult = Math.max(0, taixuExpMult * enlightMult * wildExpMult);
  const dropMult = Math.max(0, taixuDropMult * wildDropMult * nightmareDropMult);
  if (expGain > 0 && expMult > 0) expGain = Math.max(0, Math.floor(expGain * expMult));
  if (spiritGain > 0 && dropMult > 0) spiritGain = Math.max(0, Math.floor(spiritGain * dropMult));

  const abnormalRepay = ops.consumeAbnormalGainRepay(player, {
    exp: expGain,
    spirit_stones: spiritGain
  });
  expGain = Math.max(0, intVal(abnormalRepay.exp, 0));
  spiritGain = Math.max(0, intVal(abnormalRepay.spirit_stones, 0));

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);

  if (expGain > 0) player.exp = Math.max(0, intVal(player.exp, 0) + expGain);
  if (spiritGain > 0) player.spirit_stones = Math.max(0, intVal(player.spirit_stones, 0) + spiritGain);

  const appliedDrops = [];
  for (const row of (Array.isArray(projection?.drops) ? projection.drops : [])) {
    const item = row?.item;
    const itemId = Math.max(0, intVal(row?.item_id, intVal(item?.id, 0)));
    const rawCnt = Math.max(0, intVal(row?.count, 0));
    const cnt = _scaleCountByMultiplier(rawCnt, dropMult);
    if (!item || itemId <= 0 || cnt <= 0) continue;
    const itemType = String(item?.type || '');
    let appliedCount = 0;
    if (itemType === 'array_rune' || itemType === 'array_plate') {
      const stored = cave.addFormationItems(player, item, cnt, nowSec);
      appliedCount = Math.max(0, intVal(stored?.added, 0));
    } else {
      const ok = ops.putItemInInventory(player.inventory, item, cnt);
      if (!ok) continue;
      appliedCount = cnt;
    }
    if (appliedCount <= 0) continue;
    appliedDrops.push({
      item_id: itemId,
      item_name: String(row?.item_name || item?.name || `物品${itemId}`),
      count: appliedCount
    });
  }

  acc.battles = Math.max(0, intVal(acc.battles, 0)) + battles;
  acc.wins = Math.max(0, intVal(acc.wins, 0)) + wins;
  acc.losses = Math.max(0, intVal(acc.losses, 0)) + losses;
  acc.total_exp = Math.max(0, intVal(acc.total_exp, 0)) + expGain;
  acc.total_spirit_stones = Math.max(0, intVal(acc.total_spirit_stones, 0)) + spiritGain;
  acc.drops = offlineStat.mergeDropCountList(Array.isArray(acc.drops) ? acc.drops : [], appliedDrops);

  profile.est_battles = Math.max(0, intVal(profile.est_battles, 0)) + battles;
  profile.est_wins = Math.max(0, intVal(profile.est_wins, 0)) + wins;
  profile.settled_until = Math.max(0, intVal(projection?.settled_until, intVal(profile.settled_until, nowSec)));
  acc.updated_at = Math.max(0, intVal(nowSec, _now()));

  _schedulePersist();

  return {
    ok: true,
    applied: true,
    battles,
    wins,
    losses,
    exp_gain: expGain,
    spirit_gain: spiritGain,
    abnormal_repay: {
      repaid_exp: Math.max(0, intVal(abnormalRepay.repaid_exp, 0)),
      repaid_spirit_stones: Math.max(0, intVal(abnormalRepay.repaid_spirit_stones, 0)),
      debt_exp_left: Math.max(0, intVal(abnormalRepay.debt_exp_left, 0)),
      debt_spirit_left: Math.max(0, intVal(abnormalRepay.debt_spirit_left, 0))
    },
    drops: appliedDrops,
    applied_multipliers: {
      taixu_exp_mult: taixuExpMult,
      taixu_drop_mult: taixuDropMult,
      enlightenment_mult: enlightMult,
      wild_exp_mult: wildExpMult,
      wild_drop_mult: wildDropMult,
      nightmare_drop_mult: nightmareDropMult
    },
    avg_battle_sec: numVal(projection?.avg_battle_sec, 0),
    win_rate: numVal(projection?.win_rate, 0)
  };
}

function getOfflineReport(accountId) {
  const aid = Number(accountId);
  const report = _offlineReports.get(aid);
  if (!report) return null;
  if (!Number.isFinite(Number(report.draws))) report.draws = 0;
  const endSec = Math.max(Number(report.updated_at) || 0, Number(report.since) || 0, _now());
  const offlineSec = Math.max(0, endSec - (report.since || endSec));
  const winRate = report.battles > 0 ? Math.round(report.wins / report.battles * 100) : 0;
  const drops = Array.isArray(report.drops)
    ? report.drops.map((d) => ({
      item_id: intVal(d?.item_id, 0),
      item_name: String(d?.item_name || ''),
      count: Math.max(0, intVal(d?.count, 0))
    })).filter((d) => d.item_id > 0 && d.count > 0)
    : [];
  const techniqueUps = Array.isArray(report.technique_ups)
    ? report.technique_ups.map((t) => ({ ...t }))
    : [];
  const skillUps = Array.isArray(report.skill_ups)
    ? report.skill_ups.map((s) => ({ ...s }))
    : [];
  return {
    ...report,
    drops,
    technique_ups: techniqueUps,
    skill_ups: skillUps,
    offline_seconds: offlineSec,
    exp_gained: report.total_exp,
    spirit_gained: report.total_spirit_stones,
    win_rate: winRate,
    boosted_battles: 0
  };
}

function getAndClearOfflineReport(accountId) {
  const aid = Number(accountId);
  const report = getOfflineReport(aid);
  if (!report) return null;
  _offlineReports.delete(aid);
  _schedulePersist();
  return report;
}

function _subtractDropCountList(target, consumed) {
  const out = Array.isArray(target) ? target : [];
  for (const d of (Array.isArray(consumed) ? consumed : [])) {
    const itemId = intVal(d?.item_id, 0);
    const cnt = Math.max(0, intVal(d?.count, 0));
    if (itemId <= 0 || cnt <= 0) continue;
    const idx = out.findIndex((x) => intVal(x?.item_id, 0) === itemId);
    if (idx < 0) continue;
    const nextCnt = Math.max(0, intVal(out[idx]?.count, 0) - cnt);
    if (nextCnt <= 0) out.splice(idx, 1);
    else out[idx].count = nextCnt;
  }
  return out;
}

function ackOfflineReport(accountId, claimedReport) {
  const aid = Number(accountId);
  const current = _offlineReports.get(aid);
  if (!current || !claimedReport || typeof claimedReport !== 'object') {
    return { ok: false, cleared: false, remaining_battles: 0 };
  }

  const claimedBattles = Math.max(0, intVal(claimedReport?.battles, 0));
  const claimedWins = Math.max(0, intVal(claimedReport?.wins, 0));
  const claimedLosses = Math.max(0, intVal(claimedReport?.losses, 0));
  const claimedDraws = Math.max(0, intVal(claimedReport?.draws, 0));
  const claimedExp = Math.max(0, intVal(claimedReport?.total_exp, claimedReport?.exp_gained));
  const claimedSpirit = Math.max(0, intVal(claimedReport?.total_spirit_stones, claimedReport?.spirit_gained));

  current.battles = Math.max(0, intVal(current.battles, 0) - claimedBattles);
  current.wins = Math.max(0, intVal(current.wins, 0) - claimedWins);
  current.losses = Math.max(0, intVal(current.losses, 0) - claimedLosses);
  current.draws = Math.max(0, intVal(current.draws, 0) - claimedDraws);
  current.total_exp = Math.max(0, intVal(current.total_exp, 0) - claimedExp);
  current.total_spirit_stones = Math.max(0, intVal(current.total_spirit_stones, 0) - claimedSpirit);
  current.drops = _subtractDropCountList(Array.isArray(current.drops) ? current.drops : [], claimedReport?.drops);

  const shouldClear = current.battles <= 0
    && current.wins <= 0
    && current.losses <= 0
    && current.draws <= 0
    && current.total_exp <= 0
    && current.total_spirit_stones <= 0
    && (!Array.isArray(current.drops) || current.drops.length <= 0);

  if (shouldClear) {
    _offlineReports.delete(aid);
    _schedulePersist();
    return { ok: true, cleared: true, remaining_battles: 0 };
  }

  current.updated_at = _now();
  // 部分确认时将展示起点推进到当前，避免残留极小差量仍显示整段旧离线时长。
  current.since = current.updated_at;
  _offlineReports.set(aid, current);
  _schedulePersist();
  return { ok: true, cleared: false, remaining_battles: Math.max(0, intVal(current.battles, 0)) };
}

function getStats() {
  return {
    sessions: _sessions.size,
    commands: _commands.size,
    events: _events.size,
    accounts: _accountIndex.size,
    offlineReports: _offlineReports.size
  };
}

module.exports = {
  createSession,
  getSession,
  getActiveSessionByAccount,
  getAnySessionByAccount,
  getAllActiveSessions,
  getAllSessions,
  initPersistence,
  flushPersistence,
  updateSessionState,
  finishSession,
  deleteSession,
  appendCommand,
  getCommand,
  appendEvents,
  listEventsSince,
  getEventWindowInfo,
  trimEvents,
  getOfflineReport,
  accumulateOfflineReport,
  activateOfflineStatMode,
  isOfflineStatModeActive,
  deactivateOfflineStatMode,
  settleOfflineStatProjection,
  getAndClearOfflineReport,
  ackOfflineReport,
  getStats
};
