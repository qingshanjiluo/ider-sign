-- ============================================================
-- 统一迁移文件：合并 migration_v5 + v6 + v8
-- 执行方式: wrangler d1 execute ider-order --remote --file=./migration_unified_v5_v6_v8.sql
-- 日期: 2026-07-21
-- 说明: 所有 CREATE TABLE 均使用 IF NOT EXISTS，可安全重复执行
-- ============================================================

-- ── V5: 市场系统 ──────────────────────────────────────────

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

-- ── V6: 兑换码系统 ──────────────────────────────────────

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

-- ── V8: 优惠券增强 + 订单字段 ─────────────────────────────
-- 注意: ALTER TABLE ADD COLUMN 如果列已存在会报错
-- Cloudflare D1 支持 "IF NOT EXISTS" 语法的 ALTER TABLE

-- coupons 表新增字段
CREATE TABLE IF NOT EXISTS _v8_temp AS SELECT * FROM coupons WHERE 0=1;

-- 安全地添加新列（如果列不存在则添加）
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS coupon_type TEXT DEFAULT 'percent';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS fixed_amount REAL DEFAULT 0;

-- orders 表新增字段
ALTER TABLE orders ADD COLUMN IF NOT EXISTS frozen_points REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invite_code_used TEXT DEFAULT '';

-- users 表新增字段（用于邀请套餐倍率追踪）
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_purchased_points REAL DEFAULT 0;
