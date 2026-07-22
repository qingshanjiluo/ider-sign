/**
 * ⚠️ 本 Worker 已废弃，请使用 Pages Functions (functions/) 替代
 *
 * 此文件保留仅用于兼容旧部署，所有新路由应在 functions/api/ 下创建
 * 请参考 wrangler.pages.toml 使用 Pages 方式部署
 *
 * 待迁移路线图:
 * - functions/api/auth/forgot-password.js   ✅ 已创建 (使用 D1 存储)
 * - functions/api/auth/reset-password.js    ✅ 已创建 (使用 D1 存储)
 * - worker/static.js → pages-frontend/      进行中
 */

import { renderStaticAsset } from './static';

const ALLOWED_ORIGIN = (typeof CORS_ORIGIN !== 'undefined' && CORS_ORIGIN) || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
  'Vary': 'Origin',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html;charset=utf-8' },
  });
}

// ── 密码哈希（PBKDF2，兼容旧 SHA-256） ──────────────

function isLegacyHash(hash) {
  return /^[a-f0-9]{64}$/.test(hash);
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// PBKDF2 哈希密码（输出格式: pbkdf2:iterations:salt_b64:hash_b64）
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = uint8ArrayToBase64(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const iterations = 100000;
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const hashB64 = uint8ArrayToBase64(new Uint8Array(hash));
  return `pbkdf2:${iterations}:${saltB64}:${hashB64}`;
}

// 验证密码（兼容旧 SHA-256 和新 PBKDF2 格式）
async function verifyPassword(pw, storedHash) {
  if (!storedHash) return false;

  // 旧格式 SHA-256
  if (isLegacyHash(storedHash)) {
    const encoder = new TextEncoder();
    const data = encoder.encode('ider:' + pw + ':order-system');
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hexHash = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return constantTimeEqual(hexHash, storedHash);
  }

  // 新格式 PBKDF2
  const parts = storedHash.split(':');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const salt = base64ToUint8Array(parts[2]);
  const expectedHashB64 = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const hashB64 = uint8ArrayToBase64(new Uint8Array(hash));
  return constantTimeEqual(hashB64, expectedHashB64);
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const result = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!result) return null;
  if (new Date(result.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const user = await env.DB.prepare(
    'SELECT id, username, display_name, level, xp, total_orders, total_spent, invite_code, invited_by, invite_points, total_invited, total_purchased_points, commission_rate, email, avatar_url, bio, is_admin, locked FROM users WHERE id = ?'
  ).bind(result.user_id).first();
  return user;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function authenticateApi(request, env) {
  const key = request.headers.get('X-API-Key') || '';
  return constantTimeEqual(key, env.API_KEY || '');
}

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

// ─── Activity Log Helper ──────────────────────
async function logActivity(env, orderId, userId, action, detail) {
  await env.DB.prepare(
    "INSERT INTO order_activities (order_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).bind(orderId, userId, action, detail || '').run();
}

// ─── Simple Rate Limiter (in-memory) ──────────
const rateLimitMap = new Map();
let lastCleanup = Date.now();
const RATE_LIMIT_MAX_ENTRIES = 10000; // Max entries to prevent memory bloat
const RATE_LIMIT_CLEANUP_INTERVAL = 30000; // Cleanup every 30s
const RATE_LIMIT_ENTRY_TTL = 60000; // Entry TTL: 60s (matching typical window)

function cleanupRateLimit() {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL) return;
  lastCleanup = now;
  // If map is too large, clear all expired entries immediately
  if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    rateLimitMap.clear();
    return;
  }
  for (const [k, v] of rateLimitMap) {
    if (now - v.reset > RATE_LIMIT_ENTRY_TTL) rateLimitMap.delete(k);
  }
}

function checkRateLimit(ip, key, max = 30, windowSec = 60) {
  cleanupRateLimit();
  const k = ip + ':' + key;
  const entry = rateLimitMap.get(k);
  const now = Date.now();
  if (!entry || now - entry.reset > windowSec * 1000) {
    // Prevent unbounded growth even between cleanups
    if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) rateLimitMap.clear();
    rateLimitMap.set(k, { count: 1, reset: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

// ─── XP/Level System (exponential) ────────
// Formula: XP_LEVELS[i] = 100 * (2^(i-1) - 1), i ≥ 1
const XP_LEVELS = [0, 0, 100, 300, 700, 1500, 3100, 6300, 12700, 25500, 51100];

// ─── Invite Boost Tiers ──────────────────
// total_purchased_points → commission multiplier
const INVITE_BOOST_TIERS = [
  { min: 0,      max: 4999,   mult: 1.0, label: '基础',   rate: 30 },
  { min: 5000,   max: 19999,  mult: 1.2, label: '青铜',   rate: 36 },
  { min: 20000,  max: 49999,  mult: 1.5, label: '白银',   rate: 45 },
  { min: 50000,  max: 99999,  mult: 2.0, label: '黄金',   rate: 60 },
  { min: 100000, max: Infinity, mult: 3.0, label: '至尊',  rate: 90 },
];

// ─── Invite Packages for Purchase ────────
const INVITE_PACKAGES = [
  { id: 'bronze',  name: '小试牛刀', points: 6000,   price: 50,   desc: '解锁青铜倍率(1.2x)' },
  { id: 'silver',  name: '渐入佳境', points: 12000,  price: 100,  desc: '解锁白银倍率(1.5x)' },
  { id: 'gold',    name: '如虎添翼', points: 30000,  price: 250,  desc: '解锁黄金倍率(2.0x)' },
  { id: 'diamond', name: '登峰造极', points: 60000,  price: 500,  desc: '解锁至尊倍率(3.0x)' },
  { id: 'legend',  name: '至尊无敌', points: 120000, price: 1000, desc: '满级倍率(3.0x)+专属标识' },
];

function getInviteBoost(totalPurchased) {
  const tier = INVITE_BOOST_TIERS.find(t => totalPurchased >= t.min && totalPurchased < t.max) || INVITE_BOOST_TIERS[0];
  return tier;
}

async function recalcUserLevelAndXP(env, userId) {
  const user = await env.DB.prepare('SELECT id, xp FROM users WHERE id = ?').bind(userId).first();
  if (!user) return;
  let level = 1;
  for (let i = XP_LEVELS.length - 1; i >= 1; i--) {
    if (user.xp >= XP_LEVELS[i]) { level = i; break; }
  }
  await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(level, userId).run();
}

async function addXP(env, userId, amount, reason) {
  await env.DB.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, userId).run();
  await recalcUserLevelAndXP(env, userId);
  const title = '经验值 +' + amount;
  const content = reason + '，获得 ' + amount + ' 经验值';
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, ?)'
  ).bind(userId, title, content, 'xp').run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 🚀 重定向到 Pages 新前端（瑞典极简风格）
    // 保留 API 路径在 Worker 中作为备选
    const PAGES_URL = 'https://ider-order-system.pages.dev';

    // 非 API 请求 → 直接重定向到 Pages
    if (!path.startsWith('/api/')) {
      const dest = PAGES_URL + path + (url.search || '');
      return Response.redirect(dest, 301);
    }

    // API 请求走旧 Worker 逻辑（备用）
    const method = request.method;
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const ip = getClientIP(request);
    const isAuthRoute = path.includes('/auth/');
    if (!checkRateLimit(ip, path.split('/')[3] || 'api', isAuthRoute ? 10 : 60)) {
      return json({ error: '请求过于频繁，请稍后再试' }, 429);
    }

    try {
      return await handleRoute(method, path, request, env, url);
    } catch (e) {
      console.error('Route error:', path, e.message);
      return json({ error: e.message || '服务器内部错误' }, 500);
    }
  },
};

function getContentType(path) {
  if (path.endsWith('.css')) return 'text/css;charset=utf-8';
  if (path.endsWith('.js')) return 'application/javascript;charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain';
}

async function handleRoute(method, path, request, env, url) {
  // ╔════════════════════════════════════════════════════╗
  // ║  ⚠️ 废弃通知 — 此 Worker 路由已全部被迁移          ║
  // ║  请使用 Pages Functions: functions/api/**/*.js    ║
  // ║  旧路径                    →  新路径                ║
  // ║  api/auth/register         →  api/auth/register    ║
  // ║  api/auth/login            →  api/auth/login       ║
  // ║  api/user/info             →  api/user/info        ║
  // ║  api/user/change-password  →  api/user/change-pwd  ║
  // ║  api/user/profile          →  api/user/profile     ║
  // ║  api/user/:id/public       →  api/user/:id/public  ║
  // ║  api/orders                →  api/orders           ║
  // ║  api/orders/:id            →  api/orders/:id       ║
  // ║  api/orders/:id/activities →  api/orders/:id/actvt ║
  // ║  api/accounts              →  api/accounts         ║
  // ║  api/accounts/:id          →  api/accounts/:id     ║
  // ║  api/accounts/:id/logs     →  api/accounts/:id/logs║
  // ║  api/notifications         →  api/notifications    ║
  // ║  api/notifications/read    →  api/notifications/rd ║
  // ║  api/appeals               →  api/appeals          ║
  // ║  api/after-sales           →  api/after-sales      ║
  // ║  api/invite/*              →  api/invite/*         ║
  // ║  api/bot/ask               →  api/bot/ask          ║
  // ║  api/coupon/validate       →  api/coupon/validate  ║
  // ║  api/redeem                →  api/redeem           ║
  // ║  api/config                →  api/config           ║
  // ║  api/stats                 →  api/stats            ║
  // ║  api/leaderboard/*         →  api/leaderboard/*    ║
  // ║  api/announcements/active  →  api/anouncements/act ║
  // ║  api/ads/active            →  api/ads/active       ║
  // ║  api/public/config         →  api/public/config    ║
  // ║  api/admin/*               →  api/admin/*          ║
  // ║  api/gh/*                  →  api/gh/*             ║
  // ╚════════════════════════════════════════════════════╝

  let body = {};
  if (!['GET', 'HEAD'].includes(method)) {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  // ── Auth ──────────────────────────────────────────
  if (path === '/api/auth/register' && method === 'POST') {
    const { username, password, email, invite_code } = body;
    if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
    if (username.length < 3 || username.length > 20) return json({ error: '用户名3-20字符' }, 400);
    if (password.length < 6) return json({ error: '密码至少6位' }, 400);

    const ip = getClientIP(request);
    const ipCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE ip_address = ?'
    ).bind(ip).first();
    if (ipCount.cnt > 0) return json({ error: '该IP已注册过账号，每IP仅限一个账号' }, 403);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) return json({ error: '用户名已存在' }, 409);

    const hash = await hashPassword(password);
    const myInviteCode = 'IDR' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

    let inviterId = 0;
    if (invite_code) {
      const inviter = await env.DB.prepare('SELECT id FROM users WHERE invite_code = ?').bind(invite_code).first();
      if (inviter) inviterId = inviter.id;
    }

    await env.DB.prepare(
      'INSERT INTO users (username, password_hash, email, invite_code, invited_by, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(username, hash, email || '', myInviteCode, inviterId, ip).run();

    // Give inviter XP
    if (inviterId > 0) {
      await env.DB.prepare('UPDATE users SET total_invited = total_invited + 1 WHERE id = ?').bind(inviterId).run();
      await addXP(env, inviterId, 50, '成功邀请用户 ' + username);
    }

    return json({ ok: true, message: '注册成功' });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const { username, password } = body;
    if (!username || !password) return json({ error: '参数不全' }, 400);
    const user = await env.DB.prepare(
      'SELECT id, username, password_hash, level, locked, is_admin FROM users WHERE username = ?'
    ).bind(username).first();
    if (!user) return json({ error: '用户不存在' }, 404);
    if (user.locked) return json({ error: '账号已锁定' }, 403);

    // 验证密码（兼容旧 SHA-256 和新 PBKDF2）
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return json({ error: '密码错误' }, 401);

    // 自动升级旧 SHA-256 哈希到新 PBKDF2
    if (isLegacyHash(user.password_hash)) {
      const newHash = await hashPassword(password);
      await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(newHash, user.id).run();
    }

    const token = generateToken();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expires).run();
    await env.DB.prepare(
      "UPDATE users SET last_login = datetime('now') WHERE id = ?"
    ).bind(user.id).run();

    return json({ ok: true, token, user: { id: user.id, username: user.username, level: user.level, is_admin: user.is_admin } });
  }

  // ── User Info ─────────────────────────────────────
  if (path === '/api/user/info' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    const nextXP = XP_LEVELS[Math.min(user.level + 1, XP_LEVELS.length - 1)] || 0;
    return json({ ok: true, user: { ...user, total_invited: totalInvited.cnt, xp_next: nextXP, password_hash: undefined } });
  }

  // ── Orders ────────────────────────────────────────
  if (path === '/api/orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT o.*, (SELECT COUNT(*) FROM game_accounts WHERE order_id = o.id) as account_count FROM orders o WHERE o.user_id = ?';
    const params = [user.id];
    if (status) { query += ' AND o.status = ?'; params.push(status); }
    query += ' ORDER BY o.created_at DESC';
    const orders = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, orders: orders.results });
  }

  if (path === '/api/orders' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);

    const {
      order_type,
      coupon_code,
      note,
      invite_code,
      payment_method,   // 'coin' | 'wechat' | 'spirit_stone'
      points            // 邀请积分数量（10的倍数）
    } = body;

    // ── 1. 验证积分数量 ──
    if (!points || points < 10 || points % 10 !== 0) {
      return json({ error: '邀请积分数量必须是10的倍数（最少10）' }, 400);
    }

    // ── 2. 验证付款方式 ──
    const validMethods = ['coin', 'wechat', 'spirit_stone'];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return json({ error: '请选择有效的付款方式' }, 400);
    }

    // ── 3. 根据付款方式计算价格 ──
    let price = 0;
    let priceUnit = '';
    let bonusPoints = points;

    if (payment_method === 'wechat') {
      // 现金：1元 = 120积分
      price = points / 120;
      priceUnit = '元';
    } else if (payment_method === 'spirit_stone') {
      // 灵石：从 config 读取灵石兑换比例（默认 100万灵石 = 10积分）
      const spiritCfg = await env.DB.prepare("SELECT value FROM config WHERE key='spirit_stone_per_10_points'").first();
      const spiritPer10 = parseInt(spiritCfg?.value || '1000000');
      price = Math.round(points / 10 * spiritPer10 / 10000);
      priceUnit = '万灵石';
    } else if (payment_method === 'coin') {
      // 修仙币：1修仙币 = 1积分
      price = points;
      priceUnit = '修仙币';
    }

    // ── 4. 修仙币支付：验证余额并冻结 ──
    let frozenPoints = 0;
    if (payment_method === 'coin') {
      const userInfo = await env.DB.prepare('SELECT bonus_points FROM users WHERE id = ?').bind(user.id).first();
      const currentBalance = userInfo?.bonus_points || 0;
      if (currentBalance < points) {
        return json({
          error: `修仙币余额不足，当前余额: ${currentBalance}，需要: ${points}`
        }, 400);
      }
      // 冻结积分：从余额中扣除
      await env.DB.prepare(
        'UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?'
      ).bind(points, user.id).run();
      frozenPoints = points;
    }

    // ── 5. 优惠码折扣 ──
    let discount = 0;
    let couponType = 'percent';
    let couponFixedAmount = 0;
    if (coupon_code) {
      const coupon = await env.DB.prepare(
        "SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now')) AND (max_uses = 0 OR used_count < max_uses)"
      ).bind(coupon_code).first();
      if (coupon) {
        couponType = coupon.coupon_type || 'percent';
        if (couponType === 'fixed') {
          couponFixedAmount = coupon.fixed_amount || 0;
        } else {
          discount = coupon.discount_percent || 0;
        }
        await env.DB.prepare(
          'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?'
        ).bind(coupon.id).run();
      }
    }

    // ── 6. 等级折扣 ──
    const userLevel = user.level || 1;
    const levelDiscounts = { 1: 0, 2: 0, 3: 10, 4: 20, 5: 30, 6: 40, 7: 45, 8: 50, 9: 60, 10: 70 };
    const levelDiscount = levelDiscounts[userLevel] || 0;

    // ── 7. 计算最终价格（取最大折扣） ──
    let finalPrice = price;
    if (couponType === 'fixed') {
      // 固定金额减免
      finalPrice = Math.max(0, price - couponFixedAmount);
      const levelPrice = price * (100 - levelDiscount) / 100;
      finalPrice = Math.min(finalPrice, levelPrice);
      discount = levelDiscount;
    } else {
      // 百分比折扣，取最大值
      const maxDiscount = Math.max(discount, levelDiscount);
      finalPrice = price * (100 - maxDiscount) / 100;
      discount = maxDiscount;
    }

    // ── 8. 计算账号数 ──
    const accCount = Math.max(1, Math.ceil(bonusPoints / 10));

    // ── 9. 预估完成日期 ──
    const estDays = parseInt((await env.DB.prepare("SELECT value FROM config WHERE key='est_delivery_days'").first())?.value || '5');
    const estDate = new Date(Date.now() + estDays * 86400000).toISOString().split('T')[0];

    // ── 10. 插入订单 ──
    const finalInviteCode = invite_code || user.invite_code || '';
    const result = await env.DB.prepare(
      `INSERT INTO orders (user_id, invite_code, payment_method, amount, price, coupon_code, discount, bonus_points, order_type, quantity, frozen_points, invite_code_used, status, created_at, est_complete_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?)`
    ).bind(
      user.id,
      finalInviteCode,
      payment_method,
      points,
      finalPrice,
      coupon_code || '',
      discount,
      bonusPoints,
      order_type || '代练',
      accCount,
      frozenPoints,
      finalInviteCode,
      estDate
    ).run();

    const orderId = result.meta.last_row_id;

    // ── 11. 发送通知 ──
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已提交', '工单 #' || ? || ' 已提交，等待管理员审核中', 'order')"
    ).bind(user.id, orderId).run();

    // ── 12. 记录活动日志 ──
    const paymentLabel = payment_method === 'coin' ? '修仙币' : payment_method === 'wechat' ? '现金' : '灵石';
    await logActivity(env, orderId, user.id, 'created',
      `提交工单: ${accCount}个账号, ${paymentLabel}支付, ${points}积分`);

    return json({
      ok: true,
      message: '工单已提交，等待审核',
      order_id: orderId,
      price_info: {
        points,
        payment_method: payment_method,
        price: finalPrice,
        unit: priceUnit,
        accounts: accCount,
        frozen_points: frozenPoints
      }
    });
  }

  // ── Single Order Detail ────────────────────────────
  const orderMatch = path.match(/^\/api\/orders\/(\d+)$/);
  if (orderMatch && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const order = await env.DB.prepare(
      'SELECT o.*, (SELECT COUNT(*) FROM game_accounts WHERE order_id = o.id) as account_count FROM orders o WHERE o.id = ? AND (o.user_id = ? OR ? = 1)'
    ).bind(orderMatch[1], user.id, user.is_admin || 0).first();
    if (!order) return json({ error: '工单不存在' }, 404);

    const accounts = await env.DB.prepare(
      'SELECT * FROM game_accounts WHERE order_id = ? ORDER BY id ASC'
    ).bind(order.id).all();

    return json({ ok: true, order, accounts: accounts.results });
  }

  // ── All Accounts (user's) ─────────────────────────
  if (path === '/api/accounts' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const orderId = url.searchParams.get('order_id') || '';
    let query = 'SELECT ga.*, o.status as order_status, o.invite_code FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE o.user_id = ?';
    const params = [user.id];
    if (orderId) { query += ' AND ga.order_id = ?'; params.push(orderId); }
    const accounts = await env.DB.prepare(query + ' ORDER BY ga.id DESC').bind(...params).all();
    return json({ ok: true, accounts: accounts.results });
  }

  // ── Account Detail ────────────────────────────────
  const accMatch = path.match(/^\/api\/accounts\/(\d+)$/);
  if (accMatch && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const account = await env.DB.prepare(
      'SELECT ga.*, o.status as order_status, o.user_id as order_user_id FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.id = ?'
    ).bind(accMatch[1]).first();
    if (!account) return json({ error: '账号不存在' }, 404);
    if (account.order_user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);
    return json({ ok: true, account });
  }

  // ── Notifications ─────────────────────────────────
  if (path === '/api/notifications' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const type = url.searchParams.get('type') || '';
    let query = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [user.id];
    if (type) { query += ' AND type = ?'; params.push(type); }
    const notifs = await env.DB.prepare(query + ' ORDER BY created_at DESC LIMIT 50').bind(...params).all();
    const unreadCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0'
    ).bind(user.id).first();
    return json({ ok: true, notifications: notifs.results, unread: unreadCount.cnt });
  }

  if (path === '/api/notifications/read' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { id } = body;
    if (id) {
      await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    } else {
      await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
    }
    return json({ ok: true });
  }

  // ── Appeals ───────────────────────────────────────
  if (path === '/api/appeals' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const appeals = await env.DB.prepare(
      'SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    return json({ ok: true, appeals: appeals.results });
  }

  if (path === '/api/appeals' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { order_id, title, content, type } = body;
    if (!title || !content) return json({ error: '请填写标题和内容' }, 400);
    await env.DB.prepare(
      "INSERT INTO appeals (user_id, order_id, title, content, type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, order_id || 0, title, content, type || 'appeal').run();
    return json({ ok: true, message: '申诉已提交' });
  }

  // ── Invite Info ───────────────────────────────────
  if (path === '/api/invite/info' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    const inviteOrders = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = 'approved'"
    ).bind(user.id).first();
    // 邀请收益基于bonus_points计算（不再硬编码30%，使用实际boost倍率）
    const inviteEarnings = await env.DB.prepare(
      "SELECT COALESCE(SUM(o.bonus_points), 0) as total FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = 'approved'"
    ).bind(user.id).first();
    const totalPurchased = user.total_purchased_points || 0;
    const boost = getInviteBoost(totalPurchased);
    const nextTier = INVITE_BOOST_TIERS.find(t => t.mult > boost.mult);
    return json({
      ok: true,
      invite_code: user.invite_code,
      total_invited: totalInvited.cnt,
      invite_orders: inviteOrders.cnt,
      invite_points: user.invite_points,
      invite_earnings: inviteEarnings.total,
      commission_rate: boost.rate,
      base_rate: 30,
      boost_mult: boost.mult,
      boost_label: boost.label,
      total_purchased_points: totalPurchased,
      next_tier: nextTier ? { label: nextTier.label, need: nextTier.min - totalPurchased, rate: nextTier.rate } : null,
      packages: INVITE_PACKAGES,
    });
  }

  // ── Invite Package Purchase ──────────────────────
  if (path === '/api/invite/packages' && method === 'GET') {
    return json({ ok: true, packages: INVITE_PACKAGES });
  }

  if (path === '/api/invite/purchase' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { package_id, payment_method, payment_account } = body;
    if (!package_id || !payment_method || !payment_account) return json({ error: '请填写完整信息' }, 400);
    const pkg = INVITE_PACKAGES.find(p => p.id === package_id);
    if (!pkg) return json({ error: '无效套餐' }, 400);
    if (!['wechat', 'spirit_stone'].includes(payment_method)) return json({ error: '无效支付方式' }, 400);

    const price = payment_method === 'wechat' ? pkg.price : pkg.price * 1000000;
    const bonusPoints = payment_method === 'wechat' ? pkg.points : Math.floor(pkg.points / 12);

    // Create order with special invite_package marker in invite_code field
    const result = await env.DB.prepare(
      "INSERT INTO orders (user_id, invite_code, payment_method, payment_account, amount, price, bonus_points, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, 'PKG:' + package_id + ':' + pkg.name, payment_method, payment_account, pkg.price, price, bonusPoints).run();

    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '套餐购买已提交', '邀请积分套餐「' + ? + '」购买订单已提交，等待管理员审核', 'order')"
    ).bind(user.id, pkg.name).run();

    return json({ ok: true, message: '购买申请已提交，等待管理员审核', order_id: result.meta.last_row_id });
  }

  // ── Invite Withdraw ──────────────────────────────
  if (path === '/api/invite/withdraw' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { points } = body;
    if (!points || points < 10) return json({ error: '最少提现10积分' }, 400);
    if ((user.invite_points || 0) < points) return json({ error: '积分不足' }, 400);
    await env.DB.prepare(
      'UPDATE users SET invite_points = invite_points - ? WHERE id = ?'
    ).bind(points, user.id).run();
    return json({ ok: true, message: '提现申请已提交，请联系管理员处理' });
  }

  // ── Bot ───────────────────────────────────────────
  if (path === '/api/bot/ask' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { question } = body;
    if (!question) return json({ error: '请输入问题' }, 400);
    const answer = await getBotAnswer(question, env, user);
    await env.DB.prepare(
      "INSERT INTO bot_logs (user_id, question, answer) VALUES (?, ?, ?)"
    ).bind(user.id, question, answer).run();
    return json({ ok: true, answer });
  }

  // ── Admin Routes ─────────────────────────────────
  if (path === '/api/admin/orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const status = url.searchParams.get('status') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 50;
    const offset = (page - 1) * limit;
    let query = 'SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE o.status = ?'; params.push(status); }
    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const orders = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, orders: orders.results, page, limit });
  }

  if (path.match(/^\/api\/admin\/orders\/(\d+)\/status$/) && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const orderId = parseInt(path.match(/^\/api\/admin\/orders\/(\d+)\/status$/)[1]);
    const { status, admin_notes } = body;

    await env.DB.prepare(
      "UPDATE orders SET status = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(status, admin_notes || '', orderId).run();
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();

    if (status === 'approved') {
      await env.DB.prepare(
        // total_spent使用bonus_points统一单位
        'UPDATE users SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?'
      ).bind(order.bonus_points, order.user_id).run();

      // Handle invite package purchase orders
      const isPackage = order.invite_code && order.invite_code.startsWith('PKG:');
      if (isPackage) {
        const pkgPoints = order.bonus_points || 0;
        await env.DB.prepare(
          'UPDATE users SET total_purchased_points = COALESCE(total_purchased_points, 0) + ?, invite_points = invite_points + ? WHERE id = ?'
        ).bind(pkgPoints, pkgPoints, order.user_id).run();
        const pkgName = order.invite_code.replace('PKG:', '').split(':')[1] || '邀请套餐';
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '套餐已到账', '「' || ? || '」' || ? || ' 邀请积分已到账，当前倍率已提升！', 'commission')"
        ).bind(order.user_id, pkgName, pkgPoints).run();
        await logActivity(env, orderId, order.user_id, 'commission', '购买套餐到账 ' + pkgPoints + ' 积分');
      } else {
        // XP基于bonus_points统一计算（微信1元=120分，灵石100万=10分）
        const xpGain = Math.max(10, Math.floor(order.bonus_points * 0.1));
        await addXP(env, order.user_id, xpGain, '工单 #' + orderId + ' 审核通过');
        await logActivity(env, orderId, order.user_id, 'approved', '工单已审核通过');

        if (order.user_id) {
          const buyer = await env.DB.prepare('SELECT invited_by FROM users WHERE id = ?').bind(order.user_id).first();
          if (buyer && buyer.invited_by > 0) {
            const boostInfo = getInviteBoost((await env.DB.prepare('SELECT total_purchased_points FROM users WHERE id = ?').bind(buyer.invited_by).first())?.total_purchased_points || 0);
            // 佣金基于bonus_points统一计算，避免灵石/微信单位不一致
            const commission = order.bonus_points * (boostInfo.rate / 100);
            await env.DB.prepare(
              'UPDATE users SET invite_points = invite_points + ? WHERE id = ?'
            ).bind(commission, buyer.invited_by).run();
            await env.DB.prepare(
              "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '邀请分成到账', '下线成交获得 ' || ? || ' 邀请积分奖励（' || ? || '倍率）', 'commission')"
            ).bind(buyer.invited_by, commission.toFixed(1), boostInfo.label).run();
            await logActivity(env, orderId, buyer.invited_by, 'commission', '获得分成 ' + commission.toFixed(1) + ' 积分（' + boostInfo.label + '倍率）');
          }
        }
      }

      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已通过', '工单 #' || ? || ' 已审核通过，正在处理中', 'order')"
      ).bind(order.user_id, orderId).run();
    } else if (status === 'rejected') {
      // 修仙币支付：退还冻结的积分
      if (order.payment_method === 'coin' && order.frozen_points > 0) {
        await env.DB.prepare(
          'UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?'
        ).bind(order.frozen_points, order.user_id).run();
        await logActivity(env, orderId, order.user_id, 'refund',
          '工单拒绝，退还冻结修仙币 ' + order.frozen_points + ' 个');
      }
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单被拒绝', '工单 #' || ? || ' 被拒绝: ' || ?, 'order')"
      ).bind(order.user_id, orderId, admin_notes || '无原因').run();
      await logActivity(env, orderId, order.user_id, 'rejected', '拒绝原因: ' + (admin_notes || '未说明'));
    } else if (status === 'completed') {
      await logActivity(env, orderId, order.user_id, 'completed', '工单已完成');
    }

    return json({ ok: true, message: '状态已更新' });
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, level, xp, total_orders, total_spent, total_invited, invite_code, invite_points, total_purchased_points, email, avatar_url, bio, is_admin, locked, created_at, last_login FROM users ORDER BY id DESC"
    ).all();
    return json({ ok: true, users: users.results });
  }

  if (path.match(/^\/api\/admin\/users\/(\d+)\/lock$/) && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(path.match(/^\/api\/admin\/users\/(\d+)\/lock$/)[1]);
    const { locked } = body;
    await env.DB.prepare('UPDATE users SET locked = ? WHERE id = ?').bind(locked ? 1 : 0, targetId).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/accounts' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT ga.*, o.user_id as order_user_id, u.username as user_name FROM game_accounts ga JOIN orders o ON ga.order_id = o.id JOIN users u ON o.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE ga.status = ?'; params.push(status); }
    query += ' ORDER BY ga.id DESC LIMIT 100';
    const accounts = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, accounts: accounts.results });
  }

  if (path === '/api/admin/appeals' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT a.*, u.username as user_name FROM appeals a JOIN users u ON a.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE a.status = ?'; params.push(status); }
    query += ' ORDER BY a.created_at DESC';
    const appeals = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, appeals: appeals.results });
  }

  if (path.match(/^\/api\/admin\/appeals\/(\d+)\/reply$/) && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const appealId = parseInt(path.match(/^\/api\/admin\/appeals\/(\d+)\/reply$/)[1]);
    const { reply, status } = body;
    await env.DB.prepare(
      "UPDATE appeals SET admin_reply = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(reply || '', status || 'resolved', appealId).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/config' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const configs = await env.DB.prepare('SELECT * FROM config').all();
    return json({ ok: true, config: configs.results });
  }

  if (path === '/api/admin/config' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    // 支持批量保存：{ configs: [{ key, value }, ...] }
    if (body.configs && Array.isArray(body.configs)) {
      const results = [];
      for (const item of body.configs) {
        if (item.key && item.value !== undefined) {
          await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(item.key, String(item.value)).run();
          results.push(item.key);
        }
      }
      return json({ ok: true, saved: results });
    }
    const { key, value } = body;
    if (!key || value === undefined) return json({ error: '参数不全' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    return json({ ok: true });
  }

  // ── AI Config Test ────────────────────────────────
  if (path === '/api/admin/ai-test' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const configs = await env.DB.prepare(
      "SELECT key, value FROM config WHERE key IN ('ai_api_key', 'ai_api_url', 'ai_model')"
    ).all();
    const configMap = {};
    for (const c of (configs.results || [])) configMap[c.key] = c.value;
    const apiKey = configMap['ai_api_key'];
    const apiUrl = configMap['ai_api_url'] || 'https://api.openai.com/v1/chat/completions';
    const model = configMap['ai_model'] || 'gpt-3.5-turbo';
    if (!apiKey) return json({ ok: false, error: '未设置API Key' }, 400);
    try {
      const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复"连接成功"即可' }], max_tokens: 20 }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        return json({ ok: false, error: 'API返回错误: ' + aiRes.status + ' ' + errText.slice(0, 200) }, 400);
      }
      return json({ ok: true, message: 'AI连接测试成功' });
    } catch (e) {
      return json({ ok: false, error: '连接失败: ' + e.message }, 400);
    }
  }

  // ── Admin: AI Config Save ─────────────────────────
  if (path === '/api/admin/ai-config' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const fields = ['ai_api_url', 'ai_model', 'ai_enabled', 'ai_api_key'];
    for (const f of fields) {
      if (body[f] !== undefined) {
        await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(f, String(body[f])).run();
      }
    }
    return json({ ok: true });
  }
  if (path === '/api/admin/ai-config' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const configs = await env.DB.prepare("SELECT key, value FROM config WHERE key LIKE 'ai_%'").all();
    const configMap = {};
    for (const c of (configs.results || [])) configMap[c.key] = c.value;
    return json({ ok: true, config: { ...configMap, ai_api_key_set: !!configMap['ai_api_key'] } });
  }
  if (path === '/api/admin/ai-config/test' && method === 'POST') {
    // 兼容旧路径，转发到 ai-test
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const configs = await env.DB.prepare(
      "SELECT key, value FROM config WHERE key IN ('ai_api_key', 'ai_api_url', 'ai_model')"
    ).all();
    const configMap = {};
    for (const c of (configs.results || [])) configMap[c.key] = c.value;
    const apiKey = configMap['ai_api_key'];
    const apiUrl = configMap['ai_api_url'] || 'https://api.openai.com/v1/chat/completions';
    const model = configMap['ai_model'] || 'gpt-3.5-turbo';
    if (!apiKey) return json({ ok: false, error: '未设置API Key' }, 400);
    try {
      const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复"连接成功"即可' }], max_tokens: 20 }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        return json({ ok: false, error: 'API返回错误: ' + aiRes.status + ' ' + errText.slice(0, 200) }, 400);
      }
      return json({ ok: true, message: 'AI连接测试成功' });
    } catch (e) {
      return json({ ok: false, error: '连接失败: ' + e.message }, 400);
    }
  }

  // ── Admin: Market Orders ──────────────────────────
  if (path === '/api/admin/market-orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT mo.*, u.username as user_name FROM market_orders mo JOIN users u ON mo.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE mo.status = ?'; params.push(status); }
    query += ' ORDER BY mo.created_at DESC LIMIT 100';
    const orders = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, orders: orders.results });
  }
  if (path === '/api/admin/market-orders' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const { order_id, action } = body;
    if (!order_id || !action) return json({ error: '参数不全' }, 400);
    const order = await env.DB.prepare('SELECT * FROM market_orders WHERE id = ?').bind(order_id).first();
    if (!order) return json({ error: '订单不存在' }, 404);
    if (action === 'admin-delete') {
      if (order.type === 'buy' && order.status === 'pending') {
        const refund = order.price_coins * order.quantity;
        await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(refund, order.user_id).run();
      }
      await env.DB.prepare('DELETE FROM market_orders WHERE id = ?').bind(order_id).run();
      return json({ ok: true, message: '已删除订单' });
    }
    if (action === 'approve' || action === 'reject') {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await env.DB.prepare("UPDATE market_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(newStatus, order_id).run();
      return json({ ok: true });
    }
    return json({ error: '未知操作' }, 400);
  }

  // ── Admin: Market Items ───────────────────────────
  if (path === '/api/admin/market-items' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const items = await env.DB.prepare('SELECT * FROM market_items ORDER BY id ASC').all();
    return json({ ok: true, items: items.results });
  }
  if (path === '/api/admin/market-items' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const { id, name, price_coins, stock, description, image_url } = body;
    if (id) {
      await env.DB.prepare('UPDATE market_items SET name=?, price_coins=?, stock=?, description=?, image_url=? WHERE id=?')
        .bind(name, price_coins, stock, description || '', image_url || '', id).run();
    } else {
      await env.DB.prepare('INSERT INTO market_items (name, price_coins, stock, description, image_url) VALUES (?, ?, ?, ?, ?)')
        .bind(name, price_coins, stock || 0, description || '', image_url || '').run();
    }
    return json({ ok: true });
  }
  if (path === '/api/admin/market-items' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const { id } = body;
    if (!id) return json({ error: '缺少id' }, 400);
    await env.DB.prepare('DELETE FROM market_items WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // ── Market: Public Items ──────────────────────────
  if (path === '/api/market/items' && method === 'GET') {
    const items = await env.DB.prepare('SELECT * FROM market_items WHERE stock > 0 ORDER BY price_coins ASC').all();
    return json({ ok: true, items: items.results });
  }

  // ── Market: User Orders ───────────────────────────
  if (path === '/api/market/orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const orders = await env.DB.prepare('SELECT * FROM market_orders WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
    return json({ ok: true, orders: orders.results });
  }
  if (path === '/api/market/orders' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { item_id, type, price_coins, quantity, description } = body;
    if (!item_id || !type) return json({ error: '参数不全' }, 400);
    if (type === 'buy') {
      const item = await env.DB.prepare('SELECT * FROM market_items WHERE id = ?').bind(item_id).first();
      if (!item) return json({ error: '商品不存在' }, 404);
      const totalCost = item.price_coins * (quantity || 1);
      const userInfo = await env.DB.prepare('SELECT bonus_points FROM users WHERE id = ?').bind(user.id).first();
      if ((userInfo?.bonus_points || 0) < totalCost) return json({ error: '修仙币不足' }, 400);
      await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(totalCost, user.id).run();
      await env.DB.prepare('INSERT INTO market_orders (user_id, item_id, type, price_coins, quantity, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(user.id, item_id, type, item.price_coins, quantity || 1, description || '', 'pending').run();
    } else {
      await env.DB.prepare('INSERT INTO market_orders (user_id, item_id, type, price_coins, quantity, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(user.id, item_id, type, price_coins || 0, quantity || 1, description || '', 'pending').run();
    }
    return json({ ok: true });
  }

  // ── Market: Purchase ──────────────────────────────
  if (path === '/api/market/purchase' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { item_id, quantity } = body;
    if (!item_id) return json({ error: '缺少商品ID' }, 400);
    const item = await env.DB.prepare('SELECT * FROM market_items WHERE id = ?').bind(item_id).first();
    if (!item) return json({ error: '商品不存在' }, 404);
    const qty = quantity || 1;
    const totalCost = item.price_coins * qty;
    const userInfo = await env.DB.prepare('SELECT bonus_points FROM users WHERE id = ?').bind(user.id).first();
    if ((userInfo?.bonus_points || 0) < totalCost) return json({ error: '修仙币不足' }, 400);
    if (item.stock < qty) return json({ error: '库存不足' }, 400);
    await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(totalCost, user.id).run();
    await env.DB.prepare('UPDATE market_items SET stock = stock - ? WHERE id = ?').bind(qty, item_id).run();
    await env.DB.prepare('INSERT INTO market_orders (user_id, item_id, type, price_coins, quantity, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, item_id, 'buy', item.price_coins, qty, 'completed').run();
    return json({ ok: true, message: '购买成功' });
  }

  // ── Order Activities ────────────────────────────────
  if (path.match(/^\/api\/orders\/(\d+)\/activities$/) && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const orderId = parseInt(path.match(/^\/api\/orders\/(\d+)\/activities$/)[1]);
    const order = await env.DB.prepare('SELECT user_id FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) return json({ error: '工单不存在' }, 404);
    if (order.user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);
    const activities = await env.DB.prepare(
      'SELECT * FROM order_activities WHERE order_id = ? ORDER BY created_at ASC'
    ).bind(orderId).all();
    return json({ ok: true, activities: activities.results });
  }

  // ── User Settings ────────────────────────────────────
  // ⚠️ [已废弃] 请使用 functions/api/user/change-password.js
  // 旧版 worker 路径已同步 verifyPassword，但仍建议切换到 Pages Functions
  if (path === '/api/user/change-password' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { old_password, new_password } = body;
    if (!old_password || !new_password) return json({ error: '请填写旧密码和新密码' }, 400);
    if (new_password.length < 6) return json({ error: '新密码至少6位' }, 400);
    if (new_password.length > 64) return json({ error: '新密码过长' }, 400);

    // 使用 verifyPassword 兼容新旧密码格式
    const current = await env.DB.prepare(
      'SELECT password_hash FROM users WHERE id = ?'
    ).bind(user.id).first();
    if (!current) return json({ error: '用户不存在' }, 404);
    const valid = await verifyPassword(old_password, current.password_hash);
    if (!valid) return json({ error: '旧密码错误' }, 400);

    const newHash = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(newHash, user.id).run();
    // 清除所有 session，强制重新登录
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true, message: '密码修改成功，请重新登录' });
  }

  if (path === '/api/user/profile' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { email, avatar_url, display_name, bio } = body;
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
      await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email || '', user.id).run();
    }
    if (avatar_url !== undefined) {
      if (avatar_url.length > 500) return json({ error: '头像URL过长' }, 400);
      await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
    }
    if (display_name !== undefined) {
      if (display_name.length > 30) return json({ error: '显示名过长' }, 400);
      await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(display_name, user.id).run();
    }
    if (bio !== undefined) {
      if (bio.length > 200) return json({ error: '简介过长' }, 400);
      await env.DB.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    }
    return json({ ok: true, message: '资料已更新' });
  }

  // ── Public Profile ──────────────────────────────
  if (path.match(/^\/api\/user\/(\d+)\/public$/) && method === 'GET') {
    const uid = parseInt(path.match(/^\/api\/user\/(\d+)\/public$/)[1]);
    const u = await env.DB.prepare(
      'SELECT id, username, display_name, level, total_orders, total_spent, invite_code, avatar_url, bio, created_at FROM users WHERE id = ?'
    ).bind(uid).first();
    if (!u) return json({ error: '用户不存在' }, 404);
    const totalInvited = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?').bind(uid).first();
    return json({ ok: true, user: { ...u, total_invited: totalInvited.cnt } });
  }

  // ── Admin: Coupons ──────────────────────────────────
  if (path === '/api/admin/coupons' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const coupons = await env.DB.prepare(
      'SELECT * FROM coupons ORDER BY created_at DESC'
    ).all();
    return json({ ok: true, coupons: coupons.results });
  }

  if (path === '/api/admin/coupons' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const { code, discount_percent, max_uses, expires_at, description } = body;
    if (!code || discount_percent === undefined) return json({ error: '参数不全' }, 400);
    if (discount_percent < 1 || discount_percent > 100) return json({ error: '折扣比例需在1-100之间' }, 400);
    const cleanCode = code.trim().toUpperCase();
    const existing = await env.DB.prepare('SELECT id FROM coupons WHERE code = ?').bind(cleanCode).first();
    if (existing) return json({ error: '优惠码已存在' }, 400);
    await env.DB.prepare(
      "INSERT INTO coupons (code, discount_percent, max_uses, expires_at, description) VALUES (?, ?, ?, ?, ?)"
    ).bind(cleanCode, discount_percent, max_uses || 0, expires_at || null, description || '').run();
    return json({ ok: true, message: '优惠券已创建' });
  }

  if (path.match(/^\/api\/admin\/coupons\/(\d+)$/) && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const id = parseInt(path.match(/^\/api\/admin\/coupons\/(\d+)$/)[1]);
    await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run();
    return json({ ok: true, message: '优惠券已删除' });
  }

  // ── API: GitHub Actions ─────────────────────────
  if (path === '/api/gh/approved-orders' && method === 'GET') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const orders = await env.DB.prepare(
      "SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = 'approved' ORDER BY o.id ASC"
    ).all();
    return json({ ok: true, orders: orders.results });
  }

  if (path === '/api/gh/report-account' && method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const { order_id, username, password, status, level, map_id, map_name, skills, techniques, equipment, error_msg, server_username, server_password } = body;

    if (status === 'creating') {
      const existing = await env.DB.prepare(
        'SELECT id FROM game_accounts WHERE username = ? AND order_id = ?'
      ).bind(username, order_id).first();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO game_accounts (order_id, username, password, server_username, server_password, status, created_at) VALUES (?, ?, ?, ?, ?, 'registering', datetime('now'))"
        ).bind(order_id, username, password, server_username || '', server_password || '').run();
        const ord = await env.DB.prepare('SELECT user_id FROM orders WHERE id = ?').bind(order_id).first();
        await logActivity(env, order_id, ord?.user_id || 0, 'account_created', '创建账号: ' + username);
      }
    } else if (status === 'farming' || status === 'active') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, map_id = ?, map_name = ?, skills = ?, techniques = ?, equipment = ?, is_farming = 1, last_check_at = datetime('now'), health_status = 'ok' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, map_id || 0, map_name || '', JSON.stringify(skills || []), JSON.stringify(techniques || []), JSON.stringify(equipment || []), username, order_id).run();
    } else if (status === 'completed') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, reached_120_at = datetime('now'), stop_monitor_at = datetime('now', '+2 days'), last_check_at = datetime('now'), health_status = 'completed' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, username, order_id).run();
    } else if (status === 'error' || status === 'failed') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, error_msg = ?, last_check_at = datetime('now'), health_status = 'error' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, error_msg || '', username, order_id).run();
    } else {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, last_check_at = datetime('now') WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, username, order_id).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/gh/active-accounts' && method === 'GET') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const accounts = await env.DB.prepare(
      "SELECT ga.*, o.user_id, o.invite_code FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.status IN ('farming', 'active', 'registering') AND (ga.stop_monitor_at IS NULL OR ga.stop_monitor_at > datetime('now')) LIMIT 200"
    ).all();
    return json({ ok: true, accounts: accounts.results });
  }

  if (path === '/api/gh/report-health' && method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const { order_id, username, level, status, map_id, map_name, error_msg } = body;
    const isCompleted = level >= 120;
    const reportStatus = isCompleted ? 'completed' : (status || 'farming');

    await env.DB.prepare(
      "UPDATE game_accounts SET status = ?, level = ?, map_id = ?, map_name = ?, last_check_at = datetime('now'), error_msg = ?, reached_120_at = CASE WHEN ? >= 120 THEN datetime('now') ELSE reached_120_at END, stop_monitor_at = CASE WHEN ? >= 120 THEN datetime('now', '+2 days') ELSE stop_monitor_at END WHERE username = ? AND order_id = ?"
    ).bind(reportStatus, level || 0, map_id || 0, map_name || '', error_msg || '', level || 0, level || 0, username, order_id).run();

    return json({ ok: true, completed: isCompleted });
  }

  if (path === '/api/gh/complete-order' && method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const { order_id } = body;
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM game_accounts WHERE order_id = ? AND status NOT IN ('completed', 'failed')"
    ).bind(order_id).first();
    if (pending.cnt === 0) {
      const order = await env.DB.prepare("SELECT user_id FROM orders WHERE id = ?").bind(order_id).first();
      await env.DB.prepare(
        "UPDATE orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
      ).bind(order_id).run();
      if (order) {
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已完成', '工单 #' || ? || ' 已全部完成，账号已到达120级', 'order')"
        ).bind(order.user_id, order_id).run();
        await logActivity(env, order_id, order.user_id, 'completed', '所有账号已到120级，工单自动完成');
      }
      return json({ ok: true, message: '订单已完成' });
    }
    return json({ ok: true, message: '仍有账号未完成', pending: pending.cnt });
  }

  // ── Coupon validation ─────────────────────────────
  if (path === '/api/coupon/validate' && method === 'POST') {
    const { code } = body;
    if (!code) return json({ error: '请输入优惠码' }, 400);
    const coupon = await env.DB.prepare(
      "SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).bind(code).first();
    if (!coupon) return json({ error: '优惠码无效或已过期' }, 404);
    if (coupon.used_count >= coupon.max_uses) return json({ error: '优惠码已用完' }, 400);
    return json({
      ok: true,
      coupon_type: coupon.coupon_type || 'percent',
      discount_percent: coupon.discount_percent,
      fixed_amount: coupon.fixed_amount || 0,
      min_amount: coupon.min_amount
    });
  }

  // ── Config ──────────────────────────────────────
  if (path === '/api/config' && method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM config').all();
    const cfg = {};
    for (const c of configs.results) cfg[c.key] = c.value;
    return json({ ok: true, config: cfg });
  }

  // ── Dashboard Stats ─────────────────────────────
  if (path === '/api/stats' && method === 'GET') {
    const totalUsers = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
    const totalOrders = await env.DB.prepare('SELECT COUNT(*) as cnt FROM orders').first();
    const totalApproved = await env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='approved'").first();
    const totalCompleted = await env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='completed'").first();
    const totalAccounts = await env.DB.prepare('SELECT COUNT(*) as cnt FROM game_accounts').first();
    const onlineAccounts = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('farming','active')"
    ).first();
    return json({
      ok: true,
      stats: {
        total_users: totalUsers.cnt,
        total_orders: totalOrders.cnt,
        approved_orders: totalApproved.cnt,
        completed_orders: totalCompleted.cnt,
        total_accounts: totalAccounts.cnt,
        online_accounts: onlineAccounts.cnt,
      },
    });
  }

  // ── Leaderboard ─────────────────────────────────
  if (path === '/api/leaderboard/purchase' && method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, total_orders, total_spent, total_invited, xp, bio FROM users WHERE total_spent > 0 ORDER BY total_spent DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  if (path === '/api/leaderboard/invite' && method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, total_invited, xp, total_spent, bio FROM users WHERE total_invited > 0 ORDER BY total_invited DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  if (path === '/api/leaderboard/level' && method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, xp, total_orders, bio FROM users ORDER BY xp DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  // ── After-Sales (enhanced appeals) ─────────────
  if (path === '/api/after-sales' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const items = await env.DB.prepare(
      "SELECT a.*, o.invite_code as order_invite_code FROM appeals a LEFT JOIN orders o ON a.order_id = o.id WHERE a.user_id = ? AND a.type IN ('after_sales','appeal') ORDER BY a.created_at DESC"
    ).bind(user.id).all();
    return json({ ok: true, items: items.results });
  }

  if (path === '/api/after-sales' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { order_id, title, content } = body;
    if (!title || !content) return json({ error: '请填写标题和内容' }, 400);
    if (!order_id) return json({ error: '请选择相关工单' }, 400);
    await env.DB.prepare(
      "INSERT INTO appeals (user_id, order_id, title, content, type, status, created_at) VALUES (?, ?, ?, ?, 'after_sales', 'pending', datetime('now'))"
    ).bind(user.id, order_id, title, content).run();
    return json({ ok: true, message: '售后请求已提交，等待管理员回复' });
  }

  if (path.match(/^\/api\/after-sales\/(\d+)\/reply$/) && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const itemId = parseInt(path.match(/^\/api\/after-sales\/(\d+)\/reply$/)[1]);
    const { content } = body;
    if (!content) return json({ error: '请填写回复内容' }, 400);
    const item = await env.DB.prepare('SELECT * FROM appeals WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
    if (!item) return json({ error: '售后请求不存在' }, 404);
    const existing = item.admin_reply || '';
    await env.DB.prepare(
      "UPDATE appeals SET admin_reply = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(existing + '\n[用户回复] ' + content, itemId).run();
    return json({ ok: true, message: '已回复' });
  }

  // ── Redeem Codes ───────────────────────────────
  if (path === '/api/redeem' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { code } = body;
    if (!code) return json({ error: '请输入兑换码' }, 400);
    const clean = code.trim().toUpperCase();
    const rc = await env.DB.prepare(
      "SELECT * FROM redeem_codes WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now')) AND (max_uses = 0 OR used_count < max_uses)"
    ).bind(clean).first();
    if (!rc) return json({ error: '兑换码无效或已用完' }, 404);
    const used = await env.DB.prepare('SELECT id FROM redeem_log WHERE user_id = ? AND code = ?').bind(user.id, clean).first();
    if (used) return json({ error: '您已使用过此兑换码' }, 400);
    await env.DB.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').bind(rc.id).run();
    await env.DB.prepare('INSERT INTO redeem_log (user_id, code, xp) VALUES (?, ?, ?)').bind(user.id, clean, rc.xp).run();
    await addXP(env, user.id, rc.xp, '使用兑换码 ' + clean);
    return json({ ok: true, message: '兑换成功，获得 ' + rc.xp + ' 经验值', xp: rc.xp });
  }

  // ── Account Logs (GH run output) ────────────────
  if (path.match(/^\/api\/accounts\/(\d+)\/logs$/) && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const aid = parseInt(path.match(/^\/api\/accounts\/(\d+)\/logs$/)[1]);
    const acc = await env.DB.prepare(
      'SELECT ga.*, o.user_id as order_user_id FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.id = ?'
    ).bind(aid).first();
    if (!acc) return json({ error: '账号不存在' }, 404);
    if (acc.order_user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);
    const logs = await env.DB.prepare(
      'SELECT * FROM account_logs WHERE account_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(aid).all();
    return json({ ok: true, logs: logs.results });
  }

  // ── Admin: Full User Management ────────────────
  // ⚠️ [已废弃] admin reset-password — 请使用 functions/api/admin/users/[id]/reset-password.js
  if (path.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/) && method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(path.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/)[1]);
    const { new_password } = body;
    if (!new_password || new_password.length < 6) return json({ error: '密码至少6位' }, 400);
    const hash = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, targetId).run();
    // 清除该用户所有 session，强制重新登录
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
    return json({ ok: true, message: '密码已重置' });
  }

  if (path.match(/^\/api\/admin\/users\/(\d+)\/level$/) && method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(path.match(/^\/api\/admin\/users\/(\d+)\/level$/)[1]);
    const { level } = body;
    if (!level || level < 1 || level > 10) return json({ error: '等级需在1-10之间' }, 400);
    await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(level, targetId).run();
    return json({ ok: true, message: '等级已更新' });
  }

  if (path.match(/^\/api\/admin\/users\/(\d+)\/admin$/) && method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(path.match(/^\/api\/admin\/users\/(\d+)\/admin$/)[1]);
    const { is_admin } = body;
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(is_admin ? 1 : 0, targetId).run();
    return json({ ok: true, message: is_admin ? '已提升为管理员' : '已取消管理员' });
  }

  if (path.match(/^\/api\/admin\/users\/(\d+)\/delete$/) && method === 'DELETE') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(path.match(/^\/api\/admin\/users\/(\d+)\/delete$/)[1]);
    if (targetId === admin.id) return json({ error: '不能删除自己' }, 400);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
    return json({ ok: true, message: '用户已删除' });
  }

  // ── Admin: Announcements & Ads ────────────────
  if (path === '/api/admin/announcements' && method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const anns = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
    return json({ ok: true, announcements: anns.results });
  }

  if (path === '/api/admin/announcements' && method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const { content, enabled } = body;
    if (!content) return json({ error: '请输入公告内容' }, 400);
    await env.DB.prepare(
      "INSERT INTO announcements (content, enabled, created_at) VALUES (?, ?, datetime('now'))"
    ).bind(content, enabled !== false ? 1 : 0).run();
    return json({ ok: true, message: '公告已发布' });
  }

  if (path.match(/^\/api\/admin\/announcements\/(\d+)$/) && method === 'DELETE') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(parseInt(path.match(/^\/api\/admin\/announcements\/(\d+)$/)[1])).run();
    return json({ ok: true });
  }

  if (path === '/api/announcements/active' && method === 'GET') {
    const ann = await env.DB.prepare(
      "SELECT * FROM announcements WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1"
    ).first();
    return json({ ok: true, announcement: ann || null });
  }

  // ── Admin: Ads ─────────────────────────────────
  if (path === '/api/admin/ads' && method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const ads = await env.DB.prepare('SELECT * FROM ads ORDER BY created_at DESC').all();
    return json({ ok: true, ads: ads.results });
  }

  if (path === '/api/admin/ads' && method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const { type, image_url, link_url, title, enabled } = body;
    if (!image_url) return json({ error: '请上传图片' }, 400);
    await env.DB.prepare(
      "INSERT INTO ads (type, image_url, link_url, title, enabled, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind(type || 'popup', image_url, link_url || '', title || '', enabled ? 1 : 0).run();
    return json({ ok: true, message: '广告已添加' });
  }

  if (path.match(/^\/api\/admin\/ads\/(\d+)$/) && method === 'DELETE') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    await env.DB.prepare('DELETE FROM ads WHERE id = ?').bind(parseInt(path.match(/^\/api\/admin\/ads\/(\d+)$/)[1])).run();
    return json({ ok: true });
  }

  if (path === '/api/ads/active' && method === 'GET') {
    const popup = await env.DB.prepare("SELECT * FROM ads WHERE type = 'popup' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const sidebar = await env.DB.prepare("SELECT * FROM ads WHERE type = 'sidebar' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    return json({ ok: true, popup: popup || null, sidebar: sidebar || null });
  }

  // ── GH: Report Account Log ─────────────────────
  if (path === '/api/gh/report-log' && method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const { account_id, order_id, log_type, message, raw_output } = body;
    await env.DB.prepare(
      "INSERT INTO account_logs (account_id, order_id, log_type, message, raw_output) VALUES (?, ?, ?, ?, ?)"
    ).bind(account_id || 0, order_id || 0, log_type || 'info', message || '', raw_output || '').run();
    return json({ ok: true });
  }

  // ── Public config with announcements/ads ──────
  if (path === '/api/public/config' && method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM config').all();
    const cfg = {};
    for (const c of configs.results) cfg[c.key] = c.value;
    const ann = await env.DB.prepare("SELECT * FROM announcements WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const adsData = {
      popup: null, sidebar: null
    };
    const popupAd = await env.DB.prepare("SELECT * FROM ads WHERE type = 'popup' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const sidebarAd = await env.DB.prepare("SELECT * FROM ads WHERE type = 'sidebar' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    if (popupAd) adsData.popup = popupAd;
    if (sidebarAd) adsData.sidebar = sidebarAd;
    return json({ ok: true, config: cfg, announcement: ann || null, ads: adsData });
  }

  // ⚠️ [已废弃] 密码重置相关路由已迁移到 functions/api/auth/
  // 请使用 Pages Functions 路径：/api/auth/forgot-password 和 /api/auth/reset-password
  // 旧版使用 globalThis.__resetTokens (in-memory Map) 存在 Worker 冷启动丢失问题

  // ── Admin: Detailed Stats ─────────────────────
  if (path === '/api/admin/stats' && method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);

    const [totalUsers, totalOrders, approvedOrders, completedOrders, rejectedOrders, pendingOrders,
           totalAccounts, onlineAccounts, completedAccounts, errorAccounts,
           totalRevenue, todayOrders, todayRevenue, weeklyOrders] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM orders').first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='approved'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='completed'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='rejected'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='pending'").first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM game_accounts').first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('farming','active')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status='completed'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('error','failed')").first(),
      env.DB.prepare("SELECT COALESCE(SUM(bonus_points), 0) as total FROM orders WHERE status IN ('approved','completed')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at >= datetime('now', '-1 day')").first(),
      env.DB.prepare("SELECT COALESCE(SUM(bonus_points), 0) as total FROM orders WHERE created_at >= datetime('now', '-1 day') AND status IN ('approved','completed')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at >= datetime('now', '-7 days')").first(),
    ]);

    // Level distribution
    const levelDist = await env.DB.prepare(
      "SELECT level, COUNT(*) as cnt FROM users GROUP BY level ORDER BY level"
    ).all();

    // Order status distribution for chart
    const orderStatusDist = await env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM orders GROUP BY status"
    ).all();

    // Account status distribution
    const accountStatusDist = await env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM game_accounts GROUP BY status"
    ).all();

    // Top users by spending
    const topSpenders = await env.DB.prepare(
      "SELECT id, username, display_name, total_spent, total_orders, level FROM users WHERE total_spent > 0 ORDER BY total_spent DESC LIMIT 5"
    ).all();

    // Recent 7-day order trend
    const dailyTrend = await env.DB.prepare(
      "SELECT date(created_at) as day, COUNT(*) as cnt, COALESCE(SUM(price), 0) as revenue FROM orders WHERE created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day"
    ).all();

    return json({
      ok: true,
      stats: {
        total_users: totalUsers.cnt,
        total_orders: totalOrders.cnt,
        approved_orders: approvedOrders.cnt,
        completed_orders: completedOrders.cnt,
        rejected_orders: rejectedOrders.cnt,
        pending_orders: pendingOrders.cnt,
        total_accounts: totalAccounts.cnt,
        online_accounts: onlineAccounts.cnt,
        completed_accounts: completedAccounts.cnt,
        error_accounts: errorAccounts.cnt,
        total_revenue: totalRevenue.total || 0,
        today_orders: todayOrders.cnt,
        today_revenue: todayRevenue.total || 0,
        weekly_orders: weeklyOrders.cnt,
        level_distribution: levelDist.results,
        order_status_distribution: orderStatusDist.results,
        account_status_distribution: accountStatusDist.results,
        top_spenders: topSpenders.results,
        daily_trend: dailyTrend.results,
      },
    });
  }

  return json({ error: 'Not found' }, 404);
}

