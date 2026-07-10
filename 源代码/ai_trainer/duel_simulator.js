/**
 * duel_simulator.js - 修仙模拟器（斗法环境）
 *
 * 包含：CultivationSimulator 类的核心部分
 * 构造函数、getState、奖励系统、step、reset
 */

const { ACTIONS, SKILLS_DATA, ITEMS_DATA, MAPS_DATA, TECHNIQUES_DATA, randomInt, clamp, getMapName, getMapInfo, getNPCOnlineStatus, getOnlineNPCs } = require('./duel_common.js');
const { mixinActions } = require('./duel_actions.js');
const { mixinActions2 } = require('./duel_actions2.js');

// ============================================================
// 修仙模拟器（用于斗法环境）
// ============================================================
class CultivationSimulator {
  /**
   * @param {number} botIndex - AI编号
   * @param {Object} options - 配置选项
   */
  constructor(botIndex, options = {}) {
    this.botIndex = botIndex;
    this.options = Object.assign({
      maxSteps: 200,
      startLevel: 1,
      startHp: 100,
      startMp: 50,
      startAttack: 10,
      startDefense: 5,
      startSpiritStones: 100,
    }, options);

    // ---- 玩家状态 ----
    this.player = {
      level: this.options.startLevel,
      exp: 0,
      expToNext: 100,
      hp: this.options.startHp,
      maxHp: this.options.startHp,
      mp: this.options.startMp,
      maxMp: this.options.startMp,
      attack: this.options.startAttack,
      defense: this.options.startDefense,
      spiritStones: this.options.startSpiritStones,
      breakthrough: 0,
      breakthroughMax: 10,
      mapId: 1,
      autoBattle: false,
      // 技能系统
      learnedSkills: [],
      equippedSkills: [],
      keySkillId: null,
      // 装备
      weapon: null,
      armor: null,
      // 背包
      inventory: [],
      // 洞府
      cave: { level: 1, gatherCount: 0, formationActive: false },
      // 弟子
      disciples: [],
      // 宗门
      sectId: null,
      sectContribution: 0,
      // 联盟
      allianceId: null,
      alliancePoints: 0,
      // 副本
      dungeonProgress: 0,
      trialScore: 0,
      // 冷却
      cooldowns: {
        battle: 0, potion: 0, alchemy: 0, forging: 0, cave: 0, sect: 0, dungeon: 0,
      },
      // 统计
      stats: {
        battlesWon: 0, battlesLost: 0, itemsUsed: 0, skillsLearned: 0,
        breakthroughs: 0, totalExpGained: 0, totalSpiritStones: 0,
        alchemyCount: 0, forgingCount: 0, dungeonClears: 0,
      },
    };

    // ---- 初始化背包 ----
    this._initInventory();

    // ---- 步数跟踪 ----
    this.stepCount = 0;
    this.done = false;
    this.totalReward = 0;
    this.lastAction = -1;
    this.lastActionResult = null;

    // ---- 战斗详情记录 ----
    this.battleLog = [];          // 战斗日志
    this.battleDetails = [];      // 详细战斗过程
    this.currentEnemy = null;     // 当前战斗对象
    this.currentMapInfo = null;   // 当前地图信息
    this.npcStatus = null;        // NPC在线状态
    this.botName = options.botName || `AI修仙者·${botIndex + 1}`;

    // 初始化地图信息
    this._updateMapInfo();
  }

  /**
   * 更新当前地图信息
   */
  _updateMapInfo() {
    this.currentMapInfo = getMapInfo(this.player.mapId);
  }

  /**
   * 记录战斗详情
   */
  _addBattleLog(type, message, data = {}) {
    const entry = {
      step: this.stepCount,
      type,
      message,
      timestamp: Date.now(),
      ...data,
    };
    this.battleLog.push(entry);
    if (this.battleLog.length > 100) {
      this.battleLog.shift();
    }
    return entry;
  }

