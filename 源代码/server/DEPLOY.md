# 部署说明

> **OpenCloudOS / CentOS 用户**：详见 [DEPLOY_OPENCLOUDOS.md](./DEPLOY_OPENCLOUDOS.md)，含 Nginx 反向代理、Certbot HTTPS、启停脚本完整流程。

## 一、数据库怎么搞

**当前方案**：SQLite 和游戏服务放**同一台机子**。

- 数据文件：`server/data/game.db`（首次启动自动创建）
- 原因：你双核 4G 足够，单机部署简单
- 迁移：以后人多了，可单独买云数据库（MySQL/RDS），改 `db.js` 连接即可，数据用导出导入迁移

## 二、服务器公网 IP

**43.130.240.37**

客户端连接地址：`http://43.130.240.37:3000`

## 三、本地先跑通

```bash
cd server
npm install
npm start
```

浏览器打开 `http://localhost:3000/health` 应返回 `{"ok":true,"msg":"ok"}`。

## 四、上云（Linux）

### 1. 把项目拷到服务器

例如用 git、scp、FTP 等。

### 2. 装 Node.js（Ubuntu 示例）

```bash
sudo apt update
sudo apt install -y nodejs npm
```

### 3. 启动

```bash
cd server
npm install
npm start
```

### 4. 安全组放行 3000 端口

在云控制台找到「安全组」→ 添加入站规则：端口 3000，协议 TCP。

### 5. 用 pm2 常驻（推荐）

```bash
npm install -g pm2
cd server
pm2 start index.js --name aider
pm2 save
pm2 startup   # 按提示执行，开机自启
```

### 6. 改 JWT 密钥（重要）

上线前务必改默认密钥：

```bash
# 生成随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 启动时传入
export JWT_SECRET=你生成的64位hex
npm start
```

或在服务器上新建 `server/.env`（需自行安装 dotenv，或直接 `export` 后启动）。

## 五、客户端怎么接

Godot 客户端需要改成：

1. 登录/注册 → 调用 `/auth/login`、`/auth/register`，拿到 token
2. 进游戏 → 调 `/player/sync` 拉存档，没有则 `/player/create` 建角色
3. 战斗 → 先 `/battle/start` 拿敌人和 battleId，打完调 `/battle/result` 交结果
4. 定期保存 → 调 `/player/save` 上传当前 player 数据

请求头需带：`Authorization: Bearer <token>`

## 六、跨境场景省流与延迟优化（不改变战斗节奏）

1. 反向代理必须支持 WebSocket `/ws` 升级，否则会退回高频轮询。
2. 启用服务端省流参数：`BANDWIDTH_SAVER_MODE=1` 与 `WS_PERMSG_DEFLATE_ENABLED=1`。
3. 使用 GM 诊断接口核对是否生效：

```bash
curl -s "http://127.0.0.1:3000/gm/server-stats" -H "X-GM-Token: 你的GM_TOOL_TOKEN"
curl -s "http://127.0.0.1:3000/gm/api-stats" -H "X-GM-Token: 你的GM_TOOL_TOKEN"
```

详细 Nginx 配置与验证命令见 [DEPLOY_OPENCLOUDOS.md](./DEPLOY_OPENCLOUDOS.md) 的第四章。

---

**总结**：数据库和游戏服务先放一起，本地 `npm install && npm start` 跑通，上云后放行 3000 端口、改 JWT 密钥即可。
