import api from './api.js?v=20260416b';
const { ref, reactive, computed } = Vue;

let _showToast = () => {};
let _applyPlayer = () => {};
let _doSync = () => {};
let _player = {};
let _gameData = {};
let _getItem = () => null;

export function initPanels(ctx) {
  _showToast = ctx.showToast;
  _applyPlayer = ctx.applyPlayer;
  _doSync = ctx.doSync;
  _player = ctx.player;
  _gameData = ctx.gameData;
  if (ctx.getItem) _getItem = ctx.getItem;
}

async function safe(fn) {
  try { return await fn(); } catch (e) { _showToast(e.message || '操作失败'); return null; }
}

function isBattleSessionTerminalError(msg) {
  const s = String(msg || '');
  if (!s) return false;
  return s.includes('不存在') || s.includes('已过期') || s.includes('无效');
}

function isBattleSessionAuthError(msg) {
  const s = String(msg || '');
  if (!s) return false;
  return s.includes('登录已过期') || s.includes('未登录') || s.includes('token');
}

function formatBattleAdvanceError(msg) {
  const s = String(msg || '').trim();
  if (!s) return '推进失败';

  // 客户端 fetch 常见网络异常文本
  if (s.includes('Failed to fetch') || s.includes('NetworkError') || s.includes('网络错误') || s.includes('ERR_NETWORK')) {
    return '网络波动：与服务器连接中断，请稍后重试';
  }

  // 网关/服务繁忙/超时类
  if (s.includes('502') || s.includes('503') || s.includes('504') || s.includes('timeout') || s.includes('超时') || s.includes('战斗推进异常') || s.includes('请求失败(5') || s.includes('Internal Server Error')) {
    return '服务器繁忙：推进请求超时或拥塞，请稍后重试';
  }

  // 战斗会话或登录态失效
  if (isBattleSessionTerminalError(s) || isBattleSessionAuthError(s)) {
    return `会话失效：${s}`;
  }

  return s;
}

function isBattleAdvanceBackoffError(msg) {
  const s = String(msg || '');
  if (!s) return false;
  return s.includes('过于频繁')
    || s.includes('服务器繁忙')
    || s.includes('超时')
    || s.includes('timeout')
    || s.includes('战斗推进异常')
    || s.includes('请求失败(5')
    || s.includes('Internal Server Error')
    || s.includes('Failed to fetch')
    || s.includes('NetworkError')
    || s.includes('ERR_NETWORK');
}

function nextBattleAdvanceDelayMs(cur) {
  const n = Math.max(0, Math.trunc(Number(cur) || 0));
  if (n < 800) return 800;
  if (n < 1500) return 1500;
  if (n < 3000) return 3000;
  return 3000;
}

function buildTurnQueueText(state) {
  const queue = Array.isArray(state?.turn_queue) ? state.turn_queue : [];
  if (!queue.length) return '';
  const unitByTag = new Map();
  for (const u of (state?.allies || [])) {
    if (u?.tag == null) continue;
    unitByTag.set(u.tag, u);
  }
  for (const u of (state?.enemies || [])) {
    if (u?.tag == null) continue;
    unitByTag.set(u.tag, u);
  }
  return queue.map((tag) => {
    const unit = unitByTag.get(tag);
    return unit ? (unit.name || '?') : String(tag);
  }).join(' → ');
}

function hr(r, okMsg) {
  if (!r) return false;
  if (r.ok) { if (r.player) _applyPlayer(r.player); if (okMsg) _showToast(r.msg || okMsg); return true; }
  if (r.code === 'SLOT_MISMATCH') _doSync();
  _showToast(r.error || '操作失败'); return false;
}

// ═══ 宗门 ═══
export function useSect() {
  const sectSubTab = ref('info');
  const sectCounts = ref({});
  const tasks = ref([]);
  const treasury = ref([]);
  const nextRefreshAt = ref(0);
  const taskCompletionsToday = ref(null);
  const taskDailyLimit = ref(15);
  const nextRefreshCountdown = ref('');
  let _refreshTimer = null;
  function _startRefreshTimer() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => {
      const remain = Math.max(0, nextRefreshAt.value - Math.floor(Date.now() / 1000));
      if (remain <= 0) { nextRefreshCountdown.value = '刷新中…'; clearInterval(_refreshTimer); _refreshTimer = null; loadTasks(); return; }
      const m = Math.floor(remain / 60), s = remain % 60;
      nextRefreshCountdown.value = m > 0 ? `${m}分${s}秒` : `${s}秒`;
    }, 1000);
  }

  const loadCounts = async () => { const r = await safe(() => api.sectMemberCounts()); if (r?.ok) sectCounts.value = r.counts || {}; };
  const join = async (id) => { if (hr(await safe(() => api.sectJoin(id)), '加入宗门成功')) _doSync(); };
  const leave = async () => { if (!confirm('确定离开宗门？将失去宗门技能和功法！')) return; hr(await safe(() => api.sectLeave()), '已离开宗门'); };
  const learn = async (type, id, cost, lvReq, b3, i4) => { hr(await safe(() => api.sectLearn(type, id, cost, lvReq, b3, i4)), '学习成功'); };
  const loadTasks = async () => {
    const r = await safe(() => api.sectTasks());
    if (r?.ok) {
      tasks.value = r.tasks || [];
      if (r.next_refresh_at) { nextRefreshAt.value = r.next_refresh_at; _startRefreshTimer(); }
      if (r.sect_task_completions_today !== undefined) taskCompletionsToday.value = r.sect_task_completions_today;
      if (r.sect_task_daily_limit !== undefined) taskDailyLimit.value = r.sect_task_daily_limit;
      if (r.player) _applyPlayer(r.player);
    }
  };
  const acceptTask = async (i) => { if (hr(await safe(() => api.sectTaskAccept(i)), '已接取')) loadTasks(); };
  const completeTask = async (i) => { if (hr(await safe(() => api.sectTaskComplete(i)), '任务完成！')) loadTasks(); };
  const abandonTask = async (i) => { if (hr(await safe(() => api.sectTaskAbandon(i)), '已放弃')) loadTasks(); };
  const refreshTasks = async () => { if (hr(await safe(() => api.sectTaskRefresh()), '任务刷新（-100灵石）')) loadTasks(); };
  const basicArmor = ref(null);
  const treasuryRefreshAt = ref(0);
  const treasuryRefreshCountdown = ref('');
  const treasuryManualCount = ref(0);
  const treasuryManualLimit = ref(15);
  let _treasuryTimer = null;
  function _startTreasuryTimer() {
    if (_treasuryTimer) clearInterval(_treasuryTimer);
    _treasuryTimer = setInterval(() => {
      const remain = Math.max(0, treasuryRefreshAt.value - Math.floor(Date.now() / 1000));
      if (remain <= 0) { treasuryRefreshCountdown.value = '刷新中…'; clearInterval(_treasuryTimer); _treasuryTimer = null; loadTreasury(); return; }
      const m = Math.floor(remain / 60), s = remain % 60;
      treasuryRefreshCountdown.value = m > 0 ? `${m}分${s}秒` : `${s}秒`;
    }, 1000);
  }
  const loadTreasury = async () => {
    const r = await safe(() => api.sectTreasuryList());
    if (r?.ok) {
      treasury.value = r.goods || []; basicArmor.value = r.basic_armor || null;
      if (r.refresh_at) { treasuryRefreshAt.value = r.refresh_at; _startTreasuryTimer(); }
      if (r.manual_refresh_count !== undefined) treasuryManualCount.value = r.manual_refresh_count;
      if (r.manual_refresh_daily_limit !== undefined) treasuryManualLimit.value = r.manual_refresh_daily_limit;
      if (r.player) _applyPlayer(r.player);
    }
  };
  const buyTreasury = async (idx) => { if (hr(await safe(() => api.sectTreasuryBuy(idx)), '购买成功')) loadTreasury(); };
  const refreshTreasury = async () => { if (hr(await safe(() => api.sectTreasuryRefresh()), '宝库已刷新')) loadTreasury(); };
  const buyBasicWeapon = async () => { hr(await safe(() => api.sectTreasuryBuyBasicWeapon()), '领取成功'); };
  const buyBasicArmor = async (type) => { hr(await safe(() => api.sectTreasuryBuyBasicArmor(type)), '兑换成功'); };
  const selectLundaodian = async (sectId) => { hr(await safe(() => api.sectLundaodianSelect(sectId)), '已选择论道宗门'); };
  const learnLundaodian = async (type, id) => { hr(await safe(() => api.sectLundaodianLearn(type, id)), '学习成功'); };
  const contribute = async (itemId, count) => { hr(await safe(() => api.sectContribute(itemId, count)), '捐献成功'); };

  return {
    sectSubTab, sectCounts, tasks, treasury, basicArmor, nextRefreshAt, nextRefreshCountdown, taskCompletionsToday, taskDailyLimit,
    treasuryRefreshCountdown, treasuryManualCount, treasuryManualLimit,
    loadCounts, join, leave, learn, loadTasks, acceptTask, completeTask, abandonTask,
    refreshTasks, loadTreasury, buyTreasury, refreshTreasury, buyBasicWeapon, buyBasicArmor,
    selectLundaodian, learnLundaodian, contribute,
  };
}

