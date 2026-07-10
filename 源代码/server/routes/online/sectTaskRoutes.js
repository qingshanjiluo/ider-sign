function _intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function generateOneSectTask(deps, playerQuality, levelMax) {
  const { getEnemies, getPlayerRealmQuality, intVal, randiRange } = deps;
  const enemies = getEnemies() || [];
  const enemyCandidates = enemies.filter(e => {
    const lv = intVal(e.level, 1);
    const eq = getPlayerRealmQuality(lv);
    return lv >= 10 && lv <= levelMax && eq <= playerQuality;
  });
  if (enemyCandidates.length > 0) {
    const enemy = enemyCandidates[Math.floor(Math.random() * enemyCandidates.length)];
    const enemyLevel = intVal(enemy.level, 1);
    const count = randiRange(15, 38);
    const reward = enemyLevel * count;
    return {
      type: 'kill_enemy',
      target_id: intVal(enemy.id, 0),
      count,
      reward,
      accepted: false,
      progress: 0,
      display_name: String(enemy.name || '未知'),
      target_level: enemyLevel
    };
  }
  return { type: '', target_id: 0, count: 0, reward: 0, accepted: false, progress: 0, display_name: '空', target_level: 0 };
}

function refreshSectTasks(player, deps) {
  const { intVal, getPlayerRealmQuality, taskSlots } = deps;
  const pq = getPlayerRealmQuality(intVal(player.level, 1));
  const levelMax = pq <= 1 ? 120 : (pq <= 2 ? 160 : (pq <= 3 ? 200 : 240));
  if (!Array.isArray(player.sect_tasks) || player.sect_tasks.length !== taskSlots) {
    player.sect_tasks = [];
    for (let i = 0; i < taskSlots; i += 1) player.sect_tasks.push(generateOneSectTask(deps, pq, levelMax));
    return;
  }
  for (let i = 0; i < player.sect_tasks.length; i += 1) {
    const t = player.sect_tasks[i] || {};
    if (!Boolean(t.accepted)) player.sect_tasks[i] = generateOneSectTask(deps, pq, levelMax);
  }
}

function settleKillTaskProgress(player, enemyId) {
  const tasks = Array.isArray(player?.sect_tasks) ? player.sect_tasks : [];
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i] || {};
    if (String(t.type || '') !== 'kill_enemy') continue;
    if (!Boolean(t.accepted)) continue;
    if (_intVal(t.target_id, 0) !== _intVal(enemyId, 0)) continue;
    t.progress = _intVal(t.progress, 0) + 1;
    tasks[i] = t;
  }
  if (player && typeof player === 'object') {
    player.sect_tasks = tasks;
  }
}

