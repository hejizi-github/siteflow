# Browser Session Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `siteflow auth import-browser`：从本机 Chromium 系浏览器 profile 导入 cookies + localStorage 到当前 Siteflow profile，默认全量导入，`--domain` 可选过滤。

**Architecture:** 新增 `src/runtime/browser-session-import.ts` 负责 Chromium source discovery、profile 快照、cookie/localStorage 抽取和 receipt 聚合；复用现有 `BrowserRuntime.importCookies` 写 cookie，新增 storage import runtime 能力写 localStorage。CLI 暴露 `auth sources` 和 `auth import-browser`，默认执行导入，`--preview` 只读不写。

**Tech Stack:** Node 20+ TypeScript ESM、Playwright persistent context、Node 内置 fs/path/os/crypto/child_process、Commander、Node built-in `node:test`。不新增 npm 依赖。

---

## File Structure

- Create `src/runtime/browser-session-import.ts`: Chromium source discovery, source id parsing, snapshot copy, cookie extraction via copied Chromium profile, localStorage origin discovery, receipt aggregation.
- Modify `src/runtime/storage-inspector.ts`: add storage import result types/helpers if needed.
- Modify `src/runtime/browser-runtime.ts`: add `importStorage(records)` and verification helpers.
- Modify `src/daemon/server.ts`: add `/runtime/storage/import` endpoint.
- Modify `src/daemon/client.ts`: add `importRuntimeStorage` wrapper.
- Modify `src/cli/main.ts`: add `auth sources` and `auth import-browser` commands.
- Modify `src/shared/types.ts`: add browser import/source/storage types shared across CLI/daemon/runtime.
- Create `test/unit/browser-session-import.test.mjs`: source discovery, filters, cookie/localStorage extraction helpers, receipt aggregation.
- Create `test/smoke/auth-import-browser-smoke.mjs`: fake Chromium profile import smoke.
- Modify `package.json`: add `smoke:auth-import-browser` script.
- Modify `README.md`: document the new auth import-browser path briefly.

## Implementation Decision: snapshot browser context, not raw cookie DB decryption

The spec describes cookie DB snapshot and decryption. For the implementation, use a safer and lower-dependency equivalent:

1. Copy the selected Chromium user data directory/profile into a private temp snapshot.
2. Launch a Playwright persistent context against the copied snapshot.
3. Read decrypted cookies through `context.cookies()`.
4. Read localStorage by opening discovered origins inside that copied context and evaluating `localStorage`.

This still satisfies the user-visible contract: no attach, no direct mutation of the real browser profile, no raw cookie values in output, and no npm dependency. It avoids hand-rolling Chromium cookie decryption and LevelDB parsing.

## Task 1: Browser Source Types and Discovery

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/runtime/browser-session-import.ts`
- Create: `test/unit/browser-session-import.test.mjs`

- [ ] **Step 1: Write failing source discovery tests**

Create `test/unit/browser-session-import.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = () => import('../../dist/runtime/browser-session-import.js');

test('parseBrowserSourceId parses browser and profile', async () => {
  const { parseBrowserSourceId } = await mod();
  assert.deepEqual(parseBrowserSourceId('chrome:Default'), { browser: 'chrome', profile: 'Default' });
  assert.deepEqual(parseBrowserSourceId('arc:Profile-1'), { browser: 'arc', profile: 'Profile-1' });
  assert.throws(() => parseBrowserSourceId('firefox:default'), /SOURCE_NOT_FOUND/);
});

