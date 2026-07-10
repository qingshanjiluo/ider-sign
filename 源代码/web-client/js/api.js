import { getBrowserFingerprint } from './device-id.js';

const API_BASE = window.location.origin;

let _token = localStorage.getItem('game_token') || '';
let _gameData = null;
let _authVersion = 0;
let _onAuthExpired = null;

function setToken(t) {
  _token = t || '';
  _authVersion += 1;
  if (_token) localStorage.setItem('game_token', _token);
  else localStorage.removeItem('game_token');
}
function getToken() { return _token; }
function hasToken() { return !!_token; }
function setAuthExpiredHandler(handler) {
  _onAuthExpired = typeof handler === 'function' ? handler : null;
}

// ── WebSocket ──
let _ws = null;
let _wsReconnectTimer = null;
let _wsMessageHandler = null;
let _wsConnected = false;
let _wsPingTimer = null;

function _getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?token=${encodeURIComponent(_token)}`;
}

function connectWs() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  if (!_token) return;
  try {
    _ws = new WebSocket(_getWsUrl());
    _ws.onopen = () => {
      _wsConnected = true;
      if (_wsPingTimer) clearInterval(_wsPingTimer);
      _wsPingTimer = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send('{"type":"ping"}');
      }, 20000);
      _flushPendingWsState();
    };
    _ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pong') return;
        if (_wsMessageHandler) _wsMessageHandler(msg);
      } catch {}
    };
    _ws.onclose = (ev) => {
      _wsConnected = false;
      if (_wsPingTimer) { clearInterval(_wsPingTimer); _wsPingTimer = null; }
      if (ev.code !== 4002 && ev.code !== 4003 && _token) {
        _wsReconnectTimer = setTimeout(connectWs, 3000);
      }
    };
    _ws.onerror = () => {};
  } catch {}
}

function disconnectWs() {
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  if (_wsPingTimer) { clearInterval(_wsPingTimer); _wsPingTimer = null; }
  _wsConnected = false;
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
}

function isWsConnected() { return _wsConnected; }
function onWsMessage(handler) { _wsMessageHandler = handler; }

function wsSetAutoRestart(val) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'auto_restart', value: !!val }));
  }
}

let _pendingBattleDetail = null;
function wsSetBattleDetail(val) {
  _pendingBattleDetail = !!val;
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'battle_detail', value: !!val }));
  }
}
function _flushPendingWsState() {
  if (_pendingBattleDetail !== null && _ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'battle_detail', value: _pendingBattleDetail }));
  }
}

const CLIENT_VERSION = '1.2.4';

const _SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
let _hmacKeyPromise = null;

function _getHmacKey() {
  if (!_hmacKeyPromise) {
    _hmacKeyPromise = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(_SIGN_KEY),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
  }
  return _hmacKeyPromise;
}

async function _makeSign(method, path, timestamp, bodyStr) {
  const key = await _getHmacKey();
  const data = new TextEncoder().encode(`${method}\n${path}\n${timestamp}\n${bodyStr}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function request(method, path, body = null, extraHeaders = null, _opts = null) {
  const optsInner = _opts && typeof _opts === 'object' ? _opts : {};
  const retried401 = optsInner.retried401 === true;
  const tokenAtSend = _token;
  const authVersionAtSend = _authVersion;
  const headers = { 'Content-Type': 'application/json', 'X-Client-Version': CLIENT_VERSION };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  if (extraHeaders && typeof extraHeaders === 'object') Object.assign(headers, extraHeaders);

  const bodyStr = (body && method !== 'GET') ? JSON.stringify(body) : '';
  const ts = Math.floor(Date.now() / 1000);
  headers['X-Sign-T'] = String(ts);
  headers['X-Sign'] = await _makeSign(method, path, ts, bodyStr);

  const opts = { method, headers };
  if (bodyStr) opts.body = bodyStr;
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
    let data = {};
    let rawText = '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    } else {
      rawText = await res.text().catch(() => '');
      const trimmed = String(rawText || '').trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { data = JSON.parse(trimmed); } catch {}
      }
    }
    const errText = String(data?.error || '');

    if (res.status === 401) {
      const canRetry = !retried401 && tokenAtSend && _authVersion === authVersionAtSend && _token === tokenAtSend;
      if (canRetry) {
        return request(method, path, body, extraHeaders, { retried401: true });
      }
      // 二次重试后仍 401，视为登录态失效：包括“登录已过期/未登录/token”。
      const isExplicitExpired = errText.includes('登录已过期') || errText.includes('未登录') || errText.includes('token');
      if (isExplicitExpired && tokenAtSend && _authVersion === authVersionAtSend && _token === tokenAtSend) {
        setToken('');
        if (_onAuthExpired) {
          try { _onAuthExpired('登录已过期，请重新登录'); } catch {}
        }
      }
      throw new Error(errText || '请求未授权');
    }

    if (res.status === 409) {
      if (data.code === 'SESSION_REPLACED') {
        setToken('');
        alert('账号已在其他设备登录，当前会话已断开');
        location.reload();
        throw new Error('账号已在其他设备登录');
      }
    }

    if (res.status === 426) {
      throw new Error(data.error || '客户端版本过旧');
    }

    const plain = String(rawText || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const plainShort = plain.slice(0, 180);
    const fallback = plainShort || `${res.status} ${res.statusText || 'HTTP Error'}`;
    throw new Error(data.error || fallback || `请求失败(${res.status})`);
  }

  return res.json();
}

