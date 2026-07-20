// functions/api/after-sales/[id]/reply.js — POST /api/after-sales/:id/reply
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const itemId = parseInt(params.id);
    const body = await request.json().catch(() => ({}));
    const { content } = body;
    if (!content) return json({ error: '请填写回复内容' }, 400);
    const item = await env.DB.prepare('SELECT * FROM appeals WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
    if (!item) return json({ error: '售后请求不存在' }, 404);
    const existing = item.admin_reply || '';
    await env.DB.prepare(
      "UPDATE appeals SET admin_reply = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(existing + '\n[用户回复] ' + content, itemId).run();
    return json({ ok: true, message: '已回复' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
