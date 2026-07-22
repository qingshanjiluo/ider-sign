-- 迁移 v9.0: 新增工单类型（仙盟采集、试炼测试、每日试炼）
-- 创建时间: 2026-07-22

-- orders 表新增字段
ALTER TABLE orders ADD COLUMN game_account_name TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN game_account_password TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN subscription_start TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN subscription_end TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN last_executed_at TEXT DEFAULT '';
