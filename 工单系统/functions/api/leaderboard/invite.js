// functions/api/leaderboard/invite.js — GET /api/leaderboard/invite
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, total_invited, xp, total_spent, bio FROM users WHERE total_invited > 0 ORDER BY total_invited DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
