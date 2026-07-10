const MINGTU_LINES = [
  { key: 'metal', label: '金' },
  { key: 'wood', label: '木' },
  { key: 'water', label: '水' },
  { key: 'fire', label: '火' },
  { key: 'earth', label: '土' },
  { key: 'neutral', label: '无' },
  { key: 'hunyuan', label: '混元' }
];

function buildMingtuNodes() {
  const out = [];
  for (const line of MINGTU_LINES) {
    const rootId = `line_${line.key}_t1`;
    out.push({
      id: rootId,
      name: `${line.label}灵开脉`,
      cost_per_level: [1, 1, 1],
      max_level: 3,
      requires: [],
      line: line.key,
      row: 1,
      col: 4,
      effects: [{ type: 'element_affinity_per_level', rootType: line.key, values: [3, 8, 15] }]
    });

    for (let lane = 1; lane <= 3; lane++) {
      const tier2Id = `line_${line.key}_t2_${lane}`;
      const isMetal = line.key === 'metal';
      const isEarth = line.key === 'earth';
      const isFire = line.key === 'fire';
      const isWater = line.key === 'water';
      const isWood = line.key === 'wood';
      const isNeutral = line.key === 'neutral';
      const isHunyuan = line.key === 'hunyuan';
      const tier2ThreeLevel = isMetal || isEarth || isFire || isWater || isWood || isNeutral || isHunyuan;
      const tier2MaxLv = tier2ThreeLevel ? 3 : 1;
      const tier2Costs = tier2ThreeLevel ? [2, 2, 2] : null;
      const tier2Effects = (() => {
        if (isMetal) {
          if (lane === 1) return [{ type: 'destiny_phys_crit_rate_per_level', values: [0.006, 0.012, 0.02] }];
          if (lane === 2) return [{ type: 'destiny_physical_armor_pen_per_level', values: [0.01, 0.02, 0.032] }];
          return [{ type: 'destiny_phys_lifesteal_per_level', values: [0.005, 0.01, 0.015] }];
        }
        if (isEarth) {
          if (lane === 1) return [{ type: 'destiny_defense_pct_per_level', values: [0.015, 0.03, 0.05] }];
          if (lane === 2) {
            return [
              { type: 'destiny_counter_chance_per_level', values: [0.02, 0.04, 0.06] },
              { type: 'destiny_counter_coeff_per_level', values: [0.04, 0.06, 0.08] }
            ];
          }
          return [{ type: 'destiny_phys_damage_pct_per_level', values: [0.01, 0.02, 0.035] }];
        }
        if (isFire) {
          if (lane === 1) return [{ type: 'destiny_spell_attack_pct_per_level', values: [0.015, 0.03, 0.045] }];
          if (lane === 2) return [{ type: 'destiny_spell_crit_rate_per_level', values: [0.006, 0.012, 0.018] }];
          return [{ type: 'destiny_spell_armor_pen_per_level', values: [0.015, 0.03, 0.045] }];
        }
        if (isWater) {
          if (lane === 1) return [
            { type: 'destiny_defense_pct_per_level', values: [0.01, 0.02, 0.03] },
            { type: 'destiny_spell_defense_pct_per_level', values: [0.01, 0.02, 0.03] }
          ];
          if (lane === 2) return [
            { type: 'destiny_heal_bonus_per_level', values: [0.03, 0.06, 0.09] },
            { type: 'destiny_spell_defense_pct_per_level', values: [0.006, 0.012, 0.018] }
          ];
          return [
            { type: 'destiny_phys_damage_reduction_per_level', values: [0.006, 0.012, 0.018] },
            { type: 'destiny_spell_damage_reduction_per_level', values: [0.01, 0.02, 0.03] }
          ];
        }
        if (isWood) {
          if (lane === 1) return [
            { type: 'destiny_phys_damage_pct_per_level', values: [0.006, 0.012, 0.018] },
            { type: 'destiny_spell_attack_pct_per_level', values: [0.006, 0.012, 0.018] }
          ];
          if (lane === 2) return [
            { type: 'destiny_phys_lifesteal_per_level', values: [0.003, 0.006, 0.009] },
            { type: 'destiny_defense_pct_per_level', values: [0.006, 0.012, 0.018] }
          ];
          return [
            { type: 'destiny_spell_armor_pen_per_level', values: [0.005, 0.01, 0.015] },
            { type: 'destiny_spell_attack_pct_per_level', values: [0.005, 0.01, 0.015] }
          ];
        }
        if (isNeutral) {
          if (lane === 1) return [{ type: 'destiny_spell_attack_pct_per_level', values: [0.013, 0.026, 0.039] }];
          if (lane === 2) return [
            { type: 'destiny_spell_crit_rate_per_level', values: [0.004, 0.008, 0.012] },
            { type: 'destiny_phys_crit_rate_per_level', values: [0.0015, 0.003, 0.0045] }
          ];
          return [
            { type: 'destiny_spell_armor_pen_per_level', values: [0.005, 0.01, 0.015] },
            { type: 'destiny_spell_defense_pct_per_level', values: [0.009, 0.018, 0.027] }
          ];
        }
        if (isHunyuan) {
          if (lane === 1) return [
            { type: 'destiny_phys_damage_pct_per_level', values: [0.008, 0.016, 0.024] },
            { type: 'destiny_spell_attack_pct_per_level', values: [0.004, 0.008, 0.012] }
          ];
          if (lane === 2) return [
            { type: 'destiny_phys_crit_rate_per_level', values: [0.003, 0.006, 0.009] },
            { type: 'destiny_spell_crit_rate_per_level', values: [0.003, 0.006, 0.009] }
          ];
          return [
            { type: 'destiny_defense_pct_per_level', values: [0.009, 0.018, 0.027] },
            { type: 'destiny_physical_armor_pen_per_level', values: [0.003, 0.006, 0.009] },
            { type: 'destiny_spell_armor_pen_per_level', values: [0.003, 0.006, 0.009] }
          ];
        }
        return [{ type: 'placeholder_tier2', value: 0 }];
      })();
      out.push({
        id: tier2Id,
        name: isMetal
          ? (lane === 1 ? '金途二重·锐锋' : lane === 2 ? '金途二重·破甲' : '金途二重·饮血')
          : isEarth
            ? (lane === 1 ? '土途二重·玄甲' : lane === 2 ? '土途二重·反震' : '土途二重·崩山')
            : isFire
              ? (lane === 1 ? '火途二重·炽核' : lane === 2 ? '火途二重·灼瞳' : '火途二重·焚脉')
            : isWater
              ? (lane === 1 ? '水途二重·澄镜' : lane === 2 ? '水途二重·流辉' : '水途二重·润界')
            : isWood
              ? (lane === 1 ? '木途二重·青藤' : lane === 2 ? '木途二重·生息' : '木途二重·蚀脉')
            : line.key === 'neutral'
              ? (lane === 1 ? '无途二重·清弦' : lane === 2 ? '无途二重·凝神' : '无途二重·余音')
            : line.key === 'hunyuan'
              ? (lane === 1 ? '混途二重·御剑' : lane === 2 ? '混途二重·并流' : '混途二重·归元')
            : `${line.label}途二重·${lane}`,
        cost: 2,
        cost_per_level: tier2Costs,
        max_level: tier2MaxLv,
        requires: [rootId],
        line: line.key,
        row: 2,
        col: 2 + (lane - 1) * 2,
        effects: tier2Effects
      });

      for (let branch = 1; branch <= 2; branch++) {
        const col = (lane - 1) * 2 + branch;
        const tier3Id = `line_${line.key}_t3_${lane}_${branch}`;
        const tier4Id = `line_${line.key}_t4_${lane}_${branch}`;
        const tier5Id = `line_${line.key}_t5_${lane}_${branch}`;
        out.push({
          id: tier3Id,
          name: line.key === 'metal'
            ? (lane === 1
              ? (branch === 1 ? '金途三重·凝锋' : '金途三重·锐意')
              : lane === 2
                ? (branch === 1 ? '金途三重·裂甲' : '金途三重·透骨')
                : (branch === 1 ? '金途三重·饮刃' : '金途三重·回虹'))
            : line.key === 'fire'
            ? (lane === 1
              ? (branch === 1 ? '火途三重·炽轮' : '火途三重·焰涨')
              : lane === 2
                ? (branch === 1 ? '火途三重·灼心' : '火途三重·焚瞳')
                : (branch === 1 ? '火途三重·熔穿' : '火途三重·炎蚀'))
            : line.key === 'water'
            ? (lane === 1
              ? (branch === 1 ? '水途三重·寒潮' : '水途三重·镜澜')
              : lane === 2
                ? (branch === 1 ? '水途三重·灵沫' : '水途三重·沁流')
                : (branch === 1 ? '水途三重·玄渊' : '水途三重·润息'))
            : line.key === 'wood'
            ? (lane === 1
              ? (branch === 1 ? '木途三重·森锋' : '木途三重·青魄')
              : lane === 2
                ? (branch === 1 ? '木途三重·回芽' : '木途三重·养脉')
                : (branch === 1 ? '木途三重·蚀叶' : '木途三重·蔓毒'))
            : line.key === 'neutral'
            ? (lane === 1
              ? (branch === 1 ? '无途三重·清歌' : '无途三重·回音')
              : lane === 2
                ? (branch === 1 ? '无途三重·定心' : '无途三重·合拍')
                : (branch === 1 ? '无途三重·守律' : '无途三重·长鸣'))
            : line.key === 'hunyuan'
            ? (lane === 1
              ? (branch === 1 ? '混途三重·剑意' : '混途三重·合锋')
              : lane === 2
                ? (branch === 1 ? '混途三重·并脉' : '混途三重·通玄')
                : (branch === 1 ? '混途三重·固元' : '混途三重·归一'))
            : line.key === 'earth'
            ? (lane === 1
              ? (branch === 1 ? '土途三重·磐甲' : '土途三重·灵垒')
              : lane === 2
                ? (branch === 1 ? '土途三重·震岳' : '土途三重·迅反')
                : (branch === 1 ? '土途三重·镇脉' : '土途三重·裂甲'))
            : `${line.label}途三重·${lane}-${branch}`,
          cost: 2,
          max_level: 1,
          requires: [tier2Id],
          line: line.key,
          row: 3,
          col,
          effects: (() => {
            if (line.key === 'metal') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_crit_rate_per_level', values: [0.01] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_crit_rate_per_level', values: [0.006] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.012] }
              ];
              if (lane === 2 && branch === 1) return [{ type: 'destiny_physical_armor_pen_per_level', values: [0.016] }];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_physical_armor_pen_per_level', values: [0.011] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.01] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_phys_lifesteal_per_level', values: [0.008] }];
              return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.005] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.008] }
              ];
            }
            if (line.key === 'fire') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_spell_attack_pct_per_level', values: [0.04] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.025] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.005] }
              ];
              if (lane === 2 && branch === 1) return [{ type: 'destiny_spell_crit_rate_per_level', values: [0.015] }];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.009] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.014] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_spell_armor_pen_per_level', values: [0.04] }];
              return [
                { type: 'destiny_spell_armor_pen_per_level', values: [0.02] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.02] }
              ];
            }
            if (line.key === 'water') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_defense_pct_per_level', values: [0.024] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_defense_pct_per_level', values: [0.03] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.012] }
              ];
              if (lane === 2 && branch === 1) return [{ type: 'destiny_heal_bonus_per_level', values: [0.10] }];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_heal_bonus_per_level', values: [0.06] },
                { type: 'destiny_defense_pct_per_level', values: [0.012] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_spell_damage_reduction_per_level', values: [0.028] }];
              return [
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.02] },
                { type: 'destiny_spell_defense_pct_per_level', values: [0.018] }
              ];
            }
            if (line.key === 'wood') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_damage_pct_per_level', values: [0.016] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.01] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.01] }
              ];
              if (lane === 2 && branch === 1) return [{ type: 'destiny_phys_lifesteal_per_level', values: [0.008] }];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.005] },
                { type: 'destiny_defense_pct_per_level', values: [0.012] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_dot_damage_pct_per_level', values: [0.05] }];
              return [
                { type: 'destiny_wood_dot_damage_pct_per_level', values: [0.07] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.008] }
              ];
            }
            if (line.key === 'neutral') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_spell_attack_pct_per_level', values: [0.034] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.021] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.004] }
              ];
              if (lane === 2 && branch === 1) return [{ type: 'destiny_spell_crit_rate_per_level', values: [0.01] }];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.006] },
                { type: 'destiny_phys_crit_rate_per_level', values: [0.005] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_spell_defense_pct_per_level', values: [0.024] }];
              return [
                { type: 'destiny_spell_armor_pen_per_level', values: [0.008] },
                { type: 'destiny_defense_pct_per_level', values: [0.012] }
              ];
            }
            if (line.key === 'hunyuan') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_damage_pct_per_level', values: [0.02] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.012] },
                { type: 'destiny_phys_crit_rate_per_level', values: [0.005] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_phys_crit_rate_per_level', values: [0.008] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.008] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.015] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.008] }
              ];
              if (lane === 3 && branch === 1) return [{ type: 'destiny_defense_pct_per_level', values: [0.024] }];
              return [
                { type: 'destiny_physical_armor_pen_per_level', values: [0.008] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.008] },
                { type: 'destiny_defense_pct_per_level', values: [0.01] }
              ];
            }
            if (line.key !== 'earth') return [{ type: 'placeholder_tier3', value: 0 }];
            if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_defense_pct_per_level', values: [0.03] }];
            if (lane === 1 && branch === 2) return [{ type: 'destiny_spell_defense_pct_per_level', values: [0.03] }];
            if (lane === 2 && branch === 1) return [{ type: 'destiny_counter_coeff_per_level', values: [0.05] }];
            if (lane === 2 && branch === 2) return [{ type: 'destiny_counter_chance_per_level', values: [0.03] }];
            if (lane === 3 && branch === 1) return [{ type: 'destiny_phys_hit_target_max_hp_extra_pct_per_level', values: [0.008] }];
            return [{ type: 'destiny_phys_hit_self_def_extra_pct_per_level', values: [0.10] }];
          })()
        });
        out.push({
          id: tier4Id,
          name: line.key === 'metal'
            ? (lane === 1
              ? (branch === 1 ? '金途四重·会心' : '金途四重·猎弱')
              : lane === 2
                ? (branch === 1 ? '金途四重·破阵' : '金途四重·断甲')
                : (branch === 1 ? '金途四重·饮魄' : '金途四重·归元'))
            : line.key === 'fire'
            ? (lane === 1
              ? (branch === 1 ? '火途四重·燎原' : '火途四重·焰契')
              : lane === 2
                ? (branch === 1 ? '火途四重·赤曜' : '火途四重·灼界')
                : (branch === 1 ? '火途四重·熔锋' : '火途四重·烬护'))
            : line.key === 'water'
            ? (lane === 1
              ? (branch === 1 ? '水途四重·澄魄' : '水途四重·玄幕')
              : lane === 2
                ? (branch === 1 ? '水途四重·湛吟' : '水途四重·凝锋')
                : (branch === 1 ? '水途四重·寒垣' : '水途四重·归澜'))
            : line.key === 'wood'
            ? (lane === 1
              ? (branch === 1 ? '木途四重·枯荣' : '木途四重·裂枝')
              : lane === 2
                ? (branch === 1 ? '木途四重·生汲' : '木途四重·护芽')
                : (branch === 1 ? '木途四重·蚀心' : '木途四重·噬灵'))
            : line.key === 'neutral'
            ? (lane === 1
              ? (branch === 1 ? '无途四重·清越' : '无途四重·和弦')
              : lane === 2
                ? (branch === 1 ? '无途四重·定魄' : '无途四重·破音')
                : (branch === 1 ? '无途四重·宁息' : '无途四重·余律'))
            : line.key === 'hunyuan'
            ? (lane === 1
              ? (branch === 1 ? '混途四重·斩意' : '混途四重·并锋')
              : lane === 2
                ? (branch === 1 ? '混途四重·流转' : '混途四重·归鞘')
                : (branch === 1 ? '混途四重·守真' : '混途四重·合一'))
            : line.key === 'earth'
            ? (lane === 1
              ? (branch === 1 ? '土途四重·铁壁' : '土途四重·玄障')
              : lane === 2
                ? (branch === 1 ? '土途四重·回戈' : '土途四重·应机')
                : (branch === 1 ? '土途四重·断岳' : '土途四重·崩锋'))
            : `${line.label}途四重·${lane}-${branch}`,
          cost: 2,
          max_level: 1,
          requires: [tier3Id],
          line: line.key,
          row: 4,
          col,
          effects: (() => {
            if (line.key === 'metal') {
              if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_crit_mult_per_level', values: [0.05] }];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_crit_rate_per_level', values: [0.006] },
                { type: 'destiny_phys_execute_bonus_max_per_level', values: [0.03] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_physical_armor_pen_per_level', values: [0.015] },
                { type: 'destiny_phys_extra_strike_chance_per_level', values: [0.06] },
                { type: 'destiny_phys_extra_strike_damage_pct_per_level', values: [0.05] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_physical_armor_pen_per_level', values: [0.016] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.01] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.006] },
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.02] }
              ];
              return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.005] },
                { type: 'destiny_counter_heal_ratio_per_level', values: [0.06] }
              ];
            }
            if (line.key === 'fire') {
              if (lane === 1 && branch === 1) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.035] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.02] }
              ];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.022] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.006] },
                { type: 'destiny_spell_crit_mult_per_level', values: [0.04] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.01] },
                { type: 'destiny_spell_crit_mult_per_level', values: [0.06] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.007] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.0175] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_spell_armor_pen_per_level', values: [0.035] },
                { type: 'destiny_spell_crit_mult_per_level', values: [0.03] }
              ];
              return [
                { type: 'destiny_spell_armor_pen_per_level', values: [0.015] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.015] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.025] }
              ];
            }
            if (line.key === 'water') {
              if (lane === 1 && branch === 1) return [
                { type: 'destiny_defense_pct_per_level', values: [0.032] },
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.02] }
              ];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_defense_pct_per_level', values: [0.032] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.02] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_heal_bonus_per_level', values: [0.12] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.015] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_heal_bonus_per_level', values: [0.08] },
                { type: 'destiny_defense_pct_per_level', values: [0.015] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.03] },
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.02] }
              ];
              return [
                { type: 'destiny_heal_bonus_per_level', values: [0.06] },
                { type: 'destiny_spell_defense_pct_per_level', values: [0.02] },
                { type: 'destiny_defense_pct_per_level', values: [0.01] }
              ];
            }
            if (line.key === 'wood') {
              if (lane === 1 && branch === 1) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.018] },
                { type: 'destiny_phys_crit_rate_per_level', values: [0.004] }
              ];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.012] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.012] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.008] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.01] },
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.015] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_phys_lifesteal_per_level', values: [0.006] },
                { type: 'destiny_defense_pct_per_level', values: [0.015] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_dot_damage_pct_per_level', values: [0.07] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.01] }
              ];
              return [
                { type: 'destiny_wood_dot_damage_pct_per_level', values: [0.10] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.012] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.01] }
              ];
            }
            if (line.key === 'neutral') {
              if (lane === 1 && branch === 1) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.028] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.02] }
              ];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_spell_attack_pct_per_level', values: [0.018] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.005] },
                { type: 'destiny_spell_crit_mult_per_level', values: [0.03] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.009] },
                { type: 'destiny_spell_defense_pct_per_level', values: [0.018] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_spell_crit_rate_per_level', values: [0.006] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.012] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_spell_defense_pct_per_level', values: [0.03] },
                { type: 'destiny_defense_pct_per_level', values: [0.012] }
              ];
              return [
                { type: 'destiny_spell_armor_pen_per_level', values: [0.01] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.012] },
                { type: 'destiny_spell_damage_reduction_per_level', values: [0.015] }
              ];
            }
            if (line.key === 'hunyuan') {
              if (lane === 1 && branch === 1) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.018] },
                { type: 'destiny_phys_crit_mult_per_level', values: [0.03] }
              ];
              if (lane === 1 && branch === 2) return [
                { type: 'destiny_phys_damage_pct_per_level', values: [0.012] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.012] },
                { type: 'destiny_phys_crit_rate_per_level', values: [0.004] }
              ];
              if (lane === 2 && branch === 1) return [
                { type: 'destiny_phys_crit_rate_per_level', values: [0.007] },
                { type: 'destiny_spell_crit_rate_per_level', values: [0.007] },
                { type: 'destiny_spell_crit_mult_per_level', values: [0.02] }
              ];
              if (lane === 2 && branch === 2) return [
                { type: 'destiny_physical_armor_pen_per_level', values: [0.01] },
                { type: 'destiny_spell_armor_pen_per_level', values: [0.01] },
                { type: 'destiny_defense_pct_per_level', values: [0.008] }
              ];
              if (lane === 3 && branch === 1) return [
                { type: 'destiny_defense_pct_per_level', values: [0.022] },
                { type: 'destiny_phys_damage_reduction_per_level', values: [0.015] }
              ];
              return [
                { type: 'destiny_defense_pct_per_level', values: [0.015] },
                { type: 'destiny_phys_damage_pct_per_level', values: [0.01] },
                { type: 'destiny_spell_attack_pct_per_level', values: [0.01] }
              ];
            }
            if (line.key !== 'earth') return [{ type: 'placeholder_tier4', value: 0 }];
            if (lane === 1 && branch === 1) return [{ type: 'destiny_phys_damage_reduction_per_level', values: [0.05] }];
            if (lane === 1 && branch === 2) return [{ type: 'destiny_spell_damage_reduction_per_level', values: [0.05] }];
            if (lane === 2 && branch === 1) return [{ type: 'destiny_counter_heal_ratio_per_level', values: [0.12] }];
            if (lane === 2 && branch === 2) return [{ type: 'destiny_counter_skill_hit_chance_bonus_per_level', values: [0.08] }];
            if (lane === 3 && branch === 1) return [{ type: 'destiny_phys_execute_bonus_max_per_level', values: [0.06] }];
            return [
              { type: 'destiny_phys_extra_strike_chance_per_level', values: [0.18] },
              { type: 'destiny_phys_extra_strike_damage_pct_per_level', values: [0.12] }
            ];
          })()
        });
        out.push({
          id: tier5Id,
          name: line.key === 'earth' && lane === 3 && branch === 1
            ? '土途五重·伏魔神途'
            : line.key === 'earth' && lane === 2 && branch === 1
              ? '土途五重·破障神途'
            : line.key === 'earth' && lane === 2 && branch === 2
              ? '土途五重·业报神途'
            : line.key === 'metal' && lane === 2 && branch === 1
              ? '金途五重·斩魔神途'
            : line.key === 'metal' && lane === 2 && branch === 2
              ? '金途五重·七杀神途'
            : line.key === 'wood' && lane === 1 && branch === 2
              ? '木途五重·血缚神途'
            : line.key === 'water' && lane === 3 && branch === 2
              ? '水途五重·潮生神途'
            : line.key === 'wood' && lane === 3 && branch === 2
              ? '木途五重·枯荣神途'
            : line.key === 'fire' && lane === 3 && branch === 1
              ? '火途五重·焚界神途'
            : line.key === 'hunyuan' && lane === 3 && branch === 2
              ? '混途五重·归一神途'
            : line.key === 'neutral' && lane === 1 && branch === 2
              ? '无途五重·太玄神途'
            : line.key === 'neutral' && lane === 3 && branch === 2
              ? '无途五重·太虚神途'
            : `${line.label}途五重·${lane}-${branch}`,
          cost: 2,
          max_level: 1,
          requires: [tier4Id],
          line: line.key,
          row: 5,
          col,
          effects: (() => {
            if (line.key === 'earth' && lane === 3 && branch === 1) {
              return [{ type: 'destiny_fumo_shentu_per_level', values: [1] }];
            }
            if (line.key === 'earth' && lane === 2 && branch === 1) {
              return [{ type: 'destiny_poshang_shentu_per_level', values: [1] }];
            }
            if (line.key === 'earth' && lane === 2 && branch === 2) {
              return [{ type: 'destiny_yebao_shentu_per_level', values: [1] }];
            }
            if (line.key === 'metal' && lane === 2 && branch === 1) {
              return [{ type: 'destiny_zhanmo_shentu_per_level', values: [1] }];
            }
            if (line.key === 'metal' && lane === 2 && branch === 2) {
              return [{ type: 'destiny_qisha_shentu_per_level', values: [1] }];
            }
            if (line.key === 'wood' && lane === 1 && branch === 2) {
              return [{ type: 'destiny_xuefu_shentu_per_level', values: [1] }];
            }
            if (line.key === 'water' && lane === 3 && branch === 2) {
              return [{ type: 'destiny_chaosheng_shentu_per_level', values: [0.18] }];
            }
            if (line.key === 'wood' && lane === 3 && branch === 2) {
              return [{ type: 'destiny_kurong_shentu_per_level', values: [0.22] }];
            }
            if (line.key === 'fire' && lane === 3 && branch === 1) {
              return [{ type: 'destiny_fenjie_shentu_per_level', values: [1] }];
            }
            if (line.key === 'hunyuan' && lane === 3 && branch === 2) {
              return [{ type: 'destiny_guiyi_shentu_per_level', values: [1] }];
            }
            if (line.key === 'neutral' && lane === 1 && branch === 2) {
              return [{ type: 'destiny_taixuan_shentu_per_level', values: [1] }];
            }
            if (line.key === 'neutral' && lane === 3 && branch === 2) {
              return [{ type: 'destiny_taixu_shentu_per_level', values: [1] }];
            }
            return [{ type: 'placeholder_tier5', value: 0 }];
          })()
        });
      }
    }
  }
  return out;
}

