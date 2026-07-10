const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../dbAsync');
const accountBanCache = require('../game/accountBanCache');

const _lastActivity = new Map();
const _activeSession = new Map();
const _accountReqState = new Map();
const _accountInFlight = new Map();

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

const AUTH_RATE_LIMIT_WINDOW_MS = _intClamp(_numEnv('AUTH_RATE_LIMIT_WINDOW_MS', 1000), 200, 60000);
const AUTH_RATE_LIMIT_MAX_PER_WINDOW = _intClamp(_numEnv('AUTH_RATE_LIMIT_MAX_PER_WINDOW', 28), 2, 100000);
const AUTH_RATE_LIMIT_HOT_MAX_PER_WINDOW = _intClamp(_numEnv('AUTH_RATE_LIMIT_HOT_MAX_PER_WINDOW', 14), 1, 100000);
const AUTH_MAX_INFLIGHT_PER_ACCOUNT = _intClamp(_numEnv('AUTH_MAX_INFLIGHT_PER_ACCOUNT', 8), 1, 128);
const AUTH_STATE_TTL_SEC = _intClamp(_numEnv('AUTH_STATE_TTL_SEC', 24 * 3600), 600, 7 * 24 * 3600);

function _isHotRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const fullPath = `${String(req.baseUrl || '')}${String(req.path || '')}`;
  if (method === 'GET') {
    return fullPath.startsWith('/exchange/quote');
  }
  return fullPath.startsWith('/online')
    || fullPath.startsWith('/battle')
    || fullPath.startsWith('/dungeon-battle')
    || fullPath.startsWith('/exchange')
    || fullPath.startsWith('/trial')
    || fullPath.startsWith('/player');
}

function _hitAccountRateLimit(accountId, req) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return { blocked: false, retryAfterMs: 0 };
  const now = Date.now();
  let st = _accountReqState.get(aid);
  if (!st || (now - Number(st.windowStartMs || 0)) >= AUTH_RATE_LIMIT_WINDOW_MS) {
    st = { windowStartMs: now, count: 0, lastSeenAtSec: Math.floor(now / 1000) };
    _accountReqState.set(aid, st);
  }
  st.count += 1;
  st.lastSeenAtSec = Math.floor(now / 1000);
  const cap = _isHotRequest(req) ? AUTH_RATE_LIMIT_HOT_MAX_PER_WINDOW : AUTH_RATE_LIMIT_MAX_PER_WINDOW;
  if (st.count > cap) {
    const retryAfterMs = Math.max(0, AUTH_RATE_LIMIT_WINDOW_MS - (now - Number(st.windowStartMs || 0)));
    return { blocked: true, retryAfterMs };
  }
  return { blocked: false, retryAfterMs: 0 };
}

function _acquireAccountInflight(accountId, res) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return { ok: true };
  const cur = Number(_accountInFlight.get(aid) || 0);
  if (cur >= AUTH_MAX_INFLIGHT_PER_ACCOUNT) {
    return { ok: false };
  }
  _accountInFlight.set(aid, cur + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = Math.max(0, Number(_accountInFlight.get(aid) || 0) - 1);
    if (left <= 0) _accountInFlight.delete(aid);
    else _accountInFlight.set(aid, left);
  };
  res.on('finish', release);
  res.on('close', release);
  return { ok: true };
}

function validateAndBindSession(accountId, sessionId) {
  const aid = Number(accountId) || 0;
  const sid = String(sessionId || '').trim();
  if (aid <= 0 || !sid) {
    return { ok: true };
  }
  const current = _activeSession.get(aid);
  if (current && current !== sid) {
    return { ok: false, code: 'SESSION_REPLACED' };
  }
  if (!current) {
    _activeSession.set(aid, sid);
  }
  return { ok: true };
}

function extractBearerToken(authHeader) {
  const raw = String(authHeader || '').trim();
  if (!raw) return '';
  // Accept case-insensitive bearer scheme and tolerate extra spaces.
  const m = raw.match(/^bearer\s+(.+)$/i);
  if (!m) return '';
  return String(m[1] || '').trim();
}

function authMiddleware(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.accountId = decoded.accountId;
    req.username = decoded.username;
    if (accountBanCache.isBanned(req.accountId, null)) {
      return res.status(403).json({ ok: false, error: '账号已封禁', code: 'BANNED' });
    }
    const sessionId = decoded.sessionId || '';
    const sessionCheck = validateAndBindSession(decoded.accountId, sessionId);
    if (!sessionCheck.ok) {
      return res.status(409).json({ ok: false, error: '账号已在其他设备登录', code: 'SESSION_REPLACED' });
    }

    const rateCheck = _hitAccountRateLimit(decoded.accountId, req);
    if (rateCheck.blocked) {
      return res.status(429).json({
        ok: false,
        error: '请求过于频繁，请稍后重试',
        code: 'ACCOUNT_RATE_LIMITED',
        retry_after_ms: rateCheck.retryAfterMs
      });
    }

    const inflightCheck = _acquireAccountInflight(decoded.accountId, res);
    if (!inflightCheck.ok) {
      return res.status(429).json({
        ok: false,
        error: '并发请求过多，请稍后重试',
        code: 'ACCOUNT_INFLIGHT_LIMITED'
      });
    }

    _lastActivity.set(decoded.accountId, Math.floor(Date.now() / 1000));
    // MySQL 模式下异步预取玩家数据，后续同步读直接命中缓存
    if (db.isMysql && typeof db.prefetchPlayerAsync === 'function') {
      db.prefetchPlayerAsync(decoded.accountId).then(() => next(), () => next());
      return; // next() 在 promise 中调用
    }
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: '登录已过期' });
  }
}

function getLastActivityAt(accountId) {
  return _lastActivity.get(accountId) || 0;
}

/** 清理超过 24 小时未活动的账号，避免 Map 无限增长 */
function pruneStaleActivity() {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 24 * 3600;
  for (const [aid, ts] of _lastActivity.entries()) {
    if (now - ts > maxAge) { _lastActivity.delete(aid); _activeSession.delete(aid); }
  }
  for (const [aid, st] of _accountReqState.entries()) {
    if ((now - Number(st?.lastSeenAtSec || 0)) > AUTH_STATE_TTL_SEC) {
      _accountReqState.delete(aid);
      if (!Number(_accountInFlight.get(aid) || 0)) _accountInFlight.delete(aid);
    }
  }
}

function signToken(accountId, username) {
  const sessionId = `${accountId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _activeSession.set(accountId, sessionId);
  return jwt.sign(
    { accountId, username, sessionId },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

module.exports = { authMiddleware, signToken, getLastActivityAt, pruneStaleActivity, validateAndBindSession };
