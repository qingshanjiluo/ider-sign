// functions/api/invite/withdraw.js — POST /api/invite/withdraw
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { points } = body;
    if (!points || points < 10) return json({ error: '最少提现10积分' }, 400);
    if ((user.invite_points || 0) < points) return json({ error: '积分不足' }, 400);
    await env.DB.prepare(
      'UPDATE users SET invite_points = invite_points - ? WHERE id = ?'
    ).bind(points, user.id).run();
    return json({ ok: true, message: '提现申请已提交，请联系管理员处理' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
