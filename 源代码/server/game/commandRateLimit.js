/**
 * 战斗类请求频率限制：服务端控速
 * 规则：
 * 1) 允许通过环境变量配置基础节拍与上下限。
 * 2) 按账号自适应调节节拍：平稳时逐步变快，突发时逐步放慢。
 * 3) 对突发重复包采用“合并等待”而非无限排队，避免体感越打越卡。
 */

function _numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function _intClamp(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// 兼容旧常量名，默认从 280ms 小幅下调到 240ms，可通过环境变量覆盖。
const SERVER_TICK_MS = _intClamp(_numEnv('COMMAND_BASE_TICK_MS', _numEnv('SERVER_TICK_MS', 240)), 80, 2000);
const SERVER_TICK_MIN_MS = _intClamp(_numEnv('COMMAND_MIN_TICK_MS', Math.max(60, Math.floor(SERVER_TICK_MS * 0.6))), 40, SERVER_TICK_MS);
const SERVER_TICK_MAX_MS = _intClamp(_numEnv('COMMAND_MAX_TICK_MS', Math.max(SERVER_TICK_MS + 120, Math.floor(SERVER_TICK_MS * 1.8))), SERVER_TICK_MS, 3000);
const SERVER_TICK_ADAPT_UP_MS = _intClamp(_numEnv('COMMAND_TICK_ADAPT_UP_MS', 20), 1, 500);
const SERVER_TICK_ADAPT_DOWN_MS = _intClamp(_numEnv('COMMAND_TICK_ADAPT_DOWN_MS', 10), 1, 500);
const COMMAND_BURST_WINDOW_MS = _intClamp(_numEnv('COMMAND_BURST_WINDOW_MS', 1200), 100, 10000);
const COMMAND_COALESCE_BURST_HITS = _intClamp(_numEnv('COMMAND_COALESCE_BURST_HITS', 2), 1, 20);
const COMMAND_COALESCE_REMAIN_MS = _intClamp(_numEnv('COMMAND_COALESCE_REMAIN_MS', Math.max(120, Math.floor(SERVER_TICK_MS * 0.75))), 50, 5000);
const COMMAND_STATE_TTL_MS = _intClamp(_numEnv('COMMAND_STATE_TTL_MS', 10 * 60 * 1000), 60 * 1000, 24 * 60 * 60 * 1000);

const _lastCmd = new Map();
const _state = new Map();

function _getState(accountId, now) {
  let st = _state.get(accountId);
  if (!st) {
    st = {
      tickMs: SERVER_TICK_MS,
      burstCount: 0,
      burstWindowStart: now,
      lastSeenAt: now
    };
    _state.set(accountId, st);
  }
  st.lastSeenAt = now;
  return st;
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, ts] of _lastCmd) {
    const st = _state.get(id);
    if (st && (Date.now() - Number(st.lastSeenAt || 0)) <= COMMAND_STATE_TTL_MS) continue;
    if (ts < cutoff) _lastCmd.delete(id);
  }
  const now = Date.now();
  for (const [id, st] of _state) {
    if ((now - Number(st?.lastSeenAt || 0)) > COMMAND_STATE_TTL_MS) {
      _state.delete(id);
      _lastCmd.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * 返回需要等待的毫秒数。0 = 无需等待，>0 = 请求到得太早，需延迟这么久再处理。
 * 注意：当检测到突发重复请求时，采用“合并等待”策略，不继续向后追加排队深度。
 */
function getCommandDelay(accountId) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid) || aid <= 0) return 0;

  const now = Date.now();
  const st = _getState(aid, now);
  const tick = _intClamp(st.tickMs, SERVER_TICK_MIN_MS, SERVER_TICK_MAX_MS);
  const last = _lastCmd.get(aid) || 0;
  const earliest = last + tick;

  if (now >= earliest) {
    _lastCmd.set(aid, now);
    st.burstCount = 0;
    st.burstWindowStart = now;
    st.tickMs = Math.max(SERVER_TICK_MIN_MS, tick - SERVER_TICK_ADAPT_DOWN_MS);
    return 0;
  }

  if ((now - Number(st.burstWindowStart || 0)) > COMMAND_BURST_WINDOW_MS) {
    st.burstWindowStart = now;
    st.burstCount = 0;
  }
  st.burstCount += 1;
  st.tickMs = Math.min(SERVER_TICK_MAX_MS, tick + SERVER_TICK_ADAPT_UP_MS);

  const remain = earliest - now;
  const shouldCoalesce = remain >= COMMAND_COALESCE_REMAIN_MS || st.burstCount >= COMMAND_COALESCE_BURST_HITS;
  if (!shouldCoalesce) {
    // 轻微提前请求保留一个占位，避免同刻并发穿透。
    _lastCmd.set(aid, earliest);
  }
  return remain;
}

function checkCommandRate(accountId) {
  const aid = Number(accountId);
  if (!Number.isFinite(aid) || aid <= 0) return false;
  const now = Date.now();
  const last = _lastCmd.get(aid) || 0;
  if (now - last < 60) return false;
  _lastCmd.set(aid, now);
  _getState(aid, now);
  return true;
}

module.exports = {
  checkCommandRate,
  getCommandDelay,
  SERVER_TICK_MS,
  SERVER_TICK_MIN_MS,
  SERVER_TICK_MAX_MS
};
