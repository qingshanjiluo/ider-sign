const config = require('../config');
const redisStore = require('../redisStore');

let _dbAsync = null;
function _getDbAsync() {
  if (!_dbAsync) _dbAsync = require('../dbAsync');
  return _dbAsync;
}

const LOCAL_TTL_SEC = (() => {
  const v = Number(process.env.BAN_CACHE_LOCAL_TTL_SEC);
  return Number.isFinite(v) && v > 0 ? Math.max(1, Math.floor(v)) : 8;
})();

const REDIS_TTL_SEC = (() => {
  const v = Number(process.env.BAN_CACHE_REDIS_TTL_SEC);
  return Number.isFinite(v) && v > 0 ? Math.max(5, Math.floor(v)) : 60;
})();

const LOCAL_JITTER_PCT = (() => {
  const v = Number(process.env.BAN_CACHE_LOCAL_JITTER_PCT);
  return Number.isFinite(v) && v >= 0 ? Math.max(0, Math.min(200, Math.floor(v))) : 25;
})();

const STALE_GRACE_SEC = (() => {
  const v = Number(process.env.BAN_CACHE_STALE_GRACE_SEC);
  return Number.isFinite(v) && v >= 0 ? Math.max(0, Math.floor(v)) : 45;
})();

const METRICS_ENABLED = (() => {
  const raw = String(process.env.BAN_CACHE_METRICS_ENABLED || '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
})();

const METRICS_INTERVAL_SEC = (() => {
  const v = Number(process.env.BAN_CACHE_METRICS_INTERVAL_SEC);
  return Number.isFinite(v) && v > 0 ? Math.max(10, Math.floor(v)) : 60;
})();

const MAX_LOCAL_SIZE = (() => {
  const v = Number(process.env.BAN_CACHE_MAX_LOCAL_SIZE);
  return Number.isFinite(v) && v > 0 ? Math.max(1000, Math.floor(v)) : 50000;
})();

const _cache = new Map(); // accountId -> { banned, exp, staleExp, updatedAt }
const _redisInflight = new Set();
const _fallbackRefreshInflight = new Set();
const _metrics = {
  startedAt: Date.now(),
  localHit: 0,
  localStaleHit: 0,
  redisWarmHit: 0,
  redisWarmMiss: 0,
  redisWarmErr: 0,
  redisDisabled: 0,
  syncFallback: 0,
  asyncFallbackRefresh: 0,
  asyncFallbackErr: 0
};

function _nowSec() {
  return Math.floor(Date.now() / 1000);
}

function _metric(name, delta = 1) {
  if (!METRICS_ENABLED) return;
  if (!Object.prototype.hasOwnProperty.call(_metrics, name)) return;
  _metrics[name] += Number(delta) || 0;
}

function _emitMetrics() {
  if (!METRICS_ENABLED) return;
  const sec = Math.max(1, Math.floor((Date.now() - _metrics.startedAt) / 1000));
  const total = _metrics.localHit + _metrics.localStaleHit + _metrics.syncFallback;
  if (total <= 0 && _metrics.redisWarmHit <= 0 && _metrics.redisWarmMiss <= 0 && _metrics.redisWarmErr <= 0 && _metrics.redisDisabled <= 0) {
    _metrics.startedAt = Date.now();
    return;
  }
  console.log(
    '[ban-cache] win=%ss localHit=%d staleHit=%d syncFallback=%d redisHit=%d redisMiss=%d redisErr=%d redisDisabled=%d asyncRefresh=%d asyncErr=%d size=%d',
    sec,
    _metrics.localHit,
    _metrics.localStaleHit,
    _metrics.syncFallback,
    _metrics.redisWarmHit,
    _metrics.redisWarmMiss,
    _metrics.redisWarmErr,
    _metrics.redisDisabled,
    _metrics.asyncFallbackRefresh,
    _metrics.asyncFallbackErr,
    _cache.size
  );
  _metrics.startedAt = Date.now();
  _metrics.localHit = 0;
  _metrics.localStaleHit = 0;
  _metrics.redisWarmHit = 0;
  _metrics.redisWarmMiss = 0;
  _metrics.redisWarmErr = 0;
  _metrics.redisDisabled = 0;
  _metrics.syncFallback = 0;
  _metrics.asyncFallbackRefresh = 0;
  _metrics.asyncFallbackErr = 0;
}

if (METRICS_ENABLED) {
  const timer = setInterval(() => {
    try { _emitMetrics(); } catch (_) {}
  }, METRICS_INTERVAL_SEC * 1000);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

function _key(accountId) {
  return `${String(config.redisKeyPrefix || 'xianxia')}:account:ban:${Number(accountId) || 0}`;
}

function _compactIfNeeded() {
  if (_cache.size <= MAX_LOCAL_SIZE) return;
  const now = _nowSec();
  for (const [aid, row] of _cache) {
    if (Number(row?.exp || 0) <= now) _cache.delete(aid);
    if (_cache.size <= MAX_LOCAL_SIZE) return;
  }
  if (_cache.size <= MAX_LOCAL_SIZE) return;
  let removed = 0;
  for (const aid of _cache.keys()) {
    _cache.delete(aid);
    removed += 1;
    if (_cache.size <= MAX_LOCAL_SIZE || removed >= 1024) break;
  }
}

function _withJitter(ttlSec) {
  const base = Math.max(1, Math.floor(Number(ttlSec) || LOCAL_TTL_SEC));
  if (LOCAL_JITTER_PCT <= 0) return base;
  const extra = Math.floor(base * (LOCAL_JITTER_PCT / 100) * Math.random());
  return Math.max(1, base + extra);
}

function _setLocal(accountId, banned, ttlSec = LOCAL_TTL_SEC) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  const ttl = _withJitter(ttlSec);
  const now = _nowSec();
  _cache.set(aid, {
    banned: !!banned,
    exp: now + ttl,
    staleExp: now + ttl + Math.max(0, STALE_GRACE_SEC),
    updatedAt: now
  });
  _compactIfNeeded();
}

function _writeRedis(accountId, banned) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  if (!redisStore.isReady()) return;
  redisStore
    .setJson(_key(aid), { banned: !!banned, updated_at: _nowSec() }, REDIS_TTL_SEC)
    .catch(() => {});
}

