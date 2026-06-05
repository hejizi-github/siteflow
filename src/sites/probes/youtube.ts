import { evaluateSiteExpression } from '../capabilities.js';
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
  text?: string;
}

export interface YouTubeComment {
  author: string;
  text: string;
  likes: string;
  time: string;
}

export interface YouTubeVideoDetails {
  url: string;
  title: string;
  video: {
    id?: string;
    title?: string;
    channel?: string;
    description?: string;
    lengthSeconds?: string;
    viewCount?: string;
    publishDate?: string;
    category?: string;
  };
  text: string;
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
      text: text(youtubeSearchRoot, { max: 500 }),
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
      text: stringValue(row.text),
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

export async function youtubeVideoDetails(page: ProbePage): Promise<{ details: YouTubeVideoDetails; evidence: Record<string, unknown> }> {
  const result = normalizeVideoDetails(await evaluateVideoDetails(page));
  return {
    details: result,
    evidence: {
      pageId: page.pageId,
      hasVideoId: Boolean(result.video.id),
    },
  };
}

export async function youtubeScrollToComments(page: ProbePage): Promise<Record<string, unknown>> {
  return {
    ...(await scrollPage(page)),
    pageId: page.pageId,
    scrolled: true,
  };
}

async function evaluateVideoDetails(page: ProbePage): Promise<YouTubeVideoDetails> {
  const evaluate = page.evaluate ?? evaluateSiteExpression;
  const result = await evaluate(
    page.profile,
    `(() => {
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
    })()`,
    page.pageId,
  );
  return unwrapValue(result) as YouTubeVideoDetails;
}

function normalizeVideoDetails(value: unknown): YouTubeVideoDetails {
  const record = isRecord(value) ? value : {};
  const video = isRecord(record.video) ? record.video : {};
  return {
    url: stringValue(record.url),
    title: stringValue(record.title),
    video: {
      id: stringValue(video.id) || undefined,
      title: stringValue(video.title) || undefined,
      channel: stringValue(video.channel) || undefined,
      description: stringValue(video.description) || undefined,
      lengthSeconds: stringValue(video.lengthSeconds) || undefined,
      viewCount: stringValue(video.viewCount) || undefined,
      publishDate: stringValue(video.publishDate) || undefined,
      category: stringValue(video.category) || undefined,
    },
    text: stringValue(record.text),
  };
}

function unwrapValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) return unwrapValue(record.value);
    if ('data' in record) return unwrapValue(record.data);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
