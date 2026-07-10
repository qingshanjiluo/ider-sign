/**
 * 结算锁：避免 sync 与离线定时器对同一账号并发结算
 * index.js 离线循环与 player/sync 均使用此锁
 * 带 TTL 兜底：超过 MAX_LOCK_MS 未释放自动过期，防止锁泄漏导致账号永久卡死。
 *
 * 注意：
 * - 旧实现只按 accountId 释放，锁过期后可能出现“旧请求释放新锁”的竞态。
 * - 新实现引入 lease token，release 时校验持有者，避免误释放。
 */
const redisStore = require('../redisStore');

const _locks = new Map(); // aid -> { acquiredAt, token, owner }
const MAX_LOCK_MS = (() => {
  const v = Number(process.env.SETTLEMENT_LOCK_TTL_MS);
  if (Number.isFinite(v) && v >= 5000) return Math.min(10 * 60 * 1000, Math.floor(v));
  return 120000;
})();
const REDIS_LOCK_ENABLED = String(process.env.SETTLEMENT_LOCK_REDIS_ENABLED || '1') !== '0';
const REDIS_LOCK_PREFIX = String(process.env.SETTLEMENT_LOCK_REDIS_PREFIX || 'settlement:lock').trim() || 'settlement:lock';
const EXPIRED_LOCK_WARN_WINDOW_MS = (() => {
  const v = Number(process.env.SETTLEMENT_LOCK_WARN_WINDOW_MS);
  if (Number.isFinite(v) && v >= 1000) return Math.min(60000, Math.floor(v));
  return 5000;
})();
let _lockSeq = 0;
let _expiredWarnWindowStart = Date.now();
let _expiredWarnSuppressed = 0;

function _warnExpiredLock(aid, heldSec, owner) {
  const nowMs = Date.now();
  if (nowMs - _expiredWarnWindowStart >= EXPIRED_LOCK_WARN_WINDOW_MS) {
    if (_expiredWarnSuppressed > 0) {
      console.warn('[settlementLock] expired lock warnings suppressed=%d windowMs=%d', _expiredWarnSuppressed, nowMs - _expiredWarnWindowStart);
      _expiredWarnSuppressed = 0;
    }
    _expiredWarnWindowStart = nowMs;
    console.warn('[settlementLock] force-releasing expired lock accountId=%s held=%ss owner=%s', aid, heldSec, owner);
    return;
  }
  _expiredWarnSuppressed += 1;
}

function _nextToken() {
  _lockSeq = (_lockSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${_lockSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function _isExpired(entry, nowMs) {
  if (!entry || typeof entry !== 'object') return true;
  return (nowMs - Number(entry.acquiredAt || 0)) >= MAX_LOCK_MS;
}

function _buildLease(aid, entry) {
  return {
    accountId: aid,
    token: entry.token,
    acquiredAt: entry.acquiredAt,
    owner: entry.owner || '',
    distributed: false,
    redisKey: '',
    redisValue: ''
  };
}

function tryAcquire(accountId, options) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return null;
  const nowMs = Date.now();
  const existing = _locks.get(aid);
  if (existing !== undefined) {
    if (!_isExpired(existing, nowMs)) return null;
    // 超时兜底：强制释放泄漏的锁
    _warnExpiredLock(
      aid,
      ((nowMs - Number(existing.acquiredAt || nowMs)) / 1000).toFixed(1),
      String(existing.owner || '-')
    );
  }

  const owner = options && typeof options === 'object'
    ? String(options.owner || '').slice(0, 80)
    : '';
  const entry = {
    acquiredAt: nowMs,
    token: _nextToken(),
    owner
  };
  _locks.set(aid, entry);
  return _buildLease(aid, entry);
}

function release(accountId, lease) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return false;
  const entry = _locks.get(aid);
  if (!entry) return false;

  const nowMs = Date.now();
  if (_isExpired(entry, nowMs)) {
    _locks.delete(aid);
    return false;
  }

  if (lease != null) {
    const token = typeof lease === 'string'
      ? lease
      : (typeof lease === 'object' ? String(lease.token || '') : '');
    if (!token || token !== entry.token) return false;
  }

  _locks.delete(aid);
  return true;
}

function has(accountId) {
  const aid = Number(accountId);
  const entry = _locks.get(aid);
  if (entry === undefined) return false;
  if (_isExpired(entry, Date.now())) {
    _locks.delete(aid);
    return false;
  }
  return true;
}

async function tryAcquireAsync(accountId, options) {
  const lease = tryAcquire(accountId, options);
  if (!lease) return null;
  if (!REDIS_LOCK_ENABLED) return lease;

  const key = `${REDIS_LOCK_PREFIX}:${lease.accountId}`;
  const value = String(lease.token || '');
  try {
    const ok = await redisStore.tryAcquireLease(key, value, MAX_LOCK_MS);
    if (!ok) {
      release(accountId, lease);
      return null;
    }
    lease.distributed = true;
    lease.redisKey = key;
    lease.redisValue = value;
    return lease;
  } catch (e) {
    // Redis 不可用时退化为本地锁，保证单机仍可运行。
    console.warn('[settlementLock] redis lease acquire degraded to local accountId=%s: %s', lease.accountId, e?.message || e);
    return lease;
  }
}

async function releaseAsync(accountId, lease) {
  if (lease && lease.distributed && lease.redisKey && lease.redisValue) {
    try {
      await redisStore.releaseLease(lease.redisKey, lease.redisValue);
    } catch (e) {
      console.warn('[settlementLock] redis lease release failed accountId=%s: %s', accountId, e?.message || e);
    }
  }
  return release(accountId, lease);
}

module.exports = { tryAcquire, release, has, tryAcquireAsync, releaseAsync };
