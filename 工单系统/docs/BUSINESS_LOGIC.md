# 艾德尔修仙传 — 工单系统 · 业务逻辑文档

> 以"用户视角"描述流程，结合代码位置标注，让后续 AI 能快速定位到相关实现文件。

---

## 1. 用户角色与权限

### 1.1 角色定义

| 角色 | 标识 | 权限范围 | 检查逻辑 |
|------|------|----------|----------|
| **游客** | 未登录 | 访问落地页、登录、注册、帮助 | — |
| **普通用户** | `role='user'` | 提交工单、查看账号、充值、市场交易、邀请、申诉 | [`authenticate()`](functions/_auth.js:4) |
| **管理员** | `role='admin'` 或 `is_admin=1` | 审核工单、管理用户/账号/优惠券/配置/公告/广告 | [`authenticateAdmin()`](functions/_auth.js:6) + [`isAdmin()`](functions/_auth.js:37) |
| **超级管理员** | `role='super_admin'` | 以上全部 + 角色管理、AI 配置、系统级操作 | 同上 |

### 1.2 权限控制机制

- **前端路由守卫**: [`app.js`](pages-frontend/src/js/app.js:99) 中 `PUBLIC_ROUTES` 列表决定哪些页面无需登录
- **前端菜单过滤**: [`sidebar.js`](pages-frontend/src/js/components/sidebar.js) 根据 `user.role` 动态渲染管理菜单
- **后端认证**: 每个 API 端点开头调用 `authenticate(request, env)` 或 `authenticateAdmin(request, env)`
- **API Key 认证**: `gh/*` 路由使用 `authenticateApi(request, env)` 校验 `X-API-Key` header（恒定时间比较）

---

## 2. 核心用户旅程

### 2.1 旅程一：新用户注册 → 提交工单 → 自动注册账号

这是系统最核心的业务闭环。

```
用户浏览器                    Cloudflare Functions              GitHub Actions
    │                              │                              │
    ├─① 注册 ───────────────────▶ POST /api/auth/register        │
    │   (用户名+密码+邀请码)       │  创建 users 记录              │
    │                              │  生成唯一 invite_code         │
    │                              │  创建 session (7天)           │
    │◀─ 返回 token ──────────────┤                              │
    │                              │                              │
    ├─② 登录 ───────────────────▶ POST /api/auth/login           │
    │                              │  验证密码 (PBKDF2)           │
    │                              │  返回 token + user info       │
    │◀─ token 存入 localStorage ─┤                              │
    │                              │                              │
    ├─③ 提交工单 ───────────────▶ POST /api/orders               │
    │   (邀请码+支付方式+积分数量)  │  ① 验证积分数量(≥10,10的倍数) │
    │                              │  ② 验证支付方式              │
    │                              │  ③ 计算价格                  │
    │                              │  ④ 修仙币: 检查余额+冻结     │
    │                              │  ⑤ 优惠码折扣计算            │
    │                              │  ⑥ 等级折扣计算(取最大)      │
    │                              │  ⑦ 插入 orders (status=pending)│
    │                              │  ⑧ 发送通知+记录活动日志     │
    │◀─ "等待审核" ──────────────┤                              │
    │                              │                              │
    ├─④ 管理员审核通过 ─────────▶ POST /api/orders/:id/status    │
    │   (admin 操作)              │  status='approved'           │
    │                              │  更新用户统计                │
    │                              │  给用户加 XP                 │
    │                              │  处理邀请分成(如有)          │
    │                              │                              │
    │                              │                              │ ├─⑤ 每10分钟
    │                              │                              │ │  order-scan.yml
    │                              │                              │ │  scan_orders.js
    │                              │◀── GET /api/gh/approved-orders│
    │                              │  返回 approved 工单列表       │
    │                              │  ───────────────────────────▶│
    │                              │                              │
    │                              │                              │ ├─⑥ 自动注册
    │                              │                              │ │  registerAndSetup()
    │                              │                              │ │  a) POST 游戏服务器 /auth/register
    │                              │                              │ │  b) POST 游戏服务器 /auth/login
    │                              │                              │ │  c) 装备铁剑
    │                              │                              │ │  d) 学习技能(重击+火球术)
    │                              │                              │ │  e) 装备功法(吐纳法)
    │                              │                              │ │  f) 切换地图(荒石村)
    │                              │                              │ │  g) 开始自动刷怪
    │                              │◀── POST /api/gh/report-account│
    │                              │  保存 game_accounts 记录     │
    │                              │                              │
    │                              │◀── POST /api/gh/complete-order│
    │                              │  orders.status='completed'    │
    │                              │                              │
```

