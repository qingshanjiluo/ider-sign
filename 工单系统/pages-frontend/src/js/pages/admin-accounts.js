// pages/admin-accounts.js — 管理后台 - 账号管理

import { api } from '../api.js';
import { toast } from '../components/toast.js';

const STATUS_MAP = {
  creating: { label: '注册中', class: 'badge-pending' },
  farming: { label: '挂机中', class: 'badge-approved' },
  completed: { label: '已完成', class: 'badge-completed' },
  error: { label: '异常', class: 'badge-rejected' },
  banned: { label: '封禁', class: 'badge-rejected' },
};

export async function renderAdminAccounts({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <h2>账号管理</h2>
      <p>查看所有挂机账号状态</p>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="admin-account-status">
        <option value="">全部状态</option>
        <option value="creating">注册中</option>
        <option value="farming">挂机中</option>
        <option value="completed">已完成</option>
        <option value="error">异常</option>
        <option value="banned">封禁</option>
      </select>
    </div>
    <div id="admin-accounts-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('admin-account-status').addEventListener('change', (e) => loadAccounts(e.target.value));
  loadAccounts();
}

async function loadAccounts(status = '') {
  const el = document.getElementById('admin-accounts-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetAccounts(status);
    const accounts = res.accounts || res || [];

    if (!accounts.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无账号</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>游戏账号</th><th>状态</th><th>等级</th><th>用户</th><th>订单号</th><th>更新时间</th></tr>
          </thead>
          <tbody>
            ${accounts.map(a => {
              const st = STATUS_MAP[a.status] || { label: a.status, class: '' };
              return `
                <tr>
                  <td class="font-mono text-xs">${a.id}</td>
                  <td class="font-mono text-xs">${a.game_username || a.username || '-'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td>Lv.${a.level || '-'}</td>
                  <td>${a.username || a.user_id || '-'}</td>
                  <td class="font-mono text-xs">${a.order_id ? '#' + a.order_id : '-'}</td>
                  <td class="text-sm text-muted">${new Date(a.updated_at).toLocaleDateString('zh-CN')}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
