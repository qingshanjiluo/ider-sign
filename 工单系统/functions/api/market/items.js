// functions/api/market/items.js — GET /api/market/items (官方市场)
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT * FROM market_items WHERE enabled = 1 AND stock > 0 ORDER BY category, price_coins ASC"
    ).all();
    return json({ ok: true, items: rows.results || [] });
  }

  return json({ error: 'Method not allowed' }, 405);
}
