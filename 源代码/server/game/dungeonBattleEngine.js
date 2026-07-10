/**
 * 副本多人回合制战斗引擎
 * 纯回合制：按敏捷排序决定行动顺序
 * 与 1v1 战斗共用完整技能伤害逻辑（combatDamage）
 */
const { getSkillById } = require('./dataLoader');
const CU = require('./combatUtils');
const CD = require('./combatDamage');
const { intVal, numVal, clamp, deepClone, nextRand01, rollInt, calcReducedDamage,
  buildPlayerSnapshot, buildEnemySnapshot,
  applyDebuff, triggerDebuffs, decrementStates, applyTurnEndRecovery,
  applySkillSpecialEffects, applyWanguchouOnMusicHit, applyPostDamageExEffects,
  getNegativeStatusCount,
  tickJueyi, consumeJueyiForControl,
  isPvpBattleMode,
  isHealForbidden, pushHealForbiddenEvent, consumeNextActionHeal,
  isKurongShentuActive,
  getTaixuanShentuSkillDamageMul,
  applyTaixuanShentuSkillDamage,
  applyHealWithOverflowShield, absorbDamageByTempShield,
  tryJiemieHealToXurui,
  capIncomingDamageByTaixu,
  applyFenjieShentuOnDamageSkill,
  initTechniqueBattleStartEffects, applyShieldedDamageReflect,
  applySkillDamageShieldGain,
  tryZhanmoShentuExecute,
  applySetEffectsOnPlayerTurnStart, applySetEffectsOnDealDamage,
  applySetEffectsOnHeal, applySetEffectsOnPlayerTurnEnd, applySetEffectsOnPlayerDamaged
} = CU;
const {
  calcSkillMul: _calcSkillMulCD,
  collectSkillDamageHits,
  hasSkillEffect,
  calcDamage,
  expandMultiHitDamages,
  calcDamagePhysCritRange,
  calcDamagePercentPlusPhysDef,
  calcDamageSpellPhysDefPlusSelfHpLost,
  calcDamageOwnPhysDefPercent,
  calcDamageOwnSpellDefPercent,
  calcDamageWanshengLongwangPo,
  getBlossomExplodeInfo,
  clearBlossomDebuffs
} = CD;

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

function _buildBattleStartCooldowns(unit) {
  const out = {};
  for (const sidRaw of (Array.isArray(unit?.equipped_skills) ? unit.equipped_skills : [])) {
    const sid = Math.max(1, intVal(sidRaw, 0));
    if (sid > 0) out[String(sid)] = 0;
  }
  return out;
}

// ─── Skill helpers ───

function _getSkillLevel(unit, skillId) {
  const d = unit.skill_levels?.[String(skillId)];
  if (d && typeof d === 'object') return Math.max(1, intVal(d.level, 1));
  return Math.max(1, intVal(d, 1));
}

function _calcSkillMul(skill, lv) {
  return _calcSkillMulCD(skill, lv);
}

function _capAndAbsorbDamage(state, target, damage, events) {
  let dealt = capIncomingDamageByTaixu(target, damage, events, { state }).damage;
  dealt = absorbDamageByTempShield(target, dealt, events);
  dealt = Math.max(0, intVal(dealt, 0));
  _recordZhenyueShanpo(target, events, dealt);
  return dealt;
}

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

function _triggerZhenyueOnExpire(state, unit, target, events) {
  if (!unit || !events) return;
  const stacks = Math.max(0, intVal(unit.zhenyue_shanpo, 0));
  unit.zhenyue_shanpo = 0;
  if (stacks <= 0) return;

  const coeff = _getKunDeCounterCoeff(unit);
  if (coeff <= 0) {
    events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player', action: 'zhenyue_end',
      text: `${unit.name} 的镇岳结束，但未习得坤德镇狱功，山魄未能化为反击` });
    return;
  }

  let victim = target;
  if (!victim || victim.hp <= 0 || victim.alive === false) {
    const candidates = _aliveUnits(state, !unit.is_ally);
    victim = _pickTarget(state, candidates) || candidates[0] || null;
  }
  if (!victim || victim.hp <= 0 || victim.alive === false) return;

  const isPvp = isPvpBattleMode(state?.battle_mode);
  const physBonus = (!isPvp && unit.is_ally) ? Math.floor(Math.floor((unit.min_attack + unit.max_attack) / 2) * 0.20) : 0;
  const ctrBonus = isPvp
    ? numVal(unit?.ex_weapon?.pvp_counter_damage_bonus, 0)
    : numVal(unit?.ex_weapon?.counter_damage_bonus, 0);

  for (let i = 0; i < stacks; i++) {
    if (victim.hp <= 0) break;
    let dmg = Math.max(1, Math.floor(unit.defense * coeff + physBonus));
    if (ctrBonus > 0) dmg = Math.max(1, Math.floor(dmg * (1.0 + ctrBonus)));
    if (isKurongShentuActive(unit) && dmg > 0) dmg = 0;
    dmg = _capAndAbsorbDamage(state, victim, dmg, events);
    victim.hp = Math.max(0, victim.hp - dmg);
    if (victim.hp <= 0) victim.alive = false;
    tryZhanmoShentuExecute(state, unit, victim, events, { damage: dmg });
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: victim.tag || 'enemy',
      action: 'zhenyue_counter',
      damage: dmg,
      text: `${unit.name} 的镇岳山魄反击造成${dmg}伤害！`
    });
  }
}

function _decrementStatesWithZhenyue(state, unit, fallbackTarget, events) {
  const before = intVal(unit?.zhenyue_rounds, 0);
  decrementStates(unit, state);
  if (before > 0 && intVal(unit?.zhenyue_rounds, 0) <= 0) {
    _triggerZhenyueOnExpire(state, unit, fallbackTarget, events);
  }
}

// ─── Turn management ───

function _getTurnAgility(unit) {
  let agi = Math.max(0, numVal(unit?.agility, 0));
  // 与常规战斗保持一致：按状态携带的倍率生效
  if (unit?.chengfeng) agi *= (1.0 + numVal(unit.chengfeng.speedBonus, 0.3));
  if (unit?.slow_effect) agi *= numVal(unit.slow_effect.speedMultiplier, 0.7);
  return agi;
}

function _buildTurnQueue(state) {
  const units = [];
  const allies = Array.isArray(state?.allies) ? state.allies : [];
  const enemies = Array.isArray(state?.enemies) ? state.enemies : [];
  for (let i = 0; i < allies.length; i++) {
    const a = allies[i];
    if (!a || typeof a !== 'object') continue;
    if (!a.alive || numVal(a.hp, 0) <= 0) continue;
    let tag = String(a.tag || '').trim();
    if (!tag) {
      tag = `ally_${i}`;
      a.tag = tag;
      a.index = intVal(a.index, i);
    }
    units.push({ tag, agility: _getTurnAgility(a), tieRand: nextRand01(state) });
  }
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || typeof e !== 'object') continue;
    if (!e.alive || numVal(e.hp, 0) <= 0) continue;
    const idx = intVal(e.index, i);
    let tag = String(e.tag || '').trim();
    if (!tag) {
      tag = `enemy_${idx}`;
      e.tag = tag;
      e.index = idx;
    }
    units.push({ tag, agility: _getTurnAgility(e), tieRand: nextRand01(state) });
  }
  units.sort((a, b) => {
    if (b.agility !== a.agility) return b.agility - a.agility;
    return b.tieRand - a.tieRand;
  });
  state.turn_queue = units.map(u => u.tag);
}

function _getUnit(state, tag) {
  const sid = String(tag || '').trim();
  if (!sid) return null;
  if (sid.startsWith('ally_')) {
    const idx = intVal(sid.split('_')[1], -1);
    return idx >= 0 && idx < state.allies.length ? state.allies[idx] : null;
  }
  if (sid.startsWith('enemy_')) {
    for (const e of state.enemies) {
      if (e && typeof e === 'object' && String(e.tag || '') === sid) return e;
    }
    const idx = intVal(sid.split('_')[1], -1);
    for (const e of state.enemies) {
      if (e && typeof e === 'object' && intVal(e.index, -1) === idx) return e;
    }
  }
  return null;
}

function _aliveUnits(state, wantAlly) {
  const arr = wantAlly ? state.allies : state.enemies;
  return (Array.isArray(arr) ? arr : []).filter(u => u && typeof u === 'object' && u.alive && numVal(u.hp, 0) > 0);
}

function _finishAsDraw(state, events = [], reasonText = '') {
  state.status = 'finished';
  state.draw = true;
  const text = String(reasonText || `战斗超过${MAX_BATTLE_ROUNDS}回合，强制平局。`);
  return {
    ok: true,
    state,
    events: [...events, { t: 'battle_end', victory: false, draw: true, text }],
    ended: true,
    victory: false,
    draw: true
  };
}

function _pickTarget(state, targets) {
  const list = (Array.isArray(targets) ? targets : []).filter(t => t && typeof t === 'object' && t.alive && numVal(t.hp, 0) > 0);
  if (list.length === 0) return null;
  const marked = list.filter(t => numVal(t.mark_rounds, 0) > 0);
  if (marked.length > 0) return marked[Math.floor(nextRand01(state) * marked.length)];
  return list[Math.floor(nextRand01(state) * list.length)];
}

const NONE_SKILL_FORCE_ENEMY_EFFECT_TYPES = new Set([
  'apply_slow',
  'apply_fear',
  'apply_wenluan',
  'botaoyi_flow',
  'clear_target_buffs',
  'deal_target_current_hp_true_damage',
  'deal_target_lost_hp_true_damage',
  'deal_self_current_hp_physical_damage',
  'deal_self_current_mp_spell_damage',
  'mimic_opponent_skill'
]);

function _noneSkillTargetsEnemy(skill) {
  const effects = Array.isArray(skill?.effects) ? skill.effects : [];
  for (const eff of effects) {
    const et = String(eff?.type || '');
    if (NONE_SKILL_FORCE_ENEMY_EFFECT_TYPES.has(et)) return true;
  }
  return false;
}

function _isTeamBattleState(state) {
  return Array.isArray(state?.allies) && Array.isArray(state?.enemies);
}

function _pickExtraTargets(state, targets, excludeTag, count) {
  const pool = (targets || []).filter(t => t && t.alive && t.hp > 0 && t.tag !== excludeTag);
  const picked = [];
  while (pool.length > 0 && picked.length < count) {
    const idx = Math.floor(nextRand01(state) * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

function _appendUnitDiedEventIfNeeded(unit, events) {
  if (!unit || unit.hp > 0) return;
  events.push({ t: 'unit_died', actor: unit.tag, text: `${unit.name} 被击败了！` });
}

function _applyDirectSplashDamage(state, attacker, defender, finalDmg, isSpell, skillName, events) {
  if (!attacker || !defender || finalDmg <= 0) return;
  if (isKurongShentuActive(attacker)) return;
  if (!_isTeamBattleState(state)) return;
  const ratio = Math.max(0, numVal(isSpell ? attacker.spell_splash_pct : attacker.phys_splash_pct, 0));
  if (ratio <= 0) return;
  const otherTargets = _aliveUnits(state, !attacker.is_ally).filter(u => u.tag !== defender.tag);
  if (otherTargets.length <= 0) return;

  for (const tgt of otherTargets) {
    let splash = Math.max(1, Math.floor(finalDmg * ratio));
    if (tgt.hunchong_stacks > 0) {
      tgt.hunchong_stacks -= 1;
      splash = 0;
      events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
        text: `${tgt.name} 的缓冲抵消了溅射伤害！` });
    } else if (tgt.direct_damage_ignore_chance > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
      splash = 0;
      events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
        text: `${tgt.name} 无视了溅射伤害！` });
    }
    if (splash > 0) {
      splash = _capAndAbsorbDamage(state, tgt, splash, events);
      tgt.hp = Math.max(0, tgt.hp - splash);
      if (tgt.hp <= 0) tgt.alive = false;
      tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: splash });
    }
    events.push({
      t: 'combat_log',
      actor: attacker.tag,
      target: tgt.tag,
      action: 'affix_splash',
      skill_name: skillName || '',
      damage: splash,
      text: `${attacker.name} 的${isSpell ? '法术' : '物理'}溅射命中${tgt.name}，造成${splash}伤害`
    });
    _appendUnitDiedEventIfNeeded(tgt, events);
  }
}

