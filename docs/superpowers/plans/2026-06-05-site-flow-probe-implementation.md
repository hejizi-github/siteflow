# Site Flow Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first site task graph and page probe layer, then migrate YouTube `search` and `comments` onto it without changing their CLI shape.

**Architecture:** Add a small in-process flow runner under `src/sites/flow/`, a controlled probe layer under `src/sites/probes/`, and optional step traces on `SiteReceipt`. YouTube `search` and `comments` become orchestration functions that call semantic probes instead of embedding raw browser JavaScript.

**Tech Stack:** Node 20+, TypeScript ESM, Commander, existing daemon/browser capabilities facade, Node built-in `node:test` and `node:assert/strict`.

---

## File Structure

- Create `src/sites/flow/define-flow.ts`: typed sequential flow runner, step recording, receipt assembly.
- Create `test/unit/site-flow.test.mjs`: tests flow success, failure, and receipt compatibility.
- Create `src/sites/probes/selector-runtime.ts`: selector DSL, generated page scripts, and page-scoped extraction helpers.
- Create `src/sites/probes/common.ts`: common page probes for summary and scrolling.
- Create `src/sites/probes/youtube.ts`: YouTube search and comments semantic probes.
- Create `test/unit/site-probes.test.mjs`: tests selector runtime script generation and YouTube probe behavior through injected evaluator dependencies.
- Modify `src/sites/types.ts`: add optional `steps` to `SiteReceipt`.
- Modify `src/sites/youtube.ts`: migrate only `runSearch` and `runComments`; leave `video`, `channel`, and `transcript` unchanged.
- Modify `test/unit/site-import-governance.test.mjs`: add migrated-adapter governance for YouTube raw evaluate usage.

## Task 1: Add Receipt Step Types

**Files:**
- Modify: `src/sites/types.ts`
- Test: `test/unit/site-flow.test.mjs`

- [ ] **Step 1: Write the failing receipt type smoke test**

