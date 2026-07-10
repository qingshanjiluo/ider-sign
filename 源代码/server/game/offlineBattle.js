/**
 * 离线战斗模拟：登录时用完整战斗引擎批量模拟离线期间的战斗
 * 与在线战斗使用完全相同的引擎，结果一致
 */

const engine = require('./battleEngine');
const { getEnemyById, getMapById, getItemById, getItems, getEnemyPrefixes, getSkillById, getTechniqueById } = require('./dataLoader');
const ops = require('./playerOps');
const { getBattleVictoryHealPercent, calcSpiritRootBonuses, calcAllPassiveEffects, recalcAndAssignCombatStats } = require('./combatUtils');
const { calculateRestTime } = require('./battleTiming');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clone(v) { return structuredClone(v); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const NIGHTMARE_ENEMY_MULTIPLIER = 4;
const NIGHTMARE_DROP_MULTIPLIER = 3.5;

function isNightmareMap(map) {
  return !!(map && typeof map === 'object' && map.is_nightmare);
}

function applyNightmareEnemy(enemy, map) {
  if (!enemy || !isNightmareMap(map)) return enemy;
  const e = clone(enemy);
  const keys = ['hp', 'attack', 'attackMin', 'attackMax', 'defense', 'agility', 'spellAttack', 'mp', 'max_mp'];
  for (const k of keys) {
    const raw = Number(e[k]);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    e[k] = Math.max(1, Math.floor(raw * NIGHTMARE_ENEMY_MULTIPLIER));
  }
  e.name = `魇化的${String(e.name || '敌人')}`;
  e.nightmare = true;
  return e;
}

const MAX_OFFLINE_SECONDS = 24 * 3600;
const MAX_BATTLES_PER_SESSION = 6000;
const MAX_TURNS_PER_BATTLE = 300;

function calcSpiritTier(level) {
  const lv = Number(level) || 1;
  if (lv <= 120) return 0;
  if (lv <= 160) return 1;
  if (lv <= 200) return 2;
  if (lv <= 240) return 3;
  if (lv <= 280) return 4;
  if (lv <= 320) return 5;
  if (lv <= 360) return 6;
  return 7;
}

function mapEnemyLevelToDropQuality(level) {
  const lv = Number(level) || 1;
  if (lv <= 120) return 1;
  if (lv <= 160) return 2;
  if (lv <= 200) return 3;
  if (lv <= 240) return 4;
  return 5; // 化神期：五阶装备
}

function _rollPrefix() {
  const prefixes = getEnemyPrefixes();
  if (!Array.isArray(prefixes) || prefixes.length === 0) return { name: '', effects: {} };
  let roll = Math.random();
  for (const p of prefixes) {
    roll -= numVal(p.chance, 0);
    if (roll <= 0) return p;
  }
  return prefixes[0] || { name: '', effects: {} };
}

function _applyPrefix(base, prefix) {
  if (!base) return null;
  const e = clone(base);
  if (!prefix || !prefix.effects) return e;
  const fx = prefix.effects;
  if (fx.hp) e.hp = Math.floor((Number(e.hp) || 100) * Number(fx.hp));
  if (fx.attack) {
    e.attack = Math.floor((Number(e.attack) || 10) * Number(fx.attack));
    if (e.attackMin) e.attackMin = Math.floor(Number(e.attackMin) * Number(fx.attack));
    if (e.attackMax) e.attackMax = Math.floor(Number(e.attackMax) * Number(fx.attack));
  }
  if (fx.defense) e.defense = Math.floor((Number(e.defense) || 0) * Number(fx.defense));
  if (fx.agility) e.agility = Math.floor((Number(e.agility) || 0) * Number(fx.agility));
  if (fx.spellAttack) e.spellAttack = Math.floor((Number(e.spellAttack) || 0) * Number(fx.spellAttack));
  e.prefix = String(prefix.name || '');
  return e;
}

function randomEnemyFromMap(mapId) {
  const map = getMapById(mapId);
  if (!map || !map.enemies || map.enemies.length === 0) return null;
  const idx = Math.floor(Math.random() * map.enemies.length);
  const enemyId = Number(map.enemies[idx]) || map.enemies[idx];
  const baseEnemy = getEnemyById(enemyId);
  if (!baseEnemy) return null;
  const prefixed = _applyPrefix(baseEnemy, _rollPrefix());
  return applyNightmareEnemy(prefixed, map);
}

function _canUseSkillNow(unit, sid) {
  const skillId = Math.max(1, intVal(sid, 0));
  if (skillId <= 0) return false;
  if (!Array.isArray(unit?.equipped_skills) || !unit.equipped_skills.includes(skillId)) return false;
  const skill = getSkillById(skillId);
  if (!skill || !skill.id) return false;
  const req = skill.requirements;
  if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
    const weapType = String(unit.weapon_type || '');
    if (!req.weaponTypes.some(wt => weapType.includes(wt))) return false;
  }
  const cd = intVal(unit.skill_cooldowns?.[String(skillId)], 0);
  if (cd > 0) return false;
  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  return mpCost <= intVal(unit.mp, 0);
}

