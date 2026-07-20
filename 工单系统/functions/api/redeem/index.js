// functions/api/redeem/index.js — POST /api/redeem
// 支持两种兑换码：
//   1. redeem_codes 表（经验值兑换码，原逻辑）
//   2. recharge_codes 表（修仙币兑换码，新逻辑）
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';
import { addXP } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { code } = body;
    if (!code) return json({ error: '请输入兑换码' }, 400);
    const clean = code.trim().toUpperCase();

    // 1. 先查 recharge_codes（修仙币兑换码）
    const rc = await env.DB.prepare(
      "SELECT * FROM recharge_codes WHERE code = ? AND status = 'pending'"
    ).bind(clean).first();

    if (rc) {
      // 修仙币兑换码处理
      await env.DB.prepare(
        'UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?'
      ).bind(rc.coins, user.id).run();
      await env.DB.prepare(
        "UPDATE recharge_codes SET status = 'used', used_by = ?, used_at = datetime('now') WHERE id = ?"
      ).bind(user.id, rc.id).run();
      // 如果该码有归属 user_id 且不是当前用户，发通知给原主
      if (rc.user_id && rc.user_id !== user.id) {
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '兑换码已使用', '您的兑换码 ' || ? || ' 已被使用', 'order')"
        ).bind(rc.user_id, clean).run();
      }
      return json({ ok: true, message: '兑换成功，获得 ' + rc.coins + ' 修仙币', coins: rc.coins, type: 'recharge' });
    }

    // 2. 再查 redeem_codes（经验值兑换码，原逻辑）
    const oldRc = await env.DB.prepare(
      "SELECT * FROM redeem_codes WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now')) AND (max_uses = 0 OR used_count < max_uses)"
    ).bind(clean).first();
    if (!oldRc) return json({ error: '兑换码无效或已使用' }, 404);
    const used = await env.DB.prepare('SELECT id FROM redeem_log WHERE user_id = ? AND code = ?').bind(user.id, clean).first();
    if (used) return json({ error: '您已使用过此兑换码' }, 400);
    await env.DB.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').bind(oldRc.id).run();
    await env.DB.prepare('INSERT INTO redeem_log (user_id, code, xp) VALUES (?, ?, ?)').bind(user.id, clean, oldRc.xp).run();
    await addXP(env, user.id, oldRc.xp, '使用兑换码 ' + clean);
    return json({ ok: true, message: '兑换成功，获得 ' + oldRc.xp + ' 经验值', xp: oldRc.xp, type: 'xp' });
  }

  return json({ error: 'Method not allowed' }, 405);
}
