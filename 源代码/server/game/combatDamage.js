/**
 * 共享技能伤害计算逻辑（battleEngine 与 dungeonBattleEngine 共用）
 */
const { getSkillById } = require('./dataLoader');
const CU = require('./combatUtils');
const { intVal, numVal, clamp, nextRand01, rollInt, calcReducedDamage, countSetPieces, getNegativeStatusCount, getDaomiaoExtraAffinity, calcElementAffinity, getBlossomExplodeInfo, clearBlossomDebuffs, isPvpBattleMode, isStasisGuardActive, pushStasisGuardEvent } = CU;
/** 搦战溢出暴击→最终伤害：搦战状态下，暴击率已100%保证，原暴击率每1%转化为1%最终伤害加成 */
function _nuozhanOverflowMul(attacker) {
  if (attacker.nuozhan_rounds <= 0) return 1.0;
  const overflow = Math.max(0, numVal(attacker.crit_rate, 0));
  return 1.0 + overflow;
}

function _getFlatDamageBonus(attacker, isSpell) {
  if (!attacker || typeof attacker !== 'object') return 0;
  return Math.max(0, intVal(isSpell ? attacker.spell_flat_damage : attacker.phys_flat_damage, 0));
}

function _isKurongNoDirect(attacker) {
  return numVal(attacker?.kurong_shentu_active, 0) > 0;
}

function _getOwnDefenseWithJiangu(attacker, isSpell) {
  if (!attacker || typeof attacker !== 'object') return 0;
  const base = Math.max(0, numVal(isSpell ? attacker.spell_defense : attacker.defense, 0));
  if (!attacker.jiangu) return base;
  const coeff = Math.max(0, numVal(isSpell ? attacker.jiangu.spellCoeff : attacker.jiangu.physCoeff, 0));
  if (coeff <= 0) return base;
  const jianguBase = isSpell
    ? Math.max(0, numVal(attacker.spell_defense, attacker.defense || 0))
    : Math.max(0, numVal(attacker.defense, 0));
  return base + Math.floor(jianguBase * coeff);
}

function _applyTaichuDamageAmp(attacker, defender, damage) {
  const base = Math.max(0, intVal(damage, 0));
  if (base <= 0 || !attacker || !defender) return base;
  if (countSetPieces(attacker, '太初-浑天无极') < 5) return base;
  const negCount = getNegativeStatusCount(defender);
  if (negCount <= 0) return base;
  return Math.max(1, Math.floor(base * (1.0 + negCount * 0.06)));
}

function _applyDirectDamagePostEffects(state, attacker, defender, dmg, isSpell, events) {
  let finalDmg = Math.max(0, intVal(dmg, 0));
  if (finalDmg <= 0) return finalDmg;
  if (_isKurongNoDirect(attacker)) return 0;

  // 土命途三层：物理附带伤害
  if (!isSpell) {
    const extraBySelfHp = Math.max(0, Math.floor(Math.max(0, numVal(attacker?.max_hp, 0)) * Math.max(0, numVal(attacker?.phys_hit_target_max_hp_extra_pct, 0))));
    const extraBySelfDef = Math.max(0, Math.floor(Math.max(0, numVal(attacker?.defense, 0)) * Math.max(0, numVal(attacker?.phys_hit_self_def_extra_pct, 0))));
    finalDmg += extraBySelfHp + extraBySelfDef;
  }

  // 土命途四层：低血斩杀增伤 + 概率追击（物理）
  if (!isSpell && finalDmg > 0) {
    const execMax = Math.max(0, numVal(attacker?.phys_execute_bonus_max, 0));
    if (execMax > 0) {
      const hpRatio = numVal(defender?.hp, 0) / Math.max(1, numVal(defender?.max_hp, 1));
      const missingRatio = clamp(1.0 - hpRatio, 0, 1);
      if (missingRatio > 0) finalDmg = Math.floor(finalDmg * (1.0 + execMax * missingRatio));
    }
    const strikeChance = Math.max(0, numVal(attacker?.phys_extra_strike_chance, 0));
    const strikePct = Math.max(0, numVal(attacker?.phys_extra_strike_damage_pct, 0));
    if (strikeChance > 0 && strikePct > 0 && nextRand01(state) < strikeChance) {
      const strikeBonus = Math.max(1, Math.floor(finalDmg * strikePct));
      finalDmg += strikeBonus;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender?.tag || 'enemy', action: 'earth_extra_strike',
        text: `${attacker.name} 的土途四重触发追击，额外造成${strikeBonus}伤害` });
    }
  }

  // 土命途四层：分系减伤
  if (finalDmg > 0) {
    const typeReduction = isSpell
      ? Math.max(0, numVal(defender?.spell_damage_reduction_bonus, 0))
      : Math.max(0, numVal(defender?.phys_damage_reduction_bonus, 0));
    if (typeReduction > 0) finalDmg = Math.floor(finalDmg * (1.0 - clamp(typeReduction, 0, 0.6)));
  }

  return finalDmg;
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

