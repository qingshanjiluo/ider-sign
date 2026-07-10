const LUNDAODIAN_EXP_BASIC = 7_000_000;
const LUNDAODIAN_EXP_INTERMEDIATE = 50_000_000;
const LUNDAODIAN_EXP_ADVANCED = 200_000_000;
const LUNDAODIAN_LEVEL_REQ = 321;
const LUNDAODIAN_SECT_COST = 50;

function playerHasBasicTechniqueAtLeast(player, minLevel, deps) {
  const { intVal, getTechniques } = deps;
  const sid = intVal(player?.sect_id, 0);
  if (sid <= 0) return false;
  const levels = player?.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
  for (const t of getTechniques() || []) {
    if (intVal(t.sectId, 0) !== sid || String(t.sectTier || '') !== 'basic') continue;
    const tid = intVal(t.id, 0);
    const lvData = levels[tid] || levels[String(tid)] || null;
    if (lvData && intVal(lvData.level, 0) >= minLevel) return true;
  }
  return false;
}

function playerHasIntermediateTechniqueAtLeast(player, minLevel, deps) {
  const { intVal, getTechniques } = deps;
  const sid = intVal(player?.sect_id, 0);
  if (sid <= 0) return false;
  const levels = player?.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
  for (const t of getTechniques() || []) {
    if (intVal(t.sectId, 0) !== sid || String(t.sectTier || '') !== 'intermediate') continue;
    const tid = intVal(t.id, 0);
    const lvData = levels[tid] || levels[String(tid)] || null;
    if (lvData && intVal(lvData.level, 0) >= minLevel) return true;
  }
  return false;
}

function isSkillUnlockedByTechnique(skillId, deps) {
  const { intVal, getTechniques } = deps;
  const sid = intVal(skillId, 0);
  if (sid <= 0) return false;
  for (const t of (getTechniques() || [])) {
    const unlocks = Array.isArray(t?.skillUnlocks) ? t.skillUnlocks : [];
    for (const u of unlocks) {
      if (intVal(u?.skillId, 0) === sid) return true;
    }
  }
  return false;
}

function getSectLearnRule(player, typ, idVal, deps) {
  const { intVal, readPositiveIntByKeys, getSkills, getTechniques } = deps;
  const sid = intVal(player?.sect_id, 0);
  if (sid <= 0) return { ok: false, error: '未加入宗门' };
  if (typ === 'skill') {
    const skill = (getSkills() || []).find(s => intVal(s.id, 0) === intVal(idVal, 0)) || {};
    if (!skill || Object.keys(skill).length <= 0) return { ok: false, error: '技能不存在' };
    if (intVal(skill.sectId, 0) !== sid) return { ok: false, error: '该技能不属于本宗门' };
    if (isSkillUnlockedByTechnique(idVal, deps)) return { ok: false, error: '该技能需通过功法领悟，无法在传功长老直接学习' };
    const tier = String(skill.sectTier || '');
    if (tier === 'basic') {
      return {
        ok: true,
        tier,
        cost: 0,
        levelReq: Math.max(0, intVal(skill.transmitLevel, 0)),
        needBasicGe3: false,
        needIntermediateGe4: false,
        name: String(skill.name || '技能')
      };
    }
    if (tier === 'intermediate') {
      return {
        ok: true,
        tier,
        cost: Math.max(0, intVal(skill.hallContribution, 0)),
        levelReq: readPositiveIntByKeys(skill, ['sectLevelReq', 'levelReq', 'level_req', 'requiredLevel', 'required_level', 'unlockLevel', 'unlock_level', 'learnLevel', 'learn_level'], 131),
        needBasicGe3: true,
        needIntermediateGe4: false,
        name: String(skill.name || '技能')
      };
    }
    if (tier === 'advanced') {
      return {
        ok: true,
        tier,
        cost: Math.max(0, intVal(skill.scriptureContribution, 0)),
        levelReq: readPositiveIntByKeys(skill, ['sectLevelReq', 'levelReq', 'level_req', 'requiredLevel', 'required_level', 'unlockLevel', 'unlock_level', 'learnLevel', 'learn_level'], 171),
        needBasicGe3: false,
        needIntermediateGe4: true,
        name: String(skill.name || '技能')
      };
    }
    return { ok: false, error: '技能阶层无效' };
  }
  if (typ === 'technique') {
    const technique = (getTechniques() || []).find(t => intVal(t.id, 0) === intVal(idVal, 0)) || {};
    if (!technique || Object.keys(technique).length <= 0) return { ok: false, error: '功法不存在' };
    if (intVal(technique.sectId, 0) !== sid) return { ok: false, error: '该功法不属于本宗门' };
    const tier = String(technique.sectTier || '');
    if (tier === 'basic') {
      return {
        ok: true,
        tier,
        cost: 0,
        levelReq: Math.max(0, intVal(technique.transmitLevel, 0)),
        needBasicGe3: false,
        needIntermediateGe4: false,
        name: String(technique.name || '功法')
      };
    }
    if (tier === 'intermediate') {
      return {
        ok: true,
        tier,
        cost: Math.max(0, intVal(technique.hallContribution, 0)),
        levelReq: readPositiveIntByKeys(technique, ['sectLevelReq', 'levelReq', 'level_req', 'requiredLevel', 'required_level', 'unlockLevel', 'unlock_level', 'learnLevel', 'learn_level'], 121),
        needBasicGe3: true,
        needIntermediateGe4: false,
        name: String(technique.name || '功法')
      };
    }
    if (tier === 'advanced') {
      return {
        ok: true,
        tier,
        cost: Math.max(0, intVal(technique.scriptureContribution, 0)),
        levelReq: readPositiveIntByKeys(technique, ['sectLevelReq', 'levelReq', 'level_req', 'requiredLevel', 'required_level', 'unlockLevel', 'unlock_level', 'learnLevel', 'learn_level'], 161),
        needBasicGe3: false,
        needIntermediateGe4: true,
        name: String(technique.name || '功法')
      };
    }
    return { ok: false, error: '功法阶层无效' };
  }
  return { ok: false, error: '学习参数无效' };
}

