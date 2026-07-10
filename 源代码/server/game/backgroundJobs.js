const db = require('../dbAsync');
const { getItemById } = require('./dataLoader');
const cave = require('./cave');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

const deepClone = typeof structuredClone === 'function'
  ? (v) => structuredClone(v)
  : (v) => JSON.parse(JSON.stringify(v));

function buildBaiyiMailDedupeKey(accountId, job) {
  const aid = Number(accountId) || 0;
  const jobId = String(job?.job_id || '').trim();
  if (aid > 0 && jobId) return `baiyi:${aid}:job:${jobId}`;
  const subType = String(job?.sub_type || '');
  const startAt = intVal(job?.start_at, 0);
  const finishAt = intVal(job?.finish_at, 0);
  if (aid <= 0 || finishAt <= 0) return '';
  return `baiyi:${aid}:${subType}:${startAt}:${finishAt}`;
}

async function settleBackgroundJobsForPlayer(accountId, player, nowSec) {
  if (!player || typeof player !== 'object') return { changed: false, mailed: 0, baiyiClearedFinishAt: 0 };
  const now = Math.floor(Number(nowSec) || Math.floor(Date.now() / 1000));
  let changed = false;
  let mailed = 0;
  let baiyiClearedFinishAt = 0;

  player.baiyi = player.baiyi && typeof player.baiyi === 'object' ? player.baiyi : {};
  const baiyiJob = player.baiyi.pending_job && typeof player.baiyi.pending_job === 'object' ? player.baiyi.pending_job : null;
  if (baiyiJob && intVal(baiyiJob.finish_at, 0) > 0 && intVal(baiyiJob.finish_at, 0) <= now) {
    baiyiClearedFinishAt = intVal(baiyiJob.finish_at, 0);
    const dedupeKey = buildBaiyiMailDedupeKey(accountId, baiyiJob);
    const subType = String(baiyiJob.sub_type || '');
    const result = baiyiJob.result && typeof baiyiJob.result === 'object' ? baiyiJob.result : {};
    let delivered = false;
    if (subType === 'forging' && result.equipment && typeof result.equipment === 'object' && Object.keys(result.equipment).length > 0) {
      const mid = await db.createMailboxMessage(accountId, {
        type: 'craft_forging',
        title: '炼器完成通知',
        content: `离线期间炼器已完成，装备已投递邮件：${String(result.equipment.name || '装备')}`,
        attachments: [{ kind: 'item', item: deepClone(result.equipment), count: 1 }],
        dedupe_key: dedupeKey
      });
      if (Number(mid) > 0) mailed += 1;
      // mid=0 表示同 dedupe_key 邮件已存在，可视为已投递。
      delivered = Number(mid) >= 0;
    } else {
      const itemId = intVal(result.item_id, 0);
      const count = Math.max(1, intVal(result.count, 1));
      if (itemId > 0) {
        const item = getItemById(itemId);
        if (item && Object.keys(item).length > 0) {
          const itemType = String(item.type || '');
          if (itemType === 'array_plate' || itemType === 'array_rune') {
            const stored = cave.addFormationItems(player, item, count, now);
            if (!stored.ok || intVal(stored.added, 0) <= 0) {
              // 回退到邮件投递，避免产物丢失
              const mid = await db.createMailboxMessage(accountId, {
                type: 'craft_baiyi',
                title: '百艺完成通知',
                content: `离线期间百艺制作已完成，产物已投递邮件：${String(item.name || result.item_name || '物品')} x${count}`,
                attachments: [{ kind: 'item', item: deepClone(item), count }],
                dedupe_key: dedupeKey
              });
              if (Number(mid) > 0) mailed += 1;
              delivered = Number(mid) >= 0;
            } else {
              delivered = true;
            }
          } else {
            const title = subType === 'alchemy' ? '炼药完成通知' : '百艺完成通知';
            const desc = subType === 'alchemy' ? '炼药' : '百艺制作';
            const mid = await db.createMailboxMessage(accountId, {
              type: subType === 'alchemy' ? 'craft_alchemy' : 'craft_baiyi',
              title: title,
              content: `离线期间${desc}已完成，产物已投递邮件：${String(item.name || result.item_name || '物品')} x${count}`,
              attachments: [{ kind: 'item', item: deepClone(item), count }],
              dedupe_key: dedupeKey
            });
            if (Number(mid) > 0) mailed += 1;
            delivered = Number(mid) >= 0;
          }
        }
      }
    }
    if (!delivered) {
      console.warn('[backgroundJobs] baiyi job not cleared due to undelivered result accountId=%s subType=%s finishAt=%s', accountId, subType, baiyiClearedFinishAt);
      return { changed: false, mailed, baiyiClearedFinishAt: 0 };
    }
    player.alchemy = player.alchemy && typeof player.alchemy === 'object' ? player.alchemy : {};
    player.forging = player.forging && typeof player.forging === 'object' ? player.forging : {};
    player.alchemy.is_brewing = false;
    player.alchemy.pending_job = null;
    player.forging.is_forging = false;
    player.forging.pending_job = null;
    player.baiyi.pending_job = null;
    player.baiyi.is_crafting = false;
    player.baiyi.current_recipe = null;
    player.baiyi.sub_type = '';
    player.baiyi.progress = 0;
    player.baiyi.total_time = 0;
    changed = true;
  }

  return { changed, mailed, baiyiClearedFinishAt };
}

module.exports = { settleBackgroundJobsForPlayer };

