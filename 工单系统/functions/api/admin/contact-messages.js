// GET /api/admin/contact-messages — 管理员查看联系留言
import { json } from '../../_utils.js';
import { authenticateAdmin } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 校验管理员身份
  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 401);

  const url = new URL(request.url);
  const markRead = url.searchParams.get('mark_read');

  // 如果传了 mark_read=id ，将该留言标记为已读
  if (markRead && request.method === 'POST') {
    await env.DB.prepare(
      'UPDATE contact_messages SET is_read = 1 WHERE id = ?'
    ).bind(Number(markRead)).run();
    return json({ ok: true });
  }

  // 获取留言列表
  const messages = await env.DB.prepare(
    'SELECT id, user_id, name, email, content, is_read, created_at FROM contact_messages ORDER BY is_read ASC, created_at DESC'
  ).all();

  return json({
    ok: true,
    messages: messages.results || [],
  });
}
