import test from 'node:test';
import assert from 'node:assert/strict';

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
  const workflow = validateWorkflow(validWorkflow({
    steps: [
      { id: 'step-1', type: 'open', url: 'https://example.com/' },
      { id: 'step-2', type: 'click', target: { semantic: { text: 'Continue' }, confidence: 'high' } },
    ],
    evidence: { pages: 1, events: 2 },
  }));

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
    { id: 'step-1', type: 'click', target: {} },
    { id: 'step-1', type: 'type', target: {}, value: 'hello' },
    { id: 'step-1', type: 'select', target: {}, option: 'A' },
  ]) {
    assert.throws(
      () => validateWorkflow(validWorkflow({ steps: [step] })),
      /BAD_WORKFLOW/,
    );
  }
});
