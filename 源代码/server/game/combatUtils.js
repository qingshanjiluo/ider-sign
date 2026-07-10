/**
 * 战斗公用工具 — 快照构建、功法/灵根/套装/EX武器被动、debuff/状态系统
 * battleEngine.js 与 dungeonBattleEngine.js 均引用本模块
 */
const { getTechniqueById, getSkillById } = require('./dataLoader');
const { getTalentAttributeBonus, getTalentElementAffinityBonus, getTalentCombatBonus } = require('./talents');
const { calcEquipCombatPower, calcTotalEquipCombatPower } = require('./onlineUtils');
const { getRequiredLevelForItem, isValidEquipType } = require('./equipmentGen');
const {
  intVal,
  numVal,
  clamp,
  isPvpBattleMode,
  deepClone,
  nextRand01,
  rollInt,
  calcReducedDamage,
  calcActionSpeed
} = require('./combatCoreUtils');
const {
  isKurongShentuActive,
  getTaixuanShentuSkillDamageMul,
  applyTaixuanShentuSkillDamage
} = require('./combatDestinyUtils');
const {
  isStasisGuardActive,
  isDebuffImmune,
  pushStasisGuardEvent,
  capIncomingDamageByTaixu,
  absorbDamageByTempShield,
  applyHealWithOverflowShield
} = require('./combatGuardUtils');
const {
  countSetPieces,
  hasTudun,
  getDaomiaoExtraAffinity,
  calcElementAffinity,
  getHaomiaoDotBonus,
  tryJiemieHealToXurui
} = require('./combatSetUtils');

let _caveModule = null;
const EQUIP_POWER_SLOTS = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
function _getCaveModule() {
  if (_caveModule !== null) return _caveModule;
  try {
    _caveModule = require('./cave');
  } catch (_err) {
    _caveModule = undefined;
  }
  return _caveModule;
}

function _createEmptyFormationCombatBonus() {
  return {
    attribute_pct: {
      strength: 0,
      constitution: 0,
      bone: 0,
      agility: 0,
      zhenyuan: 0,
      lingli: 0
    },
    phys_crit_rate_pct: 0,
    spell_crit_rate_pct: 0,
    turn_end_mp_pct_of_max_mp: 0,
    balance_lowest_attr_pct: 0,
    abaddon_rebirth_once: false
  };
}

function _getFormationCombatBonusSafe(player) {
  const cave = _getCaveModule();
  if (!cave || typeof cave.getFormationCombatBonus !== 'function') return _createEmptyFormationCombatBonus();
  try {
    const raw = cave.getFormationCombatBonus(player);
    const out = _createEmptyFormationCombatBonus();
    const attr = raw?.attribute_pct && typeof raw.attribute_pct === 'object' ? raw.attribute_pct : {};
    out.attribute_pct.strength = Math.max(0, numVal(attr.strength, 0));
    out.attribute_pct.constitution = Math.max(0, numVal(attr.constitution, 0));
    out.attribute_pct.bone = Math.max(0, numVal(attr.bone, 0));
    out.attribute_pct.agility = Math.max(0, numVal(attr.agility, 0));
    out.attribute_pct.zhenyuan = Math.max(0, numVal(attr.zhenyuan, 0));
    out.attribute_pct.lingli = Math.max(0, numVal(attr.lingli, 0));
    out.phys_crit_rate_pct = Math.max(0, numVal(raw?.phys_crit_rate_pct, 0));
    out.spell_crit_rate_pct = Math.max(0, numVal(raw?.spell_crit_rate_pct, 0));
    out.turn_end_mp_pct_of_max_mp = Math.max(0, numVal(raw?.turn_end_mp_pct_of_max_mp, 0));
    out.balance_lowest_attr_pct = Math.max(0, numVal(raw?.balance_lowest_attr_pct, 0));
    out.abaddon_rebirth_once = !!raw?.abaddon_rebirth_once;
    return out;
  } catch (_err) {
    return _createEmptyFormationCombatBonus();
  }
}

function _applyFormationAttributeBonuses(attrs, formationBonus) {
  const out = {
    strength: Math.max(0, intVal(attrs?.strength, 0)),
    constitution: Math.max(0, intVal(attrs?.constitution, 0)),
    bone: Math.max(0, intVal(attrs?.bone, 0)),
    agility: Math.max(0, numVal(attrs?.agility, 0)),
    zhenyuan: Math.max(0, intVal(attrs?.zhenyuan, 0)),
    lingli: Math.max(0, intVal(attrs?.lingli, 0))
  };
  const pct = formationBonus?.attribute_pct && typeof formationBonus.attribute_pct === 'object'
    ? formationBonus.attribute_pct
    : {};
  for (const key of Object.keys(out)) {
    const ratio = Math.max(0, numVal(pct[key], 0));
    if (ratio <= 0) continue;
    out[key] += Math.floor(out[key] * ratio);
  }

  const balancePct = Math.max(0, numVal(formationBonus?.balance_lowest_attr_pct, 0));
  if (balancePct > 0) {
    const keys = Object.keys(out);
    const minVal = keys.reduce((m, k) => Math.min(m, out[k]), Number.POSITIVE_INFINITY);
    if (Number.isFinite(minVal) && minVal > 0) {
      const add = Math.floor(minVal * balancePct);
      if (add > 0) {
        for (const key of keys) {
          if (out[key] === minVal) out[key] += add;
        }
      }
    }
  }
  return out;
}

function _getEquipmentLevelAllowanceSafe(player) {
  const cave = _getCaveModule();
  if (cave && typeof cave.getFormationEquipmentLevelAllowance === 'function') {
    try {
      return Math.max(0, intVal(cave.getFormationEquipmentLevelAllowance(player), 0));
    } catch (_err) {
      // fall through
    }
  }
  return Math.max(0, intVal(player?._equip_level_allowance, 0));
}

function _getRequiredLevelSafe(item) {
  if (!item || typeof item !== 'object') return 0;
  const r = intVal(item.required_level, 0);
  if (r > 0) return r;
  const q = Math.max(1, Math.min(8, intVal(item.quality, 1)));
  const affixes = Array.isArray(item.affixes) ? item.affixes : [];
  return Math.max(0, intVal(getRequiredLevelForItem(q, affixes), 0));
}

function _getEffectiveEquipmentForPlayer(player) {
  const eq = player?.equipment;
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return {};
  const out = {};
  const lv = Math.max(1, intVal(player?.level, 1));
  const allowance = _getEquipmentLevelAllowanceSafe(player);
  for (const [slotName, rawItem] of Object.entries(eq)) {
    const item = rawItem && typeof rawItem === 'object' && rawItem.item ? rawItem.item : rawItem;
    if (!item || typeof item !== 'object') continue;
    const req = _getRequiredLevelSafe(item);
    if (lv + allowance < req) continue;
    out[slotName] = item;
  }
  return out;
}

/** 根据等级返回境界品质（1练气 2筑基 …），用于治疗减半等 */
function getRealmQualityFromLevel(level) {
  const lv = Math.max(1, intVal(level, 1));
  if (lv <= 120) return 1;
  if (lv <= 160) return 2;
  if (lv <= 200) return 3;
  if (lv <= 240) return 4;
  if (lv <= 280) return 5;
  return 6;
}

// 兼容旧调用：用于传人/装备界面快速判定与战力标注。
function isEquipmentItem(item) {
  if (!item || typeof item !== 'object') return false;
  return isValidEquipType(String(item.type || ''));
}

function scoreEquipmentCollection(equipment) {
  if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return 0;
  let total = 0;
  for (const slot of EQUIP_POWER_SLOTS) {
    total += calcEquipCombatPower(equipment[slot]);
  }
  return Math.max(0, intVal(total, 0));
}

function annotateEquipmentPower(player) {
  if (!player || typeof player !== 'object') return 0;
  player.equip_combat_power = calcTotalEquipCombatPower(player);
  const apprentice = player.lineage_apprentice;
  if (apprentice && typeof apprentice === 'object' && !Array.isArray(apprentice)) {
    apprentice.power_total = scoreEquipmentCollection(apprentice.equipment);
  }
  if (player.disciple && typeof player.disciple === 'object' && !Array.isArray(player.disciple)) {
    player.disciple.combat_power = scoreEquipmentCollection(player.disciple.equipment);
  }
  return Math.max(0, intVal(player.equip_combat_power, 0));
}

// ─── Timed buff reader ───
function readTimedBuffValue(player, key) {
  const buffs = player?.timed_buffs;
  if (!buffs || typeof buffs !== 'object') return 0;
  const b = buffs[String(key)];
  if (!b || typeof b !== 'object') return 0;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.max(0, intVal(b.expires_at, 0));
  if (expiresAt > 0 && expiresAt <= now) return 0;
  return Math.max(0, numVal(b.value, 0));
}

// ══════════════════════════════════════════════════════════════
//  功法被动系统 — passiveEffects (学习即生效) + effects (装配生效)
// ══════════════════════════════════════════════════════════════

function _getAllLearnedTechniqueIds(player) {
  const tl = player?.technique_levels;
  if (!tl || typeof tl !== 'object') return [];
  return Object.keys(tl).map(k => Number(k)).filter(k => k > 0);
}

function _getEquippedWeaponType(player) {
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object') return '';
  const weapon = eq.weapon;
  if (!weapon) return '';
  return String(weapon.weaponType || weapon.weapon_type || weapon.subtype || '');
}

function _isTechniqueEquipRequirementMet(player, tech) {
  if (!tech || typeof tech !== 'object') return false;
  const req = tech.requirements;
  if (!req || typeof req !== 'object' || Array.isArray(req)) return true;
  const weapType = _getEquippedWeaponType(player);
  const reqWeaponTypes = Array.isArray(req.weaponTypes) ? req.weaponTypes : [];
  if (reqWeaponTypes.length > 0) {
    const ok = reqWeaponTypes.some((wt) => {
      const s = String(wt || '');
      return s.length > 0 && weapType.includes(s);
    });
    if (!ok) return false;
  }
  return true;
}

function _getEquippedWeaponStats(player) {
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return { phys: 0, spell: 0, minPhys: 0, maxPhys: 0, minSpell: 0, maxSpell: 0 };
  const weapon = eq.weapon || eq.Weapon;
  if (!weapon || typeof weapon !== 'object') return { phys: 0, spell: 0, minPhys: 0, maxPhys: 0, minSpell: 0, maxSpell: 0 };
  const s = weapon.stats && typeof weapon.stats === 'object' ? weapon.stats : {};
  let minPhys = intVal(s.minAttack, 0);
  let maxPhys = intVal(s.maxAttack, 0);
  let minSpell = intVal(s.minSpellAttack, 0);
  let maxSpell = intVal(s.maxSpellAttack, 0);
  if (minPhys <= 0 && maxPhys <= 0) {
    const v = numVal(weapon.attack, 0) || numVal(weapon.physAttack, 0);
    minPhys = maxPhys = Math.floor(v) || 0;
  }
  if (minSpell <= 0 && maxSpell <= 0) {
    const v = numVal(weapon.spellAttack, 0) || numVal(weapon.spell_attack, 0);
    minSpell = maxSpell = Math.floor(v) || 0;
  }
  const phys = minPhys > 0 || maxPhys > 0 ? Math.floor((minPhys + maxPhys) / 2) || 0 : 0;
  const spell = minSpell > 0 || maxSpell > 0 ? Math.floor((minSpell + maxSpell) / 2) || 0 : 0;
  return { phys, spell, minPhys, maxPhys, minSpell, maxSpell };
}

/** 装配戒指、护符（项链）提供的物攻、法攻，参与攻击力计算 */
function _getEquippedAccessoryAttackStats(player) {
  const out = { minPhys: 0, maxPhys: 0, minSpell: 0, maxSpell: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  for (const slotName of ['ring', 'amulet']) {
    const item = eq[slotName];
    if (!item?.stats || typeof item.stats !== 'object') continue;
    const s = item.stats;
    const physPct = Math.max(0, s.phys_damage_pct != null ? numVal(s.phys_damage_pct, 0) / 100 : 0);
    const spellPct = Math.max(0, s.spell_damage_pct != null ? numVal(s.spell_damage_pct, 0) / 100 : 0);

    // 单件口径：先合并该件白字攻法与点攻词条，再由该件增伤%放大
    const baseMinPhys = intVal(s.minAttack, 0) + intVal(s.phys_flat_damage, 0);
    const baseMaxPhys = intVal(s.maxAttack, 0) + intVal(s.phys_flat_damage, 0);
    const baseMinSpell = intVal(s.minSpellAttack, 0) + intVal(s.spell_flat_damage, 0);
    const baseMaxSpell = intVal(s.maxSpellAttack, 0) + intVal(s.spell_flat_damage, 0);

    out.minPhys += Math.floor(baseMinPhys * (1 + physPct));
    out.maxPhys += Math.floor(baseMaxPhys * (1 + physPct));
    out.minSpell += Math.floor(baseMinSpell * (1 + spellPct));
    out.maxSpell += Math.floor(baseMaxSpell * (1 + spellPct));
  }
  return out;
}

/** 装配防具（非武器）提供的生命、物防、法防总和。物理/法术防御%只对该件装备提供的防御值生效 */
function _getEquippedArmorStats(player) {
  const out = { maxHp: 0, physDefense: 0, spellDefense: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  const slots = ['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item || typeof item !== 'object') continue;
    const s = item.stats;
    if (!s || typeof s !== 'object') continue;
    out.maxHp += intVal(s.maxHp, 0);
    let pDef = intVal(s.physDefense, 0) || intVal(s.defense, 0);
    let sDef = intVal(s.spellDefense, 0);
    if (s.phys_defense_flat != null) pDef += intVal(s.phys_defense_flat, 0);
    if (s.spell_defense_flat != null) sDef += intVal(s.spell_defense_flat, 0);
    if (s.phys_defense_pct != null) pDef = Math.floor(pDef * (1 + numVal(s.phys_defense_pct, 0) / 100));
    if (s.spell_defense_pct != null) sDef = Math.floor(sDef * (1 + numVal(s.spell_defense_pct, 0) / 100));
    out.physDefense += pDef;
    out.spellDefense += sDef;
  }
  return out;
}

/** 装配装备词条暴击/暴伤加成（武器：phys/spell_crit_rate_bonus；戒指/项链：phys/spell_crit_damage_bonus），值为整数百分，如 12 表示 12% */
function _getEquippedCritBonuses(player) {
  const out = { phys_crit_rate_bonus: 0, spell_crit_rate_bonus: 0, phys_crit_damage_bonus: 0, spell_crit_damage_bonus: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  const slots = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item || typeof item !== 'object') continue;
    const s = item.stats;
    if (!s || typeof s !== 'object') continue;
    for (const k of Object.keys(out)) {
      if (s[k] != null) out[k] += intVal(s[k], 0);
    }
  }
  return out;
}

/** 装配装备词条「行动结束后回复法力值」总和 */
function _getEquippedTurnEndMp(player) {
  let total = 0;
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return total;
  const slots = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item || typeof item !== 'object') continue;
    const s = item.stats;
    if (s && typeof s === 'object' && s.turn_end_mp != null) total += intVal(s.turn_end_mp, 0);
  }
  return total;
}

/** 装配装备词条「物理/法术吸血」，值存为百分*10（50=5%），返回 0~0.8 */
function _getEquippedLifestealPct(player) {
  const out = { phys: 0, spell: 0 };
  const weapon = _getEffectiveEquipmentForPlayer(player)?.weapon;
  if (!weapon?.stats) return out;
  const s = weapon.stats;
  if (s.phys_lifesteal_pct != null) out.phys = Math.min(0.8, numVal(s.phys_lifesteal_pct, 0) / 1000);
  if (s.spell_lifesteal_pct != null) out.spell = Math.min(0.8, numVal(s.spell_lifesteal_pct, 0) / 1000);
  return out;
}

/** 装配装备词条「物理/法术伤害增加%」，值存为百分（115=115%），返回加成倍数。仅用于戒指/项链，武器上的伤害%已并入攻击力 */
function _getEquippedDamagePct(player) {
  const out = { phys: 0, spell: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  const slots = ['ring', 'amulet'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item?.stats) continue;
    const s = item.stats;
    if (s.phys_damage_pct != null) out.phys += numVal(s.phys_damage_pct, 0) / 100;
    if (s.spell_damage_pct != null) out.spell += numVal(s.spell_damage_pct, 0) / 100;
  }
  return out;
}

