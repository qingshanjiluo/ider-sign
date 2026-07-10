const ATTR_NAMES = { strength:'力量', constitution:'体质', bone:'根骨', zhenyuan:'真元', lingli:'灵力', agility:'身法' };
const ELEMENT_NAMES = { metal:'金', wood:'木', water:'水', fire:'火', earth:'土' };
const DEBUFF_NAMES = { qingmo_poison:'青魔毒', bleed:'流血', bind:'缠缚', chanfu:'缠缚', fierce_poison:'猛毒', mengdu:'猛毒' };
const BUFF_NAMES = {
  weapon_damage_pct:'武器伤害', phys_crit_rate_pct:'物理暴击率', phys_lifesteal_pct:'物理吸血',
  spell_damage_pct:'法术伤害', speed_bonus_pct:'速度', drop_rate_pct:'掉落率',
  exp_gain_pct:'经验加成', damage_reduction_pct:'伤害减免', spell_crit_rate_pct:'法术暴击率',
};
const p = (v, d=0) => Math.round((v || d) * 100);
// 功法效果：按等级计算总值 total = value + (level-1)*(levelBonus||coefficientBonus)
function techVal(e, level = 1) {
  const lv = Math.max(1, level || 1);
  const val = Number(e?.value ?? 0);
  const lb = Number(e?.levelBonus ?? 0);
  const cb = Number(e?.coefficientBonus ?? 0);
  const bonus = lb || cb;
  return lv > 1 && bonus ? val + (lv - 1) * bonus : val;
}

