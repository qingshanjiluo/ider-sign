/**
 * 数据库初始化与操作
 * 运行时按 DB_DRIVER 选择 sqlite/mysql 驱动（默认 sqlite）
 */
let Database = null;
const path = require('path');
const fs = require('fs');
const accountBanCache = require('./game/accountBanCache');
const autoBattleIndex = require('./game/autoBattleIndex');
const accountSerialExecutor = require('./game/accountSerialExecutor');

const config = require('./config');
const isMysqlDriver = String(config.dbDriver || '').toLowerCase() === 'mysql';
const mysqlAsyncPool = require('./mysqlAsyncPool');
const SQLITE_BUSY_TIMEOUT_MS = (() => {
  const v = Number(process.env.SQLITE_BUSY_TIMEOUT_MS);
  if (Number.isFinite(v) && v >= 200) return Math.min(60000, Math.floor(v));
  return 5000;
})();
const DB_WARN_THROTTLE_MS = (() => {
  const v = Number(process.env.DB_WARN_THROTTLE_MS);
  if (Number.isFinite(v) && v >= 200) return Math.min(60000, Math.floor(v));
  return 5000;
})();
const DB_METRICS_LOG_INTERVAL_SEC = (() => {
  const v = Number(process.env.DB_METRICS_LOG_INTERVAL_SEC);
  if (Number.isFinite(v) && v >= 5) return Math.min(300, Math.floor(v));
  return 10;
})();
const _dbWarnThrottle = new Map();
const _dbConflictStats = {
  conflictInsertMiss: 0,
  conflictExpectedRev: 0,
  conflictCasMiss: 0,
  rebaseStaleWrite: 0,
  saveWrites: 0,
  saveBytes: 0,
  saveSkipped: 0
};

function _incDbConflictStat(key) {
  if (!Object.prototype.hasOwnProperty.call(_dbConflictStats, key)) return;
  _dbConflictStats[key] = Number(_dbConflictStats[key] || 0) + 1;
}

function _warnThrottled(key, message, ...args) {
  const now = Date.now();
  const k = String(key || 'default');
  const row = _dbWarnThrottle.get(k) || { nextAt: 0, suppressed: 0 };
  if (now < Number(row.nextAt || 0)) {
    row.suppressed = Number(row.suppressed || 0) + 1;
    _dbWarnThrottle.set(k, row);
    return;
  }
  const suppressed = Number(row.suppressed || 0);
  row.nextAt = now + DB_WARN_THROTTLE_MS;
  row.suppressed = 0;
  _dbWarnThrottle.set(k, row);
  if (suppressed > 0) {
    console.warn(`${message} (suppressed=%s)`, ...args, suppressed);
    return;
  }
  console.warn(message, ...args);
}

setInterval(() => {
  const conflictInsertMiss = Number(_dbConflictStats.conflictInsertMiss || 0);
  const conflictExpectedRev = Number(_dbConflictStats.conflictExpectedRev || 0);
  const conflictCasMiss = Number(_dbConflictStats.conflictCasMiss || 0);
  const rebaseStaleWrite = Number(_dbConflictStats.rebaseStaleWrite || 0);
  const total = conflictInsertMiss + conflictExpectedRev + conflictCasMiss + rebaseStaleWrite;
  const saveWrites = Number(_dbConflictStats.saveWrites || 0);
  const saveBytes = Number(_dbConflictStats.saveBytes || 0);
  const saveSkipped = Number(_dbConflictStats.saveSkipped || 0);
  const avgBytes = saveWrites > 0 ? Math.floor(saveBytes / saveWrites) : 0;
  const bytesPerSec = Math.floor(saveBytes / Math.max(1, DB_METRICS_LOG_INTERVAL_SEC));
  const mbPerSec = (bytesPerSec / (1024 * 1024)).toFixed(2);
  if (saveWrites > 0 || saveSkipped > 0) {
    console.log('[db][perf] save-size writes=%d skipped=%d bytes=%d avgBytes=%d bytesPerSec=%d mbPerSec=%s interval=%ds',
      saveWrites,
      saveSkipped,
      saveBytes,
      avgBytes,
      bytesPerSec,
      mbPerSec,
      DB_METRICS_LOG_INTERVAL_SEC);
  }
  if (total > 0) {
    console.log('[db][perf] save-conflicts total=%d insertMiss=%d expectedRev=%d casMiss=%d rebase=%d interval=%ds',
      total,
      conflictInsertMiss,
      conflictExpectedRev,
      conflictCasMiss,
      rebaseStaleWrite,
      DB_METRICS_LOG_INTERVAL_SEC);
  }
  _dbConflictStats.conflictInsertMiss = 0;
  _dbConflictStats.conflictExpectedRev = 0;
  _dbConflictStats.conflictCasMiss = 0;
  _dbConflictStats.rebaseStaleWrite = 0;
  _dbConflictStats.saveWrites = 0;
  _dbConflictStats.saveBytes = 0;
  _dbConflictStats.saveSkipped = 0;
}, DB_METRICS_LOG_INTERVAL_SEC * 1000);

let db = null;
if (isMysqlDriver) {
  const { createMysqlCompatDb } = require('./mysqlCompat');
  db = createMysqlCompatDb(config);
  console.log('[db] driver=mysql host=%s port=%s db=%s', config.mysqlHost, config.mysqlPort, config.mysqlDatabase);
  // 修复 username 列大小写敏感：确保 collation 为 utf8mb4_bin（SQLite 迁移后可能为 ci）
  try {
    db.exec('ALTER TABLE accounts MODIFY username VARCHAR(255) NOT NULL COLLATE utf8mb4_bin');
    console.log('[db] accounts.username collation enforced to utf8mb4_bin');
  } catch (e) {
    // 表不存在等场景忽略
    console.warn('[db] ALTER accounts.username collation skipped:', e?.message);
  }
} else {
  Database = require('better-sqlite3');
  // 确保数据目录存在
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);

  // SQLite 优化，减轻云盘 I/O 压力
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('mmap_size = 268435456');
  db.pragma('temp_store = MEMORY');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
}

const playerWriteCache = require('./game/playerWriteCache');

const PLAYER_LARGE_JSON_FIELDS = [
  'inventory',
  'cave',
  'equipment',
  'lineage_apprentice',
  'skill_levels',
  'skill_cooldowns',
  'technique_levels',
  'timed_buffs',
  'talents',
  'alchemy',
  'forging',
  'baiyi',
  'used_redemption_codes',
  'skill_presets'
];
const PLAYER_LARGE_JSON_COLUMNS = PLAYER_LARGE_JSON_FIELDS.map((field) => `${field}_json`);
const PLAYER_LARGE_JSON_COLUMNS_SQL = PLAYER_LARGE_JSON_COLUMNS.join(', ');
const MYSQL_SPLIT_SOFT_LIMIT_RATIO = (() => {
  const v = Number(process.env.MYSQL_SPLIT_SOFT_LIMIT_RATIO);
  if (Number.isFinite(v) && v > 0.5 && v <= 1) return v;
  return 0.95;
})();
const _mysqlSplitColumnByteLimitByField = Object.create(null);
for (const field of PLAYER_LARGE_JSON_FIELDS) {
  _mysqlSplitColumnByteLimitByField[field] = 65535;
}

function _mysqlTextTypeMaxBytes(dataType) {
  const t = String(dataType || '').toLowerCase();
  if (t === 'tinytext') return 255;
  if (t === 'text') return 65535;
  if (t === 'mediumtext') return 16777215;
  if (t === 'longtext') return Number.MAX_SAFE_INTEGER;
  return 65535;
}

function _refreshMysqlSplitColumnByteLimits() {
  if (!isMysqlDriver) return;
  try {
    const inList = PLAYER_LARGE_JSON_COLUMNS.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(', ');
    const rows = db.prepare(`
      SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'players'
        AND COLUMN_NAME IN (${inList})
    `).all(String(config.mysqlDatabase || ''));
    for (const field of PLAYER_LARGE_JSON_FIELDS) {
      _mysqlSplitColumnByteLimitByField[field] = 65535;
    }
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const columnName = String(row?.columnName || '').trim();
      const dataType = String(row?.dataType || '').trim();
      if (!columnName.endsWith('_json')) continue;
      const field = columnName.slice(0, -5);
      if (!PLAYER_LARGE_JSON_FIELDS.includes(field)) continue;
      _mysqlSplitColumnByteLimitByField[field] = _mysqlTextTypeMaxBytes(dataType);
    }
  } catch (e) {
    console.warn('[db] refresh split column byte limits failed:', e?.message || e);
  }
}

function _newLargeFieldJsonMap(fillValue = null) {
  const out = {};
  for (const field of PLAYER_LARGE_JSON_FIELDS) out[field] = fillValue;
  return out;
}

// 建表
if (!isMysqlDriver) db.exec(`
  -- 账号表
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- 玩家存档表（每账号多角色暂不支持，先 1:1）
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER UNIQUE NOT NULL REFERENCES accounts(id),
    slot INTEGER DEFAULT 1,
    data TEXT NOT NULL,
    inventory_json TEXT,
    cave_json TEXT,
    equipment_json TEXT,
    lineage_apprentice_json TEXT,
    skill_levels_json TEXT,
    skill_cooldowns_json TEXT,
    technique_levels_json TEXT,
    timed_buffs_json TEXT,
    talents_json TEXT,
    alchemy_json TEXT,
    forging_json TEXT,
    baiyi_json TEXT,
    used_redemption_codes_json TEXT,
    skill_presets_json TEXT,
    auto_battle_enabled INTEGER,
    auto_battle_map_id INTEGER,
    current_map_id INTEGER,
    rest_until INTEGER,
    last_activity_at INTEGER,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- 战斗会话（用于 PvE 校验）
  CREATE TABLE IF NOT EXISTS battle_sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    map_id INTEGER,
    enemy_id INTEGER,
    started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active / finished / aborted
    state_json TEXT NOT NULL DEFAULT '{}',
    last_seq INTEGER NOT NULL DEFAULT 0,
    result_json TEXT NOT NULL DEFAULT '{}',
    ended_at INTEGER NOT NULL DEFAULT 0,
    last_cmd_at INTEGER NOT NULL DEFAULT 0,
    rng_seed INTEGER NOT NULL DEFAULT 0,
    rng_cursor INTEGER NOT NULL DEFAULT 0
  );

  -- 战斗指令流水（幂等 / 审计）
  CREATE TABLE IF NOT EXISTS battle_commands (
    battle_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    command_json TEXT NOT NULL,
    apply_result_json TEXT NOT NULL DEFAULT '{}',
    recv_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (battle_id, seq)
  );

  -- 战斗事件流水（客户端回放）
  CREATE TABLE IF NOT EXISTS battle_events (
    battle_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (battle_id, event_index)
  );

  -- 宗门任务每日完成次数（account_id, date 唯一，completions 今日完成次数）
  CREATE TABLE IF NOT EXISTS sect_task_completions (
    account_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    completions INTEGER DEFAULT 0,
    PRIMARY KEY (account_id, date)
  );

  -- 副本每日完成次数（account_id, dungeon_id, date 唯一，completions 今日成功次数）
  CREATE TABLE IF NOT EXISTS dungeon_completions (
    account_id INTEGER NOT NULL,
    dungeon_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    completions INTEGER DEFAULT 0,
    PRIMARY KEY (account_id, dungeon_id, date)
  );

  -- 副本队伍（队伍码 6 位，用于组队）
  CREATE TABLE IF NOT EXISTS dungeon_teams (
    team_code TEXT PRIMARY KEY,
    leader_account_id INTEGER NOT NULL,
    dungeon_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL
  );

  -- 副本队伍成员
  CREATE TABLE IF NOT EXISTS dungeon_team_members (
    team_code TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    joined_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (team_code, account_id)
  );

  -- 交易所挂单
  CREATE TABLE IF NOT EXISTS exchange_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_account_id INTEGER NOT NULL,
    item_id INTEGER DEFAULT 0,
    item_name TEXT NOT NULL,
    item_snapshot_json TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity_total INTEGER NOT NULL,
    quantity_left INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open / partial / filled / cancelled / expired
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL
  );

  -- 交易所成交记录
  CREATE TABLE IF NOT EXISTS exchange_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    seller_account_id INTEGER NOT NULL,
    buyer_account_id INTEGER NOT NULL,
    item_id INTEGER DEFAULT 0,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    seller_income INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- 系统邮箱（交易结算/退回等）
  CREATE TABLE IF NOT EXISTS mailbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- trade_sale / trade_buy / trade_refund / system
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'unread', -- unread / claimed
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    claimed_at INTEGER DEFAULT 0,
    expires_at INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_battle_expires ON battle_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_battle_account_status ON battle_sessions(account_id, status);
  CREATE INDEX IF NOT EXISTS idx_battle_events_battle_index ON battle_events(battle_id, event_index);
  CREATE INDEX IF NOT EXISTS idx_players_account ON players(account_id);
  CREATE INDEX IF NOT EXISTS idx_players_auto_battle_enabled ON players(json_extract(data, '$.auto_battle_enabled'));
  CREATE INDEX IF NOT EXISTS idx_players_pending_job ON players(COALESCE(json_type(baiyi_json, '$.pending_job'), json_type(data, '$.baiyi.pending_job')));
  CREATE INDEX IF NOT EXISTS idx_sect_task_completions ON sect_task_completions(account_id, date);
  CREATE INDEX IF NOT EXISTS idx_dungeon_completions ON dungeon_completions(account_id, date);
  CREATE INDEX IF NOT EXISTS idx_dungeon_teams_expires ON dungeon_teams(expires_at);
  CREATE INDEX IF NOT EXISTS idx_exchange_listings_status_item_price_time ON exchange_listings(status, item_id, unit_price, created_at);
  CREATE INDEX IF NOT EXISTS idx_exchange_listings_seller_status ON exchange_listings(seller_account_id, status);
  CREATE INDEX IF NOT EXISTS idx_exchange_listings_expires ON exchange_listings(expires_at);
  CREATE INDEX IF NOT EXISTS idx_exchange_trades_item_created_time ON exchange_trades(item_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_mailbox_account_status_time ON mailbox_messages(account_id, status, created_at);

  -- 副本战斗状态（持久化，进程重启可恢复）
  CREATE TABLE IF NOT EXISTS dungeon_battle_sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    dungeon_id INTEGER NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dungeon_battle_account ON dungeon_battle_sessions(account_id);

  -- 城池斗法记录（挑战/被挑战双方都可查看）
  CREATE TABLE IF NOT EXISTS city_duel_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_account_id INTEGER NOT NULL,
    target_account_id INTEGER NOT NULL,
    winner_account_id INTEGER NOT NULL,
    challenger_name TEXT NOT NULL DEFAULT '',
    target_name TEXT NOT NULL DEFAULT '',
    challenger_level INTEGER NOT NULL DEFAULT 1,
    target_level INTEGER NOT NULL DEFAULT 1,
    challenger_sect_name TEXT NOT NULL DEFAULT '散修',
    target_sect_name TEXT NOT NULL DEFAULT '散修',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_city_duel_logs_challenger_time ON city_duel_logs(challenger_account_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_city_duel_logs_target_time ON city_duel_logs(target_account_id, created_at);

  -- 斗法战神榜：每日挑战次数（发起时记录，用于限制 5 次/天、同目标 3 次/天）
  CREATE TABLE IF NOT EXISTS city_duel_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_account_id INTEGER NOT NULL,
    target_account_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_city_duel_challenges_challenger_date ON city_duel_challenges(challenger_account_id, created_at);

  -- 斗法战神榜赛季：记录已结算期数
  CREATE TABLE IF NOT EXISTS duel_rank_state (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT -1
  );

  -- 仙盟（玩家公会）
  CREATE TABLE IF NOT EXISTS alliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    creator_account_id INTEGER NOT NULL,
    rank_names_json TEXT NOT NULL DEFAULT '["仙友","仙长","尊者","长老","副盟主","盟主"]',
    materials INTEGER NOT NULL DEFAULT 0,
    warehouse_pages INTEGER NOT NULL DEFAULT 10,
    warehouse_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_alliances_name ON alliances(name);

  -- 仙盟成员（rank 0-5：仙友、仙长、尊者、长老、副盟主、盟主）
  CREATE TABLE IF NOT EXISTS alliance_members (
    alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (alliance_id, account_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alliance_members_account ON alliance_members(account_id);

  -- 仙盟入盟申请
  CREATE TABLE IF NOT EXISTS alliance_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(alliance_id, account_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alliance_applications_alliance ON alliance_applications(alliance_id);

  -- 仙盟仓库提取授权（盟主授权的人可提取）
  CREATE TABLE IF NOT EXISTS alliance_withdraw_auth (
    alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, account_id)
  );

  -- 邀请系统：邀请人存储灵石、每人发放数、邀请码
  CREATE TABLE IF NOT EXISTS invite_inviters (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
    invite_code TEXT UNIQUE NOT NULL,
    stored_stones INTEGER NOT NULL DEFAULT 0,
    per_person_stones INTEGER NOT NULL DEFAULT 0,
    invite_points INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- 邀请绑定：被邀请人 -> 邀请人
  CREATE TABLE IF NOT EXISTS invite_bindings (
    invitee_account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
    inviter_account_id INTEGER NOT NULL REFERENCES accounts(id),
    bound_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- 邀请积分已领取记录（每个被邀请人只能提供1次）
  CREATE TABLE IF NOT EXISTS invite_point_claims (
    inviter_account_id INTEGER NOT NULL,
    invitee_account_id INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (inviter_account_id, invitee_account_id)
  );
`);

// 轻量迁移：为旧库补齐交易所新字段
// MySQL 下 TEXT/BLOB 类型不能有 DEFAULT，将含 DEFAULT 的 TEXT 降级为 VARCHAR(255)
function _mysqlSafeDdl(ddl) {
  if (!isMysqlDriver) return ddl;
  return String(ddl).replace(/\bTEXT\b(\s+NOT\s+NULL\s+DEFAULT\b)/gi, 'VARCHAR(255)$1');
}

