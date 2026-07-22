# 艾德尔修仙传 — 工单系统 · 项目全景概览

> **一句话定位**：赛博朋克风格的邀请积分购买工单平台，配合 GitHub Actions 实现全自动账号注册、刷怪、升级。

---

## 核心功能

| # | 功能 | 说明 |
|---|------|------|
| 1 | 用户系统 | 注册/登录（PBKDF2 哈希）、等级体系（Lv.1-10，最高 70% 折扣）、角色权限（user/admin/super_admin） |
| 2 | 工单系统 | 提交购买工单（邀请码+支付信息+优惠码）→ 管理员审核 → 自动注册处理 |
| 3 | 邀请系统 | 生成邀请码、好友成交后 30% 积分分成、积分提现 |
| 4 | 客服机器人 | 工单状态查询、价格说明、常见问题自动回复 |
| 5 | 账号监控 | 实时显示游戏账号等级、地图、技能、装备信息 |
| 6 | 自动注册 | GitHub Actions 每 10 分钟扫描审核通过的工单，自动注册全金灵根账号 |
| 7 | 自动升级 | 每 30 分钟健康检测，自动点击升级，120 级停号 |
| 8 | 防封号 | 独立 IP 伪装、指纹轮换、智能分段暂停（`_anti_detect.js`） |

---

## 技术栈总览

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | Vanilla JS (ES Modules) | Hash-based SPA 路由，零框架依赖，赛博朋克主题 CSS |
| **后端 API** | Cloudflare Pages Functions | `functions/api/` 目录，文件系统路由，RESTful 风格 |
| **旧 Worker** | Cloudflare Workers (ESM) | `worker/index.js`（已标记废弃，迁移至 Pages Functions） |
| **数据库** | Cloudflare D1 (SQLite) | 绑定名 `DB`，数据库名 `ider-orders` |
| **认证** | PBKDF2 + Session Token | 密码哈希 100K 迭代，Bearer Token 认证 |
| **自动化** | GitHub Actions | 订单扫描（每 10 分钟）、健康检查（每 30 分钟）、部署 |
| **部署** | Cloudflare Pages + Worker | Pages 托管前端 + Functions API，Worker 兼容旧版 |

---

## 目录结构与职责

