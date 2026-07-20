// functions/api/gh/active-accounts.js — GET /api/gh/active-accounts
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const accounts = await env.DB.prepare(
      "SELECT ga.*, o.user_id, o.invite_code FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE ga.status IN ('farming', 'active', 'registering') AND (ga.stop_monitor_at IS NULL OR ga.stop_monitor_at > datetime('now')) LIMIT 200"
    ).all();
    return json({ ok: true, accounts: accounts.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
