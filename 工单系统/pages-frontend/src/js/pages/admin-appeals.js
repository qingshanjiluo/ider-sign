// pages/admin-appeals.js — 管理后台 - 申诉管理

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const STATUS_MAP = {
  pending: { label: '待处理', class: 'badge-pending' },
  approved: { label: '已通过', class: 'badge-approved' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
};

export async function renderAdminAppeals({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <h2>申诉管理</h2>
      <p>处理用户申诉</p>
    </div>
    <div class="filter-bar">
      <select class="form-select" id="admin-appeal-status">
        <option value="">全部状态</option>
        <option value="pending">待处理</option>
        <option value="approved">已通过</option>
        <option value="rejected">已拒绝</option>
      </select>
    </div>
    <div id="admin-appeals-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('admin-appeal-status').addEventListener('change', (e) => loadAppeals(e.target.value));
  loadAppeals();
}

async function loadAppeals(status = '') {
  const el = document.getElementById('admin-appeals-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetAppeals(status);
    const appeals = res.appeals || res || [];

    if (!appeals.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无申诉</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>用户</th><th>类型</th><th>状态</th><th>内容</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${appeals.map(a => {
              const st = STATUS_MAP[a.status] || { label: a.status, class: '' };
              return `
                <tr>
                  <td class="font-mono text-xs">#${a.id}</td>
                  <td>${a.username || a.user_id || '-'}</td>
                  <td>${a.type || '账号问题'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td class="text-sm" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.content || ''}</td>
                  <td class="text-sm text-muted">${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-reply-appeal="${a.id}">回复</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    el.querySelectorAll('[data-reply-appeal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const appealId = btn.dataset.replyAppeal;
        const appeal = appeals.find(a => String(a.id) === String(appealId));
        showReplyModal(appeal);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showReplyModal(appeal) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="mb-4">
      <p class="text-sm text-muted">用户申诉内容:</p>
      <p class="mt-2">${appeal?.content || ''}</p>
    </div>
    <div class="form-group">
      <label class="form-label">回复内容</label>
      <textarea class="form-textarea" id="appeal-reply" placeholder="输入回复..." rows="3"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">处理结果</label>
      <select class="form-select" id="appeal-status">
        <option value="approved">通过</option>
        <option value="rejected">拒绝</option>
      </select>
    </div>`;

  modal.open({
    title: '处理申诉',
    body,
    confirmText: '提交',
    onConfirm: async () => {
      const reply = document.getElementById('appeal-reply').value.trim();
      const status = document.getElementById('appeal-status').value;
      if (!reply) {
        toast.error('请输入回复内容');
        return;
      }
      try {
        await api.adminReplyAppeal(appeal.id, reply, status);
        toast.success('回复已提交');
        modal.close();
        loadAppeals();
      } catch (err) {
        toast.error(err.message || '提交失败');
      }
    },
  });
}
