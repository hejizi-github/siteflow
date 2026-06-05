import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const validation = () => import('../../dist/runtime/workflow-validation.js');

function validWorkflow(overrides = {}) {
  return {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    variables: [],
    steps: [{ id: 'step-1', type: 'open', url: 'https://example.com/' }],
    evidence: {},
    ...overrides,
  };
}

test('validateWorkflow accepts a minimal phase 1 workflow', async () => {
  const { validateWorkflow } = await validation();
  const target = { confidence: 'high' };
  const workflow = validateWorkflow(validWorkflow({
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target },
      { id: 'step-3', type: 'type', target, value: 'hello' },
      { id: 'step-4', type: 'select', target, option: 'A' },
      { id: 'step-5', type: 'scroll', deltaX: 0, deltaY: 120 },
      { id: 'step-6', type: 'wait' },
      { id: 'step-7', type: 'screenshot' },
    ],
    evidence: { pages: 1, events: 2 },
  }));

  assert.equal(workflow.kind, 'siteflow.workflow');
  assert.deepEqual(workflow.steps.map((step) => step.type), ['open', 'click', 'type', 'select', 'scroll', 'wait', 'screenshot']);
});

test('validateWorkflow preserves optional workflow fields and defaults variables/evidence', async () => {
  const { validateWorkflow } = await validation();
  const workflow = validateWorkflow({
    version: 1,
    kind: 'siteflow.workflow',
    name: 'Checkout',
    createdAt: '2026-06-05T00:00:00.000Z',
    startUrl: 'https://example.com/',
    steps: [{ id: 'step-1', type: 'open', url: 'https://example.com/' }],
  });

  assert.equal(workflow.name, 'Checkout');
  assert.deepEqual(workflow.variables, []);
  assert.deepEqual(workflow.steps, [{ id: 'step-1', type: 'open', url: 'https://example.com/' }]);
  assert.deepEqual(workflow.evidence, {});
});

