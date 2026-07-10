/**
 * 游戏强化学习环境 (完整版)
 * 
 * 将艾德尔修仙传游戏封装为标准强化学习环境接口。
 * 覆盖完整游戏循环：战斗、升级、突破、装备、技能、炼丹、锻造、
 * 洞府、传人、宗门、联盟、副本、试炼、联赛、交易所等全部功能。
 * 
 * 状态空间 (50维):
 *   [0-29] 基础属性 (等级、HP/MP%、攻防、属性点、灵石等)
 *   [30-39] 游戏进度 (地图、宗门、联盟、洞府、传人等)
 *   [40-49] 战斗/经济统计 (胜率、连胜、药水、材料等)
 * 
 * 动作空间 (35个离散动作):
 *   0:  普通攻击         1:  使用技能1        2:  使用技能2
 *   3:  使用技能3         4:  治疗             5:  HP药水
 *   6:  MP药水           7:  高级地图          8:  低级地图
 *   9:  升级             10: 突破             11: 整理装备
 *   12: 领取邮件         13: 等待/同步         14: 自动战斗切换
 *   15: 炼丹             16: 锻造装备          17: 升级锻造
 *   18: 重铸装备         19: 洞府采集          20: 洞府升级
 *   21: 洞府阵法         22: 创建传人          23: 派遣传人
 *   24: 召回传人         25: 宗门贡献          26: 宗门学习
 *   27: 宗门任务         28: 联盟祈福          29: 联盟沐浴
 *   30: 联盟采摘         31: 联盟冥想          32: 副本探索
 *   33: 试炼挑战         34: 交易所买卖
 */
const GameClient = require('./game_client');

