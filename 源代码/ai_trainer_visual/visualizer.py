"""
艾德尔修仙传 AI 可视化训练系统 - Web 服务器
===========================================
提供 WebSocket 实时通信和 Web 可视化界面

用法:
  python visualizer.py                    # 默认端口 5000
  python visualizer.py --port 8080        # 指定端口
  python visualizer.py --port 5000 --force  # 强制占用端口（自动关闭旧进程）
"""

import os
import sys
import json
import time
import socket
import struct
import threading
import argparse
import subprocess
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from train_manager import TrainingManager

# ==================== 配置 ====================

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__,
    template_folder=str(TEMPLATE_DIR),
    static_folder=str(STATIC_DIR),
    static_url_path="/static"
)
app.config["SECRET_KEY"] = "aider_ai_trainer_secret_2024"
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

# SocketIO 配置
# 自动选择可用的异步模式: eventlet > gevent > threading
# Windows 下 eventlet 有兼容性问题，自动降级到 threading
_async_mode = None
try:
    import eventlet
    # eventlet 0.41+ 在 Windows 上有问题，检查一下
    if os.name == "nt":
        _async_mode = "threading"
    else:
        _async_mode = "eventlet"
except ImportError:
    try:
        import gevent
        _async_mode = "gevent"
    except ImportError:
        _async_mode = "threading"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=_async_mode,
    ping_timeout=60,
    ping_interval=25,
)

# 训练管理器
train_manager = None

# 客户端连接计数
client_count = 0


# ==================== WebSocket 回调 ====================

def ws_callback(event, data):
    """训练管理器 -> WebSocket 转发"""
    try:
        socketio.emit(event, data)
    except Exception as e:
        print(f"[SocketIO Emit Error] {event}: {e}")


# ==================== HTTP 路由 ====================

@app.route("/")
def index():
    """主页面"""
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    """获取训练状态"""
    if train_manager:
        return jsonify(train_manager.get_status())
    return jsonify({"error": "训练管理器未初始化"})


@app.route("/api/bot/<int:bot_index>")
def api_bot(bot_index):
    """获取单个机器人数据"""
    if train_manager:
        data = train_manager.get_bot_data(bot_index)
        if data:
            return jsonify(data)
        return jsonify({"error": "机器人不存在"}), 404
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/server/start", methods=["POST"])
def api_server_start():
    """启动游戏服务器"""
    if train_manager:
        result = train_manager.start_server()
        return jsonify(result)
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/server/stop", methods=["POST"])
def api_server_stop():
    """停止游戏服务器"""
    if train_manager:
        result = train_manager.stop_server()
        return jsonify(result)
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/train/start", methods=["POST"])
def api_train_start():
    """启动训练"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500

    data = request.get_json() or {}
    num_bots = int(data.get("num_bots", 2))
    episodes = int(data.get("episodes", 10))
    max_episodes = int(data.get("max_episodes", 1000))

    result = train_manager.start_training(
        num_bots=num_bots,
        episodes=episodes,
        max_episodes=max_episodes,
    )
    return jsonify(result)


@app.route("/api/train/stop", methods=["POST"])
def api_train_stop():
    """停止训练"""
    if train_manager:
        result = train_manager.stop_training()
        return jsonify(result)
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/train/pause", methods=["POST"])
def api_train_pause():
    """暂停训练"""
    if train_manager:
        result = train_manager.pause_training()
        return jsonify(result)
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/train/resume", methods=["POST"])
def api_train_resume():
    """恢复训练"""
    if train_manager:
        result = train_manager.resume_training()
        return jsonify(result)
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/speed", methods=["POST"])
def api_speed():
    """设置速度"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500

    data = request.get_json() or {}
    multiplier = float(data.get("speed", 1.0))
    result = train_manager.set_speed(multiplier)
    return jsonify(result)


@app.route("/api/bots/count", methods=["POST"])
def api_bots_count():
    """设置AI数量"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500

    data = request.get_json() or {}
    count = int(data.get("count", 2))
    result = train_manager.set_num_bots(count)
    return jsonify(result)


# ==================== 奖励权重 API ====================

@app.route("/api/reward-weights", methods=["GET"])
def api_get_reward_weights():
    """获取当前奖励权重"""
    if train_manager:
        return jsonify(train_manager.get_reward_weights())
    return jsonify({"error": "训练管理器未初始化"}), 500


@app.route("/api/reward-weights", methods=["POST"])
def api_set_reward_weights():
    """设置奖励权重"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    data = request.get_json() or {}
    result = train_manager.set_reward_weights(data)
    return jsonify(result)


# ==================== NPC 排名 API ====================

