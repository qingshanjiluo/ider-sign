/**
 * 邮件领取 + 使用筑基丹脚本 📬
 * 功能:
 *   1. 登录账号
 *   2. GET /mail/list 查看未领取邮件
 *   3. POST /mail/claim_all 一键领取所有邮件
 *   4. GET /player/sync 获取背包
 *   5. 搜索筑基丹(itemId=1) → POST /player/use_item
 *
 * 使用: node mail_claim_and_use.js
 * CI模式: set CI=true && set ACCOUNTS_DATA=... && node mail_claim_and_use.js
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const antiDetect = require('./_anti_detect_shared');

// ============================================================
// 常量
// ============================================================
const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const MAX_RETRY = 3;
const PILL_ITEM_ID = 1;  // 筑基丹
const PILL_NAME = '筑基丹';
const MAX_PILLS_TO_USE = 5;

// ============================================================
// CI 检测
// ============================================================
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

function getEnvInt(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// ============================================================
// 🛡️ 反检测全局索引
// ============================================================
let _apiAccountIndex = 0;
let _apiCallCounter = 0;

function setApiAccountIndex(idx) {
  _apiAccountIndex = idx;
  _apiCallCounter = 0;
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

async function apiRequest(method, path, token, body, extraHeaders) {
  if (token === undefined) token = '';
  if (body === undefined) body = null;
  if (extraHeaders === undefined) extraHeaders = {};
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

  // 🛡️ 注入反检测头
  const antiHeaders = antiDetect.buildAntiDetectHeaders(_apiAccountIndex + (_apiCallCounter % 100));
  Object.assign(headers, antiHeaders);
  _apiCallCounter++;

  Object.assign(headers, extraHeaders);

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function int(v, def) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : def; }

// ============================================================
// 账号
// ============================================================
class Account {
  constructor(username, password) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.token = '';
    this.accountId = 0;
    this._antiIdx = 0;
  }
  isValid() { return this.username.length >= 2 && this.password.length >= 6; }
}

function loadAccounts(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const lines = fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  const accounts = [];
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const acc = new Account(parts[0], parts[1]);
      if (acc.isValid()) accounts.push(acc);
    }
  }
  return accounts;
}

// ============================================================
// 邮件领取+使用丹药引擎
// ============================================================
class MailPillEngine {
  constructor(account) {
    this.account = account;
    this.stats = {
      loginSuccess: false,
      mailsListed: 0,
      mailsClaimed: 0,
      pillsFound: 0,
      pillsUsed: 0,
      errors: []
    };
  }

  async delay(ms) {
    if (ms <= 0) return;
    await sleep(ms);
  }

  /** 1. 登录 */
  async login() {
    info(this.account.username, '正在登录...');
    const idx = this.account._antiIdx || 0;
    const loginBody = antiDetect.buildLoginBody(this.account.username, this.account.password, idx);
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('POST', '/auth/login', '', loginBody, antiHeaders);
    this.account.token = data.token;
    this.account.accountId = int(data.accountId, 0);
    this.stats.loginSuccess = true;
    ok(this.account.username, '登录成功, accountId=' + this.account.accountId);
    return true;
  }

  /** 2. 获取邮件列表 */
  async listMails() {
    info(this.account.username, '正在查询邮件...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 10);
    const data = await apiRequest('GET', '/mail/list', this.account.token, null, antiHeaders);
    const mails = data.mails || [];
    this.stats.mailsListed = mails.length;
    const unclaimed = mails.filter(m => !m.claimed);
    info(this.account.username, `共有 ${mails.length} 封邮件，未领取 ${unclaimed.length} 封`);
    return mails;
  }

  /** 3. 一键领取所有未读邮件 */
  async claimAll() {
    info(this.account.username, '正在领取邮件...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 20);
    try {
      const data = await apiRequest('POST', '/mail/claim_all', this.account.token, {}, antiHeaders);
      this.stats.mailsClaimed = int(data.claimed_count, 0);
      if (this.stats.mailsClaimed > 0) {
        ok(this.account.username, `领取了 ${this.stats.mailsClaimed} 封邮件`);
      } else {
        info(this.account.username, '没有未领取邮件');
      }
      return data;
    } catch (e) {
      // 如果claim_all失败，尝试逐个领取
      warn(this.account.username, `一键领取失败: ${e.message}，尝试逐个领取...`);
      const mails = await this.listMails();
      let claimed = 0;
      for (const mail of mails) {
        if (mail.claimed) continue;
        try {
          const antiHeaders2 = antiDetect.buildAntiDetectHeaders(idx + 20 + claimed);
          await apiRequest('POST', '/mail/claim/' + mail.id, this.account.token, {}, antiHeaders2);
          claimed++;
          await antiDetect.randomDelay(300, 600);
        } catch (e2) {
          warn(this.account.username, `领取邮件 #${mail.id} 失败: ${e2.message}`);
        }
      }
      this.stats.mailsClaimed = claimed;
      if (claimed > 0) ok(this.account.username, `逐个领取了 ${claimed} 封邮件`);
      return { ok: true, claimed_count: claimed };
    }
  }

  /** 4. 查找并使用筑基丹 */
  async usePills() {
    info(this.account.username, '正在查找筑基丹...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 30);

    try {
      // 获取背包
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.player : data;
      const inventory = player.inventory || [];

      let used = 0;
      for (let p = 0; p < inventory.length; p++) {
        const row = inventory[p];
        if (!Array.isArray(row)) continue;
        for (let s = 0; s < row.length; s++) {
          const slot = row[s];
          if (!slot || !slot.item) continue;
          const item = slot.item;
          const itemId = int(item.id, 0);
          // 通过itemId=1（筑基丹）匹配，也可以按名称匹配
          const name = String(item.name || '').toLowerCase();
          const isPill = (itemId === PILL_ITEM_ID) ||
                         (name.includes('筑基丹')) ||
                         (name.includes('筑基') && String(item.type || '').toLowerCase() === 'consumable');

          if (isPill) {
            const count = Math.min(int(slot.count, 1), MAX_PILLS_TO_USE - used);
            if (count <= 0) continue;

            const body = {
              page: p,
              slot_index: s,
              count: count,
              expect_item_id: itemId
            };
            try {
              const result = await apiRequest('POST', '/player/use_item', this.account.token, body, antiHeaders);
              const usedCount = int(result.used_count, count);
              used += usedCount;
              ok(this.account.username, `使用筑基丹 x${usedCount}`);
              await antiDetect.randomDelay(500, 1000);
            } catch (e) {
              warn(this.account.username, `使用筑基丹失败: ${e.message}`);
            }
            if (used >= MAX_PILLS_TO_USE) break;
          }
        }
        if (used >= MAX_PILLS_TO_USE) break;
      }

      this.stats.pillsFound = used;
      this.stats.pillsUsed = used;
      if (used > 0) {
        ok(this.account.username, `共使用 ${used} 枚筑基丹`);
      } else {
        info(this.account.username, '背包中没有筑基丹');
      }
      return used;
    } catch (e) {
      warn(this.account.username, `查找筑基丹失败: ${e.message}`);
      return 0;
    }
  }

  /** 完整流程 */
  async run() {
    const acc = this.account;
    const idx = acc._antiIdx || 0;
    const ipInfo = antiDetect.getIpInfo(idx);

    info('📬', '================ 邮件筑基丹脚本 ================');
    info('📬', '账号: ' + acc.username);
    info('📬', '🛡️ 反检测: IP=' + ipInfo.ip + ' (' + ipInfo.isp + '·' + ipInfo.province + ')');

    // 1. 登录
    await this.login();
    await antiDetect.randomDelay(800, 1500);

    // 2. 查询邮件
    await this.listMails();
    await antiDetect.randomDelay(500, 1000);

    // 3. 领取所有邮件
    await this.claimAll();
    await antiDetect.randomDelay(1000, 2000);

    // 4. 使用筑基丹
    await this.usePills();

    // 输出
    console.log('');
    console.log('══════ 邮件筑基丹结果 ══════');
    console.log('  账号:         ' + acc.username);
    console.log('  登录:         ' + (this.stats.loginSuccess ? '✅' : '❌'));
    console.log('  邮件总数:     ' + this.stats.mailsListed);
    console.log('  已领取:       ' + this.stats.mailsClaimed);
    console.log('  筑基丹使用:   ' + this.stats.pillsUsed + ' 枚');
    console.log('═══════════════════════════');
    console.log('');

    return this.stats;
  }
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(results) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'mail_pill_result_' + ts + '.json';
  try {
    fs.writeFileSync(filename, JSON.stringify(results, null, 2), 'utf-8');
    info('保存', '结果已保存: ' + filename);
  } catch (e) {
    warn('保存', '保存失败: ' + e.message);
  }
}

// ============================================================
// 交互输入
// ============================================================
function ask(question) {
  if (IS_CI) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    邮件领取 + 筑基丹使用脚本 v1.0          ║');
  console.log('║    API: /mail/list /mail/claim_all          ║');
  console.log('║          /player/use_item                   ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  🛡️ 反检测: IP伪装/独立指纹/随机延迟       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  showBanner();

  // 查找账号文件
  let filepath = './alchemy_accounts.txt';
  if (!fs.existsSync(filepath)) filepath = './accounts.txt';
  if (!fs.existsSync(filepath)) {
    console.log('未找到账号文件，请创建 alchemy_accounts.txt');
    if (IS_CI) process.exit(1);
    return;
  }

  const accounts = loadAccounts(filepath);
  if (accounts.length === 0) {
    console.log('没有有效账号');
    process.exit(0);
  }

  if (IS_CI) {
    const maxAccounts = Math.min(accounts.length, getEnvInt('MAX_ACCOUNTS', accounts.length));
    const selected = accounts.slice(0, maxAccounts);
    const results = [];
    let hasError = false;

    for (let i = 0; i < selected.length; i++) {
      const acc = selected[i];
      acc._antiIdx = i;
      setApiAccountIndex(i);
      console.log('═══ 邮件筑基丹 [' + (i+1) + '/' + selected.length + ']: ' + acc.username + ' ═══');
      const engine = new MailPillEngine(acc);
      try {
        const stats = await engine.run();
        results.push({ username: acc.username, stats });
        if (stats.errors.length > 0) hasError = true;
      } catch (e) {
        err(acc.username, '失败: ' + e.message);
        results.push({ username: acc.username, error: e.message });
        hasError = true;
      }
      await antiDetect.smartPause(i, selected.length, { batchSize: 2, pauseMin: 15000, pauseMax: 30000 });
      if (i < selected.length - 1) await antiDetect.randomDelay(3000, 5000);
    }

    saveResult({ timestamp: new Date().toISOString(), accounts: results });
    process.exit(hasError ? 1 : 0);
  }

  // 交互模式
  console.log('当前 ' + accounts.length + ' 个账号');
  for (const acc of accounts) console.log('  [' + acc.username + ']');
  const rangeInput = await ask('输入范围 [1-' + accounts.length + ', 全部]: ');
  let selected = accounts;
  if (rangeInput && rangeInput !== '全部') {
    const parts = rangeInput.split('-').map(s => parseInt(s.trim()));
    if (parts.length === 2 && parts[0] > 0 && parts[1] <= accounts.length)
      selected = accounts.slice(parts[0] - 1, parts[1]);
    else if (parts.length === 1 && parts[0] > 0 && parts[0] <= accounts.length)
      selected = [accounts[parts[0] - 1]];
  }

  console.log('选择 ' + selected.length + ' 个账号');
  const confirm = await ask('开始执行? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') { console.log('已取消'); process.exit(0); }

  const results = [];
  let hasError = false;
  for (let i = 0; i < selected.length; i++) {
    const acc = selected[i];
    acc._antiIdx = i;
    setApiAccountIndex(i);
    console.log('═══ 邮件筑基丹 [' + (i+1) + '/' + selected.length + ']: ' + acc.username + ' ═══');
    const engine = new MailPillEngine(acc);
    try {
      const stats = await engine.run();
      results.push({ username: acc.username, stats });
      if (stats.errors.length > 0) hasError = true;
    } catch (e) {
      err(acc.username, '失败: ' + e.message);
      results.push({ username: acc.username, error: e.message });
      hasError = true;
    }
    await antiDetect.smartPause(i, selected.length, { batchSize: 2, pauseMin: 15000, pauseMax: 30000 });
    if (i < selected.length - 1) await antiDetect.randomDelay(3000, 5000);
  }

  saveResult({ timestamp: new Date().toISOString(), accounts: results });
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl2.question('按回车退出...', () => { rl2.close(); });
}

main().catch(e => { console.error('异常:', e.message); process.exit(1); });