// ─── Bot Logic ────────────────────────────────────────
async function getBotAnswer(question, env, user) {
  const q = question.toLowerCase().trim();

  const orderInfo = await env.DB.prepare(
    "SELECT id, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
  ).bind(user.id).all();

  if (q.includes('订单') || q.includes('工单') || q.includes('状态') || q.includes('审核')) {
    if (!orderInfo.results.length) return '您还没有提交过工单哦~\n前往控制台提交工单即可开始。';
    let reply = '📋 您的工单状态：\n';
    for (const o of orderInfo.results) {
      const statusMap = { pending: '⏳ 审核中', approved: '✅ 已通过', rejected: '❌ 已拒绝', completed: '🎉 已完成' };
      const estMap = { pending: '等待审核', approved: '处理中', rejected: '已拒绝', completed: '已完成' };
      reply += `  #${o.id} ${statusMap[o.status] || o.status} (${estMap[o.status] || ''})\n`;
    }
    return reply + '\n💡 发送 "订单 #编号" 查看详情';
  }

  if (/订单\s*#?\d+/.test(q)) {
    const match = q.match(/订单\s*#?(\d+)/);
    if (match) {
      const detail = await env.DB.prepare(
        'SELECT * FROM orders WHERE id = ? AND user_id = ?'
      ).bind(match[1], user.id).first();
      if (detail) {
        return `📦 工单 #${detail.id}\n邀请码: ${detail.invite_code}\n金额: ¥${detail.price}\n支付: ${detail.payment_method === 'wechat' ? '微信' : '灵石'}\n状态: ${detail.status}\n优惠: ${detail.discount}%\n预计完成: ${detail.est_complete_date || '审核中'}\n创建: ${detail.created_at}`;
      }
      return '未找到该工单';
    }
  }

  if (q.includes('多久') || q.includes('到账') || q.includes('时间') || q.includes('等待')) {
    const estDays = 5;
    if (orderInfo.results.length > 0) {
      const pendingCount = orderInfo.results.filter(o => o.status === 'pending' || o.status === 'approved').length;
      if (pendingCount > 0) {
        return `⏱ 预计 ${estDays} 天内完成处理。\n您有 ${pendingCount} 个进行中的工单，审核通过后自动进入处理流程。`;
      }
    }
    return `⏱ 工单审核通过后，预计 ${estDays} 天内完成账号注册和升级。如果超过时间请联系管理员。`;
  }

  if (q.includes('价格') || q.includes('多少钱') || q.includes('积分') || q.includes('收费')) {
    let reply = '💰 价格说明：\n';
    reply += '▸ 微信支付：1元 = 120邀请积分\n';
    reply += '▸ 灵石支付：100万灵石 = 10邀请积分\n';
    reply += '▸ 等级折扣：最高Lv.10 享70%优惠\n';
    reply += '▸ 优惠码可叠加使用\n';
    reply += '\n💡 等级越高越优惠，快去完成工单提升等级吧！';
    return reply;
  }

  if (q.includes('优惠') || q.includes('折扣') || q.includes('等级') || q.includes('会员')) {
    return '📊 用户等级权益：\n' +
      'Lv.1 基础价格\n' +
      'Lv.2 解锁邀请系统\n' +
      'Lv.3 享10%优惠\n' +
      'Lv.4 享20%优惠\n' +
      'Lv.5 享30%优惠\n' +
      'Lv.6 享40%优惠\n' +
      'Lv.7 享45%优惠\n' +
      'Lv.8 享50%优惠\n' +
      'Lv.9 享60%优惠\n' +
      'Lv.10 享70%优惠\n\n' +
      `您当前等级: Lv.${user.level || 1}\n` +
      '每完成一单提升一级！';
  }

  if (q.includes('邀请') || q.includes('分成') || q.includes('佣金') || q.includes('推广')) {
    return '🤝 邀请系统：\n' +
      '▸ 在邀请页面生成你的专属邀请码\n' +
      '▸ 分享给好友注册时填写\n' +
      '▸ 好友订单审核通过后，你获得订单金额30%邀请积分\n' +
      '▸ 邀请积分可提现或消费\n\n' +
      `您的邀请码: ${user.invite_code || '前往控制台查看'}\n` +
      `积分余额: ${(user.invite_points || 0).toFixed(1)}`;
  }

  if (q.includes('账号') || q.includes('游戏') || q.includes('角色')) {
    const accCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE o.user_id = ?'
    ).bind(user.id).first();
    if (accCount.cnt > 0) {
      return `您共有 ${accCount.cnt} 个游戏账号。前往「账号列表」查看详细等级、装备和地图信息。`;
    }
    return '您还没有游戏账号，提交工单审核通过后会自动创建。';
  }

  if (q.includes('售后') || q.includes('申诉') || q.includes('退款') || q.includes('投诉')) {
    return '如需售后或申诉：\n' +
      '1. 在控制台「申诉售后」页面提交申诉\n' +
      '2. 填写相关工单编号和问题描述\n' +
      '3. 管理员会在24小时内回复\n\n' +
      '紧急情况请联系管理员直接处理。';
  }

  if (q.includes('你好') || q.includes('嗨') || q.includes('在吗') || q.includes('hello')) {
    let name = user.username || '道友';
    return `你好 ${name}！我是艾德尔工单助手 🤖\n` +
      '你可以问我：\n' +
      '▸ "我的订单状态" - 查看工单\n' +
      '▸ "价格说明" - 了解收费\n' +
      '▸ "优惠折扣" - 查看等级优惠\n' +
      '▸ "邀请分成" - 邀请好友赚钱\n' +
      '▸ "预计多久" - 到账时间\n' +
      '▸ "怎么申诉" - 售后流程\n' +
      '▸ "订单 #1" - 查看订单详情';
  }

  if (q.includes('帮助') || q.includes('功能') || q.includes('能做什么')) {
    return '🤖 我可以回答这些问题：\n' +
      '1. 查看工单状态\n' +
      '2. 查询价格和积分\n' +
      '3. 了解等级折扣\n' +
      '4. 邀请分成说明\n' +
      '5. 预计到账时间\n' +
      '6. 售后申诉流程\n' +
      '7. 查看游戏账号信息\n\n' +
      '直接输入问题即可~';
  }

  const orderCount = orderInfo.results.length;
  const pendingOrders = orderInfo.results.filter(o => o.status === 'pending').length;
  return '抱歉，不太理解您的问题 🤔\n\n' +
    `您有 ${orderCount} 个工单，其中 ${pendingOrders} 个待审核。\n\n` +
    '试试问：\n- "我的订单状态"\n- "价格说明"\n- "优惠折扣"\n- "邀请分成"\n- "预计多久到账"';
}


