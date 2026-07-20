// POST /api/auth/login — 用户登录（支持旧 SHA-256 自动升级到 PBKDF2）
import { json, hashPassword, verifyPassword, isLegacyHash, generateToken } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 只处理 POST
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || !password) return json({ error: '参数不全' }, 400);

  // 查找用户
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, level, locked, is_admin, display_name, role, bonus_points FROM users WHERE username = ?'
  ).bind(username).first();
  if (!user) return json({ error: '用户不存在' }, 404);
  if (user.locked) return json({ error: '账号已锁定' }, 403);

  // 验证密码（兼容旧 SHA-256 和新 PBKDF2）
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: '密码错误' }, 401);

  // 自动升级旧 SHA-256 哈希到新 PBKDF2（静默迁移）
  if (isLegacyHash(user.password_hash)) {
    const newHash = await hashPassword(password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(newHash, user.id).run();
  }

  // 生成 token（7天有效期）
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();

  // INSERT session
  await env.DB.prepare(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
  ).bind(user.id, token, expires).run();

  // 更新 last_login
  await env.DB.prepare(
    "UPDATE users SET last_login = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  return json({
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
      level: user.level,
      is_admin: user.is_admin,
      role: user.role || (user.is_admin ? 'admin' : 'user'),
      bonus_points: user.bonus_points || 0,
    },
  });
}
