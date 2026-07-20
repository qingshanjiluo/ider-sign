-- v6.0: 兑换码表
-- 用于套餐兑换码自动生成/手动管理

CREATE TABLE IF NOT EXISTS recharge_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  recharge_order_id INTEGER DEFAULT 0,
  code TEXT UNIQUE NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'used', 'expired')),
  used_by INTEGER DEFAULT 0,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_recharge_codes_user ON recharge_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_codes_code ON recharge_codes(code);
CREATE INDEX IF NOT EXISTS idx_recharge_codes_status ON recharge_codes(status);
