// functions/api/admin/market-orders/index.js — 管理员查看/管理黑市订单
import { json } from '../../../_utils.js';
import { authenticateAdmin } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticateAdmin(request, env);
  if (!user) return json({ error: '未登录或无权限' }, 401);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    let sql = "SELECT mo.*, u.username as creator_name, ub.username as buyer_name, us.username as seller_name FROM market_orders mo LEFT JOIN users u ON mo.user_id = u.id LEFT JOIN users ub ON mo.buyer_id = ub.id LEFT JOIN users us ON mo.seller_id = us.id";
    const params = [];
    if (status) {
      sql += " WHERE mo.status = ?";
      params.push(status);
    }
    sql += " ORDER BY mo.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = await env.DB.prepare(sql).bind(...params).all();

    // Get total count
    let countSql = "SELECT COUNT(*) as total FROM market_orders";
    const countParams = [];
    if (status) {
      countSql += " WHERE status = ?";
      countParams.push(status);
    }
    const countResult = await env.DB.prepare(countSql).bind(...countParams).first();

    return json({
      ok: true,
      orders: rows.results || [],
      total: countResult?.total || 0,
      page,
      limit,
    });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { order_id, action, notes } = body;
    if (!order_id || !action) return json({ error: '缺少参数' }, 400);

    const order = await env.DB.prepare('SELECT * FROM market_orders WHERE id = ?').bind(order_id).first();
    if (!order) return json({ error: '订单不存在' }, 404);

    if (action === 'admin-ship') {
      // 管理员代发货
      if (order.status !== 'pending') return json({ error: '订单状态不正确' }, 400);
      await env.DB.prepare(
        "UPDATE market_orders SET status = 'shipped', seller_id = CASE WHEN seller_id IS NULL THEN ? ELSE seller_id END, updated_at = datetime('now') WHERE id = ?"
      ).bind(user.id, order_id).run();
      if (order.buyer_id) {
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '订单已发货（管理员代发）', '您的订单「' || ? || '」管理员已代发货，请确认收货', 'order')"
        ).bind(order.buyer_id, order.title).run();
      }
      return json({ ok: true, message: '已代发货' });
    }

    if (action === 'admin-cancel') {
      // 管理员取消
      if (order.status === 'completed') return json({ error: '已完成订单不能取消' }, 400);
      if (order.type === 'buy' && order.status === 'pending') {
        const refund = order.price_coins * order.quantity;
        await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(refund, order.user_id).run();
      }
      await env.DB.prepare(
        "UPDATE market_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
      ).bind(order_id).run();
      return json({ ok: true, message: '已取消订单' });
    }

    if (action === 'admin-delete') {
      // 管理员删除黑市订单
      if (order.type === 'buy' && order.status === 'pending') {
        // 退还冻结的修仙币
        const refund = order.price_coins * order.quantity;
        await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(refund, order.user_id).run();
      }
      await env.DB.prepare("DELETE FROM market_orders WHERE id = ?").bind(order_id).run();
      return json({ ok: true, message: '已删除订单' });
    }

    return json({ error: '不支持的操作' }, 400);
  }

  return json({ error: 'Method not allowed' }, 405);
}
