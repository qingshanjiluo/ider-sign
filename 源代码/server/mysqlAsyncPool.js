const mysql = require('mysql2/promise');
const config = require('./config');

let _pool = null;

function _isMysqlDriver() {
  return String(config.dbDriver || '').toLowerCase() === 'mysql';
}

function _isAllowedInSqliteMode() {
  const raw = String(process.env.MYSQL_ASYNC_ALLOW_WITH_SQLITE || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isAsyncEnabled() {
  return _isMysqlDriver() || _isAllowedInSqliteMode();
}

function _buildPoolOptions() {
  return {
    host: String(config.mysqlHost || process.env.MYSQL_HOST || '127.0.0.1'),
    port: Number(config.mysqlPort || process.env.MYSQL_PORT || 3306),
    user: String(config.mysqlUser || process.env.MYSQL_USER || ''),
    password: String(config.mysqlPassword || process.env.MYSQL_PASSWORD || ''),
    database: String(config.mysqlDatabase || process.env.MYSQL_DATABASE || ''),
    timezone: 'Z',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: (() => {
      const v = Number(process.env.MYSQL_ASYNC_CONN_LIMIT);
      return Number.isFinite(v) && v > 0 ? Math.max(2, Math.floor(v)) : 20;
    })(),
    queueLimit: (() => {
      const v = Number(process.env.MYSQL_ASYNC_QUEUE_LIMIT);
      return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    })(),
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
  };
}

async function getPool() {
  if (!isAsyncEnabled()) return null;
  if (_pool) return _pool;
  const opts = _buildPoolOptions();
  if (!opts.user || !opts.database) {
    throw new Error('mysql async pool missing MYSQL_USER / MYSQL_DATABASE');
  }
  _pool = mysql.createPool(opts);
  return _pool;
}

async function ping() {
  const pool = await getPool();
  if (!pool) return false;
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1 AS ok');
    return true;
  } finally {
    try { conn.release(); } catch (_) {}
  }
}

async function query(sql, params = []) {
  const pool = await getPool();
  if (!pool) throw new Error('mysql async pool disabled (set DB_DRIVER=mysql or MYSQL_ASYNC_ALLOW_WITH_SQLITE=1)');
  const [rows] = await pool.query(String(sql || ''), Array.isArray(params) ? params : []);
  return rows;
}

async function execute(sql, params = []) {
  const pool = await getPool();
  if (!pool) throw new Error('mysql async pool disabled (set DB_DRIVER=mysql or MYSQL_ASYNC_ALLOW_WITH_SQLITE=1)');
  const [ret] = await pool.execute(String(sql || ''), Array.isArray(params) ? params : []);
  return ret;
}

async function close() {
  if (!_pool) return;
  try {
    await _pool.end();
  } finally {
    _pool = null;
  }
}

module.exports = {
  isAsyncEnabled,
  getPool,
  ping,
  query,
  execute,
  close
};
