# 艾德尔修仙传 — 工单系统 · 部署与运维文档

> 步骤清晰，让新运维人员能按文档完成部署。

---

## 1. 部署方式

### 1.1 Serverless 部署（推荐）

本项目采用 **Cloudflare 全家桶** 部署，无需 Docker 或传统服务器：

| 组件 | 服务 | 说明 |
|------|------|------|
| 前端 + API | **Cloudflare Pages** | 静态资源托管 + Pages Functions（Serverless API） |
| 旧版 Worker | **Cloudflare Workers** | `worker/index.js`（已废弃，保留兼容） |
| 数据库 | **Cloudflare D1** | SQLite 数据库，绑定到 Pages Functions |
| 自动化 | **GitHub Actions** | 定时任务（订单扫描、健康检查、部署） |

### 1.2 无 Docker / 无反向代理

- 项目根目录 **无** `Dockerfile` 或 `docker-compose.yml`
- 无需 `nginx.conf` 或反向代理配置
- Cloudflare 自动处理 HTTPS、CDN、DDoS 防护
- 所有 API 通过 Pages Functions 的文件系统路由暴露

---

## 2. 环境变量清单

### 2.1 Cloudflare 部署凭证（必须）

| 变量 | 说明 | 设置位置 | 必须 |
|------|------|----------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Pages + D1 权限） | GitHub Secrets / 本地 `.env` | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | GitHub Secrets / 本地 `.env` | ✅ |

### 2.2 Worker 配置（wrangler.toml）

