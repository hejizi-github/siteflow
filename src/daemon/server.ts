import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { BrowserRuntime } from '../runtime/browser-runtime.js';
import { SiteflowError, toSiteflowError } from '../shared/errors.js';
import { profileDir } from '../shared/paths.js';
import type { DaemonInfo, SavedState } from '../shared/types.js';
import { clearDaemonInfo, writeDaemonInfo } from './state.js';
import { appendTraceEvent } from '../traces/artifact-store.js';
import type { CookieRecord } from '../shared/types.js';

interface ServerOptions {
  profile: string;
}

interface JsonResponse {
  status: number;
  body: unknown;
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf-8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new SiteflowError('REQUEST_TOO_LARGE', 'Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new SiteflowError('BAD_JSON', 'Request body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, response: JsonResponse): void {
  res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(response.body));
}

function parsePageId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new SiteflowError('BAD_PAGE_ID', 'pageId must be a positive number');
  return parsed;
}

async function route(
  req: http.IncomingMessage,
  runtime: BrowserRuntime,
  info: () => DaemonInfo,
  shutdown: () => void,
): Promise<JsonResponse> {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (method === 'GET' && url.pathname === '/health') {
    return { status: 200, body: { ok: true, data: info() } };
  }

  if (method === 'GET' && url.pathname === '/pages') {
    const pages = await runtime.listPages();
    return { status: 200, body: { ok: true, data: pages } };
  }

  if (method === 'POST' && url.pathname === '/browser/attach') {
    const body = await readJson(req) as { browserUrl?: string };
    if (!body.browserUrl || typeof body.browserUrl !== 'string') {
      throw new SiteflowError('MISSING_BROWSER_URL', 'browser attach requires browserUrl');
    }
    const attached = await runtime.attach(body.browserUrl);
    return { status: 200, body: { ok: true, data: attached } };
  }

  if (method === 'POST' && url.pathname === '/browser/detach') {
    const detached = await runtime.detach();
    return { status: 200, body: { ok: true, data: detached } };
  }

  if (method === 'GET' && url.pathname === '/scripts') {
    const scripts = await runtime.listScripts(parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: scripts } };
  }

  if (method === 'GET' && url.pathname.startsWith('/scripts/')) {
    const scriptId = decodeURIComponent(url.pathname.slice('/scripts/'.length));
    const script = await runtime.getScript(scriptId, parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: script } };
  }

  if (method === 'GET' && url.pathname === '/scripts-search') {
    const query = url.searchParams.get('q');
    const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);
    if (!query) throw new SiteflowError('MISSING_QUERY', 'scripts search requires a query');
    const matches = await runtime.searchScripts(query, Number.isFinite(limit) ? limit : 20, parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: matches } };
  }

  if (method === 'GET' && url.pathname === '/console') {
    const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
    const entries = await runtime.listConsole(Number.isFinite(limit) ? limit : 100, parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: entries } };
  }

  if (method === 'GET' && url.pathname === '/network') {
    const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
    const entries = await runtime.listNetwork(Number.isFinite(limit) ? limit : 100, parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: entries } };
  }

  if (method === 'GET' && url.pathname.startsWith('/network/')) {
    const suffix = url.pathname.slice('/network/'.length);
    const bodyMatch = suffix.match(/^(\d+)\/body$/);
    if (bodyMatch) {
      const id = Number.parseInt(bodyMatch[1], 10);
      const part = url.searchParams.get('part') === 'request' ? 'request' : 'response';
      const body = await runtime.getNetworkBody(id, part, parsePageId(url.searchParams.get('pageId')));
      return { status: 200, body: { ok: true, data: body } };
    }
    const id = Number.parseInt(suffix, 10);
    if (!Number.isFinite(id)) throw new SiteflowError('BAD_NETWORK_ID', 'network id must be a number');
    const entry = await runtime.getNetwork(id, parsePageId(url.searchParams.get('pageId')));
    return { status: 200, body: { ok: true, data: entry } };
  }

  if ((method === 'GET' || method === 'POST') && url.pathname.startsWith('/request/')) {
    const suffix = url.pathname.slice('/request/'.length);
    const curlMatch = suffix.match(/^(\d+)\/curl$/);
    if (curlMatch) {
      const id = Number.parseInt(curlMatch[1], 10);
      const curl = await runtime.requestCurl(id, url.searchParams.get('includeSensitive') === 'true', parsePageId(url.searchParams.get('pageId')));
      return { status: 200, body: { ok: true, data: curl } };
    }
    const replayMatch = suffix.match(/^(\d+)\/replay$/);
    if (replayMatch) {
      const id = Number.parseInt(replayMatch[1], 10);
      const body = method === 'POST' ? await readJson(req) as { body?: string; url?: string } : undefined;
      const replay = await runtime.replayRequest(id, body?.body, body?.url, parsePageId((body as { pageId?: unknown } | undefined)?.pageId ?? url.searchParams.get('pageId')));
      appendTraceEvent(info().profile, 'request.replay', { id, url: replay.url, status: replay.status });
      return { status: 200, body: { ok: true, data: replay } };
    }
  }

  if (method === 'POST' && url.pathname === '/browser/open') {
    const body = await readJson(req) as { url?: string };
    if (!body.url || typeof body.url !== 'string') {
      throw new SiteflowError('MISSING_URL', 'browser open requires a url');
    }
    const page = await runtime.open(body.url);
    appendTraceEvent(info().profile, 'browser.open', { url: body.url, page }, { command: 'browser.open', args: { url: body.url } });
    return { status: 200, body: { ok: true, data: page } };
  }

  if (method === 'POST' && url.pathname === '/browser/navigate') {
    const body = await readJson(req) as { url?: string; pageId?: unknown };
    if (!body.url || typeof body.url !== 'string') {
      throw new SiteflowError('MISSING_URL', 'browser navigate requires a url');
    }
    const page = await runtime.navigate(body.url, parsePageId(body.pageId));
    appendTraceEvent(info().profile, 'browser.navigate', { url: body.url, page }, { command: 'browser.navigate', args: { url: body.url, pageId: body.pageId } });
    return { status: 200, body: { ok: true, data: page } };
  }

  if (method === 'POST' && url.pathname === '/browser/reload') {
    const body = await readJson(req) as { pageId?: unknown };
    const page = await runtime.reload(parsePageId(body.pageId));
    appendTraceEvent(info().profile, 'browser.reload', { page }, { command: 'browser.reload', args: {} });
    return { status: 200, body: { ok: true, data: page } };
  }

  if (method === 'POST' && url.pathname === '/browser/click') {
    const body = await readJson(req) as {
      selector?: string;
      text?: string;
      aria?: string;
      exact?: boolean;
      nth?: number;
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      force?: boolean;
      clickableParent?: boolean;
      expectUrlContains?: string;
      expectText?: string;
      expectSelector?: string;
      timeoutMs?: number;
      pageId?: unknown;
    };
    const clicked = await runtime.click({ ...body, pageId: parsePageId(body.pageId) });
    appendTraceEvent(info().profile, 'browser.click', { ...clicked }, { command: 'browser.click', args: body });
    return { status: 200, body: { ok: true, data: clicked } };
  }

  if (method === 'POST' && url.pathname === '/browser/inspect-target') {
    const body = await readJson(req) as {
      selector?: string;
      text?: string;
      aria?: string;
      exact?: boolean;
      nth?: number;
      includeHidden?: boolean;
      pageId?: unknown;
    };
    const inspected = await runtime.inspectTarget({ ...body, pageId: parsePageId(body.pageId) });
    appendTraceEvent(info().profile, 'browser.inspect-target', {
      target: inspected.target,
      candidates: inspected.candidates.length,
      page: inspected.page,
    }, { command: 'browser.inspect-target', args: body });
    return { status: 200, body: { ok: true, data: inspected } };
  }

  if (method === 'POST' && url.pathname === '/browser/type') {
    const body = await readJson(req) as {
      selector?: string;
      text?: string;
      aria?: string;
      exact?: boolean;
      nth?: number;
      value?: string;
      clear?: boolean;
      pressEnter?: boolean;
      timeoutMs?: number;
      pageId?: unknown;
    };
    if (typeof body.value !== 'string') throw new SiteflowError('MISSING_VALUE', 'browser type requires value');
    const typed = await runtime.type({ ...body, value: body.value, pageId: parsePageId(body.pageId) });
    appendTraceEvent(info().profile, 'browser.type', { ...typed, text: `[REDACTED:${body.value.length}]` }, {
      command: 'browser.type',
      args: { ...body, value: `[REDACTED:${body.value.length}]` },
    });
    return { status: 200, body: { ok: true, data: typed } };
  }

  if (method === 'POST' && url.pathname === '/browser/upload') {
    const body = await readJson(req) as {
      selector?: string;
      text?: string;
      aria?: string;
      exact?: boolean;
      nth?: number;
      files?: string[];
      timeoutMs?: number;
      pageId?: unknown;
    };
    if (!Array.isArray(body.files) || body.files.some(file => typeof file !== 'string')) {
      throw new SiteflowError('MISSING_FILES', 'browser upload requires files');
    }
    const uploaded = await runtime.upload({ ...body, files: body.files, pageId: parsePageId(body.pageId) });
    appendTraceEvent(info().profile, 'browser.upload', { ...uploaded }, { command: 'browser.upload', args: body });
    return { status: 200, body: { ok: true, data: uploaded } };
  }

  if (method === 'POST' && url.pathname === '/browser/select') {
    const body = await readJson(req) as {
      selector?: string;
      comboboxText?: string;
      option?: string;
      exact?: boolean;
      force?: boolean;
      verify?: boolean;
      timeoutMs?: number;
      pageId?: unknown;
    };
    if (typeof body.option !== 'string') throw new SiteflowError('MISSING_OPTION', 'browser select requires option');
    if (typeof body.selector !== 'string' && typeof body.comboboxText !== 'string') {
      throw new SiteflowError('MISSING_TARGET', 'browser select requires selector or comboboxText');
    }
    const selected = await runtime.select({ ...body, option: body.option, pageId: parsePageId(body.pageId) });
    appendTraceEvent(info().profile, 'browser.select', { ...selected }, { command: 'browser.select', args: body });
    return { status: 200, body: { ok: true, data: selected } };
  }

  if (method === 'GET' && url.pathname === '/browser/screenshot') {
    const fullPage = url.searchParams.get('fullPage') === 'true';
    const screenshot = await runtime.screenshot(fullPage, parsePageId(url.searchParams.get('pageId')));
    appendTraceEvent(info().profile, 'browser.screenshot', {
      page: screenshot.page,
      bytes: screenshot.bytes,
      mimeType: screenshot.mimeType,
    }, { command: 'browser.screenshot', args: { fullPage } });
    return { status: 200, body: { ok: true, data: screenshot } };
  }

  if (method === 'POST' && url.pathname === '/break/text') {
    const body = await readJson(req) as { query?: string; scriptUrl?: string };
    if (!body.query || typeof body.query !== 'string') {
      throw new SiteflowError('MISSING_QUERY', 'break text requires a query');
    }
    const breakpoints = await runtime.breakOnText(body.query, body.scriptUrl);
    appendTraceEvent(info().profile, 'break.text', { query: body.query, scriptUrl: body.scriptUrl, breakpoints }, {
      command: 'break.text',
      args: { query: body.query, scriptUrl: body.scriptUrl },
    });
    return { status: 200, body: { ok: true, data: breakpoints } };
  }

  if (method === 'POST' && url.pathname === '/break/xhr') {
    const body = await readJson(req) as { url?: string };
    if (!body.url || typeof body.url !== 'string') {
      throw new SiteflowError('MISSING_URL', 'break xhr requires a URL substring');
    }
    const breakpoint = await runtime.breakOnXhr(body.url);
    appendTraceEvent(info().profile, 'break.xhr', { url: body.url, breakpoint }, { command: 'break.xhr', args: { url: body.url } });
    return { status: 200, body: { ok: true, data: breakpoint } };
  }

  if (method === 'POST' && url.pathname === '/hook') {
    const body = await readJson(req) as { name?: 'fetch' | 'xhr' | 'crypto' };
    if (body.name !== 'fetch' && body.name !== 'xhr' && body.name !== 'crypto') {
      throw new SiteflowError('BAD_HOOK_NAME', 'hook name must be fetch, xhr, or crypto');
    }
    const hook = await runtime.installHook(body.name);
    appendTraceEvent(info().profile, 'hook.install', { ...hook });
    return { status: 200, body: { ok: true, data: hook } };
  }

  if (method === 'GET' && url.pathname === '/hooks') {
    const hooks = await runtime.listHooks();
    return { status: 200, body: { ok: true, data: hooks } };
  }

  if (method === 'GET' && url.pathname === '/breakpoints') {
    const breakpoints = await runtime.listBreakpoints();
    return { status: 200, body: { ok: true, data: breakpoints } };
  }

  if (method === 'POST' && url.pathname === '/break/remove') {
    const body = await readJson(req) as { id?: string };
    if (!body.id || typeof body.id !== 'string') {
      throw new SiteflowError('MISSING_BREAKPOINT_ID', 'break remove requires an id');
    }
    const removed = await runtime.removeBreakpoint(body.id);
    appendTraceEvent(info().profile, 'break.remove', { id: body.id, removed });
    return { status: 200, body: { ok: true, data: removed } };
  }

  if (method === 'GET' && url.pathname === '/paused') {
    const paused = await runtime.pausedInfo();
    return { status: 200, body: { ok: true, data: paused } };
  }

  if (method === 'POST' && url.pathname === '/resume') {
    const resumed = await runtime.resume();
    appendTraceEvent(info().profile, 'debugger.resume', resumed, { command: 'debugger.resume', args: {} });
    return { status: 200, body: { ok: true, data: resumed } };
  }

  if (method === 'POST' && url.pathname === '/step') {
    const body = await readJson(req) as { kind?: 'into' | 'over' | 'out' };
    if (body.kind !== 'into' && body.kind !== 'over' && body.kind !== 'out') {
      throw new SiteflowError('BAD_STEP_KIND', 'step kind must be into, over, or out');
    }
    const stepped = await runtime.step(body.kind);
    appendTraceEvent(info().profile, 'debugger.step', stepped, { command: 'debugger.step', args: { kind: body.kind } });
    return { status: 200, body: { ok: true, data: stepped } };
  }

  if (method === 'POST' && url.pathname === '/eval') {
    const body = await readJson(req) as { expression?: string; pageId?: unknown };
    if (!body.expression || typeof body.expression !== 'string') {
      throw new SiteflowError('MISSING_EXPRESSION', 'eval requires an expression');
    }
    const value = await runtime.evaluate(body.expression, parsePageId(body.pageId));
    appendTraceEvent(info().profile, 'runtime.eval', { expression: body.expression, value }, { command: 'runtime.eval', args: { expression: body.expression } });
    return { status: 200, body: { ok: true, data: { value } } };
  }

  if (method === 'GET' && url.pathname === '/auth/status') {
    const status = await runtime.authStatus();
    return { status: 200, body: { ok: true, data: status } };
  }

  if (method === 'GET' && url.pathname === '/auth/cookies') {
    const cookies = await runtime.cookies(url.searchParams.get('domain') || undefined);
    return { status: 200, body: { ok: true, data: cookies } };
  }

  if (method === 'GET' && url.pathname === '/auth/cookies/export') {
    const cookies = await runtime.exportCookies(url.searchParams.get('domain') || undefined);
    return { status: 200, body: { ok: true, data: cookies } };
  }

  if (method === 'POST' && url.pathname === '/auth/cookies/import') {
    const body = await readJson(req) as { cookies?: CookieRecord[]; domain?: string; apply?: boolean; source?: string };
    if (!Array.isArray(body.cookies)) throw new SiteflowError('BAD_COOKIE_FILE', 'auth import-cookies requires a cookies array');
    const result = await runtime.importCookies(body.cookies, body.domain, Boolean(body.apply));
    appendTraceEvent(info().profile, 'auth.cookies.import', {
      imported: result.imported,
      count: result.count,
      domains: result.domains,
      source: body.source || 'file',
    });
    return { status: 200, body: { ok: true, data: { ...result, source: body.source || result.source } } };
  }

  if (method === 'GET' && url.pathname === '/runtime/storage') {
    const storage = await runtime.storage();
    return { status: 200, body: { ok: true, data: storage } };
  }

  if (method === 'POST' && url.pathname === '/state/save') {
    const body = await readJson(req) as { name?: string; includeCookies?: boolean };
    if (!body.name || typeof body.name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(body.name)) {
      throw new SiteflowError('BAD_STATE_NAME', 'state name must contain only letters, numbers, dot, underscore, or dash');
    }
    const state = await runtime.captureState(Boolean(body.includeCookies));
    const statesDir = path.join(profileDir(info().profile), 'states');
    fs.mkdirSync(statesDir, { recursive: true, mode: 0o700 });
    const statePath = path.join(statesDir, `${body.name}.json`);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    appendTraceEvent(info().profile, 'state.save', { name: body.name, statePath, pages: state.pages.length });
    return { status: 200, body: { ok: true, data: { name: body.name, statePath, state } } };
  }

  if (method === 'POST' && url.pathname === '/state/load') {
    const body = await readJson(req) as { name?: string };
    if (!body.name || typeof body.name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(body.name)) {
      throw new SiteflowError('BAD_STATE_NAME', 'state name must contain only letters, numbers, dot, underscore, or dash');
    }
    const statePath = path.join(profileDir(info().profile), 'states', `${body.name}.json`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as SavedState;
    const restored = await runtime.restoreState(state);
    appendTraceEvent(info().profile, 'state.load', { name: body.name, statePath, ...restored });
    return { status: 200, body: { ok: true, data: { name: body.name, statePath, ...restored } } };
  }

  if (method === 'POST' && url.pathname === '/shutdown') {
    await runtime.close();
    shutdown();
    return { status: 200, body: { ok: true, data: { stopped: true } } };
  }

  return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: `${method} ${url.pathname}` } } };
}

export async function runDaemon(options: ServerOptions): Promise<void> {
  const runtime = new BrowserRuntime(options.profile);
  let daemonInfo: DaemonInfo;
  let server: http.Server;

  const shutdown = () => {
    clearDaemonInfo(options.profile);
    setTimeout(() => server.close(() => process.exit(0)), 10);
  };

  server = http.createServer((req, res) => {
    route(req, runtime, () => daemonInfo, shutdown)
      .then(response => send(res, response))
      .catch(error => {
        const err = toSiteflowError(error);
        send(res, {
          status: err.code === 'UNKNOWN' ? 500 : 400,
          body: {
            ok: false,
            error: {
              code: err.code,
              message: err.message,
              ...(err.hint ? { hint: err.hint } : {}),
            },
          },
        });
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  daemonInfo = {
    pid: process.pid,
    port: address.port,
    profile: options.profile,
    startedAt: new Date().toISOString(),
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
  writeDaemonInfo(daemonInfo);

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const profileIndex = process.argv.indexOf('--profile');
  const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : 'default';
  runDaemon({ profile }).catch(error => {
    const err = toSiteflowError(error);
    console.error(`${err.code}: ${err.message}`);
    process.exit(1);
  });
}
