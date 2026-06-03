import type { Command } from 'commander';
import { evaluateSiteExpression, navigateSitePage, openSitePage } from './capabilities.js';
import { sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';

const SITE = 'xueqiu';
const ORIGIN = 'https://xueqiu.com';

interface LimitOptions {
  limit?: string;
  pageId?: string;
}

interface PageOptions extends LimitOptions {
  page?: string;
}

interface HotOptions extends LimitOptions {
  kind?: string;
}

interface SearchOptions extends PageOptions {
  keyword: string;
  type?: string;
}

interface SymbolOptions {
  symbol: string;
  pageId?: string;
}

interface TradesOptions extends SymbolOptions {
  count?: string;
}

interface DiscussionsOptions extends PageOptions, SymbolOptions {
  sort?: string;
}

interface StatusOptions {
  target: string;
  pageId?: string;
}

interface CommentsOptions extends StatusOptions, LimitOptions {
  maxId?: string;
}

interface FinanceOptions extends SymbolOptions {
  count?: string;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function parsePageId(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function plainText(value: unknown): string {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStatusTarget(target: string): { userId?: string; statusId: string; url?: string } {
  const trimmed = target.trim();
  const urlMatch = trimmed.match(/xueqiu\.com\/(\d+)\/(\d+)/);
  if (urlMatch) {
    return {
      userId: urlMatch[1],
      statusId: urlMatch[2],
      url: `https://xueqiu.com/${urlMatch[1]}/${urlMatch[2]}`,
    };
  }
  const compactMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (compactMatch) {
    return {
      userId: compactMatch[1],
      statusId: compactMatch[2],
      url: `https://xueqiu.com/${compactMatch[1]}/${compactMatch[2]}`,
    };
  }
  if (/^\d+$/.test(trimmed)) return { statusId: trimmed };
  throw new Error('status target must be a status id, <userId>/<statusId>, or xueqiu status URL');
}

async function ensureXueqiuPage(ctx: SiteCommandContext, url = ORIGIN, pageId?: number): Promise<{ url: string; title: string; pageId?: number }> {
  if (pageId) {
    const page = await navigateSitePage(ctx.profile, url, pageId);
    await sleep(900);
    return { url: page.url, title: page.title, pageId: page.id };
  }
  const page = await openSitePage(ctx.profile, url);
  await sleep(900);
  return { url: page.url, title: page.title, pageId: page.id };
}

function challengeError(page: { url: string; title: string }): Array<{ code: string; message: string }> {
  return /滑动验证|验证页面|captcha|challenge/i.test(`${page.title} ${page.url}`)
    ? [{ code: 'CHALLENGE_DETECTED', message: 'Xueqiu showed a verification/challenge page. Complete it manually in this browser profile, then rerun.' }]
    : [];
}

async function xueqiuGet<T>(ctx: SiteCommandContext, pathOrUrl: string, pageId?: number): Promise<{
  url: string;
  status: number;
  contentType?: string;
  data: T;
}> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : new URL(pathOrUrl, ORIGIN).href;
  const result = await evaluateSiteExpression(ctx.profile, `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { accept: 'application/json, text/plain, */*' },
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { url: response.url, status: response.status, contentType: response.headers.get('content-type') || undefined, data };
    } finally {
      clearTimeout(timer);
    }
  })()`, pageId);
  const value = result.value as { url?: unknown; status?: unknown; contentType?: unknown; data?: unknown } | undefined;
  if (!value || typeof value.url !== 'string' || typeof value.status !== 'number') {
    return {
      url,
      status: 0,
      contentType: undefined,
      data: { error_description: 'page-context fetch did not return a structured response' } as T,
    };
  }
  return value as { url: string; status: number; contentType?: string; data: T };
}

function okStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function receipt(command: string, page: { url: string; title: string }, observations: Record<string, unknown>, ok = true, errors: SiteReceipt['errors'] = []): SiteReceipt {
  return {
    site: SITE,
    command,
    ok,
    state: ok ? `${command}_collected` : `${command}_failed`,
    page,
    observations: {
      ...observations,
      sideEffects: [],
    },
    errors,
    next: [],
  };
}

function addPageIdOption(command: Command): Command {
  return command.option('--page-id <id>', 'existing browser tab id from `siteflow browser pages`; keeps Xueqiu automation bound to that tab');
}

function httpErrors(statuses: Array<{ endpoint: string; status: number }>): Array<{ code: string; message: string }> {
  return statuses
    .filter(item => !okStatus(item.status))
    .map(item => ({
      code: 'HTTP_STATUS',
      message: `${item.endpoint} returned HTTP ${item.status}`,
    }));
}

async function runHome(ctx: SiteCommandContext, options: LimitOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 10, 1, 50);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, ORIGIN, pageId);
  const [quotes, events, hotStocks] = await Promise.all([
    xueqiuGet<{ data?: { items?: unknown[] } }>(ctx, 'https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=SH000001,SZ399001,SZ399006,SH000688,SH000016,SH000300,BJ899050,HKHSI,HKHSCEI,HKHSTECH,.DJI,.IXIC,.INX', pageId),
    xueqiuGet<{ list?: unknown[] }>(ctx, `/hot_event/list.json?count=${limit}`, pageId),
    xueqiuGet<{ data?: { items?: unknown[] } }>(ctx, `https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=${Math.min(limit, 20)}&_type=10&type=10&include=1`, pageId),
  ]);
  const errors = [
    ...challengeError(page),
    ...httpErrors([
      { endpoint: quotes.url, status: quotes.status },
      { endpoint: events.url, status: events.status },
      { endpoint: hotStocks.url, status: hotStocks.status },
    ]),
  ];
  return receipt('home', page, {
    limit,
    pageId,
    endpoints: [
      { url: quotes.url, status: quotes.status },
      { url: events.url, status: events.status },
      { url: hotStocks.url, status: hotStocks.status },
    ],
    indexQuotes: quotes.data?.data?.items || [],
    hotEvents: (events.data?.list || []).slice(0, limit),
    hotStocks: (hotStocks.data?.data?.items || []).slice(0, limit),
  }, errors.length === 0, errors);
}

async function runHot(ctx: SiteCommandContext, options: HotOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 10, 1, 50);
  const pageId = parsePageId(options.pageId);
  const kind = options.kind === 'stock' ? 'stock' : 'event';
  const page = await ensureXueqiuPage(ctx, ORIGIN, pageId);
  if (kind === 'stock') {
    const data = await xueqiuGet<{ data?: { items?: unknown[] } }>(ctx, `https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=${Math.min(limit, 50)}&_type=10&type=10&include=1`, pageId);
    const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
    return receipt('hot', page, { kind, limit, pageId, items: (data.data?.data?.items || []).slice(0, limit), endpoint: data.url, httpStatus: data.status }, errors.length === 0, errors);
  }
  const data = await xueqiuGet<{ list?: unknown[] }>(ctx, `/hot_event/list.json?count=${limit}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('hot', page, { kind, limit, pageId, items: (data.data?.list || []).slice(0, limit), endpoint: data.url, httpStatus: data.status }, errors.length === 0, errors);
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const keyword = options.keyword.trim();
  const limit = clampInt(options.limit, 10, 1, 50);
  const pageNum = clampInt(options.page, 1, 1, 100);
  const pageId = parsePageId(options.pageId);
  const type = options.type || 'all';
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/k?q=${encodeURIComponent(keyword)}`, pageId);
  const tasks: Array<Promise<unknown>> = [];
  const observations: Record<string, unknown> = { keyword, type, page: pageNum, limit, pageId };
  if (type === 'stock' || type === 'all') {
    tasks.push(xueqiuGet<{ list?: unknown[]; count?: number }>(ctx, `/query/v1/search/web/stock.json?q=${encodeURIComponent(keyword)}&size=${Math.min(limit, 50)}&page=${pageNum}`, pageId).then(data => {
      observations.stocks = data.data?.list || [];
      observations.stockCount = data.data?.count;
      observations.stockEndpoint = data.url;
      observations.stockStatus = data.status;
    }));
  }
  if (type === 'status' || type === 'all') {
    tasks.push(xueqiuGet<{ list?: unknown[]; count?: number }>(ctx, `/query/v1/search/status.json?sortId=1&q=${encodeURIComponent(keyword)}&count=${Math.min(limit, 50)}&page=${pageNum}`, pageId).then(data => {
      observations.statuses = normalizeStatuses(data.data?.list || []);
      observations.statusCount = data.data?.count;
      observations.statusEndpoint = data.url;
      observations.statusStatus = data.status;
    }));
  }
  await Promise.all(tasks);
  const errors = [
    ...challengeError(page),
    ...httpErrors([
    ...(typeof observations.stockEndpoint === 'string' && typeof observations.stockStatus === 'number' ? [{ endpoint: observations.stockEndpoint, status: observations.stockStatus }] : []),
    ...(typeof observations.statusEndpoint === 'string' && typeof observations.statusStatus === 'number' ? [{ endpoint: observations.statusEndpoint, status: observations.statusStatus }] : []),
    ]),
  ];
  return receipt('search', page, observations, errors.length === 0, errors);
}

