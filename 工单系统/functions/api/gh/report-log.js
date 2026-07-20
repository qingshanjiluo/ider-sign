// functions/api/gh/report-log.js — POST /api/gh/report-log
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);
    const body = await request.json().catch(() => ({}));
    const { account_id, order_id, log_type, message, raw_output } = body;
    await env.DB.prepare(
      "INSERT INTO account_logs (account_id, order_id, log_type, message, raw_output) VALUES (?, ?, ?, ?, ?)"
    ).bind(account_id || 0, order_id || 0, log_type || 'info', message || '', raw_output || '').run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
