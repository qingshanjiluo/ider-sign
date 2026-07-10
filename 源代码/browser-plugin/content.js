/**
 * 艾德尔修仙传 AI 插件 - Content Script
 * 注入到游戏页面，负责状态提取和动作执行
 *
 * 功能：
 * 1. 从页面DOM/全局变量提取玩家状态（50维特征向量）
 * 2. 拦截API请求获取完整游戏数据
 * 3. 接收popup消息并执行游戏动作（点击按钮、导航等）
 * 4. 暴露 window.__AI_PLUGIN__ 接口供插件内部通信
 */

(function() {
  'use strict';

  // ==================== 状态提取器 ====================

  class GameStateExtractor {
    constructor() {
      this.lastState = null;
      this.apiInterceptor = null;
      this._initialized = false;
    }

    /**
     * 从DOM提取玩家状态（50维特征向量）
     * 返回值与 game_environment.js 的 getState() 格式一致
     */
    extractFromDOM() {
      try {
        const state = new Array(50).fill(0);

        // 优先从页面全局变量获取（Vue/React 应用通常有 __INITIAL_STATE__）
        if (window.__INITIAL_STATE__) {
          return this._extractFromVue(window.__INITIAL_STATE__);
        }
        if (window.__NUXT__) {
          return this._extractFromNuxt(window.__NUXT__);
        }
        if (window.__NEXT_DATA__) {
          return this._extractFromNext(window.__NEXT_DATA__);
        }
        if (window.store && window.store.state) {
          return this._extractFromVue(window.store.state);
        }

        // 从DOM元素提取（通用方案）
        // 等级
        const levelEl = this._findElement(['class*="level"', 'class*="等级"', 'class*="lv"', 'id*="level"', 'id*="等级"']);
        if (levelEl) {
          const match = levelEl.textContent.match(/(\d+)/);
          if (match) state[0] = parseInt(match[1]) / 400;
        }

        // HP
        const hpEl = this._findElement(['class*="hp"', 'class*="HP"', 'class*="气血"', 'class*="health"']);
        if (hpEl) {
          const match = hpEl.textContent.match(/(\d+)\s*[\/|]\s*(\d+)/);
          if (match) state[2] = parseInt(match[1]) / Math.max(1, parseInt(match[2]));
        }

        // MP
        const mpEl = this._findElement(['class*="mp"', 'class*="MP"', 'class*="灵力"', 'class*="mana"']);
        if (mpEl) {
          const match = mpEl.textContent.match(/(\d+)\s*[\/|]\s*(\d+)/);
          if (match) state[3] = parseInt(match[1]) / Math.max(1, parseInt(match[2]));
        }

        // 灵石
        const stoneEl = this._findElement(['class*="stone"', 'class*="灵石"', 'class*="spirit"', 'class*="money"']);
        if (stoneEl) {
          const match = stoneEl.textContent.match(/([\d.]+)/);
          if (match) state[12] = Math.min(1, parseFloat(match[1]) / 100000);
        }

        // 战力/攻击
        const powerEl = this._findElement(['class*="power"', 'class*="战力"', 'class*="combat"', 'class*="attack"', 'class*="atk"']);
        if (powerEl) {
          const match = powerEl.textContent.match(/([\d.]+)/);
          if (match) state[4] = Math.min(1, parseFloat(match[1]) / 10000);
        }

        // 防御
        const defEl = this._findElement(['class*="def"', 'class*="防御"', 'class*="defense"']);
        if (defEl) {
          const match = defEl.textContent.match(/([\d.]+)/);
          if (match) state[5] = Math.min(1, parseFloat(match[1]) / 10000);
        }

        // 地图
        const mapEl = this._findElement(['class*="map"', 'class*="地图"', 'class*="scene"']);
        if (mapEl) {
          const match = mapEl.textContent.match(/(\d+)/);
          if (match) state[24] = parseInt(match[1]) / 27;
        }

        // 经验
        const expEl = this._findElement(['class*="exp"', 'class*="经验"', 'class*="experience"']);
        if (expEl) {
          const match = expEl.textContent.match(/(\d+)\s*[\/|]\s*(\d+)/);
          if (match) state[1] = parseInt(match[1]) / Math.max(1, parseInt(match[2]));
        }

        // 境界
        const realmEl = this._findElement(['class*="realm"', 'class*="境界"', 'class*="rank"']);
        if (realmEl) {
          const match = realmEl.textContent.match(/(\d+)/);
          if (match) state[38] = parseInt(match[1]) / 10;
        }

        // 宗门
        const sectEl = this._findElement(['class*="sect"', 'class*="宗门"', 'class*="faction"']);
        if (sectEl && sectEl.textContent.length > 2) state[32] = 1;

        // 联盟
        const leagueEl = this._findElement(['class*="league"', 'class*="联盟"', 'class*="alliance"']);
        if (leagueEl && leagueEl.textContent.length > 2) state[33] = 1;

        this.lastState = state;
        window.__GAME_STATE__ = state;
        return state;
      } catch (e) {
        console.warn('[AI Plugin] DOM提取失败:', e);
        return this.lastState || new Array(50).fill(0);
      }
    }

    /** 根据CSS选择器列表查找元素 */
    _findElement(selectors) {
      for (const sel of selectors) {
        try {
          // 尝试属性选择器
          const el = document.querySelector(`[${sel}]`);
          if (el) return el;
        } catch (e) {
          // 尝试文本内容查找
          const all = document.querySelectorAll('div, span, p, label, h1, h2, h3, h4, h5');
          for (const el of all) {
            const cls = (el.className || '') + ' ' + (el.id || '');
            const keyword = sel.replace(/class\*="/, '').replace(/"/g, '').replace(/id\*="/, '');
            if (cls.toLowerCase().includes(keyword.toLowerCase())) {
              return el;
            }
          }
        }
      }
      return null;
    }

    /** 从Vue初始状态提取 */
    _extractFromVue(state) {
      const s = new Array(50).fill(0);
      try {
        // 尝试多种可能的 player 数据结构
        const p = state.player || state.user || state.character || state.hero || {};
        if (Object.keys(p).length === 0) return this.extractFromDOM();

        s[0] = (p.level || 1) / 400;
        s[1] = (p.exp || 0) / Math.max(1, p.maxExp || p.expNext || 1);
        s[2] = (p.hp || p.health || 1) / Math.max(1, p.maxHp || p.maxHealth || 1);
        s[3] = (p.mp || p.mana || 0) / Math.max(1, p.maxMp || p.maxMana || 1);
        s[4] = Math.min(1, (p.attack || p.atk || 0) / 10000);
        s[5] = Math.min(1, (p.defense || p.def || 0) / 10000);
        s[6] = Math.min(1, (p.spellAttack || p.matk || 0) / 10000);
        s[7] = Math.min(1, (p.spellDefense || p.mdef || 0) / 10000);
        s[8] = Math.min(1, (p.strength || p.str || 0) / 1000);
        s[9] = Math.min(1, (p.constitution || p.con || 0) / 1000);
        s[10] = Math.min(1, (p.agility || p.agi || 0) / 1000);
        s[11] = Math.min(1, (p.spirit || p.spr || 0) / 1000);
        s[12] = Math.min(1, (p.spiritStones || p.stones || p.gold || 0) / 100000);
        s[13] = (p.maxHp || p.maxHealth || 1) / 10000;
        s[14] = (p.maxMp || p.maxMana || 1) / 10000;
        s[15] = Math.min(1, (p.equipmentCount || p.equipCount || 0) / 20);
        s[16] = Math.min(1, (p.skillCount || 0) / 20);
        s[17] = Math.min(1, (p.potionCount || 0) / 50);
        s[18] = Math.min(1, (p.materialCount || 0) / 100);
        s[19] = Math.min(1, (p.forgeMaterial || 0) / 50);
        s[20] = p.hasHealSkill ? 1 : 0;
        s[21] = p.hasAttackSkill ? 1 : 0;
        s[22] = Math.min(3, (p.equippedSkills || 0)) / 3;
        s[23] = (p.mapLevel || 1) / 27;
        s[24] = (p.mapId || 1) / 27;
        s[25] = p.winRate || 0.5;
        s[26] = Math.min(1, (p.winStreak || 0) / 10);
        s[27] = Math.min(1, (p.loseStreak || 0) / 10);
        s[28] = p.lastBattleWon ? 1 : 0;
        s[29] = Math.min(1, (p.stepProgress || 0) / 100);
        s[30] = p.canBreakthrough ? 1 : 0;
        s[31] = p.isResting ? 1 : 0;
        s[32] = p.sectId ? 1 : 0;
        s[33] = p.allianceId || p.leagueId ? 1 : 0;
        s[34] = p.hasCave ? 1 : 0;
        s[35] = p.hasDisciple ? 1 : 0;
        s[36] = p.hasActiveQuest ? 1 : 0;
        s[37] = p.autoBattle ? 1 : 0;
        s[38] = (p.realm || 0) / 10;
        s[39] = (p.realmLevel || 0) / 10;
        s[40] = Math.min(1, (p.sectContribution || 0) / 10000);
        s[41] = Math.min(1, (p.trialCoins || 0) / 5000);
        s[42] = Math.min(1, (p.leagueScore || 0) / 5000);
        s[43] = Math.min(1, (p.caveLevel || 0) / 10);
        s[44] = Math.min(1, (p.caveResources || 0) / 10000);
        s[45] = Math.min(1, (p.destinyPoints || 0) / 1000);
        s[46] = Math.min(1, (p.talentPoints || 0) / 1000);
        s[47] = Math.min(1, (p.invitePoints || 0) / 1000);
        s[48] = Math.min(1, (p.discipleTrialScore || 0) / 5000);
        s[49] = Math.min(1, (p.leaguePoints || 0) / 5000);
      } catch (e) {
        console.warn('[AI Plugin] Vue状态提取失败:', e);
      }

      this.lastState = s;
      window.__GAME_STATE__ = s;
      return s;
    }

    /** 从Nuxt状态提取 */
    _extractFromNuxt(nuxtState) {
      return this._extractFromVue(nuxtState.state || nuxtState);
    }

    /** 从Next.js状态提取 */
    _extractFromNext(nextData) {
      return this._extractFromVue(nextData.props?.pageProps || nextData);
    }

    /**
     * 拦截API响应以获取完整状态
     * 通过重写 fetch 和 XMLHttpRequest 来捕获游戏数据
     */
    startApiInterception() {
      if (this._initialized) return;
      this._initialized = true;

      // 拦截 fetch
      const originalFetch = window.fetch;
      const self = this;
      window.fetch = function(...args) {
        return originalFetch.apply(this, args).then(async response => {
          const clone = response.clone();
          try {
            const data = await clone.json();
            // 检测包含玩家数据的响应
            if (data && (data.player || data.user || data.character)) {
              self._extractFromVue({
                player: data.player || data.user || data.character
              });
            }
            // 检测战斗结果
            if (data && (data.battleResult || data.battle)) {
              const br = data.battleResult || data.battle;
              if (br.won !== undefined) {
                const state = self.extractFromDOM();
                state[28] = br.won ? 1 : 0;
                window.__GAME_STATE__ = state;
              }
            }
          } catch (e) {
            // 非JSON响应忽略
          }
          return response;
        });
      };

      // 拦截 XMLHttpRequest
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const self2 = this;

      XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._method = method;
        return originalOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        this.addEventListener('load', function() {
          try {
            const data = JSON.parse(this.responseText);
            if (data && (data.player || data.user || data.character)) {
              self2._extractFromVue({
                player: data.player || data.user || data.character
              });
            }
          } catch (e) {}
        });
        return originalSend.apply(this, arguments);
      };

      console.log('[AI Plugin] API拦截已启动');
    }
  }

  // ==================== 动作执行器 ====================

  class ActionExecutor {
    constructor() {
      this.lastActionTime = 0;
      this.minInterval = 500; // 最小动作间隔(ms)
      this.actionHistory = [];
    }

    /**
     * 执行指定索引的动作
     * @param {number} actionIndex - 动作索引 (0-34)
     * @returns {Promise<{success: boolean, action: number, error?: string}>}
     */
    async executeAction(actionIndex) {
      // 节流控制
      const now = Date.now();
      if (now - this.lastActionTime < this.minInterval) {
        await new Promise(r => setTimeout(r, this.minInterval - (now - this.lastActionTime)));
      }
      this.lastActionTime = Date.now();

      // 动作映射表
      const actionMap = {
        0: () => this._clickButton('attack', '战斗', '普通攻击', 'fight', 'battle'),
        1: () => this._clickButton('skill1', '技能1', 'skill_1'),
        2: () => this._clickButton('skill2', '技能2', 'skill_2'),
        3: () => this._clickButton('skill3', '技能3', 'skill_3'),
        4: () => this._clickButton('heal', '治疗', 'heal', '回血'),
        5: () => this._useItem('hp_potion', 'HP药水', '红药', '血瓶'),
        6: () => this._useItem('mp_potion', 'MP药水', '蓝药', '蓝瓶'),
        7: () => this._clickButton('next_map', '下一张', '高级', 'next', 'nextMap'),
        8: () => this._clickButton('prev_map', '上一张', '低级', 'prev', 'prevMap'),
        9: () => this._clickButton('levelup', '升级', 'levelUp', '升阶'),
        10: () => this._clickButton('breakthrough', '突破', '突破', 'break'),
        11: () => this._clickButton('equip', '整理', '装备', 'equip', 'bag'),
        12: () => this._clickButton('mail', '邮件', 'mail', '收件'),
        13: () => this._doNothing(), // 等待/同步
        14: () => this._clickButton('auto', '自动', 'autoBattle', '挂机'),
        15: () => this._navigateAndClick('炼丹', 'alchemy', '炼药', '丹'),
        16: () => this._navigateAndClick('锻造', 'forge', '打造', '装备'),
        17: () => this._clickButton('upgrade', '升级', 'forgeUp'),
        18: () => this._clickButton('reroll', '重铸', 'reforge', 'reroll'),
        19: () => this._navigateAndClick('洞府', '采集', 'cave', '洞府采集'),
        20: () => this._clickButton('cave_upgrade', '升级', 'caveUp'),
        21: () => this._clickButton('formation', '阵法', 'array'),
        22: () => this._navigateAndClick('传人', '创建', 'disciple', '弟子'),
        23: () => this._clickButton('send', '派遣', 'dispatch', '派出'),
        24: () => this._clickButton('recall', '召回', 'recall', '召回'),
        25: () => this._navigateAndClick('宗门', '贡献', 'sect', '门派'),
        26: () => this._navigateAndClick('宗门', '学习', 'sect', '门派'),
        27: () => this._navigateAndClick('宗门', '任务', 'sect', '门派'),
        28: () => this._navigateAndClick('联盟', '祈福', 'league', '联盟'),
        29: () => this._navigateAndClick('联盟', '沐浴', 'league', '联盟'),
        30: () => this._navigateAndClick('联盟', '采摘', 'league', '联盟'),
        31: () => this._navigateAndClick('联盟', '冥想', 'league', '联盟'),
        32: () => this._navigateAndClick('副本', '探索', 'dungeon', '副本'),
        33: () => this._navigateAndClick('试炼', '挑战', 'trial', '试炼'),
        34: () => this._navigateAndClick('交易所', '买卖', 'exchange', '交易'),
      };

      const executor = actionMap[actionIndex];
      if (executor) {
        try {
          await executor();
          this.actionHistory.push({ action: actionIndex, time: Date.now(), success: true });
          if (this.actionHistory.length > 100) this.actionHistory.shift();
          return { success: true, action: actionIndex };
        } catch (e) {
          console.warn('[AI Plugin] 动作执行失败:', actionIndex, e);
          return { success: false, action: actionIndex, error: e.message };
        }
      }
      return { success: false, error: '未知动作索引: ' + actionIndex };
    }

    /**
     * 根据关键词点击按钮
     * 支持多种选择器策略：文本内容、class名、id、data属性
     */
    async _clickButton(...keywords) {
      for (const keyword of keywords) {
        // 策略1: 按文本内容查找 button/a/可点击元素
        const clickables = document.querySelectorAll(
          'button, a, [role="button"], .btn, [onclick], ' +
          '[class*="button"], [class*="btn"], [class*="tab"], ' +
          '[class*="menu-item"], li, label'
        );
        for (const el of clickables) {
          const text = (el.textContent || '').trim();
          if (text.includes(keyword)) {
            if (!el.disabled && el.getAttribute('aria-disabled') !== 'true') {
              el.click();
              await this._wait(200);
              return true;
            }
          }
        }

        // 策略2: 按class/id/data属性查找
        const byAttr = document.querySelector(
          `[class*="${keyword}"], [id*="${keyword}"], ` +
          `[data-action="${keyword}"], [data-type="${keyword}"]`
        );
        if (byAttr && typeof byAttr.click === 'function') {
          byAttr.click();
          await this._wait(200);
          return true;
        }

        // 策略3: 按图片alt文本查找
        const byImg = document.querySelector(`img[alt*="${keyword}"]`);
        if (byImg && byImg.parentElement && typeof byImg.parentElement.click === 'function') {
          byImg.parentElement.click();
          await this._wait(200);
          return true;
        }
      }
      return false;
    }

    /** 导航到标签页然后点击动作 */
    async _navigateAndClick(tabName, action, ...extraKeywords) {
      // 先点击导航标签
      const tabs = document.querySelectorAll(
        '[class*="tab"], [class*="nav"], [class*="menu"], ' +
        '[class*="panel"], [role="tab"], li'
      );
      let tabClicked = false;
      for (const tab of tabs) {
        if ((tab.textContent || '').includes(tabName)) {
          tab.click();
          tabClicked = true;
          await this._wait(500);
          break;
        }
      }

      // 如果没找到标签，尝试直接点击
      if (!tabClicked) {
        await this._clickButton(tabName);
        await this._wait(300);
      }

      // 再点击动作按钮
      const allKeywords = [action, tabName, ...extraKeywords];
      return this._clickButton(...allKeywords);
    }

    /** 使用物品（打开背包 → 查找 → 使用） */
    async _useItem(itemType, ...itemNames) {
      // 打开背包
      await this._clickButton('背包', '物品', 'inventory', 'bag', '道具');
      await this._wait(300);

      // 查找并使用物品
      const allNames = [itemType, ...itemNames];
      const result = await this._clickButton(...allNames);

      // 如果找到物品，可能需要确认使用
      if (result) {
        await this._wait(200);
        await this._clickButton('使用', '确认', 'use', 'confirm', '确定');
      }

      return result;
    }

    /** 等待/同步 - 什么都不做 */
    async _doNothing() {
      await this._wait(1000);
      return true;
    }

    /** 等待指定毫秒 */
    _wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** 获取动作执行统计 */
    getStats() {
      const stats = {};
      this.actionHistory.forEach(h => {
        const name = (window.ACTIONS && window.ACTIONS[h.action]) || `动作${h.action}`;
        stats[name] = (stats[name] || 0) + 1;
      });
      return stats;
    }
  }

  // ==================== 插件通信接口 ====================

  const extractor = new GameStateExtractor();
  const executor = new ActionExecutor();

  // 暴露给插件popup/background通信
  window.__AI_PLUGIN__ = {
    extractor,
    executor,
    /** 获取当前游戏状态（50维向量） */
    getState: () => extractor.extractFromDOM(),
    /** 执行指定动作 */
    executeAction: (actionIndex) => executor.executeAction(actionIndex),
    /** 启动API拦截 */
    startApiInterception: () => extractor.startApiInterception(),
    /** 获取动作统计 */
    getActionStats: () => executor.getStats(),
  };

  // ==================== 消息通信 ====================

  // 监听来自popup的消息（通过chrome.runtime）
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'GET_STATE': {
        const state = extractor.extractFromDOM();
        sendResponse({ state, success: true });
        break;
      }
      case 'EXECUTE_ACTION': {
        executor.executeAction(request.actionIndex).then(result => {
          sendResponse(result);
        });
        break;
      }
      case 'GET_ACTION_STATS': {
        sendResponse({ stats: executor.getStats() });
        break;
      }
      case 'PING': {
        sendResponse({ pong: true });
        break;
      }
      default:
        sendResponse({ error: '未知消息类型: ' + request.type });
    }
    return true; // 保持消息通道开放（用于异步响应）
  });

  // 也支持 window.postMessage 通信（用于popup.html中的iframe场景）
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const { type, data } = event.data || {};

    if (type === 'AI_GET_STATE') {
      const state = extractor.extractFromDOM();
      window.postMessage({ type: 'AI_STATE_RESULT', data: state }, '*');
    } else if (type === 'AI_EXECUTE_ACTION') {
      const result = await executor.executeAction(data.actionIndex);
      window.postMessage({ type: 'AI_ACTION_RESULT', data: result }, '*');
    }
  });

  // ==================== 初始化 ====================

  // 自动开始API拦截
  extractor.startApiInterception();

  // 页面加载完成后自动提取一次状态
  if (document.readyState === 'complete') {
    extractor.extractFromDOM();
  } else {
    window.addEventListener('load', () => {
      extractor.extractFromDOM();
    });
  }

  console.log('[AI Plugin] Content script loaded');
  console.log('[AI Plugin] 游戏状态提取器已就绪');
  console.log('[AI Plugin] 动作执行器已就绪');
})();
