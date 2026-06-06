#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  startDaemon,
  getDaemonStatus,
  stopDaemon,
  openPage,
  attachBrowser,
  detachBrowser,
  listPages,
  reloadPage,
  browserClick,
  browserInspectTarget,
  browserType,
  browserUpload,
  browserSelect,
  browserScreenshot,
  listScripts,
  getScript,
  searchScripts,
  listConsole,
  listNetwork,
  getNetwork,
  getNetworkBody,
  requestCurl,
  requestReplay,
  breakText,
  breakXhr,
  installHook,
  listHooks,
  listBreakpoints,
  removeBreakpoint,
  pausedInfo,
  resume,
  step,
  evaluate,
  authStatus,
  listCookies,
  exportCookies,
  importCookies,
  importRuntimeStorage,
  runtimeStorage,
  saveState,
  loadState,
} from '../daemon/client.js';
import {
  buildBrowserImportReceipt,
  discoverChromiumSources,
  extractBrowserSession,
  findBrowserSource,
  pickDefaultBrowserSource,
} from '../runtime/browser-session-import.js';
import { toSiteflowError } from '../shared/errors.js';
import { browserProfileDir, siteflowHome, profileDir } from '../shared/paths.js';
import {
  exportTraceEvents,
  getTraceReceipt,
  listTraceEvents,
  listTraceReceipts,
  writeFailureReceipt,
} from '../traces/artifact-store.js';
import { printError, printSuccess, type OutputOptions } from './output.js';
import type { CookieRecord, NetworkBody, NetworkEntry, TraceEvent } from '../shared/types.js';
import { registerSiteCommands } from '../sites/registry.js';

interface GlobalOptions {
  json?: boolean;
  profile?: string;
}

function outputOptions(command: Command): OutputOptions {
  const opts = command.optsWithGlobals<GlobalOptions>();
  return {
    json: Boolean(opts.json),
    profile: opts.profile || 'default',
  };
}

function parseXy(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) return undefined;
  const [xRaw, yRaw] = value.split(',');
  const x = Number.parseFloat(xRaw);
  const y = Number.parseFloat(yRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('--xy must be formatted as x,y');
  }
  return { x, y };
}

function decodeBody(body: NetworkBody): Buffer {
  return body.encoding === 'base64' ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'utf8');
}

function extensionForContentType(contentType: string | undefined): string {
  const type = (contentType || '').toLowerCase();
  if (type.includes('application/json')) return 'json';
  if (type.includes('text/html')) return 'html';
  if (type.includes('javascript')) return 'js';
  if (type.includes('text/css')) return 'css';
  if (type.startsWith('text/')) return 'txt';
  if (type.includes('image/jpeg')) return 'jpg';
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/webp')) return 'webp';
  if (type.includes('image/gif')) return 'gif';
  if (type.includes('video/mp4')) return 'mp4';
  if (type.includes('application/octet-stream')) return 'bin';
  return 'body';
}

function compactNetworkUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function matchesRegex(value: string | undefined, pattern: string | undefined): boolean {
  if (!pattern) return true;
  return new RegExp(pattern, 'i').test(value || '');
}

function matchesNetworkDumpFilters(entry: NetworkEntry, filters: {
  url?: string;
  method?: string;
  type?: string;
  status?: string;
}): boolean {
  if (!matchesRegex(entry.url, filters.url)) return false;
  if (!matchesRegex(entry.method, filters.method)) return false;
  if (!matchesRegex(`${entry.resourceType} ${entry.contentType || ''}`, filters.type)) return false;
  if (filters.status && String(entry.status || '') !== filters.status) return false;
  return true;
}

