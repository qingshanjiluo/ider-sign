/**
 * 服务端配置
 * 部署时可通过环境变量覆盖
 */
function splitSecretList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => String(s || '').trim())
    .filter(Boolean);
}

const _legacyPasswordPeppers = Array.from(new Set([
  ...splitSecretList(process.env.LEGACY_PASSWORD_PEPPER),
  ...splitSecretList(process.env.LEGACY_PASSWORD_PEPPERS),
  ...splitSecretList(process.env.JWT_SECRET_LEGACY)
]));

module.exports = {
  // 最低兼容客户端版本（如 "1.0.0"，低于此版本的客户端将被拒绝）
  minClientVersion: '0.0.0',
  // 服务端期望的最新客户端版本（登录器会据此判断是否需要热更新）
  latestClientVersion: '1.2.4',
  // 更新下载地址（版本过旧时提示用户前往）
  updateDownloadUrl: process.env.UPDATE_DOWNLOAD_URL || '',
  // 热更新 pck 对外路径（由服务端静态托管）
  hotUpdatePckPath: 'https://idlexiuxian-1367843870.cos.ap-guangzhou.myqcloud.com/client_hotfix.pck',
  // GM 工具鉴权令牌（请务必在环境变量中设置复杂随机值）
  gmToolToken: process.env.GM_TOOL_TOKEN || 'qingdeg666222rag',
  // 数据库备份目录（用于 GM 回档）
  gmBackupDir: process.env.GM_BACKUP_DIR || './data/backups',
  // 自动备份：默认开启，每12小时一次，保留最近30份
  autoBackupEnabled: String(process.env.AUTO_BACKUP_ENABLED || '1') !== '0',
  autoBackupIntervalSeconds: (() => { const v = Number(process.env.AUTO_BACKUP_INTERVAL_SECONDS); return Number.isFinite(v) && v >= 300 ? Math.floor(v) : 12 * 60 * 60; })(),
  autoBackupKeepCount: (() => { const v = Number(process.env.AUTO_BACKUP_KEEP_COUNT); return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 30; })(),
  // 监听端口
  port: process.env.PORT || 3000,
  // 运行时数据库驱动：sqlite / mysql
  dbDriver: String(process.env.DB_DRIVER || 'sqlite').toLowerCase(),
  // 数据库路径（SQLite 文件，与游戏服务同机）
  dbPath: process.env.DB_PATH || './data/game.db',
  // MySQL 连接配置（DB_DRIVER=mysql 时生效）
  mysqlHost: process.env.MYSQL_HOST || '127.0.0.1',
  mysqlPort: (() => { const v = Number(process.env.MYSQL_PORT); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 3306; })(),
  mysqlUser: process.env.MYSQL_USER || '',
  mysqlPassword: process.env.MYSQL_PASSWORD || '',
  mysqlDatabase: process.env.MYSQL_DATABASE || 'xianxia_game',
  // JWT 密钥（务必修改为随机字符串，可运行 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 生成）
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-use-env',
  // 密码哈希 pepper（建议与 JWT 密钥分离；默认兼容历史行为）
  passwordPepper: process.env.PASSWORD_PEPPER || process.env.JWT_SECRET || 'change-me-in-production-use-env',
  // 旧密码哈希 pepper（用于迁移期兼容历史密码；验证成功后会自动重哈希到 passwordPepper）
  legacyPasswordPepper: _legacyPasswordPeppers[0] || '',
  // 可配置多个旧 pepper（逗号分隔），用于多阶段历史迁移兼容。
  legacyPasswordPeppers: _legacyPasswordPeppers,
  // 客户端允许的跨域（* 表示任意，上线建议写具体域名）
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // 公网 IP（用于文档说明，实际连接时客户端填这个）
  publicIp: process.env.PUBLIC_IP || '43.130.240.37',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'xianxia',
  // 交易所基础税率（动态税率的基础档）
  exchangeTaxRate: 0.05,
  // 挂单过期小时数
  exchangeListingExpireHours: (() => { const v = Number(process.env.EXCHANGE_LISTING_EXPIRE_HOURS); return Number.isFinite(v) && v > 0 ? v : 72; })(),

  // 腾讯云邮件推送 API 配置
  tencentSecretId: process.env.TENCENT_SECRET_ID || '',
  tencentSecretKey: process.env.TENCENT_SECRET_KEY || '',
  tencentSesRegion: process.env.TENCENT_SES_REGION || 'ap-hongkong',
  tencentSesFromEmail: process.env.TENCENT_SES_FROM_EMAIL || '',
  tencentSesFromName: process.env.TENCENT_SES_FROM_NAME || '艾德尔修仙传',
  tencentSesTemplateId: (() => { const v = Number(process.env.TENCENT_SES_TEMPLATE_ID); return Number.isFinite(v) && v > 0 ? v : 166687; })(),

  // 请求验签密钥（前后端需保持一致，修改后需同步更新 web-client/js/api.js 中的 _SIGN_KEY）
  signSecret: process.env.SIGN_SECRET || 'KDYJ1iHyB02LgyN1Jljb5pQkTHU1ELC6Vg6ox6FC0iX0dW9l',
  // 签名时间容差（秒），默认 300 秒（5 分钟），足够宽松不影响正常操作
  signTolerance: (() => { const v = Number(process.env.SIGN_TOLERANCE); return Number.isFinite(v) && v >= 30 ? Math.floor(v) : 300; })()
};
