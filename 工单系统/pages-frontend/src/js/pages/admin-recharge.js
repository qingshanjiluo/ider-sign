// pages/admin-recharge.js — 充值审核管理
import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAdminRecharge({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetRechargeOrders('pending');
    const allRes = await api.adminGetRechargeOrders();
    const pendingOrders = res.orders || [];
    const allOrders = allRes.orders || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>充值审核</h2>
        <p>待审核 ${pendingOrders.length} 笔</p>
      </div>

      <!-- Tabs -->
      <div class="tabs mb-6">
        <button class="tab active" data-ar-tab="pending">待审核 (${pendingOrders.length})</button>
        <button class="tab" data-ar-tab="all">全部记录</button>
      </div>

      <div id="ar-tab-pending" class="tab-content">
        ${renderOrdersTable(pendingOrders, true)}
      </div>
      <div id="ar-tab-all" class="tab-content" style="display:none;">
        ${renderOrdersTable(allOrders, false)}
      </div>`;

    // Tab switching
    container.querySelectorAll('[data-ar-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('[data-ar-tab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabId = 'ar-tab-' + tab.dataset.arTab;
        container.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
        document.getElementById(tabId).style.display = 'block';
      });
    });

    // Bind approve/reject
    container.querySelectorAll('[data-ar-approve]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = parseInt(el.dataset.arApprove);
        if (!confirm('确认到账？审核通过后将自动生成兑换码')) return;
        try {
          const res = await api.adminApproveRecharge(id);
          const code = res.code || '';
          toast.success('已确认到账' + (code ? '，兑换码: ' + code : ''));
          renderAdminRecharge({ container });
        } catch (err) {
          toast.error(err.message || '操作失败');
        }
      });
    });

    container.querySelectorAll('[data-ar-reject]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = parseInt(el.dataset.arReject);
        if (!confirm('确认拒绝此充值？')) return;
        try {
          await api.adminRejectRecharge(id);
          toast.success('已拒绝');
          renderAdminRecharge({ container });
        } catch (err) {
          toast.error(err.message || '操作失败');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderOrdersTable(orders, showActions) {
  if (!orders.length) return '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">暂无记录</p></div>';

  return `
    <div class="card">
      <table class="table" style="width:100%;">
        <thead><tr><th>时间</th><th>用户</th><th>类型</th><th>金额</th><th>修仙币</th><th>支付方式</th><th>状态</th><th>兑换码</th>${showActions ? '<th>操作</th>' : ''}</tr></thead>
        <tbody>
          ${orders.map(o => {
            const typeLabel = o.type === 'package' ? '套餐' : o.type === 'cash' ? '现金' : '灵石';
            const amountLabel = o.type === 'spirit_stone' ? (o.amount / 10000).toFixed(0) + '万灵石' : '¥' + o.amount;
            const statusLabel = o.status === 'completed' ? '已到账' : o.status === 'pending' ? '待审核' : '已取消';
            const statusClass = o.status === 'completed' ? 'badge-approved' : o.status === 'pending' ? 'badge-pending' : 'badge-cancelled';
            return `
              <tr>
                <td class="text-sm">${o.created_at?.split(' ')[0] || '-'}</td>
                <td>${o.username || '用户#' + o.user_id}</td>
                <td>${typeLabel}</td>
                <td>${amountLabel}</td>
                <td style="color:var(--accent-amber);">+${o.coins}</td>
                <td class="text-sm">${o.payment_account || '-'}</td>
                <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                <td class="text-sm">${o.redeem_code ? `<code style="background:var(--bg-base);padding:2px 6px;border-radius:4px;font-size:12px;letter-spacing:1px;">${o.redeem_code}</code>` : (o.status === 'completed' ? '已生成' : '-')}</td>
                ${showActions ? `
                <td>
                  ${o.status === 'pending' ? `
                    <button class="btn btn-sm btn-primary" data-ar-approve="${o.id}">确认到账</button>
                    <button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-ar-reject="${o.id}">拒绝</button>
                  ` : '-'}
                </td>` : ''}
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}