function _ensureColumn(table, column, ddl) {
  const safeDdl = _mysqlSafeDdl(ddl);
  if (isMysqlDriver) {
    const cols = db.prepare(`
      SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1
    `).all(String(config.mysqlDatabase || ''), String(table || ''), String(column || ''));
    if (!Array.isArray(cols) || cols.length <= 0) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${safeDdl}`);
    } else if (/\bDEFAULT\b/i.test(safeDdl) && cols[0].def == null) {
      // 列已存在但缺少 DEFAULT 值（迁移遗留），用 MODIFY 补上
      try { db.exec(`ALTER TABLE ${table} MODIFY COLUMN ${safeDdl}`); } catch (_) {}
    }
    return;
  }

  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!Array.isArray(cols) || !cols.some((c) => String(c.name) === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function _ensureMysqlLongTextColumn(table, column) {
  if (!isMysqlDriver) return;
  const rows = db.prepare(`
    SELECT DATA_TYPE AS dataType
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    LIMIT 1
  `).all(String(config.mysqlDatabase || ''), String(table || ''), String(column || ''));
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const dataType = String(row?.dataType || '').toLowerCase();
  if (dataType === 'longtext') return;
  try {
    db.exec(`ALTER TABLE ${table} MODIFY COLUMN ${column} LONGTEXT NULL`);
  } catch (e) {
    console.warn('[db] ensure LONGTEXT skipped table=%s column=%s: %s', table, column, e?.message || e);
  }
}

{
  _ensureColumn('exchange_listings', 'side', `side TEXT NOT NULL DEFAULT 'sell'`);
  _ensureColumn('exchange_listings', 'tax_per_unit', `tax_per_unit INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('exchange_trades', 'side', `side TEXT NOT NULL DEFAULT 'sell'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_exchange_trades_item_created_time ON exchange_trades(item_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_exchange_trades_item_side_time ON exchange_trades(item_id, side, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_exchange_trades_seller_buyer_time ON exchange_trades(seller_account_id, buyer_account_id, created_at)`);
  _ensureColumn('battle_sessions', 'status', `status TEXT NOT NULL DEFAULT 'active'`);
  _ensureColumn('battle_sessions', 'state_json', `state_json TEXT NOT NULL DEFAULT '{}'`);
  _ensureColumn('battle_sessions', 'last_seq', `last_seq INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('battle_sessions', 'result_json', `result_json TEXT NOT NULL DEFAULT '{}'`);
  _ensureColumn('battle_sessions', 'ended_at', `ended_at INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('battle_sessions', 'last_cmd_at', `last_cmd_at INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('battle_sessions', 'rng_seed', `rng_seed INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('battle_sessions', 'rng_cursor', `rng_cursor INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('players', 'auto_battle_enabled', `auto_battle_enabled INTEGER`);
  _ensureColumn('players', 'auto_battle_map_id', `auto_battle_map_id INTEGER`);
  _ensureColumn('players', 'current_map_id', `current_map_id INTEGER`);
  _ensureColumn('players', 'rest_until', `rest_until INTEGER`);
  _ensureColumn('players', 'last_activity_at', `last_activity_at INTEGER`);
  for (const column of PLAYER_LARGE_JSON_COLUMNS) {
    _ensureColumn('players', column, `${column} TEXT`);
  }
  if (isMysqlDriver) {
    for (const column of PLAYER_LARGE_JSON_COLUMNS) {
      _ensureMysqlLongTextColumn('players', column);
    }
    _refreshMysqlSplitColumnByteLimits();
  }
  _ensureColumn('players', 'save_revision', `save_revision INTEGER NOT NULL DEFAULT 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_players_auto_battle_enabled_col ON players(auto_battle_enabled, account_id)`);
  if (!isMysqlDriver) {
    try { db.exec(`DROP INDEX IF EXISTS idx_players_pending_job`); } catch (_) {}
    db.exec(`CREATE INDEX IF NOT EXISTS idx_players_pending_job ON players(COALESCE(json_type(baiyi_json, '$.pending_job'), json_type(data, '$.baiyi.pending_job')))`);
  }
  _ensureColumn('accounts', 'register_ip', `register_ip TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('accounts', 'machine_id', `machine_id TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('accounts', 'is_banned', `is_banned INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'ban_reason', `ban_reason TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('accounts', 'banned_at', `banned_at INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'ban_expires_at', `ban_expires_at INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'cheat_scan_exempt_until', `cheat_scan_exempt_until INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'machine_share_ban_count', `machine_share_ban_count INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'machine_share_exempt', `machine_share_exempt INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('accounts', 'last_login_ip', `last_login_ip TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('mailbox_messages', 'dedupe_key', `dedupe_key TEXT DEFAULT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_register_ip ON accounts(register_ip)`);
  if (!isMysqlDriver) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_account_dedupe_key ON mailbox_messages(account_id, dedupe_key)`);
  } else {
    try { db.exec(`CREATE UNIQUE INDEX idx_mailbox_account_dedupe_key ON mailbox_messages(account_id, dedupe_key)`); } catch (e) {
      console.warn('[db] idx_mailbox_account_dedupe_key create skipped:', e?.message || e);
    }
    try { db.exec(`CREATE INDEX idx_mailbox_account_dedupe_key_lookup ON mailbox_messages(account_id, dedupe_key)`); } catch (_) {}
  }
  if (!isMysqlDriver) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS machine_login_log (
        account_id INTEGER NOT NULL,
        machine_id TEXT NOT NULL,
        PRIMARY KEY (account_id, machine_id)
      )
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS machine_login_log (
        account_id BIGINT NOT NULL,
        machine_id VARCHAR(255) NOT NULL,
        PRIMARY KEY (account_id, machine_id)
      )
    `);
  }
  _ensureColumn('alliances', 'materials', `materials INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('alliances', 'warehouse_pages', `warehouse_pages INTEGER NOT NULL DEFAULT 10`);
  _ensureColumn('alliances', 'warehouse_json', `warehouse_json TEXT NOT NULL DEFAULT '[]'`);
  _ensureColumn('alliances', 'statue_level', `statue_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'spirit_pool_level', `spirit_pool_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'garden_level', `garden_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'enlightenment_tree_level', `enlightenment_tree_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'treasury_level', `treasury_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'gate_level', `gate_level INTEGER NOT NULL DEFAULT 1`);
  _ensureColumn('alliances', 'treasury_refresh_date', `treasury_refresh_date TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('alliances', 'treasury_goods_json', `treasury_goods_json TEXT NOT NULL DEFAULT '[]'`);
  _ensureColumn('alliance_members', 'contribution', `contribution INTEGER NOT NULL DEFAULT 0`);
  _ensureColumn('invite_bindings', 'stones_granted', `stones_granted INTEGER DEFAULT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_machine_id ON accounts(machine_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_banned ON accounts(is_banned)`);
  if (!isMysqlDriver) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ip_bans (
        ip TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT '',
        banned_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at INTEGER NOT NULL DEFAULT 0
      )
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ip_bans (
        ip VARCHAR(255) PRIMARY KEY,
        reason VARCHAR(255) NOT NULL DEFAULT '',
        banned_at BIGINT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL DEFAULT 0
      )
    `);
  }

  // 兑换码使用记录（账号级别，删档不清除）
  if (!isMysqlDriver) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_redemptions (
        account_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        redeemed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (account_id, code)
      );
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_redemptions (
        account_id BIGINT NOT NULL,
        code VARCHAR(255) NOT NULL,
        redeemed_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, code)
      )
    `);
  }

  // 邮箱绑定
  _ensureColumn('accounts', 'email', `email TEXT NOT NULL DEFAULT ''`);
  _ensureColumn('accounts', 'email_verified', `email_verified INTEGER NOT NULL DEFAULT 0`);
  if (!isMysqlDriver) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_email_codes_account ON email_verification_codes(account_id, used, expires_at);
    `);
  } else {
    db.exec(`CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      account_id BIGINT NOT NULL,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL,
      used TINYINT NOT NULL DEFAULT 0
    )`);
    try { db.exec(`CREATE INDEX idx_email_codes_account ON email_verification_codes(account_id, used, expires_at)`); } catch (_) {}
  }
}

// 简单密码哈希（生产环境建议用 bcrypt）
function hashPasswordWithPepper(pwd, pepper) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(pwd || '') + String(pepper || '')).digest('hex');
}

function hashPassword(pwd) {
  const pepper = String(config.passwordPepper || config.jwtSecret || '');
  return hashPasswordWithPepper(pwd, pepper);
}

function verifyPasswordDetailed(pwd, hash) {
  const h = String(hash || '');
  if (!h) return { ok: false, needsRehash: false };

  const currentHash = hashPassword(pwd);
  if (currentHash === h) return { ok: true, needsRehash: false };

  const currentPepper = String(config.passwordPepper || config.jwtSecret || '').trim();
  const legacyCandidates = Array.isArray(config.legacyPasswordPeppers)
    ? config.legacyPasswordPeppers
    : [config.legacyPasswordPepper];
  const seen = new Set();
  for (const item of legacyCandidates) {
    const legacyPepper = String(item || '').trim();
    if (!legacyPepper || legacyPepper === currentPepper || seen.has(legacyPepper)) continue;
    seen.add(legacyPepper);
    const legacyHash = hashPasswordWithPepper(pwd, legacyPepper);
    if (legacyHash === h) return { ok: true, needsRehash: true };
  }

  return { ok: false, needsRehash: false };
}

function verifyPassword(pwd, hash) {
  return verifyPasswordDetailed(pwd, hash).ok;
}

// 账号
function createAccount(username, password, options = {}) {
  const registerIp = String(options.registerIp || '').trim();
  const machineId = String(options.machineId || '').trim();
  const createdAt = Math.floor(Date.now() / 1000);
  const stmt = db.prepare('INSERT INTO accounts (username, password_hash, register_ip, machine_id, created_at) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(username, hashPassword(password), registerIp, machineId, createdAt);
}

function getAccountByUsername(username) {
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
}

function getAccountById(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function findAccountByRegisterTraits(machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) return null;
  return db.prepare('SELECT * FROM accounts WHERE machine_id = ? LIMIT 1').get(mid);
}

function insertMachineLoginLog(accountId, machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) return;
  db.prepare('INSERT OR IGNORE INTO machine_login_log (account_id, machine_id) VALUES (?, ?)').run(Number(accountId), mid);
}

function getAccountsByMachineId(machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) return [];
  return db.prepare('SELECT account_id FROM machine_login_log WHERE machine_id = ?').all(mid).map(r => r.account_id);
}

function getAccountsByCurrentMachineId(machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) return [];
  return db.prepare('SELECT id FROM accounts WHERE machine_id = ?').all(mid).map(r => r.id);
}

function getMachineShareBanCount(accountId) {
  const r = db.prepare('SELECT machine_share_ban_count FROM accounts WHERE id = ?').get(Number(accountId));
  return Number(r?.machine_share_ban_count || 0);
}

function isMachineShareExempt(accountId) {
  const r = db.prepare('SELECT machine_share_exempt FROM accounts WHERE id = ?').get(Number(accountId));
  return Number(r?.machine_share_exempt || 0) > 0;
}

function clearExpiredBan(accountId) {
  const acc = db.prepare('SELECT ban_expires_at FROM accounts WHERE id = ?').get(Number(accountId));
  if (!acc) return;
  const exp = Number(acc.ban_expires_at || 0);
  if (exp > 0 && exp <= Math.floor(Date.now() / 1000)) {
    const aid = Number(accountId);
    db.prepare("UPDATE accounts SET is_banned = 0, ban_reason = '', banned_at = 0, ban_expires_at = 0 WHERE id = ?").run(aid);
    accountBanCache.mark(aid, false);
  }
}

/** 检测账号是否处于封禁状态（未过期的封禁） */
function isAccountBanned(accountId) {
  const acc = db.prepare('SELECT is_banned, ban_expires_at FROM accounts WHERE id = ?').get(Number(accountId));
  if (!acc || Number(acc.is_banned || 0) <= 0) return false;
  const expiresAt = Number(acc.ban_expires_at || 0);
  if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) return false;
  return true;
}

function banAccountMachineShare(accountId, reason, expiresAt) {
  const aid = Number(accountId);
  const count = getMachineShareBanCount(aid) + 1;
  db.prepare(`
    UPDATE accounts SET
      is_banned = 1, ban_reason = ?, banned_at = strftime('%s','now'),
      ban_expires_at = ?, machine_share_ban_count = ?
    WHERE id = ?
  `).run(reason, expiresAt, count, aid);
  accountBanCache.mark(aid, true);
}

function setAccountBanned(accountId, reason, expiresAt = 0) {
  const aid = Number(accountId);
  const exp = Math.max(0, Number(expiresAt) || 0);
  db.prepare(`
    UPDATE accounts SET
      is_banned = 1,
      ban_reason = ?,
      banned_at = strftime('%s','now'),
      ban_expires_at = ?
    WHERE id = ?
  `).run(String(reason || ''), exp, aid);
  accountBanCache.mark(aid, true);
}

function getCheatScanExemptUntil(accountId) {
  try {
    const row = db.prepare('SELECT cheat_scan_exempt_until FROM accounts WHERE id = ?').get(Number(accountId));
    return Math.max(0, Math.floor(Number(row?.cheat_scan_exempt_until) || 0));
  } catch (_) {
    return 0;
  }
}

function isCheatScanExempt(accountId, now = Math.floor(Date.now() / 1000)) {
  return getCheatScanExemptUntil(accountId) > Math.max(0, Math.floor(Number(now) || 0));
}

function setCheatScanExemptUntil(accountId, untilSec) {
  return db.prepare('UPDATE accounts SET cheat_scan_exempt_until = ? WHERE id = ?')
    .run(Math.max(0, Math.floor(Number(untilSec) || 0)), Number(accountId));
}

function updateAccountMachineId(accountId, machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) return;
  db.prepare('UPDATE accounts SET machine_id = ? WHERE id = ?').run(mid, Number(accountId));
}

function updateAccountLoginIp(accountId, ip) {
  const s = String(ip || '').trim();
  if (!s) return;
  db.prepare('UPDATE accounts SET last_login_ip = ? WHERE id = ?').run(s, Number(accountId));
}

function getAccountsByMachineIdAndIp(machineId, ip) {
  const mid = String(machineId || '').trim();
  const sip = String(ip || '').trim();
  if (!mid || !sip) return [];
  return db.prepare('SELECT id FROM accounts WHERE machine_id = ? AND last_login_ip = ?').all(mid, sip).map(r => r.id);
}

function getAccountsByLoginIp(ip) {
  const sip = String(ip || '').trim();
  if (!sip) return [];
  return db.prepare('SELECT id FROM accounts WHERE last_login_ip = ?').all(sip).map(r => r.id);
}

function getIpBan(ip) {
  const sip = String(ip || '').trim();
  if (!sip) return null;
  return db.prepare('SELECT ip, reason, banned_at, expires_at FROM ip_bans WHERE ip = ?').get(sip) || null;
}

function clearExpiredIpBan(ip) {
  const sip = String(ip || '').trim();
  if (!sip) return 0;
  const row = getIpBan(sip);
  if (!row) return 0;
  const exp = Number(row.expires_at || 0);
  const now = Math.floor(Date.now() / 1000);
  if (exp > 0 && exp <= now) {
    return db.prepare('DELETE FROM ip_bans WHERE ip = ?').run(sip).changes || 0;
  }
  return 0;
}

function isIpBanned(ip) {
  const sip = String(ip || '').trim();
  if (!sip) return false;
  clearExpiredIpBan(sip);
  const row = getIpBan(sip);
  if (!row) return false;
  const exp = Number(row.expires_at || 0);
  if (exp > 0 && exp <= Math.floor(Date.now() / 1000)) return false;
  return true;
}

function banIp(ip, reason = '', expiresAt = 0) {
  const sip = String(ip || '').trim();
  if (!sip) return { changes: 0 };
  const rs = String(reason || '').trim();
  const exp = Math.max(0, Number(expiresAt) || 0);
  return db.prepare(`
    INSERT INTO ip_bans (ip, reason, banned_at, expires_at)
    VALUES (?, ?, strftime('%s','now'), ?)
    ON CONFLICT(ip) DO UPDATE SET
      reason = excluded.reason,
      banned_at = excluded.banned_at,
      expires_at = excluded.expires_at
  `).run(sip, rs, exp);
}

function unbanIp(ip) {
  const sip = String(ip || '').trim();
  if (!sip) return { changes: 0 };
  return db.prepare('DELETE FROM ip_bans WHERE ip = ?').run(sip);
}

// ─── P3: 账号/IP 异步实现（MySQL 驱动） ───
async function createAccountAsync(username, password, options = {}) {
  if (!isMysqlDriver) return createAccount(username, password, options);
  const registerIp = String(options.registerIp || '').trim();
  const machineId = String(options.machineId || '').trim();
  const createdAt = Math.floor(Date.now() / 1000);
  try {
    const ret = await mysqlAsyncPool.execute(
      'INSERT INTO accounts (username, password_hash, register_ip, machine_id, created_at) VALUES (?, ?, ?, ?, ?)',
      [String(username || ''), hashPassword(password), registerIp, machineId, createdAt]
    );
    return {
      changes: Number(ret?.affectedRows || 0),
      lastInsertRowid: Number(ret?.insertId || 0)
    };
  } catch (e) {
    console.error('[db] createAccountAsync error username=%s:', username, e && e.message);
    throw e;
  }
}

async function getAccountByUsernameAsync(username) {
  if (!isMysqlDriver) return getAccountByUsername(username);
  try {
    // username 列已强制 utf8mb4_bin collation，无需额外 BINARY，但保留作为安全网
    const rows = await mysqlAsyncPool.query('SELECT * FROM accounts WHERE BINARY username = ? LIMIT 1', [String(username || '')]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getAccountByUsernameAsync error username=%s:', username, e && e.message);
    throw e;
  }
}

/** 大小写不敏感查重：注册时阻止 bszx/Bszx/BSZX 等重复变体 */
async function getAccountByUsernameCaseInsensitiveAsync(username) {
  if (!isMysqlDriver) {
    // SQLite 默认 LIKE 不区分大小写
    const row = db.prepare('SELECT * FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1').get(String(username || ''));
    return row || null;
  }
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
      [String(username || '')]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getAccountByUsernameCaseInsensitiveAsync error username=%s:', username, e && e.message);
    throw e;
  }
}

async function getAccountByIdAsync(id) {
  if (!isMysqlDriver) return getAccountById(id);
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM accounts WHERE id = ? LIMIT 1', [Number(id)]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getAccountByIdAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function findAccountByRegisterTraitsAsync(machineId) {
  if (!isMysqlDriver) return findAccountByRegisterTraits(machineId);
  const mid = String(machineId || '').trim();
  if (!mid) return null;
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM accounts WHERE machine_id = ? LIMIT 1', [mid]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] findAccountByRegisterTraitsAsync error machineId=%s:', machineId, e && e.message);
    throw e;
  }
}

async function insertMachineLoginLogAsync(accountId, machineId) {
  if (!isMysqlDriver) return insertMachineLoginLog(accountId, machineId);
  const mid = String(machineId || '').trim();
  if (!mid) return;
  try {
    await mysqlAsyncPool.execute(
      'INSERT IGNORE INTO machine_login_log (account_id, machine_id) VALUES (?, ?)',
      [Number(accountId), mid]
    );
  } catch (e) {
    console.error('[db] insertMachineLoginLogAsync error accountId=%s machineId=%s:', accountId, machineId, e && e.message);
    throw e;
  }
}

async function getAccountsByMachineIdAsync(machineId) {
  if (!isMysqlDriver) return getAccountsByMachineId(machineId);
  const mid = String(machineId || '').trim();
  if (!mid) return [];
  try {
    const rows = await mysqlAsyncPool.query('SELECT account_id FROM machine_login_log WHERE machine_id = ?', [mid]);
    return (Array.isArray(rows) ? rows : []).map((r) => Number(r.account_id)).filter((v) => Number.isFinite(v));
  } catch (e) {
    console.error('[db] getAccountsByMachineIdAsync error machineId=%s:', machineId, e && e.message);
    throw e;
  }
}

async function getAccountsByCurrentMachineIdAsync(machineId) {
  if (!isMysqlDriver) return getAccountsByCurrentMachineId(machineId);
  const mid = String(machineId || '').trim();
  if (!mid) return [];
  try {
    const rows = await mysqlAsyncPool.query('SELECT id FROM accounts WHERE machine_id = ?', [mid]);
    return (Array.isArray(rows) ? rows : []).map((r) => Number(r.id)).filter((v) => Number.isFinite(v));
  } catch (e) {
    console.error('[db] getAccountsByCurrentMachineIdAsync error machineId=%s:', machineId, e && e.message);
    throw e;
  }
}

async function getMachineShareBanCountAsync(accountId) {
  if (!isMysqlDriver) return getMachineShareBanCount(accountId);
  try {
    const rows = await mysqlAsyncPool.query('SELECT machine_share_ban_count FROM accounts WHERE id = ? LIMIT 1', [Number(accountId)]);
    return Number(rows?.[0]?.machine_share_ban_count || 0);
  } catch (e) {
    console.error('[db] getMachineShareBanCountAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function isMachineShareExemptAsync(accountId) {
  if (!isMysqlDriver) return isMachineShareExempt(accountId);
  try {
    const rows = await mysqlAsyncPool.query('SELECT machine_share_exempt FROM accounts WHERE id = ? LIMIT 1', [Number(accountId)]);
    return Number(rows?.[0]?.machine_share_exempt || 0) > 0;
  } catch (e) {
    console.error('[db] isMachineShareExemptAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function clearExpiredBanAsync(accountId) {
  if (!isMysqlDriver) return clearExpiredBan(accountId);
  const aid = Number(accountId);
  try {
    const rows = await mysqlAsyncPool.query('SELECT ban_expires_at FROM accounts WHERE id = ? LIMIT 1', [aid]);
    if (!rows || !rows[0]) return;
    const exp = Number(rows[0].ban_expires_at || 0);
    if (exp > 0 && exp <= Math.floor(Date.now() / 1000)) {
      await mysqlAsyncPool.execute(
        "UPDATE accounts SET is_banned = 0, ban_reason = '', banned_at = 0, ban_expires_at = 0 WHERE id = ?",
        [aid]
      );
      accountBanCache.mark(aid, false);
    }
  } catch (e) {
    console.error('[db] clearExpiredBanAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function isAccountBannedAsync(accountId) {
  if (!isMysqlDriver) return isAccountBanned(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT is_banned, ban_expires_at FROM accounts WHERE id = ? LIMIT 1',
      [Number(accountId)]
    );
    const acc = rows && rows[0];
    if (!acc || Number(acc.is_banned || 0) <= 0) return false;
    const expiresAt = Number(acc.ban_expires_at || 0);
    if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch (e) {
    console.error('[db] isAccountBannedAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function banAccountMachineShareAsync(accountId, reason, expiresAt) {
  if (!isMysqlDriver) return banAccountMachineShare(accountId, reason, expiresAt);
  const aid = Number(accountId);
  try {
    const count = (await getMachineShareBanCountAsync(aid)) + 1;
    await mysqlAsyncPool.execute(
      `UPDATE accounts
       SET is_banned = 1,
           ban_reason = ?,
           banned_at = UNIX_TIMESTAMP(),
           ban_expires_at = ?,
           machine_share_ban_count = ?
       WHERE id = ?`,
      [String(reason || ''), Number(expiresAt) || 0, count, aid]
    );
    accountBanCache.mark(aid, true);
    return { changes: 1 };
  } catch (e) {
    console.error('[db] banAccountMachineShareAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function setAccountBannedAsync(accountId, reason, expiresAt = 0) {
  if (!isMysqlDriver) return setAccountBanned(accountId, reason, expiresAt);
  const aid = Number(accountId);
  const exp = Math.max(0, Number(expiresAt) || 0);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE accounts
       SET is_banned = 1,
           ban_reason = ?,
           banned_at = UNIX_TIMESTAMP(),
           ban_expires_at = ?
       WHERE id = ?`,
      [String(reason || ''), exp, aid]
    );
    accountBanCache.mark(aid, true);
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] setAccountBannedAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getCheatScanExemptUntilAsync(accountId) {
  if (!isMysqlDriver) return getCheatScanExemptUntil(accountId);
  try {
    const rows = await mysqlAsyncPool.query('SELECT cheat_scan_exempt_until FROM accounts WHERE id = ? LIMIT 1', [Number(accountId)]);
    return Math.max(0, Math.floor(Number(rows?.[0]?.cheat_scan_exempt_until) || 0));
  } catch (_) {
    return 0;
  }
}

async function isCheatScanExemptAsync(accountId, now = Math.floor(Date.now() / 1000)) {
  if (!isMysqlDriver) return isCheatScanExempt(accountId, now);
  const until = await getCheatScanExemptUntilAsync(accountId);
  return until > Math.max(0, Math.floor(Number(now) || 0));
}

async function setCheatScanExemptUntilAsync(accountId, untilSec) {
  if (!isMysqlDriver) return setCheatScanExemptUntil(accountId, untilSec);
  const until = Math.max(0, Math.floor(Number(untilSec) || 0));
  try {
    const ret = await mysqlAsyncPool.execute(
      'UPDATE accounts SET cheat_scan_exempt_until = ? WHERE id = ?',
      [until, Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] setCheatScanExemptUntilAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function updateAccountMachineIdAsync(accountId, machineId) {
  if (!isMysqlDriver) return updateAccountMachineId(accountId, machineId);
  const mid = String(machineId || '').trim();
  if (!mid) return;
  try {
    const ret = await mysqlAsyncPool.execute('UPDATE accounts SET machine_id = ? WHERE id = ?', [mid, Number(accountId)]);
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateAccountMachineIdAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function updateAccountLoginIpAsync(accountId, ip) {
  if (!isMysqlDriver) return updateAccountLoginIp(accountId, ip);
  const sip = String(ip || '').trim();
  if (!sip) return;
  try {
    const ret = await mysqlAsyncPool.execute('UPDATE accounts SET last_login_ip = ? WHERE id = ?', [sip, Number(accountId)]);
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateAccountLoginIpAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getAccountsByMachineIdAndIpAsync(machineId, ip) {
  if (!isMysqlDriver) return getAccountsByMachineIdAndIp(machineId, ip);
  const mid = String(machineId || '').trim();
  const sip = String(ip || '').trim();
  if (!mid || !sip) return [];
  try {
    const rows = await mysqlAsyncPool.query('SELECT id FROM accounts WHERE machine_id = ? AND last_login_ip = ?', [mid, sip]);
    return (Array.isArray(rows) ? rows : []).map((r) => Number(r.id)).filter((v) => Number.isFinite(v));
  } catch (e) {
    console.error('[db] getAccountsByMachineIdAndIpAsync error machineId=%s ip=%s:', machineId, ip, e && e.message);
    throw e;
  }
}

async function getAccountsByLoginIpAsync(ip) {
  if (!isMysqlDriver) return getAccountsByLoginIp(ip);
  const sip = String(ip || '').trim();
  if (!sip) return [];
  try {
    const rows = await mysqlAsyncPool.query('SELECT id FROM accounts WHERE last_login_ip = ?', [sip]);
    return (Array.isArray(rows) ? rows : []).map((r) => Number(r.id)).filter((v) => Number.isFinite(v));
  } catch (e) {
    console.error('[db] getAccountsByLoginIpAsync error ip=%s:', ip, e && e.message);
    throw e;
  }
}

async function getIpBanAsync(ip) {
  if (!isMysqlDriver) return getIpBan(ip);
  const sip = String(ip || '').trim();
  if (!sip) return null;
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT ip, reason, banned_at, expires_at FROM ip_bans WHERE ip = ? LIMIT 1',
      [sip]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getIpBanAsync error ip=%s:', ip, e && e.message);
    throw e;
  }
}

async function clearExpiredIpBanAsync(ip) {
  if (!isMysqlDriver) return clearExpiredIpBan(ip);
  const sip = String(ip || '').trim();
  if (!sip) return 0;
  try {
    const row = await getIpBanAsync(sip);
    if (!row) return 0;
    const exp = Number(row.expires_at || 0);
    const now = Math.floor(Date.now() / 1000);
    if (exp > 0 && exp <= now) {
      const ret = await mysqlAsyncPool.execute('DELETE FROM ip_bans WHERE ip = ?', [sip]);
      return Number(ret?.affectedRows || 0);
    }
    return 0;
  } catch (e) {
    console.error('[db] clearExpiredIpBanAsync error ip=%s:', ip, e && e.message);
    throw e;
  }
}

async function isIpBannedAsync(ip) {
  if (!isMysqlDriver) return isIpBanned(ip);
  const sip = String(ip || '').trim();
  if (!sip) return false;
  await clearExpiredIpBanAsync(sip);
  const row = await getIpBanAsync(sip);
  if (!row) return false;
  const exp = Number(row.expires_at || 0);
  if (exp > 0 && exp <= Math.floor(Date.now() / 1000)) return false;
  return true;
}

async function banIpAsync(ip, reason = '', expiresAt = 0) {
  if (!isMysqlDriver) return banIp(ip, reason, expiresAt);
  const sip = String(ip || '').trim();
  if (!sip) return { changes: 0 };
  const rs = String(reason || '').trim();
  const exp = Math.max(0, Number(expiresAt) || 0);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO ip_bans (ip, reason, banned_at, expires_at)
       VALUES (?, ?, UNIX_TIMESTAMP(), ?)
       ON DUPLICATE KEY UPDATE
         reason = VALUES(reason),
         banned_at = VALUES(banned_at),
         expires_at = VALUES(expires_at)`,
      [sip, rs, exp]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] banIpAsync error ip=%s:', ip, e && e.message);
    throw e;
  }
}

async function unbanIpAsync(ip) {
  if (!isMysqlDriver) return unbanIp(ip);
  const sip = String(ip || '').trim();
  if (!sip) return { changes: 0 };
  try {
    const ret = await mysqlAsyncPool.execute('DELETE FROM ip_bans WHERE ip = ?', [sip]);
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] unbanIpAsync error ip=%s:', ip, e && e.message);
    throw e;
  }
}

// 玩家数据（读写经 playerWriteCache 合并，减少磁盘 I/O）
function _tryUpdateAutoBattleIndex(accountId, data, dataStr) {
  if (!autoBattleIndex.isEnabled()) return;
  let player = null;
  if (data && typeof data === 'object') {
    player = data;
  } else if (typeof dataStr === 'string' && dataStr.length > 0) {
    try { player = JSON.parse(dataStr); } catch (_) { player = null; }
  }
  if (!player || typeof player !== 'object') return;
  try {
    autoBattleIndex.upsertFromPlayer(accountId, player);
  } catch (_) {}
}

function _toNullableInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function _extractPlayerShadowFields(dataObj) {
  const obj = (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) ? dataObj : null;
  if (!obj) {
    return {
      auto_battle_enabled: null,
      auto_battle_map_id: null,
      current_map_id: null,
      rest_until: null,
      last_activity_at: null
    };
  }
  const enabledRaw = obj.auto_battle_enabled;
  const autoMapId = Math.max(1, _toNullableInt(obj.auto_battle_map_id || obj.current_map_id || 1) || 1);
  const currentMapId = Math.max(1, _toNullableInt(obj.current_map_id || obj.auto_battle_map_id || 1) || 1);
  const restUntil = Math.max(0, _toNullableInt(obj.rest_until) || 0);
  const lastActivityAt = Math.max(0, _toNullableInt(obj?.time_state?.last_activity_at) || 0);
  return {
    auto_battle_enabled: enabledRaw === true ? 1 : (enabledRaw === false ? 0 : null),
    auto_battle_map_id: autoMapId,
    current_map_id: currentMapId,
    rest_until: restUntil,
    last_activity_at: lastActivityAt
  };
}

function _stripPlayerPersistenceNoise(dataObj) {
  if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) return dataObj;
  const sanitized = { ...dataObj };
  delete sanitized._save_seq;
  delete sanitized._combat_dirty;
  // 影子字段保留在 JSON 中，不再删除。影子列仅作为查询索引的冗余副本。
  // 这样 _parsePlayerRow 从 JSON.parse 即可拿到完整数据，影子列为 NULL 也不影响正确性。
  return sanitized;
}

function _stableJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return null;
  }
}

function _splitPlayerLargeFields(dataObj) {
  if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
    return { core: dataObj, largeFieldJsonByField: _newLargeFieldJsonMap(null) };
  }
  const core = { ...dataObj };
  const largeFieldJsonByField = _newLargeFieldJsonMap(null);
  for (const field of PLAYER_LARGE_JSON_FIELDS) {
    const hasField = Object.prototype.hasOwnProperty.call(dataObj, field);
    const json = hasField ? _stableJson(dataObj[field]) : null;
    let useSplitColumn = hasField;
    if (isMysqlDriver && hasField && json != null) {
      const maxBytes = Number(_mysqlSplitColumnByteLimitByField[field] || 65535);
      const softLimit = Math.max(1024, Math.floor(maxBytes * MYSQL_SPLIT_SOFT_LIMIT_RATIO));
      const actualBytes = Buffer.byteLength(String(json || ''), 'utf8');
      if (actualBytes > softLimit) {
        useSplitColumn = false;
        _warnThrottled(
          `split.guard.${field}`,
          '[db] split guard fallback field=%s bytes=%s softLimit=%s',
          field,
          actualBytes,
          softLimit
        );
      }
    }
    largeFieldJsonByField[field] = useSplitColumn ? json : null;
    if (useSplitColumn) delete core[field];
  }
  return { core, largeFieldJsonByField };
}

function _parseJsonSafe(raw, fallback) {
  if (typeof raw !== 'string' || raw.length <= 0) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function _mergeLargeFieldsIntoPlayer(player, row) {
  if (!player || typeof player !== 'object') return player;
  if (!row || typeof row !== 'object') return player;
  for (const field of PLAYER_LARGE_JSON_FIELDS) {
    const colName = `${field}_json`;
    if (!Object.prototype.hasOwnProperty.call(row, colName)) continue;
    if (row[colName] == null) continue;
    player[field] = _parseJsonSafe(String(row[colName] || ''), player[field]);
  }
  return player;
}

function _calcPersistPayloadBytes(dataStr, largeFieldJsonByField) {
  let bytes = Buffer.byteLength(String(dataStr || ''), 'utf8');
  if (largeFieldJsonByField && typeof largeFieldJsonByField === 'object') {
    for (const field of PLAYER_LARGE_JSON_FIELDS) {
      const raw = largeFieldJsonByField[field];
      if (raw != null) bytes += Buffer.byteLength(String(raw || ''), 'utf8');
    }
  }
  return bytes;
}

function _serializePlayerData(data) {
  if (typeof data === 'string') {
    const parsed = _parseJsonSafe(data, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const persisted = _stripPlayerPersistenceNoise(parsed);
      const split = _splitPlayerLargeFields(persisted);
      return {
        dataStr: JSON.stringify(split.core),
        normalizedObject: parsed,
        largeFieldJsonByField: split.largeFieldJsonByField
      };
    }
    return { dataStr: data, normalizedObject: null, largeFieldJsonByField: _newLargeFieldJsonMap(null) };
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const persisted = _stripPlayerPersistenceNoise(data);
    const split = _splitPlayerLargeFields(persisted);
    return {
      dataStr: JSON.stringify(split.core),
      normalizedObject: data,
      largeFieldJsonByField: split.largeFieldJsonByField
    };
  }
  return { dataStr: JSON.stringify(data), normalizedObject: null, largeFieldJsonByField: _newLargeFieldJsonMap(null) };
}

function _isShadowSame(row, shadow) {
  return _toNullableInt(row?.auto_battle_enabled) === _toNullableInt(shadow?.auto_battle_enabled)
    && _toNullableInt(row?.auto_battle_map_id) === _toNullableInt(shadow?.auto_battle_map_id)
    && _toNullableInt(row?.current_map_id) === _toNullableInt(shadow?.current_map_id)
    && _toNullableInt(row?.rest_until) === _toNullableInt(shadow?.rest_until)
    && _toNullableInt(row?.last_activity_at) === _toNullableInt(shadow?.last_activity_at);
}

function _normalizeNullableJson(raw) {
  if (raw === null || raw === undefined) return null;
  return String(raw);
}

function _extractLegacyLargeFieldJson(dataStr, fieldName) {
  if (typeof dataStr !== 'string' || dataStr.length <= 0) return null;
  try {
    const obj = JSON.parse(dataStr);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (!Object.prototype.hasOwnProperty.call(obj, fieldName)) return null;
    return _stableJson(obj[fieldName]);
  } catch (_) {
    return null;
  }
}

function _getCurrentLargeFieldJson(row, fieldName) {
  const colName = `${String(fieldName || '').trim()}_json`;
  if (row && Object.prototype.hasOwnProperty.call(row, colName)) {
    return _normalizeNullableJson(row[colName]);
  }
  return _extractLegacyLargeFieldJson(row?.data, fieldName);
}

function _isLargeFieldSame(row, largeFieldJsonByField) {
  for (const field of PLAYER_LARGE_JSON_FIELDS) {
    const rowJson = _getCurrentLargeFieldJson(row, field);
    const inputJson = _normalizeNullableJson(largeFieldJsonByField ? largeFieldJsonByField[field] : null);
    if (rowJson !== inputJson) return false;
  }
  return true;
}

function _collectChangedLargeFields(current, largeFieldJsonByField) {
  const changedFields = [];
  const metricsLargeFieldJsonByField = _newLargeFieldJsonMap(null);
  if (largeFieldJsonByField && typeof largeFieldJsonByField === 'object') {
    for (const field of PLAYER_LARGE_JSON_FIELDS) {
      metricsLargeFieldJsonByField[field] = largeFieldJsonByField[field];
    }
  }
  for (const field of PLAYER_LARGE_JSON_FIELDS) {
    const currentJson = _getCurrentLargeFieldJson(current, field);
    const nextJson = _normalizeNullableJson(metricsLargeFieldJsonByField[field]);
    if (currentJson !== nextJson) {
      changedFields.push(field);
    } else {
      metricsLargeFieldJsonByField[field] = null;
    }
  }
  return { changedFields, metricsLargeFieldJsonByField };
}

function _savePlayerRaw(accountId, slot, data, options = {}) {
  if (isMysqlDriver) {
    // MySQL mode: sync writes via sync-mysql are unsafe. Skip.
    console.warn('[db] _savePlayerRaw called in MySQL mode, skipping sync write for accountId=%s', accountId);
    return { changes: 0, skipped: true };
  }
  const allowInsert = options && options.allowInsert === true;
  const serialized = _serializePlayerData(data);
  const dataStr = serialized.dataStr;
  const largeFieldJsonByField = serialized.largeFieldJsonByField || _newLargeFieldJsonMap(null);
  let metricsLargeFieldJsonByField = {
    ..._newLargeFieldJsonMap(null),
    ...largeFieldJsonByField
  };
  const shadow = _extractPlayerShadowFields(serialized.normalizedObject);
  const normalizedSlot = Number(slot) || 1;
  const expectedDbRev = _extractExpectedDbRevision(data);
  const current = db.prepare(
    `SELECT slot, data, ${PLAYER_LARGE_JSON_COLUMNS_SQL}, auto_battle_enabled, auto_battle_map_id, current_map_id, rest_until, last_activity_at, save_revision FROM players WHERE account_id = ? LIMIT 1`
  ).get(accountId);
  const currentDbRev = Math.max(0, _toNullableInt(current?.save_revision) || 0);
  if (current
    && Number(current.slot) === normalizedSlot
    && String(current.data || '') === dataStr
    && _isLargeFieldSame(current, largeFieldJsonByField)
    && _isShadowSame(current, shadow)) {
    _dbConflictStats.saveSkipped = Number(_dbConflictStats.saveSkipped || 0) + 1;
    _setPlayerDbRevision(accountId, currentDbRev);
    _attachPlayerDbRevision(serialized.normalizedObject || data, currentDbRev);
    return { changes: 0, skipped: true };
  }

  let ret = null;
  let nextDbRev = 0;
  if (!current) {
    if (expectedDbRev !== null && expectedDbRev > 0) {
      console.warn('[db] savePlayer conflict(insert-miss) accountId=%s expectedRev=%s', accountId, expectedDbRev);
      return { changes: 0, conflict: true, expectedDbRev, currentDbRev: 0 };
    }
    if (!allowInsert) {
      _warnThrottled('savePlayer.insert-disabled', '[db] savePlayer skipped insert accountId=%s expectedRev=%s', accountId, expectedDbRev);
      return { changes: 0, skipped: true, missing: true };
    }
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ? LIMIT 1').get(accountId);
    if (!acc) {
      _warnThrottled('savePlayer.account-missing', '[db] savePlayer skipped insert due to missing account accountId=%s', accountId);
      return { changes: 0, skipped: true, accountMissing: true };
    }
    const insertColumns = [
      'account_id',
      'slot',
      'data',
      ...PLAYER_LARGE_JSON_COLUMNS,
      'auto_battle_enabled',
      'auto_battle_map_id',
      'current_map_id',
      'rest_until',
      'last_activity_at'
    ];
    const insertPlaceholders = insertColumns.map(() => '?').join(', ');
    const ins = db.prepare(`
      INSERT INTO players (${insertColumns.join(', ')}, save_revision, updated_at)
      VALUES (${insertPlaceholders}, 1, strftime('%s', 'now'))
    `);
    ret = ins.run(
      accountId,
      normalizedSlot,
      dataStr,
      ...PLAYER_LARGE_JSON_FIELDS.map((field) => largeFieldJsonByField[field]),
      shadow.auto_battle_enabled,
      shadow.auto_battle_map_id,
      shadow.current_map_id,
      shadow.rest_until,
      shadow.last_activity_at
    );
    nextDbRev = 1;
  } else {
    if (expectedDbRev !== null && expectedDbRev !== currentDbRev) {
      console.warn('[db] savePlayer conflict accountId=%s expectedRev=%s currentRev=%s', accountId, expectedDbRev, currentDbRev);
      return { changes: 0, conflict: true, expectedDbRev, currentDbRev };
    }
    const diff = _collectChangedLargeFields(current, largeFieldJsonByField);
    const changedFields = diff.changedFields;
    metricsLargeFieldJsonByField = diff.metricsLargeFieldJsonByField;
    const compareDbRev = expectedDbRev !== null ? expectedDbRev : currentDbRev;
    const setClauses = [
      'slot=?',
      'data=?',
      'auto_battle_enabled=?',
      'auto_battle_map_id=?',
      'current_map_id=?',
      'rest_until=?',
      'last_activity_at=?'
    ];
    const params = [
      normalizedSlot,
      dataStr,
      shadow.auto_battle_enabled,
      shadow.auto_battle_map_id,
      shadow.current_map_id,
      shadow.rest_until,
      shadow.last_activity_at
    ];
    for (const field of changedFields) {
      setClauses.push(`${field}_json=?`);
      params.push(largeFieldJsonByField[field]);
    }
    const upd = db.prepare(`
      UPDATE players
      SET ${setClauses.join(',')},
          save_revision = save_revision + 1,
          updated_at = strftime('%s', 'now')
      WHERE account_id=? AND save_revision=?
    `);
    ret = upd.run(
      ...params,
      accountId,
      compareDbRev
    );
    if (Number(ret?.changes || 0) <= 0) {
      console.warn('[db] savePlayer CAS miss accountId=%s expectedRev=%s currentRev=%s', accountId, compareDbRev, currentDbRev);
      return { changes: 0, conflict: true, expectedDbRev: compareDbRev, currentDbRev };
    }
    nextDbRev = compareDbRev + 1;
  }

  _setPlayerDbRevision(accountId, nextDbRev);
  _attachPlayerDbRevision(serialized.normalizedObject || data, nextDbRev);
  _dbConflictStats.saveWrites = Number(_dbConflictStats.saveWrites || 0) + 1;
  _dbConflictStats.saveBytes = Number(_dbConflictStats.saveBytes || 0) + _calcPersistPayloadBytes(dataStr, metricsLargeFieldJsonByField);
  _tryUpdateAutoBattleIndex(accountId, serialized.normalizedObject || data, dataStr);
  return ret;
}

playerWriteCache.init(_savePlayerRaw);

// ─── MySQL 异步读缓存 + 异步写 ───
const _asyncReadCache = new Map();
const ASYNC_READ_CACHE_TTL_MS = (() => {
  const v = Number(process.env.ASYNC_READ_CACHE_TTL_MS);
  return Number.isFinite(v) && v >= 100 ? Math.min(5000, Math.floor(v)) : 800;
})();

function _setAsyncReadCache(accountId, player) {
  _asyncReadCache.set(Number(accountId), { player, expiresAt: Date.now() + ASYNC_READ_CACHE_TTL_MS });
}

function _getAsyncReadCache(accountId) {
  const entry = _asyncReadCache.get(Number(accountId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _asyncReadCache.delete(Number(accountId));
    return null;
  }
  return entry.player;
}

function _invalidateAsyncReadCache(accountId) {
  _asyncReadCache.delete(Number(accountId));
}

setInterval(() => {
  const now = Date.now();
  for (const [aid, entry] of _asyncReadCache) {
    if (now > entry.expiresAt) _asyncReadCache.delete(aid);
  }
}, 15000);

/** 从 DB 行解析玩家对象（复用影子列覆盖逻辑） */
function _parsePlayerRow(row) {
  if (!row) return null;
  try {
    const player = JSON.parse(row.data);
    _mergeLargeFieldsIntoPlayer(player, row);
    // 影子列优先，NULL 时 fallback 到 JSON 内已有字段（迁移后旧数据影子列可能全为 NULL）
    const colEnabled = _toNullableInt(row.auto_battle_enabled);
    if (colEnabled !== null) player.auto_battle_enabled = colEnabled === 1;

    const colAutoMap = _toNullableInt(row.auto_battle_map_id);
    if (colAutoMap !== null && colAutoMap > 0) player.auto_battle_map_id = colAutoMap;

    const colCurrentMap = _toNullableInt(row.current_map_id);
    if (colCurrentMap !== null && colCurrentMap > 0) player.current_map_id = colCurrentMap;

    const colRestUntil = _toNullableInt(row.rest_until);
    if (colRestUntil !== null && colRestUntil >= 0) player.rest_until = colRestUntil;

    const colLastActivity = _toNullableInt(row.last_activity_at);
    if (colLastActivity !== null && colLastActivity > 0) {
      if (!player.time_state || typeof player.time_state !== 'object' || Array.isArray(player.time_state)) {
        player.time_state = {};
      }
      const currentLast = _toNullableInt(player.time_state.last_activity_at) || 0;
      if (colLastActivity > currentLast) player.time_state.last_activity_at = colLastActivity;
    }
    const dbRev = Math.max(0, _toNullableInt(row.save_revision) || 0);
    _attachPlayerDbRevision(player, dbRev);
    if (Number(row.account_id) > 0) _setPlayerDbRevision(row.account_id, dbRev);
    return player;
  } catch (e) {
    console.error('[db] _parsePlayerRow parse error:', e && e.message);
    return null;
  }
}

/**
 * MySQL 模式下异步预取玩家数据到读缓存，供后续同步 getPlayerByAccountId 命中。
 * SQLite 模式下为空操作。
 */
async function prefetchPlayerAsync(accountId) {
  if (!isMysqlDriver) return;
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  if (playerWriteCache.getCached(aid)) return;
  if (_getAsyncReadCache(aid)) return;
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM players WHERE account_id = ? LIMIT 1',
      [aid]
    );
    const row = rows && rows[0];
    if (row) {
      const player = _parsePlayerRow(row);
      if (player) _setAsyncReadCache(aid, player);
    }
  } catch (_) {
    // 静默失败，后续 getPlayerByAccountId 走同步兜底
  }
}

/**
 * MySQL 异步写玩家（供 playerWriteCache 异步刷写使用）
 */
async function _savePlayerRawAsync(accountId, slot, data, options = {}) {
  return accountSerialExecutor.run(accountId, async () => {
    const allowInsert = options && options.allowInsert === true;
    const serialized = _serializePlayerData(data);
    const dataStr = serialized.dataStr;
    const largeFieldJsonByField = serialized.largeFieldJsonByField || _newLargeFieldJsonMap(null);
    let metricsLargeFieldJsonByField = {
      ..._newLargeFieldJsonMap(null),
      ...largeFieldJsonByField
    };
    let shadow = _extractPlayerShadowFields(serialized.normalizedObject);
    const normalizedSlot = Number(slot) || 1;
    const expectedDbRev = _extractExpectedDbRevision(data);
    try {
      const rows = await mysqlAsyncPool.query(
        `SELECT slot, data, ${PLAYER_LARGE_JSON_COLUMNS_SQL}, auto_battle_enabled, auto_battle_map_id, current_map_id, rest_until, last_activity_at, save_revision FROM players WHERE account_id = ? LIMIT 1`,
        [accountId]
      );
      const current = rows && rows[0];
      const currentDbRev = Math.max(0, _toNullableInt(current?.save_revision) || 0);
      if (!serialized.normalizedObject && current) {
        shadow = {
          auto_battle_enabled: _toNullableInt(current.auto_battle_enabled),
          auto_battle_map_id: _toNullableInt(current.auto_battle_map_id),
          current_map_id: _toNullableInt(current.current_map_id),
          rest_until: _toNullableInt(current.rest_until),
          last_activity_at: _toNullableInt(current.last_activity_at)
        };
      }
      if (current
        && Number(current.slot) === normalizedSlot
        && String(current.data || '') === dataStr
        && _isLargeFieldSame(current, largeFieldJsonByField)
        && _isShadowSame(current, shadow)) {
        _dbConflictStats.saveSkipped = Number(_dbConflictStats.saveSkipped || 0) + 1;
        _setPlayerDbRevision(accountId, currentDbRev);
        _attachPlayerDbRevision(serialized.normalizedObject || data, currentDbRev);
        return { changes: 0, skipped: true };
      }

      let nextDbRev = 0;
      if (!current) {
        if (expectedDbRev !== null && expectedDbRev > 0) {
          _incDbConflictStat('conflictInsertMiss');
          _warnThrottled('savePlayerAsync.conflict.insert-miss', '[db] savePlayerAsync conflict(insert-miss) accountId=%s expectedRev=%s', accountId, expectedDbRev);
          return { changes: 0, conflict: true, expectedDbRev, currentDbRev: 0 };
        }
        if (!allowInsert) {
          _warnThrottled('savePlayerAsync.insert-disabled', '[db] savePlayerAsync skipped insert accountId=%s expectedRev=%s', accountId, expectedDbRev);
          return { changes: 0, skipped: true, missing: true };
        }
        const accRows = await mysqlAsyncPool.query(
          'SELECT id FROM accounts WHERE id = ? LIMIT 1',
          [accountId]
        );
        if (!Array.isArray(accRows) || !accRows[0]) {
          _warnThrottled('savePlayerAsync.account-missing', '[db] savePlayerAsync skipped insert due to missing account accountId=%s', accountId);
          return { changes: 0, skipped: true, accountMissing: true };
        }
        const insertColumns = [
          'account_id',
          'slot',
          'data',
          ...PLAYER_LARGE_JSON_COLUMNS,
          'auto_battle_enabled',
          'auto_battle_map_id',
          'current_map_id',
          'rest_until',
          'last_activity_at'
        ];
        const insertPlaceholders = insertColumns.map(() => '?').join(', ');
        await mysqlAsyncPool.execute(
          `INSERT INTO players (${insertColumns.join(', ')}, save_revision, updated_at)
           VALUES (${insertPlaceholders}, 1, UNIX_TIMESTAMP())`,
          [
            accountId,
            normalizedSlot,
            dataStr,
            ...PLAYER_LARGE_JSON_FIELDS.map((field) => largeFieldJsonByField[field]),
            shadow.auto_battle_enabled,
            shadow.auto_battle_map_id,
            shadow.current_map_id,
            shadow.rest_until,
            shadow.last_activity_at
          ]
        );
        nextDbRev = 1;
      } else {
        if (expectedDbRev !== null && expectedDbRev !== currentDbRev) {
          _incDbConflictStat('conflictExpectedRev');
          _warnThrottled('savePlayerAsync.conflict', '[db] savePlayerAsync conflict accountId=%s expectedRev=%s currentRev=%s', accountId, expectedDbRev, currentDbRev);
          return { changes: 0, conflict: true, expectedDbRev, currentDbRev };
        }
        const diff = _collectChangedLargeFields(current, largeFieldJsonByField);
        const changedFields = diff.changedFields;
        metricsLargeFieldJsonByField = diff.metricsLargeFieldJsonByField;
        const compareDbRev = expectedDbRev !== null ? expectedDbRev : currentDbRev;
        const setClauses = [
          'slot = ?',
          'data = ?',
          'auto_battle_enabled = ?',
          'auto_battle_map_id = ?',
          'current_map_id = ?',
          'rest_until = ?',
          'last_activity_at = ?'
        ];
        const params = [
          normalizedSlot,
          dataStr,
          shadow.auto_battle_enabled,
          shadow.auto_battle_map_id,
          shadow.current_map_id,
          shadow.rest_until,
          shadow.last_activity_at
        ];
        for (const field of changedFields) {
          setClauses.push(`${field}_json = ?`);
          params.push(largeFieldJsonByField[field]);
        }
        const ret = await mysqlAsyncPool.execute(
          `UPDATE players
           SET ${setClauses.join(', ')},
               save_revision = save_revision + 1,
               updated_at = UNIX_TIMESTAMP()
           WHERE account_id = ? AND save_revision = ?`,
          [
            ...params,
            accountId,
            compareDbRev
          ]
        );
        if (Number(ret?.affectedRows || 0) <= 0) {
          _incDbConflictStat('conflictCasMiss');
          _warnThrottled('savePlayerAsync.cas-miss', '[db] savePlayerAsync CAS miss accountId=%s expectedRev=%s currentRev=%s', accountId, compareDbRev, currentDbRev);
          return { changes: 0, conflict: true, expectedDbRev: compareDbRev, currentDbRev };
        }
        nextDbRev = compareDbRev + 1;
      }

      _setPlayerDbRevision(accountId, nextDbRev);
      _attachPlayerDbRevision(serialized.normalizedObject || data, nextDbRev);
      _dbConflictStats.saveWrites = Number(_dbConflictStats.saveWrites || 0) + 1;
      _dbConflictStats.saveBytes = Number(_dbConflictStats.saveBytes || 0) + _calcPersistPayloadBytes(dataStr, metricsLargeFieldJsonByField);
      const obj = serialized.normalizedObject || data;
      if (obj) _setAsyncReadCache(accountId, obj);
      _tryUpdateAutoBattleIndex(accountId, obj, dataStr);
      return { changes: 1 };
    } catch (e) {
      console.error('[db] _savePlayerRawAsync error accountId=%s:', accountId, e && e.message);
      throw e;
    }
  });
}

if (isMysqlDriver) {
  playerWriteCache.initAsync(_savePlayerRawAsync);
}

// ─── 短生 LRU 读缓存（减少联赛 / 批量结算重复 DB 读取）───
const _playerReadCache = new Map();
const PLAYER_READ_CACHE_TTL_MS = 3000;
const PLAYER_READ_CACHE_MAX = 500;

function _getPlayerReadCache(accountId) {
  const aid = Number(accountId);
  const entry = _playerReadCache.get(aid);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _playerReadCache.delete(aid);
    return null;
  }
  return entry.player;
}

function _setPlayerReadCache(accountId, player) {
  const aid = Number(accountId);
  if (_playerReadCache.size >= PLAYER_READ_CACHE_MAX) {
    // 淘汰最旧的条目
    const oldest = _playerReadCache.keys().next().value;
    if (oldest !== undefined) _playerReadCache.delete(oldest);
  }
  _playerReadCache.set(aid, { player, expiresAt: Date.now() + PLAYER_READ_CACHE_TTL_MS });
}

function _invalidatePlayerReadCache(accountId) {
  _playerReadCache.delete(Number(accountId));
}

function _clearAllPlayerReadCache() {
  _playerReadCache.clear();
}

// 定期清理过期条目
setInterval(() => {
  const now = Date.now();
  for (const [aid, entry] of _playerReadCache) {
    if (now > entry.expiresAt) _playerReadCache.delete(aid);
  }
}, 10000);

// ─── 玩家状态版本控制与三向合并（防止并发读-改-写覆盖）───
const PLAYER_STATE_META = Symbol('player_state_meta');
const PLAYER_DB_REV_META = Symbol('player_db_revision');
const _playerStateVersion = new Map();
const _playerStateSnapshot = new Map();
const _playerDbRevision = new Map();

function _safeClone(value) {
  try {
    return structuredClone(value);
  } catch (_) {
    return JSON.parse(JSON.stringify(value));
  }
}

function _isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _setPlayerDbRevision(accountId, rev) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return;
  const n = Number(rev);
  const safeRev = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  _playerDbRevision.set(aid, safeRev);
}

function _extractPlayerDbRevision(player) {
  if (!player || typeof player !== 'object') return null;
  const n = Number(player[PLAYER_DB_REV_META]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

function _attachPlayerDbRevision(player, rev) {
  if (!player || typeof player !== 'object') return;
  const n = Number(rev);
  const safeRev = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  try {
    Object.defineProperty(player, PLAYER_DB_REV_META, {
      value: safeRev,
      configurable: true,
      enumerable: false,
      writable: true
    });
  } catch (_) {}
}

function _extractExpectedDbRevision(data) {
  if (!data || typeof data !== 'object') return null;
  const meta = data[PLAYER_STATE_META];
  const fromMeta = Number(meta?.dbRev);
  if (Number.isFinite(fromMeta)) return Math.max(0, Math.trunc(fromMeta));
  const fromSymbol = _extractPlayerDbRevision(data);
  if (Number.isFinite(fromSymbol)) return fromSymbol;
  return null;
}

function _deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!_deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (_isPlainObject(a) || _isPlainObject(b)) {
    if (!_isPlainObject(a) || !_isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!_deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function _recordPlayerState(accountId, player, { bump = false } = {}) {
  const aid = Number(accountId) || 0;
  if (aid <= 0 || !player || typeof player !== 'object') return 0;
  const current = Number(_playerStateVersion.get(aid) || 0);
  const next = bump ? Math.max(1, current + 1) : Math.max(1, current);
  _playerStateVersion.set(aid, next);
  // 仅在写操作(bump=true)或首次初始化时更新快照
  // 读操作(bump=false)不覆盖已有快照，防止DB残缺数据污染基线
  if (bump || !_playerStateSnapshot.has(aid)) {
    _playerStateSnapshot.set(aid, _safeClone(player));
  }
  return next;
}

function _attachPlayerStateMeta(accountId, player) {
  const aid = Number(accountId) || 0;
  if (aid <= 0 || !player || typeof player !== 'object') return player;
  const rev = _recordPlayerState(aid, player, { bump: false });
  const dbRevFromPlayer = _extractPlayerDbRevision(player);
  const dbRev = Number.isFinite(dbRevFromPlayer)
    ? dbRevFromPlayer
    : Math.max(0, Math.trunc(Number(_playerDbRevision.get(aid) || 0)));
  _attachPlayerDbRevision(player, dbRev);
  try {
    Object.defineProperty(player, PLAYER_STATE_META, {
      value: {
        accountId: aid,
        rev,
        dbRev,
        base: _safeClone(player)
      },
      configurable: true,
      enumerable: false,
      writable: true
    });
  } catch (_) {}
  return player;
}

function _rebaseArrayDelta(latest, base, changed) {
  const len = base.length;
  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    const bv = base[i], cv = changed[i], lv = latest[i];
    if (_deepEqual(bv, cv)) {
      result[i] = _safeClone(lv);
    } else if (Array.isArray(bv) && Array.isArray(cv) && Array.isArray(lv)
               && bv.length === cv.length && cv.length === lv.length) {
      result[i] = _rebaseArrayDelta(lv, bv, cv);
    } else if (_isPlainObject(bv) && _isPlainObject(cv) && _isPlainObject(lv)) {
      result[i] = _rebasePlayerDelta(lv, bv, cv);
    } else {
      result[i] = _safeClone(cv);
    }
  }
  return result;
}

function _rebasePlayerDelta(latest, base, changed) {
  if (_deepEqual(base, changed)) return _safeClone(latest);
  if (!_isPlainObject(base) || !_isPlainObject(changed) || !_isPlainObject(latest)) {
    return _safeClone(changed);
  }

  const result = _safeClone(latest);
  const keys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(changed || {})
  ]);

  for (const key of keys) {
    const changedHas = Object.prototype.hasOwnProperty.call(changed, key);
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    if (!changedHas) {
      if (baseHas) delete result[key];
      continue;
    }

    const baseValue = baseHas ? base[key] : undefined;
    const changedValue = changed[key];
    if (_deepEqual(baseValue, changedValue)) continue;

    const latestValue = Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
    if (_isPlainObject(baseValue) && _isPlainObject(changedValue) && _isPlainObject(latestValue)) {
      result[key] = _rebasePlayerDelta(latestValue, baseValue, changedValue);
    } else if (Array.isArray(baseValue) && Array.isArray(changedValue) && Array.isArray(latestValue)
               && baseValue.length === changedValue.length && changedValue.length === latestValue.length) {
      result[key] = _rebaseArrayDelta(latestValue, baseValue, changedValue);
    } else {
      result[key] = _safeClone(changedValue);
    }
  }

  return result;
}

function _rebasePlayerWrite(accountId, data) {
  const aid = Number(accountId) || 0;
  const meta = data && typeof data === 'object' ? data[PLAYER_STATE_META] : null;
  if (aid <= 0 || !meta || Number(meta.accountId) !== aid) return data;

  const currentRev = Number(_playerStateVersion.get(aid) || 0);
  if (currentRev <= 0 || Number(meta.rev) >= currentRev) return data;

  const latest = _playerStateSnapshot.get(aid);
  if (!latest || typeof latest !== 'object') return data;

  try {
    const rebased = _rebasePlayerDelta(latest, meta.base, data);
    _incDbConflictStat('rebaseStaleWrite');
    _warnThrottled('savePlayerAsync.rebase-stale', '[db] rebased stale player write accountId=%s from rev=%s to rev=%s', aid, meta.rev, currentRev);
    return rebased;
  } catch (e) {
    console.error('[db] failed to rebase stale player write accountId=%s:', aid, e?.message || e);
    return data;
  }
}

function getPlayerByAccountId(accountId, opts) {
  const noClone = opts && opts.noClone;
  const cached = playerWriteCache.getCached(accountId);
  if (cached) return _attachPlayerStateMeta(accountId, cached);
  if (isMysqlDriver) {
    const asyncCached = _getAsyncReadCache(accountId);
    if (asyncCached) {
      try {
        const player = noClone ? asyncCached : structuredClone(asyncCached);
        return _attachPlayerStateMeta(accountId, player);
      } catch (_) {}
    }
    // MySQL 模式下缓存 miss 不走 sync-mysql，返回 null 让调用方走 async 路径
    return null;
  }
  // LRU 读缓存（SQLite 专用）
  const readCached = _getPlayerReadCache(accountId);
  if (readCached) {
    if (noClone) {
      _invalidatePlayerReadCache(accountId);
      return _attachPlayerStateMeta(accountId, readCached);
    }
    return _attachPlayerStateMeta(accountId, structuredClone(readCached));
  }
  const row = db.prepare('SELECT * FROM players WHERE account_id = ?').get(accountId);
  if (!row) return null;
  const player = _parsePlayerRow(row);
  if (!noClone && player) _setPlayerReadCache(accountId, player);
  return _attachPlayerStateMeta(accountId, player);
}

function savePlayer(accountId, slot, data) {
  const finalData = _rebasePlayerWrite(accountId, data);
  _invalidatePlayerReadCache(accountId);
  const queued = playerWriteCache.scheduleSave(accountId, slot, finalData);
  if (!queued) return { queued: false, skipped: true };
  _recordPlayerState(accountId, finalData, { bump: true });
  return { queued: true };
}

/** 立即落盘，不经过缓存。用于 create 等必须同步落盘的操作 */
async function savePlayerImmediate(accountId, slot, data, options = {}) {
  const finalData = _rebasePlayerWrite(accountId, data);
  _invalidatePlayerReadCache(accountId);
  if (isMysqlDriver) {
    const ret = await _savePlayerRawAsync(accountId, slot, finalData, options);
    playerWriteCache.clear(accountId);
    if (!ret?.skipped && !ret?.conflict) _recordPlayerState(accountId, finalData, { bump: true });
    return ret;
  }
  const ret = _savePlayerRaw(accountId, slot, finalData, options);
  playerWriteCache.clear(accountId);
  if (!ret?.skipped && !ret?.conflict) _recordPlayerState(accountId, finalData, { bump: true });
  return ret;
}

function getPlayerRuntimeState(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return null;
  if (isMysqlDriver) {
    // MySQL mode: derive from in-memory caches, avoid sync-mysql
    const cached = playerWriteCache.getCached(aid) || _getAsyncReadCache(aid);
    if (!cached) return null;
    return {
      account_id: aid,
      auto_battle_enabled: cached.auto_battle_enabled === true || cached.auto_battle_enabled === 1,
      auto_battle_map_id: Math.max(1, Number(cached.auto_battle_map_id) || Number(cached.current_map_id) || 1),
      current_map_id: Math.max(1, Number(cached.current_map_id) || 1),
      rest_until: Math.max(0, Number(cached.rest_until) || 0),
      last_activity_at: Math.max(0, Number(cached.time_state?.last_activity_at) || 0)
    };
  }
  const row = db.prepare(`
    SELECT
      account_id,
      COALESCE(auto_battle_enabled, json_extract(data, '$.auto_battle_enabled')) AS auto_battle_enabled,
      COALESCE(auto_battle_map_id, json_extract(data, '$.auto_battle_map_id'), json_extract(data, '$.current_map_id'), 1) AS auto_battle_map_id,
      COALESCE(current_map_id, json_extract(data, '$.current_map_id'), 1) AS current_map_id,
      COALESCE(rest_until, json_extract(data, '$.rest_until'), 0) AS rest_until,
      COALESCE(last_activity_at, json_extract(data, '$.time_state.last_activity_at'), updated_at, 0) AS last_activity_at
    FROM players
    WHERE account_id = ?
    LIMIT 1
  `).get(aid);
  if (!row) return null;
  return {
    account_id: aid,
    auto_battle_enabled: _toNullableInt(row.auto_battle_enabled) === 1,
    auto_battle_map_id: Math.max(1, _toNullableInt(row.auto_battle_map_id) || 1),
    current_map_id: Math.max(1, _toNullableInt(row.current_map_id) || 1),
    rest_until: Math.max(0, _toNullableInt(row.rest_until) || 0),
    last_activity_at: Math.max(0, _toNullableInt(row.last_activity_at) || 0)
  };
}

function updatePlayerAutoBattleIntent(accountId, enabled, mapId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return null;
  _invalidatePlayerReadCache(aid);
  const state = getPlayerRuntimeState(aid);
  if (!state) return null;
  const cached = playerWriteCache.getCached(aid) || null;
  const enabledInt = enabled ? 1 : 0;
  const desiredMapId = Math.max(1, Math.floor(Number(
    mapId
    || cached?.auto_battle_map_id
    || cached?.current_map_id
    || state.auto_battle_map_id
    || state.current_map_id
    || 1
  )));

  playerWriteCache.patchCached(aid, (player) => {
    player.auto_battle_enabled = enabledInt === 1;
    player.auto_battle_map_id = desiredMapId;
    if (!Number.isFinite(Number(player.current_map_id)) || Number(player.current_map_id) <= 0) {
      player.current_map_id = state.current_map_id;
    }
    return player;
  });

  if ((state.auto_battle_enabled ? 1 : 0) !== enabledInt || state.auto_battle_map_id !== desiredMapId) {
    if (!isMysqlDriver) {
      db.prepare(`
        UPDATE players
        SET auto_battle_enabled = ?, auto_battle_map_id = ?, updated_at = strftime('%s', 'now')
        WHERE account_id = ?
      `).run(enabledInt, desiredMapId, aid);
    }
    // MySQL mode: writeCache patchCached above + timer flush handles persistence
  }

  if (enabledInt === 1) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: desiredMapId,
      current_map_id: Math.max(1, Math.floor(Number(cached?.current_map_id || state.current_map_id || 1))),
      rest_until: state.rest_until,
      time_state: { last_activity_at: state.last_activity_at }
    });
  } else {
    autoBattleIndex.removeAccount(aid);
  }

  return {
    ...state,
    auto_battle_enabled: enabledInt === 1,
    auto_battle_map_id: desiredMapId
  };
}

function updatePlayerRestUntil(accountId, restUntil) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;
  _invalidatePlayerReadCache(aid);
  const desired = Math.max(0, Math.floor(Number(restUntil) || 0));
  const state = getPlayerRuntimeState(aid);
  if (!state) return false;

  playerWriteCache.patchCached(aid, (player) => {
    player.rest_until = desired;
    return player;
  });

  if (state.rest_until !== desired) {
    if (!isMysqlDriver) {
      db.prepare(`
        UPDATE players
        SET rest_until = ?, updated_at = strftime('%s', 'now')
        WHERE account_id = ?
      `).run(desired, aid);
    }
    // MySQL mode: writeCache patchCached above + timer flush handles persistence
  }
  if (state.auto_battle_enabled === true) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: state.auto_battle_map_id,
      current_map_id: state.current_map_id,
      rest_until: desired,
      time_state: { last_activity_at: state.last_activity_at }
    });
  }
  return true;
}

function updatePlayerLastActivity(accountId, lastActivityAt) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;
  _invalidatePlayerReadCache(aid);
  const desired = Math.max(0, Math.floor(Number(lastActivityAt) || 0));
  const state = getPlayerRuntimeState(aid);
  if (!state) return false;

  playerWriteCache.patchCached(aid, (player) => {
    if (!player.time_state || typeof player.time_state !== 'object' || Array.isArray(player.time_state)) {
      player.time_state = {};
    }
    player.time_state.last_activity_at = desired;
    return player;
  });

  if (state.last_activity_at !== desired) {
    if (!isMysqlDriver) {
      db.prepare(`
        UPDATE players
        SET last_activity_at = ?, updated_at = strftime('%s', 'now')
        WHERE account_id = ?
      `).run(desired, aid);
    }
    // MySQL mode: writeCache patchCached above + timer flush handles persistence
  }

  if (state.auto_battle_enabled === true) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: state.auto_battle_map_id,
      current_map_id: state.current_map_id,
      rest_until: state.rest_until,
      time_state: { last_activity_at: desired }
    });
  }
  return true;
}

function _buildFullPlayerDataString(coreDataStr, row) {
  try {
    const core = _parseJsonSafe(String(coreDataStr || ''), {});
    if (!core || typeof core !== 'object' || Array.isArray(core)) {
      return String(coreDataStr || '{}');
    }
    for (const field of PLAYER_LARGE_JSON_FIELDS) {
      const colName = `${field}_json`;
      if (!row || !Object.prototype.hasOwnProperty.call(row, colName)) continue;
      if (row[colName] == null) continue;
      core[field] = _parseJsonSafe(String(row[colName] || ''), core[field]);
    }
    return JSON.stringify(core);
  } catch (_) {
    return String(coreDataStr || '{}');
  }
}

function listAllPlayersRaw() {
  const rows = db.prepare(`SELECT account_id, slot, data, ${PLAYER_LARGE_JSON_COLUMNS_SQL} FROM players`).all();
  return rows.map((row) => ({
    account_id: row.account_id,
    slot: row.slot,
    data: _buildFullPlayerDataString(row.data, row)
  }));
}

function listAutoBattlePlayerRows(afterAccountId = 0, limit = 300) {
  const after = Math.max(0, Math.trunc(Number(afterAccountId) || 0));
  const lim = Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 300)));
  if (isMysqlDriver) {
    return db.prepare(`
      SELECT
        account_id,
        COALESCE(auto_battle_enabled,
          CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
        ) AS auto_battle_enabled,
        COALESCE(
          auto_battle_map_id,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_map_id')) AS SIGNED),
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
          1
        ) AS auto_battle_map_id,
        COALESCE(
          current_map_id,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
          1
        ) AS current_map_id,
        COALESCE(
          rest_until,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.rest_until')) AS SIGNED),
          0
        ) AS rest_until,
        COALESCE(
          last_activity_at,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.time_state.last_activity_at')) AS SIGNED),
          updated_at,
          0
        ) AS last_activity_at
      FROM players
      WHERE account_id > ?
        AND COALESCE(auto_battle_enabled,
          CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
        ) = 1
      ORDER BY account_id ASC
      LIMIT ?
    `).all(after, lim);
  }
  return db.prepare(`
    SELECT
      account_id,
      COALESCE(auto_battle_enabled, json_extract(data, '$.auto_battle_enabled')) AS auto_battle_enabled,
      COALESCE(auto_battle_map_id, json_extract(data, '$.auto_battle_map_id'), json_extract(data, '$.current_map_id'), 1) AS auto_battle_map_id,
      COALESCE(current_map_id, json_extract(data, '$.current_map_id'), 1) AS current_map_id,
      COALESCE(rest_until, json_extract(data, '$.rest_until'), 0) AS rest_until,
      COALESCE(last_activity_at, json_extract(data, '$.time_state.last_activity_at'), updated_at, 0) AS last_activity_at
    FROM players
    WHERE account_id > ?
      AND COALESCE(auto_battle_enabled, json_extract(data, '$.auto_battle_enabled')) = 1
    ORDER BY account_id ASC
    LIMIT ?
  `).all(after, lim);
}

function listPendingJobPlayerRows(afterAccountId = 0, limit = 300) {
  const after = Math.max(0, Math.trunc(Number(afterAccountId) || 0));
  const lim = Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 300)));
  return db.prepare(`
    SELECT account_id, slot
    FROM players
    WHERE account_id > ?
      AND COALESCE(
        json_type(baiyi_json, '$.pending_job'),
        json_type(data, '$.baiyi.pending_job')
      ) = 'object'
    ORDER BY account_id ASC
    LIMIT ?
  `).all(after, lim);
}

/**
 * P3: 真异步玩家读取（MySQL 驱动下走 mysql2/promise）。
 * - SQLite 下保持与同步实现一致。
 * - 保留 playerWriteCache / 读缓存 / noClone 语义。
 */
async function getPlayerByAccountIdAsync(accountId, opts) {
  const noClone = opts && opts.noClone;
  const cached = playerWriteCache.getCached(accountId);
  if (cached) return _attachPlayerStateMeta(accountId, cached);
  if (isMysqlDriver) {
    const asyncCached = _getAsyncReadCache(accountId);
    if (asyncCached) {
      try {
        const player = noClone ? asyncCached : structuredClone(asyncCached);
        return _attachPlayerStateMeta(accountId, player);
      } catch (_) {}
    }
  }
  const readCached = _getPlayerReadCache(accountId);
  if (readCached) {
    if (noClone) {
      _invalidatePlayerReadCache(accountId);
      return _attachPlayerStateMeta(accountId, readCached);
    }
    return _attachPlayerStateMeta(accountId, structuredClone(readCached));
  }

  if (!isMysqlDriver) return getPlayerByAccountId(accountId, opts);

  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM players WHERE account_id = ? LIMIT 1',
      [accountId]
    );
    const row = rows && rows[0];
    if (!row) return null;
    const player = _parsePlayerRow(row);
    if (!noClone && player) _setPlayerReadCache(accountId, player);
    return _attachPlayerStateMeta(accountId, player);
  } catch (e) {
    console.error('[db] getPlayerByAccountIdAsync error accountId=%s:', accountId, e && e.message);
    return null;
  }
}

/**
 * P3: 真异步立即写（MySQL 驱动下避免 sync-mysql 阻塞）。
 */
async function savePlayerImmediateAsync(accountId, slot, data, options = {}) {
  const finalData = _rebasePlayerWrite(accountId, data);
  _invalidatePlayerReadCache(accountId);
  if (!isMysqlDriver) {
    const ret = _savePlayerRaw(accountId, slot, finalData, options);
    playerWriteCache.clear(accountId);
    if (!ret?.skipped && !ret?.conflict) _recordPlayerState(accountId, finalData, { bump: true });
    return ret;
  }
  const ret = await _savePlayerRawAsync(accountId, slot, finalData, options);
  playerWriteCache.clear(accountId);
  if (!ret?.skipped && !ret?.conflict) _recordPlayerState(accountId, finalData, { bump: true });
  return ret;
}

async function getPlayerRuntimeStateAsync(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return null;
  if (!isMysqlDriver) return getPlayerRuntimeState(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT
        account_id,
        COALESCE(auto_battle_enabled,
          CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
        ) AS auto_battle_enabled,
        COALESCE(
          auto_battle_map_id,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_map_id')) AS SIGNED),
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
          1
        ) AS auto_battle_map_id,
        COALESCE(
          current_map_id,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
          1
        ) AS current_map_id,
        COALESCE(
          rest_until,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.rest_until')) AS SIGNED),
          0
        ) AS rest_until,
        COALESCE(
          last_activity_at,
          CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.time_state.last_activity_at')) AS SIGNED),
          updated_at,
          0
        ) AS last_activity_at
      FROM players
      WHERE account_id = ?
      LIMIT 1`,
      [aid]
    );
    const row = rows && rows[0];
    if (!row) return null;
    return {
      account_id: aid,
      auto_battle_enabled: _toNullableInt(row.auto_battle_enabled) === 1,
      auto_battle_map_id: Math.max(1, _toNullableInt(row.auto_battle_map_id) || 1),
      current_map_id: Math.max(1, _toNullableInt(row.current_map_id) || 1),
      rest_until: Math.max(0, _toNullableInt(row.rest_until) || 0),
      last_activity_at: Math.max(0, _toNullableInt(row.last_activity_at) || 0)
    };
  } catch (e) {
    console.error('[db] getPlayerRuntimeStateAsync error accountId=%s:', aid, e && e.message);
    throw e;
  }
}

async function updatePlayerAutoBattleIntentAsync(accountId, enabled, mapId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return null;
  if (!isMysqlDriver) return updatePlayerAutoBattleIntent(accountId, enabled, mapId);

  _invalidatePlayerReadCache(aid);
  const state = await getPlayerRuntimeStateAsync(aid);
  if (!state) return null;
  const cached = playerWriteCache.getCached(aid) || null;
  const enabledInt = enabled ? 1 : 0;
  const desiredMapId = Math.max(1, Math.floor(Number(
    mapId
    || cached?.auto_battle_map_id
    || cached?.current_map_id
    || state.auto_battle_map_id
    || state.current_map_id
    || 1
  )));

  playerWriteCache.patchCached(aid, (player) => {
    player.auto_battle_enabled = enabledInt === 1;
    player.auto_battle_map_id = desiredMapId;
    if (!Number.isFinite(Number(player.current_map_id)) || Number(player.current_map_id) <= 0) {
      player.current_map_id = state.current_map_id;
    }
    return player;
  });

  if ((state.auto_battle_enabled ? 1 : 0) !== enabledInt || state.auto_battle_map_id !== desiredMapId) {
    await mysqlAsyncPool.execute(
      `UPDATE players
       SET auto_battle_enabled = ?, auto_battle_map_id = ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ?`,
      [enabledInt, desiredMapId, aid]
    );
  }

  if (enabledInt === 1) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: desiredMapId,
      current_map_id: Math.max(1, Math.floor(Number(cached?.current_map_id || state.current_map_id || 1))),
      rest_until: state.rest_until,
      time_state: { last_activity_at: state.last_activity_at }
    });
  } else {
    autoBattleIndex.removeAccount(aid);
  }

  return {
    ...state,
    auto_battle_enabled: enabledInt === 1,
    auto_battle_map_id: desiredMapId
  };
}

async function updatePlayerRestUntilAsync(accountId, restUntil) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;
  if (!isMysqlDriver) return updatePlayerRestUntil(accountId, restUntil);

  _invalidatePlayerReadCache(aid);
  const desired = Math.max(0, Math.floor(Number(restUntil) || 0));
  const state = await getPlayerRuntimeStateAsync(aid);
  if (!state) return false;

  playerWriteCache.patchCached(aid, (player) => {
    player.rest_until = desired;
    return player;
  });

  if (state.rest_until !== desired) {
    await mysqlAsyncPool.execute(
      `UPDATE players
       SET rest_until = ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ?`,
      [desired, aid]
    );
  }
  if (state.auto_battle_enabled === true) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: state.auto_battle_map_id,
      current_map_id: state.current_map_id,
      rest_until: desired,
      time_state: { last_activity_at: state.last_activity_at }
    });
  }
  return true;
}

