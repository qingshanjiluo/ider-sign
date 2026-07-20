// functions/api/admin/users/[id]/level.js — POST /api/admin/users/:id/level
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { level } = body;
    if (!level || level < 1 || level > 10) return json({ error: '等级需在1-10之间' }, 400);
    await env.DB.prepare('UPDATE users SET level = ? WHERE id = ?').bind(level, targetId).run();
    return json({ ok: true, message: '等级已更新' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
