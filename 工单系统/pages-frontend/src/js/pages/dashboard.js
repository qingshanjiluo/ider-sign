// pages/dashboard.js — 控制台/首页

import { api } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';

export async function renderDashboard({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [stats, config] = await Promise.all([
      api.getStats(),
      api.getConfig(),
    ]);
    store.set('config', config);

    const user = store.getUser();
    const levelTitle = user?.level_title || '';

    container.innerHTML = `
      <div class="page-header">
        <h2>控制台</h2>
        <p>欢迎回来，${user?.username || '用户'}</p>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">总工单</div>
          <div class="stat-value">${stats.total_orders || 0}</div>
          <div class="stat-change">全部订单数</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">进行中</div>
          <div class="stat-value" style="color:var(--accent-amber)">${stats.active_orders || stats.approved_orders || 0}</div>
          <div class="stat-change">正在挂机</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已完成</div>
          <div class="stat-value" style="color:var(--accent-green)">${stats.completed_orders || 0}</div>
          <div class="stat-change">成功完成</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">等级</div>
          <div class="stat-value" style="color:var(--accent-blue)">Lv.${user?.level || 1}</div>
          <div class="stat-change">${levelTitle} · 经验值 ${user?.xp || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">修仙币</div>
          <div class="stat-value" style="color:var(--accent-amber)">${user?.bonus_points || 0}</div>
          <div class="stat-change">坊市流通货币 · 可充值获取</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">邀请分</div>
          <div class="stat-value" style="color:var(--accent-green)">${(user?.invite_points || 0).toFixed(1)}</div>
          <div class="stat-change">邀请返利所得</div>
        </div>
      </div>

      <!-- 快速操作 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>快速操作</h3>
        </div>
        <div class="flex gap-3" style="flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="location.hash='#/orders?action=new'">提交新工单</button>
          <button class="btn btn-secondary" onclick="location.hash='#/invite'">邀请好友</button>
          <button class="btn btn-secondary" onclick="location.hash='#/leaderboard'">查看排行榜</button>
        </div>
      </div>

      <!-- 公告区域 -->
      <div id="announcement-area"></div>

      <!-- 最近工单 -->
      <div class="card">
        <div class="card-header">
          <h3>最近工单</h3>
          <a href="#/orders" class="btn btn-ghost btn-sm">查看全部</a>
        </div>
        <div id="recent-orders">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>`;

    // 加载公告
    loadAnnouncement();
    // 加载最近工单
    loadRecentOrders();
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败: ${err.message}</p>
        <button class="btn btn-secondary mt-4" onclick="location.reload()">刷新页面</button>
      </div>`;
  }
}

async function loadAnnouncement() {
  const area = document.getElementById('announcement-area');
  if (!area) return;
  try {
    const res = await api.get('/announcements/active');
    const content = res?.announcement?.content || res?.content || '';
    if (content) {
      area.innerHTML = `
        <div class="card mb-6" style="border-left:3px solid var(--accent-amber);">
          <div class="card-header">
            <h3 style="color:var(--accent-amber);display:flex;align-items:center;gap:6px;">${icon('announcement', 16)} 公告</h3>
          </div>
          <p style="color:var(--text-secondary);line-height:1.6;">${content}</p>
        </div>`;
    }
  } catch { /* ignore */ }
}

async function loadRecentOrders() {
  const el = document.getElementById('recent-orders');
  if (!el) return;

  // 未登录用户不拉取订单（避免 401 控制台报错）
  if (!store.isLoggedIn()) {
    el.innerHTML = `<div class="empty-state"><p>登录后可查看最新工单</p></div>`;
    return;
  }

  try {
    const res = await api.getOrders();
    const orders = (res.orders || res || []).slice(0, 5);
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无工单</p></div>`;
      return;
    }

    const statusMap = {
      pending: '待审批',
      approved: '进行中',
      completed: '已完成',
      rejected: '已拒绝',
      cancelled: '已取消',
    };

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>类型</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='#/orders/${o.id}'">
                <td class="font-mono text-xs">#${o.id}</td>
                <td>${o.order_type || '代练'}</td>
                <td><span class="badge badge-${o.status}">${statusMap[o.status] || o.status}</span></td>
                <td class="text-sm text-muted">${new Date(o.created_at).toLocaleDateString('zh-CN')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch {
    el.innerHTML = `<p class="text-muted text-sm">暂无工单数据</p>`;
  }
}
