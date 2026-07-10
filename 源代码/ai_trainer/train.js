/**
 * 艾德尔修仙传 AI 机器人主训练脚本
 * 
 * 功能：
 * 1. 自动启动/连接游戏服务器
 * 2. 创建多个训练账号
 * 3. 使用DQN强化学习训练机器人
 * 4. 自动保存模型和训练数据
 * 5. 支持断点续训
 * 
 * 使用方法：
 *   node train.js              # 开始训练
 *   node train.js --load       # 加载已有模型继续训练
 *   node train.js --episodes 100  # 指定训练轮数
 */

const fs = require('fs');
const path = require('path');
const GameClient = require('./game_client');
const GameEnvironment = require('./game_environment');
const { DQNAgent } = require('./dqn_agent');

// ==================== 配置 ====================

const CONFIG = {
  // 服务器配置
  serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
  
  // 训练账号配置
  accounts: [
    { username: 'ai_bot_01', password: 'bot123456', name: 'AI修仙者·壹' },
    { username: 'ai_bot_02', password: 'bot123456', name: 'AI修仙者·贰' },
    { username: 'ai_bot_03', password: 'bot123456', name: 'AI修仙者·叁' },
    { username: 'ai_bot_04', password: 'bot123456', name: 'AI修仙者·肆' },
    { username: 'ai_bot_05', password: 'bot123456', name: 'AI修仙者·伍' },
  ],

  // DQN超参数
  dqn: {
    learningRate: 0.001,
    gamma: 0.95,
    epsilon: 1.0,
    epsilonMin: 0.01,
    epsilonDecay: 0.998,
    batchSize: 64,
    memorySize: 100000,
    targetUpdateInterval: 100
  },

  // 训练参数
  training: {
    maxEpisodes: process.env.EPISODES ? parseInt(process.env.EPISODES) : 1000,
    maxStepsPerEpisode: 1000,    // 增加步数上限，因为动作空间更大
    targetLevel: 400,
    saveInterval: 10,            // 每N个episode保存一次
    evalInterval: 50,            // 每N个episode评估一次
    parallelBots: 2,             // 并行训练的机器人数量
    // 新增：游戏功能训练参数
    minLevelForSect: 10,         // 最低等级加入宗门
    minLevelForAlliance: 30,     // 最低等级加入联盟
    minLevelForCave: 20,         // 最低等级开启洞府
    minLevelForDisciple: 40,     // 最低等级收传人
    minLevelForDungeon: 50,      // 最低等级进入副本
    minLevelForTrial: 60,        // 最低等级进入试炼
    minLevelForLeague: 70,       // 最低等级参加联赛
    minLevelForForging: 15,      // 最低等级锻造
    minLevelForAlchemy: 10,      // 最低等级炼丹
    minLevelForExchange: 20,     // 最低等级交易所
    // 冷却时间配置（秒）
    cooldowns: {
      alchemy: 30,
      forging: 60,
      sectTask: 60,
      exchange: 60,
      dungeon: 120,
      trial: 120,
      caveGather: 10,
      caveUpgrade: 30,
      discipleSend: 30,
      allianceBless: 10,
      allianceBathe: 10,
      allianceGarden: 10,
      allianceMeditate: 10,
    }
  },

  // 文件路径
  paths: {
    modelDir: './models',
    dataDir: './training_data',
    logDir: './logs'
  }
};

// ==================== 训练管理器 ====================

class TrainingManager {
  constructor() {
    this.config = CONFIG;
    this.agents = new Map();
    this.envs = new Map();
    this.globalStep = 0;
    this.startTime = Date.now();
    
    // 创建目录
    for (const dir of Object.values(this.config.paths)) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    
    // 设置日志
    this.logFile = path.join(this.config.paths.logDir, `train_${new Date().toISOString().slice(0, 10)}.log`);
    this.log(`[启动] 艾德尔修仙传 AI 训练系统 v1.0`);
    this.log(`[配置] 服务器: ${this.config.serverUrl}`);
    this.log(`[配置] 账号数: ${this.config.accounts.length}, 并行: ${this.config.training.parallelBots}`);
    this.log(`[配置] 最大轮数: ${this.config.training.maxEpisodes}`);

    // 训练优化追踪
    this.botStats = new Map(); // botIndex -> { avgRewardHistory, levelHistory, stagnationCount }
  }

