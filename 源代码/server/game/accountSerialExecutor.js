const _tails = new Map();

async function run(accountId, task) {
  const aid = Number(accountId) || 0;
  if (aid <= 0 || typeof task !== 'function') return task();

  const prev = _tails.get(aid) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => task());

  _tails.set(aid, next.finally(() => {
    if (_tails.get(aid) === next) _tails.delete(aid);
  }));

  return next;
}

function hasPending(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;
  return _tails.has(aid);
}

module.exports = { run, hasPending };
