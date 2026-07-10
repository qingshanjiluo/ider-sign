const { createClient } = require('redis');
const config = require('./config');

let _client = null;
let _ready = false;
let _initPromise = null;

async function init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const url = String(config.redisUrl || '').trim();
    if (!url) {
      console.warn('[redis] 未配置 REDIS_URL，战斗缓存仅使用内存');
      return null;
    }
    const client = createClient({
      url,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 200, 2000))
      }
    });
    client.on('error', (err) => {
      _ready = false;
      console.error('[redis] error:', err?.message || err);
    });
    client.on('end', () => {
      _ready = false;
    });
    await client.connect();
    _client = client;
    _ready = true;
    console.log('[redis] connected:', url);
    return client;
  })().catch((err) => {
    _ready = false;
    _client = null;
    console.error('[redis] init failed:', err?.message || err);
    return null;
  });
  return _initPromise;
}

function isReady() {
  return !!(_client && _ready);
}

async function getJson(key) {
  if (!isReady()) return null;
  const raw = await _client.get(String(key));
  if (!raw) return null;
  return JSON.parse(raw);
}

async function setJson(key, value, ttlSec = 0) {
  if (!isReady()) return false;
  const ttl = Number(ttlSec);
  if (Number.isFinite(ttl) && ttl > 0) {
    await _client.set(String(key), JSON.stringify(value), { EX: Math.max(1, Math.floor(ttl)) });
  } else {
    await _client.set(String(key), JSON.stringify(value));
  }
  return true;
}

async function del(key) {
  if (!isReady()) return false;
  await _client.del(String(key));
  return true;
}

async function tryAcquireLease(key, value, ttlMs = 10000) {
  await init();
  if (!isReady()) return false;
  const k = String(key || '').trim();
  const v = String(value || '');
  if (!k || !v) return false;
  const ttl = Math.max(1000, Math.min(10 * 60 * 1000, Math.floor(Number(ttlMs) || 10000)));
  const ret = await _client.set(k, v, { NX: true, PX: ttl });
  return String(ret || '').toUpperCase() === 'OK';
}

async function releaseLease(key, value) {
  if (!isReady()) return false;
  const k = String(key || '').trim();
  const v = String(value || '');
  if (!k || !v) return false;
  const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end`;
  const ret = await _client.eval(script, {
    keys: [k],
    arguments: [v]
  });
  return Number(ret) > 0;
}

async function zAdd(key, score, member) {
  if (!isReady()) return false;
  await _client.zAdd(String(key), [{ score: Number(score) || 0, value: String(member) }]);
  return true;
}

async function zRem(key, member) {
  if (!isReady()) return false;
  await _client.zRem(String(key), String(member));
  return true;
}

async function zRangeByScore(key, min, max, count = 100, offset = 0) {
  if (!isReady()) return [];
  const lim = Math.max(1, Math.min(5000, Number(count) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await _client.zRangeByScore(String(key), min, max, {
    LIMIT: { offset: off, count: lim }
  });
  return Array.isArray(rows) ? rows : [];
}

async function incrWithExpire(key, ttlSec = 1) {
  if (!isReady()) return null;
  const k = String(key || '').trim();
  if (!k) return null;
  const ttl = Math.max(1, Math.floor(Number(ttlSec) || 1));
  const val = await _client.incr(k);
  if (Number(val) === 1) {
    await _client.expire(k, ttl);
  }
  return Number(val);
}

async function close() {
  if (!_client) return;
  try {
    await _client.quit();
  } catch {
    try { _client.disconnect(); } catch {}
  } finally {
    _client = null;
    _ready = false;
    _initPromise = null;
  }
}

module.exports = {
  init,
  isReady,
  getJson,
  setJson,
  del,
  zAdd,
  zRem,
  zRangeByScore,
  incrWithExpire,
  tryAcquireLease,
  releaseLease,
  close
};
