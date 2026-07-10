const assert = require('assert');
const { executeBattleCommand } = require('../game/battleCommandService');

async function testIdempotentReplay() {
  const replay = {
    ended: false,
    victory: false,
    draw: false,
    rewards: {},
    player: {},
    events: [{ t: 'combat_log', text: 'replay' }],
    event_start_index: 7
  };
  const session = {
    id: 'b1',
    account_id: 1001,
    status: 'active',
    last_seq: 3,
    state: { hp: 9 }
  };
  const fakeBsc = {
    getSession: () => session,
    getCommand: (_battleId, seq) => (seq === 2 ? { apply_result: replay } : null),
    appendEvents: () => {},
    updateSessionState: () => {},
    finishSession: () => ({}),
    appendCommand: () => {}
  };
  const fakeEngine = {
    stateToClient: (s) => ({ ...s, from_engine: true }),
    applyCommand: () => ({ ok: false, error: 'should not apply in replay' })
  };

  const resp = await executeBattleCommand({
    accountId: 1001,
    body: { battleId: 'b1', seq: 2, action: 'attack' },
    deps: { bsc: fakeBsc, engine: fakeEngine }
  });

  assert.equal(resp.ok, true);
  assert.equal(resp.idempotent, true);
  assert.equal(resp.seq, 2);
  assert.equal(resp.events.length, 1);
  assert.equal(resp.events[0].index, 7);
}

async function testOutOfOrderReject() {
  const session = {
    id: 'b2',
    account_id: 1002,
    status: 'active',
    last_seq: 1,
    state: {}
  };
  const fakeBsc = {
    getSession: () => session,
    getCommand: () => null,
    appendEvents: () => {},
    updateSessionState: () => {},
    finishSession: () => ({}),
    appendCommand: () => {}
  };
  const fakeEngine = {
    stateToClient: (s) => s,
    applyCommand: () => ({ ok: false, error: 'should not apply out-of-order' })
  };

  const resp = await executeBattleCommand({
    accountId: 1002,
    body: { battleId: 'b2', seq: 3, action: 'attack' },
    deps: { bsc: fakeBsc, engine: fakeEngine }
  });

  assert.equal(resp.ok, false);
  assert.ok(String(resp.error || '').includes('指令乱序'));
}

async function testEndedSettlement() {
  const session = {
    id: 'b3',
    account_id: 1003,
    status: 'active',
    last_seq: 0,
    state: { event_index: 0, rng_cursor: 0 }
  };
  const calls = { appendCommand: 0, updateSessionState: 0, finishSession: 0 };

  const fakeBsc = {
    getSession: () => session,
    getCommand: () => null,
    appendEvents: () => {},
    updateSessionState: () => { calls.updateSessionState += 1; },
    finishSession: () => {
      calls.finishSession += 1;
      return { state: { final_state: 1 } };
    },
    appendCommand: (_battleId, _seq, _cmd, payload) => {
      calls.appendCommand += 1;
      assert.equal(payload.ended, true);
    }
  };
  const fakeEngine = {
    stateToClient: (s) => ({ ...s }),
    applyCommand: () => ({
      ok: true,
      ended: true,
      victory: true,
      draw: false,
      state: { event_index: 0, rng_cursor: 11 },
      events: [{ t: 'combat_log', text: 'done' }]
    })
  };
  const fakeFinalize = () => ({
    ok: true,
    rewards: { spirit_stones: 3 },
    player: { level: 9 },
    rest_remaining_sec: 12
  });

  const resp = await executeBattleCommand({
    accountId: 1003,
    body: { battleId: 'b3', seq: 1, action: 'attack' },
    deps: { bsc: fakeBsc, engine: fakeEngine, finalizeBattle: fakeFinalize }
  });

  assert.equal(resp.ok, true);
  assert.equal(resp.ended, true);
  assert.equal(resp.victory, true);
  assert.equal(resp.rest_remaining_sec, 12);
  assert.equal(resp.events[0].index, 1);
  assert.equal(calls.updateSessionState, 1);
  assert.equal(calls.finishSession, 1);
  assert.equal(calls.appendCommand, 1);
}

async function main() {
  await testIdempotentReplay();
  await testOutOfOrderReject();
  await testEndedSettlement();
  console.log('[battle_command_service_test] all tests passed');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
