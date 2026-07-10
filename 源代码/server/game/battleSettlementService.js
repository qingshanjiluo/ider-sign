const dbAsync = require('../dbAsync');
const { getEnemyById, getMapById, getItemById, getItems, getDungeonEnemyById, getSkillById, getTechniqueById } = require('./dataLoader');
const ops = require('./playerOps');
const cave = require('./cave');
const { getBattleVictoryHealPercent, calcSpiritRootBonuses, calcAllPassiveEffects } = require('./combatUtils');
const { touchActivity } = require('./universalTime');
const { settleKillTaskProgress } = require('../routes/online');
const { calculateRestTime } = require('./battleTiming');
const { isNightmareMap } = require('./battleEncounterFactory');
const { isLingjieMap, getLingjieRewardBonus } = require('./lingjie');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const NIGHTMARE_DROP_MULTIPLIER = 3.5;

function countItemInInventory(inv, itemId) {
  let total = 0;
  const target = intVal(itemId, 0);
  if (target <= 0) return 0;
  for (const page of (inv || [])) {
    if (!Array.isArray(page)) continue;
    for (const slot of page) {
      if (!slot || typeof slot !== 'object' || !slot.item) continue;
      if (intVal(slot.item.id, 0) !== target) continue;
      total += Math.max(1, intVal(slot.count, 1));
    }
  }
  return total;
}

function calcExpToNext(currentLevel, baseExp) {
  return Math.floor(baseExp * Math.pow(1.5, currentLevel - 1));
}

function applyTechniqueSkillUnlocks(player, techniqueId, techniqueLevel) {
  const unlocked = [];
  const tid = intVal(techniqueId, 0);
  const lv = intVal(techniqueLevel, 0);
  if (!player || tid <= 0 || lv <= 0) return unlocked;
  const techData = getTechniqueById(tid);
  const unlocks = Array.isArray(techData?.skillUnlocks) ? techData.skillUnlocks : [];
  if (unlocks.length <= 0) return unlocked;
  player.skill_levels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  for (const u of unlocks) {
    const needLv = intVal(u?.level, 0);
    const sid = intVal(u?.skillId, 0);
    if (sid <= 0 || needLv <= 0 || lv < needLv) continue;
    const key = String(sid);
    if (player.skill_levels[key]) continue;
    const skillData = getSkillById(sid);
    if (!skillData || !skillData.id) continue;
    const tags = Array.isArray(skillData.tags) ? skillData.tags : [];
    if (tags.includes('enemySkill')) continue;
    player.skill_levels[key] = { level: 1, exp: 0 };
    unlocked.push({ id: sid, name: String(skillData.name || ''), unlock_level: needLv, by_technique_id: tid, by_technique_name: String(techData?.name || '') });
  }
  return unlocked;
}

