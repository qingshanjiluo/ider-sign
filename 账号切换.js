// ==UserScript==
// @name         艾德尔修仙传·账号切换助手 v6.0
// @namespace    https://idlexiuxianzhuan.cn/
// @version      6.0
// @description  大版本更新：退出按钮旁新增切换下拉菜单 · 面板嵌入角色侧栏 · 配置导入/导出 · 快捷注册账号
// @author       宝黄天
// @match        https://idlexiuxianzhuan.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===================================================================
    //  常量
    // ===================================================================
    const STORAGE_KEY = 'AccSwitcher_Accounts_v6';
    const STORAGE_SETTINGS = 'AccSwitcher_Settings_v6';
    const CSS_ID = 'acc-switcher-v6-style';

    // ===================================================================
    //  状态
    // ===================================================================
    let accounts = [];
    let settings = { theme: 'auto', autoSwitchDelay: 0 };
    let isSwitching = false;
    let dropdownVisible = false;
    let dropdownEl = null;
    let switchBtnEl = null;
    let sidebarPanelEl = null;

    // ===================================================================
    //  工具函数
    // ===================================================================
    function log(msg) { console.log('[账号切换v6]', msg); }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m =>
            ({ '&':'&','<':'<','>':'>','"':'"',"'":'\x27' }[m] || m));
    }

    /** 等待元素出现（轮询） */
    async function waitForElement(selector, timeout = 15000, root = document) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = root.querySelector(selector);
            if (el) return el;
            await sleep(200);
        }
        return null;
    }

    /** 关闭可能弹出的模态框 */
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

    function getMachineId() {
        return window.machine_id || 'web_18cn3sm';
    }

    // ===================================================================
    //  存储
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
                settings = { ...settings, ...parsed };
            }
        } catch(e) { /* 使用默认值 */ }
    }

    function saveSettings() {
        GM_setValue(STORAGE_SETTINGS, JSON.stringify(settings));
    }

    // ===================================================================
    //  注入 CSS
    // ===================================================================
    function injectStyles() {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = `
            /* ── 切换按钮（header 中退出按钮右侧） ── */
            .acc-switch-btn {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                border: none !important;
                color: white !important;
                font-size: 16px !important;
                cursor: pointer !important;
                border-radius: 8px !important;
                width: 36px !important;
                height: 36px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: transform 0.15s, box-shadow 0.15s !important;
                box-shadow: 0 2px 8px rgba(102,126,234,0.4) !important;
                margin-left: 4px !important;
                position: relative !important;
                line-height: 1 !important;
                padding: 0 !important;
            }
            .acc-switch-btn:hover {
                transform: scale(1.08);
                box-shadow: 0 4px 14px rgba(102,126,234,0.6);
            }
            .acc-switch-btn:active {
                transform: scale(0.95);
            }

            /* ── 下拉面板 ── */
            .acc-dropdown {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                width: 280px;
                background: #1e1e2aee;
                backdrop-filter: blur(16px);
                border: 1px solid #667eea;
                border-radius: 16px;
                padding: 10px;
                z-index: 999999;
                font-family: system-ui, sans-serif;
                font-size: 13px;
                color: #eee;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                display: none;
                max-height: 420px;
                overflow-y: auto;
            }
            .acc-dropdown.show {
                display: block;
                animation: accFadeIn 0.15s ease-out;
            }
            @keyframes accFadeIn {
                from { opacity: 0; transform: translateY(-6px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            .acc-dd-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding-bottom: 8px;
                border-bottom: 1px solid #3a3a4a;
                margin-bottom: 6px;
                font-weight: 600;
                font-size: 14px;
            }
            .acc-dd-header-actions {
                display: flex;
                gap: 4px;
            }
            .acc-dd-header-actions button {
                background: none;
                border: 1px solid #555;
                color: #ccc;
                padding: 2px 8px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 11px;
                transition: background 0.15s;
            }
            .acc-dd-header-actions button:hover {
                background: #3a3a4a;
            }

            .acc-dd-list {
                max-height: 220px;
                overflow-y: auto;
            }
            .acc-dd-list::-webkit-scrollbar {
                width: 4px;
            }
            .acc-dd-list::-webkit-scrollbar-thumb {
                background: #667eea;
                border-radius: 2px;
            }

            .acc-dd-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 6px;
                border-radius: 10px;
                transition: background 0.12s;
                cursor: default;
            }
            .acc-dd-item:hover {
                background: #2a2a3a;
            }
            .acc-dd-item .acc-name {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
            }
            .acc-dd-item .acc-actions {
                display: flex;
                gap: 4px;
                flex-shrink: 0;
            }
            .acc-dd-item .acc-actions button {
                border: none;
                color: white;
                padding: 3px 10px;
                border-radius: 14px;
                cursor: pointer;
                font-size: 11px;
                transition: opacity 0.12s;
            }
            .acc-dd-item .acc-actions button:hover { opacity: 0.8; }
            .acc-dd-item .acc-actions .btn-switch  { background: #2c6e2c; }
            .acc-dd-item .acc-actions .btn-edit    { background: #2980b9; }
            .acc-dd-item .acc-actions .btn-delete  { background: #8b3c3c; }

            .acc-dd-empty {
                padding: 20px 0;
                text-align: center;
                color: #888;
                font-size: 13px;
            }

            .acc-dd-footer {
                display: flex;
                gap: 6px;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid #3a3a4a;
            }
            .acc-dd-footer button {
                flex: 1;
                background: #3a3a4a;
                border: none;
                color: #ddd;
                padding: 6px 0;
                border-radius: 12px;
                cursor: pointer;
                font-size: 12px;
                transition: background 0.12s;
            }
            .acc-dd-footer button:hover {
                background: #4a4a5a;
            }
            .acc-dd-footer .btn-register {
                background: linear-gradient(135deg, #e67e22, #f39c12);
                color: #fff;
            }
            .acc-dd-footer .btn-register:hover {
                background: linear-gradient(135deg, #d35400, #e67e22);
            }

            /* ── 侧栏嵌入面板 ── */
            .acc-sidebar-panel {
                margin-top: 10px;
                padding: 10px 12px;
                background: #1a1a28cc;
                border-radius: 12px;
                border: 1px solid #3a3a5a;
                font-size: 12px;
            }
            .acc-sidebar-panel .sp-title {
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 6px;
                color: #a78bfa;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .acc-sidebar-panel .sp-list {
                max-height: 160px;
                overflow-y: auto;
            }
            .acc-sidebar-panel .sp-list::-webkit-scrollbar { width: 3px; }
            .acc-sidebar-panel .sp-list::-webkit-scrollbar-thumb { background: #667eea; border-radius: 2px; }
            .acc-sidebar-panel .sp-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 4px;
                border-radius: 6px;
                transition: background 0.1s;
            }
            .acc-sidebar-panel .sp-item:hover { background: #2a2a3a; }
            .acc-sidebar-panel .sp-item .sp-name {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 12px;
            }
            .acc-sidebar-panel .sp-item .sp-switch {
                background: #2c6e2c;
                border: none;
                color: white;
                padding: 2px 10px;
                border-radius: 12px;
                cursor: pointer;
                font-size: 11px;
                flex-shrink: 0;
            }
            .acc-sidebar-panel .sp-item .sp-switch:hover { opacity: 0.8; }
            .acc-sidebar-panel .sp-empty {
                text-align: center;
                color: #666;
                padding: 10px 0;
                font-size: 12px;
            }
            .acc-sidebar-panel .sp-add-btn {
                width: 100%;
                margin-top: 6px;
                background: #3a3a4a;
                border: 1px dashed #555;
                color: #aaa;
                padding: 5px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 12px;
                transition: background 0.12s;
            }
            .acc-sidebar-panel .sp-add-btn:hover {
                background: #4a4a5a;
                color: #ddd;
            }

            /* ── 注册模态框 ── */
            .acc-modal-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(4px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: accFadeIn 0.15s ease-out;
            }
            .acc-modal-box {
                background: #1e1e2a;
                border: 1px solid #667eea;
                border-radius: 20px;
                padding: 24px;
                width: 340px;
                max-width: 90vw;
                box-shadow: 0 12px 48px rgba(0,0,0,0.6);
                font-family: system-ui, sans-serif;
                color: #eee;
            }
            .acc-modal-box h3 {
                margin: 0 0 16px 0;
                font-size: 18px;
                text-align: center;
                color: #a78bfa;
            }
            .acc-modal-box .acc-field {
                margin-bottom: 12px;
            }
            .acc-modal-box .acc-field label {
                display: block;
                font-size: 12px;
                color: #aaa;
                margin-bottom: 4px;
            }
            .acc-modal-box .acc-field input {
                width: 100%;
                padding: 8px 12px;
                background: #2a2a3a;
                border: 1px solid #444;
                border-radius: 10px;
                color: #eee;
                font-size: 14px;
                outline: none;
                box-sizing: border-box;
                transition: border-color 0.15s;
            }
            .acc-modal-box .acc-field input:focus {
                border-color: #667eea;
            }
            .acc-modal-box .acc-error {
                color: #e74c3c;
                font-size: 12px;
                margin-bottom: 8px;
                text-align: center;
            }
            .acc-modal-box .acc-success {
                color: #2ecc71;
                font-size: 12px;
                margin-bottom: 8px;
                text-align: center;
            }
            .acc-modal-box .acc-modal-actions {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }
            .acc-modal-box .acc-modal-actions button {
                flex: 1;
                padding: 8px 0;
                border: none;
                border-radius: 12px;
                cursor: pointer;
                font-size: 14px;
                transition: opacity 0.12s;
            }
            .acc-modal-box .acc-modal-actions button:hover { opacity: 0.85; }
            .acc-modal-box .acc-modal-actions .btn-primary {
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white;
            }
            .acc-modal-box .acc-modal-actions .btn-cancel {
                background: #3a3a4a;
                color: #ccc;
            }

            /* ── Toast 通知 ── */
            .acc-toast {
                position: fixed;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                background: #1e1e2aee;
                backdrop-filter: blur(12px);
                border: 1px solid #667eea;
                color: #eee;
                padding: 10px 24px;
                border-radius: 30px;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                z-index: 9999999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                animation: accFadeIn 0.2s ease-out;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    // ===================================================================
    //  Toast 通知
    // ===================================================================
    function showToast(msg, duration = 2500) {
        const existing = document.querySelector('.acc-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'acc-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
    }

    // ===================================================================
    //  切换账号核心逻辑
    // ===================================================================
    async function switchToAccount(account) {
        if (isSwitching) {
            showToast('正在切换中，请稍后再试');
            return;
        }
        isSwitching = true;
        hideDropdown();

        try {
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
            }

            // 步骤2：打开新标签页登录
            const newTab = window.open('https://idlexiuxianzhuan.cn/web/', '_blank');
            if (!newTab) {
                alert('请允许弹出窗口，或手动点击允许');
                isSwitching = false;
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
            showToast(`✅ 已切换至 ${account.name}`);
            if (typeof GM_notification === 'function') {
                GM_notification({ text: `已切换至 ${account.name}`, timeout: 2000 });
            }
        } catch (err) {
            log('切换失败:', err);
            showToast(`❌ 切换失败: ${err.message}`);
        } finally {
            isSwitching = false;
        }
    }

    // ===================================================================
    //  快捷注册（通过 API 直接注册）
    // ===================================================================
    async function quickRegister(username, password) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://idlexiuxianzhuan.cn/api/auth/register',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    username: username,
                    password: password,
                    machine_id: getMachineId()
                }),
                onload: function(resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        if (data.ok || data.token) {
                            resolve(data);
                        } else {
                            reject(new Error(data.error || '注册失败'));
                        }
                    } catch(e) {
                        reject(new Error('解析响应失败'));
                    }
                },
                onerror: function() {
                    reject(new Error('网络请求失败'));
                }
            });
        });
    }

    // ===================================================================
    //  配置导入/导出
    // ===================================================================
    function exportConfig() {
        const payload = {
            version: '6.0',
            exportedAt: new Date().toISOString(),
            accounts: accounts.map(a => ({
                name: a.name,
                username: a.username,
                password: a.password
            })),
            settings: settings
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `艾德尔账号配置_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ 配置已导出');
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
                    if (!Array.isArray(data.accounts)) {
                        showToast('❌ 无效的配置文件');
                        return;
                    }
                    // 选择覆盖或合并
                    const mode = confirm('点击"确定"覆盖现有账号列表，点击"取消"合并导入');
                    if (mode) {
                        // 覆盖
                        accounts = data.accounts.map(a => ({
                            name: a.name || a.username,
                            username: a.username,
                            password: a.password
                        }));
                    } else {
                        // 合并（按用户名去重）
                        const existingUsernames = new Set(accounts.map(a => a.username));
                        for (const a of data.accounts) {
                            if (!existingUsernames.has(a.username)) {
                                accounts.push({
                                    name: a.name || a.username,
                                    username: a.username,
                                    password: a.password
                                });
                                existingUsernames.add(a.username);
                            }
                        }
                    }
                    if (data.settings) {
                        settings = { ...settings, ...data.settings };
                        saveSettings();
                    }
                    saveAccounts();
                    renderDropdown();
                    renderSidebarPanel();
                    showToast(`✅ 已导入 ${data.accounts.length} 个账号`);
                } catch(err) {
                    showToast('❌ 导入失败: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // ===================================================================
    //  账号管理
    // ===================================================================
    function addOrEditAccount(index = -1) {
        const isEdit = index >= 0;
        const acc = isEdit ? accounts[index] : { name: '', username: '', password: '' };
        const newName = prompt('账号名称（显示用）:', acc.name);
        if (newName === null) return;
        const newUsername = prompt('登录账号:', acc.username);
        if (newUsername === null) return;
        const newPassword = prompt('登录密码:', acc.password);
        if (newPassword === null) return;
        if (isEdit) {
            accounts[index] = { name: newName, username: newUsername, password: newPassword };
        } else {
            accounts.push({ name: newName, username: newUsername, password: newPassword });
        }
        saveAccounts();
        renderDropdown();
        renderSidebarPanel();
        showToast(isEdit ? '✅ 账号已更新' : '✅ 账号已添加');
    }

    function deleteAccount(index) {
        if (confirm(`确定删除账号"${accounts[index].name}"吗？`)) {
            accounts.splice(index, 1);
            saveAccounts();
            renderDropdown();
            renderSidebarPanel();
            showToast('✅ 账号已删除');
        }
    }

    // ===================================================================
    //  注册模态框
    // ===================================================================
    function openRegisterModal() {
        const overlay = document.createElement('div');
        overlay.className = 'acc-modal-overlay';
        overlay.innerHTML = `
            <div class="acc-modal-box">
                <h3>📝 快捷注册账号</h3>
                <div class="acc-field">
                    <label>显示名称</label>
                    <input type="text" id="acc-reg-name" placeholder="例如：我的小号">
                </div>
                <div class="acc-field">
                    <label>用户名</label>
                    <input type="text" id="acc-reg-username" placeholder="登录用账号名">
                </div>
                <div class="acc-field">
                    <label>密码</label>
                    <input type="password" id="acc-reg-password" placeholder="登录密码">
                </div>
                <div id="acc-reg-msg" class="acc-error" style="display:none"></div>
                <div class="acc-modal-actions">
                    <button class="btn-cancel" id="acc-reg-cancel">取消</button>
                    <button class="btn-primary" id="acc-reg-submit">注册并添加</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const msgEl = overlay.querySelector('#acc-reg-msg');
        function showMsg(text, isError = true) {
            msgEl.textContent = text;
            msgEl.style.display = 'block';
            msgEl.className = isError ? 'acc-error' : 'acc-success';
        }

        overlay.querySelector('#acc-reg-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#acc-reg-submit').onclick = async () => {
            const name = overlay.querySelector('#acc-reg-name').value.trim();
            const username = overlay.querySelector('#acc-reg-username').value.trim();
            const password = overlay.querySelector('#acc-reg-password').value.trim();

            if (!username || !password) {
                showMsg('用户名和密码不能为空');
                return;
            }
            if (username.length < 3) {
                showMsg('用户名至少3个字符');
                return;
            }
            if (password.length < 6) {
                showMsg('密码至少6个字符');
                return;
            }

            const submitBtn = overlay.querySelector('#acc-reg-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = '注册中...';

            try {
                const result = await quickRegister(username, password);
                // 注册成功，添加到账号列表
                accounts.push({
                    name: name || username,
                    username: username,
                    password: password
                });
                saveAccounts();
                renderDropdown();
                renderSidebarPanel();

                showMsg(`✅ 注册成功！已添加账号"${name || username}"`, false);

                // 自动切换到新账号
                setTimeout(async () => {
                    overlay.remove();
                    await switchToAccount(accounts[accounts.length - 1]);
                }, 1200);
            } catch (err) {
                showMsg(`❌ 注册失败: ${err.message}`);
                submitBtn.disabled = false;
                submitBtn.textContent = '注册并添加';
            }
        };

        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // 回车提交
        overlay.querySelector('#acc-reg-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('#acc-reg-submit').click();
        });

        // 自动聚焦用户名
        setTimeout(() => overlay.querySelector('#acc-reg-username').focus(), 100);
    }

    // ===================================================================
    //  渲染下拉面板
    // ===================================================================
    function renderDropdown() {
        if (!dropdownEl) return;
        const listEl = dropdownEl.querySelector('.acc-dd-list');
        if (!listEl) return;

        if (accounts.length === 0) {
            listEl.innerHTML = '<div class="acc-dd-empty">📭 暂无账号，点击下方 ➕ 添加</div>';
            return;
        }

        let html = '';
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            html += `
                <div class="acc-dd-item">
                    <span class="acc-name">${escapeHtml(acc.name)}</span>
                    <div class="acc-actions">
                        <button class="btn-switch" data-index="${i}">切换</button>
                        <button class="btn-edit" data-index="${i}">✎</button>
                        <button class="btn-delete" data-index="${i}">🗑</button>
                    </div>
                </div>
            `;
        }
        listEl.innerHTML = html;

        listEl.querySelectorAll('.btn-switch').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                switchToAccount(accounts[idx]);
            };
        });
        listEl.querySelectorAll('.btn-edit').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                addOrEditAccount(idx);
            };
        });
        listEl.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                deleteAccount(idx);
            };
        });
    }

    function showDropdown() {
        if (!dropdownEl) return;
        dropdownVisible = true;
        dropdownEl.classList.add('show');
        renderDropdown();
    }

    function hideDropdown() {
        if (!dropdownEl) return;
        dropdownVisible = false;
        dropdownEl.classList.remove('show');
    }

    function toggleDropdown() {
        if (dropdownVisible) hideDropdown();
        else showDropdown();
    }

    // ===================================================================
    //  渲染侧栏嵌入面板
    // ===================================================================
    function renderSidebarPanel() {
        if (!sidebarPanelEl) return;
        const listEl = sidebarPanelEl.querySelector('.sp-list');
        if (!listEl) return;

        if (accounts.length === 0) {
            listEl.innerHTML = '<div class="sp-empty">暂无账号</div>';
            return;
        }

        let html = '';
        // 最多显示前 8 个
        const maxShow = Math.min(accounts.length, 8);
        for (let i = 0; i < maxShow; i++) {
            const acc = accounts[i];
            html += `
                <div class="sp-item">
                    <span class="sp-name">${escapeHtml(acc.name)}</span>
                    <button class="sp-switch" data-index="${i}">切换</button>
                </div>
            `;
        }
        if (accounts.length > 8) {
            html += `<div class="sp-item" style="color:#666;justify-content:center;font-size:11px">还有 ${accounts.length - 8} 个账号...</div>`;
        }
        listEl.innerHTML = html;

        listEl.querySelectorAll('.sp-switch').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                switchToAccount(accounts[idx]);
            };
        });
    }

    // ===================================================================
    //  创建切换按钮（header 中退出按钮右侧）
    // ===================================================================
    function createSwitchButton() {
        if (switchBtnEl) return;
        const logoutBtn = document.querySelector('.btn-icon[title="换号/退出"]');
        if (!logoutBtn) return;

        // 如果已经存在则跳过
        if (logoutBtn.parentElement.querySelector('.acc-switch-btn')) return;

        switchBtnEl = document.createElement('button');
        switchBtnEl.className = 'acc-switch-btn btn-icon';
        switchBtnEl.title = '切换账号';
        switchBtnEl.innerHTML = '🔄';
        switchBtnEl.style.position = 'relative';

        // 创建下拉面板
        dropdownEl = document.createElement('div');
        dropdownEl.className = 'acc-dropdown';
        dropdownEl.innerHTML = `
            <div class="acc-dd-header">
                <span>👥 账号切换</span>
                <div class="acc-dd-header-actions">
                    <button id="acc-dd-export" title="导出配置">📤</button>
                    <button id="acc-dd-import" title="导入配置">📥</button>
                </div>
            </div>
            <div class="acc-dd-list"></div>
            <div class="acc-dd-footer">
                <button id="acc-dd-add">➕ 添加</button>
                <button class="btn-register" id="acc-dd-register">📝 注册</button>
            </div>
        `;
        switchBtnEl.appendChild(dropdownEl);

        // 插入到退出按钮旁边
        logoutBtn.parentElement.insertBefore(switchBtnEl, logoutBtn.nextSibling);

        // 事件
        switchBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        dropdownEl.querySelector('#acc-dd-add').onclick = (e) => {
            e.stopPropagation();
            hideDropdown();
            addOrEditAccount();
        };
        dropdownEl.querySelector('#acc-dd-register').onclick = (e) => {
            e.stopPropagation();
            hideDropdown();
            openRegisterModal();
        };
        dropdownEl.querySelector('#acc-dd-export').onclick = (e) => {
            e.stopPropagation();
            hideDropdown();
            exportConfig();
        };
        dropdownEl.querySelector('#acc-dd-import').onclick = (e) => {
            e.stopPropagation();
            hideDropdown();
            importConfig();
        };

        // 点击外部关闭下拉
        document.addEventListener('click', (e) => {
            if (dropdownVisible && switchBtnEl && !switchBtnEl.contains(e.target)) {
                hideDropdown();
            }
        });

        renderDropdown();
        log('切换按钮已创建');
    }

    // ===================================================================
    //  创建侧栏嵌入面板
    // ===================================================================
    function createSidebarPanel() {
        if (sidebarPanelEl) return;
        const sidebar = document.querySelector('.battle-sidebar');
        if (!sidebar) return;

        // 在挂机统计之后、提示文字之前插入
        const hintEl = sidebar.querySelector('.sidebar-hint');
        if (!hintEl) return;

        sidebarPanelEl = document.createElement('div');
        sidebarPanelEl.className = 'acc-sidebar-panel';
        sidebarPanelEl.innerHTML = `
            <div class="sp-title">👥 快捷切换账号</div>
            <div class="sp-list"></div>
            <button class="sp-add-btn">➕ 管理账号列表</button>
        `;

        sidebar.insertBefore(sidebarPanelEl, hintEl);

        sidebarPanelEl.querySelector('.sp-add-btn').onclick = () => {
            // 点击管理按钮 -> 显示下拉面板（如果已创建）或弹出添加对话框
            if (switchBtnEl) {
                // 模拟点击切换按钮显示下拉
                switchBtnEl.click();
            } else {
                addOrEditAccount();
            }
        };

        renderSidebarPanel();
        log('侧栏面板已创建');
    }

    // ===================================================================
    //  初始化
    // ===================================================================
    function init() {
        loadAccounts();
        loadSettings();
        injectStyles();

        // 等待游戏页面加载完成后再创建 UI 元素
        const checkInterval = setInterval(() => {
            const logoutBtn = document.querySelector('.btn-icon[title="换号/退出"]');
            const sidebar = document.querySelector('.battle-sidebar');
            if (logoutBtn) {
                createSwitchButton();
            }
            if (sidebar) {
                createSidebarPanel();
            }
            // 两个都创建完成后停止检查
            if (switchBtnEl && sidebarPanelEl) {
                clearInterval(checkInterval);
                log('账号切换助手 v6.0 已启动');
            }
        }, 1000);

        // 超时保护：30秒后停止检查
        setTimeout(() => {
            if (document.querySelector('.game-header .hdr-name')) {
                // 如果在游戏页面但还没创建成功，再试一次
                if (!switchBtnEl) createSwitchButton();
                if (!sidebarPanelEl) createSidebarPanel();
            }
        }, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();