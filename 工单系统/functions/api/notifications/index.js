// functions/api/notifications/index.js — GET /api/notifications
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || '';
    let query = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [user.id];
    if (type) { query += ' AND type = ?'; params.push(type); }
    const notifs = await env.DB.prepare(query + ' ORDER BY created_at DESC LIMIT 50').bind(...params).all();
    const unreadCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0'
    ).bind(user.id).first();
    return json({ ok: true, notifications: notifs.results, unread: unreadCount.cnt });
  }

  return json({ error: 'Method not allowed' }, 405);
}
