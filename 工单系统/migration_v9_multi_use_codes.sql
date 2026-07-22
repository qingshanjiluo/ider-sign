-- V9: 兑换码多次使用支持
-- 给 recharge_codes 表添加 max_uses 和 used_count 字段
-- 注意: Cloudflare D1 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS

ALTER TABLE recharge_codes ADD COLUMN max_uses INTEGER DEFAULT 1;
ALTER TABLE recharge_codes ADD COLUMN used_count INTEGER DEFAULT 0;
