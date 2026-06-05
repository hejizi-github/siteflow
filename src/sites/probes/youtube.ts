import { scrollPage } from './common.js';
import { extractList, href, text, type ExtractListResult, type ProbePage } from './selector-runtime.js';

const youtubeSearchRoot = 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title';
const youtubeCommentsRoot = 'ytd-comment-thread-renderer';
const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeProbeOptions {
  limit: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  href: string;
  channel: string;
  metadata: string;
}

export interface YouTubeComment {
  author: string;
  text: string;
  likes: string;
  time: string;
}

export async function youtubeSearchResults(page: ProbePage, options: YouTubeProbeOptions): Promise<{ videos: YouTubeVideo[]; evidence: ExtractListResult['evidence'] & { requestedLimit: number } }> {
  const requestedLimit = normalizeLimit(options.limit);
  const scanLimit = Math.min(Math.max(requestedLimit * 3, requestedLimit), 300);
  const result = await extractList(page, {
    root: youtubeSearchRoot,
    limit: scanLimit,
    required: ['href'],
    fields: {
      title: text('#video-title, a#video-title', { max: 200 }),
      href: href('a#video-title, a[href*="watch"], a[href^="/watch"]'),
      channel: text('ytd-channel-name, #channel-name', { max: 120 }),
      metadata: text('#metadata-line, ytd-video-meta-block', { max: 200 }),
    },
  });
  const seen = new Set<string>();
  const videos: YouTubeVideo[] = [];
  for (const row of result.rows) {
    const hrefValue = stringValue(row.href);
    const id = videoIdFromHref(hrefValue);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    videos.push({
      id,
      title: stringValue(row.title),
      href: hrefValue,
      channel: stringValue(row.channel),
      metadata: stringValue(row.metadata),
    });
  }
  return {
    videos: videos.slice(0, requestedLimit),
    evidence: {
      ...result.evidence,
      requestedLimit,
    },
  };
}

export async function youtubeComments(page: ProbePage, options: YouTubeProbeOptions): Promise<{ comments: YouTubeComment[]; evidence: ExtractListResult['evidence'] }> {
  const result = await extractList(page, {
    root: youtubeCommentsRoot,
    limit: options.limit,
    required: ['text'],
    fields: {
      author: text('#author-text, #author-text span', { max: 120 }),
      text: text('#content-text', { max: 2000 }),
      likes: text('#vote-count-middle', { max: 80 }),
      time: text('.published-time-text, #published-time-text', { max: 120 }),
    },
  });
  return {
    comments: result.rows.map(row => ({
      author: stringValue(row.author),
      text: stringValue(row.text),
      likes: stringValue(row.likes),
      time: stringValue(row.time),
    })),
    evidence: result.evidence,
  };
}

export async function youtubeScrollToComments(page: ProbePage): Promise<Record<string, unknown>> {
  return {
    ...(await scrollPage(page)),
    pageId: page.pageId,
    scrolled: true,
  };
}

function videoIdFromHref(value: string): string | undefined {
  try {
    const url = new URL(value, 'https://www.youtube.com');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname === 'youtu.be') return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
    if (!isYouTubeHost(url.hostname)) return undefined;
    return validVideoId(url.searchParams.get('v') ?? undefined);
  } catch {
    return undefined;
  }
}

function isYouTubeHost(hostname: string): boolean {
  return hostname === 'youtube.com'
    || hostname === 'www.youtube.com'
    || hostname === 'm.youtube.com'
    || hostname.endsWith('.youtube.com');
}

function validVideoId(value: string | undefined): string | undefined {
  return value && youtubeVideoIdPattern.test(value) ? value : undefined;
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), 100);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
