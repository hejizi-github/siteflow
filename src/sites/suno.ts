import type { Command } from 'commander';
import {
  captureSiteScreenshot,
  clickSiteTarget,
  detectSiteCaptcha,
  ensureSitePage,
  readRecentSiteErrors,
  readSiteSnapshot,
  sleep,
  typeIntoSiteTarget,
} from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';

interface SunoCreateOptions {
  lyrics?: string;
  lyricsFile?: string;
  style?: string;
  styleFile?: string;
  title?: string;
  screenshot?: string;
  wait: string;
  submit?: boolean;
}

async function readMaybeFile(value: string | undefined, file: string | undefined): Promise<string | undefined> {
  if (file) {
    const fs = await import('node:fs/promises');
    return fs.readFile(file, 'utf-8');
  }
  return value;
}

function hasServiceUnavailable(errors: Array<{ text: string }>): boolean {
  return errors.some(error => error.text.includes('Song generation is temporarily unavailable') || error.text.includes('status_code: 503'));
}

function composePrompt(lyrics: string | undefined, style: string | undefined): string | undefined {
  if (lyrics && style) return `${lyrics}\n\nStyle: ${style}`;
  return lyrics || style;
}

async function fillCreatePrompt(profile: string, lyrics: string | undefined, style: string | undefined): Promise<{ usedSingleField: boolean }> {
  const prompt = composePrompt(lyrics, style);
  if (!prompt) return { usedSingleField: false };
  await typeIntoSiteTarget(profile, { selector: 'textarea', nth: 0, value: prompt });
  return { usedSingleField: true };
}

function isReadyGate(text: string): boolean {
  return text.includes('Your songs are ready') || text.includes('Join Suno for free to listen');
}

async function runCreate(ctx: SiteCommandContext, options: SunoCreateOptions): Promise<SiteReceipt> {
  const lyrics = await readMaybeFile(options.lyrics, options.lyricsFile);
  const style = await readMaybeFile(options.style, options.styleFile);
  const screenshots: string[] = [];
  await ensureSitePage(ctx.profile, 'https://suno.com/create', 'suno.com');
  const fillResult = await fillCreatePrompt(ctx.profile, lyrics, style);


  const filledShot = await captureSiteScreenshot(ctx.profile, options.screenshot);
  if (filledShot) screenshots.push(filledShot);

  const pageBeforeSubmit = await readSiteSnapshot(ctx.profile);
  const readyGateBeforeSubmit = isReadyGate(pageBeforeSubmit.text);
  if (!options.submit) {
    return {
      site: 'suno',
      command: 'create',
      ok: true,
      state: readyGateBeforeSubmit ? 'submitted_unconfirmed' : 'filled_not_submitted',
      page: { url: pageBeforeSubmit.url, title: pageBeforeSubmit.title },
      screenshots,
      observations: {
        title: options.title,
        hasLyrics: Boolean(lyrics),
        hasStyle: Boolean(style),
        usedSingleField: fillResult.usedSingleField,
        readyGateVisible: readyGateBeforeSubmit,
        textExcerpt: pageBeforeSubmit.text.slice(0, 1000),
      },
      next: readyGateBeforeSubmit
        ? ['Suno switched to a login gate after filling. Sign in to listen or continue generation review.']
        : ['Review the visible form, then re-run with --submit to create.'],
    };
  }

  if (readyGateBeforeSubmit) {
    return {
      site: 'suno',
      command: 'create',
      ok: true,
      state: 'submitted_unconfirmed',
      page: { url: pageBeforeSubmit.url, title: pageBeforeSubmit.title },
      screenshots,
      observations: {
        requestedTitle: options.title,
        titleVisible: false,
        usedSingleField: fillResult.usedSingleField,
        readyGateVisible: true,
        textExcerpt: pageBeforeSubmit.text.slice(0, 1000),
      },
      next: ['Suno already switched to the listen gate. Sign in to review the generated clips.'],
    };
  }

  await clickSiteTarget(ctx.profile, { text: 'Create', timeoutMs: 15_000 });
  const waitMs = Number.parseInt(options.wait, 10);
  await sleep(Number.isFinite(waitMs) ? waitMs : 45_000);

  const page = await readSiteSnapshot(ctx.profile);
  const captcha = await detectSiteCaptcha(ctx.profile);
  const errors = await readRecentSiteErrors(ctx.profile, 30);
  const serviceUnavailable = hasServiceUnavailable(errors);
  const generated = Boolean(options.title && page.text.includes(options.title));
  const createTriggered = !generated && !serviceUnavailable && !captcha.present;

  return {
    site: 'suno',
    command: 'create',
    ok: generated || createTriggered,
    state: generated
      ? 'created_or_visible'
      : serviceUnavailable
        ? 'service_unavailable'
        : captcha.present
          ? 'awaiting_human_verification'
          : 'submitted_unconfirmed',
    page: { url: page.url, title: page.title },
    screenshots,
    observations: {
      requestedTitle: options.title,
      titleVisible: generated,
      usedSingleField: fillResult.usedSingleField,
      captcha,
      serviceUnavailable,
      textExcerpt: page.text.slice(0, 1000),
      readRecentSiteErrors: errors.slice(-8),
    },
    errors: serviceUnavailable
      ? [{ code: 'SUNO_503', message: 'Suno returned "Song generation is temporarily unavailable. Please try again shortly."' }]
      : undefined,
    next: generated
      ? ['Open Suno to review the generated clips.']
      : captcha.present
        ? ['Complete the visible verification manually, then run siteflow suno status.']
        : ['Run siteflow suno status or retry later.'],
  };
}

