import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { navigateSitePage, openSitePage } from './capabilities.js';
import type { SiteCommandContext } from './types.js';

export function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePageId(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export async function openOrNavigate(ctx: SiteCommandContext, url: string, pageIdValue?: string): Promise<{ url: string; title: string; pageId?: number }> {
  const pageId = parsePageId(pageIdValue);
  const page = pageId ? await navigateSitePage(ctx.profile, url, pageId) : await openSitePage(ctx.profile, url);
  return { url: page.url, title: page.title, pageId: page.id };
}

export function addPageIdOption(command: import('commander').Command): import('commander').Command {
  return command.option('--page-id <id>', 'existing browser tab id from `siteflow browser pages`; keeps automation bound to that tab');
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<{ url: string; status: number; data: T; contentType: string }> {
  const response = await fetch(url, { headers: { accept: 'application/json, text/plain, */*', ...headers } });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { url: response.url, status: response.status, data: data as T, contentType: response.headers.get('content-type') || '' };
}

export async function fetchText(url: string, headers: Record<string, string> = {}): Promise<{ url: string; status: number; text: string; contentType: string }> {
  const response = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml,application/json,*/*', ...headers } });
  return { url: response.url, status: response.status, text: await response.text(), contentType: response.headers.get('content-type') || '' };
}

export function parseJsonp<T>(value: string): T {
  const trimmed = value.trim();
  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  const json = start >= 0 && end > start ? trimmed.slice(start + 1, end) : trimmed;
  return JSON.parse(json) as T;
}

export async function downloadFile(url: string, outDir: string, filename: string, options: {
  maxBytes?: number;
  expectedContentType?: RegExp;
  headers?: Record<string, string>;
} = {}): Promise<{ filePath: string; bytes: number; contentType: string; sha256: string }> {
  const response = await fetch(url, { headers: { accept: '*/*', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (options.expectedContentType && !options.expectedContentType.test(contentType)) {
    throw new Error(`${url} returned unexpected content-type ${contentType || 'unknown'}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  const maxBytes = options.maxBytes || 100 * 1024 * 1024;
  if (contentLength > maxBytes) throw new Error(`${url} is ${contentLength} bytes; max is ${maxBytes}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`${url} is ${bytes.byteLength} bytes; max is ${maxBytes}`);
  const resolvedOut = path.resolve(outDir);
  await fs.mkdir(resolvedOut, { recursive: true });
  const filePath = path.join(resolvedOut, filename.replace(/[^\w.-]+/g, '_'));
  await fs.writeFile(filePath, bytes);
  return {
    filePath,
    bytes: bytes.byteLength,
    contentType,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

export function siteReceipt(site: string, command: string, observations: Record<string, unknown>, ok = true, errors: Array<{ code: string; message: string }> = []) {
  return {
    site,
    command,
    ok,
    state: ok ? `${command}_collected` : `${command}_failed`,
    observations,
    errors,
    next: [],
  };
}
