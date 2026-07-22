// pages/admin-config.js — 管理后台 - 系统配置

import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAdminConfig({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetConfig();
    const config = res.config || res || {};

    const configMap = {};
    for (const c of (config || [])) {
      configMap[c.key] = c.value;
    }

    const configSections = [
      {
        title: '基础设置',
        items: [
          { key: 'site_name', label: '站点名称', type: 'text', placeholder: '艾德尔工单系统' },
          { key: 'maintenance_mode', label: '维护模式', type: 'toggle' },
          { key: 'register_enabled', label: '开放注册', type: 'toggle' },
        ]
      },
      {
        title: '工单设置',
        items: [
          { key: 'order_price', label: '工单单价（元）', type: 'number', placeholder: '120积分=1元' },
          { key: 'invite_points_per_order', label: '每单邀请积分', type: 'number' },
          { key: 'max_accounts_per_order', label: '每单最大账号数', type: 'number' },
          { key: 'est_delivery_days', label: '预计交付天数', type: 'number', placeholder: '5' },
        ]
      },
      {
        title: '灵石兑换',
        items: [
          { key: 'spirit_stone_per_10_points', label: '灵石兑换比例（每10积分对应灵石数）', type: 'number', placeholder: '1000000' },
        ]
      },
      {
        title: '功能开关',
        items: [
          { key: 'bot_enabled', label: '客服机器人', type: 'toggle' },
          { key: 'free_trial_enabled', label: '免费试用', type: 'toggle' },
          { key: 'ai_enabled', label: 'AI 智能回复', type: 'toggle' },
        ]
      },
    ];

    container.innerHTML = `
      <div class="page-header">
        <h2>系统配置</h2>
        <p>管理系统全局设置</p>
      </div>
      <form id="config-form">
        ${configSections.map(section => `
          <div class="card" style="margin-bottom:var(--space-4);">
            <div class="card-header">
              <h3>${section.title}</h3>
            </div>
            ${section.items.map(item => {
              const val = configMap[item.key] ?? '';
              if (item.type === 'toggle') {
                const isOn = val === '1' || val === 'true';
                return `
                  <div class="form-group flex items-center gap-3" style="padding:0 var(--space-4);">
                    <label class="form-label" style="margin-bottom:0;min-width:200px;">${item.label}</label>
                    <button type="button" class="btn btn-sm ${isOn ? 'btn-success' : 'btn-secondary'}"
                            data-toggle-btn data-key="${item.key}">
                      ${isOn ? '开启' : '关闭'}
                    </button>
                    <input type="hidden" name="${item.key}" value="${isOn ? '1' : '0'}">
                  </div>`;
              }
              return `
                <div class="form-group" style="padding:0 var(--space-4);">
                  <label class="form-label">${item.label}</label>
                  <input type="${item.type}" class="form-input" name="${item.key}" value="${val}"
                         placeholder="${item.placeholder || ''}" style="max-width:300px;">
                </div>`;
            }).join('')}
          </div>
        `).join('')}
        <button type="submit" class="btn btn-primary" style="margin-bottom:var(--space-6);">保存全部配置</button>
      </form>`;

    // Toggle buttons
    document.querySelectorAll('[data-toggle-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input[type="hidden"]');
        const newVal = input.value === '1' ? '0' : '1';
        input.value = newVal;
        btn.textContent = newVal === '1' ? '开启' : '关闭';
        btn.className = `btn btn-sm ${newVal === '1' ? 'btn-success' : 'btn-secondary'}`;
      });
    });

    // Batch Save
    document.getElementById('config-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const inputs = form.querySelectorAll('input[name]');
      const configs = [];
      for (const input of inputs) {
        configs.push({ key: input.name, value: input.value });
      }
      try {
        await api.adminSetConfigBatch(configs);
        toast.success(`已保存 ${configs.length} 项配置`);
      } catch (err) {
        toast.error('保存失败: ' + err.message);
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
