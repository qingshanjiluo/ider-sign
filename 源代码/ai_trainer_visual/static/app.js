/**
 * 艾德尔修仙传 AI 可视化训练系统 - 前端应用
 * ===========================================
 * 功能：
 * - WebSocket 实时通信
 * - 训练图表绘制 (Canvas)
 * - 机器人状态面板管理
 * - 游戏画面实时显示（角色/背包/装备/技能/战斗/锻造/洞府/宗门）
 * - 速度/训练控制
 */

// ==================== 全局状态 ====================

const STATE = {
    socket: null,
    connected: false,
    serverRunning: false,
    training: false,
    paused: false,
    speed: 1.0,
    numBots: 2,
    episodesPerBot: 10,
    maxEpisodes: 1000,
    bots: {},
    charts: {
        reward: { data: [], maxPoints: 100 },
        loss: { data: [], maxPoints: 100 },
        epsilon: { data: [], maxPoints: 100 },
        level: { data: [], maxPoints: 100 },
    },
    logs: [],
    maxLogs: 500,
    selectedBot: 0,
    gameBotIndex: 0,
    // 奖励权重配置
    rewardWeights: {},
    // NPC排名数据
    npcRankings: [],
    npcRankingPage: 1,
    npcRankingTotal: 0,
};

// 35个动作名称映射
const ACTION_NAMES = {
    '普通攻击': '⚔️ 普通攻击',
    '使用技能1': '🔮 技能·壹',
    '使用技能2': '🔮 技能·贰',
    '使用技能3': '🔮 技能·叁',
    '治疗': '💚 治疗',
    '使用HP药水': '🧪 HP药水',
    '使用MP药水': '🧪 MP药水',
    '切换高级地图': '🗺️ 高级地图',
    '切换低级地图': '🗺️ 低级地图',
    '升级': '⬆️ 升级',
    '突破': '💫 突破',
    '整理装备': '🔧 整理装备',
    '领取邮件': '📧 领取邮件',
    '等待同步': '⏳ 等待同步',
    '切换自动战斗': '🤖 自动战斗',
    '炼丹': '🔥 炼丹',
    '锻造装备': '🔨 锻造装备',
    '升级锻造': '⬆️ 升级锻造',
    '重铸装备': '🔄 重铸装备',
    '洞府采集': '⛏️ 洞府采集',
    '洞府升级': '🏗️ 洞府升级',
    '洞府阵法': '🔮 洞府阵法',
    '创建传人': '👤 创建传人',
    '派遣传人': '📤 派遣传人',
    '召回传人': '📥 召回传人',
    '宗门贡献': '🏛️ 宗门贡献',
    '宗门学习': '📖 宗门学习',
    '宗门任务': '📋 宗门任务',
    '联盟祈福': '🙏 联盟祈福',
    '联盟沐浴': '🛁 联盟沐浴',
    '联盟采摘': '🌿 联盟采摘',
    '联盟冥想': '🧘 联盟冥想',
    '副本探索': '🏰 副本探索',
    '试炼挑战': '⚡ 试炼挑战',
    '交易所买卖': '💰 交易所买卖',
    '初始化中...': '⏳ 初始化中...',
};

// 品质颜色映射
const QUALITY_COLORS = {
    1: '#9ca3af',  // 凡品 - 灰
    2: '#22c55e',  // 良品 - 绿
    3: '#3b82f6',  // 上品 - 蓝
    4: '#a855f7',  // 极品 - 紫
    5: '#eab308',  // 绝品 - 金
    6: '#f97316',  // 仙品 - 橙
    7: '#ef4444',  // 神品 - 红
};

const QUALITY_NAMES = {
    1: '凡品', 2: '良品', 3: '上品', 4: '极品',
    5: '绝品', 6: '仙品', 7: '神品',
};

const EQUIP_SLOTS = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back', 'talisman'];
const EQUIP_SLOT_NAMES = {
    weapon: '武器', head: '头盔', shoulder: '护肩', chest: '胸甲',
    legs: '护腿', hands: '手套', ring: '戒指', amulet: '项链',
    back: '披风', talisman: '法宝',
};

// ==================== Socket.IO 连接 ====================

