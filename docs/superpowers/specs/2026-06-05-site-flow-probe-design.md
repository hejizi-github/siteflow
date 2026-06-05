# Site Flow and Probe Design

## Problem

The current site adapter layer mixes command wiring, browser orchestration, page-specific JavaScript, HTTP calls, and receipt assembly inside individual adapter files. This makes medium and complex adapters read like script piles instead of explicit workflows. The most unstable part is raw browser JavaScript embedded in adapters through `evaluateSiteExpression` or `evaluateInSitePage`.

The first milestone should improve both audiences:

- Developers should be able to read a site command as a task graph with clear steps, dependencies, and failure points.
- CLI users should receive receipts that show which steps ran, what evidence was collected, and where execution failed.

## Goals

- Add a small typed task graph layer for site commands.
- Add a page probe abstraction so adapters stop owning large raw JavaScript strings.
- Keep existing CLI command names, arguments, and top-level receipt fields compatible.
- Use YouTube `search` and `comments` as the first real adapter migration.
- Avoid daemon, runtime, and Browser Kernel protocol changes in the first milestone.
- Keep old adapters working while the new pattern is introduced incrementally.

## Non-Goals

- Do not migrate every site adapter in the first milestone.
- Do not introduce YAML or JSON recipes.
- Do not add an LLM planning layer.
- Do not implement cross-command resume, distributed checkpoints, or background graph execution.
- Do not remove all browser JavaScript. The goal is to centralize and constrain it in probes.
- Do not change `src/runtime/`, `src/daemon/server.ts`, or daemon client protocol unless implementation uncovers a narrow bug that blocks the milestone.

## Architecture

The new layering is:

```text
site adapter command
  -> site flow / task graph
    -> semantic probes
      -> selector probe runtime
        -> src/sites/capabilities.ts
          -> daemon client
            -> Browser Kernel
```

### Site Flow

`src/sites/flow/` provides the smallest useful task graph primitive:

- `defineSiteFlow` or equivalent command-level runner.
- Named `step` execution.
- Step start and end timestamps.
- Step evidence.
- Step failure codes and messages.
- Receipt merging that preserves existing `SiteReceipt` fields and appends optional `steps`.

The first version supports sequential steps and simple conditional failures. It does not need parallel graph execution or persisted checkpoints.

Example shape:

```ts
const receipt = await defineSiteFlow(ctx, SITE, 'comments')
  .step('open_video_page', async flow => {
    const page = await flow.browser.open(videoUrl, options.pageId);
    return { pageId: page.pageId, url: page.url, title: page.title };
  })
  .step('scroll_to_comments', async flow => youtubeProbes.scrollToComments(flow.page))
  .step('extract_comments', async flow => youtubeProbes.comments(flow.page, { limit }))
  .receipt(flow => ({
    target: options.target,
    id,
    pageId: flow.get('open_video_page').pageId,
    comments: flow.get('extract_comments').comments,
    sideEffects: [],
  }));
```

The exact API can change during implementation, but the adapter should read as workflow steps, not raw page scripts.

### Semantic Probes

`src/sites/probes/common.ts` and `src/sites/probes/youtube.ts` expose intent-level page operations.

Common probes include:

- `pageSummary`
- `detectBlockers`
- `readPageText`
- `extractLinks`
- `scrollPage`
- `scrollUntil`

YouTube probes for the first milestone include:

- `searchResults({ limit })`
- `comments({ limit })`
- `watchState()`
- `scrollToComments()`

Semantic probes are the only place where site-specific selector choices should live after migration. Adapters should call semantic probes instead of constructing browser JavaScript.

### Selector Probe Runtime

`src/sites/probes/selector-runtime.ts` owns the raw JavaScript generation and browser evaluation for structured DOM extraction.

The runtime should support:

- `extractList`
- `extractOne`
- `text`
- `attr`
- `href`
- `jsonState`
- `exists`
- `count`
- safe text cleanup
- limit truncation
- optional required fields
- field-level omission without throwing random DOM errors

Example selector DSL:

```ts
await extractList(page, {
  root: 'ytd-comment-thread-renderer',
  limit,
  fields: {
    author: text('#author-text'),
    text: text('#content-text'),
    likes: text('#vote-count-middle'),
    time: text('.published-time-text, #published-time-text'),
  },
  required: ['text'],
});
```

The runtime still evaluates JavaScript in the page, but adapters and most probes do not hand-write string scripts. This centralizes cleaning, selector miss handling, URL normalization, limit behavior, and error translation.

## Receipt Contract

Existing fields stay intact:

```ts
site: string;
command: string;
ok: boolean;
state: string;
page?: { url: string; title: string };
screenshots?: string[];
observations?: Record<string, unknown>;
errors?: Array<{ code: string; message: string }>;
next?: string[];
```

Add optional steps:

```ts
steps?: Array<{
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
}>;
```

Evidence must be low sensitivity by default. Good evidence includes URL, title, item counts, selector hit counts, page id, elapsed attempts, and blocker codes. Do not include cookies, auth headers, request bodies, localStorage dumps, user secrets, or full private DOM text.

## First Milestone Scope

Migrate only YouTube:

- `siteflow youtube search <keyword>`
- `siteflow youtube comments <target>`

Leave these commands unchanged for now:

- `siteflow youtube video <target>`
- `siteflow youtube channel <target>`
- `siteflow youtube transcript <target>`

The milestone should add infrastructure and prove the migration pattern without rewriting all site adapters.

## Governance

The repository cannot immediately ban `evaluateSiteExpression` in every adapter because many existing adapters still use it. Add incremental governance:

- Migrated adapters, starting with `src/sites/youtube.ts`, must not call raw `evaluateSiteExpression` or `evaluateInSitePage`.
- Probe modules and `src/sites/capabilities.ts` are allowed to call raw browser evaluation.
- New site commands should use flow and probes unless there is a documented reason not to.
- Existing site import boundary tests must continue to pass.

Future migrations can tighten this allowlist adapter by adapter.

## Testing

Use Node built-in `node:test` and `node:assert/strict`.

Add focused tests for:

- Flow runner records successful steps.
- Flow runner records failed steps and returns structured failure data.
- Selector runtime extracts list fields from fixture HTML.
- Selector runtime tolerates missing optional selectors.
- YouTube probes extract search results and comments from fixture DOM.
- YouTube adapter no longer directly calls raw browser evaluation.
- Receipt output preserves existing top-level fields and includes optional steps.

Run at least:

```bash
npm run typecheck
npm run test:unit
```

Because the first milestone changes site adapter and capabilities-adjacent behavior, `npm run test:unit` is required.

## Risks

- A selector DSL that is too narrow will push raw scripts back into adapters. Keep a controlled `jsonState` or `customProbe` escape hatch inside the probe layer only.
- A graph runtime that is too ambitious will expand into daemon/runtime work. Keep the first version sequential and in-process.
- Step evidence can leak sensitive page data if unrestricted. Default evidence should be small, structured, and low sensitivity.
- Governance tests can break old adapters if applied globally. Start with migrated adapter rules.

## Success Criteria

- YouTube `search` and `comments` commands keep their existing CLI shape.
- YouTube migrated command receipts include step traces.
- `src/sites/youtube.ts` reads as orchestration and does not contain large raw browser JavaScript strings.
- Raw page JavaScript for migrated paths is centralized in probe runtime or YouTube probe modules.
- Existing site adapter boundaries remain intact.
- `npm run typecheck` and `npm run test:unit` pass.
