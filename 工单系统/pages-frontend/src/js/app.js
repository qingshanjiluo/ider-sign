// app.js — SPA 入口文件
// 艾德尔工单系统 · Swedish Functionalism × Minimalism

import { router } from './router.js';
import { store } from './store.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { renderSidebar, initSidebar, refreshSidebar } from './components/sidebar.js';
import { renderTopbar, initTopbar } from './components/topbar.js';
import { initChatBot } from './components/chat-bot.js';

// ── 页面导入 ──────────────────────────
import { renderLanding } from './pages/landing.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
import { renderForgotPassword } from './pages/forgot-password.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderHelp } from './pages/help.js';
import { renderContact } from './pages/contact.js';
import { renderOrders } from './pages/orders.js';
import { renderOrderDetail } from './pages/order-detail.js';
import { renderAccounts } from './pages/accounts.js';
import { renderAccountDetail } from './pages/account-detail.js';
import { renderInvite } from './pages/invite.js';
import { renderLeaderboard } from './pages/leaderboard.js';
import { renderSettings } from './pages/settings.js';
import { renderAppeals } from './pages/appeals.js';
import { renderAfterSales } from './pages/after-sales.js';
import { renderAdminStats } from './pages/admin-stats.js';
import { renderAdminUsers } from './pages/admin-users.js';
import { renderAdminOrders } from './pages/admin-orders.js';
import { renderAdminSuper } from './pages/admin-super.js';
import { renderAdminAccounts } from './pages/admin-accounts.js';
import { renderAdminAppeals } from './pages/admin-appeals.js';
import { renderAdminConfig } from './pages/admin-config.js';
import { renderAdminCoupons } from './pages/admin-coupons.js';
import { renderAdminAnnouncements } from './pages/admin-announcements.js';
import { renderAdminAds } from './pages/admin-ads.js';
import { renderRecharge } from './pages/recharge.js';
import { renderMarket } from './pages/market.js';
import { renderAdminMarket } from './pages/admin-market.js';
import { renderAdminRecharge } from './pages/admin-recharge.js';
import { renderAdminRechargeCodes } from './pages/admin-recharge-codes.js';
import { renderAdminAiConfig } from './pages/admin-ai-config.js';
import { renderAdminMarketOrders } from './pages/admin-market-orders.js';

// ── 全局 DOM ──────────────────────────
const appEl = document.getElementById('app');

// ── 页面渲染辅助 ──────────────────────
function renderLayout(path, renderFn, opts = {}) {
  appEl.innerHTML = `
    <aside class="sidebar" id="sidebar"></aside>
    <main class="main-content">
      <header class="topbar" id="topbar"></header>
      <div id="scrolling-announcement-bar" class="scrolling-announcement" style="display:none;"></div>
      <div class="content-area" id="app-content"></div>
    </main>`;

  document.getElementById('sidebar').innerHTML = renderSidebar();
  document.getElementById('topbar').innerHTML = renderTopbar(path);

  initSidebar();
  initTopbar();

  // 加载滚动公告
  loadScrollingAnnouncement();

  const contentEl = document.getElementById('app-content');
  // 只传需要的字段，避免 opts.container 覆盖新创建的 contentEl
  renderFn({ container: contentEl, params: opts.params, query: opts.query });
}

// ── 滚动公告栏 ──────────────────────────
async function loadScrollingAnnouncement() {
  const bar = document.getElementById('scrolling-announcement-bar');
  if (!bar) return;
  try {
    const res = await api.get('/announcements/active');
    if (res && res.announcement && res.announcement.content) {
      bar.style.display = 'block';
      bar.innerHTML = `
        <div class="scrolling-wrap">
          <span class="scrolling-text">${res.announcement.content}</span>
        </div>
        <button class="scrolling-close" onclick="this.parentElement.style.display='none'">&times;</button>`;
    }
  } catch { /* ignore */ }
}

function renderFullPage(renderFn, opts = {}) {
  appEl.innerHTML = `<div id="app-content" style="width:100%;"></div>`;
  const contentEl = document.getElementById('app-content');
  // 只传需要的字段，避免 opts.container 覆盖新创建的 contentEl
  renderFn({ container: contentEl, params: opts.params, query: opts.query });
}

// ── 路由守卫 ──────────────────────────
const PUBLIC_ROUTES = ['/', '/landing', '/login', '/register', '/forgot-password', '/help', '/contact'];

