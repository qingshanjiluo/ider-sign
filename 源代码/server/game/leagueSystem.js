const crypto = require('crypto');
const dbApi = require('../db');
const dbAsync = require('../dbAsync');
const ops = require('./playerOps');
const { recalcAndAssignCombatStats, buildPlayerSnapshot, getRealmQualityFromLevel } = require('./combatUtils');
const engine = require('./dungeonBattleEngine');
const cave = require('./cave');
const { getItemById } = require('./dataLoader');

const { db } = dbApi;
const isMysqlDriver = !!dbApi.isMysql;

const DAY_SEC = 24 * 3600;
const TZ8_SEC = 8 * 3600;
const TEAM_SIZE = 3;
const ROUND_SLOT_OFFSETS = [10 * 3600, 14 * 3600, 20 * 3600];
const LEAGUE_INIT_LEAD_SEC = 30 * 60;
const LEAGUE_MATCHES_PER_TICK = Math.max(1, intVal(process.env.LEAGUE_MATCHES_PER_TICK, 2));
const LEAGUE_BASE_CHUNKS_PER_TICK = 1;
const LEAGUE_CATCHUP_CHUNKS_PER_TICK = 2;
const LEAGUE_MAX_LOOPS_PER_RUN = 1;
const LEAGUE_CATCHUP_LAG_SEC = 15 * 60;
const LEAGUE_INIT_TEAMS_PER_TICK = 12;
const LEAGUE_INIT_CATCHUP_TEAMS_PER_TICK = 36;
const LEAGUE_INIT_CATCHUP_BEFORE_START_SEC = 5 * 60;
const LEAGUE_ROUND_TICK_BUDGET_MS = Math.max(30, intVal(process.env.LEAGUE_ROUND_TICK_BUDGET_MS, 80));
const LEAGUE_SIM_MAX_TURNS = Math.max(600, intVal(process.env.LEAGUE_SIM_MAX_TURNS, 1800));
const LEAGUE_BATTLE_LOG_MAX_LINES = Math.max(100, intVal(process.env.LEAGUE_BATTLE_LOG_MAX_LINES, 240));
const LEAGUE_SIM_CAPTURE_LOGS = String(process.env.LEAGUE_SIM_CAPTURE_LOGS || '0') === '1';
const LEAGUE_SEASON_TEAM_CACHE_TTL_SEC = Math.max(1, intVal(process.env.LEAGUE_SEASON_TEAM_CACHE_TTL_SEC, 60));
const LEAGUE_ACTIVE_CHECK_SEC = Math.max(1, intVal(process.env.LEAGUE_ACTIVE_CHECK_SEC, 1));
const LEAGUE_IDLE_CHECK_SEC = Math.max(1, intVal(process.env.LEAGUE_IDLE_CHECK_SEC, 5));
const LEAGUE_FINISHED_CHECK_SEC = Math.max(5, intVal(process.env.LEAGUE_FINISHED_CHECK_SEC, 30));
const LEAGUE_SETTLE_IMMEDIATE_WRITE = String(process.env.LEAGUE_SETTLE_IMMEDIATE_WRITE || '0') === '1';
const LEAGUE_SETTLE_SEND_POINT_MAIL = String(process.env.LEAGUE_SETTLE_SEND_POINT_MAIL || '0') === '1';
const LEAGUE_VERBOSE_LOG = String(process.env.LEAGUE_VERBOSE_LOG || '0') === '1';
const LEAGUE_STATUS_BASE_CACHE_TTL_SEC = Math.max(1, intVal(process.env.LEAGUE_STATUS_BASE_CACHE_TTL_SEC, 5));
const LEAGUE_MEMBER_TEAM_LOOKUP_CACHE_TTL_SEC = Math.max(1, intVal(process.env.LEAGUE_MEMBER_TEAM_LOOKUP_CACHE_TTL_SEC, 5));
const MIN_SWISS_ROUNDS = 7;
const MAX_SWISS_ROUNDS = 9;
const DEFAULT_LEAGUE_RATING = 1000;
const DEFAULT_LEAGUE_CURRENCY = 0;
const LEAGUE_REGISTER_MIN_REALM_QUALITY = 3; // 结丹/金丹及以上
const MATCH_POINTS = { win: 4, draw: 2, loss: 1 };
const LEAGUE_RATING_K = Math.max(4, intVal(process.env.LEAGUE_RATING_K, 24));
const LEAGUE_LEADERBOARD_CACHE_TTL_SEC = Math.max(10, intVal(process.env.LEAGUE_LEADERBOARD_CACHE_TTL_SEC, 120));
const LEAGUE_POINTS_COMP_STRATEGY = String(process.env.LEAGUE_POINTS_COMP_STRATEGY || 'wallet_estimate').toLowerCase();
const LEAGUE_SHOP_ITEMS = [
  {
    id: 'mat_box_5',
    item_id: 185,
    name: '五阶材料箱',
    cost: 1,
    currency: 'league_points',
    limit: 0,
    max_batch: 200,
    desc: '开启后随机获得1-5个五阶材料（开1个概率最高，越高越低）'
  },
  {
    id: 'mat_box_6',
    item_id: 186,
    name: '六阶材料箱',
    cost: 3,
    currency: 'league_points',
    limit: 0,
    max_batch: 150,
    desc: '开启后随机获得1-3个六阶材料（开1个概率最高，越高越低）'
  },
  {
    id: 'mat_box_7',
    item_id: 187,
    name: '七阶材料箱',
    cost: 5,
    currency: 'league_points',
    limit: 0,
    max_batch: 100,
    desc: '开启后获得1个七阶材料'
  },
  {
    id: 'book_anzhuanqiankun',
    item_id: 188,
    name: '《暗转乾坤》',
    cost: 10,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '记录着暗转乾坤技能的修炼方法',
    tooltip: '80%自适应伤害；优先夺取目标1个正面状态；若无可夺取则转移自身1个负面状态'
  },
  {
    id: 'book_guiyuannaxing',
    item_id: 189,
    name: '《归元纳形》',
    cost: 10,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '记录着归元纳形技能的修炼方法',
    tooltip: '自我凝滞1回合（免伤且免疫负面），下次行动恢复10%生命'
  },
  {
    id: 'book_tuoshenfa',
    item_id: 190,
    name: '《脱身法》',
    cost: 10,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '记录着脱身法技能的修炼方法',
    tooltip: '解除自身2个负面状态'
  },
  {
    id: 'book_yuwoyijue',
    item_id: 191,
    name: '《与我一决》',
    cost: 10,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '记录着与我一决功法的修炼方法',
    tooltip: '装配者无法获得治疗；每损失10%生命最终伤害+5%（PVP +3%），最多5层'
  },
  {
    id: 'book_sishengdayi',
    item_id: 192,
    name: '《死生大矣》',
    cost: 10,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '记录着死生大矣技能的修炼方法',
    tooltip: '清空全部法力值，并恢复清空值65%的生命（PVP 35%）'
  },
  {
    id: 'alchemy_recipe_shengzhandan',
    item_id: 193,
    name: '《圣战丹丹方》',
    cost: 8,
    currency: 'league_points',
    limit: 1,
    max_batch: 1,
    desc: '阅读后解锁百艺炼丹配方：圣战丹',
    tooltip: '使力道(力量)的基础数值永久提高20，对基础数值大于等于2000点的无效'
  },
  {
    id: 'alchemy_recipe_tuofandan',
    item_id: 194,
    name: '《脱凡丹丹方》',
    cost: 8,
    currency: 'league_points',
    limit: 1,
    max_batch: 1,
    desc: '阅读后解锁百艺炼丹配方：脱凡丹',
    tooltip: '使根骨的基础数值永久提高30，对基础数值大于等于3500点的无效'
  },
  {
    id: 'alchemy_recipe_yayundan',
    item_id: 195,
    name: '《雅韵丹丹方》',
    cost: 8,
    currency: 'league_points',
    limit: 1,
    max_batch: 1,
    desc: '阅读后解锁百艺炼丹配方：雅韵丹',
    tooltip: '使灵力的基础数值永久提高20，对基础数值大于等于2000点的无效'
  },
  {
    id: 'alchemy_recipe_kunyuandan',
    item_id: 196,
    name: '《坤元丹丹方》',
    cost: 8,
    currency: 'league_points',
    limit: 1,
    max_batch: 1,
    desc: '阅读后解锁百艺炼丹配方：坤元丹',
    tooltip: '使体魄的基础数值永久提高20，对基础数值大于等于2000点的无效'
  },
  {
    id: 'alchemy_recipe_shenmuwan',
    item_id: 197,
    name: '《神木丸丹方》',
    cost: 8,
    currency: 'league_points',
    limit: 1,
    max_batch: 1,
    desc: '阅读后解锁百艺炼丹配方：神木丸',
    tooltip: '使真气的基础数值永久提高20，对基础数值大于2000点的无效'
  },
  {
    id: 'pill_duotiandan',
    item_id: 198,
    name: '夺天丹',
    cost: 15,
    currency: 'league_points',
    limit: 0,
    max_batch: 20,
    desc: '选择目标灵根；有>95灵根则转移5点，无>95时需对应淬炼补正=15才可直升5点（目标基础上限85）',
    tooltip: '目标基础值=85且对应淬炼补正=15时，自动补正到100'
  }
];
let _leagueSettleRunning = false;
const _leaderboardCache = {
  built_at: 0,
  list: []
};
let _leaderboardCacheInFlight = null;
const _seasonTeamsCache = new Map();
const _memberTeamLookupCache = new Map();
const _seasonStatusBaseCache = {
  built_at: 0,
  payload: null
};

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function numVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v, lo, hi) {
  return clamp(intVal(v, lo), intVal(lo, lo), intVal(hi, hi));
}

function parseJsonSafe(raw, defVal) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? defVal : parsed;
  } catch (_) {
    return defVal;
  }
}

function dayStartUtc8(ts) {
  const t = intVal(ts, nowSec());
  return Math.floor((t + TZ8_SEC) / DAY_SEC) * DAY_SEC - TZ8_SEC;
}

function weekDayUtc8(ts) {
  const t = intVal(ts, nowSec());
  return new Date((t + TZ8_SEC) * 1000).getUTCDay();
}

function mondayStartUtc8(ts) {
  const dayStart = dayStartUtc8(ts);
  const weekDay = weekDayUtc8(ts);
  const dayOffset = (weekDay + 6) % 7; // 周一=0
  return dayStart - dayOffset * DAY_SEC;
}

function seasonWindow(seasonStart) {
  const start = intVal(seasonStart, 0);
  return {
    season_id: start,
    start_at: start,
    reg_start: start - 3 * DAY_SEC, // 周五 00:00
    reg_end: start - 1,              // 周日 23:59:59
    end_at: start + 7 * DAY_SEC
  };
}

function getTimeline(now = nowSec()) {
  const currentSeasonStart = mondayStartUtc8(now);
  const registrationSeasonStart = currentSeasonStart + 7 * DAY_SEC;
  const regWindow = seasonWindow(registrationSeasonStart);
  return {
    now,
    current_season_start: currentSeasonStart,
    registration_season_start: registrationSeasonStart,
    registration_open: now >= regWindow.reg_start && now <= regWindow.reg_end,
    registration_window: regWindow
  };
}

function calcSwissRounds(teamCount) {
  const n = Math.max(0, intVal(teamCount, 0));
  if (n <= 1) return 0;
  const rounds = Math.ceil(Math.log2(Math.max(2, n))) + 1;
  return clamp(rounds, MIN_SWISS_ROUNDS, MAX_SWISS_ROUNDS);
}

function normalizeMembers(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const m of arr) {
    const aid = intVal(m?.account_id, 0);
    if (aid <= 0 || seen.has(aid)) continue;
    seen.add(aid);
    out.push({
      account_id: aid,
      name: String(m?.name || `道友#${aid}`)
    });
  }
  return out;
}

function normalizeSkillConfig(rawCfg, learnedSet) {
  const learned = learnedSet || new Set();
  const equippedRaw = Array.isArray(rawCfg?.equipped_skills) ? rawCfg.equipped_skills : [];
  const equipped = [...new Set(equippedRaw
    .map(x => intVal(x, 0))
    .filter(x => x > 0 && learned.has(x)))].slice(0, 5);
  const keySkillId = intVal(rawCfg?.key_skill_id, 0);
  return {
    equipped_skills: equipped,
    key_skill_id: equipped.includes(keySkillId) ? keySkillId : 0
  };
}

function normalizeSkillConfigLoose(rawCfg) {
  const equippedRaw = Array.isArray(rawCfg?.equipped_skills) ? rawCfg.equipped_skills : [];
  const equipped = [...new Set(equippedRaw
    .map(x => intVal(x, 0))
    .filter(x => x > 0))].slice(0, 5);
  const keySkillId = intVal(rawCfg?.key_skill_id, 0);
  return {
    equipped_skills: equipped,
    key_skill_id: equipped.includes(keySkillId) ? keySkillId : (equipped[0] || 0)
  };
}

function pickBattleSkillConfig(primaryCfg, fallbackCfg, learnedSet) {
  const primary = normalizeSkillConfig(primaryCfg || {}, learnedSet);
  if (primary.equipped_skills.length > 0) return primary;
  return normalizeSkillConfig(fallbackCfg || {}, learnedSet);
}

function getTeamMemberSkillConfig(team, accountId) {
  if (!team || !team.members) return null;
  const aid = intVal(accountId, 0);
  if (aid <= 0) return null;

  const members = normalizeMembers(team.members || []);
  if (!members.some(m => intVal(m.account_id, 0) === aid)) return null;

  const skillMap = team.skill_map && typeof team.skill_map === 'object' ? team.skill_map : {};
  const mapCfg = skillMap[String(aid)];
  if (mapCfg && typeof mapCfg === 'object') {
    const normalized = normalizeSkillConfigLoose(mapCfg);
    if (normalized.equipped_skills.length > 0) return normalized;
  }

  const frozenMember = (Array.isArray(team.frozen) ? team.frozen : []).find(m => intVal(m?.account_id, 0) === aid);
  if (frozenMember?.skill_config && typeof frozenMember.skill_config === 'object') {
    return normalizeSkillConfigLoose(frozenMember.skill_config);
  }

  return null;
}

