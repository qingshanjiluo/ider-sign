// pages/admin-stats.js — 管理后台 - 数据统计
// 所有金额统一以人民币（元）显示
// 转换比例: 1元 = 400修仙币, 100万灵石 = 10修仙币

import { api } from '../api.js';
import { toast } from '../components/toast.js';

// 修仙币 → 元
function toYuan(coins) {
  return ((coins || 0) / 400);
}

export async function renderAdminStats({ container }) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const stats = await api.adminGetStats();

    container.innerHTML = `
      <div class="page-header">
        <h2>数据统计</h2>
        <p>系统运营数据概览 · 所有金额已按 1元=400修仙币 换算</p>
      </div>

      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-label">总用户</div>
          <div class="stat-value">${(stats.total_users || 0).toLocaleString()} <span class="text-xs text-muted">人</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">总工单</div>
          <div class="stat-value">${(stats.total_orders || 0).toLocaleString()} <span class="text-xs text-muted">单</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">总营收</div>
          <div class="stat-value">¥${toYuan(stats.total_revenue).toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">今日工单</div>
          <div class="stat-value" style="color:var(--accent-green)">${stats.today_orders || 0} <span class="text-xs text-muted">单</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">今日营收</div>
          <div class="stat-value" style="color:var(--accent-green)">¥${toYuan(stats.today_revenue).toFixed(2)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">本周工单</div>
          <div class="stat-value">${stats.weekly_orders || 0} <span class="text-xs text-muted">单</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">待审批</div>
          <div class="stat-value" style="color:var(--accent-amber)">${stats.pending_orders || 0} <span class="text-xs text-muted">单</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">进行中</div>
          <div class="stat-value" style="color:var(--accent-blue)">${stats.active_orders || 0} <span class="text-xs text-muted">单</span></div>
        </div>
      </div>

      ${stats.daily_trend && stats.daily_trend.length ? `
      <div class="card">
        <div class="card-header">
          <h3>近7日营收趋势</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>工单数</th><th>营收</th></tr></thead>
            <tbody>
              ${stats.daily_trend.map(d => `
                <tr>
                  <td>${d.day}</td>
                  <td>${d.cnt || 0} <span class="text-xs text-muted">单</span></td>
                  <td class="font-semibold">¥${toYuan(d.revenue).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}
}
