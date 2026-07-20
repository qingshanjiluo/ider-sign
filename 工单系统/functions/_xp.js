// _xp.js - 经验值/等级系统 + 邀请倍率/套餐 + 等级称号
const XP_LEVELS = [0, 0, 100, 300, 700, 1500, 3100, 6300, 12700, 25500, 51100];

// ─── Level Titles ─────────────────────────
const LEVEL_TITLES = ['', '仙友', '仙长', '仙师', '宗师', '大宗师', '仙王', '尊者', '道主', '至尊', '仙尊'];

function getLevelTitle(level) {
  return LEVEL_TITLES[level] || '仙友';
}

// ─── Invite Boost Tiers ──────────────────
const INVITE_BOOST_TIERS = [
  { min: 0,      max: 4999,   mult: 1.0, label: '基础',   rate: 30 },
  { min: 5000,   max: 19999,  mult: 1.2, label: '青铜',   rate: 36 },
  { min: 20000,  max: 49999,  mult: 1.5, label: '白银',   rate: 45 },
  { min: 50000,  max: 99999,  mult: 2.0, label: '黄金',   rate: 60 },
  { min: 100000, max: Infinity, mult: 3.0, label: '至尊',  rate: 90 },
];

// ─── Invite / Recharge Packages ─────────
// 现金充值套餐 — 微信支付兑换修仙币
const CASH_PACKAGES = [
  { id: 'cash-5',   name: '初入仙途', coins: 2500,  price: 5,   currency: 'cash', desc: '兑换2500修仙币' },
  { id: 'cash-10',  name: '小有所成', coins: 5200,  price: 10,  currency: 'cash', desc: '兑换5200修仙币' },
  { id: 'cash-15',  name: '渐入佳境', coins: 8000,  price: 15,  currency: 'cash', desc: '兑换8000修仙币' },
  { id: 'cash-20',  name: '炉火纯青', coins: 12000, price: 20,  currency: 'cash', desc: '兑换12000修仙币' },
  { id: 'cash-30',  name: '登堂入室', coins: 18000, price: 30,  currency: 'cash', desc: '兑换18000修仙币' },
  { id: 'cash-50',  name: '一代宗师', coins: 25000, price: 50,  currency: 'cash', desc: '兑换25000修仙币' },
];

// 灵石充值套餐 — 灵石兑换修仙币（100万灵石=10修仙币）
const SPIRIT_STONE_PACKAGES = [
  { id: 'stone-500w',   name: '灵石入门', coins: 70,   price: 5000000,    currency: 'spirit_stone', desc: '500万灵石 → 70修仙币' },
  { id: 'stone-1000w',  name: '灵石小成', coins: 150,  price: 10000000,   currency: 'spirit_stone', desc: '1000万灵石 → 150修仙币' },
  { id: 'stone-3000w',  name: '灵石大成', coins: 400,  price: 30000000,   currency: 'spirit_stone', desc: '3000万灵石 → 400修仙币' },
  { id: 'stone-5000w',  name: '灵石巅峰', coins: 700,  price: 50000000,   currency: 'spirit_stone', desc: '5000万灵石 → 700修仙币' },
  { id: 'stone-1y',     name: '灵石至尊', coins: 1500, price: 100000000,  currency: 'spirit_stone', desc: '1亿灵石 → 1500修仙币' },
];

// 基础充值配置（非套餐）
const BASE_RECHARGE = {
  cash:   { rate: 400, unit: '元', min: 1, desc: '1元 = 400修仙币' },
  spirit_stone: { rate: 0.01, unit: '万灵石', min: 100, desc: '100万灵石 = 10修仙币' },
};

// 合并全部套餐（向后兼容）
const INVITE_PACKAGES = [...CASH_PACKAGES, ...SPIRIT_STONE_PACKAGES];

function getInviteBoost(totalPurchased) {
  const tier = INVITE_BOOST_TIERS.find(t => totalPurchased >= t.min && totalPurchased < t.max) || INVITE_BOOST_TIERS[0];
  return tier;
}

export async function recalcUserLevel(env, userId) {
  const user = await env.DB.prepare('SELECT id, xp FROM users WHERE id = ?').bind(userId).first();
  if (!user) return;
  let level = 1;
  for (let i = XP_LEVELS.length - 1; i >= 1; i--) {
    if (user.xp >= XP_LEVELS[i]) { level = i; break; }
  }
  await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(level, userId).run();
}

export async function addXP(env, userId, amount, reason) {
  await env.DB.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, userId).run();
  await recalcUserLevel(env, userId);
  const title = '经验值 +' + amount;
  const content = reason + '，获得 ' + amount + ' 经验值';
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)'
  ).bind(userId, title, content, 'xp').run();
}

export { XP_LEVELS, LEVEL_TITLES, getLevelTitle, INVITE_BOOST_TIERS, INVITE_PACKAGES, CASH_PACKAGES, SPIRIT_STONE_PACKAGES, BASE_RECHARGE, getInviteBoost };
