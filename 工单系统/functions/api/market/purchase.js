// functions/api/market/purchase.js — POST 官方市场购买
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({}));
  const { item_id, quantity } = body;
  if (!item_id) return json({ error: '缺少商品ID' }, 400);

  const item = await env.DB.prepare('SELECT * FROM market_items WHERE id = ? AND enabled = 1').bind(item_id).first();
  if (!item) return json({ error: '商品不存在或已下架' }, 404);

  const qty = quantity || 1;
  if (qty < 1) return json({ error: '数量无效' }, 400);
  if (item.stock < qty) return json({ error: '库存不足' }, 400);

  const cost = item.price_coins * qty;
  if (user.bonus_points < cost) {
    return json({ error: `修仙币不足，需要 ${cost} 币` }, 400);
  }

  await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(cost, user.id).run();
  await env.DB.prepare('UPDATE market_items SET stock = stock - ? WHERE id = ?').bind(qty, item_id).run();

  await env.DB.prepare(
    "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '购买成功', '您已成功购买「' || ? || '」x' || ? || '，花费 ' || ? || ' 修仙币', 'order')"
  ).bind(user.id, item.name, qty, cost).run();

  return json({ ok: true, message: `购买成功，获得 ${item.name} x${qty}`, cost });
}
