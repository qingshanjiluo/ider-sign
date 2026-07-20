// functions/api/gh/report-trial-test.js — POST /api/gh/report-trial-test
import { json } from '../../_utils.js';
import { authenticateApi } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authenticateApi(request, env)) return json({ error: '无效API密钥' }, 403);

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS trial_test_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, report_json TEXT, summary TEXT, api_base TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"
  ).run();

  const body = await request.json().catch(() => ({}));
  const report = body.report;
  if (!report) return json({ ok: false, error: '缺少 report' });

  const summary = report.summary || {};
  const envInfo = report.environment || {};

  await env.DB.prepare(
    "INSERT INTO trial_test_logs (report_json, summary, api_base, created_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(
    JSON.stringify(report),
    JSON.stringify(summary),
    envInfo.apiBase || ''
  ).run();

  return json({
    ok: true,
    message: '测试结果已保存',
    summary: {
      totalDungeons: summary.totalDungeons || 0,
      passableDungeons: summary.dungeonsWithPassable || 0,
      globalBest: summary.globalBest || {},
    },
  });
}
