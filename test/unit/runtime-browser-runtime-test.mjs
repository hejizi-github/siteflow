import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserRuntime } from '../../dist/runtime/browser-runtime.js';

// ─── helpers ───────────────────────────────────────────────────────

function mockPage(url = 'https://example.com', title = 'Test Page') {
  let closed = false;
  return {
    url: () => closed ? 'about:blank' : url,
    title: () => Promise.resolve(title),
    isClosed: () => closed,
    _close() { closed = true; },
    evaluate: () => Promise.resolve({}),
    goto: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addInitScript: () => Promise.resolve(),
    screenshot: () => Promise.resolve(Buffer.from('fake')),
    newPage: () => Promise.resolve(mockPage()),
    reload: () => Promise.resolve(),
    on: () => {},
    once: () => {},
    removeListener: () => {},
    context: () => ({}),
    mainFrame: () => ({}),
    frames: () => [],
    keyboard: { press: () => Promise.resolve(), type: () => Promise.resolve() },
    mouse: { click: () => Promise.resolve(), wheel: () => Promise.resolve() },
  };
}

function buildRuntime(label = 'test-profile') {
  return new BrowserRuntime(label);
}

// ─── pure private helpers ───────────────────────────────────────────

test('BrowserRuntime describeTarget delegates to page-actions describeTarget', () => {
  const rt = buildRuntime();
  const desc = rt.describeTarget({ selector: '#btn' });
  assert.equal(typeof desc, 'string');
  assert.ok(desc.length > 0);
});

test('BrowserRuntime shouldSkipCurlHeader skips hop-by-hop headers', () => {
  const rt = buildRuntime();
  assert.equal(rt.shouldSkipCurlHeader('Host'), true);
  assert.equal(rt.shouldSkipCurlHeader('host'), true);
  assert.equal(rt.shouldSkipCurlHeader('Content-Length'), true);
  assert.equal(rt.shouldSkipCurlHeader('CoNnEcTiOn'), true);
  assert.equal(rt.shouldSkipCurlHeader('Authorization'), false);
  assert.equal(rt.shouldSkipCurlHeader('Content-Type'), false);
});

test('BrowserRuntime shellQuote returns plain tokens as-is', () => {
  const rt = buildRuntime();
  assert.equal(rt.shellQuote('curl'), 'curl');
  assert.equal(rt.shellQuote('https://example.com'), 'https://example.com');
  assert.equal(rt.shellQuote('/usr/bin:/bin'), '/usr/bin:/bin');
});

test('BrowserRuntime shellQuote wraps unsafe tokens in single quotes', () => {
  const rt = buildRuntime();
  assert.equal(rt.shellQuote('hello world'), "'hello world'");
  assert.equal(rt.shellQuote("it's"), "'it'\\''s'");
  assert.equal(rt.shellQuote('$HOME'), "'$HOME'");
});

test('BrowserRuntime isNavigationEvaluationError detects navigation errors', () => {
  const rt = new BrowserRuntime('test');
  assert.equal(rt.isNavigationEvaluationError(new Error('Execution context was destroyed')), true);
  assert.equal(rt.isNavigationEvaluationError(new Error('Cannot find context with specified id')), true);
  assert.equal(rt.isNavigationEvaluationError(new Error('Most likely because of a navigation')), true);
  assert.equal(rt.isNavigationEvaluationError(new Error('Regular error')), false);
  assert.equal(rt.isNavigationEvaluationError('not an error'), false);
});

// ─── Page lifecycle ─────────────────────────────────────────────────

test('BrowserRuntime toPageInfo returns page metadata', async () => {
  const rt = buildRuntime();
  const page = mockPage('https://x.com', 'Twitter');
  rt.kernel.selectedPageId = 1;
  rt.kernel.pages.set(1, page);

  const info = await rt.toPageInfo(1, page);
  assert.equal(info.id, 1);
  assert.equal(info.url, 'https://x.com');
  assert.equal(info.title, 'Twitter');
  assert.equal(info.selected, true);
});

test('BrowserRuntime toPageInfo throws on closed page', async () => {
  const rt = buildRuntime();
  const page = mockPage();
  page._close();
  await assert.rejects(() => rt.toPageInfo(1, page), /closed/);
});

test('BrowserRuntime listPages filters closed pages', async () => {
  const rt = buildRuntime();
  rt.kernel.selectedPageId = 1;
  rt.kernel.pages.set(1, mockPage('https://a.com', 'A'));
  const closed = mockPage('https://b.com', 'B');
  closed._close();
  rt.kernel.pages.set(2, closed);
  rt.kernel.context = { pages: () => [] };

  const pages = await rt.listPages();
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'https://a.com');
});

// ─── Auth / cookie / storage ────────────────────────────────────────

test('BrowserRuntime authStatus reports dedicated-profile mode', async () => {
  const rt = buildRuntime();
  rt.kernel.context = { cookies: () => Promise.resolve([]) };
  rt.mode = 'dedicated-profile';

  const status = await rt.authStatus();
  assert.equal(status.mode, 'dedicated-profile');
  assert.equal(status.cookieCount, 0);
});

