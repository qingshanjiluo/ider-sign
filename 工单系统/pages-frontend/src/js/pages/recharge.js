// pages/recharge.js — 修仙币充值页
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export async function renderRecharge({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const user = store.getUser();
    const res = await api.getRechargePackages();
    const cashPkgs = res.cash_packages || [];
    const spiritPkgs = res.spirit_packages || [];

    container.innerHTML = `
      <div class="page-header">
        <h2>修仙币充值</h2>
        <p>当前余额：<strong style="color:var(--accent-amber);font-size:1.2em;" id="coins-balance">${user?.bonus_points || 0}</strong> 修仙币</p>
      </div>

      <!-- 兑换码快捷输入 -->
      <div class="card mb-6" style="border:1px solid var(--accent-amber);">
        <div class="card-header">
          <h3>兑换码激活</h3>
        </div>
        <div class="flex items-center gap-3" style="flex-wrap:wrap;">
          <input type="text" class="form-input" id="recharge-redeem-input" placeholder="输入兑换码（8位字母数字）" style="max-width:260px;text-transform:uppercase;letter-spacing:2px;">
          <button class="btn btn-primary" id="recharge-redeem-btn">激活修仙币</button>
        </div>
        <p class="text-sm text-muted mt-2">兑换码由管理员审核通过后自动生成，或由管理员直接发放</p>
      </div>

      <!-- Tabs -->
      <div class="tabs mb-6" id="recharge-tabs">
        <button class="tab active" data-tab="packages">套餐充值</button>
        <button class="tab" data-tab="direct">基础充值</button>
        <button class="tab" data-tab="history">充值记录</button>
      </div>

      <!-- 套餐充值 -->
      <div id="tab-packages" class="tab-content">
        <div class="card mb-6">
          <div class="card-header">
            <h3>现金套餐（微信支付）</h3>
          </div>
          <div class="stats-grid">
            ${cashPkgs.map(p => `
              <div class="stat-card" style="cursor:pointer;" data-pkg='${JSON.stringify(p)}' data-buy-cash-pkg>
                <div class="stat-label">${p.name}</div>
                <div class="stat-value" style="color:var(--accent-green);font-size:1.1em;">¥${p.price}</div>
                <div class="stat-change">+${p.coins} 修仙币</div>
                <div class="text-xs text-muted mt-2">${p.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>灵石套餐（游戏内灵石支付）</h3>
          </div>
          <div class="stats-grid">
            ${spiritPkgs.map(p => `
              <div class="stat-card" style="cursor:pointer;" data-pkg='${JSON.stringify(p)}' data-buy-spirit-pkg>
                <div class="stat-label">${p.name}</div>
                <div class="stat-value" style="color:var(--accent-amber);font-size:1em;">${(p.price / 10000).toFixed(0)}万灵石</div>
                <div class="stat-change">+${p.coins} 修仙币</div>
                <div class="text-xs text-muted mt-2">${p.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 基础充值 -->
      <div id="tab-direct" class="tab-content" style="display:none;">
        <div class="card mb-6">
          <div class="card-header">
            <h3>现金直充</h3>
            <span class="text-sm text-muted">1元 = 400修仙币</span>
          </div>
          <div class="flex items-center gap-3" style="flex-wrap:wrap;">
            <input type="number" class="form-input" id="direct-cash-amount" placeholder="输入金额（元）" min="1" style="max-width:160px;">
            <button class="btn btn-primary" id="direct-cash-btn">提交充值</button>
          </div>
          <p class="text-sm text-muted mt-2">最低充值1元，提交后联系站长完成支付</p>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>灵石直充</h3>
            <span class="text-sm text-muted">100万灵石 = 10修仙币（最低100万起充）</span>
          </div>
          <div class="flex items-center gap-3" style="flex-wrap:wrap;">
            <input type="number" class="form-input" id="direct-spirit-amount" placeholder="输入灵石数量（万）" min="100" style="max-width:200px;">
            <button class="btn btn-primary" id="direct-spirit-btn">提交充值</button>
            <span class="text-sm text-muted" id="spirit-preview">≈ 0 修仙币</span>
          </div>
          <p class="text-sm text-muted mt-2">灵石直充后联系管理员确认到账</p>
        </div>
      </div>

      <!-- 充值记录 -->
      <div id="tab-history" class="tab-content" style="display:none;">
        <div class="card">
          <div class="card-header">
            <h3>我的充值记录</h3>
          </div>
          <div id="recharge-history-list"><p class="text-muted text-sm">加载中...</p></div>
        </div>
      </div>`;

    // Tab switching
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        container.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
        const target = document.getElementById('tab-' + tab.dataset.tab);
        if (target) target.style.display = 'block';
        if (tab.dataset.tab === 'history') loadRechargeHistory();
      });
    });

    // 兑换码激活
    document.getElementById('recharge-redeem-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('recharge-redeem-input').value.trim().toUpperCase();
      if (!code) return toast.error('请输入兑换码');
      try {
        const res = await api.redeemCoinCode(code);
        toast.success(res.message || '兑换成功！+' + res.coins + ' 修仙币');
        document.getElementById('recharge-redeem-input').value = '';
        // 刷新余额
        const userRes = await api.getUserInfo();
        store.setUser(userRes.user || userRes);
        document.getElementById('coins-balance').textContent = userRes.user?.bonus_points || 0;
      } catch (err) {
        toast.error(err.message || '兑换失败');
      }
    });

    // 现金套餐购买 → 3步弹窗
    container.querySelectorAll('[data-buy-cash-pkg]').forEach(el => {
      el.addEventListener('click', () => {
        try { showRechargeWizard(JSON.parse(el.dataset.pkg), 'cash'); }
        catch { toast.error('套餐数据异常'); }
      });
    });

    // 灵石套餐购买 → 3步弹窗
    container.querySelectorAll('[data-buy-spirit-pkg]').forEach(el => {
      el.addEventListener('click', () => {
        try { showRechargeWizard(JSON.parse(el.dataset.pkg), 'spirit_stone'); }
        catch { toast.error('套餐数据异常'); }
      });
    });

    // 现金直充
    document.getElementById('direct-cash-btn')?.addEventListener('click', async () => {
      const amount = parseInt(document.getElementById('direct-cash-amount').value);
      if (!amount || amount < 1) return toast.error('请输入有效金额（≥1元）');
      submitDirect('cash', amount);
    });

    // 灵石直充
    document.getElementById('direct-spirit-btn')?.addEventListener('click', async () => {
      const amount = parseInt(document.getElementById('direct-spirit-amount').value) * 10000;
      if (!amount || amount < 1000000) return toast.error('灵石充值至少100万');
      submitDirect('spirit_stone', amount);
    });

    // 灵石预计算（单位万）
    document.getElementById('direct-spirit-amount')?.addEventListener('input', () => {
      const val = parseInt(document.getElementById('direct-spirit-amount').value) || 0;
      const coins = Math.floor(val / 100) * 10;
      document.getElementById('spirit-preview').textContent = `≈ ${coins} 修仙币`;
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

// 3步充值向导弹窗
function showRechargeWizard(pkg, method) {
  const isCash = method === 'cash';
  const priceLabel = isCash ? `¥${pkg.price}` : `${(pkg.price / 10000).toFixed(0)}万灵石`;
  const qrSrc = isCash ? '/src/assets/支付二维码.png' : '/src/assets/加v二维码.png';
  const qrAlt = isCash ? '微信支付二维码' : '加站长微信二维码';

  let step = 1;
  let paymentAccount = '';

  function renderStep() {
    if (step === 1) {
      // Step 1: 注意事项
      modal.open({
        title: '充值注意事项',
        body: `
          <div style="padding:8px 0;">
            <p><strong>套餐：</strong>${pkg.name}</p>
            <p><strong>价格：</strong>${priceLabel}（${isCash ? '微信支付' : '灵石支付'}）</p>
            <p><strong>获得：</strong><span style="color:var(--accent-amber);font-weight:700;">${pkg.coins} 修仙币</span></p>
            <hr style="margin:16px 0;border-color:var(--border-light);">
            <p style="color:var(--text-secondary);font-size:var(--text-sm);line-height:1.7;">
              请仔细阅读以下事项：<br><br>
              1. 支付后请截图保存支付凭证<br>
              2. 提交申请后管理员会审核确认<br>
              3. 审核通过后自动生成<strong>兑换码</strong><br>
              4. 在充值页或坊市页输入兑换码激活修仙币<br>
              5. 如长时间未审核请联系站长<br>
              6. 兑换码仅限本人使用，请勿泄露
            </p>
          </div>
        `,
        confirmText: '下一步（扫码支付）',
        onConfirm: () => { step = 2; renderStep(); },
      });
    } else if (step === 2) {
      // Step 2: 展示二维码
      modal.open({
        title: isCash ? '扫码支付' : '联系站长',
        body: `
          <div style="text-align:center;padding:8px 0;">
            <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:12px;">
              ${isCash ? '请使用微信扫描下方二维码支付' : '请添加站长微信发送灵石截图'}
            </p>
            <p><strong>套餐：</strong>${pkg.name} | <strong>金额：</strong>${priceLabel}</p>
            <div style="margin:16px auto;width:200px;height:200px;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border-light);">
              <img src="${qrSrc}" alt="${qrAlt}" style="width:100%;height:100%;object-fit:contain;">
            </div>
            ${isCash ? `
            <div class="form-group" style="text-align:left;">
              <label class="form-label">付款账号（微信）</label>
              <input type="text" class="form-input" id="wizard-payment-account" placeholder="输入您的微信账号" value="${paymentAccount}">
            </div>` : `
            <p class="text-sm text-muted">灵石支付后联系站长确认</p>`}
            <p class="text-xs text-muted" style="margin-top:8px;">${isCash ? '支付后点击下一步提交申请' : '联系站长确认后点击下一步'}</p>
          </div>
        `,
        confirmText: '下一步（提交申请）',
        onConfirm: () => {
          if (isCash) {
            paymentAccount = document.getElementById('wizard-payment-account')?.value?.trim() || '';
            if (!paymentAccount) return toast.error('请输入微信账号');
          }
          step = 3;
          renderStep();
        },
      });
    } else if (step === 3) {
      // Step 3: 提交申请
      modal.open({
        title: '提交充值申请',
        body: `
          <div style="padding:8px 0;text-align:center;">
            <p>套餐：${pkg.name}</p>
            <p>金额：${priceLabel}</p>
            <p>获得：<strong style="color:var(--accent-amber);">${pkg.coins} 修仙币</strong></p>
            <hr style="margin:16px 0;border-color:var(--border-light);">
            <p style="color:var(--text-secondary);font-size:var(--text-sm);">
              提交后等待管理员审核<br>
              审核通过后将自动生成兑换码<br>
              请在充值页或坊市页输入兑换码激活
            </p>
            <p style="margin-top:12px;font-size:var(--text-xs);color:var(--text-tertiary);">
              已有兑换码？在输入框中直接激活即可
            </p>
          </div>
        `,
        confirmText: '确认提交',
        onConfirm: async () => {
          try {
            await api.createRecharge({
              type: 'package',
              package_id: pkg.id,
              payment_method: isCash ? 'wechat' : 'spirit_stone',
              payment_account: paymentAccount || '',
            });
            toast.success('充值申请已提交，等待管理员审核');
            modal.close();
          } catch (err) {
            toast.error(err.message || '提交失败');
          }
        },
      });
    }
  }

  renderStep();
}

async function submitDirect(type, amount) {
  const account = type === 'cash' ? '微信支付' : '游戏内灵石';
  try {
    const res = await api.createRecharge({
      type,
      amount,
      payment_method: type === 'cash' ? 'wechat' : 'spirit_stone',
      payment_account: account,
    });
    toast.success(`充值申请已提交，获得 ${res.coins} 修仙币`);
  } catch (err) {
    toast.error(err.message || '提交失败');
  }
}

async function loadRechargeHistory() {
  const el = document.getElementById('recharge-history-list');
  if (!el) return;
  try {
    const res = await api.getMyRechargeOrders();
    const orders = res.orders || [];
    if (!orders.length) {
      el.innerHTML = '<p class="text-muted text-sm">暂无充值记录</p>';
      return;
    }
    el.innerHTML = `<table class="table" style="width:100%;">
      <thead><tr><th>时间</th><th>类型</th><th>金额</th><th>修仙币</th><th>状态</th></tr></thead>
      <tbody>
        ${orders.map(o => `
          <tr>
            <td class="text-sm">${o.created_at?.split(' ')[0] || '-'}</td>
            <td>${o.type === 'package' ? '套餐' : o.type === 'cash' ? '现金' : '灵石'}</td>
            <td>${o.type === 'spirit_stone' ? (o.amount / 10000).toFixed(0) + '万' : '¥' + o.amount}</td>
            <td style="color:var(--accent-amber);">+${o.coins}</td>
            <td><span class="badge badge-${o.status === 'completed' ? 'approved' : o.status === 'pending' ? 'pending' : 'cancelled'}">${o.status === 'completed' ? '已到账' : o.status === 'pending' ? '待审核' : '已取消'}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  } catch {
    el.innerHTML = '<p class="text-muted text-sm">加载失败</p>';
  }
}
