// functions/api/admin/recharge-codes.js — 管理端兑换码CRUD
import { json, generateRechargeCode } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user || !['admin', 'super_admin'].includes(user.role)) return json({ error: '无权限' }, 403);

  // GET — 查询兑换码列表
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;

    let rows, countRow;
    if (status) {
      rows = await env.DB.prepare(
        "SELECT rc.*, u.username AS user_name, creator.username AS creator_name FROM recharge_codes rc LEFT JOIN users u ON rc.user_id = u.id LEFT JOIN users creator ON rc.created_by = creator.id WHERE rc.status = ? ORDER BY rc.created_at DESC LIMIT ? OFFSET ?"
      ).bind(status, pageSize, offset).all();
      countRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM recharge_codes WHERE status = ?").bind(status).first();
    } else {
      rows = await env.DB.prepare(
        "SELECT rc.*, u.username AS user_name, creator.username AS creator_name FROM recharge_codes rc LEFT JOIN users u ON rc.user_id = u.id LEFT JOIN users creator ON rc.created_by = creator.id ORDER BY rc.created_at DESC LIMIT ? OFFSET ?"
      ).bind(pageSize, offset).all();
      countRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM recharge_codes").first();
    }

    return json({ ok: true, codes: rows.results || [], total: countRow?.cnt || 0, page, pageSize });
  }

  // POST — 批量生成兑换码
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { count = 1, coins = 0 } = body;

    if (!coins || coins <= 0) return json({ error: '修仙币数量必须大于0' }, 400);
    if (count < 1 || count > 100) return json({ error: '生成数量范围为1-100' }, 400);

    const generatedCodes = [];
    const insertStmt = env.DB.prepare(
      'INSERT INTO recharge_codes (user_id, code, coins, status, created_by) VALUES (?, ?, ?, ?, ?)'
    );

    for (let i = 0; i < count; i++) {
      let code = '';
      let retries = 0;
      while (retries < 10) {
        code = generateRechargeCode();
        const exist = await env.DB.prepare('SELECT id FROM recharge_codes WHERE code = ?').bind(code).first();
        if (!exist) break;
        retries++;
      }
      await insertStmt.bind(0, code, coins, 'pending', user.id).run();
      generatedCodes.push(code);
    }

    return json({
      ok: true,
      message: `成功生成 ${generatedCodes.length} 个兑换码`,
      codes: generatedCodes,
      coins,
    });
  }

  // DELETE — 删除兑换码
  if (request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    if (!id) return json({ error: '缺少参数' }, 400);

    const rc = await env.DB.prepare('SELECT * FROM recharge_codes WHERE id = ?').bind(id).first();
    if (!rc) return json({ error: '兑换码不存在' }, 404);
    if (rc.status === 'used') return json({ error: '已使用的兑换码不能删除' }, 400);

    await env.DB.prepare('DELETE FROM recharge_codes WHERE id = ?').bind(id).run();
    return json({ ok: true, message: '兑换码已删除' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
