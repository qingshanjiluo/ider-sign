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
    
    // 支持批量保存：{ configs: [{ key, value }, ...] }
    if (body.configs && Array.isArray(body.configs)) {
      const results = [];
      for (const item of body.configs) {
        if (item.key && item.value !== undefined) {
          await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(item.key, String(item.value)).run();
          results.push(item.key);
        }
      }
      return json({ ok: true, saved: results });
    }
    
    // 单条保存：{ key, value }
    const { key, value } = body;
    if (!key || value === undefined) return json({ error: '参数不全' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
