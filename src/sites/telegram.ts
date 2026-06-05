import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { addSitePageIdOption, runSiteCommand, clampInt, evaluateSiteExpression, listSiteNetwork, listSitePages, openOrNavigateSitePage, openSitePage, parseSitePageId, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const SITE = 'telegram';
const ORIGIN = 'https://t.me';

interface ChannelOptions {
  channel: string;
  limit?: string;
}

interface SearchOptions extends ChannelOptions {
  query: string;
}

interface PostOptions {
  target: string;
  postId?: string;
  limit?: string;
}

interface ChatsOptions {
  limit?: string;
}

interface WebTargetOptions {
  target: string;
  pageId?: string;
}

interface WebMessagesOptions extends WebTargetOptions {
  limit?: string;
  pages?: string;
  direction?: string;
  pageId?: string;
  minMessages?: string;
}

interface OpenLinkOptions extends WebMessagesOptions {
  linkIndex?: string;
}

interface WatchOptions extends WebMessagesOptions {
  duration?: string;
  interval?: string;
  maxMessages?: string;
  out?: string;
}

type WebMediaItem = {
  index: number;
  type: string;
  src?: string;
  href?: string;
  aria?: string;
  className?: string;
};

type WebCollectedMessage = {
  index: number;
  id?: string;
  text?: string;
  textLength: number;
  time?: string;
  links: Array<{ index: number; text?: string; url: string }>;
  mediaCount: number;
  media: WebMediaItem[];
};

const clampLimit = (value: string | undefined, fallback = 20, max = 100): number => clampInt(value, fallback, 1, max);

const clampIndex = (value: string | undefined, fallback = 0, max = Number.MAX_SAFE_INTEGER): number => clampInt(value, fallback, 0, max);


const clampPages = (value: string | undefined): number => clampInt(value, 0, 0, 200);

function scrollDirection(value: string | undefined): 'up' | 'down' {
  return String(value || 'up').toLowerCase() === 'down' ? 'down' : 'up';
}

function messageTargetCount(value: string | undefined): number {
  if (!value) return 0;
  return clampLimit(value, 0, 500);
}

function parseDurationMs(value: string | undefined, fallbackMs: number, maxMs: number): number {
  if (!value) return fallbackMs;
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|小时|分钟|秒)?$/);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;
  const unit = match[2] || 's';
  const multiplier = unit === 'ms'
    ? 1
    : ['s', 'sec', 'secs', 'second', 'seconds', '秒'].includes(unit)
      ? 1000
      : ['m', 'min', 'mins', 'minute', 'minutes', '分钟'].includes(unit)
        ? 60_000
        : 3_600_000;
  return Math.max(1_000, Math.min(Math.round(amount * multiplier), maxMs));
}

function clampTotalMessages(value: string | undefined): number {
  return clampLimit(value, 1000, 5000);
}

