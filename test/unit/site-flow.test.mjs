import test from 'node:test';
import assert from 'node:assert/strict';

import { defineSiteFlow, withFlowSteps } from '../../dist/sites/flow/define-flow.js';

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

test('withFlowSteps preserves receipt compatibility', () => {
  const receipt = {
    site: 'youtube',
    command: 'search',
    ok: true,
    state: 'done',
  };
  const steps = [
    {
      name: 'open_search_page',
      ok: true,
      state: 'open_search_page_ok',
      startedAt: '2026-06-05T00:00:00.000Z',
      endedAt: '2026-06-05T00:00:01.000Z',
      evidence: { pageId: 1 },
    },
  ];

  assert.deepEqual(withFlowSteps(receipt, steps), {
    ...receipt,
    steps,
  });
});
