// functions/api/admin/market/items.js — 管理官方市场商品
import { json } from '../../../_utils.js';
import { authenticateAdmin } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT * FROM market_items ORDER BY category, price_coins ASC"
    ).all();
    return json({ ok: true, items: rows.results || [] });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { name, category, description, image_url, price_coins, stock, enabled } = body;
    if (!name || price_coins === undefined) return json({ error: '缺少必要信息' }, 400);

    const result = await env.DB.prepare(
      "INSERT INTO market_items (name, category, description, image_url, price_coins, stock, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).bind(name, category || 'other', description || '', image_url || '', price_coins, stock || 0, enabled !== undefined ? (enabled ? 1 : 0) : 1, user.id).run();

    return json({ ok: true, message: '商品已创建', id: result.meta?.last_row_id });
  }

  return json({ error: 'Method not allowed' }, 405);
}