function learnSkillByIdServer(player, skillId, deps) {
  const { intVal, getSkills } = deps;
  if (!player || skillId <= 0) return { ok: false, error: '参数无效' };
  const rule = getSectLearnRule(player, 'skill', skillId, deps);
  if (!rule.ok) return { ok: false, error: String(rule.error || '学习条件不满足') };
  if (intVal(rule.levelReq, 0) > 0 && intVal(player.level, 0) < intVal(rule.levelReq, 0)) return { ok: false, error: '等级不足，无法学习' };
  if (Boolean(rule.needBasicGe3) && !playerHasBasicTechniqueAtLeast(player, 3, deps)) return { ok: false, error: '需要先修习至少3门基础功法到3重' };
  if (Boolean(rule.needIntermediateGe4) && !playerHasIntermediateTechniqueAtLeast(player, 4, deps)) return { ok: false, error: '需要先修习至少4门中阶功法到4重' };
  player.skill_levels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
  if (player.skill_levels[skillId] || player.skill_levels[String(skillId)]) return { ok: false, error: '已学习该技能' };
  const skill = (getSkills() || []).find(s => intVal(s.id, 0) === intVal(skillId, 0)) || {};
  if (!skill || Object.keys(skill).length <= 0) return { ok: false, error: '技能不存在' };
  const tags = Array.isArray(skill.tags) ? skill.tags : [];
  if (tags.includes('enemySkill')) return { ok: false, error: '该技能不可学习' };
  player.skill_levels[String(skillId)] = { level: 1, exp: 0 };
  return { ok: true, name: String(skill.name || '技能') };
}

function learnTechniqueByIdServer(player, techniqueId, deps) {
  const { intVal, getTechniques } = deps;
  if (!player || techniqueId <= 0) return { ok: false, error: '参数无效' };
  const rule = getSectLearnRule(player, 'technique', techniqueId, deps);
  if (!rule.ok) return { ok: false, error: String(rule.error || '学习条件不满足') };
  if (intVal(rule.levelReq, 0) > 0 && intVal(player.level, 0) < intVal(rule.levelReq, 0)) return { ok: false, error: '等级不足，无法学习' };
  if (Boolean(rule.needBasicGe3) && !playerHasBasicTechniqueAtLeast(player, 3, deps)) return { ok: false, error: '需要先修习至少3门基础功法到3重' };
  if (Boolean(rule.needIntermediateGe4) && !playerHasIntermediateTechniqueAtLeast(player, 4, deps)) return { ok: false, error: '需要先修习至少4门中阶功法到4重' };
  player.technique_levels = player.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
  if (player.technique_levels[techniqueId] || player.technique_levels[String(techniqueId)]) return { ok: false, error: '已学习该功法' };
  const technique = (getTechniques() || []).find(t => intVal(t.id, 0) === intVal(techniqueId, 0)) || {};
  if (!technique || Object.keys(technique).length <= 0) return { ok: false, error: '功法不存在' };
  player.technique_levels[String(techniqueId)] = { level: 1, exp: 0 };
  player._combat_dirty = true;
  return { ok: true, name: String(technique.name || '功法') };
}

