// pages/account-detail.js — 账号详情页

import { api } from '../api.js';

export async function renderAccountDetail({ container, params }) {
  const accountId = params.id;
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [account, logs] = await Promise.all([
      api.getAccount(accountId),
      api.getAccountLogs(accountId),
    ]);

    const STATUS_MAP = {
      creating: { label: '注册中', class: 'badge-pending' },
      farming: { label: '挂机中', class: 'badge-approved' },
      completed: { label: '已完成', class: 'badge-completed' },
      error: { label: '异常', class: 'badge-rejected' },
      banned: { label: '封禁', class: 'badge-rejected' },
    };
    const st = STATUS_MAP[account.status] || { label: account.status, class: '' };

    container.innerHTML = `
      <div class="page-header">
        <div class="flex justify-between items-center">
          <div>
            <h2>账号详情</h2>
            <p>${account.game_username || account.username || accountId}</p>
          </div>
          <a href="#/accounts" class="btn btn-secondary">← 返回列表</a>
        </div>
      </div>

      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">状态</div>
          <div class="stat-value"><span class="badge ${st.class}">${st.label}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">等级</div>
          <div class="stat-value">Lv.${account.level || '-'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">订单号</div>
          <div class="stat-value font-mono text-sm">#${account.order_id || '-'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">更新时间</div>
          <div class="stat-value text-sm">${new Date(account.updated_at).toLocaleString('zh-CN')}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>操作日志</h3>
        </div>
        <div id="account-logs">
          ${(logs.logs || logs || []).map(l => `
            <div style="padding:var(--space-3) 0;border-bottom:1px solid var(--border-light);">
              <div class="flex justify-between items-center">
                <span class="text-sm font-semibold">${l.action || '操作'}</span>
                <span class="text-xs text-muted">${new Date(l.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <p class="text-sm text-muted mt-1">${l.detail || l.message || ''}</p>
            </div>
          `).join('') || '<div class="empty-state"><p>暂无日志</p></div>'}
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败: ${err.message}</p>
        <a href="#/accounts" class="btn btn-secondary mt-4">返回列表</a>
      </div>`;
  }
}
