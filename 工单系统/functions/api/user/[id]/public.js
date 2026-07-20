// functions/api/user/[id]/public.js — GET /api/user/:id/public
import { json } from '../../../_utils.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'GET') {
    const uid = parseInt(params.id);
    const u = await env.DB.prepare(
      'SELECT id, username, display_name, level, total_orders, total_spent, invite_code, avatar_url, bio, created_at FROM users WHERE id = ?'
    ).bind(uid).first();
    if (!u) return json({ error: '用户不存在' }, 404);
    const totalInvited = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?').bind(uid).first();
    return json({ ok: true, user: { ...u, total_invited: totalInvited.cnt } });
  }

  return json({ error: 'Method not allowed' }, 405);
}