class GameEnvironment {
  /**
   * @param {GameClient} client - 游戏客户端实例
   * @param {object} options - 配置选项
   */
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      maxStepsPerEpisode: options.maxStepsPerEpisode || 1000,
      levelTarget: options.levelTarget || 400,
      ...options
    };

    // 奖励权重配置（可从UI动态调整）
    this.rewardWeights = Object.assign({
      levelUp: 100.0,        // 等级提升
      expGain: 50.0,         // 经验获取上限
      spiritStone: 20.0,     // 灵石获取上限
      battleWin: 30.0,       // 战斗胜利
      battleLoss: -20.0,     // 战斗失败
      combatPower: 30.0,     // 战力提升上限
      crafting: 25.0,        // 制作
      forging: 30.0,         // 锻造
      alchemy: 20.0,         // 炼丹
      collection: 15.0,      // 采集
      sectTask: 20.0,        // 宗门任务
      sectLearn: 15.0,       // 宗门学习
      alliance: 10.0,        // 联盟活动
      dungeon: 40.0,         // 副本
      trial: 35.0,           // 试炼
      discipleCreate: 20.0,  // 创建传人
      discipleRecall: 15.0,  // 召回传人
      exchange: 10.0,        // 交易所
      equip: 15.0,           // 装备优化
      skillEquip: 10.0,      // 技能装备
      techniqueEquip: 15.0,  // 功法装备 (新增)
      mailClaim: 5.0,        // 邮件领取
      stepPenalty: -0.5,     // 步数惩罚
      invalidAction: -5.0,   // 无效操作
    }, options.rewardWeights || {});

    this.stepCount = 0;
    this.episodeCount = 0;
    this.totalReward = 0;
    this.prevLevel = 1;
    this.prevExp = 0;
    this.prevCombatStats = null;
    this.prevSpiritStones = 0;
    this.battleWinCount = 0;
    this.battleLossCount = 0;
    this.consecutiveWins = 0;
    this.consecutiveLosses = 0;
    this.lastBattleResult = null;
    this.lastActionTime = Date.now();
    this.actionHistory = [];
    this.rewardHistory = [];

    // 游戏进度追踪
    this.hasCreatedDisciple = false;
    this.lastCaveCollectTime = 0;
    this.lastSectTaskTime = 0;
    this.lastAllianceActivityTime = 0;
    this.lastAlchemyTime = 0;
    this.lastForgingTime = 0;
    this.lastExchangeTime = 0;
    this.lastDungeonTime = 0;
    this.lastTrialTime = 0;
    this.lastLeagueTime = 0;

    // 已探索地图记录（用于新地图探索奖励）
    this.exploredMaps = new Set();

    // 状态归一化参数
    this.stateNormalization = {
      level: { max: 400 },
      exp: { max: 1000000 },
      hp: { max: 100000 },
      mp: { max: 50000 },
      attack: { max: 50000 },
      defense: { max: 30000 },
      spirit_stones: { max: 10000000 }
    };
  }

  /** 获取归一化的状态向量 (50维) */
  getState() {
    const p = this.client.player;
    if (!p) return new Array(50).fill(0);

    const combat = this.client.getCombatSummary() || {};
    const inventory = this.client.getInventory() || [];
    const skills = this.client.getEquippedSkills() || [];
    const gameData = this.client.gameData;

    // === 基础属性 (0-14) ===
    const expPercent = p.max_exp > 0 ? (p.exp || 0) / p.max_exp : 0;
    const hpPercent = p.max_hp > 0 ? (p.hp || 0) / p.max_hp : 0;
    const mpPercent = p.max_mp > 0 ? (p.mp || 0) / p.max_mp : 0;

    // === 装备/物品统计 (15-19) ===
    const equipmentCount = inventory.filter(i => 
      ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back', 'equipment', 'armor'].includes(i.type)
    ).length;
    const potionCount = inventory.filter(i => 
      i.type === 'consumable' && (i.name.includes('药') || i.name.includes('丹'))
    ).length;
    const materialCount = inventory.filter(i =>
      i.type === 'material' || i.type === 'ore' || i.type === 'herb'
    ).length;
    const forgingMaterialCount = inventory.filter(i =>
      i.name.includes('灵') || i.name.includes('矿') || i.name.includes('铁') || i.name.includes('晶')
    ).length;

    // === 技能分析 (20-22) ===
    const hasHealSkill = skills.some(sid => {
      if (!gameData || !gameData.skills) return false;
      const skill = gameData.skills.find(s => s.id === sid);
      return skill && (skill.effects || []).some(e => e.type && e.type.includes('heal'));
    });
    const hasAttackSkill = skills.some(sid => {
      if (!gameData || !gameData.skills) return false;
      const skill = gameData.skills.find(s => s.id === sid);
      return skill && (skill.effects || []).some(e => e.type && (e.type.includes('damage') || e.type.includes('attack')));
    });

    // === 地图信息 (23-24) ===
    let mapLevel = 1;
    if (gameData && gameData.maps && p.current_map_id) {
      const map = gameData.maps.find(m => m.id === p.current_map_id);
      if (map) mapLevel = map.level || 1;
    }

    // === 战斗统计 (25-29) ===
    const totalBattles = this.battleWinCount + this.battleLossCount || 1;
    const winRate = this.battleWinCount / totalBattles;

    // === 游戏进度 (30-39) ===
    const hasSect = p.sect_id > 0 ? 1 : 0;
    const hasAlliance = p.alliance_id > 0 ? 1 : 0;
    const hasCave = p.cave && p.cave.level > 0 ? 1 : 0;
    const hasDisciple = p.disciple && p.disciple.name ? 1 : 0;
    const canBreakthrough = p.breakthrough_foundation_pills_stored > 0 ? 1 : 0;
    const isResting = p.rest_until > Math.floor(Date.now() / 1000) ? 1 : 0;
    const hasPendingJob = p.baiyi && p.baiyi.pending_job ? 1 : 0;
    const hasAutoBattle = p.auto_battle_enabled ? 1 : 0;

    // === 经济/资源 (40-49) ===
    const sectContribution = p.sect_contribution || 0;
    const trialCoins = p.trial_coins || 0;
    const leagueRating = p.league_rating || 1000;
    const caveLevel = p.cave ? (p.cave.level || 0) : 0;
    const caveResource = p.cave && p.cave.gathering ? 
      (p.cave.gathering.collected || 0) / 1000 : 0;

    // 归一化状态向量 (所有值在0-1之间)
    const state = [
      // === 基础属性 (0-14) ===
      Math.min(1, (p.level || 1) / 400),                    // 0: 等级
      Math.min(1, expPercent),                               // 1: 经验百分比
      Math.min(1, hpPercent),                                // 2: HP百分比
      Math.min(1, mpPercent),                                // 3: MP百分比
      Math.min(1, (combat.attack || 0) / 50000),             // 4: 物理攻击
      Math.min(1, (combat.defense || 0) / 30000),            // 5: 物理防御
      Math.min(1, (combat.spell_attack || 0) / 50000),       // 6: 法术攻击
      Math.min(1, (combat.spell_defense || 0) / 30000),      // 7: 法术防御
      Math.min(1, (combat.strength || 0) / 5000),            // 8: 力量
      Math.min(1, (combat.constitution || 0) / 5000),        // 9: 体质
      Math.min(1, (combat.agility || 0) / 5000),             // 10: 敏捷
      Math.min(1, (combat.zhenyuan || 0) / 5000),            // 11: 真元
      Math.min(1, (p.spirit_stones || 0) / 10000000),        // 12: 灵石
      Math.min(1, (p.max_hp || 0) / 100000),                 // 13: 最大HP
      Math.min(1, (p.max_mp || 0) / 50000),                  // 14: 最大MP

      // === 装备/物品 (15-19) ===
      Math.min(1, equipmentCount / 50),                      // 15: 装备数量
      Math.min(1, skills.length / 10),                       // 16: 技能数量
      Math.min(1, potionCount / 100),                        // 17: 药水数量
      Math.min(1, materialCount / 100),                      // 18: 材料数量
      Math.min(1, forgingMaterialCount / 100),               // 19: 锻造材料数量

      // === 技能分析 (20-22) ===
      hasHealSkill ? 1 : 0,                                  // 20: 有治疗技能
      hasAttackSkill ? 1 : 0,                                // 21: 有攻击技能
      Math.min(1, skills.length / 10),                       // 22: 已装备技能数

      // === 地图信息 (23-24) ===
      Math.min(1, mapLevel / 400),                           // 23: 地图等级
      p.current_map_id ? (p.current_map_id % 100) / 100 : 0, // 24: 地图ID归一化

      // === 战斗统计 (25-29) ===
      Math.min(1, winRate),                                  // 25: 胜率
      Math.min(1, this.consecutiveWins / 20),                // 26: 连胜次数
      Math.min(1, this.consecutiveLosses / 10),              // 27: 连败次数
      this.lastBattleResult === 'win' ? 1 : (this.lastBattleResult === 'loss' ? -1 : 0), // 28: 上局结果
      Math.min(1, this.stepCount / this.options.maxStepsPerEpisode), // 29: 步数进度

      // === 游戏进度 (30-39) ===
      canBreakthrough,                                       // 30: 可突破
      isResting,                                             // 31: 正在休息
      hasSect,                                               // 32: 已加入宗门
      hasAlliance,                                           // 33: 已加入联盟
      hasCave,                                               // 34: 已开启洞府
      hasDisciple,                                           // 35: 已有传人
      hasPendingJob,                                         // 36: 有进行中的制作
      hasAutoBattle,                                         // 37: 自动战斗开启
      Math.min(1, (p.level || 1) / 100),                     // 38: 境界(粗略)
      Math.min(1, (p.realm_level || 0) / 20),                // 39: 境界等级

      // === 经济/资源 (40-49) ===
      Math.min(1, sectContribution / 100000),                // 40: 宗门贡献
      Math.min(1, trialCoins / 100000),                      // 41: 试炼币
      Math.min(1, (leagueRating - 1000) / 2000),             // 42: 联赛积分
      Math.min(1, caveLevel / 20),                           // 43: 洞府等级
      Math.min(1, caveResource),                             // 44: 洞府资源
      Math.min(1, (p.destiny_points || 0) / 100),            // 45: 命途点数
      Math.min(1, (p.talent_points || 0) / 100),             // 46: 天赋点数
      Math.min(1, (p.invite_points || 0) / 10000),           // 47: 邀请积分
      Math.min(1, (p.disciple_battle_score || 0) / 10000),   // 48: 传人斗法积分
      Math.min(1, (p.league_points || 0) / 100000)           // 49: 联赛币
    ];

    return state;
  }

  /** 计算奖励（使用可配置权重） */
  _calculateReward(actionResult) {
    let reward = 0;
    // 防御性检查
    if (!this.client || !this.client.player) return -1;
    const p = this.client.player;

    const w = this.rewardWeights || {}; // 权重简写
    const currentLevel = p.level || 1;
    const currentExp = p.exp || 0;
    const currentStones = p.spirit_stones || 0;

    // 1. 等级提升奖励 (主要目标)
    if (currentLevel > this.prevLevel) {
      const levelGain = currentLevel - this.prevLevel;
      reward += levelGain * Math.abs(w.levelUp);
    }

    // 2. 经验获取奖励
    const expGain = currentExp - this.prevExp;
    if (expGain > 0) {
      reward += Math.min(expGain / 100, Math.abs(w.expGain));
    }

    // 3. 灵石获取奖励
    const stoneGain = currentStones - this.prevSpiritStones;
    if (stoneGain > 0) {
      reward += Math.min(stoneGain / 1000, Math.abs(w.spiritStone));
    }

    // 4. 战斗胜利奖励
    if (actionResult && actionResult.battleWin) {
      reward += w.battleWin;
      this.consecutiveWins++;
      this.consecutiveLosses = 0;
      this.battleWinCount++;
      this.lastBattleResult = 'win';
      if (this.consecutiveWins >= 5) reward += w.battleWin * 0.33;
      if (this.consecutiveWins >= 10) reward += w.battleWin * 0.67;
    }

    // 5. 战斗失败惩罚
    if (actionResult && actionResult.battleLoss) {
      reward += w.battleLoss; // 负数即惩罚
      this.consecutiveLosses++;
      this.consecutiveWins = 0;
      this.battleLossCount++;
      this.lastBattleResult = 'loss';
      if (this.consecutiveLosses >= 3) reward += w.battleLoss * 0.75;
    }

    // 6. 战力提升奖励 (阶段性奖励)
    if (this.prevCombatStats) {
      const currentCombat = this.client.getCombatSummary();
      if (currentCombat) {
        const prevPower = (this.prevCombatStats.attack || 0) + (this.prevCombatStats.defense || 0) +
                          (this.prevCombatStats.spell_attack || 0) + (this.prevCombatStats.spell_defense || 0);
        const currentPower = (currentCombat.attack || 0) + (currentCombat.defense || 0) +
                             (currentCombat.spell_attack || 0) + (currentCombat.spell_defense || 0);
        const powerGain = currentPower - prevPower;
        if (powerGain > 0) {
          reward += Math.min(powerGain / 10, Math.abs(w.combatPower));
        }
        // 战力阶段性奖励：大幅提升战力时给予额外奖励
        if (powerGain > 100) {
          reward += w.combatPower * 2;  // 大幅提升战力
        } else if (powerGain > 50) {
          reward += w.combatPower * 1.5;
        } else if (powerGain > 10) {
          reward += w.combatPower;
        }
      }
    }

    // 7. 装备+技能+功法组合奖励 (synergy奖励)
    if (actionResult && actionResult.skillEquipped && actionResult.techniqueEquipped) {
      reward += 25.0; // 同时装备技能和功法的组合奖励
    }

    // 8. 突破奖励
    if (actionResult && actionResult.breakthrough) {
      reward += 50.0; // 突破境界的高额奖励
    }

    // 9. 新地图探索奖励
    if (actionResult && actionResult.newMapExplored) {
      reward += 10.0;
    }

    // 10. 制作/采集奖励
    if (actionResult && actionResult.crafted) {
      reward += w.crafting;
    }
    if (actionResult && actionResult.collected) {
      reward += w.collection;
    }
    if (actionResult && actionResult.forged) {
      reward += w.forging;
    }
    if (actionResult && actionResult.alchemyDone) {
      reward += w.alchemy;
    }

    // 11. 宗门/联盟活动奖励
    if (actionResult && actionResult.sectTaskDone) {
      reward += w.sectTask;
    }
    if (actionResult && actionResult.sectLearned) {
      reward += w.sectLearn;
    }
    if (actionResult && actionResult.allianceActivity) {
      reward += w.alliance;
    }

    // 12. 副本/试炼奖励
    if (actionResult && actionResult.dungeonDone) {
      reward += w.dungeon;
    }
    if (actionResult && actionResult.trialDone) {
      reward += w.trial;
    }

    // 13. 传人相关奖励
    if (actionResult && actionResult.discipleCreated) {
      reward += w.discipleCreate;
    }
    if (actionResult && actionResult.discipleRecalled) {
      reward += w.discipleRecall;
    }

    // 14. 交易所奖励
    if (actionResult && actionResult.exchangeDone) {
      reward += w.exchange;
    }

    // 15. 装备/技能/功法优化奖励
    if (actionResult && actionResult.equipped) {
      reward += w.equip;
    }
    if (actionResult && actionResult.skillEquipped) {
      reward += w.skillEquip;
    }
    if (actionResult && actionResult.techniqueEquipped) {
      reward += w.techniqueEquip;
    }

    // 16. 邮件领取奖励
    if (actionResult && actionResult.mailClaimed) {
      reward += w.mailClaim;
    }

    // 17. 步数惩罚 (根据当前等级动态调整，低等级惩罚小，高等级惩罚大)
    const level = p.level || 1;
    const dynamicStepPenalty = w.stepPenalty * (1 + level / 100);
    reward += dynamicStepPenalty;

    // 18. 无效操作惩罚
    if (actionResult && actionResult.invalid) {
      reward += w.invalidAction;
    }

    return reward;
  }

  /** 执行动作 */
  async step(action) {
    this.stepCount++;
    // 防御性检查：确保 client.player 存在
    const player = this.client && this.client.player ? this.client.player : null;
    this.prevLevel = player ? (player.level || 1) : 1;
    this.prevExp = player ? (player.exp || 0) : 0;
    this.prevSpiritStones = player ? (player.spirit_stones || 0) : 0;
    this.prevCombatStats = this.client ? this.client.getCombatSummary() : null;

    let actionResult = {};
    let actionName = '';

    try {
      switch (action) {
        // === 战斗相关 (0-6) ===
        case 0: actionName = '普通攻击'; actionResult = await this._doBattle('attack'); break;
        case 1: actionName = '使用技能1'; actionResult = await this._doBattle('skill', 1); break;
        case 2: actionName = '使用技能2'; actionResult = await this._doBattle('skill', 2); break;
        case 3: actionName = '使用技能3'; actionResult = await this._doBattle('skill', 3); break;
        case 4: actionName = '治疗'; actionResult = await this._doBattle('heal'); break;
        case 5: actionName = '使用HP药水'; actionResult = await this._usePotion('hp'); break;
        case 6: actionName = '使用MP药水'; actionResult = await this._usePotion('mp'); break;

        // === 地图/升级 (7-10) ===
        case 7: actionName = '切换高级地图'; actionResult = await this._switchMap('higher'); break;
        case 8: actionName = '切换低级地图'; actionResult = await this._switchMap('lower'); break;
        case 9: actionName = '升级'; actionResult = await this._doLevelUp(); break;
        case 10: actionName = '突破'; actionResult = await this._doBreakthrough(); break;

        // === 装备/邮件/同步 (11-14) ===
        case 11: actionName = '整理装备'; actionResult = await this._optimizeEquipment(); break;
        case 12: actionName = '领取邮件'; actionResult = await this._claimMail(); break;
        case 13: actionName = '等待同步'; actionResult = await this._doSync(); break;
        case 14: actionName = '切换自动战斗'; actionResult = await this._toggleAutoBattle(); break;

        // === 制作相关 (15-18) ===
        case 15: actionName = '炼丹'; actionResult = await this._doAlchemy(); break;
        case 16: actionName = '锻造装备'; actionResult = await this._doForging(); break;
        case 17: actionName = '升级锻造'; actionResult = await this._doForgingUpgrade(); break;
        case 18: actionName = '重铸装备'; actionResult = await this._doForgingReroll(); break;

        // === 洞府相关 (19-21) ===
        case 19: actionName = '洞府采集'; actionResult = await this._doCaveGather(); break;
        case 20: actionName = '洞府升级'; actionResult = await this._doCaveUpgrade(); break;
        case 21: actionName = '洞府阵法'; actionResult = await this._doCaveFormation(); break;

        // === 传人相关 (22-24) ===
        case 22: actionName = '创建传人'; actionResult = await this._doCreateDisciple(); break;
        case 23: actionName = '派遣传人'; actionResult = await this._doSendDisciple(); break;
        case 24: actionName = '召回传人'; actionResult = await this._doRecallDisciple(); break;

        // === 宗门相关 (25-27) ===
        case 25: actionName = '宗门贡献'; actionResult = await this._doSectContribute(); break;
        case 26: actionName = '宗门学习'; actionResult = await this._doSectLearn(); break;
        case 27: actionName = '宗门任务'; actionResult = await this._doSectTask(); break;

        // === 联盟相关 (28-31) ===
        case 28: actionName = '联盟祈福'; actionResult = await this._doAllianceBless(); break;
        case 29: actionName = '联盟沐浴'; actionResult = await this._doAllianceBathe(); break;
        case 30: actionName = '联盟采摘'; actionResult = await this._doAllianceGarden(); break;
        case 31: actionName = '联盟冥想'; actionResult = await this._doAllianceMeditate(); break;

        // === 副本/试炼 (32-33) ===
        case 32: actionName = '副本探索'; actionResult = await this._doDungeon(); break;
        case 33: actionName = '试炼挑战'; actionResult = await this._doTrial(); break;

        // === 交易所 (34) ===
        case 34: actionName = '交易所买卖'; actionResult = await this._doExchange(); break;

        default:
          actionName = '未知动作';
          actionResult = { invalid: true };
      }
    } catch (e) {
      console.error(`[Env] 动作执行错误: ${actionName}`, e.message);
      actionResult = { invalid: true, error: e.message };
    }

    // 计算奖励
    const reward = this._calculateReward(actionResult);
    this.totalReward += reward;

    // 获取新状态
    const nextState = this.getState();

    // 判断是否结束
    const done = this._isDone();

    // 防御性记录（确保数组已初始化）
    if (!Array.isArray(this.actionHistory)) this.actionHistory = [];
    if (!Array.isArray(this.rewardHistory)) this.rewardHistory = [];
    this.actionHistory.push({ step: this.stepCount, action, actionName, reward });
    this.rewardHistory.push(reward);

    // 限制记录长度防止内存泄漏
    if (this.actionHistory.length > 10000) this.actionHistory = this.actionHistory.slice(-5000);
    if (this.rewardHistory.length > 10000) this.rewardHistory = this.rewardHistory.slice(-5000);

    const currentPlayer = this.client && this.client.player ? this.client.player : null;
    return {
      state: nextState,
      reward,
      done,
      info: {
        action: actionName,
        level: currentPlayer ? currentPlayer.level : 1,
        step: this.stepCount,
        totalReward: this.totalReward,
        ...actionResult
      }
    };
  }

  // ==================== 战斗系统 ====================

  async _doBattle(actionType, skillIndex = 0) {
    const p = this.client.player;
    if (!p) return { invalid: true };

    try {
      if (this.client.activeBattle) {
        let cmdAction = 'attack';
        let cmdSkillId = 0;

        if (actionType === 'skill') {
          const skills = this.client.getEquippedSkills();
          if (skills.length > 0 && skills[skillIndex - 1]) {
            cmdAction = 'skill';
            cmdSkillId = skills[skillIndex - 1];
          }
        } else if (actionType === 'heal') {
          cmdAction = 'skill';
          const skills = this.client.getEquippedSkills();
          const gameData = this.client.gameData;
          for (const sid of skills) {
            if (gameData && gameData.skills) {
              const skill = gameData.skills.find(s => s.id === sid);
              if (skill && skill.effects && skill.effects.some(e => e.type && e.type.includes('heal'))) {
                cmdSkillId = sid;
                break;
              }
            }
          }
        }

        const r = await this.client.battleCommand(
          this.client.activeBattle.id, cmdAction, cmdSkillId
        );

        if (r.ended) {
          return {
            battleWin: r.victory === true,
            battleLoss: r.victory === false,
            rewards: r.rewards || {},
            ended: true
          };
        }
        return { battleInProgress: true };
      }

      const mapId = this.client.getRecommendedMap();
      const r = await this.client.battleStart(mapId, true, true);
      if (r.ok && r.battleId) return { battleStarted: true };
      if (r.error && r.error.includes('休息')) return { resting: true };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 药水系统 ====================

  async _usePotion(type) {
    const inventory = this.client.getInventory();
    let targetItem = null;

    for (const item of inventory) {
      if (item.type === 'consumable') {
        if (type === 'hp' && (item.name.includes('血') || item.name.includes('回血') || item.name.includes('疗'))) {
          targetItem = item; break;
        }
        if (type === 'mp' && (item.name.includes('蓝') || item.name.includes('回蓝') || item.name.includes('灵'))) {
          targetItem = item; break;
        }
      }
    }

    if (targetItem) {
      const r = await this.client.useItem(targetItem.page, targetItem.slot, 1, targetItem.id);
      if (r.ok) return { used: true, itemName: targetItem.name };
    }
    return { invalid: true, reason: 'no_potion' };
  }

  // ==================== 地图系统 ====================

  async _switchMap(direction) {
    const p = this.client.player;
    const gameData = this.client.gameData;
    if (!p || !gameData || !gameData.maps) return { invalid: true };

    const currentMapId = p.current_map_id || 1;
    const maps = [...gameData.maps].sort((a, b) => a.level - b.level);
    let targetMap = null;

    if (direction === 'higher') {
      for (const map of maps) {
        if (map.level > (p.level || 1) && map.id !== currentMapId) {
          targetMap = map; break;
        }
      }
      if (!targetMap) {
        for (const map of maps) {
          if (map.id !== currentMapId && map.level > (maps.find(m => m.id === currentMapId)?.level || 0)) {
            targetMap = map; break;
          }
        }
      }
    } else {
      for (const map of [...maps].reverse()) {
        if (map.level <= (p.level || 1) && map.id !== currentMapId) {
          targetMap = map; break;
        }
      }
      if (!targetMap) targetMap = maps[0];
    }

    if (targetMap) {
      // 记录已探索的地图ID集合
      if (!this.exploredMaps) this.exploredMaps = new Set();
      const isNewMap = !this.exploredMaps.has(targetMap.id);

      const r = await this.client.setMap(targetMap.id);
      if (r.ok) {
        // 标记为已探索
        this.exploredMaps.add(targetMap.id);
        return { mapChanged: true, mapName: targetMap.name, newMapExplored: isNewMap };
      }
    }
    return { invalid: true };
  }

  // ==================== 升级/突破 ====================

  async _doLevelUp() {
    const p = this.client.player;
    if (!p) return { invalid: true };
    if ((p.exp || 0) >= (p.max_exp || Infinity)) {
      const r = await this.client.levelUp();
      if (r.ok) return { leveledUp: true, newLevel: r.player.level };
    }
    return { invalid: true, reason: 'exp_not_enough' };
  }

  async _doBreakthrough() {
    const r = await this.client.breakthrough();
    if (r.ok) return { breakthrough: true, success: r.success };
    return { invalid: true, error: r.error };
  }

  // ==================== 装备系统 ====================

  async _optimizeEquipment() {
    let changes = 0;
    await this.client.sortInventory();
    const inventory = this.client.getInventory();
    const p = this.client.player;
    if (!p) return { invalid: true };

    // 装备高品质物品
    const equippable = inventory.filter(i =>
      ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back', 'equipment', 'armor'].includes(i.type)
    ).sort((a, b) => (b.item.quality || 1) - (a.item.quality || 1));

    for (const item of equippable.slice(0, 3)) {
      const r = await this.client.equip(item.page, item.slot, item.id);
      if (r.ok) changes++;
    }

    // 分解低品质装备
    const lowQuality = inventory.filter(i =>
      ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back', 'equipment', 'armor'].includes(i.type) &&
      (i.item.quality || 1) <= 2
    );
    for (const item of lowQuality.slice(0, 5)) {
      await this.client.decomposeEquipment(item.page, item.slot, item.id);
    }

    return { equipped: changes > 0, decomposed: lowQuality.length > 0 };
  }

  // ==================== 邮件系统 ====================

  async _claimMail() {
    const r = await this.client.mailClaimAll();
    if (r.ok) return { mailClaimed: true, count: r.claimed_count || 0 };
    return { invalid: true };
  }

  // ==================== 同步/等待 ====================

  async _doSync() {
    const r = await this.client.sync('fast');
    if (r.ok) return { synced: true };
    return { invalid: true };
  }

  // ==================== 自动战斗 ====================

  async _toggleAutoBattle() {
    const p = this.client.player;
    if (!p) return { invalid: true };
    const newState = !p.auto_battle_enabled;
    const r = await this.client.battleSetAutoRestart(newState, p.current_map_id || 1);
    if (r.ok) return { autoBattle: newState };
    return { invalid: true };
  }

  // ==================== 炼丹系统 ====================

  async _doAlchemy() {
    const now = Date.now();
    if (now - this.lastAlchemyTime < 30000) return { invalid: true, reason: 'cooldown' };
    this.lastAlchemyTime = now;

    const inventory = this.client.getInventory();
    const gameData = this.client.gameData;

    // 找炼丹材料（草药类）
    const herbs = inventory.filter(i =>
      i.type === 'material' || i.type === 'herb' || i.name.includes('草') || i.name.includes('花') || i.name.includes('果')
    );

    if (herbs.length < 3) return { invalid: true, reason: 'not_enough_materials' };

    // 取前3个材料炼丹
    const ingredients = herbs.slice(0, 3).map(h => ({
      item_id: h.id,
      count: Math.min(h.count || 1, 5)
    }));

    const r = await this.client.alchemyStart(ingredients, 1);
    if (r.ok) return { alchemyDone: true, result: r };
    return { invalid: true, error: r.error };
  }

  // ==================== 锻造系统 ====================

  async _doForging() {
    const now = Date.now();
    if (now - this.lastForgingTime < 60000) return { invalid: true, reason: 'cooldown' };
    this.lastForgingTime = now;

    const inventory = this.client.getInventory();
    // 找锻造主材料（矿石/灵材类）
    const mainMats = inventory.filter(i =>
      i.name.includes('灵') || i.name.includes('矿') || i.name.includes('铁') || i.name.includes('晶') ||
      i.type === 'ore' || i.type === 'material'
    );

    if (mainMats.length < 2) return { invalid: true, reason: 'not_enough_materials' };

    const mainItem = mainMats[0];
    const lingItem = mainMats[1];

    const r = await this.client.forgingStart(
      'weapon', mainItem.id, Math.min(mainItem.count || 1, 5),
      lingItem.id, 0
    );
    if (r.ok) return { forged: true, result: r };
    return { invalid: true, error: r.error };
  }

  async _doForgingUpgrade() {
    const inventory = this.client.getInventory();
    const weapons = inventory.filter(i => i.type === 'weapon' && i.item.quality >= 2);
    if (weapons.length === 0) return { invalid: true, reason: 'no_weapon_to_upgrade' };

    const mats = inventory.filter(i => i.type === 'material' || i.name.includes('灵'));
    if (mats.length === 0) return { invalid: true, reason: 'no_material' };

    const weapon = weapons[0];
    const mat = mats[0];

    const r = await this.client.forgingUpgrade(
      weapon.page, weapon.slot, mat.id, Math.min(mat.count || 1, 3), 'level'
    );
    if (r.ok) return { forged: true, upgradeDone: true };
    return { invalid: true, error: r.error };
  }

  async _doForgingReroll() {
    const inventory = this.client.getInventory();
    const weapons = inventory.filter(i => i.type === 'weapon' && i.item.quality >= 3);
    if (weapons.length === 0) return { invalid: true, reason: 'no_weapon_to_reroll' };

    const lingMats = inventory.filter(i => i.name.includes('灵') || i.name.includes('晶'));
    if (lingMats.length === 0) return { invalid: true, reason: 'no_ling_material' };

    const weapon = weapons[0];
    const ling = lingMats[0];

    const r = await this.client.forgingReroll(weapon.page, weapon.slot, ling.id);
    if (r.ok) return { forged: true, rerollDone: true };
    return { invalid: true, error: r.error };
  }

  // ==================== 洞府系统 ====================

  async _doCaveGather() {
    try {
      // 先检查洞府状态
      const status = await this.client.caveStatus();
      if (status.ok && status.cave) {
        // 如果正在采集，尝试收获
        if (status.cave.gathering) {
          const stopR = await this.client.caveStop();
          if (stopR.ok && stopR.rewards) {
            return { collected: true, rewards: stopR.rewards };
          }
          return { invalid: true, reason: 'already_gathering' };
        }
        // 开始采集（优先灵田）
        const startR = await this.client.caveStart('field');
        if (startR.ok) return { collected: true, gathering: true };
        // 尝试矿脉
        const mineR = await this.client.caveStart('mine');
        if (mineR.ok) return { collected: true, gathering: true };
      }
      return { invalid: true, reason: 'cave_not_available' };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doCaveUpgrade() {
    try {
      const r = await this.client.caveUpgrade();
      if (r.ok) return { caveUpgraded: true, newLevel: r.cave?.level };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doCaveFormation() {
    try {
      const status = await this.client.caveStatus();
      if (!status.ok || !status.cave) return { invalid: true, reason: 'cave_not_available' };

      const cave = status.cave;
      // 如果有阵盘碎片，尝试放置
      if (cave.plates && cave.plates.length > 0) {
        const plate = cave.plates[0];
        const r = await this.client.caveFormationPlace(plate.uid, 0);
        if (r.ok) return { formationDone: true };
      }
      // 尝试设置阵法服务
      if (cave.formation && cave.formation.runtime) {
        const services = cave.formation.runtime.services || [];
        for (const svc of services) {
          if (!svc.active) {
            const r = await this.client.caveFormationServiceSet(svc.skill_id, true, svc.instance_key);
            if (r.ok) return { formationDone: true, serviceActivated: true };
          }
        }
      }
      return { invalid: true, reason: 'nothing_to_do' };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 传人系统 ====================

  async _doCreateDisciple() {
    if (this.hasCreatedDisciple) return { invalid: true, reason: 'already_created' };
    try {
      const status = await this.client.discipleStatus();
      if (status.ok && status.disciple && status.disciple.name) {
        this.hasCreatedDisciple = true;
        return { invalid: true, reason: 'already_has_disciple' };
      }
      const r = await this.client.discipleCreate('AI传人');
      if (r.ok) {
        this.hasCreatedDisciple = true;
        return { discipleCreated: true };
      }
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doSendDisciple() {
    try {
      const status = await this.client.discipleStatus();
      if (!status.ok || !status.disciple) return { invalid: true, reason: 'no_disciple' };
      if (status.disciple.expedition) return { invalid: true, reason: 'already_sent' };

      const mapId = this.client.getRecommendedMap();
      const r = await this.client.discipleSend(mapId, 'all');
      if (r.ok) return { discipleSent: true };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doRecallDisciple() {
    try {
      const status = await this.client.discipleStatus();
      if (!status.ok || !status.disciple) return { invalid: true, reason: 'no_disciple' };
      if (!status.disciple.expedition) return { invalid: true, reason: 'not_sent' };

      const r = await this.client.discipleRecall();
      if (r.ok && r.collected) return { discipleRecalled: true, rewards: r.collected };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 宗门系统 ====================

  async _doSectContribute() {
    const p = this.client.player;
    if (!p || !p.sect_id) return { invalid: true, reason: 'no_sect' };

    try {
      const inventory = this.client.getInventory();
      // 找可贡献的物品（材料类）
      const contribItems = inventory.filter(i =>
        i.type === 'material' && (i.count || 1) >= 5
      );
      if (contribItems.length > 0) {
        const item = contribItems[0];
        const r = await this.client.sectContribute(item.id, Math.min(item.count || 1, 10));
        if (r.ok) return { sectContributed: true };
      }
      return { invalid: true, reason: 'no_items_to_contribute' };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doSectLearn() {
    const p = this.client.player;
    if (!p || !p.sect_id) return { invalid: true, reason: 'no_sect' };

    try {
      // 先尝试学习功法（technique），功法对战力提升更大
      const r2 = await this.client.sectLearn('technique', 0, 100, 1);
      if (r2.ok) return { sectLearned: true, techniqueEquipped: true };
      // 再尝试学习宗门技能
      const r = await this.client.sectLearn('skill', 0, 100, 1);
      if (r.ok) return { sectLearned: true, skillEquipped: true };
      return { invalid: true, error: r.error || r2.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doSectTask() {
    const p = this.client.player;
    if (!p || !p.sect_id) return { invalid: true, reason: 'no_sect' };

    const now = Date.now();
    if (now - this.lastSectTaskTime < 60000) return { invalid: true, reason: 'cooldown' };
    this.lastSectTaskTime = now;

    try {
      // 获取宗门任务列表
      const tasks = await this.client.sectTasks();
      if (tasks.ok && tasks.tasks) {
        // 找可完成的任务
        for (let i = 0; i < tasks.tasks.length; i++) {
          const task = tasks.tasks[i];
          if (task.status === 'completed') {
            const r = await this.client.sectTaskComplete(i);
            if (r.ok) return { sectTaskDone: true, reward: r.rewards };
          } else if (task.status === 'available') {
            const r = await this.client.sectTaskAccept(i);
            if (r.ok) return { sectTaskDone: true, accepted: true };
          }
        }
      }
      return { invalid: true, reason: 'no_tasks' };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 联盟系统 ====================

  async _doAllianceBless() {
    const p = this.client.player;
    if (!p || !p.alliance_id) return { invalid: true, reason: 'no_alliance' };

    try {
      const r = await this.client.allianceBless(p.alliance_id, 1);
      if (r.ok) return { allianceActivity: true, type: 'bless' };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doAllianceBathe() {
    const p = this.client.player;
    if (!p || !p.alliance_id) return { invalid: true, reason: 'no_alliance' };

    try {
      const r = await this.client.allianceBathe(p.alliance_id);
      if (r.ok) return { allianceActivity: true, type: 'bathe' };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doAllianceGarden() {
    const p = this.client.player;
    if (!p || !p.alliance_id) return { invalid: true, reason: 'no_alliance' };

    try {
      const r = await this.client.allianceGardenPick(p.alliance_id);
      if (r.ok) return { allianceActivity: true, type: 'garden' };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  async _doAllianceMeditate() {
    const p = this.client.player;
    if (!p || !p.alliance_id) return { invalid: true, reason: 'no_alliance' };

    try {
      const r = await this.client.allianceMeditate(p.alliance_id);
      if (r.ok) return { allianceActivity: true, type: 'meditate' };
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 副本系统 ====================

  async _doDungeon() {
    const now = Date.now();
    if (now - this.lastDungeonTime < 120000) return { invalid: true, reason: 'cooldown' };
    this.lastDungeonTime = now;

    try {
      const list = await this.client.dungeonList();
      if (!list.ok || !list.dungeons || list.dungeons.length === 0) {
        return { invalid: true, reason: 'no_dungeons' };
      }

      // 选第一个适合等级的副本
      const pLevel = this.client.player ? this.client.player.level || 1 : 1;
      const targetDungeon = list.dungeons.find(d =>
        d.min_level <= pLevel && d.max_level >= pLevel
      ) || list.dungeons[0];

      const r = await this.client.dungeonBattleStart(targetDungeon.id);
      if (r.ok && r.battleId) {
        // 推进战斗
        const adv = await this.client.dungeonBattleAdvance(r.battleId);
        if (adv.ok) return { dungeonDone: true, result: adv };
        return { dungeonDone: true, started: true };
      }
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 试炼系统 ====================

  async _doTrial() {
    const now = Date.now();
    if (now - this.lastTrialTime < 120000) return { invalid: true, reason: 'cooldown' };
    this.lastTrialTime = now;

    try {
      const contracts = await this.client.trialContracts();
      if (!contracts.ok) return { invalid: true, reason: 'trial_not_available' };

      const r = await this.client.trialStart();
      if (r.ok && r.battleId) {
        const adv = await this.client.trialAdvance(r.battleId);
        if (adv.ok) return { trialDone: true, result: adv };
        return { trialDone: true, started: true };
      }
      return { invalid: true, error: r.error };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 交易所系统 ====================

  async _doExchange() {
    const now = Date.now();
    if (now - this.lastExchangeTime < 60000) return { invalid: true, reason: 'cooldown' };
    this.lastExchangeTime = now;

    try {
      // 查看交易所列表
      const listings = await this.client.exchangeListings(1, 5, { sort_by: 'price_asc' });
      if (listings.ok && listings.listings && listings.listings.length > 0) {
        // 买最便宜的物品
        const cheap = listings.listings[0];
        const r = await this.client.exchangeBuy(cheap.id, 1);
        if (r.ok) return { exchangeDone: true, bought: true };
      }

      // 如果没钱买，尝试卖东西
      const inventory = this.client.getInventory();
      const sellable = inventory.filter(i =>
        i.type === 'material' && (i.count || 1) >= 10
      );
      if (sellable.length > 0) {
        const item = sellable[0];
        const price = Math.max(100, (item.item.quality || 1) * 50);
        const r = await this.client.exchangeCreateListing(
          item.page, item.slot, Math.min(item.count || 1, 5), price, item.id
        );
        if (r.ok) return { exchangeDone: true, listed: true };
      }

      return { invalid: true, reason: 'nothing_to_trade' };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }

  // ==================== 结束判断 ====================

  _isDone() {
    const p = this.client.player;
    if (!p) return true;
    if ((p.level || 1) >= this.options.levelTarget) return true;
    if (this.stepCount >= this.options.maxStepsPerEpisode) return true;
    if (this.consecutiveLosses >= 20) return true;
    return false;
  }

  // ==================== 重置环境 ====================

  async reset() {
    this.stepCount = 0;
    this.episodeCount++;
    this.totalReward = 0;
    this.prevLevel = 1;
    this.prevExp = 0;
    this.prevSpiritStones = 0;
    this.battleWinCount = 0;
    this.battleLossCount = 0;
    this.consecutiveWins = 0;
    this.consecutiveLosses = 0;
    this.lastBattleResult = null;
    this.actionHistory = [];
    this.rewardHistory = [];

    // 重置游戏进度追踪
    this.hasCreatedDisciple = false;
    this.lastCaveCollectTime = 0;
    this.lastSectTaskTime = 0;
    this.lastAllianceActivityTime = 0;
    this.lastAlchemyTime = 0;
    this.lastForgingTime = 0;
    this.lastExchangeTime = 0;
    this.lastDungeonTime = 0;
    this.lastTrialTime = 0;
    this.lastLeagueTime = 0;

    // 重置已探索地图记录
    this.exploredMaps = new Set();

    try {
      await this.client.sync('heavy');
    } catch (e) {
      console.warn('[Env] reset sync failed:', e.message);
    }

    return this.getState();
  }

  /** 获取状态维度 */
  getStateSize() {
    return 50;
  }

  /** 获取动作数量 */
  getActionSize() {
    return 35;
  }

  /** 获取训练统计 */
  getStats() {
    return {
      episode: this.episodeCount,
      steps: this.stepCount,
      totalReward: this.totalReward,
      level: this.client.player ? this.client.player.level : 0,
      winRate: this.battleWinCount + this.battleLossCount > 0
        ? (this.battleWinCount / (this.battleWinCount + this.battleLossCount)).toFixed(3)
        : 0,
      consecutiveWins: this.consecutiveWins,
      spiritStones: this.client.player ? this.client.player.spirit_stones : 0
    };
  }
}

module.exports = GameEnvironment;