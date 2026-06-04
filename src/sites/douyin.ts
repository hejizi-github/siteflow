import type { Command } from 'commander';
import {
  runSiteCommand,
  uploadSiteTarget,
  captureSiteScreenshot,
  clickSiteTarget,
  ensureSitePage,
  evaluateSiteExpression,
  readSiteSnapshot,
  sleep,
  typeIntoSiteTarget,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

interface DouyinImageDraftOptions {
  title?: string;
  body?: string;
  image?: string[];
  topic?: string[];
  resumeExisting?: boolean;
  saveDraft?: boolean;
  publish?: boolean;
  screenshot?: string;
}

interface DouyinVideoDraftOptions {
  title?: string;
  body?: string;
  video?: string;
  topic?: string[];
  resumeExisting?: boolean;
  saveDraft?: boolean;
  publish?: boolean;
  screenshot?: string;
}

interface DouyinArticleDraftOptions {
  title?: string;
  summary?: string;
  body?: string;
  resumeExisting?: boolean;
  saveDraft?: boolean;
  publish?: boolean;
  screenshot?: string;
}

interface DouyinReadOptions {
  limit?: string;
  range?: string;
  type?: string;
}

const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
const WORKS_URL = 'https://creator.douyin.com/creator-micro/content/manage';
const OVERVIEW_URL = 'https://creator.douyin.com/creator-micro/data-center/operation';
const CONTENT_ANALYTICS_URL = 'https://creator.douyin.com/creator-micro/data-center/content';
const INSPIRATION_URL = 'https://creator.douyin.com/creator-micro/creative-guidance';
const INDEX_URL = 'https://creator.douyin.com/creator-micro/creator-count/arithmetic-index';

async function openUploadPage(profile: string): Promise<void> {
  await ensureSitePage(profile, UPLOAD_URL, 'creator.douyin.com');
  await sleep(2500);
  const page = await readSiteSnapshot(profile);
  if (!page.url.includes('/content/upload')) {
    await ensureSitePage(profile, UPLOAD_URL, 'creator.douyin.com/creator-micro/content/upload');
    await sleep(2500);
  }
}

function isAuthRequired(text: string, url: string): boolean {
  const loginSignals = /扫码|验证码|手机号登录|发送验证码|登录即同意|创作者专属功能/.test(text) || text.includes('登 录') || text.includes('登录');
  const authenticatedSignals = /发布视频|发布图文|发布文章|发布全景视频|你还有上次未发布的/.test(text);
  return url.includes('/login') || (loginSignals && !authenticatedSignals);
}

function toLimit(value: string | undefined, fallback = 20, max = 100): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function findFollowing(lines: string[], label: string): string | undefined {
  const index = lines.findIndex(line => line === label || line.startsWith(`${label}:`) || line.startsWith(`${label}：`));
  if (index < 0) return undefined;
  const inline = lines[index].match(new RegExp(`^${label}[:：]\\s*(.+)$`));
  return inline?.[1] || lines[index + 1];
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some(pattern => text.includes(pattern));
}

async function pageData(profile: string, maxText = 30_000): Promise<{ url: string; title: string; text: string }> {
  const result = await evaluateSiteExpression(profile, `({ url: location.href, title: document.title, text: document.body.innerText.slice(0, ${JSON.stringify(maxText)}) })`);
  const value = result.value as { url?: unknown; title?: unknown; text?: unknown };
  return {
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
    text: typeof value.text === 'string' ? value.text : '',
  };
}

async function switchToImageTab(profile: string): Promise<void> {
  await clickSiteTarget(profile, { text: '我知道了', timeoutMs: 3000 }).catch(() => undefined);
  await clickSiteTarget(profile, { text: '发布图文', timeoutMs: 10_000 });
  await sleep(1500);
}

async function switchToVideoTab(profile: string): Promise<void> {
  await clickSiteTarget(profile, { text: '我知道了', timeoutMs: 3000 }).catch(() => undefined);
  await clickSiteTarget(profile, { text: '发布视频', timeoutMs: 10_000 });
  await sleep(1500);
}

async function switchToArticleTab(profile: string): Promise<void> {
  await clickSiteTarget(profile, { text: '发布文章', timeoutMs: 10_000 });
  await sleep(1500);
}

function mutuallyExclusivePublishAndDraft(options: { publish?: boolean; saveDraft?: boolean }): SiteReceipt | null {
  if (!options.publish || !options.saveDraft) return null;
  return {
    site: 'douyin',
    command: 'publish',
    ok: false,
    state: 'invalid_options',
    errors: [{ code: 'INVALID_OPTIONS', message: '--publish and --save-draft are mutually exclusive.' }],
    next: ['Use --publish for real publication, or --save-draft for temporary storage.'],
  };
}

async function finishAction(profile: string, options: { publish?: boolean; saveDraft?: boolean }): Promise<string> {
  if (options.publish) {
    await clickSiteTarget(profile, { text: '发布', timeoutMs: 10_000 });
    await sleep(8000);
    return 'publish_clicked';
  }
  if (options.saveDraft) {
    await clickSiteTarget(profile, { text: '暂存离开', timeoutMs: 10_000 });
    await sleep(4000);
    return 'draft_saved_publish_not_clicked';
  }
  return 'draft_filled_publish_not_clicked';
}

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  await openUploadPage(ctx.profile);
  const page = await readSiteSnapshot(ctx.profile);
  return {
    site: 'douyin',
    command: 'status',
    ok: !isAuthRequired(page.text, page.url),
    state: isAuthRequired(page.text, page.url) ? 'auth_required' : 'observed',
    page: { url: page.url, title: page.title },
    observations: {
      hasVideoPublish: page.text.includes('发布视频'),
      hasImagePublish: page.text.includes('发布图文'),
      hasPanoramaPublish: page.text.includes('发布全景视频'),
      hasArticlePublish: page.text.includes('发布文章'),
      existingUnpublished: {
        image: page.text.includes('你还有上次未发布的图文'),
        video: page.text.includes('你还有上次未发布的视频'),
        article: page.text.includes('你还有上次未发布的文章'),
        panorama: page.text.includes('你还有上次未发布的全景视频'),
      },
      hasExistingDraft: hasAny(page.text, [
        '你还有上次未发布的图文',
        '你还有上次未发布的视频',
        '你还有上次未发布的文章',
        '你还有上次未发布的全景视频',
      ]),
      textExcerpt: page.text.slice(0, 3000),
    },
    next: isAuthRequired(page.text, page.url)
      ? ['Log in in the visible browser, then rerun siteflow douyin status.']
      : ['Use siteflow douyin image, siteflow douyin video, or siteflow douyin article to publish directly.'],
  };
}