/** 收集技能所有伤害系数，返回 [{ mul, isSpell, opts }] */
function collectSkillDamageHits(skill, lv, state) {
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

function hasSkillEffect(skill, effectType) {
  return (Array.isArray(skill?.effects) ? skill.effects : []).some(e => String(e?.type || '') === effectType);
}

const MULTI_HIT_DECAY = 0.7;

/** 将多击描述展开为每击伤害数组（真多击：每击=上一击*decay） */
function expandMultiHitDamages(state, attacker, defender, hitDesc, mode, skill, lv) {
  const firstRes = calcDamage(state, attacker, defender, mode, hitDesc.firstMul, hitDesc.isSpell, skill, lv, hitDesc.opts || {});
  const noDecay = !!attacker?.ex_weapon?.no_multi_hit_decay;
  const decay = hitDesc?.lockDecay
    ? numVal(hitDesc.decay, MULTI_HIT_DECAY)
    : (noDecay ? 1 : numVal(hitDesc.decay, MULTI_HIT_DECAY));
  const count = Math.max(1, intVal(hitDesc.count, 2));
  const damages = [firstRes.damage];
  for (let i = 1; i < count; i++) {
    damages.push(Math.max(1, Math.floor(damages[damages.length - 1] * decay)));
  }
  return { damages, isCrit: firstRes.isCrit, events: firstRes.events || [] };
}

/** 伤害计算核心 */
function calcDamage(state, attacker, defender, mode, skillMul, isSpell, skill, skillLevel, opts = {}) {
  const events = [];
  if (isStasisGuardActive(defender)) {
    pushStasisGuardEvent(defender, events, String(skill?.name || '攻击'), 'damage');
    return { damage: 0, isCrit: false, events };
  }
  if (_isKurongNoDirect(attacker)) {
    return { damage: 0, isCrit: false, events };
  }
  const optIgnoreDef = numVal(opts.ignoreDefense, 0);
  const optIgnoreSpellDef = opts.ignoreSpellDefense === true ? 1 : numVal(opts.ignoreSpellDefense, 0);
  const forceCrit = Boolean(opts.forceCrit);
  const adaptiveHigherAttack = Boolean(opts.adaptiveHigherAttack);
  const adaptiveAllDamage = !!attacker?.ex_weapon?.adaptive_all_damage;
  // 十方天华要求：若发生物法互转，暴击判定仍按原始伤害类型进行。
  const critTypeIsSpell = isSpell;

  if (adaptiveAllDamage) {
    const defPhys = Math.max(0, numVal(defender?.defense, 0));
    const defSpell = Math.max(0, numVal(defender?.spell_defense, 0));
    isSpell = defSpell <= defPhys;
  }

  const shenguangAbsoluteSpell = isSpell && !!attacker?.shenguang_spell_absolute;
  const shenguangRatio = clamp(numVal(attacker?.shenguang_spell_damage_ratio, 0.15), 0, 1);
  if (shenguangAbsoluteSpell && !attacker._shenguang_log_shown) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender?.tag || 'enemy', action: 'shenguang',
      text: `${attacker.name} 激发阵形·神光：法术伤害转为绝对伤害并降低至${Math.round(shenguangRatio * 100)}%` });
    attacker._shenguang_log_shown = true;
  }

  if (adaptiveHigherAttack) {
    const physRef = Math.max(1, numVal(attacker?.max_attack, attacker?.min_attack));
    const spellRef = Math.max(1, numVal(attacker?.spell_attack, physRef));
    isSpell = spellRef > physRef;
  }

  let base;
  if (attacker.fenjin_active) {
    base = isSpell ? (attacker.spell_attack || attacker.max_attack) : attacker.max_attack;
  } else if (isSpell) {
    base = Math.max(1, attacker.spell_attack || attacker.max_attack);
    if (attacker.yangjing?.active) base = Math.max(base, attacker.spell_attack || attacker.max_attack);
  } else if (attacker.basic_attack_as_spell && mode === 'attack') {
    const sp = attacker.spell_attack || attacker.max_attack;
    base = rollInt(state, Math.floor(sp * attacker.basic_attack_as_spell.minValue),
                          Math.floor(sp * attacker.basic_attack_as_spell.maxValue));
    isSpell = true;
  } else if (attacker.xurui?.active) {
    base = attacker.max_attack;
  } else if (attacker.fear_rounds > 0) {
    base = attacker.min_attack;
  } else {
    base = rollInt(state, attacker.min_attack, attacker.max_attack);
  }

  let isCrit;
  if (forceCrit) isCrit = true;
  else if (critTypeIsSpell) {
    let spellCritChance = (attacker.spell_crit_rate ?? attacker.crit_rate ?? 0);
    if (attacker.zhuanzhu?.active) spellCritChance = Math.min(0.95, spellCritChance + 0.25);
    isCrit = (attacker.juechang_rounds > 0) || nextRand01(state) < spellCritChance;
  } else {
    let physCritChance = attacker.crit_rate || 0;
    if (attacker.jingzhun?.active) physCritChance = Math.min(0.95, physCritChance + 0.25);
    isCrit = (attacker.nuozhan_rounds > 0) || nextRand01(state) < physCritChance;
  }
  const critMul = isCrit ? (critTypeIsSpell ? (attacker.spell_crit_mult || 1.35) : (attacker.crit_mult || 1.5)) : 1.0;

  let effectiveDef;
  if ((attacker.beishui_rounds > 0) || (defender.beishui_rounds > 0)) {
    effectiveDef = 0;
  } else if (isSpell) {
    effectiveDef = defender.spell_defense || 0;
    // 句芒经被动：被 mastery 寄生的目标法术防御力降低
    if (Array.isArray(defender.debuffs) && !defender.perfect_earth) {
      const mj = defender.debuffs.find(db => db.type === 'jisheng' && db.mastery);
      if (mj) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(numVal(mj.mastery_spell_def_reduce, 0.5), 0, 0.9)));
    }
    // 大光明诀：50%HP以上法术防御+15%（作用于防御方自身）
    if (defender.hp_above_spell_def_bonus) {
      const hpRatio = numVal(defender.hp, 0) / Math.max(1, numVal(defender.max_hp, 1));
      if (hpRatio > defender.hp_above_spell_def_bonus.threshold) {
        effectiveDef = Math.floor(effectiveDef * (1.0 + defender.hp_above_spell_def_bonus.value));
      }
    }
    const spen = numVal(attacker.spell_armor_pen, 0);
    if (spen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(spen, 0, 0.9)));
    if (isCrit && numVal(attacker.spell_crit_ignore_spell_defense, 0) > 0) {
      effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_crit_ignore_spell_defense, 0, 0.9)));
    }
    // 烈日诀：法术未暴击时额外法术穿透
    if (!isCrit && numVal(attacker.spell_pen_on_noncrit, 0) > 0) {
      effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_pen_on_noncrit, 0, 0.9)));
    }
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (optIgnoreSpellDef > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(optIgnoreSpellDef, 0, 1)));
  } else {
    effectiveDef = defender.defense;
    const pen = numVal(attacker.armor_pen, 0);
    if (pen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(pen, 0, 0.9)));
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (optIgnoreDef > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(optIgnoreDef, 0, 1)));
  }
  if (defender.jiangu) {
    if (isSpell) {
      const spellDefBase = Math.max(0, numVal(defender.spell_defense, defender.defense || 0));
      effectiveDef += Math.floor(spellDefBase * defender.jiangu.spellCoeff);
    }
    else effectiveDef += Math.floor(defender.defense * defender.jiangu.physCoeff);
  }
  if (shenguangAbsoluteSpell) {
    effectiveDef = 0;
  }
  if (defender?.fumo_shentu_active) {
    effectiveDef = Math.min(Math.max(0, numVal(effectiveDef, 0)), 6000);
  }

  const weapBuf = 1.0 + Math.max(0, numVal(attacker.weapon_damage_pct, 0));
  const extraAgilityCoeff = Math.max(0, numVal(opts.extraAgilityCoeff, 0));
  const extraFromAgility = extraAgilityCoeff > 0 ? Math.floor(Math.max(0, numVal(attacker.agility, 0)) * extraAgilityCoeff) : 0;
  const rawBase = Math.max(1, Math.floor(base * skillMul + extraFromAgility));
  let raw = Math.max(1, Math.floor(rawBase * critMul * weapBuf));
  const flatDamage = _getFlatDamageBonus(attacker, isSpell);
  if (flatDamage > 0) raw += flatDamage;
  if ((attacker.beishui_rounds > 0) || (defender.beishui_rounds > 0)) raw = Math.floor(raw * 1.2);

  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let finalDmg = calcReducedDamage(raw, effectiveDef, divisor);
  if (isSpell && attacker.spell_final_damage_pct > 0) finalDmg = Math.floor(finalDmg * (1.0 + attacker.spell_final_damage_pct));
  // 大光明诀：50%HP以下法术最终伤害+10%（作用于攻击方自身）
  if (isSpell && attacker.hp_below_spell_final_dmg) {
    const hpRatio = numVal(attacker.hp, 0) / Math.max(1, numVal(attacker.max_hp, 1));
    if (hpRatio < attacker.hp_below_spell_final_dmg.threshold) {
      finalDmg = Math.floor(finalDmg * (1.0 + attacker.hp_below_spell_final_dmg.value));
    }
  }
  // 与我一决：按损失生命分段增伤
  if (attacker.hp_lost_damage_step_bonus) {
    const cfg = attacker.hp_lost_damage_step_bonus;
    const stepHpLost = clamp(numVal(cfg.stepHpLost, 0.1), 0.01, 1);
    const maxSteps = Math.max(1, intVal(cfg.maxSteps, 1));
    const hpRatio = numVal(attacker.hp, 0) / Math.max(1, numVal(attacker.max_hp, 1));
    const missingRatio = clamp(1.0 - hpRatio, 0, 1);
    const steps = Math.min(maxSteps, Math.floor(missingRatio / stepHpLost));
    if (steps > 0) {
      const perStepBonus = isPvpBattleMode(state?.battle_mode)
        ? numVal(cfg.pvpDamageBonusPerStep, numVal(cfg.damageBonusPerStep, 0))
        : numVal(cfg.damageBonusPerStep, 0);
      if (perStepBonus > 0) {
        finalDmg = Math.floor(finalDmg * (1.0 + steps * perStepBonus));
      }
    }
  }
  if (!isSpell) { const nzm = _nuozhanOverflowMul(attacker); if (nzm > 1.0) finalDmg = Math.floor(finalDmg * nzm); }
  const aff = calcElementAffinity(attacker, skill);
  if (aff > 0) finalDmg = Math.floor(finalDmg * (1.0 + aff * 0.0065));
  if (!shenguangAbsoluteSpell && defender.is_ally && defender.damage_reduction > 0)
    finalDmg = Math.floor(finalDmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  finalDmg = _applyTaichuDamageAmp(attacker, defender, finalDmg);
  finalDmg = _applyDirectDamagePostEffects(state, attacker, defender, finalDmg, isSpell, events);
  if (shenguangAbsoluteSpell) {
    finalDmg = Math.max(1, Math.floor(finalDmg * shenguangRatio));
  }
  if (!shenguangAbsoluteSpell && defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag || 'player', target: defender.tag || 'player', action: 'ignore', text: `${defender.name} 无视了这次伤害！` });
    return { damage: 0, isCrit, events };
  }
  return { damage: finalDmg, isCrit, events };
}

