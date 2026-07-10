const _stats = {};
let _startedAt = Date.now();

function middleware(req, res, next) {
  const start = Date.now();
  const key = `${req.method} ${req.path}`;
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (!_stats[key]) _stats[key] = { count: 0, totalMs: 0, maxMs: 0 };
    const s = _stats[key];
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  });
  next();
}

function getStats() {
  return Object.entries(_stats)
    .map(([path, s]) => ({
      path,
      count: s.count,
      avg_ms: +(s.totalMs / (s.count || 1)).toFixed(1),
      max_ms: s.maxMs,
      total_ms: s.totalMs,
    }))
    .sort((a, b) => b.total_ms - a.total_ms);
}

function resetStats() {
  for (const key of Object.keys(_stats)) delete _stats[key];
  _startedAt = Date.now();
}

function getStartedAt() { return _startedAt; }

module.exports = { middleware, getStats, resetStats, getStartedAt };
