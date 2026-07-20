// functions/api/leaderboard/level.js — GET /api/leaderboard/level
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const users = await env.DB.prepare(
      "SELECT id, username, display_name, avatar_url, level, xp, total_orders, bio FROM users ORDER BY xp DESC LIMIT 50"
    ).all();
    return json({ ok: true, leaderboard: users.results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
