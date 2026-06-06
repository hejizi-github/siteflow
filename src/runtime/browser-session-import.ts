import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SiteflowError } from '../shared/errors.js';

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