test('validateWorkflow rejects malformed top-level workflow fields', async () => {
  const { validateWorkflow } = await validation();
  for (const workflow of [
    null,
    [],
    'workflow',
    validWorkflow({ kind: 'siteflow.recording' }),
    (() => {
      const workflow = validWorkflow();
      delete workflow.kind;
      return workflow;
    })(),
    (() => {
      const workflow = validWorkflow();
      delete workflow.steps;
      return workflow;
    })(),
    validWorkflow({ steps: {} }),
    validWorkflow({ evidence: 'bad' }),
  ]) {
    assert.throws(
      () => validateWorkflow(workflow),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow preserves variables, steps, and evidence when supplied', async () => {
  const { validateWorkflow } = await validation();
  const workflow = validateWorkflow(validWorkflow({
    name: 'Signup',
    variables: [{ name: 'email', source: 'input', sensitive: false, required: true }],
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      {
        id: 'step-2',
        type: 'click',
        target: {
          semantic: { role: 'button', aria: 'Submit', label: 'Submit', text: 'Submit', placeholder: 'Email' },
          structural: { selector: '#submit', xpath: '//*[@id="submit"]', nth: 0 },
          geometry: { x: 10, y: 20, width: 100, height: 30 },
          confidence: 'medium',
        },
      },
      { id: 'step-3', type: 'type', target: { confidence: 'low' }, value: 'hello' },
    ],
    evidence: { pages: 1, events: 2 },
  }));

  assert.equal(workflow.name, 'Signup');
  assert.deepEqual(workflow.variables, [{ name: 'email', source: 'input', sensitive: false, required: true }]);
  assert.deepEqual(workflow.steps, [
    { id: 'step-1', type: 'open', url: 'https://example.com/' },
    {
      id: 'step-2',
      type: 'click',
      target: {
        semantic: { role: 'button', aria: 'Submit', label: 'Submit', text: 'Submit', placeholder: 'Email' },
        structural: { selector: '#submit', xpath: '//*[@id="submit"]', nth: 0 },
        geometry: { x: 10, y: 20, width: 100, height: 30 },
        confidence: 'medium',
      },
    },
    { id: 'step-3', type: 'type', target: { confidence: 'low' }, value: 'hello' },
  ]);
  assert.deepEqual(workflow.evidence, { pages: 1, events: 2 });
});

test('validateWorkflow classifies malformed and unsupported workflow versions', async () => {
  const { validateWorkflow } = await validation();
  for (const workflow of [
    (() => {
      const workflow = validWorkflow();
      delete workflow.version;
      return workflow;
    })(),
    validWorkflow({ version: '1' }),
    validWorkflow({ version: Number.NaN }),
  ]) {
    assert.throws(
      () => validateWorkflow(workflow),
      /BAD_WORKFLOW/,
    );
  }

  assert.throws(
    () => validateWorkflow(validWorkflow({ version: 2 })),
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

test('validateWorkflow rejects present non-string workflow names', async () => {
  const { validateWorkflow } = await validation();
  assert.throws(
    () => validateWorkflow(validWorkflow({ name: 123 })),
    /BAD_WORKFLOW/,
  );
});

test('validateWorkflow rejects malformed workflow variables', async () => {
  const { validateWorkflow } = await validation();
  assert.throws(
    () => validateWorkflow(validWorkflow({ variables: [{}] })),
    /BAD_WORKFLOW/,
  );
});

test('validateWorkflow rejects malformed required step targets', async () => {
  const { validateWorkflow } = await validation();
  for (const step of [
    { id: 'step-1', type: 'click' },
    { id: 'step-1', type: 'click', target: {} },
    { id: 'step-1', type: 'type', value: 'hello' },
    { id: 'step-1', type: 'type', target: {}, value: 'hello' },
    { id: 'step-1', type: 'select', option: 'A' },
    { id: 'step-1', type: 'select', target: {}, option: 'A' },
  ]) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [step] })),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow rejects malformed nested target fields', async () => {
  const { validateWorkflow } = await validation();
  const targetCases = [
    { confidence: 'bad' },
    { confidence: 'high', semantic: 'button' },
    { confidence: 'high', semantic: { role: 1 } },
    { confidence: 'high', semantic: { aria: 1 } },
    { confidence: 'high', semantic: { label: 1 } },
    { confidence: 'high', semantic: { text: 1 } },
    { confidence: 'high', semantic: { placeholder: 1 } },
    { confidence: 'high', structural: 'selector' },
    { confidence: 'high', structural: { selector: 1 } },
    { confidence: 'high', structural: { xpath: 1 } },
    { confidence: 'high', structural: { nth: Number.NaN } },
    { confidence: 'high', geometry: 'box' },
    { confidence: 'high', geometry: { x: 'bad', y: 0 } },
    { confidence: 'high', geometry: { x: 0, y: Number.POSITIVE_INFINITY } },
    { confidence: 'high', geometry: { x: 0, y: 0, width: '100' } },
    { confidence: 'high', geometry: { x: 0, y: 0, height: Number.NaN } },
  ];

  for (const target of targetCases) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [{ id: 'step-1', type: 'click', target }] })),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow rejects missing or invalid required step fields', async () => {
  const { validateWorkflow } = await validation();
  const validTarget = { confidence: 'low' };
  const stepCases = [
    { id: 'step-1', type: 'open' },
    { id: 'step-1', type: 'open', url: '' },
    { id: 'step-1', type: 'open', url: 123 },
    { id: 'step-1', type: 'type', target: validTarget },
    { id: 'step-1', type: 'type', target: validTarget, value: '' },
    { id: 'step-1', type: 'type', target: validTarget, value: 123 },
    { id: 'step-1', type: 'select', target: validTarget },
    { id: 'step-1', type: 'select', target: validTarget, option: '' },
    { id: 'step-1', type: 'select', target: validTarget, option: 123 },
  ];

  for (const step of stepCases) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [step] })),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow accepts recorded Enter key type steps with empty value', async () => {
  const { validateWorkflow } = await validation();
  const step = {
    id: 'step-1',
    type: 'type',
    target: { confidence: 'high' },
    value: '',
    clear: false,
    pressEnter: true,
  };

  const workflow = validateWorkflow(validWorkflow({ steps: [step] }));

  assert.deepEqual(workflow.steps, [step]);
});

