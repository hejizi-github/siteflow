import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { BrowserRuntime } from '../../dist/runtime/browser-runtime.js';


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

test('target matcher preserves nth on semantic text targets', async () => {
  const { browserTargetFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = browserTargetFromRecordedTarget({
    semantic: { text: 'Duplicate' },
    structural: { nth: 2 },
    confidence: 'high',
  });
  assert.deepEqual(target, { text: 'Duplicate', exact: true, nth: 2 });
});

test('target matcher preserves nth on structural selector targets', async () => {
  const { browserTargetFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = browserTargetFromRecordedTarget({
    structural: { selector: 'button.duplicate', nth: 1 },
    confidence: 'medium',
  });
  assert.deepEqual(target, { selector: 'button.duplicate', exact: true, nth: 1 });
});

test('target matcher returns coordinates as the last fallback', async () => {
  const { clickOptionsFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = clickOptionsFromRecordedTarget({
    geometry: { x: 10.4, y: 20.6 },
    confidence: 'low',
  });
  assert.deepEqual(target, { x: 10, y: 21 });
});

test('runWorkflow dry-run reports steps without executing actions', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => { throw new Error('open should not run'); },
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target: { semantic: { text: 'Continue' }, confidence: 'high' } },
      { id: 'step-3', type: 'scroll', deltaX: 12, deltaY: 34 },
    ],
    evidence: {},
  }, { dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[2].ok, true);
});

test('runWorkflow dry-run ignores stopBeforeMutating and reports all steps ok', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => { throw new Error('open should not run'); },
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => { throw new Error('screenshot should not run'); },
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', mutating: true, target: { semantic: { text: 'Delete' }, confidence: 'high' } },
      { id: 'step-3', type: 'screenshot' },
    ],
    evidence: {},
  }, { dryRun: true, stopBeforeMutating: true });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((step) => step.ok), [true, true, true]);
});

test('runWorkflow dry-run validates conditional wait driver support', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const driver = {
    open: async () => { throw new Error('open should not run'); },
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => { throw new Error('screenshot should not run'); },
    scroll: async () => { throw new Error('scroll should not run'); },
  };

  const plainWaitResult = await runWorkflow(driver, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'plain-wait', type: 'wait', ms: 250 },
    ],
    evidence: {},
  }, { dryRun: true });

  const conditionalWaitResult = await runWorkflow(driver, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'conditional-wait', type: 'wait', selector: '#ready' },
      { id: 'after-wait', type: 'screenshot' },
    ],
    evidence: {},
  }, { dryRun: true });

  assert.equal(plainWaitResult.ok, true);
  assert.deepEqual(plainWaitResult.steps, [{ stepId: 'plain-wait', type: 'wait', ok: true }]);
  assert.equal(conditionalWaitResult.ok, false);
  assert.equal(conditionalWaitResult.steps.length, 1);
  assert.equal(conditionalWaitResult.steps[0].error.code, 'REPLAY_WAIT_UNSUPPORTED');
});

test('runWorkflow executes scroll steps with recorded deltas', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const calls = [];
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async (deltaX, deltaY) => {
      calls.push([deltaX, deltaY]);
    },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'scroll', deltaX: -12, deltaY: 240 },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [[-12, 240]]);
  assert.deepEqual(result.steps, [{ stepId: 'step-1', type: 'scroll', ok: true }]);
});

test('runWorkflow open receipt includes the driver page urlAfter', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/after', title: 'After redirect', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/start' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.equal(result.steps[0].urlAfter, 'https://example.com/after');
});

test('runWorkflow maps placeholder select targets through target matcher', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const calls = [];
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async (options) => {
      calls.push(options);
      return { action: 'select', target: 'Country', url: 'https://example.com/', page: { id: 1, url: 'https://example.com/', title: 'Example', selected: true } };
    },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'select', target: { semantic: { placeholder: 'Choose country' }, structural: { selector: 'select[name="country"]' }, confidence: 'high' }, option: 'Canada' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ selector: '[placeholder="Choose country"]', option: 'Canada', exact: true }]);
  assert.equal(result.steps[0].targetMatchedBy, 'semantic.placeholder');
});

