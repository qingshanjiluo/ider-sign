const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://idlexiuxianzhuan.cn';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const CLIENT_VERSION = '1.2.4';
const TEST_USER = 'zzhx';
const TEST_PASS = 'Pipi20100817';
const MAX_ADVANCE_LOOPS = 60;
const WORKER_URL = process.env.WORKER_URL || '';

const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 5, timeout: 60000 });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeSign(method, path, timestamp, bodyStr) {
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(method + '\n' + path + '\n' + timestamp + '\n' + bodyStr);
  return hmac.digest('hex');
}

function httpsReq(method, hostname, path, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers: { ...headers }, rejectUnauthorized: false, agent: HTTPS_AGENT };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const t = setTimeout(() => { req.destroy(new Error('超时')); }, timeoutMs || 30000);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function apiRequest(method, path, token, body) {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, ts, bodyStr);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(ts), 'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsReq(method, 'idlexiuxianzhuan.cn', path, headers, bodyStr, 60000);
  let data;
  try { data = JSON.parse(r.body); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + r.body.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}

async function runTrial(token, dungeonId, affixIds) {
  const startData = await apiRequest('POST', '/dungeon-battle/start', token, {
    dungeon_id: dungeonId,
    challenge_mode: 'trial_contract',
    contract_modifiers: affixIds,
  });
  const battleId = startData.battle_id;
  if (!battleId) throw new Error('无battle_id');
  const theoreticalCoins = Number(startData.trial_coins) || 0;
  const grantedCoins = startData.rewards?.trial_coins || 0;
  let ended = false, victory = false;
  for (let r = 0; r < MAX_ADVANCE_LOOPS; r++) {
    const adv = await apiRequest('POST', '/dungeon-battle/advance?state=lite', token, { battle_id: battleId });
    ended = Boolean(adv.ended);
    victory = Boolean(adv.victory);
    if (ended) break;
    await sleep(50);
  }
  return { victory, theoreticalCoins, grantedCoins, ended };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  艾德尔每日试炼工具');
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');

  const configPath = path.join(__dirname, 'trial_config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('❌ 无法读取配置文件 trial_config.json:', e.message);
    process.exit(1);
  }
  console.log('[配置] 加载 ' + config.dungeons.length + ' 个试炼配置\n');

  let token;
  try {
    const loginData = await apiRequest('POST', '/auth/login', '', {
      username: TEST_USER, password: TEST_PASS, machine_id: 'daily_trial_' + Date.now()
    });
    token = loginData.token;
    console.log('[登录] ✅ ' + TEST_USER);
  } catch (e) {
    console.error('[登录] ❌ ' + e.message);
    process.exit(1);
  }

  let playerData;
  try {
    playerData = await apiRequest('GET', '/player/data', token, null);
  } catch (e) {}

  const results = [];
  for (let i = 0; i < config.dungeons.length; i++) {
    const cfg = config.dungeons[i];
    console.log('\n───────────────────────────────────────────');
    console.log('  📍 [' + (i + 1) + '/' + config.dungeons.length + '] ' + cfg.name);
    console.log('     地图ID: ' + cfg.dungeon_id + ' 倍率: ' + cfg.multiplier + 'x');
    console.log('     词条: ' + cfg.label);
    console.log('───────────────────────────────────────────');

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          var r = await runTrial(token, cfg.dungeon_id, cfg.affixes);
          break;
        } catch (e) {
          if (attempt < 3 && (e.message.includes('结算') || e.message.includes('重试'))) {
            console.log('     ⏳ 等待结算重试(' + attempt + '/3)...');
            await sleep(3000 * attempt);
          } else {
            throw e;
          }
        }
      }
      if (!r) throw new Error('重试耗尽');
      console.log('     ' + (r.victory ? '✅' : '❌') + ' 胜利=' + r.victory);
      console.log('     理论收益: ' + r.theoreticalCoins + ' 试炼币');
      console.log('     实际获得: ' + r.grantedCoins + ' 试炼币');
      results.push({
        name: cfg.name, dungeonId: cfg.dungeon_id, victory: r.victory,
        theoreticalCoins: r.theoreticalCoins, grantedCoins: r.grantedCoins,
        expected: cfg.expected_coins, label: cfg.label, multiplier: cfg.multiplier,
      });
      if (r.theoreticalCoins > 0) {
        const diff = r.theoreticalCoins - (cfg.expected_coins || 0);
        if (Math.abs(diff) > 2) console.log('     ⚠️ 偏离预期: 预期' + cfg.expected_coins + ' 实际' + r.theoreticalCoins);
      }
    } catch (e) {
      console.log('     ❌ 错误: ' + e.message);
      results.push({ name: cfg.name, dungeonId: cfg.dungeon_id, victory: false, error: e.message, theoreticalCoins: 0, grantedCoins: 0 });
    }
  }

  console.log('\n\n═══════════════════════════════════════════');
  console.log('          📊 本日试炼报告');
  console.log('═══════════════════════════════════════════');
  console.log('');
  let totalCoins = 0;
  results.forEach((r, i) => {
    const mark = r.victory ? '✅' : '❌';
    const coins = r.grantedCoins > 0 ? r.grantedCoins + '(实)' : (r.theoreticalCoins > 0 ? r.theoreticalCoins + '(理)' : '-');
    console.log('  ' + mark + ' ' + r.name.padEnd(12) + ' 收益: ' + coins + (r.label ? ' [' + r.label + ']' : ''));
    totalCoins += r.theoreticalCoins;
  });
  console.log('');
  console.log('  今日总计(理论): ' + totalCoins + ' 试炼币');
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  完成 ✓');
  console.log('═══════════════════════════════════════════');

  if (WORKER_URL && process.env.API_KEY) {
    try {
      const body = JSON.stringify({ type: 'daily_trial', results, date: new Date().toISOString().slice(0, 10), account: TEST_USER });
      const headers = { 'Content-Type': 'application/json', 'X-API-Key': process.env.API_KEY };
      await httpsReq('POST', new URL(WORKER_URL).hostname, new URL(WORKER_URL).pathname, headers, body);
      console.log('  已上报至 Worker');
    } catch (e) {}
  }
}

main().catch(e => console.error('\n❌ 致命错误:', e.message));