function ensureTables() {
  if (isMysqlDriver) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS league_seasons (
      season_id INTEGER PRIMARY KEY,
      reg_start INTEGER NOT NULL,
      reg_end INTEGER NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'registration', -- registration/running/finished
      total_rounds INTEGER NOT NULL DEFAULT 0,
      rounds_completed INTEGER NOT NULL DEFAULT 0,
      initialized INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS league_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      team_code TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      captain_account_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'manual', -- manual/system
      registered INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'forming', -- forming/registered/active/finished/disbanded
      rating_seed INTEGER NOT NULL DEFAULT 1000,
      season_points INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      members_json TEXT NOT NULL DEFAULT '[]',
      frozen_json TEXT NOT NULL DEFAULT '[]',
      skill_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_league_teams_season_code ON league_teams(season_id, team_code);
    CREATE INDEX IF NOT EXISTS idx_league_teams_season_status ON league_teams(season_id, status);

    CREATE TABLE IF NOT EXISTS league_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      round_no INTEGER NOT NULL,
      match_no INTEGER NOT NULL,
      team_a_id INTEGER NOT NULL,
      team_b_id INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL DEFAULT 'pending', -- a_win/b_win/draw/bye
      winner_team_id INTEGER NOT NULL DEFAULT 0,
      points_a INTEGER NOT NULL DEFAULT 0,
      points_b INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      battle_log_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      settled_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_league_matches_season_round ON league_matches(season_id, round_no, match_no);
    CREATE INDEX IF NOT EXISTS idx_league_matches_team_a ON league_matches(team_a_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_league_matches_team_b ON league_matches(team_b_id, created_at);

    CREATE TABLE IF NOT EXISTS league_point_round_comp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      round_no INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_league_point_round_comp_unique
    ON league_point_round_comp(season_id, round_no, account_id);

    CREATE INDEX IF NOT EXISTS idx_league_point_round_comp_season_round
    ON league_point_round_comp(season_id, round_no);
  `);

  // 兼容历史数据：先清理重复比赛键，再建立唯一索引，避免重启中断后重复结算。
  db.exec(`
    DELETE FROM league_matches
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM league_matches
      GROUP BY season_id, round_no, match_no
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_league_matches_unique_round_match
    ON league_matches(season_id, round_no, match_no);
  `);
}

ensureTables();

function hydrateSeason(row) {
  if (!row) return null;
  return {
    season_id: intVal(row.season_id, 0),
    reg_start: intVal(row.reg_start, 0),
    reg_end: intVal(row.reg_end, 0),
    start_at: intVal(row.start_at, 0),
    end_at: intVal(row.end_at, 0),
    status: String(row.status || 'registration'),
    total_rounds: intVal(row.total_rounds, 0),
    rounds_completed: intVal(row.rounds_completed, 0),
    initialized: intVal(row.initialized, 0) === 1,
    meta: parseJsonSafe(row.meta_json || '{}', {})
  };
}

function hydrateTeam(row) {
  if (!row) return null;
  const frozenRaw = parseJsonSafe(row.frozen_json || '[]', []);
  return {
    id: intVal(row.id, 0),
    season_id: intVal(row.season_id, 0),
    team_code: String(row.team_code || ''),
    name: String(row.name || ''),
    captain_account_id: intVal(row.captain_account_id, 0),
    mode: String(row.mode || 'manual'),
    registered: intVal(row.registered, 0) === 1,
    status: String(row.status || 'forming'),
    rating_seed: intVal(row.rating_seed, DEFAULT_LEAGUE_RATING),
    season_points: intVal(row.season_points, 0),
    wins: intVal(row.wins, 0),
    draws: intVal(row.draws, 0),
    losses: intVal(row.losses, 0),
    members: normalizeMembers(parseJsonSafe(row.members_json || '[]', [])),
    frozen: Array.isArray(frozenRaw) ? frozenRaw : [],
    skill_map: parseJsonSafe(row.skill_json || '{}', {}),
    created_at: intVal(row.created_at, 0),
    updated_at: intVal(row.updated_at, 0)
  };
}

function getSeason(seasonId) {
  const row = db.prepare('SELECT * FROM league_seasons WHERE season_id=?').get(intVal(seasonId, 0));
  return hydrateSeason(row);
}

function saveSeason(season) {
  db.prepare(`
    UPDATE league_seasons
    SET status=?, total_rounds=?, rounds_completed=?, initialized=?, meta_json=?, updated_at=?
    WHERE season_id=?
  `).run(
    String(season.status || 'registration'),
    intVal(season.total_rounds, 0),
    intVal(season.rounds_completed, 0),
    season.initialized ? 1 : 0,
    JSON.stringify(season.meta || {}),
    nowSec(),
    intVal(season.season_id, 0)
  );
  _seasonStatusBaseCache.built_at = 0;
}

function ensureSeason(seasonId) {
  const sid = intVal(seasonId, 0);
  if (sid <= 0) return null;
  const w = seasonWindow(sid);
  db.prepare(`
    INSERT OR IGNORE INTO league_seasons
    (season_id, reg_start, reg_end, start_at, end_at, status, total_rounds, rounds_completed, initialized, meta_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'registration', 0, 0, 0, '{}', ?, ?)
  `).run(sid, w.reg_start, w.reg_end, w.start_at, w.end_at, nowSec(), nowSec());
  _seasonStatusBaseCache.built_at = 0;
  return getSeason(sid);
}

function _ensureSeasonForStatus(seasonId) {
  const sid = intVal(seasonId, 0);
  if (sid <= 0) return null;
  const existing = getSeason(sid);
  if (existing) return existing;
  return ensureSeason(sid);
}

function _getSeasonStatusBase(now = nowSec()) {
  const currentTs = intVal(now, nowSec());
  const cacheAge = currentTs - intVal(_seasonStatusBaseCache.built_at, 0);
  if (_seasonStatusBaseCache.payload && cacheAge >= 0 && cacheAge < LEAGUE_STATUS_BASE_CACHE_TTL_SEC) {
    return _seasonStatusBaseCache.payload;
  }

  const timeline = getTimeline(currentTs);
  const currentSeason = _ensureSeasonForStatus(timeline.current_season_start);
  const registrationSeason = _ensureSeasonForStatus(timeline.registration_season_start);
  const currentNextRound = currentSeason
    ? (intVal(currentSeason.rounds_completed, 0) < intVal(currentSeason.total_rounds, 0)
      ? intVal(currentSeason.rounds_completed, 0) + 1
      : 0)
    : 0;
  const currentNextRoundAt = (currentSeason && currentNextRound > 0)
    ? getRoundScheduledAt(currentSeason.start_at, currentNextRound)
    : 0;

  const payload = {
    timeline,
    current_season: currentSeason,
    registration_season: registrationSeason,
    next_round_no: currentNextRound,
    next_round_at: currentNextRoundAt
  };
  _seasonStatusBaseCache.built_at = currentTs;
  _seasonStatusBaseCache.payload = payload;
  return payload;
}

function _invalidateSeasonTeamsCache(seasonId = 0) {
  const sid = intVal(seasonId, 0);
  if (sid > 0) {
    _seasonTeamsCache.delete(sid);
    for (const key of _memberTeamLookupCache.keys()) {
      if (String(key).startsWith(`${sid}:`)) _memberTeamLookupCache.delete(key);
    }
    return;
  }
  _seasonTeamsCache.clear();
  _memberTeamLookupCache.clear();
}

function _buildSeasonTeamsCache(seasonId) {
  const sid = intVal(seasonId, 0);
  if (sid <= 0) {
    return {
      builtAt: nowSec(),
      teams: [],
      memberTeams: new Map()
    };
  }
  const rows = db.prepare('SELECT * FROM league_teams WHERE season_id=? ORDER BY id ASC').all(sid);
  const teams = rows.map(hydrateTeam).filter(Boolean);
  const memberTeams = new Map();
  for (const t of teams) {
    const teamMembers = new Set();
    for (const m of (Array.isArray(t.members) ? t.members : [])) {
      const aid = intVal(m?.account_id, 0);
      if (aid > 0) teamMembers.add(aid);
    }
    for (const m of (Array.isArray(t.frozen) ? t.frozen : [])) {
      const aid = intVal(m?.account_id, 0);
      if (aid > 0) teamMembers.add(aid);
    }
    for (const aid of teamMembers) {
      if (!memberTeams.has(aid)) memberTeams.set(aid, []);
      memberTeams.get(aid).push(t);
    }
  }
  return {
    builtAt: nowSec(),
    teams,
    memberTeams
  };
}

function _getSeasonTeamsCache(seasonId) {
  const sid = intVal(seasonId, 0);
  if (sid <= 0) {
    return {
      builtAt: nowSec(),
      teams: [],
      memberTeams: new Map()
    };
  }
  const now = nowSec();
  const hit = _seasonTeamsCache.get(sid);
  if (hit && (now - intVal(hit.builtAt, 0) < LEAGUE_SEASON_TEAM_CACHE_TTL_SEC)) {
    return hit;
  }
  const rebuilt = _buildSeasonTeamsCache(sid);
  _seasonTeamsCache.set(sid, rebuilt);
  return rebuilt;
}

function listSeasonTeams(seasonId) {
  const cache = _getSeasonTeamsCache(seasonId);
  return Array.isArray(cache.teams) ? cache.teams.slice() : [];
}

function listRegisteredPendingTeamIds(seasonId) {
  return listSeasonTeams(seasonId)
    .filter(t => t && t.registered && String(t.status || '') === 'registered')
    .map(t => intVal(t.id, 0))
    .filter(x => x > 0);
}

function getTeamById(teamId) {
  return hydrateTeam(db.prepare('SELECT * FROM league_teams WHERE id=?').get(intVal(teamId, 0)));
}

function updateTeam(team) {
  db.prepare(`
    UPDATE league_teams
    SET name=?, captain_account_id=?, mode=?, registered=?, status=?, rating_seed=?, season_points=?, wins=?, draws=?, losses=?,
        members_json=?, frozen_json=?, skill_json=?, updated_at=?
    WHERE id=?
  `).run(
    String(team.name || ''),
    intVal(team.captain_account_id, 0),
    String(team.mode || 'manual'),
    team.registered ? 1 : 0,
    String(team.status || 'forming'),
    intVal(team.rating_seed, DEFAULT_LEAGUE_RATING),
    intVal(team.season_points, 0),
    intVal(team.wins, 0),
    intVal(team.draws, 0),
    intVal(team.losses, 0),
    JSON.stringify(normalizeMembers(team.members || [])),
    JSON.stringify(Array.isArray(team.frozen) ? team.frozen : []),
    JSON.stringify(team.skill_map && typeof team.skill_map === 'object' ? team.skill_map : {}),
    nowSec(),
    intVal(team.id, 0)
  );
  _invalidateSeasonTeamsCache(intVal(team.season_id, 0));
}

function deleteTeam(teamId) {
  const tid = intVal(teamId, 0);
  const row = db.prepare('SELECT season_id FROM league_teams WHERE id=?').get(tid);
  db.prepare('DELETE FROM league_teams WHERE id=?').run(tid);
  _invalidateSeasonTeamsCache(intVal(row?.season_id, 0));
}

function findTeamByCode(seasonId, teamCode) {
  const row = db.prepare('SELECT * FROM league_teams WHERE season_id=? AND team_code=?')
    .get(intVal(seasonId, 0), String(teamCode || '').trim().toUpperCase());
  return hydrateTeam(row);
}

function _teamStatusPriority(status) {
  const s = String(status || '');
  if (s === 'active') return 500;
  if (s === 'registered') return 400;
  if (s === 'forming') return 300;
  if (s === 'finished') return 200;
  if (s === 'disbanded') return 100;
  return 0;
}

function _pickPreferredMemberTeam(teams) {
  const arr = Array.isArray(teams) ? teams.filter(Boolean) : [];
  if (arr.length <= 0) return null;
  arr.sort((a, b) => {
    const pa = _teamStatusPriority(a?.status);
    const pb = _teamStatusPriority(b?.status);
    if (pb !== pa) return pb - pa;
    const ra = (a?.registered ? 1 : 0);
    const rb = (b?.registered ? 1 : 0);
    if (rb !== ra) return rb - ra;
    return intVal(b?.id, 0) - intVal(a?.id, 0);
  });
  return arr[0] || null;
}

function findTeamByMember(seasonId, accountId) {
  const sid = intVal(seasonId, 0);
  const aid = intVal(accountId, 0);
  if (aid <= 0 || sid <= 0) return null;
  const cache = _getSeasonTeamsCache(sid);
  const teams = cache.memberTeams.get(aid) || [];
  return _pickPreferredMemberTeam(teams);
}

async function findTeamByMemberAsync(seasonId, accountId) {
  const sid = intVal(seasonId, 0);
  const aid = intVal(accountId, 0);
  if (aid <= 0 || sid <= 0) return null;
  const cacheKey = `${sid}:${aid}`;
  const hit = _memberTeamLookupCache.get(cacheKey);
  if (hit && (nowSec() - intVal(hit?.builtAt, 0) < LEAGUE_MEMBER_TEAM_LOOKUP_CACHE_TTL_SEC)) {
    return hit.team || null;
  }
  try {
    const rows = await dbAsync.listLeagueTeamsByMemberAccount(sid, aid, 5);
    const teams = (Array.isArray(rows) ? rows : []).map(hydrateTeam).filter(Boolean);
    const chosen = _pickPreferredMemberTeam(teams);
    _memberTeamLookupCache.set(cacheKey, { builtAt: nowSec(), team: chosen || null });
    if (chosen) return chosen;
  } catch (_) {
    // Fallback to in-memory cache path when async query is unavailable.
  }
  const fallback = findTeamByMember(sid, aid);
  _memberTeamLookupCache.set(cacheKey, { builtAt: nowSec(), team: fallback || null });
  return fallback;
}

function _syncMembersFromFrozenIfNeeded(team) {
  if (!team || intVal(team.id, 0) <= 0) return team;
  const frozen = Array.isArray(team.frozen) ? team.frozen : [];
  if (frozen.length <= 0) return team;

  const targetMembers = normalizeMembers(frozen.map((m) => ({
    account_id: intVal(m?.account_id, 0),
    name: String(m?.name || `道友#${intVal(m?.account_id, 0)}`)
  })));
  if (targetMembers.length <= 0) return team;

  const currentMembers = normalizeMembers(team.members || []);
  if (currentMembers.length === targetMembers.length) {
    let same = true;
    for (let i = 0; i < currentMembers.length; i += 1) {
      if (intVal(currentMembers[i]?.account_id, 0) !== intVal(targetMembers[i]?.account_id, 0)) {
        same = false;
        break;
      }
    }
    if (same) return team;
  }

  team.members = targetMembers;
  updateTeam(team);
  return getTeamById(team.id) || team;
}

function randomTeamCode() {
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
  return raw.slice(0, 6);
}

function generateUniqueTeamCode(seasonId, prefix = '') {
  for (let i = 0; i < 20; i++) {
    const code = `${String(prefix || '')}${randomTeamCode()}`.slice(0, 10);
    if (!findTeamByCode(seasonId, code)) return code;
  }
  return `${String(prefix || '')}${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
}

function createTeam({ seasonId, captainAccountId, mode, members, registered, status, name, teamCode }) {
  const sid = intVal(seasonId, 0);
  const aid = intVal(captainAccountId, 0);
  const now = nowSec();
  db.prepare(`
    INSERT INTO league_teams
    (season_id, team_code, name, captain_account_id, mode, registered, status, rating_seed, season_points, wins, draws, losses,
     members_json, frozen_json, skill_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '[]', '{}', ?, ?)
  `).run(
    sid,
    String(teamCode || '').toUpperCase(),
    String(name || ''),
    aid,
    String(mode || 'manual'),
    registered ? 1 : 0,
    String(status || 'forming'),
    DEFAULT_LEAGUE_RATING,
    JSON.stringify(normalizeMembers(members || [])),
    now,
    now
  );
  _invalidateSeasonTeamsCache(sid);
  const id = db.prepare('SELECT last_insert_rowid() AS id').get()?.id;
  return getTeamById(id);
}

function ensurePlayerLeagueState(player) {
  if (!player || typeof player !== 'object') {
    return {
      rating: DEFAULT_LEAGUE_RATING,
      points: DEFAULT_LEAGUE_CURRENCY,
      dirty: false
    };
  }

  let dirty = false;
  const rawRating = Number(player.league_rating);
  const rawPoints = Number(player.league_points);

  if (!Number.isFinite(rawRating)) {
    if (Number.isFinite(rawPoints) && rawPoints >= DEFAULT_LEAGUE_RATING) {
      // 旧版本曾将 league_points 同时用于匹配种子和积分货币；迁移时拆分为 rating + 货币
      player.league_rating = intVal(rawPoints, DEFAULT_LEAGUE_RATING);
      player.league_points = Math.max(0, intVal(rawPoints, DEFAULT_LEAGUE_RATING) - DEFAULT_LEAGUE_RATING);
    } else {
      player.league_rating = DEFAULT_LEAGUE_RATING;
      if (!Number.isFinite(rawPoints)) player.league_points = DEFAULT_LEAGUE_CURRENCY;
    }
    dirty = true;
  }

  if (!Number.isFinite(Number(player.league_points))) {
    player.league_points = DEFAULT_LEAGUE_CURRENCY;
    dirty = true;
  }

  const normalizedRating = Math.max(0, intVal(player.league_rating, DEFAULT_LEAGUE_RATING));
  const normalizedPoints = Math.max(0, intVal(player.league_points, DEFAULT_LEAGUE_CURRENCY));
  if (normalizedRating !== intVal(player.league_rating, DEFAULT_LEAGUE_RATING)) {
    player.league_rating = normalizedRating;
    dirty = true;
  }
  if (normalizedPoints !== intVal(player.league_points, DEFAULT_LEAGUE_CURRENCY)) {
    player.league_points = normalizedPoints;
    dirty = true;
  }

  return {
    rating: normalizedRating,
    points: normalizedPoints,
    dirty
  };
}

function ensureLeagueShopPurchaseState(player) {
  if (!player || typeof player !== 'object') return {};
  if (!player.league_shop_purchases || typeof player.league_shop_purchases !== 'object' || Array.isArray(player.league_shop_purchases)) {
    player.league_shop_purchases = {};
  }
  return player.league_shop_purchases;
}

function isLeagueRegisterEligiblePlayer(player) {
  const realmQuality = getRealmQualityFromLevel(intVal(player?.level, 1));
  return realmQuality >= LEAGUE_REGISTER_MIN_REALM_QUALITY;
}

async function findFirstIneligibleTeamMember(team) {
  const members = normalizeMembers(team?.members || []);
  for (const m of members) {
    const aid = intVal(m.account_id, 0);
    if (aid <= 0) continue;
    const player = (typeof dbApi.getPlayerByAccountIdAsync === 'function')
      ? await dbApi.getPlayerByAccountIdAsync(aid)
      : dbApi.getPlayerByAccountId(aid);
    if (!player || !isLeagueRegisterEligiblePlayer(player)) {
      return {
        account_id: aid,
        name: String(player?.name || m.name || `道友#${aid}`)
      };
    }
  }
  return null;
}

