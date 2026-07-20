// functions/api/market/orders/confirm.js — POST 确认收货
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

const PLATFORM_FEE_RATE = 0.05; // 5% 平台抽成

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
  if (order.status !== 'shipped') return json({ error: '订单未发货' }, 400);

  // 只有买家才能确认收货
  if (order.buyer_id !== user.id) return json({ error: '只有买家可以确认收货' }, 400);

  const total = order.price_coins * order.quantity;
  const fee = Math.floor(total * PLATFORM_FEE_RATE);
  const sellerGets = total - fee;

  // 卖家获得修仙币（已扣平台抽成）
  await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(sellerGets, order.seller_id).run();
  await env.DB.prepare(
    "UPDATE market_orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?"
  ).bind(order_id).run();

  // 通知卖家
  await env.DB.prepare(
    "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '交易完成', '您的「' || ? || '」已成交，获得 ' || ? || ' 修仙币（含5%平台手续费）', 'commission')"
  ).bind(order.seller_id, order.title, sellerGets).run();

  return json({ ok: true, message: '确认收货成功', seller_gets: sellerGets, fee });
}
