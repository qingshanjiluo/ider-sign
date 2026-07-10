/**
 * 加载游戏静态数据（与客户端 data/ 目录一致）
 */
const path = require('path');
const fs = require('fs');
const { isLingjieMap } = require('./lingjie');

// 游戏静态 JSON（skills.json、maps.json 等），与 server/data（数据库 game.db）不同
const DATA_DIR_CANDIDATES = [
  path.join(__dirname, '../../data'), // 项目根/data（/opt/game/data）
  path.join(__dirname, '../data'),    // server/data 仅当根 data 不存在时尝试
  path.join(process.cwd(), 'data')
];
let _resolvedDataDir = '';

function resolveDataDir() {
  if (_resolvedDataDir) return _resolvedDataDir;
  for (const dir of DATA_DIR_CANDIDATES) {
    try {
      if (!fs.existsSync(dir)) continue;
      const mapsFile = path.join(dir, 'maps.json');
      const enemiesFile = path.join(dir, 'enemies.json');
      if (fs.existsSync(mapsFile) && fs.existsSync(enemiesFile)) {
        _resolvedDataDir = dir;
        return _resolvedDataDir;
      }
    } catch (_) {
      // ignore and continue fallback search
    }
  }
  // 没找到完整目录时回退第一候选，保持可预期行为
  _resolvedDataDir = DATA_DIR_CANDIDATES[0];
  console.warn('[dataLoader] 未找到完整 data 目录，使用回退:', _resolvedDataDir);
  return _resolvedDataDir;
}

function loadJson(name) {
  const file = path.join(resolveDataDir(), `${name}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[dataLoader] 解析失败: ${file}`, e && e.message);
    return [];
  }
}

let _items, _enemies, _maps, _skills, _techniques, _dungeonEnemies, _dungeons, _sects, _alchemyRecipes, _craftRecipes, _enemyPrefixes, _arrayShapes, _arrayRunes;
let _itemsById, _enemiesById, _mapsById, _skillsById, _techniquesById, _dungeonEnemiesById, _dungeonsById, _sectsById;

const NIGHTMARE_MAP_ID_OFFSET = 10000;

function buildNightmareMap(baseMap) {
  if (!baseMap || typeof baseMap !== 'object') return null;
  if (isLingjieMap(baseMap)) return null;
  const baseId = Number(baseMap.id) || 0;
  if (baseId <= 0) return null;
  const mirror = JSON.parse(JSON.stringify(baseMap));
  mirror.id = baseId + NIGHTMARE_MAP_ID_OFFSET;
  mirror.base_map_id = baseId;
  mirror.is_nightmare = true;
  mirror.name = `魇化${String(baseMap.name || '未知地图')}`;
  mirror.description = `${String(baseMap.description || '')}（魇界：怪物属性x4，掉率x3.5）`;
  return mirror;
}

function _buildIdMap(arr, key = 'id') {
  const m = new Map();
  for (const o of arr || []) {
    const k = Number(o && o[key]);
    if (Number.isFinite(k)) m.set(k, o);
  }
  return m;
}

function getItems() {
  if (!_items) {
    const dir = resolveDataDir();
    const itemsPath = path.join(dir, 'items.json');
    console.log('[dataLoader] data 目录:', dir, 'items.json 存在:', fs.existsSync(itemsPath));
    _items = loadJson('items');
    _itemsById = _buildIdMap(_items);
  }
  return _items;
}

function getEnemies() {
  if (!_enemies) { _enemies = loadJson('enemies'); _enemiesById = _buildIdMap(_enemies); }
  return _enemies;
}

function getMaps() {
  if (!_maps) {
    const baseMaps = loadJson('maps');
    const nightmareMaps = (baseMaps || []).map(buildNightmareMap).filter(Boolean);
    _maps = [...baseMaps, ...nightmareMaps];
    _mapsById = _buildIdMap(_maps);
  }
  return _maps;
}

function getSkills() {
  if (!_skills) { _skills = loadJson('skills'); _skillsById = _buildIdMap(_skills); }
  return _skills;
}

function getTechniques() {
  if (!_techniques) { _techniques = loadJson('techniques'); _techniquesById = _buildIdMap(_techniques); }
  return _techniques;
}

function getItemById(id) {
  if (!_itemsById) getItems();
  return _itemsById.get(Number(id)) || {};
}

function getEnemyById(id) {
  if (!_enemiesById) getEnemies();
  return _enemiesById.get(Number(id)) || {};
}

function getMapById(id) {
  if (!_mapsById) getMaps();
  return _mapsById.get(Number(id)) || {};
}

function getEnemiesInLevelRange(minLv, maxLv) {
  return getEnemies().filter(e => {
    const lv = Number(e.level) || 1;
    return lv >= minLv && lv <= maxLv;
  });
}

function getDungeonEnemies() {
  if (!_dungeonEnemies) { _dungeonEnemies = loadJson('dungeon_enemies'); _dungeonEnemiesById = _buildIdMap(_dungeonEnemies); }
  return _dungeonEnemies;
}

function getDungeons() {
  if (!_dungeons) { _dungeons = loadJson('dungeons'); _dungeonsById = _buildIdMap(_dungeons); }
  return _dungeons;
}

function getAlchemyRecipes() {
  if (!_alchemyRecipes) _alchemyRecipes = loadJson('alchemy_recipes');
  return _alchemyRecipes;
}

function getCraftRecipes() {
  if (!_craftRecipes) _craftRecipes = loadJson('craft_recipes');
  return _craftRecipes;
}

function getArrayShapes() {
  if (!_arrayShapes) _arrayShapes = loadJson('array_shapes');
  return _arrayShapes;
}

function getArrayRunes() {
  if (!_arrayRunes) _arrayRunes = loadJson('array_runes');
  return _arrayRunes;
}

function getDungeonEnemyById(id) {
  if (!_dungeonEnemiesById) getDungeonEnemies();
  return _dungeonEnemiesById.get(Number(id)) || {};
}

function getDungeonById(id) {
  if (!_dungeonsById) getDungeons();
  return _dungeonsById.get(Number(id)) || {};
}

function getSects() {
  if (!_sects) { _sects = loadJson('sects'); _sectsById = _buildIdMap(_sects); }
  return _sects || [];
}

function getSectById(id) {
  if (!_sectsById) getSects();
  return _sectsById.get(Number(id)) || {};
}

function getSkillById(id) {
  if (!_skillsById) getSkills();
  return _skillsById.get(Number(id)) || {};
}

function getTechniqueById(id) {
  if (!_techniquesById) getTechniques();
  return _techniquesById.get(Number(id)) || {};
}

function getEnemyPrefixes() {
  if (!_enemyPrefixes) _enemyPrefixes = loadJson('enemy_prefixes');
  return _enemyPrefixes || [];
}

function getDiscipleBattleSkills() {
  const raw = loadJson('skillsDiscipleBattle');
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.skills) return raw;
  return { skills: [], typeEffectiveness: {}, meta: {} };
}

module.exports = {
  getItems,
  getEnemies,
  getMaps,
  getSkills,
  getTechniques,
  getItemById,
  getEnemyById,
  getMapById,
  getEnemiesInLevelRange,
  getDungeonEnemies,
  getDungeons,
  getDungeonEnemyById,
  getDungeonById,
  getAlchemyRecipes,
  getCraftRecipes,
  getArrayShapes,
  getArrayRunes,
  getSects,
  getSectById,
  getSkillById,
  getTechniqueById,
  getEnemyPrefixes,
  getDiscipleBattleSkills
};
