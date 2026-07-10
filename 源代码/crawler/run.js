/**
 * 艾德尔修仙传 - 数据爬虫 CLI
 * 
 * 用法：
 *   node run.js login <用户名> <密码>          # 登录并保存 Token
 *   node run.js collect <用户名>               # 采集账号所有数据
 *   node run.js server                         # 采集服务器公开数据
 *   node run.js all <用户名>                    # 采集账号+服务器全部数据
 *   node run.js watch <用户名>                  # 持续监控（每60秒采集一次）
 *   node run.js listings [页数] [每页数量]       # 采集市场行情
 *   node run.js leaderboard                    # 采集联赛排行榜
 *   node run.js duels                          # 采集城战排行榜
 *   node run.js sects                          # 采集宗门信息
 *   node run.js alliances                      # 采集联盟列表
 *   node run.js export <用户名>                 # 导出 JSON 数据到文件
 */

const { apiRequest, login, makeSign, AccountCollector, ServerCollector } = require('./crawler');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');

// ============================================================
// Token 管理
// ============================================================
function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        }
    } catch {}
    return {};
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

function getToken(username) {
    const tokens = loadTokens();
    return tokens[username] || '';
}

function setToken(username, token) {
    const tokens = loadTokens();
    tokens[username] = token;
    saveTokens(tokens);
}

