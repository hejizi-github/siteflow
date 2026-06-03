import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  browserClick,
  browserScreenshot,
  browserType,
  currentLeasedPageId,
  evaluate,
  listConsole,
  listPages,
  openPage,
  setCurrentLeasedPageId,
} from '../daemon/client.js';
import type { BrowserClickOptions, BrowserTypeOptions, PageInfo } from '../shared/types.js';

export async function ensurePage(profile: string, url: string, expectedUrlPart?: string): Promise<PageInfo> {
  const pages = await listPages(profile).catch(() => []);
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
  return openPage(profile, url);
}

export async function click(profile: string, options: BrowserClickOptions): Promise<unknown> {
  return browserClick(profile, { timeoutMs: 15_000, ...options });
}

export async function typeInto(profile: string, options: BrowserTypeOptions): Promise<unknown> {
  return browserType(profile, { timeoutMs: 20_000, ...options });
}

export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function pageText(profile: string, max = 6000): Promise<string> {
  const result = await evaluate(profile, `document.body.innerText.slice(0, ${JSON.stringify(max)})`);
  return typeof result.value === 'string' ? result.value : '';
}

export async function pageSnapshot(profile: string): Promise<{ url: string; title: string; text: string }> {
  const result = await evaluate(profile, `({ url: location.href, title: document.title, text: document.body.innerText.slice(0, 8000) })`);
  const value = result.value as { url?: unknown; title?: unknown; text?: unknown };
  return {
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
    text: typeof value.text === 'string' ? value.text : '',
  };
}

export async function captureScreenshot(profile: string, out?: string): Promise<string | undefined> {
  if (!out) return undefined;
  const result = await browserScreenshot(profile, false);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));
  return out;
}

export async function detectCaptcha(profile: string): Promise<{ present: boolean; frames: unknown[] }> {
  const result = await evaluate(profile, `Array.from(document.querySelectorAll('iframe')).map((f, i) => {
    const r = f.getBoundingClientRect();
    return { i, title: f.title, src: f.src, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).filter(f => String(f.title || '').toLowerCase().includes('captcha') || String(f.src || '').toLowerCase().includes('captcha') || String(f.src || '').toLowerCase().includes('turnstile'))`);
  const frames = Array.isArray(result.value) ? result.value : [];
  return { present: frames.length > 0, frames };
}

export async function recentErrors(profile: string, limit = 20): Promise<Array<{ id: number; type: string; text: string; ts: string }>> {
  const entries = await listConsole(profile, limit);
  return entries
    .filter(entry => entry.type === 'error' || entry.type === 'warning')
    .map(entry => ({ id: entry.id, type: entry.type, text: entry.text, ts: entry.ts }));
}

export async function waitForText(profile: string, needle: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await pageText(profile, 10_000)).includes(needle)) return true;
    await sleep(2000);
  }
  return false;
}
