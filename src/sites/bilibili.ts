import type { Command } from 'commander';
import { runSiteCommand, addSitePageIdOption, clampInt, evaluateSiteExpression, fetchJson, openOrNavigateSitePage, siteReceipt, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'bilibili';
const ORIGIN = 'https://www.bilibili.com';
const API = 'https://api.bilibili.com';
const UA = 'siteflow bilibili read-only adapter';

interface SearchOptions { keyword: string; limit?: string; page?: string; pageId?: string }
interface VideoOptions { target: string }
interface CommentsOptions extends VideoOptions { limit?: string }
interface CreatorOptions { mid: string; pageId?: string }

function bvid(target: string): string {
  const match = target.match(/BV[\w]+/i);
  if (!match) throw new Error('target must contain a Bilibili BV id');
  return match[0];
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 50);
  const pageNum = clampInt(options.page, 1, 1, 50);
  const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(options.keyword)}&page=${pageNum}`;
  const page = await openOrNavigateSitePage(ctx.profile, url, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const seen = new Set();
    const videos = [];
    for (const link of Array.from(document.querySelectorAll('a[href*="/video/BV"]'))) {
      const href = link.href;
      const id = (href.match(/BV[\\w]+/) || [])[0];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const card = link.closest('.bili-video-card, .video-list-item, .video-item, li') || link;
      videos.push({ bvid: id, title: clean(link.textContent) || clean(card.textContent).slice(0, 120), href, text: clean(card.textContent).slice(0, 300) });
      if (videos.length >= ${JSON.stringify(limit)}) break;
    }
    return { url: location.href, title: document.title, videos };
  })()`);
  return siteReceipt(SITE, 'search', { keyword: options.keyword, page: pageNum, pageId: page.pageId, limit, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

function normalizeVideoData(raw: Record<string, unknown>): Record<string, unknown> {
  const data = raw.data as Record<string, unknown> | undefined;
  const owner = data?.owner as Record<string, unknown> | undefined;
  const stat = data?.stat as Record<string, unknown> | undefined;
  return {
    code: raw.code,
    message: raw.message,
    aid: data?.aid,
    bvid: data?.bvid,
    title: data?.title,
    description: data?.desc,
    duration: data?.duration,
    pubdate: data?.pubdate,
    ctime: data?.ctime,
    owner: owner ? { mid: owner.mid, name: owner.name, face: owner.face } : undefined,
    stat: stat ? {
      view: stat.view,
      danmaku: stat.danmaku,
      reply: stat.reply,
      favorite: stat.favorite,
      coin: stat.coin,
      share: stat.share,
      like: stat.like,
    } : undefined,
  };
}

async function runVideo(_ctx: SiteCommandContext, options: VideoOptions): Promise<SiteReceipt> {
  const id = bvid(options.target);
  const result = await fetchJson<Record<string, unknown>>(`${API}/x/web-interface/view?bvid=${encodeURIComponent(id)}`, { 'user-agent': UA, referer: ORIGIN });
  return siteReceipt(SITE, 'video', { target: options.target, bvid: id, httpStatus: result.status, video: normalizeVideoData(result.data), raw: result.data, sideEffects: [] });
}

async function runComments(_ctx: SiteCommandContext, options: CommentsOptions): Promise<SiteReceipt> {
  const id = bvid(options.target);
  const video = await fetchJson<{ data?: { aid?: number } }>(`${API}/x/web-interface/view?bvid=${encodeURIComponent(id)}`, { 'user-agent': UA, referer: ORIGIN });
  const oid = video.data.data?.aid;
  if (!oid) throw new Error(`Could not resolve aid for ${id}`);
  const limit = clampInt(options.limit, 50, 1, 100);
  const result = await fetchJson<Record<string, unknown>>(`${API}/x/v2/reply?type=1&oid=${oid}&sort=2&pn=1&ps=${limit}`, { 'user-agent': UA, referer: `${ORIGIN}/video/${id}` });
  const root = result.data.data as { replies?: Array<Record<string, unknown>>; page?: unknown } | undefined;
  const comments = (root?.replies || []).map(row => {
    const member = row.member as Record<string, unknown> | undefined;
    const content = row.content as Record<string, unknown> | undefined;
    return {
      rpid: row.rpid,
      oid: row.oid,
      mid: row.mid,
      author: member ? { mid: member.mid, name: member.uname } : undefined,
      message: content?.message,
      like: row.like,
      ctime: row.ctime,
      replies: row.rcount,
    };
  });
  return siteReceipt(SITE, 'comments', { target: options.target, bvid: id, aid: oid, limit, httpStatus: result.status, count: comments.length, comments, page: root?.page, raw: result.data, sideEffects: [] });
}

async function runCreator(ctx: SiteCommandContext, options: CreatorOptions): Promise<SiteReceipt> {
  const page = await openOrNavigateSitePage(ctx.profile, `https://space.bilibili.com/${encodeURIComponent(options.mid)}`, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      name: clean(document.querySelector('h1, .nickname, .username')?.textContent),
      text: clean(document.body.innerText).slice(0, 5000),
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map(a => ({ text: clean(a.textContent), href: a.href }))
    };
  })()`);
  return siteReceipt(SITE, 'creator', { mid: options.mid, pageId: page.pageId, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

export const bilibiliAdapter: SiteAdapter = {
  id: SITE,
  title: 'Bilibili',
  description: 'Read-only Bilibili search, video metadata, comments, and creator probes.',
  commands: [
    { name: 'search', description: 'Search Bilibili videos through the rendered page', configure(command: Command): void {
      addSitePageIdOption(command.argument('<keyword>').option('--page <n>', 'page number', '1').option('--limit <n>', 'number of videos', '20')).action(async function (keyword: string) {
        await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
      });
    } },
    { name: 'video', description: 'Collect Bilibili video metadata by BV id or URL', configure(command: Command): void {
      command.argument('<target>').action(async function (target: string) {
        await runSiteCommand(this, ctx => runVideo(ctx, { target }));
      });
    } },
    { name: 'comments', description: 'Collect Bilibili video comments', configure(command: Command): void {
      command.argument('<target>').option('--limit <n>', 'number of comments', '50').action(async function (target: string) {
        await runSiteCommand(this, ctx => runComments(ctx, { ...this.opts<Omit<CommentsOptions, 'target'>>(), target }));
      });
    } },
    { name: 'creator', description: 'Probe Bilibili creator metadata by mid', configure(command: Command): void {
      addSitePageIdOption(command.argument('<mid>')).action(async function (mid: string) {
        await runSiteCommand(this, ctx => runCreator(ctx, { ...this.opts<Omit<CreatorOptions, 'mid'>>(), mid }));
      });
    } },
  ],
};