function normalizeStatuses(items: unknown[]): Array<Record<string, unknown>> {
  return items.map(item => {
    const row = item as Record<string, unknown>;
    const user = row.user as Record<string, unknown> | undefined;
    return {
      id: row.id,
      target: row.target,
      createdAt: row.created_at,
      timeBefore: row.timeBefore,
      text: plainText(row.text || row.description),
      source: row.source,
      likeCount: row.like_count,
      replyCount: row.reply_count,
      retweetCount: row.retweet_count,
      user: user ? {
        id: user.id,
        screenName: user.screen_name,
        profile: user.profile,
      } : undefined,
    };
  });
}

async function runQuote(ctx: SiteCommandContext, options: SymbolOptions): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/S/${encodeURIComponent(symbol)}`, pageId);
  const data = await xueqiuGet<{ data?: unknown }>(ctx, `https://stock.xueqiu.com/v5/stock/quote.json?symbol=${encodeURIComponent(symbol)}&extend=detail`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('quote', page, { symbol, pageId, endpoint: data.url, httpStatus: data.status, quote: data.data?.data }, errors.length === 0, errors);
}

async function runMinute(ctx: SiteCommandContext, options: SymbolOptions & { period?: string }): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const period = options.period || '1d';
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/S/${encodeURIComponent(symbol)}`, pageId);
  const data = await xueqiuGet<{ data?: { items?: unknown[]; last_close?: number } }>(ctx, `https://stock.xueqiu.com/v5/stock/chart/minute.json?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('minute', page, {
    symbol,
    period,
    pageId,
    endpoint: data.url,
    httpStatus: data.status,
    lastClose: data.data?.data?.last_close,
    itemCount: data.data?.data?.items?.length || 0,
    items: data.data?.data?.items || [],
  }, errors.length === 0, errors);
}