  /**
   * 获取当前地图的敌人信息
   */
  _getCurrentEnemy() {
    const mapInfo = this.currentMapInfo;
    if (!mapInfo || !mapInfo.enemies || mapInfo.enemies.length === 0) {
      return { name: '野怪', level: this.player.level, hp: 50 + this.player.level * 10, attack: 5 + this.player.level * 2 };
    }
    const enemyId = mapInfo.enemies[Math.floor(Math.random() * mapInfo.enemies.length)];
    return {
      id: enemyId,
      name: `怪物#${enemyId}`,
      level: mapInfo.level || this.player.level,
      hp: 50 + (mapInfo.level || this.player.level) * 10,
      attack: 5 + (mapInfo.level || this.player.level) * 2,
    };
  }

  /**
   * 初始化背包：给AI一些基础物品
   */
  _initInventory() {
    const hpPotions = ITEMS_DATA.filter(i =>
      i.name && (i.name.includes('HP') || i.name.includes('血') || i.name.includes('恢复'))
    );
    const mpPotions = ITEMS_DATA.filter(i =>
      i.name && (i.name.includes('MP') || i.name.includes('蓝') || i.name.includes('灵'))
    );
    const weapons = ITEMS_DATA.filter(i =>
      i.type === 'weapon' || (i.name && (i.name.includes('剑') || i.name.includes('刀') || i.name.includes('枪') || i.name.includes('爪') || i.name.includes('弓') || i.name.includes('笛')))
    );
    const armors = ITEMS_DATA.filter(i =>
      i.type === 'armor' || (i.name && i.name.includes('甲'))
    );
    const herbs = ITEMS_DATA.filter(i =>
      i.type === 'herb' || (i.name && (i.name.includes('草') || i.name.includes('花') || i.name.includes('果')))
    );
    const materials = ITEMS_DATA.filter(i =>
      i.type === 'material' || (i.name && (i.name.includes('矿') || i.name.includes('石') || i.name.includes('铁')))
    );

    // 添加HP药水
    if (hpPotions.length > 0) {
      const item = hpPotions[0];
      this.player.inventory.push({
        itemId: item.id || 1, name: item.name || 'HP药水',
        type: 'potion', quantity: 5, stats: { healHp: 30 },
      });
    } else {
      this.player.inventory.push({ itemId: 1, name: 'HP药水', type: 'potion', quantity: 5, stats: { healHp: 30 } });
    }

    // 添加MP药水
    if (mpPotions.length > 0) {
      const item = mpPotions[0];
      this.player.inventory.push({
        itemId: item.id || 2, name: item.name || 'MP药水',
        type: 'potion', quantity: 3, stats: { healMp: 20 },
      });
    } else {
      this.player.inventory.push({ itemId: 2, name: 'MP药水', type: 'potion', quantity: 3, stats: { healMp: 20 } });
    }

    // 添加武器
    if (weapons.length > 0) {
      const item = weapons[0];
      this.player.inventory.push({
        itemId: item.id || 10, name: item.name || '铁剑',
        type: 'weapon', quantity: 1,
        stats: { attack: item.stats?.attack || 5, quality: item.quality || 1 },
      });
    }

    // 添加防具
    if (armors.length > 0) {
      const item = armors[0];
      this.player.inventory.push({
        itemId: item.id || 20, name: item.name || '皮甲',
        type: 'armor', quantity: 1,
        stats: { defense: item.stats?.defense || 3, quality: item.quality || 1 },
      });
    }

    // 添加草药
    if (herbs.length > 0) {
      herbs.slice(0, 3).forEach((item, i) => {
        this.player.inventory.push({
          itemId: item.id || (30 + i), name: item.name || `草药${i + 1}`,
          type: 'herb', quantity: 3, stats: {},
        });
      });
    }

    // 添加材料
    if (materials.length > 0) {
      materials.slice(0, 3).forEach((item, i) => {
        this.player.inventory.push({
          itemId: item.id || (40 + i), name: item.name || `材料${i + 1}`,
          type: 'material', quantity: 5, stats: {},
        });
      });
    }
  }

