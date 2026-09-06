/**
 * 艾德尔工单系统 - 账号一键升级（并发版）
 * 遍历所有 farming 中的账号，并发处理：
 *   - 登录并检查经验/升级状态
 *   - 循环升级直到经验不足或达到 120 级
 *   - 到达 100+ 级时尝试突破
 *   - 上报最新等级和状态
 * 防封：每账号独立IP/指纹/随机延迟/智能暂停
 */
const crypto = require('crypto');
const antiDetect = require('./_anti_detect');
const { ensureCharacter } = require('./_character');

const WORKER_URL = 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://ideer-game-api.sifangzhiji.workers.dev';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const MAX_LEVEL = 120;
const CONCURRENCY = Math.min(Math.max(parseInt(process.env.CONCURRENCY) || 8, 1), 20);

const REQUIRED_ENV = { WORKER_URL, API_BASE, SIGN_KEY };
for (const [name, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) { console.error('错误: 环境变量 ' + name + ' 未设置'); process.exit(1); }
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
  Object.assign(headers, antiDetect.buildAntiDetectHeaders(apiIdx));
  const r = await fetch(API_BASE + path, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + text.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tsLog(msg) {
  const now = new Date();
  const t = now.toLocaleString('zh-CN', { hour12: false });
  console.log(`[${t}] ${msg}`);
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

async function levelUpAccount(account, globalIdx) {
  const apiIdx = globalIdx * 10 + Math.floor(Math.random() * 7);

  const { id, server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) {
    tsLog('[' + (username || '?') + '] ⏭️ 无账号密码，跳过');
    return { ok: false, skipped: true };
  }

  tsLog('[' + server_username + '] 检查中...');

  try {
    if (account.stop_monitor_at) {
      const stopTime = new Date(account.stop_monitor_at).getTime();
      if (Date.now() > stopTime) {
        tsLog('[' + server_username + '] ⏹️ 超过监控期，标记完成');
        await workerApi('/api/gh/report-account', 'POST', {
          order_id, username, status: 'completed', level: account.level || 0,
        });
        return { ok: true, status: 'completed', level: account.level || 0 };
      }
    }

    await antiDetect.randomDelay(1500, 3000);

    const machineId = 'levelup_' + globalIdx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    }, apiIdx);
    const token = loginData.token;
    tsLog('[' + server_username + '] ✅ 登录成功');

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

    await antiDetect.randomDelay(1000, 2000);
    const state = await apiRequest('GET', '/player/state', token, null, apiIdx);
    const player = state.player || {};
    const currentLevel = player.level || 0;
    const canLevelUp = player.can_level_up || false;
    const exp = player.exp || 0;
    const nextLevelExp = player.next_level_exp || player.max_exp || 1;
    const expPercent = nextLevelExp > 0 ? Math.floor((exp / nextLevelExp) * 100) : 0;

    // ── 检查战斗状态 ──
    const activeBattle = !!state.active_battle;
    const autoBattleOn = syncPlayer?.auto_battle_enabled;
    const restUntil = player.rest_until || 0;
    const spiritStones = player.spirit_stones || 0;
    tsLog('[' + server_username + '] 📊 Lv.' + currentLevel + ' 战斗中=' + (activeBattle ? '✅' : '❌') + ' auto=' + (autoBattleOn ? '✅' : '❌') + ' 休息到=' + (restUntil > Date.now() ? new Date(restUntil).toISOString() : '否') + ' 灵石=' + spiritStones + ' exp=' + exp + ' (' + expPercent + '%)');

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
          await antiDetect.randomDelay(800, 1500);
          try {
            const vstate = await apiRequest('GET', '/player/state', token, null, apiIdx);
            if (vstate?.player) Object.assign(player, vstate.player);
            tsLog('[' + server_username + '] ✅ 战后确认: 战斗中=' + (vstate?.active_battle ? '✅' : '❌'));
          } catch (e) {
            tsLog('[' + server_username + '] ⚠️ 战后状态确认失败: ' + e.message);
          }
        } catch (e) {
          tsLog('[' + server_username + '] ⚠️ 战斗启动失败: ' + e.message);
        }
      }
    }

    const stateTopKeys = Object.keys(state).join(',');
    const playerKeys = Object.keys(player).join(',');
    tsLog('[' + server_username + '] 🔍 state顶层字段: ' + stateTopKeys.slice(0, 200));
    tsLog('[' + server_username + '] 🔍 player字段: ' + playerKeys.slice(0, 200));
    tsLog('[' + server_username + '] 📊 起始等级=' + currentLevel + ', 经验=' + expPercent + '%, 可升级=' + canLevelUp);

    const playerName = syncPlayer.name || syncPlayer.nickname || '';
    const playerRoots = syncPlayer.spirit_roots || {};

    if (currentLevel >= MAX_LEVEL) {
      tsLog('[' + server_username + '] 🏆 已达满级');
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'completed', level: MAX_LEVEL,
        map_id: player.map_id || 0, map_name: player.map_name || '',
        character_name: playerName, spirit_roots: JSON.stringify(playerRoots),
        health_status: 'completed',
      });
      return { ok: true, level: MAX_LEVEL, completed: true };
    }

    let newLevel = currentLevel;
    let levelsGained = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const upRes = await apiRequest('POST', '/player/level_up', token, {}, apiIdx);
        if (!upRes || !upRes.player || !upRes.player.level) break;
        newLevel = upRes.player.level;
        levelsGained++;
        tsLog('[' + server_username + '] ⬆️ 升级! Lv.' + newLevel);

        if (newLevel >= MAX_LEVEL) {
          tsLog('[' + server_username + '] 🏆 到达满级 120!');
          break;
        }
        await antiDetect.randomDelay(400, 800);
      } catch (e) {
        if (e.message.includes('经验不足') || e.message.includes('exp') || e.message.includes('等级')) {
          tsLog('[' + server_username + '] 经验不足，无法升级');
        } else {
          tsLog('[' + server_username + '] 升级中断: ' + e.message);
        }
        break;
      }
    }

    if (newLevel >= 100 && newLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {}, apiIdx);
        tsLog('[' + server_username + '] 🔓 突破尝试');
        await antiDetect.randomDelay(1000, 2000);
      } catch (e) {
        tsLog('[' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    let finalLevel = newLevel;
    let finalPlayer = player;
    try {
      const st3 = await apiRequest('GET', '/player/state', token, null, apiIdx);
      finalLevel = st3.player?.level || newLevel;
      finalPlayer = st3.player || player;
    } catch (e) {
      tsLog('[' + server_username + '] ⚠️ 最终状态获取失败: ' + e.message);
    }

    const isCompleted = finalLevel >= MAX_LEVEL;
    const reportStatus = isCompleted ? 'completed' : 'farming';

    const finalExp = finalPlayer.exp || 0;
    const finalNextExp = finalPlayer.next_level_exp || finalPlayer.max_exp || 1;
    const finalExpPercent = finalNextExp > 0 ? Math.floor((finalExp / finalNextExp) * 100) : 0;

    const equippedSkills = finalPlayer.equipped_skills || [];
    const equippedWeapon = finalPlayer.equipment?.weapon || null;
    const equippedTechnique = finalPlayer.equipped_technique || null;
    const skillList = Array.isArray(equippedSkills) ? equippedSkills.map(s =>
      typeof s === 'object' ? { id: s.id, name: s.name } : { id: s, name: String(s) }
    ) : [];
    const techList = equippedTechnique ? [{ id: equippedTechnique.id || 1, name: equippedTechnique.name || '吐纳法' }] : [];
    const equipList = equippedWeapon ? [{ name: equippedWeapon.name || '铁剑' }] : [];
    const charName = playerName || account.character_name || server_username;

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username, status: reportStatus, level: finalLevel,
      map_id: finalPlayer.map_id || player.map_id || 0,
      map_name: finalPlayer.map_name || player.map_name || '荒石村',
      character_name: charName,
      spirit_roots: JSON.stringify(playerRoots),
      skills: skillList, techniques: techList, equipment: equipList,
      exp: finalExp, exp_percent: finalExpPercent,
      health_status: isCompleted ? 'completed' : 'ok',
      setup_status: account.setup_status && account.setup_status !== 'pending' ? account.setup_status : '',
    });

    collectLog({
      order_id, account_id: id, log_type: isCompleted ? 'levelup_completed' : 'levelup_report',
      message: isCompleted
        ? '🎉 从 Lv.' + currentLevel + ' 升到满级 Lv.' + finalLevel + '（+' + levelsGained + '级）'
        : '📈 Lv.' + currentLevel + ' → Lv.' + finalLevel + '（+' + levelsGained + '级）',
      raw_output: JSON.stringify({ from_level: currentLevel, to_level: finalLevel, levelsGained, expPercent: finalExpPercent }),
    });

    if (isCompleted) {
      tsLog('[' + server_username + '] 🎉 已满级，2 天后停止监控');
    } else {
      tsLog('[' + server_username + '] 📈 当前等级=' + finalLevel + '/' + MAX_LEVEL + (levelsGained > 0 ? ' (+' + levelsGained + ')' : ''));
    }

    return { ok: true, level: finalLevel, completed: isCompleted };
  } catch (e) {
    const errMsg = e.message || '';
    tsLog('[' + (server_username || '?') + '] ❌ 失败: ' + errMsg);
    try {
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'error', level: account.level || 0,
        error_msg: errMsg, health_status: 'error',
      });
      collectLog({
        order_id, account_id: id, log_type: 'levelup_error',
        message: '升级失败: ' + errMsg,
        raw_output: errMsg,
      });
    } catch (e2) {
      tsLog('[' + server_username + '] ⚠️ 错误上报失败: ' + e2.message);
    }
    return { ok: false, error: errMsg };
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔工单系统 - 一键升级 (并发版)');
  console.log('  时间: ' + new Date().toISOString());
  console.log('  目标等级: ' + MAX_LEVEL);
  console.log('  并发数: ' + CONCURRENCY);
  console.log('═══════════════════════════════════════');

  tsLog('获取 farming 账号列表...');
  const data = await workerApi('/api/gh/active-accounts');
  if (!data.ok || !data.accounts || !data.accounts.length) {
    tsLog('没有活跃账号');
    return;
  }

  const accounts = data.accounts;
  const total = accounts.length;
  tsLog('找到 ' + total + ' 个活跃账号，全部处理\n');

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

    console.log(`\n📦 批次 ${batch + 1}/${totalBatches} (账号 ${start + 1}-${end}/${total})`);

    const tasks = batchAccounts.map((acc, offset) => {
      const globalIdx = start + offset;
      const orderId = acc && acc.order_id;
      const delay = offset * (2000 + Math.floor(Math.random() * 2000));
      return sleep(delay).then(() => {
        console.log('──── [' + (globalIdx + 1) + '/' + total + '] ' + (acc.server_username || acc.username) + ' ────');
        return levelUpAccount(acc, globalIdx).then(function(r) { r._orderId = orderId; return r; });
      });
    });

    const results = await Promise.allSettled(tasks);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const res = result.value;
        if (res.ok && !res.skipped) {
          if (res.level > 0) leveled++;
          if (res.completed) completed++;
        }
        if (!res.ok) failed++;
        if (res && res._orderId) processedOrders.add(res._orderId);
      } else {
        failed++;
      }
    }

    if (batch < totalBatches - 1) {
      await antiDetect.smartPause((batch + 1) * CONCURRENCY, 999, 8 + Math.floor(Math.random() * 5));
      const interBatchDelay = 3000 + Math.floor(Math.random() * 4000);
      console.log(`  批次间等待 ${Math.round(interBatchDelay / 1000)}s...`);
      await sleep(interBatchDelay);
    }
  }

  if (processedOrders.size > 0) {
    tsLog('检查 ' + processedOrders.size + ' 个工单完成状态...');
    for (const oid of processedOrders) {
      if (!oid) continue;
      try {
        const res = await workerApi('/api/gh/complete-order', 'POST', { order_id: oid });
        if (res.ok && res.status === 'completed') {
          tsLog('✅ 工单 #' + oid + ' 已完成');
        } else if (res.ok && res.status === 'processing') {
          tsLog('▶️ 工单 #' + oid + ' 已进入挂机阶段');
        } else {
          tsLog('⏳ 工单 #' + oid + ': ' + (res.message || '等待中'));
        }
      } catch (e) {
        tsLog('⚠️ 工单 #' + oid + ' 推进失败: ' + e.message);
      }
    }
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  一键升级完成 ✓');
  console.log('  本轮: ' + total + ' | 升级: ' + leveled + ' | 满级: ' + completed + ' | 失败: ' + failed);
  console.log('  并发数: ' + CONCURRENCY);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  tsLog('❌ 致命错误: ' + e.message);
  process.exit(1);
});
