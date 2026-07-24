// functions/api/gh/report-health.js — POST /api/gh/report-health
// 接收健康检测上报的完整玩家状态，更新 game_accounts 所有相关字段
import { json, logActivity } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
    const {
      order_id, username, level, status, map_id, map_name, error_msg,
      character_name, spirit_roots, skills, techniques, equipment,
      exp, exp_percent, health_status, setup_status,
    } = body;
    const isCompleted = level >= 120;
    const reportStatus = isCompleted ? 'completed' : (status || 'farming');

    await env.DB.prepare(
      `UPDATE game_accounts SET
        status = ?, level = ?, map_id = ?, map_name = ?,
        character_name = COALESCE(NULLIF(?, ''), character_name),
        spirit_roots = COALESCE(NULLIF(?, ''), spirit_roots),
        skills = ?, techniques = ?, equipment = ?,
        last_check_at = datetime('now'),
        error_msg = ?,
        health_status = ?,
        setup_status = COALESCE(NULLIF(?, ''), setup_status),
        reached_120_at = CASE WHEN ? >= 120 THEN datetime('now') ELSE reached_120_at END,
        stop_monitor_at = CASE WHEN ? >= 120 THEN datetime('now', '+2 days') ELSE stop_monitor_at END
      WHERE username = ? AND order_id = ?`
    ).bind(
      reportStatus, level || 0, map_id || 0, map_name || '',
      character_name || '', spirit_roots || null,
      JSON.stringify(skills || []), JSON.stringify(techniques || []), JSON.stringify(equipment || []),
      error_msg || '', health_status || 'ok', setup_status || 'farming',
      level || 0, level || 0, username, order_id
    ).run();

    return json({ ok: true, completed: isCompleted, level: level || 0 });
  }

  return json({ error: 'Method not allowed' }, 405);
}
