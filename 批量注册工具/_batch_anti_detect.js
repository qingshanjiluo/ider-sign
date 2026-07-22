/**
 * 艾德尔修仙传 - 批量注册自动化工具（反检测增强版 v2.0）
 *
 * 基于 batch.js 增加极致IP伪装 v2.0：
 *   - 31段真实运营商IP（电信/联通/移动）
 *   - 独立CDN节点链
 *   - 浏览器指纹（User-Agent/Sec-CH-UA）
 *   - Accept-Language 轮换
 *   - 随机延迟（1-5s）+ 每3个账号暂停20-40s
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================================
// 常量
// ============================================================
const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

// ============================================================
// 31段真实运营商IP（电信/联通/移动混合）
// ============================================================
const IP_SEGMENTS = [
  { isp: '电信', seg: '61.152', desc: '上海电信' },
  { isp: '电信', seg: '222.73', desc: '上海电信' },
  { isp: '电信', seg: '101.80', desc: '上海电信' },
  { isp: '电信', seg: '124.160', desc: '浙江电信' },
  { isp: '电信', seg: '125.118', desc: '浙江电信' },
  { isp: '电信', seg: '183.128', desc: '浙江电信' },
  { isp: '电信', seg: '115.192', desc: '陕西电信' },
  { isp: '电信', seg: '61.134', desc: '陕西电信' },
  { isp: '电信', seg: '36.40', desc: '陕西电信' },
  { isp: '联通', seg: '112.64', desc: '上海联通' },
  { isp: '联通', seg: '58.247', desc: '上海联通' },
  { isp: '联通', seg: '101.224', desc: '上海联通' },
  { isp: '联通', seg: '122.224', desc: '浙江联通' },
  { isp: '联通', seg: '60.12',  desc: '浙江联通' },
  { isp: '联通', seg: '101.228', desc: '浙江联通' },
  { isp: '联通', seg: '124.89',  desc: '陕西联通' },
  { isp: '联通', seg: '113.134', desc: '陕西联通' },
  { isp: '联通', seg: '123.138', desc: '陕西联通' },
  { isp: '联通', seg: '111.8',   desc: '河南联通' },
  { isp: '联通', seg: '61.54',   desc: '河南联通' },
  { isp: '移动', seg: '111.11',  desc: '上海移动' },
  { isp: '移动', seg: '117.136', desc: '上海移动' },
  { isp: '移动', seg: '120.204', desc: '上海移动' },
  { isp: '移动', seg: '112.12',  desc: '浙江移动' },
  { isp: '移动', seg: '122.231', desc: '浙江移动' },
  { isp: '移动', seg: '183.129', desc: '浙江移动' },
  { isp: '移动', seg: '111.19',  desc: '陕西移动' },
  { isp: '移动', seg: '117.22',  desc: '陕西移动' },
  { isp: '移动', seg: '218.200', desc: '陕西移动' },
  { isp: '移动', seg: '120.36',  desc: '福建移动' },
  { isp: '移动', seg: '27.151',  desc: '福建移动' },
];

function generateRealisticIp(index) {
  const seg = IP_SEGMENTS[index % IP_SEGMENTS.length];
  const third = Math.floor(Math.random() * 245) + 5;
  const fourth = Math.floor(Math.random() * 250) + 3;
  return seg.seg + '.' + third + '.' + fourth;
}

// ============================================================
// 浏览器指纹
// ============================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const ACCEPT_HEADERS = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'application/json, text/plain, */*',
];

const CDN_NODES = [
  'cdn-hkg-cache-1', 'cdn-hkg-cache-2', 'cdn-sha-cache-1',
  'cdn-sha-cache-2', 'cdn-sha-cache-3', 'cdn-pek-cache-1',
  'cdn-pek-cache-2', 'cdn-can-cache-1', 'cdn-can-cache-2',
  'cdn-sfo-cache-1', 'cdn-lax-cache-1', 'cdn-lax-cache-2',
  'cdn-tyo-cache-1', 'cdn-sin-cache-1', 'cdn-fra-cache-1',
];

