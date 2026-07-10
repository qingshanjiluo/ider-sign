const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const emailService = require('../services/emailService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_COOLDOWN_SECONDS = 60;

// ──── 需要登录的接口 ────
router.use('/send-code', authMiddleware);
router.use('/bind', authMiddleware);
router.use('/unbind', authMiddleware);
router.use('/status', authMiddleware);

// GET /email/status — 查询当前邮箱绑定状态
router.get('/status', async (req, res) => {
  const info = await db.getAccountEmail(req.accountId);
  const email = String(info.email || '');
  const verified = Number(info.email_verified) === 1;
  let masked = '';
  if (email && verified) {
    const [local, domain] = email.split('@');
    masked = local.length <= 2
      ? local[0] + '***@' + domain
      : local[0] + '***' + local.slice(-1) + '@' + domain;
  }
  res.json({ ok: true, bound: verified, email: masked });
});

// POST /email/send-code — 发送绑定验证码
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
      return res.json({ ok: false, error: '邮箱格式不正确' });
    }
    const normalEmail = String(email).trim().toLowerCase();

    if (await db.isEmailTaken(normalEmail)) {
      return res.json({ ok: false, error: '该邮箱已被其他账号绑定' });
    }

    const lastTime = await db.getRecentEmailCodeTime(req.accountId);
    const now = Math.floor(Date.now() / 1000);
    if (lastTime > 0 && (now - lastTime) < CODE_COOLDOWN_SECONDS) {
      const wait = CODE_COOLDOWN_SECONDS - (now - lastTime);
      return res.json({ ok: false, error: `请${wait}秒后再试` });
    }

    const code = await db.createEmailVerificationCode(req.accountId, normalEmail);
    await emailService.sendVerificationCode(normalEmail, code);
    res.json({ ok: true, msg: '验证码已发送，请查收邮箱' });
  } catch (e) {
    console.error('[email/send-code] error:', e);
    res.json({ ok: false, error: '发送失败，请稍后重试' });
  }
});

// POST /email/bind — 验证码校验并绑定邮箱
router.post('/bind', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.json({ ok: false, error: '缺少邮箱或验证码' });
    }
    const normalEmail = String(email).trim().toLowerCase();

    if (await db.isEmailTaken(normalEmail)) {
      return res.json({ ok: false, error: '该邮箱已被其他账号绑定' });
    }

    const ok = await db.verifyEmailCode(req.accountId, normalEmail, String(code).trim());
    if (!ok) {
      return res.json({ ok: false, error: '验证码错误或已过期' });
    }

    await db.bindAccountEmail(req.accountId, normalEmail);
    res.json({ ok: true, msg: '邮箱绑定成功' });
  } catch (e) {
    console.error('[email/bind] error:', e?.message || e);
    res.json({ ok: false, error: '绑定失败' });
  }
});

// POST /email/unbind — 解绑邮箱
router.post('/unbind', async (req, res) => {
  try {
    const info = await db.getAccountEmail(req.accountId);
    if (!info.email || Number(info.email_verified) !== 1) {
      return res.json({ ok: false, error: '当前未绑定邮箱' });
    }
    await db.unbindAccountEmail(req.accountId);
    res.json({ ok: true, msg: '邮箱已解绑' });
  } catch (e) {
    console.error('[email/unbind] error:', e?.message || e);
    res.json({ ok: false, error: '解绑失败' });
  }
});

