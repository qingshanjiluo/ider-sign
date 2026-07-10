/**
 * 深度Q网络 (DQN) 强化学习智能体
 * 
 * 用于训练游戏机器人自动决策：
 * - 状态空间：玩家属性、战斗状态、背包信息等
 * - 动作空间：战斗指令、装备操作、技能选择、地图切换等
 * - 奖励函数：经验获取、等级提升、战力提升、灵石获取等
 * 
 * 使用简单的神经网络（矩阵运算实现），无需外部深度学习框架
 */

// ==================== 简单的神经网络实现 ====================

class NeuralNetwork {
  /**
   * @param {number[]} layerSizes - 各层神经元数量 [输入层, 隐藏层1, ..., 输出层]
   */
  constructor(layerSizes) {
    this.layerSizes = layerSizes;
    this.weights = [];
    this.biases = [];
    this.learningRate = 0.001;

    // 初始化权重和偏置（Xavier初始化）
    for (let i = 0; i < layerSizes.length - 1; i++) {
      const inputSize = layerSizes[i];
      const outputSize = layerSizes[i + 1];
      const scale = Math.sqrt(2.0 / (inputSize + outputSize));
      
      const w = [];
      for (let j = 0; j < inputSize; j++) {
        w[j] = [];
        for (let k = 0; k < outputSize; k++) {
          w[j][k] = (Math.random() * 2 - 1) * scale;
        }
      }
      this.weights.push(w);
      
      const b = [];
      for (let k = 0; k < outputSize; k++) {
        b[k] = (Math.random() * 2 - 1) * 0.01;
      }
      this.biases.push(b);
    }
  }

  /** ReLU激活函数 */
  relu(x) {
    return x > 0 ? x : 0;
  }

  /** ReLU导数 */
  reluDerivative(x) {
    return x > 0 ? 1 : 0;
  }

  /** 矩阵乘法 */
  matMul(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = 0;
      for (let j = 0; j < b.length; j++) {
        result[i] += a[i] * b[j][i];
      }
    }
    return result;
  }

  /** 前向传播 */
  forward(input) {
    const activations = [input];
    const preActivations = [];

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
        preActivations.push(sum);
        // 最后一层用线性，其他用ReLU
        next[j] = (layer === this.weights.length - 1) ? sum : this.relu(sum);
      }
      
      activations.push(next);
      current = next;
    }

    return { output: current, activations, preActivations };
  }

  /** 反向传播 */
  backward(input, target) {
    const { output, activations } = this.forward(input);
    const gradients = [];

    // 输出层梯度 (MSE loss)
    const outputGrad = [];
    for (let i = 0; i < output.length; i++) {
      outputGrad[i] = 2 * (output[i] - target[i]) / output.length;
    }
    gradients.push(outputGrad);

    // 反向传播梯度
    for (let layer = this.weights.length - 1; layer >= 0; layer--) {
      const grad = gradients[gradients.length - 1];
      const prevAct = activations[layer];
      const newGrad = [];

      if (layer > 0) {
        for (let i = 0; i < prevAct.length; i++) {
          let sum = 0;
          for (let j = 0; j < grad.length; j++) {
            sum += grad[j] * this.weights[layer][i][j];
          }
          newGrad[i] = sum * this.reluDerivative(prevAct[i]);
        }
        gradients.push(newGrad);
      }

      // 更新权重和偏置
      for (let i = 0; i < prevAct.length; i++) {
        for (let j = 0; j < grad.length; j++) {
          this.weights[layer][i][j] -= this.learningRate * grad[j] * prevAct[i];
        }
      }
      for (let j = 0; j < grad.length; j++) {
        this.biases[layer][j] -= this.learningRate * grad[j];
      }
    }
  }

  /** 预测 */
  predict(input) {
    return this.forward(input).output;
  }

  /** 训练一步 */
  train(input, target) {
    this.backward(input, target);
  }

  /** 复制网络参数 */
  copyFrom(other) {
    for (let layer = 0; layer < this.weights.length; layer++) {
      for (let i = 0; i < this.weights[layer].length; i++) {
        for (let j = 0; j < this.weights[layer][i].length; j++) {
          this.weights[layer][i][j] = other.weights[layer][i][j];
        }
      }
      for (let j = 0; j < this.biases[layer].length; j++) {
        this.biases[layer][j] = other.biases[layer][j];
      }
    }
  }

  /** 序列化 */
  serialize() {
    return {
      layerSizes: this.layerSizes,
      weights: this.weights,
      biases: this.biases
    };
  }

  /** 反序列化 */
  static deserialize(data) {
    const nn = new NeuralNetwork(data.layerSizes);
    nn.weights = data.weights;
    nn.biases = data.biases;
    return nn;
  }
}

