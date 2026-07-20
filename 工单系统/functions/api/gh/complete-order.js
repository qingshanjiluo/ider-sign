// functions/api/gh/complete-order.js — POST /api/gh/complete-order
import { json, logActivity } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
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

  return json({ error: 'Method not allowed' }, 405);
}