async function updatePlayerLastActivityAsync(accountId, lastActivityAt) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return false;
  if (!isMysqlDriver) return updatePlayerLastActivity(accountId, lastActivityAt);

  _invalidatePlayerReadCache(aid);
  const desired = Math.max(0, Math.floor(Number(lastActivityAt) || 0));
  const state = await getPlayerRuntimeStateAsync(aid);
  if (!state) return false;

  playerWriteCache.patchCached(aid, (player) => {
    if (!player.time_state || typeof player.time_state !== 'object' || Array.isArray(player.time_state)) {
      player.time_state = {};
    }
    player.time_state.last_activity_at = desired;
    return player;
  });

  if (state.last_activity_at !== desired) {
    await mysqlAsyncPool.execute(
      `UPDATE players
       SET last_activity_at = ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ?`,
      [desired, aid]
    );
  }

  if (state.auto_battle_enabled === true) {
    autoBattleIndex.upsertFromPlayer(aid, {
      auto_battle_enabled: true,
      auto_battle_map_id: state.auto_battle_map_id,
      current_map_id: state.current_map_id,
      rest_until: state.rest_until,
      time_state: { last_activity_at: desired }
    });
  }
  return true;
}

async function listAllPlayersRawAsync() {
  if (!isMysqlDriver) return listAllPlayersRaw();
  const rows = await mysqlAsyncPool.query(`SELECT account_id, slot, data, ${PLAYER_LARGE_JSON_COLUMNS_SQL} FROM players`);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    account_id: row.account_id,
    slot: row.slot,
    data: _buildFullPlayerDataString(row.data, row)
  }));
}

