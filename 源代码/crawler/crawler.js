/**
 * 艾德尔修仙传 - 爬虫引擎
 * 
 * 功能：
 * - 使用 HMAC-SHA256 签名向游戏 API 发送请求
 * - 支持多账号 Token 管理
 * - 自动采集账号数据（玩家信息、背包、装备、战斗、洞府等）
 * - 自动采集服务器数据（排行榜、市场行情、宗门列表等）
 * - 数据持久化到 JSON 文件
 * - 定时轮询采集
 */

const crypto = require('crypto');
const fetch = require('node-fetch');

// ============================================================
// 常量
// ============================================================
const API_BASE = 'https://idlexiuxianzhuan.cn';
const CLIENT_VERSION = '1.2.4';
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';

// ============================================================
// HMAC 签名
// ============================================================
function makeSign(method, path, timestamp, bodyStr) {
    const data = method + '\n' + path + '\n' + timestamp + '\n' + bodyStr;
    const hmac = crypto.createHmac('sha256', SIGN_KEY);
    hmac.update(data);
    return hmac.digest('hex');
}

// ============================================================
// API 请求
// ============================================================
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
        throw new Error('非JSON响应 (' + r.status + '): ' + text.slice(0, 200));
    }
    if (!data || data.ok === false) {
        throw new Error(data && data.error ? data.error : '请求失败 (' + r.status + ')');
    }
    return data;
}

// ============================================================
// 登录获取 Token
// ============================================================
async function login(username, password) {
    const body = { username: username, password: password, machine_id: 'crawler-nodejs' };
    const r = await apiRequest('POST', '/auth/login', '', body);
    if (r.ok && r.token) {
        return r.token;
    }
    throw new Error(r.error || '登录失败');
}

// ============================================================
// 账号数据采集器
// ============================================================
class AccountCollector {
    constructor(token) {
        this.token = token;
    }

    async request(method, path, body) {
        if (body === undefined) body = null;
        return apiRequest(method, path, this.token, body);
    }

    // 玩家基础信息
    async getPlayerSync() {
        return this.request('GET', '/player/sync');
    }

    async getPlayerState() {
        return this.request('GET', '/player/state');
    }

    // 游戏数据（物品、地图、技能等静态数据）
    async getGameData() {
        return this.request('GET', '/game-data');
    }

    // 背包
    async getInventory() {
        return this.getPlayerSync();
    }

    // 战斗
    async getBattleState(battleId) {
        return this.request('GET', '/battle/state/' + battleId);
    }

    async getBattlePoll(afterIdx, autoRestart) {
        if (afterIdx === undefined) afterIdx = 0;
        if (autoRestart === undefined) autoRestart = false;
        var ar = autoRestart ? '1' : '0';
        return this.request('GET', '/battle/poll?after=' + afterIdx + '&auto_restart=' + ar);
    }

    // 洞府
    async getCaveStatus() {
        return this.request('GET', '/online/cave/status');
    }

    // 传人
    async getDiscipleStatus() {
        return this.request('GET', '/online/disciple/status');
    }

    async getDiscipleBattleStatus() {
        return this.request('GET', '/online/disciple-battle/status');
    }

    // 宗门
    async getSectMemberCounts() {
        return this.request('GET', '/online/sect/member_counts');
    }

    async getSectTasks() {
        return this.request('GET', '/online/sect/tasks');
    }

    async getSectTreasury() {
        return this.request('GET', '/online/sect/treasury/list');
    }

    // 坊市
    async getExchangeListings(page, pageSize, filters) {
        if (page === undefined) page = 1;
        if (pageSize === undefined) pageSize = 20;
        if (filters === undefined) filters = {};
        var q = '/exchange/listings?page=' + page + '&page_size=' + pageSize;
        var filterKeys = ['side', 'keyword', 'sort_by', 'category', 'subtype'];
        for (var i = 0; i < filterKeys.length; i++) {
            var k = filterKeys[i];
            if (filters[k] && filters[k] !== 'all') q += '&' + k + '=' + encodeURIComponent(filters[k]);
        }
        var numKeys = ['item_id', 'min_price', 'max_price'];
        for (var j = 0; j < numKeys.length; j++) {
            var nk = numKeys[j];
            if (filters[nk] > 0) q += '&' + nk + '=' + filters[nk];
        }
        if (Number(filters.quality) > 0) q += '&quality=' + Math.floor(Number(filters.quality));
        return this.request('GET', q);
    }

