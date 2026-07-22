# 艾德尔工单系统 — 全面代码逻辑审查报告

> 审查时间：2026-07-21
> 审查范围：数据库架构、后端API、前端页面、GitHub Actions、安全审计
> 审查目标：定位多处功能不可用的根因，提出修复方案

---

## 一、审查概览

| 维度 | 评分 | 状态 |
|------|------|------|
| 数据库架构 | 6/10 | ⚠️ 多表缺失、字段不一致 |
| 后端API逻辑 | 7/10 | ⚠️ 部分接口引用不存在的属性 |
| 前端页面 | 7/10 | ⚠️ 代码重复、路由冗余 |
| GitHub Actions | 8/10 | ✅ 自动化流程完整 |
| 安全性 | 6/10 | ⚠️ 密码硬编码、权限检查不一致 |
| 代码质量 | 6/10 | ⚠️ 大量重复代码、废弃文件未清理 |

---

## 二、致命问题（功能不可用）

### 2.1 📋 数据库表缺失 — 核心功能不可用

**严重度：🔴 P0 — 阻断性**

| 缺失表 | 影响的功能 | 引用位置 |
|--------|-----------|---------|
| `recharge_orders` | 充值系统全部功能 | [`functions/api/recharge/index.js`](functions/api/recharge/index.js:14) |
| `market_items` | 官方市场全部功能 | [`functions/api/market/items.js`](functions/api/market/items.js:12) |
| `market_orders` | 黑市订单全部功能 | [`functions/api/market/orders/index.js`](functions/api/market/orders/index.js:13) |
| `recharge_codes` | 兑换码激活功能 | [`functions/api/redeem/index.js`](functions/api/redeem/index.js:21) |
| `reset_tokens` | 密码重置功能 | [`functions/api/auth/forgot-password.js`](functions/api/auth/forgot-password.js:35) |
| `market_items` 管理 | 管理后台商品管理 | [`functions/api/admin/market/items.js`](functions/api/admin/market/items.js:12) |

**根因分析：**
- [`schema.sql`](工单系统/schema.sql) 仅包含基础表（users, sessions, orders, game_accounts 等15张表）
- 扩展表定义在 [`migration_v5.sql`](工单系统/migration_v5.sql)、[`migration_v6.sql`](工单系统/migration_v6.sql)、[`migration_v8.sql`](工单系统/migration_v8.sql) 中
- **数据库初始化时未执行迁移文件**，导致新功能全部不可用

**修复方案：**
```bash
# 执行所有迁移文件
npx wrangler d1 execute ider-orders --file=migration_v5.sql
npx wrangler d1 execute ider-orders --file=migration_v6.sql
npx wrangler d1 execute ider-orders --file=migration_v8.sql
```

---

### 2.2 📋 数据库字段缺失 — 邀请套餐购买失败

**严重度：🔴 P0 — 功能异常**

| 问题 | 位置 | 说明 |
|------|------|------|
| `total_purchased_points` 字段缺失 | [`functions/_auth.js`](functions/_auth.js:17) | authenticate() 查询该字段但 schema 未定义 |
| `total_purchased_points` 缺失 | [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:59) | 更新该字段时会报错 |
| `total_purchased_points` 缺失 | [`functions/api/invite/info.js`](functions/api/invite/info.js:21) | 读取该字段会返回 undefined |

**修复方案：**
```sql
-- 添加缺失字段
ALTER TABLE users ADD COLUMN total_purchased_points REAL DEFAULT 0;
```

---

### 2.3 📋 邀请套餐购买属性名不匹配

**严重度：🔴 P0 — 功能崩溃**

**位置：** [`functions/api/invite/purchase.js`](functions/api/invite/purchase.js:27)

```javascript
const bonusPoints = pkg.points; // ❌ 套餐对象没有 points 属性！
```

**根因：** [`_xp.js`](functions/_xp.js:22) 中套餐定义使用 `coins` 属性，但 `purchase.js` 引用 `pkg.points`

**修复方案：**
```javascript
const bonusPoints = pkg.coins; // ✅ 使用正确的属性名
```

---

## 三、高危问题（安全/数据风险）

### 3.1 📋 管理员种子密码硬编码

**严重度：🔴 P1 — 安全漏洞**