async function dumpNetworkBodies(profile: string, options: {
  out: string;
  limit: number;
  url?: string;
  method?: string;
  type?: string;
  status?: string;
  bodies: boolean;
  maxBodyBytes: number;
}): Promise<unknown> {
  const entries = (await listNetwork(profile, options.limit))
    .filter(entry => matchesNetworkDumpFilters(entry, options));
  const outDir = path.resolve(options.out);
  const bodyDir = path.join(outDir, 'bodies');
  fs.mkdirSync(outDir, { recursive: true });
  if (options.bodies) fs.mkdirSync(bodyDir, { recursive: true });

  const dumped: Array<Record<string, unknown>> = [];
  const errors: Array<{ id: number; part: string; message: string }> = [];
  let writtenBodies = 0;

  for (const entry of entries) {
    const item: Record<string, unknown> = {
      ...entry,
      compactUrl: compactNetworkUrl(entry.url),
      bodies: {},
    };
    const bodyFiles: Record<string, unknown> = {};
    if (options.bodies) {
      for (const part of ['request', 'response'] as const) {
        const summary = part === 'request' ? entry.requestBody : entry.responseBody;
        if (!summary?.available) continue;
        if ((summary.bytes || 0) > options.maxBodyBytes) {
          bodyFiles[part] = { skipped: true, reason: 'max_body_bytes', bytes: summary.bytes };
          continue;
        }
        try {
          const body = await getNetworkBody(profile, entry.id, part);
          const ext = extensionForContentType(body.contentType || entry.contentType);
          const fileName = `${String(entry.id).padStart(5, '0')}-${part}.${ext}`;
          const filePath = path.join(bodyDir, fileName);
          fs.writeFileSync(filePath, decodeBody(body), { mode: 0o600 });
          writtenBodies += 1;
          bodyFiles[part] = {
            path: path.relative(outDir, filePath),
            bytes: body.bytes,
            truncated: body.truncated,
            encoding: body.encoding,
            contentType: body.contentType || entry.contentType,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ id: entry.id, part, message });
          bodyFiles[part] = { error: message };
        }
      }
    }
    item.bodies = bodyFiles;
    dumped.push(item);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    profile,
    source: 'selected-page-network',
    filters: {
      limit: options.limit,
      url: options.url,
      method: options.method,
      type: options.type,
      status: options.status,
      bodies: options.bodies,
      maxBodyBytes: options.maxBodyBytes,
    },
    counts: {
      matchedEntries: dumped.length,
      writtenBodies,
      errors: errors.length,
    },
    entries: dumped,
    errors,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return {
    outDir,
    manifest: manifestPath,
    matchedEntries: dumped.length,
    writtenBodies,
    errors,
  };
}

async function run(command: Command, fn: (opts: OutputOptions) => Promise<unknown>): Promise<void> {
  const opts = outputOptions(command);
  try {
    const data = await fn(opts);
    printSuccess(data, opts);
  } catch (error) {
    const err = toSiteflowError(error);
    const receipt = writeFailureReceipt(opts.profile, process.argv.slice(2), err);
    printError({
      code: err.code,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
      ...(receipt ? { receipt: receipt.receiptPath } : {}),
    }, opts);
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name('siteflow')
  .description('Reusable site workflows powered by a local browser kernel')
  .version('0.1.0')
  .option('--json', 'print stable JSON envelope')
  .option('--profile <name>', 'profile name', 'default');

program
  .command('doctor')
  .description('Check CLI, daemon, and profile status')
  .action(async function () {
    await run(this, async opts => {
      const status = await getDaemonStatus(opts.profile);
      return {
        version: '0.1.0',
        home: siteflowHome(),
        profile: opts.profile,
        profileDir: profileDir(opts.profile),
        browserProfileDir: browserProfileDir(opts.profile),
        daemon: status,
        features: {
          daemon: true,
          dedicatedProfile: true,
          browserOpen: true,
          pagesList: true,
          scripts: true,
          console: true,
          network: true,
          debugger: true,
          cookieImport: false,
          cookieImportFromFile: true,
          cdpAttach: true,
          traces: true,
          eventReplay: true,
          failureReceipts: true,
          networkBodies: true,
          requestReplay: true,
          hooks: true,
          authStatus: true,
          state: true,
          browserActions: true,
          screenshot: true,
        },
      };
    });
  });

const daemon = program.command('daemon').description('Manage the siteflow daemon');

daemon
  .command('start')
  .description('Start daemon for the selected profile')
  .action(async function () {
    await run(this, opts => startDaemon(opts.profile));
  });

daemon
  .command('status')
  .description('Show daemon status for the selected profile')
  .action(async function () {
    await run(this, opts => getDaemonStatus(opts.profile));
  });

daemon
  .command('stop')
  .description('Stop daemon for the selected profile')
  .action(async function () {
    await run(this, opts => stopDaemon(opts.profile));
  });

const browser = program.command('browser').description('Browser session commands');

browser
  .command('open')
  .description('Open a URL in the daemon browser')
  .argument('<url>', 'URL to open')
  .action(async function (url: string) {
    await run(this, opts => openPage(opts.profile, url));
  });

browser
  .command('attach')
  .description('Attach to an existing browser over CDP')
  .requiredOption('--browser-url <url>', 'CDP endpoint, for example http://127.0.0.1:9222')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{ browserUrl: string }>();
      return attachBrowser(opts.profile, local.browserUrl);
    });
  });

