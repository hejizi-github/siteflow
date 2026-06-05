# Workflow Recorder Core Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of the workflow recorder: record basic browser actions into a workflow JSON file, replay that JSON, and export a readable CLI script.

**Architecture:** Add a focused workflow model plus recorder/replay runtime modules under `src/runtime/`. The daemon exposes recorder and replay endpoints, the daemon client wraps them, and the Commander CLI adds `recorder` and `replay` commands. Phase 1 records and replays open/click/type/select/scroll/wait/screenshot steps; upload, mutating variables, and extraction are separate follow-up plans.

**Tech Stack:** Node 20+, TypeScript ESM, Commander, Playwright through the existing BrowserRuntime, Node built-in `node:test` and `node:assert/strict`.

---

## File Structure

- Create `src/runtime/workflow-types.ts`: shared workflow, target, recorder, replay, and receipt types for Phase 1.
- Create `src/runtime/workflow-validation.ts`: runtime validation for workflow JSON loaded from disk.
- Create `src/runtime/workflow-export.ts`: export workflow JSON into readable Siteflow CLI commands.
- Create `src/runtime/target-matcher.ts`: semantic-first target matching helpers for replay.
- Create `src/runtime/recorder-runtime.ts`: page binding, injected script source, event normalization, workflow file writing.
- Create `src/runtime/replay-runtime.ts`: workflow execution against `BrowserRuntime` and per-step receipts.
- Modify `src/runtime/browser-runtime.ts`: own recorder sessions and expose recorder/replay methods.
- Modify `src/daemon/server.ts`: add HTTP endpoints for recorder/replay.
- Modify `src/daemon/client.ts`: add client wrappers.
- Modify `src/cli/main.ts`: add `recorder start/stop/status` and `replay run/export-cli` commands.
- Create `test/unit/workflow-recorder.test.mjs`: unit tests for validation, event normalization, and CLI export.
- Create `test/unit/workflow-replay.test.mjs`: unit tests for target matching and replay failure behavior.
- Create `test/fixtures/basic/recorder.html`: local fixture page for core replay.
- Create `test/unit/workflow-recorder-e2e.test.mjs`: focused build-backed fixture test for record/replay/export.

## Task 1: Add Workflow Types and Validation

**Files:**
- Create: `src/runtime/workflow-types.ts`
- Create: `src/runtime/workflow-validation.ts`
- Test: `test/unit/workflow-recorder.test.mjs`

- [ ] **Step 1: Write failing workflow validation tests**

Create `test/unit/workflow-recorder.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

const validation = () => import('../../dist/runtime/workflow-validation.js');

test('validateWorkflow accepts a minimal phase 1 workflow', async () => {
  const { validateWorkflow } = await validation();
  const workflow = validateWorkflow({
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target: { semantic: { text: 'Continue' }, confidence: 'high' } },
    ],
    evidence: { pages: 1, events: 2 },
  });

  assert.equal(workflow.kind, 'siteflow.workflow');
  assert.equal(workflow.steps.length, 2);
});

test('validateWorkflow rejects unsupported workflow versions', async () => {
  const { validateWorkflow } = await validation();
  assert.throws(
    () => validateWorkflow({ version: 2, kind: 'siteflow.workflow', steps: [] }),
    /WORKFLOW_UNSUPPORTED_VERSION/,
  );
});

test('validateWorkflow rejects unsupported phase 1 step types', async () => {
  const { validateWorkflow } = await validation();
  assert.throws(
    () => validateWorkflow({
      version: 1,
      kind: 'siteflow.workflow',
      createdAt: '2026-06-05T00:00:00.000Z',
      startUrl: 'https://example.com/',
      variables: [],
      steps: [{ id: 'step-1', type: 'upload' }],
      evidence: {},
    }),
    /UNSUPPORTED_WORKFLOW_STEP/,
  );
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: FAIL because `dist/runtime/workflow-validation.js` does not exist.

- [ ] **Step 3: Add workflow type definitions**

Create `src/runtime/workflow-types.ts`:

```ts
export type WorkflowStepType = 'open' | 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'screenshot';

export interface WorkflowVariable {
  name: string;
  source: 'input' | 'file' | 'env';
  sensitive: boolean;
  required: boolean;
}

