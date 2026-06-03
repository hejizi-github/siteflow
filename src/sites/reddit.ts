import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';
import { clampInt, siteReceipt } from './http-utils.js';

const SITE = 'reddit';
const ORIGIN = 'https://www.reddit.com';
const UA = 'siteflow reddit read-only adapter';
const execFileAsync = promisify(execFile);

interface SubredditOptions { subreddit: string; sort?: string; limit?: string }
interface SearchOptions { query: string; subreddit?: string; limit?: string }
interface PostOptions { target: string }
interface CommentsOptions extends PostOptions { limit?: string }

function headers(): Record<string, string> {
  return { 'user-agent': UA };
}

type RedditJsonResult<T> =
  | { ok: true; url: string; status: number; data: T }
  | { ok: false; url: string; status: number; code: string; message: string; textExcerpt: string };

function responseExcerpt(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function looksLikeHtml(body: string): boolean {
  return /^\s*</.test(body);
}

function redditBlocked(body: string): boolean {
  return /blocked by network security|developer token|log in to your reddit account/i.test(body);
}

function redditFailure(command: string, result: Extract<RedditJsonResult<unknown>, { ok: false }>): SiteReceipt {
  const state = result.code === 'REDDIT_NETWORK_SECURITY_BLOCKED' ? 'network_security_blocked' : 'invalid_json_response';
  return {
    site: SITE,
    command,
    ok: false,
    state,
    observations: {
      url: result.url,
      httpStatus: result.status,
      textExcerpt: result.textExcerpt,
      sideEffects: [],
    },
    errors: [{ code: result.code, message: result.message }],
    next: result.code === 'REDDIT_NETWORK_SECURITY_BLOCKED'
      ? ['Reddit blocked anonymous JSON access from this network. Use a logged-in/API-token-backed flow before retrying.']
      : ['Inspect the response body; Reddit did not return JSON for this request.'],
  };
}

async function redditJson<T>(url: string): Promise<RedditJsonResult<T>> {
  // Reddit currently resets Node/undici TLS requests in this environment, while curl succeeds.
  const { stdout } = await execFileAsync('curl', ['-sS', '-L', '-A', headers()['user-agent'], '-w', '\n%{http_code}', url], { maxBuffer: 10 * 1024 * 1024 });
  const marker = stdout.lastIndexOf('\n');
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const status = marker >= 0 ? Number(stdout.slice(marker + 1)) : 0;
  if (redditBlocked(body)) {
    return {
      ok: false,
      url,
      status,
      code: 'REDDIT_NETWORK_SECURITY_BLOCKED',
      message: 'Reddit returned a network-security block page instead of JSON.',
      textExcerpt: responseExcerpt(body),
    };
  }
  if (looksLikeHtml(body)) {
    return {
      ok: false,
      url,
      status,
      code: 'REDDIT_HTML_RESPONSE',
      message: 'Reddit returned HTML instead of JSON.',
      textExcerpt: responseExcerpt(body),
    };
  }
  try {
    return { ok: true, url, status, data: JSON.parse(body) as T };
  } catch {
    return {
      ok: false,
      url,
      status,
      code: 'REDDIT_INVALID_JSON_RESPONSE',
      message: 'Reddit returned a non-JSON response.',
      textExcerpt: responseExcerpt(body),
    };
  }
}

function postPath(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('http')) return new URL(trimmed).pathname;
  if (trimmed.startsWith('/r/')) return trimmed;
  return `/comments/${trimmed}/`;
}

function normalizeListing(data: { data?: { children?: Array<{ data: Record<string, unknown> }> } }, limit: number): Array<Record<string, unknown>> {
  return (data.data?.children || []).slice(0, limit).map(child => {
    const row = child.data;
    return {
      id: row.id,
      subreddit: row.subreddit,
      title: row.title,
      author: row.author,
      score: row.score,
      numComments: row.num_comments,
      createdUtc: row.created_utc,
      permalink: row.permalink,
      url: row.url,
      selftext: row.selftext,
      over18: row.over_18,
    };
  });
}

