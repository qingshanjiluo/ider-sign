/**
 * 一键自动刷怪脚本 ⚔️
 * 功能:
 *   1. 读取 alchemy_accounts.txt 账号文件
 *   2. 登录 → 检查是否在战斗中 (active_battle)
 *   3. 不在战斗 → 切换地图到荒石村 → 开始服务端自动战斗
 *   4. 已在战斗 → 跳过（正在刷怪中）
 *   5. 防封号: IP伪装 / 独立指纹 / 随机延迟 / 智能分段暂停
 *
 * 使用: node auto_farm.js
 *       选择账号范围 → Y确认 → 自动执行
 *
 * GitHub Actions: 设置 CI=true 环境变量自动运行
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
const MAP_IDS = {
  HUANGSHICUN: 1,   // 荒石村
};

// CI 检测（GitHub Actions 自动模式）
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
function log(level, tag, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const icon = level === 'ok' ? '✅' : level === 'info' ? 'ℹ️' : level === 'warn' ? '⚠️' : level === 'err' ? '❌' : '📌';
  const out = `${icon} [${ts}] [${tag}] ${msg}`;
  console.log(out);
}
const info = log.bind(null, 'info');
const ok = log.bind(null, 'ok');
const warn = log.bind(null, 'warn');
const err = log.bind(null, 'err');

// ============================================================
// 账号加载
// ============================================================
class Account {
  constructor(username, password, inviteCode) {
    this.username = username;
    this.password = password;
    this.inviteCode = inviteCode || '';
    this.token = '';
    this.player = null;
    this.activeBattle = null;
  }
}

function loadAccounts(filepath) {
  const absPath = path.resolve(__dirname, filepath);
  if (!fs.existsSync(absPath)) {
    err('系统', `账号文件不存在: ${absPath}`);
    return [];
  }
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const accounts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('#')) continue;
    const parts = line.split(',');
    if (parts.length >= 2) {
      const username = parts[0].trim();
      const password = parts[1].trim();
      const inviteCode = parts.length >= 3 ? parts[2].trim() : '';
      if (username && password) {
        accounts.push(new Account(username, password, inviteCode));
      }
    }
  }
  return accounts;
}

// ============================================================
// 自动刷怪引擎
// ============================================================
class AutoFarmEngine {
  constructor(account, farmMapId = MAP_IDS.HUANGSHICUN) {
    this.account = account;
    this.farmMapId = farmMapId;
    this.stats = {
      loginOk: false,
      inBattle: false,
      switchedMap: false,
      startedBattle: false,
      error: null,
    };
  }

  async delay(ms) {
    await new Promise(r => setTimeout(r, ms));
  }

  // 登录
  async login() {
    try {
      const body = antiDetect.buildLoginBody(this.account.username, this.account.password, _apiAccountIndex);
      const result = await apiRequest('POST', '/auth/login', '', body);
      if (result && result.token) {
        this.account.token = result.token;
        this.stats.loginOk = true;
        return true;
      }
      this.stats.error = result?.error || '登录失败';
    } catch (e) {
      this.stats.error = e.message || '登录失败';
    }
    return false;
  }

  // 获取角色状态 (GET /player/state)
  async getPlayerState() {
    try {
      const result = await apiRequest('GET', '/player/state', this.account.token);
      if (result && result.ok && result.hasCharacter) {
        this.account.player = result.player;
        this.account.activeBattle = result.active_battle;
        return result;
      }
      this.stats.error = result?.error || '获取角色状态失败';
    } catch (e) {
      this.stats.error = e.message || '获取角色状态失败';
    }
    return null;
  }

  // 切换地图 (POST /player/set_map)
  async setMap(mapId) {
    try {
      const result = await apiRequest('POST', '/player/set_map', this.account.token, { map_id: mapId });
      if (result && result.ok) {
        this.stats.switchedMap = true;
        if (this.account.player) {
          this.account.player.current_map_id = mapId;
        }
        return true;
      }
      this.stats.error = result?.error || '切换地图失败';
    } catch (e) {
      this.stats.error = e.message || '切换地图失败';
    }
    return false;
  }

  // 开始战斗 (POST /battle/start)
  async startBattle() {
    try {
      const body = {
        mapId: this.farmMapId,
        poll_mode: false,
        auto_restart: true,
      };
      const result = await apiRequest('POST', '/battle/start', this.account.token, body);
      if (result && result.ok) {
        this.stats.startedBattle = true;
        this.stats.inBattle = true;
        return true;
      }
      // 可能是已经在战斗中
      if (result && result.error && (
        result.error.includes('已在战斗') ||
        result.error.includes('战斗中') ||
        result.error.includes('active_battle')
      )) {
        this.stats.inBattle = true;
        this.stats.startedBattle = false;
        return true; // 已经在战斗，也算成功
      }
      this.stats.error = result?.error || '开始战斗失败';
    } catch (e) {
      this.stats.error = e.message || '开始战斗失败';
    }
    return false;
  }

  // 自动设置自动重启战斗 (POST /battle/auto_restart)
  async setAutoRestart() {
    try {
      const body = {
        enabled: true,
        map_id: this.farmMapId,
      };
      const result = await apiRequest('POST', '/battle/auto_restart', this.account.token, body);
      return result && result.ok;
    } catch (e) {
      return false;
    }
  }

  // 主流程
  async run() {
    // --- 1. 登录 ---
    info(this.account.username, '正在登录...');
    const loginOk = await this.login();
    if (!loginOk) {
      err(this.account.username, `登录失败: ${this.stats.error}`);
      return this.stats;
    }
    ok(this.account.username, '登录成功');

    // --- 2. 获取角色状态 ---
    await antiDetect.randomDelay(800, 1500);
    info(this.account.username, '正在获取角色状态...');
    const state = await this.getPlayerState();
    if (!state) {
      err(this.account.username, `获取状态失败: ${this.stats.error}`);
      return this.stats;
    }

    // 检查是否在休息中
    const nowSec = Math.floor(Date.now() / 1000);
    const restUntil = this.account.player?.rest_until || 0;
    if (restUntil > nowSec) {
      const remainMin = Math.ceil((restUntil - nowSec) / 60);
      warn(this.account.username, `角色正在休息中，剩余约 ${remainMin} 分钟，跳过`);
      this.stats.error = `休息中(剩余${remainMin}分钟)`;
      return this.stats;
    }

    const level = this.account.player?.level || 0;
    const mapId = this.account.player?.current_map_id || 0;

    // --- 3. 检查战斗状态 ---
    if (this.account.activeBattle) {
      const battleId = this.account.activeBattle.battleId || '?';
      ok(this.account.username, `已在战斗中(battleId=${battleId})，无需操作`);
      this.stats.inBattle = true;
      return this.stats;
    }

    ok(this.account.username, `不在战斗中(Lv.${level}，当前地图ID=${mapId})，准备开始自动刷怪`);

    // --- 4. 如果不在荒石村，切换地图 ---
    if (mapId !== this.farmMapId) {
      await antiDetect.randomDelay(600, 1200);
      info(this.account.username, `正在切换地图到荒石村(ID=${this.farmMapId})...`);
      const mapOk = await this.setMap(this.farmMapId);
      if (!mapOk) {
        err(this.account.username, `切换地图失败: ${this.stats.error}`);
        return this.stats;
      }
      ok(this.account.username, `已切换到荒石村`);
    } else {
      ok(this.account.username, '已在荒石村');
      this.stats.switchedMap = true;
    }

    // --- 5. 开始战斗 ---
    await antiDetect.randomDelay(800, 1500);
    info(this.account.username, '正在开始自动战斗...');
    const battleOk = await this.startBattle();
    if (!battleOk) {
      err(this.account.username, `开始战斗失败: ${this.stats.error}`);
      return this.stats;
    }

    // --- 6. 设置自动重启战斗 ---
    await antiDetect.randomDelay(500, 1000);
    const restartOk = await this.setAutoRestart();
    if (restartOk) {
      ok(this.account.username, '已设置自动续战');
    } else {
      warn(this.account.username, '设置自动续战未确认（可能已默认启用）');
    }

    ok(this.account.username, '✅ 自动刷怪已启动！');
    return this.stats;
  }
}

// ============================================================
// 保存结果
// ============================================================
function saveResult(results) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `auto_farm_result_${ts}.json`;
  const absPath = path.resolve(__dirname, filename);
  fs.writeFileSync(absPath, JSON.stringify(results, null, 2), 'utf8');
  info('系统', `结果已保存: ${filename}`);
  return filename;
}

// ============================================================
// 交互输入
// ============================================================
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================
// Banner
// ============================================================
function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     ⚔️  艾德尔修仙传 - 一键自动刷怪脚本        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  功能: 检查战斗状态 → 切换荒石村 → 自动刷怪   ║');
  console.log('║  反检测: IP伪装 / 独立指纹 / 随机延迟          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 汇总打印
// ============================================================
function printSummary(results) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║              📊 刷怪结果汇总                    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  const total = results.length;
  const inBattle = results.filter(r => r.stats.inBattle).length;
  const started = results.filter(r => r.stats.startedBattle).length;
  const errors = results.filter(r => r.stats.error).length;
  const failures = results.filter(r => !r.stats.loginOk).length;
  const success = results.filter(r => r.stats.loginOk && !r.stats.error).length;

  console.log(`  总账号: ${total}`);
  console.log(`  登录成功: ${total - failures}`);
  console.log(`  已在战斗中: ${inBattle}`);
  console.log(`  新启动战斗: ${started}`);
  console.log(`  处理成功: ${success}`);
  console.log(`  失败: ${errors}`);
  console.log('');

  if (errors > 0) {
    console.log('  失败详情:');
    results.forEach(r => {
      if (r.stats.error) {
        console.log(`    ${r.account.username}: ${r.stats.error}`);
      }
    });
    console.log('');
  }

  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// CI 模式：处理账号列表（被 processAccounts 复用）
// ============================================================
async function processAccounts(selected) {
  const results = [];

  for (let i = 0; i < selected.length; i++) {
    const acc = selected[i];
    setApiAccountIndex(i);
    console.log('');
    info('系统', `===== 处理 [${i + 1}/${selected.length}] ${acc.username} =====`);

    const engine = new AutoFarmEngine(acc);
    try {
      const stats = await engine.run();
      results.push({ account: acc, stats });
    } catch (e) {
      err(acc.username, `未捕获异常: ${e.message}`);
      results.push({
        account: acc,
        stats: {
          loginOk: false,
          inBattle: false,
          switchedMap: false,
          startedBattle: false,
          error: e.message || 'unknown',
        },
      });
    }

    // 智能暂停: 每隔 5 个账号休息 30-60 秒
    if ((i + 1) % 5 === 0 && i + 1 < selected.length) {
      await antiDetect.smartPause(i, selected.length, {
        baseDelay: 30000,
        maxDelay: 60000,
        label: '批量刷怪防封',
      });
    } else if (i + 1 < selected.length) {
      // 每个账号间随机延迟 3-8 秒
      await antiDetect.randomDelay(3000, 8000);
    }
  }

  return results;
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  showBanner();

  // 尝试多个可能的账号文件路径
  const accountFiles = [
    'alchemy_accounts.txt',
    'accounts.txt',
    './alchemy_accounts.txt',
    '../alchemy_accounts.txt',
  ];

  let accounts = [];
  let usedFile = '';
  for (const f of accountFiles) {
    accounts = loadAccounts(f);
    if (accounts.length > 0) {
      usedFile = f;
      break;
    }
  }

  if (accounts.length === 0) {
    err('系统', '未找到账号文件！请确认 alchemy_accounts.txt 或 accounts.txt 存在');
    process.exit(1);
  }

  // 过滤已封禁账号（跳过 #BANNED: 开头的不会被加载，因为 loadAccounts 会跳过注释行）
  info('系统', `找到 ${accounts.length} 个有效账号 (来自 ${usedFile})`);

  // CI 模式
  if (IS_CI) {
    const maxAccounts = getEnvInt('MAX_ACCOUNTS', 0);
    const rangeStr = process.env.RANGE || '';

    let selected = accounts;
    if (rangeStr) {
      const m = rangeStr.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const start = parseInt(m[1]) - 1;
        const end = parseInt(m[2]);
        selected = accounts.slice(start, end);
        info('系统', `范围模式: 第 ${m[1]}-${m[2]} 个账号 (共 ${selected.length} 个)`);
      }
    } else if (maxAccounts > 0) {
      selected = accounts.slice(0, maxAccounts);
      info('系统', `数量限制: 前 ${maxAccounts} 个账号`);
    }

    if (selected.length === 0) {
      err('系统', '没有可处理的账号');
      process.exit(1);
    }

    const results = await processAccounts(selected);
    const filename = saveResult({ accounts: results, ts: new Date().toISOString() });
    printSummary(results);
    return { results, filename };
  }

  // === 交互模式 ===
  info('系统', `可用账号: ${accounts.length} 个`);

  const rangeInput = await ask('请输入账号范围 (如 1-10，直接回车=全部): ');
  let selectedAccounts = accounts;
  if (rangeInput) {
    const m = rangeInput.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = parseInt(m[1]) - 1;
      const end = parseInt(m[2]);
      selectedAccounts = accounts.slice(start, end);
      info('系统', `选择范围: 第 ${m[1]}-${m[2]} 个 (${selectedAccounts.length} 个账号)`);
    } else {
      warn('系统', '范围格式错误，使用全部账号');
    }
  }

  const confirm = await ask(`确认处理 ${selectedAccounts.length} 个账号？(y/n): `);
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    info('系统', '已取消');
    return;
  }

  const results = await processAccounts(selectedAccounts);
  saveResult({ accounts: results, ts: new Date().toISOString() });
  printSummary(results);
}

// ============================================================
// 入口
// ============================================================
if (require.main === module) {
  main().catch(e => {
    err('系统', '未捕获异常: ' + (e?.message || e));
    process.exit(1);
  });
}

module.exports = { AutoFarmEngine, processAccounts, loadAccounts, MAP_IDS };