async function runStatus(ctx: SiteCommandContext): Promise<SiteReceipt> {
  await ensureSitePage(ctx.profile, 'https://suno.com/create', 'suno.com');
  const page = await readSiteSnapshot(ctx.profile);
  const captcha = await detectSiteCaptcha(ctx.profile);
  const errors = await readRecentSiteErrors(ctx.profile, 20);
  const onSuno = page.url.includes('suno.com');
  return {
    site: 'suno',
    command: 'status',
    ok: onSuno,
    state: !onSuno ? 'wrong_page' : captcha.present ? 'captcha_or_turnstile_present' : 'observed',
    page: { url: page.url, title: page.title },
    observations: {
      captcha,
      newestText: page.text.slice(0, 3000),
      readRecentSiteErrors: errors.slice(-8),
    },
    errors: onSuno ? undefined : [{ code: 'SUNO_WRONG_PAGE', message: 'Suno status did not land on a suno.com page.' }],
    next: onSuno ? undefined : ['Open https://suno.com/create manually and rerun siteflow suno status.'],
  };
}

export const sunoAdapter: SiteAdapter = {
  id: 'suno',
  title: 'Suno',
  description: 'Suno music creation automation with captcha-aware handoff and receipt output.',
  commands: [
    {
      name: 'create',
      description: 'Fill Suno Advanced lyrics/style and optionally submit generation',
      configure(command: Command): void {
        command
          .option('--lyrics <text>', 'lyrics text')
          .option('--lyrics-file <path>', 'lyrics file')
          .option('--style <text>', 'style prompt text')
          .option('--style-file <path>', 'style prompt file')
          .option('--title <text>', 'expected generated title for status detection')
          .option('--screenshot <path>', 'save filled-form screenshot')
          .option('--wait <ms>', 'milliseconds to wait after submit', '45000')
          .option('--submit', 'clickSiteTarget Create song after filling')
          .action(async function () {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runCreate(ctx, this.opts<SunoCreateOptions>()));
          });
      },
    },
    {
      name: 'status',
      description: 'Observe current Suno page, captcha state, and recent errors',
      configure(command: Command): void {
        command.action(async function () {
          const { runSiteCommand } = await import('./runner.js');
          await runSiteCommand(this, runStatus);
        });
      },
    },
  ],
};
