// functions/api/user/profile.js — PUT /api/user/profile
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { email, avatar_url, display_name, bio } = body;
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
      await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email || '', user.id).run();
    }
    if (avatar_url !== undefined) {
      if (avatar_url.length > 500) return json({ error: '头像URL过长' }, 400);
      await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
    }
    if (display_name !== undefined) {
      if (display_name.length > 30) return json({ error: '显示名过长' }, 400);
      await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(display_name, user.id).run();
    }
    if (bio !== undefined) {
      if (bio.length > 200) return json({ error: '简介过长' }, 400);
      await env.DB.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    }
    return json({ ok: true, message: '资料已更新' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