function _applyShengguitageDirect(state, attacker, defender, finalDmg, isSpell, skillName, events) {
  let damage = Math.max(0, intVal(finalDmg, 0));
  if (isKurongShentuActive(attacker)) return damage;
  if (!attacker?.ex_weapon || !isSpell || damage <= 0) return damage;
  const minPct = Math.max(0, numVal(attacker.ex_weapon.spell_direct_splash_min, 0));
  const maxPct = Math.max(minPct, numVal(attacker.ex_weapon.spell_direct_splash_max, minPct));
  const bonusPct = Math.max(0, numVal(attacker.ex_weapon.solo_spell_final_damage_bonus, 0));
  if (minPct <= 0 && bonusPct <= 0) return damage;

  const otherTargets = _aliveUnits(state, !attacker.is_ally).filter(u => u.tag !== defender.tag);
  if (otherTargets.length <= 0) {
    if (bonusPct > 0) {
      const bonus = Math.max(0, Math.floor(damage * bonusPct));
      if (bonus > 0) {
        damage += bonus;
        events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'shengguitage_solo_bonus',
          text: `神鬼踏歌：无可溅射目标，本次法术伤害提高${bonus}` });
      }
    }
    return damage;
  }

  for (const tgt of otherTargets) {
    let ratio = minPct;
    if (maxPct > minPct) ratio = minPct + nextRand01(state) * (maxPct - minPct);
    let splash = Math.max(1, Math.floor(damage * ratio));
    if (tgt.hunchong_stacks > 0) {
      tgt.hunchong_stacks -= 1;
      splash = 0;
      events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
        text: `${tgt.name} 的缓冲抵消了神鬼踏歌溅射！` });
    } else if (tgt.direct_damage_ignore_chance > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
      splash = 0;
      events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
        text: `${tgt.name} 无视了神鬼踏歌溅射！` });
    }
    if (splash > 0) {
      splash = _capAndAbsorbDamage(state, tgt, splash, events);
      tgt.hp = Math.max(0, tgt.hp - splash);
      if (tgt.hp <= 0) tgt.alive = false;
      tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: splash });
    }
    events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'shengguitage_splash',
      skill_name: skillName || '', damage: splash,
      text: `${attacker.name} 的神鬼踏歌溅射命中${tgt.name}，造成${splash}伤害` });
    _appendUnitDiedEventIfNeeded(tgt, events);
  }
  return damage;
}

function _applyHenbieliBlossomEcho(state, attacker, defender, dotTypeCount, skillName, events) {
  if (isKurongShentuActive(attacker)) return;
  if (!attacker?.ex_weapon?.henbieli_blossom_echo) return;
  const count = Math.max(0, intVal(dotTypeCount, 0));
  if (count <= 0) return;

  const coeff = clamp(numVal(attacker.ex_weapon.henbieli_echo_coeff, 0.08), 0.02, 0.2);
  const pvpFactor = clamp(numVal(attacker.ex_weapon.henbieli_pvp_factor, 0.65), 0.3, 1);
  const splashRatio = clamp(numVal(attacker.ex_weapon.henbieli_echo_splash_ratio, 0.4), 0, 1);
  const attackBase = Math.max(1, Math.floor(
    (Math.max(1, numVal(attacker.max_attack, 1)) + Math.max(1, numVal(attacker.spell_attack || attacker.max_attack, 1))) / 2
  ));
  let echoBase = Math.max(1, Math.floor(attackBase * coeff * count));
  if (isPvpBattleMode(state?.battle_mode)) {
    echoBase = Math.max(1, Math.floor(echoBase * pvpFactor));
  }

  const applyEchoDamage = (target, ratio, action, textBuilder) => {
    if (!target || !target.alive || target.hp <= 0) return 0;
    let dmg = Math.max(0, Math.floor(echoBase * ratio));
    if (dmg <= 0) return 0;
    if (target.hunchong_stacks > 0) {
      target.hunchong_stacks -= 1;
      dmg = 0;
      events.push({ t: 'combat_log', actor: target.tag, target: target.tag, action: 'hunchong_absorb',
        text: `${target.name} 的缓冲抵消了离恨回响！` });
    } else if (target.direct_damage_ignore_chance > 0 && nextRand01(state) < target.direct_damage_ignore_chance) {
      dmg = 0;
      events.push({ t: 'combat_log', actor: target.tag, target: target.tag, action: 'ignore',
        text: `${target.name} 无视了离恨回响！` });
    }
    if (dmg > 0) {
      dmg = _capAndAbsorbDamage(state, target, dmg, events);
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp <= 0) target.alive = false;
      tryZhanmoShentuExecute(state, attacker, target, events, { damage: dmg });
    }
    events.push({ t: 'combat_log', actor: attacker.tag, target: target.tag, action,
      skill_name: skillName || '', damage: dmg, text: textBuilder(target.name, dmg) });
    _appendUnitDiedEventIfNeeded(target, events);
    return dmg;
  };

  applyEchoDamage(defender, 1, 'henbieli_echo',
    (targetName, dmg) => `${attacker.name} 的恨别离引爆${count}种DOT，对${targetName}触发离恨回响，造成${dmg}伤害`);

  if (!_isTeamBattleState(state) || splashRatio <= 0) return;
  const others = _aliveUnits(state, !attacker.is_ally).filter(u => String(u?.tag || '') !== String(defender?.tag || ''));
  for (const tgt of others) {
    applyEchoDamage(tgt, splashRatio, 'henbieli_echo_splash',
      (targetName, dmg) => `${attacker.name} 的离恨余响波及${targetName}，造成${dmg}伤害`);
  }
}

function _decrementCooldowns(unit) {
  if (!unit.skill_cooldowns) return;
  for (const k of Object.keys(unit.skill_cooldowns))
    unit.skill_cooldowns[k] = Math.max(0, intVal(unit.skill_cooldowns[k], 0) - 1);
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
  const learnedTechId = req && typeof req === 'object' ? intVal(req.learnedTechniqueId, 0) : 0;
  if (learnedTechId > 0 && (!unit.technique_levels || !unit.technique_levels[String(learnedTechId)] || intVal(unit.technique_levels[String(learnedTechId)].level, 0) < 1)) return false;
  const cd = intVal(unit.skill_cooldowns?.[String(skillId)], 0);
  if (cd > 0) return false;
  const mpCost = Math.max(0, intVal(skill.mpCost, 0));
  return mpCost <= intVal(unit.mp, 0);
}

// ─── Combat execution ───

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

function _resolveNestedSkillTarget(state, attacker, currentDefender, nestedSkillId) {
  const nestedSkill = getSkillById(nestedSkillId);
  const isPureSupport = String(nestedSkill?.damageType || '') === 'none';
  if (isPureSupport) return attacker;

  const currentIsOpponent = currentDefender
    && currentDefender.alive
    && currentDefender.hp > 0
    && Boolean(currentDefender.is_ally) !== Boolean(attacker.is_ally);
  if (currentIsOpponent) return currentDefender;

  const opponents = _aliveUnits(state, !attacker.is_ally);
  return _pickTarget(state, opponents) || opponents[0] || currentDefender || attacker;
}

function _applyJianxinFollowUp(state, attacker, defender, sourceIsSpell, skill, skillLevel, events) {
  if (!attacker?.jianxin || !defender || !defender.alive || defender.hp <= 0) return;
  const coeff = isPvpBattleMode(state?.battle_mode) ? 0.15 : 0.25;
  let followIsSpell = null;
  if (!sourceIsSpell && attacker.jingzhun?.active) followIsSpell = true;
  else if (sourceIsSpell && attacker.zhuanzhu?.active) followIsSpell = false;
  if (followIsSpell == null) return;

  const res = calcDamage(state, attacker, defender, 'skill', coeff, followIsSpell, skill, skillLevel, { from_jianxin_followup: true });
  let damage = Math.max(0, intVal(res.damage, 0));
  events.push(...(res.events || []));
  if (damage <= 0) return;
  if (defender.hunchong_stacks > 0) {
    defender.hunchong_stacks -= 1;
    events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'hunchong_absorb',
      text: `${defender.name} 的缓冲抵消了剑心追击！` });
    return;
  }
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore',
      text: `${defender.name} 无视了剑心追击！` });
    return;
  }
  damage = _capAndAbsorbDamage(state, defender, damage, events);
  if (damage <= 0) return;
  defender.hp = Math.max(0, defender.hp - damage);
  if (defender.hp <= 0) defender.alive = false;
  tryZhanmoShentuExecute(state, attacker, defender, events, { damage });
  events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'jianxin_followup',
    damage, is_crit: res.isCrit,
    text: `${attacker.name} 对${defender.name}发动剑心追击，追加${followIsSpell ? '法术' : '物理'}伤害${damage}` });
}

