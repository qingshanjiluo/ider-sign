/**
 * 设备标识：用于 WEB 端多开检测，替代原生客户端的机器码
 * 收集浏览器特征生成相对稳定的唯一标识
 */
const FP_PREFIX = 'web_';
let _cached = null;

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function canvasId() {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 50;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 100, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('device-check', 2, 15);
    return c.toDataURL().slice(-50);
  } catch (_) { return ''; }
}

export function getBrowserFingerprint() {
  if (_cached) return _cached;
  const n = navigator;
  const s = screen;
  const parts = [
    n.userAgent,
    n.language,
    (n.languages || []).join(','),
    n.platform,
    n.hardwareConcurrency || 0,
    n.deviceMemory || 0,
    s.width, s.height, s.colorDepth, (s.devicePixelRatio || 1),
    new Date().getTimezoneOffset(),
    n.maxTouchPoints || 0,
    !!window.sessionStorage,
    !!window.localStorage,
    canvasId()
  ];
  const str = parts.join('|');
  const hash = djb2(str);
  _cached = FP_PREFIX + hash;
  return _cached;
}