export interface RecordedTarget {
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

export interface StepEvidence {
  before?: {
    url: string;
    title: string;
    activeElement?: string;
    networkLastId?: number;
  };
  after?: {
    url: string;
    title: string;
    networkLastId?: number;
    visibleTextHash?: string;
  };
  networkIds?: number[];
  consoleIds?: number[];
}

export interface BaseWorkflowStep {
  id: string;
  type: WorkflowStepType;
  label?: string;
  urlBefore?: string;
  urlAfter?: string;
  target?: RecordedTarget;
  evidence?: StepEvidence;
  mutating?: boolean;
}

export interface OpenWorkflowStep extends BaseWorkflowStep {
  type: 'open';
  url: string;
}

export interface ClickWorkflowStep extends BaseWorkflowStep {
  type: 'click';
  target: RecordedTarget;
  button?: 'left' | 'right' | 'middle';
}

export interface TypeWorkflowStep extends BaseWorkflowStep {
  type: 'type';
  target: RecordedTarget;
  value: string;
  clear?: boolean;
  pressEnter?: boolean;
}

export interface SelectWorkflowStep extends BaseWorkflowStep {
  type: 'select';
  target: RecordedTarget;
  option: string;
}

export interface ScrollWorkflowStep extends BaseWorkflowStep {
  type: 'scroll';
  deltaX: number;
  deltaY: number;
}

export interface WaitWorkflowStep extends BaseWorkflowStep {
  type: 'wait';
  ms?: number;
  urlContains?: string;
  text?: string;
  selector?: string;
}

export interface ScreenshotWorkflowStep extends BaseWorkflowStep {
  type: 'screenshot';
  fullPage?: boolean;
}

export type WorkflowStep =
  | OpenWorkflowStep
  | ClickWorkflowStep
  | TypeWorkflowStep
  | SelectWorkflowStep
  | ScrollWorkflowStep
  | WaitWorkflowStep
  | ScreenshotWorkflowStep;

export interface SiteflowWorkflow {
  version: 1;
  kind: 'siteflow.workflow';
  name?: string;
  createdAt: string;
  startUrl: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  evidence: Record<string, unknown>;
}

export interface RecordedEvent {
  ts: string;
  type: 'click' | 'input' | 'change' | 'scroll' | 'keydown';
  target?: RecordedTarget;
  value?: string;
  url: string;
  title: string;
  networkLastId?: number;
  consoleLastId?: number;
  key?: string;
  deltaX?: number;
  deltaY?: number;
}

export interface RecorderStartOptions {
  url?: string;
  pageId?: number;
  out: string;
}

export interface RecorderStatus {
  recording: boolean;
  sessionId?: string;
  pageId?: number;
  startedAt?: string;
  out?: string;
  events: number;
}

export interface RecorderStopResult {
  workflow: SiteflowWorkflow;
  out: string;
  steps: number;
  variables: number;
  mutatingSteps: number;
  unsupportedEvents: number;
}

export interface ReplayStepReceipt {
  stepId: string;
  type: WorkflowStepType;
  ok: boolean;
  targetMatchedBy?: string;
  urlBefore?: string;
  urlAfter?: string;
  networkDelta?: number;
  consoleDelta?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface ReplayRunOptions {
  envFile?: string;
  dryRun?: boolean;
  stopBeforeMutating?: boolean;
  requireMutatingConfirmation?: boolean;
}

export interface ReplayRunResult {
  ok: boolean;
  workflow: {
    version: 1;
    steps: number;
    startUrl: string;
  };
  steps: ReplayStepReceipt[];
}
```

- [ ] **Step 4: Add workflow validation**

Create `src/runtime/workflow-validation.ts`:

```ts
import { SiteflowError } from '../shared/errors.js';
import type { SiteflowWorkflow, WorkflowStep, WorkflowStepType } from './workflow-types.js';

const PHASE_1_STEP_TYPES = new Set<WorkflowStepType>([
  'open',
  'click',
  'type',
  'select',
  'scroll',
  'wait',
  'screenshot',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SiteflowError('BAD_WORKFLOW', `${field} must be a non-empty string.`);
  }
  return value;
}

function validateStep(value: unknown, index: number): WorkflowStep {
  if (!isRecord(value)) throw new SiteflowError('BAD_WORKFLOW', `steps[${index}] must be an object.`);
  const id = requireString(value.id, `steps[${index}].id`);
  const type = requireString(value.type, `steps[${index}].type`) as WorkflowStepType;
  if (!PHASE_1_STEP_TYPES.has(type)) throw new SiteflowError('UNSUPPORTED_WORKFLOW_STEP', `Unsupported workflow step type: ${type}`);
  if (type === 'open') requireString(value.url, `steps[${index}].url`);
  if ((type === 'click' || type === 'type' || type === 'select') && !isRecord(value.target)) {
    throw new SiteflowError('BAD_WORKFLOW', `steps[${index}].target is required for ${type}.`);
  }
  if (type === 'type') requireString(value.value, `steps[${index}].value`);
  if (type === 'select') requireString(value.option, `steps[${index}].option`);
  return { ...value, id, type } as WorkflowStep;
}

export function validateWorkflow(value: unknown): SiteflowWorkflow {
  if (!isRecord(value)) throw new SiteflowError('BAD_WORKFLOW', 'Workflow must be an object.');
  if (value.version !== 1) throw new SiteflowError('WORKFLOW_UNSUPPORTED_VERSION', 'Only workflow version 1 is supported.');
  if (value.kind !== 'siteflow.workflow') throw new SiteflowError('BAD_WORKFLOW', 'Workflow kind must be siteflow.workflow.');
  const createdAt = requireString(value.createdAt, 'createdAt');
  const startUrl = requireString(value.startUrl, 'startUrl');
  const variables = Array.isArray(value.variables) ? value.variables : [];
  const rawSteps = Array.isArray(value.steps) ? value.steps : undefined;
  if (!rawSteps) throw new SiteflowError('BAD_WORKFLOW', 'steps must be an array.');
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  return {
    version: 1,
    kind: 'siteflow.workflow',
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    createdAt,
    startUrl,
    variables: variables as SiteflowWorkflow['variables'],
    steps: rawSteps.map(validateStep),
    evidence,
  };
}
```

- [ ] **Step 5: Run focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/runtime/workflow-types.ts src/runtime/workflow-validation.ts test/unit/workflow-recorder.test.mjs
git commit -m "feat: add workflow schema validation"
```

## Task 2: Add Workflow CLI Export

**Files:**
- Create: `src/runtime/workflow-export.ts`
- Test: `test/unit/workflow-recorder.test.mjs`

- [ ] **Step 1: Extend tests for CLI export**

Append to `test/unit/workflow-recorder.test.mjs`:

```js
test('exportWorkflowCli preserves variables and labels mutating steps', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli({
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'type', target: { semantic: { label: 'Email' }, confidence: 'high' }, value: '${LOGIN_EMAIL}' },
      { id: 'step-3', type: 'click', target: { semantic: { text: 'Submit' }, confidence: 'high' }, mutating: true },
    ],
    evidence: {},
  });

  assert.match(script, /siteflow --json browser open 'https:\/\/example.com\/'/);
  assert.match(script, /--value '\$\{LOGIN_EMAIL\}'/);
  assert.match(script, /MUTATING step-3/);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: FAIL because `workflow-export.js` does not exist.

- [ ] **Step 3: Implement CLI export**

Create `src/runtime/workflow-export.ts`:

```ts
import type { RecordedTarget, SiteflowWorkflow, WorkflowStep } from './workflow-types.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function targetArgs(target: RecordedTarget | undefined): string {
  if (!target) return '';
  if (target.semantic?.aria) return ` --aria ${shellQuote(target.semantic.aria)}`;
  if (target.semantic?.label) return ` --aria ${shellQuote(target.semantic.label)}`;
  if (target.semantic?.text) return ` --text ${shellQuote(target.semantic.text)}`;
  if (target.structural?.selector) return ` --selector ${shellQuote(target.structural.selector)}`;
  if (target.geometry) return ` --xy ${shellQuote(`${Math.round(target.geometry.x)},${Math.round(target.geometry.y)}`)}`;
  return '';
}

function commandForStep(step: WorkflowStep): string[] {
  if (step.type === 'open') return [`siteflow --json browser open ${shellQuote(step.url)}`];
  if (step.type === 'click') return [`siteflow --json browser click${targetArgs(step.target)}`];
  if (step.type === 'type') return [`siteflow --json browser type${targetArgs(step.target)} --value ${shellQuote(step.value)}`];
  if (step.type === 'select') return [`siteflow --json browser select${targetArgs(step.target)} --option ${shellQuote(step.option)}`];
  if (step.type === 'scroll') return [`siteflow --json eval ${shellQuote(`window.scrollBy(${step.deltaX}, ${step.deltaY})`)}`];
  if (step.type === 'wait') return [`siteflow --json eval ${shellQuote(`new Promise(resolve => setTimeout(resolve, ${step.ms ?? 1000}))`)}`];
  if (step.type === 'screenshot') return [`siteflow --json browser screenshot${step.fullPage === false ? '' : ' --full-page'}`];
  return [];
}

export function exportWorkflowCli(workflow: SiteflowWorkflow): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# Generated from Siteflow workflow created at ${workflow.createdAt}`,
  ];
  for (const step of workflow.steps) {
    lines.push('');
    lines.push(`# ${step.mutating ? 'MUTATING ' : ''}${step.id}: ${step.type}${step.label ? ` - ${step.label}` : ''}`);
    lines.push(...commandForStep(step));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/runtime/workflow-export.ts test/unit/workflow-recorder.test.mjs
git commit -m "feat: export workflow cli scripts"
```

## Task 3: Add Target Matcher

**Files:**
- Create: `src/runtime/target-matcher.ts`
- Test: `test/unit/workflow-replay.test.mjs`

- [ ] **Step 1: Write target matcher tests**

Create `test/unit/workflow-replay.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('target matcher prefers semantic targets before structural targets', async () => {
  const { browserTargetFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = browserTargetFromRecordedTarget({
    semantic: { aria: 'Search' },
    structural: { selector: '#search' },
    confidence: 'high',
  });
  assert.deepEqual(target, { aria: 'Search', exact: true });
});

test('target matcher falls back to selector', async () => {
  const { browserTargetFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = browserTargetFromRecordedTarget({
    structural: { selector: 'button.submit' },
    confidence: 'medium',
  });
  assert.deepEqual(target, { selector: 'button.submit', exact: true });
});

test('target matcher returns coordinates as the last fallback', async () => {
  const { clickOptionsFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = clickOptionsFromRecordedTarget({
    geometry: { x: 10.4, y: 20.6 },
    confidence: 'low',
  });
  assert.deepEqual(target, { x: 10, y: 21 });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-replay.test.mjs
```

Expected: FAIL because `target-matcher.js` does not exist.

- [ ] **Step 3: Implement target matcher**

Create `src/runtime/target-matcher.ts`:

```ts
import type { BrowserClickOptions, BrowserElementTarget } from '../shared/types.js';
import type { RecordedTarget } from './workflow-types.js';

export function browserTargetFromRecordedTarget(target: RecordedTarget): BrowserElementTarget {
  if (target.semantic?.aria) return { aria: target.semantic.aria, exact: true };
  if (target.semantic?.label) return { aria: target.semantic.label, exact: true };
  if (target.semantic?.placeholder) return { aria: target.semantic.placeholder, exact: true };
  if (target.semantic?.text) return { text: target.semantic.text, exact: true };
  if (target.structural?.selector) return { selector: target.structural.selector, exact: true };
  return { exact: true };
}

export function clickOptionsFromRecordedTarget(target: RecordedTarget): BrowserClickOptions {
  const base = browserTargetFromRecordedTarget(target);
  if ((base.selector || base.text || base.aria) || !target.geometry) return base;
  return {
    x: Math.round(target.geometry.x),
    y: Math.round(target.geometry.y),
  };
}

export function matchedByForRecordedTarget(target: RecordedTarget): string {
  if (target.semantic?.aria) return 'semantic.aria';
  if (target.semantic?.label) return 'semantic.label';
  if (target.semantic?.placeholder) return 'semantic.placeholder';
  if (target.semantic?.text) return 'semantic.text';
  if (target.structural?.selector) return 'structural.selector';
  if (target.geometry) return 'geometry';
  return 'none';
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-replay.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/runtime/target-matcher.ts test/unit/workflow-replay.test.mjs
git commit -m "feat: add workflow target matcher"
```

## Task 4: Add Recorder Runtime

**Files:**
- Create: `src/runtime/recorder-runtime.ts`
- Modify: `test/unit/workflow-recorder.test.mjs`

- [ ] **Step 1: Add normalization tests**

Append to `test/unit/workflow-recorder.test.mjs`:

```js
test('normalizeRecordedEvents merges repeated input events', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.com/',
    events: [
      {
        ts: '2026-06-05T00:00:00.000Z',
        type: 'input',
        url: 'https://example.com/',
        title: 'Example',
        value: 'a',
        target: { semantic: { label: 'Name' }, confidence: 'high' },
      },
      {
        ts: '2026-06-05T00:00:01.000Z',
        type: 'input',
        url: 'https://example.com/',
        title: 'Example',
        value: 'alice',
        target: { semantic: { label: 'Name' }, confidence: 'high' },
      },
    ],
  });

  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'open');
  assert.equal(steps[1].type, 'type');
  assert.equal(steps[1].value, 'alice');
});

test('normalizeRecordedEvents marks submit clicks as mutating', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.com/',
    events: [{
      ts: '2026-06-05T00:00:00.000Z',
      type: 'click',
      url: 'https://example.com/',
      title: 'Example',
      target: { semantic: { text: 'Submit' }, confidence: 'high' },
    }],
  });

  assert.equal(steps[1].type, 'click');
  assert.equal(steps[1].mutating, true);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: FAIL because `recorder-runtime.js` does not exist.

- [ ] **Step 3: Implement normalization and injected script source**

Create `src/runtime/recorder-runtime.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from 'playwright';
import type { RecordedEvent, RecorderStartOptions, RecorderStatus, RecorderStopResult, SiteflowWorkflow, WorkflowStep } from './workflow-types.js';

export interface RecorderSession {
  id: string;
  pageId: number;
  startedAt: string;
  out: string;
  startUrl: string;
  events: RecordedEvent[];
}

export function recorderInjectionSource(): string {
  return `(() => {
    if (window.__siteflowRecorderInstalled) return;
    window.__siteflowRecorderInstalled = true;
    const targetFor = el => {
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const text = el && String(el.innerText || el.textContent || '').trim().slice(0, 120);
      const aria = el && el.getAttribute && el.getAttribute('aria-label');
      const label = el && el.labels && el.labels[0] && el.labels[0].innerText;
      const placeholder = el && el.getAttribute && el.getAttribute('placeholder');
      const id = el && el.id;
      return {
        semantic: { aria: aria || undefined, label: label || undefined, text: text || undefined, placeholder: placeholder || undefined },
        structural: { selector: id ? '#' + CSS.escape(id) : undefined },
        geometry: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height } : undefined,
        confidence: aria || label || text ? 'high' : id ? 'medium' : 'low'
      };
    };
    const send = event => window.__siteflowRecordEvent && window.__siteflowRecordEvent(event);
    const base = target => ({ ts: new Date().toISOString(), url: location.href, title: document.title, target: targetFor(target) });
    document.addEventListener('click', event => send({ ...base(event.target), type: 'click' }), true);
    document.addEventListener('input', event => send({ ...base(event.target), type: 'input', value: event.target && 'value' in event.target ? event.target.value : undefined }), true);
    document.addEventListener('change', event => send({ ...base(event.target), type: 'change', value: event.target && 'value' in event.target ? event.target.value : undefined }), true);
    document.addEventListener('keydown', event => { if (['Enter', 'Escape', 'Tab'].includes(event.key)) send({ ...base(event.target), type: 'keydown', key: event.key }); }, true);
    let lastX = scrollX, lastY = scrollY, timer;
    document.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const dx = scrollX - lastX, dy = scrollY - lastY;
        lastX = scrollX; lastY = scrollY;
        if (dx || dy) send({ ts: new Date().toISOString(), type: 'scroll', url: location.href, title: document.title, deltaX: dx, deltaY: dy });
      }, 250);
    }, true);
  })();`;
}

function sameTarget(a: RecordedEvent, b: RecordedEvent): boolean {
  return JSON.stringify(a.target || {}) === JSON.stringify(b.target || {});
}

function isMutatingClick(event: RecordedEvent): boolean {
  const text = `${event.target?.semantic?.text || ''} ${event.target?.semantic?.aria || ''} ${event.target?.semantic?.label || ''}`.toLowerCase();
  return /submit|send|publish|save|post|upload|提交|发送|发布|保存/.test(text);
}

export function normalizeRecordedEvents(input: { startUrl: string; events: RecordedEvent[] }): WorkflowStep[] {
  const steps: WorkflowStep[] = [{ id: 'step-1', type: 'open', url: input.startUrl }];
  let lastInputIndex = -1;
  for (const event of input.events) {
    if (event.type === 'input' || event.type === 'change') {
      if (lastInputIndex >= 0 && sameTarget(event, input.events[lastInputIndex])) {
        const lastStep = steps[steps.length - 1];
        if (lastStep.type === 'type') lastStep.value = event.value || '';
      } else if (event.target) {
        steps.push({ id: `step-${steps.length + 1}`, type: 'type', target: event.target, value: event.value || '', clear: true });
      }
      lastInputIndex = input.events.indexOf(event);
      continue;
    }
    lastInputIndex = -1;
    if (event.type === 'click' && event.target) {
      steps.push({ id: `step-${steps.length + 1}`, type: 'click', target: event.target, mutating: isMutatingClick(event) || undefined });
    } else if (event.type === 'scroll') {
      steps.push({ id: `step-${steps.length + 1}`, type: 'scroll', deltaX: event.deltaX || 0, deltaY: event.deltaY || 0 });
    } else if (event.type === 'keydown' && event.key === 'Enter' && event.target) {
      steps.push({ id: `step-${steps.length + 1}`, type: 'type', target: event.target, value: '', pressEnter: true, clear: false });
    }
  }
  return steps;
}

export async function startRecorderSession(page: Page, pageId: number, options: RecorderStartOptions): Promise<RecorderSession> {
  const session: RecorderSession = {
    id: `rec-${Date.now()}`,
    pageId,
    startedAt: new Date().toISOString(),
    out: options.out,
    startUrl: page.url(),
    events: [],
  };
  await page.exposeBinding('__siteflowRecordEvent', (_source, event: RecordedEvent) => {
    session.events.push(event);
  });
  await page.addInitScript(recorderInjectionSource());
  await page.evaluate(recorderInjectionSource());
  return session;
}

export function recorderStatus(session: RecorderSession | null): RecorderStatus {
  return session ? {
    recording: true,
    sessionId: session.id,
    pageId: session.pageId,
    startedAt: session.startedAt,
    out: session.out,
    events: session.events.length,
  } : { recording: false, events: 0 };
}

export async function stopRecorderSession(session: RecorderSession): Promise<RecorderStopResult> {
  const workflow: SiteflowWorkflow = {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: new Date().toISOString(),
    startUrl: session.startUrl,
    variables: [],
    steps: normalizeRecordedEvents({ startUrl: session.startUrl, events: session.events }),
    evidence: { events: session.events.length, pageId: session.pageId },
  };
  await fs.mkdir(path.dirname(session.out), { recursive: true });
  await fs.writeFile(session.out, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  return {
    workflow,
    out: session.out,
    steps: workflow.steps.length,
    variables: workflow.variables.length,
    mutatingSteps: workflow.steps.filter(step => step.mutating).length,
    unsupportedEvents: 0,
  };
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/runtime/recorder-runtime.ts test/unit/workflow-recorder.test.mjs
git commit -m "feat: normalize recorded workflow events"
```