async function runWorks(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, WORKS_URL, '/content/manage');
  await sleep(3500);
  const page = await pageData(ctx.profile);
  if (isAuthRequired(page.text, page.url)) return authReceipt('works', page);
  const limit = toLimit(options.limit, 20, 50);
  const lines = linesOf(page.text);
  const works = parseWorks(lines).slice(0, limit);
  return {
    site: 'douyin',
    command: 'works',
    ok: true,
    state: 'works_collected',
    page: { url: page.url, title: page.title },
    observations: {
      totalText: findFollowing(lines, '共') || lines.find(line => /^共\s*\d+\s*个作品$/.test(line)),
      tabs: ['全部作品', '已发布', '审核中', '未通过'].filter(tab => page.text.includes(tab)),
      count: works.length,
      works,
      textExcerpt: page.text.slice(0, 2000),
    },
    next: ['Use siteflow douyin overview or siteflow douyin content-analytics to diagnose performance.'],
  };
}

async function runOverview(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, OVERVIEW_URL, '/data-center/operation');
  await sleep(4000);
  const page = await pageData(ctx.profile);
  if (isAuthRequired(page.text, page.url)) return authReceipt('overview', page);
  const lines = linesOf(page.text);
  const limit = toLimit(options.limit, 20, 50);
  return {
    site: 'douyin',
    command: 'overview',
    ok: true,
    state: 'overview_collected',
    page: { url: page.url, title: page.title },
    observations: {
      requestedRange: options.range || 'current',
      accountDiagnosis: parseAccountDiagnosis(lines),
      performance: parseOverviewPerformance(lines),
      hotTopics: parseRankedItems(lines, '相关热门话题', '相关热门视频', limit),
      hotVideos: parseRankedItems(lines, '相关热门视频', '数据指标说明', limit),
      textExcerpt: page.text.slice(0, 2500),
    },
    next: ['Use siteflow douyin inspiration and siteflow douyin index for topic selection.'],
  };
}