  /**
   * 获取50维状态向量（与训练环境一致）
   */
  getState() {
    const p = this.player;

    // 基础属性 (0-9)
    const hpNorm = p.hp / Math.max(p.maxHp, 1);
    const mpNorm = p.mp / Math.max(p.maxMp, 1);
    const expNorm = p.exp / Math.max(p.expToNext, 1);
    const levelNorm = p.level / 100;
    const atkNorm = p.attack / 500;
    const defNorm = p.defense / 300;
    const breakthroughNorm = p.breakthrough / Math.max(p.breakthroughMax, 1);
    const spiritNorm = p.spiritStones / 10000;
    const mapNorm = p.mapId / 20;
    const autoBattleNorm = p.autoBattle ? 1 : 0;

    // 装备状态 (10-13)
    const hasWeapon = p.weapon ? 1 : 0;
    const weaponAtk = p.weapon ? (p.weapon.stats?.attack || 0) / 100 : 0;
    const hasArmor = p.armor ? 1 : 0;
    const armorDef = p.armor ? (p.armor.stats?.defense || 0) / 100 : 0;

    // 技能状态 (14-19)
    const learnedCount = p.learnedSkills.length / 20;
    const equippedCount = p.equippedSkills.length / 3;
    const hasKeySkill = p.keySkillId ? 1 : 0;
    const sectContributionNorm = p.sectContribution / 5000;
    const hasSect = p.sectId ? 1 : 0;
    const hasAlliance = p.allianceId ? 1 : 0;

    // 背包状态 (20-27)
    const invCount = p.inventory.length / 20;
    const potionCount = p.inventory.filter(i => i.type === 'potion').reduce((s, i) => s + i.quantity, 0) / 20;
    const herbCount = p.inventory.filter(i => i.type === 'herb').reduce((s, i) => s + i.quantity, 0) / 20;
    const materialCount = p.inventory.filter(i => i.type === 'material').reduce((s, i) => s + i.quantity, 0) / 20;
    const weaponCount = p.inventory.filter(i => i.type === 'weapon').length / 5;
    const armorCount = p.inventory.filter(i => i.type === 'armor').length / 5;
    const hasHpPotion = p.inventory.some(i => i.type === 'potion' && i.stats?.healHp && i.quantity > 0) ? 1 : 0;
    const hasMpPotion = p.inventory.some(i => i.type === 'potion' && i.stats?.healMp && i.quantity > 0) ? 1 : 0;

    // 洞府状态 (28-30)
    const caveLevelNorm = p.cave.level / 20;
    const caveGatherNorm = p.cave.gatherCount / 100;
    const caveFormationNorm = p.cave.formationActive ? 1 : 0;

    // 弟子状态 (31-33)
    const discipleCount = p.disciples.length / 5;
    const discipleSentCount = p.disciples.filter(d => d.sent).length / 5;
    const disciplePowerNorm = p.disciples.reduce((s, d) => s + d.power, 0) / 500;

    // 副本/试炼 (34-35)
    const dungeonProgressNorm = p.dungeonProgress / 100;
    const trialScoreNorm = p.trialScore / 1000;

    // 冷却状态 (36-43)
    const battleCd = p.cooldowns.battle > 0 ? 1 : 0;
    const potionCd = p.cooldowns.potion > 0 ? 1 : 0;
    const alchemyCd = p.cooldowns.alchemy > 0 ? 1 : 0;
    const forgingCd = p.cooldowns.forging > 0 ? 1 : 0;
    const caveCd = p.cooldowns.cave > 0 ? 1 : 0;
    const sectCd = p.cooldowns.sect > 0 ? 1 : 0;
    const dungeonCd = p.cooldowns.dungeon > 0 ? 1 : 0;
    const anyCd = (battleCd + potionCd + alchemyCd + forgingCd + caveCd + sectCd + dungeonCd) > 0 ? 1 : 0;

    // 统计 (44-49)
    const winRate = (p.stats.battlesWon + p.stats.battlesLost) > 0
      ? p.stats.battlesWon / (p.stats.battlesWon + p.stats.battlesLost)
      : 0;
    const itemsUsedNorm = p.stats.itemsUsed / 50;
    const skillsLearnedNorm = p.stats.skillsLearned / 20;
    const breakthroughsNorm = p.stats.breakthroughs / 10;
    const alchemyCountNorm = p.stats.alchemyCount / 20;
    const forgingCountNorm = p.stats.forgingCount / 20;

    return [
      hpNorm, mpNorm, expNorm, levelNorm, atkNorm, defNorm,
      breakthroughNorm, spiritNorm, mapNorm, autoBattleNorm,
      hasWeapon, weaponAtk, hasArmor, armorDef,
      learnedCount, equippedCount, hasKeySkill, sectContributionNorm, hasSect, hasAlliance,
      invCount, potionCount, herbCount, materialCount, weaponCount, armorCount, hasHpPotion, hasMpPotion,
      caveLevelNorm, caveGatherNorm, caveFormationNorm,
      discipleCount, discipleSentCount, disciplePowerNorm,
      dungeonProgressNorm, trialScoreNorm,
      battleCd, potionCd, alchemyCd, forgingCd, caveCd, sectCd, dungeonCd, anyCd,
      winRate, itemsUsedNorm, skillsLearnedNorm, breakthroughsNorm, alchemyCountNorm, forgingCountNorm,
    ];
  }

