/**
 * 艾尔德工单系统 - GitHub Actions 扫描器
 * 扫描已审核通过的工单，自动注册账号并开始刷怪
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const antiDetect = require('../../批量注册工具/_anti_detect_shared');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order.your-worker.workers.dev';
const API_KEY = process.env.API_KEY || '';
const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

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
  const anti = antiDetect.buildAntiDetectHeaders(_apiIdx++);
  Object.assign(headers, anti);
  const r = await fetch(API_BASE + path, { method, headers, body: bodyStr || undefined, timeout: 30000 });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + text.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function workerApi(path, method = 'GET', body = null) {
  const headers = { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' };
  const r = await fetch(WORKER_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

function randomUsername() {
  const adj = ['Celestial', 'Mystic', 'Shadow', 'Phoenix', 'Dragon', 'Thunder', 'Crystal', 'Iron', 'Jade', 'Silver', 'Golden', 'Dark', 'Light', 'Storm', 'Wind', 'Fire', 'Water', 'Earth', 'Star', 'Moon', 'Sun', 'Cloud', 'Rain', 'Snow', 'Mountain', 'River', 'Ocean', 'Forest', 'Frost', 'Flame'];
  const noun = ['Fox', 'Wolf', 'Tiger', 'Eagle', 'Lion', 'Bear', 'Falcon', 'Serpent', 'Dragon', 'Owl', 'Crane', 'Deer', 'Knight', 'Blade', 'Soul', 'Spirit', 'Monk', 'Sage', 'Lord', 'King', 'Saint', 'Master', 'Hunter', 'Warrior'];
  const num = Math.floor(Math.random() * 999) + 1;
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + num;
}

function randomPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
  return pw + 'Aa1!';
}

async function registerAndSetup(workerOrder, orderIdx) {
  const apiIdx = orderIdx * 30;
  setApiIdx(apiIdx);

  const username = randomUsername();
  const password = randomPassword();
  const invite_code = workerOrder.invite_code;

  console.log('[' + username + '] 开始注册 (邀请码: ' + invite_code + ')');

  try {
    // 1) Register
    const machineId = antiDetect.generateMachineId(apiIdx);
    const regData = await apiRequest('POST', '/auth/register', '', {
      username, password,
      invite_code,
      spirit_root: 'gold',
      machine_id: machineId,
    });
    console.log('[' + username + '] 注册成功');
    await sleep(2000);

    // Report to worker
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password,
      server_username: username, server_password: password,
      status: 'creating',
    });

    // 2) Login
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username, password, machine_id: machineId,
    });
    const token = loginData.token;
    console.log('[' + username + '] 登录成功');
    await sleep(1500);

    // 3) Equip items (新手装备)
    try {
      // Equip iron sword (item_id=11)
      await apiRequest('POST', '/player/use_item', token, {
        page: 0, slot_index: 0, count: 1, expect_item_id: 11
      });
      console.log('[' + username + '] 装备铁剑');
      await sleep(1000);
    } catch (e) { console.log('[' + username + '] 装备跳过: ' + e.message); }

    // 4) Learn skills
    try {
      await apiRequest('POST', '/player/skill/learn', token, { skill_id: 1 });
      await apiRequest('POST', '/player/skill/learn', token, { skill_id: 2 });
      console.log('[' + username + '] 学习技能');
      await sleep(1000);
    } catch (e) { console.log('[' + username + '] 技能跳过: ' + e.message); }

    // 5) Set technique
    try {
      await apiRequest('POST', '/player/technique/equip', token, { technique_id: 1 });
      console.log('[' + username + '] 装备功法');
      await sleep(1000);
    } catch (e) { console.log('[' + username + '] 功法跳过: ' + e.message); }

    // 6) Switch to 荒石村 (map_id=1)
    try {
      await apiRequest('POST', '/player/map/switch', token, { map_id: 1 });
      console.log('[' + username + '] 切换至荒石村');
      await sleep(1500);
    } catch (e) { console.log('[' + username + '] 地图切换跳过: ' + e.message); }

    // 7) Start auto battle
    try {
      await apiRequest('POST', '/battle/start', token, {});
      console.log('[' + username + '] 开始刷怪');
    } catch (e) { console.log('[' + username + '] 刷怪跳过: ' + e.message); }

    // Report success
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password,
      server_username: username, server_password: password,
      status: 'farming', level: 1,
      map_id: 1, map_name: '荒石村',
      skills: [{ id: 1, name: '重击' }, { id: 2, name: '火球术' }],
      techniques: [{ id: 1, name: '吐纳法' }],
      equipment: [{ id: 11, name: '铁剑' }],
    });

    return { username, password, ok: true };
  } catch (e) {
    console.log('[' + username + '] 失败: ' + e.message);
    await workerApi('/api/gh/report-account', 'POST', {
      order_id: workerOrder.id, username, password: '',
      status: 'failed', error_msg: e.message,
    });
    return { username, ok: false, error: e.message };
  }
}

async function main() {
  console.log('艾尔德工单系统 - 订单扫描器');
  console.log('时间: ' + new Date().toISOString());

  if (!API_KEY) { console.error('错误: 未设置 API_KEY'); process.exit(1); }
  if (!WORKER_URL.includes('workers.dev')) { console.error('错误: 请设置正确的 WORKER_URL'); process.exit(1); }

  // Fetch approved orders
  console.log('扫描已审核工单...');
  const data = await workerApi('/api/gh/approved-orders');
  if (!data.ok || !data.orders || !data.orders.length) {
    console.log('没有待处理的工单');
    return;
  }

  console.log('找到 ' + data.orders.length + ' 个待处理工单');

  for (let i = 0; i < data.orders.length; i++) {
    const order = data.orders[i];
    console.log('\n===== 工单 #' + order.id + ' [' + (i + 1) + '/' + data.orders.length + '] =====');
    console.log('邀请码: ' + order.invite_code + ', 积分: ' + order.bonus_points);

    const accountsToCreate = order.bonus_points ? Math.ceil(order.bonus_points / 120) : 1;
    const maxAccounts = Math.min(accountsToCreate, 10);
    console.log('需创建账号: ' + maxAccounts + ' 个');

    for (let a = 0; a < maxAccounts; a++) {
      await sleep(5000 + Math.random() * 5000);
      const r = await registerAndSetup(order, i * 10 + a);
      console.log('  结果: ' + (r.ok ? '✅ 成功' : '❌ ' + r.error));
      if ((a + 1) % 3 === 0 && a < maxAccounts - 1) {
        const pause = 30 + Math.floor(Math.random() * 30);
        console.log('  暂停 ' + pause + 's...');
        await sleep(pause * 1000);
      }
    }

    // Check if order should be completed
    await workerApi('/api/gh/complete-order', 'POST', { order_id: order.id });
    console.log('工单 #' + order.id + ' 处理完成');
  }

  console.log('\n全部完成');
}

main().catch(e => { console.error('致命错误:', e.message); process.exit(1); });
