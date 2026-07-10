/**
 * 艾德尔修仙传 - 重新注册封号替换工具 v1.1 🛡️
 *
 * ════════════════════════════════════════════════════════════
 *  功能：读取 accounts.txt 中 #BANNED 标记的账号，
 *  用原密码+邀请码，名字加 _v2 后缀重新注册，
 *  注册成功的账号追加到文件末尾
 *
 *  🛡️ 极致IP伪装 v2.0：
 *  - 模拟真实中国运营商IP（电信/联通/移动/铁通）
 *  - 每个账号完全独立IP（不共享）
 *  - 多地区分布（模拟不同省份城市用户）
 *  - 完整浏览器指纹（Sec-CH-UA, Accept-Language 等）
 *  - CDN代理链模拟（X-Via, X-Cache 头）
 *
 *  使用：node batch_reregister.js
 * ════════════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
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
// 🛡️ 极致IP伪装 v2.0
// ============================================================
// 模拟真实中国运营商IP段（非内网IP！）
// 分布在不同省份/城市，每个账号独立IP
const IP_SEGMENTS = [
  // 中国电信 (China Telecom) - 南方地区
  { prefix: '61.',   province: '广东' },   // 电信骨干网
  { prefix: '59.',   province: '北京' },   // 电信
  { prefix: '219.',  province: '上海' },   // 电信
  { prefix: '218.',  province: '浙江' },   // 电信
  { prefix: '222.',  province: '江苏' },   // 电信
  { prefix: '113.',  province: '福建' },   // 电信
  { prefix: '116.',  province: '湖南' },   // 电信
  { prefix: '118.',  province: '湖北' },   // 电信
  { prefix: '119.',  province: '四川' },   // 电信
  { prefix: '120.',  province: '广西' },   // 电信
  // 中国联通 (China Unicom) - 北方地区
  { prefix: '106.',  province: '山东' },   // 联通
  { prefix: '111.',  province: '河北' },   // 联通
  { prefix: '112.',  province: '河南' },   // 联通
  { prefix: '123.',  province: '辽宁' },   // 联通
  { prefix: '124.',  province: '黑龙江' }, // 联通
  { prefix: '125.',  province: '吉林' },   // 联通
  { prefix: '175.',  province: '山西' },   // 联通
  // 中国移动 (China Mobile) - 全国
  { prefix: '36.',   province: '陕西' },   // 移动
  { prefix: '39.',   province: '云南' },   // 移动
  { prefix: '42.',   province: '贵州' },   // 移动
  { prefix: '49.',   province: '安徽' },   // 移动
  { prefix: '101.',  province: '江西' },   // 移动
  { prefix: '110.',  province: '甘肃' },   // 移动
  { prefix: '117.',  province: '新疆' },   // 移动
  { prefix: '221.',  province: '海南' },   // 移动
  // 其他运营商
  { prefix: '103.',  province: '天津' },   // 铁通/广电
  { prefix: '115.',  province: '重庆' },   // 宽带
  { prefix: '171.',  province: '内蒙古' }, // 广电
  { prefix: '183.',  province: '宁夏' },   // 移动/铁通
  { prefix: '202.',  province: '西藏' },   // 教育网/电信
];

function generateRealisticIp(index) {
  // 每个账号有完全独立的IP（不再共享）
  const segment = IP_SEGMENTS[index % IP_SEGMENTS.length];
  // 加上随机C段和D段
  const c = Math.floor(Math.random() * 255);
  const d = Math.floor(Math.random() * 254) + 1; // 1-254, 排除0和255
  return segment.prefix + c + '.' + d;
}

function getProvinceByIndex(index) {
  return IP_SEGMENTS[index % IP_SEGMENTS.length].province;
}

function generateMachineId(index) {
  // 模拟真实浏览器指纹，使用更可信的格式
  const patterns = [
    // 格式1: WebRTC-like fingerprint
    () => `web_${crypto.randomBytes(4).toString('hex')}_${Date.now().toString(36).slice(-6)}`,
    // 格式2: canvas fingerprint like
    () => `canvas_${crypto.randomBytes(6).toString('hex')}`,
    // 格式3: UUID-like
    () => {
      const hex = crypto.randomBytes(16).toString('hex');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    },
    // 格式4: Browser ID like
    () => `bid_${crypto.randomBytes(8).toString('hex')}`,
    // 格式5: simple device id
    () => `dev_${(index * 777 + Date.now()).toString(16)}_${crypto.randomBytes(3).toString('hex')}`,
  ];
  return patterns[index % patterns.length]();
}

const USER_AGENTS = [
  // Win10 Chrome（主流）
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Win11 Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Mac Safari（模拟Mac用户）
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

// Accept 头轮换
const ACCEPT_HEADERS = [
  'application/json, text/plain, */*',
  'application/json, text/plain, text/html, */*',
  'application/json, */*; q=0.8',
  'application/json, text/plain, text/html, application/xhtml+xml, */*; q=0.9',
];

