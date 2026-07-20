// pages/after-sales.js — 售后服务

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const STATUS_MAP = {
  pending: { label: '待处理', class: 'badge-pending' },
  processing: { label: '处理中', class: 'badge-approved' },
  resolved: { label: '已解决', class: 'badge-completed' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
};

export async function renderAfterSales({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>售后服务</h2>
          <p>订单售后问题反馈</p>
        </div>
        <button class="btn btn-primary" id="new-after-sale-btn">+ 提交售后</button>
      </div>
    </div>
    <div id="after-sales-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-after-sale-btn').addEventListener('click', showNewAfterSaleModal);
  loadAfterSales();
}

async function loadAfterSales() {
  const el = document.getElementById('after-sales-list');
  if (!el) return;
  try {
    const res = await api.getAfterSales();
    const items = res.after_sales || res || [];

    if (!items.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无售后记录</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>订单号</th><th>状态</th><th>类型</th><th>创建时间</th></tr>
          </thead>
          <tbody>
            ${items.map(a => {
              const st = STATUS_MAP[a.status] || { label: a.status, class: '' };
              return `
                <tr style="cursor:pointer" onclick="location.hash='#/after-sales/${a.id}'">
                  <td class="font-mono text-xs">#${a.id}</td>
                  <td class="font-mono text-xs">${a.order_id ? '#' + a.order_id : '-'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td>${a.type || '退款'}</td>
                  <td class="text-sm text-muted">${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showNewAfterSaleModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-after-sale-form">
      <div class="form-group">
        <label class="form-label">订单号</label>
        <input type="text" class="form-input" id="as-order-id" placeholder="输入关联订单号" required>
      </div>
      <div class="form-group">
        <label class="form-label">类型</label>
        <select class="form-select" id="as-type">
          <option value="退款">退款</option>
          <option value="补单">补单</option>
          <option value="账号问题">账号问题</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">详细描述</label>
        <textarea class="form-textarea" id="as-content" placeholder="请详细描述售后问题..." required></textarea>
      </div>
    </form>`;

  modal.open({
    title: '提交售后',
    body,
    confirmText: '提交',
    onConfirm: async () => {
      const order_id = document.getElementById('as-order-id').value.trim();
      const type = document.getElementById('as-type').value;
      const content = document.getElementById('as-content').value.trim();
      if (!order_id || !content) {
        toast.error('请填写完整信息');
        return;
      }
      try {
        await api.createAfterSales({ order_id, type, content });
        toast.success('售后申请已提交');
        modal.close();
        loadAfterSales();
      } catch (err) {
        toast.error(err.message || '提交失败');
      }
    },
  });
}
