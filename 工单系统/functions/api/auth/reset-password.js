// POST /api/auth/reset-password — 使用重置码重设密码
// 使用 D1 数据库验证重置 Token（替代全局 Map）
import { json, hashPassword } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 只处理 POST
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { reset_token, new_password } = body;

  if (!reset_token || !new_password) return json({ error: '请填写重置码和新密码' }, 400);
  if (new_password.length < 6) return json({ error: '新密码至少6位' }, 400);

  // 从 D1 数据库查找重置 Token
  const data = await env.DB.prepare(
    'SELECT user_id, expires_at FROM reset_tokens WHERE token = ?'
  ).bind(reset_token).first();

  if (!data) return json({ error: '重置码无效或已过期' }, 404);

  // 检查过期
  if (Date.now() > data.expires_at) {
    await env.DB.prepare('DELETE FROM reset_tokens WHERE token = ?').bind(reset_token).run();
    return json({ error: '重置码已过期，请重新申请' }, 400);
  }

  // 更新密码哈希
  const hash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, data.user_id).run();

  // 删除已使用的 token
  await env.DB.prepare('DELETE FROM reset_tokens WHERE token = ?').bind(reset_token).run();

  // 清除该用户所有旧 session（强制重新登录）
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(data.user_id).run();

  return json({ ok: true, message: '密码重置成功，请重新登录' });
}