// ═══ 百艺 ═══
export function useAlchemy() {
  const alchemyBatch = ref(1);

  const buildIngredients = (recipe) => {
    if (!recipe?.ingredients) return null;
    const inv = _player.inventory;
    if (!Array.isArray(inv)) return null;
    const used = new Set();
    const _slotId = (slot) => {
      if (!slot) return 0;
      if (slot.item && slot.item.id) return Number(slot.item.id);
      return Number(slot.id) || 0;
    };
    const _slotCount = (slot) => {
      if (!slot) return 0;
      return Number(slot.count) || (slot.item ? 1 : 0);
    };
    const find = (itemId, need) => {
      const targetId = Number(itemId);
      for (let p = 0; p < inv.length; p++) {
        if (!Array.isArray(inv[p])) continue;
        for (let s = 0; s < inv[p].length; s++) {
          const slot = inv[p][s];
          if (_slotId(slot) !== targetId) continue;
          const k = `${p}_${s}`;
          if (used.has(k)) continue;
          if (_slotCount(slot) < need * alchemyBatch.value) continue;
          used.add(k);
          return true;
        }
      }
      return false;
    };
    const sel = {};
    const mainList = recipe.ingredients.main || [];
    if (mainList.length > 0) {
      const m = mainList[0];
      if (!find(m.itemId, m.count)) return null;
      sel.main = { item: { id: m.itemId }, count: m.count };
    }
    const subList = recipe.ingredients.sub || [];
    if (subList.length > 0) {
      sel.sub = [];
      for (const s of subList) {
        if (!find(s.itemId, s.count)) return null;
        sel.sub.push({ item: { id: s.itemId }, count: s.count });
      }
    }
    const catList = recipe.ingredients.catalyst || [];
    if (catList.length > 0) {
      const c = catList[0];
      if (!find(c.itemId, c.count)) return null;
      sel.catalyst = { item: { id: c.itemId }, count: c.count };
    }
    return sel;
  };

  const getMissingMaterials = (recipe) => {
    const inv = _player.inventory;
    const countInInv = (itemId) => {
      let total = 0;
      for (const page of (inv || [])) {
        if (!Array.isArray(page)) continue;
        for (const slot of page) {
          if (!slot?.item) continue;
          if (Number(slot.item.id) === Number(itemId)) total += Number(slot.count) || 1;
        }
      }
      return total;
    };
    const all = [...(recipe.ingredients?.main || []), ...(recipe.ingredients?.sub || []), ...(recipe.ingredients?.catalyst || [])];
    const parts = [];
    for (const m of all) {
      const need = (m.count || 1) * alchemyBatch.value;
      const have = countInInv(m.itemId);
      if (have < need) {
        const name = _getItem(m.itemId)?.name || `物品${m.itemId}`;
        parts.push(`${name}缺${need - have}个`);
      }
    }
    return parts.length ? '缺少: ' + parts.join('，') : '材料不足';
  };
  const startAlchemy = async (recipe) => {
    const ingredients = buildIngredients(recipe);
    if (!ingredients) { _showToast(getMissingMaterials(recipe)); return; }
    hr(await safe(() => api.alchemyStart(ingredients, alchemyBatch.value)), '开始炼丹');
  };
  const startCraft = async (recipeId) => {
    hr(await safe(() => api.baiyiCraftStart(recipeId, alchemyBatch.value)), '开始制作');
  };
  const startArrayCraft = async (arrayType) => {
    if (String(arrayType || '').toLowerCase() === 'rune') {
      _showToast('阵纹已改为掉落获取：野外按地图阶段0.001%~0.05%概率掉落，或挑战阵法副本');
      return null;
    }
    hr(await safe(() => api.baiyiArrayStart('plate')), '开始刻制阵盘');
  };
  const startForging = async (equipType, mainItemId, mainCount, lingItemId, catalystItemId) => {
    hr(await safe(() => api.forgingStart(equipType, mainItemId, mainCount, lingItemId, catalystItemId)), '开始锻造');
  };
  const upgradeEquip = async (equipPage, equipSlot, matId, matCount, mode, expectItemId = 0) => {
    hr(await safe(() => api.forgingUpgrade(equipPage, equipSlot, matId, matCount, mode, expectItemId)), '升品完成');
  };
  const upgradeAffix = async (equipPage, equipSlot, affixIndex, matId, matCount, mode, affixMode = 'upgrade', expectItemId = 0) => {
    const actionText = String(affixMode || '') === 'downgrade' ? '词缀降阶' : '词缀升品';
    const r = await safe(() => api.forgingUpgradeAffix(equipPage, equipSlot, affixIndex, matId, matCount, mode, affixMode, expectItemId));
    if (!r) return null;
    if (!r.ok) {
      if (r.code === 'SLOT_MISMATCH') _doSync();
      _showToast(r.error || `${actionText}失败`);
      return r;
    }
    if (r.player) _applyPlayer(r.player);
    if (r.success) _showToast(`${actionText}成功`);
    else _showToast(`${actionText}失败（成功率${Math.round((Number(r.chance) || 0) * 100)}%）`);
    return r;
  };
  const rerollEquip = async (equipPage, equipSlot, lingId, lockIndices, expectItemId = 0) => {
    hr(await safe(() => api.forgingReroll(equipPage, equipSlot, lingId, lockIndices, expectItemId)), '精锻完成');
  };
  const rerollAffixTier = async (equipPage, equipSlot, affixIndex, materialItemId, expectItemId = 0) => {
    const r = await safe(() => api.forgingRerollAffixTier(equipPage, equipSlot, affixIndex, materialItemId, expectItemId));
    if (!r) return null;
    if (!r.ok) {
      if (r.code === 'SLOT_MISMATCH') _doSync();
      _showToast(r.error || '区间精锻失败');
      return r;
    }
    if (r.player) _applyPlayer(r.player);
    const oldTier = Number(r.old_tier || 0);
    const newTier = Number(r.new_tier || 0);
    if (oldTier > 0 && newTier > 0) _showToast(`区间精锻完成（T${oldTier}→T${newTier}）`);
    else _showToast('区间精锻完成');
    return r;
  };
  const inheritEquip = async (sourceEquipPage, sourceEquipSlot, targetEquipPage, targetEquipSlot, materialItemId, expectSourceItemId = 0, expectTargetItemId = 0) => {
    const r = await safe(() => api.forgingInherit(sourceEquipPage, sourceEquipSlot, targetEquipPage, targetEquipSlot, materialItemId, expectSourceItemId, expectTargetItemId));
    if (!r) return null;
    if (!r.ok) {
      if (r.code === 'SLOT_MISMATCH') _doSync();
      _showToast(r.error || '继承失败');
      return r;
    }
    if (r.player) _applyPlayer(r.player);
    _showToast(r.msg || '装备继承完成');
    return r;
  };

  const zaohuaEquip = async (equipPage, equipSlot, expectItemId = 0) => {
    const r = await safe(() => api.forgingZaohua(equipPage, equipSlot, expectItemId));
    if (!r) return null;
    if (!r.ok) {
      if (r.code === 'SLOT_MISMATCH') _doSync();
      _showToast(r.error || '造化失败');
      return r;
    }
    if (r.player) _applyPlayer(r.player);
    _showToast(r.msg || '造化完成');
    return r;
  };

  return { alchemyBatch, startAlchemy, startCraft, startArrayCraft, startForging, upgradeEquip, upgradeAffix, rerollEquip, rerollAffixTier, inheritEquip, zaohuaEquip };
}