browser
  .command('detach')
  .description('Detach from an attached browser and clear current browser state')
  .action(async function () {
    await run(this, opts => detachBrowser(opts.profile));
  });

browser
  .command('pages')
  .description('List open pages')
  .action(async function () {
    await run(this, opts => listPages(opts.profile));
  });

browser
  .command('reload')
  .description('Reload the selected page')
  .action(async function () {
    await run(this, opts => reloadPage(opts.profile));
  });

browser
  .command('click')
  .description('Click an element in the selected page by selector, text, aria label, or x/y coordinates')
  .option('--selector <selector>', 'CSS selector to click')
  .option('--text <text>', 'visible text to click')
  .option('--aria <label>', 'aria-label or accessible label to click')
  .option('--xy <x,y>', 'page coordinates, for example 640,420')
  .option('--nth <n>', 'zero-based match index', '0')
  .option('--fuzzy', 'allow partial text/label matching')
  .option('--force', 'force the click even if another element intercepts pointer events')
  .option('--clickable-parent', 'click the nearest interactive parent of the matched target')
  .option('--expect-url-contains <text>', 'require the page URL to contain text after clicking')
  .option('--expect-text <text>', 'require visible text after clicking')
  .option('--expect-selector <selector>', 'require a visible selector after clicking')
  .option('--button <button>', 'left, right, or middle', 'left')
  .option('--timeout <ms>', 'action timeout in milliseconds', '10000')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        selector?: string;
        text?: string;
        aria?: string;
        xy?: string;
        nth: string;
        fuzzy?: boolean;
        force?: boolean;
        clickableParent?: boolean;
        expectUrlContains?: string;
        expectText?: string;
        expectSelector?: string;
        button: string;
        timeout: string;
      }>();
      const nth = Number.parseInt(local.nth, 10);
      const timeoutMs = Number.parseInt(local.timeout, 10);
      const xy = parseXy(local.xy);
      const button = local.button === 'right' || local.button === 'middle' ? local.button : 'left';
      return browserClick(opts.profile, {
        selector: local.selector,
        text: local.text,
        aria: local.aria,
        ...(xy ? { x: xy.x, y: xy.y } : {}),
        nth: Number.isFinite(nth) ? nth : 0,
        exact: !local.fuzzy,
        force: Boolean(local.force),
        clickableParent: Boolean(local.clickableParent),
        expectUrlContains: local.expectUrlContains,
        expectText: local.expectText,
        expectSelector: local.expectSelector,
        button,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10_000,
      });
    });
  });

