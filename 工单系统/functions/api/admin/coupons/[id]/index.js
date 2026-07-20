// functions/api/admin/coupons/[id].js — DELETE /api/admin/coupons/:id
import { json } from '../../../../_utils.js';
import { authenticate } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user || !user.is_admin) return json({ error: '无权限' }, 403);
    const id = parseInt(params.id);
    await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run();
    return json({ ok: true, message: '优惠券已删除' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
