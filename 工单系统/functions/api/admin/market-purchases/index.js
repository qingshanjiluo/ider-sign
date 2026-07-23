// functions/api/admin/market-purchases/index.js — GET/POST 管理官方商城购买记录
import { json } from '../../../_utils.js';
import { authenticateAdmin } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';

    let query = `SELECT mp.*, u.username as user_name, mi.name as item_name
      FROM market_purchases mp
      JOIN users u ON mp.user_id = u.id
      LEFT JOIN market_items mi ON mp.item_id = mi.id`;
    const params = [];

    if (status) {
      query += ' WHERE mp.status = ?';
      params.push(status);
    }

    query += ' ORDER BY mp.created_at DESC LIMIT 100';

    const rows = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, purchases: rows.results || [] });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { purchase_id, action, admin_notes } = body;

    if (!purchase_id || !action) return json({ error: '缺少参数' }, 400);

    const purchase = await env.DB.prepare('SELECT * FROM market_purchases WHERE id = ?').bind(purchase_id).first();
    if (!purchase) return json({ error: '购买记录不存在' }, 404);

    if (action === 'approve') {
      if (purchase.status !== 'pending') return json({ error: '该记录已处理' }, 400);

      // 扣库存（如果购买时没扣成功则补扣）
      const item = await env.DB.prepare('SELECT stock FROM market_items WHERE id = ?').bind(purchase.item_id).first();
      if (!item) return json({ error: '商品已不存在' }, 400);
      if (item.stock < purchase.quantity) {
        return json({ error: '库存不足，无法审核通过' }, 400);
      }
      await env.DB.prepare('UPDATE market_items SET stock = stock - ? WHERE id = ?').bind(purchase.quantity, purchase.item_id).run();

      // 标记完成
      await env.DB.prepare(
        "UPDATE market_purchases SET status = 'completed', admin_id = ?, admin_notes = ?, completed_at = datetime('now') WHERE id = ?"
      ).bind(user.id, admin_notes || '', purchase_id).run();

      // 通知
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '审核通过', '您的购买「' || ? || '」已审核通过', 'order')"
      ).bind(purchase.user_id, purchase.item_name).run();

      // 查商品详情看是否需要展示完成面板
      const fullItem = await env.DB.prepare(
        'SELECT complete_panel_enabled, complete_panel_title, complete_panel_desc FROM market_items WHERE id = ?'
      ).bind(purchase.item_id).first();

      return json({
        ok: true, message: '已审核通过',
        complete_panel: fullItem?.complete_panel_enabled ? {
          title: fullItem.complete_panel_title || '购买完成',
          description: fullItem.complete_panel_desc || '感谢您的购买',
        } : null,
      });
    }

    if (action === 'reject') {
      if (purchase.status !== 'pending') return json({ error: '该记录已处理' }, 400);

      // 退还修仙币（如果当时是coin支付的）
      if (purchase.payment_method === 'coin') {
        await env.DB.prepare(
          'UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?'
        ).bind(purchase.total_coins, purchase.user_id).run();
      }

      await env.DB.prepare(
        "UPDATE market_purchases SET status = 'rejected', admin_id = ?, admin_notes = ? WHERE id = ?"
      ).bind(user.id, admin_notes || '', purchase_id).run();

      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '审核未通过', '您的购买「' || ? || '」未通过审核' || CASE WHEN ? <> '' THEN '，原因: ' || ? ELSE '' END, 'order')"
      ).bind(purchase.user_id, purchase.item_name, admin_notes || '', admin_notes || '').run();

      return json({ ok: true, message: '已拒绝' });
    }

    if (action === 'complete') {
      // 管理员手动完成（适用于审核通过的后续操作）
      await env.DB.prepare(
        "UPDATE market_purchases SET status = 'completed', admin_id = ?, completed_at = datetime('now') WHERE id = ? AND status = 'approved'"
      ).bind(user.id, purchase_id).run();

      const fullItem = await env.DB.prepare(
        'SELECT complete_panel_enabled, complete_panel_title, complete_panel_desc FROM market_items WHERE id = ?'
      ).bind(purchase.item_id).first();

      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '已完成', '您的购买「' || ? || '」已完成处理', 'order')"
      ).bind(purchase.user_id, purchase.item_name).run();

      return json({
        ok: true, message: '已完成',
        complete_panel: fullItem?.complete_panel_enabled ? {
          title: fullItem.complete_panel_title || '购买完成',
          description: fullItem.complete_panel_desc || '感谢您的购买',
        } : null,
      });
    }

    return json({ error: '无效操作' }, 400);
  }

  return json({ error: 'Method not allowed' }, 405);
}
