// functions/api/admin/orders.js — GET /api/admin/orders
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 50;
    const offset = (page - 1) * limit;
    let query = 'SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE o.status = ?'; params.push(status); }
    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const orders = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, orders: orders.results, page, limit });
  }

  return json({ error: 'Method not allowed' }, 405);
}
