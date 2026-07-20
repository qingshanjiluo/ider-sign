// _utils.js - 工具函数
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

// ── 密码哈希（PBKDF2，自动升级旧 SHA-256） ──────────

// 检测是否为旧的 SHA-256 十六进制哈希格式
export function isLegacyHash(hash) {
  return /^[a-f0-9]{64}$/.test(hash);
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 恒定时间字符串比较（防时序攻击）
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// PBKDF2 哈希密码（输出格式: pbkdf2:iterations:salt_b64:hash_b64）
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = uint8ArrayToBase64(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const iterations = 100000;
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashB64 = uint8ArrayToBase64(new Uint8Array(hash));
  return `pbkdf2:${iterations}:${saltB64}:${hashB64}`;
}

// 验证密码（兼容旧 SHA-256 和新 PBKDF2 格式）
export async function verifyPassword(pw, storedHash) {
  if (!storedHash) return false;

  // 旧格式 SHA-256
  if (isLegacyHash(storedHash)) {
    const encoder = new TextEncoder();
    const data = encoder.encode('ider:' + pw + ':order-system');
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hexHash = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return constantTimeEqual(hexHash, storedHash);
  }

  // 新格式 PBKDF2
  const parts = storedHash.split(':');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const salt = base64ToUint8Array(parts[2]);
  const expectedHashB64 = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pw),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashB64 = uint8ArrayToBase64(new Uint8Array(hash));
  return constantTimeEqual(hashB64, expectedHashB64);
}

export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

export async function logActivity(env, orderId, userId, action, detail) {
  await env.DB.prepare(
    "INSERT INTO order_activities (order_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).bind(orderId, userId, action, detail || '').run();
}

// 生成8位随机兑换码（大写字母+数字）
export function generateRechargeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
