export async function renderStaticAsset(name, env) {
  switch (name) {
    case 'index.html': return HTML;
    default: return null;
  }
}

const C = `/* ═══ Cyberpunk Ultimate Theme ═══ */
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;700&display=swap');
:root {
  --cyan: #00f0ff; --magenta: #ff00aa; --yellow: #ffe600;
  --green: #00ff88; --red: #ff3344; --purple: #7c3aed;
  --bg-deep: #03030a; --bg-dark: #070714; --bg-card: rgba(14,14,36,0.85);
  --bg-input: rgba(20,20,48,0.9); --text: #d0d8ee; --text-dim: #7880a8;
  --text-bright: #eef2ff; --border: rgba(0,240,255,0.12);
  --border-m: rgba(255,0,170,0.15); --shadow-c: 0 0 20px rgba(0,240,255,0.12);
  --shadow-m: 0 0 20px rgba(255,0,170,0.12);
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Noto Sans SC', 'Courier New', monospace;
  background: var(--bg-deep); color: var(--text); min-height:100vh;
  overflow-x:hidden; line-height:1.7; font-weight:300;
}
::-webkit-scrollbar { width:5px; }
::-webkit-scrollbar-track { background:var(--bg-deep); }
::-webkit-scrollbar-thumb { background:var(--cyan); border-radius:3px; }
a { color:var(--cyan); text-decoration:none; transition:all .3s; }

/* ─── Animated Background ─────────── */
.bg-grid {
  position:fixed; top:0; left:0; right:0; bottom:0; z-index:0;
  background-image:
    linear-gradient(rgba(0,240,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,240,255,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events:none;
}
.bg-glow {
  position:fixed; top:-30%; left:-10%; width:60%; height:60%;
  background:radial-gradient(circle, rgba(0,240,255,0.04), transparent 70%);
  pointer-events:none; animation:bgFloat 20s ease-in-out infinite;
}
.bg-glow-2 {
  position:fixed; bottom:-20%; right:-10%; width:50%; height:50%;
  background:radial-gradient(circle, rgba(255,0,170,0.03), transparent 70%);
  pointer-events:none; animation:bgFloat2 25s ease-in-out infinite;
}
@keyframes bgFloat {
  0%,100% { transform:translate(0,0) scale(1); }
  50% { transform:translate(10%,10%) scale(1.1); }
}
@keyframes bgFloat2 {
  0%,100% { transform:translate(0,0) scale(1); }
  50% { transform:translate(-10%,-10%) scale(1.15); }
}
.scanline {
  position:fixed; top:0; left:0; right:0; bottom:0; z-index:9998;
  background:repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,240,255,0.008) 2px, rgba(0,240,255,0.008) 4px);
  pointer-events:none;
}
.scanline::after {
  content:''; position:absolute; top:-100px; left:0; right:0; height:120px;
  background:linear-gradient(180deg, rgba(0,240,255,0.02), transparent);
  animation:scanMove 7s linear infinite;
}
@keyframes scanMove { 0% { top:-120px; } 100% { top:100vh; } }

/* ─── Particles ───────────────────── */
.particles { position:fixed; top:0; left:0; right:0; bottom:0; z-index:0; pointer-events:none; overflow:hidden; }
.particle {
  position:absolute; width:2px; height:2px;
  background:var(--cyan); border-radius:50%;
  opacity:0; animation:particleFloat 8s infinite;
}
@keyframes particleFloat {
  0% { transform:translateY(100vh) scale(0); opacity:0; }
  20% { opacity:0.6; }
  80% { opacity:0.6; }
  100% { transform:translateY(-10vh) scale(1); opacity:0; }
}

/* ─── Glitch ──────────────────────── */
.glitch {
  position:relative; animation:glitchPulse 4s infinite;
}
@keyframes glitchPulse {
  0%,85%,100% { text-shadow:0 0 20px var(--cyan), 0 0 40px var(--cyan); }
  90% { text-shadow:-3px 0 var(--magenta), 3px 0 var(--cyan), 0 0 60px var(--cyan); }
  95% { text-shadow:3px 0 var(--magenta), -3px 0 var(--cyan), 0 0 60px var(--magenta); }
}

/* ─── Nav ──────────────────────────── */
nav {
  display:flex; align-items:center; justify-content:space-between;
  padding:14px 36px;
  border-bottom:1px solid var(--border);
  background:rgba(3,3,10,0.88); backdrop-filter:blur(20px);
  position:sticky; top:0; z-index:1000;
}
nav .logo {
  font-family:'Orbitron', monospace; font-size:1.15em; font-weight:700;
  color:var(--cyan); text-shadow:0 0 20px var(--cyan), 0 0 40px var(--cyan);
  letter-spacing:3px; display:flex; align-items:center; gap:8px;
}
nav .logo .dot { color:var(--magenta); text-shadow:0 0 20px var(--magenta); }
nav .nav-links { display:flex; gap:6px; align-items:center; }
nav .nav-links a {
  font-size:0.78em; text-transform:uppercase; letter-spacing:2px;
  color:var(--text-dim); transition:all .3s;
  padding:7px 14px; border-radius:4px;
}
nav .nav-links a:hover { color:var(--cyan); background:rgba(0,240,255,0.05); }
nav .nav-links .btn-link { border-radius:0; padding:7px 18px; }
.nav-toggle { display:none; background:none; border:none; color:var(--cyan); font-size:1.5em; cursor:pointer; padding:4px 10px; line-height:1; }
.nav-badge {
  display:inline-flex; align-items:center; justify-content:center;
  background:var(--magenta); color:#fff; font-size:0.6em;
  padding:1px 6px; border-radius:10px; min-width:18px; height:16px;
  margin-left:2px; box-shadow:0 0 8px rgba(255,0,170,0.4);
}

/* ─── Buttons ──────────────────────── */
.btn {
  display:inline-flex; align-items:center; gap:8px;
  padding:10px 26px; border:1px solid var(--cyan);
  color:var(--cyan); background:transparent;
  font-family:inherit; font-size:0.82em; cursor:pointer;
  text-transform:uppercase; letter-spacing:2px;
  transition:all .3s; position:relative; overflow:hidden;
}
.btn::before {
  content:''; position:absolute; top:0; left:-100%; width:100%; height:100%;
  background:linear-gradient(90deg, transparent, rgba(0,240,255,0.08), transparent);
  transition:left .6s;
}
.btn:hover::before { left:100%; }
.btn:hover {
  background:rgba(0,240,255,0.06); border-color:var(--cyan);
  box-shadow:var(--shadow-c); transform:translateY(-1px);
}
.btn:active { transform:translateY(0); }
.btn-magenta { border-color:var(--magenta); color:var(--magenta); }
.btn-magenta:hover { background:rgba(255,0,170,0.06); box-shadow:var(--shadow-m); }
.btn-green { border-color:var(--green); color:var(--green); }
.btn-green:hover { background:rgba(0,255,136,0.06); box-shadow:0 0 20px rgba(0,255,136,0.1); }
.btn-purple { border-color:var(--purple); color:var(--purple); }
.btn-purple:hover { background:rgba(124,58,237,0.12); box-shadow:0 0 20px rgba(124,58,237,0.15); }
.btn-yellow { border-color:var(--yellow); color:var(--yellow); }
.btn-red { border-color:var(--red); color:var(--red); }
.btn-red:hover { background:rgba(255,51,68,0.06); }
.btn-sm { padding:6px 16px; font-size:0.75em; }
.btn-block { width:100%; justify-content:center; }
.btn:disabled { opacity:0.35; cursor:not-allowed; transform:none; }

/* ─── Container ────────────────────── */
.container { position:relative; z-index:1; max-width:1200px; margin:0 auto; padding:28px 20px; }
.page-title {
  font-family:'Orbitron', monospace;
  font-size:1.2em; text-transform:uppercase;
  color:var(--cyan); text-shadow:0 0 15px rgba(0,240,255,0.3);
  margin-bottom:24px; letter-spacing:4px;
  display:flex; align-items:center; gap:14px; font-weight:700;
}
.page-title .sub { font-size:0.45em; color:var(--text-dim); letter-spacing:2px; font-weight:300; }
.page-title::before { content:'//'; color:var(--magenta); font-size:0.8em; opacity:0.7; }

/* ─── Hero ─────────────────────────── */
.hero {
  position:relative; z-index:1;
  text-align:center; padding:120px 20px 70px;
  overflow:hidden;
}
.hero h1 {
  font-family:'Orbitron', monospace;
  font-size:3em; text-transform:uppercase; line-height:1.15;
  text-shadow:0 0 40px var(--cyan), 0 0 80px var(--cyan), 0 0 120px rgba(0,240,255,0.3);
  margin-bottom:18px;
}
.hero h1 .hl { color:var(--magenta); text-shadow:0 0 40px var(--magenta), 0 0 80px var(--magenta); }
.hero p {
  font-size:1.05em; color:var(--text-dim); max-width:620px;
  margin:0 auto 38px; line-height:1.9; font-weight:300;
}
.hero .btn-group { display:flex; gap:16px; justify-content:center; flex-wrap:wrap; }
.hero-stats {
  display:flex; justify-content:center; gap:50px; margin-top:60px; flex-wrap:wrap;
}
.hero-stat { text-align:center; }
.hero-stat .num {
  font-family:'Orbitron', monospace; font-size:2.4em; font-weight:700;
  color:var(--cyan); text-shadow:0 0 20px var(--cyan);
}
.hero-stat .num.glow-m { text-shadow:0 0 20px var(--magenta); color:var(--magenta); }
.hero-stat .num.glow-g { text-shadow:0 0 20px var(--green); color:var(--green); }
.hero-stat .label { font-size:0.72em; color:var(--text-dim); text-transform:uppercase; letter-spacing:2px; margin-top:4px; }

/* ─── Glass Card ───────────────────── */
.card {
  background:var(--bg-card); padding:22px; border-radius:8px;
  border:1px solid var(--border);
  backdrop-filter:blur(12px);
  transition:all .4s cubic-bezier(.4,0,.2,1);
}
.card:hover {
  border-color:rgba(0,240,255,0.2);
  box-shadow:0 8px 32px rgba(0,0,0,0.3), var(--shadow-c);
  transform:translateY(-2px);
}
.card h3 {
  font-size:0.85em; color:var(--cyan); margin-bottom:14px;
  text-transform:uppercase; letter-spacing:2px; font-weight:400;
  display:flex; align-items:center; gap:8px;
}
.card .stat {
  display:flex; justify-content:space-between; align-items:center;
  padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.03);
  font-size:0.85em;
}
.card .stat:last-child { border-bottom:none; }
.card .stat .label { color:var(--text-dim); }
.card .stat .value { color:var(--text-bright); font-weight:600; }

/* ─── Grid ─────────────────────────── */
.grid { display:grid; gap:18px; }
.grid-2 { grid-template-columns:1fr 1fr; }
.grid-3 { grid-template-columns:1fr 1fr 1fr; }
.grid-4 { grid-template-columns:1fr 1fr 1fr 1fr; }

/* ─── Feature Card ─────────────────── */
.feature-card {
  background:var(--bg-card); padding:30px 26px; border-radius:8px;
  border:1px solid var(--border); backdrop-filter:blur(12px);
  position:relative; transition:all .4s cubic-bezier(.4,0,.2,1);
}
.feature-card::before {
  content:'//'; position:absolute; top:10px; right:16px;
  color:var(--magenta); opacity:0.25; font-size:1em;
  font-family:'Orbitron', monospace;
}
.feature-card:hover {
  border-color:rgba(0,240,255,0.2); transform:translateY(-3px);
  box-shadow:0 12px 40px rgba(0,0,0,0.3), var(--shadow-c);
}
.feature-card h3 { color:var(--cyan); margin-bottom:10px; font-size:1em; letter-spacing:1px; font-weight:400; }
.feature-card p { color:var(--text-dim); font-size:0.88em; line-height:1.8; font-weight:300; }

/* ─── Price Card ───────────────────── */
.price-card {
  background:var(--bg-card); padding:36px 28px; border-radius:8px;
  border:1px solid var(--border); text-align:center;
  backdrop-filter:blur(12px); transition:all .4s cubic-bezier(.4,0,.2,1);
}
.price-card.featured {
  border-color:var(--magenta); box-shadow:0 0 30px rgba(255,0,170,0.08);
}
.price-card:hover { transform:translateY(-3px); }
.price-card.featured:hover { box-shadow:0 0 40px rgba(255,0,170,0.15); }
.price-card .price {
  font-family:'Orbitron', monospace; font-size:2.6em; font-weight:700;
  color:var(--cyan); text-shadow:0 0 20px var(--cyan); margin:14px 0;
}
.price-card .price span { font-size:0.4em; color:var(--text-dim); }
.price-card h3 {
  font-family:'Orbitron', monospace; font-size:0.95em; letter-spacing:3px;
  color:var(--magenta); text-transform:uppercase;
}
.price-card ul { list-style:none; text-align:left; margin:18px 0; }
.price-card ul li { padding:6px 0; color:var(--text-dim); font-size:0.85em; }
.price-card ul li::before { content:'▸ '; color:var(--cyan); }

/* ─── Forms ────────────────────────── */
input, select, textarea {
  width:100%; padding:11px 16px; border-radius:6px;
  background:var(--bg-input); border:1px solid var(--border);
  color:var(--text); font-family:inherit; font-size:0.9em;
  outline:none; transition:all .3s;
}
input:focus, select:focus, textarea:focus {
  border-color:var(--cyan); box-shadow:0 0 16px rgba(0,240,255,0.1);
}
label {
  display:block; margin-bottom:6px; color:var(--cyan);
  font-size:0.72em; text-transform:uppercase; letter-spacing:2px; font-weight:300;
}
.form-group { margin-bottom:20px; }
.form-row { display:flex; gap:16px; }
.form-row > * { flex:1; }

/* ─── Badges ───────────────────────── */
.badge {
  display:inline-block; padding:3px 12px; font-size:0.7em;
  text-transform:uppercase; letter-spacing:1.5px; border-radius:4px;
  border:1px solid; font-weight:400;
}
.badge-pending { border-color:var(--yellow); color:var(--yellow); }
.badge-approved { border-color:var(--green); color:var(--green); }
.badge-rejected { border-color:var(--red); color:var(--red); }
.badge-completed { border-color:var(--cyan); color:var(--cyan); }
.badge-registering, .badge-creating { border-color:var(--yellow); color:var(--yellow); }
.badge-farming, .badge-active { border-color:var(--magenta); color:var(--magenta); }
.badge-failed, .badge-error { border-color:var(--red); color:var(--red); }
.badge-resolved { border-color:var(--green); color:var(--green); }
.badge-after_sales { border-color:var(--purple); color:var(--purple); }
.badge-registering { border-color:var(--yellow); color:var(--yellow); }

/* ─── Table ────────────────────────── */
.table-wrap { overflow-x:auto; border-radius:6px; }
table { width:100%; border-collapse:collapse; font-size:0.82em; }
th, td {
  padding:11px 14px; text-align:left;
  border-bottom:1px solid rgba(255,255,255,0.03); white-space:nowrap;
}
th {
  color:var(--cyan); text-transform:uppercase; letter-spacing:1.5px;
  font-size:0.7em; font-weight:400; background:rgba(0,240,255,0.02);
}
tr:hover td { background:rgba(0,240,255,0.04); }
tr:last-child td { border-bottom:none; }

/* ─── Search/Select inputs ──────────── */
select { appearance:auto; -webkit-appearance:auto; cursor:pointer; }
input[type="date"]::-webkit-calendar-picker-indicator { filter:invert(0.7); cursor:pointer; }

/* ─── Timeline ──────────────────────── */
.timeline { position:relative; padding-left:28px; }
.timeline::before { content:''; position:absolute; left:8px; top:4px; bottom:4px; width:2px; background:var(--border); }
.tl-item { position:relative; padding:5px 0 10px; font-size:0.85em; }
.tl-item::before { content:''; position:absolute; left:-20px; top:9px; width:10px; height:10px; border-radius:50%; background:var(--cyan); border:2px solid var(--bg-deep); }
.tl-item.tl-created::before { background:var(--cyan); }
.tl-item.tl-approved::before { background:var(--green); }
.tl-item.tl-rejected::before { background:var(--red); }
.tl-item.tl-completed::before { background:var(--yellow); }
.tl-item.tl-account_created::before { background:var(--purple); }
.tl-item.tl-commission::before { background:var(--magenta); }
.tl-item .tl-time { font-size:0.75em; color:var(--text-dim); }
.tl-item .tl-action { color:var(--text-bright); font-weight:400; }
.tl-item .tl-detail { color:var(--text-dim); font-size:0.9em; }

/* ─── Modal ────────────────────────── */
.modal-overlay {
  display:none; position:fixed; top:0; left:0; right:0; bottom:0;
  background:rgba(0,0,0,0.8); z-index:2000;
  justify-content:center; align-items:center;
  backdrop-filter:blur(6px);
}
.modal-overlay.show { display:flex; }
.modal {
  background:var(--bg-card); padding:32px; border-radius:8px;
  border:1px solid var(--border); backdrop-filter:blur(16px);
  max-width:520px; width:92%; max-height:85vh; overflow-y:auto;
}
.modal h2 { color:var(--cyan); margin-bottom:16px; font-size:1em; text-transform:uppercase; letter-spacing:3px; font-family:'Orbitron', monospace; }
.modal .btn-group { display:flex; gap:12px; justify-content:flex-end; margin-top:24px; }

/* ─── Tabs ─────────────────────────── */
.tabs {
  display:flex; gap:2px; margin-bottom:20px;
  border-bottom:1px solid var(--border); overflow-x:auto;
}
.tab {
  padding:11px 24px; cursor:pointer; border-radius:4px 4px 0 0;
  color:var(--text-dim); border-bottom:2px solid transparent;
  text-transform:uppercase; letter-spacing:2px; font-size:0.78em;
  transition:all .3s; white-space:nowrap; font-weight:300;
}
.tab.active { color:var(--cyan); border-bottom-color:var(--cyan); background:rgba(0,240,255,0.03); }
.tab:hover { color:var(--text); }
.tab-content { display:none; }
.tab-content.active { display:block; }

/* ─── Chat ─────────────────────────── */
.chat-box {
  background:var(--bg-input); border:1px solid var(--border); border-radius:6px;
  height:320px; overflow-y:auto; padding:16px; margin-bottom:12px;
  scroll-behavior:smooth;
}
.chat-msg { margin-bottom:16px; animation:msgIn .3s ease; }
@keyframes msgIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.chat-msg .sender { font-size:0.7em; color:var(--cyan); margin-bottom:4px; text-transform:uppercase; letter-spacing:1.5px; }
.chat-msg .sender-bot { color:var(--magenta); }
.chat-msg .text { color:var(--text); font-size:0.88em; line-height:1.7; white-space:pre-wrap; }
.chat-row { display:flex; gap:10px; }
.chat-row input { flex:1; }

/* ─── Progress ─────────────────────── */
.progress-bar {
  height:3px; background:var(--bg-input); margin:10px 0; border-radius:2px; overflow:hidden;
}
.progress-bar .fill {
  height:100%;
  background:linear-gradient(90deg, var(--cyan), var(--magenta), var(--cyan));
  background-size:200% 100%; animation:progGlow 2s linear infinite;
  transition:width .8s cubic-bezier(.4,0,.2,1);
}
@keyframes progGlow { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }

/* ─── Loader ───────────────────────── */
.loader {
  display:inline-block; width:24px; height:24px;
  border:2px solid rgba(0,240,255,0.1);
  border-top-color:var(--cyan); border-radius:50%;
  animation:spin .7s linear infinite;
}
@keyframes spin { to { transform:rotate(360deg); } }

/* ─── Level Badge ──────────────────── */
.level-badge {
  display:inline-flex; align-items:center; gap:4px;
  padding:4px 12px; border:1px solid var(--cyan); font-size:0.7em;
  letter-spacing:2px; text-transform:uppercase; border-radius:4px;
  font-weight:400;
}
.level-badge.high { border-color:var(--magenta); color:var(--magenta); }

/* ─── Toast ────────────────────────── */
.toast-container {
  position:fixed; top:80px; right:24px; z-index:9999;
  display:flex; flex-direction:column; gap:8px;
}
.toast {
  padding:14px 22px; border:1px solid; border-radius:6px;
  font-size:0.85em; backdrop-filter:blur(12px);
  animation:slideIn .35s ease; max-width:400px;
  background:rgba(10,10,26,0.9);
}
.toast-success { border-color:var(--green); color:var(--green); box-shadow:0 0 16px rgba(0,255,136,0.1); }
.toast-error { border-color:var(--red); color:var(--red); box-shadow:0 0 16px rgba(255,51,68,0.1); }
.toast-info { border-color:var(--cyan); color:var(--cyan); box-shadow:0 0 16px rgba(0,240,255,0.1); }
@keyframes slideIn { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }

/* ─── Utils ────────────────────────── */
.hidden { display:none !important; }
.text-center { text-align:center; }
.mt-10 { margin-top:10px; }
.mt-20 { margin-top:20px; }
.mb-10 { margin-bottom:10px; }
.mb-20 { margin-bottom:20px; }
.flex { display:flex; }
.flex-between { display:flex; justify-content:space-between; align-items:center; }
.gap-10 { gap:10px; }
.flex-wrap { flex-wrap:wrap; }
.items-center { align-items:center; }
.empty-state { text-align:center; padding:70px 20px; color:var(--text-dim); }
.empty-state .icon { font-size:3.5em; margin-bottom:14px; opacity:0.35; }
.empty-state p { font-size:0.9em; }
.animate-in { animation:fadeUp .5s ease; }
@keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }

/* ─── Page Loading ─────────────────── */
.page-loading { position:fixed; top:0; left:0; right:0; bottom:0; z-index:9997; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--bg-deep); transition:opacity .4s; }
.page-loading.fade-out { opacity:0; pointer-events:none; }
.page-loading .bar { width:60px; height:3px; background:linear-gradient(90deg, var(--cyan), var(--magenta)); border-radius:2px; animation:loadPulse 1s ease-in-out infinite; }
@keyframes loadPulse { 0%,100% { transform:scaleX(0.6); opacity:0.4; } 50% { transform:scaleX(1); opacity:1; } }

/* ─── Typing Indicator ─────────────── */
.typing-dots { display:inline-flex; gap:3px; padding:4px 0; }
.typing-dots span { width:6px; height:6px; border-radius:50%; background:var(--magenta); animation:dotBounce 1.2s ease-in-out infinite; }
.typing-dots span:nth-child(2) { animation-delay:0.2s; }
.typing-dots span:nth-child(3) { animation-delay:0.4s; }
@keyframes dotBounce { 0%,60%,100% { transform:translateY(0); opacity:0.3; } 30% { transform:translateY(-6px); opacity:1; } }

/* ─── Table Scroll Hint ────────────── */
.table-wrap { position:relative; }
.table-wrap::after { content:'↔ 左右滑动'; position:absolute; bottom:4px; right:8px; font-size:0.65em; color:var(--text-dim); opacity:0; transition:opacity .5s; pointer-events:none; }
.table-wrap:hover::after, .table-scroll::after { opacity:1; }

/* ─── Responsive ───────────────────── */
@media (max-width:900px) {
  .grid-4 { grid-template-columns:1fr 1fr; }
  .grid-3 { grid-template-columns:1fr 1fr; }
}
@media (max-width:820px) {
  nav { flex-direction:row; flex-wrap:wrap; padding:10px 16px; }
  nav .nav-links {
    display:none; width:100%; flex-direction:column; gap:2px;
    padding:8px 0; border-top:1px solid var(--border); margin-top:8px;
  }
  nav .nav-links.open { display:flex; }
  nav .nav-links a { width:100%; padding:10px 14px; }
  nav .nav-links .btn-link { width:100%; justify-content:center; }
  .nav-toggle { display:block; }
  .hero h1 { font-size:1.5em; }
  .hero { padding:60px 16px 36px; }
  .form-row { flex-direction:column; gap:0; }
  .grid-2, .grid-3, .grid-4 { grid-template-columns:1fr; }
  .hero-stats { gap:20px; }
  .toast-container { left:16px; right:16px; top:72px; }
  .page-title { font-size:0.95em; letter-spacing:2px; }
  .table-wrap { margin:0 -12px; padding:0 12px; }
  .table-wrap::after { opacity:1; }
}
@media (max-width:480px) {
  .hero h1 { font-size:1.2em; }
  .hero { padding:40px 12px 28px; }
  .hero-stat .num { font-size:1.6em; }
  .container { padding:16px 12px; }
  .card { padding:16px; }
}`;

