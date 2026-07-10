/**
 * 艾德尔修仙传 AI 插件 - Popup 逻辑
 *
 * 功能：
 * 1. 模型管理（加载、导入、选择）
 * 2. 与 content script 通信获取游戏状态
 * 3. DQN 决策循环
 * 4. 执行动作并记录统计
 * 5. UI 更新（状态面板、动作统计、决策历史、日志）
 */

// ==================== 状态 ====================

let dqn = null;
let loopTimer = null;
let isRunning = false;
let stepCount = 0;
let startTime = null;
let actionCounts = {};
let decisionHistory = [];
let currentTabId = null;
let currentState = null;

// ==================== DOM 引用 ====================

const $ = (id) => document.getElementById(id);
const modelSelect = $('modelSelect');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const refreshBtn = $('refreshBtn');
const statusDot = $('statusDot');
const statusText = $('statusText');
const intervalInput = $('intervalInput');
const logArea = $('logArea');
const actionStats = $('actionStats');
const historyBody = $('historyBody');
const modelInfo = $('modelInfo');
const modelFileInput = $('modelFileInput');

// ==================== 日志 ====================

function addLog(type, message) {
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
  // 限制日志数量
  while (logArea.children.length > 200) {
    logArea.removeChild(logArea.firstChild);
  }
}

// ==================== 标签页切换 ====================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    this.classList.add('active');
    const tabId = this.dataset.tab;
    const contentMap = {
      'actions': 'tabActions',
      'history': 'tabHistory',
      'config': 'tabConfig'
    };
    const content = $(contentMap[tabId]);
    if (content) content.style.display = 'block';
  });
});

// ==================== 模型管理 ====================

/**
 * 从 chrome.storage.local 加载已保存的模型列表
 */
async function loadModels() {
  try {
    const result = await chrome.storage.local.get(['models']);
    const models = result.models || [];

    modelSelect.innerHTML = '<option value="">-- 请选择模型 --</option>';
    models.forEach((model, i) => {
      const opt = document.createElement('option');
      opt.value = model.name || `model_${i}`;
      opt.dataset.index = i;
      opt.textContent = `${model.name || `模型 #${i + 1}`} (${model.layerSizes ? model.layerSizes.join('→') : '?'})`;
      modelSelect.appendChild(opt);
    });

    if (models.length > 0) {
      addLog('info', `已加载 ${models.length} 个模型`);
      // 自动选择第一个
      modelSelect.selectedIndex = 1;
      modelSelect.dispatchEvent(new Event('change'));
    } else {
      addLog('warn', '没有找到模型，请导入模型文件');
    }
  } catch (e) {
    addLog('error', '加载模型列表失败: ' + e.message);
  }
}

/**
 * 加载指定名称的模型
 */
async function loadModel(name) {
  try {
    const result = await chrome.storage.local.get(['models']);
    const models = result.models || [];

    // 按名称或索引查找
    let modelData = models.find(m => m.name === name);
    if (!modelData) {
      const idx = parseInt(name);
      if (!isNaN(idx) && idx >= 0 && idx < models.length) {
        modelData = models[idx];
      }
    }

    if (!modelData) {
      addLog('error', `模型 "${name}" 未找到`);
      return false;
    }

    // 验证模型数据结构
    if (!modelData.weights || !modelData.biases || !modelData.layerSizes) {
      addLog('error', '模型数据不完整，缺少 weights/biases/layerSizes');
      return false;
    }

    dqn = new DQNInference(
      modelData.weights,
      modelData.biases,
      modelData.layerSizes
    );

    // 更新模型信息
    const stats = modelData.training || {};
    modelInfo.innerHTML = `
      <strong>模型:</strong> ${modelData.name || '未命名'}<br>
      <strong>网络:</strong> ${modelData.layerSizes.join(' → ')}<br>
      <strong>训练集数:</strong> ${stats.episodes || '?'}<br>
      <strong>平均奖励:</strong> ${stats.avgReward !== undefined ? stats.avgReward.toFixed(2) : '?'}<br>
      <strong>最高奖励:</strong> ${stats.maxReward !== undefined ? stats.maxReward.toFixed(2) : '?'}
    `;

    addLog('info', `✅ 模型 "${modelData.name || name}" 加载成功 (${modelData.layerSizes.join('→')})`);
    startBtn.disabled = false;
    return true;
  } catch (e) {
    addLog('error', '加载模型失败: ' + e.message);
    return false;
  }
}

/**
 * 导入模型文件（从用户选择的JSON文件）
 */