async function runTrades(ctx: SiteCommandContext, options: TradesOptions): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const count = clampInt(options.count, 10, 1, 100);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/S/${encodeURIComponent(symbol)}`, pageId);
  const data = await xueqiuGet<{ data?: { items?: unknown[] } }>(ctx, `https://stock.xueqiu.com/v5/stock/history/trade.json?symbol=${encodeURIComponent(symbol)}&count=${count}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('trades', page, { symbol, count, pageId, endpoint: data.url, httpStatus: data.status, items: data.data?.data?.items || [] }, errors.length === 0, errors);
}

async function runOrderbook(ctx: SiteCommandContext, options: SymbolOptions): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/S/${encodeURIComponent(symbol)}`, pageId);
  const data = await xueqiuGet<{ data?: unknown }>(ctx, `https://stock.xueqiu.com/v5/stock/realtime/pankou.json?symbol=${encodeURIComponent(symbol)}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('orderbook', page, { symbol, pageId, endpoint: data.url, httpStatus: data.status, orderbook: data.data?.data }, errors.length === 0, errors);
}

async function runDiscussions(ctx: SiteCommandContext, options: DiscussionsOptions): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const pageNum = clampInt(options.page, 1, 1, 100);
  const limit = clampInt(options.limit, 10, 1, 50);
  const pageId = parsePageId(options.pageId);
  const sort = options.sort === 'hot' ? 'alpha' : 'time';
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/S/${encodeURIComponent(symbol)}`, pageId);
  const data = await xueqiuGet<{ list?: unknown[]; count?: number; about?: string }>(ctx, `/query/v1/symbol/search/status.json?count=${limit}&comment=0&symbol=${encodeURIComponent(symbol)}&hl=0&source=all&sort=${encodeURIComponent(sort)}&page=${pageNum}&q=&type=11`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('discussions', page, {
    symbol,
    page: pageNum,
    limit,
    pageId,
    sort,
    endpoint: data.url,
    httpStatus: data.status,
    count: data.data?.count,
    statuses: normalizeStatuses(data.data?.list || []),
  }, errors.length === 0, errors);
}

async function runStatus(ctx: SiteCommandContext, options: StatusOptions): Promise<SiteReceipt> {
  const target = parseStatusTarget(options.target);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, target.url || ORIGIN, pageId);
  const snapshot = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const text = document.body.innerText || '';
    const author = clean(document.querySelector('.status-user-name, .user-name, a[href*="/${target.userId || ''}"]')?.textContent);
    return {
      url: location.href,
      title: document.title,
      text: text.slice(0, 5000),
      author: author || undefined,
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map(a => ({ text: clean(a.textContent), url: a.href }))
    };
  })()`, pageId);
  const errors = challengeError(page);
  return receipt('status', { url: page.url, title: page.title }, {
    target,
    pageId,
    status: snapshot.value,
  }, errors.length === 0, errors);
}

