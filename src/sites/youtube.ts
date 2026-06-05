import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { runSiteCommand, addSitePageIdOption, clampInt, evaluateSiteExpression, openOrNavigateSitePage, siteReceipt, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { defineSiteFlow, flowEvidence } from './flow/define-flow.js';
import { youtubeComments, youtubeScrollToComments, youtubeSearchResults, youtubeVideoDetails, type YouTubeVideoDetails } from './probes/youtube.js';
import type { ProbePage } from './probes/selector-runtime.js';

const SITE = 'youtube';

interface SearchOptions { keyword: string; limit?: string; pageId?: string }
interface TargetOptions { target: string; pageId?: string }
interface CommentsOptions extends TargetOptions { limit?: string }
interface TranscriptOptions extends TargetOptions { out?: string }
interface YouTubePageInfo {
  pageId?: number;
  url: string;
  title: string;
}

interface YouTubeDeps {
  openOrNavigateSitePage(profile: string, url: string, pageIdValue?: string): Promise<YouTubePageInfo>;
  sleep(ms: number): Promise<void>;
  youtubeSearchResults(page: ProbePage, options: { limit: number }): Promise<{
    videos: unknown[];
    evidence: Record<string, unknown>;
  }>;
  youtubeComments(page: ProbePage, options: { limit: number }): Promise<{
    comments: unknown[];
    evidence: Record<string, unknown>;
  }>;
  youtubeScrollToComments(page: ProbePage): Promise<Record<string, unknown>>;
  youtubeVideoDetails(page: ProbePage): Promise<{
    details: YouTubeVideoDetails;
    evidence: Record<string, unknown>;
  }>;
}

const defaultDeps: YouTubeDeps = {
  openOrNavigateSitePage,
  sleep,
  youtubeSearchResults,
  youtubeComments,
  youtubeScrollToComments,
  youtubeVideoDetails,
};

function videoId(target: string): string | undefined {
  return target.match(/[?&]v=([\w-]{6,})/)?.[1] || target.match(/youtu\.be\/([\w-]{6,})/)?.[1] || (/^[\w-]{6,}$/.test(target) ? target : undefined);
}

function pageEvidence(page: YouTubePageInfo): Record<string, unknown> {
  return {
    pageId: page.pageId,
  };
}

function smallScrollEvidence(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof value.pageId === 'number' ? { pageId: value.pageId } : {}),
    ...(typeof value.scrolled === 'boolean' ? { scrolled: value.scrolled } : {}),
  };
}

async function fetchCaptionText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'siteflow-cli/0.1 (+https://example.com)',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`caption fetch returned HTTP ${response.status}`);
  const text = await response.text();
  if (!text) throw new Error('caption fetch returned empty body');
  return text;
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 50);
  return defineSiteFlow(ctx, SITE, 'search')
    .step('open_search_page', async () => {
      const page = await deps.openOrNavigateSitePage(ctx.profile, `https://www.youtube.com/results?search_query=${encodeURIComponent(options.keyword)}`, options.pageId);
      return flowEvidence(page, pageEvidence(page));
    })
    .step('wait_for_search_results', async flow => {
      const page = flow.get<YouTubePageInfo>('open_search_page');
      const waitedMs = 2200;
      await deps.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('extract_search_results', async flow => {
      const page = flow.get<YouTubePageInfo>('open_search_page');
      const result = await deps.youtubeSearchResults({ profile: ctx.profile, pageId: page.pageId }, { limit });
      return flowEvidence({ videos: result.videos }, result.evidence);
    })
    .receipt(flow => {
      const page = flow.get<YouTubePageInfo>('open_search_page');
      const result = flow.get<{ videos: unknown[] }>('extract_search_results');
      return siteReceipt(SITE, 'search', {
        keyword: options.keyword,
        pageId: page.pageId,
        limit,
        url: page.url,
        title: page.title,
        videos: result.videos,
        sideEffects: [],
      });
    });
}

async function runVideo(ctx: SiteCommandContext, options: TargetOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const url = id ? `https://www.youtube.com/watch?v=${id}` : options.target;
  return defineSiteFlow(ctx, SITE, 'video')
    .step('open_video_page', async () => {
      const page = await deps.openOrNavigateSitePage(ctx.profile, url, options.pageId);
      return flowEvidence(page, pageEvidence(page));
    })
    .step('wait_for_watch_page', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const waitedMs = 2200;
      await deps.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('extract_video_details', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const result = await deps.youtubeVideoDetails({ profile: ctx.profile, pageId: page.pageId });
      return flowEvidence(result.details, result.evidence);
    })
    .receipt(flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const details = flow.get<YouTubeVideoDetails>('extract_video_details');
      return siteReceipt(SITE, 'video', {
        target: options.target,
        id,
        pageId: page.pageId,
        ...details,
        sideEffects: [],
      });
    });
}

