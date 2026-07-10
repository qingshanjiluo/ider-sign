const { execFileSync } = require('child_process');
const CD = require('./combatDamage');

const GO_BIN = String(process.env.BATTLE_DAMAGE_GO_BIN || '').trim();
const GO_TIMEOUT_MS = (() => {
  const v = Number(process.env.BATTLE_DAMAGE_GO_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 5 ? Math.min(200, Math.floor(v)) : 30;
})();
const GO_SAMPLE_RATE = (() => {
  const v = Number(process.env.BATTLE_DAMAGE_GO_SAMPLE_RATE);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
})();

function _useGo() {
  if (!GO_BIN) return false;
  if (GO_SAMPLE_RATE >= 1) return true;
  if (GO_SAMPLE_RATE <= 0) return false;
  return Math.random() < GO_SAMPLE_RATE;
}

function _buildPayload(state, attacker, defender, mode, valOrMul, isSpell, skill, skillLevel, opts) {
  return {
    state,
    attacker,
    defender,
    mode,
    valOrMul,
    isSpell,
    skill,
    skillLevel,
    opts
  };
}

function _tryGoCalc(payload) {
  try {
    const out = execFileSync(GO_BIN, [], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: GO_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    if (!out) return null;
    const parsed = JSON.parse(String(out || '').trim());
    if (!parsed || typeof parsed !== 'object') return null;
    const damage = Number(parsed.damage);
    const isCrit = !!parsed.isCrit;
    if (!Number.isFinite(damage) || damage < 0) return null;
    return {
      damage: Math.max(0, Math.trunc(damage)),
      isCrit,
      events: []
    };
  } catch (_) {
    return null;
  }
}

function calcDamage(state, attacker, defender, mode, valOrMul, isSpell, skill, skillLevel, opts) {
  if (!_useGo()) {
    return CD.calcDamage(state, attacker, defender, mode, valOrMul, isSpell, skill, skillLevel, opts);
  }
  const payload = _buildPayload(state, attacker, defender, mode, valOrMul, isSpell, skill, skillLevel, opts);
  const goRet = _tryGoCalc(payload);
  if (goRet) return goRet;
  return CD.calcDamage(state, attacker, defender, mode, valOrMul, isSpell, skill, skillLevel, opts);
}

module.exports = { calcDamage };