/* ─── Banner & Ads ─────────────────── */
.announce-bar { background:linear-gradient(90deg,var(--purple),var(--magenta)); padding:8px 16px; text-align:center; font-size:0.82em; color:#fff; position:relative; z-index:999; overflow:hidden; }
.announce-bar .close-bar { position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:#fff; cursor:pointer; font-size:1em; opacity:0.7; }
.ad-popup { position:fixed; top:0; left:0; right:0; bottom:0; z-index:9999; background:rgba(0,0,0,0.85); display:none; justify-content:center; align-items:center; backdrop-filter:blur(10px); }
.ad-popup.show { display:flex; }
.ad-popup-inner { max-width:360px; width:90%; border-radius:12px; overflow:hidden; border:1px solid var(--border); }
.ad-popup-inner img { width:100%; display:block; }
.ad-popup-inner .ad-close { display:block; width:100%; padding:10px; background:var(--bg-card); border:none; color:var(--text); cursor:pointer; text-align:center; font-size:0.85em; }
.ad-sidebar { position:sticky; top:80px; margin-bottom:16px; }
.ad-sidebar img { width:100%; border-radius:8px; cursor:pointer; border:1px solid var(--border); }

/* ─── Leaderboard ──────────────────── */
.lb-card { display:flex; align-items:center; gap:14px; padding:14px 18px; border-bottom:1px solid var(--border); transition:background .3s; cursor:pointer; }
.lb-card:hover { background:rgba(0,240,255,0.04); }
.lb-rank { width:32px; text-align:center; font-family:'Orbitron',monospace; font-size:1.1em; font-weight:700; }
.lb-rank.gold { color:#ffd700; } .lb-rank.silver { color:#c0c0c0; } .lb-rank.bronze { color:#cd7f32; }
.lb-avatar { width:40px; height:40px; border-radius:50%; background:var(--cyan); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:1em; color:var(--bg-deep); flex-shrink:0; }
.lb-avatar img { width:40px; height:40px; border-radius:50%; object-fit:cover; }
.lb-info { flex:1; min-width:0; }
.lb-name { font-weight:500; color:var(--text-bright); font-size:0.92em; }
.lb-name small { color:var(--text-dim); font-size:0.78em; }
.lb-stat { color:var(--cyan); font-size:0.85em; font-weight:500; }
.lb-stat .lbl { color:var(--text-dim); font-weight:300; }

/* ─── Champion Card ────────────────── */
.champ-card { background:linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,165,0,0.04)); border:1px solid rgba(255,215,0,0.2); border-radius:16px; padding:28px; text-align:center; margin-bottom:20px; }
.champ-card .champ-avatar { width:80px; height:80px; border-radius:50%; margin:0 auto 12px; background:linear-gradient(135deg,#ffd700,#ff8c00); display:flex; align-items:center; justify-content:center; font-size:2em; font-weight:900; color:var(--bg-deep); box-shadow:0 0 30px rgba(255,215,0,0.3); }
.champ-card .champ-avatar img { width:80px; height:80px; border-radius:50%; object-fit:cover; border:3px solid #ffd700; }
.champ-card .champ-name { font-size:1.3em; font-weight:700; color:#ffd700; }
.champ-card .champ-stat { color:var(--text-dim); font-size:0.9em; margin-top:6px; }
.champ-card .champ-crown { font-size:2.5em; margin-bottom:4px; }

/* ─── Profile Page ─────────────────── */
.profile-header { display:flex; align-items:center; gap:20px; flex-wrap:wrap; }
.profile-avatar { width:64px; height:64px; border-radius:50%; background:linear-gradient(135deg,var(--cyan),var(--purple)); display:flex; align-items:center; justify-content:center; font-size:1.5em; font-weight:700; color:var(--bg-deep); flex-shrink:0; overflow:hidden; }
.profile-avatar img { width:64px; height:64px; border-radius:50%; object-fit:cover; }

/* ─── Avatar Dropdown ──────────────── */
.avatar-wrap { position:relative; cursor:pointer; }
.avatar-trigger { display:flex; align-items:center; gap:8px; padding:4px 8px; border-radius:8px; transition:background .2s; }
.avatar-trigger:hover { background:rgba(0,240,255,0.08); }
.avatar-mini { width:32px; height:32px; border-radius:50%; background:var(--cyan); display:flex; align-items:center; justify-content:center; font-size:0.75em; font-weight:700; color:var(--bg-deep); overflow:hidden; flex-shrink:0; }
.avatar-mini img { width:32px; height:32px; border-radius:50%; object-fit:cover; }
.avatar-dropdown { display:none; position:absolute; top:100%; right:0; min-width:180px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:6px 0; backdrop-filter:blur(16px); z-index:1001; }
.avatar-dropdown.show { display:block; }
.avatar-dropdown a { display:flex; align-items:center; gap:10px; padding:10px 16px; color:var(--text); font-size:0.88em; transition:background .2s; }
.avatar-dropdown a:hover { background:rgba(0,240,255,0.06); color:var(--cyan); }
.avatar-dropdown .divider { height:1px; background:var(--border); margin:4px 12px; }
.avatar-name { font-size:0.85em; color:var(--text-bright); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ─── Redeem Section ───────────────── */
.redeem-input { display:flex; gap:10px; }
.redeem-input input { flex:1; padding:10px 14px; border:1px solid var(--border); background:var(--bg-input); color:var(--text); border-radius:6px; font-size:1.2em; text-align:center; letter-spacing:4px; text-transform:uppercase; }

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>艾德尔修仙工单平台</title>
<style>${C}</style>
</head>
<body>
<div class="bg-grid"></div>
<div class="bg-glow"></div>
<div class="bg-glow-2"></div>
<div class="particles" id="particles"></div>
<div class="scanline"></div>
<div id="announce-bar" class="announce-bar" style="display:none"><span id="announce-text"></span><button class="close-bar" onclick="this.parentElement.style.display='none'">&times;</button></div>
<div id="page-loading" class="page-loading"><div class="bar"></div></div>
<div id="toast-container" class="toast-container"></div>
<div id="ad-popup" class="ad-popup"><div class="ad-popup-inner"><a id="ad-popup-link" href="#" target="_blank"><img id="ad-popup-img" src="" alt=""></a><button class="ad-close" onclick="closeAdPopup()">关闭</button></div></div>

<nav id="nav">
  <div class="logo">NEON<span class="dot">⚡</span>IDER</div>
  <button class="nav-toggle" id="nav-toggle" onclick="toggleNav()">☰</button>
  <div class="nav-links" id="nav-links">
    <a href="#" data-page="landing">首页</a>
    <a href="#" data-page="control">功能</a>
    <a href="#" data-page="docs">文档</a>
    <a href="#" id="nav-invite" class="hidden" data-page="invite">邀请</a>
    <a href="#" id="nav-settings" class="hidden" data-page="settings">设置</a>
    <a href="#" data-page="leaderboard">排行榜</a>
    <a href="#" id="nav-after-sales" class="hidden" data-page="after-sales">售后</a>
    <a href="#" id="nav-notif" class="hidden" data-page="notifications">通知 <span id="notif-badge" class="nav-badge hidden">0</span></a>
    <a href="#" id="nav-admin" class="hidden" data-page="admin">管理</a>
    <a class="btn btn-magenta btn-sm btn-link" id="nav-login" href="#" data-page="login">登录</a>
    <a class="btn btn-sm btn-link" id="nav-register" href="#" data-page="register">注册</a>
    <a class="btn btn-green btn-sm btn-link hidden" id="nav-dashboard" href="#" data-page="dashboard">控制台</a>
    <div class="avatar-wrap hidden" id="avatar-wrap">
      <div class="avatar-trigger" onclick="toggleAvatarMenu()">
        <div class="avatar-mini" id="nav-avatar-icon"><span id="nav-avatar-letter">U</span></div>
        <span class="avatar-name" id="nav-avatar-name">用户</span>
      </div>
      <div class="avatar-dropdown" id="avatar-dropdown">
        <a href="#" data-page="profile"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg> 主页</a>
        <a href="#" data-page="settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 设置</a>
        <a href="#" data-page="invite"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> 邀请</a>
        <div class="divider"></div>
        <a href="#" onclick="logout()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> 退出登录</a>
      </div>
    </div>
  </div>
</nav>

<div id="app"></div>

<script>
// ─── State ──────────────────────────────────
let TOKEN = localStorage.getItem('token') || '';
let USER = null;
const API = window.location.origin;
let notifInterval = null;
const LD = { 1:0, 2:0, 3:10, 4:20, 5:30, 6:40, 7:45, 8:50, 9:60, 10:70 };
const XP_LEVELS = [0, 0, 100, 300, 600, 1000, 1600, 2400, 3400, 4600, 6000];

// ─── SVG Icons ──────────────────────────────
function icon(n) { const s={user:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>',settings:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><circle cx="12"cy="12"r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',star:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',trophy:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',crown:'<svg width="20"height="20"viewBox="0 0 24 24"fill="none"stroke="#ffd700"stroke-width="2"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18"/></svg>',bolt:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',mail:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',clock:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><circle cx="12"cy="12"r="10"/><polyline points="12 6 12 12 16 14"/></svg>',check:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',x:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><line x1="18"y1="6"x2="6"y2="18"/><line x1="6"y1="6"x2="18"y2="18"/></svg>',dollar:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><line x1="12"y1="1"x2="12"y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',users:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9"cy="7"r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',shield:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',chevron:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',copy:'<svg width="16"height="16"viewBox="0 0 24 24"fill="none"stroke="currentColor"stroke-width="2"><rect x="9"y="9"width="13"height="13"rx="2"ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'}; return s[n]||''; }
function iconBig(n){const s={crown:'<svg width="40"height="40"viewBox="0 0 24 24"fill="none"stroke="#ffd700"stroke-width="1.5"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18"/></svg>'};return s[n]||'';}

function toast(m, t = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + t; el.textContent = m;
  c.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body && typeof body === 'object') opt.body = JSON.stringify(body);
  try { const r = await fetch(API + path, opt); return await r.json(); }
  catch (e) { return { error: '网络错误' }; }
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>'); }

function sb(s) {
  const m = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成',
    registering:'📝注册中', creating:'📝创建中', farming:'⚔️挂机中', active:'⚔️活跃', failed:'❌失败', error:'⚠️异常' };
  return '<span class="badge badge-' + s + '">' + (m[s] || s) + '</span>';
}

// ─── Nav Toggle (Mobile) ────────────────────
function toggleNav() {
  document.getElementById('nav-links').classList.toggle('open');
}
function closeNav() { document.getElementById('nav-links').classList.remove('open'); }

// ─── Page Loading ───────────────────────────
let pageLoadTimer = null;
function showLoading() {
  const el = document.getElementById('page-loading');
  if (el) { el.classList.remove('fade-out'); el.style.display = 'flex'; }
}
function hideLoading() {
  const el = document.getElementById('page-loading');
  if (el) {
    el.classList.add('fade-out');
    setTimeout(() => { el.style.display = 'none'; el.classList.remove('fade-out'); }, 400);
  }
}

// ─── Particles ──────────────────────────────
(function initParticles() {
  const el = document.getElementById('particles');
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 8 + 's';
    p.style.animationDuration = (6 + Math.random() * 6) + 's';
    p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
    p.style.background = i % 3 === 0 ? 'var(--magenta)' : i % 3 === 1 ? 'var(--cyan)' : 'var(--green)';
    el.appendChild(p);
  }
})();

// ─── Pages ──────────────────────────────────
const P = {};

P.landing = () => \`
<div class="hero animate-in">
  <h1 class="glitch">⚡ 赛博修仙 <span class="hl">自动化平台</span></h1>
  <p>艾德尔修仙传 · 专业邀请积分代练平台<br>一键提交工单 · 全自动注册 · 智能升级至120级 · 全程实时监控</p>
  <div class="btn-group">
    <a class="btn btn-magenta" href="#" onclick="showPage('register');return false">🚀 立即注册</a>
    <a class="btn" href="#" onclick="showPage('control');return false">📖 功能介绍</a>
    <a class="btn btn-green" href="#" onclick="showPage('dashboard');return false">💻 控制台</a>
  </div>
  <div class="hero-stats" id="hero-stats">
    <div class="hero-stat"><div class="num">-</div><div class="label">注册用户</div></div>
    <div class="hero-stat"><div class="num glow-m">-</div><div class="label">工单总数</div></div>
    <div class="hero-stat"><div class="num glow-g">-</div><div class="label">已完成</div></div>
    <div class="hero-stat"><div class="num">-</div><div class="label">在线账号</div></div>
  </div>
</div>

<div class="container animate-in">
  <h2 class="page-title">核心功能</h2>
  <div class="grid grid-3">
    <div class="feature-card"><h3>⚡ 自动注册</h3><p>提交工单后自动注册游戏账号，配置全满金灵根，自动装配铁剑、学习基础技能和功法。</p></div>
    <div class="feature-card"><h3>🏯 智能升级</h3><p>每日自动检测账号状态，自动点击升级/突破，直达120级后自动停止，全程无需人工干预。</p></div>
    <div class="feature-card"><h3>🤝 邀请分成</h3><p>生成专属邀请码分享给好友，好友成交后获得30%积分返还，多邀多得，上不封顶。</p></div>
    <div class="feature-card"><h3>📊 实时监控</h3><p>实时查看每个账号的等级、地图位置、技能功法、装备信息，进度一目了然。</p></div>
    <div class="feature-card"><h3>🎯 等级优惠</h3><p>成交越多等级越高，最高Lv.10享70%折扣。优惠码可与等级折扣叠加，超值实惠。</p></div>
    <div class="feature-card"><h3>🛡️ 防封保障</h3><p>每账号独立运营商IP · 随机机器码 · 浏览器指纹轮换 · 智能延迟 · 自动暂停，全方位防检测。</p></div>
  </div>

  <h2 class="page-title mt-20">价格方案</h2>
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

  <h2 class="page-title mt-20">用户等级特权</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(165px,1fr))">
    \${[1,2,3,4,5,6,7,8,9,10].map(l => \`
      <div class="card" style="text-align:center;padding:18px 12px">
        <div class="level-badge \${l >= 5 ? 'high' : ''}" style="display:inline-flex;margin-bottom:10px">Lv.\${l}</div>
        <div style="font-size:0.78em;color:var(--cyan);margin-bottom:4px">\${l===1?'基础价':l===2?'解锁邀请':LD[l]+'%优惠'}</div>
        <div style="font-size:0.7em;color:var(--text-dim)">\${[0,0,1,3,5,10,20,35,50,75,100][l]}单解锁</div>
        \${l<10 ? '<div class="progress-bar" style="margin-top:10px"><div class="fill" style="width:'+(l*10)+'%"></div></div>' : '<div class="progress-bar" style="margin-top:10px"><div class="fill" style="width:100%"></div></div>'}
      </div>
    \`).join('')}
  </div>
</div>
\`;

P.control = () => \`
<div class="container animate-in">
  <h2 class="page-title">功能介绍</h2>
  <div class="grid grid-2">
    <div class="card"><h3>📋 工单系统</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">提交购买工单，填写邀请码、支付方式和金额。管理员审核到账后自动开始处理流程。</p></div>
    <div class="card"><h3>🤖 自动化流程</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">审核通过 → GitHub Actions 扫描 → 自动注册 → 全满金灵根 → 装配铁剑/技能/功法 → 切换荒石村 → 开始刷怪 → 每日健康检测 → 自动升级到120级 → 2天后停止监控</p></div>
    <div class="card"><h3>💎 账号规格</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">✅ 全满金属性灵根<br>✅ 自动装配铁剑<br>✅ 学习重击+火球术技能<br>✅ 修炼吐纳法功法<br>✅ 自动切换荒石村刷怪<br>✅ 每日自动检测升级</p></div>
    <div class="card"><h3>🛡️ 防封策略</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">✅ 每账号独立伪造运营商IP(31段池)<br>✅ 独立机器码(6种格式轮换)<br>✅ 浏览器指纹轮换(12种UA)<br>✅ 多CDN代理头模拟<br>✅ 操作间随机延迟<br>✅ 每3-5账号智能暂停</p></div>
    <div class="card"><h3>📊 数据监控</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">实时查看账号等级、地图位置、技能装备、在线状态。到达120级后2天自动停止检测，发送完成通知。</p></div>
    <div class="card"><h3>🎯 交付标准</h3><p style="color:var(--text-dim);font-size:0.88em;line-height:1.8">等级到达120级即视为完成。完成后保留2天监控期，期间如有异常可申诉。支持售后和退款申请。</p></div>
  </div>
</div>
\`;

P.docs = () => \`
<div class="container animate-in">
  <h2 class="page-title">使用文档</h2>
  <div class="grid grid-2">
    <div class="card"><h3>📝 如何下单</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">1. 注册账号并登录<br>2. 进入控制台，点击「提交工单」<br>3. 填写需要注册的邀请码<br>4. 选择支付方式（微信/灵石）<br>5. 填写付款账号名方便核实<br>6. 可填写优惠码获得额外折扣<br>7. 提交后等待管理员审核<br>8. 审核通过后自动开始处理</p></div>
    <div class="card"><h3>💰 价格说明</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">微信支付：1 元 = 120 邀请积分<br>灵石支付：100 万灵石 = 10 邀请积分<br>每单可以要求多个账号（按积分计算）<br>最高可享70%等级折扣（Lv.10）<br>优惠码可叠加使用，折上折！</p></div>
    <div class="card"><h3>🎯 用户等级</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">每完成一单提升一级，等级越高折扣越多：<br>Lv.1 基础价 · Lv.2 解锁邀请<br>Lv.3 10% · Lv.4 20% · Lv.5 30%<br>Lv.6 40% · Lv.7 45% · Lv.8 50%<br>Lv.9 60% · Lv.10 70% 🏆</p></div>
    <div class="card"><h3>🤝 邀请分成</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">在邀请页面生成专属邀请码，分享给好友<br>好友注册时填写你的邀请码<br>好友订单审核通过后，你获得30%返利<br>邀请积分可以提现或消费<br>邀请越多，赚得越多！</p></div>
    <div class="card"><h3>⏱️ 预计时间</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">工单审核：管理员确认到账后通过（通常24h内）<br>注册时间：审核通过后开始自动注册<br>升级周期：约5天到达120级<br>完成后：到达120级后2天停止检测<br>全程进度可在「账号列表」查看</p></div>
    <div class="card"><h3>🆘 售后申诉</h3><p style="color:var(--text-dim);font-size:0.85em;line-height:1.9">如遇问题可在「申诉售后」页面提交申诉<br>包括：账号异常、超时未完成、等级不符等<br>管理员24小时内回复处理<br>必要时可联系客服机器人咨询进度</p></div>
  </div>
</div>
\`;

P.login = () => \`
<div class="container animate-in" style="max-width:420px">
  <h2 class="page-title">登录</h2>
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
<div class="container animate-in" style="max-width:420px">
  <h2 class="page-title">注册</h2>
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
      <label>邮箱 (选填)</label>
      <input id="reg-email" type="email" placeholder="用于接收通知">
    </div>
    <div class="form-group">
      <label>邀请码 (选填)</label>
      <input id="reg-invite" placeholder="填写邀请人的邀请码">
    </div>
    <div class="form-group">
      <label style="color:var(--text-dim);font-size:0.7em">⚠️ 每IP仅可注册一个账号</label>
    </div>
    <button class="btn btn-magenta btn-block" onclick="doRegister()">注册</button>
    <p class="mt-20 text-center" style="color:var(--text-dim);font-size:0.82em">已有账号？<a href="#" onclick="showPage('login');return false">登录</a></p>
  </div>
</div>
\`;

P.dashboard = () => \`
<div class="container animate-in">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">控制台</h2>
    <div class="flex gap-10 flex-wrap">
      <button class="btn btn-magenta btn-sm" onclick="showNewOrder()">+ 提交工单</button>
      <button class="btn btn-yellow btn-sm" onclick="showPage('invite')">🤝 邀请</button>
      <button class="btn btn-green btn-sm" onclick="showPage('accounts')">📊 账号</button>
      <button class="btn btn-sm" onclick="showPage('appeals')">📮 申诉</button>
    </div>
  </div>

  <div class="grid grid-4" id="dash-stats">
    <div class="card"><h3>👤 <span id="d-username">用户</span></h3><div class="stat"><span class="label">等级</span><span class="value" id="d-level">-</span></div><div class="stat"><span class="label">工单数</span><span class="value" id="d-orders">-</span></div><div class="stat"><span class="label">邮箱</span><span class="value" id="d-email" style="font-size:0.82em;color:var(--text-dim)">未设置</span></div></div>
    <div class="card"><h3>💳 财务</h3><div class="stat"><span class="label">总消费</span><span class="value" id="d-spent">¥0</span></div><div class="stat"><span class="label">邀请积分</span><span class="value" id="d-points">0</span></div></div>
    <div class="card"><h3>🤝 邀请</h3><div class="stat"><span class="label">邀请码</span><span class="value" id="d-invite" style="font-size:0.82em">-</span></div><div class="stat"><span class="label">已邀请</span><span class="value" id="d-invited">0</span></div></div>
    <div class="card"><h3>🏆 优惠</h3><div class="stat"><span class="label">当前等级</span><span class="value" id="d-level2">-</span></div><div class="stat"><span class="label">折扣</span><span class="value" id="d-discount" style="color:var(--green)">0%</span></div></div>
  </div>

  <div class="grid grid-2 mt-20" style="grid-template-columns:1.2fr 0.8fr">
    <div class="card" style="overflow:hidden">
      <h3>📋 我的工单 <span class="sub" style="font-size:0.72em">点击行查看详情</span></h3>
      <div class="flex gap-10 mb-10 flex-wrap">
        <input id="dash-order-search" placeholder="🔍 搜邀请码/ID..." style="flex:1;min-width:140px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px;font-size:0.85em" oninput="filterDashOrders()">
        <select id="dash-order-status-filter" style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px;font-size:0.85em" onchange="filterDashOrders()">
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="completed">已完成</option>
          <option value="rejected">已拒绝</option>
        </select>
      </div>
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
<div class="container animate-in">
  <h2 class="page-title">管理后台 <span class="sub">管理员</span></h2>
  <div class="tabs">
    <div class="tab active" onclick="switchTab(this,'ap-orders')">📋 工单</div>
    <div class="tab" onclick="switchTab(this,'ap-accounts')">🎮 账号</div>
    <div class="tab" onclick="switchTab(this,'ap-users')">👥 用户</div>
    <div class="tab" onclick="switchTab(this,'ap-appeals')">📮 申诉</div>
    <div class="tab" onclick="switchTab(this,'ap-coupons')">🎫 优惠券</div>
    <div class="tab" onclick="switchTab(this,'ap-announce')">📢 公告</div>
    <div class="tab" onclick="switchTab(this,'ap-ads')">🖼️ 广告</div>
    <div class="tab" onclick="switchTab(this,'ap-config')">⚙️ 配置</div>
  </div>

  <div class="tab-content active" id="ap-orders">
    <div class="flex-between mb-10 flex-wrap" style="gap:8px">
      <h3 style="color:var(--cyan);font-size:0.85em;text-transform:uppercase;letter-spacing:2px">工单管理</h3>
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
    <div class="card"><h3>游戏账号</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户</th><th>账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查</th></tr></thead><tbody id="admin-accounts-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-users">
    <div class="card"><h3>用户列表</h3><div class="table-wrap"><table><thead><tr><th>ID</th><th>用户名</th><th>等级</th><th>工单</th><th>消费</th><th>邀请</th><th>邀请码</th><th>状态</th><th>管理</th><th>注册</th><th>操作</th></tr></thead><tbody id="admin-users-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-appeals">
    <div class="card"><h3>申诉管理</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>用户</th><th>标题</th><th>类型</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="admin-appeals-table"></tbody></table></div></div>
  </div>
  <div class="tab-content" id="ap-coupons">
    <div class="card">
      <h3>🎫 优惠券管理</h3>
      <div class="flex gap-10 mb-10 flex-wrap" style="border:1px solid var(--border);padding:16px;border-radius:8px">
        <input id="cp-code" placeholder="优惠码（自动大写）" style="flex:1;min-width:90px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <input id="cp-discount" type="number" placeholder="折扣 %" style="width:80px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <input id="cp-max" type="number" placeholder="最大使用" style="width:90px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <input id="cp-expires" type="date" style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <input id="cp-desc" placeholder="描述" style="flex:1;min-width:90px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <button class="btn btn-green btn-sm" onclick="adminCreateCoupon()">创建</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>优惠码</th><th>折扣</th><th>使用数</th><th>上限</th><th>过期</th><th>描述</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="admin-coupons-table"></tbody></table></div>
    </div>
  </div>
  <div class="tab-content" id="ap-announce">
    <div class="card">
      <h3>📢 公告管理</h3>
      <div class="flex gap-10 mb-10 flex-wrap" style="border:1px solid var(--border);padding:16px;border-radius:8px">
        <textarea id="ann-content" rows="3" placeholder="输入公告内容..." style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px;font-size:0.85em"></textarea>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap"><label style="font-size:0.82em;color:var(--text-dim)"><input type="checkbox" id="ann-enabled" checked> 启用</label><button class="btn btn-green btn-sm" onclick="adminCreateAnnouncement()">发布</button></div>
      </div>
      <div id="admin-announce-list"><p style="color:var(--text-dim);font-size:0.85em">加载中...</p></div>
    </div>
  </div>
  <div class="tab-content" id="ap-ads">
    <div class="card">
      <h3>🖼️ 广告管理</h3>
      <div class="flex gap-10 mb-10 flex-wrap" style="border:1px solid var(--border);padding:16px;border-radius:8px">
        <select id="ad-type" style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px"><option value="popup">弹窗广告</option><option value="sidebar">侧栏广告</option></select>
        <input id="ad-img" placeholder="图片URL" style="flex:1;min-width:140px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <input id="ad-link" placeholder="链接URL" style="flex:1;min-width:100px;padding:6px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:6px">
        <label style="font-size:0.82em;color:var(--text-dim);display:flex;align-items:center"><input type="checkbox" id="ad-enabled"> 启用</label>
        <button class="btn btn-green btn-sm" onclick="adminCreateAd()">添加</button>
      </div>
      <div id="admin-ads-list"><p style="color:var(--text-dim);font-size:0.85em">加载中...</p></div>
    </div>
  </div>
  <div class="tab-content" id="ap-config">
    <div class="card"><h3>系统配置</h3><div id="admin-config"></div></div>
  </div>
</div>
\`;

P.settings = () => \`
<div class="container animate-in" style="max-width:560px">
  <h2 class="page-title">用户设置</h2>
  <div class="card">
    <h3>🔑 修改密码</h3>
    <div class="form-group"><label>旧密码</label><input type="password" id="set-old-pass" placeholder="输入旧密码"></div>
    <div class="form-group"><label>新密码</label><input type="password" id="set-new-pass" placeholder="输入新密码（至少6位）"></div>
    <button class="btn btn-green" onclick="changePassword()">更新密码</button>
  </div>
  <div class="card">
    <h3>📧 绑定邮箱</h3>
    <div class="form-group"><label>邮箱地址</label><input type="email" id="set-email" placeholder="your@email.com"></div>
    <button class="btn btn-green" onclick="updateProfile()">保存邮箱</button>
  </div>
</div>
\`;

P.invite = () => \`
<div class="container animate-in" style="max-width:640px">
  <h2 class="page-title">邀请系统</h2>
  <div class="grid grid-2">
    <div class="card">
      <h3>🤝 我的邀请码</h3>
      <div class="stat"><span class="label">邀请码</span><span class="value" id="inv-code" style="font-size:1.2em;color:var(--magenta);letter-spacing:3px">-</span></div>
      <div class="stat"><span class="label">已邀请人数</span><span class="value" id="inv-count">0</span></div>
      <div class="stat"><span class="label">成交返利</span><span class="value" id="inv-orders">0</span></div>
      <div class="stat"><span class="label">累计收益</span><span class="value" id="inv-earnings" style="color:var(--green)">¥0</span></div>
      <div class="stat"><span class="label">可提现积分</span><span class="value" id="inv-points">0</span></div>
      <div class="stat"><span class="label">分成比例</span><span class="value" style="color:var(--green)">30%</span></div>
      <div class="flex gap-10 mt-10">
        <button class="btn btn-sm" onclick="copyInvite()">📋 复制链接</button>
        <button class="btn btn-green btn-sm" onclick="withdrawInvite()">💳 提现</button>
      </div>
    </div>
    <div class="card">
      <h3>📖 邀请说明</h3>
      <p style="color:var(--text-dim);font-size:0.85em;line-height:2">1️⃣ 你的专属邀请码可以在下方复制<br>2️⃣ 分享给好友，好友注册时填写<br>3️⃣ 好友工单审核通过后你获得返利<br>4️⃣ 返利 = 订单金额 × 30% 邀请积分<br>5️⃣ 邀请积分可以提现或用于消费<br>6️⃣ 多邀多得，上不封顶！</p>
    </div>
  </div>
</div>
\`;

P.accounts = () => \`
<div class="container animate-in">
  <h2 class="page-title">账号列表</h2>
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
<div class="container animate-in" style="max-width:700px">
  <h2 class="page-title">通知中心</h2>
  <div id="notif-list"></div>
</div>
\`;

P.appeals = () => \`
<div class="container animate-in" style="max-width:700px">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">申诉售后</h2>
    <button class="btn btn-magenta btn-sm" onclick="showAppealForm()">+ 提交申诉</button>
  </div>
  <div id="appeal-list"></div>
</div>
\`;

P['after-sales'] = () => \`
<div class="container animate-in" style="max-width:700px">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">售后工单</h2>
    <button class="btn btn-magenta btn-sm" onclick="showAfterSalesForm()">+ 提交售后</button>
  </div>
  <div id="after-sales-list"><p class="text-center" style="color:var(--text-dim);padding:30px">加载中...</p></div>
</div>
\`;

P.leaderboard = () => \`
<div class="container animate-in" style="max-width:700px">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">排行榜</h2>
    <div class="flex gap-10 flex-wrap">
      <button class="btn btn-sm" onclick="loadLeaderboard('purchase')">购买榜</button>
      <button class="btn btn-yellow btn-sm" onclick="loadLeaderboard('invite')">邀请榜</button>
      <button class="btn btn-purple btn-sm" onclick="loadLeaderboard('level')">等级榜</button>
    </div>
  </div>
  <div id="lb-champion"></div>
  <div id="lb-list"><p class="text-center" style="color:var(--text-dim);padding:30px">加载中...</p></div>
</div>
\`;

P.profile = () => \`
<div class="container animate-in" style="max-width:640px">
  <div class="flex-between flex-wrap mb-20" style="gap:12px">
    <h2 class="page-title" style="margin-bottom:0">个人主页</h2>
    <button class="btn btn-sm" onclick="showPage('dashboard')">← 返回</button>
  </div>
  <div id="profile-content"><p class="text-center" style="color:var(--text-dim);padding:30px">加载中...</p></div>
</div>
\`;

// ─── Router ────────────────────────────────
function showPage(name) {
  closeNav();
  const app = document.getElementById('app');
  if (P[name]) {
    showLoading();
    app.innerHTML = P[name]();
    window.scrollTo(0, 0);
    setTimeout(hideLoading, 100);
    if (name === 'landing') loadStats();
    if (name === 'dashboard' && TOKEN) refreshDashboard();
    if (name === 'admin' && TOKEN) refreshAdmin();
    if (name === 'invite' && TOKEN) refreshInvite();
    if (name === 'accounts' && TOKEN) refreshAccounts();
    if (name === 'notifications' && TOKEN) refreshNotifs();
    if (name === 'appeals' && TOKEN) refreshAppeals();
    if (name === 'leaderboard') loadLeaderboard('purchase');
    if (name === 'after-sales' && TOKEN) loadAfterSales();
    if (name === 'profile' && TOKEN) loadProfile();
    if (name === 'settings' && TOKEN) { /* settings loaded from P.settings template */ }
  }
}

document.querySelectorAll('[data-page]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); showPage(a.dataset.page); });
});

// ─── Auth ───────────────────────────────────
function updateNav(loggedIn, isAdmin) {
  document.getElementById('nav-login').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-register').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-dashboard').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-logout').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-invite').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-settings').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-after-sales').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-notif').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-admin').classList.toggle('hidden', !(loggedIn && isAdmin));
  document.getElementById('avatar-wrap').classList.toggle('hidden', !loggedIn);
}

function updateAvatarUI() {
  const letter = document.getElementById('nav-avatar-letter');
  const name = document.getElementById('nav-avatar-name');
  if (letter) letter.textContent = (USER?.display_name || USER?.username || 'U')[0].toUpperCase();
  if (name) name.textContent = USER?.display_name || USER?.username || '用户';
}

async function checkAuth() {
  if (!TOKEN) { updateNav(false); return; }
  const r = await api('GET', '/api/user/info');
  if (r.ok && r.user) {
    USER = r.user;
    updateNav(true, r.user.is_admin);
    updateAvatarUI();
    loadAnnouncement();
    loadAds();
    if (document.getElementById('app').innerHTML === '') showPage('dashboard');
    startNotifPoll();
  } else {
    TOKEN = ''; USER = null;
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
    TOKEN = r.token; USER = r.user;
    localStorage.setItem('token', TOKEN);
    toast('登录成功', 'success');
    showPage('dashboard');
  } else toast(r.error || '登录失败', 'error');
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
  if (r.ok) { toast('注册成功，请登录', 'success'); showPage('login'); }
  else toast(r.error || '注册失败', 'error');
}

function logout() {
  TOKEN = ''; USER = null;
  localStorage.removeItem('token');
  if (notifInterval) clearInterval(notifInterval);
  showPage('landing'); updateNav(false);
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
    b.textContent = r.unread; b.classList.remove('hidden');
  } else document.getElementById('notif-badge').classList.add('hidden');
}

async function refreshNotifs() {
  const r = await api('GET', '/api/notifications');
  if (!r.ok) return;
  const list = document.getElementById('notif-list');
  if (!r.notifications || !r.notifications.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🔔</div><p>暂无通知</p></div>'; return;
  }
  list.innerHTML = r.notifications.map(n => \`
    <div class="card" style="\${n.is_read ? '' : 'border-color:rgba(0,240,255,0.25)'}">
      <div class="flex-between">
        <strong style="color:var(--cyan)">\${esc(n.title)}</strong>
        <span style="font-size:0.75em;color:var(--text-dim)">\${n.created_at}</span>
      </div>
      <p style="color:var(--text-dim);font-size:0.85em;margin-top:6px">\${esc(n.content)}</p>
      \${!n.is_read ? '<button class="btn btn-sm mt-10" onclick="markNotifRead('+n.id+')">标为已读</button>' : ''}
    </div>
  \`).join('');
  if (r.unread > 0) api('POST', '/api/notifications/read', {});
}
async function markNotifRead(id) { await api('POST', '/api/notifications/read', { id }); refreshNotifs(); }

// ─── Dashboard ──────────────────────────────
let DASH_ORDERS = [];

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
    document.getElementById('d-discount').textContent = (LD[u.level] || 0) + '%';
    document.getElementById('d-username').textContent = esc(u.username) || '用户';
    document.getElementById('d-email').textContent = u.email || '未设置';
  }
  const inviteInfo = await api('GET', '/api/invite/info');
  if (inviteInfo.ok) document.getElementById('d-invited').textContent = inviteInfo.total_invited || 0;

  const orders = await api('GET', '/api/orders');
  if (orders.ok && orders.orders) {
    DASH_ORDERS = orders.orders;
    filterDashOrders();
  }
}

function filterDashOrders() {
  const tb = document.getElementById('dash-orders');
  if (!tb) return;
  const q = (document.getElementById('dash-order-search')?.value || '').toLowerCase();
  const st = document.getElementById('dash-order-status-filter')?.value || '';
  let filtered = DASH_ORDERS;
  if (q) filtered = filtered.filter(o => String(o.id).includes(q) || (o.invite_code||'').toLowerCase().includes(q));
  if (st) filtered = filtered.filter(o => o.status === st);
  if (!filtered.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-dim);padding:30px">没有匹配工单</td></tr>'; return; }
  const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
  tb.innerHTML = filtered.map(o => \`
    <tr style="cursor:pointer" onclick="showOrderDetail(\${o.id})">
      <td>#\${o.id}</td>
      <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis">\${esc(o.invite_code)}</td>
      <td>¥\${o.price.toFixed(1)}</td>
      <td><span class="badge badge-\${o.status}">\${s[o.status]||o.status}</span></td>
      <td style="font-size:0.78em">\${o.account_count||0} 账号</td>
      <td style="font-size:0.78em;color:var(--text-dim)">\${o.created_at?.split(' ')[0]||''}</td>
    </tr>
  \`).join('');
}

// ─── Order Detail ───────────────────────────
async function showOrderDetail(id) {
  if (!TOKEN) return toast('请先登录', 'error');
  const r = await api('GET', '/api/orders/' + id);
  if (!r.ok) return toast(r.error, 'error');
  const o = r.order; const accounts = r.accounts || [];
  const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container animate-in" style="max-width:800px">
    <div class="flex-between mb-20 flex-wrap" style="gap:12px">
      <h2 class="page-title" style="margin-bottom:0">工单 #\${o.id}</h2>
      <button class="btn btn-sm" onclick="showPage('dashboard')">← 返回</button>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>📋 基本信息</h3>
        <div class="stat"><span class="label">邀请码</span><span class="value">\${esc(o.invite_code)}</span></div>
        <div class="stat"><span class="label">支付方式</span><span class="value">\${o.payment_method === 'wechat' ? '微信支付' : '灵石'}</span></div>
        <div class="stat"><span class="label">金额</span><span class="value">¥\${o.price.toFixed(2)}</span></div>
        <div class="stat"><span class="label">邀请积分</span><span class="value">\${o.bonus_points}</span></div>
        <div class="stat"><span class="label">优惠折扣</span><span class="value" style="color:var(--green)">\${o.discount}%</span></div>
        <div class="stat"><span class="label">状态</span><span class="value">\${s[o.status]||o.status}</span></div>
      </div>
      <div class="card">
        <h3>📅 时间信息</h3>
        <div class="stat"><span class="label">创建</span><span class="value" style="font-size:0.85em">\${o.created_at || '-'}</span></div>
        <div class="stat"><span class="label">更新</span><span class="value" style="font-size:0.85em">\${o.updated_at || '-'}</span></div>
        <div class="stat"><span class="label">预计完成</span><span class="value" style="color:var(--yellow)">\${o.est_complete_date || '审核中'}</span></div>
        <div class="stat"><span class="label">实际完成</span><span class="value">\${o.completed_at || '-'}</span></div>
        \${o.admin_notes ? '<div class="stat"><span class="label">备注</span><span class="value">' + esc(o.admin_notes) + '</span></div>' : ''}
      </div>
    </div>
    <div class="card mt-20">
      <h3>📜 操作记录</h3>
      <div class="timeline" id="order-timeline-\${o.id}"><p style="color:var(--text-dim);font-size:0.85em">加载中...</p></div>
    </div>

    <div class="card mt-20">
      <h3>🎮 账号列表 (\${accounts.length})</h3>
      \${accounts.length === 0 ? '<p style="color:var(--text-dim);font-size:0.88em">暂无账号数据</p>' : \`
      <div class="table-wrap"><table>
        <thead><tr><th>账号</th><th>等级</th><th>地图</th><th>状态</th><th>技能</th><th>功法</th><th>装备</th><th>检查</th></tr></thead>
        <tbody>\${accounts.map(a => \`<tr>
          <td>\${esc(a.server_username || a.username)}</td>
          <td><strong>\${a.level || 0}</strong></td>
          <td>\${esc(a.map_name || '-')}</td>
          <td>\${sb(a.status)}</td>
          <td style="font-size:0.78em">\${fl(a.skills)}</td>
          <td style="font-size:0.78em">\${fl(a.techniques)}</td>
          <td style="font-size:0.78em">\${fl(a.equipment)}</td>
          <td style="font-size:0.78em;color:var(--text-dim)">\${a.last_check_at || '-'}</td>
        </tr>\`).join('')}</tbody></table></div>\`}
    </div>
  </div>\`;
  loadOrderActivities(id);
  }

  function fl(j) { try { return JSON.parse(j||'[]').map(x => x.name||x).join(', ') || '-'; } catch(e) { return j||'-'; } }

// ─── Order Activities ──────────────────────
async function loadOrderActivities(orderId) {
  const el = document.getElementById('order-timeline-' + orderId);
  if (!el) return;
  const r = await api('GET', '/api/orders/' + orderId + '/activities');
  if (!r.ok || !r.activities || !r.activities.length) {
    el.innerHTML = '<p style="color:var(--text-dim);font-size:0.85em">暂无操作记录</p>'; return;
  }
  const ac = { created:'创建工单', approved:'审核通过', rejected:'已拒绝', completed:'已完成', account_created:'创建账号', commission:'分成到账' };
  el.innerHTML = r.activities.map(a => \`
    <div class="tl-item tl-\${a.action}">
      <div class="tl-time">\${a.created_at}</div>
      <div class="tl-action">\${ac[a.action] || a.action}</div>
      \${a.detail ? '<div class="tl-detail">' + esc(a.detail) + '</div>' : ''}
    </div>
  \`).join('');
}

// ─── Settings ──────────────────────────────
async function changePassword() {
  const oldP = document.getElementById('set-old-pass')?.value;
  const newP = document.getElementById('set-new-pass')?.value;
  if (!oldP || !newP) return toast('请填写完整', 'error');
  if (newP.length < 6) return toast('新密码至少6位', 'error');
  const r = await api('POST', '/api/user/change-password', { old_password: oldP, new_password: newP });
  if (r.ok) { toast('密码修改成功', 'success'); document.getElementById('set-old-pass').value = ''; document.getElementById('set-new-pass').value = ''; }
  else toast(r.error, 'error');
}
async function updateProfile() {
  const email = document.getElementById('set-email')?.value;
  if (!email) return toast('请填写邮箱', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('邮箱格式不正确', 'error');
  const r = await api('PUT', '/api/user/profile', { email });
  if (r.ok) toast('邮箱已更新', 'success');
  else toast(r.error, 'error');
}

// ─── New Order ──────────────────────────────
function showNewOrder() {
  if (!TOKEN) return toast('请先登录', 'error');
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container animate-in" style="max-width:540px">
    <div class="flex-between mb-20">
      <h2 class="page-title" style="margin-bottom:0">提交工单</h2>
      <button class="btn btn-sm" onclick="showPage('dashboard')">← 返回</button>
    </div>
    <div class="card">
      <div class="form-group">
        <label>邀请码 <span style="color:var(--text-dim);font-weight:normal;font-size:0.75em">（需要注册的邀请码）</span></label>
        <input id="o-invite" placeholder="输入邀请码">
      </div>
      <div class="form-row">
        <div class="form-group"><label>支付方式</label><select id="o-pay" onchange="calcPrice()"><option value="wechat">微信支付</option><option value="spirit_stone">灵石</option></select></div>
        <div class="form-group"><label>金额</label><input id="o-amount" type="number" min="1" placeholder="金额" oninput="calcPrice()"></div>
      </div>
      <div id="o-price-show" class="mb-10" style="color:var(--cyan);font-size:0.9em"></div>
      <div class="form-group"><label>付款账号名</label><input id="o-pay-account" placeholder="微信昵称或游戏ID，用于核对"></div>
      <div class="form-row">
        <div class="form-group"><label>绑定角色名 (选填)</label><input id="o-bind-name" placeholder="游戏角色名称"></div>
        <div class="form-group"><label>绑定邀请码 (选填)</label><input id="o-bind-code" placeholder="该账号使用的邀请码"></div>
      </div>
      <div class="form-group">
        <label>优惠码 (选填)</label>
        <div class="flex gap-10">
          <input id="o-coupon" placeholder="输入优惠码" style="flex:1" onblur="validateCoupon()">
          <button class="btn btn-green btn-sm" onclick="validateCoupon()">验证</button>
        </div>
        <div id="o-coupon-res" style="font-size:0.82em;margin-top:4px"></div>
      </div>
      <div class="form-group"><label>需要账号数</label><input id="o-acc-count" type="number" min="1" max="20" value="1"><span style="font-size:0.72em;color:var(--text-dim)">每个账号120积分</span></div>
      <button class="btn btn-magenta btn-block" onclick="submitOrder()">提交工单</button>
    </div>
  </div>\`;
}

async function calcPrice() {
  const amt = parseFloat(document.getElementById('o-amount').value) || 0;
  const m = document.getElementById('o-pay').value;
  document.getElementById('o-price-show').textContent = m === 'wechat' ? '≈ ' + (amt * 120) + ' 邀请积分' : '≈ ' + (amt * 10) + ' 邀请积分（' + (amt * 100).toLocaleString() + ' 万灵石）';
}

let validatedDiscount = 0;
async function validateCoupon() {
  const code = document.getElementById('o-coupon')?.value;
  const res = document.getElementById('o-coupon-res');
  if (!code || !res) { validatedDiscount = 0; return; }
  const r = await api('POST', '/api/coupon/validate', { code });
  if (r.ok) { validatedDiscount = r.discount_percent; res.innerHTML = '✅ 优惠码有效，享 <strong>' + r.discount_percent + '%</strong> 折扣'; res.style.color = 'var(--green)'; }
  else { validatedDiscount = 0; res.innerHTML = '❌ ' + (r.error || '无效'); res.style.color = 'var(--red)'; }
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
  const r = await api('POST', '/api/orders', { invite_code, payment_method, amount, payment_account, coupon_code, bind_account_name, bind_invite_code, game_account_count });
  if (r.ok) { toast('工单已提交，等待管理员审核！', 'success'); showPage('dashboard'); }
  else toast(r.error || '提交失败', 'error');
}

// ─── Admin ──────────────────────────────────
async function refreshAdmin() { await Promise.all([adminLoadOrders('pending'), adminLoadAccounts(), adminLoadUsers(), adminLoadAppeals(), adminLoadConfig(), adminLoadCoupons(), adminLoadAnnouncements(), adminLoadAds()]); }

async function adminLoadOrders(status) {
  const p = status ? '/api/admin/orders?status=' + status : '/api/admin/orders';
  const r = await api('GET', p);
  if (!r.ok) return;
  const tb = document.getElementById('admin-orders-table');
  if (!tb) return;
  if (!r.orders || !r.orders.length) { tb.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-dim);padding:30px">暂无工单</td></tr>'; return; }
  const s = { pending:'⏳审核中', approved:'✅已通过', rejected:'❌已拒绝', completed:'🎉已完成' };
  tb.innerHTML = r.orders.map(o => \`<tr>
    <td>#\${o.id}</td><td>\${esc(o.user_name)}</td>
    <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis">\${esc(o.invite_code)}</td>
    <td>\${o.payment_method === 'wechat' ? '微信' : '灵石'}</td>
    <td>¥\${o.price.toFixed(1)}</td><td>\${o.bonus_points}</td>
    <td><span class="badge badge-\${o.status}">\${s[o.status]||o.status}</span></td>
    <td style="font-size:0.78em;color:var(--text-dim)">\${o.created_at?.split(' ')[0]||''}</td>
    <td><div class="flex gap-10" style="gap:4px">
      \${o.status === 'pending' ? \`<button class="btn btn-green btn-sm" style="padding:3px 10px;font-size:0.72em" onclick="adminApprove(\${o.id})">通过</button><button class="btn btn-red btn-sm" style="padding:3px 10px;font-size:0.72em" onclick="adminReject(\${o.id})">拒绝</button>\` : ''}
      <button class="btn btn-sm" style="padding:3px 10px;font-size:0.72em" onclick="showOrderDetail(\${o.id})">详情</button>
    </div></td>
  </tr>\`).join('');
}
async function adminApprove(id) { if (!confirm('确认通过工单 #' + id + '？')) return; const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'approved' }); if (r.ok) { toast('已通过', 'success'); adminLoadOrders('pending'); } else toast(r.error, 'error'); }
async function adminReject(id) { const notes = prompt('拒绝原因：'); if (!notes) return; const r = await api('POST', '/api/admin/orders/' + id + '/status', { status: 'rejected', admin_notes: notes }); if (r.ok) { toast('已拒绝', 'info'); adminLoadOrders('pending'); } else toast(r.error, 'error'); }

async function adminLoadAccounts() {
  const r = await api('GET', '/api/admin/accounts');
  if (!r.ok) return;
  const tb = document.getElementById('admin-accounts-table');
  if (!tb) return;
  tb.innerHTML = (r.accounts||[]).length ? r.accounts.map(a => \`<tr>
    <td>\${a.id}</td><td>\${esc(a.user_name||'')}</td>
    <td>\${esc(a.server_username||a.username)}</td>
    <td><strong>\${a.level || 0}</strong></td>
    <td>\${esc(a.map_name||'-')}</td>
    <td>\${sb(a.status)}</td>
    <td style="font-size:0.76em">\${fl(a.skills)}</td>
    <td style="font-size:0.76em">\${fl(a.techniques)}</td>
    <td style="font-size:0.76em">\${fl(a.equipment)}</td>
    <td style="font-size:0.76em;color:var(--text-dim)">\${a.last_check_at||'-'}</td>
  </tr>\`).join('') : '<tr><td colspan="10" class="text-center" style="color:var(--text-dim);padding:30px">暂无账号</td></tr>';
}

async function adminLoadUsers() {
  const r = await api('GET', '/api/admin/users');
  if (!r.ok) return;
  const tb = document.getElementById('admin-users-table');
  if (!tb) return;
  tb.innerHTML = (r.users||[]).map(u => \`<tr>
    <td>\${u.id}</td>
    <td>\${esc(u.username)}<br><span style="font-size:0.72em;color:var(--text-dim)">\${esc(u.display_name||'')}</span></td>
    <td><span class="level-badge">Lv.\${u.level}</span><br><span style="font-size:0.7em;color:var(--text-dim)">\${u.xp||0}XP</span></td>
    <td>\${u.total_orders}</td><td>¥\${(u.total_spent||0).toFixed(1)}</td>
    <td>\${u.total_invited||0}</td>
    <td style="font-size:0.76em">\${u.invite_code||'-'}</td>
    <td>\${u.locked ? icon('x')+'封禁': icon('check')}</td>
    <td>\${u.is_admin ? icon('shield') : ''}</td>
    <td style="font-size:0.76em">\${u.created_at?.split(' ')[0]||'-'}</td>
    <td>
      <button class="btn btn-sm" style="padding:2px 8px;font-size:0.68em" onclick="adminResetPass(\${u.id})">密码</button>
      <button class="btn btn-sm" style="padding:2px 8px;font-size:0.68em" onclick="adminSetLevel(\${u.id})">等级</button>
      <button class="btn btn-sm" style="padding:2px 8px;font-size:0.68em" onclick="adminToggleAdmin(\${u.id})">\${u.is_admin?'取消':'设为'}</button>
      <button class="btn btn-sm" style="padding:2px 8px;font-size:0.68em" onclick="adminToggleLock(\${u.id},\${u.locked})">\${u.locked?'解封':'封禁'}</button>
      <button class="btn btn-red btn-sm" style="padding:2px 8px;font-size:0.68em" onclick="adminDeleteUser(\${u.id})">删除</button>
    </td>
  </tr>\`).join('');
}

async function adminLoadAppeals() {
  const r = await api('GET', '/api/admin/appeals');
  if (!r.ok) return;
  const tb = document.getElementById('admin-appeals-table');
  if (!tb) return;
  tb.innerHTML = (r.appeals||[]).length ? r.appeals.map(a => \`<tr>
    <td>#\${a.id}</td><td>\${esc(a.user_name)}</td>
    <td>\${esc(a.title)}</td><td>\${a.type}</td>
    <td>\${sb(a.status)}</td>
    <td style="font-size:0.76em">\${a.created_at?.split(' ')[0]||''}</td>
    <td><button class="btn btn-sm" style="padding:3px 10px;font-size:0.72em" onclick="adminReplyAppeal(\${a.id})">回复</button></td>
  </tr>\`).join('') : '<tr><td colspan="7" class="text-center" style="color:var(--text-dim);padding:30px">暂无申诉</td></tr>';
}
async function adminReplyAppeal(id) { const reply = prompt('回复内容：'); if (!reply) return; await api('POST', '/api/admin/appeals/' + id + '/reply', { reply, status: 'resolved' }); toast('已回复', 'success'); adminLoadAppeals(); }

async function adminLoadConfig() {
  const el = document.getElementById('admin-config'); if (!el) return;
  const r = await api('GET', '/api/admin/config');
  if (!r.ok || !r.config) return;
  el.innerHTML = '<div class="grid grid-2">' + r.config.map(c => \`
    <div class="form-group"><label>\${esc(c.key)}</label><div class="flex gap-10"><input id="cfg-\${c.key}" value="\${esc(c.value)}" style="flex:1"><button class="btn btn-green btn-sm" onclick="adminSaveConfig('\${c.key}')">保存</button></div></div>
  \`).join('') + '</div>';
}
async function adminSaveConfig(key) { const val = document.getElementById('cfg-' + key)?.value; if (!val) return; await api('POST', '/api/admin/config', { key, value: val }); toast('配置已更新', 'success'); }

// ─── Coupon Admin ──────────────────────────
async function adminLoadCoupons() {
  const tb = document.getElementById('admin-coupons-table');
  if (!tb) return;
  const r = await api('GET', '/api/admin/coupons');
  if (!r.ok || !r.coupons) { tb.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--text-dim);padding:20px">暂无优惠券</td></tr>'; return; }
  tb.innerHTML = r.coupons.map(c => \`
    <tr>
      <td>#\${c.id}</td>
      <td style="color:var(--magenta);font-weight:700;letter-spacing:2px">\${esc(c.code)}</td>
      <td style="color:var(--green)">\${c.discount_percent}%</td>
      <td>\${c.used_count||0}</td>
      <td>\${c.max_uses||'∞'}</td>
      <td style="font-size:0.82em">\${c.expires_at || '永久'}</td>
      <td style="font-size:0.82em;max-width:180px;overflow:hidden;text-overflow:ellipsis">\${esc(c.description||'-')}</td>
      <td style="font-size:0.82em">\${c.created_at}</td>
      <td><button class="btn btn-red btn-sm" style="padding:3px 10px;font-size:0.72em" onclick="adminDeleteCoupon(\${c.id})">删除</button></td>
    </tr>
  \`).join('');
}
async function adminCreateCoupon() {
  const code = document.getElementById('cp-code')?.value;
  const discount = parseInt(document.getElementById('cp-discount')?.value);
  const max_uses = parseInt(document.getElementById('cp-max')?.value) || 0;
  const expires_at = document.getElementById('cp-expires')?.value || null;
  const description = document.getElementById('cp-desc')?.value || '';
  if (!code || !discount) return toast('请填写优惠码和折扣', 'error');
  const r = await api('POST', '/api/admin/coupons', { code, discount_percent: discount, max_uses, expires_at, description });
  if (r.ok) { toast('优惠券已创建', 'success'); document.getElementById('cp-code').value = ''; document.getElementById('cp-discount').value = ''; document.getElementById('cp-max').value = ''; document.getElementById('cp-expires').value = ''; document.getElementById('cp-desc').value = ''; adminLoadCoupons(); }
  else toast(r.error, 'error');
}
async function adminDeleteCoupon(id) {
  if (!confirm('确认删除此优惠券？')) return;
  const r = await api('DELETE', '/api/admin/coupons/' + id);
  if (r.ok) { toast('已删除', 'success'); adminLoadCoupons(); }
  else toast(r.error, 'error');
}

// ─── Admin: User Management ────────────────
async function adminResetPass(id) {
  const pwd = prompt('输入新密码（至少6位）：');
  if (!pwd || pwd.length < 6) return toast('密码至少6位', 'error');
  const r = await api('POST', '/api/admin/users/' + id + '/reset-password', { new_password: pwd });
  if (r.ok) toast('密码已重置', 'success');
  else toast(r.error, 'error');
}
async function adminSetLevel(id) {
  const lv = parseInt(prompt('输入新等级（1-10）：'));
  if (!lv || lv < 1 || lv > 10) return toast('等级需在1-10之间', 'error');
  const r = await api('POST', '/api/admin/users/' + id + '/level', { level: lv });
  if (r.ok) { toast('等级已更新', 'success'); adminLoadUsers(); }
  else toast(r.error, 'error');
}
async function adminToggleAdmin(id) {
  const confirmMsg = '确认切换此用户的管理员权限？';
  if (!confirm(confirmMsg)) return;
  const r = await api('POST', '/api/admin/users/' + id + '/admin', { is_admin: true });
  if (r.ok) { toast('权限已更新', 'success'); adminLoadUsers(); }
  else toast(r.error, 'error');
}
async function adminToggleLock(id, locked) {
  if (!confirm(locked ? '确认解封此用户？' : '确认封禁此用户？')) return;
  const r = await api('POST', '/api/admin/users/' + id + '/lock', { locked: !locked });
  if (r.ok) { toast(locked ? '已解封' : '已封禁', 'success'); adminLoadUsers(); }
  else toast(r.error, 'error');
}
async function adminDeleteUser(id) {
  if (!confirm('⚠️ 确认永久删除此用户？此操作不可恢复！')) return;
  if (!confirm('再次确认：删除用户 #' + id + '？')) return;
  const r = await api('DELETE', '/api/admin/users/' + id + '/delete');
  if (r.ok) { toast('用户已删除', 'success'); adminLoadUsers(); }
  else toast(r.error, 'error');
}

// ─── Admin: Announcements ──────────────────
async function adminLoadAnnouncements() {
  const el = document.getElementById('admin-announce-list');
  if (!el) return;
  const r = await api('GET', '/api/admin/announcements');
  if (!r.ok) { el.innerHTML = '<p style="color:var(--text-dim)">加载失败</p>'; return; }
  if (!r.announcements || !r.announcements.length) { el.innerHTML = '<p style="color:var(--text-dim)">暂无公告</p>'; return; }
  el.innerHTML = r.announcements.map(a => \`
    <div class="flex-between" style="border-bottom:1px solid var(--border);padding:10px 0;font-size:0.85em">
      <div style="flex:1;min-width:0"><span style="color:\${a.enabled?'var(--green)':'var(--text-dim)'}">\${a.enabled?'●':'○'}</span> \${esc(a.content)}<br><span style="font-size:0.75em;color:var(--text-dim)">\${a.created_at}</span></div>
      <button class="btn btn-red btn-sm" style="padding:2px 10px;font-size:0.72em" onclick="adminDeleteAnnouncement(\${a.id})">删除</button>
    </div>
  \`).join('');
}
async function adminCreateAnnouncement() {
  const content = document.getElementById('ann-content')?.value;
  const enabled = document.getElementById('ann-enabled')?.checked ? 1 : 0;
  if (!content) return toast('请输入公告内容', 'error');
  const r = await api('POST', '/api/admin/announcements', { content, enabled });
  if (r.ok) { toast('公告已发布', 'success'); document.getElementById('ann-content').value = ''; adminLoadAnnouncements(); loadAnnouncement(); }
  else toast(r.error, 'error');
}
async function adminDeleteAnnouncement(id) {
  if (!confirm('确认删除此公告？')) return;
  const r = await api('DELETE', '/api/admin/announcements/' + id);
  if (r.ok) { toast('已删除', 'success'); adminLoadAnnouncements(); }
  else toast(r.error, 'error');
}

// ─── Admin: Ads ──────────────────────────
async function adminLoadAds() {
  const el = document.getElementById('admin-ads-list');
  if (!el) return;
  const r = await api('GET', '/api/admin/ads');
  if (!r.ok) { el.innerHTML = '<p style="color:var(--text-dim)">加载失败</p>'; return; }
  if (!r.ads || !r.ads.length) { el.innerHTML = '<p style="color:var(--text-dim)">暂无广告</p>'; return; }
  el.innerHTML = r.ads.map(a => \`
    <div class="flex-between" style="border-bottom:1px solid var(--border);padding:10px 0;font-size:0.85em">
      <div style="flex:1;min-width:0">
        <span style="color:\${a.enabled?'var(--green)':'var(--text-dim)'}">\${a.enabled?'●':'○'}</span>
        <span style="color:var(--cyan)">\${a.type}</span>
        \${a.title ? '<span style="color:var(--text-bright)">' + esc(a.title) + '</span>' : ''}
        <br><span style="font-size:0.75em;color:var(--text-dim)">\${esc(a.image_url||'').slice(0,50)}</span>
      </div>
      <button class="btn btn-red btn-sm" style="padding:2px 10px;font-size:0.72em" onclick="adminDeleteAd(\${a.id})">删除</button>
    </div>
  \`).join('');
}
async function adminCreateAd() {
  const type = document.getElementById('ad-type')?.value;
  const image_url = document.getElementById('ad-img')?.value;
  const link_url = document.getElementById('ad-link')?.value;
  const enabled = document.getElementById('ad-enabled')?.checked ? 1 : 0;
  if (!image_url) return toast('请填写图片URL', 'error');
  const r = await api('POST', '/api/admin/ads', { type, image_url, link_url, enabled });
  if (r.ok) { toast('广告已添加', 'success'); document.getElementById('ad-img').value = ''; document.getElementById('ad-link').value = ''; adminLoadAds(); }
  else toast(r.error, 'error');
}
async function adminDeleteAd(id) {
  if (!confirm('确认删除此广告？')) return;
  const r = await api('DELETE', '/api/admin/ads/' + id);
  if (r.ok) { toast('已删除', 'success'); adminLoadAds(); }
  else toast(r.error, 'error');
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
  const pts = prompt('输入要提现的积分（最少10分）：');
  if (!pts || isNaN(pts) || parseInt(pts) < 10) return toast('最少提现10积分', 'error');
  const r = await api('POST', '/api/invite/withdraw', { points: parseInt(pts) });
  if (r.ok) { toast('提现申请已提交', 'success'); refreshInvite(); } else toast(r.error, 'error');
}

// ─── Accounts ───────────────────────────────
async function refreshAccounts() {
  const r = await api('GET', '/api/accounts');
  const tb = document.getElementById('acc-table');
  if (!tb) return;
  if (!r.ok || !r.accounts || !r.accounts.length) { tb.innerHTML = '<tr><td colspan="10" class="text-center" style="color:var(--text-dim);padding:30px">暂无游戏账号</td></tr>'; return; }
  tb.innerHTML = r.accounts.map(a => \`<tr>
    <td>\${a.id}</td><td>#\${a.order_id}</td>
    <td>\${esc(a.server_username || a.username)}</td>
    <td><strong>\${a.level || 0}</strong></td>
    <td>\${esc(a.map_name || '-')}</td>
    <td>\${sb(a.status)}</td>
    <td style="font-size:0.76em">\${fl(a.skills)}</td>
    <td style="font-size:0.76em">\${fl(a.techniques)}</td>
    <td style="font-size:0.76em">\${fl(a.equipment)}</td>
    <td style="font-size:0.76em;color:var(--text-dim)">\${a.last_check_at || '-'}</td>
  </tr>\`).join('');
}

// ─── Appeals ────────────────────────────────
let AF = false;
async function refreshAppeals() {
  const r = await api('GET', '/api/appeals');
  const list = document.getElementById('appeal-list');
  if (!list) return;
  if (!r.ok || !r.appeals || !r.appeals.length) { list.innerHTML = '<div class="empty-state"><div class="icon">📮</div><p>暂无申诉记录</p></div>'; return; }
  list.innerHTML = r.appeals.map(a => \`
    <div class="card">
      <div class="flex-between">
        <div><strong style="color:var(--cyan)">\${esc(a.title)}</strong><span style="font-size:0.76em;color:var(--text-dim);margin-left:10px">工单 #\${a.order_id || '-'}</span></div>\${sb(a.status)}
      </div>
      <p style="color:var(--text-dim);font-size:0.85em;margin-top:6px">\${esc(a.content)}</p>
      \${a.admin_reply ? '<div class="mt-10" style="border-top:1px solid var(--border);padding-top:8px"><span style="color:var(--cyan);font-size:0.76em">管理员回复：</span><span style="color:var(--text);font-size:0.85em">' + esc(a.admin_reply) + '</span></div>' : ''}
      <div style="font-size:0.72em;color:var(--text-dim);margin-top:6px">\${a.created_at}</div>
    </div>
  \`).join('');
}
function showAppealForm() {
  if (AF) return; AF = true;
  const list = document.getElementById('appeal-list');
  const f = document.createElement('div'); f.className = 'card'; f.id = 'appeal-form';
  f.innerHTML = \`<h3 style="color:var(--cyan);margin-bottom:12px">提交申诉</h3>
    <div class="form-group"><label>标题</label><input id="ap-title" placeholder="申诉标题"></div>
    <div class="form-group"><label>关联工单编号（选填）</label><input id="ap-order" type="number" placeholder="工单ID"></div>
    <div class="form-group"><label>类型</label><select id="ap-type"><option value="appeal">申诉</option><option value="after_sales">售后</option><option value="refund">退款</option><option value="other">其他</option></select></div>
    <div class="form-group"><label>内容</label><textarea id="ap-content" rows="4" placeholder="详细描述问题"></textarea></div>
    <div class="flex gap-10"><button class="btn btn-magenta" onclick="submitAppeal()">提交</button><button class="btn" onclick="cancelAppealForm()">取消</button></div>\`;
  list.insertBefore(f, list.firstChild);
}
function cancelAppealForm() { const f = document.getElementById('appeal-form'); if (f) f.remove(); AF = false; }
async function submitAppeal() {
  const title = document.getElementById('ap-title')?.value.trim();
  const content = document.getElementById('ap-content')?.value.trim();
  const order_id = parseInt(document.getElementById('ap-order')?.value) || 0;
  const type = document.getElementById('ap-type')?.value || 'appeal';
  if (!title || !content) return toast('请填写标题和内容', 'error');
  const r = await api('POST', '/api/appeals', { title, content, order_id, type });
  if (r.ok) { toast('申诉已提交', 'success'); cancelAppealForm(); refreshAppeals(); }
  else toast(r.error || '提交失败', 'error');
}

// ─── Bot ────────────────────────────────────
async function askBot() {
  const input = document.getElementById('chat-input');
  const box = document.getElementById('chat-box');
  if (!input || !input.value.trim()) return;
  const q = input.value.trim();
  box.innerHTML += '<div class="chat-msg"><div class="sender">👤 我</div><div class="text">' + esc(q) + '</div></div>';
  input.value = ''; box.scrollTop = box.scrollHeight;

  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  box.innerHTML += '<div class="chat-msg" id="' + typingId + '"><div class="sender sender-bot">🤖 助手</div><div class="text"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>';
  box.scrollTop = box.scrollHeight;

  const r = await api('POST', '/api/bot/ask', { question: q });
  const typingEl = document.getElementById(typingId);
  if (typingEl) {
    typingEl.outerHTML = '<div class="chat-msg"><div class="sender sender-bot">🤖 助手</div><div class="text">' + esc(r.answer || '抱歉，我不太理解') + '</div></div>';
  }
  box.scrollTop = box.scrollHeight;
}

// ─── Tab ────────────────────────────────────
function switchTab(el, id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const t = document.getElementById(id);
  if (t) t.classList.add('active');
}

// ─── Announcement & Ads ─────────────────────
async function loadAnnouncement() {
  const r = await api('GET', '/api/announcements/active');
  if (r.ok && r.announcement) {
    const bar = document.getElementById('announce-bar');
    document.getElementById('announce-text').textContent = r.announcement.content;
    bar.style.display = 'block';
  }
}
async function loadAds() {
  const r = await api('GET', '/api/ads/active');
  if (!r.ok) return;
  if (r.popup && !sessionStorage.getItem('ad_closed')) {
    document.getElementById('ad-popup-img').src = r.popup.image_url;
    document.getElementById('ad-popup-link').href = r.popup.link_url || '#';
    document.getElementById('ad-popup').classList.add('show');
  }
}
function closeAdPopup() { document.getElementById('ad-popup').classList.remove('show'); sessionStorage.setItem('ad_closed', '1'); }

// ─── Avatar Menu ───────────────────────────
function toggleAvatarMenu() {
  document.getElementById('avatar-dropdown').classList.toggle('show');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.avatar-wrap')) document.getElementById('avatar-dropdown')?.classList.remove('show');
});

// ─── Leaderboard ────────────────────────────
let LB_TYPE = 'purchase';
async function loadLeaderboard(type) {
  LB_TYPE = type;
  const r = await api('GET', '/api/leaderboard/' + type);
  if (!r.ok || !r.leaderboard) return;
  const data = r.leaderboard;
  const champion = document.getElementById('lb-champion');
  const list = document.getElementById('lb-list');
  if (!champion || !list) return;

  // Champion (top 1)
  if (data.length > 0) {
    const c = data[0];
    const statLabel = type === 'purchase' ? '消费 ¥' + (c.total_spent || 0).toFixed(1) :
                      type === 'invite' ? '邀请 ' + (c.total_invited || 0) + ' 人' :
                      'Lv.' + (c.level || 1) + ' (' + (c.xp || 0) + ' XP)';
    champion.innerHTML = \`
      <div class="champ-card animate-in" onclick="showPublicProfile(\${c.id})">
        <div class="champ-crown">\${iconBig('crown')}</div>
        <div class="champ-avatar"><img src="\${esc(c.avatar_url||'')}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" alt=""><span style="display:\${c.avatar_url?'none':'flex'}">\${(c.display_name||c.username||'?')[0].toUpperCase()}</span></div>
        <div class="champ-name">\${esc(c.display_name||c.username)}</div>
        <div class="champ-stat">\${statLabel}</div>
      </div>
    \`;
  }
  // Rest
  const typeMap = { purchase: 'total_spent', invite: 'total_invited', level: 'level' };
  const valKey = typeMap[type] || 'total_spent';
  list.innerHTML = data.map((u, i) => \`
    <div class="lb-card animate-in" style="animation-delay:\${i*0.05}s" onclick="showPublicProfile(\${u.id})">
      <div class="lb-rank \${i===0?'gold':i===1?'silver':i===2?'bronze':''}">#\${i+1}</div>
      <div class="lb-avatar"><img src="\${esc(u.avatar_url||'')}" onerror="this.style.display='none'" alt=""><span style="display:\${u.avatar_url?'none':'flex'};font-size:0.85em">\${(u.display_name||u.username||'?')[0]}</span></div>
      <div class="lb-info">
        <div class="lb-name">\${esc(u.display_name||u.username)} <small>Lv.\${u.level||1}</small></div>
      </div>
      <div class="lb-stat">\${type==='purchase'?'¥'+(u.total_spent||0).toFixed(1):type==='invite'?(u.total_invited||0)+'人':'Lv.'+(u.level||1)}</div>
    </div>
  \`).join('');
}

// ─── Public Profile ─────────────────────────
async function showPublicProfile(uid) {
  const r = await api('GET', '/api/user/' + uid + '/public');
  if (!r.ok || !r.user) return toast('用户不存在', 'error');
  const u = r.user;
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container animate-in" style="max-width:600px">
    <div class="flex-between mb-20 flex-wrap" style="gap:12px">
      <h2 class="page-title" style="margin-bottom:0">\${esc(u.display_name || u.username)}</h2>
      <button class="btn btn-sm" onclick="showPage(TOKEN?'dashboard':'landing')">← 返回</button>
    </div>
    <div class="card" style="text-align:center">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.8em;font-weight:700;color:var(--bg-deep);overflow:hidden"><img src="\${esc(u.avatar_url||'')}" onerror="this.style.display='none'" style="width:72px;height:72px;object-fit:cover"><span style="display:\${u.avatar_url?'none':'flex'}">\${(u.display_name||u.username||'?')[0]}</span></div>
      <h3 style="color:var(--text-bright);font-size:1.2em">\${esc(u.display_name||u.username)}</h3>
      <p style="color:var(--text-dim);font-size:0.85em;margin-top:4px">Lv.\${u.level||1}</p>
      <p style="color:var(--text-dim);font-size:0.85em">\${esc(u.bio||'这个人很懒，什么都没写')}</p>
      <div class="grid grid-3 mt-16" style="gap:12px;text-align:center">
        <div><div style="color:var(--cyan);font-size:1.1em;font-weight:600">\${u.total_orders||0}</div><div style="color:var(--text-dim);font-size:0.78em">工单</div></div>
        <div><div style="color:var(--green);font-size:1.1em;font-weight:600">¥\${(u.total_spent||0).toFixed(1)}</div><div style="color:var(--text-dim);font-size:0.78em">消费</div></div>
        <div><div style="color:var(--yellow);font-size:1.1em;font-weight:600">\${u.total_invited||0}</div><div style="color:var(--text-dim);font-size:0.78em">邀请</div></div>
      </div>
      <button class="btn btn-sm mt-16" onclick="copyText('\${u.invite_code||''}')" style="font-size:0.82em">复制邀请码</button>
    </div>
  </div>\`;
}

// ─── After-Sales ────────────────────────────
async function loadAfterSales() {
  const list = document.getElementById('after-sales-list');
  if (!list) return;
  const r = await api('GET', '/api/after-sales');
  if (!r.ok) { list.innerHTML = '<p class="text-center" style="color:var(--text-dim);padding:30px">加载失败</p>'; return; }
  if (!r.items.length) { list.innerHTML = '<p class="text-center" style="color:var(--text-dim);padding:30px">暂无售后记录</p>'; return; }
  list.innerHTML = r.items.map(a => \`
    <div class="card mb-10">
      <div class="flex-between" style="gap:8px">
        <strong style="color:var(--cyan);font-size:0.9em">\${esc(a.title)}</strong>
        <span class="badge badge-\${a.status}">\${a.status==='pending'?'待回复':a.status==='resolved'?'已解决':'处理中'}</span>
      </div>
      <p style="color:var(--text-dim);font-size:0.82em;margin-top:4px">\${esc(a.content)}</p>
      <div class="flex-between mt-8" style="font-size:0.78em;color:var(--text-dim)">
        <span>工单 #\${a.order_id||'无'}</span>
        <span>\${a.created_at}</span>
      </div>
      \${a.admin_reply ? '<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px"><span style="color:var(--green);font-size:0.78em">管理员回复：</span><span style="color:var(--text);font-size:0.82em">' + esc(a.admin_reply) + '</span></div>' : ''}
      \${a.status === 'pending' ? '<button class="btn btn-sm mt-8" onclick="afterSalesReply('+a.id+')">回复</button>' : ''}
    </div>
  \`).join('');
}
function showAfterSalesForm() {
  showModal(\`
    <h2 class="mb-20" style="color:var(--cyan)">提交售后</h2>
    <div class="form-group"><label>相关工单 #</label><input id="as-order" type="number" placeholder="输入工单编号"></div>
    <div class="form-group"><label>标题</label><input id="as-title" placeholder="售后标题"></div>
    <div class="form-group"><label>内容</label><textarea id="as-content" rows="4" placeholder="详细描述问题"></textarea></div>
    <button class="btn btn-magenta btn-block" onclick="submitAfterSales()">提交</button>
    <button class="btn btn-sm btn-block mt-10" onclick="closeModal()">取消</button>
  \`);
}
async function submitAfterSales() {
  const order_id = document.getElementById('as-order')?.value;
  const title = document.getElementById('as-title')?.value;
  const content = document.getElementById('as-content')?.value;
  if (!order_id || !title || !content) return toast('请填写完整', 'error');
  const r = await api('POST', '/api/after-sales', { order_id: parseInt(order_id), title, content });
  if (r.ok) { toast('售后已提交', 'success'); closeModal(); loadAfterSales(); }
  else toast(r.error, 'error');
}
async function afterSalesReply(id) {
  const reply = prompt('请输入回复内容：');
  if (!reply) return;
  const r = await api('POST', '/api/after-sales/' + id + '/reply', { content: reply });
  if (r.ok) { toast('已回复', 'success'); loadAfterSales(); }
  else toast(r.error, 'error');
}

// ─── Profile ────────────────────────────────
async function loadProfile() {
  const el = document.getElementById('profile-content');
  if (!el) return;
  const info = await api('GET', '/api/user/info');
  if (!info.ok || !info.user) return;
  const u = info.user;
  const xpNext = u.xp_next || 0;
  const xpCur = u.xp || 0;
  const xpPrev = XP_LEVELS[Math.min(u.level, XP_LEVELS.length - 1)] || 0;
  const xpMax = xpNext - xpPrev;
  const xpNow = xpCur - xpPrev;
  const xpPct = xpMax > 0 ? Math.min(100, Math.round(xpNow / xpMax * 100)) : 100;
  el.innerHTML = \`
    <div class="card">
      <div class="profile-header">
        <div class="profile-avatar"><img src="\${esc(u.avatar_url||'')}" onerror="this.style.display='none'" alt=""><span style="display:\${u.avatar_url?'none':'flex'}">\${(u.display_name||u.username||'?')[0].toUpperCase()}</span></div>
        <div style="flex:1;min-width:0">
          <h3 style="color:var(--text-bright);margin-bottom:2px">\${esc(u.display_name||u.username)}</h3>
          <p style="color:var(--text-dim);font-size:0.82em">@\${esc(u.username)}</p>
          <p style="color:var(--text-dim);font-size:0.85em;margin-top:4px">\${esc(u.bio||'这个用户很懒，什么都没有写~')}</p>
        </div>
      </div>
      <div class="mt-16">
        <div class="flex-between" style="font-size:0.82em;margin-bottom:4px"><span>Lv.\${u.level||1}</span><span style="color:var(--cyan)">\${xpNow}/\${xpMax} XP</span></div>
        <div style="height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden"><div style="width:\${xpPct}%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--purple));border-radius:3px;transition:width 1s"></div></div>
      </div>
      <div class="grid grid-3 mt-16" style="gap:8px;text-align:center">
        <div><div style="color:var(--cyan);font-weight:600">\${u.total_orders||0}</div><div style="font-size:0.75em;color:var(--text-dim)">工单</div></div>
        <div><div style="color:var(--green);font-weight:600">¥\${(u.total_spent||0).toFixed(1)}</div><div style="font-size:0.75em;color:var(--text-dim)">消费</div></div>
        <div><div style="color:var(--yellow);font-weight:600">\${u.total_invited||0}</div><div style="font-size:0.75em;color:var(--text-dim)">邀请</div></div>
      </div>
    </div>
    <div class="card">
      <h3>编辑资料</h3>
      <div class="form-group"><label>显示名称</label><input id="pf-name" value="\${esc(u.display_name||'')}" placeholder="昵称" maxlength="30"></div>
      <div class="form-group"><label>个人简介</label><textarea id="pf-bio" rows="3" maxlength="200" placeholder="介绍一下自己">\${esc(u.bio||'')}</textarea></div>
      <div class="form-group"><label>头像URL</label><input id="pf-avatar" value="\${esc(u.avatar_url||'')}" placeholder="https://..."></div>
      <button class="btn btn-green" onclick="saveProfile()">保存资料</button>
    </div>
    <div class="card">
      <h3>兑换码</h3>
      <div class="redeem-input"><input id="redeem-input" placeholder="输入兑换码" onkeydown="if(event.key==='Enter')redeemCode()"><button class="btn btn-magenta" onclick="redeemCode()">兑换</button></div>
      <p class="mt-8" style="font-size:0.78em;color:var(--text-dim)">输入兑换码获取经验值，提升等级享受更多折扣！</p>
    </div>
    <div class="card">
      <h3>等级任务</h3>
      <div class="stat"><span class="label">购买工单</span><span class="value">每单 +50 XP</span></div>
      <div class="stat"><span class="label">邀请好友</span><span class="value">每人 +50 XP</span></div>
      <div class="stat"><span class="label">兑换码</span><span class="value">视兑换码而定</span></div>
      <div class="mt-10" style="font-size:0.82em;color:var(--text-dim)">下一级所需: \${xpPrev} → \${xpNext} XP</div>
    </div>
  \`;
}
async function saveProfile() {
  const display_name = document.getElementById('pf-name')?.value;
  const bio = document.getElementById('pf-bio')?.value;
  const avatar_url = document.getElementById('pf-avatar')?.value;
  const r = await api('PUT', '/api/user/profile', { display_name, bio, avatar_url });
  if (r.ok) { toast('资料已保存', 'success'); loadProfile(); updateAvatarUI(); }
  else toast(r.error, 'error');
}
async function redeemCode() {
  const code = document.getElementById('redeem-input')?.value;
  if (!code) return toast('请输入兑换码', 'error');
  const r = await api('POST', '/api/redeem', { code });
  if (r.ok) { toast(r.message, 'success'); document.getElementById('redeem-input').value = ''; loadProfile(); }
  else toast(r.error, 'error');
}

// ─── Account Logs ──────────────────────────
async function showAccountDetail(id) {
  const r = await api('GET', '/api/accounts/' + id);
  if (!r.ok) return toast(r.error, 'error');
  const a = r.account;
  const logsR = await api('GET', '/api/accounts/' + id + '/logs');
  const logs = logsR.ok ? logsR.logs : [];
  const app = document.getElementById('app');
  app.innerHTML = \`
  <div class="container animate-in" style="max-width:800px">
    <div class="flex-between mb-20 flex-wrap" style="gap:12px">
      <h2 class="page-title" style="margin-bottom:0">账号详情</h2>
      <button class="btn btn-sm" onclick="showPage('accounts')">← 返回</button>
    </div>
    <div class="grid grid-2 mb-20">
      <div class="card">
        <h3>账号信息</h3>
        <div class="stat"><span class="label">账号</span><span class="value">\${esc(a.server_username||a.username)}</span></div>
        <div class="stat"><span class="label">等级</span><span class="value"><strong>\${a.level||0}</strong></span></div>
        <div class="stat"><span class="label">状态</span><span class="value">\${sb(a.status)}</span></div>
        <div class="stat"><span class="label">地图</span><span class="value">\${esc(a.map_name||'-')}</span></div>
      </div>
      <div class="card">
        <h3>时间信息</h3>
        <div class="stat"><span class="label">创建</span><span class="value" style="font-size:0.82em">\${a.created_at||'-'}</span></div>
        <div class="stat"><span class="label">最后检查</span><span class="value" style="font-size:0.82em">\${a.last_check_at||'-'}</span></div>
        <div class="stat"><span class="label">健康状况</span><span class="value">\${a.health_status||'ok'}</span></div>
        \${a.error_msg ? '<div class="stat"><span class="label" style="color:var(--red)">错误</span><span class="value" style="color:var(--red);font-size:0.82em">' + esc(a.error_msg) + '</span></div>' : ''}
      </div>
    </div>
    <div class="card">
      <h3>运行日志</h3>
      \${logs.length === 0 ? '<p style="color:var(--text-dim);font-size:0.85em">暂无日志</p>' : \`
      <div style="max-height:400px;overflow-y:auto;background:var(--bg-input);border-radius:6px;padding:12px;font-size:0.78em;font-family:monospace">
        \${logs.map(l => '<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03)"><span style="color:var(--text-dim)">['+l.created_at+']</span> <span style="color:'+(l.log_type==='error'?'var(--red)':'var(--cyan)')+'">'+esc(l.log_type)+'</span> '+esc(l.message||'')+'</div>').join('')}
      </div>\`}
    </div>
  </div>\`;
}

// ─── Modal Helper ──────────────────────────
function showModal(html) {
  const m = document.createElement('div');
  m.className = 'modal-overlay show';
  m.innerHTML = '<div class="modal">' + html + '</div>';
  m.onclick = function(e) { if (e.target === m) closeModal(); };
  document.body.appendChild(m);
}
function closeModal() {
  const m = document.querySelector('.modal-overlay.show');
  if (m) m.remove();
}

// ─── Copy Helper ───────────────────────────
function copyText(t) { navigator.clipboard.writeText(t).then(() => toast('已复制', 'success')).catch(() => {}); }

// ─── Stats ──────────────────────────────────
async function loadStats() {
  const r = await api('GET', '/api/stats');
  if (!r.ok || !r.stats) return;
  const s = r.stats;
  const el = document.getElementById('hero-stats');
  if (!el) return;
  el.innerHTML = \`
    <div class="hero-stat"><div class="num">\${s.total_users||0}</div><div class="label">注册用户</div></div>
    <div class="hero-stat"><div class="num glow-m">\${s.total_orders||0}</div><div class="label">工单总数</div></div>
    <div class="hero-stat"><div class="num glow-g">\${s.completed_orders||0}</div><div class="label">已完成</div></div>
    <div class="hero-stat"><div class="num">\${s.online_accounts||0}</div><div class="label">在线账号</div></div>
  \`;
}

// ─── Init ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  hideLoading();
  if (!TOKEN) { showPage('landing'); updateNav(false); }
  else { showLoading(); checkAuth(); setTimeout(hideLoading, 300); }
});
<\/script>
</body>
</html>`;
