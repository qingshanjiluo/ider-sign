/**
 * 艾德尔工单系统 - 全账号升级（每2h）并发版
 * 遍历所有未完成工单的账号，并发处理，反复升级直到经验不足
 * 纯升级，不修战斗/功法，极限速度
 * 防封：每账号独立IP/机器码/指纹、随机延迟、智能暂停
 */
const crypto = require('crypto');
const antiDetect = require('./_anti_detect');
const { ensureCharacter } = require('./_character');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://ideer-game-api.sifangzhiji.workers.dev';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const MAX_LEVEL = 120;
const CONCURRENCY = Math.min(Math.max(parseInt(process.env.CONCURRENCY) || 8, 1), 20);

for (const [n, v] of Object.entries({ WORKER_URL, API_KEY, API_BASE, SIGN_KEY })) {
  if (!v) { console.error('错误: 环境变量 ' + n + ' 未设置'); process.exit(1); }
}

function makeSign(method, path, timestamp, bodyStr) {
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(method + '\n' + path + '\n' + timestamp + '\n' + bodyStr);
  return hmac.digest('hex');
}

async function apiRequest(method, path, token, body, apiIdx) {
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
  // 每账号使用固定偏移，确保同一账号始终不同指纹
  Object.assign(headers, antiDetect.buildAntiDetectHeaders(apiIdx));
  const r = await fetch(API_BASE + path, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + text.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tsLog(msg) {
  const t = new Date().toLocaleString('zh-CN', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

async function workerApi(path, method, body) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const r = await fetch(WORKER_URL.replace(/\/+$/, '') + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
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

/**
 * 升级单个账号（每个账号在独立协程中运行）
 * @param {object} account - 账号信息
 * @param {number} globalIdx - 全局序号（决定反检测指纹）
 * @returns {object} 升级结果
 */
async function levelUpAccount(account, globalIdx) {
  // 每个账号使用独立但固定的指纹偏移
  const apiIdx = globalIdx * 10 + Math.floor(Math.random() * 7);

  const { id, server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) {
    tsLog('[' + (username || '?') + '] ⏭️ 无账号密码');
    return { ok: false, skipped: true };
  }

  try {
    const machineId = 'lvlall_' + globalIdx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    }, apiIdx);
    const token = loginData.token;

    // ── 确保角色存在（无角色则自动创建） ──
    const charResult = await ensureCharacter(
      (method, path, token, body) => apiRequest(method, path, token, body, apiIdx),
      token, server_username
    );
    if (!charResult.ok) {
      tsLog('[' + server_username + '] ⚠️ 角色检查失败: ' + charResult.error);
    }
    if (charResult.created) {
      tsLog('[' + server_username + '] ✅ 角色创建成功: ' + (charResult.createdName || ''));
    }
    const syncPlayer = charResult.player || {};
    const state = await apiRequest('GET', '/player/state', token, null, apiIdx);
    const player = state.player || {};
    let currentLevel = player.level || 0;

    // 记录当前完整状态
    const activeBattle = !!state.active_battle;
    const autoBattleOn = syncPlayer?.auto_battle_enabled;
    const restUntil = player.rest_until || 0;
    const spiritStones = player.spirit_stones || 0;
    tsLog('[' + server_username + '] 📊 Lv.' + currentLevel + ' 战斗中=' + (activeBattle ? '✅' : '❌') + ' auto=' + (autoBattleOn ? '✅' : '❌') + ' 休息到=' + (restUntil > Date.now() ? new Date(restUntil).toISOString() : '否') + ' 灵石=' + spiritStones + ' exp=' + (player.exp || 0));

    // ── 战斗修复 ──
    let battleFixed = false;
    if (!activeBattle || !autoBattleOn) {
      if (restUntil > Date.now()) {
        tsLog('[' + server_username + '] ⏳ 正在休息中(rest_until=' + new Date(restUntil).toISOString() + ')，跳过战斗启动');
      } else {
        try {
          const mapId = syncPlayer?.current_map_id || 1;
          tsLog('[' + server_username + '] 🔧 启动战斗 mapId=' + mapId);
          await apiRequest('POST', '/battle/start', token, { mapId, poll_mode: false, auto_restart: false }, apiIdx);
          await sleep(800);
          await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: mapId }, apiIdx);
          battleFixed = true;
          await antiDetect.randomDelay(800, 1500);
        } catch (e) {
          tsLog('[' + server_username + '] ⚠️ 战斗启动失败: ' + e.message);
          collectLog({
            order_id, account_id: id, log_type: 'battle_error',
            message: '战斗启动失败: ' + e.message,
            raw_output: e.message,
          });
        }
      }
    }
    if (battleFixed) {
      tsLog('[' + server_username + '] 🔧 战斗已启动');
      await sleep(500);
      try {
        const st2 = await apiRequest('GET', '/player/state', token, null, apiIdx);
        if (st2?.player) Object.assign(player, st2.player);
        tsLog('[' + server_username + '] ✅ 战后确认: 战斗中=' + (st2?.active_battle ? '✅' : '❌') + ' exp=' + ((st2?.player?.exp) || 0));
      } catch (e) {}
    }

    // 重新获取最新状态
    let stCheck;
    try {
      stCheck = await apiRequest('GET', '/player/state', token, null, apiIdx);
    } catch (e) {}
    const finalPlayer = stCheck?.player || player;
    currentLevel = finalPlayer.level || currentLevel;
    tsLog('[' + server_username + '] 📊 Lv.' + currentLevel + ' 战斗中=' + (stCheck?.active_battle ? '✅' : '❌') + ' exp=' + (finalPlayer.exp || 0));

    if (currentLevel >= MAX_LEVEL) {
      tsLog('[' + server_username + '] 🏆 已满级');
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'completed', level: MAX_LEVEL,
        health_status: 'completed',
      });
      return { ok: true, level: MAX_LEVEL, completed: true };
    }

    let newLevel = currentLevel;
    let levelsGained = 0;
    for (let i = 0; i < 100; i++) {
      try {
        const upRes = await apiRequest('POST', '/player/level_up', token, {}, apiIdx);
        if (!upRes || !upRes.player || !upRes.player.level) break;
        newLevel = upRes.player.level;
        levelsGained++;
        if (newLevel >= MAX_LEVEL) { tsLog('[' + server_username + '] 🏆 满级!'); break; }
        await antiDetect.randomDelay(400, 800);
      } catch (e) {
        if (e.message.includes('经验不足') || e.message.includes('exp')) {
          tsLog('[' + server_username + '] 经验不足，升级停止');
        } else {
          tsLog('[' + server_username + '] 升级中断: ' + e.message.slice(0, 60));
        }
        break;
      }
    }

    if (newLevel >= 100 && newLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {}, apiIdx);
        await antiDetect.randomDelay(800, 1500);
      } catch (e) {
        tsLog('[' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    // 取最终状态
    let finalLevel = newLevel;
    try {
      const st3 = await apiRequest('GET', '/player/state', token, null, apiIdx);
      finalLevel = st3.player?.level || newLevel;
    } catch (e) {}

    const isCompleted = finalLevel >= MAX_LEVEL;
    tsLog('[' + server_username + '] 📈 Lv.' + currentLevel + ' → Lv.' + finalLevel + (levelsGained > 0 ? ' (+' + levelsGained + ')' : ' 无变化'));

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username, status: isCompleted ? 'completed' : 'farming', level: finalLevel,
      health_status: isCompleted ? 'completed' : 'ok',
    });
    collectLog({
      order_id, account_id: id, log_type: isCompleted ? 'levelup_completed' : 'levelup_report',
      message: isCompleted
        ? '🎉 从 Lv.' + currentLevel + ' 升到满级 Lv.' + finalLevel + '（+' + levelsGained + '级）'
        : '📈 Lv.' + currentLevel + ' → Lv.' + finalLevel + '（+' + levelsGained + '级）',
      raw_output: JSON.stringify({ from_level: currentLevel, to_level: finalLevel, levelsGained }),
    });

    return { ok: true, level: finalLevel, completed: isCompleted, gained: levelsGained };
  } catch (e) {
    tsLog('[' + (server_username || '?') + '] ❌ 失败: ' + (e.message || '').slice(0, 100));
    try {
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'error', level: account.level || 0,
        error_msg: e.message || '', health_status: 'error',
      });
    } catch (e2) {}
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔 - 全账号自动升级 (并发版)');
  console.log('  时间: ' + new Date().toISOString());
  console.log('  并发数: ' + CONCURRENCY);
  console.log('═══════════════════════════════════════');

  tsLog('获取所有未完成订单的账号...');
  const data = await workerApi('/api/gh/all-accounts', 'GET');
  if (!data.ok) {
    tsLog('❌ API 错误: ' + JSON.stringify(data.error || data));
    return;
  }
  if (!data.accounts || !data.accounts.length) {
    tsLog('没有可升级的账号');
    return;
  }

  const accounts = data.accounts;
  tsLog('找到 ' + accounts.length + ' 个账号，开始升级\n');

  let leveled = 0;
  let completed = 0;
  let failed = 0;
  const processedOrders = new Set();

  // ── 并发池：分批处理 ──
  const totalBatches = Math.ceil(accounts.length / CONCURRENCY);
  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * CONCURRENCY;
    const end = Math.min(start + CONCURRENCY, accounts.length);
    const batchAccounts = accounts.slice(start, end);

    console.log(`\n📦 批次 ${batch + 1}/${totalBatches} (账号 ${start + 1}-${end}/${accounts.length})`);

    // 每个账号错开启动时间（2~4秒间隔），模仿真实多设备
    const tasks = batchAccounts.map((acc, offset) => {
      const globalIdx = start + offset;
      const delay = offset * (2000 + Math.floor(Math.random() * 2000));
      return sleep(delay).then(() => {
        console.log('──── [' + (globalIdx + 1) + '/' + accounts.length + '] ' + (acc.server_username || acc.username) + ' (Lv.' + (acc.level || 0) + ') ────');
        return levelUpAccount(acc, globalIdx);
      });
    });

    const results = await Promise.allSettled(tasks);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const res = result.value;
        if (res.ok && !res.skipped) {
          if (res.gained > 0) leveled++;
          if (res.completed) completed++;
        }
        if (!res.ok) failed++;
        if (res.order_id) processedOrders.add(res.order_id);
      } else {
        failed++;
      }
    }

    // 每批次结束后智能暂停：批次数越大、暂停越长
    if (batch < totalBatches - 1) {
      const current = batch * CONCURRENCY + CONCURRENCY;
      await antiDetect.smartPause(current, 999, 8 + Math.floor(Math.random() * 5)); // 8~12秒
      // 额外批次间延迟
      const interBatchDelay = 3000 + Math.floor(Math.random() * 4000);
      console.log(`  批次间等待 ${Math.round(interBatchDelay / 1000)}s...`);
      await sleep(interBatchDelay);
    }
  }

  if (processedOrders.size > 0) {
    tsLog('检查 ' + processedOrders.size + ' 个工单完成状态...');
    const orderIds = [...processedOrders];
    for (const oid of orderIds) {
      try {
        const res = await workerApi('/api/gh/complete-order', 'POST', { order_id: oid });
        if (res.ok) tsLog('✅ 工单 #' + oid + ': ' + (res.message || res.status || 'ok'));
      } catch (e) {
        tsLog('⚠️ 工单 #' + oid + ' 推进失败: ' + e.message);
      }
      await sleep(300 + Math.floor(Math.random() * 500));
    }
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  全账号升级完成 ✓');
  console.log('  总数: ' + accounts.length + ' | 升级: ' + leveled + ' | 满级: ' + completed + ' | 失败: ' + failed);
  console.log('  并发数: ' + CONCURRENCY);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  tsLog('❌ 致命错误: ' + e.message);
  process.exit(1);
});
