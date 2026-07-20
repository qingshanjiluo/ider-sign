// functions/api/admin/appeals/[id]/reply.js — POST /api/admin/appeals/:id/reply
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const appealId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { reply, status } = body;
    await env.DB.prepare(
      "UPDATE appeals SET admin_reply = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(reply || '', status || 'resolved', appealId).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
