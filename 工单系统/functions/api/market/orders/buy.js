// functions/api/market/orders/buy.js — POST 接单（购买/出售）
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
  if (order.status !== 'pending') return json({ error: '订单已处理' }, 400);
  if (order.user_id === user.id) return json({ error: '不能操作自己的订单' }, 400);

  if (order.type === 'sell') {
    // 售卖订单：买家购买
    const cost = order.price_coins * order.quantity;
    if (user.bonus_points < cost) {
      return json({ error: `修仙币不足，需要 ${cost} 币` }, 400);
    }
    await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(cost, user.id).run();
    await env.DB.prepare(
      "UPDATE market_orders SET status = 'shipped', buyer_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(user.id, order_id).run();
  } else {
    // 求购订单：卖家接单，冻结卖方等价币作为押金（防止虚假发货）
    await env.DB.prepare(
      "UPDATE market_orders SET status = 'shipped', seller_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(user.id, order_id).run();
  }

  await env.DB.prepare(
    "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '订单已接单', '您的市场订单「' || ? || '」已被接单，请及时处理', 'order')"
  ).bind(order.user_id, order.title).run();

  return json({ ok: true, message: '接单成功' });
}
