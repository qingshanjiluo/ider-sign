// functions/api/market/orders/index.js — 黑市订单 CRUD
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method === 'GET') {
    // 全部公开订单（排除已完成的+cancelled）
    const rows = await env.DB.prepare(
      "SELECT mo.*, u.username as creator_name FROM market_orders mo LEFT JOIN users u ON mo.user_id = u.id WHERE mo.status IN ('pending', 'shipped') ORDER BY mo.created_at DESC LIMIT 50"
    ).all();
    return json({ ok: true, orders: rows.results || [] });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { type, title, category, quantity, price_coins, description, contact, image_url } = body;

    if (!type || !['buy', 'sell'].includes(type)) return json({ error: '类型为 buy 或 sell' }, 400);
    if (!title) return json({ error: '请输入标题' }, 400);
    if (title.length > 100) return json({ error: '标题最多100字符' }, 400);
    if (description && description.length > 500) return json({ error: '描述最多500字符' }, 400);
    if (contact && contact.length > 200) return json({ error: '联系方式最多200字符' }, 400);
    if (!price_coins || price_coins <= 0) return json({ error: '请输入有效价格' }, 400);

    const qty = quantity || 1;

    // 发布求购时预扣 coins（冻结）
    if (type === 'buy') {
      const cost = price_coins * qty;
      if (user.bonus_points < cost) {
        return json({ error: `修仙币不足，需要 ${cost} 币，当前 ${user.bonus_points} 币` }, 400);
      }
      await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(cost, user.id).run();
    }

    const result = await env.DB.prepare(
      "INSERT INTO market_orders (user_id, type, title, category, quantity, price_coins, description, contact, image_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, type, title, category || 'other', qty, price_coins, description || '', contact || '', image_url || '').run();

    return json({
      ok: true,
      message: type === 'buy' ? '求购已发布' : '售卖已发布',
      order_id: result.meta?.last_row_id,
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
