/**
 * DQN 神经网络推理引擎 - 浏览器插件版
 * 用于在浏览器中加载训练好的模型并进行决策
 *
 * 网络结构: 50 → 170 → 85 → 35
 * 输入: 50维状态特征向量
 * 输出: 35个动作的Q值
 */
class DQNInference {
  /**
   * @param {number[][][]} weights - 各层权重矩阵
   * @param {number[][]} biases - 各层偏置向量
   * @param {number[]} layerSizes - 各层神经元数量
   */
  constructor(weights, biases, layerSizes) {
    this.weights = weights;
    this.biases = biases;
    this.layerSizes = layerSizes;
  }

  /** ReLU 激活函数 */
  relu(x) { return x > 0 ? x : 0; }

  /**
   * 前向传播
   * @param {number[]} input - 50维输入状态向量
   * @returns {number[]} 35个动作的Q值
   */
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
        // 最后一层用线性激活（输出Q值），其他层用ReLU
        next[j] = (layer === this.weights.length - 1) ? sum : this.relu(sum);
      }
      current = next;
    }
    return current;
  }

  /**
   * 获取最佳动作
   * @param {number[]} state - 50维状态向量
   * @returns {{ action: number, qValues: number[], bestValue: number }}
   */
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

  /**
   * 获取动作概率分布（使用Softmax）
   * @param {number[]} state - 50维状态向量
   * @param {number} temperature - 温度参数，越低越确定性
   * @returns {{ action: number, probs: number[], actionProbs: {name:string, prob:number}[] }}
   */
  getActionProbs(state, temperature = 1.0) {
    const qValues = this.predict(state);
    const scaled = qValues.map(q => q / temperature);
    const maxQ = Math.max(...scaled);
    const expQ = scaled.map(q => Math.exp(q - maxQ));
    const sumExp = expQ.reduce((a, b) => a + b, 0);
    const probs = expQ.map(e => e / sumExp);

    let bestAction = 0;
    let bestProb = probs[0];
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > bestProb) {
        bestProb = probs[i];
        bestAction = i;
      }
    }

    return {
      action: bestAction,
      probs,
      actionProbs: probs.map((p, i) => ({
        index: i,
        name: ACTIONS[i],
        prob: p
      })).sort((a, b) => b.prob - a.prob)
    };
  }
}

// 35个动作名称（与训练环境 game_environment.js 保持一致）
const ACTIONS = [
  '普通攻击',       // 0
  '使用技能1',      // 1
  '使用技能2',      // 2
  '使用技能3',      // 3
  '治疗',           // 4
  'HP药水',         // 5
  'MP药水',         // 6
  '高级地图',       // 7
  '低级地图',       // 8
  '升级',           // 9
  '突破',           // 10
  '整理装备',       // 11
  '领取邮件',       // 12
  '等待/同步',      // 13
  '自动战斗切换',   // 14
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

// 50维状态特征名称（与 game_environment.js getState() 保持一致）
const STATE_FEATURES = [
  '等级',               // 0
  '经验%',              // 1
  'HP%',                // 2
  'MP%',                // 3
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
  '装备数',             // 15
  '技能数',             // 16
  '药水数',             // 17
  '材料数',             // 18
  '锻造材料',           // 19
  '有治疗技能',         // 20
  '有攻击技能',         // 21
  '已装备技能',         // 22
  '地图等级',           // 23
  '地图ID',             // 24
  '胜率',               // 25
  '连胜',               // 26
  '连败',               // 27
  '上局胜利',           // 28
  '步数进度',           // 29
  '可突破',             // 30
  '休息中',             // 31
  '已加入宗门',         // 32
  '已加入联盟',         // 33
  '有洞府',             // 34
  '有传人',             // 35
  '有任务',             // 36
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

// 导出到全局作用域（供 content script 和 popup 使用）
if (typeof window !== 'undefined') {
  window.DQNInference = DQNInference;
  window.ACTIONS = ACTIONS;
  window.STATE_FEATURES = STATE_FEATURES;
}
