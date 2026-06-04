import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import {
  browserClick as daemonBrowserClick,
  browserScreenshot as daemonBrowserScreenshot,
  browserType as daemonBrowserType,
  browserUpload as daemonBrowserUpload,
  currentLeasedPageId,
  evaluate as daemonEvaluate,
  getNetworkBody as daemonGetNetworkBody,
  listNetwork as daemonListNetwork,
  listPages as daemonListPages,
  navigatePage as daemonNavigatePage,
  listConsole as daemonListConsole,
  openPage as daemonOpenPage,
  reloadPage as daemonReloadPage,
  requestReplayWithBody as daemonRequestReplayWithBody,
  requestReplayWithUrl as daemonRequestReplayWithUrl,
  setCurrentLeasedPageId,
} from '../daemon/client.js';
import type {
  BrowserClickOptions,
  BrowserTypeOptions,
  NetworkBody,
  NetworkEntry,
  PageInfo,
  RequestReplayResult,
} from '../shared/types.js';
export {
  clampInt,
  cleanText,
  downloadFile,
  fetchJson,
  fetchText,
  parseJsonp,
  siteReceipt,
} from './http-utils.js';
export type { NetworkBody, NetworkEntry, PageInfo, RequestReplayResult } from '../shared/types.js';
export type { SiteAdapter, SiteCommandContext, SiteCommandSpec, SiteReceipt } from './types.js';
export { runSiteCommand } from './runner.js';

export async function ensureSitePage(profile: string, url: string, expectedUrlPart?: string): Promise<PageInfo> {
  const pages = await listSitePages(profile).catch(() => []);
  const leasedPageId = currentLeasedPageId();
  if (leasedPageId) {
    const leased = pages.find(page => page.id === leasedPageId);
    if (leased && (!expectedUrlPart || leased.url.includes(expectedUrlPart))) return leased;
  }
  const selected = pages.find(page => page.selected);
  if (!leasedPageId && selected && (!expectedUrlPart || selected.url.includes(expectedUrlPart))) {
    setCurrentLeasedPageId(selected.id);
    return selected;
  }
  return openSitePage(profile, url);
}

export async function openSitePage(profile: string, url: string): Promise<PageInfo> {
  return daemonOpenPage(profile, url);
}


export function addSitePageIdOption(command: Command): Command {
  return command.option('--page-id <id>', 'existing browser tab id from `siteflow browser pages`; keeps automation bound to that tab');
}

export async function navigateSitePage(profile: string, url: string, pageId?: number): Promise<PageInfo> {
  return daemonNavigatePage(profile, url, pageId);
}

function parseSitePageId(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export async function openOrNavigateSitePage(profile: string, url: string, pageIdValue?: string): Promise<{ url: string; title: string; pageId?: number }> {
  const pageId = parseSitePageId(pageIdValue);
  const page = pageId ? await navigateSitePage(profile, url, pageId) : await openSitePage(profile, url);
  return { url: page.url, title: page.title, pageId: page.id };
}

export async function listSitePages(profile: string): Promise<PageInfo[]> {
  return daemonListPages(profile);
}

export async function clickSiteTarget(profile: string, options: BrowserClickOptions): Promise<unknown> {
  return daemonBrowserClick(profile, { timeoutMs: 15_000, ...options });
}

export async function typeIntoSiteTarget(profile: string, options: BrowserTypeOptions): Promise<unknown> {
  return daemonBrowserType(profile, { timeoutMs: 20_000, ...options });
}

export async function uploadSiteFiles(profile: string, selector: string, files: string[], timeoutMs = 20_000): Promise<unknown> {
  return daemonBrowserUpload(profile, { selector, files, timeoutMs });
}

export async function uploadSiteTarget(profile: string, options: { selector: string; files: string[]; timeoutMs?: number; nth?: number }): Promise<unknown> {
  return daemonBrowserUpload(profile, options);
}

export async function readSiteText(profile: string, max = 6000): Promise<string> {
  const result = await evaluateSiteExpression(profile, `document.body.innerText.slice(0, ${JSON.stringify(max)})`);
  return typeof result.value === 'string' ? result.value : '';
}

export async function readSiteSnapshot(profile: string): Promise<{ url: string; title: string; text: string }> {
  const result = await evaluateSiteExpression(profile, `({ url: location.href, title: document.title, text: document.body.innerText.slice(0, 8000) })`);
  const value = result.value as { url?: unknown; title?: unknown; text?: unknown };
  return {
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
    text: typeof value.text === 'string' ? value.text : '',
  };
}

export async function captureSiteScreenshot(profile: string, out?: string): Promise<string | undefined> {
  if (!out) return undefined;
  const result = await daemonBrowserScreenshot(profile, false);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));
  return out;
}

export async function readRecentSiteErrors(profile: string, limit = 20): Promise<Array<{ id: number; type: string; text: string; ts: string }>> {
  const entries = await daemonListConsole(profile, limit);
  return entries
    .filter(entry => entry.type === 'error' || entry.type === 'warning')
    .map(entry => ({ id: entry.id, type: entry.type, text: entry.text, ts: entry.ts }));
}

export async function detectSiteCaptcha(profile: string): Promise<{ present: boolean; frames: unknown[] }> {
  const result = await evaluateSiteExpression(profile, `Array.from(document.querySelectorAll('iframe')).map((f, i) => {
    const r = f.getBoundingClientRect();
    return { i, title: f.title, src: f.src, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).filter(f => String(f.title || '').toLowerCase().includes('captcha') || String(f.src || '').toLowerCase().includes('captcha') || String(f.src || '').toLowerCase().includes('turnstile'))`);
  const frames = Array.isArray(result.value) ? result.value : [];
  return { present: frames.length > 0, frames };
}

export async function evaluateInSitePage<T = unknown>(profile: string, expression: string, pageId?: number): Promise<T> {
  const result = await daemonEvaluate(profile, expression, pageId);
  return result.value as T;
}

export async function evaluateSiteExpression(profile: string, expression: string, pageId?: number): Promise<{ value: unknown }> {
  return daemonEvaluate(profile, expression, pageId);
}

export async function listSiteNetwork(profile: string, limit: number): Promise<NetworkEntry[]> {
  return daemonListNetwork(profile, limit);
}

export async function readSiteNetworkBody(profile: string, id: number): Promise<NetworkBody> {
  return daemonGetNetworkBody(profile, id, 'response');
}

export async function readSiteNetworkPart(profile: string, id: number, part: 'request' | 'response'): Promise<NetworkBody> {
  return daemonGetNetworkBody(profile, id, part);
}

export async function replaySiteRequestWithBody(
  profile: string,
  id: number,
  body: string,
): Promise<RequestReplayResult> {
  return daemonRequestReplayWithBody(profile, id, body);
}

export async function replaySiteRequestWithUrl(
  profile: string,
  id: number,
  url: string,
): Promise<RequestReplayResult> {
  return daemonRequestReplayWithUrl(profile, id, url);
}

export async function reloadSitePage(profile: string): Promise<PageInfo> {
  return daemonReloadPage(profile);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForText(profile: string, needle: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await readSiteText(profile, 10_000)).includes(needle)) return true;
    await sleep(2000);
  }
  return false;
}
