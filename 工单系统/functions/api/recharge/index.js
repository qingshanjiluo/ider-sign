// functions/api/recharge/index.js — 充值订单 CRUD
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';
import { CASH_PACKAGES, SPIRIT_STONE_PACKAGES, INVITE_PACKAGES } from '../../_xp.js';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (request.method === 'GET') {
    // 获取我的充值记录
    const rows = await env.DB.prepare(
      "SELECT * FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.id).all();
    return json({ ok: true, orders: rows.results || [] });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { type, package_id, amount, payment_method, payment_account } = body;

    // type: 'package' = 套餐充值, 'cash' = 现金直充, 'spirit_stone' = 灵石直充
    if (!type || !['package', 'cash', 'spirit_stone'].includes(type)) {
      return json({ error: '无效充值类型' }, 400);
    }

    let coins = 0;
    let finalAmount = 0;

    if (type === 'package') {
      // 套餐充值
      if (!package_id) return json({ error: '请选择套餐' }, 400);
      const allPkgs = [...CASH_PACKAGES, ...SPIRIT_STONE_PACKAGES];
      const pkg = allPkgs.find(p => p.id === package_id);
      if (!pkg) return json({ error: '无效套餐' }, 400);
      coins = pkg.coins;
      finalAmount = pkg.price;

      // 自动判断支付方式
      if (!payment_method) {
        if (pkg.currency === 'cash') {
          return json({ error: '现金套餐请选择支付方式' }, 400);
        }
        // 灵石套餐无需额外支付方式
      }
    } else if (type === 'cash') {
      // 现金直充 1元=400修仙币
      if (!amount || amount < 1) return json({ error: '充值金额至少1元' }, 400);
      finalAmount = amount;
      coins = Math.floor(amount * 400);
    } else if (type === 'spirit_stone') {
      // 灵石直充 100万灵石=10修仙币
      if (!amount || amount < 1000000) return json({ error: '灵石充值至少100万' }, 400);
      finalAmount = amount;
      coins = Math.floor(amount / 100000) * 10; // 100万=10币, 即10万=1币
    }

    // 灵石直充和灵石套餐：扣除玩家灵石（通过游戏账号系统？暂不实现自动扣，走线下确认）
    // 所有充值都需要管理员审核

    const result = await env.DB.prepare(
      "INSERT INTO recharge_orders (user_id, type, package_id, amount, coins, payment_method, payment_account, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
    ).bind(user.id, type, package_id || '', finalAmount, coins, payment_method || '', payment_account || '').run();

    await env.DB.prepare(
      "INSERT INTO notifications (user_id, title, content, type) VALUES (?, '充值已提交', '修仙币充值「' || ? || '」已提交，等待管理员审核', 'order')"
    ).bind(user.id, coins + '修仙币').run();

    return json({
      ok: true,
      message: '充值申请已提交，等待管理员审核',
      order_id: result.meta?.last_row_id,
      coins,
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
