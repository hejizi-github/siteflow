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
