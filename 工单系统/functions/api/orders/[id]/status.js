// functions/api/orders/[id]/status.js — POST /api/admin/orders/:id/status
// 重要：这是 admin 路由，放在 orders/[id]/ 路径下
import { json, logActivity } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';
import { addXP } from '../../../_xp.js';

// ─── Invite Boost Tiers ──────────────────────────────
const INVITE_BOOST_TIERS = [
  { min: 0,       max: 4999,    mult: 1.0, label: '基础',  rate: 30 },
  { min: 5000,    max: 19999,   mult: 1.2, label: '青铜',  rate: 36 },
  { min: 20000,   max: 49999,   mult: 1.5, label: '白银',  rate: 45 },
  { min: 50000,   max: 99999,   mult: 2.0, label: '黄金',  rate: 60 },
  { min: 100000,  max: Infinity, mult: 3.0, label: '至尊',  rate: 90 },
];

function getInviteBoost(totalPurchased) {
  return INVITE_BOOST_TIERS.find(t => totalPurchased >= t.min && totalPurchased < t.max) || INVITE_BOOST_TIERS[0];
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 管理员权限验证
  const user = await authenticate(request, env);
  if (!user || !user.is_admin) return json({ error: '无权限' }, 403);

  const orderId = parseInt(params.id);
  if (isNaN(orderId)) return json({ error: '无效工单ID' }, 400);

  const body = await request.json().catch(() => ({}));
  const { status, admin_notes } = body;

  if (!status || !['approved', 'rejected', 'completed'].includes(status)) {
    return json({ error: '无效状态值' }, 400);
  }

  // 更新工单状态
  await env.DB.prepare(
    "UPDATE orders SET status = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, admin_notes || '', orderId).run();

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: '工单不存在' }, 404);

  // ── approved: 审核通过 ──────────────────────────────
  if (status === 'approved') {
    // 更新用户统计（total_spent 使用 bonus_points 统一单位）
    await env.DB.prepare(
      'UPDATE users SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?'
    ).bind(order.bonus_points, order.user_id).run();

    // 处理邀请套餐订单
    const isPackage = order.invite_code && order.invite_code.startsWith('PKG:');
    if (isPackage) {
      const pkgPoints = order.bonus_points || 0;
      await env.DB.prepare(
        'UPDATE users SET total_purchased_points = COALESCE(total_purchased_points, 0) + ?, invite_points = invite_points + ? WHERE id = ?'
      ).bind(pkgPoints, pkgPoints, order.user_id).run();
      const pkgName = order.invite_code.replace('PKG:', '').split(':')[1] || '邀请套餐';
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '套餐已到账', '「' || ? || '」' || ? || ' 邀请积分已到账，当前倍率已提升！', 'commission')"
      ).bind(order.user_id, pkgName, pkgPoints).run();
      await logActivity(env, orderId, order.user_id, 'commission', '购买套餐到账 ' + pkgPoints + ' 积分');
    } else {
      // XP 基于 bonus_points 统一计算
      const xpGain = Math.max(10, Math.floor(order.bonus_points * 0.1));
      await addXP(env, order.user_id, xpGain, '工单 #' + orderId + ' 审核通过');
      await logActivity(env, orderId, order.user_id, 'approved', '工单已审核通过');

      // 邀请分成（基于 bonus_points 计算佣金）
      if (order.user_id) {
        const buyer = await env.DB.prepare('SELECT invited_by FROM users WHERE id = ?').bind(order.user_id).first();
        if (buyer && buyer.invited_by > 0) {
          const boostInfo = getInviteBoost(
            (await env.DB.prepare('SELECT total_purchased_points FROM users WHERE id = ?').bind(buyer.invited_by).first())?.total_purchased_points || 0
          );
          const commission = order.bonus_points * (boostInfo.rate / 100);
          await env.DB.prepare(
            'UPDATE users SET invite_points = invite_points + ? WHERE id = ?'
          ).bind(commission, buyer.invited_by).run();
          await env.DB.prepare(
            "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '邀请分成到账', '下线成交获得 ' || ? || ' 邀请积分奖励（' || ? || '倍率）', 'commission')"
          ).bind(buyer.invited_by, commission.toFixed(1), boostInfo.label).run();
          await logActivity(env, orderId, buyer.invited_by, 'commission', '获得分成 ' + commission.toFixed(1) + ' 积分（' + boostInfo.label + '倍率）');
        }
      }
    }

    // 通知用户工单已通过
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已通过', '工单 #' || ? || ' 已审核通过，正在处理中', 'order')"
    ).bind(order.user_id, orderId).run();
  }

  // ── rejected: 拒绝 ─────────────────────────────────
  else if (status === 'rejected') {
    // 修仙币支付：退还冻结的积分
    if (order.payment_method === 'coin' && order.frozen_points > 0) {
      await env.DB.prepare(
        'UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?'
      ).bind(order.frozen_points, order.user_id).run();
      await logActivity(env, orderId, order.user_id, 'refund',
        '工单拒绝，退还冻结修仙币 ' + order.frozen_points + ' 个');
    }
    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单被拒绝', '工单 #' || ? || ' 被拒绝: ' || ?, 'order')"
    ).bind(order.user_id, orderId, admin_notes || '无原因').run();
    await logActivity(env, orderId, order.user_id, 'rejected', '拒绝原因: ' + (admin_notes || '未说明'));
  }

  // ── completed: 完成 ────────────────────────────────
  else if (status === 'completed') {
    await logActivity(env, orderId, order.user_id, 'completed', '工单已完成');
  }

  return json({ ok: true, message: '状态已更新' });
}
