// pages/admin-config.js — 管理后台 - 系统配置

import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAdminConfig({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetConfig();
    const config = res.config || res || {};

    const configItems = [
      { key: 'site_name', label: '站点名称', type: 'text' },
      { key: 'order_price', label: '工单单价（元）', type: 'number' },
      { key: 'invite_points_per_order', label: '每单邀请积分', type: 'number' },
      { key: 'free_trial_enabled', label: '免费试用', type: 'toggle' },
      { key: 'maintenance_mode', label: '维护模式', type: 'toggle' },
      { key: 'bot_enabled', label: '客服机器人', type: 'toggle' },
      { key: 'register_enabled', label: '开放注册', type: 'toggle' },
      { key: 'max_accounts_per_order', label: '每单最大账号数', type: 'number' },
    ];

    container.innerHTML = `
      <div class="page-header">
        <h2>系统配置</h2>
        <p>管理系统全局设置</p>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>基础设置</h3>
        </div>
        <form id="config-form">
          ${configItems.map(item => {
            const val = config[item.key] ?? '';
            if (item.type === 'toggle') {
              return `
                <div class="form-group flex items-center gap-3">
                  <label class="form-label" style="margin-bottom:0;min-width:140px;">${item.label}</label>
                  <button type="button" class="btn btn-sm ${val ? 'btn-success' : 'btn-secondary'}" 
                          data-config-key="${item.key}" data-config-value="${val ? '' : '1'}" data-toggle-btn>
                    ${val ? '开启' : '关闭'}
                  </button>
                  <input type="hidden" name="${item.key}" value="${val ? '1' : '0'}">
                </div>`;
            }
            return `
              <div class="form-group">
                <label class="form-label">${item.label}</label>
                <input type="${item.type}" class="form-input" name="${item.key}" value="${val}" style="max-width:300px;">
              </div>`;
          }).join('')}
          <button type="submit" class="btn btn-primary mt-4">保存配置</button>
        </form>
      </div>`;

    // Toggle buttons
    document.querySelectorAll('[data-toggle-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input[type="hidden"]');
        const newVal = input.value === '1' ? '0' : '1';
        input.value = newVal;
        btn.textContent = newVal === '1' ? '开启' : '关闭';
        btn.className = `btn btn-sm ${newVal === '1' ? 'btn-success' : 'btn-secondary'}`;
        btn.dataset.configValue = newVal === '1' ? '' : '1';
      });
    });

    // Save
    document.getElementById('config-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const inputs = form.querySelectorAll('input[name]');
      let successCount = 0;

      for (const input of inputs) {
        try {
          await api.adminSetConfig(input.name, input.value);
          successCount++;
        } catch (err) {
          toast.error(`${input.name}: ${err.message}`);
        }
      }
      if (successCount > 0) {
        toast.success(`已保存 ${successCount} 项配置`);
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
