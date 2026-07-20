// functions/api/admin/accounts.js — GET /api/admin/accounts
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT ga.*, o.user_id as order_user_id, u.username as user_name FROM game_accounts ga JOIN orders o ON ga.order_id = o.id JOIN users u ON o.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE ga.status = ?'; params.push(status); }
    query += ' ORDER BY ga.id DESC LIMIT 100';
    const accounts = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, accounts: accounts.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
