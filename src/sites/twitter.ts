import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import {
  runSiteCommand,
  addSitePageIdOption,
  captureSiteScreenshot,
  ensureSitePage,
  evaluateInSitePage,
  listSiteNetwork,
  openOrNavigateSitePage,
  readRecentSiteErrors,
  readSiteNetworkPart,
  readSiteSnapshot,
  reloadSitePage,
  replaySiteRequestWithBody,
  replaySiteRequestWithUrl,
  sleep,
} from './capabilities.js';
import type { NetworkEntry } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const twitterDeps = {
  captureSiteScreenshot,
  ensureSitePage,
  evaluateInSitePage,
  openOrNavigateSitePage,
  readRecentSiteErrors,
  readSiteSnapshot,
  sleep,
};

interface TwitterStatusOptions {
  url?: string;
  pageId?: string;
  screenshot?: string;
}

interface TwitterCollectOptions {
  url?: string;
  pageId?: string;
  limit: string;
  screenshot?: string;
  wait: string;
  scrollPages?: string;
  scrollDelay?: string;
  out?: string;
}

interface TwitterSearchOptions {
  query: string;
  pageId?: string;
  limit: string;
  screenshot?: string;
  wait: string;
  scrollPages?: string;
  scrollDelay?: string;
  out?: string;
}

interface TweetRecord {
  index: number;
  text: string;
  author?: string;
  handle?: string;
  statusUrl?: string;
  tweetId?: string;
  hrefs: string[];
  time?: string;
}

interface TwitterApiCaptureOptions {
  limit: string;
  match: string;
  out?: string;
}

interface TwitterDetailOptions {
  url: string;
  pageId?: string;
  out?: string;
  wait: string;
  limit: string;
  match: string;
}

interface TwitterHomeCheckpointOptions {
  out?: string;
  pageId?: string;
  wait: string;
  limit: string;
  reload?: boolean;
  open?: boolean;
}

interface TwitterHomeDiffOptions extends TwitterHomeCheckpointOptions {
  before: string;
}

interface TwitterHomePageOptions {
  checkpoint: string;
  cursor: string;
  out?: string;
  count: string;
  delayMs: string;
}

interface TwitterProfilePageOptions {
  checkpoint: string;
  cursor: string;
  out?: string;
  count: string;
  delayMs: string;
}

interface TwitterProfileCheckpointOptions {
  handle: string;
  pageId?: string;
  out?: string;
  wait: string;
  limit: string;
  replies?: boolean;
}

interface TwitterProfileDiffOptions extends TwitterProfileCheckpointOptions {
  before: string;
}

interface TwitterMediaListOptions {
  fromDump: string;
  tweetId?: string;
  type?: string;
  out?: string;
}

interface TwitterMediaDownloadOptions {
  fromMediaList: string;
  dir: string;
  apply?: boolean;
  tweetId?: string;
  type?: string;
  prefer: string;
  maxBitrate?: string;
  limit: string;
  maxBytes: string;
}

interface XHomeOptions {
  pages: string;
  pageId?: string;
  out?: string;
  dir?: string;
  wait: string;
  pageDelayMs: string;
  count: string;
  reload?: boolean;
}

interface XProfileOptions {
  handle: string;
  pages: string;
  pageId?: string;
  out?: string;
  dir?: string;
  wait: string;
  pageDelayMs: string;
  count: string;
  replies?: boolean;
}

interface XTweetOptions {
  url: string;
  pageId?: string;
  out?: string;
  dir?: string;
  wait: string;
}

interface XDownloadOptions extends XTweetOptions {
  mediaDir?: string;
  prefer: string;
  maxBytes: string;
  limit: string;
  apply?: boolean;
}

interface XMoreOptions {
  pages: string;
  delayMs: string;
  limit: string;
  networkLimit: string;
  out?: string;
  dir?: string;
}

interface ApiTweetRecord {
  id?: string;
  text?: string;
  textSource?: string;
  possiblyTruncated?: boolean;
  url?: string;
  kind?: 'original' | 'reply' | 'quote' | 'retweet';
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  inReplyToScreenName?: string;
  quotedStatusId?: string;
  retweetedStatusId?: string;
  repostedByName?: string;
  repostedByHandle?: string;
  authorName?: string;
  handle?: string;
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  favoriteCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  viewCount?: string;
  sourceNetworkId: number;
  sourceUrl: string;
}

interface TwitterHomeCheckpoint {
  site: 'twitter';
  mode: 'home-checkpoint';
  collectedAt: string;
  endpoint?: {
    id: number;
    method: string;
    status?: number;
    url: string;
    bytes?: number;
    startedAt: string;
  };
  request?: {
    requestContext?: string;
    cursor?: string;
    count?: number;
    seenTweetIds?: string[];
  };
  requestBody?: string;
  tweets: ApiTweetRecord[];
  cursors: Array<{ cursorType?: string; value: string; sourceNetworkId: number }>;
  media: TwitterMediaResource[];
  parseErrors: Array<{ id: number; message: string }>;
}

interface TwitterProfileCheckpoint {
  site: 'twitter';
  mode: 'profile-checkpoint';
  handle: string;
  collectedAt: string;
  endpoint?: {
    id: number;
    method: string;
    status?: number;
    url: string;
    bytes?: number;
    startedAt: string;
  };
  request?: {
    userId?: string;
    cursor?: string;
    count?: number;
  };
  requestBody?: string;
  tweets: ApiTweetRecord[];
  cursors: Array<{ cursorType?: string; value: string; sourceNetworkId: number }>;
  media: TwitterMediaResource[];
  parseErrors: Array<{ id: number; message: string }>;
}

interface TwitterMediaResource {
  type: string;
  tweetId?: string;
  expandedUrl?: string;
  mediaUrl?: string;
  previewUrl?: string;
  tcoUrl?: string;
  width?: number;
  height?: number;
  durationMillis?: number;
  variants?: Array<{
    url: string;
    contentType?: string;
    bitrate?: number;
  }>;
  sourceFile: string;
}

interface TimelinePageData {
  status: number;
  statusText?: string;
  tweets: ApiTweetRecord[];
  cursors: Array<{ cursorType?: string; value: string; sourceNetworkId: number }>;
  media: TwitterMediaResource[];
  parseErrors: Array<{ id: number; message: string }>;
  cursor: {
    requested: string;
    value: string;
  };
}

interface TweetDetailData {
  mainTweet?: ApiTweetRecord;
  replies: ApiTweetRecord[];
  tweets: ApiTweetRecord[];
  media: TwitterMediaResource[];
  mainMedia: TwitterMediaResource[];
  replyMedia: TwitterMediaResource[];
  unassignedMedia: TwitterMediaResource[];
  repliesWithMedia: Array<{ tweet: ApiTweetRecord; media: TwitterMediaResource[] }>;
  cursors: Array<{ cursorType?: string; value: string; sourceNetworkId: number }>;
  endpoints: Array<{ id: number; method: string; status?: number; url: string; bytes?: number; contentType?: string }>;
  errors: Array<{ id: number; message: string }>;
  targetId?: string;
  waitMs: number;
  match: string;
  scannedNetworkLimit: number;
}

function isAuthRequired(page: { url: string; text: string }): boolean {
  return page.url.includes('/login')
    || page.url.includes('/i/flow/login')
    || page.text.includes('Sign in to X')
    || page.text.includes('登录 X')
    || page.text.includes('Log in to X')
    || page.text.includes('Create your account');
}

async function visibleTweets(profile: string, limit: number, deps = twitterDeps): Promise<TweetRecord[]> {
  const result = await deps.evaluateInSitePage<TweetRecord[]>(profile, `Array.from(document.querySelectorAll('article')).slice(0, ${JSON.stringify(limit)}).map((article, index) => {
    const text = article.innerText.trim();
    const links = Array.from(article.querySelectorAll('a')).map(a => a.href).filter(Boolean);
    const timeEl = article.querySelector('time');
    const authorLink = Array.from(article.querySelectorAll('a')).find(a => /\\/status\\//.test(a.href));
    const statusHref = authorLink ? authorLink.href : '';
    const statusMatch = statusHref.match(/(?:x|twitter)\\.com\\/([^/]+)\\/status\\/(\\d+)/);
    const lines = text.split('\\n').map(line => line.trim()).filter(Boolean);
    return {
      index,
      text,
      author: lines[0] || undefined,
      handle: statusMatch ? '@' + statusMatch[1] : undefined,
      statusUrl: statusHref || undefined,
      tweetId: statusMatch ? statusMatch[2] : undefined,
      hrefs: Array.from(new Set(links)),
      time: timeEl ? timeEl.getAttribute('datetime') : undefined,
    };
  })`);
  return Array.isArray(result) ? result as TweetRecord[] : [];
}

async function visibleLinks(profile: string, limit: number, deps = twitterDeps): Promise<Array<{ text: string; href: string }>> {
  const result = await deps.evaluateInSitePage<Array<{ text: string; href: string }>>(profile, `Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(a => a.href).slice(0, ${JSON.stringify(limit)})`);
  return Array.isArray(result) ? result as Array<{ text: string; href: string }> : [];
}

function writeJson(out: string | undefined, data: unknown): string | undefined {
  if (!out) return undefined;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  return out;
}

function fileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function dateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function defaultXDir(optionsDir?: string): string {
  return optionsDir || path.join('campaigns', 'siteflow-x', dateStamp());
}

function defaultXOut(optionsDir: string | undefined, name: string, out?: string): string {
  return out || path.join(defaultXDir(optionsDir), `${name}-${fileTimestamp()}.json`);
}

function boundedInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function mergeTweets(...groups: ApiTweetRecord[][]): ApiTweetRecord[] {
  const tweets = new Map<string, ApiTweetRecord>();
  for (const group of groups) {
    for (const tweet of group) {
      tweets.set(tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`, tweet);
    }
  }
  return Array.from(tweets.values());
}

function mergeMedia(...groups: TwitterMediaResource[][]): TwitterMediaResource[] {
  const media = new Map<string, TwitterMediaResource>();
  for (const group of groups) {
    for (const item of group) {
      media.set(mediaKey(item), item);
    }
  }
  return Array.from(media.values());
}

function chooseBottomCursor(cursors: Array<{ cursorType?: string; value: string }>): string | undefined {
  return cursors.find(item => item.cursorType?.toLowerCase() === 'bottom')?.value
    || cursors.find(item => item.value)?.value;
}

function tweetSummary(tweet: ApiTweetRecord | TweetRecord | undefined): Record<string, unknown> | undefined {
  if (!tweet) return undefined;
  const apiTweet = tweet as ApiTweetRecord;
  const domTweet = tweet as TweetRecord;
  return {
    id: apiTweet.id || domTweet.tweetId,
    url: apiTweet.url || domTweet.statusUrl,
    author: apiTweet.authorName || domTweet.author,
    handle: apiTweet.handle || domTweet.handle,
    createdAt: apiTweet.createdAt || domTweet.time,
    text: (apiTweet.text || domTweet.text || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    textSource: apiTweet.textSource,
    possiblyTruncated: apiTweet.possiblyTruncated,
    metrics: {
      replies: apiTweet.replyCount,
      retweets: apiTweet.retweetCount,
      likes: apiTweet.favoriteCount,
      quotes: apiTweet.quoteCount,
      bookmarks: apiTweet.bookmarkCount,
      views: apiTweet.viewCount,
    },
  };
}

function tweetSummaries(tweets: Array<ApiTweetRecord | TweetRecord>, limit = 5): Array<Record<string, unknown>> {
  return tweets.slice(0, limit).map(tweet => tweetSummary(tweet)).filter((tweet): tweet is Record<string, unknown> => Boolean(tweet));
}

function mediaByType(media: TwitterMediaResource[]): Record<string, number> {
  return media.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

function mediaSummaries(media: TwitterMediaResource[], limit = 5): Array<Record<string, unknown>> {
  return media.slice(0, limit).map(item => ({
    type: item.type,
    tweetId: item.tweetId,
    mediaUrl: item.mediaUrl,
    previewUrl: item.previewUrl,
    expandedUrl: item.expandedUrl,
    width: item.width,
    height: item.height,
    durationMillis: item.durationMillis,
    variants: item.variants?.map(variant => ({
      contentType: variant.contentType,
      bitrate: variant.bitrate,
      url: variant.url,
    })).slice(0, 5) || [],
  }));
}

function mediaForTweet(media: TwitterMediaResource[], tweetId: string | undefined): TwitterMediaResource[] {
  if (!tweetId) return [];
  return media.filter(item => item.tweetId === tweetId);
}

function statusUrlFromMedia(media: TwitterMediaResource[]): string | undefined {
  for (const item of media) {
    const url = item.expandedUrl;
    if (!url) continue;
    const match = url.match(/^(https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+)/);
    if (match) return match[1].replace('twitter.com', 'x.com');
  }
  return undefined;
}

function statusUrlForTweet(tweet: ApiTweetRecord, media: TwitterMediaResource[]): string | undefined {
  if (tweet.url) return tweet.url;
  const fromMedia = statusUrlFromMedia(media);
  if (fromMedia) return fromMedia;
  const handle = tweet.handle?.replace(/^@/, '');
  return tweet.id && handle ? `https://x.com/${handle}/status/${tweet.id}` : undefined;
}

function tweetItems(tweets: ApiTweetRecord[], media: TwitterMediaResource[]): Array<Record<string, unknown>> {
  return tweets.map(tweet => {
    const itemMedia = mediaForTweet(media, tweet.id);
    return {
      id: tweet.id,
      url: statusUrlForTweet(tweet, itemMedia),
      author: tweet.authorName,
      handle: tweet.handle,
      createdAt: tweet.createdAt,
      text: tweet.text,
      textSource: tweet.textSource,
      possiblyTruncated: tweet.possiblyTruncated,
      kind: tweet.kind,
      conversationId: tweet.conversationId,
      inReplyToStatusId: tweet.inReplyToStatusId,
      inReplyToScreenName: tweet.inReplyToScreenName,
      quotedStatusId: tweet.quotedStatusId,
      retweetedStatusId: tweet.retweetedStatusId,
      repostedByName: tweet.repostedByName,
      repostedByHandle: tweet.repostedByHandle,
      metrics: {
        replies: tweet.replyCount,
        retweets: tweet.retweetCount,
        likes: tweet.favoriteCount,
        quotes: tweet.quoteCount,
        bookmarks: tweet.bookmarkCount,
        views: tweet.viewCount,
      },
      media: itemMedia,
      mediaCount: itemMedia.length,
      mediaByType: mediaByType(itemMedia),
    };
  });
}

function profileThreads(tweets: ApiTweetRecord[], media: TwitterMediaResource[]): Array<Record<string, unknown>> {
  const items = tweetItems(tweets, media);
  const itemById = new Map(items.map(item => [String(item.id || ''), item]));
  const recordsById = new Map(tweets.map(tweet => [tweet.id || '', tweet]));
  const groups = new Map<string, {
    root?: Record<string, unknown>;
    replies: Record<string, unknown>[];
    quotes: Record<string, unknown>[];
    retweets: Record<string, unknown>[];
    related: Record<string, unknown>[];
  }>();
  const ensureGroup = (id: string) => {
    if (!groups.has(id)) groups.set(id, { replies: [], quotes: [], retweets: [], related: [] });
    return groups.get(id)!;
  };

  for (const tweet of tweets) {
    const item = itemById.get(tweet.id || '');
    if (!item) continue;
    const groupId = tweet.conversationId || tweet.inReplyToStatusId || tweet.id || 'unknown';
    const group = ensureGroup(groupId);
    if (tweet.kind === 'reply') group.replies.push(item);
    else if (tweet.kind === 'quote') {
      if (tweet.id === groupId) group.root = item;
      else group.quotes.push(item);
    } else if (tweet.kind === 'retweet') {
      if (tweet.id === groupId) group.root = item;
      else group.retweets.push(item);
    } else if (tweet.id === groupId || !group.root) group.root = item;
    else group.related.push(item);
  }

  return Array.from(groups.entries()).map(([conversationId, group]) => {
    const rootRecord = recordsById.get(conversationId);
    return {
      conversationId,
      root: group.root || {
        id: conversationId,
        url: rootRecord?.url,
        text: rootRecord?.text,
        missingFromPage: true,
      },
      replies: group.replies,
      quotes: group.quotes,
      retweets: group.retweets,
      related: group.related,
      counts: {
        replies: group.replies.length,
        quotes: group.quotes.length,
        retweets: group.retweets.length,
        related: group.related.length,
      },
    };
  });
}

function orderItemsByVisibleTweets(items: Array<Record<string, unknown>>, visible: TweetRecord[]): Array<Record<string, unknown>> {
  const byId = new Map(items.map(item => [String(item.id || ''), item]));
  const used = new Set<string>();
  const ordered: Array<Record<string, unknown>> = [];
  for (const tweet of visible) {
    const id = tweet.tweetId;
    if (!id || used.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    ordered.push(item);
    used.add(id);
  }
  for (const item of items) {
    const id = String(item.id || '');
    if (id && used.has(id)) continue;
    ordered.push(item);
    if (id) used.add(id);
  }
  return ordered;
}

function layeredOutput(command: string, summary: Record<string, unknown>, data: Record<string, unknown>, raw: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    site: 'twitter',
    command,
    collectedAt: new Date().toISOString(),
    summary,
    data,
    raw,
  };
}

function withLayeredObservations(
  base: Record<string, unknown>,
  summary: Record<string, unknown>,
  data: Record<string, unknown>,
  raw: Record<string, unknown> = {},
): Record<string, unknown> {
  const compactBase: Record<string, unknown> = {};
  for (const key of ['outputPath', 'handle', 'replies', 'status', 'statusText', 'tweetCount', 'cursorCount', 'mediaCount', 'downloaded', 'requested', 'counts', 'byType']) {
    if (key in base) compactBase[key] = base[key];
  }
  const compactData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      compactData[key] = {
        count: value.length,
        sample: key === 'repliesWithMedia'
          ? value.slice(0, 5).map(item => {
            const object = asObject(item);
            const tweet = asObject(object?.tweet) as ApiTweetRecord | undefined;
            const media = Array.isArray(object?.media) ? object.media as TwitterMediaResource[] : [];
            return { tweet: tweetSummary(tweet), media: mediaSummaries(media, 5) };
          })
          : key.toLowerCase().includes('media')
          ? mediaSummaries(value as TwitterMediaResource[], 5)
          : key.toLowerCase().includes('tweet') || key.toLowerCase().includes('repl')
          ? tweetSummaries(value as Array<ApiTweetRecord | TweetRecord>, 5)
          : value.slice(0, 5),
      };
    } else if (key.toLowerCase().includes('tweet') && asObject(value)) {
      compactData[key] = tweetSummary(value as ApiTweetRecord);
    } else if (key === 'checkpoint' && asObject(value)) {
      const checkpoint = value as { tweets?: ApiTweetRecord[]; cursors?: unknown[]; handle?: string };
      compactData[key] = {
        handle: checkpoint.handle,
        tweetCount: checkpoint.tweets?.length || 0,
        cursorCount: checkpoint.cursors?.length || 0,
      };
    } else if (key === 'endpoint' && asObject(value)) {
      const endpoint = value as { id?: number; method?: string; status?: number; bytes?: number; startedAt?: string };
      compactData[key] = {
        id: endpoint.id,
        method: endpoint.method,
        status: endpoint.status,
        bytes: endpoint.bytes,
        startedAt: endpoint.startedAt,
      };
    } else if (key === 'replay' && asObject(value)) {
      const replay = value as { status?: number; statusText?: string; body?: { bytes?: number; encoding?: string; truncated?: boolean } };
      compactData[key] = {
        status: replay.status,
        statusText: replay.statusText,
        body: replay.body ? { bytes: replay.body.bytes, encoding: replay.body.encoding, truncated: replay.body.truncated } : undefined,
      };
    } else {
      compactData[key] = value;
    }
  }
  const compactRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) compactRaw[key] = { count: value.length, sample: value.slice(0, 5) };
    else if (key === 'endpoint' && asObject(value)) compactRaw[key] = value;
    else if (key === 'endpoints' && Array.isArray(value)) compactRaw[key] = { count: value.length, sample: value.slice(0, 5) };
    else if (key === 'parseErrors') compactRaw[key] = value;
    else if (['request', 'cursor', 'match', 'scannedNetworkLimit', 'detailUrl', 'waitMs', 'fromDump', 'fromMediaList', 'errors'].includes(key)) compactRaw[key] = value;
  }
  return {
    summary,
    data: compactData,
    raw: compactRaw,
    ...compactBase,
  };
}

function tweetKey(tweet: TweetRecord): string {
  return tweet.tweetId || tweet.statusUrl || `${tweet.time || ''}:${tweet.text.slice(0, 160)}`;
}

function dedupeTweets(tweets: TweetRecord[]): TweetRecord[] {
  const seen = new Map<string, TweetRecord>();
  for (const tweet of tweets) {
    const key = tweetKey(tweet);
    if (!seen.has(key)) seen.set(key, tweet);
  }
  return Array.from(seen.values()).map((tweet, index) => ({ ...tweet, index }));
}

async function collectVisibleTweetsWithScroll(
  profile: string,
  limit: number,
  scrollPages: number,
  scrollDelayMs: number,
  deps = twitterDeps,
): Promise<TweetRecord[]> {
  const all: TweetRecord[] = [];
  all.push(...await visibleTweets(profile, limit, deps));
  for (let i = 0; i < scrollPages; i += 1) {
    await deps.evaluateInSitePage(profile, 'window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 1.6))); true');
    await deps.sleep(scrollDelayMs);
    all.push(...await visibleTweets(profile, limit, deps));
  }
  return dedupeTweets(all).slice(0, limit);
}

