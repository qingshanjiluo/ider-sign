const crypto = require('crypto');
const config = require('../config');

const SKIP_PATHS = new Set(['/health', '/favicon.ico', '/game-data']);
const SIGN_VERIFY_GET_ENABLED = String(process.env.SIGN_VERIFY_GET_ENABLED || '0') === '1';

function signVerify(req, res, next) {
  if (SKIP_PATHS.has(req.path) || req.path.startsWith('/gm')) return next();
  if (!SIGN_VERIFY_GET_ENABLED && String(req.method || 'GET').toUpperCase() === 'GET') return next();

  const sign = req.headers['x-sign'];
  const ts = parseInt(req.headers['x-sign-t'], 10);

  if (!sign || !ts || isNaN(ts)) {
    return res.status(403).json({ ok: false, error: '请求签名缺失' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (config.signTolerance || 300)) {
    return res.status(403).json({ ok: false, error: '请求已过期，请检查系统时间' });
  }

  const bodyStr = req.rawBody || '';
  const message = `${req.method}\n${req.originalUrl}\n${ts}\n${bodyStr}`;
  const expected = crypto.createHmac('sha256', config.signSecret)
    .update(message)
    .digest('hex');

  if (sign !== expected) {
    return res.status(403).json({ ok: false, error: '请求签名无效' });
  }

  next();
}

module.exports = signVerify;
