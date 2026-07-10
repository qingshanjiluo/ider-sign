# 服务器上线前 Debug 清单

## 1. 环境与依赖

### 当前问题：`npm install` 失败

- **原因**：`better-sqlite3` 在 Windows 上需要本地编译，Node 24 + MSVC 对 C++20 要求导致编译失败
- **解决方案**：
  1. **推荐**：在 Linux 服务器部署（`better-sqlite3` 有预编译包，无需本地编译）
  2. 本地开发可尝试：使用 Node 20 LTS（`nvm install 20` 或从 nodejs.org 下载 LTS）
  3. 部署时：在目标 Linux 机器执行 `npm install` 后再启动

### 启动命令

```bash
cd server
npm install   # 首次或依赖变更后
node index.js
# 或
npm start
```

---

## 2. 代码静态审查结果

### 已核实逻辑

| 模块 | 状态 | 说明 |
|------|------|------|
| 战神榜 Rank | ✅ | 胜 +3 负 -3，db 读写正常 |
| 战神榜赛季结算 | ✅ | 7 天周期，`trySettleIfDue` 每 5 分钟执行，异常已 catch |
| 每日挑战限制 | ✅ | 5 次/天、同目标 3 次/天，`countCityDuelChallengesToday` 正确 |
| 化神大圆满限制 | ✅ | `levelUp` 和 `applyAutoLevelUps` 均对 Lv.280 做了阻挡 |
| 斗法 advance 结算 | ✅ | city_duel 模式正确更新 Rank、写 log、恢复血量调息 |
| db 表结构 | ✅ | `city_duel_challenges`、`duel_rank_state` 已建表 |

### 需注意点

1. **战神榜赛季时间**：`EPOCH_UTC8 = 1735660800` 对应 2025-01-01 00:00 UTC（即 08:00 北京时），期界为 UTC 00:00，非北京时间 0 点。如需按北京 0 点切期，需调整 EPOCH。
2. **无全局错误处理器**：某路由若抛出未捕获异常，请求可能无响应。建议上线后监控 502/超时，必要时加 `app.use((err, req, res, next) => {...})`。

---

## 3. 生产环境配置

上线前请确认环境变量（或 `config.js` 对应字段）：

| 变量 | 用途 | 当前默认 |
|------|------|----------|
| `JWT_SECRET` | 登录 token 签名 | `change-me-in-production-use-env` |
| `GM_TOOL_TOKEN` | GM 接口鉴权 | 硬编码默认值，**务必改为随机值** |
| `DB_PATH` | SQLite 路径 | `./data/game.db` |
| `PORT` | 监听端口 | 3000 |
| `CORS_ORIGIN` | 跨域白名单 | `*`（上线建议具体域名） |
| `PUBLIC_IP` | 客户端连接地址 | 已配置 |

---

## 4. 健康检查

- `GET /health` 返回 `{ ok: true, msg: 'ok' }`
- `GET /version` 返回版本与 pck 地址

---

## 5. 快速验证（部署成功后）

1. `curl http://服务器:3000/health`
2. 注册 / 登录
3. 进入城池 → 斗法 → 战神榜，确认榜单与结算倒计时
4. 发起一次斗法挑战，确认 Rank 变化