async function runContentAnalytics(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, CONTENT_ANALYTICS_URL, '/data-center/content');
  await sleep(4000);
  const page = await pageData(ctx.profile);
  if (isAuthRequired(page.text, page.url)) return authReceipt('content-analytics', page);
  const lines = linesOf(page.text);
  return {
    site: 'douyin',
    command: 'content-analytics',
    ok: true,
    state: 'content_analytics_collected',
    page: { url: page.url, title: page.title },
    observations: {
      requestedRange: options.range || 'current',
      overview: parseContentOverview(lines),
      performance: parseSection(lines, '投稿表现', undefined, 80),
      textExcerpt: page.text.slice(0, 3000),
    },
    next: ['Use siteflow douyin works to inspect individual posts, or siteflow douyin inspiration for new topics.'],
  };
}

async function runInspiration(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, INSPIRATION_URL, '/creative-guidance');
  await sleep(4000);
  const page = await pageData(ctx.profile, 40_000);
  if (isAuthRequired(page.text, page.url)) return authReceipt('inspiration', page);
  const lines = linesOf(page.text);
  const limit = toLimit(options.limit, 20, 50);
  return {
    site: 'douyin',
    command: 'inspiration',
    ok: true,
    state: 'inspiration_collected',
    page: { url: page.url, title: page.title },
    observations: {
      tabs: ['创意洞察', '活动日历', '关联视频搜索', '热门视频', '创作热点', '热门话题', '热门挑战', '热门道具', '热门音乐'].filter(tab => page.text.includes(tab)),
      categories: ['美食', '旅行', '泛生活', '汽车', '科技', '游戏', '二次元'].filter(category => page.text.includes(category)),
      sort: findFollowing(lines, '排序 |') || '播放最高',
      period: findFollowing(lines, '时间选择 |') || '24小时',
      hotVideos: parseInspirationVideos(lines, limit),
      textExcerpt: page.text.slice(0, 2500),
    },
    next: ['Use siteflow douyin index for broader realtime and rising hot topics.'],
  };
}

async function runIndex(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, INDEX_URL, '/creator-count/arithmetic-index');
  await sleep(4000);
  const page = await pageData(ctx.profile, 40_000);
  if (isAuthRequired(page.text, page.url)) return authReceipt('index', page);
  const lines = linesOf(page.text);
  const limit = toLimit(options.limit, 30, 100);
  const type = options.type || 'all';
  return {
    site: 'douyin',
    command: 'index',
    ok: true,
    state: 'index_collected',
    page: { url: page.url, title: page.title },
    observations: {
      type,
      tabs: ['创作指南', '趋势报告', '关键词', '达人', '视频', '品牌', '话题', '搜索', '我的订阅'].filter(tab => page.text.includes(tab)),
      realtime: type === 'rising' ? [] : parseIndexItems(lines, '抖音实时热点', '抖音飙升热点', limit),
      rising: type === 'realtime' ? [] : parseIndexItems(lines, '抖音飙升热点', '「巨量算数」已升级为「抖音指数」啦', limit),
      textExcerpt: page.text.slice(0, 2500),
    },
    next: ['Use high-fit topics as input for content planning; verify sensitive news before publishing.'],
  };
}

async function runList(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  const receipt = await runWorks(ctx, options);
  return { ...receipt, command: 'list' };
}

async function runStats(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  const overview = await runOverview(ctx, options);
  const content = await runContentAnalytics(ctx, options);
  return {
    site: 'douyin',
    command: 'stats',
    ok: overview.ok && content.ok,
    state: overview.ok && content.ok ? 'stats_collected' : 'partial',
    page: content.page || overview.page,
    observations: {
      overview: overview.observations,
      contentAnalytics: content.observations,
    },
    errors: [...(overview.errors || []), ...(content.errors || [])],
    next: ['Use siteflow douyin ideas to find topics that fit these performance signals.'],
  };
}

async function runIdeas(ctx: SiteCommandContext, options: DouyinReadOptions): Promise<SiteReceipt> {
  const inspiration = await runInspiration(ctx, options);
  const index = await runIndex(ctx, options);
  return {
    site: 'douyin',
    command: 'ideas',
    ok: inspiration.ok && index.ok,
    state: inspiration.ok && index.ok ? 'ideas_collected' : 'partial',
    page: index.page || inspiration.page,
    observations: {
      inspiration: inspiration.observations,
      index: index.observations,
    },
    errors: [...(inspiration.errors || []), ...(index.errors || [])],
    next: ['Verify sensitive topics before publishing, then use siteflow douyin image/video/article with formal content.'],
  };
}

