// functions/api/admin/config.js — GET|POST /api/admin/config
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const configs = await env.DB.prepare('SELECT * FROM config').all();
    return json({ ok: true, config: configs.results });
  }

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const body = await request.json().catch(() => ({}));
    const { key, value } = body;
    if (!key || value === undefined) return json({ error: '参数不全' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
