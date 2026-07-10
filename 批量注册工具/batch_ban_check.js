/**
 * 艾德尔修仙传 - 批量封号检测工具 v1.0
 *
 * ════════════════════════════════════════════════════════════
 *  📂 功能说明
 *  ════════════════════════════════════════════════════════════
 *  扫描 accounts.txt 中所有账号，通过登录尝试判断是否被封禁
 *  （服务器返回 ban 相关错误即判定为封号）
 *
 *  输出：
 *    1. 被封号列表 → 打印到控制台
 *    2. 完整结果 → ban_check_result_*.json
 *    3. 可选：自动标记被封号到 accounts.txt（--mark）
 *
 *  使用：
 *    node batch_ban_check.js                仅检测，不修改文件
 *    node batch_ban_check.js --mark         检测 + 标记被封号
 *    node batch_ban_check.js --file=xxx.txt 指定账号文件
 *    CI=true node batch_ban_check.js        CI 模式
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
// 🛡️ 极致IP伪装 v2.0 反检测配置
// ============================================================
// 模拟真实中国运营商IP段（非内网IP！）
const IP_SEGMENTS = [
  { prefix: '61.',   province: '广东' }, { prefix: '59.',   province: '北京' },
  { prefix: '219.',  province: '上海' }, { prefix: '218.',  province: '浙江' },
  { prefix: '222.',  province: '江苏' }, { prefix: '113.',  province: '福建' },
  { prefix: '116.',  province: '湖南' }, { prefix: '118.',  province: '湖北' },
  { prefix: '119.',  province: '四川' }, { prefix: '120.',  province: '广西' },
  { prefix: '106.',  province: '山东' }, { prefix: '111.',  province: '河北' },
  { prefix: '112.',  province: '河南' }, { prefix: '123.',  province: '辽宁' },
  { prefix: '124.',  province: '黑龙江' }, { prefix: '125.',  province: '吉林' },
  { prefix: '175.',  province: '山西' }, { prefix: '36.',   province: '陕西' },
  { prefix: '39.',   province: '云南' }, { prefix: '42.',   province: '贵州' },
  { prefix: '49.',   province: '安徽' }, { prefix: '101.',  province: '江西' },
  { prefix: '110.',  province: '甘肃' }, { prefix: '117.',  province: '新疆' },
  { prefix: '221.',  province: '海南' }, { prefix: '103.',  province: '天津' },
  { prefix: '115.',  province: '重庆' }, { prefix: '171.',  province: '内蒙古' },
  { prefix: '183.',  province: '宁夏' }, { prefix: '202.',  province: '西藏' },
];

// 每个账号完全独立IP
function getFakeIpForIndex(index) {
  const segment = IP_SEGMENTS[index % IP_SEGMENTS.length];
  const c = Math.floor(Math.random() * 255);
  const d = Math.floor(Math.random() * 254) + 1;
  return segment.prefix + c + '.' + d;
}

function getProvinceByIndex(index) {
  return IP_SEGMENTS[index % IP_SEGMENTS.length].province;
}

function generateMachineId(accountIndex) {
  const patterns = [
    () => `web_${crypto.randomBytes(4).toString('hex')}_${Date.now().toString(36).slice(-6)}`,
    () => `canvas_${crypto.randomBytes(6).toString('hex')}`,
    () => { const h = crypto.randomBytes(16).toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; },
    () => `bid_${crypto.randomBytes(8).toString('hex')}`,
    () => `dev_${(accountIndex * 777 + Date.now()).toString(16)}_${crypto.randomBytes(3).toString('hex')}`,
  ];
  return patterns[accountIndex % patterns.length]();
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const ACCEPT_HEADERS = [
  'application/json, text/plain, */*',
  'application/json, text/plain, text/html, */*',
  'application/json, */*; q=0.8',
];

const CDN_NODES = ['cloudflare', 'aliyun-cdn', 'tencent-cdn', 'baishan-cdn', 'wangsu-cdn'];

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
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

let _antiDetectIndex = 0;
function setAntiDetectIndex(idx) { _antiDetectIndex = idx; }

