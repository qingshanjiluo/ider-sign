// functions/api/config.js — GET /api/config
import { json } from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM config').all();
    const cfg = {};
    for (const c of configs.results) cfg[c.key] = c.value;
    return json({ ok: true, config: cfg });
  }

  return json({ error: 'Method not allowed' }, 405);
}