async function runComments(ctx: SiteCommandContext, options: CommentsOptions): Promise<SiteReceipt> {
  const target = parseStatusTarget(options.target);
  const limit = clampInt(options.limit, 20, 1, 100);
  const maxId = options.maxId || '-1';
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, target.url || ORIGIN, pageId);
  const data = await xueqiuGet<{ comments?: unknown[]; comment_tl_count?: number; next_max_id?: number }>(ctx, `/statuses/v3/comments.json?id=${encodeURIComponent(target.statusId)}&type=4&size=${limit}&max_id=${encodeURIComponent(maxId)}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('comments', page, {
    target,
    limit,
    maxId,
    pageId,
    httpStatus: data.status,
    endpoint: data.url,
    total: data.data?.comment_tl_count,
    nextMaxId: data.data?.next_max_id,
    comments: normalizeComments(data.data?.comments || []),
  }, errors.length === 0, errors);
}

function normalizeComments(items: unknown[]): Array<Record<string, unknown>> {
  return items.map(item => {
    const row = item as Record<string, unknown>;
    const user = row.user as Record<string, unknown> | undefined;
    return {
      id: row.id,
      statusId: row.statusId,
      createdAt: row.created_at,
      timeBefore: row.timeBefore,
      text: plainText(row.description),
      likeCount: row.like_count,
      replyCount: row.reply_count,
      user: user ? {
        id: user.id,
        screenName: user.screen_name,
        profile: user.profile,
      } : undefined,
    };
  });
}

async function runFinance(ctx: SiteCommandContext, options: FinanceOptions): Promise<SiteReceipt> {
  const symbol = normalizeSymbol(options.symbol);
  const count = clampInt(options.count, 5, 1, 20);
  const pageId = parsePageId(options.pageId);
  const page = await ensureXueqiuPage(ctx, `${ORIGIN}/snowman/S/${encodeURIComponent(symbol)}/detail#/ZYCWZB`, pageId);
  const data = await xueqiuGet<{ data?: unknown }>(ctx, `https://stock.xueqiu.com/v5/stock/finance/cn/indicator.json?symbol=${encodeURIComponent(symbol)}&type=all&is_detail=true&count=${count}&timestamp=${Date.now()}`, pageId);
  const errors = [...challengeError(page), ...httpErrors([{ endpoint: data.url, status: data.status }])];
  return receipt('finance', page, { symbol, count, pageId, endpoint: data.url, httpStatus: data.status, finance: data.data?.data }, errors.length === 0, errors);
}

