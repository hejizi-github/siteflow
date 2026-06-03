import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { evaluateSiteExpression } from './capabilities.js';
import { sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';
import { addPageIdOption, clampInt, openOrNavigate, siteReceipt } from './http-utils.js';

const SITE = 'youtube';

interface SearchOptions { keyword: string; limit?: string; pageId?: string }
interface TargetOptions { target: string; pageId?: string }
interface CommentsOptions extends TargetOptions { limit?: string }
interface TranscriptOptions extends TargetOptions { out?: string }

function videoId(target: string): string | undefined {
  return target.match(/[?&]v=([\w-]{6,})/)?.[1] || target.match(/youtu\.be\/([\w-]{6,})/)?.[1] || (/^[\w-]{6,}$/.test(target) ? target : undefined);
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 50);
  const page = await openOrNavigate(ctx, `https://www.youtube.com/results?search_query=${encodeURIComponent(options.keyword)}`, options.pageId);
  await sleep(2200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const videos = [];
    const seen = new Set();
    for (const row of Array.from(document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, a#video-title'))) {
      const link = row.matches?.('a#video-title') ? row : row.querySelector?.('a#video-title');
      const href = link?.href;
      const id = href && new URL(href).searchParams.get('v');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      videos.push({ id, title: clean(link.textContent), href, text: clean(row.innerText || row.textContent).slice(0, 500) });
      if (videos.length >= ${JSON.stringify(limit)}) break;
    }
    return { url: location.href, title: document.title, videos };
  })()`);
  return siteReceipt(SITE, 'search', { keyword: options.keyword, pageId: page.pageId, limit, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

async function runVideo(ctx: SiteCommandContext, options: TargetOptions): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const url = id ? `https://www.youtube.com/watch?v=${id}` : options.target;
  const page = await openOrNavigate(ctx, url, options.pageId);
  await sleep(2200);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const player = window.ytInitialPlayerResponse || {};
    const details = player.videoDetails || {};
    const micro = player.microformat?.playerMicroformatRenderer || {};
    return {
      url: location.href,
      title: document.title,
      video: {
        id: details.videoId,
        title: clean(details.title) || clean(document.querySelector('meta[name="title"], meta[property="og:title"]')?.getAttribute('content')) || clean(document.querySelector('h1 yt-formatted-string, h1')?.textContent),
        channel: clean(details.author) || clean(document.querySelector('ytd-channel-name a, #owner a')?.textContent),
        description: clean(details.shortDescription) || clean(document.querySelector('#description-inline-expander, ytd-text-inline-expander')?.innerText).slice(0, 3000),
        lengthSeconds: details.lengthSeconds,
        viewCount: details.viewCount,
        publishDate: micro.publishDate,
        category: micro.category
      },
      text: clean(document.body.innerText).slice(0, 5000)
    };
  })()`);
  return siteReceipt(SITE, 'video', { target: options.target, id, pageId: page.pageId, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

async function runChannel(ctx: SiteCommandContext, options: TargetOptions): Promise<SiteReceipt> {
  const target = options.target.startsWith('http') ? options.target : `https://www.youtube.com/${options.target.startsWith('@') ? options.target : `@${options.target}`}`;
  const page = await openOrNavigate(ctx, target, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return { url: location.href, title: document.title, heading: clean(document.querySelector('h1, yt-page-header-renderer h1')?.textContent), text: clean(document.body.innerText).slice(0, 5000) };
  })()`);
  return siteReceipt(SITE, 'channel', { target: options.target, pageId: page.pageId, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

async function runComments(ctx: SiteCommandContext, options: CommentsOptions): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const limit = clampInt(options.limit, 50, 1, 200);
  const page = await openOrNavigate(ctx, id ? `https://www.youtube.com/watch?v=${id}` : options.target, options.pageId);
  await sleep(1500);
  await evaluateSiteExpression(ctx.profile, `window.scrollTo(0, Math.max(document.body.scrollHeight * 0.65, 1200))`);
  await sleep(2500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      comments: Array.from(document.querySelectorAll('ytd-comment-thread-renderer')).slice(0, ${JSON.stringify(limit)}).map(row => ({
        author: clean(row.querySelector('#author-text')?.textContent),
        text: clean(row.querySelector('#content-text')?.textContent),
        likes: clean(row.querySelector('#vote-count-middle')?.textContent),
        time: clean(row.querySelector('.published-time-text, #published-time-text')?.textContent)
      })).filter(c => c.text)
    };
  })()`);
  return siteReceipt(SITE, 'comments', { target: options.target, id, pageId: page.pageId, limit, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

async function runTranscript(ctx: SiteCommandContext, options: TranscriptOptions): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const page = await openOrNavigate(ctx, id ? `https://www.youtube.com/watch?v=${id}` : options.target, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const player = window.ytInitialPlayerResponse;
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return { url: location.href, title: document.title, tracks: tracks.map(t => ({ name: t.name?.simpleText, languageCode: t.languageCode, baseUrl: t.baseUrl })) };
  })()`);
  const data = result.value as { url?: string; title?: string; tracks?: Array<{ name?: string; languageCode?: string; baseUrl?: string }> };
  const track = data.tracks?.[0];
  if (!track?.baseUrl) {
    return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, sideEffects: [] }, false, [{ code: 'NO_TRANSCRIPT', message: 'No caption track found on this video.' }]);
  }
  let text: string;
  try {
    const response = await fetch(track.baseUrl);
    if (!response.ok) throw new Error(`caption fetch returned HTTP ${response.status}`);
    text = await response.text();
  } catch (error) {
    return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, selectedTrack: track, sideEffects: [] }, false, [{
      code: 'CAPTION_FETCH_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }]);
  }
  const outDir = path.resolve(options.out || 'downloads/youtube');
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${id || 'youtube-transcript'}.xml`);
  await fs.writeFile(filePath, text, 'utf8');
  return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, selectedTrack: track, filePath, bytes: Buffer.byteLength(text), sideEffects: ['file_download'] });
}

