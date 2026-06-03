import type { Command } from 'commander';
import {
  captureSiteScreenshot,
  clickSiteTarget,
  ensureSitePage,
  readRecentSiteErrors,
  readSiteSnapshot,
  sleep,
  typeIntoSiteTarget,
  waitForText,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';

interface JimengGenerateOptions {
  prompt: string;
  url?: string;
  inputSelector?: string;
  submitText?: string;
  screenshot?: string;
  wait: string;
  submit?: boolean;
}

async function runGenerate(ctx: SiteCommandContext, options: JimengGenerateOptions): Promise<SiteReceipt> {
  const screenshots: string[] = [];
  await ensureSitePage(ctx.profile, options.url || 'https://jimeng.jianying.com/ai-tool/generate', 'jimeng.jianying.com');
  await typeIntoSiteTarget(ctx.profile, { selector: options.inputSelector || 'textarea', nth: 0, value: options.prompt });
  const shot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (shot) screenshots.push(shot);

  if (!options.submit) {
    const page = await readSiteSnapshot(ctx.profile);
    return {
      site: 'jimeng',
      command: 'generate',
      ok: true,
      state: 'filled_not_submitted',
      page: { url: page.url, title: page.title },
      screenshots,
      observations: { promptLength: options.prompt.length },
      next: ['Review the visible form, then re-run with --submit.'],
    };
  }

  if (options.submitText) {
    await clickSiteTarget(ctx.profile, { text: options.submitText, exact: false, clickableParent: true });
  } else {
    await clickSiteTarget(ctx.profile, { text: '搜索', exact: false, clickableParent: true, timeoutMs: 10_000 }).catch(async () => {
      await clickSiteTarget(ctx.profile, { x: 1100, y: 720 });
    });
  }
  const waitMs = Number.parseInt(options.wait, 10);
  await sleep(Number.isFinite(waitMs) ? waitMs : 60_000);

  const page = await readSiteSnapshot(ctx.profile);
  const completed = page.text.includes('图片生成完成') || await waitForText(ctx.profile, '生成完成', 1000);
  const submissionLikely = !completed && (page.text.includes('图片生成') || page.text.includes('搜索'));
  const errors = await readRecentSiteErrors(ctx.profile, 20);
  return {
    site: 'jimeng',
    command: 'generate',
    ok: completed || submissionLikely,
    state: completed ? 'completed' : 'submitted_unconfirmed',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      completionTextVisible: completed,
      submissionLikely,
      readRecentSiteErrors: errors.slice(-8),
      textExcerpt: page.text.slice(0, 1200),
    },
    next: completed ? [] : ['Inspect the visible page and rerun status after generation finishes.'],
  };
}

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, 'https://jimeng.jianying.com/ai-tool/generate', 'jimeng.jianying.com');
  const page = await readSiteSnapshot(ctx.profile);
  return {
    site: 'jimeng',
    command: 'status',
    ok: true,
    state: page.text.includes('生成完成') ? 'completed_visible' : 'observed',
    page: { url: page.url, title: page.title },
    observations: { textExcerpt: page.text.slice(0, 3000) },
  };
}

export const jimengAdapter: SiteAdapter = {
  id: 'jimeng',
  title: 'Jimeng',
  description: 'Jimeng asset generation automation with configurable selectors.',
  commands: [
    {
      name: 'generate',
      description: 'Fill a Jimeng prompt and optionally submit generation',
      configure(command: Command): void {
        command
          .requiredOption('--prompt <text>', 'generation prompt')
          .option('--url <url>', 'Jimeng generation URL')
          .option('--input-selector <selector>', 'prompt input selector', 'textarea')
          .option('--submit-text <text>', 'submit button visible text')
          .option('--screenshot <path>', 'save filled-form screenshot')
          .option('--wait <ms>', 'milliseconds to wait after submit', '60000')
          .option('--submit', 'submit generation after filling')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runGenerate(ctx, this.opts<JimengGenerateOptions>()));
          });
      },
    },
    {
      name: 'status',
      description: 'Observe current Jimeng page state',
      configure(command: Command): void {
        command.action(async function () {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, runStatus);
        });
      },
    },
  ],
};