## Task 5: Add Replay Runtime

**Files:**
- Create: `src/runtime/replay-runtime.ts`
- Modify: `test/unit/workflow-replay.test.mjs`

- [ ] **Step 1: Add replay dry-run tests**

Append to `test/unit/workflow-replay.test.mjs`:

```js
test('runWorkflow dry-run reports steps without executing actions', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target: { semantic: { text: 'Continue' }, confidence: 'high' } },
    ],
    evidence: {},
  }, { dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].ok, true);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-replay.test.mjs
```

Expected: FAIL because `replay-runtime.js` does not exist.

- [ ] **Step 3: Implement replay runtime**

Create `src/runtime/replay-runtime.ts`:

```ts
import type { BrowserActionResult, BrowserClickOptions, BrowserSelectOptions, BrowserTypeOptions, PageInfo } from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';
import { clickOptionsFromRecordedTarget, browserTargetFromRecordedTarget, matchedByForRecordedTarget } from './target-matcher.js';
import type { ReplayRunOptions, ReplayRunResult, ReplayStepReceipt, SiteflowWorkflow, WorkflowStep } from './workflow-types.js';

export interface ReplayDriver {
  open(url: string): Promise<PageInfo>;
  click(options: BrowserClickOptions): Promise<BrowserActionResult>;
  type(options: BrowserTypeOptions): Promise<BrowserActionResult>;
  select(options: BrowserSelectOptions): Promise<BrowserActionResult>;
  screenshot(fullPage: boolean): Promise<{ bytes: number }>;
}

async function runStep(driver: ReplayDriver, step: WorkflowStep, options: ReplayRunOptions): Promise<ReplayStepReceipt> {
  if (options.dryRun) return { stepId: step.id, type: step.type, ok: true, targetMatchedBy: step.target ? matchedByForRecordedTarget(step.target) : undefined };
  if (step.mutating && options.stopBeforeMutating) {
    return { stepId: step.id, type: step.type, ok: false, error: { code: 'STOPPED_BEFORE_MUTATING', message: `Stopped before mutating step ${step.id}.` } };
  }
  if (step.type === 'open') {
    const page = await driver.open(step.url);
    return { stepId: step.id, type: step.type, ok: true, urlAfter: page.url };
  }
  if (step.type === 'click') {
    await driver.click({ ...clickOptionsFromRecordedTarget(step.target), button: step.button });
    return { stepId: step.id, type: step.type, ok: true, targetMatchedBy: matchedByForRecordedTarget(step.target) };
  }
  if (step.type === 'type') {
    await driver.type({ ...browserTargetFromRecordedTarget(step.target), value: step.value, clear: step.clear, pressEnter: step.pressEnter });
    return { stepId: step.id, type: step.type, ok: true, targetMatchedBy: matchedByForRecordedTarget(step.target) };
  }
  if (step.type === 'select') {
    const target = browserTargetFromRecordedTarget(step.target);
    await driver.select({ selector: target.selector, comboboxText: target.text || target.aria, option: step.option, exact: target.exact });
    return { stepId: step.id, type: step.type, ok: true, targetMatchedBy: matchedByForRecordedTarget(step.target) };
  }
  if (step.type === 'scroll') {
    return { stepId: step.id, type: step.type, ok: true };
  }
  if (step.type === 'wait') {
    await new Promise(resolve => setTimeout(resolve, step.ms ?? 1000));
    return { stepId: step.id, type: step.type, ok: true };
  }
  if (step.type === 'screenshot') {
    await driver.screenshot(step.fullPage !== false);
    return { stepId: step.id, type: step.type, ok: true };
  }
  throw new SiteflowError('UNSUPPORTED_WORKFLOW_STEP', `Unsupported workflow step: ${(step as { type: string }).type}`);
}

export async function runWorkflow(driver: ReplayDriver, workflow: SiteflowWorkflow, options: ReplayRunOptions): Promise<ReplayRunResult> {
  const steps: ReplayStepReceipt[] = [];
  for (const step of workflow.steps) {
    try {
      const receipt = await runStep(driver, step, options);
      steps.push(receipt);
      if (!receipt.ok) return { ok: false, workflow: { version: workflow.version, steps: workflow.steps.length, startUrl: workflow.startUrl }, steps };
    } catch (error) {
      steps.push({
        stepId: step.id,
        type: step.type,
        ok: false,
        error: {
          code: error instanceof SiteflowError ? error.code : 'REPLAY_STEP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return { ok: false, workflow: { version: workflow.version, steps: workflow.steps.length, startUrl: workflow.startUrl }, steps };
    }
  }
  return { ok: true, workflow: { version: workflow.version, steps: workflow.steps.length, startUrl: workflow.startUrl }, steps };
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-replay.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/runtime/replay-runtime.ts test/unit/workflow-replay.test.mjs
git commit -m "feat: run workflow replay steps"
```