/** damage_percent_range_physical_crit */
function calcDamagePhysCritRange(state, attacker, defender, eff, lv, skill) {
  if (_isKurongNoDirect(attacker)) {
    return { damage: 0, isCrit: false };
  }
  const minV = numVal(eff?.minValue, 1.2);
  const maxV = numVal(eff?.maxValue, 1.45);
  const coefBonus = numVal(eff?.coefficientBonus, 0);
  const critDmgBonus = numVal(eff?.critDamageBonus, 0);
  const skillCritChance = numVal(eff?.skillCritChance, 0.2);
  const naturalCritBonus = numVal(eff?.naturalCritBonus, 0.1);
  let adjMin = minV, adjMax = maxV;
  if (lv > 1 && coefBonus > 0) { adjMin += (lv - 1) * coefBonus; adjMax += (lv - 1) * coefBonus; }
  let mult = adjMin + nextRand01(state) * (adjMax - adjMin);
  if (attacker.fear_rounds > 0) mult = adjMin;
  else if (attacker.xurui?.active) mult = adjMax;
  const base = attacker.xurui?.active ? attacker.max_attack : (attacker.fear_rounds > 0 ? attacker.min_attack : rollInt(state, attacker.min_attack, attacker.max_attack));
  let raw = Math.max(1, Math.floor(base * mult));
  const wouldCrit = attacker.nuozhan_rounds > 0;
  let physCritChance = skillCritChance + numVal(attacker.crit_rate, 0);
  if (attacker.jingzhun?.active) physCritChance = Math.min(0.95, physCritChance + 0.25);
  const doCrit = wouldCrit || nextRand01(state) < physCritChance;
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
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effDef, divisor);
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) dmg = Math.floor(raw * 1.2);
  const nzm = _nuozhanOverflowMul(attacker); if (nzm > 1.0) dmg = Math.floor(dmg * nzm);
  const aff = calcElementAffinity(attacker, skill);
  if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
  if (defender.is_ally && defender.damage_reduction > 0)
    dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  dmg = _applyTaichuDamageAmp(attacker, defender, dmg);
  dmg = _applyDirectDamagePostEffects(state, attacker, defender, dmg, false, []);
  return { damage: dmg, isCrit: doCrit };
}

