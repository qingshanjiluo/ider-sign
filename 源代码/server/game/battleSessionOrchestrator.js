const crypto = require('crypto');
const bsc = require('./battleSessionCache');
const db = require('../dbAsync');
const engine = require('./battleEngine');
const cave = require('./cave');
const ops = require('./playerOps');
const { getEnemyById, getMapById, getDungeonEnemyById } = require('./dataLoader');
const { isLingjieMap, scaleLingjieEnemyForPlayer, buildLingjieBattleContext } = require('./lingjie');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

const BATTLE_POLL_EVENT_LIMIT = (() => {
  const env = Number(process.env.BATTLE_POLL_EVENT_LIMIT);
  if (Number.isFinite(env) && env >= 20) return Math.min(300, Math.floor(env));
  return 80;
})();

const BATTLE_POLL_INCLUDE_STATE_EVERY = (() => {
  const env = Number(process.env.BATTLE_POLL_INCLUDE_STATE_EVERY);
  if (Number.isFinite(env) && env >= 1) return Math.min(20, Math.floor(env));
  return 5;
})();
const AUTO_INTENT_PERSIST_MIN_INTERVAL_MS = (() => {
  const env = Number(process.env.BATTLE_AUTO_INTENT_PERSIST_MIN_INTERVAL_MS);
  if (Number.isFinite(env) && env >= 100) return Math.min(30000, Math.floor(env));
  return 5000;
})();

/** 精简 player：poll 只返回战斗结算相关字段，避免 ~178KB 完整对象 */
const _POLL_PLAYER_LITE_KEYS = [
  'name', 'level', 'exp', 'max_exp', 'hp', 'max_hp', 'mp', 'max_mp',
  'spirit_stones', 'trial_coins', 'league_points', 'league_rating',
  'current_map_id', 'auto_battle_map_id', 'rest_until', 'auto_battle_enabled',
  'skill_levels', 'techniques', 'skill_cooldowns',
  'sect_id', 'alliance_id', 'time_state'
  // 注意：不包含 inventory，避免用战斗时的背包快照覆盖邮件领取等操作的新数据
];
function _buildPollPlayerLite(player) {
  const lite = {};
  for (const k of _POLL_PLAYER_LITE_KEYS) {
    if (k in player) lite[k] = player[k];
  }
  return lite;
}

function persistAutoBattleIntent(accountId, enabled, mapId) {
  return db.updatePlayerAutoBattleIntent(accountId, !!enabled, mapId);
}

function _shouldPersistAutoIntent(session, enabled, mapId) {
  if (!session || typeof session !== 'object') return true;
  const nowMs = Date.now();
  const normalizedEnabled = !!enabled;
  const normalizedMapId = Math.max(1, intVal(mapId, 1));
  const lastAt = Number(session._autoIntentPersistAt || 0);
  const lastEnabled = !!session._autoIntentPersistEnabled;
  const lastMapId = Math.max(1, intVal(session._autoIntentPersistMapId, 1));
  if (lastEnabled !== normalizedEnabled || lastMapId !== normalizedMapId) return true;
  return (nowMs - lastAt) >= AUTO_INTENT_PERSIST_MIN_INTERVAL_MS;
}

function _markAutoIntentPersisted(session, enabled, mapId) {
  if (!session || typeof session !== 'object') return;
  session._autoIntentPersistAt = Date.now();
  session._autoIntentPersistEnabled = !!enabled;
  session._autoIntentPersistMapId = Math.max(1, intVal(mapId, 1));
}