// 模拟CDN缓存链
const CDN_NODES = [
  'cloudflare',
  'aliyun-cdn',
  'tencent-cdn',
  'baishan-cdn',
  'wangsu-cdn',
  'china-cache',
  'cdn77',
];

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// 签名 & API（带极致IP伪装）
// ============================================================
function makeSign(method, path, timestamp, bodyStr) {
  const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(data);
  return hmac.digest('hex');
}

let _antiDetectIndex = 0;
function setAntiDetectIndex(idx) { _antiDetectIndex = idx; }

function buildAntiDetectHeaders(loopIndex) {
  const idx = loopIndex;
  const fakeIp = generateRealisticIp(idx);
  const ua = USER_AGENTS[idx % USER_AGENTS.length];
  const cdnNode = CDN_NODES[idx % CDN_NODES.length];

  // 浏览器语言偏好
  const langs = [
    'zh-CN,zh;q=0.9',
    'zh-CN,zh;q=0.9,en;q=0.8',
    'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7',
    'zh-CN,zh;q=0.8,en;q=0.7',
  ];

  // Sec-CH-UA （浏览器客户端提示）- 参考 v7.js 风格
  const secChUas = [
    '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    '"Microsoft Edge";v="122", "Chromium";v="122", "Not:A-Brand";v="24"',
    '"Google Chrome";v="124", "Not:A-Brand";v="8", "Chromium";v="124"',
    '"Firefox";v="124", "Firefox";v="124", "Not/A:B";v="99"',
    '"Google Chrome";v="125", "Not:A-Brand";v="8", "Chromium";v="125"',
  ];

  // v7.js 风格：简单有效的 IP 伪装
  // 只用 X-Forwarded-For + X-Real-IP，避免 CDN 头中的非 ASCII 字符
  const headers = {
    // 🛡️ IP伪装（核心防封：每个账号独立IP）
    'X-Forwarded-For': fakeIp,
    'X-Real-IP': fakeIp,
    'X-Client-IP': fakeIp,
    'X-Originating-IP': fakeIp,

    // 🛡️ 浏览器指纹
    'User-Agent': ua,
    'Accept': ACCEPT_HEADERS[idx % ACCEPT_HEADERS.length],
    'Accept-Language': langs[idx % langs.length],
    'Accept-Encoding': 'gzip, deflate, br',

    // 🛡️ Sec-CH-UA 客户端提示（Chrome/Edge特有）
    'Sec-CH-UA': secChUas[idx % secChUas.length],
    'Sec-CH-UA-Platform': idx % 4 === 0 ? '"macOS"' : '"Windows"',
    'Sec-CH-UA-Mobile': '?0',

    // 🛡️ Fetch元数据
    'Sec-Fetch-Site': ['none', 'same-origin', 'same-site', 'cross-site'][idx % 4],
    'Sec-Fetch-Mode': ['cors', 'no-cors', 'navigate'][idx % 3],
    'Sec-Fetch-Dest': 'empty',

    // 🛡️ CDN缓存头（仅用ASCII字符，避免中文导致HTTP协议错误）
    'Via': `1.1 ${cdnNode}`,
    'X-Cache': ['HIT', 'MISS'][idx % 2],

    // 🛡️ 连接头
    'Connection': 'keep-alive',
    'Cache-Control': ['no-cache', 'max-age=0', 'private', 'no-store'][idx % 4],

    // 🛡️ DNT
    'DNT': idx % 3 === 0 ? '1' : '0',
  };

  return headers;
}

