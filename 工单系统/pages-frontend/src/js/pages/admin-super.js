// pages/admin-super.js — 超管工具页面（仅 super_admin 可见）
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderAdminSuper({ container }) {
  // 检查是否为超管
  const user = store.getUser();
  if (user?.role !== 'super_admin') {
    container.innerHTML = `<div class="empty-state"><p>权限不足，仅超级管理员可访问</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h2>超管工具</h2>
      <p>管理员管理 · 留言管理 · 系统日志</p>
    </div>

    <!-- Tabs -->
    <div class="tabs" id="super-tabs" style="display:flex;gap:4px;margin-bottom:16px;">
      <button class="btn btn-sm btn-primary" data-tab="admins">管理员列表</button>
      <button class="btn btn-sm btn-ghost" data-tab="messages">站长留言</button>
    </div>

    <div id="super-content">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  // Tab 切换
  document.querySelectorAll('#super-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#super-tabs button').forEach(b => {
        b.className = 'btn btn-sm btn-ghost';
      });
      btn.className = 'btn btn-sm btn-primary';
      loadTab(btn.dataset.tab);
    });
  });

  loadTab('admins');
}

async function loadTab(tab) {
  const el = document.getElementById('super-content');
  if (!el) return;

  if (tab === 'admins') {
    await loadAdminsTab(el);
  } else if (tab === 'messages') {
    await loadMessagesTab(el);
  }
}

// ── 管理员管理 ──────────────────────────
async function loadAdminsTab(el) {
  try {
    const res = await api.adminGetUsers();
    const users = res.users || res || [];
    const admins = users.filter(u => u.is_admin === 1 || (u.role && u.role !== 'user'));

    el.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h3>管理员列表（${admins.length} 人）</h3>
          <button class="btn btn-primary btn-sm" id="btn-add-admin">添加管理员</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>用户名</th><th>角色</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${admins.map(a => {
                const role = a.role || 'admin';
                const roleLabel = role === 'super_admin'
                  ? '<span class="badge" style="background:var(--accent-amber);color:#fff">超管</span>'
                  : '<span class="badge badge-approved">管理员</span>';
                return `
                  <tr>
                    <td class="font-mono text-xs">${a.id}</td>
                    <td class="font-semibold">${a.username}</td>
                    <td>${roleLabel}</td>
                    <td>
                      <div class="flex gap-2">
                        ${role !== 'super_admin' ? `
                          <button class="btn btn-ghost btn-sm" data-action="promote-super" data-id="${a.id}" data-name="${a.username}">提升超管</button>
                          <button class="btn btn-ghost btn-sm" style="color:var(--accent-red)" data-action="remove-admin" data-id="${a.id}" data-name="${a.username}">移除管理员</button>
                        ` : '<span class="text-muted text-sm">—</span>'}
                      </div>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // 绑定事件
    document.getElementById('btn-add-admin')?.addEventListener('click', showAddAdminModal);
    document.querySelectorAll('[data-action="promote-super"]').forEach(btn => {
      btn.addEventListener('click', () => confirmPromote(btn.dataset.id, btn.dataset.name));
    });
    document.querySelectorAll('[data-action="remove-admin"]').forEach(btn => {
      btn.addEventListener('click', () => confirmRemove(btn.dataset.id, btn.dataset.name));
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showAddAdminModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">用户 ID 或用户名</label>
      <input type="text" class="form-input" id="add-admin-input" placeholder="输入用户 ID 或用户名">
    </div>`;

  modal.open({
    title: '添加管理员',
    body,
    confirmText: '确认添加',
    onConfirm: async () => {
      const input = document.getElementById('add-admin-input')?.value.trim();
      if (!input) { toast.error('请输入用户 ID 或用户名'); return; }

      try {
        const res = await api.adminGetUsers();
        const users = res.users || res || [];
        const target = isNaN(input) 
          ? users.find(u => u.username === input)
          : users.find(u => u.id === parseInt(input));

        if (!target) { toast.error('未找到该用户'); return; }
        
        await api.adminSetRole(target.id, 'admin');
        toast.success(`已将 ${target.username} 设为管理员`);
        modal.close();
        loadAdminsTab(document.getElementById('super-content'));
      } catch (err) { toast.error(err.message); }
    },
  });
}

async function confirmPromote(id, name) {
  const ok = await modal.confirm('提升超管', `确定将 ${name} 提升为超级管理员？`);
  if (ok) {
    try {
      await api.adminSetRole(id, 'super_admin');
      toast.success(`${name} 已成为超级管理员`);
      loadAdminsTab(document.getElementById('super-content'));
    } catch (err) { toast.error(err.message); }
  }
}

async function confirmRemove(id, name) {
  const ok = await modal.confirm('移除管理员', `确定取消 ${name} 的管理员权限？`);
  if (ok) {
    try {
      await api.adminSetRole(id, 'user');
      toast.success(`${name} 已被移除管理员`);
      loadAdminsTab(document.getElementById('super-content'));
    } catch (err) { toast.error(err.message); }
  }
}

// ── 留言管理 ──────────────────────────
async function loadMessagesTab(el) {
  try {
    const res = await api.adminGetContactMessages();
    const messages = res.messages || [];

    if (!messages.length) {
      el.innerHTML = '<div class="empty-state"><p>暂无留言</p></div>';
      return;
    }

    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>站长留言（${messages.length} 条）</h3></div>
        <div id="messages-list">
          ${messages.map(m => `
            <div class="card mb-3" style="${m.is_read ? 'opacity:0.6' : 'border-left:3px solid var(--accent-blue)'}">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <div>
                  <strong>${m.name}</strong>
                  ${m.email ? `<span class="text-muted text-sm">(${m.email})</span>` : ''}
                </div>
                <div class="text-muted text-sm">${new Date(m.created_at).toLocaleString('zh-CN')}</div>
              </div>
              <p style="white-space:pre-wrap;color:var(--text-secondary);">${m.content}</p>
              <div style="display:flex;gap:8px;margin-top:8px;">
                ${!m.is_read ? `<button class="btn btn-ghost btn-sm" data-action="mark-read" data-id="${m.id}">标为已读</button>` : '<span class="text-muted text-sm">已读</span>'}
                <span class="text-muted text-sm">${m.user_id ? `用户 #${m.user_id}` : '未登录用户'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;

    document.querySelectorAll('[data-action="mark-read"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.adminMarkContactRead(btn.dataset.id);
          toast.success('已标为已读');
          loadMessagesTab(el);
        } catch (err) { toast.error(err.message); }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
