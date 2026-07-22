# 艾德尔工单系统 — 修复项与新工单类型规划

> 创建时间：2026-07-22
> 状态：规划阶段

---

## 一、修复项清单

### 1.1 工单审核显示支付方式详情

**问题**：管理后台工单列表和详情页中，金额列始终显示 `¥xxx` 格式，不区分支付方式。

**现状**：
- [`admin-orders.js:67`](工单系统/pages-frontend/src/js/pages/admin-orders.js:67) — `¥${(o.total_price || o.price || 0).toFixed(2)}`
- [`order-detail.js:49`](工单系统/pages-frontend/src/js/pages/order-detail.js:49) — `¥${(order.total_price || order.price || 0).toFixed(2)}`
- [`orders.js:107-113`](工单系统/pages-frontend/src/js/pages/orders.js:107) — 用户端已有 `formatPrice()` 函数，根据 payment_method 区分显示

**修复方案**：
- 在 `admin-orders.js` 和 `order-detail.js` 中复用 `formatPrice()` 逻辑
- 显示格式：
  - 微信支付：`¥10.00`
  - 修仙币：`100 修仙币`
  - 灵石：`1000 万灵石`
- 同时显示折扣信息（如有）：`¥10.00 (8折)`

**涉及文件**：
- [`admin-orders.js`](工单系统/pages-frontend/src/js/pages/admin-orders.js)
- [`order-detail.js`](工单系统/pages-frontend/src/js/pages/order-detail.js)

---

### 1.2 修复 `/api/admin/ai-test` 返回 400

**问题**：点击AI测试按钮时，控制台报错 `Failed to load resource: the server responded with a status of 400`

**现状分析**：
- [`ai-test.js:25`](工单系统/functions/api/admin/ai-test.js:25) — 当 `apiKey` 为空时返回 `{ ok: false, error: '未设置API Key' }, 400`
- [`ai-test.js:42`](工单系统/functions/api/admin/ai-test.js:42) — AI API 返回错误时也返回 400
- 可能原因：
  1. config 表中未设置 `ai_api_key`
  2. AI API URL 配置错误
  3. API Key 无效

**修复方案**：
- 改进错误信息，返回更友好的提示
- 区分"未配置"和"连接失败"两种情况
- 前端 [`admin-ai-config.js`](工单系统/pages-frontend/src/js/pages/admin-ai-config.js) 应正确处理 400 响应并显示具体原因

**涉及文件**：
- [`ai-test.js`](工单系统/functions/api/admin/ai-test.js)
- [`admin-ai-config.js`](工单系统/pages-frontend/src/js/pages/admin-ai-config.js)

---

### 1.3 修复市场页 Tab 样式

**问题**：市场页的 Tab 按钮（官方市场/黑市/兑换码/我的订单）样式不正确

**现状**：
- [`market.js:27-31`](工单系统/pages-frontend/src/js/pages/market.js:27) — 使用 `class="tab"` 和 `class="tab active"`
- Tab 切换逻辑在 [`market.js`](工单系统/pages-frontend/src/js/pages/market.js) 底部

**修复方案**：
- 检查 CSS 中 `.tabs` 和 `.tab` 的样式定义
- 确保 active 状态有明显的视觉区分（背景色、下划线、文字颜色）
- 参考其他页面（如 admin 页面）的 tab 样式

**涉及文件**：
- [`market.js`](工单系统/pages-frontend/src/js/pages/market.js)
- CSS 文件（需要检查 tab 相关样式）

---

### 1.4 修复充值页 Tab 样式

**问题**：充值页的 Tab 按钮（套餐充值/基础充值/充值记录）样式不正确

**现状**：
- [`recharge.js:35-39`](工单系统/pages-frontend/src/js/pages/recharge.js:35) — 使用 `class="tab"` 和 `class="tab active"`

**修复方案**：
- 与市场页 Tab 样式修复一致
- 确保 `.tabs` 和 `.tab` CSS 类正确渲染

**涉及文件**：
- [`recharge.js`](工单系统/pages-frontend/src/js/pages/recharge.js)
- CSS 文件

---

### 1.5 修复无限次数优惠券显示"已用完"

