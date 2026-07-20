/**
 * 艾德尔工单系统 - 账号健康检测
 * 每日扫描所有进行中的账号，自动升级到最高级(120)
 * 到达120级后2天停止监控
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const antiDetect = require('./_anti_detect');

const WORKER_URL = process.env.WORKER_URL;
const API_KEY = process.env.API_KEY;
const API_BASE = process.env.API_BASE;
const CLIENT_VERSION = process.env.CLIENT_VERSION;
const SIGN_KEY = process.env.SIGN_KEY;
const MAX_LEVEL = 120;

// 启动前验证关键环境变量
const REQUIRED_ENV = { WORKER_URL, API_KEY, API_BASE, SIGN_KEY };
for (const [name, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) {
    console.error(`错误: 环境变量 ${name} 未设置`);
    process.exit(1);
  }
}

let _apiIdx = 0;
function setApiIdx(idx) { _apiIdx = idx; }

function makeSign(method, path, timestamp, bodyStr) {
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(method + '\n' + path + '\n' + timestamp + '\n' + bodyStr);
  return hmac.digest('hex');
}

async function apiRequest(method, path, token, body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, timestamp, bodyStr);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(timestamp),
    'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  Object.assign(headers, antiDetect.buildAntiDetectHeaders(_apiIdx++));
  const r = await fetch(API_BASE + path, { method, headers, body: bodyStr || undefined, timeout: 30000 });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + text.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function workerApi(path, method = 'GET', body = null) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const url = WORKER_URL.replace(/\/+$/, '') + path;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, timeout: 30000 });
  return r.json();
}

async function checkAndLevelUp(account, idx) {
  setApiIdx(idx * 10);

  const { server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) {
    console.log('  [' + (username || '?') + '] ⏭️ 无账号密码，跳过');
    return { ok: false, error: '无账号密码' };
  }

  console.log('  [' + server_username + '] 检查中...');

  try {
    // Check stop_monitor
    if (account.stop_monitor_at) {
      const stopTime = new Date(account.stop_monitor_at).getTime();
      if (Date.now() > stopTime) {
        console.log('  [' + server_username + '] ⏹️ 超过监控期，标记完成');
        await workerApi('/api/gh/report-account', 'POST', {
          order_id, username, status: 'completed', level: account.level || 0,
        });
        return { ok: true, status: 'completed', level: account.level || 0 };
      }
    }

    await antiDetect.randomDelay(2000);

    // Login
    const machineId = 'health_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    });
    const token = loginData.token;
    console.log('  [' + server_username + '] ✅ 登录成功');
    await antiDetect.randomDelay(1500);

    // Get player state
    const state = await apiRequest('GET', '/player/state', token);
    const player = state.player || {};
    const level = player.level || 0;
    const canLevelUp = player.can_level_up || false;
    const exp = player.exp || 0;
    const nextLevelExp = player.next_level_exp || 1;
    const expPercent = Math.floor((exp / nextLevelExp) * 100);

    console.log('  [' + server_username + '] 📊 等级=' + level + ', 经验=' + expPercent + '%, 可升级=' + canLevelUp);

    // Auto level up loop
    let currentLevel = level;
    if (canLevelUp) {
      for (let i = 0; i < 30; i++) {
        try {
          await apiRequest('POST', '/player/level_up', token, {});
          console.log('  [' + server_username + '] ⬆️ 升级! Lv.' + (currentLevel + 1));
          currentLevel++;
          await antiDetect.randomDelay(800);

          if (currentLevel >= MAX_LEVEL) {
            console.log('  [' + server_username + '] 🏆 到达满级120!');
            break;
          }

          // Check if still can level up
          const state2 = await apiRequest('GET', '/player/state', token);
          if (!state2.player?.can_level_up) {
            console.log('  [' + server_username + '] 经验不足，停止升级');
            break;
          }
        } catch (e) {
          console.log('  [' + server_username + '] 升级中断: ' + e.message);
          break;
        }
      }
    }

    // Breakthrough at level 100-119
    if (currentLevel >= 100 && currentLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {});
        console.log('  [' + server_username + '] 🔓 突破尝试');
        await antiDetect.randomDelay(1500);
      } catch (e) {
        console.log('  [' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    // Re-check level after operations
    let finalLevel = currentLevel;
    try {
      const state3 = await apiRequest('GET', '/player/state', token);
      finalLevel = state3.player?.level || currentLevel;
    } catch (e) {}

    const isCompleted = finalLevel >= MAX_LEVEL;
    const reportStatus = isCompleted ? 'completed' : 'farming';

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username,
      status: reportStatus,
      level: finalLevel,
      map_id: player.map_id || 0,
      map_name: player.map_name || '荒石村',
    });

    if (isCompleted) {
      console.log('  [' + server_username + '] 🎉 已完成120级，2天后停止监控');
    } else {
      console.log('  [' + server_username + '] 📈 当前等级=' + finalLevel + '/' + MAX_LEVEL);
    }

    return { ok: true, level: finalLevel, completed: isCompleted };
  } catch (e) {
    console.log('  [' + (server_username || '?') + '] ❌ 失败: ' + e.message);

    try {
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'error', level: account.level || 0,
        error_msg: e.message,
      });
    } catch (e2) {}

    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔工单系统 - 账号健康检测 v2.0');
  console.log('  时间: ' + new Date().toISOString());
  console.log('  目标等级: ' + MAX_LEVEL);
  console.log('═══════════════════════════════════════');

  if (!API_KEY) { console.error('错误: 未设置 API_KEY'); process.exit(1); }
  if (!WORKER_URL) { console.error('错误: 未设置 WORKER_URL'); process.exit(1); }

  console.log('\n[扫描] 获取活跃账号列表...');
  const data = await workerApi('/api/gh/active-accounts');
  if (!data.ok || !data.accounts || !data.accounts.length) {
    console.log('[结果] 没有活跃账号');
    return;
  }

  const accounts = data.accounts;
  console.log('[结果] 找到 ' + accounts.length + ' 个活跃账号\n');

  let completed = 0;
  let failed = 0;
  let total = accounts.length;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log('──── [' + (i + 1) + '/' + total + '] ' + (account.server_username || account.username) + ' ────');

    const result = await checkAndLevelUp(account, i);
    if (result.ok && result.completed) completed++;
    if (!result.ok) failed++;

    await antiDetect.smartPause(i, 5, 20);
    await antiDetect.randomDelay(3000);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  健康检测完成 ✓');
  console.log('  总计: ' + total + ' | 到达满级: ' + completed + ' | 失败: ' + failed);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误:', e.message);
  process.exit(1);
});
