"""
艾德尔修仙传 AI 可视化训练管理器
=================================
功能：
1. 启动/管理 Node.js 游戏服务器（含端口冲突自动检测与释放）
2. 启动/管理多个 Node.js 训练进程 (1-10个AI)
3. 实时收集训练数据并通过 WebSocket 推送
4. 支持速度控制 (延迟调节)
5. 支持训练/暂停/停止控制
6. 支持奖励权重配置（等级/战力/装备/灵石等）
7. 内置NPC战力排名数据库
"""

import subprocess
import json
import time
import threading
import os
import sys
import re
import queue
import io
import socket
import struct
from datetime import datetime
from pathlib import Path

# 项目路径
# visualizer.py 在 源代码/ai_trainer_visual/ 下，所以 parent.parent = 源代码/
BASE_DIR = Path(__file__).resolve().parent.parent  # 源代码/
SERVER_DIR = BASE_DIR / "server"
TRAINER_DIR = BASE_DIR / "ai_trainer"

# 游戏服务器端口
GAME_SERVER_PORT = 3000

# 账号配置 (最多20个，含NPC模拟用户)
BOT_ACCOUNTS = [
    {"username": "ai_bot_01", "password": "bot123456", "name": "AI修仙者·壹"},
    {"username": "ai_bot_02", "password": "bot123456", "name": "AI修仙者·贰"},
    {"username": "ai_bot_03", "password": "bot123456", "name": "AI修仙者·叁"},
    {"username": "ai_bot_04", "password": "bot123456", "name": "AI修仙者·肆"},
    {"username": "ai_bot_05", "password": "bot123456", "name": "AI修仙者·伍"},
    {"username": "ai_bot_06", "password": "bot123456", "name": "AI修仙者·陆"},
    {"username": "ai_bot_07", "password": "bot123456", "name": "AI修仙者·柒"},
    {"username": "ai_bot_08", "password": "bot123456", "name": "AI修仙者·捌"},
    {"username": "ai_bot_09", "password": "bot123456", "name": "AI修仙者·玖"},
    {"username": "ai_bot_10", "password": "bot123456", "name": "AI修仙者·拾"},
    # NPC模拟用户（用于斗法排名和在线模拟）
    {"username": "npc_sword_01", "password": "npc123456", "name": "散修·剑无极"},
    {"username": "npc_sword_02", "password": "npc123456", "name": "散修·剑无心"},
    {"username": "npc_blade_01", "password": "npc123456", "name": "散修·刀霸天"},
    {"username": "npc_blade_02", "password": "npc123456", "name": "散修·刀无痕"},
    {"username": "npc_fist_01", "password": "npc123456", "name": "散修·拳镇山"},
    {"username": "npc_fist_02", "password": "npc123456", "name": "散修·拳破天"},
    {"username": "npc_magic_01", "password": "npc123456", "name": "散修·法无量"},
    {"username": "npc_magic_02", "password": "npc123456", "name": "散修·法通天"},
    {"username": "npc_heal_01", "password": "npc123456", "name": "散修·药无尘"},
    {"username": "npc_heal_02", "password": "npc123456", "name": "散修·药无垢"},
]

# 默认奖励权重配置
DEFAULT_REWARD_WEIGHTS = {
    "levelUp": 100.0,       # 等级提升
    "expGain": 50.0,        # 经验获取
    "spiritStone": 20.0,    # 灵石获取
    "battleWin": 30.0,      # 战斗胜利
    "battleLoss": -20.0,    # 战斗失败
    "combatPower": 30.0,    # 战力提升
    "crafting": 25.0,       # 制作
    "forging": 30.0,        # 锻造
    "alchemy": 20.0,        # 炼丹
    "collection": 15.0,     # 采集
    "sectTask": 20.0,       # 宗门任务
    "sectLearn": 15.0,      # 宗门学习
    "alliance": 10.0,       # 联盟活动
    "dungeon": 40.0,        # 副本
    "trial": 35.0,          # 试炼
    "discipleCreate": 20.0, # 创建传人
    "discipleRecall": 15.0, # 召回传人
    "exchange": 10.0,       # 交易所
    "equip": 15.0,          # 装备优化
    "skillEquip": 10.0,     # 技能装备
    "techniqueEquip": 15.0, # 功法装备 (新增)
    "mailClaim": 5.0,       # 邮件领取
    "stepPenalty": -0.5,    # 步数惩罚
    "invalidAction": -5.0,  # 无效操作
}

# NPC战力排名数据库路径
NPC_DATA_PATH = Path(__file__).resolve().parent / "npc_rank_data.json"


