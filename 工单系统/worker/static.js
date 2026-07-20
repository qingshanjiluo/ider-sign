export async function renderStaticAsset(name, env) {
  switch (name) {
    case 'index.html': return HTML;
    default: return null;
  }
}

const C = `/* ─── Cyberpunk Theme ──────────────────────── */
:root {
  --cyber-cyan: #00f0ff;
  --cyber-magenta: #ff00aa;
  --cyber-yellow: #ffe600;
  --cyber-green: #00ff88;
  --cyber-red: #ff3344;
  --bg-deep: #06060f;
  --bg-dark: #0a0a1a;
  --bg-card: #0e0e24;
  --bg-card-hover: #12122e;
  --bg-input: #151530;
  --text-main: #c0c8e0;
  --text-dim: #5a6080;
  --text-bright: #e8ecff;
  --border-glow: rgba(0,240,255,0.15);
  --border-magenta: rgba(255,0,170,0.2);
  --shadow-cyan: 0 0 15px rgba(0,240,255,0.15);
  --shadow-magenta: 0 0 15px rgba(255,0,170,0.15);
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Courier New', 'Consolas', monospace;
  background: var(--bg-deep);
  color: var(--text-main);
  min-height: 100vh;
  overflow-x: hidden;
  line-height: 1.6;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg-deep); }
::-webkit-scrollbar-thumb { background: var(--cyber-cyan); border-radius: 3px; }

a { color: var(--cyber-cyan); text-decoration: none; transition: all .3s; }
a:hover { text-shadow: 0 0 12px var(--cyber-cyan); }

/* ─── Scanline overlay ──────────────── */
.scanline {
  position: fixed; top:0; left:0; right:0; bottom:0;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,240,255,0.015) 2px, rgba(0,240,255,0.015) 4px);
  pointer-events: none; z-index: 9999;
}
.scanline::after {
  content: ''; position: absolute; top:0; left:0; right:0; height:100px;
  background: linear-gradient(180deg, rgba(0,240,255,0.03), transparent);
  animation: scanMove 6s linear infinite;
}
@keyframes scanMove {
  0% { top: -100px; }
  100% { top: 100vh; }
}

/* ─── Glitch text ──────────────────── */
.glitch {
  position: relative;
  animation: glitchPulse 3s infinite;
}
@keyframes glitchPulse {
  0%, 90%, 100% { text-shadow: 0 0 20px var(--cyber-cyan), 0 0 40px var(--cyber-cyan); }
  95% { text-shadow: -2px 0 var(--cyber-magenta), 2px 0 var(--cyber-cyan); }
}

/* ─── Nav ──────────────────────────── */
nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 32px;
  border-bottom: 1px solid var(--border-glow);
  background: rgba(6,6,15,0.92);
  backdrop-filter: blur(12px);
  position: sticky; top:0; z-index: 1000;
}
nav .logo {
  font-size: 1.2em; font-weight: bold;
  color: var(--cyber-cyan); text-shadow: 0 0 15px var(--cyber-cyan);
  letter-spacing: 2px;
}
nav .logo span { color: var(--cyber-magenta); }
nav .nav-links { display: flex; gap: 18px; align-items: center; }
nav .nav-links a {
  font-size: 0.82em; text-transform: uppercase; letter-spacing: 1.5px;
  color: var(--text-dim); transition: all .3s;
  padding: 6px 0;
  border-bottom: 1px solid transparent;
}
nav .nav-links a:hover { color: var(--cyber-cyan); border-bottom-color: var(--cyber-cyan); }
nav .nav-links .btn-link { border-bottom: none; padding: 6px 16px; }
.nav-badge {
  display: inline-block; background: var(--cyber-magenta); color: #fff;
  font-size: 0.65em; padding: 1px 6px; border-radius: 8px;
  margin-left: 2px; vertical-align: top;
}

/* ─── Buttons ──────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 22px;
  border: 1px solid var(--cyber-cyan);
  color: var(--cyber-cyan); background: transparent;
  font-family: inherit; font-size: 0.85em; cursor: pointer;
  text-transform: uppercase; letter-spacing: 1.5px;
  transition: all .3s; position: relative; overflow: hidden;
}
.btn::before {
  content: ''; position: absolute; top:0; left:-100%; width:100%; height:100%;
  background: linear-gradient(90deg, transparent, rgba(0,240,255,0.1), transparent);
  transition: left .5s;
}
.btn:hover::before { left: 100%; }
.btn:hover {
  background: rgba(0,240,255,0.08);
  box-shadow: var(--shadow-cyan);
  border-color: var(--cyber-cyan);
}
.btn-magenta { border-color: var(--cyber-magenta); color: var(--cyber-magenta); }
.btn-magenta:hover { background: rgba(255,0,170,0.08); box-shadow: var(--shadow-magenta); }
.btn-green { border-color: var(--cyber-green); color: var(--cyber-green); }
.btn-green:hover { background: rgba(0,255,136,0.08); box-shadow: 0 0 15px rgba(0,255,136,0.15); }
.btn-yellow { border-color: var(--cyber-yellow); color: var(--cyber-yellow); }
.btn-red { border-color: var(--cyber-red); color: var(--cyber-red); }
.btn-red:hover { background: rgba(255,51,68,0.08); }
.btn-sm { padding: 5px 14px; font-size: 0.78em; }
.btn-block { width: 100%; justify-content: center; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ─── Container ────────────────────── */
.container { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
.page-title {
  font-size: 1.4em; text-transform: uppercase;
  color: var(--cyber-cyan);
  margin-bottom: 20px; letter-spacing: 3px;
  display: flex; align-items: center; gap: 12px;
}
.page-title .sub { font-size: 0.5em; color: var(--text-dim); letter-spacing: 1px; font-weight: normal; }
.section-title {
  color: var(--cyber-magenta); font-size: 0.9em; text-transform: uppercase;
  letter-spacing: 2px; margin-bottom: 12px; padding-bottom: 8px;
  border-bottom: 1px solid var(--border-magenta);
}

/* ─── Hero ─────────────────────────── */
.hero {
  text-align: center; padding: 100px 20px 60px;
  position: relative; overflow: hidden;
}
.hero::before {
  content: ''; position: absolute; top:50%; left:50%;
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(0,240,255,0.04), transparent 70%);
  transform: translate(-50%,-50%);
  pointer-events: none;
}
.hero h1 {
  font-size: 2.8em; text-transform: uppercase; line-height: 1.2;
  text-shadow: 0 0 30px var(--cyber-cyan), 0 0 60px var(--cyber-cyan);
  margin-bottom: 16px; position: relative;
}
.hero h1 .highlight { color: var(--cyber-magenta); text-shadow: 0 0 30px var(--cyber-magenta); }
.hero p { font-size: 1.1em; color: var(--text-dim); max-width: 640px; margin: 0 auto 36px; line-height: 1.8; }
.hero .btn-group { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.hero-stats {
  display: flex; justify-content: center; gap: 40px; margin-top: 50px; flex-wrap: wrap;
}
.hero-stat { text-align: center; }
.hero-stat .num { font-size: 2em; color: var(--cyber-cyan); text-shadow: 0 0 15px var(--cyber-cyan); }
.hero-stat .label { font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }

/* ─── Grid / Cards ─────────────────── */
.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: 1fr 1fr; }
.grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.grid-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
.card {
  background: var(--bg-card); padding: 20px;
  border: 1px solid var(--border-glow);
  transition: all .3s;
}
.card:hover { border-color: rgba(0,240,255,0.25); }
.card h3 { color: var(--cyber-cyan); font-size: 0.9em; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
.card .stat { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85em; }
.card .stat:last-child { border-bottom: none; }
.card .stat .label { color: var(--text-dim); }
.card .stat .value { color: var(--text-bright); font-weight: bold; }
.feature-card {
  background: var(--bg-card); padding: 28px 24px;
  border: 1px solid var(--border-glow);
  position: relative;
}
.feature-card::before {
  content: '//'; position: absolute; top:8px; right:14px;
  color: var(--cyber-magenta); opacity: 0.4; font-size: 0.9em;
}
.feature-card h3 { color: var(--cyber-cyan); margin-bottom: 10px; font-size: 1em; letter-spacing: 1px; }
.feature-card p { color: var(--text-dim); font-size: 0.85em; line-height: 1.7; }
.price-card {
  background: var(--bg-card); padding: 32px 24px;
  border: 1px solid var(--border-glow);
  text-align: center; transition: all .3s;
}
.price-card.featured { border-color: var(--cyber-magenta); box-shadow: 0 0 20px rgba(255,0,170,0.1); }
.price-card .price { font-size: 2.2em; color: var(--cyber-cyan); text-shadow: 0 0 15px var(--cyber-cyan); margin: 12px 0; }
.price-card .price span { font-size: 0.45em; color: var(--text-dim); }
.price-card h3 { color: var(--cyber-magenta); font-size: 1.1em; letter-spacing: 2px; text-transform: uppercase; }
.price-card ul { list-style: none; text-align: left; margin: 16px 0; }
.price-card ul li { padding: 5px 0; color: var(--text-dim); font-size: 0.85em; }
.price-card ul li::before { content: '▸ '; color: var(--cyber-cyan); }

/* ─── Forms ────────────────────────── */
input, select, textarea {
  width: 100%; padding: 10px 14px;
  background: var(--bg-input); border: 1px solid var(--border-glow);
  color: var(--text-main); font-family: inherit; font-size: 0.88em;
  outline: none; transition: all .3s;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--cyber-cyan);
  box-shadow: 0 0 12px rgba(0,240,255,0.15);
}
label { display: block; margin-bottom: 5px; color: var(--cyber-cyan); font-size: 0.78em; text-transform: uppercase; letter-spacing: 1.5px; }
.form-group { margin-bottom: 18px; }
.form-row { display: flex; gap: 16px; }
.form-row > * { flex: 1; }

/* ─── Badges ───────────────────────── */
.badge {
  display: inline-block; padding: 2px 10px; font-size: 0.75em;
  text-transform: uppercase; letter-spacing: 1px; border: 1px solid;
}
.badge-pending { border-color: var(--cyber-yellow); color: var(--cyber-yellow); }
.badge-approved { border-color: var(--cyber-green); color: var(--cyber-green); }
.badge-rejected { border-color: var(--cyber-red); color: var(--cyber-red); }
.badge-completed { border-color: var(--cyber-cyan); color: var(--cyber-cyan); }
.badge-registering, .badge-creating { border-color: var(--cyber-yellow); color: var(--cyber-yellow); }
.badge-farming, .badge-active { border-color: var(--cyber-magenta); color: var(--cyber-magenta); }
.badge-failed, .badge-error { border-color: var(--cyber-red); color: var(--cyber-red); }
.badge-info { border-color: var(--cyber-cyan); color: var(--cyber-cyan); }

/* ─── Table ────────────────────────── */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.04); white-space: nowrap; }
th { color: var(--cyber-cyan); text-transform: uppercase; letter-spacing: 1px; font-size: 0.75em; font-weight: normal; }
tr:hover td { background: rgba(0,240,255,0.03); }
td .mono { font-size: 0.9em; color: var(--text-dim); }

/* ─── Modal ────────────────────────── */
.modal-overlay {
  display: none; position: fixed; top:0;left:0;right:0;bottom:0;
  background: rgba(0,0,0,0.85); z-index: 2000;
  justify-content: center; align-items: center;
  backdrop-filter: blur(4px);
}
.modal-overlay.show { display: flex; }
.modal {
  background: var(--bg-card); padding: 28px;
  border: 1px solid var(--border-glow);
  max-width: 520px; width: 92%; max-height: 85vh; overflow-y: auto;
}
.modal h2 { color: var(--cyber-cyan); margin-bottom: 16px; font-size: 1.1em; text-transform: uppercase; letter-spacing: 2px; }
.modal .btn-group { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }

/* ─── Tabs ─────────────────────────── */
.tabs { display: flex; gap: 2px; margin-bottom: 20px; border-bottom: 1px solid var(--border-glow); overflow-x: auto; }
.tab {
  padding: 10px 22px; cursor: pointer;
  color: var(--text-dim); border-bottom: 2px solid transparent;
  text-transform: uppercase; letter-spacing: 1.5px; font-size: 0.8em;
  transition: all .3s; white-space: nowrap;
}
.tab.active { color: var(--cyber-cyan); border-bottom-color: var(--cyber-cyan); }
.tab:hover { color: var(--text-main); }
.tab-content { display: none; }
.tab-content.active { display: block; }

/* ─── Chat ─────────────────────────── */
.chat-box {
  background: var(--bg-input); border: 1px solid var(--border-glow);
  height: 300px; overflow-y: auto; padding: 16px; margin-bottom: 12px;
  scroll-behavior: smooth;
}
.chat-msg { margin-bottom: 14px; }
.chat-msg .sender { font-size: 0.72em; color: var(--cyber-cyan); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 1px; }
.chat-msg .sender-bot { color: var(--cyber-magenta); }
.chat-msg .text { color: var(--text-main); font-size: 0.88em; line-height: 1.6; white-space: pre-wrap; }
.chat-row { display: flex; gap: 8px; }
.chat-row input { flex: 1; }

/* ─── Progress ─────────────────────── */
.progress-bar {
  height: 4px; background: var(--bg-input); margin: 8px 0; position: relative;
}
.progress-bar .fill {
  height: 100%; background: linear-gradient(90deg, var(--cyber-cyan), var(--cyber-magenta));
  transition: width 1s;
}

/* ─── Loader ───────────────────────── */
.loader {
  display: inline-block; width: 20px; height: 20px;
  border: 2px solid var(--border-glow); border-top-color: var(--cyber-cyan);
  border-radius: 50%; animation: spin .6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Empty state ──────────────────── */
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-dim); }
.empty-state .icon { font-size: 3em; margin-bottom: 12px; opacity: 0.5; }
.empty-state p { font-size: 0.9em; }

/* ─── Toast ────────────────────────── */
.toast-container {
  position: fixed; top: 80px; right: 20px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px;
}
.toast {
  padding: 12px 20px; border: 1px solid;
  font-size: 0.85em; backdrop-filter: blur(8px);
  animation: slideIn .3s ease;
  max-width: 380px;
}
.toast-success { background: rgba(0,255,136,0.1); border-color: var(--cyber-green); color: var(--cyber-green); }
.toast-error { background: rgba(255,51,68,0.1); border-color: var(--cyber-red); color: var(--cyber-red); }
.toast-info { background: rgba(0,240,255,0.1); border-color: var(--cyber-cyan); color: var(--cyber-cyan); }
@keyframes slideIn { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }

/* ─── Level badges ─────────────────── */
.level-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border: 1px solid var(--cyber-cyan); font-size: 0.75em;
  letter-spacing: 1px; text-transform: uppercase;
}
.level-badge.high { border-color: var(--cyber-magenta); color: var(--cyber-magenta); }

/* ─── Show/hide ────────────────────── */
.hidden { display: none !important; }
.text-center { text-align: center; }
.mt-10 { margin-top: 10px; }
.mt-20 { margin-top: 20px; }
.mb-10 { margin-bottom: 10px; }
.mb-20 { margin-bottom: 20px; }
.flex { display: flex; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.gap-10 { gap: 10px; }
.gap-20 { gap: 20px; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }

/* ─── Responsive ───────────────────── */
@media (max-width: 900px) {
  .grid-4 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 768px) {
  nav { flex-direction: column; gap: 10px; padding: 10px 16px; }
  nav .nav-links { flex-wrap: wrap; justify-content: center; gap: 8px; }
  .hero h1 { font-size: 1.6em; }
  .hero { padding: 60px 16px 40px; }
  .form-row { flex-direction: column; gap: 0; }
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
  .hero-stats { gap: 20px; }
  .toast-container { left: 20px; right: 20px; }
}`;

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>艾德尔修仙工单平台</title>
<style>${C}</style>
</head>
<body>
<div class="scanline"></div>
<div id="toast-container" class="toast-container"></div>