router.beforeEach = (path, params) => {
  const isPublic = PUBLIC_ROUTES.includes(path);
  const loggedIn = store.isLoggedIn() || store.loadFromStorage();

  if (!isPublic && !loggedIn) {
    window.location.hash = '#/login';
    return false;
  }

  if ((path === '/login' || path === '/register') && loggedIn) {
    window.location.hash = '#/dashboard';
    return false;
  }

  return true;
};

// ── 路由注册 ──────────────────────────
// 公共页面（全屏，无侧边栏）
router.register('/', (ctx) => renderFullPage(renderLanding, ctx));
router.register('/landing', (ctx) => renderFullPage(renderLanding, ctx));
router.register('/login', (ctx) => renderFullPage(renderLogin, ctx));
router.register('/register', (ctx) => renderFullPage(renderRegister, ctx));
router.register('/forgot-password', (ctx) => renderFullPage(renderForgotPassword, ctx));
router.register('/help', (ctx) => renderFullPage(renderHelp, ctx));
router.register('/contact', (ctx) => renderFullPage(renderContact, ctx));

// 带侧边栏的页面
router.register('/dashboard', (ctx) => renderLayout('/dashboard', renderDashboard));
router.register('/orders', (ctx) => renderLayout('/orders', renderOrders, { query: ctx.query }));
router.register('/orders/:id', (ctx) => renderLayout('/orders', renderOrderDetail, { params: ctx.params }));
router.register('/accounts', (ctx) => renderLayout('/accounts', renderAccounts));
router.register('/accounts/:id', (ctx) => renderLayout('/accounts', renderAccountDetail, { params: ctx.params }));
router.register('/market', (ctx) => renderLayout('/market', renderMarket));
router.register('/recharge', (ctx) => renderLayout('/recharge', renderRecharge));
router.register('/invite', (ctx) => renderLayout('/invite', renderInvite));
router.register('/leaderboard', (ctx) => renderLayout('/leaderboard', renderLeaderboard));
router.register('/settings', (ctx) => renderLayout('/settings', renderSettings));
router.register('/appeals', (ctx) => renderLayout('/appeals', renderAppeals));
router.register('/after-sales', (ctx) => renderLayout('/after-sales', renderAfterSales));

// Admin pages
router.register('/admin/stats', (ctx) => renderLayout('/admin/stats', renderAdminStats));
router.register('/admin/users', (ctx) => renderLayout('/admin/users', renderAdminUsers));
router.register('/admin/market', (ctx) => renderLayout('/admin/market', renderAdminMarket));
router.register('/admin/recharge', (ctx) => renderLayout('/admin/recharge', renderAdminRecharge));
router.register('/admin/orders', (ctx) => renderLayout('/admin/orders', renderAdminOrders));
router.register('/admin/super', (ctx) => renderLayout('/admin/super', renderAdminSuper));
router.register('/admin/accounts', (ctx) => renderLayout('/admin/accounts', renderAdminAccounts));
router.register('/admin/appeals', (ctx) => renderLayout('/admin/appeals', renderAdminAppeals));
router.register('/admin/config', (ctx) => renderLayout('/admin/config', renderAdminConfig));
router.register('/admin/coupons', (ctx) => renderLayout('/admin/coupons', renderAdminCoupons));
router.register('/admin/announcements', (ctx) => renderLayout('/admin/announcements', renderAdminAnnouncements));
router.register('/admin/recharge-codes', (ctx) => renderLayout('/admin/recharge-codes', renderAdminRechargeCodes));
router.register('/admin/ai-config', (ctx) => renderLayout('/admin/ai-config', renderAdminAiConfig));
router.register('/admin/ads', (ctx) => renderLayout('/admin/ads', renderAdminAds));
router.register('/admin/market-orders', (ctx) => renderLayout('/admin/market-orders', renderAdminMarketOrders));

// ── 初始化 ──────────────────────────
// 尝试从 localStorage 恢复登录状态
store.loadFromStorage();

// 如果有 token，尝试获取用户信息
async function init() {
  if (store.isLoggedIn()) {
    try {
      const res = await api.getUserInfo();
      const user = res.user || res;
      store.setUser(user);
      localStorage.setItem('ider_user', JSON.stringify(user));
    } catch (err) {
      // Token 失效，清除登录状态
      store.clearStorage();
    }
  }

  // 确保 #app-content 容器存在
  let contentEl = document.getElementById('app-content');
  if (!contentEl) {
    appEl.innerHTML = '<div id="app-content" style="width:100%;"></div>';
    contentEl = document.getElementById('app-content');
  }

  // 启动路由
  router.setContainer(contentEl);
  router.start();

  // 初始化浮动帮助机器人
  initChatBot();
}

init();
