/**
 * 艾德尔工单系统 - GitHub Actions 订单扫描器
 * 扫描已审核通过的工单，自动注册账号并开始刷怪
 * 内置防封检测：独立IP/机器码/指纹轮换/随机延迟
 * 完整流程：注册→创建角色(金灵根100)→绑定邀请码→装备技能/功法/武器→战斗+自动刷怪
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
const antiDetect = require('./_anti_detect');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

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

async function workerApi(path, method = 'GET', body = null) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const url = WORKER_URL.replace(/\/+$/, '') + path;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return r.json();
}

/**
 * 完整注册+配置流程（参照 batch.js 的 BatchEngine.processAccount）
 * 1) 注册 → 2) 创建角色(金灵根100) → 3) 绑定邀请码 →
 * 4) 装备技能(重击/火球术/治疗术) → 5) 装备铁剑 →
 * 6) 设置功法(吐纳法) → 7) 切换地图(荒石村) → 8) 开始战斗+自动刷怪
 */
async function registerAndSetup(workerOrder, orderIdx) {
  const apiIdx = orderIdx * 30;
  setApiIdx(apiIdx);

  const username = antiDetect.randomUsername();
  const password = antiDetect.randomPassword();
  const inviteCode = workerOrder.invite_code || '';

  console.log('[' + username + '] 开始注册' + (inviteCode ? ' (邀请码: ' + inviteCode + ')' : ''));

  try {
    const machineId = antiDetect.generateMachineId(apiIdx);
    const stepDelay = () => antiDetect.randomDelay(1200, 2500);

    // ── 1) 注册账号 ──
    const regData = await apiRequest('POST', '/auth/register', '', {
      username, password, machine_id: machineId,
    });
    const token = regData.token;
    console.log('[' + username + '] ✅ 注册成功 (accountId=' + regData.accountId + ')');
    await stepDelay();

    // 上报 Worker：账号已创建
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password,
      server_username: username, server_password: password,
      status: 'creating',
    });

    // ── 2) 创建角色（金灵根100） ──
    // 注册只创建账号，不创建角色；必须调用 /player/create
    const playerName = username.slice(0, 8);
    const createData = await apiRequest('POST', '/player/create', token, {
      name: playerName,
      spirit_roots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 },
    });
    console.log('[' + username + '] ✅ 角色创建成功: ' + (createData.player?.name || playerName) + ' (金灵根100)');
    const characterName = createData.player?.name || playerName;
    const spiritRoots = createData.player?.spirit_roots || JSON.stringify({ metal: 100, wood: 0, water: 0, fire: 0, earth: 0 });
    // 上报 Worker：角色名/灵根
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password,
      status: 'character_created',
      character_name: characterName,
      spirit_roots: typeof spiritRoots === 'string' ? spiritRoots : JSON.stringify(spiritRoots),
    });
    await stepDelay();

    // ── 3) 绑定邀请码 ──
    if (inviteCode) {
      try {
        const inviteData = await apiRequest('POST', '/invite/bind', token, { invite_code: inviteCode });
        console.log('[' + username + '] ✅ 邀请码绑定成功, 邀请人: ' + (inviteData.inviter_name || '?'));
      } catch (e) {
        console.log('[' + username + '] ⚠️ 邀请码绑定失败(可能已超12h或已绑定): ' + e.message);
      }
      await stepDelay();
    }

    // ── 4) 装备初始3个技能（重击/火球术/治疗术） ──
    const starterSkills = [
      { id: 1, name: '重击' },
      { id: 2, name: '火球术' },
      { id: 3, name: '治疗术' },
    ];
    let equippedSkills = 0;
    for (const sk of starterSkills) {
      try {
        await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
        equippedSkills++;
        console.log('[' + username + '] ✅ 技能装备: ' + sk.name);
      } catch (e) {
        if (e.message && e.message.includes('已装备')) {
          equippedSkills++;
          console.log('[' + username + '] ✅ 技能已装备: ' + sk.name);
        } else {
          console.log('[' + username + '] ⚠️ 技能跳过(' + sk.name + '): ' + e.message);
        }
      }
      await sleep(300);
    }
    console.log('[' + username + '] 技能装备完成: ' + equippedSkills + '/' + starterSkills.length);
    await stepDelay();

    // ── 5) 装备铁剑（从背包查找） ──
    // 使用 /player/sync 获取完整玩家数据（包含 inventory）
    try {
      const sync = await apiRequest('GET', '/player/sync', token);
      const inv = sync?.player?.inventory || [];
      let swordFound = false;
      for (let p = 0; p < inv.length && !swordFound; p++) {
        if (!inv[p]) continue;
        for (let s = 0; s < inv[p].length; s++) {
          const slot = inv[p][s];
          if (slot?.item && String(slot.item.name || '').includes('铁剑')) {
            await apiRequest('POST', '/player/equip', token, {
              page: p, slot_index: s, expect_item_id: Number(slot.item.id) || 0,
            });
            swordFound = true;
            console.log('[' + username + '] ✅ 铁剑装备成功');
            break;
          }
        }
      }
      if (!swordFound) {
        console.log('[' + username + '] ⚠️ 背包中未找到铁剑');
      }
    } catch (e) {
      console.log('[' + username + '] ⚠️ 装备铁剑失败: ' + e.message);
    }
    await stepDelay();

    // ── 6) 设置主功法（吐纳法 id=1） ──
    try {
      await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
      console.log('[' + username + '] ✅ 功法设置: 吐纳法');
    } catch (e) {
      console.log('[' + username + '] ⚠️ 功法跳过: ' + e.message);
    }
    await stepDelay();

    // ── 7) 切换地图到荒石村 (map_id=1) ──
    try {
      await apiRequest('POST', '/player/set_map', token, { map_id: 1 });
      console.log('[' + username + '] ✅ 切换至荒石村');
    } catch (e) {
      console.log('[' + username + '] ⚠️ 地图切换跳过: ' + e.message);
    }
    await stepDelay();

    // ── 8) 开始战斗 + 自动刷怪 ──
    try {
      await apiRequest('POST', '/battle/start', token, { mapId: 1, poll_mode: false, auto_restart: false });
      console.log('[' + username + '] ✅ 战斗已启动');
    } catch (e) {
      console.log('[' + username + '] ⚠️ 战斗启动跳过: ' + e.message);
    }
    await sleep(500);
    try {
      await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: 1 });
      console.log('[' + username + '] ✅ 自动刷怪已开启');
    } catch (e) {
      console.log('[' + username + '] ⚠️ 自动刷怪跳过: ' + e.message);
    }

    // 上报 Worker：配置完成（含角色名/灵根）
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password,
      server_username: username, server_password: password,
      status: 'farming', level: 1,
      map_id: 1, map_name: '荒石村',
      character_name: characterName,
      spirit_roots: typeof spiritRoots === 'string' ? spiritRoots : JSON.stringify(spiritRoots),
      skills: starterSkills.map(s => ({ id: s.id, name: s.name })),
      techniques: [{ id: 1, name: '吐纳法' }],
      equipment: [{ name: '铁剑' }],
      setup_status: 'farming',
    });

    return { username, password, ok: true };
  } catch (e) {
    console.log('[' + username + '] ❌ 失败: ' + e.message);
    try {
      await workerApi('/api/gh/report-account', 'POST', {
        order_id: workerOrder.id, username, password: '',
        status: 'failed', error_msg: e.message,
      });
    } catch (e2) {}
    return { username, ok: false, error: e.message };
  }
}

