#!/usr/bin/env node
const dbApi = require('../db');
const league = require('../game/leagueSystem');

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
    out.push({
      account_id: aid,
      name: String(m?.name || `道友#${aid}`)
    });
  }
  return out;
}

function parseArgValue(name, fallback = '') {
  const hit = process.argv.find((x) => String(x || '').startsWith(`${name}=`));
  if (!hit) return fallback;
  return String(hit.slice(name.length + 1) || '').trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function getCurrentSeasonId() {
  const status = league.getSeasonStatus(Math.floor(Date.now() / 1000), 0);
  return intVal(status?.timeline?.current_season_start, 0);
}

function loadTeams(seasonId) {
  const rows = dbApi.db.prepare(`
    SELECT id, status, members_json, frozen_json
    FROM league_teams
    WHERE season_id = ?
  `).all(intVal(seasonId, 0));

  return rows.map((r) => {
    const members = normalizeMembers(parseJsonSafe(r.members_json, []));
    const frozen = normalizeMembers(parseJsonSafe(r.frozen_json, []));
    return {
      id: intVal(r.id, 0),
      status: String(r.status || ''),
      members,
      frozen
    };
  }).filter((t) => t.id > 0);
}

function loadRoundMatches(seasonId, rounds) {
  const marks = rounds.map(() => '?').join(',');
  const rows = dbApi.db.prepare(`
    SELECT round_no, team_a_id, team_b_id, points_a, points_b
    FROM league_matches
    WHERE season_id = ? AND round_no IN (${marks})
  `).all(intVal(seasonId, 0), ...rounds.map((x) => intVal(x, 0)));

  const map = new Map();
  function setPoints(roundNo, teamId, points) {
    const rn = intVal(roundNo, 0);
    const tid = intVal(teamId, 0);
    if (rn <= 0 || tid <= 0) return;
    const key = `${rn}:${tid}`;
    if (!map.has(key)) map.set(key, intVal(points, 0));
  }

  for (const row of rows) {
    setPoints(row.round_no, row.team_a_id, row.points_a);
    setPoints(row.round_no, row.team_b_id, row.points_b);
  }
  return map;
}

function buildGrantPlan({ teams, rounds, pointsByRoundTeam, missingRoundPoints }) {
  const grants = [];

  for (const team of teams) {
    if (team.status !== 'active' && team.status !== 'finished') continue;
    const memberIds = new Set(team.members.map((m) => intVal(m.account_id, 0)).filter((x) => x > 0));
    const frozenIds = new Set(team.frozen.map((m) => intVal(m.account_id, 0)).filter((x) => x > 0));
    const unionIds = new Set([...memberIds, ...frozenIds]);

    for (const rn of rounds) {
      const roundNo = intVal(rn, 0);
      if (roundNo <= 0) continue;
      const key = `${roundNo}:${team.id}`;
      const teamPoints = pointsByRoundTeam.has(key) ? intVal(pointsByRoundTeam.get(key), 0) : null;

      // 场次记录缺失：按轮空口径做补偿（默认2分，可通过参数调整）。
      if (teamPoints === null) {
        const comp = Math.max(0, intVal(missingRoundPoints, 0));
        if (comp <= 0) continue;
        for (const aid of unionIds) {
          grants.push({
            account_id: aid,
            team_id: team.id,
            round_no: roundNo,
            points: comp,
            kind: 'missing_match_record',
            code: `league_regrant_missing_match_v1_${intVal(getCurrentSeasonId(), 0)}_${roundNo}_${team.id}_${aid}`
          });
        }
        continue;
      }

      // 旧逻辑只按 frozen 发分：members 有但 frozen 无的成员需要补发本轮队伍积分。
      if (teamPoints > 0) {
        for (const aid of memberIds) {
          if (frozenIds.has(aid)) continue;
          grants.push({
            account_id: aid,
            team_id: team.id,
            round_no: roundNo,
            points: teamPoints,
            kind: 'member_not_in_frozen',
            code: `league_regrant_member_gap_v1_${intVal(getCurrentSeasonId(), 0)}_${roundNo}_${team.id}_${aid}`
          });
        }
      }
    }
  }

  return grants;
}

function applyGrants(grants, dryRun) {
  const summary = {
    total: grants.length,
    applied: 0,
    skipped_no_player: 0,
    skipped_redeemed: 0,
    failed: 0,
    points_total: 0
  };

  for (const g of grants) {
    const aid = intVal(g.account_id, 0);
    const pts = Math.max(0, intVal(g.points, 0));
    if (aid <= 0 || pts <= 0) continue;

    try {
      if (dbApi.hasAccountRedeemed(aid, g.code)) {
        summary.skipped_redeemed += 1;
        continue;
      }

      const player = dbApi.getPlayerByAccountId(aid);
      if (!player) {
        summary.skipped_no_player += 1;
        continue;
      }

      if (!dryRun) {
        player.league_points = Math.max(0, intVal(player.league_points, 0) + pts);
        if (typeof dbApi.savePlayerImmediate === 'function') dbApi.savePlayerImmediate(aid, 1, player);
        else dbApi.savePlayer(aid, 1, player);
        dbApi.recordAccountRedemption(aid, g.code);
      }

      summary.applied += 1;
      summary.points_total += pts;
    } catch (err) {
      summary.failed += 1;
      console.error('[regrant] failed aid=%s round=%s team=%s: %s', aid, g.round_no, g.team_id, err?.message || err);
    }
  }

  return summary;
}

function main() {
  const apply = hasFlag('--apply');
  const dryRun = !apply;

  const seasonArg = intVal(parseArgValue('--season', '0'), 0);
  const seasonId = seasonArg > 0 ? seasonArg : getCurrentSeasonId();
  if (seasonId <= 0) {
    console.log(JSON.stringify({ ok: false, error: 'invalid_season' }, null, 2));
    process.exit(1);
    return;
  }

  const roundsArg = parseArgValue('--rounds', '2,3');
  const rounds = [...new Set(roundsArg.split(',').map((x) => intVal(x, 0)).filter((x) => x > 0))];
  if (rounds.length <= 0) {
    console.log(JSON.stringify({ ok: false, error: 'invalid_rounds' }, null, 2));
    process.exit(1);
    return;
  }

  const missingRoundPoints = Math.max(0, intVal(parseArgValue('--missing-round-points', '2'), 2));

  const teams = loadTeams(seasonId);
  const pointsByRoundTeam = loadRoundMatches(seasonId, rounds);
  const grants = buildGrantPlan({ teams, rounds, pointsByRoundTeam, missingRoundPoints });

  const summary = applyGrants(grants, dryRun);

  const output = {
    ok: true,
    dry_run: dryRun,
    season_id: seasonId,
    rounds,
    missing_round_points: missingRoundPoints,
    team_count: teams.length,
    grant_plan_count: grants.length,
    summary,
    preview: grants.slice(0, 200)
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