function connectSocket() {
    STATE.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
    });

    STATE.socket.on('connect', () => {
        STATE.connected = true;
        addLog('info', '已连接到训练服务器');
        updateConnectionUI();
    });

    STATE.socket.on('disconnect', () => {
        STATE.connected = false;
        addLog('warning', '与服务器断开连接');
        updateConnectionUI();
    });

    STATE.socket.on('initial_state', (data) => {
        if (data) {
            STATE.serverRunning = data.server?.status === 'running';
            STATE.training = data.running || false;
            STATE.paused = data.paused || false;
            STATE.speed = data.speed || 1.0;
            STATE.numBots = data.num_bots || 2;
            
            if (data.bots) {
                Object.entries(data.bots).forEach(([idx, botData]) => {
                    STATE.bots[idx] = botData;
                });
            }
            
            // 加载奖励权重
            if (data.reward_weights) {
                STATE.rewardWeights = data.reward_weights;
                updateRewardWeightUI();
            }
            
            // 加载NPC排名
            if (data.npc_count > 0) {
                loadNPCRankings();
            }
            
            updateAllUI();
            updateSpeedUI(STATE.speed);
        }
    });

    // 奖励权重更新
    STATE.socket.on('reward_weights_updated', (data) => {
        STATE.rewardWeights = data;
        updateRewardWeightUI();
        addLog('info', '奖励权重已更新');
    });

    // 训练步进数据
    STATE.socket.on('bot_step', (data) => {
        const idx = String(data.index);
        STATE.bots[idx] = { ...STATE.bots[idx], ...data };
        
        // 更新图表
        updateCharts(data);
        
        // 更新机器人面板
        updateBotPanel(idx);
        
        // 更新游戏画面
        if (parseInt(idx) === STATE.gameBotIndex) {
            updateGameView(data);
        }
        
        // 更新全局统计
        updateGlobalStats();
    });

    // Episode 结束
    STATE.socket.on('bot_episode_end', (data) => {
        const idx = String(data.bot_index);
        addLog('episode', 
            `[Bot${data.bot_index}] ${data.bot_name} | ` +
            `Episode ${data.episode} | 奖励: ${data.total_reward} | ` +
            `等级: ${data.level} | 胜率: ${data.win_rate}% | ` +
            `ε: ${data.epsilon} | 损失: ${data.avg_loss?.toFixed(4) || 0}`
        );
    });

    // 机器人状态
    STATE.socket.on('bot_status', (data) => {
        const idx = String(data.bot_index);
        if (data.status === 'ready') {
            addLog('success', `[Bot${data.bot_index}] ${data.bot_name} 训练就绪`);
        } else if (data.status === 'completed') {
            addLog('success', `[Bot${data.bot_index}] ${data.bot_name} 训练完成!`);
        } else if (data.status === 'info' && data.message) {
            addLog('info', `[Bot${data.bot_index}] ${data.message}`);
        }
        updateBotTabStatus(idx, data.status);
    });

    // 机器人错误
    STATE.socket.on('bot_error', (data) => {
        addLog('error', `[Bot${data.bot_index}] ${data.bot_name} 错误: ${data.error}`);
    });

    // 训练状态
    STATE.socket.on('training_status', (data) => {
        if (data.status === 'running') {
            STATE.training = true;
            STATE.paused = false;
            addLog('success', data.message || '训练已开始');
        } else if (data.status === 'stopped') {
            STATE.training = false;
            STATE.paused = false;
            addLog('warning', data.message || '训练已停止');
        } else if (data.status === 'paused') {
            STATE.paused = true;
            addLog('warning', data.message || '训练已暂停');
        }
        updateAllUI();
    });

    // 速度变化
    STATE.socket.on('speed_changed', (data) => {
        STATE.speed = data.speed;
        updateSpeedUI(data.speed);
    });

    // 服务器日志
    STATE.socket.on('server_log', (data) => {
        if (data.ready && !STATE.serverRunning) {
            STATE.serverRunning = true;
            addLog('success', '游戏服务器已就绪!');
            updateAllUI();
        }
    });

    // 命令结果
    STATE.socket.on('command_result', (data) => {
        const result = data.result;
        if (result.ok) {
            addLog('success', `[${data.command}] ${result.message || '成功'}`);
        } else if (result.error) {
            addLog('error', `[${data.command}] ${result.error}`);
        }
        updateAllUI();
    });
}

// ==================== 命令发送 ====================

function sendCommand(command) {
    if (!STATE.connected) {
        addLog('error', '未连接到服务器');
        return;
    }

    let params = {};

    switch (command) {
        case 'start_training':
            params = {
                num_bots: STATE.numBots,
                episodes: STATE.episodesPerBot,
                max_episodes: STATE.maxEpisodes,
            };
            break;
        case 'set_speed':
            params = { speed: STATE.speed };
            break;
        case 'set_bots_count':
            params = { count: STATE.numBots };
            break;
    }

    STATE.socket.emit('command', { command, params });
}

// ==================== UI 更新 ====================

function updateConnectionUI() {
    const dot = document.getElementById('serverStatusDot');
    const text = document.getElementById('serverStatusText');
    
    if (STATE.connected) {
        dot.className = 'status-dot online';
        text.textContent = '已连接';
    } else {
        dot.className = 'status-dot offline';
        text.textContent = '未连接';
    }
}

function updateAllUI() {
    // 服务器状态
    const sDot = document.getElementById('serverStatusDot');
    const sText = document.getElementById('serverStatusText');
    if (STATE.serverRunning) {
        sDot.className = 'status-dot running';
        sText.textContent = '服务器: 运行中';
    } else {
        sDot.className = 'status-dot offline';
        sText.textContent = '服务器: 未运行';
    }

    // 训练状态
    const tDot = document.getElementById('trainStatusDot');
    const tText = document.getElementById('trainStatusText');
    if (STATE.training) {
        if (STATE.paused) {
            tDot.className = 'status-dot paused';
            tText.textContent = '训练: 已暂停';
        } else {
            tDot.className = 'status-dot running';
            tText.textContent = '训练: 运行中';
        }
    } else {
        tDot.className = 'status-dot offline';
        tText.textContent = '训练: 未开始';
    }

    // 按钮状态
    document.getElementById('btnStartServer').disabled = STATE.serverRunning;
    document.getElementById('btnStopServer').disabled = !STATE.serverRunning;
    document.getElementById('btnStartTrain').disabled = STATE.training || !STATE.serverRunning;
    document.getElementById('btnPauseTrain').disabled = !STATE.training || STATE.paused;
    document.getElementById('btnStopTrain').disabled = !STATE.training;
    document.getElementById('numBots').disabled = STATE.training;

    // 服务器信息
    document.getElementById('serverInfoStatus').textContent = 
        STATE.serverRunning ? '✅ 运行中' : '⏹ 未运行';
}

function updateSpeedUI(speed) {
    document.getElementById('speedValue').textContent = speed.toFixed(1) + 'x';
    document.getElementById('speedSlider').value = speed;
}

function updateGlobalStats() {
    let totalEpisodes = 0;
    let totalSteps = 0;
    let activeCount = 0;

    Object.values(STATE.bots).forEach(bot => {
        totalEpisodes = Math.max(totalEpisodes, bot.episode || 0);
        totalSteps += bot.step || 0;
        if (bot.status === 'running' || bot.status === 'ready' || bot.status === 'episode_done') {
            activeCount++;
        }
    });

    document.getElementById('globalEpisodes').textContent = totalEpisodes;
    document.getElementById('globalSteps').textContent = totalSteps;
    document.getElementById('activeBots').textContent = activeCount;
}

// ==================== 图表绘制 ====================