async function importModel(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // 支持多种模型格式
    let modelData;

    if (data.weights && data.biases) {
      // 格式1: 直接包含 weights/biases/layerSizes
      modelData = {
        name: data.name || data.meta?.name || file.name.replace('.json', ''),
        weights: data.weights,
        biases: data.biases,
        layerSizes: data.layerSizes || data.meta?.layerSizes,
        training: data.training || data.meta || {},
        actions: data.actions,
        stateFeatures: data.stateFeatures,
      };
    } else if (data.network && data.network.weights) {
      // 格式2: 包含 network 对象（export_model.js 的 JSON 格式）
      modelData = {
        name: data.name || data.meta?.name || file.name.replace('.json', ''),
        weights: data.network.weights,
        biases: data.network.biases,
        layerSizes: data.network.layerSizes || data.meta?.layerSizes,
        training: data.training || data.meta || {},
        actions: data.actions,
        stateFeatures: data.stateFeatures,
      };
    } else if (data.policyNet && data.policyNet.weights) {
      // 格式3: 完整训练模型格式（含 policyNet）
      modelData = {
        name: data.name || `模型_${data.botIndex || 0}`,
        weights: data.policyNet.weights,
        biases: data.policyNet.biases,
        layerSizes: data.policyNet.layerSizes,
        training: data.stats || {},
        actions: data.actions,
        stateFeatures: data.stateFeatures,
      };
    } else {
      addLog('error', '无法识别的模型格式');
      return false;
    }

    // 验证
    if (!modelData.weights || !modelData.biases || !modelData.layerSizes) {
      addLog('error', '模型数据不完整');
      return false;
    }

    // 保存到 storage
    const result = await chrome.storage.local.get(['models']);
    const models = result.models || [];
    models.push(modelData);
    await chrome.storage.local.set({ models });

    addLog('info', `✅ 模型 "${modelData.name}" 导入成功`);
    await loadModels();
    return true;
  } catch (e) {
    addLog('error', '导入模型失败: ' + e.message);
    return false;
  }
}

// ==================== 与 Content Script 通信 ====================

/**
 * 获取当前活动标签页
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) {
    currentTabId = tabs[0].id;
    return tabs[0];
  }
  return null;
}

/**
 * 从 content script 获取游戏状态
 */
async function getGameState() {
  try {
    const tab = await getActiveTab();
    if (!tab) {
      addLog('warn', '未找到活动标签页');
      return null;
    }

    // 尝试发送消息到 content script
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' }).catch(() => null);

    if (result && result.state && result.state.length === 50) {
      currentState = result.state;
      return result.state;
    }

    // 如果 content script 未响应，尝试注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      addLog('info', 'Content script 已注入');
    } catch (e) {
      // 可能已经注入过了
    }

    // 等待后重试
    await new Promise(r => setTimeout(r, 300));
    const retry = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' }).catch(() => null);
    if (retry && retry.state) {
      currentState = retry.state;
      return retry.state;
    }

    return null;
  } catch (e) {
    addLog('warn', '获取状态失败: ' + e.message);
    return null;
  }
}

/**
 * 在游戏页面上执行动作
 */
async function executeAction(actionIndex) {
  try {
    const tab = await getActiveTab();
    if (!tab) return false;

    await chrome.tabs.sendMessage(tab.id, {
      type: 'EXECUTE_ACTION',
      actionIndex: actionIndex
    });
    return true;
  } catch (e) {
    addLog('error', '执行动作失败: ' + e.message);
    return false;
  }
}

/**
 * 检查 content script 是否存活
 */
async function pingContentScript() {
  try {
    const tab = await getActiveTab();
    if (!tab) return false;
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    return result && result.pong;
  } catch (e) {
    return false;
  }
}

// ==================== 决策循环 ====================

async function decisionLoop() {
  if (!isRunning || !dqn) return;

  try {
    // 1. 获取游戏状态
    const state = await getGameState();
    if (!state) {
      addLog('warn', '无法获取游戏状态，等待重试...');
      scheduleNext();
      return;
    }

    // 2. DQN 决策
    const result = dqn.getBestAction(state);
    const actionName = ACTIONS[result.action];

    // 3. 记录统计
    stepCount++;
    actionCounts[actionName] = (actionCounts[actionName] || 0) + 1;
    decisionHistory.push({
      step: stepCount,
      action: result.action,
      actionName: actionName,
      qValue: result.bestValue,
      time: new Date().toLocaleTimeString()
    });
    if (decisionHistory.length > 100) decisionHistory.shift();

    // 4. 执行动作
    await executeAction(result.action);

    // 5. 更新UI
    updateStats(state);
    updateActionStatsUI();
    updateHistoryUI();

    // 6. 日志
    addLog('action', `[#${stepCount}] → ${actionName} (Q=${result.bestValue.toFixed(4)})`);

  } catch (e) {
    addLog('error', '决策循环异常: ' + e.message);
  }

  // 安排下一步
  scheduleNext();
}

function scheduleNext() {
  if (!isRunning) return;
  const interval = parseInt(intervalInput.value) || 2000;
  loopTimer = setTimeout(decisionLoop, interval);
}

// ==================== 控制函数 ====================

async function startLoop() {
  if (isRunning) return;
  if (!dqn) {
    addLog('error', '请先选择模型');
    return;
  }

  // 检查页面连接
  const connected = await pingContentScript();
  if (!connected) {
    addLog('warn', '游戏页面未连接，尝试注入...');
    const tab = await getActiveTab();
    if (tab) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        addLog('error', '注入失败: ' + e.message);
        return;
      }
    }
  }

  isRunning = true;
  startTime = Date.now();
  stepCount = 0;
  actionCounts = {};
  decisionHistory = [];

  startBtn.disabled = true;
  stopBtn.disabled = false;
  refreshBtn.disabled = true;
  modelSelect.disabled = true;

  statusDot.className = 'status-dot running';
  statusText.textContent = '运行中';
  statusText.style.color = '#2ecc71';

  addLog('info', `▶️ 挂机开始，间隔=${intervalInput.value}ms`);

  // 启动决策循环
  decisionLoop();
}

