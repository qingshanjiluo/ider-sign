/**
 * 艾德尔修仙传 - 自动炼丹升级工具 🧪
 *
 * 功能流程：
 *   1. 登录账号
 *   2. 炼制 5 枚筑基丹（自动采集材料 + 炼丹）
 *   3. 领取邮件奖励（筑基丹）
 *   4. 在背包中使用筑基丹
 *   5. 一直点击升级到 120 级
 *   6. 执行突破
 *   7. 继续升级到无法再升
 *
 * 使用：
 *   1. 准备 alchemy_accounts.txt 账号文件
 *   2. 运行 node auto_alchemy.js
 *
 * CI 模式：
 *   set CI=true && set ACCOUNTS_DATA=... && node auto_alchemy.js
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
const TARGET_LEVEL = 120;
const MAX_RETRY = 3;

// ============================================================
// CI 检测 & 配置
// ============================================================
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

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
// 🧪 自动炼丹升级引擎
// ============================================================
class AlchemyEngine {
  constructor(account) {
    this.account = account;
    this.stats = {
      pillsCrafted: 0,
      pillsClaimed: 0,
      pillsUsed: 0,
      levelBefore: 0,
      levelAfter: 0,
      breakthroughSuccess: false,
      maxLevelReached: 0
    };
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

  // ============================================================
  // 1. 登录
  // ============================================================
  async login() {
    info(this.account.username, '正在登录...');
    const idx = this.account._antiIdx || 0;
    const loginBody = antiDetect.buildLoginBody(this.account.username, this.account.password, idx);
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('POST', '/auth/login', '', loginBody, antiHeaders);
    this.account.token = data.token;
    this.account.accountId = int(data.accountId, 0);
    ok(this.account.username, '登录成功, accountId=' + this.account.accountId);
    return true;
  }

  // ============================================================
  // 2. 获取玩家数据（等级/背包/资源）
  // ============================================================
  async getPlayerData() {
    info(this.account.username, '正在获取玩家数据...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);
    const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
    const player = data && data.player ? data.player : data;
    const level = int(player.level, 1);
    const spiritStones = int(player.spirit_stones, 0);
    const inventory = player.inventory || [];
    info(this.account.username, `等级: ${level}, 灵石: ${spiritStones}`);
    return { level, spiritStones, inventory, player };
  }

  // ============================================================
  // 3. 炼制筑基丹（自动采集 + 炼丹）
  // ============================================================
  async craftPills(count = 5) {
    info(this.account.username, `开始炼制 ${count} 枚筑基丹...`);
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    let crafted = 0;
    for (let i = 0; i < count; i++) {
      if (this.shouldStop) break;

      // 3a. 采集材料（自动采集）
      info(this.account.username, `[${i+1}/${count}] 采集材料...`);
      try {
        await apiRequest('POST', '/player/gather', this.account.token, { auto: true }, antiHeaders);
        await this.delay(1000);
      } catch (e) {
        warn(this.account.username, `采集失败: ${e.message}，重试...`);
        await this.delay(1500);
        continue;
      }

      // 3b. 炼丹
      info(this.account.username, `[${i+1}/${count}] 炼制筑基丹...`);
      try {
        const result = await apiRequest('POST', '/player/alchemy', this.account.token, {
          recipe_id: 1,  // 筑基丹配方ID
          quantity: 1
        }, antiHeaders);
        if (result && result.success !== false) {
          crafted++;
          ok(this.account.username, `成功炼制筑基丹 ${crafted}/${count}`);
        } else {
          warn(this.account.username, `炼丹失败: ${result?.error || '未知错误'}`);
        }
      } catch (e) {
        warn(this.account.username, `炼丹异常: ${e.message}`);
      }

      await antiDetect.randomDelay(1200, 2500);
    }

    this.stats.pillsCrafted = crafted;
    ok(this.account.username, `炼制完成: 成功 ${crafted}/${count} 枚`);
    return crafted;
  }

  // ============================================================
  // 4. 领取邮件（筑基丹）
  // ============================================================
  async claimMail() {
    info(this.account.username, '正在检查邮件...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    try {
      // 获取邮件列表
      const mailData = await apiRequest('GET', '/mail/list', this.account.token, null, antiHeaders);
      const mails = mailData.mails || [];
      info(this.account.username, `邮件数量: ${mails.length}`);

      let claimed = 0;
      for (const mail of mails) {
        if (mail.status === 'unread' || mail.status === 'claimed') {
          // 尝试领取附件
          const claimResult = await apiRequest('POST', '/mail/claim', this.account.token, {
            mail_id: mail.id
          }, antiHeaders);
          if (claimResult && claimResult.success !== false) {
            claimed++;
            ok(this.account.username, `已领取邮件: ${mail.title || '无标题'}`);
          }
          await antiDetect.randomDelay(500, 1000);
        }
      }

      this.stats.pillsClaimed = claimed;
      ok(this.account.username, `共领取 ${claimed} 封邮件`);
      return claimed;
    } catch (e) {
      warn(this.account.username, `领取邮件失败: ${e.message}`);
      return 0;
    }
  }

  // ============================================================
  // 5. 在背包中使用筑基丹
  // ============================================================
  async usePills() {
    info(this.account.username, '正在使用筑基丹...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

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
          // 查找筑基丹（假设名称包含 "筑基丹" 或 item_id 匹配）
          const name = String(item.name || '').toLowerCase();
          const type = String(item.type || '').toLowerCase();
          if (name.includes('筑基丹') || (type === 'consumable' && name.includes('筑基'))) {
            const count = Math.min(Number(slot.count) || 1, 5 - used);
            if (count <= 0) continue;

            const body = {
              page: p,
              slot_index: s,
              count: count,
              expect_item_id: int(item.id, 0)
            };
            try {
              const result = await apiRequest('POST', '/player/use_item', this.account.token, body, antiHeaders);
              used += count;
              ok(this.account.username, `使用筑基丹 x${count}`);
              await antiDetect.randomDelay(500, 1000);
            } catch (e) {
              warn(this.account.username, `使用筑基丹失败: ${e.message}`);
            }
            if (used >= 5) break;
          }
        }
        if (used >= 5) break;
      }

      this.stats.pillsUsed = Math.min(used, 5);
      ok(this.account.username, `共使用 ${this.stats.pillsUsed} 枚筑基丹`);
      return this.stats.pillsUsed;
    } catch (e) {
      warn(this.account.username, `使用筑基丹失败: ${e.message}`);
      return 0;
    }
  }

  // ============================================================
  // 6. 升级到目标等级
  // ============================================================
  async levelUpTo(targetLevel = TARGET_LEVEL) {
    info(this.account.username, `开始升级到 ${targetLevel} 级...`);
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    let currentLevel = 0;
    let attempts = 0;
    let maxAttempts = 500;

    while (attempts < maxAttempts && !this.shouldStop) {
      attempts++;

      try {
        // 获取当前等级
        const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
        const player = data && data.player ? data.player : data;
        currentLevel = int(player.level, 0);

        if (currentLevel >= targetLevel) {
          ok(this.account.username, `已达到目标等级 ${targetLevel} (当前 ${currentLevel})`);
          this.stats.maxLevelReached = currentLevel;
          return currentLevel;
        }

        // 尝试升级
        const result = await apiRequest('POST', '/player/level_up', this.account.token, {}, antiHeaders);
        if (result && result.success !== false) {
          info(this.account.username, `升级成功: ${currentLevel} → ${currentLevel + 1}`);
          this.stats.levelBefore = this.stats.levelBefore || currentLevel;
        } else {
          const error = result?.error || '未知原因';
          if (error.includes('灵石不足') || error.includes('资源不足')) {
            warn(this.account.username, `升级停止: ${error}`);
            break;
          }
          warn(this.account.username, `升级失败: ${error}`);
          // 可能是冷却中，等一等再试
          await antiDetect.randomDelay(3000, 5000);
        }

        await antiDetect.randomDelay(300, 800);
      } catch (e) {
        if (e.message.includes('灵石不足') || e.message.includes('资源不足')) {
          warn(this.account.username, `升级停止: ${e.message}`);
          break;
        }
        warn(this.account.username, `升级异常: ${e.message}`);
        await this.delay(2000);
      }
    }

    // 最终获取等级
    try {
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.player : data;
      this.stats.maxLevelReached = int(player.level, 0);
      this.stats.levelAfter = this.stats.maxLevelReached;
    } catch (e) {
      // ignore
    }

    ok(this.account.username, `升级结束: 最终等级 ${this.stats.maxLevelReached}`);
    return this.stats.maxLevelReached;
  }

  // ============================================================
  // 7. 突破
  // ============================================================
  async breakthrough() {
    info(this.account.username, '尝试突破...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    try {
      const result = await apiRequest('POST', '/player/breakthrough', this.account.token, {}, antiHeaders);
      if (result && result.success !== false) {
        this.stats.breakthroughSuccess = true;
        ok(this.account.username, '突破成功！');
        // 突破后可能等级变化，重新获取
        await this.delay(1000);
        const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
        const player = data && data.player ? data.data : data;
        this.stats.maxLevelReached = int(player?.level || this.stats.maxLevelReached, 0);
        return true;
      } else {
        const error = result?.error || '未知原因';
        warn(this.account.username, `突破失败: ${error}`);
        return false;
      }
    } catch (e) {
      if (e.message.includes('条件不足') || e.message.includes('资源不足')) {
        warn(this.account.username, `突破条件不足: ${e.message}`);
      } else {
        warn(this.account.username, `突破异常: ${e.message}`);
      }
      return false;
    }
  }

  // ============================================================
  // 8. 继续升级到无法再升
  // ============================================================
  async levelUpUntilStuck() {
    info(this.account.username, '继续升级直到无法再升...');
    const idx = this.account._antiIdx || 0;
    const antiHeaders = antiDetect.buildAntiDetectHeaders(idx);

    let lastLevel = 0;
    let stuckCount = 0;
    let attempts = 0;
    const maxAttempts = 1000;

    while (attempts < maxAttempts && !this.shouldStop && stuckCount < 5) {
      attempts++;

      try {
        const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
        const player = data && data.player ? data.data : data;
        const currentLevel = int(player?.level || 0, 0);

        if (currentLevel === lastLevel) {
          stuckCount++;
          if (stuckCount >= 3) {
            info(this.account.username, `等级卡在 ${currentLevel}，尝试突破...`);
            await this.breakthrough();
            await this.delay(1500);
            stuckCount = 0;
            continue;
          }
        } else {
          stuckCount = 0;
          lastLevel = currentLevel;
        }

        // 尝试升级
        const result = await apiRequest('POST', '/player/level_up', this.account.token, {}, antiHeaders);
        if (result && result.success !== false) {
          info(this.account.username, `升级成功: ${lastLevel} → ${lastLevel + 1}`);
          lastLevel++;
          this.stats.maxLevelReached = lastLevel;
          await antiDetect.randomDelay(300, 600);
        } else {
          const error = result?.error || '未知原因';
          if (error.includes('灵石不足') || error.includes('资源不足')) {
            warn(this.account.username, `升级停止: ${error}`);
            break;
          }
          stuckCount++;
          await antiDetect.randomDelay(2000, 4000);
        }
      } catch (e) {
        if (e.message.includes('灵石不足') || e.message.includes('资源不足')) {
          warn(this.account.username, `升级停止: ${e.message}`);
          break;
        }
        warn(this.account.username, `升级异常: ${e.message}`);
        await this.delay(2000);
        stuckCount++;
      }
    }

    // 最终获取等级
    try {
      const data = await apiRequest('GET', '/player/sync', this.account.token, null, antiHeaders);
      const player = data && data.player ? data.data : data;
      this.stats.maxLevelReached = int(player?.level || this.stats.maxLevelReached, 0);
    } catch (e) {
      // ignore
    }

    ok(this.account.username, `最终等级: ${this.stats.maxLevelReached}`);
    return this.stats.maxLevelReached;
  }

  // ============================================================
  // 主流程
  // ============================================================
  async run() {
    this.shouldStop = false;
    const acc = this.account;
    const idx = acc._antiIdx || 0;
    const ipInfo = antiDetect.getIpInfo(idx);

    info('🧪', '========================================');
    info('🧪', '自动炼丹升级工具启动');
    info('🧪', '账号: ' + acc.username);
    info('🧪', '🛡️ 反检测: IP=' + ipInfo.ip + ' (' + ipInfo.isp + '·' + ipInfo.province + ')');
    info('🧪', '========================================');

    // 1. 登录
    await this.login();
    await antiDetect.randomDelay(800, 1500);

    // 获取初始等级
    let playerData = await this.getPlayerData();
    this.stats.levelBefore = playerData.level;
    info('🧪', '初始等级: ' + this.stats.levelBefore);

    // 2. 炼制 5 枚筑基丹
    await this.craftPills(5);
    await antiDetect.randomDelay(1200, 2000);

    // 3. 领取邮件
    await this.claimMail();
    await antiDetect.randomDelay(800, 1500);

    // 4. 使用筑基丹
    await this.usePills();
    await antiDetect.randomDelay(800, 1500);

    // 5. 升级到 120 级
    await this.levelUpTo(TARGET_LEVEL);
    await antiDetect.randomDelay(1000, 2000);

    // 6. 突破
    await this.breakthrough();
    await antiDetect.randomDelay(1500, 2500);

    // 7. 继续升级到无法再升
    await this.levelUpUntilStuck();

    this.stats.levelAfter = this.stats.maxLevelReached;

    // 输出统计
    console.log('');
    console.log('══════════════ 执行结果 ══════════════');
    console.log('  账号:          ' + acc.username);
    console.log('  初始等级:      ' + this.stats.levelBefore);
    console.log('  最终等级:      ' + this.stats.levelAfter);
    console.log('  炼制筑基丹:    ' + this.stats.pillsCrafted + ' 枚');
    console.log('  领取邮件:      ' + this.stats.pillsClaimed + ' 封');
    console.log('  使用筑基丹:    ' + this.stats.pillsUsed + ' 枚');
    console.log('  突破成功:      ' + (this.stats.breakthroughSuccess ? '✅' : '❌'));
    console.log('═══════════════════════════════════════');
    console.log('');

    return this.stats;
  }
}

// ============================================================
// 结果保存
// ============================================================
function saveResult(results) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'alchemy_result_' + ts + '.json';
  try {
    fs.writeFileSync(filename, JSON.stringify(results, null, 2), 'utf-8');
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
  console.log('║         艾德尔修仙传 - 自动炼丹升级工具 v1.0           ║');
  console.log('║         🧪 一键炼制筑基丹 + 升级突破                   ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  📂 账号文件：./alchemy_accounts.txt                   ║');
  console.log('║     格式：每行 username,password                       ║');
  console.log('║                                                         ║');
  console.log('║  🔧 功能流程：                                          ║');
  console.log('║     1️⃣ 登录账号                                        ║');
  console.log('║     2️⃣ 炼制 5 枚筑基丹（自动采集 + 炼丹）             ║');
  console.log('║     3️⃣ 领取邮件（获取筑基丹）                          ║');
  console.log('║     4️⃣ 在背包中使用筑基丹                              ║');
  console.log('║     5️⃣ 升级到 120 级                                   ║');
  console.log('║     6️⃣ 执行突破                                        ║');
  console.log('║     7️⃣ 继续升级到无法再升                              ║');
  console.log('║                                                         ║');
  console.log('║  🛡️ 反检测：IP伪装(31段运营商)/独立machine_id         ║');
  console.log('║     浏览器指纹轮换/随机延迟/智能分段暂停               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
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

    const accountFile = process.env.ACCOUNT_FILE || './alchemy_accounts.txt';
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
    console.log('');

    const overallResults = [];
    let hasError = false;

    for (let i = 0; i < selectedAccounts.length; i++) {
      const acc = selectedAccounts[i];
      acc._antiIdx = i;
      setApiAccountIndex(i);

      console.log('');
      console.log(`═══ 处理账号 [${i+1}/${selectedAccounts.length}]: ${acc.username} ═══`);

      const engine = new AlchemyEngine(acc);
      try {
        const stats = await engine.run();
        overallResults.push({ username: acc.username, stats });
        if (stats.pillsCrafted < 5) hasError = true;
      } catch (e) {
        err(acc.username, '处理失败: ' + e.message);
        overallResults.push({ username: acc.username, error: e.message });
        hasError = true;
      }

      await antiDetect.smartPause(i, selectedAccounts.length, {
        batchSize: 2,
        pauseMin: 15000,
        pauseMax: 30000
      });

      if (i < selectedAccounts.length - 1) {
        await antiDetect.randomDelay(3000, 5000);
      }
    }

    const output = {
      timestamp: new Date().toISOString(),
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
  let filepath = './alchemy_accounts.txt';
  if (!fs.existsSync(filepath)) {
    console.log('未找到 alchemy_accounts.txt');
    console.log('创建默认账号文件...');
    const username = await ask('请输入用户名: ');
    const pwd = await ask('请输入密码: ');
    if (username && pwd) {
      fs.writeFileSync(filepath, username + ',' + pwd, 'utf-8');
      console.log('已创建 alchemy_accounts.txt');
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
  console.log('');
  const confirm = await ask('是否开始自动炼丹升级? (Y/n): ');
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

    console.log('');
    console.log(`═══ 处理账号 [${i+1}/${selectedAccounts.length}]: ${acc.username} ═══`);

    const engine = new AlchemyEngine(acc);
    try {
      const stats = await engine.run();
      overallResults.push({ username: acc.username, stats });
      if (stats.pillsCrafted < 5) hasError = true;
    } catch (e) {
      err(acc.username, '处理失败: ' + e.message);
      overallResults.push({ username: acc.username, error: e.message });
      hasError = true;
    }

    await antiDetect.smartPause(i, selectedAccounts.length, {
      batchSize: 2,
      pauseMin: 15000,
      pauseMax: 30000
    });

    if (i < selectedAccounts.length - 1) {
      await antiDetect.randomDelay(3000, 5000);
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
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