browser
  .command('inspect-target')
  .description('Inspect visible candidates for a browser action target')
  .option('--selector <selector>', 'CSS selector to inspect')
  .option('--text <text>', 'visible text to inspect')
  .option('--aria <label>', 'aria-label or accessible label to inspect')
  .option('--fuzzy', 'allow partial text/label matching')
  .option('--all', 'include hidden and zero-size matches')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        selector?: string;
        text?: string;
        aria?: string;
        fuzzy?: boolean;
        all?: boolean;
      }>();
      return browserInspectTarget(opts.profile, {
        selector: local.selector,
        text: local.text,
        aria: local.aria,
        exact: !local.fuzzy,
        includeHidden: Boolean(local.all),
      });
    });
  });

browser
  .command('type')
  .description('Type into an input, textarea, or contenteditable element in the selected page')
  .requiredOption('--value <text>', 'text to type')
  .option('--selector <selector>', 'CSS selector to type into')
  .option('--text <text>', 'visible text target to focus before typing')
  .option('--aria <label>', 'aria-label or accessible label to type into')
  .option('--nth <n>', 'zero-based match index', '0')
  .option('--fuzzy', 'allow partial text/label matching')
  .option('--no-clear', 'do not clear the focused editable before typing')
  .option('--enter', 'press Enter after typing')
  .option('--timeout <ms>', 'action timeout in milliseconds', '10000')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        value: string;
        selector?: string;
        text?: string;
        aria?: string;
        nth: string;
        fuzzy?: boolean;
        clear?: boolean;
        enter?: boolean;
        timeout: string;
      }>();
      const nth = Number.parseInt(local.nth, 10);
      const timeoutMs = Number.parseInt(local.timeout, 10);
      return browserType(opts.profile, {
        value: local.value,
        selector: local.selector,
        text: local.text,
        aria: local.aria,
        nth: Number.isFinite(nth) ? nth : 0,
        exact: !local.fuzzy,
        clear: local.clear,
        pressEnter: Boolean(local.enter),
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10_000,
      });
    });
  });

browser
  .command('upload')
  .description('Upload one or more files through a file input')
  .requiredOption('--file <path...>', 'file path(s) to upload')
  .option('--selector <selector>', 'CSS selector for the file input', 'input[type="file"]')
  .option('--text <text>', 'visible text target for a file input')
  .option('--aria <label>', 'aria-label or accessible label for a file input')
  .option('--nth <n>', 'zero-based match index', '0')
  .option('--fuzzy', 'allow partial text/label matching')
  .option('--timeout <ms>', 'action timeout in milliseconds', '10000')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        file: string[];
        selector?: string;
        text?: string;
        aria?: string;
        nth: string;
        fuzzy?: boolean;
        timeout: string;
      }>();
      const nth = Number.parseInt(local.nth, 10);
      const timeoutMs = Number.parseInt(local.timeout, 10);
      return browserUpload(opts.profile, {
        files: local.file,
        selector: local.selector,
        text: local.text,
        aria: local.aria,
        nth: Number.isFinite(nth) ? nth : 0,
        exact: !local.fuzzy,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10_000,
      });
    });
  });

browser
  .command('select')
  .description('Open a combobox/dropdown and choose an option by visible text')
  .requiredOption('--option <text>', 'option text to choose')
  .option('--selector <selector>', 'CSS selector for the combobox/dropdown')
  .option('--combobox-text <text>', 'visible text of the combobox/dropdown')
  .option('--fuzzy', 'allow partial text matching')
  .option('--force', 'force clicks even if another element intercepts pointer events')
  .option('--no-verify', 'do not verify that the combobox label changed after selecting')
  .option('--timeout <ms>', 'action timeout in milliseconds', '10000')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        option: string;
        selector?: string;
        comboboxText?: string;
        fuzzy?: boolean;
        force?: boolean;
        verify?: boolean;
        timeout: string;
      }>();
      const timeoutMs = Number.parseInt(local.timeout, 10);
      return browserSelect(opts.profile, {
        option: local.option,
        selector: local.selector,
        comboboxText: local.comboboxText,
        exact: !local.fuzzy,
        force: Boolean(local.force),
        verify: local.verify,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10_000,
      });
    });
  });

