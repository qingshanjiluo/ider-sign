// functions/api/admin/ai-test.js — POST /api/admin/ai-test（测试AI连接）
import { json } from '../../_utils.js';
import { authenticateAdmin } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  const configs = await env.DB.prepare(
    "SELECT key, value FROM config WHERE key IN ('ai_api_key', 'ai_api_url', 'ai_model')"
  ).all();
  const configMap = {};
  for (const c of (configs.results || [])) configMap[c.key] = c.value;

  const apiKey = configMap['ai_api_key'];
  const apiUrl = configMap['ai_api_url'] || 'https://api.openai.com/v1/chat/completions';
  const model = configMap['ai_model'] || 'gpt-3.5-turbo';

  if (!apiKey) return json({ ok: false, error: '未设置API Key，请先在上方配置中填写 API 密钥', code: 'NO_API_KEY' }, 400);

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
      return json({ ok: false, error: `AI API 返回错误 (${aiRes.status}): ${errText.slice(0, 200)}`, code: 'API_ERROR' }, 200);
    }
    return json({ ok: true, message: 'AI连接测试成功' });
  } catch (e) {
    return json({ ok: false, error: '连接失败: ' + e.message, code: 'NETWORK_ERROR' }, 200);
  }
}