export const xueqiuAdapter: SiteAdapter = {
  id: SITE,
  title: 'Xueqiu',
  description: 'Read-only Xueqiu market, stock, discussion, status, comment, and finance collection.',
  commands: [
    {
      name: 'home',
      description: 'Collect Xueqiu homepage index quotes, hot events, and hot stocks',
      configure(command: Command): void {
        addPageIdOption(command.option('--limit <n>', 'number of hot records to return', '10')).action(async function () {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runHome(ctx, this.opts<LimitOptions>()));
        });
      },
    },
    {
      name: 'hot',
      description: 'Collect Xueqiu hot events or hot stocks',
      configure(command: Command): void {
        command
          .option('--kind <event|stock>', 'hot list kind', 'event')
          .option('--limit <n>', 'number of records to return', '10');
        addPageIdOption(command)
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runHot(ctx, this.opts<HotOptions>()));
          });
      },
    },
    {
      name: 'search',
      description: 'Search Xueqiu stocks and/or statuses',
      configure(command: Command): void {
        command
          .argument('<keyword>', 'search keyword')
          .option('--type <stock|status|all>', 'search result type', 'all')
          .option('--page <n>', 'result page', '1')
          .option('--limit <n>', 'number of records to return', '10');
        addPageIdOption(command)
          .action(async function (keyword: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
          });
      },
    },
    {
      name: 'quote',
      description: 'Collect one Xueqiu stock quote detail',
      configure(command: Command): void {
        addPageIdOption(command.argument('<symbol>', 'Xueqiu symbol, e.g. SH600519')).action(async function (symbol: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runQuote(ctx, { ...this.opts<Omit<SymbolOptions, 'symbol'>>(), symbol }));
        });
      },
    },
    {
      name: 'minute',
      description: 'Collect one stock minute chart',
      configure(command: Command): void {
        addPageIdOption(command.argument('<symbol>', 'Xueqiu symbol').option('--period <period>', 'minute chart period', '1d')).action(async function (symbol: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runMinute(ctx, { ...this.opts<{ period?: string }>(), symbol }));
        });
      },
    },
    {
      name: 'trades',
      description: 'Collect recent stock trade ticks',
      configure(command: Command): void {
        addPageIdOption(command.argument('<symbol>', 'Xueqiu symbol').option('--count <n>', 'number of trades', '10')).action(async function (symbol: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runTrades(ctx, { ...this.opts<Omit<TradesOptions, 'symbol'>>(), symbol }));
        });
      },
    },
    {
      name: 'orderbook',
      description: 'Collect realtime order book / pankou for one stock',
      configure(command: Command): void {
        addPageIdOption(command.argument('<symbol>', 'Xueqiu symbol')).action(async function (symbol: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runOrderbook(ctx, { ...this.opts<Omit<SymbolOptions, 'symbol'>>(), symbol }));
        });
      },
    },
    {
      name: 'discussions',
      description: 'Collect Xueqiu stock discussion statuses',
      configure(command: Command): void {
        command
          .argument('<symbol>', 'Xueqiu symbol')
          .option('--page <n>', 'discussion page', '1')
          .option('--limit <n>', 'number of statuses', '10')
          .option('--sort <time|hot>', 'discussion sort', 'time');
        addPageIdOption(command)
          .action(async function (symbol: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runDiscussions(ctx, { ...this.opts<Omit<DiscussionsOptions, 'symbol'>>(), symbol }));
          });
      },
    },
    {
      name: 'status',
      description: 'Collect one Xueqiu status page snapshot',
      configure(command: Command): void {
        addPageIdOption(command.argument('<status-url-or-id>', 'status id, userId/statusId, or status URL')).action(async function (target: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runStatus(ctx, { ...this.opts<Omit<StatusOptions, 'target'>>(), target }));
        });
      },
    },
    {
      name: 'comments',
      description: 'Collect comments for one Xueqiu status',
      configure(command: Command): void {
        command
          .argument('<status-url-or-id>', 'status id, userId/statusId, or status URL')
          .option('--limit <n>', 'number of comments', '20')
          .option('--max-id <id>', 'comment cursor max_id', '-1');
        addPageIdOption(command)
          .action(async function (target: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runComments(ctx, { ...this.opts<Omit<CommentsOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'finance',
      description: 'Collect Xueqiu financial indicators for one stock',
      configure(command: Command): void {
        addPageIdOption(command.argument('<symbol>', 'Xueqiu symbol').option('--count <n>', 'number of reports', '5')).action(async function (symbol: string) {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, ctx => runFinance(ctx, { ...this.opts<Omit<FinanceOptions, 'symbol'>>(), symbol }));
        });
      },
    },
  ],
};