function normalizeChannel(value: string): string {
  const trimmed = value.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\/(?:www\.)?t\.me\//i, '');
  const withoutMirrorPrefix = withoutProtocol.replace(/^s\//, '');
  return withoutMirrorPrefix.split(/[/?#]/)[0].replace(/^@/, '');
}

function normalizePostTarget(target: string, postId?: string): { channel: string; postId?: string } {
  const trimmed = target.trim();
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([^/?#]+)\/(\d+)/i);
  if (urlMatch) return { channel: normalizeChannel(urlMatch[1]), postId: urlMatch[2] };
  const compactMatch = trimmed.match(/^@?([^/\s]+)\/(\d+)$/);
  if (compactMatch) return { channel: normalizeChannel(compactMatch[1]), postId: compactMatch[2] };
  return { channel: normalizeChannel(trimmed), postId };
}

function channelUrl(channel: string, query?: string, postId?: string): string {
  const base = `${ORIGIN}/s/${encodeURIComponent(normalizeChannel(channel))}${postId ? `/${encodeURIComponent(postId)}` : ''}`;
  return query ? `${base}?q=${encodeURIComponent(query)}` : base;
}

function webChatUrl(target: string): string {
  const trimmed = target.trim();
  if (/^https?:\/\/web\.telegram\.org\/a\/#/i.test(trimmed)) return trimmed;
  if (/^#?-?\d+$/.test(trimmed)) return `https://web.telegram.org/a/#${trimmed.replace(/^#/, '')}`;
  const webMatch = trimmed.match(/web\.telegram\.org\/a\/#(-?\d+)/i);
  if (webMatch) return `https://web.telegram.org/a/#${webMatch[1]}`;
  const tmeMatch = trimmed.match(/^https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([^/?#]+)(?:\/(\d+))?/i);
  if (tmeMatch && tmeMatch[2]) return `https://t.me/${tmeMatch[1]}/${tmeMatch[2]}`;
  if (tmeMatch) return `https://web.telegram.org/a/#@${normalizeChannel(tmeMatch[1])}`;
  if (/^@?[A-Za-z0-9_]{3,}$/.test(trimmed)) return `https://web.telegram.org/a/#@${trimmed.replace(/^@/, '')}`;
  return trimmed;
}

function telegramNextCommands(href: string | undefined): Record<string, string> | undefined {
  if (!href) return undefined;
  return {
    open: `siteflow telegram open '${href}'`,
    messages: `siteflow telegram messages '${href}' --limit 50`,
    links: `siteflow telegram links '${href}' --limit 50`,
  };
}

async function collectMessages(ctx: SiteCommandContext, url: string, limit: number): Promise<{
  url: string;
  title: string;
  channel?: {
    title?: string;
    username?: string;
    description?: string;
    members?: string;
  };
  blocked: boolean;
  blockSignals: string[];
  messages: Array<{
    id?: string;
    postId?: string;
    author?: string;
    text?: string;
    date?: string;
    views?: string;
    link?: string;
    mediaCount: number;
    hasUnsupportedMedia: boolean;
  }>;
}> {
  const page = await openSitePage(ctx.profile, url);
  await sleep(1800);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const title = document.title;
    const bodyText = document.body.innerText || '';
    const blockSignals = [];
    if (/too many requests|try again later/i.test(bodyText)) blockSignals.push('rate_limited_text');
    if (/login|sign in|open in telegram/i.test(bodyText) && !document.querySelector('.tgme_widget_message')) blockSignals.push('no_public_messages');
    const headerTitle = clean(document.querySelector('.tgme_channel_info_header_title')?.textContent);
    const username = clean(document.querySelector('.tgme_channel_info_header_username')?.textContent);
    const description = clean(document.querySelector('.tgme_channel_info_description')?.textContent);
    const members = clean(document.querySelector('.tgme_channel_info_counter')?.textContent);
    const messages = Array.from(document.querySelectorAll('.tgme_widget_message')).slice(0, ${JSON.stringify(limit)}).map(message => {
      const dataPost = message.getAttribute('data-post') || undefined;
      const dateLink = message.querySelector('.tgme_widget_message_date');
      const link = dateLink ? abs(dateLink.getAttribute('href') || '') : undefined;
      const postId = dataPost?.split('/').pop() || link?.split('/').pop();
      const text = clean(message.querySelector('.tgme_widget_message_text')?.innerText || '');
      const mediaCount = message.querySelectorAll('.tgme_widget_message_photo_wrap, .tgme_widget_message_video_wrap, .tgme_widget_message_document_wrap').length;
      return {
        id: dataPost,
        postId,
        author: clean(message.querySelector('.tgme_widget_message_author_name')?.textContent) || undefined,
        text: text || undefined,
        date: message.querySelector('time')?.getAttribute('datetime') || undefined,
        views: clean(message.querySelector('.tgme_widget_message_views')?.textContent) || undefined,
        link,
        mediaCount,
        hasUnsupportedMedia: mediaCount > 0 && !text
      };
    });
    return {
      url: location.href,
      title,
      channel: { title: headerTitle || undefined, username: username || undefined, description: description || undefined, members: members || undefined },
      blocked: blockSignals.length > 0,
      blockSignals,
      messages
    };
  })()`, page.id);
  const value = result.value as {
    url: string;
    title: string;
    channel?: { title?: string; username?: string; description?: string; members?: string };
    blocked: boolean;
    blockSignals: string[];
    messages: Array<{ id?: string; postId?: string; author?: string; text?: string; date?: string; views?: string; link?: string; mediaCount: number; hasUnsupportedMedia: boolean }>;
  };
  const network = await listSiteNetwork(ctx.profile, 120).catch(() => []);
  const rateLimited = network.some(entry => entry.status === 429);
  if (rateLimited) {
    value.blocked = true;
    value.blockSignals = Array.from(new Set([...value.blockSignals, 'rate_limited_network']));
  }
  return value;
}

function receipt(command: string, data: Awaited<ReturnType<typeof collectMessages>>, extra: Record<string, unknown>): SiteReceipt {
  const ok = !data.blocked;
  return {
    site: SITE,
    command,
    ok,
    state: ok ? `${command}_collected` : 'blocked_or_unavailable',
    page: { url: data.url, title: data.title },
    observations: {
      ...extra,
      channel: data.channel,
      messageCount: data.messages.length,
      messages: data.messages,
      blockSignals: data.blockSignals,
      sideEffects: [],
    },
    errors: ok ? [] : [{ code: 'PUBLIC_CONTENT_UNAVAILABLE', message: 'Telegram did not expose public messages for this route, or rate limiting was detected. No login or bypass was attempted.' }],
    next: ok
      ? ['Use siteflow telegram search <channel> <query> for channel-scoped keyword collection.', 'Use siteflow telegram post <channel> <post-id> for a focused public post window.']
      : ['Retry later, use a clearly public channel, or collect manually from a logged-in browser without sharing credentials.'],
  };
}

async function runChannel(ctx: SiteCommandContext, options: ChannelOptions): Promise<SiteReceipt> {
  const channel = normalizeChannel(options.channel);
  const data = await collectMessages(ctx, channelUrl(channel), clampLimit(options.limit));
  return receipt('channel', data, { channelInput: options.channel, normalizedChannel: channel });
}

async function runSearch(ctx: SiteCommandContext, options: SearchOptions): Promise<SiteReceipt> {
  const channel = normalizeChannel(options.channel);
  const query = options.query.trim();
  const data = await collectMessages(ctx, channelUrl(channel, query), clampLimit(options.limit));
  return receipt('search', data, { channelInput: options.channel, normalizedChannel: channel, query });
}

async function runPost(ctx: SiteCommandContext, options: PostOptions): Promise<SiteReceipt> {
  const target = normalizePostTarget(options.target, options.postId);
  const data = await collectMessages(ctx, channelUrl(target.channel, undefined, target.postId), clampLimit(options.limit, 25));
  return receipt('post', data, { targetInput: options.target, normalizedChannel: target.channel, postId: target.postId });
}

async function collectChats(ctx: SiteCommandContext, limit: number): Promise<{
  url: string;
  title: string;
  loggedIn: boolean;
  loginSignals: string[];
  chats: Array<{
    title: string;
    subtitle?: string;
    kindGuess: 'group_or_channel' | 'private_or_unknown' | 'unknown';
    href?: string;
    unread?: string;
  }>;
}> {
  const page = await openSitePage(ctx.profile, 'https://web.telegram.org/a/');
  await sleep(3500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const abs = href => { try { return new URL(href, location.href).href } catch { return href } };
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const bodyText = document.body.innerText || '';
    const loginSignals = [];
    if (/log in to telegram|scan.*qr|phone number|start messaging|country/i.test(bodyText)) loginSignals.push('login_screen');
    const selectors = [
      '.chat-list .ListItem',
      '.LeftMain .ListItem',
      '.TabList .ListItem',
      'a.ListItem-button',
      '[data-peer-id]',
      '[role="listitem"]',
      '.chat-item-clickable'
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(element)) continue;
        seen.add(element);
        const text = clean(element.innerText || element.textContent);
        if (!text || text.length < 2) continue;
        if (/archived chats|saved messages/i.test(text)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 20) continue;
        candidates.push(element);
      }
    }
    const chats = candidates.slice(0, ${JSON.stringify(limit)}).map(element => {
      const lines = clean(element.innerText || element.textContent).split(/\\s{2,}|\\n/).map(clean).filter(Boolean);
      const title =
        clean(element.querySelector('.title, .fullName, h3, h4, [dir="auto"]')?.textContent) ||
        lines[0] ||
        '';
      const subtitle = lines.filter(line => line !== title).slice(0, 2).join(' | ') || undefined;
      const hrefElement = element.matches('a[href]') ? element : element.querySelector('a[href]');
      const href = hrefElement ? abs(hrefElement.getAttribute('href') || '') : undefined;
      const aria = clean(element.getAttribute('aria-label') || '');
      const combined = [title, subtitle, aria, element.className || ''].join(' ');
      const kindGuess = /group|channel|members|subscribers|群|频道|頻道|成員|成员/i.test(combined)
        ? 'group_or_channel'
        : /bot|user|online|last seen|last seen recently/i.test(combined)
          ? 'private_or_unknown'
          : 'unknown';
      const unread = clean(element.querySelector('.badge, .unread, .UnreadBadge, [class*="unread"], [class*="badge"]')?.textContent) || undefined;
      return { title, subtitle, kindGuess, href, unread, nextCommands: ${telegramNextCommands.toString()}(href) };
    }).filter(chat => chat.title);
    return {
      url: location.href,
      title: document.title,
      loggedIn: loginSignals.length === 0 && chats.length > 0,
      loginSignals,
      chats
    };
  })()`, page.id);
  return result.value as {
    url: string;
    title: string;
    loggedIn: boolean;
    loginSignals: string[];
    chats: Array<{ title: string; subtitle?: string; kindGuess: 'group_or_channel' | 'private_or_unknown' | 'unknown'; href?: string; unread?: string }>;
  };
}

async function runChats(ctx: SiteCommandContext, options: ChatsOptions): Promise<SiteReceipt> {
  const data = await collectChats(ctx, clampLimit(options.limit, 50, 200));
  return {
    site: SITE,
    command: 'chats',
    ok: data.loggedIn,
    state: data.loggedIn ? 'chats_collected' : 'login_required_or_empty',
    page: { url: data.url, title: data.title },
    observations: {
      loggedIn: data.loggedIn,
      loginSignals: data.loginSignals,
      chatCount: data.chats.length,
      chats: data.chats,
      includePreview: true,
      privacy: 'Visible chat-list previews are included by default. Message bodies are only returned by `telegram messages`.',
      sideEffects: [],
    },
    errors: data.loggedIn ? [] : [{ code: 'LOGIN_REQUIRED', message: 'Telegram Web is not logged in for this siteflow profile, or the visible chat list was empty. Log in manually in the browser profile, then rerun.' }],
    next: data.loggedIn
      ? ['Use the returned href directly with siteflow telegram open/messages/links.']
      : ['Run siteflow --profile <name> browser open https://web.telegram.org/a/ and complete Telegram login manually, then rerun siteflow telegram chats.'],
  };
}

async function openWebTarget(ctx: SiteCommandContext, target: string, pageId?: number): Promise<{
  url: string;
  title: string;
  pageId?: number;
  header?: string;
  hasMessagePane: boolean;
  hasComposer: boolean;
}> {
  const url = webChatUrl(target);
  const page = await openOrNavigateSitePage(ctx.profile, url, pageId ? String(pageId) : undefined);
  await sleep(2500);
  const result = await evaluateSiteExpression(ctx.profile, `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      header: clean(document.querySelector('.MiddleHeader, [class*="MiddleHeader"], .chat-info')?.innerText || '') || undefined,
      hasMessagePane: Boolean(document.querySelector('.MessageList, [class*="MessageList"], [class*="message-list"], [data-message-id], .Message')),
      hasComposer: Boolean(document.querySelector('[contenteditable="true"], textarea, input[type="text"]'))
    };
  })()`, page.pageId);
  return { ...(result.value as { url: string; title: string; header?: string; hasMessagePane: boolean; hasComposer: boolean }), pageId: page.pageId };
}

async function runOpen(ctx: SiteCommandContext, options: WebTargetOptions): Promise<SiteReceipt> {
  const data = await openWebTarget(ctx, options.target, parseSitePageId(options.pageId));
  return {
    site: SITE,
    command: 'open',
    ok: data.hasMessagePane,
    state: data.hasMessagePane ? 'chat_opened' : 'chat_not_loaded',
    page: { url: data.url, title: data.title },
    observations: {
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      header: data.header,
      hasMessagePane: data.hasMessagePane,
      hasComposer: data.hasComposer,
      pageId: data.pageId,
      sideEffects: [],
    },
    errors: data.hasMessagePane ? [] : [{ code: 'CHAT_NOT_LOADED', message: 'Telegram Web did not expose a message pane for this target.' }],
    next: data.hasMessagePane
      ? ['Use siteflow telegram messages <chat-url> to read visible messages.', 'Use siteflow telegram links <chat-url> to list links from visible messages.']
      : ['Verify the account can access this chat, or pass a web.telegram.org/a/#<peer> URL copied from the visible chat list.'],
  };
}

async function collectWebMessages(ctx: SiteCommandContext, options: WebMessagesOptions): Promise<{
  url: string;
  title: string;
  header?: string;
  messages: WebCollectedMessage[];
  linkCount: number;
  rawCandidateCount: number;
  pagesRead: number;
  direction: 'up' | 'down';
  pageId?: number;
  stopReason: 'target_reached' | 'edge_reached' | 'max_pages' | 'no_scroll_requested';
}> {
  const opened = await openWebTarget(ctx, options.target, parseSitePageId(options.pageId));
  const pageId = opened.pageId;
  const limit = clampLimit(options.limit, 50, 500);
  const pages = clampPages(options.pages);
  const direction = scrollDirection(options.direction);
  const minMessages = messageTargetCount(options.minMessages);
  let pagesRead = 0;
  let stopReason: 'target_reached' | 'edge_reached' | 'max_pages' | 'no_scroll_requested' = pages > 0 ? 'max_pages' : 'no_scroll_requested';
  let lastSnapshot: {
    url: string;
    title: string;
    header?: string;
    messages: WebCollectedMessage[];
    linkCount: number;
    rawCandidateCount: number;
  } | undefined;
  const collected = new Map<string, WebCollectedMessage>();
  const collectSnapshot = async (): Promise<void> => {
    const snapshot = await evaluateSiteExpression(ctx.profile, `(() => {
      const abs = href => { try { return new URL(href, location.href).href } catch { return href || '' } };
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const candidates = Array.from(document.querySelectorAll('.Message.message-list-item, [data-message-id]'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          const text = clean(element.innerText || element.textContent);
          return rect.width > 80 && rect.height > 16 && text;
        });
      const unique = [];
      const seen = new Set();
      for (const element of candidates) {
        const text = clean(element.innerText || element.textContent);
        const id = element.getAttribute('data-message-id') || element.id || '';
        const time = element.querySelector('time')?.getAttribute('datetime') || clean(element.querySelector('[class*="time"], .time')?.textContent || '');
        const rect = element.getBoundingClientRect();
        const key = id || [text.slice(0, 180), time, Math.round(rect.top), Math.round(rect.height)].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(element);
      }
      const messages = unique.map((element, messageIndex) => {
        const rawText = clean(element.innerText || element.textContent);
        const links = Array.from(element.querySelectorAll('a[href]'))
          .map((anchor, linkIndex) => ({
            index: linkIndex,
            text: clean(anchor.textContent || ''),
            url: abs(anchor.getAttribute('href') || '')
          }))
          .filter(link => link.url && !/^javascript:/i.test(link.url));
        const media = Array.from(element.querySelectorAll('img, video, canvas, source, a[href]'))
          .map((mediaElement, mediaIndex) => {
            const tag = mediaElement.tagName.toLowerCase();
            const className = String(mediaElement.className || '');
            const linkElement = mediaElement.matches('a[href]') ? mediaElement : mediaElement.closest('a[href]');
            const href = linkElement ? abs(linkElement.getAttribute('href') || '') : undefined;
            const src = mediaElement.currentSrc || mediaElement.src || mediaElement.getAttribute('poster') || mediaElement.getAttribute('src') || undefined;
            const type = tag === 'img'
              ? 'image'
              : tag === 'video'
                ? 'video'
                : tag === 'canvas'
                  ? 'canvas'
                  : tag === 'source'
                    ? 'source'
                  : /document/i.test(className)
                    ? 'document'
                    : /video/i.test(className)
                      ? 'video'
                      : /photo|image/i.test(className)
                        ? 'image'
                        : 'unknown';
            return {
              index: mediaIndex,
              type,
              src,
              href,
              aria: clean(mediaElement.getAttribute('aria-label') || mediaElement.getAttribute('title') || '') || undefined,
              className: className.slice(0, 160) || undefined
            };
          })
          .filter(item => !/avatar|emoji|sender/i.test(item.className || ''))
          .filter(item => item.type !== 'unknown' || /blob:|data:image|\\/file|\\/document|\\/video/i.test([item.src, item.href].filter(Boolean).join(' ')));
        return {
          index: messageIndex,
          id: element.getAttribute('data-message-id') || element.id || undefined,
          text: rawText.slice(0, 4000),
          textLength: rawText.length,
          time: element.querySelector('time')?.getAttribute('datetime') || clean(element.querySelector('[class*="time"], .time')?.textContent || '') || undefined,
          links,
          mediaCount: media.length,
          media
        };
      });
      return {
        url: location.href,
        title: document.title,
        header: clean(document.querySelector('.MiddleHeader, [class*="MiddleHeader"], .chat-info')?.innerText || '') || undefined,
        messages,
        linkCount: messages.reduce((total, message) => total + message.links.length, 0),
        rawCandidateCount: candidates.length
      };
    })()`, pageId);
    lastSnapshot = snapshot.value as typeof lastSnapshot;
    for (const message of lastSnapshot?.messages || []) {
      const key = message.id || [message.text?.slice(0, 180), message.time].join('|');
      if (!collected.has(key)) collected.set(key, { ...message, index: collected.size });
    }
  };
  await collectSnapshot();

  for (let page = 0; page < pages; page += 1) {
    const before = await evaluateSiteExpression(ctx.profile, `(() => {
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const countMessages = () => Array.from(document.querySelectorAll('.Message.message-list-item, [data-message-id]'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          const text = clean(element.innerText || element.textContent);
          return rect.width > 80 && rect.height > 16 && text;
        }).length;
      const findScroller = () => {
        const messageLists = Array.from(document.querySelectorAll('.MessageList, [class*="MessageList"]'))
          .filter(element => element.scrollHeight > element.clientHeight + 80);
        if (messageLists.length) return messageLists[0];
        const candidates = [];
        candidates.push(...Array.from(document.querySelectorAll('div')).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height > 240 && element.scrollHeight > element.clientHeight + 80 && element.querySelector('.Message.message-list-item, [data-message-id]');
        }));
        return candidates.find(element => element.scrollHeight > element.clientHeight + 80) || document.scrollingElement || document.documentElement;
      };
      const scroller = findScroller();
      return { count: countMessages(), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    })()`, pageId);
    const beforeState = before.value as { count?: number; scrollTop?: number; scrollHeight?: number; clientHeight?: number };
    if (minMessages > 0 && collected.size >= minMessages) {
      stopReason = 'target_reached';
      break;
    }
    const beforeCollectedSize = collected.size;

    const scrollResult = await evaluateSiteExpression(ctx.profile, `(() => {
      const findScroller = () => {
        const messageLists = Array.from(document.querySelectorAll('.MessageList, [class*="MessageList"]'))
          .filter(element => element.scrollHeight > element.clientHeight + 80);
        if (messageLists.length) return messageLists[0];
        const candidates = [];
        candidates.push(...Array.from(document.querySelectorAll('div')).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height > 240 && element.scrollHeight > element.clientHeight + 80 && element.querySelector('.Message.message-list-item, [data-message-id]');
        }));
        return candidates.find(element => element.scrollHeight > element.clientHeight + 80) || document.scrollingElement || document.documentElement;
      };
      const scroller = findScroller();
      const beforeTop = scroller.scrollTop;
      const amount = Math.max(240, Math.floor((scroller.clientHeight || window.innerHeight || 700) * 0.85));
      scroller.scrollBy({ top: ${JSON.stringify(direction)} === 'up' ? -amount : amount, behavior: 'auto' });
      return { beforeTop, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    })()`, pageId);
    pagesRead += 1;
    await sleep(900);
    await collectSnapshot();
    if (minMessages > 0 && collected.size >= minMessages) {
      stopReason = 'target_reached';
      break;
    }
    const after = await evaluateSiteExpression(ctx.profile, `(() => {
      const findScroller = () => {
        const messageLists = Array.from(document.querySelectorAll('.MessageList, [class*="MessageList"]'))
          .filter(element => element.scrollHeight > element.clientHeight + 80);
        if (messageLists.length) return messageLists[0];
        const candidates = [];
        candidates.push(...Array.from(document.querySelectorAll('div')).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height > 240 && element.scrollHeight > element.clientHeight + 80 && element.querySelector('.Message.message-list-item, [data-message-id]');
        }));
        return candidates.find(element => element.scrollHeight > element.clientHeight + 80) || document.scrollingElement || document.documentElement;
      };
      const scroller = findScroller();
      return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    })()`, pageId);
    const scrollState = scrollResult.value as { beforeTop?: number; scrollTop?: number; scrollHeight?: number; clientHeight?: number };
    const afterState = after.value as { scrollTop?: number; scrollHeight?: number; clientHeight?: number };
    const oldTop = beforeState.scrollTop ?? scrollState.beforeTop ?? 0;
    const newTop = afterState.scrollTop ?? scrollState.scrollTop ?? 0;
    const moved = Math.abs(newTop - oldTop) > 4;
    const atTop = newTop <= 4;
    const atBottom = newTop + (afterState.clientHeight || 0) >= (afterState.scrollHeight || 0) - 4;
    const collectedNewMessages = collected.size > beforeCollectedSize;
    if (!collectedNewMessages && (!moved || (direction === 'up' && atTop) || (direction === 'down' && atBottom))) {
      stopReason = 'edge_reached';
      break;
    }
  }

  await collectSnapshot();
  const messages = Array.from(collected.values()).slice(-limit).map((message, index) => ({ ...message, index }));
  return {
    url: lastSnapshot?.url || webChatUrl(options.target),
    title: lastSnapshot?.title || '',
    header: lastSnapshot?.header,
    messages,
    linkCount: messages.reduce((total, message) => total + message.links.length, 0),
    rawCandidateCount: collected.size,
    pagesRead,
    direction,
    pageId,
    stopReason,
  };
}

async function runMessages(ctx: SiteCommandContext, options: WebMessagesOptions): Promise<SiteReceipt> {
  const data = await collectWebMessages(ctx, options);
  return {
    site: SITE,
    command: 'messages',
    ok: data.messages.length > 0,
    state: data.messages.length > 0 ? 'messages_collected' : 'messages_empty',
    page: { url: data.url, title: data.title },
    observations: {
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      header: data.header,
      rawCandidateCount: data.rawCandidateCount,
      messageCount: data.messages.length,
      linkCount: data.linkCount,
      pagesRead: data.pagesRead,
      direction: data.direction,
      pageId: data.pageId,
      minMessages: messageTargetCount(options.minMessages),
      stopReason: data.stopReason,
      messages: data.messages,
      sideEffects: [],
    },
    errors: data.messages.length > 0 ? [] : [{ code: 'NO_VISIBLE_MESSAGES', message: 'No visible Telegram messages were collected from the current chat view.' }],
    next: ['Use siteflow telegram open-link <chat-url> <link-index> to open a collected link.'],
  };
}

async function runLinks(ctx: SiteCommandContext, options: WebMessagesOptions): Promise<SiteReceipt> {
  const data = await collectWebMessages(ctx, options);
  const links = data.messages.flatMap(message => message.links.map(link => ({
    globalIndex: 0,
    messageIndex: message.index,
    linkIndex: link.index,
    text: link.text,
    url: link.url,
  }))).map((link, index) => ({ ...link, globalIndex: index }));
  return {
    site: SITE,
    command: 'links',
    ok: links.length > 0,
    state: links.length > 0 ? 'links_collected' : 'links_empty',
    page: { url: data.url, title: data.title },
    observations: {
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      messageCount: data.messages.length,
      linkCount: links.length,
      links,
      sideEffects: [],
    },
    errors: links.length > 0 ? [] : [{ code: 'NO_VISIBLE_LINKS', message: 'No links were found in the visible Telegram messages.' }],
    next: links.length > 0 ? ['Use siteflow telegram open-link <peer-or-url> --link-index 0 to open one link.'] : ['Scroll the chat manually or increase --limit, then retry.'],
  };
}

async function runMedia(ctx: SiteCommandContext, options: WebMessagesOptions): Promise<SiteReceipt> {
  const data = await collectWebMessages(ctx, options);
  const mediaMessages = data.messages
    .filter(message => message.mediaCount > 0)
    .map((message, index) => ({
      index,
      messageIndex: message.index,
      messageId: message.id,
      time: message.time,
      textPreview: message.text?.slice(0, 160),
      textLength: message.textLength,
      mediaCount: message.mediaCount,
      media: message.media,
      links: message.links,
    }));
  const mediaCount = mediaMessages.reduce((total, message) => total + message.mediaCount, 0);
  return {
    site: SITE,
    command: 'media',
    ok: mediaMessages.length > 0,
    state: mediaMessages.length > 0 ? 'media_collected' : 'media_empty',
    page: { url: data.url, title: data.title },
    observations: {
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      header: data.header,
      messageCount: data.messages.length,
      mediaMessageCount: mediaMessages.length,
      mediaCount,
      linkCount: data.linkCount,
      rawCandidateCount: data.rawCandidateCount,
      pagesRead: data.pagesRead,
      direction: data.direction,
      pageId: data.pageId,
      minMessages: messageTargetCount(options.minMessages),
      stopReason: data.stopReason,
      mediaMessages,
      sideEffects: [],
    },
    errors: mediaMessages.length > 0 ? [] : [{ code: 'NO_VISIBLE_MEDIA', message: 'No media-bearing Telegram messages were found in the collected message window.' }],
    next: ['Use siteflow telegram messages <chat-url> with the same scroll options to inspect full message context.'],
  };
}

async function resolveWatchPageId(ctx: SiteCommandContext, target: string, requestedPageId?: number): Promise<number | undefined> {
  const normalizedUrl = webChatUrl(target);
  await openWebTarget(ctx, target, requestedPageId);
  const pages = await listSitePages(ctx.profile).catch(() => []);
  const selected = pages.find(page => page.selected && page.url.startsWith(normalizedUrl));
  const matching = pages.find(page => page.url.startsWith(normalizedUrl));
  return requestedPageId || selected?.id || matching?.id;
}

async function runWatch(ctx: SiteCommandContext, options: WatchOptions): Promise<SiteReceipt> {
  const durationMs = parseDurationMs(options.duration, 3_600_000, 24 * 3_600_000);
  const intervalMs = parseDurationMs(options.interval, 60_000, 3_600_000);
  const maxMessages = clampTotalMessages(options.maxMessages);
  const pageId = await resolveWatchPageId(ctx, options.target, parseSitePageId(options.pageId));
  const startedAt = new Date();
  const deadline = Date.now() + durationMs;
  const outputPath = options.out ? path.resolve(options.out) : undefined;
  const seen = new Set<string>();
  const messages: WebCollectedMessage[] = [];
  const batches: Array<{
    index: number;
    startedAt: string;
    finishedAt: string;
    messageCount: number;
    newMessageCount: number;
    firstId?: string;
    lastId?: string;
    pagesRead: number;
    stopReason: string;
  }> = [];
  const writeOutput = async (): Promise<void> => {
    if (!outputPath) return;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify({
      site: SITE,
      command: 'watch',
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      pageId,
      durationMs,
      intervalMs,
      startedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      batchCount: batches.length,
      messageCount: messages.length,
      maxMessages,
      direction: 'down',
      batches,
      messages,
    }, null, 2));
  };

  for (let batchIndex = 0; Date.now() < deadline && messages.length < maxMessages; batchIndex += 1) {
    const batchStartedAt = new Date();
    const data = await collectWebMessages(ctx, {
      ...options,
      pageId: pageId ? String(pageId) : options.pageId,
      direction: 'down',
      minMessages: options.minMessages,
    });
    let newMessageCount = 0;
    for (const message of data.messages) {
      const key = message.id || [message.text?.slice(0, 180), message.time].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ ...message, index: messages.length });
      newMessageCount += 1;
      if (messages.length >= maxMessages) break;
    }
    batches.push({
      index: batchIndex,
      startedAt: batchStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      messageCount: data.messages.length,
      newMessageCount,
      firstId: data.messages[0]?.id,
      lastId: data.messages.at(-1)?.id,
      pagesRead: data.pagesRead,
      stopReason: data.stopReason,
    });
    await writeOutput();
    if (Date.now() >= deadline || messages.length >= maxMessages) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  const endedAt = new Date();
  await writeOutput();
  return {
    site: SITE,
    command: 'watch',
    ok: batches.length > 0,
    state: batches.length > 0 ? 'watch_completed' : 'watch_empty',
    page: { url: webChatUrl(options.target), title: '' },
    observations: {
      targetInput: options.target,
      normalizedUrl: webChatUrl(options.target),
      pageId,
      durationMs,
      intervalMs,
      outputPath,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      batchCount: batches.length,
      messageCount: messages.length,
      maxMessages,
      direction: 'down',
      batches,
      messages: outputPath ? [] : messages,
      storedMessageCount: outputPath ? messages.length : undefined,
      sideEffects: outputPath ? ['browser_navigation', 'timed_polling', 'file_write'] : ['browser_navigation', 'timed_polling'],
    },
    errors: [],
    next: ['Increase --duration for a longer watch window, or reduce --interval for faster polling.'],
  };
}

async function runOpenLink(ctx: SiteCommandContext, options: OpenLinkOptions): Promise<SiteReceipt> {
  const data = await collectWebMessages(ctx, { ...options, limit: '50' });
  const links = data.messages.flatMap(message => message.links.map(link => ({
    messageIndex: message.index,
    linkIndex: link.index,
    text: link.text,
    url: link.url,
  })));
  const linkIndex = clampIndex(options.linkIndex, 0, Math.max(links.length - 1, 0));
  const selected = links[linkIndex];
  if (!selected) {
    return {
      site: SITE,
      command: 'open-link',
      ok: false,
      state: 'link_not_found',
      page: { url: data.url, title: data.title },
      observations: {
        targetInput: options.target,
        requestedLinkIndex: options.linkIndex ?? '0',
        linkCount: links.length,
        sideEffects: [],
      },
      errors: [{ code: 'LINK_NOT_FOUND', message: 'No visible link exists at the requested index.' }],
      next: ['Run siteflow telegram links <peer-or-url> to inspect available link indexes.'],
    };
  }
  const opened = await openSitePage(ctx.profile, selected.url);
  return {
    site: SITE,
    command: 'open-link',
    ok: true,
    state: 'link_opened',
    page: { url: opened.url, title: opened.title },
    observations: {
      targetInput: options.target,
      requestedLinkIndex: linkIndex,
      sourceMessageIndex: selected.messageIndex,
      sourceLinkIndex: selected.linkIndex,
      selectedLink: selected,
      sideEffects: ['browser_navigation'],
    },
    errors: [],
    next: ['Use browser back or reopen the Telegram peer to continue browsing messages.'],
  };
}

export const telegramAdapter: SiteAdapter = {
  id: SITE,
  title: 'Telegram',
  description: 'Read-only Telegram collection for public t.me/s channels and local logged-in chat-list metadata.',
  commands: [
    {
      name: 'chats',
      description: 'List visible Telegram Web chats for a manually logged-in local profile',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'number of visible chats to return', '50')
          .action(async function () {
            await runSiteCommand(this, ctx => runChats(ctx, this.opts<ChatsOptions>()));
          });
      },
    },
    {
      name: 'open',
      description: 'Open a Telegram Web chat, channel, bot, or peer URL for a logged-in profile',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases'))
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runOpen(ctx, { ...this.opts<Omit<WebTargetOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'messages',
      description: 'Collect visible messages from a logged-in Telegram Web chat without sending anything',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases')
          .option('--limit <n>', 'number of visible deduped messages to return', '50')
          .option('--pages <n>', 'number of scroll pages before collecting messages', '0')
          .option('--direction <up|down>', 'scroll direction before collecting messages', 'up'))
          .option('--min-messages <n>', 'keep scrolling until at least this many visible messages are collected, or the scroll edge/max pages is reached')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runMessages(ctx, { ...this.opts<Omit<WebMessagesOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'links',
      description: 'List links found in visible messages from a logged-in Telegram Web chat',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases')
          .option('--limit <n>', 'number of visible deduped messages to inspect', '50')
          .option('--pages <n>', 'number of scroll pages before collecting links', '0')
          .option('--direction <up|down>', 'scroll direction before collecting links', 'up'))
          .option('--min-messages <n>', 'keep scrolling until at least this many visible messages are collected, or the scroll edge/max pages is reached')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runLinks(ctx, { ...this.opts<Omit<WebMessagesOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'media',
      description: 'List media-bearing messages and visible media clues from a logged-in Telegram Web chat',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases')
          .option('--limit <n>', 'number of visible deduped messages to inspect', '50')
          .option('--pages <n>', 'number of scroll pages before collecting media', '0')
          .option('--direction <up|down>', 'scroll direction before collecting media', 'up'))
          .option('--min-messages <n>', 'keep scrolling until at least this many visible messages are collected, or the scroll edge/max pages is reached')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runMedia(ctx, { ...this.opts<Omit<WebMessagesOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'watch',
      description: 'Watch a Telegram Web chat for new visible messages by polling and scrolling downward',
      configure(command: Command): void {
        addSitePageIdOption(command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases')
          .option('--duration <time>', 'total watch duration, for example 30m, 1h, 2小时', '1h')
          .option('--interval <time>', 'sleep time between polling rounds, for example 30s, 2m', '60s')
          .option('--limit <n>', 'number of deduped messages to inspect per polling round', '50')
          .option('--pages <n>', 'number of downward scroll pages per polling round', '3'))
          .option('--min-messages <n>', 'per-round target messages before stopping that polling round')
          .option('--max-messages <n>', 'maximum deduped messages returned across the whole watch run', '1000')
          .option('--out <file>', 'write watch data to a JSON file after every polling round')
          .action(async function (target: string) {
            await runSiteCommand(this, ctx => runWatch(ctx, { ...this.opts<Omit<WatchOptions, 'target'>>(), target }));
          });
      },
    },
    {
      name: 'open-link',
      description: 'Open one link from visible Telegram messages by global link index',
      configure(command: Command): void {
        command
          .argument('<chat-url>', 'Telegram Web chat URL from `telegram chats` href; peer id, @username, and t.me URL are accepted as aliases')
          .argument('[link-index]', 'global link index from siteflow telegram links', '0')
          .action(async function (target: string, linkIndex: string) {
            await runSiteCommand(this, ctx => runOpenLink(ctx, { target, linkIndex }));
          });
      },
    },
    {
      name: 'channel',
      description: 'Collect visible posts from a public Telegram channel mirror',
      configure(command: Command): void {
        command
          .argument('<channel-or-url>', 'public channel username, @handle, or t.me/s URL')
          .option('--limit <n>', 'number of visible posts to return', '20')
          .action(async function (channel: string) {
            await runSiteCommand(this, ctx => runChannel(ctx, { ...this.opts<Pick<ChannelOptions, 'limit'>>(), channel }));
          });
      },
    },
    {
      name: 'search',
      description: 'Search within one public Telegram channel mirror',
      configure(command: Command): void {
        command
          .argument('<channel-or-url>', 'public channel username, @handle, or t.me/s URL')
          .argument('<query>', 'keyword to search inside the channel')
          .option('--limit <n>', 'number of visible posts to return', '20')
          .action(async function (channel: string, query: string) {
            await runSiteCommand(this, ctx => runSearch(ctx, { ...this.opts<Pick<SearchOptions, 'limit'>>(), channel, query }));
          });
      },
    },
    {
      name: 'post',
      description: 'Collect a public Telegram post window by channel/post id or t.me URL',
      configure(command: Command): void {
        command
          .argument('<channel-or-url>', 'public channel username, channel/post id, or t.me URL')
          .argument('[post-id]', 'post id when the first argument is only a channel')
          .option('--limit <n>', 'number of visible surrounding posts to return', '25')
          .action(async function (target: string, postId?: string) {
            await runSiteCommand(this, ctx => runPost(ctx, { ...this.opts<Pick<PostOptions, 'limit'>>(), target, postId }));
          });
      },
    },
  ],
};
