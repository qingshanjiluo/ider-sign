function resolveMapEnemies(mapInfo, enemies) {
  if (!mapInfo?.enemies?.length) return [];
  const list = enemies || [];
  const rows = mapInfo.enemies
    .map(eid => list.find(e => e.id === eid))
    .filter(Boolean);
  if (!mapInfo?.is_nightmare) return rows;
  return rows.map(e => ({ ...e, name: '魇化的' + String(e.name || '敌人') }));
}

function formatEnemyLine(enemies) {
  if (!enemies.length) return '';
  return enemies.map(e => e.name + ' Lv.' + (e.level || '?')).join('、');
}

export function getCurrentMapInfo(player, maps) {
  const mid = player?.current_map_id || 1;
  const m = (maps || []).find(x => x.id === mid);
  if (!m) return { name: '荒石村', level: '?', is_nightmare: false, is_lingjie: false };
  return { name: m.name || '荒石村', level: m.level || '?', is_nightmare: !!m.is_nightmare, is_lingjie: !!m.is_lingjie };
}

export function buildMapTooltip(mapInfo, enemies, drops) {
  if (!mapInfo) return '';
  const parts = [mapInfo.description || ''];
  if (mapInfo.is_nightmare) parts.push('魇界加成: 怪物属性x4，掉率x3.5');
  if (mapInfo.is_lingjie && mapInfo.environment_desc) parts.push('灵界环境: ' + mapInfo.environment_desc);
  if (mapInfo.is_lingjie && mapInfo.reward_desc) parts.push('灵界奖励: ' + mapInfo.reward_desc);
  const enemyList = resolveMapEnemies(mapInfo, enemies);
  const enemyLine = formatEnemyLine(enemyList);
  if (enemyLine) parts.push('怪物: ' + enemyLine);
  if (Array.isArray(drops) && drops.length) parts.push('掉落: ' + drops.join('、'));
  return parts.filter(Boolean).join('\n');
}

export function buildMapInfoLines(mapInfo, enemies, drops) {
  if (!mapInfo) return [];
  const lines = [];

  if (mapInfo.description) lines.push({ t: 'desc', text: mapInfo.description });
  if (mapInfo.is_nightmare) lines.push({ t: 'prop', label: '地图类型', text: '魇界（怪物属性x4，掉率x3.5）' });
  if (mapInfo.is_lingjie) lines.push({ t: 'prop', label: '地图类型', text: '灵界（环境机制生效，自适应强化怪物）' });
  lines.push({ t: 'prop', label: '推荐等级', text: 'Lv.' + (mapInfo.level || '?') });
  if (mapInfo.is_lingjie && mapInfo.environment_desc) lines.push({ t: 'prop', label: '环境', text: mapInfo.environment_desc });
  if (mapInfo.is_lingjie && mapInfo.reward_desc) lines.push({ t: 'prop', label: '奖励', text: mapInfo.reward_desc });

  const enemyList = resolveMapEnemies(mapInfo, enemies);
  const enemyLine = formatEnemyLine(enemyList);
  if (enemyLine) lines.push({ t: 'prop', label: '怪物', text: enemyLine });

  if (Array.isArray(drops) && drops.length) {
    lines.push({ t: 'effects', items: drops.map(d => '· ' + d) });
  }

  return lines;
}
