#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-xianxia-server}"
ENTRY_FILE="${ENTRY_FILE:-index.js}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"
export PORT="${PORT:-3000}"
# 加载 .env 到当前 shell，使 pm2 子进程继承
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# 运行守门：防止误切 mysql 导致主线程阻塞引发 502/504。
# 仅当 MYSQL_RUNTIME_ENABLE=1 时，才允许 DB_DRIVER=mysql 生效。
if [ "${DB_DRIVER:-sqlite}" = "mysql" ] && [ "${MYSQL_RUNTIME_ENABLE:-0}" != "1" ]; then
  echo "[restart_server] guard: DB_DRIVER=mysql blocked (MYSQL_RUNTIME_ENABLE!=1), fallback to sqlite"
  export DB_DRIVER=sqlite
fi

if [ ! -f package.json ]; then
  echo "[restart_server] package.json not found in $SCRIPT_DIR"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[restart_server] node_modules missing, installing production dependencies..."
  npm install --production
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start "$ENTRY_FILE" --name "$APP_NAME"
fi

pm2 save
pm2 status "$APP_NAME"
echo "[restart_server] done"