// ── 仙盟采集处理 ──
async function processAllianceDaily(order, orderIdx) {
  const username = order.game_account_name;
  const password = order.game_account_password;
  if (!username || !password) {
    console.log('  ❌ 缺少游戏账号信息');
    return false;
  }

  setApiIdx(orderIdx * 20);
  try {
    const machineId = antiDetect.generateMachineId(orderIdx);
    await antiDetect.randomDelay(1500);

    // 1) 登录
    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    console.log('  ✅ 登录成功');
    await antiDetect.randomDelay(1500);

    // 2) 获取角色状态
    const stateData = await apiRequest('GET', '/player/state', token);
    const player = stateData.player;
    let allianceId = player?.alliance_id || 0;

    // 3) 检查/加入仙盟
    if (!allianceId) {
      try {
        const listData = await apiRequest('GET', '/alliance/list', token);
        const alliances = listData.alliances || [];
        const target = alliances.find(a => a.name === '天地一家大爱盟' && a.member_limit > (a.member_count || 0))
          || alliances.find(a => a.member_limit > (a.member_count || 0));
        if (target) {
          await apiRequest('POST', '/alliance/apply', token, { alliance_id: target.id });
          console.log('  ✅ 已申请加入仙盟: ' + target.name);
          await antiDetect.randomDelay(2000);
          const state2 = await apiRequest('GET', '/player/state', token);
          allianceId = state2.player?.alliance_id || 0;
        }
      } catch (e) {
        console.log('  仙盟申请跳过: ' + e.message);
      }
    }

    // 4) 仙盟日常
    if (allianceId) {
      const tasks = [
        { name: '灵池沐浴', path: '/alliance/spirit_pool/bathe' },
        { name: '仙园采摘', path: '/alliance/garden/pick' },
        { name: '悟道树冥想', path: '/alliance/enlightenment_tree/meditate' },
      ];
      for (const t of tasks) {
        try {
          await apiRequest('POST', t.path, token, { alliance_id: allianceId });
          console.log('  ✅ ' + t.name);
        } catch (e) {
          console.log('  ' + t.name + '跳过: ' + e.message);
        }
        await antiDetect.randomDelay(1500);
      }
    }

    // 5) 洞府采集
    try {
      const caveStatus = await apiRequest('GET', '/online/cave/status', token);
      if (!caveStatus.gathering && (caveStatus.rare_remaining || 0) > 0) {
        await apiRequest('POST', '/online/cave/start', token, { type: 'field' });
        console.log('  ✅ 洞府采集已开启');
      } else {
        console.log('  洞府采集跳过（' + (caveStatus.gathering ? '采集中' : '灵气枯竭') + '）');
      }
    } catch (e) {
      console.log('  洞府跳过: ' + e.message);
    }

    // 报告成功
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: order.id, username, password,
      server_username: username, server_password: password,
      status: 'farming',
    });

    // 更新上次执行时间
    await workerApi('/api/gh/report-log', 'POST', {
      order_id: order.id, username,
      message: '仙盟日常完成',
    });

    return true;
  } catch (e) {
    console.log('  ❌ 失败: ' + e.message);
    return false;
  }
}

