#!/usr/bin/env bash
set -euo pipefail

# ================================================================
# 安全 MySQL 切换（维护模式版）
#
# 流程：
#   1. 通过 GM API 进入维护模式 → 自动踢掉所有玩家 + 停游戏循环 + 刷盘
#   2. 等待确认所有连接已断开
#   3. 修改 .env 切换 DB_DRIVER=mysql + MYSQL_RUNTIME_ENABLE=1
#   4. 重启进程（pm2 / systemd）
#   5. 健康检查确认 MySQL 正常运行
#   6. 通过 GM API 退出维护模式
#   7. 如果失败 → 自动回滚到 SQLite 并重启
#
# 用法:
#   bash ./switch_mysql_maintenance.sh
#
# 必须设置的环境变量（或写在 .env 中）:
#   GM_TOOL_TOKEN - GM 鉴权令牌
#
# 可选环境变量:
#   BASE_URL        默认 http://127.0.0.1:3000
#   ENV_FILE        默认 ./server/.env
#   APP_NAME        PM2 应用名 (默认 xianxia-server)
#   DRAIN_WAIT_SEC  维护模式等待秒数 (默认 8)
#   HEALTH_ROUNDS   重启后健康检查轮数 (默认 15)
#   HEALTH_INTERVAL 每轮间隔秒数 (默认 2)
# ================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
APP_NAME="${APP_NAME:-xianxia-server}"
DRAIN_WAIT_SEC="${DRAIN_WAIT_SEC:-8}"
HEALTH_ROUNDS="${HEALTH_ROUNDS:-15}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"