function authReceipt(command: string, page: { url: string; title: string; text: string }): SiteReceipt {
  return {
    site: 'douyin',
    command,
    ok: false,
    state: 'auth_required',
    page: { url: page.url, title: page.title },
    observations: { textExcerpt: page.text.slice(0, 1200) },
    errors: [{ code: 'DOUYIN_AUTH_REQUIRED', message: 'Douyin creator center requires login.' }],
    next: [`Log in in the visible browser, then rerun siteflow douyin ${command}.`],
  };
}

function parseWorks(lines: string[]): Array<Record<string, unknown>> {
  const works: Array<Record<string, unknown>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index];
    if (!/^(\d{2}:\d{2}|\d+张)$/.test(marker)) continue;
    const dateIndex = lines.findIndex((line, i) => i > index && /^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/.test(line));
    if (dateIndex < 0) continue;
    const chunk = lines.slice(index, Math.min(dateIndex + 14, lines.length));
    works.push({
      media: marker,
      description: lines[index + 1] && !['编辑作品', '设置权限'].includes(lines[index + 1]) ? lines[index + 1] : undefined,
      publishedAt: lines[dateIndex],
      status: chunk.find(line => ['已发布', '审核中', '未通过', '私密'].includes(line)),
      private: chunk.includes('私密'),
      plays: valueAfter(chunk, '播放'),
      likes: valueAfter(chunk, '点赞'),
      comments: valueAfter(chunk, '评论'),
      shares: valueAfter(chunk, '分享'),
      favorites: valueAfter(chunk, '收藏'),
      captionExpandRate: valueAfter(chunk, '文案展开率'),
      averageImagesViewed: valueAfter(chunk, '平均浏览图片'),
      actions: ['编辑作品', '设置权限', '作品置顶', '删除作品'].filter(action => chunk.includes(action)),
    });
  }
  return works;
}

function valueAfter(lines: string[], label: string): string | undefined {
  const index = lines.indexOf(label);
  if (index < 0) return undefined;
  return lines[index + 1];
}

function parseAccountDiagnosis(lines: string[]): string[] {
  const start = lines.indexOf('账号诊断');
  const end = lines.indexOf('短视频');
  if (start < 0) return [];
  return lines.slice(start + 1, end > start ? end : start + 20).filter(line => !/^统计周期/.test(line));
}

function parseOverviewPerformance(lines: string[]): Record<string, unknown> {
  const labels = ['播放量', '主页访问', '作品点赞', '作品分享', '作品评论', '封面点击率', '净增粉丝', '取关粉丝', '总粉丝量'];
  const metrics: Record<string, unknown> = {};
  for (const label of labels) metrics[label] = valueAfter(lines, label);
  return metrics;
}

function parseContentOverview(lines: string[]): Record<string, unknown> {
  const labels = ['周期内投稿量', '条均点击率', '条均5s完播率', '条均2s跳出率', '条均播放时长', '播放量中位数', '条均点赞数', '条均评论量', '条均分享量'];
  const metrics: Record<string, unknown> = {};
  for (const label of labels) metrics[label] = valueAfter(lines, label);
  return metrics;
}

function parseSection(lines: string[], startLabel: string, endLabel?: string, maxLines = 60): string[] {
  const start = lines.indexOf(startLabel);
  if (start < 0) return [];
  const end = endLabel ? lines.indexOf(endLabel) : -1;
  return lines.slice(start + 1, end > start ? end : start + 1 + maxLines);
}

function parseRankedItems(lines: string[], startLabel: string, endLabel: string, limit: number): Array<Record<string, unknown>> {
  const section = parseSection(lines, startLabel, endLabel, 500);
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < section.length; index += 1) {
    if (!/^\d+$/.test(section[index])) continue;
    const rank = Number.parseInt(section[index], 10);
    if (!Number.isFinite(rank)) continue;
    const name = section[index + 1];
    if (!name || name === '共30条记录') continue;
    items.push({
      rank,
      name,
      index: section[index + 2],
      change: section[index + 3],
    });
    if (items.length >= limit) break;
  }
  return items;
}

