/**
 * 传人比拼系统 — 宝可梦画风
 * - 传人养成：天赋值（0-255/项，总分≤780）、战斗属性由天赋值计算，与探索装备独立，宝可梦风格六维
 * - 抽取秘籍：花灵石抽，成功率按品质降低，获得后入技能仓库，可自由配招
 * - 彩物商店：彩物购买丹药提升/随机变更天赋值
 * - 比拼积分商店：积分购买材料箱
 * - 匹配比拼：胜+20积分+50-100彩物，败+10积分
 */

const path = require('path');
const fs = require('fs');
const { getSkillById, getItems } = require('./dataLoader');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const DRAW_COST = 5000;
const WIN_POINTS = 20;
const LOSE_POINTS = 10;
const WIN_COINS_MIN = 50;
const WIN_COINS_MAX = 100;
const SKILL_SLOTS = 4;
const RACE_TOTAL_MAX = 780;
const RACE_STAT_MAX = 255;
const RACE_INITIAL = 50;
const TURN_TIMEOUT_MS = 30000;
const ENEMY_SKILL_SOURCE_IDS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
const TYPE_NAMES = { normal:'无', fire:'火', water:'水', grass:'木', ground:'土', steel:'金', psychic:'混元' };
const RACE_STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'speed'];

const SHOP_PILLS = [
  { id: 'hp', name: '气血丹', stat: 'hp', add: 5, cost: 15 },
  { id: 'atk', name: '锐力丹', stat: 'atk', add: 5, cost: 15 },
  { id: 'def', name: '坚壁丹', stat: 'def', add: 5, cost: 15 },
  { id: 'spa', name: '灵犀丹', stat: 'spa', add: 5, cost: 15 },
  { id: 'spd', name: '定神丹', stat: 'spd', add: 5, cost: 15 },
  { id: 'speed', name: '疾风丹', stat: 'speed', add: 5, cost: 15 },
  { id: 'random_reroll', name: '洗髓丹', stat: null, add: 0, cost: 20, type: 'reroll', desc: '随机重新分配一项天赋值到另一项' },
];

const RESTRICTED_TAGS = ['gm_only', 'invite_shop_only', 'no_dungeon_loot'];

function _getMaterialPool(quality) {
  const items = getItems();
  return (items || []).filter(it => {
    if (it.type !== 'material' || it.quality !== quality) return false;
    const tags = it.tags || [];
    return !RESTRICTED_TAGS.some(t => tags.includes(t));
  });
}

const POINTS_SHOP = [
  { id: 'mat_box_5', name: '五阶材料箱', cost: 250, currency: 'points', quality: 5, minCount: 1, maxCount: 5, desc: '开启获得1-5个随机五阶材料' },
  { id: 'mat_box_6', name: '六阶材料箱', cost: 400, currency: 'points', quality: 6, minCount: 1, maxCount: 3, desc: '开启获得1-3个随机六阶材料' },
];

const QUALITY_SUCCESS_RATE = { 1: 0.90, 2: 0.70, 3: 0.50, 4: 0.30, 5: 0.15 };

let _skillsData = null;
function getDiscipleBattleSkills() {
  if (!_skillsData) {
    const p = path.join(__dirname, '../../data/skillsDiscipleBattle.json');
    try {
      _skillsData = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.error('[discipleBattle] 加载技能失败:', e?.message);
      _skillsData = { skills: [], typeEffectiveness: {} };
    }
  }
  return _skillsData;
}

function getDrawableSkills() {
  const data = getDiscipleBattleSkills();
  const skills = data.skills || [];
  return skills.filter(s => !ENEMY_SKILL_SOURCE_IDS.includes(s.sourceId));
}

function getSkillBySourceId(sourceId) {
  const skill = (getDiscipleBattleSkills().skills || []).find(s => s.sourceId === intVal(sourceId));
  return skill || null;
}

function _getSkillQuality(sourceId) {
  const orig = getSkillById(sourceId);
  return Math.min(5, Math.max(1, intVal(orig?.quality, 1)));
}

