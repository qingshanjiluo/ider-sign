/**
 * 百艺炼丹脚本 🧪
 * 使用正确的百艺API炼制筑基丹
 * API: POST /alchemy/start （需要 selected_ingredients 结构）
 *
 * 筑基丹配方（recipe id=1）:
 *   main:  玄冰花(itemId=6) ×1
 *   sub:   [天灵果(7)×1, 幻心草(8)×1]
 *   catalyst: 清灵草(9)×3
 *   耗时: 60秒/批
 *
 * 使用: node craft_pills.js
 * CI模式: set CI=true && set ACCOUNTS_DATA=... && node craft_pills.js
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

// 筑基丹配方材料
const PILL_RECIPE = {
  recipeId: 1,
  name: '筑基丹',
  selectedIngredients: {
    main: { item: { id: 6 }, count: 1 },      // 玄冰花
    sub: [
      { item: { id: 7 }, count: 1 },            // 天灵果
      { item: { id: 8 }, count: 1 }             // 幻心草
    ],
    catalyst: { item: { id: 9 }, count: 3 }     // 清灵草×3
  },
  timePerBatch: 60,  // 秒
  resultItemId: 1    // 筑基丹 itemId
};

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
// 炼制引擎
// ============================================================
class CraftEngine {
  constructor(account) {
    this.account = account;
    this.stats = {
      loginSuccess: false,
      materialsChecked: false,
      craftStarted: false,
      craftCompleted: false,
      pillsCrafted: 0,
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

  /** 2. 检查背包材料是否足够 */
  async checkMaterials() {
    info(this.account.username, '正在检查背包材料...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
    const player = data && data.player ? data.player : data;
    const inventory = player.inventory || [];

    // 计算材料需求
    const need = {
      6: { name: '玄冰花', need: 1, count: 0 },
      7: { name: '天灵果', need: 1, count: 0 },
      8: { name: '幻心草', need: 1, count: 0 },
      9: { name: '清灵草', need: 3, count: 0 }
    };

    for (const row of inventory) {
      if (!Array.isArray(row)) continue;
      for (const slot of row) {
        if (!slot || !slot.item) continue;
        const id = int(slot.item.id, 0);
        if (need[id]) {
          need[id].count += int(slot.count, 1);
        }
      }
    }

    const missing = [];
    let hasAll = true;
    for (const [id, n] of Object.entries(need)) {
      info(this.account.username, `  ${n.name}: 需要${n.need}, 拥有${n.count}`);
      if (n.count < n.need) {
        missing.push(`${n.name}（缺${n.need - n.count}）`);
        hasAll = false;
      }
    }

    this.stats.materialsChecked = true;
    if (!hasAll) {
      const msg = '材料不足: ' + missing.join(', ');
      warn(this.account.username, msg);
      this.stats.errors.push(msg);
      return false;
    }

    ok(this.account.username, '所有材料充足');
    return true;
  }

  /** 3. 启动百艺炼丹（异步作业，完成后产物到邮件） */
  async startAlchemy(batchCount = 1) {
    info(this.account.username, `正在炼丹（${batchCount}批）...`);
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    // 通过百艺页面API启动炼丹
    const body = {
      selected_ingredients: PILL_RECIPE.selectedIngredients,
      batch_count: batchCount
    };

    try {
      const data = await apiRequest('POST', '/alchemy/start', this.account.token, body, antiHeaders);
      if (data && data.pending) {
        const remainSec = int(data.remaining_sec, PILL_RECIPE.timePerBatch * batchCount);
        this.stats.craftStarted = true;
        this.stats.remainingSec = remainSec;
        ok(this.account.username, `炼丹作业已开始，预计${remainSec}秒后完成`);
        return { started: true, remainingSec: remainSec, finishAt: data.finish_at };
      }
      warn(this.account.username, '炼丹启动返回异常: ' + JSON.stringify(data));
      return { started: false };
    } catch (e) {
      if (e.message.includes('百艺行动序列占用中')) {
        // 已经有作业在跑，可能是上次的产物还没领
        warn(this.account.username, '百艺队列被占用，可能是上次产物未领取');
        this.stats.errors.push('百艺队列占用');
        return { started: false, occupied: true };
      }
      if (e.message.includes('材料不足')) {
        warn(this.account.username, '材料不足: ' + e.message);
        this.stats.errors.push('材料不足');
        return { started: false };
      }
      // 重试一次
      warn(this.account.username, `炼丹启动失败: ${e.message}，重试...`);
      await antiDetect.randomDelay(2000, 3000);
      try {
        const retryData = await apiRequest('POST', '/alchemy/start', this.account.token, body, antiHeaders);
        if (retryData && retryData.pending) {
          const remainSec = int(retryData.remaining_sec, PILL_RECIPE.timePerBatch * batchCount);
          this.stats.craftStarted = true;
          this.stats.remainingSec = remainSec;
          return { started: true, remainingSec: remainSec, finishAt: retryData.finish_at };
        }
      } catch (e2) {
        err(this.account.username, `重试仍失败: ${e2.message}`);
        this.stats.errors.push(e2.message);
      }
      return { started: false };
    }
  }

  /** 4. 等待炼丹完成 */
  async waitForCompletion(remainingSec) {
    if (!remainingSec || remainingSec <= 0) return true;
    info(this.account.username, `等待炼丹完成（约${remainingSec}秒）...`);
    // 每5秒检查一次(通过同步玩家数据判断百艺队列是否空闲)
    const maxWait = remainingSec + 30; // 最多多等30秒
    const pollInterval = 5000;
    let waited = 0;

    while (waited < maxWait * 1000) {
      await this.delay(pollInterval);
      waited += pollInterval;
      try {
        const idx = this.account._antiIdx || 0;
        const antiHeaders = antiDetect.buildAntiDetectHeaders(idx + 999);
        const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
        const player = data && data.player ? data.player : data;
        const baiyi = player.baiyi || {};
        const pendingJob = baiyi.pending_job || null;

        if (!pendingJob || int(pendingJob.finish_at, 0) <= Math.floor(Date.now() / 1000)) {
          // 百艺队列空闲 → 完成
          this.stats.craftCompleted = true;
          this.stats.pillsCrafted = 1;
          ok(this.account.username, '炼丹完成，产物已投递到邮件');
          return true;
        }
        const remain = Math.max(0, int(pendingJob.finish_at, 0) - Math.floor(Date.now() / 1000));
        if (remain > 0 && remain < remainingSec - 5) {
          info(this.account.username, `炼丹进度: 剩余${remain}秒`);
        }
      } catch (e) {
        // poll失败忽略，继续等
      }
    }

    // 超时，但可能已经完成了只是没检查到
    warn(this.account.username, '等待超时，假设已完成');
    this.stats.craftCompleted = true;
    this.stats.pillsCrafted = 1;
    return true;
  }

  /** 5. 获取玩家背包（验证产物） */
  async getPlayerData() {
    try {
      const idx = this.account._antiIdx || 0;
      const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.player : data;
      return { level: int(player.level, 1), inventory: player.inventory || [] };
    } catch (e) {
      return { level: 0, inventory: [] };
    }
  }

  /** 完整流程 */
  async run() {
    const acc = this.account;
    const idx = acc._antiIdx || 0;
    const ipInfo = antiDetect.getIpInfo(idx);

    info('🧪', '================ 炼制脚本 ================');
    info('🧪', '账号: ' + acc.username);
    info('🧪', '🛡️ 反检测: IP=' + ipInfo.ip + ' (' + ipInfo.isp + '·' + ipInfo.province + ')');
    info('🧪', '配方: ' + PILL_RECIPE.name + '（' + JSON.stringify(PILL_RECIPE.selectedIngredients) + '）');

    // 1. 登录
    await this.login();
    await antiDetect.randomDelay(800, 1500);

    // 2. 检查材料
    const hasMaterials = await this.checkMaterials();
    if (!hasMaterials) {
      // 尝试采集材料
      info(acc.username, '尝试自动采集材料...');
      try {
        const idx2 = acc._antiIdx || 0;
        const antiHeaders2 = antiDetect.buildAntiDetectHeaders(idx2 + 100);
        await apiRequest('POST', '/player/gather', acc.token, { auto: true }, antiHeaders2);
        await antiDetect.randomDelay(3000, 5000);
        // 重新检查
        const retryCheck = await this.checkMaterials();
        if (!retryCheck) {
          err(acc.username, '材料不足，跳过');
          this.stats.errors.push('材料不足（采集后仍缺）');
          return this.stats;
        }
      } catch (e) {
        err(acc.username, '采集失败，跳过: ' + e.message);
        this.stats.errors.push('采集失败');
        return this.stats;
      }
    }

    // 3. 启动炼丹
    await antiDetect.randomDelay(1000, 2000);
    const result = await this.startAlchemy(1);
    if (!result.started) {
      if (result.occupied) {
        // 百艺队列占用，等待完成
        info(acc.username, '百艺队列有作业，尝试领取上次产物...');
        try {
          const idx3 = acc._antiIdx || 0;
          const antiHeaders3 = antiDetect.buildAntiDetectHeaders(idx3 + 200);
          // 重新调用/alchemy/start会触发结算和领取
          await apiRequest('POST', '/alchemy/start', acc.token, {
            selected_ingredients: PILL_RECIPE.selectedIngredients,
            batch_count: 1
          }, antiHeaders3);
          // 如果能走到这里说明之前的产物已处理
          ok(acc.username, '已处理上次百艺遗留产物');
          await antiDetect.randomDelay(2000, 3000);
          // 再次尝试启动
          const retryResult = await this.startAlchemy(1);
          if (!retryResult.started) {
            err(acc.username, '二次启动炼丹失败');
            return this.stats;
          }
        } catch (e) {
          err(acc.username, '处理遗留产物失败: ' + e.message);
          return this.stats;
        }
      } else {
        err(acc.username, '启动炼丹失败');
        return this.stats;
      }
    }

    // 4. 等待完成
    if (result.remainingSec) {
      await this.waitForCompletion(result.remainingSec);
    }

    // 输出
    console.log('');
    console.log('══════ 炼制结果 ══════');
    console.log('  账号:     ' + acc.username);
    console.log('  炼丹启动: ' + (this.stats.craftStarted ? '✅' : '❌'));
    console.log('  炼丹完成: ' + (this.stats.craftCompleted ? '✅' : '❌'));
    console.log('  筑基丹:   ' + this.stats.pillsCrafted + ' 枚');
    console.log('══════════════════════');
    console.log('');

    return this.stats;
  }
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(results) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'craft_result_' + ts + '.json';
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
  console.log('║       百艺炼丹脚本 v2.0 — 筑基丹炼制       ║');
  console.log('║       API: POST /alchemy/start              ║');
  console.log('║       配方: 玄冰花+天灵果+幻心草+清灵草×3  ║');
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
      console.log(`═══ 炼丹 [${i+1}/${selected.length}]: ${acc.username} ═══`);
      const engine = new CraftEngine(acc);
      try {
        const stats = await engine.run();
        results.push({ username: acc.username, stats });
        if (!stats.craftCompleted) hasError = true;
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
  const confirm = await ask('开始炼丹? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') { console.log('已取消'); process.exit(0); }

  const results = [];
  let hasError = false;
  for (let i = 0; i < selected.length; i++) {
    const acc = selected[i];
    acc._antiIdx = i;
    setApiAccountIndex(i);
    console.log('═══ 炼丹 [' + (i+1) + '/' + selected.length + ']: ' + acc.username + ' ═══');
    const engine = new CraftEngine(acc);
    try {
      const stats = await engine.run();
      results.push({ username: acc.username, stats });
      if (!stats.craftCompleted) hasError = true;
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