**关键代码位置：**

| 步骤 | 文件 | 行号 |
|------|------|------|
| 注册 | [`functions/api/auth/register.js`](functions/api/auth/register.js) | — |
| 登录 | [`functions/api/auth/login.js`](functions/api/auth/login.js:1) | — |
| 提交工单 | [`functions/api/orders/index.js`](functions/api/orders/index.js:29) | L29-196 |
| 价格计算 | [`functions/api/orders/index.js`](functions/api/orders/index.js:59) | L59-80 |
| 折扣计算 | [`functions/api/orders/index.js`](functions/api/orders/index.js:99) | L99-139 |
| 审核通过 | [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:34) | L34-82 |
| 拒绝退款 | [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:84) | L84-98 |
| 自动注册 | [`gh-actions/scan_orders.js`](gh-actions/scan_orders.js:66) | L66-175 |
| 上报账号 | [`functions/api/gh/report-account.js`](functions/api/gh/report-account.js) | — |
| 完成工单 | [`functions/api/gh/complete-order.js`](functions/api/gh/complete-order.js) | — |

### 2.2 旅程二：充值 → 获得修仙币 → 市场消费

```
用户浏览器                    Cloudflare Functions
    │                              │
    ├─① 充值申请 ───────────────▶ POST /api/recharge
    │   (套餐/现金/灵石)           │  验证套餐或金额
    │                              │  插入 recharge_orders (status=pending)
    │◀─ "等待审核" ──────────────┤
    │                              │
    ├─② 管理员审核 ─────────────▶ POST /api/admin/recharge
    │   action='approve'           │  ① bonus_points += coins
    │                              │  ② 自动生成 8 位兑换码
    │                              │  ③ 插入 recharge_codes
    │                              │  ④ 通知用户兑换码
    │◀─ 获得兑换码 ──────────────┤
    │                              │
    ├─③ 兑换码激活 ─────────────▶ POST /api/redeem
    │   (输入兑换码)               │  查 recharge_codes 表
    │                              │  bonus_points += rc.coins
    │                              │  记录 redeem_log
    │◀─ "获得 N 修仙币" ─────────┤
    │                              │
    ├─④ 市场购买 ───────────────▶ POST /api/market/purchase
    │   (选择商品)                 │  验证库存 + 余额
    │                              │  扣除 bonus_points
    │                              │  扣除 stock
    │                              │  发送通知
    │◀─ "购买成功" ──────────────┤
```

### 2.3 旅程三：邀请好友 → 获得分成 → 提现

```
用户 A (邀请人)
    │
    ├─① 生成邀请码 ────────────▶ 注册时自动生成唯一 invite_code
    │   分享给好友 B              │
    │                              │
用户 B (被邀请人)
    ├─② 注册时填写邀请码 ──────▶ POST /api/auth/register
    │                              │  invited_by = A.id
    │                              │
    ├─③ 提交工单 + 审核通过 ───▶ POST /api/orders/:id/status (approved)
    │                              │  查询 buyer.invited_by → A.id
    │                              │  计算佣金: bonus_points × rate%
    │                              │  A.invite_points += 佣金
    │                              │  通知 A: "邀请分成到账"
    │                              │
用户 A (邀请人)
    ├─④ 查看邀请积分 ──────────▶ GET /api/invite/info
    │   查看邀请倍率              │
    │                              │
    ├─⑤ 提现 ──────────────────▶ POST /api/invite/withdraw
    │   (≥10积分)                │  invite_points -= points
    │◀─ "请联系管理员处理" ─────┤  (线下转账)
```

