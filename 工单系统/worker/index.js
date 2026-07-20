import { renderStaticAsset } from './static';

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

async function hashPassword(pw) {
  const encoder = new TextEncoder();
  const data = encoder.encode('ider:' + pw + ':order-system');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    'SELECT id, username, level, total_orders, total_spent, invite_code, invited_by, invite_points, commission_rate, email, is_admin, locked FROM users WHERE id = ?'
  ).bind(result.user_id).first();
  return user;
}

function authenticateApi(request, env) {
  const key = request.headers.get('X-API-Key') || '';
  return key === env.API_KEY;
}

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (path === '/' || path === '/index.html') {
      const asset = await renderStaticAsset('index.html', env);
      return html(asset);
    }
    if (path.startsWith('/public/')) {
      const asset = await renderStaticAsset(path.slice(1), env);
      if (asset) return new Response(asset, { headers: { ...CORS_HEADERS, 'Content-Type': getContentType(path) } });
      return json({ error: 'Not found' }, 404);
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

    return json({ ok: true, token, user: { id: user.id, username: user.username, level: user.level, is_admin: user.is_admin } });
  }

  // ── User Info ─────────────────────────────────────
  if (path === '/api/user/info' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    return json({ ok: true, user: { ...user, total_invited: totalInvited.cnt, password_hash: undefined } });
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

    const { invite_code, payment_method, payment_account, amount, coupon_code, bind_account_name, bind_invite_code, game_account_count } = body;
    if (!invite_code || !payment_method || !payment_account || !amount) {
      return json({ error: '请填写完整信息' }, 400);
    }
    if (!['wechat', 'spirit_stone'].includes(payment_method)) {
      return json({ error: '无效支付方式' }, 400);
    }

    let price = 0;
    let bonusPoints = 0;
    if (payment_method === 'wechat') {
      price = amount;
      bonusPoints = amount * 120;
    } else {
      price = amount * 1000000;
      bonusPoints = amount * 10;
    }

    let discount = 0;
    if (coupon_code) {
      const coupon = await env.DB.prepare(
        "SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now')) AND used_count < max_uses"
      ).bind(coupon_code).first();
      if (coupon) {
        discount = coupon.discount_percent;
        await env.DB.prepare(
          'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?'
        ).bind(coupon.id).run();
      }
    }

    const userLevel = user.level || 1;
    const levelDiscounts = { 1: 0, 2: 0, 3: 10, 4: 20, 5: 30, 6: 40, 7: 45, 8: 50, 9: 60, 10: 70 };
    const maxDiscount = Math.max(discount, levelDiscounts[userLevel] || 0);
    const finalPrice = price * (100 - maxDiscount) / 100;

    const accCount = game_account_count || Math.max(1, Math.ceil(bonusPoints / 120));
    const estDays = parseInt((await env.DB.prepare("SELECT value FROM config WHERE key='est_delivery_days'").first())?.value || '5');
    const estDate = new Date(Date.now() + estDays * 86400000).toISOString().split('T')[0];

    const result = await env.DB.prepare(
      "INSERT INTO orders (user_id, invite_code, payment_method, payment_account, amount, price, coupon_code, discount, bonus_points, bind_account_name, bind_invite_code, status, created_at, est_complete_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?)"
    ).bind(user.id, invite_code, payment_method, payment_account, amount, finalPrice, coupon_code || '', maxDiscount, bonusPoints, bind_account_name || '', bind_invite_code || '', estDate).run();

    // Send notification
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已提交', '工单 #' || ? || ' 已提交，等待管理员审核中', 'order')"
    ).bind(user.id, result.meta.last_row_id).run();

    return json({ ok: true, message: '工单已提交，等待审核', order_id: result.meta.last_row_id });
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
    const inviteEarnings = await env.DB.prepare(
      "SELECT COALESCE(SUM(o.price * 0.3), 0) as total FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = 'approved'"
    ).bind(user.id).first();
    return json({
      ok: true,
      invite_code: user.invite_code,
      total_invited: totalInvited.cnt,
      invite_orders: inviteOrders.cnt,
      invite_points: user.invite_points,
      invite_earnings: inviteEarnings.total,
      commission_rate: 30,
      invite_link: (request.headers.get('Host') || '') + '/?invite=' + user.invite_code,
    });
  }

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

    if (status === 'approved') {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      await env.DB.prepare(
        'UPDATE users SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?'
      ).bind(order.price, order.user_id).run();
      await recalcUserLevel(env, order.user_id);

      if (order.user_id) {
        const buyer = await env.DB.prepare('SELECT invited_by FROM users WHERE id = ?').bind(order.user_id).first();
        if (buyer && buyer.invited_by > 0) {
          const commission = order.price * 0.3;
          await env.DB.prepare(
            'UPDATE users SET invite_points = invite_points + ? WHERE id = ?'
          ).bind(commission, buyer.invited_by).run();
          await env.DB.prepare(
            "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '邀请分成到账', '下线成交获得 ' || ? || ' 邀请积分奖励', 'commission')"
          ).bind(buyer.invited_by, commission.toFixed(1)).run();
        }
      }

      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已通过', '工单 #' || ? || ' 已审核通过，正在处理中', 'order')"
      ).bind(order.user_id, orderId).run();
    } else if (status === 'rejected') {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单被拒绝', '工单 #' || ? || ' 被拒绝: ' || ?, 'order')"
      ).bind(order.user_id, orderId, admin_notes || '无原因').run();
    }

    return json({ ok: true, message: '状态已更新' });
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const users = await env.DB.prepare(
      "SELECT id, username, level, total_orders, total_spent, invite_code, invite_points, email, is_admin, locked, created_at, last_login FROM users ORDER BY id DESC"
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
    const { key, value } = body;
    if (!key || value === undefined) return json({ error: '参数不全' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    return json({ ok: true });
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
    return json({ ok: true, discount_percent: coupon.discount_percent, min_amount: coupon.min_amount });
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

async function recalcUserLevel(env, userId) {
  const user = await env.DB.prepare('SELECT total_orders FROM users WHERE id = ?').bind(userId).first();
  if (!user) return;
  const orders = user.total_orders || 0;
  const levelMap = [0, 0, 1, 3, 5, 10, 20, 35, 50, 75, 100];
  let newLevel = 1;
  for (let i = levelMap.length - 1; i >= 1; i--) {
    if (orders >= levelMap[i]) { newLevel = i; break; }
  }
  await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(newLevel, userId).run();
}
