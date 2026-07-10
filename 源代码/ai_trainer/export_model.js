/**
 * 艾德尔修仙传 - DQN模型导出工具
 * ==============================
 * 功能：
 * 1. 加载训练好的 DQN 模型
 * 2. 导出为轻量级 JSON 格式（仅含权重和偏置）
 * 3. 生成可直接在浏览器中运行的 AI 决策脚本（含游戏循环模拟器、挂机模式）
 * 4. 支持导出为 Python 格式（用于进一步分析）
 * 5. 导出完整训练状态（含经验回放缓冲区），可用于继续训练
 *
 * 用法：
 *   node export_model.js <bot_index> [output_format]
 *
 *   参数：
 *     bot_index    - 机器人索引 (0-9)
 *     output_format - 导出格式: json | web | python | full (默认: web)
 *                     full 格式包含完整训练状态（含经验回放缓冲区）
 *
 *   示例：
 *     node export_model.js 0          # 导出 Bot 0 为网页格式
 *     node export_model.js 0 json     # 导出为纯 JSON
 *     node export_model.js 0 python   # 导出为 Python 格式
 *     node export_model.js 0 full     # 导出完整训练状态（含经验回放）
 *     node export_model.js 0 all      # 导出所有格式
 */

const fs = require('fs');
const path = require('path');
const { DQNAgent, NeuralNetwork } = require('./dqn_agent.js');

// ==================== 配置 ====================

const MODEL_DIR = path.join(__dirname, 'models');
const EXPORT_DIR = path.join(__dirname, 'exported_models');

// 动作名称映射（与 game_environment.js 保持一致）
const ACTIONS = [
    '普通攻击',       // 0
    '使用技能1',      // 1
    '使用技能2',      // 2
    '使用技能3',      // 3
    '治疗',           // 4
    '使用HP药水',     // 5
    '使用MP药水',     // 6
    '切换高级地图',   // 7
    '切换低级地图',   // 8
    '升级',           // 9
    '突破',           // 10
    '整理装备',       // 11
    '领取邮件',       // 12
    '等待同步',       // 13
    '切换自动战斗',   // 14
    '炼丹',           // 15
    '锻造装备',       // 16
    '升级锻造',       // 17
    '重铸装备',       // 18
    '洞府采集',       // 19
    '洞府升级',       // 20
    '洞府阵法',       // 21
    '创建传人',       // 22
    '派遣传人',       // 23
    '召回传人',       // 24
    '宗门贡献',       // 25
    '宗门学习',       // 26
    '宗门任务',       // 27
    '联盟祈福',       // 28
    '联盟沐浴',       // 29
    '联盟采摘',       // 30
    '联盟冥想',       // 31
    '副本探索',       // 32
    '试炼挑战',       // 33
    '交易所买卖',     // 34
];

// 状态特征名称（与 game_environment.js getState() 保持一致）
const STATE_FEATURES = [
    '等级',               // 0
    '经验百分比',         // 1
    'HP百分比',           // 2
    'MP百分比',           // 3
    '物理攻击',           // 4
    '物理防御',           // 5
    '法术攻击',           // 6
    '法术防御',           // 7
    '力量',               // 8
    '体质',               // 9
    '敏捷',               // 10
    '真元',               // 11
    '灵石',               // 12
    '最大HP',             // 13
    '最大MP',             // 14
    '装备数量',           // 15
    '技能数量',           // 16
    '药水数量',           // 17
    '材料数量',           // 18
    '锻造材料数量',       // 19
    '有治疗技能',         // 20
    '有攻击技能',         // 21
    '已装备技能数',       // 22
    '地图等级',           // 23
    '地图ID',             // 24
    '胜率',               // 25
    '连胜次数',           // 26
    '连败次数',           // 27
    '上局结果',           // 28
    '步数进度',           // 29
    '可突破',             // 30
    '正在休息',           // 31
    '已加入宗门',         // 32
    '已加入联盟',         // 33
    '有洞府',             // 34
    '有传人',             // 35
    '有进行中任务',       // 36
    '自动战斗',           // 37
    '境界',               // 38
    '境界等级',           // 39
    '宗门贡献',           // 40
    '试炼币',             // 41
    '联赛积分',           // 42
    '洞府等级',           // 43
    '洞府资源',           // 44
    '命途点数',           // 45
    '天赋点数',           // 46
    '邀请点数',           // 47
    '传人试炼积分',       // 48
    '联赛点数',           // 49
];

// ==================== 工具函数 ====================

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function formatNumber(n, decimals = 6) {
    if (typeof n === 'number') {
        return parseFloat(n.toFixed(decimals));
    }
    return n;
}

function deepFormatNumbers(obj, decimals = 6) {
    if (Array.isArray(obj)) {
        return obj.map(item => deepFormatNumbers(item, decimals));
    }
    if (typeof obj === 'number') {
        return formatNumber(obj, decimals);
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const key of Object.keys(obj)) {
            result[key] = deepFormatNumbers(obj[key], decimals);
        }
        return result;
    }
    return obj;
}

// ==================== 模型加载 ====================

function loadModel(botIndex) {
    const modelPath = path.join(MODEL_DIR, `bot_${botIndex}_model.json`);
    
    if (!fs.existsSync(modelPath)) {
        console.error(`[错误] 模型文件不存在: ${modelPath}`);
        console.error(`请先运行训练: node train.js`);
        return null;
    }

    console.log(`[加载] 从 ${modelPath} 加载模型...`);
    const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    
    // 创建 DQNAgent 实例来加载模型（50维状态，35个动作）
    const agent = new DQNAgent(50, 35);
    agent.loadModel(modelPath);
    
    return {
        agent,
        raw,
        botIndex,
        stats: raw.stats,
        hyperparams: raw.hyperparams,
        network: {
            layerSizes: raw.policyNet.layerSizes,
            weights: raw.policyNet.weights,
            biases: raw.policyNet.biases,
        }
    };
}

// ==================== 导出格式 ====================

/**
 * 导出为纯 JSON 格式（最精简）
 */