function clearUnitStatuses(unit) {
  let n = 0;
  if (unit.xurui?.active) { unit.xurui = { active: false, duration: 0 }; n++; }
  if (unit.yangjing?.active) { unit.yangjing = { active: false, duration: 0 }; n++; }
  if (unit.jingzhun?.active) { unit.jingzhun = { active: false, duration: 0 }; n++; }
  if (unit.zhuanzhu?.active) { unit.zhuanzhu = { active: false, duration: 0 }; n++; }
  if (unit.chengfeng) { unit.chengfeng = null; n++; }
  if (unit.jiangu) { unit.jiangu = null; n++; }
  return n;
}

/** 万圣龙王破（主目标风压按多击衰减；无视防御/不触发反击由调用方控制） */
function calcDamageWanshengLongwangPo(state, attacker, defender, skill, lv, opts = {}) {
  const eff = (skill.effects || []).find(x => String(x?.type || '') === 'wansheng_longwang_po');
  if (!eff) return { damage: 0, damagePerHit: [], windPressureCount: 0, isCrit: false, events: [] };
  const hitCoef = numVal(eff?.value, 0.25) + (lv > 1 ? (lv - 1) * numVal(eff?.coefficientBonus, 0.05) : 0);
  const hitCount = intVal(eff?.count, 4);
  const extraVal = numVal(eff?.extraHitValue, 0.85);
  const extraIgnore = numVal(eff?.extraIgnoreDefense, 0.4);
  const extraJuemai = intVal(eff?.extraJuemaiDuration, 2);
  const juemaiMin = intVal(eff?.extraJuemaiMinCleared, 3);
  const windIgnoreDefense = opts?.windIgnoreDefense !== false;
  const windNoCounter = opts?.windNoCounter !== false;
  const events = [];
  // 主目标风压：按标准多击衰减；是否无视防御由调用方决定
  const windRes = windIgnoreDefense
    ? calcDamage(state, attacker, defender, 'skill', hitCoef, false, skill, lv, { ignoreDefense: 1 })
    : calcDamage(state, attacker, defender, 'skill', hitCoef, false, skill, lv, {});
  const damagePerHit = [];
  const windDecay = attacker?.ex_weapon?.no_multi_hit_decay ? 1 : MULTI_HIT_DECAY;
  let oneWind = Math.max(0, intVal(windRes.damage, 0));
  for (let i = 0; i < hitCount; i++) {
    damagePerHit.push(oneWind);
    oneWind = Math.max(1, Math.floor(oneWind * windDecay));
  }
  const cleared = clearUnitStatuses(attacker);
  const extraOpts = {};
  if (cleared >= 2) extraOpts.ignoreDefense = extraIgnore;
  if (cleared >= 1) extraOpts.forceCrit = true;
  const extraRes = calcDamage(state, attacker, defender, 'skill', extraVal, false, skill, lv, extraOpts);
  damagePerHit.push(extraRes.damage);
  if (cleared >= juemaiMin) defender.juemai_rounds = Math.max(defender.juemai_rounds || 0, extraJuemai);
  const total = damagePerHit.reduce((a, b) => a + b, 0);
  events.push({ t: 'combat_log', actor: attacker.tag, target: defender.tag, action: 'wansheng', damage: total, text: `万圣龙王破！${hitCount}连击+终结，清除${cleared}个状态` });
  return { damage: total, damagePerHit, windPressureCount: windNoCounter ? hitCount : 0, isCrit: extraRes.isCrit, events };
}