export function fmtSkillEffect(e, level = 1) {
  if (!e || !e.type) return '';
  const t = e.type;
  const lv = Math.max(1, level || 1);
  const lvVal = (base, bonus) => base + (lv > 1 ? (lv - 1) * (bonus || 0) : 0);
  const dur = (e) => {
    const base = e.duration ?? e.rounds ?? 2;
    const perLv = e.durationPerLevel ?? 0;
    return base + (lv > 1 ? (lv - 1) * perLv : 0);
  };
  if (t === 'damage_percent') { const v = lvVal(e.value, e.coefficientBonus ?? e.levelBonus); return `造成${p(v)}%伤害`; }
  if (t === 'player_hp_percent') { const v = lvVal(e.value, e.coefficientBonus ?? e.levelBonus); return `恢复法攻${p(v)}%生命`; }
  if (t === 'damage_percent_range') {
    const cb = e.coefficientBonus ?? e.levelBonus ?? 0;
    const mn = lvVal(e.minValue ?? 0.8, cb); const mx = lvVal(e.maxValue ?? 1.2, cb);
    let s = `造成${p(mn)}%~${p(mx)}%伤害`; if (e.ignoreSpellDefPercent || e.ignoreSpellDefense) s += `（无视${p(e.ignoreSpellDefPercent ?? e.ignoreSpellDefense)}%法防）`; return s;
  }
  if (t === 'damage_percent_range_multi') {
    const cb = e.coefficientBonus ?? e.levelBonus ?? 0;
    const mn = lvVal(e.minValue ?? 0.77, cb); const mx = lvVal(e.maxValue ?? 0.77, cb);
    const cnt = e.count || e.hitCount || 2;
    return mn === mx ? `造成${p(mn)}%伤害 x${cnt}次` : `造成${p(mn)}%~${p(mx)}%伤害 x${cnt}次`;
  }
  if (t === 'damage_percent_plus_agility_multi') {
    const atk = lvVal(e.value ?? 0.25, e.coefficientBonus ?? 0);
    const agi = lvVal(e.agilityCoeff ?? 0.15, e.agilityCoeffPerLevel ?? 0.02);
    const cnt = e.count || 3;
    const growth = Math.round(((e.perHitGrowth ?? 0.1) * 100));
    return `造成（物攻${p(atk)}%+身法${p(agi)}%）物理伤害 x${cnt}次（每击递增${growth}%）`;
  }
  if (t === 'damage_percent_range_physical_crit') {
    const cb = e.coefficientBonus ?? e.levelBonus ?? 0;
    return `造成${p(lvVal(e.minValue,cb))}%~${p(lvVal(e.maxValue,cb))}%物理暴击范围伤害`;
  }
  if (t === 'damage_dual_physical_then_magic') {
    const cb = e.coefficientBonus ?? e.levelBonus ?? 0;
    const mn = e.physMin ?? e.minValue ?? 0.77;
    const mx = e.physMax ?? e.maxValue ?? 0.99;
    const sMn = e.spellMin ?? e.minValue ?? 0.77;
    const sMx = e.spellMax ?? e.maxValue ?? 0.99;
    return `先物理${p(lvVal(mn,cb))}%~${p(lvVal(mx,cb))}%再法术${p(lvVal(sMn,cb))}%~${p(lvVal(sMx,cb))}%`;
  }
  if (t === 'damage_percent_plus_phys_def') {
    const defCoeff = e.physDefCoeff ?? e.physDefPercent ?? 0;
    const defPerLv = e.physDefCoeffPerLevel ?? 0;
    return `造成攻击力${p(e.value)}%+物防${p(lvVal(defCoeff,defPerLv))}%物理伤害`;
  }
  if (t === 'damage_own_phys_def_percent') { const cb = e.coefficientBonus ?? e.levelBonus ?? 0; return `造成自身物防${p(lvVal(e.value,cb))}%物理伤害`; }
  if (t === 'damage_own_spell_def_percent') { const cb = e.coefficientBonus ?? e.levelBonus ?? 0; return `造成自身法防${p(lvVal(e.value,cb))}%法术伤害`; }
  if (t === 'heal_max_hp_percent') { const v = lvVal(e.value, e.coefficientBonus ?? e.levelBonus); return `恢复最大生命${p(v)}%`; }
  if (t === 'enemy_self_damage_max_hp_percent') return `目标自损${p(e.value)}%最大生命`;
  if (t === 'clear_other_skill_cooldowns') return '清除其他技能冷却';
  if (t === 'clear_target_buffs') return '清除目标所有正面状态';
  if (t === 'apply_debuff') {
    const name = DEBUFF_NAMES[e.debuffType] || e.debuffType;
    const stacks = e.stacks || 1;
    const dmgPct = e.damagePercent ?? 0;
    const dmgPerLv = e.damagePercentPerLevel ?? e.coefficientBonus ?? 0;
    const dmgVal = dmgPct > 0 ? lvVal(dmgPct, dmgPerLv) : 0;
    let s = `施加${name} ${stacks}次行动`;
    if (dmgVal > 0) s += `（${p(dmgVal)}%伤害/次）`;
    return s;
  }
  if (t === 'apply_slow') return `迟缓${dur(e)}轮，速度降至${p(e.speedMultiplier)}%`;
  if (t === 'apply_chuanxin') return `穿心${dur(e)}轮，防御-40%`;
  if (t === 'apply_fear') return `恐惧${dur(e)}轮`;
  if (t === 'apply_juemai') return `绝脉${dur(e)}轮`;
  if (t === 'apply_fumo') return `伏魔${dur(e)}轮`;
  if (t === 'apply_stasis') return `凝滞${e.duration ?? e.rounds ?? 1}轮`;
  if (t === 'apply_nuozhan_self') return `搦战（物理必暴）${dur(e)}轮`;
  if (t === 'apply_juechang_self') return `绝唱（法术必暴）${dur(e)}轮`;
  if (t === 'apply_jiangu_self') {
    const d = dur(e);
    const physDef = lvVal(e.physCoeff ?? e.physDefBonus ?? 0.15, e.physCoeffPerLevel ?? 0);
    const spellDef = lvVal(e.spellCoeff ?? e.spellDefBonus ?? 0.075, e.spellCoeffPerLevel ?? 0);
    return `坚固${d}轮，物防+${p(physDef)}%，法防+${p(spellDef)}%`;
  }
  if (t === 'apply_bofa_self') return `勃发${dur(e)}轮`;
  if (t === 'apply_chengfeng_self') return `乘风${dur(e)}轮，速度+${p(e.speedBonus)}%`;
  if (t === 'apply_yangjing_self') return `养精（法术取最大值）${dur(e)}轮`;
  if (t === 'apply_xurui_self') return `蓄锐（物理取最大值）${dur(e)}轮`;
  if (t === 'apply_jingzhun_self') return `精准（物理暴击率+25%）${dur(e)}轮`;
  if (t === 'apply_zhuanzhu_self') return `专注（法术暴击率+25%）${dur(e)}轮`;
  if (t === 'apply_beishui_self') return `背水${dur(e)}轮`;
  if (t === 'apply_daifa_self') return `待发${dur(e)}轮`;
  if (t === 'apply_mark_self') return `标记自身${dur(e)}轮`;
  if (t === 'apply_mark_target') return `标记目标${dur(e)}轮`;
  if (t === 'apply_kuiran') return `岿然${e.duration ?? 2}轮（物防+${p(e.physCoeff ?? 0.5)}%，法防+${p(e.spellCoeff ?? 0.5)}%）`;
  if (t === 'apply_zhuohun') return `灼魂${dur(e)}轮（受到的治疗效率-${p(e.healReduction ?? 0.4)}%）`;
  if (t === 'apply_wenluan') {
    const base = e.duration ?? 2;
    const pvpPart = e.pvpDuration != null ? `，PVP ${e.pvpDuration}轮` : '';
    return `施加紊乱${base}轮${pvpPart}（造成的回复反噬为${p(e.ratio ?? 0.5)}%伤害）`;
  }
  if (t === 'deal_target_current_hp_true_damage') {
    const pvpPart = e.pvpValue != null ? `（PVP ${p(e.pvpValue)}%）` : '';
    return `造成目标当前生命${p(e.value ?? 0.25)}%的绝对伤害${pvpPart}`;
  }
  if (t === 'deal_target_lost_hp_true_damage') {
    const pvpPart = e.pvpValue != null ? `（PVP ${p(e.pvpValue)}%）` : '';
    return `造成目标已损失生命${p(e.value ?? 0.25)}%的绝对伤害${pvpPart}`;
  }
  if (t === 'deal_self_current_hp_physical_damage') {
    const pvpPart = e.pvpValue != null ? `（PVP ${p(e.pvpValue)}%）` : '';
    return `造成自身当前生命${p(e.value ?? 0.25)}%的物理伤害${pvpPart}`;
  }
  if (t === 'deal_self_current_mp_spell_damage') {
    const pvpPart = e.pvpValue != null ? `（PVP ${p(e.pvpValue)}%）` : '';
    return `造成自身当前法力${p(e.value ?? 0.25)}%的法术伤害${pvpPart}`;
  }
  if (t === 'apply_zhendang') return `震荡${dur(e)}轮（法攻和法防-${p(e.reductionPercent ?? 0.3)}%）`;
  if (t === 'yinyang_toggle') return '阴阳交替：阴-无视40%法术防御；阳-必定暴击';
  if (t === 'mimic_opponent_skill') { const cb = e.coefficientBonus ?? e.levelBonus ?? 0; return `模仿对手技能，伤害+${p(lvVal(e.bonusDamagePercent ?? e.damageBonus ?? 0, cb))}%`; }
  if (t === 'blossom') {
    const cb = e.coefficientBonus ?? e.levelBonus ?? 0;
    return `物攻${p(lvVal(e.physPercent,cb))}%+法攻${p(lvVal(e.spellPercent,cb))}%，引爆持续伤害每种+${p(e.bonusPerDotType ?? e.dotBonusPercent)}%`;
  }
  if (t === 'damage_spell_phys_def_plus_self_hp_lost') {
    const selfHp = e.selfHpPercent ?? e.selfHpLostPercent ?? 0;
    const defCoeff = e.physDefCoeff ?? e.physDefPercent ?? 0;
    const defPerLv = e.physDefCoeffPerLevel ?? 0;
    const dmgCoeff = e.selfDmgCoeff ?? e.lostHpDamagePercent ?? 0;
    const dmgPerLv = e.selfDmgCoeffPerLevel ?? 0;
    let s = `自损${p(selfHp)}%生命，物防${p(lvVal(defCoeff,defPerLv))}%+自损${p(lvVal(dmgCoeff,dmgPerLv))}%法术伤害`;
    if (e.ignoreSpellDefense) s += `（无视${p(e.ignoreSpellDefense)}%法防）`;
    return s;
  }
  if (t === 'wansheng_longwang_po') {
    const cb = e.coefficientBonus ?? 0;
    const windVal = lvVal(e.value, cb);
    const extraVal = lvVal(e.extraHitValue ?? 0.85, cb);
    return `${e.count||4}次${p(windVal)}%风压（无衰减、无视防御、不触发反击），终结${p(extraVal)}%`;
  }
  if (t === 'apply_hunchong') return e.target === 'self_or_ally' ? '自身或友方获得缓冲（抵消一次伤害）' : '获得缓冲（抵消一次伤害）';
  if (t === 'apply_team_hunchong') return '全队获得缓冲（抵消一次伤害）';
  if (t === 'gain_temp_shield_max_hp_percent') {
    const v = lvVal(e.value ?? 0, e.coefficientBonus ?? e.levelBonus);
    const pvp = e.pvpValue != null ? `（PVP ${p(e.pvpValue)}%）` : '';
    return `获得最大生命${p(v)}%的临时护盾${pvp}`;
  }
  if (t === 'self_sacrifice_damage') {
    const ratio = p(e.hpReduceRatio ?? 0.5);
    const val = p(e.value ?? 1.65);
    return `自损当前生命${ratio}%，造成扣血量${val}%绝对伤害`;
  }
  if (t === 'heal_phys_attack_percent') {
    const v = lvVal(e.value, e.coefficientBonus ?? e.levelBonus);
    return e.targetMode === 'self_or_lowest_ally' ? `恢复物攻${p(v)}%生命（副本/PVP选最低血友方）` : `恢复物攻${p(v)}%生命`;
  }
  if (t === 'heal_team_max_hp_percent') {
    const v = lvVal(e.value, e.coefficientBonus ?? e.levelBonus);
    const pvp = e.pvpValue != null ? `，PVP ${p(e.pvpValue)}%` : '';
    return `全队恢复最大生命${p(v)}%${pvp}`;
  }
  if (t === 'apply_jianxin_self') return '剑心状态（物法互追）';
  return t.replace(/_/g, ' ');
}