**邀请倍率阶梯**（[`_xp.js`](functions/_xp.js:12)）：

| 累计购买量 | 倍率 | 佣金比例 |
|-----------|------|----------|
| 0-4,999 | 基础 1.0x | 30% |
| 5,000-19,999 | 青铜 1.2x | 36% |
| 20,000-49,999 | 白银 1.5x | 45% |
| 50,000-99,999 | 黄金 2.0x | 60% |
| 100,000+ | 至尊 3.0x | 90% |

---

## 3. 关键业务流程

### 3.0 角色创建与Setup流程（工单审核工作流优化 v10）

**设计背景**: 参考批量注册工具（`批量注册工具/batch.js`）的工作流，将角色创建集成到工单系统管理后台。
管理员在审核通过工单后，可直接在工单详情页创建游戏角色并配置灵根（灵根），
角色信息（角色名、灵根配置、操作人等）完整记录到 `game_accounts` 表并返回给系统。

**入口**:
- [`functions/api/admin/orders/[id]/create-account.js`](functions/api/admin/orders/[id]/create-account.js) `POST /api/admin/orders/:id/create-account`
- [`functions/api/admin/accounts/[id]/setup.js`](functions/api/admin/accounts/[id]/setup.js) `POST /api/admin/accounts/:id/setup`

```
管理员审批工单 → 进入工单详情页 → 创建角色流程:

  ┌──────────────────────────────────────────────────────────────┐
  │ ① 管理员在工单详情页点击「创建角色」                          │
  │    ├─ 输入游戏账号名 + 密码                                   │
  │    ├─ 输入角色名（游戏内显示名称）                             │
  │    └─ 选择灵根预设（单金灵根100/平均分配/自定义等）            │
  ├──────────────────────────────────────────────────────────────┤
  │ ② POST /api/admin/orders/:id/create-account                  │
  │    ├─ 验证输入（账号/密码/角色名/灵根值0-100/总和≤100）       │
  │    ├─ 插入 game_accounts 记录 (status=creating, setup_status=creating) │
  │    ├─ 写入操作人信息 (operator_id, operator_name)             │
  │    ├─ 更新 orders.total_accounts_created +1                   │
  │    └─ 记录操作日志 (account_created + 灵根详情)               │
  ├──────────────────────────────────────────────────────────────┤
  │ ③ 角色创建完成后（通过外部游戏API或管理员手动触发Setup）      │
  │    POST /api/admin/accounts/:id/setup                       │
  │    ├─ 可选 Setup 步骤: skills → iron_sword → technique → map → battle │
  │    ├─ 逐步骤更新 setup_status (skills/iron_sword/technique/map/battle) │
  │    └─ 完成后标记 setup_status=done, status=farming             │
  └──────────────────────────────────────────────────────────────┘

灵根预设（参考 batch.js 的 spiritRoots 配置）:
  ┌──────────────────────────────────────────────────┐
  │ 预设名称             │ 金  木  水  火  土       │
  ├──────────────────────┼───────────────────────────┤
  │ 单金灵根(100)        │ 100  0   0   0   0      │
  │ 平均分配(各20)        │ 20  20  20  20  20      │
  │ 金火(50+50)          │ 50   0   0  50   0      │
  │ 金木(50+50)          │ 50  50   0   0   0      │
  │ 全灵根(各10)         │ 10  10  10  10  10      │
  │ 自定义               │ 可手动调整各灵根值(总和≤100) │
  └──────────────────────────────────────────────────┘

影响的数据表:
  - game_accounts: character_name, spirit_roots(JSON), operator_id, operator_name,
                   created_result(JSON), setup_status, technique_id, equipped_skills, battle_auto_restart
  - orders: total_accounts_created

前端页面:
  - order-detail.js: 管理员角色创建弹窗（角色名输入 + 灵根选择器 + 实时总和校验）
  - admin-accounts.js: 显示角色名、灵根、Setup状态、操作人
  - account-detail.js: 显示完整灵根详情、创建结果JSON、Setup状态
```