test('discoverChromiumSources reads Local State profiles', async () => {
  const { discoverChromiumSources } = await mod();
  const root = mkdtempSync(join(tmpdir(), 'siteflow-sources-'));
  try {
    const chromeRoot = join(root, 'Google', 'Chrome');
    mkdirSync(join(chromeRoot, 'Default'), { recursive: true });
    mkdirSync(join(chromeRoot, 'Profile 1'), { recursive: true });
    writeFileSync(join(chromeRoot, 'Local State'), JSON.stringify({
      profile: {
        last_used: 'Profile 1',
        info_cache: {
          Default: { name: 'Person 1', active_time: 10 },
          'Profile 1': { name: 'Work', active_time: 20 },
        },
      },
    }));

    const sources = discoverChromiumSources({ roots: { chrome: chromeRoot } });
    assert.deepEqual(sources.map(source => source.id).sort(), ['chrome:Default', 'chrome:Profile 1']);
    assert.equal(sources.find(source => source.id === 'chrome:Profile 1')?.default, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pickDefaultBrowserSource prefers default profile then chrome', async () => {
  const { pickDefaultBrowserSource } = await mod();
  const source = pickDefaultBrowserSource([
    { id: 'brave:Default', browser: 'brave', profile: 'Default', userDataDir: '/b', profileDir: '/b/Default', default: false },
    { id: 'chrome:Profile 1', browser: 'chrome', profile: 'Profile 1', userDataDir: '/c', profileDir: '/c/Profile 1', default: true },
  ]);
  assert.equal(source.id, 'chrome:Profile 1');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: FAIL because `dist/runtime/browser-session-import.js` does not exist.

- [ ] **Step 3: Add shared types**

Append to `src/shared/types.ts`:

```ts
export type BrowserSourceKind = 'chrome' | 'chromium' | 'edge' | 'brave' | 'arc';

export interface BrowserSessionSource {
  id: string;
  browser: BrowserSourceKind;
  profile: string;
  userDataDir: string;
  profileDir: string;
  default: boolean;
  lastUsed?: string;
}

export interface BrowserStorageRecord {
  origin: string;
  localStorage: Record<string, string>;
}

export interface StorageImportResult {
  imported: boolean;
  origins: number;
  keys: number;
  failures: Array<{ origin: string; code: string; message: string }>;
}

export interface BrowserSessionImportReceipt {
  ok: boolean;
  preview: boolean;
  source: string;
  scope: 'all' | 'domain';
  domain?: string;
  cookies: {
    imported?: number;
    wouldImport?: number;
    failedDecrypt: number;
    domains: number | string[];
  };
  localStorage?: {
    origins?: number;
    keys?: number;
    wouldImportOrigins?: number;
    wouldImportKeys?: number;
    failedOrigins: number;
  };
  verification?: Record<string, unknown>;
  warnings: string[];
}
```

- [ ] **Step 4: Implement source discovery**

Create `src/runtime/browser-session-import.ts`:

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SiteflowError } from '../shared/errors.js';
import type { BrowserSessionSource, BrowserSourceKind } from '../shared/types.js';

export interface ChromiumDiscoveryOptions {
  roots?: Partial<Record<BrowserSourceKind, string>>;
}

const DEFAULT_ROOTS: Record<BrowserSourceKind, string> = {
  chrome: path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
  chromium: path.join(os.homedir(), 'Library/Application Support/Chromium'),
  edge: path.join(os.homedir(), 'Library/Application Support/Microsoft Edge'),
  brave: path.join(os.homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser'),
  arc: path.join(os.homedir(), 'Library/Application Support/Arc/User Data'),
};

const SOURCE_ORDER: BrowserSourceKind[] = ['chrome', 'edge', 'brave', 'arc', 'chromium'];

function isBrowserSourceKind(value: string): value is BrowserSourceKind {
  return value === 'chrome' || value === 'chromium' || value === 'edge' || value === 'brave' || value === 'arc';
}

export function parseBrowserSourceId(id: string): { browser: BrowserSourceKind; profile: string } {
  const index = id.indexOf(':');
  if (index <= 0 || index === id.length - 1) throw new SiteflowError('SOURCE_NOT_FOUND', `Invalid browser source id: ${id}`);
  const browser = id.slice(0, index);
  const profile = id.slice(index + 1);
  if (!isBrowserSourceKind(browser)) throw new SiteflowError('SOURCE_NOT_FOUND', `Unsupported browser source: ${browser}`);
  return { browser, profile };
}

function readLocalStateProfiles(userDataDir: string): { profiles: string[]; lastUsed?: string; activeTimes: Map<string, number> } {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return { profiles: [], activeTimes: new Map() };
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf8')) as {
      profile?: { last_used?: string; info_cache?: Record<string, { active_time?: number }> };
    };
    const info = parsed.profile?.info_cache || {};
    const activeTimes = new Map<string, number>();
    for (const [profile, metadata] of Object.entries(info)) activeTimes.set(profile, Number(metadata.active_time || 0));
    return { profiles: Object.keys(info), lastUsed: parsed.profile?.last_used, activeTimes };
  } catch {
    return { profiles: [], activeTimes: new Map() };
  }
}

function fallbackProfiles(userDataDir: string): string[] {
  if (!fs.existsSync(userDataDir)) return [];
  return fs.readdirSync(userDataDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => name === 'Default' || /^Profile \d+$/.test(name));
}

export function discoverChromiumSources(options: ChromiumDiscoveryOptions = {}): BrowserSessionSource[] {
  const roots = { ...DEFAULT_ROOTS, ...(options.roots || {}) };
  const sources: BrowserSessionSource[] = [];
  for (const browser of SOURCE_ORDER) {
    const userDataDir = roots[browser];
    if (!userDataDir || !fs.existsSync(userDataDir)) continue;
    const localState = readLocalStateProfiles(userDataDir);
    const profiles = localState.profiles.length ? localState.profiles : fallbackProfiles(userDataDir);
    for (const profile of profiles) {
      const profileDir = path.join(userDataDir, profile);
      if (!fs.existsSync(profileDir)) continue;
      sources.push({
        id: `${browser}:${profile}`,
        browser,
        profile,
        userDataDir,
        profileDir,
        default: profile === (localState.lastUsed || 'Default'),
        ...(localState.activeTimes.get(profile) ? { lastUsed: new Date(localState.activeTimes.get(profile)! * 1000).toISOString() } : {}),
      });
    }
  }
  return sources;
}

export function pickDefaultBrowserSource(sources: BrowserSessionSource[]): BrowserSessionSource {
  if (!sources.length) throw new SiteflowError('NO_BROWSER_SOURCES', 'No Chromium browser profiles were found.');
  return [...sources].sort((a, b) => {
    if (a.default !== b.default) return a.default ? -1 : 1;
    return SOURCE_ORDER.indexOf(a.browser) - SOURCE_ORDER.indexOf(b.browser);
  })[0];
}

export function findBrowserSource(sources: BrowserSessionSource[], id: string): BrowserSessionSource {
  parseBrowserSourceId(id);
  const source = sources.find(candidate => candidate.id === id);
  if (!source) throw new SiteflowError('SOURCE_NOT_FOUND', `Browser source not found: ${id}`);
  return source;
}
```

- [ ] **Step 5: Run focused tests and verify pass**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/shared/types.ts src/runtime/browser-session-import.ts test/unit/browser-session-import.test.mjs
git commit -m "feat: discover browser session sources"
```

## Task 2: Domain Filtering and Cookie Extraction Helpers

**Files:**
- Modify: `src/runtime/browser-session-import.ts`
- Modify: `test/unit/browser-session-import.test.mjs`

- [ ] **Step 1: Add failing tests for filters and cookie conversion**

Append to `test/unit/browser-session-import.test.mjs`:

```js
test('browser session domain filter matches cookie domains and origins', async () => {
  const { cookieDomainMatchesImportScope, originMatchesImportScope } = await mod();
  assert.equal(cookieDomainMatchesImportScope('.x.com', 'x.com'), true);
  assert.equal(cookieDomainMatchesImportScope('api.x.com', 'x.com'), true);
  assert.equal(cookieDomainMatchesImportScope('example.com', 'x.com'), false);
  assert.equal(originMatchesImportScope('https://x.com', 'x.com'), true);
  assert.equal(originMatchesImportScope('https://api.x.com', 'x.com'), true);
  assert.equal(originMatchesImportScope('https://example.com', 'x.com'), false);
});

test('cookie records are filtered and summarized without values', async () => {
  const { summarizeCookieRecords } = await mod();
  const summary = summarizeCookieRecords([
    { name: 'a', value: 'secret', domain: '.x.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'b', value: 'secret', domain: 'example.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None' },
  ], 'x.com');
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.domains, ['.x.com']);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: FAIL because helper functions are missing.

- [ ] **Step 3: Implement filtering helpers**

Append to `src/runtime/browser-session-import.ts`:

```ts
import type { CookieRecord } from '../shared/types.js';

export function normalizeImportDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\./, '').toLowerCase();
}

