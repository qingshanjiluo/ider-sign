#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-xianxia-server}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/health}"
DOMAIN_URL="${DOMAIN_URL:-https://idlexiuxianzhuan.cn}"
GM_TOKEN="${GM_TOOL_TOKEN:-}"

TMP_BODY="/tmp/xianxia_health_body.txt"
TS="$(date +%s)"

echo "[health_check] pm2 status for ${APP_NAME}"
pm2 status "$APP_NAME" || true

echo "[health_check] pm2 describe ${APP_NAME}"
pm2 describe "$APP_NAME" || true

echo "[health_check] pm2 recent restart events"
pm2 jlist 2>/dev/null | grep -E '"name"|"restart_time"|"status"' -n | head -n 40 || true

echo "[health_check] listen sockets for :${PORT}"
ss -lntp 2>/dev/null | grep ":${PORT}" || true

echo "[health_check] local http check: ${HEALTH_URL}"
HTTP_CODE="$(curl -s -o "$TMP_BODY" -w '%{http_code}' "${HEALTH_URL}?t=${TS}" || true)"
echo "[health_check] http_code=${HTTP_CODE}"
echo "[health_check] response (first 200 chars):"
head -c 200 "$TMP_BODY" || true
echo

echo "[health_check] public /health check: ${DOMAIN_URL}/health"
PUB_HEALTH_CODE="$(curl -k -s -o /tmp/xianxia_public_health.txt -w '%{http_code}' "${DOMAIN_URL}/health?t=${TS}" || true)"
echo "[health_check] public_health_http_code=${PUB_HEALTH_CODE}"
head -c 200 /tmp/xianxia_public_health.txt || true
echo

echo "[health_check] public /web check: ${DOMAIN_URL}/web/"
PUB_WEB_CODE="$(curl -k -s -o /tmp/xianxia_public_web.txt -w '%{http_code}' "${DOMAIN_URL}/web/?t=${TS}" || true)"
echo "[health_check] public_web_http_code=${PUB_WEB_CODE}"
head -c 200 /tmp/xianxia_public_web.txt || true
echo

echo "[health_check] nginx status"
systemctl status nginx --no-pager -l 2>/dev/null | head -n 40 || true

echo "[health_check] nginx config test"
nginx -t 2>&1 | tail -n 20 || true

echo "[health_check] nginx error log tail"
tail -n 120 /var/log/nginx/error.log 2>/dev/null || true

echo "[health_check] nginx access log tail"
tail -n 80 /var/log/nginx/access.log 2>/dev/null || true

echo "[health_check] recent logs:"
pm2 logs "$APP_NAME" --lines 60 --nostream || true

if [ -n "$GM_TOKEN" ]; then
	echo "[health_check] gm server-stats:"
	curl -s "http://127.0.0.1:${PORT}/gm/server-stats" -H "X-GM-Token: ${GM_TOKEN}" || true
	echo

	echo "[health_check] gm api-stats (top section):"
	curl -s "http://127.0.0.1:${PORT}/gm/api-stats" -H "X-GM-Token: ${GM_TOKEN}" | head -c 1200 || true
	echo
fi
