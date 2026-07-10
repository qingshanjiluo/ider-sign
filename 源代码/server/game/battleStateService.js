const bsc = require('./battleSessionCache');
const engine = require('./battleEngine');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function queryBattleState({ accountId, battleId, after }) {
  const id = String(battleId || '');
  if (!id) return { ok: false, error: '缺少 battleId' };

  const session = bsc.getSession(id);
  if (!session || session.account_id !== accountId) {
    return { ok: false, error: '战斗会话无效或已过期' };
  }

  session.last_poll_at = Math.floor(Date.now() / 1000);
  const afterIdx = Math.max(0, intVal(after, 0));
  const events = bsc.listEventsSince(id, afterIdx, 200).map((x) => ({
    index: intVal(x.event_index, 0),
    ...(x.event || {})
  }));

  return {
    ok: true,
    battleId: id,
    status: String(session.status || 'active'),
    last_seq: Math.max(0, intVal(session.last_seq, 0)),
    state: engine.stateToClient(session.state || {}),
    events,
    result: session.result || {}
  };
}

module.exports = {
  queryBattleState
};
