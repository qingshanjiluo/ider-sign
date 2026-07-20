/**
 * deploy_pages.js — Cloudflare Pages 部署脚本 (Direct Upload)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const PROJECT_NAME = 'ider-order-system';

if (!TOKEN || !ACCOUNT_ID) {
  console.error('错误: 请设置 CF_API_TOKEN 和 CF_ACCOUNT_ID 环境变量');
  process.exit(1);
}

function apiRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}${urlPath}`,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
      }
    };
    if (bodyStr && !Buffer.isBuffer(body)) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function uploadFileRaw(url, filePath) {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'PUT',
      headers: {
        'Content-Length': fileContent.length,
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(fileContent);
    req.end();
  });
}

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

async function main() {
  console.log('=== Cloudflare Pages 部署 ===\n');
  
  // 1. 扫描文件
  const filesDir = path.join(__dirname, 'pages-frontend');
  const files = [];
  
  files.push({ rel: '/index.html', abs: path.join(filesDir, 'index.html') });
  
  const redirectsFile = path.join(filesDir, '_redirects');
  if (fs.existsSync(redirectsFile)) {
    files.push({ rel: '/_redirects', abs: redirectsFile });
  }
  
  function scanDir(dir, relPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix + '/' + entry.name;
      if (entry.isDirectory()) scanDir(abs, rel);
      else files.push({ rel, abs });
    }
  }
  scanDir(path.join(filesDir, 'src'), '/src');
  const publicDir = path.join(filesDir, 'public');
  if (fs.existsSync(publicDir)) scanDir(publicDir, '/public');

  console.log(`扫描到 ${files.length} 个文件`);

  // 2. 构建 manifest
  const manifest = {};
  for (const file of files) {
    const content = fs.readFileSync(file.abs);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    manifest[file.rel] = {
      mime_type: MIME_TYPES[path.extname(file.abs)] || 'application/octet-stream',
      key: hash,
      size: content.length,
    };
  }

  // 3. 创建 deployment
  console.log('创建部署...');
  const deployRes = await apiRequest('POST', `/pages/projects/${PROJECT_NAME}/deployments`, {
    manifest: manifest,
    token: undefined,
  });

  if (!deployRes.success) {
    // 尝试 v2 API
    console.log('尝试 v2 API...');
    const deployRes2 = await apiRequest('POST', `/pages/projects/${PROJECT_NAME}/deployments`, {});
    console.log('v2 response:', JSON.stringify(deployRes2).substring(0, 500));
  } else {
    console.log('✓ 部署创建成功');
  }
}

main().catch(err => {
  console.error('部署错误:', err);
  process.exit(1);
});
