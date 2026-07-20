/**
 * 艾德尔工单系统 - Cloudflare Worker
 * 赛博朋克修仙工单平台 🏯⚡
 */

import { renderStaticAsset } from './static';

// ─── CORS ─────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
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

// ─── Password Hashing ─────────────────────────────────
async function hashPassword(pw) {
  const encoder = new TextEncoder();
  const data = encoder.encode('ider:' + pw + ':order-system');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Token ────────────────────────────────────────────
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Auth Middleware ──────────────────────────────────
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
    'SELECT id, username, level, total_orders, invite_code, invited_by, invite_points, commission_rate, email FROM users WHERE id = ?'
  ).bind(result.user_id).first();
  return user;
}

// ─── API Key Auth (for GitHub Actions) ───────────────
function authenticateApi(request, env) {
  const key = request.headers.get('X-API-Key') || '';
  return key === env.API_KEY;
}

// ─── Get Client IP ───────────────────────────────────
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

// ─── Main Router ─────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Serve static assets (HTML/CSS/JS)
    if (path === '/' || path === '/index.html') {
      const asset = await renderStaticAsset('index.html', env);
      return html(asset);
    }
    if (path.startsWith('/public/')) {
      const asset = await renderStaticAsset(path.slice(1), env);
      if (asset) return new Response(asset, { headers: { ...CORS_HEADERS, 'Content-Type': getContentType(path) } });
      return json({ error: 'Not found' }, 404);
    }

    // API Routes
    try {
      return await handleRoute(method, path, request, env);
    } catch (e) {
      return json({ error: e.message }, 500);
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

async function handleRoute(method, path, request, env) {
  const body = method === 'GET' ? null : await request.json().catch(() => ({}));

  // ── Auth ──────────────────────────────────────────
  if (path === '/api/auth/register' && method === 'POST') {
    const { username, password, email, invite_code } = body;
    if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
    if (username.length < 3 || username.length > 20) return json({ error: '用户名3-20字符' }, 400);
    if (password.length < 6) return json({ error: '密码至少6位' }, 400);

    // IP limit: 1 account per IP
    const ip = getClientIP(request);
    const ipCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE ip_address = ?'
    ).bind(ip).first();
    if (ipCount.cnt > 0) return json({ error: '该IP已注册过账号' }, 403);

    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();
    if (existing) return json({ error: '用户名已存在' }, 409);

    const hash = await hashPassword(password);
    const myInviteCode = 'IDR' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

    let inviterId = 0;
    if (invite_code) {
      const inviter = await env.DB.prepare(
        'SELECT id FROM users WHERE invite_code = ?'
      ).bind(invite_code).first();
      if (inviter) inviterId = inviter.id;
    }

    await env.DB.prepare(
      'INSERT INTO users (username, password_hash, email, invite_code, invited_by, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(username, hash, email || '', myInviteCode, inviterId, ip).run();

    return json({ ok: true, message: '注册成功' });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const { username, password } = body;
    if (!username || !password) return json({ error: '参数不全' }, 400);
    const user = await env.DB.prepare(
      'SELECT id, username, password_hash, level, locked FROM users WHERE username = ?'
    ).bind(username).first();
    if (!user) return json({ error: '用户不存在' }, 404);
    if (user.locked) return json({ error: '账号已锁定' }, 403);
    const hash = await hashPassword(password);
    if (user.password_hash !== hash) return json({ error: '密码错误' }, 401);

    const token = generateToken();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expires).run();
    await env.DB.prepare(
      "UPDATE users SET last_login = datetime('now') WHERE id = ?"
    ).bind(user.id).run();

    return json({ ok: true, token, user: { id: user.id, username: user.username, level: user.level } });
  }

  // ── User Info ─────────────────────────────────────
  if (path === '/api/user/info' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    return json({ ok: true, user });
  }

  // ── Orders ────────────────────────────────────────
  if (path === '/api/orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const orders = await env.DB.prepare(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    return json({ ok: true, orders: orders.results });
  }

  if (path === '/api/orders' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);

    const { invite_code, payment_method, payment_account, amount, coupon_code, bind_account_name, bind_invite_code } = body;
    if (!invite_code || !payment_method || !payment_account || !amount) {
      return json({ error: '请填写完整信息' }, 400);
    }
    if (!['wechat', 'spirit_stone'].includes(payment_method)) {
      return json({ error: '无效支付方式' }, 400);
    }

    // Calculate price
    let price = 0;
    let bonusPoints = 0;
    if (payment_method === 'wechat') {
      price = amount; // 1元 = 120积分
      bonusPoints = amount * 120;
    } else {
      price = amount * 1000000; // 100万灵石 = 10积分
      bonusPoints = amount;
    }

    // Apply coupon
    let discount = 0;
    if (coupon_code) {
      const coupon = await env.DB.prepare(
        'SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))'
      ).bind(coupon_code).first();
      if (coupon && coupon.used_count < coupon.max_uses) {
        discount = coupon.discount_percent;
        await env.DB.prepare(
          'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?'
        ).bind(coupon.id).run();
      }
    }

    // Apply user level discount
    const userLevel = user.level || 1;
    const levelDiscounts = { 1: 0, 2: 0, 3: 10, 4: 20, 5: 30, 6: 40, 7: 45, 8: 50, 9: 60, 10: 70 };
    const maxDiscount = Math.max(discount, levelDiscounts[userLevel] || 0);
    const finalPrice = price * (100 - maxDiscount) / 100;
    const finalPoints = bonusPoints;

    const result = await env.DB.prepare(
      "INSERT INTO orders (user_id, invite_code, payment_method, payment_account, amount, price, coupon_code, discount, bonus_points, bind_account_name, bind_invite_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, invite_code, payment_method, payment_account, amount, finalPrice, coupon_code || '', maxDiscount, finalPoints, bind_account_name || '', bind_invite_code || '').run();

    return json({ ok: true, message: '工单已提交，等待审核', order_id: result.meta.last_row_id });
  }

  // ── Admin: List Orders ─────────────────────────────
  if (path === '/api/admin/orders' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || user.level < 99) return json({ error: '无权限' }, 403);
    const status = url.searchParams.get('status') || '';
    let orders;
    if (status) {
      orders = await env.DB.prepare(
        'SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = ? ORDER BY o.created_at DESC'
      ).bind(status).all();
    } else {
      orders = await env.DB.prepare(
        'SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC'
      ).all();
    }
    return json({ ok: true, orders: orders.results });
  }

  // ── Admin: Update Order Status ─────────────────────
  if (path.match(/^\/api\/admin\/orders\/(\d+)\/status$/) && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || user.level < 99) return json({ error: '无权限' }, 403);
    const orderId = parseInt(path.match(/^\/api\/admin\/orders\/(\d+)\/status$/)[1]);
    const { status, admin_notes } = body;

    await env.DB.prepare(
      "UPDATE orders SET status = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(status, admin_notes || '', orderId).run();

    if (status === 'approved') {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();

      // Update user total orders and level
      await env.DB.prepare(
        'UPDATE users SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?'
      ).bind(order.price, order.user_id).run();

      // Recalculate user level
      await recalcUserLevel(env, order.user_id);

      // Commission for inviter
      if (order.user_id) {
        const buyer = await env.DB.prepare('SELECT invited_by FROM users WHERE id = ?').bind(order.user_id).first();
        if (buyer && buyer.invited_by > 0) {
          const commission = order.price * 0.3;
          await env.DB.prepare(
            'UPDATE users SET invite_points = invite_points + ? WHERE id = ?'
          ).bind(commission, buyer.invited_by).run();
        }
      }
    }

    return json({ ok: true, message: '状态已更新' });
  }

  // ── Admin: All Users ───────────────────────────────
  if (path === '/api/admin/users' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || user.level < 99) return json({ error: '无权限' }, 403);
    const users = await env.DB.prepare(
      'SELECT id, username, level, total_orders, total_spent, invite_code, invite_points, email, created_at, last_login, locked FROM users ORDER BY id DESC'
    ).all();
    return json({ ok: true, users: users.results });
  }

  // ── Game Accounts (for a user's order) ────────────
  if (path === '/api/accounts' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const orderId = url.searchParams.get('order_id') || '';
    let query = 'SELECT ga.* FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE o.user_id = ?';
    const params = [user.id];
    if (orderId) { query += ' AND ga.order_id = ?'; params.push(orderId); }
    const accounts = await env.DB.prepare(query + ' ORDER BY ga.id DESC').bind(...params).all();
    return json({ ok: true, accounts: accounts.results });
  }

  // ── Notifications ─────────────────────────────────
  if (path === '/api/notifications' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const notifs = await env.DB.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(user.id).all();
    return json({ ok: true, notifications: notifs.results });
  }

  if (path === '/api/notifications/read' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    await env.DB.prepare(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ?'
    ).bind(user.id).run();
    return json({ ok: true });
  }

  // ── Invite Info ───────────────────────────────────
  if (path === '/api/invite/info' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const myCode = user.invite_code;
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    const inviteOrders = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = \'approved\''
    ).bind(user.id).first();
    return json({ ok: true, invite_code: myCode, total_invited: totalInvited.cnt, invite_orders: inviteOrders.cnt, invite_points: user.invite_points, commission_rate: 30 });
  }

  if (path === '/api/invite/withdraw' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const { points } = body;
    if (!points || points < 10) return json({ error: '最少提现10积分' }, 400);
    if (user.invite_points < points) return json({ error: '积分不足' }, 400);
    await env.DB.prepare(
      'UPDATE users SET invite_points = invite_points - ? WHERE id = ?'
    ).bind(points, user.id).run();
    return json({ ok: true, message: '提现申请已提交，请联系管理员' });
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

  // ── API: GitHub Actions (requires X-API-Key) ──────
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
      await env.DB.prepare(
        "INSERT INTO game_accounts (order_id, username, password, server_username, server_password, status, created_at) VALUES (?, ?, ?, ?, ?, 'registering', datetime('now'))"
      ).bind(order_id, username, password, server_username || '', server_password || '').run();
    } else if (status === 'farming') {
      await env.DB.prepare(
        'UPDATE game_accounts SET status = ?, level = ?, map_id = ?, map_name = ?, skills = ?, techniques = ?, equipment = ?, is_farming = 1, last_check_at = datetime(\'now\') WHERE username = ? AND order_id = ?'
      ).bind(status, level || 0, map_id || 0, map_name || '', JSON.stringify(skills || []), JSON.stringify(techniques || []), JSON.stringify(equipment || []), username, order_id).run();
    } else if (status === 'completed') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, reached_120_at = datetime('now'), stop_monitor_at = datetime('now', '+2 days'), last_check_at = datetime('now') WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, username, order_id).run();
    } else {
      await env.DB.prepare(
        'UPDATE game_accounts SET status = ?, level = ?, error_msg = ?, last_check_at = datetime(\'now\') WHERE username = ? AND order_id = ?'
      ).bind(status, level || 0, error_msg || '', username, order_id).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/gh/complete-order' && method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const { order_id } = body;
    // Check all accounts for this order have completed
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM game_accounts WHERE order_id = ? AND status != 'completed' AND status != 'failed'"
    ).bind(order_id).first();
    if (pending.cnt === 0) {
      await env.DB.prepare(
        "UPDATE orders SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
      ).bind(order_id).run();
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
    return json({ ok: true, discount_percent: coupon.discount_percent });
  }

  // ── Config (pricing) ──────────────────────────────
  if (path === '/api/config' && method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM config').all();
    const cfg = {};
    for (const c of configs.results) cfg[c.key] = c.value;
    return json({ ok: true, config: cfg });
  }

  return json({ error: 'Not found' }, 404);
}