// ═══ 坊市 ═══
const EQUIP_TYPES_SET = new Set(['weapon','head','shoulder','chest','legs','hands','ring','amulet','back']);
const WEAPON_SUBTYPES = ['剑','刀','长兵','弓','拳爪','音律','节杖'];
const ARMOR_SUBTYPES = {head:'头盔',shoulder:'肩甲',chest:'胸甲',legs:'腿甲',hands:'护手',ring:'戒指',amulet:'项链',back:'披风'};
const MATERIAL_SUBTYPES = ['内丹','土石','液体','玉质','皮质','草木','金属'];
function _itemCategory(snap) {
  if (!snap) return '';
  if (snap.equipment_criteria) return 'equip';
  const t = String(snap.type || '');
  if (EQUIP_TYPES_SET.has(t)) return 'equip';
  if (t === 'material') return 'material';
  if (t === 'herb' || t === 'medicine') return 'herb';
  if (t === 'book') return 'book';
  if (t === 'talisman') return 'talisman';
  if (t === 'consumable') return 'consumable';
  return 'consumable';
}
export function useExchange() {
  const rawListings = ref([]);
  const myListings = ref([]);
  const myOrderFilter = ref('sell');
  const filteredMyListings = computed(() => {
    const side = myOrderFilter.value;
    return (myListings.value || []).filter(l => String(l.side || 'sell') === side);
  });
  const exPage = ref(1);
  const exTotal = ref(0);
  const exSide = ref('sell');
  const exKeyword = ref('');
  const equipFulfillId = ref(null);
  const equipFulfillPage = ref(0);
  const equipFulfillSlot = ref(0);
  const sellQuote = ref(null);
  const buyQuote = ref(null);
  const equipBuyQuote = ref(null);
  const quoteError = reactive({ sell: '', buy: '', equip: '' });

  const filterQuality = ref(0);
  const filterCategory = ref('');
  const filterSubtype = ref('');
  const subtypeOptions = computed(() => {
    const cat = filterCategory.value;
    if (cat === 'equip') return WEAPON_SUBTYPES.map(s => ({k:s,v:s})).concat(Object.entries(ARMOR_SUBTYPES).map(([k,v]) => ({k,v})));
    if (cat === 'material') return MATERIAL_SUBTYPES.map(s => ({k:s,v:s}));
    return [];
  });
  function _enrichSnap(snap) {
    if (!snap) return {};
    const ec = snap.equipment_criteria;
    if (ec && typeof ec === 'object') {
      return {
        ...snap,
        type: ec.slot || 'weapon',
        subtype: ec.subtype || '',
        quality: Number(ec.min_quality) || Number(ec.minQuality) || Number(snap.quality) || 0,
        material: ec.material || ''
      };
    }
    if (!snap.id) return snap;
    const tpl = _getItem(snap.id);
    return tpl ? { ...tpl, ...snap } : snap;
  }
  const listings = computed(() => {
    const list = rawListings.value || [];
    return list.map((l) => {
      if (!l || !l.item_snapshot) return l;
      return { ...l, item_snapshot: _enrichSnap(l.item_snapshot) };
    });
  });

  const EXCH_PAGE_SIZE = 20;
  const exTotalPages = computed(() => Math.max(1, Math.ceil((Number(exTotal.value) || 0) / EXCH_PAGE_SIZE)));
  const paginatedListings = computed(() => listings.value || []);

  function _buildListingFilters() {
    const filters = { side: exSide.value, keyword: exKeyword.value };
    if (Number(filterQuality.value) > 0) filters.quality = Number(filterQuality.value);
    if (filterCategory.value) filters.category = filterCategory.value;
    if (filterSubtype.value) filters.subtype = filterSubtype.value;
    return filters;
  }

  const load = async (page = null) => {
    const reqPage = Number.isFinite(Number(page)) ? Math.max(1, Math.trunc(Number(page))) : exPage.value;
    const r = await safe(() => api.exchangeListings(reqPage, EXCH_PAGE_SIZE, _buildListingFilters()));
    if (!r?.ok) return;
    rawListings.value = r.list || r.listings || [];
    exTotal.value = Math.max(0, Math.trunc(Number(r.total || 0)));
    exPage.value = Math.max(1, Math.trunc(Number(r.page || reqPage || 1)));
  };
  const prevPage = async () => {
    if (exPage.value <= 1) return;
    await load(exPage.value - 1);
  };
  const nextPage = async () => {
    if (exPage.value >= exTotalPages.value) return;
    await load(exPage.value + 1);
  };

  const resetFilters = async () => {
    filterQuality.value = 0;
    filterCategory.value = '';
    filterSubtype.value = '';
    exPage.value = 1;
    await load(1);
  };
  const setCategory = async (c) => {
    filterCategory.value = filterCategory.value === c ? '' : c;
    filterSubtype.value = '';
    exPage.value = 1;
    await load(1);
  };
  const setQuality = async (q) => {
    filterQuality.value = filterQuality.value === q ? 0 : q;
    exPage.value = 1;
    await load(1);
  };
  const setSubtype = async (s) => {
    filterSubtype.value = filterSubtype.value === s ? '' : s;
    exPage.value = 1;
    await load(1);
  };
  const loadMy = async () => { const r = await safe(() => api.exchangeMyListings()); if (r?.ok) myListings.value = r.list || r.listings || []; };
  const isBarterBuyOrder = (listing) => Boolean(listing?.barter_enabled || listing?.item_snapshot?.barter?.enabled);
  const buy = async (id, qty = 1) => { if (hr(await safe(() => api.exchangeBuy(id, qty)), '购买成功')) load(exPage.value); };
  const confirmBuy = async (listing) => {
    if (!listing) return;
    const left = Math.max(1, Number(listing.quantity_left || listing.remaining || listing.quantity || 1));
    const name = String(listing.item_name || listing.item_snapshot?.name || '物品');
    const unitPrice = Math.max(0, Number(listing.unit_price || listing.price || 0));
    const input = prompt(`购买「${name}」\n剩余数量：${left}\n单价：${unitPrice} 灵石/个\n\n请输入购买数量：`, '1');
    if (input == null) return;
    const qty = Math.floor(Number(input) || 0);
    if (!Number.isInteger(qty) || qty <= 0) { _showToast('购买数量必须为正整数'); return; }
    if (qty > left) { _showToast(`购买数量不能超过剩余数量（${left}）`); return; }
    if (!confirm(`确认购买「${name}」x${qty}？\n总价：${unitPrice * qty} 灵石`)) return;
    await buy(listing.listing_id || listing.id, qty);
  };
  const cancel = async (id) => { if (hr(await safe(() => api.exchangeCancelListing(id)), '已撤单')) loadMy(); };
  const create = async (page, slot, qty, price, expectItemId = 0) => { const ok = hr(await safe(() => api.exchangeCreateListing(page, slot, qty, price, expectItemId)), '上架成功'); if (ok) loadMy(); return ok; };
  const fulfill = async (id, qty) => { if (hr(await safe(() => api.exchangeFulfillBuy(id, qty)), '成交成功')) load(exPage.value); };
  const confirmFulfill = async (listing) => {
    if (!listing) return;
    const left = Math.max(1, Number(listing.quantity_left || listing.remaining || listing.quantity || 1));
    const name = String(listing.item_name || listing.item_snapshot?.name || '物品');
    const unitPrice = Math.max(0, Number(listing.unit_price || listing.price || 0));
    const barterEnabled = isBarterBuyOrder(listing);
    const payItemName = String(listing.barter_pay_item_name || listing.item_snapshot?.barter?.pay_item_name || '支付物品');
    const payUnitCount = Math.max(1, Number(listing.barter_pay_unit_count || listing.item_snapshot?.barter?.pay_unit_count || unitPrice || 1));
    const promptText = barterEnabled
      ? `向求购单供货「${name}」\n剩余需求：${left}\n可获得：${payUnitCount} ${payItemName}/个\n\n请输入供货数量：`
      : `向求购单供货「${name}」\n剩余需求：${left}\n单价：${unitPrice} 灵石/个\n\n请输入供货数量：`;
    const input = prompt(promptText, '1');
    if (input == null) return;
    const qty = Math.floor(Number(input) || 0);
    if (!Number.isInteger(qty) || qty <= 0) { _showToast('供货数量必须为正整数'); return; }
    if (qty > left) { _showToast(`供货数量不能超过剩余需求（${left}）`); return; }
    if (barterEnabled) {
      const payTotal = payUnitCount * qty;
      if (!confirm(`确认向求购单供货「${name}」x${qty}？\n预计获得：${payItemName} x${payTotal}`)) return;
    } else {
      if (!confirm(`确认向求购单供货「${name}」x${qty}？\n预计到账：${unitPrice * qty} 灵石（税后以系统结算为准）`)) return;
    }
    await fulfill(listing.listing_id || listing.id, qty);
  };
  const fulfillEquip = async (id, page, slot, expectItemId = 0) => {
    if (hr(await safe(() => api.exchangeFulfillBuyEquip(id, page, slot, expectItemId)), '供货成功')) {
      equipFulfillId.value = null; load(exPage.value);
    }
  };
  const openEquipFulfill = (listingId) => { equipFulfillId.value = listingId; equipFulfillPage.value = 0; equipFulfillSlot.value = 0; };
  const closeEquipFulfill = () => { equipFulfillId.value = null; };
  const createBuyOrder = async (itemId, itemName, qty, price, options = {}) => {
    const payload = {
      item_id: itemId || 0,
      item_name: itemName,
      quantity: qty,
      unit_price: price
    };
    const barterEnabled = Boolean(options?.barterEnabled);
    if (barterEnabled) {
      payload.barter_pay_item_id = Number(options?.barterPayItemId) || 0;
      payload.barter_pay_unit_count = Number(options?.barterPayUnitCount) || 0;
      delete payload.unit_price;
    }
    const msg = barterEnabled ? '以物易物求购已发布' : '求购已发布';
    if (hr(await safe(() => api.exchangeBuyOrders(payload)), msg)) {
      load(1);
      buySearchResults.value = [];
    }
  };
  const createEquipBuyOrder = async (itemName, qty, price, criteria) => {
    if (hr(await safe(() => api.exchangeEquipBuyOrder(itemName, qty, price, criteria)), '装备求购已发布')) load(1);
  };
  const equipBuyForm = reactive({ slot:'weapon', subtype:'剑', minQuality:1, material:'', itemName:'', qty:1, price:100 });
  const SLOT_NAMES = {head:'头盔',shoulder:'肩甲',chest:'胸甲',legs:'腿甲',hands:'护手',ring:'戒指',amulet:'项链',back:'披风'};
  const submitEquipBuyOrder = () => {
    const f = equipBuyForm;
    const slotLabel = f.slot === 'weapon' ? f.subtype : (SLOT_NAMES[f.slot] || '');
    const name = f.itemName || (f.minQuality + '品' + slotLabel);
    const criteria = { slot: f.slot, subtype: slotLabel, material: f.material || '', min_quality: f.minQuality };
    createEquipBuyOrder(name, f.qty, f.price, criteria);
  };

  const buySearchResults = ref([]);
  let _buySearchTimer = null;
  const QUOTE_CACHE_TTL_MS = 3 * 60 * 1000;
  const _quoteCache = {
    sell: { key: '', at: 0, payload: null },
    buy: { key: '', at: 0, payload: null },
    equip: { key: '', at: 0, payload: null }
  };
  function _getCachedQuote(kind, key) {
    const entry = _quoteCache[kind];
    if (!entry || entry.key !== key) return null;
    if ((Date.now() - Number(entry.at || 0)) > QUOTE_CACHE_TTL_MS) return null;
    return entry.payload || null;
  }
  function _setCachedQuote(kind, key, payload) {
    _quoteCache[kind] = { key, at: Date.now(), payload: payload || null };
  }
  function _resetSellQuote() { sellQuote.value = null; quoteError.sell = ''; }
  function _resetBuyQuote() { buyQuote.value = null; quoteError.buy = ''; }
  function _resetEquipQuote() { equipBuyQuote.value = null; quoteError.equip = ''; }

  const quoteSell = async (page, slot, qty, price) => {
    const nPage = Math.floor(Number(page));
    const nSlot = Math.floor(Number(slot));
    const nQty = Math.max(1, Math.floor(Number(qty) || 1));
    const nPrice = Math.floor(Number(price) || 0);
    if (!Number.isInteger(nPage) || nPage < 0 || !Number.isInteger(nSlot) || nSlot < 0 || nPrice <= 0) {
      _resetSellQuote();
      return;
    }
    const cacheKey = `${nPage}|${nSlot}|${nQty}|${nPrice}`;
    const cached = _getCachedQuote('sell', cacheKey);
    if (cached) {
      sellQuote.value = cached;
      quoteError.sell = '';
      return;
    }
    const r = await safe(() => api.exchangeQuote({
      side: 'sell',
      page: nPage,
      slot_index: nSlot,
      quantity: nQty,
      unit_price: nPrice
    }));
    if (r?.ok) {
      sellQuote.value = r;
      _setCachedQuote('sell', cacheKey, r);
      quoteError.sell = '';
      return;
    }
    sellQuote.value = null;
    quoteError.sell = r?.error || '';
  };

  const quoteBuy = async (itemId, itemName, qty, price, options = {}) => {
    const nItemId = Math.floor(Number(itemId) || 0);
    const nQty = Math.max(1, Math.floor(Number(qty) || 1));
    const nPrice = Math.floor(Number(price) || 0);
    const name = String(itemName || '').trim();
    const barterEnabled = Boolean(options?.barterEnabled);
    const nPayItemId = Math.floor(Number(options?.barterPayItemId) || 0);
    const nPayUnitCount = Math.floor(Number(options?.barterPayUnitCount) || 0);
    if (nItemId <= 0) {
      _resetBuyQuote();
      return;
    }
    if (barterEnabled && (nPayItemId <= 0 || nPayUnitCount <= 0)) {
      _resetBuyQuote();
      return;
    }
    if (!barterEnabled && nPrice <= 0) {
      _resetBuyQuote();
      return;
    }
    const cacheKey = barterEnabled
      ? `barter|${nItemId}|${name}|${nQty}|${nPayItemId}|${nPayUnitCount}`
      : `stone|${nItemId}|${name}|${nQty}|${nPrice}`;
    const cached = _getCachedQuote('buy', cacheKey);
    if (cached) {
      buyQuote.value = cached;
      quoteError.buy = '';
      return;
    }
    const query = {
      side: 'buy',
      item_id: nItemId,
      item_name: name,
      quantity: nQty
    };
    if (barterEnabled) {
      query.barter_pay_item_id = nPayItemId;
      query.barter_pay_unit_count = nPayUnitCount;
    } else {
      query.unit_price = nPrice;
    }
    const r = await safe(() => api.exchangeQuote(query));
    if (r?.ok) {
      buyQuote.value = r;
      _setCachedQuote('buy', cacheKey, r);
      quoteError.buy = '';
      return;
    }
    buyQuote.value = null;
    quoteError.buy = r?.error || '';
  };

  const quoteEquipBuy = async (form) => {
    const f = form || {};
    const slot = String(f.slot || '').trim();
    const qty = Math.max(1, Math.floor(Number(f.qty) || 1));
    const price = Math.floor(Number(f.price) || 0);
    if (!slot || price <= 0) {
      _resetEquipQuote();
      return;
    }
    const subtype = String(f.subtype || '').trim();
    const material = String(f.material || '').trim();
    const minQuality = Math.max(1, Math.floor(Number(f.minQuality) || 1));
    const itemName = String(f.itemName || '').trim();
    const cacheKey = `${slot}|${subtype}|${material}|${minQuality}|${itemName}|${qty}|${price}`;
    const cached = _getCachedQuote('equip', cacheKey);
    if (cached) {
      equipBuyQuote.value = cached;
      quoteError.equip = '';
      return;
    }
    const r = await safe(() => api.exchangeQuote({
      side: 'buy',
      item_name: itemName,
      quantity: qty,
      unit_price: price,
      equip_slot: slot,
      equip_subtype: subtype,
      equip_material: material,
      equip_min_quality: minQuality
    }));
    if (r?.ok) {
      equipBuyQuote.value = r;
      _setCachedQuote('equip', cacheKey, r);
      quoteError.equip = '';
      return;
    }
    equipBuyQuote.value = null;
    quoteError.equip = r?.error || '';
  };

  const searchBuyItem = (q) => {
    clearTimeout(_buySearchTimer);
    const val = String(q || '').trim();
    if (val.length < 1) { buySearchResults.value = []; return; }
    _buySearchTimer = setTimeout(async () => {
      const r = await safe(() => api.exchangeItemSearch(val));
      if (r?.ok) buySearchResults.value = r.results || [];
    }, 300);
  };

  return {
    listings, paginatedListings, rawListings, myListings, filteredMyListings, myOrderFilter, exPage, exTotal, exSide, exKeyword,
    filterQuality, filterCategory, filterSubtype, subtypeOptions,
    exTotalPages,
    resetFilters, setCategory, setQuality, setSubtype,
    sellQuote, buyQuote, equipBuyQuote, quoteError,
    equipFulfillId, equipFulfillPage, equipFulfillSlot, equipBuyForm,
    buySearchResults, searchBuyItem,
    load, loadMy, buy, confirmBuy, cancel, create, fulfill, confirmFulfill, fulfillEquip, createBuyOrder, createEquipBuyOrder,
    quoteSell, quoteBuy, quoteEquipBuy,
    isBarterBuyOrder,
    prevPage, nextPage,
    openEquipFulfill, closeEquipFulfill, submitEquipBuyOrder
  };
}