async function buildFrozenMember(accountId) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return null;
  const player = (typeof dbApi.getPlayerByAccountIdAsync === 'function')
    ? await dbApi.getPlayerByAccountIdAsync(aid)
    : dbApi.getPlayerByAccountId(aid);
  if (!player || typeof player !== 'object') return null;

  const now = nowSec();
  const mainSvcSettle = cave.settleMainFormationServices(player, now);

  const working = structuredClone(player);
  ops.tryApplySkillPresetForBattle(working, 'duel');
  recalcAndAssignCombatStats(working, true);

  const leagueState = ensurePlayerLeagueState(player);
  if (mainSvcSettle?.changed || leagueState.dirty) dbApi.savePlayer(aid, 1, player);
  const learned = new Set(Object.keys(working.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
  const cfg = normalizeSkillConfig({
    equipped_skills: working.equipped_skills || [],
    key_skill_id: working.key_skill_id || 0
  }, learned);

  const frozenPlayer = structuredClone(working);
  delete frozenPlayer.inventory;
  frozenPlayer.hp = Math.max(1, intVal(frozenPlayer.max_hp, intVal(frozenPlayer.hp, 1)));
  frozenPlayer.mp = Math.max(0, intVal(frozenPlayer.max_mp, intVal(frozenPlayer.mp, 0)));

  return {
    account_id: aid,
    name: String(working.name || `道友#${aid}`),
    level: intVal(working.level, 1),
    league_rating: leagueState.rating,
    league_points: leagueState.points,
    frozen_player: frozenPlayer,
    skill_config: cfg
  };
}

async function freezeTeamRoster(team) {
  const members = normalizeMembers(team.members || []);
  if (members.length <= 0) {
    return { ok: false, error: '队伍成员数据异常，无法报名' };
  }

  const frozen = [];
  const existingSkillMap = team.skill_map && typeof team.skill_map === 'object' ? team.skill_map : {};
  const skillMap = {};
  let seed = DEFAULT_LEAGUE_RATING;
  for (const m of members) {
    const fm = await buildFrozenMember(m.account_id);
    if (!fm) {
      const failedName = String(m?.name || `道友#${intVal(m?.account_id, 0)}`);
      return { ok: false, error: `队员${failedName}角色数据读取失败，请稍后重试` };
    }
    const learned = new Set(Object.keys(fm.frozen_player?.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
    const cfg = pickBattleSkillConfig(existingSkillMap[String(fm.account_id)], fm.skill_config, learned);
    fm.skill_config = cfg;
    frozen.push(fm);
    skillMap[String(fm.account_id)] = cfg;
    seed = Math.max(seed, intVal(fm.league_rating, DEFAULT_LEAGUE_RATING));
  }

  if (frozen.length !== members.length) {
    return { ok: false, error: '队伍成员数据异常，无法报名' };
  }

  const nextTeam = {
    ...team,
    members: frozen.map(f => ({ account_id: f.account_id, name: f.name })),
    frozen,
    skill_map: skillMap,
    rating_seed: seed
  };
  return { ok: true, team: nextTeam };
}

function saveLeaguePlayer(aid, player, immediatePreferred = false) {
  const accountId = intVal(aid, 0);
  if (accountId <= 0 || !player) return;
  if (immediatePreferred && LEAGUE_SETTLE_IMMEDIATE_WRITE && typeof dbApi.savePlayerImmediate === 'function') {
    dbApi.savePlayerImmediate(accountId, 1, player);
    return;
  }
  dbApi.savePlayer(accountId, 1, player);
}

function awardLeaguePoints(accountId, points, title, content, options = null) {
  const aid = intVal(accountId, 0);
  const add = Math.max(0, intVal(points, 0));
  if (aid <= 0 || add <= 0) return false;

  // MySQL 模式下，dbApi.getPlayerByAccountId 同步读取在缓存 miss 时会返回 null。
  // 这里改为直接 SQL 原子累加，避免全服补发出现大量误失败。
  if (isMysqlDriver) {
    try {
      const ret = db.prepare(`
        UPDATE players
        SET
          data = JSON_SET(
            COALESCE(data, '{}'),
            '$.league_points',
            GREATEST(
              0,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.league_points')) AS SIGNED), 0) + ?
            )
          ),
          save_revision = COALESCE(save_revision, 0) + 1,
          updated_at = UNIX_TIMESTAMP()
        WHERE account_id = ?
      `).run(add, aid);
      if (Number(ret?.changes || 0) <= 0) {
        console.warn('[league] awardLeaguePoints mysql miss accountId=%s points=%s', aid, add);
        return false;
      }
      if (LEAGUE_SETTLE_SEND_POINT_MAIL && (title || content)) {
        dbApi.createMailboxMessage(aid, {
          type: 'system',
          title: String(title || '联赛积分结算'),
          content: String(content || `本次获得联赛积分 ${add} 点。`),
          attachments: []
        });
      }
      return true;
    } catch (e) {
      console.warn('[league] awardLeaguePoints mysql error accountId=%s points=%s err=%s', aid, add, e?.message || e);
      return false;
    }
  }

  const player = dbApi.getPlayerByAccountId(aid);
  if (!player) {
    console.warn(
      '[league] awardLeaguePoints miss accountId=%s points=%s driver=%s immediate=%s',
      aid,
      add,
      isMysqlDriver ? 'mysql' : 'sqlite',
      !!(options && options.immediate)
    );
    return false;
  }
  const leagueState = ensurePlayerLeagueState(player);
  player.league_points = Math.max(0, intVal(leagueState.points, 0) + add);
  const immediate = !!(options && options.immediate);
  saveLeaguePlayer(aid, player, immediate);
  if (LEAGUE_SETTLE_SEND_POINT_MAIL && (title || content)) {
    dbApi.createMailboxMessage(aid, {
      type: 'system',
      title: String(title || '联赛积分结算'),
      content: String(content || `本次获得联赛积分 ${add} 点。`),
      attachments: []
    });
  }
  return true;
}

function getRoundScheduledAt(seasonStart, roundNo) {
  const idx = Math.max(0, intVal(roundNo, 1) - 1);
  const dayOffset = Math.floor(idx / ROUND_SLOT_OFFSETS.length);
  const slot = idx % ROUND_SLOT_OFFSETS.length;
  return intVal(seasonStart, 0) + dayOffset * DAY_SEC + ROUND_SLOT_OFFSETS[slot];
}

function recommendLeagueNextCheckSec(season, now = nowSec()) {
  if (!season) return LEAGUE_IDLE_CHECK_SEC;

  const firstRoundAt = getRoundScheduledAt(season.start_at, 1);
  const initDueAt = firstRoundAt - LEAGUE_INIT_LEAD_SEC;

  if (!season.initialized) {
    if (now < initDueAt) return clampInt(initDueAt - now, 1, LEAGUE_IDLE_CHECK_SEC);
    return LEAGUE_ACTIVE_CHECK_SEC;
  }

  if (season.status !== 'running') {
    const nextSeasonStart = intVal(season.start_at, 0) + 7 * DAY_SEC;
    const nextInitDueAt = getRoundScheduledAt(nextSeasonStart, 1) - LEAGUE_INIT_LEAD_SEC;
    if (nextInitDueAt > now) {
      return clampInt(nextInitDueAt - now, LEAGUE_IDLE_CHECK_SEC, LEAGUE_FINISHED_CHECK_SEC);
    }
    return LEAGUE_IDLE_CHECK_SEC;
  }

  const nextRound = intVal(season.rounds_completed, 0) + 1;
  if (nextRound > intVal(season.total_rounds, 0)) return LEAGUE_IDLE_CHECK_SEC;
  const dueAt = getRoundScheduledAt(season.start_at, nextRound);
  if (now < dueAt) return clampInt(dueAt - now, 1, LEAGUE_IDLE_CHECK_SEC);
  return LEAGUE_ACTIVE_CHECK_SEC;
}

function buildLeagueBattleSource(member, skillMap) {
  const frozen = member?.frozen_player && typeof member.frozen_player === 'object'
    ? structuredClone(member.frozen_player)
    : {};
  const learnedSet = new Set(Object.keys(frozen.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
  const rawCfg = (skillMap && typeof skillMap === 'object') ? skillMap[String(member.account_id)] : null;
  const cfg = pickBattleSkillConfig(rawCfg, member.skill_config, learnedSet);

  frozen.equipped_skills = cfg.equipped_skills;
  frozen.key_skill_id = cfg.key_skill_id;
  frozen.hp = Math.max(1, intVal(frozen.max_hp, intVal(frozen.hp, 1)));
  frozen.mp = Math.max(0, intVal(frozen.max_mp, intVal(frozen.mp, 0)));
  frozen.account_id = intVal(member.account_id, 0);
  frozen.name = String(member.name || frozen.name || `道友#${frozen.account_id}`);
  return frozen;
}

function createEnemySnapshotFromMember(member, skillMap) {
  const source = buildLeagueBattleSource(member, skillMap);
  const snap = buildPlayerSnapshot(source, { skipInventory: true, battleMode: 'league', isTeamBattle: true });
  return {
    ...snap,
    __snapshot_ready: true,
    id: Math.max(1, intVal(member.account_id, 1)),
    name: String(member.name || source.name || `道友#${intVal(member.account_id, 0)}`),
    type: 'human',
    is_ally: false,
    alive: true
  };
}

function calcHpScore(units) {
  let score = 0;
  for (const u of (Array.isArray(units) ? units : [])) {
    const hp = Math.max(0, numVal(u?.hp, 0));
    const mhp = Math.max(1, numVal(u?.max_hp, 1));
    score += hp / mhp;
  }
  return score;
}

function collectBattleTexts(events, bag) {
  if (!LEAGUE_SIM_CAPTURE_LOGS) return;
  if (!Array.isArray(events) || !Array.isArray(bag)) return;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if ((ev.t === 'combat_log' || ev.t === 'battle_end' || ev.t === 'wave_clear') && ev.text) {
      bag.push(String(ev.text));
      if (bag.length > LEAGUE_BATTLE_LOG_MAX_LINES) bag.shift();
    }
  }
}

function simulateMatch(teamA, teamB) {
  if (!teamA || !teamB) {
    return {
      result: 'bye',
      winner: 'a',
      points_a: MATCH_POINTS.draw,
      points_b: 0,
      logs: ['轮空：本轮未匹配到对手，按平局积分结算。'],
      summary: { reason: 'bye' }
    };
  }

  const aMembers = (Array.isArray(teamA.frozen) ? teamA.frozen : []).slice(0, TEAM_SIZE);
  const bMembers = (Array.isArray(teamB.frozen) ? teamB.frozen : []).slice(0, TEAM_SIZE);
  if (aMembers.length <= 0 || bMembers.length <= 0) {
    return {
      result: 'draw',
      winner: 'none',
      points_a: MATCH_POINTS.draw,
      points_b: MATCH_POINTS.draw,
      logs: ['异常：队伍成员不足，本场按平局处理。'],
      summary: { reason: 'invalid_roster' }
    };
  }

  const allies = aMembers.map(m => buildLeagueBattleSource(m, teamA.skill_map));
  const enemyWave = [bMembers.map(m => createEnemySnapshotFromMember(m, teamB.skill_map))];

  const battleState = engine.createDungeonBattle({ id: 0, name: '联赛对决' }, allies, enemyWave, { battleMode: 'league' });
  battleState.battle_mode = 'league';

  let state = battleState;
  let ended = false;
  let victory = false;
  let draw = false;
  const logs = [];
  let guard = 0;

  while (state && state.status === 'active' && guard < LEAGUE_SIM_MAX_TURNS) {
    const r = engine.advanceTurn(state);
    if (!r || !r.ok) break;
    state = r.state;
    if (LEAGUE_SIM_CAPTURE_LOGS) collectBattleTexts(r.events || [], logs);
    ended = !!r.ended;
    victory = !!r.victory;
    draw = !!r.draw;
    if (ended) break;
    guard += 1;
  }

  let result = 'draw';
  let winner = 'none';
  if (ended) {
    if (draw) {
      result = 'draw';
      winner = 'none';
    } else if (victory) {
      result = 'a_win';
      winner = 'a';
    } else {
      result = 'b_win';
      winner = 'b';
    }
  } else {
    const aScore = calcHpScore(state?.allies);
    const bScore = calcHpScore(state?.enemies);
    const diff = aScore - bScore;
    if (diff > 0.05) {
      result = 'a_win';
      winner = 'a';
    } else if (diff < -0.05) {
      result = 'b_win';
      winner = 'b';
    } else {
      result = 'draw';
      winner = 'none';
    }
    logs.push(`战斗超时：按剩余状态判定（A:${aScore.toFixed(3)} / B:${bScore.toFixed(3)}）`);
  }

  let pointsA = MATCH_POINTS.draw;
  let pointsB = MATCH_POINTS.draw;
  if (result === 'a_win') {
    pointsA = MATCH_POINTS.win;
    pointsB = MATCH_POINTS.loss;
  } else if (result === 'b_win') {
    pointsA = MATCH_POINTS.loss;
    pointsB = MATCH_POINTS.win;
  }

  const summary = {
    rounds: intVal(state?.round, 0),
    guard,
    ended,
    a_hp_score: Number(calcHpScore(state?.allies).toFixed(4)),
    b_hp_score: Number(calcHpScore(state?.enemies).toFixed(4)),
    a_alive: (Array.isArray(state?.allies) ? state.allies : []).filter(u => u && u.hp > 0).length,
    b_alive: (Array.isArray(state?.enemies) ? state.enemies : []).filter(u => u && u.hp > 0).length
  };

  return {
    result,
    winner,
    points_a: pointsA,
    points_b: pointsB,
    logs,
    summary
  };
}

function sortTeamsForSwiss(teams) {
  return [...teams].sort((a, b) => {
    if (b.season_points !== a.season_points) return b.season_points - a.season_points;
    if (b.rating_seed !== a.rating_seed) return b.rating_seed - a.rating_seed;
    return a.id - b.id;
  });
}

function pairSwiss(teams) {
  const sorted = sortTeamsForSwiss(teams);
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 2) {
    const a = sorted[i];
    const b = (i + 1 < sorted.length) ? sorted[i + 1] : null;
    pairs.push([a, b]);
  }
  return pairs;
}

function insertMatchRecord({ seasonId, roundNo, matchNo, teamAId, teamBId, result, winnerTeamId, pointsA, pointsB, summary, logs }) {
  db.prepare(`
    INSERT INTO league_matches
    (season_id, round_no, match_no, team_a_id, team_b_id, result, winner_team_id, points_a, points_b, summary_json, battle_log_json, created_at, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    intVal(seasonId, 0),
    intVal(roundNo, 0),
    intVal(matchNo, 0),
    intVal(teamAId, 0),
    intVal(teamBId, 0),
    String(result || 'draw'),
    intVal(winnerTeamId, 0),
    intVal(pointsA, 0),
    intVal(pointsB, 0),
    JSON.stringify(summary || {}),
    JSON.stringify(Array.isArray(logs) ? logs : []),
    nowSec(),
    nowSec()
  );
}

function countRoundMatches(seasonId, roundNo) {
  const row = db.prepare('SELECT COUNT(1) AS c FROM league_matches WHERE season_id=? AND round_no=?')
    .get(intVal(seasonId, 0), intVal(roundNo, 0));
  return intVal(row?.c, 0);
}

function getRoundMaxMatchNo(seasonId, roundNo) {
  const row = db.prepare('SELECT MAX(match_no) AS m FROM league_matches WHERE season_id=? AND round_no=?')
    .get(intVal(seasonId, 0), intVal(roundNo, 0));
  return intVal(row?.m, 0);
}

function hasRoundMatchNo(seasonId, roundNo, matchNo) {
  const row = db.prepare('SELECT 1 AS ok FROM league_matches WHERE season_id=? AND round_no=? AND match_no=? LIMIT 1')
    .get(intVal(seasonId, 0), intVal(roundNo, 0), intVal(matchNo, 0));
  return !!row;
}

function isUniqueConstraintError(err) {
  const msg = String(err?.message || '');
  return String(err?.code || '') === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(msg);
}

function settleRoundMatchOnce({ seasonId, roundNo, matchNo, settleFn, matchRecord }) {
  const tx = db.transaction(() => {
    if (hasRoundMatchNo(seasonId, roundNo, matchNo)) return false;
    insertMatchRecord(matchRecord);
    if (typeof settleFn === 'function') settleFn();
    return true;
  });
  try {
    return !!tx();
  } catch (e) {
    if (isUniqueConstraintError(e)) return false;
    throw e;
  }
}

function applyTeamResult(team, points, resultTag) {
  team.season_points = intVal(team.season_points, 0) + intVal(points, 0);
  if (resultTag === 'win') team.wins = intVal(team.wins, 0) + 1;
  else if (resultTag === 'loss') team.losses = intVal(team.losses, 0) + 1;
  else team.draws = intVal(team.draws, 0) + 1;
  updateTeam(team);
}

function getTeamAverageLeagueRating(team) {
  const frozen = Array.isArray(team?.frozen) ? team.frozen : [];
  if (frozen.length <= 0) return DEFAULT_LEAGUE_RATING;
  let sum = 0;
  let cnt = 0;
  for (const m of frozen) {
    const r = intVal(m?.league_rating, DEFAULT_LEAGUE_RATING);
    sum += Math.max(0, r);
    cnt += 1;
  }
  if (cnt <= 0) return DEFAULT_LEAGUE_RATING;
  return Math.round(sum / cnt);
}

function calcLeagueRatingDelta(teamRating, oppRating, score) {
  const ra = Number(teamRating);
  const rb = Number(oppRating);
  const s = Number(score);
  const safeRa = Number.isFinite(ra) ? ra : DEFAULT_LEAGUE_RATING;
  const safeRb = Number.isFinite(rb) ? rb : DEFAULT_LEAGUE_RATING;
  const safeScore = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0.5;
  const expected = 1 / (1 + Math.pow(10, (safeRb - safeRa) / 400));
  return Math.round(LEAGUE_RATING_K * (safeScore - expected));
}

function applyLeagueRatingDeltaToTeamMembers(team, delta) {
  const d = intVal(delta, 0);
  if (!team || d === 0) return;

  const frozen = Array.isArray(team.frozen) ? team.frozen : [];
  const seen = new Set();
  for (const m of frozen) {
    const aid = intVal(m?.account_id, 0);
    if (aid <= 0 || seen.has(aid)) continue;
    seen.add(aid);

    const player = dbApi.getPlayerByAccountId(aid);
    if (!player) continue;
    const st = ensurePlayerLeagueState(player);
    const nextRating = Math.max(0, intVal(st.rating, DEFAULT_LEAGUE_RATING) + d);
    if (nextRating !== intVal(st.rating, DEFAULT_LEAGUE_RATING)) {
      player.league_rating = nextRating;
      saveLeaguePlayer(aid, player, true);
    } else if (st.dirty) {
      saveLeaguePlayer(aid, player, true);
    }

    m.league_rating = nextRating;
  }

  let maxRating = DEFAULT_LEAGUE_RATING;
  for (const m of frozen) {
    maxRating = Math.max(maxRating, intVal(m?.league_rating, DEFAULT_LEAGUE_RATING));
  }
  team.rating_seed = maxRating;
  updateTeam(team);
}

function collectTeamMemberAccountIds(team) {
  const ids = new Set();
  const frozen = Array.isArray(team?.frozen) ? team.frozen : [];
  for (const m of frozen) {
    const aid = intVal(m?.account_id, 0);
    if (aid > 0) ids.add(aid);
  }
  const members = normalizeMembers(team?.members || []);
  for (const m of members) {
    const aid = intVal(m?.account_id, 0);
    if (aid > 0) ids.add(aid);
  }
  return [...ids];
}

async function warmLeagueAwardCache(team) {
  if (!isMysqlDriver) return;
  const ids = collectTeamMemberAccountIds(team);
  if (ids.length <= 0) return;
  await Promise.all(ids.map(async (aid) => {
    try {
      await dbAsync.prefetchPlayerAsync(aid);
    } catch (e) {
      console.warn('[league] warmLeagueAwardCache failed accountId=%s err=%s', aid, e?.message || e);
    }
  }));
}

function diagnoseAwardFailure(teamId, failedIds, points, reasonPrefix) {
  if (!isMysqlDriver || !Array.isArray(failedIds) || failedIds.length <= 0) return;
  Promise.allSettled(failedIds.map((aid) => dbAsync.getPlayerByAccountId(aid)))
    .then((rows) => {
      let exists = 0;
      let missing = 0;
      let errors = 0;
      const missingIds = [];
      for (let i = 0; i < rows.length; i++) {
        const one = rows[i];
        const aid = intVal(failedIds[i], 0);
        if (one.status === 'fulfilled') {
          if (one.value) exists += 1;
          else {
            missing += 1;
            if (aid > 0) missingIds.push(aid);
          }
        } else {
          errors += 1;
        }
      }
      console.warn(
        '[league] awardTeamMembersPoints diagnose: teamId=%s points=%s reason=%s failed=%s exists=%s missing=%s errors=%s missingIds=%j',
        intVal(teamId, 0),
        intVal(points, 0),
        String(reasonPrefix || ''),
        failedIds.length,
        exists,
        missing,
        errors,
        missingIds
      );
    })
    .catch((e) => {
      console.warn('[league] awardTeamMembersPoints diagnose failed teamId=%s err=%s', intVal(teamId, 0), e?.message || e);
    });
}

function awardTeamMembersPoints(team, points, reasonPrefix) {
  const add = Math.max(0, intVal(points, 0));
  if (add <= 0) return;
  const memberIds = collectTeamMemberAccountIds(team);
  if (memberIds.length <= 0) {
    console.warn('[league] awardTeamMembersPoints skipped: no member ids teamId=%s', intVal(team?.id, 0));
    return;
  }
  let awarded = 0;
  const failedIds = [];
  for (const aid of memberIds) {
    const ok = awardLeaguePoints(
      aid,
      add,
      '联赛积分结算',
      `${String(reasonPrefix || '联赛对战')}：获得联赛积分 ${add} 点。`,
      { immediate: true }
    );
    if (ok) awarded += 1;
    else failedIds.push(aid);
  }
  if (awarded < memberIds.length) {
    console.warn(
      '[league] awardTeamMembersPoints partial: teamId=%s awarded=%s expected=%s failed=%j',
      intVal(team?.id, 0),
      awarded,
      memberIds.length,
      failedIds
    );
    diagnoseAwardFailure(intVal(team?.id, 0), failedIds, add, reasonPrefix);
  }
}

function buildPendingCompensation(poolMembers, totalRounds) {
  const rounds = intVal(totalRounds, 0);
  if (rounds <= 0) return [];
  const compensation = rounds * MATCH_POINTS.loss;
  if (compensation <= 0) return [];

  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(poolMembers) ? poolMembers : []) {
    const aid = intVal(m?.account_id, 0);
    if (aid <= 0 || seen.has(aid)) continue;
    seen.add(aid);
    out.push({ account_id: aid, points: compensation });
  }
  return out;
}

function settlePendingCompensationIfNeeded(season) {
  if (!season || typeof season !== 'object') return 0;
  const meta = season.meta && typeof season.meta === 'object' ? season.meta : {};
  if (meta.compensation_settled === true) return 0;

  const pending = Array.isArray(meta.pending_compensation) ? meta.pending_compensation : [];
  let awarded = 0;
  const failed = [];
  for (const row of pending) {
    const aid = intVal(row?.account_id, 0);
    const pts = Math.max(0, intVal(row?.points, 0));
    if (aid <= 0 || pts <= 0) continue;
    const ok = awardLeaguePoints(
      aid,
      pts,
      '联赛补偿',
      `本期联赛组队未满员，系统补偿你 ${pts} 点联赛积分（按本期总轮次等同负场结算）。`,
      { immediate: true }
    );
    if (ok) {
      awarded += 1;
    } else {
      failed.push({ account_id: aid, points: pts });
    }
  }

  meta.pending_compensation = failed;
  meta.compensation_settled = failed.length <= 0;
  meta.compensation_settled_at = nowSec();
  meta.pending_compensation_count = pending.length;
  meta.pending_compensation_failed = failed.length;
  season.meta = meta;
  saveSeason(season);
  if (failed.length > 0) {
    console.warn('[league] compensation partial: season=%s awarded=%s failed=%s failed_accounts=%j', intVal(season?.season_id, 0), awarded, failed.length, failed.map(x => intVal(x.account_id, 0)));
  }
  return awarded;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function createSystemTeamFromPool(seasonId, members) {
  const normalizedMembers = members.map(m => ({ account_id: intVal(m.account_id, 0), name: String(m.name || '') }));
  const frozen = members.map(m => ({ ...m }));
  const skillMap = {};
  let seed = DEFAULT_LEAGUE_RATING;
  for (const m of frozen) {
    skillMap[String(m.account_id)] = m.skill_config || { equipped_skills: [], key_skill_id: 0 };
    seed = Math.max(seed, intVal(m.league_rating, DEFAULT_LEAGUE_RATING));
  }

  const code = generateUniqueTeamCode(seasonId, 'SYS');
  const team = createTeam({
    seasonId,
    captainAccountId: intVal(normalizedMembers[0]?.account_id, 0),
    mode: 'system',
    members: normalizedMembers,
    registered: true,
    status: 'active',
    name: '系统配队',
    teamCode: code
  });
  team.frozen = frozen;
  team.skill_map = skillMap;
  team.rating_seed = seed;
  updateTeam(team);
  return team;
}

function initializeSeasonIfNeeded(seasonId, now = nowSec()) {
  const season = ensureSeason(seasonId);
  if (!season) return null;
  if (season.initialized) return season;
  if (intVal(now, 0) < intVal(season.start_at, 0)) return season;

  const meta = season.meta && typeof season.meta === 'object' ? season.meta : {};
  let initTask = meta.init_task && typeof meta.init_task === 'object' ? meta.init_task : null;
  if (!initTask || !Array.isArray(initTask.team_ids)) {
    const pendingTeamIds = listRegisteredPendingTeamIds(seasonId);
    shuffleInPlace(pendingTeamIds);
    initTask = {
      phase: 'scan',
      team_ids: pendingTeamIds,
      next_index: 0,
      carry_members: [],
      active_team_count: 0,
      started_at: nowSec(),
      updated_at: nowSec()
    };
    meta.init_task = initTask;
    season.meta = meta;
    saveSeason(season);
  }

  const firstRoundAt = getRoundScheduledAt(season.start_at, 1);
  const secToStart = Math.max(0, intVal(firstRoundAt, 0) - intVal(now, 0));
  const teamBatchCap = secToStart <= LEAGUE_INIT_CATCHUP_BEFORE_START_SEC
    ? LEAGUE_INIT_CATCHUP_TEAMS_PER_TICK
    : LEAGUE_INIT_TEAMS_PER_TICK;

  const carryMembers = Array.isArray(initTask.carry_members) ? initTask.carry_members : [];
  initTask.carry_members = carryMembers;

  let processedTeams = 0;
  let createdSystemTeams = 0;

  while (processedTeams < teamBatchCap && intVal(initTask.next_index, 0) < initTask.team_ids.length) {
    const idx = intVal(initTask.next_index, 0);
    const tid = intVal(initTask.team_ids[idx], 0);
    initTask.next_index = idx + 1;
    initTask.updated_at = nowSec();
    processedTeams += 1;

    const team = getTeamById(tid);
    if (!team || !team.registered || String(team.status || '') !== 'registered') continue;

    const frozen = Array.isArray(team.frozen) ? team.frozen : [];
    const validFrozen = frozen.filter(m => intVal(m?.account_id, 0) > 0);

    if (validFrozen.length >= TEAM_SIZE) {
      team.frozen = validFrozen.slice(0, TEAM_SIZE);
      team.members = team.frozen.map(m => ({ account_id: intVal(m.account_id, 0), name: String(m.name || '') }));
      const skillMap = team.skill_map && typeof team.skill_map === 'object' ? team.skill_map : {};
      const normalizedSkillMap = {};
      let seed = DEFAULT_LEAGUE_RATING;
      for (const m of team.frozen) {
        const learned = new Set(Object.keys(m.frozen_player?.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
        normalizedSkillMap[String(m.account_id)] = pickBattleSkillConfig(skillMap[String(m.account_id)], m.skill_config, learned);
        seed = Math.max(seed, intVal(m.league_rating, DEFAULT_LEAGUE_RATING));
      }
      team.skill_map = normalizedSkillMap;
      team.rating_seed = seed;
      team.status = 'active';
      updateTeam(team);
      initTask.active_team_count = intVal(initTask.active_team_count, 0) + 1;
      continue;
    }

    for (const m of validFrozen) carryMembers.push(m);
    while (carryMembers.length >= TEAM_SIZE) {
      const members = carryMembers.splice(0, TEAM_SIZE);
      createSystemTeamFromPool(seasonId, members);
      initTask.active_team_count = intVal(initTask.active_team_count, 0) + 1;
      createdSystemTeams += 1;
    }

    team.status = 'disbanded';
    updateTeam(team);
  }

  const scanDone = intVal(initTask.next_index, 0) >= initTask.team_ids.length;
  if (!scanDone) {
    meta.init_task = initTask;
    season.meta = meta;
    saveSeason(season);
    if (processedTeams > 0 || createdSystemTeams > 0) {
      console.log(`[league] init batch processed teams=${processedTeams}/${teamBatchCap}, idx=${intVal(initTask.next_index, 0)}/${initTask.team_ids.length}, active=${intVal(initTask.active_team_count, 0)}, carry=${carryMembers.length}, sys_created=${createdSystemTeams}, tts=${secToStart}s`);
    }
    return getSeason(seasonId);
  }

  const totalRounds = calcSwissRounds(intVal(initTask.active_team_count, 0));
  const pendingCompensation = buildPendingCompensation(carryMembers, totalRounds);

  season.total_rounds = totalRounds;
  season.rounds_completed = 0;
  season.initialized = true;
  season.status = totalRounds > 0 ? 'running' : 'finished';
  meta.team_count = intVal(initTask.active_team_count, 0);
  meta.initialized_at = nowSec();
  meta.pending_compensation = pendingCompensation;
  meta.compensation_settled = pendingCompensation.length <= 0;
  delete meta.init_task;
  season.meta = meta;
  saveSeason(season);

  console.log(`[league] init completed teams=${initTask.team_ids.length}, active=${meta.team_count}, rounds=${totalRounds}, carry=${carryMembers.length}`);

  if (season.status === 'finished') {
    const activeTeams = listSeasonTeams(seasonId).filter(t => t.status === 'active');
    for (const t of activeTeams) {
      t.status = 'finished';
      updateTeam(t);
    }
    settlePendingCompensationIfNeeded(season);
  }

  return getSeason(seasonId);
}

function runOneRound(season, roundNo, now = nowSec()) {
  const sid = intVal(season?.season_id, 0);
  const rn = intVal(roundNo, 0);
  if (sid <= 0 || rn <= 0) return { progressed: false, roundCompleted: false, processed_matches: 0 };
  if (intVal(season.rounds_completed, 0) >= rn) {
    return { progressed: false, roundCompleted: true, processed_matches: 0 };
  }

  const meta = season.meta && typeof season.meta === 'object' ? season.meta : {};
  let task = meta.round_task && typeof meta.round_task === 'object' ? meta.round_task : null;
  if (!task || intVal(task.round_no, 0) !== rn || !Array.isArray(task.pair_team_ids)) {
    const activeTeams = listSeasonTeams(sid).filter(t => t.status === 'active');
    if (activeTeams.length <= 1) {
      season.rounds_completed = rn;
      season.status = 'finished';
      saveSeason(season);
      for (const t of activeTeams) {
        t.status = 'finished';
        updateTeam(t);
      }
      settlePendingCompensationIfNeeded(season);
      return { progressed: true, roundCompleted: true, processed_matches: 0 };
    }
    const pairs = pairSwiss(activeTeams);
    const pairTeamIds = pairs.map(pair => [intVal(pair?.[0]?.id, 0), intVal(pair?.[1]?.id, 0)]);
    const nextByDb = getRoundMaxMatchNo(sid, rn) + 1;
    task = {
      round_no: rn,
      pair_team_ids: pairTeamIds,
      total_matches: pairTeamIds.length,
      next_match_no: Math.max(1, intVal(nextByDb, 1)),
      started_at: nowSec(),
      updated_at: nowSec()
    };
    meta.round_task = task;
    season.meta = meta;
    saveSeason(season);
  }

  const totalMatches = Math.max(0, intVal(task.total_matches, Array.isArray(task.pair_team_ids) ? task.pair_team_ids.length : 0));
  let processedMatches = 0;
  let anyProgress = false;
  const tickStartMs = Date.now();
  const tickDeadlineMs = tickStartMs + LEAGUE_ROUND_TICK_BUDGET_MS;

  while (processedMatches < LEAGUE_MATCHES_PER_TICK && intVal(task.next_match_no, 1) <= totalMatches) {
    if (processedMatches > 0 && Date.now() >= tickDeadlineMs) break;
    const matchNo = Math.max(1, intVal(task.next_match_no, 1));
    task.next_match_no = matchNo + 1;
    task.updated_at = nowSec();

    if (hasRoundMatchNo(sid, rn, matchNo)) {
      continue;
    }

    const pairIds = Array.isArray(task.pair_team_ids) ? task.pair_team_ids[matchNo - 1] : null;
    const teamAId = intVal(Array.isArray(pairIds) ? pairIds[0] : 0, 0);
    const teamBId = intVal(Array.isArray(pairIds) ? pairIds[1] : 0, 0);
    let teamA = getTeamById(teamAId);
    let teamB = teamBId > 0 ? getTeamById(teamBId) : null;

    if (teamA) teamA = _syncMembersFromFrozenIfNeeded(teamA);
    if (teamB) teamB = _syncMembersFromFrozenIfNeeded(teamB);

    if (!teamA || String(teamA.status || '') !== 'active') {
      const settled = settleRoundMatchOnce({
        seasonId: sid,
        roundNo: rn,
        matchNo,
        settleFn: null,
        matchRecord: {
          seasonId: sid,
          roundNo: rn,
          matchNo,
          teamAId,
          teamBId,
          result: 'draw',
          winnerTeamId: 0,
          pointsA: 0,
          pointsB: 0,
          summary: { reason: 'invalid_team_a' },
          logs: ['队伍A无效，本场按无效场次处理。']
        }
      });
      if (settled) {
        processedMatches += 1;
        anyProgress = true;
      }
      continue;
    }

    if (!teamB || String(teamB.status || '') !== 'active') {
      void warmLeagueAwardCache(teamA);
      const byePoints = MATCH_POINTS.draw;
      const settled = settleRoundMatchOnce({
        seasonId: sid,
        roundNo: rn,
        matchNo,
        settleFn: () => {
          applyTeamResult(teamA, byePoints, 'draw');
          awardTeamMembersPoints(teamA, byePoints, '联赛轮空结算');
        },
        matchRecord: {
          seasonId: sid,
          roundNo: rn,
          matchNo,
          teamAId: teamA.id,
          teamBId: 0,
          result: 'bye',
          winnerTeamId: 0,
          pointsA: byePoints,
          pointsB: 0,
          summary: { reason: 'bye_or_invalid_team_b' },
          logs: ['轮空：本轮未匹配到有效对手，按平局积分结算。']
        }
      });
      if (settled) {
        processedMatches += 1;
        anyProgress = true;
      }
      continue;
    }

    void warmLeagueAwardCache(teamA);
    void warmLeagueAwardCache(teamB);

    const sim = simulateMatch(teamA, teamB);
    const winnerTeamId = sim.result === 'a_win' ? teamA.id : (sim.result === 'b_win' ? teamB.id : 0);
    const settled = settleRoundMatchOnce({
      seasonId: sid,
      roundNo: rn,
      matchNo,
      settleFn: () => {
        if (sim.result === 'a_win') {
          applyTeamResult(teamA, sim.points_a, 'win');
          applyTeamResult(teamB, sim.points_b, 'loss');
        } else if (sim.result === 'b_win') {
          applyTeamResult(teamA, sim.points_a, 'loss');
          applyTeamResult(teamB, sim.points_b, 'win');
        } else {
          applyTeamResult(teamA, sim.points_a, 'draw');
          applyTeamResult(teamB, sim.points_b, 'draw');
        }

        awardTeamMembersPoints(teamA, sim.points_a, `联赛第${rn}轮结算`);
        awardTeamMembersPoints(teamB, sim.points_b, `联赛第${rn}轮结算`);

        const ratingA = getTeamAverageLeagueRating(teamA);
        const ratingB = getTeamAverageLeagueRating(teamB);
        let scoreA = 0.5;
        if (sim.result === 'a_win') scoreA = 1;
        else if (sim.result === 'b_win') scoreA = 0;
        const deltaA = calcLeagueRatingDelta(ratingA, ratingB, scoreA);
        const deltaB = -deltaA;
        applyLeagueRatingDeltaToTeamMembers(teamA, deltaA);
        applyLeagueRatingDeltaToTeamMembers(teamB, deltaB);
      },
      matchRecord: {
        seasonId: sid,
        roundNo: rn,
        matchNo,
        teamAId: teamA.id,
        teamBId: teamB.id,
        result: sim.result,
        winnerTeamId,
        pointsA: sim.points_a,
        pointsB: sim.points_b,
        summary: sim.summary,
        logs: sim.logs
      }
    });

    if (settled) {
      processedMatches += 1;
      anyProgress = true;
    }
  }

  const roundCompleted = intVal(task.next_match_no, 1) > totalMatches;
  const tickCostMs = Date.now() - tickStartMs;
  if (roundCompleted) {
    if (processedMatches > 0) {
      console.log(`[league] round ${rn} completed, processed ${processedMatches}/${totalMatches} matches in this tick (${tickCostMs}ms)`);
    }
    season.rounds_completed = Math.max(intVal(season.rounds_completed, 0), rn);
    delete meta.round_task;
    if (season.rounds_completed >= intVal(season.total_rounds, 0)) {
      season.status = 'finished';
      const allTeams = listSeasonTeams(sid).filter(t => t.status === 'active');
      for (const t of allTeams) {
        t.status = 'finished';
        updateTeam(t);
      }
    }
    season.meta = meta;
    saveSeason(season);
    if (season.status === 'finished') settlePendingCompensationIfNeeded(season);
    return { progressed: anyProgress, roundCompleted: true, processed_matches: processedMatches, tick_ms: tickCostMs };
  }

  meta.round_task = task;
  season.meta = meta;
  saveSeason(season);
  if (processedMatches > 0 && LEAGUE_VERBOSE_LOG) {
    console.log(`[league] round ${rn} batch processed ${processedMatches}/${totalMatches}, next match_no=${intVal(task.next_match_no, 1)}`);
  }
  return { progressed: anyProgress, roundCompleted: false, processed_matches: processedMatches, tick_ms: tickCostMs };
}

function tryRunDueLeagueWork(now = nowSec()) {
  if (_leagueSettleRunning) {
    return {
      ok: true,
      progressed: false,
      busy: true,
      next_check_in_sec: LEAGUE_ACTIVE_CHECK_SEC
    };
  }

  _leagueSettleRunning = true;
  try {
  const timeline = getTimeline(now);
  const currentSeasonId = timeline.current_season_start;
  let season = ensureSeason(currentSeasonId);
  if (!season) return { ok: false, error: 'season_unavailable', next_check_in_sec: LEAGUE_IDLE_CHECK_SEC };

  const firstRoundAt = getRoundScheduledAt(season.start_at, 1);
  const initDueAt = firstRoundAt - LEAGUE_INIT_LEAD_SEC;
  if (now >= initDueAt) {
    season = initializeSeasonIfNeeded(currentSeasonId, now);
  }

  if (!season || !season.initialized || season.status !== 'running') {
    if (season && season.initialized && season.status === 'finished') {
      settlePendingCompensationIfNeeded(season);
      season = getSeason(currentSeasonId);
    }
    return {
      ok: true,
      progressed: false,
      season,
      next_check_in_sec: recommendLeagueNextCheckSec(season, now)
    };
  }

  let progressed = false;
  let nextCheckSec = LEAGUE_ACTIVE_CHECK_SEC;
  let guard = 0;
  let chunkRoundNo = 0;
  let roundChunkCount = 0;
  while (guard < LEAGUE_MAX_LOOPS_PER_RUN) {
    season = getSeason(currentSeasonId);
    if (!season || season.status !== 'running') break;
    const nextRound = intVal(season.rounds_completed, 0) + 1;
    if (nextRound > intVal(season.total_rounds, 0)) {
      nextCheckSec = LEAGUE_IDLE_CHECK_SEC;
      break;
    }
    const dueAt = getRoundScheduledAt(season.start_at, nextRound);
    if (now < dueAt) {
      nextCheckSec = clampInt(dueAt - now, 1, LEAGUE_IDLE_CHECK_SEC);
      break;
    }

    if (chunkRoundNo !== nextRound) {
      chunkRoundNo = nextRound;
      roundChunkCount = 0;
    }
    const lagSec = Math.max(0, intVal(now, 0) - intVal(dueAt, 0));
    const chunkCap = lagSec >= LEAGUE_CATCHUP_LAG_SEC
      ? LEAGUE_CATCHUP_CHUNKS_PER_TICK
      : LEAGUE_BASE_CHUNKS_PER_TICK;
    const chunkMode = lagSec >= LEAGUE_CATCHUP_LAG_SEC ? 'catchup' : 'normal';

    const roundRun = runOneRound(season, nextRound, now);
    progressed = progressed || Boolean(roundRun?.progressed);
    guard += 1;
    if (!roundRun) break;
    if (roundRun.roundCompleted === true) {
      roundChunkCount = 0;
      nextCheckSec = LEAGUE_ACTIVE_CHECK_SEC;
      continue;
    }
    if (!roundRun.progressed) break;
    roundChunkCount += 1;
    if (roundChunkCount === 1 && (LEAGUE_VERBOSE_LOG || chunkMode === 'catchup')) {
      console.log(`[league] round ${nextRound} tick mode=${chunkMode} chunk_cap=${chunkCap} lag=${lagSec}s`);
    }
    if (roundChunkCount >= chunkCap) break;
  }

  const finalSeason = getSeason(currentSeasonId);
  if (!progressed) {
    nextCheckSec = recommendLeagueNextCheckSec(finalSeason || season, now);
  }

  return {
    ok: true,
    progressed,
    season: finalSeason,
    next_check_in_sec: nextCheckSec
  };
  } finally {
    _leagueSettleRunning = false;
  }
}

function getTeamPublicView(team) {
  if (!team) return null;
  return {
    id: team.id,
    season_id: team.season_id,
    team_code: team.team_code,
    name: team.name,
    captain_account_id: team.captain_account_id,
    mode: team.mode,
    registered: team.registered,
    status: team.status,
    rating_seed: team.rating_seed,
    season_points: team.season_points,
    wins: team.wins,
    draws: team.draws,
    losses: team.losses,
    members: team.members
  };
}

function getSeasonStatus(now = nowSec(), accountId = 0) {
  const statusBase = _getSeasonStatusBase(now);
  const timeline = statusBase.timeline;
  const currentSeason = statusBase.current_season;
  const registrationSeason = statusBase.registration_season;

  const meCurrentTeam = accountId > 0 ? findTeamByMember(timeline.current_season_start, accountId) : null;
  const meRegTeam = accountId > 0 ? findTeamByMember(timeline.registration_season_start, accountId) : null;
  const myCurrentSkillConfig = getTeamMemberSkillConfig(meCurrentTeam, accountId);
  const myRegistrationSkillConfig = getTeamMemberSkillConfig(meRegTeam, accountId);

  let mySkillConfig = null;
  let mySkillConfigSource = '';
  if (myRegistrationSkillConfig) {
    mySkillConfig = myRegistrationSkillConfig;
    mySkillConfigSource = 'registration';
  } else if (myCurrentSkillConfig) {
    mySkillConfig = myCurrentSkillConfig;
    mySkillConfigSource = 'current';
  }

  let myLeague = null;
  if (intVal(accountId, 0) > 0) {
    const player = dbApi.getPlayerByAccountId(intVal(accountId, 0));
    if (player) {
      const leagueState = ensurePlayerLeagueState(player);
      if (leagueState.dirty) dbApi.savePlayer(intVal(accountId, 0), 1, player);
      myLeague = {
        league_points: leagueState.points,
        league_rating: leagueState.rating
      };
    }
  }

  return {
    timeline,
    current_season: currentSeason,
    registration_season: registrationSeason,
    my_account_id: intVal(accountId, 0),
    me_current_team: getTeamPublicView(meCurrentTeam),
    me_registration_team: getTeamPublicView(meRegTeam),
    my_skill_config: mySkillConfig,
    my_skill_config_source: mySkillConfigSource,
    my_league: myLeague,
    next_round_no: intVal(statusBase.next_round_no, 0),
    next_round_at: intVal(statusBase.next_round_at, 0)
  };
}

async function getSeasonStatusAsync(now = nowSec(), accountId = 0) {
  const statusBase = _getSeasonStatusBase(now);
  const timeline = statusBase.timeline;
  const currentSeason = statusBase.current_season;
  const registrationSeason = statusBase.registration_season;

  const aid = intVal(accountId, 0);
  let meCurrentTeam = null;
  let meRegTeam = null;
  let player = null;
  if (aid > 0) {
    const currentSid = intVal(timeline.current_season_start, 0);
    const regSid = intVal(timeline.registration_season_start, 0);
    if (currentSid > 0 && currentSid === regSid) {
      [meCurrentTeam, player] = await Promise.all([
        findTeamByMemberAsync(currentSid, aid),
        dbAsync.getPlayerByAccountId(aid)
      ]);
      meRegTeam = meCurrentTeam;
    } else {
      [meCurrentTeam, meRegTeam, player] = await Promise.all([
        findTeamByMemberAsync(currentSid, aid),
        findTeamByMemberAsync(regSid, aid),
        dbAsync.getPlayerByAccountId(aid)
      ]);
    }
  }
  const myCurrentSkillConfig = getTeamMemberSkillConfig(meCurrentTeam, accountId);
  const myRegistrationSkillConfig = getTeamMemberSkillConfig(meRegTeam, accountId);

  let mySkillConfig = null;
  let mySkillConfigSource = '';
  if (myRegistrationSkillConfig) {
    mySkillConfig = myRegistrationSkillConfig;
    mySkillConfigSource = 'registration';
  } else if (myCurrentSkillConfig) {
    mySkillConfig = myCurrentSkillConfig;
    mySkillConfigSource = 'current';
  }

  let myLeague = null;
  if (aid > 0 && player) {
    const leagueState = ensurePlayerLeagueState(player);
    if (leagueState.dirty) await dbAsync.savePlayer(aid, 1, player);
    myLeague = {
      league_points: leagueState.points,
      league_rating: leagueState.rating
    };
  }

  return {
    timeline,
    current_season: currentSeason,
    registration_season: registrationSeason,
    my_account_id: intVal(accountId, 0),
    me_current_team: getTeamPublicView(meCurrentTeam),
    me_registration_team: getTeamPublicView(meRegTeam),
    my_skill_config: mySkillConfig,
    my_skill_config_source: mySkillConfigSource,
    my_league: myLeague,
    next_round_no: intVal(statusBase.next_round_no, 0),
    next_round_at: intVal(statusBase.next_round_at, 0)
  };
}

async function createManualTeam(accountId, teamName, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };
  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };

  const seasonId = timeline.registration_season_start;
  ensureSeason(seasonId);

  if (findTeamByMember(seasonId, aid)) {
    return { ok: false, error: '你已在本期联赛队伍中' };
  }

  const player = (typeof dbApi.getPlayerByAccountIdAsync === 'function')
    ? await dbApi.getPlayerByAccountIdAsync(aid)
    : dbApi.getPlayerByAccountId(aid);
  if (!player) return { ok: false, error: '无角色' };
  if (!isLeagueRegisterEligiblePlayer(player)) {
    return { ok: false, error: '仅金丹及以上境界可报名联赛' };
  }

  const code = generateUniqueTeamCode(seasonId, 'L');
  const name = String(teamName || `${String(player.name || '道友')}战队`).slice(0, 24);
  const team = createTeam({
    seasonId,
    captainAccountId: aid,
    mode: 'manual',
    members: [{ account_id: aid, name: String(player.name || `道友#${aid}`) }],
    registered: false,
    status: 'forming',
    name,
    teamCode: code
  });
  return { ok: true, team: getTeamPublicView(team) };
}

async function joinTeam(accountId, joinCode, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };
  const code = String(joinCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: '请输入队伍加入码' };

  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };
  const seasonId = timeline.registration_season_start;

  if (findTeamByMember(seasonId, aid)) {
    return { ok: false, error: '你已在本期联赛队伍中' };
  }

  const team = findTeamByCode(seasonId, code);
  if (!team) return { ok: false, error: '队伍不存在或加入码错误' };
  if (team.mode !== 'manual') return { ok: false, error: '该队伍不可手动加入' };
  if (team.registered) return { ok: false, error: '该队伍已完成报名，无法加入' };

  const members = normalizeMembers(team.members);
  if (members.length >= TEAM_SIZE) return { ok: false, error: '该队伍已满员' };

  const player = (typeof dbApi.getPlayerByAccountIdAsync === 'function')
    ? await dbApi.getPlayerByAccountIdAsync(aid)
    : dbApi.getPlayerByAccountId(aid);
  if (!player) return { ok: false, error: '无角色' };
  if (!isLeagueRegisterEligiblePlayer(player)) {
    return { ok: false, error: '仅金丹及以上境界可报名联赛' };
  }

  members.push({ account_id: aid, name: String(player.name || `道友#${aid}`) });
  team.members = members;
  updateTeam(team);

  return { ok: true, team: getTeamPublicView(getTeamById(team.id)) };
}

