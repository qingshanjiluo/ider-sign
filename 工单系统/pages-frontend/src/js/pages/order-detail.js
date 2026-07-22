// pages/order-detail.js — 工单详情页（含管理员角色创建面板）
// 参考批量注册工具工作流：创建角色→设置灵根→技能→铁剑→功法→地图→战斗

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { store } from '../store.js';
import { modal } from '../components/modal.js';

const STATUS_MAP = {
  pending: { label: '待审批', class: 'badge-pending' },
  approved: { label: '进行中', class: 'badge-approved' },
  completed: { label: '已完成', class: 'badge-completed' },
  rejected: { label: '已拒绝', class: 'badge-rejected' },
  cancelled: { label: '已取消', class: 'badge-pending' },
};

function formatDetailPrice(order) {
  const price = order.total_price || order.price || 0;
  const method = order.payment_method;
  let display = '';
  if (method === 'coin') display = `${price} 修仙币`;
  else if (method === 'spirit_stone') display = `${price} 万灵石`;
  else display = `¥${price.toFixed(2)}`;
  const discount = order.discount || 0;
  if (discount > 0) display += ` (优惠${discount}%)`;
  return display;
}

// 灵根配置预设（参考批量注册工具 spiritRoots 配置）
const SPIRIT_ROOT_PRESETS = [
  { name: '单金灵根(100)', roots: { metal: 100, wood: 0, water: 0, fire: 0, earth: 0 } },
  { name: '平均分配(各20)', roots: { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 } },
  { name: '金火(50+50)', roots: { metal: 50, wood: 0, water: 0, fire: 50, earth: 0 } },
  { name: '金木(50+50)', roots: { metal: 50, wood: 50, water: 0, fire: 0, earth: 0 } },
  { name: '全灵根(各10)', roots: { metal: 10, wood: 10, water: 10, fire: 10, earth: 10 } },
  { name: '自定义', roots: null },
];

