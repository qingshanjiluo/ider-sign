-- 艾德尔工单系统 - D1 数据库 Schema
-- 赛博朋克修仙工单平台 v3.1

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_spent REAL DEFAULT 0,
  invite_code TEXT UNIQUE,
  invited_by INTEGER DEFAULT 0,
  invite_points REAL DEFAULT 0,
  total_invited INTEGER DEFAULT 0,
  commission_rate REAL DEFAULT 0.3,
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  ip_address TEXT DEFAULT '',
  locked INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'super_admin')),
  bonus_points REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  invite_code TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  price REAL NOT NULL,
  coupon_code TEXT DEFAULT '',
  discount REAL DEFAULT 0,
  bonus_points INTEGER DEFAULT 0,
  order_type TEXT DEFAULT '代练',
  quantity INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  bind_account_name TEXT DEFAULT '',
  bind_invite_code TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  total_accounts_created INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  est_complete_date TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  server_username TEXT DEFAULT '',
  server_password TEXT DEFAULT '',
  level INTEGER DEFAULT 0,
  realm TEXT DEFAULT '',
  skills TEXT DEFAULT '[]',
  techniques TEXT DEFAULT '[]',
  equipment TEXT DEFAULT '[]',
  map_id INTEGER DEFAULT 0,
  map_name TEXT DEFAULT '',
  is_farming INTEGER DEFAULT 0,
  is_online INTEGER DEFAULT 0,
  health_status TEXT DEFAULT 'ok',
  last_check_at TEXT,
  reached_120_at TEXT,
  stop_monitor_at TEXT,
  status TEXT DEFAULT 'pending',
  error_msg TEXT DEFAULT '',
  character_name TEXT DEFAULT '',
  spirit_roots TEXT DEFAULT '{"metal":0,"wood":0,"water":0,"fire":0,"earth":0}',
  operator_id INTEGER DEFAULT 0,
  operator_name TEXT DEFAULT '',
  created_result TEXT DEFAULT '',
  setup_status TEXT DEFAULT 'pending',
  technique_id INTEGER DEFAULT 0,
  equipped_skills TEXT DEFAULT '[]',
  battle_auto_restart INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  min_amount REAL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'info',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'appeal',
  status TEXT DEFAULT 'pending',
  admin_reply TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game_account_id INTEGER NOT NULL,
  check_type TEXT DEFAULT 'daily',
  result TEXT DEFAULT 'ok',
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (game_account_id) REFERENCES game_accounts(id)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO config (key, value) VALUES ('price_per_120_points', '1');
INSERT OR IGNORE INTO config (key, value) VALUES ('spirit_stone_per_10_points', '1000000');
INSERT OR IGNORE INTO config (key, value) VALUES ('commission_rate', '30');
INSERT OR IGNORE INTO config (key, value) VALUES ('est_delivery_days', '5');
INSERT OR IGNORE INTO config (key, value) VALUES ('max_level', '120');
INSERT OR IGNORE INTO config (key, value) VALUES ('site_name', '艾德尔修仙工单平台');

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_game_accounts_order ON game_accounts(order_id);
CREATE INDEX IF NOT EXISTS idx_game_accounts_status ON game_accounts(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(user_id);

CREATE TABLE IF NOT EXISTS order_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_order_activities_order ON order_activities(order_id);

-- v3.0 additions
CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 100,
  max_uses INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  created_by INTEGER DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redeem_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS account_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  log_type TEXT DEFAULT 'info',
  message TEXT DEFAULT '',
  raw_output TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES game_accounts(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'popup',
  image_url TEXT DEFAULT '',
  link_url TEXT DEFAULT '',
  title TEXT DEFAULT '',
  enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_logs_account ON account_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_redeem_log_user ON redeem_log(user_id);

-- v3.1: 密码重置 Token 表（替代全局 Map，解决多实例冷启动问题）
CREATE TABLE IF NOT EXISTS reset_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON reset_tokens(expires_at);

-- v4.0: 角色系统 + 联系留言
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 迁移 v4.0: 旧管理员 is_admin=1 自动升级为 admin 角色
UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'user';

-- Seed admin user (最中幻想 / Pipi20100817)
INSERT OR IGNORE INTO users (username, password_hash, display_name, invite_code, is_admin, role, level, xp, created_at)
VALUES ('zzhx', 'ce768490e42a23ffdbd585e0a437293f9cf91d6dc7d2f8c55887ad0c4063d982', '最中幻想', 'ADMIN01', 1, 'super_admin', 10, 9999, datetime('now'));
