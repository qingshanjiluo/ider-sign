/**
 * 艾德尔工单系统 - GitHub Actions 订单扫描器
 * 扫描已审核通过的工单，自动注册账号并开始刷怪
 * 内置防封检测：独立IP/机器码/指纹轮换/随机延迟
 * 完整流程：注册→创建角色(金灵根100)→绑定邀请码→装备技能/功法/武器→战斗+自动刷怪
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
const antiDetect = require('./_anti_detect');

const WORKER_URL = 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://ideer-game-api.sifangzhiji.workers.dev';
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

function tsLog(msg) {
  const now = new Date();
  const t = now.toLocaleString('zh-CN', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

async function workerApi(path, method = 'GET', body = null) {
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
  // 每10条或定时刷新
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
    // 失败时尝试单条发送
    for (const log of logsToSend) {
      try { await workerApi('/api/gh/report-log', 'POST', log); } catch (e2) { /* 忽略 */ }
    }
  }
}

/**
 * 完整注册+配置流程（参照 batch.js 的 BatchEngine.processAccount）
 * 1) 注册 → 2) 创建角色(金灵根100) → 3) 绑定邀请码 →
 * 4) 装备技能(重击/火球术/治疗术) → 5) 装备铁剑 →
 * 6) 设置功法(吐纳法) → 7) 切换地图(荒石村) → 8) 开始战斗+自动刷怪
 * 含重试机制：如果用户名重复自动重试，最多5次
 */
