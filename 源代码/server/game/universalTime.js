/**
 * 万能时间系统：取代原离线收益
 * - 登录时按（本次上线 - 上次下线）时间差发放万能时间，上限 24 小时
 * - 每 8 小时万能时间可兑换 1 小时八倍经验八倍爆率时间
 * - 八倍时间存储上限 3 小时，可暂停/恢复
 */

const MAX_UNIVERSAL_SECONDS = 24 * 3600;
const MAX_OCT_SECONDS = 3 * 3600;  // 八倍时间存储上限
const EXCHANGE_RATIO = 8;  // 8 秒万能时间 = 1 秒八倍经验八倍爆率时间

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ensureState(player) {
  if (!player || typeof player !== 'object') return null;
  if (!player.time_state || typeof player.time_state !== 'object' || Array.isArray(player.time_state)) {
    player.time_state = {};
  }
  const st = player.time_state;
  const def = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  st.last_activity_at = Math.max(0, def(st.last_activity_at, nowSec()));
  st.universal_time_seconds = Math.max(0, Math.min(MAX_UNIVERSAL_SECONDS, def(st.universal_time_seconds, 0)));
  // 迁移旧的双轨数据：合并 double_exp 与 double_drop 为 oct
  if (Number.isFinite(Number(st.oct_seconds)) === false && (Number(st.double_exp_seconds) > 0 || Number(st.double_drop_seconds) > 0)) {
    const exp = Math.max(0, def(st.double_exp_seconds, 0));
    const drop = Math.max(0, def(st.double_drop_seconds, 0));
    st.oct_seconds = Math.min(MAX_OCT_SECONDS, Math.max(exp, drop));
    st.oct_paused = Boolean(st.double_exp_paused) && Boolean(st.double_drop_paused);
  }
  st.oct_seconds = Math.max(0, Math.min(MAX_OCT_SECONDS, def(st.oct_seconds, 0)));
  st.oct_paused = Boolean(st.oct_paused);
  st.last_tick_at = Math.max(0, def(st.last_tick_at, st.last_activity_at));
  return st;
}

/** 迁移旧 offline_income.last_activity_at */
function migrateFromOfflineIncome(player) {
  const oi = player?.offline_income;
  if (oi && typeof oi === 'object' && !Array.isArray(oi)) {
    const la = Number(oi.last_activity_at || oi.last_settle_at || 0);
    if (la > 0 && (!player.time_state?.last_activity_at || player.time_state.last_activity_at <= 0)) {
      ensureState(player);
      player.time_state.last_activity_at = la;
      player.time_state.last_tick_at = la;
    }
  }
}

/**
 * 登录时发放万能时间：min(离线时长, 24h)，与现有万能时间相加后 cap 24h
 */
function grantUniversalTimeOnLogin(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return 0;
  migrateFromOfflineIncome(player);
  const n = Math.floor(Number(now) || nowSec());
  const lastAt = Math.max(0, Number(st.last_activity_at) || 0);
  const gap = Math.max(0, n - lastAt);
  const gain = Math.min(gap, MAX_UNIVERSAL_SECONDS);
  if (gain < 60) return 0;  // 不足 1 分钟不发放
  const oldVal = Math.max(0, Number(st.universal_time_seconds) || 0);
  const newVal = Math.min(MAX_UNIVERSAL_SECONDS, oldVal + gain);
  st.universal_time_seconds = newVal;
  player.time_state = st;
  return newVal - oldVal;
}

/**
 * 同步时推进八倍时间倒计时（未暂停则按真实流逝时间扣除）
 */
function tickDoubleTimes(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return;
  const n = Math.floor(Number(now) || nowSec());
  const lastTick = Math.max(0, Number(st.last_tick_at) || n);
  const elapsed = Math.max(0, n - lastTick);
  st.last_tick_at = n;

  if (!st.oct_paused && st.oct_seconds > 0 && elapsed > 0) {
    st.oct_seconds = Math.max(0, st.oct_seconds - elapsed);
  }
  player.time_state = st;
}

