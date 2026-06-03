import type { Page } from 'playwright';
import type { PageInfo, RedactedCookie, SavedState, StorageSnapshot } from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';

export async function readStorageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(() => ({
    url: location.href,
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  }));
}

export function createSavedState(pages: PageInfo[], includeCookies: boolean, cookies: RedactedCookie[]): SavedState {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    pages: pages
      .filter(page => page.url && page.url !== 'about:blank')
      .map(page => ({ url: page.url, selected: page.selected })),
    ...(includeCookies ? { cookies } : {}),
    includeCookies,
  };
}

export function getRestorablePageUrls(state: SavedState): string[] {
  if (state.version !== 1 || !Array.isArray(state.pages)) {
    throw new SiteflowError('BAD_STATE', 'State file must be version 1 with pages array');
  }

  const urls: string[] = [];
  for (const saved of state.pages) {
    if (!saved.url) continue;
    urls.push(saved.url);
  }
  return urls;
}
