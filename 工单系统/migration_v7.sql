-- Phase 2 修复迁移
-- 1. orders 表补充 order_type 和 quantity 列
ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT '代练';
ALTER TABLE orders ADD COLUMN quantity INTEGER DEFAULT 1;
