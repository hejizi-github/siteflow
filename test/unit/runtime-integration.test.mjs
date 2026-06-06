import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserRuntime } from '../../dist/runtime/browser-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = pathToFileURL(resolve(__dirname, '..', 'fixtures', 'runtime-playground.html')).href;

let runtime;

test.before(async () => {
  runtime = new BrowserRuntime('integration-test');
  await runtime.ensureLaunched();
});

test.after(async () => {
  if (runtime) await runtime.close().catch(() => {});
});

// ─── Page lifecycle ─────────────────────────────────────────────────

test('integration: open fixture page', async () => {
  const page = await runtime.open(fixtureUrl);
  assert.ok(page.id > 0);
  assert.ok(page.url.includes('runtime-playground.html'));
  assert.ok(page.title.includes('Runtime Playground'));
});

test('integration: listPages returns pages', async () => {
  const pages = await runtime.listPages();
  assert.ok(pages.length >= 1);
});

test('integration: navigate', async () => {
  const page = await runtime.navigate(fixtureUrl + '#nav');
  assert.ok(page.url.includes('#nav'));
});

test('integration: reload', async () => {
  const page = await runtime.reload();
  assert.ok(page.url.includes('runtime-playground.html'));
});

// ─── Click ──────────────────────────────────────────────────────────

test('integration: click by selector', async () => {
  const result = await runtime.click({ selector: '#btn-by-id' });
  assert.equal(result.action, 'click');
});

test('integration: click by text', async () => {
  const result = await runtime.click({ text: 'Text Match Button' });
  assert.equal(result.action, 'click');
});

test('integration: click by aria', async () => {
  const result = await runtime.click({ aria: 'Aria Label Button' });
  assert.equal(result.action, 'click');
});

// ─── Type ───────────────────────────────────────────────────────────

test('integration: type into input', async () => {
  const result = await runtime.type({ selector: '#text-input', value: 'hello' });
  assert.equal(result.action, 'type');
  assert.equal(result.text, 'hello');
});

test('integration: type with clear false', async () => {
  const result = await runtime.type({ selector: '#text-input', value: ' world', clear: false });
  assert.equal(result.action, 'type');
});

test('integration: type into textarea', async () => {
  const result = await runtime.type({ selector: '#textarea-input', value: 'txt' });
  assert.equal(result.action, 'type');
});

// ─── Select ─────────────────────────────────────────────────────────

test('integration: select option', async () => {
  const result = await runtime.select({ selector: '#native-select', option: 'Banana' });
  assert.equal(result.action, 'select');
});

// ─── Screenshot ─────────────────────────────────────────────────────

test('integration: screenshot viewport', async () => {
  const result = await runtime.screenshot(false);
  assert.equal(result.mimeType, 'image/png');
  assert.ok(result.bytes > 0);
});

test('integration: screenshot full page', async () => {
  const result = await runtime.screenshot(true);
  assert.ok(result.bytes > 0);
});

// ─── Console ────────────────────────────────────────────────────────

test('integration: console log captured', async () => {
  await runtime.click({ selector: '#log-btn' });
  await new Promise(r => setTimeout(r, 300));
  const entries = await runtime.listConsole(10);
  assert.ok(entries.length > 0);
});

// ─── Network ────────────────────────────────────────────────────────

test('integration: network entries array', async () => {
  const entries = await runtime.listNetwork(10);
  assert.equal(Array.isArray(entries), true);
});

// ─── Storage ────────────────────────────────────────────────────────

test('integration: read storage snapshot', async () => {
  await runtime.click({ selector: '#set-storage' });
  const snap = await runtime.storage();
  assert.equal(snap.localStorage['fixture-key'], 'fixture-value');
});

test('integration: importStorage runs without error', async () => {
  const origin = new URL(fixtureUrl).origin;
  const result = await runtime.importStorage([
    { origin, localStorage: { 'ik': 'iv' } },
  ]);
  assert.ok(result.origins >= 0, 'importStorage should return result');
});

// ─── Auth / cookies ─────────────────────────────────────────────────

test('integration: authStatus returns mode', async () => {
  const status = await runtime.authStatus();
  assert.equal(status.mode, 'dedicated-profile');
});

test('integration: cookies returns array', async () => {
  const cookies = await runtime.cookies();
  assert.equal(Array.isArray(cookies), true);
});

test('integration: importCookies preview mode', async () => {
  const result = await runtime.importCookies(
    [
      {
        name: 'tc', value: 'tv',
        domain: '.example.com', path: '/',
        expires: Math.floor(Date.now() / 1000) + 86400,
        httpOnly: false, secure: false, sameSite: 'Lax',
      },
    ],
    undefined,
    false,
  );
  assert.equal(result.count, 1);
});

// ─── State ──────────────────────────────────────────────────────────

test('integration: captureState', async () => {
  const state = await runtime.captureState(false);
  assert.equal(state.version, 1);
  assert.ok(state.pages.length >= 1);
});

test('integration: restoreState', async () => {
  const state = await runtime.captureState(false);
  const result = await runtime.restoreState(state);
  assert.ok(result.restoredPages >= 1);
});

// ─── Debugger ───────────────────────────────────────────────────────

test('integration: listScripts', async () => {
  const scripts = await runtime.listScripts();
  assert.ok(scripts.length > 0);
});

test('integration: evaluate', async () => {
  const result = await runtime.evaluate('1 + 2');
  assert.equal(result, 3);
});

test('integration: inspectTarget', async () => {
  const result = await runtime.inspectTarget({ selector: 'button' });
  assert.ok(result.candidates.length > 0);
});

// ─── Upload ─────────────────────────────────────────────────────────

test('integration: upload files', async () => {
  const result = await runtime.upload({
    selector: '#file-input',
    files: ['package.json'],
  });
  assert.equal(result.action, 'upload');
});

// ─── Hook ───────────────────────────────────────────────────────────

test('integration: install hook', async () => {
  const hook = await runtime.installHook('fetch');
  assert.equal(hook.name, 'fetch');
});

test('integration: listHooks', async () => {
  const hooks = await runtime.listHooks();
  assert.ok(hooks.length >= 1);
});