/** 戒指/护符词条提供的物理/法术点伤 */
function _getEquippedFlatDamage(player) {
  const out = { phys: 0, spell: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  for (const slotName of ['ring', 'amulet']) {
    const item = eq[slotName];
    if (!item?.stats || typeof item.stats !== 'object') continue;
    const s = item.stats;
    out.phys += intVal(s.phys_flat_damage, 0);
    out.spell += intVal(s.spell_flat_damage, 0);
  }
  return out;
}

/** 武器词条提供的物理/法术溅射比例，值存为百分*10（150=15%） */
function _getEquippedSplashPct(player) {
  const out = { phys: 0, spell: 0 };
  const weapon = _getEffectiveEquipmentForPlayer(player)?.weapon;
  if (!weapon?.stats || typeof weapon.stats !== 'object') return out;
  const s = weapon.stats;
  out.phys = Math.max(0, numVal(s.phys_splash_pct, 0) / 1000);
  out.spell = Math.max(0, numVal(s.spell_splash_pct, 0) / 1000);
  return out;
}

/** 武器上的物理/法术伤害增加%，只对武器提供的攻击力生效 */
function _getWeaponDamagePct(player) {
  const out = { phys: 0, spell: 0 };
  const weapon = _getEffectiveEquipmentForPlayer(player)?.weapon;
  if (!weapon?.stats) return out;
  const s = weapon.stats;
  if (s.phys_damage_pct != null) out.phys = numVal(s.phys_damage_pct, 0) / 100;
  if (s.spell_damage_pct != null) out.spell = numVal(s.spell_damage_pct, 0) / 100;
  return out;
}

/** 装配防具（非戒指项链）词条「物理/法术防御增加%」，值存为百分（99=99%） */
function _getEquippedDefensePct(player) {
  const out = { phys: 0, spell: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  const slots = ['head', 'shoulder', 'chest', 'legs', 'hands', 'back'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item?.stats) continue;
    const s = item.stats;
    if (s.phys_defense_pct != null) out.phys += numVal(s.phys_defense_pct, 0) / 100;
    if (s.spell_defense_pct != null) out.spell += numVal(s.spell_defense_pct, 0) / 100;
  }
  return out;
}

/** 所有装配装备（含武器）的 stats 属性加成，如铁剑 +strength */
function _getEquippedEquipmentAttributeBonus(player) {
  const out = { strength: 0, constitution: 0, bone: 0, agility: 0, zhenyuan: 0, lingli: 0 };
  const eq = _getEffectiveEquipmentForPlayer(player);
  if (!eq || typeof eq !== 'object' || Array.isArray(eq)) return out;
  const slots = ['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
  for (const slotName of slots) {
    const item = eq[slotName];
    if (!item || typeof item !== 'object') continue;
    const s = item.stats;
    if (!s || typeof s !== 'object') continue;
    for (const attr of Object.keys(out)) {
      out[attr] += intVal(s[attr], 0);
    }
  }
  return out;
}

/** 装配功法（主修/辅修）的 stats 中的元素亲和：metalAffinity, woodAffinity 等 */
function _getEquippedTechniqueElementAffinity(player) {
  const out = { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 };
  const techniques = player?.techniques;
  if (!techniques || typeof techniques !== 'object' || Array.isArray(techniques)) return out;
  const techLevels = player?.technique_levels || {};
  const AFFINITY_KEYS = ['metalAffinity', 'woodAffinity', 'waterAffinity', 'fireAffinity', 'earthAffinity'];
  const MAP = { metalAffinity: 'metal', woodAffinity: 'wood', waterAffinity: 'water', fireAffinity: 'fire', earthAffinity: 'earth' };
  for (const slot of [{ key: 'main', mult: 1.0 }, { key: 'sub', mult: 0.5 }]) {
    const raw = techniques[slot.key];
    const tid = (raw && typeof raw === 'object' && raw.id != null) ? intVal(raw.id, 0) : intVal(raw, 0);
    if (tid <= 0) continue;
    const tech = getTechniqueById(tid);
    if (!tech || !tech.id) continue;
    if (!_isTechniqueEquipRequirementMet(player, tech)) continue;
    const tlv = Math.max(1, intVal(techLevels[String(tid)]?.level, 1));
    const stats = tech.stats && typeof tech.stats === 'object' ? tech.stats : {};
    for (const key of AFFINITY_KEYS) {
      const v = numVal(stats[key], 0) * tlv * slot.mult;
      if (MAP[key]) out[MAP[key]] += Math.floor(v);
    }
  }
  return out;
}

/** 装配功法（主修/辅修）的 stats 属性加成：如吐纳法的 constitution */
function _getEquippedTechniqueAttributeBonus(player) {
  const out = { strength: 0, constitution: 0, bone: 0, agility: 0, zhenyuan: 0, lingli: 0 };
  const techniques = player?.techniques;
  if (!techniques || typeof techniques !== 'object' || Array.isArray(techniques)) return out;
  const techLevels = player?.technique_levels || {};
  const slots = [
    { key: 'main', mult: 1.0 },
    { key: 'sub', mult: 0.5 }
  ];
  for (const slot of slots) {
    const raw = techniques[slot.key];
    const tid = (raw && typeof raw === 'object' && raw.id != null) ? intVal(raw.id, 0) : intVal(raw, 0);
    if (tid <= 0) continue;
    const tech = getTechniqueById(tid);
    if (!tech || !tech.id) continue;
    if (!_isTechniqueEquipRequirementMet(player, tech)) continue;
    const lvData = techLevels[String(tid)];
    const tlv = lvData && typeof lvData === 'object' ? Math.max(1, intVal(lvData.level, 1)) : 1;
    // 若功法有 passiveStats 或 passiveEffects 已含该属性，则不再从 stats 重复加（避免装配时双重生效）
    const passiveAttrTypes = new Set((Array.isArray(tech.passiveEffects) ? tech.passiveEffects : [])
      .map(pe => String(pe?.type || '')).filter(t => ['constitution', 'strength', 'bone', 'agility', 'zhenyuan', 'lingli'].includes(t)));
    let stats = (tech.passiveStats && Object.keys(tech.passiveStats).length > 0) ? {} : (tech.stats && typeof tech.stats === 'object' ? tech.stats : {});
    if (Object.keys(stats).length > 0 && passiveAttrTypes.size > 0) {
      stats = { ...stats };
      for (const k of Object.keys(stats)) {
        if (passiveAttrTypes.has(k)) delete stats[k];
      }
    }
    const doublePerLevel = String(tech.passiveStatPerLevel || '') === 'double';
    for (const [attr, baseVal] of Object.entries(stats)) {
      if (!out.hasOwnProperty(attr)) continue;
      const v = numVal(baseVal, 0);
      const total = doublePerLevel ? v * Math.pow(2, tlv - 1) : v * tlv;
      out[attr] += Math.floor(total * slot.mult);
    }
  }
  return out;
}

/**
 * 计算所有已学功法的 passiveEffects 总和
 * passiveEffects 只要学了就生效，与装配槽无关
 */
function calcAllPassiveEffects(player) {
  const result = {
    spirit_root_bonus: { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 },
    attribute_bonus: { strength: 0, constitution: 0, bone: 0, agility: 0, zhenyuan: 0, lingli: 0 },
    passive_spell_attack: 0,  // passiveStats 中的 spellAttack 累加（如霓裳曲谱）
    weapon_phys_attack_mult: 0,  // 加算，最终 1 + sum
    weapon_spell_attack_mult: 0,
    weapon_phys_type: '',
    weapon_spell_type: '',
    spell_crit_rate_bonus: 0,
    earth_dmg_reduction_per_point: 0,
    fire_spell_dmg_per_point: 0,
    wood_debuff_resist_per_point: 0,
    zhenyuan_to_spell_attack_pct: 0,
    defense_bonus_percent: 0,
    pvp_defense_bonus_percent: 0,
    jisheng_dot_mastery: null,
    heal_others_self_heal: 0
  };

  const learnedIds = _getAllLearnedTechniqueIds(player);
  const tl = player?.technique_levels || {};

  for (const tid of learnedIds) {
    const tech = getTechniqueById(tid);
    if (!tech || !tech.id) continue;
    const lvData = tl[String(tid)];
    const tlv = lvData && typeof lvData === 'object' ? Math.max(1, intVal(lvData.level, 1)) : 1;

    // passiveEffects
    const passives = Array.isArray(tech.passiveEffects) ? tech.passiveEffects : [];
    for (const p of passives) {
      const pt = String(p?.type || '');
      const val = numVal(p?.value, 0);
      const lvBonus = numVal(p?.levelBonus, 0);
      const coeffBonus = numVal(p?.coefficientBonus, 0);
      const totalVal = val + (tlv > 1 ? (tlv - 1) * (lvBonus || coeffBonus) : 0);

      if (pt === 'metal_spirit_root') result.spirit_root_bonus.metal += Math.floor(val * tlv);
      else if (pt === 'wood_spirit_root') result.spirit_root_bonus.wood += Math.floor(val * tlv);
      else if (pt === 'water_spirit_root') result.spirit_root_bonus.water += Math.floor(val * tlv);
      else if (pt === 'fire_spirit_root') result.spirit_root_bonus.fire += Math.floor(val * tlv);
      else if (pt === 'earth_spirit_root') result.spirit_root_bonus.earth += Math.floor(val * tlv);
      else if (pt === 'constitution') result.attribute_bonus.constitution += Math.floor(val * tlv);
      else if (pt === 'strength') result.attribute_bonus.strength += Math.floor(val * tlv);
      else if (pt === 'bone') result.attribute_bonus.bone += Math.floor(val * tlv);
      else if (pt === 'agility') result.attribute_bonus.agility += Math.floor(val * tlv);
      else if (pt === 'zhenyuan') result.attribute_bonus.zhenyuan += Math.floor(val * tlv);
      else if (pt === 'lingli') result.attribute_bonus.lingli += Math.floor(val * tlv);
      else if (pt === 'weapon_physical_attack_bonus') {
        const weapType = _getEquippedWeaponType(player);
        const reqType = String(p?.weaponType || '');
        if (reqType && weapType.includes(reqType)) {
          result.weapon_phys_attack_mult += totalVal - 1.0;
          result.weapon_phys_type = reqType;
        }
      } else if (pt === 'weapon_spell_attack_bonus') {
        const weapType = _getEquippedWeaponType(player);
        const reqType = String(p?.weaponType || '');
        if (reqType && weapType.includes(reqType)) {
          result.weapon_spell_attack_mult += totalVal - 1.0;
          result.weapon_spell_type = reqType;
        }
      } else if (pt === 'spell_crit_rate_bonus') {
        result.spell_crit_rate_bonus += totalVal;
      } else if (pt === 'earth_damage_reduction_per_point_bonus') {
        result.earth_dmg_reduction_per_point += totalVal;
      } else if (pt === 'fire_spell_damage_per_point_bonus') {
        result.fire_spell_dmg_per_point += totalVal;
      } else if (pt === 'wood_debuff_resistance_per_point_bonus') {
        result.wood_debuff_resist_per_point += totalVal;
      } else if (pt === 'zhenyuan_to_spell_attack_percent') {
        result.zhenyuan_to_spell_attack_pct += totalVal;
      } else if (pt === 'defense_bonus_percent') {
        result.defense_bonus_percent += totalVal;
        const pvpVal = numVal(p?.pvpValue, 0);
        if (pvpVal > 0) {
          const pvpTotalVal = pvpVal + (tlv > 1 ? (tlv - 1) * (lvBonus || coeffBonus) : 0);
          result.pvp_defense_bonus_percent += pvpTotalVal;
        } else {
          result.pvp_defense_bonus_percent += totalVal;
        }
      } else if (pt === 'jisheng_dot_mastery') {
        result.jisheng_dot_mastery = {
          dot_bonus_pct: numVal(p?.dot_bonus_pct, 0.15),
          spell_def_reduce_pct: numVal(p?.spell_def_reduce_pct, 0.5)
        };
      } else if (pt === 'heal_others_self_heal') {
        result.heal_others_self_heal += totalVal;
      }
    }
    // passiveStats：学习即生效的被动属性（如青云养气御剑真解、霓裳曲谱、铁血斗战法）
    const passiveStats = tech.passiveStats && typeof tech.passiveStats === 'object' ? tech.passiveStats : {};
    if (Object.keys(passiveStats).length > 0) {
      const perLevel = String(tech.passiveStatPerLevel || '');
      for (const [statKey, baseVal] of Object.entries(passiveStats)) {
        const v = numVal(baseVal, 0);
        const boost = perLevel === 'double' ? v * Math.pow(2, tlv - 1) : v * tlv;
        if (statKey === 'spellAttack') {
          result.passive_spell_attack += Math.floor(boost);
        } else if (result.attribute_bonus.hasOwnProperty(statKey)) {
          result.attribute_bonus[statKey] += Math.floor(boost);
        }
      }
    }
  }
  return result;
}

/**
 * 计算装配功法的 effects 总和（主修 ×1.0，辅修 ×0.5）
 * @param {object} player
 * @param {object} opts - { isTeamBattle } 非组队（单人副本/野外/斗法）时 isTeamBattle=false
 */
function calcEquippedTechEffects(player, opts = {}) {
  const isTeamBattle = opts.isTeamBattle === true;
  const result = {
    physical_armor_pen: 0,
    spell_armor_pen: 0,
    spell_crit_ignore_spell_defense: 0,
    spell_final_damage_pct: 0,
    phys_lifesteal: 0,
    phys_crit_damage_bonus: 0,
    phys_crit_rate_bonus: 0,
    defense_divisor_reduction: 0,
    direct_damage_ignore_chance: 0,
    on_direct_damage_counter: null,   // {chance, damageCoeff}
    on_direct_damage_stasis: null,    // {chance, duration}
    on_deal_damage_mana_burn: null,   // {mpBurnPct, pvpMpBurnPct, pvpAsSpell}
    on_damage_jisheng: null,          // {duration, damagePercent} — 任何直接伤害触发
    basic_attack_as_spell: null,      // {minValue, maxValue}
    turn_end_mp: 0,
    turn_end_hp_pct: 0,
    turn_end_mp_pct: 0,
    turn_end_hp_max_pct: 0,
    phys_attack_mult: 1.0,
    heal_amp: 0,
    spell_pen_on_noncrit: 0,
    hp_above_spell_def_bonus: null,
    hp_below_spell_final_dmg: null,
    self_heal_forbid: false,
    hp_lost_damage_step_bonus: null,
    phys_damage_equalize: false,
    align_phys_spell_attack: false,
    high_str_or_lingli_from_high_con_or_zhenyuan_pct: 0,
    battle_start_temp_shield_from_spell_attack_pct: 0,
    on_damaged_reflect_if_temp_shield: null,
    battle_start_moshen_jue: null
  };

  const techniques = player?.techniques;
  if (!techniques || typeof techniques !== 'object') return result;
  const techLevels = player?.technique_levels || {};

  const slots = [
    { key: 'main', mult: 1.0 },
    { key: 'sub', mult: 0.5 }
  ];

  for (const slot of slots) {
    const raw = techniques[slot.key];
    const tid = (raw && typeof raw === 'object' && raw.id != null) ? intVal(raw.id, 0) : intVal(raw, 0);
    if (tid <= 0) continue;
    const tech = getTechniqueById(tid);
    if (!tech || !tech.id) continue;

    if (!_isTechniqueEquipRequirementMet(player, tech)) continue;

    const lvData = techLevels[String(tid)];
    const tlv = lvData && typeof lvData === 'object' ? Math.max(1, intVal(lvData.level, 1)) : 1;
    const effects = Array.isArray(tech.effects) ? tech.effects : [];

    for (const eff of effects) {
      const et = String(eff?.type || '');
      const whenTeam = eff?.whenTeam === true;
      const whenSolo = eff?.whenSolo === true;
      if (whenTeam && !isTeamBattle) continue;
      if (whenSolo && isTeamBattle) continue;

      const val = numVal(eff?.value, 0);
      const lvBonus = numVal(eff?.levelBonus, 0);
      const totalVal = val + (tlv > 1 ? (tlv - 1) * lvBonus : 0);

      if (et === 'physical_armor_pen') {
        result.physical_armor_pen += totalVal * slot.mult;
      } else if (et === 'spell_armor_pen') {
        result.spell_armor_pen += totalVal * slot.mult;
      } else if (et === 'spell_crit_ignore_spell_defense') {
        result.spell_crit_ignore_spell_defense += totalVal * slot.mult;
      } else if (et === 'spell_final_damage_percent') {
        result.spell_final_damage_pct += totalVal * slot.mult;
      } else if (et === 'phys_damage_lifesteal') {
        result.phys_lifesteal += totalVal * slot.mult;
      } else if (et === 'phys_crit_damage_bonus') {
        result.phys_crit_damage_bonus += totalVal * slot.mult;
      } else if (et === 'phys_crit_rate_bonus') {
        result.phys_crit_rate_bonus += totalVal * slot.mult;
      } else if (et === 'defense_divisor_reduction') {
        result.defense_divisor_reduction += totalVal * slot.mult;
      } else if (et === 'direct_damage_ignore_chance') {
        result.direct_damage_ignore_chance += numVal(eff?.value, 0) * slot.mult;
      } else if (et === 'on_direct_damage_counter') {
        const chance = (numVal(eff?.chance, 0) + (tlv > 1 ? (tlv - 1) * numVal(eff?.chancePerLevel, 0) : 0)) * slot.mult;
        const coeff = (numVal(eff?.damageCoeff, 0) + (tlv > 1 ? (tlv - 1) * numVal(eff?.damageCoeffPerLevel, 0) : 0)) * slot.mult;
        result.on_direct_damage_counter = { chance, damageCoeff: coeff };
      } else if (et === 'on_phys_damage_stasis' || et === 'on_direct_damage_stasis') {
        const chance = (numVal(eff?.chance, 0) + (tlv > 1 ? (tlv - 1) * numVal(eff?.levelBonus, 0) : 0)) * slot.mult;
        result.on_direct_damage_stasis = { chance, duration: intVal(eff?.duration, 1) };
      } else if (et === 'on_deal_damage_mana_burn') {
        const lvPct = numVal(eff?.value, numVal(eff?.mpBurnPct, 0));
        const lvBonusPct = numVal(eff?.levelBonus, 0);
        const mpBurnPct = Math.max(0, lvPct + (tlv > 1 ? (tlv - 1) * lvBonusPct : 0)) * slot.mult;
        const pvpBasePct = numVal(eff?.pvpValue, numVal(eff?.pvpMpBurnPct, mpBurnPct));
        const pvpBonusPct = numVal(eff?.pvpLevelBonus, lvBonusPct);
        const pvpMpBurnPct = Math.max(0, pvpBasePct + (tlv > 1 ? (tlv - 1) * pvpBonusPct : 0)) * slot.mult;
        result.on_deal_damage_mana_burn = {
          mpBurnPct,
          pvpMpBurnPct,
          pvpAsSpell: eff?.pvpAsSpell !== false
        };
      } else if (et === 'on_basic_attack_apply_jisheng' || et === 'on_direct_damage_apply_jisheng') {
        let dur = intVal(eff?.duration, 2);
        if (tlv >= (tech.levelCap || 99) && intVal(eff?.maxLevelDurationBonus, 0) > 0) {
          dur += intVal(eff.maxLevelDurationBonus, 0);
        }
        result.on_damage_jisheng = { duration: dur, damagePercent: numVal(eff?.damagePercent, 0.2) * slot.mult };
      } else if (et === 'basic_attack_as_spell') {
        const cb = numVal(eff?.coefficientBonus, 0);
        result.basic_attack_as_spell = {
          minValue: (numVal(eff?.minValue, 1.0) + cb * (tlv - 1)) * slot.mult,
          maxValue: (numVal(eff?.maxValue, 1.2) + cb * (tlv - 1)) * slot.mult
        };
      } else if (et === 'turn_end_mp') {
        result.turn_end_mp += Math.floor(val * Math.pow(2, tlv - 1) * slot.mult);
      } else if (et === 'turn_end_hp_mp') {
        result.turn_end_hp_pct += (numVal(eff?.hpPercent, 0) + (tlv > 1 ? (tlv - 1) * numVal(eff?.hpLevelBonus, 0) : 0)) * slot.mult;
        result.turn_end_mp_pct += (numVal(eff?.mpPercent, 0) + (tlv > 1 ? (tlv - 1) * numVal(eff?.mpLevelBonus, 0) : 0)) * slot.mult;
      } else if (et === 'battle_victory_heal') {
        result.battle_victory_heal_pct = (result.battle_victory_heal_pct || 0) + totalVal * slot.mult;
      } else if (et === 'damage_heal') {
        result.damage_heal_pct = (result.damage_heal_pct || 0) + totalVal * slot.mult;
      } else if (et === 'heal_damage') {
        result.heal_damage_pct = (result.heal_damage_pct || 0) + totalVal * slot.mult;
      } else if (et === 'turn_end_hp_percent') {
        result.turn_end_hp_max_pct += totalVal * slot.mult;
      } else if (et === 'phys_attack_multiplier') {
        result.phys_attack_mult *= val;
      } else if (et === 'heal_amplification') {
        result.heal_amp += totalVal * slot.mult;
      } else if (et === 'spell_pen_on_noncrit') {
        result.spell_pen_on_noncrit += totalVal * slot.mult;
      } else if (et === 'hp_above_spell_defense_bonus') {
        result.hp_above_spell_def_bonus = { threshold: numVal(eff?.threshold, 0.5), value: numVal(eff?.value, 0.15) * slot.mult };
      } else if (et === 'hp_below_spell_final_damage_bonus') {
        result.hp_below_spell_final_dmg = { threshold: numVal(eff?.threshold, 0.5), value: numVal(eff?.value, 0.10) * slot.mult };
      } else if (et === 'self_heal_forbid' || et === 'opponent_heal_forbid') {
        // 兼容旧配置 opponent_heal_forbid：现语义统一为“装配者自身禁疗”
        result.self_heal_forbid = true;
      } else if (et === 'hp_lost_damage_step_bonus') {
        const stepHpLost = clamp(numVal(eff?.stepHpLost, 0.1), 0.01, 1);
        const perStep = numVal(eff?.damageBonusPerStep, numVal(eff?.value, 0));
        const pvpPerStep = numVal(eff?.pvpDamageBonusPerStep, perStep);
        const perStepLvBonus = numVal(eff?.levelBonus, 0);
        const pvpPerStepLvBonus = numVal(eff?.pvpLevelBonus, perStepLvBonus);
        const finalPerStep = (perStep + (tlv > 1 ? (tlv - 1) * perStepLvBonus : 0)) * slot.mult;
        const finalPvpPerStep = (pvpPerStep + (tlv > 1 ? (tlv - 1) * pvpPerStepLvBonus : 0)) * slot.mult;
        const maxSteps = Math.max(1, intVal(eff?.maxSteps, 5));
        if (!result.hp_lost_damage_step_bonus) {
          result.hp_lost_damage_step_bonus = {
            stepHpLost,
            damageBonusPerStep: 0,
            pvpDamageBonusPerStep: 0,
            maxSteps
          };
        }
        result.hp_lost_damage_step_bonus.stepHpLost = Math.min(result.hp_lost_damage_step_bonus.stepHpLost, stepHpLost);
        result.hp_lost_damage_step_bonus.damageBonusPerStep += finalPerStep;
        result.hp_lost_damage_step_bonus.pvpDamageBonusPerStep += finalPvpPerStep;
        result.hp_lost_damage_step_bonus.maxSteps = Math.max(result.hp_lost_damage_step_bonus.maxSteps, maxSteps);
      } else if (et === 'phys_damage_equalize') {
        result.phys_damage_equalize = true;
      } else if (et === 'align_phys_spell_attack') {
        result.align_phys_spell_attack = true;
      } else if (et === 'boost_higher_of_strength_lingli_by_higher_of_constitution_zhenyuan') {
        result.high_str_or_lingli_from_high_con_or_zhenyuan_pct += totalVal * slot.mult;
      } else if (et === 'battle_start_temp_shield_from_spell_attack_percent') {
        result.battle_start_temp_shield_from_spell_attack_pct += totalVal * slot.mult;
      } else if (et === 'battle_start_moshen_jue') {
        const rounds = Math.max(1, intVal(eff?.rounds, 3));
        const atkBase = Math.max(0, numVal(eff?.attackBonusPct, numVal(eff?.value, 0.25)));
        const atkLvBonus = numVal(eff?.attackLevelBonus, numVal(eff?.levelBonus, 0));
        const lifestealBase = Math.max(0, numVal(eff?.physLifestealBonus, 0.05));
        const lifestealLvBonus = numVal(eff?.physLifestealLevelBonus, 0);
        const atkBonusPct = atkBase + (tlv > 1 ? (tlv - 1) * atkLvBonus : 0);
        const physLifestealBonus = lifestealBase + (tlv > 1 ? (tlv - 1) * lifestealLvBonus : 0);
        if (!result.battle_start_moshen_jue) {
          result.battle_start_moshen_jue = {
            rounds: 0,
            attackBonusPct: 0,
            physLifestealBonus: 0
          };
        }
        result.battle_start_moshen_jue.rounds = Math.max(result.battle_start_moshen_jue.rounds, rounds);
        result.battle_start_moshen_jue.attackBonusPct += Math.max(0, atkBonusPct) * slot.mult;
        result.battle_start_moshen_jue.physLifestealBonus += Math.max(0, physLifestealBonus) * slot.mult;
      } else if (et === 'on_damaged_reflect_if_temp_shield') {
        const basePct = numVal(eff?.value, numVal(eff?.spellAttackPct, 0));
        const lvPctBonus = numVal(eff?.levelBonus, numVal(eff?.spellAttackPctPerLevel, 0));
        const pvpBasePct = numVal(eff?.pvpValue, numVal(eff?.pvpSpellAttackPct, basePct));
        const pvpLvPctBonus = numVal(eff?.pvpLevelBonus, lvPctBonus);
        const spellAttackPct = Math.max(0, basePct + (tlv > 1 ? (tlv - 1) * lvPctBonus : 0)) * slot.mult;
        const pvpSpellAttackPct = Math.max(0, pvpBasePct + (tlv > 1 ? (tlv - 1) * pvpLvPctBonus : 0)) * slot.mult;
        if (!result.on_damaged_reflect_if_temp_shield) {
          result.on_damaged_reflect_if_temp_shield = { spellAttackPct: 0, pvpSpellAttackPct: 0 };
        }
        result.on_damaged_reflect_if_temp_shield.spellAttackPct += spellAttackPct;
        result.on_damaged_reflect_if_temp_shield.pvpSpellAttackPct += pvpSpellAttackPct;
      }
    }
  }
  return result;
}

function applyTechniqueHighAttrBoost(attrs, techEff) {
  const pct = clamp(numVal(techEff?.high_str_or_lingli_from_high_con_or_zhenyuan_pct, 0), 0, 10);
  if (pct <= 0) return;
  const base = Math.max(intVal(attrs.constitution, 0), intVal(attrs.zhenyuan, 0));
  const add = Math.max(0, Math.floor(base * pct));
  if (add <= 0) return;
  if (intVal(attrs.strength, 0) >= intVal(attrs.lingli, 0)) attrs.strength += add;
  else attrs.lingli += add;
}

/** 战斗胜利时，装配功法 battle_victory_heal 提供的回复量（max_hp 的百分比，如 7 表示 7%） */
function getBattleVictoryHealPercent(player) {
  const eff = calcEquippedTechEffects(player);
  return Math.max(0, numVal(eff.battle_victory_heal_pct, 0));
}

// ─── 灵根衍生属性 ───
// 五行淬炼法等功法被动灵根加成：与丹药独立加算，但功法被动最多把总值顶到 95；若基础(含丹药)已≥100 则保持
const SECT_REFINE_SPIRIT_ROOT_CAP = 95;
function calcSpiritRootBonuses(spiritRoots, passiveEffects) {
  const sr = spiritRoots && typeof spiritRoots === 'object' ? spiritRoots : {};
  const addCap = (base, bonus) => {
    const b = numVal(base, 0);
    const add = numVal(bonus, 0);
    if (b >= 100) return b;  // 基础已完美灵根，功法不覆盖
    return Math.min(SECT_REFINE_SPIRIT_ROOT_CAP, b + add);  // 功法被动最多顶到95
  };
  const metal = addCap(sr.metal, passiveEffects?.spirit_root_bonus?.metal);
  const wood = addCap(sr.wood, passiveEffects?.spirit_root_bonus?.wood);
  const water = addCap(sr.water, passiveEffects?.spirit_root_bonus?.water);
  const fire = addCap(sr.fire, passiveEffects?.spirit_root_bonus?.fire);
  const earth = addCap(sr.earth, passiveEffects?.spirit_root_bonus?.earth);

  const extraEarthPerPoint = passiveEffects?.earth_dmg_reduction_per_point || 0;
  const extraFirePerPoint = passiveEffects?.fire_spell_dmg_per_point || 0;
  const extraWoodPerPoint = passiveEffects?.wood_debuff_resist_per_point || 0;
  // 五灵根每点效率：金0.25%、木0.15%、水0.25%、火0.35%、土0.2%
  const METAL_EFF = 0.0025, WOOD_EFF = 0.0015, WATER_EFF = 0.0025, FIRE_EFF = 0.0035, EARTH_BASE = 0.002;

  return {
    metal, wood, water, fire, earth,
    armor_pen_percent: metal * METAL_EFF,
    damage_reduction: Math.min(0.85, earth * (EARTH_BASE + extraEarthPerPoint)),
    spell_damage_bonus: fire * (FIRE_EFF + extraFirePerPoint),
    heal_bonus: water * WATER_EFF,
    debuff_resistance: wood * (WOOD_EFF + extraWoodPerPoint),
    perfect_metal: metal >= 100,
    perfect_wood: wood >= 100,
    perfect_water: water >= 100,
    perfect_fire: fire >= 100,
    perfect_earth: earth >= 100
  };
}

// ─── 套装效果 ───
const SET_IDS = ['劫灭-斗战乾坤', '道妙-气象万千', '浩渺-云上青鸾', '厉火-焚天炽地', '玄黄-永生不灭', '异界-终结热寂', '异界-数据入侵', '太初-浑天无极'];

function calcSetBonuses(equipment) {
  const def = {
    phys_crit_rate: 0, set_5_jueyi: false, set_8_xurui: false,
    set_counts: {}, set_3: {}, set_5: {}, set_8: {}
  };
  if (!equipment || typeof equipment !== 'object') return def;
  const setCounts = {};
  const checkSlots = ['head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back'];
  for (const slotName of checkSlots) {
    const item = equipment[slotName];
    if (!item) continue;
    const setId = String(item.setId || item.exTemplate || '');
    if (setId) setCounts[setId] = (setCounts[setId] || 0) + 1;
  }
  let physCrit = 0, jueyi = false, xurui = false;
  const set3 = {}, set5 = {}, set8 = {};
  for (const [id, count] of Object.entries(setCounts)) {
    if (count >= 3) set3[id] = true;
    if (count >= 5) set5[id] = true;
    if (count >= 8) set8[id] = true;
    if (id === '劫灭-斗战乾坤') {
      if (count >= 3) physCrit += 0.15;
      if (count >= 5) jueyi = true;
      if (count >= 8) xurui = true;
    }
  }
  return {
    phys_crit_rate: physCrit, set_5_jueyi: jueyi, set_8_xurui: xurui,
    set_counts: setCounts, set_3: set3, set_5: set5, set_8: set8
  };
}

// ─── EX武器效果 ───
function getExWeaponEffect(equipment) {
  if (!equipment || typeof equipment !== 'object') return null;
  const weapon = equipment.weapon;
  if (!weapon) return null;
  const exT = String(weapon.exTemplate || '');
  if (!exT) return null;
  if (exT === '伏羲琴') return { type: 'fuxiqin', juechang_bonus_rounds: 1, spell_crit_damage_bonus: 0.12 };
  if (exT === '万古愁') return { type: 'wanguchou', random_debuff_on_music_skill: true };
  if (exT === '镇魂牙') return { type: 'zhenhunya', wood_affinity: 25, zhenhunya_source: 'weapon' };
  if (exT === '危月煞') return { type: 'weiyuesha', defense_divisor_reduction: 1000, phys_defense_bonus: 0.1, spell_defense_bonus: 0.1 };
  if (exT === '万法皆空') return { type: 'wanfajiekong', chance: 0.25, damage_per_state_pct: 0.35 };
  if (exT === '罪业一炬') return { type: 'zuiyeyiju', apply_chuanxin_on_phys: true, repeat_chuanxin_damage_pct: 0.2 };
  if (exT === '荒') return { type: 'huang', charge_can_act: true, charge_damage_mult: 0.5, non_charge_spell_pen: 0.12 };
  if (exT === '蛮') return { type: 'man', instant_charge_release: true, charge_damage_mult: 0.5, charge_kill_reset_cd: true };
  if (exT === '神鬼踏歌') return { type: 'shengguitage', spell_direct_splash_min: 0.25, spell_direct_splash_max: 0.35, solo_spell_final_damage_bonus: 0.13 };
  if (exT === '十方天华') return { type: 'shifangtianhua', adaptive_all_damage: true };
  if (exT === '天涯路') return { type: 'tianyalu', phys_crit_rate_bonus: 0.10, no_multi_hit_decay: true };
  if (exT === '恨别离') return {
    type: 'henbieli',
    henbieli_blossom_echo: true,
    henbieli_echo_coeff: 0.08,
    henbieli_echo_splash_ratio: 0.4,
    henbieli_pvp_factor: 0.65
  };
  if (exT === '苍生笔') return {
    type: 'cangshengbi',
    suppress_hybrid_heal: true,
    hunt_missing_hp_damage_pct: 0.18,
    hunt_execute_hp_ratio: 0.13
  };
  if (exT === '飞光') return { type: 'feiguang', counter_damage_bonus: 0.25, pvp_counter_damage_bonus: 0.15 };
  if (exT === '春秋') return { type: 'chunqiu', heal_on_damage_pct: 0.12, max_hp_extra_damage_pct: 0.03 };
  return null;
}

/** 乙木化生经提供镇魂牙原版战斗特效（物理延长debuff、法术按debuff回血） */
function getZhenhunyaFromTechnique(player) {
  const YIMU_HUASHENG_ID = 22;
  const techniques = player?.techniques;
  if (!techniques || typeof techniques !== 'object') return null;
  for (const slot of ['main', 'sub']) {
    const raw = techniques[slot];
    const tid = (raw && typeof raw === 'object' && raw.id != null) ? intVal(raw.id, 0) : intVal(raw, 0);
    if (tid !== YIMU_HUASHENG_ID) continue;
    const tech = getTechniqueById(tid);
    if (!tech || !_isTechniqueEquipRequirementMet(player, tech)) continue;
    return {
      extend_debuff_on_phys: true,
      heal_per_debuff_on_spell: 0.25,
      zhenhunya_source: 'technique'
    };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  快照构建
// ══════════════════════════════════════════════════════════════

/**
 * 规范化 player.equipment 和 player.techniques，确保 recalc 能正确读取
 * 处理：equipment 为数组/空、techniques 格式异常、旧数据结构等
 */
function normalizePlayerForCombat(player) {
  if (!player || typeof player !== 'object') return;
  // equipment 必须是 plain object，键为 slot 名
  if (!player.equipment || Array.isArray(player.equipment) || typeof player.equipment !== 'object') {
    player.equipment = {};
  }
  // techniques 必须有 main/sub，兼容 { main: id, sub: id } 等旧格式
  const techs = player.techniques;
  if (!techs || Array.isArray(techs) || typeof techs !== 'object') {
    player.techniques = { main: null, sub: null };
  } else {
    if (!Object.prototype.hasOwnProperty.call(techs, 'main')) techs.main = techs.main ?? null;
    if (!Object.prototype.hasOwnProperty.call(techs, 'sub')) techs.sub = techs.sub ?? null;
  }
}

/**
 * 根据基础属性 + 功法被动 + 装配功法 stats + 装备（武器/防具）重算战斗属性并写回 player，供客户端属性面板与战斗一致
 */
function recalcAndAssignCombatStats(player, force = false) {
  if (!player || typeof player !== 'object') return;
  normalizePlayerForCombat(player);
  const passiveEff = calcAllPassiveEffects(player);
  const techEff = calcEquippedTechEffects(player);
  const techAttr = _getEquippedTechniqueAttributeBonus(player);
  const eqAttr = _getEquippedEquipmentAttributeBonus(player);
  const talentAttr = getTalentAttributeBonus(player);
  const talentCombat = getTalentCombatBonus(player);
  const srBonus = calcSpiritRootBonuses(player?.spirit_roots, passiveEff);
  const effectiveEquipment = _getEffectiveEquipmentForPlayer(player);
  const setBonus = calcSetBonuses(effectiveEquipment);
  const exWeapon = getExWeaponEffect(effectiveEquipment);
  const weapStats = _getEquippedWeaponStats(player);
  const accStats = _getEquippedAccessoryAttackStats(player);
  const armorStats = _getEquippedArmorStats(player);
  const eqDamagePct = _getEquippedDamagePct(player);

  let strength = intVal(player?.strength, 10) + passiveEff.attribute_bonus.strength + techAttr.strength + eqAttr.strength + talentAttr.strength;
  let constitution = intVal(player?.constitution, 10) + passiveEff.attribute_bonus.constitution + techAttr.constitution + eqAttr.constitution + talentAttr.constitution;
  let boneRaw = intVal(player?.bone, 10) + passiveEff.attribute_bonus.bone + techAttr.bone + eqAttr.bone + talentAttr.bone;
  let agility = Math.max(0, numVal(player?.agility, 0) + passiveEff.attribute_bonus.agility + techAttr.agility + eqAttr.agility + talentAttr.agility);
  let zhenyuan = intVal(player?.zhenyuan, 10) + passiveEff.attribute_bonus.zhenyuan + techAttr.zhenyuan + eqAttr.zhenyuan + talentAttr.zhenyuan;
  let lingli = intVal(player?.lingli, 10) + passiveEff.attribute_bonus.lingli + techAttr.lingli + eqAttr.lingli + talentAttr.lingli;
  const spBuff = player?.spirit_pool_buff;
  if (spBuff && typeof spBuff === 'object') {
    const now = Math.floor(Date.now() / 1000);
    if ((intVal(spBuff.expires_at, 0) || 0) > now) {
      const attr = String(spBuff.attribute || '');
      const pct = Math.max(0, numVal(spBuff.bonus_pct, 0)) / 100;
      const add = (v) => Math.floor(v * pct);
      if (attr === 'strength') strength += add(strength);
      else if (attr === 'constitution') constitution += add(constitution);
      else if (attr === 'bone') boneRaw += add(boneRaw);
      else if (attr === 'agility') agility += add(agility);
      else if (attr === 'zhenyuan') zhenyuan += add(zhenyuan);
      else if (attr === 'lingli') lingli += add(lingli);
    }
  }
  const formationBonus = _getFormationCombatBonusSafe(player);
  const formationAttrs = _applyFormationAttributeBonuses({
    strength,
    constitution,
    bone: boneRaw,
    agility,
    zhenyuan,
    lingli
  }, formationBonus);
  strength = formationAttrs.strength;
  constitution = formationAttrs.constitution;
  boneRaw = formationAttrs.bone;
  agility = formationAttrs.agility;
  zhenyuan = formationAttrs.zhenyuan;
  lingli = formationAttrs.lingli;
  const boostedAttrs = { strength, constitution, zhenyuan, lingli };
  applyTechniqueHighAttrBoost(boostedAttrs, techEff);
  strength = boostedAttrs.strength;
  zhenyuan = boostedAttrs.zhenyuan;
  lingli = boostedAttrs.lingli;

  const formationSvcForRecalc = player?._formation_service_effects && typeof player._formation_service_effects === 'object'
    ? player._formation_service_effects
    : {};
  const fachaoEnabledForRecalc = !!formationSvcForRecalc.fachao_enabled;
  const fachaoBoneFloorForRecalc = Math.max(1, intVal(formationSvcForRecalc.fachao_bone_floor, 1));
  if (fachaoEnabledForRecalc && boneRaw > fachaoBoneFloorForRecalc) {
    const shiftedBone = boneRaw - fachaoBoneFloorForRecalc;
    boneRaw = fachaoBoneFloorForRecalc;
    zhenyuan += shiftedBone;
  }

  const boneMult = 1.0 + (boneRaw / 300.0) * 0.01;
  const defBonusPct = 1.0 + passiveEff.defense_bonus_percent;
  let defenseMult = 1.0, spellDefenseMult = 1.0;
  if (exWeapon?.phys_defense_bonus) defenseMult = 1.0 + exWeapon.phys_defense_bonus;
  if (exWeapon?.spell_defense_bonus) spellDefenseMult = 1.0 + exWeapon.spell_defense_bonus;

  const weapPhysMult = 1.0 + passiveEff.weapon_phys_attack_mult;
  const weapSpellMult = 1.0 + passiveEff.weapon_spell_attack_mult;
  const weapPhysBonus = Math.floor((weapStats.phys || 0) * (weapPhysMult - 1.0));
  const weapSpellBonus = Math.floor((weapStats.spell || 0) * (weapSpellMult - 1.0));
  const weapDmgPct = _getWeaponDamagePct(player);

  const weaponMinPhys = (weapStats.minPhys || weapStats.phys || 0) + weapPhysBonus;
  const weaponMaxPhys = (weapStats.maxPhys || weapStats.phys || 0) + weapPhysBonus;
  const weaponMinSpell = (weapStats.minSpell || weapStats.spell || 0) + weapSpellBonus;
  const accMinPhys = accStats.minPhys || 0;
  const accMaxPhys = accStats.maxPhys || 0;
  const accAvgSpell = Math.floor(((accStats.minSpell || 0) + (accStats.maxSpell || 0)) / 2);
  const physFromWeaponMin = srBonus.perfect_metal ? Math.floor(weaponMinPhys * 1.25) : weaponMinPhys;
  const physFromWeaponMax = weaponMaxPhys;
  const spellFromWeapon = srBonus.perfect_fire ? Math.floor(weaponMinSpell * 1.15) : weaponMinSpell;
  let minAttack = Math.max(1, Math.floor(strength * 0.3 * boneMult) + Math.floor(physFromWeaponMin * (1 + weapDmgPct.phys)) + accMinPhys);
  let maxAttack = Math.max(minAttack + 1, Math.floor(strength * 1.2 * boneMult) + Math.floor(physFromWeaponMax * (1 + weapDmgPct.phys)) + accMaxPhys);

  let baseDef = Math.floor(constitution * 0.25 * boneMult) * defBonusPct;
  let physDef = Math.max(0, Math.floor(baseDef) + armorStats.physDefense);
  if (defenseMult > 1.0) physDef = Math.floor(physDef * defenseMult);
  if (talentCombat.defense_pct_bonus > 0) {
    physDef = Math.floor(physDef * (1 + talentCombat.defense_pct_bonus));
  }
  if (talentCombat.phys_defense_pct_bonus > 0) {
    physDef = Math.floor(physDef * (1 + talentCombat.phys_defense_pct_bonus));
  }

  // 灵力影响法术攻击力；真元仅法力+法防，真元转法攻靠功法（如句芒经）
  const spellFromLingli = Math.floor(lingli * 0.8 * boneMult);
  const spellFromPassive = passiveEff.passive_spell_attack || 0;
  const spellFromZhenyuan = passiveEff.zhenyuan_to_spell_attack_pct > 0 ? Math.floor(zhenyuan * passiveEff.zhenyuan_to_spell_attack_pct) : 0;
  let spellAtk = Math.max(0, spellFromLingli + Math.floor(spellFromWeapon * (1 + weapDmgPct.spell)) + accAvgSpell + spellFromPassive + spellFromZhenyuan);
  if (talentCombat.phys_damage_pct_bonus > 0) {
    minAttack = Math.max(1, Math.floor(minAttack * (1 + talentCombat.phys_damage_pct_bonus)));
    maxAttack = Math.max(minAttack + 1, Math.floor(maxAttack * (1 + talentCombat.phys_damage_pct_bonus)));
  }
  if (talentCombat.spell_attack_pct_bonus > 0) {
    spellAtk = Math.max(0, Math.floor(spellAtk * (1 + talentCombat.spell_attack_pct_bonus)));
  }

  if (techEff.phys_damage_equalize && techEff.align_phys_spell_attack) {
    const unified = Math.max(1, Math.floor(Math.max(maxAttack, spellAtk) * 0.85));
    minAttack = unified;
    maxAttack = unified;
    spellAtk = unified;
  } else if (techEff.phys_damage_equalize) {
    const equalized = Math.max(1, Math.floor(maxAttack * 0.85));
    minAttack = equalized;
    maxAttack = equalized;
  } else if (techEff.align_phys_spell_attack) {
    const higher = Math.max(maxAttack, spellAtk);
    minAttack = higher;
    maxAttack = higher;
    spellAtk = higher;
  }

  let spellDef = Math.max(0, Math.floor(zhenyuan * 0.2 * boneMult * defBonusPct) + armorStats.spellDefense);
  if (spellDefenseMult > 1.0) spellDef = Math.floor(spellDef * spellDefenseMult);
  if (talentCombat.defense_pct_bonus > 0) {
    spellDef = Math.floor(spellDef * (1 + talentCombat.defense_pct_bonus));
  }
  if (talentCombat.spell_defense_pct_bonus > 0) {
    spellDef = Math.floor(spellDef * (1 + talentCombat.spell_defense_pct_bonus));
  }
  const fumoShentuActive = numVal(talentCombat.fumo_shentu_active, 0) > 0;
  if (fumoShentuActive) {
    const overPhysDef = Math.max(0, physDef - 6000);
    const overSpellDef = Math.max(0, spellDef - 6000);
    if (overPhysDef > 0) {
      const bonusAtk = Math.floor(overPhysDef * 0.5);
      minAttack = Math.max(1, minAttack + bonusAtk);
      maxAttack = Math.max(minAttack + 1, maxAttack + bonusAtk);
    }
    if (overSpellDef > 0) {
      spellAtk = Math.max(0, spellAtk + Math.floor(overSpellDef * 0.5));
    }
  }

  const maxHp = Math.max(1, Math.floor(constitution * 5 * boneMult) + armorStats.maxHp);
  const maxMp = Math.max(1, Math.floor(zhenyuan * 3 * boneMult));

  player.max_hp = maxHp;
  player.max_mp = maxMp;
  player.min_phys_damage = minAttack;
  player.max_phys_damage = maxAttack;
  player.phys_defense = physDef;
  player.spell_defense = spellDef;
  player.min_spell_attack = spellAtk;
  player.max_spell_attack = spellAtk;
  player.phys_damage_pct_bonus = Math.max(0, numVal(eqDamagePct.phys, 0));
  player.spell_damage_pct_bonus = Math.max(0, numVal(eqDamagePct.spell, 0));
  const curHp = intVal(player.hp, maxHp);
  const curMp = intVal(player.mp, maxMp);
  player.hp = curHp > 0 ? Math.min(curHp, maxHp) : maxHp;
  player.mp = clamp(curMp, 0, maxMp);
  // 供客户端显示：灵根基础+淬炼法等被动（战斗公式已用 srBonus，此处让界面展示一致）
  player.effective_spirit_roots = {
    metal: srBonus.metal, wood: srBonus.wood, water: srBonus.water,
    fire: srBonus.fire, earth: srBonus.earth
  };
  const baseStr = intVal(player?.strength, 10), baseCon = intVal(player?.constitution, 10);
  const baseBone = intVal(player?.bone, 10), baseZhy = intVal(player?.zhenyuan, 10);
  const baseLng = intVal(player?.lingli, 10), baseAgi = Math.max(0, numVal(player?.agility, 0));
  player.attr_bonus = {
    strength: strength - baseStr, constitution: constitution - baseCon,
    bone: boneRaw - baseBone, zhenyuan: zhenyuan - baseZhy,
    lingli: lingli - baseLng, agility: agility - baseAgi
  };

  const eqCritR = _getEquippedCritBonuses(player);
  const buffPhysCritR = readTimedBuffValue(player, 'phys_crit_rate_pct');
  player.crit_rate = clamp(
    0.05 + buffPhysCritR + techEff.phys_crit_rate_bonus + setBonus.phys_crit_rate + eqCritR.phys_crit_rate_bonus / 100 + formationBonus.phys_crit_rate_pct + Math.max(0, numVal(exWeapon?.phys_crit_rate_bonus, 0)) + talentCombat.phys_crit_rate_bonus, 0, 0.95);
  player.spell_crit_rate = clamp(
    passiveEff.spell_crit_rate_bonus + readTimedBuffValue(player, 'spell_crit_rate_pct') + eqCritR.spell_crit_rate_bonus / 100 + formationBonus.spell_crit_rate_pct + talentCombat.spell_crit_rate_bonus, 0, 0.95);
  player.equip_combat_power = calcTotalEquipCombatPower(player);
}

function buildPlayerSnapshot(player, opts = {}) {
  const skipInventory = opts.skipInventory === true;
  normalizePlayerForCombat(player);
  const passiveEff = calcAllPassiveEffects(player);
  const techEff = calcEquippedTechEffects(player, { isTeamBattle: opts.isTeamBattle === true });
  const techAttr = _getEquippedTechniqueAttributeBonus(player);
  const techElemAff = _getEquippedTechniqueElementAffinity(player);
  const talentElemAff = getTalentElementAffinityBonus(player);
  const talentCombat = getTalentCombatBonus(player);
  const eqAttr = _getEquippedEquipmentAttributeBonus(player);
  const talentAttr = getTalentAttributeBonus(player);
  const srBonus = calcSpiritRootBonuses(player?.spirit_roots, passiveEff);
  const effectiveEquipment = _getEffectiveEquipmentForPlayer(player);
  const setBonus = calcSetBonuses(effectiveEquipment);
  let exWeapon = getExWeaponEffect(effectiveEquipment);
  const techZhenhunya = getZhenhunyaFromTechnique(player);
  if (techZhenhunya) exWeapon = { ...(exWeapon || {}), ...techZhenhunya };
  const eqWoodAff = numVal(exWeapon?.wood_affinity, 0);
  const weapStats = _getEquippedWeaponStats(player);
  const accStats = _getEquippedAccessoryAttackStats(player);
  const armorStats = _getEquippedArmorStats(player);
  const eqDamagePct = _getEquippedDamagePct(player);
  const eqSplashPct = _getEquippedSplashPct(player);
  const formationBonus = _getFormationCombatBonusSafe(player);

  // 属性（含功法被动 + 装配功法 stats + 装备 stats + 灵池祝福）
  let strength = intVal(player?.strength, 10) + passiveEff.attribute_bonus.strength + techAttr.strength + eqAttr.strength + talentAttr.strength;
  let constitution = intVal(player?.constitution, 10) + passiveEff.attribute_bonus.constitution + techAttr.constitution + eqAttr.constitution + talentAttr.constitution;
  let boneRaw = intVal(player?.bone, 10) + passiveEff.attribute_bonus.bone + techAttr.bone + eqAttr.bone + talentAttr.bone;
  let zhenyuan = intVal(player?.zhenyuan, 10) + passiveEff.attribute_bonus.zhenyuan + techAttr.zhenyuan + eqAttr.zhenyuan + talentAttr.zhenyuan;
  let lingliRaw = intVal(player?.lingli, 10) + passiveEff.attribute_bonus.lingli + techAttr.lingli + eqAttr.lingli + talentAttr.lingli;
  let agility = Math.max(0, numVal(player?.agility, 0) + passiveEff.attribute_bonus.agility + techAttr.agility + eqAttr.agility + talentAttr.agility);
  const spBuff = player?.spirit_pool_buff;
  if (spBuff && typeof spBuff === 'object') {
    const now = Math.floor(Date.now() / 1000);
    if ((intVal(spBuff.expires_at, 0) || 0) > now) {
      const attr = String(spBuff.attribute || '');
      const pct = Math.max(0, numVal(spBuff.bonus_pct, 0)) / 100;
      const add = (v) => Math.floor(v * pct);
      if (attr === 'strength') strength += add(strength);
      else if (attr === 'constitution') constitution += add(constitution);
      else if (attr === 'bone') boneRaw += add(boneRaw);
      else if (attr === 'agility') agility += add(agility);
      else if (attr === 'zhenyuan') zhenyuan += add(zhenyuan);
      else if (attr === 'lingli') lingliRaw += add(lingliRaw);
    }
  }
  const formationAttrs = _applyFormationAttributeBonuses({
    strength,
    constitution,
    bone: boneRaw,
    agility,
    zhenyuan,
    lingli: lingliRaw
  }, formationBonus);
  strength = formationAttrs.strength;
  constitution = formationAttrs.constitution;
  boneRaw = formationAttrs.bone;
  agility = formationAttrs.agility;
  zhenyuan = formationAttrs.zhenyuan;
  lingliRaw = formationAttrs.lingli;
  const boostedAttrs = { strength, constitution, zhenyuan, lingli: lingliRaw };
  applyTechniqueHighAttrBoost(boostedAttrs, techEff);
  strength = boostedAttrs.strength;
  zhenyuan = boostedAttrs.zhenyuan;
  lingliRaw = boostedAttrs.lingli;

  const formationSvc = player?._formation_service_effects && typeof player._formation_service_effects === 'object'
    ? player._formation_service_effects
    : {};
  const fachaoEnabled = !!formationSvc.fachao_enabled;
  const fachaoBoneFloor = Math.max(1, intVal(formationSvc.fachao_bone_floor, 1));
  if (fachaoEnabled && boneRaw > fachaoBoneFloor) {
    const shiftedBone = boneRaw - fachaoBoneFloor;
    boneRaw = fachaoBoneFloor;
    zhenyuan += shiftedBone;
  }

  const boneMult = 1.0 + (boneRaw / 300.0) * 0.01;
  const isPvpBuild = isPvpBattleMode(opts.battleMode);
  const defBonusPct = isPvpBuild ? (1.0 + passiveEff.pvp_defense_bonus_percent) : (1.0 + passiveEff.defense_bonus_percent);
  let defenseMult = 1.0, spellDefenseMult = 1.0;
  if (exWeapon?.phys_defense_bonus) defenseMult = 1.0 + exWeapon.phys_defense_bonus;
  if (exWeapon?.spell_defense_bonus) spellDefenseMult = 1.0 + exWeapon.spell_defense_bonus;

  // 武器攻击力：基础值 + 功法乘数加成 + 戒指/护符攻击。武器上的物理/法术伤害%只对该件武器提供的攻击力生效
  const weapPhysMult = 1.0 + passiveEff.weapon_phys_attack_mult;
  const weapSpellMult = 1.0 + passiveEff.weapon_spell_attack_mult;
  const weapPhysBonus = Math.floor((weapStats.phys || 0) * (weapPhysMult - 1.0));
  const weapSpellBonus = Math.floor((weapStats.spell || 0) * (weapSpellMult - 1.0));
  const weapDmgPct = _getWeaponDamagePct(player);

  const weaponMinPhys = (weapStats.minPhys || weapStats.phys || 0) + weapPhysBonus;
  const weaponMaxPhys = (weapStats.maxPhys || weapStats.phys || 0) + weapPhysBonus;
  const weaponMinSpell = (weapStats.minSpell || weapStats.spell || 0) + weapSpellBonus;
  const accMinPhys = accStats.minPhys || 0;
  const accMaxPhys = accStats.maxPhys || 0;
  const accAvgSpell = Math.floor(((accStats.minSpell || 0) + (accStats.maxSpell || 0)) / 2);
  const physFromWeaponMin = srBonus.perfect_metal ? Math.floor(weaponMinPhys * 1.25) : weaponMinPhys;
  const physFromWeaponMax = weaponMaxPhys;
  const spellFromWeapon = srBonus.perfect_fire ? Math.floor(weaponMinSpell * 1.15) : weaponMinSpell;
  const physFromStrMin = Math.floor(strength * 0.3 * boneMult);
  const physFromStrMax = Math.floor(strength * 1.2 * boneMult);
  let minAttack = Math.max(1, physFromStrMin + Math.floor(physFromWeaponMin * (1 + weapDmgPct.phys)) + accMinPhys);
  let maxAttack = Math.max(minAttack + 1, physFromStrMax + Math.floor(physFromWeaponMax * (1 + weapDmgPct.phys)) + accMaxPhys);
  if (techEff.phys_attack_mult !== 1.0) {
    minAttack = Math.max(1, Math.floor(minAttack * techEff.phys_attack_mult));
    maxAttack = Math.max(minAttack + 1, Math.floor(maxAttack * techEff.phys_attack_mult));
  }

  // 太虚养剑术：物理最小=最大（无伤害浮动），物攻与法攻对齐至较高方
  // 注意：align 依赖 spellAttack，需要在 spellAttack 计算完成后一起应用（见下方）

  const basePhysDef = Math.floor(constitution * 0.25 * boneMult) * defBonusPct;
  let defense = Math.max(0, Math.floor(basePhysDef) + armorStats.physDefense);
  if (defenseMult > 1.0) defense = Math.floor(defense * defenseMult);
  // 灵力影响法术攻击力；真元仅法力+法防，真元转法攻靠功法（如句芒经）
  const spellFromLingli = Math.floor(lingliRaw * 0.8 * boneMult);
  const spellFromPassive = passiveEff.passive_spell_attack || 0;
  const spellFromZhenyuan = passiveEff.zhenyuan_to_spell_attack_pct > 0 ? Math.floor(zhenyuan * passiveEff.zhenyuan_to_spell_attack_pct) : 0;
  let spellAttack = Math.max(0, spellFromLingli + Math.floor(spellFromWeapon * (1 + weapDmgPct.spell)) + accAvgSpell + spellFromPassive + spellFromZhenyuan);

  if (techEff.phys_damage_equalize && techEff.align_phys_spell_attack) {
    const unified = Math.max(1, Math.floor(Math.max(maxAttack, spellAttack) * 0.85));
    minAttack = unified;
    maxAttack = unified;
    spellAttack = unified;
  } else if (techEff.phys_damage_equalize) {
    const equalized = Math.max(1, Math.floor(maxAttack * 0.85));
    minAttack = equalized;
    maxAttack = equalized;
  } else if (techEff.align_phys_spell_attack) {
    const higher = Math.max(maxAttack, spellAttack);
    minAttack = higher;
    maxAttack = higher;
    spellAttack = higher;
  }
  if (talentCombat.phys_damage_pct_bonus > 0) {
    minAttack = Math.max(1, Math.floor(minAttack * (1 + talentCombat.phys_damage_pct_bonus)));
    maxAttack = Math.max(minAttack + 1, Math.floor(maxAttack * (1 + talentCombat.phys_damage_pct_bonus)));
  }
  if (talentCombat.spell_attack_pct_bonus > 0) {
    spellAttack = Math.max(0, Math.floor(spellAttack * (1 + talentCombat.spell_attack_pct_bonus)));
  }

  const baseSpellDef = Math.floor(zhenyuan * 0.2 * boneMult * defBonusPct);
  let spellDefense = Math.max(0, Math.floor(baseSpellDef) + armorStats.spellDefense);
  if (spellDefenseMult > 1.0) spellDefense = Math.floor(spellDefense * spellDefenseMult);
  if (talentCombat.defense_pct_bonus > 0) {
    defense = Math.floor(defense * (1 + talentCombat.defense_pct_bonus));
    spellDefense = Math.floor(spellDefense * (1 + talentCombat.defense_pct_bonus));
  }
  if (talentCombat.phys_defense_pct_bonus > 0) {
    defense = Math.floor(defense * (1 + talentCombat.phys_defense_pct_bonus));
  }
  if (talentCombat.spell_defense_pct_bonus > 0) {
    spellDefense = Math.floor(spellDefense * (1 + talentCombat.spell_defense_pct_bonus));
  }
  const fumoShentuActive = numVal(talentCombat.fumo_shentu_active, 0) > 0;
  if (fumoShentuActive) {
    const overPhysDef = Math.max(0, defense - 6000);
    const overSpellDef = Math.max(0, spellDefense - 6000);
    if (overPhysDef > 0) {
      const bonusAtk = Math.floor(overPhysDef * 0.5);
      minAttack = Math.max(1, minAttack + bonusAtk);
      maxAttack = Math.max(minAttack + 1, maxAttack + bonusAtk);
    }
    if (overSpellDef > 0) {
      spellAttack = Math.max(0, spellAttack + Math.floor(overSpellDef * 0.5));
    }
  }
  const maxHp = Math.max(1, Math.floor(constitution * 5 * boneMult) + armorStats.maxHp);
  const maxMp = Math.max(1, Math.floor(zhenyuan * 3 * boneMult));
  const hp = intVal(player?.hp, maxHp) > 0 ? Math.min(intVal(player?.hp, maxHp), maxHp) : maxHp;
  const mp = clamp(intVal(player?.mp, maxMp), 0, maxMp);

  const buffWeaponDmg = readTimedBuffValue(player, 'weapon_damage_pct');
  const buffPhysCrit = readTimedBuffValue(player, 'phys_crit_rate_pct');
  const buffPhysLifesteal = readTimedBuffValue(player, 'phys_lifesteal_pct');
  const eqLifesteal = _getEquippedLifestealPct(player);
  // 武器与戒指/项链上的增伤词条都已并入上方攻击力计算，这里不再重复叠乘。

  const eqCrit = _getEquippedCritBonuses(player);
  const physCritRate = clamp(
    0.05 + buffPhysCrit + techEff.phys_crit_rate_bonus + setBonus.phys_crit_rate + eqCrit.phys_crit_rate_bonus / 100 + formationBonus.phys_crit_rate_pct + Math.max(0, numVal(exWeapon?.phys_crit_rate_bonus, 0)) + talentCombat.phys_crit_rate_bonus, 0, 0.95);
  const spellCritRate = clamp(
    passiveEff.spell_crit_rate_bonus + readTimedBuffValue(player, 'spell_crit_rate_pct') + eqCrit.spell_crit_rate_bonus / 100 + formationBonus.spell_crit_rate_pct + talentCombat.spell_crit_rate_bonus, 0, 0.95);
  const physCritMult = Math.max(1.0,
    1.35 + techEff.phys_crit_damage_bonus + eqCrit.phys_crit_damage_bonus / 100 + numVal(talentCombat.phys_crit_mult_bonus, 0));
  let spellCritMult = 1.35;
  if (exWeapon?.spell_crit_damage_bonus) spellCritMult += exWeapon.spell_crit_damage_bonus;
  spellCritMult += eqCrit.spell_crit_damage_bonus / 100;
  spellCritMult += numVal(talentCombat.spell_crit_mult_bonus, 0);
  const lifestealMul = Math.max(0, numVal(exWeapon?.lifesteal_efficiency_mul, 1));
  const lifesteal = clamp((techEff.phys_lifesteal + buffPhysLifesteal + eqLifesteal.phys + talentCombat.phys_lifesteal_bonus) * lifestealMul, 0, 0.8);
  const spellLifesteal = clamp(eqLifesteal.spell * lifestealMul, 0, 0.8);

  const armorPenRaw = srBonus.armor_pen_percent + techEff.physical_armor_pen + talentCombat.physical_armor_pen_bonus;
  const poshangShentuActive = numVal(talentCombat.poshang_shentu_active, 0) > 0;
  const yebaoShentuActive = numVal(talentCombat.yebao_shentu_active, 0) > 0;
  const zhanmoShentuActive = numVal(talentCombat.zhanmo_shentu_active, 0) > 0;
  const qishaShentuActive = numVal(talentCombat.qisha_shentu_active, 0) > 0;
  const xuefuShentuActive = numVal(talentCombat.xuefu_shentu_active, 0) > 0;
  const chaoshengShentuActive = numVal(talentCombat.chaosheng_shentu_active, 0) > 0;
  const kurongShentuActive = numVal(talentCombat.kurong_shentu_active, 0) > 0;
  const fenjieShentuActive = numVal(talentCombat.fenjie_shentu_active, 0) > 0;
  const guiyiShentuActive = numVal(talentCombat.guiyi_shentu_active, 0) > 0;
  const taixuanShentuActive = numVal(talentCombat.taixuan_shentu_active, 0) > 0;
  const taixuShentuActive = numVal(talentCombat.taixu_shentu_active, 0) > 0;
  const zhanmoExecuteRatio = zhanmoShentuActive ? (clamp(Math.max(0, numVal(armorPenRaw, 0)), 0, 0.9) / 4) : 0;
  const armorPen = zhanmoShentuActive ? 0 : armorPenRaw;
  const spellArmorPen = techEff.spell_armor_pen + talentCombat.spell_armor_pen_bonus;
  const spellPenOnNoncrit = techEff.spell_pen_on_noncrit;
  let defenseDivisorReduction = techEff.defense_divisor_reduction;
  if (exWeapon?.defense_divisor_reduction) defenseDivisorReduction += exWeapon.defense_divisor_reduction;
  const defenseDivisor = Math.max(100, 8000 - defenseDivisorReduction);
  const weaponDmgPct = buffWeaponDmg;
  const spellFinalDmgPct = srBonus.spell_damage_bonus + techEff.spell_final_damage_pct;

  const equippedSkills = Array.isArray(player?.equipped_skills)
    ? player.equipped_skills.map(x => intVal(x, 0)).filter(x => x > 0) : [];
  const keySkillId = intVal(player?.key_skill_id, 0);
  const weapon_type = _getEquippedWeaponType(player);
  const combatManaBurstPct = clamp(numVal(formationSvc.combat_mana_burst_pct, 0), 0, 1);
  const hasHitCountField = Number.isFinite(Number(formationSvc.skill_multi_hit_count));
  const yanmianHitCount = hasHitCountField
    ? intVal(formationSvc.skill_multi_hit_count, 0)
    : (formationSvc.yanmian_multi2 ? 2 : 0);
  const yanmianMulti2 = yanmianHitCount >= 2;
  const yanmianHitDamageMul = clamp(numVal(formationSvc.skill_multi_hit_damage_mul, formationSvc.yanmian_hit_damage_mul || 0.7), 0, 1);
  const shenguangEnabled = !!formationSvc.shenguang_enabled;
  const shenguangSpellDamageRatio = clamp(numVal(formationSvc.shenguang_spell_damage_ratio, 0.15), 0, 1);
  const daotiOverhealToTempShield = !!formationSvc.daoti_overheal_to_temp_shield;
  const mergedCounter = (() => {
    const base = techEff.on_direct_damage_counter || null;
    const extraChance = Math.max(0, numVal(talentCombat.counter_chance_bonus, 0));
    const extraCoeff = Math.max(0, numVal(talentCombat.counter_coeff_bonus, 0));
    if (!base && extraChance <= 0 && extraCoeff <= 0) return null;
    return {
      chance: clamp(numVal(base?.chance, 0) + extraChance, 0, 0.95),
      damageCoeff: Math.max(0, numVal(base?.damageCoeff, 0) + extraCoeff)
    };
  })();

  return {
    tag: opts?.tag || 'player',
    account_id: intVal(player?.account_id, 0),
    strength, constitution, bone: boneRaw, zhenyuan, lingli: lingliRaw, agility,
    name: String(player?.name || '修仙者'),
    level: intVal(player?.level, 1),
    spirit_stones: Math.max(0, intVal(player?.spirit_stones, 0)),
    hp, max_hp: maxHp, mp, max_mp: maxMp,
    min_attack: minAttack, max_attack: maxAttack,
    defense, spell_attack: spellAttack, spell_defense: spellDefense,
    crit_rate: physCritRate, spell_crit_rate: spellCritRate,
    crit_mult: physCritMult, spell_crit_mult: spellCritMult,
    lifesteal, spell_lifesteal: spellLifesteal,
    action_speed: calcActionSpeed(agility),
    action_bar: 0,
    equipped_skills: equippedSkills,
    key_skill_id: equippedSkills.includes(keySkillId) ? keySkillId : 0,
    key_skill_miss_turns: 0,
    weapon_type,
    skill_levels: player?.skill_levels && typeof player.skill_levels === 'object' ? deepClone(player.skill_levels) : {},
    technique_levels: player?.technique_levels && typeof player.technique_levels === 'object' ? { ...player.technique_levels } : {},
    skill_cooldowns: {},
    weapon_damage_pct: weaponDmgPct,
    phys_damage_pct_bonus: Math.max(0, numVal(eqDamagePct.phys, 0)),
    spell_damage_pct_bonus: Math.max(0, numVal(eqDamagePct.spell, 0)),
    phys_flat_damage: 0,
    spell_flat_damage: 0,
    phys_splash_pct: clamp(numVal(eqSplashPct.phys, 0), 0, 0.8),
    spell_splash_pct: clamp(numVal(eqSplashPct.spell, 0), 0, 0.8),
    inventory: skipInventory ? [] : (Array.isArray(player?.inventory) ? deepClone(player.inventory) : []),
    armor_pen: armorPen,
    spell_armor_pen: spellArmorPen,
    phys_hit_target_max_hp_extra_pct: Math.max(0, numVal(talentCombat.phys_hit_target_max_hp_extra_pct_bonus, 0)),
    phys_hit_self_def_extra_pct: Math.max(0, numVal(talentCombat.phys_hit_self_def_extra_pct_bonus, 0)),
    phys_damage_reduction_bonus: clamp(numVal(talentCombat.phys_damage_reduction_bonus, 0), 0, 0.6),
    spell_damage_reduction_bonus: clamp(numVal(talentCombat.spell_damage_reduction_bonus, 0), 0, 0.6),
    counter_heal_ratio: clamp(numVal(talentCombat.counter_heal_ratio_bonus, 0), 0, 0.8),
    counter_skill_hit_chance_bonus: clamp(numVal(talentCombat.counter_skill_hit_chance_bonus, 0), 0, 0.5),
    phys_execute_bonus_max: clamp(numVal(talentCombat.phys_execute_bonus_max, 0), 0, 0.5),
    phys_extra_strike_chance: clamp(numVal(talentCombat.phys_extra_strike_chance_bonus, 0), 0, 0.8),
    phys_extra_strike_damage_pct: clamp(numVal(talentCombat.phys_extra_strike_damage_pct_bonus, 0), 0, 1),
    dot_damage_pct_bonus: clamp(numVal(talentCombat.dot_damage_pct_bonus, 0), 0, 1),
    wood_dot_damage_pct_bonus: clamp(numVal(talentCombat.wood_dot_damage_pct_bonus, 0), 0, 1),
    fumo_shentu_active: fumoShentuActive,
    poshang_shentu_active: poshangShentuActive,
    yebao_shentu_active: yebaoShentuActive,
    zhanmo_shentu_active: zhanmoShentuActive,
    qisha_shentu_active: qishaShentuActive,
    xuefu_shentu_active: xuefuShentuActive,
    zhanmo_execute_ratio: clamp(numVal(zhanmoExecuteRatio, 0), 0, 0.5),
    chaosheng_shentu_active: chaoshengShentuActive,
    kurong_shentu_active: kurongShentuActive,
    fenjie_shentu_active: fenjieShentuActive,
    guiyi_shentu_active: guiyiShentuActive,
    taixuan_shentu_active: taixuanShentuActive,
    fenjie_yanshi_stacks: 0,
    fenjie_base_spell_final_damage_pct: spellFinalDmgPct,
    taixu_shentu_active: taixuShentuActive,
    spell_crit_ignore_spell_defense: techEff.spell_crit_ignore_spell_defense,
    spell_pen_on_noncrit: spellPenOnNoncrit,
    damage_reduction: srBonus.damage_reduction,
    spell_final_damage_pct: spellFinalDmgPct,
    heal_bonus: srBonus.heal_bonus + techEff.heal_amp + numVal(talentCombat.heal_bonus, 0),
    metal_affinity: (techElemAff.metal || 0) + (talentElemAff.metal || 0),
    wood_affinity: (techElemAff.wood || 0) + (talentElemAff.wood || 0) + eqWoodAff,
    water_affinity: (techElemAff.water || 0) + (talentElemAff.water || 0),
    fire_affinity: (techElemAff.fire || 0) + (talentElemAff.fire || 0),
    earth_affinity: (techElemAff.earth || 0) + (talentElemAff.earth || 0),
    hunyuan_affinity: talentElemAff.hunyuan || 0,
    wu_affinity: talentElemAff.neutral || 0,
    defense_divisor: defenseDivisor,
    debuff_resistance: srBonus.debuff_resistance,
    direct_damage_ignore_chance: techEff.direct_damage_ignore_chance,
    battle_start_temp_shield_from_spell_attack_pct: Math.max(0, numVal(techEff.battle_start_temp_shield_from_spell_attack_pct, 0)),
    on_shielded_damaged_reflect: techEff.on_damaged_reflect_if_temp_shield ? { ...techEff.on_damaged_reflect_if_temp_shield } : null,
    moshen_jue_rounds: Math.max(0, intVal(techEff.battle_start_moshen_jue?.rounds, 0)),
    moshen_jue_attack_bonus_pct: Math.max(0, numVal(techEff.battle_start_moshen_jue?.attackBonusPct, 0)),
    moshen_jue_phys_lifesteal_bonus: clamp(numVal(techEff.battle_start_moshen_jue?.physLifestealBonus, 0), 0, 0.8),
    moshen_jue_applied: false,
    moshen_jue_defense_backup: null,
    moshen_jue_spell_defense_backup: null,
    moshen_jue_min_attack_backup: null,
    moshen_jue_max_attack_backup: null,
    moshen_jue_spell_attack_backup: null,
    moshen_jue_lifesteal_backup: null,
    on_counter: mergedCounter,
    on_stasis: techEff.on_direct_damage_stasis,
    on_deal_damage_mana_burn: techEff.on_deal_damage_mana_burn ? { ...techEff.on_deal_damage_mana_burn } : null,
    on_jisheng: techEff.on_damage_jisheng,
    self_heal_forbid: Boolean(techEff.self_heal_forbid || exWeapon?.self_heal_forbid),
    heal_except_lifesteal: Boolean(exWeapon?.heal_except_lifesteal),
    hp_lost_damage_step_bonus: techEff.hp_lost_damage_step_bonus ? { ...techEff.hp_lost_damage_step_bonus } : null,
    jisheng_dot_mastery: passiveEff.jisheng_dot_mastery || null,
    hp_above_spell_def_bonus: techEff.hp_above_spell_def_bonus,
    hp_below_spell_final_dmg: techEff.hp_below_spell_final_dmg,
    damage_heal_pct: numVal(techEff.damage_heal_pct, 0),
    heal_damage_pct: numVal(techEff.heal_damage_pct, 0),
    basic_attack_as_spell: techEff.basic_attack_as_spell,
    turn_end_mp: techEff.turn_end_mp + _getEquippedTurnEndMp(player) + Math.max(0, Math.floor(maxMp * formationBonus.turn_end_mp_pct_of_max_mp)),
    turn_end_hp_pct: techEff.turn_end_hp_pct,
    turn_end_mp_pct: techEff.turn_end_mp_pct,
    turn_end_hp_max_pct: techEff.turn_end_hp_max_pct,
    abaddon_rebirth_once: !!formationBonus.abaddon_rebirth_once,
    combat_mana_burst_pct: combatManaBurstPct,
    yanmian_multi2: yanmianMulti2,
    yanmian_hit_damage_mul: yanmianHitDamageMul,
    shenguang_spell_absolute: shenguangEnabled,
    shenguang_spell_damage_ratio: shenguangSpellDamageRatio,
    daoti_overheal_to_temp_shield: daotiOverhealToTempShield,
    heal_others_self_heal: passiveEff.heal_others_self_heal || 0,
    ex_weapon: exWeapon,
    set_5_jueyi: setBonus.set_5_jueyi,
    set_8_xurui: setBonus.set_8_xurui,
    set_counts: setBonus.set_counts || {},
    set_3: setBonus.set_3 || {},
    set_5: setBonus.set_5 || {},
    set_8: setBonus.set_8 || {},
    perfect_water: srBonus.perfect_water,
    perfect_wood: srBonus.perfect_wood,
    perfect_earth: srBonus.perfect_earth,
    // 状态
    debuffs: [],
    chuanxin_rounds: 0,
    nuozhan_rounds: 0,
    juechang_rounds: 0,
    beishui_rounds: 0,
    xurui: { active: false, duration: 0 },
    yangjing: { active: false, duration: 0 },
    jingzhun: { active: false, duration: 0 },
    zhuanzhu: { active: false, duration: 0 },
    jianxin: Boolean(player?.jianxin),
    fear_rounds: 0,
    slow_effect: null,
    chengfeng: null,
    juemai_rounds: 0,
    bofa_rounds: 0,
    daifa_rounds: 0,
    jiangu: null,
    fumo_rounds: 0,
    jueyi_stacks: 0,
    jueyi_action_count: 0,
    stasis_rounds: 0,
    stasis_guard_active: false,
    mark_rounds: 0,
    zhuohun_rounds: 0,
    zhuohun_heal_reduce: 0,
    wenluan_rounds: 0,
    wenluan_ratio: 0,
    zhendang_rounds: 0,
    zhendang_spell_attack_stored: 0,
    zhendang_spell_defense_stored: 0,
    xuli: null,
    yinyang_state: 'yin',
    is_ally: true,
    alive: true,
    // 五套装状态
    qixiang_list: [],
    daomiao_active: false,
    daomiao_no_more_qixiang: false,
    zhuoshao_rounds: 0,
    fenjin_active: false,
    tudun_rounds: 0,
    xuanhuang_slow_until_end: false,
    hunchong_stacks: 0,
    heal_forbidden: Boolean(techEff.self_heal_forbid),
    next_action_heal_pct: 0,
    next_action_heal_pvp_pct: 0,
    taichu_karma: 0,
    temp_shield: 0,
    data_invasion_hit_counter: 0,
    data_invasion_pvp_weaken_rounds: 0,
    data_invasion_pvp_weaken_min_attack_stored: 0,
    data_invasion_pvp_weaken_max_attack_stored: 0,
    data_invasion_pvp_weaken_spell_attack_stored: 0
  };
}

function buildEnemySnapshot(enemy, index) {
  const enemyLevel = intVal(enemy?.level, 1);
  // 灵界怪在进入战斗前已做过按玩家与地图环境的专项缩放，
  // 这里不再叠加“金丹及以上全局翻倍”规则，避免把270锚点再次抬高。
  const lingjieScaled = Boolean(enemy?._lingjie_scaled);
  const isGoldenCoreOrAbove = enemyLevel >= 161;
  const hpMult = (isGoldenCoreOrAbove && !lingjieScaled) ? 2.0 : 1.0;
  const atkMult = (isGoldenCoreOrAbove && !lingjieScaled) ? 1.5 : 1.0;
  const baseHp = Math.max(1, intVal(enemy?.hp, 1));
  const maxHp = Math.max(1, Math.floor(baseHp * hpMult));
  const baseAtk = intVal(enemy?.attack, 10);
  const agility = Math.max(0, numVal(enemy?.agility, 0));
  const baseSpAtk = Math.max(0, intVal(enemy?.spellAttack, 0));
  const spAtk = Math.max(0, Math.floor(baseSpAtk * atkMult));
  const equippedSkills = Array.isArray(enemy?.skills)
    ? enemy.skills.map(x => intVal(x, 0)).filter(x => x > 0) : [];
  const skillLevels = enemy?.skill_levels && typeof enemy.skill_levels === 'object'
    ? deepClone(enemy.skill_levels) : {};
  return {
    tag: index !== undefined ? `enemy_${index}` : 'enemy',
    index: index !== undefined ? index : 0,
    id: intVal(enemy?.id, 0),
    account_id: intVal(enemy?.account_id, 0),
    name: String(enemy?.name || '敌人'),
    type: String(enemy?.type || 'beast'),
    is_ally: false,
    level: enemyLevel,
    hp: maxHp, max_hp: maxHp,
    mp: Math.max(0, intVal(enemy?.mp, 0)),
    max_mp: Math.max(0, intVal(enemy?.mp, 0)),
    min_attack: Math.max(1, Math.floor(baseAtk * atkMult * 0.8)),
    max_attack: Math.max(1, Math.floor(baseAtk * atkMult * 1.2)),
    defense: Math.max(0, intVal(enemy?.defense, 0)),
    spell_attack: spAtk,
    spell_defense: Math.max(0, Math.floor(intVal(enemy?.defense, 0) * 0.6)),
    agility,
    action_speed: calcActionSpeed(agility),
    action_bar: 0,
    equipped_skills: equippedSkills,
    key_skill_id: intVal(enemy?.key_skill_id, 0),
    key_skill_miss_turns: intVal(enemy?.key_skill_miss_turns, 0),
    weapon_type: String(enemy?.weapon_type || enemy?.weaponType || ''),
    skill_levels: skillLevels,
    skill_cooldowns: {},
    crit_rate: clamp(numVal(enemy?.crit_rate, 0.03), 0, 0.95),
    crit_mult: Math.max(1.0, numVal(enemy?.crit_mult, 1.5)),
    spell_crit_rate: clamp(numVal(enemy?.spell_crit_rate, 0), 0, 0.95),
    spell_crit_mult: Math.max(1.0, numVal(enemy?.spell_crit_mult, 1.35)),
    lifesteal: clamp(numVal(enemy?.lifesteal, 0), 0, 0.8),
    spell_lifesteal: clamp(numVal(enemy?.spell_lifesteal, 0), 0, 0.8),
    armor_pen: clamp(numVal(enemy?.armor_pen, 0), 0, 0.9),
    spell_armor_pen: clamp(numVal(enemy?.spell_armor_pen, 0), 0, 0.9),
    fumo_shentu_active: Boolean(enemy?.fumo_shentu_active),
    poshang_shentu_active: Boolean(enemy?.poshang_shentu_active),
    yebao_shentu_active: Boolean(enemy?.yebao_shentu_active),
    zhanmo_shentu_active: Boolean(enemy?.zhanmo_shentu_active),
    qisha_shentu_active: Boolean(enemy?.qisha_shentu_active),
    xuefu_shentu_active: Boolean(enemy?.xuefu_shentu_active),
    zhanmo_execute_ratio: clamp(numVal(enemy?.zhanmo_execute_ratio, 0), 0, 0.5),
    chaosheng_shentu_active: Boolean(enemy?.chaosheng_shentu_active),
    kurong_shentu_active: Boolean(enemy?.kurong_shentu_active),
    fenjie_shentu_active: Boolean(enemy?.fenjie_shentu_active),
    guiyi_shentu_active: Boolean(enemy?.guiyi_shentu_active),
    taixuan_shentu_active: Boolean(enemy?.taixuan_shentu_active),
    fenjie_yanshi_stacks: Math.max(0, intVal(enemy?.fenjie_yanshi_stacks, 0)),
    fenjie_base_spell_final_damage_pct: Math.max(0, numVal(enemy?.fenjie_base_spell_final_damage_pct, enemy?.spell_final_damage_pct || 0)),
    taixu_shentu_active: Boolean(enemy?.taixu_shentu_active),
    spell_crit_ignore_spell_defense: clamp(numVal(enemy?.spell_crit_ignore_spell_defense, 0), 0, 0.9),
    spell_final_damage_pct: (() => {
      const base = Math.max(0, numVal(enemy?.fenjie_base_spell_final_damage_pct, enemy?.spell_final_damage_pct || 0));
      const stacks = Math.max(0, intVal(enemy?.fenjie_yanshi_stacks, 0));
      const active = Boolean(enemy?.fenjie_shentu_active);
      return active ? (base + stacks * 0.05) : Math.max(0, numVal(enemy?.spell_final_damage_pct, 0));
    })(),
    phys_flat_damage: Math.max(0, intVal(enemy?.phys_flat_damage, 0)),
    spell_flat_damage: Math.max(0, intVal(enemy?.spell_flat_damage, 0)),
    phys_splash_pct: clamp(numVal(enemy?.phys_splash_pct, 0), 0, 0.8),
    spell_splash_pct: clamp(numVal(enemy?.spell_splash_pct, 0), 0, 0.8),
    turn_end_mp: Math.max(0, intVal(enemy?.turn_end_mp, 0)),
    turn_end_hp_pct: Math.max(0, numVal(enemy?.turn_end_hp_pct, 0)),
    turn_end_mp_pct: Math.max(0, numVal(enemy?.turn_end_mp_pct, 0)),
    basic_attack_as_spell: enemy?.basic_attack_as_spell || null,
    on_stasis: enemy?.on_stasis || null,
    on_jisheng: enemy?.on_jisheng || null,
    on_counter: enemy?.on_counter || null,
    battle_start_temp_shield_from_spell_attack_pct: Math.max(0, numVal(enemy?.battle_start_temp_shield_from_spell_attack_pct, 0)),
    on_shielded_damaged_reflect: enemy?.on_shielded_damaged_reflect && typeof enemy.on_shielded_damaged_reflect === 'object'
      ? deepClone(enemy.on_shielded_damaged_reflect)
      : null,
    self_heal_forbid: Boolean(enemy?.self_heal_forbid || enemy?.opponent_heal_forbid),
    hp_lost_damage_step_bonus: enemy?.hp_lost_damage_step_bonus ? deepClone(enemy.hp_lost_damage_step_bonus) : null,
    heal_forbidden: Boolean(enemy?.heal_forbidden || enemy?.self_heal_forbid || enemy?.opponent_heal_forbid),
    next_action_heal_pct: Math.max(0, numVal(enemy?.next_action_heal_pct, 0)),
    next_action_heal_pvp_pct: Math.max(0, numVal(enemy?.next_action_heal_pvp_pct, 0)),
    debuffs: [],
    chuanxin_rounds: 0,
    fear_rounds: 0,
    slow_effect: null,
    stasis_rounds: 0,
    stasis_guard_active: Boolean(enemy?.stasis_guard_active && intVal(enemy?.stasis_rounds, 0) > 0),
    mark_rounds: 0,
    juemai_rounds: 0,
    fumo_rounds: 0,
    jiangwen_stacks: 0,
    dongshang_stacks: 0,
    xuanhuang_slow_until_end: false,
    zhuohun_rounds: 0,
    zhuohun_heal_reduce: 0,
    wenluan_rounds: 0,
    wenluan_ratio: 0,
    zhendang_rounds: 0,
    zhendang_spell_attack_stored: 0,
    zhendang_spell_defense_stored: 0,
    xuli: null,
    jianxin: Boolean(enemy?.jianxin),
    yinyang_state: 'yin',
    taichu_karma: 0,
    temp_shield: Math.max(0, intVal(enemy?.temp_shield, 0)),
    data_invasion_hit_counter: Math.max(0, intVal(enemy?.data_invasion_hit_counter, 0)),
    data_invasion_pvp_weaken_rounds: Math.max(0, intVal(enemy?.data_invasion_pvp_weaken_rounds, 0)),
    data_invasion_pvp_weaken_min_attack_stored: Math.max(0, intVal(enemy?.data_invasion_pvp_weaken_min_attack_stored, 0)),
    data_invasion_pvp_weaken_max_attack_stored: Math.max(0, intVal(enemy?.data_invasion_pvp_weaken_max_attack_stored, 0)),
    data_invasion_pvp_weaken_spell_attack_stored: Math.max(0, intVal(enemy?.data_invasion_pvp_weaken_spell_attack_stored, 0)),
    alive: true
  };
}

// ══════════════════════════════════════════════════════════════
//  Debuff 系统
// ══════════════════════════════════════════════════════════════

function _resolveDotBaseFromUnit(unit, attribute) {
  const attr = String(attribute || 'spell_attack');
  if (attr === 'spell_attack') return numVal(unit.spell_attack, 0) || numVal(unit.spellAttack, 0);
  if (attr === 'max_attack') return numVal(unit.max_attack, 0) || numVal(unit.attack, 0) || Math.floor((numVal(unit.min_attack, 0) + numVal(unit.max_attack, 0)) / 2);
  if (attr === 'min_attack') return numVal(unit.min_attack, 0) || numVal(unit.attack, 0);
  if (attr === 'highest_attr') {
    return Math.max(
      1,
      numVal(unit.strength, 0),
      numVal(unit.constitution, 0),
      numVal(unit.bone, 0),
      numVal(unit.agility, 0),
      numVal(unit.zhenyuan, 0),
      numVal(unit.lingli, 0)
    );
  }
  if (attr === 'max_hp') return Math.max(1, numVal(unit.max_hp, 1));
  return numVal(unit[attr], 0);
}

function _getDebuffRangePercent(debuff) {
  if (!debuff || typeof debuff !== 'object') return null;
  const minRaw = numVal(debuff.damagePercentMin, NaN);
  const maxRaw = numVal(debuff.damagePercentMax, NaN);
  const hasMin = Number.isFinite(minRaw);
  const hasMax = Number.isFinite(maxRaw);
  if (!hasMin && !hasMax) return null;
  const fallback = Math.max(0, numVal(debuff.damagePercent, 0.05));
  const realMin = hasMin ? Math.max(0, minRaw) : fallback;
  const realMax = hasMax ? Math.max(0, maxRaw) : fallback;
  // 兼容历史脏数据：若区间被写成 0~0 且存在正常 damagePercent，回退为普通 DOT
  if (realMin <= 0 && realMax <= 0 && fallback > 0) return null;
  return {
    min: Math.min(realMin, realMax),
    max: Math.max(realMin, realMax)
  };
}

function _resolveDebuffTickPercent(debuff, state) {
  const range = _getDebuffRangePercent(debuff);
  if (!range) return Math.max(0, numVal(debuff?.damagePercent, 0.05));
  if (range.max <= range.min) return range.min;
  return range.min + nextRand01(state) * (range.max - range.min);
}

function _resolveDebuffExplodePercent(debuff) {
  const range = _getDebuffRangePercent(debuff);
  if (!range) return Math.max(0, numVal(debuff?.damagePercent, 0.05));
  return (range.min + range.max) / 2;
}

function _resolveDebuffPeakPercent(debuff) {
  const range = _getDebuffRangePercent(debuff);
  if (!range) return Math.max(0, numVal(debuff?.damagePercent, 0.05));
  return range.max;
}

function _getUnitSourceKey(unit) {
  if (!unit || typeof unit !== 'object') return '';
  const aid = intVal(unit.account_id, 0);
  if (aid > 0) return `aid:${aid}`;
  const tag = String(unit.tag || '').trim();
  if (tag) return `tag:${tag}`;
  const idx = intVal(unit.index, -1);
  if (idx >= 0) return `${unit.is_ally ? 'ally' : 'enemy'}idx:${idx}`;
  const uid = intVal(unit.id, 0);
  if (uid > 0) return `${unit.is_ally ? 'ally' : 'enemy'}id:${uid}`;
  return '';
}

function applyDebuff(unit, debuff, state, attacker) {
  if (!unit || !debuff) return [];
  if (isDebuffImmune(unit)) {
    return [{ t: 'combat_log', actor: unit.tag || 'enemy', target: unit.tag || 'enemy',
      action: 'stasis_guard', text: `${unit.name} 处于凝滞护体，免疫负面状态` }];
  }
  const resist = numVal(unit.debuff_resistance, 0);
  if (resist > 0 && nextRand01(state) < resist) {
    return [{ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
      action: 'resist', text: `${unit.name} 抵抗了负面效果！` }];
  }
  let stacks = intVal(debuff.stacks, 3);
  if (attacker && getHaomiaoDotBonus(attacker) > 0) stacks += 1;
  if (!Array.isArray(unit.debuffs)) unit.debuffs = [];
  const attr = String(debuff.attribute || 'max_hp');
  const debuffObj = {
    type: String(debuff.type || 'bleed'),
    stacks,
    damagePercent: numVal(debuff.damagePercent, 0.05),
    attribute: attr,
    ignoreDefense: Boolean(debuff.ignoreDefense),
    effect_stacks: 1
  };
  const dotRange = _getDebuffRangePercent(debuff);
  if (dotRange) {
    debuffObj.damagePercentMin = dotRange.min;
    debuffObj.damagePercentMax = dotRange.max;
    debuffObj.damagePercent = dotRange.max;
  }
  debuffObj.baseValue = attacker
    ? Math.max(1, _resolveDotBaseFromUnit(attacker, attr))
    : Math.max(1, _resolveDotBaseFromUnit(unit, attr));
  if (attacker) debuffObj.source_tag = attacker.tag || '';
  const sourceKey = attacker ? _getUnitSourceKey(attacker) : '';
  if (sourceKey) debuffObj.source_key = sourceKey;
  if (Boolean(debuff.consumeOnSourceTurn)) {
    debuffObj.consume_on_source_turn = true;
    debuffObj.consume_source_key = String(debuff.consumeSourceKey || sourceKey || debuffObj.source_tag || '');
  }
  if (Boolean(debuff.fromWanguchou)) debuffObj.from_wanguchou = true;
  const elem = String(debuff.element || '');
  if (elem) debuffObj.element = elem;
  if (debuffObj.type === 'jisheng') {
    debuffObj.ignoreDefense = true;
  }
  if (debuffObj.type === 'jisheng' && attacker && attacker.jisheng_dot_mastery) {
    debuffObj.mastery = true;
    debuffObj.mastery_dot_bonus = numVal(attacker.jisheng_dot_mastery.dot_bonus_pct, 0.15);
    debuffObj.mastery_spell_def_reduce = numVal(attacker.jisheng_dot_mastery.spell_def_reduce_pct, 0.5);
  }
  const agiRedPct = numVal(debuff.agilityReducePercent, 0);
  if (agiRedPct > 0 && numVal(unit.agility, 0) > 0) {
    const reduction = Math.floor(unit.agility * agiRedPct);
    if (reduction > 0) debuffObj.agilityReduction = reduction;
  }

  const sameNameDots = unit.debuffs.filter(d => d
    && intVal(d.stacks, 1) > 0
    && String(d.type || '') === debuffObj.type);
  const sourceTag = String(debuffObj.source_tag || '');
  const sameSourceKey = String(debuffObj.source_key || '');
  const sameSourceDot = sameNameDots.find((d) => {
    const dKey = String(d.source_key || '');
    if (sameSourceKey && dKey && dKey === sameSourceKey) return true;
    if (sameSourceKey && !dKey && sourceTag && String(d.source_tag || '') === sourceTag) return true;
    if (!sameSourceKey && sourceTag && String(d.source_tag || '') === sourceTag) return true;
    return false;
  });

  if (sameSourceDot) {
    sameSourceDot.effect_stacks = Math.max(1, intVal(sameSourceDot.effect_stacks, 1) + 1);
    sameSourceDot.ignoreDefense = Boolean(sameSourceDot.ignoreDefense || debuffObj.ignoreDefense);

    const oldTick = Math.max(1, Math.floor(numVal(sameSourceDot.baseValue, 1) * _resolveDebuffPeakPercent(sameSourceDot)));
    const newTick = Math.max(1, Math.floor(numVal(debuffObj.baseValue, 1) * _resolveDebuffPeakPercent(debuffObj)));
    if (newTick >= oldTick) {
      sameSourceDot.baseValue = debuffObj.baseValue;
      sameSourceDot.damagePercent = debuffObj.damagePercent;
      if (debuffObj.damagePercentMin != null) sameSourceDot.damagePercentMin = debuffObj.damagePercentMin;
      else if (sameSourceDot.damagePercentMin != null) delete sameSourceDot.damagePercentMin;
      if (debuffObj.damagePercentMax != null) sameSourceDot.damagePercentMax = debuffObj.damagePercentMax;
      else if (sameSourceDot.damagePercentMax != null) delete sameSourceDot.damagePercentMax;
      if (debuffObj.source_tag) sameSourceDot.source_tag = debuffObj.source_tag;
      if (debuffObj.source_key) sameSourceDot.source_key = debuffObj.source_key;
      if (debuffObj.element) sameSourceDot.element = debuffObj.element;
    }

    if (debuffObj.consume_on_source_turn) {
      sameSourceDot.consume_on_source_turn = true;
      if (debuffObj.consume_source_key) sameSourceDot.consume_source_key = debuffObj.consume_source_key;
    }

    if (debuffObj.mastery) {
      sameSourceDot.mastery = true;
      sameSourceDot.mastery_dot_bonus = Math.max(
        numVal(sameSourceDot.mastery_dot_bonus, 0),
        numVal(debuffObj.mastery_dot_bonus, 0)
      );
      sameSourceDot.mastery_spell_def_reduce = Math.max(
        numVal(sameSourceDot.mastery_spell_def_reduce, 0),
        numVal(debuffObj.mastery_spell_def_reduce, 0)
      );
    }

    const oldAgiReduction = intVal(sameSourceDot.agilityReduction, 0);
    const newAgiReduction = intVal(debuffObj.agilityReduction, 0);
    if (newAgiReduction > oldAgiReduction) {
      const delta = newAgiReduction - oldAgiReduction;
      unit.agility = Math.max(0, (unit.agility || 0) - delta);
      sameSourceDot.agilityReduction = newAgiReduction;
    }

    const logs = [{ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
      action: 'debuff_applied', text: `${unit.name} 的${getDebuffDisplayName(debuff.type)}效果叠加了1层！` }];
    logs.push(..._tryXuefuShentuImmediateBlossom(state, attacker, unit));
    return logs;
  }

  if (sameNameDots.length > 0) {
    const extendRounds = Math.max(1, stacks);
    let extendTarget = sameNameDots[0];
    for (const d of sameNameDots) {
      if (intVal(d.stacks, 1) < intVal(extendTarget.stacks, 1)) extendTarget = d;
    }
    extendTarget.stacks = Math.max(1, intVal(extendTarget.stacks, 1) + extendRounds);
    const logs = [{ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
      action: 'debuff_applied', text: `${unit.name} 的${getDebuffDisplayName(debuff.type)}持续回合延长了${extendRounds}回合！` }];
    logs.push(..._tryXuefuShentuImmediateBlossom(state, attacker, unit));
    return logs;
  }

  if (debuffObj.agilityReduction > 0) {
    unit.agility = Math.max(0, unit.agility - debuffObj.agilityReduction);
  }
  unit.debuffs.push(debuffObj);
  const logs = [{ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
    action: 'debuff_applied', text: `${unit.name} 受到了${getDebuffDisplayName(debuff.type)}效果！` }];
  if (debuffObj.agilityReduction > 0) {
    logs.push({ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
      action: 'agility_reduced', text: `${unit.name} 敏捷降低了${debuffObj.agilityReduction}点！` });
  }
  logs.push(..._tryXuefuShentuImmediateBlossom(state, attacker, unit));
  return logs;
}

function getDebuffDisplayName(type) {
  const names = { bleed: '流血', qingmo_poison: '青魔毒', chanfu: '缠缚', mengdu: '猛毒', jisheng: '寄生', baoran: '爆燃' };
  const key = String(type || '');
  return names[key] || '负面效果';
}

function getNegativeStatusCount(unit) {
  if (!unit || typeof unit !== 'object') return 0;
  const kinds = new Set();
  if (Array.isArray(unit.debuffs)) {
    for (const d of unit.debuffs) {
      if (!d || intVal(d.stacks, 1) <= 0) continue;
      kinds.add(`debuff:${String(d.type || 'debuff')}`);
    }
  }
  if (intVal(unit.chuanxin_rounds, 0) > 0) kinds.add('chuanxin');
  if (intVal(unit.fear_rounds, 0) > 0) kinds.add('fear');
  if (unit.slow_effect) kinds.add('slow');
  if (intVal(unit.juemai_rounds, 0) > 0) kinds.add('juemai');
  if (intVal(unit.stasis_rounds, 0) > 0) kinds.add('stasis');
  if (intVal(unit.fumo_rounds, 0) > 0) kinds.add('fumo');
  if (intVal(unit.zhuohun_rounds, 0) > 0) kinds.add('zhuohun');
  if (intVal(unit.wenluan_rounds, 0) > 0) kinds.add('wenluan');
  if (intVal(unit.zhendang_rounds, 0) > 0) kinds.add('zhendang');
  if (intVal(unit.mark_rounds, 0) > 0) kinds.add('mark');
  if (intVal(unit.jiangwen_stacks, 0) > 0) kinds.add('jiangwen');
  if (intVal(unit.dongshang_stacks, 0) > 0) kinds.add('dongshang');
  if (intVal(unit.zhuoshao_rounds, 0) > 0) kinds.add('zhuoshao');
  return kinds.size;
}

function isHealForbidden(unit) {
  return Boolean(unit && unit.heal_forbidden === true);
}

function pushHealForbiddenEvent(unit, events, sourceText = '') {
  if (!unit || !Array.isArray(events)) return;
  const prefix = sourceText ? `${sourceText}：` : '';
  events.push({
    t: 'combat_log',
    actor: unit.tag || 'player',
    target: unit.tag || 'player',
    action: 'heal_forbidden',
    text: `${prefix}${unit.name} 处于禁疗状态，无法恢复生命`
  });
}

function consumeNextActionHeal(unit, state, events) {
  if (!unit || typeof unit !== 'object' || !Array.isArray(events)) return;
  const basePct = numVal(unit.next_action_heal_pct, 0);
  if (basePct <= 0) return;

  let pct = basePct;
  const pvpPct = numVal(unit.next_action_heal_pvp_pct, 0);
  if (isPvpBattleMode(state?.battle_mode) && pvpPct > 0) pct = pvpPct;

  unit.next_action_heal_pct = 0;
  unit.next_action_heal_pvp_pct = 0;

  if (isHealForbidden(unit)) {
    pushHealForbiddenEvent(unit, events, '归元纳形');
    return;
  }

  let heal = Math.max(1, Math.floor(unit.max_hp * clamp(pct, 0, 1)));
  heal = Math.floor(heal * (1.0 + numVal(unit.heal_bonus, 0)));
  if (unit.zhuohun_rounds > 0 && unit.zhuohun_heal_reduce > 0) {
    heal = Math.floor(heal * (1.0 - unit.zhuohun_heal_reduce));
  }
  if (heal <= 0) return;

  if (tryJiemieHealToXurui(unit, heal, events, { text: `劫灭-斗战乾坤：归元纳形回复无效，获得2轮蓄锐` })) {
    return;
  }

  const healed = applyHealWithOverflowShield(unit, heal, events);
  if (healed.actualHeal > 0) {
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: unit.tag || 'player',
      action: 'next_action_heal',
      heal: healed.actualHeal,
      text: `${unit.name} 归元纳形生效，回复了${healed.actualHeal}生命`
    });
  }
}

function _removeOneNegativeStatus(unit, state) {
  if (!unit || typeof unit !== 'object') return '';
  const candidates = [];
  if (Array.isArray(unit.debuffs)) {
    for (let i = 0; i < unit.debuffs.length; i++) {
      const d = unit.debuffs[i];
      if (!d || intVal(d.stacks, 1) <= 0) continue;
      candidates.push({ key: 'debuff', index: i, label: getDebuffDisplayName(d.type) });
    }
  }
  if (intVal(unit.chuanxin_rounds, 0) > 0) candidates.push({ key: 'chuanxin', label: '穿心' });
  if (intVal(unit.fear_rounds, 0) > 0) candidates.push({ key: 'fear', label: '恐惧' });
  if (unit.slow_effect) candidates.push({ key: 'slow', label: '迟缓' });
  if (intVal(unit.juemai_rounds, 0) > 0) candidates.push({ key: 'juemai', label: '绝脉' });
  if (intVal(unit.stasis_rounds, 0) > 0) candidates.push({ key: 'stasis', label: '凝滞' });
  if (intVal(unit.fumo_rounds, 0) > 0) candidates.push({ key: 'fumo', label: '伏魔' });
  if (intVal(unit.zhuohun_rounds, 0) > 0) candidates.push({ key: 'zhuohun', label: '灼魂' });
  if (intVal(unit.wenluan_rounds, 0) > 0) candidates.push({ key: 'wenluan', label: '紊乱' });
  if (intVal(unit.zhendang_rounds, 0) > 0) candidates.push({ key: 'zhendang', label: '震荡' });
  if (intVal(unit.mark_rounds, 0) > 0) candidates.push({ key: 'mark', label: '标记' });
  if (intVal(unit.jiangwen_stacks, 0) > 0) candidates.push({ key: 'jiangwen', label: '降温' });
  if (intVal(unit.dongshang_stacks, 0) > 0) candidates.push({ key: 'dongshang', label: '冻伤' });
  if (intVal(unit.zhuoshao_rounds, 0) > 0) candidates.push({ key: 'zhuoshao', label: '灼烧' });
  if (candidates.length <= 0) return '';

  const pickIndex = Math.floor((state ? nextRand01(state) : Math.random()) * candidates.length);
  const picked = candidates[Math.max(0, Math.min(candidates.length - 1, pickIndex))];
  if (!picked) return '';

  if (picked.key === 'debuff') {
    const d = unit.debuffs[picked.index];
    if (d && d.agilityReduction > 0) unit.agility = (unit.agility || 0) + d.agilityReduction;
    unit.debuffs.splice(picked.index, 1);
    return picked.label;
  }
  if (picked.key === 'chuanxin') unit.chuanxin_rounds = 0;
  else if (picked.key === 'fear') { unit.fear_rounds = 0; unit.fear_consume_source_key = ''; }
  else if (picked.key === 'slow') { unit.slow_effect = null; unit.xuanhuang_slow_until_end = false; unit.slow_consume_source_key = ''; }
  else if (picked.key === 'juemai') { unit.juemai_rounds = 0; unit.juemai_consume_source_key = ''; }
  else if (picked.key === 'stasis') { unit.stasis_rounds = 0; unit.stasis_guard_active = false; }
  else if (picked.key === 'fumo') unit.fumo_rounds = 0;
  else if (picked.key === 'zhuohun') { unit.zhuohun_rounds = 0; unit.zhuohun_heal_reduce = 0; unit.zhuohun_consume_source_key = ''; }
  else if (picked.key === 'wenluan') { unit.wenluan_rounds = 0; unit.wenluan_ratio = 0; }
  else if (picked.key === 'zhendang') {
    if (intVal(unit.zhendang_rounds, 0) > 0) {
      unit.spell_attack = (unit.spell_attack || 0) + (unit.zhendang_spell_attack_stored || 0);
      unit.spell_defense = (unit.spell_defense || 0) + (unit.zhendang_spell_defense_stored || 0);
      unit.zhendang_spell_attack_stored = 0;
      unit.zhendang_spell_defense_stored = 0;
    }
    unit.zhendang_rounds = 0;
  }
  else if (picked.key === 'mark') unit.mark_rounds = 0;
  else if (picked.key === 'jiangwen') unit.jiangwen_stacks = 0;
  else if (picked.key === 'dongshang') unit.dongshang_stacks = 0;
  else if (picked.key === 'zhuoshao') unit.zhuoshao_rounds = 0;
  return picked.label;
}

function _stealOnePositiveStatus(attacker, defender, state) {
  if (!attacker || !defender) return '';
  const candidates = [];
  if (intVal(defender.nuozhan_rounds, 0) > 0) candidates.push({ key: 'nuozhan', label: '搦战' });
  if (intVal(defender.juechang_rounds, 0) > 0) candidates.push({ key: 'juechang', label: '绝唱' });
  if (intVal(defender.beishui_rounds, 0) > 0) candidates.push({ key: 'beishui', label: '背水' });
  if (defender.xurui?.active) candidates.push({ key: 'xurui', label: '蓄锐' });
  if (defender.yangjing?.active) candidates.push({ key: 'yangjing', label: '养精' });
  if (defender.jingzhun?.active) candidates.push({ key: 'jingzhun', label: '精准' });
  if (defender.zhuanzhu?.active) candidates.push({ key: 'zhuanzhu', label: '专注' });
  if (defender.chengfeng) candidates.push({ key: 'chengfeng', label: '乘风' });
  if (intVal(defender.bofa_rounds, 0) > 0) candidates.push({ key: 'bofa', label: '勃发' });
  if (intVal(defender.daifa_rounds, 0) > 0) candidates.push({ key: 'daifa', label: '待发' });
  if (defender.jiangu) candidates.push({ key: 'jiangu', label: '坚固' });
  if (intVal(defender.hunchong_stacks, 0) > 0) candidates.push({ key: 'hunchong', label: '缓冲' });
  if (intVal(defender.tudun_rounds, 0) > 0) candidates.push({ key: 'tudun', label: '土遁' });
  if (Boolean(defender.fenjin_active)) candidates.push({ key: 'fenjin', label: '焚烬' });
  if (candidates.length <= 0) return '';

  const pickIndex = Math.floor((state ? nextRand01(state) : Math.random()) * candidates.length);
  const picked = candidates[Math.max(0, Math.min(candidates.length - 1, pickIndex))];
  if (!picked) return '';

  if (picked.key === 'nuozhan') {
    attacker.nuozhan_rounds = Math.max(intVal(attacker.nuozhan_rounds, 0), intVal(defender.nuozhan_rounds, 0));
    defender.nuozhan_rounds = 0;
  } else if (picked.key === 'juechang') {
    attacker.juechang_rounds = Math.max(intVal(attacker.juechang_rounds, 0), intVal(defender.juechang_rounds, 0));
    defender.juechang_rounds = 0;
  } else if (picked.key === 'beishui') {
    attacker.beishui_rounds = Math.max(intVal(attacker.beishui_rounds, 0), intVal(defender.beishui_rounds, 0));
    defender.beishui_rounds = 0;
  } else if (picked.key === 'xurui') {
    attacker.xurui = { active: true, duration: Math.max(intVal(attacker.xurui?.duration, 0), intVal(defender.xurui?.duration, 0)) };
    defender.xurui = { active: false, duration: 0 };
  } else if (picked.key === 'yangjing') {
    attacker.yangjing = { active: true, duration: Math.max(intVal(attacker.yangjing?.duration, 0), intVal(defender.yangjing?.duration, 0)) };
    defender.yangjing = { active: false, duration: 0 };
  } else if (picked.key === 'jingzhun') {
    attacker.jingzhun = { active: true, duration: Math.max(intVal(attacker.jingzhun?.duration, 0), intVal(defender.jingzhun?.duration, 0)) };
    defender.jingzhun = { active: false, duration: 0 };
  } else if (picked.key === 'zhuanzhu') {
    attacker.zhuanzhu = { active: true, duration: Math.max(intVal(attacker.zhuanzhu?.duration, 0), intVal(defender.zhuanzhu?.duration, 0)) };
    defender.zhuanzhu = { active: false, duration: 0 };
  } else if (picked.key === 'chengfeng') {
    const dCf = defender.chengfeng || {};
    const aCf = attacker.chengfeng || {};
    attacker.chengfeng = {
      speedBonus: Math.max(numVal(aCf.speedBonus, 0), numVal(dCf.speedBonus, 0)),
      duration: Math.max(intVal(aCf.duration, 0), intVal(dCf.duration, 0))
    };
    defender.chengfeng = null;
  } else if (picked.key === 'bofa') {
    attacker.bofa_rounds = Math.max(intVal(attacker.bofa_rounds, 0), intVal(defender.bofa_rounds, 0));
    defender.bofa_rounds = 0;
  } else if (picked.key === 'daifa') {
    attacker.daifa_rounds = Math.max(intVal(attacker.daifa_rounds, 0), intVal(defender.daifa_rounds, 0));
    defender.daifa_rounds = 0;
  } else if (picked.key === 'jiangu') {
    const dJg = defender.jiangu || {};
    const aJg = attacker.jiangu || {};
    attacker.jiangu = {
      duration: Math.max(intVal(aJg.duration, 0), intVal(dJg.duration, 0)),
      physCoeff: Math.max(numVal(aJg.physCoeff, 0), numVal(dJg.physCoeff, 0)),
      spellCoeff: Math.max(numVal(aJg.spellCoeff, 0), numVal(dJg.spellCoeff, 0))
    };
    defender.jiangu = null;
  } else if (picked.key === 'hunchong') {
    attacker.hunchong_stacks = Math.max(intVal(attacker.hunchong_stacks, 0), intVal(defender.hunchong_stacks, 0));
    defender.hunchong_stacks = 0;
  } else if (picked.key === 'tudun') {
    attacker.tudun_rounds = Math.max(intVal(attacker.tudun_rounds, 0), intVal(defender.tudun_rounds, 0));
    defender.tudun_rounds = 0;
  } else if (picked.key === 'fenjin') {
    attacker.fenjin_active = true;
    defender.fenjin_active = false;
  }
  return picked.label;
}

function _transferOneNegativeStatus(from, to, state) {
  if (!from || !to) return '';
  const candidates = [];
  if (Array.isArray(from.debuffs)) {
    for (let i = 0; i < from.debuffs.length; i++) {
      const d = from.debuffs[i];
      if (!d || intVal(d.stacks, 1) <= 0) continue;
      candidates.push({ key: 'debuff', index: i, label: getDebuffDisplayName(d.type) });
    }
  }
  if (intVal(from.chuanxin_rounds, 0) > 0) candidates.push({ key: 'chuanxin', label: '穿心' });
  if (intVal(from.fear_rounds, 0) > 0) candidates.push({ key: 'fear', label: '恐惧' });
  if (from.slow_effect) candidates.push({ key: 'slow', label: '迟缓' });
  if (intVal(from.juemai_rounds, 0) > 0) candidates.push({ key: 'juemai', label: '绝脉' });
  if (intVal(from.stasis_rounds, 0) > 0) candidates.push({ key: 'stasis', label: '凝滞' });
  if (intVal(from.fumo_rounds, 0) > 0) candidates.push({ key: 'fumo', label: '伏魔' });
  if (intVal(from.zhuohun_rounds, 0) > 0) candidates.push({ key: 'zhuohun', label: '灼魂' });
  if (intVal(from.wenluan_rounds, 0) > 0) candidates.push({ key: 'wenluan', label: '紊乱' });
  if (intVal(from.mark_rounds, 0) > 0) candidates.push({ key: 'mark', label: '标记' });
  if (intVal(from.jiangwen_stacks, 0) > 0) candidates.push({ key: 'jiangwen', label: '降温' });
  if (intVal(from.dongshang_stacks, 0) > 0) candidates.push({ key: 'dongshang', label: '冻伤' });
  if (intVal(from.zhuoshao_rounds, 0) > 0) candidates.push({ key: 'zhuoshao', label: '灼烧' });
  if (candidates.length <= 0) return '';

  const pickIndex = Math.floor((state ? nextRand01(state) : Math.random()) * candidates.length);
  const picked = candidates[Math.max(0, Math.min(candidates.length - 1, pickIndex))];
  if (!picked) return '';

  const sourceKey = _getUnitSourceKey(from);
  if (picked.key === 'debuff') {
    const d = from.debuffs[picked.index];
    if (!d) return '';
    if (d.agilityReduction > 0) from.agility = (from.agility || 0) + d.agilityReduction;
    from.debuffs.splice(picked.index, 1);
    const moved = deepClone(d);
    moved.source_tag = from.tag || moved.source_tag;
    if (moved.agilityReduction > 0) to.agility = Math.max(0, (to.agility || 0) - moved.agilityReduction);
    if (!Array.isArray(to.debuffs)) to.debuffs = [];
    to.debuffs.push(moved);
    return picked.label;
  }
  if (picked.key === 'chuanxin') {
    to.chuanxin_rounds = Math.max(intVal(to.chuanxin_rounds, 0), intVal(from.chuanxin_rounds, 0));
    from.chuanxin_rounds = 0;
  } else if (picked.key === 'fear') {
    to.fear_rounds = Math.max(intVal(to.fear_rounds, 0), intVal(from.fear_rounds, 0));
    to.fear_consume_source_key = sourceKey;
    from.fear_rounds = 0;
    from.fear_consume_source_key = '';
  } else if (picked.key === 'slow') {
    const moved = deepClone(from.slow_effect || {});
    if (!to.slow_effect) {
      to.slow_effect = moved;
    } else {
      to.slow_effect.duration = Math.max(intVal(to.slow_effect.duration, 0), intVal(moved.duration, 0));
      to.slow_effect.speedMultiplier = Math.min(numVal(to.slow_effect.speedMultiplier, 1), numVal(moved.speedMultiplier, 0.7));
    }
    to.slow_consume_source_key = sourceKey;
    from.slow_effect = null;
    from.xuanhuang_slow_until_end = false;
    from.slow_consume_source_key = '';
  } else if (picked.key === 'juemai') {
    to.juemai_rounds = Math.max(intVal(to.juemai_rounds, 0), intVal(from.juemai_rounds, 0));
    to.juemai_consume_source_key = sourceKey;
    from.juemai_rounds = 0;
    from.juemai_consume_source_key = '';
  } else if (picked.key === 'stasis') {
    to.stasis_rounds = Math.max(intVal(to.stasis_rounds, 0), intVal(from.stasis_rounds, 0));
    to.stasis_guard_active = false;
    from.stasis_rounds = 0;
    from.stasis_guard_active = false;
  } else if (picked.key === 'fumo') {
    to.fumo_rounds = Math.max(intVal(to.fumo_rounds, 0), intVal(from.fumo_rounds, 0));
    from.fumo_rounds = 0;
  } else if (picked.key === 'zhuohun') {
    to.zhuohun_rounds = Math.max(intVal(to.zhuohun_rounds, 0), intVal(from.zhuohun_rounds, 0));
    to.zhuohun_heal_reduce = Math.max(numVal(to.zhuohun_heal_reduce, 0), numVal(from.zhuohun_heal_reduce, 0));
    to.zhuohun_consume_source_key = sourceKey;
    from.zhuohun_rounds = 0;
    from.zhuohun_heal_reduce = 0;
    from.zhuohun_consume_source_key = '';
  } else if (picked.key === 'wenluan') {
    to.wenluan_rounds = Math.max(intVal(to.wenluan_rounds, 0), intVal(from.wenluan_rounds, 0));
    to.wenluan_ratio = Math.max(numVal(to.wenluan_ratio, 0), numVal(from.wenluan_ratio, 0));
    from.wenluan_rounds = 0;
    from.wenluan_ratio = 0;
  } else if (picked.key === 'mark') {
    to.mark_rounds = Math.max(intVal(to.mark_rounds, 0), intVal(from.mark_rounds, 0));
    from.mark_rounds = 0;
  } else if (picked.key === 'jiangwen') {
    to.jiangwen_stacks = Math.max(intVal(to.jiangwen_stacks, 0), intVal(from.jiangwen_stacks, 0));
    from.jiangwen_stacks = 0;
  } else if (picked.key === 'dongshang') {
    to.dongshang_stacks = Math.max(intVal(to.dongshang_stacks, 0), intVal(from.dongshang_stacks, 0));
    from.dongshang_stacks = 0;
  } else if (picked.key === 'zhuoshao') {
    to.zhuoshao_rounds = Math.max(intVal(to.zhuoshao_rounds, 0), intVal(from.zhuoshao_rounds, 0));
    from.zhuoshao_rounds = 0;
  }
  return picked.label;
}

function _findUnitByTag(state, tag) {
  if (!state || !tag) return null;
  if (state.player && state.player.tag === tag) return state.player;
  if (state.enemy && state.enemy.tag === tag) return state.enemy;
  if (Array.isArray(state.allies)) {
    const a = state.allies.find(u => u && u.tag === tag);
    if (a) return a;
  }
  if (Array.isArray(state.enemies)) {
    const e = state.enemies.find(u => u && u.tag === tag);
    if (e) return e;
  }
  return null;
}

function _findUnitBySourceKey(state, sourceKey) {
  const key = String(sourceKey || '');
  if (!state || !key) return null;
  const all = [];
  if (state.player) all.push(state.player);
  if (state.enemy) all.push(state.enemy);
  if (Array.isArray(state.allies)) all.push(...state.allies);
  if (Array.isArray(state.enemies)) all.push(...state.enemies);
  for (const u of all) {
    if (!u || typeof u !== 'object') continue;
    if (_getUnitSourceKey(u) === key) return u;
  }
  return null;
}

function _isSourceKeyAlive(state, sourceKey) {
  const src = _findUnitBySourceKey(state, sourceKey);
  return !!(src && src.hp > 0 && src.alive !== false);
}

function _consumeSourceBoundNegatives(state, sourceUnit) {
  const sourceKey = _getUnitSourceKey(sourceUnit);
  if (!state || !sourceKey) return;

  const all = [];
  if (state.player) all.push(state.player);
  if (state.enemy) all.push(state.enemy);
  if (Array.isArray(state.allies)) all.push(...state.allies);
  if (Array.isArray(state.enemies)) all.push(...state.enemies);

  for (const target of all) {
    if (!target || target === sourceUnit) continue;

    if (target.slow_effect && !target.xuanhuang_slow_until_end && String(target.slow_consume_source_key || '') === sourceKey) {
      target.slow_effect.duration = intVal(target.slow_effect.duration, 1) - 1;
      if (intVal(target.slow_effect.duration, 0) <= 0) {
        target.slow_effect = null;
        target.xuanhuang_slow_until_end = false;
        target.slow_consume_source_key = '';
      }
    }
    if (!target.slow_effect) target.slow_consume_source_key = '';

    if (intVal(target.fear_rounds, 0) > 0 && String(target.fear_consume_source_key || '') === sourceKey) {
      target.fear_rounds -= 1;
      if (target.fear_rounds <= 0) target.fear_consume_source_key = '';
    }

    if (intVal(target.juemai_rounds, 0) > 0 && String(target.juemai_consume_source_key || '') === sourceKey) {
      target.juemai_rounds -= 1;
      if (target.juemai_rounds <= 0) target.juemai_consume_source_key = '';
    }

    if (intVal(target.zhuohun_rounds, 0) > 0 && String(target.zhuohun_consume_source_key || '') === sourceKey) {
      target.zhuohun_rounds -= 1;
      if (target.zhuohun_rounds <= 0) {
        target.zhuohun_heal_reduce = 0;
        target.zhuohun_consume_source_key = '';
      }
    }

    if (Array.isArray(target.debuffs) && target.debuffs.length > 0) {
      const kept = [];
      for (const d of target.debuffs) {
        if (!d || intVal(d.stacks, 0) <= 0) continue;
        const sourceBound = Boolean(d.consume_on_source_turn)
          && String(d.consume_source_key || '') === sourceKey;
        if (sourceBound) d.stacks -= 1;
        if (intVal(d.stacks, 0) > 0) {
          kept.push(d);
        } else if (intVal(d.agilityReduction, 0) > 0) {
          target.agility = (target.agility || 0) + intVal(d.agilityReduction, 0);
        }
      }
      target.debuffs = kept;
    }
  }
}

/** 绽放：返回 DOT 种类数与引爆总伤害（用于 blossom 技能），不修改单位 */
function getBlossomExplodeInfo(defender, state) {
  if (!Array.isArray(defender?.debuffs) || defender.debuffs.length === 0) {
    return { typeCount: 0, explodeDamage: 0 };
  }
  const types = new Set();
  let explodeDamage = 0;
  const sourcePerfectWood = !defender.is_ally && (
    (state?.player?.perfect_wood) ||
    (Array.isArray(state?.allies) && state.allies.some(a => a && a.perfect_wood))
  );
  for (const d of defender.debuffs) {
    types.add(String(d.type || 'bleed'));
    const base = d.baseValue != null ? d.baseValue : 1;
    const durationStacks = Math.max(1, intVal(d.stacks, 1));
    const effectStacks = Math.max(1, intVal(d.effect_stacks, 1));
    const explodePct = _resolveDebuffExplodePercent(d);
    let dmg = Math.max(1, Math.floor(base * explodePct * durationStacks * effectStacks));
    if (sourcePerfectWood) dmg = Math.floor(dmg * 1.1);
    if (d.source_tag && d.element) {
      const src = _findUnitByTag(state, d.source_tag);
      if (src) {
        const aff = calcElementAffinity(src, { attribute: d.element });
        if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
      }
    }
    explodeDamage += dmg;
  }
  return { typeCount: types.size, explodeDamage };
}

/** 绽放后清除目标身上所有 DOT 类 debuff */
function clearBlossomDebuffs(defender) {
  if (!Array.isArray(defender?.debuffs)) return;
  defender.debuffs.length = 0;
}

function _tryXuefuShentuImmediateBlossom(state, attacker, defender) {
  const events = [];
  if (!attacker || !defender) return events;
  if (isPvpBattleMode(state?.battle_mode)) return events;
  if (!(numVal(attacker.xuefu_shentu_active, 0) > 0)) return events;
  const { typeCount, explodeDamage } = getBlossomExplodeInfo(defender, state);
  if (typeCount <= 0 || explodeDamage <= 0) return events;

  let damage = Math.max(1, Math.floor(explodeDamage * 0.9));
  clearBlossomDebuffs(defender);

  if (intVal(defender.hunchong_stacks, 0) > 0 && damage > 0) {
    defender.hunchong_stacks -= 1;
    damage = 0;
    events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
      text: `${defender.name} 的缓冲抵消了血缚引爆伤害！` });
  } else if (numVal(defender.direct_damage_ignore_chance, 0) > 0 && nextRand01(state) < numVal(defender.direct_damage_ignore_chance, 0)) {
    damage = 0;
    events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
      text: `${defender.name} 无视了血缚引爆伤害！` });
  }

  if (damage > 0) {
    damage = capIncomingDamageByTaixu(defender, damage, events, { state }).damage;
    damage = absorbDamageByTempShield(defender, damage, events);
    defender.hp = Math.max(0, intVal(defender.hp, 0) - damage);
    if (defender.hp <= 0 && defender.alive !== undefined) defender.alive = false;
  }

  events.push({
    t: 'combat_log',
    actor: attacker.tag || 'player',
    target: defender.tag || 'enemy',
    action: 'xuefu_shentu',
    damage,
    text: `${attacker.name} 的血缚神途引爆${typeCount}种持续伤害，造成${damage}伤害（总伤害-10%）`
  });
  return events;
}

