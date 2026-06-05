import type { Command } from 'commander';
import { runSiteCommand, clampInt, evaluateSiteExpression, openSitePage, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'hackernews';
const ORIGIN = 'https://news.ycombinator.com';

interface LimitOptions {
  limit?: string;
}

interface ItemOptions {
  id: string;
}

interface UserOptions {
  id: string;
}

const clampLimit = (value: string | undefined, fallback = 30, max = 100): number => clampInt(value, fallback, 1, max);

async function collectListing(ctx: SiteCommandContext, path: string, limit: number): Promise<{
  url: string;
  title: string;
  items: Array<{
    rank?: number;
    id?: string;
    title: string;
    url?: string;
    sitebit?: string;
    points?: number;
    user?: string;
    age?: string;
    comments?: number;
    itemUrl?: string;
  }>;
  moreUrl?: string;
}> {
  const page = await openSitePage(ctx.profile, `${ORIGIN}/${path}`);
  await sleep(1000);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('tr.athing')).slice(0, ${JSON.stringify(limit)});
    const items = rows.map(row => {
      const sub = row.nextElementSibling;
      const titleLink = row.querySelector('.titleline > a');
      const subtext = sub?.querySelector('.subtext');
      const scoreText = clean(subtext?.querySelector('.score')?.textContent);
      const commentsLink = Array.from(subtext?.querySelectorAll('a') || []).find(a => /comment|discuss/i.test(a.textContent || ''));
      const commentsText = clean(commentsLink?.textContent);
      return {
        rank: Number(clean(row.querySelector('.rank')?.textContent).replace('.', '')) || undefined,
        id: row.getAttribute('id') || undefined,
        title: clean(titleLink?.textContent),
        url: titleLink ? abs(titleLink.getAttribute('href') || '') : undefined,
        sitebit: clean(row.querySelector('.sitebit')?.textContent) || undefined,
        points: scoreText ? Number(scoreText.replace(/\\D+/g, '')) : undefined,
        user: clean(subtext?.querySelector('.hnuser')?.textContent) || undefined,
        age: clean(subtext?.querySelector('.age')?.textContent) || undefined,
        comments: /\\d+/.test(commentsText) ? Number(commentsText.replace(/\\D+/g, '')) : undefined,
        itemUrl: row.getAttribute('id') ? abs('item?id=' + row.getAttribute('id')) : undefined
      };
    }).filter(item => item.title);
    const more = document.querySelector('a.morelink');
    return { url: location.href, title: document.title, items, moreUrl: more ? abs(more.getAttribute('href') || '') : undefined };
  })()`, page.id);
  return result.value as {
    url: string;
    title: string;
    items: Array<{ rank?: number; id?: string; title: string; url?: string; sitebit?: string; points?: number; user?: string; age?: string; comments?: number; itemUrl?: string }>;
    moreUrl?: string;
  };
}

async function collectItem(ctx: SiteCommandContext, id: string): Promise<{
  url: string;
  title: string;
  story?: {
    id?: string;
    title?: string;
    url?: string;
    sitebit?: string;
    points?: number;
    user?: string;
    age?: string;
  };
  comments: Array<{ user?: string; age?: string; text: string; replyUrl?: string }>;
}> {
  const page = await openSitePage(ctx.profile, `${ORIGIN}/item?id=${encodeURIComponent(id)}`);
  await sleep(1000);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const storyRow = document.querySelector('tr.athing');
    const subtext = storyRow?.nextElementSibling?.querySelector('.subtext');
    const titleLink = storyRow?.querySelector('.titleline > a');
    const scoreText = clean(subtext?.querySelector('.score')?.textContent);
    const comments = Array.from(document.querySelectorAll('tr.comtr')).slice(0, 50).map(row => {
      const reply = row.querySelector('.reply a');
      return {
        user: clean(row.querySelector('.hnuser')?.textContent) || undefined,
        age: clean(row.querySelector('.age')?.textContent) || undefined,
        text: clean(row.querySelector('.commtext')?.innerText).slice(0, 2000),
        replyUrl: reply ? abs(reply.getAttribute('href') || '') : undefined
      };
    }).filter(comment => comment.text);
    return {
      url: location.href,
      title: document.title,
      story: storyRow ? {
        id: storyRow.getAttribute('id') || undefined,
        title: clean(titleLink?.textContent),
        url: titleLink ? abs(titleLink.getAttribute('href') || '') : undefined,
        sitebit: clean(storyRow.querySelector('.sitebit')?.textContent) || undefined,
        points: scoreText ? Number(scoreText.replace(/\\D+/g, '')) : undefined,
        user: clean(subtext?.querySelector('.hnuser')?.textContent) || undefined,
        age: clean(subtext?.querySelector('.age')?.textContent) || undefined
      } : undefined,
      comments
    };
  })()`, page.id);
  return result.value as {
    url: string;
    title: string;
    story?: { id?: string; title?: string; url?: string; sitebit?: string; points?: number; user?: string; age?: string };
    comments: Array<{ user?: string; age?: string; text: string; replyUrl?: string }>;
  };
}