export function cookieDomainMatchesImportScope(cookieDomain: string, domain?: string): boolean {
  if (!domain) return true;
  const requested = normalizeImportDomain(domain);
  const cookie = cookieDomain.replace(/^\./, '').toLowerCase();
  return cookie === requested || cookie.endsWith(`.${requested}`);
}

export function originMatchesImportScope(origin: string, domain?: string): boolean {
  if (!domain) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const requested = normalizeImportDomain(domain);
    return host === requested || host.endsWith(`.${requested}`);
  } catch {
    return false;
  }
}

export function filterCookieRecords(cookies: CookieRecord[], domain?: string): CookieRecord[] {
  return cookies.filter(cookie => cookieDomainMatchesImportScope(cookie.domain, domain));
}

export function summarizeCookieRecords(cookies: CookieRecord[], domain?: string): { count: number; domains: string[] } {
  const filtered = filterCookieRecords(cookies, domain);
  return { count: filtered.length, domains: [...new Set(filtered.map(cookie => cookie.domain))].sort() };
}
```

If TypeScript complains about duplicate imports because `CookieRecord` is appended after runtime code, move the type import to the top of the file with existing imports.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/runtime/browser-session-import.ts test/unit/browser-session-import.test.mjs
git commit -m "feat: filter browser session imports"
```

