# 艾德尔修仙传 - OpenCloudOS 架设流程

适用于腾讯云轻量/OpenCloudOS 系统，使用项目自带的 `start_server.sh`、`stop_server.sh`、`restart_server.sh` 管理服务。

---

## 一、环境准备

### 1.1 安装 Node.js（OpenCloudOS 使用 yum/dnf）

```bash
# 安装 Node.js 18.x（腾讯云 OpenCloudOS 源）
yum install -y nodejs npm

# 若无 Node 18，可添加 NodeSource 源后安装
# curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
# yum install -y nodejs
```

验证：
```bash
node -v   # 应显示 v18.x 或以上
npm -v
```

### 1.2 安装 pm2（用于常驻进程）

```bash
npm install -g pm2
pm2 -v
```

---

## 二、部署项目

### 2.1 上传代码到服务器

项目目录建议：`/opt/game/` 或 `/home/youruser/idlexiuxianzhuan/`

使用 git / scp / FTP 等，确保目录结构为：

```
/opt/game/
├── server/
│   ├── index.js
│   ├── package.json
│   ├── start_server.sh
│   ├── stop_server.sh
│   ├── restart_server.sh
│   ├── health_check.sh
│   ├── config.js
│   └── ...
├── web-client/
└── ...
```

### 2.2 安装依赖

```bash
cd /opt/game/server
npm install --production
```

### 2.3 配置环境变量

```bash
cd /opt/game/server
cp .env.example .env
nano .env
```

填写（必填项）：

```
# 生成随机密钥：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=你生成的64位十六进制字符串
PUBLIC_IP=43.130.240.37
PORT=3000
```

可选：`CORS_ORIGIN`、`GM_TOOL_TOKEN` 等。

---

## 三、使用启停脚本

### 3.1 赋予脚本执行权限

```bash
cd /opt/game/server
chmod +x start_server.sh stop_server.sh restart_server.sh health_check.sh
```

### 3.2 启动服务

```bash
./start_server.sh
```

脚本会：
- 检查 `node_modules`，缺则自动 `npm install --production`
- 使用 pm2 启动/重启应用（默认名 `xianxia-server`）

### 3.3 停服

```bash
./stop_server.sh
```

### 3.4 重启

```bash
./restart_server.sh
```

### 3.5 健康检查

```bash
./health_check.sh
```

会输出 pm2 状态、本地 HTTP 检测、近期日志。

### 3.6 开机自启

首次启动后执行：

```bash
pm2 save
pm2 startup
```

按终端提示执行返回的那条 `sudo env PATH=...` 命令，完成开机自启配置。

### 3.7 推荐省流参数（不改变战斗节奏）

编辑 `.env`，确认以下参数：

```bash
cd /opt/game/server
nano .env
```

```env
BANDWIDTH_SAVER_MODE=1
WS_PERMSG_DEFLATE_ENABLED=1
WS_DEFLATE_LEVEL=4
WS_DEFLATE_THRESHOLD=1024
WS_DEFLATE_CONCURRENCY=6
WS_DEFLATE_WINDOW_BITS=12
```

保存后重启：

```bash
cd /opt/game/server
./restart_server.sh
```

---

## 四、Nginx 反向代理（用域名访问，免端口）

### 4.1 安装 Nginx

```bash
yum install -y nginx
```

### 4.2 创建站点配置

```bash
nano /etc/nginx/conf.d/idlexiuxianzhuan.conf
```

内容（HTTP，先跑通再上 HTTPS；包含 WebSocket 转发）：

```nginx
map $http_upgrade $connection_upgrade {
   default upgrade;
   '' close;
}

upstream game_backend {
   server 127.0.0.1:3000;
   keepalive 64;
}

server {
   listen 80;
   server_name idlexiuxianzhuan.cn www.idlexiuxianzhuan.cn;

   gzip on;
   gzip_min_length 1024;
   gzip_comp_level 4;
   gzip_types application/json application/javascript text/css text/plain;

   location /ws {
      proxy_pass http://game_backend;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 75s;
      proxy_send_timeout 75s;
      proxy_buffering off;
   }

   location / {
      proxy_pass http://game_backend;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
   }
}
```