async function listAutoBattlePlayerRowsAsync(afterAccountId = 0, limit = 300) {
  const after = Math.max(0, Math.trunc(Number(afterAccountId) || 0));
  const lim = Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 300)));
  if (!isMysqlDriver) return listAutoBattlePlayerRows(after, lim);
  return mysqlAsyncPool.query(
    `SELECT
      account_id,
      COALESCE(auto_battle_enabled,
        CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
      ) AS auto_battle_enabled,
      COALESCE(
        auto_battle_map_id,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_map_id')) AS SIGNED),
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
        1
      ) AS auto_battle_map_id,
      COALESCE(
        current_map_id,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.current_map_id')) AS SIGNED),
        1
      ) AS current_map_id,
      COALESCE(
        rest_until,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.rest_until')) AS SIGNED),
        0
      ) AS rest_until,
      COALESCE(
        last_activity_at,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.time_state.last_activity_at')) AS SIGNED),
        updated_at,
        0
      ) AS last_activity_at
    FROM players
    WHERE account_id > ?
      AND COALESCE(auto_battle_enabled,
        CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.auto_battle_enabled')) IN ('true', '1') THEN 1 ELSE 0 END
      ) = 1
    ORDER BY account_id ASC
    LIMIT ?`,
    [after, lim]
  );
}

async function listPendingJobPlayerRowsAsync(afterAccountId = 0, limit = 300) {
  const after = Math.max(0, Math.trunc(Number(afterAccountId) || 0));
  const lim = Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 300)));
  if (!isMysqlDriver) return listPendingJobPlayerRows(after, lim);
  return mysqlAsyncPool.query(
    `SELECT account_id, slot
     FROM players
     WHERE account_id > ?
       AND COALESCE(
         JSON_TYPE(JSON_EXTRACT(baiyi_json, '$.pending_job')),
         JSON_TYPE(JSON_EXTRACT(data, '$.baiyi.pending_job'))
       ) = 'OBJECT'
     ORDER BY account_id ASC
     LIMIT ?`,
    [after, lim]
  );
}

function countPlayersBySect() {
  return db.prepare(`
    SELECT json_extract(data, '$.sect_id') AS sect_id, COUNT(*) AS cnt
    FROM players
    WHERE json_extract(data, '$.sect_id') > 0
    GROUP BY 1
  `).all();
}

function listPlayerBriefAll() {
  return db.prepare(`
    SELECT account_id,
           json_extract(data, '$.name') AS name,
           json_extract(data, '$.level') AS level,
           json_extract(data, '$.sect_id') AS sect_id,
           json_extract(data, '$.duel_rank_score') AS duel_rank_score
    FROM players
  `).all();
}

function listLeagueLeaderboardRows(limit = 500) {
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500)));
  const sql = isMysqlDriver
    ? `SELECT account_id,
              JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) AS name,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.level')) AS UNSIGNED) AS level,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.league_points')) AS SIGNED), 0) AS league_points,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.league_rating')) AS SIGNED), 1000) AS league_rating
       FROM players
       ORDER BY league_points DESC, level DESC, account_id ASC
       LIMIT ?`
    : `SELECT account_id,
              json_extract(data, '$.name') AS name,
              CAST(json_extract(data, '$.level') AS INTEGER) AS level,
              COALESCE(CAST(json_extract(data, '$.league_points') AS INTEGER), 0) AS league_points,
              COALESCE(CAST(json_extract(data, '$.league_rating') AS INTEGER), 1000) AS league_rating
       FROM players
       ORDER BY league_points DESC, level DESC, account_id ASC
       LIMIT ?`;
  return db.prepare(sql).all(lim);
}

function listLeagueTeamRankRows(seasonId = 0, limit = 100, initializedOnly = 0) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const lim = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const onlyInit = Math.max(0, Math.trunc(Number(initializedOnly) || 0)) > 0;
  const whereStatus = onlyInit
    ? "status IN ('active','finished')"
    : "(registered=1 OR status IN ('active','finished'))";
  const membersCountExpr = isMysqlDriver
    ? "CASE WHEN JSON_VALID(members_json) THEN COALESCE(JSON_LENGTH(members_json), 0) ELSE 0 END"
    : "CASE WHEN json_valid(members_json) THEN COALESCE(json_array_length(members_json), 0) ELSE 0 END";
  const sql = `SELECT id, season_id, team_code, name, captain_account_id, status,
                      season_points, wins, draws, losses, rating_seed,
                      members_json, ${membersCountExpr} AS members_count
               FROM league_teams
               WHERE season_id=? AND ${whereStatus}
               ORDER BY season_points DESC, wins DESC, draws DESC, rating_seed DESC, id ASC
               LIMIT ?`;
  return db.prepare(sql).all(sid, lim);
}

function countLeagueTeamRankRows(seasonId = 0, initializedOnly = 0) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const onlyInit = Math.max(0, Math.trunc(Number(initializedOnly) || 0)) > 0;
  const whereStatus = onlyInit
    ? "status IN ('active','finished')"
    : "(registered=1 OR status IN ('active','finished'))";
  const row = db.prepare(`
    SELECT COUNT(1) AS c
    FROM league_teams
    WHERE season_id=? AND ${whereStatus}
  `).get(sid);
  return Math.max(0, Math.trunc(Number(row?.c) || 0));
}

function listLeagueMatchesByTeam(seasonId = 0, teamId = 0, limit = 50) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const tid = Math.max(0, Math.trunc(Number(teamId) || 0));
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  return db.prepare(`
    SELECT * FROM league_matches
    WHERE (team_a_id=? OR team_b_id=?) AND season_id=?
    ORDER BY round_no DESC, match_no DESC
    LIMIT ?
  `).all(tid, tid, sid, lim);
}

function listLeagueTeamsByMemberAccount(seasonId = 0, accountId = 0, limit = 5) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const aid = Math.max(0, Math.trunc(Number(accountId) || 0));
  const lim = Math.max(1, Math.min(20, Math.trunc(Number(limit) || 5)));
  if (sid <= 0 || aid <= 0) return [];

  const orderBy = `
    ORDER BY
      CASE status
        WHEN 'active' THEN 500
        WHEN 'registered' THEN 400
        WHEN 'forming' THEN 300
        WHEN 'finished' THEN 200
        WHEN 'disbanded' THEN 100
        ELSE 0
      END DESC,
      registered DESC,
      id DESC
    LIMIT ?`;

  const sql = isMysqlDriver
    ? `SELECT *
       FROM league_teams
       WHERE season_id=?
         AND (
           JSON_CONTAINS(members_json, JSON_OBJECT('account_id', CAST(? AS UNSIGNED)), '$')
           OR JSON_CONTAINS(frozen_json, JSON_OBJECT('account_id', CAST(? AS UNSIGNED)), '$')
         )
       ${orderBy}`
    : `SELECT *
       FROM league_teams t
       WHERE t.season_id=?
         AND (
           EXISTS (
             SELECT 1
             FROM json_each(t.members_json) je
             WHERE CAST(json_extract(je.value, '$.account_id') AS INTEGER) = ?
           )
           OR EXISTS (
             SELECT 1
             FROM json_each(t.frozen_json) jf
             WHERE CAST(json_extract(jf.value, '$.account_id') AS INTEGER) = ?
           )
         )
       ${orderBy}`;

  try {
    return db.prepare(sql).all(sid, aid, aid, lim);
  } catch (e) {
    console.error('[db] listLeagueTeamsByMemberAccount failed:', e && e.message);
    return [];
  }
}

function listLeagueTeamNamesByIds(seasonId = 0, teamIds = []) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const ids = Array.isArray(teamIds)
    ? teamIds.map((x) => Math.max(0, Math.trunc(Number(x) || 0))).filter((x) => x > 0)
    : [];
  if (sid <= 0 || ids.length <= 0) return [];

  const uniq = [...new Set(ids)].slice(0, 200);
  const placeholders = uniq.map(() => '?').join(',');
  const sql = `
    SELECT id, name
    FROM league_teams
    WHERE season_id=? AND id IN (${placeholders})
  `;
  return db.prepare(sql).all(sid, ...uniq);
}

function isPlayerNameTaken(name) {
  const sql = isMysqlDriver
    ? "SELECT 1 FROM players WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) = ? LIMIT 1"
    : "SELECT 1 FROM players WHERE json_extract(data, '$.name') = ? LIMIT 1";
  const row = db.prepare(sql).get(name);
  return !!row;
}

// ─── P3: 玩家读接口异步实现（MySQL 驱动） ───
async function countPlayersBySectAsync() {
  if (!isMysqlDriver) return countPlayersBySect();
  try {
    return await mysqlAsyncPool.query(
      `SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.sect_id')) AS UNSIGNED) AS sect_id, COUNT(*) AS cnt
       FROM players
       WHERE CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.sect_id')) AS UNSIGNED) > 0
       GROUP BY sect_id`
    );
  } catch (e) {
    console.error('[db] countPlayersBySectAsync failed:', e && e.message);
    throw e;
  }
}

async function listPlayerBriefAllAsync() {
  if (!isMysqlDriver) return listPlayerBriefAll();
  try {
    return await mysqlAsyncPool.query(
      `SELECT account_id,
              JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) AS name,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.level')) AS UNSIGNED) AS level,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.sect_id')) AS UNSIGNED) AS sect_id,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.duel_rank_score')) AS SIGNED) AS duel_rank_score
       FROM players`
    );
  } catch (e) {
    console.error('[db] listPlayerBriefAllAsync failed:', e && e.message);
    throw e;
  }
}

async function listLeagueLeaderboardRowsAsync(limit = 500) {
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500)));
  if (!isMysqlDriver) return listLeagueLeaderboardRows(lim);
  try {
    return await mysqlAsyncPool.query(
      `SELECT account_id,
              JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) AS name,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.level')) AS UNSIGNED) AS level,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.league_points')) AS SIGNED), 0) AS league_points,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.league_rating')) AS SIGNED), 1000) AS league_rating
       FROM players
       ORDER BY league_points DESC, level DESC, account_id ASC
       LIMIT ?`,
      [lim]
    );
  } catch (e) {
    console.error('[db] listLeagueLeaderboardRowsAsync failed:', e && e.message);
    throw e;
  }
}

async function listLeagueTeamRankRowsAsync(seasonId = 0, limit = 100, initializedOnly = 0) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const lim = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const onlyInit = Math.max(0, Math.trunc(Number(initializedOnly) || 0)) > 0;
  if (!isMysqlDriver) return listLeagueTeamRankRows(sid, lim, onlyInit ? 1 : 0);
  const whereStatus = onlyInit
    ? "status IN ('active','finished')"
    : "(registered=1 OR status IN ('active','finished'))";
  try {
    return await mysqlAsyncPool.query(
      `SELECT id, season_id, team_code, name, captain_account_id, status,
              season_points, wins, draws, losses, rating_seed,
              members_json,
              CASE WHEN JSON_VALID(members_json) THEN COALESCE(JSON_LENGTH(members_json), 0) ELSE 0 END AS members_count
       FROM league_teams
       WHERE season_id=? AND ${whereStatus}
       ORDER BY season_points DESC, wins DESC, draws DESC, rating_seed DESC, id ASC
       LIMIT ?`,
      [sid, lim]
    );
  } catch (e) {
    console.error('[db] listLeagueTeamRankRowsAsync failed:', e && e.message);
    throw e;
  }
}

async function countLeagueTeamRankRowsAsync(seasonId = 0, initializedOnly = 0) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const onlyInit = Math.max(0, Math.trunc(Number(initializedOnly) || 0)) > 0;
  if (!isMysqlDriver) return countLeagueTeamRankRows(sid, onlyInit ? 1 : 0);
  const whereStatus = onlyInit
    ? "status IN ('active','finished')"
    : "(registered=1 OR status IN ('active','finished'))";
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT COUNT(1) AS c FROM league_teams WHERE season_id=? AND ${whereStatus}`,
      [sid]
    );
    return Math.max(0, Math.trunc(Number(rows?.[0]?.c) || 0));
  } catch (e) {
    console.error('[db] countLeagueTeamRankRowsAsync failed:', e && e.message);
    throw e;
  }
}

async function listLeagueMatchesByTeamAsync(seasonId = 0, teamId = 0, limit = 50) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const tid = Math.max(0, Math.trunc(Number(teamId) || 0));
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  if (!isMysqlDriver) return listLeagueMatchesByTeam(sid, tid, lim);
  try {
    return await mysqlAsyncPool.query(
      `SELECT * FROM league_matches
       WHERE (team_a_id=? OR team_b_id=?) AND season_id=?
       ORDER BY round_no DESC, match_no DESC
       LIMIT ?`,
      [tid, tid, sid, lim]
    );
  } catch (e) {
    console.error('[db] listLeagueMatchesByTeamAsync failed:', e && e.message);
    throw e;
  }
}

async function listLeagueTeamsByMemberAccountAsync(seasonId = 0, accountId = 0, limit = 5) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const aid = Math.max(0, Math.trunc(Number(accountId) || 0));
  const lim = Math.max(1, Math.min(20, Math.trunc(Number(limit) || 5)));
  if (sid <= 0 || aid <= 0) return [];
  if (!isMysqlDriver) return listLeagueTeamsByMemberAccount(sid, aid, lim);

  try {
    return await mysqlAsyncPool.query(
      `SELECT *
       FROM league_teams
       WHERE season_id=?
         AND (
           JSON_CONTAINS(members_json, JSON_OBJECT('account_id', CAST(? AS UNSIGNED)), '$')
           OR JSON_CONTAINS(frozen_json, JSON_OBJECT('account_id', CAST(? AS UNSIGNED)), '$')
         )
       ORDER BY
         CASE status
           WHEN 'active' THEN 500
           WHEN 'registered' THEN 400
           WHEN 'forming' THEN 300
           WHEN 'finished' THEN 200
           WHEN 'disbanded' THEN 100
           ELSE 0
         END DESC,
         registered DESC,
         id DESC
       LIMIT ?`,
      [sid, aid, aid, lim]
    );
  } catch (e) {
    console.error('[db] listLeagueTeamsByMemberAccountAsync failed:', e && e.message);
    throw e;
  }
}

async function listLeagueTeamNamesByIdsAsync(seasonId = 0, teamIds = []) {
  const sid = Math.max(0, Math.trunc(Number(seasonId) || 0));
  const ids = Array.isArray(teamIds)
    ? teamIds.map((x) => Math.max(0, Math.trunc(Number(x) || 0))).filter((x) => x > 0)
    : [];
  if (sid <= 0 || ids.length <= 0) return [];
  const uniq = [...new Set(ids)].slice(0, 200);
  if (!isMysqlDriver) return listLeagueTeamNamesByIds(sid, uniq);

  try {
    const placeholders = uniq.map(() => '?').join(',');
    return await mysqlAsyncPool.query(
      `SELECT id, name
       FROM league_teams
       WHERE season_id=? AND id IN (${placeholders})`,
      [sid, ...uniq]
    );
  } catch (e) {
    console.error('[db] listLeagueTeamNamesByIdsAsync failed:', e && e.message);
    throw e;
  }
}

async function isPlayerNameTakenAsync(name) {
  if (!isMysqlDriver) return isPlayerNameTaken(name);
  try {
    const rows = await mysqlAsyncPool.query(
      "SELECT 1 FROM players WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) = ? LIMIT 1",
      [String(name || '')]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error('[db] isPlayerNameTakenAsync failed name=%s:', name, e && e.message);
    throw e;
  }
}

// 战斗会话
function createBattleSession(id, accountId, mapId, enemyId, ttlSeconds = 300, state = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + ttlSeconds;
  const rngSeed = Math.floor(Math.random() * 2147483647);
  const stateJson = JSON.stringify(state || {});
  db.prepare(`
    INSERT OR REPLACE INTO battle_sessions
      (id, account_id, map_id, enemy_id, started_at, expires_at, status, state_json, last_seq, result_json, ended_at, last_cmd_at, rng_seed, rng_cursor)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, '{}', 0, ?, ?, 0)
  `).run(id, accountId, mapId, enemyId || null, now, expires, stateJson, now, rngSeed);
}

function _parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text || '');
  } catch (_) {
    return fallback;
  }
}

function _parseBattleSessionRow(row) {
  if (!row) return null;
  return {
    ...row,
    state: _parseJsonSafe(row.state_json, {}),
    result: _parseJsonSafe(row.result_json, {})
  };
}

function getBattleSession(id) {
  const row = db.prepare(`SELECT * FROM battle_sessions WHERE id = ? AND expires_at > strftime('%s','now')`).get(id);
  return _parseBattleSessionRow(row);
}

function getActiveBattleSessionByAccount(accountId) {
  const row = db.prepare(`
    SELECT * FROM battle_sessions
    WHERE account_id = ?
      AND status = 'active'
      AND expires_at > strftime('%s','now')
    ORDER BY started_at DESC
    LIMIT 1
  `).get(Number(accountId));
  return _parseBattleSessionRow(row);
}

function updateBattleSessionState(id, {
  state = null,
  lastSeq = null,
  status = null,
  result = null,
  endedAt = null,
  lastCmdAt = null,
  expiresAt = null,
  rngCursor = null
} = {}) {
  const fields = [];
  const args = [];
  if (state !== null) {
    fields.push('state_json = ?');
    args.push(JSON.stringify(state || {}));
  }
  if (lastSeq !== null) {
    fields.push('last_seq = ?');
    args.push(Math.max(0, Number(lastSeq) || 0));
  }
  if (status !== null) {
    fields.push('status = ?');
    args.push(String(status));
  }
  if (result !== null) {
    fields.push('result_json = ?');
    args.push(JSON.stringify(result || {}));
  }
  if (endedAt !== null) {
    fields.push('ended_at = ?');
    args.push(Math.max(0, Number(endedAt) || 0));
  }
  if (lastCmdAt !== null) {
    fields.push('last_cmd_at = ?');
    args.push(Math.max(0, Number(lastCmdAt) || 0));
  }
  if (expiresAt !== null) {
    fields.push('expires_at = ?');
    args.push(Math.max(0, Number(expiresAt) || 0));
  }
  if (rngCursor !== null) {
    fields.push('rng_cursor = ?');
    args.push(Math.max(0, Number(rngCursor) || 0));
  }
  if (fields.length <= 0) return { changes: 0 };
  args.push(id);
  return db.prepare(`UPDATE battle_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...args);
}

function appendBattleCommand(battleId, seq, command, applyResult = {}) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    INSERT OR REPLACE INTO battle_commands (battle_id, seq, command_json, apply_result_json, recv_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(battleId),
    Math.max(0, Number(seq) || 0),
    JSON.stringify(command || {}),
    JSON.stringify(applyResult || {}),
    now
  );
}

function getBattleCommand(battleId, seq) {
  const row = db.prepare(`
    SELECT * FROM battle_commands WHERE battle_id = ? AND seq = ?
  `).get(String(battleId), Math.max(0, Number(seq) || 0));
  if (!row) return null;
  return {
    ...row,
    command: _parseJsonSafe(row.command_json, {}),
    apply_result: _parseJsonSafe(row.apply_result_json, {})
  };
}

function appendBattleEvents(battleId, startIndex, events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length <= 0) return 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO battle_events (battle_id, event_index, event_json, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  for (let i = 0; i < list.length; i += 1) {
    const idx = Math.max(1, Number(startIndex) || 1) + i;
    stmt.run(String(battleId), idx, JSON.stringify(list[i] || {}), now);
    n += 1;
  }
  return n;
}

function listBattleEventsSince(battleId, afterIndex = 0, limit = 120) {
  const rows = db.prepare(`
    SELECT * FROM battle_events
    WHERE battle_id = ? AND event_index > ?
    ORDER BY event_index ASC
    LIMIT ?
  `).all(String(battleId), Math.max(0, Number(afterIndex) || 0), Math.max(1, Math.min(500, Number(limit) || 120)));
  return rows.map((r) => ({
    ...r,
    event: _parseJsonSafe(r.event_json, {})
  }));
}

const _finishBattleSessionTx = db.transaction((id, result, now) => {
  db.prepare(`
    UPDATE battle_sessions
    SET status = 'finished',
        result_json = ?,
        ended_at = ?,
        last_cmd_at = ?,
        expires_at = ?
    WHERE id = ? AND status = 'active'
  `).run(JSON.stringify(result || {}), now, now, now + 120, String(id));
  return db.prepare(`SELECT * FROM battle_sessions WHERE id = ?`).get(String(id));
});

function finishBattleSession(id, result = {}) {
  const now = Math.floor(Date.now() / 1000);
  const row = _finishBattleSessionTx(id, result, now);
  return _parseBattleSessionRow(row);
}

function deleteBattleSession(id) {
  const sid = String(id || '');
  db.prepare('DELETE FROM battle_sessions WHERE id = ?').run(sid);
  db.prepare('DELETE FROM battle_commands WHERE battle_id = ?').run(sid);
  db.prepare('DELETE FROM battle_events WHERE battle_id = ?').run(sid);
}

// ─── P3: 战斗会话异步实现（MySQL 驱动） ───
async function createBattleSessionAsync(id, accountId, mapId, enemyId, ttlSeconds = 300, state = {}) {
  if (!isMysqlDriver) return createBattleSession(id, accountId, mapId, enemyId, ttlSeconds, state);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + ttlSeconds;
  const rngSeed = Math.floor(Math.random() * 2147483647);
  const stateJson = JSON.stringify(state || {});
  try {
    await mysqlAsyncPool.execute(
      `INSERT INTO battle_sessions
        (id, account_id, map_id, enemy_id, started_at, expires_at, status, state_json, last_seq, result_json, ended_at, last_cmd_at, rng_seed, rng_cursor)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, '{}', 0, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         map_id = VALUES(map_id),
         enemy_id = VALUES(enemy_id),
         started_at = VALUES(started_at),
         expires_at = VALUES(expires_at),
         status = VALUES(status),
         state_json = VALUES(state_json),
         last_seq = VALUES(last_seq),
         result_json = VALUES(result_json),
         ended_at = VALUES(ended_at),
         last_cmd_at = VALUES(last_cmd_at),
         rng_seed = VALUES(rng_seed),
         rng_cursor = VALUES(rng_cursor)`,
      [String(id), Number(accountId), mapId || null, enemyId || null, now, expires, stateJson, now, rngSeed]
    );
  } catch (e) {
    console.error('[db] createBattleSessionAsync error id=%s:', id, e && e.message);
    createBattleSession(id, accountId, mapId, enemyId, ttlSeconds, state);
  }
}