const TALENT_NODES = buildMingtuNodes();

const TALENT_NODE_MAP = Object.fromEntries(TALENT_NODES.map((n) => [String(n.id), n]));

function isTier3NodeId(nodeId) {
  return /(^tier3_|^tier4_|^tier5_|_t3_|_t4_|_t5_)/.test(String(nodeId || ''));
}

function isTier5Node(node) {
  return intVal(node?.row, 0) === 5;
}

function isUnimplementedNode(node) {
  const effects = Array.isArray(node?.effects) ? node.effects : [];
  if (effects.length <= 0) return true;
  return effects.every((eff) => String(eff?.type || '').startsWith('placeholder_'));
}

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function numVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function calcTalentPointsByLevel(level) {
  const lv = Math.max(1, intVal(level, 1));
  if (lv < 121) return 0;
  let points = 1 + Math.floor((Math.min(lv, 399) - 121) / 10);
  if (lv >= 400) points += 1; // 401 不存在，最后一个点在 400 发放
  return Math.max(0, points);
}

function ensureTalentState(player) {
  if (!player || typeof player !== 'object') return;
  // 新结构使用 destiny，旧存档 talents 自动兼容迁移。
  if (!player.destiny || typeof player.destiny !== 'object' || Array.isArray(player.destiny)) {
    if (player.talents && typeof player.talents === 'object' && !Array.isArray(player.talents)) {
      player.destiny = JSON.parse(JSON.stringify(player.talents));
    } else {
      player.destiny = {};
    }
  }
  const t = player.destiny;
  const rawAvailablePoints = Math.max(0, intVal(t.available_points, 0));
  const legacySpentFromNodes = (() => {
    const rawUnlocked = (t.unlocked_nodes && typeof t.unlocked_nodes === 'object' && !Array.isArray(t.unlocked_nodes))
      ? t.unlocked_nodes
      : {};
    let spent = 0;
    for (const key of Object.keys(rawUnlocked)) {
      const node = TALENT_NODE_MAP[key];
      if (!node) continue;
      const maxLv = Math.max(1, intVal(node.max_level, 1));
      let lv = intVal(rawUnlocked[key], 0);
      if (lv <= 0 && Boolean(rawUnlocked[key])) lv = 1;
      lv = Math.min(maxLv, Math.max(0, lv));
      if (lv <= 0) continue;
      const costs = Array.isArray(node.cost_per_level) ? node.cost_per_level : null;
      if (costs) {
        for (let i = 0; i < lv; i++) spent += Math.max(1, intVal(costs[i], 1));
      } else {
        spent += lv * Math.max(1, intVal(node.cost, 1));
      }
    }
    return spent;
  })();
  const previousPointTotal = Math.max(
    0,
    intVal(t.points_spent, 0) + rawAvailablePoints,
    legacySpentFromNodes + rawAvailablePoints
  );
  t.points_earned = Math.max(0, intVal(t.points_earned, 0));
  t.available_points = Math.max(0, intVal(t.available_points, 0));
  if (!t.unlocked_nodes || typeof t.unlocked_nodes !== 'object' || Array.isArray(t.unlocked_nodes)) {
    t.unlocked_nodes = {};
  }
  // 清理不存在节点，防止脏数据
  const candidates = {};
  for (const key of Object.keys(t.unlocked_nodes)) {
    const node = TALENT_NODE_MAP[key];
    if (!node) continue;
    const maxLv = Math.max(1, intVal(node.max_level, 1));
    let lv = intVal(t.unlocked_nodes[key], 0);
    if (lv <= 0 && Boolean(t.unlocked_nodes[key])) lv = 1; // 兼容旧版 bool
    if (lv > 0) candidates[key] = Math.min(maxLv, lv);
  }
  const cleaned = {};
  const orderedIds = Object.keys(candidates).sort((a, b) => {
    const ra = intVal(TALENT_NODE_MAP[a]?.row, 0);
    const rb = intVal(TALENT_NODE_MAP[b]?.row, 0);
    if (ra !== rb) return ra - rb;
    return String(a).localeCompare(String(b));
  });
  for (const key of orderedIds) {
    const node = TALENT_NODE_MAP[key];
    if (!node || isUnimplementedNode(node)) continue;
    const requires = Array.isArray(node.requires) ? node.requires : [];
    let ok = true;
    for (const reqId of requires) {
      const reqKey = String(reqId);
      const reqLv = intVal(cleaned[reqKey], 0);
      if (reqLv <= 0) { ok = false; break; }
      const reqNode = TALENT_NODE_MAP[reqKey];
      const reqMaxLv = Math.max(1, intVal(reqNode?.max_level, 1));
      if (reqLv < reqMaxLv) { ok = false; break; }
    }
    if (!ok) continue;
    cleaned[key] = candidates[key];
  }
  t.unlocked_nodes = cleaned;
  let spent = 0;
  for (const key of Object.keys(cleaned)) {
    const node = TALENT_NODE_MAP[key];
    const lv = Math.max(0, intVal(cleaned[key], 0));
    const costs = Array.isArray(node?.cost_per_level) ? node.cost_per_level : null;
    if (costs && lv > 0) {
      for (let i = 0; i < lv; i++) spent += Math.max(1, intVal(costs[i], 1));
    } else {
      spent += lv * Math.max(1, intVal(node?.cost, 1));
    }
  }
  t.points_spent = spent;
  if (previousPointTotal > 0) {
    t.available_points = Math.max(0, previousPointTotal - spent);
  }
  const earnedBasedAvailable = Math.max(0, intVal(t.points_earned, 0) - spent);
  if (earnedBasedAvailable > intVal(t.available_points, 0)) {
    t.available_points = earnedBasedAvailable;
  }
  // 可用点不足时保底 0，不倒扣
  t.available_points = Math.max(0, t.available_points);
  player.destiny = t;
  // 兼容旧前端字段读取
  player.talents = player.destiny;
}