async function runSubreddit(_ctx: SiteCommandContext, options: SubredditOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 25, 1, 100);
  const sort = options.sort || 'hot';
  const result = await redditJson<{ data?: { children?: Array<{ data: Record<string, unknown> }>; after?: string } }>(`${ORIGIN}/r/${encodeURIComponent(options.subreddit)}/${encodeURIComponent(sort)}.json?limit=${limit}`);
  if (!result.ok) return redditFailure('subreddit', result);
  return siteReceipt(SITE, 'subreddit', { subreddit: options.subreddit, sort, limit, httpStatus: result.status, after: result.data.data?.after, posts: normalizeListing(result.data, limit), sideEffects: [] });
}

async function runSearch(_ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 25, 1, 100);
  const base = options.subreddit ? `${ORIGIN}/r/${encodeURIComponent(options.subreddit)}/search.json` : `${ORIGIN}/search.json`;
  const params = new URLSearchParams({ q: options.query, limit: String(limit), restrict_sr: options.subreddit ? '1' : '0' });
  const result = await redditJson<{ data?: { children?: Array<{ data: Record<string, unknown> }>; after?: string } }>(`${base}?${params}`);
  if (!result.ok) return redditFailure('search', result);
  return siteReceipt(SITE, 'search', { query: options.query, subreddit: options.subreddit, limit, httpStatus: result.status, after: result.data.data?.after, posts: normalizeListing(result.data, limit), sideEffects: [] });
}

async function runPost(_ctx: SiteCommandContext, options: PostOptions): Promise<SiteReceipt> {
  const result = await redditJson<Array<{ data?: { children?: Array<{ data: Record<string, unknown> }> } }>>(`${ORIGIN}${postPath(options.target)}.json`);
  if (!result.ok) return redditFailure('post', result);
  const post = result.data[0]?.data?.children?.[0]?.data;
  return siteReceipt(SITE, 'post', { target: options.target, httpStatus: result.status, post, sideEffects: [] });
}

function flattenComments(items: Array<{ kind?: string; data?: Record<string, unknown> }>, limit: number, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  for (const item of items) {
    if (out.length >= limit) break;
    if (item.kind === 't1' && item.data) {
      out.push({
        id: item.data.id,
        author: item.data.author,
        score: item.data.score,
        createdUtc: item.data.created_utc,
        body: item.data.body,
        permalink: item.data.permalink,
      });
      const replies = item.data.replies as { data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> } } | string | undefined;
      if (typeof replies === 'object') flattenComments(replies.data?.children || [], limit, out);
    }
  }
  return out;
}

async function runComments(_ctx: SiteCommandContext, options: CommentsOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 100, 1, 500);
  const result = await redditJson<Array<{ data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> } }>>(`${ORIGIN}${postPath(options.target)}.json?limit=${limit}`);
  if (!result.ok) return redditFailure('comments', result);
  const post = result.data[0]?.data?.children?.[0]?.data;
  const comments = flattenComments(result.data[1]?.data?.children || [], limit);
  return siteReceipt(SITE, 'comments', { target: options.target, httpStatus: result.status, post, count: comments.length, comments, sideEffects: [] });
}

export const redditAdapter: SiteAdapter = {
  id: SITE,
  title: 'Reddit',
  description: 'Read-only Reddit subreddit, search, post, and comments collection.',
  commands: [
    { name: 'subreddit', description: 'Collect subreddit posts', configure(command: Command): void {
      command.argument('<subreddit>').option('--sort <sort>', 'hot, new, top, rising', 'hot').option('--limit <n>', 'number of posts', '25').action(async function (subreddit: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runSubreddit(ctx, { ...this.opts<Omit<SubredditOptions, 'subreddit'>>(), subreddit }));
      });
    } },
    { name: 'search', description: 'Search Reddit posts', configure(command: Command): void {
      command.argument('<query>').option('--subreddit <name>', 'restrict to subreddit').option('--limit <n>', 'number of posts', '25').action(async function (query: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'query'>>(), query }));
      });
    } },
    { name: 'post', description: 'Collect one Reddit post', configure(command: Command): void {
      command.argument('<target>').action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runPost(ctx, { target }));
      });
    } },
    { name: 'comments', description: 'Collect Reddit comments for one post', configure(command: Command): void {
      command.argument('<target>').option('--limit <n>', 'number of comments', '100').action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runComments(ctx, { ...this.opts<Omit<CommentsOptions, 'target'>>(), target }));
      });
    } },
  ],
};
