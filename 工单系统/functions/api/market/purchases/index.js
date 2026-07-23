// functions/api/market/purchases/index.js — GET/POST 用户购买记录
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT * FROM market_purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.id).all();

    return json({ ok: true, purchases: rows.results || [] });
  }

  // POST /api/market/purchases — 标记完成面板已读
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { purchase_id } = body;
    if (!purchase_id) return json({ error: '缺少参数' }, 400);

    await env.DB.prepare(
      "UPDATE market_purchases SET panel_read = 1 WHERE id = ? AND user_id = ?"
    ).bind(purchase_id, user.id).run();

    return json({ ok: true, message: '已标记' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