async function apiRequest(method, path, token, body) {
  if (token === undefined) token = '';
  if (body === undefined) body = null;
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, timestamp, bodyStr);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(timestamp),
    'X-Sign': sign
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  // 🛡️ 极致IP伪装 v2.0（修复：去掉中文和非法HTTP头字符）
  const idx = _antiDetectIndex;
  const fakeIp = getFakeIpForIndex(idx);
  const cdnNode = CDN_NODES[idx % CDN_NODES.length];
  const langs = ['zh-CN,zh;q=0.9', 'zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7'];
  headers['X-Forwarded-For'] = fakeIp;
  headers['X-Real-IP'] = fakeIp;
  headers['X-Client-IP'] = fakeIp;
  headers['X-Originating-IP'] = fakeIp;
  headers['User-Agent'] = USER_AGENTS[idx % USER_AGENTS.length];
  headers['Accept'] = ACCEPT_HEADERS[idx % ACCEPT_HEADERS.length];
  headers['Accept-Language'] = langs[idx % langs.length];
  headers['Accept-Encoding'] = 'gzip, deflate, br';
  headers['Sec-CH-UA'] = `"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"`;
  headers['Sec-CH-UA-Platform'] = idx % 4 === 0 ? '"macOS"' : '"Windows"';
  headers['Sec-CH-UA-Mobile'] = '?0';
  headers['Sec-Fetch-Site'] = ['none', 'same-origin', 'same-site', 'cross-site'][idx % 4];
  headers['Sec-Fetch-Mode'] = ['cors', 'no-cors', 'navigate'][idx % 3];
  headers['Sec-Fetch-Dest'] = 'empty';
  headers['Via'] = `1.1 ${cdnNode}`;
  headers['X-Cache'] = ['HIT', 'MISS'][idx % 2];
  headers['DNT'] = idx % 3 === 0 ? '1' : '0';
  headers['Connection'] = 'keep-alive';
  headers['Cache-Control'] = ['no-cache', 'max-age=0', 'private', 'no-store'][idx % 4];

  const url = API_BASE + path;
  const opts = { method, headers, timeout: 30000 };
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

const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

// ============================================================
// 账号结构
// ============================================================
class Account {
  constructor(username, password) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.machineId = '';
    this.fakeIp = '';
  }
  isValid() {
    return this.username.length >= 2 && this.password.length >= 6;
  }
}

// ============================================================
// 加载账号文件（保留行号和原始行内容）
// ============================================================
function loadAccounts(filepath) {
  if (!fs.existsSync(filepath)) return { accounts: [], lines: [] };
  const lines = fs.readFileSync(filepath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
  const accounts = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    // 去掉行首的 # 或 #BANNED: 前缀
    const cleanLine = trimmed.replace(/^#(?:BANNED[^,]*)?\s*/, '').trim();
    if (!cleanLine) continue;
    const parts = cleanLine.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const username = parts[0];
      // 🛡️ 过滤掉非有效用户名（含中文、格式说明的跳过）
      if (/[^\x20-\x7F]/.test(username) || username.length > 30 || username.includes('格式')) continue;
      const acc = new Account(username, parts[1]);
      if (acc.isValid()) {
        const idx = accounts.length;
        acc.machineId = generateMachineId(idx);
        acc.fakeIp = getFakeIpForIndex(idx);
        acc._lineIndex = i;            // 原始行号
        acc._rawLine = raw;            // 原始行内容
        acc._isCommented = raw.trim().startsWith('#'); // 是否已注释
        accounts.push(acc);
      }
    }
  }
  return { accounts, lines };
}

// ============================================================
// 封号检测
// ============================================================
function isBanError(errorMessage) {
  if (!errorMessage) return false;
  const msg = errorMessage.toLowerCase();
  // 封禁相关关键词
  const banKeywords = [
    '封禁', 'ban', '被封', '冻结', '停封',
    '账号已被', '禁止登录', '已封禁',
    'ban_expires', '禁言',
    'machine_share', '共享设备'
  ];
  return banKeywords.some(k => msg.includes(k));
}