function leaveRegistrationTeam(accountId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };
  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };

  const seasonId = timeline.registration_season_start;
  const team = findTeamByMember(seasonId, aid);
  if (!team) return { ok: false, error: '你当前不在本期联赛队伍中' };
  if (team.registered) return { ok: false, error: '队伍已报名，不能退出' };

  const members = normalizeMembers(team.members).filter(m => intVal(m.account_id, 0) !== aid);
  if (members.length <= 0) {
    deleteTeam(team.id);
    return { ok: true, disbanded: true };
  }

  team.members = members;
  if (intVal(team.captain_account_id, 0) === aid) {
    team.captain_account_id = intVal(members[0].account_id, 0);
  }
  updateTeam(team);
  return { ok: true, team: getTeamPublicView(getTeamById(team.id)) };
}

async function registerExistingTeam(accountId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };
  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };

  const seasonId = timeline.registration_season_start;
  let team = findTeamByMember(seasonId, aid);
  if (!team) return { ok: false, error: '你当前不在本期联赛队伍中' };

  if (team.mode === 'manual' && intVal(team.captain_account_id, 0) !== aid) {
    return { ok: false, error: '仅队长可发起报名' };
  }
  if (team.registered) return { ok: true, team: getTeamPublicView(team) };

  const ineligible = await findFirstIneligibleTeamMember(team);
  if (ineligible) {
    return { ok: false, error: `队员${ineligible.name}未达金丹境界，无法报名联赛` };
  }

  const frozenResult = await freezeTeamRoster(team);
  if (!frozenResult?.ok) return frozenResult || { ok: false, error: '队伍成员数据异常，无法报名' };
  team = frozenResult.team;

  team.registered = true;
  team.status = 'registered';
  updateTeam(team);

  return { ok: true, team: getTeamPublicView(getTeamById(team.id)) };
}