function updateCharts(data) {
    const idx = String(data.index);
    const botData = STATE.bots[idx];
    if (!botData) return;

    // 奖励曲线
    if (data.reward !== undefined) {
        STATE.charts.reward.data.push({
            episode: data.episode || 0,
            step: data.step || 0,
            value: data.totalReward || 0,
            bot: idx,
        });
        if (STATE.charts.reward.data.length > STATE.charts.reward.maxPoints) {
            STATE.charts.reward.data.shift();
        }
    }

    // 损失率
    if (data.avg_loss !== undefined && data.avg_loss > 0) {
        STATE.charts.loss.data.push({
            episode: data.episode || 0,
            step: data.step || 0,
            value: data.avg_loss,
            bot: idx,
        });
        if (STATE.charts.loss.data.length > STATE.charts.loss.maxPoints) {
            STATE.charts.loss.data.shift();
        }
    }

    // 探索率
    if (data.epsilon !== undefined) {
        STATE.charts.epsilon.data.push({
            episode: data.episode || 0,
            step: data.step || 0,
            value: data.epsilon,
            bot: idx,
        });
        if (STATE.charts.epsilon.data.length > STATE.charts.epsilon.maxPoints) {
            STATE.charts.epsilon.data.shift();
        }
    }

    // 等级
    if (data.level !== undefined) {
        STATE.charts.level.data.push({
            episode: data.episode || 0,
            step: data.step || 0,
            value: data.level,
            bot: idx,
        });
        if (STATE.charts.level.data.length > STATE.charts.level.maxPoints) {
            STATE.charts.level.data.shift();
        }
    }

    // 绘制所有图表
    drawChart('rewardChart', STATE.charts.reward.data, '#22c55e', '奖励');
    drawChart('lossChart', STATE.charts.loss.data, '#ef4444', '损失');
    drawChart('epsilonChart', STATE.charts.epsilon.data, '#eab308', 'ε');
    drawChart('levelChart', STATE.charts.level.data, '#a855f7', '等级');
}

function drawChart(canvasId, data, color, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = 130 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '130px';
    
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = 130;

    // 清空
    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('等待数据...', width / 2, height / 2);
        return;
    }

    const padding = { top: 10, bottom: 20, left: 5, right: 5 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // 计算范围
    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const padding_range = range * 0.1;

    // 绘制网格线
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    // 绘制数据线
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartW;
        const y = padding.top + chartH - ((d.value - minVal + padding_range) / (range + 2 * padding_range)) * chartH;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // 填充渐变
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '05');
    ctx.fillStyle = gradient;
    ctx.lineTo(padding.left + chartW, height - padding.bottom);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.closePath();
    ctx.fill();

    // 显示最新值
    const lastVal = values[values.length - 1];
    ctx.fillStyle = color;
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(lastVal.toFixed(2), width - padding.right, padding.top + 12);
}

// ==================== 机器人面板 ====================

function initBotTabs() {
    const tabsContainer = document.getElementById('botTabs');
    const panelsContainer = document.getElementById('botPanels');
    
    tabsContainer.innerHTML = '';
    panelsContainer.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        // Tab
        const tab = document.createElement('button');
        tab.className = `bot-tab ${i === 0 ? 'active' : ''}`;
        tab.dataset.botIndex = i;
        tab.innerHTML = `<span class="tab-status"></span>Bot ${i + 1}`;
        tab.onclick = () => selectBot(i);
        tabsContainer.appendChild(tab);

        // Panel
        const panel = document.createElement('div');
        panel.className = `bot-panel ${i === 0 ? 'active' : ''}`;
        panel.id = `botPanel${i}`;
        panel.innerHTML = `
            <div class="bot-stats-grid">
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Episode">0</div>
                    <div class="bs-label">Episode</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Step">0</div>
                    <div class="bs-label">步数</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Level">1</div>
                    <div class="bs-label">等级</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Reward">0</div>
                    <div class="bs-label">总奖励</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}AvgReward">0</div>
                    <div class="bs-label">平均奖励</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}WinRate">0%</div>
                    <div class="bs-label">胜率</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Epsilon">1.0</div>
                    <div class="bs-label">探索率 ε</div>
                </div>
                <div class="bot-stat">
                    <div class="bs-value" id="bot${i}Memory">0</div>
                    <div class="bs-label">记忆</div>
                </div>
            </div>
            <div class="bot-action-bar">
                <span class="action-name" id="bot${i}Action">等待中...</span>
                <span class="action-reward" id="bot${i}ActionReward">奖励: 0</span>
            </div>
        `;
        panelsContainer.appendChild(panel);
    }
}

function selectBot(index) {
    STATE.selectedBot = index;
    STATE.gameBotIndex = index;

    // 更新 tabs
    document.querySelectorAll('.bot-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === index);
    });

    // 更新 panels
    document.querySelectorAll('.bot-panel').forEach((panel, i) => {
        panel.classList.toggle('active', i === index);
    });

    // 更新游戏画面
    const botData = STATE.bots[String(index)];
    if (botData) {
        updateGameView(botData);
    }
}

function updateBotPanel(idx) {
    const bot = STATE.bots[idx];
    if (!bot) return;

    const i = parseInt(idx);
    document.getElementById(`bot${i}Episode`).textContent = bot.episode || 0;
    document.getElementById(`bot${i}Step`).textContent = bot.step || 0;
    document.getElementById(`bot${i}Level`).textContent = bot.level || 1;
    document.getElementById(`bot${i}Reward`).textContent = (bot.total_reward || 0).toFixed(1);
    document.getElementById(`bot${i}AvgReward`).textContent = (bot.avg_reward || 0).toFixed(1);
    document.getElementById(`bot${i}WinRate`).textContent = (bot.win_rate || 0) + '%';
    document.getElementById(`bot${i}Epsilon`).textContent = (bot.epsilon || 1.0).toFixed(4);
    document.getElementById(`bot${i}Memory`).textContent = bot.memory_size || 0;
    document.getElementById(`bot${i}Action`).textContent = ACTION_NAMES[bot.action] || bot.action || '等待中...';
    document.getElementById(`bot${i}ActionReward`).textContent = `奖励: ${(bot.reward || 0).toFixed(1)}`;
}