async function apiRequest(method, path, token, body) {
  if (token === undefined) token = '';
  if (body === undefined) body = null;
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, timestamp, bodyStr);

  // 基础头
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(timestamp),
    'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  // 🛡️ 叠加反检测头
  const detectHeaders = buildAntiDetectHeaders(_antiDetectIndex);
  Object.assign(headers, detectHeaders);

  const url = API_BASE + path;
  const opts = { method, headers, timeout: 30000 };
  if (bodyStr) opts.body = bodyStr;

  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(text.slice(0, 200)); }
    if (!data || data.ok === false) { throw new Error(data && data.error ? data.error : '请求失败'); }
    return data;
  } catch (e) {
    if (e.message.includes('请求失败')) throw e;
    throw new Error(path + ' 请求失败: ' + e.message);
  }
}

// ============================================================
// 日志
// ============================================================
function log(level, tag, msg) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const icons = { INFO: 'ℹ', OK: '✓', WARN: '⚠', ERR: '✗' };
  console.log('[' + ts + '] [' + tag + '] ' + (icons[level] || '') + ' ' + msg);
}
function info(tag, msg) { log('INFO', tag, msg); }
function ok(tag, msg) { log('OK', tag, msg); }
function warn(tag, msg) { log('WARN', tag, msg); }
function err(tag, msg) { log('ERR', tag, msg); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function int(v, def) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : def; }

// ============================================================
// 读取被封账号
// ============================================================
function loadBannedAccounts(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const lines = fs.readFileSync(filepath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
  const accounts = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || !trimmed.startsWith('#BANNED')) continue;
    // 格式: #BANNED:xxx username,password,invitecode
    // 去掉 #BANNED 前缀
    const afterBanned = trimmed.replace(/^#BANNED/, '').trim();
    const parts = afterBanned.split(',').map(s => s.trim());
    if (parts.length < 2) continue;
    // 从 parts[0] 中提取用户名（末尾的字母数字部分）
    const usernameMatch = parts[0].match(/([a-zA-Z0-9_]+)$/);
    if (!usernameMatch) continue;
    const username = usernameMatch[1];
    const password = parts[1];
    const inviteCode = parts.length >= 3 ? parts[2] : '';
    const newUsername = username + '_v2';
    accounts.push({
      oldUsername: username,
      newUsername: newUsername,
      password: password,
      inviteCode: inviteCode,
      playerName: newUsername
    });
  }
  return accounts;
}