browser
  .command('screenshot')
  .description('Capture the selected page as a PNG')
  .requiredOption('--out <path>', 'output PNG path')
  .option('--full-page', 'capture the full page instead of the viewport')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{ out: string; fullPage?: boolean }>();
      const result = await browserScreenshot(opts.profile, Boolean(local.fullPage));
      const fs = await import('node:fs');
      fs.writeFileSync(local.out, Buffer.from(result.base64, 'base64'));
      return {
        page: result.page,
        mimeType: result.mimeType,
        bytes: result.bytes,
        out: local.out,
      };
    });
  });

const scripts = program.command('scripts').description('JavaScript source commands');

scripts
  .command('list')
  .description('List scripts loaded in the selected page')
  .action(async function () {
    await run(this, opts => listScripts(opts.profile));
  });

scripts
  .command('get')
  .description('Get script source by script id')
  .argument('<script-id>', 'CDP script id')
  .option('--out <path>', 'write source to file')
  .action(async function (scriptId: string) {
    await run(this, async opts => {
      const result = await getScript(opts.profile, scriptId);
      const local = this.opts<{ out?: string }>();
      if (local.out) {
        const fs = await import('node:fs');
        fs.writeFileSync(local.out, result.source);
        return { info: result.info, out: local.out, bytes: Buffer.byteLength(result.source) };
      }
      return result;
    });
  });

scripts
  .command('search')
  .description('Search loaded script sources')
  .argument('<query>', 'text to search')
  .option('--limit <n>', 'maximum matches', '20')
  .action(async function (query: string) {
    await run(this, opts => {
      const local = this.opts<{ limit: string }>();
      const limit = Number.parseInt(local.limit, 10);
      return searchScripts(opts.profile, query, Number.isFinite(limit) ? limit : 20);
    });
  });

const consoleCommand = program.command('console').description('Console observation commands');

consoleCommand
  .command('list')
  .description('List console entries from the selected page')
  .option('--limit <n>', 'maximum entries', '100')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{ limit: string }>();
      const limit = Number.parseInt(local.limit, 10);
      return listConsole(opts.profile, Number.isFinite(limit) ? limit : 100);
    });
  });

const network = program.command('network').description('Network observation commands');

network
  .command('list')
  .description('List network entries from the selected page')
  .option('--limit <n>', 'maximum entries', '100')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{ limit: string }>();
      const limit = Number.parseInt(local.limit, 10);
      return listNetwork(opts.profile, Number.isFinite(limit) ? limit : 100);
    });
  });

network
  .command('get')
  .description('Get a network entry by id')
  .argument('<id>', 'network entry id')
  .action(async function (id: string) {
    await run(this, opts => {
      const numericId = Number.parseInt(id, 10);
      if (!Number.isFinite(numericId)) throw new Error('network id must be a number');
      return getNetwork(opts.profile, numericId);
    });
  });

network
  .command('body')
  .description('Get captured request or response body by network id')
  .argument('<id>', 'network entry id')
  .option('--part <part>', 'request or response', 'response')
  .option('--out <path>', 'write body to file')
  .action(async function (id: string) {
    await run(this, async opts => {
      const numericId = Number.parseInt(id, 10);
      if (!Number.isFinite(numericId)) throw new Error('network id must be a number');
      const local = this.opts<{ part: string; out?: string }>();
      const part = local.part === 'request' ? 'request' : 'response';
      const body = await getNetworkBody(opts.profile, numericId, part);
      if (local.out) {
        const fs = await import('node:fs');
        const buffer = body.encoding === 'base64' ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'utf-8');
        fs.writeFileSync(local.out, buffer, { mode: 0o600 });
        return { ...body, body: `[written:${local.out}]`, out: local.out };
      }
      return body;
    });
  });

