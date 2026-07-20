// functions/api/appeals/index.js — GET|POST /api/appeals
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const appeals = await env.DB.prepare(
      'SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    return json({ ok: true, appeals: appeals.results });
  }

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { order_id, title, content, type } = body;
    if (!title || !content) return json({ error: '请填写标题和内容' }, 400);
    await env.DB.prepare(
      "INSERT INTO appeals (user_id, order_id, title, content, type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, order_id || 0, title, content, type || 'appeal').run();
    return json({ ok: true, message: '申诉已提交' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
