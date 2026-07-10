/**
 * 副本 API：副本列表、副本怪物、组队、每日次数
 */
const express = require('express');
const router = express.Router();
const db = require('../dbAsync');
const { authMiddleware } = require('../middleware/auth');
const { getDungeons, getDungeonById, getDungeonEnemies, getDungeonEnemyById, getSectById, getSkillById } = require('../game/dataLoader');
const { getRealmQualityFromLevel } = require('../game/combatUtils');

const REALM_NAMES = { 1: '练气', 2: '筑基', 3: '结丹', 4: '元婴', 5: '化神', 6: '炼虚及以上' };

async function _buildDungeonTeamPayload(team, selfAccountId = 0) {
  if (!team) return null;
  const selfId = Number(selfAccountId) || 0;
  const leaderId = Number(team.leader_account_id) || 0;
  const members = await Promise.all((team.members || []).map(async accountId => {
    const acc = await db.getAccountById(accountId);
    const player = await db.getPlayerByAccountId(accountId);
    const aid = Number(accountId) || 0;
    return {
      account_id: aid,
      username: acc ? acc.username : '未知',
      player_name: player?.name || acc?.username || '未知',
      level: player ? (Number(player.level) || 1) : 1,
      is_leader: aid === leaderId
    };
  }));
  return {
    team_code: team.team_code,
    leader_account_id: leaderId,
    self_account_id: selfId,
    is_leader: leaderId > 0 && selfId > 0 && leaderId === selfId,
    member_count: members.length,
    max_members: 3,
    members
  };
}

// 无需登录：获取副本列表
router.get('/list', (req, res) => {
  const dungeons = getDungeons();
  res.json({ ok: true, dungeons });
});

// 无需登录：获取副本怪物列表
router.get('/monsters', (req, res) => {
  const monsters = getDungeonEnemies();
  res.json({ ok: true, monsters });
});

// 无需登录：获取指定副本怪物
router.get('/monsters/:dungeonId', (req, res) => {
  const dungeon = getDungeonById(Number(req.params.dungeonId));
  if (!dungeon || !dungeon.id) return res.json({ ok: false, error: '副本不存在' });
  const ids = dungeon.monster_ids || [];
  const monsters = ids.map(id => getDungeonEnemyById(id)).filter(m => m.id);
  res.json({ ok: true, monsters });
});

// 以下需要登录
router.use(authMiddleware);

// 获取副本详情（含今日剩余次数）
router.get('/:id', async (req, res) => {
  const dungeon = getDungeonById(Number(req.params.id));
  if (!dungeon || !dungeon.id) return res.json({ ok: false, error: '副本不存在' });
  const completions = await db.getDungeonCompletionsToday(req.accountId, dungeon.id);
  const dailyLimit = Number(dungeon.daily_limit) || 2;
  const remaining = Math.max(0, dailyLimit - completions);
  const monsterIds = dungeon.monster_ids || [];
  const monsters = monsterIds.map(id => getDungeonEnemyById(id)).filter(m => m.id);
  res.json({ ok: true, dungeon: { ...dungeon, monsters }, completions_today: completions, remaining_today: remaining });
});

// 创建队伍（不要求选副本，30分钟无人员变动自动过期）
router.post('/team/create', async (req, res) => {
  const code = await db.createDungeonTeam(req.accountId, 0);
  res.json({ ok: true, team_code: code });
});

// 获取自己当前所在队伍
router.get('/team/mine', async (req, res) => {
  const team = await db.getMyDungeonTeam(req.accountId);
  if (!team) return res.json({ ok: true, team: null });
  res.json({ ok: true, team: await _buildDungeonTeamPayload(team, req.accountId) });
});

// 加入队伍
router.post('/team/join', async (req, res) => {
  const { team_code: teamCode } = req.body || {};
  if (!teamCode || typeof teamCode !== 'string') return res.json({ ok: false, error: '请输入队伍码' });
  const code = teamCode.toUpperCase().trim();
  const team = await db.getDungeonTeam(code);
  if (!team) return res.json({ ok: false, error: '队伍不存在或已过期' });
  const leaderPlayer = await db.getPlayerByAccountId(team.leader_account_id);
  const joinerPlayer = await db.getPlayerByAccountId(req.accountId);
  if (leaderPlayer && joinerPlayer) {
    const leaderRealm = getRealmQualityFromLevel(Number(leaderPlayer.level) || 1);
    const joinerRealm = getRealmQualityFromLevel(Number(joinerPlayer.level) || 1);
    if (leaderRealm !== joinerRealm) {
      return res.json({ ok: false, error: `仅同境界可组队（队长${REALM_NAMES[leaderRealm]}，你${REALM_NAMES[joinerRealm]}）` });
    }
  }
  const r = await db.joinDungeonTeam(code, req.accountId);
  if (!r.ok) return res.json(r);
  res.json({ ok: true });
});

// 获取队伍信息（含成员列表）
router.get('/team/:code', async (req, res) => {
  const team = await db.getDungeonTeam((req.params.code || '').toUpperCase());
  if (!team) return res.json({ ok: false, error: '队伍不存在或已过期' });
  res.json({ ok: true, team: await _buildDungeonTeamPayload(team, req.accountId) });
});

// 队长踢人（不能踢自己）
router.post('/team/kick', async (req, res) => {
  const { team_code: teamCode, target_account_id: targetAccountIdRaw } = req.body || {};
  const code = String(teamCode || '').toUpperCase().trim();
  const targetAccountId = Number(targetAccountIdRaw) || 0;
  if (!code) return res.json({ ok: false, error: '队伍码无效' });
  if (targetAccountId <= 0) return res.json({ ok: false, error: '目标成员无效' });

  const team = await db.getDungeonTeam(code);
  if (!team) return res.json({ ok: false, error: '队伍不存在或已过期' });

  const leaderId = Number(team.leader_account_id) || 0;
  const selfId = Number(req.accountId) || 0;
  if (leaderId <= 0 || selfId !== leaderId) {
    return res.json({ ok: false, error: '仅队长可执行踢人操作' });
  }
  if (targetAccountId === leaderId) {
    return res.json({ ok: false, error: '队长不能踢自己，请直接离开队伍' });
  }
  const members = Array.isArray(team.members) ? team.members.map(v => Number(v) || 0) : [];
  if (!members.includes(targetAccountId)) {
    return res.json({ ok: false, error: '目标不在当前队伍中' });
  }

  await db.leaveDungeonTeam(code, targetAccountId);
  const updated = await db.getDungeonTeam(code);
  if (!updated) return res.json({ ok: true, team: null });
  return res.json({ ok: true, team: await _buildDungeonTeamPayload(updated, req.accountId) });
});

// 离开队伍
router.post('/team/leave', async (req, res) => {
  const { team_code: teamCode } = req.body || {};
  await db.leaveDungeonTeam((teamCode || '').toUpperCase(), req.accountId);
  res.json({ ok: true });
});

// 副本通关次数由 dungeonBattle advance 在胜利时自动计入，无需单独接口

module.exports = router;
