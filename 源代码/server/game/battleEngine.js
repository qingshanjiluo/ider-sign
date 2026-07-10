/**
 * 1v1 行动条制战斗引擎（常规战斗）
 */
const { getSkillById, getItemById } = require('./dataLoader');
const CU = require('./combatUtils');
const CD = require('./combatDamage');
const combatComputeAdapter = require('./combatComputeAdapter');
const { expandMultiHitDamages } = CD;
const { intVal, numVal, clamp, deepClone, getRealmQualityFromLevel, nextRand01, rollInt, calcReducedDamage,
  calcActionSpeed, buildPlayerSnapshot, buildEnemySnapshot,
  applyDebuff, triggerDebuffs, decrementStates, applyTurnEndRecovery,
  applySkillSpecialEffects, applyWanguchouOnMusicHit, applyPostDamageExEffects,
  getNegativeStatusCount,
  tickJueyi, consumeJueyiForControl,
  isHealForbidden, pushHealForbiddenEvent, consumeNextActionHeal,
  applyHealWithOverflowShield, absorbDamageByTempShield,
  tryJiemieHealToXurui,
  getTaixuanShentuSkillDamageMul,
  applyTaixuanShentuSkillDamage,
  initTechniqueBattleStartEffects, applyShieldedDamageReflect,
  capIncomingDamageByTaixu,
  applyFenjieShentuOnDamageSkill,
  applySkillDamageShieldGain,
  tryZhanmoShentuExecute,
  initXuanhuang8AtBattleStart, applySetEffectsOnPlayerDamaged,
  applySetEffectsOnPlayerTurnStart, applySetEffectsOnDealDamage,
  applySetEffectsOnHeal,   applySetEffectsOnPlayerTurnEnd,
  getBlossomExplodeInfo, clearBlossomDebuffs } = CU;

const MAX_BATTLE_ROUNDS = 300;

function _sumTempShieldAbsorb(events, expectedTag = '') {
  let total = 0;
  const list = Array.isArray(events) ? events : [];
  const tag = String(expectedTag || '').trim();
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    if (String(ev.action || '') !== 'daoti_temp_shield_absorb') continue;
    if (tag) {
      const actor = String(ev.actor || '');
      const target = String(ev.target || '');
      if (actor !== tag && target !== tag) continue;
    }
    total += Math.max(0, intVal(ev.absorb, 0));
  }
  return total;
}

function _normalizeSkillCooldowns(cd) {
  const out = {};
  if (cd && typeof cd === 'object') {
    for (const k of Object.keys(cd)) out[String(k)] = Math.max(0, intVal(cd[k], 0));
  }
  return out;
}

function _buildBattleStartCooldowns(unit) {
  const out = {};
  for (const sidRaw of (Array.isArray(unit?.equipped_skills) ? unit.equipped_skills : [])) {
    const sid = Math.max(1, intVal(sidRaw, 0));
    if (sid > 0) out[String(sid)] = 0;
  }
  return out;
}

function createInitialBattleState(player, enemy, rngSeed) {
  const ps = buildPlayerSnapshot(player, { skipInventory: true });
  ps.skill_cooldowns = _buildBattleStartCooldowns(ps);
  ps.yujian_extra_cast = false;
  ps.action_bar = clamp(numVal(player?.action_bar, 0), 0, 100);
  ps.lingjie_overload_rounds = 0;
  ps.lingjie_guard_break_stacks = 0;
  const es = buildEnemySnapshot(enemy);
  es.action_bar = clamp(numVal(enemy?.action_bar, 0), 0, 100);
  es.lingjie_overload_rounds = 0;
  es.lingjie_guard_break_stacks = 0;
  const init = {
    status: 'active', round: 1, turn: 'player', event_index: 0,
    draw: false,
    rng_seed: intVal(rngSeed, Math.floor(Math.random() * 2147483647)),
    rng_cursor: 0, turn_mode: 'action_bar', turn_queue: [],
    player: ps, enemy: es,
    _total_player_damage: 0, _used_skill_ids: [],
    _haomiao_lethal_saved: false,
    _abaddon_rebirth_used: false,
    _abaddon_rebirth_spent: 0,
    _lihuo_zhuoshao_this_action: false
  };
  const xh8Evts = initXuanhuang8AtBattleStart(init);
  const techStartEvts = initTechniqueBattleStartEffects(init);
  const initEvts = [...xh8Evts, ...techStartEvts];
  if (initEvts.length > 0) init._init_events = initEvts;
  _appendSkillMeta(init);
  return init;
}

function _getLingjieActingUnit(state, actor) {
  if (actor === 'player') return state?.player || null;
  if (actor === 'enemy') return state?.enemy || null;
  return null;
}

function _getLingjieOpposingUnit(state, actor) {
  if (actor === 'player') return state?.enemy || null;
  if (actor === 'enemy') return state?.player || null;
  return null;
}

function _runLingjieActionModifier(state, actor, allEvents, runner) {
  const envId = String(state?.map_environment?.id || '');
  const unit = _getLingjieActingUnit(state, actor);
  if (!unit || typeof runner !== 'function') return runner();
  let damageMul = 1;
  if (envId === 'inverse_field' && intVal(state?.round, 1) <= 3) damageMul *= 0.65;
  if (intVal(unit.lingjie_overload_rounds, 0) > 0) damageMul *= 0.82;
  if (envId === 'shield_break' && intVal(unit.lingjie_guard_break_stacks, 0) > 0) {
    const stacks = Math.min(4, Math.max(0, intVal(unit.lingjie_guard_break_stacks, 0)));
    damageMul *= Math.max(0.45, 1 - stacks * 0.12);
  }
  if (Math.abs(damageMul - 1) <= 1e-6) return runner();

  const oldMin = intVal(unit.min_attack, 1);
  const oldMax = intVal(unit.max_attack, oldMin + 1);
  const oldSpell = intVal(unit.spell_attack, 0);
  unit.min_attack = Math.max(1, Math.floor(oldMin * damageMul));
  unit.max_attack = Math.max(unit.min_attack + 1, Math.floor(oldMax * damageMul));
  unit.spell_attack = Math.max(0, Math.floor(oldSpell * damageMul));
  try {
    return runner();
  } finally {
    unit.min_attack = oldMin;
    unit.max_attack = oldMax;
    unit.spell_attack = oldSpell;
    if (envId === 'inverse_field' && intVal(state?.round, 1) <= 3) {
      allEvents.push({ t: 'combat_log', actor, target: actor, action: 'lingjie_inverse_field', text: '逆势天幕压低了本次直接伤害。' });
    }
    if (intVal(unit.lingjie_overload_rounds, 0) > 0) {
      allEvents.push({ t: 'combat_log', actor, target: actor, action: 'lingjie_overload_weaken', text: '过载余波压制了本次出手。' });
    }
    if (envId === 'shield_break' && intVal(unit.lingjie_guard_break_stacks, 0) > 0) {
      allEvents.push({ t: 'combat_log', actor, target: actor, action: 'lingjie_guard_break_weaken', text: '碎盾潮汐的破势层数压低了本次输出。' });
    }
  }
}

function _applyLingjiePostAction(state, actor, actionEvents, allEvents, preMeta = {}) {
  const envId = String(state?.map_environment?.id || '');
  const unit = _getLingjieActingUnit(state, actor);
  const enemy = _getLingjieOpposingUnit(state, actor);
  if (!envId || !unit) return;

  if (envId === 'overload_sea' && actor === 'player' && enemy && Array.isArray(actionEvents)) {
    const thresholdBaseHp = Math.max(1, intVal(preMeta?.target_max_hp_before_action, intVal(enemy.max_hp, 1)));
    const threshold = Math.max(1, Math.floor(thresholdBaseHp * 0.18));
    const maxSinglePacketDamage = Math.max(
      0,
      intVal(preMeta?.max_single_packet_damage_overload, intVal(preMeta?.max_single_packet_damage, 0))
    );
    const packetSource = String(preMeta?.max_single_packet_overload_source || preMeta?.max_single_packet_source || 'unknown');
    if (maxSinglePacketDamage > 0) {
      allEvents.push({
        t: 'combat_log', actor, target: actor, action: 'lingjie_overload_check',
        text: `过载判定：来源=${packetSource}，单段=${maxSinglePacketDamage}，阈值=${threshold}。`
      });
    }
    const triggered = maxSinglePacketDamage >= threshold;
    if (triggered) {
      unit.lingjie_overload_rounds = Math.max(intVal(unit.lingjie_overload_rounds, 0), 3);
      allEvents.push({
        t: 'combat_log', actor, target: actor, action: 'lingjie_overload_apply',
        text: `你造成的单段伤害过高（来源=${packetSource}，单段=${maxSinglePacketDamage}，阈值=${threshold}），激发了过载雷海，你陷入了过载。`
      });
    }
  }

  if (envId === 'shield_break' && intVal(unit.hp, 0) > 0) {
    const nextStacks = Math.min(4, Math.max(0, intVal(unit.lingjie_guard_break_stacks, 0)) + 1);
    unit.lingjie_guard_break_stacks = nextStacks;
    const hpBurnPct = 0.04 + nextStacks * 0.02;
    const damage = Math.max(1, Math.floor(intVal(unit.max_hp, 1) * hpBurnPct));
    unit.hp = Math.max(0, intVal(unit.hp, 0) - damage);
    const shattered = Math.max(0, intVal(unit.temp_shield, 0));
    if (shattered > 0) unit.temp_shield = 0;
    allEvents.push({
      t: 'combat_log', actor, target: actor, action: 'lingjie_guard_break_stack', damage,
      text: `碎盾潮汐施加破势（${nextStacks}层），${unit.name} 受到${damage}点侵蚀伤害${shattered > 0 ? `并失去${shattered}点护盾` : ''}。`
    });
  }

  if (envId === 'mire_swamp' && intVal(unit.hp, 0) > 0) {
    const maxMp = Math.max(0, intVal(unit.max_mp, 0));
    const mpBefore = Math.max(0, intVal(unit.mp, 0));
    const mpLoss = Math.max(30, Math.floor(maxMp * 0.18));
    const drained = Math.min(mpBefore, mpLoss);
    unit.mp = Math.max(0, mpBefore - mpLoss);

    const baseDamage = Math.max(1, Math.floor(intVal(unit.max_hp, 1) * 0.06));
    const lowMpThreshold = Math.floor(maxMp * 0.25);
    const lowMpBonus = unit.mp <= lowMpThreshold ? Math.max(1, Math.floor(intVal(unit.max_hp, 1) * 0.03)) : 0;
    const damage = baseDamage + lowMpBonus;
    unit.hp = Math.max(0, intVal(unit.hp, 0) - damage);
    allEvents.push({
      t: 'combat_log', actor, target: actor, action: 'lingjie_mire_drain', damage,
      text: `迟滞泥沼抽离${unit.name}${drained}点法力，并造成${damage}点侵蚀伤害${lowMpBonus > 0 ? '（低法力额外加重）' : ''}。`
    });
  }

  if (envId === 'crack_armor') {
    const totalDefense = Math.max(0, intVal(unit.defense, 0)) + Math.max(0, intVal(unit.spell_defense, 0));
    const lowDefense = Math.min(Math.max(0, intVal(unit.defense, 0)), Math.max(0, intVal(unit.spell_defense, 0)));
    if (totalDefense < 24000 || lowDefense < 11000) {
      const damage = Math.max(1, Math.floor(intVal(unit.max_hp, 1) * 0.07));
      unit.hp = Math.max(0, intVal(unit.hp, 0) - damage);
      allEvents.push({ t: 'combat_log', actor, target: actor, action: 'lingjie_crack_armor', damage, text: `裂甲风蚀撕开了${unit.name}的护体，造成${damage}点伤害。` });
    }
  }

  if (envId === 'attrition_field' && intVal(unit.hp, 0) > 0) {
    const damage = Math.max(1, Math.floor(intVal(unit.max_hp, 1) * 0.15));
    unit.hp = Math.max(0, intVal(unit.hp, 0) - damage);
    allEvents.push({ t: 'combat_log', actor, target: actor, action: 'lingjie_attrition', damage, text: `衰荣旷野反噬${unit.name}，造成${damage}点伤害。` });
  }

  if (intVal(unit.lingjie_overload_rounds, 0) > 0) {
    unit.lingjie_overload_rounds = Math.max(0, intVal(unit.lingjie_overload_rounds, 0) - 1);
  }
}

// ─── Skill helpers ───

function _decrementCooldowns(unit) {
  if (!unit.skill_cooldowns) return;
  for (const k of Object.keys(unit.skill_cooldowns)) {
    unit.skill_cooldowns[k] = Math.max(0, intVal(unit.skill_cooldowns[k], 0) - 1);
  }
}

function _getSkillLevel(unit, skillId) {
  const d = unit.skill_levels?.[String(skillId)];
  if (d && typeof d === 'object') return Math.max(1, intVal(d.level, 1));
  return Math.max(1, intVal(d, 1));
}

function _ensureKeySkillState(unit) {
  if (!unit || typeof unit !== 'object') return;
  unit.key_skill_id = Math.max(0, intVal(unit.key_skill_id, 0));
  unit.key_skill_miss_turns = Math.max(0, intVal(unit.key_skill_miss_turns, 0));
}

function _canUseSkillNow(unit, sid) {
  const skillId = Math.max(1, intVal(sid, 0));
  if (skillId <= 0) return false;
  if (!Array.isArray(unit?.equipped_skills) || !unit.equipped_skills.includes(skillId)) return false;
  const skill = getSkillById(skillId);
  if (!skill || !skill.id) return false;
  const req = skill.requirements;
  if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
    const weapType = String(unit.weapon_type || '');
    if (!req.weaponTypes.some(wt => weapType.includes(wt))) return false;
  }
  const cd = intVal(unit.skill_cooldowns?.[String(skillId)], 0);
  if (cd > 0) return false;
  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  return mpCost <= intVal(unit.mp, 0);
}

function _calcSkillMul(skill, lv) {
  let mul = 1.15;
  for (const eff of (Array.isArray(skill?.effects) ? skill.effects : [])) {
    if (String(eff?.type || '') !== 'damage_percent') continue;
    let v = numVal(eff?.value, mul);
    if (lv > 1) v += (lv - 1) * numVal(eff?.coefficientBonus, 0);
    mul = Math.max(mul, v);
  }
  return Math.max(0.1, mul);
}

/** 收集技能所有伤害系数，返回 [{ mul, isSpell, opts }]，opts 含 ignoreDefense/ignoreSpellDefense */
function _collectSkillDamageHits(skill, lv, state) {
  const hits = [];
  const effects = Array.isArray(skill?.effects) ? skill.effects : [];
  const dmgType = String(skill?.damageType || 'physical');
  const isHybrid = dmgType === 'hybrid';

  for (const eff of effects) {
    const et = String(eff?.type || '');
    const opts = {};
    if (numVal(eff?.ignoreDefense, 0) > 0) opts.ignoreDefense = eff.ignoreDefense;
    if (eff?.ignoreSpellDefense === true || numVal(eff?.ignoreSpellDefense, 0) > 0) opts.ignoreSpellDefense = eff.ignoreSpellDefense;

    if (et === 'damage_percent') {
      let v = numVal(eff?.value, 1.15);
      if (lv > 1) v += (lv - 1) * numVal(eff?.coefficientBonus, 0);
      v = Math.max(0.1, v);
      const isSpell = dmgType === 'magic';
      hits.push({ mul: v, isSpell, opts });
      if (isHybrid) hits.push({ mul: v, isSpell: true, opts });
    } else if (et === 'damage_percent_range') {
      const minV = numVal(eff?.minValue, 0.8);
      const maxV = numVal(eff?.maxValue, 1.2);
      let v = minV + nextRand01(state) * (maxV - minV);
      if (lv > 1) v += (lv - 1) * numVal(eff?.coefficientBonus, 0);
      v = Math.max(0.1, v);
      const spell = String(eff?.damageType || dmgType) === 'magic';
      hits.push({ mul: v, isSpell: spell, opts });
      if (isHybrid && !spell) hits.push({ mul: v, isSpell: true, opts: {} });
    } else if (et === 'damage_percent_range_multi') {
      let count = Math.max(1, intVal(eff?.count, 2));
      if (intVal(eff?.maxLevelExtraCount, 0) > 0 && lv >= (skill?.levelCap || 99)) count += intVal(eff.maxLevelExtraCount, 0);
      const minV = numVal(eff?.minValue, 0.5);
      const maxV = numVal(eff?.maxValue, 1.0);
      const coefBonus = numVal(eff?.coefficientBonus, 0);
      let firstMul = minV + nextRand01(state) * (maxV - minV);
      if (lv > 1 && coefBonus > 0) firstMul += (lv - 1) * coefBonus;
      firstMul = Math.max(0.1, firstMul);
      hits.push({ multiHit: true, count, firstMul, decay: 0.7, isSpell: dmgType === 'magic', opts });
    } else if (et === 'damage_percent_plus_agility_multi') {
      let count = Math.max(1, intVal(eff?.count, 3));
      if (intVal(eff?.maxLevelExtraCount, 0) > 0 && lv >= (skill?.levelCap || 99)) count += intVal(eff.maxLevelExtraCount, 0);
      const attackMul = Math.max(0.01, numVal(eff?.value, 0.25));
      const agiBase = Math.max(0, numVal(eff?.agilityCoeff, 0.15));
      const agiLvBonus = numVal(eff?.agilityCoeffPerLevel, 0);
      const agiCoeff = Math.max(0, agiBase + (lv > 1 ? (lv - 1) * agiLvBonus : 0));
      const growth = Math.max(1, numVal(eff?.perHitGrowth, 0.10) + 1);
      hits.push({
        multiHit: true,
        count,
        firstMul: attackMul,
        decay: growth,
        isSpell: false,
        lockDecay: true,
        opts: { ...opts, extraAgilityCoeff: agiCoeff }
      });
    } else if (et === 'damage_dual_physical_then_magic') {
      const minV = numVal(eff?.minValue, 0.77);
      const maxV = numVal(eff?.maxValue, 0.99);
      const levelBonus = numVal(eff?.levelBonus, 0.07);
      let mult = minV + nextRand01(state) * (maxV - minV);
      const finalMult = lv > 1 ? (1.0 + (lv - 1) * levelBonus) : 1.0;
      mult = Math.max(0.1, mult * finalMult);
      hits.push({ mul: mult, isSpell: false, opts });
      hits.push({ mul: mult, isSpell: true, opts: {} });
    } else if (et === 'damage_percent_adaptive_higher_attack') {
      let v = numVal(eff?.value, 1.0);
      if (lv > 1) v += (lv - 1) * numVal(eff?.coefficientBonus, 0);
      v = Math.max(0.1, v);
      hits.push({ mul: v, isSpell: false, opts: { ...opts, adaptiveHigherAttack: true } });
    }
  }
  return hits;
}

