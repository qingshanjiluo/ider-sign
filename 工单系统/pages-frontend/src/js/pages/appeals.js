// pages/appeals.js — 申诉中心

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const STATUS_MAP = {
  pending: { label: '待处理', class: 'badge-pending' },
  approved: { label: '已通过', class: 'badge-approved' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
};

export async function renderAppeals({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <div class="flex justify-between items-center">
        <div>
          <h2>申诉中心</h2>
          <p>提交账号封禁或订单问题申诉</p>
        </div>
        <button class="btn btn-primary" id="new-appeal-btn">+ 提交申诉</button>
      </div>
    </div>
    <div id="appeals-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('new-appeal-btn').addEventListener('click', showNewAppealModal);
  loadAppeals();
}

async function loadAppeals() {
  const el = document.getElementById('appeals-list');
  if (!el) return;
  try {
    const res = await api.getAppeals();
    const appeals = res.appeals || res || [];

    if (!appeals.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无申诉记录</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>类型</th><th>状态</th><th>内容</th><th>创建时间</th></tr>
          </thead>
          <tbody>
            ${appeals.map(a => {
              const st = STATUS_MAP[a.status] || { label: a.status, class: '' };
              return `
                <tr>
                  <td class="font-mono text-xs">#${a.id}</td>
                  <td>${a.type || '账号问题'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td class="text-sm" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.content || ''}</td>
                  <td class="text-sm text-muted">${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function showNewAppealModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="new-appeal-form">
      <div class="form-group">
        <label class="form-label">申诉类型</label>
        <select class="form-select" id="appeal-type">
          <option value="账号封禁">账号封禁</option>
          <option value="订单问题">订单问题</option>
          <option value="积分异常">积分异常</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">详细描述</label>
        <textarea class="form-textarea" id="appeal-content" placeholder="请详细描述你遇到的问题..." required></textarea>
      </div>
    </form>`;

  modal.open({
    title: '提交申诉',
    body,
    confirmText: '提交',
    onConfirm: async () => {
      const type = document.getElementById('appeal-type').value;
      const content = document.getElementById('appeal-content').value.trim();
      if (!content) {
        toast.error('请填写申诉内容');
        return;
      }
      try {
        await api.createAppeal({ type, content });
        toast.success('申诉已提交');
        modal.close();
        loadAppeals();
      } catch (err) {
        toast.error(err.message || '提交失败');
      }
    },
  });
}
