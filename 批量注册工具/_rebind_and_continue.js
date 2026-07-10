/**
 * 重绑前6个邀请码 + 继续注册后6个
 *
 * 第一步：登录 FrostDragon/ShadowWolf/CrimsonFox/SilverHawk/JadeTiger/ThunderBear
 *         重绑邀请码 H4K8UWWA
 * 第二步：注册 MistLynx/StormViper/IronLotus/WindPhoenix/DarkCrane/GoldenEagle
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');

const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const PASSWORD = 'qwertyuiop';
const INVITE = 'H4K8UWWA';

const IP_SEGMENTS = [
  { isp: '电信', seg: '61.152' }, { isp: '电信', seg: '222.73' }, { isp: '电信', seg: '101.80' },
  { isp: '电信', seg: '124.160' }, { isp: '电信', seg: '125.118' }, { isp: '电信', seg: '183.128' },
  { isp: '电信', seg: '115.192' }, { isp: '电信', seg: '61.134' }, { isp: '电信', seg: '36.40' },
  { isp: '联通', seg: '112.64' }, { isp: '联通', seg: '58.247' }, { isp: '联通', seg: '101.224' },
  { isp: '联通', seg: '122.224' }, { isp: '联通', seg: '60.12' }, { isp: '联通', seg: '101.228' },
  { isp: '联通', seg: '124.89' }, { isp: '联通', seg: '113.134' }, { isp: '联通', seg: '123.138' },
  { isp: '联通', seg: '111.8' }, { isp: '联通', seg: '61.54' },
  { isp: '移动', seg: '111.11' }, { isp: '移动', seg: '117.136' }, { isp: '移动', seg: '120.204' },
  { isp: '移动', seg: '112.12' }, { isp: '移动', seg: '122.231' }, { isp: '移动', seg: '183.129' },
  { isp: '移动', seg: '111.19' }, { isp: '移动', seg: '117.22' }, { isp: '移动', seg: '218.200' },
  { isp: '移动', seg: '120.36' }, { isp: '移动', seg: '27.151' },
];
const USER_AGENTS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'];
const CDN_NODES = ['cdn-hkg-cache-1','cdn-hkg-cache-2','cdn-sha-cache-1','cdn-sha-cache-2','cdn-sha-cache-3','cdn-pek-cache-1','cdn-pek-cache-2','cdn-can-cache-1','cdn-can-cache-2','cdn-sfo-cache-1','cdn-lax-cache-1','cdn-lax-cache-2','cdn-tyo-cache-1','cdn-sin-cache-1','cdn-fra-cache-1'];

let callIdx = 0;

function buildHeaders(idx) {
  const seg = IP_SEGMENTS[idx % IP_SEGMENTS.length];
  const third = Math.floor(Math.random() * 245) + 5;
  const fourth = Math.floor(Math.random() * 250) + 3;
  const fakeIp = seg.seg + '.' + third + '.' + fourth;
  const ua = USER_AGENTS[idx % USER_AGENTS.length];
  const langs = ['zh-CN,zh;q=0.9', 'zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN,zh;q=0.9,en-US;q=0.8'];
  const secChUas = ['"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"', '"Chromium";v="119", "Google Chrome";v="119", "Not-A.Brand";v="99"'];
  return {
    'X-Forwarded-For': fakeIp, 'X-Real-IP': fakeIp, 'X-Client-IP': fakeIp, 'X-Originating-IP': fakeIp,
    'User-Agent': ua, 'Accept': 'application/json, text/plain, */*',
    'Accept-Language': langs[idx % langs.length], 'Accept-Encoding': 'gzip, deflate, br',
    'Sec-CH-UA': secChUas[idx % secChUas.length],
    'Sec-CH-UA-Platform': idx % 4 === 0 ? '"macOS"' : '"Windows"', 'Sec-CH-UA-Mobile': '?0',
    'Sec-Fetch-Site': ['none','same-origin','same-site','cross-site'][idx%4],
    'Sec-Fetch-Mode': ['cors','no-cors','navigate'][idx%3], 'Sec-Fetch-Dest': 'empty',
    'Via': '1.1 ' + CDN_NODES[idx % CDN_NODES.length],
    'X-Cache': ['HIT','MISS'][idx%2], 'Connection': 'keep-alive',
    'Cache-Control': ['no-cache','max-age=0','private','no-store'][idx%4],
    'DNT': idx%3===0?'1':'0',
  };
}

