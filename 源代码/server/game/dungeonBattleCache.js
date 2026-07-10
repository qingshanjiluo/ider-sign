/**
 * 副本战斗状态写合并缓存 - 降低磁盘 I/O
 *
 * 问题：advance 每步都写 50-100KB state_json 到 MySQL，造成 10MB/s 持续写入。
 * 方案：内存缓存 + 5 秒 debounce，仅在战斗结束/删除或超时后才落盘。
 *
 * - save(battleId, accountId, dungeonId, state)：写入内存，调度 5 秒后落盘
 * - get(battleId)：优先内存，命中则返回（零 IO），否则回退 DB
 * - remove(battleId)：清除内存（已结束战斗无需落盘，由路由自行调用 db.deleteDungeonBattle）
 * - removeAllForAccount(accountId)：清除该账号所有缓存条目
 * - flushAllAsync()：进程退出前强制落盘所有 dirty 条目
 */

const FLUSH_INTERVAL_MS = 5000;

const _cache = new Map(); // battleId -> { accountId, dungeonId, state, dirty, timer }

let _dbSaveAsync = null; // (battleId, accountId, dungeonId, state) => Promise

function init(dbSaveAsyncFn) {
  _dbSaveAsync = dbSaveAsyncFn;
}

async function _doFlush(battleId) {
  const entry = _cache.get(battleId);
  if (!entry || !entry.dirty || !_dbSaveAsync) return;
  entry.dirty = false;
  try {
    await _dbSaveAsync(battleId, entry.accountId, entry.dungeonId, entry.state);
  } catch (e) {
    console.error('[dungeonBattleCache] flush error battleId=%s:', battleId, e?.message || e);
    // 标记回 dirty 以便下次重试
    if (_cache.has(battleId)) _cache.get(battleId).dirty = true;
  }
}

function _schedule(battleId) {
  const entry = _cache.get(battleId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    _doFlush(battleId).catch(e => {
      console.error('[dungeonBattleCache] scheduled flush unhandled battleId=%s:', battleId, e?.message || e);
    });
  }, FLUSH_INTERVAL_MS);
}

/**
 * 写入缓存并调度延迟落盘。advance 热路径调用此函数代替直接 db.saveDungeonBattle。
 */
function save(battleId, accountId, dungeonId, state) {
  const old = _cache.get(battleId);
  if (old?.timer) clearTimeout(old.timer);
  _cache.set(battleId, { accountId, dungeonId, state, dirty: true, timer: null });
  _schedule(battleId);
}

/**
 * 读取战斗状态：优先内存。
 * 返回 { account_id, dungeon_id, state } 或 null（需要调用方回退 DB）。
 */
function get(battleId) {
  const entry = _cache.get(battleId);
  if (!entry) return null;
  return { account_id: entry.accountId, dungeon_id: entry.dungeonId, state: entry.state };
}

/**
 * 战斗结束/异常时移除缓存，不落盘（调用方已自行 deleteDungeonBattle）。
 */
function remove(battleId) {
  const entry = _cache.get(battleId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  _cache.delete(battleId);
}

/**
 * 清除该账号所有缓存条目（用于 deleteAllDungeonBattlesForAccount 场景）。
 */
function removeAllForAccount(accountId) {
  const aid = Number(accountId);
  for (const [bid, entry] of _cache) {
    if (Number(entry.accountId) === aid) {
      if (entry.timer) clearTimeout(entry.timer);
      _cache.delete(bid);
    }
  }
}

/**
 * 进程退出前强制落盘所有 dirty 条目。
 */
async function flushAllAsync() {
  const promises = [];
  for (const [battleId, entry] of _cache) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.dirty) {
      promises.push(_doFlush(battleId));
    }
  }
  if (promises.length > 0) await Promise.allSettled(promises);
}

function size() {
  return _cache.size;
}

module.exports = { init, save, get, remove, removeAllForAccount, flushAllAsync, size };
