#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysqlAsyncPool = require('../mysqlAsyncPool');

async function main() {
  const ok = await mysqlAsyncPool.ping();
  if (!ok) {
    console.error('[mysql-async-smoke] ping failed (DB_DRIVER may not be mysql)');
    process.exit(1);
  }

  const rows = await mysqlAsyncPool.query('SELECT DATABASE() AS db, NOW() AS now_ts');
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
  console.log('[mysql-async-smoke] ok db=%s now=%s', String(row.db || ''), String(row.now_ts || ''));
  await mysqlAsyncPool.close();
}

main().catch(async (err) => {
  console.error('[mysql-async-smoke] failed:', err?.message || err);
  try { await mysqlAsyncPool.close(); } catch (_) {}
  process.exit(1);
});