class TrainingManager:
    """训练管理器 - 管理游戏服务器和多个AI训练进程"""

    def __init__(self, ws_callback=None):
        self.ws_callback = ws_callback  # WebSocket 回调函数
        self.server_process = None
        self.train_processes = {}  # {bot_index: subprocess.Popen}
        self.running = False
        self.paused = False
        self.speed_multiplier = 1.0  # 速度倍率
        self.num_bots = 2  # 当前AI数量
        self.max_episodes = 1000
        self.episodes_per_bot = 10

        # 奖励权重配置（可从UI动态调整）
        self.reward_weights = dict(DEFAULT_REWARD_WEIGHTS)

        # 训练数据收集
        self.training_data = {
            "server": {"status": "stopped", "uptime": 0},
            "bots": {},
            "global": {
                "total_episodes": 0,
                "total_steps": 0,
                "start_time": None,
                "elapsed": 0,
            },
        }

        # 数据锁
        self._lock = threading.Lock()
        # 消息队列
        self._msg_queue = queue.Queue()
        # 事件
        self._stop_event = threading.Event()

        # 加载NPC战力排名数据
        self._load_npc_data()

    def _load_npc_data(self):
        """加载或创建NPC战力排名数据库"""
        try:
            if NPC_DATA_PATH.exists():
                with open(NPC_DATA_PATH, 'r', encoding='utf-8') as f:
                    self.npc_data = json.load(f)
                print(f"[NPC] 已加载 {len(self.npc_data)} 个NPC战力数据")
            else:
                self._generate_default_npc_data()
        except Exception as e:
            print(f"[NPC] 加载失败: {e}，生成默认数据")
            self._generate_default_npc_data()

    def _generate_default_npc_data(self):
        """生成默认NPC战力排名数据（100个模拟玩家）"""
        import random
        random.seed(42)  # 固定种子保证可复现

        first_names = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈',
                       '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '许', '何',
                       '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶']
        last_names = ['无痕', '无心', '破天', '镇岳', '凌云', '御风', '踏雪',
                      '追月', '惊鸿', '游龙', '飞凤', '啸天', '裂地', '焚天',
                      '冰封', '雷霆', '星辰', '皓月', '烈日', '狂风']

        self.npc_data = []
        for i in range(100):
            level = random.randint(10, 350)
            realm = level // 50 + 1
            base_atk = level * random.uniform(1.5, 3.0)
            base_def = level * random.uniform(1.2, 2.8)
            npc = {
                "id": i + 1,
                "name": f"{random.choice(first_names)}{random.choice(last_names)}",
                "level": level,
                "realm": min(realm, 7),
                "realmLevel": random.randint(0, 9),
                "attack": round(base_atk * random.uniform(0.8, 1.2), 1),
                "defense": round(base_def * random.uniform(0.8, 1.2), 1),
                "spellAttack": round(base_atk * random.uniform(0.6, 1.4), 1),
                "spellDefense": round(base_def * random.uniform(0.6, 1.4), 1),
                "hp": round(level * random.uniform(80, 150)),
                "maxHp": round(level * random.uniform(80, 150)),
                "combatPower": round((base_atk + base_def) * 2.5, 0),
                "winRate": round(random.uniform(30, 85), 1),
                "duelRank": i + 1,
                "equipmentScore": round(random.uniform(100, 2000), 0),
                "spiritStones": round(random.uniform(1000, 500000), 0),
                "sectName": random.choice(['', '青云宗', '天剑门', '碧落宫', '万法阁', '星月殿']),
                "isOnline": random.random() < 0.3,
            }
            self.npc_data.append(npc)

        # 按战力排序
        self.npc_data.sort(key=lambda x: x['combatPower'], reverse=True)
        for idx, npc in enumerate(self.npc_data):
            npc['duelRank'] = idx + 1

        # 保存到文件
        try:
            with open(NPC_DATA_PATH, 'w', encoding='utf-8') as f:
                json.dump(self.npc_data, f, ensure_ascii=False, indent=2)
            print(f"[NPC] 已生成 {len(self.npc_data)} 个NPC战力数据 -> {NPC_DATA_PATH}")
        except Exception as e:
            print(f"[NPC] 保存失败: {e}")

    def get_npc_rankings(self, page=1, page_size=20):
        """获取NPC战力排名（分页）"""
        start = (page - 1) * page_size
        end = start + page_size
        return {
            "total": len(self.npc_data),
            "page": page,
            "pageSize": page_size,
            "rankings": self.npc_data[start:end]
        }

    def set_reward_weights(self, weights):
        """设置奖励权重（支持 null 值重置为默认值）"""
        with self._lock:
            for key, value in weights.items():
                if key in self.reward_weights:
                    if value is None:
                        # 重置为默认值
                        self.reward_weights[key] = DEFAULT_REWARD_WEIGHTS.get(key, 0.0)
                    else:
                        try:
                            self.reward_weights[key] = float(value)
                        except (TypeError, ValueError):
                            pass  # 忽略无效值
            self._emit("reward_weights_updated", dict(self.reward_weights))
            return {"ok": True, "weights": dict(self.reward_weights)}

    def reset_all_reward_weights(self):
        """重置所有奖励权重为默认值"""
        with self._lock:
            self.reward_weights = dict(DEFAULT_REWARD_WEIGHTS)
            self._emit("reward_weights_updated", dict(self.reward_weights))
            return {"ok": True, "weights": dict(self.reward_weights)}

    def get_reward_weights(self):
        """获取当前奖励权重"""
        with self._lock:
            return dict(self.reward_weights)

    # ==================== 服务器管理 ====================

    def start_server(self):
        """启动游戏服务器（自动检测端口冲突并释放）"""
        if self.server_process and self.server_process.poll() is None:
            return {"ok": False, "error": "服务器已在运行"}

        try:
            # 检测端口3000是否被占用
            if self._is_port_in_use(GAME_SERVER_PORT):
                proc_info = self._find_process_using_port(GAME_SERVER_PORT)
                if proc_info:
                    print(f"[端口] ⚠️ 端口 {GAME_SERVER_PORT} 被 {proc_info['name']}(PID={proc_info['pid']}) 占用，正在释放...")
                    self._kill_process_by_pid(proc_info['pid'])
                    time.sleep(1)
                    if self._is_port_in_use(GAME_SERVER_PORT):
                        return {"ok": False, "error": f"端口 {GAME_SERVER_PORT} 被占用且无法释放，请手动关闭"}
                    print(f"[端口] ✅ 端口 {GAME_SERVER_PORT} 已释放")
                else:
                    return {"ok": False, "error": f"端口 {GAME_SERVER_PORT} 被未知进程占用，请手动释放"}

            # 使用 subprocess.Popen 直接指定 cwd 和环境变量（避免中文路径问题）
            env = os.environ.copy()
            env["SETTLEMENT_LOCK_REDIS_ENABLED"] = "0"
            env["REDIS_URL"] = ""
            env["PORT"] = str(GAME_SERVER_PORT)

            self.server_process = subprocess.Popen(
                ["node", "index.js"],
                cwd=str(SERVER_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            # 使用 UTF-8 包装 stdout 以处理中文
            if self.server_process.stdout:
                self.server_process.stdout = io.TextIOWrapper(
                    self.server_process.stdout,
                    encoding='utf-8',
                    errors='replace',
                )

            # 启动日志读取线程
            threading.Thread(
                target=self._read_server_log,
                args=(self.server_process,),
                daemon=True,
            ).start()

            # 等待服务器启动
            self._update_server_status("starting")
            return {"ok": True, "message": "服务器启动中..."}

        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _is_port_in_use(self, port):
        """检测端口是否被占用"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return False
            except OSError:
                return True

    def _find_process_using_port(self, port):
        """查找占用指定端口的进程信息（Windows）"""
        try:
            output = subprocess.check_output(
                f'netstat -ano | findstr :{port}',
                shell=True, stderr=subprocess.STDOUT, timeout=5
            ).decode("gbk", errors="replace")
            for line in output.splitlines():
                if f":{port}" in line and ("LISTENING" in line):
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        try:
                            name = subprocess.check_output(
                                f'tasklist /FI "PID eq {pid}" /NH',
                                shell=True, timeout=3
                            ).decode("gbk", errors="replace").strip()
                            name = name.split()[0] if name else "未知"
                        except:
                            name = "未知"
                        return {"pid": pid, "name": name}
        except:
            pass
        return None

    def _kill_process_by_pid(self, pid):
        """终止指定 PID 的进程"""
        try:
            subprocess.run(f"taskkill /F /PID {pid}", shell=True, timeout=5,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except:
            return False

    def stop_server(self):
        """停止游戏服务器"""
        if self.server_process and self.server_process.poll() is None:
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_process.kill()
            self.server_process = None
            self._update_server_status("stopped")
            return {"ok": True, "message": "服务器已停止"}
        return {"ok": False, "error": "服务器未运行"}

    def _read_server_log(self, process):
        """读取服务器日志"""
        server_ready = False
        for line in process.stdout:
            if not line:
                continue
            line = line.strip()
            if not line:
                continue

            # 检测服务器就绪 - 游戏服务器输出 "[服务端] 启动于" 表示就绪
            if "服务端" in line and "启动" in line:
                server_ready = True
                self._update_server_status("running")
            # 也检测 gameLoop started
            if "gameLoop" in line and "started" in line:
                if not server_ready:
                    server_ready = True
                    self._update_server_status("running")

            # 通过 WebSocket 推送日志
            self._emit("server_log", {"line": line, "ready": server_ready})

        # 进程结束
        self._update_server_status("stopped")
        self.server_process = None

    def _update_server_status(self, status):
        with self._lock:
            self.training_data["server"]["status"] = status
            if status == "running":
                self.training_data["server"]["start_time"] = time.time()
            if status == "stopped":
                self.training_data["server"]["start_time"] = None
                self.training_data["server"]["uptime"] = 0

    # ==================== 训练管理 ====================

    def start_training(self, num_bots=2, episodes=10, max_episodes=1000):
        """启动训练"""
        if self.running:
            return {"ok": False, "error": "训练已在运行"}

        self.num_bots = min(max(num_bots, 1), 10)
        self.episodes_per_bot = episodes
        self.max_episodes = max_episodes
        self.running = True
        self.paused = False
        self._stop_event.clear()

        with self._lock:
            self.training_data["global"]["start_time"] = time.time()
            self.training_data["global"]["total_episodes"] = 0
            self.training_data["global"]["total_steps"] = 0

        # 为每个机器人启动训练进程
        for i in range(self.num_bots):
            self._start_bot_training(i)

        self._emit("training_status", {
            "status": "running",
            "num_bots": self.num_bots,
            "message": f"训练已启动 ({self.num_bots}个AI)"
        })

        return {"ok": True, "message": f"训练已启动，{self.num_bots}个AI并行训练"}

    def stop_training(self):
        """停止所有训练"""
        self.running = False
        self._stop_event.set()

        for idx, proc in list(self.train_processes.items()):
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except:
                    proc.kill()

        self.train_processes.clear()
        self._emit("training_status", {"status": "stopped", "message": "训练已停止"})
        return {"ok": True, "message": "训练已停止"}

    def pause_training(self):
        """暂停训练"""
        self.paused = True
        self._emit("training_status", {"status": "paused", "message": "训练已暂停"})
        return {"ok": True, "message": "训练已暂停"}

    def resume_training(self):
        """恢复训练"""
        self.paused = False
        self._emit("training_status", {"status": "running", "message": "训练已恢复"})
        return {"ok": True, "message": "训练已恢复"}

    def set_speed(self, multiplier):
        """设置速度倍率 (0.1 ~ 1000.0)"""
        self.speed_multiplier = max(0.1, min(1000.0, multiplier))
        self._emit("speed_changed", {"speed": self.speed_multiplier})
        return {"ok": True, "speed": self.speed_multiplier}

    def set_num_bots(self, count):
        """设置AI数量 (1-10)"""
        if self.running:
            return {"ok": False, "error": "训练运行时不能修改AI数量"}
        self.num_bots = min(max(count, 1), 10)
        return {"ok": True, "num_bots": self.num_bots}

    def _start_bot_training(self, bot_index):
        """启动单个机器人的训练进程"""
        account = BOT_ACCOUNTS[bot_index % len(BOT_ACCOUNTS)]

        # 创建独立的训练脚本
        script = self._create_bot_script(bot_index, account)

        # 写入临时脚本
        script_path = TRAINER_DIR / f"_train_bot_{bot_index}.js"
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        # 启动 Node.js 进程
        try:
            proc = subprocess.Popen(
                ["node", str(script_path)],
                cwd=str(TRAINER_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            # 使用 UTF-8 包装 stdout
            if proc.stdout:
                proc.stdout = io.TextIOWrapper(
                    proc.stdout,
                    encoding='utf-8',
                    errors='replace',
                )

            self.train_processes[bot_index] = proc

            # 初始化训练数据
            with self._lock:
                self.training_data["bots"][str(bot_index)] = {
                    "index": bot_index,
                    "name": account["name"],
                    "username": account["username"],
                    "status": "starting",
                    "episode": 0,
                    "step": 0,
                    "level": 1,
                    "reward": 0,
                    "avg_reward": 0,
                    "win_rate": 0,
                    "epsilon": 1.0,
                    "loss": 0,
                    "total_reward": 0,
                    "action": "初始化中...",
                    "start_time": time.time(),
                    "elapsed": 0,
                    "memory_size": 0,
                    "q_values": [],
                }

            # 启动日志读取线程
            threading.Thread(
                target=self._read_bot_log,
                args=(proc, bot_index, account["name"]),
                daemon=True,
            ).start()

        except Exception as e:
            self._emit("bot_error", {
                "bot_index": bot_index,
                "error": str(e)
            })

    def _create_bot_script(self, bot_index, account):
        """创建单个机器人的训练脚本（含奖励权重配置）"""
        # 速度控制的延迟：1x=100ms, 10x=10ms, 100x=1ms, 1000x=0ms(无延迟)
        if self.speed_multiplier >= 1000:
            speed_delay = 0
        else:
            speed_delay = max(0, int(100 * (1.0 / max(self.speed_multiplier, 0.1))))

        # 序列化奖励权重为 JSON
        import json as _json
        reward_weights_json = _json.dumps(self.reward_weights)

        return f'''
const GameClient = require('./game_client');
const GameEnvironment = require('./game_environment');
const {{ DQNAgent }} = require('./dqn_agent');

const CONFIG = {{
    serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
    account: {{ username: '{account["username"]}', password: '{account["password"]}', name: '{account["name"]}' }},
    dqn: {{
        learningRate: 0.001,
        gamma: 0.95,
        epsilon: 1.0,
        epsilonMin: 0.01,
        epsilonDecay: 0.998,
        batchSize: 64,
        memorySize: 100000,
        targetUpdateInterval: 100
    }},
    training: {{
        maxEpisodes: {self.episodes_per_bot},
        maxStepsPerEpisode: 1000,
        targetLevel: 400,
    }},
    botIndex: {bot_index},
    speedDelay: {speed_delay},
    // 奖励权重（可从UI动态调整）
    rewardWeights: {reward_weights_json},
}};

// 加载地图数据用于斗法显示
const MAPS_DATA = (function() {{
    try {{
        return require('./data/maps.json');
    }} catch(e) {{
        return [];
    }}
}})();

// 输出 JSON 格式的训练数据
function emit(data) {{
    process.stdout.write(JSON.stringify(data) + '\\n');
}}

async function run() {{
    const client = new GameClient(CONFIG.serverUrl);
    const env = new GameEnvironment(client, {{
        maxStepsPerEpisode: CONFIG.training.maxStepsPerEpisode,
        levelTarget: CONFIG.training.targetLevel,
        rewardWeights: CONFIG.rewardWeights  // 传入奖励权重
    }});

    // 登录/注册
    emit({{ type: 'status', botIndex: CONFIG.botIndex, message: '登录中...' }});
    let loginResult = await client.login(CONFIG.account.username, CONFIG.account.password);
    if (!loginResult.ok) {{
        emit({{ type: 'status', botIndex: CONFIG.botIndex, message: '注册新账号...' }});
        const regResult = await client.register(CONFIG.account.username, CONFIG.account.password);
        if (!regResult.ok) throw new Error('注册失败: ' + regResult.error);
        const createResult = await client.createCharacter(CONFIG.account.name);
        if (!createResult.ok) throw new Error('创建角色失败: ' + createResult.error);
        emit({{ type: 'status', botIndex: CONFIG.botIndex, message: '角色创建成功!' }});
    }}

    await client.sync('heavy');
    await client.getGameData();

    const stateSize = env.getStateSize();
    const actionSize = env.getActionSize();
    const agent = new DQNAgent(stateSize, actionSize, CONFIG.dqn);

    // 加载已有模型
    const fs = require('fs');
    const path = require('path');
    const modelPath = path.join('./models', `bot_${{CONFIG.botIndex}}_model.json`);
    if (fs.existsSync(modelPath)) {{
        agent.loadModel(modelPath);
        emit({{ type: 'status', botIndex: CONFIG.botIndex, message: '加载已有模型' }});
    }}

    emit({{ type: 'ready', botIndex: CONFIG.botIndex, message: '训练就绪' }});

    // 训练循环
    for (let episode = 1; episode <= CONFIG.training.maxEpisodes; episode++) {{
        let state = await env.reset();
        let totalReward = 0;
        let episodeSteps = 0;
        let episodeLoss = 0;
        let lossCount = 0;

        while (true) {{
            // 速度控制
            if (CONFIG.speedDelay > 0) {{
                await new Promise(r => setTimeout(r, CONFIG.speedDelay));
            }}

            const action = agent.selectAction(state);
            
            // 防御性执行 step（防止高速训练时的竞态条件）
            let stepResult;
            try {{
                stepResult = await env.step(action);
            }} catch (stepErr) {{
                emit({{ type: 'status', botIndex: CONFIG.botIndex, message: `step错误: ${{stepErr.message}}` }});
                await new Promise(r => setTimeout(r, 500));
                try {{
                    stepResult = await env.step(action);
                }} catch (retryErr) {{
                    emit({{ type: 'status', botIndex: CONFIG.botIndex, message: `step重试失败: ${{retryErr.message}}，跳过此步` }});
                    continue;
                }}
            }}
            
            if (!stepResult || typeof stepResult.reward !== 'number') {{
                emit({{ type: 'status', botIndex: CONFIG.botIndex, message: 'step返回无效结果，跳过' }});
                continue;
            }}
            
            const {{ state: nextState, reward, done, info }} = stepResult;
            agent.remember(state, action, reward, nextState, done);
            const loss = agent.train();

            state = nextState;
            totalReward += reward;
            episodeSteps++;

            if (loss !== null) {{
                episodeLoss += loss;
                lossCount++;
            }}

            // 每步输出训练数据（包含完整游戏状态用于画面渲染）
            const stats = env.getStats();
            const qValues = agent.getQValues(state);
            const player = client.player || {{}};
            const caveSummary = client.getCaveSummary();
            const sectSummary = client.getSectSummary();
            const allianceSummary = client.getAllianceSummary();
            const discipleSummary = client.getDiscipleSummary();
            const onlineSummary = client.getOnlineSummary();
            emit({{
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
                mapName: (MAPS_DATA.find(m => m.id === (player.current_map_id || 0)) || {{}}).name || '未知',
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
                equipment: player.equipment || {{}},
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
            }});

            if (done) break;
            if (episodeSteps > CONFIG.training.maxStepsPerEpisode * 2) break;
        }}

        agent.endEpisode(totalReward);

        // Episode 完成
        const player = client.player || {{}};
        const caveSummary = client.getCaveSummary();
        const discipleSummary = client.getDiscipleSummary();
        emit({{
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
        }});
    }}

    // 保存模型
    agent.saveModel(modelPath);
    emit({{ type: 'done', botIndex: CONFIG.botIndex, message: '训练完成' }});
}}

run().catch(err => {{
    emit({{ type: 'error', botIndex: CONFIG.botIndex, error: err.message, stack: err.stack }});
}});
'''

    def _read_bot_log(self, process, bot_index, bot_name):
        """读取机器人训练日志"""
        for line in process.stdout:
            if not line:
                continue
            line = line.strip()

            # 尝试解析 JSON
            if line.startswith("{"):
                try:
                    data = json.loads(line)
                    data["botName"] = bot_name
                    self._process_bot_data(data)
                except json.JSONDecodeError:
                    pass
            else:
                # 普通日志行
                self._emit("bot_log", {
                    "bot_index": bot_index,
                    "bot_name": bot_name,
                    "line": line
                })

        # 进程结束
        with self._lock:
            if str(bot_index) in self.training_data["bots"]:
                self.training_data["bots"][str(bot_index)]["status"] = "stopped"

        if bot_index in self.train_processes:
            del self.train_processes[bot_index]

        self._emit("bot_status", {
            "bot_index": bot_index,
            "status": "stopped"
        })

    def _process_bot_data(self, data):
        """处理机器人训练数据"""
        bot_idx = str(data.get("botIndex", 0))
        data_type = data.get("type", "")

        with self._lock:
            if bot_idx not in self.training_data["bots"]:
                return

            bot_data = self.training_data["bots"][bot_idx]

            if data_type == "step":
                bot_data["status"] = "running"
                bot_data["episode"] = data.get("episode", 0)
                bot_data["step"] = data.get("step", 0)
                bot_data["level"] = data.get("level", 1)
                bot_data["reward"] = data.get("reward", 0)
                bot_data["epsilon"] = data.get("epsilon", 1.0)
                bot_data["loss"] = data.get("loss", 0)
                bot_data["avg_loss"] = data.get("avgLoss", 0)
                bot_data["total_reward"] = data.get("totalReward", 0)
                bot_data["win_rate"] = data.get("winRate", 0)
                bot_data["action"] = data.get("action", "")
                bot_data["action_name"] = data.get("actionName", "")
                bot_data["memory_size"] = data.get("memorySize", 0)
                bot_data["q_values"] = data.get("qValues", [])
                # 角色基础属性
                bot_data["hp"] = data.get("hp", 0)
                bot_data["max_hp"] = data.get("maxHp", 0)
                bot_data["mp"] = data.get("mp", 0)
                bot_data["max_mp"] = data.get("maxMp", 0)
                bot_data["exp"] = data.get("exp", 0)
                bot_data["max_exp"] = data.get("maxExp", 0)
                bot_data["spirit_stones"] = data.get("spiritStones", 0)
                bot_data["map_id"] = data.get("mapId", 0)
                bot_data["map_name"] = data.get("mapName", "")
                bot_data["attack"] = data.get("attack", 0)
                bot_data["defense"] = data.get("defense", 0)
                bot_data["spell_attack"] = data.get("spellAttack", 0)
                bot_data["spell_defense"] = data.get("spellDefense", 0)
                bot_data["strength"] = data.get("strength", 0)
                bot_data["constitution"] = data.get("constitution", 0)
                bot_data["agility"] = data.get("agility", 0)
                bot_data["zhenyuan"] = data.get("zhenyuan", 0)
                bot_data["realm"] = data.get("realm", 0)
                bot_data["realm_level"] = data.get("realmLevel", 0)
                # 装备/技能/背包
                bot_data["equipment_count"] = data.get("equipmentCount", 0)
                bot_data["skill_count"] = data.get("skillCount", 0)
                bot_data["inventory_items"] = data.get("inventoryItems", 0)
                # 战斗统计
                bot_data["battle_win_count"] = data.get("battleWinCount", 0)
                bot_data["battle_loss_count"] = data.get("battleLossCount", 0)
                bot_data["consecutive_wins"] = data.get("consecutiveWins", 0)
                bot_data["consecutive_losses"] = data.get("consecutiveLosses", 0)
                # 游戏进度
                bot_data["has_sect"] = data.get("hasSect", False)
                bot_data["has_alliance"] = data.get("hasAlliance", False)
                bot_data["has_cave"] = data.get("hasCave", False)
                bot_data["cave_level"] = data.get("caveLevel", 0)
                bot_data["has_disciple"] = data.get("hasDisciple", False)
                bot_data["has_auto_battle"] = data.get("hasAutoBattle", False)
                bot_data["can_breakthrough"] = data.get("canBreakthrough", False)
                bot_data["is_resting"] = data.get("isResting", False)
                # 宗门/联盟
                bot_data["sect_name"] = data.get("sectName", "")
                bot_data["sect_contribution"] = data.get("sectContribution", 0)
                bot_data["alliance_name"] = data.get("allianceName", "")
                # 洞府/传人
                bot_data["cave_resource"] = data.get("caveResource", 0)
                bot_data["disciple_count"] = data.get("discipleCount", 0)
                # 经济资源
                bot_data["trial_coins"] = data.get("trialCoins", 0)
                bot_data["league_rating"] = data.get("leagueRating", 0)
                bot_data["league_points"] = data.get("leaguePoints", 0)
                bot_data["destiny_points"] = data.get("destinyPoints", 0)
                bot_data["talent_points"] = data.get("talentPoints", 0)
                bot_data["invite_points"] = data.get("invitePoints", 0)
                # 装备详情（用于游戏画面渲染）
                bot_data["equipment"] = data.get("equipment", {})
                bot_data["equipped_skills"] = data.get("equippedSkills", [])
                bot_data["inventory"] = data.get("inventory", [])
                # 战斗状态
                bot_data["battle_active"] = data.get("battleActive", False)
                bot_data["battle_log"] = data.get("battleLog", [])
                # 锻造/炼丹
                bot_data["forging_active"] = data.get("forgingActive", False)
                bot_data["alchemy_active"] = data.get("alchemyActive", False)
                # 洞府阵法/传人试炼
                bot_data["formation_active"] = data.get("formationActive", False)
                bot_data["disciple_battle_active"] = data.get("discipleBattleActive", False)
                bot_data["elapsed"] = time.time() - bot_data.get("start_time", time.time())

                self.training_data["global"]["total_steps"] += 1

                # 转发到 WebSocket
                self._emit("bot_step", bot_data)

            elif data_type == "episode_end":
                bot_data["episode"] = data.get("episode", 0)
                bot_data["status"] = "episode_done"
                bot_data["avg_reward"] = float(data.get("avgReward", 0))
                bot_data["avg_loss"] = data.get("avgLoss", 0)
                bot_data["memory_size"] = data.get("memorySize", 0)
                bot_data["realm"] = data.get("realm", 0)
                bot_data["realm_level"] = data.get("realmLevel", 0)
                bot_data["has_sect"] = data.get("hasSect", False)
                bot_data["has_alliance"] = data.get("hasAlliance", False)
                bot_data["has_cave"] = data.get("hasCave", False)
                bot_data["cave_level"] = data.get("caveLevel", 0)
                bot_data["has_disciple"] = data.get("hasDisciple", False)
                bot_data["spirit_stones"] = data.get("spiritStones", 0)
                bot_data["sect_contribution"] = data.get("sectContribution", 0)
                bot_data["attack"] = data.get("attack", 0)
                bot_data["defense"] = data.get("defense", 0)
                bot_data["hp"] = data.get("hp", 0)
                bot_data["max_hp"] = data.get("maxHp", 0)
                bot_data["elapsed"] = time.time() - bot_data.get("start_time", time.time())

                self.training_data["global"]["total_episodes"] += 1

                self._emit("bot_episode_end", {
                    "bot_index": bot_idx,
                    "bot_name": bot_data["name"],
                    "episode": data.get("episode", 0),
                    "steps": data.get("steps", 0),
                    "total_reward": data.get("totalReward", 0),
                    "level": data.get("level", 0),
                    "realm": data.get("realm", 0),
                    "realm_level": data.get("realmLevel", 0),
                    "win_rate": data.get("winRate", "0.0"),
                    "epsilon": data.get("epsilon", 1.0),
                    "avg_reward": data.get("avgReward", 0),
                    "avg_loss": data.get("avgLoss", 0),
                    "memory_size": data.get("memorySize", 0),
                    "has_sect": data.get("hasSect", False),
                    "has_alliance": data.get("hasAlliance", False),
                    "has_cave": data.get("hasCave", False),
                    "cave_level": data.get("caveLevel", 0),
                    "has_disciple": data.get("hasDisciple", False),
                    "spirit_stones": data.get("spiritStones", 0),
                    "sect_contribution": data.get("sectContribution", 0),
                    "attack": data.get("attack", 0),
                    "defense": data.get("defense", 0),
                    "hp": data.get("hp", 0),
                    "max_hp": data.get("maxHp", 0),
                })

            elif data_type == "ready":
                bot_data["status"] = "ready"
                self._emit("bot_status", {
                    "bot_index": bot_idx,
                    "bot_name": bot_data["name"],
                    "status": "ready"
                })

            elif data_type == "done":
                bot_data["status"] = "completed"
                self._emit("bot_status", {
                    "bot_index": bot_idx,
                    "bot_name": bot_data["name"],
                    "status": "completed"
                })

            elif data_type == "error":
                bot_data["status"] = "error"
                self._emit("bot_error", {
                    "bot_index": bot_idx,
                    "bot_name": bot_data["name"],
                    "error": data.get("error", ""),
                    "stack": data.get("stack", "")
                })

            elif data_type == "status":
                self._emit("bot_status", {
                    "bot_index": bot_idx,
                    "bot_name": bot_data["name"],
                    "status": "info",
                    "message": data.get("message", "")
                })

    # ==================== 数据查询 ====================

    def get_status(self):
        """获取当前状态（含奖励权重和NPC排名概览）"""
        with self._lock:
            # 更新服务器运行时间
            if self.training_data["server"].get("start_time"):
                self.training_data["server"]["uptime"] = time.time() - self.training_data["server"]["start_time"]

            # 更新全局运行时间
            if self.training_data["global"].get("start_time"):
                self.training_data["global"]["elapsed"] = time.time() - self.training_data["global"]["start_time"]

            return {
                "server": dict(self.training_data["server"]),
                "bots": {k: dict(v) for k, v in self.training_data["bots"].items()},
                "global": dict(self.training_data["global"]),
                "running": self.running,
                "paused": self.paused,
                "speed": self.speed_multiplier,
                "num_bots": self.num_bots,
                "reward_weights": dict(self.reward_weights),
                "npc_count": len(self.npc_data) if hasattr(self, 'npc_data') else 0,
            }

    def get_bot_data(self, bot_index):
        """获取单个机器人数据"""
        with self._lock:
            data = self.training_data["bots"].get(str(bot_index))
            return dict(data) if data else None

    # ==================== WebSocket 辅助 ====================

    def _emit(self, event, data):
        """通过 WebSocket 发送事件"""
        if self.ws_callback:
            try:
                self.ws_callback(event, data)
            except Exception as e:
                print(f"[WS Error] {e}")

    # ==================== 模型导出 ====================

    def export_model(self, bot_index, format="full"):
        """导出指定机器人的模型"""
        try:
            script = TRAINER_DIR / "export_model.js"
            if not script.exists():
                return {"ok": False, "error": f"导出脚本不存在: {script}"}

            result = subprocess.run(
                ["node", str(script), str(bot_index), format],
                cwd=str(TRAINER_DIR),
                capture_output=True, text=True, timeout=30
            )

            output = result.stdout.strip()
            if result.returncode != 0:
                return {"ok": False, "error": f"导出失败: {result.stderr.strip()}"}

            # 解析输出，找到导出的文件路径
            lines = output.split("\n")
            export_path = None
            for line in lines:
                if "已导出" in line or "导出" in line:
                    # 提取路径
                    import re
                    match = re.search(r'[\\/][\w\\/.-]+\.\w+', line)
                    if match:
                        export_path = match.group().strip()
                    break

            return {
                "ok": True,
                "message": f"Bot {bot_index} 模型已导出",
                "output": output,
                "export_path": export_path
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "导出超时(30s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_exported_models(self):
        """列出已导出的模型文件"""
        try:
            export_dir = TRAINER_DIR / "exported_models"
            if not export_dir.exists():
                return {"ok": True, "models": []}

            files = []
            for f in sorted(export_dir.iterdir()):
                if f.suffix in (".json", ".py", ".html"):
                    size_kb = f.stat().st_size / 1024
                    files.append({
                        "name": f.name,
                        "path": str(f.relative_to(TRAINER_DIR)),
                        "size_kb": round(size_kb, 1),
                        "modified": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                    })
            return {"ok": True, "models": files}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_available_bots(self):
        """列出有模型文件的机器人"""
        try:
            models_dir = TRAINER_DIR / "models"
            if not models_dir.exists():
                return {"ok": True, "bots": []}

            bots = []
            for f in sorted(models_dir.glob("bot_*_model.json")):
                import re
                match = re.search(r'bot_(\d+)_model\.json', f.name)
                if match:
                    bot_idx = int(match.group(1))
                    size_kb = f.stat().st_size / 1024
                    # 读取模型基本信息
                    try:
                        with open(f, "r", encoding="utf-8") as fh:
                            data = json.load(fh)
                        stats = data.get("stats", {})
                        bots.append({
                            "index": bot_idx,
                            "name": BOT_ACCOUNTS[bot_idx]["name"] if bot_idx < len(BOT_ACCOUNTS) else f"Bot {bot_idx}",
                            "size_kb": round(size_kb, 1),
                            "episodes": stats.get("episodes", 0),
                            "avg_reward": round(stats.get("avgReward", 0), 2),
                            "epsilon": round(data.get("epsilon", 1.0), 4),
                            "training_steps": data.get("trainingSteps", 0),
                            "modified": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                        })
                    except:
                        bots.append({
                            "index": bot_idx,
                            "name": BOT_ACCOUNTS[bot_idx]["name"] if bot_idx < len(BOT_ACCOUNTS) else f"Bot {bot_idx}",
                            "size_kb": round(size_kb, 1),
                            "error": "无法读取"
                        })
            return {"ok": True, "bots": bots}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==================== 模型导入 ====================

    def import_model(self, bot_index, file_path=None):
        """导入模型到指定机器人"""
        try:
            script = TRAINER_DIR / "import_model.js"
            if not script.exists():
                return {"ok": False, "error": f"导入脚本不存在: {script}"}

            # 如果未指定文件路径，使用最新的导出文件
            if not file_path:
                export_dir = TRAINER_DIR / "exported_models"
                if not export_dir.exists():
                    return {"ok": False, "error": "没有可导入的导出文件"}
                json_files = sorted(export_dir.glob("dqn_full_bot*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
                if not json_files:
                    json_files = sorted(export_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
                if not json_files:
                    return {"ok": False, "error": "没有找到可导入的模型文件"}
                file_path = str(json_files[0])
            else:
                # 确保是绝对路径
                file_path = str(TRAINER_DIR / file_path) if not os.path.isabs(file_path) else file_path

            if not os.path.exists(file_path):
                return {"ok": False, "error": f"文件不存在: {file_path}"}

            result = subprocess.run(
                ["node", str(script), str(bot_index), file_path],
                cwd=str(TRAINER_DIR),
                capture_output=True, text=True, timeout=30
            )

            if result.returncode != 0:
                return {"ok": False, "error": f"导入失败: {result.stderr.strip()}"}

            return {
                "ok": True,
                "message": f"模型已导入到 Bot {bot_index}",
                "output": result.stdout.strip()
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "导入超时(30s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==================== 斗法 ====================

    def run_duel(self, bot1, bot2, episodes=5, max_steps=100):
        """运行两个机器人之间的斗法"""
        try:
            script = TRAINER_DIR / "duel.js"
            if not script.exists():
                return {"ok": False, "error": f"斗法脚本不存在: {script}"}

            result = subprocess.run(
                ["node", str(script), str(bot1), str(bot2),
                 "--episodes", str(episodes), "--max-steps", str(max_steps)],
                cwd=str(TRAINER_DIR),
                capture_output=True, text=True, timeout=120
            )

            if result.returncode != 0:
                return {"ok": False, "error": f"斗法失败: {result.stderr.strip()}"}

            return {
                "ok": True,
                "message": f"Bot {bot1} vs Bot {bot2} 斗法完成",
                "output": result.stdout.strip()
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "斗法超时(120s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def run_tournament(self, episodes=3, max_steps=80):
        """运行所有可用机器人的循环赛"""
        try:
            script = TRAINER_DIR / "duel.js"
            if not script.exists():
                return {"ok": False, "error": f"斗法脚本不存在: {script}"}

            result = subprocess.run(
                ["node", str(script), "--tournament",
                 "--episodes", str(episodes), "--max-steps", str(max_steps)],
                cwd=str(TRAINER_DIR),
                capture_output=True, text=True, timeout=300
            )

            if result.returncode != 0:
                return {"ok": False, "error": f"循环赛失败: {result.stderr.strip()}"}

            return {
                "ok": True,
                "message": "斗法循环赛完成",
                "output": result.stdout.strip()
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "循环赛超时(300s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==================== 清理 ====================

    def cleanup(self):
        """清理所有资源"""
        self.stop_training()
        self.stop_server()

        # 删除临时脚本
        for i in range(10):
            script_path = TRAINER_DIR / f"_train_bot_{i}.js"
            if script_path.exists():
                try:
                    script_path.unlink()
                except:
                    pass

    def __del__(self):
        self.cleanup()