test('validateWorkflow rejects malformed scroll deltas', async () => {
  const { validateWorkflow } = await validation();
  const stepCases = [
    { id: 'step-1', type: 'scroll', deltaY: 120 },
    { id: 'step-1', type: 'scroll', deltaX: 0 },
    { id: 'step-1', type: 'scroll', deltaX: '0', deltaY: 120 },
    { id: 'step-1', type: 'scroll', deltaX: 0, deltaY: '120' },
    { id: 'step-1', type: 'scroll', deltaX: Number.NaN, deltaY: 120 },
    { id: 'step-1', type: 'scroll', deltaX: 0, deltaY: Number.POSITIVE_INFINITY },
  ];

  for (const step of stepCases) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [step] })),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow rejects malformed optional step fields', async () => {
  const { validateWorkflow } = await validation();
  const target = { confidence: 'high' };
  const stepCases = [
    { id: 'step-1', type: 'click', target, button: 'primary' },
    { id: 'step-1', type: 'type', target, value: 'hello', clear: 'true' },
    { id: 'step-1', type: 'type', target, value: 'hello', pressEnter: 1 },
    { id: 'step-1', type: 'wait', ms: '100' },
    { id: 'step-1', type: 'wait', ms: Number.NaN },
    { id: 'step-1', type: 'wait', ms: Number.POSITIVE_INFINITY },
    { id: 'step-1', type: 'wait', urlContains: 1 },
    { id: 'step-1', type: 'wait', text: 1 },
    { id: 'step-1', type: 'wait', selector: 1 },
    { id: 'step-1', type: 'screenshot', fullPage: 'true' },
  ];

  for (const step of stepCases) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [step] })),
      /BAD_WORKFLOW/,
    );
  }
});

test('validateWorkflow preserves valid optional step fields', async () => {
  const { validateWorkflow } = await validation();
  const target = { confidence: 'high' };
  const steps = [
    { id: 'step-1', type: 'click', target, button: 'middle' },
    { id: 'step-2', type: 'type', target, value: 'hello', clear: true, pressEnter: false },
    { id: 'step-3', type: 'wait', ms: 250, urlContains: '/done', text: 'Done', selector: '#done' },
    { id: 'step-4', type: 'screenshot', fullPage: true },
  ];

  const workflow = validateWorkflow(validWorkflow({ steps }));

  assert.deepEqual(workflow.steps, steps);
});

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
      { id: 'step-2', type: 'type', label: 'Email', target: { semantic: { label: 'Email' }, confidence: 'high' }, value: '${LOGIN_EMAIL}' },
      { id: 'step-3', type: 'click', label: 'Submit form', target: { semantic: { text: 'Submit' }, confidence: 'high' }, mutating: true },
      { id: 'step-4', type: 'wait', ms: 1234 },
    ],
    evidence: {},
  });

  assert.match(script, /siteflow --json browser open 'https:\/\/example.com\/'/);
  assert.match(script, /--value '\$\{LOGIN_EMAIL\}'/);
  assert.match(script, /# step-2: type - Email/);
  assert.match(script, /siteflow --json eval 'new Promise\(resolve => setTimeout\(resolve, 1234\)\)'/);
  assert.match(script, /# MUTATING step-3: Submit form/);
});