/** damage_percent_plus_phys_def */
function calcDamagePercentPlusPhysDef(state, attacker, defender, eff, lv, skill) {
  const events = [];
  if (_isKurongNoDirect(attacker)) {
    return { damage: 0, isCrit: false, events };
  }
  const attackCoef = numVal(eff?.value, 1.0);
  const baseCoeff = (isPvpBattleMode(state?.battle_mode) && eff?.pvpPhysDefCoeff != null) ? numVal(eff.pvpPhysDefCoeff, 0.15) : numVal(eff?.physDefCoeff, 0.15);
  let physDefCoef = baseCoeff;
  physDefCoef += (lv - 1) * numVal(eff?.physDefCoeffPerLevel, 0.04);
  let physAttack;
  if (attacker.fear_rounds > 0) physAttack = attacker.min_attack;
  else if (attacker.xurui?.active) physAttack = attacker.max_attack;
  else physAttack = rollInt(state, attacker.min_attack, attacker.max_attack);
  const baseRaw = Math.max(1, Math.floor(physAttack * attackCoef + (attacker.defense || 0) * physDefCoef));
  let physCritChance = attacker.crit_rate || 0;
  if (attacker.jingzhun?.active) physCritChance = Math.min(0.95, physCritChance + 0.25);
  const isCrit = (attacker.nuozhan_rounds > 0) || nextRand01(state) < physCritChance;
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
  }
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effectiveDef, divisor);
  { const nzm = _nuozhanOverflowMul(attacker); if (nzm > 1.0) dmg = Math.floor(dmg * nzm); }
  const aff = calcElementAffinity(attacker, skill);
  if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
  if (defender.is_ally && defender.damage_reduction > 0) dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  dmg = _applyTaichuDamageAmp(attacker, defender, dmg);
  dmg = _applyDirectDamagePostEffects(state, attacker, defender, dmg, false, events);
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance)
    return { damage: 0, isCrit, events: [{ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore', text: `${defender.name} 无视了这次伤害！` }] };
  return { damage: dmg, isCrit, events };
}

/** damage_spell_phys_def_plus_self_hp_lost */
function calcDamageSpellPhysDefPlusSelfHpLost(state, attacker, defender, eff, lv, skill) {
  const events = [];
  const kurongNoDirect = _isKurongNoDirect(attacker);
  const shenguangAbsoluteSpell = !!attacker?.shenguang_spell_absolute;
  const shenguangRatio = clamp(numVal(attacker?.shenguang_spell_damage_ratio, 0.15), 0, 1);
  if (shenguangAbsoluteSpell && !attacker._shenguang_log_shown) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender?.tag || 'enemy', action: 'shenguang',
      text: `${attacker.name} 激发阵形·神光：法术伤害转为绝对伤害并降低至${Math.round(shenguangRatio * 100)}%` });
    attacker._shenguang_log_shown = true;
  }
  const selfHpPct = numVal(eff?.selfHpPercent, 0.13);
  const baseCoeff = (isPvpBattleMode(state?.battle_mode) && eff?.pvpPhysDefCoeff != null) ? numVal(eff.pvpPhysDefCoeff, 0.18) : numVal(eff?.physDefCoeff, 0.18);
  let physDefCoef = baseCoeff;
  physDefCoef += (lv - 1) * numVal(eff?.physDefCoeffPerLevel, 0.03);
  let selfDmgCoef = numVal(eff?.selfDmgCoeff, 0.20);
  selfDmgCoef += (lv - 1) * numVal(eff?.selfDmgCoeffPerLevel, 0.025);
  const selfDmg = Math.max(0, Math.floor(attacker.max_hp * selfHpPct));
  attacker.hp = Math.max(0, attacker.hp - selfDmg);
  events.push({ t: 'combat_log', actor: attacker.tag, target: attacker.tag, action: 'self_damage', damage: selfDmg, text: `${attacker.name} 自损了${selfDmg}点生命` });
  if (kurongNoDirect) {
    return { damage: 0, isCrit: false, events };
  }
  const baseRaw = Math.max(1, Math.floor((attacker.defense || 0) * physDefCoef + selfDmg * selfDmgCoef));
  let spellCritChance = (attacker.spell_crit_rate ?? attacker.crit_rate ?? 0);
  if (attacker.zhuanzhu?.active) spellCritChance = Math.min(0.95, spellCritChance + 0.25);
  const isCrit = (attacker.juechang_rounds > 0) || nextRand01(state) < spellCritChance;
  const critMul = isCrit ? (attacker.spell_crit_mult || 1.35) : 1.0;
  let raw = Math.floor(baseRaw * critMul);
  const flatDamage = _getFlatDamageBonus(attacker, true);
  if (flatDamage > 0) raw += flatDamage;
  const ignoreSpell = numVal(eff?.ignoreSpellDefense, 0.6);
  let effectiveDef = Math.floor((defender.spell_defense || 0) * (1.0 - clamp(ignoreSpell, 0, 1)));
  if (defender.beishui_rounds > 0 || attacker.beishui_rounds > 0) effectiveDef = 0;
  else {
    if (defender.hp_above_spell_def_bonus) {
      const hpR = numVal(defender.hp, 0) / Math.max(1, numVal(defender.max_hp, 1));
      if (hpR > defender.hp_above_spell_def_bonus.threshold) effectiveDef = Math.floor(effectiveDef * (1.0 + defender.hp_above_spell_def_bonus.value));
    }
    if (isCrit && numVal(attacker.spell_crit_ignore_spell_defense, 0) > 0) {
      effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_crit_ignore_spell_defense, 0, 0.9)));
    }
    if (!isCrit && numVal(attacker.spell_pen_on_noncrit, 0) > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_pen_on_noncrit, 0, 0.9)));
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (defender.jiangu) {
      const spellDefBase = Math.max(0, numVal(defender.spell_defense, defender.defense || 0));
      effectiveDef += Math.floor(spellDefBase * defender.jiangu.spellCoeff);
    }
  }
  if (shenguangAbsoluteSpell) effectiveDef = 0;
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effectiveDef, divisor);
  if (attacker.spell_final_damage_pct > 0) dmg = Math.floor(dmg * (1.0 + attacker.spell_final_damage_pct));
  if (attacker.hp_below_spell_final_dmg) {
    const hpR2 = numVal(attacker.hp, 0) / Math.max(1, numVal(attacker.max_hp, 1));
    if (hpR2 < attacker.hp_below_spell_final_dmg.threshold) dmg = Math.floor(dmg * (1.0 + attacker.hp_below_spell_final_dmg.value));
  }
  const aff3 = calcElementAffinity(attacker, skill);
  if (aff3 > 0) dmg = Math.floor(dmg * (1.0 + aff3 * 0.0065));
  if (!shenguangAbsoluteSpell && defender.is_ally && defender.damage_reduction > 0) dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  dmg = _applyTaichuDamageAmp(attacker, defender, dmg);
  dmg = _applyDirectDamagePostEffects(state, attacker, defender, dmg, true, events);
  if (shenguangAbsoluteSpell) {
    dmg = Math.max(1, Math.floor(dmg * shenguangRatio));
  }
  if (!shenguangAbsoluteSpell && defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag, target: defender.tag, action: 'ignore', text: `${defender.name} 无视了这次伤害！` });
    return { damage: 0, isCrit, events };
  }
  return { damage: dmg, isCrit, events };
}

