// functions/api/gh/test-account.js — GET /api/gh/test-account
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);

  const username = env.TEST_ACCOUNT_USERNAME || '';
  const password = env.TEST_ACCOUNT_PASSWORD || '';

  if (!username || !password) {
    const top = await env.DB.prepare(
      "SELECT username, password FROM game_accounts WHERE status = 'active' OR status = 'farming' ORDER BY level DESC LIMIT 1"
    ).first();
    if (top) {
      return json({ ok: true, username: top.username, password: top.password, note: '取自最高等级账号' });
    }
    return json({ ok: false, error: '未配置测试账号' });
  }

  return json({ ok: true, username, password, note: '取自环境变量' });
}
