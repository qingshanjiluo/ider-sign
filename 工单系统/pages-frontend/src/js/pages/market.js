// pages/market.js — 修仙坊市（官方市场 + 黑市）
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const METHOD_LABELS = { coin: '修仙币', wechat: '微信支付', spirit_stone: '灵石' };

export async function renderMarket({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const user = store.getUser();
    const [itemsRes, ordersRes, purchasesRes] = await Promise.all([
      api.getMarketItems().catch(() => ({ items: [] })),
      api.getMarketOrders().catch(() => ({ orders: [] })),
      api.getMyPurchases().catch(() => ({ purchases: [] })),
    ]);

    const items = itemsRes.items || [];
    const orders = ordersRes.orders || [];
    const purchases = purchasesRes.purchases || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>修仙坊市</h2>
        <p>当前修仙币：<strong style="color:var(--accent-amber);font-size:1.2em;">${user?.bonus_points || 0}</strong></p>
      </div>

      <div class="tabs mb-6" id="market-tabs">
        <button class="tab active" data-tab="official">官方市场</button>
        <button class="tab" data-tab="black">黑市</button>
        <button class="tab" data-tab="redeem">兑换码</button>
        <button class="tab" data-tab="my-orders">我的订单</button>
        <button class="tab" data-tab="my-purchases">购买记录</button>
      </div>

      <div id="tab-official" class="tab-content">
        ${items.length ? `
        <div class="stats-grid">
          ${items.map(item => renderOfficialItemCard(item)).join('')}
        </div>` : '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">官方市场暂无可售商品</p></div>'}
      </div>

      <div id="tab-black" class="tab-content" style="display:none;">
        <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="create-market-order">发布</button>
          <select class="form-input" id="market-order-filter" style="max-width:150px;">
            <option value="all">全部</option>
            <option value="buy">求购</option>
            <option value="sell">售卖</option>
          </select>
        </div>
        <div id="market-orders-list">${renderOrdersList(orders, user)}</div>
      </div>

      <div id="tab-redeem" class="tab-content" style="display:none;">
        <div class="card">
          <div class="card-header"><h3>兑换码激活修仙币</h3></div>
          <div style="padding:8px 0;">
            <p class="text-sm text-muted">输入兑换码即可激活修仙币</p>
            <div class="flex items-center gap-3" style="margin-top:16px;flex-wrap:wrap;">
              <input type="text" class="form-input" id="market-redeem-input" placeholder="输入兑换码（8位字母数字）" style="max-width:260px;text-transform:uppercase;letter-spacing:2px;">
              <button class="btn btn-primary" id="market-redeem-btn">激活修仙币</button>
            </div>
            <p class="text-sm text-muted mt-2" id="market-redeem-result" style="display:none;"></p>
          </div>
        </div>
      </div>

      <div id="tab-my-orders" class="tab-content" style="display:none;">
        <div id="my-market-orders-list">${renderMyOrders(orders, user)}</div>
      </div>

      <div id="tab-my-purchases" class="tab-content" style="display:none;">
        <div id="my-purchases-list">${renderPurchases(purchases)}</div>
      </div>`;

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        container.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
        const target = document.getElementById('tab-' + tab.dataset.tab);
        if (target) target.style.display = 'block';
      });
    });

    container.querySelectorAll('[data-item-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = parseInt(el.dataset.itemId);
        const item = items.find(i => i.id === id);
        if (item) buyOfficialItem(item);
      });
    });

    document.getElementById('market-redeem-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('market-redeem-input').value.trim().toUpperCase();
      const resultEl = document.getElementById('market-redeem-result');
      if (!code) return toast.error('请输入兑换码');
      try {
        const res = await api.redeemCoinCode(code);
        resultEl.style.display = 'block';
        resultEl.style.color = 'var(--accent-green)';
        resultEl.textContent = (res.message || '兑换成功！+' + res.coins + ' 修仙币');
        document.getElementById('market-redeem-input').value = '';
        const userRes = await api.getUserInfo();
        store.setUser(userRes.user || userRes);
        const balanceEl = container.querySelector('.page-header strong');
        if (balanceEl) balanceEl.textContent = userRes.user?.bonus_points || 0;
      } catch (err) {
        resultEl.style.display = 'block';
        resultEl.style.color = 'var(--accent-red)';
        resultEl.textContent = (err.message || '兑换失败');
      }
    });

    document.getElementById('create-market-order')?.addEventListener('click', createMarketOrderDialog);

    document.getElementById('market-order-filter')?.addEventListener('change', () => {
      const filter = document.getElementById('market-order-filter').value;
      const list = document.getElementById('market-orders-list');
      const filtered = filter === 'all' ? orders : orders.filter(o => o.type === filter);
      list.innerHTML = renderOrdersList(filtered, user);
      bindOrderActions(container);
    });

    // 检查是否有未读的完成面板
    const unreadPanel = purchases.find(p => p.status === 'completed' && !p.panel_read);
    if (unreadPanel) {
      const item = items.find(i => i.id === unreadPanel.item_id);
      showCompletePanel(unreadPanel, item);
    }

    bindOrderActions(container);
    bindMyOrderActions(container);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderOfficialItemCard(item) {
  const methods = (item.payment_methods || 'coin').split(',').map(m => METHOD_LABELS[m] || m).filter(Boolean);
  return `
    <div class="stat-card" style="cursor:pointer;position:relative;" data-item-id="${item.id}">
      ${item.image_url ? `<div style="width:100%;height:80px;overflow:hidden;border-radius:8px;margin-bottom:8px;">
        <img src="${escHtml(item.image_url)}" alt="${escHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"
          onerror="this.style.display='none'">
      </div>` : ''}
      <div class="stat-label" style="font-size:1em;font-weight:600;">${escHtml(item.name)}</div>
      ${item.description ? `<div class="text-sm text-muted" style="margin:2px 0 6px;">${escHtml(item.description)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
        <span class="badge badge-approved" style="font-size:11px;">${item.price_coins} 修仙币</span>
        <span class="text-xs text-muted">库存${item.stock}</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">
        ${methods.map(m => `<span class="badge badge-pending" style="font-size:9px;padding:1px 5px;">${m}</span>`).join('')}
        ${item.need_review ? `<span class="badge badge-cancelled" style="font-size:9px;padding:1px 5px;">需审核</span>` : ''}
      </div>
    </div>`;
}

function buyOfficialItem(item) {
  const methods = (item.payment_methods || 'coin').split(',').map(m => m.trim()).filter(Boolean);
  const selectedMethod = methods.includes('coin') ? 'coin' : methods[0] || 'coin';

  modal.open({
    title: '购买商品',
    body: `
      ${item.image_url ? `<div style="width:100%;max-height:120px;overflow:hidden;border-radius:8px;margin-bottom:12px;">
        <img src="${escHtml(item.image_url)}" alt="${escHtml(item.name)}" style="width:100%;max-height:120px;object-fit:cover;" loading="lazy"
          onerror="this.style.display='none'">
      </div>` : ''}
      <p>商品: <strong>${escHtml(item.name)}</strong></p>
      <p class="text-sm text-muted">${escHtml(item.description || '')}</p>
      <p>单价: <strong style="color:var(--accent-amber);">${item.price_coins} 修仙币</strong></p>
      <p class="text-xs text-muted">库存: ${item.stock}</p>

      <div class="form-group" style="margin-top:12px;">
        <label class="form-label">支付方式</label>
        <select class="form-input" id="buy-payment">
          ${methods.map(m => `<option value="${m}" ${m === selectedMethod ? 'selected' : ''}>${METHOD_LABELS[m] || m}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">购买数量</label>
        <input type="number" class="form-input" id="buy-qty" value="1" min="1" max="${item.stock}">
      </div>

      <p class="text-sm text-muted mt-2">总价: <strong id="buy-total">${item.price_coins}</strong> 修仙币</p>

      ${item.need_review ? '<p class="text-xs" style="color:var(--accent-orange);margin-top:8px;">⚠ 该商品购买后需要管理员审核</p>' : ''}`,
    confirmText: '确认购买',
    onConfirm: async () => {
      const qty = parseInt(document.getElementById('buy-qty')?.value) || 1;
      const payment_method = document.getElementById('buy-payment')?.value || 'coin';
      if (qty < 1 || qty > item.stock) return toast.error('数量无效');
      if (payment_method === 'coin') {
        const user = store.getUser();
        const cost = item.price_coins * qty;
        if ((user?.bonus_points || 0) < cost) return toast.error(`修仙币不足，需要 ${cost} 币`);
      }
      try {
        const res = await api.purchaseMarketItem({
          item_id: item.id, quantity: qty,
          payment_method, payment_account: '',
        });
        toast.success(res.message || '购买成功');
        modal.close();
        const appContent = document.getElementById('app-content');
        if (appContent) renderMarket({ container: appContent });
        if (res.complete_panel) {
          setTimeout(() => showCompletePanelDialog(res.complete_panel), 300);
        }
      } catch (err) {
        toast.error(err.message || '购买失败');
      }
    },
    onOpen: () => {
      setTimeout(() => {
        document.getElementById('buy-qty')?.addEventListener('input', () => {
          const qty = parseInt(document.getElementById('buy-qty').value) || 1;
          document.getElementById('buy-total').textContent = (item.price_coins * qty);
        });
      }, 50);
    },
  });
}

function showCompletePanel(purchase, item) {
  if (!purchase || purchase.status !== 'completed' || purchase.panel_read) return;
  if (!item || !item.complete_panel_enabled) return;
  showCompletePanelDialog({
    title: item.complete_panel_title || '购买完成',
    description: item.complete_panel_desc || '感谢您的购买',
  }, purchase.id);
}

function showCompletePanelDialog(panel, purchaseId) {
  modal.open({
    title: panel.title || '购买完成',
    body: `
      <div style="text-align:center;padding:12px 0;">
        <div style="font-size:48px;margin-bottom:12px;">🎉</div>
        <p style="font-size:1.1em;line-height:1.7;white-space:pre-wrap;">${escHtml(panel.description || '')}</p>
      </div>`,
    confirmText: '我知道了',
    confirmOnly: true,
    onConfirm: async () => {
      modal.close();
      if (purchaseId) {
        try { await api.markPurchasePanelRead(purchaseId); } catch (e) {}
      }
    },
  });
}

function renderPurchases(purchases) {
  if (!purchases.length) return '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">暂无购买记录</p></div>';
  const statusMap = { pending:'待审核', approved:'已通过', rejected:'已拒绝', completed:'已完成' };
  const badgeMap = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-cancelled', completed:'' };
  return purchases.map(p => `
    <div class="card mb-3">
      <div class="flex justify-between items-start">
        <div>
          <h4 style="margin:0 0 4px;">${escHtml(p.item_name)} <span style="font-size:0.85em;color:var(--text-dim)">x${p.quantity}</span></h4>
          <p class="text-xs text-muted">
            单价: ${p.price_coins} 币 | 总价: ${p.total_coins} 币
            | 支付: ${METHOD_LABELS[p.payment_method] || p.payment_method}
            | ${p.created_at?.split(' ')[0] || ''}
          </p>
          ${p.admin_notes ? `<p class="text-xs" style="color:var(--accent-orange)">备注: ${escHtml(p.admin_notes)}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <span class="badge ${badgeMap[p.status] || ''}" style="font-size:11px;">${statusMap[p.status] || p.status}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function createMarketOrderDialog() {
  modal.open({
    title: '发布黑市订单',
    body: `
      <div class="form-group">
        <label class="form-label">类型</label>
        <select class="form-input" id="mo-type">
          <option value="sell">我要出售</option>
          <option value="buy">我要收购</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">标题/物品名称</label>
        <input type="text" class="form-input" id="mo-title" placeholder="例如：筑基丹">
      </div>
      <div class="form-group">
        <label class="form-label">类别</label>
        <select class="form-input" id="mo-category">
          <option value="elixir">丹药</option>
          <option value="weapon">法器</option>
          <option value="armor">防具</option>
          <option value="material">材料</option>
          <option value="skill">功法</option>
          <option value="pet">灵宠</option>
          <option value="other">其他</option>
        </select>
      </div>
      <div class="flex items-center gap-3">
        <div class="form-group" style="flex:1;">
          <label class="form-label">数量</label>
          <input type="number" class="form-input" id="mo-qty" value="1" min="1">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">单价（修仙币）</label>
          <input type="number" class="form-input" id="mo-price" min="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <textarea class="form-input" id="mo-desc" rows="2" placeholder="物品详情、成色说明等"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">联系方式</label>
        <input type="text" class="form-input" id="mo-contact" placeholder="微信号/游戏内ID">
      </div>
      <p class="text-xs text-muted mt-2">交易完成后平台抽取5%手续费</p>`,
    confirmText: '发布',
    onConfirm: async () => {
      const type = document.getElementById('mo-type').value;
      const title = document.getElementById('mo-title').value.trim();
      const category = document.getElementById('mo-category').value;
      const quantity = parseInt(document.getElementById('mo-qty').value) || 1;
      const price_coins = parseFloat(document.getElementById('mo-price').value);
      const description = document.getElementById('mo-desc').value.trim();
      const contact = document.getElementById('mo-contact').value.trim();
      if (!title) return toast.error('请输入标题');
      if (!price_coins || price_coins <= 0) return toast.error('请输入有效价格');
      try {
        await api.createMarketOrder({ type, title, category, quantity, price_coins, description, contact });
        toast.success('发布成功');
        modal.close();
        const appContent = document.getElementById('app-content');
        if (appContent) renderMarket({ container: appContent });
      } catch (err) {
        toast.error(err.message || '发布失败');
      }
    },
  });
}

function renderOrdersList(orders, user) {
  if (!orders.length) return '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">暂无订单</p></div>';
  const isAdmin = user?.is_admin === 1 || user?.role === 'admin' || user?.role === 'super_admin';
  return orders.map(o => {
    const isMine = o.user_id === user?.id;
    const statusLabel = o.status === 'pending' ? '待处理' : o.status === 'shipped' ? '已发货' : o.status === 'completed' ? '已完成' : '已取消';
    const badgeClass = o.status === 'pending' ? 'badge-pending' : o.status === 'shipped' ? 'badge-approved' : o.status === 'completed' ? '' : 'badge-cancelled';
    return `
      <div class="card mb-3" data-order-id="${o.id}">
        <div class="flex justify-between items-start">
          <div style="flex:1;">
            <span class="badge ${o.type === 'buy' ? 'badge-pending' : 'badge-approved'}" style="font-size:11px;">
              ${o.type === 'buy' ? '求购' : '售卖'}
            </span>
            <span class="badge ${badgeClass}" style="font-size:11px;margin-left:6px;">${statusLabel}</span>
            <h4 style="margin:8px 0 4px;">${escHtml(o.title)}</h4>
            <p class="text-sm text-muted">${escHtml(o.description || '')}</p>
            <p class="text-xs text-muted">
              数量: ${o.quantity} | 单价: ${o.price_coins}修仙币
              ${o.contact ? '| 联系: ' + escHtml(o.contact) : ''}
              | 发布者: ${o.creator_name || '用户#' + o.user_id}
            </p>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px;">
            <div style="font-weight:700;color:var(--accent-amber);font-size:1.1em;">${(o.price_coins * o.quantity).toLocaleString()} 币</div>
            ${isMine ? '<span class="text-xs text-muted">我的</span>' : ''}
            ${isAdmin ? `<div style="margin-top:8px;">
              <button class="btn btn-sm" style="color:var(--accent-red);border:1px solid var(--accent-red);background:transparent;cursor:pointer;padding:2px 8px;border-radius:var(--radius-sm);font-size:11px;"
                      data-admin-delete-order="${o.id}">删除</button>
            </div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderMyOrders(orders, user) {
  const mine = orders.filter(o => o.user_id === user?.id || o.buyer_id === user?.id || o.seller_id === user?.id);
  if (!mine.length) return '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">暂无相关订单</p></div>';
  return mine.map(o => {
    const isOwner = o.user_id === user?.id;
    const isBuyer = o.buyer_id === user?.id;
    const isSeller = o.seller_id === user?.id;
    const statusLabel = o.status === 'pending' ? '待处理' : o.status === 'shipped' ? '已发货' : o.status === 'completed' ? '已完成' : '已取消';
    const badgeClass = o.status === 'pending' ? 'badge-pending' : o.status === 'shipped' ? 'badge-approved' : o.status === 'completed' ? '' : 'badge-cancelled';
    let actions = '';
    if (o.status === 'pending' && isOwner) {
      actions = `<button class="btn btn-sm btn-ghost" data-action="cancel" data-oid="${o.id}">取消</button>`;
    }
    if (o.status === 'shipped' && isBuyer) {
      actions = `<button class="btn btn-sm btn-primary" data-action="confirm" data-oid="${o.id}">确认收货</button>`;
    }
    if (o.status === 'shipped' && isSeller) {
      actions = `<span class="text-xs text-muted">买家未确认</span>`;
    }
    if (o.status === 'pending' && o.type === 'sell' && o.buyer_id && isOwner) {
      actions = `<button class="btn btn-sm btn-primary" data-action="ship" data-oid="${o.id}">确认发货</button>`;
    }
    if (o.status === 'shipped' && isSeller && o.type === 'sell') {
      actions = `<span class="text-xs text-muted">已发货，等待买家确认</span>`;
    }
    return `
      <div class="card mb-3" data-my-order="${o.id}">
        <div class="flex justify-between items-start">
          <div>
            <span class="badge ${o.type === 'buy' ? 'badge-pending' : 'badge-approved'}" style="font-size:11px;">
              ${o.type === 'buy' ? '求购' : '售卖'}
            </span>
            <span class="badge ${badgeClass}" style="font-size:11px;margin-left:6px;">${statusLabel}</span>
            <h4 style="margin:8px 0 4px;">${escHtml(o.title)}</h4>
            <p class="text-xs text-muted">
              ${isOwner ? '你发布的' : isBuyer ? '你购买的' : isSeller ? '你出售的' : ''}
              ${o.contact ? '| 联系: ' + escHtml(o.contact) : ''}
            </p>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;color:var(--accent-amber);">${(o.price_coins * o.quantity).toLocaleString()} 币</div>
            ${actions ? `<div style="margin-top:8px;">${actions}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function bindOrderActions(container) {
  container.querySelectorAll('[data-admin-delete-order]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const oid = parseInt(btn.dataset.adminDeleteOrder);
      if (!oid) return;
      if (!confirm('管理员确定删除此黑市订单？')) return;
      try {
        await api.adminDeleteMarketOrder(oid);
        toast.success('订单已删除');
        const appContent = document.getElementById('app-content');
        if (appContent) renderMarket({ container: appContent });
      } catch (err) {
        toast.error(err.message || '删除失败');
      }
    });
  });
}

function bindMyOrderActions(container) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const orderId = parseInt(btn.dataset.oid);
    if (!orderId) return;
    try {
      if (action === 'cancel') {
        if (!confirm('确定取消此订单？')) return;
        await api.cancelMarketOrder(orderId);
        toast.success('订单已取消');
      } else if (action === 'confirm') {
        await api.confirmMarketOrder(orderId);
        toast.success('已确认收货');
      } else if (action === 'ship') {
        await api.shipMarketOrder(orderId);
        toast.success('已确认发货');
      }
      const appContent = document.getElementById('app-content');
      if (appContent) renderMarket({ container: appContent });
    } catch (err) {
      toast.error(err.message || '操作失败');
    }
  });

  container.querySelectorAll('[data-order-id]').forEach(el => {
    if (el.closest('[data-my-order]')) return;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action]')) return;
      const oid = parseInt(el.dataset.orderId);
      const ordersRes = await api.getMarketOrders().catch(() => ({ orders: [] }));
      const order = (ordersRes.orders || []).find(o => o.id === oid);
      if (!order) return;
      const user = store.getUser();
      if (order.user_id === user?.id) return toast.info('这是您自己的订单');
      if (order.type === 'sell') {
        if (!confirm(`确认购买「${order.title}」x${order.quantity}，总价 ${(order.price_coins * order.quantity)} 修仙币？`)) return;
        try {
          await api.takeMarketOrder(oid);
          toast.success('购买成功，等待卖家发货');
        } catch (err) {
          toast.error(err.message || '购买失败');
        }
      } else {
        if (!confirm(`确认接单「${order.title}」，联系买家完成交易？`)) return;
        try {
          await api.takeMarketOrder(oid);
          toast.success('已接单，请联系买家并确认发货');
        } catch (err) {
          toast.error(err.message || '接单失败');
        }
      }
      const appContent = document.getElementById('app-content');
      if (appContent) renderMarket({ container: appContent });
    });
  });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
