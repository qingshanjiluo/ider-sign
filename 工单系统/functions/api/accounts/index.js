// functions/api/accounts/index.js — GET /api/accounts
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const url = new URL(request.url);
    const orderId = url.searchParams.get('order_id') || '';
    let query = 'SELECT ga.*, o.status as order_status, o.invite_code FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE o.user_id = ?';
    const params = [user.id];
    if (orderId) { query += ' AND ga.order_id = ?'; params.push(orderId); }
    const accounts = await env.DB.prepare(query + ' ORDER BY ga.id DESC').bind(...params).all();
    return json({ ok: true, accounts: accounts.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
