// pages/leaderboard.js — 排行榜页

import { api } from '../api.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

let currentTab = 'purchase';

const TABS = [
  { id: 'purchase', label: '消费榜' },
  { id: 'invite', label: '邀请榜' },
  { id: 'level', label: '等级榜' },
];

export async function renderLeaderboard({ container }) {
  container.innerHTML = `
    <div class="page-header">
      <h2>排行榜</h2>
      <p>查看全服排名</p>
    </div>
    <div class="filter-bar mb-4">
      ${TABS.map(t => `
        <button class="btn ${t.id === currentTab ? 'btn-primary' : 'btn-secondary'} btn-sm" data-tab="${t.id}">
          ${t.label}
        </button>
      `).join('')}
    </div>
    <div id="leaderboard-content">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  // 绑定 tab 切换
  container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderLeaderboard({ container });
    });
  });

  loadLeaderboard();
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-content');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await api.getLeaderboard(currentTab);
    const list = res.leaderboard || res || [];
    const user = store.getUser();

    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><p>暂无数据</p></div>`;
      return;
    }

    const medalSvgs = ['medal1', 'medal2', 'medal3'];

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:60px;">排名</th>
              <th>用户</th>
              <th>${currentTab === 'purchase' ? '消费金额' : currentTab === 'invite' ? '邀请人数' : '等级'}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((item, i) => {
              const isMe = item.user_id === user?.id || item.id === user?.id;
              return `
                <tr${isMe ? ' style="background:var(--accent-blue-light);"' : ''}>
                  <td class="font-semibold">${i < 3 ? icon(medalSvgs[i], 18) : i + 1}</td>
                  <td>
                    ${item.username || item.name || '-'}
                    ${isMe ? '<span class="text-xs text-muted" style="margin-left:4px;">(我)</span>' : ''}
                  </td>
                  <td class="font-semibold">
                    ${currentTab === 'purchase' ? '¥' + (item.total_spent || item.value || 0).toFixed(2) 
                      : currentTab === 'invite' ? (item.total_invited || item.value || 0) + '人'
                      : 'Lv.' + (item.level || item.value || 1)}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
