import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { runSiteCommand, clampInt, cleanText } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'cninfo';
const ORIGIN = 'https://www.cninfo.com.cn';
const STATIC_ORIGIN = 'https://static.cninfo.com.cn';
const USER_AGENT = 'siteflow cninfo read-only adapter';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

interface PageOptions {
  page?: string;
  limit?: string;
}

interface LatestOptions extends PageOptions {
  market?: string;
}

interface SearchOptions extends PageOptions {
  keyword: string;
}

interface CompanyOptions extends PageOptions {
  code: string;
}

interface AnnouncementOptions {
  target: string;
}

interface PdfOptions extends AnnouncementOptions {
  out?: string;
}

interface StockRecord {
  code: string;
  orgId: string;
  zwjc: string;
  pinyin?: string;
  category?: string;
}

interface AnnouncementRecord {
  secCode?: string;
  secName?: string;
  orgId?: string;
  announcementId?: string;
  announcementTitle?: string;
  announcementTime?: number;
  adjunctUrl?: string;
  adjunctSize?: number;
  adjunctType?: string;
  announcementTypeName?: string | null;
  important?: boolean | null;
  shortTitle?: string | null;
  tileSecName?: string | null;
  pageColumn?: string;
  columnId?: string;
}

interface DisclosureResponse {
  classifiedAnnouncements?: AnnouncementRecord[][];
  announcements?: AnnouncementRecord[];
  totalSecurities?: number;
  totalAnnouncement?: number;
  totalRecordNum?: number;
  totalpages?: number;
}

function plainText(value: unknown): string {
  return cleanText(value);
}

function normalizeMarket(value: string | undefined): string {
  const market = (value || 'szse_latest').trim();
  const map: Record<string, string> = {
    latest: 'szse_latest',
    szse: 'szse_latest',
    sse: 'sse_latest',
    bj: 'bj_latest',
    fund: 'fund_latest',
    bond: 'bond_latest',
    hke: 'hke_latest',
  };
  return map[market] || market;
}

function normalizeAnnouncement(item: AnnouncementRecord): Record<string, unknown> {
  const pdfUrl = item.adjunctUrl ? new URL(item.adjunctUrl, `${STATIC_ORIGIN}/`).href : undefined;
  const detailUrl = item.announcementId
    ? `${ORIGIN}/new/disclosure/detail?stockCode=${encodeURIComponent(item.secCode || '')}&announcementId=${encodeURIComponent(item.announcementId)}&orgId=${encodeURIComponent(item.orgId || '')}`
    : undefined;
  return {
    secCode: item.secCode,
    secName: plainText(item.secName || item.tileSecName),
    orgId: item.orgId,
    announcementId: item.announcementId,
    title: plainText(item.announcementTitle || item.shortTitle),
    announcementTime: item.announcementTime,
    adjunctUrl: item.adjunctUrl,
    pdfUrl,
    detailUrl,
    adjunctSizeKb: item.adjunctSize,
    adjunctType: item.adjunctType,
    typeName: item.announcementTypeName,
    important: item.important,
    pageColumn: item.pageColumn,
    columnId: item.columnId,
  };
}

function flattenAnnouncements(data: DisclosureResponse): AnnouncementRecord[] {
  if (Array.isArray(data.announcements)) return data.announcements;
  return (data.classifiedAnnouncements || []).flat();
}

async function postForm<T>(url: string, params: Record<string, string | number | boolean | undefined>): Promise<{ url: string; status: number; data: T }> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json, text/plain, */*',
      referer: `${ORIGIN}/new/index`,
      'user-agent': USER_AGENT,
    },
    body,
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { url: response.url, status: response.status, data: data as T };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json, text/plain, */*', 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.json() as T;
}