function parseIndexItems(lines: string[], startLabel: string, endLabel: string, limit: number): Array<Record<string, unknown>> {
  const section = parseSection(lines, startLabel, endLabel, 500)
    .filter(line => !['排名', '热点名称', '热点指数', '热点指数变化'].includes(line));
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < section.length;) {
    if (section[index] === '共30条记录') break;
    if (/^\d+$/.test(section[index])) {
      const rank = Number.parseInt(section[index], 10);
      const name = section[index + 1];
      const score = section[index + 2];
      if (name && score) items.push({ rank, name, index: score });
      if (items.length >= limit) break;
      index += 3;
      continue;
    }
    if (/[万亿]$/.test(section[index + 1] || '')) {
      items.push({ rank: items.length + 1, name: section[index], index: section[index + 1] });
      if (items.length >= limit) break;
      index += 2;
      continue;
    }
    index += 1;
  }
  return items;
}

function parseInspirationVideos(lines: string[], limit: number): Array<Record<string, unknown>> {
  const videos: Array<Record<string, unknown>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\d{2}:\d{2}$|^\d{2}:\d{2}:\d{2}$/.test(lines[index])) continue;
    const rank = Number.parseInt(lines[index + 1], 10);
    if (!Number.isFinite(rank)) continue;
    const nextHotWords = lines.findIndex((line, i) => i > index && line.startsWith('热词'));
    const inlineHotWord = nextHotWords > index ? lines[nextHotWords].replace(/^热词\s*[:：]\s*/, '').trim() : '';
    videos.push({
      rank,
      duration: lines[index],
      author: lines[index + 2],
      title: lines[index + 4],
      metrics: lines.slice(index + 5, Math.min(index + 9, lines.length)),
      hotWords: nextHotWords > index ? [inlineHotWord, ...lines.slice(nextHotWords + 1, nextHotWords + 5)]
        .filter(line => line && !/^\d{2}:\d{2}/.test(line)) : [],
    });
    if (videos.length >= limit) break;
  }
  return videos;
}

async function runImageDraft(ctx: SiteCommandContext, options: DouyinImageDraftOptions): Promise<SiteReceipt> {
  const invalid = mutuallyExclusivePublishAndDraft(options);
  if (invalid) return { ...invalid, command: 'image-draft' };
  const screenshots: string[] = [];
  await openUploadPage(ctx.profile);
  await switchToImageTab(ctx.profile);
  let page = await readSiteSnapshot(ctx.profile);

  if (isAuthRequired(page.text, page.url)) {
    const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
    if (shot) screenshots.push(shot);
    return {
      site: 'douyin',
      command: 'image-draft',
      ok: false,
      state: 'auth_required',
      page: { url: page.url, title: page.title },
      screenshots,
      observations: { textExcerpt: page.text.slice(0, 1200) },
      errors: [{ code: 'DOUYIN_AUTH_REQUIRED', message: 'Douyin creator center requires login before publishing.' }],
      next: ['Log in in the visible browser, then rerun siteflow douyin image.'],
    };
  }

  if (page.text.includes('你还有上次未发布的图文')) {
    if (!options.resumeExisting) {
      return {
        site: 'douyin',
        command: 'image-draft',
        ok: false,
        state: 'existing_draft_detected',
        page: { url: page.url, title: page.title },
        observations: { textExcerpt: page.text.slice(0, 1200) },
        errors: [{ code: 'DOUYIN_EXISTING_DRAFT', message: 'An existing unpublished Douyin image-text post is present.' }],
        next: ['Rerun with --resume-existing to continue editing the existing draft, or clear it manually in the visible browser.'],
      };
    }
    await clickSiteTarget(ctx.profile, { text: '继续编辑', timeoutMs: 8000 });
    await sleep(2500);
    page = await readSiteSnapshot(ctx.profile);
  }

  if (options.image?.length) {
    const images = options.image;
    await uploadSiteTarget(ctx.profile, {
      selector: 'input[type="file"]',
      nth: 1,
      files: images,
      timeoutMs: 30_000,
    }).catch(async () => {
      await uploadSiteTarget(ctx.profile, {
        selector: 'input[type="file"]',
        nth: 0,
        files: images,
        timeoutMs: 30_000,
      });
    });
    await sleep(8000);
  }

  if (options.title) {
    await typeIntoSiteTarget(ctx.profile, { selector: 'input[placeholder="添加作品标题"]', value: options.title, timeoutMs: 15_000 });
  }

  const bodyParts = [
    options.body,
    ...(options.topic || []).map(topic => topic.startsWith('#') ? topic : `#${topic}`),
  ].filter(Boolean);
  if (bodyParts.length) {
    await typeIntoSiteTarget(ctx.profile, {
      selector: '[contenteditable="true"]',
      nth: 0,
      value: bodyParts.join(' '),
      timeoutMs: 15_000,
    });
  }

  const finalState = await finishAction(ctx.profile, options);

  const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);
  page = await readSiteSnapshot(ctx.profile);
  return {
    site: 'douyin',
    command: 'image-draft',
    ok: true,
    state: finalState,
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      title: options.title,
      bodyLength: options.body?.length || 0,
      topics: options.topic || [],
      imageCount: options.image?.length || 0,
      hasPublishButton: page.text.includes('发布'),
      hasSaveDraftButton: page.text.includes('暂存离开'),
      textExcerpt: page.text.slice(0, 3000),
    },
    next: options.publish
      ? ['Check Douyin creator center for final platform review/publish status.']
      : ['Review preview, cover, declaration, visibility, and compliance manually before publishing.'],
  };
}

