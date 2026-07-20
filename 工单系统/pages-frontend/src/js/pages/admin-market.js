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

    // Bind actions
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
    <table class="table" style="width:100%;">
      <thead><tr><th>名称</th><th>类别</th><th>价格</th><th>库存</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        ${items.map(item => `
          <tr>
            <td><strong>${item.name}</strong></td>
            <td>${item.category || 'other'}</td>
            <td style="color:var(--accent-amber);">${item.price_coins} 币</td>
            <td>${item.stock}</td>
            <td><span class="badge ${item.enabled ? 'badge-approved' : 'badge-cancelled'}">${item.enabled ? '上架' : '下架'}</span></td>
            <td>
              <div class="flex gap-2">
                <button class="btn btn-sm btn-ghost" data-edit-item="${item.id}">编辑</button>
                <button class="btn btn-sm btn-ghost" data-toggle-item="${item.id}">${item.enabled ? '下架' : '上架'}</button>
                <button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-delete-item="${item.id}">删除</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function showAddItemDialog() {
  showItemDialog(null);
}

function showEditItemDialog(item) {
  showItemDialog(item);
}

function showItemDialog(item) {
  const isEdit = !!item;
  modal.open({
    title: isEdit ? '编辑商品' : '新增商品',
    body: `
      <div class="form-group">
        <label class="form-label">商品名称</label>
        <input type="text" class="form-input" id="mi-name" value="${isEdit ? item.name : ''}" placeholder="如：筑基丹">
      </div>
      <div class="form-group">
        <label class="form-label">类别</label>
        <select class="form-input" id="mi-category">
          <option value="elixir" ${isEdit && item.category === 'elixir' ? 'selected' : ''}>丹药</option>
          <option value="weapon" ${isEdit && item.category === 'weapon' ? 'selected' : ''}>法器</option>
          <option value="armor" ${isEdit && item.category === 'armor' ? 'selected' : ''}>防具</option>
          <option value="material" ${isEdit && item.category === 'material' ? 'selected' : ''}>材料</option>
          <option value="skill" ${isEdit && item.category === 'skill' ? 'selected' : ''}>功法</option>
          <option value="pet" ${isEdit && item.category === 'pet' ? 'selected' : ''}>灵宠</option>
          <option value="other" ${isEdit && item.category === 'other' ? 'selected' : ''}>其他</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <input type="text" class="form-input" id="mi-desc" value="${isEdit ? (item.description || '') : ''}" placeholder="简短描述">
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
      const price_coins = parseFloat(document.getElementById('mi-price').value);
      const stock = parseInt(document.getElementById('mi-stock').value) || 0;

      if (!name) return toast.error('请输入商品名称');
      if (!price_coins || price_coins <= 0) return toast.error('请输入有效价格');

      try {
        if (isEdit) {
          const data = { name, category, description, price_coins, stock };
          const enabledEl = document.getElementById('mi-enabled');
          if (enabledEl) data.enabled = parseInt(enabledEl.value);
          await api.adminUpdateMarketItem(item.id, data);
          toast.success('商品已更新');
        } else {
          await api.adminCreateMarketItem({ name, category, description, price_coins, stock });
          toast.success('商品已创建');
        }
        modal.close();
        const appContent = document.getElementById('app-content');
        if (appContent) renderAdminMarket({ container: appContent });
      } catch (err) {
        toast.error(err.message || '操作失败');
      }
    },
  });
}
