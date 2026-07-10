/**
 * 战斗接口压力测试脚本
 * 
 * 目标：对战斗相关接口进行高频请求测试，寻找可能的漏洞
 * 
 * 测试策略：
 * 1. /battle/poll - GET请求，不经过settlementLock，看是否有并发问题
 * 2. /battle/state/:battleId - GET请求，无频率限制
 * 3. /battle/command - POST请求，测试限流是否能被绕过
 * 4. /battle/start - POST请求，测试并发启动战斗
 * 
 * 使用多个账号同时请求，测试服务器限流机制是否健全
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================
// 配置 - 直接从 crawler.js 复制核心函数，避免模块依赖问题
// ============================================================
const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

function makeSign(method, path, timestamp, bodyStr) {
    const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
    const hmac = crypto.createHmac('sha256', SIGN_KEY);
    hmac.update(data);
    return hmac.digest('hex');
}

async function apiRequest(method, path, token, body) {
    if (token === undefined) token = '';
    if (body === undefined) body = null;
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyStr = body ? JSON.stringify(body) : '';
    const sign = makeSign(method, path, timestamp, bodyStr);

    const headers = {
        'Content-Type': 'application/json',
        'X-Client-Version': CLIENT_VERSION,
        'X-Sign-T': String(timestamp),
        'X-Sign': sign
    };
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

    const url = API_BASE + path;
    const opts = { method: method, headers: headers, timeout: 15000 };
    if (bodyStr) opts.body = bodyStr;

    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return { ok: false, _httpStatus: r.status, error: '非JSON响应: ' + text.slice(0, 200) };
    }
    // 不throw，直接返回原始响应，让调用方判断
    data._httpStatus = r.status;
    return data;
}

async function login(username, password) {
    const body = { username: username, password: password, machine_id: 'stress-test-nodejs' };
    const r = await apiRequest('POST', '/auth/login', '', body);
    if (r.ok && r.token) {
        return r.token;
    }
    throw new Error(r.error || '登录失败');
}

// ============================================================
// 配置
// ============================================================
const CONFIG = {
    durationMs: 60 * 1000,        // 测试持续时间 1分钟
    targetRps: 10000,             // 目标每秒请求数
    
    // 测试账号列表
    accounts: [
        { username: 'zzhx', password: 'Pipi20100817' },
        { username: 'zzhx2', password: 'Pipi20100817' },
        { username: 'zzhx3', password: 'Pipi20100817' },
        { username: 'zzhx4', password: 'Pipi20100817' },
    ],

    // 每个账号的并发数（按端点分配）
    concurrency: {
        'GET /battle/poll': 30,         // GET，不经过settlementLock
        'GET /battle/state/:id': 20,    // GET，无频率限制
        'POST /battle/command': 15,     // POST，有settlementLock
        'POST /battle/start': 10,       // POST，有settlementLock
        'GET /player/sync': 10,         // 对照
        'GET /online/cave/status': 5,   // 热路径
        'POST /exchange/listings': 5,   // POST
        'GET /exchange/quote': 5,       // GET热路径
    }
};

// ============================================================
// 统计
// ============================================================
const stats = {
    totalSent: 0,
    totalSuccess: 0,
    totalErrors: 0,
    totalThrottled: 0,
    startTime: 0,
    endpoints: {},
    errors: {},
    statusCodes: {},
    responseTimes: [],
};

function initEndpointStats(name) {
    if (!stats.endpoints[name]) {
        stats.endpoints[name] = { sent: 0, success: 0, error: 0, throttled: 0, totalTime: 0, minTime: Infinity, maxTime: 0 };
    }
}

function recordResult(endpoint, data, timeMs) {
    stats.totalSent++;
    const e = stats.endpoints[endpoint];
    if (e) e.sent++;
    
    const statusCode = data && data._httpStatus ? data._httpStatus : 0;
    stats.statusCodes[statusCode] = (stats.statusCodes[statusCode] || 0) + 1;
    stats.responseTimes.push(timeMs);

    // 判断是否成功
    const isOk = data && data.ok === true;
    // 判断是否被限流
    const isThrottled = !isOk && data && data.error && (
        data.error.indexOf('频繁') >= 0 ||
        data.error.indexOf('THROTTLED') >= 0 ||
        data.error.indexOf('限') >= 0 ||
        data.error.indexOf('繁忙') >= 0 ||
        data.error.indexOf('稍后') >= 0 ||
        statusCode === 429
    );

    if (isOk) {
        stats.totalSuccess++;
        if (e) { e.success++; e.totalTime += timeMs; if (timeMs < e.minTime) e.minTime = timeMs; if (timeMs > e.maxTime) e.maxTime = timeMs; }
    } else if (isThrottled) {
        stats.totalThrottled++;
        if (e) e.throttled++;
    } else {
        stats.totalErrors++;
        if (e) e.error++;
        const key = (data && data.error ? data.error : 'HTTP_' + statusCode);
        stats.errors[key] = (stats.errors[key] || 0) + 1;
    }
}

// ============================================================
// 测试函数 - 每个函数直接调用 apiRequest，不经过 crawler.js 的模块导出
// ============================================================

async function testBattlePoll(token) {
    const start = Date.now();
    const r = await apiRequest('GET', '/battle/poll?after=0&auto_restart=0', token);
    recordResult('GET /battle/poll', r, Date.now() - start);
}

async function testBattleState(token) {
    const start = Date.now();
    const r = await apiRequest('GET', '/battle/state/0', token);
    recordResult('GET /battle/state/:id', r, Date.now() - start);
}

async function testBattleCommand(token) {
    const start = Date.now();
    const r = await apiRequest('POST', '/battle/command', token, { cmd: 'idle' });
    recordResult('POST /battle/command', r, Date.now() - start);
}

async function testBattleStart(token) {
    const start = Date.now();
    const r = await apiRequest('POST', '/battle/start', token, { map_id: 1 });
    recordResult('POST /battle/start', r, Date.now() - start);
}

async function testPlayerSync(token) {
    const start = Date.now();
    const r = await apiRequest('GET', '/player/sync', token);
    recordResult('GET /player/sync', r, Date.now() - start);
}

async function testCaveStatus(token) {
    const start = Date.now();
    const r = await apiRequest('GET', '/online/cave/status', token);
    recordResult('GET /online/cave/status', r, Date.now() - start);
}

async function testExchangeListings(token) {
    const start = Date.now();
    const r = await apiRequest('POST', '/exchange/listings', token, { page: 1, page_size: 20 });
    recordResult('POST /exchange/listings', r, Date.now() - start);
}

async function testExchangeQuote(token) {
    const start = Date.now();
    const r = await apiRequest('GET', '/exchange/quote?item_id=1', token);
    recordResult('GET /exchange/quote', r, Date.now() - start);
}

// 端点映射
const ENDPOINT_FNS = {
    'GET /battle/poll': testBattlePoll,
    'GET /battle/state/:id': testBattleState,
    'POST /battle/command': testBattleCommand,
    'POST /battle/start': testBattleStart,
    'GET /player/sync': testPlayerSync,
    'GET /online/cave/status': testCaveStatus,
    'POST /exchange/listings': testExchangeListings,
    'GET /exchange/quote': testExchangeQuote,
};

// ============================================================
// 并发执行器
// ============================================================
async function runLoop(endpointName, token, runningRef) {
    const fn = ENDPOINT_FNS[endpointName];
    if (!fn) return;
    while (runningRef.current) {
        try {
            await fn(token);
        } catch (e) {
            // 记录未捕获的异常
            stats.totalSent++;
            stats.totalErrors++;
            const eStats = stats.endpoints[endpointName];
            if (eStats) { eStats.sent++; eStats.error++; }
            stats.errors['UNCAUGHT: ' + e.message] = (stats.errors['UNCAUGHT: ' + e.message] || 0) + 1;
        }
    }
}

// ============================================================
// 打印报告
// ============================================================
function printReport() {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const rps = elapsed > 0 ? (stats.totalSent / elapsed).toFixed(1) : '0';
    
    var output = '\n';
    output += '========================================\n';
    output += '  压 力 测 试 报 告\n';
    output += '========================================\n';
    output += '  测试时长: ' + elapsed.toFixed(1) + ' 秒\n';
    output += '  总请求数: ' + stats.totalSent + '\n';
    output += '  成功:     ' + stats.totalSuccess + ' (' + (elapsed > 0 ? (stats.totalSuccess / elapsed).toFixed(1) : '0') + ' rps)\n';
    output += '  被限流:   ' + stats.totalThrottled + '\n';
    output += '  错误:     ' + stats.totalErrors + '\n';
    output += '  平均 RPS: ' + rps + '\n';
    output += '\n';

    // 按端点统计
    output += '--- 各端点统计 ---\n';
    for (const [name, e] of Object.entries(stats.endpoints)) {
        if (e.sent === 0) continue;
        const avgMs = e.success > 0 ? (e.totalTime / e.success).toFixed(1) : '-';
        const minMs = e.minTime === Infinity ? '-' : e.minTime;
        const maxMs = e.maxTime;
        output += '  ' + name + ':\n';
        output += '    请求: ' + e.sent + ' | 成功: ' + e.success + ' | 限流: ' + e.throttled + ' | 错误: ' + e.error + '\n';
        output += '    响应时间: 平均=' + avgMs + 'ms 最小=' + minMs + 'ms 最大=' + maxMs + 'ms\n';
    }
    output += '\n';

    // HTTP状态码分布
    output += '--- HTTP 状态码分布 ---\n';
    const sortedCodes = Object.entries(stats.statusCodes).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [code, count] of sortedCodes) {
        output += '  ' + code + ': ' + count + ' 次\n';
    }
    output += '\n';

    // 错误详情
    if (Object.keys(stats.errors).length > 0) {
        output += '--- 错误详情 ---\n';
        for (const [err, count] of Object.entries(stats.errors)) {
            output += '  [' + count + 'x] ' + err + '\n';
        }
        output += '\n';
    }

    // 响应时间分布
    if (stats.responseTimes.length > 0) {
        const sorted = stats.responseTimes.slice().sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p90 = sorted[Math.floor(sorted.length * 0.9)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        output += '--- 响应时间百分位 ---\n';
        output += '  P50:  ' + p50 + 'ms\n';
        output += '  P90:  ' + p90 + 'ms\n';
        output += '  P95:  ' + p95 + 'ms\n';
        output += '  P99:  ' + p99 + 'ms\n';
        output += '  最大:  ' + sorted[sorted.length - 1] + 'ms\n';
    }

    output += '========================================\n';
    return output;
}

// ============================================================
// 主函数
// ============================================================
async function main() {
    console.log('');
    console.log('========================================');
    console.log('  战斗接口压力测试脚本');
    console.log('========================================');
    console.log('  目标: ' + API_BASE);
    console.log('  测试时长: ' + (CONFIG.durationMs / 1000) + ' 秒');
    console.log('  目标 RPS: ' + CONFIG.targetRps);
    console.log('');

    // 初始化端点统计
    for (const name of Object.keys(CONFIG.concurrency)) {
        initEndpointStats(name);
    }

    // 登录所有账号
    console.log('[1/3] 正在登录测试账号...');
    const tokens = [];
    for (const acc of CONFIG.accounts) {
        try {
            const token = await login(acc.username, acc.password);
            tokens.push({ username: acc.username, token: token });
            console.log('  [OK] ' + acc.username + ' 登录成功');
        } catch (e) {
            console.log('  [FAIL] ' + acc.username + ' 登录失败: ' + e.message);
        }
    }

    if (tokens.length === 0) {
        console.log('没有可用账号，退出测试');
        return;
    }
    console.log('  共 ' + tokens.length + ' 个账号可用');
    console.log('');

    // 计算总并发数
    let totalWorkers = 0;
    for (const [endpoint, concurrency] of Object.entries(CONFIG.concurrency)) {
        totalWorkers += concurrency * tokens.length;
    }
    console.log('[2/3] 启动并发worker...');
    console.log('  每个端点并发配置:');
    for (const [endpoint, concurrency] of Object.entries(CONFIG.concurrency)) {
        console.log('    ' + endpoint + ': ' + concurrency + ' x ' + tokens.length + ' 账号 = ' + (concurrency * tokens.length));
    }
    console.log('  总并发数: ' + totalWorkers);

    // 启动所有worker
    stats.startTime = Date.now();
    const running = { current: true };
    const allWorkers = [];

    for (const t of tokens) {
        for (const [endpointName, concurrency] of Object.entries(CONFIG.concurrency)) {
            for (let i = 0; i < concurrency; i++) {
                allWorkers.push(runLoop(endpointName, t.token, running));
            }
        }
    }

    console.log('  已启动 ' + allWorkers.length + ' 个并发worker');
    console.log('');

    // 实时统计显示
    console.log('[3/3] 测试运行中...');
    const reportInterval = setInterval(() => {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rps = elapsed > 0 ? (stats.totalSent / elapsed).toFixed(1) : '0';
        const successRps = elapsed > 0 ? (stats.totalSuccess / elapsed).toFixed(1) : '0';
        process.stdout.write('\r  运行中... ' + elapsed.toFixed(0) + 's | 总请求: ' + stats.totalSent + ' | 成功: ' + stats.totalSuccess + ' (' + successRps + '/s) | 限流: ' + stats.totalThrottled + ' | 错误: ' + stats.totalErrors + ' | RPS: ' + rps + '    ');
    }, 500);

    // 等待测试结束
    await new Promise(resolve => setTimeout(resolve, CONFIG.durationMs));
    
    // 停止所有worker
    running.current = false;
    clearInterval(reportInterval);
    
    // 等待所有worker结束
    console.log('\n  正在等待所有worker结束...');
    await Promise.all(allWorkers.map(w => w.catch(() => {})));
    
    console.log('\n\n测试结束！\n');
    
    // 打印报告
    const report = printReport();
    console.log(report);

    // 保存报告到文件
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const reportFile = path.join(dataDir, 'stress_test_report_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
    fs.writeFileSync(reportFile, report, 'utf8');
    console.log('报告已保存到: ' + reportFile);
}

main().catch(e => {
    console.error('\n主程序异常:', e.message);
    console.error(e.stack);
});
