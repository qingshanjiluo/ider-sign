/**
 * duel.js - AI模型斗法系统（主入口）
 * 
 * 功能：
 * 1. 加载多个训练好的DQN模型进行对战
 * 2. 模拟完整的修仙环境（35个动作），测试AI装配技能、使用背包物品的能力
 * 3. 生成对战报告，评估模型表现
 * 
 * 用法：
 *   node duel.js <botIndex1> <botIndex2>          # 两个AI对战
 *   node duel.js --tournament                      # 所有模型循环赛
 *   node duel.js --list                            # 列出可用模型
 *   node duel.js --help                            # 帮助信息
 */

const fs = require('fs');
const { ACTIONS, formatNumber, getModelFiles, loadModelForDuel } = require('./duel_common.js');
const { CultivationSimulator } = require('./duel_simulator.js');

// ============================================================
// 斗法核心函数
// ============================================================

/**
 * 运行两个AI之间的对战
 */
function runDuel(botIndex1, botIndex2, options = {}) {
  const opts = Object.assign({
    episodes: 5,
    maxSteps: 200,
    verbose: true,
  }, options);

  console.log('\n========== 斗法开始: Bot ' + botIndex1 + ' vs Bot ' + botIndex2 + ' ==========\n');

  const agent1 = loadModelForDuel(botIndex1);
  const agent2 = loadModelForDuel(botIndex2);

  if (!agent1 || !agent2) {
    console.error('[duel] 模型加载失败，无法进行斗法');
    return null;
  }

  const env1 = new CultivationSimulator(botIndex1, { maxSteps: opts.maxSteps });
  const env2 = new CultivationSimulator(botIndex2, { maxSteps: opts.maxSteps });

  const results = {
    bot1: { botIndex: botIndex1, wins: 0, losses: 0, draws: 0, totalReward: 0, avgReward: 0, finalLevel: 0, finalBreakthrough: 0, skillsLearned: 0, itemsUsed: 0, battlesWon: 0, dungeonClears: 0, alchemyCount: 0, forgingCount: 0 },
    bot2: { botIndex: botIndex2, wins: 0, losses: 0, draws: 0, totalReward: 0, avgReward: 0, finalLevel: 0, finalBreakthrough: 0, skillsLearned: 0, itemsUsed: 0, battlesWon: 0, dungeonClears: 0, alchemyCount: 0, forgingCount: 0 },
    episodeDetails: [],
  };

  for (let ep = 0; ep < opts.episodes; ep++) {
    if (opts.verbose) console.log('--- 第 ' + (ep + 1) + ' 局 ---');

    let state1 = env1.reset();
    let state2 = env2.reset();
    let epReward1 = 0;
    let epReward2 = 0;
    let step = 0;
    const epLog = { episode: ep + 1, steps: [], finalState1: null, finalState2: null };

    while (step < opts.maxSteps) {
      const action1 = agent1.selectAction(state1);
      const result1 = env1.step(action1);
      state1 = result1.state;
      epReward1 += result1.reward;

      const action2 = agent2.selectAction(state2);
      const result2 = env2.step(action2);
      state2 = result2.state;
      epReward2 += result2.reward;

      if (step < 5 || step % 20 === 0 || env1.done || env2.done) {
        epLog.steps.push({
          step, action1: { id: action1, name: ACTIONS[action1]?.name || 'unknown' },
          action2: { id: action2, name: ACTIONS[action2]?.name || 'unknown' },
          hp1: env1.player.hp, hp2: env2.player.hp,
          level1: env1.player.level, level2: env2.player.level,
          reward1: result1.reward, reward2: result2.reward,
        });
      }
      step++;
      if (env1.done || env2.done) break;
    }

    const p1 = env1.player;
    const p2 = env2.player;

    const score1 = p1.level * 10 + p1.breakthrough * 20 + p1.stats.battlesWon * 3 +
      p1.stats.skillsLearned * 2 + p1.stats.itemsUsed + p1.stats.dungeonClears * 5 +
      p1.stats.alchemyCount * 2 + p1.stats.forgingCount * 2 + p1.spiritStones * 0.01 +
      (p1.hp / Math.max(p1.maxHp, 1)) * 5;
    const score2 = p2.level * 10 + p2.breakthrough * 20 + p2.stats.battlesWon * 3 +
      p2.stats.skillsLearned * 2 + p2.stats.itemsUsed + p2.stats.dungeonClears * 5 +
      p2.stats.alchemyCount * 2 + p2.stats.forgingCount * 2 + p2.spiritStones * 0.01 +
      (p2.hp / Math.max(p2.maxHp, 1)) * 5;

    let winner = null;
    if (p1.hp <= 0 && p2.hp <= 0) {
      results.bot1.draws++;
      results.bot2.draws++;
      if (opts.verbose) console.log('  结果: 平局 (同归于尽)');
    } else if (p1.hp <= 0) {
      winner = botIndex2;
      results.bot2.wins++;
      results.bot1.losses++;
      if (opts.verbose) console.log('  结果: Bot ' + botIndex2 + ' 胜 (Bot ' + botIndex1 + ' 死亡)');
    } else if (p2.hp <= 0) {
      winner = botIndex1;
      results.bot1.wins++;
      results.bot2.losses++;
      if (opts.verbose) console.log('  结果: Bot ' + botIndex1 + ' 胜 (Bot ' + botIndex2 + ' 死亡)');
    } else if (score1 > score2) {
      winner = botIndex1;
      results.bot1.wins++;
      results.bot2.losses++;
      if (opts.verbose) console.log('  结果: Bot ' + botIndex1 + ' 胜 (评分 ' + formatNumber(score1) + ' vs ' + formatNumber(score2) + ')');
    } else if (score2 > score1) {
      winner = botIndex2;
      results.bot2.wins++;
      results.bot1.losses++;
      if (opts.verbose) console.log('  结果: Bot ' + botIndex2 + ' 胜 (评分 ' + formatNumber(score2) + ' vs ' + formatNumber(score1) + ')');
    } else {
      results.bot1.draws++;
      results.bot2.draws++;
      if (opts.verbose) console.log('  结果: 平局');
    }

    results.bot1.totalReward += epReward1;
    results.bot2.totalReward += epReward2;
    results.bot1.finalLevel += p1.level;
    results.bot2.finalLevel += p2.level;
    results.bot1.finalBreakthrough += p1.breakthrough;
    results.bot2.finalBreakthrough += p2.breakthrough;
    results.bot1.skillsLearned += p1.stats.skillsLearned;
    results.bot2.skillsLearned += p2.stats.skillsLearned;
    results.bot1.itemsUsed += p1.stats.itemsUsed;
    results.bot2.itemsUsed += p2.stats.itemsUsed;
    results.bot1.battlesWon += p1.stats.battlesWon;
    results.bot2.battlesWon += p2.stats.battlesWon;
    results.bot1.dungeonClears += p1.stats.dungeonClears;
    results.bot2.dungeonClears += p2.stats.dungeonClears;
    results.bot1.alchemyCount += p1.stats.alchemyCount;
    results.bot2.alchemyCount += p2.stats.alchemyCount;
    results.bot1.forgingCount += p1.stats.forgingCount;
    results.bot2.forgingCount += p2.stats.forgingCount;

    epLog.finalState1 = {
      level: p1.level, hp: p1.hp, maxHp: p1.maxHp, mp: p1.mp, maxMp: p1.maxMp,
      attack: p1.attack, defense: p1.defense, breakthrough: p1.breakthrough,
      spiritStones: p1.spiritStones, skillsLearned: p1.learnedSkills.length,
      equippedSkills: p1.equippedSkills.length, hasWeapon: !!p1.weapon, hasArmor: !!p1.armor,
      inventoryCount: p1.inventory.length, stats: { ...p1.stats },
    };
    epLog.finalState2 = {
      level: p2.level, hp: p2.hp, maxHp: p2.maxHp, mp: p2.mp, maxMp: p2.maxMp,
      attack: p2.attack, defense: p2.defense, breakthrough: p2.breakthrough,
      spiritStones: p2.spiritStones, skillsLearned: p2.learnedSkills.length,
      equippedSkills: p2.equippedSkills.length, hasWeapon: !!p2.weapon, hasArmor: !!p2.armor,
      inventoryCount: p2.inventory.length, stats: { ...p2.stats },
    };
    epLog.winner = winner;
    epLog.score1 = score1;
    epLog.score2 = score2;
    epLog.totalReward1 = epReward1;
    epLog.totalReward2 = epReward2;
    results.episodeDetails.push(epLog);

    if (opts.verbose) {
      console.log('  Bot ' + botIndex1 + ': 等级' + p1.level + ' 突破' + p1.breakthrough + ' HP' + p1.hp + '/' + p1.maxHp + ' 技能' + p1.learnedSkills.length + ' 装备' + (p1.weapon ? 'V' : 'X') + '/' + (p1.armor ? 'V' : 'X') + ' 背包' + p1.inventory.length + '件');
      console.log('  Bot ' + botIndex2 + ': 等级' + p2.level + ' 突破' + p2.breakthrough + ' HP' + p2.hp + '/' + p2.maxHp + ' 技能' + p2.learnedSkills.length + ' 装备' + (p2.weapon ? 'V' : 'X') + '/' + (p2.armor ? 'V' : 'X') + ' 背包' + p2.inventory.length + '件');
      console.log('  奖励: Bot1=' + formatNumber(epReward1) + ' Bot2=' + formatNumber(epReward2) + '\n');
    }
  }

  const eps = opts.episodes;
  results.bot1.avgReward = results.bot1.totalReward / eps;
  results.bot2.avgReward = results.bot2.totalReward / eps;
  results.bot1.finalLevel /= eps;
  results.bot2.finalLevel /= eps;
  results.bot1.finalBreakthrough /= eps;
  results.bot2.finalBreakthrough /= eps;

  return results;
}

