#!/usr/bin/env bash
set -euo pipefail

# Safe MySQL runtime switch with automatic rollback.
#
# Usage:
#   bash ./switch_mysql_safe.sh
#
# Optional env vars:
#   APP_NAME=xianxia-server
#   ENV_FILE=/opt/game/server/.env
#   MYSQL_FAST_MODE=1
#   HEALTH_URL=http://127.0.0.1:3000/health
#   CANARY_ROUNDS=40
#   CANARY_INTERVAL_SEC=2
#   CANARY_FAIL_LIMIT=3
#   CHECK_NGINX_TIMEOUT_DELTA=1
#   NGINX_ERR_LOG=/var/log/nginx/error.log
#   NGINX_TIMEOUT_DELTA_LIMIT=5

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="${APP_NAME:-xianxia-server}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
MYSQL_FAST_MODE="${MYSQL_FAST_MODE:-1}"

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
CANARY_ROUNDS="${CANARY_ROUNDS:-40}"
CANARY_INTERVAL_SEC="${CANARY_INTERVAL_SEC:-2}"
CANARY_FAIL_LIMIT="${CANARY_FAIL_LIMIT:-3}"

CHECK_NGINX_TIMEOUT_DELTA="${CHECK_NGINX_TIMEOUT_DELTA:-1}"
NGINX_ERR_LOG="${NGINX_ERR_LOG:-/var/log/nginx/error.log}"
NGINX_TIMEOUT_DELTA_LIMIT="${NGINX_TIMEOUT_DELTA_LIMIT:-5}"

BACKUP_FILE=""
SWITCH_DONE="0"

log() {
  echo "[switch_mysql_safe] $*"
}

require_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "[switch_mysql_safe] missing command: $c" >&2
    exit 1
  fi
}

validate_env_format() {
  local f="$1"
  local bad
  bad="$(awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    /^[A-Za-z_][A-Za-z0-9_]*=.*/ { next }
    { print NR ":" $0 }
  ' "$f")"
  if [[ -n "$bad" ]]; then
    echo "[switch_mysql_safe] invalid .env line(s):" >&2
    echo "$bad" >&2
    return 1
  fi
  return 0
}

sanitize_env_file() {
  local f="$1"
  local tmp="${f}.sanitize.$$"

  awk '
    /^[[:space:]]*$/ { print; next }
    /^[[:space:]]*#/ { print; next }
    /^[A-Za-z_][A-Za-z0-9_]*=.*/ { print; next }
    {
      print "[switch_mysql_safe] drop invalid env line " NR ": " $0 > "/dev/stderr"
      next
    }
  ' "$f" > "$tmp"

  mv "$tmp" "$f"
}

set_kv() {
  local key="$1"
  local value="$2"
  local tmp="${ENV_FILE}.tmp.$$"

  awk -v k="$key" -v v="$value" '
    BEGIN { done=0 }
    $0 ~ "^[[:space:]]*"k"=" {
      print k"="v
      done=1
      next
    }
    { print }
    END {
      if (!done) print k"="v
    }
  ' "$ENV_FILE" > "$tmp"

  mv "$tmp" "$ENV_FILE"
}

nginx_timeout_count() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo 0
    return 0
  fi
  awk '/upstream timed out/{c++} END{print c+0}' "$f"
}

restart_app() {
  if [[ -f "$SCRIPT_DIR/restart_server.sh" ]]; then
    bash "$SCRIPT_DIR/restart_server.sh"
    return 0
  fi
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
    return 0
  fi
  echo "[switch_mysql_safe] neither restart_server.sh nor pm2 found" >&2
  return 1
}

health_once() {
  local body
  body="$(curl --noproxy '*' -fsS -m 3 "$HEALTH_URL" 2>/dev/null || true)"
  if echo "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    return 0
  fi
  return 1
}

rollback_to_sqlite() {
  if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
    echo "[switch_mysql_safe] rollback skipped: backup file not found" >&2
    return 1
  fi

  log "rollback: restore $BACKUP_FILE"
  cp "$BACKUP_FILE" "$ENV_FILE"
  set_kv DB_DRIVER sqlite
  set_kv MYSQL_RUNTIME_ENABLE 0
  validate_env_format "$ENV_FILE"
  restart_app
}

on_exit() {
  local code="$1"
  if [[ "$code" -eq 0 ]]; then
    return 0
  fi
  if [[ "$SWITCH_DONE" == "1" ]]; then
    log "script failed after switch, auto rollback to sqlite"
    rollback_to_sqlite || true
  fi
}
trap 'on_exit $?' EXIT

main() {
  require_cmd awk
  require_cmd sed
  require_cmd curl
  require_cmd bash

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "[switch_mysql_safe] env file not found: $ENV_FILE" >&2
    exit 1
  fi

  sed -i 's/\r$//' "$ENV_FILE"
  sanitize_env_file "$ENV_FILE"
  validate_env_format "$ENV_FILE"

  BACKUP_FILE="$SCRIPT_DIR/.env.sqlite_stable_$(date +%Y%m%d_%H%M%S)"
  cp "$ENV_FILE" "$BACKUP_FILE"
  log "backup env: $BACKUP_FILE"

  local nginx_before=0
  if [[ "$CHECK_NGINX_TIMEOUT_DELTA" == "1" ]]; then
    nginx_before="$(nginx_timeout_count "$NGINX_ERR_LOG")"
    log "nginx timeout count before: $nginx_before"
  fi

  set_kv DB_DRIVER mysql
  set_kv MYSQL_RUNTIME_ENABLE 1
  set_kv MYSQL_SYNC_FAST_MODE "$MYSQL_FAST_MODE"
  validate_env_format "$ENV_FILE"

  SWITCH_DONE="1"
  log "restarting with mysql..."
  restart_app

  local fail_count=0
  local i
  for ((i=1; i<=CANARY_ROUNDS; i++)); do
    if health_once; then
      :
    else
      fail_count=$((fail_count + 1))
      log "health check failed ($fail_count/$CANARY_ROUNDS)"
    fi
    sleep "$CANARY_INTERVAL_SEC"
  done

  log "health fail count: $fail_count"
  if (( fail_count > CANARY_FAIL_LIMIT )); then
    echo "[switch_mysql_safe] too many health failures, rollback required" >&2
    rollback_to_sqlite
    exit 1
  fi

  if [[ "$CHECK_NGINX_TIMEOUT_DELTA" == "1" ]]; then
    local nginx_after
    local delta
    nginx_after="$(nginx_timeout_count "$NGINX_ERR_LOG")"
    delta=$((nginx_after - nginx_before))
    log "nginx timeout count after: $nginx_after (delta=$delta)"
    if (( delta > NGINX_TIMEOUT_DELTA_LIMIT )); then
      echo "[switch_mysql_safe] nginx timeout delta too large, rollback required" >&2
      rollback_to_sqlite
      exit 1
    fi
  fi

  log "switch canary passed"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 status "$APP_NAME" || true
  fi
}

main "$@"