function pickAutoSkill(state) {
  const p = state.player;
  const equipped = Array.isArray(p.equipped_skills) ? p.equipped_skills : [];
  const lingli = numVal(p.lingli_raw || p.lingli, 10);
  const lingliBonus = Math.min(lingli * 0.0005, 0.2);
  const skillChance = 0.75 + lingliBonus;
  if (Math.random() >= skillChance) return { action: 'attack', skill_id: 0 };
  const rolled = Math.max(0, intVal(equipped[Math.floor(Math.random() * 5)], 0));
  if (rolled <= 0) return { action: 'attack', skill_id: 0 };
  if (_canUseSkillNow(p, rolled)) return { action: 'skill', skill_id: intVal(rolled, 0) };

  const available = [...new Set(equipped.map(sid => intVal(sid, 0)).filter(sid => sid > 0 && _canUseSkillNow(p, sid)))];
  if (available.length <= 0) return { action: 'attack', skill_id: 0 };
  return { action: 'skill', skill_id: available[Math.floor(Math.random() * available.length)] };
}

function runSingleBattle(player, mapId) {
  const enemy = randomEnemyFromMap(mapId);
  if (!enemy || !enemy.id) return null;

  const state = engine.createInitialBattleState(player, enemy, Math.floor(Math.random() * 2147483647));
  state.enemy_source = 'wild';
  state.turn_mode = 'action_bar';

  let ended = false;
  let victory = false;
  let draw = false;
  let turns = 0;

  let currentState = state;
  while (!ended && turns < MAX_TURNS_PER_BATTLE) {
    const cmd = pickAutoSkill(currentState);
    const result = engine.applyCommand(currentState, cmd);
    if (!result.ok) break;
    currentState = result.state;
    turns++;
    if (result.ended) {
      ended = true;
      victory = result.victory;
      draw = !!result.draw;
    }
  }

  if (!ended) {
    victory = false;
    draw = true;
  }

  return { state: currentState, enemy, victory, draw, turns };
}

