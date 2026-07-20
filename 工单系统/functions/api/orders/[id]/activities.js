// functions/api/orders/[id]/activities.js — GET /api/orders/:id/activities
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const orderId = parseInt(params.id);
  if (isNaN(orderId)) return json({ error: '无效工单ID' }, 400);

  // 验证工单存在性及权限
  const order = await env.DB.prepare('SELECT user_id FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: '工单不存在' }, 404);
  if (order.user_id !== user.id && !user.is_admin) return json({ error: '无权限' }, 403);

  // 获取活动日志
  const activities = await env.DB.prepare(
    'SELECT * FROM order_activities WHERE order_id = ? ORDER BY created_at ASC'
  ).bind(orderId).all();

  return json({ ok: true, activities: activities.results });
}
