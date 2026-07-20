// functions/api/accounts/[id]/logs.js — GET /api/accounts/:id/logs
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const aid = parseInt(params.id);
    const acc = await env.DB.prepare(
      'SELECT ga.*, o.user_id as order_user_id FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.id = ?'
    ).bind(aid).first();
    if (!acc) return json({ error: '账号不存在' }, 404);
    if (acc.order_user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);
    const logs = await env.DB.prepare(
      'SELECT * FROM account_logs WHERE account_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(aid).all();
    return json({ ok: true, logs: logs.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
