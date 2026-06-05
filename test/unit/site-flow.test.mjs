import test from 'node:test';
import assert from 'node:assert/strict';

test('site receipts can include optional step traces', async () => {
  const { defineSiteFlow, withFlowSteps } = await import('../../dist/sites/flow/define-flow.js');
  const ctx = { profile: 'default', output: { json: false } };

  assert.deepEqual(defineSiteFlow(ctx, 'youtube', 'search'), {
    ctx,
    site: 'youtube',
    command: 'search',
    steps: [],
  });

  const receipt = {
    site: 'youtube',
    command: 'search',
    ok: true,
    state: 'done',
  };
  const steps = [
    {
      name: 'open-search',
      ok: true,
      state: 'done',
      startedAt: '2026-06-05T00:00:00.000Z',
      endedAt: '2026-06-05T00:00:01.000Z',
      evidence: { query: 'siteflow' },
    },
  ];

  assert.deepEqual(withFlowSteps(receipt, steps), {
    ...receipt,
    steps,
  });
});
