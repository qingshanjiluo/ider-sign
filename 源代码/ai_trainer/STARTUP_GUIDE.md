# 🚀 艾德尔修仙传 AI 训练系统 - 完整启动教程

## 📋 系统概览

```
艾德尔机器人/
├── 源代码/
│   ├── server/              ← 游戏服务器 (Node.js + SQLite)
│   ├── ai_trainer/          ← AI训练系统 (核心)
│   │   ├── dqn_agent.js     ← DQN强化学习智能体
│   │   ├── game_environment.js ← 游戏环境封装
│   │   ├── game_client.js   ← 游戏API客户端
│   │   ├── train.js         ← 主训练脚本
│   │   ├── export_model.js  ← 模型导出工具
│   │   ├── models/          ← 训练好的模型文件
│   │   └── exported_models/ ← 导出的可部署模型
│   ├── ai_trainer_visual/   ← 可视化训练系统 (Python + Flask)
│   │   ├── visualizer.py    ← Web服务器
│   │   ├── train_manager.py ← 训练管理器
│   │   ├── templates/       ← 前端页面
│   │   └── static/          ← 前端资源
│   └── web-client/          ← 网页版游戏客户端
└── README.md
```

---

## 🎯 方式一：可视化训练（推荐）

一键启动带 Web 界面的可视化训练系统。

### 步骤 1：启动可视化系统

```bash
cd 源代码\ai_trainer_visual
python visualizer.py
```

访问 http://localhost:5000 打开控制面板。

> **💡 端口配置**：如果 5000 端口被占用，系统会自动检测并询问如何处理：
> ```
> ⚠️  端口 5000 已被占用！
>    占用进程: PID=12345, python.exe
>    请选择操作:
>      1) 关闭占用进程并重启 (推荐)
>      2) 使用其他端口
>      3) 退出
> ```
>
> 也可以直接指定端口或强制占用：
> ```bash
> python visualizer.py --port 8080        # 使用 8080 端口
> python visualizer.py --port 5000 --force  # 自动关闭占用进程
> ```

### 步骤 2：启动游戏服务器

在 Web 界面点击 **「启动服务器」** 按钮，或通过 API：

```bash
curl -X POST http://localhost:5000/api/server/start
```

等待状态变为 `running`（约 10-15 秒）。

### 步骤 3：开始训练

在 Web 界面：
1. 设置 **AI数量** (1-10)
2. 设置 **训练轮数**
3. 点击 **「开始训练」**

或通过 API：

```bash
curl -X POST http://localhost:5000/api/train/start ^
  -H "Content-Type: application/json" ^
  -d "{\"num_bots\":2,\"episodes\":100,\"max_episodes\":1000}"
```

### 步骤 4：实时监控

- 📊 **实时数据**：每个AI的步数、等级、奖励、Q值
- 🎮 **速度控制**：拖动滑块调节 0.1x ~ 10x
- ⏸️ **暂停/继续**：随时暂停训练
- 📈 **Q值可视化**：查看AI的决策依据

### 步骤 5：停止训练

```bash
curl -X POST http://localhost:5000/api/train/stop
```

训练结束后模型自动保存到 `源代码/ai_trainer/models/`。

### 步骤 6：导出模型

```bash
cd 源代码\ai_trainer
node export_model.js 0 all
```

输出文件位于 `源代码/ai_trainer/exported_models/`。

---

## 🖥️ 方式二：命令行训练

适合服务器环境或无 GUI 场景。

### 步骤 1：启动游戏服务器

```bash
cd 源代码\server
set SETTLEMENT_LOCK_REDIS_ENABLED=0
set REDIS_URL=
node index.js
```

等待输出 `[服务端] 启动于 http://0.0.0.0:3000`。

### 步骤 2：运行训练

```bash
cd 源代码\ai_trainer
node train.js
```

可选参数：
```bash
node train.js --load       # 加载已有模型继续训练
node train.js --episodes 500  # 指定训练轮数
```

### 步骤 3：导出模型

```bash
node export_model.js 0 all
```

---

## 🌐 方式三：网页版游戏 + AI 集成

### 启动网页版游戏

```bash
cd 源代码\server
node index.js
```

访问 http://localhost:3000 即可游玩。

### 集成 AI 模型到网页版

**方法 A：使用导出的 HTML 测试页**

直接双击打开 `源代码/ai_trainer/exported_models/ai_decision_engine_bot0.html`，在浏览器中测试 AI 决策。

**方法 B：嵌入到游戏客户端**

将 `dqn_model_bot0.json` 中的权重数据嵌入到 `web-client/index.html`：

