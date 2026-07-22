// POST /api/auth/forgot-password — 忘记密码，生成重置码
// 使用 D1 数据库存储重置 Token，解决多实例冷启动问题
import { json, generateToken } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 只处理 POST
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { username, email } = body;

  if (!username) return json({ error: '请输入用户名' }, 400);

  // 查找用户
  const user = await env.DB.prepare(
    'SELECT id, username, email FROM users WHERE username = ?'
  ).bind(username).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  // 如果提供了邮箱，验证是否匹配
  if (email && user.email && user.email !== email) {
    return json({ error: '邮箱与账号不匹配' }, 400);
  }

  // 生成重置 token（15分钟有效期）
  const token = generateToken();
  const expiresAt = Date.now() + 15 * 60 * 1000;

  // 存储到 D1 数据库（替代全局 Map）
  await env.DB.prepare(
    'INSERT OR REPLACE INTO reset_tokens (token, user_id, username, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.id, user.username, expiresAt).run();

  // 清理已过期的 token
  await env.DB.prepare(
    'DELETE FROM reset_tokens WHERE expires_at < ?'
  ).bind(Date.now()).run();

  // 安全: 不在响应中暴露 token，仅存入数据库
  // 前端应通过重置页面输入用户名+重置码来重设密码
  return json({
    ok: true,
    message: '重置码已生成，请使用重置码重设密码（有效期15分钟）',
    expires_in: 900,
  });
}