function _executeAction(state, attacker, defender, mode, skillId, opts = {}) {
  const events = [];
  attacker._man_charge_cast = false;
  attacker._shenguang_log_shown = false;
  attacker._skip_hybrid_heal_once = false;
  let usedMode = mode;
  let usedSkillId = 0;
  let skillName = '', skillMul = 1.0, isSpell = false, skill = null, lv = 1, mimicSourceSkillName = null;
  let _bonusHealEff = null, _bonusTeamHealEff = null;
  const allyOverrides = attacker.is_ally ? {
    player: attacker,
    enemy: !defender?.is_ally ? defender : _aliveUnits(state, false)[0] || null
  } : null;
  const _applyKuangyongPacket = (packetDamage) => {
    const base = Math.max(0, intVal(packetDamage, 0));
    if (base <= 0 || !attacker?.is_ally) return base;
    const manaBurstPct = clamp(numVal(attacker?.combat_mana_burst_pct, 0), 0, 1);
    if (manaBurstPct <= 0 || intVal(attacker?.mp, 0) <= 0) return base;
    const mpCost = Math.max(0, Math.floor(intVal(attacker.mp, 0) * manaBurstPct));
    if (mpCost <= 0) return base;
    attacker.mp = Math.max(0, intVal(attacker.mp, 0) - mpCost);
    events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'kuangyong',
      text: `${attacker.name} 激发阵形·狂涌，消耗${mpCost}法力，附加${mpCost}伤害` });
    return base + mpCost;
  };

  if (mode === 'skill') {
    skill = getSkillById(skillId);
    if (!skill || !skill.id) {
      mode = 'attack';
      usedMode = 'attack';
    }
    else {
      const cd = intVal(attacker.skill_cooldowns?.[String(skillId)], 0);
      const mpCost = Math.max(0, intVal(skill.mpCost, 0));
      const req = skill.requirements;
      const weaponOk = !req || !Array.isArray(req.weaponTypes) || req.weaponTypes.length === 0 ||
        req.weaponTypes.some(wt => String(attacker.weapon_type || '').includes(wt));
      const learnedTechId = req && typeof req === 'object' ? intVal(req.learnedTechniqueId, 0) : 0;
      const learnedTechOk = learnedTechId <= 0 || (attacker.technique_levels && attacker.technique_levels[String(learnedTechId)] && intVal(attacker.technique_levels[String(learnedTechId)].level, 0) >= 1);
      const blockedByCooldown = cd > 0 && !opts.skipCooldown;
      const blockedByMp = mpCost > attacker.mp && !opts.skipMpCost;
      if (blockedByCooldown || blockedByMp || !weaponOk || !learnedTechOk) {
        mode = 'attack';
        usedMode = 'attack';
      }
      else {
        usedMode = 'skill';
        usedSkillId = intVal(skillId, 0);
        if (intVal(skillId, 0) === ZAIDAO_SKILL_ID && attacker.jianxin) {
          const linkedSkillId = _pickLinkedEquippedSkill(attacker, ZAIDAO_SKILL_ID);
          if (linkedSkillId > 0) {
            const linkedName = String(getSkillById(linkedSkillId)?.name || `技能${linkedSkillId}`);
            const linkedTarget = _resolveNestedSkillTarget(state, attacker, defender, linkedSkillId);
            const linkedRes = _executeAction(state, attacker, linkedTarget, 'skill', linkedSkillId, { ...opts, noNestedProc: true });
            if (linkedRes.ok) {
              events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'jianxin_cast',
                text: `剑心流转：${attacker.name} 转而释放${linkedName}` });
              events.push(...(linkedRes.events || []));
              return { ok: true, events, used_mode: 'skill', used_skill_id: linkedSkillId };
            }
          }
          return { ok: false, error: '无其他可释放技能', used_mode: 'skill', used_skill_id: ZAIDAO_SKILL_ID };
        }
        if (skillId === YUJIAN_SKILL_ID && attacker.yujian_extra_cast && !opts.noNestedProc) {
          attacker.yujian_extra_cast = false;
          const otherSkills = (attacker.equipped_skills || []).filter(sid => intVal(sid, 0) !== YUJIAN_SKILL_ID);
          const valid = otherSkills.filter(sid => {
            const s = getSkillById(sid);
            if (!s || !s.id) return false;
            if (intVal(attacker.skill_cooldowns?.[String(sid)], 0) > 0) return false;
            if (intVal(s.mpCost, 0) > attacker.mp) return false;
            const req = s.requirements;
            if (req && Array.isArray(req.weaponTypes) && req.weaponTypes.length > 0) {
              if (!req.weaponTypes.some(wt => String(attacker.weapon_type || '').includes(wt))) return false;
            }
            return true;
          });
          if (valid.length > 0) {
            const extraId = valid[Math.floor(nextRand01(state) * valid.length)];
            const extraTarget = _resolveNestedSkillTarget(state, attacker, defender, extraId);
            const extraRes = _executeAction(state, attacker, extraTarget, 'skill', extraId, { skipCooldown: true, skipTurnStart: true, noNestedProc: true });
            events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'yujian_extra',
              text: `绝学-御剑以心：额外释放${getSkillById(extraId)?.name || `技能${extraId}`}！` });
            events.push(...(extraRes.events || []));
          }
        }
        attacker.mp = Math.max(0, attacker.mp - mpCost);
        lv = _getSkillLevel(attacker, skillId);
        skillMul = _calcSkillMul(skill, lv);
        let effCd = intVal(skill.cooldown, 0);
        if (lv > 1 && numVal(skill.cooldownPerLevel, 0) > 0) effCd += (lv - 1) * numVal(skill.cooldownPerLevel, 0);
        if (lv >= (intVal(skill.levelCap, 99) || 99) && intVal(skill.maxLevelCooldownReduction, 0) > 0) effCd = Math.max(0, effCd - intVal(skill.maxLevelCooldownReduction, 0));
        if (hasSkillEffect(skill, 'blossom')) {
          const { typeCount } = getBlossomExplodeInfo(defender, state);
          if (!isPvpBattleMode(state?.battle_mode) && typeCount < 2) effCd = 0;
        }
        if (!opts.skipCooldown) attacker.skill_cooldowns[String(skillId)] = Math.max(0, effCd);
        let resetSkillIds = [];
        if (hasSkillEffect(skill, 'clear_other_skill_cooldowns')) {
          let clearedCount = 0;
          for (const k of Object.keys(attacker.skill_cooldowns || {})) {
            if (String(k) !== String(skillId) && intVal(attacker.skill_cooldowns[k], 0) > 0) clearedCount++;
            if (String(k) !== String(skillId) && intVal(attacker.skill_cooldowns[k], 0) > 0) resetSkillIds.push(intVal(k, 0));
            if (String(k) !== String(skillId)) attacker.skill_cooldowns[k] = 0;
          }
          if (clearedCount >= 2 && !opts.noNestedProc) attacker.yujian_extra_cast = true;
        }
        skillName = String(skill.name || `技能${skillId}`);
        isSpell = String(skill.damageType || '') === 'magic';

        // mimic_opponent_skill：从对手已装配技能中随机选一个非 enemySkill 执行
        if (hasSkillEffect(skill, 'mimic_opponent_skill')) {
          mimicSourceSkillName = skillName;
          const opponentSkills = Array.isArray(defender?.equipped_skills) ? defender.equipped_skills : [];
          const nonEnemySkills = opponentSkills.filter(sid => {
            const s = getSkillById(sid);
            const tags = Array.isArray(s?.tags) ? s.tags : [];
            return s && s.id && !tags.includes('enemySkill');
          });
          if (nonEnemySkills.length > 0) {
            const picked = nonEnemySkills[Math.floor(nextRand01(state) * nonEnemySkills.length)];
            skill = getSkillById(picked);
            lv = _getSkillLevel(defender, picked);
            skillName = String(skill?.name || `技能${picked}`);
            isSpell = String(skill?.damageType || '') === 'magic';
          }
        }

        if (hasSkillEffect(skill, 'damage_percent_adaptive_higher_attack')) {
          isSpell = numVal(attacker.spell_attack, 0) > numVal(attacker.max_attack, 0);
        }

        const chargeRounds = intVal(skill?.chargeRounds, 0);
        if (chargeRounds > 0 && !opts.skipChargeCheck && !attacker.ex_weapon?.instant_charge_release) {
          attacker.xuli = {
            rounds_remaining: chargeRounds,
            skill_id: intVal(skill?.id, intVal(skillId, 0)),
            skill_level: lv
          };
          events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'xuli_start',
            text: `${attacker.name} 开始蓄力${skillName}！（需${chargeRounds}回合）` });
          return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
        }
        if (chargeRounds > 0 && !opts.skipChargeCheck && attacker.ex_weapon?.instant_charge_release) {
          attacker._man_charge_cast = true;
          events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'man_charge_release',
            text: `蛮：${attacker.name} 的蓄力技能改为立即释放（伤害-50%）` });
        }

        // 伏魔
        if (isSpell && attacker.fumo_rounds > 0) {
          defender = attacker;
        }

        // 治疗：player_hp_percent=按法术攻击，heal_max_hp_percent=按最大生命，heal_phys_attack_percent=按物攻
        const healEffSpell = (skill.effects || []).find(e => String(e?.type || '') === 'player_hp_percent');
        const healEffMaxHp = (skill.effects || []).find(e => String(e?.type || '') === 'heal_max_hp_percent');
        const healEffPhysAtk = (skill.effects || []).find(e => String(e?.type || '') === 'heal_phys_attack_percent');
        const healTeamEffD = (skill.effects || []).find(e => String(e?.type || '') === 'heal_team_max_hp_percent');
        const healEff = healEffPhysAtk || healEffMaxHp || healEffSpell;
        _bonusHealEff = healEff;
        _bonusTeamHealEff = healTeamEffD;
        if (healEff && String(skill.damageType || '') === 'none') {
          if (attacker.is_ally && !opts.skipTurnStart) {
            state._lihuo_zhuoshao_this_action = false;
            applySetEffectsOnPlayerTurnStart(state, events, allyOverrides);
          }
          const _shIsPvp = isPvpBattleMode(state?.battle_mode);
          const _shBase = (_shIsPvp && healEff.pvpValue != null) ? numVal(healEff.pvpValue, 0) : numVal(healEff.value, 0);
          const pct = _shBase + (lv > 1 ? (lv - 1) * numVal(healEff.coefficientBonus, 0) : 0);
          let heal;
          if (String(healEff.type || '') === 'heal_max_hp_percent') {
            heal = Math.max(1, Math.floor(attacker.max_hp * clamp(pct, 0, 1)));
          } else if (String(healEff.type || '') === 'heal_phys_attack_percent') {
            const phAtk = Math.max(1, Math.floor((attacker.min_attack + attacker.max_attack) / 2));
            heal = Math.max(1, Math.floor(phAtk * pct));
          } else {
            const spAtk = Math.max(1, attacker.spell_attack || attacker.max_attack);
            heal = Math.max(1, Math.floor(spAtk * pct));
          }
          heal = Math.floor(heal * (1.0 + numVal(attacker.heal_bonus, 0)));
          const skillAttr = String(skill?.attribute || '');
          if (skillAttr === '水' || skillAttr === '混元' || skillAttr === '无') {
            let aff = 0;
            if (skillAttr === '水') aff = numVal(attacker.water_affinity, 0);
            else if (skillAttr === '混元') aff = numVal(attacker.hunyuan_affinity, 0);
            else if (skillAttr === '无') aff = numVal(attacker.wu_affinity, 0);
            if (aff > 0) heal = Math.floor(heal * (1.0 + aff * 0.0065));
          }
          if (attacker.perfect_water && nextRand01(state) < 0.10) heal = Math.floor(heal * 1.35);
          // self_or_lowest_ally：团队模式下治疗施法者阵营中血量最低的友方
          const targetMode = healEff.targetMode || '';
          let healTarget = attacker;
          const casterTeam = attacker.is_ally ? state.allies : state.enemies;
          if (targetMode === 'self_or_lowest_ally' && Array.isArray(casterTeam)) {
            const aliveAllies = casterTeam.filter(a => a && a.alive && a.hp > 0);
            if (aliveAllies.length > 1) {
              healTarget = aliveAllies.reduce((lowest, cur) =>
                (cur.hp / cur.max_hp) < (lowest.hp / lowest.max_hp) ? cur : lowest, aliveAllies[0]);
            }
          }
          if (isHealForbidden(healTarget)) {
            pushHealForbiddenEvent(healTarget, events, skillName);
          } else if (healTarget === attacker && tryJiemieHealToXurui(attacker, heal, events, { text: `${attacker.name} 套装效果触发蓄锐2回合！` })) {
            // 对自己治疗已转为蓄锐
          } else {
            const healed = applyHealWithOverflowShield(healTarget, heal, events);
            const healLog = mimicSourceSkillName
              ? `${attacker.name} 使用${mimicSourceSkillName}，模仿了${skillName}，${healTarget.name}回复了${healed.actualHeal}生命`
              : `${attacker.name} 使用${skillName}，${healTarget.name}回复了${healed.actualHeal}生命`;
            events.push({ t: 'combat_log', actor: attacker.tag, target: healTarget.tag, action: 'heal',
              skill_name: skillName, heal: healed.actualHeal, text: healLog });
            if (attacker.is_ally && healed.actualHeal > 0) applySetEffectsOnHeal(state, healed.actualHeal, events, allyOverrides);
            if (healTarget !== attacker && attacker.heal_others_self_heal > 0) {
              const selfBack = Math.floor(healed.actualHeal * attacker.heal_others_self_heal);
              if (selfBack > 0) {
                if (tryJiemieHealToXurui(attacker, selfBack, events, { text: `劫灭-斗战乾坤：治疗回馈无效，获得2轮蓄锐` })) {
                  // 已转为蓄锐
                } else {
                  if (isHealForbidden(attacker)) {
                    pushHealForbiddenEvent(attacker, events, '治疗回馈');
                  } else {
                    const selfHealed = applyHealWithOverflowShield(attacker, selfBack, events);
                    events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'heal_echo',
                      heal: selfHealed.actualHeal, text: `${attacker.name} 治疗回馈，回复了${selfHealed.actualHeal}生命` });
                  }
                }
              }
            }
          }
          // 全队治疗（施法者所在阵营）
          if (healTeamEffD && Array.isArray(casterTeam)) {
            const _stIsPvp = isPvpBattleMode(state?.battle_mode);
            const teamPct = (_stIsPvp && healTeamEffD.pvpValue != null) ? numVal(healTeamEffD.pvpValue, 0.15) : numVal(healTeamEffD.value, 0.15);
            for (const ally of casterTeam) {
              if (ally && ally !== healTarget && ally.alive && ally.hp > 0) {
                let allyHeal = Math.max(1, Math.floor(ally.max_hp * clamp(teamPct, 0, 1)));
                allyHeal = Math.floor(allyHeal * (1.0 + numVal(attacker.heal_bonus, 0)));
                if (isHealForbidden(ally)) {
                  pushHealForbiddenEvent(ally, events, skillName);
                  allyHeal = 0;
                } else {
                  const allyHealed = applyHealWithOverflowShield(ally, allyHeal, events);
                  allyHeal = allyHealed.actualHeal;
                  events.push({ t: 'combat_log', actor: attacker.tag, target: ally.tag, action: 'team_heal',
                    heal: allyHeal, text: `${ally.name} 回复了${allyHeal}生命` });
                }
                if (attacker.heal_others_self_heal > 0 && ally !== attacker) {
                  const selfBack = Math.floor(allyHeal * attacker.heal_others_self_heal);
                  if (selfBack > 0) {
                    if (tryJiemieHealToXurui(attacker, selfBack, events, { text: `劫灭-斗战乾坤：治疗回馈无效，获得2轮蓄锐` })) {
                      // 已转为蓄锐
                    } else {
                      if (isHealForbidden(attacker)) {
                        pushHealForbiddenEvent(attacker, events, '治疗回馈');
                      } else {
                        const selfHealed = applyHealWithOverflowShield(attacker, selfBack, events);
                        events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'heal_echo',
                          heal: selfHealed.actualHeal, text: `${attacker.name} 治疗回馈，回复了${selfHealed.actualHeal}生命` });
                      }
                    }
                  }
                }
              }
            }
          }
          events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
          if (attacker.is_ally) applySetEffectsOnPlayerTurnEnd(state, events, allyOverrides);
          return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
        }
        if (String(skill.damageType || '') === 'none') {
          if (attacker.is_ally && !opts.skipTurnStart) {
            state._lihuo_zhuoshao_this_action = false;
            applySetEffectsOnPlayerTurnStart(state, events, allyOverrides);
          }
          events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
          if (attacker.is_ally) applySetEffectsOnPlayerTurnEnd(state, events, allyOverrides);
          return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
        }
        const _sacrificeEff = (skill.effects || []).find(ef => String(ef?.type || '') === 'self_sacrifice_damage');
        if (_sacrificeEff) {
          if (attacker.is_ally && !opts.skipTurnStart) {
            state._lihuo_zhuoshao_this_action = false;
            applySetEffectsOnPlayerTurnStart(state, events, allyOverrides);
          }
          const hr = numVal(_sacrificeEff.hpReduceRatio, 0);
          const hpLost = hr > 0 ? Math.floor(attacker.hp * hr) : Math.max(0, attacker.hp - 1);
          if (hr > 0) attacker.hp = Math.max(1, attacker.hp - hpLost); else attacker.hp = 1;
          const isPvp = isPvpBattleMode(state?.battle_mode);
          const ratio = isPvp ? numVal(_sacrificeEff.pvpValue, 0.5) : numVal(_sacrificeEff.value, 1.0);
          let dmg = Math.floor(hpLost * ratio);
          if (isKurongShentuActive(attacker) && dmg > 0) dmg = 0;
          events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'sacrifice',
            text: `${attacker.name} 舍身成仁，失去${hpLost}生命！` });
          dmg = applyTaixuanShentuSkillDamage(attacker, skill, dmg, events, { actionName: skillName });
          if (defender.hunchong_stacks > 0 && dmg > 0) {
            defender.hunchong_stacks -= 1;
            dmg = 0;
            events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'hunchong_absorb',
              text: `${defender.name} 的缓冲抵消了这次伤害！` });
          } else if (defender.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
            dmg = 0;
            events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore',
              text: `${defender.name} 无视了这次伤害！` });
          }
          if (dmg > 0) {
            dmg = _capAndAbsorbDamage(state, defender, dmg, events);
            defender.hp = Math.max(0, defender.hp - dmg);
            if (defender.hp <= 0) defender.alive = false;
          }
          events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'skill',
            skill_name: skillName, damage: dmg,
            text: `${attacker.name} 使用${skillName}，对${defender.name}造成${dmg}伤害` });
          if (dmg > 0 && attacker.is_ally) {
            events.push(...applyPostDamageExEffects(attacker, defender, dmg, false, skill, state, false, 1));
          }
          applyFenjieShentuOnDamageSkill(state, attacker, events, { skill });
          events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
          if (attacker.is_ally) applySetEffectsOnPlayerTurnEnd(state, events, allyOverrides);
          return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
        }
      }
    }
  }

  if (attacker.is_ally && !opts.skipTurnStart) {
    state._lihuo_zhuoshao_this_action = false;
    applySetEffectsOnPlayerTurnStart(state, events, allyOverrides);
  }

  // 普攻转法术
  if (mode === 'attack' && attacker.basic_attack_as_spell) {
    isSpell = true;
  }

  let finalDmg = 0;
  let isCrit = false;
  const damagePackets = [];
  const damageDetailEvents = [];
  let splashBaseDamage = 0;
  let blossomTypeCount = 0;
  let wanshengWindCount = 0;
  let kuanglanWaveCount = 0;
  const isTeamBattle = _isTeamBattleState(state);

  if (mode === 'skill' && skill) {
    // ─── 完整技能伤害流程（真多击：每击=上一击70%，反击/反弹每击生效）───
    const dmgEvents = [];

    if (hasSkillEffect(skill, 'wansheng_longwang_po')) {
      const wsl = calcDamageWanshengLongwangPo(state, attacker, defender, skill, lv, {
        windIgnoreDefense: false,
        windNoCounter: false
      });
      damagePackets.push(...(wsl.damagePerHit || [wsl.damage]));
      splashBaseDamage = wsl.damage;
      wanshengWindCount = Math.max(0, intVal(wsl.windPressureCount, 0));
      isCrit = wsl.isCrit;
      damageDetailEvents.push(...(wsl.events || []));
    } else {
      const physCritEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_percent_range_physical_crit');
      const physDefEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_percent_plus_phys_def');
      const spellPhysDefEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_spell_phys_def_plus_self_hp_lost');
      const ownPhysDefEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_own_phys_def_percent');
      const ownSpellDefEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_own_spell_def_percent');
      const specialSingleHitCount = (physCritEff ? 1 : 0)
        + (physDefEff ? 1 : 0)
        + (spellPhysDefEff ? 1 : 0)
        + (ownPhysDefEff ? 1 : 0)
        + (ownSpellDefEff ? 1 : 0);
      const yanmianHitMul = clamp(numVal(attacker.yanmian_hit_damage_mul, 0.7), 0, 1);
      const yanmianSplitDamage = (baseDamage) => {
        const first = Math.max(1, Math.floor(baseDamage * yanmianHitMul));
        const second = Math.max(1, Math.floor(first * 0.7));
        return [first, second];
      };
      const pushSpecialSingleDamage = (baseDamage) => {
        if (!useYanmianOnSpecialSingle) {
          damagePackets.push(baseDamage);
          return;
        }
        const [first, second] = yanmianSplitDamage(baseDamage);
        damageDetailEvents.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'yanmian_hit',
          text: `${attacker.name} 延绵分击：第1击${first}，第2击${second}` });
        damagePackets.push(first, second);
      };
      const hits = collectSkillDamageHits(skill, lv, state);
      const useYanmianOnSpecialSingle = attacker.is_ally
        && attacker.yanmian_multi2
        && hits.length === 0
        && specialSingleHitCount === 1;
      if (useYanmianOnSpecialSingle) {
        damageDetailEvents.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'yanmian',
          text: `${attacker.name} 激发阵形·延绵，本次技能化为2连击（单击伤害-${Math.round((1 - yanmianHitMul) * 100)}%）` });
      }

      if (physCritEff) {
        const pr = calcDamagePhysCritRange(state, attacker, defender, physCritEff, lv, skill);
        pushSpecialSingleDamage(pr.damage);
        if (pr.isCrit) isCrit = true;
      }
      if (physDefEff) {
        const pr = calcDamagePercentPlusPhysDef(state, attacker, defender, physDefEff, lv, skill);
        pushSpecialSingleDamage(pr.damage);
        if (pr.isCrit) isCrit = true;
        dmgEvents.push(...(pr.events || []));
      }
      if (spellPhysDefEff) {
        const pr = calcDamageSpellPhysDefPlusSelfHpLost(state, attacker, defender, spellPhysDefEff, lv, skill);
        pushSpecialSingleDamage(pr.damage);
        if (pr.isCrit) isCrit = true;
        isSpell = true;
        dmgEvents.push(...(pr.events || []));
      }
      if (ownPhysDefEff) {
        const pr = calcDamageOwnPhysDefPercent(state, attacker, defender, ownPhysDefEff, lv, skill);
        pushSpecialSingleDamage(pr.damage);
        if (pr.isCrit) isCrit = true;
        dmgEvents.push(...(pr.events || []));
      }
      if (ownSpellDefEff) {
        const pr = calcDamageOwnSpellDefPercent(state, attacker, defender, ownSpellDefEff, lv, skill);
        pushSpecialSingleDamage(pr.damage);
        if (pr.isCrit) isCrit = true;
        isSpell = true;
        dmgEvents.push(...(pr.events || []));
      }

      if (attacker.is_ally && attacker.yanmian_multi2 && hits.length === 1 && !hits[0].multiHit) {
        const original = hits[0];
        const hitMul = clamp(numVal(attacker.yanmian_hit_damage_mul, 0.7), 0, 1);
        hits.splice(0, hits.length, {
          multiHit: true,
          count: 2,
          firstMul: Math.max(0, numVal(original.mul, skillMul)) * hitMul,
          decay: 0.7,
          isSpell: !!original.isSpell,
          opts: original.opts || {}
        });
        damageDetailEvents.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'yanmian',
          text: `${attacker.name} 激发阵形·延绵，本次技能化为2连击（单击伤害-${Math.round((1 - hitMul) * 100)}%）` });
      }
      if (hasSkillEffect(skill, 'yinyang_toggle')) {
        const isYin = (attacker.yinyang_state || 'yin') === 'yin';
        for (const h of hits) {
          if (isYin) h.opts.ignoreSpellDefense = Math.max(numVal(h.opts.ignoreSpellDefense, 0), 0.4);
          else h.opts.forceCrit = true;
        }
      }
      const fallbackHits = hits.length === 0 && !physCritEff && !physDefEff && !spellPhysDefEff && !ownPhysDefEff && !ownSpellDefEff
        ? [{ mul: skillMul, isSpell, opts: {} }]
        : hits;
      for (const h of fallbackHits) {
        if (h.multiHit) {
          const expanded = expandMultiHitDamages(state, attacker, defender, h, mode, skill, lv);
          if (mode === 'skill' && skill && hasSkillEffect(skill, 'damage_percent_plus_agility_multi') && Array.isArray(expanded.damages) && expanded.damages.length > 1) {
            kuanglanWaveCount = Math.max(kuanglanWaveCount, expanded.damages.length);
          }
          damagePackets.push(...expanded.damages);
          if (expanded.isCrit) isCrit = true;
          dmgEvents.push(...(expanded.events || []));
        } else {
          const res = calcDamage(state, attacker, defender, mode, h.mul, h.isSpell, skill, lv, h.opts || {});
          damagePackets.push(res.damage);
          if (res.isCrit) isCrit = true;
          dmgEvents.push(...(res.events || []));
        }
      }

      for (const eff of (skill.effects || [])) {
        if (String(eff?.type || '') === 'enemy_self_damage_max_hp_percent') {
          const v = numVal(eff.value, 0.12);
          if (attacker.is_ally) {
            const extra = Math.max(0, Math.floor(defender.max_hp * v));
            damagePackets.push(extra);
            dmgEvents.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'self_damage',
              damage: extra, text: `${defender.name} 自损${extra}点生命（${Math.floor(v * 100)}%最大生命）` });
          } else {
            let extra = Math.max(0, Math.floor(attacker.max_hp * v));
            extra = _capAndAbsorbDamage(state, attacker, extra, dmgEvents);
            attacker.hp = Math.max(0, attacker.hp - extra);
            if (attacker.hp <= 0) attacker.alive = false;
            dmgEvents.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'self_damage',
              damage: extra, text: `${attacker.name} 自损${extra}点生命（${Math.floor(v * 100)}%最大生命）` });
          }
        }
      }

      if (hasSkillEffect(skill, 'blossom')) {
        const blossomEff = (skill.effects || []).find(ef => String(ef?.type || '') === 'blossom');
        const physPct = numVal(blossomEff?.physPercent, 0.7);
        const spellPct = numVal(blossomEff?.spellPercent, 0.7);
        const bonusPerDot = numVal(blossomEff?.bonusPerDotType, 0.35);
        const { typeCount, explodeDamage } = getBlossomExplodeInfo(defender, state);
        blossomTypeCount = Math.max(0, intVal(typeCount, 0));
        const mult = 1.0 + bonusPerDot * typeCount;
        const blossomPhys = calcDamage(state, attacker, defender, mode, physPct * mult, false, skill, lv).damage;
        const blossomSpell = calcDamage(state, attacker, defender, mode, spellPct * mult, true, skill, lv).damage;
        splashBaseDamage = blossomPhys + blossomSpell;
        damagePackets.push(blossomPhys + blossomSpell + explodeDamage);
        clearBlossomDebuffs(defender);
        dmgEvents.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'blossom',
          text: `绽放！引爆${typeCount}种持续伤害，共${blossomPhys + blossomSpell + explodeDamage}点伤害` });
      }

      damageDetailEvents.push(...dmgEvents);
    }
  } else {
    // ─── 普攻或回退到普攻的简单流程 ───
    const weapBuf = attacker.is_ally ? (1.0 + Math.max(0, numVal(attacker.weapon_damage_pct, 0))) : 1.0;
    const critTypeIsSpell = isSpell;
    if (critTypeIsSpell) {
      let spellCritChance = (attacker.spell_crit_rate ?? attacker.crit_rate ?? 0);
      if (attacker.zhuanzhu?.active) spellCritChance = Math.min(0.95, spellCritChance + 0.25);
      isCrit = (attacker.juechang_rounds > 0) || nextRand01(state) < spellCritChance;
    } else {
      let physCritChance = attacker.crit_rate || 0;
      if (attacker.jingzhun?.active) physCritChance = Math.min(0.95, physCritChance + 0.25);
      isCrit = (attacker.nuozhan_rounds > 0) || nextRand01(state) < physCritChance;
    }
    const critMul = isCrit ? (critTypeIsSpell ? (attacker.spell_crit_mult || 1.35) : (attacker.crit_mult || 1.5)) : 1.0;

    if (attacker?.ex_weapon?.adaptive_all_damage) {
      const defPhys = Math.max(0, numVal(defender?.defense, 0));
      const defSpell = Math.max(0, numVal(defender?.spell_defense, 0));
      isSpell = defSpell <= defPhys;
    }

    let baseAtk;
    if (attacker.fenjin_active) {
      baseAtk = isSpell ? (attacker.spell_attack || attacker.max_attack) : attacker.max_attack;
    } else if (isSpell) {
      baseAtk = Math.max(1, attacker.spell_attack || attacker.max_attack);
      if (attacker.yangjing?.active) baseAtk = Math.max(baseAtk, attacker.spell_attack || attacker.max_attack);
      if (mode === 'attack' && attacker.basic_attack_as_spell) {
        const sp = attacker.spell_attack || attacker.max_attack;
        baseAtk = rollInt(state, Math.floor(sp * attacker.basic_attack_as_spell.minValue),
                                Math.floor(sp * attacker.basic_attack_as_spell.maxValue));
      }
    } else if (attacker.xurui?.active) {
      baseAtk = attacker.max_attack;
    } else if (attacker.fear_rounds > 0) {
      baseAtk = attacker.min_attack;
    } else {
      baseAtk = rollInt(state, attacker.min_attack, attacker.max_attack);
    }

    let effectiveDef;
    if ((attacker.beishui_rounds > 0) || (defender.beishui_rounds > 0)) effectiveDef = 0;
    else if (isSpell) {
      effectiveDef = defender.spell_defense || 0;
      if (attacker.spell_armor_pen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_armor_pen, 0, 0.9)));
      if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    } else {
      effectiveDef = defender.defense;
      if (attacker.armor_pen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.armor_pen, 0, 0.9)));
      if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    }
    if (defender.jiangu) {
      const jianguDefBase = isSpell
        ? Math.max(0, numVal(defender.spell_defense, defender.defense || 0))
        : Math.max(0, numVal(defender.defense, 0));
      effectiveDef += Math.floor(jianguDefBase * (isSpell ? defender.jiangu.spellCoeff : defender.jiangu.physCoeff));
    }
    if (defender?.fumo_shentu_active) {
      effectiveDef = Math.min(Math.max(0, numVal(effectiveDef, 0)), 6000);
    }

    let raw = Math.max(1, Math.floor(baseAtk * skillMul * critMul * weapBuf));
    const flatDamage = Math.max(0, intVal(isSpell ? attacker.spell_flat_damage : attacker.phys_flat_damage, 0));
    if (flatDamage > 0) raw += flatDamage;
    if ((attacker.beishui_rounds > 0) || (defender.beishui_rounds > 0)) raw = Math.floor(raw * 1.2);

    if (defender.hunchong_stacks > 0) {
      defender.hunchong_stacks -= 1;
      events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'hunchong_absorb',
        text: `${defender.name} 的缓冲抵消了这次伤害！` });
      if (skill && mode === 'skill') events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
      return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
    }
    if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
      events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore',
        text: `${defender.name} 无视了这次伤害！` });
      if (skill && mode === 'skill') events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
      return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
    }

    const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
    let singleDmg = calcReducedDamage(raw, effectiveDef, divisor);
    if (!isSpell && attacker.nuozhan_rounds > 0) { const oc = Math.max(0, numVal(attacker.crit_rate, 0)); if (oc > 0) singleDmg = Math.floor(singleDmg * (1.0 + oc)); }
    if (isSpell && attacker.spell_final_damage_pct > 0) singleDmg = Math.floor(singleDmg * (1.0 + attacker.spell_final_damage_pct));
    if (defender.is_ally && defender.damage_reduction > 0) singleDmg = Math.floor(singleDmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
    damagePackets.push(singleDmg);
  }

  // 大德广润：单目标伤害+40%（非PVP）
  if (mode === 'skill' && skill && intVal(skill.id, 0) === 62 &&
      !isPvpBattleMode(state?.battle_mode) && attacker.is_ally) {
    const aliveEnemyCount = _aliveUnits(state, !attacker.is_ally).length;
    if (aliveEnemyCount <= 1) {
      for (let i = 0; i < damagePackets.length; i++) {
        damagePackets[i] = Math.floor(damagePackets[i] * 1.4);
      }
    }
  }

  if (attacker.is_ally && numVal(attacker.combat_mana_burst_pct, 0) > 0) {
    for (let i = 0; i < damagePackets.length; i++) {
      damagePackets[i] = _applyKuangyongPacket(damagePackets[i]);
    }
  }

  if (attacker._huang_charging && attacker.ex_weapon?.charge_damage_mult) {
    const chargeMul = clamp(numVal(attacker.ex_weapon.charge_damage_mult, 0.5), 0, 1);
    for (let i = 0; i < damagePackets.length; i++) {
      damagePackets[i] = Math.max(0, Math.floor(numVal(damagePackets[i], 0) * chargeMul));
    }
  }

  if (attacker._man_charge_cast && attacker.ex_weapon?.charge_damage_mult) {
    const chargeMul = clamp(numVal(attacker.ex_weapon.charge_damage_mult, 0.5), 0, 1);
    for (let i = 0; i < damagePackets.length; i++) {
      damagePackets[i] = Math.max(0, Math.floor(numVal(damagePackets[i], 0) * chargeMul));
    }
  }

  if (mode === 'skill' && skill && damagePackets.length > 0) {
    const taixuanMul = getTaixuanShentuSkillDamageMul(attacker, skill);
    if (taixuanMul !== 1) {
      const beforeTaixuan = damagePackets.reduce((a, b) => a + Math.max(0, intVal(b, 0)), 0);
      for (let i = 0; i < damagePackets.length; i++) {
        const pkt = Math.max(0, intVal(damagePackets[i], 0));
        damagePackets[i] = pkt > 0 ? Math.max(1, Math.floor(pkt * taixuanMul)) : 0;
      }
      if (beforeTaixuan > 0) {
        const isNeutralSkill = String(skill?.attribute || '') === '无';
        events.push({
          t: 'combat_log',
          actor: attacker.tag,
          target: defender.tag,
          action: isNeutralSkill ? 'taixuan_shentu_bonus' : 'taixuan_shentu_penalty',
          text: isNeutralSkill
            ? `${attacker.name} 的太玄神途生效：无属性技能最终伤害+25%`
            : `${attacker.name} 的太玄神途生效：非无属性技能最终伤害-20%`
        });
      }
    }
  }

  const equippedCoeff = defender.on_counter ? (defender.on_counter.damageCoeff || 0) : 0;
  const daifaCoeff = equippedCoeff > 0 ? equippedCoeff : _getKunDeCounterCoeff(defender);
  const kuanglanPreApplyPackets = kuanglanWaveCount > 0
    ? damagePackets.slice(0, kuanglanWaveCount).map((pkt) => Math.max(0, intVal(pkt, 0)))
    : null;
  const _ctrIsPvp = isPvpBattleMode(state?.battle_mode);
  const _ctrPhysBonus = (!_ctrIsPvp && defender.is_ally) ? Math.floor(Math.floor((defender.min_attack + defender.max_attack) / 2) * 0.20) : 0;
  let shouldShieldReflect = false;
  const doCounter = (counterCoeff, source = 'kunde') => {
    if (defender.hp <= 0 || numVal(counterCoeff, 0) <= 0) return;
    let cDmg = Math.max(1, Math.floor(defender.defense * numVal(counterCoeff, 0) + _ctrPhysBonus));
    const ctrBonus = _ctrIsPvp
      ? numVal(defender?.ex_weapon?.pvp_counter_damage_bonus, 0)
      : numVal(defender?.ex_weapon?.counter_damage_bonus, 0);
    if (ctrBonus > 0) cDmg = Math.max(1, Math.floor(cDmg * (1.0 + ctrBonus)));
    if (isKurongShentuActive(defender) && cDmg > 0) cDmg = 0;
    const yebaoActive = numVal(defender?.yebao_shentu_active, 0) > 0;
    let counterIsCrit = false;
    if (yebaoActive && cDmg > 0) {
      const critChance = clamp(numVal(defender?.crit_rate, 0), 0, 0.95);
      counterIsCrit = nextRand01(state) < critChance;
      if (counterIsCrit) {
        cDmg = Math.max(1, Math.floor(cDmg * Math.max(1.0, numVal(defender?.crit_mult, 1.5))));
      }
    }
    const poshangChance = _ctrIsPvp ? 0.2 : 0.4;
    const poshangBoost = numVal(defender?.poshang_shentu_active, 0) > 0 && cDmg > 0 && nextRand01(state) < poshangChance;
    if (poshangBoost) {
      cDmg = Math.max(1, Math.floor(cDmg * 3));
      damageDetailEvents.push({ t: 'combat_log', actor: defender.tag, target: attacker.tag, action: 'poshang_boost',
        text: `${defender.name} 的破障神途触发：本次反击伤害提升至300%` });
    }
    cDmg = _capAndAbsorbDamage(state, attacker, cDmg, damageDetailEvents);
    attacker.hp = Math.max(0, attacker.hp - cDmg);
    if (attacker.hp <= 0) attacker.alive = false;
    tryZhanmoShentuExecute(state, defender, attacker, damageDetailEvents, { damage: cDmg });
    const srcText = source === 'daifa' ? '（待发触发）' : '（坤德触发）';
    damageDetailEvents.push({ t: 'combat_log', actor: defender.tag, target: attacker.tag, action: 'counter',
      damage: cDmg, is_crit: counterIsCrit,
      text: counterIsCrit ? `${defender.name}${srcText}反击暴击造成${cDmg}伤害！` : `${defender.name}${srcText}反击造成${cDmg}伤害！` });
    if (yebaoActive && cDmg > 0) {
      const taichuNegCountSnapshot = getNegativeStatusCount(attacker);
      damageDetailEvents.push(...applyPostDamageExEffects(defender, attacker, cDmg, false, null, state, counterIsCrit, 1));
      damageDetailEvents.push(...applySetEffectsOnDealDamage(state, defender, attacker, cDmg, false, 1, { taichuNegCountSnapshot, damageCategory: 'direct' }));
    }
    const counterHealRatio = clamp(numVal(defender.counter_heal_ratio, 0), 0, 0.8);
    if (counterHealRatio > 0 && cDmg > 0) {
      const heal = Math.max(1, Math.floor(cDmg * counterHealRatio));
      const beforeHp = defender.hp;
      defender.hp = Math.min(defender.max_hp || defender.hp, defender.hp + heal);
      const actualHeal = Math.max(0, defender.hp - beforeHp);
      if (actualHeal > 0) {
        damageDetailEvents.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'counter_heal',
          heal: actualHeal, text: `${defender.name} 反击回气，回复${actualHeal}生命` });
      }
    }
  };

  for (let idx = 0; idx < damagePackets.length; idx++) {
    let d = damagePackets[idx];
    if (isKurongShentuActive(attacker) && d > 0) d = 0;
    if (d <= 0) continue;
    const preCounterDamage = Math.max(0, intVal(d, 0));
    if (defender.hunchong_stacks > 0) {
      defender.hunchong_stacks -= 1;
      damageDetailEvents.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'hunchong_absorb',
        text: `${defender.name} 的缓冲抵消了这次伤害！` });
      d = 0;
      damagePackets[idx] = 0;
    } else if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
      damageDetailEvents.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore',
        text: `${defender.name} 无视了这次伤害！` });
      d = 0;
      damagePackets[idx] = 0;
    }
    let hadTempShieldBeforeHit = false;
    let counterTriggerByHit = false;
    if (d > 0) {
      hadTempShieldBeforeHit = intVal(defender.temp_shield, 0) > 0;
      const isMusicSpell = mode === 'skill' && skill && (skill.requirements?.weaponTypes || []).includes('音律') && isSpell;
      if (isMusicSpell && attacker.ex_weapon?.random_debuff_on_music_skill) {
        damageDetailEvents.push(...applyWanguchouOnMusicHit(attacker, defender, state));
      }
      _applyJianxinFollowUp(state, attacker, defender, isSpell, skill, lv, damageDetailEvents);
      if (defender.is_ally) {
        const setResult = { events: [], damage: 0 };
        applySetEffectsOnPlayerDamaged(state, d, setResult, { player: defender, enemy: attacker });
        d = setResult.damage;
        damageDetailEvents.push(...setResult.events);
      } else {
        d = _capAndAbsorbDamage(state, defender, d, damageDetailEvents);
        defender.hp = Math.max(0, defender.hp - d);
      }
      damagePackets[idx] = d;
      _recordZhenyueShanpo(defender, damageDetailEvents, d);
      if (kuanglanPreApplyPackets && idx < kuanglanPreApplyPackets.length) {
        const rawPacket = kuanglanPreApplyPackets[idx] || 0;
        const extra = rawPacket !== d ? `（原始${rawPacket}，受上限/护盾影响）` : '';
        damageDetailEvents.push({
          t: 'combat_log',
          actor: attacker.tag,
          target: defender.tag,
          action: 'kuanglan_wave_hit',
          damage: d,
          text: `${attacker.name} 狂澜第${idx + 1}击造成${d}伤害${extra}`
        });
      }
      tryZhanmoShentuExecute(state, attacker, defender, damageDetailEvents, { damage: d });
      if (hadTempShieldBeforeHit) shouldShieldReflect = true;
      counterTriggerByHit = d > 0 || (hadTempShieldBeforeHit && preCounterDamage > 0);
    }
    if (defender.hp <= 0) defender.alive = false;
    // 万圣龙王破风压不触发反击
    if (counterTriggerByHit && defender.hp > 0 && !(idx < wanshengWindCount)) {
      if (defender.daifa_rounds > 0) doCounter(daifaCoeff, 'daifa');
      const skillCounterChanceBonus = mode === 'skill' ? numVal(defender.counter_skill_hit_chance_bonus, 0) : 0;
      const realCounterChance = clamp((defender?.on_counter?.chance || 0) + skillCounterChanceBonus, 0, 0.95);
      if (defender.on_counter && defender.hp > 0 && nextRand01(state) < realCounterChance) doCounter(equippedCoeff, 'kunde');
    }
  }

  if (shouldShieldReflect) {
    applyShieldedDamageReflect(state, attacker, defender, damageDetailEvents, { hadTempShieldBeforeDamage: true });
  }

  finalDmg = damagePackets.reduce((a, b) => a + b, 0);
  const beforeShengguitage = finalDmg;
  finalDmg = _applyShengguitageDirect(state, attacker, defender, finalDmg, isSpell, skillName, events);
  if (finalDmg > beforeShengguitage) {
    let bonus = finalDmg - beforeShengguitage;
    bonus = _capAndAbsorbDamage(state, defender, bonus, events);
    finalDmg = beforeShengguitage + bonus;
    defender.hp = Math.max(0, defender.hp - bonus);
    if (defender.hp <= 0) defender.alive = false;
    tryZhanmoShentuExecute(state, attacker, defender, events, { damage: bonus });
  }

  if (attacker._man_charge_cast && attacker.ex_weapon?.charge_kill_reset_cd && mode === 'skill' && skill && defender.hp <= 0) {
    const manSid = Math.max(1, intVal(skillId, 0));
    if (manSid > 0 && attacker.skill_cooldowns) {
      attacker.skill_cooldowns[String(manSid)] = 0;
      events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'man_charge_reset',
        text: `蛮：${String(skill.name || `技能${manSid}`)}击杀目标，冷却已重置` });
    }
  }
  attacker._huang_charging = false;
  attacker._man_charge_cast = false;

  const _dpHitCount = damagePackets.filter(d => d > 0).length;
  const actText = mode === 'skill'
    ? (mimicSourceSkillName ? `使用${mimicSourceSkillName}，模仿了${skillName}` : `使用${skillName}`)
    : '攻击';
  events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: mode,
    skill_name: skillName, damage: finalDmg, is_crit: isCrit,
    text: isCrit ? `${attacker.name} ${actText}${defender.name}，暴击造成${finalDmg}伤害`
                 : `${attacker.name} ${actText}${defender.name}，造成${finalDmg}伤害` });
  events.push(...damageDetailEvents);
  const lifestealDamageBase = Math.max(0, intVal(finalDmg, 0))
    + _sumTempShieldAbsorb(events, defender.tag);

  if (mode === 'skill' && skill && finalDmg > 0) {
    applySkillDamageShieldGain(state, attacker, skill, lv, finalDmg, events);
  }

  if (finalDmg > 0 && attacker.is_ally) {
    const taichuNegCountSnapshot = getNegativeStatusCount(defender);
    events.push(...applyPostDamageExEffects(attacker, defender, finalDmg, isSpell, skill, state, isCrit, _dpHitCount));
    events.push(...applySetEffectsOnDealDamage(state, attacker, defender, finalDmg, isSpell, _dpHitCount, { taichuNegCountSnapshot, damageCategory: 'direct' }));
  }

  const canAffixSplash =
    isTeamBattle &&
    finalDmg > 0 &&
    !(mode === 'skill' && skill && String(skill.target || '') === 'all');
  if (canAffixSplash) {
    _applyDirectSplashDamage(state, attacker, defender, finalDmg, isSpell, skillName, events);
  }

  if (mode === 'skill' && skill && isTeamBattle) {
    const sid = intVal(skill.id, 0);
    const otherTargets = _aliveUnits(state, !attacker.is_ally).filter(u => u.tag !== defender.tag);

    if (sid === 39 && blossomTypeCount > 0) {
      _applyHenbieliBlossomEcho(state, attacker, defender, blossomTypeCount, skillName, events);
    }

    // 团战：万圣龙王破仅“前4次风压”波及其余敌人（风压无衰减、无视防御）
    if (sid === 18 && otherTargets.length > 0) {
      const eff = (skill.effects || []).find(x => String(x?.type || '') === 'wansheng_longwang_po');
      const hitCoef = numVal(eff?.value, 0.25) + (lv > 1 ? (lv - 1) * numVal(eff?.coefficientBonus, 0.05) : 0);
      const hitCount = Math.max(1, intVal(eff?.count, 4));
      for (const tgt of otherTargets) {
        const windRes = calcDamage(state, attacker, tgt, 'skill', hitCoef, false, skill, lv, { ignoreDefense: 1 });
        const oneWindDmg = windRes.damage;
        events.push(...(windRes.events || []));
        let windDmg = 0;
        for (let i = 0; i < hitCount && tgt.hp > 0; i++) {
          let one = _applyKuangyongPacket(oneWindDmg);
          one = _capAndAbsorbDamage(state, tgt, one, events);
          windDmg += one;
          if (one > 0) {
            tgt.hp = Math.max(0, tgt.hp - one);
            if (tgt.hp <= 0) tgt.alive = false;
            tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: one });
          }
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'wansheng_wind',
          skill_name: skillName, damage: windDmg, text: `${attacker.name} 的风压波及${tgt.name}，造成${windDmg}伤害` });
        _appendUnitDiedEventIfNeeded(tgt, events);
      }
    }

    // 团战：风雷吼、黄泉葬仙阵、断魂碎岩斩改为全体攻击（首目标已结算，此处补其余目标）
    if ((sid === 25 || sid === 36 || sid === 21) && otherTargets.length > 0) {
      for (const tgt of otherTargets) {
        let aoeDmg = 0;
        let aoeCrit = false;
        if (sid === 21) {
          const physCritEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_percent_range_physical_crit');
          if (physCritEff) {
            const pr = calcDamagePhysCritRange(state, attacker, tgt, physCritEff, lv, skill);
            aoeDmg = Math.max(0, intVal(pr.damage, 0));
            aoeCrit = pr.isCrit;
            events.push(...(pr.events || []));
          }
        } else if (sid === 25) {
          const hits = collectSkillDamageHits(skill, lv, state);
          const fallbackHits = hits.length === 0 ? [{ mul: skillMul, isSpell: true, opts: {} }] : hits;
          for (const h of fallbackHits) {
            const res = calcDamage(state, attacker, tgt, 'skill', h.mul, h.isSpell, skill, lv, h.opts);
            events.push(...(res.events || []));
            let segDmg = _applyKuangyongPacket(Math.max(0, intVal(res.damage, 0)));
            if (segDmg > 0 && tgt.hp > 0) {
              if (tgt.hunchong_stacks > 0) {
                tgt.hunchong_stacks -= 1;
                segDmg = 0;
                events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
                  text: `${tgt.name} 的缓冲抵消了这次伤害！` });
              } else if (tgt.direct_damage_ignore_chance > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
                segDmg = 0;
                events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
                  text: `${tgt.name} 无视了这次伤害！` });
              }
              if (segDmg > 0) {
                segDmg = _capAndAbsorbDamage(state, tgt, segDmg, events);
                tgt.hp = Math.max(0, tgt.hp - segDmg);
                if (tgt.hp <= 0) tgt.alive = false;
                tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: segDmg });
                _applyJianxinFollowUp(state, attacker, tgt, h.isSpell, skill, lv, events);
              }
            }
            aoeDmg += segDmg;
            if (res.isCrit) aoeCrit = true;
          }
        } else {
          const spellPhysDefEff = (skill.effects || []).find(x => String(x?.type || '') === 'damage_spell_phys_def_plus_self_hp_lost');
          if (spellPhysDefEff) {
            const hpBak = attacker.hp;
            const aliveBak = attacker.alive;
            const pr = calcDamageSpellPhysDefPlusSelfHpLost(state, attacker, tgt, spellPhysDefEff, lv, skill);
            attacker.hp = hpBak;
            attacker.alive = aliveBak;
            const filteredEvents = (pr.events || []).filter(ev => String(ev?.action || '') !== 'self_damage');
            events.push(...filteredEvents);
            aoeDmg += _applyKuangyongPacket(Math.max(0, intVal(pr.damage, 0)));
            if (pr.isCrit) aoeCrit = true;
          }
        }
        if (sid === 21) aoeDmg = _applyKuangyongPacket(Math.max(0, intVal(aoeDmg, 0)));
        if (aoeDmg > 0) {
          if (sid !== 25) {
            aoeDmg = _capAndAbsorbDamage(state, tgt, aoeDmg, events);
            tgt.hp = Math.max(0, tgt.hp - aoeDmg);
            if (tgt.hp <= 0) tgt.alive = false;
            tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: aoeDmg });
          }
          if (sid === 21 || sid === 36) _applyJianxinFollowUp(state, attacker, tgt, isSpell, skill, lv, events);
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'skill_aoe',
          skill_name: skillName, damage: aoeDmg, is_crit: aoeCrit,
          text: aoeCrit ? `${attacker.name} 使用${skillName}波及${tgt.name}，暴击造成${aoeDmg}伤害`
                       : `${attacker.name} 使用${skillName}波及${tgt.name}，造成${aoeDmg}伤害` });
        if (sid === 25) events.push(...applySkillSpecialEffects(skill, lv, attacker, tgt, state));
        _appendUnitDiedEventIfNeeded(tgt, events);
      }
    }

    // 团战：清音破云、绽放对其余敌人造成20%-40%直接伤害溅射
    if ((sid === 5 || sid === 39) && splashBaseDamage > 0 && otherTargets.length > 0) {
      for (const tgt of otherTargets) {
        const ratio = 0.20 + nextRand01(state) * 0.20;
        let splash = Math.max(1, Math.floor(splashBaseDamage * ratio));
        if (tgt.hunchong_stacks > 0) {
          tgt.hunchong_stacks -= 1;
          splash = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
            text: `${tgt.name} 的缓冲抵消了溅射伤害！` });
        } else if (tgt.direct_damage_ignore_chance > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
          splash = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
            text: `${tgt.name} 无视了溅射伤害！` });
        }
        if (splash > 0) {
          splash = _capAndAbsorbDamage(state, tgt, splash, events);
          tgt.hp = Math.max(0, tgt.hp - splash);
          if (tgt.hp <= 0) tgt.alive = false;
          tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: splash });
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'splash',
          skill_name: skillName, damage: splash,
          text: `${attacker.name} 的${skillName}溅射命中${tgt.name}，造成${splash}伤害` });
        _appendUnitDiedEventIfNeeded(tgt, events);
      }
    }

    // 混沌天地一灯照：对其余敌人造成35%溅射伤害
    if (sid === 59 && finalDmg > 0 && otherTargets.length > 0) {
      for (const tgt of otherTargets) {
        let splash = Math.max(1, Math.floor(finalDmg * 0.35));
        if (tgt.hunchong_stacks > 0) {
          tgt.hunchong_stacks -= 1;
          splash = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
            text: `${tgt.name} 的缓冲抵消了溅射伤害！` });
        } else if (tgt.direct_damage_ignore_chance > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
          splash = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
            text: `${tgt.name} 无视了溅射伤害！` });
        }
        if (splash > 0) {
          splash = _capAndAbsorbDamage(state, tgt, splash, events);
          tgt.hp = Math.max(0, tgt.hp - splash);
          if (tgt.hp <= 0) tgt.alive = false;
          tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: splash });
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'splash',
          skill_name: skillName, damage: splash,
          text: `${attacker.name} 的${skillName}溅射命中${tgt.name}，造成${splash}伤害` });
        _appendUnitDiedEventIfNeeded(tgt, events);
      }
    }

    // 团战：天地有情剑每一段命中2个目标（主目标已结算，此处每段补1个额外目标）
    if (sid === 12 && otherTargets.length > 0) {
      const hits = collectSkillDamageHits(skill, lv, state);
      const fallbackHits = hits.length === 0 ? [{ mul: skillMul, isSpell: false, opts: {} }, { mul: skillMul, isSpell: true, opts: {} }] : hits;
      let seg = 0;
      for (const h of fallbackHits) {
        seg += 1;
        const currentOpponents = _aliveUnits(state, !attacker.is_ally).filter(u => u.tag !== defender.tag);
        const extra = _pickExtraTargets(state, currentOpponents, '', 1)[0];
        if (!extra) continue;
        const res = calcDamage(state, attacker, extra, 'skill', h.mul, h.isSpell, skill, lv, h.opts);
        events.push(...(res.events || []));
        let extraDmg = _applyKuangyongPacket(Math.max(0, intVal(res.damage, 0)));
        if (extraDmg > 0) {
          extraDmg = _capAndAbsorbDamage(state, extra, extraDmg, events);
          extra.hp = Math.max(0, extra.hp - extraDmg);
          if (extra.hp <= 0) extra.alive = false;
          tryZhanmoShentuExecute(state, attacker, extra, events, { damage: extraDmg });
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: extra.tag, action: 'tiandi_extra_hit',
          skill_name: skillName, damage: extraDmg, is_crit: res.isCrit,
          text: `${attacker.name} 的${skillName}第${seg}段命中${extra.name}，造成${extraDmg}伤害` });
        if (extraDmg > 0) {
          _applyJianxinFollowUp(state, attacker, extra, h.isSpell, skill, lv, events);
        }
        _appendUnitDiedEventIfNeeded(extra, events);
      }
    }

    const _aoeHandled = [18, 25, 36, 21, 12, 5, 39];
    if (String(skill.target || '') === 'all' && !_aoeHandled.includes(sid) && otherTargets.length > 0) {
      for (const tgt of otherTargets) {
        let aoeDmg = 0;
        let aoeCrit = false;
        const hits = collectSkillDamageHits(skill, lv, state);
        const fallbackHits = hits.length === 0 ? [{ mul: skillMul, isSpell, opts: {} }] : hits;
        for (const h of fallbackHits) {
          const res = calcDamage(state, attacker, tgt, 'skill', h.mul, h.isSpell, skill, lv, h.opts || {});
          events.push(...(res.events || []));
          aoeDmg += _applyKuangyongPacket(Math.max(0, intVal(res.damage, 0)));
          if (res.isCrit) aoeCrit = true;
        }
        const _aoeHitCount = fallbackHits.length;
        if (tgt.hunchong_stacks > 0 && aoeDmg > 0) {
          tgt.hunchong_stacks -= 1;
          aoeDmg = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'hunchong_absorb',
            text: `${tgt.name} 的缓冲抵消了这次伤害！` });
        } else if (tgt.direct_damage_ignore_chance > 0 && aoeDmg > 0 && nextRand01(state) < tgt.direct_damage_ignore_chance) {
          aoeDmg = 0;
          events.push({ t: 'combat_log', actor: tgt.tag, target: tgt.tag, action: 'ignore',
            text: `${tgt.name} 无视了这次伤害！` });
        }
        if (aoeDmg > 0) {
          aoeDmg = _capAndAbsorbDamage(state, tgt, aoeDmg, events);
          tgt.hp = Math.max(0, tgt.hp - aoeDmg);
          if (tgt.hp <= 0) tgt.alive = false;
          tryZhanmoShentuExecute(state, attacker, tgt, events, { damage: aoeDmg });
          for (let _jx = 0; _jx < _aoeHitCount; _jx++) _applyJianxinFollowUp(state, attacker, tgt, isSpell, skill, lv, events);
        }
        events.push({ t: 'combat_log', actor: attacker.tag, target: tgt.tag, action: 'skill_aoe',
          skill_name: skillName, damage: aoeDmg, is_crit: aoeCrit,
          text: aoeCrit ? `${attacker.name} 使用${skillName}波及${tgt.name}，暴击造成${aoeDmg}伤害`
                       : `${attacker.name} 使用${skillName}波及${tgt.name}，造成${aoeDmg}伤害` });
        _appendUnitDiedEventIfNeeded(tgt, events);
      }
    }
  }

  if (mode === 'skill' && skill && String(skill.damageType || '') !== 'none') {
    applyFenjieShentuOnDamageSkill(state, attacker, events, { skill });
  }

  if (attacker.lifesteal > 0 && lifestealDamageBase > 0 && !isSpell) {
    let heal = Math.floor(lifestealDamageBase * attacker.lifesteal);
    heal = Math.floor(heal * (1.0 + numVal(attacker.heal_bonus, 0)));
    if (heal > 0) {
      const lsBypass = attacker.heal_except_lifesteal === true;
      if (isHealForbidden(attacker) && !lsBypass) {
        pushHealForbiddenEvent(attacker, events, '吸血');
      } else {
        const healed = applyHealWithOverflowShield(attacker, heal, events);
        events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'lifesteal',
          heal: healed.actualHeal, text: `${attacker.name} 吸血回复${healed.actualHeal}生命` });
      }
    }
  }
  const spellLs = numVal(attacker.spell_lifesteal, 0);
  if (spellLs > 0 && lifestealDamageBase > 0 && isSpell) {
    let heal = Math.floor(lifestealDamageBase * spellLs);
    heal = Math.floor(heal * (1.0 + numVal(attacker.heal_bonus, 0)));
    if (heal > 0) {
      const spellLsBypass = attacker.heal_except_lifesteal === true;
      if (isHealForbidden(attacker) && !spellLsBypass) {
        pushHealForbiddenEvent(attacker, events, '法术吸血');
      } else {
        const healed = applyHealWithOverflowShield(attacker, heal, events);
        events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'lifesteal',
          heal: healed.actualHeal, text: `${attacker.name} 法术吸血回复${healed.actualHeal}生命` });
      }
    }
  }

  // 凝滞，5件套决意可抵消
  if (!isSpell && attacker.on_stasis && finalDmg > 0 && nextRand01(state) < attacker.on_stasis.chance) {
    let stasisDur = consumeJueyiForControl(defender, attacker.on_stasis.duration);
    defender.stasis_rounds = Math.max(defender.stasis_rounds || 0, stasisDur);
    events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'stasis',
      text: `${defender.name} 被凝滞！` });
  }

  // 寄生（任何直接伤害命中）
  if (attacker.on_jisheng && finalDmg > 0) {
    events.push(...applyDebuff(defender, {
      type: 'jisheng', stacks: attacker.on_jisheng.duration,
      damagePercent: attacker.on_jisheng.damagePercent, attribute: 'spell_attack'
    }, state, attacker));
  }

  if (skill && mode === 'skill') {
    events.push(...applySkillSpecialEffects(skill, lv, attacker, defender, state));
  }

  const skipHybridHeal = !!attacker._skip_hybrid_heal_once;
  attacker._skip_hybrid_heal_once = false;

  if (_bonusHealEff && mode === 'skill' && skill && !skipHybridHeal) {
    const _bhIsPvp = isPvpBattleMode(state?.battle_mode);
    const _bhBase = (_bhIsPvp && _bonusHealEff.pvpValue != null) ? numVal(_bonusHealEff.pvpValue, 0) : numVal(_bonusHealEff.value, 0);
    const pct = _bhBase + (lv > 1 ? (lv - 1) * numVal(_bonusHealEff.coefficientBonus, 0) : 0);
    let heal;
    if (String(_bonusHealEff.type || '') === 'heal_max_hp_percent') {
      heal = Math.max(1, Math.floor(attacker.max_hp * clamp(pct, 0, 1)));
    } else if (String(_bonusHealEff.type || '') === 'heal_phys_attack_percent') {
      const phAtk = Math.max(1, Math.floor((attacker.min_attack + attacker.max_attack) / 2));
      heal = Math.max(1, Math.floor(phAtk * pct));
    } else {
      const spAtk = Math.max(1, attacker.spell_attack || attacker.max_attack);
      heal = Math.max(1, Math.floor(spAtk * pct));
    }
    heal = Math.floor(heal * (1.0 + numVal(attacker.heal_bonus, 0)));
    if (attacker.zhuohun_rounds > 0 && attacker.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - attacker.zhuohun_heal_reduce));
    const skillAttr = String(skill?.attribute || '');
    if (skillAttr === '水' || skillAttr === '混元' || skillAttr === '无') {
      let aff = 0;
      if (skillAttr === '水') aff = numVal(attacker.water_affinity, 0);
      else if (skillAttr === '混元') aff = numVal(attacker.hunyuan_affinity, 0);
      else if (skillAttr === '无') aff = numVal(attacker.wu_affinity, 0);
      if (aff > 0) heal = Math.floor(heal * (1.0 + aff * 0.0065));
    }
    if (attacker.perfect_water && nextRand01(state) < 0.10) heal = Math.floor(heal * 1.35);
    const targetMode = _bonusHealEff.targetMode || '';
    let healTarget = attacker;
    const casterTeam = attacker.is_ally ? state.allies : state.enemies;
    if (targetMode === 'self_or_lowest_ally' && Array.isArray(casterTeam)) {
      const aliveAllies = casterTeam.filter(a => a && a.alive && a.hp > 0);
      if (aliveAllies.length > 1) {
        healTarget = aliveAllies.reduce((lo, cur) =>
          (cur.hp / cur.max_hp) < (lo.hp / lo.max_hp) ? cur : lo, aliveAllies[0]);
      }
    }
    if (isHealForbidden(healTarget)) {
      pushHealForbiddenEvent(healTarget, events, skillName);
    } else if (healTarget === attacker && tryJiemieHealToXurui(attacker, heal, events, { text: `劫灭-斗战乾坤：技能回复无效，获得2轮蓄锐` })) {
      // 已转为蓄锐
    } else {
      const healed = applyHealWithOverflowShield(healTarget, heal, events);
      events.push({ t: 'combat_log', actor: attacker.tag, target: healTarget.tag, action: 'heal',
        skill_name: skillName, heal: healed.actualHeal, text: `${attacker.name} 使用${skillName}，${healTarget.name}回复了${healed.actualHeal}生命` });
      if (attacker.is_ally && healed.actualHeal > 0) applySetEffectsOnHeal(state, healed.actualHeal, events, allyOverrides);
      if (healTarget !== attacker && attacker.heal_others_self_heal > 0) {
        const selfBack = Math.floor(healed.actualHeal * attacker.heal_others_self_heal);
        if (selfBack > 0) {
          if (tryJiemieHealToXurui(attacker, selfBack, events, { text: `劫灭-斗战乾坤：治疗回馈无效，获得2轮蓄锐` })) {
            // 已转为蓄锐
          } else {
            if (isHealForbidden(attacker)) {
              pushHealForbiddenEvent(attacker, events, '治疗回馈');
            } else {
              const selfHealed = applyHealWithOverflowShield(attacker, selfBack, events);
              events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'heal_echo',
                heal: selfHealed.actualHeal, text: `${attacker.name} 治疗回馈，回复了${selfHealed.actualHeal}生命` });
            }
          }
        }
      }
    }
  }
  const casterTeam = attacker.is_ally ? state.allies : state.enemies;
  if (_bonusTeamHealEff && mode === 'skill' && skill && !skipHybridHeal && Array.isArray(casterTeam)) {
    const _btIsPvp = isPvpBattleMode(state?.battle_mode);
    const teamPct = (_btIsPvp && _bonusTeamHealEff.pvpValue != null) ? numVal(_bonusTeamHealEff.pvpValue, 0.15) : numVal(_bonusTeamHealEff.value, 0.15);
    for (const ally of casterTeam) {
      if (ally && ally.alive && ally.hp > 0) {
        let allyHeal = Math.max(1, Math.floor(ally.max_hp * clamp(teamPct, 0, 1)));
        allyHeal = Math.floor(allyHeal * (1.0 + numVal(attacker.heal_bonus, 0)));
        if (isHealForbidden(ally)) {
          pushHealForbiddenEvent(ally, events, skillName);
          allyHeal = 0;
        } else {
          const allyHealed = applyHealWithOverflowShield(ally, allyHeal, events);
          allyHeal = allyHealed.actualHeal;
          events.push({ t: 'combat_log', actor: attacker.tag, target: ally.tag, action: 'team_heal',
            heal: allyHeal, text: `${ally.name} 回复了${allyHeal}生命` });
        }
        if (attacker.heal_others_self_heal > 0 && ally !== attacker) {
          const selfBack = Math.floor(allyHeal * attacker.heal_others_self_heal);
          if (selfBack > 0) {
            if (tryJiemieHealToXurui(attacker, selfBack, events, { text: `劫灭-斗战乾坤：治疗回馈无效，获得2轮蓄锐` })) {
              // 已转为蓄锐
            } else {
              if (isHealForbidden(attacker)) {
                pushHealForbiddenEvent(attacker, events, '治疗回馈');
              } else {
                const selfHealed = applyHealWithOverflowShield(attacker, selfBack, events);
                events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'heal_echo',
                  heal: selfHealed.actualHeal, text: `${attacker.name} 治疗回馈，回复了${selfHealed.actualHeal}生命` });
              }
            }
          }
        }
      }
    }
  }

  if (attacker.is_ally) applySetEffectsOnPlayerTurnEnd(state, events, allyOverrides);

  if (defender.hp <= 0) {
    events.push({ t: 'unit_died', actor: defender.tag, text: `${defender.name} 被击败了！` });
  }
  return { ok: true, events, used_mode: usedMode, used_skill_id: usedSkillId };
}