test('runWorkflow executes replay steps with recorded target options', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const calls = [];
  const result = await runWorkflow({
    open: async (url) => {
      calls.push(['open', url]);
      return { id: 1, url, title: 'Opened', selected: true };
    },
    click: async (options) => {
      calls.push(['click', options]);
      return { action: 'click', target: 'Continue', url: 'https://example.com/next' };
    },
    type: async (options) => {
      calls.push(['type', options]);
      return { action: 'type', target: 'Email', url: 'https://example.com/next' };
    },
    select: async (options) => {
      calls.push(['select', options]);
      return { action: 'select', target: 'Plan', url: 'https://example.com/next' };
    },
    screenshot: async (fullPage) => {
      calls.push(['screenshot', fullPage]);
      return { bytes: 42 };
    },
    scroll: async (deltaX, deltaY) => {
      calls.push(['scroll', deltaX, deltaY]);
    },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target: { semantic: { text: 'Continue' }, confidence: 'high' }, button: 'right' },
      { id: 'step-3', type: 'type', target: { semantic: { aria: 'Email' }, confidence: 'high' }, value: 'a@example.com', clear: true, pressEnter: true },
      { id: 'step-4', type: 'select', target: { semantic: { aria: 'Plan' }, confidence: 'high' }, option: 'Pro' },
      { id: 'step-5', type: 'screenshot', fullPage: false },
      { id: 'step-6', type: 'screenshot' },
      { id: 'step-7', type: 'scroll', deltaX: 0, deltaY: 500 },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['open', 'https://example.com/'],
    ['click', { text: 'Continue', exact: true, button: 'right' }],
    ['type', { aria: 'Email', exact: true, value: 'a@example.com', clear: true, pressEnter: true }],
    ['select', { comboboxText: 'Plan', option: 'Pro', exact: true }],
    ['screenshot', false],
    ['screenshot', true],
    ['scroll', 0, 500],
  ]);
  assert.equal(result.steps[1].targetMatchedBy, 'semantic.text');
});

test('runWorkflow stops before mutating step when requested', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const calls = [];
  const result = await runWorkflow({
    open: async (url) => {
      calls.push(['open', url]);
      return { id: 1, url, title: 'Opened', selected: true };
    },
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', mutating: true, target: { semantic: { text: 'Delete' }, confidence: 'high' } },
      { id: 'step-3', type: 'screenshot' },
    ],
    evidence: {},
  }, { stopBeforeMutating: true });

  assert.equal(result.ok, false);
  assert.deepEqual(calls, [['open', 'https://example.com/']]);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].ok, false);
  assert.equal(result.steps[1].error.code, 'STOPPED_BEFORE_MUTATING');
});

test('runWorkflow records replay failures without throwing', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('No matching button'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'click', target: { semantic: { text: 'Missing' }, confidence: 'high' } },
      { id: 'step-2', type: 'screenshot' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].error.code, 'REPLAY_STEP_FAILED');
});

test('runWorkflow preserves SiteflowError codes in replay receipts', async () => {
  const { SiteflowError } = await import('../../dist/shared/errors.js');
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new SiteflowError('TARGET_NOT_FOUND', 'No matching button'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'click', target: { semantic: { text: 'Missing' }, confidence: 'high' } },
      { id: 'step-2', type: 'screenshot' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].error.code, 'TARGET_NOT_FOUND');
});

test('runWorkflow conditional wait calls driver.waitFor with recorded condition', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const calls = [];
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
    waitFor: async (condition) => {
      calls.push(condition);
    },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'wait', ms: 2500, selector: '#ready', text: 'Ready', urlContains: '/done' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ ms: 2500, selector: '#ready', text: 'Ready', urlContains: '/done' }]);
  assert.deepEqual(result.steps, [{ stepId: 'step-1', type: 'wait', ok: true }]);
});

test('runWorkflow conditional wait failure preserves SiteflowError code', async () => {
  const { SiteflowError } = await import('../../dist/shared/errors.js');
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
    waitFor: async () => {
      throw new SiteflowError('WAIT_CONDITION_TIMEOUT', 'Timed out waiting for #ready');
    },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'wait', selector: '#ready' },
      { id: 'step-2', type: 'screenshot' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].error.code, 'WAIT_CONDITION_TIMEOUT');
});

