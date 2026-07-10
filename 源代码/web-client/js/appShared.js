export const REALMS = [
  { min: 1, max: 40, name: '练气' }, { min: 41, max: 80, name: '练气' },
  { min: 81, max: 120, name: '练气' }, { min: 121, max: 160, name: '筑基' },
  { min: 161, max: 200, name: '金丹' }, { min: 201, max: 240, name: '元婴' },
  { min: 241, max: 280, name: '化神' }, { min: 281, max: 320, name: '炼虚' },
];

export function getRealm(lv) {
  for (const r of REALMS) {
    if (lv >= r.min && lv <= r.max) return r.name;
  }
  return '炼虚';
}

/** 等级→境界阶级(1-6)，与后端 combatUtils.getRealmQualityFromLevel 一致，用于传人探索限制 */
export function getRealmTier(lv) {
  const l = Math.max(1, Math.floor(Number(lv) || 1));
  if (l <= 120) return 1;
  if (l <= 160) return 2;
  if (l <= 200) return 3;
  if (l <= 240) return 4;
  if (l <= 280) return 5;
  return 6;
}

export function getRealmStage(lv) {
  const realm = getRealm(lv);
  if (realm === '练气' && lv >= 1 && lv <= 120) {
    const layer = Math.min(12, Math.ceil(lv / 10));
    return layer + '层';
  }
  const stages = ['初期', '中期', '后期', '圆满'];
  const r = REALMS.find(x => lv >= x.min && lv <= x.max);
  if (!r) return '圆满';
  const idx = Math.min(3, Math.floor((lv - r.min) / ((r.max - r.min + 1) / 4)));
  return stages[idx];
}

export const QUALITY_COLORS = { 1: '#aaa', 2: '#4a4', 3: '#48f', 4: '#a4f', 5: '#fa4', 6: '#f44', 7: '#f4a' };

export function qualityColor(q) {
  return QUALITY_COLORS[q] || '#ccc';
}

// 仙盟职务：0=仙友 1=仙长 2=尊者 3=长老 4=副盟主 5=盟主
export const ALLIANCE_RANK_NAMES = ['仙友', '仙长', '尊者', '长老', '副盟主', '盟主'];

export function allianceRankName(r) {
  const n = ALLIANCE_RANK_NAMES[Number(r)];
  return n != null ? n : '成员';
}

export function qualityName(q) {
  return ['', '一', '二', '三', '四', '五', '六', '七'][q] || String(q);
}

/** 阶位显示：阶位·材质·元素（材料等有材质/元素时） */
export function itemTierLine(item, getItemFn) {
  if (!item) return '';
  const full = (getItemFn && item.id ? getItemFn(item.id) : null) || item;
  const itemType = String(full.type || item.type || '').trim();
  const itemId = Number(full.id || item.id || 0);
  const isFormationTierless = itemType === 'array_plate' || itemType === 'array_rune' || itemId === 199;
  const mat = full.material ? String(full.material).trim() : '';
  const elem = full.element ? String(full.element).trim() : '';
  const parts = [];
  if (!isFormationTierless) {
    parts.push(qualityName(full.quality || 1) + '阶');
  }
  if (mat) parts.push(mat);
  if (elem) parts.push(elem);
  return parts.join('·');
}