/** 更新活动时间（用于下次登录计算离线差） */
function touchActivity(player, now = nowSec()) {
  const st = ensureState(player);
  if (!st) return;
  const n = Math.floor(Number(now) || nowSec());
  st.last_activity_at = n;
  st.last_tick_at = n;
  player.time_state = st;
}

/** 八倍经验是否生效（有剩余且未暂停） */
function isDoubleExpActive(player) {
  const st = ensureState(player);
  if (!st) return false;
  return st.oct_seconds > 0 && !st.oct_paused;
}

/** 八倍爆率是否生效 */
function isDoubleDropActive(player) {
  const st = ensureState(player);
  if (!st) return false;
  return st.oct_seconds > 0 && !st.oct_paused;
}

/**
 * 万能时间兑换为八倍经验八倍爆率时间，8:1（8秒万能=1秒八倍），cap 3h
 * 接受 target: oct / double_exp / double_drop（已合并为统一八倍）
 */
function exchange(player, target, amountSec) {
  const t = String(target || '').trim();
  if (t !== 'oct' && t !== 'double_exp' && t !== 'double_drop') {
    return { ok: false, error: '无效的兑换目标' };
  }
  const st = ensureState(player);
  if (!st) return { ok: false, error: '数据异常' };
  const MIN_EXCHANGE = 3600;
  const amt = Math.max(0, Math.floor(Number(amountSec) || 0));
  if (amt < MIN_EXCHANGE) return { ok: false, error: '最少兑换 1 小时' };
  if (amt % MIN_EXCHANGE !== 0) return { ok: false, error: '兑换量须为 1 小时的整数倍' };
  const cost = amt * EXCHANGE_RATIO;
  const uni = Math.max(0, Number(st.universal_time_seconds) || 0);
  if (cost > uni) return { ok: false, error: `万能时间不足（需要 ${cost} 秒）` };

  const cur = Math.max(0, Number(st.oct_seconds) || 0);
  const added = Math.min(amt, MAX_OCT_SECONDS - cur);
  if (added <= 0) return { ok: false, error: '八倍经验八倍爆率时间已达上限 3 小时' };
  const actualCost = added * EXCHANGE_RATIO;
  st.universal_time_seconds = Math.max(0, uni - actualCost);
  st.oct_seconds = Math.min(MAX_OCT_SECONDS, cur + added);
  player.time_state = st;
  return { ok: true, amount: added, target: 'oct', cost: actualCost };
}

/**
 * 切换八倍时间暂停状态
 */
function togglePause(player, target, paused) {
  const st = ensureState(player);
  if (!st) return { ok: false, error: '数据异常' };
  const p = Boolean(paused);
  if (target === 'oct' || target === 'double_exp' || target === 'double_drop') {
    st.oct_paused = p;
  } else {
    return { ok: false, error: '无效的目标' };
  }
  player.time_state = st;
  return { ok: true, paused: p };
}

/** 获取时间状态供客户端展示 */
function getTimeState(player) {
  const st = ensureState(player);
  if (!st) return null;
  return {
    universal_time_seconds: Math.floor(Number(st.universal_time_seconds) || 0),
    oct_seconds: Math.floor(Number(st.oct_seconds) || 0),
    oct_paused: Boolean(st.oct_paused),
    max_universal_seconds: MAX_UNIVERSAL_SECONDS,
    max_oct_seconds: MAX_OCT_SECONDS
  };
}

module.exports = {
  MAX_UNIVERSAL_SECONDS,
  MAX_OCT_SECONDS,
  ensureState,
  grantUniversalTimeOnLogin,
  tickDoubleTimes,
  touchActivity,
  isDoubleExpActive,
  isDoubleDropActive,
  exchange,
  togglePause,
  getTimeState
};