network
  .command('dump')
  .description('Dump captured network entries and bodies from the selected page')
  .requiredOption('--out <dir>', 'output directory for manifest.json and body files')
  .option('--limit <n>', 'network entries to scan', '500')
  .option('--url <regex>', 'only include entries whose URL matches the regex')
  .option('--method <regex>', 'only include entries whose method matches the regex')
  .option('--type <regex>', 'only include entries whose resourceType or content-type matches the regex')
  .option('--status <code>', 'only include entries with this HTTP status')
  .option('--max-body-bytes <n>', 'skip writing individual bodies larger than this many bytes', '2000000')
  .option('--no-bodies', 'write manifest only; do not write request/response body files')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{
        out: string;
        limit: string;
        url?: string;
        method?: string;
        type?: string;
        status?: string;
        maxBodyBytes: string;
        bodies?: boolean;
      }>();
      const limit = Number.parseInt(local.limit, 10);
      const maxBodyBytes = Number.parseInt(local.maxBodyBytes, 10);
      return dumpNetworkBodies(opts.profile, {
        out: local.out,
        limit: Number.isFinite(limit) ? limit : 500,
        url: local.url,
        method: local.method,
        type: local.type,
        status: local.status,
        bodies: local.bodies !== false,
        maxBodyBytes: Number.isFinite(maxBodyBytes) ? maxBodyBytes : 2_000_000,
      });
    });
  });

const breakpoint = program.command('break').description('Debugger breakpoint commands');

const request = program.command('request').description('Captured request replay/export commands');

request
  .command('curl')
  .description('Export a captured request as a curl command')
  .argument('<id>', 'network entry id')
  .option('--include-sensitive', 'include sensitive headers such as Cookie and Authorization')
  .action(async function (id: string) {
    await run(this, opts => {
      const numericId = Number.parseInt(id, 10);
      if (!Number.isFinite(numericId)) throw new Error('network id must be a number');
      const local = this.opts<{ includeSensitive?: boolean }>();
      return requestCurl(opts.profile, numericId, Boolean(local.includeSensitive));
    });
  });

request
  .command('replay')
  .description('Replay a captured request in the selected page context')
  .argument('<id>', 'network entry id')
  .action(async function (id: string) {
    await run(this, opts => {
      const numericId = Number.parseInt(id, 10);
      if (!Number.isFinite(numericId)) throw new Error('network id must be a number');
      return requestReplay(opts.profile, numericId);
    });
  });

const hook = program.command('hook').description('Install JS runtime hooks for browser evidence capture');

hook
  .command('fetch')
  .description('Hook window.fetch and log calls to console as SITEFLOW_HOOK records')
  .action(async function () {
    await run(this, opts => installHook(opts.profile, 'fetch'));
  });

hook
  .command('xhr')
  .description('Hook XMLHttpRequest and log calls to console as SITEFLOW_HOOK records')
  .action(async function () {
    await run(this, opts => installHook(opts.profile, 'xhr'));
  });

hook
  .command('crypto')
  .description('Hook WebCrypto operations and log calls to console as SITEFLOW_HOOK records')
  .action(async function () {
    await run(this, opts => installHook(opts.profile, 'crypto'));
  });

hook
  .command('list')
  .description('List installed hooks for the selected page')
  .action(async function () {
    await run(this, opts => listHooks(opts.profile));
  });

breakpoint
  .command('text')
  .description('Set breakpoints on loaded scripts matching text')
  .argument('<query>', 'text to match')
  .option('--script-url <text>', 'only match scripts whose URL contains this text')
  .action(async function (query: string) {
    await run(this, opts => {
      const local = this.opts<{ scriptUrl?: string }>();
      return breakText(opts.profile, query, local.scriptUrl);
    });
  });

breakpoint
  .command('xhr')
  .description('Pause when XHR/fetch URL contains a substring')
  .argument('<url-substring>', 'URL substring')
  .action(async function (urlSubstring: string) {
    await run(this, opts => breakXhr(opts.profile, urlSubstring));
  });

breakpoint
  .command('list')
  .description('List breakpoints')
  .action(async function () {
    await run(this, opts => listBreakpoints(opts.profile));
  });