function stopLoop() {
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  refreshBtn.disabled = false;
  modelSelect.disabled = false;

  statusDot.className = 'status-dot online';
  statusText.textContent = '已停止';
  statusText.style.color = '#4ecdc4';

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  addLog('info', `⏹ 挂机停止，共执行 ${stepCount} 步，耗时 ${mins}分${secs}秒`);
}

async function refreshState() {
  if (isRunning) return;
  addLog('info', '刷新游戏状态...');
  const state = await getGameState();
  if (state) {
    updateStats(state);
    addLog('info', '状态已刷新');
  } else {
    addLog('warn', '无法获取状态，请确保在游戏页面');
  }
}

// ==================== UI 更新 ====================

function updateStats(state) {
  if (!state) return;

  // 等级
  const level = Math.round(state[0] * 400);
  $('statLevel').textContent = level;

  // 战力（物理攻击）
  const power = (state[4] * 10000).toFixed(0);
  $('statPower').textContent = power;

  // HP
  const hpPct = (state[2] * 100).toFixed(1);
  $('statHp').textContent = hpPct + '%';

  // 灵石
  const stones = (state[12] * 100000).toFixed(0);
  $('statStones').textContent = stones;

  // 步数
  $('statSteps').textContent = stepCount;

  // 运行时间
  if (startTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    $('statTime').textContent = `${mins}:${secs}`;
  }
}

function updateActionStatsUI() {
  const entries = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...entries.map(e => e[1]));

  if (entries.length === 0) {
    actionStats.innerHTML = '<div style="color:#667;font-size:12px;text-align:center;padding:20px">暂无数据</div>';
    return;
  }

  let html = '';
  entries.forEach(([name, count]) => {
    const pct = (count / stepCount * 100).toFixed(1);
    const barWidth = (count / maxCount * 100).toFixed(0);
    html += `
      <div class="action-item">
        <span class="name">${name}</span>
        <div class="bar-wrap"><div class="bar" style="width:${barWidth}%"></div></div>
        <span class="count">${count} (${pct}%)</span>
      </div>`;
  });
  actionStats.innerHTML = html;
}

function updateHistoryUI() {
  const recent = decisionHistory.slice(-20).reverse();

  if (recent.length === 0) {
    historyBody.innerHTML = '<tr><td colspan="4" style="color:#667;text-align:center;padding:10px">暂无历史</td></tr>';
    return;
  }

  let html = '';
  recent.forEach(h => {
    html += `
      <tr>
        <td class="step-num">#${h.step}</td>
        <td class="action-name">${h.actionName}</td>
        <td class="q-val">${h.qValue.toFixed(4)}</td>
        <td class="timestamp">${h.time}</td>
      </tr>`;
  });
  historyBody.innerHTML = html;
}

function updateConnectionStatus(connected) {
  if (isRunning) return; // 运行中状态优先

  if (connected) {
    statusDot.className = 'status-dot online';
    statusText.textContent = '已连接';
    statusText.style.color = '#4ecdc4';
  } else {
    statusDot.className = 'status-dot offline';
    statusText.textContent = '未连接';
    statusText.style.color = '#e74c3c';
  }
}

// ==================== 事件绑定 ====================

// 模型选择变更
modelSelect.addEventListener('change', async function() {
  const value = this.value;
  if (value) {
    await loadModel(value);
  } else {
    dqn = null;
    startBtn.disabled = true;
    modelInfo.innerHTML = '请选择或导入模型';
  }
});

// 导入模型文件
modelFileInput.addEventListener('change', async function() {
  if (this.files && this.files[0]) {
    await importModel(this.files[0]);
    this.value = ''; // 重置
  }
});

// 开始按钮
startBtn.addEventListener('click', startLoop);

// 停止按钮
stopBtn.addEventListener('click', stopLoop);

// 刷新按钮
refreshBtn.addEventListener('click', refreshState);

// ==================== 初始化 ====================

async function init() {
  addLog('info', 'AI 挂机插件 v1.0.0');

  // 加载模型列表
  await loadModels();

  // 检查页面连接状态
  const connected = await pingContentScript();
  updateConnectionStatus(connected);

  if (connected) {
    addLog('info', '✅ 游戏页面已连接');
    // 获取初始状态
    const state = await getGameState();
    if (state) {
      updateStats(state);
      addLog('info', '初始状态已获取');
    }
  } else {
    addLog('warn', '未检测到游戏页面，请在游戏页面打开插件');
  }

  // 定期检查连接状态
  setInterval(async () => {
    if (!isRunning) {
      const connected = await pingContentScript();
      updateConnectionStatus(connected);
    }
  }, 5000);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