function triggerDebuffs(unit, state) {
  if (!Array.isArray(unit.debuffs) || unit.debuffs.length === 0) return [];
  const events = [];
  const remaining = [];
  // 完美木灵根：己方造成的 DoT 效率 ×1.1（受击方为敌人时，施加方为玩家/友方）
  const sourcePerfectWood = !unit.is_ally && (
    (state?.player?.perfect_wood) ||
    (Array.isArray(state?.allies) && state.allies.some(a => a && a.perfect_wood))
  );
  // 句芒经被动：目标身上存在 mastery 寄生时，所有 DOT 总伤害 +bonus%
  const masteryJisheng = unit.debuffs.find(d => d.type === 'jisheng' && d.mastery);
  const dotBonusMul = masteryJisheng ? (1.0 + numVal(masteryJisheng.mastery_dot_bonus, 0.15)) : 1.0;
  for (const d of unit.debuffs) {
    const base = d.baseValue != null ? d.baseValue : 1;
    const effectStacks = Math.max(1, intVal(d.effect_stacks, 1));
    const tickPct = _resolveDebuffTickPercent(d, state);
    let dmg = Math.max(1, Math.floor(base * tickPct * effectStacks));
    if (sourcePerfectWood) dmg = Math.floor(dmg * 1.1);
    if (dotBonusMul > 1.0) dmg = Math.floor(dmg * dotBonusMul);
    if (isStasisGuardActive(unit)) {
      pushStasisGuardEvent(unit, events, getDebuffDisplayName(d.type), 'damage');
      dmg = 0;
    }
    if (d.source_tag) {
      const src = _findUnitByTag(state, d.source_tag);
      if (src) {
        const commonDotBonus = Math.max(0, numVal(src.dot_damage_pct_bonus, 0));
        const woodDotBonus = String(d.element || '') === '木' ? Math.max(0, numVal(src.wood_dot_damage_pct_bonus, 0)) : 0;
        const dotMul = 1.0 + commonDotBonus + woodDotBonus;
        if (dotMul > 1.0) dmg = Math.floor(dmg * dotMul);
        if (d.element) {
          const aff = calcElementAffinity(src, { attribute: d.element });
          if (aff > 0) dmg = Math.floor(dmg * (1.0 + aff * 0.0065));
        }
      }
    }
    if (!d.ignoreDefense) {
      const defAttr = String(d.attribute || '');
      const def = (defAttr === 'spell_attack' || defAttr === 'highest_attr')
        ? numVal(unit.spell_defense, 0)
        : numVal(unit.phys_defense, 0) || numVal(unit.defense, 0);
      if (def > 0) dmg = calcReducedDamage(dmg, def, 9000);
    }
    let _hunchongAbsorbed = false;
    if (unit.hunchong_stacks > 0 && dmg > 0) {
      unit.hunchong_stacks -= 1;
      events.push({ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
        action: 'hunchong_absorb', text: `${unit.name} 的缓冲抵消了${getDebuffDisplayName(d.type)}伤害！` });
      dmg = 0;
      _hunchongAbsorbed = true;
    }
    dmg = absorbDamageByTempShield(unit, dmg, events);
    dmg = capIncomingDamageByTaixu(unit, dmg, events, { state }).damage;
    unit.hp = Math.max(0, unit.hp - dmg);
    let consumeNow = true;
    if (d.consume_on_source_turn) {
      consumeNow = false;
      const consumeSourceKey = String(d.consume_source_key || '');
      if (consumeSourceKey) {
        const src = _findUnitBySourceKey(state, consumeSourceKey);
        if (!src || src.hp <= 0 || src.alive === false) consumeNow = true;
      }
    }
    if (consumeNow) d.stacks -= 1;
    if (!_hunchongAbsorbed) {
      events.push({ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
        action: 'debuff_tick', damage: dmg, text: `${unit.name} 受到${getDebuffDisplayName(d.type)}效果${dmg}点伤害` });
    }
    if (d.type === 'chanfu' && d.source_tag && dmg > 0 && !isPvpBattleMode(state?.battle_mode)) {
      const src = _findUnitByTag(state, d.source_tag);
      if (src && src.hp > 0) {
        let heal = Math.min(dmg, src.max_hp - src.hp);
        if (src.zhuohun_rounds > 0 && src.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - src.zhuohun_heal_reduce));
        if (heal > 0) {
          if (tryJiemieHealToXurui(src, heal, events, { text: `劫灭-斗战乾坤：缠缚回复无效，获得2轮蓄锐` })) {
            // 已转为蓄锐
          } else {
            const healed = applyHealWithOverflowShield(src, heal, events);
            if (healed.actualHeal > 0) {
              events.push({ t: 'combat_log', actor: src.tag || 'player', target: src.tag || 'player',
                action: 'chanfu_heal', heal: healed.actualHeal, text: `${src.name} 通过缠缚回复了${healed.actualHeal}生命` });
            }
          }
        }
      }
    }
    if (unit.hp <= 0 && unit.alive !== undefined) unit.alive = false;
    if (d.stacks > 0) {
      remaining.push(d);
    } else if (d.agilityReduction > 0) {
      unit.agility = (unit.agility || 0) + d.agilityReduction;
      events.push({ t: 'combat_log', actor: 'system', target: unit.tag || 'enemy',
        action: 'agility_restored', text: `${unit.name} 的敏捷恢复了${d.agilityReduction}点` });
    }
  }
  unit.debuffs = remaining;
  return events;
}

