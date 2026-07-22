# 艾德尔修仙传 — 工单系统 · 文档索引与阅读指南

> 让任何人都能快速找到所需信息。

---

## 文档列表

| 文档 | 用途 | 行数 |
|------|------|------|
| [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) | 项目全景概览：定位、功能、技术栈、目录结构、快速启动 | ~200 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 架构设计：后端分层、前端模块、数据模型、API 端点、安全设计 | ~350 |
| [`BUSINESS_LOGIC.md`](BUSINESS_LOGIC.md) | 业务逻辑：用户旅程、状态机、积分体系、数据流、防刷机制 | ~300 |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | 部署运维：环境变量、构建命令、数据库迁移、CI/CD、常见问题 | ~250 |
| [`INDEX.md`](INDEX.md) | 本文档：文档索引与阅读指南 | ~150 |

---

## 按角色推荐阅读顺序

### 🧑‍💻 新加入的开发者

```
① PROJECT_OVERVIEW.md    → 5 分钟了解项目全貌（定位、功能、技术栈）
② ARCHITECTURE.md        → 理解代码组织方式（前后端分层、数据模型）
③ 按需深入：
   ├─ 涉及工单/订单 → BUSINESS_LOGIC.md 第 3.1-3.2 节
   ├─ 涉及自动注册 → BUSINESS_LOGIC.md 第 3.3-3.4 节
   ├─ 涉及部署/CI  → DEPLOYMENT.md
   └─ 涉及具体 API → ARCHITECTURE.md 第 5 节
```

### 📋 产品经理 / 非技术人员

```
① PROJECT_OVERVIEW.md    → 了解系统能做什么（核心功能列表）
② BUSINESS_LOGIC.md      → 理解用户怎么用（3 条核心旅程 + 状态流转图）
```

### 🔧 运维人员

```
① DEPLOYMENT.md          → 部署清单、环境变量、常见问题排查
② PROJECT_OVERVIEW.md    → 了解系统架构（Cloudflare 全家桶）
③ BUSINESS_LOGIC.md      → 了解自动化流程（GitHub Actions 定时任务）
```

### 🏗️ 架构师 / 技术负责人

```
① ARCHITECTURE.md        → 整体架构图、分层模式、API 设计
② BUSINESS_LOGIC.md      → 业务复杂度评估（状态机、经济体系）
③ DEPLOYMENT.md          → 基础设施决策（Serverless vs 传统）
```

---

## 关键文件快速索引

### 后端核心（Cloudflare Pages Functions）

| 文件 | 说明 |
|------|------|
| [`functions/_middleware.js`](../functions/_middleware.js) | 全局中间件：CORS、限流（60次/分钟）、API Key 校验 |
| [`functions/_auth.js`](../functions/_auth.js) | 认证模块：Token 验证、管理员检查、API Key 比较 |
| [`functions/_utils.js`](../functions/_utils.js) | 工具函数：密码哈希(PBKDF2)、Token 生成、活动日志、兑换码 |
| [`functions/_xp.js`](../functions/_xp.js) | 等级/经验值：10 级体系、邀请倍率、充值套餐定义 |
| [`functions/_db.js`](../functions/_db.js) | 数据库辅助：获取 D1 绑定 |
| [`functions/api/auth/login.js`](../functions/api/auth/login.js) | 登录接口（支持旧 SHA-256 自动升级 PBKDF2） |
| [`functions/api/orders/index.js`](../functions/api/orders/index.js) | 工单创建（定价、折扣、冻结积分） |
| [`functions/api/orders/[id]/status.js`](../functions/api/orders/[id]/status.js) | 工单审核（通过/拒绝/完成，含邀请分成） |
| [`functions/api/admin/recharge.js`](../functions/api/admin/recharge.js) | 充值审核（生成兑换码） |
| [`functions/api/market/purchase.js`](../functions/api/market/purchase.js) | 市场购买（扣余额、扣库存） |
| [`functions/api/redeem/index.js`](../functions/api/redeem/index.js) | 兑换码激活（修仙币 + 经验值） |
| [`functions/api/gh/approved-orders.js`](../functions/api/gh/approved-orders.js) | GitHub Actions 接口：获取审核通过的工单 |

