// pages/admin-ai-config.js — AI 配置管理
// 管理 AI 智能回复的 API Key、URL、模型、开关

import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderAdminAiConfig({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.adminGetAiConfig();
    const config = res.config || {};
    const apiKeySet = config.ai_api_key_set || false;

    container.innerHTML = `
      <div class="page-header">
        <h2>AI 智能回复设置</h2>
        <p>配置 AI 机器人自动回复客服消息</p>
      </div>

      <div class="card" style="margin-bottom: var(--space-4);">
        <div class="card-header">
          <h3>AI 连接配置</h3>
        </div>
        <form id="ai-config-form">
          <div class="form-group">
            <label class="form-label">API 地址</label>
            <input type="url" class="form-input" name="ai_api_url"
                   value="${config.ai_api_url || 'https://api.openai.com/v1/chat/completions'}"
                   placeholder="https://api.openai.com/v1/chat/completions"
                   style="max-width:500px;">
            <p class="form-help">支持 OpenAI 兼容接口，如 DeepSeek、通义千问等</p>
          </div>

          <div class="form-group">
            <label class="form-label">模型名称</label>
            <input type="text" class="form-input" name="ai_model"
                   value="${config.ai_model || 'gpt-3.5-turbo'}"
                   placeholder="gpt-3.5-turbo"
                   style="max-width:300px;">
            <p class="form-help">例如：gpt-3.5-turbo, deepseek-chat, qwen-turbo</p>
          </div>

          <div class="form-group">
            <label class="form-label">API 密钥</label>
            <div style="display:flex;gap:var(--space-2);align-items:center;max-width:500px;">
              <input type="password" class="form-input" name="ai_api_key"
                     placeholder="${apiKeySet ? '••••••••（已设置，留空则不修改）' : '输入 API Key'}"
                     style="flex:1;"
                     autocomplete="off">
              <span class="badge ${apiKeySet ? 'badge-success' : 'badge-secondary'}" 
                    style="white-space:nowrap;flex-shrink:0;">
                ${apiKeySet ? '✓ 已设置' : '○ 未设置'}
              </span>
            </div>
            <p class="form-help">密钥已加密存储，不会明文回传。留空则保持现有密钥不变</p>
          </div>

          <div class="form-group flex items-center gap-3">
            <label class="form-label" style="margin-bottom:0;min-width:100px;">启用 AI 回复</label>
            <button type="button" class="btn btn-sm ${config.ai_enabled === 'true' ? 'btn-success' : 'btn-secondary'}"
                    data-toggle-ai data-value="${config.ai_enabled === 'true' ? '1' : '0'}">
              ${config.ai_enabled === 'true' ? '已开启' : '已关闭'}
            </button>
            <input type="hidden" name="ai_enabled" value="${config.ai_enabled === 'true' ? 'true' : 'false'}">
            <span class="text-secondary text-sm">开启后，机器人未匹配关键词时将调用 AI 回复</span>
          </div>

          <div class="flex items-center gap-3 mt-4">
            <button type="submit" class="btn btn-primary">保存配置</button>
            <button type="button" class="btn btn-secondary" id="btn-test-ai">测试连接</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>使用说明</h3>
        </div>
        <div class="card-body text-secondary" style="font-size:var(--text-sm);line-height:1.8;">
          <p><strong>AI 智能回复工作流程：</strong></p>
          <ol style="padding-left:var(--space-5);margin:var(--space-2) 0;">
            <li>用户发送消息到客服机器人</li>
            <li>机器人先匹配内置关键词（修仙币、充值、兑换码、等级称号等）</li>
            <li>匹配成功 → 直接返回预设回复，不消耗 API</li>
            <li>未匹配到关键词 → 调用 AI API 生成智能回复</li>
            <li>AI 回复失败时 → 降级返回内置兜底回复</li>
          </ol>
          <p><strong>推荐配置：</strong></p>
          <ul style="padding-left:var(--space-5);margin:var(--space-2) 0;">
            <li>DeepSeek：<code>https://api.deepseek.com/v1/chat/completions</code> + <code>deepseek-chat</code></li>
            <li>通义千问：<code>https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions</code> + <code>qwen-turbo</code></li>
            <li>OpenAI：<code>https://api.openai.com/v1/chat/completions</code> + <code>gpt-3.5-turbo</code></li>
          </ul>
        </div>
      </div>`;

    // ── Toggle 开关 ──
    const toggleBtn = document.querySelector('[data-toggle-ai]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const hidden = document.querySelector('input[name="ai_enabled"]');
        const current = hidden.value === 'true';
        const next = !current;
        hidden.value = next ? 'true' : 'false';
        toggleBtn.textContent = next ? '已开启' : '已关闭';
        toggleBtn.className = `btn btn-sm ${next ? 'btn-success' : 'btn-secondary'}`;
        toggleBtn.dataset.value = next ? '1' : '0';
      });
    }

    // ── 保存配置 ──
    document.getElementById('ai-config-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {
        ai_api_url: form.ai_api_url.value.trim(),
        ai_model: form.ai_model.value.trim(),
        ai_enabled: form.ai_enabled.value === 'true',
      };
      // API Key：只有填了才提交
      if (form.ai_api_key.value.trim()) {
        data.ai_api_key = form.ai_api_key.value.trim();
      }

      try {
        await api.adminSetAiConfig(data);
        toast.success('AI 配置已保存');
        // 刷新页面以更新已设置标识
        renderAdminAiConfig({ container });
      } catch (err) {
        toast.error('保存失败: ' + err.message);
      }
    });

    // ── 测试连接 ──
    document.getElementById('btn-test-ai').addEventListener('click', async () => {
      const btn = document.getElementById('btn-test-ai');
      btn.disabled = true;
      btn.textContent = '测试中…';
      try {
        const res = await api.adminTestAiConnection();
        if (res.ok) {
          toast.success('AI 连接测试成功！');
        } else {
          toast.error((res.error || '连接失败'));
        }
      } catch (err) {
        toast.error('测试失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
      }
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