// ============================================================
// 注册单个账号
// ============================================================
// 对已存在账号执行补全操作（登录+角色创建+技能+铁剑+吐纳法+地图）
async function setupExistingAccount(token, acc, loopIndex) {
  // 可能角色已存在，尝试创建角色（如果已创建会抛异常）
  try {
    const createBody = { name: acc.newUsername, spirit_roots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 } };
    await apiRequest('POST', '/player/create', token, createBody);
    ok(acc.newUsername, '角色创建成功');
    await randomDelay(1000, 2000);
  } catch (e) {
    info(acc.newUsername, '角色已存在，跳过创建');
  }

  // 绑定邀请码
  if (acc.inviteCode) {
    try {
      await apiRequest('POST', '/invite/bind', token, { invite_code: acc.inviteCode });
      ok(acc.newUsername, '邀请码绑定成功');
    } catch (e) {
      info(acc.newUsername, '邀请码可能已绑定: ' + e.message);
    }
    await randomDelay(1000, 2000);
  }

  // 装备3个初始技能
  const starterSkills = [
    { id: 1, name: '重击' },
    { id: 2, name: '火球术' },
    { id: 3, name: '治疗术' }
  ];
  for (const sk of starterSkills) {
    try {
      await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
      ok(acc.newUsername, sk.name + ' 装备成功');
    } catch (e) {
      if (e.message.includes('已装备')) {
        info(acc.newUsername, sk.name + ' 已装备');
      } else {
        warn(acc.newUsername, sk.name + ' 装备失败: ' + e.message);
      }
    }
    await sleep(200);
  }
  await randomDelay(1000, 2000);

  // 装备铁剑
  try {
    const sync = await apiRequest('GET', '/player/sync', token);
    const inv = sync && sync.player && sync.player.inventory ? sync.player.inventory : [];
    let found = false;
    for (let p = 0; p < inv.length && !found; p++) {
      if (!inv[p]) continue;
      for (let s = 0; s < inv[p].length && !found; s++) {
        const slot = inv[p][s];
        if (slot && slot.item && slot.item.name && slot.item.name.includes('铁剑')) {
          await apiRequest('POST', '/player/equip', token, { page: p, slot_index: s, expect_item_id: int(slot.item.id, 0) });
          ok(acc.newUsername, '铁剑装备成功');
          found = true;
        }
      }
    }
    if (!found) warn(acc.newUsername, '未找到铁剑');
  } catch (e) {
    warn(acc.newUsername, '装备铁剑失败: ' + e.message);
  }

  await randomDelay(1000, 2000);

  // 设置吐纳法
  try {
    await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
    ok(acc.newUsername, '吐纳法设置成功');
  } catch (e) {
    warn(acc.newUsername, '设置功法失败: ' + e.message);
  }

  await randomDelay(1000, 2000);

  // 切换地图
  try {
    await apiRequest('POST', '/player/set_map', token, { map_id: 1 });
    ok(acc.newUsername, '已切换至荒石村');
  } catch (e) {
    warn(acc.newUsername, '切换地图失败: ' + e.message);
  }
}

