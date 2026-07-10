#!/usr/bin/env node
const league = require('../game/leagueSystem');
const dbApi = require('../db');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function parseJsonSafe(raw, defVal) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? defVal : parsed;
  } catch (_) {
    return defVal;
  }
}

function normalizeMembers(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const m of arr) {
    const aid = intVal(m?.account_id, 0);
    if (aid <= 0 || seen.has(aid)) continue;
    seen.add(aid);
    out.push({ account_id: aid, name: String(m?.name || `道友#${aid}`) });
  }
  return out;
}

function getCurrentSeasonId() {
  const st = league.getSeasonStatus(Math.floor(Date.now() / 1000), 0);
  return intVal(st?.timeline?.current_season_start, 0);
}

function listSeasonTeamsRaw(seasonId) {
  return dbApi.db.prepare('SELECT id, status, members_json, frozen_json FROM league_teams WHERE season_id=?').all(seasonId);
}

function listRoundMatches(seasonId, roundNo) {
  return dbApi.db.prepare('SELECT team_a_id, team_b_id FROM league_matches WHERE season_id=? AND round_no=?').all(seasonId, roundNo);
}

function main() {
  const seasonId = getCurrentSeasonId();
  if (seasonId <= 0) {
    console.log('[diag] 无有效赛季');
    return;
  }

  const rounds = [2, 3];
  const teams = listSeasonTeamsRaw(seasonId)
    .map((r) => {
      const members = normalizeMembers(parseJsonSafe(r.members_json, []));
      const frozen = normalizeMembers(parseJsonSafe(r.frozen_json, []));
      const union = new Map();
      for (const m of members) union.set(m.account_id, m.name);
      for (const m of frozen) if (!union.has(m.account_id)) union.set(m.account_id, m.name);
      return {
        id: intVal(r.id, 0),
        status: String(r.status || ''),
        members: [...union.entries()].map(([account_id, name]) => ({ account_id, name }))
      };
    })
    .filter((t) => t.id > 0 && (t.status === 'active' || t.status === 'finished'));

  const matchesByRound = new Map();
  for (const rn of rounds) {
    const rows = listRoundMatches(seasonId, rn);
    const teamSet = new Set();
    for (const row of rows) {
      const a = intVal(row?.team_a_id, 0);
      const b = intVal(row?.team_b_id, 0);
      if (a > 0) teamSet.add(a);
      if (b > 0) teamSet.add(b);
    }
    matchesByRound.set(rn, teamSet);
  }

  const missing = [];
  for (const team of teams) {
    for (const rn of rounds) {
      const played = matchesByRound.get(rn)?.has(team.id) === true;
      if (!played) {
        for (const m of team.members) {
          missing.push({
            account_id: m.account_id,
            name: m.name,
            team_id: team.id,
            round_no: rn,
            reason: 'team_no_match_record'
          });
        }
      }
    }
  }

  const out = {
    season_id: seasonId,
    rounds,
    active_or_finished_teams: teams.length,
    missing_count: missing.length,
    missing
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
