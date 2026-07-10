/**
 * 艾德尔修仙传 - 自动卖出工具
 *
 * 功能：
 *   自动遍历背包 → 按条件筛选物品 → 上架交易所 / 系统回收
 *
 * 筛选条件：
 *   - 物品类型（material, consumable, medicine, herb, equipment 等）
 *   - 物品品质（1~8阶）
 *   - 数量大于 N 个才卖
 *   - 可选先卖数量多的
 *   - 卖出数量比例（百分比）
 *   - 单价（上架交易所用）
 *
 * 卖出方式：
 *   1. exchange — 上架交易所（自动获取报价，支持单价设置）
 *   2. system   — 系统回收（直接卖给 NPC，获得灵石）
 *
 * 使用：
 *   本地:  node auto_sell.js
 *   CI:    CI=true node auto_sell.js
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
const MAX_SELL_LISTINGS = 8; // 每人最多同时上架 8 个订单

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
// 签名 & API
// ============================================================
function makeSign(method, path, timestamp, bodyStr) {
  const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(data);
  return hmac.digest('hex');
}

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

// ============================================================
// 延迟 + 安全数字
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function int(v, def) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : def; }

// ============================================================
// 结果持久化
// ============================================================
function saveResult(result) {
  const batchIdx = process.env.BATCH_INDEX || '1';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'sell_result_' + batchIdx + '_' + ts + '.json';
  try {
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf-8');
    info('保存', '结果已保存: ' + filename);
  } catch (e) {
    warn('保存', '保存结果失败: ' + e.message);
  }
}

// ============================================================
// 账号结构
// ============================================================
class Account {
  constructor(username, password) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.token = '';
    this.accountId = 0;
  }
  isValid() {
    return this.username.length >= 2 && this.password.length >= 6;
  }
}

// ============================================================
// 加载账号文件
// ============================================================
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
// 背包物品分析
// ============================================================

/**
 * 展平背包为物品列表
 * 返回 [{ page, slotIndex, item, count }]
 */
function flattenInventory(inventory) {
  const items = [];
  if (!Array.isArray(inventory)) return items;
  for (let p = 0; p < inventory.length; p++) {
    const row = inventory[p];
    if (!Array.isArray(row)) continue;
    for (let s = 0; s < row.length; s++) {
      const slot = row[s];
      if (slot && slot.item) {
        items.push({
          page: p,
          slotIndex: s,
          item: slot.item,
          count: Math.max(1, Number(slot.count) || 1)
        });
      }
    }
  }
  return items;
}

/**
 * 物品是否可交易
 */
function isTradable(item) {
  if (!item) return false;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.includes('no_market')) return false;
  if (item.locked) return false;
  return true;
}

/**
 * 物品类型匹配
 */
function matchesType(item, typePatterns) {
  if (!typePatterns || typePatterns.length === 0) return true;
  const t = String(item.type || '').toLowerCase();
  return typePatterns.some(p => t === p.toLowerCase());
}

/**
 * 品质类型判断
 */
function getItemQuality(item) {
  return Math.max(1, Math.min(8, Math.floor(Number(item.quality) || 1)));
}

/**
 * 物品是否匹配品质范围
 */
function matchesQuality(item, minQuality, maxQuality) {
  const q = getItemQuality(item);
  if (minQuality > 0 && q < minQuality) return false;
  if (maxQuality > 0 && q > maxQuality) return false;
  return true;
}

// ============================================================
// 物品分类名称
// ============================================================
const TYPE_NAMES = {
  equipment: '装备',
  weapon: '武器',
  armor: '防具',
  accessory: '饰品',
  consumable: '消耗品',
  medicine: '药材',
  herb: '草药',
  material: '材料',
  recipe: '丹方',
  treasure: '宝物',
  formation: '阵法',
  soul: '魂魄',
  other: '其他'
};

function getTypeName(type) {
  return TYPE_NAMES[String(type).toLowerCase()] || type;
}