async function registerAccount(acc, loopIndex) {
  const result = {
    oldUsername: acc.oldUsername,
    newUsername: acc.newUsername,
    success: false,
    accountId: 0,
    error: '',
    existed: false
  };

  try {
    setAntiDetectIndex(loopIndex);
    const machineId = generateMachineId(loopIndex);

    // 第1步：尝试注册
    info(acc.newUsername, '正在注册...');
    let token, accountId;

    try {
      const regBody = { username: acc.newUsername, password: acc.password, machine_id: machineId };
      const regData = await apiRequest('POST', '/auth/register', '', regBody);
      token = regData.token;
      accountId = int(regData.accountId, 0);
      ok(acc.newUsername, '注册成功, accountId=' + accountId);
      result.existed = false;

      await randomDelay(1500, 3000);

      // 第2步：创建角色
      info(acc.newUsername, '正在创建角色...');
      const createBody = { name: acc.newUsername, spirit_roots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 } };
      await apiRequest('POST', '/player/create', token, createBody);
      ok(acc.newUsername, '角色创建成功');
      await randomDelay(1000, 2000);

      // 第3步：绑定邀请码
      if (acc.inviteCode) {
        info(acc.newUsername, '正在绑定邀请码: ' + acc.inviteCode);
        try {
          await apiRequest('POST', '/invite/bind', token, { invite_code: acc.inviteCode });
          ok(acc.newUsername, '邀请码绑定成功');
        } catch (e) {
          warn(acc.newUsername, '绑定邀请码失败: ' + e.message);
        }
        await randomDelay(1000, 2000);
      }
    } catch (e) {
      if (e.message.includes('用户名已存在')) {
        info(acc.newUsername, '账号已存在，尝试登录补全...');
        result.existed = true;
        // 登录获取token
        const loginBody = { username: acc.newUsername, password: acc.password, machine_id: machineId };
        const loginData = await apiRequest('POST', '/auth/login', '', loginBody);
        token = loginData.token;
        accountId = int(loginData.accountId, 0);
        ok(acc.newUsername, '登录成功, accountId=' + accountId);
        await randomDelay(2000, 4000);
        // 执行补全
        await setupExistingAccount(token, acc, loopIndex);
        result.success = true;
        result.accountId = accountId;
        return result;
      }
      throw e;
    }

    // 第4步：装备3个初始技能
    info(acc.newUsername, '正在装备初始技能...');
    const starterSkills = [
      { id: 1, name: '重击' },
      { id: 2, name: '火球术' },
      { id: 3, name: '治疗术' }
    ];
    for (const sk of starterSkills) {
      try {
        await apiRequest('POST', '/player/equip_skill', token, { skill_id: sk.id });
        ok(acc.newUsername, sk.name + ' 装备成功');
      } catch (e) {
        if (e.message.includes('已装备')) {
          info(acc.newUsername, sk.name + ' 已装备');
        } else {
          warn(acc.newUsername, sk.name + ' 装备失败: ' + e.message);
        }
      }
      await sleep(200);
    }

    await randomDelay(1000, 2000);

    // 第5步：装备铁剑
    info(acc.newUsername, '正在装备铁剑...');
    try {
      const sync = await apiRequest('GET', '/player/sync', token);
      const inv = sync && sync.player && sync.player.inventory ? sync.player.inventory : [];
      let found = false;
      for (let p = 0; p < inv.length && !found; p++) {
        if (!inv[p]) continue;
        for (let s = 0; s < inv[p].length && !found; s++) {
          const slot = inv[p][s];
          if (slot && slot.item && slot.item.name && slot.item.name.includes('铁剑')) {
            await apiRequest('POST', '/player/equip', token, { page: p, slot_index: s, expect_item_id: int(slot.item.id, 0) });
            ok(acc.newUsername, '铁剑装备成功');
            found = true;
          }
        }
      }
      if (!found) warn(acc.newUsername, '未找到铁剑');
    } catch (e) {
      warn(acc.newUsername, '装备铁剑失败: ' + e.message);
    }

    await randomDelay(1000, 2000);

    // 第6步：设置吐纳法
    try {
      await apiRequest('POST', '/player/set_technique', token, { slot: 'main', technique_id: 1 });
      ok(acc.newUsername, '吐纳法设置成功');
    } catch (e) {
      warn(acc.newUsername, '设置功法失败: ' + e.message);
    }

    await randomDelay(1000, 2000);

    // 第7步：切换地图
    try {
      await apiRequest('POST', '/player/set_map', token, { map_id: 1 });
      ok(acc.newUsername, '已切换至荒石村');
    } catch (e) {
      warn(acc.newUsername, '切换地图失败: ' + e.message);
    }

    result.success = true;
    result.accountId = accountId;
  } catch (e) {
    result.error = e.message;
    err(acc.newUsername, '处理失败: ' + e.message);
  }

  return result;
}

// ============================================================
// 保存新账号到文件
// ============================================================
function appendNewAccounts(filepath, results) {
  const successful = results.filter(r => r.success);
  if (successful.length === 0) return 0;

  let content = fs.readFileSync(filepath, 'utf-8');
  // 去掉末尾空行
  content = content.replace(/\s+$/, '');
  content += '\n\n# === 重新注册（_v2）替换被封账号 ===\n';

  for (const r of successful) {
    // 找原密码和邀请码
    const lines = fs.readFileSync(filepath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
    let password = '';
    let inviteCode = '';
    for (const line of lines) {
      if (line.includes(r.oldUsername)) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          password = parts[parts.length - 2].replace(/^#[^,]*\s*/, '').trim();
          inviteCode = parts.length >= 3 ? parts[parts.length - 1].trim() : '';
        }
        break;
      }
    }
    content += r.newUsername + ',' + (password || 'qwertyuiop') + (inviteCode ? ',' + inviteCode : '') + '\n';
  }

  fs.writeFileSync(filepath, content, 'utf-8');
  return successful.length;
}