async function resolveStock(codeOrName: string): Promise<StockRecord | undefined> {
  const query = codeOrName.trim();
  const data = await getJson<{ stockList?: StockRecord[] }>(`${ORIGIN}/new/data/szse_stock.json`);
  return (data.stockList || []).find(item => item.code === query || item.zwjc === query || item.pinyin?.toLowerCase() === query.toLowerCase());
}

async function queryHistory(params: Record<string, string | number | boolean | undefined>): Promise<{ url: string; status: number; data: DisclosureResponse }> {
  return await postForm<DisclosureResponse>(`${ORIGIN}/new/hisAnnouncement/query`, {
    pageNum: 1,
    pageSize: 30,
    column: 'szse',
    tabName: 'fulltext',
    plate: '',
    stock: '',
    searchkey: '',
    secid: '',
    category: '',
    trade: '',
    seDate: '',
    sortName: '',
    sortType: '',
    isHLtitle: true,
    ...params,
  });
}

async function findAnnouncement(target: string): Promise<AnnouncementRecord | undefined> {
  const parsed = parseAnnouncementTarget(target);
  if (parsed.adjunctUrl) {
    return { announcementId: parsed.announcementId, adjunctUrl: parsed.adjunctUrl, adjunctType: path.extname(parsed.adjunctUrl).replace('.', '').toUpperCase() || undefined };
  }
  if (!parsed.announcementId) return undefined;
  const secInfo = await postForm<Array<{ seccode?: string; secname?: string; ogrId?: string }>>(`${ORIGIN}/new/hisAnnouncement/getSecnameByAnnouncementId`, {
    announcementId: parsed.announcementId,
  });
  const first = Array.isArray(secInfo.data) ? secInfo.data[0] : undefined;
  if (first?.seccode && first.ogrId) {
    const history = await queryHistory({ stock: `${first.seccode},${first.ogrId}`, pageNum: 1, pageSize: 50 });
    return flattenAnnouncements(history.data).find(item => item.announcementId === parsed.announcementId);
  }
  return { announcementId: parsed.announcementId };
}