**问题**：优惠券 ZHX8888（百分比20%，已用0次，max_uses=0即无限，永不过期）显示"已用完"

**根因分析**：
- [`coupon/validate.js:15`](工单系统/functions/api/coupon/validate.js:15):
  ```js
  if (coupon.used_count >= coupon.max_uses) return json({ error: '优惠码已用完' }, 400);
  ```
- 当 `max_uses = 0`（表示无限次）时，`used_count(0) >= max_uses(0)` 为 `true`，导致直接返回"已用完"
- 同样的 bug 存在于 [`worker/index.js:508`](工单系统/worker/index.js:508) 和 [`functions/api/orders/index.js:105`](工单系统/functions/api/orders/index.js:105)

**修复方案**：
- `max_uses = 0` 表示无限次，应跳过使用次数检查
- 修改为：`if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses)`
- 需要在以下 3 个位置同步修复：
  1. [`coupon/validate.js:15`](工单系统/functions/api/coupon/validate.js:15)
  2. [`worker/index.js:508`](工单系统/worker/index.js:508)（旧 Worker，已废弃但保留兼容）
  3. [`functions/api/orders/index.js:105`](工单系统/functions/api/orders/index.js:105)

**涉及文件**：
- [`coupon/validate.js`](工单系统/functions/api/coupon/validate.js)
- [`functions/api/orders/index.js`](工单系统/functions/api/orders/index.js)
- [`worker/index.js`](工单系统/worker/index.js)（兼容修复）

---

## 二、新增工单类型

### 2.1 每日自动领取仙盟并开启采集

**工单名称**：每日自动领取仙盟并开启采集
**工单类型**：`仙盟采集`
**价格**：1 修仙币/月
**需要用户提交**：游戏账号名 + 游戏账号密码

**功能描述**：
- 每日自动登录游戏账号
- 自动检查/加入仙盟（默认"天地一家大爱盟"）
- 自动完成仙盟灵池泡澡
- 自动完成仙盟灵植园采摘
- 自动完成灵树参悟
- 自动开启洞府采集

**基于工具**：[`batch_alliance_daily.js`](批量注册工具/batch_alliance_daily.js)（351行）

**API 依赖**：
- `POST /auth/login` — 登录
- `GET /alliance/my` — 检查仙盟
- `POST /alliance/join` — 加入仙盟
- `POST /alliance/spirit_pool/bathe` — 灵池泡澡
- `POST /alliance/garden/pick` — 灵植园采摘
- `POST /alliance/enlightenment_tree/meditate` — 灵树参悟
- `POST /online/cave/start` — 洞府采集

**实现方案**：
1. **前端**：在新建工单弹窗中增加 `仙盟采集` 类型选项
   - 选择此类型时，显示"账号名"和"账号密码"输入框（替代邀请码）
   - 价格固定为 1 修仙币/月
2. **后端**：[`functions/api/orders/index.js`](工单系统/functions/api/orders/index.js) 接受 `game_account_name` 和 `game_account_password` 字段
3. **GitHub Actions**：创建新 workflow `alliance-daily.yml`，调用 worker API 执行仙盟日常任务
4. **Worker API**：新增 `/api/gh/process-alliance-daily` 端点

**数据库变更**：
- orders 表新增字段：`game_account_name TEXT`, `game_account_password TEXT`（加密存储）

---

### 2.2 试炼测试最佳配置

**工单名称**：试炼测试最佳配置
**工单类型**：`试炼测试`
**价格**：0.5 修仙币/次
**需要用户提交**：无额外信息（使用已有账号）

**功能描述**：
- 对用户指定的游戏账号进行试炼
- 测试并记录最佳配置（技能组合、装备搭配等）
- 返回试炼结果和推荐配置

**实现方案**：
1. **前端**：新增 `试炼测试` 工单类型
   - 需要用户提交游戏账号名（已注册的账号）
   - 价格按次数计算
2. **后端**：接受 `game_account_name` 字段
3. **GitHub Actions**：创建 `trial-test.yml` workflow
4. **Worker API**：新增 `/api/gh/process-trial-test` 端点

**注意**：此工单类型为单次执行，不涉及月度订阅。

---

### 2.3 每日自动试炼

