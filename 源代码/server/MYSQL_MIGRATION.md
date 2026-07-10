# SQLite -> MySQL 迁移步骤（最小停服版）

本文用于把当前 SQLite 的 game.db 数据导入 MySQL。

## 0. 说明

- 当前服务端代码仍以 SQLite 为主。
- 本文先完成“数据迁移”和“可回滚切换准备”，后续可逐步切到 MySQL 读写。
- 为避免丢数据，最终导入必须在停服窗口内执行。

## 1. 先准备 MySQL

建议 MySQL 8.0+，字符集 utf8mb4。

```sql
CREATE DATABASE IF NOT EXISTS xianxia_game
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

## 2. 在 server/.env 配置 MySQL

新增以下变量：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=xianxia_game
```

## 3. 安装依赖

在 server 目录执行：

```bash
npm install
```

说明：本次已加入 mysql2 依赖和迁移脚本。

## 4. 一键脚本（推荐）

你当前实际目录是 /opt/game，可直接在 /opt/game/server 执行：

```bash
cd /opt/game/server
bash ./migrate_mysql_one_click.sh --yes
```

默认行为：

1. 读取 .env 里的 MySQL 配置
2. 自动备份 SQLite 到 data/backups/pre_mysql_migrate_时间.db
3. 自动停服（调用 stop_server.sh）
4. 导入 SQLite 到 MySQL
5. 打印关键表行数校验
6. 自动开服（调用 start_server.sh）

可选参数：

- --sqlite /path/to/game.db
- --batch 1000
- --no-drop（不删表重建）
- --no-stop（不自动停服）
- --no-start（不自动开服）

## 5. 先做不停服演练（强烈建议）

先用一份 game.db 副本演练导入：

```bash
npm run migrate:sqlite-to-mysql -- --sqlite ./data/game.db --drop --batch 500
```

参数说明：

- --sqlite: SQLite 文件路径
- --drop: 导入前删除同名表重建
- --batch: 每批插入行数，默认 500

## 6. 正式迁移（停服窗口）

1. 停服（禁止任何写入）
2. 确认进程已退出
3. 运行最终导入：

```bash
npm run migrate:sqlite-to-mysql -- --sqlite ./data/game.db --drop --batch 500
```

4. 校验行数（示例）

```sql
SELECT COUNT(*) FROM accounts;
SELECT COUNT(*) FROM players;
SELECT COUNT(*) FROM league_teams;
SELECT COUNT(*) FROM league_matches;
SELECT COUNT(*) FROM exchange_listings;
SELECT COUNT(*) FROM exchange_trades;
```

5. 通过后再开服

## 7. 常见问题

### 6.1 索引创建跳过

迁移脚本会跳过 SQLite 表达式索引（如 json_extract 表达式索引），并打印 skip 日志。
这些索引需要后续按 MySQL 方案重建（例如生成列 + 普通索引）。

### 6.2 导入慢

可尝试提高批量大小：

```bash
npm run migrate:sqlite-to-mysql -- --sqlite ./data/game.db --drop --batch 1000
```

### 6.3 回滚

如果导入后校验不通过：

- 保留原 SQLite game.db 不变
- 不切流量到 MySQL
- 修正后重新执行导入

### 6.4 报错 ECONNREFUSED 127.0.0.1:3306

这表示 MySQL 服务没有监听在本机 3306（不是防火墙问题）。

先执行（OpenCloudOS/CentOS）：

```bash
systemctl status mysqld || true
systemctl status mariadb || true
```

如果都没有安装：

```bash
dnf install -y mysql-server || dnf install -y mariadb-server
```

启动并设开机自启（按实际服务名二选一）：

```bash
systemctl enable --now mysqld || systemctl enable --now mariadb
```

确认端口监听：

```bash
ss -lntp | grep 3306
```

如果你已经运行过一键迁移且中途失败，先把游戏服拉起：

```bash
cd /opt/game/server
bash ./start_server.sh
```

MySQL 就绪后再重跑：

```bash
cd /opt/game/server
bash ./migrate_mysql_one_click.sh --yes
```

### 6.5 报错 BLOB/TEXT/GEOMETRY/JSON column ... can't have a default value

这表示当前 MySQL/MariaDB 版本不接受在大文本类列上显式 DEFAULT。

已在迁移脚本里兼容：

- 对 LONGTEXT/LONGBLOB/JSON/GEOMETRY 等列自动去掉 DEFAULT
- 对 SQLite 的 strftime('%s','now') 默认值改为兼容写法

如果你仍看到这个报错，说明服务器上脚本还是旧版本，请同步最新
scripts/migrate_sqlite_to_mysql.js 后重跑：

```bash
cd /opt/game/server
bash ./migrate_mysql_one_click.sh --yes
```

### 6.6 报错 Out of range value for column 'unit_price'

这表示 SQLite 中某些整数字段（常见是交易价格）已经超出 MySQL BIGINT 范围。
例如历史脏数据里出现过 `1e107` 这类异常售价。

已在迁移脚本里兼容：