async function registerAndSetup(workerOrder, orderIdx) {
  const inviteCode = workerOrder.invite_code || '';
  const usedNames = new Set();

  for (let retry = 0; retry < 5; retry++) {
    const apiIdx = orderIdx * 30 + retry * 5;
    setApiIdx(apiIdx);

    // 生成长度不超过16的用户名（确保角色名截取8字符后可读）
    const username = antiDetect.randomUsername(16, [...usedNames]);
    const password = antiDetect.randomPassword();

    if (retry > 0) {
      tsLog('[' + username + '] 重试第 ' + (retry + 1) + ' 次' + (inviteCode ? ' (邀请码: ' + inviteCode + ')' : ''));
    } else {
      tsLog('[' + username + '] 开始注册' + (inviteCode ? ' (邀请码: ' + inviteCode + ')' : ''));
    }

    // 预检：通过 Worker 查询用户名是否已存在
    try {
      const checkRes = await workerApi('/api/gh/check-username', 'POST', { username });
      if (checkRes.exists) {
        tsLog('[' + username + '] ⚠️ 用户名已被占用，重新生成...');
        usedNames.add(username);
        continue;
      }
    } catch (e) {
      // 预检接口失败则继续，后续会捕获游戏服错误
    }

    try {
      const machineId = antiDetect.generateMachineId(apiIdx);
      const stepDelay = () => antiDetect.randomDelay(1200, 2500);

      // ── 1) 注册账号 ──
      const regData = await apiRequest('POST', '/auth/register', '', {
        username, password, machine_id: machineId,
      });
      const token = regData.token;
      tsLog('[' + username + '] ✅ 注册成功 (accountId=' + regData.accountId + ')');
      await stepDelay();

      // 上报 Worker：账号已创建（返回 account_id）
      const reportRes = await workerApi('/api/gh/report-account', 'POST', {
        order_id: workerOrder.id, username, password,
        server_username: username, server_password: password,
        status: 'creating',
      });
      // 若已达订购数量上限（服务端硬上限），跳过本次注册
      if (reportRes.capped) {
        tsLog('[' + username + '] ⛔ 已达订购数量上限，跳过注册');
        return { username, ok: false, capped: true, error: reportRes.message || '已达上限' };
      }
      const accountId = reportRes.account_id || 0;

      // ── 2) 创建角色（金灵根100），角色名冲突时自动加后缀重试 ──
      let playerName = username.slice(0, 12);
      let createData, characterName, createdResultData, spiritRoots;
      for (let nameRetry = 0; nameRetry < 15; nameRetry++) {
        if (nameRetry > 0) {
          var sfx = ['_'+nameRetry, '_'+Math.floor(Math.random()*999), String.fromCharCode(97+nameRetry%26), '_x'+nameRetry];
          playerName = username.slice(0, 8) + sfx[nameRetry % sfx.length];
          tsLog('[' + username + '] 角色名重试 #' + (nameRetry + 1) + ': ' + playerName);
        }
        try {
          createData = await apiRequest('POST', '/player/create', token, {
            name: playerName,
            spirit_roots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 },
          });
          break;
        } catch (e) {
          if (/角色名已|已被使用|taken/i.test(e.message || '') && nameRetry < 9) {
            tsLog('[' + username + '] ⚠️ 角色名"' + playerName + '"已被占用，换名重试...');
            continue;
          }
          throw e;
        }
      }
      tsLog('[' + username + '] ✅ 角色创建成功: ' + (createData.player?.name || playerName) + ' (金灵根100)');
      characterName = createData.player?.name || playerName;
      createdResultData = {
        character_name: characterName,
        spirit_roots: createData.player?.spirit_roots || { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 },
      };
      spiritRoots = JSON.stringify(createdResultData.spirit_roots);
      await workerApi('/api/gh/report-account', 'POST', {
        order_id: workerOrder.id, username, password,
        status: 'character_created',
        character_name: characterName,
        spirit_roots: spiritRoots,
        created_result: JSON.stringify(createdResultData),
      });
      await stepDelay();

      // 记录详细日志（使用批量收集器）
      collectLog({
        order_id: workerOrder.id, username, account_id: accountId,
        log_type: 'character',
        message: '创建角色: ' + characterName + ' (金灵根100)',
        raw_output: JSON.stringify(createdResultData),
      });

      // ── 3) 绑定邀请码 ──
      if (inviteCode) {
        try {
          const inviteData = await apiRequest('POST', '/invite/bind', token, { invite_code: inviteCode });
          tsLog('[' + username + '] ✅ 邀请码绑定成功, 邀请人: ' + (inviteData.inviter_name || '?'));
          collectLog({
            order_id: workerOrder.id, username, account_id: accountId,
            log_type: 'invite',
            message: '邀请码绑定成功: ' + inviteCode + ', 邀请人: ' + (inviteData.inviter_name || '?'),
          });
        } catch (e) {
          tsLog('[' + username + '] ⚠️ 邀请码绑定失败: ' + e.message);
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
      const equippedSkillNames = [];
      for (const sk of starterSkills) {
        try {
          await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
          equippedSkills++;
          equippedSkillNames.push(sk.name);
          tsLog('[' + username + '] ✅ 技能装备: ' + sk.name);
        } catch (e) {
          if (e.message && e.message.includes('已装备')) {
            equippedSkills++;
            equippedSkillNames.push(sk.name);
            tsLog('[' + username + '] ✅ 技能已装备: ' + sk.name);
          } else {
            tsLog('[' + username + '] ⚠️ 技能跳过(' + sk.name + '): ' + e.message);
          }
        }
        await sleep(300);
      }
      tsLog('[' + username + '] 技能装备完成: ' + equippedSkills + '/' + starterSkills.length);
      await stepDelay();

      // ── 5) 装备铁剑 ──
      let swordEquipped = false;
      try {
        const sync = await apiRequest('GET', '/player/sync', token);
        const inv = sync?.player?.inventory || [];
        for (let p = 0; p < inv.length && !swordEquipped; p++) {
          if (!inv[p]) continue;
          for (let s = 0; s < inv[p].length; s++) {
            const slot = inv[p][s];
            if (slot?.item && String(slot.item.name || '').includes('铁剑')) {
              await apiRequest('POST', '/player/equip', token, {
                page: p, slot_index: s, expect_item_id: Number(slot.item.id) || 0,
              });
              swordEquipped = true;
              tsLog('[' + username + '] ✅ 铁剑装备成功');
              break;
            }
          }
        }
        if (!swordEquipped) tsLog('[' + username + '] ⚠️ 背包中未找到铁剑');
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 装备铁剑失败: ' + e.message);
      }
      await stepDelay();

      // ── 6) 设置主功法（吐纳法 id=1） ──
      let techniqueSet = false;
      try {
        await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
        techniqueSet = true;
        tsLog('[' + username + '] ✅ 功法设置: 吐纳法');
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 功法跳过: ' + e.message);
      }
      await stepDelay();

      // ── 7) 切换地图到荒石村 ──
      let mapChanged = false;
      try {
        await apiRequest('POST', '/player/set_map', token, { map_id: 1 });
        mapChanged = true;
        tsLog('[' + username + '] ✅ 切换至荒石村');
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 地图切换跳过: ' + e.message);
      }
      await stepDelay();

      // ── 8) 战斗 + 自动刷怪 ──
      let battleStarted = false;
      try {
        await apiRequest('POST', '/battle/start', token, { mapId: 1, poll_mode: false, auto_restart: false });
        battleStarted = true;
        tsLog('[' + username + '] ✅ 战斗已启动');
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 战斗启动跳过: ' + e.message);
      }
      await sleep(500);
      let autoRestartSet = false;
      try {
        await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: 1 });
        autoRestartSet = true;
        tsLog('[' + username + '] ✅ 自动刷怪已开启');
      } catch (e) {
        tsLog('[' + username + '] ⚠️ 自动刷怪跳过: ' + e.message);
      }

      const setupLog = {
        registered: true, character_created: true,
        skills: equippedSkillNames, iron_sword: swordEquipped,
        technique: techniqueSet, map: mapChanged,
        battle: battleStarted, auto_restart: autoRestartSet,
      };

      await workerApi('/api/gh/report-account', 'POST', {
        order_id: workerOrder.id, username, password,
        server_username: username, server_password: password,
        status: 'farming', level: 1,
        map_id: 1, map_name: '荒石村',
        character_name: characterName,
        spirit_roots: spiritRoots,
        skills: starterSkills.map(s => ({ id: s.id, name: s.name })),
        techniques: techniqueSet ? [{ id: 1, name: '吐纳法' }] : [],
        equipment: swordEquipped ? [{ name: '铁剑' }] : [],
        setup_status: 'farming',
        created_result: JSON.stringify(setupLog),
      });

      collectLog({
        order_id: workerOrder.id, username, account_id: accountId,
        log_type: 'setup_complete',
        message: '账号配置完成: ' + JSON.stringify(setupLog),
      });

      return { username, password, ok: true };
    } catch (e) {
      const errMsg = e.message || '';
      tsLog('[' + username + '] ❌ 失败: ' + errMsg);

      // 检测是否为用户名/角色名重复错误 → 重试
      const isDuplicate = /已存在|已注册|重复|角色名已|已被使用|exists|already|taken/i.test(errMsg);
      if (isDuplicate && retry < 4) {
        tsLog('[' + username + '] ⚠️ 用户名重复，重新生成并重试...');
        usedNames.add(username);
        collectLog({
          order_id: workerOrder.id, username, account_id: accountId,
          log_type: 'retry',
          message: '用户名重复，重试 #' + (retry + 1) + ': ' + errMsg,
        });
        continue;
      }

      try {
        await workerApi('/api/gh/report-account', 'POST', {
          order_id: workerOrder.id, username, password: '',
          status: 'failed', error_msg: errMsg,
        });
        collectLog({
          order_id: workerOrder.id, username, account_id: accountId,
          log_type: 'error',
          message: '注册失败: ' + errMsg,
          raw_output: errMsg,
        });
      } catch (e2) { tsLog('[' + username + '] ⚠️ 错误上报失败: ' + (e2.message || '').slice(0, 60)); }
      return { username, ok: false, error: errMsg };
    }
  }

  tsLog('❌ 用户名生成重试耗尽（5次），跳过该账号');
  await workerApi('/api/gh/report-account', 'POST', {
    order_id: workerOrder.id, username: '', password: '',
    status: 'failed', error_msg: '重试耗尽（5次用户名重复）',
  }).catch(() => {});
  return { username: '', ok: false, error: '重试耗尽' };
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
    collectLog({
      order_id: order.id, username,
      log_type: 'alliance_daily',
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

    collectLog({
      order_id: order.id, username,
      log_type: 'daily_trial',
      message: '每日试炼完成',
    });

    return true;
  } catch (e) {
    console.log('  ❌ 失败: ' + e.message);
    return false;
  }
}

