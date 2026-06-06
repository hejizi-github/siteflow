import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = () => import('../../dist/runtime/browser-session-import.js');

test('parseBrowserSourceId parses browser and profile', async () => {
  const { parseBrowserSourceId } = await mod();
  assert.deepEqual(parseBrowserSourceId('chrome:Default'), { browser: 'chrome', profile: 'Default' });
  assert.deepEqual(parseBrowserSourceId('arc:Profile-1'), { browser: 'arc', profile: 'Profile-1' });
  assert.throws(() => parseBrowserSourceId('firefox:default'), /SOURCE_NOT_FOUND/);
});

test('discoverChromiumSources reads Local State deterministically', async () => {
  const { discoverChromiumSources } = await mod();
  const root = mkdtempSync(join(tmpdir(), 'siteflow-sources-'));
  try {
    const chromeRoot = join(root, 'Google', 'Chrome');
    mkdirSync(join(chromeRoot, 'Profile 1'), { recursive: true });
    mkdirSync(join(chromeRoot, 'Default'), { recursive: true });
    writeFileSync(join(chromeRoot, 'Local State'), JSON.stringify({
      profile: {
        last_used: 'Profile 1',
        info_cache: {
          'Profile 1': { active_time: 20 },
          Default: { active_time: 10 },
        },
      },
    }));

    const sources = discoverChromiumSources({ roots: { chrome: chromeRoot } });
    assert.deepEqual(sources.map(source => source.id), ['chrome:Default', 'chrome:Profile 1']);
    assert.equal(sources[0].default, false);
    assert.equal(sources[1].default, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pickDefaultBrowserSource prefers literal Default over last-used Profile 1', async () => {
  const { discoverChromiumSources, pickDefaultBrowserSource } = await mod();
  const root = mkdtempSync(join(tmpdir(), 'siteflow-sources-'));
  try {
    const chromeRoot = join(root, 'Google', 'Chrome');
    mkdirSync(join(chromeRoot, 'Default'), { recursive: true });
    mkdirSync(join(chromeRoot, 'Profile 1'), { recursive: true });
    writeFileSync(join(chromeRoot, 'Local State'), JSON.stringify({
      profile: {
        last_used: 'Profile 1',
        info_cache: {
          Default: { active_time: 1 },
          'Profile 1': { active_time: 999999999 },
        },
      },
    }));

    const source = pickDefaultBrowserSource(discoverChromiumSources({ roots: { chrome: chromeRoot } }));
    assert.equal(source.id, 'chrome:Default');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pickDefaultBrowserSource prefers preferred browser over hard-coded browser order', async () => {
  const { pickDefaultBrowserSource } = await mod();
  const source = pickDefaultBrowserSource([
    { id: 'chrome:Default', browser: 'chrome', profile: 'Default', userDataDir: '/chrome', profileDir: '/chrome/Default', default: false },
    { id: 'edge:Default', browser: 'edge', profile: 'Default', userDataDir: '/edge', profileDir: '/edge/Default', default: false },
  ], 'edge');
  assert.equal(source.id, 'edge:Default');
});

test('pickDefaultBrowserSource uses browser order only after Default and recency', async () => {
  const { pickDefaultBrowserSource } = await mod();
  const source = pickDefaultBrowserSource([
    {
      id: 'chrome:Profile 9',
      browser: 'chrome',
      profile: 'Profile 9',
      userDataDir: '/chrome',
      profileDir: '/chrome/Profile 9',
      default: false,
      lastUsed: '2026-06-06T10:00:00.000Z',
    },
    {
      id: 'edge:Default',
      browser: 'edge',
      profile: 'Default',
      userDataDir: '/edge',
      profileDir: '/edge/Default',
      default: false,
      lastUsed: '2026-06-06T09:00:00.000Z',
    },
  ]);
  assert.equal(source.id, 'edge:Default');
});

test('storage import client wrapper is exported', async () => {
  const client = await import('../../dist/daemon/client.js');
  assert.equal(typeof client.importRuntimeStorage, 'function');
});
test('browser import orchestration builds preview receipts', async () => {
  const { buildBrowserImportReceipt } = await mod();
  const receipt = buildBrowserImportReceipt({
    preview: true,
    source: 'chrome:Default',
    domain: undefined,
    cookies: [{ name: 'a', value: 'secret', domain: '.x.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
    storage: [{ origin: 'https://x.com', localStorage: { token: 'secret' } }],
    failedDecrypt: 0,
    failedOrigins: [],
  });
  assert.equal(receipt.preview, true);
  assert.equal(receipt.cookies.wouldImport, 1);
  assert.equal(receipt.localStorage.wouldImportKeys, 1);
  assert.equal(JSON.stringify(receipt).includes('secret'), false);
});
