/**
 * combatUtils 基础低耦合工具：数值、安全克隆、随机、减伤、行动条速度
 */
function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function isPvpBattleMode(mode) {
  const m = String(mode || '');
  return m === 'city_duel' || m === 'league';
}

const deepClone = typeof structuredClone === 'function'
  ? (v) => structuredClone(v)
  : (v) => JSON.parse(JSON.stringify(v));

// ─── RNG ───
function nextRand01(state) {
  const seed = intVal(state.rng_seed, 1) >>> 0;
  const cursor = (intVal(state.rng_cursor, 0) + 1) >>> 0;
  let x = (seed ^ ((cursor * 1103515245) >>> 0)) >>> 0;
  x = ((x * 1664525) + 1013904223) >>> 0;
  state.rng_cursor = cursor;
  return x / 4294967296;
}

function rollInt(state, minV, maxV) {
  const lo = Math.floor(Math.min(minV, maxV));
  const hi = Math.floor(Math.max(minV, maxV));
  if (hi <= lo) return lo;
  return lo + Math.floor(nextRand01(state) * (hi - lo + 1));
}

// ─── 防御减伤公式 ───
// dr = 1 - 1 / (pow(def / baseDivisor, 0.42) + 1)
// 玩家默认 baseDivisor=8000，怪物 default=11000；不动明王功/危月煞各降1000
function calcReducedDamage(rawDamage, defense, baseDivisor) {
  const raw = Math.max(1, Math.floor(rawDamage));
  const def = Math.max(0, Math.floor(defense));
  const divBase = Math.max(100, numVal(baseDivisor, 9000));
  if (def <= 0) return raw;
  const dr = 1.0 - 1.0 / (Math.pow(def / divBase, 0.42) + 1.0);
  return Math.max(1, Math.floor(raw * (1.0 - dr)));
}

// ─── 行动条速度计算 ───
function calcActionSpeed(agilityRaw) {
  let remain = Math.max(0, numVal(agilityRaw, 0));
  let mult = 1.0;
  let contrib = 0.0;
  while (remain > 0.0001 && mult > 0.0001) {
    const take = Math.min(25.0, remain);
    contrib += take * mult;
    remain -= take;
    mult *= 0.5;
  }
  return 20.0 + contrib;
}

module.exports = {
  intVal,
  numVal,
  clamp,
  isPvpBattleMode,
  deepClone,
  nextRand01,
  rollInt,
  calcReducedDamage,
  calcActionSpeed
};
