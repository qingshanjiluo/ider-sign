#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-xianxia-server}"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 stop "$APP_NAME"
  pm2 save
  echo "[stop_server] stopped: $APP_NAME"
else
  echo "[stop_server] app not found: $APP_NAME"
fi
