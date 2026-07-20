// pages/register.js — 注册页

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { router } from '../router.js';

export function renderRegister({ container }) {
  // 从 URL query 提取邀请码
  const hash = window.location.hash;
  const queryStr = hash.split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const inviteCode = params.get('code') || '';

  container.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-left">
        <div class="auth-card">
          <h2>创建账号</h2>
          <p class="subtitle">注册艾德尔工单系统</p>
          <form id="register-form">
            <div class="form-group">
              <label class="form-label">用户名</label>
              <input type="text" class="form-input" id="reg-username" placeholder="3-20位字母数字" required autocomplete="username">
              <div class="form-hint">支持中英文、数字，3-20个字符</div>
            </div>
            <div class="form-group">
              <label class="form-label">密码</label>
              <input type="password" class="form-input" id="reg-password" placeholder="至少6位" required autocomplete="new-password">
              <div class="password-strength" id="pwd-strength">
                <div class="bar"></div><div class="bar"></div><div class="bar"></div>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">确认密码</label>
              <input type="password" class="form-input" id="reg-password2" placeholder="再次输入密码" required autocomplete="new-password">
            </div>
            <div class="form-group">
              <label class="form-label">邀请码</label>
              <input type="text" class="form-input" id="reg-invite" placeholder="选填" value="${inviteCode}">
              <div class="invite-hint">填写邀请码可获得额外奖励</div>
            </div>
            <button type="submit" class="btn btn-primary" id="reg-btn">注 册</button>
          </form>
          <div class="auth-links">
            已有账号？<a href="#/login">立即登录</a>
          </div>
        </div>
      </div>
      <div class="auth-right">
        <h2>加入艾德尔</h2>
        <p>注册即可获得初始经验值，邀请好友享返利</p>
      </div>
    </div>`;

  // 密码强度检测
  const pwdInput = document.getElementById('reg-password');
  const strengthEl = document.getElementById('pwd-strength');
  pwdInput.addEventListener('input', () => {
    const v = pwdInput.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;

    strengthEl.className = 'password-strength';
    if (score <= 1) strengthEl.classList.add('weak');
    else if (score <= 3) strengthEl.classList.add('medium');
    else strengthEl.classList.add('strong');
  });

  // 注册提交
  const form = document.getElementById('register-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('reg-btn');
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const invite_code = document.getElementById('reg-invite').value.trim();

    if (!username || !password) {
      toast.error('请填写用户名和密码');
      return;
    }
    if (password !== password2) {
      toast.error('两次密码不一致');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少6位');
      return;
    }

    btn.disabled = true;
    btn.textContent = '注册中...';

    try {
      const res = await api.register(username, password, invite_code);
      api.setToken(res.token);
      store.saveUserToStorage(res.user, res.token);
      toast.success('注册成功');
      router.navigate('/');
    } catch (err) {
      toast.error(err.message || '注册失败');
      btn.disabled = false;
      btn.textContent = '注 册';
    }
  });
}
