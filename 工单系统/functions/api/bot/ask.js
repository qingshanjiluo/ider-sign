// functions/api/bot/ask.js — POST /api/bot/ask
import { json } from '../../_utils.js';
import { authenticate } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: '未登录' }, 401);
    const body = await request.json().catch(() => ({}));
    const { question } = body;
    if (!question) return json({ error: '请输入问题' }, 400);
    const answer = await getBotAnswer(question, env, user);
    await env.DB.prepare(
      "INSERT INTO bot_logs (user_id, question, answer) VALUES (?, ?, ?)"
    ).bind(user.id, question, answer).run();
    return json({ ok: true, answer });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function getBotAnswer(question, env, user) {
  const q = question.toLowerCase().trim();
  const orderInfo = await env.DB.prepare(
    "SELECT id, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
  ).bind(user.id).all();

  // ─── 修仙币/坊市/市场 ───
  if (q.includes('修仙币') || q.includes('坊市') || q.includes('市场')) {
    return '🏪 修仙坊市：\n▸ 官方市场：管理员上架物品，可用修仙币购买\n▸ 黑市：玩家间买卖，自由挂单和接单\n▸ 充值说明：\n  - 现金套餐：¥5=2500修仙币 ~ ¥50=25000修仙币\n  - 灵石套餐：500万灵石=70修仙币 ~ 1亿灵石=1500修仙币\n  - 基础充值：1元=400修仙币，100万灵石=10修仙币\n\n💡 在「充值」页面查看详情，充值后联系客服到账';
  }

  // ─── 充值/兑换码 ───
  if (q.includes('充值') || q.includes('兑换码')) {
    return '💰 充值流程：\n1. 在充值页面选择套餐\n2. 查看注意事项并确认\n3. 扫码支付\n4. 提交充值申请\n5. 管理员审核通过后自动生成兑换码\n6. 在坊市或充值页面输入兑换码激活修仙币\n\n🔑 也可以直接输入管理员给的兑换码到账\n\n您当前修仙币余额: ' + (user.bonus_points || 0);
  }

  // ─── 灵石/现金/支付 ───
  if (q.includes('灵石') || q.includes('现金') || q.includes('支付') || q.includes('付款')) {
    return '💳 支付方式：\n▸ 现金支付：微信/支付二维码，联系客服扫码\n▸ 灵石支付：消耗游戏内灵石，100万灵石=10修仙币\n▸ 基础汇率：1元 = 400修仙币\n\n💡 购买套餐更优惠，见「充值」页面';
  }

  // ─── 称号/等级 ───
  if (q.includes('称号') || q.includes('仙友') || q.includes('仙长') || q.includes('仙师') || q.includes('宗师') || q.includes('大宗师') || q.includes('仙王') || q.includes('尊者') || q.includes('道主') || q.includes('至尊') || q.includes('仙尊')) {
    return '🏆 等级称号系统：\nLv.1 仙友  | Lv.2 仙长  | Lv.3 仙师\nLv.4 宗师  | Lv.5 大宗师 | Lv.6 仙王\nLv.7 尊者  | Lv.8 道主  | Lv.9 至尊\nLv.10 仙尊\n\n您当前等级: Lv.' + (user.level || 1) + '\n💡 完成工单获得经验值提升等级，等级越高折扣越大！';
  }

  // ─── 余额/积分 ───
  if (q.includes('余额') || q.includes('修仙分') || q.includes('多少币')) {
    return '💎 您当前账户：\n修仙币: ' + (user.bonus_points || 0) + '\n邀请积分: ' + (user.invite_points || 0).toFixed(1) + '\n等级: Lv.' + (user.level || 1) + '\n\n前往「控制台」查看完整信息';
  }

  // ─── 订单/工单/状态/审核（原逻辑） ───
  if (q.includes('订单') || q.includes('工单') || q.includes('状态') || q.includes('审核')) {
    if (!orderInfo.results.length) return '您还没有提交过工单哦~\n前往控制台提交工单即可开始。';
    let reply = '📋 您的工单状态：\n';
    for (const o of orderInfo.results) {
      const statusMap = { pending: '⏳ 审核中', approved: '✅ 已通过', rejected: '❌ 已拒绝', completed: '🎉 已完成' };
      const estMap = { pending: '等待审核', approved: '处理中', rejected: '已拒绝', completed: '已完成' };
      reply += `  #${o.id} ${statusMap[o.status] || o.status} (${estMap[o.status] || ''})\n`;
    }
    return reply + '\n💡 发送 "订单 #编号" 查看详情';
  }

  if (/订单\s*#?\d+/.test(q)) {
    const match = q.match(/订单\s*#?(\d+)/);
    if (match) {
      const detail = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(match[1], user.id).first();
      if (detail) return `📦 工单 #${detail.id}\n邀请码: ${detail.invite_code}\n金额: ¥${detail.price}\n支付: ${detail.payment_method === 'wechat' ? '微信' : '灵石'}\n状态: ${detail.status}\n优惠: ${detail.discount}%\n预计完成: ${detail.est_complete_date || '审核中'}\n创建: ${detail.created_at}`;
      return '未找到该工单';
    }
  }

  // ─── 时间/到账（原逻辑） ───
  if (q.includes('多久') || q.includes('到账') || q.includes('时间') || q.includes('等待')) {
    return '⏱ 工单审核通过后，预计 5 天内完成账号注册和升级。如果超过时间请联系管理员。\n\n💰 修仙币充值：提交申请→管理员审核→自动生成兑换码→输入兑换码即刻到账';
  }

  // ─── 价格/多少钱（原逻辑，更新为修仙币信息） ───
  if (q.includes('价格') || q.includes('多少钱') || q.includes('收费')) {
    return '💰 价格说明：\n▸ 微信支付：1元 = 120邀请积分（工单）\n▸ 修仙币充值：1元 = 400修仙币\n▸ 灵石充值：100万灵石 = 10修仙币\n▸ 等级折扣：最高Lv.10 享70%优惠\n\n💡 等级越高越优惠，快去完成工单提升等级吧！';
  }

  // ─── 优惠/折扣/等级（原逻辑） ───
  if (q.includes('优惠') || q.includes('折扣') || q.includes('会员')) {
    return '📊 用户等级权益：\nLv.1 基础价格\nLv.2 解锁邀请系统\nLv.3 享10%优惠\nLv.4 享20%优惠\nLv.5 享30%优惠\nLv.6 享40%优惠\nLv.7 享45%优惠\nLv.8 享50%优惠\nLv.9 享60%优惠\nLv.10 享70%优惠\n\n您当前等级: Lv.' + (user.level || 1) + '\n每完成一单提升一级！';
  }

  // ─── 邀请/分成/佣金/推广（原逻辑） ───
  if (q.includes('邀请') || q.includes('分成') || q.includes('佣金') || q.includes('推广')) {
    return '🤝 邀请系统：\n▸ 在邀请页面生成你的专属邀请码\n▸ 分享给好友注册时填写\n▸ 好友订单审核通过后，你获得订单金额30%邀请积分\n▸ 邀请积分可提现或消费\n\n您的邀请码: ' + (user.invite_code || '前往控制台查看') + '\n积分余额: ' + (user.invite_points || 0).toFixed(1);
  }

  // ─── 账号/游戏/角色（原逻辑） ───
  if (q.includes('账号') || q.includes('游戏') || q.includes('角色')) {
    const accCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM game_accounts ga JOIN orders o ON ga.order_id = o.id WHERE o.user_id = ?').bind(user.id).first();
    if (accCount.cnt > 0) return '您共有 ' + accCount.cnt + ' 个游戏账号。前往「账号列表」查看详细等级、装备和地图信息。';
    return '您还没有游戏账号，提交工单审核通过后会自动创建。';
  }

  // ─── 售后/申诉/退款/投诉（原逻辑） ───
  if (q.includes('售后') || q.includes('申诉') || q.includes('退款') || q.includes('投诉')) {
    return '如需售后或申诉：\n1. 在控制台「申诉售后」页面提交申诉\n2. 填写相关工单编号和问题描述\n3. 管理员会在24小时内回复\n\n紧急情况请联系管理员直接处理。';
  }

  // ─── 问候（原逻辑） ───
  if (q.includes('你好') || q.includes('嗨') || q.includes('在吗') || q.includes('hello')) {
    return '你好 ' + (user.username || '道友') + '！我是艾德尔工单助手 🤖\n你可以问我：\n▸ "修仙币" - 了解坊市和充值\n▸ "我的订单状态" - 查看工单\n▸ "等级称号" - 了解称号系统\n▸ "优惠折扣" - 查看等级优惠\n▸ "邀请分成" - 邀请好友赚钱\n▸ "怎么充值" - 充值流程\n▸ "订单 #1" - 查看订单详情';
  }

  // ─── 帮助（原逻辑） ───
  if (q.includes('帮助') || q.includes('功能') || q.includes('能做什么')) {
    return '🤖 我可以回答这些问题：\n1. 修仙币/坊市/充值说明\n2. 等级称号系统\n3. 查看工单状态\n4. 查询价格和积分\n5. 了解等级折扣\n6. 邀请分成说明\n7. 预计到账时间\n8. 售后申诉流程\n9. 查看游戏账号信息\n\n直接输入问题即可~';
  }

  // ─── AI智能回复（新增） ───
  const aiConfig = await env.DB.prepare(
    "SELECT key, value FROM config WHERE key IN ('ai_api_key', 'ai_api_url', 'ai_model', 'ai_enabled')"
  ).all();
  const configMap = {};
  for (const c of (aiConfig.results || [])) configMap[c.key] = c.value;

  if (configMap['ai_enabled'] === 'true' && configMap['ai_api_key']) {
    const apiUrl = configMap['ai_api_url'] || 'https://api.openai.com/v1/chat/completions';
    const model = configMap['ai_model'] || 'gpt-3.5-turbo';
    try {
      const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + configMap['ai_api_key'],
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是艾德尔修仙工单平台的客服助手，回答要简洁友好，用中文回复。平台提供工单代练、修仙币充值、物品交易等服务。' },
            { role: 'user', content: question },
          ],
          max_tokens: 300,
        }),
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const reply = aiData.choices?.[0]?.message?.content || '';
        if (reply) return reply.trim();
      }
    } catch (e) {
      // AI 调用失败，回退兜底回复
    }
  }

  // ─── 兜底回复 ───
  const orderCount = orderInfo.results.length;
  const pendingOrders = orderInfo.results.filter(o => o.status === 'pending').length;
  return '抱歉，不太理解您的问题 🤔\n\n您有 ' + orderCount + ' 个工单，其中 ' + pendingOrders + ' 个待审核。\n\n试试问：\n- "修仙币" - 了解坊市和充值\n- "我的订单状态"\n- "等级称号"\n- "价格说明"\n- "优惠折扣"\n- "预计多久到账"';
}
