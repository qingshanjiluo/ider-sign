const { parentPort } = require('worker_threads');
const leagueSystem = require('./leagueSystem');

const CHECK_MIN_MS = 500;
const CHECK_MAX_MS = 60 * 1000;

let timer = null;
let stopping = false;

function clampDelayMs(ms) {
  const v = Number(ms);
  const n = Number.isFinite(v) ? Math.floor(v) : 1000;
  return Math.max(CHECK_MIN_MS, Math.min(CHECK_MAX_MS, n));
}

function scheduleNext(ms) {
  if (stopping) return;
  const delay = clampDelayMs(ms);
  timer = setTimeout(runOnce, delay);
}

function runOnce() {
  if (stopping) return;
  let nextDelay = 1000;
  try {
    const r = leagueSystem.tryRunDueLeagueWork();
    const suggestedSec = Number(r?.next_check_in_sec);
    if (Number.isFinite(suggestedSec) && suggestedSec > 0) {
      nextDelay = Math.round(suggestedSec * 1000);
    } else if (r?.busy || r?.progressed) {
      nextDelay = 1000;
    } else {
      nextDelay = 5000;
    }

    if (parentPort) {
      parentPort.postMessage({
        type: 'league_tick',
        ok: true,
        progressed: !!r?.progressed,
        busy: !!r?.busy,
        next_ms: clampDelayMs(nextDelay)
      });
    }
  } catch (err) {
    nextDelay = 1000;
    const msg = err?.message || String(err);
    if (msg.includes('database is locked')) {
      // SQLite lock contention: back off to avoid hammering write lock and log storms.
      nextDelay = 5000;
    }
    console.error('[league-worker] tick error:', msg);
    if (parentPort) {
      parentPort.postMessage({ type: 'league_tick', ok: false, error: msg, next_ms: clampDelayMs(nextDelay) });
    }
  }
  scheduleNext(nextDelay);
}

function stopWorker() {
  if (stopping) return;
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    const type = String(msg?.type || '');
    if (type === 'stop') {
      stopWorker();
      return;
    }
    if (type === 'run_now') {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      runOnce();
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('[league-worker] uncaughtException:', err?.message || err, err?.stack || '');
});

process.on('unhandledRejection', (reason) => {
  console.error('[league-worker] unhandledRejection:', reason);
});

scheduleNext(1000);
