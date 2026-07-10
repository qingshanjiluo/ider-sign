/**
 * duel_actions2.js - CultivationSimulator 动作实现（第二部分）
 * 
 * 包含：洞府、弟子、宗门、联盟、副本、试炼、交易所
 */

const { randomInt } = require('./duel_common.js');

/**
 * 将动作方法混入 CultivationSimulator 原型（第二部分）
 * @param {Function} SimulatorClass - CultivationSimulator 类
 */
function mixinActions2(SimulatorClass) {
  const proto = SimulatorClass.prototype;

  // ============================================================
  // 动作实现：洞府采集 (19)
  // ============================================================
  proto._doCaveGather = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.cave > 0) return result;
    p.cooldowns.cave = 3;

    const gatherAmt = 5 + p.cave.level * 2;
    p.cave.gatherCount += gatherAmt;
    const stones = gatherAmt;
    p.spiritStones += stones;
    result.spiritStoneGain = stones;
    result.specialRewards = { caveGather: true };

    return result;
  };

  // ============================================================
  // 动作实现：洞府升级 (20)
  // ============================================================
  proto._doCaveUpgrade = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const cost = 50 * p.cave.level;
    if (p.spiritStones < cost) return result;

    p.spiritStones -= cost;
    p.cave.level++;
    result.spiritStoneGain = -cost;
    result.specialRewards = { caveUpgrade: true };

    return result;
  };

  // ============================================================
  // 动作实现：洞府阵法 (21)
  // ============================================================
  proto._doCaveFormation = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const cost = 30;
    if (p.spiritStones < cost) return result;

    p.spiritStones -= cost;
    p.cave.formationActive = !p.cave.formationActive;
    result.spiritStoneGain = -cost;

    return result;
  };

  // ============================================================
  // 动作实现：招募弟子 (22)
  // ============================================================
  proto._doCreateDisciple = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const cost = 20;
    if (p.spiritStones < cost) return result;

    p.spiritStones -= cost;
    const disciple = {
      id: p.disciples.length + 1,
      name: `弟子${p.disciples.length + 1}`,
      level: 1,
      power: 5 + randomInt(0, 10),
      sent: false,
    };
    p.disciples.push(disciple);
    result.spiritStoneGain = -cost;
    result.specialRewards = { discipleCreate: true };

    return result;
  };

  // ============================================================
  // 动作实现：派遣弟子 (23)
  // ============================================================
  proto._doSendDisciple = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const available = p.disciples.filter(d => !d.sent);
    if (available.length === 0) return result;

    const disciple = available[0];
    disciple.sent = true;

    const reward = disciple.power * 2;
    p.spiritStones += reward;
    p.exp += disciple.power;
    result.spiritStoneGain = reward;
    result.expGain = disciple.power;
    result.specialRewards = { discipleSend: true };

    return result;
  };

  // ============================================================
  // 动作实现：召回弟子 (24)
  // ============================================================
  proto._doRecallDisciple = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const sent = p.disciples.filter(d => d.sent);
    if (sent.length === 0) return result;

    sent[0].sent = false;

    return result;
  };

  // ============================================================
  // 动作实现：宗门贡献 (25)
  // ============================================================
  proto._doSectContribute = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.sect > 0) return result;
    p.cooldowns.sect = 3;

    if (!p.sectId) {
      p.sectId = 1;
    }

    const cost = 10;
    if (p.spiritStones < cost) return result;

    p.spiritStones -= cost;
    p.sectContribution += 10;
    result.spiritStoneGain = -cost;
    result.specialRewards = { sectContribute: true };

    return result;
  };

  // ============================================================
  // 动作实现：宗门学习 (26) - 学习技能！
  // ============================================================
  proto._doSectLearn = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.sect > 0) return result;
    p.cooldowns.sect = 5;

    if (!p.sectId) {
      p.sectId = 1;
    }

    const cost = 30;
    if (p.sectContribution < cost) return result;

    // 找一个未学习的技能
    const unlearned = SKILLS_DATA.filter(s => !p.learnedSkills.includes(s.id));
    if (unlearned.length === 0) return result;

    const skill = unlearned[Math.floor(Math.random() * unlearned.length)];
    p.sectContribution -= cost;
    p.learnedSkills.push(skill.id);
    p.stats.skillsLearned++;

    // 自动装备技能（最多3个）
    if (p.equippedSkills.length < 3) {
      p.equippedSkills.push(skill.id);
      if (!p.keySkillId) {
        p.keySkillId = skill.id;
      }
    }

    result.specialRewards = { skillLearn: true };

    return result;
  };

  // ============================================================
  // 动作实现：宗门任务 (27)
  // ============================================================
  proto._doSectTask = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.sect > 0) return result;
    p.cooldowns.sect = 3;

    if (!p.sectId) {
      p.sectId = 1;
    }

    const expGain = 15 + p.level * 3;
    const stoneGain = 10 + p.level * 2;
    const contribGain = 5;
    p.exp += expGain;
    p.spiritStones += stoneGain;
    p.sectContribution += contribGain;
    p.stats.totalExpGained += expGain;
    p.stats.totalSpiritStones += stoneGain;
    result.expGain = expGain;
    result.spiritStoneGain = stoneGain;
    result.specialRewards = { sectTask: true };

    return result;
  };

  // ============================================================
  // 动作实现：联盟活动 (28-31)
  // ============================================================
  proto._doAllianceActivity = function (type) {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (!p.allianceId) {
      p.allianceId = 1;
    }

    switch (type) {
      case 'bless': {
        const hpRestore = Math.round(p.maxHp * 0.15);
        p.hp = Math.min(p.maxHp, p.hp + hpRestore);
        result.hpDelta = hpRestore;
        break;
      }
      case 'bathe': {
        const mpRestore = Math.round(p.maxMp * 0.15);
        p.mp = Math.min(p.maxMp, p.mp + mpRestore);
        result.mpDelta = mpRestore;
        break;
      }
      case 'garden': {
        const stones = 15 + randomInt(0, 10);
        p.spiritStones += stones;
        result.spiritStoneGain = stones;
        break;
      }
      case 'meditate': {
        const expGain = 20 + p.level * 2;
        p.exp += expGain;
        result.expGain = expGain;
        p.stats.totalExpGained += expGain;
        break;
      }
    }

    p.alliancePoints += 5;
    result.specialRewards = { allianceActivity: true };

    return result;
  };

  // ============================================================
  // 动作实现：副本挑战 (32)
  // ============================================================
  proto._doDungeon = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    if (p.cooldowns.dungeon > 0) return result;
    p.cooldowns.dungeon = 10;

    // 副本难度基于等级
    const dungeonLevel = Math.floor(p.level / 5) + 1;
    const difficulty = dungeonLevel * 20;
    const playerPower = p.attack + p.defense + p.hp * 0.5;

    if (playerPower >= difficulty) {
      const expGain = 30 + dungeonLevel * 10;
      const stoneGain = 20 + dungeonLevel * 5;
      p.exp += expGain;
      p.spiritStones += stoneGain;
      p.dungeonProgress += 10;
      p.stats.dungeonClears++;
      p.stats.totalExpGained += expGain;
      p.stats.totalSpiritStones += stoneGain;
      result.expGain = expGain;
      result.spiritStoneGain = stoneGain;
      result.specialRewards = { dungeonClear: true };
    } else {
      // 副本失败，受到伤害
      const dmg = Math.round(difficulty * 0.3);
      p.hp = Math.max(0, p.hp - dmg);
      result.hpDelta = -dmg;
      if (p.hp <= 0) {
        result.specialRewards = { death: true };
      }
    }

    return result;
  };

  // ============================================================
  // 动作实现：试炼 (33)
  // ============================================================
  proto._doTrial = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    const scoreGain = 5 + Math.floor(p.level / 2);
    p.trialScore += scoreGain;

    const stoneGain = scoreGain * 2;
    p.spiritStones += stoneGain;
    result.spiritStoneGain = stoneGain;
    result.specialRewards = { trialScore: true };

    return result;
  };

  // ============================================================
  // 动作实现：交易所 (34)
  // ============================================================
  proto._doExchange = function () {
    const p = this.player;
    const result = { hpDelta: 0, mpDelta: 0, expGain: 0, spiritStoneGain: 0, specialRewards: {} };

    // 简单交易：用HP换灵石或反之
    if (p.hp > p.maxHp * 0.5) {
      // 卖血换灵石
      const hpCost = Math.round(p.maxHp * 0.1);
      p.hp -= hpCost;
      const stones = hpCost * 2;
      p.spiritStones += stones;
      result.hpDelta = -hpCost;
      result.spiritStoneGain = stones;
    } else {
      // 买药恢复
      const cost = 10;
      if (p.spiritStones >= cost) {
        p.spiritStones -= cost;
        const hpRestore = Math.round(p.maxHp * 0.2);
        p.hp = Math.min(p.maxHp, p.hp + hpRestore);
        result.hpDelta = hpRestore;
        result.spiritStoneGain = -cost;
      }
    }

    result.specialRewards = { trade: true };

    return result;
  };
}

module.exports = { mixinActions2 };