function _raceToBattle(race) {
  if (!race) return { hp: 80, atk: 50, def: 50, spa: 50, spd: 50, speed: 50 };
  const r = (v) => Math.floor((intVal(v, RACE_INITIAL) / 2) + 50);
  return {
    hp: Math.max(60, Math.floor(intVal(race.hp, RACE_INITIAL) * 2 + 30)),
    atk: Math.max(20, r(race.atk)),
    def: Math.max(20, r(race.def)),
    spa: Math.max(20, r(race.spa)),
    spd: Math.max(20, r(race.spd)),
    speed: Math.max(20, r(race.speed))
  };
}

function ensureDiscipleBattle(disciple) {
  if (!disciple) return null;
  if (!disciple.disciple_battle || typeof disciple.disciple_battle !== 'object') {
    disciple.disciple_battle = {
      race: { hp: RACE_INITIAL, atk: RACE_INITIAL, def: RACE_INITIAL, spa: RACE_INITIAL, spd: RACE_INITIAL, speed: RACE_INITIAL },
      skill_warehouse: [],
      equipped_skills: [],
      points: 0,
      disciple_coins: 0
    };
  }
  const db = disciple.disciple_battle;
  if (Array.isArray(db.skills) && db.skills.length > 0 && (!db.skill_warehouse || db.skill_warehouse.length === 0)) {
    db.skill_warehouse = [...db.skills];
    db.equipped_skills = [...db.skills];
    delete db.skills;
  }
  if (!db.race && (db.hp != null || db.atk != null)) {
    const v = (x) => Math.min(RACE_STAT_MAX, Math.max(0, intVal(x, RACE_INITIAL)));
    db.race = { hp: v(db.hp || 80), atk: v(db.atk || 50), def: v(db.def || 50), spa: v(db.spa || 50), spd: v(db.spd || 50), speed: v(db.speed || 50) };
  }
  if (!db.race) db.race = { hp: RACE_INITIAL, atk: RACE_INITIAL, def: RACE_INITIAL, spa: RACE_INITIAL, spd: RACE_INITIAL, speed: RACE_INITIAL };
  let total = 0;
  for (const k of RACE_STATS) {
    db.race[k] = Math.min(RACE_STAT_MAX, Math.max(0, intVal(db.race[k], RACE_INITIAL)));
    total += db.race[k];
  }
  if (total > RACE_TOTAL_MAX) {
    let excess = total - RACE_TOTAL_MAX;
    for (const k of RACE_STATS) {
      if (excess <= 0) break;
      const sub = Math.min(db.race[k], excess);
      db.race[k] -= sub;
      excess -= sub;
    }
  }
  if (!Array.isArray(db.skill_warehouse)) db.skill_warehouse = [];
  if (!Array.isArray(db.equipped_skills)) db.equipped_skills = [];
  while (db.equipped_skills.length < SKILL_SLOTS) db.equipped_skills.push(null);
  db.equipped_skills = db.equipped_skills.slice(0, SKILL_SLOTS);
  db.points = Math.max(0, intVal(db.points, 0));
  db.disciple_coins = Math.max(0, intVal(db.disciple_coins, 0));
  return db;
}

function drawManual(player, accountId) {
  const stones = intVal(player.spirit_stones, 0);
  if (stones < DRAW_COST) return { ok: false, error: `灵石不足，需要${DRAW_COST}` };
  if (!player.disciple) return { ok: false, error: '还没有传人' };

  const db = ensureDiscipleBattle(player.disciple);
  const pool = getDrawableSkills();
  if (pool.length === 0) return { ok: false, error: '秘籍池为空' };

  const idx = Math.floor(Math.random() * pool.length);
  const skill = pool[idx];
  const sid = skill.sourceId;
  const quality = _getSkillQuality(sid);
  const rate = QUALITY_SUCCESS_RATE[quality] ?? 0.30;

  player.spirit_stones = stones - DRAW_COST;

  if (Math.random() > rate) {
    return { ok: true, success: false, message: `抽取失败，未领悟「${skill.name}」`, disciple_battle: _publicBattleState(db) };
  }
  if (db.skill_warehouse.includes(sid)) {
    return { ok: true, success: false, message: `已拥有「${skill.name}」`, disciple_battle: _publicBattleState(db) };
  }
  db.skill_warehouse.push(sid);
  return {
    ok: true,
    success: true,
    skill: { sourceId: sid, name: skill.name, type: skill.type, category: skill.category, power: skill.power, pp: skill.pp, effect: skill.effect, quality },
    disciple_battle: _publicBattleState(db)
  };
}

