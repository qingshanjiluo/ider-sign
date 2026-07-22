// functions/api/admin/orders/[id]/create-account.js
// POST /api/admin/orders/:id/create-account
// 角色创建流程：在工单下创建游戏账号并设置角色名+灵根
// 参考批量注册工具 batch.js 的 stepCreateCharacter + spiritRoots 配置
import { json, logActivity } from '../../../../_utils.js';
import { authenticateAdmin } from '../../../../_auth.js';

const VALID_SPIRIT_KEYS = ['metal', 'wood', 'water', 'fire', 'earth'];
const SPIRIT_ROOT_LABELS = { metal: '金灵根', wood: '木灵根', water: '水灵根', fire: '火灵根', earth: '土灵根' };

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  const orderId = parseInt(params.id);
  if (isNaN(orderId)) return json({ error: '无效工单ID' }, 400);

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: '工单不存在' }, 404);

  const body = await request.json().catch(() => ({}));
  const {
    username,          // 游戏账号名（登录用）
    password,          // 游戏账号密码
    character_name,    // 角色名（游戏内显示名）
    spirit_roots,     // 灵根配置 {metal,wood,water,fire,earth}
  } = body;

  if (!username || !password) return json({ error: '请输入游戏账号和密码' }, 400);
  if (!character_name) return json({ error: '请输入角色名' }, 400);
  if (username.length > 100) return json({ error: '账号名最多100字符' }, 400);
  if (password.length > 200) return json({ error: '密码最多200字符' }, 400);
  if (character_name.length > 50) return json({ error: '角色名最多50字符' }, 400);

  // 验证灵根配置
  const roots = {};
  if (spirit_roots && typeof spirit_roots === 'object') {
    for (const key of VALID_SPIRIT_KEYS) {
      const val = parseInt(spirit_roots[key]) || 0;
      if (val < 0 || val > 100) return json({ error: `${SPIRIT_ROOT_LABELS[key]}值必须在0-100之间` }, 400);
      roots[key] = val;
    }
  } else {
    // 默认金灵根100
    for (const key of VALID_SPIRIT_KEYS) roots[key] = key === 'metal' ? 100 : 0;
  }

  // 总灵根值校验（通常总和不超过100）
  const totalRoots = Object.values(roots).reduce((a, b) => a + b, 0);
  if (totalRoots > 100) return json({ error: '灵根总和不能超过100' }, 400);

  try {
    // 插入游戏账号记录
    const result = await env.DB.prepare(
      `INSERT INTO game_accounts (order_id, username, password, character_name, spirit_roots, status, setup_status, operator_id, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, 'creating', 'creating', ?, ?, datetime('now'))`
    ).bind(
      orderId,
      username,
      password,
      character_name,
      JSON.stringify(roots),
      user.id,
      user.username || user.display_name || ''
    ).run();

    const accountId = result.meta.last_row_id;

    // 更新工单的已创建账号计数
    await env.DB.prepare(
      'UPDATE orders SET total_accounts_created = total_accounts_created + 1 WHERE id = ?'
    ).bind(orderId).run();

    // 记录日志
    const rootDesc = Object.entries(roots)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${SPIRIT_ROOT_LABELS[k]}${v}`)
      .join(' ');
    await logActivity(env, orderId, user.id, 'account_created',
      `创建账号 #${accountId}: ${username} → 角色「${character_name}」灵根: ${rootDesc || '默认(金灵根100)'}`);

    return json({
      ok: true,
      message: '账号已创建，等待角色创建',
      account: {
        id: accountId,
        username,
        character_name,
        spirit_roots: roots,
        status: 'creating',
        setup_status: 'creating',
      }
    });
  } catch (e) {
    return json({ error: '创建账号失败: ' + e.message }, 500);
  }
}
