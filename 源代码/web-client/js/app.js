import api from './api.js?v=20260416b';
import { initPanels, useSect, useAlchemy, useExchange, useAlliance, useDungeon, useDuel, useLeague, useSettings } from './panels.js?v=20260416b';
import { fmtSkillFull, fmtTechFull, fmtItemFull, fmtItemEffect, fmtSkillEffect, fmtTechEffect, fmtTechPassive, fmtAffix, fmtEquipmentDetail } from './formatters.js?v=20260330c';
import { getRealm, getRealmTier, getRealmStage, qualityColor, allianceRankName, qualityName, itemTierLine, formatNumber, DICTIONARY_ENTRIES, MINGTU_NODES } from './appShared.js?v=20260330c';
import { helpBaiyiHtml, helpAffixHtml } from './helpContent.js?v=20260330c';
import { getMapDrops } from './mapDrops.js?v=20260330c';
import { getCurrentMapInfo, buildMapTooltip, buildMapInfoLines } from './mapView.js?v=20260330c';

const { createApp, ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

const gameData = reactive({ items:[], skills:[], techniques:[], maps:[], enemies:[], sects:[], alchemy_recipes:[], craft_recipes:[], dungeons:[], loaded:false });

// 帮助弹窗
const helpModal = reactive({ open: false, section: 'list' });

const itemMap = {};
const skillMap = {};
const techMap = {};
const MINGTU_ELEMENTS = [
  { key: 'metal', label: '金' },
  { key: 'wood', label: '木' },
  { key: 'water', label: '水' },
  { key: 'fire', label: '火' },
  { key: 'earth', label: '土' },
  { key: 'neutral', label: '无' },
  { key: 'hunyuan', label: '混元' }
];
const MINGTU_NODE_MAP = Object.fromEntries(MINGTU_NODES.map(n => [String(n.id), n]));
const MINGTU_LINKS = MINGTU_NODES.flatMap((node) => {
  const requires = Array.isArray(node.requires) ? node.requires : [];
  return requires.map((pid) => {
    const parent = MINGTU_NODE_MAP[String(pid)];
    return parent ? { from: parent, to: node, key: `${parent.id}->${node.id}` } : null;
  }).filter(Boolean);
});
const MINGTU_COL_STEP = 100;
const MINGTU_COL_START = 90;

function getItem(id) { return itemMap[id] || null; }
function getSkill(id) { return skillMap[id] || null; }
function getTech(id) { return techMap[id] || null; }

let _gameDataLoading = null;
async function loadGameData(force = false) {
  if (gameData.loaded && !force) return gameData;
  if (_gameDataLoading && !force) return _gameDataLoading;
  _gameDataLoading = (async () => {
    const d = await api.getGameData(force);
    if (!d) return null;
    Object.assign(gameData, d, { loaded: true });
    // 兼容后端偶发对象结构，统一转为数组以避免模板筛选空列表。
    const normalizeList = (v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return Object.values(v);
      return [];
    };
    gameData.items = normalizeList(gameData.items);
    gameData.skills = normalizeList(gameData.skills);
    gameData.techniques = normalizeList(gameData.techniques);
    gameData.maps = normalizeList(gameData.maps);
    gameData.enemies = normalizeList(gameData.enemies);
    gameData.sects = normalizeList(gameData.sects);
    gameData.alchemy_recipes = normalizeList(gameData.alchemy_recipes);
    gameData.craft_recipes = normalizeList(gameData.craft_recipes);
    gameData.dungeons = normalizeList(gameData.dungeons);
    for (const it of gameData.items || []) itemMap[it.id] = it;
    for (const s of gameData.skills || []) skillMap[s.id] = s;
    for (const t of gameData.techniques || []) techMap[t.id] = t;
    return gameData;
  })();
  try {
    return await _gameDataLoading;
  } finally {
    _gameDataLoading = null;
  }
}

const app = createApp({
  setup() {
    const view = ref(api.hasToken() ? 'loading' : 'login');
    const player = reactive({});
    const toast = ref('');
    let toastTimer = null;
    let lastToastMsg = '';
    let lastToastAt = 0;
    function showToast(msg, dur = 2500) {
      const text = String(msg || '').trim();
      if (!text) return;
      const now = Date.now();
      if (text === lastToastMsg && (now - lastToastAt) < 1500) return;
      lastToastMsg = text;
      lastToastAt = now;
      toast.value = text;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.value = '', dur);
    }
    const _clientOnlyKeys = ['attr_bonus', 'agreement_seen'];
    const _playerStateKeys = ['name', 'level', 'exp', 'max_exp', 'hp', 'max_hp', 'mp', 'max_mp', 'spirit_stones', 'trial_coins', 'league_points', 'league_rating', 'current_map_id', 'rest_until', 'auto_battle_enabled', 'auto_battle_map_id', 'sect_id', 'alliance_id', 'alliance_contribution', 'baiyi', 'cave', 'time_state'];
    const FULL_SYNC_INTERVAL_MS = 30 * 60 * 1000;
    const inventoryItemCountMap = ref(Object.create(null));
    const _inventorySlotCountCache = new Map();
    const _inventoryFirstSlotByItemId = new Map();
    const _INV_EQUIP_TYPES = new Set(['weapon','head','shoulder','chest','legs','hands','ring','amulet','back','equipment']);
    const _INV_MATERIAL_TYPES = new Set(['material','herb','medicine']);
    const _INV_CATALYST_IDS = new Set([27,69,71,44,45,54,133]);
    const _inventoryCandidatesByFilter = {
      all: [],
      equipment: [],
      non_equip: [],
      material: [],
      ling: [],
      catalyst: []
    };
    let _lastSuspiciousSnapshotAt = 0;
    function _readInventorySlotEntry(slot) {
      const id = Number(slot?.item?.id) || 0;
      if (id <= 0) return null;
      return { id, count: Math.max(1, Number(slot?.count) || 1) };
    }
    function _applyInventoryCountDelta(counts, itemId, delta) {
      const id = Number(itemId) || 0;
      const d = Number(delta) || 0;
      if (id <= 0 || d === 0) return;
      const next = Number(counts[id] || 0) + d;
      if (next > 0) counts[id] = next;
      else delete counts[id];
    }
    function _updateInventoryCountCache(nextInventory) {
      if (!Array.isArray(nextInventory)) {
        inventoryItemCountMap.value = Object.create(null);
        _inventorySlotCountCache.clear();
        _inventoryFirstSlotByItemId.clear();
        _inventoryCandidatesByFilter.all = [];
        _inventoryCandidatesByFilter.equipment = [];
        _inventoryCandidatesByFilter.non_equip = [];
        _inventoryCandidatesByFilter.material = [];
        _inventoryCandidatesByFilter.ling = [];
        _inventoryCandidatesByFilter.catalyst = [];
        return;
      }
      const nextCounts = Object.assign(Object.create(null), inventoryItemCountMap.value || {});
      const nextSlotCache = new Map();
      const nextFirstSlotByItemId = new Map();
      const nextCandidatesAll = [];
      const nextCandidatesEquipment = [];
      const nextCandidatesNonEquip = [];
      const nextCandidatesMaterial = [];
      const nextCandidatesLing = [];
      const nextCandidatesCatalyst = [];
      for (let p = 0; p < nextInventory.length; p++) {
        const page = nextInventory[p];
        if (!Array.isArray(page)) continue;
        for (let s = 0; s < page.length; s++) {
          const slot = page[s];
          const entry = _readInventorySlotEntry(slot);
          if (!entry) continue;
          const slotKey = `${p}_${s}`;
          nextSlotCache.set(slotKey, entry);
          if (!nextFirstSlotByItemId.has(entry.id)) nextFirstSlotByItemId.set(entry.id, slotKey);
          const it = slot.item;
          const candidate = { page: p, slot: s, item: it, count: entry.count };
          const itemType = String(it?.type || '');
          const isEquipType = _INV_EQUIP_TYPES.has(itemType);
          const isMaterialType = _INV_MATERIAL_TYPES.has(itemType);
          nextCandidatesAll.push(candidate);
          if (isEquipType) nextCandidatesEquipment.push(candidate);
          else nextCandidatesNonEquip.push(candidate);
          if (isMaterialType) {
            nextCandidatesMaterial.push(candidate);
            nextCandidatesLing.push(candidate);
          }
          if (_INV_CATALYST_IDS.has(entry.id)) nextCandidatesCatalyst.push(candidate);
          const prev = _inventorySlotCountCache.get(slotKey);
          if (!prev) {
            _applyInventoryCountDelta(nextCounts, entry.id, entry.count);
            continue;
          }
          if (prev.id === entry.id) {
            _applyInventoryCountDelta(nextCounts, entry.id, entry.count - prev.count);
          } else {
            _applyInventoryCountDelta(nextCounts, prev.id, -prev.count);
            _applyInventoryCountDelta(nextCounts, entry.id, entry.count);
          }
        }
      }
      for (const [slotKey, prev] of _inventorySlotCountCache.entries()) {
        if (nextSlotCache.has(slotKey)) continue;
        _applyInventoryCountDelta(nextCounts, prev.id, -prev.count);
      }
      _inventorySlotCountCache.clear();
      for (const [slotKey, entry] of nextSlotCache.entries()) {
        _inventorySlotCountCache.set(slotKey, entry);
      }
      _inventoryFirstSlotByItemId.clear();
      for (const [itemId, slotKey] of nextFirstSlotByItemId.entries()) {
        _inventoryFirstSlotByItemId.set(itemId, slotKey);
      }
      _inventoryCandidatesByFilter.all = nextCandidatesAll;
      _inventoryCandidatesByFilter.equipment = nextCandidatesEquipment;
      _inventoryCandidatesByFilter.non_equip = nextCandidatesNonEquip;
      _inventoryCandidatesByFilter.material = nextCandidatesMaterial;
      _inventoryCandidatesByFilter.ling = nextCandidatesLing;
      _inventoryCandidatesByFilter.catalyst = nextCandidatesCatalyst;
      inventoryItemCountMap.value = nextCounts;
    }
    let _lastPlayerShapeCleanupAt = 0;
    function _sumSpiritRoots(p) {
      const roots = p?.effective_spirit_roots || p?.spirit_roots;
      if (!roots || typeof roots !== 'object') return 0;
      return ['metal', 'wood', 'water', 'fire', 'earth']
        .reduce((sum, k) => sum + Math.max(0, Number(roots[k]) || 0), 0);
    }
    function _inventoryHasAnyItem(inv) {
      if (!Array.isArray(inv)) return false;
      for (const page of inv) {
        if (!Array.isArray(page)) continue;
        for (const slot of page) {
          if (slot && slot.item && Number(slot.item.id) > 0 && Number(slot.count || 0) > 0) return true;
        }
      }
      return false;
    }
    function _isSuspiciousEmptySnapshot(nextPlayer) {
      if (!nextPlayer || typeof nextPlayer !== 'object') return false;
      const curLv = Math.max(1, Number(player.level) || 1);
      const nextLv = Math.max(1, Number(nextPlayer.level) || 1);
      if (curLv < 80 || nextLv < 80) return false;
      if (!Array.isArray(nextPlayer.inventory)) return false;
      const hadInv = _inventoryHasAnyItem(player.inventory);
      const nextInvEmpty = !_inventoryHasAnyItem(nextPlayer.inventory);
      if (!hadInv || !nextInvEmpty) return false;
      const curRootSum = _sumSpiritRoots(player);
      const nextRootSum = _sumSpiritRoots(nextPlayer);
      if (curRootSum <= 0 || nextRootSum > 0) return false;
      return true;
    }
    function _isFullPlayerSnapshotPayload(p) {
      if (!p || typeof p !== 'object') return false;
      return Object.keys(p).length > 30
        && Array.isArray(p.inventory)
        && !!p.equipment && typeof p.equipment === 'object'
        && Array.isArray(p.skills)
        && Array.isArray(p.techniques);
    }
    function applyPlayer(p) {
      if (!p) return;
      const now = Date.now();
      if (_isFullPlayerSnapshotPayload(p) && _isSuspiciousEmptySnapshot(p)) {
        if (now - _lastSuspiciousSnapshotAt >= 5000) {
          _lastSuspiciousSnapshotAt = now;
          console.warn('[sync] ignore suspicious empty snapshot and force full sync');
          void doSync();
        }
        return;
      }
      // 仅在明确收到“全量玩家快照”时才清理本地多余字段，
      // 避免半量返回（如战斗/轻量同步）误删 inventory、equipment 等关键结构。
      if (_isFullPlayerSnapshotPayload(p) && now - _lastPlayerShapeCleanupAt >= 60 * 1000) {
        for (const k of Object.keys(player)) { if (!(k in p) && !_clientOnlyKeys.includes(k)) delete player[k]; }
        _lastPlayerShapeCleanupAt = now;
      }
      if (Object.prototype.hasOwnProperty.call(p, 'inventory')) {
        _updateInventoryCountCache(p.inventory);
      }
      Object.assign(player, p);
      if (selectedInvSlot.page >= 0 && selectedInvSlot.item) {
        const cur = getInvSlot(selectedInvSlot.page, selectedInvSlot.idx);
        if (!cur || Number(cur.id || 0) !== Number(selectedInvSlot.item.id || 0)) {
          selectedInvSlot.item = null; selectedInvSlot.page = -1; selectedInvSlot.idx = -1;
        }
      }
    }
    function applyPlayerState(p) {
      if (!p) return;
      for (const k of _playerStateKeys) {
        if (!(k in p)) continue;
        player[k] = p[k];
      }
    }
    function getSpiritRootVal(k) { const r = player.effective_spirit_roots || player.spirit_roots; return (r && r[k]) || 0; }

    let syncTimer = null, syncFailCount = 0, lastFullSyncAt = 0;
    let _syncBusy = false;
    const isOnline = ref(true);
    function buildOfflineReportFingerprint(report) {
      if (!report || typeof report !== 'object') return '';
      const dropSig = Array.isArray(report.drops)
        ? report.drops
          .map((d) => `${Number(d?.item_id) || 0}:${Number(d?.count) || 0}`)
          .sort()
          .join('|')
        : '';
      const upd = Number(report.updated_at) || 0;
      const since = Number(report.since) || 0;
      const battles = Number(report.battles) || 0;
      const wins = Number(report.wins) || 0;
      const losses = Number(report.losses) || 0;
      const draws = Number(report.draws) || 0;
      const exp = Number(report.exp_gained ?? report.total_exp) || 0;
      const spirit = Number(report.spirit_gained ?? report.total_spirit_stones) || 0;
      return [upd, since, battles, wins, losses, draws, exp, spirit, dropSig].join('#');
    }
    let _lastOfflineReportFingerprint = '';
    function handleSyncOfflineReport(report) {
      if (!report || !report.battles) return;
      const fp = buildOfflineReportFingerprint(report);
      if (fp && fp === _lastOfflineReportFingerprint) return;
      _lastOfflineReportFingerprint = fp;
      offlineReport.value = report;
      if (report.exp_gained > 0) addInvLog('离线挂机', '经验', report.exp_gained, `${report.wins}胜${report.losses}负`);
      if (report.spirit_gained > 0) addInvLog('离线挂机', '灵石', report.spirit_gained);
      if (report.drops) report.drops.forEach(d => addInvLog('离线掉落', d.item_name, d.count));
    }
    async function doSync() {
      if (_syncBusy) return;
      _syncBusy = true;
      try {
        const r = await api.sync();
        if (!r.ok) { if (r.error?.includes('登录') || r.error?.includes('token')) { view.value='login'; api.logout(); stopSync(); } return; }
        syncFailCount = 0; isOnline.value = true;
        lastFullSyncAt = Date.now();
        if (!r.hasCharacter) { view.value = 'create'; return; }
        if (r.email_bound !== undefined) emailBound.value = !!r.email_bound;
        if (r.player && r.player.auto_battle_enabled !== undefined) {
          autoBattle.value = !!r.player.auto_battle_enabled;
          localStorage.setItem('auto_battle', autoBattle.value ? '1' : '0');
        }
        applyPlayer(r.player);
        // 完整同步后顺带刷新邮件，避免“百艺已完成但邮件页未更新”的感知问题。
        loadMails();
        const wasLoading = view.value === 'loading';
        if (wasLoading) {
          view.value = 'game';
          ensureGameDataForTab(activeTab.value);
        }
        if (r.offline_battle_report && r.offline_battle_report.battles > 0) handleSyncOfflineReport(r.offline_battle_report);
        if (wasLoading && typeof restoreBattleFromServer === 'function') {
          if (r.active_battle?.battleId) {
            const restored = await restoreBattleFromServer(r.active_battle.battleId);
            if (restored && autoBattle.value) runAutoBattle();
          } else if (autoBattle.value && typeof runAutoBattle === 'function') {
            runAutoBattle();
          }
        }
      } catch (e) {
        const msg = String(e?.message || '');
        const syncRateLimited = msg.includes('429')
          || msg.includes('Too Many Requests')
          || msg.includes('同步过于频繁')
          || msg.includes('异常高频同步')
          || msg.includes('RATE_LIMITED');
        if (syncRateLimited) {
          const recovered = await doStateSync();
          if (recovered) {
            showToast('全量同步限流，已自动切换轻量同步');
            return;
          }
        }
        syncFailCount++;
        if (syncFailCount >= 3) isOnline.value = false;
        if (msg.includes('登录')) { view.value='login'; api.logout(); stopSync(); }
      }
      finally { _syncBusy = false; }
    }
    async function doStateSync() {
      try {
        const r = await api.state();
        if (!r.ok) { if (r.error?.includes('登录') || r.error?.includes('token')) { view.value='login'; api.logout(); stopSync(); } return false; }
        syncFailCount = 0; isOnline.value = true;
        if (!r.hasCharacter) { view.value = 'create'; return true; }
        if (r.email_bound !== undefined) emailBound.value = !!r.email_bound;
        if (r.player && r.player.auto_battle_enabled !== undefined) {
          autoBattle.value = !!r.player.auto_battle_enabled;
          localStorage.setItem('auto_battle', autoBattle.value ? '1' : '0');
        }
        applyPlayerState(r.player);
        if (view.value === 'loading') {
          view.value = 'game';
          ensureGameDataForTab(activeTab.value);
        }
        return true;
      } catch (e) {
        syncFailCount++;
        if (syncFailCount >= 3) isOnline.value = false;
        if (e.message?.includes('登录')) { view.value='login'; api.logout(); stopSync(); }
        return false;
      }
    }
    async function doPeriodicSync() {
      if (Date.now() - lastFullSyncAt >= FULL_SYNC_INTERVAL_MS) return doSync();
      return doStateSync();
    }
    const _onVisibilityChange = () => { if (document.visibilityState === 'visible') doSync(); };
    function startSync() {
      doSync();
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = setInterval(doPeriodicSync, 90000);
      document.addEventListener('visibilitychange', _onVisibilityChange);
      api.connectWs();
      api.onWsMessage(_handleWsMessage);
    }
    function stopSync() {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      stopAutoBattleLoop();
      api.disconnectWs();
    }
    function forceRelogin(msg = '登录已过期，请重新登录') {
      stopSync();
      api.disconnectWs();
      api.logout();
      emailBound.value = false;
      view.value = 'login';
      showToast(msg);
    }
    api.setAuthExpiredHandler((msg) => {
      forceRelogin(msg || '登录已过期，请重新登录');
    });
    const emailBound = ref(false);
    const darkTheme = ref(true);
    function toggleTheme() { darkTheme.value = !darkTheme.value; document.documentElement.classList.toggle('theme-light', !darkTheme.value); }

    onMounted(() => {
      if (api.hasToken()) startSync();
      document.documentElement.classList.toggle('theme-light', !darkTheme.value);
    });
    onUnmounted(stopSync);

    // init panels
    initPanels({ showToast, applyPlayer, doSync, player, gameData, getItem });
    const sect = useSect();
    const sectBasicArmorType = ref('head');
    const dungTeamJoinCode = ref('');
    const dungCreateId = ref(null);
    const selectedDungeon = ref(null);
    function selectDungeon(d) { selectedDungeon.value = (selectedDungeon.value?.id === d.id) ? null : d; }
    const offlineReport = ref(null);
    function formatDuration(sec) {
      if (sec >= 3600) { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); return m > 0 ? `${h}小时${m}分钟` : `${h}小时`; }
      if (sec >= 60) return `${Math.floor(sec / 60)}分钟`;
      return `${sec}秒`;
    }
    function formatLastOnline(ts) {
      if (!ts || ts <= 0) return '未知';
      const diff = Math.floor(Date.now() / 1000) - ts;
      if (diff < 60) return '刚刚';
      if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
      return `${Math.floor(diff / 86400)}天前`;
    }
    const alch = useAlchemy();
    const exch = useExchange();
    const alli = useAlliance();
    const chat = { stopPoll: () => {}, startPoll: () => {}, switchChannel: () => {}, send: () => {}, messages: { value: [] }, channel: { value: 'world' }, input: { value: '' } };
    const dung = useDungeon();
    const duel = useDuel();
    const league = useLeague();
    const sett = useSettings();

    // auth
    const loginForm = reactive({ username:'', password:'', loading:false, error:'' });
    const isRegister = ref(false);
    const forgotMode = ref(false);
    const forgotForm = reactive({ email:'', code:'', newPassword:'', step:1, loading:false, error:'', cooldown:0 });
    let _forgotCdTimer = null;
    async function forgotSendCode() {
      if (!forgotForm.email.trim()) { forgotForm.error = '请输入邮箱'; return; }
      if (forgotForm.cooldown > 0) return;
      forgotForm.loading = true; forgotForm.error = '';
      try {
        const r = await api.forgotPasswordSendCode(forgotForm.email.trim());
        if (!r.ok) { forgotForm.error = r.error; return; }
        forgotForm.step = 2;
        forgotForm.cooldown = 60;
        _forgotCdTimer = setInterval(() => { forgotForm.cooldown--; if (forgotForm.cooldown <= 0) clearInterval(_forgotCdTimer); }, 1000);
      } catch (e) { forgotForm.error = e.message; } finally { forgotForm.loading = false; }
    }
    async function forgotReset() {
      if (!forgotForm.code.trim() || !forgotForm.newPassword) { forgotForm.error = '请填写验证码和新密码'; return; }
      forgotForm.loading = true; forgotForm.error = '';
      try {
        const r = await api.forgotPasswordReset(forgotForm.email.trim(), forgotForm.code.trim(), forgotForm.newPassword);
        if (!r.ok) { forgotForm.error = r.error; return; }
        showToast('密码重置成功，请登录');
        forgotMode.value = false;
        Object.assign(forgotForm, { email:'', code:'', newPassword:'', step:1, error:'', cooldown:0 });
      } catch (e) { forgotForm.error = e.message; } finally { forgotForm.loading = false; }
    }
    function exitForgot() {
      forgotMode.value = false;
      Object.assign(forgotForm, { email:'', code:'', newPassword:'', step:1, loading:false, error:'', cooldown:0 });
      if (_forgotCdTimer) clearInterval(_forgotCdTimer);
    }
    async function doLogin() {
      loginForm.loading = true; loginForm.error = '';
      try {
        const r = await (isRegister.value ? api.register : api.login)(loginForm.username, loginForm.password);
        if (!r.ok) { loginForm.error = r.error; return; }
        loginForm.username = ''; loginForm.password = '';
        view.value = 'loading'; startSync();
      } catch (e) { loginForm.error = e.message; } finally { loginForm.loading = false; }
    }
    function doLogout() { stopSync(); chat.stopPoll(); api.disconnectWs(); api.logout(); emailBound.value = false; view.value = 'login'; }
    const wipeConfirm = ref('');
    async function doWipe() {
      if (wipeConfirm.value !== '确认删档') { showToast('请输入"确认删档"以确认'); return; }
      try {
        const r = await api.playerWipe(wipeConfirm.value);
        if (!r.ok) { showToast(r.error); return; }
        wipeConfirm.value = ''; showToast('删档成功');
        view.value = 'create'; applyPlayer(r.player || {});
      } catch (e) { showToast(e.message); }
    }
    const renameInput = ref('');
    async function doRename() {
      const name = (renameInput.value || '').trim();
      if (!name) { showToast('请输入新角色名'); return; }
      try {
        const r = await api.renameCharacter(name);
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player); renameInput.value = ''; showToast(r.msg || '改名成功');
      } catch (e) { showToast(e.message); }
    }

    // create
    const createForm = reactive({ name:'', metal:20, wood:20, water:20, fire:20, earth:20, loading:false, error:'' });
    const createPointsLeft = computed(() => 100 - createForm.metal - createForm.wood - createForm.water - createForm.fire - createForm.earth);
    async function doCreate() {
      if (!(createForm.name || '').trim()) { createForm.error = '请输入角色名称'; return; }
      if (createPointsLeft.value !== 0) { createForm.error = '灵根必须分配100点'; return; }
      createForm.loading = true; createForm.error = '';
      try {
        const r = await api.createCharacter(createForm.name.trim(), { metal:createForm.metal, wood:createForm.wood, water:createForm.water, fire:createForm.fire, earth:createForm.earth });
        if (!r.ok) { createForm.error = r.error; return; }
        applyPlayer(r.player);
        view.value = 'game';
        ensureGameDataForTab(activeTab.value);
        startSync();
      } catch (e) { createForm.error = e.message; } finally { createForm.loading = false; }
    }

    // 游戏声明弹窗（首次进入游戏且未阅读过时显示）
    const agreementModalOpen = computed(() =>
      view.value === 'game' && player && Object.keys(player).length > 0 && !player.agreement_seen
    );
    async function closeAgreementModal() {
      try {
        const r = await api.agreementSeen();
        if (r.ok && r.player) applyPlayer(r.player);
      } catch (e) { showToast(e.message); }
    }

    // tabs
    const activeTab = ref('map');
    const tabs = [
      { id:'announcement', label:'公告' }, { id:'character', label:'角色' },
      { id:'inventory', label:'背包' }, { id:'equipment', label:'装备' },
      { id:'skills', label:'技能' }, { id:'techniques', label:'功法' },
      { id:'map', label:'地图' },
      { id:'baiyi', label:'百艺' }, { id:'cave', label:'洞府' }, { id:'disciple', label:'传人' }, { id:'sect', label:'宗门' },
      { id:'alliance', label:'仙盟' }, { id:'exchange', label:'坊市' },
      { id:'dungeon', label:'副本' }, { id:'duel', label:'斗法' },
      { id:'league', label:'联赛' },
      { id:'trial', label:'试炼' },
      { id:'mail', label:'邮件' },
      { id:'dictionary', label:'词典' },
      { id:'settings', label:'设置' },
    ];
    const mapSubTab = ref('renjie');
    const isNightmareMapData = (m) => {
      if (!m || typeof m !== 'object') return false;
      if (typeof m.is_nightmare === 'boolean') return m.is_nightmare;
      const id = Number(m.id) || 0;
      if (id >= 10000) return true;
      return String(m.name || '').startsWith('魇化');
    };
    const isLingjieMapData = (m) => {
      if (!m || typeof m !== 'object') return false;
      if (m.is_lingjie === true) return true;
      return String(m.realm || '') === 'lingjie';
    };
    const mapListBySubTab = computed(() => {
      const src = gameData.maps;
      const maps = Array.isArray(src) ? src : (src && typeof src === 'object' ? Object.values(src) : []);
      if (mapSubTab.value === 'lingjie') return maps.filter(m => isLingjieMapData(m));
      if (mapSubTab.value === 'yanjie') return maps.filter(m => isNightmareMapData(m));
      return maps.filter(m => !isNightmareMapData(m) && !isLingjieMapData(m));
    });

    const tabsNeedGameData = new Set(['map', 'inventory', 'equipment', 'skills', 'techniques', 'baiyi', 'dungeon', 'duel', 'league', 'trial', 'dictionary']);
    function ensureGameDataForTab(tabId) {
      if (gameData.loaded) return;
      if (tabsNeedGameData.has(String(tabId || ''))) {
        void loadGameData();
      }
    }

    // character
    const charRealm = computed(() => getRealm(player.level || 1));
    const charStage = computed(() => getRealmStage(player.level || 1));
    /** 突破条件说明（用于 tooltip） */
    function breakthroughConditionTooltip() {
      const lv = Math.floor(Number(player.level) || 1);
      if (lv === 120) {
        let rate = 0.15;
        const stored = Number(player.breakthrough_foundation_pills_stored) || 0;
        const pills = Math.min(stored, 5);
        rate += pills * 0.2;
        rate = Math.min(rate, 1);
        return `筑基突破（当前概率: ${Math.round(rate*100)}%）\n基础15% + 筑基丹${pills}枚×20%。\n筑基丹0-5枚，每枚+20%成功率。`;
      }
      if (lv === 160) {
        let rate = 0.05;
        const roots = player.effective_spirit_roots || player.spirit_roots || {};
        const rootValues = Object.values(roots).map(v => Number(v) || 0);
        const hasHighRoot = rootValues.some(v => v > 80);
        let rootBonus = 0;
        let rootDesc = '';
        if (hasHighRoot) {
          for (const v of rootValues) { if (v > 80) rootBonus += (v - 80) * 0.01; }
          rootDesc = `灵根>80加成(+${Math.round(rootBonus*100)}%)`;
        } else {
          const totalRoot = rootValues.reduce((s, v) => s + v, 0);
          if (totalRoot > 255) rootBonus = Math.min(0.20, (totalRoot - 255) * (0.20 / 20));
          rootDesc = `灵根总和${totalRoot}${totalRoot>255?'(+'+Math.round(rootBonus*100)+'%)':'(需>255)'}`;
        }
        rate += rootBonus;
        const yunling = Math.min(4, Number(player.breakthrough_yunling_stored) || 0);
        rate += yunling * 0.2;
        rate = Math.min(rate, 1);
        return `金丹突破（当前概率: ${Math.round(rate*100)}%）\n基础5% + ${rootDesc} + 蕴灵丹${yunling}枚×20%。`;
      }
      if (lv === 200) {
        let rate = 0.05;
        const kills = Number(player.breakthrough_nascent_kill_count) || 0;
        const killBonus = Math.min(0.45, kills * 0.003);
        rate += killBonus;
        const hasStones = Math.floor(Number(player.spirit_stones) || 0) >= 80000;
        if (hasStones) rate += 0.10;
        const nascentRootValues = Object.values(player.effective_spirit_roots || player.spirit_roots || {}).map(v => Number(v) || 0);
        const nascentHasHighRoot = nascentRootValues.some(v => v > 80);
        const spiritTotal = nascentRootValues.reduce((s, v) => s + v, 0);
        let spiritBonus = 0;
        let spiritDesc = '';
        if (nascentHasHighRoot) {
          if (spiritTotal > 360) spiritBonus = Math.min(0.15, (spiritTotal - 360) * 0.0075);
          spiritDesc = `灵根${spiritTotal}(高灵根路线,需>360,+${Math.round(spiritBonus*100)}%)`;
        } else {
          if (spiritTotal > 335) spiritBonus = Math.min(0.15, (spiritTotal - 335) * (0.15 / 15));
          spiritDesc = `灵根${spiritTotal}(杂灵根路线,需>335,+${Math.round(spiritBonus*100)}%)`;
        }
        rate += spiritBonus;
        const sixKeys = ['strength','constitution','bone','agility','zhenyuan','lingli'];
        const oa = player.original_base_attributes || {};
        let sixSum = 0;
        for (const k of sixKeys) sixSum += Number(oa[k] ?? player[k]) || 0;
        const sixBonus = sixSum > 1500 ? Math.min(0.25, Math.floor((sixSum - 1500) / 36) * 0.01) : 0;
        rate += sixBonus;
        rate = Math.min(rate, 1);
        const parts = ['基础5%', `越级击杀${kills}次(+${Math.round(killBonus*100)}%)`, spiritDesc];
        if (hasStones) parts.push('消耗8万灵石(+10%)');
        else parts.push('8万灵石不足(无+10%)');
        if (sixBonus > 0) parts.push(`六维基础${sixSum}(+${Math.round(sixBonus*100)}%)`);
        return `元婴突破（当前概率: ≈${Math.round(rate*100)}%）\n` + parts.join(' + ') + '。\n越级击杀=怪物等级>自身，击杀加成上限45%；六维=基础属性（无装备/功法加成），1500起步，每36点+1%，最多+25%。';
      }
      if (lv === 240) {
        let rate = 0.05;
        const dungeons = Number(player.breakthrough_spirit_dungeon_count) || 0;
        const dungeonBonus = Math.min(0.30, dungeons * 0.03);
        rate += dungeonBonus;
        const heartTrial = !!player.breakthrough_heart_trial_passed;
        if (heartTrial) rate += 0.20;
        const sixKeys = ['strength','constitution','bone','agility','zhenyuan','lingli'];
        const oa = player.original_base_attributes || {};
        let sixSum = 0;
        for (const k of sixKeys) sixSum += Number(oa[k] ?? player[k]) || 0;
        const sixBonus = sixSum > 5500 ? Math.min(0.45, Math.floor((sixSum - 5500) / 100) * 0.01) : 0;
        rate += sixBonus;
        rate = Math.min(rate, 1);
        return `化神突破（当前概率: ${Math.round(rate*100)}%）\n基础5% + 副本${dungeons}次(+${Math.round(dungeonBonus*100)}%)${heartTrial?' + 心魔试炼(+20%)':''}${sixBonus>0?` + 六维基础${sixSum}(+${Math.round(sixBonus*100)}%)`:` + 六维基础${sixSum}(需>5500)`}。\n六维基础加成：5500起步，每超100点+1%，上限45%。`;
      }
      if (lv === 280) {
        const sixKeys = ['strength','constitution','bone','agility','zhenyuan','lingli'];
        const oa = player.original_base_attributes || {};
        let sixSum = 0;
        for (const k of sixKeys) sixSum += Number(oa[k] ?? player[k]) || 0;
        const attrBonus = sixSum <= 15000
          ? 0
          : (sixSum >= 23000 ? 0.4 : ((sixSum - 15000) / 8000) * 0.4);

        const countLearned = (lvObj, fallbackArr, asObjectId = false) => {
          let n = 0;
          if (lvObj && typeof lvObj === 'object') {
            for (const v of Object.values(lvObj)) {
              const x = (v && typeof v === 'object') ? Number(v.level) : Number(v);
              if (x > 0) n += 1;
            }
          }
          if (n > 0) return n;
          const arr = Array.isArray(fallbackArr) ? fallbackArr : [];
          const ids = arr.map((it) => {
            if (asObjectId && it && typeof it === 'object') return Number(it.id) || 0;
            return Number(it) || 0;
          }).filter((id) => id > 0);
          return new Set(ids).size;
        };

        const ownedSkills = countLearned(player.skill_levels, player.skills, false);
        const ownedTechniques = countLearned(player.technique_levels, player.techniques, true);
        const skillBonus = Math.min(0.4, ownedSkills * (0.4 / 15));
        const techBonus = Math.min(0.2, ownedTechniques * 0.02);
        const rate = Math.min(1, attrBonus + skillBonus + techBonus);
        return `炼虚突破（当前概率: ${Math.round(rate*100)}%）\n基础属性${sixSum}(15000起算，23000封顶)(+${Math.round(attrBonus*100)}%) + 已拥有技能${ownedSkills}个(15个封顶+${Math.round(skillBonus*100)}%) + 已拥有功法${ownedTechniques}个(+${Math.round(techBonus*100)}%)。\n三项总上限100%（基础属性40% + 技能40% + 功法20%）。`;
      }
      return '当前等级无法突破（需120/160/200/240/280级）。';
    }
    async function doLevelUp() { try { const r = await api.levelUp(); if (!r.ok) { showToast(r.error); return; } applyPlayer(r.player); showToast('升级成功！'); } catch (e) { showToast(e.message); } }
    async function doBreakthrough() {
      const tip = breakthroughConditionTooltip();
      const rateMatch = tip.match(/当前概率[:\s]*[≈]?(\d+)%/);
      const rate = rateMatch ? parseInt(rateMatch[1]) : 0;
      let msg = tip + '\n\n失败将降级并清空当前经验。\n确定要尝试突破？';
      if (rate < 100) msg = `⚠ 当前成功率仅 ${rate}%，未达到100%！\n\n` + msg;
      if (!confirm(msg)) return;
      try {
        const r = await api.breakthrough();
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
        showToast(r.success ? '突破成功！' : '突破失败');
      } catch (e) { showToast(e.message); }
    }

    // destiny
    const mingtuModalOpen = ref(false);
    const mingtuLineKey = ref('metal');
    const mingtuAvailablePoints = computed(() => Number(player.destiny?.available_points ?? player.talents?.available_points ?? 0) || 0);
    const mingtuNodesByLine = computed(() => MINGTU_NODES.filter(n => String(n.line || '') === String(mingtuLineKey.value)));
    const mingtuLinksByLine = computed(() => MINGTU_LINKS.filter((l) => String(l.from?.line || '') === String(mingtuLineKey.value) && String(l.to?.line || '') === String(mingtuLineKey.value)));
    async function mingtuUnlock(nodeId) {
      try {
        const r = await api.destinyUnlock(nodeId);
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
        showToast('命途解锁成功');
      } catch (e) { showToast(e.message); }
    }
    async function mingtuReset() {
      if (!confirm('确定重置所有命途？将消耗1个万物之形。')) return;
      try {
        const r = await api.destinyReset();
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
        showToast('命途已重置');
      } catch (e) { showToast(e.message); }
    }
    function getMingtuNodeLevel(id) {
      return Number(player.destiny?.unlocked_nodes?.[id] ?? player.talents?.unlocked_nodes?.[id] ?? 0) || 0;
    }
    function isMingtuNodeLocked(node) {
      const requires = Array.isArray(node?.requires) ? node.requires : [];
      for (const reqId of requires) {
        if (getMingtuNodeLevel(reqId) <= 0) return true;
      }
      return false;
    }
    function canUnlockMingtuNode(node) {
      if (!node) return false;
      if (mingtuAvailablePoints.value <= 0) return false;
      if (isMingtuNodeLocked(node)) return false;
      return getMingtuNodeLevel(node.id) < (Number(node.max_level) || 1);
    }
    function mingtuNodeClass(node) {
      const level = getMingtuNodeLevel(node.id);
      return {
        unlocked: level > 0,
        locked: isMingtuNodeLocked(node),
        maxed: level >= (Number(node.max_level) || 1)
      };
    }
    function mingtuNodeStyle(node) {
      const col = Math.max(1, Number(node?.col) || 1);
      const row = Math.max(1, Number(node?.row) || 1);
      const y = mingtuRowY(row);
      return {
        left: `${(col - 1) * MINGTU_COL_STEP + MINGTU_COL_START}px`,
        top: `${y}px`
      };
    }
    function mingtuRowY(row) {
      const r = Math.max(1, Number(row) || 1);
      if (r === 1) return 90;
      if (r === 2) return 270;
      if (r === 3) return 470;
      if (r === 4) return 710;
      return 950;
    }
    function mingtuLinkAttrs(link) {
      const c1 = Math.max(1, Number(link?.from?.col) || 1);
      const r1 = Math.max(1, Number(link?.from?.row) || 1);
      const c2 = Math.max(1, Number(link?.to?.col) || 1);
      const r2 = Math.max(1, Number(link?.to?.row) || 1);
      return {
        x1: (c1 - 1) * MINGTU_COL_STEP + MINGTU_COL_START,
        y1: mingtuRowY(r1),
        x2: (c2 - 1) * MINGTU_COL_STEP + MINGTU_COL_START,
        y2: mingtuRowY(r2)
      };
    }
    function formatPct(v) {
      const n = Number(v || 0) * 100;
      if (!Number.isFinite(n)) return '0%';
      if (Math.abs(n) >= 10) return `${n.toFixed(1).replace(/\.0$/, '')}%`;
      if (Math.abs(n) >= 1) return `${n.toFixed(1).replace(/\.0$/, '')}%`;
      return `${n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
    }
    function formatLvValues(values, unit = '%') {
      if (!Array.isArray(values) || values.length <= 0) return '';
      return values.map((v, i) => {
        const val = unit === '%' ? formatPct(v) : `${v}`;
        return `Lv${i + 1} ${val}`;
      }).join(' / ');
    }
    function mingtuNodeDetail(node) {
      const id = String(node?.id || '');
      const m = /^line_(metal|wood|water|fire|earth|neutral|hunyuan)_t(\d)(?:_(\d))?(?:_(\d))?$/.exec(id);
      if (!m) return '';
      const line = m[1];
      const tier = Number(m[2] || 0);
      const lane = Number(m[3] || 0);
      const branch = Number(m[4] || 0);

      if (tier === 1) {
        if (line === 'neutral') return `数值：${formatLvValues([3, 8, 15], 'flat')} 无属性亲和`;
        return `数值：${formatLvValues([3, 8, 15], 'flat')} 亲和`;
      }

      if (line === 'metal' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.006, 0.012, 0.02])} 物理暴击率`;
        if (lane === 2) return `数值：${formatLvValues([0.01, 0.02, 0.032])} 物理穿防`;
        if (lane === 3) return `数值：${formatLvValues([0.005, 0.01, 0.015])} 物理吸血`;
      }

      if (line === 'fire' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.015, 0.03, 0.045])} 法术攻击力`;
        if (lane === 2) return `数值：${formatLvValues([0.006, 0.012, 0.018])} 法术暴击率`;
        if (lane === 3) return `数值：${formatLvValues([0.015, 0.03, 0.045])} 法术穿透`;
      }

      if (line === 'water' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.01, 0.02, 0.03])} 防御倍率，${formatLvValues([0.01, 0.02, 0.03])} 法术防御`;
        if (lane === 2) return `数值：${formatLvValues([0.03, 0.06, 0.09])} 治疗效果，${formatLvValues([0.006, 0.012, 0.018])} 法术防御`;
        if (lane === 3) return `数值：受到物理伤害 -${formatLvValues([0.006, 0.012, 0.018])}，受到法术伤害 -${formatLvValues([0.01, 0.02, 0.03])}`;
      }

      if (line === 'wood' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.006, 0.012, 0.018])} 物理伤害，${formatLvValues([0.006, 0.012, 0.018])} 法术攻击力`;
        if (lane === 2) return `数值：${formatLvValues([0.003, 0.006, 0.009])} 物理吸血，${formatLvValues([0.006, 0.012, 0.018])} 防御倍率`;
        if (lane === 3) return `数值：${formatLvValues([0.005, 0.01, 0.015])} 法术穿透，${formatLvValues([0.005, 0.01, 0.015])} 法术攻击力`;
      }

      if (line === 'neutral' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.013, 0.026, 0.039])} 法术攻击力`;
        if (lane === 2) return `数值：${formatLvValues([0.004, 0.008, 0.012])} 法术暴击率，${formatLvValues([0.0015, 0.003, 0.0045])} 物理暴击率`;
        if (lane === 3) return `数值：${formatLvValues([0.005, 0.01, 0.015])} 法术穿透，${formatLvValues([0.009, 0.018, 0.027])} 法术防御`;
      }

      if (line === 'hunyuan' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.008, 0.016, 0.024])} 物理伤害，${formatLvValues([0.004, 0.008, 0.012])} 法术攻击力`;
        if (lane === 2) return `数值：${formatLvValues([0.003, 0.006, 0.009])} 物理暴击率，${formatLvValues([0.003, 0.006, 0.009])} 法术暴击率`;
        if (lane === 3) return `数值：${formatLvValues([0.009, 0.018, 0.027])} 防御倍率，${formatLvValues([0.003, 0.006, 0.009])} 物理穿防，${formatLvValues([0.003, 0.006, 0.009])} 法术穿透`;
      }

      if (line === 'metal' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.01)} 物理暴击率`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.006)} 物理暴击率，+${formatPct(0.012)} 物理伤害`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.016)} 物理穿防`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.011)} 物理穿防，+${formatPct(0.01)} 物理伤害`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.008)} 物理吸血`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.005)} 物理吸血，+${formatPct(0.008)} 物理伤害`;
      }

      if (line === 'fire' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.04)} 法术攻击力`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.025)} 法术攻击力，+${formatPct(0.005)} 法术暴击率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.015)} 法术暴击率`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.009)} 法术暴击率，+${formatPct(0.014)} 法术穿透`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.04)} 法术穿透`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.02)} 法术穿透，+${formatPct(0.02)} 法术攻击力`;
      }

      if (line === 'neutral' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.034)} 法术攻击力`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.021)} 法术攻击力，+${formatPct(0.004)} 法术暴击率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.01)} 法术暴击率`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.006)} 法术暴击率，+${formatPct(0.005)} 物理暴击率`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.024)} 法术防御`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.008)} 法术穿透，+${formatPct(0.012)} 防御倍率`;
      }

      if (line === 'hunyuan' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.02)} 物理伤害`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.012)} 物理伤害，+${formatPct(0.005)} 物理暴击率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.008)} 物理暴击率，+${formatPct(0.008)} 法术暴击率`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.015)} 法术攻击力，+${formatPct(0.008)} 物理伤害`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.024)} 防御倍率`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.008)} 物理穿防，+${formatPct(0.008)} 法术穿透，+${formatPct(0.01)} 防御倍率`;
      }

      if (line === 'water' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.024)} 防御倍率`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.03)} 法术防御，受到法术伤害 -${formatPct(0.012)}`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.10)} 治疗效果`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.06)} 治疗效果，+${formatPct(0.012)} 防御倍率`;
        if (lane === 3 && branch === 1) return `数值：受到法术伤害 -${formatPct(0.028)}`;
        if (lane === 3 && branch === 2) return `数值：受到物理伤害 -${formatPct(0.02)}，+${formatPct(0.018)} 法术防御`;
      }

      if (line === 'wood' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.016)} 物理伤害`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.01)} 物理伤害，+${formatPct(0.01)} 法术攻击力`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.008)} 物理吸血`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.005)} 物理吸血，+${formatPct(0.012)} 防御倍率`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.05)} 持续伤害`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.07)} 木属性持续伤害，+${formatPct(0.008)} 法术攻击力`;
      }

      if (line === 'metal' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.05)} 物理暴伤倍率`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.006)} 物理暴击率，低血斩杀增伤上限 +${formatPct(0.03)}`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.015)} 物理穿防，${formatPct(0.06)} 概率追加一次 ${formatPct(0.05)} 本次伤害`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.016)} 物理穿防，+${formatPct(0.01)} 物理伤害`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.006)} 物理吸血，受到物理伤害 -${formatPct(0.02)}`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.005)} 物理吸血，反击回复比例 +${formatPct(0.06)}`;
      }

      if (line === 'fire' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.035)} 法术攻击力，受到法术伤害 -${formatPct(0.02)}`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.022)} 法术攻击力，+${formatPct(0.006)} 法术暴击率，+${formatPct(0.04)} 法术暴伤倍率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.01)} 法术暴击率，+${formatPct(0.06)} 法术暴伤倍率`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.007)} 法术暴击率，+${formatPct(0.0175)} 法术穿透`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.035)} 法术穿透，+${formatPct(0.03)} 法术暴伤倍率`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.015)} 法术穿透，+${formatPct(0.015)} 法术攻击力，受到法术伤害 -${formatPct(0.025)}`;
      }

      if (line === 'neutral' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.028)} 法术攻击力，受到法术伤害 -${formatPct(0.02)}`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.018)} 法术攻击力，+${formatPct(0.005)} 法术暴击率，+${formatPct(0.03)} 法术暴伤倍率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.009)} 法术暴击率，+${formatPct(0.018)} 法术防御`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.006)} 法术暴击率，+${formatPct(0.012)} 法术穿透`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.03)} 法术防御，+${formatPct(0.012)} 防御倍率`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.01)} 法术穿透，+${formatPct(0.012)} 法术攻击力，受到法术伤害 -${formatPct(0.015)}`;
      }

      if (line === 'hunyuan' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.018)} 物理伤害，+${formatPct(0.03)} 物理暴伤倍率`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.012)} 物理伤害，+${formatPct(0.012)} 法术攻击力，+${formatPct(0.004)} 物理暴击率`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.007)} 物理暴击率，+${formatPct(0.007)} 法术暴击率，+${formatPct(0.02)} 法术暴伤倍率`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.01)} 物理穿防，+${formatPct(0.01)} 法术穿透，+${formatPct(0.008)} 防御倍率`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.022)} 防御倍率，受到物理伤害 -${formatPct(0.015)}`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.015)} 防御倍率，+${formatPct(0.01)} 物理伤害，+${formatPct(0.01)} 法术攻击力`;
      }

      if (line === 'water' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.032)} 防御倍率，受到物理伤害 -${formatPct(0.02)}`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.032)} 法术防御，受到法术伤害 -${formatPct(0.02)}`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.12)} 治疗效果，受到法术伤害 -${formatPct(0.015)}`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.08)} 治疗效果，+${formatPct(0.015)} 防御倍率`;
        if (lane === 3 && branch === 1) return `数值：受到法术伤害 -${formatPct(0.03)}，受到物理伤害 -${formatPct(0.02)}`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.06)} 治疗效果，+${formatPct(0.02)} 法术防御，+${formatPct(0.01)} 防御倍率`;
      }

      if (line === 'wood' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.018)} 物理伤害，+${formatPct(0.004)} 物理暴击率`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.012)} 物理伤害，+${formatPct(0.012)} 法术攻击力，+${formatPct(0.008)} 法术穿透`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.01)} 物理吸血，受到物理伤害 -${formatPct(0.015)}`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.006)} 物理吸血，+${formatPct(0.015)} 防御倍率`;
        if (lane === 3 && branch === 1) return `数值：+${formatPct(0.07)} 持续伤害，+${formatPct(0.01)} 法术穿透`;
        if (lane === 3 && branch === 2) return `数值：+${formatPct(0.10)} 木属性持续伤害，+${formatPct(0.012)} 法术攻击力，受到法术伤害 -${formatPct(0.01)}`;
      }

      if (line === 'earth' && tier === 2) {
        if (lane === 1) return `数值：${formatLvValues([0.015, 0.03, 0.05])} 防御倍率`;
        if (lane === 2) return `数值：反击率 ${formatLvValues([0.02, 0.04, 0.06])}，反击伤害系数 ${formatLvValues([0.04, 0.06, 0.08])}`;
        if (lane === 3) return `数值：${formatLvValues([0.01, 0.02, 0.035])} 物理伤害`;
      }

      if (line === 'earth' && tier === 3) {
        if (lane === 1 && branch === 1) return `数值：+${formatPct(0.03)} 物理防御`;
        if (lane === 1 && branch === 2) return `数值：+${formatPct(0.03)} 法术防御`;
        if (lane === 2 && branch === 1) return `数值：+${formatPct(0.05)} 反击伤害系数`;
        if (lane === 2 && branch === 2) return `数值：+${formatPct(0.03)} 反击率`;
        if (lane === 3 && branch === 1) return `数值：每次物理命中附加自身最大生命值 ${formatPct(0.008)} 伤害`;
        if (lane === 3 && branch === 2) return `数值：每次物理命中附加自身物防 ${formatPct(0.10)} 伤害`;
      }

      if (line === 'earth' && tier === 4) {
        if (lane === 1 && branch === 1) return `数值：受到物理伤害 -${formatPct(0.05)}`;
        if (lane === 1 && branch === 2) return `数值：受到法术伤害 -${formatPct(0.05)}`;
        if (lane === 2 && branch === 1) return `数值：反击造成伤害时，回复该伤害 ${formatPct(0.12)} 的生命`;
        if (lane === 2 && branch === 2) return `数值：受技能伤害后额外 +${formatPct(0.08)} 反击率`;
        if (lane === 3 && branch === 1) return `数值：对低血目标额外增伤，最高 +${formatPct(0.06)}`;
        if (lane === 3 && branch === 2) return `数值：${formatPct(0.18)} 概率追加一次 ${formatPct(0.12)} 本次伤害`;
      }

      if (line === 'earth' && tier === 5 && lane === 3 && branch === 1) {
        return '数值：减伤计算防御封顶 6000；超出防御的 50% 转化为对应攻击';
      }

      if (line === 'earth' && tier === 5 && lane === 2 && branch === 1) {
        return '数值：反击伤害有40%概率提升至300%（PVP中为20%）';
      }

      if (line === 'earth' && tier === 5 && lane === 2 && branch === 2) {
        return '数值：反击伤害视为直接伤害；可暴击并可触发直伤附带特效';
      }

      if (line === 'metal' && tier === 5 && lane === 2 && branch === 1) {
        return '数值：常驻物理穿透失效并转化为1/4斩杀线；斩杀线以下目标直接斩杀，触发时回复自身生命（战斗内20%）';
      }

      if (line === 'metal' && tier === 5 && lane === 2 && branch === 2) {
        return '数值：造成任何直接物理伤害时，若自身没有蓄锐，则获得2轮蓄锐';
      }

      if (line === 'wood' && tier === 5 && lane === 1 && branch === 2) {
        return '数值：施加持续伤害时立即引爆（与绽放同规则）；该引爆总伤害 -10%';
      }

      if (line === 'water' && tier === 5 && lane === 3 && branch === 2) {
        return '数值：治疗效果 +18%；自身拥有护盾时，受到伤害 -12%';
      }

      if (line === 'wood' && tier === 5 && lane === 3 && branch === 2) {
        return '数值：持续伤害 +22%；无法再造成任何直接伤害';
      }

      if (line === 'fire' && tier === 5 && lane === 3 && branch === 1) {
        return '数值：伤害技能叠加焰势，每层法术最终伤害 +5%；4层时引爆，对双方全体造成各自最大生命值15%伤害';
      }

      if (line === 'hunyuan' && tier === 5 && lane === 3 && branch === 2) {
        return '数值：任意属性伤害在应用自身亲和后，再额外应用一次金木水火土亲和总和（不含无/混元）';
      }

      if (line === 'neutral' && tier === 5 && lane === 1 && branch === 2) {
        return '数值：无属性技能最终伤害 +25%；非无属性技能最终伤害 -20%';
      }

      if (line === 'neutral' && tier === 5 && lane === 3 && branch === 2) {
        return '数值：受到的单次伤害最高为最大生命值的16%，超出部分被阻拦';
      }

      return '';
    }

    // battle
    const battleState = reactive({ active:false, id:null, seq:0, log:[], result:null, busy:false, enemyName:'', playerHp:0, playerMaxHp:0, playerMp:0, playerMaxMp:0, playerAction:0, playerMaxAction:100, enemyHp:0, enemyMaxHp:0, enemyMp:0, enemyMaxMp:0, enemyAction:0, enemyMaxAction:100, _availableSkillIds:[], _combatStats:null });
    const battleStats = reactive({ battles:0, wins:0, losses:0, draws:0, expGained:0, spiritGained:0, drops:[] });
    function trackBattleResult(victory, draw, rewards) {
      battleStats.battles++;
      if (draw) battleStats.draws++;
      else if (victory) battleStats.wins++;
      else battleStats.losses++;
      if (rewards) {
        battleStats.expGained += Math.max(0, Math.floor(Number(rewards.exp) || 0));
        battleStats.spiritGained += Math.max(0, Math.floor(Number(rewards.spirit_stones) || 0));
        if (Array.isArray(rewards.drops)) {
          for (const d of rewards.drops) {
            const name = String(d.item_name || d.name || '');
            if (!name) continue;
            const existing = battleStats.drops.find(x => x.name === name);
            if (existing) existing.count += Math.max(1, Number(d.count) || 1);
            else battleStats.drops.push({ name, count: Math.max(1, Number(d.count) || 1) });
          }
        }
      }
    }
    function resetBattleStats() { battleStats.battles=0; battleStats.wins=0; battleStats.losses=0; battleStats.draws=0; battleStats.expGained=0; battleStats.spiritGained=0; battleStats.drops=[]; }
    let _logIdCounter = 0;
    function logClass(text, ev) {
      if (ev && ev.type === 'encounter') return 'log-encounter';
      if (ev && ev.type === 'victory') return 'log-victory';
      if (ev && ev.type === 'defeat') return 'log-defeat';
      if (ev && ev.type === 'draw') return 'log-reward';
      if (ev && ev.type === 'reward') return 'log-reward';
      if (/遭遇/.test(text)) return 'log-encounter';
      if (/胜利|获得|经验|掉落/.test(text)) return 'log-victory';
      if (/失败|死亡|阵亡/.test(text)) return 'log-defeat';
      if (/你.*⇒|我方/.test(text)) return 'log-ally';
      if (/⇒.*你|敌方/.test(text)) return 'log-enemy';
      if (/暴击/.test(text)) return 'log-crit';
      if (/治疗|恢复/.test(text)) return 'log-heal';
      return 'log-normal';
    }
    const MAX_LOG = 80;
    function addBattleLog(events) {
      if (!Array.isArray(events)) return;
      for (const ev of events) {
        const t = ev.text || ev.description || '';
        if (t) battleState.log.push({ id: ++_logIdCounter, text: t, cls: logClass(t, ev) });
      }
      if (battleState.log.length > MAX_LOG) battleState.log.splice(0, battleState.log.length - MAX_LOG);
      _battleLogDirty = true;
      nextTick(scrollBattleLog);
    }
    let _battleLogDirty = false;
    let _battleLogUserScroll = false;
    function scrollBattleLog() {
      const els = document.querySelectorAll('.battle-log-box');
      els.forEach(el => {
        if (_battleLogUserScroll) return;
        el.scrollTop = el.scrollHeight;
      });
      _battleLogDirty = false;
    }
    onMounted(() => {
      document.addEventListener('scroll', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('battle-log-box')) {
          const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 30;
          _battleLogUserScroll = !atBottom;
        }
      }, true);
    });
    async function restoreBattleFromServer(battleId) {
      if (!battleId) return false;
      try {
        const r = await api.battleState(battleId);
        if (!r.ok || r.status !== 'active') { battleState.active = false; battleState._combatStats = null; return false; }
        battleState.active = true;
        battleState.id = r.battleId;
        battleState.seq = r.last_seq || 0;
        battleState.result = null;
        battleState.enemyName = r.state?.enemy?.name || '未知';
        updateBattleHp(r.state);
        const evts = r.events || [];
        addBattleLog(evts.map(ev => ({ text: ev.text || ev.description || '', type: ev.type })));
        const maxEvtIdx = evts.reduce((m, e) => Math.max(m, Number(e.index) || 0), 0);
        if (maxEvtIdx > _pollEventIdx) _pollEventIdx = maxEvtIdx;
        if (battleState.log.length === 0) addBattleLog([{ text: `继续与${battleState.enemyName}战斗`, type: 'encounter' }]);
        return true;
      } catch (e) { return false; }
    }
    function updateBattleHp(s) {
      if (!s) return;
      var p = s.player, e = s.enemy;
      if (p) {
        battleState.playerHp = p.hp != null ? p.hp : battleState.playerHp;
        battleState.playerMaxHp = p.max_hp != null ? p.max_hp : battleState.playerMaxHp;
        battleState.playerMp = p.mp != null ? p.mp : battleState.playerMp;
        battleState.playerMaxMp = p.max_mp != null ? p.max_mp : battleState.playerMaxMp;
        var pact = p.action != null ? p.action : p.action_bar;
        battleState.playerAction = pact != null ? pact : battleState.playerAction;
        battleState.playerMaxAction = (p.max_action != null ? p.max_action : p.max_action_bar) || battleState.playerMaxAction || 100;
        if (Array.isArray(p.available_skill_ids)) battleState._availableSkillIds = p.available_skill_ids;
        // 战斗属性（服务器用 min_attack/max_attack/defense，客户端 player 用 min_phys_damage 等）
        battleState._combatStats = {
          minPhys: p.min_attack ?? p.min_phys_damage,
          maxPhys: p.max_attack ?? p.max_phys_damage,
          physDef: p.defense ?? p.phys_defense,
          spellAtk: p.spell_attack ?? p.min_spell_attack ?? p.max_spell_attack,
          spellDef: p.spell_defense,
          strength: p.strength, constitution: p.constitution, bone: p.bone, zhenyuan: p.zhenyuan, lingli: p.lingli, agility: p.agility
        };
      }
      if (e) {
        battleState.enemyHp = e.hp != null ? e.hp : battleState.enemyHp;
        battleState.enemyMaxHp = e.max_hp != null ? e.max_hp : battleState.enemyMaxHp;
        battleState.enemyMp = e.mp != null ? e.mp : battleState.enemyMp;
        battleState.enemyMaxMp = e.max_mp != null ? e.max_mp : battleState.enemyMaxMp;
        var eact = e.action != null ? e.action : e.action_bar;
        battleState.enemyAction = eact != null ? eact : battleState.enemyAction;
        battleState.enemyMaxAction = (e.max_action != null ? e.max_action : e.max_action_bar) || battleState.enemyMaxAction || 100;
      }
    }
    function _handleWsMessage(msg) {
      try {
        if (msg.type === 'battle_events') {
          _lastBattleActivityAt = Date.now();
          if (msg.battleId && msg.battleId !== battleState.id) {
            battleState.id = msg.battleId;
            _pollEventIdx = 0;
            battleState.active = true;
            battleState.result = null;
            if (msg.state?.enemy) battleState.enemyName = msg.state.enemy.name || '未知';
          }
          if (msg.events?.length) {
            addBattleLog(msg.events);
            const maxIdx = msg.events.reduce((m, e) => Math.max(m, e.index || 0), 0);
            if (maxIdx > _pollEventIdx) _pollEventIdx = maxIdx;
          }
          if (msg.event_index > _pollEventIdx) _pollEventIdx = msg.event_index;
          if (msg.state) updateBattleHp(msg.state);
        } else if (msg.type === 'battle_end') {
          _lastBattleActivityAt = Date.now();
          if (msg.battleId) battleState.id = msg.battleId;
          _processBattleEnd(msg);
          if (autoBattle.value) {
            const wait = (msg.rest_remaining_sec || 0);
            if (wait > 0) _restWait = wait;
          }
        } else if (msg.type === 'battle_start') {
          _lastBattleActivityAt = Date.now();
          battleState.id = msg.battleId;
          battleState.active = true;
          battleState.result = null;
          _pollEventIdx = 0;
          if (msg.state?.enemy) battleState.enemyName = msg.state.enemy.name || '未知';
          if (msg.state) updateBattleHp(msg.state);
          addBattleLog([{ text: '与' + (msg.state?.enemy?.name || '未知') + '战斗开始', type: 'encounter' }]);
        } else if (msg.type === 'disciple_battle_matched') {
          if (typeof window.discBattleOnMatched === 'function') window.discBattleOnMatched(msg.roomId, msg.state, msg.playerIndex);
        } else if (msg.type === 'disciple_battle_update') {
          if (typeof window.discBattleOnUpdate === 'function') window.discBattleOnUpdate(msg.roomId, msg.state);
        } else if (msg.type === 'offline_report') {
          _processOfflineReport(msg.data);
        } else if (msg.type === 'connected') {
          api.wsSetBattleDetail(activeTab.value === 'map');
          api.wsSetAutoRestart(autoBattle.value);
        }
      } catch {}
    }

    let _restWait = 0;
    let _lastBattleActivityAt = Date.now();
    let _pollEventIdx = 0;
    function _processOfflineReport(report) {
      if (!report || !report.battles) return;
      const expGained = Number(report.exp_gained ?? report.total_exp) || 0;
      const spiritGained = Number(report.spirit_gained ?? report.total_spirit_stones) || 0;
      const drawCount = Number(report.draws || 0) || 0;
      let msg = '离线挂机: ' + report.battles + '场, ' + report.wins + '胜' + report.losses + '负';
      if (drawCount > 0) msg += ' ' + drawCount + '平';
      if (expGained) msg += ', 经验+' + expGained;
      if (spiritGained) msg += ', 灵石+' + spiritGained;
      if (report.drops && report.drops.length) {
        msg += ', 掉落: ' + report.drops.map(function(d) { return (d.item_name || '?') + 'x' + (d.count || 1); }).join(', ');
        report.drops.forEach(function(d) { addInvLog('离线掉落', d.item_name || '?', d.count || 1); });
      }
      if (spiritGained > 0) addInvLog('离线挂机', '灵石', spiritGained);
      addBattleLog([{ text: msg, type: 'system' }]);
      showToast(msg);
    }
    async function startBattle() {
      const mapId = player.current_map_id || 1;
      battleState.result = null; battleState.seq = 0; _pollEventIdx = 0;
      battleState.playerHp = player.hp || player.max_hp || 0;
      battleState.playerMaxHp = player.max_hp || 0;
      battleState.playerMp = player.mp || player.max_mp || 0;
      battleState.playerMaxMp = player.max_mp || 0;
      try {
        const r = await api.battleStart(mapId, true, autoBattle.value);
        if (!r.ok) { _restWait = r.rest_remaining_sec || 0; showToast(r.error); return; }
        _lastBattleActivityAt = Date.now();
        _restWait = 0; battleState.active = true; battleState.id = r.battleId; battleState.seq = r.last_seq || 0;
        battleState.enemyName = r.enemyData?.name || r.enemy_name || r.state?.enemy?.name || '未知';
        updateBattleHp(r.state);
        api.wsSetAutoRestart(autoBattle.value);
        if (r.offline_report) _processOfflineReport(r.offline_report);
        if (r.resumed) addBattleLog([{ text: '继续与' + battleState.enemyName + '战斗', type: 'encounter' }]);
      } catch (e) { showToast(e.message); }
    }
    function _processBattleEnd(r) {
      battleState.active = false;
      const isDraw = !!r.draw;
      battleState.result = isDraw ? 'draw' : (r.victory ? 'victory' : 'defeat');
      battleState._combatStats = null;
      if (r.player) applyPlayer(r.player);
      const rw = r.rewards || {};
      trackBattleResult(!!r.victory, isDraw, rw);
      let msg = isDraw ? '战斗平局' : (r.victory ? '战斗胜利！' : '战斗失败');
      if (rw.exp) msg += ` 经验+${rw.exp}`;
      if (rw.drops?.length) {
        msg += ` 掉落: ${rw.drops.map(function(d){ return d.item_name || d.name || '?'; }).join(', ')}`;
        rw.drops.forEach(d => addInvLog('战斗掉落', d.item_name || d.name || '?', d.count || 1));
      }
      if (rw.spirit_stones > 0) addInvLog('战斗', '灵石', rw.spirit_stones);
      addBattleLog([{ text: msg, type: isDraw ? 'draw' : (r.victory ? 'victory' : 'defeat') }]);
    }
    async function pollBattle() {
      if (battleState.busy) return;
      battleState.busy = true;
      try {
        const r = await api.battlePoll(_pollEventIdx, autoBattle.value);
        if (!r.ok) return;
        _lastBattleActivityAt = Date.now();
        if (r.offline_report) _processOfflineReport(r.offline_report);
        if (r.events_reset) {
          addBattleLog([{ text: '部分旧战斗记录已过期，已从最新可用记录继续。', type: 'system' }]);
          if (r.events_from > 0) _pollEventIdx = Math.max(0, r.events_from - 1);
        }
        if (r.battleId && r.battleId !== battleState.id) {
          battleState.id = r.battleId;
          _pollEventIdx = 0;
          battleState.active = true;
          battleState.result = null;
          if (r.state?.enemy) battleState.enemyName = r.state.enemy.name || '未知';
          
        }
        if (r.events?.length) {
          addBattleLog(r.events);
          const maxIdx = r.events.reduce((m, e) => Math.max(m, e.index || 0), 0);
          if (maxIdx > _pollEventIdx) _pollEventIdx = maxIdx;
        }
        if (r.event_index > _pollEventIdx) _pollEventIdx = r.event_index;
        if (r.state) updateBattleHp(r.state);
        if (r.player) applyPlayer(r.player);
        if (!r.active && r.finished) {
          _processBattleEnd(r);
        } else if (!r.active && !r.finished) {
          battleState.active = false;
          battleState._combatStats = null;
        }
      } catch (e) { /* ignore transient poll errors */ } finally { battleState.busy = false; }
    }
    const currentMap = computed(() => getCurrentMapInfo(player, gameData.maps));
    const mapDropMetaById = computed(() => {
      const src = gameData.maps;
      const maps = Array.isArray(src) ? src : (src && typeof src === 'object' ? Object.values(src) : []);
      const out = Object.create(null);
      for (const m of maps) {
        const id = Number(m?.id) || 0;
        if (id <= 0) continue;
        const drops = getMapDrops(m, gameData.enemies, itemMap, getItem) || [];
        const text = drops.length ? `${drops.slice(0, 6).join('、')}${drops.length > 6 ? '…' : ''}` : '';
        out[id] = { drops, hasDrops: drops.length > 0, previewText: text };
      }
      return out;
    });
    const mapTooltipById = computed(() => {
      const src = gameData.maps;
      const maps = Array.isArray(src) ? src : (src && typeof src === 'object' ? Object.values(src) : []);
      const out = Object.create(null);
      for (const m of maps) {
        const id = Number(m?.id) || 0;
        if (id <= 0) continue;
        const meta = mapDropMetaById.value[id] || { drops: [] };
        out[id] = buildMapTooltip(m, gameData.enemies, meta.drops || []);
      }
      return out;
    });
    function _getMapDropMeta(m) {
      const id = Number(m?.id) || 0;
      if (id > 0 && mapDropMetaById.value[id]) return mapDropMetaById.value[id];
      const drops = getMapDrops(m, gameData.enemies, itemMap, getItem) || [];
      return {
        drops,
        hasDrops: drops.length > 0,
        previewText: drops.length ? `${drops.slice(0, 6).join('、')}${drops.length > 6 ? '…' : ''}` : ''
      };
    }
    function getCurrentMap() {
      return currentMap.value;
    }
    function getMapTooltip(m) {
      const id = Number(m?.id) || 0;
      if (id > 0 && Object.prototype.hasOwnProperty.call(mapTooltipById.value, id)) {
        return mapTooltipById.value[id] || '';
      }
      const meta = _getMapDropMeta(m);
      return buildMapTooltip(m, gameData.enemies, meta.drops || []);
    }
    function getMapDropsPreview(m) {
      return _getMapDropMeta(m).drops;
    }
    function hasMapDropsPreview(m) {
      return _getMapDropMeta(m).hasDrops;
    }
    function getMapDropsPreviewText(m) {
      return _getMapDropMeta(m).previewText;
    }
    function showMapInfo(m, ev) {
      if (!m) return;
      const drops = getMapDropsPreview(m);
      const lines = buildMapInfoLines(m, gameData.enemies, drops);
      if (!lines.length) lines.push({ t: 'desc', text: '暂无详细信息' });
      itemTooltip.lines = lines;
      const rect = ev.currentTarget.getBoundingClientRect();
      _positionTooltip(rect.left, rect.top, rect.right, rect.bottom);
    }
    function getSectName(sectId) { const s = (gameData.sects || []).find(x => x.id === sectId); return s ? s.name : '未知'; }
    function getRerollLockArr() { return rerollLocked.value.slice(); }
    const AFFIX_STAT_LABELS = { strength:'力量', constitution:'体质', bone:'根骨', agility:'身法', zhenyuan:'真元', lingli:'灵力', turn_end_mp:'回法', phys_crit_rate_bonus:'物暴', spell_crit_rate_bonus:'法暴', phys_crit_damage_bonus:'物暴伤', spell_crit_damage_bonus:'法暴伤', phys_lifesteal_pct:'物吸血', spell_lifesteal_pct:'法吸血', phys_damage_pct:'物伤', spell_damage_pct:'法伤', phys_flat_damage:'物攻', spell_flat_damage:'法攻', phys_defense_pct:'物防%', spell_defense_pct:'法防%', phys_defense_flat:'点物防', spell_defense_flat:'点法防', phys_splash_pct:'物溅射', spell_splash_pct:'法溅射' };
    function fmtAffixStat(stat) { return AFFIX_STAT_LABELS[stat] || (stat||'').replace(/_/g,' '); }
    function fmtMailAttach(attachments) { if (!attachments || !attachments.length) return ''; return attachments.map(function(a){ return (a.name||'物品')+'x'+(a.count||1); }).join(', '); }
    async function selectMap(mapId) { try { const r = await api.setMap(mapId); if (!r.ok) { showToast(r.error); return; } applyPlayer(r.player); showToast(`已切换到${r.map_name}`); } catch (e) { showToast(e.message); } }
    const autoBattle = ref(localStorage.getItem('auto_battle') === '1');
    let autoBattleTimer = null;
    let _autoBattleLoopRunning = false;
    let _autoBattleLoopToken = 0;
    const WS_IDLE_POLL_THRESHOLD_MS = 9000;

    function _clearAutoBattleTimer() {
      if (autoBattleTimer) {
        clearTimeout(autoBattleTimer);
        autoBattleTimer = null;
      }
    }

    function _scheduleAutoBattle(delayMs, token = _autoBattleLoopToken) {
      if (!autoBattle.value) return;
      if (token !== _autoBattleLoopToken) return;
      _clearAutoBattleTimer();
      const waitMs = Math.max(250, Math.floor(Number(delayMs) || 0));
      autoBattleTimer = setTimeout(() => runAutoBattle(token), waitMs);
    }

    function stopAutoBattleLoop() {
      _autoBattleLoopToken += 1;
      _autoBattleLoopRunning = false;
      _clearAutoBattleTimer();
    }

    async function toggleAutoBattle() {
      autoBattle.value = !autoBattle.value;
      localStorage.setItem('auto_battle', autoBattle.value ? '1' : '0');
      try { await api.battleSetAutoRestart(autoBattle.value, player.current_map_id || 1); } catch (e) { showToast(e.message); }
      api.wsSetAutoRestart(autoBattle.value);
      if (autoBattle.value) {
        _autoBattleLoopToken += 1;
        _scheduleAutoBattle(0, _autoBattleLoopToken);
      }
      else {
        stopAutoBattleLoop();
        if (battleState.active) api.battlePoll(_pollEventIdx, false).catch(function() {});
      }
    }
    async function runAutoBattle(token = _autoBattleLoopToken) {
      if (!autoBattle.value) return;
      if (token !== _autoBattleLoopToken) return;
      if (_autoBattleLoopRunning) return;
      _autoBattleLoopRunning = true;
      try {
        if (battleState.busy) { _scheduleAutoBattle(650, token); return; }
        if (!battleState.active) {
          await startBattle();
          if (_restWait > 0) { _scheduleAutoBattle(Math.min(_restWait + 1, 30) * 1000, token); return; }
          _scheduleAutoBattle(1100, token);
          return;
        }
        if (api.isWsConnected()) {
          // WS 模式下若长时间没收到战斗活动，主动轮询一次避免漏推送导致卡住。
          const idleMs = Math.max(0, Date.now() - Number(_lastBattleActivityAt || 0));
          if (idleMs >= WS_IDLE_POLL_THRESHOLD_MS) {
            await pollBattle();
            _scheduleAutoBattle(battleState.active ? 1600 : 1200, token);
          } else {
            _scheduleAutoBattle(2400, token);
          }
        } else {
          await pollBattle();
          _scheduleAutoBattle(battleState.active ? 1600 : 3200, token);
        }
      } catch (e) { _scheduleAutoBattle(3000, token); }
      finally { _autoBattleLoopRunning = false; }
    }

    // inventory log
    const invLogs = ref([]);
    const showInvLog = ref(false);
    const MAX_INV_LOGS = 200;
    function addInvLog(source, itemName, delta, extra) {
      invLogs.value.unshift({ time: new Date().toLocaleTimeString(), source, itemName, delta, extra: extra || '' });
      if (invLogs.value.length > MAX_INV_LOGS) invLogs.value.length = MAX_INV_LOGS;
    }

    // inventory
    const invPage = ref(0);
    const invPageCount = computed(() => { const inv = player.inventory; return Array.isArray(inv) ? Math.max(1, inv.length) : 1; });
    function getInvSlot(page, idx) {
      const inv = player.inventory;
      if (!Array.isArray(inv) || !Array.isArray(inv[page])) return null;
      const s = inv[page]?.[idx];
      if (!s) return null;
      if (s.item && s.item.id) return { ...s.item, count: s.count || 1 };
      if (s.id) return s;
      return null;
    }
    const selectedInvSlot = reactive({ page:-1, idx:-1, item:null, useCount:1 });
    function selectInvSlot(page, idx) { selectedInvSlot.page = page; selectedInvSlot.idx = idx; selectedInvSlot.item = getInvSlot(page, idx); selectedInvSlot.useCount = 1; }
    const ROOT_TRANSFER_CHOICES = [
      { key: 'metal', label: '金灵根' },
      { key: 'wood', label: '木灵根' },
      { key: 'water', label: '水灵根' },
      { key: 'fire', label: '火灵根' },
      { key: 'earth', label: '土灵根' }
    ];
    const ROOT_TRANSFER_ALIAS = {
      metal: 'metal', wood: 'wood', water: 'water', fire: 'fire', earth: 'earth',
      '金': 'metal', '木': 'wood', '水': 'water', '火': 'fire', '土': 'earth',
      '金灵根': 'metal', '木灵根': 'wood', '水灵根': 'water', '火灵根': 'fire', '土灵根': 'earth'
    };
    function promptTargetRootForTransfer() {
      const optionText = ROOT_TRANSFER_CHOICES.map((x, i) => `${i + 1}.${x.label}`).join('  ');
      const raw = window.prompt(`请选择目标灵根（输入序号或名称）\n${optionText}`, '1');
      if (raw == null) return null;
      const str = String(raw).trim();
      if (!str) return '';
      const idx = Number(str);
      if (Number.isFinite(idx) && idx >= 1 && idx <= ROOT_TRANSFER_CHOICES.length) {
        return ROOT_TRANSFER_CHOICES[idx - 1].key;
      }
      const lower = str.toLowerCase();
      return ROOT_TRANSFER_ALIAS[lower] || ROOT_TRANSFER_ALIAS[str] || '';
    }
    function getItemStat(item, key) {
      if (!item) return null;
      var s = item.stats;
      var keys = [key];
      if (key === 'minPhysDamage') keys = ['minPhysDamage', 'min_phys_damage', 'minAttack', 'min_attack'];
      if (key === 'maxPhysDamage') keys = ['maxPhysDamage', 'max_phys_damage', 'maxAttack', 'max_attack'];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = (item[k] != null ? item[k] : (s && s[k] != null ? s[k] : null));
        if (v != null) return v;
      }
      return null;
    }
    function promptEquipSlotForGoldenTuner() {
      var input = window.prompt('请输入要调整的装备部位数字：\n1武器 2头部 3肩部 4胸部 5腿部 6手部 7戒指 8项链 9披风', '1');
      if (input == null) return null;
      var idx = Number(String(input).trim());
      if (!Number.isFinite(idx)) return 0;
      idx = Math.floor(idx);
      if (idx < 1 || idx > 9) return 0;
      return idx;
    }
    async function doUseItem() {
      if (selectedInvSlot.page < 0) return;
      const cnt = Math.max(1, Math.floor(Number(selectedInvSlot.useCount) || 1));
      const iName = selectedInvSlot.item?.name || '物品';
      const eid = Number(selectedInvSlot.item?.id || 0);
      const effects = Array.isArray(selectedInvSlot.item?.effects) ? selectedInvSlot.item.effects : [];
      const needsRootTransferTarget = effects.some(e => String(e?.type || '') === 'spirit_root_transfer_select');
      const needsGoldenTunerSlot = effects.some(e => String(e?.type || '') === 'golden_equipment_tuner');
      const useOptions = {};
      if (needsRootTransferTarget) {
        const targetRoot = promptTargetRootForTransfer();
        if (targetRoot == null) return;
        if (!targetRoot) {
          showToast('请输入有效目标灵根（金/木/水/火/土）');
          return;
        }
        useOptions.target_root_type = targetRoot;
      }
      if (needsGoldenTunerSlot) {
        const equipSlot = promptEquipSlotForGoldenTuner();
        if (equipSlot == null) return;
        if (!equipSlot) {
          showToast('请输入有效部位数字（1-9）');
          return;
        }
        useOptions.equip_slot = equipSlot;
      }
      try {
        const r = await api.useItem(
          selectedInvSlot.page,
          selectedInvSlot.idx,
          cnt,
          eid,
          Object.keys(useOptions).length > 0 ? useOptions : null
        );
        if (!r.ok) {
          if (r.code === 'SLOT_MISMATCH') doSync();
          showToast(r.error);
          return;
        }
        applyPlayer(r.player);
        addInvLog('使用', iName, -Math.max(1, Number(r.used_count) || cnt));
        selectedInvSlot.item = null;
        selectedInvSlot.page = -1;
        showToast(r.msg || '使用成功');
      } catch (e) {
        showToast(e.message);
      }
    }
    async function doSellItem() {
      if (selectedInvSlot.page < 0) return;
      if (isEquipType(selectedInvSlot.item?.type) && selectedInvSlot.item?.locked) {
        showToast('该装备已锁定，无法回收');
        return;
      }
      const cnt = Math.max(1, Math.floor(Number(selectedInvSlot.useCount) || 1));
      const itemName = selectedInvSlot.item?.name || '物品';
      const eid = Number(selectedInvSlot.item?.id || 0);
      if (!confirm(`确定回收「${itemName}」x${cnt}？`)) return;
      try {
        const r = await api.sellItem(selectedInvSlot.page, selectedInvSlot.idx, cnt, eid);
        if (!r.ok) {
          if (r.code === 'SLOT_MISMATCH') doSync();
          showToast(r.error);
          return;
        }
        applyPlayer(r.player);
        addInvLog('回收', itemName, -cnt, `获得${r.spirit_stones}灵石`);
        selectedInvSlot.item = null;
        selectedInvSlot.page = -1;
        showToast(`回收获得${r.spirit_stones}灵石`);
      } catch (e) { showToast(e.message); }
    }
    async function doSortInv() { try { const r = await api.sortInventory(); if (r?.ok) applyPlayer(r.player); } catch(e) { showToast(e.message); } }
    async function doEquipFromInv() { if (selectedInvSlot.page<0) return; const iName = selectedInvSlot.item?.name||'装备'; const eid = Number(selectedInvSlot.item?.id||0); try { const r = await api.equip(selectedInvSlot.page, selectedInvSlot.idx, eid); if (!r.ok) { if(r.code==='SLOT_MISMATCH') doSync(); showToast(r.error); return; } applyPlayer(r.player); addInvLog('装备', iName, -1); selectedInvSlot.item=null; selectedInvSlot.page=-1; showToast('装备成功'); } catch(e) { showToast(e.message); } }
    async function toggleEquipLock() {
      if (selectedInvSlot.page < 0 || !selectedInvSlot.item) return;
      if (!isEquipType(selectedInvSlot.item.type)) {
        showToast('仅装备支持锁定');
        return;
      }
      const nextLocked = !Boolean(selectedInvSlot.item.locked);
      try {
        const r = await api.toggleInventoryLock(selectedInvSlot.page, selectedInvSlot.idx, nextLocked);
        if (!r.ok) {
          if (r.code === 'SLOT_MISMATCH') doSync();
          showToast(r.error || '锁定操作失败');
          return;
        }
        applyPlayer(r.player);
        selectedInvSlot.item = getInvSlot(selectedInvSlot.page, selectedInvSlot.idx);
        showToast(r.locked ? '装备已锁定' : '装备已解锁');
      } catch (e) { showToast(e.message); }
    }
    async function doDecompose() {
      if (selectedInvSlot.page<0) return;
      if (isEquipType(selectedInvSlot.item?.type) && selectedInvSlot.item?.locked) {
        showToast('该装备已锁定，无法分解');
        return;
      }
      const itemName = selectedInvSlot.item?.name || '装备';
      if (!confirm(`确定分解「${itemName}」？此操作不可撤销。`)) return;
      try {
        const eid = Number(selectedInvSlot.item?.id||0);
        const r = await api.decomposeEquipment(selectedInvSlot.page, selectedInvSlot.idx, eid);
        if (!r.ok) { if(r.code==='SLOT_MISMATCH') doSync(); showToast(r.error); return; }
        applyPlayer(r.player);
        addInvLog('分解', itemName, -1, r.catalyst_dropped ? `获得${r.catalyst_name}` : '');
        if (r.catalyst_dropped) addInvLog('分解产出', r.catalyst_name, 1);
        selectedInvSlot.item=null; selectedInvSlot.page=-1;
        const msg = r.catalyst_dropped ? `分解完成，获得 ${r.catalyst_name}` : '分解完成，未获得催化剂';
        showToast(msg);
      } catch(e) { showToast(e.message); }
    }
    const batchDecomposeModal = reactive({ open: false, items: [], selected: [] });
    function openBatchDecompose() {
      const inv = player.inventory || [];
      const items = [];
      let lockedSkipped = 0;
      for (let p = 0; p < inv.length; p++) {
        if (!Array.isArray(inv[p])) continue;
        for (let s = 0; s < inv[p].length; s++) {
          const slot = inv[p][s];
          if (!slot || !slot.item) continue;
          const t = String(slot.item.type || '');
          if (!['weapon','head','shoulder','chest','legs','hands','ring','amulet','back'].includes(t)) continue;
          if (slot.item.locked) { lockedSkipped += 1; continue; }
          items.push({ page: p, slot: s, item: slot.item, count: slot.count || 1 });
        }
      }
      batchDecomposeModal.items = items;
      batchDecomposeModal.selected = [];
      batchDecomposeModal.open = true;
      if (lockedSkipped > 0) showToast(`已自动跳过 ${lockedSkipped} 件锁定装备`);
    }
    function toggleBatchDecomposeSelect(page, slot) {
      const idx = batchDecomposeModal.selected.findIndex(x => x.page === page && x.slot === slot);
      if (idx >= 0) batchDecomposeModal.selected.splice(idx, 1);
      else batchDecomposeModal.selected.push({ page, slot });
    }
    function isBatchDecomposeSelected(page, slot) {
      return batchDecomposeModal.selected.some(x => x.page === page && x.slot === slot);
    }
    async function doBatchDecompose() {
      if (batchDecomposeModal.selected.length === 0) { showToast('请先选择要分解的装备'); return; }
      if (!confirm(`确定分解选中的 ${batchDecomposeModal.selected.length} 件装备？此操作不可撤销。`)) return;
      try {
        const slots = batchDecomposeModal.selected.map(x => ({ page: x.page, slot_index: x.slot }));
        const r = await api.decomposeEquipmentBatch(slots);
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
        const n = r.results?.length || batchDecomposeModal.selected.length;
        const catalysts = r.results?.filter(x => x.catalyst_dropped).length || 0;
        addInvLog('批量分解', `${n}件装备`, -n, catalysts ? `获得${catalysts}个催化剂` : '');
        if (r.results) r.results.forEach(x => { if (x.catalyst_dropped) addInvLog('分解产出', x.catalyst_name, 1); });
        const detail = catalysts ? `，获得${catalysts}个催化剂` : '，未获得催化剂';
        showToast(`分解${n}件${detail}`);
        batchDecomposeModal.open = false;
      } catch (e) { showToast(e.message); }
    }

    // equipment
    const EQUIP_SLOTS = ['weapon','head','shoulder','chest','legs','hands','ring','amulet','back','talisman'];
    const EQUIP_SLOT_NAMES = { weapon:'武器', head:'头盔', shoulder:'护肩', chest:'胸甲', legs:'腿甲', hands:'护手', ring:'戒指', amulet:'项链', back:'披风', talisman:'符箓' };
    const _EQUIP_TYPES = new Set(['weapon','head','shoulder','chest','legs','hands','ring','amulet','back']);
    function isEquipType(type) { return _EQUIP_TYPES.has(String(type || '')); }
    function isEquipBuyOrder(listing) {
      if (listing.item_snapshot?.equipment_criteria) return true;
      if (Number(listing.item_id) === 0) return true;
      const it = getItem(listing.item_id);
      if (it && isEquipType(it.type)) return true;
      return false;
    }
    function getEquipped(slot) { return player.equipment?.[slot] || null; }
    async function doUnequip(slot) { try { const r = await api.unequip(slot); if (!r.ok) { showToast(r.error); return; } applyPlayer(r.player); showToast('已卸下'); } catch(e) { showToast(e.message); } }

    // skills
    function calcExpToNext(lv, base) { return Math.floor(base * Math.pow(1.5, lv - 1)); }
    // skill presets
    const presetName = ref('升级');
    const PRESETS = ['升级', '副本', '斗法'];
    const PRESET_KEYS = { '升级':'grind', '副本':'dungeon', '斗法':'duel' };
    const PRESET_KEYS_REV = { grind:'升级', dungeon:'副本', duel:'斗法' };

    const curPresetKey = computed(() => PRESET_KEYS[presetName.value] || 'grind');

    const curPresetSkills = computed(() => {
      const ps = player.skill_presets;
      if (!ps || typeof ps !== 'object') return [];
      const p = ps[curPresetKey.value];
      if (!p || !Array.isArray(p.equipped_skills)) return [];
      return p.equipped_skills.map(id => Math.floor(Number(id) || 0)).filter(id => id > 0);
    });

    const presetKeySkillId = computed(() => {
      const ps = player.skill_presets;
      if (!ps || typeof ps !== 'object') return 0;
      const p = ps[curPresetKey.value];
      return p ? Math.floor(Number(p.key_skill_id) || 0) : 0;
    });

    const presetEquipCount = computed(() => curPresetSkills.value.length);

    function isSkillEquipped(id) {
      const eq = curPresetSkills.value;
      const n = Math.floor(Number(id) || 0);
      return eq.includes(n);
    }

    const learnedSkills = computed(() => {
      void gameData.loaded;
      const eqList = curPresetSkills.value;
      const keyId = presetKeySkillId.value;
      const sl = player.skill_levels;
      const skills = gameData.skills || [];
      if (!sl || typeof sl !== 'object') return [];
      return Object.entries(sl).map(([id, data]) => {
        const sid = Number(id) || id;
        const nid = Math.floor(Number(sid) || 0);
        const s = skills.find(x => x.id == sid) || getSkill(sid);
        const lv = data?.level || 1;
        const exp = data?.exp || 0;
        const cap = s?.levelCap || 99;
        const needed = lv < cap ? calcExpToNext(lv, s?.baseExp || 100) : 0;
        return { id: sid, level: lv, exp, expNeeded: needed, maxLevel: cap, name: (s && s.name) || `技能${id}`, data: s, equipped: eqList.includes(nid) };
      });
    });

    async function toggleSkillEquip(id) {
      const pk = curPresetKey.value;
      const equipped = isSkillEquipped(id);
      try {
        const r = await (equipped ? api.presetUnequipSkill(pk, id) : api.presetEquipSkill(pk, id));
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
      } catch(e) { showToast(e.message); }
    }

    async function doSetKeySkill(id) {
      const pk = curPresetKey.value;
      try {
        const r = await api.presetSetKeySkill(pk, id);
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player);
        showToast('已设置主技');
      } catch(e) { showToast(e.message); }
    }

    // techniques
    const learnedTechniques = computed(() => {
      void gameData.loaded;
      const tl = player.technique_levels;
      const techniques = gameData.techniques || [];
      if (!tl || typeof tl !== 'object') return [];
      return Object.entries(tl).map(([id, data]) => {
        const tid = Number(id) || id;
        const t = techniques.find(x => x.id == tid) || getTech(tid);
        const mainId = player.techniques?.main?.id || player.techniques?.main || 0;
        const subId = player.techniques?.sub?.id || player.techniques?.sub || 0;
        const lv = data?.level || 1;
        const exp = data?.exp || 0;
        const cap = t?.levelCap || 99;
        const needed = lv < cap ? calcExpToNext(lv, t?.baseExp || 100) : 0;
        return { id: tid, level: lv, exp, expNeeded: needed, maxLevel: cap, name: (t && t.name) || `功法${id}`, data: t, isMain: Number(mainId) === tid, isSub: Number(subId) === tid };
      });
    });
    async function setTechnique(slot, id) { try { const r = await api.setTechnique(slot, id); if (!r.ok) { showToast(r.error); return; } applyPlayer(r.player); showToast(slot==='main'?'已设为主修':'已设为辅修'); } catch(e) { showToast(e.message); } }

    // dictionary
    const dictCategory = ref('全部');
    const dictPage = ref(1);
    const DICT_PAGE_SIZE = 5;
    const dictFiltered = computed(() => {
      const cat = dictCategory.value;
      return DICTIONARY_ENTRIES.filter(e => cat === '全部' || e.category === cat);
    });
    const dictPageCount = computed(() => Math.max(1, Math.ceil((dictFiltered.value.length || 0) / DICT_PAGE_SIZE)));
    const dictPageEntries = computed(() => {
      const start = (dictPage.value - 1) * DICT_PAGE_SIZE;
      return (dictFiltered.value || []).slice(start, start + DICT_PAGE_SIZE);
    });
    watch(dictCategory, () => { dictPage.value = 1; });

    // mail
    const mails = ref([]);
    async function loadMails() { try { const r = await api.mailList(); if (r.ok) mails.value = r.mails || []; } catch(e) {} }
    async function claimMail(id) { try { const r = await api.mailClaim(id); if (!r.ok) { showToast(r.error); return; } if (r.player) applyPlayer(r.player); showToast('领取成功'); loadMails(); } catch(e) { showToast(e.message); } }
    async function claimAllMail() { try { const r = await api.mailClaimAll(); if (!r.ok) { showToast(r.error); return; } if (r.player) applyPlayer(r.player); showToast(`领取了${r.claimed_count||0}封`); loadMails(); } catch(e) { showToast(e.message); } }

    const SECT_TIER_NAMES = { basic:'初阶', intermediate:'中阶', advanced:'高阶' };

    // talisman
    async function setTalisman(itemId) {
      try {
        const r = await api.setTalisman(itemId);
        if (!r.ok) { showToast(r.error); return; }
        applyPlayer(r.player); showToast(itemId > 0 ? '符箓已装备' : '符箓已卸下');
      } catch (e) { showToast(e.message); }
    }

    // trial
    const trialSubTab = ref('heart');
    const trialState = reactive({ battleId: null, log: [], result: null, running: false, floor: 0 });
    const trialContractState = reactive({
      modifiers: [],
      selectedIds: [],
      dungeonId: 0,
      dungeonMultipliers: {},
      battleId: null,
      log: [],
      result: null,
      running: false,
      score: 0,
      rewardMult: 1,
      maxScore: 0,
      maxSingleRunCoins: 0
    });
    const trialShopState = reactive({
      goods: [],
      qtyMap: {}
    });
    const TRIAL_SHOP_PAGE_SIZE = 6;
    const trialShopPage = ref(1);
    const trialShopPageCount = computed(() => {
      const total = Array.isArray(trialShopState.goods) ? trialShopState.goods.length : 0;
      return Math.max(1, Math.ceil(total / TRIAL_SHOP_PAGE_SIZE));
    });
    const trialShopPagedGoods = computed(() => {
      const list = Array.isArray(trialShopState.goods) ? trialShopState.goods : [];
      const start = (trialShopPage.value - 1) * TRIAL_SHOP_PAGE_SIZE;
      return list.slice(start, start + TRIAL_SHOP_PAGE_SIZE);
    });
    function setTrialShopPage(page) {
      const p = Math.max(1, Math.min(trialShopPageCount.value, Math.floor(Number(page) || 1)));
      trialShopPage.value = p;
    }
    watch(() => trialShopState.goods.length, () => {
      if (trialShopPage.value > trialShopPageCount.value) trialShopPage.value = trialShopPageCount.value;
      if (trialShopPage.value < 1) trialShopPage.value = 1;
    });
    function trialContractSelectedSet() {
      return new Set(trialContractState.selectedIds || []);
    }
    const trialContractSelectedScore = computed(() => {
      const sel = trialContractSelectedSet();
      return (trialContractState.modifiers || [])
        .filter(m => sel.has(String(m.id || '')))
        .reduce((s, m) => s + (Number(m.score) || 0), 0);
    });
    const trialContractRewardPreview = computed(() => {
      const score = Math.max(0, Number(trialContractSelectedScore.value) || 0);
      const dungeonId = Math.floor(Number(trialContractState.dungeonId) || 0);
      const dungeonMul = Math.max(1, Number(trialContractState.dungeonMultipliers?.[String(dungeonId)] || 1));
      const base = 12;
      const cap = 68;
      const k = 7;
      return Math.max(1, Math.floor((base + cap * (1 - Math.exp(-score / k))) * dungeonMul));
    });
    const trialContractDungeonMultiplier = computed(() => {
      const dungeonId = Math.floor(Number(trialContractState.dungeonId) || 0);
      return Math.max(1, Number(trialContractState.dungeonMultipliers?.[String(dungeonId)] || 1));
    });
    async function loadTrialContracts() {
      try {
        const r = await api.trialContracts();
        if (!r.ok) return;
        trialContractState.modifiers = Array.isArray(r.modifiers) ? r.modifiers : [];
        trialContractState.maxScore = Math.max(0, Number(r.max_score) || 0);
        trialContractState.maxSingleRunCoins = Math.max(0, Number(r.max_single_run_coins) || 0);
        const mulMap = {};
        const bands = Array.isArray(r.dungeon_reward_multipliers) ? r.dungeon_reward_multipliers : [];
        for (const it of bands) {
          const did = Math.floor(Number(it?.dungeon_id) || 0);
          if (did <= 0) continue;
          mulMap[String(did)] = Math.max(1, Number(it?.multiplier) || 1);
        }
        trialContractState.dungeonMultipliers = mulMap;
        if (!trialContractState.selectedIds.length) {
          trialContractState.selectedIds = [];
        } else {
          const allow = new Set(trialContractState.modifiers.map(m => String(m.id || '')));
          trialContractState.selectedIds = trialContractState.selectedIds.filter(id => allow.has(id));
        }
        if (!(Number(trialContractState.dungeonId) > 0)) {
          const first = (Array.isArray(gameData.dungeons) ? gameData.dungeons : []).find(d => Number(d?.id) > 0);
          if (first) trialContractState.dungeonId = Number(first.id);
        }
      } catch (_) {}
    }
    async function loadTrialShop() {
      try {
        const r = await api.trialShop();
        if (!r?.ok) return;
        trialShopState.goods = Array.isArray(r.goods) ? r.goods : [];
        trialShopPage.value = 1;
        const qtyMap = {};
        for (const g of trialShopState.goods) qtyMap[String(g.id || '')] = 1;
        trialShopState.qtyMap = qtyMap;
      } catch (_) {}
    }
    function setTrialShopQty(shopId, value) {
      const id = String(shopId || '').trim();
      if (!id) return;
      trialShopState.qtyMap[id] = Math.max(1, Math.min(200, Math.floor(Number(value) || 1)));
    }
    function getTrialShopQty(shopId) {
      const id = String(shopId || '').trim();
      return Math.max(1, Math.floor(Number(trialShopState.qtyMap[id]) || 1));
    }
    async function buyTrialShop(shopId) {
      const id = String(shopId || '').trim();
      if (!id) return;
      try {
        const r = await api.trialShopBuy(id, getTrialShopQty(id));
        if (!r?.ok) { showToast(r?.error || '购买失败'); return; }
        if (r.player) applyPlayer(r.player);
        showToast(`购买成功：${r.bought?.item_name || '道具'} x${r.bought?.count || 0}`);
      } catch (e) { showToast(e.message); }
    }
    function toggleTrialContractModifier(id) {
      const sid = String(id || '').trim();
      if (!sid) return;
      const list = Array.isArray(trialContractState.selectedIds) ? trialContractState.selectedIds.slice() : [];
      const idx = list.indexOf(sid);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        if (list.length >= 6) {
          showToast('最多选择6个危机词条');
          return;
        }
        list.push(sid);
      }
      trialContractState.selectedIds = list;
    }
    async function startTrialContract() {
      const dungeonId = Math.floor(Number(trialContractState.dungeonId) || 0);
      if (dungeonId <= 0) { showToast('请选择副本'); return; }
      try {
        const r = await api.dungeonBattleStart(dungeonId, '', 'normal', {
          challenge_mode: 'trial_contract',
          contract_modifiers: trialContractState.selectedIds
        });
        if (!r.ok) { showToast(r.error); return; }
        trialContractState.battleId = r.battle_id;
        trialContractState.log = ['危机试炼开始！'];
        trialContractState.result = null;
        trialContractState.score = Number(r.contract_score || 0);
        trialContractState.rewardMult = Math.max(1, Number(r.trial_coins || 1));
        if (Number(r.contract_reward_mult) > 0) {
          const did = String(Math.floor(Number(trialContractState.dungeonId) || 0));
          if (did !== '0') trialContractState.dungeonMultipliers[did] = Math.max(1, Number(r.contract_reward_mult));
        }
        showToast('危机试炼开始');
      } catch (e) { showToast(e.message); }
    }
    const MAX_TRIAL_LOG_LINES = 240;
    function appendTrialLog(target, text) {
      if (!target || !Array.isArray(target.log) || !text) return;
      target.log.push(String(text));
      if (target.log.length > MAX_TRIAL_LOG_LINES) {
        target.log.splice(0, target.log.length - MAX_TRIAL_LOG_LINES);
      }
    }
    async function advanceTrialContract() {
      if (!trialContractState.battleId) return;
      try {
        const r = await api.dungeonBattleAdvance(trialContractState.battleId);
        if (!r.ok) { if (!r.error?.includes('过于频繁')) showToast(r.error); return; }
        if (r.events) r.events.forEach(e => { if (e.text || e.description) appendTrialLog(trialContractState, e.text || e.description); });
        if (r.finished || r.ended) {
          trialContractState.result = r.draw ? 'draw' : (r.victory ? 'victory' : 'defeat');
          trialContractState.battleId = null;
          trialContractState.running = false;
          if (r.player) applyPlayer(r.player);
          if (r.rewards) {
            trialContractState.score = Number(r.rewards.contract_score || trialContractState.score || 0);
            trialContractState.rewardMult = Math.max(1, Number(r.rewards.trial_coins || trialContractState.rewardMult || 1));
            if (Number(r.rewards.trial_coins || 0) > 0) {
              appendTrialLog(trialContractState, `获得试炼币 +${Number(r.rewards.trial_coins || 0)}`);
            } else if (r.victory && r.rewards.reward_available_today === false) {
              appendTrialLog(trialContractState, '本次未超过今日最高收益，试炼币不变（可提高危机值/更换副本后继续补差）');
            }
          }
          showToast(r.draw ? '危机试炼平局' : (r.victory ? '危机试炼胜利！' : '危机试炼失败'));
        }
      } catch (e) { showToast(e.message); }
    }
    async function autoTrialContract() {
      if (trialContractState.running) return;
      trialContractState.running = true;
      try {
        while (trialContractState.battleId && trialContractState.running) {
          await advanceTrialContract();
          await new Promise(r => setTimeout(r, 900));
        }
      } finally {
        trialContractState.running = false;
      }
    }
    async function startTrial() {
      try {
        const r = await api.trialStart();
        if (!r.ok) { showToast(r.error); return; }
        trialState.battleId = r.battle_id; trialState.log = ['试炼开始！']; trialState.result = null; trialState.floor = r.floor || 1;
        showToast('试炼开始');
      } catch (e) { showToast(e.message); }
    }
    async function advanceTrial() {
      if (!trialState.battleId) return;
      try {
        const r = await api.trialAdvance(trialState.battleId);
        if (!r.ok) { if (!r.error?.includes('过于频繁')) showToast(r.error); return; }
        if (r.events) r.events.forEach(e => { if (e.text || e.description) appendTrialLog(trialState, e.text || e.description); });
        if (r.floor) trialState.floor = r.floor;
        if (r.finished || r.ended) {
          trialState.result = r.victory ? 'victory' : 'defeat';
          if (r.player) applyPlayer(r.player);
          trialState.battleId = null;
          showToast(r.victory ? '试炼通过！' : `试炼结束，到达第${trialState.floor}层`);
        }
      } catch (e) { showToast(e.message); }
    }
    async function autoTrial() {
      if (trialState.running) return;
      trialState.running = true;
      try {
        while (trialState.battleId && trialState.running) {
          await advanceTrial();
          await new Promise(r => setTimeout(r, 900));
        }
      } finally {
        trialState.running = false;
      }
    }

    const craftSearchKeyword = ref('');
    const talismanSearchKeyword = ref('');
    const craftFilteredRecipes = computed(() => {
      const rec = (gameData.craft_recipes || []).filter(r => {
        const cat = String(r.category || '');
        return cat !== 'talisman' && cat !== 'array_plate' && cat !== 'array_rune';
      });
      const q = (craftSearchKeyword.value || '').trim().toLowerCase();
      if (!q) return rec;
      return rec.filter(r => {
        const name = String(r.display_name || r.name || '').toLowerCase();
        const res = getItem(r.result?.id);
        const resName = (res?.name || '').toLowerCase();
        return name.includes(q) || resName.includes(q);
      });
    });
    const talismanRecipes = computed(() => {
      const rec = (gameData.craft_recipes || []).filter(r => String(r.category || '') === 'talisman');
      const q = (talismanSearchKeyword.value || '').trim().toLowerCase();
      if (!q) return rec;
      return rec.filter(r => {
        const name = String(r.display_name || r.name || '').toLowerCase();
        const res = getItem(r.result?.id);
        const resName = (res?.name || '').toLowerCase();
        return name.includes(q) || resName.includes(q);
      });
    });
    const alchemyVisibleRecipes = computed(() => {
      const all = Array.isArray(gameData.alchemy_recipes) ? gameData.alchemy_recipes : [];
      const unlocked = new Set(
        (Array.isArray(player.alchemy?.unlocked_recipes) ? player.alchemy.unlocked_recipes : [])
          .map(v => Math.trunc(Number(v) || 0))
          .filter(v => v > 0)
      );
      return all.filter(r => {
        if (!r || typeof r !== 'object') return false;
        if (!r.requires_unlock) return true;
        const rid = Math.trunc(Number(r.id) || 0);
        return rid > 0 && unlocked.has(rid);
      });
    });

    const EX_WEAPONS = [
      { name:'伏羲琴', type:'音律', material:'草木', element:'混元', effects:'绝唱状态额外持续1轮；法术暴击伤害+12%' },
      { name:'万古愁', type:'音律', material:'玉质', element:'无', effects:'音律法术每次造成伤害时，随机附加一种负面效果（迟缓/绝脉/恐惧/缠缚/灼魂/寄生），多段伤害每段各触发' },
      { name:'镇魂牙', type:'拳爪', material:'金属', element:'木', effects:'特效：木属性亲和+25' },
      { name:'危月煞', type:'长兵', material:'金属', element:'土', effects:'防御减伤除数降低1000；自身物理防御+10%，法术防御+10%' },
      { name:'万法皆空', type:'剑', material:'玉质', element:'混元', effects:'造成伤害后25%概率清除目标正面状态，每清除一种造成最高攻击力35%的绝对伤害' },
      { name:'罪业一炬', type:'刀', material:'金属', element:'火', effects:'造成物理伤害时额外施加穿心1轮（防御-40%）；若目标已有穿心，改为造成物攻20%×剩余轮数的直接伤害' },
      { name:'荒', type:'弓', material:'草木', element:'火', effects:'蓄力期间可行动，此时造成伤害降低50%；非蓄力技能+12%法术穿透' },
      { name:'春秋', type:'节杖', material:'金属', element:'水', effects:'造成伤害后回复伤害量12%的生命；每次造成伤害时额外造成自身最大生命值3%的附加伤害' },
      { name:'蛮', type:'弓', material:'金属', element:'金', effects:'蓄力技能可立即释放；蓄力期间造成伤害降低50%；蓄力技击杀目标后重置该技能冷却' },
      { name:'神鬼踏歌', type:'音律', material:'金属', element:'无', effects:'法术直伤对其余敌人造成25%-35%溅射；若无可溅射目标，本次法术最终伤害+13%' },
      { name:'十方天华', type:'剑', material:'草木', element:'混元', effects:'造成的所有伤害均为自适应伤害（按目标较低防御自动判定为物理或法术伤害）' },
      { name:'天涯路', type:'刀', material:'草木', element:'金', effects:'物理暴击率+10%，且多击技能不再衰减' },
      { name:'恨别离', type:'拳爪', material:'草木', element:'木', effects:'使用绽放引爆DOT后，按引爆DOT种类数触发离恨回响：每种造成[(物攻上限+法攻)/2]×8%直接伤害；PVP为65%系数；团战对其余敌方额外造成40%余响' },
      { name:'苍生笔', type:'节杖', material:'玉质', element:'木', effects:'仅非PVP生效：带伤害的治疗技能放弃治疗，改为追加已损生命18%诛邪伤害；13%血线以下直接斩灭' },
      { name:'飞光', type:'长兵', material:'土石', element:'土', effects:'反击伤害提高25%；PVP模式下反击伤害提高15%' },
    ];
    const EX_SETS = [
      { name:'劫灭-斗战乾坤', material:'金属', element:'金', effects:['3件: 物理暴击率+15%','5件: 决意 — 每行动3次获得1层决意，受到控制效果时消耗决意层数抵消等量轮次','8件: 仅物理暴击时获得1轮蓄锐（治疗不再触发；回合末递减机制下实战覆盖两轮）'] },
      { name:'道妙-气象万千', material:'草木', element:'无', effects:['3件: 每次造成伤害后随机获得一种气象（共7种）','5件: 每层气象使对应元素属性亲和+7','8件: 气象集满5层获得道妙（全属性亲和+7，含混元/无，总计+49）'] },
      { name:'浩渺-云上青鸾', material:'草木', element:'木', effects:['3件: 每轮回复5%最大生命值；一次战斗中免疫一次致命伤害（保留1点血）','5件: 3件效果的回复等额转化为对敌方的绝对伤害','8件: 己方施加的持续伤害（DoT）持续轮次+1'] },
      { name:'厉火-焚天炽地', material:'皮质', element:'火', effects:['3件: 造成伤害后获得1轮灼烧（回合结束受到自身随机属性25%~55%的绝对伤害）','5件: 灼烧状态下造成伤害时吸血15%（恢复造成伤害的15%为生命）','8件: 生命低于50%时获得焚烬（同时拥有乘风+养精+蓄锐效果）'] },
      { name:'玄黄-永生不灭', material:'金属', element:'土', effects:['3件: 受到直接伤害时50%概率获得3轮土盾（减伤22%）','5件: 受击反弹伤害（无土盾反弹10%，有土盾反弹30%）','8件: 战斗开始双方均获得迟缓（速度降至70%），持续整场战斗'] },
      { name:'异界-终结热寂', material:'皮质', element:'水', effects:['3件: 每次行动结束后对敌方叠1层降温','5件: 改为每次造成伤害时叠降温（多段伤害每段各叠1层）','8件: 仅8件可将5层降温转为凝滞并叠1层冻伤；冻伤叠满4层时野外非Boss直接终结'] },
      { name:'太初-浑天无极', material:'玉质', element:'混元', effects:['3件: 每次行动结束后，清除自身1种负面状态（被凝滞跳过不视为行动）','5件: 对带有负面状态的目标造成伤害时，每种负面使最终伤害提高6%','8件: 受击时将最终伤害的20%转为业力并不再扣血；当业力超过当前生命时立即死亡'] },
    ];

    function findItemInInventory(itemId) {
      const id = Number(itemId) || 0;
      if (id <= 0) return null;
      const slotKey = _inventoryFirstSlotByItemId.get(id);
      if (!slotKey) return null;
      const [pageStr, slotStr] = String(slotKey).split('_');
      const page = Number(pageStr);
      const slot = Number(slotStr);
      if (!Number.isInteger(page) || !Number.isInteger(slot) || page < 0 || slot < 0) return null;
      const slotData = player.inventory?.[page]?.[slot];
      if (!slotData?.item || Number(slotData.item.id) !== id) return null;
      return { page, slot, item: slotData.item, count: slotData.count || 1 };
    }
    function countItemInInv(itemId) {
      const id = Number(itemId) || 0;
      if (id <= 0) return 0;
      return Number(inventoryItemCountMap.value[id] || 0);
    }
    const invPicker = reactive({ open:false, mode:'', title:'', candidates:[], onSelect:null, picked:null, pickCount:1 });
    function openInvPicker(mode, filter, title, onSelect) {
      invPicker.picked = null; invPicker.pickCount = 1;
      const filterKey = String(filter || '');
      const source = _inventoryCandidatesByFilter[filterKey] || _inventoryCandidatesByFilter.all;
      const cand = source.slice();
      invPicker.open = true;
      invPicker.mode = mode;
      invPicker.title = title || '选择物品';
      invPicker.candidates = cand;
      invPicker.onSelect = onSelect || null;
    }
    function selectInvPicker(c) {
      if ((c.count || 1) > 1 && invPicker.mode !== 'eq_fulfill' && !['weapon','head','shoulder','chest','legs','hands','ring','amulet','back'].includes(c.item?.type)) {
        invPicker.picked = c;
        invPicker.pickCount = c.count || 1;
        return;
      }
      if (invPicker.onSelect) invPicker.onSelect(c);
      invPicker.open = false;
    }
    function confirmInvPicker() {
      if (!invPicker.picked) return;
      const c = { ...invPicker.picked, count: Math.max(1, Math.min(invPicker.pickCount, invPicker.picked.count || 1)) };
      if (invPicker.onSelect) invPicker.onSelect(c);
      invPicker.open = false;
      invPicker.picked = null;
    }
    function backInvPicker() { invPicker.picked = null; invPicker.pickCount = 1; }
    function closeInvPicker() { invPicker.open = false; invPicker.picked = null; }

    const forgeSelected = reactive({ main:null, ling:null, catalyst:null });
    const upgradeSelected = reactive({ target:null, material:null });
    const affixUpgradeSelected = reactive({ target:null, material:null });
    const rerollSelected = reactive({ target:null, ling:null });
    const rerollTierSelected = reactive({ material:null });
    const inheritSelected = reactive({ source:null, target:null, material:null });
    const zaohuaSelected = reactive({ target:null });
    const rerollLocked = ref([]);
    const listingSelected = reactive({ page:-1, slot:-1, itemId:0 });

    function pickForgeMain() { openInvPicker('main','material','选择主材', function(c){ forgeSelected.main=c; forgingMainId.value=c.item.id; forgingMainCount.value=c.count; }); }
    function pickForgeLing() { openInvPicker('ling','ling','选择引灵', function(c){ forgeSelected.ling=c; forgingLingId.value=c.item.id; }); }
    function pickForgeCat() { openInvPicker('cat','catalyst','选择催化剂', function(c){ forgeSelected.catalyst=c; forgingCatalystId.value=c.item.id; }); }
    function pickUpgradeTarget() { openInvPicker('up_target','equipment','选择装备', function(c){ upgradeSelected.target=c; upgradeForm.page=c.page; upgradeForm.slot=c.slot; }); }
    function pickUpgradeMat() { openInvPicker('up_mat','material','选择材料', function(c){ upgradeSelected.material=c; upgradeForm.matId=c.item.id; upgradeForm.matCount=c.count; }); }
    function pickInheritSource() {
      openInvPicker('inherit_source','equipment','选择主装备（词缀转出）', function(c) {
        inheritSelected.source = c;
        inheritForm.sourcePage = c.page;
        inheritForm.sourceSlot = c.slot;
      });
    }
    function pickInheritTarget() {
      openInvPicker('inherit_target','equipment','选择被继承装备（词缀覆盖）', function(c) {
        inheritSelected.target = c;
        inheritForm.targetPage = c.page;
        inheritForm.targetSlot = c.slot;
      });
    }
    function pickInheritMaterial() {
      openInvPicker('inherit_material','material','选择继承材料', function(c) {
        inheritSelected.material = c;
        inheritForm.materialId = c.item.id;
      });
    }
    function pickAffixUpgradeTarget() {
      openInvPicker('up_affix_target','equipment','选择装备', function(c) {
        affixUpgradeSelected.target = c;
        affixUpgradeForm.page = c.page;
        affixUpgradeForm.slot = c.slot;
        const affixes = Array.isArray(c.item?.affixes) ? c.item.affixes : [];
        affixUpgradeForm.affixIndex = affixes.length > 0 ? 0 : -1;
      });
    }
    function pickAffixUpgradeMat() {
      openInvPicker('up_affix_mat','material','选择材料', function(c) {
        affixUpgradeSelected.material = c;
        affixUpgradeForm.matId = c.item.id;
        affixUpgradeForm.matCount = c.count;
      });
    }
    function selectAffixUpgradeIndex(idx) {
      const i = Number(idx);
      affixUpgradeForm.affixIndex = Number.isFinite(i) ? Math.trunc(i) : -1;
    }
    function pickRerollTarget() {
      openInvPicker('rr_target','equipment','选择装备', function(c){
        rerollSelected.target = c; rerollForm.page = c.page; rerollForm.slot = c.slot;
        rerollTierForm.page = c.page;
        rerollTierForm.slot = c.slot;
        const affixes = Array.isArray(c.item?.affixes) ? c.item.affixes : [];
        rerollTierForm.affixIndex = affixes.length > 0 ? 0 : -1;
        rerollLocked.value = [];
      });
    }
    function pickRerollLing() { openInvPicker('rr_ling','ling','选择引灵', function(c){ rerollSelected.ling=c; rerollForm.lingId=c.item.id; }); }
    function pickZaohuaTarget() {
      openInvPicker('zaohua_target','equipment','选择要造化的装备', function(c) {
        zaohuaSelected.target = c;
        zaohuaForm.page = c.page;
        zaohuaForm.slot = c.slot;
      });
    }
    function pickRerollTierMaterial() {
      openInvPicker('rr_tier_mat','material','选择区间洗练材料', function(c){
        rerollTierSelected.material = c;
        rerollTierForm.matId = c.item.id;
      });
    }
    function selectRerollTierAffix(idx) {
      const i = Number(idx);
      rerollTierForm.affixIndex = Number.isFinite(i) ? Math.trunc(i) : -1;
    }
    function toggleRerollLock(idx) {
      const arr = rerollLocked.value;
      const pos = arr.indexOf(idx);
      if (pos >= 0) arr.splice(pos, 1);
      else arr.push(idx);
    }
    function getTierRerollT8Chance(materialQuality) {
      const q = Math.max(1, Math.min(8, Number(materialQuality) || 1));
      if (q <= 3) return 0;
      if (q === 4) return 0.02;
      if (q === 5) return 0.06;
      if (q === 6) return 0.10;
      if (q === 7) return 0.15;
      return 0.20;
    }
    function getTierRerollBaseWeights(materialQuality) {
      const q = Math.max(1, Math.min(8, Number(materialQuality) || 1));
      if (q === 1) return [34, 26, 18, 12, 6, 3, 1];
      if (q === 2) return [26, 23, 20, 14, 9, 6, 2];
      if (q === 3) return [20, 20, 20, 16, 12, 8, 4];
      if (q === 4) return [14, 16, 18, 18, 15, 11, 8];
      if (q === 5) return [11, 13, 16, 18, 17, 14, 11];
      if (q === 6) return [9, 11, 14, 17, 18, 16, 15];
      if (q === 7) return [7, 9, 12, 15, 18, 19, 20];
      return [6, 8, 11, 14, 17, 19, 21];
    }
    function getTierRerollDistributionByMaterialQuality(materialQuality) {
      const q = Math.max(1, Math.min(8, Number(materialQuality) || 1));
      const base = getTierRerollBaseWeights(q);
      const t8Chance = getTierRerollT8Chance(q);
      const remain = Math.max(0, 1 - t8Chance);
      let total = 0;
      for (const w of base) total += Math.max(0, Number(w) || 0);
      if (total <= 0) total = 1;
      const out = [];
      for (let i = 0; i < 7; i += 1) {
        const p = remain * ((Math.max(0, Number(base[i]) || 0)) / total);
        out.push({ tier: i + 1, chance: p });
      }
      out.push({ tier: 8, chance: t8Chance });
      return out;
    }
    const rerollCost = computed(() => {
      if (!rerollSelected.target) return 1;
      const affixes = rerollSelected.target.item?.affixes || [];
      let extra = 0;
      for (const idx of rerollLocked.value) {
        if (idx >= 0 && idx < affixes.length && affixes[idx]) {
          extra += Math.max(1, affixes[idx].quality || affixes[idx].tier || 1);
        }
      }
      return 1 + extra;
    });
    const rerollTierAffixes = computed(() => {
      if (!rerollSelected.target) return [];
      const arr = rerollSelected.target.item?.affixes;
      return Array.isArray(arr) ? arr : [];
    });
    const selectedRerollTierAffix = computed(() => {
      const list = rerollTierAffixes.value;
      const idx = Math.trunc(Number(rerollTierForm.affixIndex));
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return null;
      return list[idx] || null;
    });
    const rerollTierMaterialQuality = computed(() => {
      if (!rerollTierSelected.material) return 0;
      const matSlot = rerollTierSelected.material.item;
      const tpl = getItem(matSlot?.id);
      return Math.max(1, Math.min(8, Number(tpl?.quality || matSlot?.quality || 1)));
    });
    const rerollTierDistribution = computed(() => {
      if (!rerollTierSelected.material) return [];
      return getTierRerollDistributionByMaterialQuality(rerollTierMaterialQuality.value);
    });
    const rerollTierEstimate = computed(() => {
      if (!rerollSelected.target) return { error: '请选择目标装备', distribution: [] };
      if (rerollTierAffixes.value.length <= 0) return { error: '该装备没有可洗练词缀', distribution: [] };
      if (!selectedRerollTierAffix.value) return { error: '请选择要区间洗练的词缀', distribution: [] };
      if (!rerollTierSelected.material) return { error: '请选择洗练材料', distribution: [] };
      const matId = Number(rerollTierForm.matId || 0);
      const have = countItemInInv(matId);
      if (have < 3) return { error: `洗练材料不足（需要 3，当前 ${have}）`, distribution: rerollTierDistribution.value };
      return { error: '', distribution: rerollTierDistribution.value };
    });
    function affixFingerprint(a) {
      if (!a) return '';
      return String(a.stat || '') + '|' + Number(a.value || 0);
    }
    const rerolling = ref(false);
    const rerollTierRolling = ref(false);
    const inheriting = ref(false);
    const zaohuaing = ref(false);
    function isZaohuaLocked(item) {
      if (!item || typeof item !== 'object') return false;
      return !!(item.zaohua_locked || item.zaohua_state || item.zaohua_at);
    }
    async function doReroll() {
      if (rerolling.value) return;
      if (!rerollSelected.target || !rerollSelected.ling) return;
      if (isZaohuaLocked(rerollSelected.target.item)) { showToast('该装备已造化，无法继续精锻'); return; }
      rerolling.value = true;
      try {
        const lockArr = rerollLocked.value.slice();
        const oldAffixes = rerollSelected.target?.item?.affixes || [];
        const lockedFingerprints = lockArr
          .filter(i => i >= 0 && i < oldAffixes.length && oldAffixes[i])
          .map(i => affixFingerprint(oldAffixes[i]));
        let r;
        const expectEquipItemId = Number(rerollSelected.target?.item?.id || 0);
        try { r = await api.forgingReroll(rerollForm.page, rerollForm.slot, rerollForm.lingId, lockArr, expectEquipItemId); } catch(e) { showToast(e.message); return; }
        if (r && r.ok) {
          showToast('精锻完成');
          if (r.player) applyPlayer(r.player);
          const inv = player.inventory || [];
          const pg = inv[rerollForm.page];
          if (pg && pg[rerollForm.slot]?.item) {
            rerollSelected.target = { page: rerollForm.page, slot: rerollForm.slot, item: pg[rerollForm.slot].item, count: pg[rerollForm.slot].count || 1 };
            const newAffixes = pg[rerollForm.slot].item.affixes || [];
            if (newAffixes.length <= 0) rerollTierForm.affixIndex = -1;
            else if (rerollTierForm.affixIndex < 0 || rerollTierForm.affixIndex >= newAffixes.length) rerollTierForm.affixIndex = 0;
            const newLocked = [];
            const used = new Set();
            for (const fp of lockedFingerprints) {
              for (let i = 0; i < newAffixes.length; i++) {
                if (used.has(i)) continue;
                if (affixFingerprint(newAffixes[i]) === fp) {
                  newLocked.push(i);
                  used.add(i);
                  break;
                }
              }
            }
            rerollLocked.value = newLocked;
          }
          const lingSlot = findItemInInventory(rerollForm.lingId);
          if (lingSlot) {
            rerollSelected.ling = { page: lingSlot.page, slot: lingSlot.slot, item: lingSlot.item, count: lingSlot.count };
          } else {
            rerollSelected.ling = null;
          }
        } else {
          if (r?.code === 'SLOT_MISMATCH') doSync();
          showToast(r?.error || '精锻失败');
        }
      } finally {
        rerolling.value = false;
      }
    }
    async function doRerollAffixTier() {
      if (rerollTierRolling.value) return;
      if (!rerollSelected.target) { showToast('请选择目标装备'); return; }
      if (isZaohuaLocked(rerollSelected.target.item)) { showToast('该装备已造化，无法继续精锻'); return; }
      const affixes = rerollTierAffixes.value;
      if (affixes.length <= 0) { showToast('该装备没有可精锻词缀'); return; }
      const idx = Number(rerollTierForm.affixIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= affixes.length) { showToast('请选择要区间精锻的词缀'); return; }
      if (!rerollTierSelected.material) { showToast('请选择精锻材料'); return; }
      const materialCount = countItemInInv(rerollTierForm.matId);
      if (materialCount < 3) { showToast(`精锻材料不足（需要 3，当前 ${materialCount}）`); return; }

      rerollTierRolling.value = true;
      try {
        const r = await alch.rerollAffixTier(
          rerollTierForm.page,
          rerollTierForm.slot,
          Math.trunc(idx),
          rerollTierForm.matId,
          Number(rerollSelected.target?.item?.id || 0)
        );
        if (!r || !r.ok) return;

        const inv = player.inventory || [];
        const pageArr = inv[rerollTierForm.page];
        if (Array.isArray(pageArr) && pageArr[rerollTierForm.slot]?.item) {
          const slotData = pageArr[rerollTierForm.slot];
          rerollSelected.target = {
            page: rerollTierForm.page,
            slot: rerollTierForm.slot,
            item: slotData.item,
            count: slotData.count || 1
          };
          const newAffixes = Array.isArray(slotData.item.affixes) ? slotData.item.affixes : [];
          if (newAffixes.length <= 0) rerollTierForm.affixIndex = -1;
          else if (rerollTierForm.affixIndex >= newAffixes.length) rerollTierForm.affixIndex = newAffixes.length - 1;
        } else {
          rerollSelected.target = null;
          rerollTierForm.affixIndex = -1;
        }

        const matSlot = findItemInInventory(rerollTierForm.matId);
        if (matSlot) {
          rerollTierSelected.material = {
            page: matSlot.page,
            slot: matSlot.slot,
            item: matSlot.item,
            count: matSlot.count || 1
          };
        } else {
          rerollTierSelected.material = null;
        }
      } finally {
        rerollTierRolling.value = false;
      }
    }
    async function doInherit() {
      if (inheriting.value) return;
      if (!inheritSelected.source || !inheritSelected.target) { showToast('请选择主装备和被继承装备'); return; }
      if (!inheritSelected.material) { showToast('请选择继承材料'); return; }

      const estimate = inheritEstimate.value;
      if (estimate.error) { showToast(estimate.error); return; }

      inheriting.value = true;
      try {
        const r = await alch.inheritEquip(
          inheritForm.sourcePage,
          inheritForm.sourceSlot,
          inheritForm.targetPage,
          inheritForm.targetSlot,
          inheritForm.materialId,
          Number(inheritSelected.source?.item?.id || 0),
          Number(inheritSelected.target?.item?.id || 0)
        );
        if (!r || !r.ok) return;

        const inv = player.inventory || [];
        const sourcePageArr = inv[inheritForm.sourcePage];
        const targetPageArr = inv[inheritForm.targetPage];
        if (Array.isArray(sourcePageArr) && sourcePageArr[inheritForm.sourceSlot]?.item) {
          const slotData = sourcePageArr[inheritForm.sourceSlot];
          inheritSelected.source = {
            page: inheritForm.sourcePage,
            slot: inheritForm.sourceSlot,
            item: slotData.item,
            count: slotData.count || 1
          };
        } else {
          inheritSelected.source = null;
        }
        if (Array.isArray(targetPageArr) && targetPageArr[inheritForm.targetSlot]?.item) {
          const slotData = targetPageArr[inheritForm.targetSlot];
          inheritSelected.target = {
            page: inheritForm.targetPage,
            slot: inheritForm.targetSlot,
            item: slotData.item,
            count: slotData.count || 1
          };
        } else {
          inheritSelected.target = null;
        }

        const materialSlot = findItemInInventory(inheritForm.materialId);
        if (materialSlot) {
          inheritSelected.material = {
            page: materialSlot.page,
            slot: materialSlot.slot,
            item: materialSlot.item,
            count: materialSlot.count || 1
          };
        } else {
          inheritSelected.material = null;
        }
      } finally {
        inheriting.value = false;
      }
    }
    async function doZaohua() {
      if (zaohuaing.value) return;
      if (!zaohuaSelected.target) { showToast('请选择目标装备'); return; }
      if (isZaohuaLocked(zaohuaSelected.target.item)) { showToast('该装备已造化，无法再次改造'); return; }
      if (!alch || typeof alch.zaohuaEquip !== 'function') {
        showToast('造化功能加载异常，请刷新页面后重试');
        return;
      }

      zaohuaing.value = true;
      try {
        const r = await alch.zaohuaEquip(
          zaohuaForm.page,
          zaohuaForm.slot,
          Number(zaohuaSelected.target?.item?.id || 0)
        );
        if (!r || !r.ok) return;

        const inv = player.inventory || [];
        const pageArr = inv[zaohuaForm.page];
        if (Array.isArray(pageArr) && pageArr[zaohuaForm.slot]?.item) {
          const slotData = pageArr[zaohuaForm.slot];
          zaohuaSelected.target = {
            page: zaohuaForm.page,
            slot: zaohuaForm.slot,
            item: slotData.item,
            count: slotData.count || 1
          };
        } else {
          zaohuaSelected.target = null;
        }
      } finally {
        zaohuaing.value = false;
      }
    }
    async function doAffixUpgrade() {
      if (!affixUpgradeSelected.target) { showToast('请选择目标装备'); return; }
      if (!affixUpgradeSelected.material) { showToast('请选择词缀材料'); return; }
      const affixes = Array.isArray(affixUpgradeSelected.target.item?.affixes) ? affixUpgradeSelected.target.item.affixes : [];
      if (affixes.length <= 0) { showToast('该装备没有词缀'); return; }
      const idx = Number(affixUpgradeForm.affixIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= affixes.length) { showToast('请选择要升品的词缀'); return; }
      const r = await alch.upgradeAffix(
        affixUpgradeForm.page,
        affixUpgradeForm.slot,
        Math.trunc(idx),
        affixUpgradeForm.matId,
        affixUpgradeForm.matCount,
        affixUpgradeForm.mode,
        affixUpgradeForm.affixMode,
        Number(affixUpgradeSelected.target?.item?.id || 0)
      );
      if (!r || !r.ok) return;

      const inv = player.inventory || [];
      const pageArr = inv[affixUpgradeForm.page];
      if (Array.isArray(pageArr) && pageArr[affixUpgradeForm.slot]?.item) {
        const slotData = pageArr[affixUpgradeForm.slot];
        affixUpgradeSelected.target = {
          page: affixUpgradeForm.page,
          slot: affixUpgradeForm.slot,
          item: slotData.item,
          count: slotData.count || 1
        };
        const newAffixes = Array.isArray(slotData.item.affixes) ? slotData.item.affixes : [];
        if (newAffixes.length <= 0) affixUpgradeForm.affixIndex = -1;
        else if (affixUpgradeForm.affixIndex >= newAffixes.length) affixUpgradeForm.affixIndex = newAffixes.length - 1;
      } else {
        affixUpgradeSelected.target = null;
        affixUpgradeForm.affixIndex = -1;
      }

      const matSlot = findItemInInventory(affixUpgradeForm.matId);
      if (matSlot) {
        affixUpgradeSelected.material = {
          page: matSlot.page,
          slot: matSlot.slot,
          item: matSlot.item,
          count: matSlot.count
        };
      } else {
        affixUpgradeSelected.material = null;
      }
    }
    function pickSectContrib() { openInvPicker('sect_contrib','material','选择捐献物品获得贡献', function(c){ sect.contribute(c.item.id, c.count||1); }); }
    function pickAlliDonate(allianceId) { openInvPicker('alli_donate','material','选择捐献物资', function(c){ alli.donate(allianceId, c.page, c.slot, c.count||1, Number(c?.item?.id) || 0); }); }
    function pickWhDeposit(allianceId) { openInvPicker('wh_dep','all','选择存入物品', function(c){ alli.depositWarehouse(allianceId, c.page, c.slot, c.count||1, Number(c?.item?.id) || 0); }); }
    function pickWhDeposit2(allianceId) { openInvPicker('wh_dep2','all','选择存入物品', function(c){ alli.depositWarehouse(allianceId, c.page, c.slot, c.count||1, Number(c?.item?.id) || 0); }); }
    function pickEqFulfill() { openInvPicker('eq_fulfill','equipment','选择装备供货', function(c){ exch.fulfillEquip(exch.equipFulfillId.value, c.page, c.slot, Number(c?.item?.id) || 0); exch.closeEquipFulfill(); }); }
    function pickListing() { openInvPicker('listing','all','选择上架物品', function(c){ listingSelected.page=c.page; listingSelected.slot=c.slot; listingSelected.itemId=Number(c?.item?.id)||0; listingForm.page=c.page; listingForm.slot=c.slot; listingForm.qty=c.count||1; }); }
    function pickBuyBarterPay() {
      openInvPicker('buy_barter_pay','non_equip','选择以物易物支付物品', function(c) {
        listingForm.barterPayItemId = Number(c?.item?.id) || 0;
        listingForm.barterPayItemName = String(c?.item?.name || '');
        if ((Number(listingForm.barterPayUnitCount) || 0) <= 0) listingForm.barterPayUnitCount = 1;
      });
    }

    // city shop
    const cityShopItems = computed(() => {
      if (!gameData.loaded) return [];
      return gameData.items.filter(it => ['herb','material','medicine'].includes(it.type) && (it.quality || 1) <= 4 && !it.no_market);
    });

    // pending job timer
    const jobTimeLeft = ref('');
    let jobTimerInterval = null;
    function updateJobTimer() {
      const job = player.baiyi?.pending_job;
      if (!job || !job.finish_at) { jobTimeLeft.value = ''; return; }
      if ((job.sub_type || '').startsWith('cave_')) { jobTimeLeft.value = ''; return; }
      const left = job.finish_at - Math.floor(Date.now() / 1000);
      if (left <= 0) { jobTimeLeft.value = '已完成，请同步'; return; }
      const m = Math.floor(left / 60), s = left % 60;
      jobTimeLeft.value = `${m}分${s}秒`;
    }
    onMounted(() => { jobTimerInterval = setInterval(updateJobTimer, 1000); });
    onUnmounted(() => { if (jobTimerInterval) clearInterval(jobTimerInterval); });

    // baiyi sub-tab
    const baiyiTab = ref('alchemy');
    const forgeSubTab = ref('make');
    const upgradeForm = reactive({ page:0, slot:0, matId:0, matCount:20, mode:'current' });
    const affixUpgradeForm = reactive({ page:0, slot:0, affixIndex:-1, matId:0, matCount:20, mode:'current', affixMode:'upgrade' });
    const rerollForm = reactive({ page:0, slot:0, lingId:0, lockStr:'' });
    const rerollTierForm = reactive({ page:0, slot:0, affixIndex:-1, matId:0 });
    const inheritForm = reactive({ sourcePage:0, sourceSlot:0, targetPage:0, targetSlot:0, materialId:0 });
    const zaohuaForm = reactive({ page:0, slot:0 });
    const forgingType = ref('剑');
    const forgingMainId = ref(0);
    const forgingMainCount = ref(1);
    const forgingLingId = ref(0);
    const forgingCatalystId = ref(0);

    // sect-related computed
    const _techniqueUnlockedSkillIds = computed(() => {
      const ids = new Set();
      for (const t of (gameData.techniques || [])) {
        for (const u of (t.skillUnlocks || [])) if (u.skillId) ids.add(u.skillId);
      }
      return ids;
    });
    const sectSkills = computed(() => {
      if (!player.sect_id || !gameData.loaded) return [];
      const techUnlocked = _techniqueUnlockedSkillIds.value;
      return gameData.skills.filter(s => s.sectId === player.sect_id && !techUnlocked.has(s.id));
    });
    const sectTechniques = computed(() => {
      if (!player.sect_id || !gameData.loaded) return [];
      return gameData.techniques.filter(t => t.sectId === player.sect_id);
    });

    // exchange listing form
    const listingForm = reactive({
      page: 0,
      slot: 0,
      qty: 1,
      price: 100,
      buyItemId: 0,
      buyItemName: '',
      buyQty: 1,
      buyPrice: 100,
      buyUseBarter: false,
      barterPayItemId: 0,
      barterPayItemName: '',
      barterPayUnitCount: 1
    });
    async function doCreateListing() {
      if (listingSelected.page < 0) return;
      const ok = await exch.create(listingForm.page, listingForm.slot, listingForm.qty, listingForm.price, Number(listingSelected.itemId) || 0);
      if (ok) { listingSelected.page = -1; listingSelected.slot = -1; listingSelected.itemId = 0; listingForm.qty = 1; listingForm.price = 100; }
    }
    let _sellQuoteTimer = null;
    let _buyQuoteTimer = null;
    let _equipQuoteTimer = null;

    function scheduleSellQuote() {
      if (typeof exch.quoteSell !== 'function') return;
      if (_sellQuoteTimer) clearTimeout(_sellQuoteTimer);
      _sellQuoteTimer = setTimeout(() => {
        if (activeTab.value !== 'exchange' || exch.exSide.value !== 'my') {
          exch.quoteSell(-1, -1, 1, 0);
          return;
        }
        if (listingSelected.page < 0) {
          exch.quoteSell(-1, -1, 1, 0);
          return;
        }
        exch.quoteSell(listingForm.page, listingForm.slot, listingForm.qty, listingForm.price);
      }, 220);
    }

    function scheduleBuyQuote() {
      if (typeof exch.quoteBuy !== 'function') return;
      if (_buyQuoteTimer) clearTimeout(_buyQuoteTimer);
      _buyQuoteTimer = setTimeout(() => {
        if (activeTab.value !== 'exchange' || exch.exSide.value !== 'my') {
          exch.quoteBuy(0, '', 1, 0, {});
          return;
        }
        exch.quoteBuy(
          listingForm.buyItemId,
          listingForm.buyItemName,
          listingForm.buyQty,
          listingForm.buyPrice,
          {
            barterEnabled: Boolean(listingForm.buyUseBarter),
            barterPayItemId: Number(listingForm.barterPayItemId) || 0,
            barterPayUnitCount: Number(listingForm.barterPayUnitCount) || 0
          }
        );
      }, 220);
    }

    function scheduleEquipBuyQuote() {
      if (typeof exch.quoteEquipBuy !== 'function') return;
      if (_equipQuoteTimer) clearTimeout(_equipQuoteTimer);
      _equipQuoteTimer = setTimeout(() => {
        if (activeTab.value !== 'exchange' || exch.exSide.value !== 'my') {
          exch.quoteEquipBuy({});
          return;
        }
        exch.quoteEquipBuy(exch.equipBuyForm);
      }, 220);
    }

    watch(() => [listingSelected.page, listingForm.page, listingForm.slot, listingForm.qty, listingForm.price], scheduleSellQuote);
    watch(() => [
      listingForm.buyItemId,
      listingForm.buyItemName,
      listingForm.buyQty,
      listingForm.buyPrice,
      listingForm.buyUseBarter,
      listingForm.barterPayItemId,
      listingForm.barterPayUnitCount
    ], scheduleBuyQuote);
    watch(() => [
      exch.equipBuyForm.slot,
      exch.equipBuyForm.subtype,
      exch.equipBuyForm.material,
      exch.equipBuyForm.minQuality,
      exch.equipBuyForm.itemName,
      exch.equipBuyForm.qty,
      exch.equipBuyForm.price
    ], scheduleEquipBuyQuote);
    watch(() => [activeTab.value, exch.exSide.value], () => {
      scheduleSellQuote();
      scheduleBuyQuote();
      scheduleEquipBuyQuote();
    });
    onUnmounted(() => {
      if (_sellQuoteTimer) clearTimeout(_sellQuoteTimer);
      if (_buyQuoteTimer) clearTimeout(_buyQuoteTimer);
      if (_equipQuoteTimer) clearTimeout(_equipQuoteTimer);
    });

    // upgrade estimate
    const upgradeEstimate = computed(() => {
      if (!upgradeSelected.target || !upgradeSelected.material) return { chance: 0, error: '' };
      const eq = upgradeSelected.target.item;
      const matSlot = upgradeSelected.material.item;
      const matTpl = getItem(matSlot.id);
      const equipQ = Math.max(1, Math.min(8, eq.quality || 1));
      const matQ = Math.max(1, Math.min(8, (matTpl?.quality || matSlot.quality || 1)));
      const count = Math.max(1, Math.min(100, upgradeForm.matCount || 1));
      if (equipQ >= 8) return { chance: 0, error: '装备已达最高8阶' };
      if (upgradeForm.mode === 'target') {
        if (matQ !== equipQ + 1) return { chance: 0, error: '目标阶模式需要 ' + (equipQ + 1) + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
        return { chance: Math.min(1, count / 20), error: '' };
      }
      if (matQ !== equipQ) return { chance: 0, error: '当前阶模式需要 ' + equipQ + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
      if (count < 20) return { chance: 0, error: '当前阶模式至少需要 20 个材料（现在 ' + count + ' 个）' };
      return { chance: Math.min(1, (count - 20) / 80), error: '' };
    });
    const affixUpgradeAffixes = computed(() => {
      if (!affixUpgradeSelected.target) return [];
      const arr = affixUpgradeSelected.target.item?.affixes;
      return Array.isArray(arr) ? arr : [];
    });
    const selectedAffixForUpgrade = computed(() => {
      const list = affixUpgradeAffixes.value;
      const idx = Math.trunc(Number(affixUpgradeForm.affixIndex));
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return null;
      return list[idx] || null;
    });
    const affixUpgradeEstimate = computed(() => {
      if (!affixUpgradeSelected.target || !affixUpgradeSelected.material) return { chance: 0, error: '' };
      const selectedAffix = selectedAffixForUpgrade.value;
      if (!selectedAffix) return { chance: 0, error: '请选择要处理的词缀' };

      const affixQ = Math.max(1, Math.min(8, Number(selectedAffix.quality || selectedAffix.tier || 1)));
      const isDowngrade = String(affixUpgradeForm.affixMode || '') === 'downgrade';
      if (!isDowngrade && affixQ >= 8) return { chance: 0, error: '该词缀已达最高品质Q8' };
      if (isDowngrade && affixQ <= 1) return { chance: 0, error: '该词缀已达最低品质Q1' };

      const matSlot = affixUpgradeSelected.material.item;
      const matTpl = getItem(matSlot.id);
      const matQ = Math.max(1, Math.min(8, (matTpl?.quality || matSlot.quality || 1)));
      const count = Math.max(1, Math.min(100, affixUpgradeForm.matCount || 1));

      if (isDowngrade) {
        if (affixUpgradeForm.mode === 'target') {
          if (matQ !== affixQ - 1) return { chance: 0, error: '目标阶模式需要 ' + (affixQ - 1) + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
          return { chance: Math.min(1, count / 50), error: '' };
        }
        if (matQ !== affixQ) return { chance: 0, error: '当前阶模式需要 ' + affixQ + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
        return { chance: Math.min(1, count / 10), error: '' };
      }

      if (affixUpgradeForm.mode === 'target') {
        if (matQ !== affixQ + 1) return { chance: 0, error: '目标阶模式需要 ' + (affixQ + 1) + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
        return { chance: Math.min(1, count / 20), error: '' };
      }
      if (matQ !== affixQ) return { chance: 0, error: '当前阶模式需要 ' + affixQ + ' 阶材料，当前选的是 ' + matQ + ' 阶' };
      if (count < 20) return { chance: 0, error: '当前阶模式至少需要 20 个材料（现在 ' + count + ' 个）' };
      return { chance: Math.min(1, (count - 20) / 80), error: '' };
    });
    const inheritCost = computed(() => {
      const affixes = Array.isArray(inheritSelected.source?.item?.affixes) ? inheritSelected.source.item.affixes : [];
      if (affixes.length <= 0) return { affixCount: 0, requiredTier: 0, requiredCount: 0 };
      let maxQ = 1;
      let sumT = 0;
      for (const af of affixes) {
        const q = Math.max(1, Math.min(8, Number(af?.quality || af?.tier || 1)));
        const t = Math.max(1, Math.min(8, Number(af?.tier || af?.quality || 1)));
        maxQ = Math.max(maxQ, q);
        sumT += t;
      }
      return { affixCount: affixes.length, requiredTier: maxQ, requiredCount: Math.max(1, sumT) };
    });
    const inheritEstimate = computed(() => {
      const source = inheritSelected.source;
      const target = inheritSelected.target;
      const material = inheritSelected.material;
      const cost = inheritCost.value;

      if (!source || !target) {
        return { error: '请选择主装备和被继承装备', requiredTier: cost.requiredTier, requiredCount: cost.requiredCount, haveCount: 0, materialTier: 0 };
      }
      if (source.page === target.page && source.slot === target.slot) {
        return { error: '主装备与被继承装备不能是同一件', requiredTier: cost.requiredTier, requiredCount: cost.requiredCount, haveCount: 0, materialTier: 0 };
      }
      if (cost.affixCount <= 0 || cost.requiredTier <= 0 || cost.requiredCount <= 0) {
        return { error: '主装备没有可继承词缀', requiredTier: 0, requiredCount: 0, haveCount: 0, materialTier: 0 };
      }
      if (!material) {
        return { error: '请选择继承材料', requiredTier: cost.requiredTier, requiredCount: cost.requiredCount, haveCount: 0, materialTier: 0 };
      }

      const matTpl = getItem(material.item?.id);
      const materialTier = Math.max(1, Math.min(8, Number(matTpl?.quality || material.item?.quality || 1)));
      const haveCount = countItemInInv(material.item?.id);
      if (materialTier !== cost.requiredTier) {
        return {
          error: '材料阶级不匹配：需要' + cost.requiredTier + '阶材料',
          requiredTier: cost.requiredTier,
          requiredCount: cost.requiredCount,
          haveCount,
          materialTier
        };
      }
      if (haveCount < cost.requiredCount) {
        return {
          error: '材料不足：需要' + cost.requiredCount + '个，当前仅有' + haveCount + '个',
          requiredTier: cost.requiredTier,
          requiredCount: cost.requiredCount,
          haveCount,
          materialTier
        };
      }
      return { error: '', requiredTier: cost.requiredTier, requiredCount: cost.requiredCount, haveCount, materialTier };
    });

    // tab watchers
    watch(activeTab, (t, oldT) => {
      ensureGameDataForTab(t);
      if (t === 'map') api.wsSetBattleDetail(true);
      else if (oldT === 'map') api.wsSetBattleDetail(false);
      if (t === 'mail') loadMails();
      if (t === 'map' && !battleState.active && autoBattle.value) startBattle();
      if (t === 'sect') { sect.loadCounts(); if (player.sect_id) { sect.loadTasks(); sect.loadTreasury(); } }
      if (t === 'alliance') { alli.loadList(); if (player.alliance_id) { alli.loadDetail(player.alliance_id); alli.loadBuildings(player.alliance_id); alli.loadTreasury(player.alliance_id); } }
      if (t === 'exchange') { exch.load(1); exch.loadMy(); }
      if (t === 'dungeon') { dung.loadList(); dung.loadMyTeam(); }
      if (t === 'trial') { loadTrialContracts(); loadTrialShop(); }
      if (t === 'duel') duel.loadTargets();
      if (t === 'league') league.ensureTabData(league.subTab.value || 'status');
      if (t === 'cave') caveRefresh();
      if (t === 'disciple') discRefresh();
      if (t === 'settings') { sett.loadInvInfo(); sett.loadInvShop(); sett.loadEmailStatus(); }
    });

    const itemTooltip = reactive({ visible: false, x: 0, y: 0, lines: [] });
    let _tipTimer = null;
    function _buildTooltipLines(item) {
      if (!item) return [];
      const tpl = getItem(item.id) || {};
      const merged = { ...tpl, ...item };
      const lines = fmtEquipmentDetail(merged, getItem);
      if (!lines.length) {
        const q = merged.quality || tpl.quality;
        const mergedType = String(merged.type || tpl.type || '').trim();
        const mergedItemId = Number(merged.id || tpl.id || 0);
        const hideTier = mergedType === 'array_plate' || mergedType === 'array_rune' || mergedItemId === 199;
        if (q && !hideTier) lines.push({ t: 'prop', label: '品阶', text: q + '阶' });
        const typeNames = { herb:'草药', material:'材料', consumable:'丹药', medicine:'药材', talisman:'符箓', book:'秘籍', array_plate:'阵盘', array_rune:'阵纹' };
        if (merged.type && typeNames[merged.type]) lines.push({ t: 'prop', label: '类型', text: typeNames[merged.type] });
        if (merged.material || tpl.material) lines.push({ t: 'prop', label: '材质', text: merged.material || tpl.material });
        if (merged.element || tpl.element) lines.push({ t: 'prop', label: '元素', text: merged.element || tpl.element });
        const desc = merged.description || tpl.description || '';
        if (desc) lines.push({ t: 'desc', text: desc });
        const effs = merged.effects || tpl.effects;
        if (effs?.length) {
          lines.push({ t: 'effects', items: effs.map(e => fmtItemEffect(e, getItem)).filter(Boolean) });
          for (const eff of effs) {
            if (eff.type === 'learn_skill' && eff.value) {
              const sk = getSkill(eff.value);
              if (sk) {
                if (sk.flavorText) lines.push({ t: 'desc', text: '「' + sk.flavorText + '」' });
                if (sk.description) lines.push({ t: 'desc', text: '效果: ' + sk.description });
              }
            }
          }
        }
      }
      return lines;
    }
    function _positionTooltip(anchorX, anchorY, anchorRight, anchorBottom) {
      itemTooltip.x = anchorRight != null ? anchorRight + 8 : anchorX;
      itemTooltip.y = anchorY;
      itemTooltip.visible = true;
      nextTick(() => {
        const el = document.querySelector('.item-tooltip-float');
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (r.right > vw) {
          const leftPos = anchorX - r.width - 8;
          if (leftPos >= 4) {
            itemTooltip.x = leftPos;
          } else {
            itemTooltip.x = Math.max(4, vw - r.width - 4);
            if (anchorBottom != null) itemTooltip.y = anchorBottom + 4;
          }
        }
        if (r.left < 0) itemTooltip.x = 4;
        if (r.bottom > vh) itemTooltip.y = Math.max(4, vh - r.height - 4);
        if (r.top < 0) itemTooltip.y = 4;
      });
    }
    function showItemTooltip(ev, item) {
      clearTimeout(_tipTimer);
      const lines = _buildTooltipLines(item);
      if (!lines.length) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      itemTooltip.lines = lines;
      _positionTooltip(rect.left, rect.top, rect.right, rect.bottom);
    }
    function hideItemTooltip() { _tipTimer = setTimeout(() => { itemTooltip.visible = false; }, 100); }
    function cancelHideTooltip() { if (_tipTimer) { clearTimeout(_tipTimer); _tipTimer = null; } }

    let _longPressTimer = null;
    let _longPressStartPos = null;
    let _touchMoved = false;
    let _touchItem = null;
    function _isBtnTarget(ev) {
      const t = ev && ev.target;
      return t && (t.tagName === 'BUTTON' || t.closest('button, .btn-sm'));
    }
    function itemTouchStart(ev, item) {
      clearTimeout(_longPressTimer);
      _touchMoved = false;
      if (_isBtnTarget(ev)) { _touchItem = null; return; }
      if (itemTooltip.visible) { itemTooltip.visible = false; _touchItem = null; return; }
      if (!item) return;
      const touch = ev.touches[0];
      _longPressStartPos = { x: touch.clientX, y: touch.clientY };
      _touchItem = item;
      const captured = item;
      _longPressTimer = setTimeout(() => {
        _touchItem = null;
        const lines = _buildTooltipLines(captured);
        if (!lines.length) return;
        itemTooltip.lines = lines;
        const px = _longPressStartPos.x, py = _longPressStartPos.y;
        _positionTooltip(px, Math.max(4, py - 80), null);
      }, 350);
    }
    function itemTouchEnd(ev) {
      clearTimeout(_longPressTimer);
      if (_isBtnTarget(ev)) return;
      if (_touchMoved || !_touchItem) { _touchItem = null; return; }
      const item = _touchItem;
      _touchItem = null;
      const lines = _buildTooltipLines(item);
      if (!lines.length) return;
      itemTooltip.lines = lines;
      const px = _longPressStartPos?.x || 100, py = _longPressStartPos?.y || 100;
      _positionTooltip(px, Math.max(4, py - 80), null);
    }

    onMounted(() => {
      document.addEventListener('touchmove', (e) => {
        if (!_longPressStartPos) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - _longPressStartPos.x) > 15 || Math.abs(t.clientY - _longPressStartPos.y) > 15) {
          clearTimeout(_longPressTimer); _longPressTimer = null;
          _touchMoved = true;
        }
      }, { passive: true });
      document.addEventListener('touchstart', (e) => {
        if (!itemTooltip.visible) return;
        const el = document.querySelector('.item-tooltip-float');
        if (el && el.contains(e.target)) return;
        itemTooltip.visible = false;
      }, { passive: true });
      document.addEventListener('click', (e) => {
        if (!itemTooltip.visible) return;
        const el = document.querySelector('.item-tooltip-float');
        if (el && el.contains(e.target)) return;
        const infoBtn = e.target && e.target.closest ? e.target.closest('.map-info-btn') : null;
        if (infoBtn) return;
        itemTooltip.visible = false;
      });
    });

    // ─── 洞府 ───
    const caveSubTab = ref('gather');
    const CAVE_FORMATION_BOARD_SIZE = 5;
    const CAVE_RUNE_EFFECT_LABELS = {
      RUNE_STRIKE: '攻伐',
      RUNE_GUARD: '守御',
      RUNE_BONE: '铸骨',
      RUNE_SWIFT: '迅行',
      RUNE_QI: '聚气',
      RUNE_SPIRIT: '聚灵',
      RUNE_PHYS_CRIT: '锋芒',
      RUNE_SPELL_CRIT: '灵锐',
      RUNE_MANA_FLOW: '引流',
      RUNE_BALANCE: '平衡'
    };
    const CAVE_ARROW_SYMBOLS = { N: '↑', E: '→', S: '↓', W: '←' };
    const CAVE_SLOT_LABELS = {
      '乾': '乾位',
      '坎': '坎位',
      '艮': '艮位',
      '震': '震位',
      '巽': '巽位',
      '离': '离位',
      '坤': '坤位',
      '兑': '兑位',
      head: '乾位',
      shoulder: '兑位',
      chest: '离位',
      hands: '震位',
      back: '坎位',
      ring: '巽位',
      amulet: '坤位'
    };
    const CAVE_SHAPE_LABELS = {
      PLATE_DOT: '点阵',
      PLATE_DOMINO: '长二',
      PLATE_TRI_LINE: '直三',
      PLATE_TRI_L: 'L三',
      PLATE_I4: '直四',
      PLATE_L4: 'L四',
      PLATE_T4: 'T四',
      PLATE_Z4: 'Z四',
      PLATE_U5: 'U五',
      PLATE_L5: 'L五',
      PLATE_T5: 'T五',
      PLATE_X5: 'X五'
    };
    const CAVE_RUNE_EFFECT_DESC_ZH = {
      RUNE_STRIKE: '提高力量，连接/指向越多提升越明显。',
      RUNE_GUARD: '提高体质，连接/指向越多提升越明显。',
      RUNE_BONE: '提高根骨，连接/指向越多提升越明显。',
      RUNE_SWIFT: '提高身法，连接/指向越多提升越明显。',
      RUNE_QI: '提高真元，连接/指向越多提升越明显。',
      RUNE_SPIRIT: '提高灵力，连接/指向越多提升越明显。',
      RUNE_PHYS_CRIT: '提高物理暴击率，连接/指向越多提升越明显。',
      RUNE_SPELL_CRIT: '提高法术暴击率，连接/指向越多提升越明显。',
      RUNE_MANA_FLOW: '每回合结束回复更多法力，连接/指向越多回复越高。',
      RUNE_BALANCE: '补强当前最低的一项属性，连接/指向越多补强越高。'
    };
    const CAVE_RUNE_COMBAT_RULES = Object.freeze({
      RUNE_STRIKE: { kind: 'attr_pct', attr: 'strength', base_pct: 1.5, per_link_pct: 0.6 },
      RUNE_GUARD: { kind: 'attr_pct', attr: 'constitution', base_pct: 1.5, per_link_pct: 0.6 },
      RUNE_BONE: { kind: 'attr_pct', attr: 'bone', base_pct: 1.2, per_link_pct: 0.5 },
      RUNE_SWIFT: { kind: 'attr_pct', attr: 'agility', base_pct: 1.0, per_link_pct: 0.5 },
      RUNE_QI: { kind: 'attr_pct', attr: 'zhenyuan', base_pct: 1.5, per_link_pct: 0.6 },
      RUNE_SPIRIT: { kind: 'attr_pct', attr: 'lingli', base_pct: 1.5, per_link_pct: 0.6 },
      RUNE_PHYS_CRIT: { kind: 'phys_crit_rate_pct', base_pct: 0.8, per_link_pct: 0.35 },
      RUNE_SPELL_CRIT: { kind: 'spell_crit_rate_pct', base_pct: 0.8, per_link_pct: 0.35 },
      RUNE_MANA_FLOW: { kind: 'turn_end_mp_pct_of_max_mp', base_pct: 1.2, per_link_pct: 0.6 },
      RUNE_BALANCE: { kind: 'balance_lowest_attr_pct', base_pct: 1.0, per_link_pct: 0.4 }
    });
    const CAVE_ATTR_NAME_ZH = Object.freeze({
      strength: '力量',
      constitution: '体质',
      bone: '根骨',
      agility: '身法',
      zhenyuan: '真元',
      lingli: '灵力'
    });
    const CAVE_MAIN_SERVICE_CFG = Object.freeze({
      MAIN_ABADDON_BREACH: { service_key: 'abaddon', start_cost: 5000, hourly_cost: 2000 },
      MAIN_ASCENSION: { service_key: 'yangsheng', start_cost: 10000, hourly_cost: 1000 },
      MAIN_SHENWU: { service_key: 'shenwu', start_cost: 5000, hourly_cost: 3000 },
      MAIN_SHENYUN: { service_key: 'shenyun', start_cost: 5000, hourly_cost: 3000 },
      MAIN_KUANGYONG: { service_key: 'kuangyong', start_cost: 5000, hourly_cost: 2000 },
      MAIN_YANMIAN: { service_key: 'yanmian', start_cost: 5000, hourly_cost: 2000 },
      MAIN_FACHAO: { service_key: 'fachao', start_cost: 5000, hourly_cost: 2000 },
      MAIN_SHENGUANG: { service_key: 'shenguang', start_cost: 5000, hourly_cost: 2000 },
      MAIN_GAIWU: { service_key: 'gaiwu', start_cost: 5000, hourly_cost: 10000 },
      MAIN_DAOTI: { service_key: 'daoti', start_cost: 5000, hourly_cost: 2000 }
    });

    function normalizeCavePiece(piece, fallbackType = '') {
      if (!piece || typeof piece !== 'object') return null;
      const rawType = String(piece.item_type || piece.type || fallbackType || '').trim().toLowerCase();
      const itemType = rawType === 'array_rune' || rawType === 'rune' ? 'array_rune'
        : (rawType === 'array_plate' || rawType === 'plate' ? 'array_plate' : '');
      if (!itemType) return null;
      const uid = String(piece.uid || '').trim();
      if (!uid) return null;
      return {
        uid,
        item_id: Number(piece.item_id || 0),
        name: String(piece.name || (itemType === 'array_rune' ? '阵纹' : '阵盘')),
        quality: Math.max(1, Number(piece.quality || 1)),
        item_type: itemType,
        shape_id: String(piece.shape_id || ''),
        shape_name: String(piece.shape_name || ''),
        flow_supply: Number(piece.flow_supply || 0),
        slot: String(piece.slot || ''),
        arrow_dirs: Array.isArray(piece.arrow_dirs) ? piece.arrow_dirs.map(d => String(d || '').trim().toUpperCase()).filter(Boolean) : [],
        effect_id: String(piece.effect_id || ''),
        effect: String(piece.effect || ''),
        effect_desc: String(piece.effect_desc || ''),
        flow_cost: Math.max(0, Number(piece.flow_cost || 0)),
        main_trigger_value: Math.max(0, Number(piece.main_trigger_value || 0)),
        effect_roll_pct: Math.max(0, Number(piece.effect_roll_pct || 0)),
        plate_affixes: Array.isArray(piece.plate_affixes)
          ? piece.plate_affixes.map((a) => ({
            bonus_id: String(a?.bonus_id || a?.affix_id || ''),
            name: String(a?.name || ''),
            type: String(a?.type || ''),
            target_effect_id: String(a?.target_effect_id || ''),
            value_pct: Number(a?.value_pct || 0),
            source: String(a?.source || '')
          })).filter((a) => !!a.bonus_id && a.value_pct > 0)
          : [],
        created_at: Number(piece.created_at || 0)
      };
    }

    function normalizeCaveRuntime(raw) {
      const src = raw && typeof raw === 'object' ? raw : {};
      const normalizeRuntimeList = (arr) => Array.isArray(arr) ? arr : [];
      return {
        link_rule: String(src.link_rule || 'adjacent-plate-connect'),
        plate_arrows_enabled: !!src.plate_arrows_enabled,
        runes: normalizeRuntimeList(src.runes).map(r => ({
          uid: String(r?.uid || ''),
          board_index: Number(r?.board_index || 0),
          effect_id: String(r?.effect_id || ''),
          effect_name: String(r?.effect_name || ''),
          connected_plate_uids: Array.isArray(r?.connected_plate_uids) ? r.connected_plate_uids.map(x => String(x || '')) : [],
          pointed_plate_uids: Array.isArray(r?.pointed_plate_uids) ? r.pointed_plate_uids.map(x => String(x || '')) : [],
          linked_plate_count: Math.max(0, Number(r?.linked_plate_count || 0)),
          pointed_plate_count: Math.max(0, Number(r?.pointed_plate_count || 0)),
          is_connected: !!r?.is_connected,
          flow_cost: Math.max(0, Number(r?.flow_cost || 0)),
          main_trigger_value: Math.max(0, Number(r?.main_trigger_value || 0)),
          effect_roll_pct: Math.max(0, Number(r?.effect_roll_pct || 0))
        })),
        plates: normalizeRuntimeList(src.plates).map(p => ({
          uid: String(p?.uid || ''),
          board_index: Number(p?.board_index || 0),
          anchor_index: Number(p?.anchor_index ?? p?.board_index ?? 0),
          occupied_indexes: Array.isArray(p?.occupied_indexes)
            ? p.occupied_indexes.map(x => Math.max(0, Number(x || 0))).filter(x => Number.isFinite(x))
            : [Math.max(0, Number(p?.anchor_index ?? p?.board_index ?? 0))],
          connected_rune_uids: Array.isArray(p?.connected_rune_uids) ? p.connected_rune_uids.map(x => String(x || '')) : [],
          pointed_rune_uids: Array.isArray(p?.pointed_rune_uids) ? p.pointed_rune_uids.map(x => String(x || '')) : [],
          connected_rune_count: Math.max(0, Number(p?.connected_rune_count || 0)),
          pointed_rune_count: Math.max(0, Number(p?.pointed_rune_count || 0)),
          main_trigger_value: Math.max(0, Number(p?.main_trigger_value || 0)),
          pointed_effect_counts: (p?.pointed_effect_counts && typeof p.pointed_effect_counts === 'object')
            ? Object.fromEntries(Object.entries(p.pointed_effect_counts).map(([k, v]) => [String(k || ''), Math.max(0, Number(v || 0))]).filter(([k, v]) => !!k && v > 0))
            : {},
          active_main_skills: Array.isArray(p?.active_main_skills)
            ? p.active_main_skills.map(s => ({
              skill_id: String(s?.skill_id || ''),
              name: String(s?.name || ''),
              desc: String(s?.desc || ''),
              reward_base: Math.max(0, Number(s?.reward_base || 0))
            }))
            : [],
          main_reward_base: Math.max(0, Number(p?.main_reward_base || 0)),
          active_plate_bonus: Array.isArray(p?.active_plate_bonus)
            ? p.active_plate_bonus.map(b => ({
              bonus_id: String(b?.bonus_id || ''),
              type: String(b?.type || ''),
              target_effect_id: String(b?.target_effect_id || ''),
              target_effect_name: String(b?.target_effect_name || ''),
              value_pct: Number(b?.value_pct || 0)
            }))
            : []
        })),
        summary: {
          total_runes: Math.max(0, Number(src?.summary?.total_runes || 0)),
          connected_runes: Math.max(0, Number(src?.summary?.connected_runes || 0)),
          disconnected_runes: Math.max(0, Number(src?.summary?.disconnected_runes || 0)),
          total_flow_supply: Math.max(0, Number(src?.summary?.total_flow_supply || 0)),
          total_flow_cost: Math.max(0, Number(src?.summary?.total_flow_cost || 0)),
          flow_efficiency_ratio: Math.max(0, Number(src?.summary?.flow_efficiency_ratio ?? 1)),
          flow_efficiency_pct: Math.max(0, Number(src?.summary?.flow_efficiency_pct ?? 100)),
          flow_overload_ratio: Math.max(0, Number(src?.summary?.flow_overload_ratio || 0)),
          total_trigger_value: Math.max(0, Number(src?.summary?.total_trigger_value || 0)),
          main_system_enabled: !!src?.summary?.main_system_enabled,
          active_main_skill_plates: Math.max(0, Number(src?.summary?.active_main_skill_plates || 0)),
          active_main_skill_count: Math.max(0, Number(src?.summary?.active_main_skill_count || 0)),
          total_main_reward_base: Math.max(0, Number(src?.summary?.total_main_reward_base || 0))
        }
      };
    }

    function normalizeCaveFormation(raw) {
      const src = raw && typeof raw === 'object' ? raw : {};
      const size = Math.max(1, Math.min(9, Math.floor(Number(src.board_size || CAVE_FORMATION_BOARD_SIZE))));
      const total = size * size;
      const used = new Set();
      const normBoard = Array.isArray(src.board) ? src.board.slice(0, total) : [];
      while (normBoard.length < total) normBoard.push(null);
      const board = normBoard.map((cell) => {
        const piece = normalizeCavePiece(cell);
        if (!piece) return null;
        if (used.has(piece.uid)) return null;
        used.add(piece.uid);
        return piece;
      });
      const normalizePool = (arr, expectType) => {
        const out = [];
        for (const pieceRaw of (Array.isArray(arr) ? arr : [])) {
          const piece = normalizeCavePiece(pieceRaw, expectType);
          if (!piece || piece.item_type !== expectType) continue;
          if (used.has(piece.uid)) continue;
          used.add(piece.uid);
          out.push(piece);
        }
        return out;
      };
      return {
        board_size: size,
        board,
        plate_pool: normalizePool(src.plate_pool, 'array_plate'),
        rune_pool: normalizePool(src.rune_pool, 'array_rune'),
        runtime: normalizeCaveRuntime(src.runtime)
      };
    }

    function applyCaveStatus(payload, loading = false) {
      const src = payload && typeof payload === 'object' ? payload : {};
      caveState.level = Number(src.level || caveState.level || 1);
      caveState.max_level = Number(src.max_level || caveState.max_level || 7);
      caveState.rare_remaining = Number(src.rare_remaining ?? caveState.rare_remaining ?? 0);
      caveState.rare_max = Math.max(1, Number(src.rare_max || caveState.rare_max || 1));
      caveState.main_trigger_settle_count_today = Math.max(0, Number(src.main_trigger_settle_count_today ?? caveState.main_trigger_settle_count_today ?? 0));
      caveState.main_spirit_today = Math.max(0, Number(src.main_spirit_today ?? caveState.main_spirit_today ?? 0));
      caveState.gathering = src.gathering || null;
      caveState.upgrade_cost = Number(src.upgrade_cost || 0);
      caveState.next_rare_cap = Number(src.next_rare_cap || caveState.rare_max);
      caveState.today_log = Array.isArray(src.today_log) ? src.today_log : [];
      caveState.main_services = (src.main_services && typeof src.main_services === 'object') ? src.main_services : {};
      caveState.formation = normalizeCaveFormation(src.formation);
      caveState.loading = !!loading;
    }

    const caveState = reactive({
      level: 1, max_level: 7,
      rare_remaining: 500, rare_max: 500,
      main_trigger_settle_count_today: 0,
      main_spirit_today: 0,
      gathering: null,
      upgrade_cost: 0, next_rare_cap: 0,
      today_log: [],
      main_services: {},
      formation: normalizeCaveFormation(null),
      loading: false
    });
    const caveReport = ref(null);
    const caveFormationBusy = ref(false);
    const caveDragState = reactive({ source_zone: '', source_uid: '', source_index: -1 });
    const caveTapState = reactive({ source_zone: '', source_uid: '', source_index: -1, piece_type: '' });
    const cavePlateShapeFilter = ref('全部');
    const caveRuneKeywordFilter = ref('全部');
    const caveRuneArrowFilter = ref('全部');
    const CAVE_POOL_PAGE_SIZE = 8;
    const cavePlatePage = ref(1);
    const caveRunePage = ref(1);
    const caveBoardSize = computed(() => {
      const size = Number(caveState.formation?.board_size || CAVE_FORMATION_BOARD_SIZE);
      return Math.max(1, Math.min(9, Math.floor(size)));
    });
    const caveBoardCellCount = computed(() => caveBoardSize.value * caveBoardSize.value);
    const caveBoardGridStyle = computed(() => ({
      gridTemplateColumns: `repeat(${caveBoardSize.value}, minmax(0, 1fr))`
    }));
    const caveRuneRuntimeMap = computed(() => {
      const out = Object.create(null);
      for (const row of (caveState.formation?.runtime?.runes || [])) {
        const uid = String(row?.uid || '').trim();
        if (!uid) continue;
        out[uid] = row;
      }
      return out;
    });
    const cavePlateRuntimeMap = computed(() => {
      const out = Object.create(null);
      for (const row of (caveState.formation?.runtime?.plates || [])) {
        const uid = String(row?.uid || '').trim();
        if (!uid) continue;
        out[uid] = row;
      }
      return out;
    });
    function caveRuneKeywordTag(piece) {
      const effectId = String(piece?.effect_id || '').trim();
      if (!effectId) return '';
      return CAVE_RUNE_EFFECT_LABELS[effectId] || effectId;
    }
    function caveRuneArrowTags(piece) {
      const dirs = Array.isArray(piece?.arrow_dirs)
        ? piece.arrow_dirs.map((d) => String(d || '').trim().toUpperCase()).filter(Boolean)
        : [];
      return dirs.map((d) => CAVE_ARROW_SYMBOLS[d] || d);
    }
    function cavePlateShapeTag(piece) {
      const shapeId = String(piece?.shape_id || '').trim();
      const shapeName = String(piece?.shape_name || '').trim();
      return shapeName || CAVE_SHAPE_LABELS[shapeId] || shapeId || '未知';
    }
    const cavePlateShapeOptions = computed(() => {
      const set = new Set();
      for (const piece of (caveState.formation?.plate_pool || [])) {
        set.add(cavePlateShapeTag(piece));
      }
      return ['全部', ...Array.from(set)];
    });
    const caveFilteredPlatePool = computed(() => {
      const shape = String(cavePlateShapeFilter.value || '全部');
      return (caveState.formation?.plate_pool || []).filter((piece) => {
        if (shape === '全部') return true;
        return cavePlateShapeTag(piece) === shape;
      });
    });
    const cavePlatePageCount = computed(() => Math.max(1, Math.ceil(caveFilteredPlatePool.value.length / CAVE_POOL_PAGE_SIZE)));
    const cavePagedPlatePool = computed(() => {
      const start = (cavePlatePage.value - 1) * CAVE_POOL_PAGE_SIZE;
      return caveFilteredPlatePool.value.slice(start, start + CAVE_POOL_PAGE_SIZE);
    });
    function setCavePlatePage(page) {
      const p = Math.max(1, Math.min(cavePlatePageCount.value, Math.floor(Number(page) || 1)));
      cavePlatePage.value = p;
    }
    const caveRuneKeywordOptions = computed(() => {
      const set = new Set();
      for (const piece of (caveState.formation?.rune_pool || [])) {
        const tag = caveRuneKeywordTag(piece);
        if (tag) set.add(tag);
      }
      return ['全部', ...Array.from(set)];
    });
    const caveRuneArrowOptions = computed(() => {
      const set = new Set();
      for (const piece of (caveState.formation?.rune_pool || [])) {
        for (const d of caveRuneArrowTags(piece)) set.add(d);
      }
      return ['全部', ...Array.from(set)];
    });
    const caveFilteredRunePool = computed(() => {
      const keyword = String(caveRuneKeywordFilter.value || '全部');
      const arrow = String(caveRuneArrowFilter.value || '全部');
      return (caveState.formation?.rune_pool || []).filter((piece) => {
        if (keyword !== '全部') {
          const tag = caveRuneKeywordTag(piece);
          if (tag !== keyword) return false;
        }
        if (arrow !== '全部') {
          const tags = caveRuneArrowTags(piece);
          if (!tags.includes(arrow)) return false;
        }
        return true;
      });
    });
    const caveRunePageCount = computed(() => Math.max(1, Math.ceil(caveFilteredRunePool.value.length / CAVE_POOL_PAGE_SIZE)));
    const cavePagedRunePool = computed(() => {
      const start = (caveRunePage.value - 1) * CAVE_POOL_PAGE_SIZE;
      return caveFilteredRunePool.value.slice(start, start + CAVE_POOL_PAGE_SIZE);
    });
    function setCaveRunePage(page) {
      const p = Math.max(1, Math.min(caveRunePageCount.value, Math.floor(Number(page) || 1)));
      caveRunePage.value = p;
    }
    watch(cavePlateShapeFilter, () => { cavePlatePage.value = 1; });
    watch([caveRuneKeywordFilter, caveRuneArrowFilter], () => { caveRunePage.value = 1; });
    watch(() => caveFilteredPlatePool.value.length, () => {
      if (cavePlatePage.value > cavePlatePageCount.value) cavePlatePage.value = cavePlatePageCount.value;
      if (cavePlatePage.value < 1) cavePlatePage.value = 1;
    });
    watch(() => caveFilteredRunePool.value.length, () => {
      if (caveRunePage.value > caveRunePageCount.value) caveRunePage.value = caveRunePageCount.value;
      if (caveRunePage.value < 1) caveRunePage.value = 1;
    });
    function cavePickDisplayIndex(occupiedIndexes) {
      const list = Array.isArray(occupiedIndexes) ? occupiedIndexes : [];
      if (list.length <= 0) return -1;
      const size = caveBoardSize.value;
      const total = caveBoardCellCount.value;
      const points = [];
      let sumX = 0;
      let sumY = 0;
      for (const raw of list) {
        const idx = Math.floor(Number(raw));
        if (!Number.isFinite(idx) || idx < 0 || idx >= total) continue;
        const x = idx % size;
        const y = Math.floor(idx / size);
        points.push({ idx, x, y });
        sumX += x;
        sumY += y;
      }
      if (points.length <= 0) return -1;
      const cx = sumX / points.length;
      const cy = sumY / points.length;
      let best = points[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const p of points) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist || (dist === bestDist && p.idx < best.idx)) {
          best = p;
          bestDist = dist;
        }
      }
      return best.idx;
    }
    const caveBoardOccupyMap = computed(() => {
      const out = Object.create(null);
      for (const plate of (caveState.formation?.runtime?.plates || [])) {
        const uid = String(plate?.uid || '').trim();
        if (!uid) continue;
        const anchor = Math.max(0, Number(plate?.anchor_index ?? plate?.board_index ?? 0));
        const occupiedRaw = Array.isArray(plate?.occupied_indexes) && plate.occupied_indexes.length > 0
          ? plate.occupied_indexes
          : [anchor];
        const occupied = [];
        const seen = new Set();
        for (const raw of occupiedRaw) {
          const bi = Math.floor(Number(raw));
          if (!Number.isFinite(bi) || bi < 0 || bi >= caveBoardCellCount.value) continue;
          if (seen.has(bi)) continue;
          seen.add(bi);
          occupied.push(bi);
        }
        const displayIndex = cavePickDisplayIndex(occupied);
        for (const idx of occupied) {
          const bi = Math.max(0, Number(idx || 0));
          out[bi] = {
            uid,
            anchor_index: anchor,
            display_index: displayIndex,
            is_anchor: bi === anchor,
            is_display: bi === displayIndex
          };
        }
      }
      const board = Array.isArray(caveState.formation?.board) ? caveState.formation.board : [];
      for (let i = 0; i < board.length; i += 1) {
        const piece = board[i];
        if (!piece || typeof piece !== 'object') continue;
        if (out[i]) continue;
        const uid = String(piece.uid || '').trim();
        if (!uid) continue;
        out[i] = { uid, anchor_index: i, display_index: i, is_anchor: true, is_display: true };
      }
      return out;
    });
    function caveCellPiece(index) {
      const idx = Math.floor(Number(index));
      const board = Array.isArray(caveState.formation?.board) ? caveState.formation.board : [];
      const occ = caveBoardOccupyMap.value[idx];
      if (!occ) return null;
      const anchor = Math.max(0, Number(occ.anchor_index || 0));
      return board[anchor] || null;
    }
    function caveCellOccupied(index) {
      const idx = Math.floor(Number(index));
      return !!caveBoardOccupyMap.value[idx];
    }
    function caveCellAnchor(index) {
      const idx = Math.floor(Number(index));
      const occ = caveBoardOccupyMap.value[idx];
      return !!(occ && occ.is_display);
    }
    const caveMainServiceRows = computed(() => {
      const rows = [];
      const plates = Array.isArray(caveState.formation?.runtime?.plates) ? caveState.formation.runtime.plates : [];
      for (const plate of plates) {
        const plateUid = String(plate?.uid || '').trim();
        const skills = Array.isArray(plate?.active_main_skills) ? plate.active_main_skills : [];
        for (const sk of skills) {
          const sid = String(sk?.skill_id || '').trim();
          if (!sid) continue;
          const cfg = CAVE_MAIN_SERVICE_CFG[sid] || { service_key: '', start_cost: 0, hourly_cost: 0 };
          if (!cfg.service_key) continue;
          const instanceKey = String(sk?.instance_key || `${sid}@${plateUid}`).trim();
          const svcEntry = (caveState.main_services && typeof caveState.main_services === 'object')
            ? caveState.main_services[String(cfg.service_key || '')] || {}
            : {};
          const svcInst = (svcEntry.instances && typeof svcEntry.instances === 'object')
            ? svcEntry.instances[String(instanceKey || '')] || {}
            : {};
          rows.push({
            skill_id: sid,
            instance_key: instanceKey,
            plate_uid: plateUid,
            name: String(sk?.name || sid),
            start_cost: Math.max(0, Number(cfg.start_cost || 0)),
            hourly_cost: Math.max(0, Number(cfg.hourly_cost || 0)),
            active: !!svcInst?.active,
            service_key: String(cfg.service_key || '')
          });
        }
      }
      return rows;
    });
    const caveMainServiceHourlyTotal = computed(() => {
      let total = 0;
      for (const row of caveMainServiceRows.value) {
        if (!row?.active) continue;
        total += Math.max(0, Number(row.hourly_cost || 0));
      }
      return total;
    });
    const caveYanmianServiceActive = computed(() => {
      const svcRoot = caveState.main_services && typeof caveState.main_services === 'object'
        ? caveState.main_services
        : {};
      const yanmian = svcRoot.yanmian && typeof svcRoot.yanmian === 'object'
        ? svcRoot.yanmian
        : {};
      const instances = yanmian.instances && typeof yanmian.instances === 'object'
        ? yanmian.instances
        : {};
      return Object.values(instances).some((s) => !!(s && s.active));
    });
    const caveFormationFlowSummary = computed(() => {
      const empty = {
        supply: 0,
        cost_all: 0,
        cost_connected: 0,
        net_flow: 0,
        connected_rune_count: 0,
        avg_roll_pct: 0,
        max_roll_pct: 0,
        avg_roll_pct_text: '0',
        max_roll_pct_text: '0'
      };
      try {
        const runtime = caveState.formation?.runtime || {};
        const plates = Array.isArray(runtime.plates) ? runtime.plates : [];
        const runes = Array.isArray(runtime.runes) ? runtime.runes : [];
        let supply = 0;
        for (const p of plates) supply += Math.max(0, Number(p?.flow_supply || 0));
        let costAll = 0;
        let costConnected = 0;
        let rollSum = 0;
        let rollMax = 0;
        let rollCount = 0;
        for (const r of runes) {
          const cost = Math.max(0, Number(r?.flow_cost || 0));
          costAll += cost;
          if (r?.is_connected) {
            costConnected += cost;
            const roll = Math.max(0, Number(r?.effect_roll_pct || 0));
            rollSum += roll;
            rollCount += 1;
            if (roll > rollMax) rollMax = roll;
          }
        }
        const netFlow = supply - costConnected;
        const avgRollPct = rollCount > 0 ? (rollSum / rollCount) : 0;
        return {
          supply,
          cost_all: costAll,
          cost_connected: costConnected,
          net_flow: netFlow,
          connected_rune_count: rollCount,
          avg_roll_pct: avgRollPct,
          max_roll_pct: rollMax,
          avg_roll_pct_text: (Number.isInteger(avgRollPct) ? String(avgRollPct) : avgRollPct.toFixed(2)),
          max_roll_pct_text: (Number.isInteger(rollMax) ? String(rollMax) : rollMax.toFixed(2))
        };
      } catch (_) {
        return empty;
      }
    });
    const caveFormationDecaySummary = computed(() => {
      const summary = caveState.formation?.runtime?.summary || {};
      const effRatio = Math.max(0, Math.min(1, Number(summary.flow_efficiency_ratio ?? 1)));
      const effPct = Number(summary.flow_efficiency_pct);
      const overloadRatio = Math.max(0, Math.min(1, Number(summary.flow_overload_ratio || 0)));
      const overloadPct = overloadRatio * 100;
      const efficiencyPct = Number.isFinite(effPct) ? Math.max(0, Math.min(100, effPct)) : (effRatio * 100);
      return {
        overloaded: overloadRatio > 0,
        efficiency_pct: efficiencyPct,
        overload_pct: overloadPct,
        efficiency_text: Number.isInteger(efficiencyPct) ? String(efficiencyPct) : efficiencyPct.toFixed(2),
        overload_text: Number.isInteger(overloadPct) ? String(overloadPct) : overloadPct.toFixed(2)
      };
    });
    const caveFormationTotalBonusSummary = computed(() => {
      const runtime = caveState.formation?.runtime || {};
      const plates = Array.isArray(runtime.plates) ? runtime.plates : [];
      const runes = Array.isArray(runtime.runes) ? runtime.runes : [];
      const hasActiveMain = plates.some((p) => Array.isArray(p?.active_main_skills) && p.active_main_skills.length > 0);
      const out = {
        attr_pct: { strength: 0, constitution: 0, bone: 0, agility: 0, zhenyuan: 0, lingli: 0 },
        phys_crit_rate_pct: 0,
        spell_crit_rate_pct: 0,
        turn_end_mp_pct_of_max_mp: 0,
        balance_lowest_attr_pct: 0,
        attr_lines: [],
        extra_lines: []
      };
      if (!hasActiveMain || runes.length <= 0) return out;

      const flowRatio = Math.max(0, Math.min(1, Number(runtime?.summary?.flow_efficiency_ratio ?? 1)));
      if (flowRatio <= 0) return out;

      const plateByUid = new Map();
      for (const p of plates) {
        const uid = String(p?.uid || '').trim();
        if (!uid) continue;
        plateByUid.set(uid, p);
      }

      const calcPlateAmpPct = (rune) => {
        let amp = 0;
        const pointed = Array.isArray(rune?.pointed_plate_uids) ? rune.pointed_plate_uids : [];
        const effectId = String(rune?.effect_id || '').trim();
        for (const pu of pointed) {
          const plate = plateByUid.get(String(pu || ''));
          if (!plate) continue;
          for (const b of (Array.isArray(plate.active_plate_bonus) ? plate.active_plate_bonus : [])) {
            const type = String(b?.type || '').trim();
            const valuePct = Math.max(0, Number(b?.value_pct || 0));
            if (valuePct <= 0) continue;
            if (type === 'pointed_all_effect_amp_pct') amp += valuePct;
            else if (type === 'pointed_effect_amp_pct' && String(b?.target_effect_id || '').trim() === effectId) amp += valuePct;
          }
        }
        return amp;
      };

      for (const rune of runes) {
        if (!rune || rune.is_connected !== true) continue;
        const effectId = String(rune.effect_id || '').trim();
        const rule = CAVE_RUNE_COMBAT_RULES[effectId];
        if (!rule) continue;
        const linked = Math.max(0, Number(rune.linked_plate_count || 0));
        let effectPct = Math.max(0, Number(rule.base_pct || 0) + linked * Number(rule.per_link_pct || 0));
        if (effectPct <= 0) continue;
        const plateAmpPct = calcPlateAmpPct(rune);
        const rollPct = Math.max(0, Number(rune.effect_roll_pct || 0));
        effectPct *= (1 + plateAmpPct / 100) * (1 + rollPct / 100) * flowRatio;
        const ratio = Math.max(0, effectPct / 100);

        if (rule.kind === 'attr_pct' && rule.attr && Object.prototype.hasOwnProperty.call(out.attr_pct, rule.attr)) {
          out.attr_pct[rule.attr] += ratio;
        } else if (rule.kind === 'phys_crit_rate_pct') {
          out.phys_crit_rate_pct += ratio;
        } else if (rule.kind === 'spell_crit_rate_pct') {
          out.spell_crit_rate_pct += ratio;
        } else if (rule.kind === 'turn_end_mp_pct_of_max_mp') {
          out.turn_end_mp_pct_of_max_mp += ratio;
        } else if (rule.kind === 'balance_lowest_attr_pct') {
          out.balance_lowest_attr_pct += ratio;
        }
      }

      const fmtPct = (ratio) => {
        const v = Math.max(0, Number(ratio || 0)) * 100;
        if (v <= 0) return '';
        return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`;
      };
      for (const [k, ratio] of Object.entries(out.attr_pct)) {
        const text = fmtPct(ratio);
        if (!text) continue;
        out.attr_lines.push(`${CAVE_ATTR_NAME_ZH[k] || k} +${text}`);
      }
      const physText = fmtPct(out.phys_crit_rate_pct);
      if (physText) out.extra_lines.push(`物暴率 +${physText}`);
      const spellText = fmtPct(out.spell_crit_rate_pct);
      if (spellText) out.extra_lines.push(`法暴率 +${spellText}`);
      const manaText = fmtPct(out.turn_end_mp_pct_of_max_mp);
      if (manaText) out.extra_lines.push(`回合末回蓝 +${manaText}`);
      const balanceText = fmtPct(out.balance_lowest_attr_pct);
      if (balanceText) out.extra_lines.push(`最低属性补强 +${balanceText}`);
      return out;
    });

    function clearCaveDragSource() {
      caveDragState.source_zone = '';
      caveDragState.source_uid = '';
      caveDragState.source_index = -1;
    }
    function clearCaveTapSource() {
      caveTapState.source_zone = '';
      caveTapState.source_uid = '';
      caveTapState.source_index = -1;
      caveTapState.piece_type = '';
    }
    function caveAllowDrop(ev) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    }
    function cavePoolDragStart(poolType, pieceUid, ev) {
      caveDragState.source_zone = String(poolType || '') === 'rune' ? 'rune_pool' : 'plate_pool';
      caveDragState.source_uid = String(pieceUid || '').trim();
      caveDragState.source_index = -1;
      const dt = ev && ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = 'move';
        dt.setData('text/plain', caveDragState.source_uid);
      }
    }
    function caveBoardDragStart(index, ev) {
      caveDragState.source_zone = 'board';
      caveDragState.source_uid = '';
      caveDragState.source_index = Number.isInteger(index) ? index : Math.floor(Number(index) || -1);
      const dt = ev && ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = 'move';
        dt.setData('text/plain', String(caveDragState.source_index));
      }
    }
    function caveDragEnd() {
      clearCaveDragSource();
    }
    function caveIsSelectedPoolPiece(poolType, pieceUid) {
      const zone = String(poolType || '') === 'rune' ? 'rune_pool' : 'plate_pool';
      return caveTapState.source_zone === zone && String(caveTapState.source_uid || '') === String(pieceUid || '');
    }
    function caveIsSelectedBoardIndex(index) {
      const idx = Math.floor(Number(index));
      return caveTapState.source_zone === 'board' && caveTapState.source_index === idx;
    }
    function caveSelectPoolPiece(poolType, pieceUid) {
      const zone = String(poolType || '') === 'rune' ? 'rune_pool' : 'plate_pool';
      const uid = String(pieceUid || '').trim();
      if (!uid) return;
      caveTapState.source_zone = zone;
      caveTapState.source_uid = uid;
      caveTapState.source_index = -1;
      caveTapState.piece_type = zone === 'rune_pool' ? 'array_rune' : 'array_plate';
      showToast('已选中部件，请点击阵图目标格');
    }
    function caveSelectBoardPiece(index) {
      const idx = Math.floor(Number(index));
      if (idx < 0 || idx >= caveBoardCellCount.value) return;
      const occ = caveBoardOccupyMap.value[idx];
      const anchor = occ ? Math.max(0, Number(occ.anchor_index || idx)) : idx;
      const piece = caveCellPiece(anchor);
      if (!piece) return;
      caveTapState.source_zone = 'board';
      caveTapState.source_uid = String(piece.uid || '');
      caveTapState.source_index = idx;
      caveTapState.piece_type = String(piece.item_type || '');
      showToast('已选中阵图部件，请点击目标格移动，或点对应栏位回收');
    }

    function cavePieceTypeLabel(piece) {
      return String(piece?.item_type || '') === 'array_rune' ? '阵纹' : '阵盘';
    }
    function cavePieceMeta(piece) {
      if (!piece || typeof piece !== 'object') return '';
      const formatPct = (v) => {
        const n = Number(v || 0);
        if (!Number.isFinite(n) || n <= 0) return '0';
        return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
      };
      const buildRuneEffectDetail = (effectId, rt, fallbackRollPct = 0) => {
        const rule = CAVE_RUNE_COMBAT_RULES[String(effectId || '')] || null;
        if (!rule) return '';
        const linkedCount = Math.max(0, Number(rt?.linked_plate_count || 0));
        const basePct = Math.max(0, Number(rule.base_pct || 0) + linkedCount * Number(rule.per_link_pct || 0));

        const seen = new Set();
        let plateAmpPct = 0;
        const plateUids = [];
        for (const uid of (Array.isArray(rt?.connected_plate_uids) ? rt.connected_plate_uids : [])) {
          const k = String(uid || '').trim();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          plateUids.push(k);
        }
        for (const uid of (Array.isArray(rt?.pointed_plate_uids) ? rt.pointed_plate_uids : [])) {
          const k = String(uid || '').trim();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          plateUids.push(k);
        }
        for (const uid of plateUids) {
          const plateRt = cavePlateRuntimeMap.value[uid] || null;
          const bonusList = Array.isArray(plateRt?.active_plate_bonus) ? plateRt.active_plate_bonus : [];
          for (const bonus of bonusList) {
            const type = String(bonus?.type || '');
            const v = Math.max(0, Number(bonus?.value_pct || 0));
            if (v <= 0) continue;
            if (type === 'pointed_all_effect_amp_pct') {
              plateAmpPct += v;
            } else if (type === 'pointed_effect_amp_pct') {
              const targetId = String(bonus?.target_effect_id || '').trim();
              if (targetId && targetId === String(effectId || '')) plateAmpPct += v;
            }
          }
        }

        const rollPct = Math.max(0, Number(rt?.effect_roll_pct || fallbackRollPct || 0));
        const finalPct = basePct * (1 + plateAmpPct / 100) * (1 + rollPct / 100);

        const finalText = formatPct(finalPct);
        const baseText = formatPct(basePct);
        const ampText = formatPct(plateAmpPct);
        const rollText = formatPct(rollPct);

        if (rule.kind === 'attr_pct' && rule.attr) {
          const attrName = CAVE_ATTR_NAME_ZH[rule.attr] || rule.attr;
          return `${attrName}最终约 +${finalText}%（基础 ${baseText}% + 阵盘放大 ${ampText}% + 品质浮动 ${rollText}%）`;
        }
        if (rule.kind === 'phys_crit_rate_pct') {
          return `物理暴击率最终约 +${finalText}%（基础 ${baseText}% + 阵盘放大 ${ampText}% + 品质浮动 ${rollText}%）`;
        }
        if (rule.kind === 'spell_crit_rate_pct') {
          return `法术暴击率最终约 +${finalText}%（基础 ${baseText}% + 阵盘放大 ${ampText}% + 品质浮动 ${rollText}%）`;
        }
        if (rule.kind === 'turn_end_mp_pct_of_max_mp') {
          return `每回合末回复法力 = 最大法力 × ${finalText}%（基础 ${baseText}% + 阵盘放大 ${ampText}% + 品质浮动 ${rollText}%）`;
        }
        if (rule.kind === 'balance_lowest_attr_pct') {
          return `最低六维补强约 +${finalText}%（基础 ${baseText}% + 阵盘放大 ${ampText}% + 品质浮动 ${rollText}%）`;
        }
        return '';
      };
      const itemType = String(piece.item_type || '');
      if (itemType === 'array_plate') {
        const shapeId = String(piece.shape_id || '').trim();
        const shape = String(piece.shape_name || CAVE_SHAPE_LABELS[shapeId] || shapeId || '').trim();
        const flow = Number(piece.flow_supply || 0);
        const rt = cavePlateRuntimeMap.value[String(piece.uid || '')] || null;
        const parts = [];
        if (shape) parts.push(`形状：${shape}`);
        if (flow > 0) parts.push(`每回合提供流量 ${flow}`);
        if (rt && Number(rt.connected_rune_count || 0) > 0) parts.push(`已连接阵纹 ${Number(rt.connected_rune_count || 0)} 个`);
        if (rt && Number(rt.main_trigger_value || 0) > 0) parts.push(`当前触发值 ${Number(rt.main_trigger_value || 0)}`);
        if (rt && rt.pointed_effect_counts && typeof rt.pointed_effect_counts === 'object') {
          const countParts = [];
          for (const [effectId, countRaw] of Object.entries(rt.pointed_effect_counts)) {
            const count = Math.max(0, Number(countRaw || 0));
            if (count <= 0) continue;
            const label = CAVE_RUNE_EFFECT_LABELS[effectId] || effectId;
            countParts.push(`${label}×${count}`);
          }
          if (countParts.length > 0) parts.push(`指向阵纹效果：${countParts.join('，')}`);
        }
        if (rt && Array.isArray(rt.active_main_skills) && rt.active_main_skills.length > 0) {
          const names = rt.active_main_skills.map(s => String(s?.name || '').trim()).filter(Boolean);
          if (names.length > 0) parts.push(`激活主阵：${names.join(' / ')}`);
        }
        if (rt && Number(rt.main_reward_base || 0) > 0) parts.push(`主阵灵石基值：${Number(rt.main_reward_base || 0)} / 次`);
        if (Array.isArray(piece.plate_affixes) && piece.plate_affixes.length > 0) {
          const affixParts = [];
          for (const affix of piece.plate_affixes) {
            const type = String(affix?.type || '');
            const targetId = String(affix?.target_effect_id || '').trim();
            const targetLabel = CAVE_RUNE_EFFECT_LABELS[targetId] || targetId;
            const pctText = formatPct(affix?.value_pct);
            if (type === 'pointed_all_effect_amp_pct') affixParts.push(`所有被指向的阵纹效果 +${pctText}%`);
            else if (type === 'pointed_effect_amp_pct' && targetLabel) affixParts.push(`${targetLabel}效果 +${pctText}%`);
          }
          if (affixParts.length > 0) parts.push(`阵盘词条：${affixParts.join('；')}`);
        }
        return parts.join('。') || '基础阵盘';
      }
      const slot = String(piece.slot || '').trim();
      const slotLabel = CAVE_SLOT_LABELS[slot] || slot || '未知';
      const effectId = String(piece.effect_id || '').trim();
      const effLabel = CAVE_RUNE_EFFECT_LABELS[effectId] || String(piece.effect || '').trim() || effectId;
      const rt = caveRuneRuntimeMap.value[String(piece.uid || '')] || null;
      const arrows = Array.isArray(piece.arrow_dirs) ? piece.arrow_dirs.map(d => String(d || '').trim().toUpperCase()).filter(Boolean) : [];
      const parts = [];
      parts.push(`卦位：${slotLabel}`);
      if (arrows.length > 0) parts.push(`指向：${arrows.map((d) => CAVE_ARROW_SYMBOLS[d] || d).join(' ')}`);
      if (effLabel) parts.push(`核心效果：${effLabel}`);
      const rollPct = rt ? Number(rt.effect_roll_pct || piece.effect_roll_pct || 0) : Number(piece.effect_roll_pct || 0);
      if (rollPct > 0) parts.push(`品质浮动加成 +${rollPct}%`);
      const detail = buildRuneEffectDetail(effectId, rt, rollPct);
      if (detail) parts.push(`具体效果：${detail}`);
      return parts.join('。') || '基础阵纹';
    }

    function _findCavePieceByUid(uid) {
      const target = String(uid || '').trim();
      if (!target) return null;
      const formation = caveState.formation || {};
      const pools = [formation.plate_pool, formation.rune_pool, formation.board];
      for (const list of pools) {
        for (const piece of (Array.isArray(list) ? list : [])) {
          if (!piece || typeof piece !== 'object') continue;
          if (String(piece.uid || '') === target) return piece;
        }
      }
      return null;
    }

    async function caveDecomposePlate(pieceUid) {
      if (caveFormationBusy.value || caveState.loading) return;
      const uid = String(pieceUid || '').trim();
      if (!uid) return;
      const piece = _findCavePieceByUid(uid);
      const pieceName = String(piece?.name || '阵盘');
      if (!confirm(`确定分解「${pieceName}」？将随机获得 1 个二阶材料，此操作不可撤销。`)) return;
      const r = await _runCaveFormationAction(() => api.caveFormationDecomposePlate(uid));
      if (!r) return;
      const rewardName = String(r?.reward?.item_name || '二阶材料');
      showToast(`分解成功：${rewardName} x1`);
    }

    async function caveDecomposeRune(pieceUid) {
      if (caveFormationBusy.value || caveState.loading) return;
      const uid = String(pieceUid || '').trim();
      if (!uid) return;
      const piece = _findCavePieceByUid(uid);
      const pieceName = String(piece?.name || '阵纹');
      if (!confirm(`确定分解「${pieceName}」？将随机获得 1 个一阶材料，此操作不可撤销。`)) return;
      const r = await _runCaveFormationAction(() => api.caveFormationDecomposeRune(uid));
      if (!r) return;
      const rewardName = String(r?.reward?.item_name || '一阶材料');
      showToast(`分解成功：${rewardName} x1`);
    }

    async function caveSetMainService(skillId, active, instanceKey = '') {
      const sid = String(skillId || '').trim();
      if (!sid) return;
      const ik = String(instanceKey || '').trim();
      const r = await _runCaveFormationAction(() => api.caveFormationServiceSet(sid, !!active, ik));
      if (!r) return;
      showToast(active ? '主阵已开启' : '主阵已关闭');
    }

    async function caveRotateBoardPiece(index) {
      if (caveFormationBusy.value || caveState.loading) return;
      const idx = Math.floor(Number(index));
      if (idx < 0 || idx >= caveBoardCellCount.value) return;
      const piece = caveCellPiece(idx);
      if (!piece || String(piece.item_type || '') !== 'array_plate') {
        showToast('阵纹不可旋转');
        return;
      }
      const r = await _runCaveFormationAction(() => api.caveFormationRotate(idx, 1));
      if (!r) return;
      showToast('已旋转');
    }

    async function caveClearBoard() {
      if (caveFormationBusy.value || caveState.loading) return;
      if (!confirm('确定一键清空阵图？将把阵盘与阵纹全部收回到对应栏位。')) return;
      const r = await _runCaveFormationAction(() => api.caveFormationClear());
      if (!r) return;
      showToast(`已清空阵图（收回${Number(r.moved_count || 0)}个部件）`);
      clearCaveTapSource();
      clearCaveDragSource();
    }

    async function _runCaveFormationAction(action) {
      if (caveFormationBusy.value || caveState.loading) return false;
      caveFormationBusy.value = true;
      try {
        const r = await action();
        if (!r || !r.ok) {
          showToast(r?.error || '阵法操作失败');
          return null;
        }
        applyCaveStatus(r, false);
        if (r.player) applyPlayer(r.player);
        return r;
      } catch (e) {
        showToast(e.message || '阵法操作失败');
        return null;
      } finally {
        caveFormationBusy.value = false;
      }
    }

    async function caveDropOnBoard(targetIndex, ev) {
      caveAllowDrop(ev);
      const target = Math.floor(Number(targetIndex));
      if (target < 0 || target >= caveBoardCellCount.value) {
        caveDragEnd();
        return;
      }
      const srcZone = String(caveDragState.source_zone || '');
      try {
        if (srcZone === 'board') {
          const from = Math.floor(Number(caveDragState.source_index));
          if (from < 0 || from >= caveBoardCellCount.value || from === target) return;
          await _runCaveFormationAction(() => api.caveFormationMove(from, target));
          return;
        }
        if (srcZone === 'plate_pool' || srcZone === 'rune_pool') {
          const uid = String(caveDragState.source_uid || '').trim();
          if (!uid) return;
          await _runCaveFormationAction(() => api.caveFormationPlace(uid, target));
        }
      } finally {
        caveDragEnd();
      }
    }

    async function caveDropToPool(poolType, ev) {
      caveAllowDrop(ev);
      const srcZone = String(caveDragState.source_zone || '');
      try {
        if (srcZone !== 'board') return;
        const sourceIndex = Math.floor(Number(caveDragState.source_index));
        if (sourceIndex < 0 || sourceIndex >= caveBoardCellCount.value) return;
        const piece = caveCellPiece(sourceIndex);
        if (!piece) return;
        const expectType = String(poolType || '') === 'rune' ? 'array_rune' : 'array_plate';
        if (String(piece.item_type || '') !== expectType) {
          showToast(expectType === 'array_rune' ? '阵盘不能放入阵纹栏' : '阵纹不能放入阵盘栏');
          return;
        }
        const occ = caveBoardOccupyMap.value[sourceIndex];
        const anchorIndex = occ ? Math.max(0, Number(occ.anchor_index || sourceIndex)) : sourceIndex;
        await _runCaveFormationAction(() => api.caveFormationPick(anchorIndex));
      } finally {
        caveDragEnd();
      }
    }

    async function caveTapCell(index) {
      if (caveFormationBusy.value || caveState.loading) return;
      const idx = Math.floor(Number(index));
      if (idx < 0 || idx >= caveBoardCellCount.value) return;
      if (!caveTapState.source_zone) {
        if (caveCellOccupied(idx)) caveSelectBoardPiece(idx);
        return;
      }
      if (caveTapState.source_zone === 'board') {
        const from = Math.floor(Number(caveTapState.source_index));
        if (from === idx) {
          clearCaveTapSource();
          return;
        }
        const r = await _runCaveFormationAction(() => api.caveFormationMove(from, idx));
        if (r) clearCaveTapSource();
        return;
      }
      const uid = String(caveTapState.source_uid || '').trim();
      if (!uid) {
        clearCaveTapSource();
        return;
      }
      const r = await _runCaveFormationAction(() => api.caveFormationPlace(uid, idx));
      if (r) clearCaveTapSource();
    }

    async function caveTapRecycle(poolType) {
      if (caveFormationBusy.value || caveState.loading) return;
      if (caveTapState.source_zone !== 'board') return;
      const sourceIndex = Math.floor(Number(caveTapState.source_index));
      if (sourceIndex < 0 || sourceIndex >= caveBoardCellCount.value) return;
      const piece = caveCellPiece(sourceIndex);
      if (!piece) return;
      const expectType = String(poolType || '') === 'rune' ? 'array_rune' : 'array_plate';
      if (String(piece.item_type || '') !== expectType) {
        showToast(expectType === 'array_rune' ? '该部件应回收到阵盘栏' : '该部件应回收到阵纹栏');
        return;
      }
      const occ = caveBoardOccupyMap.value[sourceIndex];
      const anchorIndex = occ ? Math.max(0, Number(occ.anchor_index || sourceIndex)) : sourceIndex;
      const r = await _runCaveFormationAction(() => api.caveFormationPick(anchorIndex));
      if (r) clearCaveTapSource();
    }

    async function caveRefresh() {
      caveState.loading = true;
      try {
        const r = await api.caveStatus();
        if (r.ok) {
          applyCaveStatus(r, false);
          if (r.settle_report?.auto_stopped) showToast('灵气已枯竭，采集已自动停止');
          if (Number(r.settle_report?.main_spirit_gained || 0) > 0) showToast(`主阵产出灵石 +${Number(r.settle_report.main_spirit_gained || 0)}`);
          if (r.settle_report?.drops?.length) caveReport.value = r.settle_report;
        } else {
          caveState.loading = false;
        }
      } catch {
        caveState.loading = false;
      }
    }
    async function caveStart(type) {
      caveState.loading = true;
      const r = await api.caveStart(type);
      if (r.ok) {
        applyCaveStatus(r, false);
        showToast('开始采集');
      } else {
        showToast(r.error || '失败');
        caveState.loading = false;
      }
    }
    async function caveStop() {
      caveState.loading = true;
      const r = await api.caveStop();
      if (r.ok) {
        applyCaveStatus(r, false);
        const mainGain = Number(r.report?.main_spirit_gained || 0);
        if (r.report && r.report.drops && r.report.drops.length > 0) caveReport.value = r.report;
        if (mainGain > 0) showToast(`主阵产出灵石 +${mainGain}`);
        else if (!(r.report && r.report.drops && r.report.drops.length > 0)) showToast('采集已停止');
        if (r.player) applyPlayer(r.player);
      } else {
        showToast(r.error || '失败');
        caveState.loading = false;
      }
    }
    async function caveUpgrade() {
      if (!confirm(`确定升级洞府？需要 ${caveState.upgrade_cost} 灵石`)) return;
      caveState.loading = true;
      const r = await api.caveUpgrade();
      if (r.ok) {
        applyCaveStatus(r, false);
        showToast('洞府升级成功！');
        if (r.player) applyPlayer(r.player);
      } else {
        showToast(r.error || '升级失败');
        caveState.loading = false;
      }
    }
    // ─── 传人 ───
    const DISC_BATTLE_ENABLED = false; // 传人比拼入口开关，暂时关停
    const discState = reactive({
      hasDisciple: false,
      disciple: null,
      material_types: [],
      loading: false,
      createName: '',
      sendMapId: 0,
      sendMaterial: '',
      equipSlot: '',
      discipleSubTab: 'explore',
    });
    async function discRefresh() {
      discState.loading = true;
      try {
        const r = await api.discipleStatus();
        if (r.ok) {
          discState.hasDisciple = r.hasDisciple;
          discState.disciple = r.disciple;
          discState.material_types = r.material_types || [];
          if (r.auto_delivered && r.auto_delivered.length > 0) {
            showToast('传人体力耗尽自动返回，带回了 ' + r.auto_delivered.reduce((s, c) => s + c.count, 0) + ' 件材料');
            doSync();
          }
        }
      } catch {}
      discState.loading = false;
    }
    async function discCreate() {
      if (!discState.createName.trim()) return showToast('请输入传人名字');
      const r = await api.discipleCreate(discState.createName.trim());
      if (r.ok) { showToast('传人已创建'); discRefresh(); }
      else showToast(r.error || '创建失败');
    }
    async function discEquip(slot, page, slotIndex) {
      const r = await api.discipleEquip(slot, page, slotIndex);
      if (r.ok) { discRefresh(); if (r.player) applyPlayer(r.player); showToast('装备成功'); }
      else showToast(r.error || '装备失败');
    }
    async function discUnequip(slot) {
      const r = await api.discipleUnequip(slot);
      if (r.ok) { discRefresh(); if (r.player) applyPlayer(r.player); showToast('已卸下'); }
      else showToast(r.error || '卸下失败');
    }
    async function discSend() {
      if (!discState.sendMapId) return showToast('请选择地图');
      if (!discState.sendMaterial) return showToast('请选择材质');
      const r = await api.discipleSend(discState.sendMapId, discState.sendMaterial);
      if (r.ok) { showToast('传人已出发'); discRefresh(); }
      else showToast(r.error || '派遣失败');
    }
    async function discRecall() {
      const r = await api.discipleRecall();
      if (r.ok) {
        const total = (r.delivered || []).reduce((s, c) => s + c.count, 0);
        showToast(total > 0 ? `传人归来，带回了 ${total} 件材料` : '传人归来，空手而归');
        discRefresh();
        if (r.player) applyPlayer(r.player);
      } else showToast(r.error || '召回失败');
    }
    const DISC_EQUIP_SLOTS = ['weapon','head','shoulder','chest','legs','hands','ring','amulet','back'];
    const DISC_SLOT_NAMES = { weapon:'武器',head:'头部',shoulder:'肩部',chest:'衣服',legs:'下装',hands:'护手',ring:'戒指',amulet:'项链',back:'披风' };
    /** 传人可探索的地图：不高于玩家1阶级 */
    const discExplorableMaps = computed(() => {
      const maps = gameData.maps || [];
      const playerTier = getRealmTier(player.level || 1);
      const maxTier = playerTier + 1;
      return maps.filter(m => getRealmTier(m.level || 1) <= maxTier);
    });

    // ─── 传人比拼 ───
    const discEquipPick = reactive({ 0: '', 1: '', 2: '', 3: '' });
    const discBattleState = reactive({
      subTab: 'raise',
      discipleSubTab: 'explore',
      status: null,
      loading: false,
      matching: false,
      roomId: null,
      battleState: null,
      playerIndex: -1,
      drawCost: 5000,
    });
    const discBattleCountdown = ref(30);
    let _discBattleTimerId = null;
    const DISC_TYPE_NAMES = { normal:'无', fire:'火', water:'水', grass:'木', ground:'土', steel:'金', psychic:'混元' };
    function _startDiscBattleTimer() {
      _clearDiscBattleTimer();
      const bs = discBattleState.battleState;
      if (!bs || bs.phase !== 'choose' || !bs.turn_deadline_ms) return;
      _updateDiscBattleCountdown();
      _discBattleTimerId = setInterval(_updateDiscBattleCountdown, 500);
    }
    function _clearDiscBattleTimer() {
      if (_discBattleTimerId) { clearInterval(_discBattleTimerId); _discBattleTimerId = null; }
    }
    function _updateDiscBattleCountdown() {
      const bs = discBattleState.battleState;
      if (!bs || !bs.turn_deadline_ms) { discBattleCountdown.value = 0; return; }
      const left = Math.max(0, Math.ceil((bs.turn_deadline_ms - Date.now()) / 1000));
      discBattleCountdown.value = left;
      if (left <= 0) _clearDiscBattleTimer();
    }
    function discBattleOnMatched(roomId, state, playerIndex) {
      discBattleState.roomId = roomId;
      discBattleState.battleState = state;
      discBattleState.playerIndex = (playerIndex !== undefined && playerIndex >= 0) ? playerIndex : -1;
      discBattleState.matching = false;
      showToast('匹配成功！对战开始');
      if (state?.phase === 'choose') _startDiscBattleTimer();
    }
    function discBattleOnUpdate(roomId, state) {
      if (discBattleState.roomId === roomId) {
        discBattleState.battleState = state;
        if (state?.phase === 'choose') _startDiscBattleTimer();
        else _clearDiscBattleTimer();
      }
    }
    window.discBattleOnMatched = discBattleOnMatched;
    window.discBattleOnUpdate = discBattleOnUpdate;
    async function discBattleLoad() {
      discBattleState.loading = true;
      try {
        const r = await api.discipleBattleStatus();
        if (r?.ok) {
          discBattleState.status = r;
          discBattleState.drawCost = r.draw_cost || 5000;
        } else {
          discBattleState.status = null;
        }
      } catch {
        discBattleState.status = null;
      }
      discBattleState.loading = false;
    }
    async function discBattleDraw() {
      if (Math.floor(Number(player.spirit_stones) || 0) < discBattleState.drawCost) return showToast(`灵石不足，需要${discBattleState.drawCost}`);
      discBattleState.loading = true;
      try {
        const r = await api.discipleBattleDraw();
        if (r.ok) {
          applyPlayer(r.player);
          if (r.success && r.skill) {
            showToast(`学会了「${r.skill.name}」！`);
          } else {
            showToast(r.message || '抽取失败');
          }
          await discBattleLoad();
        } else showToast(r.error || '抽取失败');
      } catch (e) { showToast(e.message || '失败'); }
      discBattleState.loading = false;
    }
    async function discBattleEquip(slotIndex, sourceId) {
      try {
        const r = await api.discipleBattleEquip(slotIndex, sourceId);
        if (r.ok) { await discBattleLoad(); showToast('装备成功'); }
        else showToast(r.error || '装备失败');
      } catch (e) { showToast(e.message || '失败'); }
    }
    async function discBattleUnequip(slotIndex) {
      try {
        const r = await api.discipleBattleUnequip(slotIndex);
        if (r.ok) { await discBattleLoad(); showToast('已卸下'); }
        else showToast(r.error || '卸下失败');
      } catch (e) { showToast(e.message || '失败'); }
    }
    function discBattleEquipFromWarehouse(sourceId) {
      const eq = discBattleState.status?.equipped_skills_detail || [];
      if (eq.some(x => x && x.sourceId === sourceId)) return showToast('该秘籍已装备');
      const emptyIdx = eq.findIndex(x => !x || !x.sourceId);
      if (emptyIdx < 0) return showToast('出战槽位已满，请先卸下');
      discBattleEquip(emptyIdx, sourceId);
    }
    async function discBattleShopBuy(pillId) {
      try {
        const r = await api.discipleBattleShopBuy(pillId);
        if (r.ok) {
          if (r.player) applyPlayer(r.player);
          if (r.message) { showToast(r.message); }
          else {
            const pill = (discBattleState.status?.shop_pills || []).find(p => p.id === pillId);
            const statNames = { hp:'HP', atk:'物攻', def:'物防', spa:'特攻', spd:'特防', speed:'速度' };
            showToast(pill ? `${pill.name}，${statNames[pill.stat]||pill.stat}+${r.added ?? pill.add}` : '购买成功');
          }
          await discBattleLoad();
        } else showToast(r.error || '购买失败');
      } catch (e) { showToast(e.message || '失败'); }
    }
    async function discBattlePointsShopBuy(itemId) {
      try {
        const r = await api.discipleBattlePointsShopBuy(itemId);
        if (r.ok) {
          if (r.player) applyPlayer(r.player);
          const names = (r.results || []).filter(x => x.added).map(x => `${x.name}x${x.count}`).join('、');
          showToast(names ? `获得: ${names}` : '购买成功');
          await discBattleLoad();
        } else showToast(r.error || '购买失败');
      } catch (e) { showToast(e.message || '失败'); }
    }
    async function discBattleMatch() {
      if (discBattleState.matching) return;
      discBattleState.matching = true;
      try {
        const r = await api.discipleBattleMatch();
        if (r.ok) {
          if (r.status === 'matched') {
            discBattleOnMatched(r.roomId, r.state, 1);
          } else {
            showToast('正在匹配中...');
          }
        } else { discBattleState.matching = false; showToast(r.error || '匹配失败'); }
      } catch (e) { discBattleState.matching = false; showToast(e.message || '失败'); }
    }
    async function discBattleCancelMatch() {
      await api.discipleBattleCancelMatch();
      discBattleState.matching = false;
      showToast('已取消匹配');
    }
    async function discBattleAction(skillSourceId) {
      if (!discBattleState.roomId || !discBattleState.battleState) return;
      try {
        const r = await api.discipleBattleAction(discBattleState.roomId, skillSourceId);
        if (r.ok) {
          discBattleState.battleState = r.state;
          if (r.state?.phase === 'choose') _startDiscBattleTimer();
          else _clearDiscBattleTimer();
        }
        else showToast(r.error || '行动失败');
      } catch (e) { showToast(e.message || '失败'); }
    }
    function discBattleExit() {
      _clearDiscBattleTimer();
      discBattleState.roomId = null;
      discBattleState.battleState = null;
      discBattleState.playerIndex = -1;
      discBattleLoad();
    }
    const discBattleAllPpZero = computed(() => {
      const bs = discBattleState.battleState;
      if (!bs || discBattleState.playerIndex < 0) return false;
      const me = bs.players?.[discBattleState.playerIndex];
      if (!me || !me.pp || !me.skills?.length) return false;
      return me.skills.every(sid => (me.pp[sid] || 0) <= 0);
    });

    const _BLDG_DESC = {
      statue: (lv) => '祈福奖池 Lv.' + lv,
      spirit_pool: (lv) => '属性加成 ' + (1 + (lv - 1) * 4 / 9).toFixed(1) + '%',
      garden: (lv) => {
        const maxT = lv >= 9 ? 6 : (lv >= 5 ? 5 : 4);
        return '产出 3-' + maxT + ' 阶材料';
      },
      enlightenment_tree: (lv) => '经验加成 ' + (1 + (lv - 1) * 3 / 9).toFixed(1) + '%',
      treasury: (lv) => '宝阁等级 Lv.' + lv,
      gate: (lv) => '成员上限 ' + (50 + (lv - 1) * 30) + ' 人',
    };
    const _BLDG_NEXT = {
      statue: (_lv) => '扩充祈福奖池',
      spirit_pool: (lv) => '属性加成→' + (1 + lv * 4 / 9).toFixed(1) + '%',
      garden: (lv) => {
        const nextLv = lv + 1;
        const maxT = nextLv >= 9 ? 6 : (nextLv >= 5 ? 5 : 4);
        const cur = lv >= 9 ? 6 : (lv >= 5 ? 5 : 4);
        let s = '产出 3-' + maxT + ' 阶材料';
        if (maxT > cur) s += '（解锁' + maxT + '阶）';
        return s;
      },
      enlightenment_tree: (lv) => '经验加成→' + (1 + lv * 3 / 9).toFixed(1) + '%',
      treasury: (_lv) => '提升宝阁可兑换物品',
      gate: (lv) => '成员上限→' + (50 + lv * 30) + ' 人',
    };
    function buildingCurrentDesc(key, lv) { return (_BLDG_DESC[key] || (() => ''))(lv); }
    function buildingNextDesc(key, lv) { return (_BLDG_NEXT[key] || (() => ''))(lv); }

    return {
      view, player, toast, isOnline, loginForm, isRegister, doLogin, doLogout, emailBound,
      forgotMode, forgotForm, forgotSendCode, forgotReset, exitForgot,
      agreementModalOpen, closeAgreementModal,
      createForm, createPointsLeft, doCreate,
      activeTab, tabs, mapSubTab, mapListBySubTab,
      charRealm, charStage, breakthroughConditionTooltip, doLevelUp, doBreakthrough,
      MINGTU_NODES, MINGTU_LINKS, MINGTU_ELEMENTS, mingtuLineKey, mingtuNodesByLine, mingtuLinksByLine,
      mingtuUnlock, mingtuReset, getMingtuNodeLevel, mingtuModalOpen, mingtuAvailablePoints,
      mingtuNodeClass, mingtuNodeStyle, mingtuLinkAttrs, canUnlockMingtuNode, mingtuNodeDetail,
      battleState, battleStats, resetBattleStats, startBattle, pollBattle, selectMap, showMapInfo, autoBattle, toggleAutoBattle,
      invPage, invPageCount, getInvSlot, selectedInvSlot, selectInvSlot, getItemStat,
      invLogs, showInvLog, addInvLog,
      doUseItem, doSellItem, doSortInv, doEquipFromInv, doDecompose, toggleEquipLock,
      EQUIP_SLOTS, EQUIP_SLOT_NAMES, getEquipped, doUnequip, isEquipBuyOrder, isEquipType,
      learnedSkills, toggleSkillEquip, doSetKeySkill, isSkillEquipped,
      learnedTechniques, setTechnique,
      mails, loadMails, claimMail, claimAllMail,
      presetName, PRESETS, SECT_TIER_NAMES, presetEquipCount, presetKeySkillId,
      setTalisman,
      trialSubTab,
      trialState, startTrial, advanceTrial, autoTrial,
      trialContractState, trialContractSelectedScore, trialContractRewardPreview, trialContractDungeonMultiplier,
      loadTrialContracts, toggleTrialContractModifier, startTrialContract, advanceTrialContract, autoTrialContract,
      trialShopState, trialShopPage, trialShopPageCount, trialShopPagedGoods,
      setTrialShopPage, loadTrialShop, setTrialShopQty, getTrialShopQty, buyTrialShop,
      alchemyVisibleRecipes,
      craftSearchKeyword, talismanSearchKeyword, craftFilteredRecipes, talismanRecipes,
      EX_WEAPONS, EX_SETS,
      invPicker, openInvPicker, selectInvPicker, confirmInvPicker, backInvPicker, closeInvPicker,
      sectBasicArmorType, dungTeamJoinCode, dungCreateId, selectedDungeon, selectDungeon,
      batchDecomposeModal, openBatchDecompose, toggleBatchDecomposeSelect, isBatchDecomposeSelected, doBatchDecompose,
      forgeSelected, upgradeSelected, affixUpgradeSelected, rerollSelected, rerollTierSelected, inheritSelected, zaohuaSelected, listingSelected,
      rerollLocked, rerollCost, toggleRerollLock, doReroll, rerolling, rerollTierAffixes, selectedRerollTierAffix, rerollTierMaterialQuality, rerollTierDistribution, rerollTierEstimate, doRerollAffixTier, rerollTierRolling, inheritCost, inheritEstimate, inheriting, doInherit, zaohuaing, doZaohua, isZaohuaLocked, fmtAffixStat,
      pickForgeMain, pickForgeLing, pickForgeCat, pickUpgradeTarget, pickUpgradeMat, pickAffixUpgradeTarget, pickAffixUpgradeMat,
      pickInheritSource, pickInheritTarget, pickInheritMaterial,
      pickZaohuaTarget, selectAffixUpgradeIndex, doAffixUpgrade,
      pickRerollTarget, pickRerollLing, pickRerollTierMaterial, selectRerollTierAffix, pickSectContrib, pickAlliDonate, pickWhDeposit, pickWhDeposit2, pickEqFulfill, pickListing, pickBuyBarterPay,
      cityShopItems, jobTimeLeft,
      baiyiTab, forgeSubTab, upgradeForm, affixUpgradeForm, rerollForm, rerollTierForm, inheritForm, zaohuaForm,
      forgingType, forgingMainId, forgingMainCount, forgingLingId, forgingCatalystId,
      buildingCurrentDesc, buildingNextDesc,
      sect, alch, exch, alli, dung, duel, league, sett,
      sectSkills, sectTechniques,
      listingForm, doCreateListing, upgradeEstimate, affixUpgradeAffixes, selectedAffixForUpgrade, affixUpgradeEstimate,
      gameData, getItem, getSkill, getTech,
      fmtSkillFull, fmtTechFull, fmtItemFull, fmtItemEffect, fmtSkillEffect, fmtTechEffect, fmtTechPassive, fmtAffix, fmtEquipmentDetail,
      formatNumber, qualityColor, qualityName, itemTierLine, getRealm, getRealmStage, allianceRankName, mapDropMetaById, mapTooltipById, getMapDropsPreview, hasMapDropsPreview, getMapDropsPreviewText, getSpiritRootVal, currentMap, getCurrentMap, getMapTooltip, getSectName, getRerollLockArr, fmtMailAttach, countItemInInv,
      showToast, doSync: doSync, loadGameData,
      DICTIONARY_ENTRIES, dictCategory, dictPage, dictPageCount, dictPageEntries, dictFiltered, DICT_PAGE_SIZE,
      wipeConfirm, doWipe, renameInput, doRename, darkTheme, toggleTheme,
      itemTooltip, showItemTooltip, hideItemTooltip, cancelHideTooltip, itemTouchStart, itemTouchEnd,
      offlineReport, formatDuration, formatLastOnline,
      caveSubTab,
      caveState, caveReport, caveRefresh, caveStart, caveStop, caveUpgrade,
      caveMainServiceRows, caveMainServiceHourlyTotal, caveYanmianServiceActive,
      caveFormationFlowSummary,
      caveFormationDecaySummary, caveFormationTotalBonusSummary,
      caveFormationBusy, caveDragState, caveTapState,
      cavePlateShapeFilter, cavePlateShapeOptions, caveFilteredPlatePool,
      cavePlatePage, cavePlatePageCount, cavePagedPlatePool, setCavePlatePage,
      caveRuneKeywordFilter, caveRuneArrowFilter,
      caveRuneKeywordOptions, caveRuneArrowOptions, caveFilteredRunePool,
      caveRunePage, caveRunePageCount, cavePagedRunePool, setCaveRunePage,
      caveBoardCellCount, caveBoardGridStyle,
      caveCellPiece, caveCellOccupied, caveCellAnchor,
      caveAllowDrop, cavePoolDragStart, caveBoardDragStart, caveDropOnBoard, caveDropToPool, caveDragEnd,
      caveTapCell, caveTapRecycle, caveSelectPoolPiece, caveSelectBoardPiece,
      caveIsSelectedPoolPiece, caveIsSelectedBoardIndex,
      caveRuneKeywordTag, caveRuneArrowTags,
      cavePieceTypeLabel, cavePieceMeta,
      caveRotateBoardPiece, caveClearBoard,
      caveDecomposePlate, caveDecomposeRune, caveSetMainService,
      discState, discRefresh, discCreate, discEquip, discUnequip, discSend, discRecall,
      discExplorableMaps,
      DISC_BATTLE_ENABLED,
      DISC_EQUIP_SLOTS, DISC_SLOT_NAMES,
      discEquipPick,
      discBattleAllPpZero, discBattleCountdown, DISC_TYPE_NAMES,
      discBattleState, discBattleLoad, discBattleDraw, discBattleEquip, discBattleUnequip, discBattleEquipFromWarehouse, discBattleShopBuy, discBattlePointsShopBuy, discBattleMatch, discBattleCancelMatch, discBattleAction, discBattleExit,
      helpModal, helpBaiyiHtml, helpAffixHtml,
    };
  }
});

app.mount('#app');