@app.route("/api/npc-rankings")
def api_npc_rankings():
    """获取NPC战力排名"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 20))
    return jsonify(train_manager.get_npc_rankings(page=page, page_size=page_size))


# ==================== 模型导出/导入 API ====================

@app.route("/api/model/export", methods=["POST"])
def api_model_export():
    """导出模型"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    data = request.get_json() or {}
    bot_index = int(data.get("bot_index", 0))
    fmt = data.get("format", "full")
    result = train_manager.export_model(bot_index, fmt)
    return jsonify(result)


@app.route("/api/model/import", methods=["POST"])
def api_model_import():
    """导入模型"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    data = request.get_json() or {}
    bot_index = int(data.get("bot_index", 0))
    file_path = data.get("file_path")
    result = train_manager.import_model(bot_index, file_path)
    return jsonify(result)


@app.route("/api/models/exported")
def api_list_exported_models():
    """列出已导出的模型文件"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    return jsonify(train_manager.list_exported_models())


@app.route("/api/models/available")
def api_list_available_bots():
    """列出有模型文件的机器人"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    return jsonify(train_manager.list_available_bots())


# ==================== 斗法 API ====================

@app.route("/api/duel/start", methods=["POST"])
def api_duel_start():
    """开始斗法"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    data = request.get_json() or {}
    bot1 = int(data.get("bot1", 0))
    bot2 = int(data.get("bot2", 0))
    episodes = int(data.get("episodes", 5))
    max_steps = int(data.get("max_steps", 100))
    result = train_manager.run_duel(bot1, bot2, episodes, max_steps)
    return jsonify(result)


@app.route("/api/duel/tournament", methods=["POST"])
def api_duel_tournament():
    """开始斗法循环赛"""
    if not train_manager:
        return jsonify({"error": "训练管理器未初始化"}), 500
    data = request.get_json() or {}
    episodes = int(data.get("episodes", 3))
    max_steps = int(data.get("max_steps", 80))
    result = train_manager.run_tournament(episodes, max_steps)
    return jsonify(result)


# ==================== WebSocket 事件 ====================

@socketio.on("connect")
def handle_connect():
    """客户端连接"""
    global client_count
    client_count += 1
    print(f"[WS] 客户端已连接 (总数: {client_count})")
    
    # 发送当前状态
    if train_manager:
        status = train_manager.get_status()
        emit("initial_state", status)


@socketio.on("disconnect")
def handle_disconnect():
    """客户端断开"""
    global client_count
    client_count -= 1
    print(f"[WS] 客户端已断开 (剩余: {client_count})")