```
工单系统/
├── README.md                          # 项目说明文档
├── package.json                       # NPM 配置（v2.0.0）
├── schema.sql                         # D1 数据库 Schema（v4.0，13 张表）
├── wrangler.toml                      # Cloudflare Pages 配置
├── wrangler.worker.toml               # Cloudflare Worker 配置（旧版）
├── deploy.js                          # Worker 手动部署脚本
├── deploy_pages.js                    # Pages 手动部署脚本
│
├── functions/                         # ⭐ Cloudflare Pages Functions（主后端）
│   ├── _middleware.js                  #   全局中间件：CORS、限流、API Key 校验
│   ├── _auth.js                        #   认证模块：Token 验证、管理员检查
│   ├── _db.js                          #   数据库工具函数
│   ├── _utils.js                       #   通用工具（密码哈希、常量时间比较等）
│   ├── _xp.js                          #   经验值/等级计算模块
│   └── api/                            #   API 路由（文件系统路由）
│       ├── auth/                        #     认证：login, register, forgot/reset-password
│       ├── orders/                      #     工单：提交、详情、状态、活动日志
│       ├── accounts/                    #     游戏账号：列表、详情、日志
│       ├── admin/                       #     管理后台：用户/工单/账号/优惠券/配置/广告/公告
│       ├── invite/                      #     邀请系统：信息、套餐、购买、提现
│       ├── market/                      #     市场：商品、购买、订单管理
│       ├── gh/                          #     GitHub Actions 接口：工单扫描、健康上报
│       ├── bot/                         #     客服机器人：AI 问答
│       ├── redeem/                      #     兑换码系统
│       ├── recharge/                    #     充值系统
│       ├── coupon/                      #     优惠券验证
│       ├── notifications/               #     通知系统
│       ├── appeals/                     #     申诉系统
│       ├── after-sales/                 #     售后系统
│       ├── contact/                     #     联系留言
│       ├── leaderboard/                 #     排行榜：邀请/等级/消费
│       ├── user/                        #     用户：资料、改密、公开信息
│       ├── ads/                         #     广告位
│       ├── announcements/               #     公告
│       ├── config/                      #     公共配置
│       ├── stats/                       #     统计数据
│       └── public/                      #     公开接口
│
├── pages-frontend/                    # ⭐ Cloudflare Pages 前端（SPA）
│   ├── index.html                      #   HTML 入口
│   ├── _redirects                       #   SPA 路由重写规则
│   └── src/js/
│       ├── app.js                       #   SPA 入口：路由注册、布局渲染
│       ├── router.js                    #   Hash-based SPA 路由器
│       ├── store.js                     #   简易状态管理（用户、配置）
│       ├── api.js                       #   API 客户端（fetch 封装）
│       ├── icons.js                     #   SVG 图标库
│       ├── components/                  #   公共组件
│       │   ├── sidebar.js               #     侧边栏导航
│       │   ├── topbar.js                #     顶部栏
│       │   ├── chat-bot.js              #     客服机器人浮窗
│       │   ├── modal.js                 #     模态框
│       │   └── toast.js                 #     消息提示
│       └── pages/                       #   页面模块（~30 个）
│           ├── landing.js               #     落地页
│           ├── login.js / register.js   #     登录/注册
│           ├── dashboard.js             #     用户仪表盘
│           ├── orders.js                #     工单列表
│           ├── market.js                #     市场
│           ├── invite.js                #     邀请系统
│           ├── admin-*.js               #     管理后台页面（约 15 个）
│           └── ...                      #     其他页面
│
├── worker/                            # ⚠️ 旧版 Worker（已废弃，保留兼容）
│   ├── index.js                        #   Worker 入口（1830 行，含完整 API）
│   └── static.js                       #   内联静态资源（2542 行，含 CSS+HTML）
│
├── gh-actions/                        # GitHub Actions 自动化脚本
│   ├── scan_orders.js                  #   订单扫描：注册新账号
│   ├── health_check.js                 #   健康检测：自动升级
│   ├── daily_trial.js                  #   每日试炼
│   ├── trial_tester.js                 #   试炼测试
│   ├── _anti_detect.js                 #   反检测模块（IP/指纹伪装）
│   └── trial_config.json               #   试炼配置
│
├── .github/workflows/                 # GitHub Actions 工作流
│   ├── deploy.yml                      #   部署：push master → Pages + Worker
│   ├── order-scan.yml                  #   订单扫描：每 10 分钟
│   ├── health-check.yml                #   健康检查：每 30 分钟
│   ├── daily-trial.yml                 #   每日试炼
│   └── trial-test.yml                  #   试炼测试
│
├── docs/                              # 项目文档
│   ├── PROJECT_OVERVIEW.md             #   本文件
│   ├── architecture.md                 #   架构文档
│   ├── optimization-roadmap.md         #   优化路线图
│   └── review-report*.md               #   审查报告
│
├── migration_*.sql                     # 数据库迁移脚本（v3-v8）
├── test-*.md                           # 测试报告
└── set-github-secrets.mjs              # GitHub Secrets 批量设置工具
```

---

