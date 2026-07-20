// pages/order-detail.js — 工单详情页

import { api } from '../api.js';
import { toast } from '../components/toast.js';

const STATUS_MAP = {
  pending: { label: '待审批', class: 'badge-pending' },
  approved: { label: '进行中', class: 'badge-approved' },
  completed: { label: '已完成', class: 'badge-completed' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
  cancelled: { label: '已取消', class: 'badge-pending' },
};

export async function renderOrderDetail({ container, params }) {
  const orderId = params.id;
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [orderRes, activitiesRes] = await Promise.all([
      api.getOrder(orderId),
      api.getOrderActivities(orderId),
    ]);

    // API 返回格式: { ok: true, order: {...}, accounts: [...] } / { ok: true, activities: [...] }
    const order = orderRes.order || orderRes;
    const activitiesList = (activitiesRes.activities || activitiesRes || []);

    const status = STATUS_MAP[order.status] || { label: order.status, class: '' };

    container.innerHTML = `
      <div class="page-header">
        <div class="flex justify-between items-center">
          <div>
            <h2>工单 #${order.id}</h2>
            <p>${order.order_type || '代练'} · ${status.label}</p>
          </div>
          <a href="#/orders" class="btn btn-secondary">← 返回列表</a>
        </div>
      </div>

      <!-- 订单信息 -->
      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">状态</div>
          <div class="stat-value"><span class="badge ${status.class}">${status.label}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">金额</div>
          <div class="stat-value">¥${(order.total_price || order.price || 0).toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">账号数</div>
          <div class="stat-value">${order.account_count || order.quantity || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">创建时间</div>
          <div class="stat-value text-sm">${new Date(order.created_at).toLocaleString('zh-CN')}</div>
        </div>
      </div>

      <!-- 关联账号 -->
      <div class="card mb-6" id="order-accounts">
        <div class="card-header">
          <h3>关联账号</h3>
        </div>
        <div class="loading"><div class="spinner"></div></div>
      </div>

      <!-- 操作日志 -->
      <div class="card">
        <div class="card-header">
          <h3>操作日志</h3>
        </div>
        <div id="order-activities">
          ${activitiesList.map(a => `
            <div style="padding:var(--space-3) 0;border-bottom:1px solid var(--border-light);">
              <div class="flex justify-between items-center">
                <span class="text-sm font-semibold">${a.action || a.type || '操作'}</span>
                <span class="text-xs text-muted">${new Date(a.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <p class="text-sm text-muted mt-1">${a.detail || a.description || ''}</p>
            </div>
          `).join('') || '<div class="empty-state"><p>暂无日志</p></div>'}
        </div>
      </div>`;

    // 加载关联账号
    loadOrderAccounts(orderId);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败: ${err.message}</p>
        <a href="#/orders" class="btn btn-secondary mt-4">返回列表</a>
      </div>`;
  }
}

async function loadOrderAccounts(orderId) {
  const el = document.getElementById('order-accounts');
  if (!el) return;
  try {
    const res = await api.getAccounts(orderId);
    const accounts = res.accounts || res || [];
    if (!accounts.length) {
      el.querySelector('.card-header').nextElementSibling.innerHTML = `<div class="empty-state"><p>暂无关联账号</p></div>`;
      return;
    }
    el.innerHTML = `
      <div class="card-header">
        <h3>关联账号 (${accounts.length})</h3>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>账号ID</th><th>状态</th><th>等级</th><th>更新时间</th></tr>
          </thead>
          <tbody>
            ${accounts.map(a => `
              <tr style="cursor:pointer" onclick="location.hash='#/accounts/${a.id}'">
                <td class="font-mono text-xs">${a.game_username || a.username || a.id}</td>
                <td><span class="badge badge-${a.status === 'completed' ? 'completed' : a.status === 'farming' ? 'approved' : 'pending'}">${a.status || '未知'}</span></td>
                <td>Lv.${a.level || '-'}</td>
                <td class="text-sm text-muted">${new Date(a.updated_at).toLocaleDateString('zh-CN')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch {
    el.innerHTML = `<div class="card-header"><h3>关联账号</h3></div><p class="text-muted text-sm" style="padding:var(--space-4);">暂无关联账号</p>`;
  }
}
