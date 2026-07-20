/**
 * 艾尔德工单系统 - 账号健康检测
 * 每日扫描所有进行中的账号，自动升级到最高级
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');

const WORKER_URL = process.env.WORKER_URL || '';
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

async function checkAndLevelUp(account, idx) {
  setApiIdx(idx * 10);

  const { server_username, server_password, order_id, username } = account;
  if (!server_username || !server_password) return { ok: false, error: '无账号密码' };

  console.log('[' + server_username + '] 检查中...');

  try {
    // Check if stop monitoring
    if (account.stop_monitor_at) {
      const stopTime = new Date(account.stop_monitor_at).getTime();
      if (Date.now() > stopTime) {
        console.log('[' + server_username + '] 超过监控期，标记完成');
        await workerApi('/api/gh/report-account', 'POST', {
          order_id, username, status: 'completed', level: account.level || 0,
        });
        return { ok: true, status: 'completed' };
      }
    }

    // Login
    const machineId = 'health_' + idx + '_' + Date.now().toString(36);
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: server_username, password: server_password, machine_id: machineId,
    });
    const token = loginData.token;
    await sleep(1500);

    // Get player state
    const state = await apiRequest('GET', '/player/state', token);
    const player = state.player || {};
    const level = player.level || 0;
    const canLevelUp = player.can_level_up || false;
    console.log('[' + server_username + '] 当前等级: ' + level + ', 可升级: ' + canLevelUp);

    // Auto level up
    let newLevel = level;
    if (canLevelUp) {
      try {
        await apiRequest('POST', '/player/level_up', token, {});
        console.log('[' + server_username + '] 升级成功!');
        await sleep(1000);
        const state2 = await apiRequest('GET', '/player/state', token);
        newLevel = state2.player?.level || level;

        // Keep leveling up if possible
        for (let i = 0; i < 20; i++) {
          if (state2.player?.can_level_up) {
            await sleep(500);
            await apiRequest('POST', '/player/level_up', token, {});
          } else break;
        }
      } catch (e) {
        console.log('[' + server_username + '] 升级失败: ' + e.message);
      }
    }

    // Check breakthrough
    if (level >= 100 && level < 120) {
      try {
        await apiRequest('POST', '/player/breakthrough', token, {});
        console.log('[' + server_username + '] 突破尝试');
        await sleep(1000);
      } catch (e) {}
    }

    // Report status
    const isCompleted = newLevel >= 120;
    const reportStatus = isCompleted ? 'completed' : 'farming';

    await workerApi('/api/gh/report-account', 'POST', {
      order_id, username,
      status: reportStatus,
      level: newLevel,
      map_id: player.map_id || 0,
      map_name: player.map_name || '',
    });

    console.log('[' + server_username + '] ' + (isCompleted ? '✅ 已到120级' : '等级=' + newLevel));
    return { ok: true, level: newLevel, completed: isCompleted };
  } catch (e) {
    console.log('[' + (server_username || '?') + '] 失败: ' + e.message);
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('艾尔德工单系统 - 账号健康检测');
  console.log('时间: ' + new Date().toISOString() + '\n');

  if (!API_KEY) { console.error('错误: 未设置 API_KEY'); process.exit(1); }

  // We need accounts from the worker. Since there's no bulk fetch endpoint,
  // for now we scan each order's game accounts.
  // This is a simplified health check that works with the data we have.

  console.log('健康检测完成（需集成批量账号获取）');
}

main().catch(e => { console.error(e.message); process.exit(1); });
