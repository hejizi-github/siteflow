import type { Command } from 'commander';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { runSiteCommand, clampInt, fetchText, parseJsonp, siteReceipt } from './capabilities.js';

const SITE = 'eastmoney';
const UA = 'siteflow eastmoney read-only adapter';
const UT = 'fa5fd1943c7b386f172d6893dbfba10b';

interface SymbolOptions { symbol: string }
interface LimitSymbolOptions extends SymbolOptions { limit?: string }
interface KlineOptions extends LimitSymbolOptions { period?: string }

interface EastmoneyEnvelope<T = unknown> {
  rc?: number;
  rt?: number;
  data?: T;
}

function secid(symbol: string): { secid: string; code: string; market: string; secucode: string } {
  const raw = symbol.trim().toUpperCase();
  const code = raw.replace(/\.(SH|SZ)$/, '').replace(/^(SH|SZ)/, '');
  const market = raw.endsWith('.SH') || raw.startsWith('SH') || code.startsWith('6') ? '1' : '0';
  const suffix = market === '1' ? 'SH' : 'SZ';
  return { secid: `${market}.${code}`, code, market, secucode: `${code}.${suffix}` };
}

async function jsonp<T>(url: string): Promise<{ url: string; status: number; data: T }> {
  const result = await fetchText(url, { 'user-agent': UA });
  return { url: result.url, status: result.status, data: parseJsonp<T>(result.text) };
}

function scaled(value: unknown, digits = 2): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === -1 || numeric === -10000000000) return undefined;
  return numeric / (10 ** digits);
}

function normalizeQuote(raw: EastmoneyEnvelope<Record<string, unknown>>): Record<string, unknown> | undefined {
  const data = raw.data;
  if (!data) return undefined;
  return {
    name: data.f58,
    code: data.f57,
    market: data.f107,
    current: scaled(data.f43, Number(data.f59) || 2),
    change: scaled(data.f169, Number(data.f59) || 2),
    percent: scaled(data.f170, Number(data.f152) || 2),
    previousClose: scaled(data.f60, Number(data.f59) || 2),
    open: scaled(data.f46, Number(data.f59) || 2),
    high: scaled(data.f44, Number(data.f59) || 2),
    low: scaled(data.f45, Number(data.f59) || 2),
    volume: data.f47,
    amount: data.f48,
    turnoverRate: scaled(data.f168, 2),
    peDynamic: scaled(data.f162, 2),
    pb: scaled(data.f167, 2),
    totalMarketCap: data.f116,
    circulatingMarketCap: data.f117,
    updateTime: data.f86,
  };
}

function normalizeKlines(raw: EastmoneyEnvelope<{ klines?: string[] }>): Array<Record<string, unknown>> {
  return (raw.data?.klines || []).map(row => {
    const [date, open, close, high, low, volume, amount, amplitude, percent, change, turnover] = row.split(',');
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      amplitude: Number(amplitude),
      percent: Number(percent),
      change: Number(change),
      turnoverRate: Number(turnover),
    };
  });
}

function normalizeTickRows(rows: string[] | undefined): Array<Record<string, unknown>> {
  return (rows || []).map(row => {
    const [time, price, volume, side, tradeCount] = row.split(',');
    return { time, price: Number(price), volume: Number(volume), side, tradeCount: Number(tradeCount) };
  });
}

async function runQuote(_ctx: SiteCommandContext, options: SymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const fields = 'f58,f107,f57,f43,f59,f169,f301,f60,f170,f152,f46,f44,f45,f47,f48,f49,f50,f86,f84,f85,f116,f117,f162,f167,f168,f92,f71';
  const result = await jsonp<EastmoneyEnvelope<Record<string, unknown>>>(`https://push2.eastmoney.com/api/qt/stock/get?cb=cb&ut=${UT}&invt=2&fltt=1&fields=${fields}&secid=${s.secid}`);
  return siteReceipt(SITE, 'quote', { symbol: options.symbol, ...s, endpoint: result.url, httpStatus: result.status, quote: normalizeQuote(result.data), raw: result.data, sideEffects: [] });
}

async function runKline(_ctx: SiteCommandContext, options: KlineOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const limit = clampInt(options.limit, 120, 1, 1000);
  const periodMap: Record<string, string> = { day: '101', week: '102', month: '103', minute: '1' };
  const klt = periodMap[options.period || 'day'] || options.period || '101';
  const result = await jsonp<EastmoneyEnvelope<{ klines?: string[]; name?: string; code?: string }>>(`https://push2his.eastmoney.com/api/qt/stock/kline/get?cb=cb&secid=${s.secid}&ut=${UT}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${encodeURIComponent(klt)}&fqt=1&end=20500101&lmt=${limit}`);
  return siteReceipt(SITE, 'kline', { symbol: options.symbol, ...s, period: options.period || 'day', limit, endpoint: result.url, httpStatus: result.status, name: result.data.data?.name, rows: normalizeKlines(result.data), raw: result.data, sideEffects: [] });
}

async function runTrades(_ctx: SiteCommandContext, options: LimitSymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const limit = clampInt(options.limit, 20, 1, 100);
  const result = await jsonp<EastmoneyEnvelope<{ details?: string[] }>>(`https://push2.eastmoney.com/api/qt/stock/details/get?cb=cb&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55&fltt=2&pos=-${limit}&secid=${s.secid}&ut=${UT}`);
  return siteReceipt(SITE, 'trades', { symbol: options.symbol, ...s, limit, endpoint: result.url, httpStatus: result.status, trades: normalizeTickRows(result.data.data?.details), raw: result.data, sideEffects: [] });
}

