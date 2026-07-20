// functions/api/accounts/[id].js — GET /api/accounts/:id
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const account = await env.DB.prepare(
      'SELECT ga.*, o.status as order_status, o.user_id as order_user_id FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.id = ?'
    ).bind(parseInt(params.id)).first();
    if (!account) return json({ error: '账号不存在' }, 404);
    if (account.order_user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);
    return json({ ok: true, account });
  }

  return json({ error: 'Method not allowed' }, 405);
}
