// functions/api/admin/users/[id]/admin.js — POST /api/admin/users/:id/admin
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { is_admin } = body;
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(is_admin ? 1 : 0, targetId).run();
    return json({ ok: true, message: is_admin ? '已提升为管理员' : '已取消管理员' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
