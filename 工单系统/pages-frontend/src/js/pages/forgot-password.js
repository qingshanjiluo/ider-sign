// pages/forgot-password.js — 找回密码页

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { icon } from '../icons.js';

export function renderForgotPassword({ container }) {
  container.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-left">
        <div class="auth-card">
          <h2>找回密码</h2>
          <p class="subtitle">通过注册邮箱重置密码</p>
          <form id="forgot-form">
            <div class="form-group">
              <label class="form-label">用户名</label>
              <input type="text" class="form-input" id="fp-username" placeholder="请输入用户名" required>
            </div>
            <div class="form-group">
              <label class="form-label">注册邮箱</label>
              <input type="email" class="form-input" id="fp-email" placeholder="请输入注册邮箱" required>
            </div>
            <button type="submit" class="btn btn-primary" id="fp-btn">发送重置链接</button>
          </form>
          <div class="auth-links">
            <a href="#/login">返回登录</a>
          </div>
          <div class="card mt-6" style="padding:var(--space-4);background:var(--accent-blue-light);border-color:var(--accent-blue);">
            <p class="text-sm" style="color:var(--accent-blue);">
              ${icon('bulb', 16)} 提示：如果没有绑定邮箱，请联系管理员重置密码。
            </p>
          </div>
        </div>
      </div>
      <div class="auth-right">
        <h2>密码找回</h2>
        <p>填写注册信息，我们将帮助你重置密码</p>
      </div>
    </div>`;

  const form = document.getElementById('forgot-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('fp-btn');
    const username = document.getElementById('fp-username').value.trim();
    const email = document.getElementById('fp-email').value.trim();

    if (!username || !email) {
      toast.error('请填写完整信息');
      return;
    }

    btn.disabled = true;
    btn.textContent = '发送中...';

    try {
      await api.post('/auth/forgot-password', { username, email });
      toast.success('重置链接已发送到邮箱，请查收');
    } catch (err) {
      toast.error(err.message || '发送失败，请检查用户名和邮箱是否正确');
    } finally {
      btn.disabled = false;
      btn.textContent = '发送重置链接';
    }
  });
}
