import type { BrowserContext, Page } from 'playwright';
import { PageObservationStore } from './page-observation-store.js';

export class BrowserKernelContext<T> {
  readonly pages = new Map<number, Page>();
  readonly observations = new PageObservationStore<T>();

  private browserContext: BrowserContext | null = null;
  private nextPageId = 1;
  private currentSelectedPageId: number | null = null;

  get context(): BrowserContext | null {
    return this.browserContext;
  }

  set context(context: BrowserContext | null) {
    this.browserContext = context;
  }

  get selectedPageId(): number | null {
    return this.currentSelectedPageId;
  }

  set selectedPageId(pageId: number | null) {
    this.currentSelectedPageId = pageId;
  }

  adoptPage(page: Page, observation: T): { id: number; created: boolean } {
    for (const [existingId, existingPage] of this.pages.entries()) {
      if (existingPage === page) return { id: existingId, created: false };
    }

    const id = this.nextPageId++;
    this.pages.set(id, page);
    this.observations.set(id, observation);
    if (this.currentSelectedPageId === null) this.currentSelectedPageId = id;
    return { id, created: true };
  }

  removePage(pageId: number): void {
    this.pages.delete(pageId);
    this.observations.delete(pageId);
    if (this.currentSelectedPageId === pageId) {
      this.currentSelectedPageId = this.pages.keys().next().value ?? null;
    }
  }

  reset(): void {
    this.browserContext = null;
    this.pages.clear();
    this.observations.clear();
    this.currentSelectedPageId = null;
  }
}