function generateRandomEquipmentForLevel(level) {
  const targetQuality = mapEnemyLevelToDropQuality(level);
  const allowTypes = new Set(['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);
  const pool = (getItems() || []).filter(i => {
    if (!i || !allowTypes.has(String(i.type || ''))) return false;
    if (i.tags && Array.isArray(i.tags) && i.tags.includes('no_dungeon_loot')) return false;
    const q = Number(i.quality) || 1;
    return q >= Math.max(1, targetQuality - 1) && q <= targetQuality;
  });
  const selected = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
  return selected ? clone(selected) : null;
}

function settleOfflineDrops(player, enemy, dropBuff, mapInfo = null) {
  const drops = [];
  const mapDropMult = isNightmareMap(mapInfo) ? NIGHTMARE_DROP_MULTIPLIER : 1.0;
  const dropMultiplier = Math.max(0, (Number(enemy.drop_multiplier) || 1) * (1 + Math.max(0, Number(dropBuff) || 0)) * mapDropMult);
  const droppedCountRef = { count: 0 };
  const maxDrops = 3;

  const configDrops = Array.isArray(enemy.drops) ? enemy.drops : [];
  for (const row of configDrops) {
    if (droppedCountRef.count >= maxDrops) break;
    const itemId = Number(row.itemId) || 0;
    const chance = Math.max(0, Number(row.chance) || 0);
    if (itemId <= 0 || chance <= 0) continue;
    const item = getItemById(itemId);
    if (!item || Object.keys(item).length <= 0) continue;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('invite_shop_only')) continue;
    const adjustedChance = Math.min(1, chance * dropMultiplier);
    if (Math.random() <= adjustedChance) {
      const ok = ops.putItemInInventory(player.inventory || [], clone(item), 1);
      if (ok) {
        droppedCountRef.count++;
        drops.push({ item_id: Number(item.id), item_name: String(item.name || ''), count: 1 });
      }
    }
  }

  if (droppedCountRef.count < maxDrops && ['human', 'spirit', 'undead'].includes(String(enemy.type || ''))) {
    const eqChance = Math.min(1, 0.003 * dropMultiplier);
    if (Math.random() <= eqChance) {
      const eq = generateRandomEquipmentForLevel(enemy.level);
      if (eq) {
        const ok = ops.putItemInInventory(player.inventory || [], eq, 1);
        if (ok) { droppedCountRef.count++; drops.push({ item_id: Number(eq.id), item_name: String(eq.name || ''), count: 1 }); }
      }
    }
  }

  if (droppedCountRef.count < maxDrops && String(enemy.type || '') === 'beast') {
    const tier1Items = [20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10];
    const tier2Items = [25, 26, 27, 28, 29, 4, 10, 62, 63, 64, 65, 66, 67];
    const tier3Items = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70];
    const tier4Items = [40, 41, 42, 43, 44, 71, 169, 178, 182];
    const tier5Items = [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55];
    const lv = Number(enemy.level) || 1;
    let available = [];
    if (lv <= 120) available = tier1Items;
    else if (lv <= 160) available = tier2Items;
    else if (lv <= 200) available = tier3Items;
    else if (lv <= 240) available = tier4Items;
    else available = tier5Items.concat([121]);
    const beastChance1 = Math.min(1, 0.03 * dropMultiplier);
    const beastChance2 = Math.min(1, 0.02 * dropMultiplier);
    if (available.length > 0 && Math.random() <= beastChance1 && droppedCountRef.count < maxDrops) {
      const item = getItemById(pick(available));
      if (item && Object.keys(item).length > 0) {
        const ok = ops.putItemInInventory(player.inventory || [], clone(item), 1);
        if (ok) { droppedCountRef.count++; drops.push({ item_id: Number(item.id), item_name: String(item.name || ''), count: 1 }); }
      }
    }
    if (available.length > 0 && Math.random() <= beastChance2 && droppedCountRef.count < maxDrops) {
      const item = getItemById(pick(available));
      if (item && Object.keys(item).length > 0) {
        const ok = ops.putItemInInventory(player.inventory || [], clone(item), 1);
        if (ok) { droppedCountRef.count++; drops.push({ item_id: Number(item.id), item_name: String(item.name || ''), count: 1 }); }
      }
    }
  }

  const huashenChance = Math.min(1, 0.005 * dropMultiplier);
  if (
    droppedCountRef.count < maxDrops
    && (Number(enemy.level) || 1) >= 241 && (Number(enemy.level) || 1) <= 280
    && ['beast', 'spirit'].includes(String(enemy.type || ''))
    && Math.random() <= huashenChance
  ) {
    const huashen = getItemById(121);
    if (huashen && Object.keys(huashen).length > 0) {
      const ok = ops.putItemInInventory(player.inventory || [], clone(huashen), 1);
      if (ok) { droppedCountRef.count++; drops.push({ item_id: 121, item_name: String(huashen.name || ''), count: 1 }); }
    }
  }

  return { drops, dropMultiplier };
}