// ============================================================
// 数据保存
// ============================================================
function saveData(filename, data) {
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    console.log('  ' + String.fromCharCode(10003) + ' 已保存: ' + filepath);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function formatNumber(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

// ============================================================
// 数据展示
// ============================================================
function printPlayerSummary(data) {
    const p = data.playerSync?.player;
    if (!p) {
        console.log('  ' + String.fromCharCode(9888) + ' 未获取到玩家数据');
        return;
    }
    console.log('');
    console.log('  ' + boxTop('玩家信息摘要'));
    console.log('  ' + boxRow('名称', p.name || '?', 20, '等级', String(p.level || '?'), 4));
    console.log('  ' + boxRow('灵石', formatNumber(p.spirit_stones || 0), 18, '灵玉', formatNumber(p.spirit_jade || 0), 18));
    console.log('  ' + boxRow('修为', p.cultivation || '?', 20, '境界', p.realm || '?', 20));
    console.log('  ' + boxRow2('生命', (p.hp || '?') + '/' + (p.max_hp || '?'), 18, '真气', (p.mp || '?') + '/' + (p.max_mp || '?'), 18));
    console.log('  ' + boxRow('攻击', p.attack || '?', 18, '防御', p.defense || '?', 18));
    console.log('  ' + boxRow('速度', p.speed || '?', 18, '会心', p.crit_rate || '?', 18));
    if (p.alliance_name) {
        console.log('  ' + boxSingle('联盟', p.alliance_name, 44));
    }
    if (p.sect_name) {
        console.log('  ' + boxSingle('宗门', p.sect_name, 44));
    }
    console.log('  ' + boxBottom());
}

function printCaveSummary(data) {
    const cave = data.caveStatus?.data || data.caveStatus;
    if (!cave) return;
    console.log('');
    console.log('  ' + boxTop('洞府信息'));
    console.log('  ' + boxRow('等级', cave.level || '?', 6, '经验', String(cave.exp || 0), 10, '升级需', formatNumber(cave.upgrade_cost || 0), 10));
    if (cave.gathering) {
        const type = cave.gathering.type === 'field' ? '灵田' : '灵石矿';
        const status = cave.gathering.finished ? String.fromCharCode(10003) + ' 完成' : String.fromCharCode(9203) + ' 进行中';
        console.log('  ' + boxRow('采集', type, 10, '状态', status, 10));
    }
    if (cave.formation?.runtime) {
        const rt = cave.formation.runtime;
        const summary = rt.summary || {};
        console.log('  ' + boxRow('阵纹', String(summary.connected_runes || 0) + '/' + String(summary.total_runes || 0), 10, '流量', String(rt.flow || 0), 10));
    }
    console.log('  ' + boxBottom());
}

function printInventorySummary(data) {
    const sync = data.playerSync;
    if (!sync?.player?.inventory) return;
    let totalItems = 0;
    let equips = 0;
    let materials = 0;
    let potions = 0;
    for (const page of sync.player.inventory) {
        if (!page) continue;
        for (const slot of page) {
            if (slot?.item) {
                totalItems++;
                const type = slot.item.type || '';
                if (['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'].includes(type)) equips++;
                else if (type === 'potion' || type === 'pill') potions++;
                else materials++;
            }
        }
    }
    console.log('');
    console.log('  ' + boxTop('背包'));
    console.log('  ' + boxRow('总物品', String(totalItems), 8, '装备', String(equips), 8, '丹药', String(potions), 8, '材料', String(materials), 8));
    console.log('  ' + boxBottom());
}

function printExchangeSummary(data) {
    const listings = data.myListings?.data?.listings || data.myListings?.listings || [];
    if (!listings.length) return;
    console.log('');
    console.log('  ' + boxTop('我的挂单'));
    for (const l of listings.slice(0, 5)) {
        const name = l.item_name || l.item_snapshot?.name || '?';
        const price = l.unit_price || 0;
        const qty = l.quantity || 0;
        const side = l.side === 'buy' ? '求购' : '出售';
        console.log('  ' + boxRow(side, name, 16, String(qty) + '个', String(formatNumber(price)) + '灵石', 16));
    }
    if (listings.length > 5) console.log('  │ ... 还有 ' + listings.length + ' 条挂单');
    console.log('  ' + boxBottom());
}

function printLeagueSummary(data) {
    const lb = data.leagueLeaderboard?.data || data.leagueLeaderboard;
    if (!lb?.length && !lb?.rankings?.length) return;
    const rankings = lb.rankings || lb;
    console.log('');
    console.log('  ' + boxTop('联赛排行榜 (Top 10)'));
    for (let i = 0; i < Math.min(10, rankings.length); i++) {
        const r = rankings[i];
        const name = r.player_name || r.name || ('玩家' + (r.account_id || i));
        const score = r.score || r.rating || 0;
        console.log('  │ ' + padL(String(i + 1), 2) + '. ' + padR(name, 20) + ' ' + padL(String(score), 10) + '分 │');
    }
    console.log('  ' + boxBottom());
}

function printServerSummary(data) {
    // 宗门统计
    const sects = data.sectMemberCounts?.data || data.sectMemberCounts;
    if (sects?.length) {
        console.log('');
        console.log('  ' + boxTop('宗门列表'));
        for (const s of sects.slice(0, 8)) {
            console.log('  │ ' + padR(s.name || '?', 20) + ' 成员: ' + padL(String(s.member_count || 0), 4) + ' │');
        }
        if (sects.length > 8) console.log('  │ ... 共 ' + sects.length + ' 个宗门');
        console.log('  ' + boxBottom());
    }

    // 联盟统计
    const alliances = data.allianceList?.data || data.allianceList;
    if (alliances?.length) {
        console.log('');
        console.log('  ' + boxTop('联盟列表'));
        for (const a of alliances.slice(0, 8)) {
            console.log('  │ ' + padR(a.name || '?', 20) + ' 成员: ' + padL(String(a.member_count || 0), 4) + ' │');
        }
        if (alliances.length > 8) console.log('  │ ... 共 ' + alliances.length + ' 个联盟');
        console.log('  ' + boxBottom());
    }

    // 市场行情统计
    const listings = data.exchangeListings?.data?.listings || [];
    if (listings.length) {
        const sellListings = listings.filter(l => l.side !== 'buy');
        const buyListings = listings.filter(l => l.side === 'buy');
        console.log('');
        console.log('  ' + boxTop('市场行情'));
        console.log('  │ 出售: ' + padL(String(sellListings.length), 6) + ' 条  求购: ' + padL(String(buyListings.length), 6) + ' 条  总计: ' + padL(String(listings.length), 6) + ' 条 │');
        // 显示最贵的几个物品
        const sorted = [...sellListings].sort((a, b) => (b.unit_price || 0) - (a.unit_price || 0));
        console.log('  │ 高价物品:                                       │');
        for (const l of sorted.slice(0, 5)) {
            const name = l.item_name || l.item_snapshot?.name || '?';
            console.log('  │   ' + padR(name, 20) + ' ' + padL(String(formatNumber(l.unit_price || 0)), 10) + ' 灵石/个 │');
        }
        console.log('  ' + boxBottom());
    }
}

// ============================================================
// 盒子绘制工具
// ============================================================
function boxTop(title) {
    const totalWidth = 50;
    const titleLen = title.length;
    const leftPad = Math.floor((totalWidth - 4 - titleLen) / 2);
    const rightPad = totalWidth - 4 - titleLen - leftPad;
    return String.fromCharCode(9484) + String.fromCharCode(9472).repeat(leftPad) + ' ' + title + ' ' + String.fromCharCode(9472).repeat(rightPad) + String.fromCharCode(9488);
}

function boxBottom() {
    return String.fromCharCode(9492) + String.fromCharCode(9472).repeat(50) + String.fromCharCode(9496);
}

function boxRow(label1, val1, w1, label2, val2, w2) {
    return '│ ' + label1 + ': ' + padR(String(val1), w1) + ' ' + label2 + ': ' + padR(String(val2), w2) + ' │';
}

function boxRow2(label1, val1, w1, label2, val2, w2) {
    return '│ ' + label1 + ': ' + padR(String(val1), w1) + ' ' + label2 + ': ' + padR(String(val2), w2) + ' │';
}

function boxRow(label1, val1, w1, label2, val2, w2, label3, val3, w3, label4, val4, w4) {
    let s = '│ ';
    s += label1 + ': ' + padR(String(val1), w1) + ' ';
    s += label2 + ': ' + padR(String(val2), w2) + ' ';
    if (label3) s += label3 + ': ' + padR(String(val3), w3) + ' ';
    if (label4) s += label4 + ': ' + padR(String(val4), w4) + ' ';
    s += '│';
    return s;
}

function boxSingle(label, val, w) {
    return '│ ' + label + ': ' + padR(String(val), w) + ' │';
}

function padR(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
}

function padL(s, n) {
    s = String(s);
    while (s.length < n) s = ' ' + s;
    return s;
}

// ============================================================
// 命令实现
// ============================================================
async function cmdLogin(username, password) {
    console.log('\n  ' + String.fromCharCode(128273) + ' 登录: ' + username);
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    try {
        const token = await login(username, password);
        setToken(username, token);
        console.log('  ' + String.fromCharCode(10003) + ' 登录成功! Token 已保存');
        console.log('  Token: ' + token.slice(0, 20) + '...' + token.slice(-10));
        return token;
    } catch (err) {
        console.error('  ' + String.fromCharCode(10007) + ' 登录失败: ' + err.message);
        process.exit(1);
    }
}

async function cmdCollect(username) {
    const token = getToken(username);
    if (!token) {
        console.error('  ' + String.fromCharCode(10007) + ' 未找到 ' + username + ' 的 Token，请先运行: node run.js login ' + username + ' <密码>');
        process.exit(1);
    }

    const collector = new AccountCollector(token);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    console.log('\n  ' + String.fromCharCode(128250) + ' 采集账号数据: ' + username);
    console.log('  ' + String.fromCharCode(9201) + '  ' + new Date().toLocaleString('zh-CN'));
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    console.log('  正在采集...');
    const { results, errors } = await collector.collectAll();

    // 保存原始数据
    const filename = 'account_' + username + '_' + timestamp + '.json';
    saveData(filename, { collectedAt: new Date().toISOString(), username, results, errors });

    // 展示摘要
    printPlayerSummary(results);
    printCaveSummary(results);
    printInventorySummary(results);
    printExchangeSummary(results);
    printLeagueSummary(results);

    if (Object.keys(errors).length) {
        console.log('');
        console.log('  ' + String.fromCharCode(9888) + ' 部分采集失败:');
        for (const [name, err] of Object.entries(errors)) {
            console.log('    ' + name + ': ' + err);
        }
    }

    const fileSize = fs.statSync(path.join(DATA_DIR, filename)).size;
    console.log('');
    console.log('  ' + String.fromCharCode(10003) + ' 采集完成! 数据已保存到 data/' + filename + ' (' + formatBytes(fileSize) + ')');
}

async function cmdServer() {
    const collector = new ServerCollector();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    console.log('\n  ' + String.fromCharCode(127760) + ' 采集服务器公开数据');
    console.log('  ' + String.fromCharCode(9201) + '  ' + new Date().toLocaleString('zh-CN'));
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    console.log('  正在采集...');
    const { results, errors } = await collector.collectAll();

    const filename = 'server_' + timestamp + '.json';
    saveData(filename, { collectedAt: new Date().toISOString(), results, errors });

    printServerSummary(results);

    if (Object.keys(errors).length) {
        console.log('');
        console.log('  ' + String.fromCharCode(9888) + ' 部分采集失败:');
        for (const [name, err] of Object.entries(errors)) {
            console.log('    ' + name + ': ' + err);
        }
    }

    const fileSize = fs.statSync(path.join(DATA_DIR, filename)).size;
    console.log('');
    console.log('  ' + String.fromCharCode(10003) + ' 采集完成! 数据已保存到 data/' + filename + ' (' + formatBytes(fileSize) + ')');
}

async function cmdAll(username) {
    await cmdCollect(username);
    console.log('');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    await cmdServer();
}

async function cmdWatch(username) {
    const token = getToken(username);
    if (!token) {
        console.error('  ' + String.fromCharCode(10007) + ' 未找到 ' + username + ' 的 Token');
        process.exit(1);
    }

    const accountCollector = new AccountCollector(token);
    const serverCollector = new ServerCollector();
    const interval = 60; // 秒

    console.log('\n  ' + String.fromCharCode(128065) + '  持续监控模式 (每 ' + interval + 's 采集一次)');
    console.log('  ' + String.fromCharCode(128250) + ' 账号: ' + username);
    console.log('  ' + String.fromCharCode(9201) + '  开始: ' + new Date().toLocaleString('zh-CN'));
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    console.log('  按 Ctrl+C 停止\n');

    let count = 0;
    async function tick() {
        count++;
        const now = new Date().toLocaleString('zh-CN');
        process.stdout.write('  [' + now + '] #' + count + ' 采集...');
        
        try {
            const [accResult, srvResult] = await Promise.all([
                accountCollector.collectAll(),
                serverCollector.collectAll()
            ]);

            // 保存
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            saveData('watch_account_' + username + '_' + ts + '.json', {
                collectedAt: new Date().toISOString(), username, ...accResult
            });
            saveData('watch_server_' + ts + '.json', {
                collectedAt: new Date().toISOString(), ...srvResult
            });

            const p = accResult.results.playerSync?.player;
            const name = p?.name || username;
            const level = p?.level || '?';
            const stones = p?.spirit_stones || 0;
            const errors = Object.keys(accResult.errors).length + Object.keys(srvResult.errors).length;

            process.stdout.write(' ' + String.fromCharCode(10003) + ' ' + name + ' Lv.' + level + ' 灵石:' + formatNumber(stones));
            if (errors) process.stdout.write(' ' + String.fromCharCode(9888) + errors + 'err');
            process.stdout.write('\n');
        } catch (err) {
            process.stdout.write(' ' + String.fromCharCode(10007) + ' ' + err.message + '\n');
        }
    }

    // 立即执行一次
    await tick();
    // 定时执行
    setInterval(tick, interval * 1000);
}

async function cmdListings(page = 1, pageSize = 50) {
    console.log('\n  ' + String.fromCharCode(128202) + ' 采集市场行情 (第' + page + '页, 每页' + pageSize + '条)');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new ServerCollector();
    const r = await collector.getExchangeListings(page, pageSize);
    const listings = r.data?.listings || r.listings || [];
    
    console.log('  共 ' + listings.length + ' 条挂单');
    console.log('');
    console.log('  ' + boxTop('出售列表'));
    const sells = listings.filter(l => l.side !== 'buy');
    for (const l of sells.slice(0, 20)) {
        const name = l.item_name || l.item_snapshot?.name || '?';
        console.log('  │ ' + padR(name, 18) + ' ' + padL(String(l.quantity || 0), 4) + '个 ' + String.fromCharCode(215) + ' ' + padL(String(formatNumber(l.unit_price || 0)), 8) + '灵石/个 │');
    }
    if (sells.length > 20) console.log('  │ ... 还有 ' + (sells.length - 20) + ' 条');
    console.log('  ' + boxBottom());
    
    console.log('');
    console.log('  ' + boxTop('求购列表'));
    const buys = listings.filter(l => l.side === 'buy');
    for (const l of buys.slice(0, 20)) {
        const name = l.item_name || l.item_snapshot?.name || '?';
        console.log('  │ ' + padR(name, 18) + ' ' + padL(String(l.quantity || 0), 4) + '个 ' + String.fromCharCode(215) + ' ' + padL(String(formatNumber(l.unit_price || 0)), 8) + '灵石/个 │');
    }
    if (buys.length > 20) console.log('  │ ... 还有 ' + (buys.length - 20) + ' 条');
    console.log('  ' + boxBottom());

    // 保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveData('listings_' + timestamp + '.json', { collectedAt: new Date().toISOString(), listings });
}

async function cmdLeaderboard() {
    console.log('\n  ' + String.fromCharCode(127991) + ' 采集联赛排行榜');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new ServerCollector();
    const [lb, teamRank] = await Promise.all([
        collector.getLeagueLeaderboard(200),
        collector.getLeagueTeamRank(0, 200)
    ]);

    const rankings = lb.data?.rankings || lb.rankings || lb.data || lb || [];
    const teams = teamRank.data?.rankings || teamRank.rankings || teamRank.data || teamRank || [];

    console.log('');
    console.log('  ' + boxTop('个人排行榜'));
    for (let i = 0; i < Math.min(20, rankings.length); i++) {
        const r = rankings[i];
        const name = r.player_name || r.name || ('#' + (r.account_id || i));
        console.log('  │ ' + padL(String(i + 1), 3) + '. ' + padR(name, 18) + ' ' + padL(String(r.score || r.rating || 0), 8) + '分 │');
    }
    if (rankings.length > 20) console.log('  │ ... 共 ' + rankings.length + ' 人');
    console.log('  ' + boxBottom());

    if (teams.length) {
        console.log('');
        console.log('  ' + boxTop('战队排行榜'));
        for (let i = 0; i < Math.min(10, teams.length); i++) {
            const t = teams[i];
            console.log('  │ ' + padL(String(i + 1), 3) + '. ' + padR(t.team_name || '?', 18) + ' ' + padL(String(t.score || t.rating || 0), 8) + '分 │');
        }
        console.log('  ' + boxBottom());
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveData('leaderboard_' + timestamp + '.json', { collectedAt: new Date().toISOString(), rankings, teams });
}

async function cmdDuels() {
    console.log('\n  ' + String.fromCharCode(9876) + ' 采集城战排行榜');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new ServerCollector();
    const r = await collector.getCityDuelRank();
    const rankings = r.data?.rankings || r.rankings || r.data || r || [];

    console.log('');
    console.log('  ' + boxTop('城战排行榜'));
    for (let i = 0; i < Math.min(20, rankings.length); i++) {
        const r = rankings[i];
        const name = r.player_name || r.name || ('#' + (r.account_id || i));
        console.log('  │ ' + padL(String(i + 1), 3) + '. ' + padR(name, 18) + ' ' + padL(String(r.score || r.rating || 0), 8) + '分 │');
    }
    if (rankings.length > 20) console.log('  │ ... 共 ' + rankings.length + ' 人');
    console.log('  ' + boxBottom());

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveData('duels_' + timestamp + '.json', { collectedAt: new Date().toISOString(), rankings });
}

async function cmdSects() {
    console.log('\n  ' + String.fromCharCode(127963) + ' 采集宗门信息');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new ServerCollector();
    const r = await collector.getSectMemberCounts();
    const sects = r.data || r || [];

    console.log('');
    console.log('  ' + boxTop('宗门列表'));
    for (const s of sects) {
        console.log('  │ ' + padR(s.name || '?', 20) + ' 成员: ' + padL(String(s.member_count || 0), 4) + ' │');
    }
    console.log('  │ 共 ' + sects.length + ' 个宗门');
    console.log('  ' + boxBottom());

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveData('sects_' + timestamp + '.json', { collectedAt: new Date().toISOString(), sects });
}

async function cmdAlliances() {
    console.log('\n  ' + String.fromCharCode(129309) + ' 采集联盟列表');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new ServerCollector();
    const r = await collector.getAllianceList();
    const alliances = r.data || r || [];

    console.log('');
    console.log('  ' + boxTop('联盟列表'));
    for (const a of alliances) {
        console.log('  │ ' + padR(a.name || '?', 20) + ' 成员: ' + padL(String(a.member_count || 0), 4) + ' 盟主: ' + padR(a.leader_name || '?', 12) + ' │');
    }
    console.log('  │ 共 ' + alliances.length + ' 个联盟');
    console.log('  ' + boxBottom());

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveData('alliances_' + timestamp + '.json', { collectedAt: new Date().toISOString(), alliances });
}

async function cmdExport(username) {
    const token = getToken(username);
    if (!token) {
        console.error('  ' + String.fromCharCode(10007) + ' 未找到 ' + username + ' 的 Token');
        process.exit(1);
    }

    console.log('\n  ' + String.fromCharCode(128230) + ' 导出 ' + username + ' 的完整数据');
    console.log('  ' + String.fromCharCode(9472).repeat(47));
    
    const collector = new AccountCollector(token);
    const { results, errors } = await collector.collectAll();

    const exportFile = path.join(__dirname, username + '_export.json');
    fs.writeFileSync(exportFile, JSON.stringify({ 
        exportedAt: new Date().toISOString(),
        username,
        data: results,
        errors
    }, null, 2), 'utf-8');

    const fileSize = fs.statSync(exportFile).size;
    console.log('  ' + String.fromCharCode(10003) + ' 已导出到 ' + exportFile + ' (' + formatBytes(fileSize) + ')');
    
    if (Object.keys(errors).length) {
        console.log('  ' + String.fromCharCode(9888) + ' 部分数据缺失:');
        for (const [name, err] of Object.entries(errors)) {
            console.log('    ' + name + ': ' + err);
        }
    }
}

// ============================================================
// 主入口
// ============================================================
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];

    if (!cmd || cmd === 'help' || cmd === '--help') {
        console.log('');
        console.log('  艾德尔修仙传 - 数据爬虫');
        console.log('  ' + String.fromCharCode(9553).repeat(47));
        console.log('');
        console.log('  用法:');
        console.log('    node run.js login <用户名> <密码>          登录并保存 Token');
        console.log('    node run.js collect <用户名>               采集账号所有数据');
        console.log('    node run.js server                         采集服务器公开数据');
        console.log('    node run.js all <用户名>                    采集账号+服务器全部数据');
        console.log('    node run.js watch <用户名>                  持续监控（每60秒采集一次）');
        console.log('    node run.js listings [页数] [每页数量]       采集市场行情');
        console.log('    node run.js leaderboard                    采集联赛排行榜');
        console.log('    node run.js duels                          采集城战排行榜');
        console.log('    node run.js sects                          采集宗门信息');
        console.log('    node run.js alliances                      采集联盟列表');
        console.log('    node run.js export <用户名>                 导出 JSON 数据到文件');
        console.log('');
        console.log('  示例:');
        console.log('    node run.js login 我的账号 我的密码');
        console.log('    node run.js collect 我的账号');
        console.log('    node run.js server');
        console.log('    node run.js all 我的账号');
        console.log('    node run.js watch 我的账号');
        console.log('    node run.js listings 1 100');
        console.log('');
        return;
    }

    switch (cmd) {
        case 'login':
            if (args.length < 3) { console.error('用法: node run.js login <用户名> <密码>'); process.exit(1); }
            await cmdLogin(args[1], args[2]);
            break;

        case 'collect':
            if (args.length < 2) { console.error('用法: node run.js collect <用户名>'); process.exit(1); }
            await cmdCollect(args[1]);
            break;

        case 'server':
            await cmdServer();
            break;

        case 'all':
            if (args.length < 2) { console.error('用法: node run.js all <用户名>'); process.exit(1); }
            await cmdAll(args[1]);
            break;

        case 'watch':
            if (args.length < 2) { console.error('用法: node run.js watch <用户名>'); process.exit(1); }
            await cmdWatch(args[1]);
            break;

        case 'listings':
            await cmdListings(parseInt(args[1]) || 1, parseInt(args[2]) || 50);
            break;

        case 'leaderboard':
            await cmdLeaderboard();
            break;

        case 'duels':
            await cmdDuels();
            break;

        case 'sects':
            await cmdSects();
            break;

        case 'alliances':
            await cmdAlliances();
            break;

        case 'export':
            if (args.length < 2) { console.error('用法: node run.js export <用户名>'); process.exit(1); }
            await cmdExport(args[1]);
            break;

        default:
            console.error('未知命令: ' + cmd);
            console.log('使用 node run.js help 查看帮助');
            process.exit(1);
    }
}

main().catch(err => {
    console.error('\n  ' + String.fromCharCode(10007) + ' 错误: ' + err.message);
    process.exit(1);
});
