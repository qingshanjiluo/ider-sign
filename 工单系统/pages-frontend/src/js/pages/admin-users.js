// pages/admin-users.js — 管理后台 - 用户管理（含发放修仙分）
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import { store } from '../store.js';

export async function renderAdminUsers({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetUsers();
    const users = res.users || res || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>用户管理</h2>
        <p>共 ${users.length} 位用户</p>
      </div>
      <div class="filter-bar mb-4">
        <input type="text" class="form-input" id="user-search" placeholder="搜索用户名..." style="max-width:300px;">
      </div>
      <div class="table-wrap" id="users-table">
        <table>
          <thead>
            <tr><th>ID</th><th>用户名</th><th>等级</th><th>角色</th><th>修仙分</th><th>状态</th><th>注册时间</th><th>操作</th></tr>
          </thead>
          <tbody id="users-tbody">
            ${users.map(u => renderUserRow(u)).join('')}
          </tbody>
        </table>
      </div>`;

    // 搜索
    document.getElementById('user-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#users-tbody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
      });
    });

    // 绑定操作按钮
    bindUserActions();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderUserRow(u) {
  const statusLabel = u.locked ? '<span class="badge badge-rejected">锁定</span>' : '<span class="badge badge-approved">正常</span>';
  const role = u.role || (u.is_admin ? 'admin' : 'user');
  const roleLabel = role === 'super_admin' ? '<span class="badge badge-approved" style="background:var(--accent-amber)">超管</span>' :
    role === 'admin' ? '<span class="badge badge-approved">管理员</span>' : '<span class="text-muted">用户</span>';
  return `
    <tr data-user-id="${u.id}">
      <td class="font-mono text-xs">${u.id}</td>
      <td class="font-semibold">${u.username}</td>
      <td>Lv.${u.level || 1}</td>
      <td>${roleLabel}</td>
      <td class="font-semibold" style="color:var(--accent-amber)">¥${((u.bonus_points || 0) / 400).toFixed(2)}</td>
      <td>${statusLabel}</td>
      <td class="text-sm text-muted">${new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
      <td>
        <div class="flex gap-2" style="flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-action="grant-points" data-id="${u.id}" data-name="${u.username}">发放积分</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle-lock" data-id="${u.id}" data-locked="${u.locked ? 1 : 0}">
            ${u.locked ? '解锁' : '锁定'}
          </button>
          <button class="btn btn-ghost btn-sm" data-action="reset-pw" data-id="${u.id}">重置密码</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle-admin" data-id="${u.id}" data-is-admin="${u.is_admin || 0}">
            ${u.is_admin ? '取消管理员' : '设为管理员'}
          </button>
          <button class="btn btn-ghost btn-sm" style="color:var(--accent-red)" data-action="delete" data-id="${u.id}">删除</button>
        </div>
      </td>
    </tr>`;
}

function bindUserActions() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'grant-points') {
        showGrantPointsModal(id, btn.dataset.name);
      }
      else if (action === 'toggle-lock') {
        const locked = btn.dataset.locked === '1' ? 0 : 1;
        try {
          await api.adminLockUser(id, locked);
          toast.success(locked ? '已锁定' : '已解锁');
          renderAdminUsers({ container: document.getElementById('app-content') });
        } catch (err) { toast.error(err.message); }
      }
      else if (action === 'reset-pw') {
        const body = document.createElement('div');
        body.innerHTML = `
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input type="text" class="form-input" id="admin-reset-pw" placeholder="输入新密码" value="${Math.random().toString(36).slice(-8)}">
          </div>`;
        modal.open({
          title: '重置密码',
          body,
          confirmText: '确认重置',
          onConfirm: async () => {
            const new_password = document.getElementById('admin-reset-pw').value;
            if (!new_password) { toast.error('请输入密码'); return; }
            try {
              await api.adminResetPassword(id, new_password);
              toast.success('密码已重置');
              modal.close();
            } catch (err) { toast.error(err.message); }
          },
        });
      }
      else if (action === 'toggle-admin') {
        const is_admin = btn.dataset.isAdmin === '1' ? 0 : 1;
        try {
          // 使用新 role API
          const newRole = is_admin ? 'admin' : 'user';
          await api.adminSetRole(id, newRole);
          toast.success(is_admin ? '已设为管理员' : '已取消管理员');
          renderAdminUsers({ container: document.getElementById('app-content') });
        } catch (err) { toast.error(err.message); }
      }
      else if (action === 'delete') {
        const ok = await modal.confirm('确认删除', '删除后不可恢复，确定要删除该用户吗？');
        if (ok) {
          try {
            await api.adminDeleteUser(id);
            toast.success('用户已删除');
            btn.closest('tr')?.remove();
          } catch (err) { toast.error(err.message); }
        }
      }
    });
  });
}

function showGrantPointsModal(userId, username) {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>用户：<strong>${username}</strong></p>
    <div class="form-group" style="margin-top:12px;">
      <label class="form-label">金额（元，1元=400修仙币）</label>
      <input type="number" class="form-input" id="grant-points-amount" placeholder="正数=增加，负数=扣除" value="10" step="0.01">
    </div>
    <div class="form-group" style="margin-top:8px;">
      <label class="form-label">原因</label>
      <input type="text" class="form-input" id="grant-points-reason" placeholder="如: 活动奖励、违规扣除" value="">
    </div>`;

  modal.open({
    title: `发放修仙分 - ${username}`,
    body,
    confirmText: '确认发放',
    onConfirm: async () => {
      const yuan = parseFloat(document.getElementById('grant-points-amount').value, 10);
      const reason = document.getElementById('grant-points-reason').value || '';
      if (isNaN(yuan) || yuan === 0) { toast.error('请输入有效的金额（非零）'); return; }
      const points = Math.round(yuan * 400);
      try {
        const res = await api.adminGrantPoints({ user_id: userId, points, reason });
        const oldYuan = (res.old_balance / 400).toFixed(2);
        const newYuan = (res.new_balance / 400).toFixed(2);
        toast.success(`${username} 余额: ¥${oldYuan} → ¥${newYuan} (${yuan > 0 ? '+' : ''}¥${yuan.toFixed(2)})`);
        modal.close();
        renderAdminUsers({ container: document.getElementById('app-content') });
      } catch (err) { toast.error(err.message); }
    },
  });
}