// ── 试炼测试处理 ──
async function processTrialTest(order, orderIdx) {
  const username = order.game_account_name;
  if (!username) {
    console.log('  ❌ 缺少游戏账号名');
    return false;
  }

  setApiIdx(orderIdx * 20);
  try {
    // 试炼测试需要通过 Worker API 触发
    const result = await workerApi('/api/gh/process-trial-test', 'POST', {
      order_id: order.id,
      game_account_name: username,
    });
    if (result.ok) {
      console.log('  ✅ 试炼测试已触发');
      return true;
    } else {
      console.log('  ❌ 试炼测试失败: ' + (result.error || '未知错误'));
      return false;
    }
  } catch (e) {
    console.log('  ❌ 失败: ' + e.message);
    return false;
  }
}

// ── 每日试炼处理 ──
async function processDailyTrial(order, orderIdx) {
  const username = order.game_account_name;
  const password = order.game_account_password;
  if (!username || !password) {
    console.log('  ❌ 缺少游戏账号信息');
    return false;
  }

  setApiIdx(orderIdx * 20);
  try {
    const machineId = antiDetect.generateMachineId(orderIdx);
    await antiDetect.randomDelay(1500);

    // 登录
    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    console.log('  ✅ 登录成功');
    await antiDetect.randomDelay(1500);

    // 触发试炼
    try {
      const trialRes = await apiRequest('POST', '/trial/start', token, {});
      console.log('  ✅ 试炼完成: ' + JSON.stringify(trialRes.result || {}).slice(0, 100));
    } catch (e) {
      console.log('  试炼跳过: ' + e.message);
    }

    // 报告
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: order.id, username, password,
      server_username: username, server_password: password,
      status: 'farming',
    });

    await workerApi('/api/gh/report-log', 'POST', {
      order_id: order.id, username,
      message: '每日试炼完成',
    });

    return true;
  } catch (e) {
    console.log('  ❌ 失败: ' + e.message);
    return false;
  }
}