test('exportWorkflowCli expands exact typed variables only when declared', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const target = { semantic: { label: 'Email' }, confidence: 'high' };

  const undeclaredScript = exportWorkflowCli(validWorkflow({
    variables: [],
    steps: [{ id: 'step-1', type: 'type', target, value: '${LOGIN_EMAIL}' }],
  }));
  const declaredScript = exportWorkflowCli(validWorkflow({
    variables: [{ name: 'LOGIN_EMAIL', source: 'input', sensitive: false, required: true }],
    steps: [{ id: 'step-1', type: 'type', target, value: '${LOGIN_EMAIL}' }],
  }));

  assert.match(undeclaredScript, /--value '\$\{LOGIN_EMAIL\}'/);
  assert.doesNotMatch(undeclaredScript, /--value "\$\{LOGIN_EMAIL\}"/);
  assert.match(declaredScript, /--value "\$\{LOGIN_EMAIL\}"/);
});

test('exportWorkflowCli emits workflow startUrl before recorded steps without initial open', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    startUrl: 'https://start.example/path?x=1',
    steps: [{ id: 'step-1', type: 'wait', ms: 25 }],
  }));

  const openCommand = "siteflow --json browser open 'https://start.example/path?x=1'";
  const waitCommand = "siteflow --json eval 'new Promise(resolve => setTimeout(resolve, 25))'";
  assert.ok(script.includes(openCommand));
  assert.ok(script.includes(waitCommand));
  assert.ok(script.indexOf(openCommand) < script.indexOf(waitCommand));
});

test('exportWorkflowCli does not duplicate workflow startUrl when first step is open', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    startUrl: 'https://example.com/',
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'wait', ms: 25 },
    ],
  }));

  const openCommand = "siteflow --json browser open 'https://example.com/'";
  assert.equal(script.split(openCommand).length - 1, 1);
});

test('exportWorkflowCli prepends workflow startUrl when first open goes elsewhere', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    startUrl: 'https://start.example/',
    steps: [
      { id: 'step-1', type: 'open', url: 'https://elsewhere.example/' },
      { id: 'step-2', type: 'wait', ms: 25 },
    ],
  }));

  const startOpenCommand = "siteflow --json browser open 'https://start.example/'";
  const firstStepOpenCommand = "siteflow --json browser open 'https://elsewhere.example/'";
  assert.ok(script.includes(startOpenCommand));
  assert.ok(script.includes(firstStepOpenCommand));
  assert.ok(script.indexOf(startOpenCommand) < script.indexOf(firstStepOpenCommand));
});

test('exportWorkflowCli sanitizes comment text for mutating steps', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    steps: [
      {
        id: 'step-1\necho pwned',
        type: 'click',
        label: 'Submit\r\necho label-pwned\u0007',
        target: { semantic: { text: 'Submit' }, confidence: 'high' },
        mutating: true,
      },
    ],
  }));

  assert.match(script, /# MUTATING step-1 echo pwned: Submit  echo label-pwned /);
  assert.doesNotMatch(script, /^echo (?:pwned|label-pwned)$/m);
});

test('exportWorkflowCli writes screenshots to a safe local filename', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    steps: [{ id: '../outside/path', type: 'screenshot' }],
  }));

  assert.match(script, /--out '\.\._outside_path\.png'/);
  assert.doesNotMatch(script, /\.\.\//);
});

