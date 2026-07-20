// POST /api/admin/points — 管理员发放/扣除修仙分
import { json } from '../../_utils.js';
import { authenticateAdmin } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 校验管理员身份
  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 401);

  const body = await request.json().catch(() => ({}));
  const { user_id, points, reason } = body;

  if (!user_id || points === undefined || points === null) {
    return json({ error: '缺少参数：user_id, points' }, 400);
  }

  if (typeof points !== 'number' || points === 0) {
    return json({ error: 'points 必须为非零数字' }, 400);
  }

  // 查找目标用户
  const target = await env.DB.prepare(
    'SELECT id, username, bonus_points FROM users WHERE id = ?'
  ).bind(user_id).first();

  if (!target) return json({ error: '用户不存在' }, 404);

  // 更新积分 (bonus_points = 修仙分)
  const newPoints = (target.bonus_points || 0) + points;
  await env.DB.prepare(
    'UPDATE users SET bonus_points = ? WHERE id = ?'
  ).bind(newPoints, user_id).run();

  // 记录通知
  const action = points > 0 ? '积分增加' : '积分扣除';
  const note = reason || (points > 0 ? '管理员发放积分' : '管理员扣除积分');
  await env.DB.prepare(
    "INSERT INTO notifications (user_id, title, content, type) VALUES (?, ?, ?, 'system')"
  ).bind(
    user_id,
    `${action}: ${Math.abs(points)} 修仙分`,
    `${note} — 操作管理员: ${user.username}`
  ).run();

  // 记录操作日志到 order_activities（用 user_id=0 表示系统操作）
  await env.DB.prepare(
    "INSERT INTO order_activities (order_id, user_id, action, detail) VALUES (0, ?, ?, ?)"
  ).bind(
    user.id,
    'admin_grant_points',
    `用户 #${user_id} (${target.username}) 积分 ${points > 0 ? '+' : ''}${points} 修仙分, 原因: ${note}`
  ).run();

  return json({
    ok: true,
    user_id,
    username: target.username,
    old_balance: target.bonus_points || 0,
    new_balance: newPoints,
    change: points,
  });
}