const _inflightRequests = new Map();

function _singleFlight(key, factory) {
  const k = String(key || '');
  if (!k) return factory();
  const hit = _inflightRequests.get(k);
  if (hit) return hit;
  const p = Promise.resolve().then(factory).finally(() => {
    if (_inflightRequests.get(k) === p) _inflightRequests.delete(k);
  });
  _inflightRequests.set(k, p);
  return p;
}

function _stableSerialize(v) {
  if (v == null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(_stableSerialize).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${_stableSerialize(v[k])}`).join(',')}}`;
}

function _requestSingleFlight(method, path, body = null, extraHeaders = null, keySuffix = '') {
  const suffix = keySuffix ? `:${keySuffix}` : '';
  const key = `${String(method || 'GET').toUpperCase()} ${path}${suffix}`;
  return _singleFlight(key, () => request(method, path, body, extraHeaders));
}

const api = {
  setToken, getToken, hasToken, setAuthExpiredHandler,

  // ── Auth ──
  async login(username, password) {
    const machine_id = await getBrowserFingerprint();
    const r = await request('POST', '/auth/login', { username, password, machine_id });
    if (r.ok && r.token) setToken(r.token);
    return r;
  },
  async register(username, password) {
    const machine_id = await getBrowserFingerprint();
    const r = await request('POST', '/auth/register', { username, password, machine_id });
    if (r.ok && r.token) setToken(r.token);
    return r;
  },
  logout() { setToken(''); },

  // ── Player ──
  sync() { return _requestSingleFlight('GET', '/player/sync', null, null, 'full'); },
  state() { return request('GET', '/player/state'); },
  createCharacter(name, spiritRoots) { return request('POST', '/player/create', { name, spirit_roots: spiritRoots }); },
  levelUp() { return request('POST', '/player/level_up'); },
  breakthrough() { return request('POST', '/player/breakthrough'); },
  equip(page, slotIndex, expectItemId) { return request('POST', '/player/equip', { page, slot_index: slotIndex, expect_item_id: expectItemId || 0 }); },
  unequip(slot) { return request('POST', '/player/unequip', { slot }); },
  useItem(page, slotIndex, count = 1, expectItemId, useOptions = null) {
    const body = { page, slot_index: slotIndex, count, expect_item_id: expectItemId || 0 };
    if (useOptions && typeof useOptions === 'object') body.use_options = useOptions;
    return request('POST', '/player/use_item', body);
  },
  renameCharacter(name) { return request('POST', '/player/rename', { name }); },
  sellItem(page, slotIndex, count = 1, expectItemId) { return request('POST', '/player/sell_item', { page, slot_index: slotIndex, count, expect_item_id: expectItemId || 0 }); },
  sortInventory() { return request('POST', '/player/inventory/sort'); },
  toggleInventoryLock(page, slotIndex, locked = null) {
    const body = { page, slot_index: slotIndex };
    if (locked !== null && locked !== undefined) body.locked = !!locked;
    return request('POST', '/player/inventory/lock', body);
  },
  setMap(mapId) { return request('POST', '/player/set_map', { map_id: mapId }); },
  equipSkill(skillId) { return request('POST', '/player/equip_skill', { skill_id: skillId }); },
  unequipSkill(skillId) { return request('POST', '/player/unequip_skill', { skill_id: skillId }); },
  setKeySkill(skillId) { return request('POST', '/player/set_key_skill', { skill_id: skillId }); },
  setTechnique(slot, techniqueId) { return request('POST', '/player/set_technique', { slot, technique_id: techniqueId }); },
  setTalisman(itemId) { return request('POST', '/player/set_talisman', { item_id: itemId }); },
  decomposeEquipment(page, slotIndex, expectItemId) { return request('POST', '/player/decompose_equipment', { page, slot_index: slotIndex, expect_item_id: expectItemId || 0 }); },
  decomposeEquipmentBatch(slots) { return request('POST', '/player/decompose_equipment', { slots }); },
  destinyUnlock(nodeId) { return request('POST', '/player/destiny/unlock', { node_id: nodeId }); },
  destinyReset() { return request('POST', '/player/destiny/reset', {}); },
  talentUnlock(nodeId) { return request('POST', '/player/talent/unlock', { node_id: nodeId }); },
  talentReset() { return request('POST', '/player/talent/reset', {}); },
  saveSkillPreset(preset, skills, keyId) { return request('POST', '/player/save_skill_preset', { preset, equipped_skills: skills, key_skill_id: keyId }); },
  applySkillPreset(preset) { return request('POST', '/player/apply_skill_preset', { preset }); },
  presetEquipSkill(preset, skillId) { return request('POST', '/player/preset_equip_skill', { preset, skill_id: skillId }); },
  presetUnequipSkill(preset, skillId) { return request('POST', '/player/preset_unequip_skill', { preset, skill_id: skillId }); },
  presetSetKeySkill(preset, skillId) { return request('POST', '/player/preset_set_key_skill', { preset, skill_id: skillId }); },
  playerWipe(confirmText) { return request('POST', '/player/wipe', { confirm_text: confirmText }); },
  agreementSeen() { return request('POST', '/player/agreement_seen', {}); },

  // ── Battle ──
  battleStart(mapId, pollMode, autoRestart) {
    const body = { mapId, poll_mode: Boolean(pollMode), auto_restart: Boolean(autoRestart) };
    return _requestSingleFlight('POST', '/battle/start', body, null, _stableSerialize(body));
  },
  battleCommand(battleId, cmdBody) {
    const body = { battleId, ...cmdBody };
    return _requestSingleFlight('POST', '/battle/command', body, null, _stableSerialize(body));
  },
  battleState(battleId) { return request('GET', `/battle/state/${battleId}`); },
  battlePoll(afterIdx, autoRestart) {
    const after = Math.max(0, afterIdx || 0);
    const ar = autoRestart ? '1' : '0';
    const path = `/battle/poll?after=${after}&auto_restart=${ar}`;
    return _requestSingleFlight('GET', path, null, null, `${after}:${ar}`);
  },
  battleSetAutoRestart(enabled, mapId) {
    const body = { enabled: !!enabled };
    const mid = Number(mapId);
    if (Number.isFinite(mid) && mid > 0) body.map_id = Math.floor(mid);
    return request('POST', '/battle/auto_restart', body);
  },

  // ── Dungeon ──
  dungeonList() { return request('GET', '/dungeon/list'); },
  dungeonDetail(id) { return request('GET', `/dungeon/${id}`); },
  dungeonTeamCreate() { return request('POST', '/dungeon/team/create', {}); },
  dungeonTeamJoin(teamCode) { return request('POST', '/dungeon/team/join', { team_code: teamCode }); },
  dungeonTeamInfo(teamCode) { return request('GET', `/dungeon/team/${encodeURIComponent(teamCode)}`); },
  dungeonTeamMine() { return request('GET', '/dungeon/team/mine'); },
  dungeonTeamLeave(teamCode) { return request('POST', '/dungeon/team/leave', { team_code: teamCode }); },
  dungeonTeamKick(teamCode, targetAccountId) {
    return request('POST', '/dungeon/team/kick', {
      team_code: teamCode,
      target_account_id: Number(targetAccountId) || 0
    });
  },
  dungeonBattleStart(dungeonId, teamCode, dungeonMode = 'normal', extra = null) {
    const mode = String(dungeonMode || 'normal').toLowerCase() === 'formation' ? 'formation' : 'normal';
    const body = {
      dungeon_id: dungeonId,
      dungeon_mode: mode,
      ...(teamCode ? { team_code: teamCode } : {})
    };
    if (extra && typeof extra === 'object') {
      if (typeof extra.challenge_mode === 'string' && extra.challenge_mode) {
        body.challenge_mode = String(extra.challenge_mode);
      }
      if (Array.isArray(extra.contract_modifiers)) {
        body.contract_modifiers = extra.contract_modifiers.map(v => String(v || '').trim()).filter(Boolean);
      }
    }
    return _requestSingleFlight('POST', '/dungeon-battle/start', body, null, _stableSerialize(body));
  },
  dungeonBattleAdvance(battleId, opts = null) {
    const stateMode = String(opts?.state || 'lite').trim().toLowerCase() === 'full' ? 'full' : 'lite';
    const body = { battle_id: battleId };
    return _requestSingleFlight('POST', `/dungeon-battle/advance?state=${stateMode}`, body, null, `${String(battleId || '')}:${stateMode}`);
  },

  // ── City Duel ──
  cityDuelList(page = 1, pageSize = 30, keyword = '') {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const ps = Math.max(10, Math.min(100, Math.floor(Number(pageSize) || 30)));
    const kw = String(keyword || '').trim();
    const q = kw
      ? `?page=${p}&page_size=${ps}&keyword=${encodeURIComponent(kw)}`
      : `?page=${p}&page_size=${ps}`;
    return request('GET', `/dungeon-battle/city_duel/list${q}`);
  },
  cityDuelStart(targetAccountId) {
    const body = { target_account_id: targetAccountId };
    return _requestSingleFlight('POST', '/dungeon-battle/city_duel/start', body, null, String(targetAccountId || ''));
  },
  cityDuelInspect(targetAccountId) { return request('GET', `/dungeon-battle/city_duel/inspect?target_account_id=${targetAccountId}`); },
  cityDuelLogs(page = 1, pageSize = 20, role = 'all') { return request('GET', `/dungeon-battle/city_duel/logs?page=${page}&page_size=${pageSize}&role=${role}`); },
  cityDuelRank() { return request('GET', '/dungeon-battle/city_duel/rank'); },

  // ── League ──
  leagueStatus() { return request('GET', '/league/status'); },
  leagueTeamCreate(name) { return request('POST', '/league/team/create', { name }); },
  leagueTeamJoin(teamCode) { return request('POST', '/league/team/join', { team_code: teamCode }); },
  leagueTeamLeave() { return request('POST', '/league/team/leave', {}); },
  leagueRegister(mode = 'team') { return request('POST', '/league/register', { mode }); },
  leagueCancelSoloRegister() { return request('POST', '/league/register/cancel_solo', {}); },
  leagueCancelTeamRegister() { return request('POST', '/league/register/cancel_team', {}); },
  leagueTeamSkills(memberAccountId, equippedSkills, keySkillId) {
    return request('POST', '/league/team/skills', {
      member_account_id: memberAccountId,
      equipped_skills: equippedSkills,
      key_skill_id: keySkillId
    });
  },
  leagueLeaderboard(limit = 100) { return request('GET', `/league/leaderboard?limit=${Math.max(1, limit || 100)}`); },
  leagueTeamRank(weekStart = 0, limit = 100) {
    return request('GET', `/league/team_rank?week_start=${Math.max(0, weekStart || 0)}&limit=${Math.max(1, limit || 100)}`);
  },
  leagueMatches(weekStart = 0, limit = 50) {
    return request('GET', `/league/matches?week_start=${Math.max(0, weekStart || 0)}&limit=${Math.max(1, limit || 50)}`);
  },
  leagueShop() { return request('GET', '/league/shop'); },
  leagueShopBuy(itemId, quantity = 1) {
    return request('POST', '/league/shop/buy', {
      item_id: String(itemId || ''),
      quantity: Math.max(1, Math.floor(Number(quantity) || 1))
    });
  },
  leagueRunDue() { return request('POST', '/league/run_due', {}); },

  // ── Trial ──
  trialContracts() { return request('GET', '/trial/contracts'); },
  trialShop() { return request('GET', '/trial/shop'); },
  trialShopBuy(itemId, quantity = 1) {
    return request('POST', '/trial/shop/buy', {
      item_id: String(itemId || '').trim(),
      quantity: Math.max(1, Math.floor(Number(quantity) || 1))
    });
  },
  trialStart() { return _requestSingleFlight('POST', '/trial/start', {}, null, 'start'); },
  trialAdvance(battleId, opts = null) {
    const stateMode = String(opts?.state || 'lite').trim().toLowerCase() === 'full' ? 'full' : 'lite';
    const body = { battle_id: battleId };
    return _requestSingleFlight('POST', `/trial/advance?state=${stateMode}`, body, null, `${String(battleId || '')}:${stateMode}`);
  },

  // ── Mail ──
  mailList() { return request('GET', '/mail/list'); },
  mailClaim(id) { return request('POST', `/mail/claim/${id}`); },
  mailClaimAll() { return request('POST', '/mail/claim_all'); },
  mailDeleteClaimed() { return request('POST', '/mail/delete_claimed'); },

  // ── Online: Alchemy/Forging/Baiyi ──
  alchemyStart(ingredients, batchCount = 1) { return request('POST', '/online/alchemy/start', { selected_ingredients: ingredients, batch_count: batchCount }); },
  forgingStart(equipType, mainItemId, mainCount, lingItemId, catalystItemId) {
    return request('POST', '/online/forging/start', { equip_type: equipType, main_item_id: mainItemId, main_count: mainCount, ling_item_id: lingItemId, catalyst_item_id: catalystItemId });
  },
  forgingUpgrade(equipPage, equipSlot, materialItemId, materialCount, mode, expectItemId = 0) {
    return request('POST', '/online/forging/upgrade', {
      equip_page: equipPage,
      equip_slot: equipSlot,
      material_item_id: materialItemId,
      material_count: materialCount,
      mode,
      expect_item_id: expectItemId || 0
    });
  },
  forgingUpgradeAffix(equipPage, equipSlot, affixIndex, materialItemId, materialCount, mode, affixMode = 'upgrade', expectItemId = 0) {
    return request('POST', '/online/forging/upgrade_affix', {
      equip_page: equipPage,
      equip_slot: equipSlot,
      affix_index: affixIndex,
      material_item_id: materialItemId,
      material_count: materialCount,
      mode,
      affix_mode: affixMode,
      expect_item_id: expectItemId || 0
    });
  },
  forgingReroll(equipPage, equipSlot, lingItemId, lockIndices = [], expectItemId = 0) {
    return request('POST', '/online/forging/reroll', {
      equip_page: equipPage,
      equip_slot: equipSlot,
      ling_item_id: lingItemId,
      lock_indices: lockIndices,
      expect_item_id: expectItemId || 0
    });
  },
  forgingRerollAffixTier(equipPage, equipSlot, affixIndex, materialItemId, expectItemId = 0) {
    return request('POST', '/online/forging/reroll_affix_tier', {
      equip_page: equipPage,
      equip_slot: equipSlot,
      affix_index: affixIndex,
      material_item_id: materialItemId,
      expect_item_id: expectItemId || 0
    });
  },
  forgingInherit(sourceEquipPage, sourceEquipSlot, targetEquipPage, targetEquipSlot, materialItemId, expectSourceItemId = 0, expectTargetItemId = 0) {
    return request('POST', '/online/forging/inherit', {
      source_equip_page: sourceEquipPage,
      source_equip_slot: sourceEquipSlot,
      target_equip_page: targetEquipPage,
      target_equip_slot: targetEquipSlot,
      material_item_id: materialItemId,
      expect_source_item_id: expectSourceItemId || 0,
      expect_target_item_id: expectTargetItemId || 0
    });
  },
  forgingZaohua(equipPage, equipSlot, expectItemId = 0) {
    return request('POST', '/online/forging/zaohua', {
      equip_page: equipPage,
      equip_slot: equipSlot,
      expect_item_id: expectItemId || 0
    });
  },
  baiyiCraftStart(recipeId, batchCount = 1) { return request('POST', '/online/baiyi/craft/start', { recipe_id: recipeId, batch_count: batchCount }); },
  baiyiArrayStart(arrayType) { return request('POST', '/online/baiyi/array/start', { array_type: arrayType }); },
  redeem(code) { return request('POST', '/online/redeem', { code }); },

  // ── Online: Cave (洞府) ──
  caveStatus() { return request('GET', '/online/cave/status'); },
  caveStart(type) { return request('POST', '/online/cave/start', { type }); },
  caveStop() { return request('POST', '/online/cave/stop', {}); },
  caveUpgrade() { return request('POST', '/online/cave/upgrade', {}); },
  caveFormationPlace(pieceUid, targetIndex) {
    return request('POST', '/online/cave/formation/place', { piece_uid: pieceUid, target_index: targetIndex });
  },
  caveFormationPick(sourceIndex) {
    return request('POST', '/online/cave/formation/pick', { source_index: sourceIndex });
  },
  caveFormationMove(fromIndex, toIndex) {
    return request('POST', '/online/cave/formation/move', { from_index: fromIndex, to_index: toIndex });
  },
  caveFormationRotate(sourceIndex, turns = 1) {
    return request('POST', '/online/cave/formation/rotate', { source_index: sourceIndex, turns });
  },
  caveFormationClear() {
    return request('POST', '/online/cave/formation/clear', {});
  },
  caveFormationDecomposePlate(pieceUid) {
    return request('POST', '/online/cave/formation/decompose_plate', { piece_uid: pieceUid });
  },
  caveFormationDecomposeRune(pieceUid) {
    return request('POST', '/online/cave/formation/decompose_rune', { piece_uid: pieceUid });
  },
  caveFormationServiceSet(skillId, active, instanceKey = '') {
    return request('POST', '/online/cave/formation/service/set', { skill_id: skillId, instance_key: instanceKey, active: !!active });
  },

  // ── Online: Disciple (传人) ──
  discipleStatus() { return request('GET', '/online/disciple/status'); },
  discipleCreate(name) { return request('POST', '/online/disciple/create', { name }); },
  discipleRename(name) { return request('POST', '/online/disciple/rename', { name }); },
  discipleEquip(slot, page, slotIndex) { return request('POST', '/online/disciple/equip', { slot, page, slotIndex }); },
  discipleUnequip(slot) { return request('POST', '/online/disciple/unequip', { slot }); },
  discipleSend(mapId, materialFilter) { return request('POST', '/online/disciple/send', { map_id: mapId, material_filter: materialFilter }); },
  discipleRecall() { return request('POST', '/online/disciple/recall', {}); },

  discipleBattleStatus() { return request('GET', '/online/disciple-battle/status'); },
  discipleBattleDraw() { return request('POST', '/online/disciple-battle/draw', {}); },
  discipleBattleEquip(slotIndex, sourceId) { return request('POST', '/online/disciple-battle/equip', { slotIndex, sourceId }); },
  discipleBattleUnequip(slotIndex) { return request('POST', '/online/disciple-battle/unequip', { slotIndex }); },
  discipleBattleShopBuy(pillId) { return request('POST', '/online/disciple-battle/shop/buy', { pillId }); },
  discipleBattlePointsShopBuy(itemId) { return request('POST', '/online/disciple-battle/points-shop/buy', { itemId }); },
  discipleBattleMatch() { return request('POST', '/online/disciple-battle/match', {}); },
  discipleBattleCancelMatch() { return request('POST', '/online/disciple-battle/cancel-match', {}); },
  discipleBattleRoom(roomId) { return request('GET', `/online/disciple-battle/room/${roomId}`); },
  discipleBattleAction(roomId, skillSourceId) { return request('POST', '/online/disciple-battle/action', { roomId, skillSourceId }); },

  // ── Online: Sect ──
  sectJoin(sectId) { return request('POST', '/online/sect/join', { sect_id: sectId }); },
  sectLeave() { return request('POST', '/online/sect/leave', {}); },
  sectMemberCounts() { return request('GET', '/online/sect/member_counts'); },
  sectContribute(itemId, count) { return request('POST', '/online/sect/contribute', { item_id: itemId, count }); },
  sectLearn(type, id, cost, levelReq, needBasicGe3, needIntermediateGe4) {
    return request('POST', '/online/sect/learn', { type, id, cost, level_req: levelReq, need_basic_ge3: needBasicGe3, need_intermediate_ge4: needIntermediateGe4 });
  },
  sectTreasuryList() { return request('GET', '/online/sect/treasury/list'); },
  sectTreasuryRefresh() { return request('POST', '/online/sect/treasury/refresh', {}); },
  sectTreasuryBuy(index, count = 1) { return request('POST', '/online/sect/treasury/buy', { index, count }); },
  sectTreasuryBuyBasicWeapon() { return request('POST', '/online/sect/treasury/buy_basic_weapon', {}); },
  sectTreasuryBuyBasicArmor(armorType) { return request('POST', '/online/sect/treasury/buy_basic_armor', { armor_type: armorType }); },
  sectLundaodianSelect(sectId) { return request('POST', '/online/sect/lundaodian/select', { sect_id: sectId }); },
  sectLundaodianLearn(type, id) { return request('POST', '/online/sect/lundaodian/learn', { type, id }); },
  sectTasks() { return request('GET', '/online/sect/tasks'); },
  sectTaskRefresh() { return request('POST', '/online/sect/tasks/refresh', {}); },
  sectTaskAccept(slotIndex) { return request('POST', '/online/sect/tasks/accept', { slot_index: slotIndex }); },
  sectTaskAbandon(slotIndex) { return request('POST', '/online/sect/tasks/abandon', { slot_index: slotIndex }); },
  sectTaskComplete(slotIndex) { return request('POST', '/online/sect/tasks/complete', { slot_index: slotIndex }); },
  cityBuy(itemId, count = 1) { return request('POST', '/online/city/buy', { item_id: itemId, count }); },

  // ── Exchange ──
  exchangeListings(page = 1, pageSize = 20, filters = {}) {
    let q = `/exchange/listings?page=${page}&page_size=${pageSize}`;
    for (const k of ['side', 'keyword', 'sort_by', 'category', 'subtype']) { if (filters[k] && filters[k] !== 'all') q += `&${k}=${encodeURIComponent(filters[k])}`; }
    for (const k of ['item_id', 'min_price', 'max_price']) { if (filters[k] > 0) q += `&${k}=${filters[k]}`; }
    if (Number(filters.quality) > 0) q += `&quality=${Math.floor(Number(filters.quality))}`;
    return request('GET', q);
  },
  exchangeMyListings() { return request('GET', '/exchange/my/listings'); },
  exchangeCreateListing(page, slotIndex, quantity, unitPrice, expectItemId = 0) {
    return request('POST', '/exchange/listings', {
      page,
      slot_index: slotIndex,
      quantity,
      unit_price: unitPrice,
      expect_item_id: expectItemId || 0
    });
  },
  exchangeQuote(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '') continue;
      qs.append(k, String(v));
    }
    return request('GET', `/exchange/quote?${qs.toString()}`);
  },
  exchangeBuy(listingId, quantity = 1, marketToken = '') {
    const token = String(marketToken || '');
    return request('POST', '/exchange/buy', { listing_id: listingId, quantity, market_token: token }, token ? { 'X-Market-Token': token } : null);
  },
  exchangeCancelListing(listingId) { return request('POST', `/exchange/listings/${listingId}/cancel`, {}); },
  exchangeItemSearch(q) { return request('GET', `/exchange/item_search?q=${encodeURIComponent(q)}`); },
  exchangeBuyOrders(itemIdOrPayload, itemName, quantity, unitPrice, options = {}) {
    if (itemIdOrPayload && typeof itemIdOrPayload === 'object' && !Array.isArray(itemIdOrPayload)) {
      return request('POST', '/exchange/buy_orders', itemIdOrPayload);
    }
    const payload = { item_id: itemIdOrPayload || 0, item_name: itemName, quantity, unit_price: unitPrice };
    if (Number(options?.barter_pay_item_id) > 0) payload.barter_pay_item_id = Number(options.barter_pay_item_id);
    if (Number(options?.barter_pay_unit_count) > 0) payload.barter_pay_unit_count = Number(options.barter_pay_unit_count);
    return request('POST', '/exchange/buy_orders', payload);
  },
  exchangeFulfillBuy(listingId, quantity, marketToken = '') {
    const token = String(marketToken || '');
    return request('POST', '/exchange/fulfill_buy', { listing_id: listingId, quantity, market_token: token }, token ? { 'X-Market-Token': token } : null);
  },
  exchangeEquipBuyOrder(itemName, quantity, unitPrice, equipmentCriteria) {
    return request('POST', '/exchange/buy_orders', { item_name: itemName, quantity, unit_price: unitPrice, equipment_criteria: equipmentCriteria });
  },
  exchangeFulfillBuyEquip(listingId, page, slotIndex, expectItemId = 0, marketToken = '') {
    const token = String(marketToken || '');
    return request('POST', '/exchange/fulfill_buy', {
      listing_id: listingId,
      page,
      slot_index: slotIndex,
      expect_item_id: expectItemId || 0,
      market_token: token
    }, token ? { 'X-Market-Token': token } : null);
  },

  // ── Alliance ──
  allianceList() { return request('GET', '/alliance/list'); },
  allianceCreate(name, description) { return request('POST', '/alliance/create', { name, description }); },
  allianceApply(allianceId) { return request('POST', '/alliance/apply', { alliance_id: allianceId }); },
  allianceDetail(allianceId) { return request('GET', `/alliance/detail/${allianceId}`); },
  allianceLeave() { return request('POST', '/alliance/leave', {}); },
  allianceKick(allianceId, accountId) { return request('POST', '/alliance/kick', { alliance_id: allianceId, account_id: accountId }); },
  allianceApplications(allianceId) { return request('GET', `/alliance/applications/${allianceId}`); },
  allianceApprove(applicationId) { return request('POST', '/alliance/approve_application', { application_id: applicationId }); },
  allianceReject(applicationId) { return request('POST', '/alliance/reject_application', { application_id: applicationId }); },
  allianceDonate(allianceId, page, slotIndex, count, expectItemId = 0) {
    return request('POST', '/alliance/donate', {
      alliance_id: allianceId,
      page,
      slot_index: slotIndex,
      count,
      expect_item_id: expectItemId || 0
    });
  },
  allianceBless(allianceId, times = 1) { return request('POST', '/alliance/statue/bless', { alliance_id: allianceId, times }); },
  allianceBathe(allianceId) { return request('POST', '/alliance/spirit_pool/bathe', { alliance_id: allianceId }); },
  allianceGardenPick(allianceId) { return request('POST', '/alliance/garden/pick', { alliance_id: allianceId }); },
  allianceMeditate(allianceId) { return request('POST', '/alliance/enlightenment_tree/meditate', { alliance_id: allianceId }); },
  allianceBuildings(allianceId) { return request('GET', `/alliance/buildings/${allianceId}`); },
  allianceBuildingUpgrade(allianceId, building) { return request('POST', '/alliance/buildings/upgrade', { alliance_id: allianceId, building }); },
  allianceTreasuryList(allianceId) { return request('GET', `/alliance/treasury/list/${allianceId}`); },
  allianceTreasuryBuy(allianceId, itemId, count = 1) { return request('POST', '/alliance/treasury/buy', { alliance_id: allianceId, item_id: itemId, count }); },
  allianceWarehouse(allianceId) { return request('GET', `/alliance/warehouse/${allianceId}`); },
  allianceWarehouseDeposit(allianceId, page, slotIndex, count, expectItemId = 0) {
    return request('POST', '/alliance/warehouse/deposit', {
      alliance_id: allianceId,
      page,
      slot_index: slotIndex,
      count,
      expect_item_id: expectItemId || 0
    });
  },
  allianceWarehouseWithdraw(allianceId, warehousePage, warehouseSlotIndex, count) { return request('POST', '/alliance/warehouse/withdraw', { alliance_id: allianceId, warehouse_page: warehousePage, warehouse_slot_index: warehouseSlotIndex, count }); },
  allianceWarehouseUpgrade(allianceId) { return request('POST', '/alliance/warehouse/upgrade', { alliance_id: allianceId }); },
  allianceWarehouseAuthorize(allianceId, accountId, add) { return request('POST', '/alliance/warehouse/authorize', { alliance_id: allianceId, account_id: accountId, add }); },
  allianceGrantRank(allianceId, accountId, rank) { return request('POST', '/alliance/grant_rank', { alliance_id: allianceId, account_id: accountId, rank }); },
  allianceTransferLeader(allianceId, accountId) { return request('POST', '/alliance/transfer_leader', { alliance_id: allianceId, account_id: accountId }); },

  // ── Chat ──
  chatMessages(channel, since = 0, allianceId = 0) {
    let q = `/chat/messages?channel=${encodeURIComponent(channel)}&since=${since}`;
    if (channel === 'alliance' && allianceId > 0) q += `&alliance_id=${allianceId}`;
    return request('GET', q);
  },
  chatSend(channel, text) { return request('POST', '/chat/send', { channel, text }); },

  // ── Invite ──
  inviteInfo() { return request('GET', '/invite/info'); },
  inviteGenerate() { return request('POST', '/invite/generate', {}); },
  inviteBind(code) { return request('POST', '/invite/bind', { invite_code: code }); },
  inviteStorage(storedStones, perPersonStones) { return request('POST', '/invite/storage', { stored_stones: storedStones, per_person_stones: perPersonStones }); },
  inviteInvitees() { return request('GET', '/invite/invitees'); },
  inviteClaimPoints(inviteeAccountId) { return request('POST', '/invite/claim_points', { invitee_account_id: inviteeAccountId }); },
  inviteReissue(inviteeAccountId) { return request('POST', '/invite/reissue', { invitee_account_id: inviteeAccountId }); },
  inviteShopList() { return request('GET', '/invite/shop'); },
  inviteShopBuy(itemId, count = 1) { return request('POST', '/invite/shop/buy', { item_id: itemId, count }); },

  // ── Email ──
  emailStatus() { return request('GET', '/email/status'); },
  emailSendCode(email) { return request('POST', '/email/send-code', { email }); },
  emailBind(email, code) { return request('POST', '/email/bind', { email, code }); },
  emailUnbind() { return request('POST', '/email/unbind', {}); },
  forgotPasswordSendCode(email) { return request('POST', '/email/forgot-password/send-code', { email }); },
  forgotPasswordReset(email, code, newPassword) { return request('POST', '/email/forgot-password/reset', { email, code, new_password: newPassword }); },
  changePasswordSendCode() { return request('POST', '/email/change-password/send-code', {}); },
  changePasswordConfirm(code, newPassword) { return request('POST', '/email/change-password/confirm', { code, new_password: newPassword }); },

  // ── WebSocket ──
  connectWs, disconnectWs, isWsConnected, onWsMessage, wsSetAutoRestart, wsSetBattleDetail,

  // ── Game Data ──
  async getGameData(force = false) {
    if (_gameData && !force) return _gameData;
    const r = await request('GET', '/game-data');
    if (r.ok) _gameData = r.data;
    return _gameData;
  }
};

export default api;