// ============================================================
// 卖出引擎
// ============================================================
class AutoSellEngine {
  /**
   * @param {Account} account - 账号
   * @param {Object} options
   * @param {string[]} options.types - 要卖出的物品类型列表（空=全部）
   * @param {number} options.minQuality - 最低品质（1-8, 0=不限）
   * @param {number} options.maxQuality - 最高品质（1-8, 0=不限）
   * @param {number} options.minCount - 数量 >= 此值才卖（0=不限）
   * @param {number} options.sellPercent - 卖出百分比（1-100）
   * @param {number} options.unitPrice - 交易所单价（灵石）, 0=系统回收
   * @param {boolean} options.prioritizeMore - 是否先卖数量多的
   * @param {string} options.mode - 'exchange' 或 'system'（auto=自动判断）
   */
  constructor(account, options) {
    this.account = account;
    this.options = Object.assign({
      types: [],
      minQuality: 0,
      maxQuality: 0,
      minCount: 0,
      sellPercent: 100,
      unitPrice: 0,
      prioritizeMore: true,
      mode: 'auto'
    }, options || {});
    this.stats = {
      scanned: 0,
      skipped: 0,
      soldToSystem: 0,
      listedOnMarket: 0,
      failed: 0,
      systemIncome: 0,
      marketListings: []
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

  /**
   * 登录
   */
  async login() {
    info(this.account.username, '正在登录...');
    const body = { username: this.account.username, password: this.account.password, machine_id: 'auto-sell-tool' };
    const data = await apiRequest('POST', '/auth/login', '', body);
    this.account.token = data.token;
    this.account.accountId = int(data.accountId, 0);
    ok(this.account.username, '登录成功, accountId=' + this.account.accountId);
  }

  /**
   * 获取背包数据
   */
  async getInventory() {
    info(this.account.username, '正在获取背包数据...');
    const data = await apiRequest('GET', '/player/sync', this.account.token);
    const player = data && data.player ? data.player : data;
    const inventory = player.inventory || [];
    const items = flattenInventory(inventory);
    info(this.account.username, '背包共 ' + items.length + ' 格物品');
    return { inventory, items, player };
  }

  /**
   * 筛选符合条件的物品
   */
  filterItems(items) {
    const opts = this.options;

    // 1. 按类型筛选
    let filtered = items.filter(it => matchesType(it.item, opts.types));

    // 2. 按品质筛选
    filtered = filtered.filter(it => matchesQuality(it.item, opts.minQuality, opts.maxQuality));

    // 3. 按数量最小值筛选
    if (opts.minCount > 0) {
      filtered = filtered.filter(it => it.count >= opts.minCount);
    }

    // 4. 锁定物品排除
    filtered = filtered.filter(it => it.item.locked !== true);

    return filtered;
  }

  /**
   * 获取交易所报价（单次）
   */
  async getQuote(item, page, slotIndex, quantity, unitPrice) {
    try {
      const qs = '?side=sell&unit_price=' + unitPrice + '&quantity=' + quantity
        + '&page=' + page + '&slot_index=' + slotIndex
        + '&item_id=' + int(item.id, 0);
      const data = await apiRequest('GET', '/exchange/quote' + qs, this.account.token);
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 上架交易所
   */
  async listOnMarket(item, page, slotIndex, quantity, unitPrice) {
    info(this.account.username, '上架 [' + item.name + '] x' + quantity + ' @ ' + unitPrice + '灵石');
    try {
      const body = {
        page,
        slot_index: slotIndex,
        expect_item_id: int(item.id, 0),
        quantity,
        unit_price: unitPrice
      };
      const data = await apiRequest('POST', '/exchange/listings', this.account.token, body);
      ok(this.account.username, '上架成功: ' + item.name + ' x' + quantity + ' @ ' + unitPrice + '灵石/个');
      this.stats.listedOnMarket++;
      this.stats.marketListings.push({
        item_name: item.name,
        item_id: int(item.id, 0),
        quantity,
        unit_price: unitPrice,
        listing_id: data.listing_id
      });
      return true;
    } catch (e) {
      warn(this.account.username, '上架失败 [' + item.name + ']: ' + e.message);
      this.stats.failed++;
      return false;
    }
  }

  /**
   * 系统回收
   */
  async sellToSystem(item, page, slotIndex, count) {
    info(this.account.username, '回收 [' + item.name + '] x' + count);
    try {
      const body = {
        page,
        slot_index: slotIndex,
        count,
        expect_item_id: int(item.id, 0)
      };
      const data = await apiRequest('POST', '/player/sell_item', this.account.token, body);
      const stones = data && data.spirit_stones ? data.spirit_stones : 0;
      ok(this.account.username, '回收成功: ' + item.name + ' x' + count + ' 获得 ' + stones + ' 灵石');
      this.stats.soldToSystem++;
      this.stats.systemIncome += stones;
      return true;
    } catch (e) {
      warn(this.account.username, '回收失败 [' + item.name + ']: ' + e.message);
      this.stats.failed++;
      return false;
    }
  }

  /**
   * 判断物品类型能否上架交易所
   * 装备和可堆叠物品通常可以，但有些物品有 no_market 标签
   */
  canListOnMarket(item) {
    // 无市场标签的不可上架
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('no_market')) return false;
    // 锁定装备不可上架
    if (item.locked) return false;
    return true;
  }

  /**
   * 运行卖出流程
   */
  async run() {
    this.shouldStop = false;
    const opts = this.options;
    const acc = this.account;

    info('引擎', '========================================');
    info('引擎', '自动卖出工具启动');
    info('引擎', '账号: ' + acc.username);
    info('引擎', '筛选条件: ' + JSON.stringify({
      物品类型: opts.types.length > 0 ? opts.types.map(t => getTypeName(t)).join(', ') : '全部',
      品质范围: (opts.minQuality || '不限') + ' ~ ' + (opts.maxQuality || '不限'),
      最小数量: opts.minCount || '不限',
      卖出比例: opts.sellPercent + '%',
      单价: opts.unitPrice > 0 ? opts.unitPrice + ' 灵石' : '系统回收',
      优先卖多: opts.prioritizeMore
    }));
    info('引擎', '========================================');

    // 1. 登录
    await this.login();
    await this.delay(500);

    // 2. 获取背包
    const { items, player } = await this.getInventory();
    if (items.length === 0) {
      warn('引擎', '背包为空，无可卖物品');
      this.stats.scanned = 0;
      return this.stats;
    }

    // 3. 筛选
    let candidates = this.filterItems(items);

    // 4. 排序：先卖数量多的
    if (opts.prioritizeMore) {
      candidates.sort((a, b) => b.count - a.count);
    } else {
      candidates.sort((a, b) => a.count - b.count);
    }

    this.stats.scanned = candidates.length;
    info('引擎', '符合条件: ' + candidates.length + ' 格物品');

    if (candidates.length === 0) {
      warn('引擎', '没有符合条件的物品');
      return this.stats;
    }

    // 显示待卖列表
    console.log('');
    console.log('待处理物品列表:');
    console.log('  ' + '名称'.padEnd(18) + '类型'.padEnd(10) + '品质'.padEnd(6) + '数量'.padEnd(6) + '方式');
    console.log('  ' + '─'.repeat(56));
    for (const c of candidates) {
      const mode = opts.unitPrice > 0 && this.canListOnMarket(c.item) && c.item.type !== 'equipment'
        ? '🏪上架' : '♻回收';
      console.log('  ' + String(c.item.name || '?').padEnd(18)
        + getTypeName(c.item.type).padEnd(10)
        + String(getItemQuality(c.item) + '阶').padEnd(6)
        + String(c.count).padEnd(6)
        + mode);
    }
    console.log('');

    // 5. 逐个处理
    let processed = 0;
    let activeListings = 0;

    // 先查已有挂单数
    try {
      const myListings = await apiRequest('GET', '/exchange/my-listings', this.account.token);
      const openSells = (Array.isArray(myListings.listings) ? myListings.listings : [])
        .filter(l => l.side === 'sell' && (l.status === 'open' || l.status === 'partial'));
      activeListings = openSells.length;
      info('引擎', '当前已有 ' + activeListings + '/' + MAX_SELL_LISTINGS + ' 个活跃挂单');
    } catch (e) {
      info('引擎', '查询挂单失败（不影响操作）: ' + e.message);
    }

    for (const c of candidates) {
      if (this.shouldStop) break;
      processed++;

      const sellCount = Math.max(1, Math.floor(c.count * opts.sellPercent / 100));
      info(acc.username, '[' + processed + '/' + candidates.length + '] ' + c.item.name + ' x' + sellCount + '/' + c.count);

      // 决定卖出方式
      const useMarket = opts.unitPrice > 0 && this.canListOnMarket(c.item)
        && activeListings < MAX_SELL_LISTINGS;

      if (useMarket) {
        // 上架交易所
        const success = await this.listOnMarket(c.item, c.page, c.slotIndex, sellCount, opts.unitPrice);
        if (success) activeListings++;
      } else {
        // 系统回收
        const success = await this.sellToSystem(c.item, c.page, c.slotIndex, sellCount);
      }

      await this.delay(800);
    }

    info('引擎', '========================================');
    info('引擎', '卖出完成!');
    info('引擎', '扫描: ' + this.stats.scanned + ' 格');
    info('引擎', '上架: ' + this.stats.listedOnMarket + ' 项');
    info('引擎', '回收: ' + this.stats.soldToSystem + ' 项, 获得 ' + this.stats.systemIncome + ' 灵石');
    info('引擎', '失败: ' + this.stats.failed + ' 项');
    info('引擎', '========================================');

    return this.stats;
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
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   艾德尔修仙传 - 自动卖出工具 v1.0             ║');
  console.log('║   功能: 按条件筛选背包物品，自动卖出            ║');
  console.log('║   支持: 类型/品质/数量过滤 → 交易所/系统回收    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

function showHelp() {
  console.log('可用物品类型:');
  console.log('  equipment  - 装备');
  console.log('  weapon     - 武器');
  console.log('  armor      - 防具');
  console.log('  accessory  - 饰品');
  console.log('  consumable - 消耗品');
  console.log('  medicine   - 药材');
  console.log('  herb       - 草药');
  console.log('  material   - 材料');
  console.log('  recipe     - 丹方');
  console.log('  treasure   - 宝物');
  console.log('');
  console.log('品质范围: 1~8 阶');
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

    let filepath = './accounts.txt';
    if (process.env.ACCOUNTS_DATA) {
      fs.writeFileSync(filepath, process.env.ACCOUNTS_DATA, 'utf-8');
    }

    const accounts = loadAccounts(filepath);
    if (accounts.length === 0) {
      console.error('❌ CI 模式下未找到有效账号！');
      process.exit(1);
    }

    // 从环境变量读取配置
    const typesRaw = String(process.env.SELL_TYPES || '').trim();
    const types = typesRaw ? typesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    const minQuality = getEnvInt('SELL_MIN_QUALITY', 0);
    const maxQuality = getEnvInt('SELL_MAX_QUALITY', 0);
    const minCount = getEnvInt('SELL_MIN_COUNT', 0);
    const sellPercent = Math.max(1, Math.min(100, getEnvInt('SELL_PERCENT', 100)));
    const unitPrice = getEnvInt('SELL_UNIT_PRICE', 0);
    const prioritizeMore = getEnvBool('SELL_PRIORITIZE_MORE', true);

    console.log('配置:');
    console.log('  账号: ' + accounts.length + ' 个');
    console.log('  物品类型: ' + (types.length > 0 ? types.join(', ') : '全部'));
    console.log('  品质范围: ' + (minQuality || '不限') + ' ~ ' + (maxQuality || '不限'));
    console.log('  最小数量: ' + (minCount || '不限'));
    console.log('  卖出比例: ' + sellPercent + '%');
    console.log('  单价: ' + (unitPrice > 0 ? unitPrice + ' 灵石' : '系统回收'));
    console.log('  先卖多的: ' + prioritizeMore);
    console.log('═══════════════════════════════════════════════');

    const overallStats = { totalAccounts: accounts.length, accounts: [] };
    let hasError = false;

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      console.log('');
      console.log('═══ 处理账号 [' + (i + 1) + '/' + accounts.length + ']: ' + acc.username + ' ═══');

      const engine = new AutoSellEngine(acc, {
        types,
        minQuality,
        maxQuality,
        minCount,
        sellPercent,
        unitPrice,
        prioritizeMore
      });

      process.on('SIGTERM', () => { engine.stop(); });

      try {
        const stats = await engine.run();
        overallStats.accounts.push({ username: acc.username, stats });
        if (stats.failed > 0) hasError = true;
      } catch (e) {
        err(acc.username, '处理失败: ' + e.message);
        overallStats.accounts.push({ username: acc.username, error: e.message });
        hasError = true;
      }

      if (i < accounts.length - 1) {
        console.log('');
        info('引擎', '等待 3 秒后处理下一个账号...');
        await sleep(3000);
      }
    }

    overallStats.timestamp = new Date().toISOString();
    saveResult(overallStats);

    console.log('');
    console.log('全部账号处理完成，退出码: ' + (hasError ? '1（有失败）' : '0（全部成功）'));
    process.exit(hasError ? 1 : 0);
  }

  // ============================================================
  // 交互模式
  // ============================================================
  let filepath = './accounts.txt';
  if (!fs.existsSync(filepath)) {
    console.log('未找到 accounts.txt');
    const input = await ask('请输入用户名: ');
    const pwd = await ask('请输入密码: ');
    if (input && pwd) {
      fs.writeFileSync(filepath, input + ',' + pwd, 'utf-8');
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

  console.log('当前 ' + accounts.length + ' 个账号:');
  for (const acc of accounts) {
    console.log('  [' + acc.username + ']');
  }

  console.log('');
  console.log('=== 筛选条件设置（直接回车使用默认值）===');
  showHelp();

  const typesInput = await ask('物品类型（逗号分隔，留空=全部）: ');
  const types = typesInput ? typesInput.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

  const minQuality = parseInt(await ask('最低品质 [0=不限]: ')) || 0;
  const maxQuality = parseInt(await ask('最高品质 [0=不限]: ')) || 0;
  const minCount = parseInt(await ask('最少数量 [0=不限]: ')) || 0;
  const sellPercent = Math.max(1, Math.min(100, parseInt(await ask('卖出比例% [100]: ')) || 100));
  const unitPrice = parseInt(await ask('交易所单价（0=系统回收） [0]: ')) || 0;
  const prioritizeInput = await ask('先卖数量多的 [Y/n]: ');
  const prioritizeMore = prioritizeInput.toLowerCase() !== 'n';

  console.log('');
  console.log('确认配置:');
  console.log('  物品类型: ' + (types.length > 0 ? types.join(', ') : '全部'));
  console.log('  品质范围: ' + (minQuality || '不限') + ' ~ ' + (maxQuality || '不限'));
  console.log('  最少数量: ' + (minCount || '不限'));
  console.log('  卖出比例: ' + sellPercent + '%');
  console.log('  卖出方式: ' + (unitPrice > 0 ? '交易所(单价' + unitPrice + '灵石)' : '系统回收'));
  console.log('  先卖多的: ' + prioritizeMore);
  console.log('');

  const confirm = await ask('是否开始? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
    console.log('已取消');
    process.exit(0);
  }

  const overallStats = { totalAccounts: accounts.length, accounts: [] };

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log('');
    console.log('═══ 处理账号 [' + (i + 1) + '/' + accounts.length + ']: ' + acc.username + ' ═══');

    const engine = new AutoSellEngine(acc, {
      types,
      minQuality,
      maxQuality,
      minCount,
      sellPercent,
      unitPrice,
      prioritizeMore
    });

    process.on('SIGINT', () => { engine.stop(); });

    try {
      const stats = await engine.run();
      overallStats.accounts.push({ username: acc.username, stats });
    } catch (e) {
      err(acc.username, '处理失败: ' + e.message);
      overallStats.accounts.push({ username: acc.username, error: e.message });
    }

    if (i < accounts.length - 1) {
      console.log('');
      info('引擎', '等待 3 秒后处理下一个账号...');
      await sleep(3000);
    }
  }

  overallStats.timestamp = new Date().toISOString();
  saveResult(overallStats);

  console.log('');
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