Create `test/unit/site-flow.test.mjs` with this initial test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('site receipts can include optional step traces', async () => {
  const module = await import('../../dist/sites/flow/define-flow.js');
  assert.equal(typeof module.defineSiteFlow, 'function');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/site-flow.test.mjs
```

Expected: FAIL because `dist/sites/flow/define-flow.js` does not exist.

- [ ] **Step 3: Extend `SiteReceipt` with optional step data**

Modify `src/sites/types.ts` so it contains these exported interfaces:

```ts
import type { OutputOptions } from '../cli/output.js';

export interface SiteCommandContext {
  profile: string;
  output: OutputOptions;
}

export interface SiteCommandSpec {
  name: string;
  description: string;
  configure(command: import('commander').Command): void;
}

export interface SiteAdapter {
  id: string;
  title: string;
  description: string;
  commands: SiteCommandSpec[];
}

export interface SiteStepReceipt {
  name: string;
  ok: boolean;
  state: string;
  startedAt: string;
  endedAt: string;
  evidence?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

export interface SiteReceipt {
  site: string;
  command: string;
  ok: boolean;
  state: string;
  page?: {
    url: string;
    title: string;
  };
  screenshots?: string[];
  observations?: Record<string, unknown>;
  errors?: Array<{
    code: string;
    message: string;
  }>;
  next?: string[];
  steps?: SiteStepReceipt[];
}
```

- [ ] **Step 4: Create a minimal flow module to satisfy import shape**

Create `src/sites/flow/define-flow.ts`:

```ts
import type { SiteCommandContext, SiteReceipt, SiteStepReceipt } from '../types.js';

export type FlowStepEvidence = Record<string, unknown>;

export interface SiteFlow {
  readonly ctx: SiteCommandContext;
  readonly site: string;
  readonly command: string;
  readonly steps: SiteStepReceipt[];
}

export function defineSiteFlow(ctx: SiteCommandContext, site: string, command: string): SiteFlow {
  return {
    ctx,
    site,
    command,
    steps: [],
  };
}

export function withFlowSteps(receipt: SiteReceipt, steps: SiteStepReceipt[]): SiteReceipt {
  return {
    ...receipt,
    steps,
  };
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/site-flow.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/sites/types.ts src/sites/flow/define-flow.ts test/unit/site-flow.test.mjs
git commit -m "feat: add site receipt step types"
```

## Task 2: Implement Sequential Flow Runner

**Files:**
- Modify: `src/sites/flow/define-flow.ts`
- Modify: `test/unit/site-flow.test.mjs`

- [ ] **Step 1: Add failing flow runner tests**

Replace `test/unit/site-flow.test.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { defineSiteFlow } from '../../dist/sites/flow/define-flow.js';

const ctx = {
  profile: 'default',
  output: { json: true, profile: 'default' },
};

test('site flow records successful sequential steps', async () => {
  const receipt = await defineSiteFlow(ctx, 'youtube', 'search')
    .step('open_search_page', async () => ({ pageId: 1, url: 'https://www.youtube.com/results', title: 'YouTube' }))
    .step('extract_search_results', async flow => ({ count: flow.get('open_search_page').pageId }))
    .receipt(flow => ({
      site: 'youtube',
      command: 'search',
      ok: true,
      state: 'search_collected',
      observations: {
        count: flow.get('extract_search_results').count,
      },
      errors: [],
      next: [],
    }));

  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.count, 1);
  assert.equal(receipt.steps.length, 2);
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_search_page', 'extract_search_results']);
  assert.equal(receipt.steps.every(step => step.ok), true);
});

test('site flow records failed steps before rethrowing', async () => {
  await assert.rejects(
    defineSiteFlow(ctx, 'youtube', 'comments')
      .step('open_video_page', async () => ({ pageId: 2 }))
      .step('extract_comments', async () => {
        throw new Error('comments unavailable');
      })
      .receipt(() => ({
        site: 'youtube',
        command: 'comments',
        ok: true,
        state: 'comments_collected',
        observations: {},
        errors: [],
        next: [],
      })),
    /comments unavailable/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/site-flow.test.mjs
```

Expected: FAIL because `step`, `get`, and `receipt` are not implemented.

- [ ] **Step 3: Implement the flow runner**

Replace `src/sites/flow/define-flow.ts` with:

```ts
import type { SiteCommandContext, SiteReceipt, SiteStepReceipt } from '../types.js';

type StepValues = Record<string, unknown>;
type StepHandler<T> = (flow: SiteFlowRunner) => Promise<T> | T;
type ReceiptBuilder = (flow: SiteFlowRunner) => SiteReceipt;

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stepState(name: string, ok: boolean): string {
  return ok ? `${name}_completed` : `${name}_failed`;
}

export class SiteFlowRunner {
  readonly ctx: SiteCommandContext;
  readonly site: string;
  readonly command: string;
  readonly steps: SiteStepReceipt[] = [];
  private readonly values: StepValues = {};
  private readonly queue: Array<{ name: string; handler: StepHandler<unknown> }> = [];

  constructor(ctx: SiteCommandContext, site: string, command: string) {
    this.ctx = ctx;
    this.site = site;
    this.command = command;
  }

  step<T>(name: string, handler: StepHandler<T>): this {
    this.queue.push({ name, handler: handler as StepHandler<unknown> });
    return this;
  }

  get<T = unknown>(name: string): T {
    return this.values[name] as T;
  }

  async receipt(builder: ReceiptBuilder): Promise<SiteReceipt> {
    await this.run();
    return {
      ...builder(this),
      steps: this.steps,
    };
  }

  private async run(): Promise<void> {
    for (const item of this.queue) {
      const startedAt = nowIso();
      try {
        const value = await item.handler(this);
        this.values[item.name] = value;
        const evidence = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : { value };
        this.steps.push({
          name: item.name,
          ok: true,
          state: stepState(item.name, true),
          startedAt,
          endedAt: nowIso(),
          evidence,
        });
      } catch (error) {
        this.steps.push({
          name: item.name,
          ok: false,
          state: stepState(item.name, false),
          startedAt,
          endedAt: nowIso(),
          error: {
            code: 'SITE_FLOW_STEP_FAILED',
            message: errorMessage(error),
          },
        });
        throw error;
      }
    }
  }
}

export function defineSiteFlow(ctx: SiteCommandContext, site: string, command: string): SiteFlowRunner {
  return new SiteFlowRunner(ctx, site, command);
}
```

- [ ] **Step 4: Run focused flow tests**

Run:

```bash
npm run build && node --test test/unit/site-flow.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/sites/flow/define-flow.ts test/unit/site-flow.test.mjs
git commit -m "feat: add site flow runner"
```

## Task 3: Add Selector Probe Runtime

**Files:**
- Create: `src/sites/probes/selector-runtime.ts`
- Create: `test/unit/site-probes.test.mjs`

- [ ] **Step 1: Write failing selector runtime tests**

Create `test/unit/site-probes.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attr,
  createExtractListExpression,
  extractList,
  href,
  text,
} from '../../dist/sites/probes/selector-runtime.js';

test('selector runtime builds bounded extractList expressions', () => {
  const expression = createExtractListExpression({
    root: 'ytd-comment-thread-renderer',
    limit: 2,
    fields: {
      author: text('#author-text'),
      url: href('a'),
      label: attr('a', 'aria-label'),
    },
    required: ['author'],
  });

  assert.equal(expression.includes('ytd-comment-thread-renderer'), true);
  assert.equal(expression.includes('#author-text'), true);
  assert.equal(expression.includes('aria-label'), true);
  assert.equal(expression.includes('slice(0, 2)'), true);
});

test('extractList unwraps evaluated rows and count evidence', async () => {
  const calls = [];
  const result = await extractList({
    profile: 'default',
    pageId: 7,
    evaluate: async (profile, expression, pageId) => {
      calls.push({ profile, expression, pageId });
      return {
        rows: [{ title: 'Example', href: 'https://example.com/watch?v=1' }],
        count: 1,
      };
    },
  }, {
    root: 'a#video-title',
    limit: 5,
    fields: {
      title: text(':self'),
      href: href(':self'),
    },
    required: ['href'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, 'default');
  assert.equal(calls[0].pageId, 7);
  assert.deepEqual(result.rows, [{ title: 'Example', href: 'https://example.com/watch?v=1' }]);
  assert.deepEqual(result.evidence, { count: 1, limit: 5, root: 'a#video-title' });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/site-probes.test.mjs
```

Expected: FAIL because `src/sites/probes/selector-runtime.ts` does not exist.

- [ ] **Step 3: Implement selector runtime**

Create `src/sites/probes/selector-runtime.ts`:

```ts
import { evaluateSiteExpression } from '../capabilities.js';

export type ProbeEvaluate = (profile: string, expression: string, pageId?: number) => Promise<unknown>;

export interface ProbePage {
  profile: string;
  pageId?: number;
  evaluate?: ProbeEvaluate;
}

interface FieldSpec {
  kind: 'text' | 'attr' | 'href';
  selector: string;
  attr?: string;
  max?: number;
}

export interface ExtractListSpec {
  root: string;
  fields: Record<string, FieldSpec>;
  limit: number;
  required?: string[];
}

export interface ExtractListResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  evidence: {
    count: number;
    limit: number;
    root: string;
  };
}

export function text(selector: string, options: { max?: number } = {}): FieldSpec {
  return { kind: 'text', selector, max: options.max };
}

export function attr(selector: string, attribute: string): FieldSpec {
  return { kind: 'attr', selector, attr: attribute };
}

export function href(selector: string): FieldSpec {
  return { kind: 'href', selector };
}

export function createExtractListExpression(spec: ExtractListSpec): string {
  return `(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const select = (root, selector) => selector === ':self' ? root : root.querySelector(selector);
    const fields = ${JSON.stringify(spec.fields)};
    const required = new Set(${JSON.stringify(spec.required || [])});
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(spec.root)})).slice(0, ${JSON.stringify(spec.limit)}).map(root => {
      const row = {};
      for (const [name, field] of Object.entries(fields)) {
        const element = select(root, field.selector);
        let value = '';
        if (field.kind === 'text') value = clean(element?.innerText || element?.textContent || '');
        if (field.kind === 'attr') value = clean(element?.getAttribute(field.attr) || '');
        if (field.kind === 'href') value = element?.href || (element?.getAttribute('href') ? new URL(element.getAttribute('href'), location.href).href : '');
        if (field.max && typeof value === 'string') value = value.slice(0, field.max);
        row[name] = value || undefined;
      }
      return row;
    }).filter(row => Array.from(required).every(name => row[name]));
    return { rows, count: rows.length };
  })()`;
}

export async function extractList<T extends Record<string, unknown> = Record<string, unknown>>(
  page: ProbePage,
  spec: ExtractListSpec,
): Promise<ExtractListResult<T>> {
  const evaluate = page.evaluate || evaluateSiteExpression;
  const value = await evaluate(page.profile, createExtractListExpression(spec), page.pageId);
  const unwrapped = value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value;
  const result = unwrapped as { rows?: T[]; count?: number };
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    rows,
    evidence: {
      count: typeof result.count === 'number' ? result.count : rows.length,
      limit: spec.limit,
      root: spec.root,
    },
  };
}
```

- [ ] **Step 4: Run focused probe tests**

Run:

```bash
npm run build && node --test test/unit/site-probes.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/sites/probes/selector-runtime.ts test/unit/site-probes.test.mjs
git commit -m "feat: add selector probe runtime"
```

## Task 4: Add Common and YouTube Semantic Probes

**Files:**
- Create: `src/sites/probes/common.ts`
- Create: `src/sites/probes/youtube.ts`
- Modify: `test/unit/site-probes.test.mjs`

- [ ] **Step 1: Add failing YouTube semantic probe tests**

Append to `test/unit/site-probes.test.mjs`:

```js
import {
  youtubeComments,
  youtubeSearchResults,
  youtubeScrollToComments,
} from '../../dist/sites/probes/youtube.js';

test('youtubeSearchResults maps rows to videos', async () => {
  const result = await youtubeSearchResults({
    profile: 'default',
    pageId: 9,
    evaluate: async () => ({
      rows: [
        { title: 'Video A', href: 'https://www.youtube.com/watch?v=abc123', text: 'Video A channel' },
        { title: 'Video B', href: 'https://www.youtube.com/watch?v=def456', text: 'Video B channel' },
      ],
      count: 2,
    }),
  }, { limit: 10 });

  assert.deepEqual(result.videos.map(video => video.id), ['abc123', 'def456']);
  assert.equal(result.evidence.count, 2);
});

test('youtubeComments returns visible comments and evidence', async () => {
  const result = await youtubeComments({
    profile: 'default',
    pageId: 10,
    evaluate: async () => ({
      rows: [
        { author: 'A', text: 'First comment', likes: '2', time: '1 day ago' },
      ],
      count: 1,
    }),
  }, { limit: 5 });

  assert.deepEqual(result.comments, [{ author: 'A', text: 'First comment', likes: '2', time: '1 day ago' }]);
  assert.deepEqual(result.evidence, { count: 1, limit: 5, root: 'ytd-comment-thread-renderer' });
});

test('youtubeScrollToComments runs a page scroll probe', async () => {
  const calls = [];
  const result = await youtubeScrollToComments({
    profile: 'default',
    pageId: 11,
    evaluate: async (profile, expression, pageId) => {
      calls.push({ profile, expression, pageId });
      return { value: { scrollY: 1200, height: 2400 } };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.scrolled, true);
  assert.equal(result.pageId, 11);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/site-probes.test.mjs
```

Expected: FAIL because `src/sites/probes/youtube.ts` does not exist.

- [ ] **Step 3: Implement common probes**

Create `src/sites/probes/common.ts`:

```ts
import { evaluateSiteExpression } from '../capabilities.js';
import type { ProbePage } from './selector-runtime.js';

export async function scrollPage(page: ProbePage, expression = 'window.scrollTo(0, Math.max(document.body.scrollHeight * 0.65, 1200)); ({ scrollY: window.scrollY, height: document.body.scrollHeight })'): Promise<Record<string, unknown>> {
  const evaluate = page.evaluate || evaluateSiteExpression;
  const value = await evaluate(page.profile, expression, page.pageId);
  const unwrapped = value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value;
  return unwrapped && typeof unwrapped === 'object' ? unwrapped as Record<string, unknown> : {};
}
```

- [ ] **Step 4: Implement YouTube semantic probes**

Create `src/sites/probes/youtube.ts`:

```ts
import { extractList, href, text, type ProbePage } from './selector-runtime.js';
import { scrollPage } from './common.js';

export interface YouTubeVideoRow {
  id?: string;
  title?: string;
  href?: string;
  text?: string;
}

export interface YouTubeCommentRow {
  author?: string;
  text?: string;
  likes?: string;
  time?: string;
}

function youtubeVideoId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).searchParams.get('v') || undefined;
  } catch {
    return undefined;
  }
}

export async function youtubeSearchResults(page: ProbePage, options: { limit: number }): Promise<{ videos: YouTubeVideoRow[]; evidence: Record<string, unknown> }> {
  const result = await extractList<YouTubeVideoRow>(page, {
    root: 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title',
    limit: options.limit,
    fields: {
      title: text('a#video-title', { max: 200 }),
      href: href('a#video-title'),
      text: text(':self', { max: 500 }),
    },
    required: ['href'],
  });
  const seen = new Set<string>();
  const videos = result.rows
    .map(row => ({ ...row, id: youtubeVideoId(row.href) }))
    .filter(row => {
      if (!row.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  return { videos, evidence: result.evidence };
}

export async function youtubeComments(page: ProbePage, options: { limit: number }): Promise<{ comments: YouTubeCommentRow[]; evidence: Record<string, unknown> }> {
  const result = await extractList<YouTubeCommentRow>(page, {
    root: 'ytd-comment-thread-renderer',
    limit: options.limit,
    fields: {
      author: text('#author-text'),
      text: text('#content-text'),
      likes: text('#vote-count-middle'),
      time: text('.published-time-text, #published-time-text'),
    },
    required: ['text'],
  });
  return { comments: result.rows, evidence: result.evidence };
}

export async function youtubeScrollToComments(page: ProbePage): Promise<Record<string, unknown>> {
  const result = await scrollPage(page);
  return {
    ...result,
    pageId: page.pageId,
    scrolled: true,
  };
}
```

- [ ] **Step 5: Run focused probe tests**

Run:

```bash
npm run build && node --test test/unit/site-probes.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/sites/probes/common.ts src/sites/probes/youtube.ts test/unit/site-probes.test.mjs
git commit -m "feat: add youtube semantic probes"
```

## Task 5: Migrate YouTube Search and Comments

**Files:**
- Modify: `src/sites/youtube.ts`
- Modify: `test/unit/adapter-proofs.test.mjs`

- [ ] **Step 1: Add failing YouTube adapter proof tests**

Append to `test/unit/adapter-proofs.test.mjs`:

```js
import { youtubeTesting } from '../../dist/sites/youtube.js';

test('youtube search proof returns step trace through injected deps', async () => {
  const deps = {
    openOrNavigateSitePage: async () => ({ url: 'https://www.youtube.com/results?search_query=agent', title: 'YouTube', pageId: 3 }),
    sleep: async () => {},
    youtubeSearchResults: async () => ({
      videos: [{ id: 'abc123', title: 'Agent video', href: 'https://www.youtube.com/watch?v=abc123', text: 'Agent video channel' }],
      evidence: { count: 1, limit: 20, root: 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title' },
    }),
  };

  const receipt = await youtubeTesting.runSearch({ profile: 'default', output: { json: true, profile: 'default' } }, { keyword: 'agent' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'search');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.videos.length, 1);
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_search_page', 'wait_for_search_results', 'extract_search_results']);
});

test('youtube comments proof returns step trace through injected deps', async () => {
  const deps = {
    openOrNavigateSitePage: async () => ({ url: 'https://www.youtube.com/watch?v=abc123', title: 'YouTube', pageId: 4 }),
    sleep: async () => {},
    youtubeScrollToComments: async () => ({ scrolled: true, pageId: 4 }),
    youtubeComments: async () => ({
      comments: [{ author: 'A', text: 'Comment', likes: '1', time: 'today' }],
      evidence: { count: 1, limit: 50, root: 'ytd-comment-thread-renderer' },
    }),
  };

  const receipt = await youtubeTesting.runComments({ profile: 'default', output: { json: true, profile: 'default' } }, { target: 'abc123' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'comments');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.comments.length, 1);
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_video_page', 'wait_for_watch_page', 'scroll_to_comments', 'extract_comments']);
});
```

- [ ] **Step 2: Run focused adapter tests and verify failure**

Run:

```bash
npm run build && node --test test/unit/adapter-proofs.test.mjs
```

Expected: FAIL because `youtubeTesting` is not exported.

- [ ] **Step 3: Refactor YouTube imports and dependency injection**

In `src/sites/youtube.ts`, change imports to remove raw evaluate from migrated paths and add flow/probes:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { runSiteCommand, addSitePageIdOption, clampInt, evaluateSiteExpression, openOrNavigateSitePage, siteReceipt, sleep } from './capabilities.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './capabilities.js';
import { defineSiteFlow } from './flow/define-flow.js';
import { youtubeComments, youtubeSearchResults, youtubeScrollToComments } from './probes/youtube.js';
```

Add this dependency interface after option interfaces:

```ts
interface YouTubeDeps {
  openOrNavigateSitePage: typeof openOrNavigateSitePage;
  sleep: typeof sleep;
  youtubeSearchResults: typeof youtubeSearchResults;
  youtubeComments: typeof youtubeComments;
  youtubeScrollToComments: typeof youtubeScrollToComments;
}

const defaultDeps: YouTubeDeps = {
  openOrNavigateSitePage,
  sleep,
  youtubeSearchResults,
  youtubeComments,
  youtubeScrollToComments,
};
```

- [ ] **Step 4: Replace `runSearch` with flow orchestration**

Replace only `runSearch`:

```ts
async function runSearch(ctx: SiteCommandContext, options: SearchOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const limit = clampInt(options.limit, 20, 1, 50);
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(options.keyword)}`;
  return defineSiteFlow(ctx, SITE, 'search')
    .step('open_search_page', async () => deps.openOrNavigateSitePage(ctx.profile, url, options.pageId))
    .step('wait_for_search_results', async flow => {
      await deps.sleep(2200);
      const page = flow.get<{ pageId?: number }>('open_search_page');
      return { pageId: page.pageId, waitedMs: 2200 };
    })
    .step('extract_search_results', async flow => {
      const page = flow.get<{ pageId?: number }>('open_search_page');
      const result = await deps.youtubeSearchResults({ profile: ctx.profile, pageId: page.pageId }, { limit });
      return { ...result.evidence, videos: result.videos };
    })
    .receipt(flow => {
      const page = flow.get<{ url: string; title: string; pageId?: number }>('open_search_page');
      const extracted = flow.get<{ videos: unknown[] }>('extract_search_results');
      return siteReceipt(SITE, 'search', {
        keyword: options.keyword,
        pageId: page.pageId,
        limit,
        url: page.url,
        title: page.title,
        videos: extracted.videos,
        sideEffects: [],
      });
    });
}
```

- [ ] **Step 5: Replace `runComments` with flow orchestration**

Replace only `runComments`:

```ts
async function runComments(ctx: SiteCommandContext, options: CommentsOptions, deps: YouTubeDeps = defaultDeps): Promise<SiteReceipt> {
  const id = videoId(options.target);
  const limit = clampInt(options.limit, 50, 1, 200);
  const url = id ? `https://www.youtube.com/watch?v=${id}` : options.target;
  return defineSiteFlow(ctx, SITE, 'comments')
    .step('open_video_page', async () => deps.openOrNavigateSitePage(ctx.profile, url, options.pageId))
    .step('wait_for_watch_page', async flow => {
      await deps.sleep(1500);
      const page = flow.get<{ pageId?: number }>('open_video_page');
      return { pageId: page.pageId, waitedMs: 1500 };
    })
    .step('scroll_to_comments', async flow => {
      const page = flow.get<{ pageId?: number }>('open_video_page');
      return deps.youtubeScrollToComments({ profile: ctx.profile, pageId: page.pageId });
    })
    .step('extract_comments', async flow => {
      await deps.sleep(2500);
      const page = flow.get<{ pageId?: number }>('open_video_page');
      const result = await deps.youtubeComments({ profile: ctx.profile, pageId: page.pageId }, { limit });
      return { ...result.evidence, waitedMs: 2500, comments: result.comments };
    })
    .receipt(flow => {
      const page = flow.get<{ url: string; title: string; pageId?: number }>('open_video_page');
      const extracted = flow.get<{ comments: unknown[] }>('extract_comments');
      return siteReceipt(SITE, 'comments', {
        target: options.target,
        id,
        pageId: page.pageId,
        limit,
        url: page.url,
        title: page.title,
        comments: extracted.comments,
        sideEffects: [],
      });
    });
}
```

- [ ] **Step 6: Export YouTube testing hooks**

Add this near the bottom of `src/sites/youtube.ts`, before `youtubeAdapter` or after it:

```ts
export const youtubeTesting = {
  runSearch,
  runComments,
  deps: defaultDeps,
};
```

- [ ] **Step 7: Run focused adapter tests**

Run:

```bash
npm run build && node --test test/unit/adapter-proofs.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/sites/youtube.ts test/unit/adapter-proofs.test.mjs
git commit -m "feat: migrate youtube search comments to flows"
```

## Task 6: Add YouTube Raw Evaluate Governance

**Files:**
- Modify: `test/unit/site-import-governance.test.mjs`

- [ ] **Step 1: Add failing governance test for migrated YouTube paths**

Append this test to `test/unit/site-import-governance.test.mjs`:

```js
test('migrated youtube adapter paths do not call raw page evaluation directly', () => {
  const source = fs.readFileSync(path.join(sitesDir, 'youtube.ts'), 'utf8');
  const runSearch = source.match(/async function runSearch[\s\S]*?\n}\n\nasync function runVideo/);
  const runComments = source.match(/async function runComments[\s\S]*?\n}\n\nasync function runTranscript/);

  assert.notEqual(runSearch, null);
  assert.notEqual(runComments, null);
  assert.equal(runSearch[0].includes('evaluateSiteExpression'), false);
  assert.equal(runComments[0].includes('evaluateSiteExpression'), false);
  assert.equal(runSearch[0].includes('evaluateInSitePage'), false);
  assert.equal(runComments[0].includes('evaluateInSitePage'), false);
});
```

- [ ] **Step 2: Run governance test**

Run:

```bash
npm run build && node --test test/unit/site-import-governance.test.mjs
```

Expected: PASS after Task 5. If it fails because function boundary regex does not match, adjust the regex to match the actual adjacent function names without weakening the raw evaluate assertions.

- [ ] **Step 3: Commit Task 6**

```bash
git add test/unit/site-import-governance.test.mjs
git commit -m "test: govern migrated youtube evaluate usage"
```

## Task 7: Full Verification

**Files:**
- No source edits expected unless verification exposes a real issue.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: only unrelated pre-existing worktree changes remain unstaged; implementation commits are visible in recent history.

- [ ] **Step 4: Stop for review**

Report:

- New files created under `src/sites/flow/` and `src/sites/probes/`.
- YouTube `search` and `comments` now use flow steps and semantic probes.
- Existing YouTube `video`, `channel`, and `transcript` remain unchanged.
- `npm run typecheck` and `npm run test:unit` results.

Do not migrate additional adapters in this plan.