function _warmFromRedis(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  if (!redisStore.isReady()) {
    _metric('redisDisabled');
    return;
  }
  if (_redisInflight.has(aid)) return;
  _redisInflight.add(aid);
  redisStore
    .getJson(_key(aid))
    .then((row) => {
      if (!row || typeof row !== 'object' || typeof row.banned === 'undefined') {
        _metric('redisWarmMiss');
        return;
      }
      _setLocal(aid, !!row.banned, LOCAL_TTL_SEC);
      _metric('redisWarmHit');
    })
    .catch(() => {
      _metric('redisWarmErr');
    })
    .finally(() => {
      _redisInflight.delete(aid);
    });
}

function _refreshFromFallbackAsync(accountId, _fallbackFn) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  if (_fallbackRefreshInflight.has(aid)) return;
  _fallbackRefreshInflight.add(aid);
  Promise.resolve().then(async () => {
    try {
      const dbAsync = _getDbAsync();
      const banned = !!(await dbAsync.isAccountBanned(aid));
      _setLocal(aid, banned, LOCAL_TTL_SEC);
      _writeRedis(aid, banned);
      _metric('asyncFallbackRefresh');
    } catch (_) {
      _metric('asyncFallbackErr');
    } finally {
      _fallbackRefreshInflight.delete(aid);
    }
  });
}

function isBanned(accountId, fallbackFn) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;

  const now = _nowSec();
  const row = _cache.get(aid);
  if (row && Number(row.exp || 0) > now) {
    _metric('localHit');
    return !!row.banned;
  }

  if (row && Number(row.staleExp || 0) > now) {
    _metric('localStaleHit');
    _warmFromRedis(aid);
    _refreshFromFallbackAsync(aid, fallbackFn);
    return !!row.banned;
  }

  _warmFromRedis(aid);

  let banned = false;
  if (row) {
    banned = !!row.banned;
  }
  if (typeof fallbackFn === 'function') {
    _refreshFromFallbackAsync(aid, fallbackFn);
    _metric('asyncFallbackDeferred');
  }

  _setLocal(aid, banned, LOCAL_TTL_SEC);
  _writeRedis(aid, banned);
  return banned;
}

function mark(accountId, banned, ttlSec = LOCAL_TTL_SEC) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  _setLocal(aid, !!banned, ttlSec);
  _writeRedis(aid, !!banned);
}

function invalidate(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  _cache.delete(aid);
}

module.exports = {
  isBanned,
  mark,
  invalidate
};