    async getMyListings() {
        return this.request('GET', '/exchange/my/listings');
    }

    // 邮件
    async getMailList() {
        return this.request('GET', '/mail/list');
    }

    // 联盟
    async getAllianceDetail(allianceId) {
        return this.request('GET', '/alliance/detail/' + allianceId);
    }

    async getAllianceBuildings(allianceId) {
        return this.request('GET', '/alliance/buildings/' + allianceId);
    }

    async getAllianceTreasury(allianceId) {
        return this.request('GET', '/alliance/treasury/list/' + allianceId);
    }

    async getAllianceWarehouse(allianceId) {
        return this.request('GET', '/alliance/warehouse/' + allianceId);
    }

    // 联赛
    async getLeagueStatus() {
        return this.request('GET', '/league/status');
    }

    async getLeagueLeaderboard(limit) {
        if (limit === undefined) limit = 100;
        return this.request('GET', '/league/leaderboard?limit=' + limit);
    }

    async getLeagueTeamRank(weekStart, limit) {
        if (weekStart === undefined) weekStart = 0;
        if (limit === undefined) limit = 100;
        return this.request('GET', '/league/team_rank?week_start=' + weekStart + '&limit=' + limit);
    }

    async getLeagueMatches(weekStart, limit) {
        if (weekStart === undefined) weekStart = 0;
        if (limit === undefined) limit = 50;
        return this.request('GET', '/league/matches?week_start=' + weekStart + '&limit=' + limit);
    }

    async getLeagueShop() {
        return this.request('GET', '/league/shop');
    }

    // 试炼
    async getTrialContracts() {
        return this.request('GET', '/trial/contracts');
    }

    async getTrialShop() {
        return this.request('GET', '/trial/shop');
    }

    // 城战
    async getCityDuelRank() {
        return this.request('GET', '/dungeon-battle/city_duel/rank');
    }

    async getCityDuelLogs(page, pageSize, role) {
        if (page === undefined) page = 1;
        if (pageSize === undefined) pageSize = 20;
        if (role === undefined) role = 'all';
        return this.request('GET', '/dungeon-battle/city_duel/logs?page=' + page + '&page_size=' + pageSize + '&role=' + role);
    }

    // 邀请
    async getInviteInfo() {
        return this.request('GET', '/invite/info');
    }

    async getInviteInvitees() {
        return this.request('GET', '/invite/invitees');
    }

    async getInviteShop() {
        return this.request('GET', '/invite/shop');
    }

    // 邮箱绑定状态
    async getEmailStatus() {
        return this.request('GET', '/email/status');
    }

    // 采集所有账号数据
    async collectAll() {
        var results = {};
        var errors = {};

        var tasks = [
            ['playerSync', function(self) { return self.getPlayerSync(); }],
            ['playerState', function(self) { return self.getPlayerState(); }],
            ['gameData', function(self) { return self.getGameData(); }],
            ['caveStatus', function(self) { return self.getCaveStatus(); }],
            ['discipleStatus', function(self) { return self.getDiscipleStatus(); }],
            ['discipleBattle', function(self) { return self.getDiscipleBattleStatus(); }],
            ['sectMemberCounts', function(self) { return self.getSectMemberCounts(); }],
            ['sectTasks', function(self) { return self.getSectTasks(); }],
            ['sectTreasury', function(self) { return self.getSectTreasury(); }],
            ['myListings', function(self) { return self.getMyListings(); }],
            ['mailList', function(self) { return self.getMailList(); }],
            ['leagueStatus', function(self) { return self.getLeagueStatus(); }],
            ['leagueLeaderboard', function(self) { return self.getLeagueLeaderboard(); }],
            ['trialContracts', function(self) { return self.getTrialContracts(); }],
            ['trialShop', function(self) { return self.getTrialShop(); }],
            ['cityDuelRank', function(self) { return self.getCityDuelRank(); }],
            ['inviteInfo', function(self) { return self.getInviteInfo(); }],
            ['inviteInvitees', function(self) { return self.getInviteInvitees(); }],
            ['inviteShop', function(self) { return self.getInviteShop(); }],
            ['emailStatus', function(self) { return self.getEmailStatus(); }],
        ];

        for (var t = 0; t < tasks.length; t++) {
            var name = tasks[t][0];
            var fn = tasks[t][1];
            try {
                var data = await fn(this);
                results[name] = data;
            } catch (err) {
                errors[name] = err.message;
            }
        }

        // 如果有联盟，获取联盟详情
        if (results.playerSync && results.playerSync.player && results.playerSync.player.alliance_id) {
            var aid = results.playerSync.player.alliance_id;
            try {
                results.allianceDetail = await this.getAllianceDetail(aid);
            } catch (err) { errors.allianceDetail = err.message; }
            try {
                results.allianceBuildings = await this.getAllianceBuildings(aid);
            } catch (err) { errors.allianceBuildings = err.message; }
            try {
                results.allianceTreasury = await this.getAllianceTreasury(aid);
            } catch (err) { errors.allianceTreasury = err.message; }
            try {
                results.allianceWarehouse = await this.getAllianceWarehouse(aid);
            } catch (err) { errors.allianceWarehouse = err.message; }
        }

        return { results: results, errors: errors };
    }
}

