import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, type Page } from 'playwright';
import { BrowserKernelContext } from './browser-kernel-context.js';
import { attachBrowserContext, launchDedicatedProfileContext } from './browser-session.js';
import { exportCookieRecords, prepareCookieImport, redactCookies } from './auth-store.js';
import { getScriptSource } from './debugger-source.js';
import { breakOnTextInObservation, breakOnXhrInObservation, ensureDebuggerReady, evaluateDebuggerExpression, pausedInfoFromObservation, removeStoredBreakpoint, resumeDebugger, stepDebugger } from './debugger-runtime.js';
import { hookSource } from './hook-runtime.js';
import { clickPageTarget, capturePageScreenshot, describeTarget, inspectPageTarget, selectPageOption, typeIntoPageTarget, uploadToPageTarget } from './page-actions.js';
import { wireConsoleRecorder } from './console-recorder.js';
import { MAX_CAPTURED_BODY_BYTES, captureBufferBody, redactHeaders, wireNetworkRecorder } from './network-recorder.js';
import { createPageObservation, type DebuggerPausedEvent, type PageObservation, toBodySummary } from './page-observation.js';
import { createSavedState, getRestorablePageUrls, readStorageSnapshot } from './storage-inspector.js';
import { startRecorderSession, recorderStatus as sessionRecorderStatus, stopRecorderSession, type RecorderSession } from './recorder-runtime.js';
import { runWorkflow, type ReplayDriver } from './replay-runtime.js';
import { exportWorkflowCli as exportWorkflowCliScript } from './workflow-export.js';
import { validateWorkflow } from './workflow-validation.js';
import type {
  RecorderStartOptions,
  RecorderStatus,
  RecorderStopResult,
  ReplayRunOptions,
  ReplayRunResult,
} from './workflow-types.js';
import type {
  AuthStatus,
  BrowserActionResult,
  BrowserClickOptions,
  BrowserElementTarget,
  BrowserInspectResult,
  BrowserScreenshotResult,
  BrowserSelectOptions,
  BrowserTypeOptions,
  BrowserUploadOptions,
  BreakpointInfo,
  CookieImportResult,
  CookieRecord,
  ConsoleEntry,
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
  StorageSnapshot,
} from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';

interface ScriptParsedEvent {
  scriptId: string;
  url?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  isModule?: boolean;
  sourceMapURL?: string;
}

export class BrowserRuntime {
  private readonly kernel = new BrowserKernelContext<PageObservation>();
  private cdpBrowser: Browser | null = null;
  private mode: 'none' | 'dedicated-profile' | 'cdp-attach' = 'none';
  private browserUrl: string | null = null;
  private launchPromise: Promise<void> | null = null;
  private recorderSession: RecorderSession | null = null;

  constructor(private profile: string) {}

  private get context(): BrowserContext | null {
    return this.kernel.context;
  }

  private set context(context: BrowserContext | null) {
    this.kernel.context = context;
  }

  private get pages(): Map<number, Page> {
    return this.kernel.pages;
  }

  private get observations() {
    return this.kernel.observations;
  }

  private get selectedPageId(): number | null {
    return this.kernel.selectedPageId;
  }

  private set selectedPageId(pageId: number | null) {
    this.kernel.selectedPageId = pageId;
  }