function decodeNetworkBody(body: { encoding: 'utf8' | 'base64'; body: string }): string {
  return body.encoding === 'base64' ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function normalizeApiTweet(result: Record<string, unknown>, source: NetworkEntry): ApiTweetRecord | undefined {
  const legacy = asObject(result.legacy);
  const userResult = asObject(asObject(asObject(result.core)?.user_results)?.result);
  const userLegacy = asObject(userResult?.legacy);
  const views = asObject(result.views);
  const id = typeof result.rest_id === 'string' ? result.rest_id : undefined;
  const handle = typeof userLegacy?.screen_name === 'string' ? `@${userLegacy.screen_name}` : undefined;
  const retweetedStatusResult = asObject(asObject(result.legacy)?.retweeted_status_result) || asObject(result.retweeted_status_result);
  const retweetedStatus = asObject(retweetedStatusResult?.result);
  if (retweetedStatus) {
    const retweetedTweet = normalizeApiTweet(retweetedStatus, source);
    if (retweetedTweet) {
      return {
        ...retweetedTweet,
        kind: 'retweet',
        retweetedStatusId: retweetedTweet.id,
        repostedByName: typeof userLegacy?.name === 'string' ? userLegacy.name : undefined,
        repostedByHandle: handle,
      };
    }
  }
  const noteTweetResult = asObject(asObject(asObject(result.note_tweet)?.note_tweet_results)?.result);
  const noteText = typeof noteTweetResult?.text === 'string' ? noteTweetResult.text : undefined;
  const legacyText = typeof legacy?.full_text === 'string' ? legacy.full_text : undefined;
  const text = noteText || legacyText;
  if (!text) return undefined;
  const normalizedHandle = handle?.replace(/^@/, '');
  const legacyTruncated = typeof legacy?.truncated === 'boolean' ? legacy.truncated : false;
  const textLooksTruncated = /…\s*$/.test(text) || /\.\.\.\s*$/.test(text);
  const inReplyToStatusId = typeof legacy?.in_reply_to_status_id_str === 'string' ? legacy.in_reply_to_status_id_str : undefined;
  const quotedStatusId = typeof legacy?.quoted_status_id_str === 'string' ? legacy.quoted_status_id_str : undefined;
  const kind = inReplyToStatusId ? 'reply' : quotedStatusId ? 'quote' : 'original';
  return {
    id,
    text,
    textSource: noteText ? 'note_tweet' : 'legacy.full_text',
    possiblyTruncated: Boolean(!noteText && (legacyTruncated || textLooksTruncated)),
    kind,
    conversationId: typeof legacy?.conversation_id_str === 'string' ? legacy.conversation_id_str : id,
    inReplyToStatusId,
    inReplyToUserId: typeof legacy?.in_reply_to_user_id_str === 'string' ? legacy.in_reply_to_user_id_str : undefined,
    inReplyToScreenName: typeof legacy?.in_reply_to_screen_name === 'string' ? `@${legacy.in_reply_to_screen_name}` : undefined,
    quotedStatusId,
    authorName: typeof userLegacy?.name === 'string' ? userLegacy.name : undefined,
    handle,
    url: id && normalizedHandle ? `https://x.com/${normalizedHandle}/status/${id}` : undefined,
    createdAt: typeof legacy?.created_at === 'string' ? legacy.created_at : undefined,
    replyCount: asNumber(legacy?.reply_count),
    retweetCount: asNumber(legacy?.retweet_count),
    favoriteCount: asNumber(legacy?.favorite_count),
    quoteCount: asNumber(legacy?.quote_count),
    bookmarkCount: asNumber(legacy?.bookmark_count),
    viewCount: typeof views?.count === 'string' ? views.count : undefined,
    sourceNetworkId: source.id,
    sourceUrl: source.url,
  };
}

function extractApiTweets(payload: unknown, source: NetworkEntry): ApiTweetRecord[] {
  const timelineTweets = extractTimelineTweets(payload, source);
  if (timelineTweets.length > 0) return timelineTweets;
  const tweets = new Map<string, ApiTweetRecord>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = asObject(current);
    if (!object) continue;
    const direct = normalizeApiTweet(object, source);
    if (direct) tweets.set(direct.id || `${direct.sourceNetworkId}:${direct.text || ''}`, direct);
    const tweetResults = asObject(asObject(object.tweet_results)?.result);
    if (tweetResults) {
      const tweet = normalizeApiTweet(tweetResults, source);
      if (tweet) tweets.set(tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`, tweet);
    }
    for (const value of Object.values(object)) stack.push(value);
  }
  return Array.from(tweets.values());
}

function extractTimelineTweets(payload: unknown, source: NetworkEntry): ApiTweetRecord[] {
  const ordered: ApiTweetRecord[] = [];
  const seen = new Set<string>();
  const pushTweet = (value: unknown) => {
    const tweetResult = asObject(asObject(asObject(value)?.tweet_results)?.result) || asObject(value);
    if (!tweetResult) return;
    const tweet = normalizeApiTweet(tweetResult, source);
    if (!tweet) return;
    const key = tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(tweet);
  };

  const visitContent = (content: unknown) => {
    const object = asObject(content);
    if (!object) return;
    const itemContent = asObject(object.itemContent);
    const tweetDisplayType = asString(itemContent?.tweetDisplayType);
    if (tweetDisplayType === 'Tweet' || asObject(itemContent?.tweet_results)) pushTweet(itemContent);
    for (const item of asArray(object.items)) {
      const nestedContent = asObject(asObject(item)?.item)?.itemContent || asObject(item)?.itemContent;
      const nestedType = asString(asObject(nestedContent)?.tweetDisplayType);
      if (nestedType === 'Tweet' || asObject(asObject(nestedContent)?.tweet_results)) pushTweet(nestedContent);
    }
  };

  const visitInstructions = (instructions: unknown[]) => {
    for (const instruction of instructions) {
      const object = asObject(instruction);
      if (!object) continue;
      for (const entry of asArray(object.entries)) visitContent(asObject(entry)?.content);
      visitContent(asObject(object.entry)?.content);
    }
  };

  const stack: unknown[] = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = asObject(current);
    if (!object) continue;
    if (Array.isArray(object.instructions)) visitInstructions(object.instructions);
    for (const value of Object.values(object)) stack.push(value);
  }
  return ordered;
}

function extractCursors(payload: unknown): Array<{ cursorType?: string; value: string }> {
  const cursors = new Map<string, { cursorType?: string; value: string }>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = asObject(current);
    if (!object) continue;
    const value = typeof object.value === 'string' ? object.value : undefined;
    const cursorType = typeof object.cursorType === 'string' ? object.cursorType : undefined;
    if (value && (cursorType || value.length > 60)) cursors.set(`${cursorType || 'unknown'}:${value}`, { cursorType, value });
    for (const child of Object.values(object)) stack.push(child);
  }
  return Array.from(cursors.values());
}

function extractHomeRequest(bodyText: string | undefined): TwitterHomeCheckpoint['request'] | undefined {
  if (!bodyText) return undefined;
  try {
    const payload = JSON.parse(bodyText) as { variables?: Record<string, unknown> };
    const variables = asObject(payload.variables);
    if (!variables) return undefined;
    const seenTweetIds = Array.isArray(variables.seenTweetIds)
      ? variables.seenTweetIds.filter((item): item is string => typeof item === 'string')
      : undefined;
    return {
      requestContext: asString(variables.requestContext),
      cursor: asString(variables.cursor),
      count: asNumber(variables.count),
      seenTweetIds,
    };
  } catch {
    return undefined;
  }
}

function chooseCheckpointCursor(checkpoint: TwitterHomeCheckpoint, cursor: string): string | undefined {
  const normalized = cursor.toLowerCase();
  if (normalized === 'top' || normalized === 'bottom') {
    return checkpoint.cursors.find(item => item.cursorType?.toLowerCase() === normalized)?.value;
  }
  return cursor;
}

function buildHomeReplayBody(checkpoint: TwitterHomeCheckpoint, cursor: string, count: number): string {
  if (!checkpoint.requestBody) throw new Error('checkpoint does not contain requestBody; create a new home-checkpoint first');
  const payload = JSON.parse(checkpoint.requestBody) as { variables?: Record<string, unknown> };
  const variables = asObject(payload.variables);
  if (!variables) throw new Error('checkpoint requestBody does not contain variables');
  variables.cursor = cursor;
  variables.count = count;
  variables.seenTweetIds = Array.from(tweetIdSet(checkpoint.tweets)).filter(id => /^\d+$/.test(id));
  delete variables.requestContext;
  payload.variables = variables;
  return JSON.stringify(payload);
}

function latestHomeTimeline(entries: NetworkEntry[]): NetworkEntry | undefined {
  return entries
    .filter(entry => /\/HomeTimeline(?:\?|$)/.test(entry.url) && entry.responseBody?.available)
    .sort((a, b) => b.id - a.id)[0];
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim();
}

function latestProfileTimeline(entries: NetworkEntry[], includeReplies: boolean): NetworkEntry | undefined {
  const matcher = includeReplies
    ? /\/UserTweetsAndReplies(?:\?|$)/
    : /\/UserTweets(?:\?|$)/;
  return entries
    .filter(entry => matcher.test(entry.url) && entry.responseBody?.available)
    .sort((a, b) => b.id - a.id)[0];
}

function extractProfileRequest(bodyText: string | undefined): TwitterProfileCheckpoint['request'] | undefined {
  if (!bodyText) return undefined;
  try {
    const payload = JSON.parse(bodyText) as { variables?: Record<string, unknown> };
    const variables = asObject(payload.variables);
    if (!variables) return undefined;
    return {
      userId: asString(variables.userId),
      cursor: asString(variables.cursor),
      count: asNumber(variables.count),
    };
  } catch {
    return undefined;
  }
}

function extractProfileRequestFromUrl(urlText: string | undefined): TwitterProfileCheckpoint['request'] | undefined {
  if (!urlText) return undefined;
  try {
    const url = new URL(urlText);
    const variablesText = url.searchParams.get('variables');
    if (!variablesText) return undefined;
    const variables = asObject(JSON.parse(variablesText));
    if (!variables) return undefined;
    return {
      userId: asString(variables.userId),
      cursor: asString(variables.cursor),
      count: asNumber(variables.count),
    };
  } catch {
    return undefined;
  }
}

function buildProfileReplayUrl(checkpoint: TwitterProfileCheckpoint, cursor: string, count: number): string {
  if (!checkpoint.endpoint?.url) throw new Error('checkpoint does not contain a UserTweets endpoint');
  const url = new URL(checkpoint.endpoint.url);
  const variablesText = url.searchParams.get('variables');
  if (!variablesText) throw new Error('checkpoint endpoint URL does not contain variables');
  const variables = asObject(JSON.parse(variablesText));
  if (!variables) throw new Error('checkpoint endpoint URL variables are invalid');
  variables.cursor = cursor;
  variables.count = count;
  url.searchParams.set('variables', JSON.stringify(variables));
  return url.toString();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mediaKey(media: TwitterMediaResource): string {
  return [
    media.type,
    media.tweetId || '',
    media.mediaUrl || '',
    media.expandedUrl || '',
    media.variants?.map(variant => variant.url).join('|') || '',
  ].join('::');
}

function sanitizeFilePart(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || fallback;
}

function extensionFromUrlOrType(url: string, contentType?: string): string {
  const cleanUrl = url.split('?')[0];
  const extMatch = cleanUrl.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch) return extMatch[1].toLowerCase();
  if (contentType?.includes('mp4')) return 'mp4';
  if (contentType?.includes('mpegURL')) return 'm3u8';
  if (contentType?.includes('jpeg')) return 'jpg';
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  return 'bin';
}

function chooseMediaDownload(media: TwitterMediaResource, prefer: string, maxBitrate?: number): {
  url?: string;
  contentType?: string;
  bitrate?: number;
  label: string;
} {
  if (media.type === 'video' || media.type === 'animated_gif') {
    const variants = media.variants || [];
    if (prefer === 'hls') {
      const hls = variants.find(variant => variant.contentType === 'application/x-mpegURL');
      if (hls) return { url: hls.url, contentType: hls.contentType, label: 'hls' };
    }
    const mp4s = variants
      .filter(variant => variant.contentType === 'video/mp4')
      .filter(variant => maxBitrate === undefined || (variant.bitrate || 0) <= maxBitrate)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (mp4s[0]) return { url: mp4s[0].url, contentType: mp4s[0].contentType, bitrate: mp4s[0].bitrate, label: `mp4-${mp4s[0].bitrate || 'unknown'}` };
    const fallback = variants.find(variant => variant.url);
    if (fallback) return { url: fallback.url, contentType: fallback.contentType, bitrate: fallback.bitrate, label: 'variant' };
  }
  if (prefer === 'preview' && media.previewUrl) return { url: media.previewUrl, label: 'preview' };
  return { url: media.mediaUrl || media.previewUrl, label: media.type };
}

async function downloadUrl(url: string, outFile: string, maxBytes: number): Promise<{ bytes: number; contentType?: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`);
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`download skipped: content-length ${contentLength} exceeds max ${maxBytes}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > maxBytes) {
    throw new Error(`download skipped: body ${buffer.byteLength} exceeds max ${maxBytes}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buffer, { mode: 0o600 });
  return { bytes: buffer.byteLength, contentType: response.headers.get('content-type') || undefined };
}

function normalizeMediaObject(object: Record<string, unknown>, sourceFile: string): TwitterMediaResource | undefined {
  const mediaUrl = asString(object.media_url_https) || asString(object.media_url);
  const videoInfo = asObject(object.video_info);
  const expandedUrl = asString(object.expanded_url);
  const type = asString(object.type) || (videoInfo ? 'video' : mediaUrl ? 'photo' : undefined);
  if (!type || (!mediaUrl && !videoInfo && !expandedUrl)) return undefined;
  const tweetMatch = expandedUrl?.match(/status\/(\d+)/);
  const variants = asArray(videoInfo?.variants)
    .map(variant => asObject(variant))
    .filter((variant): variant is Record<string, unknown> => Boolean(variant))
    .map(variant => ({
      url: asString(variant.url) || '',
      contentType: asString(variant.content_type),
      bitrate: asNumber(variant.bitrate),
    }))
    .filter(variant => variant.url);
  const sizes = asObject(object.sizes);
  const large = asObject(sizes?.large) || asObject(sizes?.medium) || asObject(sizes?.small) || asObject(sizes?.thumb);
  return {
    type,
    tweetId: tweetMatch?.[1],
    expandedUrl,
    mediaUrl,
    previewUrl: mediaUrl,
    tcoUrl: asString(object.url),
    width: asNumber(large?.w),
    height: asNumber(large?.h),
    durationMillis: asNumber(videoInfo?.duration_millis),
    ...(variants.length ? { variants } : {}),
    sourceFile,
  };
}

function extractMediaResources(payload: unknown, sourceFile: string): TwitterMediaResource[] {
  const media = new Map<string, TwitterMediaResource>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const object = asObject(current);
    if (!object) continue;
    const normalized = normalizeMediaObject(object, sourceFile);
    if (normalized) media.set(mediaKey(normalized), normalized);
    for (const value of Object.values(object)) stack.push(value);
  }
  return Array.from(media.values());
}

function resolveDumpManifest(input: string): { manifestPath: string; dumpDir: string } {
  const stat = fs.statSync(input);
  const manifestPath = stat.isDirectory() ? path.join(input, 'manifest.json') : input;
  return { manifestPath, dumpDir: path.dirname(manifestPath) };
}