**工单名称**：每日自动试炼
**工单类型**：`每日试炼`
**价格**：2 修仙币/月
**需要用户提交**：游戏账号名 + 游戏账号密码

**功能描述**：
- 每日自动登录游戏账号
- 自动完成试炼挑战
- 记录每日试炼结果

**实现方案**：
1. **前端**：新增 `每日试炼` 工单类型
   - 需要用户提交账号名和密码
   - 月度订阅模式
2. **后端**：接受 `game_account_name` 和 `game_account_password` 字段
3. **GitHub Actions**：创建 `daily-trial.yml` workflow（每日定时执行）
4. **Worker API**：新增 `/api/gh/process-daily-trial` 端点

---

## 三、新工单类型的通用实现步骤

### 3.1 数据库层

```sql
-- 新增字段到 orders 表
ALTER TABLE orders ADD COLUMN game_account_name TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN game_account_password TEXT DEFAULT '';  -- 加密存储
ALTER TABLE orders ADD COLUMN subscription_start TEXT;  -- 订阅开始时间
ALTER TABLE orders ADD COLUMN subscription_end TEXT;    -- 订阅结束时间
ALTER TABLE orders ADD COLUMN last_executed_at TEXT;    -- 上次执行时间
```

### 3.2 前端层

- 修改 [`orders.js`](工单系统/pages-frontend/src/js/pages/orders.js) 的新建工单弹窗
- 根据工单类型动态显示不同的表单字段
- 新增类型选项：`仙盟采集`、`试炼测试`、`每日试炼`

### 3.3 后端层（Pages Functions）

- 修改 [`functions/api/orders/index.js`](工单系统/functions/api/orders/index.js) 接受新字段
- 新增 Worker API 端点处理不同类型工单

### 3.4 GitHub Actions 层

- 创建新的 workflow 文件处理仙盟采集、试炼测试、每日试炼
- 在扫描器 [`scan_orders.js`](工单系统/gh-actions/scan_orders.js) 中根据 `order_type` 分发不同处理逻辑

---

## 四、执行顺序

| 优先级 | 任务 | 预估工作量 |
|--------|------|-----------|
| P0 | 修复优惠券无限次数 bug | 小（3行代码 × 3文件） |
| P1 | 工单审核显示支付方式详情 | 小（复用 formatPrice） |
| P1 | Tab 样式修复（市场+充值） | 小（CSS调整） |
| P1 | AI测试 400 错误修复 | 小（错误处理优化） |
| P2 | 新增仙盟采集工单类型 | 中（前后端+Actions） |
| P2 | 新增试炼测试工单类型 | 中 |
| P2 | 新增每日试炼工单类型 | 中 |

---

## 五、相关文件索引

| 文件 | 用途 |
|------|------|
| [`functions/api/orders/index.js`](工单系统/functions/api/orders/index.js) | 工单创建 API |
| [`functions/api/coupon/validate.js`](工单系统/functions/api/coupon/validate.js) | 优惠券验证 API |
| [`functions/api/admin/ai-test.js`](工单系统/functions/api/admin/ai-test.js) | AI测试 API |
| [`pages-frontend/src/js/pages/orders.js`](工单系统/pages-frontend/src/js/pages/orders.js) | 用户工单页面 |
| [`pages-frontend/src/js/pages/admin-orders.js`](工单系统/pages-frontend/src/js/pages/admin-orders.js) | 管理工单页面 |
| [`pages-frontend/src/js/pages/order-detail.js`](工单系统/pages-frontend/src/js/pages/order-detail.js) | 工单详情页面 |
| [`pages-frontend/src/js/pages/market.js`](工单系统/pages-frontend/src/js/pages/market.js) | 市场页面 |
| [`pages-frontend/src/js/pages/recharge.js`](工单系统/pages-frontend/src/js/pages/recharge.js) | 充值页面 |
| [`gh-actions/scan_orders.js`](工单系统/gh-actions/scan_orders.js) | 工单扫描器 |
| [`批量注册工具/batch_alliance_daily.js`](批量注册工具/batch_alliance_daily.js) | 仙盟日常自动化工具 |
| [`worker/index.js`](工单系统/worker/index.js) | Worker 主文件（旧，保留兼容） |
