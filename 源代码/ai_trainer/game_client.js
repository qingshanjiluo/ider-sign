/**
 * 游戏机器人客户端 (完整版)
 * 封装与艾德尔修仙传服务器的所有HTTP API交互
 * 覆盖：认证、玩家、战斗、副本、城战、联赛、试炼、邮件、
 *       炼丹、锻造、洞府、传人、宗门、联盟、交易所、聊天、
 *       邀请、邮箱、天赋、命途、技能预设等全部功能
 */
const http = require('http');
const crypto = require('crypto');

class GameClient {
  /**
   * @param {string} serverUrl - 服务器地址，如 http://127.0.0.1:3000
   * @param {object} options - 可选配置
   */
  constructor(serverUrl = 'http://127.0.0.1:3000', options = {}) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.token = null;
    this.accountId = null;
    this.player = null;
    this.gameData = null;
    this.lastSync = null;
    this.activeBattle = null;
    this.battleSeq = 0;
    // 修复：使用正确的签名密钥
    this.clientVersion = options.clientVersion || '1.2.4';
    this.signSecret = options.signSecret || 'xXaEdLr_s1gn_K3y_2024!@#';
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.minRequestInterval = options.minRequestInterval || 100; // ms
  }

  /** 解析URL */
  _parseUrl(path) {
    const base = this.serverUrl;
    const url = new URL(path, base);
    return {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      protocol: url.protocol
    };
  }

  /** 生成HMAC-SHA256签名 */
  _makeSign(method, path, timestamp, bodyStr) {
    const data = `${method}\n${path}\n${timestamp}\n${bodyStr}`;
    return crypto.createHmac('sha256', this.signSecret)
      .update(data)
      .digest('hex');
  }

  /** 发送HTTP请求 */
  async _request(method, path, body = null, extraHeaders = {}) {
    // 限速
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise(r => setTimeout(r, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;

    const urlInfo = this._parseUrl(path);
    const bodyStr = body ? JSON.stringify(body) : '';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this._makeSign(method, path, timestamp, bodyStr);

    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Version': this.clientVersion,
      'X-Sign-T': String(timestamp),
      'X-Sign': sign,
      ...extraHeaders
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: urlInfo.hostname,
        port: urlInfo.port,
        path: urlInfo.path,
        method: method,
        headers: headers,
        timeout: 30000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok && res.statusCode === 401) {
              if (this._retryCount < 2) {
                this._retryCount = (this._retryCount || 0) + 1;
                console.warn(`[GameClient] 401, retrying... (attempt ${this._retryCount})`);
                resolve(this._request(method, path, body, extraHeaders));
                return;
              }
            }
            this._retryCount = 0;
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}, raw: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`Request error: ${e.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ==================== 认证接口 ====================

  /** 注册账号 */
  async register(username, password) {
    const machineId = crypto.randomBytes(8).toString('hex');
    const r = await this._request('POST', '/auth/register', {
      username, password, machine_id: machineId
    });
    if (r.ok) {
      this.token = r.token;
      this.accountId = r.accountId;
    }
    return r;
  }

  /** 登录账号 */
  async login(username, password) {
    const machineId = crypto.randomBytes(8).toString('hex');
    const r = await this._request('POST', '/auth/login', {
      username, password, machine_id: machineId
    });
    if (r.ok) {
      this.token = r.token;
      this.accountId = r.accountId;
    }
    return r;
  }

  /** 设置token（用于恢复会话） */
  setToken(token, accountId) {
    this.token = token;
    this.accountId = accountId;
  }

  // ==================== 玩家接口 ====================

  /** 创建角色 */
  async createCharacter(name, spiritRoots = null) {
    if (!spiritRoots) {
      spiritRoots = { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 };
    }
    const r = await this._request('POST', '/player/create', {
      name, spirit_roots: spiritRoots
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 同步玩家数据 */
  async sync(mode = 'fast') {
    const query = mode === 'heavy' ? '?mode=heavy' : '?mode=fast';
    const r = await this._request('GET', `/player/sync${query}`);
    if (r.ok && r.player) {
      this.player = r.player;
      this.lastSync = r;
    }
    return r;
  }

  /** 获取轻量状态 */
  async getState() {
    const r = await this._request('GET', '/player/state');
    if (r.ok && r.player) this.player = r.player;
    return r;
  }

  /** 升级 */
  async levelUp() {
    const r = await this._request('POST', '/player/level_up');
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 突破 */
  async breakthrough() {
    const r = await this._request('POST', '/player/breakthrough');
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 装备物品 */
  async equip(page, slotIndex, expectItemId = 0) {
    const r = await this._request('POST', '/player/equip', {
      page, slot_index: slotIndex, expect_item_id: expectItemId
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 卸下装备 */
  async unequip(slot) {
    const r = await this._request('POST', '/player/unequip', { slot });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 使用物品 */
  async useItem(page, slotIndex, count = 1, expectItemId = 0, useOptions = null) {
    const body = { page, slot_index: slotIndex, count, expect_item_id: expectItemId };
    if (useOptions) body.use_options = useOptions;
    const r = await this._request('POST', '/player/use_item', body);
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 出售物品 */
  async sellItem(page, slotIndex, count = 1, expectItemId = 0) {
    const r = await this._request('POST', '/player/sell_item', {
      page, slot_index: slotIndex, count, expect_item_id: expectItemId
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 整理背包 */
  async sortInventory() {
    const r = await this._request('POST', '/player/inventory/sort');
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 锁定/解锁背包格子 */
  async toggleInventoryLock(page, slotIndex, locked = null) {
    const body = { page, slot_index: slotIndex };
    if (locked !== null) body.locked = !!locked;
    const r = await this._request('POST', '/player/inventory/lock', body);
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 设置地图 */
  async setMap(mapId) {
    const r = await this._request('POST', '/player/set_map', { map_id: mapId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 装备技能 */
  async equipSkill(skillId) {
    const r = await this._request('POST', '/player/equip_skill', { skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 卸下技能 */
  async unequipSkill(skillId) {
    const r = await this._request('POST', '/player/unequip_skill', { skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 设置KEY技能 */
  async setKeySkill(skillId) {
    const r = await this._request('POST', '/player/set_key_skill', { skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 设置功法 */
  async setTechnique(slot, techniqueId) {
    const r = await this._request('POST', '/player/set_technique', {
      slot, technique_id: techniqueId
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 设置符箓 */
  async setTalisman(itemId) {
    const r = await this._request('POST', '/player/set_talisman', { item_id: itemId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 分解装备 */
  async decomposeEquipment(page, slotIndex, expectItemId = 0) {
    const r = await this._request('POST', '/player/decompose_equipment', {
      page, slot_index: slotIndex, expect_item_id: expectItemId
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 批量分解装备 */
  async decomposeEquipmentBatch(slots) {
    const r = await this._request('POST', '/player/decompose_equipment', { slots });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 解锁命途节点 */
  async destinyUnlock(nodeId) {
    const r = await this._request('POST', '/player/destiny/unlock', { node_id: nodeId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 重置命途 */
  async destinyReset() {
    const r = await this._request('POST', '/player/destiny/reset', {});
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 解锁天赋节点 */
  async talentUnlock(nodeId) {
    const r = await this._request('POST', '/player/talent/unlock', { node_id: nodeId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 重置天赋 */
  async talentReset() {
    const r = await this._request('POST', '/player/talent/reset', {});
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 保存技能预设 */
  async saveSkillPreset(preset, equippedSkills, keySkillId) {
    const r = await this._request('POST', '/player/save_skill_preset', {
      preset, equipped_skills: equippedSkills, key_skill_id: keySkillId
    });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 应用技能预设 */
  async applySkillPreset(preset) {
    const r = await this._request('POST', '/player/apply_skill_preset', { preset });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 预设装备技能 */
  async presetEquipSkill(preset, skillId) {
    const r = await this._request('POST', '/player/preset_equip_skill', { preset, skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 预设卸下技能 */
  async presetUnequipSkill(preset, skillId) {
    const r = await this._request('POST', '/player/preset_unequip_skill', { preset, skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 预设设置KEY技能 */
  async presetSetKeySkill(preset, skillId) {
    const r = await this._request('POST', '/player/preset_set_key_skill', { preset, skill_id: skillId });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 重命名角色 */
  async renameCharacter(name) {
    const r = await this._request('POST', '/player/rename', { name });
    if (r.ok) this.player = r.player;
    return r;
  }

  /** 确认协议 */
  async agreementSeen() {
    const r = await this._request('POST', '/player/agreement_seen', {});
    if (r.ok) this.player = r.player;
    return r;
  }

  // ==================== 战斗接口 ====================

  /** 开始战斗 */
  async battleStart(mapId, pollMode = true, autoRestart = true) {
    const r = await this._request('POST', '/battle/start', {
      mapId, poll_mode: pollMode, auto_restart: autoRestart
    });
    if (r.ok && r.battleId) {
      this.activeBattle = { id: r.battleId, status: 'active' };
      this.battleSeq = 0;
    }
    return r;
  }

  /** 发送战斗指令 */
  async battleCommand(battleId, action, skillId = 0, itemId = 0) {
    this.battleSeq++;
    const r = await this._request('POST', '/battle/command', {
      battleId,
      seq: this.battleSeq,
      action,
      skill_id: skillId,
      item_id: itemId
    });
    if (r.ended) {
      this.activeBattle = null;
      if (r.player) this.player = r.player;
    }
    return r;
  }

  /** 轮询战斗状态（服务端驱动模式） */
  async battlePoll(afterIdx = 0, autoRestart = true) {
    const ar = autoRestart ? '1' : '0';
    const r = await this._request('GET', `/battle/poll?after=${afterIdx}&auto_restart=${ar}`);
    if (r.ended || !r.active) {
      this.activeBattle = null;
      if (r.player) this.player = r.player;
    }
    return r;
  }

  /** 查询战斗状态 */
  async battleState(battleId) {
    return await this._request('GET', `/battle/state/${battleId}`);
  }

  /** 设置自动战斗 */
  async battleSetAutoRestart(enabled, mapId = 0) {
    const body = { enabled: !!enabled };
    if (mapId > 0) body.map_id = mapId;
    return await this._request('POST', '/battle/auto_restart', body);
  }

  // ==================== 副本接口 ====================

  /** 获取副本列表 */
  async dungeonList() {
    return await this._request('GET', '/dungeon/list');
  }

  /** 副本详情 */
  async dungeonDetail(id) {
    return await this._request('GET', `/dungeon/${id}`);
  }

  /** 创建副本队伍 */
  async dungeonTeamCreate() {
    return await this._request('POST', '/dungeon/team/create', {});
  }

  /** 加入副本队伍 */
  async dungeonTeamJoin(teamCode) {
    return await this._request('POST', '/dungeon/team/join', { team_code: teamCode });
  }

  /** 查询副本队伍信息 */
  async dungeonTeamInfo(teamCode) {
    return await this._request('GET', `/dungeon/team/${encodeURIComponent(teamCode)}`);
  }

  /** 查询我的副本队伍 */
  async dungeonTeamMine() {
    return await this._request('GET', '/dungeon/team/mine');
  }

  /** 离开副本队伍 */
  async dungeonTeamLeave(teamCode) {
    return await this._request('POST', '/dungeon/team/leave', { team_code: teamCode });
  }

  /** 踢出副本队员 */
  async dungeonTeamKick(teamCode, targetAccountId) {
    return await this._request('POST', '/dungeon/team/kick', {
      team_code: teamCode,
      target_account_id: targetAccountId
    });
  }

  /** 开始副本战斗 */
  async dungeonBattleStart(dungeonId, teamCode = null, dungeonMode = 'normal', extra = null) {
    const body = {
      dungeon_id: dungeonId,
      dungeon_mode: dungeonMode,
      ...(teamCode ? { team_code: teamCode } : {})
    };
    if (extra && typeof extra === 'object') {
      if (extra.challenge_mode) body.challenge_mode = extra.challenge_mode;
      if (Array.isArray(extra.contract_modifiers)) {
        body.contract_modifiers = extra.contract_modifiers;
      }
    }
    return await this._request('POST', '/dungeon-battle/start', body);
  }

  /** 推进副本战斗 */
  async dungeonBattleAdvance(battleId, opts = null) {
    const stateMode = opts?.state === 'full' ? 'full' : 'lite';
    return await this._request('POST', `/dungeon-battle/advance?state=${stateMode}`, { battle_id: battleId });
  }

  // ==================== 城战接口 ====================

  /** 城战列表 */
  async cityDuelList(page = 1, pageSize = 30, keyword = '') {
    let q = `/dungeon-battle/city_duel/list?page=${page}&page_size=${pageSize}`;
    if (keyword) q += `&keyword=${encodeURIComponent(keyword)}`;
    return await this._request('GET', q);
  }

  /** 发起城战 */
  async cityDuelStart(targetAccountId) {
    return await this._request('POST', '/dungeon-battle/city_duel/start', { target_account_id: targetAccountId });
  }

  /** 查看城战对手信息 */
  async cityDuelInspect(targetAccountId) {
    return await this._request('GET', `/dungeon-battle/city_duel/inspect?target_account_id=${targetAccountId}`);
  }

  /** 城战日志 */
  async cityDuelLogs(page = 1, pageSize = 20, role = 'all') {
    return await this._request('GET', `/dungeon-battle/city_duel/logs?page=${page}&page_size=${pageSize}&role=${role}`);
  }

  /** 城战排行榜 */
  async cityDuelRank() {
    return await this._request('GET', '/dungeon-battle/city_duel/rank');
  }

  // ==================== 联赛接口 ====================

  /** 联赛状态 */
  async leagueStatus() {
    return await this._request('GET', '/league/status');
  }

  /** 创建联赛队伍 */
  async leagueTeamCreate(name) {
    return await this._request('POST', '/league/team/create', { name });
  }

  /** 加入联赛队伍 */
  async leagueTeamJoin(teamCode) {
    return await this._request('POST', '/league/team/join', { team_code: teamCode });
  }

  /** 离开联赛队伍 */
  async leagueTeamLeave() {
    return await this._request('POST', '/league/team/leave', {});
  }

  /** 联赛报名 */
  async leagueRegister(mode = 'team') {
    return await this._request('POST', '/league/register', { mode });
  }

  /** 取消单人报名 */
  async leagueCancelSoloRegister() {
    return await this._request('POST', '/league/register/cancel_solo', {});
  }

  /** 取消队伍报名 */
  async leagueCancelTeamRegister() {
    return await this._request('POST', '/league/register/cancel_team', {});
  }

  /** 设置联赛队伍技能 */
  async leagueTeamSkills(memberAccountId, equippedSkills, keySkillId) {
    return await this._request('POST', '/league/team/skills', {
      member_account_id: memberAccountId,
      equipped_skills: equippedSkills,
      key_skill_id: keySkillId
    });
  }

  /** 联赛排行榜 */
  async leagueLeaderboard(limit = 100) {
    return await this._request('GET', `/league/leaderboard?limit=${limit}`);
  }

  /** 联赛队伍排名 */
  async leagueTeamRank(weekStart = 0, limit = 100) {
    return await this._request('GET', `/league/team_rank?week_start=${weekStart}&limit=${limit}`);
  }

  /** 联赛比赛记录 */
  async leagueMatches(weekStart = 0, limit = 50) {
    return await this._request('GET', `/league/matches?week_start=${weekStart}&limit=${limit}`);
  }

  /** 联赛商店 */
  async leagueShop() {
    return await this._request('GET', '/league/shop');
  }

  /** 联赛商店购买 */
  async leagueShopBuy(itemId, quantity = 1) {
    return await this._request('POST', '/league/shop/buy', { item_id: itemId, quantity });
  }

  /** 触发联赛结算 */
  async leagueRunDue() {
    return await this._request('POST', '/league/run_due', {});
  }

  // ==================== 试炼接口 ====================

  /** 试炼契约列表 */
  async trialContracts() {
    return await this._request('GET', '/trial/contracts');
  }

  /** 试炼商店 */
  async trialShop() {
    return await this._request('GET', '/trial/shop');
  }

  /** 试炼商店购买 */
  async trialShopBuy(itemId, quantity = 1) {
    return await this._request('POST', '/trial/shop/buy', { item_id: itemId, quantity });
  }

  /** 开始试炼 */
  async trialStart() {
    return await this._request('POST', '/trial/start', {});
  }

  /** 推进试炼战斗 */
  async trialAdvance(battleId, opts = null) {
    const stateMode = opts?.state === 'full' ? 'full' : 'lite';
    return await this._request('POST', `/trial/advance?state=${stateMode}`, { battle_id: battleId });
  }

  // ==================== 邮件接口 ====================

  /** 获取邮件列表 */
  async mailList() {
    return await this._request('GET', '/mail/list');
  }

  /** 领取邮件 */
  async mailClaim(id) {
    return await this._request('POST', `/mail/claim/${id}`);
  }

  /** 一键领取所有邮件 */
  async mailClaimAll() {
    return await this._request('POST', '/mail/claim_all');
  }

  /** 删除已领取邮件 */
  async mailDeleteClaimed() {
    return await this._request('POST', '/mail/delete_claimed');
  }

  // ==================== 炼丹接口 ====================

  /** 开始炼丹 */
  async alchemyStart(ingredients, batchCount = 1) {
    return await this._request('POST', '/online/alchemy/start', {
      selected_ingredients: ingredients, batch_count: batchCount
    });
  }

  // ==================== 锻造接口 ====================

  /** 开始锻造 */
  async forgingStart(equipType, mainItemId, mainCount, lingItemId, catalystItemId) {
    return await this._request('POST', '/online/forging/start', {
      equip_type: equipType,
      main_item_id: mainItemId,
      main_count: mainCount,
      ling_item_id: lingItemId,
      catalyst_item_id: catalystItemId
    });
  }

  /** 锻造升级 */
  async forgingUpgrade(equipPage, equipSlot, materialItemId, materialCount, mode, expectItemId = 0) {
    return await this._request('POST', '/online/forging/upgrade', {
      equip_page: equipPage, equip_slot: equipSlot,
      material_item_id: materialItemId, material_count: materialCount,
      mode, expect_item_id: expectItemId
    });
  }

  /** 锻造词条升级 */
  async forgingUpgradeAffix(equipPage, equipSlot, affixIndex, materialItemId, materialCount, mode, affixMode = 'upgrade', expectItemId = 0) {
    return await this._request('POST', '/online/forging/upgrade_affix', {
      equip_page: equipPage, equip_slot: equipSlot,
      affix_index: affixIndex,
      material_item_id: materialItemId, material_count: materialCount,
      mode, affix_mode: affixMode, expect_item_id: expectItemId
    });
  }

  /** 锻造重铸 */
  async forgingReroll(equipPage, equipSlot, lingItemId, lockIndices = [], expectItemId = 0) {
    return await this._request('POST', '/online/forging/reroll', {
      equip_page: equipPage, equip_slot: equipSlot,
      ling_item_id: lingItemId,
      lock_indices: lockIndices, expect_item_id: expectItemId
    });
  }

  /** 锻造词条等阶重铸 */
  async forgingRerollAffixTier(equipPage, equipSlot, affixIndex, materialItemId, expectItemId = 0) {
    return await this._request('POST', '/online/forging/reroll_affix_tier', {
      equip_page: equipPage, equip_slot: equipSlot,
      affix_index: affixIndex,
      material_item_id: materialItemId, expect_item_id: expectItemId
    });
  }

  /** 锻造继承 */
  async forgingInherit(sourceEquipPage, sourceEquipSlot, targetEquipPage, targetEquipSlot, materialItemId, expectSourceItemId = 0, expectTargetItemId = 0) {
    return await this._request('POST', '/online/forging/inherit', {
      source_equip_page: sourceEquipPage, source_equip_slot: sourceEquipSlot,
      target_equip_page: targetEquipPage, target_equip_slot: targetEquipSlot,
      material_item_id: materialItemId,
      expect_source_item_id: expectSourceItemId,
      expect_target_item_id: expectTargetItemId
    });
  }

  /** 锻造造化 */
  async forgingZaohua(equipPage, equipSlot, expectItemId = 0) {
    return await this._request('POST', '/online/forging/zaohua', {
      equip_page: equipPage, equip_slot: equipSlot, expect_item_id: expectItemId
    });
  }

  // ==================== 百艺·制作接口 ====================

  /** 百艺制作 */
  async baiyiCraftStart(recipeId, batchCount = 1) {
    return await this._request('POST', '/online/baiyi/craft/start', {
      recipe_id: recipeId, batch_count: batchCount
    });
  }

  /** 百艺阵盘 */
  async baiyiArrayStart(arrayType) {
    return await this._request('POST', '/online/baiyi/array/start', { array_type: arrayType });
  }

  /** 兑换码 */
  async redeem(code) {
    return await this._request('POST', '/online/redeem', { code });
  }

  /** 城市购买 */
  async cityBuy(itemId, count = 1) {
    return await this._request('POST', '/online/city/buy', { item_id: itemId, count });
  }

  // ==================== 洞府接口 ====================

  /** 洞府状态 */
  async caveStatus() {
    return await this._request('GET', '/online/cave/status');
  }

  /** 开始洞府采集 */
  async caveStart(type) {
    return await this._request('POST', '/online/cave/start', { type });
  }

  /** 停止洞府采集 */
  async caveStop() {
    return await this._request('POST', '/online/cave/stop', {});
  }

  /** 升级洞府 */
  async caveUpgrade() {
    return await this._request('POST', '/online/cave/upgrade', {});
  }

  /** 放置阵盘 */
  async caveFormationPlace(pieceUid, targetIndex) {
    return await this._request('POST', '/online/cave/formation/place', {
      piece_uid: pieceUid, target_index: targetIndex
    });
  }

  /** 拾取阵盘 */
  async caveFormationPick(sourceIndex) {
    return await this._request('POST', '/online/cave/formation/pick', { source_index: sourceIndex });
  }

  /** 移动阵盘 */
  async caveFormationMove(fromIndex, toIndex) {
    return await this._request('POST', '/online/cave/formation/move', {
      from_index: fromIndex, to_index: toIndex
    });
  }

  /** 旋转阵盘 */
  async caveFormationRotate(sourceIndex, turns = 1) {
    return await this._request('POST', '/online/cave/formation/rotate', {
      source_index: sourceIndex, turns
    });
  }

  /** 清空阵盘 */
  async caveFormationClear() {
    return await this._request('POST', '/online/cave/formation/clear', {});
  }

  /** 分解阵盘（阵盘碎片） */
  async caveFormationDecomposePlate(pieceUid) {
    return await this._request('POST', '/online/cave/formation/decompose_plate', { piece_uid: pieceUid });
  }

  /** 分解阵盘（符文碎片） */
  async caveFormationDecomposeRune(pieceUid) {
    return await this._request('POST', '/online/cave/formation/decompose_rune', { piece_uid: pieceUid });
  }

  /** 设置阵法服务 */
  async caveFormationServiceSet(skillId, active, instanceKey = '') {
    return await this._request('POST', '/online/cave/formation/service/set', {
      skill_id: skillId, instance_key: instanceKey, active: !!active
    });
  }

  // ==================== 传人接口 ====================

  /** 传人状态 */
  async discipleStatus() {
    return await this._request('GET', '/online/disciple/status');
  }

  /** 创建传人 */
  async discipleCreate(name) {
    return await this._request('POST', '/online/disciple/create', { name });
  }

  /** 重命名传人 */
  async discipleRename(name) {
    return await this._request('POST', '/online/disciple/rename', { name });
  }

  /** 传人装备 */
  async discipleEquip(slot, page, slotIndex) {
    return await this._request('POST', '/online/disciple/equip', { slot, page, slotIndex });
  }

  /** 传人卸下装备 */
  async discipleUnequip(slot) {
    return await this._request('POST', '/online/disciple/unequip', { slot });
  }

  /** 派遣传人 */
  async discipleSend(mapId, materialFilter) {
    return await this._request('POST', '/online/disciple/send', {
      map_id: mapId, material_filter: materialFilter
    });
  }

  /** 召回传人 */
  async discipleRecall() {
    return await this._request('POST', '/online/disciple/recall', {});
  }

  /** 传人斗法状态 */
  async discipleBattleStatus() {
    return await this._request('GET', '/online/disciple-battle/status');
  }

  /** 传人斗法抽卡 */
  async discipleBattleDraw() {
    return await this._request('POST', '/online/disciple-battle/draw', {});
  }

  /** 传人斗法装备技能 */
  async discipleBattleEquip(slotIndex, sourceId) {
    return await this._request('POST', '/online/disciple-battle/equip', { slotIndex, sourceId });
  }

  /** 传人斗法卸下技能 */
  async discipleBattleUnequip(slotIndex) {
    return await this._request('POST', '/online/disciple-battle/unequip', { slotIndex });
  }

  /** 传人斗法商店购买丹药 */
  async discipleBattleShopBuy(pillId) {
    return await this._request('POST', '/online/disciple-battle/shop/buy', { pillId });
  }

  /** 传人斗法积分商店购买 */
  async discipleBattlePointsShopBuy(itemId) {
    return await this._request('POST', '/online/disciple-battle/points-shop/buy', { itemId });
  }

  /** 传人斗法匹配 */
  async discipleBattleMatch() {
    return await this._request('POST', '/online/disciple-battle/match', {});
  }

  /** 取消传人斗法匹配 */
  async discipleBattleCancelMatch() {
    return await this._request('POST', '/online/disciple-battle/cancel-match', {});
  }

  /** 传人斗法房间信息 */
  async discipleBattleRoom(roomId) {
    return await this._request('GET', `/online/disciple-battle/room/${roomId}`);
  }

  /** 传人斗法出招 */
  async discipleBattleAction(roomId, skillSourceId) {
    return await this._request('POST', '/online/disciple-battle/action', { roomId, skillSourceId });
  }

  // ==================== 宗门接口 ====================

  /** 加入宗门 */
  async sectJoin(sectId) {
    return await this._request('POST', '/online/sect/join', { sect_id: sectId });
  }

  /** 离开宗门 */
  async sectLeave() {
    return await this._request('POST', '/online/sect/leave', {});
  }

  /** 宗门成员数量 */
  async sectMemberCounts() {
    return await this._request('GET', '/online/sect/member_counts');
  }

  /** 宗门贡献 */
  async sectContribute(itemId, count) {
    return await this._request('POST', '/online/sect/contribute', { item_id: itemId, count });
  }

  /** 宗门学习 */
  async sectLearn(type, id, cost, levelReq, needBasicGe3, needIntermediateGe4) {
    return await this._request('POST', '/online/sect/learn', {
      type, id, cost, level_req: levelReq,
      need_basic_ge3: needBasicGe3, need_intermediate_ge4: needIntermediateGe4
    });
  }

  /** 宗门宝库列表 */
  async sectTreasuryList() {
    return await this._request('GET', '/online/sect/treasury/list');
  }

  /** 刷新宗门宝库 */
  async sectTreasuryRefresh() {
    return await this._request('POST', '/online/sect/treasury/refresh', {});
  }

  /** 宗门宝库购买 */
  async sectTreasuryBuy(index, count = 1) {
    return await this._request('POST', '/online/sect/treasury/buy', { index, count });
  }

  /** 宗门宝库购买基础武器 */
  async sectTreasuryBuyBasicWeapon() {
    return await this._request('POST', '/online/sect/treasury/buy_basic_weapon', {});
  }

  /** 宗门宝库购买基础防具 */
  async sectTreasuryBuyBasicArmor(armorType) {
    return await this._request('POST', '/online/sect/treasury/buy_basic_armor', { armor_type: armorType });
  }

  /** 宗门论道殿选择 */
  async sectLundaodianSelect(sectId) {
    return await this._request('POST', '/online/sect/lundaodian/select', { sect_id: sectId });
  }

  /** 宗门论道殿学习 */
  async sectLundaodianLearn(type, id) {
    return await this._request('POST', '/online/sect/lundaodian/learn', { type, id });
  }

  /** 宗门任务列表 */
  async sectTasks() {
    return await this._request('GET', '/online/sect/tasks');
  }

  /** 刷新宗门任务 */
  async sectTaskRefresh() {
    return await this._request('POST', '/online/sect/tasks/refresh', {});
  }

  /** 接受宗门任务 */
  async sectTaskAccept(slotIndex) {
    return await this._request('POST', '/online/sect/tasks/accept', { slot_index: slotIndex });
  }

  /** 放弃宗门任务 */
  async sectTaskAbandon(slotIndex) {
    return await this._request('POST', '/online/sect/tasks/abandon', { slot_index: slotIndex });
  }

  /** 完成宗门任务 */
  async sectTaskComplete(slotIndex) {
    return await this._request('POST', '/online/sect/tasks/complete', { slot_index: slotIndex });
  }

  // ==================== 联盟接口 ====================

  /** 联盟列表 */
  async allianceList() {
    return await this._request('GET', '/alliance/list');
  }

  /** 创建联盟 */
  async allianceCreate(name, description) {
    return await this._request('POST', '/alliance/create', { name, description });
  }

  /** 申请加入联盟 */
  async allianceApply(allianceId) {
    return await this._request('POST', '/alliance/apply', { alliance_id: allianceId });
  }

  /** 联盟详情 */
  async allianceDetail(allianceId) {
    return await this._request('GET', `/alliance/detail/${allianceId}`);
  }

  /** 离开联盟 */
  async allianceLeave() {
    return await this._request('POST', '/alliance/leave', {});
  }

  /** 联盟捐赠 */
  async allianceDonate(allianceId, page, slotIndex, count, expectItemId = 0) {
    return await this._request('POST', '/alliance/donate', {
      alliance_id: allianceId, page, slot_index: slotIndex,
      count, expect_item_id: expectItemId
    });
  }

  /** 联盟神像祈福 */
  async allianceBless(allianceId, times = 1) {
    return await this._request('POST', '/alliance/statue/bless', { alliance_id: allianceId, times });
  }

  /** 联盟灵池沐浴 */
  async allianceBathe(allianceId) {
    return await this._request('POST', '/alliance/spirit_pool/bathe', { alliance_id: allianceId });
  }

  /** 联盟药园采摘 */
  async allianceGardenPick(allianceId) {
    return await this._request('POST', '/alliance/garden/pick', { alliance_id: allianceId });
  }

  /** 联盟悟道树冥想 */
  async allianceMeditate(allianceId) {
    return await this._request('POST', '/alliance/enlightenment_tree/meditate', { alliance_id: allianceId });
  }

  /** 联盟建筑列表 */
  async allianceBuildings(allianceId) {
    return await this._request('GET', `/alliance/buildings/${allianceId}`);
  }

  /** 联盟建筑升级 */
  async allianceBuildingUpgrade(allianceId, building) {
    return await this._request('POST', '/alliance/buildings/upgrade', { alliance_id: allianceId, building });
  }

  /** 联盟宝库列表 */
  async allianceTreasuryList(allianceId) {
    return await this._request('GET', `/alliance/treasury/list/${allianceId}`);
  }

  /** 联盟宝库购买 */
  async allianceTreasuryBuy(allianceId, itemId, count = 1) {
    return await this._request('POST', '/alliance/treasury/buy', {
      alliance_id: allianceId, item_id: itemId, count
    });
  }

  /** 联盟仓库列表 */
  async allianceWarehouse(allianceId) {
    return await this._request('GET', `/alliance/warehouse/${allianceId}`);
  }

  /** 联盟仓库存入 */
  async allianceWarehouseDeposit(allianceId, page, slotIndex, count, expectItemId = 0) {
    return await this._request('POST', '/alliance/warehouse/deposit', {
      alliance_id: allianceId, page, slot_index: slotIndex,
      count, expect_item_id: expectItemId
    });
  }

  /** 联盟仓库取出 */
  async allianceWarehouseWithdraw(allianceId, warehousePage, warehouseSlotIndex, count) {
    return await this._request('POST', '/alliance/warehouse/withdraw', {
      alliance_id: allianceId,
      warehouse_page: warehousePage,
      warehouse_slot_index: warehouseSlotIndex,
      count
    });
  }

  /** 联盟仓库升级 */
  async allianceWarehouseUpgrade(allianceId) {
    return await this._request('POST', '/alliance/warehouse/upgrade', { alliance_id: allianceId });
  }

  // ==================== 交易所接口 ====================

  /** 查询交易所挂单 */
  async exchangeListings(page = 1, pageSize = 20, filters = {}) {
    let q = `/exchange/listings?page=${page}&page_size=${pageSize}`;
    for (const k of ['side', 'keyword', 'sort_by', 'category', 'subtype']) {
      if (filters[k] && filters[k] !== 'all') q += `&${k}=${encodeURIComponent(filters[k])}`;
    }
    for (const k of ['item_id', 'min_price', 'max_price']) {
      if (filters[k] > 0) q += `&${k}=${filters[k]}`;
    }
    if (Number(filters.quality) > 0) q += `&quality=${Math.floor(Number(filters.quality))}`;
    return await this._request('GET', q);
  }

  /** 我的挂单 */
  async exchangeMyListings() {
    return await this._request('GET', '/exchange/my/listings');
  }

  /** 创建挂单 */
  async exchangeCreateListing(page, slotIndex, quantity, unitPrice, expectItemId = 0) {
    return await this._request('POST', '/exchange/listings', {
      page, slot_index: slotIndex, quantity,
      unit_price: unitPrice, expect_item_id: expectItemId
    });
  }

  /** 交易所报价查询 */
  async exchangeQuote(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '') continue;
      qs.append(k, String(v));
    }
    return await this._request('GET', `/exchange/quote?${qs.toString()}`);
  }

  /** 购买交易所物品 */
  async exchangeBuy(listingId, quantity = 1, marketToken = '') {
    const body = { listing_id: listingId, quantity };
    const headers = {};
    if (marketToken) headers['X-Market-Token'] = marketToken;
    return await this._request('POST', '/exchange/buy', body, headers);
  }

  /** 取消挂单 */
  async exchangeCancelListing(listingId) {
    return await this._request('POST', `/exchange/listings/${listingId}/cancel`, {});
  }

  /** 交易所物品搜索 */
  async exchangeItemSearch(q) {
    return await this._request('GET', `/exchange/item_search?q=${encodeURIComponent(q)}`);
  }

  /** 创建买单 */
  async exchangeBuyOrders(itemIdOrPayload, itemName, quantity, unitPrice, options = {}) {
    if (itemIdOrPayload && typeof itemIdOrPayload === 'object' && !Array.isArray(itemIdOrPayload)) {
      return await this._request('POST', '/exchange/buy_orders', itemIdOrPayload);
    }
    const payload = {
      item_id: itemIdOrPayload || 0, item_name: itemName,
      quantity, unit_price: unitPrice
    };
    if (Number(options?.barter_pay_item_id) > 0) payload.barter_pay_item_id = Number(options.barter_pay_item_id);
    if (Number(options?.barter_pay_unit_count) > 0) payload.barter_pay_unit_count = Number(options.barter_pay_unit_count);
    return await this._request('POST', '/exchange/buy_orders', payload);
  }

  /** 履行买单 */
  async exchangeFulfillBuy(listingId, quantity, marketToken = '') {
    const body = { listing_id: listingId, quantity };
    const headers = {};
    if (marketToken) headers['X-Market-Token'] = marketToken;
    return await this._request('POST', '/exchange/fulfill_buy', body, headers);
  }

  /** 装备买单 */
  async exchangeEquipBuyOrder(itemName, quantity, unitPrice, equipmentCriteria) {
    return await this._request('POST', '/exchange/buy_orders', {
      item_name: itemName, quantity, unit_price: unitPrice,
      equipment_criteria: equipmentCriteria
    });
  }

  /** 履行装备买单 */
  async exchangeFulfillBuyEquip(listingId, page, slotIndex, expectItemId = 0, marketToken = '') {
    const body = {
      listing_id: listingId, page, slot_index: slotIndex,
      expect_item_id: expectItemId
    };
    const headers = {};
    if (marketToken) headers['X-Market-Token'] = marketToken;
    return await this._request('POST', '/exchange/fulfill_buy', body, headers);
  }

  // ==================== 聊天接口 ====================

  /** 获取聊天消息 */
  async chatMessages(channel, since = 0, allianceId = 0) {
    let q = `/chat/messages?channel=${encodeURIComponent(channel)}&since=${since}`;
    if (channel === 'alliance' && allianceId > 0) q += `&alliance_id=${allianceId}`;
    return await this._request('GET', q);
  }

  /** 发送聊天消息 */
  async chatSend(channel, text) {
    return await this._request('POST', '/chat/send', { channel, text });
  }

  // ==================== 邀请接口 ====================

  /** 邀请信息 */
  async inviteInfo() {
    return await this._request('GET', '/invite/info');
  }

  /** 生成邀请码 */
  async inviteGenerate() {
    return await this._request('POST', '/invite/generate', {});
  }

  /** 绑定邀请码 */
  async inviteBind(code) {
    return await this._request('POST', '/invite/bind', { invite_code: code });
  }

  /** 邀请灵石存储 */
  async inviteStorage(storedStones, perPersonStones) {
    return await this._request('POST', '/invite/storage', {
      stored_stones: storedStones, per_person_stones: perPersonStones
    });
  }

  /** 邀请列表 */
  async inviteInvitees() {
    return await this._request('GET', '/invite/invitees');
  }

  /** 领取邀请积分 */
  async inviteClaimPoints(inviteeAccountId) {
    return await this._request('POST', '/invite/claim_points', { invitee_account_id: inviteeAccountId });
  }

  /** 补发邀请奖励 */
  async inviteReissue(inviteeAccountId) {
    return await this._request('POST', '/invite/reissue', { invitee_account_id: inviteeAccountId });
  }

  /** 邀请商店列表 */
  async inviteShopList() {
    return await this._request('GET', '/invite/shop');
  }

  /** 邀请商店购买 */
  async inviteShopBuy(itemId, count = 1) {
    return await this._request('POST', '/invite/shop/buy', { item_id: itemId, count });
  }

  // ==================== 邮箱绑定接口 ====================

  /** 邮箱状态 */
  async emailStatus() {
    return await this._request('GET', '/email/status');
  }

  /** 发送邮箱验证码 */
  async emailSendCode(email) {
    return await this._request('POST', '/email/send-code', { email });
  }

  /** 绑定邮箱 */
  async emailBind(email, code) {
    return await this._request('POST', '/email/bind', { email, code });
  }

  /** 解绑邮箱 */
  async emailUnbind() {
    return await this._request('POST', '/email/unbind', {});
  }

  /** 忘记密码发送验证码 */
  async forgotPasswordSendCode(email) {
    return await this._request('POST', '/email/forgot-password/send-code', { email });
  }

  /** 忘记密码重置 */
  async forgotPasswordReset(email, code, newPassword) {
    return await this._request('POST', '/email/forgot-password/reset', {
      email, code, new_password: newPassword
    });
  }

  /** 修改密码发送验证码 */
  async changePasswordSendCode() {
    return await this._request('POST', '/email/change-password/send-code', {});
  }

  /** 修改密码确认 */
  async changePasswordConfirm(code, newPassword) {
    return await this._request('POST', '/email/change-password/confirm', {
      code, new_password: newPassword
    });
  }

  // ==================== 游戏数据 ====================

  /** 获取游戏静态数据 */
  async getGameData(force = false) {
    if (this.gameData && !force) return this.gameData;
    const r = await this._request('GET', '/game-data');
    if (r.ok) this.gameData = r.data;
    return this.gameData;
  }

  /** 获取玩家战斗属性摘要 */
  getCombatSummary() {
    if (!this.player) return null;
    return {
      level: this.player.level || 1,
      hp: this.player.hp || 0,
      max_hp: this.player.max_hp || 0,
      mp: this.player.mp || 0,
      max_mp: this.player.max_mp || 0,
      exp: this.player.exp || 0,
      max_exp: this.player.max_exp || 0,
      spirit_stones: this.player.spirit_stones || 0,
      attack: this.player.min_phys_damage || 0,
      defense: this.player.phys_defense || 0,
      spell_attack: this.player.min_spell_attack || 0,
      spell_defense: this.player.spell_defense || 0,
      strength: this.player.strength || 0,
      constitution: this.player.constitution || 0,
      agility: this.player.agility || 0,
      zhenyuan: this.player.zhenyuan || 0
    };
  }

  /** 获取背包物品列表 */
  getInventory() {
    if (!this.player || !this.player.inventory) return [];
    const items = [];
    for (let p = 0; p < this.player.inventory.length; p++) {
      const page = this.player.inventory[p];
      if (!Array.isArray(page)) continue;
      for (let s = 0; s < page.length; s++) {
        const slot = page[s];
        if (slot && slot.item) {
          items.push({
            page: p,
            slot: s,
            item: slot.item,
            count: slot.count || 1,
            id: slot.item.id,
            name: slot.item.name,
            type: slot.item.type,
            quality: slot.item.quality || 1
          });
        }
      }
    }
    return items;
  }

  /** 获取装备的技能列表 */
  getEquippedSkills() {
    if (!this.player || !this.player.equipped_skills) return [];
    return this.player.equipped_skills;
  }

  /** 获取玩家等级区间对应的推荐地图 */
  getRecommendedMap() {
    const level = this.player ? (this.player.level || 1) : 1;
    if (!this.gameData || !this.gameData.maps) return 1;
    
    const maps = this.gameData.maps;
    let bestMap = maps[0];
    for (const map of maps) {
      if (map.level <= level && map.level > (bestMap?.level || 0)) {
        bestMap = map;
      }
    }
    return bestMap ? bestMap.id : 1;
  }

  /** 获取玩家洞府状态摘要 */
  getCaveSummary() {
    if (!this.player || !this.player.cave) {
      return { hasCave: false, level: 0, resource: 0, formationActive: false };
    }
    return this.player.cave;
  }

  /** 获取玩家宗门信息摘要 */
  getSectSummary() {
    if (!this.player) return null;
    return {
      sect_id: this.player.sect_id || 0,
      sect_name: this.player.sect_name || '',
      sect_contribution: this.player.sect_contribution || 0,
      sect_rank: this.player.sect_rank || 0
    };
  }

  /** 获取玩家联盟信息摘要 */
  getAllianceSummary() {
    if (!this.player) return null;
    return {
      alliance_id: this.player.alliance_id || 0,
      alliance_name: this.player.alliance_name || '',
      alliance_rank: this.player.alliance_rank || 0
    };
  }

  /** 获取玩家传人信息摘要 */
  getDiscipleSummary() {
    if (!this.player || !this.player.disciple) {
      return { hasDisciple: false, count: 0, battleActive: false };
    }
    return this.player.disciple;
  }

  /** 获取玩家在线收益摘要 */
  getOnlineSummary() {
    if (!this.player || !this.player.baiyi) return null;
    return this.player.baiyi;
  }
}

module.exports = GameClient;