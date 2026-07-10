/**
 * WebSocket 连接管理器
 * 替代 HTTP 轮询，为在线玩家提供实时战斗事件推送
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const bsc = require('./game/battleSessionCache');
const dbAsync = require('./dbAsync');
const accountBanCache = require('./game/accountBanCache');
const authModule = require('./middleware/auth');

const validateAndBindSession = (authModule && typeof authModule.validateAndBindSession === 'function')
  ? authModule.validateAndBindSession
  : (() => ({ ok: true }));

if (!authModule || typeof authModule.validateAndBindSession !== 'function') {
  console.warn('[ws] validateAndBindSession missing in auth module; session replacement checks are temporarily degraded');
}

const _clients = new Map(); // accountId -> ws

let _wss = null;

const WS_PERMSG_DEFLATE_ENABLED = String(process.env.WS_PERMSG_DEFLATE_ENABLED || '1') !== '0';
const WS_DEFLATE_LEVEL = (() => {
  const v = Number(process.env.WS_DEFLATE_LEVEL);
  if (Number.isFinite(v) && v >= 0 && v <= 9) return Math.floor(v);
  return 4;
})();
const WS_DEFLATE_THRESHOLD = (() => {
  const v = Number(process.env.WS_DEFLATE_THRESHOLD);
  if (Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 1024;
})();
const WS_DEFLATE_CONCURRENCY = (() => {
  const v = Number(process.env.WS_DEFLATE_CONCURRENCY);
  if (Number.isFinite(v) && v >= 1) return Math.min(64, Math.floor(v));
  return 6;
})();
const WS_DEFLATE_WINDOW_BITS = (() => {
  const v = Number(process.env.WS_DEFLATE_WINDOW_BITS);
  if (Number.isFinite(v) && v >= 9 && v <= 15) return Math.floor(v);
  return 12;
})();

function init(httpServer) {
  const wsOptions = {
    server: httpServer,
    path: '/ws'
  };
  if (WS_PERMSG_DEFLATE_ENABLED) {
    wsOptions.perMessageDeflate = {
      zlibDeflateOptions: { level: WS_DEFLATE_LEVEL },
      threshold: WS_DEFLATE_THRESHOLD,
      concurrencyLimit: WS_DEFLATE_CONCURRENCY,
      serverMaxWindowBits: WS_DEFLATE_WINDOW_BITS
    };
  } else {
    wsOptions.perMessageDeflate = false;
  }
  _wss = new WebSocketServer(wsOptions);

  _wss.on('connection', (ws, req) => {
    if (_maintenanceMode) {
      _safeSend(ws, { type: 'maintenance', reason: '服务器维护中，请稍后重新登录' });
      ws.close(4010, 'Maintenance');
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) {
      ws.close(4001, 'Missing token');
      return;
    }

    let accountId;
    let sessionId = '';
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      accountId = decoded.accountId;
      sessionId = String(decoded.sessionId || '');
    } catch {
      ws.close(4003, 'Invalid token');
      return;
    }
    const sessionCheck = validateAndBindSession(accountId, sessionId);
    if (!sessionCheck.ok) {
      ws.close(4002, 'Session replaced');
      return;
    }
    if (accountBanCache.isBanned(accountId, null)) {
      ws.close(4000, 'Banned');
      return;
    }

    ws._accountId = accountId;
    ws._sessionId = sessionId;
    ws._alive = true;
    // 默认关闭战斗细节推送，客户端在进入地图页后再主动开启。
    ws._wantBattleDetail = false;

    const old = _clients.get(accountId);
    if (old && old.readyState === 1) {
      // Same session duplicate connect (usually plugin/脚本重复建连): keep the old one.
      if (String(old._sessionId || '') === String(sessionId || '')) {
        ws.close(4004, 'Duplicate connection');
        return;
      }
      old.close(4002, 'Replaced');
    }
    _clients.set(accountId, ws);
    _touchSession(accountId);

    ws.on('pong', () => { ws._alive = true; });

    ws.on('message', (raw) => {
      _touchSession(accountId);
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') {
          ws.send('{"type":"pong"}');
        } else if (msg.type === 'battle_detail') {
          ws._wantBattleDetail = !!msg.value;
        } else if (msg.type === 'auto_restart') {
          const session = bsc.getActiveSessionByAccount(accountId);
          if (session) session.auto_restart = !!msg.value;
          const mapCandidate = Number(session?.map_id);
          dbAsync.updatePlayerAutoBattleIntent(
            accountId,
            !!msg.value,
            Number.isFinite(mapCandidate) && mapCandidate > 0 ? Math.floor(mapCandidate) : undefined
          ).catch((e) => {
            console.error('[ws] auto_restart persist failed accountId=%s:', accountId, e?.message || e);
          });
        }
      } catch {}
    });

    ws.on('close', () => {
      if (_clients.get(accountId) === ws) _clients.delete(accountId);
    });

    ws.on('error', () => {});

    _safeSend(ws, { type: 'connected' });
  });

  const hbInterval = setInterval(() => {
    for (const [accountId, ws] of _clients) {
      if (ws.readyState !== 1) {
        _clients.delete(accountId);
        continue;
      }
      const sid = String(ws._sessionId || '');
      if (sid) {
        const sessionCheck = validateAndBindSession(accountId, sid);
        if (!sessionCheck.ok) {
          _clients.delete(accountId);
          try { ws.close(4002, 'Session replaced'); } catch {}
          continue;
        }
      }
      if (!ws._alive) {
        _clients.delete(accountId);
        ws.terminate();
        continue;
      }
      ws._alive = false;
      ws.ping();
    }
  }, 25000);

  _wss.on('close', () => clearInterval(hbInterval));
  console.log('[ws] WebSocket server initialized on /ws');
  return _wss;
}

function _touchSession(accountId) {
  const session = bsc.getActiveSessionByAccount(accountId);
  if (session) {
    session.last_poll_at = Math.floor(Date.now() / 1000);
  }
}

function _safeSend(ws, data) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function isOnline(accountId) {
  const ws = _clients.get(accountId);
  return !!(ws && ws.readyState === 1);
}

function wantsBattleDetail(accountId) {
  const ws = _clients.get(accountId);
  return !!(ws && ws._wantBattleDetail);
}

function pushToPlayer(accountId, data) {
  const ws = _clients.get(accountId);
  return _safeSend(ws, data);
}

function kickPlayer(accountId, code = 4000, reason = 'Banned') {
  const ws = _clients.get(accountId);
  if (ws && ws.readyState === 1) {
    _clients.delete(accountId);
    try { ws.close(code, reason); } catch {}
    return true;
  }
  return false;
}

function getOnlineCount() {
  return _clients.size;
}

/**
 * 维护模式：向所有在线客户端推送维护通知并断开连接
 * @param {string} reason - 维护原因
 */
function drainAll(reason) {
  const msg = JSON.stringify({ type: 'maintenance', reason: reason || '服务器维护中，请稍后重新登录' });
  for (const [accountId, ws] of _clients) {
    try { _safeSend(ws, msg); } catch {}
    try { ws.close(4010, 'Maintenance'); } catch {}
    _clients.delete(accountId);
  }
  return true;
}

/**
 * 维护模式：拒绝新 WS 连接
 */
let _maintenanceMode = false;
function setMaintenanceMode(enabled) { _maintenanceMode = !!enabled; }
function isMaintenanceMode() { return _maintenanceMode; }

module.exports = { init, isOnline, wantsBattleDetail, pushToPlayer, kickPlayer, getOnlineCount, drainAll, setMaintenanceMode, isMaintenanceMode };