async function getBattleSessionAsync(id) {
  if (!isMysqlDriver) return getBattleSession(id);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM battle_sessions WHERE id = ? AND expires_at > UNIX_TIMESTAMP() LIMIT 1',
      [String(id)]
    );
    return _parseBattleSessionRow(rows && rows[0]);
  } catch (e) {
    console.error('[db] getBattleSessionAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function getActiveBattleSessionByAccountAsync(accountId) {
  if (!isMysqlDriver) return getActiveBattleSessionByAccount(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT * FROM battle_sessions
       WHERE account_id = ?
         AND status = 'active'
         AND expires_at > UNIX_TIMESTAMP()
       ORDER BY started_at DESC
       LIMIT 1`,
      [Number(accountId)]
    );
    return _parseBattleSessionRow(rows && rows[0]);
  } catch (e) {
    console.error('[db] getActiveBattleSessionByAccountAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function updateBattleSessionStateAsync(id, {
  state = null,
  lastSeq = null,
  status = null,
  result = null,
  endedAt = null,
  lastCmdAt = null,
  expiresAt = null,
  rngCursor = null
} = {}) {
  if (!isMysqlDriver) {
    return updateBattleSessionState(id, { state, lastSeq, status, result, endedAt, lastCmdAt, expiresAt, rngCursor });
  }
  const fields = [];
  const args = [];
  if (state !== null) {
    fields.push('state_json = ?');
    args.push(JSON.stringify(state || {}));
  }
  if (lastSeq !== null) {
    fields.push('last_seq = ?');
    args.push(Math.max(0, Number(lastSeq) || 0));
  }
  if (status !== null) {
    fields.push('status = ?');
    args.push(String(status));
  }
  if (result !== null) {
    fields.push('result_json = ?');
    args.push(JSON.stringify(result || {}));
  }
  if (endedAt !== null) {
    fields.push('ended_at = ?');
    args.push(Math.max(0, Number(endedAt) || 0));
  }
  if (lastCmdAt !== null) {
    fields.push('last_cmd_at = ?');
    args.push(Math.max(0, Number(lastCmdAt) || 0));
  }
  if (expiresAt !== null) {
    fields.push('expires_at = ?');
    args.push(Math.max(0, Number(expiresAt) || 0));
  }
  if (rngCursor !== null) {
    fields.push('rng_cursor = ?');
    args.push(Math.max(0, Number(rngCursor) || 0));
  }
  if (fields.length <= 0) return { changes: 0 };
  args.push(String(id));
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE battle_sessions SET ${fields.join(', ')} WHERE id = ?`,
      args
    );
    return { changes: Number(ret && ret.affectedRows) || 0 };
  } catch (e) {
    console.error('[db] updateBattleSessionStateAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function appendBattleCommandAsync(battleId, seq, command, applyResult = {}) {
  if (!isMysqlDriver) return appendBattleCommand(battleId, seq, command, applyResult);
  const now = Math.floor(Date.now() / 1000);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO battle_commands (battle_id, seq, command_json, apply_result_json, recv_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         command_json = VALUES(command_json),
         apply_result_json = VALUES(apply_result_json),
         recv_at = VALUES(recv_at)`,
      [String(battleId), Math.max(0, Number(seq) || 0), JSON.stringify(command || {}), JSON.stringify(applyResult || {}), now]
    );
    return { changes: Number(ret && ret.affectedRows) || 0 };
  } catch (e) {
    console.error('[db] appendBattleCommandAsync error battleId=%s seq=%s:', battleId, seq, e && e.message);
    throw e;
  }
}

async function getBattleCommandAsync(battleId, seq) {
  if (!isMysqlDriver) return getBattleCommand(battleId, seq);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM battle_commands WHERE battle_id = ? AND seq = ? LIMIT 1',
      [String(battleId), Math.max(0, Number(seq) || 0)]
    );
    const row = rows && rows[0];
    if (!row) return null;
    return {
      ...row,
      command: _parseJsonSafe(row.command_json, {}),
      apply_result: _parseJsonSafe(row.apply_result_json, {})
    };
  } catch (e) {
    console.error('[db] getBattleCommandAsync error battleId=%s seq=%s:', battleId, seq, e && e.message);
    throw e;
  }
}

async function appendBattleEventsAsync(battleId, startIndex, events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length <= 0) return 0;
  if (!isMysqlDriver) return appendBattleEvents(battleId, startIndex, events);
  const now = Math.floor(Date.now() / 1000);
  const baseIndex = Math.max(1, Number(startIndex) || 1);
  try {
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) throw new Error('MySQL pool unavailable for appendBattleEventsAsync');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < list.length; i += 1) {
        const idx = baseIndex + i;
        await conn.execute(
          `INSERT INTO battle_events (battle_id, event_index, event_json, created_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             event_json = VALUES(event_json),
             created_at = VALUES(created_at)`,
          [String(battleId), idx, JSON.stringify(list[i] || {}), now]
        );
      }
      await conn.commit();
      return list.length;
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] appendBattleEventsAsync error battleId=%s:', battleId, e && e.message);
    throw e;
  }
}

async function listBattleEventsSinceAsync(battleId, afterIndex = 0, limit = 120) {
  if (!isMysqlDriver) return listBattleEventsSince(battleId, afterIndex, limit);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT * FROM battle_events
       WHERE battle_id = ? AND event_index > ?
       ORDER BY event_index ASC
       LIMIT ?`,
      [String(battleId), Math.max(0, Number(afterIndex) || 0), Math.max(1, Math.min(500, Number(limit) || 120))]
    );
    return (rows || []).map((r) => ({
      ...r,
      event: _parseJsonSafe(r.event_json, {})
    }));
  } catch (e) {
    console.error('[db] listBattleEventsSinceAsync error battleId=%s:', battleId, e && e.message);
    throw e;
  }
}

async function finishBattleSessionAsync(id, result = {}) {
  if (!isMysqlDriver) return finishBattleSession(id, result);
  const now = Math.floor(Date.now() / 1000);
  const sid = String(id || '');
  try {
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) throw new Error('MySQL pool unavailable for finishBattleSessionAsync');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE battle_sessions
         SET status = 'finished',
             result_json = ?,
             ended_at = ?,
             last_cmd_at = ?,
             expires_at = ?
         WHERE id = ? AND status = 'active'`,
        [JSON.stringify(result || {}), now, now, now + 120, sid]
      );
      const [rows] = await conn.query('SELECT * FROM battle_sessions WHERE id = ? LIMIT 1', [sid]);
      await conn.commit();
      return _parseBattleSessionRow(rows && rows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] finishBattleSessionAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function deleteBattleSessionAsync(id) {
  if (!isMysqlDriver) return deleteBattleSession(id);
  const sid = String(id || '');
  try {
    await mysqlAsyncPool.execute('DELETE FROM battle_sessions WHERE id = ?', [sid]);
    await mysqlAsyncPool.execute('DELETE FROM battle_commands WHERE battle_id = ?', [sid]);
    await mysqlAsyncPool.execute('DELETE FROM battle_events WHERE battle_id = ?', [sid]);
  } catch (e) {
    console.error('[db] deleteBattleSessionAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

// 清理过期会话
function cleanupExpiredSessions() {
  const rows = db.prepare(`SELECT id FROM battle_sessions WHERE expires_at <= strftime('%s','now')`).all();
  if (!Array.isArray(rows) || rows.length <= 0) return;
  const delSession = db.prepare(`DELETE FROM battle_sessions WHERE id = ?`);
  const delCmd = db.prepare(`DELETE FROM battle_commands WHERE battle_id = ?`);
  const delEvt = db.prepare(`DELETE FROM battle_events WHERE battle_id = ?`);
  const tx = db.transaction((items) => {
    for (const r of items) {
      const id = String(r.id || '');
      if (!id) continue;
      delSession.run(id);
      delCmd.run(id);
      delEvt.run(id);
    }
  });
  tx(rows);
}

async function cleanupExpiredSessionsAsync() {
  if (!isMysqlDriver) {
    cleanupExpiredSessions();
    return;
  }
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT id FROM battle_sessions WHERE expires_at <= UNIX_TIMESTAMP() LIMIT 2000'
    );
    if (!Array.isArray(rows) || rows.length <= 0) return;
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) return;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        const sid = String(r && r.id ? r.id : '');
        if (!sid) continue;
        await conn.execute('DELETE FROM battle_sessions WHERE id = ?', [sid]);
        await conn.execute('DELETE FROM battle_commands WHERE battle_id = ?', [sid]);
        await conn.execute('DELETE FROM battle_events WHERE battle_id = ?', [sid]);
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] cleanupExpiredSessionsAsync failed:', e && e.message);
  }
}

setInterval(() => {
  if (isMysqlDriver) {
    cleanupExpiredSessionsAsync().catch((e) => {
      console.error('[db] cleanupExpiredSessions timer failed:', e?.message || e);
    });
    return;
  }
  try {
    cleanupExpiredSessions();
  } catch (e) {
    console.error('[db] cleanupExpiredSessions failed:', e?.message || e);
  }
}, 60000);

// 副本每日完成次数（按自然日，东八区）
function getDateKey() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 480);  // 粗略东八区
  return d.toISOString().slice(0, 10);
}

function getDungeonCompletionsToday(accountId, dungeonId) {
  const row = db.prepare('SELECT completions FROM dungeon_completions WHERE account_id=? AND dungeon_id=? AND date=?')
    .get(accountId, dungeonId, getDateKey());
  return row ? row.completions : 0;
}

const _incrementDungeonCompletionsTx = db.transaction((accountId, dungeonId, key) => {
  const row = db.prepare('SELECT completions FROM dungeon_completions WHERE account_id=? AND dungeon_id=? AND date=?')
    .get(accountId, dungeonId, key);
  if (row) {
    db.prepare('UPDATE dungeon_completions SET completions=completions+1 WHERE account_id=? AND dungeon_id=? AND date=?')
      .run(accountId, dungeonId, key);
    return row.completions + 1;
  }
  db.prepare('INSERT INTO dungeon_completions (account_id, dungeon_id, date, completions) VALUES (?, ?, ?, 1)')
    .run(accountId, dungeonId, key);
  return 1;
});

function incrementDungeonCompletions(accountId, dungeonId) {
  return _incrementDungeonCompletionsTx(accountId, dungeonId, getDateKey());
}

function getSectTaskCompletionsToday(accountId) {
  const row = db.prepare('SELECT completions FROM sect_task_completions WHERE account_id=? AND date=?')
    .get(accountId, getDateKey());
  return row ? row.completions : 0;
}

const _incrementSectTaskCompletionsTx = db.transaction((accountId, key) => {
  const row = db.prepare('SELECT completions FROM sect_task_completions WHERE account_id=? AND date=?')
    .get(accountId, key);
  if (row) {
    db.prepare('UPDATE sect_task_completions SET completions=completions+1 WHERE account_id=? AND date=?')
      .run(accountId, key);
    return row.completions + 1;
  }
  db.prepare('INSERT INTO sect_task_completions (account_id, date, completions) VALUES (?, ?, 1)')
    .run(accountId, key);
  return 1;
});

function incrementSectTaskCompletions(accountId) {
  return _incrementSectTaskCompletionsTx(accountId, getDateKey());
}

async function getDungeonCompletionsTodayAsync(accountId, dungeonId) {
  if (!isMysqlDriver) return getDungeonCompletionsToday(accountId, dungeonId);
  try {
    const key = getDateKey();
    const rows = await mysqlAsyncPool.query(
      'SELECT completions FROM dungeon_completions WHERE account_id = ? AND dungeon_id = ? AND date = ? LIMIT 1',
      [Number(accountId), Number(dungeonId), key]
    );
    return Number(rows?.[0]?.completions || 0);
  } catch (e) {
    console.error('[db] getDungeonCompletionsTodayAsync failed accountId=%s dungeonId=%s:', accountId, dungeonId, e && e.message);
    throw e;
  }
}

async function incrementDungeonCompletionsAsync(accountId, dungeonId) {
  if (!isMysqlDriver) return incrementDungeonCompletions(accountId, dungeonId);
  const aid = Number(accountId);
  const did = Number(dungeonId);
  const key = getDateKey();
  try {
    await mysqlAsyncPool.execute(
      `INSERT INTO dungeon_completions (account_id, dungeon_id, date, completions)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE completions = completions + 1`,
      [aid, did, key]
    );
    const rows = await mysqlAsyncPool.query(
      'SELECT completions FROM dungeon_completions WHERE account_id = ? AND dungeon_id = ? AND date = ? LIMIT 1',
      [aid, did, key]
    );
    return Number(rows?.[0]?.completions || 0);
  } catch (e) {
    console.error('[db] incrementDungeonCompletionsAsync failed accountId=%s dungeonId=%s:', accountId, dungeonId, e && e.message);
    throw e;
  }
}

async function getSectTaskCompletionsTodayAsync(accountId) {
  if (!isMysqlDriver) return getSectTaskCompletionsToday(accountId);
  try {
    const key = getDateKey();
    const rows = await mysqlAsyncPool.query(
      'SELECT completions FROM sect_task_completions WHERE account_id = ? AND date = ? LIMIT 1',
      [Number(accountId), key]
    );
    return Number(rows?.[0]?.completions || 0);
  } catch (e) {
    console.error('[db] getSectTaskCompletionsTodayAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function incrementSectTaskCompletionsAsync(accountId) {
  if (!isMysqlDriver) return incrementSectTaskCompletions(accountId);
  const aid = Number(accountId);
  const key = getDateKey();
  try {
    await mysqlAsyncPool.execute(
      `INSERT INTO sect_task_completions (account_id, date, completions)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE completions = completions + 1`,
      [aid, key]
    );
    const rows = await mysqlAsyncPool.query(
      'SELECT completions FROM sect_task_completions WHERE account_id = ? AND date = ? LIMIT 1',
      [aid, key]
    );
    return Number(rows?.[0]?.completions || 0);
  } catch (e) {
    console.error('[db] incrementSectTaskCompletionsAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

// 副本战斗状态持久化
function saveDungeonBattle(battleId, accountId, dungeonId, state) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR REPLACE INTO dungeon_battle_sessions (id, account_id, dungeon_id, state_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(battleId), Number(accountId), Number(dungeonId), JSON.stringify(state || {}), now);
}

function getDungeonBattle(battleId) {
  const row = db.prepare('SELECT * FROM dungeon_battle_sessions WHERE id=?').get(String(battleId || ''));
  if (!row) return null;
  let state = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch (_) {}
  return {
    id: row.id,
    account_id: row.account_id,
    dungeon_id: row.dungeon_id,
    state,
    created_at: row.created_at
  };
}

function deleteDungeonBattle(battleId) {
  db.prepare('DELETE FROM dungeon_battle_sessions WHERE id=?').run(String(battleId || ''));
}

function countActiveDungeonBattles(accountId) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM dungeon_battle_sessions WHERE account_id=?').get(Number(accountId));
  return row ? row.cnt : 0;
}

function deleteAllDungeonBattlesForAccount(accountId) {
  db.prepare('DELETE FROM dungeon_battle_sessions WHERE account_id=?').run(Number(accountId));
}

function cleanupExpiredDungeonBattles() {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  db.prepare('DELETE FROM dungeon_battle_sessions WHERE created_at < ?').run(cutoff);
}

// ─── P3: 副本战斗状态异步实现（MySQL 驱动） ───
async function saveDungeonBattleAsync(battleId, accountId, dungeonId, state) {
  if (!isMysqlDriver) return saveDungeonBattle(battleId, accountId, dungeonId, state);
  const now = Math.floor(Date.now() / 1000);
  try {
    await mysqlAsyncPool.execute(
      `INSERT INTO dungeon_battle_sessions (id, account_id, dungeon_id, state_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         dungeon_id = VALUES(dungeon_id),
         state_json = VALUES(state_json),
         created_at = VALUES(created_at)`,
      [String(battleId), Number(accountId), Number(dungeonId), JSON.stringify(state || {}), now]
    );
  } catch (e) {
    console.error('[db] saveDungeonBattleAsync error battleId=%s:', battleId, e && e.message);
    throw e;
  }
}

async function getDungeonBattleAsync(battleId) {
  if (!isMysqlDriver) return getDungeonBattle(battleId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM dungeon_battle_sessions WHERE id=? LIMIT 1',
      [String(battleId || '')]
    );
    const row = rows && rows[0];
    if (!row) return null;
    let state = {};
    try { state = JSON.parse(row.state_json || '{}'); } catch (_) {}
    return {
      id: row.id,
      account_id: row.account_id,
      dungeon_id: row.dungeon_id,
      state,
      created_at: row.created_at
    };
  } catch (e) {
    console.error('[db] getDungeonBattleAsync error battleId=%s:', battleId, e && e.message);
    throw e;
  }
}

async function deleteDungeonBattleAsync(battleId) {
  if (!isMysqlDriver) return deleteDungeonBattle(battleId);
  try {
    await mysqlAsyncPool.execute('DELETE FROM dungeon_battle_sessions WHERE id=?', [String(battleId || '')]);
  } catch (e) {
    console.error('[db] deleteDungeonBattleAsync error battleId=%s:', battleId, e && e.message);
    throw e;
  }
}

async function countActiveDungeonBattlesAsync(accountId) {
  if (!isMysqlDriver) return countActiveDungeonBattles(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT COUNT(*) as cnt FROM dungeon_battle_sessions WHERE account_id=?',
      [Number(accountId)]
    );
    const row = rows && rows[0];
    return row ? (Number(row.cnt) || 0) : 0;
  } catch (e) {
    console.error('[db] countActiveDungeonBattlesAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function deleteAllDungeonBattlesForAccountAsync(accountId) {
  if (!isMysqlDriver) return deleteAllDungeonBattlesForAccount(accountId);
  try {
    await mysqlAsyncPool.execute('DELETE FROM dungeon_battle_sessions WHERE account_id=?', [Number(accountId)]);
  } catch (e) {
    console.error('[db] deleteAllDungeonBattlesForAccountAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function cleanupExpiredDungeonBattlesAsync() {
  if (!isMysqlDriver) return cleanupExpiredDungeonBattles();
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  try {
    await mysqlAsyncPool.execute('DELETE FROM dungeon_battle_sessions WHERE created_at < ?', [cutoff]);
  } catch (e) {
    console.error('[db] cleanupExpiredDungeonBattlesAsync error:', e && e.message);
    throw e;
  }
}

// 生成 6 位队伍码
function generateTeamCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createDungeonTeam(leaderAccountId, dungeonId, ttlSeconds = 1800) {
  const code = generateTeamCode();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + ttlSeconds;
  db.prepare('INSERT INTO dungeon_teams (team_code, leader_account_id, dungeon_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(code, leaderAccountId, dungeonId || 0, expires);
  db.prepare('INSERT OR REPLACE INTO dungeon_team_members (team_code, account_id) VALUES (?, ?)')
    .run(code, leaderAccountId);
  return code;
}

function touchDungeonTeam(teamCode) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE dungeon_teams SET expires_at = ? WHERE team_code = ?').run(now + 1800, teamCode);
}

const DUNGEON_TEAM_MAX = 3;

function _pickDungeonTeamMemberRows(rows, leaderAccountId) {
  const all = Array.isArray(rows) ? rows : [];
  if (all.length <= DUNGEON_TEAM_MAX) return all;
  const leaderId = Number(leaderAccountId) || 0;
  const picked = [];
  const used = new Set();
  if (leaderId > 0) {
    const leaderRow = all.find((r) => Number(r?.account_id) === leaderId);
    if (leaderRow) {
      picked.push(leaderRow);
      used.add(leaderId);
    }
  }
  for (const row of all) {
    const aid = Number(row?.account_id) || 0;
    if (aid <= 0 || used.has(aid)) continue;
    picked.push(row);
    used.add(aid);
    if (picked.length >= DUNGEON_TEAM_MAX) break;
  }
  return picked;
}

function _trimDungeonTeamMembersToMax(teamCode, leaderAccountId) {
  const code = String(teamCode || '').toUpperCase().trim();
  if (!code) return;
  const rows = db.prepare('SELECT account_id, joined_at FROM dungeon_team_members WHERE team_code=? ORDER BY joined_at ASC, account_id ASC').all(code);
  if (rows.length <= DUNGEON_TEAM_MAX) return;
  const keepRows = _pickDungeonTeamMemberRows(rows, leaderAccountId);
  const keepSet = new Set(keepRows.map((r) => Number(r?.account_id) || 0).filter((v) => v > 0));
  for (const row of rows) {
    const aid = Number(row?.account_id) || 0;
    if (aid <= 0 || keepSet.has(aid)) continue;
    db.prepare('DELETE FROM dungeon_team_members WHERE team_code=? AND account_id=?').run(code, aid);
  }
}

const _joinDungeonTeamTx = db.transaction((teamCode, accountId) => {
  const code = String(teamCode || '').toUpperCase().trim();
  const aid = Number(accountId) || 0;
  if (!code || aid <= 0) return { ok: false, error: '参数错误' };

  const team = db.prepare(`SELECT * FROM dungeon_teams WHERE team_code=? AND expires_at > strftime('%s','now')`).get(code);
  if (!team) return { ok: false, error: '队伍不存在或已过期' };

  _trimDungeonTeamMembersToMax(code, team.leader_account_id);

  const members = db.prepare('SELECT account_id FROM dungeon_team_members WHERE team_code=? ORDER BY joined_at ASC, account_id ASC').all(code);
  const alreadyIn = members.some(m => Number(m.account_id) === aid);
  if (!alreadyIn && members.length >= DUNGEON_TEAM_MAX) {
    return { ok: false, error: '队伍已满（最多3人）' };
  }

  db.prepare('INSERT OR REPLACE INTO dungeon_team_members (team_code, account_id) VALUES (?, ?)').run(code, aid);
  touchDungeonTeam(code);
  return { ok: true, dungeonId: team.dungeon_id };
});

function joinDungeonTeam(teamCode, accountId) {
  try {
    // 使用 IMMEDIATE 事务，先拿写锁再检查人数，避免并发下越过 3 人上限。
    const runTx = (typeof _joinDungeonTeamTx.immediate === 'function')
      ? _joinDungeonTeamTx.immediate
      : _joinDungeonTeamTx;
    return runTx(teamCode, accountId);
  } catch (err) {
    console.warn('[dungeon.team.join] transaction failed:', err?.message || err);
    return { ok: false, error: '队伍繁忙，请稍后重试' };
  }
}

function getDungeonTeam(teamCode) {
  const code = String(teamCode || '').toUpperCase().trim();
  const team = db.prepare(`SELECT * FROM dungeon_teams WHERE team_code=? AND expires_at > strftime('%s','now')`).get(code);
  if (!team) return null;
  _trimDungeonTeamMembersToMax(code, team.leader_account_id);
  const members = db.prepare('SELECT account_id, joined_at FROM dungeon_team_members WHERE team_code=? ORDER BY joined_at ASC, account_id ASC').all(code);
  const limitedMembers = _pickDungeonTeamMemberRows(members, team.leader_account_id);
  return { ...team, members: limitedMembers.map(m => Number(m.account_id) || 0).filter(v => v > 0) };
}

function leaveDungeonTeam(teamCode, accountId) {
  db.prepare('DELETE FROM dungeon_team_members WHERE team_code=? AND account_id=?').run(teamCode, accountId);
  touchDungeonTeam(teamCode);
}

function getMyDungeonTeam(accountId) {
  const row = db.prepare('SELECT team_code FROM dungeon_team_members WHERE account_id = ?').get(accountId);
  if (!row) return null;
  return getDungeonTeam(row.team_code);
}

async function createDungeonTeamAsync(leaderAccountId, dungeonId, ttlSeconds = 1800) {
  if (!isMysqlDriver) return createDungeonTeam(leaderAccountId, dungeonId, ttlSeconds);
  const leaderId = Number(leaderAccountId) || 0;
  const did = Number(dungeonId) || 0;
  const ttl = Math.max(60, Math.floor(Number(ttlSeconds) || 1800));
  try {
    for (let i = 0; i < 12; i += 1) {
      const code = generateTeamCode();
      try {
        await mysqlAsyncPool.execute(
          `INSERT INTO dungeon_teams (team_code, leader_account_id, dungeon_id, expires_at)
           VALUES (?, ?, ?, UNIX_TIMESTAMP() + ?)`,
          [code, leaderId, did, ttl]
        );
        await mysqlAsyncPool.execute(
          `INSERT INTO dungeon_team_members (team_code, account_id, joined_at)
           VALUES (?, ?, UNIX_TIMESTAMP())
           ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
          [code, leaderId]
        );
        return code;
      } catch (e) {
        if (String(e?.code || '') !== 'ER_DUP_ENTRY') throw e;
      }
    }
    throw new Error('failed to allocate dungeon team code');
  } catch (e) {
    console.error('[db] createDungeonTeamAsync failed leader=%s:', leaderAccountId, e && e.message);
    throw e;
  }
}

async function touchDungeonTeamAsync(teamCode) {
  if (!isMysqlDriver) return touchDungeonTeam(teamCode);
  const code = String(teamCode || '').toUpperCase().trim();
  if (!code) return;
  try {
    await mysqlAsyncPool.execute(
      'UPDATE dungeon_teams SET expires_at = UNIX_TIMESTAMP() + 1800 WHERE team_code = ?',
      [code]
    );
  } catch (e) {
    console.error('[db] touchDungeonTeamAsync failed teamCode=%s:', teamCode, e && e.message);
    throw e;
  }
}

async function _trimDungeonTeamMembersToMaxAsync(teamCode, leaderAccountId, conn = null) {
  const code = String(teamCode || '').toUpperCase().trim();
  if (!code) return;
  const queryRows = async () => {
    if (conn) {
      const [rows] = await conn.query(
        'SELECT account_id, joined_at FROM dungeon_team_members WHERE team_code=? ORDER BY joined_at ASC, account_id ASC',
        [code]
      );
      return rows || [];
    }
    return await mysqlAsyncPool.query(
      'SELECT account_id, joined_at FROM dungeon_team_members WHERE team_code=? ORDER BY joined_at ASC, account_id ASC',
      [code]
    );
  };
  const rows = await queryRows();
  if (!Array.isArray(rows) || rows.length <= DUNGEON_TEAM_MAX) return;
  const keepRows = _pickDungeonTeamMemberRows(rows, leaderAccountId);
  const keepSet = new Set(keepRows.map((r) => Number(r?.account_id) || 0).filter((v) => v > 0));
  for (const row of rows) {
    const aid = Number(row?.account_id) || 0;
    if (aid <= 0 || keepSet.has(aid)) continue;
    if (conn) {
      await conn.execute('DELETE FROM dungeon_team_members WHERE team_code=? AND account_id=?', [code, aid]);
    } else {
      await mysqlAsyncPool.execute('DELETE FROM dungeon_team_members WHERE team_code=? AND account_id=?', [code, aid]);
    }
  }
}

async function joinDungeonTeamAsync(teamCode, accountId) {
  if (!isMysqlDriver) return joinDungeonTeam(teamCode, accountId);
  const code = String(teamCode || '').toUpperCase().trim();
  const aid = Number(accountId) || 0;
  if (!code || aid <= 0) return { ok: false, error: '参数错误' };
  try {
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) throw new Error('MySQL pool unavailable for joinDungeonTeamAsync');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [teamRows] = await conn.query(
        `SELECT * FROM dungeon_teams
         WHERE team_code = ? AND expires_at > UNIX_TIMESTAMP()
         LIMIT 1 FOR UPDATE`,
        [code]
      );
      const team = teamRows && teamRows[0];
      if (!team) {
        await conn.rollback();
        return { ok: false, error: '队伍不存在或已过期' };
      }

      await _trimDungeonTeamMembersToMaxAsync(code, team.leader_account_id, conn);
      const [memberRows] = await conn.query(
        'SELECT account_id FROM dungeon_team_members WHERE team_code = ? ORDER BY joined_at ASC, account_id ASC FOR UPDATE',
        [code]
      );
      const members = Array.isArray(memberRows) ? memberRows : [];
      const alreadyIn = members.some((m) => Number(m.account_id) === aid);
      if (!alreadyIn && members.length >= DUNGEON_TEAM_MAX) {
        await conn.rollback();
        return { ok: false, error: '队伍已满（最多3人）' };
      }

      await conn.execute(
        `INSERT INTO dungeon_team_members (team_code, account_id, joined_at)
         VALUES (?, ?, UNIX_TIMESTAMP())
         ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
        [code, aid]
      );
      await conn.execute('UPDATE dungeon_teams SET expires_at = UNIX_TIMESTAMP() + 1800 WHERE team_code = ?', [code]);
      await conn.commit();
      return { ok: true, dungeonId: Number(team.dungeon_id) || 0 };
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (err) {
    console.warn('[dungeon.team.join.async] failed:', err?.message || err);
    throw err;
  }
}

async function getDungeonTeamAsync(teamCode) {
  if (!isMysqlDriver) return getDungeonTeam(teamCode);
  const code = String(teamCode || '').toUpperCase().trim();
  if (!code) return null;
  try {
    const teamRows = await mysqlAsyncPool.query(
      `SELECT * FROM dungeon_teams
       WHERE team_code = ? AND expires_at > UNIX_TIMESTAMP()
       LIMIT 1`,
      [code]
    );
    const team = teamRows && teamRows[0];
    if (!team) return null;
    await _trimDungeonTeamMembersToMaxAsync(code, team.leader_account_id);
    const members = await mysqlAsyncPool.query(
      'SELECT account_id, joined_at FROM dungeon_team_members WHERE team_code = ? ORDER BY joined_at ASC, account_id ASC',
      [code]
    );
    const limitedMembers = _pickDungeonTeamMemberRows(members, team.leader_account_id);
    return {
      ...team,
      members: limitedMembers.map((m) => Number(m.account_id) || 0).filter((v) => v > 0)
    };
  } catch (e) {
    console.error('[db] getDungeonTeamAsync failed teamCode=%s:', teamCode, e && e.message);
    throw e;
  }
}

async function leaveDungeonTeamAsync(teamCode, accountId) {
  if (!isMysqlDriver) return leaveDungeonTeam(teamCode, accountId);
  const code = String(teamCode || '').toUpperCase().trim();
  const aid = Number(accountId) || 0;
  if (!code || aid <= 0) return;
  try {
    await mysqlAsyncPool.execute('DELETE FROM dungeon_team_members WHERE team_code=? AND account_id=?', [code, aid]);
    await touchDungeonTeamAsync(code);
  } catch (e) {
    console.error('[db] leaveDungeonTeamAsync failed teamCode=%s accountId=%s:', teamCode, accountId, e && e.message);
    throw e;
  }
}

async function getMyDungeonTeamAsync(accountId) {
  if (!isMysqlDriver) return getMyDungeonTeam(accountId);
  const aid = Number(accountId) || 0;
  if (aid <= 0) return null;
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT team_code FROM dungeon_team_members WHERE account_id = ? ORDER BY joined_at DESC LIMIT 1',
      [aid]
    );
    const code = String(rows?.[0]?.team_code || '').trim();
    if (!code) return null;
    return getDungeonTeamAsync(code);
  } catch (e) {
    console.error('[db] getMyDungeonTeamAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

// -------------------- 交易所 / 邮箱 --------------------
function createExchangeListing(sellerAccountId, payload) {
  const now = Math.floor(Date.now() / 1000);
  const expireHours = Math.max(1, Number(config.exchangeListingExpireHours) || 72);
  const expiresAt = now + Math.floor(expireHours * 3600);
  const stmt = db.prepare(`
    INSERT INTO exchange_listings
      (seller_account_id, item_id, item_name, item_snapshot_json, unit_price, quantity_total, quantity_left, status, side, tax_per_unit, created_at, updated_at, expires_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `);
  const r = stmt.run(
    sellerAccountId,
    Math.floor(Number(payload.item_id) || 0),
    String(payload.item_name || '未知物品'),
    JSON.stringify(payload.item_snapshot || {}),
    Math.floor(Number(payload.unit_price) || 0),
    Math.floor(Number(payload.quantity_total) || 1),
    Math.floor(Number(payload.quantity_left) || Number(payload.quantity_total) || 1),
    String(payload.side || 'sell'),
    Math.floor(Number(payload.tax_per_unit) || 0),
    now,
    now,
    expiresAt
  );
  return Number(r.lastInsertRowid);
}

function getExchangeListingById(id) {
  return db.prepare('SELECT * FROM exchange_listings WHERE id=?').get(id);
}

function listExchangeListings({
  page = 1,
  pageSize = 20,
  sellerAccountId = 0,
  myOnly = false,
  side = 'all',
  itemId = 0,
  keyword = '',
  minPrice = 0,
  maxPrice = 0,
  quality = 0,
  category = '',
  subtype = '',
  sortBy = 'price_asc'
} = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const qualityInt = Math.max(0, Math.trunc(Number(quality) || 0));
  const categoryStr = String(category || '').trim().toLowerCase();
  const subtypeStr = String(subtype || '').trim();
  const weaponSubtypes = new Set(['剑', '刀', '长兵', '弓', '拳爪', '音律', '节杖']);
  const armorSlots = new Set(['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);
  let where = "WHERE l.status IN ('open','partial') AND l.quantity_left > 0 AND l.expires_at > strftime('%s', 'now')";
  const args = [];
  if (myOnly && Number(sellerAccountId) > 0) {
    where += ' AND l.seller_account_id = ?';
    args.push(Number(sellerAccountId));
  }
  if (side === 'sell' || side === 'buy') {
    where += ' AND l.side = ?';
    args.push(side);
  }
  if (Number(itemId) > 0) {
    where += ' AND l.item_id = ?';
    args.push(Number(itemId));
  }
  if (String(keyword || '').trim().length > 0) {
    where += ' AND l.item_name LIKE ?';
    args.push(`%${String(keyword).trim()}%`);
  }
  if (Number(minPrice) > 0) {
    where += ' AND l.unit_price >= ?';
    args.push(Number(minPrice));
  }
  if (Number(maxPrice) > 0) {
    where += ' AND l.unit_price <= ?';
    args.push(Number(maxPrice));
  }
  if (qualityInt > 0) {
    where += ` AND CAST(COALESCE(
      json_extract(l.item_snapshot_json, '$.quality'),
      json_extract(l.item_snapshot_json, '$.equipment_criteria.min_quality'),
      json_extract(l.item_snapshot_json, '$.equipment_criteria.minQuality'),
      0
    ) AS INTEGER) = ?`;
    args.push(qualityInt);
  }

  if (categoryStr === 'equip') {
    const equipTypes = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
    where += ` AND (
      json_type(json_extract(l.item_snapshot_json, '$.equipment_criteria')) = 'object'
      OR json_extract(l.item_snapshot_json, '$.type') IN (${equipTypes.map(() => '?').join(',')})
    )`;
    args.push(...equipTypes);
  } else if (categoryStr === 'material') {
    where += ` AND json_extract(l.item_snapshot_json, '$.type') = 'material'`;
  } else if (categoryStr === 'herb') {
    where += ` AND json_extract(l.item_snapshot_json, '$.type') IN ('herb', 'medicine')`;
  } else if (categoryStr === 'consumable') {
    where += ` AND json_extract(l.item_snapshot_json, '$.type') = 'consumable'`;
  } else if (categoryStr === 'book') {
    where += ` AND json_extract(l.item_snapshot_json, '$.type') = 'book'`;
  } else if (categoryStr === 'talisman') {
    where += ` AND json_extract(l.item_snapshot_json, '$.type') = 'talisman'`;
  }

  if (subtypeStr.length > 0) {
    if (categoryStr === 'equip') {
      if (weaponSubtypes.has(subtypeStr)) {
        where += ` AND (
          (
            COALESCE(json_extract(l.item_snapshot_json, '$.type'), '') = 'weapon'
            AND COALESCE(json_extract(l.item_snapshot_json, '$.subtype'), '') = ?
          )
          OR (
            COALESCE(json_extract(l.item_snapshot_json, '$.equipment_criteria.slot'), '') = 'weapon'
            AND COALESCE(json_extract(l.item_snapshot_json, '$.equipment_criteria.subtype'), '') = ?
          )
        )`;
        args.push(subtypeStr, subtypeStr);
      } else if (armorSlots.has(subtypeStr)) {
        where += ` AND (
          COALESCE(json_extract(l.item_snapshot_json, '$.type'), '') = ?
          OR COALESCE(json_extract(l.item_snapshot_json, '$.equipment_criteria.slot'), '') = ?
        )`;
        args.push(subtypeStr, subtypeStr);
      } else {
        where += ` AND COALESCE(
          json_extract(l.item_snapshot_json, '$.subtype'),
          json_extract(l.item_snapshot_json, '$.equipment_criteria.subtype'),
          ''
        ) = ?`;
        args.push(subtypeStr);
      }
    } else if (categoryStr === 'material') {
      where += ` AND COALESCE(json_extract(l.item_snapshot_json, '$.material'), json_extract(l.item_snapshot_json, '$.equipment_criteria.material'), '') = ?`;
      args.push(subtypeStr);
    }
  }
  let orderBy = 'ORDER BY l.unit_price ASC, l.created_at ASC';
  if (side === 'buy') orderBy = 'ORDER BY l.item_name ASC, l.unit_price DESC, l.created_at DESC';
  if (sortBy === 'price_desc') orderBy = 'ORDER BY l.unit_price DESC, l.created_at DESC';
  if (sortBy === 'newest') orderBy = 'ORDER BY l.created_at DESC, l.id DESC';
  if (sortBy === 'oldest') orderBy = 'ORDER BY l.created_at ASC, l.id ASC';
  const rows = db.prepare(`
    SELECT l.*, a.username AS seller_username, json_extract(p.data, '$.name') AS seller_player_name
    FROM exchange_listings l
    LEFT JOIN accounts a ON a.id = l.seller_account_id
    LEFT JOIN players p ON p.account_id = l.seller_account_id
    ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...args, ps, offset);
  const totalRow = db.prepare(`
    SELECT COUNT(1) AS c
    FROM exchange_listings l
    ${where}
  `).get(...args);
  return {
    list: rows,
    total: Number(totalRow?.c || 0),
    page: p,
    pageSize: ps
  };
}

function listMyExchangeListings(accountId, { includeClosed = false } = {}) {
  const where = includeClosed ? '' : "AND l.status IN ('open','partial')";
  const rows = db.prepare(`
    SELECT l.*, a.username AS seller_username, json_extract(p.data, '$.name') AS seller_player_name
    FROM exchange_listings l
    LEFT JOIN accounts a ON a.id = l.seller_account_id
    LEFT JOIN players p ON p.account_id = l.seller_account_id
    WHERE l.seller_account_id = ?
    ${where}
    ORDER BY l.created_at DESC
  `).all(accountId);
  return rows.map((r) => {
    let raw = (r.seller_player_name != null && r.seller_player_name !== '') ? String(r.seller_player_name).trim() : '';
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"');
    }
    return { ...r, seller_player_name: raw || r.seller_username || '?' };
  });
}

// 原子扣减库存，避免超卖。返回更新后的行或 null（库存不足/不存在）
function updateExchangeListingAfterTrade(listingId, quantityBought) {
  const qty = Math.max(1, Math.floor(Number(quantityBought) || 0));
  const r = db.prepare(`
    UPDATE exchange_listings
    SET status = CASE WHEN quantity_left <= ? THEN 'filled' ELSE 'partial' END,
        quantity_left = quantity_left - ?,
        updated_at = strftime('%s','now')
    WHERE id = ? AND quantity_left >= ? AND status IN ('open','partial')
  `).run(qty, qty, listingId, qty);
  if (!r || r.changes === 0) return null;
  return getExchangeListingById(listingId);
}

function cancelExchangeListing(listingId) {
  const row = getExchangeListingById(listingId);
  if (!row) return null;
  db.prepare(`
    UPDATE exchange_listings
    SET status='cancelled', updated_at=strftime('%s','now')
    WHERE id=?
  `).run(listingId);
  return row;
}

function repairExchangeListingStatuses() {
  const fixPartial = db.prepare(`
    UPDATE exchange_listings
    SET status='partial', updated_at=strftime('%s','now')
    WHERE status='filled' AND quantity_left > 0
  `).run();
  const fixFilled = db.prepare(`
    UPDATE exchange_listings
    SET status='filled', updated_at=strftime('%s','now')
    WHERE status IN ('open','partial') AND quantity_left <= 0
  `).run();
  return Number(fixPartial?.changes || 0) + Number(fixFilled?.changes || 0);
}

function settleExpiredExchangeListings() {
  // 纠正历史脏状态：部分成交被错误标成 filled 会导致剩余挂单“消失”。
  repairExchangeListingStatuses();
  const rows = db.prepare(`
    SELECT *
    FROM exchange_listings
    WHERE status IN ('open','partial')
      AND quantity_left > 0
      AND expires_at > 0
      AND expires_at <= strftime('%s','now')
  `).all();
  if (!rows.length) return 0;
  const tx = db.transaction(() => {
    const markStmt = db.prepare(`
      UPDATE exchange_listings
      SET status='expired', updated_at=strftime('%s','now')
      WHERE id=?
    `);
    for (const row of rows) {
    const qty = Number(row.quantity_left) || 0;
    if (qty <= 0) { markStmt.run(row.id); continue; }
    const side = String(row.side || 'sell');
    if (side === 'buy') {
      let snapshot;
      try { snapshot = JSON.parse(row.item_snapshot_json || '{}'); } catch (_) { snapshot = {}; }
      const barter = snapshot?.barter && snapshot.barter.enabled ? snapshot.barter : null;
      if (barter) {
        const payItemId = Number(barter?.pay_item_id) || 0;
        const payItemCount = Math.max(0, Math.floor(Number(barter?.pay_unit_count) || 0) * qty);
        const payItemSnapshot = barter?.pay_item_snapshot && typeof barter.pay_item_snapshot === 'object'
          ? barter.pay_item_snapshot
          : { id: payItemId, name: String(barter?.pay_item_name || '未知物品') };
        const supplementTaxRefund = Math.max(0, Number(row.tax_per_unit || 0) * qty);
        const attachments = [];
        if (payItemId > 0 && payItemCount > 0) attachments.push({ kind: 'item', item: payItemSnapshot, count: payItemCount });
        if (supplementTaxRefund > 0) attachments.push({ kind: 'currency', currency: 'spirit_stones', amount: supplementTaxRefund });
        createMailboxMessage(row.seller_account_id, {
          type: 'trade_refund',
          title: `交易所求购已过期：${row.item_name}`,
          content: `以物易物求购已过期，系统退回支付物品 x${payItemCount} 与差额税 ${supplementTaxRefund} 灵石。`,
          attachments
        });
      } else {
        const refund = (Number(row.unit_price) + Number(row.tax_per_unit || 0)) * qty;
        createMailboxMessage(row.seller_account_id, {
          type: 'trade_refund',
          title: `交易所求购已过期：${row.item_name}`,
          content: `求购已过期，系统退回剩余预存灵石 ${refund}。`,
          attachments: [{ kind: 'currency', currency: 'spirit_stones', amount: refund }]
        });
      }
    } else {
      let item;
      try { item = JSON.parse(row.item_snapshot_json || '{}'); } catch (_) { item = {}; }
      if (item && typeof item === 'object' && Object.keys(item).length > 0) {
        createMailboxMessage(row.seller_account_id, {
          type: 'trade_refund',
          title: `交易所挂单已过期：${row.item_name}`,
          content: `挂单已过期，系统已退回剩余物品 x${qty}。`,
          attachments: [{ kind: 'item', item, count: qty }]
        });
      }
    }
    markStmt.run(row.id);
    }
  });
  tx();
  return rows.length;
}