async function runVideoDraft(ctx: SiteCommandContext, options: DouyinVideoDraftOptions): Promise<SiteReceipt> {
  const invalid = mutuallyExclusivePublishAndDraft(options);
  if (invalid) return { ...invalid, command: 'video-draft' };
  const screenshots: string[] = [];
  await openUploadPage(ctx.profile);
  await switchToVideoTab(ctx.profile);
  let page = await readSiteSnapshot(ctx.profile);

  if (isAuthRequired(page.text, page.url)) {
    return {
      site: 'douyin',
      command: 'video-draft',
      ok: false,
      state: 'auth_required',
      page: { url: page.url, title: page.title },
      observations: { textExcerpt: page.text.slice(0, 1200) },
      errors: [{ code: 'DOUYIN_AUTH_REQUIRED', message: 'Douyin creator center requires login before publishing a video.' }],
      next: ['Log in in the visible browser, then rerun siteflow douyin video.'],
    };
  }

  if (page.text.includes('你还有上次未发布的视频')) {
    if (!options.resumeExisting) {
      return {
        site: 'douyin',
        command: 'video-draft',
        ok: false,
        state: 'existing_draft_detected',
        page: { url: page.url, title: page.title },
        observations: { textExcerpt: page.text.slice(0, 1200) },
        errors: [{ code: 'DOUYIN_EXISTING_DRAFT', message: 'An existing unpublished Douyin video post is present.' }],
        next: ['Rerun with --resume-existing to continue editing the existing unpublished post, or clear it manually.'],
      };
    }
    await clickSiteTarget(ctx.profile, { text: '继续编辑', timeoutMs: 8000 });
    await sleep(2500);
  } else if (options.video) {
    await uploadSiteTarget(ctx.profile, {
      selector: 'input[type="file"]',
      nth: 0,
      files: [options.video],
      timeoutMs: 30_000,
    });
    await sleep(12_000);
  }

  if (options.title) {
    await typeIntoSiteTarget(ctx.profile, { selector: 'input[placeholder="填写作品标题，为作品获得更多流量"]', value: options.title, timeoutMs: 15_000 });
  }
  const bodyParts = [options.body, ...(options.topic || []).map(topic => topic.startsWith('#') ? topic : `#${topic}`)].filter(Boolean);
  if (bodyParts.length) {
    await typeIntoSiteTarget(ctx.profile, { selector: '[contenteditable="true"]', nth: 0, value: bodyParts.join(' '), timeoutMs: 15_000 });
  }
  const finalState = await finishAction(ctx.profile, options);
  const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);
  page = await readSiteSnapshot(ctx.profile);
  return {
    site: 'douyin',
    command: 'video-draft',
    ok: true,
    state: finalState,
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      title: options.title,
      bodyLength: options.body?.length || 0,
      topics: options.topic || [],
      hasPublishButton: page.text.includes('发布'),
      hasSaveDraftButton: page.text.includes('暂存离开'),
      textExcerpt: page.text.slice(0, 3000),
    },
    next: options.publish
      ? ['Check Douyin creator center for final platform review/publish status.']
      : ['Review cover, declaration, chapters, visibility, and compliance manually before publishing.'],
  };
}

