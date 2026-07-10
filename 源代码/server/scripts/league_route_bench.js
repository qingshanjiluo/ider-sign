#!/usr/bin/env node

const { performance } = require('perf_hooks');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.bench') });
} catch (_) {
  // Ignore dotenv load errors; process.env still works.
}

const BASE_URL = String(process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const STATIC_TOKEN = String(process.env.BENCH_BEARER_TOKEN || process.env.AUTH_TOKEN || '').trim();
const USERNAME = String(process.env.BENCH_USERNAME || '').trim();
const PASSWORD = String(process.env.BENCH_PASSWORD || '').trim();
const MACHINE_ID = String(process.env.BENCH_MACHINE_ID || 'bench-local').trim();
const AUTO_REGISTER = String(process.env.BENCH_AUTO_REGISTER || '1') !== '0';
const CONCURRENCY = Math.max(1, Math.min(64, intVal(process.env.BENCH_CONCURRENCY, 10)));
const ROUNDS = Math.max(1, Math.min(200, intVal(process.env.BENCH_ROUNDS, 50)));
const TIMEOUT_MS = Math.max(1000, Math.min(60000, intVal(process.env.BENCH_TIMEOUT_MS, 10000)));

const ENDPOINTS = [
  { name: 'status', path: '/league/status' },
  { name: 'leaderboard', path: '/league/leaderboard?limit=100' },
  { name: 'team_rank', path: '/league/team_rank?limit=100' },
  { name: 'matches', path: '/league/matches?limit=50' },
  { name: 'shop', path: '/league/shop' }
];

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length <= 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function fmt(n) {
  return Number(n || 0).toFixed(2);
}

async function postJson(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text || '{}'); } catch (_) { data = null; }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveToken() {
  if (STATIC_TOKEN) return STATIC_TOKEN;
  if (!USERNAME || !PASSWORD) {
    throw new Error('missing token and credentials: set BENCH_BEARER_TOKEN or BENCH_USERNAME/BENCH_PASSWORD');
  }

  const login = await postJson('/auth/login', {
    username: USERNAME,
    password: PASSWORD,
    machine_id: MACHINE_ID
  });
  if (login?.data?.ok && login?.data?.token) return String(login.data.token);

  if (!AUTO_REGISTER) {
    throw new Error(`login failed: ${login?.data?.error || login?.status || 'unknown'}`);
  }

  const reg = await postJson('/auth/register', {
    username: USERNAME,
    password: PASSWORD,
    machine_id: MACHINE_ID
  });
  if (reg?.data?.ok && reg?.data?.token) return String(reg.data.token);

  // If username already exists while registering, retry login once.
  const loginAgain = await postJson('/auth/login', {
    username: USERNAME,
    password: PASSWORD,
    machine_id: MACHINE_ID
  });
  if (loginAgain?.data?.ok && loginAgain?.data?.token) return String(loginAgain.data.token);

  throw new Error(`unable to obtain token: ${loginAgain?.data?.error || reg?.data?.error || login?.data?.error || 'unknown'}`);
}

async function runEndpoint(endpoint, token) {
  const url = `${BASE_URL}${endpoint.path}`;
  const total = CONCURRENCY * ROUNDS;
  const latencies = [];
  let success = 0;
  let failed = 0;
  let bytes = 0;

  const started = performance.now();
  for (let round = 0; round < ROUNDS; round += 1) {
    const jobs = [];
    for (let i = 0; i < CONCURRENCY; i += 1) jobs.push(fetchOnceWithToken(url, token));
    const results = await Promise.all(jobs);
    for (const r of results) {
      latencies.push(r.elapsed);
      if (r.ok) {
        success += 1;
        bytes += intVal(r.bytes, 0);
      } else {
        failed += 1;
      }
    }
  }
  const elapsedTotal = performance.now() - started;
  const sorted = latencies.slice().sort((a, b) => a - b);
  return {
    name: endpoint.name,
    total,
    success,
    failed,
    elapsedTotal,
    rps: total / Math.max(0.001, elapsedTotal / 1000),
    avg: sorted.reduce((s, n) => s + n, 0) / Math.max(1, sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    bytes
  };
}

async function fetchOnceWithToken(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    const text = await res.text();
    const elapsed = performance.now() - started;
    return {
      ok: res.ok,
      status: res.status,
      elapsed,
      bytes: Buffer.byteLength(text || '', 'utf8')
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      elapsed: performance.now() - started,
      error: e && e.message ? e.message : String(e)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('[bench] league routes benchmark start');
  console.log(`[bench] base=${BASE_URL} concurrency=${CONCURRENCY} rounds=${ROUNDS} timeout_ms=${TIMEOUT_MS}`);

  const token = await resolveToken();
  console.log('[bench] auth ready');

  const rows = [];
  for (const ep of ENDPOINTS) {
    const out = await runEndpoint(ep, token);
    rows.push(out);
    console.log(
      `[bench] ${out.name} total=${out.total} ok=${out.success} fail=${out.failed}` +
      ` avg=${fmt(out.avg)}ms p50=${fmt(out.p50)}ms p95=${fmt(out.p95)}ms p99=${fmt(out.p99)}ms max=${fmt(out.max)}ms rps=${fmt(out.rps)}`
    );
  }

  const totalReq = rows.reduce((s, r) => s + r.total, 0);
  const totalOk = rows.reduce((s, r) => s + r.success, 0);
  const totalFail = rows.reduce((s, r) => s + r.failed, 0);
  console.log(`[bench] done total=${totalReq} ok=${totalOk} fail=${totalFail}`);
}

main().catch((e) => {
  console.error('[bench] fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
