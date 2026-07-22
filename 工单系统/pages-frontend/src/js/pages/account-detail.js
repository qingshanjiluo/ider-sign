// pages/account-detail.js — 账号详情页（含角色名/灵根/Setup信息）
import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAccountDetail({ container, params }) {
  const accountId = params.id;
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [accountRes, logsRes] = await Promise.all([
      api.getAccount(accountId),
      api.getAccountLogs(accountId),
    ]);

    const account = accountRes.account || accountRes;
    const logsList = (logsRes.logs || logsRes || []);

    const STATUS_MAP = {
      creating: { label: '注册中', class: 'badge-pending' },
      farming: { label: '挂机中', class: 'badge-approved' },
      completed: { label: '已完成', class: 'badge-completed' },
      error: { label: '异常', class: 'badge-rejected' },
      banned: { label: '封禁', class: 'badge-rejected' },
    };
    const st = STATUS_MAP[account.status] || { label: account.status, class: '' };

    const roots = parseSpiritRoots(account.spirit_roots);
    const rootLabels = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' };

    container.innerHTML = `
      <div class="page-header">
        <div class="flex justify-between items-center">
          <div>
            <h2>账号详情</h2>
            <p>${account.character_name || account.username || accountId}</p>
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
          <div class="stat-label">Setup状态</div>
          <div class="stat-value"><span class="badge ${getSetupClass(account.setup_status)}">${getSetupLabel(account.setup_status)}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">等级</div>
          <div class="stat-value">Lv.${account.level || '-'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">订单号</div>
          <div class="stat-value font-mono text-sm">#${account.order_id || '-'}</div>
        </div>
      </div>

      <div class="card mb-6">
        <div class="card-header"><h3>账号信息</h3></div>
        <div style="padding:var(--space-4);">
          <div class="grid grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><span class="text-muted text-sm">游戏账号:</span> <span class="font-mono">${account.username || '-'}</span></div>
            <div><span class="text-muted text-sm">角色名:</span> <span class="font-semibold">${account.character_name || '-'}</span></div>
            <div><span class="text-muted text-sm">操作人:</span> <span>${account.operator_name || '-'}</span></div>
            ${roots ? `
            <div style="grid-column:1/-1;">
              <span class="text-muted text-sm">灵根配置:</span>
              <div style="display:flex;gap:16px;margin-top:8px;">
                ${Object.entries(roots).filter(([, v]) => v > 0).map(([k, v]) => `
                  <div style="display:flex;flex-direction:column;align-items:center;">
                    <div style="font-size:24px;font-weight:700;color:${getRootColor(k)}">${v}</div>
                    <div class="text-xs text-muted">${rootLabels[k] || k}</div>
                  </div>
                `).join('')}
                ${Object.values(roots).every(v => v === 0) ? '<span class="text-muted">未设置</span>' : ''}
              </div>
            </div>` : ''}
            ${account.created_result ? `
            <div style="grid-column:1/-1;">
              <span class="text-muted text-sm">创建结果:</span>
              <pre style="background:var(--bg-elevated);padding:8px;border-radius:4px;font-size:var(--text-xs);margin-top:4px;overflow-x:auto;">${formatResult(account.created_result)}</pre>
            </div>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>操作日志</h3>
        </div>
        <div id="account-logs">
          ${logsList.map(l => `
            <div style="padding:var(--space-3) 0;border-bottom:1px solid var(--border-light);">
              <div class="flex justify-between items-center">
                <span class="text-sm font-semibold">${l.log_type || l.action || '操作'}</span>
                <span class="text-xs text-muted">${new Date(l.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <p class="text-sm text-muted mt-1">${l.message || l.detail || l.description || ''}</p>
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

function parseSpiritRoots(str) {
  if (!str) return null;
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str;
    if (parsed && typeof parsed === 'object' && ('metal' in parsed || 'wood' in parsed)) return parsed;
    return null;
  } catch { return null; }
}

function getRootColor(key) {
  const colors = { metal: '#FFD700', wood: '#4CAF50', water: '#2196F3', fire: '#FF5722', earth: '#795548' };
  return colors[key] || '#999';
}

function getSetupClass(status) {
  const map = { pending: 'badge-pending', creating: 'badge-pending', running: 'badge-approved', done: 'badge-completed', error: 'badge-rejected' };
  return map[status] || 'badge-pending';
}

function getSetupLabel(status) {
  const map = { pending: '待Setup', creating: '创建中', running: '进行中', skills: '技能', iron_sword: '铁剑', technique: '功法', map: '地图', battle: '战斗', done: '已完成', error: '异常' };
  return map[status] || status || '-';
}

function formatResult(str) {
  if (!str) return '-';
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str;
    return JSON.stringify(parsed, null, 2);
  } catch { return str; }
}