## Task 3: Snapshot Browser Context Extraction

**Files:**
- Modify: `src/runtime/browser-session-import.ts`
- Modify: `test/unit/browser-session-import.test.mjs`

- [ ] **Step 1: Add tests for snapshot path planning and origin scanning**

Append to `test/unit/browser-session-import.test.mjs`:

```js
test('discoverLocalStorageOrigins scans snapshot files conservatively', async () => {
  const { discoverLocalStorageOrigins } = await mod();
  const root = mkdtempSync(join(tmpdir(), 'siteflow-leveldb-'));
  try {
    const leveldb = join(root, 'Local Storage', 'leveldb');
    mkdirSync(leveldb, { recursive: true });
    writeFileSync(join(leveldb, '000003.log'), 'noise https://x.com\u0000more https://api.x.com/path ignored https://example.com');
    assert.deepEqual(discoverLocalStorageOrigins(root, 'x.com').sort(), ['https://api.x.com', 'https://x.com']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: FAIL because `discoverLocalStorageOrigins` is missing.

- [ ] **Step 3: Implement snapshot helpers and localStorage origin scan**

Add to `src/runtime/browser-session-import.ts`:

```ts
import * as fsp from 'node:fs/promises';
import { chromium } from 'playwright';
import type { BrowserStorageRecord } from '../shared/types.js';

export async function createPrivateTempDir(prefix = 'siteflow-browser-import-'): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.chmod(dir, 0o700).catch(() => {});
  return dir;
}

