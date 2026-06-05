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

test('target matcher returns coordinates as the last fallback', async () => {
  const { clickOptionsFromRecordedTarget } = await import('../../dist/runtime/target-matcher.js');
  const target = clickOptionsFromRecordedTarget({
    geometry: { x: 10.4, y: 20.6 },
    confidence: 'low',
  });
  assert.deepEqual(target, { x: 10, y: 21 });
});