breakpoint
  .command('remove')
  .description('Remove a breakpoint')
  .argument('<id>', 'breakpoint id')
  .action(async function (id: string) {
    await run(this, opts => removeBreakpoint(opts.profile, id));
  });

program
  .command('paused')
  .description('Show current debugger paused state')
  .action(async function () {
    await run(this, opts => pausedInfo(opts.profile));
  });

program
  .command('resume')
  .description('Resume debugger execution')
  .action(async function () {
    await run(this, opts => resume(opts.profile));
  });

program
  .command('step')
  .description('Step debugger execution')
  .argument('<kind>', 'into, over, or out')
  .action(async function (kind: string) {
    await run(this, opts => {
      if (kind !== 'into' && kind !== 'over' && kind !== 'out') {
        throw new Error('step kind must be into, over, or out');
      }
      return step(opts.profile, kind);
    });
  });

program
  .command('eval')
  .description('Evaluate JavaScript in paused call frame or page context')
  .argument('<expression>', 'JavaScript expression')
  .action(async function (expression: string) {
    await run(this, opts => evaluate(opts.profile, expression));
  });

const runtime = program.command('runtime').description('Runtime inspection commands');

runtime
  .command('storage')
  .description('Read localStorage and sessionStorage from the selected page')
  .action(async function () {
    await run(this, opts => runtimeStorage(opts.profile));
  });

const auth = program.command('auth').description('Authentication/session inspection commands');

auth
  .command('status')
  .description('Show browser authentication/session mode')
  .action(async function () {
    await run(this, opts => authStatus(opts.profile));
  });

auth
  .command('cookies')
  .description('List redacted cookies in the current browser context')
  .option('--domain <domain>', 'filter by cookie domain')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{ domain?: string }>();
      return listCookies(opts.profile, local.domain);
    });
  });

auth
  .command('export-cookies')
  .description('Export full cookie values from the active browser context to a 0600 JSON file')
  .requiredOption('--out <path>', 'output JSON file; contains real cookie values')
  .option('--domain <domain>', 'filter by cookie domain')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{ out: string; domain?: string }>();
      const cookies = await exportCookies(opts.profile, local.domain);
      const fs = await import('node:fs');
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: 'siteflow active browser context',
        cookies,
      };
      fs.writeFileSync(local.out, JSON.stringify(payload, null, 2), { mode: 0o600 });
      return {
        out: local.out,
        count: cookies.length,
        domains: [...new Set(cookies.map(cookie => cookie.domain))].sort(),
        warning: 'The output file contains real cookie values. Keep it private and delete it when finished.',
      };
    });
  });

auth
  .command('import-cookies')
  .description('Preview or import cookies from a siteflow/Playwright-style JSON file')
  .requiredOption('--file <path>', 'cookie JSON file')
  .option('--domain <domain>', 'only import cookies matching this domain')
  .option('--apply', 'actually import; without this flag the command is preview-only')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{ file: string; domain?: string; apply?: boolean }>();
      const fs = await import('node:fs');
      const raw = JSON.parse(fs.readFileSync(local.file, 'utf-8')) as CookieRecord[] | { cookies?: CookieRecord[] };
      const cookies = Array.isArray(raw) ? raw : raw.cookies;
      if (!Array.isArray(cookies)) throw new Error('cookie file must be an array or an object with cookies[]');
      return importCookies(opts.profile, cookies, local.file, local.domain, Boolean(local.apply));
    });
  });