function _hasSkillEffect(skill, effectType) {
  return (Array.isArray(skill?.effects) ? skill.effects : []).some(e => String(e?.type || '') === effectType);
}

function _getFlatDamageBonus(attacker, isSpell) {
  if (!attacker || typeof attacker !== 'object') return 0;
  return Math.max(0, intVal(isSpell ? attacker.spell_flat_damage : attacker.phys_flat_damage, 0));
}

/** 物理范围+技能暴击（damage_percent_range_physical_crit） */
function _calcDamagePhysCritRange(state, attacker, defender, eff, lv, skill) {
  const minV = numVal(eff?.minValue, 1.2);
  const maxV = numVal(eff?.maxValue, 1.45);
  const coefBonus = numVal(eff?.coefficientBonus, 0);
  const critDmgBonus = numVal(eff?.critDamageBonus, 0);
  const skillCritChance = numVal(eff?.skillCritChance, 0.2);
  const naturalCritBonus = numVal(eff?.naturalCritBonus, 0.1);
  let adjMin = minV, adjMax = maxV;
  if (lv > 1 && coefBonus > 0) {
    adjMin += (lv - 1) * coefBonus;
    adjMax += (lv - 1) * coefBonus;
  }
  let mult = adjMin + nextRand01(state) * (adjMax - adjMin);
  if (attacker.fear_rounds > 0) mult = adjMin;
  else if (attacker.xurui?.active) mult = adjMax;
  const base = attacker.xurui?.active ? attacker.max_attack : (attacker.fear_rounds > 0 ? attacker.min_attack : rollInt(state, attacker.min_attack, attacker.max_attack));
  let raw = Math.max(1, Math.floor(base * mult));
  const wouldCrit = attacker.nuozhan_rounds > 0;
  const doCrit = wouldCrit || nextRand01(state) < (skillCritChance + numVal(attacker.crit_rate, 0));
  if (doCrit) {
    let critMul = 1.35;
    if (wouldCrit) critMul += naturalCritBonus + (lv > 1 ? (lv - 1) * critDmgBonus : 0);
    critMul += numVal(attacker.crit_mult, 1.5) - 1.5;
    raw = Math.floor(raw * critMul);
  }
  const flatDamage = _getFlatDamageBonus(attacker, false);
  if (flatDamage > 0) raw += flatDamage;
  let effDef = defender.defense || 0;
  const pen = numVal(attacker.armor_pen, 0);
  if (pen > 0) effDef = Math.floor(effDef * (1.0 - clamp(pen, 0, 0.9)));
  if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effDef = Math.floor(effDef * 0.6);
  if (defender.jiangu) effDef += Math.floor(defender.defense * defender.jiangu.physCoeff);
  if (defender?.fumo_shentu_active) effDef = Math.min(Math.max(0, numVal(effDef, 0)), 6000);
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effDef, divisor);
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) dmg = Math.floor(raw * 1.2);
  if (attacker.nuozhan_rounds > 0) { const oc = Math.max(0, numVal(attacker.crit_rate, 0)); if (oc > 0) dmg = Math.floor(dmg * (1.0 + oc)); }
  const aff = CU.calcElementAffinity(attacker, skill);
  if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
  if (defender.is_ally && defender.damage_reduction > 0)
    dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance)
    return { damage: 0, isCrit: doCrit, events: [{ t: 'combat_log', actor: defender.tag || 'player', target: defender.tag || 'player', action: 'ignore', text: `${defender.name} 无视了这次伤害！` }] };
  return { damage: dmg, isCrit: doCrit, events: [] };
}

/** 清除单位所有临时状态，返回清除数量 */
function _clearUnitStatuses(unit) {
  let n = 0;
  if (unit.xurui?.active) { unit.xurui = { active: false, duration: 0 }; n++; }
  if (unit.yangjing?.active) { unit.yangjing = { active: false, duration: 0 }; n++; }
  if (unit.jingzhun?.active) { unit.jingzhun = { active: false, duration: 0 }; n++; }
  if (unit.zhuanzhu?.active) { unit.zhuanzhu = { active: false, duration: 0 }; n++; }
  if (unit.chengfeng) { unit.chengfeng = null; n++; }
  if (unit.jiangu) { unit.jiangu = null; n++; }
  return n;
}

/** 万圣龙王破（主目标风压按多击衰减；终结技独立计算） */
function _calcDamageWanshengLongwangPo(state, p, e, skill, lv) {
  const eff = (skill.effects || []).find(x => String(x?.type || '') === 'wansheng_longwang_po');
  if (!eff) return { damage: 0, isCrit: false, events: [] };
  const hitCoef = numVal(eff?.value, 0.25) + (lv > 1 ? (lv - 1) * numVal(eff?.coefficientBonus, 0.05) : 0);
  const hitCount = intVal(eff?.count, 4);
  const extraVal = numVal(eff?.extraHitValue, 0.85);
  const extraIgnore = numVal(eff?.extraIgnoreDefense, 0.4);
  const extraJuemai = intVal(eff?.extraJuemaiDuration, 2);
  const juemaiMin = intVal(eff?.extraJuemaiMinCleared, 3);
  const events = [];
  const damagePerHit = [];
  // 主目标风压按常规防御结算（无视防御仅用于团战波及目标）
  const windRes = _calcDamage(state, p, e, 'skill', hitCoef, false, skill, lv, {});
  const windDecay = p?.ex_weapon?.no_multi_hit_decay ? 1 : 0.7;
  let windDmg = Math.max(0, intVal(windRes.damage, 0));
  let total = 0;
  for (let i = 0; i < hitCount && e.hp > 0; i++) {
    const dealtWind = _capAndAbsorbDamage(state, e, windDmg, events);
    total += dealtWind;
    damagePerHit.push(Math.max(0, intVal(dealtWind, 0)));
    e.hp = Math.max(0, e.hp - dealtWind);
    windDmg = Math.max(1, Math.floor(windDmg * windDecay));
  }
  const cleared = _clearUnitStatuses(p);
  const extraOpts = {};
  if (cleared >= 2) extraOpts.ignoreDefense = extraIgnore;
  if (cleared >= 1) extraOpts.forceCrit = true;
  const extraRes = _calcDamage(state, p, e, 'skill', extraVal, false, skill, lv, extraOpts);
  const extraDamage = _capAndAbsorbDamage(state, e, extraRes.damage, events);
  total += extraDamage;
  damagePerHit.push(Math.max(0, intVal(extraDamage, 0)));
  e.hp = Math.max(0, e.hp - extraDamage);
  if (cleared >= juemaiMin) e.juemai_rounds = Math.max(e.juemai_rounds || 0, extraJuemai);
  events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'wansheng', damage: total, text: `万圣龙王破！${hitCount}连击+终结${extraDamage}，清除${cleared}个状态` });
  return { damage: total, damagePerHit, isCrit: extraRes.isCrit, events };
}

/** damage_percent_plus_phys_def：伤害 = 攻击力*系数 + 物理防御*物防系数（如坤德镇狱） */
function _calcDamagePercentPlusPhysDef(state, attacker, defender, eff, lv, skill) {
  const attackCoef = numVal(eff?.value, 1.0);
  let physDefCoef = numVal(eff?.physDefCoeff, 0.15);
  physDefCoef += (lv - 1) * numVal(eff?.physDefCoeffPerLevel, 0.04);
  let physAttack;
  if (attacker.fear_rounds > 0) physAttack = attacker.min_attack;
  else if (attacker.xurui?.active) physAttack = attacker.max_attack;
  else physAttack = rollInt(state, attacker.min_attack, attacker.max_attack);
  const baseRaw = Math.max(1, Math.floor(physAttack * attackCoef + (attacker.defense || 0) * physDefCoef));
  const isCrit = (attacker.nuozhan_rounds > 0) || nextRand01(state) < (attacker.crit_rate || 0);
  const critMul = isCrit ? (attacker.crit_mult || 1.5) : 1.0;
  let raw = Math.floor(baseRaw * critMul);
  const weapBuf = 1.0 + Math.max(0, numVal(attacker.weapon_damage_pct, 0));
  raw = Math.floor(raw * weapBuf);
  const flatDamage = _getFlatDamageBonus(attacker, false);
  if (flatDamage > 0) raw += flatDamage;
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) raw = Math.floor(raw * 1.2);
  let effectiveDef = defender.defense || 0;
  if (defender.beishui_rounds > 0 || attacker.beishui_rounds > 0) effectiveDef = 0;
  else {
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (defender.jiangu) effectiveDef += Math.floor(defender.defense * defender.jiangu.physCoeff);
    if (defender?.fumo_shentu_active) effectiveDef = Math.min(Math.max(0, numVal(effectiveDef, 0)), 6000);
  }
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effectiveDef, divisor);
  if (attacker.nuozhan_rounds > 0) { const oc = Math.max(0, numVal(attacker.crit_rate, 0)); if (oc > 0) dmg = Math.floor(dmg * (1.0 + oc)); }
  const aff = CU.calcElementAffinity(attacker, skill);
  if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
  if (defender.is_ally && defender.damage_reduction > 0)
    dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance)
    return { damage: 0, isCrit, events: [{ t: 'combat_log', actor: defender.tag || 'player', target: defender.tag || 'player', action: 'ignore', text: `${defender.name} 无视了这次伤害！` }] };
  return { damage: dmg, isCrit, events: [] };
}

// ─── 伤害计算核心（统一使用 combatDamage，含元素亲和与道妙） ───
const _calcDamage = combatComputeAdapter.calcDamage;
const _calcDamageSpellPhysDefPlusSelfHpLost = CD.calcDamageSpellPhysDefPlusSelfHpLost;
const _calcDamageOwnPhysDefPercent = CD.calcDamageOwnPhysDefPercent;
const _calcDamageOwnSpellDefPercent = CD.calcDamageOwnSpellDefPercent;

function _getKunDeCounterCoeff(unit) {
  const lvData = unit?.technique_levels?.['19'];
  const lv = lvData && typeof lvData === 'object' ? intVal(lvData.level, 0) : intVal(lvData, 0);
  if (lv <= 0) return 0;
  return 0.19 + Math.max(0, lv - 1) * 0.02;
}

function _recordZhenyueShanpo(unit, events, dealtDamage) {
  if (!unit || intVal(dealtDamage, 0) <= 0) return;
  if (intVal(unit.zhenyue_rounds, 0) <= 0) return;
  unit.zhenyue_shanpo = Math.max(0, intVal(unit.zhenyue_shanpo, 0)) + 1;
  events.push({
    t: 'combat_log',
    actor: unit.tag || 'player',
    target: unit.tag || 'player',
    action: 'zhenyue_stack',
    text: `${unit.name} 的镇岳叠加了1层山魄（当前${unit.zhenyue_shanpo}层）`
  });
}

function _capAndAbsorbDamage(state, target, damage, events) {
  let dealt = capIncomingDamageByTaixu(target, damage, events, { state }).damage;
  dealt = absorbDamageByTempShield(target, dealt, events);
  dealt = Math.max(0, intVal(dealt, 0));
  _recordZhenyueShanpo(target, events, dealt);
  return dealt;
}

function _triggerZhenyueOnExpire(state, unit, target, events) {
  if (!unit || !target || !events) return;
  const stacks = Math.max(0, intVal(unit.zhenyue_shanpo, 0));
  unit.zhenyue_shanpo = 0;
  if (stacks <= 0) return;

  const coeff = _getKunDeCounterCoeff(unit);
  if (coeff <= 0) {
    events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player', action: 'zhenyue_end',
      text: `${unit.name} 的镇岳结束，但未习得坤德镇狱功，山魄未能化为反击` });
    return;
  }

  const isPvp = state?.battle_mode === 'city_duel';
  const physBonus = isPvp ? 0 : Math.floor(Math.floor((unit.min_attack + unit.max_attack) / 2) * 0.20);
  const ctrBonus = isPvp
    ? numVal(unit?.ex_weapon?.pvp_counter_damage_bonus, 0)
    : numVal(unit?.ex_weapon?.counter_damage_bonus, 0);

  for (let i = 0; i < stacks; i++) {
    if (target.hp <= 0) break;
    let dmg = Math.max(1, Math.floor(unit.defense * coeff + physBonus));
    if (ctrBonus > 0) dmg = Math.max(1, Math.floor(dmg * (1.0 + ctrBonus)));
    if (numVal(unit?.kurong_shentu_active, 0) > 0 && dmg > 0) dmg = 0;
    dmg = _capAndAbsorbDamage(state, target, dmg, events);
    target.hp = Math.max(0, target.hp - dmg);
    tryZhanmoShentuExecute(state, unit, target, events, { damage: dmg });
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: target.tag || 'enemy',
      action: 'zhenyue_counter',
      damage: dmg,
      text: `${unit.name} 的镇岳山魄反击造成${dmg}伤害！`
    });
  }
}

function _decrementStatesWithZhenyue(state, unit, target, events) {
  const before = intVal(unit?.zhenyue_rounds, 0);
  decrementStates(unit, state);
  if (before > 0 && intVal(unit?.zhenyue_rounds, 0) <= 0) {
    _triggerZhenyueOnExpire(state, unit, target, events);
  }
}

const YUJIAN_SKILL_ID = 16;
const ZAIDAO_SKILL_ID = 17;

function _pickLinkedEquippedSkill(unit, excludedSkillId = 0) {
  const equipped = Array.isArray(unit?.equipped_skills) ? unit.equipped_skills : [];
  const candidates = equipped.filter(sid => intVal(sid, 0) > 0 && intVal(sid, 0) !== excludedSkillId);
  const keySkillId = intVal(unit?.key_skill_id, 0);
  if (keySkillId > 0 && candidates.includes(keySkillId) && _canUseSkillNow(unit, keySkillId)) return keySkillId;
  for (const sid of candidates) {
    if (_canUseSkillNow(unit, sid)) return sid;
  }
  return 0;
}

function _applyJianxinFollowUp(state, attacker, defender, sourceIsSpell, skill, skillLevel, events) {
  if (!attacker?.jianxin || !defender || defender.hp <= 0) return;
  const isPvp = state?.battle_mode === 'city_duel';
  const coeff = isPvp ? 0.15 : 0.25;
  let followIsSpell = null;
  if (!sourceIsSpell && attacker.jingzhun?.active) followIsSpell = true;
  else if (sourceIsSpell && attacker.zhuanzhu?.active) followIsSpell = false;
  if (followIsSpell == null) return;

  const res = _calcDamage(state, attacker, defender, 'skill', coeff, followIsSpell, skill, skillLevel, { from_jianxin_followup: true });
  let damage = Math.max(0, intVal(res.damage, 0));
  events.push(...(res.events || []));
  if (damage <= 0) return;
  if (defender.hunchong_stacks > 0) {
    defender.hunchong_stacks -= 1;
    events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
      text: `${defender.name} 的缓冲抵消了剑心追击！` });
    return;
  }
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
      text: `${defender.name} 无视了剑心追击！` });
    return;
  }
  damage = _capAndAbsorbDamage(state, defender, damage, events);
  if (damage <= 0) return;
  defender.hp = Math.max(0, defender.hp - damage);
  tryZhanmoShentuExecute(state, attacker, defender, events, { damage });
  events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'jianxin_followup',
    damage, is_crit: res.isCrit,
    text: `${attacker.name} 对${defender.name}发动剑心追击，追加${followIsSpell ? '法术' : '物理'}伤害${damage}` });
}