  // ============================================================
  // 奖励权重（与 game_environment.js 一致）
  // ============================================================
  get rewardWeights() {
    return {
      hpGain: 0.5,
      mpGain: 0.3,
      expGain: 1.0,
      levelUp: 5.0,
      breakthrough: 10.0,
      battleWin: 3.0,
      battleLoss: -2.0,
      itemUse: 0.5,
      skillLearn: 2.0,
      equipWeapon: 1.5,
      equipArmor: 1.0,
      spiritStoneGain: 0.01,
      alchemy: 2.0,
      forging: 2.0,
      caveGather: 1.0,
      caveUpgrade: 3.0,
      discipleCreate: 1.0,
      discipleSend: 2.0,
      sectContribute: 0.5,
      sectLearn: 2.0,
      sectTask: 1.5,
      allianceActivity: 1.0,
      dungeonClear: 5.0,
      trialScore: 2.0,
      trade: 0.5,
      invalidAction: -0.5,
      timePenalty: -0.1,
      death: -10.0,
    };
  }

  // ============================================================
  // 奖励计算
  // ============================================================
  _calculateReward(actionResult) {
    if (!actionResult) return this.rewardWeights.invalidAction;

    let reward = 0;

    if (actionResult.hpDelta) {
      reward += (actionResult.hpDelta / Math.max(this.player.maxHp, 1)) * this.rewardWeights.hpGain;
    }
    if (actionResult.mpDelta) {
      reward += (actionResult.mpDelta / Math.max(this.player.maxMp, 1)) * this.rewardWeights.mpGain;
    }
    if (actionResult.expGain) {
      reward += (actionResult.expGain / 100) * this.rewardWeights.expGain;
    }
    if (actionResult.spiritStoneGain) {
      reward += actionResult.spiritStoneGain * this.rewardWeights.spiritStoneGain;
    }
    if (actionResult.specialRewards) {
      const sr = actionResult.specialRewards;
      if (sr.levelUp) reward += this.rewardWeights.levelUp;
      if (sr.breakthrough) reward += this.rewardWeights.breakthrough;
      if (sr.battleWin) reward += this.rewardWeights.battleWin;
      if (sr.battleLoss) reward += this.rewardWeights.battleLoss;
      if (sr.itemUse) reward += this.rewardWeights.itemUse;
      if (sr.skillLearn) reward += this.rewardWeights.skillLearn;
      if (sr.equipWeapon) reward += this.rewardWeights.equipWeapon;
      if (sr.equipArmor) reward += this.rewardWeights.equipArmor;
      if (sr.alchemy) reward += this.rewardWeights.alchemy;
      if (sr.forging) reward += this.rewardWeights.forging;
      if (sr.caveGather) reward += this.rewardWeights.caveGather;
      if (sr.caveUpgrade) reward += this.rewardWeights.caveUpgrade;
      if (sr.discipleCreate) reward += this.rewardWeights.discipleCreate;
      if (sr.discipleSend) reward += this.rewardWeights.discipleSend;
      if (sr.sectContribute) reward += this.rewardWeights.sectContribute;
      if (sr.sectLearn) reward += this.rewardWeights.sectLearn;
      if (sr.sectTask) reward += this.rewardWeights.sectTask;
      if (sr.allianceActivity) reward += this.rewardWeights.allianceActivity;
      if (sr.dungeonClear) reward += this.rewardWeights.dungeonClear;
      if (sr.trialScore) reward += this.rewardWeights.trialScore;
      if (sr.trade) reward += this.rewardWeights.trade;
      if (sr.death) reward += this.rewardWeights.death;
    }

    reward += this.rewardWeights.timePenalty;
    return reward;
  }

