
const GameClient = require('./game_client');
const GameEnvironment = require('./game_environment');
const { DQNAgent } = require('./dqn_agent');

const CONFIG = {
    serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
    account: { username: 'ai_bot_01', password: 'bot123456', name: 'AI修仙者·壹' },
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
    training: {
        maxEpisodes: 10,
        maxStepsPerEpisode: 1000,
        targetLevel: 400,
    },
    botIndex: 0,
    speedDelay: 0,
    // 奖励权重（可从UI动态调整）
    rewardWeights: {"levelUp": 100.0, "expGain": 50.0, "spiritStone": 20.0, "battleWin": 30.0, "battleLoss": -20.0, "combatPower": 30.0, "crafting": 25.0, "forging": 30.0, "alchemy": 20.0, "collection": 15.0, "sectTask": 20.0, "sectLearn": 15.0, "alliance": 10.0, "dungeon": 40.0, "trial": 35.0, "discipleCreate": 20.0, "discipleRecall": 15.0, "exchange": 10.0, "equip": 15.0, "skillEquip": 10.0, "techniqueEquip": 15.0, "mailClaim": 5.0, "stepPenalty": -0.5, "invalidAction": -5.0},
};

// 加载地图数据用于斗法显示
const MAPS_DATA = (function() {
    try {
        return require('./data/maps.json');
    } catch(e) {
        return [];
    }
})();

// 输出 JSON 格式的训练数据
function emit(data) {
    process.stdout.write(JSON.stringify(data) + '\n');
}