auth
  .command('sources')
  .description('List importable Chromium browser profiles')
  .option('--profile-source-root <path>', 'internal test override for Chromium source root')
  .action(async function () {
    await run(this, async () => {
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


const state = program.command('state').description('Save and load page state');

state
  .command('save')
  .description('Save open page URLs; cookies are redacted and only included with --include-cookies')
  .argument('<name>', 'state name')
  .option('--include-cookies', 'include redacted cookie metadata')
  .action(async function (name: string) {
    await run(this, opts => {
      const local = this.opts<{ includeCookies?: boolean }>();
      return saveState(opts.profile, name, Boolean(local.includeCookies));
    });
  });

state
  .command('load')
  .description('Load page URLs from a saved state')
  .argument('<name>', 'state name')
  .action(async function (name: string) {
    await run(this, opts => loadState(opts.profile, name));
  });

const profile = program.command('profile').description('Profile commands');

profile
  .command('path')
  .description('Show selected profile paths')
  .action(async function () {
    await run(this, async opts => ({
      profile: opts.profile,
      profileDir: profileDir(opts.profile),
      browserProfileDir: browserProfileDir(opts.profile),
    }));
  });

const trace = program.command('trace').description('Trace and receipt commands');

trace
  .command('list')
  .description('List failure receipts for the selected profile')
  .action(async function () {
    await run(this, async opts => listTraceReceipts(opts.profile));
  });

trace
  .command('show')
  .description('Show a failure receipt')
  .argument('<trace-id>', 'trace id')
  .action(async function (traceId: string) {
    await run(this, async opts => getTraceReceipt(opts.profile, traceId));
  });

trace
  .command('events')
  .description('List durable session events')
  .option('--limit <n>', 'maximum events', '100')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{ limit: string }>();
      const limit = Number.parseInt(local.limit, 10);
      return listTraceEvents(opts.profile, Number.isFinite(limit) ? limit : 100);
    });
  });

trace
  .command('export')
  .description('Export durable session events to a replayable JSON directory')
  .requiredOption('--out <path>', 'output replay JSON directory')
  .action(async function () {
    await run(this, async opts => {
      const local = this.opts<{ out: string }>();
      return exportTraceEvents(opts.profile, local.out);
    });
  });

trace
  .command('replay')
  .description('Dry-run or execute replayable events from a trace export')
  .argument('<file>', 'trace export JSON file')
  .option('--execute', 'execute replay steps; default is dry-run')
  .action(async function (file: string) {
    await run(this, async opts => {
      const local = this.opts<{ execute?: boolean }>();
      const fs = await import('node:fs');
      const payload = JSON.parse(fs.readFileSync(file, 'utf-8')) as { events?: TraceEvent[] };
      const events = Array.isArray(payload.events) ? payload.events : [];
      const steps = events.filter(event => event.replay).map(event => event.replay!);
      if (!local.execute) {
        return { file, execute: false, steps, note: 'Dry run only. Re-run with --execute to replay these browser/debugger actions.' };
      }
      const results: unknown[] = [];
      for (const stepItem of steps) {
        if (stepItem.command === 'browser.open') {
          results.push(await openPage(opts.profile, String(stepItem.args.url)));
        } else if (stepItem.command === 'browser.reload') {
          results.push(await reloadPage(opts.profile));
        } else if (stepItem.command === 'break.text') {
          results.push(await breakText(opts.profile, String(stepItem.args.query), stepItem.args.scriptUrl ? String(stepItem.args.scriptUrl) : undefined));
        } else if (stepItem.command === 'break.xhr') {
          results.push(await breakXhr(opts.profile, String(stepItem.args.url)));
        } else if (stepItem.command === 'runtime.eval') {
          results.push(await evaluate(opts.profile, String(stepItem.args.expression)));
        } else if (stepItem.command === 'debugger.resume') {
          results.push(await resume(opts.profile));
        } else if (stepItem.command === 'debugger.step') {
          const kind = stepItem.args.kind;
          if (kind === 'into' || kind === 'over' || kind === 'out') {
            results.push(await step(opts.profile, kind));
          }
        }
      }
      return { file, execute: true, replayed: results.length, results };
    });
  });

registerSiteCommands(program);

program.parseAsync(process.argv).catch(error => {
  const err = toSiteflowError(error);
  printError(err, { json: process.argv.includes('--json'), profile: 'default' });
  process.exit(1);
});