export function fmtTechEffect(e, level = 1) {
  if (!e || !e.type) return '';
  const t = e.type;
  const v = () => techVal(e, level);
  if (t === 'physical_armor_pen') return `物理穿透+${Math.round(v() * 100)}%`;
  if (t === 'spell_armor_pen') return `法术穿透+${Math.round(v() * 100)}%`;
  if (t === 'spell_final_damage_percent') return `法术最终伤害+${Math.round(v() * 100)}%`;
  if (t === 'phys_damage_lifesteal') return `物理吸血+${(v() * 100).toFixed(1)}%`;
  if (t === 'phys_crit_damage_bonus') return `物理暴伤+${Math.round(v() * 100)}%`;
  if (t === 'phys_crit_rate_bonus') return `物理暴击率+${Math.round(v() * 100)}%`;
  if (t === 'direct_damage_ignore_chance') return `直伤豁免${Math.round(v() * 100)}%`;
  if (t === 'defense_divisor_reduction') return `防御除数降低${Math.round(v())}点`;
  if (t === 'defense_bonus_percent') return `防御+${Math.round(v() * 100)}%`;
  if (t === 'basic_attack_as_spell') {
    const cb = Number(e.coefficientBonus ?? 0);
    const mn = (Number(e.minValue ?? 1.05) + cb * (level - 1)) * 100;
    const mx = (Number(e.maxValue ?? 1.2) + cb * (level - 1)) * 100;
    return cb ? `普攻视为法术${Math.round(mn)}%~${Math.round(mx)}%` + `（每级+${Math.round(cb * 100)}%）` : `普攻视为法术${Math.round(mn)}%~${Math.round(mx)}%`;
  }
  if (t === 'turn_end_mp') return `回合末回复法力+${Math.floor((e.value || 0) * Math.pow(2, level - 1))}`;
  if (t === 'turn_end_hp_mp') return `回合末回复生命${p(e.hpPercent)}%法力${p(e.mpPercent)}%`;
  if (t === 'battle_victory_heal') return `胜利恢复生命+${v()}`;
  if (t === 'damage_heal') return `受伤转治疗${Math.round(v() * 100)}%`;
  if (t === 'heal_damage') return `治疗转伤害${Math.round(v() * 100)}%`;
  if (t === 'on_direct_damage_counter') {
    const ch = (Number(e.chance || 0) + (level > 1 ? (level - 1) * Number(e.chancePerLevel || 0) : 0)) * 100;
    const coeff = (Number((e.damageCoeff ?? e.coefficient) || 0) + (level > 1 ? (level - 1) * Number(e.damageCoeffPerLevel || 0) : 0)) * 100;
    return `受直伤反击${Math.round(ch)}%概率，伤害系数${Math.round(coeff)}%`;
  }
  if (t === 'on_phys_damage_stasis' || t === 'on_direct_damage_stasis') {
    const stasisCh = (Number(e.chance || 0) + (level > 1 ? (level - 1) * Number(e.levelBonus || 0) : 0)) * 100;
    return `造成直接伤害施加凝滞${Math.round(stasisCh)}%`;
  }
  if (t === 'on_deal_damage_mana_burn') {
    const pve = Number(e.value ?? e.mpBurnPct ?? 0) + (level > 1 ? (level - 1) * Number(e.levelBonus || 0) : 0);
    const pvp = Number(e.pvpValue ?? e.pvpMpBurnPct ?? pve) + (level > 1 ? (level - 1) * Number(e.pvpLevelBonus || e.levelBonus || 0) : 0);
    return `造成伤害时削减目标法力${Math.round(pve * 100)}%并追加等量绝伤（PVP: ${Math.round(pvp * 100)}%并追加等量法伤）`;
  }
  if (t === 'on_basic_attack_apply_jisheng') return `普攻施加寄生${e.rounds || 2}轮`;
  if (t === 'on_direct_damage_apply_jisheng') return `直伤施加寄生${e.rounds || 2}轮`;
  if (t.includes('weapon_spell_attack_bonus')) return `${e.weaponType || ''}武器法攻+${Math.round((v() - 1) * 100)}%`;
  if (t.includes('weapon_physical_attack_bonus')) return `${e.weaponType || ''}武器物攻+${Math.round((v() - 1) * 100)}%`;
  if (t === 'spell_crit_ignore_spell_defense') return `法术暴击无视${Math.round(v() * 100)}%法防`;
  if (t === 'phys_damage_equalize') return '物理伤害取固定值（无浮动）';
  if (t === 'align_phys_spell_attack') return '物攻与法攻对齐至较高一方';
  if (t === 'phys_attack_multiplier') return `物理攻击力×${v()}${e.whenTeam ? '（组队）' : ''}`;
  if (t === 'heal_amplification') return `治疗效果+${Math.round(v() * 100)}%${e.whenTeam ? '（组队）' : ''}`;
  if (t === 'earth_damage_reduction_per_point_bonus') return `土灵根每点减伤+${(v() * 10000).toFixed(2)}%`;
  if (t === 'wood_debuff_resistance_per_point_bonus') return `木灵根每点减益抗性+${(v() * 10000).toFixed(2)}%`;
  if (t === 'fire_spell_damage_per_point_bonus') return `火灵根每点法术伤害+${(v() * 10000).toFixed(2)}%`;
  if (t === 'hp_above_spell_defense_bonus') return `生命>${p((e.threshold ?? 0.5))}%时法防+${Math.round(v() * 100)}%`;
  if (t === 'hp_below_spell_final_damage_bonus') return `生命<${p((e.threshold ?? 0.5))}%时法术最终伤害+${Math.round(v() * 100)}%`;
  if (t === 'spell_pen_on_noncrit') return `非暴击时法术穿透+${Math.round(v() * 100)}%`;
  if (t === 'heal_others_self_heal') return `治疗他人时自身获得该治疗${Math.round(v() * 100)}%`;
  if (t === 'boost_higher_of_strength_lingli_by_higher_of_constitution_zhenyuan') {
    return `力量/灵力较高者提高（体魄/真元较高者的${Math.round(v() * 100)}%）`;
  }
  return t.replace(/_/g, ' ');
}