async function collectUser(ctx: SiteCommandContext, id: string): Promise<{ url: string; title: string; profile: Record<string, string>; links: Array<{ text: string; url: string }> }> {
  const page = await openSitePage(ctx.profile, `${ORIGIN}/user?id=${encodeURIComponent(id)}`);
  await sleep(1000);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const profile = {};
    const rows = Array.from(document.querySelectorAll('tr'));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) continue;
      const key = clean(cells[0].textContent).replace(/:$/, '');
      const value = clean(cells[1].innerText || cells[1].textContent);
      if (!key || !value) continue;
      if (/^(user|created|karma|about)$/i.test(key)) profile[key] = value;
    }
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ text: clean(a.textContent), url: abs(a.getAttribute('href') || '') }))
      .filter(link => link.text && !['login', 'Hacker News', 'new', 'past', 'comments', 'ask', 'show', 'jobs', 'submit'].includes(link.text));
    return { url: location.href, title: document.title, profile, links };
  })()`, page.id);
  return result.value as { url: string; title: string; profile: Record<string, string>; links: Array<{ text: string; url: string }> };
}

async function runListing(ctx: SiteCommandContext, command: 'frontpage' | 'newest' | 'ask' | 'show' | 'jobs', options: LimitOptions): Promise<SiteReceipt> {
  const paths: Record<typeof command, string> = {
    frontpage: 'news',
    newest: 'newest',
    ask: 'ask',
    show: 'show',
    jobs: 'jobs',
  };
  const data = await collectListing(ctx, paths[command], clampLimit(options.limit));
  return {
    site: SITE,
    command,
    ok: true,
    state: 'listing_collected',
    page: { url: data.url, title: data.title },
    observations: {
      itemCount: data.items.length,
      items: data.items,
      moreUrl: data.moreUrl,
      sideEffects: [],
    },
    next: ['Use siteflow hackernews item <id> to inspect comments for a story.'],
  };
}

async function runItem(ctx: SiteCommandContext, options: ItemOptions): Promise<SiteReceipt> {
  const data = await collectItem(ctx, options.id);
  return {
    site: SITE,
    command: 'item',
    ok: true,
    state: 'item_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requestedId: options.id,
      story: data.story,
      commentCountSampled: data.comments.length,
      comments: data.comments,
      sideEffects: [],
    },
    next: [],
  };
}

async function runUser(ctx: SiteCommandContext, options: UserOptions): Promise<SiteReceipt> {
  const data = await collectUser(ctx, options.id);
  return {
    site: SITE,
    command: 'user',
    ok: true,
    state: 'user_collected',
    page: { url: data.url, title: data.title },
    observations: {
      requestedId: options.id,
      profile: data.profile,
      links: data.links,
      sideEffects: [],
    },
    next: [],
  };
}

export const hackernewsAdapter: SiteAdapter = {
  id: SITE,
  title: 'Hacker News',
  description: 'Read-only Hacker News listings, stories, comments, and public user profiles.',
  commands: [
    ...(['frontpage', 'newest', 'ask', 'show', 'jobs'] as const).map(name => ({
      name,
      description: `Collect Hacker News ${name} listing`,
      configure(command: Command): void {
        command
          .option('--limit <n>', 'number of stories to return', '30')
          .action(async function () {
            await runSiteCommand(this, ctx => runListing(ctx, name, this.opts<LimitOptions>()));
          });
      },
    })),
    {
      name: 'item',
      description: 'Collect one Hacker News story and visible comments',
      configure(command: Command): void {
        command
          .argument('<id>', 'HN item id')
          .action(async function (id: string) {
            await runSiteCommand(this, ctx => runItem(ctx, { id }));
          });
      },
    },
    {
      name: 'user',
      description: 'Collect one public Hacker News user profile',
      configure(command: Command): void {
        command
          .argument('<id>', 'HN username')
          .action(async function (id: string) {
            await runSiteCommand(this, ctx => runUser(ctx, { id }));
          });
      },
    },
  ],
};