function getLundaodianExpForTier(tier) {
  if (tier === 'advanced') return LUNDAODIAN_EXP_ADVANCED;
  if (tier === 'intermediate') return LUNDAODIAN_EXP_INTERMEDIATE;
  return LUNDAODIAN_EXP_BASIC;
}

function mountSectCoreRoutes({
  router,
  withAccountLock,
  db,
  intVal,
  readPositiveIntByKeys,
  getSectById,
  getSkills,
  getTechniques,
  getItemById,
  getSectMemberCounts,
  countItemInInventory,
  consumeItemFromInventory,
  calculateItemValue
}) {
  if (!router || typeof router.use !== 'function') {
    throw new Error('mountSectCoreRoutes: router 参数无效');
  }
  if (typeof withAccountLock !== 'function') {
    throw new Error('mountSectCoreRoutes: withAccountLock 参数无效');
  }

  const deps = {
    intVal,
    readPositiveIntByKeys,
    getSkills,
    getTechniques
  };

  router.post('/sect/join', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const sectId = intVal(req.body?.sect_id, 0);
      if (sectId <= 0) return res.json({ ok: false, error: '宗门参数无效' });
      if (intVal(player.level, 0) < 5) return res.json({ ok: false, error: '至少练气五层方可拜入宗门' });
      if (intVal(player.sect_id, 0) !== 0) return res.json({ ok: false, error: '你已加入宗门，需先退宗' });
      const sect = getSectById(sectId);
      if (!sect || Object.keys(sect).length <= 0) return res.json({ ok: false, error: '宗门不存在' });
      if (sect.joinable === false) return res.json({ ok: false, error: '该宗门暂不开放拜入' });
      player.sect_id = sectId;
      player.sect_contribution = 0;
      player.sect_tasks = [];
      player.sect_task_refresh_time = 0;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, sect_name: String(sect.name || '宗门') });
    });
  });

  router.post('/sect/leave', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) === 0) return res.json({ ok: false, error: '你尚未加入任何宗门' });
      const lv = intVal(player.level, 1);
      const isLowLevelBenefit = lv >= 5 && lv <= 10;
      const requiredExp = 80000;
      if (!isLowLevelBenefit && intVal(player.exp, 0) < requiredExp) {
        return res.json({ ok: false, error: `经验不足，无法自废退宗（需要${requiredExp}点经验，当前${intVal(player.exp, 0)}点）` });
      }
      const sid = intVal(player.sect_id, 0);
      const sect = getSectById(sid);
      if (!isLowLevelBenefit) {
        player.exp = intVal(player.exp, 0) - requiredExp;
      }
      const skillLevels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
      const techLevels = player.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
      const sectSkillIds = [];
      for (const s of getSkills() || []) {
        if (intVal(s.sectId, 0) !== sid) continue;
        const id = String(intVal(s.id, 0));
        sectSkillIds.push(id);
        if (Object.prototype.hasOwnProperty.call(skillLevels, id)) delete skillLevels[id];
      }
      // 清除宗门技能的冷却记录，避免冷却结束后技能因残留 cooldown 被错误显示回队列
      const skillCooldowns = player.skill_cooldowns && typeof player.skill_cooldowns === 'object' ? player.skill_cooldowns : {};
      for (const id of sectSkillIds) {
        if (Object.prototype.hasOwnProperty.call(skillCooldowns, id)) delete skillCooldowns[id];
      }
      player.skill_cooldowns = skillCooldowns;
      for (const t of getTechniques() || []) {
        if (intVal(t.sectId, 0) !== sid) continue;
        const id = String(intVal(t.id, 0));
        if (Object.prototype.hasOwnProperty.call(techLevels, id)) delete techLevels[id];
        const mainTech = player.techniques && typeof player.techniques === 'object' ? player.techniques.main : null;
        const subTech = player.techniques && typeof player.techniques === 'object' ? player.techniques.sub : null;
        if (mainTech && intVal(mainTech.id, 0) === intVal(id, 0) && player.techniques) player.techniques.main = null;
        if (subTech && intVal(subTech.id, 0) === intVal(id, 0) && player.techniques) player.techniques.sub = null;
      }
      player.skill_levels = skillLevels;
      player.technique_levels = techLevels;
      player._combat_dirty = true;
      if (Array.isArray(player.equipped_skills)) {
        player.equipped_skills = player.equipped_skills.filter(idv => {
          const id = String(intVal(idv, 0));
          return Object.prototype.hasOwnProperty.call(skillLevels, id);
        });
      }
      if (intVal(player.key_skill_id, 0) > 0) {
        const keyId = String(intVal(player.key_skill_id, 0));
        if (!Object.prototype.hasOwnProperty.call(skillLevels, keyId)) {
          player.key_skill_id = 0;
        }
      }
      player.sect_id = 0;
      player.sect_contribution = 0;
      player.sect_tasks = [];
      player.sect_task_refresh_time = 0;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, sect_name: String(sect.name || '宗门') });
    });
  });

  router.get('/sect/member_counts', async (req, res) => {
    const player = await db.getPlayerByAccountId(req.accountId);
    if (!player) return res.json({ ok: false, error: '无角色' });
    const counts = await getSectMemberCounts();
    const sid = intVal(player.sect_id, 0);
    const selfCount = sid > 0 ? intVal(counts[String(sid)], 0) : 0;
    return res.json({ ok: true, counts, self_count: selfCount });
  });

  router.post('/sect/contribute', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.sect_id, 0) <= 0) return res.json({ ok: false, error: '未加入宗门' });
      const itemId = intVal(req.body?.item_id, 0);
      const count = Math.max(1, intVal(req.body?.count, 1));
      if (itemId <= 0) return res.json({ ok: false, error: '物品参数无效' });
      if (countItemInInventory(player, itemId) < count) return res.json({ ok: false, error: '物品数量不足' });
      const item = getItemById(itemId);
      if (!item || Object.keys(item).length <= 0) return res.json({ ok: false, error: '物品不存在' });
      const valueEach = calculateItemValue(item);
      const contribution = Math.floor((valueEach * count) / 2.0);
      consumeItemFromInventory(player, itemId, count);
      player.sect_contribution = intVal(player.sect_contribution, 0) + contribution;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, contribution, item_name: String(item.name || '物品'), count });
    });
  });

  router.post('/sect/learn', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      const typ = String(req.body?.type || '').trim();
      const idVal = intVal(req.body?.id, 0);
      if (!['skill', 'technique'].includes(typ) || idVal <= 0) return res.json({ ok: false, error: '学习参数无效' });
      const rule = getSectLearnRule(player, typ, idVal, deps);
      if (!rule.ok) return res.json(rule);
      const cost = Math.max(0, intVal(rule.cost, 0));
      const levelReq = Math.max(0, intVal(rule.levelReq, 0));
      const needBasic = Boolean(rule.needBasicGe3);
      const needIntermediate = Boolean(rule.needIntermediateGe4);
      if (levelReq > 0 && intVal(player.level, 0) < levelReq) {
        return res.json({ ok: false, error: '等级不足，无法学习' });
      }
      if (needBasic && !playerHasBasicTechniqueAtLeast(player, 3, deps)) {
        return res.json({ ok: false, error: '至少一门宗门基础功法达到3级方可学习该内容' });
      }
      if (needIntermediate && !playerHasIntermediateTechniqueAtLeast(player, 4, deps)) {
        return res.json({ ok: false, error: '至少一门宗门中级功法达到4级方可学习该内容' });
      }
      if (intVal(player.sect_contribution, 0) < cost) return res.json({ ok: false, error: '贡献点不足' });
      let learned = { ok: false, error: '学习失败' };
      if (typ === 'skill') learned = learnSkillByIdServer(player, idVal, deps);
      else learned = learnTechniqueByIdServer(player, idVal, deps);
      if (!learned.ok) return res.json(learned);
      player.sect_contribution = intVal(player.sect_contribution, 0) - cost;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, learned_type: typ, learned_id: idVal, name: learned.name, cost, tier: String(rule.tier || '') });
    });
  });

  // 论道殿：合体期(321级)以上，首次选宗门耗50六阶材料，之后花经验学该宗技能/功法
  router.post('/sect/lundaodian/select', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.level, 0) < LUNDAODIAN_LEVEL_REQ) {
        return res.json({ ok: false, error: '论道殿需合体期及以上方可进入' });
      }
      const sectId = intVal(req.body?.sect_id, 0);
      if (sectId <= 0) return res.json({ ok: false, error: '宗门ID无效' });
      const sect = getSectById(sectId);
      if (!sect || !sect.id) return res.json({ ok: false, error: '宗门不存在' });
      const materialId = intVal(sect.lundaodianMaterialId, 0);
      if (materialId <= 0) return res.json({ ok: false, error: '该宗门未配置论道材料' });
      const mat = getItemById(materialId);
      const matQuality = intVal(mat?.quality, 0);
      const matType = String(mat?.type || '');
      if (!mat || matType !== 'material' || matQuality < 6) {
        return res.json({ ok: false, error: '该宗门论道材料配置错误（需6阶材料）' });
      }
      const have = countItemInInventory(player, materialId);
      if (have < LUNDAODIAN_SECT_COST) {
        const matName = String(mat.name || '六阶材料');
        return res.json({ ok: false, error: `需要${matName}×${LUNDAODIAN_SECT_COST}，当前拥有${have}` });
      }
      if (!consumeItemFromInventory(player, materialId, LUNDAODIAN_SECT_COST)) {
        return res.json({ ok: false, error: '消耗材料失败' });
      }
      player.lundaodian_sect_id = sectId;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, sect_id: sectId, sect_name: String(sect.name || '') });
    });
  });

  router.post('/sect/lundaodian/learn', (req, res) => {
    return withAccountLock(req, res, async () => {
      const player = await db.getPlayerByAccountId(req.accountId);
      if (!player) return res.json({ ok: false, error: '无角色' });
      if (intVal(player.level, 0) < LUNDAODIAN_LEVEL_REQ) {
        return res.json({ ok: false, error: '论道殿需合体期及以上方可进入' });
      }
      const ldSectId = intVal(player.lundaodian_sect_id, 0);
      if (ldSectId <= 0) return res.json({ ok: false, error: '请先在论道殿选择要论道的宗门' });
      const typ = String(req.body?.type || '').trim();
      const idVal = intVal(req.body?.id, 0);
      if (!['skill', 'technique'].includes(typ) || idVal <= 0) return res.json({ ok: false, error: '学习参数无效' });

      let cost = 0;
      let tier = 'basic';
      if (typ === 'skill') {
        const skill = (getSkills() || []).find(s => intVal(s.id, 0) === idVal) || {};
        if (!skill || !skill.id) return res.json({ ok: false, error: '技能不存在' });
        if (intVal(skill.sectId, 0) !== ldSectId) return res.json({ ok: false, error: '该技能不属于所选论道宗门' });
        if (isSkillUnlockedByTechnique(idVal, deps)) return res.json({ ok: false, error: '该技能需通过功法领悟，无法在论道殿直接学习' });
        tier = String(skill.sectTier || 'basic');
        const tags = Array.isArray(skill.tags) ? skill.tags : [];
        if (tags.includes('enemySkill')) return res.json({ ok: false, error: '该技能不可学习' });
        cost = getLundaodianExpForTier(tier);
        player.skill_levels = player.skill_levels && typeof player.skill_levels === 'object' ? player.skill_levels : {};
        if (player.skill_levels[idVal] || player.skill_levels[String(idVal)]) {
          return res.json({ ok: false, error: '已学习该技能' });
        }
        const playerExp = intVal(player.exp, 0);
        if (playerExp < cost) return res.json({ ok: false, error: `经验不足，需要${cost}点经验` });
        player.exp = playerExp - cost;
        player.skill_levels[String(idVal)] = { level: 1, exp: 0 };
        await db.savePlayer(req.accountId, 1, player);
        return res.json({ ok: true, player, learned_type: 'skill', learned_id: idVal, name: String(skill.name || '技能'), cost, tier });
      }

      const technique = (getTechniques() || []).find(t => intVal(t.id, 0) === idVal) || {};
      if (!technique || !technique.id) return res.json({ ok: false, error: '功法不存在' });
      if (intVal(technique.sectId, 0) !== ldSectId) return res.json({ ok: false, error: '该功法不属于所选论道宗门' });
      tier = String(technique.sectTier || 'basic');
      cost = getLundaodianExpForTier(tier);
      player.technique_levels = player.technique_levels && typeof player.technique_levels === 'object' ? player.technique_levels : {};
      if (player.technique_levels[idVal] || player.technique_levels[String(idVal)]) {
        return res.json({ ok: false, error: '已学习该功法' });
      }
      const playerExp = intVal(player.exp, 0);
      if (playerExp < cost) return res.json({ ok: false, error: `经验不足，需要${cost}点经验` });
      player.exp = playerExp - cost;
      player.technique_levels[String(idVal)] = { level: 1, exp: 0 };
      player._combat_dirty = true;
      await db.savePlayer(req.accountId, 1, player);
      return res.json({ ok: true, player, learned_type: 'technique', learned_id: idVal, name: String(technique.name || '功法'), cost, tier });
    });
  });
}

module.exports = { mountSectCoreRoutes };