// functions/api/admin/appeals.js — GET /api/admin/appeals
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    let query = 'SELECT a.*, u.username as user_name FROM appeals a JOIN users u ON a.user_id = u.id';
    const params = [];
    if (status) { query += ' WHERE a.status = ?'; params.push(status); }
    query += ' ORDER BY a.created_at DESC';
    const appeals = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, appeals: appeals.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
