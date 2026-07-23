-- v9.0: 官方商城增强 - 支付方式、审核流程、完成提示面板
ALTER TABLE market_items ADD COLUMN payment_methods TEXT DEFAULT 'coin';
ALTER TABLE market_items ADD COLUMN need_review INTEGER DEFAULT 0;
ALTER TABLE market_items ADD COLUMN complete_panel_enabled INTEGER DEFAULT 0;
ALTER TABLE market_items ADD COLUMN complete_panel_title TEXT DEFAULT '';
ALTER TABLE market_items ADD COLUMN complete_panel_desc TEXT DEFAULT '';

-- 官方市场购买记录表
CREATE TABLE IF NOT EXISTS market_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  item_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  price_coins REAL NOT NULL DEFAULT 0,
  total_coins REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'coin',
  payment_account TEXT DEFAULT '',
  snapshot TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'completed')),
  admin_id INTEGER DEFAULT 0,
  admin_notes TEXT DEFAULT '',
  panel_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (item_id) REFERENCES market_items(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_market_purchases_user ON market_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_market_purchases_status ON market_purchases(status);