<nav id="nav">
  <div class="logo">⚡ 艾德尔<span>工单</span></div>
  <div class="nav-links" id="nav-links">
    <a href="#" data-page="landing">首页</a>
    <a href="#" data-page="control">功能介绍</a>
    <a href="#" data-page="docs">文档</a>
    <a href="#" id="nav-invite" class="hidden" data-page="invite">邀请</a>
    <a href="#" id="nav-notif" class="hidden" data-page="notifications">
      通知 <span id="notif-badge" class="nav-badge hidden">0</span>
    </a>
    <a href="#" id="nav-admin" class="hidden" data-page="admin">管理</a>
    <a class="btn btn-magenta btn-sm btn-link" id="nav-login" href="#" data-page="login">登录</a>
    <a class="btn btn-sm btn-link" id="nav-register" href="#" data-page="register">注册</a>
    <a class="btn btn-green btn-sm btn-link hidden" id="nav-dashboard" href="#" data-page="dashboard">控制台</a>
    <a class="btn btn-sm btn-link hidden" id="nav-logout" href="#" onclick="logout()">退出</a>
  </div>
</nav>

<div id="app"></div>

<script>
// ─── State ──────────────────────────────────
let TOKEN = localStorage.getItem('token') || '';
let USER = null;
const API = window.location.origin;
let notifInterval = null;
const LEVEL_DISCOUNTS = { 1:0, 2:0, 3:10, 4:20, 5:30, 6:40, 7:45, 8:50, 9:60, 10:70 };

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body && typeof body === 'object') opt.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opt);
    const data = await r.json();
    return data;
  } catch (e) {
    return { error: '网络错误: ' + e.message };
  }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}
