// functions/api/market/orders/ship.js — POST 确认发货
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({}));
  const { order_id } = body;
  if (!order_id) return json({ error: '缺少订单ID' }, 400);

  const order = await env.DB.prepare('SELECT * FROM market_orders WHERE id = ?').bind(order_id).first();
  if (!order) return json({ error: '订单不存在' }, 404);
  if (order.status !== 'pending' && order.status !== 'shipped') return json({ error: '订单状态不正确' }, 400);

  // 卖家确认发货
  const sellerId = order.type === 'sell' ? order.user_id : order.seller_id;
  if (user.id !== sellerId) return json({ error: '只有卖家可以确认发货' }, 403);

  await env.DB.prepare(
    "UPDATE market_orders SET status = 'shipped', updated_at = datetime('now') WHERE id = ?"
  ).bind(order_id).run();

  // 通知买家
  if (order.buyer_id) {
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '订单已发货', '您的订单「' || ? || '」卖家已发货，请确认收货', 'order')"
    ).bind(order.buyer_id, order.title).run();
  }

  return json({ ok: true, message: '已确认发货' });
}