/** damage_own_phys_def_percent：伤害 = 自身物理防御 × 系数（如以守为攻） */
function calcDamageOwnPhysDefPercent(state, attacker, defender, eff, lv, skill) {
  const events = [];
  if (_isKurongNoDirect(attacker)) {
    return { damage: 0, isCrit: false, events };
  }
  const baseVal = (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) ? numVal(eff.pvpValue, 0.6) : numVal(eff?.value, 0.6);
  let coeff = baseVal;
  if (lv > 1) coeff += (lv - 1) * numVal(eff?.coefficientBonus, 0);
  const ownPhysDef = _getOwnDefenseWithJiangu(attacker, false);
  const baseRaw = Math.max(1, Math.floor(ownPhysDef * coeff));
  let physCritChance = attacker.crit_rate || 0;
  if (attacker.jingzhun?.active) physCritChance = Math.min(0.95, physCritChance + 0.25);
  const isCrit = (attacker.nuozhan_rounds > 0) || nextRand01(state) < physCritChance;
  const critMul = isCrit ? (attacker.crit_mult || 1.5) : 1.0;
  let raw = Math.floor(baseRaw * critMul);
  const flatDamage = _getFlatDamageBonus(attacker, false);
  if (flatDamage > 0) raw += flatDamage;
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) raw = Math.floor(raw * 1.2);
  let effectiveDef = defender.defense || 0;
  if (defender.beishui_rounds > 0 || attacker.beishui_rounds > 0) effectiveDef = 0;
  else {
    const pen = numVal(attacker.armor_pen, 0);
    if (pen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(pen, 0, 0.9)));
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (defender.jiangu) effectiveDef += Math.floor(defender.defense * defender.jiangu.physCoeff);
  }
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effectiveDef, divisor);
  { const nzm = _nuozhanOverflowMul(attacker); if (nzm > 1.0) dmg = Math.floor(dmg * nzm); }
  const aff4 = calcElementAffinity(attacker, skill);
  if (aff4 > 0) dmg = Math.floor(dmg * (1.0 + aff4 * 0.0065));
  if (defender.is_ally && defender.damage_reduction > 0) dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  dmg = _applyTaichuDamageAmp(attacker, defender, dmg);
  dmg = _applyDirectDamagePostEffects(state, attacker, defender, dmg, false, events);
  if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag || 'player', target: defender.tag || 'player', action: 'ignore', text: `${defender.name} 无视了这次伤害！` });
    return { damage: 0, isCrit, events };
  }
  return { damage: dmg, isCrit, events };
}

