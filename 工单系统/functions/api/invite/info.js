// functions/api/invite/info.js — GET /api/invite/info
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';
import { getInviteBoost, INVITE_BOOST_TIERS, INVITE_PACKAGES } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const totalInvited = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE invited_by = ?'
    ).bind(user.id).first();
    const inviteOrders = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = 'approved'"
    ).bind(user.id).first();
    const inviteEarnings = await env.DB.prepare(
      "SELECT COALESCE(SUM(o.bonus_points), 0) as total FROM orders o JOIN users u ON o.user_id = u.id WHERE u.invited_by = ? AND o.status = 'approved'"
    ).bind(user.id).first();
    const totalPurchased = user.total_purchased_points || 0;
    const boost = getInviteBoost(totalPurchased);
    const nextTier = INVITE_BOOST_TIERS.find(t => t.mult > boost.mult);
    return json({
      ok: true,
      invite_code: user.invite_code,
      total_invited: totalInvited.cnt,
      invite_orders: inviteOrders.cnt,
      invite_points: user.invite_points,
      invite_earnings: inviteEarnings.total,
      commission_rate: boost.rate,
      base_rate: 30,
      boost_mult: boost.mult,
      boost_label: boost.label,
      total_purchased_points: totalPurchased,
      next_tier: nextTier ? { label: nextTier.label, need: nextTier.min - totalPurchased, rate: nextTier.rate } : null,
      packages: INVITE_PACKAGES,
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