// ═══ 仙盟 ═══
export function useAlliance() {
  const alList = ref([]);
  const alDetail = ref(null);
  const alSubTab = ref('list');
  const alBuildings = ref({});
  const alApps = ref([]);
  const alTreasury = ref([]);
  const createName = ref('');
  const createDesc = ref('');

  const loadList = async () => { const r = await safe(() => api.allianceList()); if (r?.ok) alList.value = r.alliances || []; };
  const loadDetail = async (id) => {
    const r = await safe(() => api.allianceDetail(id));
    if (r?.ok) alDetail.value = r.alliance ? { ...r.alliance, my_rank: r.my_rank, can_withdraw: r.can_withdraw } : r;
  };
  const loadBuildings = async (id) => { const r = await safe(() => api.allianceBuildings(id)); if (r?.ok) alBuildings.value = r.buildings || {}; };
  const loadApps = async (id) => { const r = await safe(() => api.allianceApplications(id)); if (r?.ok) alApps.value = r.applications || []; };
  const loadTreasury = async (id) => { const r = await safe(() => api.allianceTreasuryList(id)); if (r?.ok) alTreasury.value = r.items || r.goods || []; };
  const alWarehouse = ref([]);
  const alWarehousePages = ref(10);
  const alWarehousePage = ref(0);
  const loadWarehouse = async (id) => { const r = await safe(() => api.allianceWarehouse(id)); if (r?.ok) { alWarehouse.value = r.warehouse || []; alWarehousePages.value = r.warehouse_pages || 10; } };
  const depositWarehouse = async (id, page, slot, count, expectItemId = 0) => { const ok = hr(await safe(() => api.allianceWarehouseDeposit(id, page, slot, count, expectItemId)), '存入成功'); if (ok) loadWarehouse(id); return ok; };
  const withdrawWarehouse = async (id, whPage, whSlot, count) => { const ok = hr(await safe(() => api.allianceWarehouseWithdraw(id, whPage, whSlot, count)), '取出成功'); if (ok) loadWarehouse(id); return ok; };
  const upgradeWarehouse = async (id) => { if (hr(await safe(() => api.allianceWarehouseUpgrade(id)), '仓库已升级')) loadWarehouse(id); };
  const createAlliance = async () => {
    if (!createName.value.trim()) { _showToast('请输入仙盟名称'); return; }
    if (hr(await safe(() => api.allianceCreate(createName.value, createDesc.value)), '仙盟创建成功')) _doSync();
  };
  const apply = async (id) => {
    const r = await safe(() => api.allianceApply(id));
    if (r?.ok) { _showToast(r.auto_joined ? '已加入仙盟' : '申请已提交'); if (r.auto_joined) _doSync(); }
    else if (r) _showToast(r.error);
  };
  const leaveAlliance = async () => { if (!confirm('确定退出仙盟？')) return; if (hr(await safe(() => api.allianceLeave()), '已退出仙盟')) _doSync(); };
  const approve = async (id) => { hr(await safe(() => api.allianceApprove(id)), '已批准'); };
  const reject = async (id) => { hr(await safe(() => api.allianceReject(id)), '已拒绝'); };
  const blessConfirm = reactive({ open: false, times: 1 });
  const openBlessConfirm = () => { blessConfirm.times = 1; blessConfirm.open = true; };
  const doBless = async (id) => {
    blessConfirm.open = false;
    const times = Math.max(1, Math.min(50, blessConfirm.times || 1));
    const r = await safe(() => api.allianceBless(id, times));
    if (r?.ok) _showToast(r.msg || '祈福完成');
    else if (r) _showToast(r.error);
  };
  const bathe = async (id) => { hr(await safe(() => api.allianceBathe(id)), '沐浴完成'); };
  const gardenPick = async (id) => { hr(await safe(() => api.allianceGardenPick(id)), '采摘完成'); };
  const meditate = async (id) => { hr(await safe(() => api.allianceMeditate(id)), '顿悟完成'); };
  const upgradeBldg = async (id, b) => { hr(await safe(() => api.allianceBuildingUpgrade(id, b)), '升级成功'); };
  const buyTreasury = async (alId, itemId) => {
    const allianceId = Math.max(0, Math.floor(Number(alId) || 0));
    const targetItemId = Math.max(0, Math.floor(Number(itemId) || 0));
    if (allianceId <= 0 || targetItemId <= 0) {
      _showToast('商品参数异常，请刷新宝阁后重试');
      return false;
    }
    const ok = hr(await safe(() => api.allianceTreasuryBuy(allianceId, targetItemId)), '购买成功');
    if (ok) {
      await Promise.allSettled([
        loadTreasury(allianceId),
        loadDetail(allianceId)
      ]);
    }
    return ok;
  };
  const donate = async (alId, page, slot, count, expectItemId = 0) => { hr(await safe(() => api.allianceDonate(alId, page, slot, count, expectItemId)), '捐献成功'); };
  const kick = async (alId, accId) => { if (!confirm('确定踢出该成员？')) return; hr(await safe(() => api.allianceKick(alId, accId)), '已踢出'); };
  const rankMenuTarget = ref(null);
  const toggleRankMenu = (accId) => { rankMenuTarget.value = rankMenuTarget.value === accId ? null : accId; };
  const grantRank = async (alId, accId, rank) => { rankMenuTarget.value = null; if (hr(await safe(() => api.allianceGrantRank(alId, accId, rank)), '职务已变更')) loadDetail(alId); };
  const transferLeader = async (alId, accId) => { if (!confirm('确定转让盟主？此操作不可撤销！')) return; if (hr(await safe(() => api.allianceTransferLeader(alId, accId)), '盟主已转让')) loadDetail(alId); };
  const warehouseAuthorize = async (alId, accId, add) => { if (hr(await safe(() => api.allianceWarehouseAuthorize(alId, accId, add)), add ? '已授权提取' : '已取消授权')) loadDetail(alId); };

  const memberPage = ref(0);
  const MEMBER_PAGE_SIZE = 20;
  const memberPageCount = computed(() => { const m = alDetail.value?.members || []; return Math.max(1, Math.ceil(m.length / MEMBER_PAGE_SIZE)); });
  const membersPage = computed(() => { const m = alDetail.value?.members || []; return m.slice(memberPage.value * MEMBER_PAGE_SIZE, (memberPage.value + 1) * MEMBER_PAGE_SIZE); });

  return {
    alList, alDetail, alSubTab, alBuildings, alApps, alTreasury, createName, createDesc,
    alWarehouse, alWarehousePages, alWarehousePage,
    memberPage, memberPageCount, membersPage,
    loadList, loadDetail, loadBuildings, loadApps, loadTreasury,
    loadWarehouse, depositWarehouse, withdrawWarehouse, upgradeWarehouse,
    create: createAlliance, apply, leave: leaveAlliance, approve, reject,
    blessConfirm, openBlessConfirm, doBless, bathe, gardenPick, meditate, upgradeBldg, buyTreasury, donate,
    kick, grantRank, transferLeader, warehouseAuthorize,
    rankMenuTarget, toggleRankMenu,
  };
}

// ═══ 聊天 ═══
export function useChat() {
  const channel = ref('world');
  const messages = ref([]);
  const input = ref('');
  let since = 0;
  let timer = null;

  const loadMsg = async () => {
    const aid = _player.alliance_id || 0;
    const r = await safe(() => api.chatMessages(channel.value, since, aid));
    if (r?.ok && r.messages?.length) {
      messages.value.push(...r.messages);
      if (messages.value.length > 200) messages.value.splice(0, messages.value.length - 200);
      since = Math.max(since, ...r.messages.map(m => m.id || m.timestamp || 0));
    }
  };
  const send = async () => {
    if (!input.value.trim()) return;
    const r = await safe(() => api.chatSend(channel.value, input.value.trim()));
    if (r?.ok) { input.value = ''; loadMsg(); } else if (r) _showToast(r.error);
  };
  const startPoll = () => { loadMsg(); timer = setInterval(loadMsg, 5000); };
  const stopPoll = () => { if (timer) { clearInterval(timer); timer = null; } };
  const switchChannel = (ch) => { channel.value = ch; messages.value = []; since = 0; loadMsg(); };

  return { channel, messages, input, send, startPoll, stopPoll, switchChannel };
}

