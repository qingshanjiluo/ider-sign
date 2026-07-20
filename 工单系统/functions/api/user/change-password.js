// functions/api/user/change-password.js — POST /api/user/change-password
// 使用 verifyPassword 兼容旧 SHA-256 和新 PBKDF2
import { json, hashPassword, verifyPassword, isLegacyHash } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { old_password, new_password } = body;
    if (!old_password || !new_password) return json({ error: '请填写旧密码和新密码' }, 400);
    if (new_password.length < 6) return json({ error: '新密码至少6位' }, 400);
    if (new_password.length > 64) return json({ error: '新密码过长' }, 400);

    // 获取当前密码哈希
    const current = await env.DB.prepare(
      'SELECT password_hash FROM users WHERE id = ?'
    ).bind(user.id).first();
    if (!current) return json({ error: '用户不存在' }, 404);

    // 验证旧密码（兼容新旧格式）
    const valid = await verifyPassword(old_password, current.password_hash);
    if (!valid) return json({ error: '旧密码错误' }, 400);

    // 生成新 PBKDF2 哈希
    const newHash = await hashPassword(new_password);
    await env.DB.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).bind(newHash, user.id).run();

    // 强制清除该用户所有 session，要求重新登录
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

    return json({ ok: true, message: '密码修改成功，请重新登录' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
