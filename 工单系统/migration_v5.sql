-- v5.0: 市场系统 + 充值系统
-- 修仙币使用 bonus_points 字段存储（已存在于 users 表）

-- 官方市场商品表
CREATE TABLE IF NOT EXISTS market_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  price_coins REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_by INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 黑市订单表（求购/售卖）
CREATE TABLE IF NOT EXISTS market_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  quantity INTEGER NOT NULL DEFAULT 1,
  price_coins REAL NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'shipped', 'completed', 'cancelled')),
  buyer_id INTEGER DEFAULT 0,
  seller_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 充值记录表
CREATE TABLE IF NOT EXISTS recharge_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('cash', 'spirit_stone', 'package')),
  package_id TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  coins REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT '',
  payment_account TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled')),
  admin_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_market_items_category ON market_items(category);
CREATE INDEX IF NOT EXISTS idx_market_orders_type ON market_orders(type);
CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_orders(status);
CREATE INDEX IF NOT EXISTS idx_market_orders_user ON market_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_user ON recharge_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_status ON recharge_orders(status);