async function runArticleDraft(ctx: SiteCommandContext, options: DouyinArticleDraftOptions): Promise<SiteReceipt> {
  const invalid = mutuallyExclusivePublishAndDraft(options);
  if (invalid) return { ...invalid, command: 'article-draft' };
  const screenshots: string[] = [];
  await openUploadPage(ctx.profile);
  await switchToArticleTab(ctx.profile);
  let page = await readSiteSnapshot(ctx.profile);

  if (isAuthRequired(page.text, page.url)) {
    return {
      site: 'douyin',
      command: 'article-draft',
      ok: false,
      state: 'auth_required',
      page: { url: page.url, title: page.title },
      observations: { textExcerpt: page.text.slice(0, 1200) },
      errors: [{ code: 'DOUYIN_AUTH_REQUIRED', message: 'Douyin creator center requires login before publishing an article.' }],
      next: ['Log in in the visible browser, then rerun siteflow douyin article.'],
    };
  }

  if (page.text.includes('你还有上次未发布的文章')) {
    if (!options.resumeExisting) {
      return {
        site: 'douyin',
        command: 'article-draft',
        ok: false,
        state: 'existing_draft_detected',
        page: { url: page.url, title: page.title },
        observations: { textExcerpt: page.text.slice(0, 1200) },
        errors: [{ code: 'DOUYIN_EXISTING_DRAFT', message: 'An existing unpublished Douyin article is present.' }],
        next: ['Rerun with --resume-existing to continue editing the existing unpublished article, or clear it manually.'],
      };
    }
    await clickSiteTarget(ctx.profile, { text: '继续编辑', timeoutMs: 8000 });
    await sleep(2500);
  } else if (page.text.includes('我要发文')) {
    await clickSiteTarget(ctx.profile, { text: '我要发文', timeoutMs: 10_000 });
    await sleep(3000);
  }

  if (options.title) {
    await typeIntoSiteTarget(ctx.profile, { selector: 'input[placeholder="请输入文章标题，最多不超过30个字"]', value: options.title, timeoutMs: 15_000 });
  }
  if (options.summary) {
    await typeIntoSiteTarget(ctx.profile, { selector: 'input[placeholder="添加内容摘要或文章精彩部分吸引用户阅读，最多不超过30个字"]', value: options.summary, timeoutMs: 15_000 });
  }
  if (options.body) {
    await typeIntoSiteTarget(ctx.profile, { selector: '[contenteditable="true"]', nth: 0, value: options.body, timeoutMs: 15_000 });
  }
  const finalState = await finishAction(ctx.profile, options);
  const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);
  page = await readSiteSnapshot(ctx.profile);
  return {
    site: 'douyin',
    command: 'article-draft',
    ok: true,
    state: finalState,
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      title: options.title,
      summary: options.summary,
      bodyLength: options.body?.length || 0,
      hasPublishButton: page.text.includes('发布'),
      hasSaveDraftButton: page.text.includes('暂存离开'),
      textExcerpt: page.text.slice(0, 3000),
    },
    next: options.publish
      ? ['Check Douyin creator center for final platform review/publish status.']
      : ['Review article cover, head image, topics, music, visibility, and compliance manually before publishing.'],
  };
}

async function runImagePublish(ctx: SiteCommandContext, options: DouyinImageDraftOptions): Promise<SiteReceipt> {
  const receipt = await runImageDraft(ctx, { ...options, publish: true, saveDraft: false });
  return { ...receipt, command: 'image' };
}

async function runVideoPublish(ctx: SiteCommandContext, options: DouyinVideoDraftOptions): Promise<SiteReceipt> {
  const receipt = await runVideoDraft(ctx, { ...options, publish: true, saveDraft: false });
  return { ...receipt, command: 'video' };
}

async function runArticlePublish(ctx: SiteCommandContext, options: DouyinArticleDraftOptions): Promise<SiteReceipt> {
  const receipt = await runArticleDraft(ctx, { ...options, publish: true, saveDraft: false });
  return { ...receipt, command: 'article' };
}

export const douyinTesting = {
  isAuthRequired,
};


