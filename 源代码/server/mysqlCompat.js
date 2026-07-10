const SyncMysql = require('sync-mysql');

function intVal(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function normalizeSql(sql) {
  let out = String(sql || '').trim();
  if (!out) return out;

  out = out.replace(/\bstrftime\(\s*'%s'\s*,\s*'now'\s*\)/gi, 'UNIX_TIMESTAMP()');
  out = out.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'REPLACE INTO');
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO');
  out = out.replace(/\bSELECT\s+last_insert_rowid\s*\(\s*\)\s+AS\s+id\b/gi, 'SELECT LAST_INSERT_ID() AS id');
  out = out.replace(/\bON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');

  // sqlite json_type(data, '$.x') -> mysql JSON_TYPE(JSON_EXTRACT(data, '$.x'))
  out = out.replace(/json_type\s*\(\s*([^,()]+?)\s*,\s*('[^']*')\s*\)/gi, 'JSON_TYPE(JSON_EXTRACT($1, $2))');

  // sqlite json_type(json_extract(...)) -> mysql JSON_TYPE(JSON_EXTRACT(...))
  out = out.replace(/json_type\s*\(\s*json_extract\s*\(([^)]*)\)\s*\)/gi, 'JSON_TYPE(JSON_EXTRACT($1))');

  // keep JSON_EXTRACT in mysql style
  out = out.replace(/\bjson_extract\s*\(/gi, 'JSON_EXTRACT(');

  // String comparisons against SQLite json_extract(...) need JSON_UNQUOTE(...) in MySQL.
  out = out.replace(/COALESCE\(\s*JSON_EXTRACT\(([^)]*)\)\s*,/gi, 'COALESCE(JSON_UNQUOTE(JSON_EXTRACT($1)),');
  out = out.replace(/,\s*JSON_EXTRACT\(([^)]*)\)\s*,/gi, ', JSON_UNQUOTE(JSON_EXTRACT($1)),');
  out = out.replace(/JSON_EXTRACT\(([^()]+?)\)\s+(=|IN\b)/gi, 'JSON_UNQUOTE(JSON_EXTRACT($1)) $2');
  out = out.replace(/JSON_TYPE\(JSON_EXTRACT\(([^)]*)\)\)\s*=\s*'([a-z_]+)'/gi, (_m, expr, type) => {
    return `UPPER(JSON_TYPE(JSON_EXTRACT(${expr}))) = '${String(type || '').toUpperCase()}'`;
  });

  // mysql does not support IF NOT EXISTS for CREATE INDEX in common versions
  out = out.replace(/\bCREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE UNIQUE INDEX');
  out = out.replace(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE INDEX');

  return out;
}

function splitSqlStatements(sql) {
  const src = String(sql || '');
  const out = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = i + 1 < src.length ? src[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        cur += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      cur += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      cur += ch;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      cur += ch;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const s = cur.trim();
      if (s) out.push(s);
      cur = '';
      continue;
    }

    cur += ch;
  }

  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

function normalizeError(err) {
  const e = err || new Error('unknown mysql error');
  const code = String(e.code || '');
  if (code === 'ER_DUP_ENTRY' || code === 'ER_DUP_KEYNAME') {
    e.code = 'SQLITE_CONSTRAINT_UNIQUE';
  } else if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_ROW_IS_REFERENCED_2') {
    e.code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
  }
  return e;
}

class MysqlCompatStatement {
  constructor(db, sql) {
    this._db = db;
    this._sql = String(sql || '');
  }

  run(...args) {
    return this._db._queryRun(this._sql, args);
  }

  get(...args) {
    return this._db._queryGet(this._sql, args);
  }

  all(...args) {
    return this._db._queryAll(this._sql, args);
  }
}

class MysqlCompatDb {
  constructor(config) {
    const host = String(config.mysqlHost || process.env.MYSQL_HOST || '').trim();
    const user = String(config.mysqlUser || process.env.MYSQL_USER || '').trim();
    const password = String(config.mysqlPassword || process.env.MYSQL_PASSWORD || '');
    const database = String(config.mysqlDatabase || process.env.MYSQL_DATABASE || '').trim();
    const port = intVal(config.mysqlPort || process.env.MYSQL_PORT, 3306);

    if (!host || !user || !database) {
      throw new Error('mysql config missing: MYSQL_HOST / MYSQL_USER / MYSQL_DATABASE');
    }

    this._conn = new SyncMysql({
      host,
      port,
      user,
      password,
      database,
      timezone: 'Z',
      charset: 'utf8mb4'
    });

    this._txDepth = 0;
  }

  pragma(_sql) {
    return null;
  }

  prepare(sql) {
    return new MysqlCompatStatement(this, sql);
  }

  exec(sql) {
    const list = splitSqlStatements(sql).map(normalizeSql).filter(Boolean);
    for (const s of list) {
      try {
        this._conn.query(s);
      } catch (e) {
        const err = normalizeError(e);
        // CREATE INDEX duplicate key name should be ignored for idempotent startup.
        if (String(err.code || '') === 'SQLITE_CONSTRAINT_UNIQUE' && /CREATE\s+(UNIQUE\s+)?INDEX/i.test(s)) {
          continue;
        }
        throw err;
      }
    }
  }

  transaction(fn) {
    const wrapped = (...args) => {
      const nested = this._txDepth > 0;
      const savepoint = nested ? `sp_${Date.now()}_${Math.floor(Math.random() * 100000)}` : '';
      try {
        if (nested) this._conn.query(`SAVEPOINT ${savepoint}`);
        else this._conn.query('START TRANSACTION');

        this._txDepth += 1;
        const ret = fn(...args);
        this._txDepth -= 1;

        if (nested) this._conn.query(`RELEASE SAVEPOINT ${savepoint}`);
        else this._conn.query('COMMIT');

        return ret;
      } catch (e) {
        this._txDepth = Math.max(0, this._txDepth - 1);
        try {
          if (nested) this._conn.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          else this._conn.query('ROLLBACK');
        } catch (_) {}
        throw normalizeError(e);
      }
    };
    wrapped.immediate = wrapped;
    return wrapped;
  }

  _queryRun(sql, args) {
    const s = normalizeSql(sql);
    try {
      const r = this._conn.query(s, args || []);
      if (Array.isArray(r)) return { changes: 0, lastInsertRowid: 0 };
      return {
        changes: intVal(r?.affectedRows, 0),
        lastInsertRowid: intVal(r?.insertId, 0)
      };
    } catch (e) {
      throw normalizeError(e);
    }
  }

  _queryGet(sql, args) {
    const rows = this._queryAll(sql, args);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  }

  _queryAll(sql, args) {
    const s = normalizeSql(sql);
    try {
      const r = this._conn.query(s, args || []);
      return Array.isArray(r) ? r : [];
    } catch (e) {
      throw normalizeError(e);
    }
  }
}

function createMysqlCompatDb(config) {
  return new MysqlCompatDb(config);
}

module.exports = {
  createMysqlCompatDb,
  normalizeSql
};
