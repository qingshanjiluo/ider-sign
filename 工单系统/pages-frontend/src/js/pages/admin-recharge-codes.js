// pages/admin-recharge-codes.js — 兑换码管理（支持多次使用）
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
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="flex:1;min-width:120px;">
            <label class="form-label">价值（元）</label>
            <input type="number" class="form-input" id="gen-coins" value="0.25" min="0.01" step="0.01" style="max-width:140px;">
          </div>
          <div class="form-group" style="flex:1;min-width:100px;">
            <label class="form-label">生成数量（1-100）</label>
            <input type="number" class="form-input" id="gen-count" value="1" min="1" max="100" style="max-width:120px;">
          </div>
          <div class="form-group" style="flex:1;min-width:120px;">
            <label class="form-label">使用次数</label>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="number" class="form-input" id="gen-max-uses" value="1" min="0" style="max-width:100px;">
              <span class="text-xs text-muted">0=无限次</span>
            </div>
          </div>
          <button class="btn btn-primary" id="gen-codes-btn" style="margin-bottom:18px;">批量生成</button>
        </div>
        <p class="text-xs text-muted mt-2">使用次数：1=一次性码（默认），0=无限次码（所有人可用），N=最多N人使用。每个用户每个码只能用一次。</p>
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
      const yuan = parseFloat(document.getElementById('gen-coins').value);
      const count = parseInt(document.getElementById('gen-count').value);
      const max_uses = parseInt(document.getElementById('gen-max-uses').value) || 1;
      if (!yuan || yuan <= 0) return toast.error('价值必须大于0');
      const coins = Math.round(yuan * 400);
      if (!count || count < 1 || count > 100) return toast.error('生成数量范围1-100');
      if (max_uses < 0) return toast.error('使用次数不能为负数');
      
      const useDesc = max_uses === 0 ? '无限次' : max_uses + '次';
      if (!confirm(`确认生成 ${count} 个 ¥${yuan.toFixed(2)}（${coins}修仙币）的兑换码（每个码可用 ${useDesc}）？`)) return;
      try {
        const res = await api.adminCreateRechargeCodes({ count, coins, max_uses });
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
          <thead><tr>
            <th>兑换码</th>
            <th>价值</th>
            <th>使用次数</th>
            <th>状态</th>
            <th>归属用户</th>
            <th>创建时间</th>
            <th>创建人</th>
            <th>操作</th>
          </tr></thead>
          <tbody>
            ${codes.map(c => {
              const statusLabel = c.status === 'pending' ? '待使用' : c.status === 'used' ? '已使用' : '已过期';
              const statusClass = c.status === 'pending' ? 'badge-pending' : c.status === 'used' ? 'badge-approved' : 'badge-cancelled';
              const maxUses = c.max_uses || 0;
              const usedCount = c.used_count || 0;
              let usesDisplay = '';
              if (maxUses === 0) {
                usesDisplay = `<span style="color:var(--accent-green);" title="无限次使用">∞</span> <span class="text-xs text-muted">已用 ${usedCount}</span>`;
              } else if (maxUses === 1) {
                usesDisplay = `<span class="text-xs">1次（一次性）</span>`;
              } else {
                const remaining = Math.max(0, maxUses - usedCount);
                const color = remaining <= 1 ? 'var(--accent-red)' : 'var(--accent-green)';
                usesDisplay = `<span style="color:${color};">${usedCount}/${maxUses}</span>`;
              }
              return `
                <tr>
                  <td><code style="background:var(--bg-base);padding:2px 8px;border-radius:4px;font-size:13px;letter-spacing:1.5px;font-weight:600;">${c.code}</code></td>
                  <td style="color:var(--accent-amber);font-weight:600;">¥${(c.coins / 400).toFixed(2)}</td>
                  <td>
                    ${usesDisplay}
                    ${c.status === 'pending' && maxUses > 1 ? `<button class="btn btn-xs btn-ghost" style="font-size:11px;margin-left:4px;" data-edit-max-uses="${c.id}" data-current-max="${maxUses}">编辑</button>` : ''}
                  </td>
                  <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                  <td class="text-sm">${c.user_name || (c.user_id > 0 ? '用户#' + c.user_id : '无归属')}</td>
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

  // 编辑使用次数上限
  document.querySelectorAll('[data-edit-max-uses]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = parseInt(el.dataset.editMaxUses);
      const currentMax = parseInt(el.dataset.currentMax);
      const newMax = prompt('设置新的使用次数上限（0=无限次，当前=' + currentMax + '）：', currentMax);
      if (newMax === null) return;
      const maxUses = parseInt(newMax);
      if (isNaN(maxUses) || maxUses < 0) return toast.error('请输入有效的数字（0=无限次）');
      try {
        await api.adminUpdateRechargeCode(id, { max_uses: maxUses });
        toast.success('使用次数已更新');
        // 刷新当前页面
        const codesList = document.getElementById('codes-list');
        const statusFilter = document.getElementById('code-status-filter')?.value || '';
        const res = await api.adminGetRechargeCodes(statusFilter || undefined);
        codesList.innerHTML = renderCodesTable(res.codes || []);
        bindCodeActions();
      } catch (err) {
        toast.error(err.message || '更新失败');
      }
    });
  });
}
