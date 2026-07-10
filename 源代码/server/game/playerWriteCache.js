/**
 * 玩家存档写合并缓存，降低磁盘 I/O。
 * 读：优先从内存返回，保证短时间内请求数据一致。
 * 写：同一账号在最小间隔内合并写入，并提供最长等待兜底，避免持续抖动。
 * 风险：进程异常退出时，可能丢失尚未落盘的少量数据；通过 MAX_DELAY_MS 控制上限。
 */
const DEFAULT_MIN_DELAY_MS = 5000;
const DEFAULT_MAX_DELAY_MS = 15000;
const MIN_DELAY_MS = (() => {
  const v = Number(process.env.PLAYER_WRITE_DEBOUNCE_MS ?? process.env.PLAYER_WRITE_MIN_DELAY_MS);
  return Number.isFinite(v) && v >= 200 ? Math.floor(v) : DEFAULT_MIN_DELAY_MS;
})();
const MAX_DELAY_MS = (() => {
  const v = Number(process.env.PLAYER_WRITE_MAX_DELAY_MS);
  const fallback = Math.max(DEFAULT_MAX_DELAY_MS, MIN_DELAY_MS);
  return Number.isFinite(v) && v >= MIN_DELAY_MS ? Math.floor(v) : fallback;
})();
const WRITE_JITTER_MS = (() => {
  const v = Number(process.env.PLAYER_WRITE_JITTER_MS);
  return Number.isFinite(v) && v >= 0 ? Math.min(10000, Math.floor(v)) : 0;
})();
const WRITE_PRESSURE_THRESHOLD = (() => {
  const v = Number(process.env.PLAYER_WRITE_PRESSURE_THRESHOLD);
  return Number.isFinite(v) && v >= 10 ? Math.min(200000, Math.floor(v)) : 500;
})();
const WRITE_PRESSURE_EXTRA_DELAY_MS = (() => {
  const v = Number(process.env.PLAYER_WRITE_PRESSURE_EXTRA_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? Math.min(30000, Math.floor(v)) : 5000;
})();

const _pending = new Map(); // accountId -> { slot, data, timer, firstDirtyAt, lastFlushAt, flushing, needsReschedule, flushPromise }
const _lastFlushedSignature = new Map(); // accountId -> slot|json
let _flushFn = null;
let _flushFnAsync = null;

function _normalizeComparableData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!Object.prototype.hasOwnProperty.call(data, '_save_seq')) return data;
  const sanitized = { ...data };
  delete sanitized._save_seq;
  return sanitized;
}

function _buildSignature(slot, data) {
  try {
    return `${Number(slot) || 1}|${JSON.stringify(_normalizeComparableData(data))}`;
  } catch (_) {
    return null;
  }
}