// ── 传人派出处理 ──
async function processDispatch(order, orderIdx) {
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

    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    console.log('  ✅ 登录成功');
    await antiDetect.randomDelay(1000);

    // 派出传人
    try {
      const dispatchRes = await apiRequest('POST', '/courier/send', token, {
        map: order.dispatch_map || '灵翠山脉',
        material: order.material_type || '灵石',
      });
      console.log('  ✅ 传人已派出至[' + (order.dispatch_map || '默认') + '] 物资[' + (order.material_type || '默认') + ']');
      await antiDetect.randomDelay(1000);
    } catch (e) {
      console.log('  派出跳过: ' + e.message);
    }

    await workerApi('/api/gh/report-account', 'POST', {
      order_id: order.id, username, password,
      server_username: username, server_password: password,
      status: 'farming',
    });
    collectLog({
      order_id: order.id, username,
      log_type: 'daily_dispatch',
      message: '传人派出: ' + (order.dispatch_map || '默认') + '/' + (order.material_type || '默认'),
    });
    return true;
  } catch (e) {
    console.log('  ❌ 失败: ' + e.message);
    return false;
  }
}

// ── 副本刷取处理 ──
async function processDungeonClear(order, orderIdx) {
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

    const loginData = await apiRequest('POST', '/auth/login', '', { username, password, machine_id: machineId });
    const token = loginData.token;
    console.log('  ✅ 登录成功');
    await antiDetect.randomDelay(1000);

    // 获取副本列表
    let dungeonList = [];
    try {
      const listData = await apiRequest('GET', '/dungeon/list', token);
      dungeonList = listData.dungeons || listData.list || [];
      console.log('  获取到 ' + dungeonList.length + ' 个副本');
    } catch (e) {
      console.log('  获取副本列表失败，使用默认列表: ' + e.message);
      dungeonList = [{ id: 1, name: '灵翠山脉副本' }, { id: 2, name: '幽暗森林副本' }, { id: 3, name: '冰霜峡谷副本' }];
    }

    const clearType = order.clear_type || '全物资';
    let cleared = 0;

    for (const dungeon of dungeonList) {
      const dungeonId = dungeon.id || dungeon.dungeon_id;
      const dungeonName = dungeon.name || ('副本#' + dungeonId);

      // 每个副本战斗2次
      for (let round = 1; round <= 2; round++) {
        try {
          const startData = await apiRequest('POST', '/dungeon-battle/start', token, {
            dungeon_id: dungeonId,
          });
          const battleId = startData.battle_id;
          if (!battleId) {
            console.log('  [' + dungeonName + '] 第' + round + '轮 无battle_id，跳过');
            continue;
          }

          // 自动推进直到战斗结束
          let ended = false;
          for (let adv = 0; adv < 60; adv++) {
            const advData = await apiRequest('POST', '/dungeon-battle/advance?state=lite', token, { battle_id: battleId });
            ended = Boolean(advData.ended);
            if (ended) break;
            await sleep(100);
          }

          if (ended) {
            cleared++;
            console.log('  ✅ [' + dungeonName + '] 第' + round + '轮 完成');
          } else {
            console.log('  ⚠️ [' + dungeonName + '] 第' + round + '轮 超时');
          }
          await antiDetect.randomDelay(500, 1000);
        } catch (e) {
          console.log('  ⚠️ [' + dungeonName + '] 第' + round + '轮 跳过: ' + e.message);
        }
      }

      // 自动推进到下一个地图
      try {
        await apiRequest('POST', '/player/set_map', token, { map_id: (dungeonId || 0) + 1 });
        console.log('  ➡️ 推进到下一地图');
      } catch (e) { tsLog('⚠️ 地图推进失败: ' + (e.message || '').slice(0, 60)); }
      await antiDetect.randomDelay(800, 1500);
    }

    console.log('  本次清理 ' + cleared + '/' + (dungeonList.length * 2) + ' 轮次，类型=' + clearType);

    await workerApi('/api/gh/report-account', 'POST', {
      order_id: order.id, username, password,
      server_username: username, server_password: password,
      status: 'farming',
    });
    collectLog({
      order_id: order.id, username,
      log_type: 'dungeon_clear',
      message: '副本刷取: ' + clearType + ' 清理' + cleared + '轮',
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
    case '传人派出':
      return processDispatch(order, orderIdx);
    case '副本刷取':
      return processDungeonClear(order, orderIdx);
    case '代练':
    case '代打':
    case '托管':
    default: {
      // 查询工单账号总数（含注册中/角色创建中/已完成，防止重复注册造成超量）
      // 注意：不能只用 valid（已交付挂机）数量，否则注册中的账号不被计入，
      // 每次扫描都会误以为"数量不足"而继续注册，导致严重超量注册。
      // 已满足计数 = 总数 - 失败/错误（失败账号需另补，不占名额）
      let existingAccounts = 0;
      let failedErrCount = 0;
      try {
        const countRes = await workerApi('/api/gh/account-count?order_id=' + order.id);
        const byStatus = countRes.by_status || {};
        const total = countRes.total != null ? countRes.total : countRes.valid;
        failedErrCount = (byStatus.failed || 0) + (byStatus.error || 0);
        existingAccounts = Math.max(0, (total || 0) - failedErrCount);
      } catch (e) {
        tsLog('⚠️ 查询账号数量失败，使用 order.total_accounts_created: ' + e.message);
        existingAccounts = Math.max(0, (order.total_accounts_created || 0) - failedErrCount);
      }
      // 目标账号数 = 订购数量 + 1（每个工单多发一个冗余，宁多勿少）
      const accountsToCreate = (order.quantity || (order.bonus_points ? Math.max(1, Math.ceil(order.bonus_points / 10)) : 1)) + 1;

      // 已有账号已达目标数量 → 跳过
      if (existingAccounts >= accountsToCreate) {
        tsLog('已有 ' + existingAccounts + '/' + accountsToCreate + ' 个账号（不含失败 ' + failedErrCount + '），无需补充');
        return true;
      }

      // 当前需要创建的账号数 = 目标 - 已有（每次最多不超过 50，防超时）
      const remaining = Math.max(0, accountsToCreate - existingAccounts);
      const maxToCreate = Math.min(remaining, 50);
      tsLog('类型: ' + orderType + ', 目标: ' + accountsToCreate + ', 已有: ' + existingAccounts + '（失败 ' + failedErrCount + '）, 本次创建: ' + maxToCreate + ' 个');

      for (let a = 0; a < maxToCreate; a++) {
        await antiDetect.randomDelay(5000);
        const r = await registerAndSetup(order, orderIdx * 10 + a);
        tsLog('结果 [' + (a + 1) + '/' + maxToCreate + ']: ' + (r.ok ? '✅ 注册成功 [' + r.username + ']' : (r.capped ? '⛔ 已达上限' : '❌ ' + r.error)));
        await antiDetect.smartPause(a, 3, 30);
        // 服务端已拒绝（达上限）→ 立即停止本次创建
        if (r.capped) { tsLog('⛔ 已达订购数量上限，停止本次创建'); break; }
        // 每创建一个后复查计数，已达目标即提前停止（防并发导致超量）
        if (r.ok) {
          try {
            const reCount = await workerApi('/api/gh/account-count?order_id=' + order.id);
            const rcTotal = reCount.total != null ? reCount.total : reCount.valid;
            const rcFailed = ((reCount.by_status || {}).failed || 0) + ((reCount.by_status || {}).error || 0);
            const rcExisting = Math.max(0, (rcTotal || 0) - rcFailed);
            if (rcExisting >= accountsToCreate) {
              tsLog('✅ 已达目标 ' + rcExisting + '/' + accountsToCreate + '，提前结束');
              break;
            }
          } catch (e) { /* 忽略复查失败 */ }
        }
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

  tsLog('获取已审核通过的工单...');
  const data = await workerApi('/api/gh/approved-orders');
  if (!data.ok || !data.orders || !data.orders.length) {
    tsLog('没有待处理的工单');
    return;
  }

  tsLog('找到 ' + data.orders.length + ' 个待处理工单\n');

  for (let i = 0; i < data.orders.length; i++) {
    const order = data.orders[i];
    console.log('──── 工单 #' + order.id + ' [' + (i + 1) + '/' + data.orders.length + '] ────');
    console.log('  类型: ' + (order.order_type || '代练') + ', 邀请码: ' + (order.invite_code || '-'));

    const success = await dispatchOrder(order, i);

    const isSubscription = ['仙盟采集', '每日试炼', '传人派出'].includes(order.order_type);
    const isBatch = ['代练', '代打', '托管'].includes(order.order_type);
    if (success && !isSubscription && !isBatch) {
      const completeRes = await workerApi('/api/gh/complete-order', 'POST', { order_id: order.id });
      tsLog('工单 #' + order.id + ' 处理完成: ' + (completeRes.message || ''));
    } else if (success && isBatch) {
      const completeRes = await workerApi('/api/gh/complete-order', 'POST', { order_id: order.id });
      tsLog('工单 #' + order.id + ' 账号补充完成: ' + (completeRes.message || '') + ' (状态: ' + (completeRes.status || order.status) + ')');
    } else if (success && isSubscription) {
      // 检查订阅是否到期
      if (order.subscription_end && new Date(order.subscription_end) < new Date()) {
        tsLog('工单 #' + order.id + ' 订阅已到期，自动完成');
        await workerApi('/api/gh/complete-order', 'POST', { order_id: order.id });
      } else {
        tsLog('工单 #' + order.id + ' 执行完成（订阅类，保持活跃）');
      }
    } else {
      tsLog('工单 #' + order.id + ' 处理失败');
    }
  }

  // 刷新剩余日志
  await flushLogs();

  console.log('\n═══════════════════════════════════════');
  console.log('  全部完成 ✓');
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  tsLog('❌ 致命错误: ' + e.message);
  process.exit(1);
});
