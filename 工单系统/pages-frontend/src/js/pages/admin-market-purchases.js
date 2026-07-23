// pages/admin-market-purchases.js — 官方商城购买记录审核
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

const METHOD_LABELS = { coin: '修仙币', wechat: '微信支付', spirit_stone: '灵石' };

export async function renderAdminMarketPurchases({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const status = new URL(location.href).searchParams.get('status') || 'pending';
    const res = await api.adminGetMarketPurchases(status);
    const purchases = res.purchases || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>商城购买审核</h2>
        <p>管理官方商城购买记录</p>
      </div>

      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
        ${['pending','approved','rejected','completed',''].map(s => `
          <a href="#/admin/market-purchases${s ? '?status='+s : ''}"
             class="btn btn-sm ${(status === s || (!status && !s)) ? 'btn-primary' : 'btn-ghost'}">${s ? ({pending:'待审核',approved:'已通过',rejected:'已拒绝',completed:'已完成'})[s] : '全部'}</a>
        `).join('')}
      </div>

      <div class="card">
        ${purchases.length ? `
        <div class="table-wrap"><table class="table" style="width:100%;">
          <thead><tr><th>ID</th><th>用户</th><th>商品</th><th>数量</th><th>总价</th><th>支付</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            ${purchases.map(p => {
              const statusMap = { pending:'待审核', approved:'已通过', rejected:'已拒绝', completed:'已完成' };
              const badgeMap = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-cancelled', completed:'' };
              return `<tr>
                <td>#${p.id}</td>
                <td>${escHtml(p.user_name || '用户#'+p.user_id)}</td>
                <td>${escHtml(p.item_name)}</td>
                <td>x${p.quantity}</td>
                <td style="color:var(--accent-amber)">${p.total_coins} 币</td>
                <td style="font-size:0.82em">${METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                <td><span class="badge ${badgeMap[p.status] || ''}" style="font-size:10px;">${statusMap[p.status] || p.status}</span></td>
                <td style="font-size:0.78em;color:var(--text-dim)">${p.created_at?.split(' ')[0] || ''}</td>
                <td>
                  <div class="flex gap-2" style="gap:4px">
                    ${p.status === 'pending' ? `
                      <button class="btn btn-sm" style="background:var(--accent-green);color:#fff;border:none;padding:2px 8px;border-radius:var(--radius-sm);cursor:pointer;font-size:11px;" data-aprv="${p.id}">通过</button>
                      <button class="btn btn-sm" style="background:var(--accent-red);color:#fff;border:none;padding:2px 8px;border-radius:var(--radius-sm);cursor:pointer;font-size:11px;" data-rej="${p.id}">拒绝</button>
                    ` : p.status === 'approved' ? `
                      <button class="btn btn-sm btn-ghost" data-cmpl="${p.id}">完成</button>
                    ` : ''}
                    ${p.admin_notes ? `<span class="text-xs text-muted" title="${escHtml(p.admin_notes)}">📝</span>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>` : '<p class="text-muted text-sm" style="padding:24px;text-align:center;">暂无记录</p>'}
      </div>`;

    // 通过
    container.querySelectorAll('[data-aprv]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.aprv);
        if (!confirm('确认通过此购买记录？')) return;
        try {
          const res = await api.adminReviewPurchase(id, 'approve');
          toast.success(res.message || '已通过');
          if (res.complete_panel) {
            modal.open({
              title: '完成面板预览',
              body: `<div style="text-align:center;padding:12px;">
                <p><strong>${escHtml(res.complete_panel.title)}</strong></p>
                <p class="text-sm text-muted" style="white-space:pre-wrap;">${escHtml(res.complete_panel.description)}</p>
              </div>`,
              confirmText: '关闭',
              confirmOnly: true,
            });
          }
          renderAdminMarketPurchases({ container });
        } catch (err) {
          toast.error(err.message || '操作失败');
        }
      });
    });

    // 拒绝
    container.querySelectorAll('[data-rej]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.rej);
        modal.open({
          title: '拒绝购买',
          body: `
            <p>确定拒绝此购买记录？</p>
            <div class="form-group" style="margin-top:12px;">
              <label class="form-label">拒绝原因（可选，将通知用户）</label>
              <textarea class="form-input" id="rej-reason" rows="2" placeholder="输入拒绝原因..."></textarea>
            </div>`,
          confirmText: '确认拒绝',
          confirmDanger: true,
          onConfirm: async () => {
            const notes = document.getElementById('rej-reason')?.value.trim() || '';
            try {
              await api.adminReviewPurchase(id, 'reject', notes);
              toast.success('已拒绝');
              modal.close();
              renderAdminMarketPurchases({ container });
            } catch (err) {
              toast.error(err.message || '操作失败');
            }
          },
        });
      });
    });

    // 完成（从 approved → completed）
    container.querySelectorAll('[data-cmpl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.cmpl);
        if (!confirm('确认标记此购买为已完成？')) return;
        try {
          const res = await api.adminReviewPurchase(id, 'complete');
          toast.success(res.message || '已完成');
          renderAdminMarketPurchases({ container });
        } catch (err) {
          toast.error(err.message || '操作失败');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
