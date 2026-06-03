import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserKernelContext } from '../../dist/runtime/browser-kernel-context.js';

function page(id) {
  return { id };
}

test('adoptPage assigns ids and preserves the first selected page', () => {
  const context = new BrowserKernelContext();
  const first = page('first');
  const second = page('second');

  const adoptedFirst = context.adoptPage(first, { name: 'obs-1' });
  const adoptedSecond = context.adoptPage(second, { name: 'obs-2' });

  assert.deepEqual(adoptedFirst, { id: 1, created: true });
  assert.deepEqual(adoptedSecond, { id: 2, created: true });
  assert.equal(context.selectedPageId, 1);
  assert.equal(context.pages.get(1), first);
  assert.deepEqual(context.observations.get(2), { name: 'obs-2' });
});

test('adoptPage reuses an existing id for the same page object', () => {
  const context = new BrowserKernelContext();
  const reused = page('same');

  const first = context.adoptPage(reused, { version: 1 });
  const second = context.adoptPage(reused, { version: 2 });

  assert.deepEqual(first, { id: 1, created: true });
  assert.deepEqual(second, { id: 1, created: false });
  assert.equal(context.pages.size, 1);
  assert.deepEqual(context.observations.get(1), { version: 1 });
});

test('removePage advances selection to the next remaining page', () => {
  const context = new BrowserKernelContext();
  context.adoptPage(page('first'), { index: 1 });
  context.adoptPage(page('second'), { index: 2 });
  context.adoptPage(page('third'), { index: 3 });

  context.removePage(1);

  assert.equal(context.selectedPageId, 2);
  assert.equal(context.pages.has(1), false);
  assert.equal(context.observations.get(1), undefined);
});

test('removePage leaves selection unchanged when removing a non-selected page', () => {
  const context = new BrowserKernelContext();
  context.adoptPage(page('first'), { index: 1 });
  context.adoptPage(page('second'), { index: 2 });

  context.selectedPageId = 2;
  context.removePage(1);

  assert.equal(context.selectedPageId, 2);
  assert.equal(context.pages.has(1), false);
});

test('reset clears context-owned state but keeps monotonic page ids', () => {
  const context = new BrowserKernelContext();
  context.context = { tag: 'browser-context' };
  context.adoptPage(page('first'), { index: 1 });
  context.adoptPage(page('second'), { index: 2 });

  context.reset();

  assert.equal(context.context, null);
  assert.equal(context.pages.size, 0);
  assert.equal(context.selectedPageId, null);

  const adoptedAfterReset = context.adoptPage(page('after-reset'), { index: 3 });
  assert.deepEqual(adoptedAfterReset, { id: 3, created: true });
  assert.equal(context.selectedPageId, 3);
});
