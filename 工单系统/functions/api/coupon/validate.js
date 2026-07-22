// functions/api/coupon/validate.js — POST /api/coupon/validate
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { code } = body;
    if (!code) return json({ error: '请输入优惠码' }, 400);
    const coupon = await env.DB.prepare(
      "SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).bind(code).first();
    if (!coupon) return json({ error: '优惠码无效或已过期' }, 404);
    // max_uses = 0 表示无限次，跳过使用次数检查
    if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return json({ error: '优惠码已用完' }, 400);
    return json({
      ok: true,
      coupon_type: coupon.coupon_type || 'percent',
      discount_percent: coupon.discount_percent,
      fixed_amount: coupon.fixed_amount || 0,
      min_amount: coupon.min_amount
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