function grantTalentPointsForLevel(player) {
  ensureTalentState(player);
  const t = player.destiny;
  const shouldEarn = calcTalentPointsByLevel(player?.level);
  if (shouldEarn > t.points_earned) {
    const delta = shouldEarn - t.points_earned;
    t.points_earned = shouldEarn;
    t.available_points = Math.max(0, intVal(t.available_points, 0) + delta);
  }
  // 防止历史脏数据：earned 至少不小于 spent + available（但不回收已得点）
  const minEarned = intVal(t.points_spent, 0) + intVal(t.available_points, 0);
  if (t.points_earned < minEarned) t.points_earned = minEarned;
  player.destiny = t;
  player.talents = player.destiny;
  return t;
}

/** 获取节点所在线路上的所有节点 id（含自身及前置），第一行 core 算入所有线路 */
function getNodeLineIds(nodeId) {
  const id = String(nodeId || '').trim();
  const node = TALENT_NODE_MAP[id];
  if (!node) return [];
  const requires = Array.isArray(node.requires) ? node.requires : [];
  const out = new Set([id]);
  for (const reqId of requires) {
    for (const rid of getNodeLineIds(reqId)) out.add(rid);
  }
  return Array.from(out);
}

/** 计算玩家在指定线路上已消耗的精进点数 */
function getLineSpent(t, lineIds) {
  let spent = 0;
  for (const nid of lineIds) {
    const node = TALENT_NODE_MAP[nid];
    if (!node) continue;
    const lv = Math.max(0, intVal(t.unlocked_nodes[nid], 0));
    if (lv <= 0) continue;
    const costs = Array.isArray(node.cost_per_level) ? node.cost_per_level : null;
    if (costs && lv > 0) {
      for (let i = 0; i < lv; i++) spent += Math.max(1, intVal(costs[i], 1));
    } else {
      spent += lv * Math.max(1, intVal(node.cost, 1));
    }
  }
  return spent;
}

