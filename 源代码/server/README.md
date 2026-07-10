# 艾德尔修仙传 - 网游化服务端

## 目录结构

```
server/
├── index.js          # 入口
├── config.js         # 配置（端口、数据库路径、JWT 密钥）
├── db.js             # 数据库（SQLite）
├── package.json
├── game/             # 游戏逻辑
│   ├── exp.js        # 经验表
│   ├── dataLoader.js # 加载 items/enemies/maps
│   └── initialPlayer.js
├── middleware/
│   └── auth.js       # JWT 鉴权
├── routes/
│   ├── auth.js       # 注册、登录
│   ├── player.js     # 玩家同步、创建角色、保存
│   └── battle.js     # 战斗开始、战斗结算
└── data/             # 运行时生成，放 SQLite 文件
```

## 数据库

- **当前**：SQLite，文件 `data/game.db`，与游戏服务同机
- **迁移**：后续可迁 MySQL/PostgreSQL，只需改 `db.js` 的驱动和 SQL 语法

## 本地开发

```bash
cd server
npm install
npm run dev
```

## 上云部署（43.130.240.37）

### 1. 上传代码

把整个项目（含 `server` 文件夹）上传到服务器，或使用 git 拉取。

### 2. 安装 Node.js

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nodejs npm

# 或使用 nvm 安装 LTS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 3. 安装依赖并启动

```bash
cd server
npm install
npm start
```

### 4. 放行端口

云控制台安全组放行 **3000** 端口（TCP 入站）。

### 5. 守护进程（推荐 pm2）

```bash
npm install -g pm2
cd server
pm2 start index.js --name aider-server
pm2 save
pm2 startup   # 开机自启
```

### 6. 环境变量（可选）

```bash
export PORT=3000
export JWT_SECRET=你的随机密钥
export DB_PATH=./data/game.db
export PUBLIC_IP=43.130.240.37
```

生成随机密钥：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API 地址

- 本地：`http://localhost:3000`
- 公网：`http://43.130.240.37:3000`

## 接口列表

| 接口 | 方法 | 说明 |
|------|------|------|
| `/auth/register` | POST | 注册 `{username, password}` |
| `/auth/login` | POST | 登录 `{username, password}` |
| `/player/sync` | GET | 拉取玩家数据（需 Authorization: Bearer &lt;token&gt;） |
| `/player/create` | POST | 创建角色 `{spirit_roots, name}` |
| `/player/save` | POST | 保存存档 `{slot, player}` |
| `/battle/start` | POST | 开始/恢复战斗 `{mapId, enemyId?}` |
| `/battle/command` | POST | 战斗指令 `{battleId, seq, action, skillId?, itemId?}` |
| `/battle/state/:battleId` | GET | 断线重连拉取状态与事件 `?after=` |
| `/battle/result` | POST | 已下线（返回 426，需使用新协议） |
| `/health` | GET | 健康检查 |

## 后续迁移数据库

若要改用 MySQL：

1. 安装 `mysql2`：`npm install mysql2`
2. 修改 `db.js`：用 `mysql2` 替换 `better-sqlite3`，建表 SQL 改为 MySQL 语法
3. 配置连接串：`DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
4. 数据导出：SQLite 用 `sqlite3 data/game.db .dump` 导出，再按表导入 MySQL
