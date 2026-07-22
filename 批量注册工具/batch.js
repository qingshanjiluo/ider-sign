/**
 * 艾德尔修仙传 - 批量注册自动化工具 v2.1 🛡️
 *
 * 功能：
 *   批量注册账号 → 创建角色（金灵根100） → 绑定邀请码
 *   → 装备所有技能 → 装备铁剑 → 设置主功法吐纳 → 切换荒石村 → 自动战斗
 *
 * 🛡️ 反封号机制 v3.0（集成自「艾德尔账号切换·防IP检测」核心策略）：
 *   - 每账号独立伪造 IP（通过 X-Forwarded-For / X-Real-IP 等）
 *   - 每账号独立 machine_id（格式多样防浏览器指纹检测）
 *   - 完整浏览器指纹轮换（UA / Sec-CH-UA / Accept-Language）
 *   - CDN代理链模拟（Via / X-Cache）
 *   - 操作间随机延迟（防频率分析）
 *   - 智能分段暂停（每3个账号休息20-40秒）
 *
 * 使用：
 *   编辑 accounts.txt 填入账号信息，然后运行 start.bat
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
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
// 签名 & API（带 🛡️ 反检测头注入）
// ============================================================
let _apiAccountIndex = 0;
let _apiCallCounter = 0;

function setApiAccountIndex(idx) { _apiAccountIndex = idx; _apiCallCounter = 0; }

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

  // 🛡️ 注入反检测头（每账号独立IP + 浏览器指纹）
  // 参照篡改猴脚本的防IP检测核心策略
  const antiHeaders = antiDetect.buildAntiDetectHeaders(_apiAccountIndex + (_apiCallCounter % 100));
  Object.assign(headers, antiHeaders);
  _apiCallCounter++;

  // 混入额外头（用于自定义覆盖）
  Object.assign(headers, extraHeaders);

  const url = API_BASE + path;
  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
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
// 账号结构
// ============================================================
class Account {
  constructor(username, password, inviteCode) {
    this.username = String(username || '').trim();
    this.password = String(password || '').trim();
    this.inviteCode = String(inviteCode || '').trim();
    this.token = '';
    this.accountId = 0;
    this.playerName = '';
  }
  isValid() {
    return this.username.length >= 2 && this.password.length >= 6;
  }
}

// ============================================================
// 加载账号文件
// ============================================================
// ============================================================
// 加载账号文件（同时记录原始行索引，用于注册后标记完成）
// ============================================================
function loadAccounts(filepath) {
  if (!fs.existsSync(filepath)) {
    warn('加载', '文件不存在: ' + filepath);
    return [];
  }
  const rawLines = fs.readFileSync(filepath, 'utf-8').split('\n');
  const trimmedLines = rawLines.map(l => l.trim());
  const accounts = [];
  for (let i = 0; i < trimmedLines.length; i++) {
    const line = trimmedLines[i];
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const acc = new Account(parts[0], parts[1], parts[2] || '');
      if (acc.isValid()) {
        acc._lineIndex = i;     // 记录在文件中的原始行号
        acc._rawLine = rawLines[i]; // 保留原始行内容
        accounts.push(acc);
      } else {
        warn('加载', '跳过无效账号(用户名>=2字符,密码>=6位): ' + parts[0]);
      }
    } else {
      warn('加载', '跳过无效行: ' + line);
    }
  }
  info('加载', '共加载 ' + accounts.length + ' 个账号');
  return accounts;
}

// ============================================================
// 批量注册引擎
// ============================================================
class BatchEngine {
  constructor(accounts, options) {
    this.accounts = accounts;
    this.accountFilePath = (options && options.accountFilePath) || './accounts.txt';
    this.options = Object.assign({
      mapId: 1,                      // 荒石村
      techniqueId: 1,                // 吐纳法
      autoBattle: true,
      autoRestart: true,
      delayBetweenAccounts: 5000,    // 🛡️ 账号间隔增大到5s防频率检测
      delayBetweenSteps: 1200,       // 🛡️ 步骤间隔增大到1.2s
      spiritRoots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 },
      machineId: 'batch-tool-nodejs'
    }, options || {});
    this.stats = { success: 0, fail: 0, skip: 0 };
    this.shouldStop = false;
  }

  /** 🛡️ 获取当前账号关联的 antiDetect 索引（用于独立IP分配） */
  getAntiDetectIndex(acc) {
    return acc._lineIndex !== undefined ? acc._lineIndex : (this.stats.success + this.stats.fail);
  }

  stop() { this.shouldStop = true; }

  /**
   * 在 accounts.txt 中将已注册成功的账号行前面加上 # 注释
   * 这样下次运行不会重复注册
   */
  markAccountDone(acc) {
    if (acc._lineIndex === undefined || acc._lineIndex < 0) return;
    try {
      const content = fs.readFileSync(this.accountFilePath, 'utf-8');
      const lines = content.split('\n');
      const idx = acc._lineIndex;
      if (idx < lines.length) {
        const trimmed = lines[idx].trim();
        if (!trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          lines[idx] = '# ' + lines[idx];
          fs.writeFileSync(this.accountFilePath, lines.join('\n'), 'utf-8');
          info('标记', acc.username + ' 已标记完成（行首加#）');
        }
      }
    } catch (e) {
      warn('标记', '标记账号完成失败: ' + e.message);
    }
  }

  async delay(ms) {
    if (ms <= 0 || this.shouldStop) return;
    const step = 100;
    for (let i = 0; i < ms / step; i++) {
      if (this.shouldStop) return;
      await sleep(step);
    }
  }

  // ============================================================
  // 步骤1: 注册
  // ============================================================
  async stepRegister(acc) {
    info(acc.username, '正在注册账号...');
    // 🛡️ 为每个账号生成独立 machine_id（参照篡改猴脚本的设计）
    const idx = this.getAntiDetectIndex(acc);
    const machineId = antiDetect.generateMachineId(idx);
    const body = { username: acc.username, password: acc.password, machine_id: machineId };
    const data = await apiRequest('POST', '/auth/register', '', body);
    acc.token = data.token;
    acc.accountId = int(data.accountId, 0);
    ok(acc.username, '注册成功, accountId=' + acc.accountId + ' 🛡️machine=' + machineId.slice(0, 12) + '...');
  }

  // ============================================================
  // 步骤2: 登录
  // ============================================================
  async stepLogin(acc) {
    info(acc.username, '正在登录...');
    // 🛡️ 每账号独立 machine_id
    const machineId = antiDetect.generateMachineId(this.getAntiDetectIndex(acc));
    const body = { username: acc.username, password: acc.password, machine_id: machineId };
    const data = await apiRequest('POST', '/auth/login', '', body);
    acc.token = data.token;
    acc.accountId = int(data.accountId, 0);
    ok(acc.username, '登录成功, accountId=' + acc.accountId);
  }

  // ============================================================
  // 步骤3: 创建角色（金灵根100）
  // ============================================================
  async stepCreateCharacter(acc) {
    info(acc.username, '正在创建角色...');
    const body = { name: acc.playerName, spirit_roots: this.options.spiritRoots };
    const data = await apiRequest('POST', '/player/create', acc.token, body);
    acc.playerName = data.player.name;
    ok(acc.username, '角色创建成功: ' + acc.playerName + ' 灵根=' + JSON.stringify(this.options.spiritRoots));
  }

  // ============================================================
  // 步骤4: 绑定邀请码
  // ============================================================
  async stepBindInvite(acc) {
    if (!acc.inviteCode) {
      info(acc.username, '无邀请码，跳过');
      return;
    }
    info(acc.username, '正在绑定邀请码: ' + acc.inviteCode);
    const body = { invite_code: acc.inviteCode };
    try {
      const data = await apiRequest('POST', '/invite/bind', acc.token, body);
      ok(acc.username, '邀请码绑定成功, 邀请人: ' + (data.inviter_name || '?') + ', 获得灵石: ' + int(data.stones_granted, 0));
    } catch (e) {
      warn(acc.username, '绑定邀请码失败(可能已超12h或已绑定): ' + e.message);
    }
  }

  // ============================================================
  // 步骤5: 装备初始 3 个技能（重击/火球术/治疗术）
  // ============================================================
  // 初始创建角色后自动解锁以下 3 个技能：
  //   id=1  重击    active  physical（物理伤害）
  //   id=2  火球术  active  magic（法术伤害）
  //   id=3  治疗术  active  heal（回血）
  // 每个技能各自占用一个技能栏位，分别调用 equip_skill 装备
  // 最大技能栏位 = 5（MAX_EQUIPPED_SKILLS）
  async stepEquipSkills(acc) {
    info(acc.username, '正在装备初始 3 技能（重击/火球术/治疗术）...');
    const starterSkillIds = [1, 2, 3];
    const starterNames = { 1: '重击', 2: '火球术', 3: '治疗术' };
    let equippedCount = 0;
    for (const skillId of starterSkillIds) {
      if (this.shouldStop) return;
      try {
        await apiRequest('POST', '/player/equip_skill', acc.token, { skill_id: skillId });
        equippedCount++;
        ok(acc.username, starterNames[skillId] + ' 装备成功');
        await sleep(200);
      } catch (e) {
        // 如果已装备或栏位满了，不算失败
        if (e.message && (e.message.includes('已装备'))) {
          equippedCount++;
          info(acc.username, starterNames[skillId] + ' 已装备，跳过');
        } else if (e.message && (e.message.includes('位置') || e.message.includes('已满'))) {
          warn(acc.username, starterNames[skillId] + ' 装备失败（栏位已满）');
        } else {
          warn(acc.username, starterNames[skillId] + ' 装备失败: ' + e.message);
        }
      }
    }
    ok(acc.username, '技能装备完成: ' + equippedCount + '/' + starterSkillIds.length);
  }

  // ============================================================
  // 步骤6: 装备铁剑（page=0, slot=0，初始创建时自动获得）
  // ============================================================
  async stepEquipIronSword(acc) {
    info(acc.username, '正在装备铁剑...');
    try {
      // 使用 /player/sync 获取完整玩家数据（包含 inventory）
      // /player/state 不返回背包（见 buildPlayerStateForClient），必须用 sync
      const sync = await apiRequest('GET', '/player/sync', acc.token);
      const inv = sync && sync.player && sync.player.inventory ? sync.player.inventory : [];
      let found = false;
      if (inv[0] && inv[0][0] && inv[0][0].item && String(inv[0][0].item.name || '').includes('铁剑')) {
        await apiRequest('POST', '/player/equip', acc.token, { page: 0, slot_index: 0, expect_item_id: int(inv[0][0].item.id, 0) });
        found = true;
      } else {
        // 遍历背包查找铁剑
        for (let p = 0; p < inv.length; p++) {
          if (!inv[p]) continue;
          for (let s = 0; s < inv[p].length; s++) {
            const slot = inv[p][s];
            if (slot && slot.item && String(slot.item.name || '').includes('铁剑')) {
              await apiRequest('POST', '/player/equip', acc.token, { page: p, slot_index: s, expect_item_id: int(slot.item.id, 0) });
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      if (found) { ok(acc.username, '铁剑装备成功'); }
      else { warn(acc.username, '背包中未找到铁剑'); }
    } catch (e) { warn(acc.username, '装备铁剑失败: ' + e.message); }
  }

  // ============================================================
  // 步骤7: 设置主功法（吐纳法 id=1）
  // ============================================================
  async stepSetTechnique(acc) {
    info(acc.username, '正在设置主功法: 吐纳法 (id=' + this.options.techniqueId + ')');
    try {
      await apiRequest('POST', '/player/set_technique', acc.token, { slot: 'main', technique_id: this.options.techniqueId });
      ok(acc.username, '吐纳法设置成功');
    } catch (e) { warn(acc.username, '设置功法失败: ' + e.message); }
  }

  // ============================================================
  // 步骤8: 切换地图（荒石村）
  // ============================================================
  async stepSetMap(acc) {
    info(acc.username, '正在切换地图到荒石村 (id=' + this.options.mapId + ')');
    try {
      await apiRequest('POST', '/player/set_map', acc.token, { map_id: this.options.mapId });
      ok(acc.username, '地图切换成功');
    } catch (e) { warn(acc.username, '切换地图失败: ' + e.message); }
  }

  // ============================================================
  // 步骤9: 开始战斗
  // ============================================================
  async stepStartBattle(acc) {
    if (this.options.autoBattle) {
      info(acc.username, '正在开始战斗...');
      try {
        await apiRequest('POST', '/battle/start', acc.token, { mapId: this.options.mapId, poll_mode: false, auto_restart: false });
        ok(acc.username, '战斗已启动');
      } catch (e) { warn(acc.username, '开始战斗失败: ' + e.message); }
    }
    if (this.options.autoRestart) {
      await sleep(500);
      info(acc.username, '正在开启自动刷怪...');
      try {
        await apiRequest('POST', '/battle/auto_restart', acc.token, { enabled: true, map_id: this.options.mapId });
        ok(acc.username, '自动刷怪已开启');
      } catch (e) { warn(acc.username, '自动刷怪设置失败: ' + e.message); }
    }
  }

  // ============================================================
  // 处理单个账号（含 🛡️ 反封号设置）
  // ============================================================
  async processAccount(acc) {
    const sep = '─── ' + acc.username + ' ───';
    info(acc.username, '═'.repeat(sep.length));
    info(acc.username, sep);
    info(acc.username, '═'.repeat(sep.length));

    // 🛡️ 设置API索引，使此账号所有请求使用独立IP和浏览器指纹
    const antiIdx = this.getAntiDetectIndex(acc);
    setApiAccountIndex(antiIdx);
    const ipInfo = antiDetect.getIpInfo(antiIdx);
    info(acc.username, `🛡️ 伪装IP: ${ipInfo.ip} (${ipInfo.isp}·${ipInfo.province})`);

    try {
      // 🛡️ 步骤间随机延迟（防频率检测，参照篡改猴脚本的 randomInt 实现）
      const stepDelay = () => antiDetect.randomDelay(800, 2000);

      // 第1步：注册
      await this.stepRegister(acc);
      await stepDelay();

      // 第2步：创建角色（金灵根100）
      await this.stepCreateCharacter(acc);
      await stepDelay();

      // 第3步：绑定邀请码
      await this.stepBindInvite(acc);
      await stepDelay();

      // 第4步：装备技能
      await this.stepEquipSkills(acc);
      await stepDelay();

      // 第5步：装备铁剑
      await this.stepEquipIronSword(acc);
      await stepDelay();

      // 第6步：设置主功法
      await this.stepSetTechnique(acc);
      await stepDelay();

      // 第7步：切换地图
      await this.stepSetMap(acc);
      await stepDelay();

      // 第8步：开始战斗
      await this.stepStartBattle(acc);

      ok(acc.username, '★★★★★ 全部完成! ★★★★★');
      return true;

    } catch (e) {
      err(acc.username, '处理失败: ' + e.message);
      return false;
    }
  }

  // ============================================================
  // 运行全部
  // ============================================================
  async run() {
    this.shouldStop = false;
    this.stats = { success: 0, fail: 0, skip: 0 };
    const accounts = this.accounts;

    info('引擎', '========================================');
    info('引擎', '批量注册自动化开始 🛡️ 反封号已激活');
    info('引擎', '共 ' + accounts.length + ' 个账号');
    info('引擎', '选项: ' + JSON.stringify({
      地图ID: this.options.mapId,
      功法ID: this.options.techniqueId,
      自动战斗: this.options.autoBattle,
      自动刷怪: this.options.autoRestart,
      账号间隔: this.options.delayBetweenAccounts + 'ms',
    }));
    info('引擎', '🛡️ 反检测: 独立IP+机器码+浏览器指纹+随机延迟+智能分段');
    info('引擎', '========================================');

    for (let i = 0; i < accounts.length; i++) {
      if (this.shouldStop) {
        warn('引擎', '用户中断');
        break;
      }
      const acc = accounts[i];
      // 使用序号作为玩家名
      acc.playerName = acc.username;
      const result = await this.processAccount(acc);
      if (result) {
        this.stats.success++;
        // 注册成功后，在 accounts.txt 中注释掉该行，防止下次重复注册
        this.markAccountDone(acc);
      } else {
        this.stats.fail++;
      }
      // 账号间随机延迟（防频率检测）
      if (i < accounts.length - 1 && !this.shouldStop) {
        const waitMs = this.options.delayBetweenAccounts;
        info('引擎', '等待 ' + waitMs + 'ms 后处理下一个账号...');
        await this.delay(waitMs);
      }

      // 🛡️ 智能分段：每3个账号暂停20-40秒（参照 batch_reregister.js）
      if ((i + 1) % 3 === 0 && i < accounts.length - 1) {
        const pauseMs = Math.floor(Math.random() * 21000) + 20000;
        console.log('');
        info('🛡️ 智能暂停', `已完成 ${i + 1}/${accounts.length} 个，休息 ${(pauseMs / 1000).toFixed(0)} 秒防检测...`);
        console.log('');
        // 分段暂停使用逐秒计数，避免整段 sleep 被中断
        for (let s = 0; s < pauseMs / 1000 && !this.shouldStop; s++) {
          await sleep(1000);
        }
      }
    }

    info('引擎', '========================================');
    info('引擎', '批量注册完成!');
    info('引擎', '成功: ' + this.stats.success + ', 失败: ' + this.stats.fail);
    info('引擎', '========================================');
  }
}

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
// 结果持久化
// ============================================================
function saveResult(result) {
  const batchIdx = process.env.BATCH_INDEX || '1';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = 'result_' + batchIdx + '_' + ts + '.json';
  try {
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf-8');
    info('引擎', '结果已保存: ' + filename);
  } catch (e) {
    warn('引擎', '保存结果失败: ' + e.message);
  }
}

// ============================================================
// 交互式控制台
// ============================================================
function ask(question) {
  if (IS_CI) {
    // CI 模式下不进行交互
    return Promise.resolve('');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   艾德尔修仙传 - 批量注册自动化工具 v2.1 🛡️    ║');
  console.log('║   功能: 注册 → 创角(金灵根100) → 绑定邀请码   ║');
  console.log('║        → 全技能 → 铁剑 → 吐纳 → 荒石村→战斗  ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║   🛡️ 反封号: 独立IP+机器码+浏览器指纹+随机延迟 ║');
  console.log('║   🛡️         智能分段暂停（每3个休息20-40秒）  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

function showHelp() {
  console.log('');
  console.log('账号文件格式 (每行一个账号):');
  console.log('  账号名,密码,邀请码(可选)');
  console.log('  例如: test001,123456,INVITE001');
  console.log('  例如: test002,abc123,');
  console.log('  以 # 或 // 开头的行将被忽略');
  console.log('');
}

async function main() {
  showBanner();

  // ============================================================
  // CI 模式：直接从环境变量读取配置，无交互
  // ============================================================
  if (IS_CI) {
    console.log('═══════════════════════════════════════════════');
    console.log('  检测到 CI 环境，自动使用环境变量配置');
    console.log('═══════════════════════════════════════════════');

    let filepath = './accounts.txt';

    // 支持从环境变量 ACCOUNTS_DATA 写入账号文件
    if (process.env.ACCOUNTS_DATA) {
      console.log('  从环境变量 ACCOUNTS_DATA 加载账号');
      fs.writeFileSync(filepath, process.env.ACCOUNTS_DATA, 'utf-8');
    }

    const accounts = loadAccounts(filepath);

    if (accounts.length === 0) {
      console.error('❌ CI 模式下未找到有效账号！请提供 accounts.txt 或设置 ACCOUNTS_DATA 环境变量');
      process.exit(1);
    }

    // 从环境变量读取配置
    const mapId = getEnvInt('MAP_ID', 1);
    const techniqueId = getEnvInt('TECHNIQUE_ID', 1);
    const autoBattle = getEnvBool('AUTO_BATTLE', true);
    const autoRestart = getEnvBool('AUTO_RESTART', true);
    const delay = getEnvInt('DELAY_MS', 3000);

    console.log('  加载账号: ' + accounts.length + ' 个');
    console.log('  地图ID: ' + mapId + ' (荒石村)');
    console.log('  功法ID: ' + techniqueId + ' (吐纳法)');
    console.log('  自动战斗: ' + autoBattle);
    console.log('  自动刷怪: ' + autoRestart);
    console.log('  账号间隔: ' + delay + 'ms');
    console.log('═══════════════════════════════════════════════');

    const engine = new BatchEngine(accounts, {
      mapId,
      techniqueId,
      autoBattle,
      autoRestart,
      delayBetweenAccounts: delay,
      accountFilePath: filepath
    });

    // CI 中捕获 SIGTERM（GitHub Actions 超时时会发）
    process.on('SIGTERM', () => {
      console.log('\n收到 SIGTERM 信号，正在停止...');
      engine.stop();
    });

    await engine.run();

    // 保存运行结果
    saveResult({
      timestamp: new Date().toISOString(),
      stats: engine.stats,
      total: accounts.length,
      accounts: accounts.map(a => ({
        username: a.username,
        inviteCode: a.inviteCode,
        accountId: a.accountId,
        playerName: a.playerName
      }))
    });

    // CI 模式下：git commit & push 已更新的 accounts.txt 到仓库
    if (engine.stats.success > 0) {
      console.log('');
      console.log('📤 正在提交已完成的账号记录到仓库...');
      try {
        const execSync = require('child_process').execSync;

        execSync('git config user.name "github-actions[bot]"', { stdio: 'pipe' });
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'pipe' });

        execSync('git add "' + filepath + '"', { stdio: 'pipe' });

        const status = execSync('git status --porcelain', { stdio: 'pipe', encoding: 'utf-8' }).toString().trim();
        if (status) {
          execSync('git commit -m "chore: 标记已完成注册的账号 #开头的行 [skip ci]"', { stdio: 'pipe' });
          execSync('git push', { stdio: 'pipe' });
          info('推送', '✅ accounts.txt 已更新并推送到远程仓库');
        } else {
          info('推送', 'accounts.txt 无变更，跳过提交');
        }
      } catch (e) {
        warn('推送', 'git 推送失败（非致命）: ' + e.message);
      }
    }

    // CI 模式下直接退出，不等待按键
    console.log('');
    console.log('CI 模式运行结束，退出码: ' + (engine.stats.fail > 0 ? '1（有失败）' : '0（全部成功）'));
    process.exit(engine.stats.fail > 0 ? 1 : 0);
  }

  // ============================================================
  // 普通交互模式
  // ============================================================
  let filepath = './accounts.txt';
  const examplePath = './accounts_example.txt';
  if (!fs.existsSync(filepath) && fs.existsSync(examplePath)) {
    filepath = examplePath;
  }

  let accounts = [];
  if (fs.existsSync(filepath)) {
    console.log('自动加载账号文件: ' + filepath);
    accounts = loadAccounts(filepath);
  }

  if (accounts.length === 0) {
    console.log('');
    console.log('未找到有效账号文件，请创建 accounts.txt');
    console.log('');
    showHelp();
    const createNew = await ask('是否输入账号? (y/N): ');
    if (createNew.toLowerCase() === 'y' || createNew.toLowerCase() === 'yes') {
      console.log('请输入账号(每行一个, 格式: 账号,密码,邀请码, 空行结束):');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const lines = [];
      await new Promise(resolve => {
        rl.on('line', line => {
          if (line.trim() === '') { rl.close(); resolve(); }
          else lines.push(line.trim());
        });
      });
      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          accounts.push(new Account(parts[0], parts[1], parts[2] || ''));
        }
      }
    }
  }

  if (accounts.length === 0) {
    console.log('没有账号，程序退出。请先创建 accounts.txt 文件。');
    console.log('格式: 每行 username,password,invite_code');
    process.exit(0);
  }

  console.log('当前 ' + accounts.length + ' 个账号:');
  for (const acc of accounts) {
    console.log('  [' + acc.username + '] ' + (acc.inviteCode ? '邀请码:' + acc.inviteCode : '无邀请码'));
  }

  console.log('');
  console.log('配置选项 (直接回车使用默认值):');
  
  let mapId = await ask('地图ID [1=荒石村]: ');
  mapId = parseInt(mapId) || 1;

  let techniqueId = await ask('功法ID [1=吐纳法]: ');
  techniqueId = parseInt(techniqueId) || 1;

  let autoBattle = await ask('自动战斗 [Y/n]: ');
  autoBattle = autoBattle.toLowerCase() !== 'n';

  let autoRestart = await ask('自动刷怪 [Y/n]: ');
  autoRestart = autoRestart.toLowerCase() !== 'n';

  let delay = await ask('账号间隔(ms) [3000]: ');
  delay = parseInt(delay) || 3000;

  console.log('');
  console.log('确认配置:');
  console.log('  地图: 荒石村(id=' + mapId + ')');
  console.log('  功法: 吐纳法(id=' + techniqueId + ')');
  console.log('  自动战斗: ' + autoBattle);
  console.log('  自动刷怪: ' + autoRestart);
  console.log('  账号间隔: ' + delay + 'ms');
  console.log('');

  const confirm = await ask('是否开始批量操作? (Y/n): ');
  if (confirm.toLowerCase() === 'n' || confirm.toLowerCase() === 'no') {
    console.log('已取消');
    process.exit(0);
  }

  const engine = new BatchEngine(accounts, {
    mapId,
    techniqueId,
    autoBattle,
    autoRestart,
    delayBetweenAccounts: delay,
    accountFilePath: filepath
  });

  // 捕获 Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n收到中断信号，正在停止...');
    engine.stop();
  });

  await engine.run();

  // 保存运行结果
  saveResult({
    timestamp: new Date().toISOString(),
    stats: engine.stats,
    total: accounts.length,
    accounts: accounts.map(a => ({
      username: a.username,
      inviteCode: a.inviteCode,
      accountId: a.accountId,
      playerName: a.playerName
    }))
  });

  console.log('');
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl2.question('按回车键退出...', () => { rl2.close(); });
}

// ============================================================
// 启动（CI 模式下不显示启动画面 banner）
// ============================================================
main().catch(e => {
  console.error('程序异常:', e.message);
  console.error(e.stack);
  process.exit(1);
});
