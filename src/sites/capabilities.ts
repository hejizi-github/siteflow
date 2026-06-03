import type { Command } from 'commander';
import {
  browserUpload as daemonBrowserUpload,
  evaluate as daemonEvaluate,
  getNetworkBody as daemonGetNetworkBody,
  listNetwork as daemonListNetwork,
  listPages as daemonListPages,
  navigatePage as daemonNavigatePage,
  openPage as daemonOpenPage,
  reloadPage as daemonReloadPage,
  requestReplayWithBody as daemonRequestReplayWithBody,
  requestReplayWithUrl as daemonRequestReplayWithUrl,
} from '../daemon/client.js';
import type {
  BrowserClickOptions,
  BrowserTypeOptions,
  NetworkBody,
  NetworkEntry,
  PageInfo,
  RequestReplayResult,
} from '../shared/types.js';
import {
  captureScreenshot,
  click,
  detectCaptcha,
  ensurePage,
  pageSnapshot,
  recentErrors,
  sleep,
  typeInto,
  waitForText,
} from './helpers.js';

export async function ensureSitePage(profile: string, url: string, expectedUrlPart?: string): Promise<PageInfo> {
  return ensurePage(profile, url, expectedUrlPart);
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
  return click(profile, options);
}

export async function typeIntoSiteTarget(profile: string, options: BrowserTypeOptions): Promise<unknown> {
  return typeInto(profile, options);
}

export async function uploadSiteFiles(profile: string, selector: string, files: string[], timeoutMs = 20_000): Promise<unknown> {
  return daemonBrowserUpload(profile, { selector, files, timeoutMs });
}

export async function uploadSiteTarget(profile: string, options: { selector: string; files: string[]; timeoutMs?: number; nth?: number }): Promise<unknown> {
  return daemonBrowserUpload(profile, options);
}

export async function readSiteSnapshot(profile: string): Promise<{ url: string; title: string; text: string }> {
  return pageSnapshot(profile);
}

export async function captureSiteScreenshot(profile: string, out?: string): Promise<string | undefined> {
  return captureScreenshot(profile, out);
}

export async function readRecentSiteErrors(profile: string, limit = 20): Promise<Array<{ id: number; type: string; text: string; ts: string }>> {
  return recentErrors(profile, limit);
}

export async function detectSiteCaptcha(profile: string): Promise<{ present: boolean; frames: unknown[] }> {
  return detectCaptcha(profile);
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

export { sleep, waitForText };
