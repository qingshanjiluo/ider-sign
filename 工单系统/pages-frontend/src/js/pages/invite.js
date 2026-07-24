// pages/invite.js — 邀请返利页

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderInvite({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const [info, packages] = await Promise.all([
      api.getInviteInfo(),
      api.getInvitePackages(),
    ]);

    const user = store.getUser();
    const inviteCode = info.invite_code || user?.invite_code || '';
    const inviteUrl = `${window.location.origin}/#/register?code=${inviteCode}`;

    const cashPkgs = packages.cash_packages || packages.packages || [];
    const spiritPkgs = packages.spirit_packages || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>邀请返利</h2>
        <p>邀请好友注册，享受持续返利</p>
      </div>

      <!-- 邀请链接 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>你的邀请码</h3>
        </div>
        <div class="flex items-center gap-3" style="flex-wrap:wrap;">
          <input type="text" class="form-input" value="${inviteCode}" readonly style="max-width:200px;font-family:var(--font-mono);">
          <button class="btn btn-secondary btn-sm" id="copy-invite">复制邀请码</button>
          <button class="btn btn-ghost btn-sm" id="copy-url">复制邀请链接</button>
        </div>
        <p class="text-sm text-muted mt-4">分享链接给好友，好友注册后自动关联</p>
      </div>

      <!-- 邀请统计 -->
      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">已邀请人数</div>
          <div class="stat-value">${info.total_invited || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">邀请积分</div>
          <div class="stat-value">${info.invite_points || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已购买积分</div>
          <div class="stat-value">${info.purchased_points || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">当前倍率</div>
          <div class="stat-value" style="color:var(--accent-green)">${info.boost_percent || 30}%</div>
        </div>
      </div>

      <!-- 返利倍率说明 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>返利倍率</h3>
        </div>
        <div id="boost-tiers">
          ${(info.boost_tiers || []).map((t, i) => `
            <div class="flex justify-between items-center" style="padding:var(--space-3) 0;border-bottom:1px solid var(--border-light);">
              <div>
                <span class="font-semibold">${t.name || `等级${i + 1}`}</span>
                <span class="text-sm text-muted" style="margin-left:var(--space-2);">累计购买 ≥${t.threshold || 0}</span>
              </div>
              <span class="badge badge-approved">${t.boost || t.percent || 30}%</span>
            </div>
          `).join('') || '<p class="text-muted text-sm">加载中...</p>'}
        </div>
      </div>

      <!-- 微信客服 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>联系客服</h3>
        </div>
        <div style="text-align:center;padding:var(--space-4) 0;">
          <p class="text-sm text-muted mb-4">扫码添加微信，咨询套餐与售后</p>
          <img src="/src/assets/加v二维码.png" alt="微信二维码" style="max-width:200px;border-radius:var(--radius-md);box-shadow:var(--shadow-sm);">
          <p class="text-xs text-muted mt-2">长按识别二维码添加好友</p>
        </div>
      </div>

      <!-- 现金套餐 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>现金套餐（微信支付）</h3>
          <span class="text-sm text-muted">1元 = 120 积分</span>
        </div>
        <div class="stats-grid">
          ${cashPkgs.map(p => `
            <div class="stat-card" style="cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;"
                 data-pkg='${JSON.stringify(p)}' data-buy-pkg>
              <div class="stat-label">${p.name || p.tier}</div>
              <div class="stat-value" style="color:var(--accent-green);">¥${p.price || 0}</div>
              <div class="stat-change">${p.points || 0} 积分</div>
              <div class="text-xs text-muted mt-2">${p.desc || ''}</div>
            </div>
          `).join('') || '<p class="text-muted text-sm">暂无套餐</p>'}
        </div>
      </div>

      <!-- 灵石套餐 -->
      <div class="card mb-6">
        <div class="card-header">
          <h3>灵石套餐（灵石支付）</h3>
          <span class="text-sm text-muted">100万灵石 = 1 积分</span>
        </div>
        <div class="stats-grid">
          ${spiritPkgs.map(p => `
            <div class="stat-card" style="cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;"
                 data-pkg='${JSON.stringify(p)}' data-buy-pkg>
              <div class="stat-label">${p.name || p.tier}</div>
              <div class="stat-value" style="color:var(--accent-amber);">${(p.price / 100000000).toFixed(0)}亿灵石</div>
              <div class="stat-change">${p.points || 0} 积分</div>
              <div class="text-xs text-muted mt-2">${p.desc || ''}</div>
            </div>
          `).join('') || '<p class="text-muted text-sm">暂无套餐</p>'}
        </div>
      </div>

      <!-- 提现 -->
      <div class="card">
        <div class="card-header">
          <h3>积分提现</h3>
        </div>
        <div class="flex items-center gap-3">
          <input type="number" class="form-input" id="withdraw-points" placeholder="输入积分数量" style="max-width:200px;">
          <button class="btn btn-primary btn-sm" id="withdraw-btn">提现</button>
        </div>
        <p class="text-sm text-muted mt-2">120积分 = 1元（微信）/ 100万灵石 = 10积分</p>
      </div>`;

    // 复制邀请码
    document.getElementById('copy-invite').addEventListener('click', () => {
      navigator.clipboard.writeText(inviteCode).then(() => toast.success('邀请码已复制'));
    });
    document.getElementById('copy-url').addEventListener('click', () => {
      navigator.clipboard.writeText(inviteUrl).then(() => toast.success('邀请链接已复制'));
    });

    // 购买套餐
    document.querySelectorAll('[data-buy-pkg]').forEach(el => {
      el.addEventListener('click', () => {
        try { buyPackage(JSON.parse(el.dataset.pkg)); }
        catch { toast.error('套餐数据异常'); }
      });
    });

    // 提现
    document.getElementById('withdraw-btn').addEventListener('click', async () => {
      const points = parseInt(document.getElementById('withdraw-points').value);
      if (!points || points <= 0) {
        toast.error('请输入有效积分数量');
        return;
      }
      try {
        await api.withdrawInvitePoints(points);
        toast.success('提现申请已提交');
        document.getElementById('withdraw-points').value = '';
      } catch (err) {
        toast.error(err.message || '提现失败');
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function buyPackage(pkg) {
  const isCash = pkg.currency === 'cash';
  const priceLabel = isCash ? `¥${pkg.price}` : `${(pkg.price / 100000000).toFixed(0)}亿灵石`;
  const payMethodLabel = isCash ? '微信支付' : '灵石支付';

  const qrSection = isCash ? `
      <div style="text-align:center;margin:16px 0;padding:16px;background:var(--bg-secondary,#f8f8f8);border-radius:var(--radius-md);">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">微信扫码支付</p>
        <img src="/src/assets/支付二维码.png" alt="微信支付二维码" style="max-width:220px;border-radius:var(--radius-sm);">
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">支付后请填写下方付款账号</p>
      </div>` : '';

  modal.open({
    title: '购买套餐',
    body: `
      <p>套餐: <strong>${pkg.name || pkg.tier}</strong></p>
      <p>价格: <strong>${priceLabel}</strong>（${payMethodLabel}）</p>
      <p>积分: <strong>${pkg.points}</strong></p>
      <p class="text-sm text-muted mt-2">${pkg.desc || ''}</p>
      ${qrSection}
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">付款账号</label>
        <input type="text" class="form-input" id="package-payment-account" placeholder="请输入您的${isCash ? '微信账号' : '游戏角色名'}">
      </div>`,
    confirmText: '确认购买',
    onConfirm: async () => {
      const account = document.getElementById('package-payment-account')?.value?.trim();
      if (!account) {
        toast.error('请输入付款账号');
        return;
      }
      try {
        await api.purchaseInvitePackage({
          package_id: pkg.id || pkg.tier,
          payment_method: isCash ? 'wechat' : 'spirit_stone',
          payment_account: account,
        });
        toast.success('购买申请已提交，等待管理员审核');
        modal.close();
      } catch (err) {
        toast.error(err.message || '购买失败');
      }
    },
  });
}
