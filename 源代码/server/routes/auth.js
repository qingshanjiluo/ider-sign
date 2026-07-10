const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { signToken } = require('../middleware/auth');

function normalizeIp(rawIp) {
  const ip = String(rawIp || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function getRegisterIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim() !== '') {
    const first = xff.split(',')[0];
    return normalizeIp(first);
  }
  const rip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(rip);
}

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, password, machine_id } = req.body || {};
  if (!username || !password) {
    return res.json({ ok: false, error: '缺少用户名或密码' });
  }
  const machineId = String(machine_id || '').trim();
  if (username.length < 2 || username.length > 20) {
    return res.json({ ok: false, error: '用户名 2-20 字符' });
  }
  if (password.length < 6) {
    return res.json({ ok: false, error: '密码至少 6 位' });
  }
  const registerIp = getRegisterIp(req);
  if (registerIp && typeof db.isIpBanned === 'function' && await db.isIpBanned(registerIp)) {
    return res.json({ ok: false, error: '该IP已被封禁，禁止注册' });
  }
  try {
    // 阻止大小写不同的同名注册（如 bszx / Bszx），减少玩家混淆
    const checkDup = await db.getAccountByUsernameCaseInsensitive(username);
    if (checkDup) {
      return res.json({ ok: false, error: '用户名已存在' });
    }
    await db.createAccount(username, password, { registerIp, machineId });
    const acc = await db.getAccountByUsername(username);
    const token = signToken(acc.id, acc.username);
    res.json({ ok: true, token, accountId: acc.id });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'ER_DUP_ENTRY') {
      return res.json({ ok: false, error: '用户名已存在' });
    }
    console.error('[auth/register] unexpected error:', e);
    return res.json({ ok: false, error: '注册失败，请稍后重试' });
  }
});

function isAccountBanned(acc) {
  if (Number(acc?.is_banned || 0) <= 0) return false;
  const expiresAt = Number(acc.ban_expires_at || 0);
  if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  return true;
}

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password, machine_id } = req.body || {};
    if (!username || !password) {
      return res.json({ ok: false, error: '缺少用户名或密码' });
    }
    const acc = await db.getAccountByUsername(username);
    const verify = acc
      ? (typeof db.verifyPasswordDetailed === 'function'
        ? await db.verifyPasswordDetailed(password, acc.password_hash)
        : { ok: await db.verifyPassword(password, acc.password_hash), needsRehash: false })
      : { ok: false, needsRehash: false };
    if (!acc || !verify.ok) {
      return res.json({ ok: false, error: '用户名或密码错误' });
    }
    if (verify.needsRehash) {
      try {
        // 旧 pepper 验证通过后，登录时自动升级为当前 pepper。
        await db.updateAccountPassword(acc.id, password);
      } catch (e) {
        console.error('[auth/login] 密码重哈希升级失败:', e?.message, e?.stack);
      }
    }
    await db.clearExpiredBan(acc.id);
    const accFresh = await db.getAccountById(acc.id);
    if (isAccountBanned(accFresh)) {
      const reason = String(accFresh.ban_reason || '').trim();
      return res.json({ ok: false, error: reason ? `账号已封禁：${reason}` : '账号已封禁' });
    }
    const machineId = String(machine_id || '').trim();
    const loginIp = getRegisterIp(req);
    if (machineId) {
      try {
        await db.insertMachineLoginLog(acc.id, machineId);
        await db.updateAccountMachineId(acc.id, machineId);
      } catch (_) {}
    }
    if (loginIp) {
      try {
        await db.updateAccountLoginIp(acc.id, loginIp);
        const accountIds = await db.getAccountsByLoginIp(loginIp);
        const activeAccountIds = [];
        for (const aid of accountIds) {
          const p = await db.getPlayerByAccountId(aid);
          if (p && typeof p === 'object' && Object.keys(p).length > 0 && Number(p.level) > 0) {
            activeAccountIds.push(aid);
          }
        }
        if (activeAccountIds.length > 3) {
          const players = [];
          for (const aid of activeAccountIds) {
            players.push({ accountId: aid, player: await db.getPlayerByAccountId(aid) });
          }
          players.sort((a, b) => {
            const lvA = Number(a.player?.level || 0);
            const lvB = Number(b.player?.level || 0);
            if (lvB !== lvA) return lvB - lvA;
            const expA = Number(a.player?.exp || 0);
            const expB = Number(b.player?.exp || 0);
            return expB - expA;
          });
          const bannedSet = new Set();
          for (let i = 3; i < players.length; i++) {
            const aid = players[i].accountId;
            if (await db.isMachineShareExempt(aid)) continue;
            const count = (await db.getMachineShareBanCount(aid)) + 1;
            let expiresAt = 0;
            let reason = '同IP多号';
            if (count === 1) {
              expiresAt = Math.floor(Date.now() / 1000) + 3 * 86400;
              reason = '同IP多号，封禁3天';
            } else if (count === 2) {
              expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
              reason = '同IP多号再次违规，封禁7天';
            } else {
              reason = '同IP多号屡次违规，永久封禁';
            }
            await db.banAccountMachineShare(aid, reason, expiresAt);
            bannedSet.add(aid);
          }
          if (bannedSet.has(acc.id)) {
            const a2 = await db.getAccountById(acc.id);
            return res.json({ ok: false, error: `账号已封禁：${a2.ban_reason || '多号检测'}` });
          }
        }
      } catch (e) {
        console.error('[auth/login] IP多号检测异常，跳过:', e?.message, e?.stack);
      }
    }
    const token = signToken(acc.id, acc.username);
    return res.json({ ok: true, token, accountId: acc.id });
  } catch (e) {
    console.error('[auth/login] 未捕获异常:', e?.message, e?.stack);
    return res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});

module.exports = router;
