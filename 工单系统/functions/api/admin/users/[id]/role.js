// POST /api/admin/users/[id]/role — 超管设置用户角色
import { json } from '../../../../_utils.js';
import { authenticateSuperAdmin } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 仅超级管理员可操作
  const { user, error } = await authenticateSuperAdmin(request, env);
  if (error) return json({ error }, 401);

  const userId = parseInt(params.id, 10);
  if (!userId) return json({ error: '无效的用户 ID' }, 400);

  const body = await request.json().catch(() => ({}));
  const { role } = body;

  if (!['user', 'admin', 'super_admin'].includes(role)) {
    return json({ error: '无效的角色值，必须为: user, admin, super_admin' }, 400);
  }

  const target = await env.DB.prepare(
    'SELECT id, username, role FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!target) return json({ error: '用户不存在' }, 404);

  // 更新角色
  await env.DB.prepare(
    'UPDATE users SET role = ?, is_admin = CASE WHEN ? IN (\'admin\', \'super_admin\') THEN 1 ELSE 0 END WHERE id = ?'
  ).bind(role, role, userId).run();

  return json({
    ok: true,
    user_id: userId,
    username: target.username,
    old_role: target.role || 'user',
    new_role: role,
  });
}