  async ensureLaunched(): Promise<void> {
    if (this.context) return;
    if (this.launchPromise) {
      await this.launchPromise;
      return;
    }

    this.launchPromise = this.launch();
    try {
      await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }
  private async launch(): Promise<void> {
    this.context = await launchDedicatedProfileContext(this.profile);
    this.mode = 'dedicated-profile';
    this.browserUrl = null;

    this.context.on('page', page => this.adoptPage(page));

    for (const page of this.context.pages()) {
      this.adoptPage(page);
    }
  }

  async open(url: string): Promise<PageInfo> {
    await this.ensureLaunched();
    const page = await this.context!.newPage();
    const id = this.adoptPage(page);
    this.selectedPageId = id;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return this.toPageInfo(id, page);
  }

  async navigate(url: string, pageId?: number): Promise<PageInfo> {
    await this.ensureLaunched();
    const { pageId: resolvedPageId, page } = this.getPage(pageId);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return this.toPageInfo(resolvedPageId, page);
  }
  async attach(
    browserUrl: string,
    attachFn: typeof attachBrowserContext = attachBrowserContext,
  ): Promise<{ mode: 'cdp-attach'; browserUrl: string; pages: PageInfo[] }> {
    await this.resetContext();
    const attached = await attachFn(browserUrl);
    this.cdpBrowser = attached.browser;
    this.context = attached.context;
    this.mode = 'cdp-attach';
    this.browserUrl = browserUrl;
    this.context.on('page', page => this.adoptPage(page));
    for (const page of this.context.pages()) this.adoptPage(page);
    return { mode: 'cdp-attach', browserUrl, pages: await this.listPages() };
  }

  async detach(): Promise<{ detached: boolean; previousMode: string }> {
    const previousMode = this.mode;
    await this.resetContext();
    return { detached: previousMode === 'cdp-attach', previousMode };
  }

  async listPages(): Promise<PageInfo[]> {
    await this.ensureLaunched();
    const entries = [...this.pages.entries()];
    const result: PageInfo[] = [];
    for (const [id, page] of entries) {
      if (page.isClosed()) {
        this.kernel.removePage(id);
        continue;
      }
      result.push(await this.toPageInfo(id, page));
    }
    return result;
  }

  async reload(pageId?: number): Promise<PageInfo> {
    const { pageId: resolvedPageId, page } = this.getPage(pageId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    return this.toPageInfo(resolvedPageId, page);
  }

  async click(options: BrowserClickOptions): Promise<BrowserActionResult> {
    const { pageId, page } = this.getPage(options.pageId);
    const targetDescription = await clickPageTarget(page, options);
    return {
      action: 'click',
      page: await this.toPageInfo(pageId, page),
      target: targetDescription,
      url: page.url(),
    };
  }

  async type(options: BrowserTypeOptions): Promise<BrowserActionResult> {
    const { pageId, page } = this.getPage(options.pageId);
    await typeIntoPageTarget(page, options);
    return {
      action: 'type',
      page: await this.toPageInfo(pageId, page),
      target: this.describeTarget(options),
      text: options.value,
      url: page.url(),
    };
  }

  async upload(options: BrowserUploadOptions): Promise<BrowserActionResult> {
    const { pageId, page } = this.getPage(options.pageId);
    const target = await uploadToPageTarget(page, options);
    return {
      action: 'upload',
      page: await this.toPageInfo(pageId, page),
      target: this.describeTarget(target),
      files: options.files,
      url: page.url(),
    };
  }

  async select(options: BrowserSelectOptions): Promise<BrowserActionResult> {
    const { pageId, page } = this.getPage(options.pageId);
    const target = await selectPageOption(page, options);
    return {
      action: 'select',
      page: await this.toPageInfo(pageId, page),
      target: `${this.describeTarget(target)} -> option:${options.option}`,
      url: page.url(),
    };
  }

  async inspectTarget(target: BrowserElementTarget): Promise<BrowserInspectResult> {
    const { pageId, page } = this.getPage(target.pageId);
    const candidates = await inspectPageTarget(page, target, 20);
    return {
      page: await this.toPageInfo(pageId, page),
      target: this.describeTarget(target),
      candidates,
    };
  }

  async screenshot(fullPage: boolean, pageId?: number): Promise<BrowserScreenshotResult> {
    const { pageId: resolvedPageId, page } = this.getPage(pageId);
    const buffer = await capturePageScreenshot(page, fullPage);
    return {
      page: await this.toPageInfo(resolvedPageId, page),
      mimeType: 'image/png',
      bytes: buffer.byteLength,
      base64: buffer.toString('base64'),
    };
  }

  async listScripts(pageId?: number): Promise<ScriptInfo[]> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = await this.ensureDebugger(resolvedPageId);
    return [...observation.scripts.values()].sort((a, b) => {
      const urlCmp = a.url.localeCompare(b.url);
      return urlCmp === 0 ? a.scriptId.localeCompare(b.scriptId) : urlCmp;
    });
  }

  async getScript(scriptId: string, pageId?: number): Promise<{ info: ScriptInfo; source: string }> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = await this.ensureDebugger(resolvedPageId);
    const info = observation.scripts.get(scriptId);
    if (!info) throw new SiteflowError('SCRIPT_NOT_FOUND', `Script not found: ${scriptId}`);
    const source = await getScriptSource(observation.cdp!, scriptId);
    return { info, source };
  }

