const { intVal, numVal } = require('./combatCoreUtils');

function countSetPieces(unit, setId) {
  if (!unit || !unit.set_counts) return 0;
  return intVal(unit.set_counts[setId], 0);
}

function hasTudun(unit) {
  return unit && (unit.tudun_rounds || 0) > 0;
}

function getDaomiaoExtraAffinity(attacker, elementKey) {
  if (!attacker || !elementKey) return 0;
  const dm5 = countSetPieces(attacker, '道妙-气象万千') >= 5;
  if (!dm5 || attacker.daomiao_active) return 0;
  const ql = Array.isArray(attacker.qixiang_list) ? attacker.qixiang_list : [];
  const qixiangToElement = { 云: 'water', 风: 'wood', 露: 'water', 尘: 'earth', 霞: 'fire', 昼: 'metal', 夜: 'water' };
  let count = 0;
  for (const q of ql) {
    if (qixiangToElement[q] === elementKey) count++;
  }
  return count * 7;
}

function calcElementAffinity(attacker, skill) {
  const attrMap = { 金: 'metal', 木: 'wood', 水: 'water', 火: 'fire', 土: 'earth' };
  const attr = String(skill?.attribute || '');
  const fiveElementSum = ['metal', 'wood', 'water', 'fire', 'earth']
    .reduce((sum, elem) => sum + numVal(attacker?.[elem + '_affinity'], 0), 0);
  const isElementalAttr = !!(attrMap[attr] || attr === '混元' || attr === '无');
  const guiyiExtra = numVal(attacker?.guiyi_shentu_active, 0) > 0 && isElementalAttr ? fiveElementSum : 0;
  if (attacker && attacker.daomiao_active) {
    let total = 0;
    for (const elem of ['metal', 'wood', 'water', 'fire', 'earth']) {
      total += numVal(attacker[elem + '_affinity'], 0);
    }
    total += numVal(attacker.hunyuan_affinity, 0);
    total += numVal(attacker.wu_affinity, 0);
    return total + 49 + guiyiExtra;
  }
  if (attrMap[attr]) return numVal(attacker[attrMap[attr] + '_affinity'], 0) + getDaomiaoExtraAffinity(attacker, attrMap[attr]) + guiyiExtra;
  if (attr === '混元') return numVal(attacker.hunyuan_affinity, 0) + guiyiExtra;
  if (attr === '无') return numVal(attacker.wu_affinity, 0) + guiyiExtra;
  return 0;
}

function getHaomiaoDotBonus(unit) {
  return (unit && countSetPieces(unit, '浩渺-云上青鸾') >= 8) ? 1 : 0;
}

function tryJiemieHealToXurui(unit, healAmount, events, opts) {
  return false;
}

module.exports = {
  countSetPieces,
  hasTudun,
  getDaomiaoExtraAffinity,
  calcElementAffinity,
  getHaomiaoDotBonus,
  tryJiemieHealToXurui
};