// ─── 特殊状态递减 ───
function decrementStates(unit, state = null) {
  if (!unit || typeof unit !== 'object') return;
  const fearSourceKey = String(unit.fear_consume_source_key || '');
  const juemaiSourceKey = String(unit.juemai_consume_source_key || '');
  const slowSourceKey = String(unit.slow_consume_source_key || '');
  const zhuohunSourceKey = String(unit.zhuohun_consume_source_key || '');

  const fearSourceAlive = fearSourceKey ? _isSourceKeyAlive(state, fearSourceKey) : false;
  const juemaiSourceAlive = juemaiSourceKey ? _isSourceKeyAlive(state, juemaiSourceKey) : false;
  const slowSourceAlive = slowSourceKey ? _isSourceKeyAlive(state, slowSourceKey) : false;
  const zhuohunSourceAlive = zhuohunSourceKey ? _isSourceKeyAlive(state, zhuohunSourceKey) : false;

  if (unit.chuanxin_rounds > 0) unit.chuanxin_rounds -= 1;
  if (unit.nuozhan_rounds > 0) unit.nuozhan_rounds -= 1;
  if (unit.juechang_rounds > 0) unit.juechang_rounds -= 1;
  if (unit.beishui_rounds > 0) unit.beishui_rounds -= 1;
  if (unit.fear_rounds > 0 && (!fearSourceKey || !fearSourceAlive)) unit.fear_rounds -= 1;
  if (unit.fear_rounds <= 0) unit.fear_consume_source_key = '';
  if (unit.juemai_rounds > 0 && (!juemaiSourceKey || !juemaiSourceAlive)) unit.juemai_rounds -= 1;
  if (unit.juemai_rounds <= 0) unit.juemai_consume_source_key = '';
  if (unit.bofa_rounds > 0) unit.bofa_rounds -= 1;
  if (unit.daifa_rounds > 0) unit.daifa_rounds -= 1;
  if (unit.zhenyue_rounds > 0) unit.zhenyue_rounds -= 1;
  if (unit.fumo_rounds > 0) unit.fumo_rounds -= 1;
  if (unit.stasis_rounds > 0) unit.stasis_rounds -= 1;
  if (unit.stasis_rounds <= 0) unit.stasis_guard_active = false;
  if (unit.mark_rounds > 0) unit.mark_rounds -= 1;
  if (unit.xurui && unit.xurui.active) {
    unit.xurui.duration -= 1;
    if (unit.xurui.duration <= 0) unit.xurui = { active: false, duration: 0 };
  }
  if (unit.yangjing && unit.yangjing.active) {
    unit.yangjing.duration -= 1;
    if (unit.yangjing.duration <= 0) unit.yangjing = { active: false, duration: 0 };
  }
  if (unit.jingzhun && unit.jingzhun.active) {
    unit.jingzhun.duration -= 1;
    if (unit.jingzhun.duration <= 0) unit.jingzhun = { active: false, duration: 0 };
  }
  if (unit.zhuanzhu && unit.zhuanzhu.active) {
    unit.zhuanzhu.duration -= 1;
    if (unit.zhuanzhu.duration <= 0) unit.zhuanzhu = { active: false, duration: 0 };
  }
  if (unit.slow_effect && !unit.xuanhuang_slow_until_end && (!slowSourceKey || !slowSourceAlive)) {
    unit.slow_effect.duration -= 1;
    if (unit.slow_effect.duration <= 0) unit.slow_effect = null;
  }
  if (!unit.slow_effect) unit.slow_consume_source_key = '';
  if (unit.chengfeng) {
    const left = intVal(unit.chengfeng.duration, 1) - 1;
    if (left <= 0) unit.chengfeng = null;
    else unit.chengfeng.duration = left;
  }
  if (unit.jiangu) {
    unit.jiangu.duration -= 1;
    if (unit.jiangu.duration <= 0) unit.jiangu = null;
  }
  if (unit.tudun_rounds > 0) unit.tudun_rounds -= 1;
  if (unit.zhuohun_rounds > 0 && (!zhuohunSourceKey || !zhuohunSourceAlive)) {
    unit.zhuohun_rounds -= 1;
    if (unit.zhuohun_rounds <= 0) unit.zhuohun_heal_reduce = 0;
  }
  if (unit.zhuohun_rounds <= 0) unit.zhuohun_consume_source_key = '';
  if (unit.wenluan_rounds > 0) {
    unit.wenluan_rounds -= 1;
    if (unit.wenluan_rounds <= 0) unit.wenluan_ratio = 0;
  }
  if (unit.zhendang_rounds > 0) {
    unit.zhendang_rounds -= 1;
    if (unit.zhendang_rounds <= 0) {
      unit.spell_attack = (unit.spell_attack || 0) + (unit.zhendang_spell_attack_stored || 0);
      unit.spell_defense = (unit.spell_defense || 0) + (unit.zhendang_spell_defense_stored || 0);
      unit.zhendang_spell_attack_stored = 0;
      unit.zhendang_spell_defense_stored = 0;
    }
  }
  if (unit.data_invasion_pvp_weaken_rounds > 0) {
    unit.data_invasion_pvp_weaken_rounds -= 1;
    if (unit.data_invasion_pvp_weaken_rounds <= 0) {
      unit.min_attack = Math.max(1, intVal(unit.min_attack, 1) + intVal(unit.data_invasion_pvp_weaken_min_attack_stored, 0));
      unit.max_attack = Math.max(unit.min_attack, intVal(unit.max_attack, unit.min_attack) + intVal(unit.data_invasion_pvp_weaken_max_attack_stored, 0));
      unit.spell_attack = Math.max(0, intVal(unit.spell_attack, 0) + intVal(unit.data_invasion_pvp_weaken_spell_attack_stored, 0));
      unit.data_invasion_pvp_weaken_min_attack_stored = 0;
      unit.data_invasion_pvp_weaken_max_attack_stored = 0;
      unit.data_invasion_pvp_weaken_spell_attack_stored = 0;
    }
  }
  if (unit.moshen_jue_rounds > 0) unit.moshen_jue_rounds -= 1;
  if (unit.moshen_jue_rounds <= 0 && unit.moshen_jue_applied) {
    unit.defense = intVal(unit.moshen_jue_defense_backup, unit.defense || 0);
    unit.spell_defense = intVal(unit.moshen_jue_spell_defense_backup, unit.spell_defense || 0);
    unit.min_attack = Math.max(1, intVal(unit.moshen_jue_min_attack_backup, unit.min_attack || 1));
    unit.max_attack = Math.max(unit.min_attack, intVal(unit.moshen_jue_max_attack_backup, unit.max_attack || unit.min_attack));
    unit.spell_attack = Math.max(0, intVal(unit.moshen_jue_spell_attack_backup, unit.spell_attack || 0));
    unit.lifesteal = clamp(numVal(unit.moshen_jue_lifesteal_backup, unit.lifesteal || 0), 0, 0.8);
    unit.moshen_jue_applied = false;
  }

  _consumeSourceBoundNegatives(state, unit);
}