### 3.1 工单创建与定价流程

### 3.1 工单创建与定价流程

**入口**: [`functions/api/orders/index.js`](functions/api/orders/index.js:29) `POST /api/orders`

```
输入: { invite_code, payment_method, points, coupon_code, order_type }

1. 验证积分数量 (≥10, 10的倍数)
   │
2. 验证支付方式 (coin | wechat | spirit_stone)
   │
3. 计算基础价格:
   ├─ wechat:   price = points / 120       (1元=120积分)
   ├─ spirit_stone: price = points/10 × spiritPer10 / 10000  (灵石→万灵石)
   └─ coin:     price = points             (1修仙币=1积分)
   │
4. 修仙币支付: 检查余额 → 冻结积分 (bonus_points -= points)
   │
5. 优惠码折扣:
   ├─ percent 类型: discount = coupon.discount_percent
   └─ fixed 类型:   减免固定金额
   │
6. 等级折扣 (取优惠码和等级中较大的折扣):
   ├─ Lv.1-2: 0%
   ├─ Lv.3: 10%  ├─ Lv.4: 20%  ├─ Lv.5: 30%
   ├─ Lv.6: 40%  ├─ Lv.7: 45%  ├─ Lv.8: 50%
   ├─ Lv.9: 60%  └─ Lv.10: 70%
   │
7. 计算账号数: accCount = max(1, ceil(bonusPoints / 10))
   │
8. 插入 orders 表 (status='pending')
   │
9. 发送通知 + 记录活动日志
```

### 3.2 订单状态审核流程

**入口**: [`functions/api/orders/[id]/status.js`](functions/api/orders/[id]/status.js:1) `POST /api/orders/:id/status`

```
管理员操作: { status: 'approved' | 'rejected' | 'completed', admin_notes }

approved (审核通过):
  ├─ 更新用户统计 (total_orders++, total_spent += bonus_points)
  │
  ├─ 判断是否为邀请套餐订单 (invite_code 以 'PKG:' 开头):
  │   ├─ 是: 套餐订单 → 直接发放 invite_points + total_purchased_points
  │   └─ 否: 普通工单 →
  │       ├─ 加 XP: max(10, floor(bonus_points × 0.1))
  │       └─ 邀请分成:
  │           ├─ 查询 buyer.invited_by → 找到邀请人
  │           ├─ 查询邀请人 total_purchased_points → 确定倍率
  │           ├─ commission = bonus_points × (rate / 100)
  │           └─ 邀请人 invite_points += commission
  │
  └─ 通知用户: "工单已通过"

rejected (拒绝):
  ├─ 修仙币支付: 退还冻结积分 (bonus_points += frozen_points)
  └─ 通知用户: "工单被拒绝"

completed (完成):
  └─ 通知用户: "工单已完成"
```

### 3.3 自动注册流程 (GitHub Actions)

**入口**: [`gh-actions/scan_orders.js`](gh-actions/scan_orders.js:66) `registerAndSetup()`

```
每 10 分钟触发 (order-scan.yml):
  │
  1. GET /api/gh/approved-orders (API Key 认证)
     → 获取 status='approved' 的工单列表
     │
  2. 遍历每个工单:
     ├─ 计算需要创建的账号数 (min(quantity, 10))
     │
     ├─ 对每个账号执行:
     │   ├─ 生成随机用户名/密码 (防检测模块)
     │   ├─ 随机延迟 1.5-3 秒
     │   ├─ POST 游戏服务器 /auth/register (邀请码+全金灵根)
     │   ├─ POST /api/gh/report-account (上报新账号)
     │   ├─ POST 游戏服务器 /auth/login
     │   ├─ 装备铁剑 (item_id=11)
     │   ├─ 学习技能 (skill_id=1,2: 重击+火球术)
     │   ├─ 装备功法 (technique_id=1: 吐纳法)
     │   ├─ 切换地图 (map_id=1: 荒石村)
     │   ├─ 开始自动刷怪
     │   ├─ POST /api/gh/report-account (status='farming')
     │   └─ smartPause (防封: 每3个暂停30秒)
     │
     └─ POST /api/gh/complete-order (标记工单完成)
```

