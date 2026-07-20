// topbar.js — 顶部栏组件

import { store } from '../store.js';
import { icon } from '../icons.js';

const PAGE_TITLES = {
  '/dashboard': '控制台',
  '/orders': '我的工单',
  '/accounts': '我的账号',
  '/invite': '邀请返利',
  '/leaderboard': '排行榜',
  '/appeals': '申诉中心',
  '/after-sales': '售后服务',
  '/settings': '设置',
  '/admin/stats': '数据统计',
  '/admin/users': '用户管理',
  '/admin/orders': '工单管理',
  '/admin/super': '超管工具',
  '/admin/accounts': '账号管理',
  '/admin/appeals': '申诉管理',
  '/admin/config': '系统配置',
  '/admin/coupons': '优惠券管理',
  '/admin/announcements': '公告管理',
  '/admin/ads': '广告管理',
};

export function renderTopbar(path) {
  const title = PAGE_TITLES[path] || '页面';
  const user = store.getUser();
  const username = user?.username || '';

  return `
    <span class="topbar-title">${title}</span>
    <div class="topbar-actions">
      <button class="btn btn-ghost btn-sm" id="menu-toggle" style="display:none;">${icon('menu', 16)}</button>
      <span class="text-sm text-muted">${username}</span>
    </div>`;
}

export function initTopbar() {
  const toggle = document.getElementById('menu-toggle');
  if (toggle) {
    // 响应式菜单按钮
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => { toggle.style.display = mq.matches ? 'inline-flex' : 'none'; };
    mq.addEventListener('change', update);
    update();
    toggle.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('open');
    });
  }
}
