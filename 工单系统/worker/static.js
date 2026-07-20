/**
 * Static asset rendering for Cloudflare Worker
 * Embeds HTML/CSS/JS as template strings
 */

export async function renderStaticAsset(name, env) {
  switch (name) {
    case 'index.html': return indexHTML;
    default: return null;
  }
}

const CSS = `/* ─── Cyberpunk Theme ──────────────────────── */
:root {
  --neon-cyan: #00f0ff;
  --neon-magenta: #ff00aa;
  --neon-yellow: #ffe600;
  --neon-green: #00ff88;
  --bg-dark: #0a0a1a;
  --bg-card: #12122a;
  --bg-input: #1a1a3a;
  --text-main: #c0c0e0;
  --text-dim: #606080;
  --border-glow: rgba(0,240,255,0.3);
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Courier New', monospace;
  background: var(--bg-dark);
  color: var(--text-main);
  min-height: 100vh;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  top:0;left:0;right:0;bottom:0;
  background:
    linear-gradient(0deg, transparent 48%, rgba(0,240,255,0.02) 50%, transparent 52%);
  background-size: 100% 4px;
  pointer-events: none;
  z-index: 9999;
  animation: scanline 8s linear infinite;
}
@keyframes scanline {
  0% { transform: translateY(0); }
  100% { transform: translateY(4px); }
}
a { color: var(--neon-cyan); text-decoration: none; }
a:hover { text-shadow: 0 0 10px var(--neon-cyan); }

/* ─── Nav ──────────────────────────────── */
nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px;
  border-bottom: 1px solid var(--border-glow);
  background: rgba(10,10,26,0.95);
  position: sticky; top:0; z-index:100;
}
nav .logo {
  font-size: 1.3em; font-weight: bold;
  color: var(--neon-cyan); text-shadow: 0 0 15px var(--neon-cyan);
}
nav .logo span { color: var(--neon-magenta); }
nav .nav-links { display: flex; gap: 24px; align-items: center; }
nav .nav-links a { font-size: 0.9em; text-transform: uppercase; letter-spacing: 1px; }
nav .nav-links .btn { padding: 8px 20px; }

/* ─── Buttons ──────────────────────────── */
.btn {
  display: inline-block; padding: 10px 24px;
  border: 1px solid var(--neon-cyan);
  color: var(--neon-cyan); background: transparent;
  font-family: inherit; font-size: 0.9em; cursor: pointer;
  text-transform: uppercase; letter-spacing: 1px;
  transition: all 0.3s;
}
.btn:hover {
  background: rgba(0,240,255,0.15);
  box-shadow: 0 0 20px rgba(0,240,255,0.3);
}
.btn-magenta {
  border-color: var(--neon-magenta);
  color: var(--neon-magenta);
}
.btn-magenta:hover {
  background: rgba(255,0,170,0.15);
  box-shadow: 0 0 20px rgba(255,0,170,0.3);
}
.btn-green {
  border-color: var(--neon-green);
  color: var(--neon-green);
}
.btn-green:hover {
  background: rgba(0,255,136,0.15);
  box-shadow: 0 0 20px rgba(0,255,136,0.3);
}
.btn-yellow {
  border-color: var(--neon-yellow);
  color: var(--neon-yellow);
}

/* ─── Container ────────────────────────── */
.container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
.page-title {
  font-size: 1.5em; text-transform: uppercase;
  color: var(--neon-cyan); text-shadow: 0 0 10px var(--neon-cyan);
  margin-bottom: 24px; letter-spacing: 2px;
}

/* ─── Hero ─────────────────────────────── */
.hero {
  text-align: center; padding: 80px 20px;
  position: relative;
}
.hero::after {
  content: '';
  position: absolute; bottom:0; left:10%; right:10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--neon-cyan), var(--neon-magenta), transparent);
}
.hero h1 {
  font-size: 2.5em; text-transform: uppercase;
  text-shadow: 0 0 30px var(--neon-cyan), 0 0 60px var(--neon-cyan);
  margin-bottom: 16px;
}
.hero h1 .highlight { color: var(--neon-magenta); text-shadow: 0 0 30px var(--neon-magenta); }
.hero p { font-size: 1.1em; color: var(--text-dim); max-width: 600px; margin: 0 auto 32px; }
.hero .btn-group { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }

/* ─── Features ─────────────────────────── */
.features {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr));
  gap: 20px; padding: 40px 0;
}
.feature-card {
  background: var(--bg-card); padding: 24px;
  border: 1px solid var(--border-glow);
  position: relative;
}
.feature-card::before {
  content: '//'; position: absolute; top:8px; right:12px;
  color: var(--neon-magenta); opacity: 0.5; font-size: 0.8em;
}
.feature-card h3 { color: var(--neon-cyan); margin-bottom: 8px; }
.feature-card p { color: var(--text-dim); font-size: 0.9em; line-height: 1.6; }

/* ─── Cards ────────────────────────────── */
.card {
  background: var(--bg-card); padding: 20px;
  border: 1px solid var(--border-glow);
  margin-bottom: 16px;
}
.card h3 { color: var(--neon-cyan); margin-bottom: 12px; }
.card .stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em; }
.card .stat .label { color: var(--text-dim); }
.card .stat .value { color: var(--neon-yellow); }

/* ─── Forms ────────────────────────────── */
input, select, textarea {
  width: 100%; padding: 10px 12px;
  background: var(--bg-input); border: 1px solid var(--border-glow);
  color: var(--text-main); font-family: inherit; font-size: 0.9em;
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 10px rgba(0,240,255,0.2);
}
label { display: block; margin-bottom: 6px; color: var(--neon-cyan); font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; }
.form-group { margin-bottom: 16px; }

/* ─── Status Badges ────────────────────── */
.badge {
  display: inline-block; padding: 3px 10px; font-size: 0.8em;
  text-transform: uppercase; letter-spacing: 1px;
}
.badge-pending { border: 1px solid var(--neon-yellow); color: var(--neon-yellow); }
.badge-approved { border: 1px solid var(--neon-green); color: var(--neon-green); }
.badge-rejected { border: 1px solid #ff4444; color: #ff4444; }
.badge-completed { border: 1px solid var(--neon-cyan); color: var(--neon-cyan); }
.badge-registering { border: 1px solid var(--neon-yellow); color: var(--neon-yellow); }
.badge-farming { border: 1px solid var(--neon-magenta); color: var(--neon-magenta); }
.badge-failed { border: 1px solid #ff4444; color: #ff4444; }

/* ─── Table ────────────────────────────── */
table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
th { color: var(--neon-cyan); text-transform: uppercase; letter-spacing: 1px; font-size: 0.8em; }
tr:hover td { background: rgba(0,240,255,0.03); }

/* ─── Modal ────────────────────────────── */
.modal-overlay {
  display: none; position: fixed; top:0;left:0;right:0;bottom:0;
  background: rgba(0,0,0,0.8); z-index: 200;
  justify-content: center; align-items: center;
}
.modal-overlay.show { display: flex; }
.modal {
  background: var(--bg-card); padding: 32px;
  border: 1px solid var(--border-glow);
  max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
}
.modal h2 { color: var(--neon-cyan); margin-bottom: 16px; }
.modal .btn-group { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }

/* ─── Grid ─────────────────────────────── */
.row { display: flex; gap: 20px; flex-wrap: wrap; }
.col-6 { flex: 1; min-width: 300px; }
.col-4 { flex: 0 0 calc(33.33% - 14px); min-width: 250px; }
.col-3 { flex: 0 0 calc(25% - 15px); min-width: 200px; }

/* ─── Price Card ───────────────────────── */
.price-card {
  background: var(--bg-card); padding: 32px 24px;
  border: 1px solid var(--border-glow);
  text-align: center;
}
.price-card .price { font-size: 2em; color: var(--neon-cyan); text-shadow: 0 0 15px var(--neon-cyan); margin: 12px 0; }
.price-card .price span { font-size: 0.5em; color: var(--text-dim); }
.price-card h3 { color: var(--neon-magenta); }
.price-card ul { list-style: none; text-align: left; margin: 16px 0; }
.price-card ul li { padding: 4px 0; color: var(--text-dim); font-size: 0.85em; }
.price-card ul li::before { content: '> '; color: var(--neon-cyan); }

/* ─── Tabs ─────────────────────────────── */
.tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border-glow); }
.tab {
  padding: 10px 20px; cursor: pointer;
  color: var(--text-dim); border-bottom: 2px solid transparent;
  text-transform: uppercase; letter-spacing: 1px; font-size: 0.85em;
}
.tab.active { color: var(--neon-cyan); border-bottom-color: var(--neon-cyan); }
.tab:hover { color: var(--text-main); }
.tab-content { display: none; }
.tab-content.active { display: block; }

/* ─── Bot Chat ─────────────────────────── */
.chat-box {
  background: var(--bg-input); border: 1px solid var(--border-glow);
  height: 300px; overflow-y: auto; padding: 16px; margin-bottom: 12px;
}
.chat-msg { margin-bottom: 12px; }
.chat-msg .sender { font-size: 0.75em; color: var(--neon-cyan); margin-bottom: 2px; }
.chat-msg .sender-bot { color: var(--neon-magenta); }
.chat-msg .text { color: var(--text-main); font-size: 0.9em; line-height: 1.5; }
.chat-input { display: flex; gap: 8px; }
.chat-input input { flex: 1; }
.chat-input .btn { flex-shrink: 0; }

/* ─── Utils ────────────────────────────── */
.text-center { text-align: center; }
.mt-20 { margin-top: 20px; }
.mb-20 { margin-bottom: 20px; }
.hidden { display: none; }
.glow-text { text-shadow: 0 0 10px currentColor; }
.flex { display: flex; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }

/* ─── Responsive ───────────────────────── */
@media (max-width: 768px) {
  nav { flex-direction: column; gap: 12px; padding: 12px 16px; }
  nav .nav-links { flex-wrap: wrap; justify-content: center; gap: 12px; }
  .hero h1 { font-size: 1.5em; }
  .row { flex-direction: column; }
  .col-4, .col-3 { flex: 1; }
}`;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>艾德尔工单系统 | 赛博修仙</title>
<style>${CSS}</style>
</head>
<body>

