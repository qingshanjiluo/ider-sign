/**
 * 环境测试脚本
 * 验证服务器连接、API可用性和游戏客户端功能
 */

const GameClient = require('./game_client');

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:3000';

async function testServer() {
  console.log('='.repeat(50));
  console.log('艾德尔修仙传 AI 训练环境测试');
  console.log('='.repeat(50));
  console.log(`服务器: ${SERVER_URL}\n`);

  const client = new GameClient(SERVER_URL);

  // 1. 测试服务器健康检查
  console.log('1. 测试服务器健康检查...');
  try {
    const http = require('http');
    const health = await new Promise((resolve, reject) => {
      http.get(`${SERVER_URL}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    console.log(`   ✓ 服务器运行中: uptime=${health.uptime_sec}s, db=${health.db_driver}`);
  } catch (e) {
    console.error(`   ✗ 服务器连接失败: ${e.message}`);
    console.log('  请先启动服务器: cd 源代码/server && node index.js');
    return false;
  }

  // 2. 测试游戏数据加载
  console.log('\n2. 测试游戏数据加载...');
  try {
    const gameData = await client.getGameData();
    if (gameData) {
      console.log(`   ✓ 游戏数据加载成功`);
      console.log(`     地图: ${gameData.maps?.length || 0}个`);
      console.log(`     物品: ${gameData.items?.length || 0}个`);
      console.log(`     技能: ${gameData.skills?.length || 0}个`);
      console.log(`     敌人: ${gameData.enemies?.length || 0}个`);
      console.log(`     副本: ${gameData.dungeons?.length || 0}个`);
    }
  } catch (e) {
    console.error(`   ✗ 游戏数据加载失败: ${e.message}`);
  }

  // 3. 测试注册和登录
  console.log('\n3. 测试注册和登录...');
  const testUsername = `test_bot_${Date.now().toString(36)}`;
  const testPassword = 'test123456';
  
  try {
    const regResult = await client.register(testUsername, testPassword);
    if (regResult.ok) {
      console.log(`   ✓ 注册成功: accountId=${regResult.accountId}`);
    } else {
      console.log(`   ? 注册结果: ${regResult.error}`);
    }
  } catch (e) {
    console.error(`   ✗ 注册失败: ${e.message}`);
  }

  // 4. 测试创建角色
  console.log('\n4. 测试创建角色...');
  try {
    const createResult = await client.createCharacter(`测试_${Date.now().toString(36)}`);
    if (createResult.ok) {
      console.log(`   ✓ 角色创建成功: ${createResult.player.name}`);
      console.log(`     等级: ${createResult.player.level}`);
      console.log(`     生命: ${createResult.player.hp}/${createResult.player.max_hp}`);
      console.log(`     灵力: ${createResult.player.mp}/${createResult.player.max_mp}`);
    } else {
      console.log(`   ? 创建结果: ${createResult.error}`);
    }
  } catch (e) {
    console.error(`   ✗ 创建角色失败: ${e.message}`);
  }

  // 5. 测试同步
  console.log('\n5. 测试数据同步...');
  try {
    const syncResult = await client.sync('heavy');
    if (syncResult.ok) {
      const combat = client.getCombatSummary();
      console.log(`   ✓ 同步成功`);
      console.log(`     等级: ${combat.level}`);
      console.log(`     攻击: ${combat.attack}`);
      console.log(`     防御: ${combat.defense}`);
      console.log(`     灵石: ${combat.spirit_stones}`);
      
      const inventory = client.getInventory();
      console.log(`     背包物品: ${inventory.length}个`);
    }
  } catch (e) {
    console.error(`   ✗ 同步失败: ${e.message}`);
  }

  // 6. 测试战斗系统
  console.log('\n6. 测试战斗系统...');
  try {
    const mapId = client.getRecommendedMap();
    console.log(`   推荐地图ID: ${mapId}`);
    
    const battleResult = await client.battleStart(mapId, true, true);
    if (battleResult.ok) {
      console.log(`   ✓ 战斗开始成功: battleId=${battleResult.battleId}`);
      
      // 轮询几次战斗
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 500));
        const pollResult = await client.battlePoll(i * 10);
        if (pollResult.ended) {
          console.log(`   ✓ 战斗结束: victory=${pollResult.victory}`);
          if (pollResult.rewards) {
            console.log(`     奖励: exp=${pollResult.rewards.exp || 0}, 灵石=${pollResult.rewards.spirit_stones || 0}`);
          }
          break;
        } else if (pollResult.active === false) {
          console.log(`   ? 战斗未激活`);
          break;
        }
      }
    } else {
      console.log(`   ? 战斗开始结果: ${battleResult.error}`);
    }
  } catch (e) {
    console.error(`   ✗ 战斗测试失败: ${e.message}`);
  }

  // 7. 测试升级
  console.log('\n7. 测试升级系统...');
  try {
    // 先同步最新数据
    await client.sync('fast');
    const levelBefore = client.player?.level || 1;
    console.log(`   当前等级: ${levelBefore}`);
    
    const levelResult = await client.levelUp();
    if (levelResult.ok) {
      console.log(`   ✓ 升级成功: ${levelBefore} -> ${levelResult.player.level}`);
    } else {
      console.log(`   ? 升级结果: ${levelResult.error}`);
    }
  } catch (e) {
    console.error(`   ✗ 升级测试失败: ${e.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('测试完成!');
  console.log('='.repeat(50));
  
  return true;
}

testServer().catch(console.error);
