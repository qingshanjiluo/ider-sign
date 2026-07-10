/**
 * 艾德尔修仙传 AI 插件 - Background Service Worker
 *
 * 功能：
 * 1. 插件生命周期管理
 * 2. 长时间挂机时保持 Service Worker 活跃
 * 3. 定时检查游戏状态（即使popup未打开）
 * 4. 后台通知（升级提醒、战斗结果等）
 * 5. 模型数据管理
 */

// ==================== 常量 ====================

const ALARM_NAME = 'ai-bot-keepalive';
const ALARM_INTERVAL = 1; // 分钟
const STORAGE_KEYS = {
  MODELS: 'models',
  CONFIG: 'config',
  STATS: 'stats',
  RUNNING: 'isRunning',
};

// ==================== 安装与更新 ====================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AI Bot BG] 插件已安装/更新:', details.reason);

  if (details.reason === 'install') {
    // 首次安装，初始化默认配置
    chrome.storage.local.set({
      [STORAGE_KEYS.CONFIG]: {
        interval: 2000,
        autoBattle: true,
        autoPotion: true,
        lowHpThreshold: 30,
        autoEquip: true,
        autoSkill: true,
        autoSect: true,
        autoCave: true,
        autoMail: true,
      },
      [STORAGE_KEYS.STATS]: {
        totalSteps: 0,
        totalRuntime: 0,
        lastRunDate: null,
      },
      [STORAGE_KEYS.RUNNING]: false,
    });
  }

  // 创建定期保活闹钟
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: ALARM_INTERVAL
  });
});

// ==================== 保活机制 ====================

// 保持 Service Worker 活跃
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    // 检查是否正在运行
    chrome.storage.local.get([STORAGE_KEYS.RUNNING], (result) => {
      if (result[STORAGE_KEYS.RUNNING]) {
        console.log('[AI Bot BG] 挂机运行中，保活信号');
        // 可以在这里执行一些后台任务
        performBackgroundCheck();
      }
    });
  }
});

/**
 * 后台检查任务
 * 当插件在后台运行时，定期检查游戏状态
 */
async function performBackgroundCheck() {
  try {
    // 查询所有标签页
    const tabs = await chrome.tabs.query({});
    let gameTab = null;

    // 查找可能包含游戏的标签页
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('game') || tab.url.includes('play') ||
          tab.title && (tab.title.includes('修仙') || tab.title.includes('艾德尔'))) {
        gameTab = tab;
        break;
      }
    }

    if (!gameTab) return;

    // 尝试 ping content script
    try {
      await chrome.tabs.sendMessage(gameTab.id, { type: 'PING' });
    } catch (e) {
      // content script 未注入，忽略
    }
  } catch (e) {
    console.warn('[AI Bot BG] 后台检查失败:', e);
  }
}

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'BG_GET_STATUS':
      sendResponse({ alive: true, uptime: process.uptime() });
      break;

    case 'BG_GET_CONFIG':
      chrome.storage.local.get([STORAGE_KEYS.CONFIG], (result) => {
        sendResponse(result[STORAGE_KEYS.CONFIG] || {});
      });
      return true; // 异步响应

    case 'BG_SAVE_CONFIG':
      chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: request.config }, () => {
        sendResponse({ success: true });
      });
      return true;

    case 'BG_GET_STATS':
      chrome.storage.local.get([STORAGE_KEYS.STATS], (result) => {
        sendResponse(result[STORAGE_KEYS.STATS] || {});
      });
      return true;

    case 'BG_UPDATE_STATS':
      chrome.storage.local.get([STORAGE_KEYS.STATS], (result) => {
        const stats = result[STORAGE_KEYS.STATS] || {};
        stats.totalSteps = (stats.totalSteps || 0) + (request.steps || 0);
        stats.totalRuntime = (stats.totalRuntime || 0) + (request.runtime || 0);
        stats.lastRunDate = new Date().toISOString();
        chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
        sendResponse({ success: true });
      });
      return true;

    case 'BG_SET_RUNNING':
      chrome.storage.local.set({ [STORAGE_KEYS.RUNNING]: request.running });
      sendResponse({ success: true });
      break;

    case 'BG_IS_RUNNING':
      chrome.storage.local.get([STORAGE_KEYS.RUNNING], (result) => {
        sendResponse({ running: result[STORAGE_KEYS.RUNNING] || false });
      });
      return true;

    default:
      sendResponse({ error: '未知消息类型' });
  }
});

// ==================== 标签页事件 ====================

// 当标签页更新时，检查是否需要注入 content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // 检查是否在游戏页面
    if (tab.url.includes('game') || tab.url.includes('play') ||
        (tab.title && tab.title.includes('修仙'))) {
      // 延迟注入，确保页面完全加载
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).catch(() => {
          // 可能已经注入过了
        });
      }, 1000);
    }
  }
});

// ==================== 扩展图标点击 ====================

// 点击扩展图标时，打开popup（默认行为）
// 这里可以添加额外的逻辑

console.log('[AI Bot BG] Background service worker 已启动');