async function runMediaList(_ctx: SiteCommandContext, options: TwitterMediaListOptions): Promise<SiteReceipt> {
  const { manifestPath, dumpDir } = resolveDumpManifest(options.fromDump);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    entries?: Array<{ bodies?: Record<string, { path?: string }> }>;
  };
  const resources = new Map<string, TwitterMediaResource>();
  const errors: Array<{ file: string; message: string }> = [];
  for (const entry of manifest.entries || []) {
    for (const bodyInfo of Object.values(entry.bodies || {})) {
      if (!bodyInfo?.path || !bodyInfo.path.endsWith('.json')) continue;
      const file = path.join(dumpDir, bodyInfo.path);
      try {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const media of extractMediaResources(payload, path.relative(dumpDir, file))) {
          resources.set(mediaKey(media), media);
        }
      } catch (error) {
        errors.push({ file, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const typeMatcher = options.type ? new RegExp(options.type, 'i') : undefined;
  const media = Array.from(resources.values())
    .filter(item => !options.tweetId || item.tweetId === options.tweetId)
    .filter(item => !typeMatcher || typeMatcher.test(item.type));
  const byType = media.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const data = {
    media,
    counts: { media: media.length, byType, errors: errors.length },
  };
  const summary = {
    title: 'Twitter/X media resources',
    fromDump: manifestPath,
    tweetId: options.tweetId,
    type: options.type,
    counts: data.counts,
    sample: media.slice(0, 5).map(item => ({ type: item.type, tweetId: item.tweetId, mediaUrl: item.mediaUrl, variants: item.variants?.length || 0 })),
  };
  const raw = { fromDump: manifestPath, errors };
  const outputPath = writeJson(options.out, layeredOutput('media-list', summary, data, raw));
  return {
    site: 'twitter',
    command: 'media-list',
    ok: errors.length === 0,
    state: 'media_listed',
    observations: withLayeredObservations({
      fromDump: manifestPath,
      tweetId: options.tweetId,
      type: options.type,
      outputPath,
      mediaCount: media.length,
      byType,
      sample: media.slice(0, 10),
      errors,
    }, summary, data, raw),
  };
}

async function runMediaDownload(_ctx: SiteCommandContext, options: TwitterMediaDownloadOptions): Promise<SiteReceipt> {
  const payload = JSON.parse(fs.readFileSync(options.fromMediaList, 'utf8')) as { media?: TwitterMediaResource[]; data?: { media?: TwitterMediaResource[] } };
  const typeMatcher = options.type ? new RegExp(options.type, 'i') : undefined;
  const limit = Number.parseInt(options.limit, 10);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 20;
  const maxBytes = Number.parseInt(options.maxBytes, 10);
  const boundedMaxBytes = Number.isFinite(maxBytes) ? Math.max(1, maxBytes) : 200_000_000;
  const maxBitrate = options.maxBitrate ? Number.parseInt(options.maxBitrate, 10) : undefined;
  const media = (payload.data?.media || payload.media || [])
    .filter(item => !options.tweetId || item.tweetId === options.tweetId)
    .filter(item => !typeMatcher || typeMatcher.test(item.type))
    .slice(0, boundedLimit);
  const outDir = path.resolve(options.dir);
  const downloads: Array<Record<string, unknown>> = [];
  const errors: Array<{ tweetId?: string; url?: string; message: string }> = [];

  for (const [index, item] of media.entries()) {
    const selected = chooseMediaDownload(item, options.prefer, Number.isFinite(maxBitrate) ? maxBitrate : undefined);
    if (!selected.url) {
      errors.push({ tweetId: item.tweetId, message: 'no downloadable url found' });
      continue;
    }
    const ext = extensionFromUrlOrType(selected.url, selected.contentType);
    const fileName = `${sanitizeFilePart(item.tweetId, 'unknown')}-${String(index + 1).padStart(2, '0')}-${sanitizeFilePart(item.type, 'media')}-${sanitizeFilePart(selected.label, 'asset')}.${ext}`;
    const outFile = path.join(outDir, fileName);
    const record: Record<string, unknown> = {
      tweetId: item.tweetId,
      type: item.type,
      sourceUrl: selected.url,
      expandedUrl: item.expandedUrl,
      prefer: options.prefer,
      bitrate: selected.bitrate,
      outFile,
      applied: Boolean(options.apply),
    };
    if (options.apply) {
      try {
        const result = await downloadUrl(selected.url, outFile, boundedMaxBytes);
        record.bytes = result.bytes;
        record.contentType = result.contentType || selected.contentType;
      } catch (error) {
        errors.push({ tweetId: item.tweetId, url: selected.url, message: error instanceof Error ? error.message : String(error) });
        record.error = errors[errors.length - 1].message;
      }
    }
    downloads.push(record);
  }

  const downloaded = downloads.filter(item => item.applied && !item.error).length;
  const data = { downloads };
  const summary = {
    title: options.apply ? 'Twitter/X media downloaded' : 'Twitter/X media download dry run',
    fromMediaList: options.fromMediaList,
    outDir,
    apply: Boolean(options.apply),
    requested: media.length,
    downloaded,
    errors: errors.length,
  };
  const raw = { fromMediaList: options.fromMediaList, prefer: options.prefer, maxBytes: boundedMaxBytes, errors };
  return {
    site: 'twitter',
    command: 'media-download',
    ok: errors.length === 0,
    state: options.apply ? 'media_downloaded' : 'media_download_dry_run',
    observations: withLayeredObservations({
      fromMediaList: options.fromMediaList,
      outDir,
      apply: Boolean(options.apply),
      requested: media.length,
      downloaded,
      downloads,
      errors,
    }, summary, data, raw),
    next: options.apply ? undefined : ['Rerun with --apply to download files.'],
  };
}

async function runStatus(ctx: SiteCommandContext, options: TwitterStatusOptions, deps = twitterDeps): Promise<SiteReceipt> {
  const screenshots: string[] = [];
  if (options.pageId || options.url) {
    await deps.openOrNavigateSitePage(ctx.profile, options.url || 'https://x.com/explore', options.pageId);
  } else {
    await deps.ensureSitePage(ctx.profile, 'https://x.com/explore', 'x.com');
  }
  await deps.sleep(3000);
  const shot = await deps.captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);
  const page = await deps.readSiteSnapshot(ctx.profile);
  const errors = await deps.readRecentSiteErrors(ctx.profile, 20);
  const visibleTweetCount = (await visibleTweets(ctx.profile, 20, deps)).length;
  const summary = {
    title: 'Twitter/X page status',
    state: isAuthRequired(page) ? 'auth_required' : 'observed',
    url: page.url,
    visibleTweetCount,
    recentErrorCount: errors.length,
  };
  const data = { page: { url: page.url, title: page.title }, visibleTweetCount };
  const raw = { textExcerpt: page.text.slice(0, 2500), readRecentSiteErrors: errors.slice(-8) };
  return {
    site: 'twitter',
    command: 'status',
    ok: true,
    state: isAuthRequired(page) ? 'auth_required' : 'observed',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: withLayeredObservations({
      textExcerpt: page.text.slice(0, 2500),
      visibleTweetCount,
      readRecentSiteErrors: errors.slice(-8),
    }, summary, data, raw),
    next: isAuthRequired(page) ? ['Log in in the visible browser, then rerun siteflow twitter status or collect.'] : undefined,
  };
}

async function runCollect(ctx: SiteCommandContext, options: TwitterCollectOptions, deps = twitterDeps): Promise<SiteReceipt> {
  const screenshots: string[] = [];
  if (options.url || options.pageId) {
    await deps.openOrNavigateSitePage(ctx.profile, options.url || 'https://x.com/explore', options.pageId);
  } else {
    await deps.ensureSitePage(ctx.profile, 'https://x.com/explore', 'x.com');
  }
  const waitMs = Number.parseInt(options.wait, 10);
  await deps.sleep(Number.isFinite(waitMs) ? waitMs : 5000);
  const page = await deps.readSiteSnapshot(ctx.profile);
  const limit = Number.parseInt(options.limit, 10);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
  const scrollPages = Number.parseInt(options.scrollPages || '0', 10);
  const boundedScrollPages = Number.isFinite(scrollPages) ? Math.max(0, Math.min(scrollPages, 20)) : 0;
  const scrollDelay = Number.parseInt(options.scrollDelay || '1500', 10);
  const boundedScrollDelay = Number.isFinite(scrollDelay) ? Math.max(250, Math.min(scrollDelay, 10_000)) : 1500;
  const tweets = await collectVisibleTweetsWithScroll(ctx.profile, boundedLimit, boundedScrollPages, boundedScrollDelay, deps);
  const shot = await deps.captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);
  const links = await visibleLinks(ctx.profile, 100, deps);
  const authRequired = isAuthRequired(page);
  const summary = {
    title: 'Twitter/X visible page collection',
    url: page.url,
    requestedLimit: boundedLimit,
    scrollPages: boundedScrollPages,
    tweetCount: tweets.length,
    sample: tweetSummaries(tweets, 5),
  };
  const data = { page: { url: page.url, title: page.title }, tweets, links };
  const raw = { requestedLimit: boundedLimit, scrollPages: boundedScrollPages, screenshots, textExcerpt: page.text.slice(0, 2000) };
  const outputPath = writeJson(options.out, layeredOutput('collect', summary, data, raw));
  return {
    site: 'twitter',
    command: 'collect',
    ok: !authRequired,
    state: authRequired ? 'auth_required' : 'collected_visible_data',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: withLayeredObservations({
      requestedLimit: boundedLimit,
      tweets,
      links,
      outputPath,
      textExcerpt: page.text.slice(0, 2000),
    }, summary, data, raw),
    errors: authRequired ? [{ code: 'TWITTER_AUTH_REQUIRED', message: 'X/Twitter requires login before visible timeline data can be collected.' }] : undefined,
    next: authRequired ? ['Log in in the visible browser, then rerun siteflow twitter collect.'] : ['Scroll or navigate, then rerun collect to capture more visible data.'],
  };
}

async function runSearch(ctx: SiteCommandContext, options: TwitterSearchOptions): Promise<SiteReceipt> {
  const query = encodeURIComponent(options.query);
  const url = `https://x.com/search?q=${query}&src=typed_query&f=live`;
  return runCollect(ctx, {
    url,
    limit: options.limit,
    screenshot: options.screenshot,
    wait: options.wait,
    scrollPages: options.scrollPages,
    scrollDelay: options.scrollDelay,
    out: options.out,
    pageId: options.pageId,
  });
}

async function captureApiData(ctx: SiteCommandContext, options: TwitterApiCaptureOptions): Promise<{
  boundedLimit: number;
  entries: NetworkEntry[];
  endpoints: Array<{ id: number; method: string; status?: number; url: string; bytes?: number; contentType?: string }>;
  tweets: ApiTweetRecord[];
  cursors: Array<{ cursorType?: string; value: string; sourceNetworkId: number }>;
  media: TwitterMediaResource[];
  errors: Array<{ id: number; message: string }>;
}> {
  const limit = Number.parseInt(options.limit, 10);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 2000)) : 500;
  const matcher = new RegExp(options.match || 'HomeTimeline|SearchTimeline|UserTweets|TweetDetail|graphql', 'i');
  const entries = (await listSiteNetwork(ctx.profile, boundedLimit))
    .filter(entry => matcher.test(entry.url) && entry.responseBody?.available);
  const tweets = new Map<string, ApiTweetRecord>();
  const cursors = new Map<string, { cursorType?: string; value: string; sourceNetworkId: number }>();
  const media = new Map<string, TwitterMediaResource>();
  const endpoints: Array<{ id: number; method: string; status?: number; url: string; bytes?: number; contentType?: string }> = [];
  const errors: Array<{ id: number; message: string }> = [];

  for (const entry of entries) {
    endpoints.push({
      id: entry.id,
      method: entry.method,
      status: entry.status,
      url: entry.url,
      bytes: entry.responseBody?.bytes,
      contentType: entry.contentType,
    });
    try {
      const body = await readSiteNetworkPart(ctx.profile, entry.id, 'response');
      const payload = JSON.parse(decodeNetworkBody(body));
      for (const tweet of extractApiTweets(payload, entry)) {
        tweets.set(tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`, tweet);
      }
      for (const cursor of extractCursors(payload)) {
        cursors.set(`${cursor.cursorType || 'unknown'}:${cursor.value}`, { ...cursor, sourceNetworkId: entry.id });
      }
      for (const item of extractMediaResources(payload, `network:${entry.id}`)) {
        media.set(mediaKey(item), item);
      }
    } catch (error) {
      errors.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    boundedLimit,
    entries,
    endpoints,
    tweets: Array.from(tweets.values()),
    cursors: Array.from(cursors.values()),
    media: Array.from(media.values()),
    errors,
  };
}

async function runApiCapture(ctx: SiteCommandContext, options: TwitterApiCaptureOptions): Promise<SiteReceipt> {
  const captured = await captureApiData(ctx, options);

  const data = {
    tweets: captured.tweets,
    cursors: captured.cursors,
    media: captured.media,
  };
  const byType = mediaByType(captured.media);
  const summary = {
    title: 'Twitter/X GraphQL capture',
    match: options.match,
    endpointCount: captured.endpoints.length,
    tweetCount: data.tweets.length,
    cursorCount: data.cursors.length,
    mediaCount: data.media.length,
    mediaByType: byType,
    mediaSample: mediaSummaries(data.media, 5),
    sample: tweetSummaries(data.tweets, 5),
  };
  const raw = {
    match: options.match,
    scannedNetworkLimit: captured.boundedLimit,
    endpoints: captured.endpoints,
    parseErrors: captured.errors,
  };
  const outputPath = writeJson(options.out, layeredOutput('api-capture', summary, data, raw));
  return {
    site: 'twitter',
    command: 'api-capture',
    ok: captured.errors.length < captured.entries.length,
    state: captured.entries.length ? 'api_captured' : 'no_matching_api_response',
    observations: withLayeredObservations({
      match: options.match,
      scannedNetworkLimit: captured.boundedLimit,
      endpointCount: captured.endpoints.length,
      tweetCount: data.tweets.length,
      cursorCount: data.cursors.length,
      mediaCount: data.media.length,
      byType,
      outputPath,
      parseErrors: captured.errors,
    }, summary, data, raw),
    next: captured.entries.length
      ? ['Use captured Bottom cursor evidence to design a replay/pagination command after request replay is verified.']
      : ['Navigate or scroll X first, then rerun api-capture.'],
  };
}

async function captureTweetDetail(ctx: SiteCommandContext, options: TwitterDetailOptions): Promise<TweetDetailData> {
  await openOrNavigateSitePage(ctx.profile, options.url, options.pageId);
  const waitMs = Number.parseInt(options.wait, 10);
  const boundedWaitMs = Number.isFinite(waitMs) ? Math.max(1000, Math.min(waitMs, 30_000)) : 8000;
  await sleep(boundedWaitMs);
  const match = options.match || 'TweetDetail|TweetResultByRestId|graphql';
  const captured = await captureApiData(ctx, {
    limit: options.limit,
    match,
  });
  const tweets = captured.tweets;
  const media = captured.media;
  const targetId = options.url.match(/\/status\/(\d+)/)?.[1];
  const mainTweet = tweets.find(tweet => tweet.id === targetId) || tweets[0];
  const replies = tweets.filter(tweet => tweet.id && tweet.id !== mainTweet?.id);
  const mainMedia = mainTweet?.id ? media.filter(item => item.tweetId === mainTweet.id) : [];
  const replyIds = new Set(replies.map(tweet => tweet.id).filter((id): id is string => Boolean(id)));
  const replyMedia = media.filter(item => item.tweetId && replyIds.has(item.tweetId));
  const unassignedMedia = media.filter(item => !item.tweetId);
  const targetMedia = [...mainMedia, ...replyMedia, ...unassignedMedia];
  const byType = mediaByType(targetMedia);
  const repliesWithMedia = replies
    .map(reply => ({
      tweet: reply,
      media: reply.id ? replyMedia.filter(item => item.tweetId === reply.id) : [],
    }))
    .filter(item => item.media.length > 0);
  return {
    mainTweet,
    replies,
    tweets,
    media: targetMedia,
    mainMedia,
    replyMedia,
    unassignedMedia,
    repliesWithMedia,
    cursors: captured.cursors,
    endpoints: captured.endpoints,
    errors: captured.errors,
    targetId,
    waitMs: boundedWaitMs,
    match,
    scannedNetworkLimit: captured.boundedLimit,
  };
}

async function runDetail(ctx: SiteCommandContext, options: TwitterDetailOptions): Promise<SiteReceipt> {
  const detail = await captureTweetDetail(ctx, options);
  const byType = mediaByType(detail.media);
  const summary = {
    title: 'Twitter/X tweet detail',
    url: options.url,
    targetTweetId: detail.targetId,
    main: tweetSummary(detail.mainTweet),
    counts: {
      tweets: detail.tweets.length,
      replies: detail.replies.length,
      media: detail.media.length,
      mainMedia: detail.mainMedia.length,
      replyMedia: detail.replyMedia.length,
      repliesWithMedia: detail.repliesWithMedia.length,
      unassignedMedia: detail.unassignedMedia.length,
      mediaByType: byType,
      cursors: detail.cursors.length,
      endpoints: detail.endpoints.length,
    },
    mainMediaSample: mediaSummaries(detail.mainMedia, 5),
    replyMediaSample: mediaSummaries(detail.replyMedia, 5),
    unassignedMediaSample: mediaSummaries(detail.unassignedMedia, 5),
    replySample: tweetSummaries(detail.replies, 5),
    repliesWithMediaSample: detail.repliesWithMedia.slice(0, 5).map(item => ({
      tweet: tweetSummary(item.tweet),
      media: mediaSummaries(item.media, 5),
    })),
  };
  const data = {
    mainTweet: detail.mainTweet,
    replies: detail.replies,
    tweets: detail.tweets,
    media: detail.media,
    mainMedia: detail.mainMedia,
    replyMedia: detail.replyMedia,
    unassignedMedia: detail.unassignedMedia,
    repliesWithMedia: detail.repliesWithMedia,
    cursors: detail.cursors,
  };
  const raw = {
    detailUrl: options.url,
    waitMs: detail.waitMs,
    match: detail.match,
    scannedNetworkLimit: detail.scannedNetworkLimit,
    endpoints: detail.endpoints,
    parseErrors: detail.errors,
  };
  const outputPath = writeJson(options.out, layeredOutput('detail', summary, data, raw));
  return {
    site: 'twitter',
    command: 'detail',
    ok: detail.errors.length < detail.endpoints.length,
    state: detail.endpoints.length ? 'api_captured' : 'no_matching_api_response',
    observations: withLayeredObservations({
      detailUrl: options.url,
      waitMs: detail.waitMs,
      outputPath,
      tweetCount: detail.tweets.length,
      cursorCount: detail.cursors.length,
      mediaCount: detail.media.length,
      byType,
    }, summary, data, raw),
    next: detail.endpoints.length === 0
      ? ['Increase --wait or rerun after the visible detail page finishes loading.']
      : ['Use --out JSON for full detail data; terminal output is intentionally summarized.'],
  };
}

async function captureHomeCheckpoint(ctx: SiteCommandContext, options: TwitterHomeCheckpointOptions): Promise<TwitterHomeCheckpoint> {
  if (options.open !== false) await openOrNavigateSitePage(ctx.profile, 'https://x.com/home', options.pageId);
  if (options.reload) await reloadSitePage(ctx.profile);
  const waitMs = Number.parseInt(options.wait, 10);
  await sleep(Number.isFinite(waitMs) ? waitMs : 6000);
  const limit = Number.parseInt(options.limit, 10);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 2000)) : 1000;
  const entry = latestHomeTimeline(await listSiteNetwork(ctx.profile, boundedLimit));
  const checkpoint: TwitterHomeCheckpoint = {
    site: 'twitter',
    mode: 'home-checkpoint',
    collectedAt: new Date().toISOString(),
    tweets: [],
    cursors: [],
    media: [],
    parseErrors: [],
  };
  if (!entry) return checkpoint;
  checkpoint.endpoint = {
    id: entry.id,
    method: entry.method,
    status: entry.status,
    url: entry.url,
    bytes: entry.responseBody?.bytes,
    startedAt: entry.startedAt,
  };
  try {
    const requestBody = await readSiteNetworkPart(ctx.profile, entry.id, 'request').catch(() => undefined);
    checkpoint.requestBody = requestBody ? decodeNetworkBody(requestBody) : undefined;
    checkpoint.request = extractHomeRequest(checkpoint.requestBody);
    const responseBody = await readSiteNetworkPart(ctx.profile, entry.id, 'response');
    const payload = JSON.parse(decodeNetworkBody(responseBody));
    checkpoint.tweets = extractApiTweets(payload, entry);
    checkpoint.cursors = extractCursors(payload).map(cursor => ({ ...cursor, sourceNetworkId: entry.id }));
    checkpoint.media = extractMediaResources(payload, `network:${entry.id}`);
  } catch (error) {
    checkpoint.parseErrors.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
  }
  return checkpoint;
}

async function runHomeCheckpoint(ctx: SiteCommandContext, options: TwitterHomeCheckpointOptions): Promise<SiteReceipt> {
  const checkpoint = await captureHomeCheckpoint(ctx, options);
  const summary = {
    title: 'Twitter/X home checkpoint',
    tweetCount: checkpoint.tweets.length,
    cursorCount: checkpoint.cursors.length,
    mediaCount: checkpoint.media.length,
    mediaByType: mediaByType(checkpoint.media),
    mediaSample: mediaSummaries(checkpoint.media, 5),
    latest: tweetSummary(checkpoint.tweets[0]),
    hasEndpoint: Boolean(checkpoint.endpoint),
  };
  const data = { checkpoint, tweets: checkpoint.tweets, cursors: checkpoint.cursors, media: checkpoint.media };
  const raw = { endpoint: checkpoint.endpoint, request: checkpoint.request, parseErrors: checkpoint.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('home-checkpoint', summary, data, raw));
  return {
    site: 'twitter',
    command: 'home-checkpoint',
    ok: Boolean(checkpoint.endpoint) && checkpoint.parseErrors.length === 0,
    state: checkpoint.endpoint ? 'home_checkpointed' : 'no_home_timeline_response',
    observations: withLayeredObservations({
      outputPath,
      endpoint: checkpoint.endpoint,
      request: checkpoint.request,
      tweetCount: checkpoint.tweets.length,
      cursorCount: checkpoint.cursors.length,
      mediaCount: checkpoint.media.length,
      byType: mediaByType(checkpoint.media),
      cursors: checkpoint.cursors,
      parseErrors: checkpoint.parseErrors,
    }, summary, data, raw),
    next: checkpoint.endpoint ? undefined : ['Open or reload https://x.com/home, then rerun home-checkpoint.'],
  };
}

function readCheckpoint(file: string): TwitterHomeCheckpoint {
  const rawPayload = JSON.parse(fs.readFileSync(file, 'utf8')) as TwitterHomeCheckpoint & { data?: { checkpoint?: TwitterHomeCheckpoint } };
  const payload = rawPayload.data?.checkpoint || rawPayload;
  return {
    site: 'twitter',
    mode: 'home-checkpoint',
    collectedAt: payload.collectedAt,
    endpoint: payload.endpoint,
    request: payload.request,
    requestBody: payload.requestBody,
    tweets: Array.isArray(payload.tweets) ? payload.tweets : [],
    cursors: Array.isArray(payload.cursors) ? payload.cursors : [],
    media: Array.isArray(payload.media) ? payload.media : [],
    parseErrors: Array.isArray(payload.parseErrors) ? payload.parseErrors : [],
  };
}

function tweetIdSet(tweets: ApiTweetRecord[]): Set<string> {
  return new Set(tweets.map(tweet => tweet.id).filter((id): id is string => Boolean(id)));
}

async function runHomeDiff(ctx: SiteCommandContext, options: TwitterHomeDiffOptions): Promise<SiteReceipt> {
  const before = readCheckpoint(options.before);
  const after = await captureHomeCheckpoint(ctx, options);
  const beforeIds = tweetIdSet(before.tweets);
  const afterIds = tweetIdSet(after.tweets);
  const newTweets = after.tweets.filter(tweet => tweet.id && !beforeIds.has(tweet.id));
  const removedTweets = before.tweets.filter(tweet => tweet.id && !afterIds.has(tweet.id));
  const keptTweets = after.tweets.filter(tweet => tweet.id && beforeIds.has(tweet.id));
  const diff = {
    before: {
      file: options.before,
      collectedAt: before.collectedAt,
      endpoint: before.endpoint,
      tweetCount: before.tweets.length,
      cursorCount: before.cursors.length,
    },
    after,
    counts: {
      before: before.tweets.length,
      after: after.tweets.length,
      new: newTweets.length,
      kept: keptTweets.length,
      removed: removedTweets.length,
    },
    newTweets,
    keptTweetIds: keptTweets.map(tweet => tweet.id).filter(Boolean),
    removedTweets,
  };
  const summary = {
    title: 'Twitter/X home diff',
    counts: diff.counts,
    newSample: tweetSummaries(newTweets, 5),
  };
  const data = diff;
  const raw = { endpoint: after.endpoint, request: after.request, cursors: after.cursors, parseErrors: after.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('home-diff', summary, data, raw));
  return {
    site: 'twitter',
    command: 'home-diff',
    ok: Boolean(after.endpoint) && after.parseErrors.length === 0,
    state: after.endpoint ? 'home_diffed' : 'no_home_timeline_response',
    observations: withLayeredObservations({
      outputPath,
      endpoint: after.endpoint,
      request: after.request,
      counts: diff.counts,
      cursorCount: after.cursors.length,
      cursors: after.cursors,
      newSample: newTweets.slice(0, 10),
      parseErrors: after.parseErrors,
    }, summary, data, raw),
  };
}

async function replayHomePageData(ctx: SiteCommandContext, checkpoint: TwitterHomeCheckpoint, options: {
  cursor: string;
  count: string;
  delayMs: string;
}): Promise<TimelinePageData> {
  if (!checkpoint.endpoint) throw new Error('checkpoint does not contain a HomeTimeline endpoint');
  const cursor = chooseCheckpointCursor(checkpoint, options.cursor);
  if (!cursor) throw new Error(`checkpoint does not contain ${options.cursor} cursor`);
  const count = Number.parseInt(options.count, 10);
  const boundedCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 40)) : 20;
  const delayMs = Number.parseInt(options.delayMs, 10);
  await sleep(Number.isFinite(delayMs) ? Math.max(1000, delayMs) : 3000);
  const body = buildHomeReplayBody(checkpoint, cursor, boundedCount);
  const replay = await replaySiteRequestWithBody(ctx.profile, checkpoint.endpoint.id, body);
  const tweets = new Map<string, ApiTweetRecord>();
  const cursors = new Map<string, { cursorType?: string; value: string; sourceNetworkId: number }>();
  const media = new Map<string, TwitterMediaResource>();
  const parseErrors: Array<{ id: number; message: string }> = [];
  if (replay.status === 200 && replay.body.body && replay.body.encoding === 'utf8') {
    try {
      const source: NetworkEntry = {
        id: checkpoint.endpoint.id,
        method: checkpoint.endpoint.method,
        url: checkpoint.endpoint.url,
        resourceType: 'fetch',
        status: replay.status,
        statusText: replay.statusText,
        startedAt: new Date().toISOString(),
      };
      const payload = JSON.parse(replay.body.body);
      for (const tweet of extractApiTweets(payload, source)) {
        tweets.set(tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`, tweet);
      }
      for (const item of extractCursors(payload)) {
        cursors.set(`${item.cursorType || 'unknown'}:${item.value}`, { ...item, sourceNetworkId: checkpoint.endpoint.id });
      }
      for (const item of extractMediaResources(payload, `replay:${checkpoint.endpoint.id}`)) {
        media.set(mediaKey(item), item);
      }
    } catch (error) {
      parseErrors.push({ id: checkpoint.endpoint.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    status: replay.status,
    statusText: replay.statusText,
    tweets: Array.from(tweets.values()),
    cursors: Array.from(cursors.values()),
    media: Array.from(media.values()),
    parseErrors,
    cursor: {
      requested: options.cursor,
      value: cursor,
    },
  };
}

async function runHomePage(ctx: SiteCommandContext, options: TwitterHomePageOptions): Promise<SiteReceipt> {
  const checkpoint = readCheckpoint(options.checkpoint);
  const page = await replayHomePageData(ctx, checkpoint, {
    cursor: options.cursor,
    count: options.count,
    delayMs: options.delayMs,
  });
  const data = {
    site: 'twitter',
    mode: 'home-page',
    collectedAt: new Date().toISOString(),
    checkpoint: options.checkpoint,
    endpoint: checkpoint.endpoint,
    replay: {
      status: page.status,
      statusText: page.statusText,
    },
    cursor: page.cursor,
    tweets: page.tweets,
    cursors: page.cursors,
    media: page.media,
    parseErrors: page.parseErrors,
  };
  const byType = mediaByType(page.media);
  const summary = {
    title: 'Twitter/X home cursor page',
    cursor: data.cursor,
    status: page.status,
    tweetCount: data.tweets.length,
    cursorCount: data.cursors.length,
    mediaCount: page.media.length,
    mediaByType: byType,
    mediaSample: mediaSummaries(page.media, 5),
    sample: tweetSummaries(data.tweets, 5),
  };
  const raw = { endpoint: checkpoint.endpoint, replay: data.replay, parseErrors: page.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('home-page', summary, data, raw));
  return {
    site: 'twitter',
    command: 'home-page',
    ok: page.status === 200 && page.parseErrors.length === 0,
    state: page.status === 200 ? 'home_page_replayed' : 'home_page_replay_failed',
    observations: withLayeredObservations({
      outputPath,
      status: page.status,
      statusText: page.statusText,
      cursor: data.cursor,
      tweetCount: data.tweets.length,
      cursorCount: data.cursors.length,
      mediaCount: page.media.length,
      byType,
      cursors: data.cursors,
      parseErrors: page.parseErrors,
    }, summary, data, raw),
    next: page.status === 200 ? undefined : ['Stop and inspect the replay response before retrying.'],
  };
}

async function captureProfileCheckpoint(ctx: SiteCommandContext, options: TwitterProfileCheckpointOptions): Promise<TwitterProfileCheckpoint> {
  const handle = normalizeHandle(options.handle);
  const profilePath = options.replies ? `${encodeURIComponent(handle)}/with_replies` : encodeURIComponent(handle);
  await openOrNavigateSitePage(ctx.profile, `https://x.com/${profilePath}`, options.pageId);
  const waitMs = Number.parseInt(options.wait, 10);
  await sleep(Number.isFinite(waitMs) ? waitMs : 7000);
  const limit = Number.parseInt(options.limit, 10);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 2000)) : 1000;
  const entry = latestProfileTimeline(await listSiteNetwork(ctx.profile, boundedLimit), Boolean(options.replies));
  const checkpoint: TwitterProfileCheckpoint = {
    site: 'twitter',
    mode: 'profile-checkpoint',
    handle,
    collectedAt: new Date().toISOString(),
    tweets: [],
    cursors: [],
    media: [],
    parseErrors: [],
  };
  if (!entry) return checkpoint;
  checkpoint.endpoint = {
    id: entry.id,
    method: entry.method,
    status: entry.status,
    url: entry.url,
    bytes: entry.responseBody?.bytes,
    startedAt: entry.startedAt,
  };
  try {
    const requestBody = await readSiteNetworkPart(ctx.profile, entry.id, 'request').catch(() => undefined);
    checkpoint.requestBody = requestBody ? decodeNetworkBody(requestBody) : undefined;
    checkpoint.request = extractProfileRequest(checkpoint.requestBody) || extractProfileRequestFromUrl(entry.url);
    const responseBody = await readSiteNetworkPart(ctx.profile, entry.id, 'response');
    const payload = JSON.parse(decodeNetworkBody(responseBody));
    checkpoint.tweets = extractApiTweets(payload, entry);
    checkpoint.cursors = extractCursors(payload).map(cursor => ({ ...cursor, sourceNetworkId: entry.id }));
    checkpoint.media = extractMediaResources(payload, `network:${entry.id}`);
  } catch (error) {
    checkpoint.parseErrors.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
  }
  return checkpoint;
}

