const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const config = require('../config');
const league = require('../game/leagueSystem');
const settlementLock = require('../game/settlementLock');

const LEAGUE_STATUS_CACHE_MS = Math.max(1000, intVal(process.env.LEAGUE_STATUS_CACHE_MS, 30000));
const LEAGUE_MATCHES_CACHE_MS = Math.max(1000, intVal(process.env.LEAGUE_MATCHES_CACHE_MS, 20000));
const LEAGUE_TEAM_RANK_CACHE_MS = Math.max(1000, intVal(process.env.LEAGUE_TEAM_RANK_CACHE_MS, 20000));
const LEAGUE_LEADERBOARD_CACHE_MS = Math.max(1000, intVal(process.env.LEAGUE_LEADERBOARD_CACHE_MS_ROUTE, 60000));
const LEAGUE_SHOP_CACHE_MS = Math.max(1000, intVal(process.env.LEAGUE_SHOP_CACHE_MS, 15000));
const LEAGUE_ROUTE_CACHE_MAX = Math.max(100, intVal(process.env.LEAGUE_ROUTE_CACHE_MAX, 2000));

const _routeCache = new Map();
const _routeInFlight = new Map();

function _cacheKey(scope, accountId, extra = '') {
  return `${String(scope || '')}|${intVal(accountId, 0)}|${String(extra || '')}`;
}

function _cacheGet(key) {
  const hit = _routeCache.get(String(key));
  if (!hit) return null;
  if (Number(hit.expireAt) <= Date.now()) {
    _routeCache.delete(String(key));
    return null;
  }
  return hit.payload || null;
}

function _cacheSet(key, payload, ttlMs) {
  const ttl = Math.max(0, intVal(ttlMs, 0));
  if (ttl <= 0 || !payload || payload.ok !== true) return;
  _routeCache.set(String(key), {
    expireAt: Date.now() + ttl,
    payload
  });
  if (_routeCache.size <= LEAGUE_ROUTE_CACHE_MAX) return;
  for (const [k, v] of _routeCache.entries()) {
    if (Number(v?.expireAt || 0) <= Date.now()) _routeCache.delete(k);
  }
  while (_routeCache.size > LEAGUE_ROUTE_CACHE_MAX) {
    const first = _routeCache.keys().next().value;
    if (first === undefined) break;
    _routeCache.delete(first);
  }
}

async function _cacheGetOrBuild(key, ttlMs, buildFn) {
  const hit = _cacheGet(key);
  if (hit) return hit;
  const k = String(key || '');
  if (_routeInFlight.has(k)) {
    return _routeInFlight.get(k);
  }
  const p = Promise.resolve()
    .then(() => buildFn())
    .then((payload) => {
      _cacheSet(k, payload, ttlMs);
      return payload;
    })
    .finally(() => {
      _routeInFlight.delete(k);
    });
  _routeInFlight.set(k, p);
  return p;
}

function _cacheClearAll() {
  _routeCache.clear();
  _routeInFlight.clear();
}

function _cacheClearByScope(scopes, accountId = null, includeAccountZero = false) {
  const scopeSet = new Set(Array.isArray(scopes) ? scopes.map(s => String(s || '')) : []);
  if (scopeSet.size <= 0) return;
  const hasAccountFilter = accountId !== null && accountId !== undefined;
  const aidFilter = intVal(accountId, 0);
  for (const key of _routeCache.keys()) {
    const parts = String(key || '').split('|');
    const scope = String(parts[0] || '');
    if (!scopeSet.has(scope)) continue;
    if (hasAccountFilter) {
      const keyAid = intVal(parts[1], 0);
      if (keyAid !== aidFilter && !(includeAccountZero && keyAid === 0)) continue;
    }
    _routeCache.delete(key);
  }
  for (const key of _routeInFlight.keys()) {
    const parts = String(key || '').split('|');
    const scope = String(parts[0] || '');
    if (!scopeSet.has(scope)) continue;
    if (hasAccountFilter) {
      const keyAid = intVal(parts[1], 0);
      if (keyAid !== aidFilter && !(includeAccountZero && keyAid === 0)) continue;
    }
    _routeInFlight.delete(key);
  }
}

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function normalizeToken(v) {
  return String(v || '').trim();
}

function ensureGmToken(req, res) {
  const cfgToken = normalizeToken(config.gmToolToken);
  if (!cfgToken) {
    res.status(503).json({ ok: false, error: 'GM_TOOL_TOKEN 未配置' });
    return false;
  }
  const headerToken = normalizeToken(req.headers['x-gm-token']);
  if (!headerToken || headerToken !== cfgToken) {
    res.status(403).json({ ok: false, error: '无权限' });
    return false;
  }
  return true;
}

router.use(authMiddleware);

router.use(async (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return next();

  let lockLease = null;
  try {
    lockLease = await settlementLock.tryAcquireAsync(req.accountId, { owner: 'route:league:write' });
  } catch (e) {
    console.error('[league/lock] acquire error:', e?.message || e);
    return res.status(500).json({ ok: false, error: '服务繁忙，请稍后重试' });
  }
  if (!lockLease) return res.json({ ok: false, error: '操作进行中，请稍后重试' });

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    settlementLock.releaseAsync(req.accountId, lockLease).catch(() => {});
  };

  res.on('finish', release);
  res.on('close', release);
  next();
});

