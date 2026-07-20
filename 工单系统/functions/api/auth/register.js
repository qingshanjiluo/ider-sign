// POST /api/auth/register — 用户注册
import { json, hashPassword, getClientIP } from '../../_utils.js';
import { addXP } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 只处理 POST
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { username, password, email, invite_code } = body;

  // 参数验证
  if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
  if (username.length < 3 || username.length > 20) return json({ error: '用户名3-20字符' }, 400);
  if (password.length < 6) return json({ error: '密码至少6位' }, 400);

  // IP 检查（每IP仅限一个账号）
  const ip = getClientIP(request);
  const ipCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM users WHERE ip_address = ?'
  ).bind(ip).first();
  if (ipCount.cnt > 0) return json({ error: '该IP已注册过账号，每IP仅限一个账号' }, 403);

  // 用户名唯一性检查
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: '用户名已存在' }, 409);

  // 生成密码哈希和邀请码
  const hash = await hashPassword(password);
  const myInviteCode = 'IDR' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

  // 查找邀请人
  let inviterId = 0;
  if (invite_code) {
    const inviter = await env.DB.prepare('SELECT id FROM users WHERE invite_code = ?').bind(invite_code).first();
    if (inviter) inviterId = inviter.id;
  }

  // INSERT 用户
  await env.DB.prepare(
    "INSERT INTO users (username, password_hash, email, invite_code, invited_by, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(username, hash, email || '', myInviteCode, inviterId, ip).run();

  // 邀请人获得 50XP
  if (inviterId > 0) {
    await env.DB.prepare('UPDATE users SET total_invited = total_invited + 1 WHERE id = ?').bind(inviterId).run();
    await addXP(env, inviterId, 50, '成功邀请用户 ' + username);
  }

  return json({ ok: true, message: '注册成功' });
}