function mountSectTaskRoutes({
  router,
  withAccountLock,
  db,
  intVal,
  randiRange,
  getEnemies,
  getPlayerRealmQuality,
  nowSec,
  countItemInInventory,
  consumeItemFromInventory,
  taskSlots,
  taskRefreshSeconds,
  taskDailyLimit
}) {
  if (!router || typeof router.use !== 'function') {
    throw new Error('mountSectTaskRoutes: router 参数无效');
  }
  if (typeof withAccountLock !== 'function') {
    throw new Error('mountSectTaskRoutes: withAccountLock 参数无效');
  }

  const deps = {
    intVal,
    randiRange,
    getEnemies,
    getPlayerRealmQuality,
    taskSlots
  };

  router.get('/sect/tasks', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '未加入宗门' });
      const cur = nowSec();
      const nextRefresh = intVal(player.sect_task_refresh_time, 0);
      if (nextRefresh <= 0 || cur >= nextRefresh || !Array.isArray(player.sect_tasks) || player.sect_tasks.length !== taskSlots) {
        refreshSectTasks(player, deps);
        player.sect_task_refresh_time = cur + taskRefreshSeconds;
        await db.savePlayer(req.accountId, 1, player);
      }
      const completionsToday = await db.getSectTaskCompletionsToday(req.accountId);
      return res.json({
        ok: true,
        tasks: player.sect_tasks,
        player,
        next_refresh_at: intVal(player.sect_task_refresh_time, 0),
        sect_task_completions_today: completionsToday,
        sect_task_daily_limit: taskDailyLimit
      });
    });
  });

  // POST /sect/tasks/refresh - 手动刷新宗门任务，消耗100灵石，不限次数
  router.post('/sect/tasks/refresh', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '未加入宗门' });
      const COST = 100;
      const stones = intVal(player.spirit_stones, 0);
      if (stones < COST) return res.json({ ok: false, error: `灵石不足（需要${COST}）` });
      player.spirit_stones = stones - COST;
      refreshSectTasks(player, deps);
      const cur = nowSec();
      player.sect_task_refresh_time = cur + taskRefreshSeconds;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({
        ok: true,
        tasks: player.sect_tasks,
        player,
        next_refresh_at: player.sect_task_refresh_time,
        cost: COST
      });
    });
  });

  router.post('/sect/tasks/accept', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '未加入宗门' });
      const idx = intVal(req.body?.slot_index, -1);
      if (!Array.isArray(player.sect_tasks) || idx < 0 || idx >= player.sect_tasks.length) return res.json({ ok: false, error: '任务槽位无效' });
      const task = player.sect_tasks[idx] || {};
      if (String(task.type || '') === '') return res.json({ ok: false, error: '该槽位无任务，请等待刷新' });
      if (Boolean(task.accepted)) return res.json({ ok: false, error: '该任务已接取' });
      task.accepted = true;
      task.progress = 0;
      player.sect_tasks[idx] = task;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, tasks: player.sect_tasks, player });
    });
  });

  router.post('/sect/tasks/abandon', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '未加入宗门' });
      const idx = intVal(req.body?.slot_index, -1);
      if (!Array.isArray(player.sect_tasks) || idx < 0 || idx >= player.sect_tasks.length) return res.json({ ok: false, error: '任务槽位无效' });
      const task = player.sect_tasks[idx] || {};
      if (!Boolean(task.accepted)) return res.json({ ok: false, error: '该任务未接取，无需放弃' });
      task.accepted = false;
      task.progress = 0;
      task.type = '';
      player.sect_tasks[idx] = task;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, tasks: player.sect_tasks, player });
    });
  });

  router.post('/sect/tasks/complete', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '未加入宗门' });
      const completionsToday = await db.getSectTaskCompletionsToday(req.accountId);
      if (completionsToday >= taskDailyLimit) {
        return res.json({ ok: false, error: `今日宗门任务已完成 ${taskDailyLimit} 次，明日再来` });
      }
      const idx = intVal(req.body?.slot_index, -1);
      if (!Array.isArray(player.sect_tasks) || idx < 0 || idx >= player.sect_tasks.length) return res.json({ ok: false, error: '任务槽位无效' });
      const task = player.sect_tasks[idx] || {};
      if (!Boolean(task.accepted)) return res.json({ ok: false, error: '请先接取任务' });
      if (String(task.type || '') === 'submit_material') {
        const itemId = intVal(task.target_id, 0);
        const count = intVal(task.count, 1);
        if (countItemInInventory(player, itemId) < count) return res.json({ ok: false, error: `材料不足（需要 ${task.display_name || '未知'} x${count}）` });
        consumeItemFromInventory(player, itemId, count);
      } else if (String(task.type || '') === 'kill_enemy') {
        const progress = intVal(task.progress, 0);
        const count = intVal(task.count, 1);
        if (progress < count) return res.json({ ok: false, error: `击杀数量不足（${progress}/${count}）` });
      } else {
        return res.json({ ok: false, error: '该槽位无有效任务' });
      }
      player.sect_contribution = intVal(player.sect_contribution, 0) + intVal(task.reward, 0);
      task.accepted = false;
      task.progress = 0;
      task.type = '';
      player.sect_tasks[idx] = task;
      await db.savePlayerImmediate(req.accountId, 1, player);
      await db.incrementSectTaskCompletions(req.accountId);
      const completionsNow = completionsToday + 1;
      return res.json({
        ok: true,
        tasks: player.sect_tasks,
        player,
        sect_task_completions_today: completionsNow,
        sect_task_daily_limit: taskDailyLimit
      });
    });
  });
}

module.exports = { mountSectTaskRoutes, settleKillTaskProgress };