async function registerSolo(accountId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };

  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };
  const seasonId = timeline.registration_season_start;

  if (findTeamByMember(seasonId, aid)) {
    return { ok: false, error: '你已在本期联赛队伍中' };
  }

  const player = (typeof dbApi.getPlayerByAccountIdAsync === 'function')
    ? await dbApi.getPlayerByAccountIdAsync(aid)
    : dbApi.getPlayerByAccountId(aid);
  if (!player) return { ok: false, error: '无角色' };
  if (!isLeagueRegisterEligiblePlayer(player)) {
    return { ok: false, error: '仅金丹及以上境界可报名联赛' };
  }

  const team = createTeam({
    seasonId,
    captainAccountId: aid,
    mode: 'system',
    members: [{ account_id: aid, name: String(player.name || `道友#${aid}`) }],
    registered: false,
    status: 'forming',
    name: '系统配队',
    teamCode: generateUniqueTeamCode(seasonId, 'SYS')
  });

  const reg = await registerExistingTeam(aid, now);
  if (!reg.ok) return reg;
  return reg;
}

function cancelSoloRegistration(accountId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };

  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };
  const seasonId = timeline.registration_season_start;

  const team = findTeamByMember(seasonId, aid);
  if (!team) {
    return { ok: false, error: '当前未进行单人匹配' };
  }
  if (String(team.mode || '') !== 'system') {
    return { ok: false, error: '当前队伍不是单人匹配队伍' };
  }

  const members = normalizeMembers(team.members || []);
  if (members.length !== 1 || intVal(members[0]?.account_id, 0) !== aid) {
    return { ok: false, error: '当前单人匹配队伍不可取消' };
  }

  deleteTeam(team.id);
  return { ok: true, canceled: true };
}

