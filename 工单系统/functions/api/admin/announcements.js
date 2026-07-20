// functions/api/admin/announcements.js — GET|POST /api/admin/announcements
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const anns = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
    return json({ ok: true, announcements: anns.results });
  }

  if (request.method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const body = await request.json().catch(() => ({}));
    const { content, enabled } = body;
    if (!content) return json({ error: '请输入公告内容' }, 400);
    await env.DB.prepare(
      "INSERT INTO announcements (content, enabled, created_at) VALUES (?, ?, datetime('now'))"
    ).bind(content, enabled !== false ? 1 : 0).run();
    return json({ ok: true, message: '公告已发布' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
