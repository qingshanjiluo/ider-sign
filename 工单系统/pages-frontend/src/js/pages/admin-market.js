// pages/admin-market.js — 管理官方市场商品
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

let itemsCache = [];

export async function renderAdminMarket({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetMarketItems();
    itemsCache = res.items || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>商品管理</h2>
        <p>管理官方市场商品</p>
      </div>

      <div style="margin-bottom:16px;">
        <button class="btn btn-primary" id="admin-add-item">新增商品</button>
      </div>

      <div class="card">
        <div id="admin-items-list">
          ${renderItemsTable(itemsCache)}
        </div>
      </div>`;

    document.getElementById('admin-add-item')?.addEventListener('click', showAddItemDialog);

    container.querySelectorAll('[data-edit-item]').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.editItem);
        const item = itemsCache.find(i => i.id === id);
        if (item) showEditItemDialog(item);
      });
    });

    container.querySelectorAll('[data-delete-item]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = parseInt(el.dataset.deleteItem);
        if (!confirm('确定删除此商品？')) return;
        try {
          await api.adminDeleteMarketItem(id);
          toast.success('已删除');
          renderAdminMarket({ container });
        } catch (err) {
          toast.error(err.message || '删除失败');
        }
      });
    });

    container.querySelectorAll('[data-toggle-item]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = parseInt(el.dataset.toggleItem);
        const item = itemsCache.find(i => i.id === id);
        if (!item) return;
        try {
          await api.adminUpdateMarketItem(id, { enabled: item.enabled ? 0 : 1 });
          toast.success(item.enabled ? '已下架' : '已上架');
          renderAdminMarket({ container });
        } catch (err) {
          toast.error(err.message || '操作失败');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderItemsTable(items) {
  if (!items.length) return '<p class="text-muted text-sm" style="padding:24px;text-align:center;">暂无商品</p>';
  return `
    <div class="table-wrap"><table class="table" style="width:100%;">
      <thead><tr><th>名称</th><th>类别</th><th>价格</th><th>库存</th><th>支付方式</th><th>审核</th><th>完成面板</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        ${items.map(item => {
          const methods = (item.payment_methods || 'coin').split(',').map(m => ({ coin: '币', wechat: '微', spirit_stone: '灵' })[m] || m).join('');
          return `<tr>
            <td><strong>${item.name}</strong>${item.image_url ? ' 🖼' : ''}</td>
            <td>${item.category || 'other'}</td>
            <td style="color:var(--accent-amber);">${item.price_coins} 币</td>
            <td>${item.stock}</td>
            <td style="font-size:0.82em">${methods || '币'}</td>
            <td>${item.need_review ? '<span class="badge badge-pending" style="font-size:10px">审核</span>' : '<span style="color:var(--text-dim)">-</span>'}</td>
            <td>${item.complete_panel_enabled ? '<span style="color:var(--accent-green);font-size:0.85em">✓</span>' : '<span style="color:var(--text-dim)">-</span>'}</td>
            <td><span class="badge ${item.enabled ? 'badge-approved' : 'badge-cancelled'}">${item.enabled ? '上架' : '下架'}</span></td>
            <td>
              <div class="flex gap-2" style="gap:4px">
                <button class="btn btn-sm btn-ghost" data-edit-item="${item.id}">编辑</button>
                <button class="btn btn-sm btn-ghost" data-toggle-item="${item.id}">${item.enabled ? '下架' : '上架'}</button>
                <button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-delete-item="${item.id}">删除</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

function showAddItemDialog() { showItemDialog(null); }
function showEditItemDialog(item) { showItemDialog(item); }

function showItemDialog(item) {
  const isEdit = !!item;
  modal.open({
    title: isEdit ? '编辑商品' : '新增商品',
    body: `
      <div class="form-group">
        <label class="form-label">商品名称</label>
        <input type="text" class="form-input" id="mi-name" value="${isEdit ? escHtml(item.name) : ''}" placeholder="如：筑基丹">
      </div>
      <div class="form-group">
        <label class="form-label">类别</label>
        <select class="form-input" id="mi-category">
          ${['elixir','weapon','armor','material','skill','pet','other'].map(c =>
            `<option value="${c}" ${isEdit && item.category === c ? 'selected' : ''}>${({elixir:'丹药',weapon:'法器',armor:'防具',material:'材料',skill:'功法',pet:'灵宠',other:'其他'})[c]}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">简介</label>
        <input type="text" class="form-input" id="mi-desc" value="${isEdit ? escHtml(item.description || '') : ''}" placeholder="简短描述">
      </div>
      <div class="form-group">
        <label class="form-label">封面图片URL</label>
        <input type="text" class="form-input" id="mi-image" value="${isEdit ? escHtml(item.image_url || '') : ''}" placeholder="https://...">
      </div>
      <div class="flex items-center gap-3">
        <div class="form-group" style="flex:1;">
          <label class="form-label">价格（修仙币）</label>
          <input type="number" class="form-input" id="mi-price" value="${isEdit ? item.price_coins : ''}" min="1">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">库存</label>
          <input type="number" class="form-input" id="mi-stock" value="${isEdit ? item.stock : '99'}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">支付方式</label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0;">
          <label style="display:flex;align-items:center;gap:4px;font-size:0.88em">
            <input type="checkbox" class="mi-payment" value="coin" ${isEdit ? ((item.payment_methods||'coin').includes('coin')?'checked':'') : 'checked'}> 修仙币
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:0.88em">
            <input type="checkbox" class="mi-payment" value="wechat" ${isEdit ? ((item.payment_methods||'').includes('wechat')?'checked':'') : ''}> 微信支付
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:0.88em">
            <input type="checkbox" class="mi-payment" value="spirit_stone" ${isEdit ? ((item.payment_methods||'').includes('spirit_stone')?'checked':'') : ''}> 灵石
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="mi-need-review" ${isEdit && item.need_review ? 'checked' : ''}>
          购买后需要管理员审核
        </label>
      </div>
      <div class="form-group" style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px;">
        <label class="form-label" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="mi-panel-enabled" ${isEdit && item.complete_panel_enabled ? 'checked' : ''}>
          完成后显示提示面板
        </label>
        <div id="mi-panel-fields" style="${isEdit && item.complete_panel_enabled ? '' : 'display:none'};margin-top:8px;">
          <div class="form-group">
            <label class="form-label">面板标题</label>
            <input type="text" class="form-input" id="mi-panel-title" value="${isEdit ? escHtml(item.complete_panel_title || '') : ''}" placeholder="如：功法秘籍已送达">
          </div>
          <div class="form-group">
            <label class="form-label">面板描述</label>
            <textarea class="form-input" id="mi-panel-desc" rows="2" placeholder="如：请到宗门藏经阁查阅...">${isEdit ? escHtml(item.complete_panel_desc || '') : ''}</textarea>
          </div>
        </div>
      </div>
      ${isEdit ? `
      <div class="form-group">
        <label class="form-label">状态</label>
        <select class="form-input" id="mi-enabled">
          <option value="1" ${item.enabled ? 'selected' : ''}>上架</option>
          <option value="0" ${!item.enabled ? 'selected' : ''}>下架</option>
        </select>
      </div>` : ''}`,
    confirmText: isEdit ? '保存' : '创建',
    onConfirm: async () => {
      const name = document.getElementById('mi-name').value.trim();
      const category = document.getElementById('mi-category').value;
      const description = document.getElementById('mi-desc').value.trim();
      const image_url = document.getElementById('mi-image').value.trim();
      const price_coins = parseFloat(document.getElementById('mi-price').value);
      const stock = parseInt(document.getElementById('mi-stock').value) || 0;
      const paymentCbs = document.querySelectorAll('.mi-payment:checked');
      const payment_methods = Array.from(paymentCbs).map(cb => cb.value).join(',') || 'coin';
      const need_review = document.getElementById('mi-need-review').checked ? 1 : 0;
      const complete_panel_enabled = document.getElementById('mi-panel-enabled').checked ? 1 : 0;
      const complete_panel_title = document.getElementById('mi-panel-title')?.value.trim() || '';
      const complete_panel_desc = document.getElementById('mi-panel-desc')?.value.trim() || '';

      if (!name) return toast.error('请输入商品名称');
      if (!price_coins || price_coins <= 0) return toast.error('请输入有效价格');

      const data = {
        name, category, description, image_url, price_coins, stock,
        payment_methods, need_review,
        complete_panel_enabled, complete_panel_title, complete_panel_desc,
      };

      try {
        if (isEdit) {
          const enabledEl = document.getElementById('mi-enabled');
          if (enabledEl) data.enabled = parseInt(enabledEl.value);
          await api.adminUpdateMarketItem(item.id, data);
          toast.success('商品已更新');
        } else {
          await api.adminCreateMarketItem(data);
          toast.success('商品已创建');
        }
        modal.close();
        const appContent = document.getElementById('app-content');
        if (appContent) renderAdminMarket({ container: appContent });
      } catch (err) {
        toast.error(err.message || '操作失败');
      }
    },
    onOpen: () => {
      // 完成面板开关联动
      setTimeout(() => {
        document.getElementById('mi-panel-enabled')?.addEventListener('change', () => {
          const panelEl = document.getElementById('mi-panel-fields');
          if (panelEl) panelEl.style.display = document.getElementById('mi-panel-enabled').checked ? '' : 'none';
        });
      }, 50);
    },
  });
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
