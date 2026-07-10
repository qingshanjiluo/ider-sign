/**
 * 背包结构工具，无依赖，供 playerOps、onlineUtils 等使用，避免循环依赖
 */
function ensureInventoryStructure(inv) {
  if (!Array.isArray(inv)) return [];
  while (inv.length < 10) {
    inv.push(Array(20).fill(null));
  }
  for (let p = 0; p < inv.length; p++) {
    if (!Array.isArray(inv[p])) inv[p] = Array(20).fill(null);
    while (inv[p].length < 20) inv[p].push(null);
  }
  return inv;
}

module.exports = { ensureInventoryStructure };