// ── 工单类型分发 ──
async function dispatchOrder(order, orderIdx) {
  const orderType = order.order_type || '代练';

  switch (orderType) {
    case '仙盟采集':
      return processAllianceDaily(order, orderIdx);
    case '试炼测试':
      return processTrialTest(order, orderIdx);
    case '每日试炼':
      return processDailyTrial(order, orderIdx);
    case '代练':
    case '代打':
    case '托管':
    default: {
      // 检查是否已有账号（防止重复注册）
      const existingAccounts = order.total_accounts_created || 0;
      if (existingAccounts > 0) {
        console.log('  已有 ' + existingAccounts + ' 个账号，跳过注册');
        return true;
      }
      // 原有逻辑：注册新账号
      const accountsToCreate = order.quantity || (order.bonus_points ? Math.max(1, Math.ceil(order.bonus_points / 120)) : 1);
      const maxAccounts = Math.min(accountsToCreate, 10);
      console.log('  类型: ' + orderType + ', 需创建账号: ' + maxAccounts + ' 个');

      for (let a = 0; a < maxAccounts; a++) {
        await antiDetect.randomDelay(5000);
        const r = await registerAndSetup(order, orderIdx * 10 + a);
        console.log('  结果 [' + (a + 1) + '/' + maxAccounts + ']: ' + (r.ok ? '✅ 注册成功 [' + r.username + ']' : '❌ ' + r.error));
        await antiDetect.smartPause(a, 3, 30);
      }
      return true;
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  艾德尔工单系统 - 订单扫描器 v3.0');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════');

  if (!API_KEY) { console.error('错误: 未设置 API_KEY'); process.exit(1); }
  if (!WORKER_URL) { console.error('错误: 未设置 WORKER_URL'); process.exit(1); }

  console.log('\n[扫描] 获取已审核通过的工单...');
  const data = await workerApi('/api/gh/approved-orders');
  if (!data.ok || !data.orders || !data.orders.length) {
    console.log('[结果] 没有待处理的工单');
    return;
  }

  console.log('[结果] 找到 ' + data.orders.length + ' 个待处理工单\n');

  for (let i = 0; i < data.orders.length; i++) {
    const order = data.orders[i];
    console.log('──── 工单 #' + order.id + ' [' + (i + 1) + '/' + data.orders.length + '] ────');
    console.log('  类型: ' + (order.order_type || '代练') + ', 邀请码: ' + (order.invite_code || '-'));

    const success = await dispatchOrder(order, i);

    // 订阅类工单（仙盟采集/每日试炼）不标记为完成，保持 approved 状态以便每日执行
    const isSubscription = ['仙盟采集', '每日试炼'].includes(order.order_type);
    if (success && !isSubscription) {
      const completeRes = await workerApi('/api/gh/complete-order', 'POST', { order_id: order.id });
      console.log('  工单 #' + order.id + ' 处理完成: ' + (completeRes.message || ''));
    } else if (success && isSubscription) {
      console.log('  工单 #' + order.id + ' 执行完成（订阅类，保持活跃）');
    } else {
      console.log('  工单 #' + order.id + ' 处理失败');
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  全部完成 ✓');
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误:', e.message);
  process.exit(1);
});