function unlockTalentNode(player, nodeId) {
  ensureTalentState(player);
  grantTalentPointsForLevel(player);
  const id = String(nodeId || '').trim();
  const node = TALENT_NODE_MAP[id];
  if (!node) return { ok: false, error: '命途节点不存在' };
  const t = player.destiny;
  const maxLevel = Math.max(1, intVal(node.max_level, 1));
  const curLevel = Math.max(0, intVal(t.unlocked_nodes[id], 0));
  if (curLevel >= maxLevel) return { ok: false, error: '该命途已达到最高等级' };
  if (isTier5Node(node) && curLevel <= 0) {
    for (const unlockedId of Object.keys(t.unlocked_nodes || {})) {
      if (String(unlockedId) === id) continue;
      if (intVal(t.unlocked_nodes[unlockedId], 0) <= 0) continue;
      const unlockedNode = TALENT_NODE_MAP[String(unlockedId)];
      if (isTier5Node(unlockedNode)) {
        return { ok: false, error: '终极命途全系共鸣：第五层最多只能选择一个' };
      }
    }
  }
  const requires = Array.isArray(node.requires) ? node.requires : [];
  for (const reqId of requires) {
    const reqNode = TALENT_NODE_MAP[String(reqId)];
    const reqLv = intVal(t.unlocked_nodes[String(reqId)], 0);
    if (reqLv <= 0) return { ok: false, error: '前置命途未解锁' };
    const reqMaxLv = Math.max(1, intVal(reqNode?.max_level, 1));
    if (reqLv < reqMaxLv) return { ok: false, error: '需先将上一层命途点满，方可解锁下一层' };
  }
  if (isUnimplementedNode(node)) return { ok: false, error: '该命途尚未实装，暂不可解锁' };
  const reqLineSpent = intVal(node.requires_line_spent, 0);
  if (reqLineSpent > 0) {
    const lineIds = getNodeLineIds(id);
    const lineSpent = getLineSpent(t, lineIds);
    if (lineSpent < reqLineSpent) return { ok: false, error: `本条线路已用命途点不足（需${reqLineSpent}点，当前${lineSpent}点）` };
  }
  const costs = Array.isArray(node.cost_per_level) ? node.cost_per_level : null;
  const cost = costs && curLevel < costs.length ? Math.max(1, intVal(costs[curLevel], 1)) : Math.max(1, intVal(node.cost, 1));
  if (intVal(t.available_points, 0) < cost) return { ok: false, error: '命途点不足' };
  t.unlocked_nodes[id] = curLevel + 1;
  t.available_points = Math.max(0, intVal(t.available_points, 0) - cost);
  ensureTalentState(player);
  return { ok: true, player, node_id: id, node_level: intVal(player.destiny?.unlocked_nodes?.[id], curLevel + 1) };
}