// ─── 玩家攻击 ───

function _playerAttack(state, mode = 'attack', skillId = 0, opts = {}) {
  const p = state.player;
  const e = state.enemy;
  p._man_charge_cast = false;
  p._shenguang_log_shown = false;
  p._skip_hybrid_heal_once = false;
  let skillName = '', skillMul = 1.0, isSpell = false, skill = null, lv = 1;
  let _bonusHealEff = null, _bonusTeamHealEff = null;
  let yujianExtraEvents = [];
  let maxSinglePacketDamage = 0;
  let maxSinglePacketSource = '';
  let maxSinglePacketOverloadDamage = 0;
  let maxSinglePacketOverloadSource = '';
  const _recordSinglePacketDamage = (v, source = 'direct_hit', countForOverload = true) => {
    const n = Math.max(0, intVal(v, 0));
    if (n > maxSinglePacketDamage) {
      maxSinglePacketDamage = n;
      maxSinglePacketSource = String(source || 'unknown');
    }
    if (countForOverload && n > maxSinglePacketOverloadDamage) {
      maxSinglePacketOverloadDamage = n;
      maxSinglePacketOverloadSource = String(source || 'unknown');
    }
  };
  const _applyKuangyongBonus = (packetDamage, events) => {
    const base = Math.max(0, intVal(packetDamage, 0));
    if (base <= 0) return base;
    const manaBurstPct = clamp(numVal(p?.combat_mana_burst_pct, 0), 0, 1);
    if (manaBurstPct <= 0 || intVal(p?.mp, 0) <= 0) return base;
    const mpCost = Math.max(0, Math.floor(intVal(p.mp, 0) * manaBurstPct));
    if (mpCost <= 0) return base;
    p.mp = Math.max(0, intVal(p.mp, 0) - mpCost);
    if (Array.isArray(events)) {
      events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'kuangyong',
        text: `${p.name} 激发阵形·狂涌，消耗${mpCost}法力，附加${mpCost}伤害` });
    }
    return base + mpCost;
  };

  if (mode === 'skill') {
    const sid = Math.max(1, intVal(skillId, 0));
    if (!p.equipped_skills.includes(sid)) return { ok: false, error: '该技能未装配' };
    skill = getSkillById(sid);
    if (!skill || !skill.id) return { ok: false, error: '技能不存在' };
    const req = skill.requirements;
    if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
      const weapType = String(p.weapon_type || '');
      if (!req.weaponTypes.some(wt => weapType.includes(wt))) {
        return { ok: false, error: `该技能需装备${req.weaponTypes.join('或')}类武器` };
      }
    }
    const learnedTechId = req && typeof req === 'object' ? intVal(req.learnedTechniqueId, 0) : 0;
    if (learnedTechId > 0 && (!p.technique_levels || !p.technique_levels[String(learnedTechId)] || intVal(p.technique_levels[String(learnedTechId)].level, 0) < 1)) {
      return { ok: false, error: '未满足功法前置条件' };
    }
    const cd = intVal(p.skill_cooldowns?.[String(sid)], 0);
    if (cd > 0 && !opts.skipCooldown) return { ok: false, error: '技能冷却中' };
    const mpCost = Math.max(0, intVal(skill.mpCost, 0));
    if (mpCost > p.mp && !opts.skipMpCost) return { ok: false, error: '法力不足' };
    if (sid === ZAIDAO_SKILL_ID && p.jianxin) {
      const linkedSkillId = _pickLinkedEquippedSkill(p, ZAIDAO_SKILL_ID);
      if (linkedSkillId <= 0) return { ok: false, error: '无其他可释放技能' };
      const linkedName = String(getSkillById(linkedSkillId)?.name || `技能${linkedSkillId}`);
      const linkedRes = _playerAttack(state, 'skill', linkedSkillId, { ...opts, noNestedProc: true });
      if (!linkedRes.ok) return linkedRes;
      return {
        ok: true,
        max_single_packet_damage: Math.max(0, intVal(linkedRes?.max_single_packet_damage, 0)),
        max_single_packet_source: String(linkedRes?.max_single_packet_source || ''),
        max_single_packet_damage_overload: Math.max(0, intVal(linkedRes?.max_single_packet_damage_overload, intVal(linkedRes?.max_single_packet_damage, 0))),
        max_single_packet_overload_source: String(linkedRes?.max_single_packet_overload_source || linkedRes?.max_single_packet_source || ''),
        events: [
          { t: 'combat_log', actor: 'player', target: 'player', action: 'jianxin_cast',
            text: `剑心流转：${p.name} 转而释放${linkedName}` },
          ...(linkedRes.events || [])
        ]
      };
    }
    if (sid === YUJIAN_SKILL_ID && p.yujian_extra_cast && !opts.noNestedProc) {
      p.yujian_extra_cast = false;
      const otherSkills = (p.equipped_skills || []).filter(s => intVal(s, 0) !== YUJIAN_SKILL_ID);
      const valid = otherSkills.filter(s => {
        const sk = getSkillById(s);
        if (!sk || !sk.id) return false;
        if (intVal(p.skill_cooldowns?.[String(s)], 0) > 0) return false;
        if (intVal(sk.mpCost, 0) > p.mp) return false;
        const r = sk.requirements;
        if (r && Array.isArray(r.weaponTypes) && r.weaponTypes.length > 0) {
          if (!r.weaponTypes.some(wt => String(p.weapon_type || '').includes(wt))) return false;
        }
        return true;
      });
      if (valid.length > 0) {
        const extraId = valid[Math.floor(nextRand01(state) * valid.length)];
        const extraRes = _playerAttack(state, 'skill', extraId, { skipCooldown: true, skipTurnStart: true, noNestedProc: true });
        if (extraRes.ok) {
          _recordSinglePacketDamage(
            intVal(extraRes?.max_single_packet_damage_overload, intVal(extraRes?.max_single_packet_damage, 0)),
            String(extraRes?.max_single_packet_overload_source || extraRes?.max_single_packet_source || 'yujian_extra'),
            true
          );
          yujianExtraEvents = [{ t: 'combat_log', actor: 'player', target: 'player', action: 'yujian_extra',
            text: `绝学-御剑以心：额外释放${getSkillById(extraId)?.name || `技能${extraId}`}！` }, ...(extraRes.events || [])];
        }
      }
    }
    if (!opts.skipMpCost) p.mp = Math.max(0, p.mp - mpCost);
    lv = _getSkillLevel(p, sid);
    let effCd = intVal(skill.cooldown, 0);
    if (state?.battle_mode === 'city_duel' && intVal(skill.pvpCooldown, 0) > 0) effCd = intVal(skill.pvpCooldown, 0);
    if (lv > 1 && numVal(skill.cooldownPerLevel, 0) > 0) effCd += (lv - 1) * numVal(skill.cooldownPerLevel, 0);
    if (lv >= (intVal(skill.levelCap, 99) || 99) && intVal(skill.maxLevelCooldownReduction, 0) > 0) effCd = Math.max(0, effCd - intVal(skill.maxLevelCooldownReduction, 0));
    if (_hasSkillEffect(skill, 'blossom')) {
      const { typeCount } = getBlossomExplodeInfo(e, state);
      if (state?.battle_mode !== 'city_duel' && typeCount < 2) effCd = 0;
    }
    if (!opts.skipCooldown) p.skill_cooldowns[String(sid)] = Math.max(0, effCd);
    let resetSkillIds = [];
    if (_hasSkillEffect(skill, 'clear_other_skill_cooldowns')) {
      let clearedCount = 0;
      for (const k of Object.keys(p.skill_cooldowns || {})) {
        if (String(k) !== String(sid) && intVal(p.skill_cooldowns[k], 0) > 0) clearedCount++;
        if (String(k) !== String(sid) && intVal(p.skill_cooldowns[k], 0) > 0) resetSkillIds.push(intVal(k, 0));
        if (String(k) !== String(sid)) p.skill_cooldowns[k] = 0;
      }
      if (clearedCount >= 2 && !opts.noNestedProc) p.yujian_extra_cast = true;
    }
    // 蓄力技能：进入蓄力状态，不立即造成伤害
    const chargeRounds = intVal(skill.chargeRounds, 0);
    if (chargeRounds > 0 && !opts.skipChargeCheck && !p.ex_weapon?.instant_charge_release) {
      p.xuli = { rounds_remaining: chargeRounds, skill_id: sid, skill_level: lv };
      const chargeName = String(skill.name || `技能${sid}`);
      return { ok: true, events: [
        ...yujianExtraEvents,
        { t: 'combat_log', actor: 'player', target: 'player', action: 'xuli_start',
          text: `${p.name} 开始蓄力${chargeName}！（需${chargeRounds}回合）` }
      ],
      max_single_packet_damage: maxSinglePacketDamage,
      max_single_packet_source: maxSinglePacketSource,
      max_single_packet_damage_overload: maxSinglePacketOverloadDamage,
      max_single_packet_overload_source: maxSinglePacketOverloadSource
      };
    }
    if (chargeRounds > 0 && !opts.skipChargeCheck && p.ex_weapon?.instant_charge_release) {
      p._man_charge_cast = true;
      yujianExtraEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'man_charge_release',
        text: `蛮：${p.name} 的蓄力技能改为立即释放（伤害-50%）` });
    }

    skillMul = _calcSkillMul(skill, lv);
    skillName = String(skill.name || `技能${sid}`);
    isSpell = String(skill.damageType || '') === 'magic';
    if (_hasSkillEffect(skill, 'damage_percent_adaptive_higher_attack')) {
      isSpell = numVal(p.spell_attack, 0) > numVal(p.max_attack, 0);
    }

    // 伏魔：法术攻击目标变为自身
    if (isSpell && e.fumo_rounds > 0) {
      // 敌人不太可能有 fumo，但逻辑完整性需要
    }

    // 治疗技能：player_hp_percent=按法术攻击，heal_max_hp_percent=按最大生命，heal_phys_attack_percent=按物理攻击
    const healEffSpell = (skill.effects || []).find(ef => String(ef?.type || '') === 'player_hp_percent');
    const healEffMaxHp = (skill.effects || []).find(ef => String(ef?.type || '') === 'heal_max_hp_percent');
    const healEffPhysAtk = (skill.effects || []).find(ef => String(ef?.type || '') === 'heal_phys_attack_percent');
    const healTeamEff = (skill.effects || []).find(ef => String(ef?.type || '') === 'heal_team_max_hp_percent');
    const healEff = healEffPhysAtk || healEffMaxHp || healEffSpell;
    _bonusHealEff = healEff;
    _bonusTeamHealEff = healTeamEff;
    if (healEff && String(skill.damageType || '') === 'none') {
      state._lihuo_zhuoshao_this_action = false;
      const turnStartEvts = [];
      if (!opts.skipTurnStart) applySetEffectsOnPlayerTurnStart(state, turnStartEvts);

      const pct = numVal(healEff.value, 0) + (lv > 1 ? (lv - 1) * numVal(healEff.coefficientBonus, 0) : 0);
      let heal;
      if (String(healEff.type || '') === 'heal_max_hp_percent') {
        heal = Math.max(1, Math.floor(p.max_hp * clamp(pct, 0, 1)));
      } else if (String(healEff.type || '') === 'heal_phys_attack_percent') {
        const phAtk = Math.max(1, Math.floor((p.min_attack + p.max_attack) / 2));
        heal = Math.max(1, Math.floor(phAtk * pct));
      } else {
        const spAtk = Math.max(1, p.spell_attack || p.max_attack);
        heal = Math.max(1, Math.floor(spAtk * pct));
      }
      heal = Math.floor(heal * (1.0 + numVal(p.heal_bonus, 0)));
      if (p.zhuohun_rounds > 0 && p.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - p.zhuohun_heal_reduce));
      // 元素亲和：治疗技能(水/混元/无) +0.65%/点
      const skillAttr = String(skill?.attribute || '');
      if (skillAttr === '水' || skillAttr === '混元' || skillAttr === '无') {
        let aff = 0;
        if (skillAttr === '水') aff = numVal(p.water_affinity, 0);
        else if (skillAttr === '混元') aff = numVal(p.hunyuan_affinity, 0);
        else if (skillAttr === '无') aff = numVal(p.wu_affinity, 0);
        if (aff > 0) heal = Math.floor(heal * (1.0 + aff * 0.0065));
      }
      // 完美水灵根：治疗10%暴击，暴击系数1.35
      if (p.perfect_water && nextRand01(state) < 0.10) heal = Math.floor(heal * 1.35);
      const evts = [...turnStartEvts];
      if (isHealForbidden(p)) {
        pushHealForbiddenEvent(p, evts, skillName);
      } else {
        const healed = applyHealWithOverflowShield(p, heal, evts);
        evts.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'heal',
          skill_name: skillName, heal: healed.actualHeal, text: `${p.name} 使用${skillName}，回复了${healed.actualHeal}生命` });
        if (healed.actualHeal > 0) applySetEffectsOnHeal(state, healed.actualHeal, evts);
      }
      // 全队治疗（1v1下仅治疗自身，团队模式下治疗所有友方）
      if (healTeamEff) {
        const _thIsPvp = state?.battle_mode === 'city_duel';
        const teamPct = (_thIsPvp && healTeamEff.pvpValue != null) ? numVal(healTeamEff.pvpValue, 0.15) : numVal(healTeamEff.value, 0.15);
        if (state && Array.isArray(state.allies)) {
          for (const ally of state.allies) {
            if (ally && ally !== p && ally.hp > 0) {
              let allyHeal = Math.max(1, Math.floor(ally.max_hp * clamp(teamPct, 0, 1)));
              allyHeal = Math.floor(allyHeal * (1.0 + numVal(p.heal_bonus, 0)));
              if (isHealForbidden(ally)) {
                pushHealForbiddenEvent(ally, evts, skillName);
                allyHeal = 0;
              } else {
                ally.hp = Math.min(ally.max_hp, ally.hp + allyHeal);
                evts.push({ t: 'combat_log', actor: 'player', target: ally.tag || 'ally', action: 'team_heal',
                  heal: allyHeal, text: `${ally.name} 回复了${allyHeal}生命` });
              }
              if (p.heal_others_self_heal > 0) {
                const selfHealBack = Math.floor(allyHeal * p.heal_others_self_heal);
                if (selfHealBack > 0) {
                  if (tryJiemieHealToXurui(p, selfHealBack, evts, { text: `劫灭-斗战乾坤：治疗回馈无效，获得2轮蓄锐` })) {
                    // 已转为蓄锐
                  } else {
                    if (isHealForbidden(p)) {
                      pushHealForbiddenEvent(p, evts, '治疗回馈');
                    } else {
                      const healed = applyHealWithOverflowShield(p, selfHealBack, evts);
                      evts.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'heal_echo',
                        heal: healed.actualHeal, text: `${p.name} 治疗回馈，回复了${healed.actualHeal}生命` });
                    }
                  }
                }
              }
            }
          }
        }
      }
      evts.push(...applySkillSpecialEffects(skill, lv, p, e, state));
      applySetEffectsOnPlayerTurnEnd(state, evts);
      return {
        ok: true,
        events: [...yujianExtraEvents, ...evts],
        max_single_packet_damage: maxSinglePacketDamage,
        max_single_packet_source: maxSinglePacketSource,
        max_single_packet_damage_overload: maxSinglePacketOverloadDamage,
        max_single_packet_overload_source: maxSinglePacketOverloadSource
      };
    }
    if (String(skill.damageType || '') === 'none') {
      state._lihuo_zhuoshao_this_action = false;
      const turnStartEvts = [];
      if (!opts.skipTurnStart) applySetEffectsOnPlayerTurnStart(state, turnStartEvts);
      const buffEvts = [...turnStartEvts, ...applySkillSpecialEffects(skill, lv, p, e, state)];
      applySetEffectsOnPlayerTurnEnd(state, buffEvts);
      return {
        ok: true,
        events: [...yujianExtraEvents, ...buffEvts],
        max_single_packet_damage: maxSinglePacketDamage,
        max_single_packet_source: maxSinglePacketSource,
        max_single_packet_damage_overload: maxSinglePacketOverloadDamage,
        max_single_packet_overload_source: maxSinglePacketOverloadSource
      };
    }
    const _sacrificeEff = (skill.effects || []).find(ef => String(ef?.type || '') === 'self_sacrifice_damage');
    if (_sacrificeEff) {
      state._lihuo_zhuoshao_this_action = false;
      const turnStartEvts = [];
      if (!opts.skipTurnStart) applySetEffectsOnPlayerTurnStart(state, turnStartEvts);
      const hr = numVal(_sacrificeEff.hpReduceRatio, 0);
      const hpLost = hr > 0 ? Math.floor(p.hp * hr) : Math.max(0, p.hp - 1);
      if (hr > 0) p.hp = Math.max(1, p.hp - hpLost); else p.hp = 1;
      const isPvp = state?.battle_mode === 'city_duel';
      const ratio = isPvp ? numVal(_sacrificeEff.pvpValue, 0.5) : numVal(_sacrificeEff.value, 1.0);
      let dmg = Math.floor(hpLost * ratio);
      if (numVal(p?.kurong_shentu_active, 0) > 0 && dmg > 0) dmg = 0;
      const evts = [...turnStartEvts,
        { t: 'combat_log', actor: 'player', target: 'player', action: 'sacrifice',
          text: `${p.name} 舍身成仁，失去${hpLost}生命！` }];
      dmg = applyTaixuanShentuSkillDamage(p, skill, dmg, evts, { actionName: skillName });
      if (e.hunchong_stacks > 0 && dmg > 0) {
        e.hunchong_stacks -= 1;
        dmg = 0;
        evts.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'hunchong_absorb',
          text: `${e.name} 的缓冲抵消了这次伤害！` });
      } else if (e.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < e.direct_damage_ignore_chance) {
        dmg = 0;
        evts.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'ignore',
          text: `${e.name} 无视了这次伤害！` });
      }
      if (dmg > 0) {
        dmg = _capAndAbsorbDamage(state, e, dmg, evts);
        _recordSinglePacketDamage(dmg, 'self_sacrifice_main', true);
        e.hp = Math.max(0, e.hp - dmg);
      }
      evts.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'skill',
        skill_name: skillName, damage: dmg,
        text: `${p.name} 使用${skillName}，对${e.name}造成${dmg}伤害` });
      if (dmg > 0) {
        evts.push(...applyPostDamageExEffects(p, e, dmg, false, skill, state, false, 1));
      }
      applyFenjieShentuOnDamageSkill(state, p, evts, { skill });
      evts.push(...applySkillSpecialEffects(skill, lv, p, e, state));
      applySetEffectsOnPlayerTurnEnd(state, evts);
      return {
        ok: true,
        events: [...yujianExtraEvents, ...evts],
        max_single_packet_damage: maxSinglePacketDamage,
        max_single_packet_source: maxSinglePacketSource,
        max_single_packet_damage_overload: maxSinglePacketOverloadDamage,
        max_single_packet_overload_source: maxSinglePacketOverloadSource
      };
    }
  }

  state._lihuo_zhuoshao_this_action = false;
  const turnStartEvts = [];
  if (!opts.skipTurnStart) applySetEffectsOnPlayerTurnStart(state, turnStartEvts);

  const _isChargeRelease = opts.skipChargeCheck && skill && intVal(skill.chargeRounds, 0) > 0;
  let _huangPen = 0;
  if (!_isChargeRelease && p.ex_weapon?.non_charge_spell_pen && !p._huang_pen_guard) {
    _huangPen = p.ex_weapon.non_charge_spell_pen;
    p.spell_armor_pen = numVal(p.spell_armor_pen, 0) + _huangPen;
    p._huang_pen_guard = true;
  }

  let damage = 0;
  let isCrit = false;
  let hpAlreadyUpdated = false;
  let _hitCount = 0;
  let henbieliEchoTypeCount = 0;
  const dmgEvents = [];
  const taixuanSkillMul = mode === 'skill' && skill ? getTaixuanShentuSkillDamageMul(p, skill) : 1;
  let taixuanLogged = false;
  const capTaixuPacket = (packetDamage, source = 'direct_hit', countForOverload = true) => {
    let packet = Math.max(0, intVal(packetDamage, 0));
    if (packet <= 0) return 0;
    if (taixuanSkillMul !== 1) {
      packet = Math.max(1, Math.floor(packet * taixuanSkillMul));
      if (!taixuanLogged) {
        const isNeutralSkill = String(skill?.attribute || '') === '无';
        yujianExtraEvents.push({
          t: 'combat_log',
          actor: 'player',
          target: 'enemy',
          action: isNeutralSkill ? 'taixuan_shentu_bonus' : 'taixuan_shentu_penalty',
          text: isNeutralSkill
            ? `${p.name} 的太玄神途生效：无属性技能最终伤害+25%`
            : `${p.name} 的太玄神途生效：非无属性技能最终伤害-20%`
        });
        taixuanLogged = true;
      }
    }
    const dealt = _capAndAbsorbDamage(state, e, packet, dmgEvents);
    _recordSinglePacketDamage(dealt, source, countForOverload);
    return dealt;
  };
  if (mode === 'skill' && skill && _hasSkillEffect(skill, 'wansheng_longwang_po')) {
    const wsl = _calcDamageWanshengLongwangPo(state, p, e, skill, lv);
    damage = wsl.damage;
    isCrit = wsl.isCrit;
    hpAlreadyUpdated = true;
    dmgEvents.push(...(wsl.events || []));
    const wslEff = (skill.effects || []).find(x => String(x?.type || '') === 'wansheng_longwang_po');
    _hitCount = intVal(wslEff?.count, 4) + 1;
    const packetList = Array.isArray(wsl.damagePerHit) ? wsl.damagePerHit : [];
    for (const pkt of packetList) _recordSinglePacketDamage(pkt, 'wansheng_hit', true);
    if (packetList.length <= 0) _recordSinglePacketDamage(wsl.damage, 'wansheng_total', true);
  } else {
    let hits = [];
    if (mode === 'skill' && skill) hits = _collectSkillDamageHits(skill, lv, state);
    if (mode === 'skill' && skill && p.yanmian_multi2 && hits.length === 1 && !hits[0].multiHit) {
      const original = hits[0];
      const hitMul = clamp(numVal(p.yanmian_hit_damage_mul, 0.7), 0, 1);
      hits = [{
        multiHit: true,
        count: 2,
        firstMul: Math.max(0, numVal(original.mul, skillMul)) * hitMul,
        decay: 0.7,
        isSpell: !!original.isSpell,
        opts: original.opts || {}
      }];
      dmgEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'yanmian',
        text: `${p.name} 激发阵形·延绵，本次技能化为2连击（单击伤害-${Math.round((1 - hitMul) * 100)}%）` });
    }
    if (mode === 'skill' && skill && _hasSkillEffect(skill, 'yinyang_toggle')) {
      const isYin = (p.yinyang_state || 'yin') === 'yin';
      for (const h of hits) {
        if (isYin) h.opts.ignoreSpellDefense = Math.max(numVal(h.opts.ignoreSpellDefense, 0), 0.4);
        else h.opts.forceCrit = true;
      }
    }
    const physCritEff = mode === 'skill' && skill ? (skill.effects || []).find(x => String(x?.type || '') === 'damage_percent_range_physical_crit') : null;
    const physDefEff = mode === 'skill' && skill ? (skill.effects || []).find(x => String(x?.type || '') === 'damage_percent_plus_phys_def') : null;
    const spellPhysDefEff = mode === 'skill' && skill ? (skill.effects || []).find(x => String(x?.type || '') === 'damage_spell_phys_def_plus_self_hp_lost') : null;
    const ownPhysDefEff = mode === 'skill' && skill ? (skill.effects || []).find(x => String(x?.type || '') === 'damage_own_phys_def_percent') : null;
    const ownSpellDefEff = mode === 'skill' && skill ? (skill.effects || []).find(x => String(x?.type || '') === 'damage_own_spell_def_percent') : null;
    const specialSingleHitCount = (physCritEff ? 1 : 0)
      + (physDefEff ? 1 : 0)
      + (spellPhysDefEff ? 1 : 0)
      + (ownPhysDefEff ? 1 : 0)
      + (ownSpellDefEff ? 1 : 0);
    const yanmianHitMul = clamp(numVal(p.yanmian_hit_damage_mul, 0.7), 0, 1);
    const yanmianSplitDamage = (baseDamage) => {
      const first = Math.max(1, Math.floor(baseDamage * yanmianHitMul));
      const second = Math.max(1, Math.floor(first * 0.7));
      return [first, second];
    };
    const applySpecialSingleDamage = (baseDamage) => {
      if (!useYanmianOnSpecialSingle) {
        const one = capTaixuPacket(_applyKuangyongBonus(baseDamage, dmgEvents));
        return { total: one, hits: 1 };
      }
      const [first, second] = yanmianSplitDamage(baseDamage);
      dmgEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'yanmian_hit',
        text: `${p.name} 延绵分击：第1击${first}，第2击${second}` });
      const total = capTaixuPacket(_applyKuangyongBonus(first, dmgEvents), 'special_split_hit', true)
        + capTaixuPacket(_applyKuangyongBonus(second, dmgEvents), 'special_split_hit', true);
      return { total, hits: 2 };
    };
    const useYanmianOnSpecialSingle = mode === 'skill' && skill
      && p.yanmian_multi2
      && hits.length === 0
      && specialSingleHitCount === 1;
    if (useYanmianOnSpecialSingle) {
      dmgEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'yanmian',
        text: `${p.name} 激发阵形·延绵，本次技能化为2连击（单击伤害-${Math.round((1 - yanmianHitMul) * 100)}%）` });
    }
    if (physCritEff) {
      const pr = _calcDamagePhysCritRange(state, p, e, physCritEff, lv, skill);
      const applied = applySpecialSingleDamage(pr.damage);
      damage += applied.total;
      if (pr.isCrit) isCrit = true;
      dmgEvents.push(...(pr.events || []));
      _hitCount += applied.hits;
    }
    if (physDefEff) {
      const pr = _calcDamagePercentPlusPhysDef(state, p, e, physDefEff, lv, skill);
      const applied = applySpecialSingleDamage(pr.damage);
      damage += applied.total;
      if (pr.isCrit) isCrit = true;
      dmgEvents.push(...(pr.events || []));
      _hitCount += applied.hits;
    }
    if (spellPhysDefEff) {
      const pr = _calcDamageSpellPhysDefPlusSelfHpLost(state, p, e, spellPhysDefEff, lv, skill);
      const applied = applySpecialSingleDamage(pr.damage);
      damage += applied.total;
      if (pr.isCrit) isCrit = true;
      dmgEvents.push(...(pr.events || []));
      isSpell = true;
      _hitCount += applied.hits;
    }
    if (ownPhysDefEff) {
      const pr = _calcDamageOwnPhysDefPercent(state, p, e, ownPhysDefEff, lv, skill);
      const applied = applySpecialSingleDamage(pr.damage);
      damage += applied.total;
      if (pr.isCrit) isCrit = true;
      dmgEvents.push(...(pr.events || []));
      _hitCount += applied.hits;
    }
    if (ownSpellDefEff) {
      const pr = _calcDamageOwnSpellDefPercent(state, p, e, ownSpellDefEff, lv, skill);
      const applied = applySpecialSingleDamage(pr.damage);
      damage += applied.total;
      if (pr.isCrit) isCrit = true;
      dmgEvents.push(...(pr.events || []));
      isSpell = true;
      _hitCount += applied.hits;
    }
    if (hits.length === 0 && !physCritEff && !physDefEff && !spellPhysDefEff && !ownPhysDefEff && !ownSpellDefEff) {
      if (mode === 'attack' && p.basic_attack_as_spell) isSpell = true;
      hits = [{ mul: skillMul, isSpell, opts: {} }];
    }
    for (const h of hits) {
      if (h.multiHit) {
        const expanded = expandMultiHitDamages(state, p, e, h, mode, skill, lv);
        const rawDamages = (expanded.damages || []).map((dmg) => Math.max(0, intVal(dmg, 0)));
        const burstDamages = rawDamages.map((dmg) => capTaixuPacket(_applyKuangyongBonus(dmg, dmgEvents), 'multi_hit', true));
        if (mode === 'skill' && skill && _hasSkillEffect(skill, 'damage_percent_plus_agility_multi') && burstDamages.length > 1) {
          for (let i = 0; i < burstDamages.length; i++) {
            const rawPacket = rawDamages[i] || 0;
            const finalPacket = burstDamages[i] || 0;
            const extra = finalPacket !== rawPacket
              ? `（原始${rawPacket}，受上限/护盾影响）`
              : '';
            dmgEvents.push({
              t: 'combat_log',
              actor: 'player',
              target: 'enemy',
              action: 'kuanglan_wave_hit',
              damage: finalPacket,
              text: `${p.name} 狂澜第${i + 1}击造成${finalPacket}伤害${extra}`
            });
          }
        }
        const total = burstDamages.reduce((a, b) => a + b, 0);
        damage += total;
        if (expanded.isCrit) isCrit = true;
        dmgEvents.push(...(expanded.events || []));
        _hitCount += burstDamages.length;
      } else {
        const res = _calcDamage(state, p, e, mode, h.mul, h.isSpell, skill, lv, h.opts);
        damage += capTaixuPacket(_applyKuangyongBonus(res.damage, dmgEvents), mode === 'skill' ? 'skill_hit' : 'attack_hit', true);
        if (res.isCrit) isCrit = true;
        dmgEvents.push(...(res.events || []));
        _hitCount++;
      }
    }
  }
  if (mode === 'skill' && skill) {
    for (const eff of (skill.effects || [])) {
      if (String(eff?.type || '') === 'enemy_self_damage_max_hp_percent') {
        const v = numVal(eff.value, 0.12);
        const extra = Math.max(0, Math.floor(e.max_hp * v));
        damage += capTaixuPacket(_applyKuangyongBonus(extra, dmgEvents), 'side_enemy_self_damage', false);
        dmgEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'self_damage',
          damage: extra, text: `${e.name} 自损${extra}点生命（${Math.floor(v * 100)}%最大生命）` });
      }
    }
    if (_hasSkillEffect(skill, 'blossom')) {
      const blossomEff = (skill.effects || []).find(ef => String(ef?.type || '') === 'blossom');
      const physPct = numVal(blossomEff?.physPercent, 0.7);
      const spellPct = numVal(blossomEff?.spellPercent, 0.7);
      const bonusPerDot = numVal(blossomEff?.bonusPerDotType, 0.35);
      const { typeCount, explodeDamage } = getBlossomExplodeInfo(e, state);
      henbieliEchoTypeCount = Math.max(0, intVal(typeCount, 0));
      const mult = 1.0 + bonusPerDot * typeCount;
      const blossomPhys = _calcDamage(state, p, e, mode, physPct * mult, false, skill, lv).damage;
      const blossomSpell = _calcDamage(state, p, e, mode, spellPct * mult, true, skill, lv).damage;
      damage += capTaixuPacket(_applyKuangyongBonus(blossomPhys + blossomSpell + explodeDamage, dmgEvents), 'skill_blossom', true);
      clearBlossomDebuffs(e);
      dmgEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'blossom',
        text: `绽放！引爆${typeCount}种持续伤害，共${blossomPhys + blossomSpell + explodeDamage}点伤害` });
    }
  }
  if (_huangPen > 0) {
    p.spell_armor_pen -= _huangPen;
    p._huang_pen_guard = false;
  }

  if (p._huang_charging && damage > 0 && p.ex_weapon?.charge_damage_mult) {
    const reducedDmg = Math.floor(damage * p.ex_weapon.charge_damage_mult);
    if (hpAlreadyUpdated) e.hp = Math.min(e.max_hp, e.hp + (damage - reducedDmg));
    damage = reducedDmg;
  }

  if (p._man_charge_cast && damage > 0 && p.ex_weapon?.charge_damage_mult) {
    const reducedDmg = Math.floor(damage * p.ex_weapon.charge_damage_mult);
    if (hpAlreadyUpdated) e.hp = Math.min(e.max_hp, e.hp + (damage - reducedDmg));
    damage = reducedDmg;
  }

  if (isSpell && damage > 0 && p.ex_weapon?.solo_spell_final_damage_bonus) {
    const bonus = Math.max(0, Math.floor(damage * numVal(p.ex_weapon.solo_spell_final_damage_bonus, 0)));
    if (bonus > 0) {
      const dealtBonus = _capAndAbsorbDamage(state, e, bonus, yujianExtraEvents);
      _recordSinglePacketDamage(dealtBonus, 'side_solo_spell_bonus', false);
      if (hpAlreadyUpdated) e.hp = Math.max(0, e.hp - dealtBonus);
      damage += dealtBonus;
      yujianExtraEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'shengguitage_solo_bonus',
        text: `神鬼踏歌：无可溅射目标，本次法术伤害提高${dealtBonus}` });
    }
  }

  // 大德广润：1v1下只有一个目标，非PVP伤害+40%
  if (skill && intVal(skill.id, 0) === 62 && damage > 0 && state?.battle_mode !== 'city_duel') {
    let bonus = Math.floor(damage * 0.4);
    bonus = _capAndAbsorbDamage(state, e, bonus, yujianExtraEvents);
    _recordSinglePacketDamage(bonus, 'side_skill62_bonus', false);
    if (hpAlreadyUpdated) e.hp = Math.max(0, e.hp - bonus);
    damage += bonus;
  }

  if (hpAlreadyUpdated && mode === 'skill' && skill && damage > 0) {
    const beforeTaixuan = damage;
    let afterTaixuan = applyTaixuanShentuSkillDamage(p, skill, beforeTaixuan, yujianExtraEvents, { actionName: skillName });
    if (afterTaixuan !== beforeTaixuan) {
      const delta = afterTaixuan - beforeTaixuan;
      if (delta > 0) {
        const dealtDelta = _capAndAbsorbDamage(state, e, delta, yujianExtraEvents);
        _recordSinglePacketDamage(dealtDelta, 'side_taixuan_delta', false);
        if (dealtDelta !== delta) afterTaixuan = beforeTaixuan + dealtDelta;
        e.hp = Math.max(0, e.hp - dealtDelta);
      } else {
        e.hp = Math.min(e.max_hp, e.hp + Math.abs(delta));
      }
    }
    damage = afterTaixuan;
  }

  const detailEvents = [...dmgEvents];
  const allEvents = [...yujianExtraEvents, ...turnStartEvts];

  if (damage > 0) {
    const isMusicSpell = mode === 'skill' && skill && (skill.requirements?.weaponTypes || []).includes('音律') && isSpell;
    if (isMusicSpell && p.ex_weapon?.random_debuff_on_music_skill) {
      const hitCount = Math.max(1, _hitCount);
      for (let i = 0; i < hitCount; i++) {
        detailEvents.push(...applyWanguchouOnMusicHit(p, e, state));
      }
    }
    if (!hpAlreadyUpdated) e.hp = Math.max(0, e.hp - damage);
    tryZhanmoShentuExecute(state, p, e, detailEvents, { damage });
    const jxHitCount = Math.max(1, _hitCount);
    for (let i = 0; i < jxHitCount; i++) _applyJianxinFollowUp(state, p, e, isSpell, skill, lv, detailEvents);
  }

  if (mode === 'skill' && skill && intVal(skill.id, 0) === 39
    && p.ex_weapon?.henbieli_blossom_echo
    && henbieliEchoTypeCount > 0
    && e.hp > 0) {
    const coeff = clamp(numVal(p.ex_weapon.henbieli_echo_coeff, 0.08), 0.02, 0.2);
    const pvpFactor = clamp(numVal(p.ex_weapon.henbieli_pvp_factor, 0.65), 0.3, 1);
    const atkBase = Math.max(1, Math.floor(
      (Math.max(1, numVal(p.max_attack, 1)) + Math.max(1, numVal(p.spell_attack || p.max_attack, 1))) / 2
    ));
    let extra = Math.max(1, Math.floor(atkBase * coeff * henbieliEchoTypeCount));
    if (state?.battle_mode === 'city_duel') {
      extra = Math.max(1, Math.floor(extra * pvpFactor));
    }
    if (e.hunchong_stacks > 0) {
      e.hunchong_stacks -= 1;
      extra = 0;
      detailEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'hunchong_absorb',
        text: `${e.name} 的缓冲抵消了离恨回响！` });
    } else if (e.direct_damage_ignore_chance > 0 && nextRand01(state) < e.direct_damage_ignore_chance) {
      extra = 0;
      detailEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'ignore',
        text: `${e.name} 无视了离恨回响！` });
    }
    if (extra > 0) {
      if (numVal(p?.kurong_shentu_active, 0) > 0) extra = 0;
      extra = _capAndAbsorbDamage(state, e, extra, detailEvents);
      _recordSinglePacketDamage(extra, 'side_henbieli_echo', false);
      e.hp = Math.max(0, e.hp - extra);
      tryZhanmoShentuExecute(state, p, e, detailEvents, { damage: extra });
      damage += extra;
    }
    detailEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'henbieli_echo',
      skill_name: skillName, damage: extra,
      text: `${p.name} 的恨别离引爆${henbieliEchoTypeCount}种DOT，触发离恨回响，造成${extra}伤害` });
  }

  if (p._man_charge_cast && p.ex_weapon?.charge_kill_reset_cd && mode === 'skill' && skill && e.hp <= 0) {
    const manSid = Math.max(1, intVal(skill.id, 0));
    if (manSid > 0 && p.skill_cooldowns) {
      p.skill_cooldowns[String(manSid)] = 0;
      yujianExtraEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'man_charge_reset',
        text: `蛮：${String(skill.name || `技能${manSid}`)}击杀目标，冷却已重置` });
    }
  }
  p._man_charge_cast = false;

  const actionText = mode === 'skill' ? `施放${skillName}` : '攻击';
  allEvents.push({
    t: 'combat_log', actor: 'player', target: 'enemy', action: mode,
    skill_name: skillName, damage, is_crit: isCrit,
    text: isCrit ? `${p.name}${actionText}暴击，造成${damage}伤害` : `${p.name}${actionText}造成${damage}伤害`
  });
  allEvents.push(...detailEvents);
  const lifestealDamageBase = Math.max(0, intVal(damage, 0)) + _sumTempShieldAbsorb(allEvents, 'enemy');

  if (mode === 'skill' && skill && damage > 0) {
    applySkillDamageShieldGain(state, p, skill, lv, damage, allEvents);
  }

  if (damage > 0) {
    const taichuNegCountSnapshot = getNegativeStatusCount(e);
    allEvents.push(...applyPostDamageExEffects(p, e, damage, isSpell, skill, state, isCrit, Math.max(1, _hitCount)));
    allEvents.push(...applySetEffectsOnDealDamage(state, p, e, damage, isSpell, _hitCount, { taichuNegCountSnapshot, damageCategory: 'direct' }));
  }

  // 吸血（物理吸血仅对物理伤害生效，法术吸血仅对法术伤害生效）
  if (p.lifesteal > 0 && lifestealDamageBase > 0 && !isSpell) {
    let heal = Math.floor(lifestealDamageBase * p.lifesteal);
    heal = Math.floor(heal * (1.0 + numVal(p.heal_bonus, 0)));
    if (p.zhuohun_rounds > 0 && p.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - p.zhuohun_heal_reduce));
    if (heal > 0) {
      const lifestealBypass = p.heal_except_lifesteal === true;
      if (isHealForbidden(p) && !lifestealBypass) {
        pushHealForbiddenEvent(p, allEvents, '吸血');
      } else {
        const healed = applyHealWithOverflowShield(p, heal, allEvents);
        allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'lifesteal',
          heal: healed.actualHeal, text: `${p.name} 吸血回复${healed.actualHeal}生命` });
      }
    }
  }
  const spellLs = numVal(p.spell_lifesteal, 0);
  if (spellLs > 0 && lifestealDamageBase > 0 && isSpell) {
    let heal = Math.floor(lifestealDamageBase * spellLs);
    heal = Math.floor(heal * (1.0 + numVal(p.heal_bonus, 0)));
    if (p.zhuohun_rounds > 0 && p.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - p.zhuohun_heal_reduce));
    if (heal > 0) {
      const spellLsBypass = p.heal_except_lifesteal === true;
      if (isHealForbidden(p) && !spellLsBypass) {
        pushHealForbiddenEvent(p, allEvents, '法术吸血');
      } else {
        const healed = applyHealWithOverflowShield(p, heal, allEvents);
        allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'lifesteal',
          heal: healed.actualHeal, text: `${p.name} 法术吸血回复${healed.actualHeal}生命` });
      }
    }
  }

  // 凝滞（直接伤害命中），5件套决意可抵消
  if (p.on_stasis && damage > 0 && nextRand01(state) < p.on_stasis.chance) {
    let stasisDur = consumeJueyiForControl(e, p.on_stasis.duration);
    e.stasis_rounds = Math.max(e.stasis_rounds || 0, stasisDur);
    allEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'stasis',
      text: `${e.name} 被凝滞！下一次行动被跳过` });
  }

  // 寄生（任何直接伤害命中）
  if (p.on_jisheng && damage > 0) {
    const jd = p.on_jisheng;
    allEvents.push(...applyDebuff(e, {
      type: 'jisheng', stacks: jd.duration,
      damagePercent: jd.damagePercent, attribute: 'spell_attack'
    }, state, p));
  }

  // 技能特殊效果
  if (skill && mode === 'skill') {
    allEvents.push(...applySkillSpecialEffects(skill, lv, p, e, state));
  }

  const skipHybridHeal = !!p._skip_hybrid_heal_once;
  p._skip_hybrid_heal_once = false;

  if (_bonusHealEff && mode === 'skill' && skill && !skipHybridHeal) {
    const _healIsPvp = state?.battle_mode === 'city_duel';
    const _healBase = (_healIsPvp && _bonusHealEff.pvpValue != null) ? numVal(_bonusHealEff.pvpValue, 0) : numVal(_bonusHealEff.value, 0);
    const pct = _healBase + (lv > 1 ? (lv - 1) * numVal(_bonusHealEff.coefficientBonus, 0) : 0);
    let heal;
    if (String(_bonusHealEff.type || '') === 'heal_max_hp_percent') {
      heal = Math.max(1, Math.floor(p.max_hp * clamp(pct, 0, 1)));
    } else if (String(_bonusHealEff.type || '') === 'heal_phys_attack_percent') {
      const phAtk = Math.max(1, Math.floor((p.min_attack + p.max_attack) / 2));
      heal = Math.max(1, Math.floor(phAtk * pct));
    } else {
      const spAtk = Math.max(1, p.spell_attack || p.max_attack);
      heal = Math.max(1, Math.floor(spAtk * pct));
    }
    heal = Math.floor(heal * (1.0 + numVal(p.heal_bonus, 0)));
    if (p.zhuohun_rounds > 0 && p.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - p.zhuohun_heal_reduce));
    const skillAttr = String(skill?.attribute || '');
    if (skillAttr === '水' || skillAttr === '混元' || skillAttr === '无') {
      let aff = 0;
      if (skillAttr === '水') aff = numVal(p.water_affinity, 0);
      else if (skillAttr === '混元') aff = numVal(p.hunyuan_affinity, 0);
      else if (skillAttr === '无') aff = numVal(p.wu_affinity, 0);
      if (aff > 0) heal = Math.floor(heal * (1.0 + aff * 0.0065));
    }
    if (p.perfect_water && nextRand01(state) < 0.10) heal = Math.floor(heal * 1.35);
    if (isHealForbidden(p)) {
      pushHealForbiddenEvent(p, allEvents, skillName);
    } else if (tryJiemieHealToXurui(p, heal, allEvents, { text: `劫灭-斗战乾坤：技能回复无效，获得2轮蓄锐` })) {
      // 已转为蓄锐
    } else {
      const healed = applyHealWithOverflowShield(p, heal, allEvents);
      allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'heal',
        skill_name: skillName, heal: healed.actualHeal, text: `${p.name} 使用${skillName}回复了${healed.actualHeal}生命` });
      if (healed.actualHeal > 0) applySetEffectsOnHeal(state, healed.actualHeal, allEvents);
    }
  }
  if (_bonusTeamHealEff && mode === 'skill' && skill && !skipHybridHeal) {
    const _teamHealIsPvp = state?.battle_mode === 'city_duel';
    const teamPct = (_teamHealIsPvp && _bonusTeamHealEff.pvpValue != null) ? numVal(_bonusTeamHealEff.pvpValue, 0.15) : numVal(_bonusTeamHealEff.value, 0.15);
    let selfHeal = Math.max(1, Math.floor(p.max_hp * clamp(teamPct, 0, 1)));
    selfHeal = Math.floor(selfHeal * (1.0 + numVal(p.heal_bonus, 0)));
    if (p.zhuohun_rounds > 0 && p.zhuohun_heal_reduce > 0) selfHeal = Math.floor(selfHeal * (1.0 - p.zhuohun_heal_reduce));
    if (isHealForbidden(p)) {
      pushHealForbiddenEvent(p, allEvents, skillName);
    } else if (tryJiemieHealToXurui(p, selfHeal, allEvents, { text: `劫灭-斗战乾坤：全队回复无效，获得2轮蓄锐` })) {
      // 已转为蓄锐
    } else {
      const healed = applyHealWithOverflowShield(p, selfHeal, allEvents);
      allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'team_heal',
        heal: healed.actualHeal, text: `${p.name} 回复了${healed.actualHeal}生命` });
    }
  }

  if (mode === 'skill' && skill && String(skill.damageType || '') !== 'none') {
    applyFenjieShentuOnDamageSkill(state, p, allEvents, { skill });
  }

  applySetEffectsOnPlayerTurnEnd(state, allEvents);
  return {
    ok: true,
    events: allEvents,
    max_single_packet_damage: maxSinglePacketDamage,
    max_single_packet_source: maxSinglePacketSource,
    max_single_packet_damage_overload: maxSinglePacketOverloadDamage,
    max_single_packet_overload_source: maxSinglePacketOverloadSource
  };
}

