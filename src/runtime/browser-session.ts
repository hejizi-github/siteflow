import { chromium, type Browser, type BrowserContext } from 'playwright';
import { resolveProfile } from './profile.js';

export async function launchDedicatedProfileContext(profile: string): Promise<BrowserContext> {
  const paths = resolveProfile(profile);
  const headless = /^(1|true|yes)$/i.test(process.env.SITEFLOW_HEADLESS || '');
  return chromium.launchPersistentContext(paths.browserProfileDir, {
    channel: process.env.SITEFLOW_BROWSER_CHANNEL || 'chrome',
    headless,
    viewport: null,
    args: ['--hide-crash-restore-bubble'],
  });
}

export async function attachBrowserContext(browserUrl: string): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.connectOverCDP(browserUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  return { browser, context };
}
