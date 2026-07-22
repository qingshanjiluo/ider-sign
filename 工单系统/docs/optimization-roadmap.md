# 艾德尔工单系统 — 优化方向与路线图

> 更新时间：2026-07-21
> 基于全面代码审查结果

---

## 一、优化概览

```mermaid
graph LR
    subgraph Phase1[紧急修复]
        A1[数据库迁移]
        A2[代码Bug修复]
        A3[安全加固]
    end

    subgraph Phase2[功能完善]
        B1[管理后台完善]
        B2[用户系统增强]
        B3[市场系统完善]
    end

    subgraph Phase3[架构优化]
        C1[代码重构]
        C2[性能优化]
        C3[测试覆盖]
    end

    subgraph Phase4[扩展功能]
        D1[AI智能客服]
        D2[数据分析]
        D3[多语言支持]
    end

    Phase1 --> Phase2 --> Phase3 --> Phase4
```

---

## 二、Phase 1：紧急修复（立即执行）

### 2.1 数据库迁移执行

**优先级：🔴 P0**

| 迁移文件 | 内容 | 执行命令 |
|----------|------|----------|
| migration_v5.sql | 市场+充值表 | `npx wrangler d1 execute ider-orders --file=migration_v5.sql` |
| migration_v6.sql | 兑换码表 | `npx wrangler d1 execute ider-orders --file=migration_v6.sql` |
| migration_v8.sql | 优惠券改造 | `npx wrangler d1 execute ider-orders --file=migration_v8.sql` |

**验证方法：**
```sql
-- 执行后检查表是否存在
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- 应包含：market_items, market_orders, recharge_orders, recharge_codes
```

---

### 2.2 数据库字段补充

**优先级：🔴 P0**

```sql
-- 添加缺失的 total_purchased_points 字段
ALTER TABLE users ADD COLUMN total_purchased_points REAL DEFAULT 0;

-- 验证
PRAGMA table_info(users);
-- 应包含 total_purchased_points 字段
```

---

### 2.3 代码Bug修复

**优先级：🔴 P0**

| 文件 | 行号 | 问题 | 修复 |
|------|------|------|------|
| `functions/api/invite/purchase.js` | 27 | `pkg.points` 不存在 | 改为 `pkg.coins` |
| `pages-frontend/src/js/api.js` | 57,64 | `getUserInfo()` 重复定义 | 删除第64行重复 |
| `pages-frontend/src/js/api.js` | 76,134 | `validateCoupon()` 重复定义 | 删除第134行重复 |

---

### 2.4 安全加固

**优先级：🔴 P1**

| 问题 | 文件 | 修复方案 |
|------|------|----------|
| 种子密码硬编码 | schema.sql | 移除种子用户，使用初始化脚本 |
| 密码重置令牌暴露 | forgot-password.js | 移除 reset_token 返回值 |
| 管理员权限不一致 | 多个admin API | 统一使用 isAdmin() 函数 |

**管理员权限统一修复清单：**
```javascript
// 将以下文件中的 user.is_admin 检查改为 isAdmin(user)
- functions/api/admin/orders.js:10
- functions/api/admin/stats.js:10
- functions/api/orders/[id]/status.js:27
```

---

## 三、Phase 2：功能完善（近期执行）

### 3.1 管理后台工单操作

**优先级：🟠 P2**

当前问题：管理后台工单列表缺少审批/拒绝按钮

**实现方案：**
1. 在 `admin-orders.js` 添加操作按钮
2. 调用 `POST /api/orders/:id/status` 接口
3. 添加操作确认弹窗
4. 记录操作日志

**新增文件：**
- 无需新增，修改现有文件即可

---

### 3.2 邀请提现审核流程

**优先级：🟠 P2**

当前问题：提现直接扣除积分无审核

**实现方案：**
1. 新增 `withdraw_requests` 表
2. 提现申请写入表而非直接扣除
3. 管理后台新增提现审核页面
4. 审核通过后执行扣除

```sql
-- 新增提现申请表
CREATE TABLE IF NOT EXISTS withdraw_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  points REAL NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  admin_id INTEGER DEFAULT 0,
  admin_notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

### 3.3 数据库迁移版本管理

**优先级：🟠 P2**

当前问题：无法追踪数据库版本，容易遗漏或重复执行迁移

**实现方案：**
1. 新增 `migrations` 表记录已执行的迁移
2. 创建迁移执行脚本自动检测并执行
3. 每个迁移文件添加版本号注释

```sql
-- 迁移版本跟踪表
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  executed_at TEXT DEFAULT (datetime('now'))
);
```

---

### 3.4 输入验证增强

**优先级：🟡 P3**

| API | 需要添加的验证 |
|-----|---------------|
| `/api/auth/register` | username 长度限制 3-20 |
| `/api/orders` POST | note 字段最大500字符 |
| `/api/contact` POST | content 字段最大2000字符 |
| `/api/appeals` POST | content 字段最大2000字符 |
| `/api/market/orders` POST | title 最大100字符，description 最大500字符 |

---

### 3.5 限流器改进

**优先级：🟡 P3**

当前问题：Pages Functions 版本无限流器清理机制

**实现方案：**
将 `worker/index.js` 中的 `cleanupRateLimit()` 函数迁移到 `functions/_middleware.js`

```javascript
// 添加清理机制
const RATE_LIMIT_CLEANUP_INTERVAL = 30000;
const RATE_LIMIT_ENTRY_TTL = 60000;
let lastCleanup = Date.now();

