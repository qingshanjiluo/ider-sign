/**
 * 一键炼丹总控脚本 🔄
 *
 * 依次调用三个子脚本：
 *   1. craft_pills.js        — 百艺炼丹（炼制筑基丹）
 *   2. mail_claim_and_use.js — 领取邮件 + 使用筑基丹
 *   3. levelup_breakthrough.js — 升级 + 突破
 *
 * 使用: node run_alchemy_pipeline.js
 * CI模式: set CI=true && node run_alchemy_pipeline.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================================
// CI 检测
// ============================================================
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

function getEnvInt(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// ============================================================
// 日志
// ============================================================
function log(level, tag, msg) {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  const icons = { INFO: 'ℹ', OK: '✓', WARN: '⚠', ERR: '✗' };
  console.log('[' + ts + '] [' + tag + '] ' + (icons[level] || '') + ' ' + msg);
}
function info(tag, msg) { log('INFO', tag, msg); }
function ok(tag, msg) { log('OK', tag, msg); }
function warn(tag, msg) { log('WARN', tag, msg); }
function err(tag, msg) { log('ERR', tag, msg); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// 子脚本执行
// ============================================================
async function runScript(scriptName, label) {
  return new Promise((resolve) => {
    info('🚀', '========== 阶段: ' + label + ' (' + scriptName + ') ==========');

    const child = spawn('node', [scriptName], {
      cwd: __dirname,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        CI: 'true',
        FORCE_COLOR: '1'
      }
    });

    // 如果是交互模式但设了CI，子进程会自动使用CI模式
    // 但为了防止某些版本没有CI检测，我们将stdin关闭
    child.stdin.end();

    child.on('close', (code) => {
      if (code === 0) {
        ok('🚀', '阶段完成: ' + label);
        resolve({ success: true, code: 0 });
      } else {
        warn('🚀', '阶段结束 (code=' + code + '): ' + label + ' — 继续下一阶段');
        resolve({ success: false, code: code });
      }
    });

    child.on('error', (e) => {
      err('🚀', '启动失败 ' + scriptName + ': ' + e.message);
      resolve({ success: false, code: -1, error: e.message });
    });
  });
}

function findAccountFile() {
  const candidates = [
    './alchemy_accounts.txt',
    './accounts.txt'
  ];
  for (const f of candidates) {
    if (fs.existsSync(path.join(__dirname, f))) return f;
  }
  return null;
}

// ============================================================
// Banner
// ============================================================
function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       一键炼丹总控脚本 🔄                           ║');
  console.log('║                                                    ║');
  console.log('║  阶段1: 🧪 百艺炼丹    → craft_pills.js            ║');
  console.log('║  阶段2: 📬 邮件筑基丹  → mail_claim_and_use.js     ║');
  console.log('║  阶段3: ⬆️ 一键升级    → levelup.js                ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  🛡️ 每个脚本独立加载反检测模块                    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  showBanner();

  // 检查账号文件
  const accountFile = findAccountFile();
  if (!accountFile) {
    console.log('❌ 未找到账号文件（alchemy_accounts.txt 或 accounts.txt）');
    console.log('   请先准备账号文件，每行 username,password');
    if (IS_CI) process.exit(1);
    return;
  }
  info('📂', '使用账号文件: ' + accountFile);

  // 检查子脚本是否存在
  const scripts = [
    { name: 'craft_pills.js', label: '🧪 百艺炼丹' },
    { name: 'mail_claim_and_use.js', label: '📬 邮件筑基丹' },
    { name: 'levelup.js', label: '⬆️ 一键升级' }
  ];

  for (const s of scripts) {
    if (!fs.existsSync(path.join(__dirname, s.name))) {
      console.log('❌ 缺少子脚本: ' + s.name);
      if (IS_CI) process.exit(1);
      return;
    }
  }

  if (!IS_CI) {
    console.log('将依次执行以下脚本:');
    scripts.forEach((s, i) => console.log('  ' + (i+1) + '. ' + s.label + ' (' + s.name + ')'));
    console.log('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question('开始执行? (Y/n): ', resolve));
    rl.close();
    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      console.log('已取消');
      process.exit(0);
    }
  }

  // 记录总结果
  const pipelineResult = {
    timestamp: new Date().toISOString(),
    accountFile: accountFile,
    stages: []
  };

  let overallSuccess = true;

  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  阶段 ' + (i+1) + '/' + scripts.length + ': ' + s.label);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    const result = await runScript(s.name, s.label);

    pipelineResult.stages.push({
      script: s.name,
      label: s.label,
      success: result.success,
      exitCode: result.code,
      error: result.error || null
    });

    if (!result.success) {
      overallSuccess = false;
    }

    // 阶段间暂停（反检测）
    if (i < scripts.length - 1) {
      const pauseMs = 5000 + Math.floor(Math.random() * 5000);
      info('⏳', '阶段间暂停 ' + Math.round(pauseMs / 1000) + ' 秒...');
      await sleep(pauseMs);
    }
  }

  // 保存总结果
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = 'pipeline_result_' + ts + '.json';
  try {
    fs.writeFileSync(resultFile, JSON.stringify(pipelineResult, null, 2), 'utf-8');
    info('保存', '总控结果已保存: ' + resultFile);
  } catch (e) {
    warn('保存', '保存失败: ' + e.message);
  }

  // 输出摘要
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        一键炼丹总控 — 执行完成                    ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  for (const stage of pipelineResult.stages) {
    const icon = stage.success ? '✅' : '⚠️ ';
    console.log('║  ' + icon + ' ' + stage.label.padEnd(20) + ' ' + (stage.success ? '成功' : '有异常'));
  }
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  总状态: ' + (overallSuccess ? '✅ 全部成功' : '⚠️ 部分阶段有异常'));
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  process.exit(overallSuccess ? 0 : 1);
}

main().catch(e => {
  console.error('❌ 总控异常:', e.message);
  process.exit(1);
});
