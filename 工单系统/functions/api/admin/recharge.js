// functions/api/admin/recharge.js — 管理充值订单
import { json, generateRechargeCode } from '../../_utils.js';
import { authenticateAdmin } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  if (request.method === 'GET') {
    const status = new URL(request.url).searchParams.get('status') || '';
    let rows;
    if (status) {
      rows = await env.DB.prepare(
        "SELECT r.*, u.username FROM recharge_orders r LEFT JOIN users u ON r.user_id = u.id WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 50"
      ).bind(status).all();
    } else {
      rows = await env.DB.prepare(
        "SELECT r.*, u.username FROM recharge_orders r LEFT JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC LIMIT 50"
      ).all();
    }
    // 为已完成的订单查询关联的兑换码
    const results = [];
    for (const order of (rows.results || [])) {
      if (order.status === 'completed') {
        const rc = await env.DB.prepare(
          'SELECT code FROM recharge_codes WHERE recharge_order_id = ? LIMIT 1'
        ).bind(order.id).first();
        results.push({ ...order, redeem_code: rc ? rc.code : null });
      } else {
        results.push(order);
      }
    }
    return json({ ok: true, orders: results });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { order_id, action } = body; // action: 'approve' | 'reject'
    if (!order_id || !action) return json({ error: '缺少参数' }, 400);

    const order = await env.DB.prepare('SELECT * FROM recharge_orders WHERE id = ?').bind(order_id).first();
    if (!order) return json({ error: '订单不存在' }, 404);
    if (order.status !== 'pending') return json({ error: '订单已处理' }, 400);

    if (action === 'approve') {
      // 1. 增加用户修仙币
      await env.DB.prepare('UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?').bind(order.coins, order.user_id).run();
      await env.DB.prepare(
        "UPDATE recharge_orders SET status = 'completed', admin_id = ?, completed_at = datetime('now') WHERE id = ?"
      ).bind(user.id, order_id).run();

      // 2. 自动生成兑换码（唯一性重试机制）
      let code = '';
      let retries = 0;
      while (retries < 5) {
        code = generateRechargeCode();
        const exist = await env.DB.prepare('SELECT id FROM recharge_codes WHERE code = ?').bind(code).first();
        if (!exist) break;
        retries++;
      }
      await env.DB.prepare(
        'INSERT INTO recharge_codes (user_id, recharge_order_id, code, coins, status, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(order.user_id, order.id, code, order.coins, 'pending', user.id).run();

      // 3. 发送通知
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '兑换码已生成', '您的充值 ' || ? || ' 修仙币兑换码已生成：' || ? || '，请在坊市或充值页面输入兑换码激活', 'order')"
      ).bind(order.user_id, order.coins, code).run();
      return json({ ok: true, message: '充值已确认，兑换码已生成', code });
    } else {
      await env.DB.prepare(
        "UPDATE recharge_orders SET status = 'cancelled', admin_id = ? WHERE id = ?"
      ).bind(user.id, order_id).run();
      return json({ ok: true, message: '充值已拒绝' });
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
