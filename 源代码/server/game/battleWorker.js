/**
 * Worker Thread - 战斗计算
 *
 * 统一模式：每次执行 1 回合 applyCommand，返回 events + 更新后的 state
 * 纯计算，无 DB / BSC / HTTP 依赖。
 */

const { parentPort } = require('worker_threads');
const engine = require('./battleEngine');
const { getSkillById } = require('./dataLoader');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function _canUseSkillNow(unit, sid) {
  const skillId = Math.max(1, intVal(sid, 0));
  if (skillId <= 0) return false;
  if (!Array.isArray(unit?.equipped_skills) || !unit.equipped_skills.includes(skillId)) return false;
  const skill = getSkillById(skillId);
  if (!skill || !skill.id) return false;
  const req = skill.requirements;
  if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
    const weapType = String(unit.weapon_type || '');
    if (!req.weaponTypes.some(wt => weapType.includes(wt))) return false;
  }
  const cd = intVal(unit.skill_cooldowns?.[String(skillId)], 0);
  if (cd > 0) return false;
  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  return mpCost <= intVal(unit.mp, 0);
}

function pickAutoSkill(state) {
  const p = state.player;
  const equipped = Array.isArray(p.equipped_skills) ? p.equipped_skills : [];
  const lingli = numVal(p.lingli_raw || p.lingli, 10);
  const lingliBonus = Math.min(lingli * 0.0005, 0.2);
  const skillChance = 0.75 + lingliBonus;
  if (Math.random() >= skillChance) return { action: 'attack', skill_id: 0 };
  const rolled = Math.max(0, intVal(equipped[Math.floor(Math.random() * 5)], 0));
  if (rolled <= 0) return { action: 'attack', skill_id: 0 };
  if (_canUseSkillNow(p, rolled)) return { action: 'skill', skill_id: intVal(rolled, 0) };

  const available = [...new Set(equipped.map(sid => intVal(sid, 0)).filter(sid => sid > 0 && _canUseSkillNow(p, sid)))];
  if (available.length <= 0) return { action: 'attack', skill_id: 0 };
  return { action: 'skill', skill_id: available[Math.floor(Math.random() * available.length)] };
}

function _runRounds(state, rounds) {
  let curState = state;
  const startIdx = intVal(state.event_index, 0);
  const allEvents = [];

  for (let i = 0; i < rounds; i++) {
    const cmd = pickAutoSkill(curState);
    const result = engine.applyCommand(curState, cmd);
    if (!result.ok) {
      if (i === 0) return { ok: false };
      break;
    }
    curState = result.state;
    const events = result.events || [];
    curState.event_index = startIdx + allEvents.length + events.length;
    allEvents.push(...events);

    if (result.ended) {
      return {
        ok: true,
        finalState: curState,
        events: allEvents,
        prevIdx: startIdx,
        ended: true,
        victory: !!result.victory,
        draw: !!result.draw
      };
    }
  }

  return { ok: true, finalState: curState, events: allEvents, prevIdx: startIdx, ended: false, victory: false, draw: false };
}

parentPort.on('message', (msg) => {
  if (msg.type === 'runBattleBatch') {
    const results = [];
    for (const item of msg.battles) {
      try {
        const rounds = Math.max(1, intVal(item.rounds, 1));
        const r = _runRounds(item.state, rounds);
        results.push({
          sessionId: item.sessionId,
          runId: item.runId || 0,
          ok: r.ok !== false,
          finalState: r.finalState || item.state,
          events: r.events || [],
          prevIdx: r.prevIdx || 0,
          ended: !!r.ended,
          victory: !!r.victory,
          draw: !!r.draw
        });
      } catch (err) {
        const pName = item.state?.player?.name || '?';
        const pLv = item.state?.player?.level || '?';
        const eName = item.state?.enemy?.name || '?';
        const round = item.state?.round || '?';
        const status = item.state?.status || '?';
        console.error('[battleWorker] 异常 session=%s player=%s(Lv%s) enemy=%s round=%s status=%s: %s\n%s',
          item.sessionId, pName, pLv, eName, round, status,
          err.message, err.stack);
        results.push({
          sessionId: item.sessionId,
          runId: item.runId || 0,
          error: `${err.message} [player=${pName} Lv${pLv} vs ${eName} round=${round}]`,
          finalState: item.state,
          ok: false, events: [], ended: false, victory: false, draw: false
        });
      }
    }
    parentPort.postMessage({ type: 'batchResult', results });
  }
});

console.log('[battleWorker] ready');
