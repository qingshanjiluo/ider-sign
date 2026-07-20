// pages/settings.js — 设置页

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';

export async function renderSettings({ container }) {
  const user = store.getUser();

  container.innerHTML = `
    <div class="page-header">
      <h2>设置</h2>
      <p>管理你的账号信息</p>
    </div>

    <!-- 个人信息 -->
    <div class="card mb-6">
      <div class="card-header">
        <h3>个人信息</h3>
      </div>
      <form id="profile-form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input type="text" class="form-input" id="set-username" value="${user?.username || ''}" disabled>
          <div class="form-hint">用户名不可修改</div>
        </div>
        <div class="form-group">
          <label class="form-label">邮箱</label>
          <input type="email" class="form-input" id="set-email" value="${user?.email || ''}" placeholder="绑定邮箱">
        </div>
        <div class="form-group">
          <label class="form-label">QQ</label>
          <input type="text" class="form-input" id="set-qq" value="${user?.qq || ''}" placeholder="绑定QQ">
        </div>
        <button type="submit" class="btn btn-primary">保存修改</button>
      </form>
    </div>

    <!-- 修改密码 -->
    <div class="card mb-6">
      <div class="card-header">
        <h3>修改密码</h3>
      </div>
      <form id="password-form">
        <div class="form-group">
          <label class="form-label">当前密码</label>
          <input type="password" class="form-input" id="set-old-pw" placeholder="输入当前密码" required>
        </div>
        <div class="form-group">
          <label class="form-label">新密码</label>
          <input type="password" class="form-input" id="set-new-pw" placeholder="至少6位" required>
        </div>
        <div class="form-group">
          <label class="form-label">确认新密码</label>
          <input type="password" class="form-input" id="set-new-pw2" placeholder="再次输入新密码" required>
        </div>
        <button type="submit" class="btn btn-primary">修改密码</button>
      </form>
    </div>

    <!-- 兑换码 -->
    <div class="card mb-6">
      <div class="card-header">
        <h3>兑换码</h3>
      </div>
      <div class="flex items-center gap-3">
        <input type="text" class="form-input" id="redeem-code" placeholder="输入兑换码" style="max-width:300px;">
        <button class="btn btn-primary btn-sm" id="redeem-btn">兑换</button>
      </div>
    </div>

    <!-- 账号信息 -->
    <div class="card">
      <div class="card-header">
        <h3>账号信息</h3>
      </div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:var(--space-2) var(--space-4);font-size:var(--text-sm);">
        <span class="text-muted">用户ID</span><span class="font-mono">${user?.id || '-'}</span>
        <span class="text-muted">等级</span><span>Lv.${user?.level || 1}</span>
        <span class="text-muted">经验值</span><span>${user?.xp || 0}</span>
        <span class="text-muted">邀请码</span><span class="font-mono">${user?.invite_code || '-'}</span>
        <span class="text-muted">注册时间</span><span>${user?.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN') : '-'}</span>
        <span class="text-muted">管理员</span><span>${user?.is_admin === 1 ? '是' : '否'}</span>
      </div>
    </div>`;

  // 保存个人信息
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = {};
      const email = document.getElementById('set-email').value.trim();
      const qq = document.getElementById('set-qq').value.trim();
      if (email) data.email = email;
      if (qq) data.qq = qq;

      await api.updateProfile(data);
      // 刷新用户信息
      const info = await api.getUserInfo();
      store.saveUserToStorage(info.user || info, api.getToken());
      toast.success('保存成功');
    } catch (err) {
      toast.error(err.message || '保存失败');
    }
  });

  // 修改密码
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const old_pw = document.getElementById('set-old-pw').value;
    const new_pw = document.getElementById('set-new-pw').value;
    const new_pw2 = document.getElementById('set-new-pw2').value;

    if (new_pw !== new_pw2) {
      toast.error('两次密码不一致');
      return;
    }
    if (new_pw.length < 6) {
      toast.error('密码至少6位');
      return;
    }

    try {
      await api.changePassword(old_pw, new_pw);
      toast.success('密码修改成功');
      document.getElementById('set-old-pw').value = '';
      document.getElementById('set-new-pw').value = '';
      document.getElementById('set-new-pw2').value = '';
    } catch (err) {
      toast.error(err.message || '修改失败');
    }
  });

  // 兑换码
  document.getElementById('redeem-btn').addEventListener('click', async () => {
    const code = document.getElementById('redeem-code').value.trim();
    if (!code) {
      toast.error('请输入兑换码');
      return;
    }
    try {
      const res = await api.redeemCode(code);
      toast.success(res.message || '兑换成功');
      document.getElementById('redeem-code').value = '';
      // 刷新用户信息
      const info = await api.getUserInfo();
      store.saveUserToStorage(info.user || info, api.getToken());
    } catch (err) {
      toast.error(err.message || '兑换失败');
    }
  });
}
