// pages/login.js — 登录页

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { router } from '../router.js';

export function renderLogin({ container }) {
  container.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-left">
        <div class="auth-card">
          <h2>欢迎回来</h2>
          <p class="subtitle">登录你的艾德尔账号</p>
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">用户名</label>
              <input type="text" class="form-input" id="username" placeholder="请输入用户名" required autocomplete="username">
            </div>
            <div class="form-group">
              <label class="form-label">密码</label>
              <input type="password" class="form-input" id="password" placeholder="请输入密码" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn btn-primary" id="login-btn">登 录</button>
          </form>
          <div class="auth-links">
            <a href="#/register">注册新账号</a>
            <span style="margin:0 8px;color:var(--text-tertiary)">·</span>
            <a href="#/forgot-password">忘记密码</a>
          </div>
        </div>
      </div>
      <div class="auth-right">
        <h2>艾德尔工单系统</h2>
        <p>自动挂机 · 稳定高效 · 7×24小时运行</p>
      </div>
    </div>`;

  // 绑定事件
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      toast.error('请填写用户名和密码');
      return;
    }

    btn.disabled = true;
    btn.textContent = '登录中...';

    try {
      const res = await api.login(username, password);
      api.setToken(res.token);
      store.saveUserToStorage(res.user, res.token);
      toast.success('登录成功');
      router.navigate('/');
    } catch (err) {
      toast.error(err.message || '登录失败');
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  });
}