function updateBotTabStatus(idx, status) {
    const tab = document.querySelector(`.bot-tab[data-bot-index="${idx}"]`);
    if (!tab) return;

    const dot = tab.querySelector('.tab-status');
    dot.className = 'tab-status';
    
    switch (status) {
        case 'ready':
        case 'running':
        case 'episode_done':
            dot.classList.add('online');
            break;
        case 'completed':
            dot.classList.add('completed');
            break;
        case 'error':
            dot.classList.add('error');
            break;
        default:
            dot.classList.add('offline');
    }
}

// ==================== 游戏画面 - 标签页切换 ====================

function initGameTabs() {
    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // 更新标签页状态
            document.querySelectorAll('.game-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 更新内容面板
            const tabName = tab.dataset.tab;
            document.querySelectorAll('.game-tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById('gameTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
            if (target) target.classList.add('active');
        });
    });
}

// ==================== 游戏画面 - 完整渲染 ====================

function updateGameView(data) {
    const placeholder = document.getElementById('gamePlaceholder');
    const content = document.getElementById('gameContent');

    placeholder.style.display = 'none';
    content.style.display = 'block';

    // ===== 角色面板 =====
    const botData = STATE.bots[String(STATE.gameBotIndex)] || {};
    
    document.getElementById('gameBotName').textContent = 
        botData.name || `Bot ${STATE.gameBotIndex + 1}`;
    document.getElementById('gameLevel').textContent = `Lv.${data.level || 1}`;

    // HP 条
    const hp = data.hp || 0;
    const maxHp = data.max_hp || 1;
    const hpPercent = Math.min(100, (hp / maxHp) * 100);
    document.getElementById('hpBar').style.width = hpPercent + '%';
    document.getElementById('hpText').textContent = `${hp}/${maxHp}`;

    // MP 条
    const mp = data.mp || 0;
    const maxMp = data.max_mp || 1;
    const mpPercent = Math.min(100, (mp / maxMp) * 100);
    const mpBar = document.getElementById('mpBar');
    const mpText = document.getElementById('mpText');
    if (mpBar) mpBar.style.width = mpPercent + '%';
    if (mpText) mpText.textContent = `${mp}/${maxMp}`;

    // EXP 条
    const exp = data.exp || 0;
    const maxExp = data.max_exp || 1;
    const expPercent = Math.min(100, (exp / maxExp) * 100);
    document.getElementById('expBar').style.width = expPercent + '%';
    document.getElementById('expText').textContent = `${exp}/${maxExp}`;

    // 属性
    setText('gAttrAttack', data.attack || 0);
    setText('gAttrDefense', data.defense || 0);
    setText('gAttrSpellAtk', data.spell_attack || 0);
    setText('gAttrSpellDef', data.spell_defense || 0);
    setText('gAttrStrength', data.strength || 0);
    setText('gAttrConstitution', data.constitution || 0);
    setText('gAttrAgility', data.agility || 0);
    setText('gAttrZhenyuan', data.zhenyuan || 0);

    // 基本信息
    setText('gameStones', data.spirit_stones || 0);
    setText('gameRealm', getRealmName(data.realm, data.realm_level));
    setText('gameMap', data.map_id || 1);
    setText('gameWinRate', (data.win_rate || 0) + '%');

    // 战斗面板
    setText('gameAction', ACTION_NAMES[data.action] || data.action || '等待中...');
    setText('gameEpsilon', (data.epsilon || 1.0).toFixed(4));
    setText('gameBattleStatus', data.battleActive ? '⚔️ 战斗中' : '🛌 空闲');

    // ===== 背包面板 =====
    renderInventory(data);

    // ===== 装备面板 =====
    renderEquipment(data);

    // ===== 技能面板 =====
    renderSkills(data);

    // ===== 战斗日志 =====
    renderBattleLog(data);

    // ===== 锻造面板 =====
    renderForgeStatus(data);

    // ===== 洞府面板 =====
    renderCaveStatus(data);

    // ===== 宗门面板 =====
    renderSectStatus(data);

    // Q-Values
    if (data.q_values && data.q_values.length > 0) {
        renderQBars(data.q_values);
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function getRealmName(realm, realmLevel) {
    const realms = ['凡人', '练气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'];
    if (realm !== undefined && realm !== null) {
        const name = realms[realm] || '未知';
        if (realmLevel !== undefined && realmLevel !== null) {
            return `${name}·${realmLevel + 1}层`;
        }
        return name;
    }
    return '凡人';
}

// ==================== 背包渲染 ====================

function renderInventory(data) {
    const grid = document.getElementById('invGrid');
    if (!grid) return;

    grid.innerHTML = '';

    const inventory = data.inventory || [];
    const maxSlots = 20;

    for (let i = 0; i < maxSlots; i++) {
        const slot = document.createElement('div');
        slot.className = 'inv-slot';

        if (i < inventory.length && inventory[i]) {
            const item = inventory[i];
            const quality = item.quality || 1;
            slot.classList.add('occupied', `q-${getQualityClass(quality)}`);
            
            const icon = document.createElement('span');
            icon.className = 'inv-icon';
            icon.textContent = getItemIcon(item.type);
            slot.appendChild(icon);

            const name = document.createElement('span');
            name.className = 'inv-name';
            name.textContent = item.name || item.item_id || '?';
            name.style.color = QUALITY_COLORS[quality] || '#9ca3af';
            slot.appendChild(name);

            if (item.count && item.count > 1) {
                const count = document.createElement('span');
                count.className = 'inv-count';
                count.textContent = item.count;
                slot.appendChild(count);
            }
        }

        grid.appendChild(slot);
    }
}

function getQualityClass(q) {
    const map = { 1: 'gray', 2: 'green', 3: 'blue', 4: 'purple', 5: 'gold', 6: 'orange', 7: 'red' };
    return map[q] || 'gray';
}

function getItemIcon(type) {
    const icons = {
        weapon: '🗡️', head: '🪖', shoulder: '🛡️', chest: '👕',
        legs: '👖', hands: '🧤', ring: '💍', amulet: '📿',
        back: '🧣', talisman: '🔮',
        potion: '🧪', material: '🪨', scroll: '📜', food: '🍚',
        herb: '🌿', ore: '⛏️', gem: '💎', key: '🔑',
        box: '📦', token: '🪙',
    };
    return icons[type] || '📦';
}

// ==================== 装备渲染 ====================

function renderEquipment(data) {
    const container = document.getElementById('equipSlots');
    if (!container) return;

    container.innerHTML = '';

    const equipment = data.equipment || {};

    EQUIP_SLOTS.forEach(slot => {
        const div = document.createElement('div');
        div.className = 'equip-slot';

        const label = document.createElement('div');
        label.className = 'slot-label';
        label.textContent = EQUIP_SLOT_NAMES[slot] || slot;
        div.appendChild(label);

        const equipped = equipment[slot];
        if (equipped) {
            const quality = equipped.quality || 1;
            const name = document.createElement('div');
            name.className = 'equip-name';
            name.textContent = equipped.name || equipped.item_id || '?';
            name.style.color = QUALITY_COLORS[quality] || '#9ca3af';
            div.appendChild(name);

            if (equipped.stats) {
                const stats = document.createElement('div');
                stats.className = 'equip-stats';
                const statLines = [];
                Object.entries(equipped.stats).forEach(([k, v]) => {
                    if (v) statLines.push(`${k}:+${v}`);
                });
                stats.textContent = statLines.join(' ');
                div.appendChild(stats);
            }

            if (equipped.level) {
                const lvl = document.createElement('div');
                lvl.className = 'equip-stats';
                lvl.textContent = `等级:${equipped.level}`;
                div.appendChild(lvl);
            }
        } else {
            const empty = document.createElement('div');
            empty.className = 'equip-empty';
            empty.textContent = '— 空 —';
            div.appendChild(empty);
        }

        container.appendChild(div);
    });
}

// ==================== 技能渲染 ====================

function renderSkills(data) {
    const container = document.getElementById('skillList');
    if (!container) return;

    container.innerHTML = '';

    const equippedSkills = data.equippedSkills || [];
    
    if (equippedSkills.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'skill-card';
        empty.innerHTML = '<span style="color:var(--text-muted)">未装备技能</span>';
        container.appendChild(empty);
        return;
    }

    equippedSkills.forEach(skill => {
        const card = document.createElement('div');
        card.className = 'skill-card';
        
        const name = document.createElement('span');
        name.className = 'skill-name';
        name.textContent = skill.name || skill.skill_id || '未知技能';
        card.appendChild(name);

        if (skill.level !== undefined) {
            const lvl = document.createElement('span');
            lvl.className = 'skill-level';
            lvl.textContent = `Lv.${skill.level}`;
            card.appendChild(lvl);
        }

        if (skill.equipped) {
            const eq = document.createElement('span');
            eq.className = 'skill-equipped';
            eq.textContent = '✅ 已装备';
            card.appendChild(eq);
        }

        container.appendChild(card);
    });
}

// ==================== 战斗日志渲染 ====================

function renderBattleLog(data) {
    const box = document.getElementById('battleLogBox');
    if (!box) return;

    const battleLog = data.battleLog || [];

    if (battleLog.length === 0) {
        box.innerHTML = '<div class="battle-log-placeholder">等待战斗...</div>';
        return;
    }

    box.innerHTML = '';
    battleLog.slice(-30).forEach(entry => {
        const div = document.createElement('div');
        div.className = 'battle-log-entry';
        
        if (typeof entry === 'string') {
            div.textContent = entry;
            if (entry.includes('伤害') || entry.includes('攻击')) div.classList.add('damage');
            else if (entry.includes('治疗') || entry.includes('回复')) div.classList.add('heal');
            else if (entry.includes('获得') || entry.includes('奖励') || entry.includes('灵石')) div.classList.add('reward');
            else div.classList.add('info');
        } else if (entry.text) {
            div.textContent = entry.text;
            div.classList.add(entry.type || 'info');
        }
        
        box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
}

// ==================== 锻造/炼丹状态 ====================

function renderForgeStatus(data) {
    setText('forgeActive', data.forgingActive ? '🔨 锻造中' : '空闲');
    setText('alchemyActive', data.alchemyActive ? '🔥 炼丹中' : '空闲');
}

// ==================== 洞府状态 ====================

function renderCaveStatus(data) {
    setText('caveLevel', data.caveLevel || 0);
    setText('caveResource', data.caveResource || 0);
    setText('caveFormation', data.formationActive ? '✅ 已激活' : '未激活');
    setText('caveDiscipleCount', data.discipleCount || 0);
}

// ==================== 宗门状态 ====================

function renderSectStatus(data) {
    setText('sectName', data.sectName || '无');
    setText('sectContribution', data.sectContribution || 0);
    setText('allianceName', data.allianceName || '无');
}

// ==================== Q-Values 渲染 ====================

function renderQBars(qValues) {
    const container = document.getElementById('qBars');
    container.innerHTML = '';

    const maxQ = Math.max(...qValues.map(Math.abs), 0.01);
    const actionNames = [
        '攻击', '技能1', '技能2', '技能3', '治疗',
        'HP药', 'MP药', '高图', '低图',
        '升级', '突破', '整理', '邮件', '同步', '自动',
        '炼丹', '锻造', '锻升', '重铸',
        '采集', '洞升', '阵法',
        '传人', '派遣', '召回',
        '贡献', '学习', '任务',
        '祈福', '沐浴', '采摘', '冥想',
        '副本', '试炼', '交易'
    ];

    qValues.forEach((q, i) => {
        if (i >= actionNames.length) return;
        
        const row = document.createElement('div');
        row.className = 'q-bar-row';

        const label = document.createElement('span');
        label.className = 'q-bar-label';
        label.textContent = actionNames[i];
        row.appendChild(label);

        const track = document.createElement('div');
        track.className = 'q-bar-track';

        const fill = document.createElement('div');
        const percent = Math.abs(q) / maxQ * 100;
        fill.className = `q-bar-fill ${q > 0 ? 'positive' : q < 0 ? 'negative' : 'neutral'}`;
        fill.style.width = Math.min(100, percent) + '%';
        track.appendChild(fill);
        row.appendChild(track);

        const value = document.createElement('span');
        value.className = 'q-bar-value';
        value.textContent = q.toFixed(2);
        row.appendChild(value);

        container.appendChild(row);
    });
}

// ==================== 日志 ====================

function addLog(type, message) {
    const container = document.getElementById('logContainer');
    const placeholder = container.querySelector('.log-placeholder');
    
    if (placeholder) {
        placeholder.remove();
    }

    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
    
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;

    STATE.logs.push({ type, message, time });
    if (STATE.logs.length > STATE.maxLogs) {
        STATE.logs.shift();
        if (container.children.length > STATE.maxLogs) {
            container.removeChild(container.firstChild);
        }
    }
}

// ==================== 控制函数 ====================

function adjustBots(delta) {
    const input = document.getElementById('numBots');
    let val = parseInt(input.value) + delta;
    val = Math.max(1, Math.min(10, val));
    input.value = val;
    STATE.numBots = val;
}

function updateSpeed(value) {
    STATE.speed = parseFloat(value);
    const speed = STATE.speed;
    document.getElementById('speedValue').textContent = speed >= 1000 ? '1000x 🚀' : speed.toFixed(1) + 'x';
}

function setSpeed(value) {
    STATE.speed = value;
    updateSpeedUI(value);
    sendCommand('set_speed');
}

// ==================== 时钟 ====================

function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString();
}

// ==================== 窗口大小变化 ====================

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        // 重绘图表
        ['rewardChart', 'lossChart', 'epsilonChart', 'levelChart'].forEach(id => {
            const canvas = document.getElementById(id);
            if (canvas) {
                const data = STATE.charts[id.replace('Chart', '')]?.data || [];
                const colors = { reward: '#22c55e', loss: '#ef4444', epsilon: '#eab308', level: '#a855f7' };
                const labels = { reward: '奖励', loss: '损失', epsilon: 'ε', level: '等级' };
                const key = id.replace('Chart', '');
                drawChart(id, data, colors[key], labels[key]);
            }
        });
    }, 200);
});

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
    initBotTabs();
    initGameTabs();
    connectSocket();
    updateAllUI();
    
    // 时钟
    setInterval(updateClock, 1000);
    updateClock();

    // 定期更新全局统计
    setInterval(updateGlobalStats, 2000);

    // 定期更新服务器运行时间
    setInterval(() => {
        if (STATE.serverRunning) {
            const uptimeEl = document.getElementById('serverInfoUptime');
            const current = uptimeEl.textContent;
            const secs = parseInt(current) || 0;
            uptimeEl.textContent = formatDuration(secs + 1);
        }
    }, 1000);

    addLog('info', '艾德尔修仙传 AI 可视化训练系统 v2.0 已加载');
    addLog('info', '请先启动游戏服务器，然后开始训练');
    addLog('info', '支持实时同步游戏画面：角色/背包/装备/技能/战斗/锻造/洞府/宗门');
});

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h${m}m${s}s`;
    if (m > 0) return `${m}m${s}s`;
    return `${s}s`;
}

// ==================== 奖励权重 UI ====================

// 奖励权重中文名称映射
const REWARD_WEIGHT_NAMES = {
    levelUp: '等级突破',
    expGain: '经验获取',
    spiritStone: '灵石收益',
    battleWin: '战斗胜利',
    battleLoss: '战斗失败',
    combatPower: '战力提升',
    crafting: '制造物品',
    forging: '锻造装备',
    alchemy: '炼丹制药',
    collection: '采集资源',
    sectTask: '宗门任务',
    sectLearn: '宗门学习',
    alliance: '联盟活动',
    dungeon: '副本探索',
    trial: '试炼挑战',
    discipleCreate: '招收传人',
    discipleRecall: '召回传人',
    exchange: '交易行',
    equip: '装备强化',
    skillEquip: '技能装备',
    techniqueEquip: '功法装备',
    mailClaim: '领取邮件',
    stepPenalty: '步数惩罚',
    invalidAction: '无效动作',
};

// 关键可调权重（显示在UI上）
const KEY_REWARD_WEIGHTS = ['levelUp', 'combatPower', 'equip', 'spiritStone'];

function updateRewardWeightUI() {
    const container = document.getElementById('rewardWeightContainer');
    if (!container) return;
    
    // 清空并重新渲染
    container.innerHTML = '';
    
    // 显示所有权重（可折叠）
    const showAll = STATE.rewardWeightShowAll || false;
    
    const weightsToShow = showAll
        ? Object.keys(REWARD_WEIGHT_NAMES)
        : KEY_REWARD_WEIGHTS;
    
    weightsToShow.forEach(key => {
        const value = STATE.rewardWeights[key];
        if (value === undefined) return;
        
        const item = document.createElement('div');
        item.className = 'reward-weight-item';
        
        const label = REWARD_WEIGHT_NAMES[key] || key;
        const displayVal = typeof value === 'number' ? value.toFixed(1) : value;
        
        item.innerHTML = `
            <div class="rw-row">
                <span class="rw-label" title="${key}">${label}</span>
                <span class="rw-value" id="rw_val_${key}">${displayVal}</span>
            </div>
            <div class="rw-slider-row">
                <input type="range" class="rw-slider" id="rw_slider_${key}"
                    min="-10" max="50" step="0.5" value="${value}"
                    oninput="updateRewardWeightPreview('${key}', this.value)"
                    onchange="applyRewardWeight('${key}', parseFloat(this.value))">
                <button class="rw-reset-btn" title="重置为默认值" onclick="resetRewardWeight('${key}')">↺</button>
            </div>
        `;
        container.appendChild(item);
    });
    
    // 添加"显示全部"切换按钮
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'rw-toggle';
    toggleBtn.innerHTML = `<button class="btn btn-sm" onclick="toggleRewardWeights()">
        ${showAll ? '📌 仅显示关键项' : '📋 显示全部 ${Object.keys(REWARD_WEIGHT_NAMES).length} 项'}
    </button>`;
    container.appendChild(toggleBtn);
}

function toggleRewardWeights() {
    STATE.rewardWeightShowAll = !STATE.rewardWeightShowAll;
    updateRewardWeightUI();
}

function updateRewardWeightPreview(key, value) {
    const valEl = document.getElementById(`rw_val_${key}`);
    if (valEl) {
        valEl.textContent = parseFloat(value).toFixed(1);
    }
}

function applyRewardWeight(key, value) {
    if (!STATE.connected) return;
    STATE.socket.emit('command', {
        command: 'set_reward_weights',
        params: { weights: { [key]: value } }
    });
}

function resetRewardWeight(key) {
    // 发送重置命令到服务器
    if (!STATE.connected) return;
    STATE.socket.emit('command', {
        command: 'set_reward_weights',
        params: { weights: { [key]: null } }  // null 表示重置为默认
    });
}

function applyAllRewardWeights() {
    if (!STATE.connected) return;
    STATE.socket.emit('command', {
        command: 'set_reward_weights',
        params: { weights: STATE.rewardWeights }
    });
    addLog('info', '已应用所有奖励权重');
}

function resetAllRewardWeights() {
    if (!STATE.connected) return;
    if (!confirm('确定要重置所有奖励权重为默认值吗？')) return;
    STATE.socket.emit('command', {
        command: 'reset_all_reward_weights',
        params: {}
    });
    addLog('info', '已重置所有奖励权重为默认值');
}

// ==================== NPC 战力排名 ====================

function loadNPCRankings(page) {
    if (page !== undefined) {
        STATE.npcRankingPage = page;
    }
    
    fetch(`/api/npc-rankings?page=${STATE.npcRankingPage}&page_size=20`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                addLog('error', `加载NPC排名失败: ${data.error}`);
                return;
            }
            STATE.npcRankings = data.rankings || [];
            STATE.npcRankingTotal = data.total || 0;
            renderNPCRankings();
        })
        .catch(err => {
            addLog('error', `加载NPC排名失败: ${err.message}`);
        });
}

function renderNPCRankings() {
    const container = document.getElementById('npcRankingContainer');
    if (!container) return;
    
    const rankings = STATE.npcRankings;
    const total = STATE.npcRankingTotal;
    const page = STATE.npcRankingPage;
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    
    if (!rankings || rankings.length === 0) {
        container.innerHTML = '<div class="npc-empty">暂无NPC排名数据</div>';
        return;
    }
    
    let html = `
        <div class="npc-rank-header">
            <span class="npc-rank-col rank">#</span>
            <span class="npc-rank-col name">名称</span>
            <span class="npc-rank-col level">等级</span>
            <span class="npc-rank-col power">战力</span>
            <span class="npc-rank-col equip">装备分</span>
            <span class="npc-rank-col winrate">胜率</span>
            <span class="npc-rank-col status">状态</span>
        </div>
        <div class="npc-rank-list">
    `;
    
    rankings.forEach((npc, idx) => {
        const rank = (page - 1) * pageSize + idx + 1;
        const online = npc.online ? '🟢 在线' : '⚫ 离线';
        const onlineClass = npc.online ? 'online' : 'offline';
        
        html += `
            <div class="npc-rank-row ${onlineClass}">
                <span class="npc-rank-col rank">${rank}</span>
                <span class="npc-rank-col name" title="${npc.account}">${npc.name || npc.account}</span>
                <span class="npc-rank-col level">Lv.${npc.level || 0}</span>
                <span class="npc-rank-col power">${formatPower(npc.combat_power || 0)}</span>
                <span class="npc-rank-col equip">${npc.equip_score || 0}</span>
                <span class="npc-rank-col winrate">${(npc.win_rate || 0).toFixed(1)}%</span>
                <span class="npc-rank-col status">${online}</span>
            </div>
        `;
    });
    
    html += `</div>`;
    
    // 分页
    if (totalPages > 1) {
        html += `<div class="npc-pagination">`;
        html += `<button class="btn btn-sm" onclick="loadNPCRankings(1)" ${page <= 1 ? 'disabled' : ''}>«</button>`;
        html += `<button class="btn btn-sm" onclick="loadNPCRankings(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
        html += `<span class="npc-page-info">第 ${page}/${totalPages} 页 (共 ${total} 人)</span>`;
        html += `<button class="btn btn-sm" onclick="loadNPCRankings(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
        html += `<button class="btn btn-sm" onclick="loadNPCRankings(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>»</button>`;
        html += `</div>`;
    }
    
    container.innerHTML = html;
}

