import * as process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SiteflowError } from '../shared/errors.js';
import type {
  AuthStatus,
  BrowserActionResult,
  BrowserClickOptions,
  BrowserElementTarget,
  BrowserInspectResult,
  BrowserScreenshotResult,
  BrowserSelectOptions,
  BrowserStorageRecord,
  BrowserTypeOptions,
  BrowserUploadOptions,
  BreakpointInfo,
  CookieImportResult,
  CookieRecord,
  ConsoleEntry,
  DaemonInfo,
  HookInfo,
  NetworkEntry,
  NetworkBody,
  PageInfo,
  PausedInfo,
  RedactedCookie,
  RequestCurl,
  RequestReplayResult,
  SavedState,
  ScriptInfo,
  ScriptSearchMatch,
  StorageImportResult,
  StorageSnapshot,
} from '../shared/types.js';
import type {
  RecorderStartOptions,
  RecorderStatus,
  RecorderStopResult,
  ReplayRunOptions,
  ReplayRunResult,
} from '../runtime/workflow-types.js';
import { ensureProfileDirs } from '../shared/paths.js';
import { probeDaemon, assertNoRunningDaemon } from './lock.js';
import { readDaemonInfo } from './state.js';

function daemonEntryPath(): string {
  const current = fileURLToPath(import.meta.url);
  return path.join(path.dirname(current), 'server.js');
}

interface PageLeaseScope {
  pageId?: number;
}

const pageLeaseStorage = new AsyncLocalStorage<PageLeaseScope>();

export async function runWithPageLease<T>(fn: () => Promise<T>): Promise<T> {
  return pageLeaseStorage.run({}, fn);
}

export function currentLeasedPageId(): number | undefined {
  return pageLeaseStorage.getStore()?.pageId;
}

export function setCurrentLeasedPageId(pageId: number): void {
  const scope = pageLeaseStorage.getStore();
  if (scope) scope.pageId = pageId;
}

function attachLeasedPageToBody(body: unknown): unknown {
  const pageId = currentLeasedPageId();
  if (!pageId) return body;
  if (body === undefined) return { pageId };
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  if ('pageId' in body) return body;
  return { ...(body as Record<string, unknown>), pageId };
}

function attachLeasedPageToEndpoint(endpoint: string): string {
  const pageId = currentLeasedPageId();
  if (!pageId) return endpoint;
  const url = new URL(endpoint, 'http://siteflow.local');
  if (!url.searchParams.has('pageId')) url.searchParams.set('pageId', String(pageId));
  return `${url.pathname}${url.search}`;
}

async function waitForDaemon(profile: string, timeoutMs = 5000): Promise<DaemonInfo> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = readDaemonInfo(profile);
    if (info && await probeDaemon(info)) return info;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new SiteflowError('DAEMON_START_TIMEOUT', `Daemon did not become ready for profile "${profile}"`);
}

