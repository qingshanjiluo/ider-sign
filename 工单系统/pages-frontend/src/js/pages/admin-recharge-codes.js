// pages/admin-recharge-codes.js — 兑换码管理
import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAdminRechargeCodes({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [allRes, pendingRes] = await Promise.all([
      api.adminGetRechargeCodes(),
      api.adminGetRechargeCodes('pending'),
    ]);
    const codes = allRes.codes || [];
    const pendingCount = pendingRes.total || 0;

    container.innerHTML = `
      <div class="page-header">
        <h2>兑换码管理</h2>
        <p>共 ${allRes.total || 0} 个兑换码，待使用 ${pendingCount} 个</p>
      </div>

      <!-- 批量生成 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>批量生成兑换码</h3>
        </div>
        <div class="flex items-center gap-3" style="flex-wrap:wrap;">
          <div class="form-group" style="flex:1;min-width:120px;">
            <label class="form-label">修仙币数量</label>
            <input type="number" class="form-input" id="gen-coins" value="100" min="1" style="max-width:140px;">
          </div>
          <div class="form-group" style="flex:1;min-width:100px;">
            <label class="form-label">生成数量（1-100）</label>
            <input type="number" class="form-input" id="gen-count" value="1" min="1" max="100" style="max-width:120px;">
          </div>
          <button class="btn btn-primary" id="gen-codes-btn" style="margin-top:18px;">批量生成</button>
        </div>
        <p class="text-xs text-muted mt-2">生成的兑换码可复制后直接发给用户，用户在坊市或充值页输入即可激活修仙币</p>
      </div>

      <!-- 筛选 -->
      <div class="flex items-center gap-3 mb-4">
        <select class="form-input" id="code-status-filter" style="max-width:160px;">
          <option value="">全部状态</option>
          <option value="pending">待使用</option>
          <option value="used">已使用</option>
          <option value="expired">已过期</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="refresh-codes-btn">刷新</button>
      </div>

      <!-- 兑换码列表 -->
      <div id="codes-list">
        ${renderCodesTable(codes)}
      </div>`;

    // 批量生成
    document.getElementById('gen-codes-btn')?.addEventListener('click', async () => {
      const coins = parseInt(document.getElementById('gen-coins').value);
      const count = parseInt(document.getElementById('gen-count').value);
      if (!coins || coins <= 0) return toast.error('修仙币数量必须大于0');
      if (!count || count < 1 || count > 100) return toast.error('生成数量范围1-100');
      if (!confirm(`确认生成 ${count} 个 ${coins} 修仙币的兑换码？`)) return;
      try {
        const res = await api.adminCreateRechargeCodes({ count, coins });
        toast.success(res.message);
        // 显示生成的码
        if (res.codes && res.codes.length) {
          const codesStr = res.codes.join('\n');
          if (confirm(`生成的兑换码（已复制到剪贴板）：\n${codesStr}\n\n点击确定刷新列表`)) {
            navigator.clipboard?.writeText(codesStr).catch(() => {});
            renderAdminRechargeCodes({ container });
          }
        }
        renderAdminRechargeCodes({ container });
      } catch (err) {
        toast.error(err.message || '生成失败');
      }
    });

    // 筛选
    document.getElementById('code-status-filter')?.addEventListener('change', async () => {
      const status = document.getElementById('code-status-filter').value;
      try {
        const res = await api.adminGetRechargeCodes(status || undefined);
        document.getElementById('codes-list').innerHTML = renderCodesTable(res.codes || []);
        bindCodeActions();
      } catch { /* ignore */ }
    });

    // 刷新
    document.getElementById('refresh-codes-btn')?.addEventListener('click', () => {
      renderAdminRechargeCodes({ container });
    });

    // 绑定操作按钮
    bindCodeActions();

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderCodesTable(codes) {
  if (!codes.length) return '<div class="card"><p class="text-muted text-sm" style="text-align:center;padding:24px;">暂无兑换码</p></div>';

  return `
    <div class="card">
      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead><tr><th>兑换码</th><th>修仙币</th><th>状态</th><th>归属用户</th><th>使用人</th><th>使用时间</th><th>创建时间</th><th>创建人</th><th>操作</th></tr></thead>
          <tbody>
            ${codes.map(c => {
              const statusLabel = c.status === 'pending' ? '待使用' : c.status === 'used' ? '已使用' : '已过期';
              const statusClass = c.status === 'pending' ? 'badge-pending' : c.status === 'used' ? 'badge-approved' : 'badge-cancelled';
              return `
                <tr>
                  <td><code style="background:var(--bg-base);padding:2px 8px;border-radius:4px;font-size:13px;letter-spacing:1.5px;font-weight:600;">${c.code}</code></td>
                  <td style="color:var(--accent-amber);font-weight:600;">${c.coins}</td>
                  <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                  <td class="text-sm">${c.user_name || (c.user_id > 0 ? '用户#' + c.user_id : '无归属')}</td>
                  <td class="text-sm">${c.used_by > 0 ? (c._used_name || '用户#' + c.used_by) : '-'}</td>
                  <td class="text-sm">${c.used_at ? c.used_at.split(' ')[0] : '-'}</td>
                  <td class="text-sm">${c.created_at ? c.created_at.split(' ')[0] : '-'}</td>
                  <td class="text-sm">${c.creator_name || '-'}</td>
                  <td>
                    <button class="btn btn-sm btn-ghost" data-copy-code="${c.code}">复制</button>
                    ${c.status === 'pending' ? `<button class="btn btn-sm btn-ghost" style="color:var(--accent-red);" data-delete-code="${c.id}">删除</button>` : ''}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function bindCodeActions() {
  // 复制
  document.querySelectorAll('[data-copy-code]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.copyCode;
      navigator.clipboard?.writeText(code).then(() => {
        toast.success('已复制: ' + code);
      }).catch(() => {
        toast.error('复制失败，请手动复制');
      });
    });
  });

  // 删除
  document.querySelectorAll('[data-delete-code]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = parseInt(el.dataset.deleteCode);
      if (!confirm('确认删除此兑换码？')) return;
      try {
        await api.adminDeleteRechargeCode(id);
        toast.success('已删除');
        el.closest('tr')?.remove();
      } catch (err) {
        toast.error(err.message || '删除失败');
      }
    });
  });
}
