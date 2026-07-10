#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="${APP_NAME:-xianxia-server}"
SQLITE_PATH="${SQLITE_PATH:-$SCRIPT_DIR/data/game.db}"
BATCH_SIZE="${BATCH_SIZE:-500}"
DROP_TABLES="${DROP_TABLES:-1}"
AUTO_STOP="${AUTO_STOP:-1}"
AUTO_START="${AUTO_START:-1}"
ASSUME_YES="${ASSUME_YES:-0}"
STOPPED_SERVER=0

on_exit() {
  local code=$?
  if [[ "$code" -ne 0 ]]; then
    echo "[migrate_one_click] failed with code: $code"
    if [[ "$AUTO_START" == "1" && "$STOPPED_SERVER" == "1" && -f "$SCRIPT_DIR/start_server.sh" ]]; then
      echo "[migrate_one_click] migration failed, trying to bring server back..."
      bash "$SCRIPT_DIR/start_server.sh" || true
    fi
  fi
}
trap on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sqlite)
      SQLITE_PATH="$2"
      shift 2
      ;;
    --batch)
      BATCH_SIZE="$2"
      shift 2
      ;;
    --no-drop)
      DROP_TABLES=0
      shift
      ;;
    --no-stop)
      AUTO_STOP=0
      shift
      ;;
    --no-start)
      AUTO_START=0
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    *)
      echo "[migrate_one_click] unknown arg: $1"
      exit 1
      ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

need_env() {
  local key="$1"
  local val="${!key:-}"
  if [[ -z "$val" ]]; then
    echo "[migrate_one_click] missing env: $key"
    exit 1
  fi
}

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[migrate_one_click] command not found: $cmd"
    exit 1
  fi
}

need_cmd node

need_env MYSQL_HOST
need_env MYSQL_USER
need_env MYSQL_PASSWORD
need_env MYSQL_DATABASE
MYSQL_PORT="${MYSQL_PORT:-3306}"

mysql_precheck() {
  node <<'NODE'
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  const [rows] = await conn.query('SELECT 1 AS ok');
  console.log('[migrate_one_click] mysql precheck ok:', Number(rows?.[0]?.ok || 0));
  await conn.end();
})().catch((e) => {
  console.error('[migrate_one_click] mysql precheck failed:', e?.message || e);
  process.exit(1);
});
NODE
}

runtime_driver_precheck() {
  node <<'NODE'
let SyncMysql;
try {
  SyncMysql = require('sync-mysql');
} catch (e) {
  console.error('[migrate_one_click] runtime driver precheck failed: sync-mysql not installed');
  process.exit(1);
}

let conn = null;
try {
  conn = new SyncMysql({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    charset: 'utf8mb4'
  });
  const rows = conn.query('SELECT 1 AS ok');
  const ok = Number(Array.isArray(rows) && rows[0] ? rows[0].ok : 0);
  console.log('[migrate_one_click] runtime driver precheck ok:', ok);
  if (typeof conn.dispose === 'function') conn.dispose();
} catch (e) {
  const code = String(e?.code || '');
  const msg = String(e?.message || e || 'unknown');
  console.error('[migrate_one_click] runtime driver precheck failed:', code, msg);
  if (code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
    console.error('[migrate_one_click] hint: current mysql user auth plugin is not compatible with sync-mysql; switch user plugin to mysql_native_password.');
  }
  try {
    if (conn && typeof conn.dispose === 'function') conn.dispose();
  } catch (_) {}
  process.exit(1);
}
NODE
}

if [[ ! -f "$SQLITE_PATH" ]]; then
  echo "[migrate_one_click] sqlite file not found: $SQLITE_PATH"
  exit 1
fi

BATCH_SIZE_NUM="$(echo "$BATCH_SIZE" | tr -d '[:space:]')"
if ! [[ "$BATCH_SIZE_NUM" =~ ^[0-9]+$ ]] || [[ "$BATCH_SIZE_NUM" -le 0 ]]; then
  echo "[migrate_one_click] invalid --batch: $BATCH_SIZE"
  exit 1
