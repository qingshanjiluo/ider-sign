// functions/api/gh/report-account.js — POST /api/gh/report-account
import { json, logActivity } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
    const { order_id, username, password, status, level, map_id, map_name, skills, techniques, equipment, error_msg, server_username, server_password } = body;

    if (status === 'creating') {
      const existing = await env.DB.prepare(
        'SELECT id FROM game_accounts WHERE username = ? AND order_id = ?'
      ).bind(username, order_id).first();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO game_accounts (order_id, username, password, server_username, server_password, status, created_at) VALUES (?, ?, ?, ?, ?, 'registering', datetime('now'))"
        ).bind(order_id, username, password, server_username || '', server_password || '').run();
        const ord = await env.DB.prepare('SELECT user_id FROM orders WHERE id = ?').bind(order_id).first();
        await logActivity(env, order_id, ord?.user_id || 0, 'account_created', '创建账号: ' + username);
      }
    } else if (status === 'farming' || status === 'active') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, map_id = ?, map_name = ?, skills = ?, techniques = ?, equipment = ?, is_farming = 1, last_check_at = datetime('now'), health_status = 'ok' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, map_id || 0, map_name || '', JSON.stringify(skills || []), JSON.stringify(techniques || []), JSON.stringify(equipment || []), username, order_id).run();
    } else if (status === 'completed') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, reached_120_at = datetime('now'), stop_monitor_at = datetime('now', '+2 days'), last_check_at = datetime('now'), health_status = 'completed' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, username, order_id).run();
    } else if (status === 'error' || status === 'failed') {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, error_msg = ?, last_check_at = datetime('now'), health_status = 'error' WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, error_msg || '', username, order_id).run();
    } else {
      await env.DB.prepare(
        "UPDATE game_accounts SET status = ?, level = ?, last_check_at = datetime('now') WHERE username = ? AND order_id = ?"
      ).bind(status, level || 0, username, order_id).run();
    }
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