test('runWorkflow wait defaults to one second', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const startedAt = Date.now();
  const result = await runWorkflow({
    open: async () => ({ id: 1, url: 'https://example.com/', title: 'Example', selected: true }),
    click: async () => { throw new Error('click should not run'); },
    type: async () => { throw new Error('type should not run'); },
    select: async () => { throw new Error('select should not run'); },
    screenshot: async () => ({ bytes: 0 }),
    scroll: async () => { throw new Error('scroll should not run'); },
  }, {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [
      { id: 'step-1', type: 'wait' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.ok(Date.now() - startedAt >= 900);
});

function workflowWithFirstStep(step) {
  return {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-06T00:00:00.000Z',
    startUrl: 'https://example.test/start',
    variables: [],
    steps: [step],
  };
}

test('BrowserRuntime replay opens startUrl before a non-open first step', async () => {
  const runtime = new BrowserRuntime('unit-start-url');
  const calls = [];
  runtime.open = async url => {
    calls.push(['open', url]);
    return { id: 1, url, title: '', selected: true };
  };
  runtime.click = async options => {
    calls.push(['click', options.selector]);
    return { action: 'click', page: { id: 1, url: 'https://example.test/start', title: '', selected: true }, target: 'selector:button', url: 'https://example.test/start' };
  };

  const result = await runtime.runReplayWorkflow(workflowWithFirstStep({
    id: 'click-submit',
    type: 'click',
    target: {
      structural: { selector: 'button' },
      confidence: 'high',
    },
  }), {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['open', 'https://example.test/start'],
    ['click', 'button'],
  ]);
});

test('BrowserRuntime replay routes leased pageId through startUrl bootstrap and actions', async () => {
  const runtime = new BrowserRuntime('unit-start-url-page-id');
  const calls = [];
  runtime.open = async () => {
    throw new Error('open should not create a new page when pageId is supplied');
  };
  runtime.navigate = async (url, pageId) => {
    calls.push(['navigate', url, pageId]);
    return { id: pageId, url, title: '', selected: true };
  };
  runtime.click = async options => {
    calls.push(['click', options.selector, options.pageId]);
    return { action: 'click', page: { id: options.pageId, url: 'https://example.test/start', title: '', selected: true }, target: 'selector:button', url: 'https://example.test/start' };
  };

  const result = await runtime.runReplayWorkflow(workflowWithFirstStep({
    id: 'click-submit',
    type: 'click',
    target: {
      structural: { selector: 'button' },
      confidence: 'high',
    },
  }), { pageId: 7 });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['navigate', 'https://example.test/start', 7],
    ['click', 'button', 7],
  ]);
});

test('BrowserRuntime replay uses leased pageId for scroll and conditional wait', async () => {
  const runtime = new BrowserRuntime('unit-wait-scroll-page-id');
  const calls = [];
  const page = {
    async evaluate(_fn, args) {
      if ('x' in args) calls.push(['scroll', args.x, args.y]);
      if ('text' in args) calls.push(['wait', args.text]);
      return true;
    },
  };
  runtime.open = async () => {
    throw new Error('open should not create a new page when pageId is supplied');
  };
  runtime.navigate = async (url, pageId) => {
    calls.push(['navigate', url, pageId]);
    return { id: pageId, url, title: '', selected: true };
  };
  runtime.getPage = pageId => {
    calls.push(['getPage', pageId]);
    return { pageId, page };
  };

  const result = await runtime.runReplayWorkflow({
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-06T00:00:00.000Z',
    startUrl: 'https://example.test/start',
    variables: [],
    steps: [
      { id: 'scroll-down', type: 'scroll', deltaX: 0, deltaY: 120 },
      { id: 'wait-ready', type: 'wait', ms: 10, text: 'Ready' },
    ],
  }, { pageId: 7 });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['navigate', 'https://example.test/start', 7],
    ['getPage', 7],
    ['scroll', 0, 120],
    ['getPage', 7],
    ['wait', 'Ready'],
  ]);
});

