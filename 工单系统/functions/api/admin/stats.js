// functions/api/admin/stats.js — GET /api/admin/stats
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const admin = await authenticate(request, env);
    if (!admin || !admin.is_admin) return json({ error: '无权限' }, 403);

    const [totalUsers, totalOrders, approvedOrders, completedOrders, rejectedOrders, pendingOrders,
           totalAccounts, onlineAccounts, completedAccounts, errorAccounts,
           totalRevenue, todayOrders, todayRevenue, weeklyOrders] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM orders').first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='approved'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='completed'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='rejected'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status='pending'").first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM game_accounts').first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('farming','active')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status='completed'").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM game_accounts WHERE status IN ('error','failed')").first(),
      env.DB.prepare("SELECT COALESCE(SUM(bonus_points), 0) as total FROM orders WHERE status IN ('approved','completed')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at >= datetime('now', '-1 day')").first(),
      env.DB.prepare("SELECT COALESCE(SUM(bonus_points), 0) as total FROM orders WHERE created_at >= datetime('now', '-1 day') AND status IN ('approved','completed')").first(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at >= datetime('now', '-7 days')").first(),
    ]);

    // Level distribution
    const levelDist = await env.DB.prepare(
      "SELECT level, COUNT(*) as cnt FROM users GROUP BY level ORDER BY level"
    ).all();

    // Order status distribution for chart
    const orderStatusDist = await env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM orders GROUP BY status"
    ).all();

    // Account status distribution
    const accountStatusDist = await env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM game_accounts GROUP BY status"
    ).all();

    // Top users by spending
    const topSpenders = await env.DB.prepare(
      "SELECT id, username, display_name, total_spent, total_orders, level FROM users WHERE total_spent > 0 ORDER BY total_spent DESC LIMIT 5"
    ).all();

    // Recent 7-day order trend
    const dailyTrend = await env.DB.prepare(
      "SELECT date(created_at) as day, COUNT(*) as cnt, COALESCE(SUM(bonus_points), 0) as revenue FROM orders WHERE created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day"
    ).all();

    return json({
      ok: true,
      stats: {
        total_users: totalUsers.cnt,
        total_orders: totalOrders.cnt,
        approved_orders: approvedOrders.cnt,
        completed_orders: completedOrders.cnt,
        rejected_orders: rejectedOrders.cnt,
        pending_orders: pendingOrders.cnt,
        total_accounts: totalAccounts.cnt,
        online_accounts: onlineAccounts.cnt,
        completed_accounts: completedAccounts.cnt,
        error_accounts: errorAccounts.cnt,
        total_revenue: totalRevenue.total || 0,
        today_orders: todayOrders.cnt,
        today_revenue: todayRevenue.total || 0,
        weekly_orders: weeklyOrders.cnt,
        level_distribution: levelDist.results,
        order_status_distribution: orderStatusDist.results,
        account_status_distribution: accountStatusDist.results,
        top_spenders: topSpenders.results,
        daily_trend: dailyTrend.results,
      },
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