// ─── AI ───

function _chooseAction(state, unit) {
  _ensureKeySkillState(unit);
  // 绝脉强制普攻
  if (unit.juemai_rounds > 0) return { mode: 'attack', skillId: 0 };

  const available = [];
  for (const sid of (unit.equipped_skills || [])) {
    const cd = intVal(unit.skill_cooldowns?.[String(sid)], 0);
    if (cd > 0) continue;
    const skill = getSkillById(sid);
    if (!skill || !skill.id) continue;
    if (Math.max(0, intVal(skill.mpCost, 0)) > unit.mp) continue;
    available.push(sid);
  }

  // 勃发强制技能
  if (unit.bofa_rounds > 0 && available.length > 0) {
    return { mode: 'skill', skillId: available[Math.floor(nextRand01(state) * available.length)] };
  }

  const keySkillId = intVal(unit.key_skill_id, 0);
  const missTurns = intVal(unit.key_skill_miss_turns, 0);
  if (keySkillId > 0 && missTurns >= 4 && _canUseSkillNow(unit, keySkillId)) {
    return { mode: 'skill', skillId: keySkillId, forcedKey: true };
  }

  const isLeague = String(state?.battle_mode || '') === 'league';
  const skillChance = isLeague ? 0.75 : (unit.is_ally ? 0.7 : 0.4);
  if (available.length > 0 && nextRand01(state) < skillChance) {
    return { mode: 'skill', skillId: available[Math.floor(nextRand01(state) * available.length)] };
  }
  return { mode: 'attack', skillId: 0 };
}