// ═══ 副本 ═══
export function useDungeon() {
  const MAX_DUNGEON_LOG_LINES = 240;
  const BASE_DUNGEON_ADVANCE_DELAY_MS = 350;
  const dgList = ref([]);
  const dgMode = ref('normal');
  const dgBattleId = ref(null);
  const dgState = ref(null);
  const dgTurnQueueText = computed(() => buildTurnQueueText(dgState.value));
  const dgLog = ref([]);
  const dgResult = ref(null);
  const dgRunning = ref(false);
  let _dungeonAdvanceDelayMs = BASE_DUNGEON_ADVANCE_DELAY_MS;
  let _dungeonAdvanceInFlight = null;
  const dgKeepTeam = ref(localStorage.getItem('dungeon_team_keep') === '1');
  const dgTeamCode = ref(dgKeepTeam.value ? (localStorage.getItem('dungeon_team_code') || '') : '');
  const dgTeamInfo = ref((() => {
    if (!dgKeepTeam.value) return null;
    try { return JSON.parse(localStorage.getItem('dungeon_team_info') || 'null'); } catch { return null; }
  })());

  const saveTeamCache = () => {
    localStorage.setItem('dungeon_team_keep', dgKeepTeam.value ? '1' : '0');
    if (dgKeepTeam.value && dgTeamCode.value) {
      localStorage.setItem('dungeon_team_code', dgTeamCode.value);
      localStorage.setItem('dungeon_team_info', JSON.stringify(dgTeamInfo.value || null));
    } else {
      localStorage.removeItem('dungeon_team_code');
      localStorage.removeItem('dungeon_team_info');
    }
  };
  const setKeepTeam = (val) => {
    dgKeepTeam.value = !!val;
    saveTeamCache();
  };
  const setTeamState = (code, info) => {
    dgTeamCode.value = code || '';
    dgTeamInfo.value = info || null;
    saveTeamCache();
  };
  const clearTeamState = (force = false) => {
    if (!force && dgKeepTeam.value) { saveTeamCache(); return; }
    dgTeamCode.value = '';
    dgTeamInfo.value = null;
    saveTeamCache();
  };

  const loadList = async () => { const r = await safe(() => api.dungeonList()); if (r?.ok) dgList.value = r.dungeons || []; };
  const teamCreate = async () => {
    const r = await safe(() => api.dungeonTeamCreate());
    if (!r?.ok) { if (r?.error) _showToast(r.error); return; }
    setTeamState(r.team_code || '', dgTeamInfo.value);
    _showToast(`队伍已创建，邀请码: ${r.team_code}`);
    await loadTeamInfo();
  };
  const teamJoin = async (code) => {
    if (!code?.trim()) { _showToast('请输入邀请码'); return; }
    const r = await safe(() => api.dungeonTeamJoin(code.trim()));
    if (!r?.ok) { if (r?.error) _showToast(r.error); return; }
    setTeamState(code.trim().toUpperCase(), dgTeamInfo.value);
    _showToast('已加入队伍');
    await loadTeamInfo();
  };
  const teamLeave = async () => {
    if (!dgTeamCode.value) return;
    const r = await safe(() => api.dungeonTeamLeave(dgTeamCode.value));
    if (r?.ok) { clearTeamState(true); _showToast('已离开队伍'); }
  };
  const teamKick = async (accountId) => {
    const targetId = Number(accountId) || 0;
    if (!dgTeamCode.value || targetId <= 0) return;
    if (!confirm('确定将该成员踢出队伍吗？')) return;
    const r = await safe(() => api.dungeonTeamKick(dgTeamCode.value, targetId));
    if (!r?.ok) { if (r?.error) _showToast(r.error); return; }
    if (r.team) setTeamState(dgTeamCode.value, r.team);
    else await loadTeamInfo();
    _showToast('已踢出成员');
  };
  const loadTeamInfo = async () => {
    if (!dgTeamCode.value) return;
    const r = await safe(() => api.dungeonTeamInfo(dgTeamCode.value));
    if (r?.ok) setTeamState(dgTeamCode.value, r.team || r);
    else if (!dgKeepTeam.value) clearTeamState(true);
  };
  const copyTeamCode = async () => {
    const code = String(dgTeamCode.value || '').trim();
    if (!code) { _showToast('当前没有队伍码'); return; }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        _showToast('队伍码已复制');
        return;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) _showToast('队伍码已复制');
      else _showToast('复制失败，请手动复制队伍码');
    } catch (_) {
      _showToast('复制失败，请手动复制队伍码');
    }
  };
  const loadMyTeam = async () => {
    const r = await safe(() => api.dungeonTeamMine());
    if (r?.ok && r.team) {
      setTeamState(r.team.team_code || '', r.team);
    } else if (dgKeepTeam.value && dgTeamCode.value) {
      await loadTeamInfo();
    } else if (!dgKeepTeam.value) {
      clearTeamState(true);
    }
  };
  const _normalizeDungeonMode = (mode) => String(mode || '').toLowerCase() === 'formation' ? 'formation' : 'normal';
  const _dungeonModeLabel = (mode) => _normalizeDungeonMode(mode) === 'formation' ? '阵法副本' : '普通副本';
  const _resetDungeonAdvanceDelay = () => { _dungeonAdvanceDelayMs = BASE_DUNGEON_ADVANCE_DELAY_MS; };
  const _backoffDungeonAdvanceDelay = () => { _dungeonAdvanceDelayMs = nextBattleAdvanceDelayMs(_dungeonAdvanceDelayMs); };
  const _pushDungeonLog = (text) => {
    if (!text) return;
    dgLog.value.push(String(text));
    if (dgLog.value.length > MAX_DUNGEON_LOG_LINES) {
      dgLog.value.splice(0, dgLog.value.length - MAX_DUNGEON_LOG_LINES);
    }
  };

  const startBattle = async (dungeonId, mode = dgMode.value) => {
    const battleMode = _normalizeDungeonMode(mode);
    const r = await safe(() => api.dungeonBattleStart(dungeonId, dgTeamCode.value || '', battleMode));
    if (!r?.ok) { _showToast(r?.error || '无法开始'); return; }
    dgMode.value = _normalizeDungeonMode(r.dungeon_mode || r.state?.dungeon_mode || battleMode);
    dgBattleId.value = r.battle_id;
    dgState.value = r.state || null;
    dgLog.value = [`${_dungeonModeLabel(dgMode.value)}战斗开始！`];
    dgResult.value = null;
    _resetDungeonAdvanceDelay();
    autoAdvance();
  };
  const advance = async () => {
    if (!dgBattleId.value) return;
    if (_dungeonAdvanceInFlight) return _dungeonAdvanceInFlight;
    _dungeonAdvanceInFlight = (async () => {
    let r = null;
    try {
      r = await api.dungeonBattleAdvance(dgBattleId.value);
    } catch (e) {
      const errMsg = String(e?.message || '推进失败');
      _showToast(formatBattleAdvanceError(errMsg));
      if (isBattleSessionTerminalError(errMsg) || isBattleSessionAuthError(errMsg)) {
        dgBattleId.value = null;
        dgState.value = null;
        dgRunning.value = false;
      } else if (isBattleAdvanceBackoffError(errMsg)) {
        _backoffDungeonAdvanceDelay();
      } else {
        _backoffDungeonAdvanceDelay();
      }
      return;
    }
    if (!r?.ok) {
      const errMsg = String(r?.error || '推进失败');
      if (!errMsg.includes('过于频繁')) _showToast(formatBattleAdvanceError(errMsg));
      if (isBattleSessionTerminalError(errMsg) || isBattleSessionAuthError(errMsg)) {
        dgBattleId.value = null;
        dgState.value = null;
        dgRunning.value = false;
      } else if (isBattleAdvanceBackoffError(errMsg)) {
        _backoffDungeonAdvanceDelay();
      }
      return;
    }
    _resetDungeonAdvanceDelay();
    if (r.state) dgState.value = r.state;
    if (r.state?.dungeon_mode) dgMode.value = _normalizeDungeonMode(r.state.dungeon_mode);
    if (r.events) r.events.forEach(e => { if (e.text || e.description) _pushDungeonLog(e.text || e.description); });
    if (r.finished || r.ended) {
      const isDraw = !!r.draw;
      dgResult.value = isDraw ? 'draw' : (r.victory ? 'victory' : 'defeat');
      if (r.player) _applyPlayer(r.player);
      dgBattleId.value = null; dgState.value = null;
      const rw = r.rewards || {};
      const rewardMode = _normalizeDungeonMode(rw.dungeon_mode || dgMode.value);
      const modeLabel = _dungeonModeLabel(rewardMode);
      let msg = isDraw ? `${modeLabel}平局` : (r.victory ? `${modeLabel}胜利！` : `${modeLabel}失败`);
      if (rw.exp) msg += ` 经验+${rw.exp}`;
      if (rw.spirit_stones) msg += ` 灵石+${rw.spirit_stones}`;
      if (rw.drops?.length) msg += ` 掉落: ${rw.drops.map(d => (d.item_name || d.name || '?') + (d.count > 1 ? 'x'+d.count : '')).join(', ')}`;
      _pushDungeonLog(msg);
      _showToast(isDraw ? `${modeLabel}平局` : (r.victory ? `${modeLabel}胜利！` : `${modeLabel}失败`));
    }
    })();
    try {
      return await _dungeonAdvanceInFlight;
    } finally {
      _dungeonAdvanceInFlight = null;
    }
  };
  const autoAdvance = async () => {
    if (dgRunning.value) return;
    dgRunning.value = true;
    try {
      while (dgBattleId.value && dgRunning.value) {
        await advance();
        if (dgBattleId.value && dgRunning.value) await new Promise(r => setTimeout(r, _dungeonAdvanceDelayMs));
      }
    } finally {
      dgRunning.value = false;
    }
  };
  const stopAutoAdvance = () => { dgRunning.value = false; _resetDungeonAdvanceDelay(); };

  return { dgList, dgMode, dgBattleId, dgState, dgTurnQueueText, dgLog, dgResult, dgRunning, dgKeepTeam, dgTeamCode, dgTeamInfo, setKeepTeam, loadList, loadMyTeam, teamCreate, teamJoin, teamLeave, teamKick, loadTeamInfo, copyTeamCode, startBattle, advance, autoAdvance, stopAutoAdvance };
}

