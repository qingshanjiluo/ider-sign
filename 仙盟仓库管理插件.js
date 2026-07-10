// ==UserScript==
// @name         仙盟仓库管理器（修复版）
// @namespace    https://idlexiuxianzhuan.cn/
// @version      3.2
// @description  修复采集失败问题，增强选择器兼容性和错误日志，可配置翻页延时及页数范围
// @author       宝黄天
// @match        https://idlexiuxianzhuan.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============================= 存储 =============================
    const STORAGE_KEY_HISTORY = 'AllianceWarehouseHistory_v4';
    const STORAGE_KEY_CONFIG = 'AllianceWarehouseConfig';
    const DEFAULT_CONFIG = { pageDelay: 1500, startPage: 0, endPage: 9 };
    let config = { ...DEFAULT_CONFIG };
    let historySnapshots = [];
    let currentSnapshot = null;
    let isCollecting = false;
    let stopCollection = false;

    // ============================= 辅助 =============================
    function log(msg) { console.log('[仓库管理器]', msg); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function loadConfig() {
        const saved = GM_getValue(STORAGE_KEY_CONFIG);
        if (saved) {
            try { config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) }; } catch(e) {}
        }
    }
    function saveConfig() { GM_setValue(STORAGE_KEY_CONFIG, JSON.stringify(config)); }

    function loadHistory() {
        const stored = GM_getValue(STORAGE_KEY_HISTORY);
        if (stored) {
            try { historySnapshots = JSON.parse(stored); if (!Array.isArray(historySnapshots)) historySnapshots = []; } catch(e) { historySnapshots = []; }
        }
    }
    function saveHistory() {
        if (historySnapshots.length > 30) historySnapshots = historySnapshots.slice(0, 30);
        GM_setValue(STORAGE_KEY_HISTORY, JSON.stringify(historySnapshots));
    }

    // 解析单个格子（增强容错）
    function parseSlot(slotDiv) {
        const nameSpan = slotDiv.querySelector('.slot-name');
        if (!nameSpan) return null;
        let name = nameSpan.innerText.trim();
        let count = 1;
        const countSpan = slotDiv.querySelector('.slot-count');
        if (countSpan) {
            const match = countSpan.innerText.match(/x(\d+)/);
            if (match) count = parseInt(match[1]);
        }
        const style = nameSpan.getAttribute('style');
        let color = null, quality = '普通';
        if (style) {
            const rgb = style.match(/color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (rgb) color = `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
        }
        if (color === 'rgb(68, 136, 255)') quality = '蓝色';
        else if (color === 'rgb(128, 0, 128)') quality = '紫色';
        else if (color === 'rgb(255, 215, 0)') quality = '金色';
        else if (color === 'rgb(255, 100, 100)') quality = '红色';
        const isSet = name.includes('套') || name.includes('异界');
        return { name, count, color, quality, isSet };
    }

    // 抓取当前页装备（使用多个选择器尝试）
    async function captureCurrentPage() {
        let grid = document.querySelector('.warehouse-grid');
        if (!grid) {
            // 备选：仓库网格可能在其他容器中
            grid = document.querySelector('[class*="warehouse-grid"]');
            if (!grid) {
                log('⚠️ 未找到仓库网格元素，尝试查找所有格子');
                const allSlots = document.querySelectorAll('.warehouse-slot');
                if (allSlots.length > 0) {
                    const items = [];
                    for (let slot of allSlots) {
                        const item = parseSlot(slot);
                        if (item) items.push(item);
                    }
                    log(`通过直接查找格子找到 ${items.length} 件装备`);
                    return items;
                }
                return [];
            }
        }
        const slots = grid.querySelectorAll('.warehouse-slot');
        const items = [];
        for (let slot of slots) {
            const item = parseSlot(slot);
            if (item) items.push(item);
        }
        log(`当前页采集到 ${items.length} 件装备`);
        return items;
    }

    // 跳转到指定页（增强事件）
    async function goToPage(pageNum) {
        const pageInput = document.querySelector('.form-hint input.input-sm, .warehouse-grid ~ .form-hint input.input-sm');
        if (!pageInput) {
            log('❌ 未找到页数输入框');
            return false;
        }
        const currentVal = parseInt(pageInput.value);
        if (currentVal === pageNum) return true;
        pageInput.value = pageNum;
        // 触发所有可能的事件
        ['focus', 'input', 'change', 'blur'].forEach(ev => {
            pageInput.dispatchEvent(new Event(ev, { bubbles: true }));
        });
        // 尝试点击跳转按钮（如有）
        const gotoBtn = document.querySelector('.pagination-goto, .goto-page, .go-button');
        if (gotoBtn) gotoBtn.click();
        // 等待网格内容变化（通过 MutationObserver 或轮询）
        const waitStart = Date.now();
        const getFirstItemName = () => {
            const grid = document.querySelector('.warehouse-grid') || document.querySelector('[class*="warehouse-grid"]');
            if (!grid) return null;
            const firstSlot = grid.querySelector('.warehouse-slot');
            return firstSlot ? firstSlot.querySelector('.slot-name')?.innerText : null;
        };
        const oldName = getFirstItemName();
        while (Date.now() - waitStart < 5000) {
            await sleep(200);
            const newName = getFirstItemName();
            if (newName !== oldName) break;
        }
        await sleep(config.pageDelay);
        return true;
    }

    // 采集指定范围页
    async function capturePagesInRange() {
        const pagesData = [];
        const start = Math.max(0, config.startPage);
        const end = Math.min(9, config.endPage);
        if (start > end) { alert('起始页不能大于结束页'); return null; }
        log(`开始采集页数: ${start} ~ ${end}，翻页延时: ${config.pageDelay}ms`);
        for (let page = start; page <= end; page++) {
            if (stopCollection) break;
            log(`正在跳转到第 ${page} 页...`);
            const ok = await goToPage(page);
            if (!ok) {
                log(`跳转第 ${page} 页失败，跳过`);
                continue;
            }
            await sleep(500);
            const items = await captureCurrentPage();
            pagesData.push({ page, items, itemCount: items.length });
            log(`第 ${page} 页采集完成，获得 ${items.length} 件装备`);
        }
        return pagesData;
    }

    // 创建快照
    function createSnapshot(pagesData) {
        return {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            startPage: config.startPage,
            endPage: config.endPage,
            totalPages: pagesData.length,
            totalItems: pagesData.reduce((s, p) => s + p.items.length, 0),
            pagesData: pagesData
        };
    }

    // 主采集函数
    async function performCollection(saveToHistory = true) {
        if (isCollecting) { alert('正在采集中，请稍后'); return null; }
        isCollecting = true;
        stopCollection = false;
        try {
            const pagesData = await capturePagesInRange();
            if (!pagesData) return null;
            const totalItems = pagesData.reduce((s, p) => s + p.items.length, 0);
            if (totalItems === 0) {
                alert('采集完成，但未找到任何装备。请确认当前在仙盟仓库页面且仓库内有物品。\n如果问题持续，请按F12查看控制台日志反馈。');
                log('⚠️ 采集结果为空，请检查页面结构或是否有装备');
                return null;
            }
            const snapshot = createSnapshot(pagesData);
            currentSnapshot = snapshot;
            if (saveToHistory) {
                historySnapshots.unshift(snapshot);
                saveHistory();
                if (typeof GM_notification === 'function') {
                    GM_notification({ text: `快照已保存 (${snapshot.totalItems}件装备)`, timeout: 2000 });
                }
            }
            renderEquipmentList(snapshot);
            return snapshot;
        } catch (err) {
            log('采集出错:', err);
            alert('采集失败：' + err.message);
            return null;
        } finally {
            isCollecting = false;
        }
    }

    // ============================= 导出文本 =============================
    function exportSnapshotAsText(snapshot) {
        let text = `========== 仙盟仓库快照 ==========\n`;
        text += `时间：${new Date(snapshot.timestamp).toLocaleString()}\n`;
        text += `采集范围：第 ${snapshot.startPage} ~ ${snapshot.endPage} 页\n`;
        text += `总装备数：${snapshot.totalItems}\n`;
        text += `===================================\n\n`;
        for (let page of snapshot.pagesData) {
            text += `【第 ${page.page} 页】共 ${page.itemCount} 件装备\n`;
            for (let item of page.items) {
                text += `  ${item.name}  x${item.count}  (${item.quality})`;
                if (item.isSet) text += ` [套装]`;
                text += `\n`;
            }
            text += `\n`;
        }
        text += `========== 快照结束 ==========`;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = `warehouse_${snapshot.id}.txt`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================= UI 列表显示 =============================
    let listContainer;
    function renderEquipmentList(snapshot) {
        if (!listContainer) return;
        if (!snapshot || !snapshot.pagesData || snapshot.pagesData.length === 0) {
            listContainer.innerHTML = '<div style="padding:12px; text-align:center; color:#aaa;">暂无数据，请先采集</div>';
            return;
        }
        let html = '';
        for (let page of snapshot.pagesData) {
            html += `<div style="margin-top:8px;"><strong>📄 第 ${page.page} 页 (${page.itemCount})</strong></div>`;
            for (let item of page.items) {
                html += `<div style="padding:4px 0 4px 12px; font-size:12px;">${escapeHtml(item.name)} x${item.count} <span style="color:#aaa;">(${item.quality})</span>${item.isSet ? ' 🔗' : ''}</div>`;
            }
        }
        listContainer.innerHTML = html;
    }
    function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m] || m)); }

    // ============================= 历史对比 =============================
    function compareSnapshots(snapA, snapB) {
        const mapA = new Map(), mapB = new Map();
        const getKey = (item) => `${item.name}|${item.quality}`;
        for (let p of snapA.pagesData) for (let item of p.items) mapA.set(getKey(item), { ...item, page: p.page });
        for (let p of snapB.pagesData) for (let item of p.items) mapB.set(getKey(item), { ...item, page: p.page });
        const added = [], removed = [], changed = [];
        for (let [k, v] of mapB.entries()) {
            if (!mapA.has(k)) added.push(v);
            else {
                const a = mapA.get(k);
                if (a.count !== v.count) changed.push({ name: v.name, quality: v.quality, oldCount: a.count, newCount: v.count });
            }
        }
        for (let [k, v] of mapA.entries()) if (!mapB.has(k)) removed.push(v);
        return { added, removed, changed };
    }
    function showComparison(snapA, snapB) {
        const diff = compareSnapshots(snapA, snapB);
        let text = `========== 装备对比 ==========\n旧：${new Date(snapA.timestamp).toLocaleString()}\n新：${new Date(snapB.timestamp).toLocaleString()}\n`;
        text += `\n➕ 新增 (${diff.added.length}):\n` + diff.added.map(i => `  ${i.name} x${i.count}`).join('\n');
        text += `\n➖ 移除 (${diff.removed.length}):\n` + diff.removed.map(i => `  ${i.name} x${i.count}`).join('\n');
        text += `\n🔄 数量变化 (${diff.changed.length}):\n` + diff.changed.map(i => `  ${i.name}: ${i.oldCount} → ${i.newCount}`).join('\n');
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000002; display:flex; align-items:center; justify-content:center;`;
        const panel = document.createElement('div');
        panel.style.cssText = `background:#1e1e2a; border-radius:20px; max-width:90vw; width:500px; max-height:80vh; overflow:auto; padding:16px; color:#eee; border:1px solid #f0b27a; white-space:pre-wrap; font-family:monospace; font-size:12px;`;
        panel.innerText = text;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style.cssText = `margin-top:12px; background:#2980b9; border:none; color:white; padding:6px 16px; border-radius:20px; cursor:pointer;`;
        closeBtn.onclick = () => modal.remove();
        panel.appendChild(closeBtn);
        modal.appendChild(panel);
        document.body.appendChild(modal);
    }
    function showHistoryList() {
        if (!historySnapshots.length) { alert('暂无历史快照'); return; }
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000002; display:flex; align-items:center; justify-content:center;`;
        const panel = document.createElement('div');
        panel.style.cssText = `background:#1e1e2a; border-radius:20px; width:90%; max-width:600px; max-height:80vh; overflow-y:auto; padding:16px; color:#eee; border:1px solid #f0b27a;`;
        let html = `<div style="font-weight:bold; margin-bottom:12px;">📚 历史快照</div><div style="margin-bottom:12px;">勾选两个快照进行对比</div>`;
        for (let i = 0; i < historySnapshots.length; i++) {
            const snap = historySnapshots[i];
            const date = new Date(snap.timestamp).toLocaleString();
            html += `<div style="display:flex; align-items:center; gap:12px; padding:6px 0; border-bottom:1px solid #3a3a4a;">
                        <input type="checkbox" class="snap-check" data-index="${i}">
                        <div>📅 ${date}</div>
                        <div>📦 ${snap.totalItems}件</div>
                        <button class="snap-export" data-index="${i}" style="background:#2980b9; border:none; color:white; padding:2px 8px; border-radius:12px;">导出TXT</button>
                    </div>`;
        }
        html += `<div style="margin-top:16px; display:flex; gap:12px; justify-content:center;">
                    <button id="compare-selected" style="background:#9b59b6; border:none; color:white; padding:6px 16px; border-radius:20px;">对比选中</button>
                    <button id="close-history" style="background:#7f8c8d; border:none; color:white; padding:6px 16px; border-radius:20px;">关闭</button>
                </div>`;
        panel.innerHTML = html;
        modal.appendChild(panel);
        document.body.appendChild(modal);
        panel.querySelectorAll('.snap-export').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'));
                exportSnapshotAsText(historySnapshots[idx]);
            };
        });
        panel.querySelector('#compare-selected').onclick = () => {
            const checks = panel.querySelectorAll('.snap-check:checked');
            if (checks.length !== 2) { alert('请勾选两个快照'); return; }
            const idx1 = parseInt(checks[0].getAttribute('data-index'));
            const idx2 = parseInt(checks[1].getAttribute('data-index'));
            modal.remove();
            showComparison(historySnapshots[idx1], historySnapshots[idx2]);
        };
        panel.querySelector('#close-history').onclick = () => modal.remove();
    }

    // ============================= 设置面板 =============================
    function showSettingsPanel() {
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000003; display:flex; align-items:center; justify-content:center;`;
        const panel = document.createElement('div');
        panel.style.cssText = `background:#1e1e2a; border-radius:20px; width:90%; max-width:400px; padding:20px; color:#eee; border:1px solid #f0b27a;`;
        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:16px;">⚙️ 设置</div>
            <div style="margin-bottom:12px;">
                <label>翻页延迟（毫秒）</label>
                <input type="number" id="set-delay" value="${config.pageDelay}" step="100" min="500" style="width:100%; background:#2a2a3a; border:1px solid #5a5a6a; border-radius:20px; padding:6px 12px; color:white;">
                <div style="font-size:11px; color:#aaa;">翻页后等待时间，建议1000~3000ms</div>
            </div>
            <div style="margin-bottom:12px;">
                <label>起始页 (0-9)</label>
                <input type="number" id="set-start" value="${config.startPage}" min="0" max="9" step="1" style="width:100%; background:#2a2a3a; border:1px solid #5a5a6a; border-radius:20px; padding:6px 12px; color:white;">
            </div>
            <div style="margin-bottom:20px;">
                <label>结束页 (0-9)</label>
                <input type="number" id="set-end" value="${config.endPage}" min="0" max="9" step="1" style="width:100%; background:#2a2a3a; border:1px solid #5a5a6a; border-radius:20px; padding:6px 12px; color:white;">
            </div>
            <div style="display:flex; gap:12px; justify-content:center;">
                <button id="save-settings" style="background:#2c6e2c; border:none; color:white; padding:6px 20px; border-radius:20px;">保存</button>
                <button id="cancel-settings" style="background:#7f8c8d; border:none; color:white; padding:6px 20px; border-radius:20px;">取消</button>
            </div>
        `;
        modal.appendChild(panel);
        document.body.appendChild(modal);
        panel.querySelector('#save-settings').onclick = () => {
            const delay = parseInt(panel.querySelector('#set-delay').value);
            const start = parseInt(panel.querySelector('#set-start').value);
            const end = parseInt(panel.querySelector('#set-end').value);
            if (isNaN(delay) || delay < 300) { alert('延迟必须≥300ms'); return; }
            if (isNaN(start) || start < 0 || start > 9) { alert('起始页需0-9'); return; }
            if (isNaN(end) || end < 0 || end > 9) { alert('结束页需0-9'); return; }
            if (start > end) { alert('起始页不能大于结束页'); return; }
            config.pageDelay = delay; config.startPage = start; config.endPage = end;
            saveConfig();
            modal.remove();
            GM_notification?.({ text: '配置已保存', timeout: 1500 });
        };
        panel.querySelector('#cancel-settings').onclick = () => modal.remove();
    }

    // ============================= 主控制面板 =============================
    function createUI() {
        const panel = document.createElement('div');
        panel.id = 'warehouse-manager';
        panel.style.cssText = `
            position: fixed; bottom: 100px; left: 20px; width: 340px;
            background: #1e1e2ae6; backdrop-filter: blur(12px); border-radius: 20px;
            border: 1px solid #f0b27a; padding: 12px; z-index: 999999;
            font-family: system-ui; font-size: 13px; color: #eee;
            display: flex; flex-direction: column; gap: 8px;
            box-shadow: 0 4px 12px black;
        `;
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:move;">
                <span>📦 仓库管理器</span>
                <div>
                    <button id="settings-btn" style="background:none; border:none; color:#ddd; font-size:16px; margin-right:8px;">⚙️</button>
                    <button id="close-panel" style="background:none; border:none; color:white; font-size:16px;">✕</button>
                </div>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="capture-save" style="flex:1; background:#2c6e2c; border:none; color:white; padding:8px; border-radius:40px;">📸 采集并保存</button>
                <button id="capture-only" style="flex:1; background:#2980b9; border:none; color:white; padding:8px; border-radius:40px;">🔍 仅预览</button>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="export-txt" style="flex:1; background:#9b59b6; border:none; color:white; padding:8px; border-radius:40px;">📄 导出文本</button>
                <button id="history-btn" style="flex:1; background:#7f8c8d; border:none; color:white; padding:8px; border-radius:40px;">📚 历史对比</button>
            </div>
            <div id="equip-list" style="max-height: 250px; overflow-y: auto; background:#0f0f1a; border-radius:12px; padding:6px; font-size:12px;"></div>
            <div id="status" style="font-size:11px; color:#aaa;">就绪</div>
        `;
        document.body.appendChild(panel);
        listContainer = panel.querySelector('#equip-list');
        const statusDiv = panel.querySelector('#status');

        // 拖拽
        let isDrag = false, dragX, dragY;
        const header = panel.querySelector('div:first-child');
        header.addEventListener('mousedown', (e) => {
            if (e.target === panel.querySelector('#close-panel') || e.target === panel.querySelector('#settings-btn')) return;
            isDrag = true;
            const rect = panel.getBoundingClientRect();
            dragX = e.clientX - rect.left;
            dragY = e.clientY - rect.top;
            panel.style.position = 'fixed';
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDrag) return;
            let left = e.clientX - dragX;
            let top = e.clientY - dragY;
            left = Math.max(5, Math.min(window.innerWidth - panel.offsetWidth - 5, left));
            top = Math.max(5, Math.min(window.innerHeight - panel.offsetHeight - 5, top));
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
        });
        window.addEventListener('mouseup', () => isDrag = false);

        document.getElementById('capture-save').onclick = async () => {
            statusDiv.innerText = '采集中...';
            const snap = await performCollection(true);
            if (snap) statusDiv.innerText = `完成，共${snap.totalItems}件`;
            else statusDiv.innerText = '采集失败，请检查页面';
        };
        document.getElementById('capture-only').onclick = async () => {
            statusDiv.innerText = '预览采集...';
            const snap = await performCollection(false);
            if (snap) statusDiv.innerText = `预览，共${snap.totalItems}件`;
            else statusDiv.innerText = '采集失败';
        };
        document.getElementById('export-txt').onclick = () => {
            if (!currentSnapshot) { alert('没有可导出的快照，请先采集一次'); return; }
            exportSnapshotAsText(currentSnapshot);
        };
        document.getElementById('history-btn').onclick = () => showHistoryList();
        document.getElementById('settings-btn').onclick = () => showSettingsPanel();
        document.getElementById('close-panel').onclick = () => panel.style.display = 'none';
    }

    function init() {
        loadConfig();
        loadHistory();
        createUI();
        log('仓库管理器已启动，请确保在仙盟仓库页面');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();