## Task 6: Wire BrowserRuntime, Daemon, Client, and CLI

**Files:**
- Modify: `src/runtime/browser-runtime.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/client.ts`
- Modify: `src/cli/main.ts`
- Test: `test/unit/workflow-recorder.test.mjs`

- [ ] **Step 1: Add CLI shape smoke tests**

Append to `test/unit/workflow-recorder.test.mjs`:

```js
test('workflow command modules are importable after CLI wiring', async () => {
  const client = await import('../../dist/daemon/client.js');
  assert.equal(typeof client.startRecorder, 'function');
  assert.equal(typeof client.stopRecorder, 'function');
  assert.equal(typeof client.runReplayWorkflow, 'function');
  assert.equal(typeof client.exportReplayCli, 'function');
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs
```

Expected: FAIL because daemon client functions do not exist.

- [ ] **Step 3: Modify BrowserRuntime**

In `src/runtime/browser-runtime.ts`, add imports:

```ts
import { exportWorkflowCli } from './workflow-export.js';
import { startRecorderSession, stopRecorderSession, recorderStatus, type RecorderSession } from './recorder-runtime.js';
import { runWorkflow, type ReplayDriver } from './replay-runtime.js';
import { validateWorkflow } from './workflow-validation.js';
import type { RecorderStartOptions, RecorderStopResult, RecorderStatus, ReplayRunOptions, ReplayRunResult, SiteflowWorkflow } from './workflow-types.js';
```

