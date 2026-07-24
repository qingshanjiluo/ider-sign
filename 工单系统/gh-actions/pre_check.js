/**
 * 工单扫描预检查 - 验证 Worker API 和游戏 API 可用性
 * 用于 GitHub Actions pre-check job
 */
const crypto = require('crypto');
// Node.js 20+ 内置 fetch，无需 node-fetch
const fs = require('fs');

const WORKER_URL = process.env.WORKER_URL || 'https://ider-order-system.sifangzhiji.workers.dev';
const API_KEY = process.env.API_KEY || 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a';
const API_BASE = process.env.API_BASE || 'https://idlexiuxianzhuan.cn';
const SIGN_KEY = process.env.SIGN_KEY || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
const CLIENT_VERSION = process.env.CLIENT_VERSION || '1.2.4';

// 启动前验证关键环境变量
if (!WORKER_URL || !API_BASE || !SIGN_KEY) {
  console.error('错误: 缺少关键环境变量 (WORKER_URL/API_BASE/SIGN_KEY)');
  process.exit(1);
}
console.log('[配置] WORKER_URL=' + WORKER_URL);
console.log('[配置] API_BASE=' + API_BASE);

function setOutput(key, value) {
  const outEnv = process.env.GITHUB_OUTPUT || '';
  if (outEnv) {
    fs.appendFileSync(outEnv, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

async function check() {
  let apiOk = false;
  let workerOk = false;

  // 检查 Worker API
  console.log('[预检查] 验证 Worker API...');
  try {
    const url = WORKER_URL.replace(/\/+$/, '') + '/api/gh/approved-orders';
    console.log('[Worker] 请求: ' + url);
    const r = await fetch(url, {
      headers: { 'X-API-Key': API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    workerOk = d.ok === true;
    if (!workerOk && d.error === '无效API密钥') {
      console.error('[Worker] ❌ API密钥不匹配 — GitHub Secret API_KEY 与 Worker 环境变量不一致');
      console.error('[Worker] 请在 https://github.com/qingshanjiluo/ider-sign/settings/secrets/actions 更新 API_KEY');
    }
    console.log('[Worker] ' + (workerOk ? '✅ 可用' : '❌ 不可用: ' + JSON.stringify(d)));
  } catch (e) {
    console.log('[Worker] ❌ 连接失败: ' + e.message);
  }

  // 检查游戏 API
  console.log('[预检查] 验证游戏 API...');
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/auth/register';
    const bodyStr = '';
    const hmac = crypto.createHmac('sha256', SIGN_KEY);
    hmac.update('POST\n' + path + '\n' + timestamp + '\n' + bodyStr);
    const sign = hmac.digest('hex');

    const url = API_BASE.replace(/\/+$/, '') + path;
    console.log('[Game API] 请求: ' + url);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': CLIENT_VERSION,
        'X-Sign-T': String(timestamp),
        'X-Sign': sign,
      },
      signal: AbortSignal.timeout(10000),
    });
    // 4xx/5xx 都算可达（服务在线）
    apiOk = r.status < 500;
    console.log('[Game API] ' + (apiOk ? '✅ 可达 (HTTP ' + r.status + ')' : '❌ 不可达 (HTTP ' + r.status + ')'));
  } catch (e) {
    console.log('[Game API] ❌ 连接失败: ' + e.message);
  }

  setOutput('api_ok', apiOk);
  setOutput('worker_ok', workerOk);

  if (!workerOk) {
    console.error('\n❌ Worker API 不可用，将跳过扫描');
    process.exit(1);
  }
}

check().catch(e => {
  console.error('致命错误:', e.message);
  process.exit(1);
});