### 前端核心（Vanilla JS SPA）

| 文件 | 说明 |
|------|------|
| [`pages-frontend/src/js/app.js`](../pages-frontend/src/js/app.js) | SPA 入口：路由注册、布局渲染、路由守卫 |
| [`pages-frontend/src/js/router.js`](../pages-frontend/src/js/router.js) | Hash-based 路由器（支持 :param 参数） |
| [`pages-frontend/src/js/store.js`](../pages-frontend/src/js/store.js) | 状态管理（发布-订阅模式） |
| [`pages-frontend/src/js/api.js`](../pages-frontend/src/js/api.js) | API 客户端（fetch 封装 + Token 管理） |
| [`pages-frontend/src/js/components/sidebar.js`](../pages-frontend/src/js/components/sidebar.js) | 侧边栏（根据角色动态菜单） |
| [`pages-frontend/src/js/pages/orders.js`](../pages-frontend/src/js/pages/orders.js) | 工单列表页 |
| [`pages-frontend/src/js/pages/market.js`](../pages-frontend/src/js/pages/market.js) | 市场页面 |
| [`pages-frontend/src/js/pages/admin-orders.js`](../pages-frontend/src/js/pages/admin-orders.js) | 管理后台-工单管理 |

### 自动化（GitHub Actions）

| 文件 | 说明 |
|------|------|
| [`gh-actions/scan_orders.js`](../gh-actions/scan_orders.js) | 订单扫描：自动注册账号（注册→装备→学技能→刷怪） |
| [`gh-actions/health_check.js`](../gh-actions/health_check.js) | 健康检测：自动升级（登录→检查→升级→切地图） |
| [`gh-actions/_anti_detect.js`](../gh-actions/_anti_detect.js) | 防封检测：IP/指纹伪装、随机延迟 |
| [`gh-actions/daily_trial.js`](../gh-actions/daily_trial.js) | 每日试炼任务 |
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | 部署工作流：push master → Pages + Worker |
| [`.github/workflows/order-scan.yml`](../.github/workflows/order-scan.yml) | 订单扫描：每 10 分钟 |
| [`.github/workflows/health-check.yml`](../.github/workflows/health-check.yml) | 健康检查：每 30 分钟 |

### 数据库

| 文件 | 说明 |
|------|------|
| [`schema.sql`](../schema.sql) | D1 Schema（19 张表 + 种子数据） |
| [`migration_v3.sql`](../migration_v3.sql) ~ [`migration_v8.sql`](../migration_v8.sql) | 增量迁移脚本 |
| [`migration_unified_v5_v6_v8.sql`](../migration_unified_v5_v6_v8.sql) | 统一迁移脚本（v5+v6+v8 合并） |
| [`run_migration_v8.js`](../run_migration_v8.js) | HTTP API 方式执行迁移 |

### 部署配置

| 文件 | 说明 |
|------|------|
| [`wrangler.toml`](../wrangler.toml) | Cloudflare Pages 配置（D1 绑定、环境变量） |
| [`wrangler.worker.toml`](../wrangler.worker.toml) | Cloudflare Worker 配置（旧版） |
| [`package.json`](../package.json) | NPM 配置（依赖、脚本） |
| [`deploy_pages.js`](../deploy_pages.js) | Pages Direct Upload 部署脚本 |
| [`deploy.js`](../deploy.js) | Worker 手动部署脚本 |
| [`set-github-secrets.mjs`](../set-github-secrets.mjs) | GitHub Secrets 批量设置工具 |

---

*文档生成时间：2026-07-22*
