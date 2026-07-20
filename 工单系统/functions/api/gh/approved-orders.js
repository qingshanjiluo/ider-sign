// functions/api/gh/approved-orders.js — GET /api/gh/approved-orders
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const orders = await env.DB.prepare(
      "SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = 'approved' ORDER BY o.id ASC"
    ).all();
    return json({ ok: true, orders: orders.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
