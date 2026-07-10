#!/usr/bin/env node
/**
 * 检查 .env 和 config 中的 JWT_SECRET 是否正确加载
 * 用法: cd server && node check_env.js
 */
require('dotenv').config();
const config = require('./config');
const secret = config.jwtSecret || process.env.JWT_SECRET || '';
const pepper = String(config.passwordPepper || '').trim();
const legacy = Array.isArray(config.legacyPasswordPeppers)
	? config.legacyPasswordPeppers
	: [config.legacyPasswordPepper].filter(Boolean);
console.log('[check_env] JWT_SECRET 长度:', secret.length, '(应为64)');
console.log('[check_env] JWT_SECRET 前8位:', secret ? secret.slice(0, 8) + '...' : '(空，未加载!)');
console.log('[check_env] PASSWORD_PEPPER 长度:', pepper.length, '(建议与 JWT 独立)');
console.log('[check_env] LEGACY_PASSWORD_PEPPERS 数量:', legacy.length);
console.log('[check_env] 提示: 迁移期请把旧值放到 LEGACY_PASSWORD_PEPPERS（逗号分隔）');