// ─── 物品使用 ───

function _playerUseItem(state, itemId) {
  const p = state.player;
  const id = intVal(itemId, 0);
  if (id <= 0) return { ok: false, error: '无效物品' };
  let pos = null;
  for (let pg = 0; pg < (p.inventory || []).length; pg++) {
    const page = p.inventory[pg];
    if (!Array.isArray(page)) continue;
    for (let s = 0; s < page.length; s++) {
      const slot = page[s];
      if (slot?.item && intVal(slot.item.id, 0) === id && intVal(slot.count, 0) > 0) {
        pos = { page: pg, slot: s }; break;
      }
    }
    if (pos) break;
  }
  if (!pos) return { ok: false, error: '药剂不存在或数量不足' };
  const item = getItemById(id);
  if (!item || !item.id) return { ok: false, error: '物品不存在' };
  let healedHp = 0, healedMp = 0;
  const itemEvts = [];
  const playerRealm = getRealmQualityFromLevel(p.level || 1);
  for (const eff of (item.effects || [])) {
    const et = String(eff?.type || '');
    if (et === 'heal_max_hp_percent') {
      let add = Math.floor(p.max_hp * clamp(numVal(eff.value, 0), 0, 1));
      const halveRealm = intVal(eff.halveAboveRealm, 0);
      if (halveRealm > 0 && playerRealm >= halveRealm) add = Math.floor(add * 0.5);
      add = Math.floor(add * (1.0 + numVal(p.heal_bonus, 0)));
      if (add > 0) {
        if (isHealForbidden(p)) {
          pushHealForbiddenEvent(p, itemEvts, '药剂');
        } else if (tryJiemieHealToXurui(p, add, itemEvts, { text: `劫灭-斗战乾坤：药剂回复无效，获得2轮蓄锐` })) {
          healedHp += add;
        } else {
          const healed = applyHealWithOverflowShield(p, add, itemEvts);
          healedHp += healed.actualHeal;
        }
      }
    } else if (et === 'heal_max_mp_percent') {
      let add = Math.floor(p.max_mp * clamp(numVal(eff.value, 0), 0, 1));
      const halveRealm = intVal(eff.halveAboveRealm, 0);
      if (halveRealm > 0 && playerRealm >= halveRealm) add = Math.floor(add * 0.5);
      const before = p.mp;
      p.mp = Math.min(p.max_mp, p.mp + add);
      healedMp += p.mp - before;
    }
  }
  if (healedHp <= 0 && healedMp <= 0) return { ok: false, error: '该物品不能在战斗中使用' };
  const sl = p.inventory[pos.page][pos.slot];
  if (intVal(sl.count, 1) <= 1) p.inventory[pos.page][pos.slot] = null;
  else sl.count -= 1;
  if (!p._consumed_items || typeof p._consumed_items !== 'object' || Array.isArray(p._consumed_items)) {
    p._consumed_items = {};
  }
  const k = String(id);
  p._consumed_items[k] = intVal(p._consumed_items[k], 0) + 1;
  const parts = [];
  if (itemEvts.length > 0) parts.push('获得2轮蓄锐');
  else if (healedHp > 0) parts.push(`回复${healedHp}生命`);
  if (healedMp > 0) parts.push(`回复${healedMp}法力`);
  const evts = [{ t: 'combat_log', actor: 'player', target: 'player', action: 'item',
    item_name: String(item.name || ''), text: `${p.name}使用${item.name}，${parts.join('，')}` }];
  if (itemEvts.length > 0) evts.push(...itemEvts);
  return { ok: true, events: evts };
}

