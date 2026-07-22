-- 迁移 v10: 角色创建完善 - 新增 character_name / spirit_roots / operator_id 字段
-- 参考批量注册工具的工作流：注册→创角(灵根)→技能装备→铁剑→功法→地图

-- game_accounts 表新增字段
ALTER TABLE game_accounts ADD COLUMN character_name TEXT DEFAULT '';
-- character_name: 游戏中创建的角色名（游戏内名称，非账号名）

ALTER TABLE game_accounts ADD COLUMN spirit_roots TEXT DEFAULT '{"metal":0,"wood":0,"water":0,"fire":0,"earth":0}';
-- spirit_roots: 灵根配置 JSON，格式: {"metal":100,"wood":0,"water":0,"fire":0,"earth":0}

ALTER TABLE game_accounts ADD COLUMN operator_id INTEGER DEFAULT 0;
-- operator_id: 操作人/审核人用户ID（记录谁创建/处理了这个账号）

ALTER TABLE game_accounts ADD COLUMN operator_name TEXT DEFAULT '';
-- operator_name: 操作人用户名（冗余字段，方便展示）

ALTER TABLE game_accounts ADD COLUMN created_result TEXT DEFAULT '';
-- created_result: 角色创建结果JSON（记录返回的accountId、playerName等）

ALTER TABLE game_accounts ADD COLUMN setup_status TEXT DEFAULT 'pending';
-- setup_status: 完整Setup状态（pending/creating/skills/technique/map/battle/done/error）

ALTER TABLE game_accounts ADD COLUMN technique_id INTEGER DEFAULT 0;
-- technique_id: 已设置的功法ID

ALTER TABLE game_accounts ADD COLUMN map_id INTEGER DEFAULT 0;
-- map_id: 已切换的地图ID

ALTER TABLE game_accounts ADD COLUMN equipped_skills TEXT DEFAULT '[]';
-- equipped_skills: 已装备的技能ID列表 JSON

ALTER TABLE game_accounts ADD COLUMN battle_auto_restart INTEGER DEFAULT 0;
-- battle_auto_restart: 是否已开启自动刷怪

-- orders 表新增字段（可选，用于追踪角色创建进度）
ALTER TABLE orders ADD COLUMN total_accounts_created INTEGER DEFAULT 0;
-- total_accounts_created: 已创建的角色数