### 3.4 自动升级流程 (GitHub Actions)

**入口**: [`gh-actions/health_check.js`](gh-actions/health_check.js:67) `checkAndLevelUp()`

```
每 30 分钟触发 (health-check.yml):
  │
  1. GET /api/gh/active-accounts
     → 获取 status='farming' 的账号列表
     │
  2. 遍历每个账号:
     ├─ 检查 stop_monitor_at (到达120级后2天停止)
     ├─ POST 游戏服务器 /auth/login
     ├─ 查询当前等级 (GET /player/info)
     │
     ├─ 如果 level < 120:
     │   ├─ 检查是否可以升级 (GET /player/can-levelup)
     │   ├─ 如果可以: POST /player/levelup
     │   ├─ 如果当前地图怪太弱: 切换到更高级地图
     │   └─ POST /api/gh/report-health (上报新等级)
     │
     ├─ 如果 level >= 120:
     │   └─ 设置 stop_monitor_at = now + 2天
     │
     └─ POST /api/gh/report-health (上报状态)
```

### 3.5 充值审核流程

**入口**: [`functions/api/admin/recharge.js`](functions/api/admin/recharge.js:37) `POST /api/admin/recharge`

```
管理员操作: { order_id, action: 'approve' | 'reject' }

approve:
  ├─ 1. bonus_points += order.coins
  ├─ 2. 生成 8 位唯一兑换码 (重试5次)
  │     chars: A-H, J-N, P-Z, 2-9 (排除易混淆字符)
  ├─ 3. 插入 recharge_codes 表
  └─ 4. 通知用户: "兑换码已生成: XXXXXXXX"

reject:
  └─ 更新 status='cancelled'

用户使用兑换码:
  POST /api/redeem { code }
  ├─ 先查 recharge_codes (修仙币兑换码)
  │   ├─ 每个用户只能用一次 (redeem_log 去重)
  │   └─ bonus_points += rc.coins
  └─ 再查 redeem_codes (经验值兑换码)
      ├─ 检查过期 + 使用次数
      └─ addXP(env, user_id, xp)
```

---

## 4. 状态流转图

### 4.1 工单状态机 (orders.status)

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌─────────┐   管理员审核通过    ┌──────────┐   GH Actions    ┌───────────┐
│ pending  │ ─────────────────▶│ approved │ ──────────────▶│ completed │
│ (待审核)  │                   │ (已通过)   │   注册+刷怪完成   │ (已完成)    │
└─────────┘                   └──────────┘                 └───────────┘
     │                              │
     │ 管理员拒绝                    │
     ▼                              │
┌──────────┐                        │
│ rejected │                        │
│ (已拒绝)  │  修仙币退款             │
└──────────┘                        │
                                    │
                                    ▼ (特殊状态)
                              ┌──────────┐
                              │ farming  │ (游戏账号正在刷怪)
                              └──────────┘
```

**状态转换规则**：

| 当前状态 | 目标状态 | 触发者 | 触发条件 |
|----------|----------|--------|----------|
| `pending` | `approved` | 管理员 | 审核通过工单 |
| `pending` | `rejected` | 管理员 | 拒绝工单（退还冻结积分） |
| `approved` | `completed` | GH Actions | 所有账号注册完成 |
| — | `farming` | GH Actions | 游戏账号状态上报 |

### 4.2 游戏账号状态机 (game_accounts.status)

```
┌───────────┐   注册成功    ┌───────────┐   开始刷怪    ┌───────────┐
│ creating  │ ───────────▶│  created  │ ───────────▶│  farming  │
│ (注册中)   │             │ (已创建)    │             │ (刷怪中)    │
└───────────┘             └───────────┘             └───────────┘
       │                                                  │
       │ 注册失败                                          │ 达到120级
       ▼                                                  ▼
