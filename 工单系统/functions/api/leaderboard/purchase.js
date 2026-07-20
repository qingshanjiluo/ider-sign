// functions/api/leaderboard/purchase.js — GET /api/leaderboard/purchase
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, total_orders, total_spent, total_invited, xp, bio FROM users WHERE total_spent > 0 ORDER BY total_spent DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
