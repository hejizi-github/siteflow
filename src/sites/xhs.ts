import type { Command } from 'commander';
import {
  runSiteCommand,
  addSitePageIdOption,
  captureSiteScreenshot,
  clickSiteTarget,
  ensureSitePage,
  readRecentSiteErrors,
  readSiteSnapshot,
  sleep,
  typeIntoSiteTarget,
  uploadSiteFiles,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';

const xhsDeps = {
  captureSiteScreenshot,
  clickSiteTarget,
  ensureSitePage,
  readRecentSiteErrors,
  readSiteSnapshot,
  sleep,
  typeIntoSiteTarget,
  uploadSiteFiles,
};

interface XhsDraftOptions {
  title?: string;
  body?: string;
  bodyFile?: string;
  image?: string[];
  topic?: string[];
  url?: string;
  screenshot?: string;
  pageId?: string;
}

async function readBody(value: string | undefined, file: string | undefined): Promise<string | undefined> {
  if (!file) return value;
  const fs = await import('node:fs/promises');
  return fs.readFile(file, 'utf-8');
}

async function addTopic(profile: string, topic: string, pageId?: number, deps = xhsDeps): Promise<void> {
  const normalized = topic.startsWith('#') ? topic : `#${topic}`;
  await deps.typeIntoSiteTarget(profile, { pageId, selector: '[contenteditable="true"]', nth: 0, value: ` ${normalized}`, clear: false });
  await deps.sleep(1500);
  await deps.clickSiteTarget(profile, { pageId, text: normalized.replace(/^#/, ''), exact: false, clickableParent: true }).catch(async () => {
    await deps.clickSiteTarget(profile, { pageId, text: normalized, exact: false, clickableParent: true });
  });
}

async function runDraft(ctx: SiteCommandContext, options: XhsDraftOptions, deps = xhsDeps): Promise<SiteReceipt> {
  const screenshots: string[] = [];
  const pageInfo = await deps.ensureSitePage(ctx.profile, options.url || 'https://creator.xiaohongshu.com/publish/publish?source=official', 'creator.xiaohongshu.com', options.pageId);
  const pageId = pageInfo.id;
  await deps.sleep(2000);
  const initialPage = await deps.readSiteSnapshot(ctx.profile, pageId);
  if (initialPage.url.includes('/login') || initialPage.text.includes('短信登录')) {
    const shot = await deps.captureSiteScreenshot(ctx.profile, options.screenshot, pageId);
    if (shot) screenshots.push(shot);
    return {
      site: 'xhs',
      command: 'draft',
      ok: false,
      state: 'auth_required',
      page: { url: initialPage.url, title: initialPage.title },
      screenshots,
      observations: {
        textExcerpt: initialPage.text.slice(0, 1000),
      },
      errors: [{ code: 'XHS_AUTH_REQUIRED', message: 'Xiaohongshu creator page requires login before filling a draft.' }],
      next: ['Log in in the visible browser, then rerun siteflow xhs draft.'],
    };
  }

  if (options.image?.length) {
    await deps.uploadSiteFiles(ctx.profile, 'input[type=\"file\"]', options.image, 20_000);
    await deps.sleep(2500);
  }

  if (options.title) {
    await deps.typeIntoSiteTarget(ctx.profile, { pageId, selector: 'input', nth: 0, value: options.title });
  }

  const body = await readBody(options.body, options.bodyFile);
  if (body) {
    await deps.typeIntoSiteTarget(ctx.profile, { pageId, selector: '[contenteditable=\"true\"]', nth: 0, value: body });
  }

  for (const topic of options.topic || []) {
    await addTopic(ctx.profile, topic, pageId, deps);
  }

  const shot = await deps.captureSiteScreenshot(ctx.profile, options.screenshot, pageId);
  if (shot) screenshots.push(shot);
  const page = await deps.readSiteSnapshot(ctx.profile, pageId);
  const errors = await deps.readRecentSiteErrors(ctx.profile, 20);
  return {
    site: 'xhs',
    command: 'draft',
    ok: true,
    state: 'draft_filled_publish_not_clicked',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      title: options.title,
      imageCount: options.image?.length || 0,
      topics: options.topic || [],
      readRecentSiteErrors: errors.slice(-8),
      textExcerpt: page.text.slice(0, 2500),
    },
    next: ['Review layout, topics, AI content declaration, and visibility before publishing manually.'],
  };
}

async function runStatus(ctx: SiteCommandContext, options: { pageId?: string } = {}, deps = xhsDeps): Promise<SiteReceipt> {
  const pageInfo = await deps.ensureSitePage(ctx.profile, 'https://creator.xiaohongshu.com/publish/publish?source=official', 'creator.xiaohongshu.com', options.pageId);
  const page = await deps.readSiteSnapshot(ctx.profile, pageInfo.id);
  return {
    site: 'xhs',
    command: 'status',
    ok: true,
    state: 'observed',
    page: { url: page.url, title: page.title },
    observations: { textExcerpt: page.text.slice(0, 3000) },
  };
}

export const xhsTesting = {
  addTopic,
  readBody,
  runDraft,
  runStatus,
  deps: xhsDeps,
};

export const xhsAdapter: SiteAdapter = {
  id: 'xhs',
  title: 'Xiaohongshu',
  description: 'Xiaohongshu creator draft automation. It never clicks final publish.',
  commands: [
    {
      name: 'draft',
      description: 'Create/fill a Xiaohongshu draft and stop before publishing',
      configure(command: Command): void {
        addSitePageIdOption(command
          .option('--title <text>', 'note title')
          .option('--body <text>', 'note body')
          .option('--body-file <path>', 'note body file')
          .option('--image <path...>', 'image/video paths to upload')
          .option('--topic <name...>', 'topics to add')
          .option('--url <url>', 'creator URL')
          .option('--screenshot <path>', 'save draft screenshot'))
          .action(async function () {
            await runSiteCommand(this, ctx => runDraft(ctx, this.opts<XhsDraftOptions>()));
          });
      },
    },
    {
      name: 'status',
      description: 'Observe current Xiaohongshu creator page',
      configure(command: Command): void {
        addSitePageIdOption(command).action(async function () {
          await runSiteCommand(this, ctx => runStatus(ctx, this.opts<{ pageId?: string }>()));
        });
      },
    },
  ],
};