Add a private field inside `BrowserRuntime`:

```ts
private recorderSession: RecorderSession | null = null;
```

Add methods inside `BrowserRuntime`:

```ts
async startRecorder(options: RecorderStartOptions): Promise<RecorderStatus> {
  const pageInfo = options.url ? await this.open(options.url) : await this.toPageInfo(...Object.values(this.getPage(options.pageId)) as never);
  const { pageId, page } = this.getPage(pageInfo.id);
  this.recorderSession = await startRecorderSession(page, pageId, { ...options, pageId });
  return recorderStatus(this.recorderSession);
}

recorderStatus(): RecorderStatus {
  return recorderStatus(this.recorderSession);
}

async stopRecorder(): Promise<RecorderStopResult> {
  if (!this.recorderSession) throw new SiteflowError('RECORDER_NOT_RUNNING', 'No recorder session is running.');
  const result = await stopRecorderSession(this.recorderSession);
  this.recorderSession = null;
  return result;
}

async runReplayWorkflow(workflowValue: unknown, options: ReplayRunOptions): Promise<ReplayRunResult> {
  const workflow = validateWorkflow(workflowValue);
  const driver: ReplayDriver = {
    open: url => this.open(url),
    click: opts => this.click(opts),
    type: opts => this.type(opts),
    select: opts => this.select(opts),
    screenshot: fullPage => this.screenshot(fullPage),
  };
  return runWorkflow(driver, workflow, options);
}

exportReplayCli(workflowValue: unknown): { script: string } {
  const workflow = validateWorkflow(workflowValue);
  return { script: exportWorkflowCli(workflow) };
}
```