async function run() {
    const client = new GameClient(CONFIG.serverUrl);
    const env = new GameEnvironment(client, {
        maxStepsPerEpisode: CONFIG.training.maxStepsPerEpisode,
        levelTarget: CONFIG.training.targetLevel,
        rewardWeights: CONFIG.rewardWeights  // 传入奖励权重
    });

    // 登录/注册
    emit({ type: 'status', botIndex: CONFIG.botIndex, message: '登录中...' });
    let loginResult = await client.login(CONFIG.account.username, CONFIG.account.password);
    if (!loginResult.ok) {
        emit({ type: 'status', botIndex: CONFIG.botIndex, message: '注册新账号...' });
        const regResult = await client.register(CONFIG.account.username, CONFIG.account.password);
        if (!regResult.ok) throw new Error('注册失败: ' + regResult.error);
        const createResult = await client.createCharacter(CONFIG.account.name);
        if (!createResult.ok) throw new Error('创建角色失败: ' + createResult.error);
        emit({ type: 'status', botIndex: CONFIG.botIndex, message: '角色创建成功!' });
    }

    await client.sync('heavy');
    await client.getGameData();

    const stateSize = env.getStateSize();
    const actionSize = env.getActionSize();
    const agent = new DQNAgent(stateSize, actionSize, CONFIG.dqn);

    // 加载已有模型
    const fs = require('fs');
    const path = require('path');
    const modelPath = path.join('./models', `bot_${CONFIG.botIndex}_model.json`);
    if (fs.existsSync(modelPath)) {
        agent.loadModel(modelPath);
        emit({ type: 'status', botIndex: CONFIG.botIndex, message: '加载已有模型' });
    }

    emit({ type: 'ready', botIndex: CONFIG.botIndex, message: '训练就绪' });

    // 训练循环
    for (let episode = 1; episode <= CONFIG.training.maxEpisodes; episode++) {
        let state = await env.reset();
        let totalReward = 0;
        let episodeSteps = 0;
        let episodeLoss = 0;
        let lossCount = 0;

        while (true) {
            // 速度控制
            if (CONFIG.speedDelay > 0) {
                await new Promise(r => setTimeout(r, CONFIG.speedDelay));
            }

            const action = agent.selectAction(state);
            const { state: nextState, reward, done, info } = await env.step(action);
            agent.remember(state, action, reward, nextState, done);
            const loss = agent.train();

            state = nextState;
            totalReward += reward;
            episodeSteps++;

            if (loss !== null) {
                episodeLoss += loss;
                lossCount++;
            }

            // 每步输出训练数据（包含完整游戏状态用于画面渲染）
            const stats = env.getStats();
            const qValues = agent.getQValues(state);
            const player = client.player || {};
            const caveSummary = client.getCaveSummary();
            const sectSummary = client.getSectSummary();
            const allianceSummary = client.getAllianceSummary();
            const discipleSummary = client.getDiscipleSummary();
            const onlineSummary = client.getOnlineSummary();
            emit({
                type: 'step',
                botIndex: CONFIG.botIndex,
                episode: episode,
                step: episodeSteps,
                action: info.action,
                actionName: info.actionName || '',
                level: stats.level,
                reward: reward,
                epsilon: agent.epsilon,
                loss: loss || 0,
                avgLoss: lossCount > 0 ? (episodeLoss / lossCount) : 0,
                totalReward: totalReward,
                winRate: stats.winRate,
                memorySize: agent.memory.size(),
                qValues: Array.from(qValues).map(v => Math.round(v * 100) / 100),
                // 角色基础属性
                hp: player.hp || 0,
                maxHp: player.max_hp || 0,
                mp: player.mp || 0,
                maxMp: player.max_mp || 0,
                exp: player.exp || 0,
                maxExp: player.max_exp || 0,
                level: player.level || 0,
                spiritStones: player.spirit_stones || 0,
                mapId: player.current_map_id || 0,
                mapName: (MAPS_DATA.find(m => m.id === (player.current_map_id || 0)) || {}).name || '未知',
                attack: player.attack || 0,
                defense: player.defense || 0,
                spellAttack: player.spell_attack || 0,
                spellDefense: player.spell_defense || 0,
                strength: player.strength || 0,
                constitution: player.constitution || 0,
                agility: player.agility || 0,
                zhenyuan: player.zhenyuan || 0,
                realm: player.realm || 0,
                realmLevel: player.realm_level || 0,
                // 装备/技能/背包摘要
                equipmentCount: stats.equipmentCount || 0,
                skillCount: stats.skillCount || 0,
                inventoryItems: client.getInventory().length,
                // 战斗统计
                battleWinCount: env.battleWinCount || 0,
                battleLossCount: env.battleLossCount || 0,
                consecutiveWins: stats.consecutiveWins || 0,
                consecutiveLosses: stats.consecutiveLosses || 0,
                // 游戏进度
                hasSect: !!(player.sect_id || player.sect_name),
                hasAlliance: !!(player.alliance_id || player.alliance_name),
                hasCave: caveSummary.hasCave,
                caveLevel: caveSummary.level || 0,
                hasDisciple: discipleSummary.hasDisciple,
                hasAutoBattle: player.auto_battle_enabled || false,
                canBreakthrough: player.can_breakthrough || false,
                isResting: player.is_resting || false,
                // 宗门信息
                sectName: player.sect_name || '',
                sectContribution: player.sect_contribution || 0,
                // 联盟信息
                allianceName: player.alliance_name || '',
                // 洞府信息
                caveResource: caveSummary.resource || 0,
                // 传人信息
                discipleCount: discipleSummary.count || 0,
                // 经济资源
                trialCoins: player.trial_coins || 0,
                leagueRating: player.league_rating || 0,
                leaguePoints: player.league_points || 0,
                destinyPoints: player.destiny_points || 0,
                talentPoints: player.talent_points || 0,
                invitePoints: player.invite_points || 0,
                // 装备详情（用于游戏画面渲染）
                equipment: player.equipment || {},
                // 技能列表
                equippedSkills: client.getEquippedSkills(),
                // 背包物品（前20个）
                inventory: client.getInventory().slice(0, 20),
                // 战斗状态
                battleActive: env.battleActive || false,
                battleLog: env.lastBattleLog || [],
                // 锻造/炼丹状态
                forgingActive: env.forgingActive || false,
                alchemyActive: env.alchemyActive || false,
                // 洞府阵法
                formationActive: caveSummary.formationActive || false,
                // 传人试炼
                discipleBattleActive: discipleSummary.battleActive || false,
            });

            if (done) break;
            if (episodeSteps > CONFIG.training.maxStepsPerEpisode * 2) break;
        }

        agent.endEpisode(totalReward);

        // Episode 完成
        const player = client.player || {};
        const caveSummary = client.getCaveSummary();
        const discipleSummary = client.getDiscipleSummary();
        emit({
            type: 'episode_end',
            botIndex: CONFIG.botIndex,
            episode: episode,
            steps: episodeSteps,
            totalReward: totalReward.toFixed(1),
            level: player.level || 0,
            realm: player.realm || 0,
            realmLevel: player.realm_level || 0,
            winRate: env.battleWinCount + env.battleLossCount > 0
                ? (env.battleWinCount / (env.battleWinCount + env.battleLossCount) * 100).toFixed(1)
                : '0.0',
            epsilon: agent.epsilon.toFixed(4),
            avgReward: agent.stats.avgReward.toFixed(1),
            memorySize: agent.memory.size(),
            avgLoss: lossCount > 0 ? (episodeLoss / lossCount) : 0,
            // 游戏进度摘要
            hasSect: !!(player.sect_id || player.sect_name),
            hasAlliance: !!(player.alliance_id || player.alliance_name),
            hasCave: caveSummary.hasCave,
            caveLevel: caveSummary.level || 0,
            hasDisciple: discipleSummary.hasDisciple,
            spiritStones: player.spirit_stones || 0,
            sectContribution: player.sect_contribution || 0,
            attack: player.attack || 0,
            defense: player.defense || 0,
            hp: player.hp || 0,
            maxHp: player.max_hp || 0,
        });
    }

    // 保存模型
    agent.saveModel(modelPath);
    emit({ type: 'done', botIndex: CONFIG.botIndex, message: '训练完成' });
}

run().catch(err => {
    emit({ type: 'error', botIndex: CONFIG.botIndex, error: err.message, stack: err.stack });
});