function makeSign(method, path, timestamp, bodyStr) {
  const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(data);
  return hmac.digest('hex');
}

async function api(method, path, token, body) {
  const ts = Math.floor(Date.now() / 1000);
  const bs = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, ts, bs);
  const hdrs = { 'Content-Type': 'application/json', 'X-Client-Version': CLIENT_VERSION, 'X-Sign-T': String(ts), 'X-Sign': sign, ...buildHeaders(callIdx++) };
  if (token) hdrs['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API_BASE + path, { method, headers: hdrs, body: bs || undefined, timeout: 30000 });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch(e) { throw new Error('非JSON('+r.status+'): '+text.slice(0,200)); }
  if (!d || d.ok === false) throw new Error(d && d.error ? d.error : '请求失败');
  return d;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function int(v, d) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; }
function log(tag, msg) { console.log('[' + new Date().toLocaleString('zh-CN',{hour12:false}) + '] [' + tag + '] ' + msg); }
function ok(tag, msg) { console.log('[' + new Date().toLocaleString('zh-CN',{hour12:false}) + '] [' + tag + '] ✓ ' + msg); }
function warn(tag, msg) { console.log('[' + new Date().toLocaleString('zh-CN',{hour12:false}) + '] [' + tag + '] ⚠ ' + msg); }
function err(tag, msg) { console.log('[' + new Date().toLocaleString('zh-CN',{hour12:false}) + '] [' + tag + '] ✗ ' + msg); }

const FIRST6 = ['FrostDragon','ShadowWolf','CrimsonFox','SilverHawk','JadeTiger','ThunderBear'];
const LAST6 = [
  { username: 'MistLynx', name: 'MistLynx' },
  { username: 'StormViper', name: 'StormViper' },
  { username: 'IronLotus', name: 'IronLotus' },
  { username: 'WindPhoenix', name: 'WindPhoenix' },
  { username: 'DarkCrane', name: 'DarkCrane' },
  { username: 'GoldenEagle', name: 'GoldenEagle' },
];

async function bindInviteOnly(username) {
  log(username, '登录中...');
  const loginData = await api('POST', '/auth/login', '', { username, password: PASSWORD, machine_id: 'rebind-' + username });
  const token = loginData.token;
  ok(username, '登录成功, accountId=' + int(loginData.accountId,0));
  await sleep(1000);

  log(username, '绑定邀请码: ' + INVITE);
  try {
    const d = await api('POST', '/invite/bind', token, { invite_code: INVITE });
    ok(username, '邀请码绑定成功, 灵石: ' + int(d.stones_granted,0));
  } catch (e) {
    warn(username, '绑定邀请码失败: ' + e.message);
  }
}

