/**
 * 补绑 MistLynx 邀请码 H4K8UWWA
 * 账号已注册但未绑定邀请码
 * 
 * 注意: 服务器 sign.js 中间件要求:
 *   - X-Sign-T 头 (秒级时间戳)
 *   - X-Sign 头 (HMAC-SHA256 签名)
 */
const crypto = require('crypto');
const fetch = require('node-fetch');

const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

const USERNAME = 'MistLynx';
const PASSWORD = 'qwertyuiop';
const INVITE = 'H4K8UWWA';

function makeSign(method, path, timestamp, bodyStr) {
  const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(data);
  return hmac.digest('hex');
}

async function apiRequest(method, path, token, body, extraHeaders) {
  // 服务器签名中间件用秒级时间戳
  const ts = Math.floor(Date.now() / 1000);
  const tsStr = ts.toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, tsStr, bodyStr);
  
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': tsStr,
    'X-Sign': sign,
    'X-Forwarded-For': '61.152.' + (Math.floor(Math.random() * 245) + 3) + '.' + (Math.floor(Math.random() * 250) + 3),
    'X-Real-IP': '61.152.' + (Math.floor(Math.random() * 245) + 3) + '.' + (Math.floor(Math.random() * 250) + 3),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Connection': 'keep-alive',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const url = API_BASE + path;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
    return { status: res.status, ok: res.ok, data: json };
  } catch (e) {
    return { status: 0, ok: false, data: { error: e.message } };
  }
}

function log(tag, msg) {
  const t = new Date().toLocaleString('zh-CN', { hour12: false });
  console.log(`[${t}] [${tag}] ${msg}`);
}

async function main() {
  log(USERNAME, '=== 补绑邀请码 ===');

  // 1. 登录
  log(USERNAME, '登录中...');
  const loginRes = await apiRequest('POST', '/auth/login', null, {
    username: USERNAME, password: PASSWORD, client_version: CLIENT_VERSION,
  });
  if (!loginRes.ok) {
    log(USERNAME, '✗ 登录失败: ' + JSON.stringify(loginRes.data));
    return;
  }
  const token = loginRes.data.token;
  const accountId = loginRes.data.account_id;
  log(USERNAME, `✓ 登录成功 (ID: ${accountId})`);

  // 2. 绑定邀请码
  log(USERNAME, `绑定邀请码 ${INVITE}...`);
  const bindRes = await apiRequest('POST', '/invite/bind', token, { invite_code: INVITE });
  log(USERNAME, '绑定结果: ' + JSON.stringify(bindRes.data));

  if (bindRes.ok) {
    log(USERNAME, `✓ 邀请码绑定成功! 灵石: ${bindRes.data.stones || 0}`);
  } else {
    log(USERNAME, `✗ 绑定失败: ${bindRes.data.error || JSON.stringify(bindRes.data)}`);
  }

  console.log('\n完成!');
}

main().catch(e => console.error('异常:', e));