function formatPower(power) {
    if (power >= 10000) {
        return (power / 10000).toFixed(1) + '万';
    }
    if (power >= 1000) {
        return (power / 1000).toFixed(1) + 'k';
    }
    return power.toString();
}

// ==================== 模型导出/导入 ====================

function exportModel() {
    const botIndex = parseInt(document.getElementById('exportBotSelect').value);
    const format = document.getElementById('exportFormatSelect').value;
    const resultDiv = document.getElementById('exportResult');

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="model-loading">⏳ 正在导出模型...</div>';
    addLog('info', `正在导出 Bot ${botIndex + 1} 模型 (格式: ${format})...`);

    fetch('/api/model/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_index: botIndex, format: format })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            resultDiv.innerHTML = `<div class="model-success">✅ ${data.message}</div>`;
            addLog('success', `Bot ${botIndex + 1} 模型导出成功`);
            // 刷新导入文件列表
            refreshImportFiles();
        } else {
            resultDiv.innerHTML = `<div class="model-error">❌ ${data.error}</div>`;
            addLog('error', `导出失败: ${data.error}`);
        }
    })
    .catch(err => {
        resultDiv.innerHTML = `<div class="model-error">❌ 请求失败: ${err.message}</div>`;
        addLog('error', `导出请求失败: ${err.message}`);
    });
}