┌───────────┐                                     ┌───────────┐
│  failed   │                                     │ completed │
│ (失败)     │                                     │ (已完成)    │
└───────────┘                                     └───────────┘
```

### 4.3 充值订单状态机 (recharge_orders.status)

```
┌───────────┐   管理员通过    ┌───────────┐
│ pending   │ ───────────▶│ completed │ → 生成兑换码
│ (待审核)   │              │ (已完成)   │
└───────────┘              └───────────┘
       │
       │ 管理员拒绝
       ▼
┌───────────┐
│ cancelled │
│ (已取消)   │
└───────────┘
```

### 4.4 申诉/售后状态机 (appeals.status / after_sales.status)

```
┌───────────┐   管理员回复    ┌───────────┐
│ pending   │ ───────────▶│ replied   │
│ (待处理)   │              │ (已回复)   │
└───────────┘              └───────────┘
```

---

## 5. 积分与经济体系

### 5.1 三种货币

| 货币 | 字段 | 获取方式 | 消耗方式 |
|------|------|----------|----------|
| **修仙币** | `users.bonus_points` | 充值、管理员发放、兑换码 | 市场购买、工单支付 |
| **邀请积分** | `users.invite_points` | 好友成交分成 | 提现（线下） |
| **经验值(XP)** | `users.xp` | 工单审核通过、兑换码 | 无（累计升级） |

### 5.2 经验值等级系统

**代码位置**: [`functions/_xp.js`](functions/_xp.js:1)

| 等级 | 所需 XP | 称号 | 工单折扣 |
|------|---------|------|----------|
| Lv.1 | 0 | 仙友 | 0% |
| Lv.2 | 0 | 仙长 | 0% |
| Lv.3 | 100 | 仙师 | 10% |
| Lv.4 | 300 | 宗师 | 20% |
| Lv.5 | 700 | 大宗师 | 30% |
| Lv.6 | 1,500 | 仙王 | 40% |
| Lv.7 | 3,100 | 尊者 | 45% |
| Lv.8 | 6,300 | 道主 | 50% |
| Lv.9 | 12,700 | 至尊 | 60% |
| Lv.10 | 25,500 | 仙尊 | 70% |

**XP 获取规则**:
- 工单审核通过: `max(10, floor(bonus_points × 0.1))`
- 兑换码: 固定值（由兑换码定义）
- 每次获取后自动调用 [`recalcUserLevel()`](functions/_xp.js:54) 重算等级

### 5.3 修仙币定价

| 支付方式 | 价格 | 代码位置 |
|----------|------|----------|
| 现金(微信) | 1元 = 120 积分 | [`orders/index.js`](functions/api/orders/index.js:65) |
| 灵石 | 100万灵石 = 10 积分 | [`orders/index.js`](functions/api/orders/index.js:69) |
| 修仙币 | 1修仙币 = 1积分 | [`orders/index.js`](functions/api/orders/index.js:78) |

### 5.4 充值套餐

**代码位置**: [`_xp.js`](functions/_xp.js:22)

| 套餐 | 价格 | 获得修仙币 |
|------|------|-----------|
| 初入仙途 | ¥5 | 2,500 |
| 小有所成 | ¥10 | 5,200 |
| 渐入佳境 | ¥15 | 8,000 |
| 炉火纯青 | ¥20 | 12,000 |
| 登堂入室 | ¥30 | 18,000 |
| 一代宗师 | ¥50 | 25,000 |
| 灵石入门 | 500万灵石 | 70 |
| 灵石小成 | 1,000万灵石 | 150 |
| 灵石大成 | 3,000万灵石 | 400 |
| 灵石巅峰 | 5,000万灵石 | 700 |
| 灵石至尊 | 1亿灵石 | 1,500 |

---

## 6. 数据流说明

### 6.1 工单创建：从前端到数据库的完整路径

```
[前端] 用户在 orders.js 页面填写表单
  │  调用 api.createOrder({ invite_code, payment_method, points, coupon_code })
  ▼
