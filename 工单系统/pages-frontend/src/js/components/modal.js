// modal.js — 模态框组件

let overlay = null;

function ensureOverlay() {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * 打开模态框
 * @param {Object} options
 * @param {string} options.title - 标题
 * @param {string|HTMLElement} options.body - 内容
 * @param {string} options.confirmText - 确认按钮文字
 * @param {string} options.cancelText - 取消按钮文字
 * @param {Function} options.onConfirm - 确认回调
 * @param {Function} options.onCancel - 取消回调
 * @param {boolean} options.showFooter - 是否显示底部按钮
 */
export function open({ title = '', body = '', confirmText = '确认', cancelText = '取消', onConfirm, onCancel, showFooter = true }) {
  const o = ensureOverlay();
  o.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="btn btn-ghost btn-sm modal-close-btn">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${showFooter ? `
      <div class="modal-footer">
        <button class="btn btn-secondary modal-cancel-btn">${cancelText}</button>
        <button class="btn btn-primary modal-confirm-btn">${confirmText}</button>
      </div>` : ''}
    </div>`;

  const bodyEl = o.querySelector('.modal-body');
  if (typeof body === 'string') {
    bodyEl.innerHTML = body;
  } else if (body instanceof HTMLElement) {
    bodyEl.appendChild(body);
  }

  // 事件绑定
  o.querySelector('.modal-close-btn')?.addEventListener('click', close);
  o.querySelector('.modal-cancel-btn')?.addEventListener('click', () => {
    if (onCancel) onCancel();
    close();
  });
  o.querySelector('.modal-confirm-btn')?.addEventListener('click', () => {
    if (onConfirm) onConfirm();
  });

  // 激活动画
  requestAnimationFrame(() => o.classList.add('active'));

  return o;
}

export function close() {
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => { overlay.innerHTML = ''; }, 300);
  }
}

/**
 * 确认对话框
 */
export function confirm(title, message) {
  return new Promise((resolve) => {
    open({
      title,
      body: `<p>${message}</p>`,
      onConfirm: () => { close(); resolve(true); },
      onCancel: () => { resolve(false); },
    });
  });
}

export const modal = { open, close, confirm };