function settleTechniqueAndSkillExp(player, state) {
  if (!state || !player) return { technique_ups: [], skill_ups: [], unlocked_skills: [] };
  const techniqueUps = [];
  const skillUps = [];
  const unlockedSkills = [];
  const totalDamage = numVal(state._total_player_damage, 0);
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
    if (intVal(ld.level, 1) > techCap) {
      ld.level = techCap;
      ld.exp = 0;
    }
    const expGain = Math.floor(totalDamage * slot.rate);
    if (intVal(ld.level, 1) >= techCap) {
      ld.exp = 0;
      tl[key] = ld;
      const unlockedNow = applyTechniqueSkillUnlocks(player, tid, intVal(ld.level, 1));
      if (unlockedNow.length > 0) unlockedSkills.push(...unlockedNow);
      continue;
    }
    if (expGain > 0) ld.exp = numVal(ld.exp, 0) + expGain;
    const baseExp = intVal(techData.baseExp, 100);
    let leveled = false;
    while (true) {
      if (intVal(ld.level, 1) >= techCap) {
        ld.exp = 0;
        break;
      }
      const needed = calcExpToNext(intVal(ld.level, 1), baseExp);
      if (ld.exp >= needed && needed > 0) {
        ld.exp -= needed;
        ld.level = intVal(ld.level, 1) + 1;
        leveled = true;
      } else break;
    }
    if (leveled) techniqueUps.push({ id: tid, name: String(techData.name || ''), level: ld.level });
    tl[key] = ld;
    const unlockedNow = applyTechniqueSkillUnlocks(player, tid, intVal(ld.level, 1));
    if (unlockedNow.length > 0) unlockedSkills.push(...unlockedNow);
  }
  player.technique_levels = tl;

  const slBase = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  for (const sidKey of Object.keys(slBase)) {
    const id = intVal(sidKey, 0);
    if (id <= 0) continue;
    const skillData = getSkillById(id);
    if (!skillData || !skillData.id) continue;
    const ld = slBase[sidKey] && typeof slBase[sidKey] === 'object' ? slBase[sidKey] : { level: 1, exp: 0 };
    const skillCap = Math.max(1, intVal(skillData.levelCap, 99));
    if (intVal(ld.level, 1) > skillCap) {
      ld.level = skillCap;
      ld.exp = 0;
    }
    if (intVal(ld.level, 1) < skillCap) {
      const baseExp = intVal(skillData.baseExp, 100);
      let leveled = false;
      while (true) {
        if (intVal(ld.level, 1) >= skillCap) {
          ld.exp = 0;
          break;
        }
        const needed = calcExpToNext(intVal(ld.level, 1), baseExp);
        if (numVal(ld.exp, 0) >= needed && needed > 0) {
          ld.exp = numVal(ld.exp, 0) - needed;
          ld.level = intVal(ld.level, 1) + 1;
          leveled = true;
        } else break;
      }
      if (leveled) skillUps.push({ id, name: String(skillData.name || ''), level: ld.level });
    } else {
      ld.exp = 0;
    }
    slBase[sidKey] = ld;
  }
  player.skill_levels = slBase;

  const usedSkills = state._used_skill_ids;
  if (Array.isArray(usedSkills) && usedSkills.length > 0) {
    const sl = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
    const seen = new Set();
    for (const sid of usedSkills) {
      const id = intVal(sid, 0);
      if (id <= 0 || seen.has(id)) continue;
      seen.add(id);
      const skillData = getSkillById(id);
      if (!skillData || !skillData.id) continue;
      const key = String(id);
      if (!sl[key]) continue;
      const ld = sl[key];
      const skillCap = Math.max(1, intVal(skillData.levelCap, 99));
      if (intVal(ld.level, 1) > skillCap) {
        ld.level = skillCap;
        ld.exp = 0;
      }
      if (intVal(ld.level, 1) >= skillCap) {
        ld.exp = 0;
        sl[key] = ld;
        continue;
      }
      const count = usedSkills.filter(x => intVal(x, 0) === id).length;
      ld.exp = numVal(ld.exp, 0) + 10 * count;
      const baseExp = intVal(skillData.baseExp, 100);
      let leveled = false;
      while (true) {
        if (intVal(ld.level, 1) >= skillCap) {
          ld.exp = 0;
          break;
        }
        const needed = calcExpToNext(intVal(ld.level, 1), baseExp);
        if (ld.exp >= needed && needed > 0) {
          ld.exp -= needed;
          ld.level = intVal(ld.level, 1) + 1;
          leveled = true;
        } else break;
      }
      if (leveled) skillUps.push({ id, name: String(skillData.name || ''), level: ld.level });
      sl[key] = ld;
    }
    player.skill_levels = sl;
  }
  return { technique_ups: techniqueUps, skill_ups: skillUps, unlocked_skills: unlockedSkills };
}

function clone(v) {
  return structuredClone(v);
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length <= 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  return 5;
}