function resetTalentNodes(player) {
  ensureTalentState(player);
  grantTalentPointsForLevel(player);
  const t = player.destiny;
  const refundable = Math.max(0, intVal(t.points_spent, 0) + intVal(t.available_points, 0));
  t.unlocked_nodes = {};
  t.points_spent = 0;
  t.available_points = refundable;
  ensureTalentState(player);
  return { ok: true, player, refunded_points: refundable };
}

function getTalentAttributeBonus(player) {
  ensureTalentState(player);
  const out = { strength: 0, constitution: 0, bone: 0, agility: 0, zhenyuan: 0, lingli: 0 };
  const unlocked = player?.destiny?.unlocked_nodes || {};
  for (const nodeId of Object.keys(unlocked)) {
    if (isTier3NodeId(nodeId)) continue;
    const level = Math.max(0, intVal(unlocked[nodeId], 0));
    if (level <= 0) continue;
    const node = TALENT_NODE_MAP[nodeId];
    if (!node) continue;
    for (const eff of node.effects || []) {
      if (String(eff?.type || '') !== 'all_attr_flat_per_level') continue;
      const v = Math.max(0, intVal(eff?.value, 0)) * level;
      out.strength += v;
      out.constitution += v;
      out.bone += v;
      out.agility += v;
      out.zhenyuan += v;
      out.lingli += v;
    }
  }
  return out;
}