function cancelTeamRegistration(accountId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };

  const timeline = getTimeline(now);
  if (!timeline.registration_open) return { ok: false, error: '当前不在联赛报名期（周五至周日）' };
  const seasonId = timeline.registration_season_start;

  const team = findTeamByMember(seasonId, aid);
  if (!team) {
    return { ok: false, error: '当前未找到可取消报名的队伍' };
  }
  if (String(team.mode || '') === 'system') {
    return { ok: false, error: '系统配队请使用取消单人匹配' };
  }
  if (!team.registered) {
    return { ok: false, error: '当前队伍尚未报名' };
  }
  if (intVal(team.captain_account_id, 0) !== aid) {
    return { ok: false, error: '仅队长可取消队伍报名' };
  }

  team.registered = false;
  team.status = 'forming';
  updateTeam(team);
  return { ok: true, team: getTeamPublicView(getTeamById(team.id)) };
}

function setTeamSkillConfig(accountId, memberAccountId, equippedSkills, keySkillId, now = nowSec()) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };
  const timeline = getTimeline(now);
  const currentSeasonId = timeline.current_season_start;

  let team = findTeamByMember(currentSeasonId, aid);
  let useFrozenMember = false;

  if (team && (team.status === 'active' || team.status === 'finished')) {
    const season = getSeason(currentSeasonId);
    if (season && season.initialized && season.status === 'running') {
      useFrozenMember = true;
    } else {
      team = null;
    }
  } else {
    team = null;
  }

  if (!team) {
    const registrationSeasonId = timeline.registration_season_start;
    const regTeam = findTeamByMember(registrationSeasonId, aid);
    if (!regTeam || (regTeam.status !== 'forming' && regTeam.status !== 'registered' && regTeam.status !== 'active')) {
      return { ok: false, error: '当前未找到可调整技能组的联赛队伍' };
    }
    team = regTeam;
    useFrozenMember = false;
  }

  const requestedAid = intVal(memberAccountId, 0);
  if (requestedAid > 0 && requestedAid !== aid) {
    console.warn('[league] setTeamSkillConfig mismatched member aid=%d requested=%d, fallback to self', aid, requestedAid);
  }
  const targetAid = aid;

  const members = normalizeMembers(team.members || []);
  const inTeam = members.some(m => intVal(m.account_id, 0) === targetAid);
  if (!inTeam) return { ok: false, error: '目标成员不在队伍中' };

  let learned;
  if (useFrozenMember) {
    const member = (Array.isArray(team.frozen) ? team.frozen : []).find(m => intVal(m?.account_id, 0) === targetAid);
    if (!member) return { ok: false, error: '目标成员不在队伍中' };
    learned = new Set(Object.keys(member.frozen_player?.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
  } else {
    const livePlayer = dbApi.getPlayerByAccountId(targetAid);
    if (!livePlayer) return { ok: false, error: '目标成员角色不存在' };
    learned = new Set(Object.keys(livePlayer.skill_levels || {}).map(k => intVal(k, 0)).filter(x => x > 0));
  }

  const cfg = normalizeSkillConfig({ equipped_skills: equippedSkills, key_skill_id: keySkillId }, learned);
  if (cfg.equipped_skills.length <= 0) {
    return { ok: false, error: '技能组不能为空（需使用已学习技能）' };
  }

  team.skill_map = team.skill_map && typeof team.skill_map === 'object' ? team.skill_map : {};
  team.skill_map[String(targetAid)] = cfg;
  updateTeam(team);

  return {
    ok: true,
    team: getTeamPublicView(getTeamById(team.id)),
    updated_member: targetAid,
    skill_config: cfg
  };
}

function _rebuildLeaderboardCache() {
  const rows = dbApi.listLeagueLeaderboardRows(500);
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    account_id: intVal(r?.account_id, 0),
    name: String(r?.name || `道友#${intVal(r?.account_id, 0)}`),
    level: Math.max(1, intVal(r?.level, 1)),
    league_points: Math.max(0, intVal(r?.league_points, DEFAULT_LEAGUE_CURRENCY)),
    league_rating: Math.max(0, intVal(r?.league_rating, DEFAULT_LEAGUE_RATING))
  })).filter((x) => x.account_id > 0);
  _leaderboardCache.built_at = nowSec();
  _leaderboardCache.list = list;
}

async function _rebuildLeaderboardCacheAsync() {
  const rows = await dbAsync.listLeagueLeaderboardRows(500);
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    account_id: intVal(r?.account_id, 0),
    name: String(r?.name || `道友#${intVal(r?.account_id, 0)}`),
    level: Math.max(1, intVal(r?.level, 1)),
    league_points: Math.max(0, intVal(r?.league_points, DEFAULT_LEAGUE_CURRENCY)),
    league_rating: Math.max(0, intVal(r?.league_rating, DEFAULT_LEAGUE_RATING))
  })).filter((x) => x.account_id > 0);
  _leaderboardCache.built_at = nowSec();
  _leaderboardCache.list = list;
}

function listLeaderboard(limit = 100) {
  const now = nowSec();
  const cacheAge = now - intVal(_leaderboardCache.built_at, 0);
  if (!Array.isArray(_leaderboardCache.list) || cacheAge >= LEAGUE_LEADERBOARD_CACHE_TTL_SEC) {
    _rebuildLeaderboardCache();
  }
  const lim = clamp(intVal(limit, 100), 1, 500);
  return _leaderboardCache.list.slice(0, lim);
}

async function listLeaderboardAsync(limit = 100) {
  const now = nowSec();
  const cacheAge = now - intVal(_leaderboardCache.built_at, 0);
  if (!Array.isArray(_leaderboardCache.list) || cacheAge >= LEAGUE_LEADERBOARD_CACHE_TTL_SEC) {
    if (!_leaderboardCacheInFlight) {
      _leaderboardCacheInFlight = _rebuildLeaderboardCacheAsync().finally(() => {
        _leaderboardCacheInFlight = null;
      });
    }
    await _leaderboardCacheInFlight;
  }
  const lim = clamp(intVal(limit, 100), 1, 500);
  return _leaderboardCache.list.slice(0, lim);
}

function resolveLeagueWeekStart(weekStart = 0) {
  const ws = intVal(weekStart, 0);
  if (ws > 0) return mondayStartUtc8(ws);
  return getTimeline(nowSec()).current_season_start;
}

function listWeekTeamRank(weekStart = 0, limit = 100, accountId = 0) {
  const sid = resolveLeagueWeekStart(weekStart);
  const season = ensureSeason(sid);

  const lim = clamp(intVal(limit, 100), 1, 500);
  const teams = listSeasonTeams(sid)
    .filter(t => {
      if (!t) return false;
      const status = String(t.status || '');
      // 赛季初始化后，只展示真实参赛队（active/finished），避免把拆散/无效队伍显示在榜单里。
      if (season && season.initialized) {
        return status === 'active' || status === 'finished';
      }
      return t.registered || status === 'active' || status === 'finished';
    })
    .sort((a, b) => {
      if (b.season_points !== a.season_points) return b.season_points - a.season_points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.draws !== a.draws) return b.draws - a.draws;
      if (b.rating_seed !== a.rating_seed) return b.rating_seed - a.rating_seed;
      return a.id - b.id;
    });

  const myTeam = intVal(accountId, 0) > 0 ? findTeamByMember(sid, accountId) : null;
  const list = teams.slice(0, lim).map((t, idx) => ({
    rank: idx + 1,
    id: intVal(t.id, 0),
    week_start: sid,
    season_id: sid,
    team_code: String(t.team_code || ''),
    name: String(t.name || `战队#${intVal(t.id, 0)}`),
    captain_account_id: intVal(t.captain_account_id, 0),
    status: String(t.status || ''),
    season_points: intVal(t.season_points, 0),
    wins: intVal(t.wins, 0),
    draws: intVal(t.draws, 0),
    losses: intVal(t.losses, 0),
    rating_seed: intVal(t.rating_seed, DEFAULT_LEAGUE_RATING),
    members_count: Array.isArray(t.members) ? t.members.length : 0
  }));

  return {
    week_start: sid,
    season_id: sid,
    my_team_id: intVal(myTeam?.id, 0),
    total: teams.length,
    list
  };
}