// ═══ 斗法 ═══
export function useDuel() {
  const MAX_DUEL_LOG_LINES = 240;
  const BASE_DUEL_ADVANCE_DELAY_MS = 350;
  const targets = ref([]);
  const logs = ref([]);
  const rank = ref([]);
  const duelSubTab = ref('targets');
  const duelBattleId = ref(null);
  const duelState = ref(null);
  const duelTurnQueueText = computed(() => buildTurnQueueText(duelState.value));
  const duelLog = ref([]);
  const duelResult = ref(null);
  const duelRunning = ref(false);
  let _duelAdvanceDelayMs = BASE_DUEL_ADVANCE_DELAY_MS;
  let _duelAdvanceInFlight = null;
  let _duelAutoAdvanceKickTimer = null;
  const targetPage = ref(1);
  const targetPageSize = ref(30);
  const targetTotal = ref(0);
  const targetTotalPages = ref(1);
  const targetKeyword = ref('');
  const targetJumpPage = ref(1);
  const _resetDuelAdvanceDelay = () => { _duelAdvanceDelayMs = BASE_DUEL_ADVANCE_DELAY_MS; };
  const _backoffDuelAdvanceDelay = () => { _duelAdvanceDelayMs = nextBattleAdvanceDelayMs(_duelAdvanceDelayMs); };
  const _pushDuelLog = (text) => {
    if (!text) return;
    duelLog.value.push(String(text));
    if (duelLog.value.length > MAX_DUEL_LOG_LINES) {
      duelLog.value.splice(0, duelLog.value.length - MAX_DUEL_LOG_LINES);
    }
  };

  const loadTargets = async (page = null) => {
    const requestedPage = Number.isFinite(Number(page)) ? Math.max(1, Math.trunc(Number(page))) : targetPage.value;
    const r = await safe(() => api.cityDuelList(requestedPage, targetPageSize.value, targetKeyword.value));
    if (!r?.ok) return;
    targets.value = r.targets || r.list || [];
    targetPage.value = Math.max(1, Math.trunc(Number(r.page || requestedPage || 1)));
    targetPageSize.value = Math.max(10, Math.min(100, Math.trunc(Number(r.page_size || targetPageSize.value || 30))));
    targetTotal.value = Math.max(0, Math.trunc(Number(r.total || targets.value.length || 0)));
    targetTotalPages.value = Math.max(1, Math.trunc(Number(r.total_pages || Math.ceil(targetTotal.value / targetPageSize.value) || 1)));
    targetJumpPage.value = targetPage.value;
  };
  const prevTargetPage = async () => {
    if (targetPage.value <= 1) return;
    await loadTargets(targetPage.value - 1);
  };
  const nextTargetPage = async () => {
    if (targetPage.value >= targetTotalPages.value) return;
    await loadTargets(targetPage.value + 1);
  };
  const clearTargetKeyword = async () => {
    targetKeyword.value = '';
    await loadTargets(1);
  };
  const jumpTargetPage = async () => {
    const raw = Math.trunc(Number(targetJumpPage.value) || 1);
    const page = Math.max(1, Math.min(targetTotalPages.value, raw));
    if (raw !== page) {
      _showToast(`页码超出范围，已为你跳到第${page}页`);
    }
    targetJumpPage.value = page;
    if (page === targetPage.value) return;
    await loadTargets(page);
  };
  const start = async (id) => {
    const r = await safe(() => api.cityDuelStart(id));
    if (!r?.ok) { if (r) _showToast(r.error); return; }
    duelBattleId.value = r.battle_id; duelState.value = r.state || null; duelLog.value = ['斗法战斗开始！']; duelResult.value = null;
    _resetDuelAdvanceDelay();
    loadTargets(targetPage.value);
    if (_duelAutoAdvanceKickTimer) {
      clearTimeout(_duelAutoAdvanceKickTimer);
      _duelAutoAdvanceKickTimer = null;
    }
    _duelAutoAdvanceKickTimer = setTimeout(() => {
      _duelAutoAdvanceKickTimer = null;
      autoAdvance();
    }, 400);
  };
  const advance = async () => {
    if (!duelBattleId.value) return;
    if (_duelAdvanceInFlight) return _duelAdvanceInFlight;
    _duelAdvanceInFlight = (async () => {
    let r = null;
    try {
      r = await api.dungeonBattleAdvance(duelBattleId.value);
    } catch (e) {
      const errMsg = String(e?.message || '推进失败');
      _showToast(formatBattleAdvanceError(errMsg));
      if (isBattleSessionTerminalError(errMsg) || isBattleSessionAuthError(errMsg)) {
        duelBattleId.value = null;
        duelState.value = null;
        duelRunning.value = false;
      } else if (isBattleAdvanceBackoffError(errMsg)) {
        _backoffDuelAdvanceDelay();
      } else {
        _backoffDuelAdvanceDelay();
      }
      return;
    }
    if (!r?.ok) {
      const errMsg = String(r?.error || '推进失败');
      if (!errMsg.includes('过于频繁')) _showToast(formatBattleAdvanceError(errMsg));
      if (isBattleSessionTerminalError(errMsg) || isBattleSessionAuthError(errMsg)) {
        duelBattleId.value = null;
        duelState.value = null;
        duelRunning.value = false;
      } else if (isBattleAdvanceBackoffError(errMsg)) {
        _backoffDuelAdvanceDelay();
      }
      return;
    }
    _resetDuelAdvanceDelay();
    if (r.state) duelState.value = r.state;
    if (r.events) r.events.forEach(e => { if (e.text || e.description) _pushDuelLog(e.text || e.description); });
    if (r.finished || r.ended) {
      const isDraw = !!r.draw;
      duelResult.value = isDraw ? 'draw' : (r.victory ? 'victory' : 'defeat');
      if (r.player) _applyPlayer(r.player);
      duelBattleId.value = null; duelState.value = null;
      const rankHint = r.rank_affected === false ? '（不影响rank分）' : '';
      _showToast(isDraw ? `斗法平局${rankHint}` : (r.victory ? `斗法胜利！${rankHint}` : `斗法失败${rankHint}`));
      loadTargets(targetPage.value); loadRank();
    }
    })();
    try {
      return await _duelAdvanceInFlight;
    } finally {
      _duelAdvanceInFlight = null;
    }
  };
  const autoAdvance = async () => {
    if (duelRunning.value) return;
    duelRunning.value = true;
    try {
      while (duelBattleId.value && duelRunning.value) {
        await advance();
        if (duelBattleId.value && duelRunning.value) await new Promise(r => setTimeout(r, _duelAdvanceDelayMs));
      }
    } finally {
      duelRunning.value = false;
    }
  };
  const stopAutoAdvance = () => {
    duelRunning.value = false;
    _resetDuelAdvanceDelay();
    if (_duelAutoAdvanceKickTimer) {
      clearTimeout(_duelAutoAdvanceKickTimer);
      _duelAutoAdvanceKickTimer = null;
    }
  };

  const loadLogs = async () => {
    const r = await safe(() => api.cityDuelLogs());
    if (r?.ok) {
      const rows = r.logs || r.list || [];
      logs.value = (Array.isArray(rows) ? rows : []).map((row) => {
        const selfWin = !!row?.self_win;
        return { ...row, self_win: selfWin, victory: selfWin };
      });
    }
  };
  const settlementCountdown = ref(0);
  const challengesRemaining = ref(null);
  const challengesToday = ref(0);
  const loadRank = async () => {
    const r = await safe(() => api.cityDuelRank());
    if (r?.ok) {
      rank.value = r.leaderboard || r.rankings || [];
      settlementCountdown.value = r.settlement_countdown_sec ?? 0;
      if (r.rank_effective_remaining !== undefined) challengesRemaining.value = r.rank_effective_remaining;
      if (r.challenges_today !== undefined) challengesToday.value = r.challenges_today;
    }
  };

  const inspectModal = reactive({ open: false, tab: 'equip', loading: false, data: null });
  const inspect = async (accountId) => {
    inspectModal.open = true;
    inspectModal.tab = 'equip';
    inspectModal.loading = true;
    inspectModal.data = null;
    const r = await safe(() => api.cityDuelInspect(accountId));
    inspectModal.loading = false;
    if (r?.ok) {
      inspectModal.data = r;
    } else {
      _showToast(r?.error || '查看失败');
      inspectModal.open = false;
    }
  };

  return {
    targets,
    logs,
    rank,
    duelSubTab,
    duelBattleId,
    duelState,
    duelTurnQueueText,
    duelLog,
    duelResult,
    duelRunning,
    settlementCountdown,
    challengesRemaining,
    challengesToday,
    targetPage,
    targetPageSize,
    targetTotal,
    targetTotalPages,
    targetKeyword,
    targetJumpPage,
    loadTargets,
    prevTargetPage,
    nextTargetPage,
    jumpTargetPage,
    clearTargetKeyword,
    start,
    advance,
    autoAdvance,
    stopAutoAdvance,
    loadLogs,
    loadRank,
    inspectModal,
    inspect
  };
}