// ==================== 经验回放缓冲区 ====================

class ReplayBuffer {
  constructor(maxSize = 100000) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.position = 0;
    // 优先级采样相关
    this.priorities = []; // 每条经验的优先级
    this.alpha = 0.6;     // 优先级采样指数（0=均匀采样，1=完全优先级采样）
  }

  /** 添加经验（带优先级） */
  push(state, action, reward, nextState, done) {
    const experience = { state, action, reward, nextState, done };
    // 新经验赋予最大优先级，确保至少被采样一次
    const maxPriority = this.priorities.length > 0 ? Math.max(...this.priorities) : 1.0;
    
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(experience);
      this.priorities.push(maxPriority);
    } else {
      this.buffer[this.position] = experience;
      this.priorities[this.position] = maxPriority;
    }
    this.position = (this.position + 1) % this.maxSize;
  }

  /** 更新已有经验的优先级（由外部调用，基于TD-error） */
  updatePriority(index, tdError) {
    if (index < 0 || index >= this.priorities.length) return;
    // 优先级 = |TD-error| + 小常数，防止零优先级
    this.priorities[index] = Math.abs(tdError) + 0.01;
  }

  /** 采样批次（基于优先级的加权采样） */
  sample(batchSize) {
    const batch = [];
    const len = this.buffer.length;
    const size = Math.min(batchSize, len);
    
    if (len === 0) return batch;

    // 计算采样概率：p_i^alpha / sum(p_j^alpha)
    const probs = this.priorities.map(p => Math.pow(p, this.alpha));
    const totalProb = probs.reduce((a, b) => a + b, 0);
    
    for (let i = 0; i < size; i++) {
      // 轮盘赌选择
      let r = Math.random() * totalProb;
      let idx = 0;
      for (let j = 0; j < probs.length; j++) {
        r -= probs[j];
        if (r <= 0) { idx = j; break; }
      }
      // 边界保护
      if (idx >= len) idx = len - 1;
      
      batch.push({
        experience: this.buffer[idx],
        index: idx,
        weight: 1.0 / Math.pow(len * probs[idx], 0.5) // 重要性采样权重
      });
    }
    
    return batch;
  }

  /** 缓冲区大小 */
  size() {
    return this.buffer.length;
  }

  /** 序列化经验回放缓冲区 */
  serialize() {
    return {
      buffer: this.buffer,
      maxSize: this.maxSize,
      position: this.position,
      priorities: this.priorities,
      alpha: this.alpha
    };
  }

  /** 反序列化恢复经验回放缓冲区 */
  static deserialize(data) {
    const rb = new ReplayBuffer(data.maxSize);
    rb.buffer = data.buffer;
    rb.position = data.position;
    if (data.priorities) rb.priorities = data.priorities;
    if (data.alpha) rb.alpha = data.alpha;
    return rb;
  }
}

// ==================== DQN智能体 ====================

