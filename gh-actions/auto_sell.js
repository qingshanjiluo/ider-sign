const crypto = require('crypto');
const antiDetect = require('./_anti_detect');

const API_BASE = 'https://idlexiuxianzhuan.cn';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const CLIENT_VERSION = '1.2.4';

const USERNAME = process.env.SELL_USERNAME || 'zzhx';
const PASSWORD = process.env.SELL_PASSWORD || 'Pipi20100817';
const MIN_QUALITY = parseInt(process.env.SELL_MIN_QUALITY || '1', 10);
const MAX_QUALITY = parseInt(process.env.SELL_MAX_QUALITY || '2', 10);
const SELL_TYPES = (process.env.SELL_TYPES || 'weapon,armor,accessory,material,medicine').split(',');

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
  console.log('  艾德尔一键卖出工具');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');
  console.log('  账号: ' + USERNAME);
  console.log('  品质范围: ' + MIN_QUALITY + '~' + MAX_QUALITY);
  console.log('  物品种类: ' + SELL_TYPES.join(', '));
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
  } catch (e) {
    console.error('[获取背包] ❌ ' + e.message);
    process.exit(1);
  }

  const inventory = player.inventory || player.bag || player.items || [];
  console.log('[背包] 共 ' + inventory.length + ' 格');
  let totalSold = 0, totalStones = 0, totalItems = 0;

  for (let page = 0; page < inventory.length; page++) {
    const row = inventory[page];
    if (!row) continue;
    for (let slot = 0; slot < (Array.isArray(row) ? row.length : 1); slot++) {
      const item = Array.isArray(row) ? row[slot] : row;
      if (!item) continue;
      const itemId = item.id || item.item_id || item.type_id || 0;
      const itemName = item.name || item.item_name || ('物品#' + itemId);
      const quality = item.quality || item.rarity || item.grade || 0;
      const type = item.type || item.item_type || item.category || '';
      const count = item.count || item.quantity || item.num || 1;

      if (quality < MIN_QUALITY || quality > MAX_QUALITY) continue;
      if (SELL_TYPES.length > 0 && !SELL_TYPES.some(t => type.includes(t) || type === t)) continue;

      await antiDetect.randomDelay(600, 1500);

      try {
        const result = await apiRequest('POST', '/player/sell_item', token, {
          page, slot_index: slot, count,
          expect_item_id: typeof itemId === 'number' ? itemId : 0,
        });
        const stones = result?.spirit_stones || result?.coins || 0;
        totalSold++;
        totalStones += stones;
        totalItems += count;
        console.log('  ✅ 卖出 ' + itemName + ' (品质' + quality + ') ×' + count + ' = ' + stones + '灵石');
      } catch (e) {
        if (e.message.includes('没有') || e.message.includes('空')) continue;
        console.log('  ⚠️ ' + itemName + ' 卖出失败: ' + e.message);
      }

      if (totalSold % 5 === 0) await antiDetect.randomDelay(1500, 3000);
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ 卖出完成');
  console.log('     卖出: ' + totalSold + ' 件物品');
  console.log('     数量: ' + totalItems);
  console.log('     灵石: ' + totalStones);
  console.log('═══════════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误: ' + e.message);
  process.exit(1);
});