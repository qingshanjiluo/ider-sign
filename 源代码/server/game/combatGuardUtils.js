const { intVal, numVal, clamp, isPvpBattleMode } = require('./combatCoreUtils');

function isStasisGuardActive(unit) {
  return Boolean(unit && unit.stasis_guard_active === true && intVal(unit.stasis_rounds, 0) > 0);
}

function isDebuffImmune(unit) {
  return isStasisGuardActive(unit);
}

function pushStasisGuardEvent(unit, events, sourceText = '', kind = 'damage') {
  if (!unit || !Array.isArray(events)) return;
  const prefix = sourceText ? `${sourceText}：` : '';
  const tail = kind === 'debuff' ? '免疫负面状态' : '免疫本次伤害';
  events.push({
    t: 'combat_log',
    actor: unit.tag || 'player',
    target: unit.tag || 'player',
    action: 'stasis_guard',
    text: `${prefix}${unit.name} 处于凝滞护体，${tail}`
  });
}

function capIncomingDamageByTaixu(target, damage, events, opts = {}) {
  const rawDamage = Math.max(0, intVal(damage, 0));
  if (!target || rawDamage <= 0) {
    return { damage: rawDamage, blocked: 0, cap: 0, active: false };
  }
  if (!(numVal(target.taixu_shentu_active, 0) > 0)) {
    return { damage: rawDamage, blocked: 0, cap: 0, active: false };
  }
  const battleMode = String(opts?.battleMode || opts?.state?.battle_mode || target?.battle_mode || '');
  const isPvpCap = opts?.isPvp === true || isPvpBattleMode(battleMode);
  const defaultCapRatio = isPvpCap ? 0.26 : 0.16;
  const capRatio = clamp(numVal(opts.capRatio, defaultCapRatio), 0, 1);
  const cap = Math.max(1, Math.floor(Math.max(1, numVal(target.max_hp, 1)) * capRatio));
  if (rawDamage <= cap) {
    return { damage: rawDamage, blocked: 0, cap, active: true };
  }
  const blocked = rawDamage - cap;
  if (!opts.silentLog && Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: target.tag || 'player',
      target: target.tag || 'player',
      action: 'taixu_shentu_cap',
      damage: cap,
      blocked,
      text: `${target.name} 的太虚神途生效：单次伤害上限${cap}，抵消${blocked}点伤害`
    });
  }
  return { damage: cap, blocked, cap, active: true };
}

function absorbDamageByTempShield(unit, damage, events) {
  if (!unit || damage <= 0) return Math.max(0, intVal(damage, 0));
  let finalDamage = Math.max(0, intVal(damage, 0));
  const shield = Math.max(0, intVal(unit.temp_shield, 0));
  if (shield <= 0) return finalDamage;

  if (numVal(unit.chaosheng_shentu_active, 0) > 0) {
    finalDamage = Math.max(0, Math.floor(finalDamage * 0.88));
  }

  const absorbed = Math.min(shield, finalDamage);
  if (absorbed <= 0) return finalDamage;
  unit.temp_shield = shield - absorbed;
  finalDamage -= absorbed;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: unit.tag || 'player',
      action: 'daoti_temp_shield_absorb',
      absorb: absorbed,
      text: `${unit.name} 的临时护盾吸收了${absorbed}点伤害`
    });
  }
  return finalDamage;
}

function applyHealWithOverflowShield(unit, healAmount, events, opts = {}) {
  if (!unit || healAmount <= 0) return { actualHeal: 0, overflowShield: 0 };
  const heal = Math.max(0, Math.floor(numVal(healAmount, 0)));
  if (heal <= 0) return { actualHeal: 0, overflowShield: 0 };

  if (intVal(unit.wenluan_rounds, 0) > 0 && numVal(unit.wenluan_ratio, 0) > 0) {
    const beforeHp = Math.max(0, intVal(unit.hp, 0));
    let backlash = Math.max(0, Math.floor(heal * clamp(numVal(unit.wenluan_ratio, 0.5), 0, 10)));
    if (backlash > 0) {
      backlash = absorbDamageByTempShield(unit, backlash, events);
      backlash = capIncomingDamageByTaixu(unit, backlash, events, { state: opts.state }).damage;
      unit.hp = Math.max(0, beforeHp - backlash);
      if (Array.isArray(events)) {
        events.push({
          t: 'combat_log',
          actor: unit.tag || 'player',
          target: unit.tag || 'player',
          action: 'wenluan_backlash',
          damage: backlash,
          text: `${unit.name} 受紊乱影响，回复反噬为${backlash}点伤害`
        });
      }
    }
    return { actualHeal: 0, overflowShield: 0 };
  }

  const before = Math.max(0, intVal(unit.hp, 0));
  const maxHp = Math.max(1, intVal(unit.max_hp, 1));
  unit.hp = Math.min(maxHp, before + heal);
  const actualHeal = Math.max(0, intVal(unit.hp, 0) - before);
  const overflow = Math.max(0, heal - actualHeal);

  let overflowShield = 0;
  if (overflow > 0 && unit.daoti_overheal_to_temp_shield) {
    unit.temp_shield = Math.max(0, intVal(unit.temp_shield, 0)) + overflow;
    overflowShield = overflow;
    if (!opts.silentOverflowLog && Array.isArray(events)) {
      events.push({
        t: 'combat_log',
        actor: unit.tag || 'player',
        target: unit.tag || 'player',
        action: 'daoti_temp_shield_gain',
        shield: overflow,
        text: `${unit.name} 的道体将溢出治疗转化为${overflow}点临时护盾`
      });
    }
  }
  return { actualHeal, overflowShield };
}

module.exports = {
  isStasisGuardActive,
  isDebuffImmune,
  pushStasisGuardEvent,
  capIncomingDamageByTaixu,
  absorbDamageByTempShield,
  applyHealWithOverflowShield
};