If the `startRecorder` spread around `getPage` is awkward in the current file, use the explicit existing helper shape:

```ts
const target = options.url ? await this.open(options.url) : this.getPage(options.pageId);
const pageId = 'id' in target ? target.id : target.pageId;
const page = 'page' in target ? target.page : this.getPage(pageId).page;
```

- [ ] **Step 4: Add daemon routes**

In `src/daemon/server.ts`, add routes before the fallback 404 branch:

```ts
if (method === 'POST' && url.pathname === '/recorder/start') {
  const body = await readJson(req) as { url?: string; pageId?: number; out: string };
  const result = await runtime.startRecorder(body);
  return { status: 200, body: { ok: true, data: result } };
}

if (method === 'GET' && url.pathname === '/recorder/status') {
  return { status: 200, body: { ok: true, data: runtime.recorderStatus() } };
}

if (method === 'POST' && url.pathname === '/recorder/stop') {
  const result = await runtime.stopRecorder();
  return { status: 200, body: { ok: true, data: result } };
}

if (method === 'POST' && url.pathname === '/replay/run') {
  const body = await readJson(req) as { workflow: unknown; options?: ReplayRunOptions };
  const result = await runtime.runReplayWorkflow(body.workflow, body.options || {});
  return { status: 200, body: { ok: true, data: result } };
}

if (method === 'POST' && url.pathname === '/replay/export-cli') {
  const body = await readJson(req) as { workflow: unknown };
  const result = runtime.exportReplayCli(body.workflow);
  return { status: 200, body: { ok: true, data: result } };
}
```

