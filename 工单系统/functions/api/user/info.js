// functions/api/user/info.js — GET /api/user/info
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';
import { XP_LEVELS, getLevelTitle } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    const nextXP = XP_LEVELS[Math.min(user.level + 1, XP_LEVELS.length - 1)] || 0;
    const userData = { ...user, total_invited: totalInvited.cnt, xp_next: nextXP, password_hash: undefined };
    userData.level_title = getLevelTitle(user.level);
    return json({ ok: true, user: userData });
  }

  return json({ error: 'Method not allowed' }, 405);
}
