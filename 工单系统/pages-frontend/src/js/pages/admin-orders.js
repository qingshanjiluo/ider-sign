// pages/admin-orders.js — 管理后台 - 工单管理（含审批操作）
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const STATUS_MAP = {
  pending: { label: '待审批', class: 'badge-pending' },
  approved: { label: '进行中', class: 'badge-approved' },
  completed: { label: '已完成', class: 'badge-completed' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
  cancelled: { label: '已取消', class: 'badge-pending' },
};

export async function renderAdminOrders({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <h2>工单管理</h2>
      <p>管理所有用户工单</p>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="admin-order-status">
        <option value="">全部状态</option>
        <option value="pending">待审批</option>
        <option value="approved">进行中</option>
        <option value="completed">已完成</option>
        <option value="rejected">已拒绝</option>
      </select>
    </div>
    <div id="admin-orders-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('admin-order-status').addEventListener('change', (e) => loadOrders(e.target.value));
  loadOrders();
}

async function loadOrders(status = '') {
  const el = document.getElementById('admin-orders-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetOrders(status);
    const orders = res.orders || res || [];

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无工单</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>用户</th><th>类型</th><th>状态</th><th>金额</th><th>数量</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${orders.map(o => {
              const st = STATUS_MAP[o.status] || { label: o.status, class: '' };
              const adminBtns = getActionButtons(o);
              return `
                <tr>
                  <td class="font-mono text-xs">#${o.id}</td>
                  <td>${o.user_name || o.username || o.user_id || '-'}</td>
                  <td>${o.order_type || '代练'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td class="font-semibold">¥${(o.total_price || o.price || 0).toFixed(2)}</td>
                  <td>${o.account_count || o.quantity || 0}</td>
                  <td class="text-sm text-muted">${new Date(o.created_at).toLocaleDateString('zh-CN')}</td>
                  <td>
                    <div class="flex gap-1" style="flex-wrap:wrap;">
                      ${adminBtns}
                      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/orders/${o.id}'">详情</button>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    // 绑定审批按钮事件
    document.querySelectorAll('[data-action="approve-order"]').forEach(btn => {
      btn.addEventListener('click', () => showStatusModal(btn.dataset.id, 'approved'));
    });
    document.querySelectorAll('[data-action="reject-order"]').forEach(btn => {
      btn.addEventListener('click', () => showStatusModal(btn.dataset.id, 'rejected'));
    });
    document.querySelectorAll('[data-action="complete-order"]').forEach(btn => {
      btn.addEventListener('click', () => showStatusModal(btn.dataset.id, 'completed'));
    });

  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function getActionButtons(order) {
  if (order.status === 'pending') {
    return `
      <button class="btn btn-sm btn-primary" data-action="approve-order" data-id="${order.id}">通过</button>
      <button class="btn btn-sm" style="background:var(--accent-red);color:#fff;border:none;border-radius:var(--radius-md);padding:4px 10px;font-size:var(--text-sm);cursor:pointer;" data-action="reject-order" data-id="${order.id}">拒绝</button>`;
  }
  if (order.status === 'approved') {
    return `
      <button class="btn btn-sm" style="background:var(--accent-green);color:#fff;border:none;border-radius:var(--radius-md);padding:4px 10px;font-size:var(--text-sm);cursor:pointer;" data-action="complete-order" data-id="${order.id}">完成</button>`;
  }
  return '';
}

function showStatusModal(orderId, newStatus) {
  const statusLabels = { approved: '通过', rejected: '拒绝', completed: '完成' };
  const body = document.createElement('div');
  body.innerHTML = `
    <p>确定将工单 #${orderId} 状态改为「${statusLabels[newStatus]}」？</p>
    <div class="form-group" style="margin-top:12px;">
      <label class="form-label">备注（可选）</label>
      <textarea class="form-input" id="admin-order-note" rows="3" placeholder="请输入备注..."></textarea>
    </div>`;

  modal.open({
    title: `${statusLabels[newStatus]}工单 #${orderId}`,
    body,
    confirmText: '确认',
    onConfirm: async () => {
      const note = document.getElementById('admin-order-note')?.value || '';
      try {
        await api.post(`/orders/${orderId}/status`, { status: newStatus, notes: note, admin_id: undefined });
        toast.success(`工单 #${orderId} 已${statusLabels[newStatus]}`);
        modal.close();
        // 刷新列表
        const statusEl = document.getElementById('admin-order-status');
        loadOrders(statusEl?.value || '');
      } catch (err) {
        toast.error(err.message);
      }
    },
  });
}
