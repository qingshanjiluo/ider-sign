// functions/api/announcements/active.js — GET /api/announcements/active
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const ann = await env.DB.prepare(
      "SELECT * FROM announcements WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1"
    ).first();
    return json({ ok: true, announcement: ann || null });
  }

  return json({ error: 'Method not allowed' }, 405);
}
