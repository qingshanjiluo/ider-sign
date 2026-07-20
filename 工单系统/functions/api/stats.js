// functions/api/stats.js — GET /api/stats
import { json } from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const totalUsers = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
    const totalOrders = await env.DB.prepare('SELECT COUNT(*) as cnt FROM orders').first();
    const totalApproved = await env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='approved'").first();
    const totalCompleted = await env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='completed'").first();
    const totalAccounts = await env.DB.prepare('SELECT COUNT(*) as cnt FROM game_accounts').first();
    const onlineAccounts = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('farming','active')"
    ).first();
    return json({
      ok: true,
      stats: {
        total_users: totalUsers.cnt,
        total_orders: totalOrders.cnt,
        approved_orders: totalApproved.cnt,
        completed_orders: totalCompleted.cnt,
        total_accounts: totalAccounts.cnt,
        online_accounts: onlineAccounts.cnt,
      },
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
