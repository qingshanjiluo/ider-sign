const config = require('../config');
const redisStore = require('../redisStore');

const ENABLED = String(process.env.AUTO_BATTLE_REDIS_INDEX_ENABLED || '1') !== '0';
const STATE_TTL_SEC = (() => {
  const v = Number(process.env.AUTO_BATTLE_REDIS_STATE_TTL_SEC);
  return Number.isFinite(v) && v > 0 ? Math.max(300, Math.floor(v)) : 3 * 24 * 3600;
})();

const ZSET_KEY = `${String(config.redisKeyPrefix || 'xianxia')}:autobattle:candidates:v1`;

function _nowSec() {
  return Math.floor(Date.now() / 1000);
}

function _stateKey(accountId) {
  return `${String(config.redisKeyPrefix || 'xianxia')}:autobattle:state:${Number(accountId) || 0}`;
}

function _int(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function isEnabled() {
  return ENABLED && redisStore.isReady();
}

function _buildState(accountId, player) {
  const aid = _int(accountId, 0);
  const mapId = Math.max(1, _int(player?.auto_battle_map_id || player?.current_map_id || 1, 1));
  const lastActivityAt = _int(player?.time_state?.last_activity_at, _nowSec());
  const restUntil = _int(player?.rest_until, 0);
  return {
    account_id: aid,
    map_id: mapId,
    auto_battle_map_id: mapId,
    current_map_id: mapId,
    last_activity_at: lastActivityAt,
    rest_until: restUntil,
    updated_at: _nowSec()
  };
}

function removeAccount(accountId) {
  if (!isEnabled()) return;
  const aid = _int(accountId, 0);
  if (aid <= 0) return;
  Promise.all([
    redisStore.zRem(ZSET_KEY, String(aid)),
    redisStore.del(_stateKey(aid))
  ]).catch(() => {});
}

function upsertFromPlayer(accountId, player) {
  if (!isEnabled()) return;
  const aid = _int(accountId, 0);
  if (aid <= 0 || !player || typeof player !== 'object') return;

  if (player.auto_battle_enabled !== true) {
    removeAccount(aid);
    return;
  }

  const state = _buildState(aid, player);
  Promise.all([
    redisStore.zAdd(ZSET_KEY, aid, String(aid)),
    redisStore.setJson(_stateKey(aid), state, STATE_TTL_SEC)
  ]).catch(() => {});
}

async function scanAfter(afterAccountId = 0, limit = 250) {
  if (!isEnabled()) {
    return { rows: [], nextCursor: _int(afterAccountId, 0), wrapped: false, source: 'disabled' };
  }

  const after = Math.max(0, _int(afterAccountId, 0));
  const lim = Math.max(1, Math.min(2000, _int(limit, 250)));

  let members = await redisStore.zRangeByScore(ZSET_KEY, `(${after}`, '+inf', lim);
  let wrapped = false;
  if ((!members || members.length <= 0) && after > 0) {
    members = await redisStore.zRangeByScore(ZSET_KEY, '-inf', '+inf', lim);
    wrapped = true;
  }

  if (!Array.isArray(members) || members.length <= 0) {
    return { rows: [], nextCursor: wrapped ? 0 : after, wrapped, source: 'redis' };
  }

  const accountIds = members
    .map((m) => _int(m, 0))
    .filter((aid) => aid > 0);
  if (accountIds.length <= 0) {
    return { rows: [], nextCursor: wrapped ? 0 : after, wrapped, source: 'redis' };
  }

  const states = await Promise.all(
    accountIds.map((aid) => redisStore.getJson(_stateKey(aid)).catch(() => null))
  );

  const now = _nowSec();
  const rows = [];
  for (let i = 0; i < accountIds.length; i++) {
    const aid = accountIds[i];
    const st = states[i] && typeof states[i] === 'object' ? states[i] : null;
    rows.push({
      account_id: aid,
      auto_battle_enabled: true,
      auto_battle_map_id: Math.max(1, _int(st?.auto_battle_map_id || st?.map_id || 1, 1)),
      current_map_id: Math.max(1, _int(st?.current_map_id || st?.map_id || 1, 1)),
      rest_until: _int(st?.rest_until, 0),
      last_activity_at: _int(st?.last_activity_at, now)
    });
  }

  const nextCursor = rows.length > 0
    ? _int(rows[rows.length - 1]?.account_id, 0)
    : (wrapped ? 0 : after);

  return {
    rows,
    nextCursor,
    wrapped,
    source: 'redis'
  };
}

async function rebuildFromDb(dbApi, options = {}) {
  if (!isEnabled()) return { ok: false, reason: 'disabled_or_redis_not_ready', indexed: 0 };
  if (!dbApi || typeof dbApi.listAutoBattlePlayerRows !== 'function') {
    return { ok: false, reason: 'db_api_missing', indexed: 0 };
  }

  const batchSize = Math.max(50, Math.min(1000, _int(options.batchSize, 300)));
  const maxRows = Math.max(1000, _int(options.maxRows, 200000));

  let cursor = 0;
  let indexed = 0;

  try {
    await redisStore.del(ZSET_KEY);
  } catch (_) {}

  while (indexed < maxRows) {
    const rows = dbApi.listAutoBattlePlayerRows(cursor, batchSize);
    if (!Array.isArray(rows) || rows.length <= 0) break;

    const ops = [];
    for (const row of rows) {
      const aid = _int(row?.account_id, 0);
      if (aid <= 0) continue;
      const enabled = row?.auto_battle_enabled === true || _int(row?.auto_battle_enabled, 0) === 1;
      if (!enabled) continue;
      let st = null;
      if (typeof row?.data === 'string') {
        let player = null;
        try { player = JSON.parse(row?.data || '{}'); } catch (_) { player = null; }
        if (!player || player.auto_battle_enabled !== true) continue;
        st = _buildState(aid, player);
      } else {
        st = {
          account_id: aid,
          map_id: Math.max(1, _int(row?.auto_battle_map_id || row?.current_map_id || 1, 1)),
          auto_battle_map_id: Math.max(1, _int(row?.auto_battle_map_id || row?.current_map_id || 1, 1)),
          current_map_id: Math.max(1, _int(row?.current_map_id || row?.auto_battle_map_id || 1, 1)),
          last_activity_at: _int(row?.last_activity_at, _nowSec()),
          rest_until: _int(row?.rest_until, 0),
          updated_at: _nowSec()
        };
      }
      ops.push(redisStore.zAdd(ZSET_KEY, aid, String(aid)));
      ops.push(redisStore.setJson(_stateKey(aid), st, STATE_TTL_SEC));
      indexed += 1;
    }

    if (ops.length > 0) {
      await Promise.all(ops.map((p) => Promise.resolve(p).catch(() => false)));
    }

    cursor = _int(rows[rows.length - 1]?.account_id, cursor);
    if (rows.length < batchSize) break;
    await new Promise((r) => setTimeout(r, 0));
  }

  return { ok: true, reason: 'ok', indexed };
}

module.exports = {
  isEnabled,
  upsertFromPlayer,
  removeAccount,
  scanAfter,
  rebuildFromDb
};