fi

echo "[migrate_one_click] server dir  : $SCRIPT_DIR"
echo "[migrate_one_click] sqlite file : $SQLITE_PATH"
echo "[migrate_one_click] mysql host  : ${MYSQL_HOST}:${MYSQL_PORT}"
echo "[migrate_one_click] mysql db    : ${MYSQL_DATABASE}"
echo "[migrate_one_click] drop tables : $DROP_TABLES"
echo "[migrate_one_click] batch size  : $BATCH_SIZE_NUM"

if [[ "$ASSUME_YES" != "1" ]]; then
  echo ""
  echo "将执行: 停服(可选) -> 备份 game.db -> 导入 MySQL -> 校验 -> 开服(可选)"
  read -r -p "继续请键入 YES: " CONFIRM
  if [[ "$CONFIRM" != "YES" ]]; then
    echo "[migrate_one_click] cancelled"
    exit 1
  fi
fi

echo "[migrate_one_click] prechecking mysql connection..."
mysql_precheck

SERVER_WAS_ONLINE=0
if command -v pm2 >/dev/null 2>&1; then
  SERVER_PID="$(pm2 pid "$APP_NAME" 2>/dev/null | tail -n 1 | tr -d '\r' | tr -d ' ' || true)"
  if [[ "$SERVER_PID" =~ ^[0-9]+$ ]] && [[ "$SERVER_PID" -gt 0 ]]; then
    SERVER_WAS_ONLINE=1
  fi
fi

BACKUP_DIR="$SCRIPT_DIR/data/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/pre_mysql_migrate_${STAMP}.db"

if [[ "$AUTO_STOP" == "1" ]]; then
  if [[ "$SERVER_WAS_ONLINE" == "1" && -f "$SCRIPT_DIR/stop_server.sh" ]]; then
    echo "[migrate_one_click] stopping server..."
    bash "$SCRIPT_DIR/stop_server.sh" || true
    STOPPED_SERVER=1
  elif [[ "$SERVER_WAS_ONLINE" != "1" ]]; then
    echo "[migrate_one_click] server is not online, skip stop"
  else
    echo "[migrate_one_click] stop_server.sh not found, skip stop"
  fi
fi

cp "$SQLITE_PATH" "$BACKUP_FILE"
echo "[migrate_one_click] sqlite backup: $BACKUP_FILE"

MIGRATE_ARGS=(--sqlite "$SQLITE_PATH" --batch "$BATCH_SIZE_NUM")
if [[ "$DROP_TABLES" == "1" ]]; then
  MIGRATE_ARGS+=(--drop)
fi

echo "[migrate_one_click] importing sqlite -> mysql ..."
node "$SCRIPT_DIR/scripts/migrate_sqlite_to_mysql.js" "${MIGRATE_ARGS[@]}"

echo "[migrate_one_click] import done, running count checks..."
node <<'NODE'
const mysql = require('mysql2/promise');

(async () => {
  const requiredTables = [
    'accounts',
    'players',
    'league_teams',
    'league_matches',
    'exchange_listings',
    'exchange_trades'
  ];

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  for (const t of requiredTables) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    console.log(`[migrate_one_click] count ${t}: ${Number(rows?.[0]?.c || 0)}`);
  }

  await conn.end();
})().catch((e) => {
  console.error('[migrate_one_click] count check failed:', e?.message || e);
  process.exit(1);
});
NODE

if [[ "${DB_DRIVER:-sqlite}" == "mysql" ]]; then
  echo "[migrate_one_click] prechecking runtime mysql driver (sync-mysql)..."
  runtime_driver_precheck
fi

if [[ "$AUTO_START" == "1" && "$STOPPED_SERVER" == "1" ]]; then
  if [[ -f "$SCRIPT_DIR/start_server.sh" ]]; then
    echo "[migrate_one_click] starting server..."
    bash "$SCRIPT_DIR/start_server.sh"
  else
    echo "[migrate_one_click] start_server.sh not found, skip start"
  fi
fi

echo "[migrate_one_click] all done"
