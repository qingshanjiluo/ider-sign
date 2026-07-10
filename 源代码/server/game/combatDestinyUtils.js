const { intVal, numVal } = require('./combatCoreUtils');

function isKurongShentuActive(unit) {
  return numVal(unit?.kurong_shentu_active, 0) > 0;
}

function getTaixuanShentuSkillDamageMul(attacker, skill) {
  if (!(numVal(attacker?.taixuan_shentu_active, 0) > 0)) return 1;
  const attr = String(skill?.attribute || '');
  return attr === '无' ? 1.25 : 0.8;
}

function applyTaixuanShentuSkillDamage(attacker, skill, damage, events, opts = {}) {
  const raw = Math.max(0, intVal(damage, 0));
  if (raw <= 0) return raw;
  const mul = getTaixuanShentuSkillDamageMul(attacker, skill);
  if (mul === 1) return raw;
  const adjusted = Math.max(1, Math.floor(raw * mul));
  if (!opts.silentLog && Array.isArray(events)) {
    const isNeutralSkill = String(skill?.attribute || '') === '无';
    events.push({
      t: 'combat_log',
      actor: attacker?.tag || 'player',
      target: 'enemy',
      action: isNeutralSkill ? 'taixuan_shentu_bonus' : 'taixuan_shentu_penalty',
      text: isNeutralSkill
        ? `${attacker?.name || '目标'} 的太玄神途生效：无属性技能最终伤害+25%`
        : `${attacker?.name || '目标'} 的太玄神途生效：非无属性技能最终伤害-20%`
    });
  }
  return adjusted;
}

function blockDirectDamageByKurong(attacker, events, opts = {}) {
  if (!isKurongShentuActive(attacker)) return false;
  if (!opts.silent && Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: attacker.tag || 'player',
      target: attacker.tag || 'player',
      action: 'kurong_no_direct',
      text: `${attacker.name} 的枯荣神途生效：无法造成直接伤害`
    });
  }
  return true;
}

module.exports = {
  isKurongShentuActive,
  getTaixuanShentuSkillDamageMul,
  applyTaixuanShentuSkillDamage,
  blockDirectDamageByKurong
};