// ============================================================
// 循环赛
// ============================================================
function runTournament(options = {}) {
  const opts = Object.assign({
    episodes: 3,
    maxSteps: 150,
    verbose: true,
  }, options);

  const models = getModelFiles();
  if (models.length < 2) {
    console.error('[duel] 至少需要2个模型才能进行循环赛');
    console.log('  当前可用模型: ' + models.length + '个');
    return null;
  }

  console.log('\n========== 斗法循环赛开始 ==========');
  console.log('参与模型: ' + models.map(function(m) { return 'Bot ' + m.botIndex; }).join(', '));
  console.log('每对对战 ' + opts.episodes + ' 局\n');

  const standings = {};
  for (const m of models) {
    standings[m.botIndex] = { botIndex: m.botIndex, wins: 0, losses: 0, draws: 0, totalScore: 0, avgReward: 0 };
  }

  const matchResults = [];

  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const bi = models[i].botIndex;
      const bj = models[j].botIndex;

      console.log('\n>>> Bot ' + bi + ' vs Bot ' + bj + ' <<<');
      const result = runDuel(bi, bj, { episodes: opts.episodes, maxSteps: opts.maxSteps, verbose: opts.verbose });

      if (result) {
        standings[bi].wins += result.bot1.wins;
        standings[bi].losses += result.bot1.losses;
        standings[bi].draws += result.bot1.draws;
        standings[bi].totalScore += result.bot1.wins * 3 + result.bot1.draws;
        standings[bi].avgReward += result.bot1.avgReward;

        standings[bj].wins += result.bot2.wins;
        standings[bj].losses += result.bot2.losses;
        standings[bj].draws += result.bot2.draws;
        standings[bj].totalScore += result.bot2.wins * 3 + result.bot2.draws;
        standings[bj].avgReward += result.bot2.avgReward;

        matchResults.push(result);
      }
    }
  }

  const opponentCount = models.length - 1;
  for (const key of Object.keys(standings)) {
    standings[key].avgReward /= opponentCount;
  }

  const sortedStandings = Object.values(standings).sort(function(a, b) {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.losses - b.losses;
  });

  return { standings: sortedStandings, matchResults, models };
}

