# 艾德尔修仙传 — 自动化工具集

基于 ESP32-S3 (ESP-IDF) 后端 + Web 前端的修仙游戏项目，附带完整批量自动化工具链。

## 目录结构

```
艾德尔机器人/
├── 源代码/                    # 游戏服务端源码（ESP-IDF + C/JS）
│   └── server/               # Express 游戏服务器
│       ├── routes/           # API 路由（auth, player, alliance, cave...）
│       ├── game/             # 游戏逻辑（战斗/洞府/炼丹/装备...）
│       └── data/             # 游戏数据（items/skills/maps...）
├── 批量注册工具/               # # 批量自动化工具（Node.js）
│   ├── batch.js              # 批量注册
│   ├── batch_email_bind.js   # 邮箱绑定（交互式）
│   ├── batch_email_bind_ci.js# 邮箱绑定（CI/命令行）
│   ├── batch_alliance_daily.js# 仙盟日常 + 洞府采集
│   ├── auto_farm.js          # 自动刷怪
│   ├── auto_alchemy.js       # 自动炼丹
│   ├── _anti_detect_shared.js# 反检测核心模块
│   └── README.md             # 工具集说明
├── .github/workflows/        # GitHub Actions 自动化工作流
│   ├── email-bind.yml        # 邮箱绑定
│   ├── alliance-daily.yml    # 仙盟日常
│   ├── auto-farm.yml         # 自动刷怪
│   ├── auto-alchemy.yml      # 自动炼丹
│   ├── batch-register.yml    # 批量注册
│   └── ...
└── README.md                 # 本文件
```

## GitHub Actions 使用

### 邮箱绑定
仓库 → Actions → **📧 一键邮箱绑定** → Run workflow

提供账号方式：
- 文本框填入：`user1,pass1;user2,pass2`
- 或预先提交 `accounts_email.txt` 到仓库
- 或设置 Secrets: `ACCOUNTS_DATA`

### 仙盟日常
仓库 → Actions → **🏯 仙盟日常 + 洞府采集** → Run workflow

自动执行：沐浴 → 采摘 → 悟道 → 开启洞府采集
未加入仙盟时自动申请「天地一家大爱盟」。

### 防封号
所有工具内置独立IP伪造、浏览器指纹轮换、随机延迟、智能分段暂停。

## 本地运行

```bash
cd 批量注册工具
npm install
node batch_alliance_daily.js        # 交互模式
CI=true node batch_email_bind_ci.js  # CI模式
```

## 技术栈

- **后端**: Node.js + Express + MySQL
- **自动化**: Node.js + GitHub Actions
- **反检测**: IP伪造 / 指纹轮换 / 随机延迟
- **临时邮箱**: Mail.tm / Tempy.email API