function buildAntiDetectHeaders(loopIndex) {
  const idx = loopIndex;
  const fakeIp = generateRealisticIp(idx);
  const ua = USER_AGENTS[idx % USER_AGENTS.length];
  const cdnNode = CDN_NODES[idx % CDN_NODES.length];
  const langs = ['zh-CN,zh;q=0.9', 'zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN,zh;q=0.9,en-US;q=0.8', 'en-US,en;q=0.9,zh-CN;q=0.8'];
  const secChUas = [
    '"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"',
    '"Chromium";v="119", "Google Chrome";v="119", "Not-A.Brand";v="99"',
    '"Chromium";v="121", "Google Chrome";v="121", "Not-A.Brand";v="99"',
    '"Chromium";v="120", "Not-A.Brand";v="99"',
  ];
  const headers = {
    'X-Forwarded-For': fakeIp,
    'X-Real-IP': fakeIp,
    'X-Client-IP': fakeIp,
    'X-Originating-IP': fakeIp,
    'User-Agent': ua,
    'Accept': ACCEPT_HEADERS[idx % ACCEPT_HEADERS.length],
    'Accept-Language': langs[idx % langs.length],
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-CH-UA': secChUas[idx % secChUas.length],
    'Sec-CH-UA-Platform': idx % 4 === 0 ? '"macOS"' : '"Windows"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-Fetch-Site': ['none', 'same-origin', 'same-site', 'cross-site'][idx % 4],
    'Sec-Fetch-Mode': ['cors', 'no-cors', 'navigate'][idx % 3],
    'Sec-Fetch-Dest': 'empty',
    'Via': '1.1 ' + cdnNode,
    'X-Cache': ['HIT', 'MISS'][idx % 2],
    'Connection': 'keep-alive',
    'Cache-Control': ['no-cache', 'max-age=0', 'private', 'no-store'][idx % 4],
    'DNT': idx % 3 === 0 ? '1' : '0',
  };
  return headers;
}

// ============================================================
// 签名 & API
// ============================================================
function makeSign(method, path, timestamp, bodyStr) {
  const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(data);
  return hmac.digest('hex');
}

let _apiCallIndex = 0;

async function apiRequest(method, path, token, body) {
  if (token === undefined) token = '';
  if (body === undefined) body = null;
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, timestamp, bodyStr);
  const antiHeaders = buildAntiDetectHeaders(_apiCallIndex++);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(timestamp),
    'X-Sign': sign,
    ...antiHeaders
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const url = API_BASE + path;
  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
  if (bodyStr) opts.body = bodyStr;
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('非JSON响应(' + r.status + '): ' + text.slice(0, 200)); }
    if (!data || data.ok === false) { throw new Error(data && data.error ? data.error : '请求失败'); }
    return data;
  } catch (e) {
    if (e.message.includes('非JSON') || e.message.includes('请求失败')) throw e;
    throw new Error(path + ' 请求失败: ' + e.message);
  }
}

// ============================================================
// 日志
// ============================================================
const LOG_LEVELS = { INFO: 0, OK: 1, WARN: 2, ERR: 3 };
function log(level, tag, msg) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const icons = { INFO: 'ℹ', OK: '✓', WARN: '⚠', ERR: '✗' };
  console.log('[' + ts + '] [' + tag + '] ' + (icons[level] || '') + ' ' + msg);
}
function info(tag, msg) { log('INFO', tag, msg); }
function ok(tag, msg) { log('OK', tag, msg); }
function warn(tag, msg) { log('WARN', tag, msg); }
function err(tag, msg) { log('ERR', tag, msg); }

// ============================================================
// 延迟
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function int(v, def) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : def; }
function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(ms);
}

// ============================================================
// 账号结构
// ============================================================
class Account {
  constructor(username, password, inviteCode) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.inviteCode = String(inviteCode || '').trim();
    this.token = '';
    this.accountId = 0;
    this.playerName = '';
  }
  isValid() {
    return this.username.length >= 2 && this.password.length >= 6;
  }
}