function createExchangeTrade(payload) {
  const stmt = db.prepare(`
    INSERT INTO exchange_trades
      (listing_id, seller_account_id, buyer_account_id, item_id, item_name, quantity, unit_price, total_price, tax_amount, seller_income, side)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const r = stmt.run(
    Number(payload.listing_id),
    Number(payload.seller_account_id),
    Number(payload.buyer_account_id),
    Math.floor(Number(payload.item_id) || 0),
    String(payload.item_name || '未知物品'),
    Math.floor(Number(payload.quantity) || 1),
    Math.floor(Number(payload.unit_price) || 0),
    Math.floor(Number(payload.total_price) || 0),
    Math.floor(Number(payload.tax_amount) || 0),
    Math.floor(Number(payload.seller_income) || 0),
    String(payload.side || 'sell')
  );
  return Number(r.lastInsertRowid);
}

function listExchangeTradePrices(itemId, minCreatedAt, limit = 300) {
  const iid = Math.floor(Number(itemId) || 0);
  if (iid <= 0) return [];
  const minTs = Math.max(0, Math.floor(Number(minCreatedAt) || 0));
  const lim = Math.max(20, Math.min(1500, Math.floor(Number(limit) || 300)));
  const rows = db.prepare(`
    SELECT unit_price
    FROM exchange_trades
    WHERE item_id = ? AND created_at >= ? AND side = 'sell'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(iid, minTs, lim);
  return (rows || []).map((r) => Math.floor(Number(r?.unit_price) || 0)).filter((v) => v > 0);
}

// ─── P3: 交易所异步实现（MySQL 驱动） ───
async function createExchangeListingAsync(sellerAccountId, payload) {
  if (!isMysqlDriver) return createExchangeListing(sellerAccountId, payload);
  const now = Math.floor(Date.now() / 1000);
  const expireHours = Math.max(1, Number(config.exchangeListingExpireHours) || 72);
  const expiresAt = now + Math.floor(expireHours * 3600);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO exchange_listings
        (seller_account_id, item_id, item_name, item_snapshot_json, unit_price, quantity_total, quantity_left, status, side, tax_per_unit, created_at, updated_at, expires_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      [
        Number(sellerAccountId),
        Math.floor(Number(payload.item_id) || 0),
        String(payload.item_name || '未知物品'),
        JSON.stringify(payload.item_snapshot || {}),
        Math.floor(Number(payload.unit_price) || 0),
        Math.floor(Number(payload.quantity_total) || 1),
        Math.floor(Number(payload.quantity_left) || Number(payload.quantity_total) || 1),
        String(payload.side || 'sell'),
        Math.floor(Number(payload.tax_per_unit) || 0),
        now,
        now,
        expiresAt
      ]
    );
    return Number(ret?.insertId || 0);
  } catch (e) {
    console.error('[db] createExchangeListingAsync error seller=%s:', sellerAccountId, e && e.message);
    throw e;
  }
}

async function getExchangeListingByIdAsync(id) {
  if (!isMysqlDriver) return getExchangeListingById(id);
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM exchange_listings WHERE id=? LIMIT 1', [Number(id)]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getExchangeListingByIdAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function listExchangeListingsAsync({
  page = 1,
  pageSize = 20,
  sellerAccountId = 0,
  myOnly = false,
  side = 'all',
  itemId = 0,
  keyword = '',
  minPrice = 0,
  maxPrice = 0,
  quality = 0,
  category = '',
  subtype = '',
  sortBy = 'price_asc'
} = {}) {
  if (!isMysqlDriver) {
    return listExchangeListings({
      page,
      pageSize,
      sellerAccountId,
      myOnly,
      side,
      itemId,
      keyword,
      minPrice,
      maxPrice,
      quality,
      category,
      subtype,
      sortBy
    });
  }

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const qualityInt = Math.max(0, Math.trunc(Number(quality) || 0));
  const categoryStr = String(category || '').trim().toLowerCase();
  const subtypeStr = String(subtype || '').trim();
  const weaponSubtypes = new Set(['剑', '刀', '长兵', '弓', '拳爪', '音律', '节杖']);
  const armorSlots = new Set(['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);

  let where = "WHERE l.status IN ('open','partial') AND l.quantity_left > 0 AND l.expires_at > UNIX_TIMESTAMP()";
  const args = [];
  if (myOnly && Number(sellerAccountId) > 0) {
    where += ' AND l.seller_account_id = ?';
    args.push(Number(sellerAccountId));
  }
  if (side === 'sell' || side === 'buy') {
    where += ' AND l.side = ?';
    args.push(side);
  }
  if (Number(itemId) > 0) {
    where += ' AND l.item_id = ?';
    args.push(Number(itemId));
  }
  if (String(keyword || '').trim().length > 0) {
    where += ' AND l.item_name LIKE ?';
    args.push(`%${String(keyword).trim()}%`);
  }
  if (Number(minPrice) > 0) {
    where += ' AND l.unit_price >= ?';
    args.push(Number(minPrice));
  }
  if (Number(maxPrice) > 0) {
    where += ' AND l.unit_price <= ?';
    args.push(Number(maxPrice));
  }
  if (qualityInt > 0) {
    where += ` AND CAST(COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.quality')),
      JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.min_quality')),
      JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.minQuality')),
      0
    ) AS SIGNED) = ?`;
    args.push(qualityInt);
  }

  if (categoryStr === 'equip') {
    const equipTypes = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
    where += ` AND (
      UPPER(COALESCE(JSON_TYPE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria')), '')) = 'OBJECT'
      OR JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) IN (${equipTypes.map(() => '?').join(',')})
    )`;
    args.push(...equipTypes);
  } else if (categoryStr === 'material') {
    where += ` AND JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) = 'material'`;
  } else if (categoryStr === 'herb') {
    where += ` AND JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) IN ('herb', 'medicine')`;
  } else if (categoryStr === 'consumable') {
    where += ` AND JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) = 'consumable'`;
  } else if (categoryStr === 'book') {
    where += ` AND JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) = 'book'`;
  } else if (categoryStr === 'talisman') {
    where += ` AND JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')) = 'talisman'`;
  }

  if (subtypeStr.length > 0) {
    if (categoryStr === 'equip') {
      if (weaponSubtypes.has(subtypeStr)) {
        where += ` AND (
          (
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')), '') = 'weapon'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.subtype')), '') = ?
          )
          OR (
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.slot')), '') = 'weapon'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.subtype')), '') = ?
          )
        )`;
        args.push(subtypeStr, subtypeStr);
      } else if (armorSlots.has(subtypeStr)) {
        where += ` AND (
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.type')), '') = ?
          OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.slot')), '') = ?
        )`;
        args.push(subtypeStr, subtypeStr);
      } else {
        where += ` AND COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.subtype')),
          JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.subtype')),
          ''
        ) = ?`;
        args.push(subtypeStr);
      }
    } else if (categoryStr === 'material') {
      where += ` AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.material')), JSON_UNQUOTE(JSON_EXTRACT(l.item_snapshot_json, '$.equipment_criteria.material')), '') = ?`;
      args.push(subtypeStr);
    }
  }

  let orderBy = 'ORDER BY l.unit_price ASC, l.created_at ASC';
  if (side === 'buy') orderBy = 'ORDER BY l.item_name ASC, l.unit_price DESC, l.created_at DESC';
  if (sortBy === 'price_desc') orderBy = 'ORDER BY l.unit_price DESC, l.created_at DESC';
  if (sortBy === 'newest') orderBy = 'ORDER BY l.created_at DESC, l.id DESC';
  if (sortBy === 'oldest') orderBy = 'ORDER BY l.created_at ASC, l.id ASC';

  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT l.*, a.username AS seller_username, JSON_UNQUOTE(JSON_EXTRACT(p.data, '$.name')) AS seller_player_name
       FROM exchange_listings l
       LEFT JOIN accounts a ON a.id = l.seller_account_id
       LEFT JOIN players p ON p.account_id = l.seller_account_id
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...args, ps, offset]
    );
    const totalRows = await mysqlAsyncPool.query(
      `SELECT COUNT(1) AS c
       FROM exchange_listings l
       ${where}`,
      args
    );
    const totalRow = totalRows && totalRows[0];
    return {
      list: rows || [],
      total: Number(totalRow?.c || 0),
      page: p,
      pageSize: ps
    };
  } catch (e) {
    console.error('[db] listExchangeListingsAsync error:', e && e.message);
    throw e;
  }
}

async function listMyExchangeListingsAsync(accountId, { includeClosed = false } = {}) {
  if (!isMysqlDriver) return listMyExchangeListings(accountId, { includeClosed });
  const where = includeClosed ? '' : "AND l.status IN ('open','partial')";
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT l.*, a.username AS seller_username, JSON_UNQUOTE(JSON_EXTRACT(p.data, '$.name')) AS seller_player_name
       FROM exchange_listings l
       LEFT JOIN accounts a ON a.id = l.seller_account_id
       LEFT JOIN players p ON p.account_id = l.seller_account_id
       WHERE l.seller_account_id = ?
       ${where}
       ORDER BY l.created_at DESC`,
      [Number(accountId)]
    );
    return (rows || []).map((r) => {
      const raw = (r.seller_player_name != null && r.seller_player_name !== '') ? String(r.seller_player_name).trim() : '';
      return { ...r, seller_player_name: raw || r.seller_username || '?' };
    });
  } catch (e) {
    console.error('[db] listMyExchangeListingsAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function updateExchangeListingAfterTradeAsync(listingId, quantityBought) {
  if (!isMysqlDriver) return updateExchangeListingAfterTrade(listingId, quantityBought);
  const qty = Math.max(1, Math.floor(Number(quantityBought) || 0));
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE exchange_listings
       SET status = CASE WHEN quantity_left <= ? THEN 'filled' ELSE 'partial' END,
           quantity_left = quantity_left - ?,
           updated_at = UNIX_TIMESTAMP()
       WHERE id = ? AND quantity_left >= ? AND status IN ('open','partial')`,
      [qty, qty, Number(listingId), qty]
    );
    if (!ret || Number(ret.affectedRows || 0) === 0) return null;
    return getExchangeListingByIdAsync(listingId);
  } catch (e) {
    console.error('[db] updateExchangeListingAfterTradeAsync error listingId=%s:', listingId, e && e.message);
    throw e;
  }
}

async function cancelExchangeListingAsync(listingId) {
  if (!isMysqlDriver) return cancelExchangeListing(listingId);
  const row = await getExchangeListingByIdAsync(listingId);
  if (!row) return null;
  try {
    await mysqlAsyncPool.execute(
      `UPDATE exchange_listings
       SET status='cancelled', updated_at=UNIX_TIMESTAMP()
       WHERE id=?`,
      [Number(listingId)]
    );
    return row;
  } catch (e) {
    console.error('[db] cancelExchangeListingAsync error listingId=%s:', listingId, e && e.message);
    throw e;
  }
}

async function _createMailboxMessageAsyncWithConn(conn, accountId, payload) {
  const now = Math.floor(Date.now() / 1000);
  const [ret] = await conn.execute(
    `INSERT INTO mailbox_messages
      (account_id, type, title, content, attachments_json, status, created_at, claimed_at, expires_at)
     VALUES
      (?, ?, ?, ?, ?, 'unread', ?, 0, ?)`,
    [
      Number(accountId),
      String(payload.type || 'system'),
      String(payload.title || '系统邮件'),
      String(payload.content || ''),
      JSON.stringify(payload.attachments || []),
      now,
      Number(payload.expires_at) || 0
    ]
  );
  return Number(ret?.insertId || 0);
}

async function settleExpiredExchangeListingsAsync() {
  if (!isMysqlDriver) return settleExpiredExchangeListings();
  try {
    await mysqlAsyncPool.execute(
      `UPDATE exchange_listings
       SET status='partial', updated_at=UNIX_TIMESTAMP()
       WHERE status='filled' AND quantity_left > 0`
    );
    await mysqlAsyncPool.execute(
      `UPDATE exchange_listings
       SET status='filled', updated_at=UNIX_TIMESTAMP()
       WHERE status IN ('open','partial') AND quantity_left <= 0`
    );
  } catch (e) {
    console.warn('[db] settleExpiredExchangeListingsAsync status repair warn:', e && e.message);
  }
  let rows = [];
  try {
    rows = await mysqlAsyncPool.query(
      `SELECT *
       FROM exchange_listings
       WHERE status IN ('open','partial')
         AND quantity_left > 0
         AND expires_at > 0
         AND expires_at <= UNIX_TIMESTAMP()`
    );
  } catch (e) {
    console.error('[db] settleExpiredExchangeListingsAsync query error:', e && e.message);
    throw e;
  }
  if (!Array.isArray(rows) || rows.length <= 0) return 0;

  const pool = await mysqlAsyncPool.getPool();
  if (!pool) throw new Error('MySQL pool unavailable for settleExpiredExchangeListingsAsync');
  let settled = 0;
  for (const row of rows) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 先原子更新状态，防止并发重复结算
      const [upd] = await conn.execute(
        `UPDATE exchange_listings
         SET status='expired', updated_at=UNIX_TIMESTAMP()
         WHERE id=? AND status IN ('open','partial')`,
        [Number(row.id)]
      );
      if (Number(upd?.affectedRows || 0) <= 0) {
        // 已被其他请求结算，跳过
        await conn.commit();
        continue;
      }
      const qty = Number(row.quantity_left) || 0;
      if (qty > 0) {
        const side = String(row.side || 'sell');
        if (side === 'buy') {
          let snapshot;
          try { snapshot = JSON.parse(row.item_snapshot_json || '{}'); } catch (_) { snapshot = {}; }
          const barter = snapshot?.barter && snapshot.barter.enabled ? snapshot.barter : null;
          if (barter) {
            const payItemId = Number(barter?.pay_item_id) || 0;
            const payItemCount = Math.max(0, Math.floor(Number(barter?.pay_unit_count) || 0) * qty);
            const payItemSnapshot = barter?.pay_item_snapshot && typeof barter.pay_item_snapshot === 'object'
              ? barter.pay_item_snapshot
              : { id: payItemId, name: String(barter?.pay_item_name || '未知物品') };
            const supplementTaxRefund = Math.max(0, Number(row.tax_per_unit || 0) * qty);
            const attachments = [];
            if (payItemId > 0 && payItemCount > 0) attachments.push({ kind: 'item', item: payItemSnapshot, count: payItemCount });
            if (supplementTaxRefund > 0) attachments.push({ kind: 'currency', currency: 'spirit_stones', amount: supplementTaxRefund });
            await _createMailboxMessageAsyncWithConn(conn, row.seller_account_id, {
              type: 'trade_refund',
              title: `交易所求购已过期：${row.item_name}`,
              content: `以物易物求购已过期，系统退回支付物品 x${payItemCount} 与差额税 ${supplementTaxRefund} 灵石。`,
              attachments
            });
          } else {
            const refund = (Number(row.unit_price) + Number(row.tax_per_unit || 0)) * qty;
            await _createMailboxMessageAsyncWithConn(conn, row.seller_account_id, {
              type: 'trade_refund',
              title: `交易所求购已过期：${row.item_name}`,
              content: `求购已过期，系统退回剩余预存灵石 ${refund}。`,
              attachments: [{ kind: 'currency', currency: 'spirit_stones', amount: refund }]
            });
          }
        } else {
          let item;
          try { item = JSON.parse(row.item_snapshot_json || '{}'); } catch (_) { item = {}; }
          if (item && typeof item === 'object' && Object.keys(item).length > 0) {
            await _createMailboxMessageAsyncWithConn(conn, row.seller_account_id, {
              type: 'trade_refund',
              title: `交易所挂单已过期：${row.item_name}`,
              content: `挂单已过期，系统已退回剩余物品 x${qty}。`,
              attachments: [{ kind: 'item', item, count: qty }]
            });
          }
        }
      }
      await conn.commit();
      settled++;
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      console.error('[db] settleExpiredExchangeListingsAsync row id=%s error:', row.id, e && e.message);
    } finally {
      try { conn.release(); } catch (_) {}
    }
  }
  return settled;
}

async function createExchangeTradeAsync(payload) {
  if (!isMysqlDriver) return createExchangeTrade(payload);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO exchange_trades
        (listing_id, seller_account_id, buyer_account_id, item_id, item_name, quantity, unit_price, total_price, tax_amount, seller_income, side)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(payload.listing_id),
        Number(payload.seller_account_id),
        Number(payload.buyer_account_id),
        Math.floor(Number(payload.item_id) || 0),
        String(payload.item_name || '未知物品'),
        Math.floor(Number(payload.quantity) || 1),
        Math.floor(Number(payload.unit_price) || 0),
        Math.floor(Number(payload.total_price) || 0),
        Math.floor(Number(payload.tax_amount) || 0),
        Math.floor(Number(payload.seller_income) || 0),
        String(payload.side || 'sell')
      ]
    );
    return Number(ret?.insertId || 0);
  } catch (e) {
    console.error('[db] createExchangeTradeAsync error listing=%s:', payload?.listing_id, e && e.message);
    throw e;
  }
}

async function listExchangeTradePricesAsync(itemId, minCreatedAt, limit = 300) {
  if (!isMysqlDriver) return listExchangeTradePrices(itemId, minCreatedAt, limit);
  const iid = Math.floor(Number(itemId) || 0);
  if (iid <= 0) return [];
  const minTs = Math.max(0, Math.floor(Number(minCreatedAt) || 0));
  const lim = Math.max(20, Math.min(1500, Math.floor(Number(limit) || 300)));
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT unit_price
       FROM exchange_trades
       WHERE item_id = ? AND created_at >= ? AND side = 'sell'
       ORDER BY created_at DESC
       LIMIT ?`,
      [iid, minTs, lim]
    );
    return (rows || []).map((r) => Math.floor(Number(r?.unit_price) || 0)).filter((v) => v > 0);
  } catch (e) {
    console.error('[db] listExchangeTradePricesAsync error itemId=%s:', itemId, e && e.message);
    throw e;
  }
}

function createMailboxMessage(accountId, payload) {
  const now = Math.floor(Date.now() / 1000);
  const dedupeKeyRaw = String(payload?.dedupe_key || '').trim();
  const dedupeKey = dedupeKeyRaw ? dedupeKeyRaw.slice(0, 191) : '';
  if (dedupeKey) {
    const existed = db.prepare('SELECT id FROM mailbox_messages WHERE account_id=? AND dedupe_key=? LIMIT 1').get(Number(accountId), dedupeKey);
    if (existed && Number(existed.id) > 0) return 0;
    try {
      const stmt = db.prepare(`
        INSERT INTO mailbox_messages
          (account_id, type, title, content, attachments_json, status, created_at, claimed_at, expires_at, dedupe_key)
        VALUES
          (?, ?, ?, ?, ?, 'unread', ?, 0, ?, ?)
      `);
      const r = stmt.run(
        Number(accountId),
        String(payload.type || 'system'),
        String(payload.title || '系统邮件'),
        String(payload.content || ''),
        JSON.stringify(payload.attachments || []),
        now,
        Number(payload.expires_at) || 0,
        dedupeKey
      );
      return Number(r.lastInsertRowid || 0);
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('UNIQUE constraint failed') || msg.includes('Duplicate entry')) return 0;
      throw e;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO mailbox_messages
      (account_id, type, title, content, attachments_json, status, created_at, claimed_at, expires_at)
    VALUES
      (?, ?, ?, ?, ?, 'unread', ?, 0, ?)
  `);
  const r = stmt.run(
    Number(accountId),
    String(payload.type || 'system'),
    String(payload.title || '系统邮件'),
    String(payload.content || ''),
    JSON.stringify(payload.attachments || []),
    now,
    Number(payload.expires_at) || 0
  );
  return Number(r.lastInsertRowid);
}

function listMailbox(accountId) {
  const rows = db.prepare(`
    SELECT *
    FROM mailbox_messages
    WHERE account_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(Number(accountId));
  return rows.map((r) => ({
    ...r,
    attachments: (() => {
      try { return JSON.parse(r.attachments_json || '[]'); } catch (_) { return []; }
    })()
  }));
}

function getMailboxById(mailId, accountId) {
  const r = db.prepare('SELECT * FROM mailbox_messages WHERE id=? AND account_id=?').get(Number(mailId), Number(accountId));
  if (!r) return null;
  return {
    ...r,
    attachments: (() => {
      try { return JSON.parse(r.attachments_json || '[]'); } catch (_) { return []; }
    })()
  };
}

function _parseMailboxAttachments(rawJson) {
  try { return JSON.parse(rawJson || '[]'); } catch (_) { return []; }
}

function _mailAtomicError(message) {
  const e = new Error(String(message || '领取失败'));
  e.mailAtomicUserError = true;
  return e;
}

function claimMailboxAtomic(accountId, mailId, applyPlayerAttachments) {
  if (isMysqlDriver) {
    throw new Error('claimMailboxAtomic is sqlite-only in mysql mode');
  }
  const aid = Number(accountId);
  const mid = Number(mailId);
  const applyFn = typeof applyPlayerAttachments === 'function' ? applyPlayerAttachments : null;
  if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(mid) || mid <= 0 || !applyFn) {
    return { ok: false, error: '无效参数' };
  }

  return accountSerialExecutor.run(aid, async () => {
    let finalPlayer = null;
    let nextDbRev = 0;
    try {
      const tx = db.transaction(() => {
        const mailRow = db.prepare('SELECT * FROM mailbox_messages WHERE id=? AND account_id=?').get(mid, aid);
        if (!mailRow) throw _mailAtomicError('邮件不存在');
        if (String(mailRow.status) !== 'unread') throw _mailAtomicError('该邮件已领取');

        const playerRow = db.prepare(
          'SELECT * FROM players WHERE account_id = ? LIMIT 1'
        ).get(aid);
        if (!playerRow) throw _mailAtomicError('无角色');
        const player = _parsePlayerRow(playerRow);
        if (!player) throw _mailAtomicError('读取角色失败');

        const attachments = _parseMailboxAttachments(mailRow.attachments_json);
        const applyRet = applyFn(player, attachments);
        if (applyRet && typeof applyRet === 'object' && applyRet.ok === false) {
          throw _mailAtomicError(applyRet.error || '领取失败');
        }

        const serialized = _serializePlayerData(player);
          const largeFieldJsonByField = serialized.largeFieldJsonByField || _newLargeFieldJsonMap(null);
        const shadow = _extractPlayerShadowFields(serialized.normalizedObject);
        const slot = Number(playerRow.slot) || 1;
        const currentDbRev = Math.max(0, _toNullableInt(playerRow.save_revision) || 0);
          const largeFieldSetSql = PLAYER_LARGE_JSON_FIELDS.map((field) => `${field}_json = ?`).join(', ');

        const upr = db.prepare(`
          UPDATE players
          SET slot = ?, data = ?,
            ${largeFieldSetSql},
              auto_battle_enabled = ?, auto_battle_map_id = ?,
              current_map_id = ?, rest_until = ?, last_activity_at = ?,
              save_revision = COALESCE(save_revision, 0) + 1,
              updated_at = strftime('%s', 'now')
          WHERE account_id = ?
        `).run(
          slot,
          serialized.dataStr,
          ...PLAYER_LARGE_JSON_FIELDS.map((field) => largeFieldJsonByField[field]),
          shadow.auto_battle_enabled,
          shadow.auto_battle_map_id,
          shadow.current_map_id,
          shadow.rest_until,
          shadow.last_activity_at,
          aid
        );
        if (Number(upr?.changes || 0) <= 0) throw _mailAtomicError('领取失败，请重试');

        const mr = db.prepare(`
          UPDATE mailbox_messages
          SET status='claimed', claimed_at=strftime('%s','now')
          WHERE id=? AND account_id=? AND status='unread'
        `).run(mid, aid);
        if (Number(mr?.changes || 0) <= 0) throw _mailAtomicError('该邮件已领取');

        nextDbRev = currentDbRev + 1;
        finalPlayer = player;
      });

      tx();

      _invalidatePlayerReadCache(aid);
      playerWriteCache.clear(aid);
      if (finalPlayer && typeof finalPlayer === 'object') {
        _attachPlayerDbRevision(finalPlayer, nextDbRev);
        _setPlayerDbRevision(aid, nextDbRev);
        _recordPlayerState(aid, finalPlayer, { bump: true });
        _tryUpdateAutoBattleIndex(aid, finalPlayer, null);
      }
      return { ok: true, player: finalPlayer };
    } catch (e) {
      if (e && e.mailAtomicUserError) {
        return { ok: false, error: e.message || '领取失败' };
      }
      console.error('[db] claimMailboxAtomic error accountId=%s mailId=%s:', aid, mid, e && e.message);
      return { ok: false, error: '领取失败，请稍后重试' };
    }
  });
}

function markMailboxClaimed(mailId, accountId) {
  return db.prepare(`
    UPDATE mailbox_messages
    SET status='claimed', claimed_at=strftime('%s','now')
    WHERE id=? AND account_id=? AND status='unread'
  `).run(Number(mailId), Number(accountId));
}

function unmarkMailboxClaimed(mailId, accountId) {
  return db.prepare(`
    UPDATE mailbox_messages
    SET status='unread', claimed_at=0
    WHERE id=? AND account_id=? AND status='claimed'
  `).run(Number(mailId), Number(accountId));
}

function deleteClaimedMailbox(accountId) {
  return db.prepare(`
    DELETE FROM mailbox_messages
    WHERE account_id=? AND status='claimed'
  `).run(Number(accountId));
}

// ─── P3: 邮箱异步实现（MySQL 驱动） ───
async function createMailboxMessageAsync(accountId, payload) {
  if (!isMysqlDriver) return createMailboxMessage(accountId, payload);
  const now = Math.floor(Date.now() / 1000);
  const dedupeKeyRaw = String(payload?.dedupe_key || '').trim();
  const dedupeKey = dedupeKeyRaw ? dedupeKeyRaw.slice(0, 191) : '';
  try {
    if (dedupeKey) {
      const existedRows = await mysqlAsyncPool.query(
        'SELECT id FROM mailbox_messages WHERE account_id=? AND dedupe_key=? LIMIT 1',
        [Number(accountId), dedupeKey]
      );
      if (Array.isArray(existedRows) && existedRows.length > 0) return 0;
      const ret = await mysqlAsyncPool.execute(
        `INSERT INTO mailbox_messages
          (account_id, type, title, content, attachments_json, status, created_at, claimed_at, expires_at, dedupe_key)
         VALUES
          (?, ?, ?, ?, ?, 'unread', ?, 0, ?, ?)`,
        [
          Number(accountId),
          String(payload.type || 'system'),
          String(payload.title || '系统邮件'),
          String(payload.content || ''),
          JSON.stringify(payload.attachments || []),
          now,
          Number(payload.expires_at) || 0,
          dedupeKey
        ]
      );
      return Number(ret?.insertId || 0);
    }

    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO mailbox_messages
        (account_id, type, title, content, attachments_json, status, created_at, claimed_at, expires_at)
       VALUES
        (?, ?, ?, ?, ?, 'unread', ?, 0, ?)`,
      [
        Number(accountId),
        String(payload.type || 'system'),
        String(payload.title || '系统邮件'),
        String(payload.content || ''),
        JSON.stringify(payload.attachments || []),
        now,
        Number(payload.expires_at) || 0
      ]
    );
    return Number(ret?.insertId || 0);
  } catch (e) {
    if (Number(e?.errno || 0) === 1062) return 0;
    console.error('[db] createMailboxMessageAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function listMailboxAsync(accountId) {
  if (!isMysqlDriver) return listMailbox(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT *
       FROM mailbox_messages
       WHERE account_id = ?
       ORDER BY created_at DESC, id DESC`,
      [Number(accountId)]
    );
    return (rows || []).map((r) => ({
      ...r,
      attachments: (() => {
        try { return JSON.parse(r.attachments_json || '[]'); } catch (_) { return []; }
      })()
    }));
  } catch (e) {
    console.error('[db] listMailboxAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getMailboxByIdAsync(mailId, accountId) {
  if (!isMysqlDriver) return getMailboxById(mailId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM mailbox_messages WHERE id=? AND account_id=? LIMIT 1',
      [Number(mailId), Number(accountId)]
    );
    const r = rows && rows[0];
    if (!r) return null;
    return {
      ...r,
      attachments: (() => {
        try { return JSON.parse(r.attachments_json || '[]'); } catch (_) { return []; }
      })()
    };
  } catch (e) {
    console.error('[db] getMailboxByIdAsync error mailId=%s accountId=%s:', mailId, accountId, e && e.message);
    throw e;
  }
}

async function markMailboxClaimedAsync(mailId, accountId) {
  if (!isMysqlDriver) return markMailboxClaimed(mailId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE mailbox_messages
       SET status='claimed', claimed_at=UNIX_TIMESTAMP()
       WHERE id=? AND account_id=? AND status='unread'`,
      [Number(mailId), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] markMailboxClaimedAsync error mailId=%s accountId=%s:', mailId, accountId, e && e.message);
    throw e;
  }
}

async function claimMailboxAtomicAsync(accountId, mailId, applyPlayerAttachments) {
  if (!isMysqlDriver) return claimMailboxAtomic(accountId, mailId, applyPlayerAttachments);
  const aid = Number(accountId);
  const mid = Number(mailId);
  const applyFn = typeof applyPlayerAttachments === 'function' ? applyPlayerAttachments : null;
  if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(mid) || mid <= 0 || !applyFn) {
    return { ok: false, error: '无效参数' };
  }

  return accountSerialExecutor.run(aid, async () => {
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) return { ok: false, error: '数据库不可用' };
    const conn = await pool.getConnection();
    let finalPlayer = null;
    let nextDbRev = 0;
    try {
      await conn.beginTransaction();

      const [mailRows] = await conn.query(
        'SELECT * FROM mailbox_messages WHERE id=? AND account_id=? LIMIT 1 FOR UPDATE',
        [mid, aid]
      );
      const mailRow = mailRows && mailRows[0];
      if (!mailRow) throw _mailAtomicError('邮件不存在');
      if (String(mailRow.status) !== 'unread') throw _mailAtomicError('该邮件已领取');

      const [playerRows] = await conn.query(
        'SELECT * FROM players WHERE account_id=? LIMIT 1 FOR UPDATE',
        [aid]
      );
      const playerRow = playerRows && playerRows[0];
      if (!playerRow) throw _mailAtomicError('无角色');
      const player = _parsePlayerRow(playerRow);
      if (!player) throw _mailAtomicError('读取角色失败');

      const attachments = _parseMailboxAttachments(mailRow.attachments_json);
      const applyRet = await applyFn(player, attachments);
      if (applyRet && typeof applyRet === 'object' && applyRet.ok === false) {
        throw _mailAtomicError(applyRet.error || '领取失败');
      }

      const serialized = _serializePlayerData(player);
            const largeFieldJsonByField = serialized.largeFieldJsonByField || _newLargeFieldJsonMap(null);
      const shadow = _extractPlayerShadowFields(serialized.normalizedObject);
      const slot = Number(playerRow.slot) || 1;
      const currentDbRev = Math.max(0, _toNullableInt(playerRow.save_revision) || 0);
            const largeFieldSetSql = PLAYER_LARGE_JSON_FIELDS.map((field) => `${field}_json = ?`).join(', ');
      const [upr] = await conn.execute(
        `UPDATE players
         SET slot = ?, data = ?,
              ${largeFieldSetSql},
             auto_battle_enabled = ?, auto_battle_map_id = ?,
             current_map_id = ?, rest_until = ?, last_activity_at = ?,
             save_revision = COALESCE(save_revision, 0) + 1,
             updated_at = UNIX_TIMESTAMP()
         WHERE account_id = ?`,
        [
          slot,
          serialized.dataStr,
          ...PLAYER_LARGE_JSON_FIELDS.map((field) => largeFieldJsonByField[field]),
          shadow.auto_battle_enabled,
          shadow.auto_battle_map_id,
          shadow.current_map_id,
          shadow.rest_until,
          shadow.last_activity_at,
          aid
        ]
      );
      if (Number(upr?.affectedRows || 0) <= 0) throw _mailAtomicError('领取失败，请重试');

      const [mr] = await conn.execute(
        `UPDATE mailbox_messages
         SET status='claimed', claimed_at=UNIX_TIMESTAMP()
         WHERE id=? AND account_id=? AND status='unread'`,
        [mid, aid]
      );
      if (Number(mr?.affectedRows || 0) <= 0) throw _mailAtomicError('该邮件已领取');

      await conn.commit();

      nextDbRev = currentDbRev + 1;
      finalPlayer = player;
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      if (e && e.mailAtomicUserError) {
        return { ok: false, error: e.message || '领取失败' };
      }
      console.error('[db] claimMailboxAtomicAsync error accountId=%s mailId=%s:', aid, mid, e && e.message);
      return { ok: false, error: '领取失败，请稍后重试' };
    } finally {
      try { conn.release(); } catch (_) {}
    }

    _invalidatePlayerReadCache(aid);
    playerWriteCache.clear(aid);
    if (finalPlayer && typeof finalPlayer === 'object') {
      _setAsyncReadCache(aid, finalPlayer);
      _attachPlayerDbRevision(finalPlayer, nextDbRev);
      _setPlayerDbRevision(aid, nextDbRev);
      _recordPlayerState(aid, finalPlayer, { bump: true });
      _tryUpdateAutoBattleIndex(aid, finalPlayer, null);
    }
    return { ok: true, player: finalPlayer };
  });
}