async function runProfileCheckpoint(ctx: SiteCommandContext, options: TwitterProfileCheckpointOptions): Promise<SiteReceipt> {
  const checkpoint = await captureProfileCheckpoint(ctx, options);
  const summary = {
    title: 'Twitter/X profile checkpoint',
    handle: checkpoint.handle,
    replies: Boolean(options.replies),
    tweetCount: checkpoint.tweets.length,
    cursorCount: checkpoint.cursors.length,
    latest: tweetSummary(checkpoint.tweets[0]),
    hasEndpoint: Boolean(checkpoint.endpoint),
  };
  const data = { checkpoint, tweets: checkpoint.tweets, cursors: checkpoint.cursors };
  const raw = { endpoint: checkpoint.endpoint, request: checkpoint.request, parseErrors: checkpoint.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('profile-checkpoint', summary, data, raw));
  return {
    site: 'twitter',
    command: 'profile-checkpoint',
    ok: Boolean(checkpoint.endpoint) && checkpoint.parseErrors.length === 0,
    state: checkpoint.endpoint ? 'profile_checkpointed' : 'no_profile_timeline_response',
    observations: withLayeredObservations({
      handle: checkpoint.handle,
      replies: Boolean(options.replies),
      outputPath,
      endpoint: checkpoint.endpoint,
      request: checkpoint.request,
      tweetCount: checkpoint.tweets.length,
      cursorCount: checkpoint.cursors.length,
      cursors: checkpoint.cursors,
      parseErrors: checkpoint.parseErrors,
    }, summary, data, raw),
    next: checkpoint.endpoint ? undefined : [`Open https://x.com/${checkpoint.handle} and verify the profile is reachable, then rerun profile-checkpoint.`],
  };
}