router.get('/status', async (req, res) => {
  try {
    const ck = _cacheKey('status', req.accountId);
    const payload = await _cacheGetOrBuild(ck, LEAGUE_STATUS_CACHE_MS, async () => {
      const data = await league.getSeasonStatusAsync(Math.floor(Date.now() / 1000), req.accountId);
      return { ok: true, ...data };
    });
    return res.json(payload);
  } catch (e) {
    console.error('[league/status] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '获取联赛状态失败' });
  }
});

router.post('/team/create', async (req, res) => {
  try {
    const name = String(req.body?.name || '');
    const r = await league.createManualTeam(req.accountId, name, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/team/create] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '创建联赛队伍失败' });
  }
});

router.post('/team/join', async (req, res) => {
  try {
    const teamCode = String(req.body?.team_code || '').trim().toUpperCase();
    const r = await league.joinTeam(req.accountId, teamCode, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/team/join] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '加入联赛队伍失败' });
  }
});

router.post('/team/leave', (req, res) => {
  try {
    const r = league.leaveRegistrationTeam(req.accountId, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/team/leave] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '退出联赛队伍失败' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'team').toLowerCase();
    let r;
    if (mode === 'system' || mode === 'solo' || mode === 'random') {
      r = await league.registerSolo(req.accountId, Math.floor(Date.now() / 1000));
    } else {
      r = await league.registerExistingTeam(req.accountId, Math.floor(Date.now() / 1000));
    }
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/register] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '联赛报名失败' });
  }
});

router.post('/register/cancel_solo', (req, res) => {
  try {
    const r = league.cancelSoloRegistration(req.accountId, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/register/cancel_solo] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '取消单人匹配失败' });
  }
});

router.post('/register/cancel_team', (req, res) => {
  try {
    const r = league.cancelTeamRegistration(req.accountId, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/register/cancel_team] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '取消队伍报名失败' });
  }
});

router.post('/team/skills', (req, res) => {
  try {
    const memberAccountId = intVal(req.body?.member_account_id, 0);
    const equippedSkills = Array.isArray(req.body?.equipped_skills) ? req.body.equipped_skills : [];
    const keySkillId = intVal(req.body?.key_skill_id, 0);
    const r = league.setTeamSkillConfig(req.accountId, memberAccountId, equippedSkills, keySkillId, Math.floor(Date.now() / 1000));
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['status', 'team_rank', 'matches']);
    return res.json(r);
  } catch (e) {
    console.error('[league/team/skills] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '调整联赛技能组失败' });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const limit = intVal(req.query?.limit, 100);
    const ck = _cacheKey('leaderboard', 0, String(limit));
    const payload = await _cacheGetOrBuild(ck, LEAGUE_LEADERBOARD_CACHE_MS, async () => {
      const list = await league.listLeaderboardAsync(limit);
      return { ok: true, list };
    });
    return res.json(payload);
  } catch (e) {
    console.error('[league/leaderboard] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '获取联赛排行榜失败' });
  }
});

router.get('/team_rank', async (req, res) => {
  try {
    const weekStart = intVal(req.query?.week_start, intVal(req.query?.season_id, 0));
    const limit = intVal(req.query?.limit, 100);
    const ck = _cacheKey('team_rank', req.accountId, `${weekStart}:${limit}`);
    const payload = await _cacheGetOrBuild(ck, LEAGUE_TEAM_RANK_CACHE_MS, async () => {
      const r = await league.listWeekTeamRankAsync(weekStart, limit, req.accountId);
      return { ok: true, ...r };
    });
    return res.json(payload);
  } catch (e) {
    console.error('[league/team_rank] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '获取联赛队伍排行失败' });
  }
});

router.get('/matches', async (req, res) => {
  try {
    const weekStart = intVal(req.query?.week_start, intVal(req.query?.season_id, 0));
    const limit = intVal(req.query?.limit, 50);
    const ck = _cacheKey('matches', req.accountId, `${weekStart}:${limit}`);
    const payload = await _cacheGetOrBuild(ck, LEAGUE_MATCHES_CACHE_MS, async () => {
      const r = await league.listMyMatchesAsync(req.accountId, weekStart, limit);
      return { ok: true, ...r, scope: 'self_team_only' };
    });
    return res.json(payload);
  } catch (e) {
    console.error('[league/matches] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '获取联赛战报失败' });
  }
});

router.get('/shop', async (req, res) => {
  try {
    const ck = _cacheKey('shop', req.accountId);
    const payload = await _cacheGetOrBuild(ck, LEAGUE_SHOP_CACHE_MS, async () => {
      return league.listShopGoodsAsync(req.accountId);
    });
    return res.json(payload);
  } catch (e) {
    console.error('[league/shop] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '获取联赛商店失败' });
  }
});

router.post('/shop/buy', (req, res) => {
  try {
    const itemId = String(req.body?.item_id || '').trim();
    const quantity = intVal(req.body?.quantity, 1);
    const r = league.buyShopItem(req.accountId, itemId, quantity);
    if (!r.ok) return res.json(r);
    _cacheClearByScope(['shop', 'status'], req.accountId, false);
    return res.json(r);
  } catch (e) {
    console.error('[league/shop/buy] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '购买联赛商店商品失败' });
  }
});

router.post('/run_due', (req, res) => {
  try {
    if (!ensureGmToken(req, res)) return;
    const r = league.tryRunDueLeagueWork(Math.floor(Date.now() / 1000));
    _cacheClearAll();
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[league/run_due] error:', e?.message || e, e?.stack);
    return res.status(500).json({ ok: false, error: '联赛推进失败' });
  }
});

module.exports = router;