/** 命途分支提供的是元素亲和（对应属性伤害/回复加成），不是灵根。 */
function getTalentElementAffinityBonus(player) {
  ensureTalentState(player);
  const out = { metal: 0, wood: 0, water: 0, fire: 0, earth: 0, hunyuan: 0, neutral: 0 };
  const unlocked = player?.destiny?.unlocked_nodes || {};
  const ROOT_KEYS = ['metal', 'wood', 'water', 'fire', 'earth', 'hunyuan', 'neutral'];
  for (const nodeId of Object.keys(unlocked)) {
    if (isTier3NodeId(nodeId)) continue;
    const level = Math.max(0, intVal(unlocked[nodeId], 0));
    if (level <= 0) continue;
    const node = TALENT_NODE_MAP[nodeId];
    if (!node) continue;
    for (const eff of node.effects || []) {
      const et = String(eff?.type || '');
      const vals = Array.isArray(eff?.values) ? eff.values : [3, 8, 15];
      const v = level > 0 && vals.length >= level ? Math.max(0, intVal(vals[level - 1], 0)) : 0;
      if (et === 'element_affinity_per_level') {
        const rt = String(eff?.rootType || '').trim();
        if (ROOT_KEYS.includes(rt)) out[rt] += v;
      }
    }
  }
  return out;
}