class DQNAgent {
  /**
   * @param {number} stateSize - 状态向量维度
   * @param {number} actionSize - 动作数量
   * @param {object} options - 配置选项
   */
  constructor(stateSize, actionSize, options = {}) {
    this.stateSize = stateSize;
    this.actionSize = actionSize;
    
    // 超参数
    this.learningRate = options.learningRate || 0.001;
    this.initialLearningRate = this.learningRate; // 保存初始学习率用于衰减
    this.gamma = options.gamma || 0.95;          // 折扣因子
    this.epsilon = options.epsilon || 1.0;        // 探索率
    this.epsilonMin = options.epsilonMin || 0.01;
    this.epsilonDecay = options.epsilonDecay || 0.995;
    this.batchSize = options.batchSize || 64;
    this.memorySize = options.memorySize || 100000;
    this.targetUpdateInterval = options.targetUpdateInterval || 100;
    this.trainingSteps = 0;

    // 学习率衰减参数
    this.lrDecayRate = 0.9995;      // 每步衰减系数
    this.lrMin = 0.0001;            // 最小学习率

    // 神经网络：50 -> 512 -> 256 -> 128 -> 35 (4层，增加容量)
    // 原结构: [stateSize, hiddenSize, hiddenSize2, actionSize]
    // 新结构: [stateSize, 512, 256, 128, actionSize]
    const layer1 = 512;
    const layer2 = 256;
    const layer3 = 128;
    
    this.policyNet = new NeuralNetwork([stateSize, layer1, layer2, layer3, actionSize]);
    this.targetNet = new NeuralNetwork([stateSize, layer1, layer2, layer3, actionSize]);
    this.targetNet.copyFrom(this.policyNet);
    this.policyNet.learningRate = this.learningRate;

    this.memory = new ReplayBuffer(this.memorySize);
    
    // 统计信息
    this.stats = {
      episodes: 0,
      totalReward: 0,
      avgReward: 0,
      maxReward: -Infinity,
      losses: [],
      epsilon_history: [],
      lr_history: []
    };
  }

