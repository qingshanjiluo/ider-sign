// POST /api/contact — 联系站长留言（公开，无需登录）
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { name, email, content } = body;

  if (!name || !content) {
    return json({ error: '请填写姓名和留言内容' }, 400);
  }

  if (content.length < 2 || content.length > 2000) {
    return json({ error: '留言内容长度在2-2000字之间' }, 400);
  }

  // 尝试获取当前用户（可选登录，不强制）
  let userId = 0;
  try {
    const user = await authenticate(request, env);
    if (user) userId = user.id;
  } catch { /* ignore */ }

  await env.DB.prepare(
    'INSERT INTO contact_messages (user_id, name, email, content) VALUES (?, ?, ?, ?)'
  ).bind(userId, name, email || '', content).run();

  return json({
    ok: true,
    message: '留言已提交，站长会尽快回复您',
  });
}
