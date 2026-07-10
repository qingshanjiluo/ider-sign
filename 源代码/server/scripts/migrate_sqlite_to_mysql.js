#!/usr/bin/env node
/*
 * Migrate SQLite database (game.db) into MySQL.
 *
 * Usage:
 *   node scripts/migrate_sqlite_to_mysql.js --sqlite ./data/game.db --drop --batch 500
 *
 * Required env vars:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const out = {
    sqlitePath: path.resolve(__dirname, '..', 'data', 'game.db'),
    dropTables: false,
    batchSize: 500
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || '');
    if (a === '--sqlite' && argv[i + 1]) {
      out.sqlitePath = path.resolve(process.cwd(), String(argv[i + 1]));
      i += 1;
      continue;
    }
    if (a === '--drop') {
      out.dropTables = true;
      continue;
    }
    if (a === '--batch' && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) out.batchSize = Math.max(1, Math.min(5000, Math.trunc(n)));
      i += 1;
      continue;
    }
  }

  return out;
}

function reqEnv(key) {
  const v = String(process.env[key] || '').trim();
  if (!v) {
    throw new Error(`missing env: ${key}`);
  }
  return v;
}

function qSqliteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qMysqlIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function sqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

const BIGINT_MAX = BigInt('9223372036854775807');
const BIGINT_MIN = BigInt('-9223372036854775808');
const BIGINT_MAX_STR = '9223372036854775807';
const BIGINT_MIN_STR = '-9223372036854775808';

const DECIMAL_65_0_MAX = '9'.repeat(65);
const DECIMAL_65_0_MIN = `-${DECIMAL_65_0_MAX}`;

function parseDecimalType(mysqlType) {
  const m = /^DECIMAL\((\d+)\s*,\s*(\d+)\)/iu.exec(String(mysqlType || '').trim());
  if (!m) return null;
  const precision = Math.max(1, Math.min(65, Number(m[1]) || 65));
  const scale = Math.max(0, Math.min(65, Number(m[2]) || 0));
  const intDigits = Math.max(1, precision - scale);
  return { precision, scale, intDigits };
}

function buildDecimalCapString(spec, negative) {
  const intPart = '9'.repeat(Math.max(1, Number(spec?.intDigits) || 1));
  const scale = Math.max(0, Number(spec?.scale) || 0);
  const raw = scale > 0 ? `${intPart}.${'9'.repeat(scale)}` : intPart;
  return negative ? `-${raw}` : raw;
}

function isDefaultRestrictedType(mysqlType) {
  const t = String(mysqlType || '').toUpperCase();
  if (!t) return false;
  return [
    'TINYTEXT',
    'TEXT',
    'MEDIUMTEXT',
    'LONGTEXT',
    'TINYBLOB',
    'BLOB',
    'MEDIUMBLOB',
    'LONGBLOB',
    'JSON',
    'GEOMETRY',
    'POINT',
    'LINESTRING',
    'POLYGON',
    'MULTIPOINT',
    'MULTILINESTRING',
    'MULTIPOLYGON',
    'GEOMETRYCOLLECTION'
  ].some((p) => t.startsWith(p));
}

function normalizeDefault(rawDefault, mysqlType, isNotNull) {
  if (rawDefault == null) return '';
  const raw = String(rawDefault).trim();
  if (!raw) return '';

  if (isDefaultRestrictedType(mysqlType)) {
    // MySQL/MariaDB commonly reject explicit defaults on large text/blob/json-like columns.
    return '';
  }

  if (/^null$/i.test(raw)) return isNotNull ? '' : ' DEFAULT NULL';
  if (/^strftime\('%s'\s*,\s*'now'\)$/i.test(raw)) return ' DEFAULT 0';
  if (/^current_timestamp(\(\))?$/i.test(raw)) {
    return /^DATETIME|^TIMESTAMP/i.test(String(mysqlType || ''))
      ? ' DEFAULT CURRENT_TIMESTAMP'
      : '';
  }

  const num = raw.replace(/^\((.*)\)$/u, '$1');
  if (/^-?\d+(\.\d+)?$/u.test(num)) return ` DEFAULT ${num}`;

  let text = raw;
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1);
  }
  text = text.replace(/''/g, "'");
  return ` DEFAULT ${sqlString(text)}`;
}

function mapColumnType(typeText, opts = {}) {
  const isIndexed = !!opts.isIndexed;
  const isPk = !!opts.isPk;
  const isAutoInc = !!opts.isAutoIncrement;
  const colName = String(opts.colName || '');
  const t = String(typeText || '').toUpperCase();

  if (t.includes('INT')) {
    // Keep identifiers as BIGINT for common join semantics;
    // use wide DECIMAL for other integer-like value columns (price/count/etc.).
    if (isPk || isAutoInc || /(^|_)id$/i.test(colName)) return 'BIGINT';
    return 'DECIMAL(65,0)';
  }
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE';
  if (t.includes('NUM') || t.includes('DEC')) return 'DECIMAL(65,20)';
  if (t.includes('BOOL')) return 'TINYINT(1)';
  if (t.includes('BLOB')) return 'LONGBLOB';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT') || t === '') {
    return isIndexed ? 'VARCHAR(255)' : 'LONGTEXT';
  }
  return isIndexed ? 'VARCHAR(255)' : 'LONGTEXT';
}

function buildMysqlColumnTypeMap(columns, indexes, autoIncPkCol) {
  const indexedColSet = new Set();
  for (const idx of (Array.isArray(indexes) ? indexes : [])) {
    for (const c of (Array.isArray(idx.columns) ? idx.columns : [])) indexedColSet.add(c);
  }

  const pkCols = (Array.isArray(columns) ? columns : [])
    .filter((c) => Number(c.pk || 0) > 0)
    .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0))
    .map((c) => String(c.name));

  const typeByColumn = new Map();
  for (const col of (Array.isArray(columns) ? columns : [])) {
    const colName = String(col.name || '');
    const isPk = pkCols.includes(colName);
    const isIndexed = indexedColSet.has(colName) || isPk;
    const isAutoIncrement = colName === autoIncPkCol;
    const colType = mapColumnType(col.type, {
      isIndexed,
      isPk,
      isAutoIncrement,
      colName
    });
    typeByColumn.set(colName, colType);
  }

  return { pkCols, typeByColumn };
}

function getTableNames(sqliteDb) {
  return sqliteDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all()
    .map((r) => String(r.name));
}

function getTableCreateSql(sqliteDb, tableName) {
  const row = sqliteDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName);
  return String(row?.sql || '');
}

function getTableColumns(sqliteDb, tableName) {
  const sql = `PRAGMA table_info(${qSqliteIdent(tableName)})`;
  return sqliteDb.prepare(sql).all();
}

function getTableIndexes(sqliteDb, tableName) {
  const listSql = `PRAGMA index_list(${qSqliteIdent(tableName)})`;
  const idxRows = sqliteDb.prepare(listSql).all();

  const out = [];
  for (const idx of idxRows) {
    const idxName = String(idx.name || '');
    if (!idxName) continue;
    if (String(idx.origin || '') === 'pk') continue;

    const infoSql = `PRAGMA index_info(${qSqliteIdent(idxName)})`;
    const infoRows = sqliteDb.prepare(infoSql).all();
    const cols = infoRows
      .map((r) => String(r.name || '').trim())
      .filter((c) => c.length > 0);

    if (cols.length <= 0) {
      out.push({
        name: idxName,
        unique: Number(idx.unique || 0) === 1,
        columns: [],
        unsupportedExpression: true
      });
      continue;
    }

    out.push({
      name: idxName,
      unique: Number(idx.unique || 0) === 1,
      columns: cols,
      unsupportedExpression: false
    });
  }

  return out;
}

function getAutoIncrementPkCol(createSql, columns) {
  if (!/AUTOINCREMENT/i.test(String(createSql || ''))) return '';
  const pkCols = columns
    .filter((c) => Number(c.pk || 0) > 0)
    .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0));
  if (pkCols.length !== 1) return '';
  const typeText = String(pkCols[0].type || '').toUpperCase();
  if (!typeText.includes('INT')) return '';
  return String(pkCols[0].name || '');
}

function buildCreateTableSql(tableName, columns, indexes, autoIncPkCol) {
  const { pkCols, typeByColumn } = buildMysqlColumnTypeMap(columns, indexes, autoIncPkCol);

  const defs = [];
  for (const col of columns) {
    const colName = String(col.name || '');
    const isPk = pkCols.includes(colName);
    const isNotNull = Number(col.notnull || 0) === 1 || isPk;
    const isAutoIncrement = colName === autoIncPkCol;
    const colType = String(typeByColumn.get(colName) || mapColumnType(col.type, { colName }));

    let d = `${qMysqlIdent(colName)} ${colType}`;
    // Keep username semantics consistent with SQLite (case-sensitive uniqueness & lookup).
    if (tableName === 'accounts' && colName === 'username') {
      d += ' COLLATE utf8mb4_bin';
    }
    if (isNotNull) d += ' NOT NULL';
    if (!isAutoIncrement) {
      d += normalizeDefault(col.dflt_value, colType, isNotNull);
    }
    if (isAutoIncrement) d += ' AUTO_INCREMENT';
    defs.push(d);
  }

  if (pkCols.length > 0) {
    defs.push(`PRIMARY KEY (${pkCols.map((c) => qMysqlIdent(c)).join(', ')})`);
  }

  return [
    `CREATE TABLE IF NOT EXISTS ${qMysqlIdent(tableName)} (`,
    `  ${defs.join(',\n  ')}`,
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  ].join('\n');
}

function normalizeValue(v) {
  if (v === undefined) return null;
  return v;
}

function normalizeBigIntValue(v) {
  if (v == null) return null;
  try {
    if (typeof v === 'bigint') {
      if (v > BIGINT_MAX) return BIGINT_MAX_STR;
      if (v < BIGINT_MIN) return BIGINT_MIN_STR;
      return v.toString();
    }

    const text = String(v).trim();
    if (!text) return null;

    if (/^[+-]?\d+$/u.test(text)) {
      let bi;
      try {
        bi = BigInt(text);
      } catch (_) {
        return text.startsWith('-') ? BIGINT_MIN_STR : BIGINT_MAX_STR;
      }
      if (bi > BIGINT_MAX) return BIGINT_MAX_STR;
      if (bi < BIGINT_MIN) return BIGINT_MIN_STR;
      return bi.toString();
    }

    const num = Number(text);
    if (!Number.isFinite(num)) return num < 0 ? BIGINT_MIN_STR : BIGINT_MAX_STR;
    if (num >= 9.223372036854776e18) return BIGINT_MAX_STR;
    if (num <= -9.223372036854776e18) return BIGINT_MIN_STR;
    return String(Math.trunc(num));
  } catch (_) {
    return '0';
  }
}

function normalizeDecimal650Value(v) {
  if (v == null) return null;
  try {
    if (typeof v === 'bigint') {
      const s = v.toString();
      const neg = s.startsWith('-');
      const digits = (neg ? s.slice(1) : s).replace(/^0+(?=\d)/u, '');
      if (digits.length > 65) return neg ? DECIMAL_65_0_MIN : DECIMAL_65_0_MAX;
      return `${neg ? '-' : ''}${digits || '0'}`;
    }

    const text = String(v).trim();
    if (!text) return null;

    if (/^[+-]?\d+$/u.test(text)) {
      const neg = text.startsWith('-');
      const digits = text.replace(/^[+-]/u, '').replace(/^0+(?=\d)/u, '');
      if (digits.length > 65) return neg ? DECIMAL_65_0_MIN : DECIMAL_65_0_MAX;
      return `${neg ? '-' : ''}${digits || '0'}`;
    }

    const num = Number(text);
    if (!Number.isFinite(num)) return num < 0 ? DECIMAL_65_0_MIN : DECIMAL_65_0_MAX;
    if (num >= 1e65) return DECIMAL_65_0_MAX;
    if (num <= -1e65) return DECIMAL_65_0_MIN;
    return String(Math.trunc(num));
  } catch (_) {
    return '0';
  }
}

function normalizeDecimalValue(v, mysqlType) {
  const spec = parseDecimalType(mysqlType);
  if (!spec) return normalizeValue(v);
  if (spec.precision === 65 && spec.scale === 0) return normalizeDecimal650Value(v);

  if (v == null) return null;
  const maxVal = buildDecimalCapString(spec, false);
  const minVal = buildDecimalCapString(spec, true);

  try {
    const text = String(v).trim();
    if (!text) return null;

    if (/^[+-]?\d+(\.\d+)?$/u.test(text)) {
      const neg = text.startsWith('-');
      const plain = text.replace(/^[+-]/u, '');
      const [intRaw, fracRaw = ''] = plain.split('.');
      const intPart = String(intRaw || '0').replace(/^0+(?=\d)/u, '');
      if (intPart.length > spec.intDigits) return neg ? minVal : maxVal;

      if (spec.scale <= 0) return `${neg ? '-' : ''}${intPart || '0'}`;

      const frac = String(fracRaw || '').replace(/\D/gu, '').slice(0, spec.scale).padEnd(spec.scale, '0');
      return `${neg ? '-' : ''}${intPart || '0'}.${frac}`;
    }

    const num = Number(text);
    if (!Number.isFinite(num)) return num < 0 ? minVal : maxVal;

    const threshold = Number(`1e${spec.intDigits}`);
    if (Number.isFinite(threshold)) {
      if (num >= threshold) return maxVal;
      if (num <= -threshold) return minVal;
    }

    if (spec.scale <= 0) return String(Math.trunc(num));
    return text;
  } catch (_) {
    return spec.scale > 0 ? `0.${'0'.repeat(spec.scale)}` : '0';
  }
}

function normalizeValueByMysqlType(v, mysqlType) {
  if (v === undefined) return null;
  const t = String(mysqlType || '').toUpperCase();
  if (!t) return normalizeValue(v);

  if (t === 'BIGINT') return normalizeBigIntValue(v);
  if (t.startsWith('DECIMAL(')) return normalizeDecimalValue(v, t);

  return normalizeValue(v);
}

async function insertRowsInBatches(mysqlConn, tableName, columns, rowIter, batchSize, typeByColumn) {
  const colList = columns.map((c) => qMysqlIdent(c)).join(', ');
  const oneRowPh = `(${columns.map(() => '?').join(', ')})`;

  let batch = [];
  let inserted = 0;

  async function flush() {
    if (batch.length <= 0) return;
    const values = [];
    const groups = [];
    for (const row of batch) {
      groups.push(oneRowPh);
      for (const c of columns) {
        const mysqlType = typeByColumn instanceof Map ? typeByColumn.get(c) : '';
        values.push(normalizeValueByMysqlType(row[c], mysqlType));
      }
    }
    const sql = `INSERT INTO ${qMysqlIdent(tableName)} (${colList}) VALUES ${groups.join(', ')}`;
    await mysqlConn.query(sql, values);
    inserted += batch.length;
    batch = [];
  }

  for (const row of rowIter) {
    batch.push(row);
    if (batch.length >= batchSize) {
      await flush();
    }
  }
  await flush();

  return inserted;
}

async function main() {
  const args = parseArgs(process.argv);
  const sqlitePath = args.sqlitePath;

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`sqlite file not found: ${sqlitePath}`);
  }

  const mysqlHost = reqEnv('MYSQL_HOST');
  const mysqlPort = Number(process.env.MYSQL_PORT || 3306);
  const mysqlUser = reqEnv('MYSQL_USER');
  const mysqlPassword = String(process.env.MYSQL_PASSWORD || '');
  const mysqlDatabase = reqEnv('MYSQL_DATABASE');

  console.log('[migrate] sqlite:', sqlitePath);
  console.log('[migrate] mysql :', `${mysqlHost}:${mysqlPort}/${mysqlDatabase}`);
  console.log('[migrate] options:', JSON.stringify({ dropTables: args.dropTables, batchSize: args.batchSize }));

  const sqliteDb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const tables = getTableNames(sqliteDb);
  if (tables.length <= 0) {
    console.log('[migrate] no tables found. exit.');
    sqliteDb.close();
    return;
  }

  let mysqlConn = null;
  const tableMeta = new Map();

  try {
    mysqlConn = await mysql.createConnection({
      host: mysqlHost,
      port: mysqlPort,
      user: mysqlUser,
      password: mysqlPassword,
      multipleStatements: false,
      charset: 'utf8mb4'
    });

    await mysqlConn.query(
      `CREATE DATABASE IF NOT EXISTS ${qMysqlIdent(mysqlDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await mysqlConn.changeUser({ database: mysqlDatabase });

    await mysqlConn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tables) {
      const columns = getTableColumns(sqliteDb, table);
      const indexes = getTableIndexes(sqliteDb, table);
      const createSql = getTableCreateSql(sqliteDb, table);
      const autoIncPkCol = getAutoIncrementPkCol(createSql, columns);

      if (columns.length <= 0) {
        console.log(`[migrate] skip empty schema table: ${table}`);
        continue;
      }

      tableMeta.set(table, { columns, indexes, autoIncPkCol });

      if (args.dropTables) {
        await mysqlConn.query(`DROP TABLE IF EXISTS ${qMysqlIdent(table)}`);
      }

      const ddl = buildCreateTableSql(table, columns, indexes, autoIncPkCol);
      await mysqlConn.query(ddl);
      console.log(`[migrate] schema ready: ${table}`);
    }

    for (const table of tables) {
      const meta = tableMeta.get(table);
      if (!meta || !Array.isArray(meta.columns) || meta.columns.length <= 0) continue;

      await mysqlConn.query(`DELETE FROM ${qMysqlIdent(table)}`);

      const colNames = meta.columns.map((c) => String(c.name));
      const { typeByColumn } = buildMysqlColumnTypeMap(meta.columns, meta.indexes, meta.autoIncPkCol || '');
      const stmt = sqliteDb.prepare(`SELECT * FROM ${qSqliteIdent(table)}`);
      const inserted = await insertRowsInBatches(
        mysqlConn,
        table,
        colNames,
        stmt.iterate(),
        args.batchSize,
        typeByColumn
      );
      console.log(`[migrate] data imported: ${table} (${inserted} rows)`);
    }

    for (const table of tables) {
      const meta = tableMeta.get(table);
      if (!meta || !Array.isArray(meta.indexes)) continue;

      for (const idx of meta.indexes) {
        if (idx.unsupportedExpression) {
          console.log(`[migrate] skip expression index: ${table}.${idx.name}`);
          continue;
        }
        if (!Array.isArray(idx.columns) || idx.columns.length <= 0) continue;

        const sql = idx.unique
          ? `CREATE UNIQUE INDEX ${qMysqlIdent(idx.name)} ON ${qMysqlIdent(table)} (${idx.columns.map((c) => qMysqlIdent(c)).join(', ')})`
          : `CREATE INDEX ${qMysqlIdent(idx.name)} ON ${qMysqlIdent(table)} (${idx.columns.map((c) => qMysqlIdent(c)).join(', ')})`;

        try {
          await mysqlConn.query(sql);
          console.log(`[migrate] index created: ${table}.${idx.name}`);
        } catch (e) {
          const msg = String(e?.message || e);
          console.log(`[migrate] index skip: ${table}.${idx.name} -> ${msg}`);
        }
      }
    }

    await mysqlConn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[migrate] done.');
  } finally {
    try {
      if (mysqlConn) await mysqlConn.end();
    } catch (_) {}
    try {
      sqliteDb.close();
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err?.message || err);
  process.exit(1);
});
