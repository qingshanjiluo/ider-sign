// functions/api/admin/ads.js — GET|POST /api/admin/ads
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const ads = await env.DB.prepare('SELECT * FROM ads ORDER BY created_at DESC').all();
    return json({ ok: true, ads: ads.results });
  }

  if (request.method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const body = await request.json().catch(() => ({}));
    // 兼容前端格式：{ title, type, content, enabled }
    const type = body.type || 'popup';
    const title = body.title || '';
    const enabled = body.enabled !== undefined ? body.enabled : false;
    const content = body.content || body.image_url || '';
    if (!content) return json({ error: '请填写内容或图片链接' }, 400);
    await env.DB.prepare(
      "INSERT INTO ads (type, image_url, link_url, title, enabled, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind(type, content, body.link_url || '', title, enabled ? 1 : 0).run();
    return json({ ok: true, message: '广告已添加' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
