-- v3.0 Migration: Add new columns to existing tables
ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN total_invited INTEGER DEFAULT 0;

-- v3.0 New tables
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

-- Seed admin user (zzhx / Pipi20100817)
INSERT OR IGNORE INTO users (username, password_hash, invite_code, is_admin, level, xp, created_at)
VALUES ('zzhx', '8d1920593b78d648a4dda2d3ec58a2177e6356ac845e4edde4fb0a01663cb452', 'ADMIN01', 1, 10, 9999, datetime('now'));
