import type { Command } from 'commander';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { evaluateSiteExpression, readSiteNetworkPart, listSiteNetwork, openSitePage } from './capabilities.js';
import type { NetworkEntry } from '../shared/types.js';
import { sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';

const SITE = 'rouman5';
const ORIGIN = 'https://rouman5.com';
const BODY_IMAGE_HOST = /^r5\.rmcdn\d+\.xyz$/i;
const AD_OR_TRACKING_HOSTS = new Set([
  'ra13.xyz',
  'img.ra13.xyz',
  'magsrv.com',
  's.magsrv.com',
  'a.magsrv.com',
  'holahupa.com',
  'frozenpayerpregnant.com',
  'www.google-analytics.com',
  'www.googletagmanager.com',
  'static.cloudflareinsights.com',
]);

interface LimitOptions {
  limit?: string;
}

interface SearchOptions extends LimitOptions {
  keyword: string;
}

interface UrlOrIdOptions {
  target: string;
}

interface ChapterOptions extends UrlOrIdOptions {
  metadataOnly?: boolean;
}

interface DownloadOptions extends UrlOrIdOptions {
  out?: string;
  apply?: boolean;
  iHaveRights?: boolean;
}

interface DownloadBookOptions extends DownloadOptions {
  from?: string;
  to?: string;
  limit?: string;
}

interface DownloadedImage {
  page: number;
  index: number;
  url: string;
  savedPath?: string;
  skipped?: boolean;
  bytes?: number;
  contentType?: string;
  source?: string;
  error?: string;
}

interface ChapterDownloadResult {
  chapter?: ChapterLink;
  data: ChapterData;
  outDir: string;
  bodyImageCount: number;
  downloaded: DownloadedImage[];
  readerPath?: string;
}

interface ComicCard {
  title: string;
  latest?: string;
  counts: string[];
  updatedAt?: string;
  url: string;
}

interface ChapterLink {
  index: number;
  title: string;
  url: string;
}

interface ComicDetail {
  url: string;
  title: string;
  name?: string;
  aliases?: string;
  author?: string;
  status?: string;
  region?: string;
  counters: string[];
  updatedAt?: string;
  description?: string;
  chapterCount: number;
  chapters: ChapterLink[];
}

interface ChapterImageSummary {
  index: number;
  url: string;
  host: string;
  pathShape: string;
  width: number;
  height: number;
  pageNumber?: number;
  kind: 'body_candidate' | 'ad_or_tracking' | 'site_asset' | 'unknown';
}

interface ChapterData {
  url: string;
  title: string;
  comicName?: string;
  chapterTitle?: string;
  pageIndicator?: string;
  catalogUrl?: string;
  previousUrl?: string;
  nextUrl?: string;
  imageCount: number;
  bodyCandidateCount: number;
  filteredImageCount: number;
  unknownImageCount: number;
  mediaHosts: string[];
  filteredHosts: string[];
  unknownHosts: string[];
  images: ChapterImageSummary[];
}

function clampLimit(value: string | undefined, fallback = 20, max = 50): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, max));
}

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value: string, base = ORIGIN): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function comicUrl(target: string): string {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${ORIGIN}/books/${encodeURIComponent(trimmed)}`;
}

function chapterUrl(target: string): string {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^/]+\/\d+$/.test(trimmed)) {
    const [bookId, chapterIndex] = trimmed.split('/');
    return `${ORIGIN}/books/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterIndex)}`;
  }
  return comicUrl(trimmed);
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function pathShape(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (BODY_IMAGE_HOST.test(url.host)) return `/${parts.slice(0, 4).join('/')}/...`;
    return `/${parts.slice(0, 5).join('/')}`;
  } catch {
    return '';
  }
}

function pageNumberFromRoumanUrl(value: string): number | undefined {
  try {
    const pathname = new URL(value).pathname;
    const encoded = pathname.split('/').filter(Boolean).at(-1)?.replace(/\.(?:webp|jpe?g|png|gif|avif)$/i, '');
    if (!encoded) return undefined;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const match = decoded.match(/\/(\d{3,})\.(?:webp|jpe?g|png|gif|avif)$/i);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function classifyImageHost(host: string): ChapterImageSummary['kind'] {
  if (BODY_IMAGE_HOST.test(host)) return 'body_candidate';
  if (AD_OR_TRACKING_HOSTS.has(host)) return 'ad_or_tracking';
  if (host === 'rouman5.com') return 'site_asset';
  return 'unknown';
}

function domains(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function optionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

function chapterDirName(chapter: ChapterLink, ordinal: number): string {
  const numeric = Number.isFinite(chapter.index) ? chapter.index + 1 : ordinal + 1;
  return `ch${String(numeric).padStart(3, '0')}`;
}

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function estimateBodyBytes(network: NetworkEntry[]): number {
  return network
    .filter(entry => {
      const host = hostOf(entry.url);
      return BODY_IMAGE_HOST.test(host) && entry.resourceType === 'image' && typeof entry.responseBody?.bytes === 'number';
    })
    .reduce((total, entry) => total + (entry.responseBody?.bytes || 0), 0);
}

function extensionFromImage(contentType: string | undefined, buffer: Buffer, url: string): string | undefined {
  const type = (contentType || '').toLowerCase();
  if (type.includes('image/jpeg') || type.includes('image/jpg')) return 'jpg';
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/webp')) return 'webp';
  if (type.includes('image/gif')) return 'gif';
  if (type.includes('image/avif')) return 'avif';
  if (type && !type.startsWith('image/')) return undefined;

  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.subarray(4, 12).toString('ascii') === 'ftypavif') return 'avif';

  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  } catch {}

  return undefined;
}

async function browserCapturedImage(profile: string, network: NetworkEntry[], url: string): Promise<{ buffer: Buffer; contentType?: string; source: 'browser-cache' } | undefined> {
  const entry = [...network].reverse().find(item => (
    item.url === url
    && item.resourceType === 'image'
    && (item.status || 0) >= 200
    && (item.status || 0) < 300
    && item.responseBody?.available
    && !item.responseBody.truncated
  ));
  if (!entry) return undefined;

  try {
    const body = await readSiteNetworkPart(profile, entry.id, 'response');
    const buffer = body.encoding === 'base64' ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'utf8');
    return { buffer, contentType: body.contentType || entry.contentType, source: 'browser-cache' };
  } catch {
    return undefined;
  }
}

async function fetchImage(url: string, referer: string): Promise<{ buffer: Buffer; contentType?: string; source: 'fetch' }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: referer,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || undefined;
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType, source: 'fetch' };
}

function roumanScrambleSliceCount(url: string): number {
  try {
    const filename = new URL(url).pathname.split('/').filter(Boolean).at(-1) || '';
    const encoded = filename.split('.').slice(0, -1).join('.');
    const decoded = Buffer.from(encoded, 'base64').toString('binary');
    const md5 = createHash('md5').update(decoded, 'binary').digest();
    return md5.at(-1)! % 10 + 5;
  } catch {
    return 10;
  }
}

function needsRoumanUnscramble(url: string): boolean {
  return /\/sr:1\//i.test(url);
}

function roumanMirrorUrls(url: string): string[] {
  const match = url.match(/^https:\/\/r5\.rmcdn(\d+)\.xyz\//i);
  if (!match) return [url];
  const current = Number(match[1]);
  const hosts = [current, 10, 11, 12, 13, 14].filter((host, index, values) => values.indexOf(host) === index);
  return hosts.map(host => url.replace(/^https:\/\/r5\.rmcdn\d+\.xyz\//i, `https://r5.rmcdn${host}.xyz/`));
}