// ─── 回合结束回蓝回血 ───
function applyTurnEndRecovery(unit, events) {
  if (unit.turn_end_mp > 0) {
    const add = unit.turn_end_mp;
    unit.mp = Math.min(unit.max_mp, unit.mp + add);
    events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player',
      action: 'mp_regen', text: `${unit.name} 回复了${add}法力` });
  }
  if (unit.turn_end_hp_pct > 0 || unit.turn_end_mp_pct > 0) {
    if (unit.turn_end_hp_pct > 0) {
      if (isHealForbidden(unit)) {
        pushHealForbiddenEvent(unit, events, '回合恢复');
      } else {
        const spAtk = Math.max(1, unit.spell_attack || unit.max_attack);
        let heal = Math.floor(spAtk * unit.turn_end_hp_pct);
        heal = Math.floor(heal * (1.0 + numVal(unit.heal_bonus, 0)));
        if (unit.zhuohun_rounds > 0 && unit.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - unit.zhuohun_heal_reduce));
        if (!tryJiemieHealToXurui(unit, heal, events)) {
          const healed = applyHealWithOverflowShield(unit, heal, events);
          if (healed.actualHeal > 0) {
            events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player',
              action: 'hp_regen', heal: healed.actualHeal, text: `${unit.name} 回复了${healed.actualHeal}生命` });
          }
        }
      }
    }
    if (unit.turn_end_mp_pct > 0) {
      const add = Math.floor(unit.max_mp * unit.turn_end_mp_pct);
      unit.mp = Math.min(unit.max_mp, unit.mp + add);
    }
  }
  if (unit.turn_end_hp_max_pct > 0) {
    if (isHealForbidden(unit)) {
      pushHealForbiddenEvent(unit, events, '回合恢复');
    } else {
      let heal = Math.floor(unit.max_hp * unit.turn_end_hp_max_pct);
      heal = Math.floor(heal * (1.0 + numVal(unit.heal_bonus, 0)));
      if (unit.zhuohun_rounds > 0 && unit.zhuohun_heal_reduce > 0) heal = Math.floor(heal * (1.0 - unit.zhuohun_heal_reduce));
      if (heal > 0) {
        if (!tryJiemieHealToXurui(unit, heal, events, { text: `劫灭-斗战乾坤：正心诚意回复无效，获得2轮蓄锐` })) {
          const healed = applyHealWithOverflowShield(unit, heal, events);
          if (healed.actualHeal > 0) {
            events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player',
              action: 'hp_regen', heal: healed.actualHeal, text: `${unit.name} 正心诚意，回复了${healed.actualHeal}生命` });
          }
        }
      }
    }
  }
}