**位置：** [`schema.sql`](工单系统/schema.sql:261)

```sql
INSERT OR IGNORE INTO users (username, password_hash, ...)
VALUES ('zzhx', 'ce768490e42a23ffdbd585e0a437293f...', '最中幻想', ...);
```

- 密码哈希 `ce768490...` 是 SHA-256 格式，可被彩虹表攻击
- 生产环境不应保留种子数据

**修复方案：**
1. 移除 schema.sql 中的种子用户
2. 通过安全的初始化脚本创建管理员
3. 强制首次登录后修改密码

---

### 3.2 📋 管理员权限检查不一致

**严重度：🟠 P2 — 安全风险**

| 文件 | 权限检查方式 | 问题 |
|------|-------------|------|
| [`functions/api/admin/orders.js`](functions/api/admin/orders.js:10) | `user.is_admin` | 不检查 role 字段 |
| [`functions/api/admin/stats.js`](functions/api/admin/stats.js:10) | `user.is_admin` | 不检查 role 字段 |
| [`functions/api/admin/recharge.js`](functions/api/admin/recharge.js:8) | `user.role` | 只检查 role |
| [`functions/api/admin/market/items.js`](functions/api/admin/market/items.js:8) | `user.role` | 只检查 role |
| [`functions/api/admin/points.js`](functions/api/admin/points.js:13) | `authenticateAdmin()` | 使用统一函数 ✅ |
| [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:27) | `user.is_admin` | 不检查 role 字段 |

**修复方案：**
统一使用 [`_auth.js`](functions/_auth.js:37) 中的 `isAdmin()` 函数，该函数兼容 `is_admin=1` 和 `role` 字段

---

### 3.3 📋 密码重置令牌安全问题

**严重度：🟠 P2 — 安全风险**

**位置：** [`functions/api/auth/forgot-password.js`](functions/api/auth/forgot-password.js:43)

```javascript
// 生产环境应改为发邮件，当前直接返回 token
return json({
  reset_token: token, // ⚠️ 直接返回给客户端
});
```

**风险：** 重置令牌直接暴露在 API 响应中，任何知道用户名的人都可以重置密码

**修复方案：**
1. 移除 `reset_token` 返回值
2. 通过邮件发送重置链接
3. 或实现验证码机制

---

## 四、中等问题（代码质量）

### 4.1 📋 前端 API 方法重复定义

**严重度：🟡 P3 — 代码质量**

**位置：** [`pages-frontend/src/js/api.js`](pages-frontend/src/js/api.js:57)

```javascript
// 第57行
getUserInfo() { return this.get('/user/info'); }

// 第64行（重复！）
getUserInfo() { return this.get('/user/info'); }
```

同样 [`validateCoupon()`](pages-frontend/src/js/api.js:76) 方法也定义了两次（第76行和第134行）

---

### 4.2 📋 INVITE_BOOST_TIERS 重复定义

**严重度：🟡 P3 — 代码质量**

| 文件 | 行号 |
|------|------|
| [`functions/_xp.js`](functions/_xp.js:12) | 第12-18行 |
| [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:8) | 第8-14行 |

**修复方案：** [`status.js`](functions/api/orders/[id]/status.js) 应导入 `_xp.js` 中的常量

---

### 4.3 📋 Worker 废弃代码未清理

**严重度：🟡 P3 — 代码质量**

**位置：** [`worker/index.js`](worker/index.js:1)

```javascript
/**
 * ⚠️ 本 Worker 已废弃，请使用 Pages Functions (functions/) 替代
 */
```

文件仍有 1621 行代码，包含大量重复的认证、限流、路由逻辑

**修复方案：**
1. 确认 Pages Functions 完全替代后删除 worker/index.js
2. 或将其移至 archive 目录

---

### 4.4 📋 recharge_orders 表 CHECK 约束与代码不匹配

**严重度：🟡 P3 — 数据一致性**

**位置：** [`migration_v5.sql`](工单系统/migration_v5.sql:43)

```sql
type TEXT NOT NULL CHECK(type IN ('cash', 'spirit_stone', 'package'))
```

但 [`functions/api/recharge/index.js`](functions/api/recharge/index.js:24) 使用：
```javascript
if (!type || !['package', 'cash', 'spirit_stone'].includes(type))
```

