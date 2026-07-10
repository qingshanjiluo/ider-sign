const { getMapById, getEnemyById, getItemById } = require('./dataLoader');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function numVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const OFFLINE_HYBRID_ENABLED = String(process.env.OFFLINE_HYBRID_ENABLED || '1') !== '0';
const OFFLINE_REAL_SAMPLE_SEC = (() => {
  const env = Number(process.env.OFFLINE_REAL_SAMPLE_SEC);
  if (Number.isFinite(env) && env >= 60) return Math.min(6 * 3600, Math.floor(env));
  return 10 * 60;
})();
const OFFLINE_SAMPLE_ROUNDS_PER_RUN = (() => {
  const env = Number(process.env.OFFLINE_SAMPLE_ROUNDS_PER_RUN);
  if (Number.isFinite(env) && env >= 1) return Math.min(100, Math.floor(env));
  return 10;
})();
const OFFLINE_SAMPLE_MIN_BATTLES = (() => {
  const env = Number(process.env.OFFLINE_SAMPLE_MIN_BATTLES);
  if (Number.isFinite(env) && env >= 1) return Math.min(500, Math.floor(env));
  return 8;
})();
const OFFLINE_SAMPLE_SHRINK_ALPHA = (() => {
  const env = Number(process.env.OFFLINE_SAMPLE_SHRINK_ALPHA);
  if (Number.isFinite(env) && env >= 1) return Math.min(5000, Math.floor(env));
  return 40;
})();
const OFFLINE_WINRATE_SHRINK_RELIEF = (() => {
  const env = Number(process.env.OFFLINE_WINRATE_SHRINK_RELIEF);
  if (Number.isFinite(env)) return clamp(env, 0, 0.95);
  return 0.85;
})();
const OFFLINE_BASE_BATTLE_SEC = (() => {
  const env = Number(process.env.OFFLINE_BASE_BATTLE_SEC);
  if (Number.isFinite(env) && env > 0.2) return Math.min(120, env);
  return 8;
})();
const OFFLINE_MIN_BATTLE_SEC = (() => {
  const env = Number(process.env.OFFLINE_MIN_BATTLE_SEC);
  if (Number.isFinite(env) && env > 0.1) return Math.min(30, env);
  return 2;
})();
const OFFLINE_MAX_BATTLE_SEC = (() => {
  const env = Number(process.env.OFFLINE_MAX_BATTLE_SEC);
  if (Number.isFinite(env) && env > OFFLINE_MIN_BATTLE_SEC) return Math.min(600, env);
  return 35;
})();
const OFFLINE_BASE_WIN_RATE = (() => {
  const env = Number(process.env.OFFLINE_BASE_WIN_RATE);
  if (Number.isFinite(env)) return clamp(env, 0.05, 0.98);
  return 0.6;
})();
const OFFLINE_WIN_RATE_MIN = (() => {
  const env = Number(process.env.OFFLINE_WIN_RATE_MIN);
  if (Number.isFinite(env)) return clamp(env, 0, 0.95);
  return 0;
})();
const OFFLINE_WIN_RATE_MAX = (() => {
  const env = Number(process.env.OFFLINE_WIN_RATE_MAX);
  if (Number.isFinite(env)) return clamp(env, OFFLINE_WIN_RATE_MIN, 0.999);
  return 0.98;
})();
const OFFLINE_MAX_BATTLES_PER_SETTLE = (() => {
  const env = Number(process.env.OFFLINE_MAX_BATTLES_PER_SETTLE);
  if (Number.isFinite(env) && env >= 100) return Math.min(200000, Math.floor(env));
  return 50000;
})();
const OFFLINE_STAT_MAX_DELTA_SEC = (() => {
  const env = Number(process.env.OFFLINE_STAT_MAX_DELTA_SEC);
  if (Number.isFinite(env) && env >= 60) return Math.min(15 * 24 * 3600, Math.floor(env));
  return 48 * 3600;
})();
const NIGHTMARE_DROP_MULTIPLIER = 3.5;

function isNightmareMap(map) {
  if (!map || typeof map !== 'object') return false;
  if (map.is_nightmare === true) return true;
  const mapId = intVal(map.id, 0);
  if (mapId >= 10000) return true;
  const mapName = String(map.name || '');
  return mapName.startsWith('魇化');
}

