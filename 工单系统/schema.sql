-- 艾德尔工单系统 - D1 数据库 Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  level INTEGER DEFAULT 1,
  total_orders INTEGER DEFAULT 0,
  total_spent REAL DEFAULT 0,
  invite_code TEXT UNIQUE,
  invited_by INTEGER DEFAULT 0,
  invite_points REAL DEFAULT 0,
  commission_rate REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  ip_address TEXT DEFAULT '',
  locked INTEGER DEFAULT 0
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
  status TEXT DEFAULT 'pending',
  bind_account_name TEXT DEFAULT '',
  bind_invite_code TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
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
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
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

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_game_accounts_order ON game_accounts(order_id);