@socketio.on("command")
def handle_command(data):
    """接收前端命令"""
    if not data:
        return

    cmd = data.get("command", "")
    params = data.get("params", {})

    print(f"[WS Command] {cmd} {params}")

    if cmd == "start_server":
        result = train_manager.start_server() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "stop_server":
        result = train_manager.stop_server() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "start_training":
        result = train_manager.start_training(
            num_bots=int(params.get("num_bots", 2)),
            episodes=int(params.get("episodes", 10)),
            max_episodes=int(params.get("max_episodes", 1000)),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "stop_training":
        result = train_manager.stop_training() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "pause_training":
        result = train_manager.pause_training() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "resume_training":
        result = train_manager.resume_training() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "set_speed":
        result = train_manager.set_speed(
            float(params.get("speed", 1.0))
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "set_bots_count":
        result = train_manager.set_num_bots(
            int(params.get("count", 2))
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "set_reward_weights":
        result = train_manager.set_reward_weights(
            params.get("weights", {})
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "reset_all_reward_weights":
        result = train_manager.reset_all_reward_weights() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "get_reward_weights":
        result = train_manager.get_reward_weights() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "get_npc_rankings":
        result = train_manager.get_npc_rankings(
            page=int(params.get("page", 1)),
            page_size=int(params.get("page_size", 20)),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    # ===== 模型导出/导入命令 =====
    elif cmd == "export_model":
        result = train_manager.export_model(
            bot_index=int(params.get("bot_index", 0)),
            format=params.get("format", "full"),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "import_model":
        result = train_manager.import_model(
            bot_index=int(params.get("bot_index", 0)),
            file_path=params.get("file_path"),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "list_exported_models":
        result = train_manager.list_exported_models() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "list_available_bots":
        result = train_manager.list_available_bots() if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    # ===== 斗法命令 =====
    elif cmd == "run_duel":
        result = train_manager.run_duel(
            bot1=int(params.get("bot1", 0)),
            bot2=int(params.get("bot2", 0)),
            episodes=int(params.get("episodes", 5)),
            max_steps=int(params.get("max_steps", 100)),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})

    elif cmd == "run_tournament":
        result = train_manager.run_tournament(
            episodes=int(params.get("episodes", 3)),
            max_steps=int(params.get("max_steps", 80)),
        ) if train_manager else {"error": "未初始化"}
        emit("command_result", {"command": cmd, "result": result})


# ==================== 端口工具函数 ====================

def is_port_in_use(port):
    """检测端口是否被占用"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return False
        except OSError:
            return True


def find_process_using_port(port):
    """查找占用指定端口的进程信息（Windows）"""
    try:
        output = subprocess.check_output(
            f'netstat -ano | findstr :{port}',
            shell=True, stderr=subprocess.STDOUT, timeout=5
        ).decode("gbk", errors="replace")
        
        for line in output.splitlines():
            if f":{port}" in line and ("LISTENING" in line or "ESTABLISHED" in line):
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    # 获取进程名
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


def kill_process_by_pid(pid):
    """终止指定 PID 的进程"""
    try:
        subprocess.run(f"taskkill /F /PID {pid}", shell=True, timeout=5,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except:
        return False


def resolve_port(port, force=False):
    """
    解析端口：检测占用并询问是否关闭
    返回最终可用的端口号，或 None 表示用户取消
    """
    if not is_port_in_use(port):
        return port

    proc_info = find_process_using_port(port)
    
    if proc_info:
        print(f"\n⚠️  端口 {port} 已被占用！")
        print(f"   占用进程: PID={proc_info['pid']}, {proc_info['name']}")
        
        if force:
            print(f"   正在强制关闭进程 PID={proc_info['pid']}...")
            if kill_process_by_pid(proc_info['pid']):
                print(f"   ✅ 已关闭占用进程")
                time.sleep(1)
                return port
            else:
                print(f"   ❌ 无法关闭进程，请手动关闭")
                return None
        
        print()
        print(f"   请选择操作:")
        print(f"     1) 关闭占用进程并重启 (推荐)")
        print(f"     2) 使用其他端口")
        print(f"     3) 退出")
        print()
        
        choice = input(f"   请输入选项 (1/2/3): ").strip()
        
        if choice == "1":
            print(f"   正在关闭进程 PID={proc_info['pid']}...")
            if kill_process_by_pid(proc_info['pid']):
                print(f"   ✅ 已关闭占用进程，正在启动...")
                time.sleep(1)
                return port
            else:
                print(f"   ❌ 无法关闭进程，请手动关闭后重试")
                return None
        elif choice == "2":
            alt = input(f"   请输入新端口号 (例如 8080): ").strip()
            try:
                alt_port = int(alt)
                if alt_port < 1 or alt_port > 65535:
                    print(f"   ❌ 端口号无效")
                    return None
                return resolve_port(alt_port, force)
            except ValueError:
                print(f"   ❌ 端口号无效")
                return None
        else:
            print(f"   已退出")
            return None
    else:
        # 端口被占用但找不到进程信息，尝试其他端口
        print(f"\n⚠️  端口 {port} 被占用，但无法识别占用进程")
        alt = input(f"   请输入其他端口号 (例如 8080)，或直接回车退出: ").strip()
        if alt:
            try:
                alt_port = int(alt)
                return resolve_port(alt_port, force)
            except ValueError:
                pass
        return None


# ==================== 启动 ====================

def main():
    global train_manager

    # 解析命令行参数
    parser = argparse.ArgumentParser(description="艾德尔修仙传 AI 可视化训练系统")
    parser.add_argument("--port", type=int, default=None,
                       help="Web 服务器端口 (默认: 5000，也可通过 PORT 环境变量设置)")
    parser.add_argument("--force", action="store_true",
                       help="强制占用端口（自动关闭占用进程，不询问）")
    args = parser.parse_args()

    # 端口优先级: 命令行参数 > 环境变量 > 默认值
    port = args.port or int(os.environ.get("PORT", 5000))
    force = args.force

    print("=" * 60)
    print("  艾德尔修仙传 AI 可视化训练系统")
    print("=" * 60)
    print()

    # 检测并解决端口冲突
    port = resolve_port(port, force=force)
    if port is None:
        print("\n[退出] 端口不可用，系统退出")
        sys.exit(1)

    # 初始化训练管理器
    train_manager = TrainingManager(ws_callback=ws_callback)

    # 启动 Web 服务器
    host = "0.0.0.0"

    print(f"\n[启动] Web 服务器: http://{host}:{port}")
    print(f"[启动] 打开浏览器访问 http://localhost:{port}")
    print(f"[启动] 按 Ctrl+C 停止服务器")
    print()

    try:
        socketio.run(
            app,
            host=host,
            port=port,
            debug=False,
            allow_unsafe_werkzeug=True,
        )
    except KeyboardInterrupt:
        print("\n[关闭] 正在清理...")
    except OSError as e:
        print(f"\n[错误] 无法启动服务器: {e}")
        print(f"[提示] 请尝试使用其他端口: python visualizer.py --port 8080")
        sys.exit(1)
    finally:
        if train_manager:
            print("[关闭] 正在停止训练管理器...")
            train_manager.cleanup()
        print("[关闭] 系统已停止")


if __name__ == "__main__":
    main()