async function renderRoumanImage(profile: string, url: string): Promise<{ buffer: Buffer; contentType: string; source: 'browser-canvas' }> {
  const sliceCount = roumanScrambleSliceCount(url);
  const result = await evaluateSiteExpression(profile, `(${async (imageUrls: string[], slices: number) => {
    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const timer = window.setTimeout(() => reject(new Error('image load timeout')), 8_000);
      image.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('image load failed'));
      };
      image.onload = () => {
        window.clearTimeout(timer);
        resolve(image);
      };
      image.src = src;
    });
    let image: HTMLImageElement | undefined;
    let imageUrl = imageUrls[0] || '';
    const errors: string[] = [];
    for (const candidate of imageUrls) {
      try {
        imageUrl = candidate;
        image = await loadImage(candidate);
        break;
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!image) throw new Error(`all image mirrors failed: ${errors.join('; ')}`);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('image has empty dimensions');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('canvas context unavailable');
    context.clearRect(0, 0, width, height);

    if (imageUrl.includes('sr:1')) {
      const remainder = height % slices;
      for (let index = 0; index < slices; index++) {
        let partHeight = Math.floor(height / slices);
        let targetY = partHeight * index;
        const sourceY = height - partHeight * (index + 1) - remainder;
        if (index === 0) {
          partHeight += remainder;
        } else {
          targetY += remainder;
        }
        context.drawImage(image, 0, sourceY, width, partHeight, 0, targetY, width, partHeight);
      }
    } else {
      context.drawImage(image, 0, 0, width, height);
    }

    return canvas.toDataURL('image/png');
  }})(${JSON.stringify(roumanMirrorUrls(url))}, ${JSON.stringify(sliceCount)})`);
  const value = String(result.value || '');
  const match = value.match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('browser canvas did not return PNG data');
  return { buffer: Buffer.from(match[1], 'base64'), contentType: 'image/png', source: 'browser-canvas' };
}

