import type { HookInfo } from '../shared/types.js';

export function hookSource(name: HookInfo['name']): string {
  if (name === 'fetch') {
    return `(() => {
      if (window.__SITEFLOW_FETCH_HOOKED__) return;
      window.__SITEFLOW_FETCH_HOOKED__ = true;
      const originalFetch = window.fetch;
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input && input.url;
        console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'fetch', phase: 'call', url, method: init && init.method || 'GET', stack: new Error().stack }));
        const response = await originalFetch.apply(this, arguments);
        console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'fetch', phase: 'response', url: response.url, status: response.status }));
        return response;
      };
    })();`;
  }

  if (name === 'xhr') {
    return `(() => {
      if (window.__SITEFLOW_XHR_HOOKED__) return;
      window.__SITEFLOW_XHR_HOOKED__ = true;
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__siteflow = { method, url };
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const meta = this.__siteflow || {};
        console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'xhr', phase: 'send', method: meta.method, url: meta.url, hasBody: body != null, stack: new Error().stack }));
        this.addEventListener('loadend', () => {
          console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'xhr', phase: 'loadend', method: meta.method, url: meta.url, status: this.status }));
        });
        return originalSend.apply(this, arguments);
      };
    })();`;
  }

  return `(() => {
    if (window.__SITEFLOW_CRYPTO_HOOKED__) return;
    window.__SITEFLOW_CRYPTO_HOOKED__ = true;
    const subtle = crypto && crypto.subtle;
    if (subtle) {
      for (const name of ['digest', 'sign', 'encrypt', 'decrypt']) {
        const original = subtle[name];
        if (typeof original !== 'function') continue;
        subtle[name] = function() {
          const algorithm = arguments[0] && (arguments[0].name || arguments[0]);
          console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'crypto', op: name, algorithm, stack: new Error().stack }));
          return original.apply(this, arguments);
        };
      }
    }
    const originalGetRandomValues = crypto && crypto.getRandomValues;
    if (typeof originalGetRandomValues === 'function') {
      crypto.getRandomValues = function(array) {
        console.log('SITEFLOW_HOOK ' + JSON.stringify({ type: 'crypto', op: 'getRandomValues', length: array && array.length, stack: new Error().stack }));
        return originalGetRandomValues.apply(this, arguments);
      };
    }
  })();`;
}
