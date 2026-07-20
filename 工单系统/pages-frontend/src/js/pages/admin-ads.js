// pages/admin-ads.js — 管理后台 - 广告管理

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderAdminAds({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>广告管理</h2>
          <p>管理弹窗和侧边栏广告</p>
        </div>
        <button class="btn btn-primary" id="new-ad-btn">+ 创建广告</button>
      </div>
    </div>
    <div id="ads-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-ad-btn').addEventListener('click', showNewAdModal);
  loadAds();
}

async function loadAds() {
  const el = document.getElementById('ads-list');
  if (!el) return;
  try {
    const res = await api.adminGetAds();
    const ads = res.ads || res || [];

    if (!ads.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无广告</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>标题</th><th>类型</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${ads.map(a => `
              <tr>
                <td class="font-mono text-xs">#${a.id}</td>
                <td class="font-semibold">${a.title || '未命名'}</td>
                <td>${a.type === 'popup' ? '弹窗' : '侧边栏'}</td>
                <td><span class="badge ${a.enabled ? 'badge-approved' : 'badge-pending'}">${a.enabled ? '启用' : '禁用'}</span></td>
                <td class="text-sm text-muted">${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" style="color:var(--accent-red)" data-delete-ad="${a.id}">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    el.querySelectorAll('[data-delete-ad]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await modal.confirm('确认删除', '确定要删除该广告吗？');
        if (ok) {
          try {
            await api.adminDeleteAd(btn.dataset.deleteAd);
            toast.success('广告已删除');
            loadAds();
          } catch (err) { toast.error(err.message); }
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showNewAdModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-ad-form">
      <div class="form-group">
        <label class="form-label">广告标题</label>
        <input type="text" class="form-input" id="ad-title" placeholder="广告标题" required>
      </div>
      <div class="form-group">
        <label class="form-label">类型</label>
        <select class="form-select" id="ad-type">
          <option value="popup">弹窗广告</option>
          <option value="sidebar">侧边栏广告</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">内容/链接</label>
        <textarea class="form-textarea" id="ad-content" placeholder="广告内容或图片链接" required></textarea>
      </div>
      <div class="form-group flex items-center gap-3">
        <input type="checkbox" id="ad-enabled" checked>
        <label for="ad-enabled" class="form-label" style="margin-bottom:0;">启用</label>
      </div>
    </form>`;

  modal.open({
    title: '创建广告',
    body,
    confirmText: '创建',
    onConfirm: async () => {
      const data = {
        title: document.getElementById('ad-title').value.trim(),
        type: document.getElementById('ad-type').value,
        content: document.getElementById('ad-content').value.trim(),
        enabled: document.getElementById('ad-enabled').checked,
      };
      if (!data.title || !data.content) {
        toast.error('请填写完整信息');
        return;
      }
      try {
        await api.adminCreateAd(data);
        toast.success('广告已创建');
        modal.close();
        loadAds();
      } catch (err) {
        toast.error(err.message || '创建失败');
      }
    },
  });
}
