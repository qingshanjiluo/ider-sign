// pages/admin-announcements.js — 管理后台 - 公告管理

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderAdminAnnouncements({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>公告管理</h2>
          <p>发布和管理系统公告</p>
        </div>
        <button class="btn btn-primary" id="new-announce-btn">+ 发布公告</button>
      </div>
    </div>
    <div id="announcements-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-announce-btn').addEventListener('click', showNewAnnouncementModal);
  loadAnnouncements();
}

async function loadAnnouncements() {
  const el = document.getElementById('announcements-list');
  if (!el) return;
  try {
    const res = await api.adminGetAnnouncements();
    const items = res.announcements || res || [];

    if (!items.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无公告</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>内容</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${items.map(a => `
              <tr>
                <td class="font-mono text-xs">#${a.id}</td>
                <td class="text-sm" style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.content || ''}</td>
                <td><span class="badge ${a.enabled ? 'badge-approved' : 'badge-pending'}">${a.enabled ? '启用' : '禁用'}</span></td>
                <td class="text-sm text-muted">${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" style="color:var(--accent-red)" data-delete-announce="${a.id}">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    el.querySelectorAll('[data-delete-announce]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await modal.confirm('确认删除', '确定要删除该公告吗？');
        if (ok) {
          try {
            await api.adminDeleteAnnouncement(btn.dataset.deleteAnnounce);
            toast.success('公告已删除');
            loadAnnouncements();
          } catch (err) { toast.error(err.message); }
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showNewAnnouncementModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-announce-form">
      <div class="form-group">
        <label class="form-label">公告内容</label>
        <textarea class="form-textarea" id="announce-content" placeholder="输入公告内容..." rows="4" required></textarea>
      </div>
      <div class="form-group flex items-center gap-3">
        <input type="checkbox" id="announce-enabled" checked>
        <label for="announce-enabled" class="form-label" style="margin-bottom:0;">发布后立即启用</label>
      </div>
    </form>`;

  modal.open({
    title: '发布公告',
    body,
    confirmText: '发布',
    onConfirm: async () => {
      const content = document.getElementById('announce-content').value.trim();
      const enabled = document.getElementById('announce-enabled').checked;
      if (!content) {
        toast.error('请输入公告内容');
        return;
      }
      try {
        await api.adminCreateAnnouncement(content, enabled);
        toast.success('公告已发布');
        modal.close();
        loadAnnouncements();
      } catch (err) {
        toast.error(err.message || '发布失败');
      }
    },
  });
}
