/**
 * duel_actions.js - CultivationSimulator 动作实现（第一部分）
 * 
 * 包含：战斗、药水、地图、升级、突破、装备、邮件、同步、自动战斗、炼丹、锻造
 */

const { SKILLS_DATA, randomInt } = require('./duel_common.js');

/**
 * 将动作方法混入 CultivationSimulator 原型
 * @param {Function} SimulatorClass - CultivationSimulator 类
 */
function mixinActions(SimulatorClass) {
  const proto = SimulatorClass.prototype;

  // ============================================================
  // 动作实现：战斗 (0-4)
  // ============================================================
  proto._doBattle = function (type, skillIndex = 0) {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.battle > 0) return result;
    p.cooldowns.battle = 3;

    let damage = 0;
    let mpCost = 0;
    let skillName = '普通攻击';

    // 获取当前地图的敌人信息
    const { getMapInfo } = require('./duel_common.js');
    const mapInfo = getMapInfo(p.mapId);
    const enemyLevel = mapInfo.level || p.level;
    const enemyName = mapInfo.enemies && mapInfo.enemies.length > 0
      ? `怪物#${mapInfo.enemies[Math.floor(Math.random() * mapInfo.enemies.length)]}`
      : '野怪';

    // 记录当前敌人到模拟器实例
    this.currentEnemy = {
      name: enemyName,
      level: enemyLevel,
      hp: 30 + enemyLevel * 5,
      attack: 3 + enemyLevel * 2,
      defense: 3 + enemyLevel * 0.5,
    };

    switch (type) {
      case 'attack': {
        damage = p.attack + (p.weapon ? (p.weapon.stats?.attack || 0) : 0);
        damage = Math.max(1, damage + randomInt(-3, 3));
        skillName = '普通攻击';
        break;
      }
      case 'skill1':
      case 'skill2':
      case 'skill3': {
        const skillIdx = type === 'skill1' ? 0 : type === 'skill2' ? 1 : 2;
        const skillId = p.equippedSkills[skillIdx] || p.keySkillId;
        if (skillId) {
          const skillData = SKILLS_DATA.find(s => s.id === skillId);
          if (skillData) {
            const effect = skillData.effects?.[0];
            if (effect) {
              if (effect.type === 'damage' || effect.type === 'attack') {
                damage = Math.round(p.attack * (effect.value || 1.0) * (1 + (effect.damage_percent || 0) / 100));
                mpCost = skillData.mp_cost || 10;
              } else if (effect.heal_max_hp_percent) {
                const healAmt = Math.round(p.maxHp * (effect.heal_max_hp_percent / 100));
                p.hp = Math.min(p.maxHp, p.hp + healAmt);
                result.hpDelta = healAmt;
                mpCost = skillData.mp_cost || 15;
                skillName = skillData.name || '治疗技能';
                result.specialRewards = { battleWin: true };
                return result;
              }
            }
            skillName = skillData.name || `技能${skillIdx + 1}`;
          } else {
            damage = Math.round(p.attack * 1.2);
            mpCost = 10;
          }
        } else {
          damage = p.attack;
          mpCost = 0;
        }
        break;
      }
      case 'heal': {
        const healAmt = Math.round(p.maxHp * 0.2);
        mpCost = 15;
        if (p.mp >= mpCost) {
          p.mp -= mpCost;
          const actualHeal = Math.min(p.maxHp - p.hp, healAmt);
          p.hp += actualHeal;
          result.hpDelta = actualHeal;
          result.mpDelta = -mpCost;
          result.specialRewards = { battleWin: true };
        }
        return result;
      }
    }

    if (mpCost > 0 && p.mp < mpCost) {
      damage = p.attack;
      mpCost = 0;
      skillName = '普通攻击(MP不足)';
    }

    if (mpCost > 0) {
      p.mp = Math.max(0, p.mp - mpCost);
      result.mpDelta = -mpCost;
    }

    const enemyDefense = this.currentEnemy.defense;
    const finalDamage = Math.max(1, Math.round(damage - enemyDefense * 0.5 + randomInt(-2, 2)));

    const enemyHp = this.currentEnemy.hp;
    if (finalDamage >= enemyHp) {
      const expGain = 10 + enemyLevel * 2;
      const stoneGain = 5 + enemyLevel;
      p.exp += expGain;
      p.spiritStones += stoneGain;
      p.stats.battlesWon++;
      p.stats.totalExpGained += expGain;
      p.stats.totalSpiritStones += stoneGain;
      result.expGain = expGain;
      result.spiritStoneGain = stoneGain;
      result.specialRewards = { battleWin: true };
    } else {
      const counterDmg = Math.max(1, Math.round((enemyDefense * 0.3) - p.defense * 0.2 + randomInt(0, 3)));
      p.hp = Math.max(0, p.hp - counterDmg);
      result.hpDelta = -counterDmg;
      if (p.hp <= 0) {
        result.specialRewards = { death: true, battleLoss: true };
        p.stats.battlesLost++;
      }
    }

    return result;
  };

  // ============================================================
  // 动作实现：使用药水 (5-6)
  // ============================================================
  proto._usePotion = function (type) {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.potion > 0) return result;
    p.cooldowns.potion = 5;

    const potionType = type === 'hp' ? 'healHp' : 'healMp';
    const potion = p.inventory.find(i =>
      (i.type === 'potion' || i.type === 'consumable') &&
      i.stats?.[potionType] &&
      i.quantity > 0
    );

    if (!potion) return result;

    const healAmt = potion.stats[potionType] || 30;
    potion.quantity--;

    if (type === 'hp') {
      const actualHeal = Math.min(p.maxHp - p.hp, healAmt);
      p.hp += actualHeal;
      result.hpDelta = actualHeal;
    } else {
      const actualHeal = Math.min(p.maxMp - p.mp, healAmt);
      p.mp += actualHeal;
      result.mpDelta = actualHeal;
    }

    p.stats.itemsUsed++;
    result.specialRewards = { itemUse: true };

    if (potion.quantity <= 0) {
      p.inventory = p.inventory.filter(i => i.quantity > 0);
    }

    return result;
  };

  // ============================================================
  // 动作实现：切换地图 (7) - 使用真实地图数据
  // ============================================================
  proto._switchMap = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    // 使用真实地图数据
    const { MAPS_DATA, getMapName } = require('./duel_common.js');
    const availableMaps = MAPS_DATA.filter(m => m.id <= 16); // 使用非灵界地图
    if (availableMaps.length > 0) {
      const currentIdx = availableMaps.findIndex(m => m.id === p.mapId);
      const nextIdx = (currentIdx + 1) % availableMaps.length;
      const nextMap = availableMaps[nextIdx];
      p.mapId = nextMap.id;
    } else {
      p.mapId = (p.mapId % 16) + 1;
    }

    const hpRestore = Math.round(p.maxHp * 0.05);
    const mpRestore = Math.round(p.maxMp * 0.05);
    p.hp = Math.min(p.maxHp, p.hp + hpRestore);
    p.mp = Math.min(p.maxMp, p.mp + mpRestore);
    result.hpDelta = hpRestore;
    result.mpDelta = mpRestore;

    return result;
  };

  // ============================================================
  // 动作实现：升级 (8)
  // ============================================================
  proto._doLevelUp = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.exp < p.expToNext) return result;

    p.exp -= p.expToNext;
    p.level++;
    p.expToNext = Math.round(100 * Math.pow(1.15, p.level - 1));

    const hpGain = 10 + p.level * 2;
    const mpGain = 5 + p.level;
    p.maxHp += hpGain;
    p.maxMp += mpGain;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.attack += 2;
    p.defense += 1;

    result.hpDelta = hpGain;
    result.mpDelta = mpGain;
    result.specialRewards = { levelUp: true };

    return result;
  };

  // ============================================================
  // 动作实现：突破 (9)
  // ============================================================
  proto._doBreakthrough = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.breakthrough >= p.breakthroughMax) return result;
    if (p.level < 10 * (p.breakthrough + 1)) return result;

    const cost = 50 * (p.breakthrough + 1);
    if (p.spiritStones < cost) return result;

    p.spiritStones -= cost;
    p.breakthrough++;

    const hpGain = 50 + p.breakthrough * 20;
    const mpGain = 25 + p.breakthrough * 10;
    p.maxHp += hpGain;
    p.maxMp += mpGain;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.attack += 5 + p.breakthrough * 2;
    p.defense += 3 + p.breakthrough;

    p.stats.breakthroughs++;
    result.hpDelta = hpGain;
    result.mpDelta = mpGain;
    result.spiritStoneGain = -cost;
    result.specialRewards = { breakthrough: true };

    return result;
  };

  // ============================================================
  // 动作实现：装备物品 (10-11)
  // ============================================================
  proto._equipItem = function (type) {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const candidates = p.inventory.filter(i => i.type === type && i.quantity > 0);
    if (candidates.length === 0) return result;

    candidates.sort((a, b) => {
      const aVal = a.stats?.quality || 0;
      const bVal = b.stats?.quality || 0;
      if (aVal !== bVal) return bVal - aVal;
      const aStat = type === 'weapon' ? (a.stats?.attack || 0) : (a.stats?.defense || 0);
      const bStat = type === 'weapon' ? (b.stats?.attack || 0) : (b.stats?.defense || 0);
      return bStat - aStat;
    });

    const best = candidates[0];

    if (type === 'weapon') {
      if (p.weapon) {
        const existing = p.inventory.find(i => i.itemId === p.weapon.itemId);
        if (existing) {
          existing.quantity++;
        } else {
          p.inventory.push({ ...p.weapon, quantity: 1 });
        }
      }
      p.weapon = { ...best, quantity: 1 };
      best.quantity--;
      if (best.quantity <= 0) {
        p.inventory = p.inventory.filter(i => i.quantity > 0);
      }
      result.specialRewards = { equipWeapon: true };
    } else {
      if (p.armor) {
        const existing = p.inventory.find(i => i.itemId === p.armor.itemId);
        if (existing) {
          existing.quantity++;
        } else {
          p.inventory.push({ ...p.armor, quantity: 1 });
        }
      }
      p.armor = { ...best, quantity: 1 };
      best.quantity--;
      if (best.quantity <= 0) {
        p.inventory = p.inventory.filter(i => i.quantity > 0);
      }
      result.specialRewards = { equipArmor: true };
    }

    this._recalcPlayerStats();
    return result;
  };

  // ============================================================
  // 重新计算玩家属性
  // ============================================================
  proto._recalcPlayerStats = function () {
    const p = this.player;
    if (p.weapon) {
      p.attack = this.options.startAttack + (p.level - 1) * 2 + p.breakthrough * 5 + (p.weapon.stats?.attack || 0);
    }
    if (p.armor) {
      p.defense = this.options.startDefense + (p.level - 1) * 1 + p.breakthrough * 3 + (p.armor.stats?.defense || 0);
    }
  };

  // ============================================================
  // 动作实现：领取邮件 (12)
  // ============================================================
  proto._claimMail = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const stones = 10 + randomInt(0, 10);
    p.spiritStones += stones;
    result.spiritStoneGain = stones;
    p.stats.totalSpiritStones += stones;

    return result;
  };

  // ============================================================
  // 动作实现：同步 (13)
  // ============================================================
  proto._doSync = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const hpRestore = Math.round(p.maxHp * 0.1);
    const mpRestore = Math.round(p.maxMp * 0.1);
    p.hp = Math.min(p.maxHp, p.hp + hpRestore);
    p.mp = Math.min(p.maxMp, p.mp + mpRestore);
    result.hpDelta = hpRestore;
    result.mpDelta = mpRestore;

    return result;
  };

  // ============================================================
  // 动作实现：自动战斗开关 (14)
  // ============================================================
  proto._toggleAutoBattle = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    p.autoBattle = !p.autoBattle;

    return result;
  };

  // ============================================================
  // 动作实现：炼丹 (15)
  // ============================================================
  proto._doAlchemy = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.alchemy > 0) return result;
    p.cooldowns.alchemy = 5;

    const herbs = p.inventory.filter(i => i.type === 'herb' && i.quantity > 0);
    if (herbs.length < 2) return result;

    herbs[0].quantity--;
    herbs[1].quantity--;
    if (herbs[0].quantity <= 0) p.inventory = p.inventory.filter(i => i.quantity > 0);
    if (herbs[1].quantity <= 0) p.inventory = p.inventory.filter(i => i.quantity > 0);

    const pill = { itemId: 100, name: '筑基丹', type: 'potion', quantity: 1, stats: { healHp: 50, healMp: 25 } };
    const existing = p.inventory.find(i => i.itemId === 100);
    if (existing) {
      existing.quantity++;
    } else {
      p.inventory.push(pill);
    }

    p.stats.alchemyCount++;
    result.specialRewards = { alchemy: true };

    return result;
  };

  // ============================================================
  // 动作实现：锻造 (16)
  // ============================================================
  proto._doForging = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.forging > 0) return result;
    p.cooldowns.forging = 5;

    const materials = p.inventory.filter(i => i.type === 'material' && i.quantity > 0);
    if (materials.length < 2) return result;

    materials[0].quantity--;
    materials[1].quantity--;
    if (materials[0].quantity <= 0) p.inventory = p.inventory.filter(i => i.quantity > 0);
    if (materials[1].quantity <= 0) p.inventory = p.inventory.filter(i => i.quantity > 0);

    const isWeapon = Math.random() > 0.5;
    const quality = 1 + Math.floor(Math.random() * 3);
    const newItem = {
      itemId: isWeapon ? 200 + p.stats.forgingCount : 300 + p.stats.forgingCount,
      name: isWeapon ? `锻造武器#${p.stats.forgingCount + 1}` : `锻造防具#${p.stats.forgingCount + 1}`,
      type: isWeapon ? 'weapon' : 'armor',
      quantity: 1,
      stats: {
        attack: isWeapon ? 5 + quality * 3 + randomInt(0, 5) : 0,
        defense: isWeapon ? 0 : 3 + quality * 2 + randomInt(0, 3),
        quality: quality,
      },
    };
    p.inventory.push(newItem);

    p.stats.forgingCount++;
    result.specialRewards = { forging: true };

    return result;
  };

  // ============================================================
  // 动作实现：锻造升级 (17)
  // ============================================================
  proto._doForgingUpgrade = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.forging > 0) return result;
    p.cooldowns.forging = 5;

    const target = p.weapon || p.armor;
    if (!target) return result;

    const cost = 20;
    if (p.spiritStones < cost) return result;
    p.spiritStones -= cost;

    if (target.stats.attack) {
      target.stats.attack += 3 + randomInt(0, 3);
    }
    if (target.stats.defense) {
      target.stats.defense += 2 + randomInt(0, 2);
    }
    target.stats.quality = Math.min(10, (target.stats.quality || 1) + 1);

    result.spiritStoneGain = -cost;
    result.specialRewards = { forging: true };

    return result;
  };

  // ============================================================
  // 动作实现：锻造重铸 (18)
  // ============================================================
  proto._doForgingReroll = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.forging > 0) return result;
    p.cooldowns.forging = 5;

    const target = p.weapon || p.armor;
    if (!target) return result;

    const cost = 30;
    if (p.spiritStones < cost) return result;
    p.spiritStones -= cost;

    const quality = target.stats.quality || 1;
    if (target.stats.attack) {
      target.stats.attack = Math.max(1, Math.round(target.stats.attack * (0.5 + Math.random())));
    }

    result.spiritStoneGain = -cost;
    result.specialRewards = { forging: true };

    return result;
  };
}

module.exports = { mixinActions };
