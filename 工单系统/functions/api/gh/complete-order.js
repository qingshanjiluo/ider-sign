// functions/api/gh/complete-order.js — POST /api/gh/complete-order
// 两阶段状态机:
//   阶段1 (初始交付): 所有账号完成创建+配置 → order.status = 'processing'
//   阶段2 (最终完成): 所有账号达到120级 → order.status = 'completed'
import { json, logActivity } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
    const { order_id } = body;

    // 统计各状态账号数
    const stats = await env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM game_accounts WHERE order_id = ? GROUP BY status"
    ).bind(order_id).all();
    const rows = stats.results || [];
    const total = rows.reduce((s, r) => s + r.cnt, 0);
    const getCount = (statuses) => rows.filter(r => statuses.includes(r.status)).reduce((s, r) => s + r.cnt, 0);
    const setupPhase = ['pending', 'registering', 'created'];
    const farmingPhase = ['farming', 'active'];
    const finalPhase = ['completed', 'failed'];

    const settingUp = getCount(setupPhase);
    const farming = getCount(farmingPhase);
    const finished = getCount(finalPhase);

    const order = await env.DB.prepare("SELECT user_id, status FROM orders WHERE id = ?").bind(order_id).first();
    if (!order) return json({ error: '工单不存在' }, 404);

    // 阶段1: 初始交付（所有账号已离开设置阶段）
    if (settingUp === 0 && total > 0 && farming + finished === total) {
      await env.DB.prepare(
        "UPDATE orders SET status = 'processing', updated_at = datetime('now'), total_accounts_created = ? WHERE id = ? AND status = 'approved'"
      ).bind(total, order_id).run();
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已交付', '工单 #' || ? || ' 账号已全部创建并配置完成，开始自动挂机', 'order')"
      ).bind(order.user_id, order_id).run();
      await logActivity(env, order_id, order.user_id, 'processing', '全部账号已交付，进入挂机阶段');
      return json({ ok: true, message: '工单已交付，进入挂机阶段', status: 'processing', total });
    }

    // 阶段2: 最终完成（所有账号已120级或失败）
    if (settingUp === 0 && farming === 0 && finished === total && total > 0) {
      await env.DB.prepare(
        "UPDATE orders SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).bind(order_id).run();
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '工单已完成', '工单 #' || ? || ' 已全部完成，账号已到达120级', 'order')"
      ).bind(order.user_id, order_id).run();
      await logActivity(env, order_id, order.user_id, 'completed', '所有账号已到120级，工单自动完成');
      return json({ ok: true, message: '订单已完成', status: 'completed' });
    }

    // 未达条件
    return json({
      ok: true,
      message: '仍有账号未完成',
      detail: { settingUp, farming, finished, total },
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
