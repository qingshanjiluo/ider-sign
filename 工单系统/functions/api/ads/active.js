// functions/api/ads/active.js — GET /api/ads/active
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const popup = await env.DB.prepare("SELECT * FROM ads WHERE type = 'popup' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const sidebar = await env.DB.prepare("SELECT * FROM ads WHERE type = 'sidebar' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    return json({ ok: true, popup: popup || null, sidebar: sidebar || null });
  }

  return json({ error: 'Method not allowed' }, 405);
}
