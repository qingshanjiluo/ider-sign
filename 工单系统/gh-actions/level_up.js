/**
 * 艾德尔工单系统 - 账号一键升级
 * 遍历所有 farming 中的账号：
 *   - 登录并检查经验/升级状态
 *   - 循环升级直到经验不足或达到 120 级
 *   - 到达 100+ 级时尝试突破
 *   - 上报最新等级和状态
 */
const crypto = require('crypto');
const antiDetect = require('./_anti_detect');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const MAX_LEVEL = 120;

const REQUIRED_ENV = { WORKER_URL, API_KEY, API_BASE, SIGN_KEY };
for (const [name, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) { console.error('错误: 环境变量 ' + name + ' 未设置'); process.exit(1); }
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
  const r = await fetch(API_BASE + path, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + text.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function workerApi(path, method, body) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const url = WORKER_URL.replace(/\/+$/, '') + path;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return r.json();
}

async function levelUpAccount(account, idx) {
  setApiIdx(idx * 10);

  const { server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) {
    console.log('  [' + (username || '?') + '] ⏭️ 无账号密码，跳过');
    return { ok: false, skipped: true };
  }

  console.log('  [' + server_username + '] 检查中...');

  try {
    // 检查是否已过监控期
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

    // 登录
    const machineId = 'levelup_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    });
    const token = loginData.token;
    console.log('  [' + server_username + '] ✅ 登录成功');
    await antiDetect.randomDelay(1500);

    // 获取当前状态
    const state = await apiRequest('GET', '/player/state', token);
    const player = state.player || {};
    const currentLevel = player.level || 0;
    const canLevelUp = player.can_level_up || false;
    const exp = player.exp || 0;
    const nextLevelExp = player.next_level_exp || 1;
    const expPercent = Math.floor((exp / nextLevelExp) * 100);

    console.log('  [' + server_username + '] 📊 等级=' + currentLevel + ', 经验=' + expPercent + '%, 可升级=' + canLevelUp);

    // 如果已满级，直接上报完成
    if (currentLevel >= MAX_LEVEL) {
      console.log('  [' + server_username + '] 🏆 已达满级');
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'completed', level: MAX_LEVEL,
        map_id: player.map_id || 0, map_name: player.map_name || '',
      });
      return { ok: true, level: MAX_LEVEL, completed: true };
    }

    // 循环升级
    let newLevel = currentLevel;
    if (canLevelUp) {
      for (let i = 0; i < 50; i++) {
        try {
          await apiRequest('POST', '/player/level_up', token, {});
          newLevel++;
          console.log('  [' + server_username + '] ⬆️ 升级! Lv.' + newLevel);
          await antiDetect.randomDelay(600);

          if (newLevel >= MAX_LEVEL) {
            console.log('  [' + server_username + '] 🏆 到达满级 120!');
            break;
          }

          // 每 5 级检查一次是否还能继续
          if (i % 5 === 4 || i === 0) {
            const st2 = await apiRequest('GET', '/player/state', token);
            if (!st2.player?.can_level_up) {
              console.log('  [' + server_username + '] 经验不足，暂停升级');
              break;
            }
          }
        } catch (e) {
          console.log('  [' + server_username + '] 升级中断: ' + e.message);
          break;
        }
      }
    } else {
      console.log('  [' + server_username + '] 经验不足(' + expPercent + '%)，无法升级');
    }

    // 等级 ≥ 100 时尝试突破
    if (newLevel >= 100 && newLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {});
        console.log('  [' + server_username + '] 🔓 突破尝试');
        await antiDetect.randomDelay(1500);
      } catch (e) {
        console.log('  [' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    // 重新获取最终等级
    let finalLevel = newLevel;
    try {
      const st3 = await apiRequest('GET', '/player/state', token);
      finalLevel = st3.player?.level || newLevel;
    } catch (e) {}

    const isCompleted = finalLevel >= MAX_LEVEL;
    const reportStatus = isCompleted ? 'completed' : 'farming';

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username, status: reportStatus, level: finalLevel,
      map_id: player.map_id || 0, map_name: player.map_name || '',
    });

    if (isCompleted) {
      console.log('  [' + server_username + '] 🎉 已满级，2 天后停止监控');
    } else {
      const pct = finalLevel > 0 ? Math.floor(finalLevel / MAX_LEVEL * 100) : 0;
      console.log('  [' + server_username + '] 📈 当前等级=' + finalLevel + '/' + MAX_LEVEL + ' (' + pct + '%)');
    }

    return { ok: true, level: finalLevel, completed: isCompleted };
  } catch (e) {
    console.log('  [' + (server_username || '?') + '] ❌ 失败: ' + e.message);
    try {
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'error', level: account.level || 0, error_msg: e.message,
      });
    } catch (e2) {}
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔工单系统 - 一键升级');
  console.log('  时间: ' + new Date().toISOString());
  console.log('  目标等级: ' + MAX_LEVEL);
  console.log('═══════════════════════════════════════');

  console.log('\n[扫描] 获取 farming 账号列表...');
  const data = await workerApi('/api/gh/active-accounts');
  if (!data.ok || !data.accounts || !data.accounts.length) {
    console.log('[结果] 没有活跃账号');
    return;
  }

  const accounts = data.accounts;
  console.log('[结果] 找到 ' + accounts.length + ' 个活跃账号\n');

  let leveled = 0;
  let completed = 0;
  let failed = 0;
  const processedOrders = new Set();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log('──── [' + (i + 1) + '/' + accounts.length + '] ' + (account.server_username || account.username) + ' ────');

    const result = await levelUpAccount(account, i);
    if (result.ok && !result.skipped) {
      if (result.level > (account.level || 0)) leveled++;
      if (result.completed) completed++;
    }
    if (!result.ok) failed++;
    processedOrders.add(account.order_id);

    await antiDetect.smartPause(i, 5, 20);
    await antiDetect.randomDelay(3000);
  }

  // 推进已处理工单的状态
  if (processedOrders.size > 0) {
    console.log('\n[推进] 检查 ' + processedOrders.size + ' 个工单完成状态...');
    for (const oid of processedOrders) {
      try {
        const res = await workerApi('/api/gh/complete-order', 'POST', { order_id: oid });
        if (res.ok && res.status === 'completed') {
          console.log('  ✅ 工单 #' + oid + ' 已完成');
        } else if (res.ok && res.status === 'processing') {
          console.log('  ▶️ 工单 #' + oid + ' 已进入挂机阶段');
        } else {
          console.log('  ⏳ 工单 #' + oid + ': ' + (res.message || '等待中'));
        }
      } catch (e) {
        console.log('  ⚠️ 工单 #' + oid + ' 推进失败: ' + e.message);
      }
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  一键升级完成 ✓');
  console.log('  总计: ' + accounts.length + ' | 升级: ' + leveled + ' | 满级: ' + completed + ' | 失败: ' + failed);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误:', e.message);
  process.exit(1);
});
