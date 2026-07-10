/**
 * 游戏内聊天：仙界（全服）频道、仙盟频道
 * 每人每 2 秒最多 1 条，连续刷屏禁言 30 秒
 */
const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const COOLDOWN_SEC = 2;
const SPAM_THRESHOLD = 5;
const MUTE_SEC = 30;
const MAX_MESSAGES_PER_CHANNEL = 200;
const MAX_TEXT_LEN = 40;

// 仙界：全服消息 [{ id, channel, account_id, username, text, ts }]
// 仙盟：按 alliance_id 分组
const globalMessages = [];
const allianceMessages = new Map(); // alliance_id -> [{ ... }]

let nextId = 1;

// 频率限制：account_id -> { lastSend, spamCount, mutedUntil }
const rateLimit = new Map();

function intVal(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

function getOrCreateAllianceMessages(allianceId) {
  const key = intVal(allianceId, 0);
  if (!allianceMessages.has(key)) allianceMessages.set(key, []);
  return allianceMessages.get(key);
}

function trimMessages(arr, maxLen) {
  while (arr.length > maxLen) arr.shift();
}

/** 清理超过 1 小时未发言的限流记录，避免 rateLimit Map 无限增长 */
function pruneRateLimit() {
  const now = Math.floor(Date.now() / 1000);
  const maxIdle = 3600;
  for (const [accountId, state] of rateLimit.entries()) {
    const last = Math.max(state?.lastSend || 0, state?.mutedUntil || 0);
    if (now - last > maxIdle) rateLimit.delete(accountId);
  }
}

function checkRateLimit(accountId) {
  const now = Math.floor(Date.now() / 1000);
  let state = rateLimit.get(accountId);
  if (!state) {
    state = { lastSend: 0, spamCount: 0, mutedUntil: 0 };
    rateLimit.set(accountId, state);
  }
  if (now < state.mutedUntil) {
    return { ok: false, error: `发送过快，禁言中，${state.mutedUntil - now} 秒后解除` };
  }
  const elapsed = now - state.lastSend;
  if (elapsed < COOLDOWN_SEC) {
    state.spamCount = (state.spamCount || 0) + 1;
    if (state.spamCount >= SPAM_THRESHOLD) {
      state.mutedUntil = now + MUTE_SEC;
      state.spamCount = 0;
      return { ok: false, error: `发送过快，禁言 ${MUTE_SEC} 秒` };
    }
    return { ok: false, error: `请稍后再发（每 ${COOLDOWN_SEC} 秒 1 条）` };
  }
  state.lastSend = now;
  state.spamCount = 0;
  return { ok: true };
}

// GET /chat/messages - 拉取消息
router.get('/messages', (req, res) => {
  const channel = String(req.query?.channel || 'global').trim();
  const since = intVal(req.query?.since, 0);
  const allianceId = intVal(req.query?.alliance_id, 0);

  let list = [];
  if (channel === 'alliance') {
    if (allianceId <= 0) return res.json({ ok: true, messages: [] });
    list = getOrCreateAllianceMessages(allianceId);
  } else {
    list = globalMessages;
  }

  const filtered = since > 0
    ? list.filter(m => intVal(m.id, 0) > since)
    : list.slice(-80);
  res.json({ ok: true, messages: filtered });
});

// POST /chat/send - 发送消息
router.post('/send', async (req, res) => {
  const channel = String(req.body?.channel || 'global').trim();
  let text = String(req.body?.text || '').trim().slice(0, MAX_TEXT_LEN);
  if (!text) return res.json({ ok: false, error: '消息不能为空' });

  const player = await db.getPlayerByAccountId(req.accountId);
  if (!player) return res.json({ ok: false, error: '无角色数据' });
  const account = await db.getAccountById(req.accountId);
  const username = account?.username || '?';

  const rl = checkRateLimit(req.accountId);
  if (!rl.ok) return res.json({ ok: false, error: rl.error });

  const msg = {
    id: nextId++,
    channel,
    account_id: req.accountId,
    username,
    text,
    ts: Math.floor(Date.now() / 1000)
  };

  if (channel === 'alliance') {
    const aid = intVal(player.alliance_id, 0);
    if (aid <= 0) return res.json({ ok: false, error: '未加入仙盟，无法发送仙盟频道' });
    msg.alliance_id = aid;
    const arr = getOrCreateAllianceMessages(aid);
    arr.push(msg);
    trimMessages(arr, MAX_MESSAGES_PER_CHANNEL);
  } else {
    msg.channel = 'global';
    globalMessages.push(msg);
    trimMessages(globalMessages, MAX_MESSAGES_PER_CHANNEL);
  }

  res.json({ ok: true, msg });
});

module.exports = router;
module.exports.pruneRateLimit = pruneRateLimit;
