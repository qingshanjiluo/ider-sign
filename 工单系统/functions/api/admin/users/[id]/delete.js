// functions/api/admin/users/[id]/delete.js — DELETE /api/admin/users/:id/delete
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'DELETE') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(params.id);
    if (targetId === admin.id) return json({ error: '不能删除自己' }, 400);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
    return json({ ok: true, message: '用户已删除' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
