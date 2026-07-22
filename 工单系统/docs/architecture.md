# 艾德尔修仙传 — 工单系统 · 架构设计文档

> 聚焦于"如何组织代码"，配合架构图让后续 AI 快速理解代码结构。

---

## 1. 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户浏览器                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  SPA (Vanilla JS ES Modules)                                  │  │
│  │  router.js → Hash 路由 → page 组件 → api.js (fetch)           │  │
│  └───────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────────┐
│                    Cloudflare Edge                                  │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  Cloudflare Pages     │    │  Cloudflare Pages Functions      │  │
│  │  (静态资源托管)        │    │  (Serverless API)                │  │
│  │                       │    │                                   │  │
│  │  pages-frontend/      │    │  functions/                       │  │
│  │  ├─ index.html        │    │  ├─ _middleware.js  [全局中间件]   │  │
│  │  ├─ src/js/           │    │  │   ├─ CORS 处理                 │  │
│  │  │   ├─ app.js        │    │  │   ├─ 限流器 (Rate Limit)       │  │
│  │  │   ├─ router.js     │    │  │   └─ API Key 校验 (gh/ 路由)   │  │
│  │  │   ├─ api.js        │◄──▶│  ├─ _auth.js       [认证模块]     │  │
│  │  │   ├─ store.js      │    │  │   ├─ authenticate()            │  │
│  │  │   ├─ components/   │    │  │   ├─ authenticateApi()         │  │
│  │  │   └─ pages/        │    │  │   └─ isAdmin()                 │  │
│  │  └─ _redirects        │    │  ├─ _utils.js      [工具函数]     │  │
│  └──────────────────────┘    │  │   ├─ json() / html()            │  │
│                               │  │   ├─ hashPassword() (PBKDF2)   │  │
│                               │  │   ├─ verifyPassword()          │  │
│                               │  │   ├─ generateToken()           │  │
│                               │  │   ├─ logActivity()             │  │
│                               │  │   └─ generateRechargeCode()    │  │
│                               │  ├─ _db.js         [DB 辅助]      │  │
│                               │  ├─ _xp.js         [等级/经验值]   │  │
│                               │  └─ api/            [路由处理器]   │  │
│                               │      ├─ auth/                      │  │
│                               │      ├─ orders/                    │  │
│                               │      ├─ accounts/                  │  │
│                               │      ├─ admin/                     │  │
│                               │      ├─ market/                    │  │
│                               │      ├─ invite/                    │  │
│                               │      ├─ gh/          (GitHub对接)  │  │
│                               │      ├─ bot/                       │  │
│                               │      ├─ recharge/                  │  │
│                               │      ├─ redeem/                    │  │
│                               │      └─ ... (15+ 模块)            │  │
│                               └──────────────┬───────────────────┘  │
│                                              │                      │
│  ┌───────────────────────────────────────────▼────────────────────┐ │
│  │  Cloudflare D1 (SQLite)                                        │ │
│  │  绑定: env.DB                                                  │ │
│  │  19 张表 + 索引                                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Cloudflare Worker (Legacy, worker/index.js)                   │ │
│  │  ⚠️ 已废弃，保留兼容。新路由应在 functions/api/ 下创建          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (定时任务)                         │
│                                                                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────────────┐  │
│  │ order-scan.yml  │ │ health-check.yml│ │ deploy.yml           │  │
│  │ 每10分钟         │ │ 每30分钟         │ │ push master 触发     │  │
│  │ scan_orders.js  │ │ health_check.js │ │ → Pages + Worker     │  │
│  │ _anti_detect.js │ │ daily_trial.js  │ └──────────────────────┘  │
│  └────────┬────────┘ └────────┬────────┘                          │
│           │                   │                                    │
│           └─────────┬─────────┘                                    │
│                     ▼                                              │
│           调用 Worker API (/api/gh/*)                               │
│           携带 X-API-Key 认证                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 后端分层说明

### 2.1 架构模式：Pages Functions 文件系统路由

项目使用 **Cloudflare Pages Functions** 作为后端，采用文件系统路由（类似 Next.js API Routes）。每个 `functions/api/<path>.js` 文件自动映射为 `/api/<path>` 端点。

**分层结构（每层职责）：**

| 层级 | 文件 | 职责 |
|------|------|------|
| **中间件层** | [`_middleware.js`](functions/_middleware.js) | CORS 预检、请求限流（IP 级别 60次/分钟）、API Key 校验 |
| **认证层** | [`_auth.js`](functions/_auth.js) | Token 会话验证、管理员权限检查、API Key 恒定时间比较 |
| **工具层** | [`_utils.js`](functions/_utils.js) | JSON/HTML 响应封装、密码哈希（PBKDF2）、Token 生成、活动日志、兑换码生成 |
| **业务逻辑层** | [`_xp.js`](functions/_xp.js) | 经验值/等级计算、邀请倍率套餐、充值套餐定义、等级称号 |
| **DB 辅助层** | [`_db.js`](functions/_db.js) | 获取 D1 数据库绑定 `context.env.DB` |
| **路由处理层** | `api/**/*.js` | 每个文件导出 `onRequest(context)` 函数，处理 HTTP 方法分支 |

### 2.2 路由处理器模式

每个 API 文件遵循统一模式：

```javascript
// functions/api/<module>/<resource>.js
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 1. 认证
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  // 2. HTTP 方法分发
  if (request.method === 'GET') { /* ... */ }
  if (request.method === 'POST') { /* ... */ }

  // 3. 返回 JSON
  return json({ ok: true, data });
}
```

**关键特征：**
- 无独立 Controller/Service/Repository 分层 — 业务逻辑直接写在路由处理器中
- 认证通过 `authenticate(request, env)` 或 `authenticateAdmin(request, env)` 完成
- 数据库操作通过 `env.DB.prepare(sql).bind(...params).all()` 直接执行 SQL
- 所有响应用 `json(data, status)` 或 `json({ error }, status)` 封装

### 2.3 后端文件清单

```
functions/
├── _middleware.js          # 全局中间件（CORS、限流、API Key）
├── _auth.js                # 认证（authenticate / authenticateAdmin / isAdmin）
├── _utils.js               # 工具函数（密码、Token、日志、响应封装）
├── _db.js                  # DB 获取辅助
├── _xp.js                  # 等级/经验值/套餐常量与计算
│
├── api/auth/               # 认证模块（3 个端点）
│   ├── login.js            #   POST /api/auth/login
│   ├── register.js         #   POST /api/auth/register
│   ├── forgot-password.js  #   POST /api/auth/forgot-password
│   └── reset-password.js   #   POST /api/auth/reset-password
│
├── api/orders/             # 工单模块
│   ├── index.js            #   GET|POST /api/orders
│   └── [id]/
│       ├── index.js        #   GET /api/orders/:id
│       ├── status.js       #   PUT /api/orders/:id/status
│       └── activities.js   #   GET /api/orders/:id/activities
│
├── api/accounts/           # 游戏账号模块
│   ├── index.js            #   GET /api/accounts
│   └── [id]/
│       ├── index.js        #   GET /api/accounts/:id
│       └── logs.js         #   GET /api/accounts/:id/logs
│
├── api/admin/              # 管理后台（14+ 端点）
│   ├── orders.js           #   GET /api/admin/orders
│   ├── users.js            #   GET /api/admin/users
│   ├── accounts.js         #   GET /api/admin/accounts
│   ├── coupons.js          #   CRUD /api/admin/coupons
│   ├── config.js           #   GET|PUT /api/admin/config
│   ├── stats.js            #   GET /api/admin/stats
│   ├── announcements.js    #   CRUD /api/admin/announcements
│   ├── ads.js              #   CRUD /api/admin/ads
│   ├── appeals.js          #   GET /api/admin/appeals
│   ├── ai-config.js        #   GET|PUT /api/admin/ai-config
│   ├── ai-test.js          #   POST /api/admin/ai-test
│   ├── points.js           #   POST /api/admin/points
│   ├── recharge-codes.js   #   CRUD /api/admin/recharge-codes
│   ├── recharge.js         #   GET /api/admin/recharge
│   ├── contact-messages.js #   GET /api/admin/contact-messages
│   ├── market/             #   市场管理
│   ├── market-orders/      #   市场订单管理
│   └── users/[id]/         #   用户管理（角色/锁定/删密/删除/等级）
│
├── api/market/             # 市场模块
│   ├── items.js            #   GET /api/market/items
│   ├── purchase.js         #   POST /api/market/purchase
│   └── orders/             #   黑市订单（挂单/接单/确认/发货/取消）
│
├── api/invite/             # 邀请模块
│   ├── info.js             #   GET /api/invite/info
│   ├── packages.js         #   GET /api/invite/packages
│   ├── purchase.js         #   POST /api/invite/purchase
│   └── withdraw.js         #   POST /api/invite/withdraw
│
├── api/recharge/           # 充值模块
│   ├── index.js            #   GET|POST /api/recharge
│   └── packages.js         #   GET /api/recharge/packages
│
├── api/gh/                 # GitHub Actions 接口（API Key 认证）
│   ├── approved-orders.js  #   GET  获取审核通过的工单
│   ├── complete-order.js   #   POST 完成工单
│   ├── report-account.js   #   POST 上报新账号
│   ├── report-health.js    #   POST 上报健康状态
│   ├── report-log.js       #   POST 上报日志
│   ├── active-accounts.js  #   GET  获取活跃账号
│   ├── test-account.js     #   POST 测试账号
│   └── report-trial-test.js#   POST 上报试炼结果
│
├── api/bot/ask.js          # 客服机器人（关键词匹配 + 本地回复）
├── api/redeem/index.js     # 兑换码兑换
├── api/coupon/validate.js  # 优惠券验证
├── api/notifications/      # 通知（列表 + 标记已读）
├── api/appeals/index.js    # 申诉提交
├── api/after-sales/        # 售后（提交 + 回复）
├── api/contact/index.js    # 联系留言
├── api/leaderboard/        # 排行榜（邀请/等级/消费）
├── api/user/               # 用户（资料/改密/公开信息）
├── api/ads/active.js       # 获取激活广告
├── api/announcements/active.js  # 获取激活公告
├── api/config.js           # 公共配置
├── api/stats.js            # 统计数据
└── api/public/config.js    # 公开配置（无需登录）
```

---

## 3. 前端架构说明

### 3.1 技术选型

- **框架**: 无框架，纯 Vanilla JS + ES Modules
- **路由**: 自实现 Hash-based SPA Router（[`router.js`](pages-frontend/src/js/router.js)）
- **状态管理**: 自实现简易 Store（[`store.js`](pages-frontend/src/js/store.js)）
- **API 调用**: 自实现 ApiClient（[`api.js`](pages-frontend/src/js/api.js)）
- **样式**: 赛博朋克主题 CSS（Orbitron + Noto Sans SC 字体）
- **构建工具**: 无（直接部署源文件，Cloudflare Pages 托管）

### 3.2 模块关系图

```
app.js (入口)
  │
  ├─→ router.js          # Hash 路由注册与分发
  │     ├─ /              → renderLanding
  │     ├─ /login         → renderLogin
  │     ├─ /register      → renderRegister
  │     ├─ /dashboard     → renderDashboard      (需登录)
  │     ├─ /orders        → renderOrders          (需登录)
  │     ├─ /orders/:id    → renderOrderDetail
  │     ├─ /market        → renderMarket
  │     ├─ /admin/*       → renderAdmin*          (需管理员)
  │     └─ ...
  │
  ├─→ store.js           # 全局状态
  │     ├─ user           # 当前登录用户对象
  │     ├─ isLoggedIn     # 登录状态
  │     └─ config         # 系统配置
  │
  ├─→ api.js             # API 客户端
  │     ├─ setToken()     # 管理 Bearer Token (localStorage)
  │     ├─ get/post/put/del()  # HTTP 方法
  │     └─ 业务方法       # login(), getOrders(), createOrder()...
  │
  └─→ components/        # 公共组件
        ├─ sidebar.js     # 侧边栏导航（根据角色显示菜单）
        ├─ topbar.js      # 顶部栏（搜索、通知、用户信息）
        ├─ chat-bot.js    # 客服机器人浮窗
        ├─ modal.js       # 模态框
        └─ toast.js       # 消息提示
```

### 3.3 前端文件清单

```
pages-frontend/
├── index.html                    # HTML 入口（挂载 #app）
├── _redirects                    # SPA 重写: /* → /index.html (200)
└── src/js/
    ├── app.js                    # SPA 入口：路由注册、布局渲染、路由守卫
    ├── router.js                 # Hash-based 路由器（支持 :param 参数）
    ├── store.js                  # 简易状态管理（发布-订阅模式）
    ├── api.js                    # API 客户端（fetch 封装 + Token 管理）
    ├── icons.js                  # SVG 图标函数库
    │
    ├── components/               # 公共组件
    │   ├── sidebar.js            #   侧边栏（根据角色动态菜单）
    │   ├── topbar.js             #   顶部栏（搜索、通知、头像）
    │   ├── chat-bot.js           #   客服机器人浮窗（固定右下角）
    │   ├── modal.js              #   模态框（确认/取消）
    │   └── toast.js              #   Toast 消息提示
    │
    └── pages/                    # 页面组件（每个文件导出 render* 函数）
        │
        │  ── 公开页面 ──
        ├── landing.js            #   落地页（未登录首页）
        ├── login.js              #   登录
        ├── register.js           #   注册
        ├── forgot-password.js    #   忘记密码
        ├── help.js               #   帮助中心
        ├── contact.js            #   联系我们
        │
        │  ── 用户页面（需登录）──
        ├── dashboard.js          #   控制台（统计卡片 + 快捷入口）
        ├── orders.js             #   工单列表
        ├── order-detail.js       #   工单详情
        ├── accounts.js           #   游戏账号列表
        ├── account-detail.js     #   账号详情（等级/地图/技能/装备）
        ├── invite.js             #   邀请系统（邀请码 + 分成）
        ├── leaderboard.js        #   排行榜
        ├── settings.js           #   个人设置
        ├── recharge.js           #   充值页面
        ├── market.js             #   市场（官方 + 黑市）
        ├── appeals.js            #   我的申诉
        ├── after-sales.js        #   我的售后
        │
        │  ── 管理页面（需 admin 角色）──
        ├── admin-stats.js        #   管理仪表盘
        ├── admin-users.js        #   用户管理
        ├── admin-orders.js       #   工单管理
        ├── admin-accounts.js     #   账号管理
        ├── admin-coupons.js      #   优惠券管理
        ├── admin-config.js       #   系统配置
        ├── admin-announcements.js #  公告管理
        ├── admin-ads.js          #   广告管理
        ├── admin-appeals.js      #   申诉管理
        ├── admin-market.js       #   官方市场管理
        ├── admin-market-orders.js #  市场订单管理
        ├── admin-recharge.js     #   充值审核
        ├── admin-recharge-codes.js # 兑换码管理
        ├── admin-ai-config.js    #   AI 配置
        └── admin-super.js        #   超级管理员
```

### 3.4 前端数据流

```
用户操作
  │
  ▼
Page 组件 (render* 函数)
  │  调用 api.get/post(...)
  ▼
ApiClient (api.js)
  │  添加 Authorization header
  │  fetch('/api/<path>')
  ▼
Pages Functions (后端)
  │  authenticate() → 查 DB
  │  业务逻辑 → SQL 操作
  │  返回 JSON
  ▼
Page 组件
  │  更新 container.innerHTML（模板字符串渲染）
  │  调用 toast() 显示提示
  ▼
DOM 更新（直接替换 innerHTML，无 Virtual DOM）
```

---

## 4. 数据模型概述

### 4.1 核心实体关系

```
┌──────────┐       ┌──────────┐       ┌──────────────────┐
│  users   │──1:N──│ sessions │       │     config       │
│          │       └──────────┘       │  (key-value 存储) │
│  id (PK) │                          └──────────────────┘
│  username │
│  level    │──1:N──┌──────────┐──1:N──┌──────────────────┐
│  xp       │       │  orders  │       │  game_accounts   │
│  role     │       │          │       │                  │
│  invite_  │       │ user_id  │       │  order_id (FK)   │
│   points  │       │ status   │       │  username/pw     │
│  bonus_   │       │ payment  │       │  level/realm     │
│   points  │       │ amount   │       │  map_name        │
└──────────┘       │ coupon   │       │  health_status   │
      │            └──────────┘       └──────────────────┘
      │                 │
      │            ┌────▼─────────┐
      │            │order_        │
      │            │activities    │
      │            │(操作日志)     │
      │            └──────────────┘
      │
      ├──1:N──┌──────────────┐
      │       │  appeals     │  申诉
      │       │  after_sales │  售后
      │       └──────────────┘
      │
      ├──1:N──┌──────────────┐
      │       │ notifications│  通知
      │       └──────────────┘
      │
      ├──1:N──┌──────────────┐
      │       │  bot_logs    │  机器人对话记录
      │       └──────────────┘
      │
      ├──1:N──┌──────────────┐
      │       │ redeem_log   │  兑换记录
      │       └──────────────┘
      │
      └──1:N──┌──────────────┐
              │checkin_logs  │  健康检测日志
              └──────────────┘

独立表：
  coupons          优惠券
  redeem_codes     兑换码
  reset_tokens     密码重置 Token
  announcements    公告
  ads              广告位
  contact_messages  联系留言
  account_logs     账号操作日志
```

### 4.2 关键关系说明

| 关系 | 说明 |
|------|------|
| `users` → `orders` | 一个用户可提交多个工单（1:N） |
| `orders` → `game_accounts` | 一个工单对应一个游戏账号（1:1） |
| `users` → `sessions` | 一个用户可有多个活跃会话（1:N，7天过期） |
| `users` → `invite_code` | 每个用户唯一邀请码，`invited_by` 指向邀请人 |
| `orders` → `order_activities` | 工单操作日志（创建/审核/完成等） |
| `users` → `bonus_points` | 修仙币余额（充值获得，市场消费） |
| `users` → `invite_points` | 邀请积分（好友成交获得，可提现） |
| `config` | 全局配置键值对（价格、汇率、站点名等） |

---

## 5. 主要 API 端点分组

### 5.1 认证模块 `/api/auth/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 无 |
| POST | `/api/auth/login` | 用户登录（返回 Token） | 无 |
| POST | `/api/auth/forgot-password` | 忘记密码（发送重置邮件） | 无 |
| POST | `/api/auth/reset-password` | 重置密码 | 无 |

### 5.2 工单模块 `/api/orders/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/orders` | 用户工单列表 | Token |
| POST | `/api/orders` | 创建工单 | Token |
| GET | `/api/orders/:id` | 工单详情 | Token |
| PUT | `/api/orders/:id/status` | 更新工单状态 | Token |
| GET | `/api/orders/:id/activities` | 工单活动日志 | Token |

### 5.3 游戏账号 `/api/accounts/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/accounts` | 账号列表 | Token |
| GET | `/api/accounts/:id` | 账号详情 | Token |
| GET | `/api/accounts/:id/logs` | 账号日志 | Token |

### 5.4 管理后台 `/api/admin/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/admin/stats` | 管理仪表盘统计 | Admin |
| GET | `/api/admin/orders` | 所有工单（分页+筛选） | Admin |
| GET | `/api/admin/users` | 所有用户 | Admin |
| GET | `/api/admin/accounts` | 所有游戏账号 | Admin |
| CRUD | `/api/admin/coupons` | 优惠券管理 | Admin |
| GET\|PUT | `/api/admin/config` | 系统配置 | Admin |
| CRUD | `/api/admin/announcements` | 公告管理 | Admin |
| CRUD | `/api/admin/ads` | 广告管理 | Admin |
| CRUD | `/api/admin/appeals` | 申诉管理 | Admin |
| PUT | `/api/admin/appeals/:id/reply` | 申诉回复 | Admin |
| GET | `/api/admin/recharge` | 充值审核列表 | Admin |
| CRUD | `/api/admin/recharge-codes` | 兑换码管理 | Admin |
| PUT | `/api/admin/users/:id/role` | 修改用户角色 | Admin |
| PUT | `/api/admin/users/:id/lock` | 锁定/解锁用户 | Admin |
| PUT | `/api/admin/users/:id/level` | 修改用户等级 | Admin |
| POST | `/api/admin/points` | 手动调整修仙币 | Admin |

### 5.5 GitHub Actions 接口 `/api/gh/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/gh/approved-orders` | 获取审核通过的工单 | API Key |
| POST | `/api/gh/complete-order` | 标记工单完成 | API Key |
| POST | `/api/gh/report-account` | 上报新注册账号 | API Key |
| POST | `/api/gh/report-health` | 上报账号健康状态 | API Key |
| POST | `/api/gh/report-log` | 上报操作日志 | API Key |
| GET | `/api/gh/active-accounts` | 获取活跃账号列表 | API Key |
| POST | `/api/gh/test-account` | 测试账号状态 | API Key |
| POST | `/api/gh/report-trial-test` | 上报试炼结果 | API Key |

### 5.6 市场模块 `/api/market/*`

| 方法 | 端点 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/market/items` | 官方市场商品列表 | Token |
| POST | `/api/market/purchase` | 购买官方商品 | Token |
| GET | `/api/market/orders` | 黑市挂单列表 | Token |
| POST | `/api/market/orders/buy` | 黑市购买 | Token |
| POST | `/api/market/orders/confirm` | 确认收货 | Token |
| POST | `/api/market/orders/cancel` | 取消订单 | Token |
| POST | `/api/market/orders/ship` | 发货 | Token |

### 5.7 其他模块

| 模块 | 端点 | 说明 |
|------|------|------|
| 邀请 | `/api/invite/*` | 信息/套餐/购买/提现 |
| 充值 | `/api/recharge/*` | 充值记录/创建充值 |
| 兑换码 | `/api/redeem` | 兑换码兑换 |
| 优惠券 | `/api/coupon/validate` | 优惠券验证 |
| 客服 | `/api/bot/ask` | AI 客服问答 |
| 通知 | `/api/notifications/*` | 通知列表/标记已读 |
| 申诉 | `/api/appeals` | 提交申诉 |
| 售后 | `/api/after-sales/*` | 提交售后/回复 |
| 联系 | `/api/contact` | 留言 |
| 排行榜 | `/api/leaderboard/*` | 邀请/等级/消费排行 |
| 用户 | `/api/user/*` | 资料/改密/公开信息 |

---

## 6. 中间件与工具函数

### 6.1 全局中间件 ([`functions/_middleware.js`](functions/_middleware.js))

| 功能 | 实现 | 配置 |
|------|------|------|
| **CORS** | 预检 OPTIONS 自动响应，所有响应附加 CORS 头 | `CORS_ORIGIN` 环境变量，留空允许所有 |
| **限流** | 内存 Map + IP 级别计数器 | 60 次/分钟，超过返回 429 |
| **内存清理** | 定期清理过期限流条目 | 每 2 分钟清理，上限 10000 条目 |
| **API Key** | `gh/*` 路由校验 `X-API-Key` header | 恒定时间比较，防时序攻击 |

### 6.2 认证模块 ([`functions/_auth.js`](functions/_auth.js))

| 函数 | 用途 |
|------|------|
| `authenticate(request, env)` | 从 Authorization header 提取 Token → 查 sessions 表 → 返回 user 对象或 null |
| `authenticateApi(request, env)` | 从 X-API-Key header 校验 API 密钥（恒定时间比较） |
| `isAdmin(user)` | 检查 user 是否为 admin 或 super_admin（兼容旧 is_admin 字段） |

### 6.3 工具函数 ([`functions/_utils.js`](functions/_utils.js))

| 函数 | 用途 |
|------|------|
| `json(data, status)` | 封装 JSON 响应 |
| `html(content, status)` | 封装 HTML 响应 |
| `hashPassword(pw)` | PBKDF2 密码哈希（100K 迭代，输出 `pbkdf2:iterations:salt:hash`） |
| `verifyPassword(pw, hash)` | 验证密码（兼容旧 SHA-256 + 新 PBKDF2，静默升级） |
| `isLegacyHash(hash)` | 检测是否为旧 SHA-256 格式 |
| `constantTimeEqual(a, b)` | 恒定时间字符串比较（防时序攻击） |
| `generateToken()` | 生成 32 字节随机 Token（64 位十六进制） |
| `getClientIP(request)` | 获取客户端 IP（CF-Connecting-IP / X-Forwarded-For） |
| `logActivity(env, orderId, userId, action, detail)` | 记录工单操作日志 |
| `generateRechargeCode()` | 生成 8 位随机兑换码（大写字母+数字） |

### 6.4 等级/经验值模块 ([`functions/_xp.js`](functions/_xp.js))

| 导出 | 用途 |
|------|------|
| `XP_LEVELS` | 经验值等级阈值数组（10 级） |
| `LEVEL_TITLES` | 等级称号映射（仙友→仙尊） |
| `INVITE_BOOST_TIERS` | 邀请倍率梯队（基础→至尊，1.0x→3.0x） |
| `CASH_PACKAGES` | 现金充值套餐（¥5-¥50，2500-25000 修仙币） |
| `SPIRIT_STONE_PACKAGES` | 灵石充值套餐（500万-1亿灵石） |
| `recalcUserLevel(env, userId)` | 重算用户等级 |

---

## 7. 外部集成清单

| 集成 | 方式 | 说明 |
|------|------|------|
| **Cloudflare Pages** | 部署 | 托管前端静态资源 + Functions API |
| **Cloudflare D1** | 数据库绑定 `env.DB` | SQLite 数据库，19 张表 |
| **Cloudflare Workers** | 部署（旧版） | `worker/index.js`，已废弃，保留兼容 |
| **GitHub Actions** | 定时任务 | 订单扫描（10分钟）、健康检查（30分钟）、部署 |
| **GitHub API** | `@octokit/rest` | Worker 旧版中用于 GitHub 仓库操作 |
| **游戏服务器 API** | HTTP 请求 | `API_BASE` + `SIGN_KEY`，gh-actions 中调用 |
| **代理服务器** | `https-proxy-agent` | gh-actions 中用于绕过 IP 限制 |
| **加密库** | `libsodium-wrappers` / `tweetnacl` | 签名验证、加密操作 |
| **Google Fonts** | CDN 引入 | Orbitron（赛博朋克字体）+ Noto Sans SC |
| **客服机器人** | 本地关键词匹配 | 无需外部 AI 服务，基于规则回复 |
| **微信支付** | 二维码扫码 | 线下支付，管理员手动审核 |
| **灵石支付** | 游戏内货币 | 通过游戏服务器验证 |

---

## 8. 安全设计

| 机制 | 实现 |
|------|------|
| **密码存储** | PBKDF2 (100K 迭代) + 随机 Salt，兼容旧 SHA-256 静默迁移 |
| **会话管理** | 32 字节随机 Token，7 天过期，存储于 D1 sessions 表 |
| **API Key** | 恒定时间比较防时序攻击，仅 gh/* 路由需要 |
| **限流** | IP 级别 60 次/分钟，内存 Map + 定期清理 |
| **CORS** | 可配置允许域名，支持预检 |
| **输入验证** | 长度限制、枚举校验、必填检查 |
| **管理员权限** | `authenticateAdmin()` + `isAdmin()` 双重校验 |
| **角色系统** | user → admin → super_admin 三级权限 |

---

*文档生成时间：2026-07-22 | 基于项目源码深度分析*
