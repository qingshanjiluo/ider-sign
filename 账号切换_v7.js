// ==UserScript==
// @name         艾德尔修仙传·账号切换助手 v7.1
// @namespace    https://idlexiuxianzhuan.cn/
// @version      7.1
// @description  玻璃态悬浮窗 · IP深度防护(伪造IP+HMAC签名) · 自动轮巡 · 批量导入 · 移动端适配 · v6.0无缝迁移
// @author       宝黄天
// @match        https://idlexiuxianzhuan.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ===================================================================
    //  常量
    // ===================================================================
    const STORAGE_KEY = 'AccSwitcher_Accounts_v7';
    const STORAGE_SETTINGS = 'AccSwitcher_Settings_v7';
    const STORAGE_IP_POOL = 'AccSwitcher_IpPool_v7';
    const MIGRATION_BACKUP_KEY = 'AccSwitcher_Migration_v6_backup';
    const CSS_ID = 'acc-switcher-v7-style';
    const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
    const MIN_W = 260, MIN_H = 300, MAX_W = 500, MAX_H = 600;
    const PAGE_SIZE = 10;

    // ===================================================================
    //  SVG 图标库（内联SVG，跨平台一致渲染，无emoji兼容问题）
    // ===================================================================
    const ICON = {
        ok:       '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#34d399" stroke-width="2.5"/><polyline points="8 12 11 15 16 9" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        err:      '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#ef4444" stroke-width="2.5"/><line x1="8" y1="8" x2="16" y2="16" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/><line x1="16" y1="8" x2="8" y2="16" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/></svg>',
        warn:     '<svg class="acc-svg" viewBox="0 0 24 24"><polygon points="12 2 2 21 22 21" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="14" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="18" r="1" fill="#f59e0b"/></svg>',
        party:    '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#a78bfa" stroke-width="2"/><path d="M7 14c1-3 4-5 8-4" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/><path d="M9 10l1-3h4l1 3" fill="none" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.5" fill="#ef4444"/><circle cx="14" cy="8" r="1.5" fill="#667eea"/></svg>',
        edit:     '<svg class="acc-svg" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        plus:     '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        list:     '<svg class="acc-svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="9" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="15" x2="13" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        empty:    '<svg class="acc-svg" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h20" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="12" x2="12" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        refresh:  '<svg class="acc-svg" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="1 20 1 14 7 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        trash:    '<svg class="acc-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        download: '<svg class="acc-svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="7 10 12 15 17 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        upload:   '<svg class="acc-svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="17 8 12 3 7 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        shield:   '<svg class="acc-svg" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="12" x2="11" y2="14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="11" y1="14" x2="15" y2="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        play:     '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>',
        pause:    '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="9" y1="8" x2="9" y2="16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="8" x2="15" y2="16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        stop:     '<svg class="acc-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor"/></svg>',
        hourglass:'<svg class="acc-svg" viewBox="0 0 24 24"><path d="M6 2h12M6 22h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="9" y1="11" x2="12" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="14" x2="15" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        close:    '<svg class="acc-svg" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        minimize: '<svg class="acc-svg" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        minus:    '<svg class="acc-svg" viewBox="0 0 24 24"><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        plus2:    '<svg class="acc-svg" viewBox="0 0 24 24"><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        arrow:    '<svg class="acc-svg" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="14 7 19 12 14 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };

    // SVG 图标辅助 CSS
    // .acc-svg 通过 CSS 统一控制对齐与颜色继承
    // 通过注入到 injectStyles() 中处理

    // ===================================================================
    //  状态
    // ===================================================================
    let accounts = [];
    let settings = {};
    let ipPool = [];            // IP池：每个账号对应一个伪造IP
    let ipConfig = {};          // IP防护高级配置
    let isSwitching = false;
    let currentPage = 0;        // 分页：当前页码

    // UI 引用
    let rootEl = null;          // 悬浮窗容器
    let minimizedBtn = null;    // 最小化圆形按钮
    let isMinimized = false;
    let isDark = true;

    // 轮巡调度器
    let scheduler = null;

    // fetch拦截器安装标记
    let _fetchInterceptorInstalled = false;

    // ===================================================================
    //  默认设置
    // ===================================================================
    function getDefaultSettings() {
        return {
            theme: 'auto',
            ipStart: 1,
            ipEnabled: false,
            rotationEnabled: false,
            rotationInterval: 60,
            rotationCurrentIndex: 0,
            windowPosition: { x: 100, y: 100 },
            windowSize: { width: 300, height: 440 },
            isMinimized: false
        };
    }

    function getDefaultIpConfig() {
        return {
            enabled: true,
            randomDelay: true,
            delayMin: 100,
            delayMax: 500,
            autoAssignIp: true,
            ipPrefix: '10.0',
            interceptApi: true
        };
    }

    // ===================================================================
    //  工具函数
    // ===================================================================
    function log(msg) { console.log('[账号切换v7]', msg); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function randomDelay() {
        if (!ipConfig.randomDelay) return Promise.resolve();
        return sleep(randomInt(ipConfig.delayMin, ipConfig.delayMax));
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m =>
            ({ '&':'&','<':'<','>':'>','"':'"',"'":'\x27' }[m] || m));
    }

    // 生成随机内网IP（可自定义前缀）
    function generateFakeIp(seed) {
        const prefix = ipConfig.ipPrefix || '10.0';
        const idx = Number(seed) || Math.floor(Math.random() * 65535);
        const third = (idx >> 8) & 0xFF;
        const fourth = idx & 0xFF;
        return `${prefix}.${third}.${fourth}`;
    }

    // 从IP池获取或分配IP
    function getOrAssignIp(accountIndex) {
        if (!ipConfig.autoAssignIp) return null;
        if (ipPool[accountIndex]) return ipPool[accountIndex];
        const ip = generateFakeIp(accountIndex + 1);
        ipPool[accountIndex] = ip;
        saveIpPool();
        return ip;
    }

    async function waitForElement(selector, timeout = 15000, root = document) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = root.querySelector(selector);
            if (el) return el;
            await sleep(200);
        }
        return null;
    }

    async function closeModals(doc = document) {
        const modal = doc.querySelector('.modal-overlay');
        if (modal) {
            const confirmBtn = modal.querySelector('.btn');
            if (confirmBtn) confirmBtn.click();
            else modal.click();
            await sleep(500);
        }
    }

    function isOnGamePage(doc = document) {
        return !!doc.querySelector('.game-header .hdr-name');
    }

    function isOnLoginPage(doc = document) {
        return !!doc.querySelector('.view-login .login-card');
    }

    function detectTheme() {
        if (settings.theme === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return settings.theme;
    }

    // ===================================================================
    //  存储层
    // ===================================================================
    function loadAccounts() {
        try {
            const raw = GM_getValue(STORAGE_KEY);
            if (raw) {
                accounts = JSON.parse(raw);
                if (!Array.isArray(accounts)) accounts = [];
            } else {
                accounts = [];
            }
        } catch(e) {
            accounts = [];
        }
    }

    function saveAccounts() {
        GM_setValue(STORAGE_KEY, JSON.stringify(accounts));
    }

    function loadSettings() {
        try {
            const raw = GM_getValue(STORAGE_SETTINGS);
            if (raw) {
                const parsed = JSON.parse(raw);
                settings = { ...getDefaultSettings(), ...parsed };
            } else {
                settings = getDefaultSettings();
            }
        } catch(e) {
            settings = getDefaultSettings();
        }
    }

    function saveSettings() {
        GM_setValue(STORAGE_SETTINGS, JSON.stringify(settings));
    }

    function loadIpPool() {
        try {
            const stored = GM_getValue(STORAGE_IP_POOL);
            if (stored) {
                ipPool = JSON.parse(stored);
                if (!Array.isArray(ipPool)) ipPool = [];
            }
        } catch(e) { ipPool = []; }
    }

    function saveIpPool() {
        GM_setValue(STORAGE_IP_POOL, JSON.stringify(ipPool));
    }

    function loadIpConfig() {
        try {
            const raw = GM_getValue('AccSwitcher_IpConfig_v7');
            if (raw) {
                const parsed = JSON.parse(raw);
                ipConfig = { ...getDefaultIpConfig(), ...parsed };
            } else {
                ipConfig = getDefaultIpConfig();
            }
        } catch(e) {
            ipConfig = getDefaultIpConfig();
        }
    }

    function saveIpConfig() {
        GM_setValue('AccSwitcher_IpConfig_v7', JSON.stringify(ipConfig));
    }

    // ===================================================================
    //  v6 → v7 数据迁移
    // ===================================================================
    function migrateFromV6() {
        try {
            const existingV7 = GM_getValue(STORAGE_KEY);
            if (existingV7) {
                log('v7.0 数据已存在，跳过迁移');
                return;
            }

            const v6accountsRaw = GM_getValue('AccSwitcher_Accounts_v6');
            if (!v6accountsRaw) {
                log('未检测到 v6.0 数据，使用空白账号列表启动');
                return;
            }

            let v6accounts;
            try {
                v6accounts = JSON.parse(v6accountsRaw);
            } catch (e) {
                log('[WARN] v6.0 数据解析失败，跳过迁移:', e);
                return;
            }

            if (!Array.isArray(v6accounts) || v6accounts.length === 0) {
                log('v6.0 账号列表为空，跳过迁移');
                return;
            }

            // 备份原始 v6 数据
            const backupPayload = {
                version: 'v6',
                migratedAt: new Date().toISOString(),
                accounts: v6accounts,
                settings: (() => {
                    try {
                        const raw = GM_getValue('AccSwitcher_Settings_v6');
                        return raw ? JSON.parse(raw) : null;
                    } catch { return null; }
                })()
            };
            GM_setValue(MIGRATION_BACKUP_KEY, JSON.stringify(backupPayload));
            log('已备份 v6.0 原始数据');

            // 格式校验 + 修复
            const validAccounts = [];
            for (const acc of v6accounts) {
                if (!acc || typeof acc !== 'object') continue;
                const name = acc.name || acc.username || ('账号' + (validAccounts.length + 1));
                const username = acc.username || '';
                const password = acc.password || '';
                if (!username) {
                    log(`跳过无效账号: ${JSON.stringify(acc)}`);
                    continue;
                }
                validAccounts.push({ name, username, password });
            }

            if (validAccounts.length === 0) {
                log('校验后无有效账号，跳过迁移');
                return;
            }

            GM_setValue(STORAGE_KEY, JSON.stringify(validAccounts));
            accounts = validAccounts;
            log(`[OK] 已迁移 ${validAccounts.length} 个账号`);

            // 迁移设置
            let mergedSettings = getDefaultSettings();
            try {
                const v6settingsRaw = GM_getValue('AccSwitcher_Settings_v6');
                if (v6settingsRaw) {
                    const v6settings = JSON.parse(v6settingsRaw);
                    if (typeof v6settings.theme === 'string') mergedSettings.theme = v6settings.theme;
                    if (typeof v6settings.autoSwitchDelay === 'number') {
                        mergedSettings.rotationInterval = v6settings.autoSwitchDelay;
                    }
                    log('[OK] 已迁移 v6.0 设置');
                }
            } catch (e) {
                log('v6.0 设置迁移失败，使用默认设置:', e);
            }
            GM_setValue(STORAGE_SETTINGS, JSON.stringify(mergedSettings));
            settings = mergedSettings;

            showToast(`${ICON.party} 已从 v6.0 导入 ${validAccounts.length} 个账号`);

        } catch (err) {
            log('迁移过程中发生异常:', err);
            showToast(`${ICON.warn} v6.0 数据迁移遇到问题，请手动导入`);
        }
    }

    // ===================================================================
    //  CSS 注入：玻璃态风格
    // ===================================================================
    function injectStyles() {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = `
            /* ── 全局变量 ── */
            :root {
                --acc-glass-bg: rgba(255,255,255,0.15);
                --acc-glass-bg-dark: rgba(20,20,30,0.85);
                --acc-primary: #667eea;
                --acc-primary2: #764ba2;
                --acc-primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                --acc-success: #34d399;
                --acc-warning: #f59e0b;
                --acc-danger: #ef4444;
                --acc-text: rgba(255,255,255,0.95);
                --acc-text-secondary: rgba(255,255,255,0.65);
                --acc-text-muted: rgba(255,255,255,0.4);
                --acc-border: rgba(255,255,255,0.3);
                --acc-border-dark: rgba(255,255,255,0.12);
            }

            .acc-v7-theme-light {
                --acc-glass-bg: rgba(255,255,255,0.65);
                --acc-glass-bg-dark: rgba(255,255,255,0.75);
                --acc-text: rgba(30,30,40,0.95);
                --acc-text-secondary: rgba(30,30,40,0.6);
                --acc-text-muted: rgba(30,30,40,0.35);
                --acc-border: rgba(0,0,0,0.15);
                --acc-border-dark: rgba(0,0,0,0.08);
            }

            /* ── 悬浮窗容器 ── */
            .acc-v7-window {
                position: fixed;
                z-index: 999990;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                user-select: none;
                border-radius: 20px;
                background: var(--acc-glass-bg-dark);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--acc-border-dark);
                box-shadow:
                    0 8px 32px rgba(0,0,0,0.15),
                    inset 0 1px 0 rgba(255,255,255,0.12),
                    inset 0 -1px 0 rgba(255,255,255,0.04),
                    inset 0 0 22px 11px rgba(255,255,255,0.04);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transition: box-shadow 0.3s;
            }
            .acc-v7-window::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
                pointer-events: none;
                z-index: 2;
            }
            .acc-v7-window::after {
                content: '';
                position: absolute;
                top: 0; left: 0; width: 1px; height: 100%;
                background: linear-gradient(180deg, rgba(255,255,255,0.5), transparent 30%, rgba(255,255,255,0.15));
                pointer-events: none;
                z-index: 2;
            }
            .acc-v7-window:hover {
                box-shadow:
                    0 12px 40px rgba(0,0,0,0.25),
                    inset 0 1px 0 rgba(255,255,255,0.15),
                    inset 0 -1px 0 rgba(255,255,255,0.05),
                    inset 0 0 22px 11px rgba(255,255,255,0.06);
            }

            /* ── 标题栏 ── */
            .acc-v7-titlebar {
                display: flex;
                align-items: center;
                padding: 10px 14px;
                cursor: grab;
                position: relative;
                z-index: 3;
                border-bottom: 1px solid var(--acc-border-dark);
                flex-shrink: 0;
            }
            .acc-v7-titlebar:active { cursor: grabbing; }
            .acc-v7-title {
                flex: 1;
                font-size: 14px;
                font-weight: 700;
                color: var(--acc-text);
                letter-spacing: 0.3px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .acc-v7-title-icon {
                width: 22px; height: 22px;
                border-radius: 50%;
                background: var(--acc-primary-gradient);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
            }
            .acc-v7-titlebar-btns {
                display: flex;
                gap: 4px;
                flex-shrink: 0;
            }
            .acc-v7-titlebar-btns button {
                width: 26px; height: 26px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
                background: rgba(255,255,255,0.08);
                color: var(--acc-text-secondary);
                line-height: 1;
            }
            .acc-v7-titlebar-btns button:hover {
                background: rgba(255,255,255,0.18);
                color: var(--acc-text);
            }
            .acc-v7-titlebar-btns .btn-close:hover {
                background: var(--acc-danger);
                color: #fff;
            }

            /* ── 内容区 ── */
            .acc-v7-body {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 8px 12px 12px;
                position: relative;
                z-index: 3;
            }
            .acc-v7-body::-webkit-scrollbar { width: 4px; }
            .acc-v7-body::-webkit-scrollbar-track { background: transparent; }
            .acc-v7-body::-webkit-scrollbar-thumb {
                background: var(--acc-primary);
                border-radius: 2px;
            }

            /* ── 玻璃卡片 ── */
            .acc-v7-card {
                background: rgba(255,255,255,0.08);
                border-radius: 14px;
                padding: 10px 12px;
                margin-bottom: 8px;
                border: 1px solid var(--acc-border-dark);
                position: relative;
                overflow: hidden;
            }
            .acc-v7-card::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                pointer-events: none;
            }
            .acc-v7-card-title {
                font-size: 11px;
                font-weight: 600;
                color: var(--acc-text-muted);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 6px;
            }

            /* ── 当前账号栏 ── */
            .acc-v7-current {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 14px;
                margin-bottom: 8px;
                background: rgba(102,126,234,0.15);
                border-radius: 14px;
                border: 1px solid rgba(102,126,234,0.25);
            }
            .acc-v7-current-dot {
                width: 10px; height: 10px;
                border-radius: 50%;
                background: var(--acc-success);
                box-shadow: 0 0 8px var(--acc-success);
                flex-shrink: 0;
                animation: accPulse 2s infinite;
            }
            @keyframes accPulse {
                0%,100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .acc-v7-current-info {
                flex: 1;
                min-width: 0;
            }
            .acc-v7-current-name {
                font-size: 14px;
                font-weight: 700;
                color: var(--acc-text);
            }
            .acc-v7-current-user {
                font-size: 11px;
                color: var(--acc-text-secondary);
            }

            /* ── 账号列表 ── */
            .acc-v7-account-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                border-radius: 10px;
                cursor: pointer;
                transition: background 0.15s;
                margin-bottom: 2px;
            }
            .acc-v7-account-item:hover {
                background: rgba(255,255,255,0.08);
            }
            .acc-v7-account-item.active {
                background: rgba(102,126,234,0.2);
                border: 1px solid rgba(102,126,234,0.3);
                border-radius: 10px;
            }
            .acc-v7-account-dot {
                width: 8px; height: 8px;
                border-radius: 50%;
                background: var(--acc-text-muted);
                flex-shrink: 0;
            }
            .acc-v7-account-item.active .acc-v7-account-dot {
                background: var(--acc-success);
                box-shadow: 0 0 6px var(--acc-success);
            }
            .acc-v7-account-name {
                flex: 1;
                font-size: 13px;
                color: var(--acc-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
            .acc-v7-account-actions {
                display: flex;
                gap: 3px;
                flex-shrink: 0;
            }
            .acc-v7-account-actions button {
                width: 28px; height: 26px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
                background: rgba(255,255,255,0.08);
                color: var(--acc-text-secondary);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .acc-v7-account-actions button:hover {
                background: rgba(255,255,255,0.18);
                color: var(--acc-text);
            }
            .acc-v7-account-actions .btn-switch:hover {
                background: rgba(52,211,153,0.3);
                color: var(--acc-success);
            }
            .acc-v7-account-actions .btn-delete:hover {
                background: rgba(239,68,68,0.3);
                color: var(--acc-danger);
            }
            .acc-v7-add-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                width: 100%;
                padding: 8px;
                margin-top: 4px;
                border: 1px dashed var(--acc-border-dark);
                border-radius: 10px;
                background: transparent;
                color: var(--acc-text-secondary);
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
            }
            .acc-v7-add-btn:hover {
                background: rgba(255,255,255,0.06);
                color: var(--acc-text);
                border-color: var(--acc-border);
            }
            .acc-v7-empty {
                text-align: center;
                color: var(--acc-text-muted);
                padding: 16px 0;
                font-size: 13px;
            }

            /* ── 轮巡控制 ── */
            .acc-v7-rotation-status {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 0;
            }
            .acc-v7-rotation-btns {
                display: flex;
                gap: 6px;
            }
            .acc-v7-rotation-btns button {
                padding: 6px 12px;
                border: 1px solid var(--acc-border-dark);
                border-radius: 10px;
                background: rgba(255,255,255,0.06);
                color: var(--acc-text);
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .acc-v7-rotation-btns button:hover {
                background: rgba(255,255,255,0.14);
            }
            .acc-v7-rotation-btns .btn-start {
                background: rgba(52,211,153,0.15);
                border-color: rgba(52,211,153,0.3);
                color: var(--acc-success);
            }
            .acc-v7-rotation-btns .btn-start:hover {
                background: rgba(52,211,153,0.3);
            }
            .acc-v7-rotation-btns .btn-pause {
                background: rgba(245,158,11,0.15);
                border-color: rgba(245,158,11,0.3);
                color: var(--acc-warning);
            }
            .acc-v7-rotation-btns .btn-stop {
                background: rgba(239,68,68,0.12);
                border-color: rgba(239,68,68,0.25);
                color: var(--acc-danger);
            }
            .acc-v7-rotation-interval {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 8px;
                font-size: 12px;
                color: var(--acc-text-secondary);
            }
            .acc-v7-rotation-interval input {
                width: 50px;
                padding: 4px 8px;
                background: rgba(255,255,255,0.08);
                border: 1px solid var(--acc-border-dark);
                border-radius: 8px;
                color: var(--acc-text);
                font-size: 13px;
                text-align: center;
                outline: none;
            }
            .acc-v7-rotation-interval input:focus {
                border-color: var(--acc-primary);
            }
            .acc-v7-rotation-interval button {
                width: 24px; height: 24px;
                border: 1px solid var(--acc-border-dark);
                border-radius: 6px;
                background: rgba(255,255,255,0.06);
                color: var(--acc-text);
                cursor: pointer;
                font-size: 14px;
            }
            .acc-v7-countdown {
                font-size: 12px;
                color: var(--acc-text-secondary);
                margin-top: 6px;
                padding: 6px 10px;
                background: rgba(255,255,255,0.04);
                border-radius: 8px;
                text-align: center;
            }
            .acc-v7-countdown .highlight {
                color: var(--acc-primary);
                font-weight: 600;
            }

            /* ── IP防护设置行 ── */
            .acc-v7-ip-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 12px;
                color: var(--acc-text-secondary);
                padding: 6px 0;
            }
            .acc-v7-ip-row input {
                width: 50px;
                padding: 3px 6px;
                background: rgba(255,255,255,0.08);
                border: 1px solid var(--acc-border-dark);
                border-radius: 6px;
                color: var(--acc-text);
                font-size: 12px;
                text-align: center;
                outline: none;
            }
            .acc-v7-toggle {
                position: relative;
                width: 38px; height: 20px;
                flex-shrink: 0;
            }
            .acc-v7-toggle input {
                opacity: 0; width: 0; height: 0;
            }
            .acc-v7-toggle .slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(255,255,255,0.15);
                border-radius: 20px;
                transition: 0.25s;
            }
            .acc-v7-toggle .slider::before {
                content: '';
                position: absolute;
                width: 14px; height: 14px;
                left: 3px; bottom: 3px;
                background: white;
                border-radius: 50%;
                transition: 0.25s;
            }
            .acc-v7-toggle input:checked + .slider {
                background: var(--acc-primary-gradient);
            }
            .acc-v7-toggle input:checked + .slider::before {
                transform: translateX(18px);
            }

            /* ── 操作栏 ── */
            .acc-v7-actions {
                display: flex;
                gap: 6px;
            }
            .acc-v7-actions button {
                flex: 1;
                padding: 8px 0;
                border: 1px solid var(--acc-border-dark);
                border-radius: 10px;
                background: rgba(255,255,255,0.06);
                color: var(--acc-text);
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
            }
            .acc-v7-actions button:hover {
                background: rgba(255,255,255,0.14);
            }

            /* ── 模态框（玻璃态） ── */
            .acc-v7-modal-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: accFadeIn 0.2s ease-out;
            }
            @keyframes accFadeIn {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .acc-v7-modal {
                background: var(--acc-glass-bg-dark);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--acc-border-dark);
                border-radius: 20px;
                padding: 20px;
                width: 360px;
                max-width: 90vw;
                max-height: 85vh;
                overflow-y: auto;
                box-shadow: 0 12px 48px rgba(0,0,0,0.4);
                font-family: inherit;
                color: var(--acc-text);
                position: relative;
            }
            .acc-v7-modal::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                pointer-events: none;
            }
            .acc-v7-modal h3 {
                margin: 0 0 14px 0;
                font-size: 17px;
                text-align: center;
                color: var(--acc-text);
            }
            .acc-v7-modal .field {
                margin-bottom: 10px;
            }
            .acc-v7-modal .field label {
                display: block;
                font-size: 11px;
                color: var(--acc-text-muted);
                margin-bottom: 3px;
            }
            .acc-v7-modal .field input,
            .acc-v7-modal .field textarea,
            .acc-v7-modal .field select {
                width: 100%;
                padding: 8px 10px;
                background: rgba(255,255,255,0.06);
                border: 1px solid var(--acc-border-dark);
                border-radius: 10px;
                color: var(--acc-text);
                font-size: 13px;
                outline: none;
                box-sizing: border-box;
                transition: border-color 0.15s;
                font-family: inherit;
            }
            .acc-v7-modal .field textarea {
                resize: vertical;
                min-height: 100px;
            }
            .acc-v7-modal .field input:focus,
            .acc-v7-modal .field textarea:focus {
                border-color: var(--acc-primary);
            }
            .acc-v7-modal .modal-actions {
                display: flex;
                gap: 8px;
                margin-top: 14px;
            }
            .acc-v7-modal .modal-actions button {
                flex: 1;
                padding: 9px 0;
                border: none;
                border-radius: 12px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.15s;
            }
            .acc-v7-modal .btn-primary {
                background: var(--acc-primary-gradient);
                color: #fff;
                font-weight: 600;
            }
            .acc-v7-modal .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
            .acc-v7-modal .btn-cancel {
                background: rgba(255,255,255,0.08);
                color: var(--acc-text-secondary);
            }
            .acc-v7-modal .btn-cancel:hover { background: rgba(255,255,255,0.14); }
            .acc-v7-modal .preview-list {
                max-height: 160px;
                overflow-y: auto;
                margin: 8px 0;
                font-size: 12px;
            }
            .acc-v7-modal .preview-item {
                padding: 4px 8px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .acc-v7-modal .preview-item.ok { color: var(--acc-success); }
            .acc-v7-modal .preview-item.warn { color: var(--acc-warning); }
            .acc-v7-modal .preview-item.err { color: var(--acc-danger); }
            .acc-v7-modal .dup-options {
                display: flex;
                gap: 6px;
                margin-top: 6px;
                font-size: 11px;
            }
            .acc-v7-modal .dup-options label {
                color: var(--acc-text-secondary);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .acc-v7-modal .modal-msg {
                font-size: 12px;
                margin-bottom: 8px;
                text-align: center;
            }
            .acc-v7-modal .modal-msg.error { color: var(--acc-danger); }
            .acc-v7-modal .modal-msg.success { color: var(--acc-success); }

            /* ── Toast ── */
            .acc-v7-toast {
                position: fixed;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--acc-glass-bg-dark);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid var(--acc-border-dark);
                color: var(--acc-text);
                padding: 10px 24px;
                border-radius: 30px;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                z-index: 9999999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                animation: accFadeIn 0.2s ease-out;
                pointer-events: none;
            }

            /* ── 最小化按钮 ── */
            .acc-v7-minimized {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: var(--acc-primary-gradient);
                border: 2px solid rgba(255,255,255,0.3);
                cursor: pointer;
                z-index: 999991;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                color: white;
                box-shadow: 0 4px 16px rgba(102,126,234,0.4);
                transition: all 0.2s;
                animation: accFadeIn 0.2s ease-out;
            }
            .acc-v7-minimized:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 24px rgba(102,126,234,0.6);
            }

            /* ── 分页控件 ── */
            .acc-v7-pagination {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 4px 0 8px 0;
            }
            .acc-v7-pagination button {
                width: 28px; height: 28px;
                border: 1px solid var(--acc-border-dark);
                border-radius: 8px;
                background: rgba(255,255,255,0.06);
                color: var(--acc-text);
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .acc-v7-pagination button:hover:not(:disabled) {
                background: rgba(255,255,255,0.14);
            }
            .acc-v7-pagination button:disabled {
                opacity: 0.3;
                cursor: default;
            }
            .acc-v7-page-info {
                font-size: 11px;
                color: var(--acc-text-secondary);
                min-width: 36px;
                text-align: center;
            }

            /* ── 缩放手柄 ── */
            .acc-v7-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 16px;
                height: 16px;
                cursor: nwse-resize;
                z-index: 5;
            }
            .acc-v7-resize-handle::after {
                content: '';
                position: absolute;
                bottom: 3px;
                right: 3px;
                width: 8px;
                height: 8px;
                border-right: 2px solid var(--acc-text-muted);
                border-bottom: 2px solid var(--acc-text-muted);
            }

            /* ── SVG 图标统一规则 ── */
            .acc-svg {
                width: 1em;
                height: 1em;
                vertical-align: -0.125em;
                display: inline-block;
                flex-shrink: 0;
            }
            .acc-svg-md { width: 1.15em; height: 1.15em; }
            .acc-svg-lg { width: 1.3em; height: 1.3em; }
            .acc-v7-title-icon .acc-svg {
                width: 14px; height: 14px;
            }
            .acc-v7-minimized .acc-svg {
                width: 22px; height: 22px;
            }
            .acc-v7-account-actions button .acc-svg {
                width: 14px; height: 14px;
            }
            .acc-v7-actions button .acc-svg {
                width: 14px; height: 14px;
                margin-right: 2px;
            }
            .acc-v7-add-btn .acc-svg {
                width: 14px; height: 14px;
            }
            .acc-v7-card-title .acc-svg {
                width: 14px; height: 14px;
                margin-right: 2px;
            }
            .acc-v7-rotation-btns button .acc-svg {
                width: 14px; height: 14px;
            }
            .acc-v7-empty .acc-svg {
                width: 20px; height: 20px;
                display: block;
                margin: 0 auto 6px;
                opacity: 0.4;
            }
        `;
        document.head.appendChild(style);
    }

    // ===================================================================
    //  Toast
    // ===================================================================
    function showToast(msg, duration = 2500) {
        const existing = document.querySelector('.acc-v7-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'acc-v7-toast';
        el.innerHTML = msg;
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
    }

    // ===================================================================
    //  拖动处理器
    // ===================================================================
    class DragHandler {
        constructor(windowEl, handleEl) {
            this.window = windowEl;
            this.handle = handleEl;
            this.isDragging = false;
            this.startX = 0;
            this.startY = 0;
            this.initX = 0;
            this.initY = 0;
        }

        _getClientXY(e) {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            if (e.changedTouches && e.changedTouches.length > 0) {
                return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        }

        init() {
            const onStart = (e) => {
                if (e.target.closest('button')) return;
                this.isDragging = true;
                const { x, y } = this._getClientXY(e);
                this.startX = x;
                this.startY = y;
                const rect = this.window.getBoundingClientRect();
                this.initX = rect.left;
                this.initY = rect.top;
                this.handle.style.cursor = 'grabbing';
                e.preventDefault();
            };

            this.handle.addEventListener('mousedown', onStart);
            this.handle.addEventListener('touchstart', onStart, { passive: false });

            const onMove = (e) => {
                if (!this.isDragging) return;
                const { x, y } = this._getClientXY(e);
                const dx = x - this.startX;
                const dy = y - this.startY;
                let newX = this.initX + dx;
                let newY = this.initY + dy;

                // 边界限制
                const winW = this.window.offsetWidth;
                const winH = this.window.offsetHeight;
                const maxX = window.innerWidth - winW;
                const maxY = window.innerHeight - winH;
                newX = Math.max(0, Math.min(newX, maxX));
                newY = Math.max(0, Math.min(newY, maxY));

                this.window.style.left = newX + 'px';
                this.window.style.top = newY + 'px';
                this.window.style.right = 'auto';
                this.window.style.bottom = 'auto';
            };

            const onUp = () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                this.handle.style.cursor = 'grab';
                const rect = this.window.getBoundingClientRect();
                settings.windowPosition = { x: rect.left, y: rect.top };
                saveSettings();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        }
    }

    // ===================================================================
    //  缩放处理器
    // ===================================================================
    class ResizeHandler {
        constructor(windowEl, handleEl) {
            this.window = windowEl;
            this.handle = handleEl;
            this.isResizing = false;
            this.startX = 0;
            this.startY = 0;
            this.initW = 0;
            this.initH = 0;
        }

        init() {
            this.handle.addEventListener('mousedown', (e) => {
                this.isResizing = true;
                this.startX = e.clientX;
                this.startY = e.clientY;
                this.initW = this.window.offsetWidth;
                this.initH = this.window.offsetHeight;
                e.preventDefault();
                e.stopPropagation();
            });

            const onMove = (e) => {
                if (!this.isResizing) return;
                const dx = e.clientX - this.startX;
                const dy = e.clientY - this.startY;
                let newW = this.initW + dx;
                let newH = this.initH + dy;
                newW = Math.max(MIN_W, Math.min(newW, MAX_W));
                newH = Math.max(MIN_H, Math.min(newH, MAX_H));
                this.window.style.width = newW + 'px';
                this.window.style.height = newH + 'px';
            };

            const onUp = () => {
                if (!this.isResizing) return;
                this.isResizing = false;
                settings.windowSize = {
                    width: this.window.offsetWidth,
                    height: this.window.offsetHeight
                };
                saveSettings();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    // ===================================================================
    //  IP防护：fetch 拦截器
    // ===================================================================
    function installFetchInterceptor() {
        if (_fetchInterceptorInstalled) return;
        if (!ipConfig.enabled || !ipConfig.interceptApi) return;

        const originalFetch = unsafeWindow.fetch;
        if (!originalFetch) return;

        unsafeWindow.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : (input.url || '');
            if (url.includes('/dungeon') || url.includes('/auth/') || url.includes('/player') ||
                url.includes('/battle') || url.includes('/online') || url.includes('/exchange') ||
                url.includes('/trial') || url.includes('/alliance') || url.includes('/sect') ||
                url.includes('/disciple') || url.includes('/league') || url.includes('/mail') ||
                url.includes('/dungeon-battle') || url.includes('/city-duel')) {

                const token = localStorage.getItem('game_token') || '';
                let fakeIp = null;

                if (token) {
                    for (let i = 0; i < accounts.length; i++) {
                        if (accounts[i]._lastToken === token) {
                            fakeIp = getOrAssignIp(i);
                            break;
                        }
                    }
                }

                if (!fakeIp && ipPool.length > 0) {
                    fakeIp = ipPool[ipPool.length - 1];
                }

                if (fakeIp) {
                    init = init || {};
                    init.headers = init.headers || {};

                    if (init.headers instanceof Headers) {
                        if (!init.headers.has('X-Forwarded-For')) {
                            init.headers.set('X-Forwarded-For', fakeIp);
                        }
                        if (!init.headers.has('X-Real-IP')) {
                            init.headers.set('X-Real-IP', fakeIp);
                        }
                    } else if (typeof init.headers === 'object' && !Array.isArray(init.headers)) {
                        if (!init.headers['X-Forwarded-For']) {
                            init.headers['X-Forwarded-For'] = fakeIp;
                        }
                        if (!init.headers['X-Real-IP']) {
                            init.headers['X-Real-IP'] = fakeIp;
                        }
                    }

                    if (ipConfig.randomDelay) {
                        await sleep(randomInt(ipConfig.delayMin, ipConfig.delayMax));
                    }
                }
            }

            return originalFetch.call(this, input, init);
        };

        _fetchInterceptorInstalled = true;
        log('fetch 拦截器已安装，将自动为API请求添加伪造IP');
    }

    // ===================================================================
    //  IP防护：HMAC-SHA256 签名
    // ===================================================================
    async function makeSign(method, path, timestamp, bodyStr) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', enc.encode(SIGN_KEY),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const data = enc.encode(`${method}\n${path}\n${timestamp}\n${bodyStr}`);
        const sig = await crypto.subtle.sign('HMAC', key, data);
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ===================================================================
    //  IP防护：伪造IP登录（API直连，HMAC签名 + X-Forwarded-For）
    // ===================================================================
    async function loginWithIpSpoof(account, accountIndex) {
        if (!ipConfig.enabled || !ipConfig.autoAssignIp) {
            return false; // IP未启用，走普通登录流程
        }

        const fakeIp = getOrAssignIp(accountIndex);
        const machineId = `web_fake_${String(accountIndex).padStart(4, '0')}_${Date.now().toString(36)}`;

        log(`正在API登录 ${account.username}，伪造IP: ${fakeIp}, machine_id: ${machineId}`);

        const baseUrl = window.location.origin;
        const body = {
            username: account.username,
            password: account.password,
            machine_id: machineId
        };

        const headers = {
            'Content-Type': 'application/json',
            'X-Client-Version': '1.2.4'
        };

        if (fakeIp) {
            headers['X-Forwarded-For'] = fakeIp;
            headers['X-Real-IP'] = fakeIp;
        }

        const bodyStr = JSON.stringify(body);
        const ts = Math.floor(Date.now() / 1000);
        headers['X-Sign-T'] = String(ts);
        headers['X-Sign'] = await makeSign('POST', '/auth/login', ts, bodyStr);

        try {
            const res = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers,
                body: bodyStr
            });

            const data = await res.json();
            if (data.ok && data.token) {
                localStorage.setItem('game_token', data.token);
                account._lastToken = data.token;
                account._lastMachineId = machineId;
                account._lastIp = fakeIp;
                saveAccounts();
                log(`${account.username} 登录成功(API)，token已保存`);
                return true;
            } else {
                log(`${account.username} 登录失败: ${data.error || '未知错误'}`);
                throw new Error(data.error || 'API登录失败');
            }
        } catch (err) {
            log(`${account.username} 登录请求失败: ${err.message}`);
            throw err;
        }
    }

    // ===================================================================
    //  IP防护：统一入口（兼容新旧两种模式）
    // ===================================================================
    const IPProtector = {
        getIPForAccount(index) {
            return getOrAssignIp(index);
        },

        applyIP(accountIndex) {
            if (!settings.ipEnabled && !ipConfig.enabled) return;
            if (ipConfig.enabled && ipConfig.autoAssignIp) {
                getOrAssignIp(accountIndex);
            } else {
                // 兼容旧版简单IP模式
                const ip = (settings.ipStart || 1) + accountIndex;
                const fakeIp = `192.168.1.${Math.min(ip, 255)}`;
                const stored = JSON.parse(localStorage.getItem('game_ip_config') || '{}');
                stored.lastIP = fakeIp;
                localStorage.setItem('game_ip_config', JSON.stringify(stored));
                if (window.machine_id !== undefined) {
                    window.machine_id = `web_ip_${Math.min(ip, 255)}`;
                }
            }
            log(`IP防护: 账号#${accountIndex} → IP已应用`);
        }
    };

    // ===================================================================
    //  轮巡调度器
    // ===================================================================
    class RotationScheduler {
        constructor(onStateChange) {
            this.onStateChange = onStateChange;
            this.timer = null;
            this.countdownTimer = null;
            this.isRunning = false;
            this.secondsLeft = 0;
        }

        get interval() { return settings.rotationInterval || 60; }
        get currentIndex() { return settings.rotationCurrentIndex || 0; }
        set currentIndex(v) {
            settings.rotationCurrentIndex = v;
            saveSettings();
        }

        start() {
            if (this.isRunning || accounts.length < 2) return;
            this.isRunning = true;
            settings.rotationEnabled = true;
            saveSettings();
            if (this.currentIndex >= accounts.length) this.currentIndex = 0;
            this.scheduleNext();
            if (this.onStateChange) this.onStateChange();
        }

        scheduleNext() {
            this.secondsLeft = this.interval;
            this.startCountdown();

            this.timer = setTimeout(() => {
                this.performSwitch();
            }, this.interval * 1000);
        }

        startCountdown() {
            clearInterval(this.countdownTimer);
            this.countdownTimer = setInterval(() => {
                this.secondsLeft--;
                if (this.secondsLeft <= 0) {
                    clearInterval(this.countdownTimer);
                }
                if (this.onStateChange) this.onStateChange();
            }, 1000);
        }

        async performSwitch() {
            const nextIndex = (this.currentIndex + 1) % accounts.length;
            const nextAccount = accounts[nextIndex];

            log(`轮巡切换: → ${nextAccount.name} (${nextIndex + 1}/${accounts.length})`);

            try {
                IPProtector.applyIP(nextIndex);
                await switchToAccount(nextAccount, nextIndex);
            } catch (e) {
                log('轮巡切换异常:', e);
            }

            this.currentIndex = nextIndex;
            if (!this.isRunning) return;
            this.scheduleNext();
            if (this.onStateChange) this.onStateChange();
        }

        pause() {
            clearTimeout(this.timer);
            clearInterval(this.countdownTimer);
            this.isRunning = false;
            settings.rotationEnabled = false;
            saveSettings();
            if (this.onStateChange) this.onStateChange();
        }

        stop() {
            this.pause();
            this.currentIndex = 0;
            if (this.onStateChange) this.onStateChange();
        }

        getProgress() {
            return {
                current: this.currentIndex + 1,
                total: accounts.length,
                nextAccount: this.isRunning
                    ? accounts[(this.currentIndex + 1) % accounts.length].name
                    : null,
                secondsLeft: this.secondsLeft
            };
        }
    }

    // ===================================================================
    //  批量导入解析器
    // ===================================================================
    const BatchImporter = {
        parse(text) {
            const lines = text.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('//') && !l.startsWith('#'));

            if (lines.length === 0) return { accounts: [], duplicates: [], errors: ['无有效数据'], total: 0, valid: 0 };

            const firstLine = lines[0];
            let delimiter = ',';
            if (firstLine.includes('\t')) delimiter = '\t';
            else if (!firstLine.includes(',') && firstLine.includes(':')) delimiter = ':';

            const results = [];
            const errors = [];

            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(delimiter).map(s => s.trim());

                if (parts.length < 2) {
                    errors.push(`第${i + 1}行: 格式不正确`);
                    continue;
                }

                let name, username, password;

                if (delimiter === ':') {
                    [username, password] = parts;
                    name = parts[2] || username;
                } else {
                    [name, username, password] = parts;
                }

                if (!username || !password) {
                    errors.push(`第${i + 1}行: 缺少用户名或密码`);
                    continue;
                }

                results.push({ name: name || username, username, password });
            }

            const duplicates = [];
            const uniqueResults = [];
            const usernameSet = new Set();

            for (const acc of results) {
                if (usernameSet.has(acc.username)) {
                    duplicates.push(acc);
                } else {
                    usernameSet.add(acc.username);
                    uniqueResults.push(acc);
                }
            }

            return {
                accounts: uniqueResults,
                duplicates,
                errors,
                total: lines.length,
                valid: uniqueResults.length
            };
        },

        merge(parsed, existing, strategy = 'skip') {
            const existingUsernames = new Set(existing.map(a => a.username));
            const added = [];

            for (const acc of parsed.accounts) {
                if (existingUsernames.has(acc.username)) {
                    if (strategy === 'overwrite') {
                        const idx = existing.findIndex(a => a.username === acc.username);
                        if (idx >= 0) {
                            existing[idx] = { name: acc.name, username: acc.username, password: acc.password };
                        }
                        added.push(acc);
                    }
                    continue;
                }
                existing.push({ name: acc.name, username: acc.username, password: acc.password });
                added.push(acc);
            }

            return { existing, added, count: added.length };
        }
    };

    // ===================================================================
    //  切换账号核心逻辑（统一方案：API伪造IP登录 + 降级到页面表单登录）
    // ===================================================================
    async function switchToAccount(account, accountIndex = -1) {
        if (isSwitching) {
            showToast(`${ICON.hourglass} 正在切换中，请稍后再试`);
            return;
        }
        isSwitching = true;
        renderBody();

        try {
            // 查找账号索引（如果未传入）
            if (accountIndex < 0) {
                accountIndex = accounts.findIndex(a => a.username === account.username);
            }

            // 步骤1：如果在游戏主页，先退出
            if (isOnGamePage()) {
                log('当前在游戏主页，执行退出');
                const logoutBtn = document.querySelector('.btn-icon[title="换号/退出"], .game-header .btn-icon:last-child');
                if (!logoutBtn) throw new Error('未找到退出按钮');
                logoutBtn.click();
                log('已点击退出按钮');
                const loginDetected = await waitForElement('.view-login, .login-card', 15000);
                if (!loginDetected) throw new Error('退出后未跳转到登录页');
                await sleep(1000);
                await closeModals();
                log('已退出，当前在登录页');
            } else {
                log('当前不在游戏主页，跳过退出步骤');
            }

            // 随机延迟
            await randomDelay();

            // 步骤2：尝试API伪造IP登录
            let ipLoginSuccess = false;
            if (ipConfig.enabled && ipConfig.autoAssignIp) {
                try {
                    ipLoginSuccess = await loginWithIpSpoof(account, accountIndex);
                } catch (e) {
                    log(`API IP伪造登录失败: ${e.message}，降级到页面表单登录`);
                }
            }

            if (ipLoginSuccess) {
                // API登录成功，直接刷新页面
                showToast(`${ICON.ok} 已切换至 ${account.name}` + (account._lastIp ? ` (IP: ${account._lastIp})` : ''));
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        text: `已登录 ${account.name}${account._lastIp ? '\n伪造IP: ' + account._lastIp : ''}`,
                        timeout: 2000
                    });
                }
                log(`登录成功(${account.username})，刷新页面`);
                await sleep(500);
                location.reload();
            } else {
                // 降级：使用页面表单登录（新标签页方式）
                log(`使用页面表单登录: ${account.username}`);
                const newTab = window.open('https://idlexiuxianzhuan.cn/web/', '_blank');
                if (!newTab) {
                    alert('请允许弹出窗口，或手动点击允许');
                    isSwitching = false;
                    renderBody();
                    return;
                }

                await new Promise((resolve) => {
                    if (newTab.document.readyState === 'complete') resolve();
                    else newTab.addEventListener('load', resolve);
                });
                await sleep(1000);

                const doc = newTab.document;
                if (isOnGamePage(doc)) {
                    const logoutBtn = doc.querySelector('.btn-icon[title="换号/退出"]');
                    if (logoutBtn) {
                        logoutBtn.click();
                        await sleep(2000);
                        await waitForElement('.view-login .login-card', 10000);
                    }
                }

                if (!isOnLoginPage(doc)) {
                    throw new Error('未进入登录页面');
                }

                const usernameInput = doc.querySelector('.form-group input[placeholder="用户名"], .form-group input:first-child');
                const passwordInput = doc.querySelector('.form-group input[type="password"]');
                const loginBtn = doc.querySelector('.btn-primary');

                if (!usernameInput || !passwordInput || !loginBtn) {
                    throw new Error('未找到登录表单');
                }

                // 表单登录也应用IP伪装
                IPProtector.applyIP(accountIndex);

                usernameInput.value = account.username;
                usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
                passwordInput.value = account.password;
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

                loginBtn.click();
                log(`新标签页已提交登录: ${account.username}`);

                const success = await waitForElement('.game-header .hdr-name', 20000, doc);
                if (!success) {
                    throw new Error('登录后未进入游戏主页');
                }

                await closeModals(doc);
                showToast(`${ICON.ok} 已切换至 ${account.name}`);
                if (typeof GM_notification === 'function') {
                    GM_notification({ text: `已切换至 ${account.name}`, timeout: 2000 });
                }
            }
        } catch (err) {
            log('切换失败:', err);
            showToast(`${ICON.err} 切换失败: ${err.message}`);
        } finally {
            isSwitching = false;
            renderBody();
        }
    }

    // ===================================================================
    //  配置导入/导出
    // ===================================================================
    function exportConfig() {
        const payload = {
            version: '7.1',
            exportedAt: new Date().toISOString(),
            accounts: accounts.map(a => ({
                name: a.name,
                username: a.username,
                password: a.password,
                _lastIp: a._lastIp || null
            })),
            settings: settings,
            ipConfig: ipConfig,
            ipPool: ipPool.filter(Boolean)
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `艾德尔账号v7_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`${ICON.ok} 配置已导出 (v7.1 格式)`);
    }

    function importConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    const data = JSON.parse(ev.target.result);
                    let importedAccounts = [];

                    if (Array.isArray(data.accounts)) {
                        importedAccounts = data.accounts;
                    } else if (Array.isArray(data)) {
                        importedAccounts = data;
                    } else {
                        showToast(`${ICON.err} 无效的配置文件：缺少账号数据`);
                        return;
                    }

                    if (importedAccounts.length === 0) {
                        showToast(`${ICON.err} 配置文件为空`);
                        return;
                    }

                    importedAccounts = importedAccounts.map(a => ({
                        name: a.name || a.username || '未命名',
                        username: a.username || '',
                        password: a.password || ''
                    })).filter(a => a.username);

                    const mode = confirm(
                        `即将导入 ${importedAccounts.length} 个账号。\n\n` +
                        `[确定] 覆盖现有列表\n[取消] 合并（去重追加）`
                    );

                    if (mode) {
                        accounts = importedAccounts;
                    } else {
                        const existingUsernames = new Set(accounts.map(a => a.username));
                        for (const a of importedAccounts) {
                            if (!existingUsernames.has(a.username)) {
                                accounts.push(a);
                                existingUsernames.add(a.username);
                            }
                        }
                    }

                    if (data.settings && typeof data.settings === 'object') {
                        settings = { ...getDefaultSettings(), ...settings, ...data.settings };
                        saveSettings();
                    }

                    // 导入IP配置
                    if (data.ipConfig && typeof data.ipConfig === 'object') {
                        ipConfig = { ...getDefaultIpConfig(), ...data.ipConfig };
                        saveIpConfig();
                        if (ipConfig.enabled && ipConfig.interceptApi) {
                            installFetchInterceptor();
                        }
                    }

                    // 导入IP池
                    if (Array.isArray(data.ipPool)) {
                        ipPool = data.ipPool.filter(Boolean);
                        saveIpPool();
                    }

                    saveAccounts();
                    currentPage = 0;
                    renderBody();
                    showToast(`${ICON.ok} 已导入 ${importedAccounts.length} 个账号`);
                } catch(err) {
                    showToast(`${ICON.err} 导入失败: ` + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // ===================================================================
    //  弹窗：添加/编辑账号
    // ===================================================================
    function openAccountEditModal(index = -1) {
        const isEdit = index >= 0;
        const acc = isEdit ? accounts[index] : { name: '', username: '', password: '' };

        const overlay = document.createElement('div');
        overlay.className = 'acc-v7-modal-overlay';
        overlay.innerHTML = `
            <div class="acc-v7-modal">
                <h3>${isEdit ? ICON.edit + ' 编辑账号' : ICON.plus + ' 添加账号'}</h3>
                <div class="field">
                    <label>账号名称（显示用）</label>
                    <input type="text" id="modal-acc-name" value="${escapeHtml(acc.name)}" placeholder="例如：主号">
                </div>
                <div class="field">
                    <label>登录用户名</label>
                    <input type="text" id="modal-acc-username" value="${escapeHtml(acc.username)}" placeholder="用户名">
                </div>
                <div class="field">
                    <label>登录密码</label>
                    <input type="password" id="modal-acc-password" value="${escapeHtml(acc.password)}" placeholder="密码">
                </div>
                <div id="modal-acc-msg" class="modal-msg error" style="display:none"></div>
                <div class="modal-actions">
                    <button class="btn-cancel" id="modal-acc-cancel">取消</button>
                    <button class="btn-primary" id="modal-acc-save">${isEdit ? '保存' : '添加'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const msgEl = overlay.querySelector('#modal-acc-msg');
        function showMsg(text, isError = true) {
            msgEl.textContent = text;
            msgEl.style.display = 'block';
            msgEl.className = 'modal-msg ' + (isError ? 'error' : 'success');
        }

        overlay.querySelector('#modal-acc-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#modal-acc-save').onclick = () => {
            const name = overlay.querySelector('#modal-acc-name').value.trim();
            const username = overlay.querySelector('#modal-acc-username').value.trim();
            const password = overlay.querySelector('#modal-acc-password').value.trim();

            if (!username || !password) {
                showMsg('用户名和密码不能为空');
                return;
            }

            if (isEdit) {
                accounts[index] = { name: name || username, username, password };
            } else {
                const exists = accounts.some(a => a.username === username);
                if (exists) {
                    showMsg('该用户名已存在');
                    return;
                }
                accounts.push({ name: name || username, username, password });
            }
            saveAccounts();
            renderBody();
            overlay.remove();
            showToast(isEdit ? `${ICON.ok} 账号已更新` : `${ICON.ok} 账号已添加`);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const pwInput = overlay.querySelector('#modal-acc-password');
        pwInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('#modal-acc-save').click();
        });

        setTimeout(() => {
            if (isEdit) overlay.querySelector('#modal-acc-name').focus();
            else overlay.querySelector('#modal-acc-username').focus();
        }, 100);
    }

    // ===================================================================
    //  弹窗：批量导入
    // ===================================================================
    function openBatchImportModal() {
        let parsedResult = null;
        let dupStrategy = 'skip';

        const overlay = document.createElement('div');
        overlay.className = 'acc-v7-modal-overlay';
        overlay.innerHTML = `
            <div class="acc-v7-modal" style="width:420px">
                <h3>${ICON.list} 批量导入账号</h3>
                <div style="font-size:11px;color:var(--acc-text-muted);text-align:center;margin-bottom:8px">
                    支持格式: CSV / TXT / 制表符分隔
                </div>
                <div class="field">
                    <textarea id="modal-batch-input" placeholder="账号名称,用户名,密码&#10;主号,player001,pass123&#10;小号1,player002,pass456&#10;&#10;或冒号分隔:&#10;player001:pass123:主号&#10;player002:pass456:小号1"></textarea>
                </div>
                <div id="modal-batch-preview" class="preview-list"></div>
                <div id="modal-batch-summary" style="font-size:11px;color:var(--acc-text-muted);text-align:center;margin-bottom:6px;display:none"></div>
                <div class="dup-options" id="modal-batch-dup" style="display:none">
                    <span style="color:var(--acc-text-muted);margin-right:4px">重复处理:</span>
                    <label><input type="radio" name="dup-strategy" value="skip" checked> 跳过</label>
                    <label><input type="radio" name="dup-strategy" value="overwrite"> 覆盖</label>
                </div>
                <div id="modal-batch-msg" class="modal-msg error" style="display:none"></div>
                <div class="modal-actions">
                    <button class="btn-cancel" id="modal-batch-cancel">取消</button>
                    <button class="btn-primary" id="modal-batch-import" disabled>导入</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const textarea = overlay.querySelector('#modal-batch-input');
        const previewEl = overlay.querySelector('#modal-batch-preview');
        const summaryEl = overlay.querySelector('#modal-batch-summary');
        const dupEl = overlay.querySelector('#modal-batch-dup');
        const importBtn = overlay.querySelector('#modal-batch-import');
        const msgEl = overlay.querySelector('#modal-batch-msg');

        function updatePreview() {
            const text = textarea.value.trim();
            if (!text) {
                previewEl.innerHTML = '';
                summaryEl.style.display = 'none';
                dupEl.style.display = 'none';
                importBtn.disabled = true;
                return;
            }

            parsedResult = BatchImporter.parse(text);

            let html = '';
            for (const acc of parsedResult.accounts) {
                const exists = accounts.some(a => a.username === acc.username);
                const cls = exists ? 'warn' : 'ok';
                const prefix = exists ? ICON.warn : ICON.ok;
                html += `<div class="preview-item ${cls}">${prefix} ${escapeHtml(acc.name)} (${escapeHtml(acc.username)})</div>`;
            }
            for (const dup of parsedResult.duplicates) {
                html += `<div class="preview-item err">${ICON.warn} 重复(文件内): ${escapeHtml(dup.name)} (${escapeHtml(dup.username)})</div>`;
            }
            for (const err of parsedResult.errors) {
                html += `<div class="preview-item err">${ICON.err} ${escapeHtml(err)}</div>`;
            }
            previewEl.innerHTML = html;

            const hasExistingDup = parsedResult.accounts.some(a => accounts.some(ea => ea.username === a.username));
            dupEl.style.display = hasExistingDup ? 'flex' : 'none';

            summaryEl.style.display = 'block';
            summaryEl.textContent = `共解析 ${parsedResult.total} 条，有效 ${parsedResult.valid} 条，异常 ${parsedResult.errors.length + parsedResult.duplicates.length} 条`;

            importBtn.disabled = parsedResult.valid === 0;
            importBtn.textContent = `导入 (${parsedResult.valid}条)`;
        }

        textarea.addEventListener('input', updatePreview);

        overlay.querySelector('#modal-batch-dup').addEventListener('change', (e) => {
            if (e.target.name === 'dup-strategy') {
                dupStrategy = e.target.value;
            }
        });

        overlay.querySelector('#modal-batch-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#modal-batch-import').onclick = () => {
            if (!parsedResult || parsedResult.valid === 0) return;
            const result = BatchImporter.merge(parsedResult, accounts, dupStrategy);
            saveAccounts();
            renderBody();
            overlay.remove();
            showToast(`${ICON.ok} 已导入 ${result.count} 个账号`);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        setTimeout(() => textarea.focus(), 100);
    }

    // ===================================================================
    //  UI 渲染
    // ===================================================================
    function renderBody() {
        if (!rootEl) return;
        const body = rootEl.querySelector('.acc-v7-body');
        if (!body) return;

        const progress = scheduler ? scheduler.getProgress() : null;
        const totalPages = Math.ceil(accounts.length / PAGE_SIZE);
        if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

        // 分页计算
        const startIdx = currentPage * PAGE_SIZE;
        const endIdx = Math.min(startIdx + PAGE_SIZE, accounts.length);
        const pageAccounts = accounts.slice(startIdx, endIdx);

        let accountsHtml = '';
        if (accounts.length === 0) {
            accountsHtml = `<div class="acc-v7-empty">${ICON.empty} 暂无账号，点击下方添加</div>`;
        } else {
            for (let i = 0; i < pageAccounts.length; i++) {
                const realIdx = startIdx + i;
                const acc = pageAccounts[i];
                const isActive = scheduler && scheduler.currentIndex === realIdx;
                const ipInfo = ipPool[realIdx] ? `<span style="font-size:10px;color:var(--acc-text-muted);margin-left:4px">IP:${escapeHtml(ipPool[realIdx])}</span>` : '';
                accountsHtml += `
                    <div class="acc-v7-account-item${isActive ? ' active' : ''}" data-index="${realIdx}">
                        <div class="acc-v7-account-dot"></div>
                        <div class="acc-v7-account-name" title="${escapeHtml(acc.name)}&#10;${escapeHtml(acc.username)}">${escapeHtml(acc.name)}${ipInfo}</div>
                        <div class="acc-v7-account-actions">
                            <button class="btn-switch" data-index="${realIdx}" title="切换">${ICON.refresh}</button>
                            <button class="btn-edit" data-index="${realIdx}" title="编辑">${ICON.edit}</button>
                            <button class="btn-delete" data-index="${realIdx}" title="删除">${ICON.trash}</button>
                        </div>
                    </div>
                `;
            }
        }

        // 分页控件
        let paginationHtml = '';
        if (totalPages > 1) {
            paginationHtml = `
                <div class="acc-v7-pagination">
                    <button id="acc-page-prev" ${currentPage <= 0 ? 'disabled' : ''}>${ICON.arrow.replace('class="acc-svg"','class="acc-svg" style="transform:rotate(180deg)"')}</button>
                    <span class="acc-v7-page-info">${currentPage + 1}/${totalPages}</span>
                    <button id="acc-page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>${ICON.arrow}</button>
                </div>`;
        }

        // 当前账号
        let currentHtml = '';
        if (scheduler && scheduler.isRunning && progress && progress.nextAccount) {
            currentHtml = `
                <div class="acc-v7-current">
                    <div class="acc-v7-current-dot"></div>
                    <div class="acc-v7-current-info">
                        <div class="acc-v7-current-name">${ICON.refresh} ${escapeHtml(progress.nextAccount)}</div>
                        <div class="acc-v7-current-user">轮巡中 · ${progress.current}/${progress.total}</div>
                    </div>
                </div>`;
        } else if (isOnGamePage()) {
            const nameEl = document.querySelector('.game-header .hdr-name');
            const curName = nameEl ? nameEl.textContent.trim() : '';
            currentHtml = `
                <div class="acc-v7-current">
                    <div class="acc-v7-current-dot"></div>
                    <div class="acc-v7-current-info">
                        <div class="acc-v7-current-name">${escapeHtml(curName || '游戏中')}</div>
                        <div class="acc-v7-current-user">当前在线</div>
                    </div>
                </div>`;
        }

        // 轮巡控制
        let rotationHtml = '';
        const isRunning = scheduler && scheduler.isRunning;
        rotationHtml = `
            <div class="acc-v7-rotation-status">
                <div class="acc-v7-rotation-btns">
                    ${!isRunning
                        ? `<button class="btn-start" id="rot-start" ${accounts.length < 2 ? 'disabled' : ''}>${ICON.play} 启动</button>`
                        : `<button class="btn-pause" id="rot-pause">${ICON.pause} 暂停</button>`
                    }
                    <button class="btn-stop" id="rot-stop" ${!isRunning && (!scheduler || scheduler.currentIndex === 0) ? 'disabled' : ''}>${ICON.stop} 停止</button>
                </div>
            </div>
            <div class="acc-v7-rotation-interval">
                <span>切换间隔:</span>
                <input type="number" id="rot-interval" value="${settings.rotationInterval}" min="5" max="3600" style="width:55px">
                <span>秒</span>
                <button id="rot-interval-dec">${ICON.minus}</button>
                <button id="rot-interval-inc">${ICON.plus2}</button>
            </div>`;

        // 倒计时
        if (isRunning && progress && progress.secondsLeft > 0) {
            rotationHtml += `
                <div class="acc-v7-countdown">
                    ${ICON.hourglass} 下次切换: <span class="highlight">${progress.secondsLeft}秒</span> ${ICON.arrow} ${escapeHtml(progress.nextAccount || '')}
                </div>`;
        }

        // IP防护设置（增强版）
        const ipActiveCount = ipPool.filter(Boolean).length;
        let ipDetailHtml = '';
        if (ipConfig.enabled && ipPool.length > 0 && accounts.length > 0) {
            const ipItems = [];
            const pageStart = currentPage * PAGE_SIZE;
            const pageEnd = Math.min(pageStart + PAGE_SIZE, accounts.length);
            for (let i = pageStart; i < pageEnd; i++) {
                const a = accounts[i];
                const ip = ipPool[i];
                if (ip) ipItems.push(`${escapeHtml(a.name)} → ${escapeHtml(ip)}`);
            }
            if (ipItems.length > 0) {
                ipDetailHtml = `<div style="font-size:11px;color:var(--acc-text-muted);margin-top:4px">${ipItems.join(' · ')}</div>`;
            }
        }

        body.innerHTML = `
            ${currentHtml}
            <div class="acc-v7-card">
                <div class="acc-v7-card-title">账号列表 (${accounts.length})${totalPages > 1 ? ` - 第${currentPage + 1}页` : ''}</div>
                ${accountsHtml}
                ${paginationHtml}
                <button class="acc-v7-add-btn" id="acc-add-btn">${ICON.plus} 添加账号</button>
            </div>
            <div class="acc-v7-card">
                <div class="acc-v7-card-title">${ICON.refresh} 自动轮巡</div>
                ${rotationHtml}
            </div>
            <div class="acc-v7-card">
                <div class="acc-v7-card-title">${ICON.shield} IP深度防护</div>
                <div class="acc-v7-ip-row">
                    <span>启用IP伪装</span>
                    <label class="acc-v7-toggle">
                        <input type="checkbox" id="ip-enabled" ${ipConfig.enabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="acc-v7-ip-row">
                    <span>拦截API请求</span>
                    <label class="acc-v7-toggle">
                        <input type="checkbox" id="ip-intercept" ${ipConfig.interceptApi ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="acc-v7-ip-row">
                    <span>自动分配独立IP</span>
                    <label class="acc-v7-toggle">
                        <input type="checkbox" id="ip-autoassign" ${ipConfig.autoAssignIp ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="acc-v7-ip-row">
                    <span>随机延迟</span>
                    <label class="acc-v7-toggle">
                        <input type="checkbox" id="ip-delay" ${ipConfig.randomDelay ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="acc-v7-ip-row">
                    <span>IP前缀</span>
                    <input type="text" id="ip-prefix" value="${ipConfig.ipPrefix}" style="width:80px">
                </div>
                <div style="display:flex;gap:6px;margin-top:4px">
                    <span style="font-size:11px;color:var(--acc-text-muted)">已分配IP: ${ipActiveCount}</span>
                </div>
                ${ipDetailHtml}
            </div>
            <div class="acc-v7-card">
                <div class="acc-v7-actions">
                    <button id="acc-btn-import" title="导入配置">${ICON.download} 导入</button>
                    <button id="acc-btn-export" title="导出配置">${ICON.upload} 导出</button>
                    <button id="acc-btn-batch" title="批量导入">${ICON.list} 批量</button>
                </div>
            </div>
        `;

        // 绑定事件
        bindBodyEvents();
    }

    function bindBodyEvents() {
        if (!rootEl) return;
        const body = rootEl.querySelector('.acc-v7-body');
        if (!body) return;

        // 分页按钮
        const pagePrev = body.querySelector('#acc-page-prev');
        const pageNext = body.querySelector('#acc-page-next');
        if (pagePrev) pagePrev.onclick = () => { if (currentPage > 0) { currentPage--; renderBody(); } };
        if (pageNext) pageNext.onclick = () => {
            const totalPages = Math.ceil(accounts.length / PAGE_SIZE);
            if (currentPage < totalPages - 1) { currentPage++; renderBody(); }
        };

        // 账号列表事件
        body.querySelectorAll('.btn-switch').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.index);
                IPProtector.applyIP(idx);
                switchToAccount(accounts[idx], idx);
            };
        });
        body.querySelectorAll('.btn-edit').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.index);
                openAccountEditModal(idx);
            };
        });
        body.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.index);
                if (confirm(`确定删除账号"${accounts[idx].name}"吗？`)) {
                    accounts.splice(idx, 1);
                    saveAccounts();
                    if (scheduler && scheduler.isRunning && accounts.length < 2) {
                        scheduler.stop();
                    }
                    // 调整分页
                    const totalPages = Math.ceil(accounts.length / PAGE_SIZE);
                    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);
                    renderBody();
                    showToast(`${ICON.ok} 账号已删除`);
                }
            };
        });

        // 点击账号行切换
        body.querySelectorAll('.acc-v7-account-item').forEach(item => {
            item.onclick = (e) => {
                if (e.target.closest('button')) return;
                const idx = parseInt(item.dataset.index);
                IPProtector.applyIP(idx);
                switchToAccount(accounts[idx], idx);
            };
        });

        // 添加按钮
        const addBtn = body.querySelector('#acc-add-btn');
        if (addBtn) addBtn.onclick = () => openAccountEditModal();

        // 轮巡按钮
        const startBtn = body.querySelector('#rot-start');
        const pauseBtn = body.querySelector('#rot-pause');
        const stopBtn = body.querySelector('#rot-stop');

        if (startBtn) startBtn.onclick = () => { if (scheduler) scheduler.start(); };
        if (pauseBtn) pauseBtn.onclick = () => { if (scheduler) scheduler.pause(); };
        if (stopBtn) stopBtn.onclick = () => { if (scheduler) scheduler.stop(); };

        // 轮巡间隔
        const intervalInput = body.querySelector('#rot-interval');
        if (intervalInput) {
            intervalInput.onchange = () => {
                const val = parseInt(intervalInput.value);
                if (val >= 5 && val <= 3600) {
                    settings.rotationInterval = val;
                    saveSettings();
                }
            };
        }
        const decBtn = body.querySelector('#rot-interval-dec');
        const incBtn = body.querySelector('#rot-interval-inc');
        if (decBtn) decBtn.onclick = () => {
            settings.rotationInterval = Math.max(5, (settings.rotationInterval || 60) - 5);
            saveSettings();
            renderBody();
        };
        if (incBtn) incBtn.onclick = () => {
            settings.rotationInterval = Math.min(3600, (settings.rotationInterval || 60) + 5);
            saveSettings();
            renderBody();
        };

        // IP 防护 - 增强版
        const ipEnabled = body.querySelector('#ip-enabled');
        const ipIntercept = body.querySelector('#ip-intercept');
        const ipAutoassign = body.querySelector('#ip-autoassign');
        const ipDelay = body.querySelector('#ip-delay');
        const ipPrefix = body.querySelector('#ip-prefix');

        if (ipEnabled) {
            ipEnabled.onchange = () => {
                ipConfig.enabled = ipEnabled.checked;
                saveIpConfig();
                if (ipConfig.enabled && ipConfig.interceptApi) {
                    installFetchInterceptor();
                }
                renderBody();
            };
        }
        if (ipIntercept) {
            ipIntercept.onchange = () => {
                ipConfig.interceptApi = ipIntercept.checked;
                saveIpConfig();
                if (ipConfig.enabled && ipConfig.interceptApi) {
                    installFetchInterceptor();
                }
                renderBody();
            };
        }
        if (ipAutoassign) {
            ipAutoassign.onchange = () => {
                ipConfig.autoAssignIp = ipAutoassign.checked;
                saveIpConfig();
                renderBody();
            };
        }
        if (ipDelay) {
            ipDelay.onchange = () => {
                ipConfig.randomDelay = ipDelay.checked;
                saveIpConfig();
                renderBody();
            };
        }
        if (ipPrefix) {
            ipPrefix.onchange = () => {
                ipConfig.ipPrefix = ipPrefix.value.trim() || '10.0';
                saveIpConfig();
                renderBody();
            };
        }

        // 操作按钮
        const btnImport = body.querySelector('#acc-btn-import');
        const btnExport = body.querySelector('#acc-btn-export');
        const btnBatch = body.querySelector('#acc-btn-batch');
        if (btnImport) btnImport.onclick = importConfig;
        if (btnExport) btnExport.onclick = exportConfig;
        if (btnBatch) btnBatch.onclick = openBatchImportModal;
    }

    // ===================================================================
    //  创建悬浮窗
    // ===================================================================
    function createFloatingWindow() {
        if (rootEl) return;

        isDark = detectTheme() === 'dark';
        isMinimized = settings.isMinimized || false;

        // 容器
        rootEl = document.createElement('div');
        rootEl.className = 'acc-v7-window' + (isDark ? '' : ' acc-v7-theme-light');
        rootEl.style.width = (settings.windowSize.width || 300) + 'px';
        rootEl.style.height = (settings.windowSize.height || 440) + 'px';
        rootEl.style.left = (settings.windowPosition.x || 100) + 'px';
        rootEl.style.top = (settings.windowPosition.y || 100) + 'px';

        if (isMinimized) {
            rootEl.style.display = 'none';
        }

        // 标题栏
        const titleBar = document.createElement('div');
        titleBar.className = 'acc-v7-titlebar';
        titleBar.innerHTML = `
            <div class="acc-v7-title">
                <span class="acc-v7-title-icon">${ICON.refresh}</span>
                账号切换器 v7.1
            </div>
            <div class="acc-v7-titlebar-btns">
                <button id="acc-win-minimize" title="最小化">${ICON.minimize}</button>
                <button id="acc-win-close" title="关闭">${ICON.close}</button>
            </div>
        `;

        // 内容区
        const body = document.createElement('div');
        body.className = 'acc-v7-body';

        // 缩放手柄
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'acc-v7-resize-handle';

        rootEl.appendChild(titleBar);
        rootEl.appendChild(body);
        rootEl.appendChild(resizeHandle);
        document.body.appendChild(rootEl);

        // 拖动
        new DragHandler(rootEl, titleBar).init();

        // 缩放
        new ResizeHandler(rootEl, resizeHandle).init();

        // 最小化
        rootEl.querySelector('#acc-win-minimize').onclick = toggleMinimize;
        rootEl.querySelector('#acc-win-close').onclick = () => {
            rootEl.style.display = 'none';
            minimizedBtn = null;
            isMinimized = true;
            settings.isMinimized = true;
            saveSettings();
            showMinimizedIcon();
        };

        // 主题监听
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (settings.theme === 'auto') {
                updateTheme();
            }
        });

        renderBody();
        log('悬浮窗已创建');
    }

    function updateTheme() {
        const dark = detectTheme() === 'dark';
        if (dark === isDark) return;
        isDark = dark;
        if (rootEl) {
            rootEl.classList.toggle('acc-v7-theme-light', !dark);
        }
    }

    function toggleMinimize() {
        isMinimized = !isMinimized;
        settings.isMinimized = isMinimized;
        saveSettings();

        if (isMinimized) {
            rootEl.style.display = 'none';
            showMinimizedIcon();
        } else {
            rootEl.style.display = '';
            if (minimizedBtn) {
                minimizedBtn.remove();
                minimizedBtn = null;
            }
        }
    }

    function showMinimizedIcon() {
        if (minimizedBtn) return;
        minimizedBtn = document.createElement('div');
        minimizedBtn.className = 'acc-v7-minimized';
        minimizedBtn.innerHTML = ICON.refresh;
        minimizedBtn.title = '账号切换器 v7.0';
        minimizedBtn.onclick = () => {
            isMinimized = false;
            settings.isMinimized = false;
            saveSettings();
            rootEl.style.display = '';
            minimizedBtn.remove();
            minimizedBtn = null;
            renderBody();
        };
        document.body.appendChild(minimizedBtn);
    }

    // ===================================================================
    //  初始化
    // ===================================================================
    function init() {
        // 0) 安装 fetch 拦截器（最早时机，因 @run-at document-start）
        loadIpConfig();
        loadIpPool();
        if (ipConfig.enabled && ipConfig.interceptApi) {
            installFetchInterceptor();
        }

        // 1) 迁移 v6 → v7（在 loadAccounts 之前）
        migrateFromV6();

        // 2) 加载存储
        loadAccounts();
        loadSettings();

        // 3) 注入 CSS
        injectStyles();

        // 4) 初始化调度器
        scheduler = new RotationScheduler(renderBody);

        // 5) 重置分页
        currentPage = 0;

        // 6) 等待游戏页面加载后创建 UI
        const checkInterval = setInterval(() => {
            if (document.querySelector('.game-header .hdr-name')) {
                clearInterval(checkInterval);
                createFloatingWindow();

                // 恢复轮巡
                if (settings.rotationEnabled && accounts.length >= 2) {
                    log('恢复自动轮巡...');
                    setTimeout(() => scheduler.start(), 2000);
                }

                log('账号切换助手 v7.1 已启动');
            }
        }, 1000);

        // 超时保护
        setTimeout(() => {
            if (!rootEl && document.querySelector('.game-header .hdr-name')) {
                createFloatingWindow();
            }
        }, 30000);
    }

    // ── 启动 ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
