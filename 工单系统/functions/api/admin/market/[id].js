// functions/api/admin/market/[id].js — PUT/DELETE 管理单个商品
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user || !['admin', 'super_admin'].includes(user.role)) return json({ error: '无权限' }, 403);

  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const id = parseInt(segments[segments.length - 1]);
  if (!id) return json({ error: '无效ID' }, 400);

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const {
      name, category, description, image_url, price_coins, stock, enabled,
      payment_methods, need_review,
      complete_panel_enabled, complete_panel_title, complete_panel_desc,
    } = body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (image_url !== undefined) { updates.push('image_url = ?'); params.push(image_url); }
    if (price_coins !== undefined) { updates.push('price_coins = ?'); params.push(price_coins); }
    if (stock !== undefined) { updates.push('stock = ?'); params.push(stock); }
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (payment_methods !== undefined) { updates.push('payment_methods = ?'); params.push(payment_methods); }
    if (need_review !== undefined) { updates.push('need_review = ?'); params.push(need_review ? 1 : 0); }
    if (complete_panel_enabled !== undefined) { updates.push('complete_panel_enabled = ?'); params.push(complete_panel_enabled ? 1 : 0); }
    if (complete_panel_title !== undefined) { updates.push('complete_panel_title = ?'); params.push(complete_panel_title); }
    if (complete_panel_desc !== undefined) { updates.push('complete_panel_desc = ?'); params.push(complete_panel_desc); }
    if (updates.length === 0) return json({ error: '没有要更新的字段' }, 400);

    updates.push("updated_at = datetime('now')");
    params.push(id);

    await env.DB.prepare(
      `UPDATE market_items SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();

    return json({ ok: true, message: '商品已更新' });
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM market_items WHERE id = ?').bind(id).run();
    return json({ ok: true, message: '商品已删除' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