function getTalentCombatBonus(player) {
  ensureTalentState(player);
  const out = {
    phys_crit_rate_bonus: 0,
    phys_crit_mult_bonus: 0,
    spell_crit_rate_bonus: 0,
    spell_crit_mult_bonus: 0,
    physical_armor_pen_bonus: 0,
    spell_armor_pen_bonus: 0,
    phys_lifesteal_bonus: 0,
    spell_attack_pct_bonus: 0,
    defense_pct_bonus: 0,
    phys_defense_pct_bonus: 0,
    spell_defense_pct_bonus: 0,
    counter_chance_bonus: 0,
    counter_coeff_bonus: 0,
    phys_damage_pct_bonus: 0,
    phys_hit_target_max_hp_extra_pct_bonus: 0,
    phys_hit_self_def_extra_pct_bonus: 0,
    phys_damage_reduction_bonus: 0,
    spell_damage_reduction_bonus: 0,
    heal_bonus: 0,
    counter_heal_ratio_bonus: 0,
    counter_skill_hit_chance_bonus: 0,
    phys_execute_bonus_max: 0,
    phys_extra_strike_chance_bonus: 0,
    phys_extra_strike_damage_pct_bonus: 0,
    dot_damage_pct_bonus: 0,
    wood_dot_damage_pct_bonus: 0,
    fumo_shentu_active: 0,
    poshang_shentu_active: 0,
    yebao_shentu_active: 0,
    zhanmo_shentu_active: 0,
    qisha_shentu_active: 0,
    xuefu_shentu_active: 0,
    chaosheng_shentu_active: 0,
    kurong_shentu_active: 0,
    fenjie_shentu_active: 0,
    guiyi_shentu_active: 0,
    taixuan_shentu_active: 0,
    taixu_shentu_active: 0
  };
  const unlocked = player?.destiny?.unlocked_nodes || {};
  for (const nodeId of Object.keys(unlocked)) {
    const level = Math.max(0, intVal(unlocked[nodeId], 0));
    if (level <= 0) continue;
    const node = TALENT_NODE_MAP[nodeId];
    if (!node) continue;
    for (const eff of node.effects || []) {
      const et = String(eff?.type || '');
      const vals = Array.isArray(eff?.values) ? eff.values : [];
      const v = level > 0 && vals.length >= level ? Math.max(0, numVal(vals[level - 1], 0)) : 0;
      if (et === 'destiny_phys_crit_rate_per_level') {
        out.phys_crit_rate_bonus += v;
      } else if (et === 'destiny_phys_crit_mult_per_level') {
        out.phys_crit_mult_bonus += v;
      } else if (et === 'destiny_spell_crit_rate_per_level') {
        out.spell_crit_rate_bonus += v;
      } else if (et === 'destiny_spell_crit_mult_per_level') {
        out.spell_crit_mult_bonus += v;
      } else if (et === 'destiny_physical_armor_pen_per_level') {
        out.physical_armor_pen_bonus += v;
      } else if (et === 'destiny_spell_armor_pen_per_level') {
        out.spell_armor_pen_bonus += v;
      } else if (et === 'destiny_phys_lifesteal_per_level') {
        out.phys_lifesteal_bonus += v;
      } else if (et === 'destiny_spell_attack_pct_per_level') {
        out.spell_attack_pct_bonus += v;
      } else if (et === 'destiny_defense_pct_per_level') {
        out.defense_pct_bonus += v;
      } else if (et === 'destiny_phys_defense_pct_per_level') {
        out.phys_defense_pct_bonus += v;
      } else if (et === 'destiny_spell_defense_pct_per_level') {
        out.spell_defense_pct_bonus += v;
      } else if (et === 'destiny_counter_chance_per_level') {
        out.counter_chance_bonus += v;
      } else if (et === 'destiny_counter_coeff_per_level') {
        out.counter_coeff_bonus += v;
      } else if (et === 'destiny_phys_damage_pct_per_level') {
        out.phys_damage_pct_bonus += v;
      } else if (et === 'destiny_phys_hit_target_max_hp_extra_pct_per_level') {
        out.phys_hit_target_max_hp_extra_pct_bonus += v;
      } else if (et === 'destiny_phys_hit_self_def_extra_pct_per_level') {
        out.phys_hit_self_def_extra_pct_bonus += v;
      } else if (et === 'destiny_phys_damage_reduction_per_level') {
        out.phys_damage_reduction_bonus += v;
      } else if (et === 'destiny_spell_damage_reduction_per_level') {
        out.spell_damage_reduction_bonus += v;
      } else if (et === 'destiny_heal_bonus_per_level') {
        out.heal_bonus += v;
      } else if (et === 'destiny_counter_heal_ratio_per_level') {
        out.counter_heal_ratio_bonus += v;
      } else if (et === 'destiny_counter_skill_hit_chance_bonus_per_level') {
        out.counter_skill_hit_chance_bonus += v;
      } else if (et === 'destiny_phys_execute_bonus_max_per_level') {
        out.phys_execute_bonus_max += v;
      } else if (et === 'destiny_phys_extra_strike_chance_per_level') {
        out.phys_extra_strike_chance_bonus += v;
      } else if (et === 'destiny_phys_extra_strike_damage_pct_per_level') {
        out.phys_extra_strike_damage_pct_bonus += v;
      } else if (et === 'destiny_dot_damage_pct_per_level') {
        out.dot_damage_pct_bonus += v;
      } else if (et === 'destiny_wood_dot_damage_pct_per_level') {
        out.wood_dot_damage_pct_bonus += v;
      } else if (et === 'destiny_fumo_shentu_per_level') {
        out.fumo_shentu_active = 1;
      } else if (et === 'destiny_poshang_shentu_per_level') {
        out.poshang_shentu_active = 1;
      } else if (et === 'destiny_yebao_shentu_per_level') {
        out.yebao_shentu_active = 1;
      } else if (et === 'destiny_zhanmo_shentu_per_level') {
        out.zhanmo_shentu_active = 1;
      } else if (et === 'destiny_qisha_shentu_per_level') {
        out.qisha_shentu_active = 1;
      } else if (et === 'destiny_xuefu_shentu_per_level') {
        out.xuefu_shentu_active = 1;
      } else if (et === 'destiny_chaosheng_shentu_per_level') {
        out.chaosheng_shentu_active = 1;
        out.heal_bonus += v;
      } else if (et === 'destiny_kurong_shentu_per_level') {
        out.kurong_shentu_active = 1;
        out.dot_damage_pct_bonus += v;
      } else if (et === 'destiny_fenjie_shentu_per_level') {
        out.fenjie_shentu_active = 1;
      } else if (et === 'destiny_guiyi_shentu_per_level') {
        out.guiyi_shentu_active = 1;
      } else if (et === 'destiny_taixuan_shentu_per_level') {
        out.taixuan_shentu_active = 1;
      } else if (et === 'destiny_taixu_shentu_per_level') {
        out.taixu_shentu_active = 1;
      }
    }
  }
  return out;
}

module.exports = {
  TALENT_NODES,
  calcTalentPointsByLevel,
  ensureTalentState,
  grantTalentPointsForLevel,
  unlockTalentNode,
  resetTalentNodes,
  getTalentAttributeBonus,
  getTalentElementAffinityBonus,
  getTalentCombatBonus
};
