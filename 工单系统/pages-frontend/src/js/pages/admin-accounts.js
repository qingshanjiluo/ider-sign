import { api } from '../api.js';
import { toast } from '../components/toast.js';

let _pollTimer = null;

function fmtDate(d) {
  if (!d) return '-';
  const dt = typeof d === 'string' ? d.replace(' ', 'T') : d;
  const date = new Date(dt);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

const STATUS_MAP = {
  creating: { label: '注册中', class: 'badge-pending' },
  farming: { label: '挂机中', class: 'badge-approved' },
  completed: { label: '已完成', class: 'badge-completed' },
  error: { label: '异常', class: 'badge-rejected' },
  banned: { label: '封禁', class: 'badge-rejected' },
  failed: { label: '失败', class: 'badge-rejected' },
};

const SETUP_MAP = {
  pending: { label: '待Setup', class: 'badge-pending' },
  creating: { label: '创建中', class: 'badge-pending' },
  running: { label: '进行中', class: 'badge-approved' },
  skills: { label: '技能', class: 'badge-approved' },
  iron_sword: { label: '铁剑', class: 'badge-approved' },
  technique: { label: '功法', class: 'badge-approved' },
  map: { label: '地图', class: 'badge-approved' },
  battle: { label: '战斗', class: 'badge-approved' },
  done: { label: '已完成', class: 'badge-completed' },
  error: { label: '异常', class: 'badge-rejected' },
};

const SETUP_MAP = {
  pending: { label: '待Setup', class: 'badge-pending' },
  creating: { label: '创建中', class: 'badge-pending' },
  running: { label: '进行中', class: 'badge-approved' },
  skills: { label: '技能', class: 'badge-approved' },
  iron_sword: { label: '铁剑', class: 'badge-approved' },
  technique: { label: '功法', class: 'badge-approved' },
  map: { label: '地图', class: 'badge-approved' },
  battle: { label: '战斗', class: 'badge-approved' },
  done: { label: '已完成', class: 'badge-completed' },
  error: { label: '异常', class: 'badge-rejected' },
};

export async function renderAdminAccounts({ container }) {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  container.innerHTML = `
    <div class="page-header">
      <h2>账号管理</h2>
      <p>所有账号实时状态（自动刷新）</p>
    </div>
    <div class="text-xs text-muted mb-2" style="text-align:right;">上次更新: ${fmtDate(new Date().toISOString())}</div>
    <div class="filter-bar">
      <select class="form-select" id="admin-account-status">
        <option value="">全部状态</option>
        <option value="creating">注册中</option>
        <option value="farming">挂机中</option>
        <option value="completed">已完成</option>
        <option value="error">异常</option>
        <option value="banned">封禁</option>
        <option value="failed">失败</option>
      </select>
      <select class="form-select" id="admin-account-setup">
        <option value="">全部Setup</option>
        <option value="pending">待Setup</option>
        <option value="creating">创建中</option>
        <option value="running">进行中</option>
        <option value="done">已完成</option>
        <option value="error">异常</option>
      </select>
      <select class="form-select" id="admin-account-setup">
        <option value="">全部Setup</option>
        <option value="pending">待Setup</option>
        <option value="creating">创建中</option>
        <option value="running">进行中</option>
        <option value="done">已完成</option>
        <option value="error">异常</option>
      </select>
    </div>
    <div id="admin-accounts-list">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  document.getElementById('admin-account-status').addEventListener('change', () => loadAccounts());
  document.getElementById('admin-account-setup').addEventListener('change', () => loadAccounts());
  await loadAccounts();

  _pollTimer = setInterval(loadAccounts, 20000);
}

async function loadAccounts() {
  const el = document.getElementById('admin-accounts-list');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetAccounts();
    let accounts = res.accounts || res || [];

    const statusFilter = document.getElementById('admin-account-status')?.value || '';
    const setupFilter = document.getElementById('admin-account-setup')?.value || '';
    if (statusFilter) accounts = accounts.filter(a => a.status === statusFilter);
    if (setupFilter) accounts = accounts.filter(a => a.setup_status === setupFilter);

    if (!accounts.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无账号</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>游戏账号</th>
              <th>角色名</th>
              <th>灵根</th>
              <th>状态</th>
              <th>Setup</th>
              <th>等级</th>
              <th>用户</th>
              <th>操作人</th>
              <th>订单号</th>
              <th>错误信息</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            ${accounts.map(a => {
              const st = STATUS_MAP[a.status] || { label: a.status, class: '' };
              const setup = SETUP_MAP[a.setup_status] || { label: a.setup_status || '待Setup', class: 'badge-pending' };
              const roots = parseSpiritRoots(a.spirit_roots);
              const rootDesc = roots ? Object.entries(roots)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${'金木水火土'['metalwoodwaterfireearth'.indexOf(k) >= 0 ? Math.floor('metalwoodwaterfireearth'.indexOf(k) / 5) : 0]}${v}`)
                .join(' ') : '-';
              return `
                <tr>
                  <td class="font-mono text-xs">${a.id}</td>
                  <td class="font-mono text-xs">${a.username || '-'}</td>
                  <td class="font-semibold">${a.character_name || '-'}</td>
                  <td class="text-xs">${rootDesc || '-'}</td>
                  <td><span class="badge ${st.class}">${st.label}</span></td>
                  <td><span class="badge ${setup.class}">${setup.label}</span></td>
                  <td>Lv.${a.level || '-'}</td>
                  <td class="text-xs">${a.user_name || a.user_id || '-'}</td>
                  <td class="text-xs text-muted">${a.operator_name || '-'}</td>
                  <td class="font-mono text-xs">${a.order_id ? '#' + a.order_id : '-'}</td>
                  <td class="text-xs" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;color:${a.error_msg ? 'var(--accent-red)' : 'inherit'}">${a.error_msg || '-'}</td>
                  <td class="text-sm text-muted">${fmtDate(a.last_check_at || a.created_at)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
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
