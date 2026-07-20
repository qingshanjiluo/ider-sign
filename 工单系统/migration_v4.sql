-- v4.0 Migration: 角色系统 + 修仙分 + 联系留言
-- 适用：已在运行的 D1 数据库，users 表已存在

-- 新增 role 字段（如果不存在）
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'super_admin'));

-- 新增 bonus_points 字段（如果不存在）
ALTER TABLE users ADD COLUMN bonus_points REAL DEFAULT 0;

-- 旧管理员 is_admin=1 自动升级为 admin 角色
UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role = '' OR role = 'user');

-- 设置种子管理员为 super_admin
UPDATE users SET role = 'super_admin' WHERE username = 'zzhx' AND (role IS NULL OR role = '' OR role = 'user');

-- 创建留言表
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