function _randnBoxMuller() {
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = Math.random();
  while (v <= Number.EPSILON) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleBinomial(n, p) {
  const trials = Math.max(0, intVal(n, 0));
  const prob = clamp(numVal(p, 0), 0, 1);
  if (trials <= 0 || prob <= 0) return 0;
  if (prob >= 1) return trials;

  if (trials <= 2000) {
    let hit = 0;
    for (let i = 0; i < trials; i++) {
      if (Math.random() < prob) hit += 1;
    }
    return hit;
  }

  const mean = trials * prob;
  const variance = trials * prob * (1 - prob);
  const std = Math.sqrt(Math.max(0, variance));
  const sampled = Math.round(mean + std * _randnBoxMuller());
  return clamp(sampled, 0, trials);
}

const BEAST_TIER1_ITEMS = [20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10];
const BEAST_TIER2_ITEMS = [25, 26, 27, 28, 29, 4, 10, 62, 63, 64, 65, 66, 67];
const BEAST_TIER3_ITEMS = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70];
const BEAST_TIER4_ITEMS = [40, 41, 42, 43, 44, 71, 169, 178, 182];
const BEAST_TIER5_ITEMS = [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 121];
const WILD_RUNE_ITEM_IDS = [208, 209, 210, 211, 212, 213, 214, 215];
const WILD_RUNE_DROP_CHANCE_BY_STAGE = [0.00001, 0.00005, 0.00012, 0.00022, 0.00035, 0.0005];

function _getRealmStageByLevel(level) {
  const lv = Math.max(1, intVal(level, 1));
  if (lv <= 120) return 0; // 练气
  if (lv <= 160) return 1; // 筑基
  if (lv <= 200) return 2; // 金丹
  if (lv <= 240) return 3; // 元婴
  if (lv <= 280) return 4; // 化神
  return 5; // 炼虚及以上
}

function _getWildRuneDropChanceByLevel(level) {
  const stage = _getRealmStageByLevel(level);
  return WILD_RUNE_DROP_CHANCE_BY_STAGE[Math.max(0, Math.min(WILD_RUNE_DROP_CHANCE_BY_STAGE.length - 1, stage))] || 0;
}