test('exportWorkflowCli rejects non-integer structural nth', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'click',
          target: { structural: { selector: '#submit', nth: 1.5 }, confidence: 'high' },
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects xpath targets instead of dropping xpath disambiguators', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'click',
          target: { structural: { selector: '#submit', xpath: '//*[@id="submit"]' }, confidence: 'high' },
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects nth when click falls back to geometry', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'click',
          target: { structural: { nth: 1 }, geometry: { x: 12, y: 34 }, confidence: 'low' },
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects placeholder-only targets instead of selector fallbacks', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'type',
          target: { semantic: { placeholder: 'Search docs' }, confidence: 'high' },
          value: 'workflow',
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects role-only click targets instead of selector fallbacks', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'click',
          target: { semantic: { role: 'button' }, confidence: 'high' },
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects role+text targets instead of dropping role disambiguators', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'click',
          target: { semantic: { role: 'button', text: 'Submit' }, confidence: 'high' },
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects placeholder+selector targets instead of dropping placeholder disambiguators', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'type',
          target: {
            semantic: { placeholder: 'Search docs' },
            structural: { selector: '#search' },
            confidence: 'high',
          },
          value: 'workflow',
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects aria-only select targets instead of aria-label selector fallbacks', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'select',
          target: { semantic: { aria: 'Country' }, confidence: 'high' },
          option: 'Canada',
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects label-only select targets', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'select',
          target: { semantic: { label: 'Country' }, confidence: 'high' },
          option: 'Canada',
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects select targets with nth even when selector is present', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [
        {
          id: 'step-1',
          type: 'select',
          target: { structural: { selector: '#country', nth: 1 }, confidence: 'high' },
          option: 'Canada',
        },
      ],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli rejects geometry-only type and select targets', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const geometryOnlyTarget = { geometry: { x: 12, y: 34 }, confidence: 'low' };

  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [{ id: 'step-1', type: 'type', target: geometryOnlyTarget, value: 'hello' }],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
  assert.throws(
    () => exportWorkflowCli(validWorkflow({
      steps: [{ id: 'step-1', type: 'select', target: geometryOnlyTarget, option: 'One' }],
    })),
    /UNSUPPORTED_WORKFLOW_TARGET/,
  );
});

test('exportWorkflowCli preserves conditional wait semantics', async () => {
  const { exportWorkflowCli } = await import('../../dist/runtime/workflow-export.js');
  const script = exportWorkflowCli(validWorkflow({
    steps: [
      { id: 'step-1', type: 'wait', selector: '#ready', ms: 2000 },
      { id: 'step-2', type: 'wait', text: 'Loaded' },
      { id: 'step-3', type: 'wait', urlContains: '/done' },
    ],
  }));

  assert.match(script, /document\.querySelector\("#ready"\) !== null/);
  assert.match(script, /Date\.now\(\) \+ 2000/);
  assert.match(script, /document\.body\?\.innerText\.includes\("Loaded"\) === true/);
  assert.match(script, /Date\.now\(\) \+ 1000/);
  assert.match(script, /window\.location\.href\.includes\("\/done"\)/);
  assert.doesNotMatch(script, /setTimeout\(resolve, 1000\)/);
});

test('normalizeRecordedEvents merges repeated input events', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const target = {
    semantic: { label: 'Search' },
    structural: { selector: 'input[name="q"]' },
    confidence: 'high',
  };

  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.test/search',
    events: [
      { ts: '2026-06-05T00:00:01.000Z', type: 'input', target, value: 'a', url: 'https://example.test/search', title: 'Search' },
      { ts: '2026-06-05T00:00:02.000Z', type: 'input', target, value: 'apple', url: 'https://example.test/search', title: 'Search' },
    ],
  });

  assert.deepEqual(steps, [
    { id: 'step-1', type: 'open', url: 'https://example.test/search' },
    { id: 'step-2', type: 'type', target, value: 'apple', clear: true },
  ]);
});

test('normalizeRecordedEvents marks submit clicks as mutating', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const target = {
    semantic: { text: 'Submit' },
    structural: { selector: 'button[type="submit"]' },
    confidence: 'high',
  };

  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.test/form',
    events: [
      { ts: '2026-06-05T00:00:01.000Z', type: 'click', target, url: 'https://example.test/form', title: 'Form' },
    ],
  });

  assert.deepEqual(steps, [
    { id: 'step-1', type: 'open', url: 'https://example.test/form' },
    { id: 'step-2', type: 'click', target, mutating: true },
  ]);
});

