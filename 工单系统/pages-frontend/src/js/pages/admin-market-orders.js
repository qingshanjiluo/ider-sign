// pages/admin-market-orders.js — 管理后台 - 黑市订单管理
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderAdminMarketOrders({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <h2>黑市订单管理</h2>
      <p>管理所有黑市订单，支持代发货和取消</p>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="admin-market-order-status">
        <option value="">全部状态</option>
        <option value="pending">待处理</option>
        <option value="shipped">已发货</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
      </select>
    </div>
    <div id="admin-market-orders-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>
    <div id="admin-market-orders-pagination" class="flex justify-center gap-2 mt-4"></div>`;

  document.getElementById('admin-market-order-status')?.addEventListener('change', () => loadOrders(1));
  loadOrders(1);
}

async function loadOrders(page = 1) {
  const el = document.getElementById('admin-market-orders-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const status = document.getElementById('admin-market-order-status')?.value || '';
    const res = await api.adminGetMarketOrders(status, page);
    const orders = res.orders || [];

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无订单</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>类型</th>
              <th>标题</th>
              <th>发布者</th>
              <th>买家</th>
              <th>卖家</th>
              <th>数量</th>
              <th>总价</th>
              <th>状态</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => {
              const statusLabel = o.status === 'pending' ? '待处理' : o.status === 'shipped' ? '已发货' : o.status === 'completed' ? '已完成' : '已取消';
              const badgeClass = o.status === 'pending' ? 'badge-pending' : o.status === 'shipped' ? 'badge-approved' : o.status === 'completed' ? '' : 'badge-cancelled';
              const typeLabel = o.type === 'buy' ? '求购' : '售卖';
              const total = (o.price_coins * o.quantity).toLocaleString();

              let actions = '';
              if (o.status === 'pending') {
                if ((o.type === 'sell' && o.buyer_id) || (o.type === 'buy' && o.seller_id)) {
                  actions = `<button class="btn btn-sm btn-primary" data-action="admin-ship" data-id="${o.id}">代发货</button>`;
                }
                actions += `<button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-action="admin-cancel" data-id="${o.id}">取消</button>`;
              }
              if (o.status === 'shipped') {
                actions = `<button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-action="admin-cancel" data-id="${o.id}">取消</button>`;
              }

              return `
                <tr>
                  <td class="font-mono text-xs">#${o.id}</td>
                  <td><span class="badge ${o.type === 'buy' ? 'badge-pending' : 'badge-approved'}">${typeLabel}</span></td>
                  <td><strong>${o.title}</strong></td>
                  <td class="text-sm">${o.creator_name || '用户#' + o.user_id}</td>
                  <td class="text-sm">${o.buyer_name || (o.buyer_id ? '用户#' + o.buyer_id : '-')}</td>
                  <td class="text-sm">${o.seller_name || (o.seller_id ? '用户#' + o.seller_id : '-')}</td>
                  <td>${o.quantity}</td>
                  <td style="color:var(--accent-amber);font-weight:600;">${total} 币</td>
                  <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                  <td class="text-sm text-muted">${o.created_at?.split(' ')[0] || '-'}</td>
                  <td>
                    <div class="flex gap-1" style="flex-wrap:wrap;">
                      ${actions || '<span class="text-xs text-muted">-</span>'}
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    // Pagination
    const paginationEl = document.getElementById('admin-market-orders-pagination');
    if (paginationEl && res.total > res.limit) {
      const totalPages = Math.ceil(res.total / res.limit);
      paginationEl.innerHTML = Array.from({ length: totalPages }, (_, i) => `
        <button class="btn btn-sm ${i + 1 === page ? 'btn-primary' : 'btn-ghost'}" data-page="${i + 1}">${i + 1}</button>
      `).join('');
      paginationEl.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => loadOrders(parseInt(btn.dataset.page)));
      });
    }

    // Bind actions
    container.querySelectorAll('[data-action="admin-ship"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        if (!confirm(`确认代发货订单 #${id}？`)) return;
        api.adminMarketOrderAction(id, 'admin-ship')
          .then(() => { toast.success('已代发货'); loadOrders(page); })
          .catch(err => toast.error(err.message));
      });
    });

    container.querySelectorAll('[data-action="admin-cancel"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        modal.open({
          title: '取消订单',
          body: `
            <p>确定取消订单 #${id}？</p>
            <div class="form-group" style="margin-top:12px;">
              <label class="form-label">取消原因（可选）</label>
              <textarea class="form-input" id="admin-cancel-reason" rows="2" placeholder="请输入取消原因..."></textarea>
            </div>`,
          confirmText: '确认取消',
          onConfirm: async () => {
            const notes = document.getElementById('admin-cancel-reason')?.value || '';
            try {
              await api.adminMarketOrderAction(id, 'admin-cancel', notes);
              toast.success('已取消');
              modal.close();
              loadOrders(page);
            } catch (err) {
              toast.error(err.message);
            }
          },
        });
      });
    });

  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