function _calcSpiritTier(level) {
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

function _buildBeastPoolByLevel(level) {
  const lv = Number(level) || 1;
  if (lv <= 120) return BEAST_TIER1_ITEMS;
  if (lv <= 160) return BEAST_TIER2_ITEMS;
  if (lv <= 200) return BEAST_TIER3_ITEMS;
  if (lv <= 240) return BEAST_TIER4_ITEMS;
  return BEAST_TIER5_ITEMS;
}

function _buildMapEnemies(mapId) {
  const map = getMapById(intVal(mapId, 0));
  const enemyIds = Array.isArray(map?.enemies)
    ? map.enemies.map(x => intVal(x, 0)).filter(x => x > 0)
    : [];
  if (enemyIds.length <= 0) return [];
  return enemyIds.map(id => getEnemyById(id)).filter(e => e && intVal(e.id, 0) > 0);
}

function _addRate(rateMap, itemId, chance) {
  const iid = intVal(itemId, 0);
  const p = clamp(numVal(chance, 0), 0, 1);
  if (iid <= 0 || p <= 0) return;
  const old = numVal(rateMap.get(iid), 0);
  rateMap.set(iid, old + p);
}

function _expectedSpiritPerWin(enemy) {
  const e = enemy && typeof enemy === 'object' ? enemy : {};
  const type = String(e.type || '');
  const lv = Math.max(1, numVal(e.level, 1));
  if (type !== 'human' && type !== 'spirit') return 0;

  const tier = _calcSpiritTier(lv);
  const spiritMultAvg = 0.65 + tier;
  let minBase = 1;
  let maxBase = 1;

  if (type === 'human') {
    minBase = Math.max(1, Math.floor(lv * 0.2));
    maxBase = Math.max(minBase, Math.floor(lv * 1.8));
  } else {
    minBase = Math.max(1, Math.floor(lv * 0.3));
    maxBase = Math.max(minBase, Math.floor(lv * 2.7));
  }

  const baseAvg = (minBase + maxBase) / 2;
  // Wild battle settlement divides spirit gain by 20.
  return Math.max(0, (baseAvg * spiritMultAvg) / 20);
}

function buildMapDropRateTable(mapId) {
  const enemies = _buildMapEnemies(mapId);
  if (enemies.length <= 0) return [];

  const weight = 1 / enemies.length;
  const rateMap = new Map();
  const fallbackLv = enemies.reduce((mx, e) => Math.max(mx, intVal(e?.level, 1)), 1);
  const map = getMapById(intVal(mapId, 0));
  const mapLevel = map && typeof map === 'object'
    ? Math.max(1, intVal(map.level, fallbackLv))
    : fallbackLv;
  const wildRuneChance = _getWildRuneDropChanceByLevel(mapLevel);
  for (const enemy of enemies) {
    const rows = Array.isArray(enemy.drops) ? enemy.drops : [];
    for (const row of rows) {
      const itemId = intVal(row?.itemId, 0);
      const chance = clamp(numVal(row?.chance, 0), 0, 1);
      if (itemId <= 0 || chance <= 0) continue;
      _addRate(rateMap, itemId, chance * weight);
    }

    // Beast extra material pool in real battle settlement.
    if (String(enemy.type || '') === 'beast') {
      const pool = _buildBeastPoolByLevel(enemy.level);
      const n = pool.length;
      if (n > 0) {
        const perItem = ((0.03 / n) + (0.02 / n)) * weight;
        for (const itemId of pool) _addRate(rateMap, itemId, perItem);
      }
    }

    // Extra huashen item roll in real battle settlement.
    const lv = Number(enemy.level) || 1;
    const type = String(enemy.type || '');
    if (lv >= 241 && lv <= 280 && (type === 'beast' || type === 'spirit')) {
      _addRate(rateMap, 121, 0.005 * weight);
    }

  }

  // 野外阵纹额外掉落：按地图阶段递增（练气0.001%，炼虚及以上0.05%），等概率随机八卦位阵纹
  if (WILD_RUNE_ITEM_IDS.length > 0 && wildRuneChance > 0) {
    const perRuneChance = wildRuneChance / WILD_RUNE_ITEM_IDS.length;
    for (const rid of WILD_RUNE_ITEM_IDS) _addRate(rateMap, rid, perRuneChance);
  }

  const out = [];
  for (const [itemId, chanceRaw] of rateMap.entries()) {
    const chance = clamp(chanceRaw, 0, 1);
    if (chance <= 0) continue;
    const item = getItemById(itemId);
    if (!item || intVal(item.id, 0) <= 0) continue;
    out.push({
      item_id: intVal(item.id, 0),
      item_name: String(item.name || `物品${itemId}`),
      chance,
      item
    });
  }
  return out;
}

function buildMapRewardBaseline(mapId) {
  const enemies = _buildMapEnemies(mapId);
  if (enemies.length <= 0) {
    return {
      avg_exp_per_win: 0,
      avg_spirit_per_win: 0
    };
  }

  let expSum = 0;
  let spiritSum = 0;
  for (const enemy of enemies) {
    expSum += Math.max(0, numVal(enemy?.exp, 0));
    // 与去 buff 样本保持同口径：地图额外掉落倍率在应用阶段统一补回。
    spiritSum += _expectedSpiritPerWin(enemy);
  }

  return {
    avg_exp_per_win: Math.max(0, expSum / enemies.length),
    avg_spirit_per_win: Math.max(0, spiritSum / enemies.length)
  };
}

function rollDropsByWinCount(winCount, dropRates) {
  const wins = Math.max(0, intVal(winCount, 0));
  if (wins <= 0) return [];

  const out = [];
  for (const row of (Array.isArray(dropRates) ? dropRates : [])) {
    const p = clamp(numVal(row?.chance, 0), 0, 1);
    if (p <= 0) continue;
    const count = sampleBinomial(wins, p);
    if (count <= 0) continue;
    out.push({
      item_id: intVal(row.item_id, 0),
      item_name: String(row.item_name || `物品${intVal(row.item_id, 0)}`),
      count,
      item: row.item
    });
  }
  return out;
}

function buildProjectionFromProfile(profile, nowSec) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const now = intVal(nowSec, 0);
  if (now <= 0) {
    return {
      battles: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      exp_gain: 0,
      spirit_gain: 0,
      drops: [],
      settled_until: intVal(p.settled_until, 0),
      consumed_sec: 0,
      avg_battle_sec: OFFLINE_BASE_BATTLE_SEC,
      win_rate: OFFLINE_BASE_WIN_RATE
    };
  }

  const settledUntil = Math.max(0, intVal(p.settled_until, intVal(p.sample_end_at, now)));
  const deltaSec = Math.min(OFFLINE_STAT_MAX_DELTA_SEC, Math.max(0, now - settledUntil));
  if (deltaSec <= 0) {
    return {
      battles: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      exp_gain: 0,
      spirit_gain: 0,
      drops: [],
      settled_until: settledUntil,
      consumed_sec: 0,
      avg_battle_sec: OFFLINE_BASE_BATTLE_SEC,
      win_rate: OFFLINE_BASE_WIN_RATE
    };
  }

  const sampleBattles = Math.max(0, intVal(p.sample_battles, 0));
  const sampleWins = Math.max(0, intVal(p.sample_wins, 0));
  const sampleElapsed = Math.max(0, numVal(p.sample_elapsed_sec, 0));
  const hasDebiasedRewardSample = Object.prototype.hasOwnProperty.call(p, 'sample_exp_base_wins_sum')
    || Object.prototype.hasOwnProperty.call(p, 'sample_spirit_base_wins_sum');
  const sampleExpWinsRaw = Math.max(0, numVal(p.sample_exp_wins_sum, 0));
  const sampleSpiritWinsRaw = Math.max(0, numVal(p.sample_spirit_wins_sum, 0));
  const sampleExpWins = Math.max(0, numVal(p.sample_exp_base_wins_sum, sampleExpWinsRaw));
  const sampleSpiritWins = Math.max(0, numVal(p.sample_spirit_base_wins_sum, sampleSpiritWinsRaw));

  const sampleAvgBattleSec = sampleBattles > 0
    ? sampleElapsed / sampleBattles
    : OFFLINE_BASE_BATTLE_SEC;
  const sampleWinRate = sampleBattles > 0
    ? sampleWins / sampleBattles
    : OFFLINE_BASE_WIN_RATE;

  const trustWeight = sampleBattles >= OFFLINE_SAMPLE_MIN_BATTLES
    ? sampleBattles / (sampleBattles + OFFLINE_SAMPLE_SHRINK_ALPHA)
    : 0;

  // 高效率样本（单场耗时低于基线）使用更快收敛，避免离线场次长期被 8s 基线拖慢。
  const fastBattleAlpha = sampleAvgBattleSec <= OFFLINE_BASE_BATTLE_SEC
    ? Math.max(4, Math.floor(OFFLINE_SAMPLE_SHRINK_ALPHA * 0.35))
    : OFFLINE_SAMPLE_SHRINK_ALPHA;
  const battleSecTrustWeight = sampleBattles >= OFFLINE_SAMPLE_MIN_BATTLES
    ? sampleBattles / (sampleBattles + fastBattleAlpha)
    : 0;

  // 胜率采用动态收缩：样本胜率明显高于基线时，降低先验拉回力度。
  // 这样可避免“线上高稳定胜率”在离线投影中被固定 alpha 过度压低。
  let winTrustWeight = trustWeight;
  if (sampleBattles >= OFFLINE_SAMPLE_MIN_BATTLES && sampleBattles > 0) {
    const highWinBoost = clamp(
      (sampleWinRate - OFFLINE_BASE_WIN_RATE) / Math.max(0.05, OFFLINE_WIN_RATE_MAX - OFFLINE_BASE_WIN_RATE),
      0,
      1
    );
    const effectiveAlpha = Math.max(
      2,
      OFFLINE_SAMPLE_SHRINK_ALPHA * (1 - OFFLINE_WINRATE_SHRINK_RELIEF * highWinBoost)
    );
    winTrustWeight = sampleBattles / (sampleBattles + effectiveAlpha);
  }

  const avgBattleSec = clamp(
    OFFLINE_BASE_BATTLE_SEC * (1 - battleSecTrustWeight) + sampleAvgBattleSec * battleSecTrustWeight,
    OFFLINE_MIN_BATTLE_SEC,
    OFFLINE_MAX_BATTLE_SEC
  );

  // 低胜率样本不再向基线 60% 回拉，避免“样本失败但统计仍产出大量胜场”。
  let winRate = OFFLINE_BASE_WIN_RATE;
  if (sampleBattles >= OFFLINE_SAMPLE_MIN_BATTLES) {
    if (sampleWinRate <= OFFLINE_BASE_WIN_RATE) {
      winRate = sampleWinRate;
    } else {
      winRate = OFFLINE_BASE_WIN_RATE * (1 - winTrustWeight) + sampleWinRate * winTrustWeight;
    }
  }
  winRate = clamp(winRate, OFFLINE_WIN_RATE_MIN, OFFLINE_WIN_RATE_MAX);

  const battleCapByTime = Math.floor(deltaSec / Math.max(0.2, avgBattleSec));
  const battles = Math.max(0, Math.min(OFFLINE_MAX_BATTLES_PER_SETTLE, battleCapByTime));
  if (battles <= 0) {
    return {
      battles: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      exp_gain: 0,
      spirit_gain: 0,
      drops: [],
      settled_until: settledUntil,
      consumed_sec: 0,
      avg_battle_sec: avgBattleSec,
      win_rate: winRate
    };
  }

  const consumedSec = Math.max(1, Math.floor(battles * avgBattleSec));
  const nextSettledUntil = Math.min(now, settledUntil + consumedSec);
  const wins = sampleBinomial(battles, winRate);
  const losses = Math.max(0, battles - wins);

  const mapId = intVal(p.map_id, 0);
  const baseline = buildMapRewardBaseline(mapId);
  const baseExpPerWin = Math.max(0, numVal(baseline.avg_exp_per_win, 0));
  const baseSpiritPerWin = Math.max(0, numVal(baseline.avg_spirit_per_win, 0));

  const sampleAvgExpPerWin = sampleWins > 0 ? (sampleExpWins / sampleWins) : baseExpPerWin;
  const sampleAvgSpiritPerWin = sampleWins > 0 ? (sampleSpiritWins / sampleWins) : baseSpiritPerWin;
  const rewardAlpha = Math.max(4, Math.floor(OFFLINE_SAMPLE_SHRINK_ALPHA * 0.6));
  const rewardTrustWeight = (sampleWins > 0 && hasDebiasedRewardSample)
    ? (sampleWins / (sampleWins + rewardAlpha))
    : 0;

  const avgExpPerWin = Math.max(0, baseExpPerWin * (1 - rewardTrustWeight) + sampleAvgExpPerWin * rewardTrustWeight);
  const avgSpiritPerWin = Math.max(0, baseSpiritPerWin * (1 - rewardTrustWeight) + sampleAvgSpiritPerWin * rewardTrustWeight);

  const expGain = Math.max(0, Math.floor(wins * avgExpPerWin));
  const spiritGain = Math.max(0, Math.floor(wins * avgSpiritPerWin));

  const dropRates = buildMapDropRateTable(mapId);
  const drops = rollDropsByWinCount(wins, dropRates);

  return {
    battles,
    wins,
    losses,
    draws: 0,
    exp_gain: expGain,
    spirit_gain: spiritGain,
    drops,
    settled_until: nextSettledUntil,
    consumed_sec: consumedSec,
    avg_battle_sec: avgBattleSec,
    win_rate: winRate
  };
}

function mergeDropCountList(target, incoming) {
  const out = Array.isArray(target) ? target : [];
  for (const d of (Array.isArray(incoming) ? incoming : [])) {
    const itemId = intVal(d?.item_id, 0);
    const cnt = Math.max(0, intVal(d?.count, 0));
    if (itemId <= 0 || cnt <= 0) continue;
    const idx = out.findIndex(x => intVal(x?.item_id, 0) === itemId);
    if (idx >= 0) {
      out[idx].count = Math.max(0, intVal(out[idx].count, 0)) + cnt;
    } else {
      out.push({
        item_id: itemId,
        item_name: String(d?.item_name || `物品${itemId}`),
        count: cnt
      });
    }
  }
  return out;
}

module.exports = {
  OFFLINE_HYBRID_ENABLED,
  OFFLINE_REAL_SAMPLE_SEC,
  OFFLINE_SAMPLE_ROUNDS_PER_RUN,
  buildProjectionFromProfile,
  mergeDropCountList
};