function equipSkill(player, slotIndex, sourceId) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const db = ensureDiscipleBattle(player.disciple);
  const si = intVal(slotIndex, -1);
  if (si < 0 || si >= SKILL_SLOTS) return { ok: false, error: '无效技能槽' };
  if (!db.skill_warehouse.includes(intVal(sourceId, 0))) return { ok: false, error: '技能仓库中无此秘籍' };
  while (db.equipped_skills.length <= si) db.equipped_skills.push(null);
  db.equipped_skills[si] = intVal(sourceId, 0);
  return { ok: true, disciple_battle: _publicBattleState(db) };
}

function unequipSkill(player, slotIndex) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const db = ensureDiscipleBattle(player.disciple);
  const si = intVal(slotIndex, -1);
  if (si < 0 || si >= SKILL_SLOTS) return { ok: false, error: '无效技能槽' };
  while (db.equipped_skills.length <= si) db.equipped_skills.push(null);
  db.equipped_skills[si] = null;
  return { ok: true, disciple_battle: _publicBattleState(db) };
}

function buyPill(player, pillId) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const db = ensureDiscipleBattle(player.disciple);
  const pill = SHOP_PILLS.find(p => p.id === pillId);
  if (!pill) return { ok: false, error: '无效丹药' };
  if (db.disciple_coins < pill.cost) return { ok: false, error: `彩物不足，需要${pill.cost}` };

  if (pill.type === 'reroll') {
    const nonZero = RACE_STATS.filter(k => (db.race[k] || 0) > 0);
    if (nonZero.length < 2) return { ok: false, error: '没有足够属性可洗' };
    db.disciple_coins -= pill.cost;
    const from = nonZero[Math.floor(Math.random() * nonZero.length)];
    const transfer = Math.min(db.race[from], Math.max(1, Math.floor(Math.random() * 15) + 1));
    db.race[from] -= transfer;
    const candidates = RACE_STATS.filter(k => k !== from && (db.race[k] || 0) < RACE_STAT_MAX);
    if (candidates.length === 0) { db.race[from] += transfer; return { ok: false, error: '其他属性均已满' }; }
    const to = candidates[Math.floor(Math.random() * candidates.length)];
    const actual = Math.min(transfer, RACE_STAT_MAX - (db.race[to] || 0));
    db.race[to] = (db.race[to] || 0) + actual;
    db.race[from] += (transfer - actual);
    const STAT_CN = { hp:'HP', atk:'物攻', def:'物防', spa:'特攻', spd:'特防', speed:'速度' };
    return { ok: true, disciple_battle: _publicBattleState(db), message: `${STAT_CN[from]}-${transfer} → ${STAT_CN[to]}+${actual}` };
  }

  const total = Object.values(db.race).reduce((a, b) => a + (b || 0), 0);
  if (total >= RACE_TOTAL_MAX) return { ok: false, error: '天赋值总和已达上限' };
  const curVal = db.race[pill.stat] || 0;
  if (curVal >= RACE_STAT_MAX) return { ok: false, error: `${pill.stat}已达上限` };
  const add = Math.min(pill.add, RACE_STAT_MAX - curVal, RACE_TOTAL_MAX - total);
  if (add <= 0) return { ok: false, error: '无法再提升' };
  db.disciple_coins -= pill.cost;
  db.race[pill.stat] = curVal + add;
  return { ok: true, disciple_battle: _publicBattleState(db), added: add, stat: pill.stat };
}