```javascript
// 在游戏客户端中添加 AI 推理引擎
class DQNInference {
    constructor(weights, biases, layerSizes) {
        this.weights = weights;
        this.biases = biases;
        this.layerSizes = layerSizes;
    }
    relu(x) { return x > 0 ? x : 0; }
    predict(input) {
        let current = input;
        for (let layer = 0; layer < this.weights.length; layer++) {
            const w = this.weights[layer];
            const b = this.biases[layer];
            const next = new Array(w[0].length).fill(0);
            for (let j = 0; j < next.length; j++) {
                let sum = b[j];
                for (let i = 0; i < current.length; i++) {
                    sum += current[i] * w[i][j];
                }
                next[j] = (layer === this.weights.length - 1) ? sum : this.relu(sum);
            }
            current = next;
        }
        return current;
    }
    getBestAction(state) {
        const qValues = this.predict(state);
        let bestIdx = 0;
        for (let i = 1; i < qValues.length; i++) {
            if (qValues[i] > qValues[bestIdx]) bestIdx = i;
        }
        return { action: bestIdx, qValues };
    }
}

// 加载模型权重
const MODEL_WEIGHTS = /* 从 dqn_model_bot0.json 复制 weights */;
const MODEL_BIASES = /* 从 dqn_model_bot0.json 复制 biases */;
const LAYER_SIZES = [30, 128, 15];
const dqn = new DQNInference(MODEL_WEIGHTS, MODEL_BIASES, LAYER_SIZES);

// 使用 AI 决策
const state = getGameState(); // 获取30维游戏状态
const decision = dqn.getBestAction(state);
executeAction(decision.action); // 执行AI选择的动作
```

**方法 C：Python 服务端集成**

```python
from dqn_model_bot0 import DQNModel

model = DQNModel()
state = [1.0, 0.5, 0.8, ...]  # 30维状态向量
result = model.get_best_action(state)
print(f"AI选择: {result['action_name']}")
```

---

## ⚙️ 常用 API 速查

| 操作 | API 端点 | 方法 |
|------|----------|------|
| 查看状态 | `GET /api/status` | - |
| 启动服务器 | `POST /api/server/start` | `{}` |
| 停止服务器 | `POST /api/server/stop` | `{}` |
| 开始训练 | `POST /api/train/start` | `{"num_bots":2,"episodes":100}` |
| 停止训练 | `POST /api/train/stop` | `{}` |
| 暂停训练 | `POST /api/train/pause` | `{}` |
| 恢复训练 | `POST /api/train/resume` | `{}` |
| 设置速度 | `POST /api/speed` | `{"speed":5}` |
| 设置AI数量 | `POST /api/bots/count` | `{"count":4}` |
| 导出模型 | `node export_model.js <idx> <format>` | `0 all` |

---

## 🔧 常见问题

### Q: 启动 visualizer.py 后访问 http://localhost:5000 显示 502 错误？
**原因**：eventlet 库在 Windows 上存在兼容性问题，导致 Flask-SocketIO 卡死。

**解决方案**：已自动修复。系统会自动检测 Windows 环境并切换到 `threading` 模式，无需手动操作。如果仍有问题，请确保已安装必要依赖：
```bash
pip install flask flask-socketio
```

### Q: 端口被占用？
```bash
# 查看端口占用
netstat -ano | findstr :3000
netstat -ano | findstr :5000

# 强制释放
taskkill /F /IM node.exe
```

或者使用 visualizer.py 的自动端口冲突解决功能：
```bash
python visualizer.py --port 8080        # 换端口
python visualizer.py --port 5000 --force  # 自动关闭占用进程
```

### Q: 模型没有保存？
训练需要完成至少 1 个 episode 才会自动保存。确保训练自然结束，不要强制终止进程。

### Q: 如何继续训练已有模型？
```bash
node train.js --load
# 或通过可视化界面重新开始训练（自动加载已有模型）
```

### Q: 导出的 HTML 无法打开？
直接用 Chrome/Edge 浏览器双击打开 `ai_decision_engine_bot0.html` 即可，无需任何服务器。

### Q: 如何安装 Python 依赖？
```bash
pip install flask flask-socketio eventlet
```
注意：Windows 下 eventlet 仅用于非 Windows 环境加速，Windows 会自动使用 threading 模式。

---

## 🎮 本地启动游戏游玩指南

### 方式 A：网页版游戏（推荐）

```bash
cd 源代码\server
node index.js
```

打开浏览器访问 **http://localhost:3000**，即可进入游戏。