export function formatNumber(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

export const DICTIONARY_ENTRIES = [
  { category: '状态效果', title: '恐惧', content: '恐惧状态下物理伤害取最小值；若目标有蓄锐，会被恐惧回合抵消。' },
  { category: '状态效果', title: '背水', content: '背水期间无视防御并额外增伤；双方任一方背水时，本次伤害按背水规则结算。' },
  { category: '状态效果', title: '绝脉', content: '绝脉期间无法施放技能，会被强制为普通攻击。' },
  { category: '状态效果', title: '凝滞', content: '被凝滞的单位下一次行动会被跳过；若有决意层数可抵消部分控制回合。' },
  { category: '状态效果', title: '寄生/流血/猛毒等持续伤害', content: '持续伤害每回合触发，受木灵根相关效果与减益抗性影响。' },
  { category: '状态效果', title: 'KEY技能强制施放', content: '已设置KEY技能若连续4轮未释放，第5轮会在可释放条件满足时被强制施放。' },
  { category: '状态效果', title: '乘风', content: '乘风会提高行动速度，加快出手。' },
  { category: '状态效果', title: '养精', content: '养精期间，法术伤害按高值侧结算。' },
  { category: '状态效果', title: '蓄锐', content: '蓄锐期间，物理伤害按高值侧结算。' },
  { category: '状态效果', title: '精准', content: '精准期间，物理暴击率+25%。' },
  { category: '状态效果', title: '专注', content: '专注期间，法术暴击率+25%。' },
  { category: '状态效果', title: '勃发', content: '勃发期间，行动会优先选择施放技能。' },
  { category: '状态效果', title: '绝唱', content: '绝唱期间，法术攻击必定暴击。' },
  { category: '状态效果', title: '搦战', content: '搦战期间，物理攻击必定暴击。' },
  { category: '状态效果', title: '迟缓', content: '迟缓会降低行动速度，持续期间出手频率下降。' },
  { category: '状态效果', title: '灼魂', content: '灼魂状态下受到的治疗效率降低（默认40%），持续数回合。' },
  { category: '状态效果', title: '震荡', content: '震荡状态下法术攻击和法术防御降低30%，持续数回合，状态结束后恢复。' },
  { category: '状态效果', title: '蓄力', content: '蓄力期间不进行任何行动，蓄力完成后自动释放技能。蓄力不会被绝脉打断，但会被凝滞拖延（凝滞回合不计入蓄力回合）。' },
  { category: '掉落规则', title: '基础掉落上限', content: '每场战斗常规最多掉落3件物品；野外阵纹额外掉落不计入该上限。' },
  { category: '掉落规则', title: '怪物配置掉落', content: '优先按怪物掉落表逐条判定，概率会受到掉落加成影响。' },
  { category: '掉落规则', title: '人型/灵体/不死额外掉落', content: '这三类怪物有额外概率随机掉落装备。' },
  { category: '掉落规则', title: '野兽额外掉落', content: '野兽有额外材料池判定，材料池会按怪物境界限制品质与候选。' },
  { category: '掉落规则', title: '阵纹来源', content: '阵纹无法制造：野外战斗按地图阶段0.001%~0.05%概率随机掉落。阵法副本掉落数量分段为化神以下1~2、炼虚以下2~3、合体及以上3~4。阵盘与阵纹都不分阶：阵纹仅基础值+小幅随机上浮，且效果与卦位解耦随机；阵盘仅按形状决定词条强度与词条数量。' },
  { category: '炼器规则', title: '炼器材料类型限制', content: '主材与引灵材料需为 material/herb/medicine，品质1-6；催化剂为固定白名单。' },
  { category: '炼器规则', title: '主材数量与成品品质', content: '主材1-19有降品风险；20-99有概率升1品；100必定升1品。' },
  { category: '炼器规则', title: '引灵决定元素', content: '引灵品质>=6时必定继承其元素；否则按品质给继承概率。' },
  { category: '炼器规则', title: '催化剂与EX概率', content: '成品品质>=4时才有EX判定：催化剂3品=10%，4品=25%，5品=50%，6品=100%。' },
  { category: '炼器规则', title: '炼器耗时', content: '炼器总时长 = 成品品质×30秒；与制物/炼药/制符共用百艺行动序列。' },
  { category: '隐藏机制', title: '灵根完美阈值', content: '单灵根达到100会触发完美灵根特效：金=物理攻击下限+25%；木=己方造成的DoT效率×1.1；水=治疗10%暴击(1.35倍)；火=法术攻击+15%；土=免疫穿心等防御降低效果。' },
  { category: '隐藏机制', title: '灵根说明', content: '灵根分为金木水火土，总点数100。金偏破甲与物理暴击、木偏减益与持续伤害、水偏治疗与恢复、火偏法术攻击与法术暴击、土偏减伤与防御。' },
  { category: '隐藏机制', title: '功法被动生效范围', content: 'passiveEffects学会即生效；effects按主修/辅修槽位生效。' },
  { category: '隐藏机制', title: '辅修折算', content: '部分功法属性在辅修位按50%折算。' },
  { category: '隐藏机制', title: '离线收益', content: '离线收益受可离线时长、近期战斗表现、胜率与样本数据共同影响。' },
  { category: '属性相关', title: '力量 (Strength)', content: '影响物理攻击力。物理攻击下限 = 力量×0.3×骨骼系数 + 武器物理，上限 = 力量×1.2×骨骼系数 + 武器物理。' },
  { category: '属性相关', title: '体质 (Constitution)', content: '影响最大生命值和物理防御。最大HP = 体质×5×骨骼系数 + 防具加成；物理防御 = 体质×0.25×骨骼系数。' },
  { category: '属性相关', title: '骨骼 (Bone)', content: '综合增幅系数。骨骼系数 = 1 + (骨骼值/300)×0.01，会乘算到攻击、防御、生命、法力等多项属性上。' },
  { category: '属性相关', title: '真元 (Zhenyuan)', content: '影响最大法力和法术防御。最大MP = 真元×3×骨骼系数；法术防御 = 真元×0.2×骨骼系数。部分功法可将真元转化为法术攻击。' },
  { category: '属性相关', title: '灵力 (Lingli)', content: '影响法术攻击力和技能释放概率。法术攻击 = 灵力×0.8×骨骼系数 + 武器法术。灵力越高，自动战斗中释放技能的概率越大（上限+20%）。' },
  { category: '属性相关', title: '敏捷 (Agility)', content: '影响行动速度。敏捷越高出手越快，在行动条模式下优势更明显。' },
  { category: '属性相关', title: '灵根', content: '灵根分金木水火土，总点数100。金偏破甲与物理暴击、木偏减益与持续伤害、水偏治疗与恢复、火偏法术攻击与法术暴击、土偏减伤与防御。完美特效：金+25%物攻下限、木DoT×1.1、水治疗10%暴击、火+15%法攻、土免疫穿心降防。' },
  { category: '属性相关', title: '物理暴击/法术暴击', content: '暴击率由装备词条和被动效果提供。暴击伤害默认150%，可通过词条提升。蓄锐状态下物理按高值结算，搦战状态物理必暴。' },
  { category: '属性相关', title: '属性加成来源', content: '最终属性 = 基础属性 + 装备加成 + 功法被动加成 + 天赋加成。角色面板括号中的数字为各种加成的总和。' },
];

const MINGTU_LINES = [
  { key: 'metal', label: '金' },
  { key: 'wood', label: '木' },
  { key: 'water', label: '水' },
  { key: 'fire', label: '火' },
  { key: 'earth', label: '土' },
  { key: 'neutral', label: '无' },
  { key: 'hunyuan', label: '混元' },
];

export const MINGTU_NODES = (() => {
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
      desc: line.key === 'neutral' ? '无属性亲和+3/8/15' : `${line.label}系亲和+3/8/15`,
      row: 1,
      col: 6,
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
        cost_per_level: tier2ThreeLevel ? [2, 2, 2] : undefined,
        max_level: tier2ThreeLevel ? 3 : 1,
        requires: [rootId],
        line: line.key,
        desc: isMetal
          ? (lane === 1 ? '物理暴击率小幅提升（3级）' : lane === 2 ? '物理穿防小幅提升（3级）' : '物理吸血小幅提升（3级）')
          : isEarth
            ? (lane === 1 ? '防御小幅提升（3级）' : lane === 2 ? '反击小幅提升（3级）' : '物理伤害小幅提升（3级）')
            : isFire
              ? (lane === 1 ? '法术攻击力小幅提升（3级）' : lane === 2 ? '法术暴击率小幅提升（3级）' : '法术穿透小幅提升（3级）')
            : isWater
              ? (lane === 1 ? '防御与法防小幅提升（3级）' : lane === 2 ? '治疗效果提升并附少量法防（3级）' : '物理/法术减伤小幅提升（3级）')
            : isWood
              ? (lane === 1 ? '物伤与法攻小幅提升（3级，偏木系枯荣）' : lane === 2 ? '物理吸血小幅提升并附少量防御（3级）' : '法穿与法攻小幅提升（3级，偏木系蚀伤）')
            : isNeutral
              ? (lane === 1 ? '法术攻击小幅提升（3级，偏妙音）' : lane === 2 ? '法术暴击为主并少量补物暴（3级）' : '少量法穿并强化法术防御（3级）')
            : isHunyuan
              ? (lane === 1 ? '物法双修小幅增伤（3级，偏剑宗）' : lane === 2 ? '物法双暴同步小幅提升（3级）' : '少量防御并补双穿（3级）')
          : '第二层分支占位',
        row: 2,
        col: 2 + (lane - 1) * 4,
      });

      for (let branch = 1; branch <= 2; branch++) {
        const col = 1 + (lane - 1) * 4 + (branch - 1) * 2;
        out.push({
          id: `line_${line.key}_t3_${lane}_${branch}`,
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
          desc: line.key === 'metal'
            ? (lane === 1
              ? (branch === 1 ? '进一步提升物理暴击率' : '暴击率小幅提升并附带少量物伤')
              : lane === 2
                ? (branch === 1 ? '进一步提升物理穿防' : '穿防小幅提升并附带少量物伤')
                : (branch === 1 ? '进一步提升物理吸血' : '吸血小幅提升并附带少量物伤'))
            : line.key === 'fire'
            ? (lane === 1
              ? (branch === 1 ? '进一步提升法术攻击力' : '法攻提升并附带少量法暴')
              : lane === 2
                ? (branch === 1 ? '进一步提升法术暴击率' : '法暴提升并附带少量法术穿透')
                : (branch === 1 ? '进一步提升法术穿透' : '法穿提升并附带少量法术攻击'))
            : line.key === 'water'
            ? (lane === 1
              ? (branch === 1 ? '防御倍率进一步提升' : '法防提升并附少量法术减伤')
              : lane === 2
                ? (branch === 1 ? '治疗效果显著提升' : '治疗效果提升并附少量防御')
                : (branch === 1 ? '法术减伤进一步提升' : '物理减伤提升并附少量法防'))
            : line.key === 'wood'
            ? (lane === 1
              ? (branch === 1 ? '物理伤害进一步提升' : '物伤与法攻小幅同步提升')
              : lane === 2
                ? (branch === 1 ? '物理吸血进一步提升' : '吸血提升并附少量防御')
                : (branch === 1 ? '持续伤害进一步提升' : '木系持续伤害提升并附少量法攻'))
            : line.key === 'neutral'
            ? (lane === 1
              ? (branch === 1 ? '法术攻击进一步提升' : '法攻提升并附带少量法暴')
              : lane === 2
                ? (branch === 1 ? '法术暴击率进一步提升' : '法暴提升并附带少量物暴')
                : (branch === 1 ? '强化法术防御' : '少量法穿并补通用防御'))
            : line.key === 'hunyuan'
            ? (lane === 1
              ? (branch === 1 ? '物理伤害进一步提升' : '物伤提升并附带少量物暴')
              : lane === 2
                ? (branch === 1 ? '物法双暴同步提升' : '法攻提升并附带少量物伤')
                : (branch === 1 ? '通用防御提升' : '少量双穿并附带防御'))
            : line.key === 'earth'
            ? (lane === 1
              ? (branch === 1 ? '物理防御提升' : '法术防御提升')
              : lane === 2
                ? (branch === 1 ? '反击伤害提升' : '反击频率提升')
                : (branch === 1 ? '附带自身最大生命值百分比额外伤害' : '附带自身物理防御力百分比额外伤害'))
            : '第三层分支占位',
          row: 3,
          col,
        });
        out.push({
          id: `line_${line.key}_t4_${lane}_${branch}`,
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
          requires: [`line_${line.key}_t3_${lane}_${branch}`],
          line: line.key,
          desc: line.key === 'metal'
            ? (lane === 1
              ? (branch === 1 ? '提升物理暴伤，强化暴击质量' : '小幅提升暴击率并获得低血斩杀增伤')
              : lane === 2
                ? (branch === 1 ? '小幅提升穿防并获得低概率物理追击' : '提升穿防并附带少量物理伤害')
                : (branch === 1 ? '提升吸血并获得少量物理减伤' : '提升吸血并强化反击回复'))
            : line.key === 'fire'
            ? (lane === 1
              ? (branch === 1 ? '法攻提升并获得少量法术减伤' : '法攻与法暴小幅提升，并强化法术暴伤')
              : lane === 2
                ? (branch === 1 ? '法暴提升并强化法术暴伤' : '法暴提升并附带少量法术穿透')
                : (branch === 1 ? '法穿提升并强化法术暴伤' : '法穿与法攻小幅提升，并获得少量法术减伤'))
            : line.key === 'water'
            ? (lane === 1
              ? (branch === 1 ? '防御提升并附物理减伤' : '法防提升并附法术减伤')
              : lane === 2
                ? (branch === 1 ? '治疗效果大幅提升并附少量法术减伤' : '治疗效果提升并附少量防御')
                : (branch === 1 ? '物理/法术减伤同步提升' : '治疗效果提升并补法防与防御'))
            : line.key === 'wood'
            ? (lane === 1
              ? (branch === 1 ? '物伤提升并附少量物暴' : '物伤与法攻小幅同步提升')
              : lane === 2
                ? (branch === 1 ? '吸血提升并附少量物理减伤' : '吸血与防御同步提升')
                : (branch === 1 ? '持续伤害提升并附少量法穿' : '木系持续伤害大幅提升并附少量法攻'))
            : line.key === 'neutral'
            ? (lane === 1
              ? (branch === 1 ? '法攻提升并附少量法术减伤' : '法攻法暴小幅提升并强化法术暴伤')
              : lane === 2
                ? (branch === 1 ? '法暴提升并补法术防御' : '法暴提升并附带少量法术穿透')
                : (branch === 1 ? '法防与通用防御小幅提升' : '法攻法穿小幅提升并补法术减伤'))
            : line.key === 'hunyuan'
            ? (lane === 1
              ? (branch === 1 ? '物理伤害提升并强化物理暴伤' : '物伤与法攻小幅同步提升')
              : lane === 2
                ? (branch === 1 ? '物法双暴提升并附少量法术暴伤' : '双穿小幅提升并补少量防御')
                : (branch === 1 ? '通用防御提升并附少量物理减伤' : '防御与物法输出小幅同步提升'))
            : line.key === 'earth'
            ? (lane === 1
              ? (branch === 1 ? '受到物理伤害降低5%' : '受到法术伤害降低5%')
              : lane === 2
                ? (branch === 1 ? '反击造成伤害时，回复该伤害12%的生命' : '受到技能伤害时，额外获得8%反击率')
                : (branch === 1 ? '物理伤害对低血目标最高额外提高6%' : '物理命中有18%概率追加12%本次伤害'))
            : '第四层垂直占位',
          row: 4,
          col,
        });
        out.push({
          id: `line_${line.key}_t5_${lane}_${branch}`,
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
          requires: [`line_${line.key}_t4_${lane}_${branch}`],
          line: line.key,
          desc: line.key === 'earth' && lane === 3 && branch === 1
            ? '终极命途（全系最多选1个）：超过6000的物防/法防不再提供减伤；超出部分按50%转化为物攻/法攻'
            : line.key === 'earth' && lane === 2 && branch === 1
              ? '终极命途（全系最多选1个）：反击伤害有40%概率提升至300%（PVP中为20%）'
            : line.key === 'earth' && lane === 2 && branch === 2
              ? '终极命途（全系最多选1个）：反击伤害视为直接伤害，可暴击并可触发直伤附带特效'
            : line.key === 'metal' && lane === 2 && branch === 1
              ? '终极命途（全系最多选1个）：所有常驻物理穿透失效并转化为1/4斩杀线；生命低于斩杀线的目标直接斩杀，斩杀后回复生命（战斗内20%）'
            : line.key === 'metal' && lane === 2 && branch === 2
              ? '终极命途（全系最多选1个）：造成任何直接物理伤害时，若自身没有蓄锐，则获得2轮蓄锐'
            : line.key === 'wood' && lane === 1 && branch === 2
              ? '终极命途（全系最多选1个）：施加持续伤害时，立即引爆持续伤害（与绽放同规则）；通过此法引爆的总伤害降低10%'
            : line.key === 'water' && lane === 3 && branch === 2
              ? '终极命途（全系最多选1个）：造成的治疗效果提高18%；自身拥有护盾时，受到的伤害降低12%'
            : line.key === 'wood' && lane === 3 && branch === 2
              ? '终极命途（全系最多选1个）：你的持续伤害提高22%，但不能再造成任何直接伤害'
            : line.key === 'fire' && lane === 3 && branch === 1
              ? '终极命途（全系最多选1个）：伤害技能叠加焰势，每层使法术最终伤害+5%；达到4层时引爆，对双方所有角色造成各自15%最大生命值伤害'
            : line.key === 'hunyuan' && lane === 3 && branch === 2
              ? '终极命途（全系最多选1个）：任何属性伤害在应用自身亲和之外，再额外应用一次金木水火土亲和总和（不含无/混元）'
            : line.key === 'neutral' && lane === 1 && branch === 2
              ? '终极命途（全系最多选1个）：无属性技能最终伤害提高25%，非无属性技能最终伤害降低20%'
            : line.key === 'neutral' && lane === 3 && branch === 2
              ? '终极命途（全系最多选1个）：受到的单次伤害最高不超过最大生命值的16%，超出部分会被阻拦'
            : '终极命途（全系最多选1个）占位',
          row: 5,
          col,
        });
      }
    }
  }
  return out;
})();

export const TALENT_NODES = MINGTU_NODES;