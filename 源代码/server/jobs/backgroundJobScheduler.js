/**
 * 后台任务调度：炼器/炼药/百艺完成结算
 * 仅处理有 pending_job 的玩家，避免全量遍历
 */
const db = require('../db');
const dbAsync = require('../dbAsync');
const { settleBackgroundJobsForPlayer } = require('../game/backgroundJobs');
const settlementLock = require('../game/settlementLock');
const PENDING_JOB_SWEEP_BATCH_SIZE = 300;
let _pendingJobSweepCursor = 0;

async function runOneCycle() {
  try {
    let rows = await dbAsync.listPendingJobPlayerRows(_pendingJobSweepCursor, PENDING_JOB_SWEEP_BATCH_SIZE);
    if ((!rows || rows.length <= 0) && _pendingJobSweepCursor > 0) {
      _pendingJobSweepCursor = 0;
      rows = await dbAsync.listPendingJobPlayerRows(0, PENDING_JOB_SWEEP_BATCH_SIZE);
    }
    if (!Array.isArray(rows) || rows.length <= 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    for (const row of rows) {
      if (!row) continue;
      const aid = Number(row.account_id);
      const lockLease = settlementLock.tryAcquire(aid, { owner: 'job:background-settle' });
      if (!lockLease) continue;
      try {
        const player = await dbAsync.getPlayerByAccountId(aid);
        if (!player) continue;
        const baiyiNow = player.baiyi?.pending_job;
        if (!baiyiNow || typeof baiyiNow !== 'object') continue;
        const settledJobs = await settleBackgroundJobsForPlayer(aid, player, nowSec);
        if (settledJobs.changed) {
          const toSave = player;
          if (settledJobs.baiyiClearedFinishAt > 0 && toSave) {
            toSave.baiyi = toSave.baiyi || {};
            toSave.baiyi.pending_job = null;
            toSave.baiyi.is_crafting = false;
            toSave.baiyi.current_recipe = null;
            toSave.baiyi.sub_type = '';
            toSave.baiyi.progress = 0;
            toSave.baiyi.total_time = 0;
            toSave.alchemy = toSave.alchemy || {};
            toSave.alchemy.is_brewing = false;
            toSave.alchemy.pending_job = null;
            toSave.forging = toSave.forging || {};
            toSave.forging.is_forging = false;
            toSave.forging.pending_job = null;
          }
          if (toSave) await dbAsync.savePlayer(aid, Number(row.slot) || 1, toSave);
        }
      } finally {
        settlementLock.release(aid, lockLease);
      }
    }

    const lastAid = Number(rows[rows.length - 1]?.account_id || 0);
    if (lastAid > 0) _pendingJobSweepCursor = lastAid;
    if (rows.length < PENDING_JOB_SWEEP_BATCH_SIZE) _pendingJobSweepCursor = 0;
  } catch (e) {
    console.error('[background-jobs] settle failed:', e && e.message ? e.message : e);
  }
}

function startScheduler(intervalMs = 60 * 1000) {
  setInterval(() => {
    runOneCycle().catch(err => {
      console.error('[background-jobs] cycle error:', err?.message);
    });
  }, intervalMs);
}

module.exports = { runOneCycle, startScheduler };
