// functions/api/market/orders/cancel.js — POST 取消订单
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

  // 只有订单创建者或管理员可以取消
  if (order.user_id !== user.id && !['admin', 'super_admin'].includes(user.role)) {
    return json({ error: '无权取消此订单' }, 403);
  }
  if (order.status === 'completed') return json({ error: '已完成订单不能取消' }, 400);

  // 如果是求购订单且为pending，退还预扣币
  if (order.type === 'buy' && order.status === 'pending') {
    const refund = order.price_coins * order.quantity;
    await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(refund, order.user_id).run();
  }

  await env.DB.prepare(
    "UPDATE market_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
  ).bind(order_id).run();

  return json({ ok: true, message: '订单已取消' });
}
