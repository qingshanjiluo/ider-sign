/**
 * 自动副本刷取 — 对副本刷取工单执行全地图战斗
 * 每个地图战斗2次并自动推进
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
  const { id: orderId, game_account_name: username, game_account_password: password, clear_type } = order;
  if (!username || !password) {
    tsLog('  ⏭️ 工单#' + orderId + ' 缺少账号密码');
    return false;
  }

  try {
    const machineId = 'dungeon_' + orderId + '_' + Date.now().toString(36);
    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    tsLog('  ✅ [' + username + '] 登录成功');

    // 获取副本列表
    let dungeonList = [];
    try {
      const listData = await apiRequest('GET', '/dungeon/list', token);
      dungeonList = listData.dungeons || listData.list || [];
    } catch (e) {
      tsLog('  ⚠️ 获取副本列表失败: ' + e.message);
      dungeonList = [
        { id: 1, name: '灵翠山脉' }, { id: 2, name: '幽暗森林' },
        { id: 3, name: '冰霜峡谷' }, { id: 4, name: '火焰山' },
        { id: 5, name: '星辰塔' },
      ];
    }
    tsLog('  加载 ' + dungeonList.length + ' 个副本');

    const clearType = clear_type || '全物资';
    let cleared = 0;

    for (let di = 0; di < dungeonList.length; di++) {
      const dungeon = dungeonList[di];
      const dungeonId = dungeon.id || dungeon.dungeon_id || (di + 1);
      const dungeonName = dungeon.name || ('副本#' + dungeonId);

      // 每个地图战斗2次
      for (let round = 1; round <= 2; round++) {
        try {
          const startData = await apiRequest('POST', '/dungeon-battle/start', token, { dungeon_id: dungeonId });
          const battleId = startData.battle_id;
          if (!battleId) {
            tsLog('  [' + dungeonName + '] 无battle_id');
            continue;
          }
          let ended = false;
          for (let adv = 0; adv < 60; adv++) {
            const advData = await apiRequest('POST', '/dungeon-battle/advance?state=lite', token, { battle_id: battleId });
            ended = Boolean(advData.ended);
            if (ended) break;
            await sleep(80);
          }
          if (ended) {
            cleared++;
            tsLog('  ✅ [' + dungeonName + '] 第' + round + '轮完成');
          }
        } catch (e) {
          tsLog('  ⚠️ [' + dungeonName + '] 第' + round + '轮跳过: ' + e.message);
        }
        await sleep(500);
      }

      // 自动推进到下一地图
      try {
        await apiRequest('POST', '/player/set_map', token, { map_id: (di + 2) });
      } catch (e) {}
      await sleep(800);
    }

    tsLog('  📊 清理 ' + cleared + '/' + (dungeonList.length * 2) + ' 轮次 类型=' + clearType);

    collectLog({
      order_id: orderId, username,
      log_type: 'dungeon_clear',
      message: '副本刷取完成: ' + clearType + ' ' + cleared + '/' + (dungeonList.length * 2) + '轮',
    });

    await workerApi('/api/gh/report-account', 'POST', {
      order_id: orderId, username, password,
      server_username: username, server_password: password,
      status: 'farming', level: 0,
    });

    return true;
  } catch (e) {
    tsLog('  ❌ [' + (username || '?') + '] ' + e.message);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  自动副本刷取工具');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════\n');

  const data = await workerApi('/api/gh/approved-orders', 'GET');
  if (!data.ok || !data.orders) {
    console.error('❌ 获取工单失败');
    process.exit(1);
  }

  const dungeonOrders = data.orders.filter(o =>
    o.order_type === '副本刷取' && o.game_account_name
  );

  tsLog('找到 ' + dungeonOrders.length + ' 个副本刷取工单');

  let ok = 0, fail = 0;
  for (let i = 0; i < dungeonOrders.length; i++) {
    const order = dungeonOrders[i];
    console.log('──── 工单#' + order.id + ' [' + (i + 1) + '/' + dungeonOrders.length + '] ' + (order.game_account_name || '') + ' ────');
    const r = await processOneOrder(order);
    if (r) ok++; else fail++;
    await sleep(3000);
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  完成 ✓ 成功=' + ok + ' 失败=' + fail);
  console.log('═══════════════════════════════════════');
}

main().catch(e => { console.error('致命: ' + e.message); process.exit(1); });