function statusBadge(s) {
  const m = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成',
    registering:'📝注册中', creating:'📝创建中', farming:'⚔️挂机中', active:'⚔️活跃', failed:'❌失败', error:'⚠️异常' };
  return '<span class="badge badge-' + s + '">' + (m[s] || s) + '</span>';
}

// ─── Pages ──────────────────────────────────
const P = {};

P.landing = () => \`
<div class="hero">
  <h1>⚡ 赛博修仙 <span class="highlight">自动化平台</span></h1>
  <p>艾德尔修仙传 · 专业邀请积分代练平台<br>一键提交工单 · 全自动注册 · 智能升级至120级 · 全程实时监控</p>
  <div class="btn-group">
    <a class="btn btn-magenta" href="#" onclick="showPage('register');return false">🚀 立即注册</a>
    <a class="btn" href="#" onclick="showPage('control');return false">📖 了解详情</a>
    <a class="btn btn-green" href="#" onclick="showPage('dashboard');return false">💻 进入控制台</a>
  </div>
  <div class="hero-stats" id="hero-stats">
    <div class="hero-stat"><div class="num">-</div><div class="label">注册用户</div></div>
    <div class="hero-stat"><div class="num">-</div><div class="label">工单总数</div></div>
    <div class="hero-stat"><div class="num">-</div><div class="label">已完成</div></div>
    <div class="hero-stat"><div class="num">-</div><div class="label">在线账号</div></div>
  </div>
</div>

<div class="container">
  <h2 class="page-title">// 核心功能</h2>
  <div class="grid grid-3">
    <div class="feature-card">
      <h3>⚡ 自动注册</h3>
      <p>提交工单后自动注册游戏账号，配置全满金灵根，自动装配铁剑、学习基础技能和功法。</p>
    </div>
    <div class="feature-card">
      <h3>🏯 智能升级</h3>
      <p>每日自动检测账号状态，自动点击升级/突破，直达120级后自动停止，全程无需人工干预。</p>
    </div>
    <div class="feature-card">
      <h3>🤝 邀请分成</h3>
      <p>生成专属邀请码分享给好友，好友成交后获得30%积分返还，多邀多得，上不封顶。</p>
    </div>
    <div class="feature-card">
      <h3>📊 实时监控</h3>
      <p>实时查看每个账号的等级、地图位置、技能功法、装备信息，进度一目了然。</p>
    </div>
    <div class="feature-card">
      <h3>🎯 等级优惠</h3>
      <p>成交越多等级越高，最高Lv.10享70%折扣。优惠码可与等级折扣叠加，超值实惠。</p>
    </div>
    <div class="feature-card">
      <h3>🛡️ 防封保障</h3>
      <p>每账号独立运营商IP · 随机机器码 · 浏览器指纹轮换 · 智能延迟 · 自动暂停，全方位防检测。</p>
    </div>
  </div>

  <h2 class="page-title mt-20">// 价格方案</h2>
  <div class="grid grid-3">
    <div class="price-card">
      <h3>💎 基础款</h3>
      <div class="price">1 <span>元</span></div>
      <ul>
        <li>120 邀请积分</li>
        <li>自动注册游戏账号</li>
        <li>全金灵根·铁剑·技能</li>
        <li>荒石村自动刷怪</li>
        <li>每日健康检测升级</li>
      </ul>
      <a class="btn btn-block" href="#" onclick="showPage('register');return false">开始下单</a>
    </div>
    <div class="price-card featured">
      <h3>💎 灵石款</h3>
      <div class="price">100万 <span>灵石</span></div>
      <ul>
        <li>10 邀请积分</li>
        <li>自动注册游戏账号</li>
        <li>全金灵根·铁剑·技能</li>
        <li>荒石村自动刷怪</li>
        <li>每日健康检测升级</li>
      </ul>
      <a class="btn btn-magenta btn-block" href="#" onclick="showPage('register');return false">开始下单</a>
    </div>
    <div class="price-card">
      <h3>🏆 高级会员</h3>
      <div class="price">量大 <span>优惠</span></div>
      <ul>
        <li>等级越高折扣越多</li>
        <li>最高 Lv.10 享70%优惠</li>
        <li>邀请好友享30%分成</li>
        <li>专属客服支持</li>
        <li>优先交付处理</li>
      </ul>
      <a class="btn btn-green btn-block" href="#" onclick="showPage('register');return false">立即咨询</a>
    </div>
  </div>

  <h2 class="page-title mt-20">// 用户等级特权</h2>
  <div class="grid grid-5" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
    ${[1,2,3,4,5,6,7,8,9,10].map(l => \`
      <div class="card" style="text-align:center;padding:16px">
        <div class="level-badge \${l >= 5 ? 'high' : ''}" style="display:inline-flex;margin-bottom:8px">Lv.\${l}</div>
        <div style="font-size:0.75em;color:var(--text-dim)">\${l===1?'基础价':l===2?'解锁邀请':LEVEL_DISCOUNTS[l]+'%优惠'}</div>
        <div style="font-size:0.7em;color:var(--text-dim);margin-top:4px">\${[0,0,1,3,5,10,20,35,50,75,100][l]}单解锁</div>
      </div>
    \`).join('')}
  </div>
</div>
\`;

P.control = () => \`
<div class="container">
  <h2 class="page-title">// 功能介绍</h2>
  <div class="grid grid-2">
    <div class="card"><h3>📋 工单系统</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">提交购买工单，填写邀请码、支付方式和金额。管理员审核到账后自动开始处理流程。</p>
    </div>
    <div class="card"><h3>🤖 自动化流程</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">审核通过 → GitHub Actions 扫描 → 自动注册 → 全满金灵根 → 装配铁剑/技能/功法 → 切换荒石村 → 开始刷怪 → 每日健康检测 → 自动升级到120级 → 2天后停止监控</p>
    </div>
    <div class="card"><h3>💎 账号规格</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">✅ 全满金属性灵根<br>✅ 自动装配铁剑<br>✅ 学习重击+火球术技能<br>✅ 修炼吐纳法功法<br>✅ 自动切换荒石村刷怪<br>✅ 每日自动检测升级</p>
    </div>
    <div class="card"><h3>🛡️ 防封策略</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">✅ 每账号独立伪造运营商IP(31段池)<br>✅ 独立机器码(6种格式轮换)<br>✅ 浏览器指纹轮换(12种UA)<br>✅ 多CDN代理头模拟<br>✅ 操作间随机延迟<br>✅ 每3-5账号智能暂停</p>
    </div>
    <div class="card"><h3>📊 数据监控</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">实时查看账号等级、地图位置、技能装备、在线状态。到达120级后2天自动停止检测，发送完成通知。</p>
    </div>
    <div class="card"><h3>🎯 交付标准</h3>
      <p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">等级到达120级即视为完成。完成后保留2天监控期，期间如有异常可申诉。支持售后和退款申请。</p>
    </div>
  </div>
</div>
\`;

P.docs = () => \`
<div class="container">
  <h2 class="page-title">// 使用文档</h2>
  <div class="grid grid-2">
    <div class="card"><h3>📝 如何下单</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">1. 注册账号并登录<br>2. 进入控制台，点击「提交工单」<br>3. 填写需要注册的邀请码<br>4. 选择支付方式（微信/灵石）<br>5. 填写付款账号名方便核实<br>6. 可填写优惠码获得额外折扣<br>7. 提交后等待管理员审核<br>8. 审核通过后自动开始处理</p>
    </div>
    <div class="card"><h3>💰 价格说明</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">微信支付：1 元 = 120 邀请积分<br>灵石支付：100 万灵石 = 10 邀请积分<br>每单可以要求多个账号（按积分计算）<br>最高可享70%等级折扣（Lv.10）<br>优惠码可叠加使用，折上折！</p>
    </div>
    <div class="card"><h3>🎯 用户等级</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">每完成一单提升一级，等级越高折扣越多：<br>Lv.1 基础价 · Lv.2 解锁邀请<br>Lv.3 10% · Lv.4 20% · Lv.5 30%<br>Lv.6 40% · Lv.7 45% · Lv.8 50%<br>Lv.9 60% · Lv.10 70% 🏆</p>
    </div>
    <div class="card"><h3>🤝 邀请分成</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">在邀请页面生成专属邀请码，分享给好友<br>好友注册时填写你的邀请码<br>好友订单审核通过后，你获得30%返利<br>邀请积分可以提现或消费<br>邀请越多，赚得越多！</p>
    </div>
    <div class="card"><h3>⏱️ 预计时间</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">工单审核：管理员确认到账后通过（通常24h内）<br>注册时间：审核通过后开始自动注册<br>升级周期：约5天到达120级<br>完成后：到达120级后2天停止检测<br>全程进度可在「账号列表」查看</p>
    </div>
    <div class="card"><h3>🆘 售后申诉</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.8">如遇问题可在「申诉售后」页面提交申诉<br>包括：账号异常、超时未完成、等级不符等<br>管理员24小时内回复处理<br>必要时可联系客服机器人咨询进度</p>
    </div>
  </div>
</div>
\`;

P.login = () => \`
<div class="container" style="max-width:420px">
  <h2 class="page-title">// 登录</h2>
  <div class="card">
    <div class="form-group">
      <label>用户名</label>
      <input id="login-user" placeholder="输入用户名" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input id="login-pass" type="password" placeholder="输入密码" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <button class="btn btn-magenta btn-block" onclick="doLogin()">登录</button>
    <p class="mt-20 text-center" style="color:var(--text-dim);font-size:0.82em">还没有账号？<a href="#" onclick="showPage('register');return false">立即注册</a></p>
  </div>
</div>
\`;

P.register = () => \`
<div class="container" style="max-width:420px">
  <h2 class="page-title">// 注册</h2>
  <div class="card">
    <div class="form-group">
      <label>用户名</label>
      <input id="reg-user" placeholder="3-20字符，字母数字">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input id="reg-pass" type="password" placeholder="至少6位">
    </div>
    <div class="form-group">
      <label>邮箱（选填）</label>
      <input id="reg-email" type="email" placeholder="用于接收通知">
    </div>
    <div class="form-group">
      <label>邀请码（选填）</label>
      <input id="reg-invite" placeholder="填写邀请人的邀请码获得优惠">
    </div>
    <div class="form-group">
      <label style="color:var(--text-dim);font-size:0.72em">⚠️ 每IP仅可注册一个账号</label>
    </div>
    <button class="btn btn-magenta btn-block" onclick="doRegister()">注册</button>
    <p class="mt-20 text-center" style="color:var(--text-dim);font-size:0.82em">已有账号？<a href="#" onclick="showPage('login');return false">登录</a></p>
  </div>
</div>
\`;

P.dashboard = () => \`
<div class="container">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">// 控制台</h2>
    <div class="flex gap-10 flex-wrap">
      <button class="btn btn-magenta btn-sm" onclick="showNewOrder()">+ 提交工单</button>
      <button class="btn btn-yellow btn-sm" onclick="showPage('invite')">🤝 邀请</button>
      <button class="btn btn-green btn-sm" onclick="showPage('accounts')">📊 账号</button>
      <button class="btn btn-sm" onclick="showPage('appeals')">📮 申诉</button>
    </div>
  </div>

  <div class="grid grid-4" id="dash-stats">
    <div class="card"><h3>👤 用户名</h3><div class="stat"><span class="label">等级</span><span class="value" id="d-level">-</span></div><div class="stat"><span class="label">工单数</span><span class="value" id="d-orders">-</span></div></div>
    <div class="card"><h3>💳 财务</h3><div class="stat"><span class="label">总消费</span><span class="value" id="d-spent">¥0</span></div><div class="stat"><span class="label">邀请积分</span><span class="value" id="d-points">0</span></div></div>
    <div class="card"><h3>🤝 邀请</h3><div class="stat"><span class="label">邀请码</span><span class="value" id="d-invite" style="font-size:0.85em">-</span></div><div class="stat"><span class="label">已邀请</span><span class="value" id="d-invited">0</span></div></div>
    <div class="card"><h3>🏆 优惠</h3><div class="stat"><span class="label">当前等级</span><span class="value" id="d-level2">-</span></div><div class="stat"><span class="label">等级折扣</span><span class="value" id="d-discount" style="color:var(--cyber-green)">0%</span></div></div>
  </div>

  <div class="grid grid-2 mt-20" style="grid-template-columns:1.2fr 0.8fr">
    <div class="card" style="overflow:hidden">
      <h3>📋 我的工单</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>邀请码</th><th>金额</th><th>状态</th><th>进度</th><th>时间</th></tr></thead>
          <tbody id="dash-orders"><tr><td colspan="6" class="text-center" style="color:var(--text-dim);padding:30px">暂无工单</td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>🤖 客服助手</h3>
      <div class="chat-box" id="chat-box">
        <div class="chat-msg"><div class="sender sender-bot">🤖 助手</div><div class="text">你好！我是艾德尔工单助手，你可以问我：\n- "我的订单状态"\n- "价格说明"\n- "预计多久到账"</div></div>
      </div>
      <div class="chat-row">
        <input id="chat-input" placeholder="输入问题..." onkeydown="if(event.key==='Enter')askBot()">
        <button class="btn btn-magenta btn-sm" onclick="askBot()">发送</button>
      </div>
    </div>
  </div>
</div>
\`;

P.admin = () => \`
<div class="container">
  <h2 class="page-title">// 管理后台 <span class="sub">管理员</span></h2>
  <div class="tabs">
    <div class="tab active" onclick="switchTab(this,'ap-orders')">📋 工单</div>
    <div class="tab" onclick="switchTab(this,'ap-accounts')">🎮 账号</div>
    <div class="tab" onclick="switchTab(this,'ap-users')">👥 用户</div>
    <div class="tab" onclick="switchTab(this,'ap-appeals')">📮 申诉</div>
    <div class="tab" onclick="switchTab(this,'ap-config')">⚙️ 配置</div>
  </div>

  <div class="tab-content active" id="ap-orders">
    <div class="flex-between mb-10 flex-wrap" style="gap:8px">
      <h3 style="color:var(--cyber-cyan);font-size:0.9em;text-transform:uppercase">工单管理</h3>
      <div class="flex gap-10">
        <button class="btn btn-sm" onclick="adminLoadOrders('')">全部</button>
        <button class="btn btn-yellow btn-sm" onclick="adminLoadOrders('pending')">待审核</button>
        <button class="btn btn-green btn-sm" onclick="adminLoadOrders('approved')">已通过</button>
        <button class="btn btn-sm" onclick="adminLoadOrders('completed')">已完成</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>用户</th><th>邀请码</th><th>方式</th><th>金额</th><th>积分</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="admin-orders-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-accounts">
    <div class="card"><h3>游戏账号</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户</th><th>游戏账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查时间</th></tr></thead><tbody id="admin-accounts-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-users">
    <div class="card"><h3>用户列表</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户名</th><th>等级</th><th>工单</th><th>消费</th><th>积分</th><th>邀请码</th><th>锁定</th><th>注册时间</th></tr></thead><tbody id="admin-users-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-appeals">
    <div class="card"><h3>申诉管理</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>用户</th><th>标题</th><th>类型</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="admin-appeals-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-config">
    <div class="card"><h3>系统配置</h3><div id="admin-config"></div></div>
  </div>
</div>
\`;

P.invite = () => \`
<div class="container" style="max-width:640px">
  <h2 class="page-title">// 邀请系统</h2>
  <div class="grid grid-2">
    <div class="card">
      <h3>🤝 我的邀请码</h3>
      <div class="stat"><span class="label">邀请码</span><span class="value" id="inv-code" style="font-size:1.1em;color:var(--cyber-magenta)">-</span></div>
      <div class="stat"><span class="label">已邀请人数</span><span class="value" id="inv-count">0</span></div>
      <div class="stat"><span class="label">成交返利次数</span><span class="value" id="inv-orders">0</span></div>
      <div class="stat"><span class="label">累计收益</span><span class="value" id="inv-earnings" style="color:var(--cyber-green)">¥0</span></div>
      <div class="stat"><span class="label">可提现积分</span><span class="value" id="inv-points">0</span></div>
      <div class="stat"><span class="label">分成比例</span><span class="value" style="color:var(--cyber-green)">30%</span></div>
      <div class="flex gap-10 mt-10">
        <button class="btn btn-sm" onclick="copyInvite()">📋 复制链接</button>
        <button class="btn btn-green btn-sm" onclick="withdrawInvite()">💳 提现</button>
      </div>
    </div>
    <div class="card">
      <h3>📖 邀请说明</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">1️⃣ 你的专属邀请码可以在下方复制<br>2️⃣ 分享给好友，好友注册时填写<br>3️⃣ 好友工单审核通过后你获得返利<br>4️⃣ 返利 = 订单金额 × 30% 邀请积分<br>5️⃣ 邀请积分可以提现或用于消费<br>6️⃣ 多邀多得，上不封顶！</p>
    </div>
  </div>
</div>
\`;

P.accounts = () => \`
<div class="container">
  <h2 class="page-title">// 账号列表</h2>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>工单</th><th>游戏账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查时间</th></tr></thead>
        <tbody id="acc-table"></tbody>
      </table>
    </div>
  </div>
</div>
\`;

P.notifications = () => \`
<div class="container" style="max-width:700px">
  <h2 class="page-title">// 通知中心</h2>
  <div id="notif-list"></div>
</div>
\`;

P.appeals = () => \`
<div class="container" style="max-width:700px">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">// 申诉售后</h2>
    <button class="btn btn-magenta btn-sm" onclick="showAppealForm()">+ 提交申诉</button>
  </div>
  <div id="appeal-list"></div>
</div>
\`;

// ─── Router ────────────────────────────────
function showPage(name) {
  const app = document.getElementById('app');
  if (P[name]) {
    app.innerHTML = P[name]();
    window.scrollTo(0, 0);
    if (name === 'landing') loadStats();
    if (name === 'dashboard' && TOKEN) refreshDashboard();
    if (name === 'admin' && TOKEN) refreshAdmin();
    if (name === 'invite' && TOKEN) refreshInvite();
    if (name === 'accounts' && TOKEN) refreshAccounts();
    if (name === 'notifications' && TOKEN) refreshNotifs();
    if (name === 'appeals' && TOKEN) refreshAppeals();
  }
}

// ─── Nav init ──────────────────────────────
document.querySelectorAll('[data-page]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    showPage(a.dataset.page);
  });
});

// ─── Auth ───────────────────────────────────
function updateNav(loggedIn, isAdmin) {
  document.getElementById('nav-login').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-register').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-dashboard').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-logout').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-invite').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-notif').classList.toggle('hidden', !loggedIn);
  const adminLink = document.getElementById('nav-admin');
  adminLink.classList.toggle('hidden', !(loggedIn && isAdmin));
}

async function checkAuth() {
  if (!TOKEN) { updateNav(false); return; }
  const r = await api('GET', '/api/user/info');
  if (r.ok && r.user) {
    USER = r.user;
    updateNav(true, r.user.is_admin);
    if (document.getElementById('app').innerHTML === '') {
      showPage('dashboard');
    }
    startNotifPoll();
  } else {
    TOKEN = '';
    USER = null;
    localStorage.removeItem('token');
    updateNav(false);
    if (notifInterval) clearInterval(notifInterval);
  }
}

async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  if (!u || !p) return toast('请填写完整信息', 'error');
  const r = await api('POST', '/api/auth/login', { username: u, password: p });
  if (r.ok) {
    TOKEN = r.token;
    USER = r.user;
    localStorage.setItem('token', TOKEN);
    toast('登录成功', 'success');
    showPage('dashboard');
  } else {
    toast(r.error || '登录失败', 'error');
  }
}

async function doRegister() {
  const u = document.getElementById('reg-user').value.trim();
  const p = document.getElementById('reg-pass').value;
  const e = document.getElementById('reg-email').value.trim();
  const inv = document.getElementById('reg-invite').value.trim();
  if (!u || !p) return toast('请填写完整信息', 'error');
  if (u.length < 3) return toast('用户名至少3个字符', 'error');
  if (p.length < 6) return toast('密码至少6位', 'error');
  const r = await api('POST', '/api/auth/register', { username: u, password: p, email: e, invite_code: inv });
  if (r.ok) {
    toast('注册成功，请登录', 'success');
    showPage('login');
  } else {
    toast(r.error || '注册失败', 'error');
  }
}

function logout() {
  TOKEN = '';
  USER = null;
  localStorage.removeItem('token');
  if (notifInterval) clearInterval(notifInterval);
  showPage('landing');
  updateNav(false);
  toast('已退出', 'info');
}

// ─── Notifications ─────────────────────────
function startNotifPoll() {
  if (notifInterval) clearInterval(notifInterval);
  pollNotifs();
  notifInterval = setInterval(pollNotifs, 30000);
}
async function pollNotifs() {
  if (!TOKEN) return;
  const r = await api('GET', '/api/notifications');
  if (r.ok && r.unread > 0) {
    const b = document.getElementById('notif-badge');
    b.textContent = r.unread;
    b.classList.remove('hidden');
  } else {
    document.getElementById('notif-badge').classList.add('hidden');
  }
}

async function refreshNotifs() {
  const r = await api('GET', '/api/notifications');
  if (!r.ok) return;
  const list = document.getElementById('notif-list');
  if (!r.notifications || !r.notifications.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🔔</div><p>暂无通知</p></div>';
    return;
  }
  list.innerHTML = r.notifications.map(n => \`
    <div class="card" style="\${n.is_read ? '' : 'border-color:rgba(0,240,255,0.3)'}">
      <div class="flex-between">
        <strong style="color:var(--cyber-cyan)">\${esc(n.title)}</strong>
        <span style="font-size:0.75em;color:var(--text-dim)">\${n.created_at}</span>
      </div>
      <p style="color:var(--text-dim);font-size:0.85em;margin-top:6px">\${esc(n.content)}</p>
      \${!n.is_read ? '<button class="btn btn-sm mt-10" onclick="markNotifRead('+n.id+')">标为已读</button>' : ''}
    </div>
  \`).join('');
  if (r.unread > 0) api('POST', '/api/notifications/read', {});
}

async function markNotifRead(id) {
  await api('POST', '/api/notifications/read', { id });
  refreshNotifs();
}

// ─── Dashboard ──────────────────────────────
async function refreshDashboard() {
  if (!TOKEN) return;
  const info = await api('GET', '/api/user/info');
  if (info.ok && info.user) {
    const u = info.user;
    document.getElementById('d-level').textContent = 'Lv.' + (u.level || 1);
    document.getElementById('d-level2').textContent = 'Lv.' + (u.level || 1);
    document.getElementById('d-orders').textContent = u.total_orders || 0;
    document.getElementById('d-spent').textContent = '¥' + (u.total_spent || 0).toFixed(1);
    document.getElementById('d-invite').textContent = u.invite_code || '-';
    document.getElementById('d-points').textContent = (u.invite_points || 0).toFixed(1);
    document.getElementById('d-discount').textContent = (LEVEL_DISCOUNTS[u.level] || 0) + '%';
  }

  const inviteInfo = await api('GET', '/api/invite/info');
  if (inviteInfo.ok) {
    document.getElementById('d-invited').textContent = inviteInfo.total_invited || 0;
  }

  const orders = await api('GET', '/api/orders');
  if (orders.ok && orders.orders) {
    const tbody = document.getElementById('dash-orders');
    if (orders.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-dim);padding:30px">暂无工单，点击右上角提交工单</td></tr>';
      return;
    }
    const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
    tbody.innerHTML = orders.orders.slice(0, 10).map(o => \`
      <tr style="cursor:pointer" onclick="showOrderDetail(\${o.id})">
        <td>#\${o.id}</td>
        <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis">\${esc(o.invite_code)}</td>
        <td>¥\${o.price.toFixed(1)}</td>
        <td><span class="badge badge-\${o.status}">\${s[o.status]||o.status}</span></td>
        <td style="font-size:0.78em">账号: \${o.account_count||0}</td>
        <td style="font-size:0.78em;color:var(--text-dim)">\${o.created_at?.split(' ')[0]||''}</td>
      </tr>
    \`).join('');
  }
}

// ─── Order Detail ───────────────────────────
async function showOrderDetail(id) {
  if (!TOKEN) return toast('请先登录', 'error');
  const r = await api('GET', '/api/orders/' + id);
  if (!r.ok) return toast(r.error, 'error');
  const o = r.order;
  const accounts = r.accounts || [];
  const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container" style="max-width:800px">
    <div class="flex-between mb-20 flex-wrap" style="gap:12px">
      <h2 class="page-title" style="margin-bottom:0">// 工单 #\${o.id}</h2>
      <button class="btn btn-sm" onclick="showPage('dashboard')">← 返回</button>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>📋 基本信息</h3>
        <div class="stat"><span class="label">邀请码</span><span class="value">\${esc(o.invite_code)}</span></div>
        <div class="stat"><span class="label">支付方式</span><span class="value">\${o.payment_method === 'wechat' ? '微信支付' : '灵石'}</span></div>
        <div class="stat"><span class="label">金额</span><span class="value">¥\${o.price.toFixed(2)}</span></div>
        <div class="stat"><span class="label">邀请积分</span><span class="value">\${o.bonus_points}</span></div>
        <div class="stat"><span class="label">优惠折扣</span><span class="value" style="color:var(--cyber-green)">\${o.discount}%</span></div>
        <div class="stat"><span class="label">状态</span><span class="value">\${s[o.status]||o.status}</span></div>
      </div>
      <div class="card">
        <h3>📅 时间信息</h3>
        <div class="stat"><span class="label">创建时间</span><span class="value" style="font-size:0.85em">\${o.created_at || '-'}</span></div>
        <div class="stat"><span class="label">更新时间</span><span class="value" style="font-size:0.85em">\${o.updated_at || '-'}</span></div>
        <div class="stat"><span class="label">预计完成</span><span class="value" style="color:var(--cyber-yellow)">\${o.est_complete_date || '审核中'}</span></div>
        <div class="stat"><span class="label">实际完成</span><span class="value">\${o.completed_at || '-'}</span></div>
        \${o.admin_notes ? '<div class="stat"><span class="label">管理备注</span><span class="value">' + esc(o.admin_notes) + '</span></div>' : ''}
      </div>
    </div>
    <div class="card mt-20">
      <h3>🎮 账号列表 (\${accounts.length})</h3>
      \${accounts.length === 0 ? '<p style="color:var(--text-dim);font-size:0.85em">暂无账号数据</p>' : \`
      <div class="table-wrap">
        <table>
          <thead><tr><th>账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查时间</th></tr></thead>
          <tbody>\${accounts.map(a => \`
            <tr>
              <td>\${esc(a.server_username || a.username)}</td>
              <td>\${a.level || 0}</td>
              <td>\${esc(a.map_name || '-')}</td>
              <td>\${statusBadge(a.status)}</td>
              <td style="font-size:0.78em">\${formatList(a.skills)}</td>
              <td style="font-size:0.78em">\${formatList(a.techniques)}</td>
              <td style="font-size:0.78em">\${formatList(a.equipment)}</td>
              <td style="font-size:0.78em;color:var(--text-dim)">\${a.last_check_at || '-'}</td>
            </tr>
          \`).join('')}</tbody>
        </table>
      </div>\`}
    </div>
  </div>\`;
}

function formatList(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return arr.map(x => x.name || x).join(', ') || '-';
  } catch(e) { return json || '-'; }
}

// ─── New Order ──────────────────────────────
function showNewOrder() {
  if (!TOKEN) return toast('请先登录', 'error');
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container" style="max-width:540px">
    <div class="flex-between mb-20">
      <h2 class="page-title" style="margin-bottom:0">// 提交工单</h2>
      <button class="btn btn-sm" onclick="showPage('dashboard')">← 返回</button>
    </div>
    <div class="card">
      <div class="form-group">
        <label>邀请码 <span style="color:var(--text-dim);font-weight:normal;font-size:0.8em">（需要注册的邀请码）</span></label>
        <input id="o-invite" placeholder="输入邀请码">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>支付方式</label>
          <select id="o-pay" onchange="calcPrice()">
            <option value="wechat">微信支付</option>
            <option value="spirit_stone">灵石</option>
          </select>
        </div>
        <div class="form-group">
          <label>金额</label>
          <input id="o-amount" type="number" min="1" placeholder="输入金额" oninput="calcPrice()">
        </div>
      </div>
      <div id="o-price-show" class="mb-10" style="color:var(--cyber-cyan);font-size:0.9em"></div>
      <div class="form-group">
        <label>付款账号名</label>
        <input id="o-pay-account" placeholder="微信昵称或游戏ID，用于核对">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>绑定角色名（选填）</label>
          <input id="o-bind-name" placeholder="游戏角色名称">
        </div>
        <div class="form-group">
          <label>绑定邀请码（选填）</label>
          <input id="o-bind-code" placeholder="该账号使用的邀请码">
        </div>
      </div>
      <div class="form-group">
        <label>优惠码（选填）</label>
        <div class="flex gap-10">
          <input id="o-coupon" placeholder="输入优惠码" style="flex:1" onblur="validateCoupon()">
          <button class="btn btn-green btn-sm" onclick="validateCoupon()">验证</button>
        </div>
        <div id="o-coupon-res" style="font-size:0.82em;margin-top:4px"></div>
      </div>
      <div class="form-group">
        <label>需要账号数</label>
        <input id="o-acc-count" type="number" min="1" max="20" value="1">
        <span style="font-size:0.75em;color:var(--text-dim)">每个账号120积分，按积分自动计算</span>
      </div>
      <button class="btn btn-magenta btn-block" onclick="submitOrder()">提交工单</button>
    </div>
  </div>\`;
}

async function calcPrice() {
  const amt = parseFloat(document.getElementById('o-amount').value) || 0;
  const method = document.getElementById('o-pay').value;
  const el = document.getElementById('o-price-show');
  if (method === 'wechat') {
    el.textContent = '≈ ' + (amt * 120) + ' 邀请积分';
  } else {
    el.textContent = '≈ ' + (amt * 10) + ' 邀请积分（' + (amt * 100).toLocaleString() + ' 万灵石）';
  }
}

let validatedDiscount = 0;
async function validateCoupon() {
  const code = document.getElementById('o-coupon')?.value;
  const res = document.getElementById('o-coupon-res');
  if (!code || !res) { validatedDiscount = 0; return; }
  const r = await api('POST', '/api/coupon/validate', { code });
  if (r.ok) {
    validatedDiscount = r.discount_percent;
    res.innerHTML = '✅ 优惠码有效，享 <strong>' + r.discount_percent + '%</strong> 折扣';
    res.style.color = 'var(--cyber-green)';
  } else {
    validatedDiscount = 0;
    res.innerHTML = '❌ ' + (r.error || '无效');
    res.style.color = 'var(--cyber-red)';
  }
}

async function submitOrder() {
  const invite_code = document.getElementById('o-invite').value.trim();
  const payment_method = document.getElementById('o-pay').value;
  const amount = parseInt(document.getElementById('o-amount').value) || 0;
  const payment_account = document.getElementById('o-pay-account').value.trim();
  const coupon_code = document.getElementById('o-coupon')?.value.trim() || '';
  const bind_account_name = document.getElementById('o-bind-name')?.value.trim() || '';
  const bind_invite_code = document.getElementById('o-bind-code')?.value.trim() || '';
  const game_account_count = parseInt(document.getElementById('o-acc-count')?.value) || 1;

  if (!invite_code) return toast('请输入邀请码', 'error');
  if (!payment_account) return toast('请输入付款账号名', 'error');
  if (amount < 1) return toast('请输入有效金额', 'error');
  if (game_account_count < 1 || game_account_count > 20) return toast('账号数1-20个', 'error');

  const r = await api('POST', '/api/orders', {
    invite_code, payment_method, amount, payment_account,
    coupon_code, bind_account_name, bind_invite_code, game_account_count,
  });
  if (r.ok) {
    toast('工单已提交，等待管理员审核！', 'success');
    showPage('dashboard');
  } else {
    toast(r.error || '提交失败', 'error');
  }
}

// ─── Admin ──────────────────────────────────
const ADMIN_TABS = {};
let adminState = { orders: [], accounts: [], users: [], appeals: [] };

async function refreshAdmin() {
  await Promise.all([adminLoadOrders('pending'), adminLoadAccounts(), adminLoadUsers(), adminLoadAppeals(), adminLoadConfig()]);
}

async function adminLoadOrders(status) {
  const path = status ? '/api/admin/orders?status=' + status : '/api/admin/orders';
  const r = await api('GET', path);
  if (!r.ok) return;
  adminState.orders = r.orders || [];
  const tbody = document.getElementById('admin-orders-table');
  if (!tbody) return;
  if (!adminState.orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-dim);padding:30px">暂无工单</td></tr>';
    return;
  }
  const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
  tbody.innerHTML = adminState.orders.map(o => \`
    <tr>
      <td>#\${o.id}</td>
      <td>\${esc(o.user_name)}</td>
      <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis">\${esc(o.invite_code)}</td>
      <td>\${o.payment_method === 'wechat' ? '微信' : '灵石'}</td>
      <td>¥\${o.price.toFixed(1)}</td>
      <td>\${o.bonus_points}</td>
      <td><span class="badge badge-\${o.status}">\${s[o.status]||o.status}</span></td>
      <td style="font-size:0.78em;color:var(--text-dim)">\${o.created_at?.split(' ')[0]||''}</td>
      <td>
        <div class="flex gap-10" style="gap:4px">
          \${o.status === 'pending' ? \`
            <button class="btn btn-green btn-sm" style="padding:3px 10px;font-size:0.75em" onclick="adminApprove(\${o.id})">通过</button>
            <button class="btn btn-red btn-sm" style="padding:3px 10px;font-size:0.75em" onclick="adminReject(\${o.id})">拒绝</button>
          \` : ''}
          <button class="btn btn-sm" style="padding:3px 10px;font-size:0.75em" onclick="showOrderDetail(\${o.id})">详情</button>
        </div>
      </td>
    </tr>
  \`).join('');
}

async function adminApprove(id) {
  if (!confirm('确认通过工单 #' + id + '？')) return;
  const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'approved' });
  if (r.ok) { toast('已通过', 'success'); adminLoadOrders('pending'); }
  else toast(r.error, 'error');
}

async function adminReject(id) {
  const notes = prompt('拒绝原因：');
  if (!notes) return;
  const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'rejected', admin_notes: notes });
  if (r.ok) { toast('已拒绝', 'info'); adminLoadOrders('pending'); }
  else toast(r.error, 'error');
}

async function adminLoadAccounts() {
  const r = await api('GET', '/api/admin/accounts');
  if (!r.ok) return;
  adminState.accounts = r.accounts || [];
  const tb = document.getElementById('admin-accounts-table');
  if (!tb) return;
  tb.innerHTML = adminState.accounts.length ? adminState.accounts.map(a => \`<tr>
    <td>\${a.id}</td><td>\${esc(a.user_name||'')}</td>
    <td>\${esc(a.server_username||a.username)}</td>
    <td>\${a.level || 0}</td>
    <td>\${esc(a.map_name||'-')}</td>
    <td>\${statusBadge(a.status)}</td>
    <td style="font-size:0.78em">\${formatList(a.skills)}</td>
    <td style="font-size:0.78em">\${formatList(a.techniques)}</td>
    <td style="font-size:0.78em">\${formatList(a.equipment)}</td>
    <td style="font-size:0.78em;color:var(--text-dim)">\${a.last_check_at||'-'}</td>
  </tr>\`).join('') : '<tr><td colspan="10" class="text-center" style="color:var(--text-dim);padding:30px">暂无账号</td></tr>';
}

async function adminLoadUsers() {
  const r = await api('GET', '/api/admin/users');
  if (!r.ok) return;
  adminState.users = r.users || [];
  const tb = document.getElementById('admin-users-table');
  if (!tb) return;
  tb.innerHTML = adminState.users.map(u => \`<tr>
    <td>\${u.id}</td>
    <td>\${esc(u.username)}</td>
    <td><span class="level-badge">Lv.\${u.level}</span></td>
    <td>\${u.total_orders}</td>
    <td>¥\${(u.total_spent||0).toFixed(1)}</td>
    <td>\${(u.invite_points||0).toFixed(1)}</td>
    <td style="font-size:0.78em">\${u.invite_code||'-'}</td>
    <td>\${u.locked ? '🔒' : '✅'}</td>
    <td style="font-size:0.78em">\${u.created_at?.split(' ')[0]||'-'}</td>
  </tr>\`).join('');
}

async function adminLoadAppeals() {
  const r = await api('GET', '/api/admin/appeals');
  if (!r.ok) return;
  adminState.appeals = r.appeals || [];
  const tb = document.getElementById('admin-appeals-table');
  if (!tb) return;
  tb.innerHTML = adminState.appeals.length ? adminState.appeals.map(a => \`<tr>
    <td>#\${a.id}</td><td>\${esc(a.user_name)}</td>
    <td>\${esc(a.title)}</td><td>\${a.type}</td>
    <td>\${statusBadge(a.status)}</td>
    <td style="font-size:0.78em">\${a.created_at?.split(' ')[0]||''}</td>
    <td><button class="btn btn-sm" style="padding:3px 10px;font-size:0.75em" onclick="adminReplyAppeal(\${a.id})">回复</button></td>
  </tr>\`).join('') : '<tr><td colspan="7" class="text-center" style="color:var(--text-dim);padding:30px">暂无申诉</td></tr>';
}

async function adminReplyAppeal(id) {
  const reply = prompt('回复内容：');
  if (!reply) return;
  await api('POST', '/api/admin/appeals/' + id + '/reply', { reply, status: 'resolved' });
  toast('已回复', 'success');
  adminLoadAppeals();
}

async function adminLoadConfig() {
  const el = document.getElementById('admin-config');
  if (!el) return;
  const r = await api('GET', '/api/admin/config');
  if (!r.ok || !r.config) return;
  el.innerHTML = '<div class="grid grid-2">' + r.config.map(c => \`
    <div class="form-group">
      <label>\${esc(c.key)}</label>
      <div class="flex gap-10">
        <input id="cfg-\${c.key}" value="\${esc(c.value)}" style="flex:1">
        <button class="btn btn-green btn-sm" onclick="adminSaveConfig('\${c.key}')">保存</button>
      </div>
    </div>
  \`).join('') + '</div>';
}

async function adminSaveConfig(key) {
  const val = document.getElementById('cfg-' + key)?.value;
  if (!val) return;
  await api('POST', '/api/admin/config', { key, value: val });
  toast('配置已更新', 'success');
}

// ─── Invite ─────────────────────────────────
async function refreshInvite() {
  const r = await api('GET', '/api/invite/info');
  if (r.ok) {
    document.getElementById('inv-code').textContent = r.invite_code || '-';
    document.getElementById('inv-count').textContent = r.total_invited || 0;
    document.getElementById('inv-orders').textContent = r.invite_orders || 0;
    document.getElementById('inv-points').textContent = (r.invite_points || 0).toFixed(1);
    document.getElementById('inv-earnings').textContent = '¥' + (r.invite_earnings || 0).toFixed(1);
  }
}

function copyInvite() {
  const code = document.getElementById('inv-code')?.textContent;
  if (!code || code === '-') return toast('暂无邀请码', 'error');
  const link = window.location.origin + '/?invite=' + code;
  navigator.clipboard.writeText(link).then(() => toast('邀请链接已复制！', 'success'));
}

async function withdrawInvite() {
  const points = prompt('输入要提现的积分（最少10分）：');
  if (!points || isNaN(points) || parseInt(points) < 10) return toast('最少提现10积分', 'error');
  const r = await api('POST', '/api/invite/withdraw', { points: parseInt(points) });
  if (r.ok) { toast('提现申请已提交', 'success'); refreshInvite(); }
  else toast(r.error, 'error');
}

// ─── Accounts ───────────────────────────────
async function refreshAccounts() {
  const r = await api('GET', '/api/accounts');
  const tb = document.getElementById('acc-table');
  if (!tb) return;
  if (!r.ok || !r.accounts || !r.accounts.length) {
    tb.innerHTML = '<tr><td colspan="10" class="text-center" style="color:var(--text-dim);padding:30px">暂无游戏账号</td></tr>';
    return;
  }
  tb.innerHTML = r.accounts.map(a => \`
    <tr>
      <td>\${a.id}</td>
      <td>#\${a.order_id}</td>
      <td>\${esc(a.server_username || a.username)}</td>
      <td><strong>\${a.level || 0}</strong></td>
      <td>\${esc(a.map_name || '-')}</td>
      <td>\${statusBadge(a.status)}</td>
      <td style="font-size:0.78em">\${formatList(a.skills)}</td>
      <td style="font-size:0.78em">\${formatList(a.techniques)}</td>
      <td style="font-size:0.78em">\${formatList(a.equipment)}</td>
      <td style="font-size:0.78em;color:var(--text-dim)">\${a.last_check_at || '-'}</td>
    </tr>
  \`).join('');
}

// ─── Appeals ────────────────────────────────
let APPEAL_FORM_SHOWN = false;

async function refreshAppeals() {
  const r = await api('GET', '/api/appeals');
  const list = document.getElementById('appeal-list');
  if (!list) return;
  if (!r.ok || !r.appeals || !r.appeals.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📮</div><p>暂无申诉记录</p></div>';
    return;
  }
  list.innerHTML = r.appeals.map(a => \`
    <div class="card">
      <div class="flex-between">
        <div>
          <strong style="color:var(--cyber-cyan)">\${esc(a.title)}</strong>
          <span style="font-size:0.78em;color:var(--text-dim);margin-left:10px">工单 #\${a.order_id || '-'}</span>
        </div>
        \${statusBadge(a.status)}
      </div>
      <p style="color:var(--text-dim);font-size:0.85em;margin-top:6px">\${esc(a.content)}</p>
      \${a.admin_reply ? '<div class="mt-10" style="border-top:1px solid var(--border-glow);padding-top:8px"><span style="color:var(--cyber-cyan);font-size:0.78em">管理员回复：</span><span style="color:var(--text-main);font-size:0.85em">' + esc(a.admin_reply) + '</span></div>' : ''}
      <div style="font-size:0.75em;color:var(--text-dim);margin-top:6px">\${a.created_at}</div>
    </div>
  \`).join('');
}

function showAppealForm() {
  if (APPEAL_FORM_SHOWN) return;
  APPEAL_FORM_SHOWN = true;
  const list = document.getElementById('appeal-list');
  const form = document.createElement('div');
  form.className = 'card';
  form.id = 'appeal-form';
  form.innerHTML = \`
    <h3 style="color:var(--cyber-cyan);margin-bottom:12px">提交申诉</h3>
    <div class="form-group"><label>标题</label><input id="ap-title" placeholder="申诉标题"></div>
    <div class="form-group"><label>关联工单编号（选填）</label><input id="ap-order" type="number" placeholder="工单ID"></div>
    <div class="form-group"><label>类型</label>
      <select id="ap-type">
        <option value="appeal">申诉</option>
        <option value="after_sales">售后</option>
        <option value="refund">退款</option>
        <option value="other">其他</option>
      </select>
    </div>
    <div class="form-group"><label>内容</label><textarea id="ap-content" rows="4" placeholder="详细描述问题"></textarea></div>
    <div class="flex gap-10">
      <button class="btn btn-magenta" onclick="submitAppeal()">提交</button>
      <button class="btn" onclick="cancelAppealForm()">取消</button>
    </div>
  \`;
  list.insertBefore(form, list.firstChild);
}

function cancelAppealForm() {
  const f = document.getElementById('appeal-form');
  if (f) f.remove();
  APPEAL_FORM_SHOWN = false;
}

async function submitAppeal() {
  const title = document.getElementById('ap-title')?.value.trim();
  const content = document.getElementById('ap-content')?.value.trim();
  const order_id = parseInt(document.getElementById('ap-order')?.value) || 0;
  const type = document.getElementById('ap-type')?.value || 'appeal';
  if (!title || !content) return toast('请填写标题和内容', 'error');
  const r = await api('POST', '/api/appeals', { title, content, order_id, type });
  if (r.ok) {
    toast('申诉已提交', 'success');
    cancelAppealForm();
    refreshAppeals();
  } else {
    toast(r.error || '提交失败', 'error');
  }
}

// ─── Bot ────────────────────────────────────
async function askBot() {
  const input = document.getElementById('chat-input');
  const box = document.getElementById('chat-box');
  if (!input || !input.value.trim()) return;
  const q = input.value.trim();
  box.innerHTML += '<div class="chat-msg"><div class="sender">👤 我</div><div class="text">' + esc(q) + '</div></div>';
  input.value = '';
  box.scrollTop = box.scrollHeight;

  const r = await api('POST', '/api/bot/ask', { question: q });
  box.innerHTML += '<div class="chat-msg"><div class="sender sender-bot">🤖 助手</div><div class="text">' + esc(r.answer || '抱歉，我不太理解') + '</div></div>';
  box.scrollTop = box.scrollHeight;
}

// ─── Tab ────────────────────────────────────
function switchTab(el, id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

// ─── Stats ──────────────────────────────────
async function loadStats() {
  const r = await api('GET', '/api/stats');
  if (!r.ok || !r.stats) return;
  const s = r.stats;
  const el = document.getElementById('hero-stats');
  if (!el) return;
  el.innerHTML = \`
    <div class="hero-stat"><div class="num">\${s.total_users||0}</div><div class="label">注册用户</div></div>
    <div class="hero-stat"><div class="num">\${s.total_orders||0}</div><div class="label">工单总数</div></div>
    <div class="hero-stat"><div class="num">\${s.completed_orders||0}</div><div class="label">已完成</div></div>
    <div class="hero-stat"><div class="num">\${s.online_accounts||0}</div><div class="label">在线账号</div></div>
  \`;
}

// ─── Init ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!TOKEN) {
    showPage('landing');
    updateNav(false);
  } else {
    checkAuth();
  }
});
<\/script>
</body>
</html>`;