export const douyinAdapter: SiteAdapter = {
  id: 'douyin',
  title: 'Douyin',
  description: 'Douyin creator-center publishing automation.',
  commands: [
    {
      name: 'status',
      description: 'Observe current Douyin creator upload page',
      configure(command: Command): void {
        command.action(async function () {
          await runSiteCommand(this, runStatus);
        });
      },
    },
    {
      name: 'image',
      description: 'Publish a Douyin image-text post',
      configure(command: Command): void {
        command
          .requiredOption('--title <text>', 'post title')
          .requiredOption('--body <text>', 'post body')
          .requiredOption('--image <path...>', 'image paths to upload')
          .option('--topic <name...>', 'topics to append to the body')
          .option('--resume-existing', 'continue editing an existing unpublished image-text post')
          .option('--screenshot <path>', 'save screenshot receipt')
          .action(async function () {
            await runSiteCommand(this, ctx => runImagePublish(ctx, this.opts<DouyinImageDraftOptions>()));
          });
      },
    },
    {
      name: 'video',
      description: 'Publish a Douyin video post',
      configure(command: Command): void {
        command
          .requiredOption('--title <text>', 'post title')
          .requiredOption('--body <text>', 'post body')
          .requiredOption('--video <path>', 'video path to upload')
          .option('--topic <name...>', 'topics to append to the body')
          .option('--resume-existing', 'continue editing an existing unpublished video post')
          .option('--screenshot <path>', 'save screenshot receipt')
          .action(async function () {
            await runSiteCommand(this, ctx => runVideoPublish(ctx, this.opts<DouyinVideoDraftOptions>()));
          });
      },
    },
    {
      name: 'article',
      description: 'Publish a Douyin article post',
      configure(command: Command): void {
        command
          .requiredOption('--title <text>', 'article title')
          .requiredOption('--summary <text>', 'article summary')
          .requiredOption('--body <text>', 'article body')
          .option('--resume-existing', 'continue editing an existing unpublished article')
          .option('--screenshot <path>', 'save screenshot receipt')
          .action(async function () {
            await runSiteCommand(this, ctx => runArticlePublish(ctx, this.opts<DouyinArticleDraftOptions>()));
          });
      },
    },
    {
      name: 'works',
      description: 'Read Douyin creator works and visible performance metrics',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'maximum works to return', '20')
          .action(async function () {
            await runSiteCommand(this, ctx => runWorks(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'list',
      description: 'Human-friendly alias for works: list your Douyin posts',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'maximum works to return', '20')
          .action(async function () {
            await runSiteCommand(this, ctx => runList(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'overview',
      description: 'Read Douyin account overview, diagnostics, and hot topic hints',
      configure(command: Command): void {
        command
          .option('--range <range>', 'requested range label, usually current|yesterday|7d|30d', 'current')
          .option('--limit <n>', 'maximum hot topics/videos to return', '20')
          .action(async function () {
            await runSiteCommand(this, ctx => runOverview(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'content-analytics',
      description: 'Read Douyin post analytics and content performance summary',
      configure(command: Command): void {
        command
          .option('--range <range>', 'requested range label, usually current|7d|30d', 'current')
          .action(async function () {
            await runSiteCommand(this, ctx => runContentAnalytics(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'stats',
      description: 'Human-friendly account and content stats summary',
      configure(command: Command): void {
        command
          .option('--range <range>', 'requested range label, usually current|7d|30d', 'current')
          .option('--limit <n>', 'maximum hot topics/videos to return', '10')
          .action(async function () {
            await runSiteCommand(this, ctx => runStats(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'inspiration',
      description: 'Read Douyin creative inspiration, hot videos, and hot words',
      configure(command: Command): void {
        command
          .option('--limit <n>', 'maximum hot videos to return', '20')
          .action(async function () {
            await runSiteCommand(this, ctx => runInspiration(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'index',
      description: 'Read Douyin realtime and rising hot-topic index',
      configure(command: Command): void {
        command
          .option('--type <type>', 'all, realtime, or rising', 'all')
          .option('--limit <n>', 'maximum index items to return', '30')
          .action(async function () {
            await runSiteCommand(this, ctx => runIndex(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
    {
      name: 'ideas',
      description: 'Human-friendly topic ideas from inspiration and Douyin index',
      configure(command: Command): void {
        command
          .option('--type <type>', 'all, realtime, or rising', 'all')
          .option('--limit <n>', 'maximum items per source', '10')
          .action(async function () {
            await runSiteCommand(this, ctx => runIdeas(ctx, this.opts<DouyinReadOptions>()));
          });
      },
    },
  ],
};