async function startBattleSession({ accountId, body, helpers }) {
  const _t0 = Date.now();
  let _phase = _t0;
  const _marks = [];
  const _mark = (name) => {
    const now = Date.now();
    _marks.push({ name: String(name || ''), ms: now - _phase });
    _phase = now;
  };

  const {
    randomEnemyFromMap,
    isNightmareMap,
    applyNightmareEnemy,
    clampRestUntil,
    consumeBattleStartTalisman,
    applyBattleStartTalisman
  } = helpers || {};

  const { mapId, enemyId, dungeonId, poll_mode, auto_restart } = body || {};
  const requestedDungeonMode = Number(dungeonId) > 0;
  const pollMode = Boolean(poll_mode);
  const autoRestart = auto_restart !== undefined ? Boolean(auto_restart) : pollMode;
  const active = bsc.getActiveSessionByAccount(accountId);
  if (active && String(active.status || '') === 'active') {
    const activeDungeonMode = String(active?.state?.enemy_source || 'wild') === 'dungeon';
    if (activeDungeonMode !== requestedDungeonMode) {
      bsc.deleteSession(String(active.id || ''));
    } else {
      if (pollMode && !active.state?.server_driven) active.state.server_driven = true;
      active.last_poll_at = Math.floor(Date.now() / 1000);
      active.auto_restart = autoRestart;
      if (pollMode) {
        const activeMapId = active.map_id || mapId || 1;
        if (_shouldPersistAutoIntent(active, autoRestart, activeMapId)) {
          await persistAutoBattleIntent(accountId, autoRestart, activeMapId);
          _markAutoIntentPersisted(active, autoRestart, activeMapId);
        }
      }
      const source = String(active?.state?.enemy_source || 'wild');
      const enemy = source === 'dungeon' ? getDungeonEnemyById(active.enemy_id) : getEnemyById(active.enemy_id);
      _mark('resume');
      const total = Date.now() - _t0;
      if (total >= 1000) {
        console.warn('[battle/start] slow(resume) accountId=%s total=%dms marks=%j', accountId, total, _marks);
      }
      return {
        ok: true,
        battleId: String(active.id || ''),
        state: engine.stateLite(active.state || {}),
        enemyData: enemy || null,
        last_seq: Math.max(0, Number(active.last_seq) || 0),
        resumed: true,
        server_driven: Boolean(active.state?.server_driven)
      };
    }
  }

  const map = getMapById(mapId || 1);
  _mark('map');
  if (!map) {
    return { ok: false, error: '地图不存在' };
  }

  let enemy;
  const dungeonMode = requestedDungeonMode;
  if (enemyId) {
    enemy = dungeonMode ? getDungeonEnemyById(enemyId) : getEnemyById(enemyId);
  } else {
    enemy = typeof randomEnemyFromMap === 'function' ? randomEnemyFromMap(mapId || 1) : null;
  }

  if (typeof isNightmareMap === 'function' && typeof applyNightmareEnemy === 'function' && isNightmareMap(map) && enemy && !enemy.nightmare) {
    enemy = applyNightmareEnemy(enemy, map);
  }
  _mark('enemy');
  if (!enemy || !enemy.id) {
    return { ok: false, error: '无法生成敌人' };
  }

  const player = await db.getPlayerByAccountId(accountId);
  _mark('load_player');
  if (!player) return { ok: false, error: '角色不存在' };

  if (!dungeonMode && isLingjieMap(map)) {
    enemy = scaleLingjieEnemyForPlayer(enemy, map, player);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const restUntil = typeof clampRestUntil === 'function' ? clampRestUntil(player, nowSec) : intVal(player.rest_until, 0);
  if (restUntil !== intVal(player.rest_until, 0)) {
    player.rest_until = restUntil;
    await db.updatePlayerRestUntil(accountId, restUntil);
  }
  if (restUntil > nowSec) {
    const remain = Math.max(0, restUntil - nowSec);
    return {
      ok: false,
      error: `调息中，剩余${remain}秒`,
      rest_remaining_sec: remain
    };
  }

  player.rest_until = 0;
  const mainServiceResult = cave.settleMainFormationServices(player, nowSec, { allowAutoActivate: true });
  // 预设应用仅用于本次战斗投影，不作为持久化触发条件，避免每次开战都落盘。
  ops.tryApplySkillPresetForBattle(player, dungeonMode ? 'dungeon' : 'grind');
  let playerDirty = !!(mainServiceResult && mainServiceResult.changed);
  const buffsBefore = player.timed_buffs && typeof player.timed_buffs === 'object' ? Object.keys(player.timed_buffs).length : 0;
  ops.cleanupTimedBuffs(player);
  const buffsAfter = player.timed_buffs && typeof player.timed_buffs === 'object' ? Object.keys(player.timed_buffs).length : 0;
  if (buffsAfter !== buffsBefore) playerDirty = true;
  const talismanUse = typeof consumeBattleStartTalisman === 'function' ? consumeBattleStartTalisman(player) : { used: false };
  if (talismanUse && talismanUse.used) playerDirty = true;
  if (playerDirty) await db.savePlayer(accountId, 1, player);
  _mark('prepare_player');

  const battleId = crypto.randomBytes(16).toString('hex');
  const initState = engine.createInitialBattleState(player, enemy, Math.floor(Math.random() * 2147483647));
  initState.enemy_source = dungeonMode ? 'dungeon' : 'wild';
  initState.dungeon_id = dungeonMode ? Math.floor(Number(dungeonId) || 0) : 0;
  initState.turn_mode = dungeonMode ? 'fixed_agility' : 'action_bar';
  if (!dungeonMode && isLingjieMap(map)) {
    initState.map_environment = buildLingjieBattleContext(map);
  }
  if (pollMode) initState.server_driven = true;
  _mark('create_state');

  bsc.createSession(battleId, accountId, mapId || 1, enemy.id, pollMode ? 172800 : 900, initState);
  if (pollMode) {
    const newSess = bsc.getActiveSessionByAccount(accountId);
    if (newSess) {
      newSess.auto_restart = autoRestart;
      const nextMapId = mapId || 1;
      if (_shouldPersistAutoIntent(newSess, autoRestart, nextMapId)) {
        await persistAutoBattleIntent(accountId, autoRestart, nextMapId);
        _markAutoIntentPersisted(newSess, autoRestart, nextMapId);
      }
    } else {
      await persistAutoBattleIntent(accountId, autoRestart, mapId || 1);
    }
  }
  _mark('create_session');

  const initEvts = [{ t: 'combat_log', text: `遭遇了 ${String(enemy.name || '敌人')}` }];
  if (initState.map_environment?.id) {
    initEvts.push({
      t: 'combat_log',
      text: `灵界环境【${String(initState.map_environment.name || '未知')}】生效：${String(initState.map_environment.effect_desc || '')}`
    });
    if (initState.map_environment.reward_desc) {
      initEvts.push({
        t: 'combat_log',
        text: `灵界奖励：${String(initState.map_environment.reward_desc || '')}`
      });
    }
  }
  if (talismanUse.used && typeof applyBattleStartTalisman === 'function') {
    initEvts.push(...applyBattleStartTalisman(initState, talismanUse));
  }
  if (Array.isArray(initState._init_events) && initState._init_events.length > 0) {
    initEvts.push(...initState._init_events);
  }
  bsc.appendEvents(battleId, 1, initEvts);
  initState.event_index = initEvts.length;
  _mark('append_events');

  const total = Date.now() - _t0;
  if (total >= 1000) {
    console.warn('[battle/start] slow accountId=%s total=%dms marks=%j', accountId, total, _marks);
  }

  return {
    ok: true,
    battleId,
    enemyData: enemy,
    state: engine.stateLite(initState),
    last_seq: 0,
    resumed: false,
    server_driven: Boolean(initState.server_driven)
  };
}

async function setAutoRestartIntent({ accountId, body }) {
  const enabled = !!body?.enabled;
  const rawMapId = Number(body?.map_id);
  const hasMapId = Number.isFinite(rawMapId) && rawMapId > 0;
  const mapId = hasMapId ? Math.floor(rawMapId) : undefined;
  const player = await persistAutoBattleIntent(accountId, enabled, mapId);
  if (!player) {
    return { ok: false, error: '无角色' };
  }
  const session = bsc.getActiveSessionByAccount(accountId);
  if (session) {
    session.auto_restart = enabled;
    if (hasMapId) session.map_id = mapId;
  }
  return {
    ok: true,
    enabled,
    map_id: Math.max(1, Math.floor(Number(player?.auto_battle_map_id || player?.current_map_id || 1)))
  };
}

function pollBattleSession({ accountId, query }) {
  const session = bsc.getAnySessionByAccount(accountId);
  if (!session) {
    return { ok: true, active: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  session.last_poll_at = nowSec;

  const arParam = query?.auto_restart;
  if (arParam !== undefined) {
    const enabled = arParam === '1' || arParam === 'true';
    const prevEnabled = !!session.auto_restart;
    session.auto_restart = enabled;
    const mapForIntent = session.map_id || session.state?.player?.current_map_id || 1;
    if (prevEnabled !== enabled || _shouldPersistAutoIntent(session, enabled, mapForIntent)) {
      persistAutoBattleIntent(accountId, enabled, mapForIntent)
        .then(() => {
          _markAutoIntentPersisted(session, enabled, mapForIntent);
        })
        .catch((e) => {
          console.error('[battle/poll] persist auto_restart failed accountId=%s:', accountId, e?.message || e);
        });
    }
  }

  if (session.status === 'active') {
    bsc.updateSessionState(session.id, { expiresAt: nowSec + 900 });
  }

  const afterIdx = Math.max(0, Math.floor(Number(query?.after) || 0));
  const eventWindow = bsc.getEventWindowInfo(session.id);
  const evts = bsc.listEventsSince(session.id, afterIdx, BATTLE_POLL_EVENT_LIMIT).map((x) => ({
    index: Number(x.event_index) || 0,
    ...(x.event || {})
  }));
  const eventsReset = afterIdx > 0 && eventWindow.firstIndex > afterIdx + 1;
  session._poll_count = intVal(session._poll_count, 0) + 1;
  const shouldIncludeState = session.status === 'finished'
    || evts.length > 0
    || (session._poll_count % BATTLE_POLL_INCLUDE_STATE_EVERY) === 1;
  const stateForClient = shouldIncludeState ? engine.stateLite(session.state || {}) : null;

  if (session.status === 'finished') {
    const sd = session.result || {};
    const fullPlayer = sd.settle_data?.player || sd.player || null;
    return {
      ok: true,
      active: false,
      finished: true,
      battleId: session.id,
      victory: Boolean(sd.victory),
      draw: Boolean(sd.draw),
      rewards: sd.settle_data?.rewards || sd.rewards || {},
      player: fullPlayer ? _buildPollPlayerLite(fullPlayer) : null,
      rest_remaining_sec: intVal(sd.settle_data?.rest_remaining_sec ?? sd.rest_remaining_sec, 0),
      state: stateForClient,
      events: evts,
      event_index: intVal(session.state?.event_index, 0),
      events_reset: eventsReset,
      events_from: eventWindow.firstIndex || 0
    };
  }

  return {
    ok: true,
    active: true,
    battleId: session.id,
    state: stateForClient,
    events: evts,
    event_index: intVal(session.state?.event_index, 0),
    events_reset: eventsReset,
    events_from: eventWindow.firstIndex || 0
  };
}

module.exports = {
  startBattleSession,
  setAutoRestartIntent,
  pollBattleSession,
  persistAutoBattleIntent
};
