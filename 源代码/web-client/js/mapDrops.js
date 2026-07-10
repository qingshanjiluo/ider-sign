// 地图掉落预览（与 Godot map_panel 一致）
const BEAST_TIER1 = [20, 21, 22, 23, 24, 6, 7, 8, 9, 17, 58, 59, 60, 61, 62, 4, 10];
const BEAST_TIER2 = [25, 26, 27, 28, 29, 4, 10, 62, 63, 64, 65, 66, 67];
const BEAST_TIER3 = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 68, 69, 70];
const BEAST_TIER4 = [40, 41, 42, 43, 44, 71, 169, 178, 182];
const BEAST_TIER5 = [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55];
const EQUIP_TYPES = new Set(['weapon', 'head', 'shoulder', 'chest', 'legs', 'hands', 'ring', 'amulet', 'back']);

function getDropName(itemId, itemMap, getItem) {
  const it = itemMap[itemId] || (typeof getItem === 'function' ? getItem(itemId) : null);
  if (!it || !it.id) return '';
  const t = String(it.type || '');
  if (t === 'weapon') return (it.subtype || '') ? `制式${it.subtype}` : '制式武器';
  if (EQUIP_TYPES.has(t)) return '制式防具';
  return it.name || '';
}

export function getMapDrops(mapInfo, enemies, itemMap, getItem) {
  if (!mapInfo?.enemies?.length || !enemies) return [];
  const dropNames = [];
  const seen = {};
  const safeItemMap = itemMap || {};

  if (mapInfo?.is_lingjie) {
    dropNames.push('阵纹');
    if (!seen.lingjie6) {
      seen.lingjie6 = 1;
      dropNames.push('六阶及以上材料');
    }
  }

  for (const eid of mapInfo.enemies) {
    const e = (enemies || []).find(x => x.id == eid) || {};
    const t = String(e.type || '');
    const lv = Number(e.level) || 1;

    (e.drops || []).forEach(row => {
      const iid = Number(row.itemId || 0);
      if (iid <= 0) return;
      const n = getDropName(iid, safeItemMap, getItem);
      if (n && !seen['c_' + iid]) {
        seen['c_' + iid] = 1;
        dropNames.push(n);
      }
    });

    if (['human', 'spirit', 'undead'].includes(t) && !seen.eq) {
      seen.eq = 1;
      dropNames.push('制式武器/防具');
    }

    if (t === 'beast') {
      const ids = lv <= 120
        ? BEAST_TIER1
        : lv <= 160
          ? BEAST_TIER2
          : lv <= 200
            ? BEAST_TIER3
            : lv <= 240
              ? BEAST_TIER4
              : [...BEAST_TIER5, 121];

      ids.forEach(iid => {
        const n = getDropName(iid, safeItemMap, getItem);
        if (n && !seen['b_' + iid]) {
          seen['b_' + iid] = 1;
          dropNames.push(n);
        }
      });
    }

    if (lv >= 241 && lv <= 280 && ['beast', 'spirit'].includes(t)) {
      const n = getDropName(121, safeItemMap, getItem);
      if (n && !seen.h121) {
        seen.h121 = 1;
        dropNames.push(n);
      }
    }
  }

  return [...new Set(dropNames)].sort();
}
