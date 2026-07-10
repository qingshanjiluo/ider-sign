function _numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function _intClamp(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function _normalizeIp(rawIp) {
  const ip = String(rawIp || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

const OVERLOAD_GUARD_ENABLED = String(process.env.OVERLOAD_GUARD_ENABLED || '1') !== '0';
const OVERLOAD_GLOBAL_MAX_INFLIGHT = _intClamp(_numEnv('OVERLOAD_GLOBAL_MAX_INFLIGHT', 1200), 50, 20000);
const OVERLOAD_IP_MAX_INFLIGHT = _intClamp(_numEnv('OVERLOAD_IP_MAX_INFLIGHT', 90), 1, 5000);
const OVERLOAD_HOT_IP_MAX_INFLIGHT = _intClamp(_numEnv('OVERLOAD_HOT_IP_MAX_INFLIGHT', 30), 1, 5000);
const OVERLOAD_WINDOW_MS = _intClamp(_numEnv('OVERLOAD_WINDOW_MS', 1000), 200, 60000);
const OVERLOAD_IP_MAX_PER_WINDOW = _intClamp(_numEnv('OVERLOAD_IP_MAX_PER_WINDOW', 120), 5, 100000);
const OVERLOAD_HOT_IP_MAX_PER_WINDOW = _intClamp(_numEnv('OVERLOAD_HOT_IP_MAX_PER_WINDOW', 40), 2, 100000);
const OVERLOAD_GLOBAL_MAX_PER_WINDOW = _intClamp(_numEnv('OVERLOAD_GLOBAL_MAX_PER_WINDOW', 2400), 50, 1000000);
const OVERLOAD_STATE_TTL_MS = _intClamp(_numEnv('OVERLOAD_STATE_TTL_MS', 10 * 60 * 1000), 60 * 1000, 24 * 60 * 60 * 1000);

const _inFlightByIp = new Map();
const _reqWindowByIp = new Map();
let _globalInFlight = 0;
let _globalWindow = { startMs: Date.now(), count: 0 };

function _isHotPath(req) {
  const fullPath = `${String(req.baseUrl || '')}${String(req.path || '')}`;
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    if (fullPath.startsWith('/online')) return true;
    if (fullPath.startsWith('/battle')) return true;
    if (fullPath.startsWith('/dungeon-battle')) return true;
    if (fullPath.startsWith('/exchange')) return true;
    if (fullPath.startsWith('/trial')) return true;
    if (fullPath.startsWith('/player')) return true;
    if (fullPath.startsWith('/auth/login')) return true;
    if (fullPath.startsWith('/auth/register')) return true;
  }
  if (fullPath.startsWith('/exchange/quote')) return true;
  return false;
}

function _shouldBypass(req) {
  const p = `${String(req.baseUrl || '')}${String(req.path || '')}`;
  if (p === '/health' || p === '/version' || p === '/favicon.ico') return true;
  if (p.startsWith('/patch') || p.startsWith('/web')) return true;
  if (p.startsWith('/gm')) return true;
  return false;
}

function _hitIpWindow(ip, maxPerWindow, now) {
  const key = String(ip || 'unknown');
  let st = _reqWindowByIp.get(key);
  if (!st || (now - Number(st.startMs || 0)) >= OVERLOAD_WINDOW_MS) {
    st = { startMs: now, count: 0, lastSeenAt: now };
    _reqWindowByIp.set(key, st);
  }
  st.count += 1;
  st.lastSeenAt = now;
  if (st.count > maxPerWindow) {
    const retryAfterMs = Math.max(0, OVERLOAD_WINDOW_MS - (now - Number(st.startMs || 0)));
    return { blocked: true, retryAfterMs };
  }
  return { blocked: false, retryAfterMs: 0 };
}

function _hitGlobalWindow(now) {
  const st = _globalWindow;
  if ((now - Number(st.startMs || 0)) >= OVERLOAD_WINDOW_MS) {
    _globalWindow = { startMs: now, count: 1 };
    return { blocked: false, retryAfterMs: 0 };
  }
  st.count += 1;
  if (st.count > OVERLOAD_GLOBAL_MAX_PER_WINDOW) {
    const retryAfterMs = Math.max(0, OVERLOAD_WINDOW_MS - (now - Number(st.startMs || 0)));
    return { blocked: true, retryAfterMs };
  }
  return { blocked: false, retryAfterMs: 0 };
}

function _cleanupOverloadState() {
  const now = Date.now();
  for (const [ip, st] of _reqWindowByIp.entries()) {
    if ((now - Number(st?.lastSeenAt || 0)) > OVERLOAD_STATE_TTL_MS) {
      _reqWindowByIp.delete(ip);
      if ((_inFlightByIp.get(ip) || 0) <= 0) _inFlightByIp.delete(ip);
    }
  }
  for (const [ip, n] of _inFlightByIp.entries()) {
    if (!Number.isFinite(Number(n)) || Number(n) <= 0) _inFlightByIp.delete(ip);
  }
}

setInterval(_cleanupOverloadState, 60 * 1000);

function overloadGuard(req, res, next) {
  if (!OVERLOAD_GUARD_ENABLED) return next();
  if (_shouldBypass(req)) return next();

  const now = Date.now();
  const isHotPath = _isHotPath(req);
  const ip = _normalizeIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '') || 'unknown';

  const globalWindowCheck = _hitGlobalWindow(now);
  if (globalWindowCheck.blocked) {
    return res.status(503).json({
      ok: false,
      error: '服务器繁忙，请稍后重试',
      code: 'SERVER_OVERLOADED',
      retry_after_ms: globalWindowCheck.retryAfterMs
    });
  }

  const ipWindowCap = isHotPath ? OVERLOAD_HOT_IP_MAX_PER_WINDOW : OVERLOAD_IP_MAX_PER_WINDOW;
  const ipWindowCheck = _hitIpWindow(ip, ipWindowCap, now);
  if (ipWindowCheck.blocked) {
    return res.status(429).json({
      ok: false,
      error: '请求过于频繁，请稍后再试',
      code: 'IP_RATE_LIMITED',
      retry_after_ms: ipWindowCheck.retryAfterMs
    });
  }

  if (_globalInFlight >= OVERLOAD_GLOBAL_MAX_INFLIGHT) {
    return res.status(503).json({
      ok: false,
      error: '服务器繁忙，请稍后重试',
      code: 'SERVER_INFLIGHT_LIMITED'
    });
  }

  const ipInFlightCap = isHotPath ? OVERLOAD_HOT_IP_MAX_INFLIGHT : OVERLOAD_IP_MAX_INFLIGHT;
  const ipInFlight = Number(_inFlightByIp.get(ip) || 0);
  if (ipInFlight >= ipInFlightCap) {
    return res.status(429).json({
      ok: false,
      error: '并发请求过多，请稍后重试',
      code: 'IP_INFLIGHT_LIMITED'
    });
  }

  _globalInFlight += 1;
  _inFlightByIp.set(ip, ipInFlight + 1);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    _globalInFlight = Math.max(0, _globalInFlight - 1);
    const cur = Math.max(0, Number(_inFlightByIp.get(ip) || 0) - 1);
    if (cur <= 0) _inFlightByIp.delete(ip);
    else _inFlightByIp.set(ip, cur);
  };

  res.on('finish', release);
  res.on('close', release);
  next();
}

module.exports = {
  overloadGuard
};