async function runFlow(_ctx: SiteCommandContext, options: SymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const result = await jsonp<EastmoneyEnvelope<{ klines?: string[] }>>(`https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?cb=cb&lmt=0&klt=1&secid=${s.secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&ut=${UT}`);
  const rows = (result.data.data?.klines || []).map(row => {
    const [time, mainNetInflow, smallNetInflow, mediumNetInflow, largeNetInflow, superLargeNetInflow] = row.split(',');
    return { time, mainNetInflow: Number(mainNetInflow), smallNetInflow: Number(smallNetInflow), mediumNetInflow: Number(mediumNetInflow), largeNetInflow: Number(largeNetInflow), superLargeNetInflow: Number(superLargeNetInflow) };
  });
  return siteReceipt(SITE, 'flow', { symbol: options.symbol, ...s, endpoint: result.url, httpStatus: result.status, rows, raw: result.data, sideEffects: [] });
}

async function runAnnouncements(_ctx: SiteCommandContext, options: LimitSymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const limit = clampInt(options.limit, 20, 1, 100);
  const result = await jsonp<{ data?: { list?: unknown[] } }>(`https://np-anotice-stock.eastmoney.com/api/security/ann?cb=cb&page_size=${limit}&page_index=1&market_code=${s.market}&stock_list=${s.code}&client_source=web`);
  return siteReceipt(SITE, 'announcements', { symbol: options.symbol, ...s, limit, endpoint: result.url, httpStatus: result.status, announcements: result.data.data?.list || [], raw: result.data, sideEffects: [] });
}

async function runReports(_ctx: SiteCommandContext, options: LimitSymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const limit = clampInt(options.limit, 20, 1, 100);
  const end = new Date().toISOString().slice(0, 10);
  const begin = `${Number(end.slice(0, 4)) - 2}${end.slice(4)}`;
  const result = await jsonp<{ data?: unknown[]; count?: number }>(`https://reportapi.eastmoney.com/report/list?cb=cb&beginTime=${begin}&endTime=${end}&pageNo=1&pageSize=${limit}&qType=0&code=${s.code}&fields=orgCode,orgSName,emRatingName,encodeUrl,title,publishDate`);
  return siteReceipt(SITE, 'reports', { symbol: options.symbol, ...s, limit, endpoint: result.url, httpStatus: result.status, count: result.data.count, reports: result.data.data || [], raw: result.data, sideEffects: [] });
}

async function runGuba(_ctx: SiteCommandContext, options: LimitSymbolOptions): Promise<SiteReceipt> {
  const s = secid(options.symbol);
  const limit = clampInt(options.limit, 20, 1, 100);
  const result = await jsonp<{ re?: unknown[]; count?: number; data?: unknown }>(`https://gbapi.eastmoney.com/webarticlelist/api/Article/Articlelist?code=${s.code}&sorttype=1&ps=${limit}&from=CommonBaPost&deviceid=quoteweb&version=200&product=Guba&plat=Web&needzd=true&callback=cb`);
  return siteReceipt(SITE, 'guba', { symbol: options.symbol, ...s, limit, endpoint: result.url, httpStatus: result.status, count: result.data.count, articles: result.data.re || result.data.data || [], raw: result.data, sideEffects: [] });
}

function symbolCommand(name: string, description: string, runner: (ctx: SiteCommandContext, options: LimitSymbolOptions) => Promise<SiteReceipt>, withLimit = true) {
  return { name, description, configure(command: Command): void {
    command.argument('<symbol>', 'stock symbol, e.g. 600519.SH or SH600519');
    if (withLimit) command.option('--limit <n>', 'number of records', '20');
    command.action(async function (symbol: string) {
      await runSiteCommand(this, ctx => runner(ctx, { ...this.opts<Omit<LimitSymbolOptions, 'symbol'>>(), symbol }));
    });
  } };
}

export const eastmoneyAdapter: SiteAdapter = {
  id: SITE,
  title: 'Eastmoney',
  description: 'Read-only Eastmoney quote, K-line, trades, money flow, announcements, reports, and Guba data.',
  commands: [
    { name: 'quote', description: 'Collect Eastmoney quote data', configure(command: Command): void {
      command.argument('<symbol>').action(async function (symbol: string) {
        await runSiteCommand(this, ctx => runQuote(ctx, { symbol }));
      });
    } },
    { name: 'kline', description: 'Collect Eastmoney K-line data', configure(command: Command): void {
      command.argument('<symbol>').option('--period <day|week|month|minute>', 'period', 'day').option('--limit <n>', 'number of rows', '120').action(async function (symbol: string) {
        await runSiteCommand(this, ctx => runKline(ctx, { ...this.opts<Omit<KlineOptions, 'symbol'>>(), symbol }));
      });
    } },
    symbolCommand('trades', 'Collect recent Eastmoney trade ticks', runTrades),
    symbolCommand('flow', 'Collect Eastmoney money-flow K-line', runFlow, false),
    symbolCommand('announcements', 'Collect Eastmoney stock announcements', runAnnouncements),
    symbolCommand('reports', 'Collect Eastmoney research reports', runReports),
    symbolCommand('guba', 'Collect Eastmoney Guba article list', runGuba),
  ],
};