test('replay route merges leased pageId into replay options', async () => {
  const { route } = await import('../../dist/daemon/server.js');
  const workflow = workflowWithFirstStep({
    id: 'wait-ready',
    type: 'wait',
    ms: 1,
  });
  let receivedWorkflow;
  let receivedOptions;
  const runtime = {
    async runReplayWorkflow(workflowArg, optionsArg) {
      receivedWorkflow = workflowArg;
      receivedOptions = optionsArg;
      return { ok: true, workflow: { version: 1, steps: 1, startUrl: workflow.startUrl }, steps: [] };
    },
  };
  const req = Readable.from([JSON.stringify({ workflow, options: { dryRun: true }, pageId: '7' })]);
  req.method = 'POST';
  req.url = '/replay/run';

  const response = await route(req, runtime, () => ({
    pid: 1,
    port: 1,
    profile: 'unit-replay-route',
    startedAt: '2026-06-06T00:00:00.000Z',
  }), () => {});

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(receivedWorkflow, workflow);
  assert.deepEqual(receivedOptions, { dryRun: true, pageId: 7 });
});

test('replay run-file route reads workflow from local path and merges pageId', async () => {
  const { route } = await import('../../dist/daemon/server.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteflow-replay-route-file-'));
  try {
    const workflow = workflowWithFirstStep({
      id: 'wait-ready',
      type: 'wait',
      ms: 1,
    });
    const workflowPath = path.join(dir, 'workflow.json');
    fs.writeFileSync(workflowPath, JSON.stringify(workflow));
    let receivedWorkflow;
    let receivedOptions;
    const runtime = {
      async runReplayWorkflow(workflowArg, optionsArg) {
        receivedWorkflow = workflowArg;
        receivedOptions = optionsArg;
        return { ok: true, workflow: { version: 1, steps: 1, startUrl: workflow.startUrl }, steps: [] };
      },
    };
    const req = Readable.from([JSON.stringify({ path: workflowPath, options: { dryRun: true }, pageId: '7' })]);
    req.method = 'POST';
    req.url = '/replay/run-file';

    const response = await route(req, runtime, () => ({
      pid: 1,
      port: 1,
      profile: 'unit-replay-route-file',
      startedAt: '2026-06-06T00:00:00.000Z',
    }), () => {});

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(receivedWorkflow, workflow);
    assert.deepEqual(receivedOptions, { dryRun: true, pageId: 7 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('replay run CLI posts workflow path without reading workflow JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteflow-replay-cli-file-'));
  let server;
  try {
    const profile = `replay-file-${Date.now()}`;
    const workflowPath = path.join(dir, 'large-workflow.json');
    fs.writeFileSync(workflowPath, '{not valid json because cli must not parse it locally');
    let receivedBody;
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { profile } }));
        return;
      }
      if (req.method === 'POST' && req.url === '/replay/run-file') {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          receivedBody = JSON.parse(raw);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data: { ok: true, workflow: { version: 1, steps: 0, startUrl: 'https://example.test' }, steps: [] } }));
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const daemonDir = path.join(dir, 'profiles', profile);
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(path.join(daemonDir, 'daemon.json'), JSON.stringify({
      pid: process.pid,
      port,
      profile,
      startedAt: '2026-06-06T00:00:00.000Z',
      baseUrl: `http://127.0.0.1:${port}`,
    }));

    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [
        'dist/cli/main.js',
        '--json',
        '--profile',
        profile,
        'replay',
        'run',
        workflowPath,
        '--dry-run',
      ], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: { ...process.env, SITEFLOW_HOME: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('close', status => resolve({ status, stdout, stderr }));
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(receivedBody, {
      path: workflowPath,
      options: { dryRun: true, stopBeforeMutating: false },
    });
    assert.equal('workflow' in receivedBody, false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('replay export-cli runs offline and emits startUrl bootstrap without daemon', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteflow-replay-export-'));
  const workflowPath = path.join(dir, 'workflow.json');
  const scriptPath = path.join(dir, 'workflow.sh');
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflowWithFirstStep({
    id: 'wait-ready',
    type: 'wait',
    ms: 100,
    text: 'Ready',
  }), null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    'dist/cli/main.js',
    '--json',
    '--profile',
    `offline-${Date.now()}`,
    'replay',
    'export-cli',
    workflowPath,
    '--out',
    scriptPath,
  ], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /siteflow --json browser open 'https:\/\/example\.test\/start'/);
  assert.match(script, /siteflow --json eval/);
});
