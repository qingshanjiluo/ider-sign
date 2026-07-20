// functions/api/admin/ai-config.js — AI配置管理
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user || !['admin', 'super_admin'].includes(user.role)) return json({ error: '无权限' }, 403);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  // GET /api/admin/ai-config — 获取AI配置（API Key不回传）
  if (request.method === 'GET') {
    const keys = ['ai_api_url', 'ai_model', 'ai_enabled'];
    const configs = await env.DB.prepare(
      "SELECT key, value FROM config WHERE key IN ('ai_api_url', 'ai_model', 'ai_enabled', 'ai_api_key')"
    ).all();
    const result = {};
    const configMap = {};
    for (const c of (configs.results || [])) {
      configMap[c.key] = c.value;
    }
    for (const k of keys) {
      result[k] = configMap[k] || '';
    }
    // API Key: 不回传实际值，只返回是否已设置
    result.ai_api_key_set = !!configMap['ai_api_key'];
    return json({ ok: true, config: result });
  }

  // POST /api/admin/ai-config — 保存AI配置
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { ai_api_key, ai_api_url, ai_model, ai_enabled } = body;

    const updates = [];
    if (ai_api_key !== undefined) updates.push(['ai_api_key', ai_api_key]);
    if (ai_api_url !== undefined) updates.push(['ai_api_url', ai_api_url]);
    if (ai_model !== undefined) updates.push(['ai_model', ai_model]);
    if (ai_enabled !== undefined) updates.push(['ai_enabled', ai_enabled ? 'true' : 'false']);

    for (const [key, value] of updates) {
      await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    }

    return json({ ok: true, message: 'AI配置已保存' });
  }

  // POST /api/admin/ai-config/test — 测试AI连接
  if (request.method === 'POST' && path.endsWith('/test')) {
    const configs = await env.DB.prepare(
      "SELECT key, value FROM config WHERE key IN ('ai_api_key', 'ai_api_url', 'ai_model')"
    ).all();
    const configMap = {};
    for (const c of (configs.results || [])) configMap[c.key] = c.value;

    const apiKey = configMap['ai_api_key'];
    const apiUrl = configMap['ai_api_url'] || 'https://api.openai.com/v1/chat/completions';
    const model = configMap['ai_model'] || 'gpt-3.5-turbo';

    if (!apiKey) return json({ ok: false, error: '未设置API Key' }, 400);

    try {
      const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '回复"连接成功"即可' }],
          max_tokens: 20,
        }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        return json({ ok: false, error: 'API返回错误: ' + aiRes.status + ' ' + errText.slice(0, 200) }, 400);
      }
      return json({ ok: true, message: 'AI连接测试成功' });
    } catch (e) {
      return json({ ok: false, error: '连接失败: ' + e.message }, 400);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