function _clearTimer(entry) {
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function _calcWriteJitterMs(accountId, entry, budgetMs) {
  const budget = Math.max(0, Number(budgetMs) || 0);
  if (WRITE_JITTER_MS <= 0 || budget <= 0) return 0;
  const cap = Math.min(WRITE_JITTER_MS, budget);
  if (cap <= 0) return 0;
  const aid = Number(accountId) || 0;
  const seed = (Math.imul((aid + 17), 1103515245) + (Number(entry?.firstDirtyAt) || 0)) >>> 0;
  return seed % (cap + 1);
}

function _resetAfterFlush(accountId, entry) {
  if (!entry) return;
  if (entry.needsReschedule) {
    entry.needsReschedule = false;
    entry.firstDirtyAt = Date.now();
    _schedule(accountId);
    return;
  }
  _pending.delete(accountId);
}

function _doFlush(accountId) {
  const entry = _pending.get(accountId);
  if (!entry || !_flushFn) return;
  _clearTimer(entry);
  if (entry.flushing) {
    entry.needsReschedule = true;
    return;
  }
  entry.flushing = true;
  try {
    _flushFn(accountId, entry.slot, entry.data);
    if (entry.signature) _lastFlushedSignature.set(accountId, entry.signature);
  } catch (e) {
    console.error('[playerWriteCache] flush error accountId=%s:', accountId, e?.message || e);
  } finally {
    entry.flushing = false;
    entry.lastFlushAt = Date.now();
    _resetAfterFlush(accountId, entry);
  }
}

async function _doFlushAsync(accountId) {
  const entry = _pending.get(accountId);
  if (!entry || !_flushFnAsync) return;
  _clearTimer(entry);
  if (entry.flushing) {
    entry.needsReschedule = true;
    return entry.flushPromise || Promise.resolve();
  }
  entry.flushing = true;
  const runPromise = (async () => {
    try {
      await _flushFnAsync(accountId, entry.slot, entry.data);
      if (entry.signature) _lastFlushedSignature.set(accountId, entry.signature);
    } catch (e) {
      console.error('[playerWriteCache] async flush error accountId=%s:', accountId, e?.message || e);
    } finally {
      entry.flushing = false;
      entry.flushPromise = null;
      entry.lastFlushAt = Date.now();
      _resetAfterFlush(accountId, entry);
    }
  })();
  entry.flushPromise = runPromise;
  return runPromise;
}

function _schedule(accountId) {
  const entry = _pending.get(accountId);
  if (!entry) return;
  _clearTimer(entry);
  if (entry.flushing) {
    entry.needsReschedule = true;
    return;
  }

  const now = Date.now();
  const firstDirtyAt = Number(entry.firstDirtyAt) || now;
  const lastFlushAt = Number(entry.lastFlushAt) || 0;
  // 首次脏写也需要经过 MIN_DELAY，避免新账号写入在短时间内立即落盘。
  const minDueAt = lastFlushAt > 0
    ? Math.max(firstDirtyAt, lastFlushAt + MIN_DELAY_MS)
    : (firstDirtyAt + MIN_DELAY_MS);
  const maxDueAt = firstDirtyAt + MAX_DELAY_MS;
  const baseDueAt = Math.min(minDueAt, maxDueAt);
  let baseWaitMs = Math.max(0, baseDueAt - now);
  if (lastFlushAt <= 0 && _pending.size >= WRITE_PRESSURE_THRESHOLD && WRITE_PRESSURE_EXTRA_DELAY_MS > 0) {
    const pressureBudget = Math.max(0, maxDueAt - (now + baseWaitMs));
    baseWaitMs += Math.min(WRITE_PRESSURE_EXTRA_DELAY_MS, pressureBudget);
  }
  // 在不突破 max delay 的前提下做账号级抖动，打散同一时刻的大量写入。
  const jitterBudgetMs = Math.max(0, maxDueAt - (now + baseWaitMs));
  const waitMs = baseWaitMs + _calcWriteJitterMs(accountId, entry, jitterBudgetMs);

  entry.timer = setTimeout(() => {
    if (_flushFnAsync) {
      _doFlushAsync(accountId).catch(e => {
        console.error('[playerWriteCache] async flush unhandled accountId=%s:', accountId, e?.message || e);
      });
    } else {
      _doFlush(accountId);
    }
  }, waitMs);
}

function init(flushFn) {
  _flushFn = flushFn;
}

function initAsync(flushFnAsync) {
  _flushFnAsync = flushFnAsync;
}

function getCached(accountId) {
  const entry = _pending.get(accountId);
  if (!entry || !entry.data) return null;
  try {
    return structuredClone(entry.data);
  } catch (_) {
    return null;
  }
}

function scheduleSave(accountId, slot, data) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return false;
  const now = Date.now();
  const normalizedSlot = Number(slot) || 1;
  const signature = _buildSignature(normalizedSlot, data);
  const entry = _pending.get(aid);
  if (entry) {
    if (signature && entry.signature === signature) return false;
    entry.slot = normalizedSlot;
    entry.data = data;
    entry.signature = signature;
    if (!entry.firstDirtyAt) entry.firstDirtyAt = now;
    _schedule(aid);
    return true;
  }

  if (signature && _lastFlushedSignature.get(aid) === signature) return false;

  _pending.set(aid, {
    slot: normalizedSlot,
    data,
    signature,
    timer: null,
    firstDirtyAt: now,
    lastFlushAt: 0,
    flushing: false,
    needsReschedule: false,
    flushPromise: null
  });
  _schedule(aid);
  return true;
}

async function drainAccountAsync(accountId) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return;
  const entry = _pending.get(aid);
  if (!entry) return;
  _clearTimer(entry);

  if (_flushFnAsync) {
    await _doFlushAsync(aid);
    return;
  }

  if (!entry.flushing) _doFlush(aid);
}

function clear(accountId) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return;
  const entry = _pending.get(aid);
  _clearTimer(entry);
  _pending.delete(aid);
}

function patchCached(accountId, updater) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid)) return false;
  const entry = _pending.get(aid);
  if (!entry || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) return false;
  if (typeof updater !== 'function') return false;
  try {
    const next = updater(entry.data);
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      entry.data = next;
    }
    entry.signature = null;
    return true;
  } catch (e) {
    console.error('[playerWriteCache] patchCached error accountId=%s:', aid, e?.message || e);
    return false;
  }
}

function flushSync() {
  const keys = [..._pending.keys()];
  if (_flushFnAsync) {
    // MySQL mode: use async flush, avoid sync-mysql
    const promises = [];
    for (const aid of keys) {
      _clearTimer(_pending.get(aid));
      promises.push(_doFlushAsync(aid));
    }
    // Best-effort: callers expect sync, but we must avoid sync-mysql.
    // For true async drain, use flushAllAsync().
    Promise.allSettled(promises).catch(() => {});
    return;
  }
  for (const aid of keys) {
    _clearTimer(_pending.get(aid));
    _doFlush(aid);
  }
}

async function flushAllAsync() {
  const keys = [..._pending.keys()];
  const promises = [];
  for (const aid of keys) {
    _clearTimer(_pending.get(aid));
    if (_flushFnAsync) {
      promises.push(_doFlushAsync(aid));
    } else {
      _doFlush(aid);
    }
  }
  if (promises.length > 0) await Promise.allSettled(promises);
}

module.exports = { init, initAsync, getCached, scheduleSave, clear, patchCached, flushSync, flushAllAsync, drainAccountAsync };