function writeReaderHtml(outDir: string, data: ChapterData, downloaded: DownloadedImage[]): string | undefined {
  const images = downloaded
    .filter(item => item.savedPath && !item.error)
    .sort((a, b) => a.page - b.page);
  if (!images.length) return undefined;

  const title = [data.comicName, data.chapterTitle].filter(Boolean).join(' - ') || data.title || 'rouman5 reader';
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #111; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .nav { position: sticky; top: 0; z-index: 1; background: rgba(17, 17, 17, 0.92); border-bottom: 1px solid #2a2a2a; padding: 10px 14px; }
    .nav h1 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.35; }
    .nav p { margin: 4px 0 0; color: #aaa; font-size: 12px; }
    .reader { width: min(100%, 920px); margin: 0 auto; padding: 8px 0 28px; }
    .reader img { display: block; width: 100%; height: auto; margin: 0 auto; background: #222; }
  </style>
</head>
<body>
  <div class="nav">
    <h1>${escapeHtml(title)}</h1>
    <p>${images.length} images</p>
  </div>
  <main class="reader">
${images.map(item => `    <img src="${escapeHtml(basename(item.savedPath || ''))}" alt="p${item.page}" loading="lazy">`).join('\n')}
  </main>
</body>
</html>
`;
  const readerPath = join(outDir, 'reader.html');
  writeFileSync(readerPath, html);
  return readerPath;
}

function writeBookIndexHtml(outDir: string, comic: ComicDetail, results: ChapterDownloadResult[]): string | undefined {
  const readable = results.filter(result => result.readerPath);
  if (!readable.length) return undefined;

  const title = comic.name || comic.title || 'rouman5 book';
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #111; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(100%, 920px); margin: 0 auto; padding: 18px 14px 32px; }
    h1 { margin: 0 0 14px; font-size: 20px; line-height: 1.35; }
    a { color: #eee; text-decoration: none; }
    .chapter { display: flex; justify-content: space-between; gap: 14px; padding: 10px 0; border-top: 1px solid #2a2a2a; }
    .meta { color: #aaa; white-space: nowrap; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
${readable.map((result, offset) => {
  const chapter = result.chapter;
  const href = `${basename(result.outDir)}/reader.html`;
  const label = chapter?.title || result.data.chapterTitle || `Chapter ${offset + 1}`;
  return `    <a class="chapter" href="${escapeHtml(href)}"><span>${escapeHtml(label)}</span><span class="meta">${result.downloaded.filter(item => item.savedPath && !item.error).length} pages</span></a>`;
}).join('\n')}
  </main>
</body>
</html>
`;
  const indexPath = join(outDir, 'index.html');
  writeFileSync(indexPath, html);
  return indexPath;
}

async function fetchText(url: string): Promise<{ ok: boolean; status?: number; text?: string; error?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { ok: response.ok, status: response.status, text: (await response.text()).slice(0, 2000) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function collectHome(ctx: SiteCommandContext, limit: number): Promise<{ url: string; title: string; ageGate: boolean; cards: ComicCard[]; textExcerpt: string }> {
  await openSitePage(ctx.profile, `${ORIGIN}/home`);
  await sleep(2000);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const cards = Array.from(document.querySelectorAll('a[href*="/books/"]'))
      .map(a => {
        const text = clean(a.innerText || a.textContent || '');
        const href = abs(a.getAttribute('href') || '');
        if (!text || !href.includes('/books/')) return null;
        const lines = (a.innerText || '').split('\\n').map(clean).filter(Boolean);
        const title = lines[0] || text;
        const latest = lines.find(line => line.startsWith('至:'));
        const updatedAt = lines.find(line => /^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(line));
        const counts = lines.filter(line => /^(?:\\d+(?:\\.\\d+)?[KM]?|\\d+)$/.test(line)).slice(0, 4);
        return { title, latest, counts, updatedAt, url: href };
      })
      .filter(Boolean);
    const seen = new Set();
    const uniqueCards = [];
    for (const card of cards) {
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      uniqueCards.push(card);
      if (uniqueCards.length >= ${JSON.stringify(limit)}) break;
    }
    return {
      url: location.href,
      title: document.title,
      ageGate: document.body.innerText.includes('您欲觀看的頁面包含成人內容'),
      cards: uniqueCards,
      textExcerpt: document.body.innerText.slice(0, 1200)
    };
  })()`);
  return result.value as { url: string; title: string; ageGate: boolean; cards: ComicCard[]; textExcerpt: string };
}

async function collectSearch(ctx: SiteCommandContext, keyword: string, limit: number): Promise<{ url: string; title: string; keyword: string; resultCount: number; cards: ComicCard[] }> {
  await openSitePage(ctx.profile, `${ORIGIN}/search?term=${encodeURIComponent(keyword)}&page=0`);
  await sleep(2500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const body = document.body.innerText || '';
    const countMatch = body.match(/(\\d+)\\s*個搜索結果/);
    const cards = Array.from(document.querySelectorAll('a[href*="/books/"]'))
      .map(a => {
        const href = abs(a.getAttribute('href') || '');
        const lines = (a.innerText || '').split('\\n').map(clean).filter(Boolean);
        const title = lines[0] || clean(a.innerText);
        if (!title || !href.includes('/books/')) return null;
        const latest = lines.find(line => line.startsWith('至:'));
        const updatedAt = lines.find(line => /^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(line));
        const counts = lines.filter(line => /^(?:\\d+(?:\\.\\d+)?[KM]?|\\d+)$/.test(line)).slice(0, 4);
        return { title, latest, counts, updatedAt, url: href };
      })
      .filter(Boolean)
      .slice(0, ${JSON.stringify(limit)});
    return {
      url: location.href,
      title: document.title,
      keyword: ${JSON.stringify(keyword)},
      resultCount: countMatch ? Number(countMatch[1]) : cards.length,
      cards
    };
  })()`);
  return result.value as { url: string; title: string; keyword: string; resultCount: number; cards: ComicCard[] };
}

