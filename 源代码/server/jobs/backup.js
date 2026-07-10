/**
 * 数据库自动备份
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../db');

function _escapeSqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function _ensureBackupDir() {
  const dir = path.resolve(config.gmBackupDir || './data/backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _cleanupOldBackups(dir, keepCount) {
  const keep = Math.max(1, Number(keepCount) || 30);
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.db'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { full, mtimeMs: Number(st.mtimeMs || 0) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length <= keep) return;
  for (let i = keep; i < files.length; i += 1) {
    try { fs.unlinkSync(files[i].full); } catch (_) {}
  }
}

function runAutoBackup(reason = 'timer') {
  if (db.isMysql) {
    console.log('[backup] skipped in mysql mode');
    return;
  }
  try {
    db.flushPlayerCache();  // 备份前落盘，避免漏掉缓存的玩家数据
    const dir = _ensureBackupDir();
    const ts = Math.floor(Date.now() / 1000);
    const outPath = path.join(dir, `backup_${ts}.db`);
    db.db.exec(`VACUUM INTO ${_escapeSqlString(outPath)}`);
    _cleanupOldBackups(dir, config.autoBackupKeepCount);
    console.log(`[backup] auto backup success (${reason}): ${outPath}`);
  } catch (e) {
    console.error('[backup] auto backup failed:', e && e.message ? e.message : e);
  }
}

function startBackupScheduler() {
  if (!config.autoBackupEnabled) return;
  const intervalMs = Math.max(300, Number(config.autoBackupIntervalSeconds) || 12 * 60 * 60) * 1000;
  setInterval(() => runAutoBackup('interval'), intervalMs);
  setTimeout(() => runAutoBackup('startup'), 20 * 1000);
}

module.exports = { runAutoBackup, startBackupScheduler };
