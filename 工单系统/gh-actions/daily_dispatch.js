/**
 * 每日传人派出 — 对所有活跃的传人派出工单执行每日派出
 */
const crypto = require('crypto');
const https = require('https');
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 5, timeout: 60000 });

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://ideer-game-api.sifangzhiji.workers.dev';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';

function makeSign(method, path, timestamp, bodyStr) {
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(method + '\n' + path + '\n' + timestamp + '\n' + bodyStr);
  return hmac.digest('hex');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function tsLog(msg) { const t = new Date().toLocaleString('zh-CN', { hour12: false }); console.log(`[${t}] ${msg}`); }

function httpsReq(method, hostname, path, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers: { ...headers }, rejectUnauthorized: false, agent: HTTPS_AGENT };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const t = setTimeout(() => { req.destroy(new Error('超时')); }, timeoutMs || 30000);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function apiRequest(method, path, token, body) {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, ts, bodyStr);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(ts), 'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsReq(method, 'ideer-game-api.sifangzhiji.workers.dev', path, headers, bodyStr, 60000);
  let data;
  try { data = JSON.parse(r.body); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + r.body.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

async function workerApi(path, method, body) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const url = WORKER_URL.replace(/\/+$/, '') + path;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return r.json();
}

// 批量日志收集器（减少D1调用）
const logBatch = [];
let logFlushTimer = null;

function collectLog(log) {
  logBatch.push(log);
  if (logBatch.length >= 10) {
    flushLogs();
  } else if (!logFlushTimer) {
    logFlushTimer = setTimeout(flushLogs, 5000);
  }
}

async function flushLogs() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logBatch.length === 0) return;
  
  const logsToSend = logBatch.splice(0, 50);
  try {
    await workerApi('/api/gh/report-logs-batch', 'POST', { logs: logsToSend });
  } catch (e) {
    for (const log of logsToSend) {
      try { await workerApi('/api/gh/report-log', 'POST', log); } catch (e2) { /* 忽略 */ }
    }
  }
}

async function processOneOrder(order) {
  const { id: orderId, game_account_name: username, game_account_password: password, dispatch_map, material_type } = order;
  if (!username || !password) {
    tsLog('  ⏭️ 工单#' + orderId + ' 缺少账号密码');
    return false;
  }

  try {
    const machineId = 'dispatch_' + orderId + '_' + Date.now().toString(36);
    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    tsLog('  ✅ [' + username + '] 登录成功');

    const map = dispatch_map || '灵翠山脉';
    const material = material_type || '灵石';

    try {
      await apiRequest('POST', '/courier/send', token, { map, material });
      tsLog('  ✅ [' + username + '] 派出传人至[' + map + '] 物资[' + material + ']');
    } catch (e) {
      if (e.message.includes('冷却') || e.message.includes('已派出')) {
        tsLog('  ⏳ [' + username + '] 传人已在途中');
      } else {
        throw e;
      }
    }

    await sleep(1000);
    collectLog({
      order_id: orderId, username,
      log_type: 'daily_dispatch',
      message: '传人派出: ' + map + '/' + material,
    });
    return true;
  } catch (e) {
    tsLog('  ❌ [' + (username || '?') + '] ' + e.message);
    collectLog({
      order_id: orderId, username: username || '',
      log_type: 'dispatch_error',
      message: '传人派出失败: ' + e.message,
    });
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  每日传人派出工具');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════\n');

  // 获取所有已审核的传人派出工单（含订阅进行中的）
  const data = await workerApi('/api/gh/approved-orders', 'GET');
  if (!data.ok || !data.orders) {
    console.error('❌ 获取工单失败');
    process.exit(1);
  }

  const dispatchOrders = data.orders.filter(o =>
    o.order_type === '传人派出' && o.game_account_name
  );

  tsLog('找到 ' + dispatchOrders.length + ' 个传人派出工单');

  let ok = 0, fail = 0;
  for (let i = 0; i < dispatchOrders.length; i++) {
    const order = dispatchOrders[i];
    console.log('──── 工单#' + order.id + ' [' + (i + 1) + '/' + dispatchOrders.length + '] ' + (order.game_account_name || '') + ' ────');
    const r = await processOneOrder(order);
    if (r) ok++; else fail++;
    await sleep(2000);
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  完成 ✓ 成功=' + ok + ' 失败=' + fail);
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error('致命: ' + e.message); process.exit(1); });
