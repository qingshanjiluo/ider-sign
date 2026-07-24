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

function tsLog(msg) {
  const now = new Date();
  const t = now.toLocaleString('zh-CN', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

/**
 * 自动维护：检查并修复账号的技能/装备/功法/战斗状态
 * 参照 scan_orders.js 的 setup 流程，每次修复后反检测延迟 + 验证
 */
async function autoMaintain(username, token, player) {
  const fixes = [];

  // 调试: 打印玩家关键字段，了解数据结构
  const keys = Object.keys(player).filter(k => typeof player[k] !== 'object' || player[k] === null)
    .concat(Object.keys(player).filter(k => typeof player[k] === 'object' && player[k] !== null)
      .map(k => k + ':(' + (Array.isArray(player[k]) ? 'array[' + player[k].length + ']' : typeof player[k]) + ')'))
    .join(', ');
  if (player && Object.keys(player).length > 0) {
    tsLog('[' + username + '] 📋 玩家数据字段: ' + keys.slice(0, 300));
  } else {
    tsLog('[' + username + '] ⚠️ 玩家数据为空');
  }

  // ── 检查技能装备 ──
  // 尝试多种字段名兼容不同版本的玩家数据格式
  const equippedSkills = player?.equipped_skills || player?.skills || player?.skill_list || (player?.key_skill_id ? [player.key_skill_id] : []);
  const equippedSkillCount = Array.isArray(equippedSkills) ? equippedSkills.length
    : (typeof equippedSkills === 'object' ? Object.keys(equippedSkills).length : (equippedSkills ? 1 : 0));
  if (equippedSkillCount < 3) {
    tsLog('[' + username + '] 🔧 技能不足(' + equippedSkillCount + '/3)，尝试补装...');
    const starterSkills = [
      { id: 1, name: '重击' },
      { id: 2, name: '火球术' },
      { id: 3, name: '治疗术' },
    ];
    for (const sk of starterSkills) {
      try {
        await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
        fixes.push('技能+' + sk.name);
        tsLog('[' + username + '] ✅ 技能装备成功: ' + sk.name);
        await antiDetect.randomDelay(800, 1500);
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 技能装备失败(' + sk.name + '): ' + e.message);
      }
    }
  }

  // ── 检查功法 ──
  const equippedTechnique = player?.equipped_technique || player?.technique
    || player?.main_technique || player?.technique_id;
  if (!equippedTechnique || equippedTechnique === 0) {
    tsLog('[' + username + '] 🔧 功法未设置，尝试装备吐纳法...');
    try {
      await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
      fixes.push('功法+吐纳法');
      tsLog('[' + username + '] ✅ 功法设置成功');
      await antiDetect.randomDelay(800, 1500);
    } catch (e) {
      tsLog('[' + username + '] ⚠️ 功法设置失败: ' + e.message);
    }
  }

  // ── 检查铁剑 ──
  const equippedWeapon = player?.equipment?.weapon || player?.equipment?.['0']
    || player?.weapon || player?.main_hand;
  if (!equippedWeapon) {
    tsLog('[' + username + '] 🔧 武器栏为空，尝试装备铁剑...');
    try {
      const sync = await apiRequest('GET', '/player/sync', token);
      const inv = sync?.player?.inventory || sync?.inventory || [];
      let found = false;
      for (let p = 0; p < inv.length && !found; p++) {
        if (!inv[p]) continue;
        const page = Array.isArray(inv[p]) ? inv[p] : (typeof inv[p] === 'object' ? Object.values(inv[p]) : []);
        for (let s = 0; s < page.length; s++) {
          const slot = page[s];
          if (!slot) continue;
          const item = slot.item || slot;
          const itemName = item.name || item.item_name || item.itemName || '';
          if (String(itemName).includes('铁剑')) {
            await apiRequest('POST', '/player/equip', token, {
              page: p, slot_index: s, expect_item_id: Number(item.id || item.item_id || 0) || 0,
            });
            fixes.push('装备+铁剑');
            found = true;
            tsLog('[' + username + '] ✅ 铁剑装备成功');
            await antiDetect.randomDelay(800, 1500);
            break;
          }
        }
      }
      if (!found) tsLog('[' + username + '] ⚠️ 背包中未找到铁剑');
    } catch (e) {
      tsLog('[' + username + '] ⚠️ 铁剑装备失败: ' + e.message);
    }
  }

  // ── 检查战斗状态 ──
  const isBattling = player?.is_battling || player?.battle_active
    || player?.in_battle || player?.fighting || player?.current_map_id > 1 || false;
  if (!isBattling) {
    tsLog('[' + username + '] 🔧 未在战斗，尝试启动...');
    try {
      const mapId = player?.map_id || 1;
      await apiRequest('POST', '/battle/start', token, { mapId, poll_mode: false, auto_restart: false });
      tsLog('[' + username + '] ✅ 战斗已启动');
      await sleep(800);
      await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: mapId });
      tsLog('[' + username + '] ✅ 自动刷怪已开启');
      fixes.push('战斗+自动刷怪');
      await antiDetect.randomDelay(800, 1500);
    } catch (e) {
      tsLog('[' + username + '] ⚠️ 战斗启动失败: ' + e.message);
    }
  }

  // ── 最终验证：重新获取玩家数据，确认修复结果 ──
  try {
    // 使用与检测时相同的 /player/sync 端点，确保字段名一致
    const verify = await apiRequest('GET', '/player/sync', token);
    const vp = verify?.player || {};
    // 兼容多种字段名
    const vSkills = vp.equipped_skills || vp.skills || vp.skill_list || vp.key_skill_id ? [vp.key_skill_id] : [];
    const vSkillCount = Array.isArray(vSkills) ? vSkills.length
      : (typeof vSkills === 'object' ? Object.keys(vSkills).length : (vSkills ? 1 : 0));
    const vTech = vp.equipped_technique || vp.technique || vp.main_technique || vp.technique_id || vp.technique_name;
    const vWeapon = vp.equipment?.weapon || vp.equipment?.['0'] || vp.weapon || vp.main_hand || vp.weapon_name;
    const vBattle = vp.is_battling || vp.battle_active || vp.in_battle || vp.fighting || vp.current_map_id > 1;

    const remaining = [];
    if (vSkillCount < 3 && !vSkills) remaining.push('技能(' + vSkillCount + '/3)');
    if (!vTech) remaining.push('功法');
    if (!vWeapon) remaining.push('铁剑');
    if (!vBattle) remaining.push('战斗');

    if (remaining.length > 0) {
      if (fixes.length > 0) {
        tsLog('[' + username + '] ⚠️ 部分修复已应用但验证不一致: ' + remaining.join(', ') + ' | 已修复: ' + fixes.join(', '));
      } else {
        tsLog('[' + username + '] ⚠️ 仍有未修复: ' + remaining.join(', '));
      }
    } else if (fixes.length > 0) {
      tsLog('[' + username + '] ✅ 全部修复确认: ' + fixes.join(', '));
    }
  } catch (e) {
    tsLog('[' + username + '] ⚠️ 验证状态失败: ' + e.message);
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
    tsLog('[' + (username || '?') + '] ⏭️ 无账号密码，跳过');
    return { ok: false, error: '无账号密码' };
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

    await antiDetect.randomDelay(2000);

    const machineId = 'health_' + idx + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    });
    const token = loginData.token;
    tsLog('[' + server_username + '] ✅ 登录成功');
    await antiDetect.randomDelay(1500);

    // 获取完整玩家数据
    let syncPlayer = {};
    let playerName = '';
    let playerRoots = {};
    try {
      const syncResult = await apiRequest('GET', '/player/sync', token);
      syncPlayer = syncResult?.player || {};
      playerName = syncPlayer.name || syncPlayer.nickname || syncPlayer.character_name || '';
      playerRoots = syncPlayer.spirit_roots || {};
    } catch (e) {}

    // 自动维护
    const fixes = await autoMaintain(server_username, token, syncPlayer);

    // 获取玩家状态
    const state = await apiRequest('GET', '/player/state', token);
    const player = state.player || {};
    const level = player.level || 0;
    const canLevelUp = player.can_level_up || false;
    const exp = player.exp || 0;
    const nextLevelExp = player.next_level_exp || 1;
    const expPercent = Math.floor((exp / nextLevelExp) * 100);

    // DEBUG: dump raw state keys
    tsLog('[' + server_username + '] 🔍 state顶层: ' + Object.keys(state).join(','));
    tsLog('[' + server_username + '] 🔍 player键: ' + Object.keys(player).join(','));
    tsLog('[' + server_username + '] 🔍 can_level_up原文=' + JSON.stringify(state.can_level_up) + ' player.can=' + JSON.stringify(player.can_level_up));
    // 即使can_level_up=false也强制试一次level_up，看服务端返回什么错误
    try {
      const forcedUp = await apiRequest('POST', '/player/level_up', token, {});
      tsLog('[' + server_username + '] ⬆️ 强制升级成功: ' + JSON.stringify(forcedUp).slice(0,200));
    } catch (e) {
      tsLog('[' + server_username + '] 🔍 升级被拒: ' + (e.message || '').slice(0,300));
    }

    tsLog('[' + server_username + '] 📊 等级=' + level + ', 经验=' + expPercent + '%, 可升级=' + canLevelUp);

    // 上报登录日志
    await workerApi('/api/gh/report-log', 'POST', {
      order_id, log_type: 'health_login',
      message: '健康检测: Lv.' + level + ' 经验' + expPercent + '%' + (fixes.length ? ' 修复:' + fixes.join(',') : ''),
      raw_output: JSON.stringify({ level, exp, expPercent, canLevelUp, fixes }),
    });

    // 升级循环
    let currentLevel = level;
    let levelsGained = 0;
    if (canLevelUp) {
      for (let i = 0; i < 30; i++) {
        try {
          await apiRequest('POST', '/player/level_up', token, {});
          currentLevel++;
          levelsGained++;
          tsLog('[' + server_username + '] ⬆️ 升级! Lv.' + currentLevel);
          await antiDetect.randomDelay(800);

          if (currentLevel >= MAX_LEVEL) {
            tsLog('[' + server_username + '] 🏆 到达满级120!');
            break;
          }

          const state2 = await apiRequest('GET', '/player/state', token);
          if (!state2.player?.can_level_up) {
            tsLog('[' + server_username + '] 经验不足，停止升级');
            break;
          }
        } catch (e) {
          tsLog('[' + server_username + '] 升级中断: ' + e.message);
          break;
        }
      }
    }

    // 突破
    if (currentLevel >= 100 && currentLevel < MAX_LEVEL) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {});
        tsLog('[' + server_username + '] 🔓 突破尝试');
        await antiDetect.randomDelay(1500);
      } catch (e) {
        tsLog('[' + server_username + '] 突破跳过: ' + e.message);
      }
    }

    // 获取最终等级和完整状态
    let finalLevel = currentLevel;
    let finalPlayer = player;
    try {
      const state3 = await apiRequest('GET', '/player/state', token);
      finalLevel = state3.player?.level || currentLevel;
      finalPlayer = state3.player || player;
    } catch (e) {}

    const isCompleted = finalLevel >= MAX_LEVEL;
    const reportStatus = isCompleted ? 'completed' : 'farming';

    // 收集完整装备/技能信息
    const equippedSkills = finalPlayer.equipped_skills || syncPlayer.equipped_skills || [];
    const equippedWeapon = finalPlayer.equipment?.weapon || finalPlayer.equipment?.['0'] || null;
    const equippedTechnique = finalPlayer.equipped_technique || finalPlayer.technique || null;

    const skillList = Array.isArray(equippedSkills) ? equippedSkills.map(s =>
      typeof s === 'object' ? { id: s.id, name: s.name } : { id: s, name: String(s) }
    ) : [];
    const techList = equippedTechnique ? [{ id: equippedTechnique.id || 1, name: equippedTechnique.name || '吐纳法' }] : [];
    const equipList = equippedWeapon ? [{ name: equippedWeapon.name || '铁剑' }] : [];

    const charName = playerName || account.character_name || server_username;
    const rootsStr = Object.keys(playerRoots).length ? JSON.stringify(playerRoots) : null;

    await workerApi('/api/gh/report-health', 'POST', {
      order_id, username,
      status: reportStatus,
      level: finalLevel,
      map_id: player.map_id || finalPlayer.map_id || 0,
      map_name: player.map_name || finalPlayer.map_name || '荒石村',
      character_name: charName,
      spirit_roots: rootsStr,
      skills: skillList,
      techniques: techList,
      equipment: equipList,
      exp: finalPlayer.exp || 0,
      exp_percent: expPercent,
      health_status: isCompleted ? 'completed' : 'ok',
      setup_status: account.setup_status || 'farming',
    });

    // 记录详细日志
    await workerApi('/api/gh/report-log', 'POST', {
      order_id, log_type: isCompleted ? 'health_completed' : 'health_report',
      message: isCompleted
        ? '🎉 满级120! 共升级' + levelsGained + '级'
        : '📈 Lv.' + finalLevel + '/' + MAX_LEVEL + ' 经验' + expPercent + '% 升级' + levelsGained + '级',
      raw_output: JSON.stringify({
        level: finalLevel, exp: finalPlayer.exp, expPercent,
        levelsGained, fixes, skills: skillList.length,
      }),
    });

    if (isCompleted) {
      tsLog('[' + server_username + '] 🎉 已完成120级，2天后停止监控');
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
      await workerApi('/api/gh/report-log', 'POST', {
        order_id, log_type: 'health_error',
        message: '健康检测失败: ' + errMsg,
        raw_output: errMsg,
      });
    } catch (e2) {}

    return { ok: false, error: errMsg };
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
  let total = accounts.length;
  let leveled = 0;
  const processedOrders = new Set();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log('──── [' + (i + 1) + '/' + total + '] ' + (account.server_username || account.username) + ' ────');

    const result = await checkAndLevelUp(account, i);
    if (result.ok && result.completed) completed++;
    if (result.ok && result.level > (account.level || 0)) leveled++;
    if (!result.ok) failed++;
    processedOrders.add(account.order_id);

    await antiDetect.smartPause(i, 5, 20);
    await antiDetect.randomDelay(3000);
  }

  // 推进工单
  if (processedOrders.size > 0) {
    tsLog('检查 ' + processedOrders.size + ' 个工单完成状态...');
    for (const oid of processedOrders) {
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

  console.log('\n═══════════════════════════════════════');
  console.log('  健康检测完成 ✓');
  console.log('  总计: ' + total + ' | 升级: ' + leveled + ' | 满级: ' + completed + ' | 失败: ' + failed);
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  tsLog('❌ 致命错误: ' + e.message);
  process.exit(1);
});
