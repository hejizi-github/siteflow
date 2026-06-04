import type { Command } from 'commander';
import { runSiteCommand, clampInt, evaluateSiteExpression, openSitePage, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'arxiv';
const ORIGIN = 'https://arxiv.org';

interface SearchOptions {
  query: string;
  limit?: string;
}

interface PaperOptions {
  id: string;
}

interface LatestOptions {
  category?: string;
  limit?: string;
}

interface PdfOptions {
  id: string;
  out?: string;
  apply?: boolean;
}

const clampLimit = (value: string | undefined, fallback = 25, max = 100): number => clampInt(value, fallback, 1, max);

function normalizeId(id: string): string {
  return id.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, '').replace(/\.pdf$/, '');
}

function searchPageSize(limit: number): number {
  if (limit <= 25) return 25;
  if (limit <= 50) return 50;
  if (limit <= 100) return 100;
  return 200;
}

async function collectSearch(ctx: SiteCommandContext, query: string, limit: number): Promise<{
  url: string;
  title: string;
  query: string;
  papers: Array<{ id?: string; title: string; authors: string[]; abstract?: string; submitted?: string; absUrl?: string; pdfUrl?: string; subjects?: string[] }>;
}> {
  const url = `${ORIGIN}/search/?query=${encodeURIComponent(query)}&searchtype=all&abstracts=show&order=-announced_date_first&size=${encodeURIComponent(String(searchPageSize(limit)))}`;
  await openSitePage(ctx.profile, url);
  await sleep(1500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const papers = Array.from(document.querySelectorAll('li.arxiv-result')).slice(0, ${JSON.stringify(limit)}).map(item => {
      const title = clean(item.querySelector('.title')?.textContent).replace(/^Title:\\s*/i, '');
      const authors = Array.from(item.querySelectorAll('.authors a')).map(a => clean(a.textContent)).filter(Boolean);
      const abstract = clean(item.querySelector('.abstract-full')?.textContent).replace(/^Abstract:\\s*/i, '').replace(/△ Less$/, '').trim();
      const submitted = clean(item.querySelector('.is-size-7')?.textContent);
      const links = Array.from(item.querySelectorAll('p.list-title a[href]'));
      const absLink = links.find(a => /\\/abs\\//.test(a.getAttribute('href') || ''));
      const pdfLink = links.find(a => /\\/pdf\\//.test(a.getAttribute('href') || ''));
      const absUrl = absLink ? abs(absLink.getAttribute('href') || '') : undefined;
      const id = absUrl ? absUrl.split('/abs/')[1] : undefined;
      const subjects = Array.from(item.querySelectorAll('.tags .tag')).map(tag => clean(tag.textContent)).filter(Boolean);
      return { id, title, authors, abstract, submitted, absUrl, pdfUrl: pdfLink ? abs(pdfLink.getAttribute('href') || '') : undefined, subjects };
    }).filter(paper => paper.title);
    return { url: location.href, title: document.title, query: ${JSON.stringify(query)}, papers };
  })()`);
  return result.value as {
    url: string;
    title: string;
    query: string;
    papers: Array<{ id?: string; title: string; authors: string[]; abstract?: string; submitted?: string; absUrl?: string; pdfUrl?: string; subjects?: string[] }>;
  };
}

async function collectPaper(ctx: SiteCommandContext, id: string): Promise<{
  url: string;
  title: string;
  id: string;
  paperTitle?: string;
  authors: string[];
  abstract?: string;
  subjects?: string[];
  pdfUrl: string;
  sourceUrl: string;
}> {
  const normalized = normalizeId(id);
  await openSitePage(ctx.profile, `${ORIGIN}/abs/${encodeURIComponent(normalized)}`);
  await sleep(1200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const id = ${JSON.stringify(normalized)};
    const title = clean(document.querySelector('h1.title')?.textContent).replace(/^Title:\\s*/i, '');
    const authors = Array.from(document.querySelectorAll('.authors a')).map(a => clean(a.textContent)).filter(Boolean);
    const abstract = clean(document.querySelector('blockquote.abstract')?.textContent).replace(/^Abstract:\\s*/i, '');
    const subjects = clean(document.querySelector('td.tablecell.subjects')?.textContent).split(';').map(s => clean(s)).filter(Boolean);
    return {
      url: location.href,
      title: document.title,
      id,
      paperTitle: title,
      authors,
      abstract,
      subjects,
      pdfUrl: 'https://arxiv.org/pdf/' + id,
      sourceUrl: 'https://arxiv.org/e-print/' + id
    };
  })()`);
  return result.value as { url: string; title: string; id: string; paperTitle?: string; authors: string[]; abstract?: string; subjects?: string[]; pdfUrl: string; sourceUrl: string };
}