<nav>
  <div class="logo">⚡ 艾德尔<span>修仙</span>工单系统</div>
  <div class="nav-links">
    <a href="/">首页</a>
    <a href="#" onclick="showPage('control')">控制台</a>
    <a href="#" onclick="showPage('docs')">文档</a>
    <a class="btn btn-magenta" id="nav-login" href="#" onclick="showPage('login')">登录</a>
    <a class="btn" id="nav-register" href="#" onclick="showPage('register')">注册</a>
    <a class="btn btn-green hidden" id="nav-dashboard" href="#" onclick="showPage('dashboard')">控制台</a>
    <a class="btn hidden" id="nav-logout" href="#" onclick="logout()">退出</a>
  </div>
</nav>

<div id="app"></div>

<script>
// ─── State ──────────────────────────────────
let TOKEN = localStorage.getItem('token') || '';
let USER = null;
const API = window.location.origin;

async function api(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(API + path, opt);
  return r.json();
}

// ─── Pages ──────────────────────────────────
const PAGES = {};

PAGES.landing = () => \`
<div class="hero">
  <h1>⚡ 赛博修仙 <span class="highlight">自动化</span></h1>
  <p>艾德尔修仙传 · 专业邀请积分代练平台<br>一键下单 · 自动注册 · 智能升级 · 全程监控</p>
  <div class="btn-group">
    <a class="btn btn-magenta" href="#" onclick="showPage('register')">立即注册</a>
    <a class="btn" href="#" onclick="showPage('control')">了解详情</a>
  </div>
</div>

<div class="container">
  <h2 class="page-title text-center">// 服务介绍</h2>
  <div class="features">
    <div class="feature-card">
      <h3>⚡ 自动注册</h3>
      <p>提交工单后自动注册账号，配置全金属性灵根，装配新手装备。</p>
    </div>
    <div class="feature-card">
      <h3>🏯 智能升级</h3>
      <p>每日自动检测账号状态，自动点击升级，直达120级上限。</p>
    </div>
    <div class="feature-card">
      <h3>🤝 邀请分成</h3>
      <p>生成专属邀请码，好友成交获得30%积分返还，多邀多得。</p>
    </div>
    <div class="feature-card">
      <h3>📊 实时监控</h3>
      <p>查看账号实时状态、等级、装备、技能、地图等信息。</p>
    </div>
    <div class="feature-card">
      <h3>🎯 精准交付</h3>
      <p>到达120级后自动停号，完成后通知，支持售后申诉。</p>
    </div>
    <div class="feature-card">
      <h3>🛡️ 防封保障</h3>
      <p>独立IP伪装、指纹轮换、智能分段，最大程度降低封号风险。</p>
    </div>
  </div>

  <h2 class="page-title text-center mt-20">// 价格方案</h2>
  <div class="features" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
    <div class="price-card">
      <h3>💎 基础套餐</h3>
      <div class="price">1 <span>元</span></div>
      <ul>
        <li>120 邀请积分</li>
        <li>自动注册账号</li>
        <li>装配新手装备</li>
        <li>自动刷怪升级</li>
        <li>可绑定多个邀请码</li>
      </ul>
      <a class="btn" href="#" onclick="showPage('register')">开始下单</a>
    </div>
    <div class="price-card">
      <h3>💎 灵石套餐</h3>
      <div class="price">100万 <span>灵石</span></div>
      <ul>
        <li>10 邀请积分</li>
        <li>自动注册账号</li>
        <li>装配新手装备</li>
        <li>自动刷怪升级</li>
        <li>可绑定多个邀请码</li>
      </ul>
      <a class="btn btn-magenta" href="#" onclick="showPage('register')">开始下单</a>
    </div>
    <div class="price-card">
      <h3>🏆 VIP套餐</h3>
      <div class="price">量大 <span>优惠</span></div>
      <ul>
        <li>等级越高折扣越多</li>
        <li>最高70%优惠</li>
        <li>邀请好友享30%分成</li>
        <li>专属客服支持</li>
        <li>优先交付</li>
      </ul>
      <a class="btn btn-green" href="#" onclick="showPage('register')">立即咨询</a>
    </div>
  </div>
</div>
\`;

PAGES.control = () => \`
<div class="container">
  <h2 class="page-title">// 功能介绍</h2>

  <div class="card">
    <h3>📋 工单系统</h3>
    <p>提交购买工单，填写邀请码和支付信息，管理员审核到账后自动开始处理。</p>
  </div>
  <div class="card">
    <h3>🤖 自动化流程</h3>
    <p>工单审核通过 → GitHub Actions 每日扫描 → 自动注册账号 → 装配铁剑/技能/功法 → 切换荒石村 → 开始刷怪 → 每日健康检测 → 自动升级 → 120级停号</p>
  </div>
  <div class="card">
    <h3>💎 账号规格</h3>
    <p>全金属性灵根 · 自动装配铁剑 · 学习基础技能 · 修炼基础功法 · 自动切换荒石村刷怪</p>
  </div>
  <div class="card">
    <h3>🛡️ 防封策略</h3>
    <p>每账号独立伪造IP(31段运营商IP) · 独立机器码(6种格式) · 浏览器指纹轮换(12种UA) · CDN代理链模拟 · 操作间随机延迟 · 每3-5账号智能暂停</p>
  </div>
  <div class="card">
    <h3>📊 数据监控</h3>
    <p>实时查看账号等级、地图位置、技能装备、在线状态。到达120级后2天自动停止检测。</p>
  </div>
</div>
\`;

PAGES.docs = () => \`
<div class="container">
  <h2 class="page-title">// 使用文档</h2>

  <div class="card">
    <h3>📝 如何下单</h3>
    <p>1. 注册账号并登录<br>2. 进入控制台，点击「提交工单」<br>3. 填写邀请码、支付方式、付款账号等信息<br>4. 可填写优惠码获得折扣<br>5. 提交后等待管理员审核</p>
  </div>
  <div class="card">
    <h3>💰 价格说明</h3>
    <p>微信支付：1 元 = 120 邀请积分<br>灵石支付：100 万灵石 = 10 邀请积分<br>优惠码可叠加等级折扣，最高70%优惠</p>
  </div>
  <div class="card">
    <h3>🎯 用户等级</h3>
    <p>每完成一单提升一级：<br>Lv.1 基础价格 · Lv.2 解锁邀请系统 · Lv.3 10%优惠 · Lv.4 20%优惠 · Lv.5 30%优惠 · ... · Lv.10 70%优惠</p>
  </div>
  <div class="card">
    <h3>🤝 邀请分成</h3>
    <p>在邀请页生成邀请码，分享给好友注册。好友成交后你将获得该订单金额30%的邀请积分返还。</p>
  </div>
  <div class="card">
    <h3>⏱️ 预计时间</h3>
    <p>工单审核通过后预计5天完成账号注册和升级。到达120级后通知工单完成。</p>
  </div>
  <div class="card">
    <h3>🆘 售后申诉</h3>
    <p>如果账号出现问题或超时未完成，请联系管理员并提供工单编号。</p>
  </div>
</div>
\`;

PAGES.login = () => \`
<div class="container" style="max-width:400px">
  <h2 class="page-title">// 登录</h2>
  <div class="card">
    <div class="form-group">
      <label>用户名</label>
      <input id="login-user" placeholder="输入用户名">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input id="login-pass" type="password" placeholder="输入密码">
    </div>
    <button class="btn btn-magenta" onclick="doLogin()">登录</button>
    <p class="mt-20" style="color:var(--text-dim);font-size:0.85em">没有账号？<a href="#" onclick="showPage('register')">立即注册</a></p>
  </div>
</div>
\`;

PAGES.register = () => \`
<div class="container" style="max-width:400px">
  <h2 class="page-title">// 注册</h2>
  <div class="card">
    <div class="form-group">
      <label>用户名</label>
      <input id="reg-user" placeholder="3-20字符">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input id="reg-pass" type="password" placeholder="至少6位">
    </div>
    <div class="form-group">
      <label>邮箱（选填）</label>
      <input id="reg-email" type="email" placeholder="example@email.com">
    </div>
    <div class="form-group">
      <label>邀请码（选填）</label>
      <input id="reg-invite" placeholder="填写邀请人的邀请码">
    </div>
    <button class="btn btn-magenta" onclick="doRegister()">注册</button>
    <p class="mt-20" style="color:var(--text-dim);font-size:0.85em">已有账号？<a href="#" onclick="showPage('login')">登录</a></p>
  </div>
</div>
\`;

PAGES.dashboard = () => \`
<div class="container">
  <div class="flex-between mb-20">
    <h2 class="page-title" style="margin-bottom:0">// 控制台</h2>
    <button class="btn btn-magenta" onclick="showNewOrder()">+ 提交工单</button>
  </div>

  <div class="row mb-20">
    <div class="col-4">
      <div class="card">
        <h3>📊 我的信息</h3>
        <div class="stat"><span class="label">用户名</span><span class="value" id="d-username">-</span></div>
        <div class="stat"><span class="label">等级</span><span class="value" id="d-level">-</span></div>
        <div class="stat"><span class="label">工单数</span><span class="value" id="d-orders">-</span></div>
        <div class="stat"><span class="label">邀请积分</span><span class="value" id="d-points">-</span></div>
        <div class="stat"><span class="label">邀请码</span><span class="value" id="d-invite">-</span></div>
        <div class="stat"><span class="label">邀请人数</span><span class="value" id="d-invited">-</span></div>
      </div>
    </div>
    <div class="col-4">
      <div class="card">
        <h3>🤖 客服助手</h3>
        <div class="chat-box" id="chat-box">
          <div class="chat-msg"><div class="sender sender-bot">🤖 助手</div><div class="text">你好！我是艾德尔工单助手，你可以问我：<br>- "我的订单状态"<br>- "价格说明"<br>- "预计多久到账"</div></div>
        </div>
        <div class="chat-input">
          <input id="chat-input" placeholder="输入问题..." onkeydown="if(event.key==='Enter')askBot()">
          <button class="btn btn-magenta" onclick="askBot()">发送</button>
        </div>
      </div>
    </div>
    <div class="col-4">
      <div class="card">
        <h3>🏯 快捷操作</h3>
        <button class="btn mb-20" style="width:100%" onclick="showNewOrder()">📝 提交工单</button>
        <button class="btn btn-yellow mb-20" style="width:100%" onclick="showPage('invite')">🤝 邀请系统</button>
        <button class="btn btn-green" style="width:100%" onclick="showPage('accounts')">📊 账号列表</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>📋 我的工单</h3>
    <table>
      <thead><tr><th>#</th><th>邀请码</th><th>金额</th><th>支付方式</th><th>状态</th><th>优惠</th><th>时间</th></tr></thead>
      <tbody id="orders-table"></tbody>
    </table>
  </div>
</div>
\`;

PAGES.admin = () => \`
<div class="container">
  <h2 class="page-title">// 管理后台</h2>

  <div class="tabs">
    <div class="tab active" onclick="switchTab(this,'pending-orders')">⏳ 待审核</div>
    <div class="tab" onclick="switchTab(this,'all-orders')">📋 全部工单</div>
    <div class="tab" onclick="switchTab(this,'users')">👥 用户管理</div>
  </div>

  <div class="tab-content active" id="pending-orders">
    <div class="card"><h3>待审核工单</h3><table><thead><tr><th>#</th><th>用户</th><th>邀请码</th><th>方式</th><th>金额</th><th>时间</th><th>操作</th></tr></thead><tbody id="admin-pending-table"></tbody></table></div>
  </div>
  <div class="tab-content" id="all-orders">
    <div class="card"><h3>全部工单</h3><table><thead><tr><th>#</th><th>用户</th><th>邀请码</th><th>方式</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody id="admin-all-table"></tbody></table></div>
  </div>
  <div class="tab-content" id="users">
    <div class="card"><h3>用户列表</h3><table><thead><tr><th>ID</th><th>用户名</th><th>等级</th><th>工单数</th><th>积分</th><th>邀请码</th><th>注册时间</th></tr></thead><tbody id="admin-users-table"></tbody></table></div>
  </div>
</div>
\`;

PAGES.invite = () => \`
<div class="container" style="max-width:600px">
  <h2 class="page-title">// 邀请系统</h2>
  <div class="card">
    <h3>🤝 我的邀请码</h3>
    <div class="stat"><span class="label">邀请码</span><span class="value" id="inv-code">-</span></div>
    <div class="stat"><span class="label">已邀请</span><span class="value" id="inv-count">-</span></div>
    <div class="stat"><span class="label">成交返利</span><span class="value" id="inv-orders">-</span></div>
    <div class="stat"><span class="label">积分余额</span><span class="value" id="inv-points">-</span></div>
    <div class="stat"><span class="label">分成比例</span><span class="value" style="color:var(--neon-green)">30%</span></div>
    <button class="btn mt-20" onclick="copyInvite()">📋 复制邀请链接</button>
  </div>
  <div class="card">
    <h3>📖 邀请说明</h3>
    <p>1. 将你的邀请码分享给好友<br>2. 好友注册时填写你的邀请码<br>3. 好友订单审核通过后，你获得该订单金额30%的邀请积分<br>4. 邀请积分可用于在平台消费或提现</p>
  </div>
</div>
\`;

PAGES.accounts = () => \`
<div class="container">
  <h2 class="page-title">// 账号列表</h2>
  <div class="card">
    <table>
      <thead><tr><th>#</th><th>游戏账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查时间</th></tr></thead>
      <tbody id="accounts-table"></tbody>
    </table>
  </div>
</div>
\`;

// ─── Router ────────────────────────────────
function showPage(name) {
  const app = document.getElementById('app');
  if (PAGES[name]) {
    app.innerHTML = PAGES[name]();
    window.scrollTo(0, 0);
    if (name === 'dashboard' && TOKEN) refreshDashboard();
    if (name === 'admin' && TOKEN) refreshAdmin();
    if (name === 'invite' && TOKEN) refreshInvite();
    if (name === 'accounts' && TOKEN) refreshAccounts();
  }
}

// ─── Auth ───────────────────────────────────
async function checkAuth() {
  if (!TOKEN) { updateNav(false); return; }
  const r = await api('GET', '/api/user/info');
  if (r.ok) {
    USER = r.user;
    updateNav(true);
    document.getElementById('app').innerHTML = PAGES.dashboard();
    refreshDashboard();
  } else {
    TOKEN = '';
    localStorage.removeItem('token');
    updateNav(false);
  }
}

function updateNav(loggedIn) {
  document.getElementById('nav-login').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-register').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-dashboard').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-logout').classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    document.getElementById('nav-dashboard').textContent = '控制台';
  }
}

async function doLogin() {
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  if (!username || !password) return alert('请填写完整');
  const r = await api('POST', '/api/auth/login', { username, password });
  if (r.ok) {
    TOKEN = r.token;
    USER = r.user;
    localStorage.setItem('token', TOKEN);
    showPage('dashboard');
    refreshDashboard();
  } else {
    alert(r.error || '登录失败');
  }
}

async function doRegister() {
  const username = document.getElementById('reg-user').value;
  const password = document.getElementById('reg-pass').value;
  const email = document.getElementById('reg-email').value;
  const invite_code = document.getElementById('reg-invite').value;
  if (!username || !password) return alert('请填写完整');
  const r = await api('POST', '/api/auth/register', { username, password, email, invite_code });
  if (r.ok) {
    alert('注册成功，请登录');
    showPage('login');
  } else {
    alert(r.error || '注册失败');
  }
}

function logout() {
  TOKEN = '';
  USER = null;
  localStorage.removeItem('token');
  showPage('landing');
  updateNav(false);
}

// ─── Dashboard ──────────────────────────────
async function refreshDashboard() {
  if (!TOKEN) return;
  const info = await api('GET', '/api/user/info');
  if (info.ok && info.user) {
    document.getElementById('d-username').textContent = info.user.username;
    document.getElementById('d-level').textContent = 'Lv.' + (info.user.level || 1);
    document.getElementById('d-orders').textContent = info.user.total_orders || 0;
    document.getElementById('d-invite').textContent = info.user.invite_code || '-';
    document.getElementById('d-points').textContent = (info.user.invite_points || 0).toFixed(1);
    const inviteInfo = await api('GET', '/api/invite/info');
    if (inviteInfo.ok) {
      document.getElementById('d-invited').textContent = inviteInfo.total_invited || 0;
    }
  }
  const orders = await api('GET', '/api/orders');
  if (orders.ok && orders.orders) {
    const tbody = document.getElementById('orders-table');
    tbody.innerHTML = orders.orders.map(o => \`
      <tr>
        <td>#\${o.id}</td>
        <td>\${o.invite_code}</td>
        <td>\${o.price.toFixed(2)}</td>
        <td>\${o.payment_method === 'wechat' ? '微信' : '灵石'}</td>
        <td><span class="badge badge-\${o.status}">\${({pending:'⏳审核中',approved:'✅已通过',rejected:'❌已拒绝',completed:'🎉已完成'})[o.status]||o.status}</span></td>
        <td>\${o.discount > 0 ? o.discount + '%' : '-'}</td>
        <td style="font-size:0.8em;color:var(--text-dim)">\${o.created_at}</td>
      </tr>
    \`).join('');
  }
}

// ─── New Order ──────────────────────────────
function showNewOrder() {
  if (!TOKEN) return alert('请先登录');
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container" style="max-width:500px">
    <h2 class="page-title">// 提交工单</h2>
    <div class="card">
      <div class="form-group">
        <label>邀请码 <span style="color:var(--text-dim);font-weight:normal">（需要注册的邀请码）</span></label>
        <input id="o-invite-code" placeholder="输入邀请码">
      </div>
      <div class="form-group">
        <label>支付方式</label>
        <select id="o-payment">
          <option value="wechat">微信支付</option>
          <option value="spirit_stone">灵石</option>
        </select>
      </div>
      <div class="form-group">
        <label>金额</label>
        <input id="o-amount" type="number" min="1" placeholder="微信: 元 / 灵石: 100万的倍数" oninput="calcPrice()">
        <div id="o-price-display" style="color:var(--neon-cyan);font-size:0.9em;margin-top:4px"></div>
      </div>
      <div class="form-group">
        <label>付款账号名</label>
        <input id="o-payment-account" placeholder="你的微信昵称或游戏ID">
      </div>
      <div class="form-group">
        <label>绑定账号名称（选填）</label>
        <input id="o-bind-name" placeholder="游戏角色名">
      </div>
      <div class="form-group">
        <label>绑定账号邀请码（选填）</label>
        <input id="o-bind-code" placeholder="该账号使用的邀请码">
      </div>
      <div class="form-group">
        <label>优惠码（选填）</label>
        <input id="o-coupon" placeholder="输入优惠码" onblur="validateCoupon()">
        <div id="o-coupon-result" style="font-size:0.85em;margin-top:4px"></div>
      </div>
      <button class="btn btn-magenta" onclick="submitOrder()">提交工单</button>
      <button class="btn" onclick="showPage('dashboard')" style="margin-left:8px">取消</button>
    </div>
  </div>\`;
}

async function calcPrice() {
  const amt = parseFloat(document.getElementById('o-amount').value) || 0;
  const method = document.getElementById('o-payment').value;
  if (method === 'wechat') {
    document.getElementById('o-price-display').textContent = '≈ ' + (amt * 120) + ' 邀请积分';
  } else {
    document.getElementById('o-price-display').textContent = '≈ ' + amt + ' 邀请积分（' + (amt * 1000000).toLocaleString() + ' 灵石）';
  }
}

let validatedDiscount = 0;
async function validateCoupon() {
  const code = document.getElementById('o-coupon').value;
  const result = document.getElementById('o-coupon-result');
  if (!code) { result.textContent = ''; validatedDiscount = 0; return; }
  const r = await api('POST', '/api/coupon/validate', { code });
  if (r.ok) {
    validatedDiscount = r.discount_percent;
    result.textContent = '✅ 优惠码有效，享 ' + r.discount_percent + '% 折扣';
    result.style.color = 'var(--neon-green)';
  } else {
    validatedDiscount = 0;
    result.textContent = '❌ ' + (r.error || '无效优惠码');
    result.style.color = '#ff4444';
  }
}

async function submitOrder() {
  const invite_code = document.getElementById('o-invite-code').value;
  const payment_method = document.getElementById('o-payment').value;
  const amount = parseInt(document.getElementById('o-amount').value) || 0;
  const payment_account = document.getElementById('o-payment-account').value;
  const coupon_code = document.getElementById('o-coupon').value;
  const bind_account_name = document.getElementById('o-bind-name').value;
  const bind_invite_code = document.getElementById('o-bind-code').value;

  if (!invite_code || !payment_account || amount < 1) return alert('请填写完整信息');
  const r = await api('POST', '/api/orders', { invite_code, payment_method, amount, payment_account, coupon_code, bind_account_name, bind_invite_code });
  if (r.ok) {
    alert('工单已提交！请等待管理员审核。');
    showPage('dashboard');
  } else {
    alert(r.error || '提交失败');
  }
}

// ─── Admin ──────────────────────────────────
async function refreshAdmin() {
  const pending = await api('GET', '/api/admin/orders?status=pending');
  if (pending.ok) {
    document.getElementById('admin-pending-table').innerHTML = (pending.orders||[]).map(o => \`
      <tr>
        <td>#\${o.id}</td>
        <td>\${o.user_name}</td>
        <td>\${o.invite_code}</td>
        <td>\${o.payment_method === 'wechat' ? '微信' : '灵石'}</td>
        <td>\${o.price.toFixed(2)}</td>
        <td style="font-size:0.8em">\${o.created_at}</td>
        <td>
          <button class="btn btn-green" style="padding:4px 12px;font-size:0.8em" onclick="approveOrder(\${o.id})">通过</button>
          <button class="btn" style="padding:4px 12px;font-size:0.8em;border-color:#ff4444;color:#ff4444" onclick="rejectOrder(\${o.id})">拒绝</button>
        </td>
      </tr>
    \`).join('');
  }
  const all = await api('GET', '/api/admin/orders');
  if (all.ok) {
    document.getElementById('admin-all-table').innerHTML = (all.orders||[]).map(o => \`
      <tr>
        <td>#\${o.id}</td>
        <td>\${o.user_name}</td>
        <td>\${o.invite_code}</td>
        <td>\${o.payment_method === 'wechat' ? '微信' : '灵石'}</td>
        <td>\${o.price.toFixed(2)}</td>
        <td><span class="badge badge-\${o.status}">\${o.status}</span></td>
        <td style="font-size:0.8em">\${o.created_at}</td>
      </tr>
    \`).join('');
  }
  const users = await api('GET', '/api/admin/users');
  if (users.ok) {
    document.getElementById('admin-users-table').innerHTML = (users.users||[]).map(u => \`
      <tr>
        <td>\${u.id}</td>
        <td>\${u.username}</td>
        <td>Lv.\${u.level}</td>
        <td>\${u.total_orders}</td>
        <td>\${(u.invite_points||0).toFixed(1)}</td>
        <td>\${u.invite_code||'-'}</td>
        <td style="font-size:0.8em">\${u.created_at||'-'}</td>
      </tr>
    \`).join('');
  }
}

async function approveOrder(id) {
  const notes = prompt('审核备注（可选）:');
  const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'approved', admin_notes: notes || '' });
  if (r.ok) { alert('已通过'); refreshAdmin(); }
  else alert(r.error);
}

async function rejectOrder(id) {
  const notes = prompt('拒绝原因:');
  if (!notes) return alert('请填写拒绝原因');
  const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'rejected', admin_notes: notes });
  if (r.ok) { alert('已拒绝'); refreshAdmin(); }
  else alert(r.error);
}

// ─── Invite ─────────────────────────────────
async function refreshInvite() {
  const r = await api('GET', '/api/invite/info');
  if (r.ok) {
    document.getElementById('inv-code').textContent = r.invite_code || '-';
    document.getElementById('inv-count').textContent = r.total_invited || 0;
    document.getElementById('inv-orders').textContent = r.invite_orders || 0;
    document.getElementById('inv-points').textContent = (r.invite_points || 0).toFixed(1);
  }
}

function copyInvite() {
  const code = document.getElementById('inv-code').textContent;
  if (code && code !== '-') {
    const link = window.location.origin + '/?invite=' + code;
    navigator.clipboard.writeText(link).then(() => alert('邀请链接已复制: ' + link));
  }
}

// ─── Accounts ───────────────────────────────
async function refreshAccounts() {
  const r = await api('GET', '/api/accounts');
  if (r.ok && r.accounts) {
    document.getElementById('accounts-table').innerHTML = r.accounts.map(a => \`
      <tr>
        <td>#\${a.order_id}</td>
        <td>\${a.server_username || a.username}</td>
        <td>\${a.level || 0}</td>
        <td>\${a.map_name || '-'}</td>
        <td><span class="badge badge-\${a.status}">\${a.status}</span></td>
        <td style="font-size:0.8em">\${(()=>{try{return JSON.parse(a.skills||'[]').map(s=>s.name||s).join(', ')}catch(e){return a.skills||'-'}})()}</td>
        <td style="font-size:0.8em">\${(()=>{try{return JSON.parse(a.techniques||'[]').map(t=>t.name||t).join(', ')}catch(e){return a.techniques||'-'}})()}</td>
        <td style="font-size:0.8em">\${(()=>{try{return JSON.parse(a.equipment||'[]').map(e=>e.name||e).join(', ')}catch(e){return a.equipment||'-'}})()}</td>
        <td style="font-size:0.8em;color:var(--text-dim)">\${a.last_check_at || '-'}</td>
      </tr>
    \`).join('');
  }
}

// ─── Bot ────────────────────────────────────
async function askBot() {
  const input = document.getElementById('chat-input');
  const box = document.getElementById('chat-box');
  if (!input.value.trim()) return;
  box.innerHTML += '<div class="chat-msg"><div class="sender">👤 我</div><div class="text">' + escapeHtml(input.value) + '</div></div>';
  const r = await api('POST', '/api/bot/ask', { question: input.value });
  const answer = r.answer || '抱歉，我不太理解';
  box.innerHTML += '<div class="chat-msg"><div class="sender sender-bot">🤖 助手</div><div class="text">' + escapeHtml(answer) + '</div></div>';
  input.value = '';
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

// ─── Tab ────────────────────────────────────
function switchTab(el, id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(id).classList.add('active');
}

// ─── Init ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!TOKEN) {
    showPage('landing');
  } else {
    checkAuth();
  }

  // Check if user is admin
  if (TOKEN) {
    api('GET', '/api/user/info').then(r => {
      if (r.ok && r.user && r.user.level >= 99) {
        const nav = document.querySelector('.nav-links');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = '管理';
        a.onclick = () => showPage('admin');
        nav.insertBefore(a, nav.children[3]);
      }
    });
  }
});
<\/script>
</body>
</html>`;

const indexHTML = LANDING_HTML;