async function unmarkMailboxClaimedAsync(mailId, accountId) {
  if (!isMysqlDriver) return unmarkMailboxClaimed(mailId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE mailbox_messages
       SET status='unread', claimed_at=0
       WHERE id=? AND account_id=? AND status='claimed'`,
      [Number(mailId), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] unmarkMailboxClaimedAsync error mailId=%s accountId=%s:', mailId, accountId, e && e.message);
    throw e;
  }
}

async function deleteClaimedMailboxAsync(accountId) {
  if (!isMysqlDriver) return deleteClaimedMailbox(accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `DELETE FROM mailbox_messages
       WHERE account_id=? AND status='claimed'`,
      [Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] deleteClaimedMailboxAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

function createCityDuelLog(payload) {
  const stmt = db.prepare(`
    INSERT INTO city_duel_logs
      (challenger_account_id, target_account_id, winner_account_id,
       challenger_name, target_name,
       challenger_level, target_level,
       challenger_sect_name, target_sect_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
  `);
  const r = stmt.run(
    Number(payload.challenger_account_id) || 0,
    Number(payload.target_account_id) || 0,
    Number(payload.winner_account_id) || 0,
    String(payload.challenger_name || ''),
    String(payload.target_name || ''),
    Math.max(1, Math.floor(Number(payload.challenger_level) || 1)),
    Math.max(1, Math.floor(Number(payload.target_level) || 1)),
    String(payload.challenger_sect_name || '散修'),
    String(payload.target_sect_name || '散修')
  );
  return Number(r.lastInsertRowid);
}

/** 今日挑战次数（UTC+8 日；targetAccountId 可选，不传则只查 total） */
function countCityDuelChallengesToday(challengerAccountId, targetAccountId = null) {
  const aid = Number(challengerAccountId) || 0;
  if (aid <= 0) return { total: 0, perTarget: 0 };
  const today = "date(created_at, 'unixepoch', '+8 hours') = date('now', '+8 hours')";
  if (targetAccountId == null) {
    const r = db.prepare(`
      SELECT COUNT(1) AS c FROM city_duel_challenges
      WHERE challenger_account_id = ? AND ${today}
    `).get(aid);
    return { total: Number(r?.c || 0), perTarget: 0 };
  }
  const tid = Number(targetAccountId) || 0;
  const rTotal = db.prepare(`
    SELECT COUNT(1) AS c FROM city_duel_challenges
    WHERE challenger_account_id = ? AND ${today}
  `).get(aid);
  const rTarget = db.prepare(`
    SELECT COUNT(1) AS c FROM city_duel_challenges
    WHERE challenger_account_id = ? AND target_account_id = ? AND ${today}
  `).get(aid, tid);
  return {
    total: Number(rTotal?.c || 0),
    perTarget: Number(rTarget?.c || 0)
  };
}

function getDuelRankLastSettledPeriod() {
  const r = db.prepare('SELECT value FROM duel_rank_state WHERE key = ?').get('last_settled_period');
  return Number(r?.value ?? -1);
}

function getTopDuelRankAccount() {
  const sql = isMysqlDriver
    ? `SELECT account_id,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.duel_rank_score')) AS SIGNED), 1000) AS duel_rank_score
       FROM players
       ORDER BY duel_rank_score DESC, account_id ASC
       LIMIT 1`
    : `SELECT account_id,
              COALESCE(CAST(json_extract(data, '$.duel_rank_score') AS INTEGER), 1000) AS duel_rank_score
       FROM players
       ORDER BY duel_rank_score DESC, account_id ASC
       LIMIT 1`;
  const row = db.prepare(sql).get();
  if (!row) return null;
  return {
    account_id: Number(row.account_id || 0),
    duel_rank_score: Number(row.duel_rank_score || 1000)
  };
}

function resetAllDuelRankScores(score = 1000) {
  const target = Math.max(0, Math.floor(Number(score) || 1000));
  if (isMysqlDriver) {
    return db.prepare(`
      UPDATE players
      SET data = JSON_SET(COALESCE(data, '{}'), '$.duel_rank_score', ?),
          updated_at = UNIX_TIMESTAMP()
    `).run(target);
  }
  return db.prepare(`
    UPDATE players
    SET data = json_set(COALESCE(data, '{}'), '$.duel_rank_score', ?),
        updated_at = strftime('%s','now')
  `).run(target);
}

function setDuelRankLastSettledPeriod(periodIndex) {
  db.prepare(`
    INSERT OR REPLACE INTO duel_rank_state (key, value) VALUES ('last_settled_period', ?)
  `).run(Math.floor(Number(periodIndex) || -1));
}

function insertCityDuelChallenge(challengerAccountId, targetAccountId) {
  return db.prepare(`
    INSERT INTO city_duel_challenges (challenger_account_id, target_account_id, created_at)
    VALUES (?, ?, strftime('%s','now'))
  `).run(Number(challengerAccountId) || 0, Number(targetAccountId) || 0);
}

async function createCityDuelLogAsync(payload) {
  if (!isMysqlDriver) return createCityDuelLog(payload);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO city_duel_logs
        (challenger_account_id, target_account_id, winner_account_id,
         challenger_name, target_name,
         challenger_level, target_level,
         challenger_sect_name, target_sect_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP())`,
      [
        Number(payload?.challenger_account_id) || 0,
        Number(payload?.target_account_id) || 0,
        Number(payload?.winner_account_id) || 0,
        String(payload?.challenger_name || ''),
        String(payload?.target_name || ''),
        Math.max(1, Math.floor(Number(payload?.challenger_level) || 1)),
        Math.max(1, Math.floor(Number(payload?.target_level) || 1)),
        String(payload?.challenger_sect_name || '散修'),
        String(payload?.target_sect_name || '散修')
      ]
    );
    return Number(ret?.insertId || 0);
  } catch (e) {
    console.error('[db] createCityDuelLogAsync failed:', e && e.message);
    throw e;
  }
}

function _getUtc8DayRangeSec(nowSec = Math.floor(Date.now() / 1000)) {
  const shift = 8 * 3600;
  const dayStart = Math.floor((Math.max(0, Number(nowSec) || 0) + shift) / 86400) * 86400 - shift;
  return { dayStart, dayEnd: dayStart + 86400 };
}

async function countCityDuelChallengesTodayAsync(challengerAccountId, targetAccountId = null) {
  if (!isMysqlDriver) return countCityDuelChallengesToday(challengerAccountId, targetAccountId);
  const aid = Number(challengerAccountId) || 0;
  if (aid <= 0) return { total: 0, perTarget: 0 };
  const { dayStart, dayEnd } = _getUtc8DayRangeSec();
  try {
    if (targetAccountId == null) {
      const rows = await mysqlAsyncPool.query(
        `SELECT COUNT(1) AS c
         FROM city_duel_challenges
         WHERE challenger_account_id = ? AND created_at >= ? AND created_at < ?`,
        [aid, dayStart, dayEnd]
      );
      return { total: Number(rows?.[0]?.c || 0), perTarget: 0 };
    }
    const tid = Number(targetAccountId) || 0;
    const totalRows = await mysqlAsyncPool.query(
      `SELECT COUNT(1) AS c
       FROM city_duel_challenges
       WHERE challenger_account_id = ? AND created_at >= ? AND created_at < ?`,
      [aid, dayStart, dayEnd]
    );
    const targetRows = await mysqlAsyncPool.query(
      `SELECT COUNT(1) AS c
       FROM city_duel_challenges
       WHERE challenger_account_id = ? AND target_account_id = ? AND created_at >= ? AND created_at < ?`,
      [aid, tid, dayStart, dayEnd]
    );
    return {
      total: Number(totalRows?.[0]?.c || 0),
      perTarget: Number(targetRows?.[0]?.c || 0)
    };
  } catch (e) {
    console.error('[db] countCityDuelChallengesTodayAsync failed challenger=%s target=%s:', challengerAccountId, targetAccountId, e && e.message);
    throw e;
  }
}

async function getDuelRankLastSettledPeriodAsync() {
  if (!isMysqlDriver) return getDuelRankLastSettledPeriod();
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT value FROM duel_rank_state WHERE `key` = ? LIMIT 1',
      ['last_settled_period']
    );
    return Number(rows?.[0]?.value ?? -1);
  } catch (e) {
    console.error('[db] getDuelRankLastSettledPeriodAsync failed:', e && e.message);
    throw e;
  }
}

async function getTopDuelRankAccountAsync() {
  if (!isMysqlDriver) return getTopDuelRankAccount();
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT account_id,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.duel_rank_score')) AS SIGNED), 1000) AS duel_rank_score
       FROM players
       ORDER BY duel_rank_score DESC, account_id ASC
       LIMIT 1`
    );
    const row = rows && rows[0];
    if (!row) return null;
    return {
      account_id: Number(row.account_id || 0),
      duel_rank_score: Number(row.duel_rank_score || 1000)
    };
  } catch (e) {
    console.error('[db] getTopDuelRankAccountAsync failed:', e && e.message);
    throw e;
  }
}

async function resetAllDuelRankScoresAsync(score = 1000) {
  const target = Math.max(0, Math.floor(Number(score) || 1000));
  if (!isMysqlDriver) return resetAllDuelRankScores(target);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE players
       SET data = JSON_SET(COALESCE(data, '{}'), '$.duel_rank_score', ?),
           updated_at = UNIX_TIMESTAMP()`,
      [target]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] resetAllDuelRankScoresAsync failed score=%s:', target, e && e.message);
    throw e;
  }
}

async function setDuelRankLastSettledPeriodAsync(periodIndex) {
  if (!isMysqlDriver) return setDuelRankLastSettledPeriod(periodIndex);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO duel_rank_state (\`key\`, value)
       VALUES ('last_settled_period', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [Math.floor(Number(periodIndex) || -1)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] setDuelRankLastSettledPeriodAsync failed periodIndex=%s:', periodIndex, e && e.message);
    throw e;
  }
}

async function insertCityDuelChallengeAsync(challengerAccountId, targetAccountId) {
  if (!isMysqlDriver) return insertCityDuelChallenge(challengerAccountId, targetAccountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO city_duel_challenges (challenger_account_id, target_account_id, created_at)
       VALUES (?, ?, UNIX_TIMESTAMP())`,
      [Number(challengerAccountId) || 0, Number(targetAccountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0), lastInsertRowid: Number(ret?.insertId || 0) };
  } catch (e) {
    console.error('[db] insertCityDuelChallengeAsync failed challenger=%s target=%s:', challengerAccountId, targetAccountId, e && e.message);
    throw e;
  }
}

// ---------- 仙盟 ----------
function listAlliances() {
  return db.prepare(`
    SELECT a.*, COUNT(m.account_id) AS member_count
    FROM alliances a
    LEFT JOIN alliance_members m ON a.id = m.alliance_id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `).all();
}

function createAlliance(name, description, creatorAccountId, rankNamesJson = '["仙友","仙长","尊者","长老","副盟主","盟主"]') {
  const r = db.prepare(`
    INSERT INTO alliances (name, description, level, creator_account_id, rank_names_json, created_at)
    VALUES (?, ?, 1, ?, ?, strftime('%s','now'))
  `).run(String(name).trim(), String(description || '').trim(), Number(creatorAccountId) || 0, String(rankNamesJson));
  const id = Number(r.lastInsertRowid);
  db.prepare(`
    INSERT INTO alliance_members (alliance_id, account_id, rank, joined_at)
    VALUES (?, ?, 5, strftime('%s','now'))
  `).run(id, Number(creatorAccountId) || 0);
  return id;
}

function getAllianceById(id) {
  const r = db.prepare('SELECT * FROM alliances WHERE id = ?').get(Number(id));
  if (!r) return null;
  let warehouse = [];
  try { warehouse = JSON.parse(r.warehouse_json || '[]'); } catch (_) {}
  if (!Array.isArray(warehouse)) warehouse = [];
  const pages = Math.max(10, Math.floor(Number(r.warehouse_pages) || 10));
  while (warehouse.length < pages) warehouse.push(Array(20).fill(null));
  return {
    ...r,
    rank_names: (() => {
      try { return JSON.parse(r.rank_names_json || '[]'); } catch (_) { return ['仙友','仙长','尊者','长老','副盟主','盟主']; }
    })(),
    warehouse,
    materials: Math.max(0, Math.floor(Number(r.materials) || 0)),
    warehouse_pages: pages
  };
}

function getAllianceByName(name) {
  return db.prepare('SELECT * FROM alliances WHERE name = ?').get(String(name).trim());
}

function updateAlliance(id, updates) {
  const keys = Object.keys(updates || {}).filter(k => ['name','description','level','rank_names_json','materials','warehouse_pages','warehouse_json','statue_level','spirit_pool_level','garden_level','enlightenment_tree_level','treasury_level','gate_level','treasury_refresh_date','treasury_goods_json'].includes(k));
  if (keys.length === 0) return;
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const args = keys.map(k => {
    if (k === 'rank_names_json') return typeof updates[k] === 'string' ? updates[k] : JSON.stringify(updates[k] || []);
    return updates[k];
  });
  args.push(Number(id));
  db.prepare(`UPDATE alliances SET ${setClause} WHERE id = ?`).run(...args);
}

function listAllianceMembers(allianceId) {
  const rows = db.prepare(`
    SELECT m.*, a.username, a.is_banned, a.ban_expires_at, json_extract(p.data, '$.name') AS player_name
    FROM alliance_members m
    LEFT JOIN accounts a ON m.account_id = a.id
    LEFT JOIN players p ON p.account_id = m.account_id
    WHERE m.alliance_id = ?
    ORDER BY m.rank DESC, m.joined_at ASC
  `).all(Number(allianceId));
  return rows.map(r => {
    let raw = (r.player_name != null && r.player_name !== '') ? String(r.player_name).trim() : '';
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"'); // json_extract 某些版本可能带引号
    }
    return {
      ...r,
      player_name: raw || r.username || '?'
    };
  });
}

function addAllianceMember(allianceId, accountId, rank = 0) {
  return db.prepare(`
    INSERT OR REPLACE INTO alliance_members (alliance_id, account_id, rank, contribution, joined_at)
    VALUES (?, ?, ?, 0, strftime('%s','now'))
  `).run(Number(allianceId) || 0, Number(accountId) || 0, Math.max(0, Math.min(5, Number(rank) || 0)));
}

function addAllianceMemberContribution(allianceId, accountId, delta) {
  const m = db.prepare('SELECT contribution FROM alliance_members WHERE alliance_id = ? AND account_id = ?').get(Number(allianceId), Number(accountId));
  if (!m) return;
  const cur = Math.max(0, Math.floor(Number(m.contribution) || 0));
  db.prepare('UPDATE alliance_members SET contribution = ? WHERE alliance_id = ? AND account_id = ?').run(cur + Math.floor(Number(delta) || 0), Number(allianceId), Number(accountId));
}

function getAllianceMemberContribution(allianceId, accountId) {
  const r = db.prepare('SELECT contribution FROM alliance_members WHERE alliance_id = ? AND account_id = ?').get(Number(allianceId), Number(accountId));
  return r ? Math.max(0, Math.floor(Number(r.contribution) || 0)) : 0;
}

function removeAllianceMember(allianceId, accountId) {
  return db.prepare(`
    DELETE FROM alliance_members WHERE alliance_id = ? AND account_id = ?
  `).run(Number(allianceId) || 0, Number(accountId) || 0);
}

function updateAllianceMemberRank(allianceId, accountId, rank) {
  return db.prepare(`
    UPDATE alliance_members SET rank = ? WHERE alliance_id = ? AND account_id = ?
  `).run(Math.max(0, Math.min(5, Number(rank) || 0)), Number(allianceId) || 0, Number(accountId) || 0);
}

function getAllianceMemberRank(allianceId, accountId) {
  const r = db.prepare(`
    SELECT rank FROM alliance_members WHERE alliance_id = ? AND account_id = ?
  `).get(Number(allianceId) || 0, Number(accountId) || 0);
  return r ? Number(r.rank) : -1;
}

function getApplicationByAllianceAndAccountAnyStatus(allianceId, accountId) {
  return db.prepare(`
    SELECT * FROM alliance_applications WHERE alliance_id = ? AND account_id = ?
  `).get(Number(allianceId) || 0, Number(accountId) || 0);
}

function createAllianceApplication(allianceId, accountId) {
  return db.prepare(`
    INSERT INTO alliance_applications (alliance_id, account_id, status, created_at)
    VALUES (?, ?, 'pending', strftime('%s','now'))
  `).run(Number(allianceId) || 0, Number(accountId) || 0);
}

function renewAllianceApplication(allianceId, accountId) {
  return db.prepare(`
    UPDATE alliance_applications SET status = 'pending', created_at = strftime('%s','now')
    WHERE alliance_id = ? AND account_id = ? AND status != 'pending'
  `).run(Number(allianceId) || 0, Number(accountId) || 0);
}

function listAlliancePendingApplications(allianceId) {
  return db.prepare(`
    SELECT * FROM alliance_applications
    WHERE alliance_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(Number(allianceId) || 0);
}

function updateAllianceApplicationStatus(id, status) {
  return db.prepare(`
    UPDATE alliance_applications SET status = ? WHERE id = ? AND status = 'pending'
  `).run(String(status), Number(id));
}

function getApplicationByAllianceAndAccount(allianceId, accountId) {
  return db.prepare(`
    SELECT * FROM alliance_applications WHERE alliance_id = ? AND account_id = ? AND status = 'pending'
  `).get(Number(allianceId) || 0, Number(accountId) || 0);
}

function getApplicationById(id) {
  return db.prepare('SELECT * FROM alliance_applications WHERE id = ?').get(Number(id) || 0);
}

function countAllianceMembersByRank(allianceId, rank) {
  const r = db.prepare(`
    SELECT COUNT(1) AS c FROM alliance_members WHERE alliance_id = ? AND rank = ?
  `).get(Number(allianceId) || 0, Math.max(0, Math.min(5, Number(rank) || 0)));
  return Number(r?.c || 0);
}

function addAllianceWithdrawAuth(allianceId, accountId) {
  return db.prepare(`
    INSERT OR IGNORE INTO alliance_withdraw_auth (alliance_id, account_id) VALUES (?, ?)
  `).run(Number(allianceId) || 0, Number(accountId) || 0);
}

function removeAllianceWithdrawAuth(allianceId, accountId) {
  return db.prepare(`
    DELETE FROM alliance_withdraw_auth WHERE alliance_id = ? AND account_id = ?
  `).run(Number(allianceId) || 0, Number(accountId) || 0);
}

function hasAllianceWithdrawAuth(allianceId, accountId) {
  const r = db.prepare(`
    SELECT 1 FROM alliance_withdraw_auth WHERE alliance_id = ? AND account_id = ?
  `).get(Number(allianceId) || 0, Number(accountId) || 0);
  return !!r;
}

function listAllianceWithdrawAuth(allianceId) {
  return db.prepare(`
    SELECT w.account_id, a.username FROM alliance_withdraw_auth w
    LEFT JOIN accounts a ON w.account_id = a.id
    WHERE w.alliance_id = ?
  `).all(Number(allianceId) || 0);
}

// ─── P3: 仙盟异步实现（MySQL 驱动） ───
function _normalizeAllianceRow(row) {
  if (!row) return null;
  let warehouse = [];
  try { warehouse = JSON.parse(row.warehouse_json || '[]'); } catch (_) {}
  if (!Array.isArray(warehouse)) warehouse = [];
  const pages = Math.max(10, Math.floor(Number(row.warehouse_pages) || 10));
  while (warehouse.length < pages) warehouse.push(Array(20).fill(null));
  let rankNames = ['仙友', '仙长', '尊者', '长老', '副盟主', '盟主'];
  try {
    const parsed = JSON.parse(row.rank_names_json || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) rankNames = parsed;
  } catch (_) {}
  return {
    ...row,
    rank_names: rankNames,
    warehouse,
    materials: Math.max(0, Math.floor(Number(row.materials) || 0)),
    warehouse_pages: pages
  };
}

async function listAlliancesAsync() {
  if (!isMysqlDriver) return listAlliances();
  try {
    return await mysqlAsyncPool.query(
      `SELECT a.*, COUNT(m.account_id) AS member_count
       FROM alliances a
       LEFT JOIN alliance_members m ON a.id = m.alliance_id
       GROUP BY a.id
       ORDER BY a.created_at DESC`
    );
  } catch (e) {
    console.error('[db] listAlliancesAsync error:', e && e.message);
    throw e;
  }
}

async function createAllianceAsync(name, description, creatorAccountId, rankNamesJson = '["仙友","仙长","尊者","长老","副盟主","盟主"]') {
  if (!isMysqlDriver) return createAlliance(name, description, creatorAccountId, rankNamesJson);
  try {
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) throw new Error('MySQL pool unavailable for createAllianceAsync');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [ins] = await conn.execute(
        `INSERT INTO alliances (name, description, level, creator_account_id, rank_names_json, created_at)
         VALUES (?, ?, 1, ?, ?, UNIX_TIMESTAMP())`,
        [String(name).trim(), String(description || '').trim(), Number(creatorAccountId) || 0, String(rankNamesJson)]
      );
      const id = Number(ins?.insertId || 0);
      await conn.execute(
        `REPLACE INTO alliance_members (alliance_id, account_id, \`rank\`, joined_at)
         VALUES (?, ?, 5, UNIX_TIMESTAMP())`,
        [id, Number(creatorAccountId) || 0]
      );
      await conn.commit();
      return id;
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] createAllianceAsync error creator=%s:', creatorAccountId, e && e.message);
    throw e;
  }
}

async function getAllianceByIdAsync(id) {
  if (!isMysqlDriver) return getAllianceById(id);
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM alliances WHERE id = ? LIMIT 1', [Number(id)]);
    return _normalizeAllianceRow(rows && rows[0]);
  } catch (e) {
    console.error('[db] getAllianceByIdAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function getAllianceByNameAsync(name) {
  if (!isMysqlDriver) return getAllianceByName(name);
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM alliances WHERE name = ? LIMIT 1', [String(name).trim()]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getAllianceByNameAsync error name=%s:', name, e && e.message);
    throw e;
  }
}

