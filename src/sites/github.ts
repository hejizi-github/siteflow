import type { Command } from 'commander';
import { runSiteCommand, addSitePageIdOption, clampInt, evaluateSiteExpression, fetchJson, openOrNavigateSitePage, siteReceipt, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'github';
const API = 'https://api.github.com';
const UA = 'siteflow github read-only adapter';

interface LimitOptions { limit?: string }
interface RepoOptions { repo: string }
interface SearchOptions extends LimitOptions { query: string; sort?: string }
interface TrendingOptions extends LimitOptions { language?: string; since?: string; pageId?: string }
interface IssuesOptions extends RepoOptions, LimitOptions { state?: string }

function ghHeaders(): Record<string, string> {
  return { 'user-agent': UA, accept: 'application/vnd.github+json' };
}

function parseRepo(value: string): { owner: string; repo: string; fullName: string } {
  const trimmed = value.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
  const [owner, repo] = trimmed.split('/');
  if (!owner || !repo) throw new Error('repo must be owner/name or GitHub repo URL');
  return { owner, repo, fullName: `${owner}/${repo}` };
}

async function runTrending(ctx: SiteCommandContext, options: TrendingOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 25, 1, 50);
  const params = new URLSearchParams();
  if (options.language) params.set('spoken_language_code', '');
  if (options.since) params.set('since', options.since);
  const lang = options.language ? `/${encodeURIComponent(options.language)}` : '';
  const url = `https://github.com/trending${lang}${params.toString() ? `?${params}` : ''}`;
  const page = await openOrNavigateSitePage(ctx.profile, url, options.pageId);
  await sleep(1200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      repos: Array.from(document.querySelectorAll('article.Box-row')).slice(0, ${JSON.stringify(limit)}).map(row => {
        const link = row.querySelector('h2 a');
        return {
          name: clean(link?.textContent),
          href: link ? new URL(link.getAttribute('href'), location.href).href : undefined,
          description: clean(row.querySelector('p')?.textContent) || undefined,
          meta: clean(row.innerText)
        };
      })
    };
  })()`, page.pageId);
  return siteReceipt(SITE, 'trending', { pageId: page.pageId, ...(result.value as Record<string, unknown>), limit, sideEffects: [] });
}

function repoSummary(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    fullName: row.full_name,
    private: row.private,
    htmlUrl: row.html_url,
    description: row.description,
    fork: row.fork,
    language: row.language,
    stars: row.stargazers_count,
    forks: row.forks_count,
    openIssues: row.open_issues_count,
    defaultBranch: row.default_branch,
    pushedAt: row.pushed_at,
    updatedAt: row.updated_at,
    owner: (row.owner as Record<string, unknown> | undefined) ? {
      login: (row.owner as Record<string, unknown>).login,
      type: (row.owner as Record<string, unknown>).type,
      htmlUrl: (row.owner as Record<string, unknown>).html_url,
    } : undefined,
  };
}

async function runRepo(_ctx: SiteCommandContext, options: RepoOptions): Promise<SiteReceipt> {
  const repo = parseRepo(options.repo);
  const result = await fetchJson<Record<string, unknown>>(`${API}/repos/${repo.fullName}`, ghHeaders());
  return siteReceipt(SITE, 'repo', { repo: repo.fullName, httpStatus: result.status, repository: repoSummary(result.data), raw: result.data, sideEffects: [] });
}

async function runReleases(_ctx: SiteCommandContext, options: RepoOptions & LimitOptions): Promise<SiteReceipt> {
  const repo = parseRepo(options.repo);
  const limit = clampInt(options.limit, 20, 1, 100);
  const result = await fetchJson<unknown[]>(`${API}/repos/${repo.fullName}/releases?per_page=${limit}`, ghHeaders());
  return siteReceipt(SITE, 'releases', {
    repo: repo.fullName,
    limit,
    httpStatus: result.status,
    releases: result.data.map(item => {
      const row = item as Record<string, unknown>;
      return { id: row.id, tagName: row.tag_name, name: row.name, draft: row.draft, prerelease: row.prerelease, htmlUrl: row.html_url, publishedAt: row.published_at, createdAt: row.created_at };
    }),
    raw: result.data,
    sideEffects: [],
  });
}

async function runIssues(_ctx: SiteCommandContext, options: IssuesOptions): Promise<SiteReceipt> {
  const repo = parseRepo(options.repo);
  const limit = clampInt(options.limit, 30, 1, 100);
  const state = options.state || 'open';
  const result = await fetchJson<unknown[]>(`${API}/repos/${repo.fullName}/issues?state=${encodeURIComponent(state)}&per_page=${limit}`, ghHeaders());
  return siteReceipt(SITE, 'issues', {
    repo: repo.fullName,
    state,
    limit,
    httpStatus: result.status,
    issues: result.data.map(item => {
      const row = item as Record<string, unknown>;
      return { id: row.id, number: row.number, title: row.title, state: row.state, htmlUrl: row.html_url, user: (row.user as Record<string, unknown> | undefined)?.login, comments: row.comments, createdAt: row.created_at, updatedAt: row.updated_at, pullRequest: Boolean(row.pull_request) };
    }),
    raw: result.data,
    sideEffects: [],
  });
}

async function runSearchRepos(_ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 100);
  const sort = options.sort || 'stars';
  const result = await fetchJson<Record<string, unknown>>(`${API}/search/repositories?q=${encodeURIComponent(options.query)}&sort=${encodeURIComponent(sort)}&order=desc&per_page=${limit}`, ghHeaders());
  const items = (result.data.items as Record<string, unknown>[] | undefined) || [];
  return siteReceipt(SITE, 'search-repos', { query: options.query, sort, limit, httpStatus: result.status, totalCount: result.data.total_count, repositories: items.map(repoSummary), raw: result.data, sideEffects: [] });
}

export const githubAdapter: SiteAdapter = {
  id: SITE,
  title: 'GitHub',
  description: 'Read-only GitHub Trending, repository, releases, issues, and repository search.',
  commands: [
    { name: 'trending', description: 'Collect GitHub Trending repositories', configure(command: Command): void {
      addSitePageIdOption(command.option('--language <lang>', 'trending language path').option('--since <daily|weekly|monthly>', 'time range', 'daily').option('--limit <n>', 'number of repos', '25')).action(async function () {
        await runSiteCommand(this, ctx => runTrending(ctx, this.opts<TrendingOptions>()));
      });
    } },
    { name: 'repo', description: 'Collect one GitHub repository', configure(command: Command): void {
      command.argument('<repo>').action(async function (repo: string) {
        await runSiteCommand(this, ctx => runRepo(ctx, { repo }));
      });
    } },
    { name: 'releases', description: 'Collect GitHub releases', configure(command: Command): void {
      command.argument('<repo>').option('--limit <n>', 'number of releases', '20').action(async function (repo: string) {
        await runSiteCommand(this, ctx => runReleases(ctx, { ...this.opts<LimitOptions>(), repo }));
      });
    } },
    { name: 'issues', description: 'Collect GitHub issues', configure(command: Command): void {
      command.argument('<repo>').option('--state <state>', 'open, closed, or all', 'open').option('--limit <n>', 'number of issues', '30').action(async function (repo: string) {
        await runSiteCommand(this, ctx => runIssues(ctx, { ...this.opts<Omit<IssuesOptions, 'repo'>>(), repo }));
      });
    } },
    { name: 'search-repos', description: 'Search GitHub repositories', configure(command: Command): void {
      command.argument('<query>').option('--sort <sort>', 'stars, forks, updated', 'stars').option('--limit <n>', 'number of repos', '20').action(async function (query: string) {
        await runSiteCommand(this, ctx => runSearchRepos(ctx, { ...this.opts<Omit<SearchOptions, 'query'>>(), query }));
      });
    } },
  ],
};
