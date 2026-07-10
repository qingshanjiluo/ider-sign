#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const redisStore = require('../redisStore');
const config = require('../config');

async function main() {
  await redisStore.init();
  if (!redisStore.isReady()) {
    console.error('[redis-diag] redis not ready (REDIS_URL=%s)', String(config.redisUrl || ''));
    process.exit(1);
  }

  const key = `${String(config.redisKeyPrefix || 'xianxia')}:diag:${Date.now()}`;
  const payload = { ok: true, ts: Date.now() };
  const setOk = await redisStore.setJson(key, payload, 30);
  const got = await redisStore.getJson(key);
  await redisStore.del(key);

  const pass = !!setOk && !!got && got.ok === true;
  console.log('[redis-diag] ready=%s set=%s get_ok=%s key_prefix=%s',
    redisStore.isReady() ? 'yes' : 'no',
    setOk ? 'yes' : 'no',
    got && got.ok === true ? 'yes' : 'no',
    String(config.redisKeyPrefix || 'xianxia'));

  await redisStore.close();
  if (!pass) process.exit(2);
}

main().catch(async (err) => {
  console.error('[redis-diag] failed:', err?.message || err);
  try { await redisStore.close(); } catch (_) {}
  process.exit(1);
});