  // ============================================================
  // 冷却递减
  // ============================================================
  _tickCooldowns() {
    const cd = this.player.cooldowns;
    for (const key of Object.keys(cd)) {
      if (cd[key] > 0) cd[key]--;
    }
  }

  // ============================================================
  // 执行一步
  // ============================================================
  step(action) {
    this.stepCount++;
    this.lastAction = action;
    this._tickCooldowns();

    // 更新地图信息
    this._updateMapInfo();

    // 获取NPC在线状态
    this.npcStatus = getNPCOnlineStatus(this.botName);

    let actionResult = null;

    switch (action) {
      case 0:  actionResult = this._doBattle('attack'); break;
      case 1:  actionResult = this._doBattle('skill1'); break;
      case 2:  actionResult = this._doBattle('skill2'); break;
      case 3:  actionResult = this._doBattle('skill3'); break;
      case 4:  actionResult = this._doBattle('heal'); break;
      case 5:  actionResult = this._usePotion('hp'); break;
      case 6:  actionResult = this._usePotion('mp'); break;
      case 7:  actionResult = this._switchMap(); break;
      case 8:  actionResult = this._doLevelUp(); break;
      case 9:  actionResult = this._doBreakthrough(); break;
      case 10: actionResult = this._equipItem('weapon'); break;
      case 11: actionResult = this._equipItem('armor'); break;
      case 12: actionResult = this._claimMail(); break;
      case 13: actionResult = this._doSync(); break;
      case 14: actionResult = this._toggleAutoBattle(); break;
      case 15: actionResult = this._doAlchemy(); break;
      case 16: actionResult = this._doForging(); break;
      case 17: actionResult = this._doForgingUpgrade(); break;
      case 18: actionResult = this._doForgingReroll(); break;
      case 19: actionResult = this._doCaveGather(); break;
      case 20: actionResult = this._doCaveUpgrade(); break;
      case 21: actionResult = this._doCaveFormation(); break;
      case 22: actionResult = this._doCreateDisciple(); break;
      case 23: actionResult = this._doSendDisciple(); break;
      case 24: actionResult = this._doRecallDisciple(); break;
      case 25: actionResult = this._doSectContribute(); break;
      case 26: actionResult = this._doSectLearn(); break;
      case 27: actionResult = this._doSectTask(); break;
      case 28: actionResult = this._doAllianceActivity('bless'); break;
      case 29: actionResult = this._doAllianceActivity('bathe'); break;
      case 30: actionResult = this._doAllianceActivity('garden'); break;
      case 31: actionResult = this._doAllianceActivity('meditate'); break;
      case 32: actionResult = this._doDungeon(); break;
      case 33: actionResult = this._doTrial(); break;
      case 34: actionResult = this._doExchange(); break;
      default:
        actionResult = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };
        break;
    }

