// pages/admin-coupons.js — 管理后台 - 优惠券

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderAdminCoupons({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>优惠券管理</h2>
          <p>创建和管理优惠券</p>
        </div>
        <button class="btn btn-primary" id="new-coupon-btn">+ 创建优惠券</button>
      </div>
    </div>
    <div id="coupons-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-coupon-btn').addEventListener('click', showNewCouponModal);
  loadCoupons();
}

async function loadCoupons() {
  const el = document.getElementById('coupons-list');
  if (!el) return;
  try {
    const res = await api.adminGetCoupons();
    const rawCoupons = res.coupons || res || [];
    // 规范化字段：DB 用 coupon_type/discount_percent/fixed_amount，前端用 type/value
    const coupons = rawCoupons.map(c => ({
      ...c,
      type: c.coupon_type || 'percent',
      value: (c.coupon_type === 'fixed') ? (c.fixed_amount || 0) : (c.discount_percent || 0),
    }));

    if (!coupons.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无优惠券</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>代码</th><th>类型</th><th>值</th><th>使用次数</th><th>上限</th><th>过期时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${coupons.map(c => `
              <tr>
                <td class="font-mono font-semibold">${c.code}</td>
                <td>${c.type === 'percent' ? '百分比' : '固定金额'}</td>
                <td>${c.type === 'percent' ? c.value + '%' : '¥' + c.value}</td>
                <td>${c.used_count || 0}</td>
                <td>${c.max_uses || '无限'}</td>
                <td class="text-sm text-muted">${c.expires_at ? new Date(c.expires_at).toLocaleDateString('zh-CN') : '永不过期'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" style="color:var(--accent-red)" data-delete-coupon="${c.id}">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    // Delete buttons
    el.querySelectorAll('[data-delete-coupon]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await modal.confirm('确认删除', '确定要删除该优惠券吗？');
        if (ok) {
          try {
            await api.adminDeleteCoupon(btn.dataset.deleteCoupon);
            toast.success('优惠券已删除');
            loadCoupons();
          } catch (err) { toast.error(err.message); }
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showNewCouponModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-coupon-form">
      <div class="form-group">
        <label class="form-label">优惠码</label>
        <input type="text" class="form-input" id="coupon-code" placeholder="如 SUMMER2024" required>
      </div>
      <div class="form-group">
        <label class="form-label">类型</label>
        <select class="form-select" id="coupon-type">
          <option value="fixed">固定金额</option>
          <option value="percent">百分比</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">折扣值</label>
        <input type="number" class="form-input" id="coupon-value" placeholder="固定: 元 / 百分比: %" required>
      </div>
      <div class="form-group">
        <label class="form-label">使用上限（0=无限）</label>
        <input type="number" class="form-input" id="coupon-max-uses" value="0">
      </div>
      <div class="form-group">
        <label class="form-label">过期时间（选填）</label>
        <input type="datetime-local" class="form-input" id="coupon-expires">
      </div>
    </form>`;

  modal.open({
    title: '创建优惠券',
    body,
    confirmText: '创建',
    onConfirm: async () => {
      const data = {
        code: document.getElementById('coupon-code').value.trim().toUpperCase(),
        type: document.getElementById('coupon-type').value,
        value: parseFloat(document.getElementById('coupon-value').value),
        max_uses: parseInt(document.getElementById('coupon-max-uses').value) || 0,
        expires_at: document.getElementById('coupon-expires').value || null,
      };
      if (!data.code || !data.value) {
        toast.error('请填写完整信息');
        return;
      }
      try {
        await api.adminCreateCoupon(data);
        toast.success('优惠券已创建');
        modal.close();
        loadCoupons();
      } catch (err) {
        toast.error(err.message || '创建失败');
      }
    },
  });
}