test('BrowserRuntime authStatus includes browserUrl for cdp-attach mode', async () => {
  const rt = buildRuntime();
  rt.kernel.context = { cookies: () => Promise.resolve([{ name: 'a', value: '1', domain: '.x.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }, { name: 'b', value: '2', domain: 'x.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }]) };
  rt.mode = 'cdp-attach';
  rt.browserUrl = 'http://localhost:9222';

  const status = await rt.authStatus();
  assert.equal(status.mode, 'cdp-attach');
  assert.equal(status.browserUrl, 'http://localhost:9222');
  assert.equal(status.cookieCount, 2);
});

test('BrowserRuntime cookies redacts values', async () => {
  const rt = buildRuntime();
  rt.kernel.context = { cookies: () => Promise.resolve([{ name: 'token', value: 'secret-abc', domain: '.x.com', path: '/', expires: 9999999999, httpOnly: true, secure: true, sameSite: 'Strict' }]) };

  const result = await rt.cookies();
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'token');
  assert.equal(result[0].value, '[REDACTED:10]');
  assert.equal(result[0].domain, '.x.com');
});

test('BrowserRuntime cookies filters by domain', async () => {
  const rt = buildRuntime();
  rt.kernel.context = {
    cookies: () => Promise.resolve([
      { name: 'a', value: '1', domain: '.x.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
      { name: 'b', value: '2', domain: 'y.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
    ]),
  };

  const result = await rt.cookies('x.com');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'a');
});

test('BrowserRuntime cookies throws when no context', async () => {
  const rt = buildRuntime();
  await assert.rejects(() => rt.cookies(), /No browser context/);
});

test('BrowserRuntime exportCookies keeps raw values', async () => {
  const rt = buildRuntime();
  rt.kernel.context = { cookies: () => Promise.resolve([{ name: 'token', value: 'secret-abc', domain: '.x.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Strict' }]) };

  const result = await rt.exportCookies();
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 'secret-abc');
});

test('BrowserRuntime importCookies preview mode counts without importing', async () => {
  const rt = buildRuntime();
  const cookies = [
    { name: 'a', value: '1', domain: '.x.com', path: '/', expires: 9999999999, httpOnly: false, secure: true, sameSite: 'Lax' },
  ];
  const result = await rt.importCookies(cookies, undefined, false);
  assert.equal(result.imported, false);
  assert.equal(result.count, 1);
});

test('BrowserRuntime importCookies apply mode adds to context', async () => {
  const rt = buildRuntime();
  const added = [];
  rt.kernel.context = {
    addCookies(c) { added.push(...c); return Promise.resolve(); },
  };

  const cookies = [
    { name: 'a', value: '1', domain: '.x.com', path: '/', expires: 9999999999, httpOnly: false, secure: true, sameSite: 'Lax' },
  ];
  const result = await rt.importCookies(cookies, undefined, true);
  assert.equal(result.imported, true);
  assert.equal(result.count, 1);
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'a');
});

test('BrowserRuntime importCookies filters by domain', async () => {
  const rt = buildRuntime();
  rt.kernel.context = { addCookies: () => Promise.resolve() };

  const cookies = [
    { name: 'a', value: '1', domain: '.x.com', path: '/', expires: 9999999999, httpOnly: false, secure: true, sameSite: 'Lax' },
    { name: 'b', value: '2', domain: '.y.com', path: '/', expires: 9999999999, httpOnly: false, secure: true, sameSite: 'Lax' },
  ];
  const result = await rt.importCookies(cookies, 'x.com', true);
  assert.equal(result.count, 1);
});

// ─── state capture / restore ────────────────────────────────────────

test('BrowserRuntime captureState records pages and cookies', async () => {
  const rt = buildRuntime();
  rt.kernel.selectedPageId = 1;
  rt.kernel.pages.set(1, mockPage('https://example.com', 'Example'));
  rt.kernel.context = { cookies: () => Promise.resolve([]) };

  const state = await rt.captureState(true);
  assert.equal(state.version, 1);
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].url, 'https://example.com');
});

// ─── lifecycle ──────────────────────────────────────────────────────

test('BrowserRuntime close resets context', async () => {
  const rt = buildRuntime();
  rt.mode = 'dedicated-profile';
  rt.kernel.context = { close: () => Promise.resolve() };
  await rt.close();
  assert.equal(rt.mode, 'none');
  assert.equal(rt.kernel.context, null);
});

test('BrowserRuntime detach from cdp-attach mode', async () => {
  const rt = buildRuntime();
  rt.mode = 'cdp-attach';
  rt.kernel.context = { close: () => Promise.resolve() };
  const result = await rt.detach();
  assert.equal(result.detached, true);
  assert.equal(result.previousMode, 'cdp-attach');
});

test('BrowserRuntime detach from dedicated-profile mode', async () => {
  const rt = buildRuntime();
  rt.mode = 'dedicated-profile';
  rt.kernel.context = { close: () => Promise.resolve() };
  const result = await rt.detach();
  assert.equal(result.detached, false);
  assert.equal(result.previousMode, 'dedicated-profile');
});

// ─── debugger helpers ───────────────────────────────────────────────

test('BrowserRuntime listHooks returns sorted hook names', async () => {
  const rt = buildRuntime();
  rt.kernel.selectedPageId = 1;
  rt.kernel.pages.set(1, mockPage());
  rt.kernel.observations.set(1, {
    hooks: new Set(['xhr', 'fetch']),
  });

  const hooks = await rt.listHooks();
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].name, 'fetch');
  assert.equal(hooks[1].name, 'xhr');
});
