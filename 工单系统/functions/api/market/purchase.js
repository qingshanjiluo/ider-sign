// functions/api/market/purchase.js — POST 官方市场购买
// 支持：多支付方式、审核流程、完成提示面板
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({}));
  const { item_id, quantity, payment_method, payment_account } = body;
  if (!item_id) return json({ error: '缺少商品ID' }, 400);

  const item = await env.DB.prepare('SELECT * FROM market_items WHERE id = ? AND enabled = 1').bind(item_id).first();
  if (!item) return json({ error: '商品不存在或已下架' }, 404);

  const qty = quantity || 1;
  if (qty < 1) return json({ error: '数量无效' }, 400);
  if (item.stock < qty) return json({ error: '库存不足' }, 400);

  // 支付方式校验
  const allowedMethods = (item.payment_methods || 'coin').split(',').map(s => s.trim());
  const method = payment_method || 'coin';
  if (!allowedMethods.includes(method)) {
    return json({ error: '该商品不支持此支付方式' }, 400);
  }

  const cost = item.price_coins * qty;

  // ── 修仙币支付：实时扣币 ──
  if (method === 'coin') {
    if (user.bonus_points < cost) {
      return json({ error: `修仙币不足，需要 ${cost} 币` }, 400);
    }
    await env.DB.prepare('UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?').bind(cost, user.id).run();
  }

  // 扣库存（无论支付方式都执行）
  await env.DB.prepare('UPDATE market_items SET stock = stock - ? WHERE id = ?').bind(qty, item_id).run();

  // 商品快照
  const snapshot = JSON.stringify({
    name: item.name, category: item.category, description: item.description,
    image_url: item.image_url, price_coins: item.price_coins,
  });

  // 创建购买记录
  const insertRes = await env.DB.prepare(
    "INSERT INTO market_purchases (item_id, user_id, item_name, quantity, price_coins, total_coins, payment_method, payment_account, snapshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(
    item_id, user.id, item.name, qty, item.price_coins, cost,
    method, payment_account || '', snapshot,
    item.need_review ? 'pending' : 'approved',
  ).run();

  const purchaseId = insertRes.meta?.last_row_id;

  if (!item.need_review) {
    // ── 无需审核：直接完成 ──
    await env.DB.prepare(
      "UPDATE market_purchases SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
    ).bind(purchaseId).run();

    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '购买成功', '您已成功购买「' || ? || '」x' || ? || '，花费 ' || ? || ' 修仙币', 'order')"
    ).bind(user.id, item.name, qty, cost).run();

    return json({
      ok: true, message: `购买成功，获得 ${item.name} x${qty}`,
      purchase_id: purchaseId, cost,
      need_review: false,
      complete_panel: item.complete_panel_enabled ? {
        title: item.complete_panel_title || '购买完成',
        description: item.complete_panel_desc || '感谢您的购买',
      } : null,
    });
  }

  // ── 需要审核：等待管理员审核 ──
  await env.DB.prepare(
    "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '购买申请已提交', '您已购买「' || ? || '」x' || ? || '，等待管理员审核', 'order')"
  ).bind(user.id, item.name, qty).run();

  return json({
    ok: true, message: '购买申请已提交，等待管理员审核',
    purchase_id: purchaseId, cost,
    need_review: true,
  });
}
