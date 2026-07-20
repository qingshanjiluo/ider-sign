/**
 * run_migration_v8.js — 执行 migration_v8.sql
 * 使用 Cloudflare D1 HTTP API 执行 SQL
 */
const https = require('https');

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DB_ID = '9fd8cb75-d10e-4cf3-a0e0-3681e5a59ae8';

if (!TOKEN || !ACCOUNT_ID) {
  console.error('错误: 请设置 CF_API_TOKEN 和 CF_ACCOUNT_ID 环境变量');
  process.exit(1);
}

const SQL_STATEMENTS = [
  "ALTER TABLE coupons ADD COLUMN coupon_type TEXT DEFAULT 'percent'",
  "ALTER TABLE coupons ADD COLUMN fixed_amount REAL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN frozen_points REAL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN invite_code_used TEXT DEFAULT ''"
];

function execSql(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sql });
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('解析响应失败: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== 执行 migration_v8.sql ===\n');
  
  for (const sql of SQL_STATEMENTS) {
    console.log(`执行: ${sql}`);
    try {
      const result = await execSql(sql);
      if (result.success) {
        console.log('  ✓ 成功');
      } else {
        console.log('  ✗ 失败:', JSON.stringify(result.errors));
      }
    } catch (err) {
      console.log('  ✗ 错误:', err.message);
    }
  }
  
  console.log('\n=== 迁移完成 ===');
}

main();
