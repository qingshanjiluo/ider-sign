const { getEnemyById, getMapById, getEnemyPrefixes } = require('./dataLoader');
const { isLingjieMap } = require('./lingjie');

const NIGHTMARE_ENEMY_MULTIPLIER = 4;

function isNightmareMap(map) {
  if (!map || typeof map !== 'object') return false;
  if (map.is_nightmare === true) return true;
  const mapId = Number(map.id) || 0;
  if (mapId >= 10000) return true;
  const mapName = String(map.name || '');
  return mapName.startsWith('魇化');
}

function applyNightmareEnemy(enemy, map) {
  if (!enemy || !isNightmareMap(map)) return enemy;
  const e = structuredClone(enemy);
  const keys = ['hp', 'attack', 'attackMin', 'attackMax', 'defense', 'agility', 'spellAttack', 'mp', 'max_mp'];
  for (const k of keys) {
    const raw = Number(e[k]);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    e[k] = Math.max(1, Math.floor(raw * NIGHTMARE_ENEMY_MULTIPLIER));
  }
  e.name = `魇化的${String(e.name || '敌人')}`;
  e.nightmare = true;
  return e;
}

function _rollPrefix() {
  const prefixes = getEnemyPrefixes();
  if (!Array.isArray(prefixes) || prefixes.length === 0) return null;
  const roll = Math.random();
  let cumulative = 0;
  for (const p of prefixes) {
    cumulative += Number(p.probability) || 0;
    if (roll < cumulative) return p;
  }
  return null;
}

function _applyPrefix(enemy, prefix) {
  if (!prefix) return enemy;
  const e = structuredClone(enemy);
  e.name = `${prefix.name || ''}${e.name || '敌人'}`;
  const fx = prefix.effects || {};
  if (fx.maxHp) e.hp = Math.floor((Number(e.hp) || 1) * Number(fx.maxHp));
  if (fx.minAttack || fx.maxAttack) {
    const atkMul = Number(fx.minAttack || fx.maxAttack) || 1;
    e.attack = Math.floor((Number(e.attack) || 10) * atkMul);
  }
  if (fx.defense) e.defense = Math.floor((Number(e.defense) || 0) * Number(fx.defense));
  if (fx.agility) e.agility = Math.floor((Number(e.agility) || 0) * Number(fx.agility));
  if (fx.spellAttack) e.spellAttack = Math.floor((Number(e.spellAttack) || 0) * Number(fx.spellAttack));
  e.prefix = String(prefix.name || '');
  return e;
}

function randomEnemyFromMap(mapId) {
  const map = getMapById(mapId);
  if (!map || !map.enemies || map.enemies.length === 0) return null;
  const idx = Math.floor(Math.random() * map.enemies.length);
  const enemyId = Number(map.enemies[idx]) || map.enemies[idx];
  const baseEnemy = getEnemyById(enemyId);
  if (!baseEnemy) return null;
  if (isLingjieMap(map)) return structuredClone(baseEnemy);
  const prefix = _rollPrefix();
  const prefixed = _applyPrefix(baseEnemy, prefix);
  return applyNightmareEnemy(prefixed, map);
}

module.exports = {
  isNightmareMap,
  applyNightmareEnemy,
  randomEnemyFromMap
};