**游戏操作流程：**
1. **注册账号** — 输入用户名和密码，点击注册
2. **创建角色** — 选择灵根（金/木/水/火/土），进入游戏
3. **开始修仙** — 从新手村开始，打怪升级、收集装备
4. **核心玩法**：
   - ⚔️ **战斗** — 选择地图自动战斗，获取经验和掉落
   - 📦 **背包** — 管理物品、使用丹药、出售垃圾
   - 🛡️ **装备** — 穿戴武器/防具/饰品，提升战力
   - 🔮 **技能** — 学习和装备技能，提升战斗效率
   - 🔨 **锻造** — 打造和强化装备，洗练属性
   - 🏠 **洞府** — 升级洞府、布置阵法、招收传人
   - 🏛️ **宗门** — 加入宗门、完成任务、学习功法
   - 🤝 **联盟** — 加入联盟、参与活动、获取资源
   - 🏪 **交易行** — 买卖物品、装备交易
5. **斗法（PVP）** — 达到一定等级后，可在城市中挑战其他玩家

### 方式 B：直接打开静态页面

如果只需要查看游戏界面（无需登录），可以直接双击打开：
```
源代码/web-client/index.html
```

### 方式 C：通过可视化训练系统启动

1. 启动可视化系统：`python visualizer.py`
2. 访问 http://localhost:5000
3. 点击 **「启动服务器」** 按钮
4. 游戏服务器将在端口 3000 启动
5. 打开新标签页访问 http://localhost:3000 即可游玩

---

## 🎯 手动调整奖励权重

在可视化训练界面（http://localhost:5000）的左侧面板中，新增了 **「奖励权重」** 区域，您可以实时调整AI训练时的奖励策略。

### 关键可调权重

| 权重名称 | 默认值 | 说明 |
|---------|-------|------|
| 🏆 **等级突破** (levelUp) | 50 | 角色升级时的奖励 |
| ⚔️ **战力提升** (combatPower) | 20 | 战力增长时的奖励 |
| 🛡️ **装备强化** (equip) | 15 | 装备品质/等级提升的奖励 |
| 💎 **灵石收益** (spiritStone) | 10 | 获得灵石时的奖励 |

### 操作方式

1. **拖动滑块** — 实时调整权重值（范围 -10 ~ 50）
2. **点击 ↺** — 重置为默认值
3. **显示全部** — 点击按钮可展开所有23项权重进行微调

### 权重说明

- **正值越大** → AI越倾向于执行该行为
- **负值** → AI会尽量避免该行为
- **步数惩罚** (stepPenalty) 默认为 -0.5，让AI追求高效升级路径
- **无效动作** (invalidAction) 默认为 -5，惩罚AI尝试不可用的操作

### 通过API调整

```bash
# 获取当前权重
curl http://localhost:5000/api/reward-weights

# 设置单个权重
curl -X POST http://localhost:5000/api/reward-weights ^
  -H "Content-Type: application/json" ^
  -d "{\"levelUp\": 80, \"spiritStone\": 20}"
```

---

## 🏆 NPC战力排名系统

系统内置了 **100个模拟NPC玩家** 的排名数据库，用于斗法（PVP）场景。

### 功能说明

- **自动生成** — 首次启动时自动创建100个NPC，包含随机名称、等级（10-350级）、战力、装备评分、胜率
- **在线状态** — 约30%的NPC会显示为"在线"，模拟真实玩家环境
- **分页查看** — 右侧面板显示NPC排名列表，支持翻页（每页20人）
- **斗法匹配** — AI训练时会根据排名匹配对手进行斗法

### NPC数据字段

| 字段 | 说明 |
|------|------|
| 名称 | 随机生成的中文修仙名 |
| 等级 | 10 ~ 350 级 |
| 战力 | 1000 ~ 500万 |
| 装备分 | 0 ~ 50000 |
| 胜率 | 30% ~ 90% |
| 状态 | 🟢 在线 / ⚫ 离线 |

### NPC账号

系统预置了10个NPC账号用于训练时的多人交互：
- `npc_sword_01` ~ `npc_sword_02`（剑修）
- `npc_blade_01` ~ `npc_blade_02`（刀修）
- `npc_fist_01` ~ `npc_fist_02`（拳修）
- `npc_magic_01` ~ `npc_magic_02`（法修）
- `npc_heal_01` ~ `npc_heal_02`（医修）

这些NPC会在训练时作为"其他在线用户"出现，让AI体验多人游戏的社交环境。

---

## 🔧 端口冲突自动修复

系统现在会自动检测并解决端口冲突：

1. **启动时检测** — 自动检查端口 3000（游戏服务器）是否被占用
2. **自动释放** — 如果发现占用进程，自动终止并重启
3. **无需手动操作** — 一键启动，系统自动处理

如果仍然遇到问题：
```bash
# 手动查看端口占用
netstat -ano | findstr :3000

# 手动释放
taskkill /F /PID <进程ID>
```