// ─── 敌人行动决策 ───

/** 返回敌人当前可用的技能 ID 列表（cd<=0 且 mp>=cost） */
function _getEnemyAvailableSkills(state) {
  const e = state.enemy;
  const cds = e.skill_cooldowns || {};
  const equipped = Array.isArray(e.equipped_skills) ? e.equipped_skills : [];
  const available = [];
  for (const sid of equipped) {
    const skill = getSkillById(sid);
    if (!skill || !skill.id) continue;
    const cd = intVal(cds[String(sid)], 0);
    const mpCost = Math.max(0, intVal(skill.mpCost, 0));
    if (cd <= 0 && intVal(e.mp, 0) >= mpCost) available.push(intVal(sid, 0));
  }
  return available;
}

/** 敌人本回合行动：'attack' 或技能 ID */
function _enemyDecideAction(state) {
  const e = state.enemy;
  const availSkills = _getEnemyAvailableSkills(state);
  if (e.juemai_rounds > 0) return 'attack';
  if (e.bofa_rounds > 0 && availSkills.length > 0) {
    return availSkills[Math.floor(nextRand01(state) * availSkills.length)];
  }
  if (availSkills.length === 0) return 'attack';
  if (nextRand01(state) < 0.4) return availSkills[Math.floor(nextRand01(state) * availSkills.length)];
  return 'attack';
}

