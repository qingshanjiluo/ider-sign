/**
 * duel_common.js - 斗法系统公共模块
 * 
 * 包含：动作定义、游戏数据加载、工具函数、模型加载
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 路径配置
// ============================================================
const MODEL_DIR = path.join(__dirname, 'models');
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================
// 动作定义（35个动作，与 game_environment.js 一致）
// ============================================================
const ACTIONS = [
  // 战斗 (0-6)
  { id: 0,  name: '普通攻击',      category: 'combat' },
  { id: 1,  name: '技能1',         category: 'combat' },
  { id: 2,  name: '技能2',         category: 'combat' },
  { id: 3,  name: '技能3',         category: 'combat' },
  { id: 4,  name: '治疗',          category: 'combat' },
  { id: 5,  name: '使用HP药水',    category: 'item' },
  { id: 6,  name: '使用MP药水',    category: 'item' },
  // 探索 (7)
  { id: 7,  name: '切换地图',      category: 'explore' },
  // 成长 (8-9)
  { id: 8,  name: '升级',          category: 'growth' },
  { id: 9,  name: '突破',          category: 'growth' },
  // 装备 (10-11)
  { id: 10, name: '装备武器',      category: 'equip' },
  { id: 11, name: '装备防具',      category: 'equip' },
  // 资源 (12-14)
  { id: 12, name: '领取邮件',      category: 'resource' },
  { id: 13, name: '同步',          category: 'resource' },
  { id: 14, name: '自动战斗开关',  category: 'utility' },
  // 制造 (15-18)
  { id: 15, name: '炼丹',          category: 'craft' },
  { id: 16, name: '锻造',          category: 'craft' },
  { id: 17, name: '锻造升级',      category: 'craft' },
  { id: 18, name: '锻造重铸',      category: 'craft' },
  // 洞府 (19-21)
  { id: 19, name: '洞府采集',      category: 'cave' },
  { id: 20, name: '洞府升级',      category: 'cave' },
  { id: 21, name: '洞府阵法',      category: 'cave' },
  // 弟子 (22-24)
  { id: 22, name: '招募弟子',      category: 'disciple' },
  { id: 23, name: '派遣弟子',      category: 'disciple' },
  { id: 24, name: '召回弟子',      category: 'disciple' },
  // 宗门 (25-27)
  { id: 25, name: '宗门贡献',      category: 'sect' },
  { id: 26, name: '宗门学习',      category: 'sect' },
  { id: 27, name: '宗门任务',      category: 'sect' },
  // 联盟 (28-31)
  { id: 28, name: '联盟祈福',      category: 'alliance' },
  { id: 29, name: '联盟沐浴',      category: 'alliance' },
  { id: 30, name: '联盟药园',      category: 'alliance' },
  { id: 31, name: '联盟冥想',      category: 'alliance' },
  // 副本 (32-33)
  { id: 32, name: '副本挑战',      category: 'dungeon' },
  { id: 33, name: '试炼',          category: 'dungeon' },
  // 交易 (34)
  { id: 34, name: '交易所',        category: 'trade' },
];

// ============================================================
// 加载游戏数据
// ============================================================
function loadSkillsData() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'skills.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[duel] 无法加载 skills.json，使用空数据:', e.message);
    return [];
  }
}

function loadItemsData() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[duel] 无法加载 items.json，使用空数据:', e.message);
    return [];
  }
}

function loadMapsData() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'maps.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[duel] 无法加载 maps.json，使用空数据:', e.message);
    return [];
  }
}

function loadTechniquesData() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'techniques.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[duel] 无法加载 techniques.json，使用空数据:', e.message);
    return [];
  }
}

const SKILLS_DATA = loadSkillsData();
const ITEMS_DATA = loadItemsData();
const MAPS_DATA = loadMapsData();
const TECHNIQUES_DATA = loadTechniquesData();

// 获取地图名称
function getMapName(mapId) {
  const map = MAPS_DATA.find(m => m.id === mapId);
  return map ? map.name : `未知地图(${mapId})`;
}

// 获取地图详情
function getMapInfo(mapId) {
  const map = MAPS_DATA.find(m => m.id === mapId);
  return map || { id: mapId, name: '未知', level: 1, description: '', enemies: [] };
}

// NPC在线状态模拟
const NPC_ONLINE_STATUS = new Map();
function initNPCOnlineStatus() {
  const npcNames = [
    '散修·剑无极', '散修·剑无心', '散修·刀霸天', '散修·刀无痕',
    '散修·拳镇山', '散修·拳破天', '散修·法无量', '散修·法通天',
    '散修·药无尘', '散修·药无垢', '云游·风清扬', '云游·月影',
    '隐士·苍松', '隐士·寒梅', '侠客·凌云', '侠客·飞雪',
    '魔修·血煞', '魔修·幽魂', '道修·玄真', '道修·明心'
  ];
  npcNames.forEach((name, i) => {
    NPC_ONLINE_STATUS.set(name, {
      online: Math.random() > 0.3, // 70% 在线
      lastActive: Date.now() - Math.floor(Math.random() * 3600000),
      mapId: Math.floor(Math.random() * 16) + 1,
      power: Math.floor(Math.random() * 5000) + 500,
      level: Math.floor(Math.random() * 200) + 10,
    });
  });
}
initNPCOnlineStatus();

// 获取NPC在线状态
function getNPCOnlineStatus(name) {
  if (!name) return { online: false, mapId: 0, power: 0, level: 0 };
  if (!NPC_ONLINE_STATUS.has(name)) {
    NPC_ONLINE_STATUS.set(name, {
      online: Math.random() > 0.3,
      lastActive: Date.now(),
      mapId: Math.floor(Math.random() * 16) + 1,
      power: Math.floor(Math.random() * 5000) + 500,
      level: Math.floor(Math.random() * 200) + 10,
    });
  }
  const status = NPC_ONLINE_STATUS.get(name);
  // 随机刷新在线状态
  if (Math.random() < 0.1) {
    status.online = !status.online;
  }
  return status;
}

// 获取所有在线NPC列表
function getOnlineNPCs() {
  const online = [];
  for (const [name, status] of NPC_ONLINE_STATUS) {
    if (status.online) {
      online.push({ name, ...status });
    }
  }
  return online;
}

// ============================================================
// 工具函数
// ============================================================
function formatNumber(n, decimals = 4) {
  if (typeof n !== 'number') return '0';
  return n.toFixed(decimals);
}

function getModelFiles() {
  if (!fs.existsSync(MODEL_DIR)) return [];
  return fs.readdirSync(MODEL_DIR)
    .filter(f => f.endsWith('_model.json'))
    .map(f => {
      const match = f.match(/bot_(\d+)_model\.json/);
      return match ? { file: f, botIndex: parseInt(match[1]), path: path.join(MODEL_DIR, f) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.botIndex - b.botIndex);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================
// 加载模型用于斗法
// ============================================================
function loadModelForDuel(botIndex) {
  const modelPath = path.join(MODEL_DIR, `bot_${botIndex}_model.json`);
  if (!fs.existsSync(modelPath)) {
    console.error(`[duel] 模型文件不存在: ${modelPath}`);
    return null;
  }

  try {
    const { DQNAgent } = require('./dqn_agent.js');
    const agent = new DQNAgent(50, 35);
    agent.loadModel(modelPath);
    return agent;
  } catch (e) {
    console.error(`[duel] 加载模型 bot_${botIndex} 失败:`, e.message);
    return null;
  }
}

module.exports = {
  MODEL_DIR,
  DATA_DIR,
  ACTIONS,
  SKILLS_DATA,
  ITEMS_DATA,
  MAPS_DATA,
  TECHNIQUES_DATA,
  formatNumber,
  getModelFiles,
  randomInt,
  pickRandom,
  clamp,
  loadModelForDuel,
  getMapName,
  getMapInfo,
  getNPCOnlineStatus,
  getOnlineNPCs,
};
