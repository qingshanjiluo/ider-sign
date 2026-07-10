const { getItemById, getSkillById } = require('./dataLoader');
const ops = require('./playerOps');
const CD = require('./combatDamage');
const { applyDebuff } = require('./combatUtils');

function intVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; }
function numVal(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function countItemInInventoryById(inv, itemId) {
  const targetId = intVal(itemId, 0);
  if (targetId <= 0) return 0;
  let total = 0;
  for (const page of inv || []) {
    if (!Array.isArray(page)) continue;
    for (const slot of page) {
      if (!slot || !slot.item) continue;
      if (intVal(slot.item.id, 0) !== targetId) continue;
      total += Math.max(1, intVal(slot.count, 1));
    }
  }
  return total;
}

function consumeBattleStartTalisman(player) {
  const equippedId = intVal(player?.equipped_talisman_id, 0);
  if (equippedId <= 0) return { used: false };
  const item = getItemById(equippedId);
  if (!item || !item.id || String(item.type || '') !== 'talisman') {
    player.equipped_talisman_id = 0;
    return { used: false };
  }
  player.inventory = ops.ensureInventoryStructure(player.inventory || []);
  if (countItemInInventoryById(player.inventory, equippedId) <= 0) {
    return { used: false };
  }
  const consumed = ops.consumeItemFromInventory(player.inventory, equippedId, 1);
  if (!consumed) return { used: false };
  return {
    used: true,
    item_id: equippedId,
    item_name: String(item.name || '符箓'),
    item
  };
}

function _getSkillLevel(unit, skillId) {
  const d = unit?.skill_levels?.[String(skillId)];
  if (d && typeof d === 'object') return Math.max(1, intVal(d.level, 1));
  return Math.max(1, intVal(d, 1));
}

function _calcFireballDamage(state) {
  const skill = getSkillById(2);
  if (!skill || !skill.id) return { damage: 0, events: [] };
  const lv = _getSkillLevel(state?.player, 2);
  const hits = CD.collectSkillDamageHits(skill, lv, state);
  const fallbackHits = hits.length > 0 ? hits : [{ mul: 1.05 + Math.max(0, lv - 1) * 0.05, isSpell: true, opts: {} }];
  let total = 0;
  const events = [];
  for (const h of fallbackHits) {
    const res = CD.calcDamage(state, state.player, state.enemy, 'skill', h.mul, h.isSpell, skill, lv, h.opts || {});
    total += Math.max(0, intVal(res.damage, 0));
    events.push(...(res.events || []));
  }
  return { damage: total, events };
}

function applyBattleStartTalisman(state, talismanUse) {
  if (!talismanUse?.used || !state?.player || !state?.enemy) return [];
  const effects = Array.isArray(talismanUse.item?.effects) ? talismanUse.item.effects : [];
  const events = [];
  const itemName = String(talismanUse.item_name || '符箓');

  for (const eff of effects) {
    if (!eff || typeof eff !== 'object') continue;
    const type = String(eff.type || '');
    if (type === 'battle_start_apply_slow') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      const mult = numVal(eff.speedMultiplier, 0.7);
      state.enemy.slow_effect = { duration: dur, speedMultiplier: mult };
      events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'talisman',
        text: `符箓生效：消耗${itemName} x1，敌人迟缓${dur}回合` });
    } else if (type === 'battle_start_apply_xurui_allies') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      state.player.xurui = { active: true, duration: dur };
      events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'talisman',
        text: `符箓生效：消耗${itemName} x1，自身获得蓄锐${dur}回合` });
    } else if (type === 'battle_start_boost_hp_max_allies') {
      const pct = Math.max(0, numVal(eff.value, 0.05));
      const gain = Math.max(1, Math.floor(Math.max(1, numVal(state.player.max_hp, 1)) * pct));
      state.player.max_hp = Math.max(1, intVal(state.player.max_hp, 1) + gain);
      state.player.hp = Math.max(1, intVal(state.player.hp, 1) + gain);
      events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'talisman',
        text: `符箓生效：消耗${itemName} x1，自身生命上限与当前生命提升${Math.floor(pct * 100)}%（+${gain}）` });
    } else if (type === 'battle_start_apply_chanfu_enemies') {
      const dur = Math.max(1, intVal(eff.durationRounds, 1));
      const dmgPct = Math.max(0, numVal(eff.damagePercent, 0.16));
      events.push(...applyDebuff(state.enemy, { type: 'chanfu', stacks: dur, damagePercent: dmgPct, attribute: 'spell_attack' }, state, state.player));
      events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'talisman',
        text: `符箓生效：消耗${itemName} x1，敌人获得缠缚${dur}回合` });
    } else if (type === 'battle_start_cast_fireball') {
      const fire = _calcFireballDamage(state);
      events.push(...fire.events);
      const dmg = Math.max(0, intVal(fire.damage, 0));
      if (dmg > 0) {
        state.enemy.hp = Math.max(0, intVal(state.enemy.hp, 0) - dmg);
        if (state.enemy.hp <= 0) state.enemy.alive = false;
      }
      const lv = _getSkillLevel(state.player, 2);
      events.push({ t: 'combat_log', actor: 'player', target: 'enemy', action: 'talisman_fireball',
        damage: dmg, text: `符箓生效：视为施放Lv.${lv}火球术，造成${dmg}伤害` });
    }
  }
  if (events.length <= 0) {
    events.push({ t: 'combat_log', actor: 'player', target: 'player', action: 'talisman',
      text: `符箓生效：消耗${itemName} x1` });
  }
  return events;
}

module.exports = {
  consumeBattleStartTalisman,
  applyBattleStartTalisman
};