function settleTechAndSkillExp(player, totalDamage) {
  if (!player || totalDamage <= 0) return { technique_ups: [], skill_ups: [], unlocked_skills: [] };
  const techniqueUps = [];
  const skillUps = [];
  const unlockedSkills = [];
  const techs = player.techniques && typeof player.techniques === 'object' ? player.techniques : {};
  const tl = player.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};

  const slots = [{ key: 'main', rate: 0.01 }, { key: 'sub', rate: 0.005 }];
  for (const slot of slots) {
    const raw = techs[slot.key];
    const tid = (raw && typeof raw === 'object' && raw.id != null) ? intVal(raw.id, 0) : intVal(raw, 0);
    if (tid <= 0) continue;
    const techData = getTechniqueById(tid);
    if (!techData || !techData.id) continue;
    const key = String(tid);
    if (!tl[key]) tl[key] = { level: 1, exp: 0 };
    const ld = tl[key];
    const techCap = Math.max(1, intVal(techData.levelCap, 99));
    if (intVal(ld.level, 1) > techCap) { ld.level = techCap; ld.exp = 0; }
    const expGain = Math.floor(totalDamage * slot.rate);
    if (intVal(ld.level, 1) >= techCap) { ld.exp = 0; tl[key] = ld; continue; }
    if (expGain > 0) ld.exp = numVal(ld.exp, 0) + expGain;
    const baseExp = intVal(techData.baseExp, 100);
    let leveled = false;
    while (true) {
      if (intVal(ld.level, 1) >= techCap) { ld.exp = 0; break; }
      const lvNow = intVal(ld.level, 1);
      const req = baseExp * lvNow;
      if (numVal(ld.exp, 0) < req) break;
      ld.exp = numVal(ld.exp, 0) - req;
      ld.level = lvNow + 1;
      leveled = true;
    }
    tl[key] = ld;
    if (leveled) techniqueUps.push({ id: tid, name: techData.name, level: ld.level });
  }

  const sl = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  const equipped = Array.isArray(player.equipped_skills) ? player.equipped_skills : [];
  const usedSet = new Set(equipped.map(Number));
  for (const sid of usedSet) {
    if (sid <= 0) continue;
    const skill = getSkillById(sid);
    if (!skill || !skill.id) continue;
    const key = String(sid);
    if (!sl[key]) continue;
    const sd = sl[key];
    const cap = Math.max(1, intVal(skill.levelCap, 6));
    if (intVal(sd.level, 1) >= cap) continue;
    const baseExp = intVal(skill.baseExp, 150);
    const expGain = Math.floor(totalDamage * 0.005);
    if (expGain > 0) sd.exp = numVal(sd.exp, 0) + expGain;
    let leveled = false;
    while (true) {
      if (intVal(sd.level, 1) >= cap) { sd.exp = 0; break; }
      const lvNow = intVal(sd.level, 1);
      const req = baseExp * lvNow;
      if (numVal(sd.exp, 0) < req) break;
      sd.exp = numVal(sd.exp, 0) - req;
      sd.level = lvNow + 1;
      leveled = true;
    }
    sl[key] = sd;
    if (leveled) skillUps.push({ id: sid, name: skill.name, level: sd.level });
  }

  player.technique_levels = tl;
  player.skill_levels = sl;
  return { technique_ups: techniqueUps, skill_ups: skillUps, unlocked_skills: unlockedSkills };
}

/**
 * 主入口：模拟离线战斗
 * 八倍时间 + 万能时间一次性折入：前 N 场战斗享受 8x 经验/爆率加成
 * @param {object} player - 玩家对象（会被直接修改）
 * @param {number} offlineSeconds - 离线秒数
 * @returns {object} 离线战报摘要
 */
