// functions/api/orders/index.js — GET|POST /api/orders
import { json, logActivity } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  // ── GET /api/orders — 用户工单列表 ──────────────────
  if (request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';

    let query = 'SELECT o.*, (SELECT COUNT(*) FROM game_accounts WHERE order_id = o.id) as account_count FROM orders o WHERE o.user_id = ?';
    const params = [user.id];

    if (status) {
      query += ' AND o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.created_at DESC';
    const orders = await env.DB.prepare(query).bind(...params).all();
    return json({ ok: true, orders: orders.results });
  }

  // ── POST /api/orders — 创建工单 ─────────────────────
  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);

    const body = await request.json().catch(() => ({}));
    const { 
      order_type, 
      coupon_code, 
      note, 
      invite_code,
      payment_method,   // 'coin' | 'wechat' | 'spirit_stone'
      points            // 邀请积分数量（10的倍数）
    } = body;

    // ── 1. 验证积分数量 ──
    if (!points || points < 10 || points % 10 !== 0) {
      return json({ error: '邀请积分数量必须是10的倍数（最少10）' }, 400);
    }

    // ── 2. 验证付款方式 ──
    const validMethods = ['coin', 'wechat', 'spirit_stone'];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return json({ error: '请选择有效的付款方式' }, 400);
    }

    // ── 3. 根据付款方式计算价格 ──
    let price = 0;        // 显示价格
    let priceUnit = '';   // 价格单位
    let bonusPoints = points; // 获得的积分 = 输入的积分数量

    if (payment_method === 'wechat') {
      // 现金：1元 = 120积分
      price = points / 120;
      priceUnit = '元';
    } else if (payment_method === 'spirit_stone') {
      // 灵石：100万灵石 = 10积分
      price = points * 100000;
      priceUnit = '万灵石';
    } else if (payment_method === 'coin') {
      // 修仙币：1修仙币 = 1积分
      price = points;
      priceUnit = '修仙币';
    }

    // ── 4. 修仙币支付：验证余额并冻结 ──
    let frozenPoints = 0;
    if (payment_method === 'coin') {
      const userInfo = await env.DB.prepare('SELECT bonus_points FROM users WHERE id = ?').bind(user.id).first();
      const currentBalance = userInfo?.bonus_points || 0;
      if (currentBalance < points) {
        return json({ 
          error: `修仙币余额不足，当前余额: ${currentBalance}，需要: ${points}` 
        }, 400);
      }
      // 冻结积分：从余额中扣除
      await env.DB.prepare(
        'UPDATE users SET bonus_points = bonus_points - ? WHERE id = ?'
      ).bind(points, user.id).run();
      frozenPoints = points;
    }

    // ── 5. 优惠码折扣 ──
    let discount = 0;
    let couponType = 'percent';
    let couponFixedAmount = 0;
    if (coupon_code) {
      const coupon = await env.DB.prepare(
        "SELECT * FROM coupons WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now')) AND used_count < max_uses"
      ).bind(coupon_code).first();
      if (coupon) {
        couponType = coupon.coupon_type || 'percent';
        if (couponType === 'fixed') {
          couponFixedAmount = coupon.fixed_amount || 0;
        } else {
          discount = coupon.discount_percent || 0;
        }
        await env.DB.prepare(
          'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?'
        ).bind(coupon.id).run();
      }
    }

    // ── 6. 等级折扣 ──
    const userLevel = user.level || 1;
    const levelDiscounts = { 1: 0, 2: 0, 3: 10, 4: 20, 5: 30, 6: 40, 7: 45, 8: 50, 9: 60, 10: 70 };
    const levelDiscount = levelDiscounts[userLevel] || 0;

    // ── 7. 计算最终价格（取最大折扣） ──
    let finalPrice = price;
    if (couponType === 'fixed') {
      // 固定金额减免
      finalPrice = Math.max(0, price - couponFixedAmount);
      // 如果等级折扣更高，使用等级折扣
      const levelPrice = price * (100 - levelDiscount) / 100;
      finalPrice = Math.min(finalPrice, levelPrice);
      discount = levelDiscount; // 记录实际折扣百分比
    } else {
      // 百分比折扣，取最大值
      const maxDiscount = Math.max(discount, levelDiscount);
      finalPrice = price * (100 - maxDiscount) / 100;
      discount = maxDiscount;
    }

    // ── 8. 计算账号数 ──
    const accCount = Math.max(1, Math.ceil(bonusPoints / 10));

    // ── 9. 预估完成日期 ──
    const estDays = parseInt((await env.DB.prepare("SELECT value FROM config WHERE key='est_delivery_days'").first())?.value || '5');
    const estDate = new Date(Date.now() + estDays * 86400000).toISOString().split('T')[0];

    // ── 10. 插入订单 ──
    const finalInviteCode = invite_code || user.invite_code || '';
    const result = await env.DB.prepare(
      `INSERT INTO orders (user_id, invite_code, payment_method, amount, price, coupon_code, discount, bonus_points, order_type, quantity, frozen_points, invite_code_used, status, created_at, est_complete_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?)`
    ).bind(
      user.id, 
      finalInviteCode, 
      payment_method, 
      points,           // amount: 积分数量
      finalPrice,       // price: 最终价格
      coupon_code || '', 
      discount, 
      bonusPoints,      // bonus_points: 获得的积分
      order_type || '代练', 
      accCount,         // quantity: 账号数
      frozenPoints,     // frozen_points: 冻结的修仙币
      finalInviteCode,  // invite_code_used
      estDate
    ).run();

    const orderId = result.meta.last_row_id;

    // ── 11. 发送通知 ──
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已提交', '工单 #' || ? || ' 已提交，等待管理员审核中', 'order')"
    ).bind(user.id, orderId).run();

    // ── 12. 记录活动日志 ──
    const paymentLabel = payment_method === 'coin' ? '修仙币' : payment_method === 'wechat' ? '现金' : '灵石';
    await logActivity(env, orderId, user.id, 'created', 
      `提交工单: ${accCount}个账号, ${paymentLabel}支付, ${points}积分`);

    return json({ 
      ok: true, 
      message: '工单已提交，等待审核', 
      order_id: orderId,
      price_info: {
        points,
        payment_method: payment_method,
        price: finalPrice,
        unit: priceUnit,
        accounts: accCount,
        frozen_points: frozenPoints
      }
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