// ============================================================
// 服务器数据采集器（需要 Token 访问服务器数据接口）
// ============================================================
class ServerCollector {
    constructor(token) {
        if (token === undefined) token = '';
        this.token = token;
    }

    async _req(method, path, body) {
        if (body === undefined) body = null;
        return apiRequest(method, path, this.token, body);
    }

    // 市场行情
    async getExchangeListings(page, pageSize, filters) {
        if (page === undefined) page = 1;
        if (pageSize === undefined) pageSize = 20;
        if (filters === undefined) filters = {};
        var q = '/exchange/listings?page=' + page + '&page_size=' + pageSize;
        var filterKeys = ['side', 'keyword', 'sort_by', 'category', 'subtype'];
        for (var i = 0; i < filterKeys.length; i++) {
            var k = filterKeys[i];
            if (filters[k] && filters[k] !== 'all') q += '&' + k + '=' + encodeURIComponent(filters[k]);
        }
        var numKeys = ['item_id', 'min_price', 'max_price'];
        for (var j = 0; j < numKeys.length; j++) {
            var nk = numKeys[j];
            if (filters[nk] > 0) q += '&' + nk + '=' + filters[nk];
        }
        if (Number(filters.quality) > 0) q += '&quality=' + Math.floor(Number(filters.quality));
        return this._req('GET', q);
    }

    // 宗门列表
    async getSectMemberCounts() {
        return this._req('GET', '/online/sect/member_counts');
    }

    // 联盟列表
    async getAllianceList() {
        return this._req('GET', '/alliance/list');
    }

    // 联赛排行榜
    async getLeagueLeaderboard(limit) {
        if (limit === undefined) limit = 100;
        return this._req('GET', '/league/leaderboard?limit=' + limit);
    }

    async getLeagueTeamRank(weekStart, limit) {
        if (weekStart === undefined) weekStart = 0;
        if (limit === undefined) limit = 100;
        return this._req('GET', '/league/team_rank?week_start=' + weekStart + '&limit=' + limit);
    }

    // 城战排行榜
    async getCityDuelRank() {
        return this._req('GET', '/dungeon-battle/city_duel/rank');
    }

    // 采集所有服务器数据
    async collectAll() {
        var results = {};
        var errors = {};

        var tasks = [
            ['sectMemberCounts', function(self) { return self.getSectMemberCounts(); }],
            ['allianceList', function(self) { return self.getAllianceList(); }],
            ['leagueLeaderboard', function(self) { return self.getLeagueLeaderboard(200); }],
            ['leagueTeamRank', function(self) { return self.getLeagueTeamRank(0, 200); }],
            ['cityDuelRank', function(self) { return self.getCityDuelRank(); }],
        ];

        // 采集多页市场数据
        try {
            var allListings = [];
            for (var page = 1; page <= 5; page++) {
                var r = await this.getExchangeListings(page, 50);
                if (r.ok && r.data && r.data.listings) {
                    allListings = allListings.concat(r.data.listings);
                }
                if (!r.ok || !r.data || !r.data.has_more) break;
            }
            results.exchangeListings = { ok: true, data: { listings: allListings, total: allListings.length } };
        } catch (err) { errors.exchangeListings = err.message; }

        for (var t = 0; t < tasks.length; t++) {
            var name = tasks[t][0];
            var fn = tasks[t][1];
            try {
                results[name] = await fn(this);
            } catch (err) {
                errors[name] = err.message;
            }
        }

        return { results: results, errors: errors };
    }
}

module.exports = { apiRequest: apiRequest, login: login, makeSign: makeSign, AccountCollector: AccountCollector, ServerCollector: ServerCollector };