function parseAnnouncementTarget(target: string): { announcementId?: string; adjunctUrl?: string } {
  const trimmed = target.trim();
  const finalpageMatch = trimmed.match(/finalpage\/\d{4}-\d{2}-\d{2}\/(\d+)\.[A-Za-z0-9]+/);
  if (finalpageMatch) {
    const adjunctUrl = trimmed.startsWith('http') ? new URL(trimmed).pathname.replace(/^\//, '') : trimmed;
    return { announcementId: finalpageMatch[1], adjunctUrl };
  }
  const idMatch = trimmed.match(/announcementId=(\d+)/) || trimmed.match(/^(\d{6,})$/);
  return { announcementId: idMatch?.[1] };
}

function receipt(command: string, observations: Record<string, unknown>, ok = true, errors: SiteReceipt['errors'] = []): SiteReceipt {
  return {
    site: SITE,
    command,
    ok,
    state: ok ? `${command}_collected` : `${command}_failed`,
    page: { url: ORIGIN, title: '巨潮资讯网' },
    observations,
    errors,
    next: [],
  };
}

async function runLatest(_ctx: SiteCommandContext, options: LatestOptions): Promise<SiteReceipt> {
  const page = clampInt(options.page, 1, 1, 100);
  const limit = clampInt(options.limit, 30, 1, 100);
  const market = normalizeMarket(options.market);
  const result = await postForm<DisclosureResponse>(`${ORIGIN}/new/disclosure`, {
    column: market,
    pageNum: page,
    pageSize: limit,
    sortName: '',
    sortType: '',
    clusterFlag: true,
  });
  const items = flattenAnnouncements(result.data).slice(0, limit).map(normalizeAnnouncement);
  const ok = result.status >= 200 && result.status < 300;
  return receipt('latest', {
    market,
    page,
    limit,
    endpoint: result.url,
    httpStatus: result.status,
    totalSecurities: result.data.totalSecurities,
    totalAnnouncement: result.data.totalAnnouncement,
    totalRecordNum: result.data.totalRecordNum,
    totalpages: result.data.totalpages,
    count: items.length,
    announcements: items,
    sideEffects: [],
  }, ok, ok ? [] : [{ code: 'HTTP_STATUS', message: `${result.url} returned HTTP ${result.status}` }]);
}

async function runSearch(_ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const keyword = options.keyword.trim();
  const page = clampInt(options.page, 1, 1, 100);
  const limit = clampInt(options.limit, 30, 1, 100);
  const result = await queryHistory({ searchkey: keyword, pageNum: page, pageSize: limit });
  const items = flattenAnnouncements(result.data).map(normalizeAnnouncement);
  const ok = result.status >= 200 && result.status < 300;
  return receipt('search', {
    keyword,
    page,
    limit,
    endpoint: result.url,
    httpStatus: result.status,
    totalAnnouncement: result.data.totalAnnouncement,
    totalRecordNum: result.data.totalRecordNum,
    totalpages: result.data.totalpages,
    count: items.length,
    announcements: items,
    sideEffects: [],
  }, ok, ok ? [] : [{ code: 'HTTP_STATUS', message: `${result.url} returned HTTP ${result.status}` }]);
}

async function runCompany(_ctx: SiteCommandContext, options: CompanyOptions): Promise<SiteReceipt> {
  const page = clampInt(options.page, 1, 1, 100);
  const limit = clampInt(options.limit, 30, 1, 100);
  const stock = await resolveStock(options.code);
  const result = stock
    ? await queryHistory({ stock: `${stock.code},${stock.orgId}`, pageNum: page, pageSize: limit })
    : await queryHistory({ searchkey: options.code.trim(), pageNum: page, pageSize: limit });
  const items = flattenAnnouncements(result.data).map(normalizeAnnouncement);
  const ok = result.status >= 200 && result.status < 300;
  return receipt('company', {
    query: options.code,
    resolvedStock: stock,
    page,
    limit,
    endpoint: result.url,
    httpStatus: result.status,
    totalAnnouncement: result.data.totalAnnouncement,
    totalRecordNum: result.data.totalRecordNum,
    totalpages: result.data.totalpages,
    count: items.length,
    announcements: items,
    sideEffects: [],
  }, ok, ok ? [] : [{ code: 'HTTP_STATUS', message: `${result.url} returned HTTP ${result.status}` }]);
}

async function runAnnouncement(_ctx: SiteCommandContext, options: AnnouncementOptions): Promise<SiteReceipt> {
  const item = await findAnnouncement(options.target);
  if (!item) {
    return receipt('announcement', {
      target: options.target,
      sideEffects: [],
    }, false, [{ code: 'NOT_FOUND', message: 'Could not resolve announcement target.' }]);
  }
  return receipt('announcement', {
    target: options.target,
    announcement: normalizeAnnouncement(item),
    sideEffects: [],
  });
}

async function runPdf(_ctx: SiteCommandContext, options: PdfOptions): Promise<SiteReceipt> {
  const item = await findAnnouncement(options.target);
  if (!item?.adjunctUrl) {
    return receipt('pdf', {
      target: options.target,
      sideEffects: [],
    }, false, [{ code: 'PDF_NOT_FOUND', message: 'Could not resolve a downloadable adjunctUrl for this announcement.' }]);
  }
  const pdfUrl = new URL(item.adjunctUrl, `${STATIC_ORIGIN}/`).href;
  const response = await fetch(pdfUrl, { headers: { accept: 'application/pdf,*/*', 'user-agent': USER_AGENT } });
  if (!response.ok) {
    return receipt('pdf', { target: options.target, pdfUrl, sideEffects: [] }, false, [{ code: 'HTTP_STATUS', message: `${pdfUrl} returned HTTP ${response.status}` }]);
  }
  const contentType = response.headers.get('content-type') || '';
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    return receipt('pdf', { target: options.target, pdfUrl, contentLength, maxBytes: MAX_DOWNLOAD_BYTES, sideEffects: [] }, false, [{ code: 'FILE_TOO_LARGE', message: `Download is ${contentLength} bytes; max is ${MAX_DOWNLOAD_BYTES}.` }]);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    return receipt('pdf', { target: options.target, pdfUrl, bytes: bytes.byteLength, maxBytes: MAX_DOWNLOAD_BYTES, sideEffects: [] }, false, [{ code: 'FILE_TOO_LARGE', message: `Download is ${bytes.byteLength} bytes; max is ${MAX_DOWNLOAD_BYTES}.` }]);
  }
  if (!/pdf/i.test(contentType) && !/\.pdf(?:$|\?)/i.test(pdfUrl)) {
    return receipt('pdf', { target: options.target, pdfUrl, contentType, sideEffects: [] }, false, [{ code: 'UNEXPECTED_CONTENT_TYPE', message: `Expected PDF content, got ${contentType || 'unknown content type'}.` }]);
  }
  const outDir = path.resolve(options.out || path.join(process.cwd(), 'downloads', 'cninfo'));
  await fs.mkdir(outDir, { recursive: true });
  const safeId = item.announcementId || parseAnnouncementTarget(options.target).announcementId || String(Date.now());
  const filePath = path.join(outDir, `${safeId}.pdf`);
  await fs.writeFile(filePath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return receipt('pdf', {
    target: options.target,
    announcement: normalizeAnnouncement(item),
    pdfUrl,
    filePath,
    bytes: bytes.byteLength,
    contentType,
    sha256,
    sideEffects: ['file_download'],
  });
}

export const cninfoAdapter: SiteAdapter = {
  id: SITE,
  title: 'CNINFO',
  description: 'Read-only CNINFO announcements, company disclosures, and public PDF downloads.',
  commands: [
    {
      name: 'latest',
      description: 'Collect latest CNINFO announcements',
      configure(command: Command): void {
        command
          .option('--market <name>', 'market/list column, e.g. szse_latest, sse_latest, bj_latest', 'szse_latest')
          .option('--page <n>', 'page number', '1')
          .option('--limit <n>', 'number of announcements', '30')
          .action(async function () {
            await runSiteCommand(this, ctx => runLatest(ctx, this.opts<LatestOptions>()));
          });
      },
    },
    {
      name: 'search',
      description: 'Search CNINFO historical announcements by keyword',
      configure(command: Command): void {
        command
          .argument('<keyword>', 'announcement title/content keyword')
          .option('--page <n>', 'page number', '1')
          .option('--limit <n>', 'number of announcements', '30')
          .action(async function (keyword: string) {
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
          });
      },
    },
    {
      name: 'company',
      description: 'Collect CNINFO announcements for one stock code or company name',
      configure(command: Command): void {
        command
          .argument('<code>', 'stock code, company short name, or pinyin')
          .option('--page <n>', 'page number', '1')
          .option('--limit <n>', 'number of announcements', '30')
          .action(async function (code: string) {
            await runSiteCommand(this, ctx => runCompany(ctx, { ...this.opts<Omit<CompanyOptions, 'code'>>(), code }));
          });
      },
    },
    {
      name: 'announcement',
      description: 'Resolve one CNINFO announcement by id, detail URL, or finalpage URL',
      configure(command: Command): void {
        command
          .argument('<target>', 'announcement id, detail URL, or finalpage URL')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runAnnouncement(ctx, { target }));
          });
      },
    },
    {
      name: 'pdf',
      description: 'Download one public CNINFO announcement PDF',
      configure(command: Command): void {
        command
          .argument('<target>', 'announcement id, detail URL, or finalpage URL')
          .option('--out <dir>', 'output directory for downloaded PDF')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runPdf(ctx, { ...this.opts<Omit<PdfOptions, 'target'>>(), target }));
          });
      },
    },
  ],
};
