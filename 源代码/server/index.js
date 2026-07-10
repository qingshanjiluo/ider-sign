/**
 * 艾德尔修仙传 - 网游化服务端
 * 端口 3000，数据库由 DB_DRIVER 决定（sqlite/mysql）
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const http = require('http');
const { Worker } = require('worker_threads');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const config = require('./config');
const wsManager = require('./ws');
const redisStore = require('./redisStore');
const SERVER_BOOT_TS = Date.now();
const SERVER_BOOT_ID = `${SERVER_BOOT_TS.toString(36)}-${process.pid}`;

// Express 4 does not natively forward rejected promises from async handlers.
// Wrap router handlers once at bootstrap to prevent hung requests and 502 from leaked rejections.
(function patchExpressAsyncHandlers(expressLib) {
  try {
    if (!expressLib || expressLib.__asyncPatched) return;
    const probe = expressLib.Router();
    const proto = Object.getPrototypeOf(probe);
    if (!proto) return;
    const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

    const wrap = (fn) => {
      if (typeof fn !== 'function') return fn;
      if (fn.length >= 4) return fn; // keep error handlers unchanged
      if (fn.__asyncWrapped) return fn;
      const wrapped = function wrappedAsyncHandler(req, res, next) {
        try {
          const ret = fn(req, res, next);
          if (ret && typeof ret.then === 'function') {
            ret.catch(next);
          }
        } catch (err) {
          next(err);
        }
      };
      wrapped.__asyncWrapped = true;
      return wrapped;
    };

    const wrapArg = (arg) => {
      if (Array.isArray(arg)) return arg.map(wrapArg);
      return wrap(arg);
    };

    for (const m of methods) {
      const origin = proto[m];
      if (typeof origin !== 'function') continue;
      proto[m] = function patchedRouterMethod(...args) {
        const nextArgs = args.map(wrapArg);
        return origin.apply(this, nextArgs);
      };
    }

    expressLib.__asyncPatched = true;
  } catch (e) {
    console.warn('[server] express async patch skipped:', e?.message || e);
  }
})(express);

const versionCheck = require('./middleware/version');
const signVerify = require('./middleware/sign');
const { overloadGuard } = require('./middleware/overloadGuard');
const apiStats = require('./apiStats');
const { pruneStaleActivity } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const playerRoutes = require('./routes/player');
const battleRoutes = require('./routes/battle');
const dungeonRoutes = require('./routes/dungeon');
const dungeonBattleRoutes = require('./routes/dungeonBattle');
const exchangeRoutes = require('./routes/exchange');
const mailRoutes = require('./routes/mail');
const onlineRoutes = require('./routes/online');
const trialRoutes = require('./routes/trial');
const gmRoutes = require('./routes/gm');
const allianceRoutes = require('./routes/alliance');
const inviteRoutes = require('./routes/invite');
const emailRoutes = require('./routes/email');
const leagueRoutes = require('./routes/league');
const leagueSystem = require('./game/leagueSystem');

function runMemoryPrune() {
  try {
    if (typeof pruneStaleActivity === 'function') pruneStaleActivity();
  } catch (e) {
    console.error('[prune] error:', e?.message || e);
  }
}

const { startScheduler, startBackupScheduler } = require('./jobs');
const { trySettleIfDue } = require('./game/duelRankSeason');
const db = require('./db');

let _shuttingDown = false;

const app = express();
// GM 工具可能从本地文件或其他域打开，需要放行 CORS（含 OPTIONS preflight）
app.options('/gm/*', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-GM-Token, X-Client-Version, Authorization',
    'Access-Control-Max-Age': '86400'
  });
  res.status(204).end();
});
app.use('/gm', (_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-GM-Token, X-Client-Version, Authorization');
  next();
});
app.use((req, res, next) => {
  // /gm 路径已有独立 CORS，跳过通用限制
  if (req.path.startsWith('/gm')) return next();
  cors({ origin: config.corsOrigin })(req, res, next);
});
const BANDWIDTH_SAVER_MODE = String(process.env.BANDWIDTH_SAVER_MODE || '1') !== '0';
app.use(compression({
  threshold: BANDWIDTH_SAVER_MODE ? 1024 : '32kb',
  level: BANDWIDTH_SAVER_MODE ? 4 : 1,
  filter(req, res) {
    if (BANDWIDTH_SAVER_MODE) {
      return compression.filter(req, res);
    }
    const p = String(req.path || '');
    // 兼顾 CPU 场景：战斗与玩家热接口可按需关闭压缩。
    if (p.startsWith('/battle') || p.startsWith('/dungeon-battle') || p.startsWith('/trial') || p.startsWith('/player')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    if (String(req.method || 'GET').toUpperCase() === 'GET') return;
    req.rawBody = buf.length > 0 ? buf.toString() : '';
  }
}));
app.use('/patch', express.static(path.join(__dirname, 'patch')));
app.use('/web', express.static(path.join(__dirname, '..', 'web-client'), {
  index: 'index.html',
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (/\.(js|css)$/i.test(filePath)) {
      // 文件名/查询串已做版本控制，允许强缓存减少重复回源。
      res.setHeader('Cache-Control', BANDWIDTH_SAVER_MODE ? 'public, max-age=604800, immutable' : 'no-cache, must-revalidate');
      if (!BANDWIDTH_SAVER_MODE) {
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      return;
    }
    if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

app.get('/version', (req, res) => {
  const host = req.get('host') || `${config.publicIp}:${config.port}`;
  const protocol = req.protocol || 'http';
  const pckPath = String(config.hotUpdatePckPath || '/patch/client_hotfix.pck');
  const pckUrl = /^https?:\/\//.test(pckPath) ? pckPath : `${protocol}://${host}${pckPath}`;
  return res.json({
    ok: true,
    minVersion: config.minClientVersion || '1.0.0',
    latestVersion: config.latestClientVersion || config.minClientVersion || '1.0.0',
    pckUrl
  });
});

app.use(apiStats.middleware);

// ─── 维护模式中间件 ───
// 进入维护模式后，除 /health、/gm、/version 和静态文件外的所有请求返回 503
function maintenanceMiddleware(req, res, next) {
  if (!wsManager.isMaintenanceMode()) return next();
  const p = String(req.path || '');
  // 放行健康检查、GM 工具、版本查询
  if (p === '/health' || p.startsWith('/gm') || p === '/version' || p === '/favicon.ico') return next();
  return res.status(503).json({ ok: false, error: '服务器维护中，请稍后再试', code: 'MAINTENANCE' });
}
app.use(maintenanceMiddleware);
app.use(overloadGuard);

app.use(versionCheck);
app.use(signVerify);

app.use('/auth', authRoutes);
app.use('/player', playerRoutes);
app.use('/battle', battleRoutes);
app.use('/dungeon', dungeonRoutes);
app.use('/dungeon-battle', dungeonBattleRoutes);
app.use('/exchange', exchangeRoutes);
app.use('/mail', mailRoutes);
app.use('/online', onlineRoutes.router);
app.use('/trial', trialRoutes);
app.use('/gm', gmRoutes);
app.use('/alliance', allianceRoutes);
app.use('/chat', (_req, res) => res.status(503).json({ ok: false, error: '聊天功能已关停' }));
app.use('/invite', inviteRoutes);
app.use('/email', emailRoutes);
app.use('/league', leagueRoutes);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    msg: 'ok',
    boot_id: SERVER_BOOT_ID,
    pid: process.pid,
    uptime_sec: Math.floor(process.uptime()),
    now_ms: Date.now(),
    db_driver: String(config.dbDriver || 'unknown')
  });
});
app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });

// H5 客户端所需的静态游戏数据
const dataLoader = require('./game/dataLoader');
function _safeData(key, fn, fallback = []) {
  try {
    if (typeof fn !== 'function') return fallback;
    const r = fn();
    return r != null ? r : fallback;
  } catch (e) {
    console.warn('[game-data]', key, '加载失败:', e?.message);
    return fallback;
  }
}
let _gameDataCache = null;
app.get('/game-data', (_req, res) => {
  try {
    if (!_gameDataCache) {
      _gameDataCache = {
        items: _safeData('items', () => dataLoader.getItems()),
        skills: _safeData('skills', () => dataLoader.getSkills()),
        skillsDiscipleBattle: _safeData('skillsDiscipleBattle', () => dataLoader.getDiscipleBattleSkills()),
        techniques: _safeData('techniques', () => dataLoader.getTechniques()),
        maps: _safeData('maps', () => dataLoader.getMaps()),
        enemies: _safeData('enemies', () => dataLoader.getEnemies()),
        enemy_prefixes: _safeData('enemy_prefixes', () => dataLoader.getEnemyPrefixes()),
        sects: _safeData('sects', () => dataLoader.getSects()),
        alchemy_recipes: _safeData('alchemy_recipes', () => dataLoader.getAlchemyRecipes()),
        craft_recipes: _safeData('craft_recipes', () => dataLoader.getCraftRecipes()),
        array_shapes: _safeData('array_shapes', () => dataLoader.getArrayShapes()),
        array_runes: _safeData('array_runes', () => dataLoader.getArrayRunes()),
        dungeons: _safeData('dungeons', () => dataLoader.getDungeons())
      };
    }
    res.json({ ok: true, data: _gameDataCache });
  } catch (err) {
    console.error('[game-data] 加载失败:', err?.message || err);
    console.error('[game-data] 堆栈:', err?.stack);
    res.status(500).json({ ok: false, error: '游戏数据加载失败', _debug: String(err?.message || err) });
  }
});

// 未匹配路由
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

// 全局异常捕获（防止未捕获错误导致请求挂起）
app.use((err, _req, res, _next) => {
  console.error('[server] uncaught error:', err?.message || err, '\n', err?.stack || '(no stack)');
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

startScheduler(60 * 1000);
startBackupScheduler();
setInterval(runMemoryPrune, 60 * 60 * 1000);  // 每小时清理过期内存缓存
let _duelRankSettling = false;
setInterval(() => {
  if (_duelRankSettling) return;
  _duelRankSettling = true;
  try {
    Promise.resolve(trySettleIfDue())
      .catch((e) => {
        console.error('[duel-rank] settle error:', e?.message || e);
      })
      .finally(() => {
        _duelRankSettling = false;
      });
  } catch (e) {
    _duelRankSettling = false;
    console.error('[duel-rank] settle error:', e?.message || e);
  }
}, 5 * 60 * 1000);

const LEAGUE_DUE_MIN_DELAY_MS = 500;
const LEAGUE_DUE_MAX_DELAY_MS = 60 * 1000;
const LEAGUE_DUE_WORKER_ENABLED = String(process.env.LEAGUE_DUE_WORKER_ENABLED || '1') !== '0';
const LEAGUE_DUE_WORKER_RESPAWN_MS = (() => {
  const env = Number(process.env.LEAGUE_DUE_WORKER_RESPAWN_MS);
  if (Number.isFinite(env) && env >= 1000) return Math.min(30000, Math.floor(env));
  return 2000;
})();

let _leagueDueTimer = null;
let _leagueDueWorker = null;
let _leagueDueWorkerRespawnTimer = null;

function _clampLeagueDelayMs(delayMs) {
  return Math.max(LEAGUE_DUE_MIN_DELAY_MS, Math.min(LEAGUE_DUE_MAX_DELAY_MS, Math.trunc(Number(delayMs) || 0) || 1000));
}

function _clearMainLeagueTimer() {
  if (_leagueDueTimer) {
    clearTimeout(_leagueDueTimer);
    _leagueDueTimer = null;
  }
}

function _scheduleMainLeagueDue(delayMs) {
  const ms = _clampLeagueDelayMs(delayMs);
  _leagueDueTimer = setTimeout(_runMainLeagueDueTick, ms);
}

function _runMainLeagueDueTick() {
  let nextDelayMs = 1000;
  try {
    const r = leagueSystem.tryRunDueLeagueWork();
    const suggestedSec = Number(r?.next_check_in_sec);
    if (Number.isFinite(suggestedSec) && suggestedSec > 0) {
      nextDelayMs = Math.round(suggestedSec * 1000);
    } else if (r?.busy || r?.progressed) {
      nextDelayMs = 1000;
    } else {
      nextDelayMs = 5000;
    }
  } catch (e) {
    console.error('[league] settle error:', e?.message || e);
    nextDelayMs = 1000;
  }
  _scheduleMainLeagueDue(nextDelayMs);
}

function _startMainLeagueRuntime() {
  if (_leagueDueTimer) return;
  console.warn('[league] using main-thread scheduler fallback');
  _scheduleMainLeagueDue(1000);
}

function _scheduleLeagueWorkerRespawn() {
  if (_leagueDueWorkerRespawnTimer || _shuttingDown || !LEAGUE_DUE_WORKER_ENABLED) return;
  _leagueDueWorkerRespawnTimer = setTimeout(() => {
    _leagueDueWorkerRespawnTimer = null;
    if (_shuttingDown) return;
    if (!_spawnLeagueDueWorker()) {
      _startMainLeagueRuntime();
      _scheduleLeagueWorkerRespawn();
    }
  }, LEAGUE_DUE_WORKER_RESPAWN_MS);
}

function _spawnLeagueDueWorker() {
  if (_leagueDueWorker || !LEAGUE_DUE_WORKER_ENABLED) return false;
  try {
    const workerPath = path.join(__dirname, 'game', 'leagueDueWorker.js');
    const worker = new Worker(workerPath);
    _leagueDueWorker = worker;
    _clearMainLeagueTimer();

    worker.on('message', (msg) => {
      if (!msg || msg.type !== 'league_tick') return;
      if (msg.ok === false) {
        console.warn('[league-worker] tick failed:', msg.error || 'unknown');
      }
    });

    worker.on('error', (err) => {
      console.error('[league-worker] error:', err?.message || err);
    });

    worker.on('exit', (code) => {
      _leagueDueWorker = null;
      if (_shuttingDown) return;
      console.error('[league-worker] exited with code %s; switch to main-thread fallback and respawn', code);
      _startMainLeagueRuntime();
      _scheduleLeagueWorkerRespawn();
    });

    console.log('[league] due-work running in worker thread');
    return true;
  } catch (e) {
    console.error('[league-worker] spawn failed:', e?.message || e);
    _leagueDueWorker = null;
    return false;
  }
}

async function _stopLeagueRuntime() {
  _clearMainLeagueTimer();
  if (_leagueDueWorkerRespawnTimer) {
    clearTimeout(_leagueDueWorkerRespawnTimer);
    _leagueDueWorkerRespawnTimer = null;
  }
  if (_leagueDueWorker) {
    const worker = _leagueDueWorker;
    _leagueDueWorker = null;
    try { worker.postMessage({ type: 'stop' }); } catch (_) {}
    try { await worker.terminate(); } catch (_) {}
  }
}

function _startLeagueRuntime() {
  if (LEAGUE_DUE_WORKER_ENABLED) {
    if (_spawnLeagueDueWorker()) return;
    console.warn('[league] worker unavailable, fallback to main-thread scheduler');
  }
  _startMainLeagueRuntime();
}

_startLeagueRuntime();

const gameLoop = require('./game/gameLoop');
const battleSessionCache = require('./game/battleSessionCache');
const dungeonBattleCache = require('./game/dungeonBattleCache');
dungeonBattleCache.init(db.saveDungeonBattleAsync || db.saveDungeonBattle);

const server = http.createServer(app);

const _NOISY_CLIENT_ERROR_CODES = new Set(['EPIPE', 'ECONNRESET']);
const CLIENT_ERROR_LOG_WINDOW_MS = Math.max(1000, Math.floor(_numEnv('CLIENT_ERROR_LOG_WINDOW_MS', 5000)));
let _clientErrorWindowStart = Date.now();
let _clientErrorNoisyCount = 0;
let _clientErrorNoisyByCode = Object.create(null);

function _flushNoisyClientErrorSummary(nowMs) {
  if (_clientErrorNoisyCount <= 0) return;
  const elapsedMs = Math.max(1, nowMs - _clientErrorWindowStart);
  console.warn('[server] noisy clientError summary total=%d byCode=%j windowMs=%d',
    _clientErrorNoisyCount,
    _clientErrorNoisyByCode,
    elapsedMs);
  _clientErrorNoisyCount = 0;
  _clientErrorNoisyByCode = Object.create(null);
  _clientErrorWindowStart = nowMs;
}

function _numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

// Align Node HTTP socket lifecycle with nginx upstream keepalive to reduce random RST/502 bursts.
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Math.max(5000, Math.floor(_numEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 75000)));
const HTTP_HEADERS_TIMEOUT_MS = Math.max(
  HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000,
  Math.floor(_numEnv('HTTP_HEADERS_TIMEOUT_MS', HTTP_KEEP_ALIVE_TIMEOUT_MS + 5000))
);
const HTTP_REQUEST_TIMEOUT_MS = Math.max(10000, Math.floor(_numEnv('HTTP_REQUEST_TIMEOUT_MS', 120000)));

server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
server.setTimeout(0);
server.on('clientError', (err, socket) => {
  try {
    const code = String(err?.code || '').trim();
    const nowMs = Date.now();
    if (nowMs - _clientErrorWindowStart >= CLIENT_ERROR_LOG_WINDOW_MS) {
      _flushNoisyClientErrorSummary(nowMs);
    }
    if (_NOISY_CLIENT_ERROR_CODES.has(code)) {
      _clientErrorNoisyCount += 1;
      _clientErrorNoisyByCode[code] = Number(_clientErrorNoisyByCode[code] || 0) + 1;
      if (socket && !socket.destroyed) socket.destroy();
      return;
    }
    console.warn('[server] clientError:', code || err?.message || err);
    if (socket && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  } catch (_) {
    try { socket.destroy(); } catch (__){ }
  }
});

console.log('[server] http timeouts keepAlive=%dms headers=%dms request=%dms', HTTP_KEEP_ALIVE_TIMEOUT_MS, HTTP_HEADERS_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS);
wsManager.init(server);

async function onShutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log('[服务端] 正在关闭...');
  try { await _stopLeagueRuntime(); } catch (_) {}
  try { gameLoop.stop(); } catch (e) { console.error('[shutdown] gameLoop.stop:', e?.message || e); }
  try { await battleSessionCache.flushPersistence(); } catch (e) { console.error('[shutdown] battleSessionCache.flush:', e?.message || e); }
  try { await dungeonBattleCache.flushAllAsync(); } catch (e) { console.error('[shutdown] dungeonBattleCache.flush:', e?.message || e); }
  try { db.flushPlayerCache(); } catch (e) { console.error('[shutdown] flushPlayerCache:', e?.message || e); }
  try { await redisStore.close(); } catch (e) { console.error('[shutdown] redis.close:', e?.message || e); }
  process.exit(0);
}

process.on('SIGTERM', () => { onShutdown(); });
process.on('SIGINT', () => { onShutdown(); });
process.on('SIGHUP', () => { onShutdown(); });
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('warning', (warning) => {
  if (!warning) return;
  if (String(warning.name || '') === 'PromiseRejectionHandledWarning') {
    console.warn('[server] PromiseRejectionHandledWarning:', warning.message || '(no message)');
    if (warning.stack) console.warn(warning.stack);
  }
});
process.on('uncaughtException', async (err) => {
  console.error('[server] uncaughtException:', err?.message || err, err?.stack);
  // ECONNREFUSED from residual sync-mysql: log but do not crash
  if (err && err.code === 'ECONNREFUSED') {
    console.warn('[server] ECONNREFUSED caught, suppressing process exit (likely sync-mysql residual)');
    return;
  }
  try { await battleSessionCache.flushPersistence(); } catch (_) {}
  try { await dungeonBattleCache.flushAllAsync(); } catch (_) {}
  try { db.flushPlayerCache(); } catch (_) {}
  try { await redisStore.close(); } catch (_) {}
  process.exit(1);
});

async function boot() {
  const battleCacheOk = await battleSessionCache.initPersistence();
  const redisReady = redisStore.isReady();
  console.log('[boot] battle cache persistence=%s redis_ready=%s', battleCacheOk ? 'on' : 'off', redisReady ? 'yes' : 'no');
  if (!redisReady) {
    console.warn('[boot] redis not ready; ban-cache and battle persistence will use local fallback paths');
  }
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[服务端] 启动于 http://0.0.0.0:${config.port}`);
    console.log(`[服务端] 公网访问: http://${config.publicIp}:${config.port}`);
    console.log(`[服务端] WebSocket: ws://${config.publicIp}:${config.port}/ws`);
    console.log('[服务端] boot_id=%s pid=%s db_driver=%s', SERVER_BOOT_ID, process.pid, String(config.dbDriver || 'unknown'));
    gameLoop.start();
  });
}

boot().catch((err) => {
  console.error('[服务端] 启动失败:', err?.message || err, err?.stack);
  process.exit(1);
});
