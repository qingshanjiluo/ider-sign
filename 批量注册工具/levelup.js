/**
 * 一键升级脚本 ⬆️
 * 功能:
 *   1. 读取 alchemy_accounts.txt 账号文件
 *   2. 登录 → 获取等级 → 循环 POST /player/level_up
 *   3. 遇到经验不足/灵石不足/突破节点 → 停止该账号
 *   4. 所有账号处理完后打印汇总
 *
 * 使用: node levelup.js
 *       选择账号范围 → Y确认 → 自动执行
 *
 * 🛡️ 反检测: IP伪装 / 独立指纹 / 随机延迟 / 智能分段暂停
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
// 升级引擎
// ============================================================
class LevelUpEngine {
  constructor(account) {
    this.account = account;
    this.stats = {
      loginSuccess: false,
      levelBefore: 0,
      levelAfter: 0,
      levelsGained: 0,
      stopReason: '',
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

  /** 完整升级流程（只升级，不突破） */
  async run() {
    const acc = this.account;
    const idx = acc._antiIdx || 0;
    const ipInfo = antiDetect.getIpInfo(idx);

    info('⬆️', '========== 一键升级 ==========');
    info('⬆️', '账号: ' + acc.username);
    info('⬆️', '🛡️ 伪装IP: ' + ipInfo.ip + ' (' + ipInfo.isp + '·' + ipInfo.province + ')');

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
    const MAX_ATTEMPTS = 2000;
    const MAX_STUCK = 10;

    while (attempts < MAX_ATTEMPTS && stuckCount < MAX_STUCK) {
      attempts++;

      try {
        await this.levelUpOnce();

        // 升级成功
        currentLevel++;
        stuckCount = 0;

        if (currentLevel % 10 === 0) {
          info(acc.username, '当前等级: ' + currentLevel);
        }

        // 🛡️ 随机延迟 — 反检测
        await antiDetect.randomDelay(300, 800);
      } catch (e) {
        const msg = e.message;

        // ⚠️ 经验/灵气/灵石不足 → 正常停止
        if (msg.includes('经验不足') || msg.includes('灵气不足') || msg.includes('灵石不足') || msg.includes('资源不足')) {
          warn(acc.username, '升级停止: ' + msg);
          this.stats.stopReason = msg;
          break;
        }

        // ⚠️ 已达封顶 / 大圆满 / 上限
        if (msg.includes('已达上限') || msg.includes('大圆满') || msg.includes('封顶') || msg.includes('400')) {
          ok(acc.username, '已达到封顶等级: ' + msg);
          this.stats.stopReason = '封顶';
          break;
        }

        // ⚠️ 到达突破节点（120/160/200/240/280），不处理突破，停止该账号
        if (msg.includes('请先突破')) {
          warn(acc.username, '到达突破节点(' + currentLevel + '级)，需要手动突破，停止升级');
          this.stats.stopReason = '到达突破节点 @' + currentLevel + '级';
          break;
        }

        // ⚠️ 其他异常 → 卡住计数
        stuckCount++;
        warn(acc.username, '升级异常(' + attempts + '/' + MAX_STUCK + '): ' + msg.slice(0, 80));
        await this.delay(2000);
      }
    }

    // 如果因卡住次数过多退出
    if (stuckCount >= MAX_STUCK && !this.stats.stopReason) {
      this.stats.stopReason = '卡住次数过多(' + stuckCount + ')';
    }

    // 4. 最终获取等级
    currentLevel = await this.getLevel();
    this.stats.levelAfter = currentLevel;
    this.stats.levelsGained = currentLevel - this.stats.levelBefore;

    // 输出
    console.log('');
    console.log('══════ 升级结果 ══════');
    console.log('  账号:         ' + acc.username);
    console.log('  初始等级:     ' + this.stats.levelBefore);
    console.log('  最终等级:     ' + this.stats.levelAfter);
    console.log('  提升:         +' + this.stats.levelsGained + ' 级');
    console.log('  停止原因:     ' + (this.stats.stopReason || '正常结束'));
    console.log('═══════════════════');
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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       一键升级脚本 v1.1                      ║');
  console.log('║                                            ║');
  console.log('║       只升级 · 不突破 · 防封号               ║');
  console.log('║                                            ║');
  console.log('║   API: POST /player/level_up                ║');
  console.log('║   限: 到突破节点自动停止                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  🛡️ 反检测:                                 ║');
  console.log('║     IP伪装 / 独立指纹 / 随机延迟            ║');
  console.log('║     浏览器指纹轮换 / 智能分段暂停            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 汇总输出
// ============================================================
function printSummary(results) {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║               📊 升级汇总                     ║');
  console.log('╠══════════════════════════════════════════════╣');
  let totalGained = 0;
  let successCount = 0;
  for (const r of results) {
    if (r.stats) {
      totalGained += r.stats.levelsGained || 0;
      if (r.stats.levelAfter > r.stats.levelBefore) successCount++;
    }
  }
  console.log('║  处理账号: ' + String(results.length).padEnd(20) + '║');
  console.log('║  成功升级: ' + String(successCount).padEnd(20) + '║');
  console.log('║  总提升级: +' + String(totalGained).padEnd(19) + '║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  for (const r of results) {
    const s = r.stats;
    if (!s) {
      console.log('  ✗ ' + (r.username || '?') + ' — ' + (r.error || '未知错误'));
      continue;
    }
    const gained = s.levelsGained || 0;
    const icon = gained > 0 ? '✓' : (s.stopReason ? '⏸' : '✗');
    const reason = s.stopReason ? ' [' + s.stopReason + ']' : '';
    console.log('  ' + icon + ' ' + r.username + ': ' + s.levelBefore + '→' + s.levelAfter + ' (+' + gained + ')' + reason);
  }
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
    console.log('❌ 未找到账号文件，请创建 alchemy_accounts.txt');
    console.log('   格式: 每行 username,password');
    console.log('   示例: test001,abc123456');
    process.exit(1);
  }

  const accounts = loadAccounts(filepath);
  if (accounts.length === 0) {
    console.log('❌ 没有有效账号');
    process.exit(0);
  }

  console.log('📁 账号文件: ' + filepath);
  console.log('📋 共 ' + accounts.length + ' 个账号');
  for (const acc of accounts) console.log('   [' + acc.username + ']');

  console.log('');
  const rangeInput = await ask('选择范围 [1-' + accounts.length + ', 直接回车=全部]: ');
  let selected = accounts;
  if (rangeInput && rangeInput.trim()) {
    const parts = rangeInput.split('-').map(s => parseInt(s.trim()));
    if (parts.length === 2 && parts[0] > 0 && parts[1] <= accounts.length)
      selected = accounts.slice(parts[0] - 1, parts[1]);
    else if (parts.length === 1 && parts[0] > 0 && parts[0] <= accounts.length)
      selected = [accounts[parts[0] - 1]];
  }

  console.log('✅ 已选择 ' + selected.length + ' 个账号');
  const confirm = await ask('开始执行? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
    console.log('已取消');
    process.exit(0);
  }

  // 执行
  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const acc = selected[i];
    acc._antiIdx = i;
    setApiAccountIndex(i);

    console.log('');
    console.log('═══ [' + (i + 1) + '/' + selected.length + '] ' + acc.username + ' ═══');
    const engine = new LevelUpEngine(acc);
    try {
      const stats = await engine.run();
      results.push({ username: acc.username, stats });
    } catch (e) {
      err(acc.username, '运行失败: ' + e.message);
      results.push({ username: acc.username, error: e.message });
    }

    // 🛡️ 智能分段暂停 — 防封号
    if (i < selected.length - 1) {
      await antiDetect.smartPause(i, selected.length, {
        batchSize: 2,
        pauseMin: 15000,
        pauseMax: 30000
      });
      await antiDetect.randomDelay(3000, 5000);
    }
  }

  // 保存结果
  saveResult({ timestamp: new Date().toISOString(), accounts: results });

  // 汇总
  printSummary(results);

  // 退出
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl2.question('按回车退出...', () => { rl2.close(); });
}

main().catch(e => { console.error('异常:', e.message); process.exit(1); });
