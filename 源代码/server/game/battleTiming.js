function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function calculateRestTime(level) {
  const lv = intVal(level, 1);
  if (lv <= 120) return 5;
  if (lv <= 160) return 10;
  if (lv <= 200) return 15;
  if (lv <= 240) return 20;
  return 25;
}

function clampRestUntil(player, now = nowSec()) {
  if (!player || typeof player !== 'object') return 0;
  const n = intVal(now, nowSec());
  const maxRest = calculateRestTime(intVal(player.level, 1));
  const raw = intVal(player.rest_until, 0);
  if (raw <= n) return 0;
  return Math.min(raw, n + maxRest);
}

function isAutoRestartEnabled(session) {
  return !!session && session.auto_restart !== false;
}

module.exports = {
  calculateRestTime,
  clampRestUntil,
  isAutoRestartEnabled
};