// ─── Main API ───

function createDungeonBattle(dungeon, allyPlayers, enemyWaves, opts = {}) {
  const validPlayers = (Array.isArray(allyPlayers) ? allyPlayers : []).filter(p => p && typeof p === 'object');
  const isTeamBattle = validPlayers.length > 1;
  const allies = validPlayers.map((p, i) => {
    const snap = buildPlayerSnapshot(p, { skipInventory: true, battleMode: opts.battleMode, isTeamBattle });
    snap.skill_cooldowns = _buildBattleStartCooldowns(snap);
    snap.yujian_extra_cast = false;
    snap.tag = `ally_${i}`;
    snap.index = i;
    snap.account_id = intVal(p?.account_id, 0);
    return snap;
  });
  const waveSnaps = enemyWaves.map((wave, wi) =>
    wave.map((e, ei) => {
      const idx = wi * 100 + ei;
      if (e && typeof e === 'object' && e.__snapshot_ready) {
        const snap = deepClone(e);
        delete snap.inventory;
        snap.tag = `enemy_${idx}`;
        snap.index = idx;
        snap.is_ally = false;
        snap.alive = snap.alive !== false;
        return snap;
      }
      return buildEnemySnapshot(e, idx);
    }));

  const state = {
    status: 'active',
    draw: false,
    dungeon_id: intVal(dungeon.id, 0),
    dungeon_name: String(dungeon.name || '副本'),
    current_wave: 0, total_waves: waveSnaps.length,
    round: 1, turn_queue: [],
    allies, enemies: deepClone(waveSnaps[0] || []),
    all_waves: waveSnaps,
    rng_seed: Math.floor(Math.random() * 2147483647), rng_cursor: 0,
    _haomiao_lethal_saved: false,
    _lihuo_zhuoshao_this_action: false
  };
  initTechniqueBattleStartEffects(state);
  _buildTurnQueue(state);
  return state;
}

