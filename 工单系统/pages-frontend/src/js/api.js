// api.js — API 客户端模块
const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('ider_token') || '';
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('ider_token', token);
    } else {
      localStorage.removeItem('ider_token');
    }
  }

  getToken() {
    return this.token;
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json().catch(() => ({ error: '网络错误' }));

    if (!res.ok) {
      throw new ApiError(data.error || '请求失败', res.status, data);
    }
    return data;
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  del(path, body = null) { return this.request('DELETE', path, body); }

  // ── Auth ──────────────────────────────
  login(username, password) {
    return this.post('/auth/login', { username, password });
  }

  register(username, password, invite_code) {
    return this.post('/auth/register', { username, password, invite_code });
  }

  // ── User ──────────────────────────────
  getUserInfo() { return this.get('/user/info'); }
  updateProfile(data) { return this.put('/user/profile', data); }
  changePassword(old_password, new_password) {
    return this.post('/user/change-password', { old_password, new_password });
  }

  // ── Orders ────────────────────────────
  getOrders(status) {
    const q = status ? `?status=${status}` : '';
    return this.get(`/orders${q}`);
  }

  getOrder(id) { return this.get(`/orders/${id}`); }

  createOrder(data) { return this.post('/orders', data); }

  getOrderActivities(id) { return this.get(`/orders/${id}/activities`); }

  // ── Accounts ──────────────────────────
  getAccounts(orderId) {
    const q = orderId ? `?order_id=${orderId}` : '';
    return this.get(`/accounts${q}`);
  }

  getAccount(id) { return this.get(`/accounts/${id}`); }
  getAccountLogs(id) { return this.get(`/accounts/${id}/logs`); }

  // ── Invite ────────────────────────────
  getInviteInfo() { return this.get('/invite/info'); }
  getInvitePackages() { return this.get('/invite/packages'); }
  purchaseInvitePackage(data) { return this.post('/invite/purchase', data); }
  withdrawInvitePoints(points) { return this.post('/invite/withdraw', { points }); }

  // ── Notifications ─────────────────────
  getNotifications(type) {
    const q = type ? `?type=${type}` : '';
    return this.get(`/notifications${q}`);
  }
  markRead(id) { return this.post('/notifications/read', { id }); }
  markAllRead() { return this.post('/notifications/read', {}); }

  // ── Appeals ───────────────────────────
  getAppeals() { return this.get('/appeals'); }
  createAppeal(data) { return this.post('/appeals', data); }

  // ── After-Sales ───────────────────────
  getAfterSales() { return this.get('/after-sales'); }
  createAfterSales(data) { return this.post('/after-sales', data); }
  replyAfterSales(id, content) {
    return this.post(`/after-sales/${id}/reply`, { content });
  }

  // ── Leaderboard ───────────────────────
  getLeaderboard(type) { return this.get(`/leaderboard/${type}`); }

  // ── Bot ───────────────────────────────
  askBot(question) { return this.post('/bot/ask', { question }); }

  // ── Contact ───────────────────────────
  sendContactMessage(data) { return this.post('/contact', data); }

  // ── Admin Points ──────────────────────
  adminGrantPoints(data) { return this.post('/admin/points', data); }

  // ── Admin Contact Messages ────────────
  adminGetContactMessages() { return this.get('/admin/contact-messages'); }
  adminMarkContactRead(id) { return this.post(`/admin/contact-messages?mark_read=${id}`, {}); }

  // ── Admin Super ───────────────────────
  adminSetRole(id, role) { return this.post(`/admin/users/${id}/role`, { role }); }

  // ── Coupon ────────────────────────────
  validateCoupon(code) { return this.post('/coupon/validate', { code }); }

  // ── Redeem ────────────────────────────
  redeemCode(code) { return this.post('/redeem', { code }); }

  // ── Config / Stats ────────────────────
  getConfig() { return this.get('/config'); }
  getStats() { return this.get('/stats'); }
  getPublicConfig() { return this.get('/public/config'); }

  // ── Admin ─────────────────────────────
  adminGetUsers() { return this.get('/admin/users'); }
  adminGetOrders(status, page) {
    const params = [];
    if (status) params.push(`status=${status}`);
    if (page) params.push(`page=${page}`);
    const q = params.length ? `?${params.join('&')}` : '';
    return this.get(`/admin/orders${q}`);
  }
  adminGetStats() { return this.get('/admin/stats'); }
  adminGetCoupons() { return this.get('/admin/coupons'); }
  adminCreateCoupon(data) { return this.post('/admin/coupons', data); }
  adminDeleteCoupon(id) { return this.del(`/admin/coupons/${id}`); }
  adminGetAppeals(status) {
    const q = status ? `?status=${status}` : '';
    return this.get(`/admin/appeals${q}`);
  }
  adminReplyAppeal(id, reply, status) {
    return this.post(`/admin/appeals/${id}/reply`, { reply, status });
  }
  adminGetAccounts(status) {
    const q = status ? `?status=${status}` : '';
    return this.get(`/admin/accounts${q}`);
  }
  adminGetConfig() { return this.get('/admin/config'); }
  adminSetConfig(key, value) { return this.post('/admin/config', { key, value }); }
  adminSetConfigBatch(configs) { return this.post('/admin/config', { configs }); }
  adminLockUser(id, locked) { return this.post(`/admin/users/${id}/lock`, { locked }); }
  adminResetPassword(id, new_password) {
    return this.post(`/admin/users/${id}/reset-password`, { new_password });
  }
  adminSetLevel(id, level) { return this.post(`/admin/users/${id}/level`, { level }); }
  adminSetAdmin(id, is_admin) { return this.post(`/admin/users/${id}/admin`, { is_admin }); }
  adminDeleteUser(id) { return this.del(`/admin/users/${id}/delete`); }
  adminGetAnnouncements() { return this.get('/admin/announcements'); }
  adminCreateAnnouncement(content, enabled) {
    return this.post('/admin/announcements', { content, enabled });
  }
  adminDeleteAnnouncement(id) { return this.del(`/admin/announcements/${id}`); }
  adminGetAds() { return this.get('/admin/ads'); }
  adminCreateAd(data) { return this.post('/admin/ads', data); }
  adminDeleteAd(id) { return this.del(`/admin/ads/${id}`); }

  // ── Recharge ────────────────────────────
  getRechargePackages() { return this.get('/recharge/packages'); }
  createRecharge(data) { return this.post('/recharge', data); }
  getMyRechargeOrders() { return this.get('/recharge'); }

  // ── Market (Official) ───────────────────
  getMarketItems() { return this.get('/market/items'); }
  purchaseMarketItem(item_id, quantity) {
    return this.post('/market/purchase', { item_id, quantity });
  }

  // ── Market (Black Market Orders) ────────
  getMarketOrders() { return this.get('/market/orders'); }
  createMarketOrder(data) { return this.post('/market/orders', data); }
  takeMarketOrder(order_id) { return this.post('/market/orders/buy', { order_id }); }
  shipMarketOrder(order_id) { return this.post('/market/orders/ship', { order_id }); }
  confirmMarketOrder(order_id) { return this.post('/market/orders/confirm', { order_id }); }
  cancelMarketOrder(order_id) { return this.post('/market/orders/cancel', { order_id }); }

  // ── Admin: Market Items ─────────────────
  adminGetMarketItems() { return this.get('/admin/market/items'); }
  adminCreateMarketItem(data) { return this.post('/admin/market/items', data); }
  adminUpdateMarketItem(id, data) { return this.put(`/admin/market/${id}`, data); }
  adminDeleteMarketItem(id) { return this.del(`/admin/market/${id}`); }

  // ── Admin: Market Orders ──────────────────
  adminGetMarketOrders(status, page) {
    const params = [];
    if (status) params.push(`status=${status}`);
    if (page) params.push(`page=${page}`);
    const q = params.length ? `?${params.join('&')}` : '';
    return this.get(`/admin/market-orders${q}`);
  }
  adminMarketOrderAction(order_id, action, notes) {
    return this.post('/admin/market-orders', { order_id, action, notes });
  }
  adminDeleteMarketOrder(order_id) {
    return this.post('/admin/market-orders', { order_id, action: 'admin-delete' });
  }

  // ── Admin: Recharge ─────────────────────
  adminGetRechargeOrders(status) {
    const q = status ? `?status=${status}` : '';
    return this.get(`/admin/recharge${q}`);
  }
  adminApproveRecharge(order_id) { return this.post('/admin/recharge', { order_id, action: 'approve' }); }
  adminRejectRecharge(order_id) { return this.post('/admin/recharge', { order_id, action: 'reject' }); }

  // ── Redeem: Coin (修仙币兑换码) ─────────
  redeemCoinCode(code) { return this.post('/redeem', { code }); }

  // ── Admin: Recharge Codes ───────
  adminGetRechargeCodes(status, page) {
    const params = [];
    if (status) params.push(`status=${status}`);
    if (page) params.push(`page=${page}`);
    const q = params.length ? `?${params.join('&')}` : '';
    return this.get(`/admin/recharge-codes${q}`);
  }
  adminCreateRechargeCodes(data) { return this.post('/admin/recharge-codes', data); }
  adminDeleteRechargeCode(id) { return this.del('/admin/recharge-codes', { id }); }

  // ── Admin: AI Config ─────────────────────
  adminGetAiConfig() { return this.get('/admin/ai-config'); }
  adminSetAiConfig(data) { return this.post('/admin/ai-config', data); }
  adminTestAiConnection() { return this.post('/admin/ai-test', {}); }
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const api = new ApiClient();
export { ApiError };