  async searchScripts(query: string, limit: number, pageId?: number): Promise<ScriptSearchMatch[]> {
    const scripts = await this.listScripts(pageId);
    const matches: ScriptSearchMatch[] = [];
    for (const script of scripts) {
      if (matches.length >= limit) break;
      let source: string;
      try {
        source = (await this.getScript(script.scriptId, pageId)).source;
      } catch {
        continue;
      }
      const lines = source.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index].includes(query)) continue;
        matches.push({
          scriptId: script.scriptId,
          url: script.url,
          lineNumber: index,
          line: lines[index].trim().slice(0, 500),
        });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  async listConsole(limit: number, pageId?: number): Promise<ConsoleEntry[]> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = this.getObservation(resolvedPageId);
    return observation.console.slice(-limit);
  }

  async listNetwork(limit: number, pageId?: number): Promise<NetworkEntry[]> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = this.getObservation(resolvedPageId);
    return observation.network.slice(-limit);
  }

  async getNetwork(id: number, pageId?: number): Promise<NetworkEntry> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = this.getObservation(resolvedPageId);
    const entry = observation.network.find(item => item.id === id);
    if (!entry) throw new SiteflowError('NETWORK_ENTRY_NOT_FOUND', `Network entry not found: ${id}`);
    return entry;
  }

  async getNetworkBody(id: number, part: 'request' | 'response', pageId?: number): Promise<NetworkBody> {
    const entry = await this.getNetwork(id, pageId);
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = this.getObservation(resolvedPageId);
    const captured = observation.networkBodies.get(id)?.[part];
    if (!captured) {
      throw new SiteflowError('NETWORK_BODY_NOT_CAPTURED', `${part} body was not captured for network entry: ${id}`);
    }
    if (captured.error) {
      throw new SiteflowError('NETWORK_BODY_UNAVAILABLE', captured.error);
    }
    return {
      id,
      url: entry.url,
      method: entry.method,
      part,
      ...(captured.contentType ? { contentType: captured.contentType } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      bytes: captured.bytes,
      truncated: captured.truncated,
      encoding: captured.encoding,
      body: captured.body,
    };
  }

  async requestCurl(id: number, includeSensitive: boolean, pageId?: number): Promise<RequestCurl> {
    const entry = await this.getNetwork(id, pageId);
    const observation = this.getObservation(this.getPage(pageId).pageId);
    const details = observation.networkDetails.get(id);
    if (!details) throw new SiteflowError('REQUEST_DETAILS_NOT_FOUND', `Request details not found: ${id}`);
    const headers = includeSensitive ? details.requestHeaders : redactHeaders(details.requestHeaders);
    const args = ['curl', '-i', '-X', entry.method];
    for (const [name, value] of Object.entries(headers)) {
      if (this.shouldSkipCurlHeader(name)) continue;
      args.push('-H', `${name}: ${value}`);
    }
    if (details.postData) args.push('--data-raw', details.postData);
    args.push(entry.url);
    return { id, command: args.map(arg => this.shellQuote(arg)).join(' '), redacted: !includeSensitive };
  }

  async replayRequest(id: number, bodyOverride?: string, urlOverride?: string, pageId?: number): Promise<RequestReplayResult> {
    const entry = await this.getNetwork(id, pageId);
    const { pageId: resolvedPageId, page } = this.getPage(pageId);
    const details = this.getObservation(resolvedPageId).networkDetails.get(id);
    if (!details) throw new SiteflowError('REQUEST_DETAILS_NOT_FOUND', `Request details not found: ${id}`);
    if (entry.url.startsWith('file://')) {
      const buffer = await fs.readFile(fileURLToPath(entry.url));
      const captured = captureBufferBody(buffer, entry.contentType);
      return {
        id,
        url: entry.url,
        method: entry.method,
        status: 200,
        statusText: 'OK',
        headers: {},
        body: {
          ...toBodySummary(captured),
          body: captured.body,
        },
      };
    }
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      if (['host', 'content-length', 'connection'].includes(name.toLowerCase())) delete headers[name];
      if ((entry.method === 'GET' || entry.method === 'HEAD') && name.toLowerCase() === 'content-type') delete headers[name];
    }
    const replayUrl = urlOverride || entry.url;
    const result = await page.evaluate(async ({ url, method, headers, body, maxBytes }) => {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        credentials: 'include',
      });
      const buffer = await response.arrayBuffer();
      const bytes = buffer.byteLength;
      const slice = buffer.slice(0, Math.min(bytes, maxBytes));
      const contentType = response.headers.get('content-type') || '';
      const textLike = contentType.startsWith('text/')
        || contentType.includes('json')
        || contentType.includes('javascript')
        || contentType.includes('xml')
        || contentType.includes('form-urlencoded');
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      const bodyText = textLike
        ? new TextDecoder().decode(slice)
        : btoa(String.fromCharCode(...new Uint8Array(slice)));
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: {
          available: true,
          bytes,
          truncated: bytes > maxBytes,
          encoding: textLike ? 'utf8' as const : 'base64' as const,
          body: bodyText,
        },
      };
    }, {
      url: replayUrl,
      method: entry.method,
      headers,
      body: bodyOverride === undefined ? details.postData : bodyOverride,
      maxBytes: MAX_CAPTURED_BODY_BYTES,
    });
    return {
      id,
      url: replayUrl,
      method: entry.method,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
    };
  }

  async startRecorder(options: RecorderStartOptions): Promise<RecorderStatus> {
    if (this.recorderSession) {
      throw new SiteflowError('RECORDER_ALREADY_RUNNING', 'A recorder session is already running. Stop it before starting another recorder.');
    }

    await this.ensureLaunched();
    let resolved: { pageId: number; page: Page };
    if (options.pageId !== undefined) {
      resolved = this.getPage(options.pageId);
    } else if (this.selectedPageId !== null) {
      resolved = this.getSelectedPage();
    } else if (options.url) {
      const page = await this.context!.newPage();
      const pageId = this.adoptPage(page);
      this.selectedPageId = pageId;
      resolved = { pageId, page };
    } else {
      resolved = this.getSelectedPage();
    }
    this.selectedPageId = resolved.pageId;
    this.recorderSession = await startRecorderSession(resolved.page, resolved.pageId, options);
    return sessionRecorderStatus(this.recorderSession);
  }

  recorderStatus(): RecorderStatus {
    return sessionRecorderStatus(this.recorderSession);
  }

  async stopRecorder(): Promise<RecorderStopResult> {
    if (!this.recorderSession) throw new SiteflowError('RECORDER_NOT_RUNNING', 'No recorder session is running.');
    const result = await stopRecorderSession(this.recorderSession);
    this.recorderSession = null;
    return result;
  }

  async runReplayWorkflow(workflowValue: unknown, options: ReplayRunOptions): Promise<ReplayRunResult> {
    const workflow = validateWorkflow(workflowValue);
    let replayPageId = options.pageId;
    const openReplayPage = async (url: string): Promise<PageInfo> => {
      const page = replayPageId === undefined
        ? await this.open(url)
        : await this.navigate(url, replayPageId);
      replayPageId = page.id;
      return page;
    };
    const driver: ReplayDriver = {
      open: openReplayPage,
      click: (clickOptions: BrowserClickOptions) => this.click({ ...clickOptions, pageId: replayPageId }),
      type: (typeOptions: BrowserTypeOptions) => this.type({ ...typeOptions, pageId: replayPageId }),
      select: (selectOptions: BrowserSelectOptions) => this.select({ ...selectOptions, pageId: replayPageId }),
      screenshot: (fullPage: boolean) => this.screenshot(fullPage, replayPageId),
      scroll: async (deltaX: number, deltaY: number) => {
        const { page } = this.getPage(replayPageId);
        await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: deltaX, y: deltaY });
      },
      waitFor: (condition) => this.waitForReplayCondition(condition, replayPageId),
    };
    const firstStep = workflow.steps[0];
    if (options.dryRun !== true && (firstStep === undefined || firstStep.type !== 'open' || firstStep.url !== workflow.startUrl)) {
      await openReplayPage(workflow.startUrl);
    }
    return runWorkflow(driver, workflow, options);
  }

  exportReplayCli(workflowValue: unknown): { script: string } {
    return { script: exportWorkflowCliScript(validateWorkflow(workflowValue)) };
  }

  async installHook(name: HookInfo['name']): Promise<HookInfo> {
    const { pageId, page } = this.getSelectedPage();
    const observation = this.getObservation(pageId);
    if (observation.hooks.has(name)) {
      return { name, installed: false, note: 'Hook was already installed for this page.' };
    }
    const source = hookSource(name);
    await page.addInitScript(source);
    await page.evaluate(source);
    observation.hooks.add(name);
    return { name, installed: true, note: 'Hook installed. Reload to hook code that runs during initial page load.' };
  }

  async listHooks(): Promise<HookInfo[]> {
    const observation = this.getSelectedObservation();
    return [...observation.hooks].sort().map(name => ({
      name,
      installed: true,
      note: 'Hook is installed for the selected page.',
    }));
  }

  async breakOnText(query: string, scriptUrl?: string): Promise<BreakpointInfo[]> {
    const { pageId } = this.getSelectedPage();
    const observation = await this.ensureDebugger(pageId);
    return breakOnTextInObservation(observation, query, scriptUrl);
  }

  async breakOnXhr(urlSubstring: string): Promise<BreakpointInfo> {
    const { pageId } = this.getSelectedPage();
    const observation = await this.ensureDebugger(pageId);
    return breakOnXhrInObservation(observation, urlSubstring);
  }

  async listBreakpoints(): Promise<BreakpointInfo[]> {
    const { pageId } = this.getSelectedPage();
    const observation = this.getObservation(pageId);
    return [...observation.breakpoints.values()];
  }

  async removeBreakpoint(id: string): Promise<{ removed: boolean; id: string }> {
    const { pageId } = this.getSelectedPage();
    const observation = await this.ensureDebugger(pageId);
    return removeStoredBreakpoint(observation, id);
  }

  async pausedInfo(): Promise<PausedInfo | null> {
    const { pageId } = this.getSelectedPage();
    const observation = this.getObservation(pageId);
    return pausedInfoFromObservation(observation);
  }

  async resume(): Promise<{ resumed: boolean }> {
    const { pageId } = this.getSelectedPage();
    const observation = await this.ensureDebugger(pageId);
    return resumeDebugger(observation);
  }

  async step(kind: 'into' | 'over' | 'out'): Promise<{ step: string }> {
    const { pageId } = this.getSelectedPage();
    const observation = await this.ensureDebugger(pageId);
    return stepDebugger(observation, kind);
  }

  async evaluate(expression: string, pageId?: number): Promise<unknown> {
    const { pageId: resolvedPageId } = this.getPage(pageId);
    const observation = await this.ensureDebugger(resolvedPageId);
    return evaluateDebuggerExpression(observation, expression);
  }

  async authStatus(): Promise<AuthStatus> {
    const cookieCount = this.context ? (await this.context.cookies()).length : 0;
    return {
      mode: this.mode,
      ...(this.browserUrl ? { browserUrl: this.browserUrl } : {}),
      cookieCount,
      note: this.mode === 'cdp-attach'
        ? 'Attached browser cookies/sessions are available to the attached browser context.'
        : 'Dedicated profile is isolated from your daily Chrome profile.',
    };
  }

  async cookies(domain?: string): Promise<RedactedCookie[]> {
    if (!this.context) throw new SiteflowError('BROWSER_NOT_CONNECTED', 'No browser context available');
    return redactCookies(await this.context.cookies(), domain);
  }

  async exportCookies(domain?: string): Promise<CookieRecord[]> {
    if (!this.context) throw new SiteflowError('BROWSER_NOT_CONNECTED', 'No browser context available');
    return exportCookieRecords(await this.context.cookies(), domain);
  }

  async importCookies(cookies: CookieRecord[], domain: string | undefined, apply: boolean): Promise<CookieImportResult> {
    const { filtered, result } = prepareCookieImport(cookies, domain, apply);
    if (!apply) {
      return result;
    }
    await this.ensureLaunched();
    await this.context!.addCookies(filtered.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires ?? -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite || 'Lax',
    })));
    return result;
  }

  async storage(): Promise<StorageSnapshot> {
    const { page } = this.getSelectedPage();
    return readStorageSnapshot(page);
  }

  async captureState(includeCookies: boolean): Promise<SavedState> {
    const pages = await this.listPages();
    const cookies = includeCookies ? await this.cookies() : [];
    return createSavedState(pages, includeCookies, cookies);
  }

  async restoreState(state: SavedState): Promise<{ restoredPages: number; cookiesSkipped: boolean }> {
    await this.ensureLaunched();
    let restoredPages = 0;
    for (const url of getRestorablePageUrls(state)) {
      await this.open(url);
      restoredPages++;
    }
    return { restoredPages, cookiesSkipped: Boolean(state.cookies?.length) };
  }

  async close(): Promise<void> {
    await this.resetContext();
  }

  private async resetContext(): Promise<void> {
    if (this.context && this.mode !== 'cdp-attach') {
      await this.context.close().catch(() => {});
    }
    if (this.cdpBrowser) {
      await this.cdpBrowser.close().catch(() => {});
    }
    this.context = null;
    this.cdpBrowser = null;
    this.mode = 'none';
    this.browserUrl = null;
    this.kernel.reset();
  }

  private adoptPage(page: Page): number {
    const { id, created } = this.kernel.adoptPage(page, createPageObservation());
    if (created) {
      this.wirePageObservation(id, page);
      page.on('close', () => {
        this.kernel.removePage(id);
      });
    }
    return id;
  }

  private wirePageObservation(pageId: number, page: Page): void {
    const observation = this.getObservation(pageId);
    wireConsoleRecorder(page, observation);
    wireNetworkRecorder(page, observation);
  }

  private getObservation(pageId: number): PageObservation {
    const observation = this.observations.get(pageId);
    if (!observation) throw new SiteflowError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
    return observation;
  }

  private getSelectedObservation(): PageObservation {
    const { pageId } = this.getSelectedPage();
    return this.getObservation(pageId);
  }

  private getPage(pageId?: number): { pageId: number; page: Page } {
    if (pageId === undefined || pageId === null) return this.getSelectedPage();
    const page = this.pages.get(pageId);
    if (!page || page.isClosed()) {
      throw new SiteflowError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
    }
    return { pageId, page };
  }

  private getSelectedPage(): { pageId: number; page: Page } {
    if (this.selectedPageId === null) {
      throw new SiteflowError('NO_SELECTED_PAGE', 'No selected page', 'Run siteflow browser open <url>.');
    }
    const page = this.pages.get(this.selectedPageId);
    if (!page || page.isClosed()) {
      throw new SiteflowError('NO_SELECTED_PAGE', 'Selected page is closed', 'Run siteflow browser open <url>.');
    }
    return { pageId: this.selectedPageId, page };
  }

  private async ensureDebugger(pageId: number): Promise<PageObservation> {
    const page = this.pages.get(pageId);
    if (!page || page.isClosed()) {
      throw new SiteflowError('PAGE_NOT_FOUND', `Page not found: ${pageId}`);
    }
    const observation = this.getObservation(pageId);
    return ensureDebuggerReady(page, observation);
  }


  private async waitForReplayCondition(condition: { ms: number; selector?: string; text?: string; urlContains?: string }, pageId?: number): Promise<void> {
    const deadline = Date.now() + condition.ms;
    for (;;) {
      try {
        const { page } = this.getPage(pageId);
        const matched = await page.evaluate(({ selector, text, urlContains }) => {
          const selectorMatched = selector === undefined || document.querySelector(selector) !== null;
          const textMatched = text === undefined || document.body?.innerText.includes(text) === true;
          const urlMatched = urlContains === undefined || window.location.href.includes(urlContains);
          return selectorMatched && textMatched && urlMatched;
        }, condition);
        if (matched) return;
      } catch (error) {
        if (!this.isNavigationEvaluationError(error)) throw error;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new SiteflowError('REPLAY_WAIT_TIMEOUT', 'Timed out waiting for workflow condition.');
      }
      await sleep(Math.min(50, remainingMs));
    }
  }

  private isNavigationEvaluationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Execution context was destroyed')
      || message.includes('Cannot find context with specified id')
      || message.includes('Most likely because of a navigation');
  }

  private shouldSkipCurlHeader(name: string): boolean {
    return ['host', 'content-length', 'connection'].includes(name.toLowerCase());
  }

  private shellQuote(value: string): string {
    if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private describeTarget(target: BrowserElementTarget): string {
    return describeTarget(target);
  }


  private async toPageInfo(id: number, page: Page): Promise<PageInfo> {
    if (page.isClosed()) {
      throw new SiteflowError('PAGE_CLOSED', `Page ${id} is closed`);
    }
    let title = '';
    try {
      title = await page.title();
    } catch {
      title = '';
    }
    return {
      id,
      url: page.url(),
      title,
      selected: id === this.selectedPageId,
    };
  }
}