Also add the needed type import:

```ts
import type { ReplayRunOptions } from '../runtime/workflow-types.js';
```

- [ ] **Step 5: Add daemon client wrappers**

In `src/daemon/client.ts`, import types:

```ts
import type { RecorderStartOptions, RecorderStatus, RecorderStopResult, ReplayRunOptions, ReplayRunResult } from '../runtime/workflow-types.js';
```

Add exported functions:

```ts
export async function startRecorder(profile: string, options: RecorderStartOptions): Promise<RecorderStatus> {
  return call(profile, 'POST', '/recorder/start', options);
}

export async function getRecorderStatus(profile: string): Promise<RecorderStatus> {
  return call(profile, 'GET', '/recorder/status');
}

export async function stopRecorder(profile: string): Promise<RecorderStopResult> {
  return call(profile, 'POST', '/recorder/stop');
}

export async function runReplayWorkflow(profile: string, workflow: unknown, options: ReplayRunOptions): Promise<ReplayRunResult> {
  return call(profile, 'POST', '/replay/run', { workflow, options });
}

export async function exportReplayCli(profile: string, workflow: unknown): Promise<{ script: string }> {
  return call(profile, 'POST', '/replay/export-cli', { workflow });
}
```

- [ ] **Step 6: Add CLI commands**

In `src/cli/main.ts`, import the new client functions:

```ts
  startRecorder,
  getRecorderStatus,
  stopRecorder,
  runReplayWorkflow,
  exportReplayCli,
```

Add helper functions near existing helpers:

```ts
async function readJsonFile(pathname: string): Promise<unknown> {
  const fs = await import('node:fs/promises');
  return JSON.parse(await fs.readFile(pathname, 'utf8')) as unknown;
}

async function writeTextFile(pathname: string, content: string): Promise<{ out: string; bytes: number }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, content, 'utf8');
  return { out: pathname, bytes: Buffer.byteLength(content) };
}
```

Add commands before site command registration:

```ts
const recorder = program.command('recorder').description('Record browser actions into a replayable workflow');

recorder
  .command('start')
  .description('Start recording a workflow')
  .requiredOption('--out <path>', 'workflow JSON output path')
  .option('--url <url>', 'URL to open before recording')
  .option('--page-id <id>', 'existing page id to record')
  .action(async function () {
    await run(this, opts => {
      const local = this.opts<{ out: string; url?: string; pageId?: string }>();
      const pageId = local.pageId ? Number.parseInt(local.pageId, 10) : undefined;
      return startRecorder(opts.profile, { out: local.out, url: local.url, pageId: Number.isFinite(pageId) ? pageId : undefined });
    });
  });

recorder
  .command('status')
  .description('Show current recorder status')
  .action(async function () {
    await run(this, opts => getRecorderStatus(opts.profile));
  });

recorder
  .command('stop')
  .description('Stop recording and write the workflow')
  .action(async function () {
    await run(this, opts => stopRecorder(opts.profile));
  });

const replay = program.command('replay').description('Run or export Siteflow workflows');

replay
  .command('run')
  .description('Run a workflow JSON file')
  .argument('<workflow>', 'workflow JSON file')
  .option('--dry-run', 'validate steps without executing actions')
  .option('--stop-before-mutating', 'stop before a mutating step')
  .action(async function (workflowPath: string) {
    await run(this, async opts => {
      const local = this.opts<{ dryRun?: boolean; stopBeforeMutating?: boolean }>();
      const workflow = await readJsonFile(workflowPath);
      return runReplayWorkflow(opts.profile, workflow, {
        dryRun: Boolean(local.dryRun),
        stopBeforeMutating: Boolean(local.stopBeforeMutating),
      });
    });
  });

replay
  .command('export-cli')
  .description('Export a workflow JSON file as a readable shell script')
  .argument('<workflow>', 'workflow JSON file')
  .requiredOption('--out <path>', 'shell script output path')
  .action(async function (workflowPath: string) {
    await run(this, async opts => {
      const local = this.opts<{ out: string }>();
      const workflow = await readJsonFile(workflowPath);
      const result = await exportReplayCli(opts.profile, workflow);
      return writeTextFile(local.out, result.script);
    });
  });
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder.test.mjs test/unit/workflow-replay.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/runtime/browser-runtime.ts src/daemon/server.ts src/daemon/client.ts src/cli/main.ts test/unit/workflow-recorder.test.mjs
git commit -m "feat: wire workflow recorder commands"
```

