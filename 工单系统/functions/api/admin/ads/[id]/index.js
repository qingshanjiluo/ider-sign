// functions/api/admin/ads/[id].js — DELETE /api/admin/ads/:id
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'DELETE') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const id = parseInt(params.id);
    await env.DB.prepare('DELETE FROM ads WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