function _clearPositiveStatuses(unit) {
  let cleared = 0;
  if (!unit || typeof unit !== 'object') return 0;
  if (unit.nuozhan_rounds > 0) { unit.nuozhan_rounds = 0; cleared++; }
  if (unit.juechang_rounds > 0) { unit.juechang_rounds = 0; cleared++; }
  if (unit.beishui_rounds > 0) { unit.beishui_rounds = 0; cleared++; }
  if (unit.xurui && unit.xurui.active) { unit.xurui = { active: false, duration: 0 }; cleared++; }
  if (unit.yangjing && unit.yangjing.active) { unit.yangjing = { active: false, duration: 0 }; cleared++; }
  if (unit.jingzhun && unit.jingzhun.active) { unit.jingzhun = { active: false, duration: 0 }; cleared++; }
  if (unit.zhuanzhu && unit.zhuanzhu.active) { unit.zhuanzhu = { active: false, duration: 0 }; cleared++; }
  if (unit.chengfeng) { unit.chengfeng = null; cleared++; }
  if (unit.bofa_rounds > 0) { unit.bofa_rounds = 0; cleared++; }
  if (unit.daifa_rounds > 0) { unit.daifa_rounds = 0; cleared++; }
  if (unit.jiangu) { unit.jiangu = null; cleared++; }
  if (unit.hunchong_stacks > 0) { unit.hunchong_stacks = 0; cleared++; }
  if (unit.tudun_rounds > 0) { unit.tudun_rounds = 0; cleared++; }
  if (unit.fenjin_active) { unit.fenjin_active = false; cleared++; }
  return cleared;
}

// ══════════════════════════════════════════════════════════════
//  技能效果处理 — 所有 apply_ 类型
// ══════════════════════════════════════════════════════════════

function applySkillSpecialEffects(skill, skillLevel, attacker, defender, state) {
  const events = [];
  const effects = Array.isArray(skill?.effects) ? skill.effects : [];
  const kurongNoDirect = isKurongShentuActive(attacker);
  const isAnzhuanQiankun = intVal(skill?.id, 0) === 66;
  let anzhuanResolved = false;
  for (const eff of effects) {
    const et = String(eff?.type || '');
    if (isAnzhuanQiankun && (et === 'steal_target_positive_status' || et === 'transfer_self_negative_to_target')) {
      if (anzhuanResolved) continue;
      anzhuanResolved = true;
      const stolen = _stealOnePositiveStatus(attacker, defender, state);
      if (stolen) {
        events.push({
          t: 'combat_log',
          actor: attacker.tag || 'player',
          target: defender.tag || 'enemy',
          action: 'steal_buff',
          text: `${attacker.name} 夺取了${defender.name}的「${stolen}」`
        });
        continue;
      }

      if (!isDebuffImmune(defender)) {
        const moved = _transferOneNegativeStatus(attacker, defender, state);
        if (moved) {
          events.push({
            t: 'combat_log',
            actor: attacker.tag || 'player',
            target: defender.tag || 'enemy',
            action: 'transfer_negative',
            text: `${attacker.name} 将「${moved}」转移给了${defender.name}`
          });
          continue;
        }
      }

      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'anzhuan_qiankun',
        text: `${attacker.name} 施展暗转乾坤，但无可夺取正面状态且无可转移负面状态`
      });
      continue;
    }

    const durBase = intVal(eff?.duration, 3);
    const maxLvBonus = intVal(eff?.maxLevelBonus, 0);
    const durPerLevel = intVal(eff?.durationPerLevel, 0);
    let dur = durBase;
    if (durPerLevel > 0 && skillLevel > 1) dur += (skillLevel - 1) * durPerLevel;
    if (maxLvBonus > 0 && skillLevel >= (skill.levelCap || 99)) dur += maxLvBonus;
    // 我方自增益在本引擎是“回合结束递减”，这里 +1 保证 duration=1 至少覆盖下一次行动
    if (et.endsWith('_self')) dur += 1;

    if (et === 'apply_debuff') {
      let dotPct = numVal(eff.damagePercent, 0.05);
      const dotLvBonus = numVal(eff.damagePercentPerLevel, 0) || numVal(eff.coefficientBonus, 0);
      if (skillLevel > 1 && dotLvBonus > 0) dotPct += (skillLevel - 1) * dotLvBonus;
      let dotMinPct = numVal(eff.damagePercentMin, -1);
      let dotMaxPct = numVal(eff.damagePercentMax, -1);
      if (dotMinPct >= 0 || dotMaxPct >= 0) {
        if (dotMinPct < 0) dotMinPct = dotPct;
        if (dotMaxPct < 0) dotMaxPct = dotPct;
      }
      events.push(...applyDebuff(defender, {
        type: String(eff.debuffType || 'bleed'),
        stacks: intVal(eff.stacks, 3),
        damagePercent: dotPct,
        damagePercentMin: dotMinPct,
        damagePercentMax: dotMaxPct,
        attribute: String(eff.attribute || 'max_hp'),
        ignoreDefense: Boolean(eff.ignoreDefense),
        agilityReducePercent: numVal(eff.agilityReducePercent, 0),
        element: String(skill?.attribute || '')
      }, state, attacker));
    } else if (et === 'apply_chuanxin') {
      let chuanxinDur = dur;
      if (attacker.ex_weapon?.apply_chuanxin_on_phys) chuanxinDur = 1 + dur;
      events.push(...applyChuanxinWithZuiyeyiju(attacker, defender, chuanxinDur, state));
    } else if (et === 'apply_nuozhan_self') {
      attacker.nuozhan_rounds = Math.max(attacker.nuozhan_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'nuozhan', text: `${attacker.name} 进入搦战状态！物理必暴击${dur}回合，溢出暴击率转化为最终伤害加成` });
    } else if (et === 'apply_juechang_self') {
      let jDur = dur;
      if (attacker.ex_weapon?.juechang_bonus_rounds) jDur += attacker.ex_weapon.juechang_bonus_rounds;
      attacker.juechang_rounds = Math.max(attacker.juechang_rounds || 0, jDur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'juechang', text: `${attacker.name} 进入绝唱状态！法术必暴击${jDur}回合` });
    } else if (et === 'apply_beishui_self' || et === 'apply_beishui') {
      const target = et.endsWith('_self') ? attacker : defender;
      target.beishui_rounds = Math.max(target.beishui_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: target.tag || 'enemy',
        action: 'beishui', text: `${target.name} 进入背水状态！无视防御+20%伤害，持续${dur}回合` });
    } else if (et === 'apply_fear') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '恐惧', 'debuff');
        continue;
      }
      dur = consumeJueyiForControl(defender, dur);
      defender.fear_rounds = Math.max(defender.fear_rounds || 0, dur);
      // 恐惧抵消蓄锐
      if (defender.xurui && defender.xurui.active) {
        const cancel = Math.min(dur, defender.xurui.duration);
        defender.xurui.duration -= cancel;
        if (defender.xurui.duration <= 0) defender.xurui = { active: false, duration: 0 };
      }
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'fear', text: `${defender.name} 被恐惧！物理伤害取最小值，持续${dur}回合` });
    } else if (et === 'apply_xurui_self') {
      attacker.xurui = { active: true, duration: dur };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'xurui', text: `${attacker.name} 进入蓄锐状态！物理伤害取最大值，持续${dur}回合` });
    } else if (et === 'apply_yangjing_self') {
      attacker.yangjing = { active: true, duration: dur };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'yangjing', text: `${attacker.name} 进入养精状态！法术伤害取最大值，持续${dur}回合` });
    } else if (et === 'apply_jingzhun_self') {
      attacker.jingzhun = { active: true, duration: dur };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'jingzhun', text: `${attacker.name} 进入精准状态！物理暴击率+25%，持续${dur}回合` });
    } else if (et === 'apply_zhuanzhu_self') {
      attacker.zhuanzhu = { active: true, duration: dur };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'zhuanzhu', text: `${attacker.name} 进入专注状态！法术暴击率+25%，持续${dur}回合` });
    } else if (et === 'apply_slow') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '迟缓', 'debuff');
        continue;
      }
      dur = consumeJueyiForControl(defender, dur);
      const mult = numVal(eff?.speedMultiplier, 0.7);
      defender.slow_effect = dur > 0 ? { duration: dur, speedMultiplier: mult } : null;
      if (dur > 0) events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'slow', text: `${defender.name} 被迟缓！行动速度降低，持续${dur}回合` });
    } else if (et === 'apply_chengfeng_self') {
      const bonus = numVal(eff?.speedBonus, 0.3);
      const old = attacker.chengfeng && typeof attacker.chengfeng === 'object' ? attacker.chengfeng : {};
      const finalDur = dur + (attacker.jianxin ? 1 : 0);
      attacker.chengfeng = {
        speedBonus: Math.max(numVal(old.speedBonus, 0), bonus),
        duration: Math.max(intVal(old.duration, 0), finalDur)
      };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'chengfeng', text: `${attacker.name} 乘风！下次行动加速` });
    } else if (et === 'apply_jianxin_self') {
      attacker.jianxin = true;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'jianxin', text: `${attacker.name} 进入剑心状态，持续至战斗结束！` });
    } else if (et === 'apply_juemai') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '绝脉', 'debuff');
        continue;
      }
      if (isPvpBattleMode(state?.battle_mode) && eff.pvpDuration != null) dur = intVal(eff.pvpDuration, dur);
      dur = consumeJueyiForControl(defender, dur);
      defender.juemai_rounds = Math.max(defender.juemai_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'juemai', text: `${defender.name} 被绝脉！只能使用普通攻击，持续${dur}回合` });
    } else if (et === 'apply_bofa_self') {
      if (isPvpBattleMode(state?.battle_mode) && eff.pvpDuration != null) {
        dur = intVal(eff.pvpDuration, dur);
        if (et.endsWith('_self')) dur += 1;
      }
      attacker.bofa_rounds = Math.max(attacker.bofa_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'bofa', text: `${attacker.name} 进入勃发状态！必定使用技能，持续${dur}回合` });
    } else if (et === 'apply_daifa_self') {
      attacker.daifa_rounds = Math.max(attacker.daifa_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'daifa', text: `${attacker.name} 进入待发状态！受击必反击，持续${dur}回合` });
    } else if (et === 'apply_zhenyue_self') {
      attacker.zhenyue_rounds = Math.max(attacker.zhenyue_rounds || 0, dur);
      attacker.zhenyue_shanpo = 0;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'zhenyue', text: `${attacker.name} 进入镇岳状态！每次受伤叠加山魄，状态结束后触发反击` });
    } else if (et === 'apply_jiangu_self') {
      const physCoeff = numVal(eff?.physCoeff, 0.15) + (skillLevel > 1 ? (skillLevel - 1) * numVal(eff?.physCoeffPerLevel, 0.025) : 0);
      const spellCoeff = numVal(eff?.spellCoeff, 0.075) + (skillLevel > 1 ? (skillLevel - 1) * numVal(eff?.spellCoeffPerLevel, 0.0125) : 0);
      attacker.jiangu = { duration: dur, physCoeff, spellCoeff };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'jiangu', text: `${attacker.name} 进入坚固状态！防御提升，持续${dur}回合` });
    } else if (et === 'apply_kuiran') {
      const kDur = Math.max(1, intVal(eff?.duration, 2));
      const physCoeff = clamp(numVal(eff?.physCoeff, 0.5), 0, 10);
      const spellCoeff = clamp(numVal(eff?.spellCoeff, 0.5), 0, 10);
      attacker.jiangu = {
        duration: Math.max(intVal(attacker?.jiangu?.duration, 0), kDur),
        physCoeff: Math.max(numVal(attacker?.jiangu?.physCoeff, 0), physCoeff),
        spellCoeff: Math.max(numVal(attacker?.jiangu?.spellCoeff, 0), spellCoeff)
      };
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'kuiran', text: `${attacker.name} 岿然不动！物防与法防提升，持续${kDur}回合` });
    } else if (et === 'apply_fumo') {
      if (isPvpBattleMode(state?.battle_mode)) continue;
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '伏魔', 'debuff');
        continue;
      }
      dur = consumeJueyiForControl(defender, dur);
      defender.fumo_rounds = Math.max(defender.fumo_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'fumo', text: `${defender.name} 被伏魔！法术攻击目标变为自身，持续${dur}回合` });
    } else if (et === 'apply_stasis') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '凝滞', 'debuff');
        continue;
      }
      dur = consumeJueyiForControl(defender, dur);
      if (dur > 0) {
        defender.stasis_rounds = Math.max(defender.stasis_rounds || 0, dur);
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
          action: 'stasis', text: `${defender.name} 被凝滞！下一次行动被跳过，持续${dur}回合` });
      }
    } else if (et === 'apply_mark_self') {
      attacker.mark_rounds = Math.max(attacker.mark_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'mark', text: `${attacker.name} 获得标记！所有敌方将优先攻击自己，持续${dur}回合` });
    } else if (et === 'apply_mark_target') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '标记', 'debuff');
        continue;
      }
      defender.mark_rounds = Math.max(defender.mark_rounds || 0, dur);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'mark', text: `${defender.name} 被标记！将被所有敌方优先攻击，持续${dur}回合` });
    } else if (et === 'apply_zhuohun') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '灼魂', 'debuff');
        continue;
      }
      let zDur = dur;
      if (isPvpBattleMode(state?.battle_mode) && eff.pvpDuration != null) zDur = intVal(eff.pvpDuration, dur);
      zDur = consumeJueyiForControl(defender, zDur);
      const reduce = numVal(eff?.healReduction, 0.4);
      defender.zhuohun_rounds = Math.max(defender.zhuohun_rounds || 0, zDur);
      defender.zhuohun_heal_reduce = reduce;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'zhuohun', text: `${defender.name} 被灼魂！治疗效率降低${Math.floor(reduce * 100)}%，持续${zDur}回合` });
    } else if (et === 'apply_wenluan') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '紊乱', 'debuff');
        continue;
      }
      let wDur = Math.max(1, intVal(eff?.duration, 2));
      if (isPvpBattleMode(state?.battle_mode) && eff.pvpDuration != null) {
        wDur = Math.max(1, intVal(eff.pvpDuration, wDur));
      }
      wDur = consumeJueyiForControl(defender, wDur);
      const ratio = clamp(numVal(eff?.ratio, 0.5), 0, 10);
      defender.wenluan_rounds = Math.max(intVal(defender.wenluan_rounds, 0), wDur);
      defender.wenluan_ratio = Math.max(numVal(defender.wenluan_ratio, 0), ratio);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'wenluan', text: `${defender.name} 陷入紊乱！其造成的回复将反噬自身${Math.floor(ratio * 100)}%，持续${wDur}回合` });
    } else if (et === 'clear_target_buffs') {
      const cleared = _clearPositiveStatuses(defender);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'clear_buffs', text: cleared > 0 ? `${defender.name} 的${cleared}个正面状态被清除！` : `${defender.name} 没有正面状态可清除` });
    } else if (et === 'steal_target_positive_status') {
      const chance = clamp(numVal(eff?.chance, 1), 0, 1);
      const pass = chance >= 1 ? true : ((state ? nextRand01(state) : Math.random()) < chance);
      if (!pass) {
        events.push({
          t: 'combat_log',
          actor: attacker.tag || 'player',
          target: defender.tag || 'enemy',
          action: 'steal_buff',
          text: `${attacker.name} 尝试夺取状态但未触发`
        });
        continue;
      }
      const count = Math.max(1, intVal(eff?.count, 1));
      const labels = [];
      for (let i = 0; i < count; i++) {
        const stolen = _stealOnePositiveStatus(attacker, defender, state);
        if (!stolen) break;
        labels.push(stolen);
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'steal_buff',
        text: labels.length > 0
          ? `${attacker.name} 夺取了${defender.name}的「${labels.join('、')}」`
          : `${defender.name} 没有可夺取的正面状态`
      });
    } else if (et === 'transfer_self_negative_to_target') {
      const chance = clamp(numVal(eff?.chance, 1), 0, 1);
      const pass = chance >= 1 ? true : ((state ? nextRand01(state) : Math.random()) < chance);
      if (!pass) {
        events.push({
          t: 'combat_log',
          actor: attacker.tag || 'player',
          target: defender.tag || 'enemy',
          action: 'transfer_negative',
          text: `${attacker.name} 尝试转移负面状态但未触发`
        });
        continue;
      }
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '负面转移', 'debuff');
        continue;
      }
      const count = Math.max(1, intVal(eff?.count, 1));
      const labels = [];
      for (let i = 0; i < count; i++) {
        const moved = _transferOneNegativeStatus(attacker, defender, state);
        if (!moved) break;
        labels.push(moved);
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'transfer_negative',
        text: labels.length > 0
          ? `${attacker.name} 将「${labels.join('、')}」转移给了${defender.name}`
          : `${attacker.name} 没有可转移的负面状态`
      });
    } else if (et === 'cleanse_self_negative') {
      const count = Math.max(1, intVal(eff?.count, 1));
      const labels = [];
      for (let i = 0; i < count; i++) {
        const removed = _removeOneNegativeStatus(attacker, state);
        if (!removed) break;
        labels.push(removed);
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: attacker.tag || 'player',
        action: 'cleanse_negative',
        text: labels.length > 0
          ? `${attacker.name} 净化了「${labels.join('、')}」`
          : `${attacker.name} 没有可净化的负面状态`
      });
    } else if (et === 'set_next_action_heal_self') {
      let healPct = numVal(eff?.value, 0.1);
      if (skillLevel > 1) healPct += (skillLevel - 1) * numVal(eff?.coefficientBonus, 0);
      healPct = clamp(healPct, 0, 1);
      let pvpHealPct = numVal(eff?.pvpValue, healPct);
      if (skillLevel > 1) pvpHealPct += (skillLevel - 1) * numVal(eff?.pvpCoefficientBonus, numVal(eff?.coefficientBonus, 0));
      pvpHealPct = clamp(pvpHealPct, 0, 1);
      attacker.next_action_heal_pct = Math.max(numVal(attacker.next_action_heal_pct, 0), healPct);
      attacker.next_action_heal_pvp_pct = Math.max(numVal(attacker.next_action_heal_pvp_pct, 0), pvpHealPct);
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: attacker.tag || 'player',
        action: 'next_action_heal_ready',
        text: `${attacker.name} 凝聚归元之力，下次行动将恢复生命`
      });
    } else if (et === 'apply_stasis_self') {
      attacker.stasis_rounds = Math.max(attacker.stasis_rounds || 0, dur);
      if (Boolean(eff?.immuneDamage) || Boolean(eff?.immuneDebuff)) {
        attacker.stasis_guard_active = true;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: attacker.tag || 'player',
        action: 'stasis_self',
        text: `${attacker.name} 进入凝滞护体，持续${dur}回合`
      });
    } else if (et === 'clear_mp_heal_percent') {
      const consumedMp = Math.max(0, intVal(attacker.mp, 0));
      attacker.mp = 0;
      let ratio = numVal(eff?.value, 0.65);
      if (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) {
        ratio = numVal(eff?.pvpValue, ratio);
      }
      const heal = Math.max(0, Math.floor(consumedMp * clamp(ratio, 0, 10)));
      if (heal > 0) {
        if (isHealForbidden(attacker)) {
          pushHealForbiddenEvent(attacker, events, skill?.name || '技能效果');
        } else {
          const healed = applyHealWithOverflowShield(attacker, heal, events);
          const actual = healed.actualHeal;
          events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player', action: 'mp_to_heal',
            heal: actual, text: `${attacker.name} 清空法力，回复了${actual}生命` });
        }
      } else {
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player', action: 'mp_to_heal',
          text: `${attacker.name} 清空了全部法力` });
      }
    } else if (et === 'yinyang_toggle') {
      const isYin = (attacker.yinyang_state || 'yin') === 'yin';
      events.push({ t: 'combat_log', actor: attacker.tag || 'player',
        target: isYin ? (defender.tag || 'enemy') : (attacker.tag || 'player'),
        action: isYin ? 'yinyang_yin' : 'yinyang_yang',
        text: isYin ? `定阴阳·阴：无视${defender.name}40%法术防御！` : `定阴阳·阳：${attacker.name}必定暴击！` });
      attacker.yinyang_state = isYin ? 'yang' : 'yin';
    } else if (et === 'apply_hunchong') {
      let hunchongTarget = attacker;
      const casterTeam = attacker?.is_ally ? state?.allies : state?.enemies;
      if (String(eff.target || '') === 'self_or_ally' && Array.isArray(casterTeam)) {
        const candidates = casterTeam.filter(a => a && a.alive !== false && a.hp > 0 && !(a.hunchong_stacks > 0));
        if (candidates.length > 0) {
          hunchongTarget = candidates.reduce((lo, cur) =>
            (cur.hp / cur.max_hp) < (lo.hp / lo.max_hp) ? cur : lo, candidates[0]);
        }
      }
      hunchongTarget.hunchong_stacks = Math.max(hunchongTarget.hunchong_stacks || 0, 1);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: hunchongTarget.tag || 'player',
        action: 'hunchong', text: `${hunchongTarget.name} 获得了缓冲！可抵消一次伤害` });
    } else if (et === 'apply_team_hunchong') {
      attacker.hunchong_stacks = Math.max(attacker.hunchong_stacks || 0, 1);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
        action: 'hunchong', text: `${attacker.name} 获得了缓冲！可抵消一次伤害` });
      const casterTeam = attacker?.is_ally ? state?.allies : state?.enemies;
      if (Array.isArray(casterTeam)) {
        for (const ally of casterTeam) {
          if (ally && ally !== attacker && ally.hp > 0) {
            ally.hunchong_stacks = Math.max(ally.hunchong_stacks || 0, 1);
            events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: ally.tag || 'ally',
              action: 'hunchong', text: `${ally.name} 获得了缓冲！可抵消一次伤害` });
          }
        }
      }
    } else if (et === 'gain_temp_shield_max_hp_percent') {
      let shieldPct = numVal(eff?.value, 0);
      if (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) {
        shieldPct = numVal(eff?.pvpValue, shieldPct);
      }
      const addShield = Math.max(0, Math.floor(Math.max(1, intVal(attacker.max_hp, 1)) * clamp(shieldPct, 0, 10)));
      if (addShield > 0) {
        attacker.temp_shield = Math.max(0, intVal(attacker.temp_shield, 0)) + addShield;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: attacker.tag || 'player',
        action: 'gain_temp_shield',
        shield: addShield,
        text: `${attacker.name} 获得了${addShield}点临时护盾`
      });
    } else if (et === 'deal_target_current_hp_true_damage') {
      let ratio = numVal(eff?.value, 0.25);
      if (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) {
        ratio = numVal(eff?.pvpValue, ratio);
      }
      ratio = clamp(ratio, 0, 1);
      let dmg = Math.max(0, Math.floor(Math.max(0, intVal(defender.hp, 0)) * ratio));
      if (kurongNoDirect && dmg > 0) dmg = 0;
      if (defender.hunchong_stacks > 0 && dmg > 0) {
        defender.hunchong_stacks -= 1;
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
          text: `${defender.name} 的缓冲抵消了这次伤害！` });
      } else if (defender.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
          text: `${defender.name} 无视了这次伤害！` });
      }
      if (dmg > 0) {
        dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
        defender.hp = Math.max(0, defender.hp - dmg);
        if (defender.hp <= 0) defender.alive = false;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'mingzhifaze',
        damage: dmg,
        text: `${attacker.name} 裁断命理，对${defender.name}造成${dmg}点绝对伤害`
      });
    } else if (et === 'deal_target_lost_hp_true_damage') {
      let ratio = numVal(eff?.value, 0.25);
      if (isPvpBattleMode(state?.battle_mode) && eff?.pvpValue != null) {
        ratio = numVal(eff?.pvpValue, ratio);
      }
      ratio = clamp(ratio, 0, 1);
      const lostHp = Math.max(0, intVal(defender.max_hp, 0) - intVal(defender.hp, 0));
      let dmg = Math.max(0, Math.floor(lostHp * ratio));
      if (kurongNoDirect && dmg > 0) dmg = 0;
      if (defender.hunchong_stacks > 0 && dmg > 0) {
        defender.hunchong_stacks -= 1;
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
          text: `${defender.name} 的缓冲抵消了这次伤害！` });
      } else if (defender.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
          text: `${defender.name} 无视了这次伤害！` });
      }
      if (dmg > 0) {
        dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
        defender.hp = Math.max(0, defender.hp - dmg);
        if (defender.hp <= 0) defender.alive = false;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'nimingfaze',
        damage: dmg,
        text: `${attacker.name} 逆转命盘，对${defender.name}造成${dmg}点绝对伤害`
      });
    } else if (et === 'botaoyi_flow') {
      const hadDielang = intVal(defender?.botaoyi_dielang, 0) > 0;
      if (hadDielang) {
        defender.botaoyi_dielang = 0;
        const raw = Math.max(0, Math.floor(Math.max(0, numVal(attacker.zhenyuan, 0)) * 2));
        let effDef = Math.max(0, intVal(defender.spell_defense, 0));
        const pen = clamp(numVal(attacker.spell_armor_pen, 0), 0, 0.9);
        if (pen > 0) effDef = Math.floor(effDef * (1.0 - pen));
        if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
        const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
        let dmg = raw > 0 ? calcReducedDamage(raw, effDef, divisor) : 0;
        if (kurongNoDirect && dmg > 0) dmg = 0;
        if (defender.damage_reduction > 0) {
          dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
        }
        if (dmg > 0 && attacker.spell_final_damage > 0) {
          dmg = Math.floor(dmg * (1.0 + numVal(attacker.spell_final_damage, 0)));
        }
        if (defender.hunchong_stacks > 0 && dmg > 0) {
          defender.hunchong_stacks -= 1;
          dmg = 0;
          events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
            text: `${defender.name} 的缓冲抵消了这次伤害！` });
        } else if (defender.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
          dmg = 0;
          events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
            text: `${defender.name} 无视了这次伤害！` });
        }
        if (dmg > 0) {
          dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
          defender.hp = Math.max(0, defender.hp - dmg);
          if (defender.hp <= 0) defender.alive = false;
        }
        events.push({
          t: 'combat_log',
          actor: attacker.tag || 'player',
          target: defender.tag || 'enemy',
          action: 'botaoyi_break',
          damage: dmg,
          text: `${attacker.name} 引爆叠浪，对${defender.name}造成${dmg}点法术伤害`
        });
      } else {
        const rawPerHit = Math.max(0, Math.floor(
          Math.max(0, numVal(attacker.zhenyuan, 0)) * 0.5 +
          Math.max(0, numVal(attacker.constitution, 0)) * 0.5
        ));
        for (let i = 0; i < 3; i++) {
          if (defender.hp <= 0) break;
          let effDef = Math.max(0, intVal(defender.defense, 0));
          const pen = clamp(numVal(attacker.physical_armor_pen, 0), 0, 0.9);
          if (pen > 0) effDef = Math.floor(effDef * (1.0 - pen));
          if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
          const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
          let dmg = rawPerHit > 0 ? calcReducedDamage(rawPerHit, effDef, divisor) : 0;
          if (kurongNoDirect && dmg > 0) dmg = 0;
          if (defender.damage_reduction > 0) {
            dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
          }
          if (defender.hunchong_stacks > 0 && dmg > 0) {
            defender.hunchong_stacks -= 1;
            dmg = 0;
            events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
              text: `${defender.name} 的缓冲抵消了这次伤害！` });
          } else if (defender.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
            dmg = 0;
            events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
              text: `${defender.name} 无视了这次伤害！` });
          }
          if (dmg > 0) {
            dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
            defender.hp = Math.max(0, defender.hp - dmg);
            if (defender.hp <= 0) defender.alive = false;
          }
          events.push({
            t: 'combat_log',
            actor: attacker.tag || 'player',
            target: defender.tag || 'enemy',
            action: 'botaoyi_hit',
            damage: dmg,
            text: `${attacker.name} 的波涛意第${i + 1}击造成${dmg}点物理伤害`
          });
        }
        if (defender.hp > 0) {
          defender.botaoyi_dielang = 1;
        }
      }
    } else if (et === 'deal_self_current_hp_physical_damage') {
      const ratio = clamp(numVal(eff?.value, 0.25), 0, 1);
      const raw = Math.max(0, Math.floor(Math.max(0, intVal(attacker.hp, 0)) * ratio));
      let effDef = Math.max(0, intVal(defender.defense, 0));
      const pen = clamp(numVal(attacker.physical_armor_pen, 0), 0, 0.9);
      if (pen > 0) effDef = Math.floor(effDef * (1.0 - pen));
      if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
      const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
      let dmg = raw > 0 ? calcReducedDamage(raw, effDef, divisor) : 0;
      if (kurongNoDirect && dmg > 0) dmg = 0;
      if (defender.damage_reduction > 0) {
        dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
      }
      if (defender.hunchong_stacks > 0 && dmg > 0) {
        defender.hunchong_stacks -= 1;
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
          text: `${defender.name} 的缓冲抵消了这次伤害！` });
      }
      if (dmg > 0) {
        dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
        defender.hp = Math.max(0, defender.hp - dmg);
        if (defender.hp <= 0) defender.alive = false;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'tizhifaze',
        damage: dmg,
        text: `${attacker.name} 以血魄为锋，对${defender.name}造成${dmg}点物理伤害`
      });
    } else if (et === 'deal_self_current_mp_spell_damage') {
      const ratio = clamp(numVal(eff?.value, 0.25), 0, 1);
      const raw = Math.max(0, Math.floor(Math.max(0, intVal(attacker.mp, 0)) * ratio));
      let effDef = Math.max(0, intVal(defender.spell_defense, 0));
      const pen = clamp(numVal(attacker.spell_armor_pen, 0), 0, 0.9);
      if (pen > 0) effDef = Math.floor(effDef * (1.0 - pen));
      if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
      const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
      let dmg = raw > 0 ? calcReducedDamage(raw, effDef, divisor) : 0;
      if (kurongNoDirect && dmg > 0) dmg = 0;
      if (defender.damage_reduction > 0) {
        dmg = Math.floor(dmg * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
      }
      if (dmg > 0 && attacker.spell_final_damage > 0) {
        dmg = Math.floor(dmg * (1 + attacker.spell_final_damage));
      }
      if (defender.hunchong_stacks > 0 && dmg > 0) {
        defender.hunchong_stacks -= 1;
        dmg = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
          text: `${defender.name} 的缓冲抵消了这次伤害！` });
      }
      if (dmg > 0) {
        dmg = capIncomingDamageByTaixu(defender, dmg, events, { state }).damage;
        defender.hp = Math.max(0, defender.hp - dmg);
        if (defender.hp <= 0) defender.alive = false;
      }
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: defender.tag || 'enemy',
        action: 'lingzhifaze',
        damage: dmg,
        text: `${attacker.name} 倾泻灵潮，对${defender.name}造成${dmg}点法术伤害`
      });
    } else if (et === 'apply_zhendang') {
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '震荡', 'debuff');
        continue;
      }
      if (defender.perfect_earth) {
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'perfect_earth_immunity',
          text: `${defender.name} 的完美土灵根免疫了震荡` });
        continue;
      }
      let zDur = dur;
      if (isPvpBattleMode(state?.battle_mode) && eff.pvpDuration != null) zDur = intVal(eff.pvpDuration, dur);
      zDur = consumeJueyiForControl(defender, zDur);
      const pct = numVal(eff?.reductionPercent, 0.3);
      if (defender.zhendang_rounds > 0) {
        defender.spell_attack = (defender.spell_attack || 0) + (defender.zhendang_spell_attack_stored || 0);
        defender.spell_defense = (defender.spell_defense || 0) + (defender.zhendang_spell_defense_stored || 0);
      }
      const saReduce = Math.floor((defender.spell_attack || 0) * pct);
      const sdReduce = Math.floor((defender.spell_defense || 0) * pct);
      defender.spell_attack = Math.max(0, (defender.spell_attack || 0) - saReduce);
      defender.spell_defense = Math.max(0, (defender.spell_defense || 0) - sdReduce);
      defender.zhendang_rounds = zDur;
      defender.zhendang_spell_attack_stored = saReduce;
      defender.zhendang_spell_defense_stored = sdReduce;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'zhendang', text: `${defender.name} 被震荡！法术攻击降低${saReduce}、法术防御降低${sdReduce}，持续${zDur}回合` });
    }
  }
  return events;
}