| 变量 | 说明 | 默认值 | 文件 |
|------|------|--------|------|
| `API_KEY` | Worker API 密钥（gh/* 路由认证） | 空 | [`wrangler.toml`](wrangler.toml:12) |
| `ENVIRONMENT` | 运行环境 | `production` | [`wrangler.toml`](wrangler.toml:13) |
| `SITE_NAME` | 站点名称 | `艾德尔修仙工单平台` | [`wrangler.toml`](wrangler.toml:14) |
| `CORS_ORIGIN` | CORS 允许域名（逗号分隔，留空=允许所有） | 空 | [`wrangler.toml`](wrangler.toml:16) |

### 2.3 GitHub Actions Secrets（自动化必需）

| 变量 | 说明 | 必须 |
|------|------|------|
| `WORKER_URL` | Worker 部署地址（如 `https://ider-order-system.xxx.workers.dev`） | ✅ |
| `API_KEY` | 与 wrangler.toml 中一致的 API 密钥 | ✅ |
| `API_BASE` | 游戏服务器 API 地址（如 `https://idlexiuxianzhuan.cn`） | ✅ |
| `CLIENT_VERSION` | 游戏客户端版本号（如 `1.2.4`） | ✅ |
| `SIGN_KEY` | 游戏服务器签名密钥（HMAC-SHA256） | ✅ |

### 2.4 本地开发环境变量

```bash
# .env 文件（不提交到 Git）
CF_API_TOKEN=your_cloudflare_api_token
CF_ACCOUNT_ID=your_cloudflare_account_id
```

### 2.5 批量设置 GitHub Secrets

项目提供了自动化脚本 [`set-github-secrets.mjs`](set-github-secrets.mjs)，使用 tweetnacl 加密：

```bash
# 设置 GITHUB_TOKEN 环境变量后运行
node set-github-secrets.mjs
```

---

## 3. 构建与启动命令

### 3.1 首次部署（全新环境）

```bash
# 1. 克隆项目
git clone <repo-url>
cd 工单系统

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare
npx wrangler login

# 4. 创建 D1 数据库
npx wrangler d1 create ider-orders
# 记录输出的 database_id，更新到 wrangler.toml

# 5. 初始化数据库 Schema
npx wrangler d1 execute ider-orders --file=./schema.sql

# 6. 部署 Pages（前端 + Functions）
npx wrangler pages deploy pages-frontend --project-name=ider-order-system

# 7. 部署 Worker（旧版兼容）
npx wrangler deploy --config wrangler.worker.toml

# 8. 初始化管理员账号
npx wrangler d1 execute ider-orders --command="UPDATE users SET level = 99, role = 'super_admin' WHERE username = 'zzhx'"
```

### 3.2 日常部署

```bash
# 本地开发
npm run dev                    # 启动本地开发服务器（wrangler dev）

# 部署
npm run deploy                 # 等价于 wrangler deploy

# 或使用自动化脚本
node deploy_pages.js           # Pages Direct Upload 部署
node deploy.js                 # Worker 部署（打包 index.js + static.js）
```

### 3.3 package.json 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发（wrangler dev） |
| `npm run deploy` | 部署 Worker（wrangler deploy） |
| `npm run init-db` | 初始化 D1 数据库 Schema |
| `npm run preview-db` | 本地预览数据库 |
| `npm run scan-orders` | 手动扫描订单 |
| `npm run health-check` | 手动健康检查 |
| `npm run trial-test` | 手动试炼测试 |

---

## 4. 数据库初始化与迁移

### 4.1 初始 Schema

数据库 Schema 定义在 [`schema.sql`](schema.sql)，包含 19 张表：

```bash
# 创建数据库
npx wrangler d1 create ider-orders

# 执行 Schema（首次）
npx wrangler d1 execute ider-orders --file=./schema.sql
```

**重要**: [`schema.sql`](schema.sql:260) 底部包含种子数据：
- 预置管理员账号 `zzhx`（super_admin 角色）
- 默认系统配置（价格、汇率、站点名等）

### 4.2 数据库迁移脚本

项目提供了增量迁移脚本，按版本顺序执行：

| 脚本 | 版本 | 变更内容 |
|------|------|----------|
| [`migration_v3.sql`](migration_v3.sql) | v3.0 | 兑换码系统、密码重置 Token |
| [`migration_v4.sql`](migration_v4.sql) | v4.0 | 角色系统、联系留言 |
| [`migration_v5.sql`](migration_v5.sql) | v5.0 | 市场系统、充值码 |
| [`migration_v6.sql`](migration_v6.sql) | v6.0 | 广告系统、公告系统 |
| [`migration_v7.sql`](migration_v7.sql) | v7.0 | 售后系统、AI 配置 |
| [`migration_v8.sql`](migration_v8.sql) | v8.0 | 优惠券改造（百分比/固定金额）、工单冻结积分 |
| [`migration_unified_v5_v6_v8.sql`](migration_unified_v5_v6_v8.sql) | — | 统一迁移脚本（v5+v6+v8 合并） |

**执行迁移（远程 D1）：**

```bash
# 方式一：使用 wrangler CLI
npx wrangler d1 execute ider-orders --file=./migration_v8.sql

# 方式二：使用 HTTP API 脚本
set CF_API_TOKEN=your_token
set CF_ACCOUNT_ID=your_account_id
node run_migration_v8.js
```

**执行迁移（本地 D1 模拟）：**

```bash
npx wrangler d1 execute ider-orders --local --file=./migration_v8.sql
```

### 4.3 数据库管理

```bash
# 查询数据
npx wrangler d1 execute ider-orders --command="SELECT * FROM users LIMIT 10"

# 交互式查询
npx wrangler d1 execute ider-orders --command

# 导出数据库
npx wrangler d1 export ider-orders --output backup.sql
```

---

## 5. CI/CD 配置（GitHub Actions）

### 5.1 工作流概览

| 工作流 | 文件 | 触发条件 | 功能 |
|--------|------|----------|------|
| **Deploy** | [`deploy.yml`](.github/workflows/deploy.yml) | push master / 手动 | 部署 Pages + Worker |
| **Order Scan** | [`order-scan.yml`](.github/workflows/order-scan.yml) | 每 10 分钟 / 手动 | 扫描工单，自动注册账号 |
| **Health Check** | [`health-check.yml`](.github/workflows/health-check.yml) | 每 30 分钟 / 手动 | 检测账号状态，自动升级 |
| **Daily Trial** | [`daily-trial.yml`](.github/workflows/daily-trial.yml) | 每天 02:00 UTC / 手动 | 每日试炼任务 |
| **Trial Test** | [`trial-test.yml`](.github/workflows/trial-test.yml) | 手动触发 | 试炼测试 |

### 5.2 部署工作流详情

```yaml
# .github/workflows/deploy.yml
触发: push to master 或 workflow_dispatch
步骤:
  1. Checkout 代码
  2. Setup Node.js 20
  3. 安装 wrangler
  4. 部署 Pages: wrangler pages deploy pages-frontend --project-name=ider-order-system
  5. 部署 Worker: wrangler deploy --config wrangler.worker.toml
环境变量:
  - CLOUDFLARE_API_TOKEN (Secret)
  - CLOUDFLARE_ACCOUNT_ID (Secret)
```

### 5.3 自动化工作流详情

**Order Scan（每 10 分钟）：**

```yaml
触发: cron '*/10 * * * *' 或 workflow_dispatch
步骤:
  1. Checkout + Node.js 20
  2. cd gh-actions && npm install
  3. node scan_orders.js
环境变量:
  - WORKER_URL, API_KEY, API_BASE, CLIENT_VERSION, SIGN_KEY (Secrets)
```

**Health Check（每 30 分钟）：**

```yaml
触发: cron '*/30 * * * *' 或 workflow_dispatch
步骤:
  1. Checkout + Node.js 20
  2. cd gh-actions && npm install
  3. node health_check.js
环境变量:
  - WORKER_URL, API_KEY (Secrets)
```

---

## 6. 健康检查与监控

### 6.1 Cloudflare 内置监控

- **Pages**: Cloudflare Dashboard → Workers & Pages → ider-order-system → Analytics
- **D1**: Cloudflare Dashboard → D1 → ider-orders → 慢查询日志
- **Workers**: Cloudflare Dashboard → Workers & Pages → ider-order-system → Logs

### 6.2 应用层健康检查

- **GitHub Actions 日志**: 每次自动化任务执行后在 Actions 页面查看
- **日志上传**: `daily-trial.yml` 会上传 `trial_test_report.json` 作为 Artifact（保留 7 天）
- **测试报告**: [`test-report-2026-07-21T04-14-50.md`](test-report-2026-07-21T04-14-50.md) 等本地测试报告

### 6.3 部署验证

```bash
# 验证 Pages 部署
curl https://ider-order-system.pages.dev/