// POST /email/change-password — 已登录用户修改密码（需已绑定邮箱 + 验证码）
router.use('/change-password', authMiddleware);
router.post('/change-password/send-code', async (req, res) => {
  try {
    const info = await db.getAccountEmail(req.accountId);
    if (!info.email || Number(info.email_verified) !== 1) {
      return res.json({ ok: false, error: '请先绑定邮箱' });
    }
    const lastTime = await db.getRecentEmailCodeTime(req.accountId);
    const now = Math.floor(Date.now() / 1000);
    if (lastTime > 0 && (now - lastTime) < CODE_COOLDOWN_SECONDS) {
      const wait = CODE_COOLDOWN_SECONDS - (now - lastTime);
      return res.json({ ok: false, error: `请${wait}秒后再试` });
    }
    const code = await db.createEmailVerificationCode(req.accountId, info.email);
    await emailService.sendVerificationCode(info.email, code);
    res.json({ ok: true, msg: '验证码已发送' });
  } catch (e) {
    console.error('[email/change-password/send-code] error:', e?.message || e);
    res.json({ ok: false, error: '发送失败，请稍后重试' });
  }
});

router.post('/change-password/confirm', async (req, res) => {
  try {
    const { code, new_password } = req.body || {};
    if (!code || !new_password) {
      return res.json({ ok: false, error: '缺少验证码或新密码' });
    }
    if (String(new_password).length < 6) {
      return res.json({ ok: false, error: '新密码至少 6 位' });
    }
    const info = await db.getAccountEmail(req.accountId);
    if (!info.email || Number(info.email_verified) !== 1) {
      return res.json({ ok: false, error: '请先绑定邮箱' });
    }
    const ok = await db.verifyEmailCode(req.accountId, info.email, String(code).trim());
    if (!ok) {
      return res.json({ ok: false, error: '验证码错误或已过期' });
    }
    await db.updateAccountPassword(req.accountId, new_password);
    res.json({ ok: true, msg: '密码修改成功' });
  } catch (e) {
    console.error('[email/change-password/confirm] error:', e?.message || e);
    res.json({ ok: false, error: '修改失败' });
  }
});

// ──── 不需要登录的接口（密码找回） ────

// POST /email/forgot-password/send-code — 发送密码重置验证码
router.post('/forgot-password/send-code', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
      return res.json({ ok: false, error: '邮箱格式不正确' });
    }
    const normalEmail = String(email).trim().toLowerCase();
    const acc = await db.getAccountByEmail(normalEmail);
    if (!acc) {
      return res.json({ ok: false, error: '该邮箱未绑定任何账号' });
    }

    const lastTime = await db.getRecentEmailCodeTime(acc.id);
    const now = Math.floor(Date.now() / 1000);
    if (lastTime > 0 && (now - lastTime) < CODE_COOLDOWN_SECONDS) {
      const wait = CODE_COOLDOWN_SECONDS - (now - lastTime);
      return res.json({ ok: false, error: `请${wait}秒后再试` });
    }

    const code = await db.createEmailVerificationCode(acc.id, normalEmail);
    await emailService.sendPasswordResetCode(normalEmail, code);
    res.json({ ok: true, msg: '验证码已发送' });
  } catch (e) {
    console.error('[email/forgot-password/send-code] error:', e?.message || e);
    res.json({ ok: false, error: '发送失败，请稍后重试' });
  }
});

// POST /email/forgot-password/reset — 验证码 + 新密码 → 重置密码
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, code, new_password } = req.body || {};
    if (!email || !code || !new_password) {
      return res.json({ ok: false, error: '缺少必要参数' });
    }
    if (String(new_password).length < 6) {
      return res.json({ ok: false, error: '新密码至少 6 位' });
    }
    const normalEmail = String(email).trim().toLowerCase();
    const acc = await db.getAccountByEmail(normalEmail);
    if (!acc) {
      return res.json({ ok: false, error: '该邮箱未绑定任何账号' });
    }

    const ok = await db.verifyEmailCode(acc.id, normalEmail, String(code).trim());
    if (!ok) {
      return res.json({ ok: false, error: '验证码错误或已过期' });
    }

    await db.updateAccountPassword(acc.id, new_password);
    res.json({ ok: true, msg: '密码重置成功，请用新密码登录' });
  } catch (e) {
    console.error('[email/forgot-password/reset] error:', e?.message || e);
    res.json({ ok: false, error: '重置失败' });
  }
});

module.exports = router;