// ============================================================
// Banner
// ============================================================
function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  艾德尔修仙传 - 封号替换重新注册工具 v1.1 🛡️          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  读取 #BANNED 账号，生成 _v2 后缀重新注册             ║');
  console.log('║  原密码 + 原邀请码不变                                ║');
  console.log('║  🛡️ 极致IP伪装 v2.0:                                 ║');
  console.log('║     · 模拟真实中国运营商IP（电信/联通/移动）          ║');
  console.log('║     · 每个账号完全独立IP（不共享）                     ║');
  console.log('║     · 多省份地区分布（广东/北京/上海/浙江...）        ║');
  console.log('║     · CDN代理链模拟（Via/X-Cache）                    ║');
  console.log('║     · 完整浏览器指纹（Sec-CH-UA/Accept-Language等）   ║');
  console.log('║     · 独立machine_id + 随机延迟 1-5s                  ║');
  console.log('║  🛡️ 智能分段: 每3个暂停 20-40 秒                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  showBanner();

  const filepath = './accounts.txt';
  const accounts = loadBannedAccounts(filepath);

  if (accounts.length === 0) {
    console.log('❌ 未找到 #BANNED 标记的账号');
    process.exit(1);
  }

  console.log('📂 账号文件: ' + filepath);
  console.log('📋 需要重新注册: ' + accounts.length + ' 个');
  console.log('');
  console.log('新用户名预览（前10个）:');
  for (let i = 0; i < Math.min(10, accounts.length); i++) {
    console.log('  ' + accounts[i].oldUsername + ' → ' + accounts[i].newUsername);
  }
  if (accounts.length > 10) console.log('  ... 共 ' + accounts.length + ' 个');
  console.log('');

  // 交互确认
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!autoYes) {
    const confirm = await ask('是否开始重新注册? (Y/n): ');
    if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
      console.log('已取消');
      process.exit(0);
    }
  }

  // 🛡️ 预热延迟
  console.log('');
  info('🛡️ 预热', '等待 8-15 秒后开始注册...');
  await randomDelay(8000, 15000);

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log('');
    console.log('═══ 注册 [' + (i + 1) + '/' + accounts.length + '] ' + acc.newUsername + ' ═══');

    const r = await registerAccount(acc, i);
    results.push(r);

    // 🛡️ 账号间随机延迟 4-10 秒
    if (i < accounts.length - 1) {
      const delayMs = randomDelay(4000, 10000);
      info('引擎', '等待后注册下一个');
      await delayMs;
    }

    // 🛡️ 智能分段：每3个暂停
    if ((i + 1) % 3 === 0 && i < accounts.length - 1) {
      console.log('');
      info('🛡️ 暂停', '已注册 ' + (i + 1) + ' 个，休息 20-40 秒...');
      await randomDelay(20000, 40000);
    }
  }

  // 统计
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 注册结果');
  console.log('═══════════════════════════════════════════════');
  console.log('  总账号: ' + accounts.length);
  console.log('  ✅ 成功: ' + successCount);
  console.log('  ❌ 失败: ' + failCount);
  console.log('');

  // 追加新账号到文件
  if (successCount > 0) {
    const appended = appendNewAccounts(filepath, results);
    ok('文件', '已将 ' + appended + ' 个新账号追加到 ' + filepath);
  }

  // 列出失败
  if (failCount > 0) {
    console.log('❌ 失败的账号:');
    for (const r of results.filter(r => !r.success)) {
      console.log('  ' + r.newUsername + ': ' + r.error);
    }
  }

  if (!autoYes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('按回车键退出...', () => { rl.close(); });
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

main().catch(e => {
  console.error('程序异常:', e.message);
  console.error(e.stack);
  process.exit(1);
});
