// _auth.js - 认证模块
import { constantTimeEqual } from './_utils.js';

export async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const result = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!result) return null;
  if (new Date(result.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const user = await env.DB.prepare(
    'SELECT id, username, display_name, level, xp, total_orders, total_spent, invite_code, invited_by, invite_points, total_invited, commission_rate, email, avatar_url, bio, is_admin, role, locked, bonus_points FROM users WHERE id = ?'
  ).bind(result.user_id).first();
  return user;
}

/**
 * 时序安全的 API Key 比较
 * 使用恒定时间比较防止时序攻击
 */
export function authenticateApi(request, env) {
  const key = request.headers.get('X-API-Key') || '';
  return constantTimeEqual(key, env.API_KEY || '');
}

/**
 * 校验当前用户是否为管理员（admin 或 super_admin）
 * 兼容旧数据：is_admin=1 但不包含 role 的用户也视为管理员
 * @param {object} user - authenticate() 返回的用户对象
 * @returns {boolean}
 */
export function isAdmin(user) {
  if (!user) return false;
  return user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';
}

/**
 * 校验当前用户是否为超级管理员
 * @param {object} user - authenticate() 返回的用户对象
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  return user.role === 'super_admin';
}

/**
 * 认证并校验管理员身份
 * 返回 { user, error }，error 非空时代表校验失败
 */
export async function authenticateAdmin(request, env) {
  const user = await authenticate(request, env);
  if (!user) return { user: null, error: '未登录' };
  if (!isAdmin(user)) return { user: null, error: '权限不足，需要管理员身份' };
  return { user, error: null };
}

/**
 * 认证并校验超级管理员身份
 */
export async function authenticateSuperAdmin(request, env) {
  const user = await authenticate(request, env);
  if (!user) return { user: null, error: '未登录' };
  if (!isSuperAdmin(user)) return { user: null, error: '权限不足，需要超级管理员身份' };
  return { user, error: null };
}
