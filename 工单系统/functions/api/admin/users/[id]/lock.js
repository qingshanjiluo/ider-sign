// functions/api/admin/users/[id]/lock.js — POST /api/admin/users/:id/lock
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { locked } = body;
    await env.DB.prepare('UPDATE users SET locked = ? WHERE id = ?').bind(locked ? 1 : 0, targetId).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
