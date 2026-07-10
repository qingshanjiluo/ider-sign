/**
 * 艾德尔修仙传 - 模型导入继续训练工具
 * ==============================
 * 功能：
 * 1. 加载完整导出的训练状态（含经验回放缓冲区）
 * 2. 恢复到指定机器人的模型目录
 * 3. 可选：立即启动训练
 * 
 * 用法：
 *   node import_model.js <bot_index> <exported_file> [--train]
 *   
 *   参数：
 *     bot_index    - 机器人索引 (0-9)
 *     exported_file - 导出的完整训练状态文件路径
 *     --train      - 可选，导入后立即启动训练
 *   
 *   示例：
 *     node import_model.js 0 ./exported_models/dqn_full_bot0.json
 *     node import_model.js 0 ./exported_models/dqn_full_bot0.json --train
 */

const fs = require('fs');
const path = require('path');
const { DQNAgent } = require('./dqn_agent.js');

// ==================== 配置 ====================

const MODEL_DIR = path.join(__dirname, 'models');

// ==================== 导入模型 ====================

function importModel(botIndex, exportedFilePath) {
    // 检查导出文件是否存在
    if (!fs.existsSync(exportedFilePath)) {
        console.error(`[错误] 导出文件不存在: ${exportedFilePath}`);
        return null;
    }

    console.log(`\n[导入] 从 ${exportedFilePath} 加载完整训练状态...`);
    
    // 读取导出的完整训练状态
    const raw = JSON.parse(fs.readFileSync(exportedFilePath, 'utf8'));
    
    // 验证文件格式
    if (!raw.policyNet || !raw.targetNet) {
        console.error('[错误] 无效的模型文件：缺少 policyNet 或 targetNet');
        return null;
    }

    // 检查是否包含经验回放缓冲区
    const hasMemory = !!raw.memory;
    const memorySize = hasMemory ? (raw.memory.buffer ? raw.memory.buffer.length : 0) : 0;

    console.log(`  网络结构: ${raw.policyNet.layerSizes.join(' → ')}`);
    console.log(`  训练步数: ${raw.trainingSteps || 0}`);
    console.log(`  探索率 ε: ${raw.epsilon || 0}`);
    console.log(`  经验回放: ${hasMemory ? `${memorySize} 条经验` : '无（将使用空缓冲区）'}`);
    
    if (raw.stats) {
        console.log(`  训练集数: ${raw.stats.episodes || 0}`);
        console.log(`  平均奖励: ${raw.stats.avgReward || 0}`);
        console.log(`  最高奖励: ${raw.stats.maxReward || 0}`);
    }

    // 保存到模型目录
    const targetPath = path.join(MODEL_DIR, `bot_${botIndex}_model.json`);
    fs.writeFileSync(targetPath, JSON.stringify(raw, null, 2));
    
    console.log(`\n  ✅ 已保存到: ${targetPath}`);
    
    return {
        targetPath,
        botIndex,
        hasMemory,
        memorySize,
        stats: raw.stats,
        trainingSteps: raw.trainingSteps,
        epsilon: raw.epsilon,
        hyperparams: raw.hyperparams
    };
}

// ==================== 验证导入 ====================

function verifyImport(botIndex) {
    const modelPath = path.join(MODEL_DIR, `bot_${botIndex}_model.json`);
    
    if (!fs.existsSync(modelPath)) {
        console.error(`[错误] 模型文件不存在: ${modelPath}`);
        return false;
    }

    console.log(`\n[验证] 加载并验证导入的模型...`);
    
    try {
        const agent = new DQNAgent(50, 35);
        agent.loadModel(modelPath);
        
        const memorySize = agent.memory ? agent.memory.size() : 0;
        
        console.log(`  ✅ 模型加载成功`);
        console.log(`  ✅ 经验回放缓冲区: ${memorySize} 条经验`);
        console.log(`  ✅ 探索率 ε: ${agent.epsilon}`);
        console.log(`  ✅ 训练步数: ${agent.trainingSteps}`);
        console.log(`  ✅ 网络结构: ${agent.policyNet.layerSizes.join(' → ')}`);
        
        return true;
    } catch (e) {
        console.error(`  ❌ 模型验证失败: ${e.message}`);
        return false;
    }
}

// ==================== 启动训练 ====================

function startTraining(botIndex) {
    const { spawn } = require('child_process');
    const trainScript = path.join(__dirname, `_train_bot_${botIndex}.js`);
    
    if (!fs.existsSync(trainScript)) {
        // 如果没有单独的脚本，使用主训练脚本
        const mainScript = path.join(__dirname, 'train.js');
        console.log(`\n[启动] 开始训练 Bot ${botIndex}...`);
        console.log(`  命令: node ${mainScript} --load`);
        
        const child = spawn('node', [mainScript, '--load'], {
            cwd: __dirname,
            stdio: 'inherit',
            shell: true
        });
        
        child.on('close', (code) => {
            console.log(`\n[训练] Bot ${botIndex} 训练进程退出，退出码: ${code}`);
        });
        
        return child;
    } else {
        console.log(`\n[启动] 开始训练 Bot ${botIndex}...`);
        console.log(`  命令: node ${trainScript}`);
        
        const child = spawn('node', [trainScript], {
            cwd: __dirname,
            stdio: 'inherit',
            shell: true
        });
        
        child.on('close', (code) => {
            console.log(`\n[训练] Bot ${botIndex} 训练进程退出，退出码: ${code}`);
        });
        
        return child;
    }
}

// ==================== 主函数 ====================

function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log(`
用法: node import_model.js <bot_index> <exported_file> [--train]

参数:
  bot_index     - 机器人索引 (0-9)
  exported_file - 导出的完整训练状态文件路径
                  例如: ./exported_models/dqn_full_bot0.json
  --train       - 可选，导入后立即启动训练

示例:
  node import_model.js 0 ./exported_models/dqn_full_bot0.json
  node import_model.js 0 ./exported_models/dqn_full_bot0.json --train
`);
        process.exit(0);
    }

    const botIndex = parseInt(args[0]);
    if (isNaN(botIndex) || botIndex < 0 || botIndex > 9) {
        console.error('[错误] bot_index 必须是 0-9 之间的整数');
        process.exit(1);
    }

    const exportedFile = args[1];
    if (!exportedFile) {
        console.error('[错误] 请指定导出的模型文件路径');
        process.exit(1);
    }

    const shouldTrain = args.includes('--train');

    // 步骤 1: 导入模型
    const result = importModel(botIndex, exportedFile);
    if (!result) {
        process.exit(1);
    }

    // 步骤 2: 验证导入
    const verified = verifyImport(botIndex);
    if (!verified) {
        console.error('\n[错误] 模型验证失败，导入可能不完整');
        process.exit(1);
    }

    console.log(`\n✅ 模型导入成功！Bot ${botIndex} 已准备好继续训练。`);
    console.log(`  模型位置: ${result.targetPath}`);
    console.log(`  经验回放: ${result.memorySize} 条经验`);
    console.log(`  训练步数: ${result.trainingSteps || 0}`);
    console.log(`  探索率 ε: ${result.epsilon || 0}`);

    // 步骤 3: 可选启动训练
    if (shouldTrain) {
        startTraining(botIndex);
    } else {
        console.log(`\n💡 提示: 使用 --train 参数可在导入后自动开始训练`);
        console.log(`  或手动运行: node train.js`);
    }
}

main();