// ─── Bot Logic ────────────────────────────────────────
async function getBotAnswer(question, env, user) {
  const q = question.toLowerCase();

  // Check order status
  if (q.includes('订单') || q.includes('工单') || q.includes('状态')) {
    const orders = await env.DB.prepare(
      "SELECT id, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
    ).bind(user.id).all();
    if (!orders.results.length) return '您还没有提交过工单哦~';
    let reply = '您的工单状态：\n';
    for (const o of orders.results) {
      const statusMap = { pending: '⏳ 审核中', approved: '✅ 已通过', rejected: '❌ 已拒绝', completed: '🎉 已完成' };
      reply += `  #${o.id} ${statusMap[o.status] || o.status} (${o.created_at})\n`;
    }
    return reply;
  }

  if (q.includes('多久') || q.includes('到账') || q.includes('时间')) {
    return '工单审核通过后，预计 5 天内完成账号注册和升级。如果超过5天请联系管理员处理。';
  }

  if (q.includes('价格') || q.includes('多少钱') || q.includes('积分')) {
    return '💰 价格说明：\n1元 = 120邀请积分\n100万灵石 = 10邀请积分\n等级越高优惠越多，最高10级享70%折扣！';
  }

  if (q.includes('优惠') || q.includes('折扣') || q.includes('等级')) {
    return '📊 用户等级权益：\nLv.1 基础价\nLv.2 解锁邀请系统\nLv.3 享10%优惠\nLv.4 享20%优惠\nLv.5 享30%优惠\n...\nLv.10 享70%优惠\n每完成一单提升一级！';
  }

  if (q.includes('邀请') || q.includes('分成') || q.includes('佣金')) {
    return '🤝 邀请系统：\n生成你的邀请码分享给好友，好友成功下单后你可以获得该订单金额30%的邀请积分返还！邀请积分可提现。';
  }

  if (q.includes('售后') || q.includes('申诉') || q.includes('退款')) {
    return '如需售后或申诉，请联系管理员并提供工单编号。我们会在24小时内处理。';
  }

  if (q.includes('你好') || q.includes('嗨') || q.includes('在吗')) {
    return '你好！我是艾德尔工单助手 🤖\n你可以问我：\n- 我的工单状态\n- 价格和优惠\n- 邀请分成规则\n- 预计到账时间';
  }

  return '抱歉，我不太理解您的问题。您可以尝试：\n- "我的订单状态"\n- "价格说明"\n- "优惠折扣"\n- "邀请分成"\n- "售后申诉"';
}

// ─── Recalculate user level ──────────────────────────
async function recalcUserLevel(env, userId) {
  const user = await env.DB.prepare(
    'SELECT total_orders FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) return;
  const orders = user.total_orders || 0;
  // Lv.1 = 0, Lv.2 = 1, Lv.3 = 3, Lv.4 = 5, Lv.5 = 10, Lv.6 = 20, Lv.7 = 35, Lv.8 = 50, Lv.9 = 75, Lv.10 = 100
  const levelMap = [0, 0, 1, 3, 5, 10, 20, 35, 50, 75, 100];
  let newLevel = 1;
  for (let i = levelMap.length - 1; i >= 1; i--) {
    if (orders >= levelMap[i]) { newLevel = i; break; }
  }
  await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(newLevel, userId).run();
}