function generateRandomEquipmentForLevel(level) {
  const targetQuality = mapEnemyLevelToDropQuality(level);
  const allowTypes = new Set(['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);
  const pool = (getItems() || []).filter((i) => {
    if (!i || !allowTypes.has(String(i.type || ''))) return false;
    if (i.tags && Array.isArray(i.tags) && i.tags.includes('no_dungeon_loot')) return false;
    const q = Number(i.quality) || 1;
    return q >= Math.max(1, targetQuality - 1) && q <= targetQuality;
  });
  const selected = pick(pool);
  return selected ? clone(selected) : null;
}

const MATERIAL_TYPES = new Set(['material', 'herb', 'medicine']);
const WILD_RUNE_ITEM_IDS = [208, 209, 210, 211, 212, 213, 214, 215];
const WILD_RUNE_DROP_CHANCE_BY_STAGE = [0.00001, 0.00005, 0.00012, 0.00022, 0.00035, 0.0005];
const ZAOHUA_ORB_ITEM_ID = 239;
const LINGJIE_ZAOHUA_ORB_DROP_CHANCE = 0.0004;
const _lingjieMaterialPools = new Map();

function getRealmStageByLevel(level) {
  const lv = Math.max(1, intVal(level, 1));
  if (lv <= 120) return 0;
  if (lv <= 160) return 1;
  if (lv <= 200) return 2;
  if (lv <= 240) return 3;
  if (lv <= 280) return 4;
  return 5;
}

function getWildRuneDropChanceByMapId(mapId, fallbackEnemyLevel = 1) {
  const map = getMapById(intVal(mapId, 0));
  const level = map && typeof map === 'object'
    ? Math.max(1, intVal(map.level, intVal(fallbackEnemyLevel, 1)))
    : Math.max(1, intVal(fallbackEnemyLevel, 1));
  const stage = getRealmStageByLevel(level);
  return WILD_RUNE_DROP_CHANCE_BY_STAGE[Math.max(0, Math.min(WILD_RUNE_DROP_CHANCE_BY_STAGE.length - 1, stage))] || 0;
}

function getLingjieMaterialPool(minQuality = 6, maxQuality = 99) {
  const minQ = Math.max(1, intVal(minQuality, 1));
  const maxQ = Math.max(minQ, intVal(maxQuality, minQ));
  const cacheKey = `${minQ}-${maxQ}`;
  if (_lingjieMaterialPools.has(cacheKey)) return _lingjieMaterialPools.get(cacheKey);
  const pool = (getItems() || []).filter((item) => {
    if (!item || !MATERIAL_TYPES.has(String(item.type || ''))) return false;
    const quality = intVal(item.quality, 0);
    if (quality < minQ || quality > maxQ) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return !tags.includes('no_dungeon_loot') && !tags.includes('invite_shop_only') && !tags.includes('gm_only');
  }).map((item) => intVal(item.id, 0)).filter((id) => id > 0);
  _lingjieMaterialPools.set(cacheKey, pool);
  return pool;
}

function isLingjieMaterialEligibleLevel(level) {
  return intVal(level, 0) > 0;
}

function getLingjieMaterialPoolByPlayerLevel(level) {
  const lv = intVal(level, 0);
  if (lv <= 120) return getLingjieMaterialPool(1, 1);
  if (lv <= 160) return getLingjieMaterialPool(2, 2);
  if (lv <= 200) return getLingjieMaterialPool(3, 3);
  if (lv <= 240) return getLingjieMaterialPool(4, 4);
  if (lv <= 280) return getLingjieMaterialPool(5, 5);
  if (lv <= 320) return getLingjieMaterialPool(6, 6);
  if (lv <= 360) {
    const pool = getLingjieMaterialPool(6, 7);
    return pool.length > 0 ? pool : getLingjieMaterialPool(6, 6);
  }
  const highPool = getLingjieMaterialPool(7, 99);
  if (highPool.length > 0) return highPool;
  const fallbackPool = getLingjieMaterialPool(6, 7);
  return fallbackPool.length > 0 ? fallbackPool : getLingjieMaterialPool(6, 6);
}

function tryAddDrop(player, item, drops, droppedCountRef, maxDrops, materialDropsForOffline = null) {
  if (!item || droppedCountRef.count >= maxDrops) return false;
  const itemType = String(item.type || '');
  if (materialDropsForOffline && MATERIAL_TYPES.has(itemType)) {
    const eid = Number(item.id) || 0;
    const idx = materialDropsForOffline.findIndex((d) => intVal(d.item_id, 0) === eid);
    if (idx >= 0) materialDropsForOffline[idx].count += 1;
    else materialDropsForOffline.push({ item_id: eid, item_name: String(item.name || '未知物品'), count: 1 });
  }
  const ok = ops.putItemInInventory(player.inventory || [], item, 1);
  if (!ok) return false;
  droppedCountRef.count += 1;
  drops.push({
    item_id: Number(item.id) || 0,
    item_name: String(item.name || '未知物品'),
    count: 1
  });
  return true;
}

function tryAddIndependentDrop(player, item, drops, materialDropsForOffline = null) {
  if (!item) return false;
  const itemType = String(item.type || '');
  if (materialDropsForOffline && MATERIAL_TYPES.has(itemType)) {
    const eid = Number(item.id) || 0;
    const idx = materialDropsForOffline.findIndex((d) => intVal(d.item_id, 0) === eid);
    if (idx >= 0) materialDropsForOffline[idx].count += 1;
    else materialDropsForOffline.push({ item_id: eid, item_name: String(item.name || '未知物品'), count: 1 });
  }
  const ok = ops.putItemInInventory(player.inventory || [], item, 1);
  if (!ok) return false;
  const itemId = Number(item.id) || 0;
  const dropIdx = drops.findIndex((d) => intVal(d?.item_id, 0) === itemId);
  if (dropIdx >= 0) drops[dropIdx].count = intVal(drops[dropIdx].count, 0) + 1;
  else drops.push({ item_id: itemId, item_name: String(item.name || '未知物品'), count: 1 });
  return true;
}

function settleDrops(player, enemy, dropBuff, enemySource = 'wild', mapInfo = null) {
  const drops = [];
  const materialDropsForOffline = [];
  const dropMultiplier = Math.max(0, (Number(enemy.drop_multiplier) || 1) * (1 + Math.max(0, Number(dropBuff) || 0)));
  const droppedCountRef = { count: 0 };
  const maxDrops = 3;
  const mapId = intVal(mapInfo?.id, 0);
  const lingjieRewards = getLingjieRewardBonus(mapInfo);

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
      tryAddDrop(player, clone(item), drops, droppedCountRef, maxDrops, materialDropsForOffline);
    }
  }

  if (droppedCountRef.count < maxDrops && ['human', 'spirit', 'undead'].includes(String(enemy.type || ''))) {
    const eqChance = Math.min(1, 0.003 * dropMultiplier);
    if (Math.random() <= eqChance) {
      const eq = generateRandomEquipmentForLevel(enemy.level);
      if (eq) tryAddDrop(player, eq, drops, droppedCountRef, maxDrops, materialDropsForOffline);
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
        tryAddDrop(player, clone(item), drops, droppedCountRef, maxDrops, materialDropsForOffline);
      }
    }
    if (available.length > 0 && Math.random() <= beastChance2 && droppedCountRef.count < maxDrops) {
      const item = getItemById(pick(available));
      if (item && Object.keys(item).length > 0) {
        tryAddDrop(player, clone(item), drops, droppedCountRef, maxDrops, materialDropsForOffline);
      }
    }
  }

  const huashenChance = Math.min(1, 0.005 * dropMultiplier);
  if (
    droppedCountRef.count < maxDrops
    && (Number(enemy.level) || 1) >= 241
    && (Number(enemy.level) || 1) <= 280
    && ['beast', 'spirit'].includes(String(enemy.type || ''))
    && Math.random() <= huashenChance
  ) {
    const huashen = getItemById(121);
    if (huashen && Object.keys(huashen).length > 0) {
      tryAddDrop(player, clone(huashen), drops, droppedCountRef, maxDrops, materialDropsForOffline);
    }
  }

  const wildRuneChance = getWildRuneDropChanceByMapId(mapId, intVal(enemy?.level, 1));
  const finalRuneChance = wildRuneChance * Math.max(0, numVal(lingjieRewards.rune_drop_mult, 1));
  if (String(enemySource || 'wild') === 'wild' && finalRuneChance > 0 && Math.random() <= finalRuneChance) {
    const runeId = pick(WILD_RUNE_ITEM_IDS);
    const rune = getItemById(Number(runeId) || 0);
    if (rune && Object.keys(rune).length > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const stored = cave.addFormationItems(player, clone(rune), 1, nowSec);
      if (stored?.ok && intVal(stored.added, 0) > 0) {
        const itemId = Number(rune.id) || 0;
        const idx = drops.findIndex((d) => intVal(d?.item_id, 0) === itemId);
        if (idx >= 0) drops[idx].count = intVal(drops[idx].count, 0) + intVal(stored.added, 1);
        else drops.push({ item_id: itemId, item_name: String(rune.name || '阵纹'), count: intVal(stored.added, 1) });
      }
    }
  }

  if (isLingjieMap(mapInfo) && isLingjieMaterialEligibleLevel(player?.level)) {
    const pool = getLingjieMaterialPoolByPlayerLevel(player?.level);
    const extraChance = Math.min(1, 0.018 * dropMultiplier * Math.max(0, numVal(lingjieRewards.tier6_drop_mult, 1)));
    if (pool.length > 0 && droppedCountRef.count < maxDrops && Math.random() <= extraChance) {
      const item = getItemById(pick(pool));
      if (item && Object.keys(item).length > 0) {
        tryAddDrop(player, clone(item), drops, droppedCountRef, maxDrops, materialDropsForOffline);
      }
    }
  }

  if (
    String(enemySource || 'wild') === 'wild'
    && isLingjieMap(mapInfo)
    && intVal(player?.level, 0) >= 281
    && Math.random() <= LINGJIE_ZAOHUA_ORB_DROP_CHANCE
  ) {
    const orb = getItemById(ZAOHUA_ORB_ITEM_ID);
    if (orb && Object.keys(orb).length > 0) {
      tryAddIndependentDrop(player, clone(orb), drops, materialDropsForOffline);
    }
  }

  return { drops, dropMultiplier, materialDropsForOffline };
}