test('normalizeRecordedEvents converts select change events to select steps', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const target = {
    semantic: { label: 'Country' },
    structural: { selector: 'select[name="country"]' },
    confidence: 'high',
  };

  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.test/form',
    events: [
      {
        ts: '2026-06-05T00:00:01.000Z',
        type: 'change',
        control: 'select',
        target,
        value: 'CA',
        option: 'Canada',
        url: 'https://example.test/form',
        title: 'Form',
      },
    ],
  });

  assert.deepEqual(steps, [
    { id: 'step-1', type: 'open', url: 'https://example.test/form' },
    { id: 'step-2', type: 'select', target, option: 'Canada' },
  ]);
});

test('stopRecorderSession skips sensitive input and change events and counts them unsupported', async () => {
  const { stopRecorderSession } = await import('../../dist/runtime/recorder-runtime.js');
  const temp = await mkdtemp(path.join(tmpdir(), 'siteflow-recorder-sensitive-'));
  try {
    const out = path.join(temp, 'workflow.json');
    const target = {
      semantic: { label: 'API key' },
      structural: { selector: 'input[name="api_key"]' },
      confidence: 'high',
    };
    const result = await stopRecorderSession({
      id: 'session-sensitive',
      pageId: 1,
      startedAt: '2026-06-05T00:00:00.000Z',
      out,
      startUrl: 'https://example.test/settings',
      events: [
        {
          ts: '2026-06-05T00:00:01.000Z',
          type: 'input',
          control: 'input',
          value: 'super-secret-token',
          target,
          url: 'https://example.test/settings',
          title: 'Settings',
        },
        {
          ts: '2026-06-05T00:00:02.000Z',
          type: 'change',
          control: 'input',
          value: 'another-secret',
          target,
          url: 'https://example.test/settings',
          title: 'Settings',
        },
      ],
    });

    const written = await readFile(out, 'utf8');
    assert.equal(result.unsupportedEvents, 2);
    assert.deepEqual(result.workflow.steps, [
      { id: 'step-1', type: 'open', url: 'https://example.test/settings' },
    ]);
    assert.equal(written.includes('super-secret-token'), false);
    assert.equal(written.includes('another-secret'), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('normalizeRecordedEvents ignores Enter keydown for multiline controls', async () => {
  const { normalizeRecordedEvents } = await import('../../dist/runtime/recorder-runtime.js');
  const textareaTarget = {
    semantic: { label: 'Message' },
    structural: { selector: 'textarea[name="message"]' },
    confidence: 'high',
  };
  const editorTarget = {
    semantic: { aria: 'Comment editor' },
    structural: { selector: '#editor' },
    confidence: 'high',
  };

  const steps = normalizeRecordedEvents({
    startUrl: 'https://example.test/comment',
    events: [
      {
        ts: '2026-06-05T00:00:01.000Z',
        type: 'keydown',
        control: 'textarea',
        key: 'Enter',
        target: textareaTarget,
        url: 'https://example.test/comment',
        title: 'Comment',
      },
      {
        ts: '2026-06-05T00:00:02.000Z',
        type: 'keydown',
        control: 'contenteditable',
        key: 'Enter',
        target: editorTarget,
        url: 'https://example.test/comment',
        title: 'Comment',
      },
    ],
  });

  assert.deepEqual(steps, [
    { id: 'step-1', type: 'open', url: 'https://example.test/comment' },
  ]);
});

test('stopRecorderSession writes workflow JSON to nested output directories', async () => {
  const { stopRecorderSession } = await import('../../dist/runtime/recorder-runtime.js');
  const temp = await mkdtemp(path.join(tmpdir(), 'siteflow-recorder-out-'));
  try {
    const out = path.join(temp, 'nested', 'recordings', 'workflow.json');
    const result = await stopRecorderSession({
      id: 'session-nested',
      pageId: 1,
      startedAt: '2026-06-05T00:00:00.000Z',
      out,
      startUrl: 'https://example.test',
      events: [],
    });

    const written = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(result.out, out);
    assert.equal(result.steps, 1);
    assert.equal(written.kind, 'siteflow.workflow');
    assert.deepEqual(written.steps, [
      { id: 'step-1', type: 'open', url: 'https://example.test' },
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