export async function renderOrderDetail({ container, params }) {
  const orderId = params.id;
  const user = store.getUser();
  const isAdmin = user?.is_admin === 1 || user?.role === 'admin' || user?.role === 'super_admin';

  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [orderRes, activitiesRes] = await Promise.all([
      api.getOrder(orderId),
      api.getOrderActivities(orderId),
    ]);

    const order = orderRes.order || orderRes;
    const activitiesList = (activitiesRes.activities || activitiesRes || []);
    const status = STATUS_MAP[order.status] || { label: order.status, class: '' };

    container.innerHTML = `
      <div class="page-header">
        <div class="flex justify-between items-center">
          <div>
            <h2>工单 #${order.id}</h2>
            <p>${order.order_type || '代练'} · ${status.label}</p>
          </div>
          <div class="flex gap-2">
            ${isAdmin ? `<button class="btn btn-primary btn-sm" id="btn-create-account">+ 创建角色</button>` : ''}
            <a href="#/orders" class="btn btn-secondary">← 返回列表</a>
          </div>
        </div>
      </div>

      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">状态</div>
          <div class="stat-value"><span class="badge ${status.class}">${status.label}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">金额</div>
          <div class="stat-value">${formatDetailPrice(order)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">账号数</div>
          <div class="stat-value">${order.account_count || order.quantity || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已创建角色</div>
          <div class="stat-value">${order.total_accounts_created || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">创建时间</div>
          <div class="stat-value text-sm">${new Date(order.created_at).toLocaleString('zh-CN')}</div>
        </div>
      </div>

      ${order.game_account_name ? `
      <div class="card mb-6">
        <div class="card-header"><h3>用户提供的账号信息</h3></div>
        <div style="padding:var(--space-4);">
          <div class="grid grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><span class="text-muted text-sm">游戏账号:</span> <span class="font-mono">${order.game_account_name}</span></div>
            <div><span class="text-muted text-sm">游戏密码:</span> <span class="font-mono">${order.game_account_password ? '******' : '-'}</span></div>
          </div>
        </div>
      </div>` : ''}

      <div class="card mb-6" id="order-accounts">
        <div class="card-header">
          <h3>关联账号</h3>
          ${order.total_accounts_created > 0 ? `<span class="text-sm text-muted">已创建 ${order.total_accounts_created} 个</span>` : ''}
        </div>
        <div class="loading"><div class="spinner"></div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>操作日志</h3>
        </div>
        <div id="order-activities">
          ${activitiesList.map(a => `
            <div style="padding:var(--space-3) 0;border-bottom:1px solid var(--border-light);">
              <div class="flex justify-between items-center">
                <span class="text-sm font-semibold">${a.action || a.type || '操作'}</span>
                <span class="text-xs text-muted">${new Date(a.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <p class="text-sm text-muted mt-1">${a.detail || a.description || ''}</p>
            </div>
          `).join('') || '<div class="empty-state"><p>暂无日志</p></div>'}
        </div>
      </div>`;

    // 绑定创建角色按钮
    if (isAdmin) {
      document.getElementById('btn-create-account')?.addEventListener('click', () => showCreateAccountModal(orderId));
    }

    loadOrderAccounts(orderId, isAdmin);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p>加载失败: ${err.message}</p>
        <a href="#/orders" class="btn btn-secondary mt-4">返回列表</a>
      </div>`;
  }
}

// ── 管理员：创建角色弹窗（角色名 + 灵根选择） ──
function showCreateAccountModal(orderId) {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="create-account-form">
      <div class="form-group">
        <label class="form-label">游戏账号名 <span style="color:var(--accent-red)">*</span></label>
        <input type="text" class="form-input" id="ca-username" placeholder="输入游戏登录账号" required>
      </div>
      <div class="form-group">
        <label class="form-label">游戏账号密码 <span style="color:var(--accent-red)">*</span></label>
        <input type="password" class="form-input" id="ca-password" placeholder="输入游戏登录密码" required>
      </div>
      <div class="form-group">
        <label class="form-label">角色名（游戏内名称）<span style="color:var(--accent-red)">*</span></label>
        <input type="text" class="form-input" id="ca-character-name" placeholder="例如: 修仙者001" required>
        <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:4px;">创建角色时将使用此名称</div>
      </div>
      <div class="form-group">
        <label class="form-label">灵根预设</label>
        <select class="form-select" id="ca-preset">
          ${SPIRIT_ROOT_PRESETS.map((p, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="ca-custom-roots" style="display:none;">
        <label class="form-label">自定义灵根（总和不超过100）</label>
        <div class="grid grid-5" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
          <div><label class="form-label" style="font-size:var(--text-xs);">金</label><input type="number" class="form-input" data-root="metal" value="20" min="0" max="100"></div>
          <div><label class="form-label" style="font-size:var(--text-xs);">木</label><input type="number" class="form-input" data-root="wood" value="20" min="0" max="100"></div>
          <div><label class="form-label" style="font-size:var(--text-xs);">水</label><input type="number" class="form-input" data-root="water" value="20" min="0" max="100"></div>
          <div><label class="form-label" style="font-size:var(--text-xs);">火</label><input type="number" class="form-input" data-root="fire" value="20" min="0" max="100"></div>
          <div><label class="form-label" style="font-size:var(--text-xs);">土</label><input type="number" class="form-input" data-root="earth" value="20" min="0" max="100"></div>
        </div>
        <div id="ca-roots-total" style="font-size:var(--text-xs);margin-top:4px;">总和: <span id="ca-total-value">100</span></div>
      </div>
    </form>`;

  modal.open({
    title: '创建角色',
    body,
    confirmText: '创建',
    width: '560px',
    onConfirm: async () => {
      const username = document.getElementById('ca-username')?.value.trim();
      const password = document.getElementById('ca-password')?.value.trim();
      const charName = document.getElementById('ca-character-name')?.value.trim();
      const presetIdx = parseInt(document.getElementById('ca-preset')?.value);

      if (!username || !password || !charName) {
        toast.error('请填写完整信息'); return;
      }

      // 获取灵根配置
      let spiritRoots;
      if (presetIdx >= 0 && SPIRIT_ROOT_PRESETS[presetIdx]?.roots) {
        spiritRoots = SPIRIT_ROOT_PRESETS[presetIdx].roots;
      } else {
        spiritRoots = {};
        document.querySelectorAll('[data-root]').forEach(input => {
          spiritRoots[input.dataset.root] = parseInt(input.value) || 0;
        });
        const total = Object.values(spiritRoots).reduce((a, b) => a + b, 0);
        if (total > 100) { toast.error('灵根总和不能超过100'); return; }
      }

      try {
        const res = await api.post(`/admin/orders/${orderId}/create-account`, {
          username,
          password,
          character_name: charName,
          spirit_roots: spiritRoots,
        });
        toast.success(res.message || '角色创建成功');
        modal.close();

        // 刷新账号列表
        const orderRes = await api.getOrder(orderId);
        const accounts = (orderRes.accounts || []);
        const accountsEl = document.getElementById('order-accounts');
        if (accountsEl) {
          renderAccountsTable(accountsEl, accounts, true);
        }
      } catch (err) {
        toast.error(err.message || '创建失败');
      }
    },
  });

  // 灵根预设切换
  body.querySelector('#ca-preset').addEventListener('change', (e) => {
    const idx = parseInt(e.target.value);
    const preset = SPIRIT_ROOT_PRESETS[idx];
    const customEl = document.getElementById('ca-custom-roots');
    if (preset && !preset.roots) {
      customEl.style.display = 'block';
      updateRootsTotal();
    } else {
      customEl.style.display = 'none';
    }
  });

  // 自定义灵根实时计算总和
  body.querySelectorAll('[data-root]').forEach(input => {
    input.addEventListener('input', updateRootsTotal);
  });

  function updateRootsTotal() {
    let total = 0;
    document.querySelectorAll('[data-root]').forEach(input => {
      total += parseInt(input.value) || 0;
    });
    const el = document.getElementById('ca-total-value');
    if (el) {
      el.textContent = total;
      el.style.color = total > 100 ? 'var(--accent-red)' : 'var(--accent-green)';
    }
  }
}

// ── 加载并渲染关联账号列表 ──
async function loadOrderAccounts(orderId, isAdmin) {
  const el = document.getElementById('order-accounts');
  if (!el) return;
  try {
    const res = await api.getAccounts(orderId);
    const accounts = res.accounts || res || [];
    renderAccountsTable(el, accounts, isAdmin);
  } catch {
    el.innerHTML = `<div class="card-header"><h3>关联账号</h3></div><p class="text-muted text-sm" style="padding:var(--space-4);">暂无关联账号</p>`;
  }
}

function renderAccountsTable(el, accounts, isAdmin) {
  if (!accounts.length) {
    el.innerHTML = `
      <div class="card-header">
        <h3>关联账号</h3>
      </div>
      <div class="empty-state"><p>暂无关联账号</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="card-header">
      <h3>关联账号 (${accounts.length})</h3>
    </div>
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
            <th>操作人</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          ${accounts.map(a => {
            const roots = parseSpiritRoots(a.spirit_roots);
            const rootDesc = roots ? Object.entries(roots)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${'金木水火土'['metalwoodwaterfireearth'.indexOf(k) >= 0 ? 'metalwoodwaterfireearth'.indexOf(k) / 5 : 0]}${v}`)
              .join(' ') : '-';
            const setupLabel = getSetupLabel(a.setup_status);
            return `
            <tr style="cursor:pointer" onclick="location.hash='#/accounts/${a.id}'">
              <td class="font-mono text-xs">${a.id}</td>
              <td class="font-mono text-xs">${a.username || '-'}</td>
              <td class="font-semibold">${a.character_name || '-'}</td>
              <td class="text-xs">${rootDesc || '-'}</td>
              <td><span class="badge badge-${a.status === 'completed' ? 'completed' : a.status === 'farming' ? 'approved' : a.status === 'creating' ? 'pending' : a.status === 'error' ? 'rejected' : 'pending'}">${a.status || 'pending'}</span></td>
              <td><span class="badge ${setupLabel.class}">${setupLabel.label}</span></td>
              <td>Lv.${a.level || '-'}</td>
              <td class="text-xs text-muted">${a.operator_name || '-'}</td>
              <td class="text-sm text-muted">${a.updated_at ? new Date(a.updated_at).toLocaleDateString('zh-CN') : new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function parseSpiritRoots(str) {
  if (!str) return null;
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str;
    if (parsed && typeof parsed === 'object' && ('metal' in parsed || 'wood' in parsed)) return parsed;
    return null;
  } catch { return null; }
}

function getSetupLabel(setupStatus) {
  const map = {
    pending: { label: '等待', class: 'badge-pending' },
    creating: { label: '创建中', class: 'badge-pending' },
    running: { label: '进行中', class: 'badge-approved' },
    skills: { label: '技能中', class: 'badge-approved' },
    iron_sword: { label: '装备中', class: 'badge-approved' },
    technique: { label: '功法中', class: 'badge-approved' },
    map: { label: '地图中', class: 'badge-approved' },
    battle: { label: '战斗中', class: 'badge-approved' },
    done: { label: '已完成', class: 'badge-completed' },
    error: { label: '异常', class: 'badge-rejected' },
  };
  return map[setupStatus] || { label: setupStatus || '-', class: '' };
}
