/**
 * 艾德尔工单系统 - 账号健康检测 + 自动维护 v3
 * 扫描所有进行中的账号：
 *   - 自动升级到最高级(120)
 *   - 检查并修复技能/装备/功法/战斗状态
 *   - 到达120级后2天停止监控
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

for (const [n, v] of Object.entries({ WORKER_URL, API_KEY, API_BASE, SIGN_KEY })) {
  if (!v) { console.error('错误: 环境变量 ' + n + ' 未设置'); process.exit(1); }
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
 * 自动维护：基于 /player/sync 的完整数据修复技能/功法/装备/战斗
 * 参考 scan_orders.js registerAndSetup 的流程
 */
async function autoMaintain(username, token, syncPlayer) {
  const fixes = [];

  // ── 检查技能 ──
  const equippedSkills = syncPlayer?.equipped_skills || [];
  if (!Array.isArray(equippedSkills) || equippedSkills.length < 3) {
    const skillNames = { 1: '重击', 2: '火球术', 3: '治疗术' };
    for (const [id, name] of Object.entries(skillNames)) {
      try {
        await apiRequest('POST', '/player/equip_skill', token, { skill_id: Number(id) });
        fixes.push('技能+' + name);
        await antiDetect.randomDelay(500, 1000);
      } catch (e) {
        if (e.message.includes('已装备')) continue;
        tsLog('[' + username + '] ⚠️ 装备技能失败: ' + e.message);
      }
    }
  }

  // ── 检查功法 ──
  const hasTechnique = syncPlayer?.equipped_technique || syncPlayer?.technique
    || syncPlayer?.main_technique || syncPlayer?.technique_id;
  if (!hasTechnique) {
    try {
      await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
      fixes.push('功法+吐纳法');
      await antiDetect.randomDelay(500, 1000);
    } catch (e) { tsLog('[' + username + '] ⚠️ 装备功法失败: ' + e.message); }
  }

  // ── 检查武器（铁剑） ──
  const weapon = syncPlayer?.equipment?.weapon || syncPlayer?.weapon || syncPlayer?.main_hand;
  if (!weapon) {
    const inv = syncPlayer?.inventory || [];
    let found = false;
    for (let p = 0; p < inv.length && !found; p++) {
      const page = Array.isArray(inv[p]) ? inv[p] : (typeof inv[p] === 'object' ? Object.values(inv[p]) : []);
      for (let s = 0; s < page.length; s++) {
        const slot = page[s];
        if (!slot) continue;
        const item = slot.item || slot;
        if (String(item.name || item.item_name || '').includes('铁剑')) {
          try {
            await apiRequest('POST', '/player/equip', token, {
              page: p, slot_index: s, expect_item_id: Number(item.id || item.item_id || 0),
            });
              fixes.push('装备+铁剑');
              found = true;
              await antiDetect.randomDelay(500, 1000);
            } catch (e) {
              tsLog('[' + username + '] ⚠️ 装备武器失败: ' + e.message);
            }
            break;
        }
      }
    }
  }

  // ── 检查战斗状态 ──
  const autoBattleOn = syncPlayer?.auto_battle_enabled;
  const restUntil = syncPlayer?.rest_until || 0;
  if (restUntil > Date.now()) {
    tsLog('[' + username + '] ⏳ 正在休息中(rest_until=' + new Date(restUntil).toISOString() + ')，跳过战斗');
  } else if (!autoBattleOn) {
    try {
      const mapId = syncPlayer?.current_map_id || 1;
      await apiRequest('POST', '/battle/start', token, { mapId, poll_mode: false, auto_restart: false });
      await sleep(500);
      await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: mapId });
      fixes.push('战斗+自动刷怪');
      await antiDetect.randomDelay(500, 1000);
      try {
        const vstate = await apiRequest('GET', '/player/state', token);
        tsLog('[' + username + '] ✅ 战斗启动确认: 战斗中=' + (vstate?.active_battle ? '✅' : '❌'));
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 战斗状态验证失败: ' + e.message);
      }
    } catch (e) {
      tsLog('[' + username + '] ⚠️ 战斗启动失败: ' + e.message);
    }
  } else {
    try {
      const state = await apiRequest('GET', '/player/state', token);
      if (!state.active_battle) {
        tsLog('[' + username + '] 🔧 auto_battle已开但未战斗中，尝试重启');
        const mapId = syncPlayer?.current_map_id || 1;
        await apiRequest('POST', '/battle/start', token, { mapId, poll_mode: false, auto_restart: false });
        await sleep(500);
        await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: mapId });
        fixes.push('战斗重启');
        await antiDetect.randomDelay(500, 1000);
        try {
          const vstate = await apiRequest('GET', '/player/state', token);
          tsLog('[' + username + '] ✅ 战斗重启确认: 战斗中=' + (vstate?.active_battle ? '✅' : '❌'));
        } catch (e) {
          tsLog('[' + username + '] ⚠️ 战斗重启验证失败: ' + e.message);
        }
      }
    } catch (e) {
      tsLog('[' + username + '] ⚠️ 战斗状态检查失败: ' + e.message);
    }
  }

  return fixes;
}

