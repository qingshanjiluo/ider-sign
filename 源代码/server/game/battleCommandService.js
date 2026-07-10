function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }

let _cachedBsc = null;
let _cachedEngine = null;
let _cachedFinalizeBattle = null;

function resolveBscApi(overrideApi) {
  if (overrideApi) return overrideApi;
  if (_cachedBsc) return _cachedBsc;
  _cachedBsc = require('./battleSessionCache');
  return _cachedBsc;
}

function resolveEngineApi(overrideApi) {
  if (overrideApi) return overrideApi;
  if (_cachedEngine) return _cachedEngine;
  _cachedEngine = require('./battleEngine');
  return _cachedEngine;
}

function resolveFinalizeBattleFn(overrideFn) {
  if (typeof overrideFn === 'function') return overrideFn;
  if (_cachedFinalizeBattle) return _cachedFinalizeBattle;
  _cachedFinalizeBattle = require('./battleSettlementService').finalizeBattle;
  return _cachedFinalizeBattle;
}

async function executeBattleCommand({ accountId, body, deps }) {
  const bscApi = resolveBscApi(deps?.bsc);
  const engineApi = resolveEngineApi(deps?.engine);
  const { battleId, seq, action, skillId, itemId } = body || {};
  if (!battleId) {
    return { ok: false, error: '缺少 battleId' };
  }
  const session = bscApi.getSession(battleId);
  if (!session || session.account_id !== accountId) {
    return { ok: false, error: '战斗会话无效或已过期' };
  }
  if (String(session.status || '') !== 'active') {
    return { ok: false, error: '战斗已结束' };
  }
  if (session.state?.server_driven) {
    return { ok: false, error: '服务端驱动模式，请使用 poll 接口' };
  }

  const seqNum = Math.max(1, Math.floor(Number(seq) || 1));
  const lastSeq = Math.max(0, Number(session.last_seq) || 0);
  if (seqNum <= lastSeq) {
    const prev = bscApi.getCommand(battleId, seqNum);
    if (!prev) return { ok: false, error: '重复指令缺少回放数据' };
    const stateNow = bscApi.getSession(battleId);
    const replay = prev.apply_result && typeof prev.apply_result === 'object' ? prev.apply_result : {};
    let replayEvents = Array.isArray(replay.events) ? replay.events : [];
    const startIdx = Number(replay.event_start_index) || 0;
    if (startIdx > 0 && replayEvents.length > 0) {
      replayEvents = replayEvents.map((ev, i) => ({ ...ev, index: startIdx + i }));
    }
    return {
      ok: true,
      idempotent: true,
      battleId,
      seq: seqNum,
      state: engineApi.stateToClient((stateNow && stateNow.state) || (session.state || {})),
      ended: Boolean(replay.ended),
      victory: Boolean(replay.victory),
      draw: Boolean(replay.draw),
      rewards: replay.rewards || {},
      player: replay.player || {},
      events: replayEvents,
      result: replay
    };
  }

  if (seqNum !== lastSeq + 1) {
    return { ok: false, error: `指令乱序：期望${lastSeq + 1}，收到${seqNum}` };
  }

  const cmd = {
    action: String(action || 'attack'),
    skill_id: Math.max(0, Math.floor(Number(skillId) || 0)),
    item_id: Math.max(0, Math.floor(Number(itemId) || 0))
  };
  const apply = engineApi.applyCommand(session.state || {}, cmd);
  if (!apply.ok) return { ok: false, error: apply.error || '战斗指令执行失败' };

  const prevEventIdx = Math.max(0, Number(session.state?.event_index) || 0);
  const eventStart = prevEventIdx + 1;
  const rawEvents = apply.events || [];
  const eventsWithIndex = rawEvents.map((ev, i) => ({ ...ev, index: eventStart + i }));
  const newEventIndex = prevEventIdx + rawEvents.length;
  bscApi.appendEvents(battleId, eventStart, rawEvents);
  const now = Math.floor(Date.now() / 1000);
  const stateToSave = { ...(apply.state || {}), event_index: newEventIndex };
  const updatePayload = {
    state: stateToSave,
    lastSeq: seqNum,
    lastCmdAt: now,
    expiresAt: now + 900,
    rngCursor: Number((apply.state || {}).rng_cursor || 0)
  };
  if (!apply.ended) updatePayload.status = 'active';
  bscApi.updateSessionState(battleId, updatePayload);

  let settle = null;
  if (apply.ended) {
    const finalizeBattleFn = resolveFinalizeBattleFn(deps?.finalizeBattle);
    settle = await finalizeBattleFn(session, apply.state || {}, { victory: Boolean(apply.victory), draw: Boolean(apply.draw) });
    if (!settle.ok) return settle;
    const finished = bscApi.finishSession(battleId, {
      victory: Boolean(apply.victory),
      draw: Boolean(apply.draw),
      rewards: settle.rewards || {}
    });
    const clientState = engineApi.stateToClient((finished && finished.state) || stateToSave);
    bscApi.appendCommand(battleId, seqNum, cmd, {
      ended: true,
      victory: Boolean(apply.victory),
      draw: Boolean(apply.draw),
      rewards: settle.rewards || {},
      player: settle.player || {},
      state: clientState,
      events: rawEvents,
      event_start_index: eventStart
    });
    return {
      ok: true,
      battleId,
      seq: seqNum,
      ended: true,
      victory: Boolean(apply.victory),
      draw: Boolean(apply.draw),
      rewards: settle.rewards || {},
      player: settle.player || {},
      rest_remaining_sec: intVal(settle.rest_remaining_sec, 0),
      state: clientState,
      events: eventsWithIndex
    };
  }

  const clientStateNotEnded = engineApi.stateToClient(stateToSave);
  bscApi.appendCommand(battleId, seqNum, cmd, {
    ended: false,
    draw: false,
    state: clientStateNotEnded,
    events: rawEvents,
    event_start_index: eventStart
  });
  return {
    ok: true,
    battleId,
    seq: seqNum,
    ended: false,
    victory: false,
    draw: false,
    state: clientStateNotEnded,
    events: eventsWithIndex
  };
}

module.exports = {
  executeBattleCommand
};