    // 记录战斗详情
    if (actionResult) {
      const sr = actionResult.specialRewards || {};
      if (sr.battleWin || sr.battleLoss) {
        this._addBattleLog('battle', `${this.botName} 在 ${getMapName(this.player.mapId)} 与 ${this.currentEnemy ? this.currentEnemy.name : '野怪'} 战斗`, {
          result: sr.battleWin ? 'win' : 'loss',
          enemyName: this.currentEnemy ? this.currentEnemy.name : '野怪',
          mapName: getMapName(this.player.mapId),
          mapLevel: this.currentMapInfo ? this.currentMapInfo.level : 0,
          playerHp: this.player.hp,
          playerLevel: this.player.level,
          npcOnline: this.npcStatus ? this.npcStatus.online : false,
        });
      }
      if (sr.levelUp) {
        this._addBattleLog('levelup', `${this.botName} 升级到 ${this.player.level} 级！`);
      }
      if (sr.breakthrough) {
        this._addBattleLog('breakthrough', `${this.botName} 突破到 ${this.player.breakthrough} 重！`);
      }
      if (sr.skillLearn) {
        this._addBattleLog('skill', `${this.botName} 学习了新技能`);
      }
      if (sr.equipWeapon || sr.equipArmor) {
        this._addBattleLog('equip', `${this.botName} 装备了新装备`);
      }
    }

    const reward = this._calculateReward(actionResult);
    this.totalReward += reward;
    this.done = this._isDone();

    const nextState = this.getState();
    this.lastActionResult = actionResult;

    return {
      state: nextState,
      reward: reward,
      done: this.done,
      info: {
        action: action,
        actionName: ACTIONS[action]?.name || 'unknown',
        player: { ...this.player },
        actionResult: actionResult,
        step: this.stepCount,
        totalReward: this.totalReward,
        // 新增：战斗详情
        mapName: getMapName(this.player.mapId),
        mapInfo: this.currentMapInfo ? {
          id: this.currentMapInfo.id,
          name: this.currentMapInfo.name,
          level: this.currentMapInfo.level,
          description: this.currentMapInfo.description,
        } : null,
        currentEnemy: this.currentEnemy ? { name: this.currentEnemy.name, level: this.currentEnemy.level, hp: this.currentEnemy.hp } : null,
        npcOnline: this.npcStatus ? this.npcStatus.online : false,
        onlineNPCs: getOnlineNPCs().slice(0, 5),
        battleLog: this.battleLog.slice(-10),
      },
    };
  }

  // ============================================================
  // 检查是否结束
  // ============================================================
  _isDone() {
    if (this.player.hp <= 0) return true;
    if (this.stepCount >= this.options.maxSteps) return true;
    return false;
  }

  // ============================================================
  // 重置
  // ============================================================
  reset() {
    this.stepCount = 0;
    this.done = false;
    this.totalReward = 0;
    this.lastAction = -1;
    this.lastActionResult = null;

    this.player.level = this.options.startLevel;
    this.player.exp = 0;
    this.player.expToNext = 100;
    this.player.hp = this.options.startHp;
    this.player.maxHp = this.options.startHp;
    this.player.mp = this.options.startMp;
    this.player.maxMp = this.options.startMp;
    this.player.attack = this.options.startAttack;
    this.player.defense = this.options.startDefense;
    this.player.spiritStones = this.options.startSpiritStones;
    this.player.breakthrough = 0;
    this.player.mapId = 1;
    this.player.autoBattle = false;
    this.player.learnedSkills = [];
    this.player.equippedSkills = [];
    this.player.keySkillId = null;
    this.player.weapon = null;
    this.player.armor = null;
    this.player.inventory = [];
    this.player.cave = { level: 1, gatherCount: 0, formationActive: false };
    this.player.disciples = [];
    this.player.sectId = null;
    this.player.sectContribution = 0;
    this.player.allianceId = null;
    this.player.alliancePoints = 0;
    this.player.dungeonProgress = 0;
    this.player.trialScore = 0;
    this.player.cooldowns = { battle: 0, potion: 0, alchemy: 0, forging: 0, cave: 0, sect: 0, dungeon: 0 };
    this.player.stats = {
      battlesWon: 0, battlesLost: 0, itemsUsed: 0, skillsLearned: 0,
      breakthroughs: 0, totalExpGained: 0, totalSpiritStones: 0,
      alchemyCount: 0, forgingCount: 0, dungeonClears: 0,
    };
    this._initInventory();
    return this.getState();
  }
}

// 混入动作方法
mixinActions(CultivationSimulator);
mixinActions2(CultivationSimulator);

module.exports = { CultivationSimulator };