# 验证 API
curl https://ider-order-system.pages.dev/api/public/config

# 验证 Worker
curl https://ider-order-system.xxx.workers.dev/api/public/config

# 验证 D1 连接
npx wrangler d1 execute ider-orders --command="SELECT COUNT(*) FROM users"
```

---

## 7. 常见部署问题与解决

### 7.1 D1 数据库相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `D1 not found` | 数据库未创建或绑定错误 | 检查 `wrangler.toml` 中 `database_id` 是否正确 |
| `SQL error: no such table` | Schema 未初始化 | 执行 `npx wrangler d1 execute ider-orders --file=./schema.sql` |
| `ALTER TABLE: duplicate column` | 迁移脚本重复执行 | 正常现象，`IF NOT EXISTS` 会跳过已存在的列 |
| `D1 rate limit` | 查询过于频繁 | 优化 SQL 查询，添加索引，减少 N+1 查询 |

### 7.2 Pages Functions 相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `Functions not found` | 部署目录错误 | 确保 `pages-frontend/` 目录包含 `_redirects` 和 `src/` |
| `CORS error` | 跨域配置 | 设置 `CORS_ORIGIN` 环境变量或留空允许所有 |
| `401 Unauthorized` | Token 过期 | 用户重新登录，或检查 sessions 表清理过期记录 |
| `429 Too Many Requests` | 限流触发 | 降低请求频率，或调整 `_middleware.js` 中的限流参数 |

### 7.3 GitHub Actions 相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `WORKER_URL not set` | Secrets 未配置 | 在 GitHub 仓库 Settings → Secrets 中设置 |
| `API_KEY mismatch` | 密钥不一致 | 确保 GitHub Secret 和 wrangler.toml 中的 API_KEY 一致 |
| `游戏服务器连接失败` | API_BASE 或 SIGN_KEY 错误 | 检查游戏服务器是否正常运行 |
| `自动注册失败` | 防封检测触发 | 检查 `_anti_detect.js` 配置，增加延迟 |

### 7.4 Worker 部署相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `Worker 大小超限` | static.js 内联了大量 CSS/HTML | 正常现象，Worker 限制 1MB（压缩后） |
| `Module format error` | ESM/CJS 不匹配 | 确保使用 `wrangler.worker.toml` 部署 |
| `静态资源 404` | Pages 未部署 | 先部署 Pages，再部署 Worker |

---

## 8. 部署架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    部署流程概览                               │
│                                                              │
│  ① git push master                                          │
│       │                                                      │
│       ▼                                                      │
│  ② GitHub Actions (deploy.yml)                              │
│       │                                                      │
│       ├─③ wrangler pages deploy pages-frontend               │
│       │     → Cloudflare Pages (前端 + Functions API)        │
│       │     → https://ider-order-system.pages.dev            │
│       │                                                      │
│       └─④ wrangler deploy --config wrangler.worker.toml      │
│             → Cloudflare Worker (旧版兼容)                   │
│             → https://ider-order-system.xxx.workers.dev      │
│                                                              │
│  ⑤ 自动化定时任务:                                            │
│       ├─ order-scan.yml  (每10分钟) → scan_orders.js         │
│       ├─ health-check.yml (每30分钟) → health_check.js       │
│       └─ daily-trial.yml (每天02:00) → daily_trial.js        │
│                                                              │
│  ⑥ 数据库: Cloudflare D1 (ider-orders)                      │
│       └─ 绑定到 Pages Functions: env.DB                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. 快速部署清单（Checklist）

- [ ] 拥有 Cloudflare 账户
- [ ] 安装 Node.js ≥ 20 和 npm
- [ ] 安装 Wrangler: `npm install -g wrangler`
- [ ] 登录 Cloudflare: `npx wrangler login`
- [ ] 创建 D1 数据库: `npx wrangler d1 create ider-orders`
- [ ] 更新 `wrangler.toml` 中的 `database_id`
- [ ] 初始化 Schema: `npm run init-db`
- [ ] 执行所有迁移脚本（v3 → v8）
- [ ] 部署 Pages: `npx wrangler pages deploy pages-frontend --project-name=ider-order-system`
- [ ] 部署 Worker: `npx wrangler deploy --config wrangler.worker.toml`
- [ ] 配置 GitHub Secrets（WORKER_URL, API_KEY, API_BASE, CLIENT_VERSION, SIGN_KEY）
- [ ] 配置 Cloudflare Secrets（CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID）
- [ ] 验证部署: 访问 https://ider-order-system.pages.dev
- [ ] 初始化管理员: 在 D1 中设置管理员角色和等级

---

*文档生成时间：2026-07-22 | 基于项目源码与配置文件分析*
