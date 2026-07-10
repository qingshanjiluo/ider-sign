// 单独注册 Turquoise18_v2（原 TurquoiseSparrow18_v2 超长失败后改用短名）
const crypto = require('crypto');
const fetch = require('node-fetch');

const BASE = 'http://47.97.108.58:3001';
const KEY = 'a7b3d9f1c4e8f2a6b0d3c5e7f9a1b3d5';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function sign(method, path, ts, body) {
  return crypto.createHmac('sha256', KEY).update(method + '\n' + path + '\n' + ts + '\n' + body).digest('hex');
}

function fakeIp(seed) {
  const segs = ['61.','59.','219.','218.','222.','113.','116.','118.','119.','120.'];
  const s = segs[seed % segs.length];
  return s + Math.floor(Math.random()*255) + '.' + (Math.floor(Math.random()*254)+1);
}

const ip = fakeIp(Date.now());

async function api(method, path, token, body) {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const h = {
    'Content-Type': 'application/json',
    'X-Client-Version': '0.22.5',
    'X-Sign-T': String(ts),
    'X-Sign': sign(method, path, ts, bodyStr),
    'X-Forwarded-For': ip,
    'X-Real-IP': ip,
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Connection': 'keep-alive'
  };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers: h, body: bodyStr });
  const txt = await r.text();
  let d;
  try { d = JSON.parse(txt); } catch (e) { throw new Error('非JSON: ' + txt.slice(0,200)); }
  return d;
}

async function main() {
  console.log('注册 Turquoise18_v2 ...');
  
  // 1. 注册
  const r1 = await api('POST', '/auth/register', null, {
    username: 'Turquoise18_v2',
    password: 'qwertyuiop',
    machine_id: 'fix_' + crypto.randomBytes(4).toString('hex')
  });
  if (!r1.ok) { console.log('✗ 注册失败:', r1.error); return; }
  console.log('✓ 注册成功, accountId=' + r1.accountId);
  const token = r1.token;

  // 2. 角色创建
  console.log('创建角色...');
  await new Promise(r => setTimeout(r, 2000));
  const r2 = await api('POST', '/player/create', token, { name: 'Turquoise18_v2' });
  if (!r2.ok) { console.log('✗ 创建角色失败:', r2.error); return; }
  console.log('✓ 角色创建成功');

  // 3. 绑定邀请码
  console.log('绑定邀请码...');
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await api('POST', '/invite/bind', token, { inviteCode: 'MDH9E2DY' });
  console.log(r3.ok ? '✓ 邀请码绑定成功' : 'ℹ ' + r3.error);

  // 4. 装备技能
  console.log('装备技能...');
  for (const skillId of [1, 2, 3]) {
    await new Promise(r => setTimeout(r, 1000));
    const r4 = await api('POST', '/player/equip-skill', token, { skillId });
    if (r4.ok) console.log('  ✓ 技能 ' + skillId + ' 装备成功');
    else console.log('  ⚠ ' + r4.error);
  }

  // 5. 铁剑
  console.log('装备铁剑...');
  await new Promise(r => setTimeout(r, 1000));
  const r5 = await api('POST', '/player/equip', token, { page: 0, slotIndex: 0 });
  if (r5.ok) console.log('✓ 铁剑装备成功');

  // 6. 吐纳法
  console.log('设置吐纳法...');
  await new Promise(r => setTimeout(r, 1000));
  const r6 = await api('POST', '/player/technique', token, { slot: 0, techniqueId: 1 });
  console.log(r6.ok ? '✓ 吐纳法设置成功' : '⚠ ' + r6.error);

  console.log('\n✅ Turquoise18_v2 注册全部完成');
  console.log('添加: Turquoise18_v2,qwertyuiop,MDH9E2DY');
}

main().catch(e => console.log('❌ 错误:', e.message));