function simulateOfflineBattles(player, offlineSeconds) {
  if (!player || offlineSeconds < 60) return null;

  const mapId = intVal(player.current_map_id, 1);
  const map = getMapById(mapId);
  if (!map || !map.enemies || map.enemies.length === 0) return null;

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  recalcAndAssignCombatStats(player, true);

  const offlineSec = Math.min(offlineSeconds, MAX_OFFLINE_SECONDS);
  const restTime = calculateRestTime(intVal(player.level, 1));
  const TICK_REAL_TIME = 1.2;
  const BATTLE_OVERHEAD = 2;

  // 折算八倍时间 + 万能时间（先读取，循环结束后再清零，防止中途异常丢失buff）
  const ts = player.time_state || {};
  const octSec = Math.max(0, Number(ts.oct_seconds) || 0);
  const octPaused = Boolean(ts.oct_paused);
  const uniSec = Math.max(0, Number(ts.universal_time_seconds) || 0);
  const EXCHANGE_RATIO = 8;
  const effectiveOct = octPaused ? 0 : octSec;
  const totalBoostedSec = effectiveOct + Math.floor(uniSec / EXCHANGE_RATIO);

  const baseExpBuff = Math.max(0, Number(ops.getTimedBuffValue(player, 'exp_gain_pct')) || 0);
  const baseDropBuff = Math.max(0, Number(ops.getTimedBuffValue(player, 'drop_rate_pct')) || 0);

  let totalExp = 0;
  let totalSpirit = 0;
  let totalDamage = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let boostedWins = 0;
  const dropCounts = {};

  const startHp = intVal(player.hp, player.max_hp || 100);
  const startMp = intVal(player.mp, player.max_mp || 50);
  let currentHp = startHp;
  let currentMp = startMp;

  let elapsedSec = 0;
  let boostedElapsed = 0;

  while (elapsedSec < offlineSec && (wins + losses + draws) < MAX_BATTLES_PER_SESSION) {
    player.hp = currentHp;
    player.mp = currentMp;

    const result = runSingleBattle(player, mapId);
    if (!result) break;

    const { state, enemy, victory, draw, turns } = result;
    const battleTimeSec = Math.ceil(turns * TICK_REAL_TIME) + BATTLE_OVERHEAD;

    const isBoosted = boostedElapsed < totalBoostedSec;
    const expBuff = baseExpBuff + (isBoosted ? 7.0 : 0);
    const dropBuff = baseDropBuff + (isBoosted ? 7.0 : 0);

    const battleDamage = numVal(state._total_player_damage, 0);
    totalDamage += battleDamage;

    let thisCycleTime;
    if (victory) {
      wins++;
      if (isBoosted) boostedWins++;
      thisCycleTime = battleTimeSec;
      const enlightenmentMult = ops.getEnlightenmentExpMult ? ops.getEnlightenmentExpMult(player) : 1;
      const baseExp = Math.floor(Number(enemy.exp) || 10);
      const exp = Math.floor(baseExp * (1.0 + expBuff) * enlightenmentMult);
      totalExp += exp;

      const settled = settleOfflineDrops(player, enemy, dropBuff, map);
      for (const d of settled.drops) {
        const key = String(d.item_id);
        if (dropCounts[key]) dropCounts[key].count += d.count;
        else dropCounts[key] = { item_id: d.item_id, item_name: d.item_name, count: d.count };
      }

      const spiritTier = calcSpiritTier(enemy.level);
      const spiritMinMult = 0.3 + spiritTier;
      const spiritMaxMult = 1.0 + spiritTier;
      const spiritMult = spiritMinMult + Math.random() * (spiritMaxMult - spiritMinMult);
      const type = String(enemy.type || '');
      let spiritGain = 0;
      if (type === 'human') {
        const lv = Number(enemy.level) || 1;
        const base = Math.max(1, Math.floor(lv * 0.2)) + Math.floor(Math.random() * Math.max(1, Math.floor(lv * 1.6)));
        spiritGain = Math.max(1, Math.floor(base * spiritMult * settled.dropMultiplier));
      } else if (type === 'spirit') {
        const lv = Number(enemy.level) || 1;
        const base = Math.max(1, Math.floor(lv * 0.3)) + Math.floor(Math.random() * Math.max(1, Math.floor(lv * 2.4)));
        spiritGain = Math.max(1, Math.floor(base * spiritMult * settled.dropMultiplier));
      }
      spiritGain = Math.max(0, Math.floor(spiritGain / 20));
      totalSpirit += spiritGain;

      let finalHp = Math.max(0, intVal(state.player.hp, 0));
      const maxHp = Math.max(1, intVal(state.player.max_hp || player.max_hp, 1));
      const victoryHealPct = getBattleVictoryHealPercent(player);
      if (victoryHealPct > 0) {
        const passiveEff = calcAllPassiveEffects(player);
        const srBonus = calcSpiritRootBonuses(player?.spirit_roots, passiveEff);
        let bonus = Math.max(0, Math.floor(maxHp * victoryHealPct / 100));
        bonus = Math.floor(bonus * (1.0 + numVal(srBonus.heal_bonus, 0)));
        finalHp = Math.min(maxHp, finalHp + bonus);
      }
      currentHp = finalHp;
      currentMp = Math.max(0, intVal(state.player.mp, 0));
    } else if (draw) {
      draws++;
      thisCycleTime = battleTimeSec;
      currentHp = Math.max(0, intVal(state?.player?.hp, currentHp));
      currentMp = Math.max(0, intVal(state?.player?.mp, currentMp));
    } else {
      losses++;
      thisCycleTime = battleTimeSec + restTime;
      currentHp = intVal(player.max_hp, 100);
      currentMp = intVal(player.max_mp, 50);
    }

    elapsedSec += thisCycleTime;
    if (isBoosted) boostedElapsed += thisCycleTime;
  }

  // 战斗循环完成后再消耗 buff 时间和写入奖励，保证原子性
  if (ts) {
    ts.oct_seconds = 0;
    ts.universal_time_seconds = 0;
    ts.oct_paused = false;
    player.time_state = ts;
  }

  player.exp = Math.floor((Number(player.exp) || 0) + totalExp);
  player.spirit_stones = Math.floor((Number(player.spirit_stones) || 0) + totalSpirit);
  player.hp = currentHp;
  player.mp = currentMp;

  const expResult = settleTechAndSkillExp(player, totalDamage);

  const dropSummary = Object.values(dropCounts).sort((a, b) => b.count - a.count);

  return {
    offline_seconds: offlineSec,
    battles: wins + losses + draws,
    wins,
    losses,
    draws,
    win_rate: wins + losses + draws > 0 ? Math.round(wins / (wins + losses + draws) * 100) : 0,
    boosted_battles: boostedWins,
    boosted_wins: boostedWins,
    exp_gained: totalExp,
    spirit_gained: totalSpirit,
    drops: dropSummary,
    technique_ups: expResult.technique_ups,
    skill_ups: expResult.skill_ups,
    unlocked_skills: expResult.unlocked_skills
  };
}

module.exports = { simulateOfflineBattles };
