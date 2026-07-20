// icons.js — SVG 图标库
// 所有图标均为 16x16 viewBox，可通过 CSS 调整大小

export const ICONS = {
  // ── 导航图标 ──
  diamond: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 15,6 8,15 1,6"/></svg>',
  diamondSolid: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 15,5.5 8,14 1,5.5"/></svg>',
  diamondOutline: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="8,1.5 14.5,6 8,14 1.5,6"/></svg>',
  star: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 10.5,5.5 15.5,6.5 12,10 12.5,15 8,13 3.5,15 4,10 0.5,6.5 5.5,5.5"/></svg>',
  triangle: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 14,13 2,13"/></svg>',
  circle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/></svg>',
  question: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="8" y="11" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor">?</text></svg>',
  mail: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5"/><polyline points="1,4 8,10 15,4"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 0 0-.7.04l-.3.75-1.2.4-.6-.6-.7.7.6.6-.4 1.2-.75.3A7 7 0 0 0 1 8a7 7 0 0 0 .04.7l.75.3.4 1.2-.6.6.7.7.6-.6 1.2.4.3.75A7 7 0 0 0 8 15a7 7 0 0 0 .7-.04l.3-.75 1.2-.4.6.6.7-.7-.6-.6.4-1.2.75-.3A7 7 0 0 0 15 8a7 7 0 0 0-.04-.7l-.75-.3-.4-1.2.6-.6-.7-.7-.6.6-1.2-.4-.3-.75A7 7 0 0 0 8 1zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>',
  square: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/></svg>',
  triangleUp: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,2 14,12 2,12"/></svg>',
  arrowRight: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="3,1 13,8 3,15"/></svg>',
  starFilled: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 10.5,5.5 15.5,6.5 12,10 12.5,15 8,13 3.5,15 4,10 0.5,6.5 5.5,5.5"/></svg>',
  menu: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="11" width="14" height="2" rx="1"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>',

  // ── 功能图标 ──
  robot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="14" rx="2"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/><circle cx="15" cy="11" r="1.5" fill="currentColor"/><path d="M9 15c0 0 2 2 6 0"/><line x1="12" y1="4" x2="12" y2="6"/><line x1="8" y1="2" x2="10" y2="6"/><line x1="16" y1="2" x2="14" y2="6"/></svg>',
  announcement: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-2.2 0-4 1.8-4 4v2l-1.5 2.5h11L12 7.5v-2c0-2.2-1.8-4-4-4zM6 13a2 2 0 0 0 4 0"/></svg>',
  lightning: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="9,1 3,9 7,9 6,15 13,7 9,7"/></svg>',
  shield: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1l6 2v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V3l6-2z"/><polyline points="5,8 7,10 11,6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  chart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="11" width="3" height="4"/><rect x="6" y="7" width="3" height="8"/><rect x="11" y="3" width="3" height="12"/></svg>',
  gem: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 15,6 12,15 4,15 1,6"/><polygon points="8,3 12,6 10,12 6,12 4,6"/></svg>',
  rocket: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1c0 0-5 3-5 8l5 5 5-5c0-5-5-8-5-8z"/><circle cx="8" cy="7" r="2" fill="currentColor"/><path d="M4 12l-2 3"/><path d="M12 12l2 3"/><path d="M8 14v1"/></svg>',
  phone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 1h9a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z"/><circle cx="8" cy="12.5" r="1" fill="currentColor"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1l3 3-9 9H3v-3z"/></svg>',
  book: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="1" width="12" height="14" rx="1"/><line x1="5" y1="4" x2="11" y2="4"/><line x1="5" y1="7" x2="9" y2="7"/><path d="M2 11h2v4l2-2 2 2v-4"/></svg>',
  bulb: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1a5 5 0 0 0-3 9c0 1 1 2 1 3h4c0-1 1-2 1-3a5 5 0 0 0-3-9z"/><line x1="6" y1="13" x2="10" y2="13"/><line x1="7" y1="15" x2="9" y2="15"/></svg>',
  money: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="5" width="14" height="8" rx="1"/><circle cx="8" cy="9" r="2.5" fill="currentColor"/><path d="M3 5V3h10v2"/></svg>',
  trophy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 13h6v2H5z"/><path d="M5 12c-2 0-4-2-4-4V5h3"/><path d="M11 12c2 0 4-2 4-4V5h-3"/><path d="M5 2h6v7a3 3 0 0 1-6 0V2z"/></svg>',
  medal1: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M8 9L6 15l2-2 2 2-2-6z"/></svg>',
  medal2: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5" r="4"/><path d="M8 9l-2 6 2-2 2 2-2-6z"/></svg>',
  medal3: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5" r="4"/><path d="M8 9l-2 6 2-2 2 2-2-6z"/></svg>',
  arrowSm: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,4 10,8 6,12"/></svg>',

  // ── 特殊符号替代 ──
  asterisk: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="8,1 9.5,6 14.5,4 11,8 14.5,12 9.5,10 8,15 6.5,10 1.5,12 5,8 1.5,4 6.5,6"/></svg>',
  dot: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/></svg>',
};

/**
 * 将图标 SVG 转为带样式的 HTML 字符串
 * @param {string} name - 图标名称（ICONS 的 key）
 * @param {number} size - 图标大小（px），默认 16
 * @param {string} className - 额外 CSS 类
 * @returns {string}
 */
export function icon(name, size = 16, className = '') {
  const svg = ICONS[name];
  if (!svg) return '';
  const cls = className ? ` class="${className}"` : '';
  return svg.replace('<svg', `<svg width="${size}" height="${size}"${cls}`);
}
