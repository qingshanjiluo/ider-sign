// toast.js — Toast 通知组件

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function show(message, type = 'info', duration = 3000) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  c.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export const toast = {
  success: (msg, duration) => show(msg, 'success', duration),
  error: (msg, duration) => show(msg, 'error', duration),
  info: (msg, duration) => show(msg, 'info', duration),
};
