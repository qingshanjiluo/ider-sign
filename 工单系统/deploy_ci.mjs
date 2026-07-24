import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
const PROJECT = 'ider-order-system';
const ROOT = process.cwd();

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.cloudflare.com', path: `/client/v4/accounts/${ACCOUNT_ID}${urlPath}`,
      method, headers: { 'Authorization': `Bearer ${TOKEN}` },
    };
    if (bodyStr) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(bodyStr); }
    const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function deployPages() {
  const filesDir = path.join(ROOT, 'pages-frontend');
  const allFiles = [];
  allFiles.push({ rel: '/index.html', abs: path.join(filesDir, 'index.html') });
  const rfile = path.join(filesDir, '_redirects');
  if (fs.existsSync(rfile)) allFiles.push({ rel: '/_redirects', abs: rfile });
  function scan(dir, prefix) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const a = path.join(dir, e.name); if (e.isDirectory()) scan(a, prefix + '/' + e.name); else allFiles.push({ rel: prefix + '/' + e.name, abs: a }); } }
  scan(path.join(filesDir, 'src'), '/src');
  const pd = path.join(filesDir, 'public'); if (fs.existsSync(pd)) scan(pd, '/public');

  const manifest = {};
  for (const f of allFiles) {
    const content = fs.readFileSync(f.abs);
    manifest[f.rel] = { mime_type: { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' }[path.extname(f.abs)] || 'application/octet-stream', key: crypto.createHash('sha256').update(content).digest('hex'), size: content.length };
  }

  console.log(`[Pages] ${allFiles.length} files, creating deployment...`);
  const deploy = await api('POST', `/pages/projects/${PROJECT}/deployments`, { manifest });
  if (!deploy.success) { console.error('[Pages] Create deployment failed:', JSON.stringify(deploy.errors)); return false; }
  console.log('[Pages] Deployment created:', deploy.result.id);

  const uploadUrl = deploy.result.upload_url;
  if (uploadUrl) {
    for (const f of allFiles) {
      const url = uploadUrl + '/' + encodeURIComponent(f.rel);
      const content = fs.readFileSync(f.abs);
      await new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'PUT', headers: { 'Content-Length': content.length } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { resolve(); }); });
        req.on('error', reject);
        req.write(content);
        req.end();
      });
    }
    console.log('[Pages] All files uploaded');
  } else {
    console.log('[Pages] No upload_url, skipping upload');
  }
  console.log('[Pages] ✅ Deploy success! URL:', deploy.result.url);
  return true;
}

async function deployWorker() {
  const config = fs.readFileSync(path.join(ROOT, 'wrangler.worker.toml'), 'utf-8');
  const nameMatch = config.match(/^name\s*=\s*["'](.+?)["']/m);
  const mainMatch = config.match(/^main\s*=\s*["'](.+?)["']/m);
  if (!nameMatch || !mainMatch) { console.error('[Worker] Cannot parse wrangler.worker.toml'); return false; }
  const workerName = nameMatch[1];
  const workerFile = path.join(ROOT, mainMatch[1]);
  if (!fs.existsSync(workerFile)) { console.error('[Worker] Main file not found:', workerFile); return false; }

  const content = fs.readFileSync(workerFile, 'utf-8');
  const metadata = { main_module: path.basename(workerFile), bindings: [] };
  metadata.bindings.push({ type: 'd1', name: 'DB', id: '9fd8cb75-d10e-4cf3-a0e0-3681e5a59ae8' });
  metadata.bindings.push({ type: 'text', name: 'API_KEY', text: 'ider-gh-5fc9c4b0899ad14bc2ee55562eaa5b3a' });
  metadata.bindings.push({ type: 'text', name: 'ENVIRONMENT', text: 'production' });
  metadata.bindings.push({ type: 'text', name: 'SITE_NAME', text: '艾德尔修仙工单平台' });
  metadata.bindings.push({ type: 'text', name: 'CORS_ORIGIN', text: '' });

  const formData = JSON.stringify({ metadata });
  
  console.log(`[Worker] Deploying ${workerName}...`);
  const upload = await api('PUT', `/workers/scripts/${workerName}`, JSON.stringify({ metadata, code: content }));
  if (!upload.success) { console.error('[Worker] Upload failed:', JSON.stringify(upload.errors)); return false; }

  console.log('[Worker] ✅ Deploy success!');
  return true;
}

async function main() {
  if (!TOKEN || !ACCOUNT_ID) { console.error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID'); process.exit(1); }
  console.log('=== Deploy CI ===');
  const pagesOk = await deployPages();
  if (pagesOk) console.log('\n✅ Pages deployed');
  const workerOk = await deployWorker();
  if (workerOk) console.log('✅ Worker deployed');
  if (!pagesOk || !workerOk) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });