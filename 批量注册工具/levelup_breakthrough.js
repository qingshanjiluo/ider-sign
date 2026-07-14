/**
 * 升级突破脚本 ⬆️
 * 功能:
 *   1. 登录账号 / GET /player/sync 获取当前等级
 *   2. POST /player/level_up 循环升级（每级一次请求）
 *   3. 在突破节点(120/160/200/240/280) 调用 POST /player/breakthrough
 *   4. 继续升级直到"灵石不足"或达到400级封顶
 *
 * 突破等级节点: [120, 160, 200, 240, 280]
 * 封顶等级: 400
 *
 * 使用: node levelup_breakthrough.js
 * CI模式: set CI=true && set ACCOUNTS_DATA=... && node levelup_breakthrough.js
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

// 突破节点（仅在这些等级可以突破）
const BREAKPOINTS = [120, 160, 200, 240, 280];
const MAX_LEVEL = 400;      // 大乘大圆满封顶
const MAX_LEVEL_UP_ATTEMPTS = 2000; // 防止死循环

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
// 升级突破引擎
// ============================================================
class LevelUpEngine {
  constructor(account) {
    this.account = account;
    this.stats = {
      loginSuccess: false,
      levelBefore: 0,
      levelAfter: 0,
      levelsGained: 0,
      breakthroughs: 0,
      breakthroughFailed: 0,
      stuckReason: '',
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

  /** 2. 获取当前等级 */
  async getLevel() {
    try {
      const idx = this.account._antiIdx || 0;
      const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 5);
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.player : data;
      return int(player.level, 0);
    } catch (e) {
      warn(this.account.username, '获取等级失败: ' + e.message);
      return 0;
    }
  }

  /** 3. 升级一级 */
  async levelUpOnce() {
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + (_apiCallCounter % 50));
    const data = await apiRequest('POST', '/player/level_up', this.account.token, {}, antiHeaders);
    return data;
  }

  /** 4. 突破 */
  async doBreakthrough() {
    info(this.account.username, '尝试突破...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 60);
    try {
      const data = await apiRequest('POST', '/player/breakthrough', this.account.token, {}, antiHeaders);
      if (data && data.ok) {
        this.stats.breakthroughs++;
        ok(this.account.username, '突破成功！');
        return true;
      }
      warn(this.account.username, '突破返回异常: ' + JSON.stringify(data));
      return false;
    } catch (e) {
      if (e.message.includes('无法突破') || e.message.includes('条件不足') || e.message.includes('请先突破')) {
        warn(this.account.username, '突破条件不满足: ' + e.message);
        this.stats.breakthroughFailed++;
        return false;
      }
      warn(this.account.username, '突破请求失败: ' + e.message);
      this.stats.breakthroughFailed++;
      return false;
    }
  }

  /** 5. 检查是否需要突破（在突破节点时检查） */
  shouldBreakthrough(level) {
    return BREAKPOINTS.includes(level);
  }

  /** 6. 判断是否为封顶等级（不可再升） */
  isMaxLevel(level) {
    return level >= MAX_LEVEL;
  }

  /** 完整升级流程 */
  async run() {
    const acc = this.account;
    const idx = acc._antiIdx || 0;
    const ipInfo = antiDetect.getIpInfo(idx);

    info('⬆️', '================ 升级突破脚本 ================');
    info('⬆️', '账号: ' + acc.username);
    info('⬆️', '🛡️ 反检测: IP=' + ipInfo.ip + ' (' + ipInfo.isp + '·' + ipInfo.province + ')');
    info('⬆️', '突破节点: ' + JSON.stringify(BREAKPOINTS));

    // 1. 登录
    await this.login();
    await antiDetect.randomDelay(800, 1500);

    // 2. 获取初始等级
    let currentLevel = await this.getLevel();
    if (currentLevel <= 0) {
      err(acc.username, '无法获取等级，跳过');
      this.stats.errors.push('获取等级失败');
      return this.stats;
    }
    this.stats.levelBefore = currentLevel;
    info(acc.username, '当前等级: ' + currentLevel);

    // 3. 升级循环
    let attempts = 0;
    let stuckCount = 0;
    let lastLevel = currentLevel;

    while (attempts < MAX_LEVEL_UP_ATTEMPTS && stuckCount < 10) {
      attempts++;

      // 检查封顶
      if (this.isMaxLevel(currentLevel)) {
        ok(acc.username, '已达到 400 级封顶');
        this.stats.stuckReason = '封顶';
        break;
      }

      // 检查是否需要突破
      if (this.shouldBreakthrough(currentLevel)) {
        info(acc.username, '到达突破节点 ' + currentLevel + ' 级');
        await antiDetect.randomDelay(1000, 2000);
        const btSuccess = await this.doBreakthrough();
        await this.delay(1500);

        if (btSuccess) {
          // 突破成功，重新获取等级（突破可能改变等级）
          currentLevel = await this.getLevel();
          info(acc.username, '突破后等级: ' + currentLevel);
          continue;
        } else {
          // 突破失败，记录并尝试继续（可能条件不足）
          // 突破失败不影响升级循环
          this.stats.errors.push('突破失败 @等级' + currentLevel);
        }
      }

      // 执行升级
      try {
        const result = await this.levelUpOnce();
        currentLevel++;

        // 检查错误信息（如果返回有error）
        if (result.error) {
          if (result.error.includes('灵石不足') || result.error.includes('资源不足') || result.error.includes('灵气不足')) {
            warn(acc.username, '升级停止: ' + result.error);
            this.stats.stuckReason = result.error;
            break;
          }
          if (result.error.includes('已达到大乘大圆满') || result.error.includes('封顶')) {
            ok(acc.username, '已达到封顶等级');
            this.stats.stuckReason = '封顶';
            break;
          }
          if (result.error.includes('请先突破')) {
            warn(acc.username, '需要先突破: ' + result.error);
            // 尝试突破一次
            await antiDetect.randomDelay(1000, 1500);
            await this.doBreakthrough();
            await this.delay(1000);
            // 重新获取等级看看突破是否成功
            const checkLevel = await this.getLevel();
            if (checkLevel !== currentLevel) {
              currentLevel = checkLevel;
              continue;
            }
            // 如果突破没成功，继续升不动则停止
          }
        }

        if (currentLevel % 10 === 0) {
          info(acc.username, '当前等级: ' + currentLevel);
        }

        // 跟踪卡住检测
        if (currentLevel === lastLevel) {
          stuckCount++;
        } else {
          stuckCount = 0;
          lastLevel = currentLevel;
        }

        // 随机延迟 — 反检测
        await antiDetect.randomDelay(300, 800);
      } catch (e) {
        const msg = e.message;

        if (msg.includes('灵石不足') || msg.includes('资源不足') || msg.includes('灵气不足')) {
          warn(acc.username, '升级停止: ' + msg);
          this.stats.stuckReason = msg;
          break;
        }
        if (msg.includes('已达到大乘大圆满') || msg.includes('400') || msg.includes('封顶')) {
          ok(acc.username, '已达到封顶等级');
          this.stats.stuckReason = '封顶';
          break;
        }
        if (msg.includes('请先突破')) {
          warn(acc.username, '需要先突破: ' + msg);
          await antiDetect.randomDelay(1000, 2000);
          await this.doBreakthrough();
          await this.delay(1000);
          continue;
        }

        // 其他异常
        stuckCount++;
        warn(acc.username, '升级异常(' + attempts + '): ' + msg);
        await this.delay(2000);
      }
    }

    // 4. 最终获取等级
    currentLevel = await this.getLevel();
    this.stats.levelAfter = currentLevel;
    this.stats.levelsGained = currentLevel - this.stats.levelBefore;

    // 输出
    console.log('');
    console.log('══════ 升级突破结果 ══════');
    console.log('  账号:         ' + acc.username);
    console.log('  初始等级:     ' + this.stats.levelBefore);
    console.log('  最终等级:     ' + this.stats.levelAfter);
    console.log('  提升:         +' + this.stats.levelsGained + ' 级');
    console.log('  突破次数:     ' + this.stats.breakthroughs);
    console.log('  停止原因:     ' + (this.stats.stuckReason || '正常结束'));
    console.log('══════════════════════════');
    console.log('');

    return this.stats;
  }
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(results) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'levelup_result_' + ts + '.json';
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
  console.log('║      升级突破脚本 v1.0                       ║');
  console.log('║      API: /player/level_up                   ║');
  console.log('║            /player/breakthrough              ║');
  console.log('║      突破节点: 120/160/200/240/280          ║');
  console.log('║      封顶等级: 400                           ║');
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
      console.log('═══ 升级突破 [' + (i+1) + '/' + selected.length + ']: ' + acc.username + ' ═══');
      const engine = new LevelUpEngine(acc);
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
    console.log('═══ 升级突破 [' + (i+1) + '/' + selected.length + ']: ' + acc.username + ' ═══');
    const engine = new LevelUpEngine(acc);
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