// ═══ 联赛 ═══
export function useLeague() {
  const subTab = ref('status');
  const status = ref(null);
  const loading = ref(false);
  const teamActionError = ref('');

  const createName = ref('');
  const joinCode = ref('');
  const registerMode = ref('team');
  const runDueResult = ref(null);

  const shopGoods = ref([]);
  const shopPoints = ref(0);
  const shopQty = ref({});

  const leaderboard = ref([]);
  const leaderboardLimit = ref(100);

  const teamRank = ref([]);
  const teamRankLimit = ref(100);
  const teamRankWeekStart = ref(0);
  const teamRankMyTeamId = ref(0);

  const matches = ref([]);
  const matchTeam = ref(null);
  const matchWeekStart = ref(0);
  const matchLimit = ref(30);
  const matchScope = ref('self_team_only');
  const MATCH_LOG_PREVIEW_LINES = 24;
  const matchLogExpanded = ref({});

  const skillMemberAccountId = ref(0);
  const skillSelected = ref([]);
  const skillKeyId = ref(0);

  const _cacheAt = {
    status: 0,
    leaderboard: 0,
    teamRank: 0,
    matches: 0,
    shop: 0
  };
  const _cacheMeta = {
    status: '',
    leaderboard: '',
    teamRank: '',
    matches: '',
    shop: ''
  };
  const _cacheTtlMs = {
    status: 15000,
    leaderboard: 30000,
    teamRank: 20000,
    matches: 20000,
    shop: 15000
  };

  const timeline = computed(() => status.value?.timeline || null);
  const currentSeason = computed(() => status.value?.current_season || null);
  const registrationSeason = computed(() => status.value?.registration_season || null);
  const registrationTeam = computed(() => status.value?.me_registration_team || null);
  const currentTeam = computed(() => status.value?.me_current_team || null);
  const canShowCancelTeamRegister = computed(() => {
    const team = registrationTeam.value;
    if (!team) return false;
    if (String(team.mode || '') === 'system') return false;
    return Boolean(team.registered);
  });
  const canCancelTeamRegister = computed(() => {
    const team = registrationTeam.value;
    if (!team) return false;
    if (String(team.mode || '') === 'system') return false;
    if (!Boolean(timeline.value?.registration_open)) return false;
    if (!Boolean(team.registered)) return false;
    const captain = Number(team.captain_account_id || 0);
    const me = _myAccountId();
    return captain > 0 && me > 0 && captain === me;
  });

  function _isCacheFresh(key, meta = '') {
    const ttl = Number(_cacheTtlMs[key] || 0);
    if (ttl <= 0) return false;
    if (String(_cacheMeta[key] || '') !== String(meta || '')) return false;
    return (Date.now() - Number(_cacheAt[key] || 0)) <= ttl;
  }

  function _markCacheFresh(key, meta = '') {
    _cacheMeta[key] = String(meta || '');
    _cacheAt[key] = Date.now();
  }

  function setTeamActionError(msg = '') {
    teamActionError.value = String(msg || '').trim();
  }

  function handleTeamActionResult(r, okMsg, failMsg) {
    if (!r) {
      setTeamActionError(failMsg || '操作失败');
      return false;
    }
    if (!r.ok) {
      const msg = String(r.error || failMsg || '操作失败');
      setTeamActionError(msg);
      _showToast(msg);
      return false;
    }
    setTeamActionError('');
    if (r.player) _applyPlayer(r.player);
    _showToast(r.msg || okMsg || '操作成功');
    return true;
  }

  const learnedSkills = computed(() => {
    const lvMap = _player?.skill_levels || {};
    const learnedIds = Object.keys(lvMap)
      .map(k => Number(k))
      .filter(id => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b);
    const allSkills = Array.isArray(_gameData.skills) ? _gameData.skills : [];
    const byId = new Map(allSkills.map(s => [Number(s?.id || 0), s]));
    return learnedIds.map(id => {
      const data = byId.get(id) || null;
      return {
        id,
        level: Math.max(1, Number(lvMap[String(id)]?.level || lvMap[String(id)] || 1)),
        name: data?.name || `技能${id}`
      };
    });
  });

  function _myAccountId() {
    const aid = Number(status.value?.my_account_id || _player?.account_id || 0);
    return Number.isFinite(aid) && aid > 0 ? Math.trunc(aid) : 0;
  }

  function _normalizeSkillList(list) {
    const learnedSet = new Set(learnedSkills.value.map(s => Number(s.id)));
    const ids = [];
    for (const x of (Array.isArray(list) ? list : [])) {
      const id = Number(x);
      if (!Number.isFinite(id) || id <= 0 || !learnedSet.has(id)) continue;
      if (!ids.includes(id)) ids.push(id);
      if (ids.length >= 5) break;
    }
    return ids;
  }

  function resetSkillSelectionByPlayer() {
    const equipped = _normalizeSkillList(_player?.equipped_skills || []);
    skillSelected.value = equipped;
    const keyId = Number(_player?.key_skill_id || 0);
    skillKeyId.value = equipped.includes(keyId) ? keyId : (equipped[0] || 0);
    if (!skillMemberAccountId.value) skillMemberAccountId.value = _myAccountId();
  }

  function applySkillSelectionFromLeagueStatus() {
    const raw = status.value?.my_skill_config;
    if (!raw || typeof raw !== 'object') return false;
    const equipped = _normalizeSkillList(raw.equipped_skills || []);
    if (equipped.length <= 0) return false;
    const keyId = Number(raw.key_skill_id || 0);
    skillSelected.value = equipped;
    skillKeyId.value = equipped.includes(keyId) ? keyId : (equipped[0] || 0);
    return true;
  }

  function toggleSkillSelect(skillId) {
    const id = Number(skillId);
    if (!Number.isFinite(id) || id <= 0) return;
    const idx = skillSelected.value.indexOf(id);
    if (idx >= 0) {
      skillSelected.value.splice(idx, 1);
      if (skillKeyId.value === id) skillKeyId.value = skillSelected.value[0] || 0;
      return;
    }
    if (skillSelected.value.length >= 5) {
      _showToast('最多选择5个技能');
      return;
    }
    const learnedSet = new Set(learnedSkills.value.map(s => Number(s.id)));
    if (!learnedSet.has(id)) {
      _showToast('仅可选择已学习技能');
      return;
    }
    skillSelected.value.push(id);
    if (!skillKeyId.value) skillKeyId.value = id;
  }

  async function loadStatus(force = false) {
    const cacheMeta = 'status';
    if (!force && _isCacheFresh('status', cacheMeta)) return true;
    loading.value = true;
    const r = await safe(() => api.leagueStatus());
    loading.value = false;
    if (!r) return false;
    if (!r.ok) { _showToast(r.error || '获取联赛状态失败'); return false; }
    status.value = r;
    if (status.value?.my_league && Number.isFinite(Number(status.value.my_league.league_points))) {
      shopPoints.value = Math.max(0, Math.trunc(Number(status.value.my_league.league_points)));
    }
    if (!skillMemberAccountId.value) skillMemberAccountId.value = _myAccountId();
    const applied = applySkillSelectionFromLeagueStatus();
    if (!applied && (!Array.isArray(skillSelected.value) || skillSelected.value.length <= 0)) {
      resetSkillSelectionByPlayer();
    }
    _markCacheFresh('status', cacheMeta);
    return true;
  }

  async function createTeam() {
    const name = String(createName.value || '').trim();
    if (!name) {
      setTeamActionError('请输入队伍名称');
      _showToast('请输入队伍名称');
      return;
    }
    const r = await safe(() => api.leagueTeamCreate(name));
    if (!handleTeamActionResult(r, '队伍创建成功', '队伍创建失败')) return;
    createName.value = '';
    await loadStatus(true);
  }

  async function joinTeam() {
    const code = String(joinCode.value || '').trim().toUpperCase();
    if (!code) {
      setTeamActionError('请输入队伍加入码');
      _showToast('请输入队伍加入码');
      return;
    }
    const r = await safe(() => api.leagueTeamJoin(code));
    if (!handleTeamActionResult(r, '加入队伍成功', '加入队伍失败')) return;
    joinCode.value = '';
    await loadStatus(true);
  }

  async function leaveTeam() {
    const r = await safe(() => api.leagueTeamLeave());
    if (!handleTeamActionResult(r, '已退出队伍', '退出队伍失败')) return;
    await loadStatus(true);
  }

  async function registerNow(mode = '') {
    const m = String(mode || registerMode.value || 'team').toLowerCase();
    const r = await safe(() => api.leagueRegister(m));
    if (!handleTeamActionResult(r, '报名成功', '报名失败')) return;
    await loadStatus(true);
  }

  async function cancelSoloRegister() {
    const team = registrationTeam.value;
    if (!team || String(team.mode || '') !== 'system') {
      setTeamActionError('当前不是单人匹配队伍');
      _showToast('当前不是单人匹配队伍');
      return;
    }
    const r = await safe(() => api.leagueCancelSoloRegister());
    if (!handleTeamActionResult(r, '已取消单人匹配', '取消单人匹配失败')) return;
    await loadStatus(true);
  }

  async function cancelTeamRegister() {
    const team = registrationTeam.value;
    if (!team || String(team.mode || '') === 'system') {
      setTeamActionError('当前不是可取消报名的组队队伍');
      _showToast('当前不是可取消报名的组队队伍');
      return;
    }
    if (!team.registered) {
      setTeamActionError('当前队伍尚未报名');
      _showToast('当前队伍尚未报名');
      return;
    }
    if (!Boolean(timeline.value?.registration_open)) {
      setTeamActionError('当前不在联赛报名期');
      _showToast('当前不在联赛报名期');
      return;
    }
    const captain = Number(team.captain_account_id || 0);
    const me = _myAccountId();
    if (!(captain > 0 && me > 0 && captain === me)) {
      setTeamActionError('仅队长可取消队伍报名');
      _showToast('仅队长可取消队伍报名');
      return;
    }
    const r = await safe(() => api.leagueCancelTeamRegister());
    if (!handleTeamActionResult(r, '已取消队伍报名（保留组队）', '取消队伍报名失败')) return;
    await loadStatus(true);
  }

  async function saveSkillConfig() {
    const equipped = _normalizeSkillList(skillSelected.value || []);
    if (equipped.length <= 0) { _showToast('请至少选择1个技能'); return; }
    const keyId = Number(skillKeyId.value || 0);
    const finalKey = equipped.includes(keyId) ? keyId : equipped[0];
    const r = await safe(() => api.leagueTeamSkills(0, equipped, finalKey));
    if (!hr(r, '技能组已保存')) return;
    await loadStatus(true);
  }

  async function loadLeaderboard(limit = null, force = false) {
    const lim = Number(limit == null ? leaderboardLimit.value : limit);
    const finalLimit = Number.isFinite(lim) ? Math.max(1, Math.min(500, Math.trunc(lim))) : 100;
    leaderboardLimit.value = finalLimit;
    const cacheMeta = String(finalLimit);
    if (!force && _isCacheFresh('leaderboard', cacheMeta)) return true;
    const r = await safe(() => api.leagueLeaderboard(finalLimit));
    if (!r?.ok) { if (r) _showToast(r.error || '获取排行榜失败'); return false; }
    leaderboard.value = Array.isArray(r.list) ? r.list : [];
    _markCacheFresh('leaderboard', cacheMeta);
    return true;
  }

  async function loadTeamRank(weekStart = null, limit = null, force = false) {
    const sid = Number(weekStart == null ? teamRankWeekStart.value : weekStart);
    const lim = Number(limit == null ? teamRankLimit.value : limit);
    teamRankWeekStart.value = Number.isFinite(sid) ? Math.max(0, Math.trunc(sid)) : 0;
    teamRankLimit.value = Number.isFinite(lim) ? Math.max(1, Math.min(500, Math.trunc(lim))) : 100;
    const cacheMeta = `${teamRankWeekStart.value}:${teamRankLimit.value}`;
    if (!force && _isCacheFresh('teamRank', cacheMeta)) return true;

    const r = await safe(() => api.leagueTeamRank(teamRankWeekStart.value, teamRankLimit.value));
    if (!r?.ok) { if (r) _showToast(r.error || '获取队伍排行失败'); return false; }

    const serverWeekStart = Number(r.week_start || r.season_id || 0);
    if (Number.isFinite(serverWeekStart) && serverWeekStart > 0) {
      teamRankWeekStart.value = Math.trunc(serverWeekStart);
    }
    teamRankMyTeamId.value = Math.max(0, Math.trunc(Number(r.my_team_id || 0)));
    teamRank.value = Array.isArray(r.list) ? r.list : [];
    _markCacheFresh('teamRank', `${teamRankWeekStart.value}:${teamRankLimit.value}`);
    return true;
  }

  async function loadMatches(weekStart = null, limit = null, force = false) {
    const sid = Number(weekStart == null ? matchWeekStart.value : weekStart);
    const lim = Number(limit == null ? matchLimit.value : limit);
    matchWeekStart.value = Number.isFinite(sid) ? Math.max(0, Math.trunc(sid)) : 0;
    matchLimit.value = Number.isFinite(lim) ? Math.max(1, Math.min(200, Math.trunc(lim))) : 30;
    const cacheMeta = `${matchWeekStart.value}:${matchLimit.value}`;
    if (!force && _isCacheFresh('matches', cacheMeta)) return true;

    const r = await safe(() => api.leagueMatches(matchWeekStart.value, matchLimit.value));
    if (!r?.ok) { if (r) _showToast(r.error || '获取战报失败'); return false; }
    const serverWeekStart = Number(r.week_start || r.season_id || 0);
    if (Number.isFinite(serverWeekStart) && serverWeekStart > 0) {
      matchWeekStart.value = Math.trunc(serverWeekStart);
    }
    matchTeam.value = r.team || null;
    matchScope.value = String(r.scope || 'self_team_only');
    matches.value = Array.isArray(r.list) ? r.list : [];
    const keepExpanded = Object.create(null);
    for (const row of matches.value) {
      const key = _matchLogKey(row);
      if (key && matchLogExpanded.value[key]) keepExpanded[key] = true;
    }
    matchLogExpanded.value = keepExpanded;
    _markCacheFresh('matches', `${matchWeekStart.value}:${matchLimit.value}`);
    return true;
  }

  function isMyTeamRankRow(r) {
    const myId = Number(teamRankMyTeamId.value || 0);
    if (!Number.isFinite(myId) || myId <= 0) return false;
    return Number(r?.id || 0) === myId;
  }

  function _normalizeShopQty(v, maxBatch = 200) {
    const cap = Number.isFinite(Number(maxBatch)) ? Math.max(1, Math.min(999, Math.trunc(Number(maxBatch)))) : 200;
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(cap, Math.trunc(n)));
  }

  function getShopQty(itemId) {
    const id = String(itemId || '').trim();
    if (!id) return 1;
    const g = (shopGoods.value || []).find(x => String(x.id || '') === id);
    return _normalizeShopQty(shopQty.value[id], Number(g?.max_batch || 200));
  }

  function setShopQty(itemId, val) {
    const id = String(itemId || '').trim();
    if (!id) return;
    const g = (shopGoods.value || []).find(x => String(x.id || '') === id);
    const next = _normalizeShopQty(val, Number(g?.max_batch || 200));
    shopQty.value = { ...shopQty.value, [id]: next };
  }

  async function loadShop(force = false) {
    const cacheMeta = 'shop';
    if (!force && _isCacheFresh('shop', cacheMeta)) return true;
    const r = await safe(() => api.leagueShop());
    if (!r?.ok) { if (r) _showToast(r.error || '获取联赛商店失败'); return false; }
    shopGoods.value = Array.isArray(r.goods) ? r.goods : [];
    shopPoints.value = Math.max(0, Math.trunc(Number(r.my_league_points || 0)));

    const nextQty = { ...(shopQty.value || {}) };
    for (const g of shopGoods.value) {
      const gid = String(g.id || '').trim();
      if (!gid) continue;
      nextQty[gid] = _normalizeShopQty(nextQty[gid], Number(g.max_batch || 200));
    }
    shopQty.value = nextQty;

    if (status.value && status.value.my_league) {
      status.value.my_league.league_points = shopPoints.value;
    }
    _markCacheFresh('shop', cacheMeta);
    return true;
  }

  async function buyShop(itemId) {
    const id = String(itemId || '').trim();
    if (!id) { _showToast('无效商品'); return; }
    const g = (shopGoods.value || []).find(x => String(x.id || '') === id);
    if (!g) { _showToast('商品不存在'); return; }

    const qty = getShopQty(id);
    const isLimited = !!g.limited || Number(g.limit || 0) > 0;
    if (isLimited && qty > 1) {
      _showToast('限购商品不支持批量购买');
      return;
    }

    const r = await safe(() => api.leagueShopBuy(id, qty));
    if (!r?.ok) { if (r) _showToast(r.error || '购买失败'); return; }

    shopPoints.value = Math.max(0, Math.trunc(Number(r.my_league_points || 0)));
    if (status.value && status.value.my_league) {
      status.value.my_league.league_points = shopPoints.value;
    }

    const drops = Array.isArray(r.drops)
      ? r.drops.map(d => `${d.name}x${d.count}`).join('、')
      : '';
    _showToast(`购买成功，消耗${Number(r.spent || 0)}联赛积分${drops ? `，获得${drops}` : ''}`);
    await loadShop(true);
  }

  async function runDue() {
    const r = await safe(() => api.leagueRunDue());
    if (!r?.ok) { if (r) _showToast(r.error || '联赛推进失败'); return; }
    runDueResult.value = r;
    _showToast(r.progressed ? '已推进联赛轮次' : '当前无可推进轮次');
    await Promise.all([
      loadStatus(true),
      loadMatches(null, null, true),
      loadTeamRank(null, null, true),
      loadLeaderboard(null, true),
      loadShop(true)
    ]);
  }

  async function ensureTabData(tab = subTab.value, force = false) {
    const t = String(tab || 'status');
    if (t === 'status' || t === 'team') return loadStatus(force);
    if (t === 'matches') return loadMatches(null, null, force);
    if (t === 'rank') {
      await Promise.all([
        loadLeaderboard(null, force),
        loadTeamRank(null, null, force)
      ]);
      return true;
    }
    if (t === 'shop') return loadShop(force);
    return loadStatus(force);
  }

  async function switchSubTab(tab, force = false) {
    subTab.value = String(tab || 'status');
    return ensureTabData(subTab.value, force);
  }

  function matchResultText(m) {
    if (!m) return '-';
    if (String(m.result || '') === 'bye') return '轮空';
    if (String(m.result || '') === 'draw') return '平局';
    const myTeamId = Number(matchTeam.value?.id || 0);
    if (String(m.result || '') === 'a_win') return Number(m.team_a_id || 0) === myTeamId ? '胜利' : '失败';
    if (String(m.result || '') === 'b_win') return Number(m.team_b_id || 0) === myTeamId ? '胜利' : '失败';
    return String(m.result || '-');
  }

  function matchMyPoints(m) {
    if (!m) return 0;
    const myTeamId = Number(matchTeam.value?.id || 0);
    if (Number(m.team_a_id || 0) === myTeamId) return Number(m.points_a || 0);
    if (Number(m.team_b_id || 0) === myTeamId) return Number(m.points_b || 0);
    return 0;
  }

  function _matchLogKey(m) {
    if (!m || typeof m !== 'object') return '';
    const id = Number(m.id || 0);
    if (Number.isFinite(id) && id > 0) return `id:${id}`;
    const roundNo = Number(m.round_no || 0);
    const matchNo = Number(m.match_no || 0);
    const ts = Number(m.created_at || 0);
    return `k:${roundNo}:${matchNo}:${ts}`;
  }

  function isMatchLogExpanded(m) {
    const key = _matchLogKey(m);
    if (!key) return false;
    return !!matchLogExpanded.value[key];
  }

  function toggleMatchLog(m) {
    const key = _matchLogKey(m);
    if (!key) return;
    const next = { ...(matchLogExpanded.value || {}) };
    if (next[key]) delete next[key];
    else next[key] = true;
    matchLogExpanded.value = next;
  }

  function visibleMatchLogs(m) {
    const rows = Array.isArray(m?.logs) ? m.logs : [];
    if (!rows.length) return [];
    if (isMatchLogExpanded(m) || rows.length <= MATCH_LOG_PREVIEW_LINES) return rows;
    return rows.slice(-MATCH_LOG_PREVIEW_LINES);
  }

  function matchLogHiddenCount(m) {
    const total = Array.isArray(m?.logs) ? m.logs.length : 0;
    if (total <= MATCH_LOG_PREVIEW_LINES || isMatchLogExpanded(m)) return 0;
    return total - MATCH_LOG_PREVIEW_LINES;
  }

  return {
    subTab,
    status,
    loading,
    timeline,
    currentSeason,
    registrationSeason,
    registrationTeam,
    currentTeam,
    canShowCancelTeamRegister,
    canCancelTeamRegister,
    teamActionError,

    createName,
    joinCode,
    registerMode,
    runDueResult,

    shopGoods,
    shopPoints,
    shopQty,

    leaderboard,
    leaderboardLimit,
    teamRank,
    teamRankLimit,
    teamRankWeekStart,
    teamRankMyTeamId,
    matches,
    matchTeam,
    matchWeekStart,
    matchLimit,
    matchScope,
    matchLogExpanded,

    skillMemberAccountId,
    skillSelected,
    skillKeyId,
    learnedSkills,

    resetSkillSelectionByPlayer,
    toggleSkillSelect,
    switchSubTab,
    ensureTabData,

    loadStatus,
    createTeam,
    joinTeam,
    leaveTeam,
    registerNow,
    cancelSoloRegister,
    cancelTeamRegister,
    saveSkillConfig,
    loadLeaderboard,
    loadTeamRank,
    loadMatches,
    loadShop,
    buyShop,
    runDue,

    matchResultText,
    matchMyPoints,
    isMyTeamRankRow,
    isMatchLogExpanded,
    toggleMatchLog,
    visibleMatchLogs,
    matchLogHiddenCount,
    getShopQty,
    setShopQty,
  };
}

