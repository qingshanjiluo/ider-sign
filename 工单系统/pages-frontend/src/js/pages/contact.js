// pages/contact.js — 联系站长页面
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { icon } from '../icons.js';

export function renderContact({ container }) {
  container.innerHTML = `
    <style>
      .contact-page {
        max-width: 700px;
        margin: 0 auto;
        padding: 40px 24px;
      }
      .contact-page h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 8px;
        color: var(--text-primary);
      }
      .contact-page .subtitle {
        color: var(--text-secondary);
        margin-bottom: 32px;
      }
      .contact-card {
        background: var(--bg-card);
        border-radius: var(--radius-xl);
        padding: 24px;
        box-shadow: var(--shadow-sm);
        margin-bottom: 20px;
      }
      .contact-card h3 {
        font-size: var(--text-lg);
        font-weight: 600;
        margin-bottom: 16px;
        color: var(--text-primary);
      }
      .contact-info-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid var(--border-light);
      }
      .contact-info-item:last-child {
        border-bottom: none;
      }
      .contact-info-item .label {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        min-width: 70px;
      }
      .contact-info-item .value {
        font-weight: 500;
        color: var(--text-primary);
      }
      .wechat-qr {
        width: 160px;
        height: 160px;
        background: var(--bg-card-hover);
        border-radius: var(--radius-lg);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 12px auto;
        border: 1px dashed var(--border-default);
        font-size: var(--text-sm);
        color: var(--text-tertiary);
        text-align: center;
        line-height: 1.5;
      }
    </style>

    <div class="contact-page">
      <h1>${icon('mail', 24)} 联系站长</h1>
      <p class="subtitle">有任何问题或建议，欢迎联系站长</p>

      <!-- 联系方式 -->
      <div class="contact-card">
        <h3>${icon('phone', 18)} 联系方式</h3>
        <div class="contact-info-item">
          <span class="label">微信</span>
          <span class="value">andyloveanny</span>
        </div>
        <div class="contact-info-item">
          <span class="label">回复时间</span>
          <span class="value">工作日 9:00-22:00，周末不定时回复</span>
        </div>

        <!-- 微信二维码 -->
        <div class="wechat-qr">
          <img src="/public/加v二维码.png" alt="站长微信" style="width:100%;height:100%;object-fit:contain;border-radius:var(--radius-lg);">
        </div>
        <p class="text-sm text-muted text-center" style="margin-top:4px;">扫码添加站长微信</p>
      </div>

      <!-- 留言表单 -->
      <div class="contact-card">
        <h3>${icon('edit', 18)} 在线留言</h3>
        <form id="contact-form">
          <div class="form-group">
            <label class="form-label">姓名 <span style="color:var(--accent-red)">*</span></label>
            <input type="text" class="form-input" id="contact-name" placeholder="请输入您的姓名" required
              value="${store.getUser()?.username || ''}">
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">邮箱</label>
            <input type="email" class="form-input" id="contact-email" placeholder="选填，方便回复您">
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">留言内容 <span style="color:var(--accent-red)">*</span></label>
            <textarea class="form-input" id="contact-content" rows="5" placeholder="请输入您的留言内容..." required></textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:16px;width:100%;">提交留言</button>
        </form>
      </div>
    </div>`;

  // 表单提交
  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('contact-name').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const content = document.getElementById('contact-content').value.trim();

    if (!name || !content) {
      toast.error('请填写姓名和留言内容');
      return;
    }

    try {
      await api.sendContactMessage({ name, email, content });
      toast.success('留言已提交，站长会尽快回复您');
      document.getElementById('contact-content').value = '';
    } catch (err) {
      toast.error(err.message);
    }
  });
}