function buyPointsShopItem(player, itemId) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const db = ensureDiscipleBattle(player.disciple);
  const shopItem = POINTS_SHOP.find(p => p.id === itemId);
  if (!shopItem) return { ok: false, error: '无效商品' };
  if ((db.points || 0) < shopItem.cost) return { ok: false, error: `积分不足，需要${shopItem.cost}` };

  const pool = _getMaterialPool(shopItem.quality);
  if (pool.length === 0) return { ok: false, error: `无可用${shopItem.quality}阶材料` };

  const count = shopItem.minCount + Math.floor(Math.random() * (shopItem.maxCount - shopItem.minCount + 1));
  const drops = [];
  for (let i = 0; i < count; i++) {
    const mat = pool[Math.floor(Math.random() * pool.length)];
    drops.push({ id: mat.id, name: mat.name, count: 1 });
  }
  db.points -= shopItem.cost;
  return { ok: true, disciple_battle: _publicBattleState(db), drops };
}

function _publicBattleState(db) {
  if (!db) return null;
  const battle = _raceToBattle(db.race);
  const equipped = [];
  for (let i = 0; i < SKILL_SLOTS; i++) equipped.push((db.equipped_skills || [])[i] ?? null);
  return {
    race: { ...(db.race || {}) },
    battle_stats: battle,
    skill_warehouse: [...(db.skill_warehouse || [])],
    equipped_skills: equipped,
    points: db.points || 0,
    disciple_coins: db.disciple_coins || 0
  };
}

function getBattleStatus(player) {
  if (!player.disciple) return { ok: false, hasDisciple: false };
  const db = ensureDiscipleBattle(player.disciple);
  const warehouseDetail = (db.skill_warehouse || []).map(sid => {
    const s = getSkillBySourceId(sid);
    return s ? { sourceId: s.sourceId, name: s.name, type: s.type, category: s.category, power: s.power, pp: s.pp, effect: s.effect, quality: _getSkillQuality(sid) } : { sourceId: sid, name: '未知' };
  });
  const equippedDetail = [];
  for (let i = 0; i < SKILL_SLOTS; i++) {
    const sid = (db.equipped_skills || [])[i];
    if (sid) {
      const s = getSkillBySourceId(sid);
      equippedDetail.push(s ? { slotIndex: i, sourceId: s.sourceId, name: s.name, type: s.type, category: s.category, power: s.power, pp: s.pp, effect: s.effect } : { slotIndex: i, sourceId: sid, name: '未知' });
    } else {
      equippedDetail.push({ slotIndex: i, sourceId: null, name: null });
    }
  }
  return {
    ok: true,
    hasDisciple: true,
    disciple_battle: _publicBattleState(db),
    skill_warehouse_detail: warehouseDetail,
    equipped_skills_detail: equippedDetail,
    draw_cost: DRAW_COST,
    drawable_count: getDrawableSkills().length,
    shop_pills: SHOP_PILLS,
    points_shop: POINTS_SHOP
  };
}

// ─── 匹配队列与对战房间 ───
const _matchQueue = [];
const _rooms = new Map();

function joinMatchQueue(accountId, player) {
  if (!player.disciple) return { ok: false, error: '还没有传人' };
  const db = ensureDiscipleBattle(player.disciple);
  const equipped = (db.equipped_skills || []).filter(x => x != null);
  if (equipped.length === 0) return { ok: false, error: '请先在技能仓库配招至少1个技能' };

  const idx = _matchQueue.findIndex(e => e.accountId === accountId);
  if (idx >= 0) return { ok: true, status: 'queuing', message: '已在匹配队列中' };

  const wasQueued = _matchQueue.length;
  _matchQueue.push({ accountId, ts: Date.now() });
  const matchedRoomId = _tryMatchInternal();
  if (matchedRoomId && wasQueued >= 1) {
    const room = _rooms.get(matchedRoomId);
    if (room && (room.playerA === accountId || room.playerB === accountId) && room.state) {
      return { ok: true, status: 'matched', roomId: matchedRoomId, state: room.state };
    }
  }
  return { ok: true, status: 'queuing' };
}

function leaveMatchQueue(accountId) {
  const idx = _matchQueue.findIndex(e => e.accountId === accountId);
  if (idx >= 0) _matchQueue.splice(idx, 1);
  return { ok: true };
}