// ═══ 设置 ═══
export function useSettings() {
  const redeemCode = ref('');
  const invInfo = ref({});
  const invShop = ref([]);
  const invitees = ref([]);
  const bindCode = ref('');

  // ─ 邮箱绑定 ─
  const emailStatus = reactive({ bound: false, email: '', loading: false });
  const emailBindForm = reactive({ email: '', code: '', step: 1, loading: false, error: '', cooldown: 0 });
  let _emailCdTimer = null;
  const loadEmailStatus = async () => {
    emailStatus.loading = true;
    const r = await safe(() => api.emailStatus());
    emailStatus.loading = false;
    if (r?.ok) { emailStatus.bound = r.bound; emailStatus.email = r.email || ''; }
  };
  const emailSendCode = async () => {
    if (!emailBindForm.email.trim()) { emailBindForm.error = '请输入邮箱'; return; }
    if (emailBindForm.cooldown > 0) return;
    emailBindForm.loading = true; emailBindForm.error = '';
    const r = await safe(() => api.emailSendCode(emailBindForm.email.trim()));
    emailBindForm.loading = false;
    if (r?.ok) {
      emailBindForm.step = 2;
      emailBindForm.cooldown = 60;
      _emailCdTimer = setInterval(() => { emailBindForm.cooldown--; if (emailBindForm.cooldown <= 0) clearInterval(_emailCdTimer); }, 1000);
    } else { emailBindForm.error = r?.error || '发送失败'; }
  };
  const emailBind = async () => {
    if (!emailBindForm.code.trim()) { emailBindForm.error = '请输入验证码'; return; }
    emailBindForm.loading = true; emailBindForm.error = '';
    const r = await safe(() => api.emailBind(emailBindForm.email.trim(), emailBindForm.code.trim()));
    emailBindForm.loading = false;
    if (r?.ok) {
      _showToast('邮箱绑定成功');
      emailStatus.bound = true;
      emailStatus.email = emailBindForm.email.replace(/^(.{1}).*(@.+)$/, '$1***$2');
      Object.assign(emailBindForm, { email: '', code: '', step: 1, error: '', cooldown: 0 });
    } else { emailBindForm.error = r?.error || '绑定失败'; }
  };
  const emailUnbind = async () => {
    const r = await safe(() => api.emailUnbind());
    if (hr(r, '邮箱已解绑')) { emailStatus.bound = false; emailStatus.email = ''; }
  };

  // ─ 修改密码 ─
  const changePwdForm = reactive({ code: '', newPassword: '', step: 1, loading: false, error: '', cooldown: 0 });
  let _changePwdCdTimer = null;
  const changePwdSendCode = async () => {
    if (changePwdForm.cooldown > 0) return;
    changePwdForm.loading = true; changePwdForm.error = '';
    const r = await safe(() => api.changePasswordSendCode());
    changePwdForm.loading = false;
    if (r?.ok) {
      changePwdForm.step = 2;
      changePwdForm.cooldown = 60;
      _changePwdCdTimer = setInterval(() => { changePwdForm.cooldown--; if (changePwdForm.cooldown <= 0) clearInterval(_changePwdCdTimer); }, 1000);
    } else { changePwdForm.error = r?.error || '发送失败'; }
  };
  const changePwdConfirm = async () => {
    if (!changePwdForm.code.trim() || !changePwdForm.newPassword) { changePwdForm.error = '请填写验证码和新密码'; return; }
    changePwdForm.loading = true; changePwdForm.error = '';
    const r = await safe(() => api.changePasswordConfirm(changePwdForm.code.trim(), changePwdForm.newPassword));
    changePwdForm.loading = false;
    if (r?.ok) {
      _showToast('密码修改成功');
      Object.assign(changePwdForm, { code: '', newPassword: '', step: 1, error: '', cooldown: 0 });
    } else { changePwdForm.error = r?.error || '修改失败'; }
  };

  const redeem = async () => {
    if (!redeemCode.value.trim()) return;
    if (hr(await safe(() => api.redeem(redeemCode.value.trim())), '兑换成功')) redeemCode.value = '';
  };
  const loadInvInfo = async () => {
    const r = await safe(() => api.inviteInfo());
    if (r?.ok) {
      invInfo.value = r;
      storedStones.value = r.stored_stones || 0;
      perPersonStones.value = r.per_person_stones || 0;
    }
  };
  const loadInvShop = async () => { const r = await safe(() => api.inviteShopList()); if (r?.ok) invShop.value = r.items || []; };
  const loadInvitees = async () => { const r = await safe(() => api.inviteInvitees()); if (r?.ok) invitees.value = r.invitees || []; };
  const genInvCode = async () => { if (hr(await safe(() => api.inviteGenerate()), '邀请码已生成')) loadInvInfo(); };
  const bindInv = async () => {
    if (!bindCode.value.trim()) return;
    if (hr(await safe(() => api.inviteBind(bindCode.value.trim())), '绑定成功')) loadInvInfo();
  };
  const buyInvShop = async (itemId) => { hr(await safe(() => api.inviteShopBuy(itemId)), '购买成功'); };
  const claimInvPoints = async (accId) => { hr(await safe(() => api.inviteClaimPoints(accId)), '积分已领取'); };
  const reissueStones = async (accId) => {
    if (!confirm('确定对该被邀请人补发灵石？将从你的存储灵石中扣除。')) return;
    const r = await safe(() => api.inviteReissue(accId));
    if (hr(r, r?.message || '补发成功')) { loadInvitees(); loadInvInfo(); }
  };
  const cityBuy = async (itemId, count) => { hr(await safe(() => api.cityBuy(itemId, count)), '购买成功'); };
  const deleteClaimedMail = async () => { hr(await safe(() => api.mailDeleteClaimed()), '已删除'); };
  const setStorage = async (stored, perPerson) => {
    const r = await safe(() => api.inviteStorage(stored, perPerson));
    if (hr(r, '存储设置已更新')) {
      storedStones.value = r.stored_stones ?? stored;
      perPersonStones.value = r.per_person_stones ?? perPerson;
    }
  };
  const storedStones = ref(0);
  const perPersonStones = ref(0);

  const inviteePage = ref(0);
  const INVITEE_PAGE_SIZE = 20;
  const inviteePageCount = computed(() => Math.max(1, Math.ceil((invitees.value || []).length / INVITEE_PAGE_SIZE)));
  const inviteesPage = computed(() => (invitees.value || []).slice(inviteePage.value * INVITEE_PAGE_SIZE, (inviteePage.value + 1) * INVITEE_PAGE_SIZE));

  return {
    redeemCode, invInfo, invShop, invitees, bindCode,
    storedStones, perPersonStones,
    inviteePage, inviteePageCount, inviteesPage,
    redeem, loadInvInfo, loadInvShop, loadInvitees,
    genInvCode, bindInv, buyInvShop, claimInvPoints, reissueStones, cityBuy, deleteClaimedMail,
    setStorage,
    emailStatus, emailBindForm, loadEmailStatus, emailSendCode, emailBind, emailUnbind,
    changePwdForm, changePwdSendCode, changePwdConfirm,
  };
}
