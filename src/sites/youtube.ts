import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { runSiteCommand, addSitePageIdOption, clampInt, openOrNavigateSitePage, siteReceipt, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { defineSiteFlow, flowEvidence } from './flow/define-flow.js';
import { youtubeChannelSummary, youtubeComments, youtubeScrollToComments, youtubeSearchResults, youtubeTranscriptDiscovery, youtubeVideoDetails, type YouTubeChannelSummary, type YouTubeTranscriptDiscovery, type YouTubeTranscriptTrack, type YouTubeVideoDetails } from './probes/youtube.js';
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
  youtubeChannelSummary(page: ProbePage): Promise<{
    summary: YouTubeChannelSummary;
    evidence: Record<string, unknown>;
  }>;
  youtubeTranscriptDiscovery(page: ProbePage): Promise<{
    discovery: YouTubeTranscriptDiscovery;
    evidence: Record<string, unknown>;
  }>;
  fetchCaptionText(url: string): Promise<string>;
  writeTranscriptFile(out: string | undefined, id: string | undefined, text: string): Promise<{
    filePath: string;
    bytes: number;
  }>;
}

const defaultDeps: YouTubeDeps = {
  openOrNavigateSitePage,
  sleep,
  youtubeSearchResults,
  youtubeComments,
  youtubeScrollToComments,
  youtubeVideoDetails,
  youtubeChannelSummary,
  youtubeTranscriptDiscovery,
  fetchCaptionText,
  writeTranscriptFile,
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

function trackScore(track?: YouTubeTranscriptTrack): number {
  return Number(track?.languageCode === 'en') * 10 + Number((track?.name || '').includes('自动生成'));
}

function smallCaptionFetchEvidence(value: CaptionFetchResult): Record<string, unknown> {
  return {
    skipped: value.skipped,
    hasText: Boolean(value.text),
    ...(value.selectedTrack?.languageCode ? { languageCode: value.selectedTrack.languageCode } : {}),
  };
}

function smallTranscriptWriteEvidence(value: TranscriptWriteResult): Record<string, unknown> {
  return {
    wrote: value.wrote,
    ...(value.bytes ? { bytes: value.bytes } : {}),
  };
}

interface CaptionFetchResult {
  text: string;
  selectedTrack?: YouTubeTranscriptTrack;
  lastError: string;
  skipped: boolean;
}

interface TranscriptWriteResult {
  filePath?: string;
  bytes: number;
  wrote: boolean;
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

async function writeTranscriptFile(out: string | undefined, id: string | undefined, text: string): Promise<{ filePath: string; bytes: number }> {
  const outDir = path.resolve(out || 'downloads/youtube');
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `${id || 'youtube-transcript'}.xml`);
  await fs.writeFile(filePath, text, 'utf8');
  return {
    filePath,
    bytes: Buffer.byteLength(text),
  };
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

async function runChannel(ctx: SiteCommandContext, options: TargetOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const target = options.target.startsWith('http') ? options.target : `https://www.youtube.com/${options.target.startsWith('@') ? options.target : `@${options.target}`}`;
  return defineSiteFlow(ctx, SITE, 'channel')
    .step('open_channel_page', async () => {
      const page = await deps.openOrNavigateSitePage(ctx.profile, target, options.pageId);
      return flowEvidence(page, pageEvidence(page));
    })
    .step('wait_for_channel_page', async flow => {
      const page = flow.get<YouTubePageInfo>('open_channel_page');
      const waitedMs = 1800;
      await deps.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('extract_channel_summary', async flow => {
      const page = flow.get<YouTubePageInfo>('open_channel_page');
      const result = await deps.youtubeChannelSummary({ profile: ctx.profile, pageId: page.pageId });
      return flowEvidence(result.summary, result.evidence);
    })
    .receipt(flow => {
      const page = flow.get<YouTubePageInfo>('open_channel_page');
      const summary = flow.get<YouTubeChannelSummary>('extract_channel_summary');
      return siteReceipt(SITE, 'channel', {
        target: options.target,
        pageId: page.pageId,
        ...summary,
        sideEffects: [],
      });
    });
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

async function runTranscript(ctx: SiteCommandContext, options: TranscriptOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const id = videoId(options.target);
  return defineSiteFlow(ctx, SITE, 'transcript')
    .step('open_video_page', async () => {
      const page = await deps.openOrNavigateSitePage(ctx.profile, id ? `https://www.youtube.com/watch?v=${id}` : options.target, options.pageId);
      return flowEvidence(page, pageEvidence(page));
    })
    .step('wait_for_watch_page', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const waitedMs = 1800;
      await deps.sleep(waitedMs);
      return flowEvidence({ pageId: page.pageId, waitedMs }, { pageId: page.pageId, waitedMs });
    })
    .step('discover_caption_tracks', async flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const result = await deps.youtubeTranscriptDiscovery({ profile: ctx.profile, pageId: page.pageId });
      return flowEvidence(result.discovery, result.evidence);
    })
    .step('fetch_caption_text', async flow => {
      const discovery = flow.get<YouTubeTranscriptDiscovery>('discover_caption_tracks');
      const orderedTracks = [...discovery.tracks].sort((a, b) => trackScore(b) - trackScore(a));
      let text = '';
      let selectedTrack = orderedTracks[0];
      let lastError = 'caption fetch returned empty body';
      if (!orderedTracks.length) {
        const value: CaptionFetchResult = { text, selectedTrack, lastError, skipped: true };
        return flowEvidence(value, smallCaptionFetchEvidence(value));
      }
      for (const track of orderedTracks) {
        if (!track?.baseUrl) continue;
        try {
          text = await deps.fetchCaptionText(track.baseUrl);
          selectedTrack = track;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          selectedTrack = track;
        }
      }
      const value: CaptionFetchResult = { text, selectedTrack, lastError, skipped: false };
      return flowEvidence(value, smallCaptionFetchEvidence(value));
    })
    .step('write_transcript_file', async flow => {
      const caption = flow.get<CaptionFetchResult>('fetch_caption_text');
      if (!caption.text) {
        const value: TranscriptWriteResult = { bytes: 0, wrote: false };
        return flowEvidence(value, smallTranscriptWriteEvidence(value));
      }
      const value = {
        ...(await deps.writeTranscriptFile(options.out, id, caption.text)),
        wrote: true,
      };
      return flowEvidence(value, smallTranscriptWriteEvidence(value));
    })
    .receipt(flow => {
      const page = flow.get<YouTubePageInfo>('open_video_page');
      const discovery = flow.get<YouTubeTranscriptDiscovery>('discover_caption_tracks');
      const caption = flow.get<CaptionFetchResult>('fetch_caption_text');
      const written = flow.get<TranscriptWriteResult>('write_transcript_file');
      const selectedTrack = caption.selectedTrack;
      const base = {
        target: options.target,
        id,
        pageId: page.pageId,
        ...discovery,
        ...(selectedTrack ? { selectedTrack } : {}),
      };
      if (!discovery.tracks.length) {
        return siteReceipt(SITE, 'transcript', { ...base, sideEffects: [] }, false, [{ code: 'NO_TRANSCRIPT', message: 'No caption track found on this video.' }]);
      }
      if (!caption.text) {
        const unavailable = discovery.transcriptUnavailableHint || /empty body|fetch failed/i.test(caption.lastError);
        return siteReceipt(SITE, 'transcript', { ...base, sideEffects: [] }, false, [{
          code: unavailable ? 'TRANSCRIPT_UNAVAILABLE' : 'CAPTION_FETCH_FAILED',
          message: unavailable ? 'This YouTube video exposes caption tracks but the transcript body is unavailable from the watch page.' : caption.lastError,
        }]);
      }
      return siteReceipt(SITE, 'transcript', {
        ...base,
        filePath: written.filePath,
        bytes: written.bytes,
        sideEffects: ['file_download'],
      });
    });
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
  runChannel,
  runComments,
  runTranscript,
  deps: defaultDeps,
};