## Task 7: Add Fixture E2E Test

**Files:**
- Create: `test/fixtures/basic/recorder.html`
- Create: `test/unit/workflow-recorder-e2e.test.mjs`

- [ ] **Step 1: Create recorder fixture page**

Create `test/fixtures/basic/recorder.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Recorder Fixture</title>
  </head>
  <body>
    <h1>Recorder Fixture</h1>
    <label>Name <input id="name" name="name" autocomplete="name"></label>
    <label>Mode
      <select id="mode" aria-label="Mode">
        <option>Basic</option>
        <option>Advanced</option>
      </select>
    </label>
    <button id="continue">Continue</button>
    <p id="status">Idle</p>
    <script>
      document.querySelector('#continue').addEventListener('click', () => {
        document.querySelector('#status').textContent = 'Continued ' + document.querySelector('#name').value + ' in ' + document.querySelector('#mode').value;
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Write E2E test**

Create `test/unit/workflow-recorder-e2e.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const cli = join(root, 'dist/cli/main.js');

function run(args, env) {
  const result = spawnSync(process.execPath, [cli, '--profile', 'recorder-e2e', '--json', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('records, replays, and exports a fixture workflow', async () => {
  const home = mkdtempSync(join(tmpdir(), 'siteflow-recorder-e2e-'));
  const env = { ...process.env, SITEFLOW_HOME: home };
  const out = join(home, 'flow.json');
  const scriptOut = join(home, 'flow.sh');
  const fixture = 'file://' + join(root, 'test/fixtures/basic/recorder.html');

  try {
    run(['daemon', 'start'], env);
    const started = run(['recorder', 'start', '--url', fixture, '--out', out], env);
    assert.equal(started.ok, true);

    run(['browser', 'type', '--selector', '#name', '--value', 'Alice'], env);
    run(['browser', 'select', '--selector', '#mode', '--option', 'Advanced'], env);
    run(['browser', 'click', '--selector', '#continue'], env);

    const stopped = run(['recorder', 'stop'], env);
    assert.equal(stopped.ok, true);
    assert.ok(stopped.data.steps >= 4);

    const workflow = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(workflow.kind, 'siteflow.workflow');
    assert.ok(workflow.steps.some(step => step.type === 'type'));
    assert.ok(workflow.steps.some(step => step.type === 'click'));

    const replay = run(['replay', 'run', out], env);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.ok, true);

    const exported = run(['replay', 'export-cli', out, '--out', scriptOut], env);
    assert.equal(exported.ok, true);
    assert.ok(readFileSync(scriptOut, 'utf8').includes('siteflow --json browser'));
  } finally {
    try { run(['daemon', 'stop'], env); } catch {}
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run E2E test and verify it passes**

Run:

```bash
npm run build && node --test test/unit/workflow-recorder-e2e.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

```bash
git add test/fixtures/basic/recorder.html test/unit/workflow-recorder-e2e.test.mjs
git commit -m "test: cover workflow recorder replay fixture"
```

## Task 8: Final Verification and Documentation Link

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README command examples**

Add this short section near the existing browser evidence examples in `README.md`:

```md
### Workflow Recorder

Record a browser workflow once, replay it, or export it as readable CLI commands:

```bash
siteflow --json recorder start --url https://example.com --out flow.json
# operate the browser manually or through Siteflow browser commands
siteflow --json recorder stop
siteflow --json replay run flow.json
siteflow --json replay export-cli flow.json --out flow.sh
```

Workflow JSON stores replayable intent and lightweight evidence. It does not store cookies, full DOM dumps, or raw network bodies.
```

- [ ] **Step 2: Run focused and required verification**

Run:

```bash
npm run typecheck
npm run test:unit
```

Expected: both PASS. `test:unit` rebuilds and runs all unit tests.

- [ ] **Step 3: Commit Task 8**

```bash
git add README.md
git commit -m "docs: document workflow recorder commands"
```

## Self-Review Checklist

- Spec coverage: This plan covers Phase 1 from the approved spec: recorder start/stop, core step types, workflow JSON, replay run, CLI export, and fixture E2E. Phase 2 mutating variables/upload and Phase 3 extraction are intentionally excluded from this plan because the approved spec defines them as later phases.
- Placeholder scan: The plan contains no incomplete sections or placeholder implementation instructions.
- Type consistency: Types introduced in Task 1 are used by later runtime, client, daemon, and CLI tasks with the same names.
- Verification: The final task runs `npm run typecheck` and `npm run test:unit`, matching repository requirements for TypeScript source, runtime, daemon, CLI, and shared behavior changes.
