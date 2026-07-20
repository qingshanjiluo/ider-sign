// functions/api/gh/report-health.js — POST /api/gh/report-health
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
    const { order_id, username, level, status, map_id, map_name, error_msg } = body;
    const isCompleted = level >= 120;
    const reportStatus = isCompleted ? 'completed' : (status || 'farming');

    await env.DB.prepare(
      "UPDATE game_accounts SET status = ?, level = ?, map_id = ?, map_name = ?, last_check_at = datetime('now'), error_msg = ?, reached_120_at = CASE WHEN ? >= 120 THEN datetime('now') ELSE reached_120_at END, stop_monitor_at = CASE WHEN ? >= 120 THEN datetime('now', '+2 days') ELSE stop_monitor_at END WHERE username = ? AND order_id = ?"
    ).bind(reportStatus, level || 0, map_id || 0, map_name || '', error_msg || '', level || 0, level || 0, username, order_id).run();

    return json({ ok: true, completed: isCompleted });
  }

  return json({ error: 'Method not allowed' }, 405);
}
