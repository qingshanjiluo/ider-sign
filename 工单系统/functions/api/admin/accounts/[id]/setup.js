// functions/api/admin/accounts/[id]/setup.js
// POST /api/admin/accounts/:id/setup
// 账号完整Setup流程：技能装备→铁剑→功法→地图→战斗
// 参考批量注册工具 batch.js 的步骤 5-9 及 batch_reregister.js 的 setupExistingAccount
import { json, logActivity } from '../../../../_utils.js';
import { authenticateAdmin } from '../../../../_auth.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { user, error } = await authenticateAdmin(request, env);
  if (error) return json({ error }, 403);

  const accountId = parseInt(params.id);
  if (isNaN(accountId)) return json({ error: '无效账号ID' }, 400);

  const account = await env.DB.prepare('SELECT * FROM game_accounts WHERE id = ?').bind(accountId).first();
  if (!account) return json({ error: '账号不存在' }, 404);

  const body = await request.json().catch(() => ({}));
  const { steps } = body;
  // steps: 要执行的步骤数组，默认全部
  // 'skills' | 'iron_sword' | 'technique' | 'map' | 'battle'
  const stepOrder = steps || ['skills', 'iron_sword', 'technique', 'map', 'battle'];

  // 更新状态
  await env.DB.prepare(
    "UPDATE game_accounts SET setup_status = 'running', status = 'farming' WHERE id = ?"
  ).bind(accountId).run();

  const results = {};
  let hasError = false;

  try {
    // 步骤1: 装备技能（重击/火球术/治疗术）
    if (stepOrder.includes('skills') && !hasError) {
      results.skills = { status: 'running' };
      await env.DB.prepare(
        "UPDATE game_accounts SET setup_status = 'skills' WHERE id = ?"
      ).bind(accountId).run();
      // 技能装备在外部执行（通过API回调或手动触发）
      // 这里记录意图，实际技能由外部游戏API执行
      results.skills = {
        status: 'pending',
        note: '需要通过游戏API装备初始3技能（重击/火球术/治疗术）'
      };
    }

    // 步骤2: 装备铁剑
    if (stepOrder.includes('iron_sword') && !hasError) {
      results.iron_sword = { status: 'pending' };
      await env.DB.prepare(
        "UPDATE game_accounts SET setup_status = 'iron_sword' WHERE id = ?"
      ).bind(accountId).run();
      results.iron_sword = {
        status: 'pending',
        note: '需要通过游戏API装备铁剑'
      };
    }

    // 步骤3: 设置功法（吐纳法 id=1）
    if (stepOrder.includes('technique') && !hasError) {
      const techniqueId = body.technique_id || 1;
      await env.DB.prepare(
        "UPDATE game_accounts SET setup_status = 'technique', technique_id = ? WHERE id = ?"
      ).bind(techniqueId, accountId).run();
      results.technique = {
        status: 'pending',
        technique_id: techniqueId,
        note: `需要通过游戏API设置主功法（id=${techniqueId}）`
      };
    }

    // 步骤4: 切换地图
    if (stepOrder.includes('map') && !hasError) {
      const mapId = body.map_id || 1;
      await env.DB.prepare(
        "UPDATE game_accounts SET setup_status = 'map', map_id = ? WHERE id = ?"
      ).bind(mapId, accountId).run();
      results.map = {
        status: 'pending',
        map_id: mapId,
        note: '需要通过游戏API切换地图'
      };
    }

    // 步骤5: 战斗设置
    if (stepOrder.includes('battle') && !hasError) {
      const autoRestart = body.auto_restart !== false;
      await env.DB.prepare(
        "UPDATE game_accounts SET setup_status = 'battle', battle_auto_restart = ?, status = 'farming' WHERE id = ?"
      ).bind(autoRestart ? 1 : 0, accountId).run();
      results.battle = {
        status: 'pending',
        auto_restart: autoRestart,
        note: '需要通过游戏API启动战斗并设置自动刷怪'
      };
    }

    // 全部完成
    await env.DB.prepare(
      "UPDATE game_accounts SET setup_status = 'done', status = 'farming' WHERE id = ?"
    ).bind(accountId).run();

    await logActivity(env, account.order_id, user.id, 'setup_complete',
      `账号 #${accountId} Setup完成: ${stepOrder.join(' → ')}`);

    return json({
      ok: true,
      message: 'Setup指令已提交',
      account_id: accountId,
      steps: stepOrder,
      results,
    });

  } catch (e) {
    await env.DB.prepare(
      "UPDATE game_accounts SET setup_status = 'error', status = 'error', error_msg = ? WHERE id = ?"
    ).bind(e.message, accountId).run();
    return json({ error: 'Setup失败: ' + e.message }, 500);
  }
}