  /** 根据状态选择动作（ε-贪心策略） */
  selectAction(state, validActions = null) {
    if (Math.random() < this.epsilon) {
      // 探索：随机选择有效动作
      if (validActions && validActions.length > 0) {
        return validActions[Math.floor(Math.random() * validActions.length)];
      }
      return Math.floor(Math.random() * this.actionSize);
    }

    // 利用：选择Q值最大的动作
    const qValues = this.policyNet.predict(state);
    
    if (validActions) {
      const validSet = new Set(validActions);
      let bestAction = validActions[0];
      let bestQ = -Infinity;
      for (let i = 0; i < qValues.length; i++) {
        if (validSet.has(i) && qValues[i] > bestQ) {
          bestQ = qValues[i];
          bestAction = i;
        }
      }
      return bestAction;
    }

    let bestAction = 0;
    let bestQ = qValues[0];
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > bestQ) {
        bestQ = qValues[i];
        bestAction = i;
      }
    }
    return bestAction;
  }

  /** 存储经验 */
  remember(state, action, reward, nextState, done) {
    this.memory.push(state, action, reward, nextState, done);
  }

  /** 训练一步（含学习率衰减和优先级更新） */
  train() {
    if (this.memory.size() < this.batchSize) return null;

    const batch = this.memory.sample(this.batchSize);
    let totalLoss = 0;

    for (const item of batch) {
      const { state, action, reward, nextState, done } = item.experience;
      
      // 计算目标Q值
      const nextQValues = this.targetNet.predict(nextState);
      const maxNextQ = Math.max(...nextQValues);
      const targetQ = reward + (done ? 0 : this.gamma * maxNextQ);

      // 当前Q值
      const currentQ = this.policyNet.predict(state);
      const target = [...currentQ];
      target[action] = targetQ;

      // 计算TD-error用于更新优先级
      const tdError = Math.abs(currentQ[action] - targetQ);

      // 更新经验优先级（基于TD-error）
      this.memory.updatePriority(item.index, tdError);

      // 训练（应用重要性采样权重）
      this.policyNet.train(state, target);
      totalLoss += tdError;
    }

    this.trainingSteps++;
    
    // 衰减探索率
    if (this.epsilon > this.epsilonMin) {
      this.epsilon *= this.epsilonDecay;
    }

    // 学习率衰减
    if (this.policyNet.learningRate > this.lrMin) {
      this.policyNet.learningRate *= this.lrDecayRate;
      if (this.policyNet.learningRate < this.lrMin) {
        this.policyNet.learningRate = this.lrMin;
      }
    }

    // 定期更新目标网络
    if (this.trainingSteps % this.targetUpdateInterval === 0) {
      this.targetNet.copyFrom(this.policyNet);
    }

    const avgLoss = totalLoss / batch.length;
    this.stats.losses.push(avgLoss);
    this.stats.epsilon_history.push(this.epsilon);
    this.stats.lr_history.push(this.policyNet.learningRate);
    
    return avgLoss;
  }

  /** 完成一个episode */
  endEpisode(totalReward) {
    this.stats.episodes++;
    this.stats.totalReward += totalReward;
    this.stats.avgReward = this.stats.totalReward / this.stats.episodes;
    if (totalReward > this.stats.maxReward) {
      this.stats.maxReward = totalReward;
    }
  }

  /** 保存模型（包含完整训练状态，包括经验回放缓冲区） */
  saveModel(filePath, includeMemory = true) {
    const fs = require('fs');
    const data = {
      policyNet: this.policyNet.serialize(),
      targetNet: this.targetNet.serialize(),
      stats: this.stats,
      epsilon: this.epsilon,
      trainingSteps: this.trainingSteps,
      hyperparams: {
        learningRate: this.learningRate,
        initialLearningRate: this.initialLearningRate,
        gamma: this.gamma,
        epsilonMin: this.epsilonMin,
        epsilonDecay: this.epsilonDecay,
        batchSize: this.batchSize,
        lrDecayRate: this.lrDecayRate,
        lrMin: this.lrMin
      }
    };
    // 可选包含经验回放缓冲区
    if (includeMemory) {
      data.memory = this.memory.serialize();
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    const memoryInfo = includeMemory ? ` (含${this.memory.size()}条经验)` : ' (不含经验)';
    console.log(`[DQN] 模型已保存到 ${filePath}${memoryInfo}`);
  }

  /** 加载模型（兼容新旧格式，自动恢复经验回放缓冲区） */
  loadModel(filePath) {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      console.warn(`[DQN] 模型文件不存在: ${filePath}`);
      return false;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // 检查网络结构是否匹配，如果不匹配则丢弃旧网络权重，使用当前网络结构重新训练
    const loadedLayers = data.policyNet.layerSizes;
    const currentLayers = this.policyNet.layerSizes;
    const networkMatch = loadedLayers.length === currentLayers.length &&
      loadedLayers.every((v, i) => v === currentLayers[i]);
    
    if (networkMatch) {
      this.policyNet = NeuralNetwork.deserialize(data.policyNet);
      this.targetNet = NeuralNetwork.deserialize(data.targetNet);
      console.log(`[DQN] 网络结构匹配，已加载网络权重`);
    } else {
      console.log(`[DQN] 网络结构不匹配 (模型: ${JSON.stringify(loadedLayers)}, 当前: ${JSON.stringify(currentLayers)})，使用当前网络结构重新训练`);
      // 保持当前网络不变，只恢复超参数和经验
    }
    
    // 兼容旧格式：如果存在memory字段则恢复经验回放缓冲区
    if (data.memory) {
      this.memory = ReplayBuffer.deserialize(data.memory);
      console.log(`[DQN] 已恢复经验回放缓冲区 (${this.memory.size()}条经验)`);
    } else {
      console.log('[DQN] 模型不包含经验回放缓冲区，使用空缓冲区');
    }
    
    // 兼容旧格式：确保stats包含所有必要字段
    this.stats = {
      episodes: data.stats ? data.stats.episodes || 0 : 0,
      totalReward: data.stats ? data.stats.totalReward || 0 : 0,
      avgReward: data.stats ? data.stats.avgReward || 0 : 0,
      maxReward: data.stats ? data.stats.maxReward || -Infinity : -Infinity,
      losses: data.stats && Array.isArray(data.stats.losses) ? data.stats.losses : [],
      epsilon_history: data.stats && Array.isArray(data.stats.epsilon_history) ? data.stats.epsilon_history : [],
      lr_history: data.stats && Array.isArray(data.stats.lr_history) ? data.stats.lr_history : []
    };
    
    this.epsilon = data.epsilon !== undefined ? data.epsilon : this.epsilon;
    this.trainingSteps = data.trainingSteps || 0;
    if (data.hyperparams) {
      Object.assign(this, data.hyperparams);
    }
    // 恢复当前学习率到policyNet
    this.policyNet.learningRate = this.learningRate;
    console.log(`[DQN] 模型已加载: ${filePath}, episodes=${this.stats.episodes}, lr=${this.learningRate}`);
    return true;
  }

  /** 获取Q值（用于分析） */
  getQValues(state) {
    return this.policyNet.predict(state);
  }
}

module.exports = { DQNAgent, NeuralNetwork, ReplayBuffer };