function readProfileCheckpoint(file: string): TwitterProfileCheckpoint {
  const rawPayload = JSON.parse(fs.readFileSync(file, 'utf8')) as TwitterProfileCheckpoint & { data?: { checkpoint?: TwitterProfileCheckpoint } };
  const payload = rawPayload.data?.checkpoint || rawPayload;
  return {
    site: 'twitter',
    mode: 'profile-checkpoint',
    handle: normalizeHandle(payload.handle || ''),
    collectedAt: payload.collectedAt,
    endpoint: payload.endpoint,
    request: payload.request,
    requestBody: payload.requestBody,
    tweets: Array.isArray(payload.tweets) ? payload.tweets : [],
    cursors: Array.isArray(payload.cursors) ? payload.cursors : [],
    media: Array.isArray(payload.media) ? payload.media : [],
    parseErrors: Array.isArray(payload.parseErrors) ? payload.parseErrors : [],
  };
}

async function replayProfilePageData(ctx: SiteCommandContext, checkpoint: TwitterProfileCheckpoint, options: {
  cursor: string;
  count: string;
  delayMs: string;
}): Promise<TimelinePageData> {
  if (!checkpoint.endpoint) throw new Error('checkpoint does not contain a UserTweets endpoint');
  const cursor = chooseCheckpointCursor(checkpoint as unknown as TwitterHomeCheckpoint, options.cursor);
  if (!cursor) throw new Error(`checkpoint does not contain ${options.cursor} cursor`);
  const count = Number.parseInt(options.count, 10);
  const boundedCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 40)) : 20;
  const delayMs = Number.parseInt(options.delayMs, 10);
  await sleep(Number.isFinite(delayMs) ? Math.max(1000, delayMs) : 3000);
  const replayUrl = buildProfileReplayUrl(checkpoint, cursor, boundedCount);
  const replay = await replaySiteRequestWithUrl(ctx.profile, checkpoint.endpoint.id, replayUrl);
  const tweets = new Map<string, ApiTweetRecord>();
  const cursors = new Map<string, { cursorType?: string; value: string; sourceNetworkId: number }>();
  const media = new Map<string, TwitterMediaResource>();
  const parseErrors: Array<{ id: number; message: string }> = [];
  if (replay.status === 200 && replay.body.body && replay.body.encoding === 'utf8') {
    try {
      const source: NetworkEntry = {
        id: checkpoint.endpoint.id,
        method: checkpoint.endpoint.method,
        url: replayUrl,
        resourceType: 'fetch',
        status: replay.status,
        statusText: replay.statusText,
        startedAt: new Date().toISOString(),
      };
      const payload = JSON.parse(replay.body.body);
      for (const tweet of extractApiTweets(payload, source)) {
        tweets.set(tweet.id || `${tweet.sourceNetworkId}:${tweet.text || ''}`, tweet);
      }
      for (const item of extractCursors(payload)) {
        cursors.set(`${item.cursorType || 'unknown'}:${item.value}`, { ...item, sourceNetworkId: checkpoint.endpoint.id });
      }
      for (const item of extractMediaResources(payload, `replay:${checkpoint.endpoint.id}`)) {
        media.set(mediaKey(item), item);
      }
    } catch (error) {
      parseErrors.push({ id: checkpoint.endpoint.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    status: replay.status,
    statusText: replay.statusText,
    tweets: Array.from(tweets.values()),
    cursors: Array.from(cursors.values()),
    media: Array.from(media.values()),
    parseErrors,
    cursor: {
      requested: options.cursor,
      value: cursor,
    },
  };
}

async function runProfilePage(ctx: SiteCommandContext, options: TwitterProfilePageOptions): Promise<SiteReceipt> {
  const checkpoint = readProfileCheckpoint(options.checkpoint);
  const page = await replayProfilePageData(ctx, checkpoint, {
    cursor: options.cursor,
    count: options.count,
    delayMs: options.delayMs,
  });
  const data = {
    site: 'twitter',
    mode: 'profile-page',
    handle: checkpoint.handle,
    collectedAt: new Date().toISOString(),
    checkpoint: options.checkpoint,
    endpoint: checkpoint.endpoint,
    replay: {
      status: page.status,
      statusText: page.statusText,
    },
    cursor: page.cursor,
    tweets: page.tweets,
    cursors: page.cursors,
    parseErrors: page.parseErrors,
  };
  const summary = {
    title: 'Twitter/X profile cursor page',
    handle: checkpoint.handle,
    cursor: data.cursor,
    status: page.status,
    tweetCount: data.tweets.length,
    cursorCount: data.cursors.length,
    sample: tweetSummaries(data.tweets, 5),
  };
  const raw = { endpoint: checkpoint.endpoint, replay: data.replay, parseErrors: page.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('profile-page', summary, data, raw));
  return {
    site: 'twitter',
    command: 'profile-page',
    ok: page.status === 200 && page.parseErrors.length === 0,
    state: page.status === 200 ? 'profile_page_replayed' : 'profile_page_replay_failed',
    observations: withLayeredObservations({
      handle: checkpoint.handle,
      outputPath,
      status: page.status,
      statusText: page.statusText,
      cursor: data.cursor,
      tweetCount: data.tweets.length,
      cursorCount: data.cursors.length,
      cursors: data.cursors,
      parseErrors: page.parseErrors,
    }, summary, data, raw),
    next: page.status === 200 ? undefined : ['Stop and inspect the replay response before retrying.'],
  };
}

async function runProfileDiff(ctx: SiteCommandContext, options: TwitterProfileDiffOptions): Promise<SiteReceipt> {
  const before = readProfileCheckpoint(options.before);
  const after = await captureProfileCheckpoint(ctx, options);
  const beforeIds = tweetIdSet(before.tweets);
  const afterIds = tweetIdSet(after.tweets);
  const newTweets = after.tweets.filter(tweet => tweet.id && !beforeIds.has(tweet.id));
  const removedTweets = before.tweets.filter(tweet => tweet.id && !afterIds.has(tweet.id));
  const keptTweets = after.tweets.filter(tweet => tweet.id && beforeIds.has(tweet.id));
  const diff = {
    handle: after.handle,
    before: {
      file: options.before,
      handle: before.handle,
      collectedAt: before.collectedAt,
      endpoint: before.endpoint,
      tweetCount: before.tweets.length,
      cursorCount: before.cursors.length,
    },
    after,
    counts: {
      before: before.tweets.length,
      after: after.tweets.length,
      new: newTweets.length,
      kept: keptTweets.length,
      removed: removedTweets.length,
    },
    newTweets,
    keptTweetIds: keptTweets.map(tweet => tweet.id).filter(Boolean),
    removedTweets,
  };
  const summary = {
    title: 'Twitter/X profile diff',
    handle: after.handle,
    replies: Boolean(options.replies),
    counts: diff.counts,
    newSample: tweetSummaries(newTweets, 5),
  };
  const data = diff;
  const raw = { endpoint: after.endpoint, request: after.request, cursors: after.cursors, parseErrors: after.parseErrors };
  const outputPath = writeJson(options.out, layeredOutput('profile-diff', summary, data, raw));
  return {
    site: 'twitter',
    command: 'profile-diff',
    ok: Boolean(after.endpoint) && after.parseErrors.length === 0,
    state: after.endpoint ? 'profile_diffed' : 'no_profile_timeline_response',
    observations: withLayeredObservations({
      handle: after.handle,
      replies: Boolean(options.replies),
      outputPath,
      endpoint: after.endpoint,
      request: after.request,
      counts: diff.counts,
      cursorCount: after.cursors.length,
      cursors: after.cursors,
      newSample: newTweets.slice(0, 10),
      parseErrors: after.parseErrors,
    }, summary, data, raw),
  };
}

async function runXHome(ctx: SiteCommandContext, options: XHomeOptions): Promise<SiteReceipt> {
  const pages = boundedInt(options.pages, 1, 1, 5);
  const out = defaultXOut(options.dir, 'home', options.out);
  const checkpoint = await captureHomeCheckpoint(ctx, {
    out: undefined,
    wait: options.wait,
    limit: '1000',
    reload: options.reload,
    pageId: options.pageId,
  });
  const pageResults: TimelinePageData[] = [];
  let allTweets = mergeTweets(checkpoint.tweets);
  let allMedia = mergeMedia(checkpoint.media);
  let workingCheckpoint = checkpoint;
  for (let index = 1; index < pages; index += 1) {
    const cursor = chooseBottomCursor(workingCheckpoint.cursors);
    if (!cursor) break;
    const page = await replayHomePageData(ctx, workingCheckpoint, {
      cursor,
      count: options.count,
      delayMs: options.pageDelayMs,
    });
    pageResults.push(page);
    allTweets = mergeTweets(allTweets, page.tweets);
    allMedia = mergeMedia(allMedia, page.media);
    workingCheckpoint = {
      ...workingCheckpoint,
      tweets: allTweets,
      media: allMedia,
      cursors: page.cursors,
    };
    if (page.status !== 200 || page.parseErrors.length > 0) break;
  }
  const visible = await visibleTweets(ctx.profile, 40).catch(() => []);
  const orderedItems = orderItemsByVisibleTweets(tweetItems(allTweets, allMedia), visible);
  const summary = {
    title: 'X home',
    pagesRequested: pages,
    pagesFetched: 1 + pageResults.length,
    visibleTweetCount: visible.length,
    tweetCount: allTweets.length,
    mediaCount: allMedia.length,
    mediaByType: mediaByType(allMedia),
    mediaSample: mediaSummaries(allMedia, 5),
    cursorCount: workingCheckpoint.cursors.length,
    sample: orderedItems.slice(0, 5),
  };
  const data = {
    items: orderedItems,
    pages: pageResults.map((page, index) => ({
      page: index + 2,
      status: page.status,
      statusText: page.statusText,
      items: tweetItems(page.tweets, page.media),
      parseErrors: page.parseErrors,
    })),
  };
  const raw = {
    endpoint: checkpoint.endpoint,
    parseErrors: [
      ...checkpoint.parseErrors,
      ...pageResults.flatMap(page => page.parseErrors),
    ],
  };
  const outputPath = writeJson(out, layeredOutput('x-home', summary, data, raw));
  return {
    site: 'x',
    command: 'home',
    ok: Boolean(checkpoint.endpoint) && raw.parseErrors.length === 0 && pageResults.every(page => page.status === 200),
    state: checkpoint.endpoint ? 'home_collected' : 'no_home_timeline_response',
    observations: {
      outputPath,
      pages: summary.pagesFetched,
      visibleTweetCount: visible.length,
      tweetCount: allTweets.length,
      mediaCount: allMedia.length,
      byType: mediaByType(allMedia),
      cursorCount: workingCheckpoint.cursors.length,
      sample: orderedItems.slice(0, 3),
    },
    next: checkpoint.endpoint ? [`Open ${outputPath} for full data.`] : ['Log in to X in the visible browser, then rerun siteflow x home.'],
  };
}

async function runXProfile(ctx: SiteCommandContext, options: XProfileOptions): Promise<SiteReceipt> {
  const handle = normalizeHandle(options.handle);
  const pages = boundedInt(options.pages, 1, 1, 5);
  const out = defaultXOut(options.dir, `profile-${sanitizeFilePart(handle, 'handle')}`, options.out);
  const checkpoint = await captureProfileCheckpoint(ctx, {
    handle,
    out: undefined,
    wait: options.wait,
    limit: '1000',
    replies: options.replies,
    pageId: options.pageId,
  });
  const pageResults: TimelinePageData[] = [];
  let allTweets = mergeTweets(checkpoint.tweets);
  let allMedia = mergeMedia(checkpoint.media);
  let workingCheckpoint = checkpoint;
  for (let index = 1; index < pages; index += 1) {
    const cursor = chooseBottomCursor(workingCheckpoint.cursors);
    if (!cursor) break;
    const page = await replayProfilePageData(ctx, workingCheckpoint, {
      cursor,
      count: options.count,
      delayMs: options.pageDelayMs,
    });
    pageResults.push(page);
    allTweets = mergeTweets(allTweets, page.tweets);
    allMedia = mergeMedia(allMedia, page.media);
    workingCheckpoint = {
      ...workingCheckpoint,
      tweets: allTweets,
      media: allMedia,
      cursors: page.cursors,
    };
    if (page.status !== 200 || page.parseErrors.length > 0) break;
  }
  const summary = {
    title: 'X profile',
    handle,
    replies: Boolean(options.replies),
    pagesRequested: pages,
    pagesFetched: 1 + pageResults.length,
    threadCount: profileThreads(allTweets, allMedia).length,
    tweetCount: allTweets.length,
    mediaCount: allMedia.length,
    mediaByType: mediaByType(allMedia),
    cursorCount: workingCheckpoint.cursors.length,
    latest: tweetSummary(allTweets[0]),
    sample: profileThreads(allTweets, allMedia).slice(0, 5),
  };
  const data = {
    threads: profileThreads(allTweets, allMedia),
    pages: pageResults.map((page, index) => ({
      page: index + 2,
      status: page.status,
      statusText: page.statusText,
      threads: profileThreads(page.tweets, page.media),
      parseErrors: page.parseErrors,
    })),
  };
  const raw = {
    endpoint: checkpoint.endpoint,
    parseErrors: [
      ...checkpoint.parseErrors,
      ...pageResults.flatMap(page => page.parseErrors),
    ],
  };
  const outputPath = writeJson(out, layeredOutput('x-profile', summary, data, raw));
  return {
    site: 'x',
    command: 'profile',
    ok: Boolean(checkpoint.endpoint) && raw.parseErrors.length === 0 && pageResults.every(page => page.status === 200),
    state: checkpoint.endpoint ? 'profile_collected' : 'no_profile_timeline_response',
    observations: {
      handle,
      replies: Boolean(options.replies),
      outputPath,
      pages: summary.pagesFetched,
      threadCount: summary.threadCount,
      tweetCount: allTweets.length,
      mediaCount: allMedia.length,
      byType: mediaByType(allMedia),
      cursorCount: workingCheckpoint.cursors.length,
      latest: tweetSummary(allTweets[0]),
      sample: profileThreads(allTweets, allMedia).slice(0, 3),
    },
    next: checkpoint.endpoint ? [`Open ${outputPath} for full data.`] : [`Open https://x.com/${handle} and verify the profile is reachable, then rerun.`],
  };
}

async function runXTweet(ctx: SiteCommandContext, options: XTweetOptions): Promise<SiteReceipt> {
  const out = defaultXOut(options.dir, 'tweet', options.out);
  const detail = await captureTweetDetail(ctx, {
    url: options.url,
    out: undefined,
    wait: options.wait,
    limit: '1000',
    match: 'TweetDetail|TweetResultByRestId|graphql',
    pageId: options.pageId,
  });
  const summary = {
    title: 'X tweet',
    url: options.url,
    main: tweetSummary(detail.mainTweet),
    counts: {
      tweets: detail.tweets.length,
      replies: detail.replies.length,
      media: detail.media.length,
      mediaByType: mediaByType(detail.media),
      endpoints: detail.endpoints.length,
    },
    mediaSample: mediaSummaries(detail.media, 5),
    replySample: tweetSummaries(detail.replies, 5),
  };
  const data = {
    mainTweet: detail.mainTweet,
    replies: detail.replies,
    tweets: detail.tweets,
    media: detail.media,
    mainMedia: detail.mainMedia,
    replyMedia: detail.replyMedia,
    repliesWithMedia: detail.repliesWithMedia,
  };
  const raw = {
    detailUrl: options.url,
    waitMs: detail.waitMs,
    endpoints: detail.endpoints,
    parseErrors: detail.errors,
  };
  const outputPath = writeJson(out, layeredOutput('x-tweet', summary, data, raw));
  return {
    site: 'x',
    command: 'tweet',
    ok: detail.endpoints.length > 0 && detail.errors.length < detail.endpoints.length,
    state: detail.endpoints.length ? 'tweet_collected' : 'no_tweet_detail_response',
    observations: {
      outputPath,
      tweet: tweetSummary(detail.mainTweet),
      replies: detail.replies.length,
      media: detail.media.length,
      byType: mediaByType(detail.media),
    },
    next: detail.endpoints.length ? [`Open ${outputPath} for full data.`] : ['Increase --wait or rerun after the detail page finishes loading.'],
  };
}

async function runXDownload(ctx: SiteCommandContext, options: XDownloadOptions): Promise<SiteReceipt> {
  const out = defaultXOut(options.dir, 'download', options.out);
  const mediaDir = options.mediaDir || path.join(path.dirname(out), 'media');
  const maxBytes = boundedInt(options.maxBytes, 200_000_000, 1, 2_000_000_000);
  const limit = boundedInt(options.limit, 20, 1, 100);
  const detail = await captureTweetDetail(ctx, {
    url: options.url,
    out: undefined,
    wait: options.wait,
    limit: '1000',
    match: 'TweetDetail|TweetResultByRestId|graphql',
    pageId: options.pageId,
  });
  const selected = detail.media.slice(0, limit);
  const planned = selected.map((media, index) => {
    const choice = chooseMediaDownload(media, options.prefer);
    const ext = choice.url ? extensionFromUrlOrType(choice.url, choice.contentType) : 'bin';
    const name = `${String(index + 1).padStart(2, '0')}-${sanitizeFilePart(media.tweetId, 'tweet')}-${sanitizeFilePart(media.type, 'media')}-${sanitizeFilePart(choice.label, 'file')}.${ext}`;
    return {
      media,
      choice,
      outFile: path.join(mediaDir, name),
    };
  });
  const downloads: Array<Record<string, unknown>> = [];
  const errors: Array<{ url?: string; message: string }> = [];
  for (const item of planned) {
    if (!item.choice.url) {
      errors.push({ message: 'media has no downloadable URL' });
      continue;
    }
    if (!options.apply) {
      downloads.push({
        dryRun: true,
        type: item.media.type,
        tweetId: item.media.tweetId,
        url: item.choice.url,
        outFile: item.outFile,
      });
      continue;
    }
    try {
      const downloaded = await downloadUrl(item.choice.url, item.outFile, maxBytes);
      downloads.push({
        type: item.media.type,
        tweetId: item.media.tweetId,
        url: item.choice.url,
        outFile: item.outFile,
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
      });
    } catch (error) {
      errors.push({ url: item.choice.url, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const summary = {
    title: 'X media download',
    url: options.url,
    apply: Boolean(options.apply),
    mediaFound: detail.media.length,
    selected: selected.length,
    downloaded: options.apply ? downloads.length : 0,
    dryRun: options.apply ? 0 : downloads.length,
    errors: errors.length,
    mediaDir,
  };
  const data = {
    downloads,
    media: selected,
  };
  const raw = {
    detailUrl: options.url,
    endpoints: detail.endpoints,
    parseErrors: detail.errors,
    errors,
  };
  const outputPath = writeJson(out, layeredOutput('x-download', summary, data, raw));
  return {
    site: 'x',
    command: 'download',
    ok: detail.endpoints.length > 0 && errors.length === 0,
    state: options.apply ? 'media_downloaded' : 'media_download_planned',
    observations: {
      outputPath,
      mediaFound: detail.media.length,
      selected: selected.length,
      downloaded: options.apply ? downloads.length : 0,
      dryRun: options.apply ? 0 : downloads.length,
      mediaDir,
      errors,
    },
    next: options.apply ? [`Open ${mediaDir} to view downloaded files.`] : ['Rerun with --apply to download files.'],
  };
}

async function runXMore(ctx: SiteCommandContext, options: XMoreOptions, deps = twitterDeps): Promise<SiteReceipt> {
  const pages = boundedInt(options.pages, 1, 1, 10);
  const delayMs = boundedInt(options.delayMs, 2000, 500, 30_000);
  const limit = boundedInt(options.limit, 80, 1, 500);
  const networkLimit = boundedInt(options.networkLimit, 1000, 1, 2000);
  const out = defaultXOut(options.dir, 'more', options.out);
  const before = await deps.readSiteSnapshot(ctx.profile);
  const domGroups: TweetRecord[][] = [];
  domGroups.push(await visibleTweets(ctx.profile, limit, deps));
  for (let index = 0; index < pages; index += 1) {
    await deps.evaluateInSitePage(ctx.profile, 'window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 1.6))); true');
    await deps.sleep(delayMs);
    domGroups.push(await visibleTweets(ctx.profile, limit, deps));
  }
  const after = await deps.readSiteSnapshot(ctx.profile);
  const domTweets = dedupeTweets(domGroups.flat()).slice(0, limit);
  const captured = await captureApiData(ctx, {
    limit: String(networkLimit),
    match: 'HomeTimeline|SearchTimeline|UserTweets|UserTweetsAndReplies|TweetDetail|graphql',
  });
  const summary = {
    title: 'X current tab scroll',
    url: after.url,
    titleText: after.title,
    scrollPages: pages,
    domTweetCount: domTweets.length,
    apiTweetCount: captured.tweets.length,
    cursorCount: captured.cursors.length,
    mediaCount: captured.media.length,
    mediaByType: mediaByType(captured.media),
    sample: tweetSummaries(captured.tweets.length ? captured.tweets : domTweets, 5),
  };
  const data = {
    page: {
      before: { url: before.url, title: before.title },
      after: { url: after.url, title: after.title },
    },
    domTweets,
    apiTweets: captured.tweets,
    cursors: captured.cursors,
    media: captured.media,
  };
  const raw = {
    scannedNetworkLimit: captured.boundedLimit,
    endpoints: captured.endpoints,
    parseErrors: captured.errors,
  };
  const outputPath = writeJson(out, layeredOutput('x-more', summary, data, raw));
  return {
    site: 'x',
    command: 'more',
    ok: true,
    state: 'current_tab_scrolled',
    page: {
      url: after.url,
      title: after.title,
    },
    observations: {
      outputPath,
      url: after.url,
      pages,
      domTweetCount: domTweets.length,
      apiTweetCount: captured.tweets.length,
      cursorCount: captured.cursors.length,
      mediaCount: captured.media.length,
      byType: mediaByType(captured.media),
      sample: tweetSummaries(captured.tweets.length ? captured.tweets : domTweets, 3),
    },
    next: [`Open ${outputPath} for full current-tab data.`],
  };
}


export const twitterTesting = {
  captureTweetDetail,
  collectVisibleTweetsWithScroll,
  deps: twitterDeps,
  isAuthRequired,
  runCollect,
  runStatus,
  visibleLinks,
  visibleTweets,
};

export const twitterAdapter: SiteAdapter = {
  id: 'twitter',
  title: 'Twitter/X',
  description: 'Read-only Twitter/X browsing and visible data collection. It never posts.',
  commands: [
    {
      name: 'status',
      description: 'Observe the current or default X page and login state',
      configure(command: Command): void {
        addSitePageIdOption(command
          .option('--url <url>', 'X/Twitter URL to open before observing')
          .option('--screenshot <path>', 'save screenshot'))
          .action(async function () {
            await runSiteCommand(this, ctx => runStatus(ctx, this.opts<TwitterStatusOptions>()));
          });
      },
    },
    {
      name: 'collect',
      description: 'Collect visible tweets, links, and page text from an X/Twitter page',
      configure(command: Command): void {
        addSitePageIdOption(command
          .option('--url <url>', 'X/Twitter URL to open before collecting')
          .option('--limit <n>', 'maximum visible tweet records', '20')
          .option('--wait <ms>', 'milliseconds to wait for page load', '5000')
          .option('--scroll-pages <n>', 'number of viewport scrolls before final collection', '0')
          .option('--scroll-delay <ms>', 'milliseconds to wait after each scroll', '1500')
          .option('--out <path>', 'write normalized DOM collection JSON')
          .option('--screenshot <path>', 'save screenshot'))
          .action(async function () {
            await runSiteCommand(this, ctx => runCollect(ctx, this.opts<TwitterCollectOptions>()));
          });
      },
    },
    {
      name: 'search',
      description: 'Open X search and collect visible result tweets',
      configure(command: Command): void {
        addSitePageIdOption(command
          .requiredOption('--query <text>', 'search query')
          .option('--limit <n>', 'maximum visible tweet records', '20')
          .option('--wait <ms>', 'milliseconds to wait for page load', '7000')
          .option('--scroll-pages <n>', 'number of viewport scrolls before final collection', '0')
          .option('--scroll-delay <ms>', 'milliseconds to wait after each scroll', '1500')
          .option('--out <path>', 'write normalized DOM collection JSON')
          .option('--screenshot <path>', 'save screenshot'))
          .action(async function () {
            await runSiteCommand(this, ctx => runSearch(ctx, this.opts<TwitterSearchOptions>()));
          });
      },
    },
    {
      name: 'api-capture',
      description: 'Extract normalized tweets and cursors from captured X GraphQL network responses',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'network entries to scan from the selected page', '500')
          .option('--match <regex>', 'network URL regex to scan', 'HomeTimeline|SearchTimeline|UserTweets|TweetDetail|graphql')
          .option('--out <path>', 'write normalized API capture JSON')
          .action(async function () {
            await runSiteCommand(this, ctx => runApiCapture(ctx, this.opts<TwitterApiCaptureOptions>()));
          });
      },
    },
    {
      name: 'detail',
      description: 'Open one X/Twitter status URL and capture TweetDetail GraphQL data',
      configure(command: Command): void {
        addSitePageIdOption(command
          .requiredOption('--url <url>', 'X/Twitter status URL to open before capturing details')
          .option('--wait <ms>', 'milliseconds to wait after opening the detail page', '8000')
          .option('--limit <n>', 'network entries to scan after opening the detail page', '1000')
          .option('--match <regex>', 'network URL regex to scan', 'TweetDetail|TweetResultByRestId|graphql')
          .option('--out <path>', 'write normalized detail capture JSON'))
          .action(async function () {
            await runSiteCommand(this, ctx => runDetail(ctx, this.opts<TwitterDetailOptions>()));
          });
      },
    },
    {
      name: 'home-checkpoint',
      description: 'Capture the latest HomeTimeline tweets and cursors as a recommendation checkpoint',
      configure(command: Command): void {
        addSitePageIdOption(command
          .option('--out <path>', 'write checkpoint JSON')
          .option('--wait <ms>', 'milliseconds to wait after opening/reloading home', '6000')
          .option('--limit <n>', 'network entries to scan', '1000')
          .option('--reload', 'reload the selected home page before checkpointing')
          .option('--no-open', 'do not open https://x.com/home before scanning network'))
          .action(async function () {
            await runSiteCommand(this, ctx => runHomeCheckpoint(ctx, this.opts<TwitterHomeCheckpointOptions>()));
          });
      },
    },
    {
      name: 'home-diff',
      description: 'Refresh HomeTimeline and diff it against a previous recommendation checkpoint',
      configure(command: Command): void {
        addSitePageIdOption(command
          .requiredOption('--before <path>', 'previous home-checkpoint JSON')
          .option('--out <path>', 'write diff JSON')
          .option('--wait <ms>', 'milliseconds to wait after opening/reloading home', '6000')
          .option('--limit <n>', 'network entries to scan', '1000')
          .option('--reload', 'reload the selected home page before diffing')
          .option('--no-open', 'do not open https://x.com/home before scanning network'))
          .action(async function () {
            await runSiteCommand(this, ctx => runHomeDiff(ctx, this.opts<TwitterHomeDiffOptions>()));
          });
      },
    },
    {
      name: 'home-page',
      description: 'Replay one HomeTimeline page using a Top or Bottom cursor from a checkpoint',
      configure(command: Command): void {
        command
          .requiredOption('--checkpoint <path>', 'home-checkpoint JSON with endpoint, requestBody, and cursors')
          .option('--cursor <top|bottom|value>', 'cursor to use: top, bottom, or a raw cursor value', 'bottom')
          .option('--out <path>', 'write replay result JSON')
          .option('--count <n>', 'requested item count, capped at 40', '20')
          .option('--delay-ms <ms>', 'minimum delay before replaying the request', '3000')
          .action(async function () {
            await runSiteCommand(this, ctx => runHomePage(ctx, this.opts<TwitterHomePageOptions>()));
          });
      },
    },
    {
      name: 'profile-checkpoint',
      description: 'Capture the latest tweets from one X profile as a monitoring checkpoint',
      configure(command: Command): void {
        addSitePageIdOption(command
          .requiredOption('--handle <handle>', 'X handle, with or without @')
          .option('--out <path>', 'write checkpoint JSON')
          .option('--wait <ms>', 'milliseconds to wait after opening the profile', '7000')
          .option('--limit <n>', 'network entries to scan', '1000')
          .option('--replies', 'capture UserTweetsAndReplies instead of UserTweets'))
          .action(async function () {
            await runSiteCommand(this, ctx => runProfileCheckpoint(ctx, this.opts<TwitterProfileCheckpointOptions>()));
          });
      },
    },
    {
      name: 'profile-page',
      description: 'Replay one UserTweets page using a Top or Bottom cursor from a profile checkpoint',
      configure(command: Command): void {
        command
          .requiredOption('--checkpoint <path>', 'profile-checkpoint JSON with endpoint and cursors')
          .option('--cursor <top|bottom|value>', 'cursor to use: top, bottom, or a raw cursor value', 'bottom')
          .option('--out <path>', 'write replay result JSON')
          .option('--count <n>', 'requested item count, capped at 40', '20')
          .option('--delay-ms <ms>', 'minimum delay before replaying the request', '3000')
          .action(async function () {
            await runSiteCommand(this, ctx => runProfilePage(ctx, this.opts<TwitterProfilePageOptions>()));
          });
      },
    },
    {
      name: 'profile-diff',
      description: 'Capture one X profile and diff it against a previous profile checkpoint',
      configure(command: Command): void {
        addSitePageIdOption(command
          .requiredOption('--handle <handle>', 'X handle, with or without @')
          .requiredOption('--before <path>', 'previous profile-checkpoint JSON')
          .option('--out <path>', 'write diff JSON')
          .option('--wait <ms>', 'milliseconds to wait after opening the profile', '7000')
          .option('--limit <n>', 'network entries to scan', '1000')
          .option('--replies', 'capture UserTweetsAndReplies instead of UserTweets'))
          .action(async function () {
            await runSiteCommand(this, ctx => runProfileDiff(ctx, this.opts<TwitterProfileDiffOptions>()));
          });
      },
    },
    {
      name: 'media-list',
      description: 'Extract media resources from a network dump manifest',
      configure(command: Command): void {
        command
          .requiredOption('--from-dump <path>', 'network dump directory or manifest.json')
          .option('--tweet-id <id>', 'only include media belonging to this tweet id')
          .option('--type <regex>', 'only include media type matching this regex, e.g. photo|video')
          .option('--out <path>', 'write normalized media JSON')
          .action(async function () {
            await runSiteCommand(this, ctx => runMediaList(ctx, this.opts<TwitterMediaListOptions>()));
          });
      },
    },
    {
      name: 'media-download',
      description: 'Download selected media resources from a media-list JSON file',
      configure(command: Command): void {
        command
          .requiredOption('--from-media-list <path>', 'media-list JSON file')
          .requiredOption('--dir <path>', 'output directory')
          .option('--apply', 'actually download files; without this the command is a dry run')
          .option('--tweet-id <id>', 'only download media belonging to this tweet id')
          .option('--type <regex>', 'only download media type matching this regex, e.g. photo|video')
          .option('--prefer <kind>', 'video selection preference: mp4, hls, or preview', 'mp4')
          .option('--max-bitrate <n>', 'for mp4 videos, choose the best variant at or below this bitrate')
          .option('--limit <n>', 'maximum media resources to consider', '20')
          .option('--max-bytes <n>', 'maximum bytes per downloaded file', '200000000')
          .action(async function () {
            await runSiteCommand(this, ctx => runMediaDownload(ctx, this.opts<TwitterMediaDownloadOptions>()));
          });
      },
    },
  ],
};

export const xAdapter: SiteAdapter = {
  id: 'x',
  title: 'X',
  description: 'Human-friendly X/Twitter commands built on the lower-level twitter and network primitives.',
  commands: [
    {
      name: 'more',
      description: 'Scroll the current selected X tab and collect what loads; no new tab is opened',
      configure(command: Command): void {
        command
          .option('--pages <n>', 'number of viewport scrolls, capped at 10', '1')
          .option('--delay-ms <ms>', 'delay after each scroll', '2000')
          .option('--limit <n>', 'maximum DOM tweets to keep', '80')
          .option('--network-limit <n>', 'network entries to scan from the current tab', '1000')
          .option('--out <path>', 'write full JSON result')
          .option('--dir <path>', 'directory for auto-named output files')
          .action(async function () {
            await runSiteCommand(this, ctx => runXMore(ctx, this.opts<XMoreOptions>()));
          });
      },
    },
    {
      name: 'home',
      description: 'Collect your X Home timeline; use --pages to continue downward',
      configure(command: Command): void {
        addSitePageIdOption(command
          .option('--pages <n>', 'number of pages to collect, capped at 5', '1')
          .option('--out <path>', 'write full JSON result')
          .option('--dir <path>', 'directory for auto-named output files')
          .option('--wait <ms>', 'milliseconds to wait for Home to load', '7000')
          .option('--page-delay-ms <ms>', 'delay between cursor page requests', '3000')
          .option('--count <n>', 'requested item count per cursor page, capped at 40', '20')
          .option('--reload', 'reload Home before capturing the timeline'))
          .action(async function () {
            await runSiteCommand(this, ctx => runXHome(ctx, this.opts<XHomeOptions>()));
          });
      },
    },
    {
      name: 'profile',
      description: 'Collect one X profile; use --pages to continue downward',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<handle>', 'X handle, with or without @')
          .option('--pages <n>', 'number of pages to collect, capped at 5', '1')
          .option('--replies', 'include replies tab')
          .option('--out <path>', 'write full JSON result')
          .option('--dir <path>', 'directory for auto-named output files')
          .option('--wait <ms>', 'milliseconds to wait for the profile to load', '8000')
          .option('--page-delay-ms <ms>', 'delay between cursor page requests', '3000')
          .option('--count <n>', 'requested item count per cursor page, capped at 40', '20'))
          .action(async function (handle: string) {
            await runSiteCommand(this, ctx => runXProfile(ctx, { ...this.opts<Omit<XProfileOptions, 'handle'>>(), handle }));
          });
      },
    },
    {
      name: 'tweet',
      description: 'Collect one X tweet detail, replies, and media metadata',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<url>', 'X status URL')
          .option('--out <path>', 'write full JSON result')
          .option('--dir <path>', 'directory for auto-named output files')
          .option('--wait <ms>', 'milliseconds to wait for the tweet page to load', '9000'))
          .action(async function (url: string) {
            await runSiteCommand(this, ctx => runXTweet(ctx, { ...this.opts<Omit<XTweetOptions, 'url'>>(), url }));
          });
      },
    },
    {
      name: 'download',
      description: 'Find media on one X tweet and download it with --apply',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<url>', 'X status URL')
          .option('--apply', 'actually download files; without this the command only plans')
          .option('--out <path>', 'write full JSON result')
          .option('--dir <path>', 'directory for auto-named output files')
          .option('--media-dir <path>', 'directory for downloaded media files')
          .option('--wait <ms>', 'milliseconds to wait for the tweet page to load', '9000')
          .option('--prefer <kind>', 'video selection preference: mp4, hls, or preview', 'mp4')
          .option('--limit <n>', 'maximum media items to consider', '20')
          .option('--max-bytes <n>', 'maximum bytes per downloaded file', '200000000'))
          .action(async function (url: string) {
            await runSiteCommand(this, ctx => runXDownload(ctx, { ...this.opts<Omit<XDownloadOptions, 'url'>>(), url }));
          });
      },
    },
  ],
};
