/**
 * 执行 V9 迁移 — 兑换码多次使用支持
 * 给 recharge_codes 表添加 max_uses 和 used_count 字段
 */
import { readFileSync } from 'fs';

const CLOUDFLARE_ACCOUNT_ID = '664cc8aa94cb585def8d27ec174fa417';
const DATABASE_ID = '9fd8cb75-d10e-4cf3-a0e0-3681e5a59ae8';
// 需要设置 CLOUDFLARE_API_TOKEN 环境变量
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!API_TOKEN) {
  console.error('错误: 请设置 CLOUDFLARE_API_TOKEN 环境变量');
  console.error('  set CLOUDFLARE_API_TOKEN=你的token');
  process.exit(1);
}

const SQL_STATEMENTS = [
  `ALTER TABLE recharge_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER DEFAULT 1`,
  `ALTER TABLE recharge_codes ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0`,
];

async function execSql(sql) {
  console.log(`执行: ${sql.substring(0, 80)}...`);
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  const data = await res.json();
  if (!data.success) {
    console.error('  失败:', JSON.stringify(data.errors));
    return false;
  }
  console.log('  成功');
  return true;
}

async function main() {
  console.log('=== V9 迁移: 兑换码多次使用支持 ===\n');
  for (const sql of SQL_STATEMENTS) {
    const ok = await execSql(sql);
    if (!ok) {
      console.error('\n迁移中断');
      process.exit(1);
    }
  }
  console.log('\n✅ V9 迁移完成!');
}

main().catch(e => { console.error(e); process.exit(1); });