[ApiClient] api.js
  │  POST /api/orders  (Authorization: Bearer <token>)
  ▼
[中间件] _middleware.js
  │  ① CORS 预检处理
  │  ② 限流检查 (IP 级别, 60次/分钟)
  │  ③ 转发到路由处理器
  ▼
[认证] _auth.js → authenticate()
  │  ① 从 Authorization header 提取 token
  │  ② 查询 sessions 表验证 token
  │  ③ 查询 users 表获取用户信息
  │  ④ 检查 token 过期
  ▼
[路由] api/orders/index.js → onRequest()
  │  ① 解析请求体
  │  ② 输入验证 (积分数量、支付方式)
  │  ③ 价格计算 (基础价格 + 折扣)
  │  ④ 余额检查 (修仙币支付时)
  │  ┌─────────────────────────────┐
  │  │ env.DB.prepare(SQL)         │
  │  │   .bind(params)             │  ← D1 SQLite
  │  │   .run() / .first() / .all()│
  │  └─────────────────────────────┘
  │  ⑤ 插入 orders 表
  │  ⑥ 插入 notifications 表
  │  ⑦ 插入 order_activities 表
  ▼
[响应] json({ ok: true, order_id, price_info })
  │
  ▼
[前端] orders.js 页面
  │  显示 "工单已提交，等待审核"
  │  toast() 弹出成功提示
```

### 6.2 修仙币余额变化追踪

```
bonus_points 变化场景:

增加 (+):
  ├─ 充值审核通过          POST /api/admin/recharge     (+coins)
  ├─ 兑换码激活            POST /api/redeem              (+rc.coins)
  ├─ 管理员手动发放        POST /api/admin/points        (+points)
  └─ 工单拒绝退款          POST /api/orders/:id/status   (+frozen_points)

减少 (-):
  ├─ 提交工单 (修仙币支付)  POST /api/orders              (-points, 冻结)
  ├─ 市场购买              POST /api/market/purchase     (-cost)
  └─ 管理员手动扣除        POST /api/admin/points        (-points)

特殊: 工单拒绝时退还冻结的修仙币
```

### 6.3 invite_points 变化追踪

```
invite_points 变化场景:

增加 (+):
  └─ 好友工单审核通过      POST /api/orders/:id/status
      commission = bonus_points × (rate / 100)
      邀请人 invite_points += commission

减少 (-):
  └─ 邀请积分提现          POST /api/invite/withdraw
      invite_points -= points (≥10)
      → 线下转账处理
```

---

## 7. 安全与防刷机制

| 机制 | 实现 | 位置 |
|------|------|------|
| **密码安全** | PBKDF2 (100K 迭代) + 随机 Salt | [`_utils.js`](functions/_utils.js:51) |
| **时序攻击防护** | 恒定时间字符串比较 | [`_utils.js`](functions/_utils.js:41) |
| **会话管理** | 32字节随机 Token，7天过期 | [`_utils.js`](functions/_utils.js:125) |
| **IP 限流** | 内存 Map，60次/分钟 | [`_middleware.js`](functions/_middleware.js:36) |
| **防封号** | 独立IP、指纹轮换、随机延迟 | [`_anti_detect.js`](gh-actions/_anti_detect.js) |
| **智能暂停** | 每3个账号暂停30秒 | [`scan_orders.js`](gh-actions/scan_orders.js:209) |
| **API Key** | 恒定时间比较，仅 gh/* 路由 | [`_auth.js`](functions/_auth.js:26) |
| **输入验证** | 长度限制、枚举校验、必填检查 | 各路由处理器 |
| **密码格式** | 哈希不包含原始密码，盐值随机 | [`_utils.js`](functions/_utils.js:50) |

---

*文档生成时间：2026-07-22 | 基于项目源码深度分析*
