#!/usr/bin/env node
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function intEnv(name, fallback, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function numEnv(name, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function normalizeJsonText(raw) {
  const s = String(raw || '');
  try {
    return JSON.stringify(JSON.parse(s));
  } catch (_) {
    return s;
  }
}

function sha1(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length <= 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[idx];
}

async function mysqlCount(pool, table) {
  const sql = `SELECT COUNT(1) AS c FROM ${table}`;
  const [rows] = await pool.query(sql);
  return Number(rows?.[0]?.c || 0);
}

function sqliteCount(sqliteDb, table) {
  const row = sqliteDb.prepare(`SELECT COUNT(1) AS c FROM ${table}`).get();
  return Number(row?.c || 0);
}

async function main() {
  const sampleSize = intEnv('MYSQL_CUTOVER_SAMPLE_SIZE', 200, 10, 5000);
  const latencyChecks = intEnv('MYSQL_CUTOVER_LATENCY_CHECKS', 25, 5, 200);
  const maxP95Ms = numEnv('MYSQL_CUTOVER_MAX_P95_MS', 40, 1, 5000);
  const maxCountDiff = intEnv('MYSQL_CUTOVER_MAX_COUNT_DIFF', 0, 0, 1000000000);
  const maxMismatchRate = numEnv('MYSQL_CUTOVER_MAX_MISMATCH_RATE', 0, 0, 1);
  const allowNoSqlite = String(process.env.MYSQL_CUTOVER_ALLOW_NO_SQLITE || '0') === '1';

  const dbPathRaw = process.env.DB_PATH || './data/game.db';
  const dbPath = path.isAbsolute(dbPathRaw)
    ? dbPathRaw
    : path.resolve(path.join(__dirname, '..'), dbPathRaw);

  const mysqlHost = String(process.env.MYSQL_HOST || '127.0.0.1');
  const mysqlPort = intEnv('MYSQL_PORT', 3306, 1, 65535);
  const mysqlUser = String(process.env.MYSQL_USER || '');
  const mysqlPassword = String(process.env.MYSQL_PASSWORD || '');
  const mysqlDatabase = String(process.env.MYSQL_DATABASE || 'xianxia_game');

  if (!mysqlUser || !mysqlDatabase) {
    throw new Error('missing MYSQL_USER or MYSQL_DATABASE in .env');
  }

  let sqliteDb = null;
  let sqliteReady = false;
  try {
    const Database = require('better-sqlite3');
    sqliteDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    sqliteReady = true;
  } catch (err) {
    if (!allowNoSqlite) {
      throw new Error(`better-sqlite3 unavailable; run npm install/rebuild or set MYSQL_CUTOVER_ALLOW_NO_SQLITE=1. detail=${err?.message || err}`);
    }
    console.warn('[mysql-cutover-gate] sqlite baseline checks skipped: %s', err?.message || err);
  }

  const mysqlPool = mysql.createPool({
    host: mysqlHost,
    port: mysqlPort,
    user: mysqlUser,
    password: mysqlPassword,
    database: mysqlDatabase,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
  });

  const checks = [];
  const tables = ['accounts', 'players'];

  try {
    const [pingRows] = await mysqlPool.query('SELECT 1 AS ok');
    const pingOk = Number(pingRows?.[0]?.ok || 0) === 1;
    checks.push({
      name: 'mysql_ping',
      ok: pingOk,
      detail: pingOk ? 'ok' : 'not ok'
    });

    if (sqliteReady) {
      for (const table of tables) {
        const sqliteC = sqliteCount(sqliteDb, table);
        const mysqlC = await mysqlCount(mysqlPool, table);
        const diff = Math.abs(sqliteC - mysqlC);
        checks.push({
          name: `count_${table}`,
          ok: diff <= maxCountDiff,
          detail: `sqlite=${sqliteC} mysql=${mysqlC} diff=${diff}`
        });
      }

      const sqliteSample = sqliteDb.prepare(
        'SELECT account_id, data FROM players ORDER BY account_id DESC LIMIT ?'
      ).all(sampleSize);
      const ids = sqliteSample
        .map((r) => Number(r?.account_id || 0))
        .filter((id) => id > 0);

      let mysqlRows = [];
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await mysqlPool.query(
          `SELECT account_id, data FROM players WHERE account_id IN (${placeholders})`,
          ids
        );
        mysqlRows = Array.isArray(rows) ? rows : [];
      }
      const mysqlMap = new Map(mysqlRows.map((r) => [Number(r.account_id), String(r.data || '')]));

      let missingInMysql = 0;
      let mismatch = 0;
      for (const r of sqliteSample) {
        const aid = Number(r?.account_id || 0);
        if (aid <= 0) continue;
        const mysqlData = mysqlMap.get(aid);
        if (mysqlData == null) {
          missingInMysql += 1;
          continue;
        }
        const sHash = sha1(normalizeJsonText(r?.data || ''));
        const mHash = sha1(normalizeJsonText(mysqlData));
        if (sHash !== mHash) mismatch += 1;
      }
      const sampleDen = Math.max(1, sqliteSample.length);
      const mismatchRate = (missingInMysql + mismatch) / sampleDen;
      checks.push({
        name: 'sample_player_data',
        ok: mismatchRate <= maxMismatchRate,
        detail: `sample=${sqliteSample.length} missing=${missingInMysql} mismatch=${mismatch} rate=${mismatchRate.toFixed(4)}`
      });
    } else {
      checks.push({
        name: 'sqlite_baseline',
        ok: true,
        detail: 'skipped (MYSQL_CUTOVER_ALLOW_NO_SQLITE=1)'
      });
    }

    const latencyMs = [];
    for (let i = 0; i < latencyChecks; i += 1) {
      const beginNs = process.hrtime.bigint();
      await mysqlPool.query('SELECT account_id FROM players ORDER BY account_id DESC LIMIT 1');
      const costMs = Number(process.hrtime.bigint() - beginNs) / 1e6;
      latencyMs.push(costMs);
    }
    latencyMs.sort((a, b) => a - b);
    const p95 = percentile(latencyMs, 0.95);
    const p50 = percentile(latencyMs, 0.50);
    checks.push({
      name: 'mysql_read_latency',
      ok: p95 <= maxP95Ms,
      detail: `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max_p95=${maxP95Ms}ms n=${latencyChecks}`
    });

    const failed = checks.filter((c) => !c.ok);
    console.log('[mysql-cutover-gate] summary');
    for (const c of checks) {
      console.log('- %s: %s (%s)', c.name, c.ok ? 'PASS' : 'FAIL', c.detail);
    }

    if (failed.length > 0) {
      console.log('[mysql-cutover-gate] decision=HOLD (do not cut traffic yet)');
      process.exitCode = 2;
      return;
    }

    console.log('[mysql-cutover-gate] decision=READY (can begin canary cutover)');
    process.exitCode = 0;
  } finally {
    if (sqliteDb) {
      try { sqliteDb.close(); } catch (_) {}
    }
    try { await mysqlPool.end(); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('[mysql-cutover-gate] failed:', err?.message || err);
  process.exit(1);
});