export async function startDaemon(profile: string): Promise<DaemonInfo> {
  ensureProfileDirs(profile);
  await assertNoRunningDaemon(profile);

  const child = spawn(process.execPath, [daemonEntryPath(), '--profile', profile], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return waitForDaemon(profile);
}

export async function getDaemonStatus(profile: string): Promise<{ running: boolean; info: DaemonInfo | null }> {
  const info = readDaemonInfo(profile);
  if (!info) return { running: false, info: null };
  return { running: await probeDaemon(info), info };
}

export async function requireDaemon(profile: string): Promise<DaemonInfo> {
  const status = await getDaemonStatus(profile);
  if (status.running && status.info) return status.info;
  throw new SiteflowError('DAEMON_NOT_RUNNING', `Daemon is not running for profile "${profile}"`, 'Run siteflow daemon start.');
}

async function call<T>(profile: string, method: string, endpoint: string, body?: unknown): Promise<T> {
  const info = await requireDaemon(profile);
  const scopedEndpoint = method === 'GET' ? attachLeasedPageToEndpoint(endpoint) : endpoint;
  const scopedBody = method === 'GET' ? body : attachLeasedPageToBody(body);
  const response = await fetch(`${info.baseUrl}${scopedEndpoint}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(scopedBody === undefined ? {} : { body: JSON.stringify(scopedBody) }),
    signal: AbortSignal.timeout(35_000),
  });
  const payload = await response.json() as { ok: boolean; data?: T; error?: { code: string; message: string; hint?: string } };
  if (!payload.ok) {
    const error = payload.error || { code: 'DAEMON_ERROR', message: 'Daemon request failed' };
    throw new SiteflowError(error.code, error.message, error.hint);
  }
  return payload.data as T;
}

export async function stopDaemon(profile: string): Promise<{ stopped: boolean }> {
  return call(profile, 'POST', '/shutdown');
}

export async function openPage(profile: string, url: string): Promise<PageInfo> {
  const page = await call<PageInfo>(profile, 'POST', '/browser/open', { url });
  setCurrentLeasedPageId(page.id);
  return page;
}

export async function navigatePage(profile: string, url: string, pageId?: number): Promise<PageInfo> {
  const page = await call<PageInfo>(profile, 'POST', '/browser/navigate', pageId ? { url, pageId } : { url });
  setCurrentLeasedPageId(page.id);
  return page;
}

export async function attachBrowser(profile: string, browserUrl: string): Promise<{ mode: 'cdp-attach'; browserUrl: string; pages: PageInfo[] }> {
  return call(profile, 'POST', '/browser/attach', { browserUrl });
}

export async function detachBrowser(profile: string): Promise<{ detached: boolean; previousMode: string }> {
  return call(profile, 'POST', '/browser/detach');
}

export async function listPages(profile: string): Promise<PageInfo[]> {
  return call(profile, 'GET', '/pages');
}

export async function reloadPage(profile: string, pageId?: number): Promise<PageInfo> {
  return call(profile, 'POST', '/browser/reload', pageId ? { pageId } : {});
}

export async function browserClick(profile: string, options: BrowserClickOptions): Promise<BrowserActionResult> {
  return call(profile, 'POST', '/browser/click', options);
}

export async function browserInspectTarget(profile: string, target: BrowserElementTarget): Promise<BrowserInspectResult> {
  return call(profile, 'POST', '/browser/inspect-target', target);
}

export async function browserType(profile: string, options: BrowserTypeOptions): Promise<BrowserActionResult> {
  return call(profile, 'POST', '/browser/type', options);
}

export async function browserUpload(profile: string, options: BrowserUploadOptions): Promise<BrowserActionResult> {
  return call(profile, 'POST', '/browser/upload', options);
}

export async function browserSelect(profile: string, options: BrowserSelectOptions): Promise<BrowserActionResult> {
  return call(profile, 'POST', '/browser/select', options);
}

export async function browserScreenshot(profile: string, fullPage: boolean, pageId?: number): Promise<BrowserScreenshotResult> {
  const params = new URLSearchParams({ fullPage: String(fullPage) });
  if (pageId) params.set('pageId', String(pageId));
  return call(profile, 'GET', `/browser/screenshot?${params}`);
}

export async function listScripts(profile: string): Promise<ScriptInfo[]> {
  return call(profile, 'GET', '/scripts');
}

export async function getScript(profile: string, scriptId: string): Promise<{ info: ScriptInfo; source: string }> {
  return call(profile, 'GET', `/scripts/${encodeURIComponent(scriptId)}`);
}

export async function searchScripts(profile: string, query: string, limit: number): Promise<ScriptSearchMatch[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return call(profile, 'GET', `/scripts-search?${params}`);
}

export async function listConsole(profile: string, limit: number): Promise<ConsoleEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return call(profile, 'GET', `/console?${params}`);
}

export async function listNetwork(profile: string, limit: number, pageId?: number): Promise<NetworkEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (pageId) params.set('pageId', String(pageId));
  return call(profile, 'GET', `/network?${params}`);
}

export async function getNetwork(profile: string, id: number): Promise<NetworkEntry> {
  return call(profile, 'GET', `/network/${id}`);
}

export async function getNetworkBody(profile: string, id: number, part: 'request' | 'response'): Promise<NetworkBody> {
  const params = new URLSearchParams({ part });
  return call(profile, 'GET', `/network/${id}/body?${params}`);
}

export async function requestCurl(profile: string, id: number, includeSensitive: boolean): Promise<RequestCurl> {
  const params = new URLSearchParams({ includeSensitive: String(includeSensitive) });
  return call(profile, 'GET', `/request/${id}/curl?${params}`);
}

export async function requestReplay(profile: string, id: number): Promise<RequestReplayResult> {
  return call(profile, 'GET', `/request/${id}/replay`);
}

export async function requestReplayWithBody(profile: string, id: number, body: string): Promise<RequestReplayResult> {
  return call(profile, 'POST', `/request/${id}/replay`, { body });
}

export async function requestReplayWithUrl(profile: string, id: number, url: string): Promise<RequestReplayResult> {
  return call(profile, 'POST', `/request/${id}/replay`, { url });
}

export async function startRecorder(profile: string, options: RecorderStartOptions): Promise<RecorderStatus> {
  return call(profile, 'POST', '/recorder/start', options);
}

export async function getRecorderStatus(profile: string): Promise<RecorderStatus> {
  return call(profile, 'GET', '/recorder/status');
}

export async function stopRecorder(profile: string): Promise<RecorderStopResult> {
  return call(profile, 'POST', '/recorder/stop');
}

export async function runReplayWorkflow(profile: string, workflow: unknown, options: ReplayRunOptions = {}): Promise<ReplayRunResult> {
  return call(profile, 'POST', '/replay/run', { workflow, options });
}

export async function runReplayWorkflowFile(profile: string, workflowPath: string, options: ReplayRunOptions = {}): Promise<ReplayRunResult> {
  return call(profile, 'POST', '/replay/run-file', { path: workflowPath, options });
}

export async function exportReplayCli(profile: string, workflow: unknown): Promise<{ script: string }> {
  return call(profile, 'POST', '/replay/export-cli', { workflow });
}

export async function breakText(profile: string, query: string, scriptUrl?: string): Promise<BreakpointInfo[]> {
  return call(profile, 'POST', '/break/text', { query, scriptUrl });
}

export async function breakXhr(profile: string, url: string): Promise<BreakpointInfo> {
  return call(profile, 'POST', '/break/xhr', { url });
}

export async function installHook(profile: string, name: 'fetch' | 'xhr' | 'crypto'): Promise<HookInfo> {
  return call(profile, 'POST', '/hook', { name });
}

export async function listHooks(profile: string): Promise<HookInfo[]> {
  return call(profile, 'GET', '/hooks');
}

export async function listBreakpoints(profile: string): Promise<BreakpointInfo[]> {
  return call(profile, 'GET', '/breakpoints');
}

export async function removeBreakpoint(profile: string, id: string): Promise<{ removed: boolean; id: string }> {
  return call(profile, 'POST', '/break/remove', { id });
}

export async function pausedInfo(profile: string): Promise<PausedInfo | null> {
  return call(profile, 'GET', '/paused');
}

export async function resume(profile: string): Promise<{ resumed: boolean }> {
  return call(profile, 'POST', '/resume');
}

export async function step(profile: string, kind: 'into' | 'over' | 'out'): Promise<{ step: string }> {
  return call(profile, 'POST', '/step', { kind });
}

export async function evaluate(profile: string, expression: string, pageId?: number): Promise<{ value: unknown }> {
  return call(profile, 'POST', '/eval', pageId ? { expression, pageId } : { expression });
}

export async function authStatus(profile: string): Promise<AuthStatus> {
  return call(profile, 'GET', '/auth/status');
}

export async function listCookies(profile: string, domain?: string): Promise<RedactedCookie[]> {
  const params = domain ? `?${new URLSearchParams({ domain })}` : '';
  return call(profile, 'GET', `/auth/cookies${params}`);
}

export async function exportCookies(profile: string, domain?: string): Promise<CookieRecord[]> {
  const params = domain ? `?${new URLSearchParams({ domain })}` : '';
  return call(profile, 'GET', `/auth/cookies/export${params}`);
}

export async function importCookies(
  profile: string,
  cookies: CookieRecord[],
  source: string,
  domain: string | undefined,
  apply: boolean,
): Promise<CookieImportResult> {
  return call(profile, 'POST', '/auth/cookies/import', { cookies, source, domain, apply });
}

export async function runtimeStorage(profile: string): Promise<StorageSnapshot> {
  return call(profile, 'GET', '/runtime/storage');
}

export async function importRuntimeStorage(profile: string, records: BrowserStorageRecord[]): Promise<StorageImportResult> {
  return call(profile, 'POST', '/runtime/storage/import', { records });
}

export async function saveState(profile: string, name: string, includeCookies: boolean): Promise<{ name: string; statePath: string; state: SavedState }> {
  return call(profile, 'POST', '/state/save', { name, includeCookies });
}

export async function loadState(profile: string, name: string): Promise<{ name: string; statePath: string; restoredPages: number; cookiesSkipped: boolean }> {
  return call(profile, 'POST', '/state/load', { name });
}