async function registerNew(acc) {
  const uname = acc.username;
  log(uname, '══════ 注册 ' + uname + ' ══════');

  // 注册
  log(uname, '注册中...');
  const reg = await api('POST', '/auth/register', '', { username: uname, password: PASSWORD, machine_id: 'new-' + uname });
  const token = reg.token;
  const aid = int(reg.accountId, 0);
  ok(uname, '注册成功, accountId=' + aid);
  await sleep(1500);

  // 创角
  log(uname, '创建角色...');
  const cr = await api('POST', '/player/create', token, { name: acc.name, spirit_roots: { metal:100, wood:0, water:0, fire:0, earth:0 } });
  ok(uname, '角色创建成功: ' + cr.player.name);
  await sleep(1000);

  // 绑定邀请码
  log(uname, '绑定邀请码: ' + INVITE);
  try {
    const bd = await api('POST', '/invite/bind', token, { invite_code: INVITE });
    ok(uname, '邀请码绑定成功, 灵石: ' + int(bd.stones_granted,0));
  } catch (e) { warn(uname, '绑定邀请码失败: ' + e.message); }
  await sleep(1000);

  // 装备技能
  log(uname, '装备技能...');
  for (const sid of [1,2,3]) {
    try { await api('POST', '/player/equip_skill', token, { skill_id: sid }); } catch(e) {}
    await sleep(300);
  }
  ok(uname, '技能装备完成');
  await sleep(1000);

  // 铁剑
  log(uname, '装备铁剑...');
  try {
    const sync = await api('GET', '/player/sync', token);
    const inv = sync.player.inventory || [];
    let found = false;
    for (let p=0; p<inv.length && !found; p++) {
      if (!inv[p]) continue;
      for (let s=0; s<inv[p].length && !found; s++) {
        const slot = inv[p][s];
        if (slot && slot.item && String(slot.item.name||'').includes('铁剑')) {
          await api('POST', '/player/equip', token, { page:p, slot_index:s, expect_item_id: int(slot.item.id,0) });
          found = true;
        }
      }
    }
    if (found) ok(uname, '铁剑装备成功');
    else warn(uname, '未找到铁剑');
  } catch(e) { warn(uname, '铁剑失败: ' + e.message); }
  await sleep(1000);

  // 吐纳法
  log(uname, '设置吐纳法...');
  try { await api('POST', '/player/set_technique', token, { slot:'main', technique_id:1 }); ok(uname, '吐纳法设置成功'); } catch(e) { warn(uname, '吐纳法失败'); }
  await sleep(1000);

  // 地图
  log(uname, '切换地图...');
  try { await api('POST', '/player/set_map', token, { map_id:1 }); ok(uname, '地图切换成功'); } catch(e) { warn(uname, '地图失败'); }
  await sleep(1000);

  // 战斗
  log(uname, '启动战斗...');
  try { await api('POST', '/battle/start', token, { mapId:1, poll_mode:false, auto_restart:false }); } catch(e) {}
  await sleep(500);
  try { await api('POST', '/battle/auto_restart', token, { enabled:true, map_id:1 }); } catch(e) {}
  ok(uname, '★★★★★ 全部完成! ★★★★★');
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  第一步: 重绑前6个邀请码                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  for (let i = 0; i < FIRST6.length; i++) {
    const uname = FIRST6[i];
    console.log('');
    log(uname, '[' + (i+1) + '/6] 重绑邀请码...');
    try {
      await bindInviteOnly(uname);
    } catch(e) {
      err(uname, '处理失败: ' + e.message);
    }
    if (i < FIRST6.length - 1) {
      const pause = 2000 + Math.floor(Math.random() * 3000);
      log('引擎', '等待 ' + Math.round(pause/1000) + ' 秒...');
      await sleep(pause);
    }
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  第二步: 注册后6个新号                      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  for (let i = 0; i < LAST6.length; i++) {
    const acc = LAST6[i];
    console.log('');
    log(acc.username, '[' + (i+1) + '/6] 开始注册...');
    try {
      await registerNew(acc);
    } catch(e) {
      err(acc.username, '注册失败: ' + e.message);
    }
    if (i < LAST6.length - 1) {
      const isGroupEnd = (i+1) % 3 === 0;
      const pause = isGroupEnd ? 20000 + Math.floor(Math.random()*20000) : 2000 + Math.floor(Math.random()*4000);
      log('引擎', (isGroupEnd ? '组暂停 ' : '等待 ') + Math.round(pause/1000) + ' 秒...');
      await sleep(pause);
    }
  }

  // 保存到 accounts.txt
  const newAccounts = LAST6.filter(a => a.username);
  const line = '\n# ===== 新注册 ' + new Date().toISOString().slice(0,10) + ' =====\n'
    + newAccounts.map(a => a.username + ',' + PASSWORD + ',' + INVITE + '  # ' + a.name).join('\n') + '\n';
  fs.appendFileSync('./accounts.txt', line, 'utf-8');
  log('保存', '已追加到 accounts.txt');

  console.log('');
  console.log('全部完成!');
  console.log('前6个已重绑邀请码, 后6个全新注册');
  console.log('后6个: ' + LAST6.map(a=>a.username).join(', '));
}

main().catch(e => { console.error('异常:', e.message); process.exit(1); });
