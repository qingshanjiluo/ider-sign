// functions/api/orders/[id]/index.js — GET /api/orders/:id
import { json } from '../../../_utils.js';
import { authenticate } from '../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const orderId = parseInt(params.id);
  if (isNaN(orderId)) return json({ error: '无效工单ID' }, 400);

  // 查询订单详情（admin 可看所有，普通用户只能看自己的）
  const order = await env.DB.prepare(
    'SELECT o.*, (SELECT COUNT(*) FROM game_accounts WHERE order_id = o.id) as account_count FROM orders o WHERE o.id = ? AND (o.user_id = ? OR ? = 1)'
  ).bind(orderId, user.id, user.is_admin || 0).first();

  if (!order) return json({ error: '工单不存在' }, 404);

  // 获取关联的游戏账号列表
  const accounts = await env.DB.prepare(
    'SELECT * FROM game_accounts WHERE order_id = ? ORDER BY id ASC'
  ).bind(order.id).all();

  return json({ ok: true, order, accounts: accounts.results });
}
