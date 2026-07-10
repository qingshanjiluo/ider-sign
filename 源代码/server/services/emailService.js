const sesClient = require('tencentcloud-sdk-nodejs-ses');
const config = require('../config');

const SesClient = sesClient.ses.v20201002.Client;

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!config.tencentSecretId || !config.tencentSecretKey) {
    console.warn('[emailService] 腾讯云密钥未配置，邮件功能不可用');
    return null;
  }
  _client = new SesClient({
    credential: {
      secretId: config.tencentSecretId,
      secretKey: config.tencentSecretKey
    },
    region: config.tencentSesRegion,
    profile: { httpProfile: { endpoint: 'ses.tencentcloudapi.com' } }
  });
  return _client;
}

async function sendTemplateEmail(to, subject, templateId, templateData) {
  const client = getClient();
  if (!client) throw new Error('邮件服务未配置');
  const fromName = config.tencentSesFromName || '艾德尔修仙传';
  const fromEmail = config.tencentSesFromEmail;
  const params = {
    FromEmailAddress: `${fromName} <${fromEmail}>`,
    Destination: [to],
    Subject: subject,
    Template: {
      TemplateID: templateId,
      TemplateData: JSON.stringify(templateData)
    }
  };
  return client.SendEmail(params);
}

async function sendVerificationCode(email, code) {
  return sendTemplateEmail(email, '【艾德尔修仙传】邮箱验证码', config.tencentSesTemplateId, { code: String(code) });
}

async function sendPasswordResetCode(email, code) {
  return sendTemplateEmail(email, '【艾德尔修仙传】密码重置验证码', config.tencentSesTemplateId, { code: String(code) });
}

async function sendNotification(email, title, content) {
  return sendTemplateEmail(email, title, config.tencentSesTemplateId, { code: content });
}

module.exports = {
  sendTemplateEmail,
  sendVerificationCode,
  sendPasswordResetCode,
  sendNotification
};