虽然值相同但顺序不同，如果数据库有严格约束可能影响插入

---

## 五、低优先级问题

### 5.1 📋 缺少数据库迁移管理

| 问题 | 说明 |
|------|------|
| 无迁移版本跟踪 | 无法确定数据库当前版本 |
| 手动执行迁移 | 容易遗漏或重复执行 |
| 无回滚机制 | 迁移失败后无法恢复 |

**建议：** 实现迁移版本表和自动化迁移脚本

---

### 5.2 📋 限流器内存泄漏风险

**位置：** [`functions/_middleware.js`](functions/_middleware.js:18)

```javascript
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10000;
```

Cloudflare Workers 是无状态的，但同一 Worker 实例可能处理多个请求。Map 在内存中累积，无清理机制。

**对比：** [`worker/index.js`](worker/index.js:183) 有 `cleanupRateLimit()` 函数但 Pages Functions 版本没有

---

### 5.3 📋 缺少输入长度校验

| API | 问题 |
|-----|------|
| `/api/auth/register` | username 最大20字符但无服务端长度限制 |
| `/api/orders` POST | note 字段无长度限制 |
| `/api/contact` POST | content 字段无长度限制 |
| `/api/appeals` POST | content 字段无长度限制 |

---

### 5.4 📋 邀请提现无审核流程

**位置：** [`functions/api/invite/withdraw.js`](functions/api/invite/withdraw.js:16)

```javascript
// 直接扣除积分，无审核
await env.DB.prepare(
  'UPDATE users SET invite_points = invite_points - ? WHERE id = ?'
).bind(points, user.id).run();
return json({ ok: true, message: '提现申请已提交，请联系管理员处理' });
```

积分已扣除但无提现记录表，管理员无法跟踪提现请求

---

## 六、功能可用性矩阵

| 功能模块 | 后端API | 前端页面 | 数据库表 | 整体状态 |
|----------|---------|----------|----------|----------|
| 用户注册/登录 | ✅ | ✅ | ✅ | ✅ 正常 |
| 密码重置 | ✅ | ✅ | ❌ 缺 reset_tokens 表 | ❌ 不可用 |
| 创建工单 | ✅ | ✅ | ✅ | ✅ 正常 |
| 工单列表 | ✅ | ✅ | ✅ | ✅ 正常 |
| 工单审批 | ✅ | ⚠️ 无操作按钮 | ✅ | ⚠️ 部分可用 |
| 充值系统 | ✅ | ✅ | ❌ 缺 recharge_orders 表 | ❌ 不可用 |
| 兑换码激活 | ✅ | ✅ | ❌ 缺 recharge_codes 表 | ❌ 不可用 |
| 官方市场 | ✅ | ✅ | ❌ 缺 market_items 表 | ❌ 不可用 |
| 黑市交易 | ✅ | ✅ | ❌ 缺 market_orders 表 | ❌ 不可用 |
| 邀请系统 | ✅ | ✅ | ⚠️ 缺 total_purchased_points 字段 | ❌ 部分不可用 |
| 邀请套餐购买 | ✅ | ✅ | ✅ | ❌ 属性名错误崩溃 |
| 管理后台统计 | ✅ | ✅ | ✅ | ✅ 正常 |
| 管理后台用户 | ✅ | ✅ | ✅ | ✅ 正常 |
| 管理后台工单 | ✅ | ✅ | ✅ | ✅ 正常 |
| 管理后台商品 | ✅ | ✅ | ❌ 缺 market_items 表 | ❌ 不可用 |
| GitHub Actions 自动注册 | ✅ | - | ✅ | ✅ 正常 |
| GitHub Actions 健康检查 | ✅ | - | ✅ | ✅ 正常 |

**统计：** 17个功能模块中，6个完全不可用，1个部分不可用

---

## 七、修复优先级排序

### P0 — 立即修复（功能不可用）

1. 执行所有数据库迁移文件（migration_v5/v6/v8）
2. 添加 `total_purchased_points` 字段到 users 表
3. 修复 `invite/purchase.js` 中的 `pkg.points` → `pkg.coins`

### P1 — 尽快修复（安全风险）