export function fmtTechPassive(e, level = 1) {
  if (!e || !e.type) return '';
  const t = e.type;
  const val = Number(e?.value ?? 0);
  if (t.endsWith('_spirit_root')) { const el = t.replace('_spirit_root',''); return `${ELEMENT_NAMES[el]||el}灵根+${val * level}（每级+${val}）`; }
  if (ATTR_NAMES[t]) return `${ATTR_NAMES[t]}+${val * level}（每级+${val}）`;
  if (t === 'spell_crit_rate_bonus') return `法术暴击率+${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'defense_bonus_percent') return `防御+${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'zhenyuan_to_spell_attack_percent') return `真元转法攻+${(techVal(e, level) * 100).toFixed(2)}%/点`;
  if (t === 'jisheng_dot_mastery') return `寄生精通：持续伤害+${p(e.dotBonusPercent)}%`;
  if (t === 'heal_others_self_heal') return `治疗他人时自身获得该治疗${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'earth_damage_reduction_per_point_bonus') return `土灵根每点减伤+${(techVal(e, level) * 10000).toFixed(2)}%`;
  if (t === 'wood_debuff_resistance_per_point_bonus') return `木灵根每点减益抗性+${(techVal(e, level) * 10000).toFixed(2)}%`;
  if (t === 'fire_spell_damage_per_point_bonus') return `火灵根每点法术伤害+${(techVal(e, level) * 10000).toFixed(2)}%`;
  if (t === 'hp_above_spell_defense_bonus') return `生命>${p((e.threshold ?? 0.5))}%时法防+${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'hp_below_spell_final_damage_bonus') return `生命<${p((e.threshold ?? 0.5))}%时法术最终伤害+${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'spell_pen_on_noncrit') return `非暴击时法术穿透+${Math.round(techVal(e, level) * 100)}%`;
  if (t === 'spell_crit_ignore_spell_defense') return `法术暴击无视${Math.round(techVal(e, level) * 100)}%法防`;
  if (t === 'phys_damage_equalize') return '物理伤害取固定值（无浮动）';
  if (t === 'align_phys_spell_attack') return '物攻与法攻对齐至较高一方';
  if (t.includes('weapon_')) return fmtTechEffect(e, level);
  return t.replace(/_/g, ' ');
}

export function fmtItemEffect(e, getItem) {
  if (!e || !e.type) return '';
  const t = e.type;
  if (t === 'player_exp') return `增加${e.value||0}点经验`;
  if (t === 'learn_technique') return '使用后学习功法';
  if (t === 'learn_skill') return '使用后学习技能';
  if (t === 'learn_recipe') return `学习配方`;
  if (t === 'random_stat_down') return `随机降低属性${e.value||1}点`;
  if (t === 'random_stat_permanent_boost') return `随机永久属性+${e.value||1}（上限${e.maxValue||999}）`;
  if (t === 'spirit_root_permanent_boost') { const el = ELEMENT_NAMES[e.rootType] || e.rootType || '?'; return `${el}灵根永久+${e.value||1}（上限${e.maxValue||999}）`; }
  if (t === 'random_spirit_root_permanent_boost') return `随机灵根永久+${e.value||1}（上限${e.maxValue||999}）`;
  if (t === 'heal_max_hp_percent') return `恢复最大生命${p(e.value)}%`;
  if (t === 'heal_max_mp_percent') return `恢复最大法力${p(e.value)}%`;
  if (t === 'stat_permanent_boost') return `${ATTR_NAMES[e.stat]||e.stat||'属性'}永久+${e.value||1}（上限${e.maxValue||999}）`;
  if (t === 'timed_buff') return `${BUFF_NAMES[e.buffType]||e.buffType}+${p(e.value)}% 持续${e.duration||0}秒`;
  if (t.startsWith('battle_start_')) {
    if (t.includes('slow')) return `开战使敌方迟缓`;
    if (t.includes('xurui')) return `开战使己方蓄锐`;
    if (t.includes('hp_max')) return `开战使己方生命+${p(e.value)}%`;
    if (t.includes('chanfu')) return `开战使敌方缠缚`;
    if (t.includes('fireball')) return `开战释放火球术`;
    return `开战效果: ${t.replace(/_/g, ' ')}`;
  }
  return t.replace(/_/g, ' ');
}

export function fmtSkillFull(skill) {
  if (!skill) return '';
  const parts = [];
  if (skill.attribute && skill.attribute !== '无') parts.push(`属性: ${skill.attribute}`);
  if (skill.mpCost) parts.push(`法力消耗: ${skill.mpCost}`);
  if (skill.cooldown) parts.push(`冷却: ${skill.cooldown}轮`);
  if (skill.damageType) {
    const dmgNames = { physical:'物理', magic:'法术', hybrid:'物理/法术', none:'无' };
    parts.push(`伤害类型: ${dmgNames[skill.damageType] || skill.damageType}`);
  }
  if (skill.effects?.length) parts.push('效果: ' + skill.effects.map(e => fmtSkillEffect(e, skill.level || 1)).filter(Boolean).join('；'));
  return parts.join('\n');
}

export function fmtTechFull(tech) {
  if (!tech) return '';
  const lv = tech.level || 1;
  const parts = [];
  if (tech.attribute && tech.attribute !== '无') parts.push(`属性: ${tech.attribute}`);
  if (tech.effects?.length) parts.push('装配效果: ' + tech.effects.map(e => fmtTechEffect(e, lv)).filter(Boolean).join('；'));
  if (tech.passiveEffects?.length) parts.push('被动效果: ' + tech.passiveEffects.map(e => fmtTechPassive(e, lv)).filter(Boolean).join('；'));
  if (tech.skillUnlocks?.length) parts.push('解锁技能: ' + tech.skillUnlocks.map(u => `${u.level}重解锁`).join('，'));
  return parts.join('\n');
}

const AFFIX_STAT_NAMES = {
  strength:'力量', constitution:'体质', bone:'根骨', agility:'身法', zhenyuan:'真元', lingli:'灵力',
  turn_end_mp:'回法', phys_crit_rate_bonus:'物暴', spell_crit_rate_bonus:'法暴',
  phys_crit_damage_bonus:'物暴伤', spell_crit_damage_bonus:'法暴伤',
  phys_lifesteal_pct:'物吸血', spell_lifesteal_pct:'法吸血',
  phys_damage_pct:'物伤', spell_damage_pct:'法伤',
  phys_flat_damage:'物攻', spell_flat_damage:'法攻',
  phys_defense_pct:'物防%', spell_defense_pct:'法防%',
  phys_defense_flat:'点物防', spell_defense_flat:'点法防',
  phys_splash_pct:'物溅射', spell_splash_pct:'法溅射'
};
export function fmtAffix(af) {
  if (!af) return '';
  const statLabel = AFFIX_STAT_NAMES[af.stat] || (af.stat || '').replace(/_/g, ' ');
  const affixName = af.name || statLabel;
  let valueText = af.value;
  if (['phys_lifesteal_pct','spell_lifesteal_pct','phys_splash_pct','spell_splash_pct'].includes(af.stat)) {
    valueText = (Number(af.value || 0) / 10).toFixed(1) + '%';
  } else if (['phys_damage_pct','spell_damage_pct','phys_defense_pct','spell_defense_pct'].includes(af.stat)) {
    valueText = Math.floor(Number(af.value || 0)) + '%';
  }
  let s = statLabel + (af.value != null ? ` +${valueText}` : '');
  const qPart = (af.quality != null || af.tier != null) ? `Q${af.quality || 1}/T${af.tier || 1}` : '';
  if (affixName !== statLabel || qPart) s += `（${affixName}${qPart ? ' ' + qPart : ''}）`;
  return s;
}

export function fmtItemFull(item, getItem) {
  if (!item) return '';
  const parts = [];
  if (item.effects?.length) parts.push(item.effects.map(e => fmtItemEffect(e, getItem)).filter(Boolean).join('；'));
  return parts.join('\n');
}

// 装备详情（与 Godot tooltip_formatters 一致）
const EQUIP_TYPE_NAMES = { weapon:'武器', head:'头冠', shoulder:'肩部', chest:'胸甲', legs:'腿部', hands:'手部', ring:'戒指', amulet:'护符', back:'背部' };
const ITEM_STAT_NAMES = {
  minAttack:'最小攻击', maxAttack:'最大攻击', minSpellAttack:'最小法攻', maxSpellAttack:'最大法攻',
  physDefense:'物防', spellDefense:'法防', maxHp:'生命', maxMp:'法力',
  strength:'力量', constitution:'体魄', bone:'根骨', agility:'敏捷', zhenyuan:'真元', lingli:'灵力',
  turn_end_mp:'回法', phys_crit_rate_bonus:'物理暴击率增加', spell_crit_rate_bonus:'法术暴击率增加',
  phys_crit_damage_bonus:'物理暴伤增加', spell_crit_damage_bonus:'法术暴伤增加',
  phys_lifesteal_pct:'物理吸血', spell_lifesteal_pct:'法术吸血',
  phys_damage_pct:'物理攻击力提高%', spell_damage_pct:'法术攻击力提高%',
  phys_flat_damage:'物理攻击力增加', spell_flat_damage:'法术攻击力增加',
  phys_defense_pct:'物理防御增加%', spell_defense_pct:'法术防御增加%',
  phys_defense_flat:'点数物防', spell_defense_flat:'点数法防',
  phys_splash_pct:'物理伤害溅射%', spell_splash_pct:'法术伤害溅射%'
};
const SET_EFFECTS = {
  '劫灭-斗战乾坤': [
    '3件: 物理暴击率+15%',
    '5件: 决意 — 每行动3次获得1层决意，受到控制效果时消耗决意层数抵消等量轮次',
    '8件: 仅物理暴击时获得1轮蓄锐（治疗不再触发；回合末递减机制下实战覆盖两轮）'
  ],
  '道妙-气象万千': [
    '3件: 每次造成伤害后随机获得一种气象（共7种）',
    '5件: 每层气象使对应元素属性亲和+7',
    '8件: 气象集满5层获得道妙（全属性亲和+7，含混元/无，总计+49）'
  ],
  '浩渺-云上青鸾': [
    '3件: 每轮回复5%最大生命值；一次战斗中免疫一次致命伤害（保留1点血）',
    '5件: 3件效果的回复等额转化为对敌方的绝对伤害',
    '8件: 己方施加的持续伤害（DoT）持续轮次+1'
  ],
  '厉火-焚天炽地': [
    '3件: 造成伤害后获得1轮灼烧（回合结束受到自身随机属性25%~55%的绝对伤害）',
    '5件: 灼烧状态下造成伤害时吸血15%（恢复造成伤害的15%为生命）',
    '8件: 生命低于50%时获得焚烬（同时拥有乘风+养精+蓄锐效果）'
  ],
  '玄黄-永生不灭': [
    '3件: 受到直接伤害时50%概率获得3轮土盾（减伤22%）',
    '5件: 受击反弹伤害（无土盾反弹10%，有土盾反弹30%）',
    '8件: 战斗开始双方均获得迟缓（速度降至70%），持续整场战斗'
  ],
  '异界-终结热寂': [
    '3件: 每次行动结束后对敌方叠1层降温',
    '5件: 改为每次造成伤害时叠降温（多段伤害每段各叠1层）',
    '8件: 仅8件可将5层降温转为凝滞并叠1层冻伤；冻伤叠满4层时野外非Boss直接终结'
  ],
  '太初-浑天无极': [
    '3件: 每次行动结束后，清除自身1种负面状态（被凝滞跳过不视为行动）',
    '5件: 对带有负面状态的目标造成伤害时，每种负面使最终伤害提高6%',
    '8件: 受击时将最终伤害的20%转为业力并不再扣血；当业力超过当前生命时立即死亡'
  ]
};
const EX_WEAPON_EFFECTS = {
  '伏羲琴': '绝唱状态额外持续1轮；法术暴击伤害+12%',
  '万古愁': '音律法术每次造成伤害时，随机附加一种负面效果（迟缓/绝脉/恐惧/缠缚/灼魂/寄生），多段伤害每段各触发',
  '镇魂牙': '特效：木属性亲和+25',
  '危月煞': '防御减伤除数降低1000；自身物理防御+10%，法术防御+10%',
  '万法皆空': '造成伤害后25%概率清除目标正面状态，每清除一种造成最高攻击力35%的绝对伤害',
  '罪业一炬': '造成物理伤害时额外施加穿心1轮（防御-40%）；若目标已有穿心，改为造成物攻20%×剩余轮数的直接伤害',
  '荒': '蓄力期间可行动，此时造成伤害降低50%；非蓄力技能+12%法术穿透',
  '春秋': '造成伤害后回复伤害量12%的生命；每次造成伤害时额外造成自身最大生命值3%的附加伤害',
  '蛮': '蓄力技能可立即释放；该次蓄力技能伤害降低50%；若击杀目标则重置该技能冷却',
  '神鬼踏歌': '法术直伤对其余敌人造成25%-35%溅射；若无可溅射目标，本次法术最终伤害+13%',
  '十方天华': '造成的所有伤害均为自适应伤害（按目标较低防御自动判定为物理或法术伤害）',
  '天涯路': '物理暴击率+10%，且多击技能不再衰减',
  '恨别离': '使用绽放引爆DOT后，按引爆DOT种类数触发离恨回响：每种造成[(物攻上限+法攻)/2]×8%直接伤害；PVP为65%系数；团战对其余敌方额外造成40%余响',
  '苍生笔': '仅非PVP生效：带伤害的治疗技能放弃治疗，改为追加已损生命18%诛邪伤害；13%血线以下直接斩灭',
  '飞光': '反击伤害提高25%；PVP模式下反击伤害提高15%'
};
function getRequiredLevel(item) {
  const lv = item.required_level ?? item.requiredLevel;
  if (lv != null) return Number(lv);
  const q = Math.max(1, Number(item.quality) || 1);
  return q * 40 + 10;
}
export function fmtEquipmentDetail(item, getItem) {
  if (!item) return [];
  const hasEquipType = ['weapon','head','shoulder','chest','legs','hands','ring','amulet','back','equipment'].includes(String(item.type || ''));
  const hasStats = item.stats && Object.keys(item.stats).length > 0;
  if (!hasEquipType && !hasStats) return [];
  const lines = [];
  if (item.description) lines.push({ t: 'desc', text: item.description });
  if (item.flavor) lines.push({ t: 'flavor', text: item.flavor });
  const t = String(item.type || '');
  if (EQUIP_TYPE_NAMES[t]) lines.push({ t: 'prop', label: '类型', text: EQUIP_TYPE_NAMES[t] });
  if (item.subtype) lines.push({ t: 'prop', label: '子类型', text: item.subtype });
  if (item.material) lines.push({ t: 'prop', label: '材质', text: item.material });
  if (item.element) lines.push({ t: 'prop', label: '元素', text: item.element });
  const q = Math.max(1, Number(item.quality) || 1);
  lines.push({ t: 'prop', label: '品质', text: q + '阶' });
  if (['weapon','head','shoulder','chest','legs','hands','ring','amulet','back'].includes(t)) {
    lines.push({ t: 'prop', label: '等级需求', text: 'Lv.' + getRequiredLevel(item) });
  }
  const stats = item.stats || {};
  const affixes = item.affixes || [];
  const affixMap = {};
  for (const a of affixes) {
    const k = String(a.stat || '');
    if (k) affixMap[k] = a;
  }
  const statLines = [];
  for (const k of Object.keys(stats)) {
    let v = stats[k];
    if (v == null) continue;
    const af = affixMap[k];
    // 装备生成时 stats 已包含词条值，不再重复加 af.value
    if (v === 0 && !af) continue;
    let valStr = String(Math.floor(v));
    if (['phys_lifesteal_pct','spell_lifesteal_pct','phys_splash_pct','spell_splash_pct'].includes(k)) valStr = (Number(v) / 10).toFixed(1) + '%';
    else if (['phys_damage_pct','spell_damage_pct','phys_defense_pct','spell_defense_pct'].includes(k)) valStr = Math.floor(v) + '%';
    const label = ITEM_STAT_NAMES[k] || k.replace(/_/g, ' ');
    const isEx = item.isEx || item.exTemplate;
    const sfx = af ? (isEx ? ' (EX)' : ' (Q' + (af.quality || 1) + '/T' + (af.tier || 1) + ')') : '';
    statLines.push({ label, val: valStr, suffix: sfx });
  }
  if (statLines.length) lines.push({ t: 'stats', items: statLines });
  const setId = String(item.setId || item.exTemplate || '');
  if (setId && SET_EFFECTS[setId]) lines.push({ t: 'set', setId, effects: SET_EFFECTS[setId] });
  if (setId && EX_WEAPON_EFFECTS[setId]) lines.push({ t: 'ex_weapon', name: setId, text: EX_WEAPON_EFFECTS[setId] });
  if (item.effects && item.effects.length) lines.push({ t: 'effects', items: item.effects.map(e => fmtItemEffect(e, getItem)).filter(Boolean) });
  return lines;
}
