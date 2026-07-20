/**
 * deploy.js — Worker 部署脚本
 * ⚠️ 使用前请设置环境变量 CF_API_TOKEN 和 CF_ACCOUNT_ID
 * 或在 .env 文件中配置，切勿提交凭证到代码仓库
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const WORKER_NAME = process.env.WORKER_NAME || 'ider-order-system';

if (!TOKEN || !ACCOUNT_ID) {
  console.error('错误: 请设置 CF_API_TOKEN 和 CF_ACCOUNT_ID 环境变量');
  console.error('  set CF_API_TOKEN=your_token');
  console.error('  set CF_ACCOUNT_ID=your_account_id');
  process.exit(1);
}

// Read both worker scripts
let indexJs = fs.readFileSync(path.join(__dirname, 'worker', 'index.js'), 'utf8');
const staticJs = fs.readFileSync(path.join(__dirname, 'worker', 'static.js'), 'utf8');

// Bundle: replace the import with inline content
indexJs = indexJs.replace(
  /import\s*\{\s*renderStaticAsset\s*\}\s*from\s*['"]\.\/static['"]\s*;?/,
  staticJs
);

console.log(`Bundled script size: ${(indexJs.length / 1024).toFixed(1)} KB`);

// Build multipart form data
const boundary = '----FormBoundary' + Date.now().toString(16);
const parts = [];

const metadata = {
  main_module: 'index.js',
  compatibility_date: '2025-01-01',
  bindings: [
    {
      type: 'd1',
      name: 'DB',
      database_id: '9fd8cb75-d10e-4cf3-a0e0-3681e5a59ae8'
    }
  ],
  vars: {
    API_KEY: '',
    ENVIRONMENT: 'production',
    SITE_NAME: '艾德尔修仙工单平台'
  }
};

parts.push(
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="metadata"\r\n` +
  `Content-Type: application/json\r\n\r\n` +
  JSON.stringify(metadata) + '\r\n'
);

parts.push(
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="index.js"; filename="index.js"\r\n` +
  `Content-Type: application/javascript+module\r\n\r\n` +
  indexJs + '\r\n'
);

parts.push(`--${boundary}--\r\n`);

const body = Buffer.concat(parts.map(p => Buffer.from(p, 'utf8')));

async function deploy() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`;
  console.log(`Deploying worker "${WORKER_NAME}"...`);

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });
    const data = await res.json();
    if (data.success) {
      console.log('\n✓ Deployment successful!');
      console.log('Worker URL:', `https://${WORKER_NAME}.sifangzhiji.workers.dev`);
    } else {
      console.log('\n✗ Deployment failed:');
      console.log(JSON.stringify(data.errors, null, 2));
      process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

deploy();
