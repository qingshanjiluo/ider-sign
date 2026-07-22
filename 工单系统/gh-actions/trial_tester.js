/**
 * 艾德尔试炼自动测试工具 v2 — 全地图穷举版
 *
 * 流程：
 *   1. 用 zzhx 登录游戏
 *   2. 获取试炼词条定义（18 个词条）和所有副本
 *   3. 对每个副本：
 *      a. 测试全部 18 个单条 → 筛出能通关的（M个）
 *      b. 如果 M ≤ 12 → 对这 M 个做全组合穷举（2^M - 1 种）
 *      c. 如果 M > 12 → 贪心叠加 + TOP 10 穷举
 *      d. 记录该地图最优
 *   4. 对比所有地图，输出全局最优
 *
 * 环境变量: WORKER_URL, API_KEY, API_BASE, SIGN_KEY, CLIENT_VERSION
 * 账号: zzhx / Pipi20100817
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 5, timeout: 60000 });

// 游戏服务器地址（不含/web/路径）
const API_BASE = 'https://idlexiuxianzhuan.cn';
// 所有工具共用签名密钥
const SIGN_KEY = 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l';
// 所有工具共用客户端版本
const CLIENT_VERSION = '1.2.4';
// Worker 上报（可选）
const WORKER_URL = process.env.WORKER_URL || '';
const API_KEY = process.env.API_KEY || '';

const TEST_USER = process.env.TEST_USERNAME || 'zzhx';
const TEST_PASS = process.env.TEST_PASSWORD || 'Pipi20100817';

const MAX_AFFIXES = 6;
const MAX_ADVANCE_LOOPS = 60;
const BATTLE_RETRY = 2;
const REPORT_FILE = path.join(__dirname, '..', 'trial_test_report.json');

// 无需环境变量，所有参数已硬编码
console.log('[配置] API_BASE=' + API_BASE + ' CLIENT_VERSION=' + CLIENT_VERSION);

function makeSign(method, path, timestamp, bodyStr) {
  const hmac = crypto.createHmac('sha256', SIGN_KEY);
  hmac.update(method + '\n' + path + '\n' + timestamp + '\n' + bodyStr);
  return hmac.digest('hex');
}
function httpsReq(method, hostname, path, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method,
      headers: { ...headers },
      rejectUnauthorized: false,
      agent: HTTPS_AGENT,
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const t = setTimeout(() => { req.destroy(new Error('超时')); }, timeoutMs || 30000);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
async function apiRequest(method, path, token, body) {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = makeSign(method, path, ts, bodyStr);
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Version': CLIENT_VERSION,
    'X-Sign-T': String(ts), 'X-Sign': sign,
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsReq(method, 'idlexiuxianzhuan.cn', path, headers, bodyStr, 60000);
  let data;
  try { data = JSON.parse(r.body); } catch (e) { throw new Error('非JSON(' + r.status + '): ' + r.body.slice(0, 200)); }
  if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '请求失败(' + r.status + ')');
  return data;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  function h(s, c) {
    if (c.length === k) { result.push([...c]); return; }
    for (let i = s; i < arr.length; i++) { c.push(arr[i]); h(i + 1, c); c.pop(); }
  }
  h(0, []);
  return result;
}

const BATTLE_PAUSE_MS = 10;
async function testConfig(token, dungeonId, affixIds) {
  const n = affixIds.length;
  const label = n + ':' + (affixIds.slice(0, 3).join(',') + (n > 3 ? '...' : ''));
  try {
    const startData = await apiRequest('POST', '/dungeon-battle/start', token, {
      dungeon_id: dungeonId,
      challenge_mode: 'trial_contract',
      contract_modifiers: affixIds,
    });
    const battleId = startData.battle_id;
    if (!battleId) return { ok: false, error: '无battle_id', label, affixIds, coins: 0 };
    // 用 start 接口返回的原始试炼币（理论收益），不受今日已获得影响
    const theoreticalCoins = Number(startData.trial_coins) || 0;
    let ended = false, victory = false;
    for (let r = 0; r < MAX_ADVANCE_LOOPS; r++) {
      const adv = await apiRequest('POST', '/dungeon-battle/advance?state=lite', token, { battle_id: battleId });
      ended = Boolean(adv.ended);
      victory = Boolean(adv.victory);
      if (ended) break;
      await sleep(BATTLE_PAUSE_MS);
    }
    return { ok: victory, victory, label, affixIds, coins: victory ? theoreticalCoins : 0, error: victory ? null : (ended ? '失败' : '超时') };
  } catch (e) {
    return { ok: false, error: e.message, label, affixIds, coins: 0 };
  }
}

async function testWithRetry(token, dungeonId, affixIds) {
  for (let i = 0; i <= BATTLE_RETRY; i++) {
    const r = await testConfig(token, dungeonId, affixIds);
    if (r.ok || (r.error && !r.error.includes('调息') && !r.error.includes('结算'))) return r;
    await sleep(500);
  }
  return { ok: false, error: '重试耗尽', affixIds, coins: 0 };
}

async function greedyOnly(token, dungeonId, dgName, mult, pool, defs) {
  pool.sort((a, b) => b.coins - a.coins);
  let currentIds = [pool[0].id];
  let currentCoins = pool[0].coins;
  const allResults = [{ affixIds: [...currentIds], coins: currentCoins }];
  console.log('     起始: ' + pool[0].name + ' 币=' + currentCoins);

  for (let slot = 0; slot < MAX_AFFIXES - 1; slot++) {
    let bestNext = null, bestNextCoins = currentCoins;
    for (const s of pool) {
      if (currentIds.includes(s.id)) continue;
      process.stdout.write('     +' + s.name + '...');
      const r = await testWithRetry(token, dungeonId, [...currentIds, s.id]);
      if (r.ok && r.coins > bestNextCoins) { bestNext = s; bestNextCoins = r.coins; console.log('币' + r.coins + ' ✓'); }
      else console.log((r.ok ? '币' + r.coins + '(不增)' : '✗') + '\n');
      await sleep(20);
    }
    if (bestNext && bestNextCoins > currentCoins) {
      currentIds.push(bestNext.id); currentCoins = bestNextCoins;
      allResults.push({ affixIds: [...currentIds], coins: currentCoins });
      console.log('      ✨ 叠加+' + bestNext.name + ' 当前币=' + currentCoins);
    } else { console.log('      🛑 无法继续叠加'); break; }
  }
  const names = currentIds.map(i => defs.find(d => d.id === i)?.name || i);
  return { best: currentCoins > 0 ? { affixIds: currentIds, coins: currentCoins, names } : null, allResults, tested: allResults.length };
}

async function exhaustiveOnPool(token, dungeonId, dgName, mult, pool, defs) {
  const poolIds = pool.map(s => s.id);
  const N = poolIds.length;
  const totalCombos = Math.pow(2, N) - 1;
  console.log('     穷举池: ' + N + ' 个词条, 共 ' + totalCombos + ' 种组合');

  if (totalCombos > 30000) {
    console.log('     组合数过多(' + totalCombos + '), 切换为贪心+TOP12穷举');
    return await greedyAndTopN(token, dungeonId, dgName, mult, pool, defs, 12);
  }

  let best = { coins: 0, affixIds: [] };
  let tested = 0;
  const allPass = [];

  for (let mask = 1; mask < (1 << N); mask++) {
    const ids = [];
    for (let b = 0; b < N; b++) if (mask & (1 << b)) ids.push(poolIds[b]);
    if (ids.length > MAX_AFFIXES) continue;

    tested++;
    if (tested % 10 === 0 || tested === 1) {
      process.stdout.write('     [' + tested + '/' + totalCombos + '] ' + ids.length + '条...');
    }

    const r = await testWithRetry(token, dungeonId, ids);
    if (r.ok) {
      allPass.push({ affixIds: [...ids], coins: r.coins });
      if (r.coins > best.coins) {
        best = { coins: r.coins, affixIds: [...ids] };
        const names = ids.map(i => defs.find(d => d.id === i)?.name || i);
        console.log(' ✅ 币=' + r.coins + ' ★新最优 [' + names.join('+') + ']');
      } else if (tested % 10 === 0) {
        console.log(' ✅ 币=' + r.coins);
      }
    } else if (tested % 10 === 0) {
      console.log(' ❌ ' + (r.error || ''));
    }
    await sleep(80);
  }

  allPass.sort((a, b) => b.coins - a.coins);
  const names = best.affixIds.map(i => defs.find(d => d.id === i)?.name || i);
  console.log('     🏆 穷举完成! 最优: ' + best.affixIds.length + '条 币=' + best.coins + ' [' + names.join('+') + ']');
  return { best: best.coins > 0 ? { affixIds: best.affixIds, coins: best.coins, names } : null, allResults: allPass.slice(0, 30), tested };
}

async function greedyAndTopN(token, dungeonId, dgName, mult, pool, defs, topN) {
  pool.sort((a, b) => b.coins - a.coins);
  const singles = [...pool];
  const bestSingle = singles[0];

  let currentIds = [bestSingle.id];
  let currentCoins = bestSingle.coins;
  const allResults = [{ affixIds: [...currentIds], coins: currentCoins }];

  for (let slot = 0; slot < MAX_AFFIXES - 1; slot++) {
    let bestNext = null, bestNextCoins = currentCoins;
    for (const s of singles) {
      if (currentIds.includes(s.id)) continue;
      const ids = [...currentIds, s.id];
      const r = await testWithRetry(token, dungeonId, ids);
      if (r.ok && r.coins > bestNextCoins) { bestNext = s; bestNextCoins = r.coins; }
      await sleep(80);
    }
    if (bestNext) {
      currentIds.push(bestNext.id); currentCoins = bestNextCoins;
      allResults.push({ affixIds: [...currentIds], coins: currentCoins });
    } else break;
  }

  let exhaustiveBest = null;
  const topNpool = singles.slice(0, Math.min(topN, singles.length));
  if (topNpool.length >= 2) {
    const topIds = topNpool.map(s => s.id);
    let totalE = 0;
    for (let k = 2; k <= Math.min(MAX_AFFIXES, topIds.length); k++) totalE += combinations(topIds, k).length;
    console.log('     对TOP ' + topNpool.length + ' 做补充穷举, 约 ' + totalE + ' 种');

    for (let k = 2; k <= Math.min(MAX_AFFIXES, topIds.length); k++) {
      const combos = combinations(topIds, k);
      for (let ci = 0; ci < combos.length; ci++) {
        const ids = combos[ci];
        if (ci === 0) process.stdout.write('     C(' + topIds.length + ',' + k + ')=' + combos.length + '...');
        const r = await testWithRetry(token, dungeonId, ids);
        if (r.ok && r.coins > currentCoins) {
          currentIds = ids; currentCoins = r.coins;
          const n = ids.map(i => defs.find(d => d.id === i)?.name || i).join('+');
          console.log('      ✅ 币=' + r.coins + ' ★新最优 [' + n + ']');
        }
        await sleep(50);
      }
      console.log('     C(' + topIds.length + ',' + k + ') 完成');
    }
  }

  const bestNames = currentIds.map(i => defs.find(d => d.id === i)?.name || i);
  return {
    best: currentCoins > 0 ? { affixIds: currentIds, coins: currentCoins, names: bestNames } : null,
    allResults,
    tested: allResults.length + (totalE || 0),
  };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  艾德尔试炼自动测试工具 v2 (全穷举版)');
  console.log('  账号: ' + TEST_USER);
  console.log('  最大词条: ' + MAX_AFFIXES);
  console.log('  服务器: ' + API_BASE);
  console.log('  版本: ' + CLIENT_VERSION);
  console.log('  时间: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');

  // 1) 登录
  console.log('[登录] ' + TEST_USER + '...');
  const machineId = 'trial_v2_' + Date.now().toString(36);
  let token;
  try {
    const loginData = await apiRequest('POST', '/auth/login', '', { username: TEST_USER, password: TEST_PASS, machine_id: machineId });
    token = loginData.token;
    console.log('[登录] ✅ 成功\n');
  } catch (e) {
    console.error('[登录] ❌ 失败: ' + e.message);
    process.exit(1);
  }

  // 2) 玩家状态
  try {
    const ps = await apiRequest('GET', '/player/state', token);
    const p = ps.player || {};
    console.log('[玩家] 等级=' + p.level + ' 试炼币=' + (p.trial_coins || 0));
  } catch (e) { console.log('[玩家] ' + e.message); }

  // 3) 获取试炼配置
  console.log('\n[配置] 获取试炼词条...');
  let contractsData;
  try { contractsData = await apiRequest('GET', '/trial/contracts', token); }
  catch (e) { console.error('❌ ' + e.message); process.exit(1); }

  const defs = contractsData.modifiers || [];
  const dungeons = contractsData.dungeon_reward_multipliers || [];

  console.log('[配置] 词条: ' + defs.length + '个');
  defs.forEach(d => console.log('   ' + d.id + ': ' + d.name + ' (分' + d.score + ')'));
  console.log('\n[配置] 副本: ' + dungeons.length + '个');
  dungeons.forEach(dg => console.log('   ID=' + dg.dungeon_id + ' ' + dg.dungeon_name + ' (倍率' + dg.multiplier + 'x 等级' + dg.level_min + ')'));

  // 4) 每张地图：先筛单条，再穷举
  const startIdx = parseInt(process.env.START_MAP || '0', 10);
  const maxMaps = parseInt(process.env.MAX_MAPS || '999', 10);
  const mapResults = [];
  // 尝试加载已有结果（只加载有有效 best 的记录）
  try {
    const existing = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
    if (existing.results) {
      const valid = existing.results.filter(r => r.best && r.best.coins > 0);
      mapResults.push(...valid);
      console.log('[续跑] 已加载 ' + valid.length + ' 个已有地图结果（跳过 ' + (existing.results.length - valid.length) + ' 个无效记录）');
    }
  } catch (e) {}

  const alreadyDone = new Set(mapResults.map(r => r.dungeonId));
  const startTime = Date.now();
  let mapsDone = 0;
  for (let di = startIdx; di < dungeons.length; di++) {
    if (mapsDone >= maxMaps) {
      console.log('\n  ⏹️ 已达 MAX_MAPS=' + maxMaps + '，停止处理');
      break;
    }
    const dg = dungeons[di];
    const dgId = Number(dg.dungeon_id);
    const mult = Number(dg.multiplier) || 1;

    if (alreadyDone.has(dgId)) {
      console.log('\n  ⏭️ 跳过已完成的: ' + dg.dungeon_name);
      continue;
    }
    console.log('\n═══════════════════════════════════════');
    console.log('  📍 [' + (di + 1) + '/' + dungeons.length + '] ' + dg.dungeon_name + ' (倍率' + mult + 'x)');
    console.log('═══════════════════════════════════════');

    // Phase 1: 测试全部单条
    console.log('  ── 阶段1: 单条筛选 ──');
    const singles = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      process.stdout.write('   [' + (i + 1) + '/' + defs.length + '] ' + d.name + '(分' + d.score + ')...');
      const r = await testWithRetry(token, dgId, [d.id]);
      if (r.ok) {
        singles.push({ id: d.id, name: d.name, score: d.score, coins: r.coins });
        console.log(' ✅ 币' + r.coins);
      } else {
        console.log(' ❌');
      }
      await sleep(30);
    }

    if (singles.length === 0) {
      console.log('  ⚠️ 此地图无任何可通关词条，跳过');
      mapResults.push({ dungeonId: dgId, dungeonName: dg.dungeon_name, multiplier: mult, best: null, singlesCount: 0, testedCombos: 0 });
      continue;
    }

    console.log('  ✅ 可通关单条: ' + singles.length + '/' + defs.length);
    singles.sort((a, b) => b.coins - a.coins);
    console.log('  前5: ' + singles.slice(0, 5).map(s => s.name + '(币' + s.coins + ')').join(', '));

    // Phase 2: 穷举/贪心
    console.log('  ── 阶段2: 穷举 ──');
    let result;

    if (singles.length >= 15) {
      // 全员通关的简单图，直接贪心叠加（快）
      console.log('  策略: 贪心叠加 (' + singles.length + '个词条全部可通关，直接贪心)');
      result = await greedyOnly(token, dgId, dg.dungeon_name, mult, singles, defs);
    } else if (singles.length <= 12) {
      const totalCombos = Math.pow(2, singles.length) - 1;
      console.log('  策略: 全穷举 (' + singles.length + '个词条, ' + totalCombos + '种组合)');
      result = await exhaustiveOnPool(token, dgId, dg.dungeon_name, mult, singles, defs);
    } else {
      console.log('  策略: 贪心+TOP12 (' + singles.length + '个词条, TOP12穷举)');
      result = await greedyAndTopN(token, dgId, dg.dungeon_name, mult, singles, defs, 12);
    }

    mapResults.push({
      dungeonId: dgId,
      dungeonName: dg.dungeon_name,
      multiplier: mult,
      best: result.best,
      singlesCount: singles.length,
      testedCombos: result.tested || 0,
    });
    mapsDone++;

    if (result.best) {
      console.log('\n  ✨ 地图最优: ' + result.best.names.join(' + ') + ' = ' + result.best.coins + ' 试炼币');
    }
    // 每跑完一张图自动保存
    try {
      const tmpReport = {
        generatedAt: new Date().toISOString(),
        affixes: defs.map(d => ({ id: d.id, name: d.name, score: d.score })),
        dungeons: dungeons.map(dg => ({ id: dg.dungeon_id, name: dg.dungeon_name, multiplier: dg.multiplier, levelMin: dg.level_min })),
        results: mapResults.filter(r => r.best && r.best.coins > 0),
        globalBest: {},
      };
      fs.writeFileSync(REPORT_FILE, JSON.stringify(tmpReport, null, 2), 'utf8');
      console.log('  [自动保存] 已保存 ' + mapResults.length + ' 个地图结果');
    } catch (e) {}
  }

  // 5) 汇总对比
  console.log('\n\n═══════════════════════════════════════════');
  console.log('          🏆 全地图对比 🏆');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  ' + '地图'.padEnd(18) + '倍率'.padEnd(8) + '通关词条'.padEnd(12) + '最优词条数'.padEnd(12) + '收益');
  console.log('  ' + '─'.repeat(58));

  mapResults.sort((a, b) => (b.best?.coins || 0) - (a.best?.coins || 0));
  let globalBest = { rank: 0, dungeonName: '', coins: 0, names: [] };

  mapResults.forEach((r, i) => {
    const hasBest = r.best && r.best.coins > 0;
    const coins = hasBest ? r.best.coins : 0;
    const count = hasBest ? r.best.affixIds.length : 0;
    const mg = r.multiplier || 0;
    const sc = r.singlesCount !== undefined ? r.singlesCount : '?';
    const mark = (i === 0 && coins > 0) ? ' 🥇' : '';
    console.log('  ' + (r.dungeonName || '?').padEnd(18) + String(mg + 'x').padEnd(8) +
      String(sc + '/' + defs.length).padEnd(12) +
      String(count).padEnd(12) + coins + mark);
    if (coins > globalBest.coins) globalBest = { rank: i, dungeonName: r.dungeonName, coins, names: r.best?.names || [], multiplier: r.multiplier };
  });

  console.log('  ' + '─'.repeat(58));
  console.log('');
  if (globalBest.coins > 0) {
    console.log('  🥇 全局最优: ' + globalBest.dungeonName);
    console.log('     词条: ' + globalBest.names.join(' + '));
    console.log('     收益: ' + globalBest.coins + ' 试炼币');
  }

  // 6) 保存报告
  const report = {
    generatedAt: new Date().toISOString(),
    affixes: defs.map(d => ({ id: d.id, name: d.name, score: d.score })),
    dungeons: dungeons.map(dg => ({ id: dg.dungeon_id, name: dg.dungeon_name, multiplier: dg.multiplier, levelMin: dg.level_min })),
    results: mapResults.filter(r => r.best && r.best.coins > 0),
    globalBest,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n  报告已保存: ' + REPORT_FILE);

  // 7) 生成可粘贴的每日试炼配置（TXT）
  const dailyConfigs = mapResults
    .filter(r => r.best && r.best.coins > 0)
    .sort((a, b) => (a.dungeonId) - (b.dungeonId))
    .map(r => ({
      dungeon_id: r.dungeonId,
      name: r.dungeonName,
      multiplier: Number(r.multiplier),
      affixes: r.best.affixIds,
      label: r.best.names.join('+'),
      expected_coins: r.best.coins,
    }));
  const txtLines = [];
  txtLines.push('╔══════════════════════════════════════════════════════╗');
  txtLines.push('║        艾德尔试炼测试报告 — ' + new Date().toISOString().slice(0, 10) + '        ║');
  txtLines.push('╚══════════════════════════════════════════════════════╝');
  txtLines.push('');
  txtLines.push('账号: ' + TEST_USER);
  txtLines.push('服务器: ' + API_BASE);
  txtLines.push('');
  txtLines.push('──────────────────────────────────────────────');
  txtLines.push('  可通关地图最优配置');
  txtLines.push('──────────────────────────────────────────────');
  dailyConfigs.forEach((c, i) => {
    txtLines.push('');
    txtLines.push('  [' + (i + 1) + '] ' + c.name + ' (x' + c.multiplier + ')');
    txtLines.push('      词条: ' + c.label);
    txtLines.push('      收益: ' + c.expected_coins + ' 试炼币');
    txtLines.push('      等级要求: ' + (dungeons.find(d => Number(d.dungeon_id) === c.dungeon_id)?.level_min || '?') + '级');
  });
  txtLines.push('');
  txtLines.push('──────────────────────────────────────────────');
  txtLines.push('  以下 JSON 可直接复制粘贴到 gh-actions/trial_config.json');
  txtLines.push('──────────────────────────────────────────────');
  txtLines.push('');
  txtLines.push(JSON.stringify({ dungeons: dailyConfigs }, null, 2));
  txtLines.push('');
  txtLines.push('──────────────────────────────────────────────');
  txtLines.push('  无法通关的地图（等级/战力不足）');
  txtLines.push('──────────────────────────────────────────────');
  mapResults.filter(r => !r.best).forEach(r => {
    const dg = dungeons.find(d => Number(d.dungeon_id) === r.dungeonId);
    txtLines.push('  ❌ ' + r.dungeonName + ' (需求' + (dg?.level_min || '?') + '级)');
  });
  txtLines.push('');
  txtLines.push('--- END ---');

  const txtPath = path.join(__dirname, '..', 'trial_test_report.txt');
  fs.writeFileSync(txtPath, txtLines.join('\n'), 'utf8');
  console.log('  报告(TXT)已保存: ' + txtPath);
  console.log('\n═══════════════════════════════════════════');
  console.log('  全部完成 ✓');
  console.log('═══════════════════════════════════════════');
}

main().catch(e => {
  console.error('\n❌ 致命错误:', e.message, e.stack);
  process.exit(1);
});
