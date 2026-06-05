import test from 'node:test';
import assert from 'node:assert/strict';

import { defineSiteFlow, flowEvidence, withFlowSteps } from '../../dist/sites/flow/define-flow.js';

const ctx = {
  profile: 'default',
  output: { json: true, profile: 'default' },
};

test('site flow records successful sequential steps', async () => {
  const receipt = await defineSiteFlow(ctx, 'youtube', 'search')
    .step('open_search_page', async () => flowEvidence(
      { pageId: 1, url: 'https://www.youtube.com/results', title: 'YouTube' },
      { pageId: 1 },
    ))
    .step('extract_search_results', async flow => flowEvidence(
      { count: flow.get('open_search_page').pageId },
      { count: 1 },
    ))
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
  assert.deepEqual(receipt.steps.map(step => step.evidence), [{ pageId: 1 }, { count: 1 }]);
});

test('site flow omits evidence for raw step values', async () => {
  const receipt = await defineSiteFlow(ctx, 'youtube', 'search')
    .step('read_page_text', async () => ({ text: 'private user text', token: 'raw-secret' }))
    .step('read_structural_evidence_shape', async () => ({ value: 'raw-secret', evidence: { secret: 'leak' } }))
    .step('read_missing_explicit_evidence', async () => flowEvidence({ text: 'private', token: 'raw-secret' }))
    .receipt(flow => ({
      site: 'youtube',
      command: 'search',
      ok: true,
      state: 'page_read',
      observations: {
        text: flow.get('read_page_text').text,
      },
      errors: [],
      next: [],
    }));

  assert.equal(receipt.observations.text, 'private user text');
  assert.equal('evidence' in receipt.steps[0], false);
  assert.equal('evidence' in receipt.steps[1], false);
  assert.deepEqual(receipt.steps[2].evidence, {});
  assert.equal(JSON.stringify(receipt.steps[0]).includes('raw-secret'), false);
  assert.equal(JSON.stringify(receipt.steps[1]).includes('leak'), false);
  assert.equal(JSON.stringify(receipt.steps[2]).includes('raw-secret'), false);
  assert.equal(JSON.stringify(receipt.steps[2]).includes('private'), false);
});

test('site flow records failed steps before rethrowing', async () => {
  const runner = defineSiteFlow(ctx, 'youtube', 'comments')
    .step('open_video_page', async () => ({ pageId: 2 }))
    .step('extract_comments', async () => {
      throw new Error('comments unavailable');
    });

  await assert.rejects(
    runner.receipt(() => ({
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

  const failedStep = runner.steps[1];
  assert.equal(failedStep.name, 'extract_comments');
  assert.equal(failedStep.ok, false);
  assert.equal(failedStep.state, 'extract_comments_failed');
  assert.deepEqual(failedStep.error, {
    code: 'SITE_FLOW_STEP_FAILED',
    message: 'Step failed before completing.',
  });
});

test('site flow runner cannot execute twice or add steps after execution', async () => {
  const runner = defineSiteFlow(ctx, 'youtube', 'search')
    .step('open_search_page', async () => flowEvidence({ pageId: 1 }, { pageId: 1 }));

  await runner.receipt(() => ({
    site: 'youtube',
    command: 'search',
    ok: true,
    state: 'search_collected',
    observations: {},
    errors: [],
    next: [],
  }));

  await assert.rejects(
    runner.receipt(() => ({
      site: 'youtube',
      command: 'search',
      ok: true,
      state: 'search_collected',
      observations: {},
      errors: [],
      next: [],
    })),
    /SiteFlowRunner already executed/,
  );
  assert.throws(
    () => runner.step('extract_search_results', async () => ({ count: 1 })),
    /SiteFlowRunner already executed/,
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