// ─── 敌人攻击 ───

function _enemyAttack(state) {
  const p = state.player;
  const e = state.enemy;
  let base = e.fear_rounds > 0 ? e.min_attack : rollInt(state, e.min_attack, e.max_attack);
  const isCrit = nextRand01(state) < e.crit_rate;
  const critMul = isCrit ? e.crit_mult : 1.0;

  let effectiveDef = p.defense;
  if (p.beishui_rounds > 0 || e.beishui_rounds > 0) effectiveDef = 0;
  else {
    if (p.chuanxin_rounds > 0 && !p.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6); // 完美土：免疫防御降低
    if (p.jiangu) effectiveDef += Math.floor(p.defense * p.jiangu.physCoeff);
    if (p?.fumo_shentu_active) effectiveDef = Math.min(Math.max(0, numVal(effectiveDef, 0)), 6000);
  }

  let raw = Math.floor(base * critMul);
  const flatDamage = _getFlatDamageBonus(e, false);
  if (flatDamage > 0) raw += flatDamage;
  if (p.beishui_rounds > 0 || e.beishui_rounds > 0) raw = Math.floor(raw * 1.2);

  if (p.hunchong_stacks > 0) {
    p.hunchong_stacks -= 1;
    return { ok: true, events: [{ t: 'combat_log', actor: 'enemy', target: 'player', action: 'hunchong_absorb',
      damage: 0, text: `${p.name} 的缓冲抵消了${e.name}的攻击！` }], max_single_packet_damage: 0 };
  }
  if (p.direct_damage_ignore_chance > 0 && nextRand01(state) < p.direct_damage_ignore_chance) {
    return { ok: true, events: [{ t: 'combat_log', actor: 'enemy', target: 'player', action: 'attack',
      damage: 0, text: `${p.name} 无视了${e.name}的攻击！` }], max_single_packet_damage: 0 };
  }

  let damage = calcReducedDamage(raw, effectiveDef, numVal(p.defense_divisor, 8000));
  if (numVal(e?.kurong_shentu_active, 0) > 0 && damage > 0) damage = 0;
  if (p.damage_reduction > 0) damage = Math.floor(damage * (1.0 - clamp(p.damage_reduction, 0, 0.85)));
  if (p.phys_damage_reduction_bonus > 0) damage = Math.floor(damage * (1.0 - clamp(p.phys_damage_reduction_bonus, 0, 0.6)));

  const setResult = { events: [], damage: 0 };
  const damageBeforeMitigation = Math.max(0, intVal(damage, 0));
  const hadTempShieldBeforeHit = intVal(p.temp_shield, 0) > 0;
  applySetEffectsOnPlayerDamaged(state, damage, setResult, { preMitigationDamage: Math.max(0, intVal(raw, 0)) });
  damage = setResult.damage;
  _recordZhenyueShanpo(p, setResult.events, damage);

  const events = [{ t: 'combat_log', actor: 'enemy', target: 'player', action: 'attack',
    damage, is_crit: isCrit,
    text: isCrit ? `${e.name} 暴击造成${damage}伤害` : `${e.name} 造成${damage}伤害` }];
  tryZhanmoShentuExecute(state, e, p, events, { damage });
  events.push(...setResult.events);
  if (damageBeforeMitigation > 0 && hadTempShieldBeforeHit) {
    applyShieldedDamageReflect(state, e, p, events, { hadTempShieldBeforeDamage: true });
  }

  // 反击（待发100% + 坤德概率，可同时生效视为多击共两次）
  const equippedCoeff = p.on_counter ? (p.on_counter.damageCoeff || 0) : 0;
  const daifaCoeff = equippedCoeff > 0 ? equippedCoeff : _getKunDeCounterCoeff(p);
  const _counterIsPvp = state?.battle_mode === 'city_duel';
  const _counterPhysBonus = _counterIsPvp ? 0 : Math.floor(Math.floor((p.min_attack + p.max_attack) / 2) * 0.20);
  const doCounter = (counterCoeff, source = 'kunde') => {
    if (p.hp <= 0 || numVal(counterCoeff, 0) <= 0) return;
    let counterDmg = Math.max(1, Math.floor(p.defense * numVal(counterCoeff, 0) + _counterPhysBonus));
    const ctrBonus = _counterIsPvp
      ? numVal(p?.ex_weapon?.pvp_counter_damage_bonus, 0)
      : numVal(p?.ex_weapon?.counter_damage_bonus, 0);
    if (ctrBonus > 0) counterDmg = Math.max(1, Math.floor(counterDmg * (1.0 + ctrBonus)));
    if (numVal(p?.kurong_shentu_active, 0) > 0 && counterDmg > 0) counterDmg = 0;
    const yebaoActive = numVal(p?.yebao_shentu_active, 0) > 0;
    let counterIsCrit = false;
    if (yebaoActive && counterDmg > 0) {
      const critChance = clamp(numVal(p?.crit_rate, 0), 0, 0.95);
      counterIsCrit = nextRand01(state) < critChance;
      if (counterIsCrit) {
        counterDmg = Math.max(1, Math.floor(counterDmg * Math.max(1.0, numVal(p?.crit_mult, 1.5))));
      }
    }
    const poshangChance = _counterIsPvp ? 0.2 : 0.4;
    const poshangBoost = numVal(p?.poshang_shentu_active, 0) > 0 && counterDmg > 0 && nextRand01(state) < poshangChance;
    if (poshangBoost) {
      counterDmg = Math.max(1, Math.floor(counterDmg * 3));
      events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'poshang_boost',
        text: `${p.name} 的破障神途触发：本次反击伤害提升至300%` });
    }
    counterDmg = _capAndAbsorbDamage(state, e, counterDmg, events);
    e.hp = Math.max(0, e.hp - counterDmg);
    tryZhanmoShentuExecute(state, p, e, events, { damage: counterDmg });
    const srcText = source === 'daifa' ? '（待发触发）' : '（坤德触发）';
    events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'counter',
      damage: counterDmg, is_crit: counterIsCrit,
      text: counterIsCrit ? `${p.name}${srcText}反击暴击造成${counterDmg}伤害！` : `${p.name}${srcText}反击造成${counterDmg}伤害！` });
    if (yebaoActive && counterDmg > 0) {
      const taichuNegCountSnapshot = getNegativeStatusCount(e);
      events.push(...applyPostDamageExEffects(p, e, counterDmg, false, null, state, counterIsCrit, 1));
      events.push(...applySetEffectsOnDealDamage(state, p, e, counterDmg, false, 1, { taichuNegCountSnapshot, damageCategory: 'direct' }));
    }
    const counterHealRatio = clamp(numVal(p.counter_heal_ratio, 0), 0, 0.8);
    if (counterHealRatio > 0 && counterDmg > 0) {
      const heal = Math.max(1, Math.floor(counterDmg * counterHealRatio));
      const beforeHp = p.hp;
      p.hp = Math.min(p.max_hp || p.hp, p.hp + heal);
      const actualHeal = Math.max(0, p.hp - beforeHp);
      if (actualHeal > 0) {
        events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'counter_heal',
          heal: actualHeal, text: `${p.name} 反击回气，回复${actualHeal}生命` });
      }
    }
  };
  const counterTriggerByHit = damage > 0 || (damageBeforeMitigation > 0 && hadTempShieldBeforeHit);
  if (counterTriggerByHit && p.hp > 0) {
    if (p.daifa_rounds > 0) doCounter(daifaCoeff, 'daifa'); // 待发必定反击（坤德已习得可生效）
    if (p.on_counter && p.hp > 0 && nextRand01(state) < (p.on_counter.chance || 0)) doCounter(equippedCoeff, 'kunde'); // 坤德概率反击
  }

  return { ok: true, events, max_single_packet_damage: Math.max(0, intVal(damage, 0)) };
}

// ─── 敌人释放技能 ───

