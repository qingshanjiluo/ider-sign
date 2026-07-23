/**
 * 艾德尔工单系统 - 账号健康检测 + 自动维护
 * 扫描所有进行中的账号：
 *   - 自动升级到最高级(120)
 *   - 检查并修复技能/装备/功法/战斗状态
 *   - 到达120级后2天停止监控
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
const antiDetect = require('./_anti_detect');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const MAX_LEVEL = 120;

// 启动前验证关键环境变量
const REQUIRED_ENV = { WORKER_URL, API_KEY, API_BASE, SIGN_KEY };
for (const [name, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) {
    console.error(`错误: 环境变量 ${name} 未设置`);
    process.exit(1);
  }
}
console.log('[配置] WORKER_URL=' + WORKER_URL);
console.log('[配置] API_BASE=' + API_BASE);
console.log('[配置] CLIENT_VERSION=' + CLIENT_VERSION);

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

/**
 * 自动维护：检查并修复账号的技能/装备/功法/战斗状态
 * 参照 batch.js 的完整配置流程
 */
async function autoMaintain(username, token, player) {
  const fixes = [];

  // ── 检查技能装备 ──
  const equippedSkills = player?.equipped_skills || [];
  if (equippedSkills.length < 3) {
    console.log('  [' + username + '] 🔧 技能不足(' + equippedSkills.length + '/3)，尝试补装...');
    const starterSkills = [
      { id: 1, name: '重击' },
      { id: 2, name: '火球术' },
      { id: 3, name: '治疗术' },
    ];
    for (const sk of starterSkills) {
      try {
        await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
        fixes.push('技能+' + sk.name);
        await sleep(300);
      } catch (e) {
        // 已装备或不可用，忽略
      }
    }
  }

  // ── 检查功法 ──
  const equippedTechnique = player?.equipped_technique || player?.technique;
  if (!equippedTechnique) {
    console.log('  [' + username + '] 🔧 功法未设置，尝试装备吐纳法...');
    try {
      await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
      fixes.push('功法+吐纳法');
    } catch (e) {
      // 忽略
    }
  }

  // ── 检查铁剑 ──
  const equippedWeapon = player?.equipment?.weapon || player?.equipment?.['0'];
  if (!equippedWeapon) {
    console.log('  [' + username + '] 🔧 武器栏为空，尝试装备铁剑...');
    try {
      const sync = await apiRequest('GET', '/player/sync', token);
      const inv = sync?.player?.inventory || [];
      for (let p = 0; p < inv.length; p++) {
        if (!inv[p]) continue;
        for (let s = 0; s < inv[p].length; s++) {
          const slot = inv[p][s];
          if (slot?.item && String(slot.item.name || '').includes('铁剑')) {
            await apiRequest('POST', '/player/equip', token, {
              page: p, slot_index: s, expect_item_id: Number(slot.item.id) || 0,
            });
            fixes.push('装备+铁剑');
            break;
          }
        }
        if (fixes.some(f => f.includes('铁剑'))) break;
      }
    } catch (e) {
      // 忽略
    }
  }

  // ── 检查战斗状态 ──
  const isBattling = player?.is_battling || player?.battle_active || false;
  if (!isBattling) {
    console.log('  [' + username + '] 🔧 未在战斗，尝试启动...');
    try {
      const mapId = player?.map_id || 1;
      await apiRequest('POST', '/battle/start', token, { mapId, poll_mode: false, auto_restart: false });
      await sleep(500);
      await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: mapId });
      fixes.push('战斗+自动刷怪');
    } catch (e) {
      // 忽略
    }
  }

  if (fixes.length > 0) {
    console.log('  [' + username + '] ✅ 自动修复: ' + fixes.join(', '));
  }
  return fixes;
}

async function workerApi(path, method = 'GET', body = null) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const url = WORKER_URL.replace(/\/+$/, '') + path;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
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

    // 自动维护：检查技能/装备/功法/战斗状态
    const syncResult = await apiRequest('GET', '/player/sync', token);
    const syncPlayer = syncResult?.player || {};
    await autoMaintain(server_username, token, syncPlayer);

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
  const processedOrders = new Set();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log('──── [' + (i + 1) + '/' + total + '] ' + (account.server_username || account.username) + ' ────');

    const result = await checkAndLevelUp(account, i);
    if (result.ok && result.completed) completed++;
    if (!result.ok) failed++;
    processedOrders.add(account.order_id);

    await antiDetect.smartPause(i, 5, 20);
    await antiDetect.randomDelay(3000);
  }

  // 推进已处理工单的状态（账号满级后自动完成工单）
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
  console.log('  健康检测完成 ✓');
  console.log('  总计: ' + total + ' | 到达满级: ' + completed + ' | 失败: ' + failed);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误:', e.message);
  process.exit(1);
});
