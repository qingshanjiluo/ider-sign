// functions/api/admin/coupons.js — GET|POST /api/admin/coupons
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const coupons = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return json({ ok: true, coupons: coupons.results });
  }

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const body = await request.json().catch(() => ({}));
    // 兼容前端格式：{ code, type, value, max_uses, expires_at } 与 直接格式：{ code, discount_percent, ... }
    const code = body.code;
    let coupon_type = body.coupon_type || 'percent';
    let discount_percent = body.discount_percent || 0;
    let fixed_amount = body.fixed_amount || 0;
    const max_uses = body.max_uses || 0;
    const expires_at = body.expires_at || null;
    
    // 前端格式：type='percent'|'fixed', value=数字
    if (body.type && body.value !== undefined) {
      coupon_type = body.type;
      if (body.type === 'percent') {
        discount_percent = body.value;
        fixed_amount = 0;
      } else {
        fixed_amount = body.value;
        discount_percent = 0;
      }
    }
    
    if (!code) return json({ error: '请填写优惠码' }, 400);
    if (coupon_type === 'percent' && discount_percent <= 0) {
      return json({ error: '百分比折扣必须大于0' }, 400);
    }
    if (coupon_type === 'fixed' && fixed_amount <= 0) {
      return json({ error: '固定金额必须大于0' }, 400);
    }
    
    const cleanCode = code.trim().toUpperCase();
    const existing = await env.DB.prepare('SELECT id FROM coupons WHERE code = ?').bind(cleanCode).first();
    if (existing) return json({ error: '优惠码已存在' }, 400);
    
    await env.DB.prepare(
      "INSERT INTO coupons (code, coupon_type, discount_percent, fixed_amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(cleanCode, coupon_type, discount_percent, fixed_amount, max_uses, expires_at).run();
    
    return json({ ok: true, message: '优惠券已创建' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