function _enemyUseSkill(state, skillId, opts = {}) {
  const p = state.player;
  const e = state.enemy;
  e._man_charge_cast = false;
  let skill = getSkillById(skillId);
  if (!skill || !skill.id) return _enemyAttack(state);
  let actualSkill = skill;
  let actualLv = _getSkillLevel(e, skillId);
  let damageBonusMul = 1.0;
  let shifangExtraEvents = [];
  let maxSinglePacketDamage = 0;
  const _recordSinglePacketDamage = (v) => {
    const n = Math.max(0, intVal(v, 0));
    if (n > maxSinglePacketDamage) maxSinglePacketDamage = n;
  };

  let mimicSourceSkillName = null;
  // mimic_opponent_skill：从玩家已装配技能中随机选一个非 enemySkill 执行
  if (_hasSkillEffect(skill, 'mimic_opponent_skill')) {
    mimicSourceSkillName = String(skill.name || `技能${skillId}`);
    const mimicEff = (skill.effects || []).find(x => String(x?.type || '') === 'mimic_opponent_skill');
    damageBonusMul = 1.0 + numVal(mimicEff?.damageBonus, 0.10);
    const playerSkills = Array.isArray(p.equipped_skills) ? p.equipped_skills : [];
    const nonEnemySkills = playerSkills.filter(sid => {
      const s = getSkillById(sid);
      const tags = Array.isArray(s?.tags) ? s.tags : [];
      return s && s.id && !tags.includes('enemySkill');
    });
    if (nonEnemySkills.length > 0) {
      const picked = nonEnemySkills[Math.floor(nextRand01(state) * nonEnemySkills.length)];
      actualSkill = getSkillById(picked);
      actualLv = _getSkillLevel(p, picked);
      if (!actualSkill || !actualSkill.id) return _enemyAttack(state);
    } else {
      return _enemyAttack(state);
    }
  }

  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  if (!opts.skipMpCost) e.mp = Math.max(0, e.mp - mpCost);
  if (!e.skill_cooldowns) e.skill_cooldowns = {};
  let effCdE = intVal(skill.cooldown, 0);
  if (state?.battle_mode === 'city_duel' && intVal(skill.pvpCooldown, 0) > 0) effCdE = intVal(skill.pvpCooldown, 0);
  if (actualLv > 1 && numVal(skill.cooldownPerLevel, 0) > 0) effCdE += (actualLv - 1) * numVal(skill.cooldownPerLevel, 0);
  if (actualLv >= (intVal(skill.levelCap, 99) || 99) && intVal(skill.maxLevelCooldownReduction, 0) > 0) effCdE = Math.max(0, effCdE - intVal(skill.maxLevelCooldownReduction, 0));
  if (_hasSkillEffect(actualSkill, 'blossom')) {
    const { typeCount } = getBlossomExplodeInfo(p, state);
    if (state?.battle_mode !== 'city_duel' && typeCount < 2) effCdE = 0;
  }
  if (!opts.skipCooldown) e.skill_cooldowns[String(skillId)] = Math.max(0, effCdE);
  let resetSkillIds = [];
  if (_hasSkillEffect(skill, 'clear_other_skill_cooldowns')) {
    for (const k of Object.keys(e.skill_cooldowns || {})) {
      if (String(k) !== String(skillId) && intVal(e.skill_cooldowns[k], 0) > 0) resetSkillIds.push(intVal(k, 0));
      if (String(k) !== String(skillId)) e.skill_cooldowns[k] = 0;
    }
  }

  const skillName = String(actualSkill.name || `技能${actualSkill.id}`);
  let isSpell = String(actualSkill.damageType || '') === 'magic';
  if (_hasSkillEffect(actualSkill, 'damage_percent_adaptive_higher_attack')) {
    isSpell = numVal(e.spell_attack, 0) > numVal(e.max_attack, 0);
  }

  // 蓄力技能（敌方）
  const chargeRoundsE = intVal(actualSkill.chargeRounds, 0);
  if (chargeRoundsE > 0 && !opts.skipChargeCheck && !e.ex_weapon?.instant_charge_release) {
    e.xuli = { rounds_remaining: chargeRoundsE, skill_id: skillId, skill_level: actualLv };
    return { ok: true, events: [
      ...shifangExtraEvents,
      { t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'xuli_start',
        text: `${e.name} 开始蓄力${skillName}！（需${chargeRoundsE}回合）` }
    ], max_single_packet_damage: maxSinglePacketDamage };
  }
  if (chargeRoundsE > 0 && !opts.skipChargeCheck && e.ex_weapon?.instant_charge_release) {
    e._man_charge_cast = true;
    shifangExtraEvents.push({ t: 'combat_log', actor: 'enemy', target: 'player', action: 'man_charge_release',
      text: `蛮：${e.name} 的蓄力技能改为立即释放（伤害-50%）` });
  }

  // 治疗技能（敌人自我治疗）：player_hp_percent=按法术攻击，heal_max_hp_percent=按最大生命
  const healEffSpellE = (actualSkill.effects || []).find(ef => String(ef?.type || '') === 'player_hp_percent');
  const healEffMaxHpE = (actualSkill.effects || []).find(ef => String(ef?.type || '') === 'heal_max_hp_percent');
  const healEff = healEffMaxHpE || healEffSpellE;
  if (healEff) {
    const healEvents = [];
    const pct = numVal(healEff.value, 0) + (actualLv > 1 ? (actualLv - 1) * numVal(healEff.coefficientBonus, 0) : 0);
    let heal;
    if (String(healEff.type || '') === 'heal_max_hp_percent') {
      heal = Math.max(1, Math.floor(e.max_hp * clamp(pct, 0, 1)));
    } else {
      const spAtk = Math.max(1, e.spell_attack || e.max_attack);
      heal = Math.max(1, Math.floor(spAtk * pct));
    }
    heal = Math.floor(heal * (1.0 + numVal(e.heal_bonus, 0)));
    if (e.zhuohun_rounds > 0 && e.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - e.zhuohun_heal_reduce));
    if (isHealForbidden(e)) {
      pushHealForbiddenEvent(e, healEvents, skillName);
      heal = 0;
    } else {
      e.hp = Math.min(e.max_hp, e.hp + heal);
    }
    const healLog = mimicSourceSkillName
      ? `${e.name} 使用${mimicSourceSkillName}，模仿了${skillName}，回复了${heal}生命`
      : `${e.name} 使用${skillName}，回复了${heal}生命`;
    return {
      ok: true,
      max_single_packet_damage: maxSinglePacketDamage,
      events: [
        ...shifangExtraEvents,
        ...healEvents,
        { t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'heal',
          skill_name: skillName, heal, text: healLog }
      ]
    };
  }

  state._lihuo_zhuoshao_this_action = false;
  const damagePackets = [];
  let isCrit = false;
  const dmgEvents = [];

  const hits = _collectSkillDamageHits(actualSkill, actualLv, state);
  if (_hasSkillEffect(actualSkill, 'yinyang_toggle')) {
    const isYin = (e.yinyang_state || 'yin') === 'yin';
    for (const h of hits) {
      if (isYin) h.opts.ignoreSpellDefense = Math.max(numVal(h.opts.ignoreSpellDefense, 0), 0.4);
      else h.opts.forceCrit = true;
    }
  }
  const physCritEff = (actualSkill.effects || []).find(x => String(x?.type || '') === 'damage_percent_range_physical_crit');
  const physDefEff = (actualSkill.effects || []).find(x => String(x?.type || '') === 'damage_percent_plus_phys_def');
  const spellPhysDefEff = (actualSkill.effects || []).find(x => String(x?.type || '') === 'damage_spell_phys_def_plus_self_hp_lost');
  const ownPhysDefEffE = (actualSkill.effects || []).find(x => String(x?.type || '') === 'damage_own_phys_def_percent');
  const ownSpellDefEffE = (actualSkill.effects || []).find(x => String(x?.type || '') === 'damage_own_spell_def_percent');
  if (physCritEff) {
    const pr = _calcDamagePhysCritRange(state, e, p, physCritEff, actualLv, actualSkill);
    damagePackets.push(pr.damage);
    if (pr.isCrit) isCrit = true;
    dmgEvents.push(...(pr.events || []));
  }
  if (physDefEff) {
    const pr = _calcDamagePercentPlusPhysDef(state, e, p, physDefEff, actualLv, actualSkill);
    damagePackets.push(pr.damage);
    if (pr.isCrit) isCrit = true;
    dmgEvents.push(...(pr.events || []));
  }
  if (spellPhysDefEff) {
    const pr = _calcDamageSpellPhysDefPlusSelfHpLost(state, e, p, spellPhysDefEff, actualLv, actualSkill);
    damagePackets.push(pr.damage);
    if (pr.isCrit) isCrit = true;
    dmgEvents.push(...(pr.events || []));
    isSpell = true;
  }
  if (ownPhysDefEffE) {
    const pr = _calcDamageOwnPhysDefPercent(state, e, p, ownPhysDefEffE, actualLv, actualSkill);
    damagePackets.push(pr.damage);
    if (pr.isCrit) isCrit = true;
    dmgEvents.push(...(pr.events || []));
  }
  if (ownSpellDefEffE) {
    const pr = _calcDamageOwnSpellDefPercent(state, e, p, ownSpellDefEffE, actualLv, actualSkill);
    damagePackets.push(pr.damage);
    if (pr.isCrit) isCrit = true;
    dmgEvents.push(...(pr.events || []));
    isSpell = true;
  }
  const fallbackHits = hits.length === 0 && !physCritEff && !physDefEff && !spellPhysDefEff && !ownPhysDefEffE && !ownSpellDefEffE
    ? [{ mul: _calcSkillMul(actualSkill, actualLv), isSpell, opts: {} }]
    : hits;
  for (const h of fallbackHits) {
    if (h.multiHit) {
      const expanded = expandMultiHitDamages(state, e, p, h, 'skill', actualSkill, actualLv);
      damagePackets.push(...expanded.damages);
      if (expanded.isCrit) isCrit = true;
      dmgEvents.push(...(expanded.events || []));
    } else {
      const res = _calcDamage(state, e, p, 'skill', h.mul, h.isSpell, actualSkill, actualLv, h.opts || {});
      damagePackets.push(res.damage);
      if (res.isCrit) isCrit = true;
      dmgEvents.push(...(res.events || []));
    }
  }

  for (const eff of (actualSkill.effects || [])) {
    if (String(eff?.type || '') === 'enemy_self_damage_max_hp_percent') {
      const v = numVal(eff.value, 0.12);
      let extra = Math.max(0, Math.floor(e.max_hp * v));
      extra = _capAndAbsorbDamage(state, e, extra, dmgEvents);
      e.hp = Math.max(0, e.hp - extra);
      dmgEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'self_damage',
        damage: extra, text: `${e.name} 自损${extra}点生命（${Math.floor(v * 100)}%最大生命）` });
    }
  }
  if (_hasSkillEffect(actualSkill, 'blossom')) {
    const blossomEff = (actualSkill.effects || []).find(ef => String(ef?.type || '') === 'blossom');
    const physPct = numVal(blossomEff?.physPercent, 0.7);
    const spellPct = numVal(blossomEff?.spellPercent, 0.7);
    const bonusPerDot = numVal(blossomEff?.bonusPerDotType, 0.35);
    const { typeCount, explodeDamage } = getBlossomExplodeInfo(p, state);
    const mult = 1.0 + bonusPerDot * typeCount;
    const blossomPhys = _calcDamage(state, e, p, 'skill', physPct * mult, false, actualSkill, actualLv).damage;
    const blossomSpell = _calcDamage(state, e, p, 'skill', spellPct * mult, true, actualSkill, actualLv).damage;
    damagePackets.push(blossomPhys + blossomSpell + explodeDamage);
    clearBlossomDebuffs(p);
    dmgEvents.push({ t: 'combat_log', actor: 'enemy', target: 'player', action: 'blossom',
      text: `绽放！引爆${typeCount}种持续伤害，共${blossomPhys + blossomSpell + explodeDamage}点伤害` });
  }

  for (let i = 0; i < damagePackets.length; i++) {
    damagePackets[i] = Math.floor(damagePackets[i] * damageBonusMul);
  }

  const taixuanMul = getTaixuanShentuSkillDamageMul(e, actualSkill);
  if (taixuanMul !== 1 && damagePackets.length > 0) {
    const beforeTaixuan = damagePackets.reduce((a, b) => a + Math.max(0, intVal(b, 0)), 0);
    for (let i = 0; i < damagePackets.length; i++) {
      const pkt = Math.max(0, intVal(damagePackets[i], 0));
      damagePackets[i] = pkt > 0 ? Math.max(1, Math.floor(pkt * taixuanMul)) : 0;
    }
    if (beforeTaixuan > 0) {
      const isNeutralSkill = String(actualSkill?.attribute || '') === '无';
      shifangExtraEvents.push({
        t: 'combat_log',
        actor: 'enemy',
        target: 'player',
        action: isNeutralSkill ? 'taixuan_shentu_bonus' : 'taixuan_shentu_penalty',
        text: isNeutralSkill
          ? `${e.name} 的太玄神途生效：无属性技能最终伤害+25%`
          : `${e.name} 的太玄神途生效：非无属性技能最终伤害-20%`
      });
    }
  }

  const equippedCounterCoeff = p.on_counter ? (p.on_counter.damageCoeff || 0) : 0;
  const daifaCounterCoeff = equippedCounterCoeff > 0 ? equippedCounterCoeff : _getKunDeCounterCoeff(p);
  const detailEvents = [...dmgEvents];
  const doCounterSkill = (counterCoeff, source = 'kunde') => {
    if (p.hp <= 0 || numVal(counterCoeff, 0) <= 0) return;
    let counterDmg = Math.max(1, Math.floor(p.defense * numVal(counterCoeff, 0)));
    const ctrBonus = (state?.battle_mode === 'city_duel')
      ? numVal(p?.ex_weapon?.pvp_counter_damage_bonus, 0)
      : numVal(p?.ex_weapon?.counter_damage_bonus, 0);
    if (ctrBonus > 0) counterDmg = Math.max(1, Math.floor(counterDmg * (1.0 + ctrBonus)));
    if (numVal(p?.kurong_shentu_active, 0) > 0 && counterDmg > 0) counterDmg = 0;
    const yebaoActive = numVal(p?.yebao_shentu_active, 0) > 0;
    let counterIsCrit = false;
    if (yebaoActive && counterDmg > 0) {
      const critChance = clamp(numVal(p?.crit_rate, 0), 0, 0.95);
      counterIsCrit = nextRand01(state) < critChance;
      if (counterIsCrit) {
        counterDmg = Math.max(1, Math.floor(counterDmg * Math.max(1.0, numVal(p?.crit_mult, 1.5))));
      }
    }
    const poshangChance = (state?.battle_mode === 'city_duel') ? 0.2 : 0.4;
    const poshangBoost = numVal(p?.poshang_shentu_active, 0) > 0 && counterDmg > 0 && nextRand01(state) < poshangChance;
    if (poshangBoost) {
      counterDmg = Math.max(1, Math.floor(counterDmg * 3));
      detailEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'poshang_boost',
        text: `${p.name} 的破障神途触发：本次反击伤害提升至300%` });
    }
    counterDmg = _capAndAbsorbDamage(state, e, counterDmg, detailEvents);
    e.hp = Math.max(0, e.hp - counterDmg);
    tryZhanmoShentuExecute(state, p, e, detailEvents, { damage: counterDmg });
    const srcText = source === 'daifa' ? '（待发触发）' : '（坤德触发）';
    detailEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'counter',
      damage: counterDmg, is_crit: counterIsCrit,
      text: counterIsCrit ? `${p.name}${srcText}反击暴击造成${counterDmg}伤害！` : `${p.name}${srcText}反击造成${counterDmg}伤害！` });
    if (yebaoActive && counterDmg > 0) {
      const taichuNegCountSnapshot = getNegativeStatusCount(e);
      detailEvents.push(...applyPostDamageExEffects(p, e, counterDmg, false, null, state, counterIsCrit, 1));
      detailEvents.push(...applySetEffectsOnDealDamage(state, p, e, counterDmg, false, 1, { taichuNegCountSnapshot, damageCategory: 'direct' }));
    }
    const counterHealRatio = clamp(numVal(p.counter_heal_ratio, 0), 0, 0.8);
    if (counterHealRatio > 0 && counterDmg > 0) {
      const heal = Math.max(1, Math.floor(counterDmg * counterHealRatio));
      const beforeHp = p.hp;
      p.hp = Math.min(p.max_hp || p.hp, p.hp + heal);
      const actualHeal = Math.max(0, p.hp - beforeHp);
      if (actualHeal > 0) {
        detailEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'counter_heal',
          heal: actualHeal, text: `${p.name} 反击回气，回复${actualHeal}生命` });
      }
    }
  };

  let damage = 0;
  const setResult = { events: [], damage: 0 };
  let shouldShieldReflect = false;
  for (let idx = 0; idx < damagePackets.length; idx++) {
    let d = damagePackets[idx];
    if (d <= 0) continue;
    const preCounterDamage = Math.max(0, intVal(d, 0));
    const preMitigationDamage = Math.max(0, intVal(d, 0));
    if (p.hunchong_stacks > 0) {
      p.hunchong_stacks -= 1;
      detailEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'hunchong_absorb',
        text: `${p.name} 的缓冲抵消了这次伤害！` });
      d = 0;
    } else if (p.direct_damage_ignore_chance > 0 && nextRand01(state) < p.direct_damage_ignore_chance) {
      detailEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'ignore',
        text: `${p.name} 无视了这次伤害！` });
      d = 0;
    }
    let hadTempShieldBeforeHit = false;
    let counterTriggerByHit = false;
    if (d > 0) {
      hadTempShieldBeforeHit = intVal(p.temp_shield, 0) > 0;
      setResult.events = [];
      setResult.damage = 0;
      applySetEffectsOnPlayerDamaged(state, d, setResult, { preMitigationDamage });
      d = setResult.damage;
      _recordZhenyueShanpo(p, detailEvents, d);
      tryZhanmoShentuExecute(state, e, p, detailEvents, { damage: d });
      _recordSinglePacketDamage(d);
      damage += d;
      detailEvents.push(...setResult.events);
      if (hadTempShieldBeforeHit) shouldShieldReflect = true;
      counterTriggerByHit = d > 0 || (hadTempShieldBeforeHit && preCounterDamage > 0);
    }
    if (counterTriggerByHit && p.hp > 0) {
      if (p.daifa_rounds > 0) doCounterSkill(daifaCounterCoeff, 'daifa');
      const skillCounterChance = clamp((p?.on_counter?.chance || 0) + numVal(p.counter_skill_hit_chance_bonus, 0), 0, 0.95);
      if (p.on_counter && p.hp > 0 && nextRand01(state) < skillCounterChance) doCounterSkill(equippedCounterCoeff, 'kunde');
    }
  }

  if (shouldShieldReflect) {
    applyShieldedDamageReflect(state, e, p, detailEvents, { hadTempShieldBeforeDamage: true });
  }

  const mimicLog = mimicSourceSkillName
    ? (isCrit ? `${e.name} 使用${mimicSourceSkillName}，模仿了${skillName}，暴击造成${damage}伤害` : `${e.name} 使用${mimicSourceSkillName}，模仿了${skillName}，造成${damage}伤害`)
    : (isCrit ? `${e.name} 施放${skillName}暴击，造成${damage}伤害` : `${e.name} 施放${skillName}造成${damage}伤害`);

  if (e._man_charge_cast && damage > 0 && e.ex_weapon?.charge_damage_mult) {
    damage = Math.floor(damage * e.ex_weapon.charge_damage_mult);
  }
  if (isSpell && damage > 0 && e.ex_weapon?.solo_spell_final_damage_bonus) {
    const bonus = Math.max(0, Math.floor(damage * numVal(e.ex_weapon.solo_spell_final_damage_bonus, 0)));
    if (bonus > 0) {
      damage += bonus;
      shifangExtraEvents.push({ t: 'combat_log', actor: 'enemy', target: 'player', action: 'shengguitage_solo_bonus',
        text: `神鬼踏歌：无可溅射目标，本次法术伤害提高${bonus}` });
    }
  }

  const allEvents = [
    ...shifangExtraEvents,
    {
    t: 'combat_log', actor: 'enemy', target: 'player', action: 'skill',
    skill_name: skillName, damage, is_crit: isCrit,
    text: mimicLog
    }
  ];
  allEvents.push(...detailEvents);
  const enemyLifestealDamageBase = Math.max(0, intVal(damage, 0)) + _sumTempShieldAbsorb(allEvents, 'player');

  if (damage > 0) {
    applySkillDamageShieldGain(state, e, actualSkill, actualLv, damage, allEvents);
  }

  if (damage > 0) {
    const taichuNegCountSnapshot = getNegativeStatusCount(p);
    allEvents.push(...applyPostDamageExEffects(e, p, damage, isSpell, actualSkill, state, isCrit, Math.max(1, damagePackets.length)));
    allEvents.push(...applySetEffectsOnDealDamage(state, e, p, damage, isSpell, Math.max(1, damagePackets.length), { taichuNegCountSnapshot, damageCategory: 'direct' }));
  }

  if (actualSkill && String(actualSkill.damageType || '') !== 'none') {
    applyFenjieShentuOnDamageSkill(state, e, allEvents, { skill: actualSkill });
  }

  if (e._man_charge_cast && e.ex_weapon?.charge_kill_reset_cd && p.hp <= 0) {
    const manSid = Math.max(1, intVal(skillId, 0));
    if (manSid > 0 && e.skill_cooldowns) {
      e.skill_cooldowns[String(manSid)] = 0;
      allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'man_charge_reset',
        text: `蛮：${String(skillName || `技能${manSid}`)}击杀目标，冷却已重置` });
    }
  }
  e._man_charge_cast = false;

  if (e.lifesteal > 0 && enemyLifestealDamageBase > 0) {
    let heal = Math.floor(enemyLifestealDamageBase * e.lifesteal);
    if (e.zhuohun_rounds > 0 && e.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - e.zhuohun_heal_reduce));
    if (heal > 0) {
      const enemyLsBypass = e.heal_except_lifesteal === true;
      if (isHealForbidden(e) && !enemyLsBypass) {
        pushHealForbiddenEvent(e, allEvents, '吸血');
      } else {
        e.hp = Math.min(e.max_hp, e.hp + heal);
        allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'lifesteal',
          heal, text: `${e.name} 吸血回复${heal}生命` });
      }
    }
  }

  if (e.on_stasis && damage > 0 && nextRand01(state) < (e.on_stasis?.chance || 0)) {
    const rawDur = e.on_stasis.duration || 1;
    const stasisDur = consumeJueyiForControl(p, rawDur);
    p.stasis_rounds = Math.max(p.stasis_rounds || 0, stasisDur);
    allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'player', action: 'stasis',
      text: `${p.name} 被凝滞！下一次行动被跳过` });
  }

  allEvents.push(...applySkillSpecialEffects(actualSkill, actualLv, e, p, state));

  return { ok: true, events: allEvents, max_single_packet_damage: maxSinglePacketDamage };
}

// ─── UI helpers ───

function _appendSkillMeta(state) {
  const p = state.player || {};
  const cds = p.skill_cooldowns || {};
  const equipped = Array.isArray(p.equipped_skills) ? p.equipped_skills : [];
  const available = [];
  for (const sid of equipped) {
    const skill = getSkillById(sid);
    if (!skill || !skill.id) continue;
    const cd = intVal(cds[String(sid)], 0);
    if (cd <= 0 && intVal(p.mp, 0) >= Math.max(0, intVal(skill.mpCost, 0)))
      available.push(intVal(sid, 0));
  }
  p.available_skill_ids = available;
}

// ─── 行动条 ───