/** 万古愁 EX：每次音律法术伤害触发一次，随机附加一种负面（迟缓/绝脉/恐惧/缠缚/灼魂/寄生） */
function applyWanguchouOnMusicHit(attacker, defender, state) {
  const events = [];
  if (!attacker?.ex_weapon?.random_debuff_on_music_skill || !defender || defender.hp <= 0) return events;
  const sourceKey = _getUnitSourceKey(attacker);
  const choice = Math.floor(nextRand01(state) * 6);
  if (choice === 0) {
    defender.slow_effect = { duration: 1, speedMultiplier: 0.7 };
    defender.slow_consume_source_key = sourceKey;
    events.push({ t: 'combat_log', actor: 'system', target: defender.tag || 'enemy',
      action: 'wanguchou', text: `万古愁附加了迟缓效果！` });
  } else if (choice === 1) {
    defender.juemai_rounds = Math.max(defender.juemai_rounds || 0, 1);
    defender.juemai_consume_source_key = sourceKey;
    events.push({ t: 'combat_log', actor: 'system', target: defender.tag || 'enemy',
      action: 'wanguchou', text: `万古愁附加了绝脉效果！` });
  } else if (choice === 2) {
    defender.fear_rounds = Math.max(defender.fear_rounds || 0, 1);
    defender.fear_consume_source_key = sourceKey;
    events.push({ t: 'combat_log', actor: 'system', target: defender.tag || 'enemy',
      action: 'wanguchou', text: `万古愁附加了恐惧效果！` });
  } else if (choice === 3) {
    events.push(...applyDebuff(defender, {
      type: 'chanfu', stacks: 1, damagePercent: 0.1, attribute: 'max_hp',
      consumeOnSourceTurn: true,
      consumeSourceKey: sourceKey,
      fromWanguchou: true
    }, state, attacker));
  } else if (choice === 4) {
    defender.zhuohun_rounds = (defender.zhuohun_rounds || 0) + 1;
    defender.zhuohun_heal_reduce = numVal(defender.zhuohun_heal_reduce, 0.4) || 0.4;
    defender.zhuohun_consume_source_key = sourceKey;
    events.push({ t: 'combat_log', actor: 'system', target: defender.tag || 'enemy',
      action: 'wanguchou', text: `万古愁附加了灼魂效果！` });
  } else {
    events.push(...applyDebuff(defender, {
      type: 'jisheng', stacks: 1, damagePercent: 0.2, attribute: 'spell_attack',
      consumeOnSourceTurn: true,
      consumeSourceKey: sourceKey,
      fromWanguchou: true
    }, state, attacker));
  }
  return events;
}

// ─── EX武器/套装：伤害造成后触发 ───
function _tryGrantJiemieXuruiOnPhysCrit(attacker, isSpell, isCrit, events) {
  if (!attacker || isSpell || !isCrit || !attacker.set_8_xurui) return;
  // 回合末递减，内部给 2 才能实现文案上的“1回合”。
  attacker.xurui = { active: true, duration: 2 };
  if (Array.isArray(events)) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
      action: 'set_xurui', text: '劫灭-斗战乾坤：物理暴击触发蓄锐（1回合）' });
  }
}

function tryGrantQishaShentuXurui(attacker, isSpell, events) {
  if (!attacker || isSpell) return false;
  if (!(numVal(attacker.qisha_shentu_active, 0) > 0)) return false;
  if (attacker.xurui?.active) return false;
  attacker.xurui = { active: true, duration: 2 };
  if (Array.isArray(events)) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
      action: 'qisha_shentu', text: `${attacker.name} 的七杀神途触发：获得2轮蓄锐` });
  }
  return true;
}

function applyPostDamageExEffects(attacker, defender, damage, isSpell, skill, state, isCrit = false, hitCount = 1) {
  const events = [];
  if (!attacker || !defender || damage <= 0) return events;
  const kurongNoDirect = isKurongShentuActive(attacker);
  _tryGrantJiemieXuruiOnPhysCrit(attacker, isSpell, isCrit, events);
  const ex = attacker.ex_weapon;
  if (!ex) return events;
  const skillDamageType = String(skill?.damageType || '');
  const triggerAsPhysical = !isSpell || skillDamageType === 'hybrid';
  const triggerAsSpell = isSpell || skillDamageType === 'hybrid';
  const zhenhunyaLogName = ex.zhenhunya_source === 'technique' ? '乙木化生经' : '镇魂牙';

  if (ex.extend_debuff_on_phys && triggerAsPhysical) {
    const debuffs = defender.debuffs;
    if (Array.isArray(debuffs) && debuffs.length > 0) {
      const extendTargetsByType = new Map();
      for (const d of debuffs) {
        if (!d || intVal(d.stacks, 0) <= 0) continue;
        const typeKey = String(d.type || 'debuff');
        const picked = extendTargetsByType.get(typeKey);
        if (!picked || intVal(d.stacks, 1) < intVal(picked.stacks, 1)) extendTargetsByType.set(typeKey, d);
      }
      if (extendTargetsByType.size > 0) {
        for (const d of extendTargetsByType.values()) {
          d.stacks = Math.max(1, intVal(d.stacks, 1) + 1);
        }
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
          action: 'zhenhunya', text: `${zhenhunyaLogName}延长了目标DOT效果1轮（同种仅延长剩余最短者）` });
      }
    }
  }
  if (ex.apply_chuanxin_on_phys && triggerAsPhysical) {
    // 1v1中敌方回合末会递减状态；持续2回合可保证至少覆盖我方下一次出手。
    events.push(...applyChuanxinWithZuiyeyiju(attacker, defender, 2, state));
  }
  if (ex.type === 'wanfajiekong' && nextRand01(state) < (ex.chance || 0.25) && defender.hp > 0) {
    const maxStat = Math.max(attacker.min_attack || 0, attacker.max_attack || 0, attacker.spell_attack || 0, 10);
    const stateCount = _clearPositiveStatuses(defender);
    if (stateCount > 0) {
      const dmgPerState = Math.max(1, Math.floor(maxStat * (ex.damage_per_state_pct || 0.35)));
      let totalDmg = dmgPerState * stateCount;
      totalDmg = capIncomingDamageByTaixu(defender, totalDmg, events, { state }).damage;
      if (kurongNoDirect && totalDmg > 0) totalDmg = 0;
      defender.hp = Math.max(0, defender.hp - totalDmg);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'wanfajiekong', damage: totalDmg, text: `万法皆空清除正面状态，造成${totalDmg}绝对伤害` });
    }
  }
  if (ex.type === 'shifangtianhua' && ex.adaptive_all_damage) {
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
      action: 'shifangtianhua_adaptive', text: '十方天华：本次伤害按目标较低防御自适应判定伤害类型' });
  }
  if (ex.type === 'cangshengbi' && attacker.is_ally && defender.hp > 0 && !isPvpBattleMode(state?.battle_mode)) {
    const effects = Array.isArray(skill?.effects) ? skill.effects : [];
    const hasHybridHeal = String(skill?.damageType || '') !== 'none' && effects.some(ef => {
      const t = String(ef?.type || '');
      return t === 'player_hp_percent' || t === 'heal_max_hp_percent' || t === 'heal_phys_attack_percent' || t === 'heal_team_max_hp_percent';
    });
    if (hasHybridHeal) {
      attacker._skip_hybrid_heal_once = true;
      const missingHp = Math.max(0, intVal(defender.max_hp, 0) - intVal(defender.hp, 0));
      let huntDamage = Math.max(1, Math.floor(missingHp * clamp(numVal(ex.hunt_missing_hp_damage_pct, 0.18), 0.05, 0.5)));
      if (kurongNoDirect && huntDamage > 0) huntDamage = 0;
      if (defender.hunchong_stacks > 0) {
        defender.hunchong_stacks -= 1;
        huntDamage = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
          text: `${defender.name} 的缓冲抵消了诛邪追击！` });
      } else if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
        huntDamage = 0;
        events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
          text: `${defender.name} 无视了诛邪追击！` });
      }
      if (huntDamage > 0) {
        huntDamage = capIncomingDamageByTaixu(defender, huntDamage, events, { state }).damage;
        defender.hp = Math.max(0, defender.hp - huntDamage);
      }
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'cangshengbi_hunt',
        damage: huntDamage, text: `苍生笔：舍疗换杀，对${defender.name}追加${huntDamage}诛邪伤害` });

      const executeRatio = clamp(numVal(ex.hunt_execute_hp_ratio, 0.13), 0.05, 0.5);
      if (!kurongNoDirect && defender.hp > 0 && intVal(defender.max_hp, 1) > 0 && numVal(defender.hp, 0) / Math.max(1, numVal(defender.max_hp, 1)) <= executeRatio) {
        defender.hp = 0;
        defender.alive = false;
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'cangshengbi_execute',
          text: `苍生笔：${defender.name} 气绝，诛邪生效！` });
      }
    }
  }
  if (ex.type === 'chunqiu') {
    if (ex.heal_on_damage_pct > 0 && attacker.hp > 0) {
      const heal = Math.max(1, Math.floor(damage * ex.heal_on_damage_pct));
      if (isHealForbidden(attacker)) {
        pushHealForbiddenEvent(attacker, events, '春秋');
      } else if (!tryJiemieHealToXurui(attacker, heal, events, { text: `劫灭-斗战乾坤：春秋回复无效，获得2轮蓄锐` })) {
        const healed = applyHealWithOverflowShield(attacker, heal, events);
        if (healed.actualHeal > 0) {
          events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
            action: 'chunqiu_heal', heal: healed.actualHeal, text: `春秋回复${healed.actualHeal}生命` });
        }
      }
    }
    if (ex.max_hp_extra_damage_pct > 0 && defender.hp > 0) {
      let extra = Math.max(1, Math.floor(attacker.max_hp * ex.max_hp_extra_damage_pct));
      extra = capIncomingDamageByTaixu(defender, extra, events, { state }).damage;
      if (kurongNoDirect && extra > 0) extra = 0;
      defender.hp = Math.max(0, defender.hp - extra);
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
        action: 'chunqiu_extra', damage: extra, text: `春秋附加${extra}伤害` });
    }
  }
  if (ex.heal_per_debuff_on_spell && triggerAsSpell) {
    const debuffs = defender.debuffs;
    if (Array.isArray(debuffs) && debuffs.length > 0) {
      let totalHeal = 0;
      for (const d of debuffs) {
        const base = d.baseValue != null ? d.baseValue : _resolveDotBaseFromUnit(defender, d.attribute);
        const effectStacks = Math.max(1, intVal(d.effect_stacks, 1));
        const oneRoundDmg = Math.max(1, Math.floor(base * numVal(d.damagePercent, 0.05) * effectStacks));
        totalHeal += Math.floor(oneRoundDmg * (ex.heal_per_debuff_on_spell || 0.25));
      }
      totalHeal = Math.floor(totalHeal * (1.0 + numVal(attacker.heal_bonus, 0)));
      if (totalHeal > 0 && attacker.hp > 0) {
        if (isHealForbidden(attacker)) {
          pushHealForbiddenEvent(attacker, events, zhenhunyaLogName);
        } else if (!tryJiemieHealToXurui(attacker, totalHeal, events, { text: `劫灭-斗战乾坤：${zhenhunyaLogName}回复无效，获得2轮蓄锐` })) {
          const healed = applyHealWithOverflowShield(attacker, totalHeal, events);
          if (healed.actualHeal > 0) {
            events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
              action: 'zhenhunya_heal', heal: healed.actualHeal, text: `${zhenhunyaLogName}回复${healed.actualHeal}生命` });
          }
        }
      }
    }
  }
  return events;
}

// ─── 罪业一炬：穿心施加时若目标已有穿心则改为造成伤害 ───
function applyChuanxinWithZuiyeyiju(attacker, defender, chuanxinRounds, state) {
  const events = [];
  if (!attacker || !defender || chuanxinRounds <= 0) return events;
  if (isDebuffImmune(defender)) {
    pushStasisGuardEvent(defender, events, '穿心', 'debuff');
    return events;
  }
  if (defender.perfect_earth) {
    defender.chuanxin_rounds = 0;
    events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'perfect_earth_immunity',
      text: `${defender.name} 的完美土灵根免疫了穿心` });
    return events;
  }
  const ex = attacker.ex_weapon;
  const hadChuanxin = (defender.chuanxin_rounds || 0) > 0;
  if (ex?.apply_chuanxin_on_phys && hadChuanxin && ex.repeat_chuanxin_damage_pct) {
    const physAtk = Math.floor((attacker.min_attack + attacker.max_attack) / 2);
    const hitPerRound = Math.max(1, Math.floor(physAtk * ex.repeat_chuanxin_damage_pct));
    let totalDmg = hitPerRound * chuanxinRounds;
    totalDmg = capIncomingDamageByTaixu(defender, totalDmg, events, { state }).damage;
    if (isKurongShentuActive(attacker) && totalDmg > 0) totalDmg = 0;
    defender.hp = Math.max(0, defender.hp - totalDmg);
    events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
      action: 'zuiyeyiju', damage: totalDmg, text: `罪业一炬重复穿心造成${totalDmg}伤害` });
    return events;
  }
  defender.chuanxin_rounds = Math.max(defender.chuanxin_rounds || 0, chuanxinRounds);
  events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
    action: 'chuanxin', text: `${defender.name} 被穿心！防御降低40%，持续${chuanxinRounds}回合` });
  return events;
}

// ─── 套装效果辅助 ───
const QIXIANG_TYPES = ['云', '风', '露', '尘', '霞', '昼', '夜'];

function _syncFenjieSpellFinalDamage(unit) {
  if (!unit || typeof unit !== 'object') return;
  const active = numVal(unit.fenjie_shentu_active, 0) > 0;
  const base = Math.max(0, numVal(unit.fenjie_base_spell_final_damage_pct, unit.spell_final_damage_pct || 0));
  const stacks = Math.max(0, intVal(unit.fenjie_yanshi_stacks, 0));
  unit.fenjie_base_spell_final_damage_pct = base;
  unit.fenjie_yanshi_stacks = stacks;
  unit.spell_final_damage_pct = active ? (base + stacks * 0.05) : base;
}

function applyFenjieShentuOnDamageSkill(state, attacker, events, opts = {}) {
  if (!attacker || typeof attacker !== 'object') {
    return { triggered: false, exploded: false, stacks: 0 };
  }
  if (!(numVal(attacker.fenjie_shentu_active, 0) > 0)) {
    return { triggered: false, exploded: false, stacks: 0 };
  }
  _syncFenjieSpellFinalDamage(attacker);
  const prevStacks = Math.max(0, intVal(attacker.fenjie_yanshi_stacks, 0));
  const nextStacks = prevStacks + 1;

  if (nextStacks < 4) {
    attacker.fenjie_yanshi_stacks = nextStacks;
    _syncFenjieSpellFinalDamage(attacker);
    if (!opts.silentLog && Array.isArray(events)) {
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: attacker.tag || 'player',
        action: 'fenjie_yanshi_stack',
        stacks: nextStacks,
        text: `${attacker.name} 的焚界神途叠加焰势（${nextStacks}/4），法术最终伤害提升至+${Math.round(nextStacks * 5)}%`
      });
    }
    return { triggered: true, exploded: false, stacks: nextStacks };
  }

  attacker.fenjie_yanshi_stacks = 0;
  _syncFenjieSpellFinalDamage(attacker);
  if (!opts.silentLog && Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: attacker.tag || 'player',
      target: 'both',
      action: 'fenjie_explode',
      text: `${attacker.name} 的焚界神途达到4层，焰势引爆！`
    });
  }

  const units = [];
  const seen = new Set();
  for (const u of _collectBattleStartUnits(state)) {
    if (!u || typeof u !== 'object') continue;
    if (seen.has(u)) continue;
    seen.add(u);
    if (u.alive === false || intVal(u.hp, 0) <= 0) continue;
    units.push(u);
  }

  for (const unit of units) {
    let dmg = Math.max(1, Math.floor(Math.max(1, intVal(unit.max_hp, 1)) * 0.15));
    if (unit.hunchong_stacks > 0 && dmg > 0) {
      unit.hunchong_stacks -= 1;
      dmg = 0;
      if (Array.isArray(events)) {
        events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player', action: 'hunchong_absorb',
          text: `${unit.name} 的缓冲抵消了焰势引爆！` });
      }
    } else if (unit.direct_damage_ignore_chance > 0 && dmg > 0 && nextRand01(state) < unit.direct_damage_ignore_chance) {
      dmg = 0;
      if (Array.isArray(events)) {
        events.push({ t: 'combat_log', actor: unit.tag || 'player', target: unit.tag || 'player', action: 'ignore',
          text: `${unit.name} 无视了焰势引爆！` });
      }
    }
    if (dmg > 0) {
      dmg = absorbDamageByTempShield(unit, dmg, events);
      dmg = capIncomingDamageByTaixu(unit, dmg, events, { state }).damage;
      unit.hp = Math.max(0, intVal(unit.hp, 0) - dmg);
      if (unit.hp <= 0) unit.alive = false;
    }
    if (Array.isArray(events)) {
      events.push({
        t: 'combat_log',
        actor: attacker.tag || 'player',
        target: unit.tag || 'player',
        action: 'fenjie_explode_hit',
        damage: dmg,
        text: `焰势引爆命中${unit.name}，造成${dmg}点伤害`
      });
    }
  }
  return { triggered: true, exploded: true, stacks: 0 };
}

// ─── 5件套决意系统 ───
function tickJueyi(unit) {
  if (!unit.set_5_jueyi) return;
  unit.jueyi_action_count = (unit.jueyi_action_count || 0) + 1;
  if (unit.jueyi_action_count >= 3) {
    unit.jueyi_action_count = 0;
    unit.jueyi_stacks = (unit.jueyi_stacks || 0) + 1;
  }
}

// ─── 受到控制时消耗决意 ───
function consumeJueyiForControl(unit, controlRounds) {
  if (!unit.jueyi_stacks || unit.jueyi_stacks <= 0) return controlRounds;
  const cancel = Math.min(unit.jueyi_stacks, controlRounds);
  unit.jueyi_stacks -= cancel;
  return controlRounds - cancel;
}

// ─── 战斗初始化：玄黄8件 ───
function initXuanhuang8AtBattleStart(state) {
  const p = state?.player;
  const e = state?.enemy;
  if (!p || !e || countSetPieces(p, '玄黄-永生不灭') < 8) return [];
  p.slow_effect = { duration: 999, speedMultiplier: 0.7 };
  p.xuanhuang_slow_until_end = true;
  e.slow_effect = { duration: 999, speedMultiplier: 0.7 };
  e.xuanhuang_slow_until_end = true;
  return [{ t: 'combat_log', actor: 'system', target: 'both', action: 'xuanhuang8',
    text: '玄黄-永生不灭：敌我双方获得迟缓，持续至战斗结束' }];
}

function _collectBattleStartUnits(state) {
  const out = [];
  if (state?.player && typeof state.player === 'object') out.push(state.player);
  if (state?.enemy && typeof state.enemy === 'object') out.push(state.enemy);
  if (Array.isArray(state?.allies)) {
    for (const u of state.allies) {
      if (u && typeof u === 'object') out.push(u);
    }
  }
  if (Array.isArray(state?.enemies)) {
    for (const u of state.enemies) {
      if (u && typeof u === 'object') out.push(u);
    }
  }
  return out;
}

function _applyBattleStartTempShieldByTechnique(unit, events) {
  if (!unit || typeof unit !== 'object') return 0;
  const shieldPct = clamp(numVal(unit.battle_start_temp_shield_from_spell_attack_pct, 0), 0, 10);
  if (shieldPct <= 0) return 0;
  const spellAttack = Math.max(1, intVal(unit.spell_attack, unit.max_attack || 1));
  const addShield = Math.max(0, Math.floor(spellAttack * shieldPct));
  if (addShield <= 0) return 0;
  unit.temp_shield = Math.max(0, intVal(unit.temp_shield, 0)) + addShield;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: unit.tag || 'player',
      action: 'gain_temp_shield',
      shield: addShield,
      text: `${unit.name} 的护体神光凝成${addShield}点临时护盾`
    });
  }
  return addShield;
}

function _applyBattleStartMoshenJue(unit, events) {
  if (!unit || typeof unit !== 'object') return 0;
  const rounds = Math.max(0, intVal(unit.moshen_jue_rounds, 0));
  if (rounds <= 0 || unit.moshen_jue_applied) return 0;

  const attackBonusPct = clamp(numVal(unit.moshen_jue_attack_bonus_pct, 0), 0, 10);
  const lifestealBonus = clamp(numVal(unit.moshen_jue_phys_lifesteal_bonus, 0), 0, 0.8);

  unit.moshen_jue_defense_backup = intVal(unit.defense, 0);
  unit.moshen_jue_spell_defense_backup = intVal(unit.spell_defense, 0);
  unit.moshen_jue_min_attack_backup = intVal(unit.min_attack, 1);
  unit.moshen_jue_max_attack_backup = intVal(unit.max_attack, 1);
  unit.moshen_jue_spell_attack_backup = intVal(unit.spell_attack, 0);
  unit.moshen_jue_lifesteal_backup = numVal(unit.lifesteal, 0);

  unit.defense = 0;
  unit.spell_defense = 0;
  if (attackBonusPct > 0) {
    unit.min_attack = Math.max(1, Math.floor(Math.max(1, intVal(unit.min_attack, 1)) * (1 + attackBonusPct)));
    unit.max_attack = Math.max(unit.min_attack, Math.floor(Math.max(unit.min_attack, intVal(unit.max_attack, unit.min_attack)) * (1 + attackBonusPct)));
    unit.spell_attack = Math.max(0, Math.floor(Math.max(0, intVal(unit.spell_attack, 0)) * (1 + attackBonusPct)));
  }
  if (lifestealBonus > 0) {
    unit.lifesteal = clamp(numVal(unit.lifesteal, 0) + lifestealBonus, 0, 0.8);
  }

  unit.moshen_jue_applied = true;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: unit.tag || 'player',
      target: unit.tag || 'player',
      action: 'moshen_jue',
      text: `${unit.name} 的魔神诀生效：${rounds}回合内防御与法防归零，攻击力提高${Math.round(attackBonusPct * 100)}%，物理吸血提高${Math.round(lifestealBonus * 100)}%`
    });
  }
  return rounds;
}

function initTechniqueBattleStartEffects(state) {
  const events = [];
  const units = _collectBattleStartUnits(state);
  for (const unit of units) {
    _applyBattleStartTempShieldByTechnique(unit, events);
    _applyBattleStartMoshenJue(unit, events);
  }
  return events;
}

function applyShieldedDamageReflect(state, attacker, defender, events, opts = {}) {
  if (!attacker || !defender) return 0;
  if (attacker.alive === false || intVal(attacker.hp, 0) <= 0) return 0;
  const reflectCfg = defender?.on_shielded_damaged_reflect;
  if (!reflectCfg || typeof reflectCfg !== 'object') return 0;
  const hadShieldBeforeDamage = opts.hadTempShieldBeforeDamage === true;
  if (!hadShieldBeforeDamage && intVal(defender.temp_shield, 0) <= 0) return 0;

  const isPvp = isPvpBattleMode(state?.battle_mode);
  const reflectPct = clamp(numVal(isPvp ? reflectCfg.pvpSpellAttackPct : reflectCfg.spellAttackPct, 0), 0, 10);
  if (reflectPct <= 0) return 0;

  const spellAttack = Math.max(1, intVal(defender.spell_attack, defender.max_attack || 1));
  let reflectDamage = Math.max(1, Math.floor(spellAttack * reflectPct));
  if (isKurongShentuActive(defender)) reflectDamage = 0;
  if (attacker.hunchong_stacks > 0) {
    attacker.hunchong_stacks -= 1;
    reflectDamage = 0;
    if (Array.isArray(events)) {
      events.push({ t: 'combat_log', actor: attacker.tag || 'enemy', target: attacker.tag || 'enemy', action: 'hunchong_absorb',
        text: `${attacker.name} 的缓冲抵消了护体神光反弹！` });
    }
  } else if (attacker.direct_damage_ignore_chance > 0 && nextRand01(state) < attacker.direct_damage_ignore_chance) {
    reflectDamage = 0;
    if (Array.isArray(events)) {
      events.push({ t: 'combat_log', actor: attacker.tag || 'enemy', target: attacker.tag || 'enemy', action: 'ignore',
        text: `${attacker.name} 无视了护体神光反弹！` });
    }
  }
  if (reflectDamage > 0) {
    reflectDamage = capIncomingDamageByTaixu(attacker, reflectDamage, events, { state }).damage;
  }
  if (reflectDamage <= 0) return 0;

  attacker.hp = Math.max(0, intVal(attacker.hp, 0) - reflectDamage);
  if (attacker.hp <= 0 && attacker.alive !== undefined) attacker.alive = false;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: defender.tag || 'player',
      target: attacker.tag || 'enemy',
      action: 'huti_shenguang_reflect',
      damage: reflectDamage,
      text: `${defender.name} 的护体神光反弹${reflectDamage}点无属性伤害`
    });
  }
  return reflectDamage;
}

function applySkillDamageShieldGain(state, attacker, skill, skillLevel, damage, events) {
  if (!attacker || typeof attacker !== 'object') return 0;
  if (!skill || !Array.isArray(skill.effects)) return 0;
  const dealtDamage = Math.max(0, intVal(damage, 0));
  if (dealtDamage <= 0) return 0;

  const isPvp = isPvpBattleMode(state?.battle_mode);
  let totalShield = 0;
  for (const eff of skill.effects) {
    if (String(eff?.type || '') !== 'gain_temp_shield_from_skill_damage_percent') continue;
    const basePct = numVal(eff?.value, 0);
    const pvpBasePct = eff?.pvpValue != null ? numVal(eff?.pvpValue, basePct) : basePct;
    const baseLvBonus = numVal(eff?.coefficientBonus, 0);
    const pvpLvBonus = numVal(eff?.pvpCoefficientBonus, baseLvBonus);
    let shieldPct = isPvp ? pvpBasePct : basePct;
    if (skillLevel > 1) {
      shieldPct += (skillLevel - 1) * (isPvp ? pvpLvBonus : baseLvBonus);
    }
    shieldPct = clamp(shieldPct, 0, 10);
    if (shieldPct <= 0) continue;
    const addShield = Math.max(0, Math.floor(dealtDamage * shieldPct));
    if (addShield <= 0) continue;
    totalShield += addShield;
  }

  if (totalShield <= 0) return 0;
  attacker.temp_shield = Math.max(0, intVal(attacker.temp_shield, 0)) + totalShield;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: attacker.tag || 'player',
      target: attacker.tag || 'player',
      action: 'gain_temp_shield',
      shield: totalShield,
      text: `${attacker.name} 以${String(skill?.name || '技能')}凝成${totalShield}点临时护盾`
    });
  }
  return totalShield;
}

