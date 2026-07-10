# 艾德尔修仙传 AI 机器人训练系统

基于深度强化学习(DQN)的自动游戏机器人，用于训练AI自动游玩"艾德尔修仙传"游戏，目标是提升等级和战力。

## 系统架构

```
ai_trainer/
├── train.js              # 主训练脚本
├── game_client.js        # 游戏API客户端
├── game_environment.js   # 强化学习环境封装
├── dqn_agent.js          # DQN深度强化学习智能体
├── analyze_results.js    # 训练结果分析工具
├── test_env.js           # 环境测试脚本
├── package.json          # 项目配置
├── README.md             # 本文档
├── models/               # 训练好的模型
├── training_data/        # 训练数据
└── logs/                 # 训练日志
```

## 快速开始

### 1. 启动游戏服务器

```bash
cd 源代码/server
npm install
node index.js
```

服务器默认运行在 `http://127.0.0.1:3000`

### 2. 测试环境

```bash
cd 源代码/ai_trainer
node test_env.js
```

### 3. 开始训练

```bash
# 开始新训练
node train.js

# 加载已有模型继续训练
node train.js --load

# 指定训练轮数
node train.js --episodes 100

# 无头模式（不输出详细日志）
set HEADLESS=true && node train.js
```

### 4. 分析结果

```bash
node analyze_results.js
```

## 技术细节

### 强化学习框架

- **算法**: Deep Q-Network (DQN)
- **状态空间**: 30维（等级、经验、生命、法力、攻击、防御、技能、装备等）
- **动作空间**: 15个离散动作（攻击、技能、治疗、药水、地图切换、升级、突破、装备优化等）
- **奖励函数**: 经验获取(+)、等级提升(+++)、战斗胜利(+)、战力提升(+)、战斗失败(-)、无效操作(-)

### 神经网络结构

```
输入层(30) -> 隐藏层1(128) -> 隐藏层2(64) -> 输出层(15)
```

- 激活函数: ReLU (隐藏层), Linear (输出层)
- 优化器: SGD with backpropagation
- 经验回放: 优先级采样
- 目标网络: 软更新

### 训练策略

1. **多机器人并行训练**: 同时训练多个账号，共享学习经验
2. **ε-贪心探索**: 初始100%探索，逐步降低到1%
3. **优先级经验回放**: 高奖励经验被更频繁地学习
4. **定期评估**: 每50个episode评估模型性能
5. **自动断点续训**: 自动保存和加载模型

## 自定义配置

编辑 `train.js` 中的 `CONFIG` 对象：

```javascript
const CONFIG = {
  accounts: [
    { username: 'ai_bot_01', password: 'bot123456', name: 'AI修仙者·壹' },
    // ... 添加更多账号
  ],
  dqn: {
    learningRate: 0.001,
    gamma: 0.95,
    epsilon: 1.0,
    epsilonDecay: 0.998,
  },
  training: {
    maxEpisodes: 1000,
    maxStepsPerEpisode: 500,
    parallelBots: 2,
  }
};
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| SERVER_URL | 游戏服务器地址 | http://127.0.0.1:3000 |
| EPISODES | 训练轮数 | 1000 |
| HEADLESS | 无头模式 | false |

## 注意事项

1. 确保游戏服务器已启动且可访问
2. 训练账号会自动注册，无需手动创建
3. 训练过程中会消耗服务器资源，建议在本地环境运行
4. 模型文件保存在 `models/` 目录，可备份和迁移
5. 训练日志保存在 `logs/` 目录，用于后续分析