async function checkAndLevelUp(account, idx) {
  setApiIdx(idx * 10);

  const { id, server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) {
    tsLog('[' + (username || '?') + '] ⏭️ 无账号密码');
    return { ok: false, error: '无账号密码' };
  }

  tsLog('[' + server_username + '] 检查中...');

  try {
    if (account.stop_monitor_at) {
      const stopTime = new Date(account.stop_monitor_at).getTime();
      if (Date.now() > stopTime) {
        tsLog('[' + server_username + '] ⏹️ 超过监控期');
        await workerApi('/api/gh/report-account', 'POST', {
          order_id, username, status: 'completed', level: account.level || 0,
        });
        return { ok: true, status: 'completed' };
      }
    }

    await antiDetect.randomDelay(1500);

    const machineId = 'health_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    });
    const token = loginData.token;
    tsLog('[' + server_username + '] ✅ 登录成功');

    // ── 确保角色存在（无角色则自动创建） ──
    const charResult = await ensureCharacter(apiRequest, token, server_username);
    if (!charResult.ok) {
      tsLog('[' + server_username + '] ⚠️ 角色检查失败: ' + charResult.error);
    }
    if (charResult.created) {
      tsLog('[' + server_username + '] ✅ 角色创建成功: ' + (charResult.createdName || ''));
    }
    const syncPlayer = charResult.player || {};
    const playerName = syncPlayer.name || syncPlayer.nickname || '';
    const playerRoots = syncPlayer.spirit_roots || {};

    // 自动维护：修复技能/功法/装备/战斗
    const fixes = await autoMaintain(server_username, token, syncPlayer);

    // 用 /player/state 获取战斗状态和升级信息
    const state = await apiRequest('GET', '/player/state', token);
    const player = state.player || {};
    const startLevel = player.level || 0;
    const exp = player.exp || 0;
    const nextExp = player.next_level_exp || player.max_exp || 1;
    const expPercent = nextExp > 0 ? Math.floor((exp / nextExp) * 100) : 0;
    const activeBattle = !!state.active_battle;

    tsLog('[' + server_username + '] 📊 Lv.' + startLevel + ' 经验' + expPercent + '% 战斗中=' + activeBattle);
    if (fixes.length) tsLog('[' + server_username + '] ✅ 修复: ' + fixes.join(', '));

    // 升级循环
    let currentLevel = startLevel;
    let levelsGained = 0;
    for (let i = 0; i < 100; i++) {
      try {
        const upRes = await apiRequest('POST', '/player/level_up', token, {});
        if (!upRes || !upRes.player || !upRes.player.level) break;
        currentLevel = upRes.player.level;
        levelsGained++;
        if (currentLevel >= MAX_LEVEL) break;
        await antiDetect.randomDelay(400);
      } catch (e) {
        if (e.message.includes('经验不足') || e.message.includes('exp')) break;
        tsLog('[' + server_username + '] 升级中断: ' + e.message.slice(0, 60));
        break;
      }
    }

    // 突破
    if (currentLevel >= 100 && currentLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {});
        await antiDetect.randomDelay(1000);
      } catch (e) {
        tsLog('[' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    // 最终状态
    let finalLevel = currentLevel;
    let finalPlayer = player;
    try {
      const st3 = await apiRequest('GET', '/player/state', token);
      finalLevel = st3.player?.level || currentLevel;
      finalPlayer = st3.player || player;
    } catch (e) {
      tsLog('[' + server_username + '] ⚠️ 最终状态获取失败: ' + e.message);
    }

    const isCompleted = finalLevel >= MAX_LEVEL;
    const gained = levelsGained > 0 ? ' +' + levelsGained + '级' : '';
    tsLog('[' + server_username + '] 📈 Lv.' + startLevel + ' → Lv.' + finalLevel + gained);

    // 收集上报数据
    const charName = playerName || account.character_name || server_username;
    const rootsStr = Object.keys(playerRoots).length ? JSON.stringify(playerRoots) : null;

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username,
      status: isCompleted ? 'completed' : 'farming',
      level: finalLevel,
      map_id: finalPlayer.current_map_id || syncPlayer.current_map_id || 0,
      character_name: charName,
      spirit_roots: rootsStr,
      exp: finalPlayer.exp || exp,
      exp_percent: finalPlayer.next_level_exp
        ? Math.floor(((finalPlayer.exp || 0) / finalPlayer.next_level_exp) * 100)
        : expPercent,
      health_status: isCompleted ? 'completed' : 'ok',
      setup_status: account.setup_status && account.setup_status !== 'pending' ? account.setup_status : '',
    });

    collectLog({
      order_id, account_id: id,
      log_type: isCompleted ? 'health_completed' : 'health_report',
      message: isCompleted
        ? '🎉 从 Lv.' + startLevel + ' 升到满级 Lv.' + finalLevel + '（+' + levelsGained + '级）'
        : '📈 Lv.' + startLevel + ' → Lv.' + finalLevel + gained,
    });

    return { ok: true, level: finalLevel, completed: isCompleted, gained: levelsGained };
  } catch (e) {
    tsLog('[' + (server_username || '?') + '] ❌ 失败: ' + (e.message || '').slice(0, 100));
    try {
      await workerApi('/api/gh/report-health', 'POST', {
        order_id, username, status: 'error', level: account.level || 0,
        error_msg: e.message || '', health_status: 'error',
      });
    } catch (e2) {
      tsLog('[' + (server_username || '?') + '] ⚠️ 错误上报失败: ' + e2.message);
    }
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔工单系统 - 账号健康检测 v3');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════');

  tsLog('获取活跃账号列表...');
  const data = await workerApi('/api/gh/active-accounts');
  if (!data.ok || !data.accounts || !data.accounts.length) {
    tsLog('没有活跃账号');
    return;
  }

  const accounts = data.accounts;
  tsLog('找到 ' + accounts.length + ' 个活跃账号\n');

  let completed = 0;
  let failed = 0;
  let leveled = 0;
  const processedOrders = new Set();

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log('──── [' + (i + 1) + '/' + accounts.length + '] ' + (acc.server_username || acc.username) + ' ────');

    const result = await checkAndLevelUp(acc, i);
    if (result.ok && result.completed) completed++;
    if (result.ok && result.gained > 0) leveled++;
    if (!result.ok) failed++;
    processedOrders.add(acc.order_id);

    await antiDetect.smartPause(i, 5, 8);
    await antiDetect.randomDelay(1500);
  }

  if (processedOrders.size > 0) {
    tsLog('检查 ' + processedOrders.size + ' 个工单完成状态...');
    for (const oid of processedOrders) {
      try {
        const res = await workerApi('/api/gh/complete-order', 'POST', { order_id: oid });
        if (res.ok) tsLog('✅ 工单 #' + oid + ': ' + (res.message || res.status || 'ok'));
      } catch (e) {
        tsLog('⚠️ 工单 #' + oid + ' 推进失败: ' + e.message);
      }
    }
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  健康检测完成 ✓');
  console.log('  总计: ' + accounts.length + ' | 升级: ' + leveled + ' | 满级: ' + completed + ' | 失败: ' + failed);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  tsLog('❌ 致命错误: ' + e.message);
  process.exit(1);
});