// 扫描单个账号
async function scanAccount(acc, loopIndex) {
  const result = {
    username: acc.username,
    lineIndex: acc._lineIndex,
    loopIndex: loopIndex,
    isCommented: acc._isCommented,
    status: 'unknown',  // 'ok' | 'banned' | 'error'
    error: '',
    banReason: '',
    accountId: 0
  };

  try {
    // 🛡️ 使用循环索引而非文件行号，确保与 IP/machine_id 分配一致
    setAntiDetectIndex(loopIndex);
    const machineId = acc.machineId;
    const body = { username: acc.username, password: acc.password, machine_id: machineId };
    const data = await apiRequest('POST', '/auth/login', '', body);
    result.status = 'ok';
    result.accountId = int(data.accountId, 0);
  } catch (e) {
    const msg = e.message;
    result.error = msg;
    if (isBanError(msg)) {
      result.status = 'banned';
      result.banReason = msg;
    } else {
      // 非封禁错误（网络错误、密码错误等）
      result.status = 'error';
    }
  }

  return result;
}

// ============================================================
// 标记被封账号到文件
// ============================================================
function markBannedInFile(filepath, banResults) {
  const { lines } = loadAccounts(filepath);
  const modifiedLines = [...lines];
  let markCount = 0;

  for (const r of banResults) {
    if (r.status !== 'banned') continue;
    const idx = r.lineIndex;
    if (idx < 0 || idx >= modifiedLines.length) continue;

    const rawLine = modifiedLines[idx];
    const trimmed = rawLine.trim();
    const cleanLine = trimmed.replace(/^#(?:BANNED[^,]*)?\s*/, '').trim();
    if (!cleanLine) continue;

    // 检查是否已经标记过 #BANNED
    if (/^#BANNED/i.test(trimmed)) continue;

    // 添加 #BANNED 前缀
    const banReason = r.banReason ? r.banReason.replace(/,/g, ';') : '封禁';
    modifiedLines[idx] = rawLine.replace(trimmed, `#BANNED:${banReason} ${cleanLine}`);
    markCount++;
  }

  fs.writeFileSync(filepath, modifiedLines.join('\n'), 'utf-8');
  return markCount;
}

// ============================================================
// Banner
// ============================================================
function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  艾德尔修仙传 - 批量封号检测工具 v1.0 🛡️              ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  通过登录尝试判断账号是否被封禁                       ║');
  console.log('║  封禁检测关键词: 封禁/ban/冻结/禁止登录/共享设备      ║');
  console.log('║                                                      ║');
  console.log('║  使用 --mark 参数可自动标记被封号到文件              ║');
  console.log('║  🛡️ 反检测保护已启用（独立 machine_id + IP + 随机延迟）║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(result) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'ban_check_result_' + ts + '.json';
  try {
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf-8');
    info('保存', '结果已保存: ' + filename);
  } catch (e) {
    warn('保存', '保存失败: ' + e.message);
  }
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  showBanner();

  const args = process.argv.slice(2);
  const shouldMark = args.includes('--mark');
  const autoYes = args.includes('--yes') || args.includes('-y');
  let filepath = './accounts.txt';
  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      filepath = arg.slice(7);
    }
  }

  // CI 模式
  if (IS_CI) {
    if (process.env.ACCOUNTS_DATA) {
      fs.writeFileSync(filepath, process.env.ACCOUNTS_DATA, 'utf-8');
    }
    if (process.env.ACCOUNTS_BASE64) {
      const buf = Buffer.from(process.env.ACCOUNTS_BASE64, 'base64');
      fs.writeFileSync(filepath, buf.toString('utf-8'), 'utf-8');
    }
  }

  const { accounts, lines } = loadAccounts(filepath);
  if (accounts.length === 0) {
    console.log('❌ 未找到有效账号');
    process.exit(1);
  }

  console.log('📂 账号文件: ' + filepath);
  console.log('👤 有效账号: ' + accounts.length + ' 个');
  console.log('🔍 模式: ' + (shouldMark ? '检测 + 标记封号' : '仅检测'));
  console.log('');

  // 非 CI 交互确认
  if (!IS_CI && !autoYes) {
    const confirm = await ask('是否开始扫描? (Y/n): ');
    if (confirm.toLowerCase() === 'n') {
      console.log('已取消');
      process.exit(0);
    }
  }

  const results = [];
  console.log('');

  // 🛡️ 首账号前先等 5-10 秒，避免扫描模式被识别
  info('🛡️ 预热', '等待 5-10 秒后开始扫描...');
  await randomDelay(5000, 10000);

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log('');
    console.log('═══ [' + (i + 1) + '/' + accounts.length + '] ' + acc.username + ' ═══');

    try {
      const r = await scanAccount(acc, i);
      results.push(r);

      if (r.status === 'ok') {
        ok(acc.username, '正常 (accountId=' + r.accountId + ')');
      } else if (r.status === 'banned') {
        warn(acc.username, '🚫 被封禁! 原因: ' + r.banReason);
      } else {
        err(acc.username, '连接失败: ' + r.error);
      }
    } catch (e) {
      err(acc.username, '扫描异常: ' + e.message);
      results.push({
        username: acc.username,
        lineIndex: acc._lineIndex,
        isCommented: acc._isCommented,
        status: 'error',
        error: e.message
      });
    }

    // 🛡️ 账号间随机延迟 4-10 秒（比之前跨度更大）
    if (i < accounts.length - 1) {
      const delayMs = randomDelay(4000, 10000);
      const nextIdx = (i + 2 > accounts.length) ? '' : ('下一个: ' + accounts[i + 1].username);
      info('引擎', '等待后处理 ' + nextIdx);
      await delayMs;
    }

    // 🛡️ 智能分段：每 3 个账号暂停 20-40 秒（更保守）
    if ((i + 1) % 3 === 0 && i < accounts.length - 1) {
      console.log('');
      info('🛡️ 暂停', '已扫描 ' + (i + 1) + ' 个，休息 20-40 秒...');
      await randomDelay(20000, 40000);
    }
  }

  // 统计
  const total = results.length;
  const okCount = results.filter(r => r.status === 'ok').length;
  const bannedCount = results.filter(r => r.status === 'banned').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 扫描结果');
  console.log('═══════════════════════════════════════════════');
  console.log('  总账号: ' + total);
  console.log('  ✅ 正常: ' + okCount);
  console.log('  🚫 被封: ' + bannedCount);
  console.log('  ❌ 错误: ' + errorCount);
  console.log('');

  // 列出被封账号
  if (bannedCount > 0) {
    console.log('🚫 被封账号列表:');
    for (const r of results.filter(r => r.status === 'banned')) {
      console.log('  [' + r.username + '] ' + r.banReason);
    }
    console.log('');
  }

  // 标记封号到文件
  if (shouldMark && bannedCount > 0) {
    const marked = markBannedInFile(filepath, results.filter(r => r.status === 'banned'));
    if (marked > 0) {
      ok('标记', '已在 ' + filepath + ' 中标记 ' + marked + ' 个被封账号为 #BANNED');
    } else {
      info('标记', '无需标记（可能已标记过）');
    }
  }

  // 保存结果
  const report = {
    timestamp: new Date().toISOString(),
    filepath: filepath,
    totalAccounts: total,
    ok: okCount,
    banned: bannedCount,
    errors: errorCount,
    results: results.map(r => ({
      username: r.username,
      status: r.status,
      banReason: r.banReason || '',
      error: (r.status === 'error' ? r.error : '')
    }))
  };
  saveResult(report);

  if (IS_CI) {
    process.exit(bannedCount > 0 ? 1 : 0);
  }

  // 交互退出
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('按回车键退出...', () => { rl.close(); });
}

function ask(question) {
  if (IS_CI) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

main().catch(e => {
  console.error('程序异常:', e.message);
  console.error(e.stack);
  process.exit(1);
});