// ============================================================
// 注册 12 个新账号
// ============================================================
const NEW_ACCOUNTS = [
  { username: 'FrostDragon',  name: 'FrostDragon' },
  { username: 'ShadowWolf',   name: 'ShadowWolf' },
  { username: 'CrimsonFox',   name: 'CrimsonFox' },
  { username: 'SilverHawk',   name: 'SilverHawk' },
  { username: 'JadeTiger',    name: 'JadeTiger' },
  { username: 'ThunderBear',  name: 'ThunderBear' },
  { username: 'MistLynx',     name: 'MistLynx' },
  { username: 'StormViper',   name: 'StormViper' },
  { username: 'IronLotus',    name: 'IronLotus' },
  { username: 'WindPhoenix',  name: 'WindPhoenix' },
  { username: 'DarkCrane',    name: 'DarkCrane' },
  { username: 'GoldenEagle',  name: 'GoldenEagle' },
];

const PASSWORD = 'qwertyuiop';
const INVITE_CODE = 'H4K8UWWA';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   艾德尔修仙传 - 12新号注册（反检测v2.0）      ║');
  console.log('║   邀请码: ' + INVITE_CODE + '                     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  const accounts = NEW_ACCOUNTS.map(a => new Account(a.username, PASSWORD, INVITE_CODE));
  info('引擎', '共 ' + accounts.length + ' 个账号待注册');
  console.log('');

  let success = 0;
  let fail = 0;

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const label = '[' + (i + 1) + '/' + accounts.length + '] ' + acc.username;

    console.log('');
    info('引擎', '══════════ ' + label + ' ══════════');

    try {
      // 步骤1: 注册
      info(acc.username, '正在注册...');
      const regBody = { username: acc.username, password: acc.password, machine_id: 'batch-anti-detect-' + i };
      const regData = await apiRequest('POST', '/auth/register', '', regBody);
      acc.token = regData.token;
      acc.accountId = int(regData.accountId, 0);
      ok(acc.username, '注册成功, accountId=' + acc.accountId);
      await randomDelay(1500, 3000);

      // 步骤2: 创建角色（金灵根100）
      info(acc.username, '正在创建角色...');
      const spiritRoots = { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 };
      const createBody = { name: NEW_ACCOUNTS[i].name, spirit_roots: spiritRoots };
      const createData = await apiRequest('POST', '/player/create', acc.token, createBody);
      acc.playerName = createData.player.name;
      ok(acc.username, '角色创建成功: ' + acc.playerName);
      await randomDelay(1000, 2000);

      // 步骤3: 绑定邀请码
      info(acc.username, '正在绑定邀请码: ' + INVITE_CODE);
      try {
        const bindData = await apiRequest('POST', '/invite/bind', acc.token, { invite_code: INVITE_CODE });
        ok(acc.username, '邀请码绑定成功, 灵石: ' + int(bindData.stones_granted, 0));
      } catch (e) {
        warn(acc.username, '绑定邀请码失败: ' + e.message);
      }
      await randomDelay(1000, 2000);

      // 步骤4: 装备技能（重击1/火球术2/治疗术3）
      info(acc.username, '正在装备初始技能...');
      const skillIds = [1, 2, 3];
      const skillNames = { 1: '重击', 2: '火球术', 3: '治疗术' };
      let eqCount = 0;
      for (const sid of skillIds) {
        try {
          await apiRequest('POST', '/player/equip_skill', acc.token, { skill_id: sid });
          eqCount++;
          ok(acc.username, skillNames[sid] + ' 装备成功');
        } catch (e) {
          if (e.message && e.message.includes('已装备')) { eqCount++; }
          else { warn(acc.username, skillNames[sid] + ' 失败: ' + e.message); }
        }
        await sleep(300);
      }
      ok(acc.username, '技能装备完成: ' + eqCount + '/3');
      await randomDelay(1000, 2000);

      // 步骤5: 装备铁剑
      info(acc.username, '正在装备铁剑...');
      try {
        const sync = await apiRequest('GET', '/player/sync', acc.token);
        const inv = sync && sync.player && sync.player.inventory ? sync.player.inventory : [];
        let found = false;
        for (let p = 0; p < inv.length && !found; p++) {
          if (!inv[p]) continue;
          for (let s = 0; s < inv[p].length && !found; s++) {
            const slot = inv[p][s];
            if (slot && slot.item && String(slot.item.name || '').includes('铁剑')) {
              await apiRequest('POST', '/player/equip', acc.token, { page: p, slot_index: s, expect_item_id: int(slot.item.id, 0) });
              found = true;
            }
          }
        }
        if (found) { ok(acc.username, '铁剑装备成功'); }
        else { warn(acc.username, '背包中未找到铁剑'); }
      } catch (e) { warn(acc.username, '装备铁剑失败: ' + e.message); }
      await randomDelay(1000, 2000);

      // 步骤6: 设置主功法（吐纳法 id=1）
      info(acc.username, '正在设置吐纳法...');
      try {
        await apiRequest('POST', '/player/set_technique', acc.token, { slot: 'main', technique_id: 1 });
        ok(acc.username, '吐纳法设置成功');
      } catch (e) { warn(acc.username, '设置功法失败: ' + e.message); }
      await randomDelay(1000, 2000);

      // 步骤7: 切换地图（荒石村）
      info(acc.username, '正在切换地图到荒石村...');
      try {
        await apiRequest('POST', '/player/set_map', acc.token, { map_id: 1 });
        ok(acc.username, '地图切换成功');
      } catch (e) { warn(acc.username, '切换地图失败: ' + e.message); }
      await randomDelay(1000, 2000);

      // 步骤8: 启动战斗
      info(acc.username, '正在启动战斗...');
      try {
        await apiRequest('POST', '/battle/start', acc.token, { mapId: 1, poll_mode: false, auto_restart: false });
        ok(acc.username, '战斗已启动');
      } catch (e) { warn(acc.username, '启动战斗失败: ' + e.message); }
      await sleep(500);
      try {
        await apiRequest('POST', '/battle/auto_restart', acc.token, { enabled: true, map_id: 1 });
        ok(acc.username, '自动刷怪已开启');
      } catch (e) { warn(acc.username, '自动刷怪设置失败: ' + e.message); }

      ok(acc.username, '★★★★★ 全部完成! ★★★★★');
      success++;

      // 每个账号之间延迟 3-5s
      if (i < accounts.length - 1) {
        // 每3个账号暂停更长时间
        const isGroupEnd = (i + 1) % 3 === 0;
        if (isGroupEnd) {
          const pause = Math.floor(Math.random() * 20000) + 20000; // 20-40s
          info('引擎', '已达到第 ' + (i + 1) + ' 个账号，暂停 ' + Math.round(pause / 1000) + ' 秒防检测...');
          await sleep(pause);
        } else {
          const delay = Math.floor(Math.random() * 4000) + 2000; // 2-6s
          info('引擎', '等待 ' + Math.round(delay / 1000) + ' 秒后处理下一个...');
          await sleep(delay);
        }
      }

    } catch (e) {
      err(acc.username, '处理失败: ' + e.message);
      fail++;
      // 失败后等待久一点再重试下一个
      await sleep(10000);
    }
  }

  // 输出总结
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  注册完成!                                     ║');
  console.log('║  成功: ' + String(success).padEnd(38) + '║');
  console.log('║  失败: ' + String(fail).padEnd(38) + '║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // 保存结果到 accounts.txt
  const accountsFile = './accounts.txt';
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(accountsFile, 'utf-8');
  } catch (e) {
    existingContent = '';
  }

  const newLines = accounts
    .filter(a => a.token) // 只保存注册成功的
    .map(a => a.username + ',' + a.password + ',' + INVITE_CODE + '  # ' + a.playerName);

  if (newLines.length > 0) {
    const appendContent = '\n# ===== 新注册账号 ' + new Date().toISOString().slice(0, 10) + ' =====\n' + newLines.join('\n') + '\n';
    fs.writeFileSync(accountsFile, existingContent + appendContent, 'utf-8');
    info('保存', '已追加 ' + newLines.length + ' 个新账号到 ' + accountsFile);
  }

  // 打印新账号列表
  console.log('新注册账号列表（邀请码: ' + INVITE_CODE + '）:');
  console.log('  ' + '用户名'.padEnd(16) + '密码'.padEnd(16) + '角色名');
  console.log('  ' + '─'.repeat(48));
  for (const acc of accounts) {
    const status = acc.token ? '✓' : '✗';
    console.log('  ' + status + ' ' + acc.username.padEnd(14) + PASSWORD.padEnd(16) + (acc.playerName || '-'));
  }
  console.log('');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('程序异常:', e.message);
  process.exit(1);
});