/** damage_own_spell_def_percent：伤害 = 自身法术防御 × 系数（如千峰叠障） */
function calcDamageOwnSpellDefPercent(state, attacker, defender, eff, lv, skill) {
  const events = [];
  if (_isKurongNoDirect(attacker)) {
    return { damage: 0, isCrit: false, events };
  }
  const shenguangAbsoluteSpell = !!attacker?.shenguang_spell_absolute;
  const shenguangRatio = clamp(numVal(attacker?.shenguang_spell_damage_ratio, 0.15), 0, 1);
  if (shenguangAbsoluteSpell && !attacker._shenguang_log_shown) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender?.tag || 'enemy', action: 'shenguang',
      text: `${attacker.name} 激发阵形·神光：法术伤害转为绝对伤害并降低至${Math.round(shenguangRatio * 100)}%` });
    attacker._shenguang_log_shown = true;
  }
  const baseVal = (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) ? numVal(eff.pvpValue, 0.6) : numVal(eff?.value, 0.6);
  let coeff = baseVal;
  if (lv > 1) coeff += (lv - 1) * numVal(eff?.coefficientBonus, 0);
  const ownSpellDef = _getOwnDefenseWithJiangu(attacker, true);
  const baseRaw = Math.max(1, Math.floor(ownSpellDef * coeff));
  let spellCritChance2 = (attacker.spell_crit_rate ?? attacker.crit_rate ?? 0);
  if (attacker.zhuanzhu?.active) spellCritChance2 = Math.min(0.95, spellCritChance2 + 0.25);
  const isCrit = (attacker.juechang_rounds > 0) || nextRand01(state) < spellCritChance2;
  const critMul = isCrit ? (attacker.spell_crit_mult || 1.35) : 1.0;
  let raw = Math.floor(baseRaw * critMul);
  const flatDamage = _getFlatDamageBonus(attacker, true);
  if (flatDamage > 0) raw += flatDamage;
  if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) raw = Math.floor(raw * 1.2);
  let effectiveDef = defender.spell_defense || 0;
  if (defender.beishui_rounds > 0 || attacker.beishui_rounds > 0) effectiveDef = 0;
  else {
    if (Array.isArray(defender.debuffs) && !defender.perfect_earth) {
      const mj = defender.debuffs.find(db => db.type === 'jisheng' && db.mastery);
      if (mj) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(numVal(mj.mastery_spell_def_reduce, 0.5), 0, 0.9)));
    }
    if (defender.hp_above_spell_def_bonus) {
      const hpR = numVal(defender.hp, 0) / Math.max(1, numVal(defender.max_hp, 1));
      if (hpR > defender.hp_above_spell_def_bonus.threshold) effectiveDef = Math.floor(effectiveDef * (1.0 + defender.hp_above_spell_def_bonus.value));
    }
    const spen = numVal(attacker.spell_armor_pen, 0);
    if (spen > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(spen, 0, 0.9)));
    if (isCrit && numVal(attacker.spell_crit_ignore_spell_defense, 0) > 0) {
      effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_crit_ignore_spell_defense, 0, 0.9)));
    }
    if (!isCrit && numVal(attacker.spell_pen_on_noncrit, 0) > 0) effectiveDef = Math.floor(effectiveDef * (1.0 - clamp(attacker.spell_pen_on_noncrit, 0, 0.9)));
    if (defender.chuanxin_rounds > 0 && !defender.perfect_earth) effectiveDef = Math.floor(effectiveDef * 0.6);
    if (defender.jiangu) {
      const spellDefBase = Math.max(0, numVal(defender.spell_defense, defender.defense || 0));
      effectiveDef += Math.floor(spellDefBase * defender.jiangu.spellCoeff);
    }
  }
  if (shenguangAbsoluteSpell) effectiveDef = 0;
  const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
  let dmg = calcReducedDamage(raw, effectiveDef, divisor);
  if (attacker.spell_final_damage_pct > 0) dmg = Math.floor(dmg * (1.0 + attacker.spell_final_damage_pct));
  if (attacker.hp_below_spell_final_dmg) {
    const hpR2 = numVal(attacker.hp, 0) / Math.max(1, numVal(attacker.max_hp, 1));
    if (hpR2 < attacker.hp_below_spell_final_dmg.threshold) dmg = Math.floor(dmg * (1.0 + attacker.hp_below_spell_final_dmg.value));
  }
  const aff5 = calcElementAffinity(attacker, skill);
  if (aff5 > 0) dmg = Math.floor(dmg * (1.0 + aff5 * 0.0065));
  if (!shenguangAbsoluteSpell && defender.is_ally && defender.damage_reduction > 0) dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
  dmg = _applyTaichuDamageAmp(attacker, defender, dmg);
  dmg = _applyDirectDamagePostEffects(state, attacker, defender, dmg, true, events);
  if (shenguangAbsoluteSpell) {
    dmg = Math.max(1, Math.floor(dmg * shenguangRatio));
  }
  if (!shenguangAbsoluteSpell && defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
    events.push({ t: 'combat_log', actor: defender.tag || 'player', target: defender.tag || 'player', action: 'ignore', text: `${defender.name} 无视了这次伤害！` });
    return { damage: 0, isCrit, events };
  }
  return { damage: dmg, isCrit, events };
}

Object.assign(module.exports, {
  calcSkillMul: _calcSkillMul,
  collectSkillDamageHits,
  hasSkillEffect,
  calcDamage,
  expandMultiHitDamages,
  MULTI_HIT_DECAY,
  calcDamagePhysCritRange,
  calcDamagePercentPlusPhysDef,
  calcDamageSpellPhysDefPlusSelfHpLost,
  calcDamageOwnPhysDefPercent,
  calcDamageOwnSpellDefPercent,
  calcDamageWanshengLongwangPo,
  clearUnitStatuses,
  getBlossomExplodeInfo,
  clearBlossomDebuffs,
  getSkillById
});
