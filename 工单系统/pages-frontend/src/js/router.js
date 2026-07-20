// router.js — Hash-based SPA Router

class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.currentParams = {};
    this.beforeEach = null;
    this.contentEl = null;
  }

  setContainer(el) {
    this.contentEl = el;
  }

  register(path, handler) {
    this.routes.set(path, handler);
    return this;
  }

  start() {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }

  navigate(path) {
    window.location.hash = path;
  }

  resolve() {
    const hash = window.location.hash.slice(1) || '/';
    const [path, queryStr] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

    // Match route (support :param patterns)
    let matched = null;
    let params = {};

    for (const [pattern, handler] of this.routes) {
      const match = this._match(pattern, path);
      if (match) {
        matched = handler;
        params = match;
        break;
      }
    }

    if (!matched) {
      // 404
      if (this.contentEl) {
        this.contentEl.innerHTML = `
          <div class="empty-state">
            <p>页面不存在</p>
          </div>`;
      }
      return;
    }

    // Before each guard
    if (this.beforeEach) {
      const shouldContinue = this.beforeEach(path, params);
      if (shouldContinue === false) return;
    }

    this.currentRoute = path;
    this.currentParams = params;

    // Execute handler
    if (this.contentEl) {
      matched({ params, query, container: this.contentEl });
    }
  }

  _match(pattern, path) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  }
}

export const router = new Router();
