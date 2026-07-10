/**
 * 创建新角色时的初始数据（与客户端 create_character 一致）
 * 战斗属性由 combatUtils.recalcAndAssignCombatStats 统一计算（装备+功法）
 */
const { getItems, getSkills, getTechniques } = require('./dataLoader');
const { recalcAndAssignCombatStats } = require('./combatUtils');

function applyCombatStatsFromBase(player) {
  const strength = Number(player.strength) || 10;
  const constitution = Number(player.constitution) || 10;
  const bone = Number(player.bone) || 10;
  const zhenyuan = Number(player.zhenyuan) || 10;
  const boneMult = 1.0 + (bone / 300.0) * 0.01;
  const maxHp = Math.max(1, Math.floor(constitution * 5 * boneMult));
  const maxMp = Math.max(1, Math.floor(zhenyuan * 3 * boneMult));
  player.max_hp = maxHp;
  player.max_mp = maxMp;
  if (Number(player.hp) <= 0) player.hp = maxHp;
  if (Number(player.mp) <= 0) player.mp = maxMp;
  const minAttack = Math.max(1, Math.floor(strength * 0.3 * boneMult));
  const maxAttack = Math.max(minAttack + 1, Math.floor(strength * 1.2 * boneMult));
  player.min_phys_damage = minAttack;
  player.max_phys_damage = maxAttack;
  player.phys_defense = Math.max(0, Math.floor(constitution * 0.25 * boneMult));
  const spellAttack = Math.max(0, Math.floor(zhenyuan * 0.8 * boneMult));
  player.min_spell_attack = spellAttack;
  player.max_spell_attack = spellAttack;
  player.spell_defense = Math.max(0, Math.floor(zhenyuan * 0.2 * boneMult));
}

function createInitialPlayer(spiritRoots, playerName) {
  const now = Math.floor(Date.now() / 1000);
  const player = {
    name: playerName || '修仙者',
    level: 1,
    exp: 0,
    strength: 10,
    constitution: 10,
    bone: 10,
    agility: 10,
    zhenyuan: 10,
    lingli: 10,
    spirit_stones: 0,
    trial_coins: 0,
    spirit_roots: spiritRoots || { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 },
    base_spirit_roots: { ...(spiritRoots || { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 }) },
    original_spirit_roots: { ...(spiritRoots || { metal: 20, wood: 20, water: 20, fire: 20, earth: 20 }) },
    original_base_attributes: { strength: 10, constitution: 10, bone: 10, agility: 10, zhenyuan: 10, lingli: 10 },
    hp: 0,
    mp: 0,
    equipment: {},
    inventory: [],
    current_inventory_page: 0,
    current_map_id: 1,
    equipped_skills: [],
    key_skill_id: 0,
    skill_presets: {
      grind:   { equipped_skills: [], key_skill_id: 0 },
      dungeon: { equipped_skills: [], key_skill_id: 0 },
      duel:    { equipped_skills: [], key_skill_id: 0 }
    },
    equipped_talisman_id: 0,
    skill_levels: {},
    skill_cooldowns: {},
    talents: {
      points_earned: 0,
      points_spent: 0,
      available_points: 0,
      unlocked_nodes: {}
    },
    techniques: { main: null, sub: null },
    technique_levels: {},
    alchemy: {},
    forging: {},
    baiyi: {},
    sect_id: 0,
    sect_contribution: 0,
    alliance_id: 0,
    alliance_contribution: 0,
    alliance_donate_date: '',
    alliance_donate_contrib_today: 0,
    spirit_pool_buff: null,
    spirit_pool_last_bathe_date: '',
    enlightenment_buff_expires_at: 0,
    enlightenment_last_date: '',
    lundaodian_sect_id: 0,
    rest_until: 0,
    auto_battle_enabled: false,
    auto_battle_map_id: 1,
    breakthrough_foundation_pills_stored: 0,
    breakthrough_yunling_stored: 0,
    breakthrough_nascent_kill_count: 0,
    breakthrough_spirit_dungeon_count: 0,
    breakthrough_heart_trial_passed: false,
    used_redemption_codes: [],
    battle_potion_enabled: false,
    battle_potion_hp_item_id: 0,
    battle_potion_mp_item_id: 0,
    battle_potion_hp_threshold: 50,
    battle_potion_mp_threshold: 50,
    timed_buffs: {},
    league_points: 0,
    league_rating: 1000,
    duel_rank_score: 1000,
    agreement_seen: false,
    time_state: {
      last_activity_at: now,
      last_tick_at: now,
      universal_time_seconds: 0,
      oct_seconds: 0,
      oct_paused: false
    }
  };

  // 初始铁剑 id=11、寒潭沙 id=27 x2，背包 10 页 × 20 格
  const itemsRaw = getItems();
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const ironSword = items.find(i => i && Number(i.id) === 11);
  const hanTanSha = items.find(i => i && Number(i.id) === 27);
  const emptyPage = () => Array(20).fill(null);
  player.inventory = Array(10).fill(null).map(emptyPage);
  if (ironSword && ironSword.id) {
    player.inventory[0][0] = { item: ironSword, count: 1 };
  }
  if (hanTanSha && hanTanSha.id) {
    player.inventory[0][1] = { item: hanTanSha, count: 2 };
  }

  // 学习 unlocked 技能和功法
  const skillsRaw = getSkills();
  const techniquesRaw = getTechniques();
  const skills = Array.isArray(skillsRaw) ? skillsRaw : [];
  const techniques = Array.isArray(techniquesRaw) ? techniquesRaw : [];
  for (const s of skills) {
    if (s && s.unlocked && Number(s.id) > 0) {
      player.skill_levels[String(s.id)] = { level: 1, exp: 0 };
    }
  }
  for (const t of techniques) {
    if (t && t.unlocked && Number(t.id) > 0) {
      player.technique_levels[String(t.id)] = { level: 1, exp: 0 };
    }
  }

  try {
    recalcAndAssignCombatStats(player);
  } catch (e) {
    console.error('[initialPlayer] recalcAndAssignCombatStats 异常:', e?.message, e?.stack);
    throw e;
  }
  return player;
}

module.exports = { createInitialPlayer, applyCombatStatsFromBase };
