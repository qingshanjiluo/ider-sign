const crypto = require('crypto');
const antiDetect = require('./_anti_detect');

const API_BASE = 'https://idlexiuxianzhuan.cn';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const CLIENT_VERSION = '1.2.4';

const USERNAME = process.env.FARM_USERNAME || 'zzhx';
const PASSWORD = process.env.FARM_PASSWORD || 'Pipi20100817';
const MAP_ID = parseInt(process.env.FARM_MAP_ID || '1', 10);

const MAP_NAMES = {
  1: '清泉谷', 2: '翠竹林', 3: '落霞山', 4: '幽冥涧',
  5: '天罡峰', 6: '万妖窟', 7: '不灭峰', 8: '轮回谷',
  9: '青云古道', 10: '葬龙渊', 11: '太初秘境', 12: '鸿蒙禁地',
};

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
    'X-Sign-T': String(timestamp), 'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  Object.assign(headers, antiDetect.buildAntiDetectHeaders(_apiIdx++));
  const r = await fetch('https://idlexiuxianzhuan.cn' + path, {
    method, headers, body: bodyStr || undefined,
  });
  const data = await r.json();
  if (!data || data.ok === false) throw new Error(data?.error || '请求失败(' + r.status + ')');
  return data;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  艾德尔一键刷怪工具');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');
  console.log('  账号: ' + USERNAME);
  console.log('  目标地图: ' + MAP_ID + ' (' + (MAP_NAMES[MAP_ID] || '未知') + ')');
  console.log('');

  setApiIdx(Math.floor(Math.random() * 1000));

  let token;
  try {
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: USERNAME, password: PASSWORD,
      machine_id: antiDetect.generateMachineId(Math.floor(Math.random() * 9999)),
    });
    token = loginData.token;
    console.log('[登录] ✅ ' + USERNAME + '\n');
  } catch (e) {
    console.error('[登录] ❌ ' + e.message);
    process.exit(1);
  }

  await antiDetect.randomDelay(1000, 2000);

  let player;
  try {
    player = await apiRequest('GET', '/player/sync', token, null);
    console.log('[玩家] 等级=' + (player.level || '?') + ' 地图=' + (player.map_id || '?'));
    console.log('');
  } catch (e) {
    console.error('[获取玩家数据] ❌ ' + e.message);
    process.exit(1);
  }

  const currentMap = player.map_id || 0;
  if (currentMap !== MAP_ID) {
    console.log('[切换地图] 当前=' + currentMap + ' 目标=' + MAP_ID);
    try {
      await apiRequest('POST', '/player/set_map', token, { map_id: MAP_ID });
      console.log('  ✅ 已切换到 ' + MAP_NAMES[MAP_ID] || MAP_ID);
      await antiDetect.randomDelay(1500, 3000);
    } catch (e) {
      console.log('  ⚠️ 切图失败: ' + e.message + ' (可能已在目标地图)');
    }
  } else {
    console.log('[地图] 已在目标地图\n');
  }

  const isBattling = player.is_battling || player.battle_active || player.in_battle || player.fighting || currentMap > 1;
  if (!isBattling) {
    console.log('[战斗] 未在战斗中，启动...');
    try {
      await apiRequest('POST', '/battle/start', token, { mapId: MAP_ID, poll_mode: false, auto_restart: false });
      console.log('  ✅ 战斗已启动');
      await antiDetect.randomDelay(1000, 2000);
      await apiRequest('POST', '/battle/auto_restart', token, { enabled: true, map_id: MAP_ID });
      console.log('  ✅ 自动刷怪已开启\n');
      await antiDetect.randomDelay(1000, 1500);
    } catch (e) {
      console.log('  ❌ 战斗启动失败: ' + e.message + '\n');
    }
  } else {
    console.log('[战斗] 已在战斗中 (自动刷怪中)\n');
  }

  const mapName = MAP_NAMES[MAP_ID] || '地图' + MAP_ID;
  console.log('═══════════════════════════════════════════');
  console.log('  ✅ 刷怪已配置完成');
  console.log('     账号: ' + USERNAME);
  console.log('     地图: ' + mapName + ' (ID=' + MAP_ID + ')');
  console.log('     状态: ' + (isBattling ? '已在战斗' : '已启动战斗'));
  console.log('     自动刷怪: 已开启');
  console.log('═══════════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误: ' + e.message);
  process.exit(1);
});