// ============================================================
// 生成报告
// ============================================================
function generateReport(duelResult) {
  if (!duelResult) {
    console.log('无斗法结果可报告');
    return;
  }

  const b1 = duelResult.bot1;
  const b2 = duelResult.bot2;

  console.log('\n========================================');
  console.log('          斗法结果报告');
  console.log('========================================\n');

  console.log('Bot ' + b1.botIndex + ' vs Bot ' + b2.botIndex);
  console.log('  胜: ' + b1.wins + ' - ' + b2.wins);
  console.log('  负: ' + b1.losses + ' - ' + b2.losses);
  console.log('  平: ' + b1.draws + ' - ' + b2.draws);
  console.log('  胜率: ' + formatNumber(b1.wins / Math.max(b1.wins + b1.losses + b1.draws, 1) * 100) + '% - ' + formatNumber(b2.wins / Math.max(b2.wins + b2.losses + b2.draws, 1) * 100) + '%\n');

  console.log('--- 平均表现 ---');
  console.log('  平均奖励:     ' + formatNumber(b1.avgReward) + ' - ' + formatNumber(b2.avgReward));
  console.log('  最终等级:     ' + formatNumber(b1.finalLevel, 1) + ' - ' + formatNumber(b2.finalLevel, 1));
  console.log('  最终突破:     ' + formatNumber(b1.finalBreakthrough, 1) + ' - ' + formatNumber(b2.finalBreakthrough, 1));
  console.log('  学习技能:     ' + formatNumber(b1.skillsLearned / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.skillsLearned / duelResult.episodeDetails.length, 1));
  console.log('  使用物品:     ' + formatNumber(b1.itemsUsed / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.itemsUsed / duelResult.episodeDetails.length, 1));
  console.log('  战斗胜利:     ' + formatNumber(b1.battlesWon / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.battlesWon / duelResult.episodeDetails.length, 1));
  console.log('  副本通关:     ' + formatNumber(b1.dungeonClears / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.dungeonClears / duelResult.episodeDetails.length, 1));
  console.log('  炼丹次数:     ' + formatNumber(b1.alchemyCount / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.alchemyCount / duelResult.episodeDetails.length, 1));
  console.log('  锻造次数:     ' + formatNumber(b1.forgingCount / duelResult.episodeDetails.length, 1) + ' - ' + formatNumber(b2.forgingCount / duelResult.episodeDetails.length, 1));

  console.log('\n--- 每局详情 ---');
  for (const ep of duelResult.episodeDetails) {
    console.log('\n第 ' + ep.episode + ' 局:');
    console.log('  Bot ' + b1.botIndex + ': 等级' + ep.finalState1.level + ' 突破' + ep.finalState1.breakthrough + ' HP' + ep.finalState1.hp + '/' + ep.finalState1.maxHp + ' 攻击' + ep.finalState1.attack + ' 防御' + ep.finalState1.defense + ' 技能' + ep.finalState1.skillsLearned + ' 装备武器' + (ep.finalState1.hasWeapon ? 'V' : 'X') + '防具' + (ep.finalState1.hasArmor ? 'V' : 'X') + ' 背包' + ep.finalState1.inventoryCount + '件');
    console.log('  Bot ' + b2.botIndex + ': 等级' + ep.finalState2.level + ' 突破' + ep.finalState2.breakthrough + ' HP' + ep.finalState2.hp + '/' + ep.finalState2.maxHp + ' 攻击' + ep.finalState2.attack + ' 防御' + ep.finalState2.defense + ' 技能' + ep.finalState2.skillsLearned + ' 装备武器' + (ep.finalState2.hasWeapon ? 'V' : 'X') + '防具' + (ep.finalState2.hasArmor ? 'V' : 'X') + ' 背包' + ep.finalState2.inventoryCount + '件');
    console.log('  评分: ' + formatNumber(ep.score1) + ' vs ' + formatNumber(ep.score2));
    console.log('  奖励: ' + formatNumber(ep.totalReward1) + ' vs ' + formatNumber(ep.totalReward2));
    console.log('  胜者: ' + (ep.winner === b1.botIndex ? 'Bot ' + b1.botIndex : ep.winner === b2.botIndex ? 'Bot ' + b2.botIndex : '平局'));
  }
}

