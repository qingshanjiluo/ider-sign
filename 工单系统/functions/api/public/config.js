// functions/api/public/config.js — GET /api/public/config
import { json } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM config').all();
    const cfg = {};
    for (const c of configs.results) cfg[c.key] = c.value;
    const ann = await env.DB.prepare("SELECT * FROM announcements WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const adsData = { popup: null, sidebar: null };
    const popupAd = await env.DB.prepare("SELECT * FROM ads WHERE type = 'popup' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    const sidebarAd = await env.DB.prepare("SELECT * FROM ads WHERE type = 'sidebar' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").first();
    if (popupAd) adsData.popup = popupAd;
    if (sidebarAd) adsData.sidebar = sidebarAd;
    return json({ ok: true, config: cfg, announcement: ann || null, ads: adsData });
  }

  return json({ error: 'Method not allowed' }, 405);
}
