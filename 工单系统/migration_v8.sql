-- 迁移 v8: 优惠券改造 + 工单创建流程改造

-- 优惠券表新增字段
ALTER TABLE coupons ADD COLUMN coupon_type TEXT DEFAULT 'percent';
-- coupon_type: 'percent' = 百分比, 'fixed' = 固定金额

ALTER TABLE coupons ADD COLUMN fixed_amount REAL DEFAULT 0;
-- fixed_amount: 固定金额减免（¥）

-- 工单表新增字段
ALTER TABLE orders ADD COLUMN frozen_points REAL DEFAULT 0;
-- frozen_points: 冻结的修仙币数量（修仙币支付时冻结，拒绝时返还）

ALTER TABLE orders ADD COLUMN invite_code_used TEXT DEFAULT '';
-- invite_code_used: 实际使用的邀请码