function _normalizeBattleOutcome(outcomeLike) {
  if (outcomeLike && typeof outcomeLike === 'object') {
    return {
      victory: Boolean(outcomeLike.victory),
      draw: Boolean(outcomeLike.draw)
    };
  }
  return {
    victory: Boolean(outcomeLike),
    draw: false
  };
}

async function finalizeBattle(session, state, outcomeLike) {
  const player = await dbAsync.getPlayerByAccountId(session.account_id, { noClone: true });
  if (!player) return { ok: false, error: '角色不存在' };
  cave.settleMainFormationServices(player, Math.floor(Date.now() / 1000), { allowAutoActivate: true });
  const source = String(session?.state?.enemy_source || 'wild');
  const mapInfo = getMapById(intVal(session?.map_id, intVal(state?.player?.current_map_id, 0)));
  const nightmareMap = isNightmareMap(mapInfo);
  const lingjieRewards = getLingjieRewardBonus(mapInfo);
  const wildFormationMods = cave.getFormationWildBattleModifiers(player);
  const enemy = source === 'dungeon' ? getDungeonEnemyById(session.enemy_id) : getEnemyById(session.enemy_id);
  if (!enemy || !enemy.id) return { ok: false, error: '敌人数据异常' };
  const outcome = _normalizeBattleOutcome(outcomeLike);
  const victory = outcome.victory;
  const draw = outcome.draw;
  const nowSec = Math.floor(Date.now() / 1000);
  const durationSec = Math.max(0, nowSec - Math.floor(Number(session.started_at || 0)));
  const cmdCount = Math.max(1, Number(session.last_seq) || 1);
  const minExpectedSec = Math.floor(cmdCount * 0.25);
  const speedHackDetected = state?.server_driven ? false : (durationSec < minExpectedSec * 0.5);
  if (speedHackDetected) {
    console.warn('[anti-speedhack] accountId=%s cmds=%d duration=%ds expected>=%ds',
      session.account_id, cmdCount, durationSec, minExpectedSec);
  }
  let expGain = 0;
  let spiritGain = 0;
  let expBaseEstimate = 0;
  let spiritBaseEstimate = 0;
  let drops = [];
  let settled = null;
  const expBuff = Math.max(0, Number(ops.getTimedBuffValue(player, 'exp_gain_pct')) || 0);
  const spiritBuff = Math.max(0, Number(ops.getTimedBuffValue(player, 'spirit_gain_pct')) || 0);
  const dropBuff = Math.max(0, Number(ops.getTimedBuffValue(player, 'drop_rate_pct')) || 0);

  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  const consumedMap = state?.player?._consumed_items;
  if (consumedMap && typeof consumedMap === 'object' && !Array.isArray(consumedMap)) {
    for (const [k, v] of Object.entries(consumedMap)) {
      const itemId = intVal(k, 0);
      const need = Math.max(0, intVal(v, 0));
      if (itemId <= 0 || need <= 0) continue;
      const have = countItemInInventory(player.inventory, itemId);
      const apply = Math.min(have, need);
      if (apply > 0) ops.consumeItemFromInventory(player.inventory, itemId, apply);
    }
  }

  if (victory && !speedHackDetected) {
    const baseExp = Math.floor(Number(enemy.exp) || 10);
    const enlightenmentMult = ops.getEnlightenmentExpMult ? ops.getEnlightenmentExpMult(player) : 1;
    const wildExpMult = source === 'wild'
      ? (1.0 + Math.max(0, numVal(wildFormationMods?.wild_exp_bonus_pct, 0)))
      : 1.0;
    const mapExpMult = source === 'wild' ? Math.max(0, numVal(lingjieRewards.exp_mult, 1)) : 1.0;
    expGain = Math.floor(baseExp * (1.0 + expBuff) * enlightenmentMult * wildExpMult * mapExpMult);
    const expMultiplier = Math.max(1e-9, (1.0 + expBuff) * enlightenmentMult * wildExpMult * mapExpMult);
    expBaseEstimate = Math.max(0, expGain / expMultiplier);
    const wildDropMult = source === 'wild'
      ? Math.max(0, numVal(wildFormationMods?.wild_drop_rate_mult, 1))
      : 1.0;
    const mapDropMult = source === 'wild' ? Math.max(0, numVal(lingjieRewards.drop_mult, 1)) : 1.0;
    const nightmareDropMult = (source === 'wild' && nightmareMap) ? NIGHTMARE_DROP_MULTIPLIER : 1.0;
    const finalDropBuff = source === 'wild'
      ? ((1.0 + Math.max(0, numVal(dropBuff, 0))) * wildDropMult * nightmareDropMult * mapDropMult - 1.0)
      : dropBuff;
    settled = settleDrops(player, enemy, finalDropBuff, source, mapInfo);
    drops = settled.drops;
    const spiritTier = calcSpiritTier(enemy.level);
    const spiritMinMult = 0.3 + spiritTier;
    const spiritMaxMult = 1.0 + spiritTier;
    const spiritMult = spiritMinMult + Math.random() * (spiritMaxMult - spiritMinMult);
    const type = String(enemy.type || '');
    if (type === 'human') {
      const lv = Number(enemy.level) || 1;
      const minBase = Math.max(1, Math.floor(lv * 0.2));
      const maxBase = Math.max(minBase, Math.floor(lv * 1.8));
      const base = minBase + Math.floor(Math.random() * (maxBase - minBase + 1));
      spiritGain = Math.max(1, Math.floor(base * spiritMult * settled.dropMultiplier));
    } else if (type === 'spirit') {
      const lv = Number(enemy.level) || 1;
      const minBase = Math.max(1, Math.floor(lv * 0.3));
      const maxBase = Math.max(minBase, Math.floor(lv * 2.7));
      const base = minBase + Math.floor(Math.random() * (maxBase - minBase + 1));
      spiritGain = Math.max(1, Math.floor(base * spiritMult * settled.dropMultiplier));
    }
    if (source === 'wild' && spiritGain > 0) {
      spiritGain = Math.max(0, Math.floor(spiritGain / 20));
    }
    if (spiritGain > 0 && source === 'wild') {
      spiritGain = Math.max(0, Math.floor(spiritGain * Math.max(0, numVal(lingjieRewards.spirit_stone_mult, 1))));
    }
    const spiritMultiplier = Math.max(1e-9, numVal(settled?.dropMultiplier, 1));
    spiritBaseEstimate = Math.max(0, spiritGain / spiritMultiplier);
  }

  if (victory && !speedHackDetected) settleKillTaskProgress(player, Number(enemy.id) || 0);
  const pLv = intVal(player.level, 1);
  const eLv = intVal(enemy.level, 1);
  if (victory && !speedHackDetected && pLv >= 161 && pLv <= 200 && eLv > pLv) {
    player.breakthrough_nascent_kill_count = (Number(player.breakthrough_nascent_kill_count) || 0) + 1;
  }
  const abnormalRepay = ops.consumeAbnormalGainRepay(player, {
    exp: expGain,
    spirit_stones: spiritGain
  });
  expGain = Math.max(0, intVal(abnormalRepay.exp, 0));
  spiritGain = Math.max(0, intVal(abnormalRepay.spirit_stones, 0));
  player.exp = Math.floor((Number(player.exp) || 0) + expGain);
  player.spirit_stones = Math.floor((Number(player.spirit_stones) || 0) + spiritGain);

  const kurongSpent = Math.max(0, intVal(state?._abaddon_rebirth_spent, 0));
  if (kurongSpent > 0) {
    player.spirit_stones = Math.max(0, intVal(player.spirit_stones, 0) - kurongSpent);
  }

  if (state && state.player && typeof state.player === 'object') {
    if (victory) {
      let finalHp = Math.max(0, Math.floor(Number(state.player.hp) || 0));
      const maxHp = Math.max(1, intVal(state.player.max_hp || player.max_hp, 1));
      const victoryHealPct = getBattleVictoryHealPercent(player);
      if (victoryHealPct > 0) {
        const passiveEff = calcAllPassiveEffects(player);
        const srBonus = calcSpiritRootBonuses(player?.spirit_roots, passiveEff);
        let bonus = Math.max(0, Math.floor(maxHp * victoryHealPct / 100));
        bonus = Math.floor(bonus * (1.0 + numVal(srBonus.heal_bonus, 0)));
        finalHp = Math.min(maxHp, finalHp + bonus);
      }
      player.hp = finalHp;
      player.mp = Math.max(0, Math.floor(Number(state.player.mp) || 0));
    } else if (draw) {
      player.hp = Math.max(1, Math.floor(Number(state.player.hp) || 1));
      player.mp = Math.max(0, Math.floor(Number(state.player.mp) || 0));
    } else {
      const maxHp = Math.max(1, intVal(player.max_hp, 1));
      const maxMp = Math.max(0, intVal(player.max_mp, 0));
      player.hp = maxHp;
      player.mp = maxMp;
      const restTime = calculateRestTime(player.level);
      player.rest_until = Math.floor(Date.now() / 1000) + Math.min(restTime, 25);
    }
    if (state.player.skill_cooldowns && typeof state.player.skill_cooldowns === 'object') {
      player.skill_cooldowns = structuredClone(state.player.skill_cooldowns);
    }
  } else if (!victory && !draw) {
    const maxHp = Math.max(1, intVal(player.max_hp, 1));
    const maxMp = Math.max(0, intVal(player.max_mp, 0));
    player.hp = maxHp;
    player.mp = maxMp;
    const restTime = calculateRestTime(player.level);
    player.rest_until = Math.floor(Date.now() / 1000) + Math.min(restTime, 25);
  }

  const rounds = Math.max(1, Math.floor(Number(state?.round) || 1));
  ops.consumeTimedBuffRounds(player, rounds);
  ops.cleanupTimedBuffs(player);
  touchActivity(player);
  const expResult = speedHackDetected
    ? { technique_ups: [], skill_ups: [], unlocked_skills: [] }
    : settleTechniqueAndSkillExp(player, state);
  await dbAsync.savePlayer(session.account_id, 1, player);

  const nowSecEnd = Math.floor(Date.now() / 1000);
  const restRemain = Math.max(0, intVal(player.rest_until, 0) - nowSecEnd);
  return {
    ok: true,
    player,
    rest_remaining_sec: restRemain,
    rewards: {
      exp: expGain,
      spirit_stones: spiritGain,
      abnormal_repay: {
        repaid_exp: Math.max(0, intVal(abnormalRepay.repaid_exp, 0)),
        repaid_spirit_stones: Math.max(0, intVal(abnormalRepay.repaid_spirit_stones, 0)),
        debt_exp_left: Math.max(0, intVal(abnormalRepay.debt_exp_left, 0)),
        debt_spirit_left: Math.max(0, intVal(abnormalRepay.debt_spirit_left, 0))
      },
      exp_base_est: expBaseEstimate,
      spirit_base_est: spiritBaseEstimate,
      drops,
      technique_ups: expResult.technique_ups,
      skill_ups: expResult.skill_ups,
      unlocked_skills: expResult.unlocked_skills
    }
  };
}

module.exports = {
  finalizeBattle,
  normalizeBattleOutcome: _normalizeBattleOutcome
};
