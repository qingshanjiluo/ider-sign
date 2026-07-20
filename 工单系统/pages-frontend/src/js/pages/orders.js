// pages/orders.js — 我的工单列表 + 新建工单

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

const PAYMENT_METHODS = {
  wechat: { label: '现金（微信支付）', unit: '元', icon: '¥' },
  coin: { label: '修仙币', unit: '修仙币', icon: 'B' },
  spirit_stone: { label: '灵石', unit: '万灵石', icon: '灵' },
};

export async function renderOrders({ container, query }) {
  // 如果有 ?action=new 则弹出新建工单
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>我的工单</h2>
          <p>管理你的代练工单</p>
        </div>
        <button class="btn btn-primary" id="new-order-btn">+ 新建工单</button>
      </div>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="status-filter">
        <option value="">全部状态</option>
        <option value="pending">待审批</option>
        <option value="approved">进行中</option>
        <option value="completed">已完成</option>
        <option value="rejected">已拒绝</option>
        <option value="cancelled">已取消</option>
      </select>
    </div>
    <div id="orders-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-order-btn').addEventListener('click', showNewOrderModal);
  document.getElementById('status-filter').addEventListener('change', (e) => loadOrders(e.target.value));

  loadOrders();

  if (query?.action === 'new') {
    showNewOrderModal();
  }
}