function _advanceActionBars(state, tickSec = 0.6) {
  const p = state.player, e = state.enemy;
  let pSpeed = Math.max(1.0, calcActionSpeed(p.agility));
  let eSpeed = Math.max(1.0, calcActionSpeed(e.agility));
  if (p.slow_effect) pSpeed *= p.slow_effect.speedMultiplier;
  if (e.slow_effect) eSpeed *= e.slow_effect.speedMultiplier;
  if (intVal(p.lingjie_overload_rounds, 0) > 0) pSpeed *= 0.85;
  if (intVal(e.lingjie_overload_rounds, 0) > 0) eSpeed *= 0.85;
  if (p.chengfeng) pSpeed *= (1.0 + p.chengfeng.speedBonus);
  if (e.chengfeng) eSpeed *= (1.0 + e.chengfeng.speedBonus);
  if (p.fenjin_active) pSpeed *= 1.3;
  p.action_bar = clamp((p.action_bar || 0) + pSpeed * tickSec, 0, 100);
  e.action_bar = clamp((e.action_bar || 0) + eSpeed * tickSec, 0, 100);
}

function _pickActor(state) {
  const pBar = state.player?.action_bar || 0;
  const eBar = state.enemy?.action_bar || 0;
  if (pBar < 100 && eBar < 100) return 'none';
  if (pBar >= 100 && eBar >= 100) return pBar >= eBar ? 'player' : 'enemy';
  return pBar >= 100 ? 'player' : 'enemy';
}

// ─── 主入口 ───

function applyCommand(stateInput, command) {
  const state = stateInput || {};
  if (state.status !== 'active') return { ok: false, error: '战斗已结束' };
  const cmd = command && typeof command === 'object' ? command : {};
  const action = String(cmd.action || 'attack');
  if (!['attack', 'skill', 'item'].includes(action)) return { ok: false, error: '不支持的战斗指令' };
  const allEvents = [];
  _ensureKeySkillState(state.player);

  _advanceActionBars(state, 0.6);
  let actor = _pickActor(state);
  let actorPreMeta = { tempShieldBefore: 0, target_max_hp_before_action: 0 };
  if (actor === 'player') state.player.action_bar = Math.max(0, state.player.action_bar - 100);
  else if (actor === 'enemy') state.enemy.action_bar = Math.max(0, state.enemy.action_bar - 100);

  if (actor === 'none') {
    state.turn = 'wait';
    _appendSkillMeta(state);
    return { ok: true, state, events: [], ended: false, victory: false, draw: false };
  }

  // 凝滞跳过（蓄力期间凝滞仅消耗凝滞层数，不推进蓄力）
  if (actor === 'player' && state.player.stasis_rounds > 0) {
    state.player.stasis_rounds -= 1;
    allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'stasis_skip',
      text: `${state.player.name} 被凝滞，无法行动！` });
    actor = 'skip';
  } else if (actor === 'enemy' && state.enemy.stasis_rounds > 0) {
    state.enemy.stasis_rounds -= 1;
    allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'stasis_skip',
      text: `${state.enemy.name} 被凝滞，无法行动！` });
    actor = 'skip';
  }

  // 蓄力处理：凝滞不推进蓄力，绝脉不中断蓄力
  if (actor === 'player' && state.player.xuli) {
    actorPreMeta = {
      tempShieldBefore: intVal(state.player.temp_shield, 0),
      target_max_hp_before_action: intVal(state.enemy?.max_hp, 0)
    };
    state.player.xuli.rounds_remaining -= 1;
    if (state.player.xuli.rounds_remaining <= 0) {
      const xuliData = state.player.xuli;
      state.player.xuli = null;
      const chargeSkill = getSkillById(xuliData.skill_id);
      if (chargeSkill) {
        allEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'xuli_release',
          text: `${state.player.name} 蓄力完成，释放${chargeSkill.name || '蓄力技能'}！` });
        consumeNextActionHeal(state.player, state, allEvents);
        const chargeResult = _runLingjieActionModifier(state, 'player', allEvents,
          () => _playerAttack(state, 'skill', xuliData.skill_id, { skipCooldown: true, skipMpCost: true, skipChargeCheck: true }));
        if (chargeResult.ok) allEvents.push(...(chargeResult.events || []));
        _applyLingjiePostAction(state, 'player', chargeResult.events || [], allEvents, {
          ...actorPreMeta,
          max_single_packet_damage: intVal(chargeResult?.max_single_packet_damage, 0),
          max_single_packet_source: String(chargeResult?.max_single_packet_source || ''),
          max_single_packet_damage_overload: intVal(chargeResult?.max_single_packet_damage_overload, intVal(chargeResult?.max_single_packet_damage, 0)),
          max_single_packet_overload_source: String(chargeResult?.max_single_packet_overload_source || chargeResult?.max_single_packet_source || '')
        });
      }
      const debuffEvts = triggerDebuffs(state.enemy, state);
      allEvents.push(...debuffEvts);
      applyTurnEndRecovery(state.player, allEvents);
      tickJueyi(state.player);
      _decrementStatesWithZhenyue(state, state.player, state.enemy, allEvents);
      actor = 'skip';
    } else if (state.player.ex_weapon?.charge_can_act) {
      state.player._huang_charging = true;
      allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'huang_charge_act',
        text: `荒：蓄力中可行动（伤害-50%），剩余${state.player.xuli.rounds_remaining}回合` });
    } else {
      allEvents.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'xuli_charging',
        text: `${state.player.name} 正在蓄力中...（剩余${state.player.xuli.rounds_remaining}回合）` });
      _applyLingjiePostAction(state, 'player', [], allEvents, actorPreMeta);
      _decrementStatesWithZhenyue(state, state.player, state.enemy, allEvents);
      actor = 'skip';
    }
  } else if (actor === 'enemy' && state.enemy.xuli) {
    actorPreMeta = {
      tempShieldBefore: intVal(state.enemy.temp_shield, 0),
      target_max_hp_before_action: intVal(state.player?.max_hp, 0)
    };
    state.enemy.xuli.rounds_remaining -= 1;
    if (state.enemy.xuli.rounds_remaining <= 0) {
      const xuliData = state.enemy.xuli;
      state.enemy.xuli = null;
      const chargeSkill = getSkillById(xuliData.skill_id);
      if (chargeSkill) {
        allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'player', action: 'xuli_release',
          text: `${state.enemy.name} 蓄力完成，释放${chargeSkill.name || '蓄力技能'}！` });
        consumeNextActionHeal(state.enemy, state, allEvents);
        const chargeResult = _runLingjieActionModifier(state, 'enemy', allEvents,
          () => _enemyUseSkill(state, xuliData.skill_id, { skipCooldown: true, skipMpCost: true, skipChargeCheck: true }));
        allEvents.push(...(chargeResult.events || []));
        _applyLingjiePostAction(state, 'enemy', chargeResult.events || [], allEvents, {
          ...actorPreMeta,
          max_single_packet_damage: intVal(chargeResult?.max_single_packet_damage, 0),
          max_single_packet_source: String(chargeResult?.max_single_packet_source || ''),
          max_single_packet_damage_overload: intVal(chargeResult?.max_single_packet_damage_overload, intVal(chargeResult?.max_single_packet_damage, 0)),
          max_single_packet_overload_source: String(chargeResult?.max_single_packet_overload_source || chargeResult?.max_single_packet_source || '')
        });
      }
      allEvents.push(...triggerDebuffs(state.player, state));
      _decrementStatesWithZhenyue(state, state.enemy, state.player, allEvents);
    } else {
      allEvents.push({ t: 'combat_log', actor: 'enemy', target: 'enemy', action: 'xuli_charging',
        text: `${state.enemy.name} 正在蓄力中...（剩余${state.enemy.xuli.rounds_remaining}回合）` });
      _applyLingjiePostAction(state, 'enemy', [], allEvents, actorPreMeta);
      _decrementStatesWithZhenyue(state, state.enemy, state.player, allEvents);
    }
    actor = 'skip';
  }

  if (actor !== 'skip') {
    actorPreMeta = {
      tempShieldBefore: intVal(_getLingjieActingUnit(state, actor)?.temp_shield, 0),
      target_max_hp_before_action: intVal(_getLingjieOpposingUnit(state, actor)?.max_hp, 0)
    };
    if (actor === 'player') consumeNextActionHeal(state.player, state, allEvents);
    else if (actor === 'enemy') consumeNextActionHeal(state.enemy, state, allEvents);

    if (actor === 'player') _decrementCooldowns(state.player);
    else if (actor === 'enemy') _decrementCooldowns(state.enemy);

    if (actor === 'player') {
      state.turn = 'player';
      let pAct;
      let skillActuallyUsed = false;
      let actionToRun = action;
      let skillIdToRun = intVal(cmd.skill_id, 0);
      const keySkillId = intVal(state.player.key_skill_id, 0);
      const missTurns = intVal(state.player.key_skill_miss_turns, 0);
      // 勃发：玩家端也强制走技能（可用技能存在时）
      if ((state.player.bofa_rounds || 0) > 0 && actionToRun !== 'skill') {
        const equipped = Array.isArray(state.player.equipped_skills) ? state.player.equipped_skills : [];
        const available = equipped.filter(sid => _canUseSkillNow(state.player, sid));
        if (available.length > 0) {
          actionToRun = 'skill';
          skillIdToRun = intVal(available[0], 0);
          allEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'bofa_force',
            text: `勃发生效：本回合强制释放${String(getSkillById(skillIdToRun)?.name || ('技能' + skillIdToRun))}` });
        }
      }
      if (keySkillId > 0 && missTurns >= 4 && _canUseSkillNow(state.player, keySkillId)) {
        actionToRun = 'skill';
        skillIdToRun = keySkillId;
        allEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'key_skill_force',
          text: `KEY技能保底触发：本回合强制释放${String(getSkillById(keySkillId)?.name || ('技能' + keySkillId))}` });
      }

      if (actionToRun === 'item') pAct = _playerUseItem(state, intVal(cmd.item_id, 0));
      else if (actionToRun === 'skill') {
        pAct = _runLingjieActionModifier(state, 'player', allEvents, () => _playerAttack(state, 'skill', skillIdToRun));
        if (!pAct.ok) {
          // 技能条件不满足（武器类型/冷却/法力等）时改为普攻，避免回合被吞
          allEvents.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'fallback',
            text: `${pAct.error || '技能无法释放'}，改为普通攻击` });
          pAct = _runLingjieActionModifier(state, 'player', allEvents, () => _playerAttack(state, 'attack', 0));
        } else skillActuallyUsed = true;
      } else pAct = _runLingjieActionModifier(state, 'player', allEvents, () => _playerAttack(state, 'attack', 0));
      if (!pAct.ok) return pAct;
      allEvents.push(...(pAct.events || []));
      // 追踪功法/技能经验数据：直接伤害 + 玩家施加的 DOT（1v1 中敌方 debuff 均由玩家造成）
      for (const ev of (pAct.events || [])) {
        if (ev.damage > 0 && ev.actor === 'player') state._total_player_damage = (state._total_player_damage || 0) + ev.damage;
      }
      const debuffEvts = triggerDebuffs(state.enemy, state);
      for (const ev of debuffEvts) {
        if (ev.damage > 0 && ev.action === 'debuff_tick' && (ev.target === 'enemy' || String(ev.target || '').startsWith('enemy'))) {
          state._total_player_damage = (state._total_player_damage || 0) + ev.damage;
        }
      }
      allEvents.push(...debuffEvts);
      if (actionToRun === 'skill' && skillActuallyUsed && skillIdToRun > 0) {
        if (!Array.isArray(state._used_skill_ids)) state._used_skill_ids = [];
        state._used_skill_ids.push(skillIdToRun);
      }
      if (keySkillId > 0) {
        if (skillActuallyUsed && actionToRun === 'skill' && skillIdToRun === keySkillId) state.player.key_skill_miss_turns = 0;
        else state.player.key_skill_miss_turns = missTurns + 1;
      }
      applyTurnEndRecovery(state.player, allEvents);
      tickJueyi(state.player);
      _decrementStatesWithZhenyue(state, state.player, state.enemy, allEvents);
      _applyLingjiePostAction(state, 'player', pAct.events || [], allEvents, {
        ...actorPreMeta,
        max_single_packet_damage: intVal(pAct?.max_single_packet_damage, 0),
        max_single_packet_source: String(pAct?.max_single_packet_source || ''),
        max_single_packet_damage_overload: intVal(pAct?.max_single_packet_damage_overload, intVal(pAct?.max_single_packet_damage, 0)),
        max_single_packet_overload_source: String(pAct?.max_single_packet_overload_source || pAct?.max_single_packet_source || '')
      });
      state.player._huang_charging = false;
    } else {
      state.turn = 'enemy';
      const eDecision = _enemyDecideAction(state);
      const eAct = eDecision === 'attack'
        ? _runLingjieActionModifier(state, 'enemy', allEvents, () => _enemyAttack(state))
        : _runLingjieActionModifier(state, 'enemy', allEvents, () => _enemyUseSkill(state, eDecision));
      allEvents.push(...(eAct.events || []));
      allEvents.push(...triggerDebuffs(state.player, state));
      _decrementStatesWithZhenyue(state, state.enemy, state.player, allEvents);
      _applyLingjiePostAction(state, 'enemy', eAct.events || [], allEvents, {
        ...actorPreMeta,
        max_single_packet_damage: intVal(eAct?.max_single_packet_damage, 0),
        max_single_packet_source: String(eAct?.max_single_packet_source || ''),
        max_single_packet_damage_overload: intVal(eAct?.max_single_packet_damage_overload, intVal(eAct?.max_single_packet_damage, 0)),
        max_single_packet_overload_source: String(eAct?.max_single_packet_overload_source || eAct?.max_single_packet_source || '')
      });
    }
  }

  // 胜负判定
  if (state.enemy.hp <= 0) {
    state.status = 'finished'; state.turn = 'none'; state.draw = false;
    allEvents.push({ t: 'battle_end', victory: true, draw: false, text: '战斗胜利！' });
    _appendSkillMeta(state);
    return { ok: true, state, events: allEvents, ended: true, victory: true, draw: false };
  }
  if (state.player.hp <= 0) {
    state.status = 'finished'; state.turn = 'none'; state.draw = false;
    allEvents.push({ t: 'battle_end', victory: false, draw: false, text: '战斗失败！' });
    _appendSkillMeta(state);
    return { ok: true, state, events: allEvents, ended: true, victory: false, draw: false };
  }

  state.round = Math.max(1, intVal(state.round, 1) + 1);
  if (intVal(state.round, 1) > MAX_BATTLE_ROUNDS) {
    state.status = 'finished';
    state.turn = 'none';
    state.draw = true;
    allEvents.push({
      t: 'battle_end',
      victory: false,
      draw: true,
      text: `战斗超过${MAX_BATTLE_ROUNDS}回合，强制平局。`
    });
    _appendSkillMeta(state);
    return { ok: true, state, events: allEvents, ended: true, victory: false, draw: true };
  }
  state.turn = 'next';
  state.draw = false;
  _appendSkillMeta(state);
  return { ok: true, state, events: allEvents, ended: false, victory: false, draw: false };
}

function stateToClient(state) {
  if (!state || typeof state !== 'object') return {};
  const s = {};
  for (const k in state) {
    if (k === 'rng_seed' || k === 'rng_cursor' || k === 'event_index' || k === 'server_driven') continue;
    if (k === 'player' || k === 'enemy') continue; // handle separately
    s[k] = state[k];
  }
  const p = state.player;
  if (p && typeof p === 'object') {
    const pc = {};
    for (const pk in p) {
      if (pk === 'inventory' || pk === 'skill_levels' || pk === '_consumed_items') continue;
      pc[pk] = p[pk];
    }
    s.player = pc;
  }
  const e = state.enemy;
  if (e && typeof e === 'object') {
    s.enemy = { ...e };
  }
  return s;
}

function stateLite(state) {
  if (!state) return {};
  const p = state.player || {};
  const e = state.enemy || {};
  return {
    player: {
      hp: p.hp, max_hp: p.max_hp, mp: p.mp, max_mp: p.max_mp,
      action: p.action, action_bar: p.action_bar,
      max_action: p.max_action, max_action_bar: p.max_action_bar,
      available_skill_ids: p.available_skill_ids,
      min_attack: p.min_attack, max_attack: p.max_attack,
      defense: p.defense, spell_attack: p.spell_attack, spell_defense: p.spell_defense,
      min_phys_damage: p.min_phys_damage, max_phys_damage: p.max_phys_damage,
      phys_defense: p.phys_defense, min_spell_attack: p.min_spell_attack, max_spell_attack: p.max_spell_attack,
      strength: p.strength, constitution: p.constitution, bone: p.bone,
      zhenyuan: p.zhenyuan, lingli: p.lingli, agility: p.agility
    },
    enemy: {
      hp: e.hp, max_hp: e.max_hp, mp: e.mp, max_mp: e.max_mp,
      action: e.action, action_bar: e.action_bar,
      max_action: e.max_action, max_action_bar: e.max_action_bar,
      name: e.name
    }
  };
}

Object.assign(module.exports, { createInitialBattleState, applyCommand, stateToClient, stateLite });