  log(msg) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try {
      fs.appendFileSync(this.logFile, line + '\n');
    } catch (e) {}
  }

  /** 初始化一个机器人 */
  async initBot(accountConfig, botIndex) {
    const client = new GameClient(this.config.serverUrl);
    const env = new GameEnvironment(client, {
      maxStepsPerEpisode: this.config.training.maxStepsPerEpisode,
      levelTarget: this.config.training.targetLevel
    });

    // 尝试登录
    this.log(`[Bot${botIndex}] 登录 ${accountConfig.username}...`);
    let loginResult = await client.login(accountConfig.username, accountConfig.password);
    
    if (!loginResult.ok) {
      // 注册
      this.log(`[Bot${botIndex}] 注册新账号 ${accountConfig.username}...`);
      const regResult = await client.register(accountConfig.username, accountConfig.password);
      if (!regResult.ok) {
        throw new Error(`注册失败: ${regResult.error}`);
      }
      
      // 创建角色
      this.log(`[Bot${botIndex}] 创建角色 ${accountConfig.name}...`);
      const createResult = await client.createCharacter(accountConfig.name);
      if (!createResult.ok) {
        throw new Error(`创建角色失败: ${createResult.error}`);
      }
      this.log(`[Bot${botIndex}] 角色创建成功!`);
    } else {
      this.log(`[Bot${botIndex}] 登录成功! accountId=${client.accountId}`);
    }

    // 同步数据
    await client.sync('heavy');
    
    // 获取游戏数据
    await client.getGameData();

    // 初始化DQN智能体
    const stateSize = env.getStateSize();
    const actionSize = env.getActionSize();
    
    let agent = new DQNAgent(stateSize, actionSize, this.config.dqn);
    
    // 尝试加载已有模型
    const modelPath = path.join(this.config.paths.modelDir, `bot_${botIndex}_model.json`);
    if (fs.existsSync(modelPath)) {
      agent.loadModel(modelPath);
      this.log(`[Bot${botIndex}] 加载已有模型: ${modelPath}`);
    }

    return { client, env, agent, botIndex };
  }

  /** 训练一个episode（含早停机制和停滞检测） */
  async trainEpisode(botData) {
    const { env, agent, botIndex } = botData;
    let state = await env.reset();
    let totalReward = 0;
    let episodeSteps = 0;

    // 早停机制：连续无正奖励步数计数
    let consecutiveNoPositiveReward = 0;
    const maxNoPositiveRewardSteps = 50; // 连续50步无正奖励则提前结束

    // 等级停滞检测
    let lastCheckLevel = 1;
    let levelStagnationSteps = 0;
    const maxLevelStagnationSteps = 200; // 连续200步等级未提升则调整策略

    while (true) {
      // 等级停滞检测：如果等级长时间未提升，增加探索率
      const currentLevel = env.client.player ? env.client.player.level : 1;
      if (currentLevel <= lastCheckLevel) {
        levelStagnationSteps++;
      } else {
        levelStagnationSteps = 0;
        lastCheckLevel = currentLevel;
      }

      // 如果检测到等级停滞，临时提高探索率
      if (levelStagnationSteps > maxLevelStagnationSteps) {
        // 临时提高探索率，鼓励尝试新策略
        agent.epsilon = Math.min(agent.epsilon + 0.1, 0.5);
        this.log(`  [Bot${botIndex}] ⚠ 等级停滞${levelStagnationSteps}步，提高探索率至 ${agent.epsilon.toFixed(3)}`);
        levelStagnationSteps = 0; // 重置计数器，避免重复触发
      }

      // 选择动作
      const action = agent.selectAction(state);
      
      // 执行动作
      const { state: nextState, reward, done, info } = await env.step(action);
      
      // 存储经验
      agent.remember(state, action, reward, nextState, done);
      
      // 训练
      const loss = agent.train();
      
      state = nextState;
      totalReward += reward;
      episodeSteps++;

      // 早停检测：连续无正奖励
      if (reward <= 0) {
        consecutiveNoPositiveReward++;
      } else {
        consecutiveNoPositiveReward = 0;
      }

      // 每10步输出状态
      if (episodeSteps % 10 === 0) {
        const stats = env.getStats();
        this.log(`  [Bot${botIndex}] 步${episodeSteps}: ${info.action} | 等级${stats.level} | 奖励=${reward.toFixed(1)} | ε=${agent.epsilon.toFixed(3)}`);
      }

      // 早停：连续N步无正奖励，提前结束该episode
      if (consecutiveNoPositiveReward >= maxNoPositiveRewardSteps) {
        this.log(`  [Bot${botIndex}] ⏹ 早停: 连续${consecutiveNoPositiveReward}步无正奖励，提前结束`);
        break;
      }

      if (done) break;
      
      // 防止死循环
      if (episodeSteps > this.config.training.maxStepsPerEpisode * 2) break;
    }

    agent.endEpisode(totalReward);
    this.globalStep += episodeSteps;

    return {
      botIndex,
      episodeSteps,
      totalReward: totalReward.toFixed(1),
      level: env.client.player ? env.client.player.level : 0,
      winRate: env.battleWinCount + env.battleLossCount > 0
        ? (env.battleWinCount / (env.battleWinCount + env.battleLossCount) * 100).toFixed(1)
        : '0.0',
      epsilon: agent.epsilon.toFixed(4),
      avgReward: agent.stats.avgReward.toFixed(1),
      memorySize: agent.memory.size()
    };
  }

  /** 评估模型 */
  async evaluate(botData) {
    const { env, agent, botIndex } = botData;
    const originalEpsilon = agent.epsilon;
    agent.epsilon = 0.05; // 评估时少量探索

    let totalReward = 0;
    let wins = 0;
    let losses = 0;
    const evalEpisodes = 5;

    for (let i = 0; i < evalEpisodes; i++) {
      let state = await env.reset();
      let epReward = 0;
      let done = false;
      let steps = 0;

      while (!done && steps < 200) {
        const action = agent.selectAction(state);
        const result = await env.step(action);
        state = result.state;
        epReward += result.reward;
        done = result.done;
        steps++;
        
        if (result.info.battleWin) wins++;
        if (result.info.battleLoss) losses++;
      }
      totalReward += epReward;
    }

    agent.epsilon = originalEpsilon;

    return {
      avgReward: (totalReward / evalEpisodes).toFixed(1),
      winRate: wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0.0',
      level: env.client.player ? env.client.player.level : 0
    };
  }

  /** 保存所有模型 */
  saveModels() {
    for (const [botIndex, botData] of this.bots) {
      const modelPath = path.join(this.config.paths.modelDir, `bot_${botIndex}_model.json`);
      botData.agent.saveModel(modelPath);
    }
    this.log(`[保存] 所有模型已保存`);
  }

  /** 主训练循环（含epsilon衰减重置和阶段性目标检测） */
  async run() {
    this.log(`[开始] 初始化 ${this.config.training.parallelBots} 个并行机器人...`);

    // 初始化机器人
    this.bots = new Map();
    for (let i = 0; i < this.config.training.parallelBots; i++) {
      const accountConfig = this.config.accounts[i % this.config.accounts.length];
      try {
        const botData = await this.initBot(accountConfig, i);
        this.bots.set(i, botData);
        this.log(`[Bot${i}] 初始化完成`);

        // 初始化每个机器人的训练统计追踪
        this.botStats.set(i, {
          avgRewardHistory: [],
          levelHistory: [],
          stagnationCount: 0,
          lastAvgReward: 0,
          episodesSinceReset: 0
        });
      } catch (e) {
        this.log(`[Bot${i}] 初始化失败: ${e.message}`);
      }
    }

    if (this.bots.size === 0) {
      this.log('[错误] 没有可用的机器人，退出');
      return;
    }

    this.log(`[训练] 开始训练! 共 ${this.bots.size} 个机器人`);
    this.log(`[训练] 目标: ${this.config.training.maxEpisodes} episodes`);

    // 训练循环
    for (let episode = 1; episode <= this.config.training.maxEpisodes; episode++) {
      this.log(`\n========== Episode ${episode}/${this.config.training.maxEpisodes} ==========`);
      const episodeStart = Date.now();

      // 轮流训练每个机器人
      for (const [botIndex, botData] of this.bots) {
        const result = await this.trainEpisode(botData);
        
        const elapsed = ((Date.now() - episodeStart) / 1000).toFixed(1);
        this.log(
          `[Bot${botIndex}] Episode完成 | 步数=${result.episodeSteps} | ` +
          `奖励=${result.totalReward} | 等级=${result.level} | ` +
          `胜率=${result.winRate}% | ε=${result.epsilon} | ` +
          `平均奖励=${result.avgReward} | 记忆=${result.memorySize} | ` +
          `耗时=${elapsed}s`
        );

        // === epsilon衰减重置检测 ===
        const botStat = this.botStats.get(botIndex);
        if (botStat) {
          const avgRewardNum = parseFloat(result.avgReward);
          botStat.avgRewardHistory.push(avgRewardNum);
          botStat.levelHistory.push(result.level);
          botStat.episodesSinceReset++;

          // 保留最近20个episode的记录
          if (botStat.avgRewardHistory.length > 20) botStat.avgRewardHistory.shift();
          if (botStat.levelHistory.length > 20) botStat.levelHistory.shift();

          // 检测平均奖励是否停滞：最近10个episode的平均奖励变化小于阈值
          if (botStat.avgRewardHistory.length >= 10) {
            const recentAvg = botStat.avgRewardHistory.slice(-10);
            const avgChange = Math.abs(recentAvg[recentAvg.length - 1] - recentAvg[0]);
            
            if (avgChange < 5.0 && botStat.episodesSinceReset > 20) {
              // 平均奖励停滞，重置epsilon以鼓励探索
              const oldEpsilon = botData.agent.epsilon;
              botData.agent.epsilon = Math.min(0.5, botData.agent.epsilon + 0.2);
              botStat.stagnationCount++;
              botStat.episodesSinceReset = 0;
              this.log(`  [Bot${botIndex}] 🔄 平均奖励停滞(变化=${avgChange.toFixed(1)}), 重置ε: ${oldEpsilon.toFixed(3)} → ${botData.agent.epsilon.toFixed(3)} (第${botStat.stagnationCount}次)`);
            }
          }
        }
      }

      // 定期保存
      if (episode % this.config.training.saveInterval === 0) {
        this.saveModels();
      }

      // 定期评估
      if (episode % this.config.training.evalInterval === 0) {
        this.log(`\n--- 评估阶段 (Episode ${episode}) ---`);
        for (const [botIndex, botData] of this.bots) {
          const evalResult = await this.evaluate(botData);
          this.log(`[Bot${botIndex}] 评估: 平均奖励=${evalResult.avgReward}, 胜率=${evalResult.winRate}%, 等级=${evalResult.level}`);
        }
      }

      // 输出训练摘要
      const totalElapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
      const hours = Math.floor(totalElapsed / 3600);
      const mins = Math.floor((totalElapsed % 3600) / 60);
      const secs = totalElapsed % 60;
      this.log(`[进度] Episode ${episode}/${this.config.training.maxEpisodes} | 总耗时: ${hours}h${mins}m${secs}s | 全局步数: ${this.globalStep}`);
    }

    // 最终保存
    this.saveModels();
    
    // 输出总结
    this.log(`\n========== 训练完成! ==========`);
    this.log(`总耗时: ${((Date.now() - this.startTime) / 1000).toFixed(0)}s`);
    this.log(`总步数: ${this.globalStep}`);
    
    for (const [botIndex, botData] of this.bots) {
      const level = botData.client.player ? botData.client.player.level : 0;
      const stats = botData.agent.stats;
      const botStat = this.botStats.get(botIndex);
      const stagnationInfo = botStat ? `, 停滞重置次数=${botStat.stagnationCount}` : '';
      this.log(`[Bot${botIndex}] 最终等级=${level}, Episodes=${stats.episodes}, 平均奖励=${stats.avgReward.toFixed(1)}, 最大奖励=${stats.maxReward.toFixed(1)}${stagnationInfo}`);
    }
  }
}

// ==================== 启动 ====================

async function main() {
  const args = process.argv.slice(2);
  const loadModel = args.includes('--load');
  
  if (loadModel) {
    console.log('[启动] 加载已有模型模式');
  }

  const manager = new TrainingManager();
  
  try {
    await manager.run();
  } catch (e) {
    console.error('[致命错误]', e);
    manager.log(`[致命错误] ${e.message}\n${e.stack}`);
    // 尝试保存当前模型
    try { manager.saveModels(); } catch (ex) {}
  }
}

main().catch(console.error);