- 主键和 *_id 字段保留 BIGINT
- 其他 INTEGER 字段使用 DECIMAL(65,0)
- 导入阶段会按列类型对超范围数值自动钳制到该列最大可表示范围

如果仍报同错，通常是服务器脚本还没更新，请同步最新
scripts/migrate_sqlite_to_mysql.js 后重跑：

```bash
cd /opt/game/server
bash ./migrate_mysql_one_click.sh --yes
```

### 6.7 报错 ER_NOT_SUPPORTED_AUTH_MODE（服务启动时报 mysql 认证协议不支持）

现象：迁移能成功，但服务启动时在 sync-mysql 处报错：

- ER_NOT_SUPPORTED_AUTH_MODE

原因：MySQL 账号使用了新认证协议（如 caching_sha2_password），而运行时驱动 sync-mysql 不兼容。

修复（推荐，最快）：把业务账号改为 mysql_native_password。

```bash
mysql -uroot <<'SQL'
ALTER USER 'andycome'@'localhost' IDENTIFIED WITH mysql_native_password BY 'qingdeg666111rag';
ALTER USER 'andycome'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY 'qingdeg666111rag';
FLUSH PRIVILEGES;
SQL
```

验证账号认证插件：

```bash
mysql -uroot -e "SELECT user,host,plugin FROM mysql.user WHERE user='andycome';"
```

然后重启服务：

```bash
cd /opt/game/server
bash ./restart_server.sh
```

若 ALTER USER 提示 mysql_native_password 不可用，请在 MySQL 服务侧启用该插件后重试。

## 8. 导入后切到 MySQL 运行时

在 server/.env 设置：

```env
DB_DRIVER=mysql
MYSQL_RUNTIME_ENABLE=1
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=你的账号
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=xianxia_game
MYSQL_SYNC_FAST_MODE=1
MYSQL_ASYNC_CONN_LIMIT=20
```

说明：

- 建议 MySQL 切换初期先开启 `MYSQL_SYNC_FAST_MODE=1`，`/player/sync` 走轻量路径，优先保证可用性。
- 稳定后可改为 `MYSQL_SYNC_FAST_MODE=0` 恢复完整同步结算逻辑。
- 启动/重启脚本有运行守门：只有 `MYSQL_RUNTIME_ENABLE=1` 时，`DB_DRIVER=mysql` 才会生效；否则自动回落到 sqlite，防止误切导致 502/504。

然后重启服务：

```bash
bash ./restart_server.sh
```

可选：执行异步 MySQL 连接池自检（为后续异步改造做准备）

```bash
npm run mysql:async-smoke
```

可选：在 `gameLoop` 自动战斗扫描中启用异步池回退（MySQL 模式下）

```env
MYSQL_ASYNC_AUTO_INTENT_ENABLED=1
AUTO_BATTLE_REDIS_INDEX_ENABLED=1
```

## 9. 切流门禁（建议先跑）

在真正把运行时流量切到 MySQL 前，先执行：

```bash
npm run mysql:cutover-gate
```

脚本会检查：

1. MySQL 连通性（ping）
2. 关键表行数差异（accounts/players）
3. 玩家样本数据一致性（SQLite vs MySQL）
4. MySQL 读取延迟（p50/p95）

默认门槛可通过 `.env` 调整：

```env
MYSQL_CUTOVER_SAMPLE_SIZE=200
MYSQL_CUTOVER_LATENCY_CHECKS=25
MYSQL_CUTOVER_MAX_P95_MS=40
MYSQL_CUTOVER_MAX_COUNT_DIFF=0
MYSQL_CUTOVER_MAX_MISMATCH_RATE=0
MYSQL_CUTOVER_ALLOW_NO_SQLITE=0
```

只有门禁输出 `decision=READY` 时，才建议进入小流量灰度切库。

如果当前机器缺少 `better-sqlite3` 本地绑定又想先做 MySQL 单侧健康检查，可临时设为：

```env
MYSQL_CUTOVER_ALLOW_NO_SQLITE=1
```

如果需要回滚到 SQLite，只要把 DB_DRIVER 改回 sqlite 并重启。

## 10. SQLite 主模式下的 MySQL 影子探针（推荐先做）

当 MySQL 直接切流不稳定时，建议先保持 SQLite 主读写，仅做 MySQL 影子探针：

```env
DB_DRIVER=sqlite
MYSQL_RUNTIME_ENABLE=0
MYSQL_ASYNC_ALLOW_WITH_SQLITE=1
MYSQL_CANARY_SHADOW_ENABLED=1
MYSQL_CANARY_PERCENT=5
MYSQL_CANARY_TIMEOUT_MS=120
MYSQL_CANARY_SUMMARY_INTERVAL_SEC=60
MYSQL_CANARY_MAX_INFLIGHT=80
```

说明：

- 影子探针只在 `/player/sync` 的请求后后台执行 MySQL 探测查询，不影响主响应。
- 服务日志会按窗口输出聚合统计（ok/timeout/err/p95/p99），用于判断 MySQL 在真实流量下是否可用。
- 建议按 1% -> 5% -> 10% 逐步提高 `MYSQL_CANARY_PERCENT`，每档观察 10-30 分钟。