function refreshImportFiles() {
    const select = document.getElementById('importFileSelect');
    select.innerHTML = '<option value="">-- 加载中... --</option>';

    fetch('/api/models/exported')
        .then(res => res.json())
        .then(data => {
            if (data.ok && data.models.length > 0) {
                select.innerHTML = '<option value="">-- 选择导出文件 --</option>';
                data.models.forEach(f => {
                    // 优先显示完整导出文件
                    if (f.name.includes('dqn_full')) {
                        const opt = document.createElement('option');
                        opt.value = f.path;
                        opt.textContent = `${f.name} (${f.size_kb}KB, ${f.modified})`;
                        select.prepend(opt);
                    } else {
                        const opt = document.createElement('option');
                        opt.value = f.path;
                        opt.textContent = `${f.name} (${f.size_kb}KB, ${f.modified})`;
                        select.appendChild(opt);
                    }
                });
            } else {
                select.innerHTML = '<option value="">-- 没有导出文件 --</option>';
            }
        })
        .catch(() => {
            select.innerHTML = '<option value="">-- 加载失败 --</option>';
        });
}

function importModel() {
    const botIndex = parseInt(document.getElementById('importBotSelect').value);
    const filePath = document.getElementById('importFileSelect').value;
    const resultDiv = document.getElementById('importResult');

    if (!filePath) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<div class="model-error">❌ 请先选择要导入的文件</div>';
        return;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="model-loading">⏳ 正在导入模型...</div>';
    addLog('info', `正在导入模型到 Bot ${botIndex + 1}...`);

    fetch('/api/model/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_index: botIndex, file_path: filePath })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            resultDiv.innerHTML = `<div class="model-success">✅ ${data.message}</div>`;
            addLog('success', `模型已导入到 Bot ${botIndex + 1}`);
        } else {
            resultDiv.innerHTML = `<div class="model-error">❌ ${data.error}</div>`;
            addLog('error', `导入失败: ${data.error}`);
        }
    })
    .catch(err => {
        resultDiv.innerHTML = `<div class="model-error">❌ 请求失败: ${err.message}</div>`;
        addLog('error', `导入请求失败: ${err.message}`);
    });
}

