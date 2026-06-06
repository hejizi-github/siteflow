import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { chromium } from 'playwright';
import { SiteflowError } from '../shared/errors.js';
import type { BrowserSessionImportReceipt, BrowserStorageRecord, CookieRecord } from '../shared/types.js';

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

function readLocalStateProfiles(userDataDir: string): {
  profiles: string[];
  lastUsed?: string;
  activeTimes: Map<string, number>;
} {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return { profiles: [], activeTimes: new Map() };
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf8')) as {
      profile?: {
        last_used?: string;
        info_cache?: Record<string, { active_time?: number }>;
      };
    };
    const info = parsed.profile?.info_cache || {};
    const activeTimes = new Map<string, number>();
    for (const [profile, metadata] of Object.entries(info)) {
      activeTimes.set(profile, Number(metadata.active_time || 0));
    }
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

function profileSortValue(profile: string): [number, number, string] {
  if (profile === 'Default') return [0, 0, profile];
  const match = /^Profile (\d+)$/.exec(profile);
  if (match) return [1, Number(match[1]), profile];
  return [2, Number.POSITIVE_INFINITY, profile];
}

function compareProfileNames(a: string, b: string): number {
  const left = profileSortValue(a);
  const right = profileSortValue(b);
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  return left[2].localeCompare(right[2]);
}

function toIsoTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

function preferredBrowserRank(browser: BrowserSourceKind, preferredBrowser?: BrowserSourceKind | null): number {
  if (!preferredBrowser) return 0;
  return browser === preferredBrowser ? -1 : 0;
}

function browserFallbackRank(browser: BrowserSourceKind): number {
  return SOURCE_ORDER.indexOf(browser);
}

function lastUsedRank(source: BrowserSessionSource): number {
  const value = source.lastUsed ? Date.parse(source.lastUsed) : Number.NaN;
  return Number.isFinite(value) ? value : -1;
}

export function parseBrowserSourceId(id: string): { browser: BrowserSourceKind; profile: string } {
  const index = id.indexOf(':');
  if (index <= 0 || index === id.length - 1) throw new SiteflowError('SOURCE_NOT_FOUND', `SOURCE_NOT_FOUND: Invalid browser source id: ${id}`);
  const browser = id.slice(0, index);
  const profile = id.slice(index + 1);
  if (!isBrowserSourceKind(browser)) throw new SiteflowError('SOURCE_NOT_FOUND', `SOURCE_NOT_FOUND: Unsupported browser source: ${browser}`);
  return { browser, profile };
}

export function discoverChromiumSources(options: ChromiumDiscoveryOptions = {}): BrowserSessionSource[] {
  const roots = { ...DEFAULT_ROOTS, ...(options.roots || {}) };
  const sources: BrowserSessionSource[] = [];
  for (const browser of SOURCE_ORDER) {
    const userDataDir = roots[browser];
    if (!userDataDir || !fs.existsSync(userDataDir)) continue;
    const localState = readLocalStateProfiles(userDataDir);
    const discoveredProfiles = localState.profiles.length ? localState.profiles : fallbackProfiles(userDataDir);
    const profiles = [...discoveredProfiles].sort(compareProfileNames);
    for (const profile of profiles) {
      const profileDir = path.join(userDataDir, profile);
      if (!fs.existsSync(profileDir)) continue;
      const source: BrowserSessionSource = {
        id: `${browser}:${profile}`,
        browser,
        profile,
        userDataDir,
        profileDir,
        default: profile === (localState.lastUsed || 'Default'),
      };
      const lastUsed = toIsoTimestamp(localState.activeTimes.get(profile));
      if (lastUsed) source.lastUsed = lastUsed;
      sources.push(source);
    }
  }
  return sources;
}

export function pickDefaultBrowserSource(
  sources: BrowserSessionSource[],
  preferredBrowser?: BrowserSourceKind | null,
): BrowserSessionSource {
  if (!sources.length) throw new SiteflowError('NO_BROWSER_SOURCES', 'No Chromium browser profiles were found.');
  return [...sources].sort((a, b) => {
    const preferredDelta = preferredBrowserRank(a.browser, preferredBrowser) - preferredBrowserRank(b.browser, preferredBrowser);
    if (preferredDelta !== 0) return preferredDelta;

    const aIsDefaultProfile = a.profile === 'Default';
    const bIsDefaultProfile = b.profile === 'Default';
    if (aIsDefaultProfile !== bIsDefaultProfile) return aIsDefaultProfile ? -1 : 1;

    const recencyDelta = lastUsedRank(b) - lastUsedRank(a);
    if (recencyDelta !== 0) return recencyDelta;

    const browserDelta = browserFallbackRank(a.browser) - browserFallbackRank(b.browser);
    if (browserDelta !== 0) return browserDelta;

    return a.id.localeCompare(b.id);
  })[0];
}

export function findBrowserSource(sources: BrowserSessionSource[], id: string): BrowserSessionSource {
  parseBrowserSourceId(id);
  const source = sources.find(candidate => candidate.id === id);
  if (!source) throw new SiteflowError('SOURCE_NOT_FOUND', `Browser source not found: ${id}`);
  return source;
}

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

export async function createPrivateTempDir(prefix = 'siteflow-browser-import-'): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.chmod(dir, 0o700).catch(() => {});
  return dir;
}

const BLACKLISTED_PATHS = [
  'SingletonLock', 'SingletonSocket', 'SingletonCookie',
  'OptGuideOnDeviceModel', 'optimization_guide_model_and_features_store',
  'optimization_guide_model_store', 'OptGuideOnDeviceClassifierModel',
  'ShaderCache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'DawnGraphiteCache',
  'GraphiteDawnCache', 'Cache', 'blob_storage', 'File System', 'Thumbnails', 'Snapshots',
  'Service Worker', 'Session Storage', 'IndexedDB', 'WebStorage',
  'crx_cache', 'component_crx_cache',
  'Extensions', 'Platform Notifications', 'shared_proto_db',
  'Visited Links', 'History', 'History Provider Cache', 'Top Sites',
  'Web Data', 'WebAssistDatabase', 'Affiliation Database',
  'Login Data', 'Network Action Predictor', 'BudgetDatabase',
  'Feature Engagement Tracker', 'Segmentation Platform',
  'WasmTtsEngine', 'Safe Browsing', 'CertificateRevocation',
  'Crashpad', 'MEIPreload', 'OnDeviceHeadSuggestModel',
];

function isBlacklisted(filePath: string): boolean {
  return BLACKLISTED_PATHS.some(blacklisted =>
    filePath.includes(blacklisted) || filePath.includes(blacklisted.replace(/ /g, '_')),
  );
}

export async function copyUserDataSnapshot(source: BrowserSessionSource, tempRoot: string): Promise<string> {
  const destination = path.join(tempRoot, `${source.browser}-${source.profile.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  await fsp.cp(source.userDataDir, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: file => !isBlacklisted(file),
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

export function buildBrowserImportReceipt(input: {
  preview: boolean;
  source: string;
  domain?: string;
  cookies: CookieRecord[];
  storage: BrowserStorageRecord[];
  failedDecrypt: number;
  failedOrigins: Array<{ origin: string; code?: string; message?: string }>;
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
