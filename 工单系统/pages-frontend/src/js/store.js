// store.js — 简易状态管理

class Store {
  constructor() {
    this._state = {
      user: null,
      isLoggedIn: false,
      config: {},
    };
    this._listeners = new Map();
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    if (old !== value) {
      this._emit(key, value, old);
    }
  }

  setUser(user) {
    this.set('user', user);
    this.set('isLoggedIn', !!user);
  }

  getUser() {
    return this._state.user;
  }

  isLoggedIn() {
    return this._state.isLoggedIn;
  }

  isAdmin() {
    return this._state.user?.is_admin === 1;
  }

  on(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    return () => this._listeners.get(key)?.delete(callback);
  }

  _emit(key, value, old) {
    const listeners = this._listeners.get(key);
    if (listeners) {
      listeners.forEach(cb => cb(value, old));
    }
  }

  // ── Auth helpers ──────────────────────
  loadFromStorage() {
    const token = localStorage.getItem('ider_token');
    const userStr = localStorage.getItem('ider_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        this.setUser(user);
        return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  saveUserToStorage(user, token) {
    localStorage.setItem('ider_token', token);
    localStorage.setItem('ider_user', JSON.stringify(user));
    this.setUser(user);
  }

  clearStorage() {
    localStorage.removeItem('ider_token');
    localStorage.removeItem('ider_user');
    this.setUser(null);
  }
}

export const store = new Store();
