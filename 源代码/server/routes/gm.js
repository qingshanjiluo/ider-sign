/**
 * GM 管理路由
 * 
 * 所有 GM 接口需要 X-GM-Token 鉴权
 * 配置项：config.gmToolToken
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const dbAsync = require('../dbAsync');
const accountBanCache = require('../game/accountBanCache');
const config = require('../config');

// GM Token 鉴权中间件
function requireGmToken(req, res, next) {
    const token = String(req.headers['x-gm-token'] || req.query.token || '').trim();
    if (!token || token !== config.gmToolToken) {
        return res.status(403).json({ ok: false, error: 'GM Token 无效' });
    }
    next();
}

// 所有 GM 路由都需要鉴权
router.use(requireGmToken);

/**
 * POST /gm/unban
 * 解封账号
 * Body: { username: string }
 */
router.post('/unban', async (req, res) => {
    try {
        const { username } = req.body || {};
        if (!username) {
            return res.json({ ok: false, error: '缺少用户名' });
        }

        const acc = db.getAccountByUsername(username);
        if (!acc) {
            return res.json({ ok: false, error: '账号不存在' });
        }

        const aid = Number(acc.id);
        // 直接解封：清除封禁状态
        const Database = require('better-sqlite3');
        const dbf = new Database(config.dbPath);
        dbf.prepare("UPDATE accounts SET is_banned = 0, ban_reason = '', banned_at = 0, ban_expires_at = 0 WHERE id = ?").run(aid);
        dbf.close();
        // 清除缓存
        accountBanCache.mark(aid, false);

        return res.json({ ok: true, message: '账号 ' + username + ' 已解封' });
    } catch (e) {
        console.error('[gm/unban] error:', e && e.message, e && e.stack);
        return res.status(500).json({ ok: false, error: '解封失败: ' + (e && e.message) });
    }
});

/**
 * POST /gm/ban
 * 封禁账号
 * Body: { username: string, reason?: string, expiresAt?: number }
 */
router.post('/ban', async (req, res) => {
    try {
        const { username, reason, expiresAt } = req.body || {};
        if (!username) {
            return res.json({ ok: false, error: '缺少用户名' });
        }

        const acc = db.getAccountByUsername(username);
        if (!acc) {
            return res.json({ ok: false, error: '账号不存在' });
        }

        const aid = Number(acc.id);
        db.setAccountBanned(aid, reason || 'GM 操作', Number(expiresAt) || 0);
        accountBanCache.mark(aid, true);

        return res.json({ ok: true, message: '账号 ' + username + ' 已封禁' });
    } catch (e) {
        console.error('[gm/ban] error:', e && e.message, e && e.stack);
        return res.status(500).json({ ok: false, error: '封禁失败: ' + (e && e.message) });
    }
});

/**
 * GET /gm/status
 * 查询账号状态
 * Query: ?username=xxx
 */
router.get('/status', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (!username) {
            return res.json({ ok: false, error: '缺少用户名' });
        }

        const acc = db.getAccountByUsername(username);
        if (!acc) {
            return res.json({ ok: false, error: '账号不存在' });
        }

        return res.json({
            ok: true,
            data: {
                id: acc.id,
                username: acc.username,
                is_banned: Number(acc.is_banned || 0) > 0,
                ban_reason: acc.ban_reason || '',
                banned_at: Number(acc.banned_at || 0),
                ban_expires_at: Number(acc.ban_expires_at || 0),
                machine_share_ban_count: Number(acc.machine_share_ban_count || 0)
            }
        });
    } catch (e) {
        console.error('[gm/status] error:', e && e.message);
        return res.status(500).json({ ok: false, error: '查询失败' });
    }
});

module.exports = router;