function tryZhanmoShentuExecute(state, attacker, defender, events, opts = {}) {
  const requireDamage = opts.requireDamage !== false;
  const dealtDamage = Math.max(0, intVal(opts.damage, 0));
  if (requireDamage && dealtDamage <= 0) return { executed: false, heal: 0, executeRatio: 0 };
  if (!attacker || !defender) return { executed: false, heal: 0, executeRatio: 0 };
  if (!(numVal(attacker.zhanmo_shentu_active, 0) > 0)) return { executed: false, heal: 0, executeRatio: 0 };

  let executeRatio = clamp(numVal(attacker.zhanmo_execute_ratio, 0), 0, 0.5);
  if (executeRatio <= 0) {
    executeRatio = clamp(Math.max(0, numVal(attacker.armor_pen, 0)), 0, 0.9) / 4;
  }
  if (executeRatio <= 0) return { executed: false, heal: 0, executeRatio: 0 };

  const tryHeal = () => {
    const healPct = state && Object.prototype.hasOwnProperty.call(state, 'turn_mode') ? 0.2 : 0.5;
    const healBase = Math.max(1, Math.floor(Math.max(1, numVal(attacker.max_hp, 1)) * healPct));
    let actualHeal = 0;
    if (healBase > 0) {
      if (isHealForbidden(attacker)) {
        pushHealForbiddenEvent(attacker, events, '斩魔神途');
      } else {
        const healed = applyHealWithOverflowShield(attacker, healBase, events);
        actualHeal = Math.max(0, intVal(healed?.actualHeal, 0));
        if (actualHeal > 0 && Array.isArray(events)) {
          events.push({
            t: 'combat_log',
            actor: attacker.tag || 'player',
            target: attacker.tag || 'player',
            action: 'zhanmo_execute_heal',
            heal: actualHeal,
            text: `${attacker.name} 因斩魔神途回复了${actualHeal}生命`
          });
        }
      }
    }
    return actualHeal;
  };

  // 只要存在斩杀线，且本次击杀成立（不论是否由斩魔处决），都能回血一次。
  if (intVal(defender.hp, 0) <= 0) {
    if (defender._zhanmo_heal_granted) return { executed: false, heal: 0, executeRatio };
    defender._zhanmo_heal_granted = true;
    return { executed: false, heal: tryHeal(), executeRatio };
  }

  const hpRatio = numVal(defender.hp, 0) / Math.max(1, numVal(defender.max_hp, 1));
  if (hpRatio > executeRatio) return { executed: false, heal: 0, executeRatio };

  defender.hp = 0;
  if (defender.alive !== undefined) defender.alive = false;
  defender._zhanmo_heal_granted = true;
  if (Array.isArray(events)) {
    events.push({
      t: 'combat_log',
      actor: attacker.tag || 'player',
      target: defender.tag || 'enemy',
      action: 'zhanmo_execute',
      text: `${attacker.name} 的斩魔神途触发，直接斩杀了${defender.name}`
    });
  }

  return { executed: true, heal: tryHeal(), executeRatio };
}

// ─── 玩家受到直接伤害时：土盾、浩渺免疫、玄黄3/5件、太初8件 ───
// 支持 dungeon：传入 overrides 时用 { player, enemy } 替代 state.player/state.enemy
function applySetEffectsOnPlayerDamaged(state, rawDamage, result, overrides) {
  const p = overrides?.player ?? state?.player;
  const e = overrides?.enemy ?? state?.enemy;
  if (!p || rawDamage <= 0) return;
  let damage = rawDamage;
  damage = capIncomingDamageByTaixu(p, damage, result.events, { state }).damage;
  const KURONG_TRIGGER_COST = 200;

  const isWildBattle = String(state?.enemy_source || '') === 'wild';
  const canAbaddonRebirth = !!p.abaddon_rebirth_once && isWildBattle && !state?._abaddon_rebirth_used;
  if (canAbaddonRebirth && p.hp - damage <= 0) {
    const currentStones = Math.max(0, intVal(p.spirit_stones, 0));
    if (currentStones < KURONG_TRIGGER_COST) {
      result.events.push({
        t: 'combat_log', actor: p.tag || 'player', target: p.tag || 'player', action: 'kurong_not_enough_stones',
        text: `阵形·枯荣触发失败：灵石不足（需要${KURONG_TRIGGER_COST}，当前${currentStones}）`
      });
    } else {
      p.spirit_stones = currentStones - KURONG_TRIGGER_COST;
      state._abaddon_rebirth_spent = Math.max(0, intVal(state?._abaddon_rebirth_spent, 0)) + KURONG_TRIGGER_COST;
      const preMitigationDamage = Math.max(1, intVal(overrides?.preMitigationDamage, rawDamage));
      state._abaddon_rebirth_used = true;
      damage = 0;
      p.hp = Math.min(p.max_hp, p.hp + preMitigationDamage);
      result.damage = 0;
      result.events.push({
        t: 'combat_log', actor: p.tag || 'player', target: p.tag || 'player', action: 'kurong_rebirth',
        heal: preMitigationDamage,
        cost: KURONG_TRIGGER_COST,
        text: `阵形·枯荣：消耗${KURONG_TRIGGER_COST}灵石，免疫本次致命伤害，并恢复等于折前伤害的生命`
      });
      return;
    }
  }

  const hadTudun = hasTudun(p);
  if (hadTudun) damage = Math.max(0, Math.floor(damage * (1 - 0.22)));
  const haomiao3 = countSetPieces(p, '浩渺-云上青鸾') >= 3;
  let lethalSaved = false;
  if (haomiao3 && !state._haomiao_lethal_saved && p.hp - damage <= 0) {
    damage = p.hp - 1;
    lethalSaved = true;
    state._haomiao_lethal_saved = true;
    result.events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'haomiao3',
      text: '浩渺-云上青鸾：免疫致命伤害，生命保留1点' });
  }

  const taichu8 = countSetPieces(p, '太初-浑天无极') >= 8;
  if (taichu8 && damage > 0) {
    const karmaGain = Math.floor(damage * 0.2);
    if (karmaGain > 0) {
      damage = Math.max(0, damage - karmaGain);
      p.taichu_karma = Math.max(0, intVal(p.taichu_karma, 0)) + karmaGain;
      result.events.push({ t: 'combat_log', actor: p.tag || 'player', target: p.tag || 'player', action: 'taichu8_karma',
        text: `太初-浑天无极：${karmaGain}点伤害转化为业力（当前业力${p.taichu_karma}）` });
    }
  }

  damage = absorbDamageByTempShield(p, damage, result.events);
  const hpAfterDamage = p.hp - damage;
  if (!lethalSaved) p.hp = Math.max(0, hpAfterDamage);
  else p.hp = 1;
  result.damage = damage;

  if (taichu8 && p.hp > 0 && intVal(p.taichu_karma, 0) > p.hp) {
    p.hp = 0;
    result.events.push({ t: 'combat_log', actor: p.tag || 'player', target: p.tag || 'player', action: 'taichu8_burst',
      text: '太初-浑天无极：业力超过剩余生命，立即身死' });
    return;
  }

  // 受伤转治疗：仅当本次伤害未致死时生效，致死伤害不应通过转化复活
  const damageHealPct = numVal(p.damage_heal_pct, 0);
  if (damageHealPct > 0 && damage > 0 && (hpAfterDamage > 0 || lethalSaved)) {
    let bonus = Math.floor(damage * damageHealPct);
    bonus = Math.floor(bonus * (1.0 + numVal(p.heal_bonus, 0)));
    if (bonus > 0) {
      if (isHealForbidden(p)) {
        pushHealForbiddenEvent(p, result.events, '受伤转化');
      } else if (tryJiemieHealToXurui(p, bonus, result.events, { text: `劫灭-斗战乾坤：受伤转化回复无效，获得2轮蓄锐` })) {
        // 已转为蓄锐，不加血
      } else {
        const healed = applyHealWithOverflowShield(p, bonus, result.events);
        const actual = healed.actualHeal;
        if (actual > 0) result.events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'damage_heal',
          heal: actual, text: `万象森罗生灭法：受伤转化回复${actual}生命` });
      }
    }
  }
  const xc = countSetPieces(p, '玄黄-永生不灭');
  if (xc >= 3 && nextRand01(state) < 0.5) {
    p.tudun_rounds = (p.tudun_rounds || 0) + 3;
    result.events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'xuanhuang3',
      text: '玄黄-永生不灭：获得3轮土盾' });
  }
  if (xc >= 5 && e && damage > 0) {
    const reflectPct = hadTudun ? 0.30 : 0.10;
    let reflectDmg = Math.max(1, Math.floor(damage * reflectPct));
    reflectDmg = capIncomingDamageByTaixu(e, reflectDmg, result.events, { state }).damage;
    if (isKurongShentuActive(p) && reflectDmg > 0) reflectDmg = 0;
    e.hp = Math.max(0, e.hp - reflectDmg);
    result.events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'xuanhuang5',
      damage: reflectDmg, text: `玄黄-永生不灭：反弹${reflectDmg}点绝对伤害` });
  }

  const sj5 = countSetPieces(p, '异界-数据入侵') >= 5;
  if (sj5 && e && damage > 0) {
    const inPvp = isPvpBattleMode(state?.battle_mode);
    if (inPvp) {
      if (intVal(e.data_invasion_pvp_weaken_rounds, 0) <= 0) {
        const minAtkNow = Math.max(1, intVal(e.min_attack, 1));
        const maxAtkNow = Math.max(minAtkNow, intVal(e.max_attack, minAtkNow));
        const spellAtkNow = Math.max(0, intVal(e.spell_attack, 0));
        const reduceMin = Math.max(0, Math.floor(minAtkNow * 0.10));
        const reduceMax = Math.max(0, Math.floor(maxAtkNow * 0.10));
        const reduceSpell = Math.max(0, Math.floor(spellAtkNow * 0.10));
        e.min_attack = Math.max(1, minAtkNow - reduceMin);
        e.max_attack = Math.max(e.min_attack, maxAtkNow - reduceMax);
        e.spell_attack = Math.max(0, spellAtkNow - reduceSpell);
        e.data_invasion_pvp_weaken_rounds = 1;
        e.data_invasion_pvp_weaken_min_attack_stored = reduceMin;
        e.data_invasion_pvp_weaken_max_attack_stored = reduceMax;
        e.data_invasion_pvp_weaken_spell_attack_stored = reduceSpell;
        result.events.push({ t: 'combat_log', actor: p.tag || 'player', target: e.tag || 'enemy', action: 'shuju5_pvp',
          text: `异界-数据入侵：抑制${e.name}（攻击-${reduceMax}，法攻-${reduceSpell}），持续1回合` });
      } else {
        e.data_invasion_pvp_weaken_rounds = 1;
        result.events.push({ t: 'combat_log', actor: p.tag || 'player', target: e.tag || 'enemy', action: 'shuju5_pvp_refresh',
          text: `异界-数据入侵：抑制效果刷新（持续1回合）` });
      }
    } else {
      const minAtkNow = Math.max(1, intVal(e.min_attack, 1));
      const maxAtkNow = Math.max(minAtkNow, intVal(e.max_attack, minAtkNow));
      const spellAtkNow = Math.max(0, intVal(e.spell_attack, 0));
      const reduceMin = Math.max(0, Math.floor(minAtkNow * 0.10));
      const reduceMax = Math.max(0, Math.floor(maxAtkNow * 0.10));
      const reduceSpell = Math.max(0, Math.floor(spellAtkNow * 0.10));
      e.min_attack = Math.max(1, minAtkNow - reduceMin);
      e.max_attack = Math.max(e.min_attack, maxAtkNow - reduceMax);
      e.spell_attack = Math.max(0, spellAtkNow - reduceSpell);
      result.events.push({ t: 'combat_log', actor: p.tag || 'player', target: e.tag || 'enemy', action: 'shuju5',
        text: `异界-数据入侵：削弱${e.name}（攻击-${reduceMax}，法攻-${reduceSpell}，持续至战斗结束，可叠加）` });
    }
  }
}

// ─── 玩家回合开始：浩渺3件5%回血、厉火8件焚烬 ───
// 支持 dungeon：传入 overrides 时用 { player, enemy } 替代 state.player/state.enemy
function applySetEffectsOnPlayerTurnStart(state, events, overrides) {
  const p = overrides?.player ?? state?.player;
  const e = overrides?.enemy ?? state?.enemy;
  if (!p) return;
  const hm3 = countSetPieces(p, '浩渺-云上青鸾') >= 3;
  if (hm3) {
    let regen = Math.floor(p.max_hp * 0.05);
    regen = Math.floor(regen * (1.0 + numVal(p.heal_bonus, 0)));
    if (regen > 0) {
      if (isHealForbidden(p)) {
        pushHealForbiddenEvent(p, events, '浩渺-云上青鸾');
      } else {
        const healed = applyHealWithOverflowShield(p, regen, events);
        const actual = healed.actualHeal;
        events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'haomiao3_regen',
          heal: actual, text: `浩渺-云上青鸾：每轮回复${actual}点生命` });
        if (countSetPieces(p, '浩渺-云上青鸾') >= 5 && e && actual > 0) {
          let dealt = capIncomingDamageByTaixu(e, actual, events, { state }).damage;
          if (isKurongShentuActive(p) && dealt > 0) dealt = 0;
          e.hp = Math.max(0, e.hp - dealt);
          events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'haomiao5',
            damage: dealt, text: `浩渺-云上青鸾：回复转化为对敌人${dealt}点绝对伤害` });
        }
      }
    }
  }
  const lh8 = countSetPieces(p, '厉火-焚天炽地') >= 8;
  if (lh8 && p.hp < p.max_hp * 0.5 && !p.fenjin_active) {
    p.fenjin_active = true;
    events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'fenjin',
      text: '厉火-焚天炽地：生命低于50%，获得焚烬（视为乘风、养精、蓄锐）' });
  }
}

// ─── 玩家造成伤害后：道妙气象、太初5件提示、厉火3/5件、异界5件 ───
// hitCount: 本次行动造成的伤害次数（多击技能传多击次数）
const DAOMIAO_ACTIVATE_STACKS = 5;
function applySetEffectsOnDealDamage(state, attacker, defender, damage, isSpell, hitCount, opts = {}) {
  const events = [];
  if (!attacker || !defender || damage <= 0) return events;
  tryGrantQishaShentuXurui(attacker, isSpell, events);
  const kurongNoDirect = isKurongShentuActive(attacker);
  const hc = Math.max(1, intVal(hitCount, 1));

  const manaBurn = attacker.on_deal_damage_mana_burn;
  if (manaBurn && defender.hp > 0) {
    const isPvp = isPvpBattleMode(state?.battle_mode);
    const burnPct = clamp(numVal(isPvp ? manaBurn.pvpMpBurnPct : manaBurn.mpBurnPct, 0), 0, 1);
    if (burnPct > 0 && intVal(defender.mp, 0) > 0) {
      for (let hi = 0; hi < hc; hi++) {
        if (defender.hp <= 0) break;
        const beforeMp = Math.max(0, intVal(defender.mp, 0));
        if (beforeMp <= 0) break;
        const baseMaxMp = Math.max(0, intVal(defender.max_mp, beforeMp));
        const plannedBurn = Math.max(0, Math.floor(baseMaxMp * burnPct));
        const burnedMp = Math.min(beforeMp, plannedBurn);
        if (burnedMp <= 0) continue;

        defender.mp = Math.max(0, beforeMp - burnedMp);
        let extraDamage = burnedMp;
        if (kurongNoDirect && extraDamage > 0) extraDamage = 0;
        let damageTypeLabel = '绝对伤害';
        if (isPvp && manaBurn.pvpAsSpell !== false) {
          damageTypeLabel = '法术伤害';
          let effDef = Math.max(0, intVal(defender.spell_defense, 0));
          const pen = clamp(numVal(attacker.spell_armor_pen, 0), 0, 0.9);
          if (pen > 0) effDef = Math.floor(effDef * (1.0 - pen));
          if (attacker.beishui_rounds > 0 || defender.beishui_rounds > 0) effDef = 0;
          const divisor = defender.is_ally ? numVal(defender.defense_divisor, 8000) : 11000;
          extraDamage = calcReducedDamage(extraDamage, effDef, divisor);
          if (defender.damage_reduction > 0) {
            extraDamage = Math.floor(extraDamage * (1.0 - clamp(defender.damage_reduction, 0, 0.85)));
          }
        }
        if (extraDamage > 0) {
          if (defender.hunchong_stacks > 0) {
            defender.hunchong_stacks -= 1;
            extraDamage = 0;
            events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'hunchong_absorb',
              text: `${defender.name} 的缓冲抵消了夺灵追击！` });
          } else if (defender.direct_damage_ignore_chance > 0 && nextRand01(state) < defender.direct_damage_ignore_chance) {
            extraDamage = 0;
            events.push({ t: 'combat_log', actor: defender.tag || 'enemy', target: defender.tag || 'enemy', action: 'ignore',
              text: `${defender.name} 无视了夺灵追击！` });
          }
        }
        if (extraDamage > 0) {
          extraDamage = capIncomingDamageByTaixu(defender, extraDamage, events, { state }).damage;
          defender.hp = Math.max(0, intVal(defender.hp, 0) - extraDamage);
          if (defender.hp <= 0) defender.alive = false;
        }
        events.push({
          t: 'combat_log',
          actor: attacker.tag || 'player',
          target: defender.tag || 'enemy',
          action: 'duolingfa_mana_burn',
          damage: extraDamage,
          mana_burn: burnedMp,
          text: `${attacker.name} 夺取${defender.name}${burnedMp}法力，并造成${extraDamage}${damageTypeLabel}`
        });
      }
    }
  }

  const dm3 = countSetPieces(attacker, '道妙-气象万千') >= 3;
  const dm8 = countSetPieces(attacker, '道妙-气象万千') >= 8;
  if (dm3 && attacker.is_ally && !attacker.daomiao_no_more_qixiang) {
    for (let hi = 0; hi < hc; hi++) {
      if (attacker.daomiao_no_more_qixiang) break;
      let ql = attacker.qixiang_list || [];
      if (ql.length >= DAOMIAO_ACTIVATE_STACKS && dm8) {
        attacker.qixiang_list = [];
        attacker.daomiao_active = true;
        attacker.daomiao_no_more_qixiang = true;
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
          action: 'daomiao8', text: `道妙-气象万千：气象达${DAOMIAO_ACTIVATE_STACKS}层，获得道妙` });
        break;
      }
      if (ql.length < 7) {
        const avail = QIXIANG_TYPES.filter(q => !ql.includes(q));
        if (avail.length > 0) {
          const add = avail[Math.floor(nextRand01(state) * avail.length)];
          attacker.qixiang_list = [...ql, add];
          events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
            action: 'daomiao3', text: `道妙-气象万千：获得气象「${add}」(${attacker.qixiang_list.length}/${DAOMIAO_ACTIVATE_STACKS})` });
          if (attacker.qixiang_list.length >= DAOMIAO_ACTIVATE_STACKS && dm8) {
            attacker.qixiang_list = [];
            attacker.daomiao_active = true;
            attacker.daomiao_no_more_qixiang = true;
            events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
              action: 'daomiao8', text: `道妙-气象万千：气象达${DAOMIAO_ACTIVATE_STACKS}层，获得道妙` });
            break;
          }
        }
      }
    }
  }

  const tc5 = countSetPieces(attacker, '太初-浑天无极') >= 5;
  if (tc5) {
    const snapNegCount = opts && opts.taichuNegCountSnapshot != null
      ? Math.max(0, intVal(opts.taichuNegCountSnapshot, 0))
      : -1;
    const negCount = snapNegCount >= 0 ? snapNegCount : getNegativeStatusCount(defender);
    if (negCount > 0) {
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'taichu5',
        text: `太初-浑天无极：目标负面${negCount}种，本次伤害提升${negCount * 6}%` });
    }
  }

  const lh3 = countSetPieces(attacker, '厉火-焚天炽地') >= 3;
  const lh5 = countSetPieces(attacker, '厉火-焚天炽地') >= 5;
  if (lh3 && attacker.is_ally && !state._lihuo_zhuoshao_this_action) {
    attacker.zhuoshao_rounds = (attacker.zhuoshao_rounds || 0) + 1;
    state._lihuo_zhuoshao_this_action = true;
  }
  if (lh5 && attacker.zhuoshao_rounds > 0 && attacker.is_ally) {
    const lh5HealPct = isPvpBattleMode(state?.battle_mode) ? 0.13 : 0.15;
    let heal = Math.floor(damage * lh5HealPct);
    heal = Math.floor(heal * (1.0 + numVal(attacker.heal_bonus, 0)));
    if (heal > 0) {
      if (isHealForbidden(attacker)) {
        pushHealForbiddenEvent(attacker, events, '厉火-焚天炽地');
      } else {
        const healed = applyHealWithOverflowShield(attacker, heal, events);
        if (healed.actualHeal > 0) {
          events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: attacker.tag || 'player',
            action: 'lihuo5', heal: healed.actualHeal, text: `厉火-焚天炽地：灼烧下造成伤害，恢复${healed.actualHeal}生命` });
        }
      }
    }
  }

  const yj5 = countSetPieces(attacker, '异界-终结热寂') >= 5;
  const yj8 = countSetPieces(attacker, '异界-终结热寂') >= 8;
  if (yj5 && attacker.is_ally && defender && !defender.is_ally) {
    for (let hi = 0; hi < hc; hi++) {
      defender.jiangwen_stacks = (defender.jiangwen_stacks || 0) + 1;
      if (defender.jiangwen_stacks >= 5) {
        if (!yj8) {
          // 仅8件可将降温转为凝滞；3/5件只叠降温。
          defender.jiangwen_stacks = 5;
          continue;
        }
        defender.jiangwen_stacks = 0;
        if (isDebuffImmune(defender)) {
          pushStasisGuardEvent(defender, events, '异界-终结热寂', 'debuff');
          continue;
        }
        defender.stasis_rounds = Math.max(defender.stasis_rounds || 0, 1);
        defender.stasis_guard_active = false;
        defender.dongshang_stacks = (defender.dongshang_stacks || 0) + 1;
        const boss = defender.type === 'boss' || defender.is_boss;
        const inDungeon = intVal(state?.dungeon_id, 0) > 0;
        const inPvpBattle = isPvpBattleMode(state?.battle_mode);
        if (defender.dongshang_stacks >= 4 && !boss && !inDungeon && !inPvpBattle) {
          defender.dongshang_stacks = 0;
          defender.hp = 0;
          defender.alive = false;
          events.push({ t: 'combat_log', actor: 'system', target: defender.tag || 'enemy',
            action: 'yijie8', text: `异界-终结热寂：${defender.name}冻伤叠满4层，立即终结` });
        }
        events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy',
          action: 'yijie_stasis', text: `异界-终结热寂：降温叠满5层，${defender.name}获得1层凝滞` });
      }
    }
  }

  const sj3 = countSetPieces(attacker, '异界-数据入侵') >= 3;
  const sj8 = countSetPieces(attacker, '异界-数据入侵') >= 8;
  if (sj3 && defender && defender.hp > 0) {
    const inPvp = isPvpBattleMode(state?.battle_mode);
    const triggerEvery = inPvp ? 6 : 3;
    let counter = Math.max(0, intVal(attacker.data_invasion_hit_counter, 0));
    for (let hi = 0; hi < hc; hi++) {
      counter += 1;
      if (counter < triggerEvery) continue;
      counter = 0;
      if (isDebuffImmune(defender)) {
        pushStasisGuardEvent(defender, events, '异界-数据入侵', 'debuff');
        continue;
      }
      let fearDur = consumeJueyiForControl(defender, 1);
      if (fearDur <= 0) continue;
      defender.fear_rounds = Math.max(defender.fear_rounds || 0, fearDur);
      if (defender.xurui && defender.xurui.active) {
        const cancel = Math.min(fearDur, defender.xurui.duration);
        defender.xurui.duration -= cancel;
        if (defender.xurui.duration <= 0) defender.xurui = { active: false, duration: 0 };
      }
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'shuju3_fear',
        text: `异界-数据入侵：第${triggerEvery}次伤害触发，${defender.name}陷入恐惧1回合` });
    }
    attacker.data_invasion_hit_counter = counter;
  }

  const damageCategory = String(opts?.damageCategory || 'direct');
  if (sj8 && damageCategory === 'direct' && defender && defender.hp > 0) {
    const inPvp = isPvpBattleMode(state?.battle_mode);
    const atkDef = Math.max(0, intVal(attacker.defense, 0));
    const defDef = Math.max(0, intVal(defender.defense, 0));
    if (atkDef > defDef) {
      const ratio = inPvp ? 0.40 : 0.25;
      const oneHitKarma = Math.max(1, Math.floor((atkDef - defDef) * ratio));
      const totalKarma = oneHitKarma * hc;
      defender.taichu_karma = Math.max(0, intVal(defender.taichu_karma, 0)) + totalKarma;
      events.push({ t: 'combat_log', actor: attacker.tag || 'player', target: defender.tag || 'enemy', action: 'shuju8_karma',
        text: `异界-数据入侵：物防压制生效，附加${totalKarma}点业力（当前业力${defender.taichu_karma}）` });
    }
  }
  return events;
}

// ─── 玩家治疗时：万象森罗生灭法 heal_damage（浩渺5仅转化浩渺3回血，在 applySetEffectsOnPlayerTurnStart 中处理）───
function applySetEffectsOnHeal(state, healAmount, events, overrides) {
  const p = overrides?.player ?? state?.player;
  const e = overrides?.enemy ?? state?.enemy;
  if (!p || !e || healAmount <= 0) return;
  const healDmgPct = numVal(p.heal_damage_pct, 0);
  if (healDmgPct > 0) {
    let dmg = Math.floor(healAmount * healDmgPct);
    if (dmg > 0) {
      dmg = capIncomingDamageByTaixu(e, dmg, events, { state }).damage;
      if (isKurongShentuActive(p) && dmg > 0) dmg = 0;
      e.hp = Math.max(0, e.hp - dmg);
      events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'heal_damage',
        damage: dmg, text: `万象森罗生灭法：回复转化为对敌人${dmg}点绝对伤害` });
    }
  }
}

// ─── 玩家回合结束：厉火灼烧、异界3件降温、太初3件净化 ───
function applySetEffectsOnPlayerTurnEnd(state, events, overrides) {
  const p = overrides?.player ?? state?.player;
  const e = overrides?.enemy ?? state?.enemy;
  if (!p) return;
  if (p.zhuoshao_rounds > 0) {
    const attrs = ['strength', 'constitution', 'bone', 'agility', 'zhenyuan', 'lingli'];
    const attrName = attrs[Math.floor(nextRand01(state) * attrs.length)];
    const attrVal = intVal(p[attrName], 10);
    const burnMul = isPvpBattleMode(state?.battle_mode) ? 1.2 : 1;
    const pct = (0.25 + nextRand01(state) * 0.30) * burnMul;
    const zdmg = Math.max(1, Math.floor(attrVal * pct));
    const hadTudun = hasTudun(p);
    let dmg = hadTudun ? Math.floor(zdmg * 0.78) : zdmg;
    dmg = Math.max(0, dmg);
    dmg = absorbDamageByTempShield(p, dmg, events);
    dmg = capIncomingDamageByTaixu(p, dmg, events, { state }).damage;
    if (countSetPieces(p, '浩渺-云上青鸾') >= 3 && !state._haomiao_lethal_saved && p.hp - dmg <= 0) {
      p.hp = 1;
      state._haomiao_lethal_saved = true;
    } else {
      p.hp = Math.max(0, p.hp - dmg);
    }
    p.zhuoshao_rounds -= 1;
    events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'zhuoshao',
      damage: dmg, text: `灼烧：受到${dmg}点绝对伤害` });
  }
  const yj3 = countSetPieces(p, '异界-终结热寂') >= 3;
  const yj5 = countSetPieces(p, '异界-终结热寂') >= 5;
  if (yj3 && e && !yj5) {  // 5件起改为伤害后叠，不在行动后叠
    e.jiangwen_stacks = Math.min(5, (e.jiangwen_stacks || 0) + 1);
  }

  const tc3 = countSetPieces(p, '太初-浑天无极') >= 3;
  if (tc3) {
    const removed = _removeOneNegativeStatus(p, state);
    if (removed) {
      events.push({ t: 'combat_log', actor: p.tag || 'player', target: p.tag || 'player', action: 'taichu3',
        text: `太初-浑天无极：行动后净化了「${removed}」` });
    }
  }
}

Object.assign(module.exports, {
  intVal, numVal, clamp, deepClone, getRealmQualityFromLevel,
  annotateEquipmentPower, isEquipmentItem, scoreEquipmentCollection,
  isPvpBattleMode,
  nextRand01, rollInt, calcReducedDamage,
  readTimedBuffValue, calcActionSpeed,
  calcAllPassiveEffects, calcEquippedTechEffects, getBattleVictoryHealPercent,
  calcSpiritRootBonuses, calcSetBonuses, getExWeaponEffect,
  recalcAndAssignCombatStats,
  buildPlayerSnapshot, buildEnemySnapshot,
  applyDebuff, triggerDebuffs, decrementStates,
  applyTurnEndRecovery, applySkillSpecialEffects, applyWanguchouOnMusicHit,
  applyPostDamageExEffects,
  tickJueyi, consumeJueyiForControl,
  countSetPieces, hasTudun, getNegativeStatusCount, isHealForbidden, pushHealForbiddenEvent, consumeNextActionHeal,
  isKurongShentuActive,
  getTaixuanShentuSkillDamageMul,
  applyTaixuanShentuSkillDamage,
  isStasisGuardActive, isDebuffImmune, pushStasisGuardEvent,
  getDaomiaoExtraAffinity, calcElementAffinity, getHaomiaoDotBonus,
  applyHealWithOverflowShield, absorbDamageByTempShield,
  capIncomingDamageByTaixu,
  applyFenjieShentuOnDamageSkill,
  tryJiemieHealToXurui,
  initXuanhuang8AtBattleStart,
  initTechniqueBattleStartEffects,
  applyShieldedDamageReflect,
  applySkillDamageShieldGain,
  tryZhanmoShentuExecute,
  tryGrantQishaShentuXurui,
  applySetEffectsOnPlayerDamaged,
  applySetEffectsOnPlayerTurnStart,
  applySetEffectsOnDealDamage,
  applySetEffectsOnHeal,
  applySetEffectsOnPlayerTurnEnd,
  getBlossomExplodeInfo, clearBlossomDebuffs
});