function advanceTurn(stateInput) {
  if (!stateInput || typeof stateInput !== 'object') return { ok: false, error: '无效的战斗状态' };
  const state = stateInput;
  state.allies = Array.isArray(state.allies) ? state.allies : [];
  state.enemies = Array.isArray(state.enemies) ? state.enemies : [];
  state.all_waves = Array.isArray(state.all_waves) ? state.all_waves : [];
  state.turn_queue = Array.isArray(state.turn_queue)
    ? state.turn_queue.map(t => String(t || '').trim()).filter(Boolean)
    : [];
  if (state.status !== 'active') return { ok: false, error: '战斗已结束' };
  if (intVal(state.round, 1) > MAX_BATTLE_ROUNDS) {
    return _finishAsDraw(state);
  }

  if (!Array.isArray(state.turn_queue) || state.turn_queue.length === 0) {
    state.round += 1;
    if (intVal(state.round, 1) > MAX_BATTLE_ROUNDS) {
      return _finishAsDraw(state);
    }
    _buildTurnQueue(state);
    if (state.turn_queue.length === 0) {
      state.status = 'finished';
      state.draw = false;
      return { ok: true, state, events: [{ t: 'battle_end', victory: false, draw: false, text: '战斗异常结束' }], ended: true, victory: false, draw: false };
    }
  }

  let actor = null;
  while (state.turn_queue.length > 0) {
    const tag = state.turn_queue.shift();
    const unit = _getUnit(state, tag);
    if (unit && unit.alive && unit.hp > 0) { actor = unit; break; }
  }
  if (!actor) {
    state.round += 1;
    if (intVal(state.round, 1) > MAX_BATTLE_ROUNDS) {
      return _finishAsDraw(state);
    }
    _buildTurnQueue(state);
    return { ok: true, state, events: [], ended: false, victory: false, draw: false };
  }

  _decrementCooldowns(actor);
  const allEvents = [{ t: 'turn_start', actor: actor.tag, name: actor.name, round: state.round }];

  // 凝滞跳过
  if (actor.stasis_rounds > 0) {
    actor.stasis_rounds -= 1;
    allEvents.push({ t: 'combat_log', actor: actor.tag, target: actor.tag, action: 'stasis_skip',
      text: `${actor.name} 被凝滞，无法行动！` });
    return { ok: true, state, events: allEvents, ended: false, victory: false, draw: false };
  }

  // Debuff tick
  allEvents.push(...triggerDebuffs(actor, state));
  if (actor.hp <= 0) {
    actor.alive = false;
    if (_aliveUnits(state, true).length === 0) {
      state.status = 'finished';
      state.draw = false;
      allEvents.push({ t: 'battle_end', victory: false, draw: false, text: '队伍全灭，副本失败！' });
      return { ok: true, state, events: allEvents, ended: true, victory: false, draw: false };
    }
    return { ok: true, state, events: allEvents, ended: false, victory: false, draw: false };
  }

  // 蓄力处理：凝滞只消耗凝滞层数；蓄力中的单位按回合推进
  let chargeTurnConsumed = false;
  if (actor.xuli && typeof actor.xuli === 'object') {
    actor.xuli.rounds_remaining = intVal(actor.xuli.rounds_remaining, 0) - 1;
    if (actor.xuli.rounds_remaining <= 0) {
      const xuliData = actor.xuli;
      actor.xuli = null;
      const chargeSkill = getSkillById(intVal(xuliData?.skill_id, 0));
      const chargeSkillName = String(chargeSkill?.name || `技能${intVal(xuliData?.skill_id, 0)}`);
      allEvents.push({ t: 'combat_log', actor: actor.tag, target: actor.tag, action: 'xuli_release',
        text: `${actor.name} 蓄力完成，释放${chargeSkillName}！` });
      consumeNextActionHeal(actor, state, allEvents);
      let chargeTarget = actor;
      if (String(chargeSkill?.damageType || '') !== 'none') {
        const chargeTargets = _aliveUnits(state, !actor.is_ally);
        chargeTarget = _pickTarget(state, chargeTargets) || chargeTargets[0] || actor;
      }
      const chargeResult = _executeAction(
        state,
        actor,
        chargeTarget,
        'skill',
        intVal(xuliData?.skill_id, 0),
        { skipCooldown: true, skipMpCost: true, skipChargeCheck: true }
      );
      if (chargeResult && chargeResult.ok) allEvents.push(...(chargeResult.events || []));
      chargeTurnConsumed = true;
    } else if (actor.ex_weapon?.charge_can_act) {
      actor._huang_charging = true;
      allEvents.push({ t: 'combat_log', actor: actor.tag, target: actor.tag, action: 'huang_charge_act',
        text: `荒：蓄力中可行动（伤害-50%），剩余${actor.xuli.rounds_remaining}回合` });
    } else {
      allEvents.push({ t: 'combat_log', actor: actor.tag, target: actor.tag, action: 'xuli_charging',
        text: `${actor.name} 正在蓄力中...（剩余${actor.xuli.rounds_remaining}回合）` });
      chargeTurnConsumed = true;
    }
  }

  if (!chargeTurnConsumed) consumeNextActionHeal(actor, state, allEvents);

  const action = !chargeTurnConsumed ? _chooseAction(state, actor) : null;
  const isAlly = actor.is_ally;
  const targets = _aliveUnits(state, !isAlly);

  if (!chargeTurnConsumed && targets.length > 0) {
    let actionResult = null;
    if (action.mode === 'skill') {
      const skill = getSkillById(action.skillId);
      const pureSupport = String(skill?.damageType || '') === 'none';
      const noneSkillTargetsEnemy = pureSupport && _noneSkillTargetsEnemy(skill);
      const hasHealEffect = (skill?.effects || []).some(e => {
        const t = String(e?.type || '');
        return t === 'player_hp_percent' || t === 'heal_max_hp_percent' || t === 'heal_phys_attack_percent';
      });
      const casterTeam = actor.is_ally ? state.allies : state.enemies;
      const hasInjuredAlly = Array.isArray(casterTeam) && casterTeam.some(u => {
        if (!u || !u.alive || u.hp <= 0) return false;
        return numVal(u.hp, 0) < numVal(u.max_hp, 1) * 0.95;
      });
      if (Boolean(action.forcedKey)) {
        if (pureSupport) {
          const target = noneSkillTargetsEnemy ? _pickTarget(state, targets) : actor;
          actionResult = _executeAction(state, actor, target || actor, 'skill', action.skillId);
          allEvents.push(...(actionResult.events || []));
        } else {
          const target = _pickTarget(state, targets);
          actionResult = _executeAction(state, actor, target, 'skill', action.skillId);
          allEvents.push(...(actionResult.events || []));
        }
      } else {
        if (!pureSupport || noneSkillTargetsEnemy) {
          const target = _pickTarget(state, targets);
          actionResult = _executeAction(state, actor, target, 'skill', action.skillId);
          allEvents.push(...(actionResult.events || []));
        } else if (!hasHealEffect || hasInjuredAlly) {
          actionResult = _executeAction(state, actor, actor, 'skill', action.skillId);
          allEvents.push(...(actionResult.events || []));
        } else {
          const target = _pickTarget(state, targets);
          actionResult = _executeAction(state, actor, target, 'attack', 0);
          allEvents.push(...(actionResult.events || []));
        }
      }
    } else {
      const target = _pickTarget(state, targets);
      actionResult = _executeAction(state, actor, target, action.mode, action.skillId);
      allEvents.push(...(actionResult.events || []));
    }
    _ensureKeySkillState(actor);
    const keySkillId = intVal(actor.key_skill_id, 0);
    if (keySkillId > 0) {
      const usedKey = Boolean(actionResult && actionResult.used_mode === 'skill' && intVal(actionResult.used_skill_id, 0) === keySkillId);
      actor.key_skill_miss_turns = usedKey ? 0 : (intVal(actor.key_skill_miss_turns, 0) + 1);
    }
  }

  applyTurnEndRecovery(actor, allEvents);
  tickJueyi(actor);
  const fallbackTargets = _aliveUnits(state, !actor.is_ally);
  const fallbackTarget = _pickTarget(state, fallbackTargets) || fallbackTargets[0] || null;
  _decrementStatesWithZhenyue(state, actor, fallbackTarget, allEvents);
  actor._huang_charging = false;

  const aliveEnemies = _aliveUnits(state, false);
  const aliveAllies = _aliveUnits(state, true);

  if (aliveAllies.length === 0) {
    state.status = 'finished';
    state.draw = false;
    allEvents.push({ t: 'battle_end', victory: false, draw: false, text: '队伍全灭，副本失败！' });
    return { ok: true, state, events: allEvents, ended: true, victory: false, draw: false };
  }

  if (aliveEnemies.length === 0) {
    const nextWave = state.current_wave + 1;
    if (nextWave >= state.total_waves) {
      state.status = 'finished';
      state.draw = false;
      allEvents.push({ t: 'battle_end', victory: true, draw: false, text: '副本通关！所有波次已清除！' });
      return { ok: true, state, events: allEvents, ended: true, victory: true, draw: false };
    }
    state.current_wave = nextWave;
    state.enemies = deepClone(state.all_waves[nextWave] || []);
    state.turn_queue = [];
    state.round += 1;
    if (intVal(state.round, 1) > MAX_BATTLE_ROUNDS) {
      return _finishAsDraw(state, allEvents);
    }
    _buildTurnQueue(state);
    allEvents.push({ t: 'wave_clear', wave: nextWave + 1, total: state.total_waves,
      text: `第${nextWave + 1}波敌人来袭！(共${state.total_waves}波)` });
  }

  return { ok: true, state, events: allEvents, ended: false, victory: false, draw: false };
}

function stateToClient(state) {
  if (!state || typeof state !== 'object') return {};
  const s = {};
  for (const k in state) {
    if (k === 'rng_seed' || k === 'rng_cursor' || k === 'all_waves') continue;
    if (k === 'allies' || k === 'enemies') continue; // handle separately
    s[k] = state[k];
  }
  // 客户端展示不需要背包字段，避免每次推送大包体
  if (Array.isArray(state.allies)) {
    s.allies = state.allies.map(u => {
      if (!u || typeof u !== 'object') return u;
      const c = {};
      for (const uk in u) { if (uk !== 'inventory') c[uk] = u[uk]; }
      return c;
    });
  }
  if (Array.isArray(state.enemies)) {
    s.enemies = state.enemies.map(u => {
      if (!u || typeof u !== 'object') return u;
      const c = {};
      for (const uk in u) { if (uk !== 'inventory') c[uk] = u[uk]; }
      return c;
    });
  }
  return s;
}

module.exports = { createDungeonBattle, advanceTurn, stateToClient };