async function collectLatest(ctx: SiteCommandContext, category: string, limit: number): Promise<{
  url: string;
  title: string;
  category: string;
  papers: Array<{ id?: string; title: string; authors: string[]; absUrl?: string; pdfUrl?: string }>;
}> {
  const normalized = category || 'cs';
  await openSitePage(ctx.profile, `${ORIGIN}/list/${encodeURIComponent(normalized)}/new`);
  await sleep(1200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const dts = Array.from(document.querySelectorAll('dt'));
    const papers = dts.map(dt => {
      const dd = dt.nextElementSibling;
      const absLink = dt.querySelector('a[title="Abstract"]');
      const pdfLink = dt.querySelector('a[title="Download PDF"]');
      const title = clean(dd?.querySelector('.list-title')?.textContent).replace(/^Title:\\s*/i, '');
      const authors = Array.from(dd?.querySelectorAll('.list-authors a') || []).map(a => clean(a.textContent)).filter(Boolean);
      const absUrl = absLink ? abs(absLink.getAttribute('href') || '') : undefined;
      const id = absUrl ? absUrl.split('/abs/')[1] : undefined;
      return { id, title, authors, absUrl, pdfUrl: pdfLink ? abs(pdfLink.getAttribute('href') || '') : undefined };
    }).filter(paper => paper.title).slice(0, ${JSON.stringify(limit)});
    return { url: location.href, title: document.title, category: ${JSON.stringify(normalized)}, papers };
  })()`);
  return result.value as { url: string; title: string; category: string; papers: Array<{ id?: string; title: string; authors: string[]; absUrl?: string; pdfUrl?: string }> };
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const query = options.query.trim();
  const data = await collectSearch(ctx, query, clampLimit(options.limit));
  return {
    site: SITE,
    command: 'search',
    ok: true,
    state: 'search_collected',
    page: { url: data.url, title: data.title },
    observations: {
      query,
      paperCount: data.papers.length,
      papers: data.papers,
      sideEffects: [],
    },
    next: ['Use siteflow arxiv paper <id> for one paper detail.'],
  };
}

async function runPaper(ctx: SiteCommandContext, options: PaperOptions): Promise<SiteReceipt> {
  const data = await collectPaper(ctx, options.id);
  return {
    site: SITE,
    command: 'paper',
    ok: true,
    state: 'paper_collected',
    page: { url: data.url, title: data.title },
    observations: {
      id: data.id,
      title: data.paperTitle,
      authors: data.authors,
      abstract: data.abstract,
      subjects: data.subjects,
      pdfUrl: data.pdfUrl,
      sourceUrl: data.sourceUrl,
      sideEffects: [],
    },
    next: ['Use siteflow arxiv pdf <id> for a dry-run PDF download plan.'],
  };
}

async function runLatest(ctx: SiteCommandContext, options: LatestOptions): Promise<SiteReceipt> {
  const category = options.category || 'cs';
  const data = await collectLatest(ctx, category, clampLimit(options.limit));
  return {
    site: SITE,
    command: 'latest',
    ok: true,
    state: 'latest_collected',
    page: { url: data.url, title: data.title },
    observations: {
      category,
      paperCount: data.papers.length,
      papers: data.papers,
      sideEffects: [],
    },
    next: ['Use categories such as cs, cs.AI, stat.ML, math, physics.'],
  };
}

async function runPdf(ctx: SiteCommandContext, options: PdfOptions): Promise<SiteReceipt> {
  const id = normalizeId(options.id);
  const pdfUrl = `${ORIGIN}/pdf/${id}`;
  if (options.apply) {
    return {
      site: SITE,
      command: 'pdf',
      ok: false,
      state: 'apply_not_implemented',
      page: { url: pdfUrl, title: `arXiv PDF ${id}` },
      observations: {
        id,
        pdfUrl,
        out: options.out || `${id}.pdf`,
        dryRun: false,
        sideEffects: [],
      },
      errors: [{ code: 'APPLY_NOT_IMPLEMENTED', message: 'PDF file writing is not implemented yet; rerun without --apply for a dry-run URL receipt.' }],
      next: ['Implement file download with size limit and content-type validation before enabling --apply.'],
    };
  }
  return {
    site: SITE,
    command: 'pdf',
    ok: true,
    state: 'pdf_dry_run',
    page: { url: pdfUrl, title: `arXiv PDF ${id}` },
    observations: {
      id,
      pdfUrl,
      out: options.out || `${id}.pdf`,
      dryRun: true,
      willDownload: false,
      note: 'arXiv PDFs are public, but this command currently returns a dry-run plan only.',
      sideEffects: [],
    },
    next: ['Add --apply only after implementing content-type, max-bytes, and destination path validation.'],
  };
}

export const arxivAdapter: SiteAdapter = {
  id: SITE,
  title: 'arXiv',
  description: 'Read-only arXiv search, paper metadata, latest listings, and PDF dry-run planning.',
  commands: [
    {
      name: 'search',
      description: 'Search arXiv papers by query',
      configure(command: Command): void {
        command
          .argument('<query>', 'search query')
          .option('--limit <n>', 'number of papers to return', '25')
          .action(async function (query: string) {
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Pick<SearchOptions, 'limit'>>(), query }));
          });
      },
    },
    {
      name: 'paper',
      description: 'Collect one arXiv paper metadata page',
      configure(command: Command): void {
        command
          .argument('<id>', 'arXiv id or abs/pdf URL')
          .action(async function (id: string) {
            await runSiteCommand(this, ctx => runPaper(ctx, { id }));
          });
      },
    },
    {
      name: 'latest',
      description: 'Collect latest arXiv submissions for a category',
      configure(command: Command): void {
        command
          .option('--category <cat>', 'arXiv category such as cs, cs.AI, stat.ML', 'cs')
          .option('--limit <n>', 'number of papers to return', '25')
          .action(async function () {
            await runSiteCommand(this, ctx => runLatest(ctx, this.opts<LatestOptions>()));
          });
      },
    },
    {
      name: 'pdf',
      description: 'Return a dry-run plan for one public arXiv PDF',
      configure(command: Command): void {
        command
          .argument('<id>', 'arXiv id or abs/pdf URL')
          .option('--out <path>', 'planned output path')
          .option('--apply', 'request file download; not implemented yet')
          .action(async function (id: string) {
            await runSiteCommand(this, ctx => runPdf(ctx, { ...this.opts<Omit<PdfOptions, 'id'>>(), id }));
          });
      },
    },
  ],
};