## 数据库表结构（D1 / SQLite）

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `users` | 用户 | username, password_hash, level, xp, invite_code, role, invite_points |
| `sessions` | 登录会话 | token, user_id, expires_at |
| `orders` | 工单 | user_id, invite_code, payment_method, amount, status, coupon_code |
| `game_accounts` | 游戏账号 | order_id, username, password, level, realm, map_name, health_status |
| `coupons` | 优惠券 | code, discount_percent, max_uses, expires_at |
| `notifications` | 通知 | user_id, title, content, type, is_read |
| `appeals` | 申诉 | user_id, order_id, title, status, admin_reply |
| `after_sales` | 售后 | （含在 order_activities / appeals 中） |
| `bot_logs` | 机器人日志 | question, answer |
| `checkin_logs` | 健康检测日志 | game_account_id, check_type, result |
| `config` | 系统配置 | key-value 键值对 |
| `order_activities` | 工单活动流 | order_id, action, detail |
| `redeem_codes` | 兑换码 | code, xp, max_uses |
| `redeem_log` | 兑换记录 | user_id, code, xp |
| `account_logs` | 账号日志 | account_id, log_type, message |
| `announcements` | 公告 | content, enabled |
| `ads` | 广告位 | type, image_url, link_url, enabled |
| `reset_tokens` | 密码重置 | token, user_id, expires_at |
| `contact_messages` | 联系留言 | user_id, name, email, content |

---

## 开发环境要求

| 项目 | 要求 |
|------|------|
| Node.js | ≥ 20（`deploy.yml` 指定） |
| npm | 随 Node.js 安装 |
| Wrangler | ≥ 3.0（`devDependencies` 中指定） |
| Cloudflare 账户 | 需要 API Token + Account ID |
| 数据库 | Cloudflare D1（无需本地安装，wrangler 支持本地模拟） |

### 环境变量 / Secrets

| 变量 | 用途 | 设置位置 |
|------|------|----------|
| `CLOUDFLARE_API_TOKEN` | CF API 认证 | GitHub Secrets / 本地 .env |
| `CLOUDFLARE_ACCOUNT_ID` | CF 账户 ID | GitHub Secrets / 本地 .env |
| `WORKER_URL` | Worker 地址 | GitHub Secrets |
| `API_KEY` | Worker API 密钥 | wrangler.toml / GitHub Secrets |
| `CORS_ORIGIN` | CORS 允许域名 | wrangler.toml（留空=允许所有） |
| `API_BASE` | 游戏服务器 API | GitHub Secrets |
| `SIGN_KEY` | 游戏签名密钥 | GitHub Secrets |
| `CLIENT_VERSION` | 游戏客户端版本 | GitHub Secrets |

---

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 创建 D1 数据库（首次）
npx wrangler d1 create ider-orders

# 3. 初始化数据库 Schema
npx wrangler d1 execute ider-orders --file=./schema.sql

# 4. 本地开发（Pages Functions + D1 本地模拟）
npm run dev

# 5. 部署到 Cloudflare（Pages + Worker）
npm run deploy
```

### 常用命令

```bash
# 本地预览数据库
npm run preview-db

# 手动扫描订单（本地测试）
npm run scan-orders

# 手动健康检查（本地测试）
npm run health-check

# 执行数据库迁移
npx wrangler d1 execute ider-orders --file=./migration_v8.sql
```

---

## 架构图

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Cloudflare      │     │  Cloudflare      │     │  GitHub          │
│  Pages           │────▶│  Workers/        │────▶│  Actions         │
│  (前端 SPA)      │     │  Functions       │     │  (自动化)         │
│                  │     │  (API + D1)      │     │                  │
│  静态资源托管     │     │  RESTful API     │     │  scan_orders.js  │
│  _redirects SPA  │     │  中间件(CORS/限流) │     │  health_check.js │
│  ES Modules      │     │  PBKDF2 认证      │     │  daily_trial.js  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  Cloudflare D1   │
                         │  (SQLite 数据库)  │
                         │  19 张表          │
                         └──────────────────┘
```

---

## 版本历史

| 版本 | 里程碑 |
|------|--------|
| v1.0 | 基础工单系统 |
| v2.0 | 邀请系统、优惠码、排行榜 |
| v3.0 | 兑换码系统、密码重置 Token |
| v3.1 | D1 存储密码重置、反检测模块 |
| v4.0 | 角色系统（user/admin/super_admin）、联系留言、售后系统 |
| v5.0+ | 市场系统、充值码、AI 配置、广告系统 |

---

*文档生成时间：2026-07-22 | 基于项目源码全量扫描*