export const youtubeAdapter: SiteAdapter = {
  id: SITE,
  title: 'YouTube',
  description: 'Read-only YouTube search, video, channel, comments, and transcript extraction.',
  commands: [
    { name: 'search', description: 'Search YouTube videos', configure(command: Command): void {
      addPageIdOption(command.argument('<keyword>').option('--limit <n>', 'number of videos', '20')).action(async function (keyword: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
      });
    } },
    { name: 'video', description: 'Collect YouTube video page metadata', configure(command: Command): void {
      addPageIdOption(command.argument('<target>')).action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runVideo(ctx, { ...this.opts<Omit<TargetOptions, 'target'>>(), target }));
      });
    } },
    { name: 'channel', description: 'Collect YouTube channel page snapshot', configure(command: Command): void {
      addPageIdOption(command.argument('<target>')).action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runChannel(ctx, { ...this.opts<Omit<TargetOptions, 'target'>>(), target }));
      });
    } },
    { name: 'comments', description: 'Collect visible YouTube comments', configure(command: Command): void {
      addPageIdOption(command.argument('<target>').option('--limit <n>', 'number of comments', '50')).action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runComments(ctx, { ...this.opts<Omit<CommentsOptions, 'target'>>(), target }));
      });
    } },
    { name: 'transcript', description: 'Download available YouTube caption transcript XML', configure(command: Command): void {
      addPageIdOption(command.argument('<target>').option('--out <dir>', 'output directory')).action(async function (target: string) {
        const { runSiteCommand } = await import('./runner.js');
        await runSiteCommand(this, ctx => runTranscript(ctx, { ...this.opts<Omit<TranscriptOptions, 'target'>>(), target }));
      });
    } },
  ],
};
