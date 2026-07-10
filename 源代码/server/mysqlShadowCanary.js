const crypto = require('crypto');
const mysqlAsyncPool = require('./mysqlAsyncPool');

function _toBool(v, d = false) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return d;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return d;
}

function _int(v, d = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isEnabled() {
  return _toBool(process.env.MYSQL_CANARY_SHADOW_ENABLED, false);
}

function _canUsePool() {
  return mysqlAsyncPool.isAsyncEnabled();
}

function _samplePercent() {
  return _int(process.env.MYSQL_CANARY_PERCENT, 5, 0, 100);
}

function _timeoutMs() {
  return _int(process.env.MYSQL_CANARY_TIMEOUT_MS, 120, 20, 2000);
}

function _summaryIntervalSec() {
  return _int(process.env.MYSQL_CANARY_SUMMARY_INTERVAL_SEC, 60, 10, 600);
}

function _maxInFlight() {
  return _int(process.env.MYSQL_CANARY_MAX_INFLIGHT, 80, 1, 1000);
}

function _bucket(accountId) {
  const aid = String(Number(accountId) || 0);
  const digest = crypto.createHash('sha1').update(aid).digest();
  const x = digest.readUInt16BE(0);
  return x % 100;
}

function _isSelected(accountId) {
  const p = _samplePercent();
  if (p <= 0) return false;
  if (p >= 100) return true;
  return _bucket(accountId) < p;
}

function _newStats() {
  return {
    startedAt: Date.now(),
    selected: 0,
    ok: 0,
    timeout: 0,
    err: 0,
    missingExpected: 0,
    presentUnexpected: 0,
    skippedBusy: 0,
    skippedDisabled: 0,
    latencies: []
  };
}

let _stats = _newStats();
let _inFlight = 0;
let _summaryTimerStarted = false;

function _pushLatency(ms) {
  const arr = _stats.latencies;
  arr.push(Math.max(0, Number(ms) || 0));
  if (arr.length > 2000) arr.shift();
}

function _percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length <= 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return Number(sorted[idx] || 0);
}

function _logSummaryAndReset() {
  const s = _stats;
  const durationSec = Math.max(1, Math.floor((Date.now() - s.startedAt) / 1000));
  if (s.selected <= 0 && s.skippedBusy <= 0 && s.skippedDisabled <= 0) {
    _stats = _newStats();
    return;
  }

  const sorted = s.latencies.slice().sort((a, b) => a - b);
  const p50 = _percentile(sorted, 0.5).toFixed(1);
  const p95 = _percentile(sorted, 0.95).toFixed(1);
  const p99 = _percentile(sorted, 0.99).toFixed(1);

  console.log(
    '[mysql-shadow] win=%ss selected=%d ok=%d timeout=%d err=%d miss=%d unexpected=%d busy=%d disabled=%d p50=%sms p95=%sms p99=%sms inflight=%d',
    durationSec,
    s.selected,
    s.ok,
    s.timeout,
    s.err,
    s.missingExpected,
    s.presentUnexpected,
    s.skippedBusy,
    s.skippedDisabled,
    p50,
    p95,
    p99,
    _inFlight
  );

  _stats = _newStats();
}

function _ensureSummaryTimer() {
  if (_summaryTimerStarted) return;
  _summaryTimerStarted = true;
  const ms = _summaryIntervalSec() * 1000;
  const timer = setInterval(() => {
    try {
      _logSummaryAndReset();
    } catch (err) {
      console.error('[mysql-shadow] summary error:', err?.message || err);
    }
  }, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

async function _probeOnce(accountId, expectedHasCharacter) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;

  if (!isEnabled() || !_canUsePool()) {
    _stats.skippedDisabled += 1;
    return;
  }
  if (!_isSelected(aid)) return;

  if (_inFlight >= _maxInFlight()) {
    _stats.skippedBusy += 1;
    return;
  }

  _ensureSummaryTimer();
  _stats.selected += 1;
  _inFlight += 1;

  const started = Date.now();
  const timeoutMs = _timeoutMs();
  let timeoutHandle = null;

  try {
    const result = await Promise.race([
      mysqlAsyncPool.query('SELECT account_id FROM players WHERE account_id = ? LIMIT 1', [aid])
        .then((rows) => ({ kind: 'ok', rows }))
        .catch((err) => ({ kind: 'err', err })),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      })
    ]);

    if (result.kind === 'timeout') {
      _stats.timeout += 1;
      return;
    }
    if (result.kind === 'err') {
      _stats.err += 1;
      return;
    }

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const found = rows.length > 0;
    _stats.ok += 1;
    _pushLatency(Date.now() - started);

    if (expectedHasCharacter && !found) {
      _stats.missingExpected += 1;
    } else if (!expectedHasCharacter && found) {
      _stats.presentUnexpected += 1;
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    _inFlight = Math.max(0, _inFlight - 1);
  }
}

function probePlayerSync(accountId, expectedHasCharacter = true) {
  _probeOnce(accountId, !!expectedHasCharacter).catch((err) => {
    _stats.err += 1;
    console.error('[mysql-shadow] probe error:', err?.message || err);
  });
}

module.exports = {
  isEnabled,
  probePlayerSync
};