4. 移除 schema.sql 中的种子用户密码
5. 统一管理员权限检查函数
6. 修复密码重置令牌暴露问题

### P2 — 计划修复（代码质量）

7. 删除 api.js 中重复的方法定义
8. 消除 INVITE_BOOST_TIERS 重复定义
9. 清理废弃的 worker/index.js
10. 添加输入长度校验

### P3 — 后续优化

11. 实现数据库迁移版本管理
12. 为限流器添加清理机制
13. 实现提现审核流程
14. 添加单元测试

---

## 八、附录

### A. 审查涉及的文件清单

**数据库相关：**
- [`schema.sql`](工单系统/schema.sql) — 主 schema
- [`migration_v5.sql`](工单系统/migration_v5.sql) — 市场+充值表
- [`migration_v6.sql`](工单系统/migration_v6.sql) — 兑换码表
- [`migration_v8.sql`](工单系统/migration_v8.sql) — 优惠券改造

**核心模块：**
- [`functions/_auth.js`](functions/_auth.js) — 认证模块
- [`functions/_db.js`](functions/_db.js) — 数据库连接
- [`functions/_utils.js`](functions/_utils.js) — 工具函数
- [`functions/_xp.js`](functions/_xp.js) — 经验值/等级系统
- [`functions/_middleware.js`](functions/_middleware.js) — 全局中间件

**API 端点：**
- [`functions/api/auth/login.js`](functions/api/auth/login.js)
- [`functions/api/auth/register.js`](functions/api/auth/register.js)
- [`functions/api/auth/forgot-password.js`](functions/api/auth/forgot-password.js)
- [`functions/api/auth/reset-password.js`](functions/api/auth/reset-password.js)
- [`functions/api/orders/index.js`](functions/api/orders/index.js)
- [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js)
- [`functions/api/recharge/index.js`](functions/api/recharge/index.js)
- [`functions/api/redeem/index.js`](functions/api/redeem/index.js)
- [`functions/api/market/items.js`](functions/api/market/items.js)
- [`functions/api/market/purchase.js`](functions/api/market/purchase.js)
- [`functions/api/market/orders/index.js`](functions/api/market/orders/index.js)
- [`functions/api/invite/info.js`](functions/api/invite/info.js)
- [`functions/api/invite/purchase.js`](functions/api/invite/purchase.js)
- [`functions/api/invite/withdraw.js`](functions/api/invite/withdraw.js)
- [`functions/api/admin/orders.js`](functions/api/admin/orders.js)
- [`functions/api/admin/stats.js`](functions/api/admin/stats.js)
- [`functions/api/admin/recharge.js`](functions/api/admin/recharge.js)
- [`functions/api/admin/points.js`](functions/api/admin/points.js)
- [`functions/api/admin/market/items.js`](functions/api/admin/market/items.js)
- [`functions/api/user/info.js`](functions/api/user/info.js)

**前端文件：**
- [`pages-frontend/src/js/app.js`](pages-frontend/src/js/app.js) — SPA 入口
- [`pages-frontend/src/js/api.js`](pages-frontend/src/js/api.js) — API 客户端
- [`pages-frontend/src/js/router.js`](pages-frontend/src/js/router.js) — 路由器
- [`pages-frontend/src/js/pages/dashboard.js`](pages-frontend/src/js/pages/dashboard.js)
- [`pages-frontend/src/js/pages/orders.js`](pages-frontend/src/js/pages/orders.js)
- [`pages-frontend/src/js/pages/recharge.js`](pages-frontend/src/js/pages/recharge.js)
- [`pages-frontend/src/js/pages/market.js`](pages-frontend/src/js/pages/market.js)
- [`pages-frontend/src/js/pages/admin-market.js`](pages-frontend/src/js/pages/admin-market.js)
- [`pages-frontend/src/js/pages/admin-recharge.js`](pages-frontend/src/js/pages/admin-recharge.js)

**GitHub Actions：**
- [`gh-actions/scan_orders.js`](工单系统/gh-actions/scan_orders.js)
- [`gh-actions/health_check.js`](工单系统/gh-actions/health_check.js)
- [`gh-actions/_anti_detect.js`](工单系统/gh-actions/_anti_detect.js)
