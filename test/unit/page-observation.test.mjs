import test from 'node:test';
import assert from 'node:assert/strict';

import { PageObservationStore } from '../../dist/runtime/page-observation-store.js';
import { createPageObservation, toBodySummary } from '../../dist/runtime/page-observation.js';

test('PageObservationStore stores, deletes, and clears observations by page id', () => {
  const store = new PageObservationStore();

  store.set(1, { value: 'one' });
  store.set(2, { value: 'two' });
  assert.deepEqual(store.get(1), { value: 'one' });
  assert.deepEqual(store.get(2), { value: 'two' });

  store.delete(1);
  assert.equal(store.get(1), undefined);
  assert.deepEqual(store.get(2), { value: 'two' });

  store.clear();
  assert.equal(store.get(2), undefined);
});

test('createPageObservation starts empty counters and collections', () => {
  const observation = createPageObservation();

  assert.equal(observation.debuggerEnabled, false);
  assert.equal(observation.console.length, 0);
  assert.equal(observation.network.length, 0);
  assert.equal(observation.scripts.size, 0);
  assert.equal(observation.networkBodies.size, 0);
  assert.equal(observation.networkDetails.size, 0);
  assert.equal(observation.hooks.size, 0);
  assert.equal(observation.breakpoints.size, 0);
  assert.equal(observation.paused, null);
  assert.equal(observation.nextConsoleId, 1);
  assert.equal(observation.nextNetworkId, 1);
  assert.equal(observation.nextBreakpointId, 1);
});

test('toBodySummary preserves error metadata and availability state', () => {
  const summary = toBodySummary({
    bytes: 42,
    truncated: true,
    encoding: 'utf8',
    body: 'payload',
    error: 'capture failed',
  });

  assert.deepEqual(summary, {
    available: false,
    bytes: 42,
    truncated: true,
    encoding: 'utf8',
    error: 'capture failed',
  });
});
