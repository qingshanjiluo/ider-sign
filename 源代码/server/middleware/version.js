/**
 * 客户端版本校验中间件
 * 拒绝版本过旧的客户端，避免协议不兼容
 */
const config = require('../config');

/** 将 "1.0.2" 解析为 [1, 0, 2]，缺位补 0 */
function parseVersion(v) {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  return v.trim().split('.').map(n => parseInt(n, 10) || 0).slice(0, 3);
}

/** a < b 返回 -1，a == b 返回 0，a > b 返回 1 */
function compareVersion(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] < vb[i]) return -1;
    if (va[i] > vb[i]) return 1;
  }
  return 0;
}

function versionCheck(req, res, next) {
  if (req.path === '/health' || req.path === '/version' || req.path === '/favicon.ico' || req.path.startsWith('/patch/') || req.path.startsWith('/web/') || req.path === '/game-data' || req.path.startsWith('/gm')) {
    return next();
  }
  const clientVer = req.headers['x-client-version'] || '';
  const minVer = config.minClientVersion || '1.0.0';
  if (compareVersion(clientVer, minVer) < 0) {
    return res.status(426).json({
      ok: false,
      error: '客户端版本过旧，请更新后重试',
      code: 'VERSION_TOO_OLD',
      minVersion: minVer,
      downloadUrl: config.updateDownloadUrl || ''
    });
  }
  next();
}

module.exports = versionCheck;