function generateTournamentReport(tournamentResult) {
  if (!tournamentResult) {
    console.log('无循环赛结果可报告');
    return;
  }

  console.log('\n========================================');
  console.log('          斗法循环赛结果报告');
  console.log('========================================\n');

  console.log('排名:');
  console.log('排名\tBot\t胜\t负\t平\t积分\t平均奖励');
  tournamentResult.standings.forEach(function(s, i) {
    console.log((i + 1) + '\t' + s.botIndex + '\t' + s.wins + '\t' + s.losses + '\t' + s.draws + '\t' + s.totalScore + '\t' + formatNumber(s.avgReward));
  });

  console.log('\n--- 详细对战 ---');
  for (const match of tournamentResult.matchResults) {
    console.log('\nBot ' + match.bot1.botIndex + ' vs Bot ' + match.bot2.botIndex + ': ' + match.bot1.wins + ' - ' + match.bot2.wins + ' (平' + match.bot1.draws + ')');
  }
}

// ============================================================
// 主函数
// ============================================================
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('\n用法:');
    console.log('  node duel.js <botIndex1> <botIndex2>         两个AI对战');
    console.log('  node duel.js --tournament                     所有模型循环赛');
    console.log('  node duel.js --list                           列出可用模型');
    console.log('  node duel.js --help                           显示帮助信息');
    console.log('\n示例:');
    console.log('  node duel.js 0 1                             Bot 0 vs Bot 1');
    console.log('  node duel.js --tournament                     所有模型循环赛');
    return;
  }

  if (args[0] === '--list') {
    const models = getModelFiles();
    if (models.length === 0) {
      console.log('没有找到训练好的模型');
      return;
    }
    console.log('\n可用模型:');
    models.forEach(function(m) {
      const stats = JSON.parse(fs.readFileSync(m.path, 'utf8'));
      console.log('  Bot ' + m.botIndex + ' - 文件: ' + m.file + ' - 等级: ' + (stats.stats?.level || '?') + ' - 奖励: ' + formatNumber(stats.stats?.totalReward || 0));
    });
    return;
  }

  if (args[0] === '--tournament') {
    const result = runTournament({ episodes: 3, maxSteps: 150, verbose: true });
    generateTournamentReport(result);
    return;
  }

  // 两个AI对战
  const bi1 = parseInt(args[0]);
  const bi2 = parseInt(args[1]);

  if (isNaN(bi1) || isNaN(bi2)) {
    console.error('请提供有效的Bot编号');
    return;
  }

  const result = runDuel(bi1, bi2, { episodes: 5, maxSteps: 200, verbose: true });
  generateReport(result);
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

module.exports = { runDuel, runTournament, generateReport, generateTournamentReport };
