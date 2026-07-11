/**
 * 艾德尔修仙传 - AI智能规划工具 🧠
 *
 * 功能：
 *   连接DeepSeek API进行智能规划，根据用户自然语言描述自动生成批量操作步骤并执行
 *
 * 使用：
 *   1. 配置 DEEPSEEK_API_KEY 环境变量
 *   2. 准备 planner_accounts.txt 账号文件
 *   3. 运行 node ai_planner.js
 *
 * 示例：
 *   node ai_planner.js --plan "帮我用前3个账号自动战斗30分钟，然后卖出所有材料"
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
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// ============================================================
// CI 检测 & 配置
// ============================================================
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

function getEnvInt(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function getEnvBool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
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
// 签名 & API（带反检测头注入）
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
// 账号结构
// ============================================================
class Account {
  constructor(username, password) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.token = '';
    this.accountId = 0;
    this._antiIdx = 0;
  }
  isValid() {
    return this.username.length >= 2 && this.password.length >= 6;
  }
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
// 🧠 DeepSeek AI 规划器
// ============================================================
async function callDeepSeek(prompt, context) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('❌ 未配置 DEEPSEEK_API_KEY 环境变量');
  }

  const systemPrompt = `你是一个艾德尔修仙传的AI操作规划助手。
用户会描述他们想要执行的批量操作，你需要将其拆解为可执行的步骤序列。

可用的操作类型（请严格使用以下名称）：
- login: 登录账号
- get_inventory: 获取背包
- auto_battle: 自动战斗（参数: minutes）
- sell_items: 卖出物品（参数: types, min_quality, sell_percent）
- register: 注册账号（参数: username, password, invite_code）
- create_character: 创建角色（参数: name, spirit_roots）
- equip_skills: 装备技能
- equip_item: 装备物品（参数: item_name）
- set_technique: 设置主功法（参数: technique_id）
- switch_map: 切换地图（参数: map_id）
- bind_invite: 绑定邀请码（参数: code）
- check_status: 检查账号状态
- wait: 等待（参数: seconds）

请以JSON格式返回操作列表，格式：
{
  "plan": [
    { "action": "login", "params": {} },
    { "action": "auto_battle", "params": { "minutes": 30 } },
    { "action": "sell_items", "params": { "types": ["material"], "min_quality": 3, "sell_percent": 100 } }
  ],
  "explanation": "简要说明执行计划"
}

只返回JSON，不要有其他内容。`;

  const userMessage = `当前上下文：${JSON.stringify(context)}\n用户需求：${prompt}`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 2000
    }),
    timeout: 60000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  // 提取JSON
  let jsonStr = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`解析AI响应失败: ${content.slice(0, 200)}`);
  }
}

// ============================================================
// 🎯 操作执行器
// ============================================================
class ActionExecutor {
  constructor(account) {
    this.account = account;
    this.results = [];
    this.shouldStop = false;
  }

  stop() { this.shouldStop = true; }

  async delay(ms) {
    if (ms <= 0 || this.shouldStop) return;
    const step = 100;
    for (let i = 0; i < ms / step; i++) {
      if (this.shouldStop) return;
      await sleep(step);
    }
  }

  async login() {
    info(this.account.username, '正在登录...');
    const idx = this.account._antiIdx || 0;
    const loginBody = antiDetect.buildLoginBody(this.account.username, this.account.password, idx);
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('POST', '/auth/login', '', loginBody, antiHeaders);
    this.account.token = data.token;
    this.account.accountId = int(data.accountId, 0);
    ok(this.account.username, '登录成功, accountId=' + this.account.accountId);
    return { success: true, accountId: this.account.accountId };
  }

  async getInventory() {
    info(this.account.username, '正在获取背包...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
    const player = data && data.player ? data.player : data;
    const inventory = player.inventory || [];
    const count = inventory.reduce((sum, row) => sum + (row ? row.length : 0), 0);
    info(this.account.username, `背包共 ${count} 格物品`);
    return { success: true, items: inventory, count };
  }

  async autoBattle(params) {
    const minutes = params.minutes || 10;
    info(this.account.username, `开始自动战斗 ${minutes} 分钟...`);
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    // 启动战斗
    await apiRequest('POST', '/player/start_battle', this.account.token, { minutes }, antiHeaders);
    ok(this.account.username, `自动战斗已启动，持续 ${minutes} 分钟`);
    return { success: true, minutes };
  }

  async sellItems(params) {
    const types = params.types || [];
    const minQuality = params.min_quality || 0;
    const sellPercent = params.sell_percent || 100;
    info(this.account.username, `开始卖出物品: 类型=${types.join(',')}, 品质>=${minQuality}, 比例=${sellPercent}%`);

    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
    const player = data && data.player ? data.player : data;
    const inventory = player.inventory || [];

    let soldCount = 0;
    let totalIncome = 0;

    for (let p = 0; p < inventory.length; p++) {
      const row = inventory[p];
      if (!Array.isArray(row)) continue;
      for (let s = 0; s < row.length; s++) {
        const slot = row[s];
        if (!slot || !slot.item) continue;
        const item = slot.item;
        const quality = Math.max(1, Math.floor(Number(item.quality) || 1));
        if (minQuality > 0 && quality < minQuality) continue;
        if (types.length > 0 && !types.some(t => String(item.type || '').toLowerCase() === t.toLowerCase())) continue;
        const count = Math.max(1, Math.floor((Number(slot.count) || 1) * sellPercent / 100));
        if (count <= 0) continue;

        const body = { page: p, slot_index: s, count, expect_item_id: int(item.id, 0) };
        try {
          const result = await apiRequest('POST', '/player/sell_item', this.account.token, body, antiHeaders);
          const stones = result && result.spirit_stones ? result.spirit_stones : 0;
          soldCount++;
          totalIncome += stones;
          info(this.account.username, `卖出 ${item.name} x${count}，获得 ${stones} 灵石`);
          await antiDetect.randomDelay(800, 1500);
        } catch (e) {
          warn(this.account.username, `卖出 ${item.name} 失败: ${e.message}`);
        }
      }
    }

    ok(this.account.username, `卖出完成: ${soldCount} 项物品，总收入 ${totalIncome} 灵石`);
    return { success: true, soldCount, totalIncome };
  }

  async checkStatus() {
    info(this.account.username, '正在检查状态...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    try {
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.player : data;
      info(this.account.username, `等级: ${player.level || 0}, 灵石: ${player.spirit_stones || 0}`);
      return { success: true, level: player.level || 0, stones: player.spirit_stones || 0 };
    } catch (e) {
      warn(this.account.username, '检查状态失败: ' + e.message);
      return { success: false, error: e.message };
    }
  }

  async wait(params) {
    const seconds = params.seconds || 5;
    info(this.account.username, `等待 ${seconds} 秒...`);
    await sleep(seconds * 1000);
    return { success: true, seconds };
  }

  async executeAction(action, params) {
    const methodName = action;
    if (typeof this[methodName] === 'function') {
      try {
        return await this[methodName](params || {});
      } catch (e) {
        err(this.account.username, `执行 ${action} 失败: ${e.message}`);
        return { success: false, error: e.message };
      }
    } else {
      warn(this.account.username, `未知操作: ${action}，跳过`);
      return { success: false, error: `未知操作: ${action}` };
    }
  }

  async runPlan(plan) {
    const results = [];
    for (let i = 0; i < plan.length; i++) {
      if (this.shouldStop) {
        info(this.account.username, '收到停止信号，中断执行');
        break;
      }
      const step = plan[i];
      info(this.account.username, `[${i+1}/${plan.length}] 执行: ${step.action}`);
      const result = await this.executeAction(step.action, step.params || {});
      results.push({ step: i + 1, action: step.action, result });
      if (!result.success && step.critical !== false) {
        warn(this.account.username, `关键步骤 ${step.action} 失败，停止执行`);
        break;
      }
      await antiDetect.randomDelay(1000, 2500);
    }
    this.results = results;
    return results;
  }
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(result) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ai_plan_result_${ts}.json`;
  try {
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf-8');
    info('保存', '结果已保存: ' + filename);
  } catch (e) {
    warn('保存', '保存结果失败: ' + e.message);
  }
}

// ============================================================
// 交互式控制台
// ============================================================
function ask(question) {
  if (IS_CI) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         艾德尔修仙传 - AI智能规划工具 v1.0             ║');
  console.log('║         🧠 基于 DeepSeek API 驱动                      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  📂 账号文件：./planner_accounts.txt                   ║');
  console.log('║     格式：每行 username,password                       ║');
  console.log('║                                                         ║');
  console.log('║  🔧 功能：输入自然语言需求，AI自动规划操作并执行       ║');
  console.log('║     支持：自动战斗/卖出物品/批量注册/状态检查等        ║');
  console.log('║                                                         ║');
  console.log('║  🛡️ 反检测：IP伪装(31段运营商)/独立machine_id         ║');
  console.log('║     浏览器指纹轮换/随机延迟/智能分段暂停               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('💡 示例需求：');
  console.log('  "帮我用前3个账号自动战斗30分钟，然后卖出所有材料"');
  console.log('  "检查所有账号状态，列出灵石数量"');
  console.log('  "为账号1-5绑定邀请码 ABC123，然后开始挂机"');
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  showBanner();

  // ============================================================
  // CI 模式
  // ============================================================
  if (IS_CI) {
    console.log('═══════════════════════════════════════════════');
    console.log('  检测到 CI 环境，自动使用环境变量配置');
    console.log('═══════════════════════════════════════════════');

    if (!DEEPSEEK_API_KEY) {
      console.error('❌ CI 模式下必须设置 DEEPSEEK_API_KEY 环境变量');
      process.exit(1);
    }

    const planPrompt = process.env.PLAN_PROMPT || '自动战斗30分钟';
    const accountFile = process.env.ACCOUNT_FILE || './planner_accounts.txt';

    if (process.env.ACCOUNTS_DATA) {
      fs.writeFileSync(accountFile, process.env.ACCOUNTS_DATA, 'utf-8');
    }

    const accounts = loadAccounts(accountFile);
    if (accounts.length === 0) {
      console.error('❌ CI 模式下未找到有效账号！');
      process.exit(1);
    }

    const maxAccounts = Math.min(accounts.length, getEnvInt('MAX_ACCOUNTS', accounts.length));
    const selectedAccounts = accounts.slice(0, maxAccounts);

    console.log(`📋 加载 ${selectedAccounts.length} 个账号`);
    console.log(`🧠 AI规划提示: ${planPrompt}`);
    console.log('');

    // 调用AI生成计划
    info('AI', '正在调用 DeepSeek 生成计划...');
    const context = {
      accounts: selectedAccounts.map(a => ({ username: a.username, accountId: a.accountId })),
      available_actions: ['login', 'get_inventory', 'auto_battle', 'sell_items', 'register', 'create_character', 'equip_skills', 'equip_item', 'set_technique', 'switch_map', 'bind_invite', 'check_status', 'wait']
    };

    let planResult;
    try {
      planResult = await callDeepSeek(planPrompt, context);
    } catch (e) {
      console.error('❌ AI规划失败:', e.message);
      process.exit(1);
    }

    console.log('');
    console.log('📋 AI 生成的计划:');
    console.log('  ' + (planResult.explanation || '无说明'));
    console.log('  步骤:');
    for (const step of planResult.plan || []) {
      const params = step.params ? Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(', ') : '';
      console.log(`    ${step.action} ${params ? '(' + params + ')' : ''}`);
    }
    console.log('');

    const confirm = IS_CI ? true : (await ask('是否执行此计划? (Y/n): ')).toLowerCase() !== 'n';
    if (!confirm) {
      console.log('已取消');
      process.exit(0);
    }

    const overallResults = [];
    let hasError = false;

    for (let i = 0; i < selectedAccounts.length; i++) {
      const acc = selectedAccounts[i];
      acc._antiIdx = i;
      setApiAccountIndex(i);

      const ipInfo = antiDetect.getIpInfo(i);
      console.log('');
      console.log(`═══ 处理账号 [${i+1}/${selectedAccounts.length}]: ${acc.username} ═══`);
      console.log(`  🛡️ 反检测: IP=${ipInfo.ip} (${ipInfo.isp}·${ipInfo.province})`);

      const executor = new ActionExecutor(acc);
      const results = await executor.runPlan(planResult.plan || []);
      overallResults.push({ username: acc.username, results });

      const failed = results.filter(r => r.result && r.result.success === false);
      if (failed.length > 0) hasError = true;

      await antiDetect.smartPause(i, selectedAccounts.length, {
        batchSize: 3,
        pauseMin: 20000,
        pauseMax: 40000
      });

      if (i < selectedAccounts.length - 1) {
        await antiDetect.randomDelay(3000, 5000);
      }
    }

    const output = {
      timestamp: new Date().toISOString(),
      plan: planResult,
      accounts: overallResults
    };
    saveResult(output);

    console.log('');
    console.log('全部账号处理完成，退出码: ' + (hasError ? '1（有失败）' : '0（全部成功）'));
    process.exit(hasError ? 1 : 0);
  }

  // ============================================================
  // 交互模式
  // ============================================================
  if (!DEEPSEEK_API_KEY) {
    console.log('⚠️ 未检测到 DEEPSEEK_API_KEY 环境变量');
    console.log('请设置: set DEEPSEEK_API_KEY=your_api_key');
    console.log('');
    const key = await ask('请输入 DeepSeek API Key: ');
    if (!key) {
      console.log('未提供 API Key，退出');
      process.exit(0);
    }
    process.env.DEEPSEEK_API_KEY = key.trim();
  }

  // 加载账号
  let filepath = './planner_accounts.txt';
  if (!fs.existsSync(filepath)) {
    console.log('未找到 planner_accounts.txt');
    console.log('创建默认账号文件...');
    const username = await ask('请输入用户名: ');
    const pwd = await ask('请输入密码: ');
    if (username && pwd) {
      fs.writeFileSync(filepath, username + ',' + pwd, 'utf-8');
      console.log('已创建 planner_accounts.txt');
    } else {
      console.log('无有效账号，退出');
      process.exit(0);
    }
  }

  const accounts = loadAccounts(filepath);
  if (accounts.length === 0) {
    console.log('没有有效账号');
    process.exit(0);
  }

  console.log(`当前 ${accounts.length} 个账号:`);
  for (const acc of accounts) {
    console.log(`  [${acc.username}]`);
  }

  console.log('');
  console.log('💡 请输入你想让AI帮你完成的操作描述：');
  const userPrompt = await ask('> ');
  if (!userPrompt) {
    console.log('未输入需求，退出');
    process.exit(0);
  }

  // 选择账号范围
  const rangeInput = await ask(`输入要操作的账号范围 [1-${accounts.length}, 全部]: `);
  let selectedAccounts = accounts;
  if (rangeInput && rangeInput !== '全部') {
    const parts = rangeInput.split('-').map(s => parseInt(s.trim()));
    if (parts.length === 2 && parts[0] > 0 && parts[1] <= accounts.length) {
      selectedAccounts = accounts.slice(parts[0] - 1, parts[1]);
    } else if (parts.length === 1 && parts[0] > 0 && parts[0] <= accounts.length) {
      selectedAccounts = [accounts[parts[0] - 1]];
    } else {
      console.log('⚠️ 范围格式无效，使用全部账号');
    }
  }

  console.log(`📋 选择 ${selectedAccounts.length} 个账号`);
  console.log('🧠 正在调用 AI 生成计划...');

  const context = {
    accounts: selectedAccounts.map(a => ({ username: a.username })),
    available_actions: ['login', 'get_inventory', 'auto_battle', 'sell_items', 'register', 'create_character', 'equip_skills', 'equip_item', 'set_technique', 'switch_map', 'bind_invite', 'check_status', 'wait']
  };

  let planResult;
  try {
    planResult = await callDeepSeek(userPrompt, context);
  } catch (e) {
    console.error('❌ AI规划失败:', e.message);
    process.exit(1);
  }

  console.log('');
  console.log('📋 AI 生成的计划:');
  console.log('  ' + (planResult.explanation || '无说明'));
  console.log('  步骤:');
  for (const step of planResult.plan || []) {
    const params = step.params ? Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(', ') : '';
    console.log(`    ${step.action} ${params ? '(' + params + ')' : ''}`);
  }
  console.log('');

  const confirm = await ask('是否执行此计划? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
    console.log('已取消');
    process.exit(0);
  }

  const overallResults = [];
  let hasError = false;

  for (let i = 0; i < selectedAccounts.length; i++) {
    const acc = selectedAccounts[i];
    acc._antiIdx = i;
    setApiAccountIndex(i);

    const ipInfo = antiDetect.getIpInfo(i);
    console.log('');
    console.log(`═══ 处理账号 [${i+1}/${selectedAccounts.length}]: ${acc.username} ═══`);
    console.log(`  🛡️ 反检测: IP=${ipInfo.ip} (${ipInfo.isp}·${ipInfo.province})`);

    const executor = new ActionExecutor(acc);
    const results = await executor.runPlan(planResult.plan || []);
    overallResults.push({ username: acc.username, results });

    const failed = results.filter(r => r.result && r.result.success === false);
    if (failed.length > 0) hasError = true;

    await antiDetect.smartPause(i, selectedAccounts.length, {
      batchSize: 3,
      pauseMin: 20000,
      pauseMax: 40000
    });

    if (i < selectedAccounts.length - 1) {
      await antiDetect.randomDelay(3000, 5000);
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
    plan: planResult,
    accounts: overallResults
  };
  saveResult(output);

  console.log('');
  console.log('✅ 全部完成！');
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl2.question('按回车键退出...', () => { rl2.close(); });
}

// ============================================================
// 启动
// ============================================================
main().catch(e => {
  console.error('程序异常:', e.message);
  console.error(e.stack);
  process.exit(1);
});
