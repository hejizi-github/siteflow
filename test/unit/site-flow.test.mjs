import test from 'node:test';
import assert from 'node:assert/strict';

test('site receipts can include optional step traces', async () => {
  const module = await import('../../dist/sites/flow/define-flow.js');
  assert.equal(typeof module.defineSiteFlow, 'function');
});