async function listWeekTeamRankAsync(weekStart = 0, limit = 100, accountId = 0) {
  const sid = resolveLeagueWeekStart(weekStart);
  const season = ensureSeason(sid);
  const lim = clamp(intVal(limit, 100), 1, 500);
  const initializedOnly = (season && season.initialized) ? 1 : 0;

  const [rows, total] = await Promise.all([
    dbAsync.listLeagueTeamRankRows(sid, lim, initializedOnly),
    dbAsync.countLeagueTeamRankRows(sid, initializedOnly)
  ]);

  const myTeam = intVal(accountId, 0) > 0 ? await findTeamByMemberAsync(sid, accountId) : null;
  const list = (Array.isArray(rows) ? rows : []).map((t, idx) => {
    return {
      rank: idx + 1,
      id: intVal(t?.id, 0),
      week_start: sid,
      season_id: sid,
      team_code: String(t?.team_code || ''),
      name: String(t?.name || `战队#${intVal(t?.id, 0)}`),
      captain_account_id: intVal(t?.captain_account_id, 0),
      status: String(t?.status || ''),
      season_points: intVal(t?.season_points, 0),
      wins: intVal(t?.wins, 0),
      draws: intVal(t?.draws, 0),
      losses: intVal(t?.losses, 0),
      rating_seed: intVal(t?.rating_seed, DEFAULT_LEAGUE_RATING),
      members_count: Math.max(0, intVal(t?.members_count, 0))
    };
  });

  return {
    week_start: sid,
    season_id: sid,
    my_team_id: intVal(myTeam?.id, 0),
    total: Math.max(0, intVal(total, 0)),
    list
  };
}

function listSeasonTeamRank(seasonId = 0, limit = 100, accountId = 0) {
  return listWeekTeamRank(seasonId, limit, accountId);
}

async function listSeasonTeamRankAsync(seasonId = 0, limit = 100, accountId = 0) {
  return listWeekTeamRankAsync(seasonId, limit, accountId);
}

function listShopGoods(accountId = 0) {
  const aid = intVal(accountId, 0);
  let myLeaguePoints = 0;
  let myLeagueRating = DEFAULT_LEAGUE_RATING;
  let purchaseState = {};

  if (aid > 0) {
    const player = dbApi.getPlayerByAccountId(aid);
    if (player) {
      const leagueState = ensurePlayerLeagueState(player);
      purchaseState = ensureLeagueShopPurchaseState(player);
      if (leagueState.dirty) dbApi.savePlayer(aid, 1, player);
      myLeaguePoints = leagueState.points;
      myLeagueRating = leagueState.rating;
    }
  }

  const goods = LEAGUE_SHOP_ITEMS.map(g => {
    const limit = Math.max(0, intVal(g.limit, 0));
    const maxBatch = Math.max(1, intVal(g.max_batch, 200));
    return {
      id: String(g.id || ''),
      name: String(g.name || ''),
      cost: Math.max(0, intVal(g.cost, 0)),
      currency: String(g.currency || 'league_points'),
      quality: Math.max(1, intVal(g.quality, 1)),
      min_count: Math.max(1, intVal(g.min_count, 1)),
      max_count: Math.max(1, intVal(g.max_count, 1)),
      desc: String(g.desc || ''),
      tooltip: String(g.tooltip || ''),
      limited: limit > 0,
      limit,
      bought: Math.max(0, intVal(purchaseState[String(g.id || '')], 0)),
      remaining: limit > 0
        ? Math.max(0, limit - Math.max(0, intVal(purchaseState[String(g.id || '')], 0)))
        : -1,
      batch_allowed: limit <= 0,
      max_batch: maxBatch
    };
  });

  return {
    ok: true,
    my_league_points: myLeaguePoints,
    my_league_rating: myLeagueRating,
    goods
  };
}

async function listShopGoodsAsync(accountId = 0) {
  const aid = intVal(accountId, 0);
  let myLeaguePoints = 0;
  let myLeagueRating = DEFAULT_LEAGUE_RATING;
  let purchaseState = {};

  if (aid > 0) {
    const player = await dbAsync.getPlayerByAccountId(aid);
    if (player) {
      const leagueState = ensurePlayerLeagueState(player);
      purchaseState = ensureLeagueShopPurchaseState(player);
      if (leagueState.dirty) await dbAsync.savePlayer(aid, 1, player);
      myLeaguePoints = leagueState.points;
      myLeagueRating = leagueState.rating;
    }
  }

  const goods = LEAGUE_SHOP_ITEMS.map(g => {
    const limit = Math.max(0, intVal(g.limit, 0));
    const maxBatch = Math.max(1, intVal(g.max_batch, 200));
    return {
      id: String(g.id || ''),
      name: String(g.name || ''),
      cost: Math.max(0, intVal(g.cost, 0)),
      currency: String(g.currency || 'league_points'),
      quality: Math.max(1, intVal(g.quality, 1)),
      min_count: Math.max(1, intVal(g.min_count, 1)),
      max_count: Math.max(1, intVal(g.max_count, 1)),
      desc: String(g.desc || ''),
      tooltip: String(g.tooltip || ''),
      limited: limit > 0,
      limit,
      bought: Math.max(0, intVal(purchaseState[String(g.id || '')], 0)),
      remaining: limit > 0
        ? Math.max(0, limit - Math.max(0, intVal(purchaseState[String(g.id || '')], 0)))
        : -1,
      batch_allowed: limit <= 0,
      max_batch: maxBatch
    };
  });

  return {
    ok: true,
    my_league_points: myLeaguePoints,
    my_league_rating: myLeagueRating,
    goods
  };
}

function buyShopItem(accountId, itemId, quantity = 1) {
  const aid = intVal(accountId, 0);
  if (aid <= 0) return { ok: false, error: '无效账号' };

  const shopId = String(itemId || '').trim();
  const cfg = LEAGUE_SHOP_ITEMS.find(g => String(g.id || '') === shopId);
  if (!cfg) return { ok: false, error: '无效商品' };

  const limit = Math.max(0, intVal(cfg.limit, 0));
  const maxBatch = Math.max(1, intVal(cfg.max_batch, 200));
  const reqQty = Math.max(1, intVal(quantity, 1));
  const qty = Math.min(reqQty, maxBatch);

  if (limit > 0 && qty > 1) {
    return { ok: false, error: '该商品为限购商品，不支持批量购买' };
  }

  const player = dbApi.getPlayerByAccountId(aid);
  if (!player) return { ok: false, error: '无角色' };

  const leagueState = ensurePlayerLeagueState(player);
  const purchaseState = ensureLeagueShopPurchaseState(player);
  const boughtCount = Math.max(0, intVal(purchaseState[shopId], 0));
  if (limit > 0 && boughtCount >= limit) {
    return { ok: false, error: '该商品已达到购买上限' };
  }

  if (limit > 0 && (boughtCount + qty > limit)) {
    return { ok: false, error: `超过限购数量，剩余可购买${Math.max(0, limit - boughtCount)}件` };
  }

  const unitCost = Math.max(0, intVal(cfg.cost, 0));
  const totalCost = unitCost * qty;
  if (leagueState.points < totalCost) {
    return { ok: false, error: `联赛积分不足，需要${totalCost}` };
  }

  const itemIdNum = intVal(cfg.item_id, 0);
  const itemTpl = getItemById(itemIdNum);
  if (!itemTpl || !itemTpl.id) {
    return { ok: false, error: '商店道具配置异常，请联系管理员' };
  }

  const itemType = String(itemTpl.type || '');
  if (itemType !== 'consumable' && itemType !== 'book') {
    return { ok: false, error: '商店道具类型异常，无法购买' };
  }

  const invClone = structuredClone(ops.ensureInventoryStructure(player.inventory || []));
  if (!ops.putItemInInventory(invClone, itemTpl, qty)) {
    return { ok: false, error: '背包空间不足，请先整理背包后再购买' };
  }

  player.inventory = invClone;
  player.league_rating = leagueState.rating;
  player.league_points = Math.max(0, intVal(leagueState.points, 0) - totalCost);
  if (limit > 0) {
    purchaseState[shopId] = boughtCount + qty;
  }
  dbApi.savePlayer(aid, 1, player);

  const drops = [{ id: intVal(itemTpl.id, 0), name: String(itemTpl.name || '道具'), count: qty }];
  return {
    ok: true,
    item_id: shopId,
    quantity: qty,
    spent: totalCost,
    my_league_points: intVal(player.league_points, 0),
    drops
  };
}

function listMyMatches(accountId, seasonId = 0, limit = 50) {
  const aid = intVal(accountId, 0);
  const sid = resolveLeagueWeekStart(seasonId);
  if (aid <= 0) return { season_id: sid, scope: 'self_team_only', team: null, list: [] };
  const team = findTeamByMember(sid, aid);
  if (!team) return { season_id: sid, scope: 'self_team_only', team: null, list: [] };
  const myTeamId = intVal(team.id, 0);

  const teamNameById = new Map();
  for (const t of listSeasonTeams(sid)) {
    const tid = intVal(t?.id, 0);
    if (tid <= 0) continue;
    const tname = String(t?.name || `战队#${tid}`);
    teamNameById.set(tid, tname);
  }

  const rows = db.prepare(`
    SELECT * FROM league_matches
    WHERE (team_a_id=? OR team_b_id=?) AND season_id=?
    ORDER BY round_no DESC, match_no DESC
    LIMIT ?
  `).all(myTeamId, myTeamId, sid, clamp(intVal(limit, 50), 1, 200));

  const list = rows.map(r => {
    const teamAId = intVal(r.team_a_id, 0);
    const teamBId = intVal(r.team_b_id, 0);
    const result = String(r.result || 'pending');

    const teamAName = teamNameById.get(teamAId) || (teamAId > 0 ? `战队#${teamAId}` : '-');
    const teamBName = teamNameById.get(teamBId) || (teamBId > 0 ? `战队#${teamBId}` : '-');

    let opponentTeamId = 0;
    let opponentTeamName = '-';
    if (teamAId === myTeamId) {
      opponentTeamId = teamBId;
      opponentTeamName = teamBName;
    } else if (teamBId === myTeamId) {
      opponentTeamId = teamAId;
      opponentTeamName = teamAName;
    }
    if (result === 'bye') {
      opponentTeamId = 0;
      opponentTeamName = '轮空';
    }

    return {
      id: intVal(r.id, 0),
      season_id: intVal(r.season_id, 0),
      week_start: intVal(r.season_id, 0),
      round_no: intVal(r.round_no, 0),
      match_no: intVal(r.match_no, 0),
      team_a_id: teamAId,
      team_a_name: teamAName,
      team_b_id: teamBId,
      team_b_name: teamBName,
      my_team_id: myTeamId,
      opponent_team_id: opponentTeamId,
      opponent_team_name: opponentTeamName,
      result,
      winner_team_id: intVal(r.winner_team_id, 0),
      points_a: intVal(r.points_a, 0),
      points_b: intVal(r.points_b, 0),
      summary: parseJsonSafe(r.summary_json || '{}', {}),
      logs: parseJsonSafe(r.battle_log_json || '[]', []),
      created_at: intVal(r.created_at, 0),
      settled_at: intVal(r.settled_at, 0)
    };
  });

  return {
    week_start: sid,
    season_id: sid,
    scope: 'self_team_only',
    my_team_id: myTeamId,
    team: getTeamPublicView(team),
    list
  };
}

async function listMyMatchesAsync(accountId, seasonId = 0, limit = 50) {
  const aid = intVal(accountId, 0);
  const sid = resolveLeagueWeekStart(seasonId);
  if (aid <= 0) return { season_id: sid, scope: 'self_team_only', team: null, list: [] };
  const team = await findTeamByMemberAsync(sid, aid);
  if (!team) return { season_id: sid, scope: 'self_team_only', team: null, list: [] };
  const myTeamId = intVal(team.id, 0);

  const rows = await dbAsync.listLeagueMatchesByTeam(sid, myTeamId, clamp(intVal(limit, 50), 1, 200));
  const teamIdSet = new Set();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const teamAId = intVal(r?.team_a_id, 0);
    const teamBId = intVal(r?.team_b_id, 0);
    if (teamAId > 0) teamIdSet.add(teamAId);
    if (teamBId > 0) teamIdSet.add(teamBId);
  }

  const teamNameRows = await dbAsync.listLeagueTeamNamesByIds(sid, [...teamIdSet]);
  const teamNameById = new Map();
  for (const row of (Array.isArray(teamNameRows) ? teamNameRows : [])) {
    const tid = intVal(row?.id, 0);
    if (tid <= 0) continue;
    teamNameById.set(tid, String(row?.name || `战队#${tid}`));
  }

  const list = (Array.isArray(rows) ? rows : []).map(r => {
    const teamAId = intVal(r.team_a_id, 0);
    const teamBId = intVal(r.team_b_id, 0);
    const result = String(r.result || 'pending');

    const teamAName = teamNameById.get(teamAId) || (teamAId > 0 ? `战队#${teamAId}` : '-');
    const teamBName = teamNameById.get(teamBId) || (teamBId > 0 ? `战队#${teamBId}` : '-');

    let opponentTeamId = 0;
    let opponentTeamName = '-';
    if (teamAId === myTeamId) {
      opponentTeamId = teamBId;
      opponentTeamName = teamBName;
    } else if (teamBId === myTeamId) {
      opponentTeamId = teamAId;
      opponentTeamName = teamAName;
    }
    if (result === 'bye') {
      opponentTeamId = 0;
      opponentTeamName = '轮空';
    }

    return {
      id: intVal(r.id, 0),
      season_id: intVal(r.season_id, 0),
      week_start: intVal(r.season_id, 0),
      round_no: intVal(r.round_no, 0),
      match_no: intVal(r.match_no, 0),
      team_a_id: teamAId,
      team_a_name: teamAName,
      team_b_id: teamBId,
      team_b_name: teamBName,
      my_team_id: myTeamId,
      opponent_team_id: opponentTeamId,
      opponent_team_name: opponentTeamName,
      result,
      winner_team_id: intVal(r.winner_team_id, 0),
      points_a: intVal(r.points_a, 0),
      points_b: intVal(r.points_b, 0),
      summary: parseJsonSafe(r.summary_json || '{}', {}),
      logs: parseJsonSafe(r.battle_log_json || '[]', []),
      created_at: intVal(r.created_at, 0),
      settled_at: intVal(r.settled_at, 0)
    };
  });

  return {
    week_start: sid,
    season_id: sid,
    scope: 'self_team_only',
    my_team_id: myTeamId,
    team: getTeamPublicView(team),
    list
  };
}

function _resolveAuditSeasonId(seasonId = 0) {
  const sid = intVal(seasonId, 0);
  if (sid > 0) return sid;
  return getTimeline(nowSec()).current_season_start;
}