async function collectComic(ctx: SiteCommandContext, target: string): Promise<ComicDetail> {
  await openSitePage(ctx.profile, comicUrl(target));
  await sleep(2000);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const text = document.body.innerText || '';
    const lines = text.split('\\n').map(clean).filter(Boolean);
    const getAfter = label => {
      const line = lines.find(item => item.startsWith(label));
      return line ? clean(line.slice(label.length)) : undefined;
    };
    const chapters = Array.from(document.querySelectorAll('a[href]'))
      .map(a => {
        const href = abs(a.getAttribute('href') || '');
        const title = clean(a.innerText || a.textContent || '');
        const match = href.match(/\\/books\\/([^/]+)\\/(\\d+)$/);
        if (!match || !/^第|^最終話|^後記/.test(title)) return null;
        return { index: Number(match[2]), title, url: href };
      })
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);
    const seen = new Set();
    const uniqueChapters = [];
    for (const chapter of chapters) {
      if (seen.has(chapter.url)) continue;
      seen.add(chapter.url);
      uniqueChapters.push(chapter);
    }
    const date = lines.find(line => /^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(line));
    const counters = lines.filter(line => /^(?:\\d+(?:\\.\\d+)?[KM]?|\\d+)$/.test(line)).slice(0, 4);
    return {
      url: location.href,
      title: document.title,
      name: clean(document.querySelector('h1')?.innerText) || lines.find(line => !['肉漫屋', '首頁'].includes(line)),
      aliases: getAfter('別名:'),
      author: getAfter('作者:'),
      status: getAfter('狀態:'),
      region: getAfter('地區:'),
      counters,
      updatedAt: date,
      description: getAfter('簡介:'),
      chapterCount: uniqueChapters.length,
      chapters: uniqueChapters
    };
  })()`);
  return result.value as ComicDetail;
}

async function collectChapter(ctx: SiteCommandContext, target: string): Promise<ChapterData> {
  await openSitePage(ctx.profile, chapterUrl(target));
  await sleep(2500);
  // 滚动触发懒加载
  await evaluateSiteExpression(ctx.profile, `(() => {
    const scrollStep = () => {
      window.scrollTo(0, document.body.scrollHeight);
    };
    return new Promise(resolve => {
      let lastHeight = 0;
      let attempts = 0;
      const interval = setInterval(() => {
        scrollStep();
        const currentHeight = document.body.scrollHeight;
        if (currentHeight === lastHeight || attempts >= 10) {
          clearInterval(interval);
          resolve('scrolled');
        }
        lastHeight = currentHeight;
        attempts++;
      }, 500);
    });
  })()`);
  await sleep(1500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const normalizeUrl = value => String(value || '').replace(/\\\\u0026/g, '&').replace(/\\\\+$/, '');
    const validRoumanUrl = value => /^https:\\/\\/r5\\.rmcdn\\d+\\.xyz\\/m\\/[A-Za-z0-9_-]+\\/wm:\\d+\\/sr:\\d+\\/[A-Za-z0-9_-]+\\.(?:webp|jpe?g|png|gif|avif)$/i.test(value);
    const hostOf = href => { try { return new URL(href).host } catch { return '' } };
    const pathShapeOf = href => {
      try {
        const u = new URL(href);
        const parts = u.pathname.split('/').filter(Boolean);
        return '/' + parts.slice(0, u.host.startsWith('r5.rmcdn') ? 4 : 5).join('/') + (u.host.startsWith('r5.rmcdn') ? '/...' : '');
      } catch {
        return '';
      }
    };
    const pageNumberOf = href => {
      try {
        const pathname = new URL(href).pathname;
        const encoded = pathname.split('/').filter(Boolean).at(-1)?.replace(/\\.(?:webp|jpe?g|png|gif|avif)$/i, '');
        if (!encoded) return undefined;
        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const decoded = new TextDecoder().decode(bytes);
        const match = decoded.match(/\\/(\\d{3,})\\.(?:webp|jpe?g|png|gif|avif)$/i);
        return match ? Number(match[1]) : undefined;
      } catch {
        return undefined;
      }
    };
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({ text: clean(a.innerText || a.textContent || ''), href: abs(a.getAttribute('href') || '') }));
    const domImages = Array.from(document.images).map((img, index) => {
      const src = img.currentSrc || img.getAttribute('src') || '';
      const href = normalizeUrl(abs(src));
      return {
        index,
        url: href,
        host: hostOf(href),
        pathShape: pathShapeOf(href),
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        pageNumber: pageNumberOf(href)
      };
    });
    const html = document.documentElement.innerHTML || '';
    const scriptText = Array.from(document.scripts).map(script => script.textContent || '').join('');
    const flightText = scriptText || html;
    const scanFlightImages = text => {
      const items = [];
      const needle = 'imageUrl\\\\":\\\\"https:';
      const valuePrefixLength = 'imageUrl\\\\":\\\\"'.length;
      let pos = 0;
      while ((pos = text.indexOf(needle, pos)) !== -1) {
        const start = pos + valuePrefixLength;
        const end = text.indexOf('\\\\",', start);
        const around = end > start ? text.slice(end, end + 80) : '';
        const indMatch = around.match(/^\\\\",\\\\"ind\\\\":(\\d+)/);
        if (end > start && indMatch) {
          items.push({ url: text.slice(start, end), ind: Number(indMatch[1]) });
        }
        pos = end > start ? end : pos + 1;
      }
      return items;
    };
    const flightImages = scanFlightImages(flightText)
      .map((item, offset) => {
        const href = normalizeUrl(item.url);
        const ind = item.ind;
        return {
          index: offset,
          url: href,
          host: hostOf(href),
          pathShape: pathShapeOf(href),
          width: 0,
          height: 0,
          pageNumber: Number.isFinite(ind) ? ind + 1 : pageNumberOf(href)
        };
      });
    const seen = new Set(flightImages.map(image => image.url));
    const fallbackUrls = Array.from(html.matchAll(/https:\\/\\/r5\\.rmcdn\\d+\\.xyz\\/m\\/[A-Za-z0-9_-]+\\/wm:\\d+\\/sr:\\d+\\/[A-Za-z0-9_-]+\\.(?:webp|jpe?g|png|gif|avif)/gi))
      .map(match => normalizeUrl(match[0]))
      .filter(url => url && !seen.has(url));
    const fallbackImages = fallbackUrls.map((href, offset) => {
      seen.add(href);
      return {
        index: flightImages.length + offset,
        url: href,
        host: hostOf(href),
        pathShape: pathShapeOf(href),
        width: 0,
        height: 0,
        pageNumber: pageNumberOf(href)
      };
    });
    const byPage = new Map();
    for (const image of [...flightImages, ...fallbackImages, ...domImages.filter(image => !seen.has(image.url))]) {
      if (!image.pageNumber || !validRoumanUrl(image.url)) continue;
      const current = byPage.get(image.pageNumber);
      if (!current || image.index < current.index) byPage.set(image.pageNumber, image);
    }
    const images = Array.from(byPage.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    const text = document.body.innerText || '';
    const lines = text.split('\\n').map(clean).filter(Boolean);
    return {
      url: location.href,
      title: document.title,
      comicName: lines.find(line => line && !['肉漫屋', '首頁'].includes(line)),
      chapterTitle: lines.find(line => /^第\\d+話|^最終話|^後記/.test(line)),
      pageIndicator: lines.find(line => /^\\d+\\/\\d+頁$/.test(line)),
      catalogUrl: links.find(link => link.text === '目錄')?.href,
      previousUrl: links.find(link => link.text === '上一頁')?.href,
      nextUrl: links.find(link => link.text === '下一頁')?.href,
      images
    };
  })()`);
  const raw = result.value as Omit<ChapterData, 'imageCount' | 'bodyCandidateCount' | 'filteredImageCount' | 'unknownImageCount' | 'mediaHosts' | 'filteredHosts' | 'unknownHosts'> & { images: Array<Omit<ChapterImageSummary, 'kind'>> };
  const images = raw.images
    .map(image => ({ ...image, pageNumber: image.pageNumber ?? pageNumberFromRoumanUrl(image.url), kind: classifyImageHost(image.host) }))
    .sort((a, b) => (a.pageNumber ?? a.index) - (b.pageNumber ?? b.index));
  const bodyHosts = domains(images.filter(image => image.kind === 'body_candidate').map(image => image.host));
  const filteredHosts = domains(images.filter(image => image.kind === 'ad_or_tracking').map(image => image.host));
  const unknownHosts = domains(images.filter(image => image.kind === 'unknown').map(image => image.host));
  return {
    ...raw,
    images,
    imageCount: images.length,
    bodyCandidateCount: images.filter(image => image.kind === 'body_candidate').length,
    filteredImageCount: images.filter(image => image.kind === 'ad_or_tracking' || image.kind === 'site_asset').length,
    unknownImageCount: images.filter(image => image.kind === 'unknown').length,
    mediaHosts: bodyHosts,
    filteredHosts,
    unknownHosts,
  };
}

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  await openSitePage(ctx.profile, ORIGIN);
  await sleep(1500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => ({
    url: location.href,
    title: document.title,
    language: document.documentElement.lang,
    ageGate: document.body.innerText.includes('您欲觀看的頁面包含成人內容'),
    loginLinks: Array.from(document.querySelectorAll('a[href*="/auth/"]')).map(a => a.href),
    nav: Array.from(document.querySelectorAll('a[href]')).map(a => String(a.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 20)
  }))()`);
  const value = result.value as { url: string; title: string; language?: string; ageGate?: boolean; loginLinks?: string[]; nav?: string[] };
  const [robots, sitemap] = await Promise.all([
    fetchText(`${ORIGIN}/robots.txt`),
    fetchText(`${ORIGIN}/sitemap.xml`),
  ]);
  return {
    site: SITE,
    command: 'status',
    ok: true,
    state: 'status_collected',
    page: { url: value.url, title: value.title },
    observations: {
      language: value.language,
      ageGate: Boolean(value.ageGate),
      loginEntrypoints: domains(value.loginLinks || []),
      nav: value.nav,
      robots: {
        ok: robots.ok,
        status: robots.status,
        hasDisallow: /Disallow:\s*\/\S+/i.test(robots.text || ''),
        note: 'robots.txt is not copyright authorization.',
      },
      sitemap: {
        ok: sitemap.ok,
        status: sitemap.status,
        publicRoutes: Array.from((sitemap.text || '').matchAll(/<loc>(.*?)<\/loc>/g)).map(match => match[1]).slice(0, 20),
      },
      authorizationRequired: true,
    },
    next: [
      'Use home/search/comic/chapters for read-only metadata.',
      'Do not download comic body images unless you have explicit rights and a separate compliant workflow.',
    ],
  };
}

async function runHome(ctx: SiteCommandContext, options: LimitOptions): Promise<SiteReceipt> {
  const limit = clampLimit(options.limit);
  const data = await collectHome(ctx, limit);
  return {
    site: SITE,
    command: 'home',
    ok: true,
    state: 'home_collected',
    page: { url: data.url, title: data.title },
    observations: {
      ageGate: data.ageGate,
      itemCount: data.cards.length,
      items: data.cards,
      authorizationRequired: true,
    },
    next: ['Use siteflow rouman5 comic <url-or-id> to inspect a detail page without downloading images.'],
  };
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const keyword = options.keyword?.trim();
  if (!keyword) {
    return {
      site: SITE,
      command: 'search',
      ok: false,
      state: 'missing_keyword',
      errors: [{ code: 'MISSING_KEYWORD', message: 'Provide a search keyword.' }],
    };
  }
  const data = await collectSearch(ctx, keyword, clampLimit(options.limit));
  return {
    site: SITE,
    command: 'search',
    ok: true,
    state: 'search_collected',
    page: { url: data.url, title: data.title },
    observations: {
      keyword,
      resultCount: data.resultCount,
      itemCount: data.cards.length,
      items: data.cards,
      authorizationRequired: true,
    },
    next: ['Use siteflow rouman5 comic <url-or-id> for metadata and chapter links.'],
  };
}

async function runComic(ctx: SiteCommandContext, options: UrlOrIdOptions): Promise<SiteReceipt> {
  const data = await collectComic(ctx, options.target);
  return {
    site: SITE,
    command: 'comic',
    ok: true,
    state: 'comic_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requested: options.target,
      name: data.name,
      aliases: data.aliases,
      author: data.author,
      status: data.status,
      region: data.region,
      counters: data.counters,
      updatedAt: data.updatedAt,
      description: data.description,
      chapterCount: data.chapterCount,
      chapters: data.chapters.slice(0, 20),
      chaptersTruncated: data.chapterCount > 20,
      authorizationRequired: true,
    },
    next: ['Use siteflow rouman5 chapters <url-or-id> for the full chapter list.'],
  };
}

async function runChapters(ctx: SiteCommandContext, options: UrlOrIdOptions): Promise<SiteReceipt> {
  const data = await collectComic(ctx, options.target);
  return {
    site: SITE,
    command: 'chapters',
    ok: true,
    state: 'chapters_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requested: options.target,
      name: data.name,
      chapterCount: data.chapterCount,
      chapters: data.chapters,
      authorizationRequired: true,
    },
    next: ['Use siteflow rouman5 chapter <chapter-url> --metadata-only to inspect one chapter without downloading images.'],
  };
}

async function runChapter(ctx: SiteCommandContext, options: ChapterOptions): Promise<SiteReceipt> {
  const data = await collectChapter(ctx, options.target);
  return {
    site: SITE,
    command: 'chapter',
    ok: true,
    state: 'chapter_metadata_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requested: options.target,
      metadataOnly: true,
      comicName: data.comicName,
      chapterTitle: data.chapterTitle,
      pageIndicator: data.pageIndicator,
      catalogUrl: data.catalogUrl,
      previousUrl: data.previousUrl,
      nextUrl: data.nextUrl,
      imageCount: data.imageCount,
      bodyCandidateCount: data.bodyCandidateCount,
      filteredImageCount: data.filteredImageCount,
      unknownImageCount: data.unknownImageCount,
      mediaHosts: data.mediaHosts,
      filteredHosts: data.filteredHosts,
      unknownHosts: data.unknownHosts,
      images: data.images.map(image => ({
        index: image.index,
        host: image.host,
        pathShape: image.pathShape,
        width: image.width,
        height: image.height,
        pageNumber: image.pageNumber,
        kind: image.kind,
      })),
      authorizationRequired: true,
    },
    next: ['Download is intentionally dry-run only for this site adapter.'],
  };
}

async function downloadChapterImages(ctx: SiteCommandContext, target: string, outDir: string, chapter?: ChapterLink): Promise<ChapterDownloadResult> {
  const data = await collectChapter(ctx, target);
  const bodyImages = data.images.filter(img => img.kind === 'body_candidate');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const downloaded: DownloadedImage[] = [];

  for (const [bodyIndex, img] of bodyImages.entries()) {
    const page = img.pageNumber || bodyIndex + 1;
    const shouldUnscramble = needsRoumanUnscramble(img.url);
    const existingPath = ['png']
      .map(ext => join(outDir, `${page}.${ext}`))
      .find(path => existsSync(path));

    // 断点续传：已存在则跳过
    if (existingPath) {
      downloaded.push({ page, index: img.index, url: img.url, savedPath: existingPath, skipped: true });
      continue;
    }

    try {
      const image = await renderRoumanImage(ctx.profile, img.url).catch(async error => {
        if (shouldUnscramble) throw error;
        return fetchImage(img.url, data.url);
      });
      const ext = extensionFromImage(image.contentType, image.buffer, img.url);
      if (!ext) {
        downloaded.push({ page, index: img.index, url: img.url, error: `Unsupported image response: ${image.contentType || 'unknown content-type'}` });
        continue;
      }
      const savedPath = join(outDir, `${page}.${ext}`);
      writeFileSync(savedPath, image.buffer);
      downloaded.push({ page, index: img.index, url: img.url, savedPath, bytes: image.buffer.byteLength, contentType: image.contentType, source: image.source });
    } catch (error) {
      downloaded.push({ page, index: img.index, url: img.url, error: error instanceof Error ? error.message : String(error) });
    }

    // 频率控制：每张间隔 200-500ms
    await sleep(200 + Math.floor(Math.random() * 300));
  }

  const readerPath = writeReaderHtml(outDir, data, downloaded);

  return {
    chapter,
    data,
    outDir,
    bodyImageCount: bodyImages.length,
    downloaded,
    readerPath,
  };
}

async function runDownload(ctx: SiteCommandContext, options: DownloadOptions): Promise<SiteReceipt> {
  const applyRequested = Boolean(options.apply);

  if (!applyRequested) {
    const data = await collectChapter(ctx, options.target);
    const network = await listSiteNetwork(ctx.profile, 500);
    const estimatedBytes = estimateBodyBytes(network);
    return {
      site: SITE,
      command: 'download',
      ok: true,
      state: 'download_dry_run',
      page: { url: data.url, title: data.title },
      observations: {
        requested: options.target,
        out: options.out || './downloads',
        dryRun: true,
        willDownload: false,
        bodyCandidateCount: data.bodyCandidateCount,
        filteredImageCount: data.filteredImageCount,
        unknownImageCount: data.unknownImageCount,
        mediaHosts: data.mediaHosts,
        filteredHosts: data.filteredHosts,
        unknownHosts: data.unknownHosts,
        estimatedBytes,
      },
      next: ['Add --apply to actually download images.'],
    };
  }

  const result = await downloadChapterImages(ctx, options.target, options.out || './downloads');
  const data = result.data;
  const downloaded = result.downloaded;

  return {
    site: SITE,
    command: 'download',
    ok: true,
    state: 'download_applied',
    page: { url: data.url, title: data.title },
    observations: {
      requested: options.target,
      out: result.outDir,
      dryRun: false,
      downloadedCount: downloaded.filter(d => !d.error).length,
      failedCount: downloaded.filter(d => d.error).length,
      totalBodyImages: result.bodyImageCount,
      readerPath: result.readerPath,
      items: downloaded,
    },
    next: result.readerPath ? [`Open ${result.readerPath} for continuous vertical reading.`] : [],
  };
}

function selectChapters(chapters: ChapterLink[], options: DownloadBookOptions): ChapterLink[] {
  const from = optionalPositiveInt(options.from);
  const to = optionalPositiveInt(options.to);
  const limit = optionalPositiveInt(options.limit);
  let selected = chapters.filter(chapter => {
    const ordinal = chapter.index + 1;
    if (from && ordinal < from) return false;
    if (to && ordinal > to) return false;
    return true;
  });
  if (limit) selected = selected.slice(0, limit);
  return selected;
}

async function runDownloadBook(ctx: SiteCommandContext, options: DownloadBookOptions): Promise<SiteReceipt> {
  const comic = await collectComic(ctx, options.target);
  const selectedChapters = selectChapters(comic.chapters, options);
  const outDir = options.out || './downloads';
  const applyRequested = Boolean(options.apply);

  if (!applyRequested) {
    return {
      site: SITE,
      command: 'download-book',
      ok: true,
      state: 'book_download_dry_run',
      page: { url: comic.url, title: comic.title },
      observations: {
        requested: options.target,
        out: outDir,
        dryRun: true,
        willDownload: false,
        name: comic.name,
        chapterCount: comic.chapterCount,
        selectedChapterCount: selectedChapters.length,
        selectedChapters,
        authorizationRequired: true,
      },
      next: ['Add --apply to actually download every selected chapter.'],
    };
  }

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const results: ChapterDownloadResult[] = [];
  const failures: Array<{ chapter: ChapterLink; outDir: string; error: string }> = [];

  for (const [ordinal, chapter] of selectedChapters.entries()) {
    const chapterOutDir = join(outDir, chapterDirName(chapter, ordinal));
    try {
      const result = await downloadChapterImages(ctx, chapter.url, chapterOutDir, chapter);
      results.push(result);
    } catch (error) {
      failures.push({
        chapter,
        outDir: chapterOutDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const indexPath = writeBookIndexHtml(outDir, comic, results);
  const chapterSummaries = results.map(result => ({
    index: result.chapter?.index,
    title: result.chapter?.title || result.data.chapterTitle,
    url: result.chapter?.url || result.data.url,
    out: result.outDir,
    readerPath: result.readerPath,
    downloadedCount: result.downloaded.filter(item => item.savedPath && !item.error).length,
    failedCount: result.downloaded.filter(item => item.error).length,
    totalBodyImages: result.bodyImageCount,
  }));
  const downloadedCount = chapterSummaries.reduce((total, item) => total + item.downloadedCount, 0);
  const failedImageCount = chapterSummaries.reduce((total, item) => total + item.failedCount, 0);

  return {
    site: SITE,
    command: 'download-book',
    ok: failures.length === 0 && failedImageCount === 0,
    state: failures.length === 0 && failedImageCount === 0 ? 'book_download_applied' : 'book_download_partial',
    page: { url: comic.url, title: comic.title },
    observations: {
      requested: options.target,
      out: outDir,
      dryRun: false,
      name: comic.name,
      chapterCount: comic.chapterCount,
      selectedChapterCount: selectedChapters.length,
      completedChapterCount: results.length,
      failedChapterCount: failures.length,
      downloadedCount,
      failedImageCount,
      indexPath,
      chapters: chapterSummaries,
      failures,
    },
    next: indexPath ? [`Open ${indexPath} for the full book index.`] : [],
  };
}

export const rouman5Adapter: SiteAdapter = {
  id: SITE,
  title: 'rouman5',
  description: 'rouman5 metadata exploration and download adapter.',
  commands: [
    {
      name: 'status',
      description: 'Check rouman5 public surface, age gate, login entrypoints, robots, and sitemap',
      configure(command: Command): void {
        command.action(async function () {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runStatus(ctx));
        });
      },
    },
    {
      name: 'home',
      description: 'Collect rouman5 home page comic metadata without downloading images',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'number of comic cards to return', '20')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runHome(ctx, this.opts<LimitOptions>()));
          });
      },
    },
    {
      name: 'search',
      description: 'Search rouman5 public metadata without downloading images',
      configure(command: Command): void {
        command
          .argument('<keyword>', 'search keyword')
          .option('--limit <n>', 'number of result cards to return', '20')
          .action(async function (keyword: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<LimitOptions>(), keyword }));
          });
      },
    },
    {
      name: 'comic',
      description: 'Collect rouman5 comic detail metadata and chapter sample',
      configure(command: Command): void {
        command
          .argument('<url-or-id>', 'comic detail URL or book id')
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runComic(ctx, { target }));
          });
      },
    },
    {
      name: 'chapters',
      description: 'List rouman5 chapter URLs for a comic without opening every chapter',
      configure(command: Command): void {
        command
          .argument('<url-or-id>', 'comic detail URL or book id')
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runChapters(ctx, { target }));
          });
      },
    },
    {
      name: 'chapter',
      description: 'Collect rouman5 chapter metadata, image counts, and CDN domains without saving images',
      configure(command: Command): void {
        command
          .argument('<url-or-id>', 'chapter URL, book id, or bookId/chapterIndex')
          .option('--metadata-only', 'only collect metadata; this adapter always behaves this way', true)
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runChapter(ctx, { ...this.opts<ChapterOptions>(), target }));
          });
      },
    },
    {
      name: 'download',
      description: 'Download rouman5 chapter images; use --apply to actually save files',
      configure(command: Command): void {
        command
          .argument('<url-or-id>', 'chapter URL, book id, or bookId/chapterIndex')
          .option('--out <path>', 'output directory', './downloads')
          .option('--apply', 'actually download images (default is dry-run)')
          .option('--i-have-rights', 'confirm you have rights to download this content')
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runDownload(ctx, { ...this.opts<DownloadOptions>(), target }));
          });
      },
    },
    {
      name: 'download-book',
      description: 'Download every chapter in a rouman5 book; use --apply to actually save files',
      configure(command: Command): void {
        command
          .alias('download-all')
          .argument('<url-or-id>', 'comic detail URL or book id')
          .option('--out <path>', 'output directory', './downloads')
          .option('--from <n>', 'first 1-based chapter number to download')
          .option('--to <n>', 'last 1-based chapter number to download')
          .option('--limit <n>', 'maximum number of chapters to download')
          .option('--apply', 'actually download images (default is dry-run)')
          .option('--i-have-rights', 'confirm you have rights to download this content')
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runDownloadBook(ctx, { ...this.opts<DownloadBookOptions>(), target }));
          });
      },
    },
  ],
};