function cleanupRateLimit() {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [k, v] of rateLimitMap) {
    if (now - v.reset > RATE_LIMIT_ENTRY_TTL) rateLimitMap.delete(k);
  }
}
```

---

## 四、Phase 3：架构优化（中期执行）

### 4.1 前端代码重构

**优先级：🟡 P3**

当前问题：api.js 中有重复方法定义

**重构清单：**
1. 删除 `getUserInfo()` 重复定义（第64行）
2. 删除 `validateCoupon()` 重复定义（第134行）
3. 统一 API 方法命名规范
4. 添加 TypeScript 类型定义（可选）

---

### 4.2 后端代码重构

**优先级：🟡 P3**

当前问题：INVITE_BOOST_TIERS 在多处重复定义

**重构清单：**
1. `functions/api/orders/[id]/status.js` 导入 `_xp.js` 中的常量
2. 删除内联的 `getInviteBoost()` 函数
3. 统一使用 `_xp.js` 导出的函数

---

### 4.3 废弃代码清理

**优先级：🟡 P3**

| 文件 | 状态 | 操作 |
|------|------|------|
| worker/index.js | 已废弃 | 移至 archive/ 或删除 |
| worker/static.js | 已废弃 | 移至 archive/ 或删除 |

---

### 4.4 测试覆盖

**优先级：🟢 P4**

当前问题：零测试覆盖

**测试策略：**
1. 为每个 API 端点编写集成测试
2. 使用 wrangler 的 `--local` 模式测试
3. 覆盖核心业务逻辑：
   - 用户注册/登录
   - 工单创建/审批
   - 充值/兑换码
   - 市场购买

---

### 4.5 性能优化

**优先级：🟢 P4**

| 优化项 | 说明 |
|--------|------|
| 数据库查询优化 | 为常用查询添加复合索引 |
| API 响应缓存 | 静态数据添加 Cache-Control |
| 前端懒加载 | 页面模块按需加载 |
| 图片优化 | 使用 WebP 格式，添加懒加载 |

---

## 五、Phase 4：扩展功能（远期规划）

### 5.1 AI 智能客服

**优先级：🟢 P4**

当前问题：客服机器人仅支持关键词匹配

**实现方案：**
1. 集成 OpenRouter API
2. 构建工单知识库
3. 实现上下文对话
4. 添加意图识别

**相关文件：**
- `functions/api/bot/ask.js` — 已有基础实现
- `functions/api/admin/ai-config.js` — AI 配置管理

---

### 5.2 数据分析仪表板

**优先级：🟢 P4**

**增强功能：**
1. 用户行为分析
2. 工单转化漏斗
3. 收入趋势图表
4. 用户留存分析

---

### 5.3 多语言支持

**优先级：🟢 P4**

**实现方案：**
1. 提取所有文本到 i18n 文件
2. 实现语言切换功能
3. 支持中文/英文

---

### 5.4 移动端优化

**优先级：🟢 P4**

**改进点：**
1. 底部导航栏
2. 手势操作支持
3. 推送通知
4. PWA 支持

---

### 5.5 高级安全功能

**优先级：🟢 P4**

| 功能 | 说明 |
|------|------|
| 双因素认证 | TOTP/SMS 2FA |
| 登录日志 | 记录登录IP/设备 |
| 异常检测 | 异常登录预警 |
| 数据加密 | 敏感字段加密存储 |

---

## 六、执行计划

### 6.1 立即执行（本周）

- [ ] 执行所有数据库迁移文件
- [ ] 添加 total_purchased_points 字段
- [ ] 修复 invite/purchase.js 属性名错误
- [ ] 删除 api.js 重复方法
- [ ] 移除 schema.sql 种子用户
- [ ] 修复密码重置令牌暴露

### 6.2 近期执行（2周内）

- [ ] 统一管理员权限检查函数
- [ ] 完善管理后台工单操作按钮
- [ ] 实现提现审核流程
- [ ] 添加数据库迁移版本管理
- [ ] 增强输入验证
- [ ] 改进限流器清理机制

### 6.3 中期执行（1个月内）

- [ ] 重构重复代码
- [ ] 清理废弃文件
- [ ] 添加单元测试
- [ ] 性能优化

### 6.4 远期执行（3个月内）

- [ ] AI 智能客服
- [ ] 数据分析增强
- [ ] 多语言支持
- [ ] 移动端优化

---

## 七、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据库迁移失败 | 功能不可用 | 先在测试环境验证 |
| 代码修改引入新Bug | 功能异常 | 添加测试用例 |
| 安全漏洞未及时修复 | 数据泄露 | 定期安全审计 |
| 性能问题 | 用户体验差 | 监控API响应时间 |

---

## 八、成功指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 功能可用率 | 65% | 100% |
| API 响应时间 | - | < 500ms |
| 测试覆盖率 | 0% | > 60% |
| 安全漏洞 | 3个高危 | 0个高危 |
| 代码重复率 | ~15% | < 5% |