function _safeLeaguePointsFromPlayer(player) {
  const n = Number(player?.league_points);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function _accumulateExpectedByAccount(rows, teamById, includeAccountIds = null) {
  const byAccount = new Map();

  function pushPoints(teamId, points, matchRow) {
    const tid = intVal(teamId, 0);
    const add = Math.max(0, intVal(points, 0));
    if (tid <= 0 || add <= 0) return;
    const team = teamById.get(tid);
    if (!team) return;
    const memberIds = collectTeamMemberAccountIds(team);
    for (const aidRaw of memberIds) {
      const aid = intVal(aidRaw, 0);
      if (aid <= 0) continue;
      if (includeAccountIds && includeAccountIds.size > 0 && !includeAccountIds.has(aid)) continue;
      let it = byAccount.get(aid);
      if (!it) {
        it = {
          account_id: aid,
          expected_points: 0,
          matches_count: 0,
          team_ids: new Set(),
          sample_matches: []
        };
        byAccount.set(aid, it);
      }
      it.expected_points += add;
      it.matches_count += 1;
      it.team_ids.add(tid);
      if (it.sample_matches.length < 12) {
        it.sample_matches.push({
          match_id: intVal(matchRow?.id, 0),
          round_no: intVal(matchRow?.round_no, 0),
          match_no: intVal(matchRow?.match_no, 0),
          team_id: tid,
          points: add,
          result: String(matchRow?.result || '')
        });
      }
    }
  }

  for (const r of (Array.isArray(rows) ? rows : [])) {
    pushPoints(r?.team_a_id, r?.points_a, r);
    pushPoints(r?.team_b_id, r?.points_b, r);
  }
  return byAccount;
}

function auditLeaguePointAwards(options = {}) {
  const sid = _resolveAuditSeasonId(options?.seasonId);
  const roundNo = Math.max(0, intVal(options?.roundNo, 0));
  const limit = clamp(intVal(options?.limit, 500), 1, 5000);
  const includeAccountIds = options?.includeAccountIds instanceof Set ? options.includeAccountIds : null;

  const rowsAll = db.prepare(`
    SELECT id, season_id, round_no, match_no, team_a_id, team_b_id, result, points_a, points_b, settled_at
    FROM league_matches
    WHERE season_id=?
    ORDER BY round_no ASC, match_no ASC
  `).all(sid);

  const rows = roundNo > 0
    ? rowsAll.filter(r => intVal(r?.round_no, 0) === roundNo)
    : rowsAll;
  const rowsBeforeRound = roundNo > 0
    ? rowsAll.filter(r => intVal(r?.round_no, 0) > 0 && intVal(r?.round_no, 0) < roundNo)
    : [];

  const teams = listSeasonTeams(sid);
  const teamById = new Map();
  for (const t of teams) {
    const tid = intVal(t?.id, 0);
    if (tid > 0) teamById.set(tid, t);
  }

  const byAccountSelected = _accumulateExpectedByAccount(rows, teamById, includeAccountIds);
  const byAccountAll = _accumulateExpectedByAccount(rowsAll, teamById, includeAccountIds);
  const byAccountBeforeRound = _accumulateExpectedByAccount(rowsBeforeRound, teamById, includeAccountIds);
  let settledMatches = 0;

  for (const r of rows) {
    const settledAt = intVal(r?.settled_at, 0);
    const hasPoints = intVal(r?.points_a, 0) > 0 || intVal(r?.points_b, 0) > 0;
    if (settledAt > 0 || hasPoints) settledMatches += 1;
  }

  const list = [...byAccountSelected.values()].map((x) => {
    const aid = intVal(x.account_id, 0);
    const expectedSelected = Math.max(0, intVal(x.expected_points, 0));
    const expectedAll = Math.max(0, intVal(byAccountAll.get(aid)?.expected_points, expectedSelected));
    const expectedBeforeRound = Math.max(0, intVal(byAccountBeforeRound.get(aid)?.expected_points, 0));
    const player = dbApi.getPlayerByAccountId(intVal(x.account_id, 0));
    const walletPoints = _safeLeaguePointsFromPlayer(player);
    const estimatedAvailableForSelectedRound = roundNo > 0
      ? Math.max(0, walletPoints - expectedBeforeRound)
      : walletPoints;
    const estimatedMissingPoints = Math.max(0, expectedSelected - estimatedAvailableForSelectedRound);
    return {
      account_id: aid,
      expected_points_selected: expectedSelected,
      expected_points_total: expectedAll,
      expected_points_before_round: expectedBeforeRound,
      expected_points: expectedSelected,
      matches_count: Math.max(0, intVal(x.matches_count, 0)),
      team_ids: [...x.team_ids].sort((a, b) => a - b),
      has_player: !!player,
      current_wallet_points: walletPoints,
      current_points: walletPoints,
      estimated_available_for_selected_round: estimatedAvailableForSelectedRound,
      estimated_missing_points: estimatedMissingPoints,
      suspected_missing_points: estimatedMissingPoints,
      sample_matches: x.sample_matches
    };
  }).sort((a, b) => {
    if (b.suspected_missing_points !== a.suspected_missing_points) {
      return b.suspected_missing_points - a.suspected_missing_points;
    }
    if (b.expected_points !== a.expected_points) return b.expected_points - a.expected_points;
    return a.account_id - b.account_id;
  });

  const summary = {
    season_id: sid,
    round_no: roundNo,
    current_points_semantics: 'wallet_balance',
    missing_estimation_note: '缺口为按钱包余额估算，可能受商店消费影响；不是严格发放流水',
    matches_total: rows.length,
    matches_settled_or_scored: settledMatches,
    accounts_involved: list.length,
    expected_points_total: list.reduce((s, x) => s + Math.max(0, intVal(x.expected_points_selected, 0)), 0),
    expected_points_all_rounds_total: list.reduce((s, x) => s + Math.max(0, intVal(x.expected_points_total, 0)), 0),
    estimated_missing_points_total: list.reduce((s, x) => s + Math.max(0, intVal(x.estimated_missing_points, 0)), 0),
    suspected_missing_points_total: list.reduce((s, x) => s + Math.max(0, intVal(x.estimated_missing_points, 0)), 0),
    estimated_missing_accounts: list.filter(x => intVal(x.estimated_missing_points, 0) > 0).length,
    suspected_missing_accounts: list.filter(x => intVal(x.estimated_missing_points, 0) > 0).length
  };

  return {
    ok: true,
    summary,
    list: list.slice(0, limit)
  };
}

function compensateLeaguePointsManual(entries = [], options = {}) {
  const dryRun = options?.dryRun !== false;
  const reason = String(options?.reason || '联赛积分补发').trim() || '联赛积分补发';
  const merged = new Map();
  for (const row of (Array.isArray(entries) ? entries : [])) {
    const aid = intVal(row?.account_id, 0);
    const pts = Math.max(0, intVal(row?.points, 0));
    if (aid <= 0 || pts <= 0) continue;
    merged.set(aid, Math.max(0, intVal(merged.get(aid), 0) + pts));
  }

  const list = [...merged.entries()].map(([accountId, points]) => ({
    account_id: intVal(accountId, 0),
    points: Math.max(0, intVal(points, 0))
  }));

  const result = {
    ok: true,
    dry_run: dryRun,
    reason,
    total_accounts: list.length,
    total_points: list.reduce((s, x) => s + Math.max(0, intVal(x.points, 0)), 0),
    applied_accounts: 0,
    failed_accounts: 0,
    failed_list: [],
    list
  };

  if (dryRun) return result;

  for (const one of list) {
    const ok = awardLeaguePoints(intVal(one.account_id, 0), intVal(one.points, 0), reason, '', { immediate: true });
    if (ok) {
      result.applied_accounts += 1;
    } else {
      result.failed_accounts += 1;
      result.failed_list.push(intVal(one.account_id, 0));
    }
  }
  return result;
}

function _normalizeRoundNos(rawRoundNos = []) {
  const set = new Set();
  for (const one of (Array.isArray(rawRoundNos) ? rawRoundNos : [])) {
    const rn = intVal(one, 0);
    if (rn > 0) set.add(rn);
  }
  return [...set].sort((a, b) => a - b);
}

function _loadRoundCompLedgerMap(seasonId, roundNos = [], includeAccountIds = null) {
  if (isMysqlDriver) return new Map();
  const sid = intVal(seasonId, 0);
  if (sid <= 0) return new Map();

  const rounds = _normalizeRoundNos(roundNos);
  let rows = [];
  if (rounds.length > 0) {
    const placeholders = rounds.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT season_id, round_no, account_id, points
      FROM league_point_round_comp
      WHERE season_id=? AND round_no IN (${placeholders})
    `).all(sid, ...rounds);
  } else {
    rows = db.prepare(`
      SELECT season_id, round_no, account_id, points
      FROM league_point_round_comp
      WHERE season_id=?
    `).all(sid);
  }

  const out = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const rn = intVal(r?.round_no, 0);
    const aid = intVal(r?.account_id, 0);
    const pts = Math.max(0, intVal(r?.points, 0));
    if (rn <= 0 || aid <= 0 || pts <= 0) continue;
    if (includeAccountIds && includeAccountIds.size > 0 && !includeAccountIds.has(aid)) continue;
    const key = `${rn}:${aid}`;
    out.set(key, Math.max(0, intVal(out.get(key), 0) + pts));
  }
  return out;
}

function _appendRoundCompLedger(seasonId, roundNo, accountId, points, reason = '') {
  if (isMysqlDriver) return false;
  const sid = intVal(seasonId, 0);
  const rn = intVal(roundNo, 0);
  const aid = intVal(accountId, 0);
  const pts = Math.max(0, intVal(points, 0));
  if (sid <= 0 || rn <= 0 || aid <= 0 || pts <= 0) return false;
  db.prepare(`
    INSERT INTO league_point_round_comp
      (season_id, round_no, account_id, points, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(season_id, round_no, account_id)
    DO UPDATE SET
      points = points + excluded.points,
      reason = excluded.reason,
      created_at = excluded.created_at
  `).run(sid, rn, aid, pts, String(reason || ''), nowSec());
  return true;
}

function compensateLeaguePointsByRounds(options = {}) {
  const sid = _resolveAuditSeasonId(options?.seasonId);
  const roundNos = _normalizeRoundNos(options?.roundNos);
  const includeAccountIds = options?.includeAccountIds instanceof Set ? options.includeAccountIds : null;
  const dryRun = options?.dryRun !== false;
  const reason = String(options?.reason || '联赛按轮次补发').trim() || '联赛按轮次补发';
  const strategyRaw = String(options?.strategy || LEAGUE_POINTS_COMP_STRATEGY || 'wallet_estimate').toLowerCase();
  const strategy = strategyRaw === 'full_round' ? 'full_round' : 'wallet_estimate';
  const maxPerAccount = clamp(intVal(options?.maxPerAccount, 2000), 1, 200000);

  if (roundNos.length <= 0) {
    return { ok: false, error: '请提供 round_nos（至少一个正整数）' };
  }

  const rowsAll = db.prepare(`
    SELECT id, season_id, round_no, match_no, team_a_id, team_b_id, result, points_a, points_b, settled_at
    FROM league_matches
    WHERE season_id=?
    ORDER BY round_no ASC, match_no ASC
  `).all(sid);
  if (!Array.isArray(rowsAll) || rowsAll.length <= 0) {
    return { ok: false, error: '该赛季暂无比赛数据' };
  }

  const teams = listSeasonTeams(sid);
  const teamById = new Map();
  for (const t of teams) {
    const tid = intVal(t?.id, 0);
    if (tid > 0) teamById.set(tid, t);
  }

  const roundCompLedger = _loadRoundCompLedgerMap(sid, roundNos, includeAccountIds);
  const walletCache = new Map();
  const byAccount = new Map();
  const roundSummary = [];

  for (const rn of roundNos) {
    const rowsThisRound = rowsAll.filter(r => intVal(r?.round_no, 0) === rn);
    if (rowsThisRound.length <= 0) {
      roundSummary.push({
        round_no: rn,
        matches: 0,
        accounts_involved: 0,
        expected_points_total: 0,
        planned_points_total: 0,
        skipped_by_ledger_total: 0
      });
      continue;
    }
    const rowsBeforeRound = rowsAll.filter(r => intVal(r?.round_no, 0) > 0 && intVal(r?.round_no, 0) < rn);
    const byAccountThisRound = _accumulateExpectedByAccount(rowsThisRound, teamById, includeAccountIds);
    const byAccountBeforeRound = strategy === 'wallet_estimate'
      ? _accumulateExpectedByAccount(rowsBeforeRound, teamById, includeAccountIds)
      : new Map();

    let expectedPointsTotal = 0;
    let plannedPointsTotal = 0;
    let skippedByLedgerTotal = 0;

    for (const row of byAccountThisRound.values()) {
      const aid = intVal(row?.account_id, 0);
      if (aid <= 0) continue;
      const expectedRound = Math.max(0, intVal(row?.expected_points, 0));
      if (expectedRound <= 0) continue;
      expectedPointsTotal += expectedRound;

      let walletPoints = intVal(walletCache.get(aid), -1);
      if (walletPoints < 0) {
        const player = dbApi.getPlayerByAccountId(aid);
        walletPoints = _safeLeaguePointsFromPlayer(player);
        walletCache.set(aid, walletPoints);
      }

      const expectedBefore = Math.max(0, intVal(byAccountBeforeRound.get(aid)?.expected_points, 0));
      const estimatedAvailableForRound = strategy === 'wallet_estimate'
        ? Math.max(0, walletPoints - expectedBefore)
        : 0;

      const candidatePoints = strategy === 'full_round'
        ? expectedRound
        : Math.max(0, expectedRound - estimatedAvailableForRound);

      const ledgerKey = `${rn}:${aid}`;
      const alreadyCompensatedRoundPoints = Math.max(0, intVal(roundCompLedger.get(ledgerKey), 0));
      const remainingAfterLedger = Math.max(0, candidatePoints - alreadyCompensatedRoundPoints);
      skippedByLedgerTotal += Math.max(0, candidatePoints - remainingAfterLedger);
      if (remainingAfterLedger <= 0) continue;

      const existing = byAccount.get(aid) || {
        account_id: aid,
        points: 0,
        rounds: [],
        wallet_points: walletPoints
      };
      const leftCap = Math.max(0, maxPerAccount - Math.max(0, intVal(existing.points, 0)));
      const plannedPoints = Math.min(remainingAfterLedger, leftCap);
      if (plannedPoints <= 0) {
        byAccount.set(aid, existing);
        continue;
      }

      existing.points += plannedPoints;
      existing.rounds.push({
        round_no: rn,
        points: plannedPoints,
        expected_points: expectedRound,
        expected_points_before_round: expectedBefore,
        estimated_available_for_round: estimatedAvailableForRound,
        candidate_points: candidatePoints,
        already_compensated_round_points: alreadyCompensatedRoundPoints
      });
      byAccount.set(aid, existing);
      plannedPointsTotal += plannedPoints;
    }

    roundSummary.push({
      round_no: rn,
      matches: rowsThisRound.length,
      accounts_involved: byAccountThisRound.size,
      expected_points_total: expectedPointsTotal,
      planned_points_total: plannedPointsTotal,
      skipped_by_ledger_total: skippedByLedgerTotal
    });
  }

  const list = [...byAccount.values()]
    .map((x) => ({
      account_id: intVal(x.account_id, 0),
      points: Math.max(0, intVal(x.points, 0)),
      wallet_points: Math.max(0, intVal(x.wallet_points, 0)),
      rounds: Array.isArray(x.rounds) ? x.rounds.slice().sort((a, b) => intVal(a.round_no, 0) - intVal(b.round_no, 0)) : []
    }))
    .filter(x => x.account_id > 0 && x.points > 0)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.account_id - b.account_id;
    });

  const result = {
    ok: true,
    dry_run: dryRun,
    season_id: sid,
    round_nos: roundNos,
    strategy,
    reason,
    max_per_account: maxPerAccount,
    estimation_note: strategy === 'wallet_estimate'
      ? 'wallet_estimate 为保守估算口径：会受玩家消费影响，不等于严格漏发流水。'
      : 'full_round 为整轮补发口径：不参考钱包余额，请谨慎使用。',
    total_accounts: list.length,
    total_points: list.reduce((s, x) => s + Math.max(0, intVal(x.points, 0)), 0),
    applied_accounts: 0,
    failed_accounts: 0,
    failed_list: [],
    round_summary: roundSummary,
    list
  };

  if (dryRun) return result;

  for (const one of list) {
    const aid = intVal(one.account_id, 0);
    const pts = Math.max(0, intVal(one.points, 0));
    if (aid <= 0 || pts <= 0) continue;
    const ok = awardLeaguePoints(aid, pts, reason, '', { immediate: true });
    if (!ok) {
      result.failed_accounts += 1;
      result.failed_list.push(aid);
      continue;
    }

    result.applied_accounts += 1;
    for (const r of (Array.isArray(one.rounds) ? one.rounds : [])) {
      _appendRoundCompLedger(sid, intVal(r?.round_no, 0), aid, Math.max(0, intVal(r?.points, 0)), reason);
    }
  }

  return result;
}

module.exports = {
  TEAM_SIZE,
  MATCH_POINTS,
  getTimeline,
  getSeasonStatus,
  getSeasonStatusAsync,
  tryRunDueLeagueWork,
  createManualTeam,
  joinTeam,
  leaveRegistrationTeam,
  registerExistingTeam,
  registerSolo,
  cancelSoloRegistration,
  cancelTeamRegistration,
  setTeamSkillConfig,
  listLeaderboard,
  listLeaderboardAsync,
  listWeekTeamRank,
  listWeekTeamRankAsync,
  listSeasonTeamRank,
  listSeasonTeamRankAsync,
  listMyMatches,
  listMyMatchesAsync,
  listShopGoods,
  listShopGoodsAsync,
  buyShopItem,
  auditLeaguePointAwards,
  compensateLeaguePointsManual,
  compensateLeaguePointsByRounds
};