async function runChannel(ctx: SiteCommandContext, options: TargetOptions): Promise<SiteReceipt> {
  const target = options.target.startsWith('http') ? options.target : `https://www.youtube.com/${options.target.startsWith('@') ? options.target : `@${options.target}`}`;
  const page = await openOrNavigateSitePage(ctx.profile, target, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    return { url: location.href, title: document.title, heading: clean(document.querySelector('h1, yt-page-header-renderer h1')?.textContent), text: clean(document.body.innerText).slice(0, 5000) };
  })()`, page.pageId);
  return siteReceipt(SITE, 'channel', { target: options.target, pageId: page.pageId, ...(result.value as Record<string, unknown>), sideEffects: [] });
}

async function runComments(ctx: SiteCommandContext, options: CommentsOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const limit = clampInt(options.limit, 50, 1, 200);
  return defineSiteFlow(ctx, SITE, 'comments')
    .step('open_video_page', async () => {
      const page = await deps.openOrNavigateSitePage(ctx.profile, id ? `https://www.youtube.com/watch?v=${id}` : options.target, options.pageId);
      return flowEvidence(page, pageEvidence(page));
    })
    .step('wait_for_watch_page', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const waitedMs = 1500;
      await deps.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('scroll_to_comments', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const result = await deps.youtubeScrollToComments({ profile: ctx.profile, pageId: page.pageId });
      await deps.sleep(2500);
      return flowEvidence(result, smallScrollEvidence(result));
    })
    .step('extract_comments', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const result = await deps.youtubeComments({ profile: ctx.profile, pageId: page.pageId }, { limit });
      return flowEvidence({ comments: result.comments }, result.evidence);
    })
    .receipt(flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const result = flow.get<{ comments: unknown[] }>('extract_comments');
      return siteReceipt(SITE, 'comments', {
        target: options.target,
        id,
        pageId: page.pageId,
        limit,
        url: page.url,
        title: page.title,
        comments: result.comments,
        sideEffects: [],
      });
    });
}

async function runTranscript(ctx: SiteCommandContext, options: TranscriptOptions): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const page = await openOrNavigateSitePage(ctx.profile, id ? `https://www.youtube.com/watch?v=${id}` : options.target, options.pageId);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const player = window.ytInitialPlayerResponse;
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const unavailableControl = Array.from(document.querySelectorAll('button,[role="button"]'))
      .find(el => String(el.getAttribute('aria-label') || '').includes('无法显示字幕') || String(el.textContent || '').includes('无法显示字幕'));
    return {
      url: location.href,
      title: document.title,
      tracks: tracks.map(t => ({ name: t.name?.simpleText, languageCode: t.languageCode, baseUrl: t.baseUrl })),
      transcriptUnavailableHint: Boolean(unavailableControl),
    };
  })()`, page.pageId);
  const data = result.value as { url?: string; title?: string; tracks?: Array<{ name?: string; languageCode?: string; baseUrl?: string }>; transcriptUnavailableHint?: boolean };
  const tracks = data.tracks || [];
  if (!tracks.length) {
    return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, sideEffects: [] }, false, [{ code: 'NO_TRANSCRIPT', message: 'No caption track found on this video.' }]);
  }

  const orderedTracks = [...tracks].sort((a, b) => {
    const score = (track?: { languageCode?: string; name?: string }) =>
      Number(track?.languageCode === 'en') * 10 + Number((track?.name || '').includes('自动生成'));
    return score(b) - score(a);
  });

  let text = '';
  let selectedTrack = orderedTracks[0];
  let lastError = 'caption fetch returned empty body';
  for (const track of orderedTracks) {
    if (!track?.baseUrl) continue;
    try {
      text = await fetchCaptionText(track.baseUrl);
      selectedTrack = track;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      selectedTrack = track;
    }
  }

  if (!text) {
    const unavailable = data.transcriptUnavailableHint || /empty body|fetch failed/i.test(lastError);
    return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, selectedTrack, sideEffects: [] }, false, [{
      code: unavailable ? 'TRANSCRIPT_UNAVAILABLE' : 'CAPTION_FETCH_FAILED',
      message: unavailable ? 'This YouTube video exposes caption tracks but the transcript body is unavailable from the watch page.' : lastError,
    }]);
  }
  const outDir = path.resolve(options.out || 'downloads/youtube');
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${id || 'youtube-transcript'}.xml`);
  await fs.writeFile(filePath, text, 'utf8');
  return siteReceipt(SITE, 'transcript', { target: options.target, id, pageId: page.pageId, ...data, selectedTrack, filePath, bytes: Buffer.byteLength(text), sideEffects: ['file_download'] });
}

export const youtubeAdapter: SiteAdapter = {
  id: SITE,
  title: 'YouTube',
  description: 'Read-only YouTube search, video, channel, comments, and transcript extraction.',
  commands: [
    { name: 'search', description: 'Search YouTube videos', configure(command: Command): void {
      addSitePageIdOption(command.argument('<keyword>').option('--limit <n>', 'number of videos', '20')).action(async function (keyword: string) {
        await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Omit<SearchOptions, 'keyword'>>(), keyword }));
      });
    } },
    { name: 'video', description: 'Collect YouTube video page metadata', configure(command: Command): void {
      addSitePageIdOption(command.argument('<target>')).action(async function (target: string) {
        await runSiteCommand(this, ctx => runVideo(ctx, { ...this.opts<Omit<TargetOptions, 'target'>>(), target }));
      });
    } },
    { name: 'channel', description: 'Collect YouTube channel page snapshot', configure(command: Command): void {
      addSitePageIdOption(command.argument('<target>')).action(async function (target: string) {
        await runSiteCommand(this, ctx => runChannel(ctx, { ...this.opts<Omit<TargetOptions, 'target'>>(), target }));
      });
    } },
    { name: 'comments', description: 'Collect visible YouTube comments', configure(command: Command): void {
      addSitePageIdOption(command.argument('<target>').option('--limit <n>', 'number of comments', '50')).action(async function (target: string) {
        await runSiteCommand(this, ctx => runComments(ctx, { ...this.opts<Omit<CommentsOptions, 'target'>>(), target }));
      });
    } },
    { name: 'transcript', description: 'Download available YouTube caption transcript XML', configure(command: Command): void {
      addSitePageIdOption(command.argument('<target>').option('--out <dir>', 'output directory')).action(async function (target: string) {
        await runSiteCommand(this, ctx => runTranscript(ctx, { ...this.opts<Omit<TranscriptOptions, 'target'>>(), target }));
      });
    } },
  ],
};

export const youtubeTesting = {
  runSearch,
  runVideo,
  runComments,
  deps: defaultDeps,
};