function _tryMatch(onMatched) {
  let lastRoomId = null;
  while (_matchQueue.length >= 2) {
    const a = _matchQueue.shift();
    const b = _matchQueue.shift();
    const roomId = `db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _rooms.set(roomId, { playerA: a.accountId, playerB: b.accountId, state: null, createdAt: Date.now() });
    lastRoomId = roomId;
    if (typeof onMatched === 'function') onMatched(roomId, a.accountId, b.accountId);
  }
  return lastRoomId;
}

function setOnMatchedCallback(fn) {
  _onMatchedCallback = fn;
}
let _onMatchedCallback = null;

function _tryMatchInternal() {
  return _tryMatch(_onMatchedCallback || (() => {}));
}

function getRoom(roomId) { return _rooms.get(roomId) || null; }
function setRoomState(roomId, state) {
  const r = _rooms.get(roomId);
  if (r) r.state = state;
}
function deleteRoom(roomId) { _clearRoomTimer(roomId); _rooms.delete(roomId); }

// ─── 战斗引擎（简化宝可梦公式）───
const STRUGGLE_ID = -1;
const _roomTimers = new Map();
let _timeoutCallback = null;

function setTimeoutCallback(fn) { _timeoutCallback = fn; }

function _typeEffectiveness(skillType, defenderType) {
  if (!skillType || !defenderType) return 1;
  const chart = (getDiscipleBattleSkills().typeEffectiveness) || {};
  const against = chart[skillType];
  if (!against) return 1;
  return against[defenderType] ?? 1;
}

function _determineType(skillIds) {
  const counts = {};
  for (const sid of skillIds) {
    const s = getSkillBySourceId(sid);
    if (s && s.type && s.type !== 'normal') {
      counts[s.type] = (counts[s.type] || 0) + 1;
    }
  }
  let best = 'normal', bestCount = 0;
  for (const [t, c] of Object.entries(counts)) {
    if (c > bestCount) { best = t; bestCount = c; }
  }
  return best;
}

function _calcDamage(power, atkStat, defStat, typeMult) {
  if (power == null || power <= 0) return 0;
  const base = Math.floor((power * (atkStat / Math.max(1, defStat))) / 10) + 2;
  return Math.max(1, Math.floor(base * (typeMult || 1)));
}

function _hasAnyPp(player) {
  if (!player.pp) return false;
  for (const sid of player.skills) {
    if ((player.pp[sid] || 0) > 0) return true;
  }
  return false;
}

function createBattleState(playerA, playerB, accountIdA, accountIdB) {
  const dbA = ensureDiscipleBattle(playerA.disciple);
  const dbB = ensureDiscipleBattle(playerB.disciple);
  const statsA = _raceToBattle(dbA.race);
  const statsB = _raceToBattle(dbB.race);
  const skillsA = (dbA.equipped_skills || []).filter(x => x != null);
  const skillsB = (dbB.equipped_skills || []).filter(x => x != null);
  const ppA = {};
  for (const sid of skillsA) { const s = getSkillBySourceId(sid); ppA[sid] = s ? (s.pp || 10) : 10; }
  const ppB = {};
  for (const sid of skillsB) { const s = getSkillBySourceId(sid); ppB[sid] = s ? (s.pp || 10) : 10; }
  const typeA = _determineType(skillsA);
  const typeB = _determineType(skillsB);
  return {
    roomId: null,
    players: [
      { accountId: accountIdA, name: playerA.disciple?.name || '传人A', type: typeA, hp: statsA.hp, maxHp: statsA.hp, atk: statsA.atk, def: statsA.def, spa: statsA.spa, spd: statsA.spd, speed: statsA.speed, skills: [...skillsA], pp: ppA },
      { accountId: accountIdB, name: playerB.disciple?.name || '传人B', type: typeB, hp: statsB.hp, maxHp: statsB.hp, atk: statsB.atk, def: statsB.def, spa: statsB.spa, spd: statsB.spd, speed: statsB.speed, skills: [...skillsB], pp: ppB }
    ],
    turn: 0,
    phase: 'choose',
    choices: { 0: null, 1: null },
    log: [],
    winner: null,
    turn_deadline_ms: Date.now() + TURN_TIMEOUT_MS
  };
}

function resolveTurn(state) {
  const c0 = state.choices[0];
  const c1 = state.choices[1];
  if (c0 == null || c1 == null) return state;

  const p0 = state.players[0];
  const p1 = state.players[1];
  const first = p0.speed >= p1.speed ? 0 : 1;
  const second = 1 - first;

  const order = [first, second];
  for (const idx of order) {
    const actor = state.players[idx];
    const targetIdx = 1 - idx;
    const target = state.players[targetIdx];
    const choice = state.choices[idx];
    if (choice == null || actor.hp <= 0) continue;

    if (choice.struggle) {
      const power = 50;
      const atk = actor.atk;
      const def = target.def;
      const dmg = _calcDamage(power, atk, def, 1);
      target.hp = Math.max(0, target.hp - dmg);
      const recoil = Math.max(1, Math.floor(actor.maxHp / 4));
      actor.hp = Math.max(0, actor.hp - recoil);
      state.log.push(`${actor.name} 使用了挣扎！对 ${target.name} 造成了 ${dmg} 伤害！（反伤 ${recoil}）`);
      if (target.hp <= 0 || actor.hp <= 0) break;
      continue;
    }

    const skill = getSkillBySourceId(choice.skillSourceId);
    if (!skill) continue;
    let pp = actor.pp[choice.skillSourceId] || 0;
    if (pp <= 0) {
      state.log.push(`${actor.name} 的 ${skill.name} 没有PP了！`);
      continue;
    }
    actor.pp[choice.skillSourceId] = pp - 1;

    if (skill.category === 'status') {
      state.log.push(`${actor.name} 使用了 ${skill.name}！`);
      continue;
    }

    const power = skill.power || 40;
    const isPhys = skill.category === 'physical';
    const atk = isPhys ? actor.atk : actor.spa;
    const def = isPhys ? target.def : target.spd;
    const typeMult = _typeEffectiveness(skill.type, target.type);
    const dmg = _calcDamage(power, atk, def, typeMult);
    target.hp = Math.max(0, target.hp - dmg);
    let effectText = '';
    if (typeMult > 1) effectText = '（效果拔群！）';
    else if (typeMult < 1) effectText = '（效果不佳…）';
    state.log.push(`${actor.name} 的 ${skill.name} 对 ${target.name} 造成了 ${dmg} 伤害！${effectText}`);
    if (target.hp <= 0) break;
  }

  state.turn += 1;
  state.choices = { 0: null, 1: null };

  if (p0.hp <= 0 && p1.hp <= 0) {
    state.phase = 'ended';
    state.winner = first;
  } else if (p0.hp <= 0) {
    state.phase = 'ended';
    state.winner = 1;
  } else if (p1.hp <= 0) {
    state.phase = 'ended';
    state.winner = 0;
  } else {
    state.phase = 'choose';
    state.turn_deadline_ms = Date.now() + TURN_TIMEOUT_MS;
  }
  return state;
}

function submitChoice(state, playerIndex, skillSourceId) {
  if (state.phase !== 'choose') return { ok: false, error: '不是选择阶段' };
  if (state.turn_deadline_ms && Date.now() > state.turn_deadline_ms) {
    return { ok: false, error: '回合已超时' };
  }
  const p = state.players[playerIndex];
  if (!p || p.hp <= 0) return { ok: false, error: '该传人已倒下' };
  if (state.choices[playerIndex] != null) return { ok: false, error: '本回合已选择' };

  if (skillSourceId === STRUGGLE_ID) {
    if (_hasAnyPp(p)) return { ok: false, error: '还有PP可用，不能挣扎' };
    state.choices[playerIndex] = { struggle: true };
    return { ok: true };
  }

  if (!p.skills.includes(skillSourceId)) return { ok: false, error: '未装备该技能' };
  if ((p.pp[skillSourceId] || 0) <= 0) {
    if (!_hasAnyPp(p)) {
      state.choices[playerIndex] = { struggle: true };
      return { ok: true };
    }
    return { ok: false, error: '该技能PP已耗尽' };
  }
  state.choices[playerIndex] = { skillSourceId };
  return { ok: true };
}

function handleTimeout(roomId) {
  const room = _rooms.get(roomId);
  if (!room || !room.state) return null;
  const state = room.state;
  if (state.phase !== 'choose') return null;
  if (!state.turn_deadline_ms || Date.now() < state.turn_deadline_ms) return null;

  const c0 = state.choices[0];
  const c1 = state.choices[1];

  if (c0 == null && c1 == null) {
    state.phase = 'ended';
    state.winner = state.players[0].hp >= state.players[1].hp ? 0 : 1;
    state.log.push('双方均超时未出招！');
  } else if (c0 == null) {
    state.phase = 'ended';
    state.winner = 1;
    state.log.push(`${state.players[0].name} 超时未出招，判负！`);
  } else if (c1 == null) {
    state.phase = 'ended';
    state.winner = 0;
    state.log.push(`${state.players[1].name} 超时未出招，判负！`);
  }
  return state;
}

function scheduleRoomTimeout(roomId) {
  _clearRoomTimer(roomId);
  const room = _rooms.get(roomId);
  if (!room || !room.state || room.state.phase !== 'choose') return;
  const delay = Math.max(1000, (room.state.turn_deadline_ms || 0) - Date.now() + 500);
  const timer = setTimeout(() => {
    _roomTimers.delete(roomId);
    if (_timeoutCallback) _timeoutCallback(roomId);
  }, delay);
  _roomTimers.set(roomId, timer);
}

function _clearRoomTimer(roomId) {
  const t = _roomTimers.get(roomId);
  if (t) clearTimeout(t);
  _roomTimers.delete(roomId);
}

function getPlayerIndex(state, accountId) {
  if (state.players[0].accountId === accountId) return 0;
  if (state.players[1].accountId === accountId) return 1;
  return -1;
}

async function settleBattle(roomId, state, db) {
  if (!state || state.phase !== 'ended') return;
  const winnerIdx = state.winner;
  if (winnerIdx == null || winnerIdx < 0 || winnerIdx > 1) { deleteRoom(roomId); return; }
  const loserIdx = 1 - winnerIdx;
  const coins = WIN_COINS_MIN + Math.floor(Math.random() * (WIN_COINS_MAX - WIN_COINS_MIN + 1));
  const winnerAccountId = state.players[winnerIdx].accountId;
  const loserAccountId = state.players[loserIdx].accountId;
  const pWin = await db.getPlayerByAccountId(winnerAccountId);
  if (pWin?.disciple) {
    const dbat = ensureDiscipleBattle(pWin.disciple);
    dbat.points = (dbat.points || 0) + WIN_POINTS;
    dbat.disciple_coins = (dbat.disciple_coins || 0) + coins;
    await db.savePlayer(winnerAccountId, 1, pWin);
  }
  const pLose = await db.getPlayerByAccountId(loserAccountId);
  if (pLose?.disciple) {
    const dbat = ensureDiscipleBattle(pLose.disciple);
    dbat.points = (dbat.points || 0) + LOSE_POINTS;
    await db.savePlayer(loserAccountId, 1, pLose);
  }
  state.reward_coins = coins;
  state.reward_points = WIN_POINTS;
  state.lose_points = LOSE_POINTS;
  deleteRoom(roomId);
}

module.exports = {
  DRAW_COST,
  WIN_POINTS,
  LOSE_POINTS,
  WIN_COINS_MIN,
  WIN_COINS_MAX,
  SKILL_SLOTS,
  SHOP_PILLS,
  POINTS_SHOP,
  RACE_TOTAL_MAX,
  RACE_STAT_MAX,
  STRUGGLE_ID,
  TURN_TIMEOUT_MS,
  TYPE_NAMES,
  setOnMatchedCallback,
  setTimeoutCallback,
  handleTimeout,
  scheduleRoomTimeout,
  getDiscipleBattleSkills,
  getDrawableSkills,
  getSkillBySourceId,
  ensureDiscipleBattle,
  drawManual,
  equipSkill,
  unequipSkill,
  buyPill,
  buyPointsShopItem,
  getBattleStatus,
  joinMatchQueue,
  leaveMatchQueue,
  getRoom,
  setRoomState,
  deleteRoom,
  createBattleState,
  resolveTurn,
  submitChoice,
  getPlayerIndex,
  settleBattle,
  _publicBattleState
};
