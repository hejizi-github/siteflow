import type { Command } from 'commander';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { runSiteCommand, clampInt, downloadFile, fetchJson, siteReceipt } from './capabilities.js';

const SITE = 'sec';
const DATA = 'https://data.sec.gov';
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const UA = process.env.SEC_USER_AGENT || 'siteflow research contact@example.com';

interface LimitOptions { limit?: string }
interface CompanyOptions { tickerOrCik: string }
interface FilingsOptions extends CompanyOptions, LimitOptions { forms?: string }
interface FilingOptions { accession: string; cik?: string }
interface FactsOptions extends CompanyOptions { concept?: string }
interface DownloadOptions extends FilingOptions { out?: string }

interface TickerRecord { cik_str: number; ticker: string; title: string }
interface Submission {
  cik: string;
  name: string;
  tickers?: string[];
  exchanges?: string[];
  filings?: { recent?: Record<string, string[]> };
}

function headers(): Record<string, string> {
  return { 'user-agent': UA };
}

function cikPad(value: string | number): string {
  return String(value).replace(/\D/g, '').padStart(10, '0');
}

function accessionCompact(accession: string): string {
  return accession.replace(/-/g, '');
}

async function resolveCompany(tickerOrCik: string): Promise<{ cik: string; ticker?: string; title?: string }> {
  if (/^\d+$/.test(tickerOrCik.trim())) return { cik: cikPad(tickerOrCik) };
  const data = await fetchJson<Record<string, TickerRecord>>('https://www.sec.gov/files/company_tickers.json', headers());
  const wanted = tickerOrCik.trim().toUpperCase();
  const record = Object.values(data.data).find(item => item.ticker.toUpperCase() === wanted);
  if (!record) throw new Error(`Could not resolve SEC ticker ${tickerOrCik}`);
  return { cik: cikPad(record.cik_str), ticker: record.ticker, title: record.title };
}

async function getSubmission(tickerOrCik: string): Promise<{ resolved: { cik: string; ticker?: string; title?: string }; submission: Submission }> {
  const resolved = await resolveCompany(tickerOrCik);
  const submission = await fetchJson<Submission>(`${DATA}/submissions/CIK${resolved.cik}.json`, headers());
  return { resolved, submission: submission.data };
}

function recentFilings(submission: Submission): Array<Record<string, unknown>> {
  const recent = submission.filings?.recent || {};
  const accessions = recent.accessionNumber || [];
  return accessions.map((accession, index) => {
    const row: Record<string, unknown> = { accessionNumber: accession };
    for (const [key, values] of Object.entries(recent)) row[key] = values[index];
    return row;
  });
}

async function runCompany(_ctx: SiteCommandContext, options: CompanyOptions): Promise<SiteReceipt> {
  const { resolved, submission } = await getSubmission(options.tickerOrCik);
  return siteReceipt(SITE, 'company', {
    query: options.tickerOrCik,
    resolved,
    company: {
      cik: submission.cik,
      name: submission.name,
      tickers: submission.tickers,
      exchanges: submission.exchanges,
    },
    sideEffects: [],
  });
}

async function runFilings(_ctx: SiteCommandContext, options: FilingsOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 100);
  const forms = (options.forms || '').split(',').map(item => item.trim()).filter(Boolean);
  const { resolved, submission } = await getSubmission(options.tickerOrCik);
  const filings = recentFilings(submission).filter(row => forms.length === 0 || forms.includes(String(row.form))).slice(0, limit);
  return siteReceipt(SITE, 'filings', { query: options.tickerOrCik, resolved, forms, count: filings.length, filings, sideEffects: [] });
}

async function runFiling(_ctx: SiteCommandContext, options: FilingOptions): Promise<SiteReceipt> {
  const cik = options.cik ? cikPad(options.cik) : undefined;
  return siteReceipt(SITE, 'filing', {
    accession: options.accession,
    cik,
    archiveUrl: cik ? `${ARCHIVES}/${Number(cik)}/${accessionCompact(options.accession)}/` : undefined,
    sideEffects: [],
  });
}

