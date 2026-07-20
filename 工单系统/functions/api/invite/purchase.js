// functions/api/invite/purchase.js — POST /api/invite/purchase
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';
import { CASH_PACKAGES, SPIRIT_STONE_PACKAGES } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { package_id, payment_method, payment_account } = body;
    if (!package_id || !payment_method || !payment_account) return json({ error: '请填写完整信息' }, 400);

    // 从现金套餐或灵石套餐中查找
    const allPackages = [...CASH_PACKAGES, ...SPIRIT_STONE_PACKAGES];
    const pkg = allPackages.find(p => p.id === package_id);
    if (!pkg) return json({ error: '无效套餐' }, 400);
    if (!['wechat', 'spirit_stone'].includes(payment_method)) return json({ error: '无效支付方式' }, 400);

    // 现金套餐只能用 wechat 支付，灵石套餐只能用 spirit_stone 支付
    if (pkg.currency === 'cash' && payment_method !== 'wechat') return json({ error: '现金套餐请选择微信支付' }, 400);
    if (pkg.currency === 'spirit_stone' && payment_method !== 'spirit_stone') return json({ error: '灵石套餐请选择灵石支付' }, 400);

    const price = pkg.currency === 'cash' ? pkg.price : pkg.price;
    const bonusPoints = pkg.points;

    const result = await env.DB.prepare(
      "INSERT INTO orders (user_id, invite_code, payment_method, payment_account, amount, price, bonus_points, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, 'PKG:' + package_id + ':' + pkg.name, payment_method, payment_account, pkg.price, price, bonusPoints).run();

    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '套餐购买已提交', '休闲杯套餐「' || ? || '」购买订单已提交，等待管理员审核', 'order')"
    ).bind(user.id, pkg.name).run();

    return json({ ok: true, message: '购买申请已提交，等待管理员审核', order_id: result.meta.last_row_id });
  }

  return json({ error: 'Method not allowed' }, 405);
}