export async function copyUserDataSnapshot(source: BrowserSessionSource, tempRoot: string): Promise<string> {
  const destination = path.join(tempRoot, `${source.browser}-${source.profile.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  await fsp.cp(source.userDataDir, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: file => !file.includes('SingletonLock') && !file.includes('SingletonSocket') && !file.includes('SingletonCookie'),
  });
  return destination;
}

export function discoverLocalStorageOrigins(profileDir: string, domain?: string): string[] {
  const leveldbDir = path.join(profileDir, 'Local Storage', 'leveldb');
  if (!fs.existsSync(leveldbDir)) return [];
  const origins = new Set<string>();
  const pattern = /https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?/g;
  for (const entry of fs.readdirSync(leveldbDir)) {
    if (!/\.(log|ldb)$/.test(entry)) continue;
    const content = fs.readFileSync(path.join(leveldbDir, entry), 'utf8');
    for (const match of content.matchAll(pattern)) {
      const origin = match[0];
      if (originMatchesImportScope(origin, domain)) origins.add(origin);
    }
  }
  return [...origins].sort();
}

export interface ExtractBrowserSessionOptions {
  source: BrowserSessionSource;
  domain?: string;
  cookiesOnly?: boolean;
}

export interface ExtractedBrowserSession {
  cookies: CookieRecord[];
  storage: BrowserStorageRecord[];
  failedDecrypt: number;
  failedOrigins: Array<{ origin: string; code: string; message: string }>;
}
```

- [ ] **Step 4: Implement Playwright extraction**

Add to `src/runtime/browser-session-import.ts`:

```ts
export async function extractBrowserSession(options: ExtractBrowserSessionOptions): Promise<ExtractedBrowserSession> {
  const tempRoot = await createPrivateTempDir();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
  try {
    const snapshotUserDataDir = await copyUserDataSnapshot(options.source, tempRoot);
    const snapshotProfileDir = path.join(snapshotUserDataDir, options.source.profile);
    context = await chromium.launchPersistentContext(snapshotUserDataDir, {
      channel: process.env.SITEFLOW_BROWSER_CHANNEL || 'chrome',
      headless: true,
      args: ['--hide-crash-restore-bubble'],
    });
    const cookieRecords = filterCookieRecords((await context.cookies()).map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as CookieRecord['sameSite'],
    })), options.domain);

    const storage: BrowserStorageRecord[] = [];
    const failedOrigins: Array<{ origin: string; code: string; message: string }> = [];
    if (!options.cookiesOnly) {
      const origins = discoverLocalStorageOrigins(snapshotProfileDir, options.domain);
      for (const origin of origins) {
        const page = await context.newPage();
        try {
          await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          const localStorage = await page.evaluate(() => ({ ...window.localStorage }));
          if (Object.keys(localStorage).length) storage.push({ origin, localStorage });
        } catch (error) {
          failedOrigins.push({ origin, code: 'LOCAL_STORAGE_PARSE_FAILED', message: error instanceof Error ? error.message : String(error) });
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
    return { cookies: cookieRecords, storage, failedDecrypt: 0, failedOrigins };
  } catch (error) {
    throw new SiteflowError('SOURCE_LOCKED', error instanceof Error ? error.message : String(error));
  } finally {
    if (context) await context.close().catch(() => {});
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
```


- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/runtime/browser-session-import.ts test/unit/browser-session-import.test.mjs
git commit -m "feat: extract browser session snapshot"
```

## Task 4: Runtime Storage Import

**Files:**
- Modify: `src/runtime/browser-runtime.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/client.ts`
- Modify: `test/unit/browser-session-import.test.mjs` or create focused runtime test if existing patterns support it.

- [ ] **Step 1: Add daemon client importability test**

Append to `test/unit/browser-session-import.test.mjs`:

```js
test('storage import client wrapper is exported', async () => {
  const client = await import('../../dist/daemon/client.js');
  assert.equal(typeof client.importRuntimeStorage, 'function');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: FAIL because `importRuntimeStorage` is missing.

- [ ] **Step 3: Add BrowserRuntime.importStorage**

In `src/runtime/browser-runtime.ts`, import types:

```ts
import type { BrowserStorageRecord, StorageImportResult } from '../shared/types.js';
```

Add method inside `BrowserRuntime`:

```ts
async importStorage(records: BrowserStorageRecord[]): Promise<StorageImportResult> {
  await this.ensureLaunched();
  const failures: StorageImportResult['failures'] = [];
  let origins = 0;
  let keys = 0;
  for (const record of records) {
    const entries = Object.entries(record.localStorage || {});
    if (!entries.length) continue;
    const page = await this.context!.newPage();
    try {
      await page.goto(record.origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate(values => {
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, String(value));
      }, record.localStorage);
      origins += 1;
      keys += entries.length;
    } catch (error) {
      failures.push({ origin: record.origin, code: 'STORAGE_IMPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
    } finally {
      await page.close().catch(() => {});
    }
  }
  return { imported: failures.length === 0, origins, keys, failures };
}
```

- [ ] **Step 4: Add daemon route**

In `src/daemon/server.ts`, import `BrowserStorageRecord` type if needed and add route near runtime/storage route:

```ts
if (method === 'POST' && url.pathname === '/runtime/storage/import') {
  const body = await readJson(req) as { records?: BrowserStorageRecord[] };
  if (!Array.isArray(body.records)) throw new SiteflowError('BAD_STORAGE_IMPORT', 'runtime storage import requires records[]');
  const result = await runtime.importStorage(body.records);
  return { status: 200, body: { ok: true, data: result } };
}
```

- [ ] **Step 5: Add daemon client wrapper**

In `src/daemon/client.ts`, import types and add:

```ts
export async function importRuntimeStorage(profile: string, records: BrowserStorageRecord[]): Promise<StorageImportResult> {
  return call(profile, 'POST', '/runtime/storage/import', { records });
}
```

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/runtime/browser-runtime.ts src/daemon/server.ts src/daemon/client.ts test/unit/browser-session-import.test.mjs
git commit -m "feat: import browser local storage"
```

## Task 5: CLI `auth sources` and `auth import-browser`

**Files:**
- Modify: `src/cli/main.ts`
- Modify: `src/runtime/browser-session-import.ts`
- Modify: `test/unit/browser-session-import.test.mjs`

- [ ] **Step 1: Add CLI command importability test**

Append to `test/unit/browser-session-import.test.mjs`:

```js
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
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: FAIL because receipt builder is missing.

- [ ] **Step 3: Add receipt builder**

Add to `src/runtime/browser-session-import.ts`:

```ts
import type { BrowserSessionImportReceipt, BrowserStorageRecord } from '../shared/types.js';

export function buildBrowserImportReceipt(input: {
  preview: boolean;
  source: string;
  domain?: string;
  cookies: CookieRecord[];
  storage: BrowserStorageRecord[];
  failedDecrypt: number;
  failedOrigins: Array<{ origin: string }>;
  importedCookies?: number;
  importedStorage?: { origins: number; keys: number };
  verification?: Record<string, unknown>;
}): BrowserSessionImportReceipt {
  const cookieSummary = summarizeCookieRecords(input.cookies, input.domain);
  const storageOrigins = input.storage.length;
  const storageKeys = input.storage.reduce((sum, record) => sum + Object.keys(record.localStorage || {}).length, 0);
  return {
    ok: true,
    preview: input.preview,
    source: input.source,
    scope: input.domain ? 'domain' : 'all',
    ...(input.domain ? { domain: input.domain } : {}),
    cookies: input.preview
      ? { wouldImport: cookieSummary.count, failedDecrypt: input.failedDecrypt, domains: input.domain ? cookieSummary.domains : cookieSummary.domains.length }
      : { imported: input.importedCookies ?? cookieSummary.count, failedDecrypt: input.failedDecrypt, domains: input.domain ? cookieSummary.domains : cookieSummary.domains.length },
    localStorage: input.preview
      ? { wouldImportOrigins: storageOrigins, wouldImportKeys: storageKeys, failedOrigins: input.failedOrigins.length }
      : { origins: input.importedStorage?.origins ?? storageOrigins, keys: input.importedStorage?.keys ?? storageKeys, failedOrigins: input.failedOrigins.length },
    ...(input.verification ? { verification: input.verification } : {}),
    warnings: input.domain ? [] : ['Imported browser session data may contain sensitive account state.'],
  };
}
```

If duplicate imports appear, consolidate imports at the top.

- [ ] **Step 4: Add CLI command wiring**

In `src/cli/main.ts`, import:

```ts
import {
  buildBrowserImportReceipt,
  discoverChromiumSources,
  extractBrowserSession,
  findBrowserSource,
  pickDefaultBrowserSource,
} from '../runtime/browser-session-import.js';
```

Import `importRuntimeStorage` from daemon client.

Add commands under existing `auth` command after `import-cookies`:

```ts
auth
  .command('sources')
  .description('List importable Chromium browser profiles')
  .option('--profile-source-root <path>', 'internal test override for Chromium source root')
  .action(async function () {
    await run(this, () => {
      const local = this.opts<{ profileSourceRoot?: string }>();
      const roots = local.profileSourceRoot ? { chrome: local.profileSourceRoot } : undefined;
      return { sources: discoverChromiumSources({ roots }) };
    });
  });

auth
  .command('import-browser')
  .description('Import cookies and localStorage from a local Chromium browser profile')
  .option('--source <source>', 'browser source id, for example chrome:Default')
  .option('--domain <domain>', 'limit import to a domain and its subdomains')
  .option('--preview', 'preview what would be imported without writing to the Siteflow profile')
  .option('--cookies-only', 'only import cookies')
  .option('--no-verify', 'skip post-import verification')
  .option('--profile-source-root <path>', 'internal test override for Chromium source root')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{
        source?: string;
        domain?: string;
        preview?: boolean;
        cookiesOnly?: boolean;
        verify?: boolean;
        profileSourceRoot?: string;
      }>();
      const roots = local.profileSourceRoot ? { chrome: local.profileSourceRoot } : undefined;
      const sources = discoverChromiumSources({ roots });
      const source = local.source ? findBrowserSource(sources, local.source) : pickDefaultBrowserSource(sources);
      const extracted = await extractBrowserSession({ source, domain: local.domain, cookiesOnly: Boolean(local.cookiesOnly) });
      if (local.preview) {
        return buildBrowserImportReceipt({ preview: true, source: source.id, domain: local.domain, ...extracted });
      }
      const cookieResult = await importCookies(opts.profile, extracted.cookies, source.id, local.domain, true);
      const storageResult = local.cookiesOnly ? { origins: 0, keys: 0 } : await importRuntimeStorage(opts.profile, extracted.storage);
      const verification = local.verify === false
        ? { mode: 'skipped' }
        : local.domain
          ? { mode: 'domain', domain: local.domain }
          : { mode: 'summary-only', cookieCount: cookieResult.count, storageOrigins: storageResult.origins };
      return buildBrowserImportReceipt({
        preview: false,
        source: source.id,
        domain: local.domain,
        ...extracted,
        importedCookies: cookieResult.count,
        importedStorage: { origins: storageResult.origins, keys: storageResult.keys },
        verification,
      });
    });
  });
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm run build && node --test test/unit/browser-session-import.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/cli/main.ts src/runtime/browser-session-import.ts test/unit/browser-session-import.test.mjs
git commit -m "feat: add browser session import commands"
```

## Task 6: Fake Profile Smoke Test

**Files:**
- Create: `test/smoke/auth-import-browser-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create fake profile smoke test**

Create `test/smoke/auth-import-browser-smoke.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const cli = join(root, 'dist/cli/main.js');

function run(args, env) {
  const result = spawnSync(process.execPath, [cli, '--profile', 'auth-import-smoke', '--json', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('auth import-browser previews fake chromium source without secrets in output', () => {
  const home = mkdtempSync(join(tmpdir(), 'siteflow-auth-import-home-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'siteflow-fake-chrome-'));
  const env = { ...process.env, SITEFLOW_HOME: home, SITEFLOW_HEADLESS: 'true' };
  try {
    mkdirSync(join(sourceRoot, 'Default', 'Network'), { recursive: true });
    mkdirSync(join(sourceRoot, 'Default', 'Local Storage', 'leveldb'), { recursive: true });
    writeFileSync(join(sourceRoot, 'Local State'), JSON.stringify({ profile: { last_used: 'Default', info_cache: { Default: { active_time: 1 } } } }));
    writeFileSync(join(sourceRoot, 'Default', 'Local Storage', 'leveldb', '000003.log'), 'https://example.test token secret');
    const sources = run(['auth', 'sources', '--profile-source-root', sourceRoot], env);
    assert.equal(sources.ok, true);
    assert.ok(sources.data.sources.some(source => source.id === 'chrome:Default'));

    const preview = run(['auth', 'import-browser', '--preview', '--source', 'chrome:Default', '--profile-source-root', sourceRoot, '--domain', 'example.test'], env);
    assert.equal(preview.ok, true);
    assert.equal(preview.data.preview, true);
    assert.equal(JSON.stringify(preview).includes('secret'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});
```

This first smoke uses preview mode to avoid requiring a fully realistic Chromium cookie DB. Later implementation reviews may strengthen it with a real copied profile fixture if feasible.

- [ ] **Step 2: Add npm script**

In `package.json`, add:

```json
"smoke:auth-import-browser": "npm run build && node --test test/smoke/auth-import-browser-smoke.mjs"
```

Keep existing scripts unchanged.

- [ ] **Step 3: Run smoke**

Run:

```bash
npm run smoke:auth-import-browser
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add test/smoke/auth-import-browser-smoke.mjs package.json
git commit -m "test: add browser session import smoke"
```

## Task 7: Documentation and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README auth import-browser docs**

Near the auth/storage section in `README.md`, add:

```md
### Browser Session Import

Import cookies and localStorage from a local Chromium browser profile into the active Siteflow profile:

```bash
siteflow --json auth sources
siteflow --json auth import-browser
siteflow --json auth import-browser --domain x.com
siteflow --json auth import-browser --source chrome:Default --preview
```

`auth import-browser` defaults to importing all supported cookies and localStorage from the detected default Chromium profile. Use `--domain` to narrow scope. Receipts show counts and domains/origins only; cookie values and localStorage values are never printed.
```

- [ ] **Step 2: Run required verification**

Run:

```bash
npm run typecheck
npm run test:unit
npm run smoke:auth-import-browser
```

Expected: all PASS.

- [ ] **Step 3: Commit Task 7**

```bash
git add README.md
git commit -m "docs: document browser session import"
```

## Self-Review Checklist

- Spec coverage: This plan covers Chromium source discovery, default full import, optional `--domain`, `--preview`, `--cookies-only`, cookies + localStorage, receipts, fake-profile tests, and docs.
- Scope control: Safari, Firefox, sessionStorage, attach, and direct mutation of real browser profiles are explicitly excluded.
- Dependency check: No new npm dependency is introduced; Playwright is already present and is used to read copied Chromium snapshots.
- Privacy: No cookie/localStorage values are printed in receipts or test assertions.
- Verification: Final task runs `npm run typecheck`, `npm run test:unit`, and `npm run smoke:auth-import-browser`.