// ==================== 斗法 ====================

function startDuel() {
    const bot1 = parseInt(document.getElementById('duelBot1Select').value);
    const bot2 = parseInt(document.getElementById('duelBot2Select').value);
    const episodes = parseInt(document.getElementById('duelEpisodes').value) || 5;
    const resultDiv = document.getElementById('duelResult');

    if (bot1 === bot2) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<div class="model-error">❌ 请选择两个不同的Bot</div>';
        return;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="model-loading">⏳ 斗法进行中 (约30-60秒)...</div>';
    addLog('info', `⚔️ 开始斗法: Bot ${bot1 + 1} vs Bot ${bot2 + 1} (${episodes}轮)`);

    fetch('/api/duel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot1, bot2, episodes, max_steps: 100 })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            // 格式化输出
            const output = data.output || '';
            const formatted = output
                .replace(/\n/g, '<br>')
                .replace(/(✅|❌|🏆|⚔️|📊)/g, '<strong>$1</strong>');
            resultDiv.innerHTML = `
                <div class="model-success">✅ ${data.message}</div>
                <div class="duel-output">${formatted}</div>
            `;
            addLog('success', `⚔️ 斗法完成: Bot ${bot1 + 1} vs Bot ${bot2 + 1}`);
            // 也输出到日志
            output.split('\n').forEach(line => {
                if (line.trim()) addLog('info', `  ${line.trim()}`);
            });
        } else {
            resultDiv.innerHTML = `<div class="model-error">❌ ${data.error}</div>`;
            addLog('error', `斗法失败: ${data.error}`);
        }
    })
    .catch(err => {
        resultDiv.innerHTML = `<div class="model-error">❌ 请求失败: ${err.message}</div>`;
        addLog('error', `斗法请求失败: ${err.message}`);
    });
}

