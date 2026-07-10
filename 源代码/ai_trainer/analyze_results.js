/**
 * 训练结果分析工具
 * 分析训练数据、模型性能、生成报告
 */

const fs = require('fs');
const path = require('path');

class ResultAnalyzer {
  constructor(dataDir = './training_data', modelDir = './models') {
    this.dataDir = dataDir;
    this.modelDir = modelDir;
  }

  /** 分析训练日志 */
  analyzeLogs(logFile) {
    if (!fs.existsSync(logFile)) {
      console.error(`日志文件不存在: ${logFile}`);
      return null;
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    
    const episodes = [];
    let currentEpisode = null;

    for (const line of lines) {
      if (line.includes('Episode ')) {
        if (currentEpisode) episodes.push(currentEpisode);
        const match = line.match(/Episode (\d+)\/(\d+)/);
        currentEpisode = {
          num: match ? parseInt(match[1]) : 0,
          bots: [],
          timestamp: line.slice(1, 9)
        };
      } else if (currentEpisode && line.includes('Bot')) {
        const botMatch = line.match(/Bot(\d+)/);
        const levelMatch = line.match(/等级=(\d+)/);
        const rewardMatch = line.match(/奖励=([\d.-]+)/);
        const winRateMatch = line.match(/胜率=([\d.]+)%/);
        const epsilonMatch = line.match(/ε=([\d.]+)/);
        const stepsMatch = line.match(/步数=(\d+)/);
        
        if (botMatch) {
          currentEpisode.bots.push({
            botIndex: parseInt(botMatch[1]),
            level: levelMatch ? parseInt(levelMatch[1]) : 0,
            reward: rewardMatch ? parseFloat(rewardMatch[1]) : 0,
            winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
            epsilon: epsilonMatch ? parseFloat(epsilonMatch[1]) : 1,
            steps: stepsMatch ? parseInt(stepsMatch[1]) : 0
          });
        }
      }
    }
    if (currentEpisode) episodes.push(currentEpisode);

    return episodes;
  }

  /** 生成训练报告 */
  generateReport(episodes) {
    if (!episodes || episodes.length === 0) {
      return '没有训练数据';
    }

    const report = [];
    report.push('='.repeat(60));
    report.push('艾德尔修仙传 AI 训练报告');
    report.push('='.repeat(60));
    report.push(`总 Episode 数: ${episodes.length}`);
    
    // 分析每个Bot
    const botStats = {};
    for (const ep of episodes) {
      for (const bot of ep.bots) {
        if (!botStats[bot.botIndex]) {
          botStats[bot.botIndex] = {
            levels: [],
            rewards: [],
            winRates: [],
            epsilons: []
          };
        }
        botStats[bot.botIndex].levels.push(bot.level);
        botStats[bot.botIndex].rewards.push(bot.reward);
        botStats[bot.botIndex].winRates.push(bot.winRate);
        botStats[bot.botIndex].epsilons.push(bot.epsilon);
      }
    }

    for (const [botIndex, stats] of Object.entries(botStats)) {
      report.push(`\n--- Bot ${botIndex} ---`);
      report.push(`  初始等级: ${stats.levels[0] || 0}`);
      report.push(`  最终等级: ${stats.levels[stats.levels.length - 1] || 0}`);
      report.push(`  等级提升: ${(stats.levels[stats.levels.length - 1] || 0) - (stats.levels[0] || 0)}`);
      
      const avgReward = stats.rewards.reduce((a, b) => a + b, 0) / stats.rewards.length;
      const maxReward = Math.max(...stats.rewards);
      report.push(`  平均奖励: ${avgReward.toFixed(2)}`);
      report.push(`  最大奖励: ${maxReward.toFixed(2)}`);
      
      const finalWinRate = stats.winRates[stats.winRates.length - 1] || 0;
      report.push(`  最终胜率: ${finalWinRate}%`);
      
      report.push(`  最终探索率: ${(stats.epsilons[stats.epsilons.length - 1] || 1).toFixed(4)}`);
    }

    // 学习曲线摘要
    report.push('\n--- 学习曲线 ---');
    const midPoint = Math.floor(episodes.length / 2);
    const firstHalf = episodes.slice(0, midPoint);
    const secondHalf = episodes.slice(midPoint);
    
    const calcAvgLevel = (eps) => {
      const levels = eps.flatMap(e => e.bots.map(b => b.level));
      return levels.length > 0 ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1) : 0;
    };
    
    const calcAvgReward = (eps) => {
      const rewards = eps.flatMap(e => e.bots.map(b => b.reward));
      return rewards.length > 0 ? (rewards.reduce((a, b) => a + b, 0) / rewards.length).toFixed(1) : 0;
    };

    report.push(`  前半段平均等级: ${calcAvgLevel(firstHalf)}`);
    report.push(`  后半段平均等级: ${calcAvgLevel(secondHalf)}`);
    report.push(`  前半段平均奖励: ${calcAvgReward(firstHalf)}`);
    report.push(`  后半段平均奖励: ${calcAvgReward(secondHalf)}`);
    
    const improvement = calcAvgLevel(secondHalf) - calcAvgLevel(firstHalf);
    report.push(`  学习效果: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)} 级提升`);
    
    report.push('\n' + '='.repeat(60));
    
    return report.join('\n');
  }

  /** 分析模型文件 */
  analyzeModel(modelPath) {
    if (!fs.existsSync(modelPath)) {
      return { error: '模型文件不存在' };
    }
    
    const data = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    return {
      episodes: data.stats?.episodes || 0,
      totalReward: data.stats?.totalReward || 0,
      avgReward: data.stats?.avgReward || 0,
      maxReward: data.stats?.maxReward || 0,
      epsilon: data.epsilon,
      trainingSteps: data.trainingSteps,
      networkStructure: data.policyNet?.layerSizes || 'unknown'
    };
  }

  /** 运行完整分析 */
  run() {
    console.log('=== 训练结果分析 ===\n');

    // 分析最新的日志文件
    const logDir = path.join(this.dataDir, '..', 'logs');
    if (fs.existsSync(logDir)) {
      const logFiles = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();
      
      if (logFiles.length > 0) {
        const latestLog = path.join(logDir, logFiles[0]);
        console.log(`分析日志: ${latestLog}`);
        const episodes = this.analyzeLogs(latestLog);
        if (episodes && episodes.length > 0) {
          console.log(this.generateReport(episodes));
        } else {
          console.log('日志中没有找到训练数据');
        }
      }
    }

    // 分析模型文件
    console.log('\n=== 模型分析 ===\n');
    if (fs.existsSync(this.modelDir)) {
      const modelFiles = fs.readdirSync(this.modelDir).filter(f => f.endsWith('.json'));
      if (modelFiles.length > 0) {
        for (const modelFile of modelFiles) {
          const modelPath = path.join(this.modelDir, modelFile);
          const analysis = this.analyzeModel(modelPath);
          console.log(`模型: ${modelFile}`);
          console.log(`  Episodes: ${analysis.episodes}`);
          console.log(`  平均奖励: ${analysis.avgReward.toFixed(2)}`);
          console.log(`  最大奖励: ${analysis.maxReward.toFixed(2)}`);
          console.log(`  探索率: ${analysis.epsilon.toFixed(4)}`);
          console.log(`  训练步数: ${analysis.trainingSteps}`);
          console.log(`  网络结构: ${analysis.networkStructure}`);
          console.log('');
        }
      } else {
        console.log('没有找到模型文件');
      }
    }
  }
}

// 直接运行
if (require.main === module) {
  const analyzer = new ResultAnalyzer();
  analyzer.run();
}

module.exports = ResultAnalyzer;
