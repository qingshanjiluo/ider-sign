// functions/api/admin/users/[id]/reset-password.js — POST /api/admin/users/:id/reset-password
// 重置密码后自动清除所有 session，强制用户重新登录
import { json, hashPassword } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);
    const targetId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { new_password } = body;
    if (!new_password || new_password.length < 6) return json({ error: '密码至少6位' }, 400);
    const hash = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, targetId).run();
    // 清除所有旧 session，强制重新登录
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
    return json({ ok: true, message: '密码已重置，用户需重新登录' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