function exportJson(modelData) {
    const { network, stats, hyperparams, botIndex } = modelData;
    
    const exported = {
        meta: {
            name: `艾德尔修仙传 AI 模型 - Bot ${botIndex}`,
            version: '2.0',
            exportTime: new Date().toISOString(),
            framework: 'DQN',
            stateDim: 50,
            actionDim: 35,
            layerSizes: network.layerSizes,
        },
        network: {
            weights: deepFormatNumbers(network.weights, 8),
            biases: deepFormatNumbers(network.biases, 8),
        },
        training: {
            episodes: stats.episodes,
            totalReward: formatNumber(stats.totalReward),
            avgReward: formatNumber(stats.avgReward),
            maxReward: formatNumber(stats.maxReward),
            epsilon: formatNumber(stats.epsilon || modelData.agent.epsilon),
        },
        hyperparams: hyperparams || {},
        actions: ACTIONS,
        stateFeatures: STATE_FEATURES,
    };

    return exported;
}

/**
 * 导出为网页格式（包含完整的浏览器端推理代码 + 游戏循环模拟器 + 挂机模式）
 */
function exportWeb(modelData) {
    const { network, stats, hyperparams, botIndex } = modelData;
    const jsonData = exportJson(modelData);
    
    // 生成可直接在浏览器中使用的 HTML+JS
    const weightsJson = JSON.stringify(deepFormatNumbers(network.weights, 8));
    const biasesJson = JSON.stringify(deepFormatNumbers(network.biases, 8));
    const actionsJson = JSON.stringify(ACTIONS);
    const featuresJson = JSON.stringify(STATE_FEATURES);
    
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>艾德尔修仙传 - AI 决策引擎 v${botIndex}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Microsoft YaHei', sans-serif; background: #0a0e1a; color: #e0e0e0; padding: 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { color: #f1c40f; text-align: center; margin-bottom: 20px; font-size: 24px; }
  .card { background: #1a2236; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #2a3a5c; }
  .card h2 { color: #4ecdc4; font-size: 16px; margin-bottom: 12px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .stat-item { background: #0d1525; padding: 10px; border-radius: 8px; text-align: center; }
  .stat-item .label { color: #8899bb; font-size: 12px; }
  .stat-item .value { color: #f1c40f; font-size: 18px; font-weight: bold; margin-top: 4px; }
  .state-input { width: 100%; min-height: 120px; background: #0d1525; border: 1px solid #2a3a5c; color: #e0e0e0; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; resize: vertical; }
  .btn { background: #4ecdc4; color: #0a0e1a; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; margin-top: 10px; }
  .btn:hover { background: #45b7b0; }
  .btn-danger { background: #e74c3c; }
  .btn-danger:hover { background: #c0392b; }
  .btn-warning { background: #f39c12; }
  .btn-warning:hover { background: #d68910; }
  .btn-small { padding: 6px 14px; font-size: 12px; margin-top: 0; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .result { margin-top: 12px; padding: 12px; border-radius: 8px; }
  .result .action { font-size: 20px; color: #4ecdc4; font-weight: bold; }
  .result .qvalues { margin-top: 8px; }
  .qbar { display: flex; align-items: center; margin: 3px 0; font-size: 12px; }
  .qbar .label { width: 100px; color: #8899bb; }
  .qbar .bar-bg { flex: 1; height: 16px; background: #0d1525; border-radius: 4px; overflow: hidden; margin: 0 8px; }
  .qbar .bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .qbar .bar.positive { background: #4ecdc4; }
  .qbar .bar.negative { background: #e74c3c; }
  .qbar .value { width: 50px; text-align: right; font-family: monospace; color: #8899bb; }
  .features-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; font-size: 12px; }
  .features-list .feat { display: flex; justify-content: space-between; padding: 2px 8px; background: #0d1525; border-radius: 4px; }
  .features-list .feat .name { color: #8899bb; }
  .features-list .feat .val { color: #f1c40f; font-family: monospace; }
  /* 新增样式 */
  .loop-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .loop-controls label { color: #8899bb; font-size: 13px; }
  .loop-controls input[type="number"] { background: #0d1525; border: 1px solid #2a3a5c; color: #e0e0e0; padding: 6px 10px; border-radius: 6px; width: 100px; font-size: 13px; }
  .loop-status { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 10px; }
  .loop-status .stat-item .value.running { color: #2ecc71; }
  .loop-status .stat-item .value.stopped { color: #e74c3c; }
  .stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .stats-table th { color: #8899bb; text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a3a5c; }
  .stats-table td { padding: 6px 8px; border-bottom: 1px solid #1a2236; }
  .stats-table .bar-cell { display: flex; align-items: center; gap: 8px; }
  .stats-table .bar-cell .bar-bg { flex: 1; height: 12px; background: #0d1525; border-radius: 4px; overflow: hidden; }
  .stats-table .bar-cell .bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #4ecdc4, #f1c40f); transition: width 0.3s; }
  .decision-history { max-height: 300px; overflow-y: auto; font-size: 12px; }
  .decision-history table { width: 100%; border-collapse: collapse; }
  .decision-history th { color: #8899bb; text-align: left; padding: 4px 6px; border-bottom: 1px solid #2a3a5c; font-size: 11px; position: sticky; top: 0; background: #1a2236; }
  .decision-history td { padding: 4px 6px; border-bottom: 1px solid #0d1525; font-family: monospace; }
  .decision-history .step-num { color: #667; }
  .decision-history .action-name { color: #4ecdc4; }
  .decision-history .q-val { color: #f1c40f; }
  .decision-history .timestamp { color: #667; font-size: 10px; }
  .afk-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .tab-bar { display: flex; gap: 4px; margin-bottom: 12px; }
  .tab-btn { background: #0d1525; color: #8899bb; border: 1px solid #2a3a5c; padding: 8px 16px; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 13px; }
  .tab-btn.active { background: #1a2236; color: #4ecdc4; border-bottom-color: #1a2236; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .log-area { width: 100%; height: 200px; background: #0d1525; border: 1px solid #2a3a5c; color: #e0e0e0; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 11px; resize: vertical; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; }
  .badge-running { background: #2ecc71; color: #0a0e1a; }
  .badge-stopped { background: #e74c3c; color: #fff; }
  .flex-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
<div class="container">
  <h1>🧠 艾德尔修仙传 · AI 决策引擎</h1>
  
  <div class="card">
    <h2>📊 模型信息</h2>
    <div class="stat-grid">
      <div class="stat-item"><div class="label">训练集数</div><div class="value">${stats.episodes || 0}</div></div>
      <div class="stat-item"><div class="label">平均奖励</div><div class="value">${formatNumber(stats.avgReward || 0)}</div></div>
      <div class="stat-item"><div class="label">最高奖励</div><div class="value">${formatNumber(stats.maxReward || 0)}</div></div>
      <div class="stat-item"><div class="label">探索率 ε</div><div class="value">${formatNumber(stats.epsilon || modelData.agent.epsilon)}</div></div>
      <div class="stat-item"><div class="label">网络结构</div><div class="value" style="font-size:13px">${network.layerSizes.join(' → ')}</div></div>
    </div>
  </div>

  <div class="card">
    <h2>🎮 状态输入</h2>
    <p style="color:#8899bb;font-size:12px;margin-bottom:8px">输入 50 维状态向量（用逗号分隔），或点击"使用示例"</p>
    <textarea id="stateInput" class="state-input" placeholder="例如: 0.1, 0.5, 0.8, 0.3, ... (共50个值)"></textarea>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="useExample()">📋 使用示例</button>
      <button class="btn" onclick="predict()">🔮 预测动作</button>
    </div>
    <div id="result" class="result" style="display:none"></div>
  </div>

  <!-- ===== 自动循环控制面板 ===== -->
  <div class="card" id="loopPanel">
    <h2>🔄 自动决策循环</h2>
    <div class="loop-controls">
      <label>间隔(ms): <input type="number" id="loopInterval" value="1000" min="100" max="60000" step="100"></label>
      <button class="btn btn-small" id="btnStartLoop" onclick="startLoop()">▶ 启动循环</button>
      <button class="btn btn-small btn-danger" id="btnStopLoop" onclick="stopLoop()" disabled>⏹ 停止循环</button>
      <span id="loopStatusBadge" class="badge badge-stopped">已停止</span>
    </div>
    <div class="loop-status" id="loopStatus">
      <div class="stat-item"><div class="label">当前步数</div><div class="value" id="loopStepCount">0</div></div>
      <div class="stat-item"><div class="label">运行时间</div><div class="value" id="loopElapsed">0s</div></div>
      <div class="stat-item"><div class="label">步数/分钟</div><div class="value" id="loopStepsPerMin">0</div></div>
      <div class="stat-item"><div class="label">最后动作</div><div class="value" id="loopLastAction" style="font-size:13px">-</div></div>
    </div>
  </div>

  <!-- ===== 动作统计 + 实时决策 + 挂机面板 (标签页) ===== -->
  <div class="card">
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchTab('statsTab')">📊 动作统计</button>
      <button class="tab-btn" onclick="switchTab('historyTab')">📝 实时决策</button>
      <button class="tab-btn" onclick="switchTab('afkTab')">💤 挂机模式</button>
    </div>

    <!-- 动作统计面板 -->
    <div id="statsTab" class="tab-content active">
      <h2 style="color:#4ecdc4;font-size:15px;margin-bottom:10px">各动作执行次数</h2>
      <div id="actionStatsContainer">
        <p style="color:#667;font-size:13px">启动自动循环后，此处将显示各动作的执行统计。</p>
      </div>
      <h2 style="color:#4ecdc4;font-size:15px;margin:16px 0 10px">🏆 Top-5 动作排名</h2>
      <div id="topActionsContainer">
        <p style="color:#667;font-size:13px">暂无数据</p>
      </div>
    </div>

    <!-- 实时决策面板 -->
    <div id="historyTab" class="tab-content">
      <h2 style="color:#4ecdc4;font-size:15px;margin-bottom:10px">最近决策历史</h2>
      <div class="decision-history" id="decisionHistory">
        <p style="color:#667;font-size:13px">启动自动循环后，此处将显示最近的决策记录。</p>
      </div>
    </div>

    <!-- 挂机模式面板 -->
    <div id="afkTab" class="tab-content">
      <h2 style="color:#4ecdc4;font-size:15px;margin-bottom:10px">💤 挂机模式</h2>
      <p style="color:#8899bb;font-size:12px;margin-bottom:10px">启动挂机模式后，AI 将自动循环执行决策，适合长时间无人值守运行。</p>
      <div class="flex-row" style="margin-bottom:12px">
        <button class="btn btn-small" id="btnStartAfk" onclick="startAfkMode()">💤 开始挂机</button>
        <button class="btn btn-small btn-danger" id="btnStopAfk" onclick="stopAfkMode()" disabled>⏹ 停止挂机</button>
        <span id="afkStatusBadge" class="badge badge-stopped">未挂机</span>
      </div>
      <div class="afk-stats" id="afkStats">
        <div class="stat-item"><div class="label">总步数</div><div class="value" id="afkTotalSteps">0</div></div>
        <div class="stat-item"><div class="label">总时间</div><div class="value" id="afkTotalTime">0s</div></div>
        <div class="stat-item"><div class="label">平均 Q 值</div><div class="value" id="afkAvgQ">0</div></div>
        <div class="stat-item"><div class="label">动作分布</div><div class="value" id="afkActionDist" style="font-size:11px">-</div></div>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-small" onclick="exportAfkLog()">📥 导出挂机日志</button>
        <button class="btn btn-small btn-warning" onclick="clearAfkLog()">🗑 清空日志</button>
      </div>
      <div style="margin-top:10px">
        <label style="color:#8899bb;font-size:12px">挂机日志:</label>
        <textarea id="afkLogArea" class="log-area" readonly placeholder="挂机日志将显示在这里..."></textarea>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>📋 状态特征说明</h2>
    <div class="features-list" id="featuresList"></div>
  </div>
</div>

<script>
// ==================== 神经网络推理引擎 ====================
class DQNInference {
  constructor(weights, biases, layerSizes) {
    this.weights = weights;
    this.biases = biases;
    this.layerSizes = layerSizes;
  }

  // ReLU 激活函数
  relu(x) { return x > 0 ? x : 0; }

  // 前向传播
  predict(input) {
    let current = input;
    for (let layer = 0; layer < this.weights.length; layer++) {
      const w = this.weights[layer];
      const b = this.biases[layer];
      const next = [];
      for (let j = 0; j < w[0].length; j++) {
        let sum = b[j];
        for (let i = 0; i < current.length; i++) {
          sum += current[i] * w[i][j];
        }
        // 最后一层用线性激活，其他用 ReLU
        next[j] = (layer === this.weights.length - 1) ? sum : this.relu(sum);
      }
      current = next;
    }
    return current;
  }

  // 获取最佳动作
  getBestAction(state) {
    const qValues = this.predict(state);
    let bestAction = 0;
    let bestValue = qValues[0];
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > bestValue) {
        bestValue = qValues[i];
        bestAction = i;
      }
    }
    return { action: bestAction, qValues, bestValue };
  }
}

// ==================== 游戏循环模拟器 ====================
class GameLoopSimulator {
  constructor(dqn, actions, stateFeatures) {
    this.dqn = dqn;
    this.actions = actions;
    this.stateFeatures = stateFeatures;
    this.running = false;
    this.timer = null;
    this.stepCount = 0;
    this.totalReward = 0;
    this.history = [];
    this.currentState = null;
    this.stats = {
      actionsTaken: {},
      totalSteps: 0,
      startTime: null,
      lastAction: null,
    };
    // 初始化动作计数
    actions.forEach((name, i) => { this.stats.actionsTaken[name] = 0; });
  }

  // 从真实游戏页面提取状态（通过 content script 注入）
  extractStateFromPage() {
    if (typeof window !== 'undefined' && window.__GAME_STATE__) {
      return window.__GAME_STATE__;
    }
    return null;
  }

  // 构建 50 维状态向量（从真实数据或模拟数据）
  buildState(partialState = null) {
    if (partialState) {
      const state = new Array(50).fill(0);
      for (let i = 0; i < Math.min(partialState.length, 50); i++) {
        if (partialState[i] !== undefined) state[i] = partialState[i];
      }
      return state;
    }
    return this.currentState || new Array(50).fill(0);
  }

  // 执行一步决策
  step(state) {
    const result = this.dqn.getBestAction(state);
    const actionName = this.actions[result.action];

    this.stats.actionsTaken[actionName] = (this.stats.actionsTaken[actionName] || 0) + 1;
    this.stats.totalSteps++;
    this.stats.lastAction = { action: result.action, name: actionName, time: new Date().toISOString() };

    this.history.push({
      step: this.stepCount++,
      state: [...state],
      action: result.action,
      actionName: actionName,
      qValues: [...result.qValues],
      bestValue: result.bestValue,
      timestamp: Date.now()
    });

    // 保留最近 1000 步历史
    if (this.history.length > 1000) this.history.shift();

    return result;
  }

  // 启动自动循环
  start(intervalMs = 1000, stateProvider = null) {
    if (this.running) return;
    this.running = true;
    this.stats.startTime = Date.now();

    const loop = () => {
      if (!this.running) return;

      try {
        let state;
        // 优先使用外部状态提供者
        if (stateProvider) {
          state = stateProvider();
        } else {
          state = this.extractStateFromPage();
        }

        if (state && state.length === 50) {
          this.currentState = state;
          const result = this.step(state);
          this.onDecision(result);
        }
      } catch (e) {
        console.error('[AILoop] Error:', e);
      }

      if (this.running) {
        this.timer = setTimeout(loop, intervalMs);
      }
    };

    loop();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // 决策回调 - 会被 UI 覆盖
  onDecision(result) {}

  // 获取运行统计
  getStats() {
    const elapsed = this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 : 0;
    return {
      ...this.stats,
      elapsedSeconds: elapsed,
      stepsPerMinute: elapsed > 0 ? (this.stats.totalSteps / elapsed * 60).toFixed(1) : 0,
      topActions: Object.entries(this.stats.actionsTaken)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count, pct: (count / Math.max(1, this.stats.totalSteps) * 100).toFixed(1) }))
    };
  }

  // 获取最近决策历史
  getRecentHistory(n = 10) {
    return this.history.slice(-n).reverse();
  }

  // 获取挂机统计摘要
  getAfkSummary() {
    const elapsed = this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 : 0;
    const recentQ = this.history.slice(-100).map(h => h.bestValue);
    const avgQ = recentQ.length > 0 ? recentQ.reduce((a, b) => a + b, 0) / recentQ.length : 0;
    return {
      totalSteps: this.stats.totalSteps,
      elapsedSeconds: elapsed,
      avgQValue: avgQ,
      actionDistribution: Object.entries(this.stats.actionsTaken)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => name + ':' + count)
        .join(', ')
    };
  }

  // 导出挂机日志
  exportLog() {
    const lines = [];
    lines.push('=== 艾德尔修仙传 AI 挂机日志 ===');
    lines.push('导出时间: ' + new Date().toISOString());
    lines.push('总步数: ' + this.stats.totalSteps);
    lines.push('');
    lines.push('步数, 动作, 动作名称, 最佳Q值, 时间戳');
    this.history.forEach(h => {
      lines.push(h.step + ', ' + h.action + ', ' + h.actionName + ', ' + h.bestValue.toFixed(4) + ', ' + new Date(h.timestamp).toISOString());
    });
    return lines.join('\\n');
  }
}

// ==================== 加载模型权重 ====================
const MODEL_WEIGHTS = ${weightsJson};
const MODEL_BIASES = ${biasesJson};
const LAYER_SIZES = ${JSON.stringify(network.layerSizes)};
const ACTIONS = ${actionsJson};
const STATE_FEATURES = ${featuresJson};

const dqn = new DQNInference(MODEL_WEIGHTS, MODEL_BIASES, LAYER_SIZES);
const simulator = new GameLoopSimulator(dqn, ACTIONS, STATE_FEATURES);

// ==================== UI 逻辑 ====================

// 渲染状态特征说明
const featuresList = document.getElementById('featuresList');
STATE_FEATURES.forEach((name, i) => {
  const div = document.createElement('div');
  div.className = 'feat';
  div.innerHTML = '<span class="name">[' + i + '] ' + name + '</span>';
  featuresList.appendChild(div);
});

function useExample() {
  // 生成一个典型的中期状态示例（50维）
  const example = [
    0.125,  // 0:  等级 50/400
    0.45,   // 1:  经验 45%
    0.82,   // 2:  HP 82%
    0.65,   // 3:  MP 65%
    0.18,   // 4:  物理攻击
    0.12,   // 5:  物理防御
    0.22,   // 6:  法术攻击
    0.14,   // 7:  法术防御
    0.35,   // 8:  力量
    0.28,   // 9:  体质
    0.20,   // 10: 敏捷
    0.15,   // 11: 真元
    0.05,   // 12: 灵石
    0.50,   // 13: 最大HP
    0.50,   // 14: 最大MP
    0.24,   // 15: 装备数量
    0.40,   // 16: 技能数量
    0.08,   // 17: 药水数量
    0.15,   // 18: 材料数量
    0.05,   // 19: 锻造材料数量
    1,      // 20: 有治疗技能
    1,      // 21: 有攻击技能
    3,      // 22: 已装备技能数
    0.125,  // 23: 地图等级
    0.10,   // 24: 地图ID
    0.60,   // 25: 胜率
    0.15,   // 26: 连胜
    0.05,   // 27: 连败
    1,      // 28: 上局胜利
    0.10,   // 29: 步数进度
    0,      // 30: 不可突破
    0,      // 31: 不在休息
    1,      // 32: 已加入宗门
    0,      // 33: 未加入联盟
    0,      // 34: 无洞府
    0,      // 35: 无传人
    0,      // 36: 无任务
    1,      // 37: 自动战斗
    0.20,   // 38: 境界
    0.10,   // 39: 境界等级
    0.05,   // 40: 宗门贡献
    0.02,   // 41: 试炼币
    0.35,   // 42: 联赛积分
    0,      // 43: 洞府等级
    0,      // 44: 洞府资源
    0.01,   // 45: 命途点数
    0.01,   // 46: 天赋点数
    0,      // 47: 邀请点数
    0,      // 48: 传人试炼积分
    0.10,   // 49: 联赛点数
  ];
  document.getElementById('stateInput').value = example.join(', ');
  updateFeatureValues(example);
}

function updateFeatureValues(values) {
  const items = featuresList.querySelectorAll('.feat');
  items.forEach((item, i) => {
    if (i < values.length) {
      const valSpan = item.querySelector('.val');
      if (!valSpan) {
        const span = document.createElement('span');
        span.className = 'val';
        span.textContent = values[i].toFixed(4);
        item.appendChild(span);
      } else {
        valSpan.textContent = values[i].toFixed(4);
      }
    }
  });
}

function predict() {
  const input = document.getElementById('stateInput').value.trim();
  let state;

  try {
    state = input.split(/[,\\s]+/).map(Number);
    if (state.length !== 50) {
      alert('需要恰好 50 个值，当前有 ' + state.length + ' 个');
      return;
    }
    if (state.some(isNaN)) {
      alert('存在无效数值');
      return;
    }
  } catch (e) {
    alert('输入格式错误: ' + e.message);
    return;
  }

  updateFeatureValues(state);

  const result = dqn.getBestAction(state);
  const resultDiv = document.getElementById('result');

  // 对 Q 值进行 softmax 以获得概率
  const maxQ = Math.max(...result.qValues);
  const expQ = result.qValues.map(q => Math.exp(q - maxQ));
  const sumExp = expQ.reduce((a, b) => a + b, 0);
  const probs = expQ.map(e => e / sumExp);

  let html = '<div style="margin-bottom:12px">';
  html += '<span style="color:#8899bb;font-size:14px">🤖 推荐动作: </span>';
  html += '<span class="action">' + ACTIONS[result.action] + '</span>';
  html += ' <span style="color:#f1c40f;font-size:14px">(Q=' + result.bestValue.toFixed(4) + ')</span>';
  html += '</div>';

  html += '<div class="qvalues"><h3 style="color:#8899bb;font-size:13px;margin-bottom:6px">所有动作 Q 值:</h3>';

  // 按 Q 值排序
  const sorted = result.qValues.map((q, i) => ({ action: i, name: ACTIONS[i], q, prob: probs[i] }))
    .sort((a, b) => b.q - a.q);

  const maxQVal = Math.max(...result.qValues);
  const minQVal = Math.min(...result.qValues);
  const range = Math.max(Math.abs(maxQVal), Math.abs(minQVal), 0.01);

  sorted.forEach(item => {
    const pct = (item.q / range) * 100;
    const barClass = item.q >= 0 ? 'positive' : 'negative';
    const isBest = item.action === result.action;
    html += '<div class="qbar"' + (isBest ? ' style="background:#0d1525;border-radius:4px;padding:2px 0"' : '') + '>';
    html += '<span class="label">' + (isBest ? '⭐ ' : '') + item.name + '</span>';
    html += '<div class="bar-bg"><div class="bar ' + barClass + '" style="width:' + Math.abs(pct) + '%"></div></div>';
    html += '<span class="value">' + item.q.toFixed(4) + '</span>';
    html += '<span style="width:40px;text-align:right;color:#667;font-size:11px">' + (item.prob * 100).toFixed(1) + '%</span>';
    html += '</div>';
  });

  html += '</div>';

  resultDiv.innerHTML = html;
  resultDiv.style.display = 'block';
}

// ==================== 自动循环控制 ====================

function startLoop() {
  const interval = parseInt(document.getElementById('loopInterval').value) || 1000;

  // 使用状态输入框的值作为状态提供者
  simulator.onDecision = function(result) {
    updateLoopUI(result);
    updateStatsUI();
    updateHistoryUI();
  };

  // 状态提供者：从输入框读取
  const stateProvider = function() {
    const input = document.getElementById('stateInput').value.trim();
    try {
      const state = input.split(/[,\\s]+/).map(Number);
      if (state.length === 50 && !state.some(isNaN)) {
        return state;
      }
    } catch(e) {}
    return null;
  };

  simulator.start(interval, stateProvider);

  document.getElementById('btnStartLoop').disabled = true;
  document.getElementById('btnStopLoop').disabled = false;
  document.getElementById('loopStatusBadge').textContent = '运行中';
  document.getElementById('loopStatusBadge').className = 'badge badge-running';
}

function stopLoop() {
  simulator.stop();

  document.getElementById('btnStartLoop').disabled = false;
  document.getElementById('btnStopLoop').disabled = true;
  document.getElementById('loopStatusBadge').textContent = '已停止';
  document.getElementById('loopStatusBadge').className = 'badge badge-stopped';
}

function updateLoopUI(result) {
  const stats = simulator.getStats();
  document.getElementById('loopStepCount').textContent = stats.totalSteps;
  document.getElementById('loopElapsed').textContent = stats.elapsedSeconds.toFixed(1) + 's';
  document.getElementById('loopStepsPerMin').textContent = stats.stepsPerMinute;
  if (result) {
    document.getElementById('loopLastAction').textContent = ACTIONS[result.action] + ' (Q=' + result.bestValue.toFixed(2) + ')';
  }
}

// ==================== 动作统计面板 ====================

function updateStatsUI() {
  const stats = simulator.getStats();

  // 动作统计表格
  const container = document.getElementById('actionStatsContainer');
  const maxCount = Math.max(1, ...Object.values(stats.actionsTaken));
  let html = '<table class="stats-table">';
  html += '<tr><th>动作名称</th><th>执行次数</th><th>占比</th><th>分布</th></tr>';
  Object.entries(stats.actionsTaken)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      if (count === 0) return;
      const pct = (count / Math.max(1, stats.totalSteps) * 100).toFixed(1);
      const barWidth = (count / maxCount * 100).toFixed(0);
      html += '<tr>';
      html += '<td>' + name + '</td>';
      html += '<td>' + count + '</td>';
      html += '<td>' + pct + '%</td>';
      html += '<td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:' + barWidth + '%"></div></div></td>';
      html += '</tr>';
    });
  html += '</table>';
  container.innerHTML = html;

  // Top-5 排名
  const topContainer = document.getElementById('topActionsContainer');
  if (stats.topActions.length === 0) {
    topContainer.innerHTML = '<p style="color:#667;font-size:13px">暂无数据</p>';
    return;
  }
  let topHtml = '<table class="stats-table">';
  topHtml += '<tr><th>排名</th><th>动作名称</th><th>次数</th><th>占比</th></tr>';
  stats.topActions.forEach((item, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    topHtml += '<tr>';
    topHtml += '<td>' + medal + '</td>';
    topHtml += '<td>' + item.name + '</td>';
    topHtml += '<td>' + item.count + '</td>';
    topHtml += '<td>' + item.pct + '%</td>';
    topHtml += '</tr>';
  });
  topHtml += '</table>';
  topContainer.innerHTML = topHtml;
}

// ==================== 实时决策面板 ====================

function updateHistoryUI() {
  const history = simulator.getRecentHistory(10);
  const container = document.getElementById('decisionHistory');

  if (history.length === 0) {
    container.innerHTML = '<p style="color:#667;font-size:13px">暂无决策记录</p>';
    return;
  }

  let html = '<table>';
  html += '<tr><th>步数</th><th>动作</th><th>最佳Q值</th><th>时间</th></tr>';
  history.forEach(h => {
    const time = new Date(h.timestamp);
    const timeStr = time.getHours().toString().padStart(2,'0') + ':' +
                    time.getMinutes().toString().padStart(2,'0') + ':' +
                    time.getSeconds().toString().padStart(2,'0');
    html += '<tr>';
    html += '<td class="step-num">#' + h.step + '</td>';
    html += '<td class="action-name">' + h.actionName + '</td>';
    html += '<td class="q-val">' + h.bestValue.toFixed(4) + '</td>';
    html += '<td class="timestamp">' + timeStr + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;
}

// ==================== 标签页切换 ====================

function switchTab(tabId) {
  // 隐藏所有标签内容
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('active');
  });

  // 显示选中的标签
  document.getElementById(tabId).classList.add('active');
  document.querySelector('.tab-btn[onclick="switchTab(\\'' + tabId + '\\')"]').classList.add('active');
}

// ==================== 挂机模式 ====================

let afkInterval = null;

function startAfkMode() {
  const interval = parseInt(document.getElementById('loopInterval').value) || 1000;

  // 先停止普通循环（如果有）
  if (simulator.running) {
    simulator.stop();
    document.getElementById('btnStartLoop').disabled = false;
    document.getElementById('btnStopLoop').disabled = true;
  }

  // 设置挂机回调
  simulator.onDecision = function(result) {
    updateLoopUI(result);
    updateStatsUI();
    updateHistoryUI();
    updateAfkUI();
    appendAfkLog(result);
  };

  // 状态提供者：从输入框读取
  const stateProvider = function() {
    const input = document.getElementById('stateInput').value.trim();
    try {
      const state = input.split(/[,\\s]+/).map(Number);
      if (state.length === 50 && !state.some(isNaN)) {
        return state;
      }
    } catch(e) {}
    return null;
  };

  simulator.start(interval, stateProvider);

  // 定时刷新 UI
  afkInterval = setInterval(() => {
    if (simulator.running) {
      updateAfkUI();
    }
  }, 2000);

  document.getElementById('btnStartAfk').disabled = true;
  document.getElementById('btnStopAfk').disabled = false;
  document.getElementById('afkStatusBadge').textContent = '挂机中';
  document.getElementById('afkStatusBadge').className = 'badge badge-running';

  // 切换到挂机标签
  switchTab('afkTab');

  // 日志
  const logArea = document.getElementById('afkLogArea');
  logArea.value += '[启动] 挂机模式已启动 (间隔=' + interval + 'ms)\\n';
}

function stopAfkMode() {
  simulator.stop();

  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }

  document.getElementById('btnStartAfk').disabled = false;
  document.getElementById('btnStopAfk').disabled = true;
  document.getElementById('afkStatusBadge').textContent = '已停止';
  document.getElementById('afkStatusBadge').className = 'badge badge-stopped';

  const logArea = document.getElementById('afkLogArea');
  logArea.value += '[停止] 挂机模式已停止，共执行 ' + simulator.stats.totalSteps + ' 步\\n';
}

function updateAfkUI() {
  const summary = simulator.getAfkSummary();
  document.getElementById('afkTotalSteps').textContent = summary.totalSteps;
  document.getElementById('afkTotalTime').textContent = summary.elapsedSeconds.toFixed(1) + 's';
  document.getElementById('afkAvgQ').textContent = summary.avgQValue.toFixed(4);
  document.getElementById('afkActionDist').textContent = summary.actionDistribution || '-';
}

function appendAfkLog(result) {
  const logArea = document.getElementById('afkLogArea');
  const time = new Date();
  const timeStr = time.getHours().toString().padStart(2,'0') + ':' +
                  time.getMinutes().toString().padStart(2,'0') + ':' +
                  time.getSeconds().toString().padStart(2,'0');
  logArea.value += '[' + timeStr + '] 步#' + simulator.stepCount + ' → ' +
                   ACTIONS[result.action] + ' (Q=' + result.bestValue.toFixed(4) + ')\\n';
  logArea.scrollTop = logArea.scrollHeight;
}

function exportAfkLog() {
  const log = simulator.exportLog();
  const blob = new Blob([log], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ai_afk_log_' + new Date().toISOString().slice(0, 19).replace(/[:-]/g, '') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function clearAfkLog() {
  document.getElementById('afkLogArea').value = '';
  simulator.history = [];
  simulator.stepCount = 0;
  simulator.stats.totalSteps = 0;
  simulator.stats.actionsTaken = {};
  ACTIONS.forEach((name, i) => { simulator.stats.actionsTaken[name] = 0; });
  updateAfkUI();
  updateStatsUI();
  updateHistoryUI();
  document.getElementById('loopStepCount').textContent = '0';
  document.getElementById('loopElapsed').textContent = '0s';
  document.getElementById('loopStepsPerMin').textContent = '0';
  document.getElementById('loopLastAction').textContent = '-';
}

// 页面加载时自动使用示例
window.onload = function() {
  setTimeout(useExample, 100);
};
</script>
</body>
</html>`;

    return {
        json: jsonData,
        html,
        filename: `ai_decision_engine_bot${botIndex}.html`,
    };
}

/**
 * 导出为 Python 格式（用于进一步分析和可视化）
 */
function exportPython(modelData) {
    const { network, stats, hyperparams, botIndex } = modelData;
    
    const py = `# -*- coding: utf-8 -*-
"""
艾德尔修仙传 - DQN 模型 (Bot ${botIndex})
========================================
导出时间: ${new Date().toISOString()}
训练集数: ${stats.episodes || 0}
平均奖励: ${formatNumber(stats.avgReward || 0)}
网络结构: ${network.layerSizes.join(' → ')}
"""

import numpy as np

# ==================== 模型权重 ====================

# 网络层大小
LAYER_SIZES = ${JSON.stringify(network.layerSizes)}

# 权重
WEIGHTS = ${JSON.stringify(deepFormatNumbers(network.weights, 8))}

# 偏置
BIASES = ${JSON.stringify(deepFormatNumbers(network.biases, 8))}

# 动作名称
ACTIONS = ${JSON.stringify(ACTIONS)}

# 状态特征名称
STATE_FEATURES = ${JSON.stringify(STATE_FEATURES)}


class DQNModel:
    """DQN 推理模型 (纯 NumPy 实现)"""
    
    def __init__(self, weights=None, biases=None):
        self.weights = weights or [np.array(w) for w in WEIGHTS]
        self.biases = biases or [np.array(b) for b in BIASES]
        # 如果传入的是列表，转换为 numpy 数组
        if isinstance(self.weights[0], list):
            self.weights = [np.array(w) for w in self.weights]
        if isinstance(self.biases[0], list):
            self.biases = [np.array(b) for b in self.biases]
    
    def relu(self, x):
        return np.maximum(0, x)
    
    def predict(self, state):
        """前向传播，返回所有动作的 Q 值"""
        state = np.array(state, dtype=np.float32)
        current = state
        for i, (w, b) in enumerate(zip(self.weights, self.biases)):
            current = np.dot(current, w) + b
            if i < len(self.weights) - 1:
                current = self.relu(current)
        return current
    
    def get_best_action(self, state):
        """获取最佳动作"""
        q_values = self.predict(state)
        best_action = int(np.argmax(q_values))
        return {
            'action': best_action,
            'action_name': ACTIONS[best_action],
            'q_values': q_values.tolist(),
            'best_value': float(q_values[best_action]),
        }
    
    def get_action_probs(self, state, temperature=1.0):
        """使用 Softmax 获取动作概率"""
        q_values = self.predict(state)
        q_values = q_values / temperature
        exp_q = np.exp(q_values - np.max(q_values))
        probs = exp_q / np.sum(exp_q)
        return probs


# ==================== 使用示例 ====================

if __name__ == '__main__':
    # 加载模型
    model = DQNModel()
    
    # 示例状态 (50维)
    example_state = [
        0.125,   # 0:  等级
        0.45,    # 1:  经验百分比
        0.82,    # 2:  HP百分比
        0.65,    # 3:  MP百分比
        0.18,    # 4:  物理攻击
        0.12,    # 5:  物理防御
        0.22,    # 6:  法术攻击
        0.14,    # 7:  法术防御
        0.35,    # 8:  力量
        0.28,    # 9:  体质
        0.20,    # 10: 敏捷
        0.15,    # 11: 真元
        0.05,    # 12: 灵石
        0.50,    # 13: 最大HP
        0.50,    # 14: 最大MP
        0.24,    # 15: 装备数量
        0.40,    # 16: 技能数量
        0.08,    # 17: 药水数量
        0.15,    # 18: 材料数量
        0.05,    # 19: 锻造材料数量
        1,       # 20: 有治疗技能
        1,       # 21: 有攻击技能
        3,       # 22: 已装备技能数
        0.125,   # 23: 地图等级
        0.10,    # 24: 地图ID
        0.60,    # 25: 胜率
        0.15,    # 26: 连胜
        0.05,    # 27: 连败
        1,       # 28: 上局胜利
        0.10,    # 29: 步数进度
        0,       # 30: 不可突破
        0,       # 31: 不在休息
        1,       # 32: 已加入宗门
        0,       # 33: 未加入联盟
        0,       # 34: 无洞府
        0,       # 35: 无传人
        0,       # 36: 无任务
        1,       # 37: 自动战斗
        0.20,    # 38: 境界
        0.10,    # 39: 境界等级
        0.05,    # 40: 宗门贡献
        0.02,    # 41: 试炼币
        0.35,    # 42: 联赛积分
        0,       # 43: 洞府等级
        0,       # 44: 洞府资源
        0.01,    # 45: 命途点数
        0.01,    # 46: 天赋点数
        0,       # 47: 邀请点数
        0,       # 48: 传人试炼积分
        0.10,    # 49: 联赛点数
    ]
    
    # 预测
    result = model.get_best_action(example_state)
    print(f"🤖 推荐动作: {result['action_name']}")
    print(f"   Q 值: {result['best_value']:.4f}")
    print()
    print("所有动作 Q 值:")
    for i, (name, q) in enumerate(zip(ACTIONS, result['q_values'])):
        marker = " ⭐" if i == result['action'] else ""
        print(f"  {i:2d}. {name:10s}  Q={q:+.4f}{marker}")
    
    # 概率分布
    probs = model.get_action_probs(example_state)
    print()
    print("动作概率分布:")
    for i, (name, p) in enumerate(zip(ACTIONS, probs)):
        bar = "█" * int(p * 50)
        print(f"  {i:2d}. {name:10s}  {p*100:5.1f}% {bar}")
`;

    return {
        python: py,
        filename: `dqn_model_bot${botIndex}.py`,
    };
}

// ==================== 完整训练状态导出 ====================

/**
 * 导出完整训练状态（含经验回放缓冲区），可用于继续训练
 * 使用 DQNAgent.saveModel() 的 includeMemory=true 功能
 */
function exportFull(botIndex) {
    const modelPath = path.join(MODEL_DIR, `bot_${botIndex}_model.json`);
    
    if (!fs.existsSync(modelPath)) {
        console.error(`[错误] 模型文件不存在: ${modelPath}`);
        console.error(`请先运行训练: node train.js`);
        return null;
    }

    console.log(`[加载] 从 ${modelPath} 加载模型...`);
    const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    
    // 创建 DQNAgent 实例来加载模型（50维状态，35个动作）
    const agent = new DQNAgent(50, 35);
    agent.loadModel(modelPath);
    
    // 使用增强后的 saveModel 导出完整训练状态（含经验回放缓冲区）
    const exportPath = path.join(EXPORT_DIR, `dqn_full_bot${botIndex}.json`);
    agent.saveModel(exportPath, true);
    
    const memorySize = agent.memory ? agent.memory.size() : 0;
    
    return {
        filePath: exportPath,
        botIndex,
        stats: raw.stats,
        hyperparams: raw.hyperparams,
        network: {
            layerSizes: raw.policyNet.layerSizes,
        },
        memorySize
    };
}

// ==================== 主函数 ====================

function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log(`
用法: node export_model.js <bot_index> [output_format]

参数:
  bot_index     - 机器人索引 (0-9)
  output_format - 导出格式: json | web | python | full (默认: web)
                  full 格式包含完整训练状态（含经验回放缓冲区），
                  可用于继续训练

示例:
  node export_model.js 0          # 导出 Bot 0 为网页格式
  node export_model.js 0 json     # 导出为纯 JSON
  node export_model.js 0 python   # 导出为 Python 格式
  node export_model.js 0 full     # 导出完整训练状态（含经验回放）
  node export_model.js 0 all      # 导出所有格式
`);
        process.exit(0);
    }

    const botIndex = parseInt(args[0]);
    if (isNaN(botIndex) || botIndex < 0 || botIndex > 9) {
        console.error('[错误] bot_index 必须是 0-9 之间的整数');
        process.exit(1);
    }

    const format = (args[1] || 'web').toLowerCase();
    const formats = format === 'all' ? ['json', 'web', 'python', 'full'] : [format];

    // 确保导出目录存在
    ensureDir(EXPORT_DIR);

    // 特殊处理 full 格式（需要单独加载模型，因为要包含经验回放）
    if (formats.length === 1 && formats[0] === 'full') {
        console.log(`\n[导出] Bot ${botIndex} 完整训练状态（含经验回放缓冲区）...`);
        const result = exportFull(botIndex);
        if (!result) {
            process.exit(1);
        }
        console.log(`\n[导出] Bot ${botIndex} 模型信息:`);
        console.log(`  训练集数: ${result.stats.episodes || 0}`);
        console.log(`  平均奖励: ${formatNumber(result.stats.avgReward || 0)}`);
        console.log(`  最高奖励: ${formatNumber(result.stats.maxReward || 0)}`);
        console.log(`  探索率 ε: ${formatNumber(result.stats.epsilon || 0)}`);
        console.log(`  网络结构: ${result.network.layerSizes.join(' → ')}`);
        console.log(`  经验回放: ${result.memorySize} 条经验`);
        console.log(`  导出格式: full`);
        console.log();
        console.log(`  ✅ Full: ${result.filePath}`);
        console.log(`\n[完成] 完整训练状态已导出到 ${EXPORT_DIR}/`);
        console.log(`\n💡 提示: 使用以下命令导入并继续训练:`);
        console.log(`  node import_model.js ${botIndex} ${result.filePath}`);
        return;
    }

    // 加载模型（普通格式）
    const modelData = loadModel(botIndex);
    if (!modelData) {
        process.exit(1);
    }

    console.log(`\n[导出] Bot ${botIndex} 模型信息:`);
    console.log(`  训练集数: ${modelData.stats.episodes || 0}`);
    console.log(`  平均奖励: ${formatNumber(modelData.stats.avgReward || 0)}`);
    console.log(`  最高奖励: ${formatNumber(modelData.stats.maxReward || 0)}`);
    console.log(`  探索率 ε: ${formatNumber(modelData.stats.epsilon || modelData.agent.epsilon)}`);
    console.log(`  网络结构: ${modelData.network.layerSizes.join(' → ')}`);
    console.log(`  导出格式: ${formats.join(', ')}`);
    console.log();

    for (const fmt of formats) {
        switch (fmt) {
            case 'json': {
                const data = exportJson(modelData);
                const filePath = path.join(EXPORT_DIR, `dqn_model_bot${botIndex}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                console.log(`  ✅ JSON: ${filePath}`);
                break;
            }
            case 'web': {
                const data = exportWeb(modelData);
                const filePath = path.join(EXPORT_DIR, data.filename);
                fs.writeFileSync(filePath, data.html);
                console.log(`  ✅ Web: ${filePath}`);
                // 也保存 JSON 数据
                const jsonPath = path.join(EXPORT_DIR, `dqn_model_bot${botIndex}.json`);
                fs.writeFileSync(jsonPath, JSON.stringify(data.json, null, 2));
                console.log(`  ✅ JSON: ${jsonPath}`);
                break;
            }
            case 'python': {
                const data = exportPython(modelData);
                const filePath = path.join(EXPORT_DIR, data.filename);
                fs.writeFileSync(filePath, data.python);
                console.log(`  ✅ Python: ${filePath}`);
                break;
            }
            case 'full': {
                const result = exportFull(botIndex);
                if (result) {
                    console.log(`  ✅ Full: ${result.filePath} (${result.memorySize}条经验)`);
                }
                break;
            }
            default:
                console.error(`[错误] 不支持的格式: ${fmt}`);
        }
    }

    console.log(`\n[完成] 模型已导出到 ${EXPORT_DIR}/`);
    if (formats.includes('full')) {
        console.log(`\n💡 提示: 使用以下命令导入完整训练状态并继续训练:`);
        console.log(`  node import_model.js ${botIndex} ${path.join(EXPORT_DIR, `dqn_full_bot${botIndex}.json`)}`);
    } else {
        console.log(`\n💡 提示: 打开导出的 .html 文件即可在浏览器中测试 AI 决策能力！`);
    }
}

main();