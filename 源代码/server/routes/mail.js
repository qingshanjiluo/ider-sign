const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const ops = require('../game/playerOps');
const { settleBackgroundJobsForPlayer } = require('../game/backgroundJobs');
const { getItemById } = require('../game/dataLoader');
const { rollEquipmentFromTemplateItem, getPlayerAffixQualityCap } = require('./online');
const settlementLock = require('../game/settlementLock');

router.use(authMiddleware);

function applyMailAttachmentsToPlayer(player, attachments) {
  for (const a of attachments) {
    const kind = String(a?.kind || '');
    if (kind === 'currency') {
      const currency = String(a?.currency || '');
      const amount = Math.floor(Math.max(0, Number(a?.amount || 0)));
      if (currency === 'spirit_stones' && amount > 0) {
        player.spirit_stones = (Number(player.spirit_stones) || 0) + amount;
      }
    } else if (kind === 'item') {
      const count = Math.floor(Math.max(1, Number(a?.count || 1)));
      const itemId = Math.floor(Number(a?.item_id || 0));
      const dynamicRoll = Boolean(a?.dynamic_roll) && itemId > 0;
      if (dynamicRoll) {
        const template = getItemById(itemId);
        if (!template || Object.keys(template).length === 0) {
          return { ok: false, error: '邮件附件异常' };
        }
        const affixCap = getPlayerAffixQualityCap(Number(player.level) || 1);
        for (let i = 0; i < count; i += 1) {
          const rolled = rollEquipmentFromTemplateItem(template, affixCap) || template;
          const ok = ops.putItemInInventory(player.inventory, rolled, 1);
          if (!ok) return { ok: false, error: '背包已满，领取失败' };
        }
        continue;
      }
      let item = a?.item || {};
      // 兼容旧邮件：仅保存了 item_id / item_name，没有完整 item 快照
      if ((!item || typeof item !== 'object' || Object.keys(item).length === 0) && itemId > 0) item = getItemById(itemId);
      if (!item || typeof item !== 'object' || Object.keys(item).length === 0) {
        return { ok: false, error: '邮件附件异常' };
      }
      const ok = ops.putItemInInventory(player.inventory, item, count);
      if (!ok) return { ok: false, error: '背包已满，领取失败' };
    }
  }
  return { ok: true };
}

async function claimOneMail(accountId, mailId) {
  return db.claimMailboxAtomic(accountId, mailId, (player, attachments) => {
    // 兜底规范背包结构，避免历史脏数据导致领取成功但未实际入包
    player.inventory = ops.ensureInventoryStructure(player.inventory || []);
    return applyMailAttachmentsToPlayer(player, Array.isArray(attachments) ? attachments : []);
  });
}

// GET /mail/list
router.get('/list', async (req, res) => {
  // 交易所到期结算兼容：用户仅打开邮件页时，也应及时看到挂单到期退回邮件。
  try {
    await db.settleExpiredExchangeListings();
  } catch (e) {
    console.warn('[mail/list] settleExpiredExchangeListings failed:', e?.message || e);
  }

  // 邮件列表查询前做一次按需百艺结算，确保“刚完成”的产物不依赖手动同步即可入邮。
  const settleLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:mail:list-settle' });
  if (settleLease) {
    try {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (player) {
        const nowSec = Math.floor(Date.now() / 1000);
        const settled = await settleBackgroundJobsForPlayer(req.accountId, player, nowSec);
        if (settled && settled.changed) await db.savePlayer(req.accountId, 1, player);
      }
    } catch (_) {
      // 结算失败不阻断邮件读取，避免影响主流程。
    } finally {
      settlementLock.release(req.accountId, settleLease);
    }
  }

  const list = (await db.listMailbox(req.accountId)).map((m) => ({
    id: m.id,
    type: m.type,
    title: m.title,
    content: m.content || '',
    attachments: m.attachments || [],
    claimed: String(m.status) === 'claimed',
    created_at: m.created_at
  }));
  res.json({ ok: true, mails: list });
});

// POST /mail/claim/:id
router.post('/claim/:id', async (req, res) => {
  const mailId = Number(req.params.id);
  if (!mailId) return res.json({ ok: false, error: '无效邮件ID' });
  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:mail:claim' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  try {
    const r = await claimOneMail(req.accountId, mailId);
    if (!r.ok) return res.json(r);
    res.json({ ok: true, player: r.player });
  } catch (e) {
    res.json({ ok: false, error: e.message || '领取失败' });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
});

// POST /mail/claim_all
router.post('/claim_all', async (req, res) => {
  const lockLease = settlementLock.tryAcquire(req.accountId, { owner: 'route:mail:claim-all' });
  if (!lockLease) {
    return res.json({ ok: false, error: '数据结算中，请稍后重试' });
  }
  const mails = (await db.listMailbox(req.accountId)).filter((m) => String(m.status) === 'unread');
  let claimed = 0;
  let lastPlayer = null;
  let firstError = '';
  try {
    for (const m of mails) {
      try {
        const r = await claimOneMail(req.accountId, Number(m.id));
        if (!r.ok) {
          if (!firstError) firstError = r.error || '领取失败';
          continue;
        }
        claimed += 1;
        lastPlayer = r.player;
      } catch (e) {
        if (!firstError) firstError = e.message || '领取失败';
      }
    }
    return res.json({
      ok: claimed > 0 || mails.length === 0,
      claimed_count: claimed,
      skipped: mails.length - claimed,
      warning: firstError,
      player: lastPlayer
    });
  } finally {
    settlementLock.release(req.accountId, lockLease);
  }
});

// POST /mail/delete_claimed
router.post('/delete_claimed', async (req, res) => {
  try {
    const r = await db.deleteClaimedMailbox(req.accountId);
    return res.json({ ok: true, deleted_count: Number(r?.changes || 0) });
  } catch (e) {
    return res.json({ ok: false, error: e.message || '删除失败' });
  }
});

module.exports = router;
