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

test('runWorkflow wait defaults to one second', async () => {
  const { runWorkflow } = await import('../../dist/runtime/replay-runtime.js');
  const startedAt = Date.now();
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
      { id: 'step-1', type: 'wait' },
    ],
    evidence: {},
  }, {});

  assert.equal(result.ok, true);
  assert.ok(Date.now() - startedAt >= 900);
});
