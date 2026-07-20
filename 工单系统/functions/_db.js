// _db.js - 数据库连接辅助
export function getDb(context) {
  return context.env.DB;
}