async function loadOrders(status = '') {
  const el = document.getElementById('orders-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.getOrders(status);
    const orders = res.orders || res || [];

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无工单</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>类型</th>
              <th>状态</th>
              <th>账号数</th>
              <th>积分</th>
              <th>付款方式</th>
              <th>金额</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='#/orders/${o.id}'">
                <td class="font-mono text-xs">#${o.id}</td>
                <td>${o.order_type || '代练'}</td>
                <td><span class="badge ${STATUS_MAP[o.status]?.class || ''}">${STATUS_MAP[o.status]?.label || o.status}</span></td>
                <td>${o.account_count || o.quantity || 0}</td>
                <td class="font-semibold">${o.bonus_points || o.amount || 0}</td>
                <td>${PAYMENT_METHODS[o.payment_method]?.label || o.payment_method || '-'}</td>
                <td class="font-semibold">${formatPrice(o)}</td>
                <td class="text-sm text-muted">${new Date(o.created_at).toLocaleDateString('zh-CN')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function formatPrice(order) {
  const method = PAYMENT_METHODS[order.payment_method];
  if (!method) return `¥${(order.price || 0).toFixed(2)}`;
  if (order.payment_method === 'wechat') return `¥${(order.price || 0).toFixed(2)}`;
  if (order.payment_method === 'coin') return `${order.price || 0} 修仙币`;
  if (order.payment_method === 'spirit_stone') return `${order.price || 0} 万灵石`;
  return `¥${(order.price || 0).toFixed(2)}`;
}

async function showNewOrderModal() {
  // 获取用户信息（余额）
  let userBalance = 0;
  try {
    const info = await api.getUserInfo();
    userBalance = info.user?.bonus_points || info.bonus_points || 0;
  } catch (e) { /* ignore */ }

  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-order-form">
      <div class="form-group">
        <label class="form-label">付款方式 <span style="color:var(--accent-red)">*</span></label>
        <div class="radio-group" id="payment-method-group" style="display:flex;gap:8px;flex-wrap:wrap;">
          <label class="radio-card" style="flex:1;min-width:120px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-md);cursor:pointer;text-align:center;transition:all 0.2s;">
            <input type="radio" name="payment-method" value="wechat" checked style="display:none;">
            <div style="font-size:var(--text-lg);font-weight:600;">¥</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);">现金（微信）</div>
          </label>
          <label class="radio-card" style="flex:1;min-width:120px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-md);cursor:pointer;text-align:center;transition:all 0.2s;">
            <input type="radio" name="payment-method" value="coin" style="display:none;">
            <div style="font-size:var(--text-lg);font-weight:600;">B</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);">修仙币 (余: ${userBalance})</div>
          </label>
          <label class="radio-card" style="flex:1;min-width:120px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-md);cursor:pointer;text-align:center;transition:all 0.2s;">
            <input type="radio" name="payment-method" value="spirit_stone" style="display:none;">
            <div style="font-size:var(--text-lg);font-weight:600;">灵</div>
            <div style="font-size:var(--text-xs);color:var(--text-secondary);">灵石</div>
          </label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">邀请码 <span style="color:var(--accent-red)">*</span></label>
        <input type="text" class="form-input" id="order-invite-code" placeholder="输入邀请码" required>
      </div>

      <div class="form-group">
        <label class="form-label">邀请积分数量 <span style="color:var(--accent-red)">*</span></label>
        <input type="number" class="form-input" id="order-points" value="10" min="10" step="10" required>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:4px;">每10积分 = 1个120级账号，必须是10的倍数</div>
      </div>

      <div class="form-group">
        <label class="form-label">工单类型（选填）</label>
        <select class="form-select" id="order-type">
          <option value="代练">代练</option>
          <option value="代打">代打</option>
          <option value="托管">托管</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">优惠码（选填）</label>
        <div style="display:flex;gap:8px;">
          <input type="text" class="form-input" id="order-coupon" placeholder="输入优惠码" style="flex:1;">
          <button type="button" class="btn btn-ghost btn-sm" id="coupon-check-btn">验证</button>
        </div>
        <div id="coupon-info" style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:4px;"></div>
      </div>

      <div class="form-group">
        <label class="form-label">备注（选填）</label>
        <textarea class="form-textarea" id="order-note" placeholder="特殊要求请在此说明"></textarea>
      </div>

      <div id="order-price-info" style="margin-top:12px;padding:12px;background:var(--bg-elevated);border-radius:var(--radius-md);border:1px solid var(--border);">
        <div style="font-weight:600;margin-bottom:8px;">订单预览</div>
        <div id="price-preview" style="font-size:var(--text-sm);color:var(--text-secondary);"></div>
      </div>
    </form>`;

  modal.open({
    title: '新建工单',
    body,
    confirmText: '提交工单',
    onConfirm: async () => {
      const payment_method = document.querySelector('input[name="payment-method"]:checked')?.value;
      const invite_code = document.getElementById('order-invite-code').value.trim();
      const points = parseInt(document.getElementById('order-points').value) || 0;
      const order_type = document.getElementById('order-type').value;
      const coupon_code = document.getElementById('order-coupon').value.trim();
      const note = document.getElementById('order-note').value.trim();

      // 验证
      if (!payment_method) { toast.error('请选择付款方式'); return; }
      if (!invite_code) { toast.error('请输入邀请码'); return; }
      if (points < 10 || points % 10 !== 0) { toast.error('积分数量必须是10的倍数'); return; }

      try {
        const res = await api.createOrder({ 
          order_type, 
          payment_method, 
          invite_code, 
          points, 
          coupon_code: coupon_code || undefined, 
          note: note || undefined 
        });
        toast.success('工单创建成功');
        modal.close();
        loadOrders();
      } catch (err) {
        toast.error(err.message || '创建失败');
      }
    },
  });

  // ── 价格实时预览 ──
  function updatePricePreview() {
    const pts = parseInt(document.getElementById('order-points').value) || 0;
    const method = document.querySelector('input[name="payment-method"]:checked')?.value;
    const el = document.getElementById('price-preview');
    if (!el || pts < 10) {
      if (el) el.innerHTML = '<span style="color:var(--text-muted)">请填写积分数量</span>';
      return;
    }

    const accounts = Math.ceil(pts / 10);
    let priceText = '';
    if (method === 'wechat') {
      priceText = `¥${(pts / 120).toFixed(2)}`;
    } else if (method === 'coin') {
      priceText = `${pts} 修仙币`;
    } else if (method === 'spirit_stone') {
      priceText = `${(pts * 100000).toLocaleString()} 万灵石`;
    }

    let discountText = '';
    const couponInfo = document.getElementById('coupon-info');
    if (couponInfo?.dataset?.couponType) {
      if (couponInfo.dataset.couponType === 'percent') {
        discountText = ` (优惠 ${couponInfo.dataset.discountPercent}%)`;
      } else {
        discountText = ` (减免 ¥${couponInfo.dataset.fixedAmount})`;
      }
    }

    el.innerHTML = `
      <div>积分: <strong>${pts}</strong> | 账号数: <strong>${accounts}</strong></div>
      <div>价格: <strong>${priceText}</strong>${discountText}</div>
    `;
  }

  // 绑定事件
  body.querySelectorAll('input[name="payment-method"]').forEach(radio => {
    radio.addEventListener('change', () => {
      body.querySelectorAll('.radio-card').forEach(card => {
        card.style.borderColor = card.querySelector('input').checked ? 'var(--accent-primary)' : 'var(--border)';
        card.style.background = card.querySelector('input').checked ? 'var(--accent-primary-light)' : '';
      });
      updatePricePreview();
    });
    // 初始选中
    if (radio.checked) {
      radio.closest('.radio-card').style.borderColor = 'var(--accent-primary)';
      radio.closest('.radio-card').style.background = 'var(--accent-primary-light)';
    }
  });

  body.querySelector('#order-points').addEventListener('input', updatePricePreview);

  // 优惠券验证
  body.querySelector('#coupon-check-btn').addEventListener('click', async () => {
    const code = body.querySelector('#order-coupon').value.trim();
    const infoEl = body.querySelector('#coupon-info');
    if (!code) { infoEl.textContent = ''; infoEl.dataset.couponType = ''; return; }
    
    try {
      const res = await api.validateCoupon(code);
      if (res.ok) {
        infoEl.style.color = 'var(--accent-green)';
        if (res.coupon_type === 'fixed') {
          infoEl.textContent = `优惠券有效: 减免 ¥${res.fixed_amount}`;
          infoEl.dataset.couponType = 'fixed';
          infoEl.dataset.fixedAmount = res.fixed_amount;
          delete infoEl.dataset.discountPercent;
        } else {
          infoEl.textContent = `优惠券有效: ${res.discount_percent}% 折扣`;
          infoEl.dataset.couponType = 'percent';
          infoEl.dataset.discountPercent = res.discount_percent;
          delete infoEl.dataset.fixedAmount;
        }
        updatePricePreview();
      }
    } catch (err) {
      infoEl.style.color = 'var(--accent-red)';
      infoEl.textContent = err.message || '优惠码无效';
      delete infoEl.dataset.couponType;
      updatePricePreview();
    }
  });

  updatePricePreview();
}