async function runFacts(_ctx: SiteCommandContext, options: FactsOptions): Promise<SiteReceipt> {
  const { resolved } = await getSubmission(options.tickerOrCik);
  const result = await fetchJson<Record<string, unknown>>(`${DATA}/api/xbrl/companyfacts/CIK${resolved.cik}.json`, headers());
  const facts = result.data.facts as Record<string, Record<string, unknown>> | undefined;
  const usGaap = facts?.['us-gaap'] || {};
  const concept = options.concept;
  return siteReceipt(SITE, 'facts', {
    query: options.tickerOrCik,
    resolved,
    concept,
    entityName: result.data.entityName,
    facts: concept ? (usGaap as Record<string, unknown>)[concept] : Object.keys(usGaap).slice(0, 100),
    sideEffects: [],
  });
}

async function runDownload(_ctx: SiteCommandContext, options: DownloadOptions): Promise<SiteReceipt> {
  if (!options.cik) throw new Error('sec download requires --cik <cik> for the filing accession');
  const cik = cikPad(options.cik);
  const compact = accessionCompact(options.accession);
  const archiveUrl = `${ARCHIVES}/${Number(cik)}/${compact}/`;
  const index = await fetchJson<{ directory?: { item?: Array<{ name: string; type?: string; size?: string }> } }>(`${archiveUrl}index.json`, headers());
  const items = index.data.directory?.item || [];
  if (index.status >= 400 || items.length === 0) {
    return siteReceipt(SITE, 'download', {
      accession: options.accession,
      cik,
      archiveUrl,
      indexStatus: index.status,
      selectedFile: undefined,
      sideEffects: [],
    }, false, [{
      code: 'SEC_ARCHIVE_NOT_FOUND',
      message: `No downloadable SEC archive index was found for accession ${options.accession}. Verify the accession/CIK pair with \`siteflow sec filings <ticker> --forms <form>\` first.`,
    }]);
  }
  const primary = items.find(item => /\.(htm|html|xml|txt)$/i.test(item.name)) || items[0];
  const url = `${archiveUrl}${primary.name}`;
  const downloaded = await downloadFile(url, options.out || 'downloads/sec', `${options.accession}-${primary.name}`, {
    maxBytes: 100 * 1024 * 1024,
    headers: headers(),
  });
  return siteReceipt(SITE, 'download', {
    accession: options.accession,
    cik,
    archiveUrl,
    selectedFile: primary,
    sourceUrl: url,
    ...downloaded,
    sideEffects: ['file_download'],
  });
}

export const secAdapter: SiteAdapter = {
  id: SITE,
  title: 'SEC EDGAR',
  description: 'Read-only SEC EDGAR company, filing, facts, and public filing downloads.',
  commands: [
    { name: 'company', description: 'Collect SEC company metadata by ticker or CIK', configure(command: Command): void {
      command.argument('<ticker-or-cik>').action(async function (tickerOrCik: string) {
        await runSiteCommand(this, ctx => runCompany(ctx, { tickerOrCik }));
      });
    } },
    { name: 'filings', description: 'List recent SEC filings by ticker or CIK', configure(command: Command): void {
      command.argument('<ticker-or-cik>').option('--forms <csv>', 'comma-separated forms such as 10-K,10-Q,8-K').option('--limit <n>', 'number of filings', '20').action(async function (tickerOrCik: string) {
        await runSiteCommand(this, ctx => runFilings(ctx, { ...this.opts<Omit<FilingsOptions, 'tickerOrCik'>>(), tickerOrCik }));
      });
    } },
    { name: 'filing', description: 'Build a SEC filing archive receipt', configure(command: Command): void {
      command.argument('<accession>').option('--cik <cik>', 'company CIK').action(async function (accession: string) {
        await runSiteCommand(this, ctx => runFiling(ctx, { ...this.opts<Omit<FilingOptions, 'accession'>>(), accession }));
      });
    } },
    { name: 'facts', description: 'Collect SEC XBRL company facts', configure(command: Command): void {
      command.argument('<ticker-or-cik>').option('--concept <name>', 'US-GAAP concept name').action(async function (tickerOrCik: string) {
        await runSiteCommand(this, ctx => runFacts(ctx, { ...this.opts<Omit<FactsOptions, 'tickerOrCik'>>(), tickerOrCik }));
      });
    } },
    { name: 'download', description: 'Download one public SEC filing document', configure(command: Command): void {
      command.argument('<accession>').requiredOption('--cik <cik>', 'company CIK').option('--out <dir>', 'output directory').action(async function (accession: string) {
        await runSiteCommand(this, ctx => runDownload(ctx, { ...this.opts<Omit<DownloadOptions, 'accession'>>(), accession }));
      });
    } },
  ],
};