async function updateAllianceAsync(id, updates) {
  if (!isMysqlDriver) return updateAlliance(id, updates);
  const keys = Object.keys(updates || {}).filter(k => ['name','description','level','rank_names_json','materials','warehouse_pages','warehouse_json','statue_level','spirit_pool_level','garden_level','enlightenment_tree_level','treasury_level','gate_level','treasury_refresh_date','treasury_goods_json'].includes(k));
  if (keys.length === 0) return;
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const args = keys.map(k => {
    if (k === 'rank_names_json') return typeof updates[k] === 'string' ? updates[k] : JSON.stringify(updates[k] || []);
    return updates[k];
  });
  args.push(Number(id));
  try {
    await mysqlAsyncPool.execute(`UPDATE alliances SET ${setClause} WHERE id = ?`, args);
  } catch (e) {
    console.error('[db] updateAllianceAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function listAllianceMembersAsync(allianceId) {
  if (!isMysqlDriver) return listAllianceMembers(allianceId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT m.*, a.username, a.is_banned, a.ban_expires_at, JSON_UNQUOTE(JSON_EXTRACT(p.data, '$.name')) AS player_name
       FROM alliance_members m
       LEFT JOIN accounts a ON m.account_id = a.id
       LEFT JOIN players p ON p.account_id = m.account_id
       WHERE m.alliance_id = ?
       ORDER BY m.\`rank\` DESC, m.joined_at ASC`,
      [Number(allianceId)]
    );
    return (rows || []).map((r) => {
      const raw = (r.player_name != null && r.player_name !== '') ? String(r.player_name).trim() : '';
      return {
        ...r,
        player_name: raw || r.username || '?'
      };
    });
  } catch (e) {
    console.error('[db] listAllianceMembersAsync error allianceId=%s:', allianceId, e && e.message);
    throw e;
  }
}

async function addAllianceMemberAsync(allianceId, accountId, rank = 0) {
  if (!isMysqlDriver) return addAllianceMember(allianceId, accountId, rank);
  try {
    const ret = await mysqlAsyncPool.execute(
      `REPLACE INTO alliance_members (alliance_id, account_id, \`rank\`, contribution, joined_at)
       VALUES (?, ?, ?, 0, UNIX_TIMESTAMP())`,
      [Number(allianceId) || 0, Number(accountId) || 0, Math.max(0, Math.min(5, Number(rank) || 0))]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] addAllianceMemberAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function addAllianceMemberContributionAsync(allianceId, accountId, delta) {
  if (!isMysqlDriver) return addAllianceMemberContribution(allianceId, accountId, delta);
  try {
    const d = Math.floor(Number(delta) || 0);
    const ret = await mysqlAsyncPool.execute(
      `UPDATE alliance_members
       SET contribution = GREATEST(0, contribution) + ?
       WHERE alliance_id = ? AND account_id = ?`,
      [d, Number(allianceId), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] addAllianceMemberContributionAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function getAllianceMemberContributionAsync(allianceId, accountId) {
  if (!isMysqlDriver) return getAllianceMemberContribution(allianceId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT contribution FROM alliance_members WHERE alliance_id = ? AND account_id = ? LIMIT 1',
      [Number(allianceId), Number(accountId)]
    );
    const r = rows && rows[0];
    return r ? Math.max(0, Math.floor(Number(r.contribution) || 0)) : 0;
  } catch (e) {
    console.error('[db] getAllianceMemberContributionAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function removeAllianceMemberAsync(allianceId, accountId) {
  if (!isMysqlDriver) return removeAllianceMember(allianceId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      'DELETE FROM alliance_members WHERE alliance_id = ? AND account_id = ?',
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] removeAllianceMemberAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function updateAllianceMemberRankAsync(allianceId, accountId, rank) {
  if (!isMysqlDriver) return updateAllianceMemberRank(allianceId, accountId, rank);
  try {
    const ret = await mysqlAsyncPool.execute(
      'UPDATE alliance_members SET `rank` = ? WHERE alliance_id = ? AND account_id = ?',
      [Math.max(0, Math.min(5, Number(rank) || 0)), Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateAllianceMemberRankAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function getAllianceMemberRankAsync(allianceId, accountId) {
  if (!isMysqlDriver) return getAllianceMemberRank(allianceId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT `rank` FROM alliance_members WHERE alliance_id = ? AND account_id = ? LIMIT 1',
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    const r = rows && rows[0];
    return r ? Number(r.rank) : -1;
  } catch (e) {
    console.error('[db] getAllianceMemberRankAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function getApplicationByAllianceAndAccountAnyStatusAsync(allianceId, accountId) {
  if (!isMysqlDriver) return getApplicationByAllianceAndAccountAnyStatus(allianceId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM alliance_applications WHERE alliance_id = ? AND account_id = ? LIMIT 1',
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getApplicationByAllianceAndAccountAnyStatusAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function createAllianceApplicationAsync(allianceId, accountId) {
  if (!isMysqlDriver) return createAllianceApplication(allianceId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO alliance_applications (alliance_id, account_id, status, created_at)
       VALUES (?, ?, 'pending', UNIX_TIMESTAMP())`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] createAllianceApplicationAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function renewAllianceApplicationAsync(allianceId, accountId) {
  if (!isMysqlDriver) return renewAllianceApplication(allianceId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE alliance_applications SET status = 'pending', created_at = UNIX_TIMESTAMP()
       WHERE alliance_id = ? AND account_id = ? AND status != 'pending'`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] renewAllianceApplicationAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function listAlliancePendingApplicationsAsync(allianceId) {
  if (!isMysqlDriver) return listAlliancePendingApplications(allianceId);
  try {
    return await mysqlAsyncPool.query(
      `SELECT * FROM alliance_applications
       WHERE alliance_id = ? AND status = 'pending'
       ORDER BY created_at ASC`,
      [Number(allianceId) || 0]
    );
  } catch (e) {
    console.error('[db] listAlliancePendingApplicationsAsync error allianceId=%s:', allianceId, e && e.message);
    throw e;
  }
}

async function updateAllianceApplicationStatusAsync(id, status) {
  if (!isMysqlDriver) return updateAllianceApplicationStatus(id, status);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE alliance_applications SET status = ? WHERE id = ? AND status = 'pending'`,
      [String(status), Number(id)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateAllianceApplicationStatusAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function getApplicationByAllianceAndAccountAsync(allianceId, accountId) {
  if (!isMysqlDriver) return getApplicationByAllianceAndAccount(allianceId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT * FROM alliance_applications WHERE alliance_id = ? AND account_id = ? AND status = 'pending' LIMIT 1`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getApplicationByAllianceAndAccountAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function getApplicationByIdAsync(id) {
  if (!isMysqlDriver) return getApplicationById(id);
  try {
    const rows = await mysqlAsyncPool.query('SELECT * FROM alliance_applications WHERE id = ? LIMIT 1', [Number(id) || 0]);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getApplicationByIdAsync error id=%s:', id, e && e.message);
    throw e;
  }
}

async function countAllianceMembersByRankAsync(allianceId, rank) {
  if (!isMysqlDriver) return countAllianceMembersByRank(allianceId, rank);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT COUNT(1) AS c FROM alliance_members WHERE alliance_id = ? AND `rank` = ?',
      [Number(allianceId) || 0, Math.max(0, Math.min(5, Number(rank) || 0))]
    );
    const r = rows && rows[0];
    return Number(r?.c || 0);
  } catch (e) {
    console.error('[db] countAllianceMembersByRankAsync error allianceId=%s rank=%s:', allianceId, rank, e && e.message);
    throw e;
  }
}

async function addAllianceWithdrawAuthAsync(allianceId, accountId) {
  if (!isMysqlDriver) return addAllianceWithdrawAuth(allianceId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT IGNORE INTO alliance_withdraw_auth (alliance_id, account_id) VALUES (?, ?)`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] addAllianceWithdrawAuthAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function removeAllianceWithdrawAuthAsync(allianceId, accountId) {
  if (!isMysqlDriver) return removeAllianceWithdrawAuth(allianceId, accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      `DELETE FROM alliance_withdraw_auth WHERE alliance_id = ? AND account_id = ?`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] removeAllianceWithdrawAuthAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function hasAllianceWithdrawAuthAsync(allianceId, accountId) {
  if (!isMysqlDriver) return hasAllianceWithdrawAuth(allianceId, accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT 1 FROM alliance_withdraw_auth WHERE alliance_id = ? AND account_id = ? LIMIT 1`,
      [Number(allianceId) || 0, Number(accountId) || 0]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error('[db] hasAllianceWithdrawAuthAsync error allianceId=%s accountId=%s:', allianceId, accountId, e && e.message);
    throw e;
  }
}

async function listAllianceWithdrawAuthAsync(allianceId) {
  if (!isMysqlDriver) return listAllianceWithdrawAuth(allianceId);
  try {
    return await mysqlAsyncPool.query(
      `SELECT w.account_id, a.username FROM alliance_withdraw_auth w
       LEFT JOIN accounts a ON w.account_id = a.id
       WHERE w.alliance_id = ?`,
      [Number(allianceId) || 0]
    );
  } catch (e) {
    console.error('[db] listAllianceWithdrawAuthAsync error allianceId=%s:', allianceId, e && e.message);
    throw e;
  }
}

function listCityDuelLogsByAccount(accountId, {
  page = 1,
  pageSize = 20,
  role = 'all'
} = {}) {
  const aid = Number(accountId) || 0;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  let where = 'WHERE (challenger_account_id = ? OR target_account_id = ?)';
  const args = [aid, aid];
  if (role === 'challenger') {
    where += ' AND challenger_account_id = ?';
    args.push(aid);
  } else if (role === 'target') {
    where += ' AND target_account_id = ?';
    args.push(aid);
  }
  const list = db.prepare(`
    SELECT *
    FROM city_duel_logs
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...args, ps, offset);
  const totalRow = db.prepare(`
    SELECT COUNT(1) AS c
    FROM city_duel_logs
    ${where}
  `).get(...args);
  return {
    list,
    total: Number(totalRow?.c || 0),
    page: p,
    pageSize: ps
  };
}

async function listCityDuelLogsByAccountAsync(accountId, {
  page = 1,
  pageSize = 20,
  role = 'all'
} = {}) {
  if (!isMysqlDriver) {
    return listCityDuelLogsByAccount(accountId, { page, pageSize, role });
  }
  const aid = Number(accountId) || 0;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  let where = 'WHERE (challenger_account_id = ? OR target_account_id = ?)';
  const args = [aid, aid];
  if (role === 'challenger') {
    where += ' AND challenger_account_id = ?';
    args.push(aid);
  } else if (role === 'target') {
    where += ' AND target_account_id = ?';
    args.push(aid);
  }
  try {
    const list = await mysqlAsyncPool.query(
      `SELECT *
       FROM city_duel_logs
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...args, ps, offset]
    );
    const totalRows = await mysqlAsyncPool.query(
      `SELECT COUNT(1) AS c
       FROM city_duel_logs
       ${where}`,
      args
    );
    return {
      list: Array.isArray(list) ? list : [],
      total: Number(totalRows?.[0]?.c || 0),
      page: p,
      pageSize: ps
    };
  } catch (e) {
    console.error('[db] listCityDuelLogsByAccountAsync failed accountId=%s role=%s:', accountId, role, e && e.message);
    throw e;
  }
}

// 清理过期队伍
function cleanupExpiredTeams() {
  db.prepare(`DELETE FROM dungeon_teams WHERE expires_at <= strftime('%s','now')`).run();
}

setInterval(() => {
  try {
    cleanupExpiredTeams();
  } catch (e) {
    console.error('[db] cleanupExpiredTeams failed:', e?.message || e);
  }
}, 60000);

// ── 邀请系统 ──
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateInviteCode() {
  let s = '';
  const crypto = require('crypto');
  const buf = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += INVITE_CODE_CHARS[buf[i] % INVITE_CODE_CHARS.length];
  return s;
}

function getOrCreateInviter(accountId) {
  let r = db.prepare('SELECT * FROM invite_inviters WHERE account_id = ?').get(Number(accountId));
  if (!r) {
    let code = generateInviteCode();
    while (db.prepare('SELECT 1 FROM invite_inviters WHERE invite_code = ?').get(code)) {
      code = generateInviteCode();
    }
    db.prepare(`
      INSERT INTO invite_inviters (account_id, invite_code, stored_stones, per_person_stones, invite_points, updated_at)
      VALUES (?, ?, 0, 0, 0, strftime('%s','now'))
    `).run(Number(accountId), code);
    r = db.prepare('SELECT * FROM invite_inviters WHERE account_id = ?').get(Number(accountId));
  }
  return r;
}

function getInviterByCode(code) {
  return db.prepare('SELECT * FROM invite_inviters WHERE invite_code = ?').get(String(code || '').trim().toUpperCase());
}

function getInviteBinding(inviteeAccountId) {
  return db.prepare('SELECT * FROM invite_bindings WHERE invitee_account_id = ?').get(Number(inviteeAccountId));
}

function createInviteBinding(inviteeAccountId, inviterAccountId, stonesGranted = 0) {
  const sg = stonesGranted > 0 ? Math.floor(Number(stonesGranted)) : null;
  return db.prepare(`
    INSERT INTO invite_bindings (invitee_account_id, inviter_account_id, bound_at, stones_granted)
    VALUES (?, ?, strftime('%s','now'), ?)
  `).run(Number(inviteeAccountId), Number(inviterAccountId), sg);
}

function updateInviteBindingStones(inviteeAccountId, stonesGranted) {
  return db.prepare(`UPDATE invite_bindings SET stones_granted = ? WHERE invitee_account_id = ?`)
    .run(Math.max(0, Math.floor(Number(stonesGranted) || 0)), Number(inviteeAccountId));
}

function updateInviterStorage(accountId, storedStones, perPersonStones) {
  getOrCreateInviter(accountId);
  return db.prepare(`
    UPDATE invite_inviters SET stored_stones = ?, per_person_stones = ?, updated_at = strftime('%s','now')
    WHERE account_id = ?
  `).run(Math.max(0, Math.floor(Number(storedStones) || 0)), Math.max(0, Math.floor(Number(perPersonStones) || 0)), Number(accountId));
}

function getInviterStorage(accountId) {
  const r = db.prepare('SELECT stored_stones, per_person_stones, invite_points FROM invite_inviters WHERE account_id = ?').get(Number(accountId));
  return r || { stored_stones: 0, per_person_stones: 0, invite_points: 0 };
}

function addInviterPoints(accountId, amount) {
  getOrCreateInviter(accountId);
  return db.prepare(`
    UPDATE invite_inviters SET invite_points = invite_points + ?, updated_at = strftime('%s','now')
    WHERE account_id = ?
  `).run(Math.max(0, Math.floor(Number(amount) || 0)), Number(accountId));
}

/** 原子扣减邀请人存储灵石，防止并发导致超发。返回是否扣减成功 */
function deductInviterStones(accountId, amount) {
  if (amount <= 0) return true;
  const result = db.prepare(`
    UPDATE invite_inviters SET stored_stones = stored_stones - ?, updated_at = strftime('%s','now')
    WHERE account_id = ? AND stored_stones >= ?
  `).run(amount, Number(accountId), amount);
  return result.changes > 0;
}

function listInvitees(inviterAccountId) {
  return db.prepare(`
    SELECT b.invitee_account_id, b.bound_at, b.stones_granted, a.username, a.created_at
    FROM invite_bindings b
    LEFT JOIN accounts a ON a.id = b.invitee_account_id
    WHERE b.inviter_account_id = ?
  `).all(Number(inviterAccountId));
}

function hasClaimedInvitePoints(inviterAccountId, inviteeAccountId) {
  const r = db.prepare(`
    SELECT 1 FROM invite_point_claims WHERE inviter_account_id = ? AND invitee_account_id = ?
  `).get(Number(inviterAccountId), Number(inviteeAccountId));
  return !!r;
}

function claimInvitePoints(inviterAccountId, inviteeAccountId, points) {
  return db.prepare(`
    INSERT INTO invite_point_claims (inviter_account_id, invitee_account_id, claimed_at)
    VALUES (?, ?, strftime('%s','now'))
  `).run(Number(inviterAccountId), Number(inviteeAccountId));
}

/** 原子扣减邀请积分，防止并发导致超扣/超发 */
function deductInvitePoints(accountId, amount) {
  if (amount <= 0) return true;
  const result = db.prepare(`
    UPDATE invite_inviters SET invite_points = invite_points - ?, updated_at = strftime('%s','now')
    WHERE account_id = ? AND invite_points >= ?
  `).run(amount, Number(accountId), amount);
  return result.changes > 0;
}

// ─── P3: 邀请系统异步实现（MySQL 驱动） ───
async function getOrCreateInviterAsync(accountId) {
  if (!isMysqlDriver) return getOrCreateInviter(accountId);
  const aid = Number(accountId);
  try {
    const exists = await mysqlAsyncPool.query('SELECT * FROM invite_inviters WHERE account_id = ? LIMIT 1', [aid]);
    if (Array.isArray(exists) && exists[0]) return exists[0];

    for (let i = 0; i < 12; i += 1) {
      const code = generateInviteCode();
      try {
        await mysqlAsyncPool.execute(
          `INSERT INTO invite_inviters (account_id, invite_code, stored_stones, per_person_stones, invite_points, updated_at)
           VALUES (?, ?, 0, 0, 0, UNIX_TIMESTAMP())`,
          [aid, code]
        );
        const rows = await mysqlAsyncPool.query('SELECT * FROM invite_inviters WHERE account_id = ? LIMIT 1', [aid]);
        if (Array.isArray(rows) && rows[0]) return rows[0];
      } catch (e) {
        // 可能是 code 冲突或 account 并发创建，重查一次 account 即可。
        const rows = await mysqlAsyncPool.query('SELECT * FROM invite_inviters WHERE account_id = ? LIMIT 1', [aid]);
        if (Array.isArray(rows) && rows[0]) return rows[0];
        if (String(e?.code || '') !== 'ER_DUP_ENTRY') throw e;
      }
    }
    throw new Error('failed to allocate invite code');
  } catch (e) {
    console.error('[db] getOrCreateInviterAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getInviterByCodeAsync(code) {
  if (!isMysqlDriver) return getInviterByCode(code);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM invite_inviters WHERE invite_code = ? LIMIT 1',
      [String(code || '').trim().toUpperCase()]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getInviterByCodeAsync error code=%s:', code, e && e.message);
    throw e;
  }
}

async function getInviteBindingAsync(inviteeAccountId) {
  if (!isMysqlDriver) return getInviteBinding(inviteeAccountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM invite_bindings WHERE invitee_account_id = ? LIMIT 1',
      [Number(inviteeAccountId)]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getInviteBindingAsync error invitee=%s:', inviteeAccountId, e && e.message);
    throw e;
  }
}

async function createInviteBindingAsync(inviteeAccountId, inviterAccountId, stonesGranted = 0) {
  if (!isMysqlDriver) return createInviteBinding(inviteeAccountId, inviterAccountId, stonesGranted);
  const sg = stonesGranted > 0 ? Math.floor(Number(stonesGranted)) : null;
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO invite_bindings (invitee_account_id, inviter_account_id, bound_at, stones_granted)
       VALUES (?, ?, UNIX_TIMESTAMP(), ?)`,
      [Number(inviteeAccountId), Number(inviterAccountId), sg]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] createInviteBindingAsync error invitee=%s inviter=%s:', inviteeAccountId, inviterAccountId, e && e.message);
    throw e;
  }
}

async function updateInviteBindingStonesAsync(inviteeAccountId, stonesGranted) {
  if (!isMysqlDriver) return updateInviteBindingStones(inviteeAccountId, stonesGranted);
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE invite_bindings SET stones_granted = ? WHERE invitee_account_id = ?`,
      [Math.max(0, Math.floor(Number(stonesGranted) || 0)), Number(inviteeAccountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateInviteBindingStonesAsync error invitee=%s:', inviteeAccountId, e && e.message);
    throw e;
  }
}

async function updateInviterStorageAsync(accountId, storedStones, perPersonStones) {
  if (!isMysqlDriver) return updateInviterStorage(accountId, storedStones, perPersonStones);
  try {
    await getOrCreateInviterAsync(accountId);
    const ret = await mysqlAsyncPool.execute(
      `UPDATE invite_inviters
       SET stored_stones = ?, per_person_stones = ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ?`,
      [Math.max(0, Math.floor(Number(storedStones) || 0)), Math.max(0, Math.floor(Number(perPersonStones) || 0)), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateInviterStorageAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getInviterStorageAsync(accountId) {
  if (!isMysqlDriver) return getInviterStorage(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT stored_stones, per_person_stones, invite_points FROM invite_inviters WHERE account_id = ? LIMIT 1',
      [Number(accountId)]
    );
    return (rows && rows[0]) || { stored_stones: 0, per_person_stones: 0, invite_points: 0 };
  } catch (e) {
    console.error('[db] getInviterStorageAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function addInviterPointsAsync(accountId, amount) {
  if (!isMysqlDriver) return addInviterPoints(accountId, amount);
  try {
    await getOrCreateInviterAsync(accountId);
    const ret = await mysqlAsyncPool.execute(
      `UPDATE invite_inviters
       SET invite_points = invite_points + ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ?`,
      [Math.max(0, Math.floor(Number(amount) || 0)), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] addInviterPointsAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function deductInviterStonesAsync(accountId, amount) {
  if (!isMysqlDriver) return deductInviterStones(accountId, amount);
  if (amount <= 0) return true;
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE invite_inviters
       SET stored_stones = stored_stones - ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ? AND stored_stones >= ?`,
      [amount, Number(accountId), amount]
    );
    return Number(ret?.affectedRows || 0) > 0;
  } catch (e) {
    console.error('[db] deductInviterStonesAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function listInviteesAsync(inviterAccountId) {
  if (!isMysqlDriver) return listInvitees(inviterAccountId);
  try {
    return await mysqlAsyncPool.query(
      `SELECT b.invitee_account_id, b.bound_at, b.stones_granted, a.username, a.created_at
       FROM invite_bindings b
       LEFT JOIN accounts a ON a.id = b.invitee_account_id
       WHERE b.inviter_account_id = ?`,
      [Number(inviterAccountId)]
    );
  } catch (e) {
    console.error('[db] listInviteesAsync error inviter=%s:', inviterAccountId, e && e.message);
    throw e;
  }
}

async function hasClaimedInvitePointsAsync(inviterAccountId, inviteeAccountId) {
  if (!isMysqlDriver) return hasClaimedInvitePoints(inviterAccountId, inviteeAccountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT 1 FROM invite_point_claims WHERE inviter_account_id = ? AND invitee_account_id = ? LIMIT 1`,
      [Number(inviterAccountId), Number(inviteeAccountId)]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error('[db] hasClaimedInvitePointsAsync error inviter=%s invitee=%s:', inviterAccountId, inviteeAccountId, e && e.message);
    throw e;
  }
}

async function claimInvitePointsAsync(inviterAccountId, inviteeAccountId, points) {
  if (!isMysqlDriver) return claimInvitePoints(inviterAccountId, inviteeAccountId, points);
  try {
    const ret = await mysqlAsyncPool.execute(
      `INSERT INTO invite_point_claims (inviter_account_id, invitee_account_id, claimed_at)
       VALUES (?, ?, UNIX_TIMESTAMP())`,
      [Number(inviterAccountId), Number(inviteeAccountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] claimInvitePointsAsync error inviter=%s invitee=%s:', inviterAccountId, inviteeAccountId, e && e.message);
    throw e;
  }
}

async function deductInvitePointsAsync(accountId, amount) {
  if (!isMysqlDriver) return deductInvitePoints(accountId, amount);
  if (amount <= 0) return true;
  try {
    const ret = await mysqlAsyncPool.execute(
      `UPDATE invite_inviters
       SET invite_points = invite_points - ?, updated_at = UNIX_TIMESTAMP()
       WHERE account_id = ? AND invite_points >= ?`,
      [amount, Number(accountId), amount]
    );
    return Number(ret?.affectedRows || 0) > 0;
  } catch (e) {
    console.error('[db] deductInvitePointsAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

// ── 邮箱绑定 ──
function createEmailVerificationCode(accountId, email) {
  const crypto = require('crypto');
  const code = String(crypto.randomInt(100000, 999999));
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300; // 5 分钟有效
  db.prepare('UPDATE email_verification_codes SET used = 1 WHERE account_id = ? AND used = 0').run(Number(accountId));
  db.prepare(`
    INSERT INTO email_verification_codes (account_id, email, code, created_at, expires_at, used)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(Number(accountId), String(email).trim().toLowerCase(), code, now, expiresAt);
  return code;
}

function verifyEmailCode(accountId, email, code) {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT * FROM email_verification_codes
    WHERE account_id = ? AND email = ? AND code = ? AND used = 0 AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(Number(accountId), String(email).trim().toLowerCase(), String(code).trim(), now);
  if (!row) return false;
  db.prepare('UPDATE email_verification_codes SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

function bindAccountEmail(accountId, email) {
  return db.prepare(`
    UPDATE accounts SET email = ?, email_verified = 1 WHERE id = ?
  `).run(String(email).trim().toLowerCase(), Number(accountId));
}

function unbindAccountEmail(accountId) {
  return db.prepare(`
    UPDATE accounts SET email = '', email_verified = 0 WHERE id = ?
  `).run(Number(accountId));
}

function getAccountEmail(accountId) {
  const r = db.prepare('SELECT email, email_verified FROM accounts WHERE id = ?').get(Number(accountId));
  return r || { email: '', email_verified: 0 };
}

function isEmailTaken(email) {
  const r = db.prepare('SELECT 1 FROM accounts WHERE email = ? AND email_verified = 1 LIMIT 1')
    .get(String(email).trim().toLowerCase());
  return !!r;
}

function getRecentEmailCodeTime(accountId) {
  const r = db.prepare(`
    SELECT created_at FROM email_verification_codes
    WHERE account_id = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(Number(accountId));
  return r ? Number(r.created_at) : 0;
}

function getAccountByEmail(email) {
  return db.prepare('SELECT * FROM accounts WHERE email = ? AND email_verified = 1 LIMIT 1')
    .get(String(email).trim().toLowerCase());
}

function updateAccountPassword(accountId, newPassword) {
  return db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), Number(accountId));
}

// ─── P3: 邮箱/密码异步实现（MySQL 驱动） ───
async function createEmailVerificationCodeAsync(accountId, email) {
  if (!isMysqlDriver) return createEmailVerificationCode(accountId, email);
  const crypto = require('crypto');
  const code = String(crypto.randomInt(100000, 999999));
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300;
  const aid = Number(accountId);
  const normalEmail = String(email || '').trim().toLowerCase();
  try {
    await mysqlAsyncPool.execute(
      'UPDATE email_verification_codes SET used = 1 WHERE account_id = ? AND used = 0',
      [aid]
    );
    await mysqlAsyncPool.execute(
      `INSERT INTO email_verification_codes (account_id, email, code, created_at, expires_at, used)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [aid, normalEmail, code, now, expiresAt]
    );
    return code;
  } catch (e) {
    console.error('[db] createEmailVerificationCodeAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function verifyEmailCodeAsync(accountId, email, code) {
  if (!isMysqlDriver) return verifyEmailCode(accountId, email, code);
  const now = Math.floor(Date.now() / 1000);
  const aid = Number(accountId);
  const normalEmail = String(email || '').trim().toLowerCase();
  const c = String(code || '').trim();
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT id FROM email_verification_codes
       WHERE account_id = ? AND email = ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [aid, normalEmail, c, now]
    );
    const id = Number(rows?.[0]?.id || 0);
    if (id <= 0) return false;
    const ret = await mysqlAsyncPool.execute(
      'UPDATE email_verification_codes SET used = 1 WHERE id = ? AND used = 0',
      [id]
    );
    return Number(ret?.affectedRows || 0) > 0;
  } catch (e) {
    console.error('[db] verifyEmailCodeAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function bindAccountEmailAsync(accountId, email) {
  if (!isMysqlDriver) return bindAccountEmail(accountId, email);
  const aid = Number(accountId);
  const normalEmail = String(email || '').trim().toLowerCase();
  try {
    const ret = await mysqlAsyncPool.execute(
      'UPDATE accounts SET email = ?, email_verified = 1 WHERE id = ?',
      [normalEmail, aid]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] bindAccountEmailAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function unbindAccountEmailAsync(accountId) {
  if (!isMysqlDriver) return unbindAccountEmail(accountId);
  try {
    const ret = await mysqlAsyncPool.execute(
      "UPDATE accounts SET email = '', email_verified = 0 WHERE id = ?",
      [Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] unbindAccountEmailAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getAccountEmailAsync(accountId) {
  if (!isMysqlDriver) return getAccountEmail(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT email, email_verified FROM accounts WHERE id = ? LIMIT 1',
      [Number(accountId)]
    );
    return rows?.[0] || { email: '', email_verified: 0 };
  } catch (e) {
    console.error('[db] getAccountEmailAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function isEmailTakenAsync(email) {
  if (!isMysqlDriver) return isEmailTaken(email);
  const normalEmail = String(email || '').trim().toLowerCase();
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT 1 FROM accounts WHERE email = ? AND email_verified = 1 LIMIT 1',
      [normalEmail]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error('[db] isEmailTakenAsync failed email=%s:', email, e && e.message);
    throw e;
  }
}

async function getRecentEmailCodeTimeAsync(accountId) {
  if (!isMysqlDriver) return getRecentEmailCodeTime(accountId);
  try {
    const rows = await mysqlAsyncPool.query(
      `SELECT created_at FROM email_verification_codes
       WHERE account_id = ? AND used = 0
       ORDER BY created_at DESC LIMIT 1`,
      [Number(accountId)]
    );
    return Number(rows?.[0]?.created_at || 0);
  } catch (e) {
    console.error('[db] getRecentEmailCodeTimeAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

async function getAccountByEmailAsync(email) {
  if (!isMysqlDriver) return getAccountByEmail(email);
  const normalEmail = String(email || '').trim().toLowerCase();
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT * FROM accounts WHERE email = ? AND email_verified = 1 LIMIT 1',
      [normalEmail]
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error('[db] getAccountByEmailAsync failed email=%s:', email, e && e.message);
    throw e;
  }
}

async function updateAccountPasswordAsync(accountId, newPassword) {
  if (!isMysqlDriver) return updateAccountPassword(accountId, newPassword);
  try {
    const ret = await mysqlAsyncPool.execute(
      'UPDATE accounts SET password_hash = ? WHERE id = ?',
      [hashPassword(newPassword), Number(accountId)]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] updateAccountPasswordAsync failed accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

// ── 兑换码（账号级别） ──
function hasAccountRedeemed(accountId, code) {
  const r = db.prepare('SELECT 1 FROM account_redemptions WHERE account_id = ? AND code = ?')
    .get(Number(accountId), String(code).trim());
  return !!r;
}

function recordAccountRedemption(accountId, code) {
  db.prepare('INSERT OR IGNORE INTO account_redemptions (account_id, code) VALUES (?, ?)')
    .run(Number(accountId), String(code).trim());
}

async function hasAccountRedeemedAsync(accountId, code) {
  if (!isMysqlDriver) return hasAccountRedeemed(accountId, code);
  try {
    const rows = await mysqlAsyncPool.query(
      'SELECT 1 FROM account_redemptions WHERE account_id = ? AND code = ? LIMIT 1',
      [Number(accountId), String(code || '').trim()]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error('[db] hasAccountRedeemedAsync failed accountId=%s code=%s:', accountId, code, e && e.message);
    throw e;
  }
}

async function recordAccountRedemptionAsync(accountId, code) {
  if (!isMysqlDriver) return recordAccountRedemption(accountId, code);
  try {
    const ret = await mysqlAsyncPool.execute(
      'INSERT IGNORE INTO account_redemptions (account_id, code) VALUES (?, ?)',
      [Number(accountId), String(code || '').trim()]
    );
    return { changes: Number(ret?.affectedRows || 0) };
  } catch (e) {
    console.error('[db] recordAccountRedemptionAsync failed accountId=%s code=%s:', accountId, code, e && e.message);
    throw e;
  }
}

function wipeAccountData(accountId) {
  const aid = Number(accountId) || 0;
  if (aid <= 0) return { changes: 0 };
  _invalidatePlayerReadCache(aid);
  _invalidateAsyncReadCache(aid);
  playerWriteCache.clear(aid);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM battle_commands WHERE battle_id IN (SELECT id FROM battle_sessions WHERE account_id = ?)').run(aid);
    db.prepare('DELETE FROM battle_events WHERE battle_id IN (SELECT id FROM battle_sessions WHERE account_id = ?)').run(aid);
    db.prepare('DELETE FROM battle_sessions WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM players WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM dungeon_completions WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM dungeon_team_members WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM dungeon_team_members WHERE team_code IN (SELECT team_code FROM dungeon_teams WHERE leader_account_id = ?)').run(aid);
    db.prepare('DELETE FROM dungeon_teams WHERE leader_account_id = ?').run(aid);
    db.prepare('DELETE FROM dungeon_battle_sessions WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM mailbox_messages WHERE account_id = ?').run(aid);
    db.prepare('DELETE FROM city_duel_challenges WHERE challenger_account_id = ? OR target_account_id = ?').run(aid, aid);
  });
  tx();
  return { changes: 1 };
}

async function wipeAccountDataAsync(accountId) {
  if (!isMysqlDriver) return wipeAccountData(accountId);
  const aid = Number(accountId) || 0;
  if (aid <= 0) return { changes: 0 };
  try {
    _invalidatePlayerReadCache(aid);
    _invalidateAsyncReadCache(aid);
    if (typeof playerWriteCache.drainAccountAsync === 'function') {
      await playerWriteCache.drainAccountAsync(aid);
    }
    playerWriteCache.clear(aid);
    const pool = await mysqlAsyncPool.getPool();
    if (!pool) throw new Error('MySQL pool unavailable for wipeAccountDataAsync');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM battle_commands WHERE battle_id IN (SELECT id FROM battle_sessions WHERE account_id = ?)', [aid]);
      await conn.execute('DELETE FROM battle_events WHERE battle_id IN (SELECT id FROM battle_sessions WHERE account_id = ?)', [aid]);
      await conn.execute('DELETE FROM battle_sessions WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM players WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM dungeon_completions WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM dungeon_team_members WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM dungeon_team_members WHERE team_code IN (SELECT team_code FROM dungeon_teams WHERE leader_account_id = ?)', [aid]);
      await conn.execute('DELETE FROM dungeon_teams WHERE leader_account_id = ?', [aid]);
      await conn.execute('DELETE FROM dungeon_battle_sessions WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM mailbox_messages WHERE account_id = ?', [aid]);
      await conn.execute('DELETE FROM city_duel_challenges WHERE challenger_account_id = ? OR target_account_id = ?', [aid, aid]);
      await conn.commit();
      return { changes: 1 };
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] wipeAccountDataAsync error accountId=%s:', accountId, e && e.message);
    throw e;
  }
}

function flushPlayerCache() {
  playerWriteCache.flushSync();
}

module.exports = {
  db,
  isMysql: isMysqlDriver,
  getDateKey,
  flushPlayerCache,
  invalidatePlayerReadCache: _invalidatePlayerReadCache,
  clearAllPlayerReadCache: _clearAllPlayerReadCache,
  prefetchPlayerAsync,
  createAccount,
  createAccountAsync,
  getAccountByUsername,
  getAccountByUsernameAsync,
  getAccountByUsernameCaseInsensitiveAsync,
  getAccountById,
  getAccountByIdAsync,
  findAccountByRegisterTraits,
  findAccountByRegisterTraitsAsync,
  verifyPassword,
  verifyPasswordDetailed,
  insertMachineLoginLog,
  insertMachineLoginLogAsync,
  getAccountsByMachineId,
  getAccountsByMachineIdAsync,
  getAccountsByCurrentMachineId,
  getAccountsByCurrentMachineIdAsync,
  getMachineShareBanCount,
  getMachineShareBanCountAsync,
  isMachineShareExempt,
  isMachineShareExemptAsync,
  getCheatScanExemptUntil,
  getCheatScanExemptUntilAsync,
  isCheatScanExempt,
  isCheatScanExemptAsync,
  setCheatScanExemptUntil,
  setCheatScanExemptUntilAsync,
  clearExpiredBan,
  clearExpiredBanAsync,
  isAccountBanned,
  isAccountBannedAsync,
  banAccountMachineShare,
  banAccountMachineShareAsync,
  setAccountBanned,
  setAccountBannedAsync,
  updateAccountMachineId,
  updateAccountMachineIdAsync,
  updateAccountLoginIp,
  updateAccountLoginIpAsync,
  getIpBan,
  getIpBanAsync,
  isIpBanned,
  isIpBannedAsync,
  banIp,
  banIpAsync,
  unbanIp,
  unbanIpAsync,
  getAccountsByMachineIdAndIp,
  getAccountsByMachineIdAndIpAsync,
  getAccountsByLoginIp,
  getAccountsByLoginIpAsync,
  getPlayerByAccountId,
  getPlayerByAccountIdAsync,
  savePlayer,
  savePlayerImmediate,
  savePlayerImmediateAsync,
  getPlayerRuntimeState,
  getPlayerRuntimeStateAsync,
  updatePlayerAutoBattleIntent,
  updatePlayerAutoBattleIntentAsync,
  updatePlayerRestUntil,
  updatePlayerRestUntilAsync,
  updatePlayerLastActivity,
  updatePlayerLastActivityAsync,
  listAllPlayersRaw,
  listAllPlayersRawAsync,
  listAutoBattlePlayerRows,
  listAutoBattlePlayerRowsAsync,
  listPendingJobPlayerRows,
  listPendingJobPlayerRowsAsync,
  countPlayersBySect,
  countPlayersBySectAsync,
  listPlayerBriefAll,
  listPlayerBriefAllAsync,
  listLeagueLeaderboardRows,
  listLeagueLeaderboardRowsAsync,
  listLeagueTeamRankRows,
  listLeagueTeamRankRowsAsync,
  countLeagueTeamRankRows,
  countLeagueTeamRankRowsAsync,
  listLeagueMatchesByTeam,
  listLeagueMatchesByTeamAsync,
  listLeagueTeamsByMemberAccount,
  listLeagueTeamsByMemberAccountAsync,
  listLeagueTeamNamesByIds,
  listLeagueTeamNamesByIdsAsync,
  isPlayerNameTaken,
  isPlayerNameTakenAsync,
  createBattleSession,
  createBattleSessionAsync,
  getBattleSession,
  getBattleSessionAsync,
  getActiveBattleSessionByAccount,
  getActiveBattleSessionByAccountAsync,
  updateBattleSessionState,
  updateBattleSessionStateAsync,
  appendBattleCommand,
  appendBattleCommandAsync,
  getBattleCommand,
  getBattleCommandAsync,
  appendBattleEvents,
  appendBattleEventsAsync,
  listBattleEventsSince,
  listBattleEventsSinceAsync,
  finishBattleSession,
  finishBattleSessionAsync,
  deleteBattleSession,
  deleteBattleSessionAsync,
  getDungeonCompletionsToday,
  getDungeonCompletionsTodayAsync,
  incrementDungeonCompletions,
  incrementDungeonCompletionsAsync,
  getSectTaskCompletionsToday,
  getSectTaskCompletionsTodayAsync,
  incrementSectTaskCompletions,
  incrementSectTaskCompletionsAsync,
  saveDungeonBattle,
  saveDungeonBattleAsync,
  getDungeonBattle,
  getDungeonBattleAsync,
  deleteDungeonBattle,
  deleteDungeonBattleAsync,
  countActiveDungeonBattles,
  countActiveDungeonBattlesAsync,
  deleteAllDungeonBattlesForAccount,
  deleteAllDungeonBattlesForAccountAsync,
  cleanupExpiredDungeonBattles,
  cleanupExpiredDungeonBattlesAsync,
  createDungeonTeam,
  createDungeonTeamAsync,
  touchDungeonTeam,
  touchDungeonTeamAsync,
  joinDungeonTeam,
  joinDungeonTeamAsync,
  getDungeonTeam,
  getDungeonTeamAsync,
  getMyDungeonTeam,
  getMyDungeonTeamAsync,
  leaveDungeonTeam,
  leaveDungeonTeamAsync,
  createExchangeListing,
  createExchangeListingAsync,
  getExchangeListingById,
  getExchangeListingByIdAsync,
  listExchangeListings,
  listExchangeListingsAsync,
  listMyExchangeListings,
  listMyExchangeListingsAsync,
  updateExchangeListingAfterTrade,
  updateExchangeListingAfterTradeAsync,
  cancelExchangeListing,
  cancelExchangeListingAsync,
  settleExpiredExchangeListings,
  settleExpiredExchangeListingsAsync,
  createExchangeTrade,
  createExchangeTradeAsync,
  listExchangeTradePrices,
  listExchangeTradePricesAsync,
  createMailboxMessage,
  createMailboxMessageAsync,
  listMailbox,
  listMailboxAsync,
  getMailboxById,
  getMailboxByIdAsync,
  claimMailboxAtomic,
  claimMailboxAtomicAsync,
  markMailboxClaimed,
  markMailboxClaimedAsync,
  unmarkMailboxClaimed,
  unmarkMailboxClaimedAsync,
  deleteClaimedMailbox,
  deleteClaimedMailboxAsync,
  createCityDuelLog,
  createCityDuelLogAsync,
  listCityDuelLogsByAccount,
  listCityDuelLogsByAccountAsync,
  countCityDuelChallengesToday,
  countCityDuelChallengesTodayAsync,
  insertCityDuelChallenge,
  insertCityDuelChallengeAsync,
  getDuelRankLastSettledPeriod,
  getDuelRankLastSettledPeriodAsync,
  getTopDuelRankAccount,
  getTopDuelRankAccountAsync,
  resetAllDuelRankScores,
  resetAllDuelRankScoresAsync,
  setDuelRankLastSettledPeriod,
  setDuelRankLastSettledPeriodAsync,
  listAlliances,
  listAlliancesAsync,
  createAlliance,
  createAllianceAsync,
  getAllianceById,
  getAllianceByIdAsync,
  getAllianceByName,
  getAllianceByNameAsync,
  updateAlliance,
  updateAllianceAsync,
  listAllianceMembers,
  listAllianceMembersAsync,
  addAllianceMember,
  addAllianceMemberAsync,
  removeAllianceMember,
  removeAllianceMemberAsync,
  updateAllianceMemberRank,
  updateAllianceMemberRankAsync,
  getAllianceMemberRank,
  getAllianceMemberRankAsync,
  createAllianceApplication,
  createAllianceApplicationAsync,
  renewAllianceApplication,
  renewAllianceApplicationAsync,
  listAlliancePendingApplications,
  listAlliancePendingApplicationsAsync,
  updateAllianceApplicationStatus,
  updateAllianceApplicationStatusAsync,
  getApplicationByAllianceAndAccount,
  getApplicationByAllianceAndAccountAsync,
  getApplicationByAllianceAndAccountAnyStatus,
  getApplicationByAllianceAndAccountAnyStatusAsync,
  getApplicationById,
  getApplicationByIdAsync,
  countAllianceMembersByRank,
  countAllianceMembersByRankAsync,
  addAllianceMemberContribution,
  addAllianceMemberContributionAsync,
  getAllianceMemberContribution,
  getAllianceMemberContributionAsync,
  addAllianceWithdrawAuth,
  addAllianceWithdrawAuthAsync,
  removeAllianceWithdrawAuth,
  removeAllianceWithdrawAuthAsync,
  hasAllianceWithdrawAuth,
  hasAllianceWithdrawAuthAsync,
  listAllianceWithdrawAuth,
  listAllianceWithdrawAuthAsync,
  getOrCreateInviter,
  getOrCreateInviterAsync,
  getInviterByCode,
  getInviterByCodeAsync,
  getInviteBinding,
  getInviteBindingAsync,
  createInviteBinding,
  createInviteBindingAsync,
  updateInviteBindingStones,
  updateInviteBindingStonesAsync,
  updateInviterStorage,
  updateInviterStorageAsync,
  getInviterStorage,
  getInviterStorageAsync,
  addInviterPoints,
  addInviterPointsAsync,
  deductInviterStones,
  deductInviterStonesAsync,
  listInvitees,
  listInviteesAsync,
  hasClaimedInvitePoints,
  hasClaimedInvitePointsAsync,
  claimInvitePoints,
  claimInvitePointsAsync,
  deductInvitePoints,
  deductInvitePointsAsync,
  hasAccountRedeemed,
  hasAccountRedeemedAsync,
  recordAccountRedemption,
  recordAccountRedemptionAsync,
  wipeAccountData,
  wipeAccountDataAsync,
  createEmailVerificationCode,
  createEmailVerificationCodeAsync,
  verifyEmailCode,
  verifyEmailCodeAsync,
  bindAccountEmail,
  bindAccountEmailAsync,
  unbindAccountEmail,
  unbindAccountEmailAsync,
  getAccountEmail,
  getAccountEmailAsync,
  isEmailTaken,
  isEmailTakenAsync,
  getRecentEmailCodeTime,
  getRecentEmailCodeTimeAsync,
  getAccountByEmail,
  getAccountByEmailAsync,
  updateAccountPassword,
  updateAccountPasswordAsync
};