### 4.3 启动 Nginx

```bash
systemctl start nginx
systemctl enable nginx
nginx -t && systemctl reload nginx
```

### 4.4 防火墙放行 80 端口

```bash
# 若使用 firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --reload
```

云控制台「安全组」需放行：**80**、**443**（若用 HTTPS）、**3000**（可选，直连测试用）。

### 4.5 验证 WebSocket 是否生效

如果 `/ws` 未正确升级，客户端会退回高频轮询，带宽会明显上升。

```bash
curl -i -N \
   -H "Connection: Upgrade" \
   -H "Upgrade: websocket" \
   -H "Sec-WebSocket-Version: 13" \
   -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
   "http://idlexiuxianzhuan.cn/ws?token=invalid-test-token"
```

预期：出现 `HTTP/1.1 400x` 或 `101`，但不应是 `404/502`。

### 4.6 验证省流参数是否生效

先重置 API 统计，再观察 5-10 分钟：

```bash
curl -s -X POST "http://127.0.0.1:3000/gm/api-stats/reset" -H "X-GM-Token: 你的GM_TOOL_TOKEN"
sleep 600
curl -s "http://127.0.0.1:3000/gm/server-stats" -H "X-GM-Token: 你的GM_TOOL_TOKEN"
curl -s "http://127.0.0.1:3000/gm/api-stats" -H "X-GM-Token: 你的GM_TOOL_TOKEN"
```

关注项：
- `runtime_flags` 是否与 `.env` 一致
- `/battle/poll`、`/dungeon-battle/advance`、`/trial/advance` 的 `count/avg_ms/total_ms`

---

## 五、HTTPS（Certbot + Let's Encrypt）

### 5.1 安装 certbot

```bash
# OpenCloudOS/CentOS 使用 snap 或 epel
yum install -y epel-release
yum install -y certbot python3-certbot-nginx
```

若 yum 无 certbot，可用 snap：
```bash
yum install -y snapd
systemctl enable snapd
snap install --classic certbot
ln -s /snap/bin/certbot /usr/bin/certbot
```

### 5.2 申请并自动配置 HTTPS

```bash
certbot --nginx -d idlexiuxianzhuan.cn -d www.idlexiuxianzhuan.cn
```

按提示输入邮箱、同意条款，certbot 会自动修改 Nginx 配置并申请证书。

### 5.3 自动续期

```bash
certbot renew --dry-run
```

certbot 会创建定时任务，到期前自动续期。

---

## 六、常用操作速查

| 操作     | 命令                                  |
|----------|---------------------------------------|
| 启动服务 | `cd /opt/game/server && ./start_server.sh` |
| 停服     | `cd /opt/game/server && ./stop_server.sh`  |
| 重启     | `cd /opt/game/server && ./restart_server.sh` |
| 健康检查 | `cd /opt/game/server && ./health_check.sh`  |
| 看日志   | `pm2 logs xianxia-server`             |
| 看状态   | `pm2 status`                          |

---

## 七、访问地址

- **HTTP**：`http://idlexiuxianzhuan.cn/web` 或 `http://www.idlexiuxianzhuan.cn/web`
- **HTTPS**（配置 certbot 后）：`https://idlexiuxianzhuan.cn/web`
- **直连 3000 端口**：`http://43.130.240.37:3000/web`（需安全组放行 3000）

---

## 八、故障排查

1. **脚本报 `pm2: command not found`**  
   - 安装 pm2：`npm install -g pm2`，或使用 pm2 的绝对路径（如 `~/.npm-global/bin/pm2`）。

2. **健康检查返回非 200**  
   - 确认服务已启动：`pm2 status`
   - 本地测试：`curl http://127.0.0.1:3000/health`

3. **域名无法访问**  
   - 确认 DNS 已解析到服务器 IP  
   - 确认 80/443 端口已放行（安全组 + 本机防火墙）

4. **JWT 相关报错**  
   - 检查 `.env` 中 `JWT_SECRET` 已填写且足够复杂
