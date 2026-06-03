import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateDebuggerExpression } from '../../dist/runtime/debugger-runtime.js';
import { createPageObservation } from '../../dist/runtime/page-observation.js';

function observationWithCdp(send) {
  const observation = createPageObservation();
  observation.cdp = { send };
  return observation;
}

test('evaluateDebuggerExpression skips site debugger pauses for runtime eval', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { value: 42, type: 'number' } };
    return {};
  });
  observation.paused = {
    reason: 'other',
    callFrames: [{ callFrameId: 'cf-1', functionName: '', location: { scriptId: '1', lineNumber: 1 }, url: 'https://xueqiu.com/app.js' }],
  };

  const value = await evaluateDebuggerExpression(observation, 'Promise.resolve(42)');

  assert.equal(value, 42);
  assert.deepEqual(calls.map(call => call.method), [
    'Debugger.resume',
    'Debugger.setSkipAllPauses',
    'Runtime.evaluate',
    'Debugger.setSkipAllPauses',
  ]);
  assert.equal(calls[2].params.awaitPromise, true);
  assert.equal(observation.paused, null);
});

test('evaluateDebuggerExpression preserves explicit breakpoint frame eval', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
    if (method === 'Debugger.evaluateOnCallFrame') return { result: { value: 'local', type: 'string' } };
    return {};
  });
  observation.paused = {
    reason: 'other',
    hitBreakpoints: ['bp-1'],
    callFrames: [{ callFrameId: 'cf-1', functionName: 'target', location: { scriptId: '1', lineNumber: 1 }, url: 'file:///app.js' }],
  };

  const value = await evaluateDebuggerExpression(observation, 'value');

  assert.equal(value, 'local');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.evaluateOnCallFrame');
  assert.equal(calls[0].params.awaitPromise, true);
});