# 从 .env 读 GM_TOOL_TOKEN（如果没设置环境变量的话）
if [ -z "${GM_TOOL_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  GM_TOOL_TOKEN="$(grep -E '^GM_TOOL_TOKEN=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d "'\"")"
fi
GM_TOOL_TOKEN="${GM_TOOL_TOKEN:-}"

if [ -z "$GM_TOOL_TOKEN" ]; then
  echo "[ERROR] GM_TOOL_TOKEN 未设置，无法操作 GM API" >&2
  exit 1
fi

BACKUP_FILE=""
SWITCH_DONE="0"

log() { echo "[switch_mysql_maint] $(date '+%H:%M:%S') $*"; }

gm_get() {
  curl -sf -H "X-GM-Token: $GM_TOOL_TOKEN" "${BASE_URL}/gm$1" 2>/dev/null || echo '{"ok":false}'
}

gm_post() {
  local path="$1"; shift
  curl -sf -X POST -H "Content-Type: application/json" -H "X-GM-Token: $GM_TOOL_TOKEN" \
    -d "$*" "${BASE_URL}/gm${path}" 2>/dev/null || echo '{"ok":false}'
}

health_ok() {
  local r
  r="$(curl -sf --max-time 15 "${BASE_URL}/health" 2>/dev/null || echo '')"
  echo "$r" | grep -q '"ok":true'
}

rollback_to_sqlite() {
  log "!!! 回滚到 SQLite !!!"
  if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    cp "$BACKUP_FILE" "$ENV_FILE"
    log "已恢复 .env 备份: $BACKUP_FILE"
  else
    # 强制写回 sqlite
    sed -i 's/^DB_DRIVER=.*/DB_DRIVER=sqlite/' "$ENV_FILE"
    sed -i 's/^MYSQL_RUNTIME_ENABLE=.*/MYSQL_RUNTIME_ENABLE=0/' "$ENV_FILE"
  fi
  log "重启进程（SQLite 模式）..."
  pm2 delete "$APP_NAME" 2>/dev/null || true
  sleep 1
  bash "$SCRIPT_DIR/start_server.sh" || true
  sleep 3
  if health_ok; then
    log "SQLite 回滚成功，服务已恢复"
  else
    log "!!! 回滚后健康检查仍失败，请手动检查 !!!"
  fi
}

cleanup() {
  if [ "$SWITCH_DONE" != "1" ]; then
    log "脚本中断，执行回滚..."
    rollback_to_sqlite
  fi
}
trap cleanup EXIT

# ================================================================
# Step 0: 前置检查
# ================================================================
log "=== 安全 MySQL 切换开始 ==="

if ! [ -f "$ENV_FILE" ]; then
  log "ERROR: .env 文件不存在: $ENV_FILE"
  exit 1
fi

# 检查服务是否在线（最多重试 3 次，每次间隔 5 秒）
INIT_HEALTH_OK=0
for i in 1 2 3; do
  if health_ok; then
    INIT_HEALTH_OK=1
    break
  fi
  log "健康检查第 $i 次未响应，${i}/3 等待 5 秒后重试..."
  sleep 5
done
if [ "$INIT_HEALTH_OK" != "1" ]; then
  log "ERROR: 服务未响应 $BASE_URL/health，请先确认服务正常运行"
  SWITCH_DONE=1  # 跳过 trap 回滚，因为还没改任何东西
  exit 1
fi

log "服务在线，当前状态："
gm_get "/maintenance/status" | python3 -m json.tool 2>/dev/null || gm_get "/maintenance/status"

# ================================================================
# Step 1: 进入维护模式
# ================================================================
log "--- Step 1: 进入维护模式 (drain_wait_sec=$DRAIN_WAIT_SEC) ---"
MAINT_RESULT="$(gm_post "/maintenance/enter" "{\"reason\":\"数据库迁移维护，预计 5 分钟\",\"drain_wait_sec\":$DRAIN_WAIT_SEC}")"
log "维护模式结果: $MAINT_RESULT"

if ! echo "$MAINT_RESULT" | grep -q '"ok":true'; then
  log "ERROR: 进入维护模式失败"
  exit 1
fi

# ================================================================
# Step 2: 确认所有连接已断开
# ================================================================
log "--- Step 2: 确认连接已断开 ---"
for i in $(seq 1 10); do
  STATUS="$(gm_get "/maintenance/status")"
  ONLINE="$(echo "$STATUS" | grep -o '"online":[0-9]*' | cut -d: -f2)"
  log "  在线连接数: ${ONLINE:-?}"
  if [ "${ONLINE:-1}" = "0" ]; then
    log "  所有连接已断开"
    break
  fi
  sleep 2
done

# ================================================================
# Step 3: 备份 .env 并切换到 MySQL
# ================================================================
log "--- Step 3: 修改 .env 切换到 MySQL ---"
BACKUP_FILE="${ENV_FILE}.sqlite_stable_$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"
log "已备份 .env -> $BACKUP_FILE"

# 修改 .env
if grep -q '^DB_DRIVER=' "$ENV_FILE"; then
  sed -i 's/^DB_DRIVER=.*/DB_DRIVER=mysql/' "$ENV_FILE"
else
  echo 'DB_DRIVER=mysql' >> "$ENV_FILE"
fi

if grep -q '^MYSQL_RUNTIME_ENABLE=' "$ENV_FILE"; then
  sed -i 's/^MYSQL_RUNTIME_ENABLE=.*/MYSQL_RUNTIME_ENABLE=1/' "$ENV_FILE"
else
  echo 'MYSQL_RUNTIME_ENABLE=1' >> "$ENV_FILE"
fi

log ".env 已修改: DB_DRIVER=mysql, MYSQL_RUNTIME_ENABLE=1"

# ================================================================
# Step 4: 重启进程
# ================================================================
log "--- Step 4: 重启进程（清除 PM2 环境缓存）---"
# pm2 restart --update-env 不会刷新 .env 文件的变量
# 必须 delete + start 才能让 dotenv 读到新的 DB_DRIVER
pm2 delete "$APP_NAME" 2>/dev/null || true
sleep 1
bash "$SCRIPT_DIR/start_server.sh" || {
  log "ERROR: 无法重启进程"
  exit 1
}

log "等待进程启动（最多 30 秒）..."
sleep 10
# 等服务器完全就绪
for w in $(seq 1 4); do
  if health_ok; then break; fi
  log "  启动中... ($w/4)"
  sleep 5
done

# ================================================================
# Step 5: 健康检查
# ================================================================
log "--- Step 5: 健康检查 ($HEALTH_ROUNDS 轮, 间隔 ${HEALTH_INTERVAL}s) ---"
FAIL_COUNT=0
for i in $(seq 1 "$HEALTH_ROUNDS"); do
  if health_ok; then
    log "  [$i/$HEALTH_ROUNDS] OK"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    log "  [$i/$HEALTH_ROUNDS] FAIL (累计失败: $FAIL_COUNT)"
  fi
  sleep "$HEALTH_INTERVAL"
done

if [ "$FAIL_COUNT" -gt 3 ]; then
  log "ERROR: 健康检查失败 $FAIL_COUNT 次，自动回滚"
  exit 1
fi

log "MySQL 模式健康检查通过 (失败 $FAIL_COUNT/$HEALTH_ROUNDS)"

# ================================================================
# Step 6: 退出维护模式
# ================================================================
log "--- Step 6: 退出维护模式 ---"
LEAVE_RESULT="$(gm_post "/maintenance/leave" "{}")"
log "退出维护结果: $LEAVE_RESULT"

if ! echo "$LEAVE_RESULT" | grep -q '"ok":true'; then
  log "WARNING: 退出维护模式失败，请手动调用 POST /gm/maintenance/leave"
fi

SWITCH_DONE="1"
log "=== MySQL 切换完成！==="
log "最终状态："
gm_get "/maintenance/status" | python3 -m json.tool 2>/dev/null || gm_get "/maintenance/status"
