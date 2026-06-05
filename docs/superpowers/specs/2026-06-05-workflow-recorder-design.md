# Siteflow Workflow Recorder Design

## Goal

Build a replay-oriented recorder for Siteflow: a user opens a real browser page, performs a workflow once, and Siteflow turns those actions into a stable, inspectable, replayable workflow.

The first-class output is a `SiteflowWorkflow` JSON file. A readable CLI script can be exported from that JSON. The recorder captures user intent and lightweight evidence, not raw browser dumps or video.

## User Decisions

- Primary mode: replay automation.
- Scope: base page actions, mutating form/publish/upload flows, and extraction steps.
- Output: workflow JSON plus CLI script export.
- Sensitive input: variableized by default; real values live only in a user-specified private env file.
- Mutating actions: replay follows recorded intent by default.
- Element targeting: semantic-first matching, with structural and geometry fallbacks.

## Non-Goals

- No video/screen recording.
- No CAPTCHA, DRM, paywall, or anti-abuse bypass.
- No generated site adapter in the first version.
- No unlimited retries.
- No full DOM, cookie, token, or network body persistence in workflow JSON.
- No full JSONPath engine dependency.
- No cross-browser replay guarantee.
- Drag/drop is recorded as unsupported evidence in the first version, not automatically replayed.

## CLI/API

### Record

```bash
siteflow --json recorder start --url https://example.com --out flow.json
siteflow --json recorder stop
```

`recorder start` starts or reuses the daemon, opens the target URL, injects the recorder script, and binds the recorder session to the selected page. The user then operates the real browser. `recorder stop` normalizes recorded events into workflow steps, writes `flow.json`, and returns a receipt.

Recorder stop receipt includes:

- `steps`
- `variables`
- `mutatingSteps`
- `unsupportedEvents`
- `out`

### Replay

```bash
siteflow --json replay run flow.json --env-file .siteflow/private.env
```

Replay reads the workflow, resolves variables, opens the start URL, executes steps in order, and emits per-step receipts.

Optional safety/debug switches:

```bash
siteflow --json replay run flow.json --dry-run
siteflow --json replay run flow.json --stop-before-mutating
siteflow --json replay run flow.json --require-mutating-confirmation
```

Mutating steps execute by default because the workflow records user intent. The flags let CI, debugging, or cautious users opt into safer behavior.

### Export CLI

```bash
siteflow --json replay export-cli flow.json --out flow.sh
```

The exported script preserves variables such as `${LOGIN_EMAIL}`, labels mutating steps in comments, and emits readable `siteflow --json browser ...` commands where possible.

## Workflow JSON Model

```ts
interface SiteflowWorkflow {
  version: 1;
  kind: 'siteflow.workflow';
  name?: string;
  createdAt: string;
  startUrl: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  evidence: WorkflowEvidenceSummary;
}
```

Planned workflow step set:
```ts
type WorkflowStep =
  | OpenStep
  | ClickStep
  | TypeStep
  | SelectStep
  | UploadStep
  | ScrollStep
  | WaitStep
  | ExtractDomStep
  | ExtractNetworkStep
  | ScreenshotStep;
```

Phase 1 implements `OpenStep`, `ClickStep`, `TypeStep`, `SelectStep`, `ScrollStep`, `WaitStep`, and `ScreenshotStep`. `UploadStep` is added in Phase 2. `ExtractDomStep` and `ExtractNetworkStep` are added in Phase 3.

Each step uses a shared envelope:

```ts
interface BaseStep {
  id: string;
  type: string;
  label?: string;
  urlBefore?: string;
  urlAfter?: string;
  target?: RecordedTarget;
  evidence?: StepEvidence;
  mutating?: boolean;
  mutationIntent?: 'submit-form' | 'upload' | 'publish' | 'send-message' | 'download' | 'unknown';
}
```

### Target Model

```ts
interface RecordedTarget {
  semantic?: {
    role?: string;
    aria?: string;
    label?: string;
    text?: string;
    placeholder?: string;
  };
  structural?: {
    selector?: string;
    xpath?: string;
    nth?: number;
  };
  geometry?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  confidence: 'high' | 'medium' | 'low';
}
```

Replay target matching order:

1. aria / label / placeholder
2. role + text
3. visible text
4. stable selector
5. xpath
6. coordinates

Ambiguous targets do not trigger blind clicks. Replay returns `AMBIGUOUS_TARGET` with candidate summaries.

### Variables

```ts
interface WorkflowVariable {
  name: string;
  source: 'input' | 'file' | 'env';
  sensitive: boolean;
  required: boolean;
}
```

Sensitive values are represented as variable references in workflow JSON:

```json
{
  "type": "type",
  "value": "${LOGIN_EMAIL}"
}
```

Replay resolves variables from `--env-file` first, then process environment. Missing variables fail with `MISSING_WORKFLOW_VARIABLE`.

### Evidence Window

```ts
interface StepEvidence {
  before: {
    url: string;
    title: string;
    activeElement?: string;
    networkLastId?: number;
  };
  after: {
    url: string;
    title: string;
    networkLastId?: number;
    visibleTextHash?: string;
  };
  networkIds?: number[];
  consoleIds?: number[];
}
```

Evidence is intentionally lightweight. It supports diagnosis without storing private browser artifacts.

## Runtime Design

Add:

```text
src/runtime/recorder-runtime.ts
src/runtime/replay-runtime.ts
src/runtime/target-matcher.ts
src/runtime/workflow-export.ts
src/runtime/workflow-types.ts
```

Daemon keeps one recorder session per profile/page:

```ts
interface RecorderSession {
  id: string;
  pageId: number;
  startedAt: string;
  out?: string;
  events: RecordedEvent[];
  variables: WorkflowVariable[];
  options: RecorderOptions;
}
```

### Recorder Start

1. Open or select a page.
2. Create a recorder session.
3. Expose a binding such as `__siteflowRecordEvent`.
4. Inject a page script.
5. Record `startUrl` and initial page evidence.

### Injected Event Capture

The injected script listens for:

- `click`
- `input`
- `change`
- `submit`
- `keydown` for Enter, Escape, Tab, and similar control keys only
- `scroll`, debounced
- drag/drop as unsupported evidence

Raw event shape:

```ts
interface RecordedEvent {
  ts: string;
  type: 'click' | 'input' | 'change' | 'submit' | 'scroll' | 'keydown';
  target: RecordedTarget;
  value?: string | { variable: string };
  url: string;
  title: string;
  networkLastId?: number;
  consoleLastId?: number;
}
```

### Normalization

`recorder stop` converts raw events to workflow steps:

- Consecutive input events become one `type` step.
- Debounced scroll events become one `scroll` step.
- Clicks followed by navigation carry wait evidence.
- Submit buttons and form submits become `mutating:true` with `mutationIntent`.
- File input changes become `upload` steps.

### Sensitive Input Detection

Inputs become variables when any of these match:

- `type=password`
- `name`, `id`, `autocomplete`, or label contains password/token/secret/api/key/email/phone
- upload file paths
- contenteditable fields by default

Generated variable names are stable and readable: `LOGIN_EMAIL`, `PASSWORD`, `UPLOAD_FILE_1`, `TEXT_INPUT_2`.

## Replay Design

`replay run` validates the workflow, resolves variables, opens the start URL, executes steps, and returns structured receipts.

Each step receipt includes:

- `stepId`
- `type`
- `ok`
- `targetMatchedBy`
- `urlBefore`
- `urlAfter`
- `networkDelta`
- `consoleDelta`

Failure codes:

- `MISSING_WORKFLOW_VARIABLE`
- `TARGET_NOT_FOUND`
- `AMBIGUOUS_TARGET`
- `REPLAY_STEP_TIMEOUT`
- `UNSUPPORTED_WORKFLOW_STEP`
- `EXTRACTION_FAILED`

Failure receipts include current URL/title, original target, similar candidates, visible text hash, and recent console/network summaries.

### Wait Policy

After actions, replay waits for a bounded stability window:

- document ready state
- short network idle window
- URL changes
- recorded expectations such as text, selector, or URL contains when available

There is no infinite retry.

### Extraction

DOM extraction:

```json
{
  "type": "extract_dom",
  "fields": {
    "title": { "selector": "h1", "kind": "text" },
    "price": { "selector": ".price", "kind": "text" }
  }
}
```

Network extraction:

```json
{
  "type": "extract_network",
  "match": {
    "urlContains": "/api/search",
    "method": "POST"
  },
  "path": "items[].title"
}
```

The first version uses a small path syntax instead of adding a JSONPath dependency.

## Tests

Use Node built-in `node:test` and the existing fixture approach.

Unit tests cover:

- workflow JSON validation
- raw event normalization
- target generation
- sensitive input detection
- variable name generation
- target matcher precedence
- replay failure receipts
- CLI export

Fixture E2E grows by phase using `test/fixtures/basic/` or a new recorder fixture page with:

- button click causing visible text
- text/password input
- select
- file input
- form submit mock
- scroll container
- DOM extract target
- fetch mock endpoint

Phase 1 E2E flow:

```bash
siteflow --json recorder start --url <fixture> --out flow.json
# test drives the page through existing browser click/type/select/scroll commands
siteflow --json recorder stop
siteflow --json replay run flow.json --env-file private.env
siteflow --json replay export-cli flow.json --out flow.sh
```

Phase 2 adds file upload and mutating form submission to the same flow. Phase 3 adds DOM and network extraction assertions.

This validates real browser behavior, not a mocked browser.

## Phased Delivery

### Phase 1: Core Replay

- `recorder start` / `recorder stop`
- click/type/select/scroll/wait/screenshot
- workflow JSON
- `replay run`
- `replay export-cli`
- fixture E2E

### Phase 2: Mutating + Variables

- sensitive input variable store
- upload
- submit/publish intent detection
- env-file replay
- mutating override flags

### Phase 3: Extraction

- `extract_dom`
- `extract_network`
- replay observations output
- network evidence windows

## Open Risks

- Semantic target matching can still be ambiguous on pages with repeated labels. Replay must fail loudly instead of guessing.
- Generated selectors can be brittle. They are fallbacks, not the primary target.
- Mutating steps default to execution by user decision. Receipts and exported scripts must make mutating intent obvious.
- Recorder injected scripts may miss events inside closed shadow roots or cross-origin iframes.
- Network extraction should avoid storing or printing sensitive request bodies by default.

## Acceptance Criteria

- A user can record a fixture workflow, stop recording, and receive a valid workflow JSON file.
- The recorded JSON can be replayed successfully against the fixture page.
- Sensitive text/password/file inputs are variableized and not written as raw values to workflow JSON.
- Mutating steps are marked with `mutating:true` and replay by default.
- `--dry-run` and `--stop-before-mutating` prevent mutating execution.
- Target matching uses semantic target data before structural fallback.
- `replay export-cli` creates a readable script with variables preserved.
- Unit and fixture E2E tests pass through `npm run test:unit` for affected areas.