function startTournament() {
    const episodes = parseInt(document.getElementById('duelEpisodes').value) || 3;
    const resultDiv = document.getElementById('duelResult');

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div class="model-loading">⏳ 循环赛进行中 (可能需要2-5分钟)...</div>';
    addLog('info', `🏆 开始斗法循环赛 (每场${episodes}轮)`);

    fetch('/api/duel/tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, max_steps: 80 })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            const output = data.output || '';
            const formatted = output
                .replace(/\n/g, '<br>')
                .replace(/(✅|❌|🏆|⚔️|📊)/g, '<strong>$1</strong>');
            resultDiv.innerHTML = `
                <div class="model-success">✅ ${data.message}</div>
                <div class="duel-output">${formatted}</div>
            `;
            addLog('success', '🏆 斗法循环赛完成');
            output.split('\n').forEach(line => {
                if (line.trim()) addLog('info', `  ${line.trim()}`);
            });
        } else {
            resultDiv.innerHTML = `<div class="model-error">❌ ${data.error}</div>`;
            addLog('error', `循环赛失败: ${data.error}`);
        }
    })
    .catch(err => {
        resultDiv.innerHTML = `<div class="model-error">❌ 请求失败: ${err.message}</div>`;
        addLog('error', `循环赛请求失败: ${err.message}`);
    });
}