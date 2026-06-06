import test from 'node:test';
import { breakOnXhrInObservation, ensureDebuggerReady, evaluateDebuggerExpression, pausedInfoFromObservation, removeStoredBreakpoint, resumeDebugger, stepDebugger } from '../../dist/runtime/debugger-runtime.js';
import assert from 'node:assert/strict';

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

// --- ensureDebuggerReady ---

/**
 * Creates a minimal Playwright Page-like mock whose .context() returns an object
 * with a .newCDPSession() method that produces a session carrying .send and .on spies.
 */
function mockPage(session) {
  return {
    context: () => ({
      newCDPSession: async (_page) => session,
    }),
  };
}

test('ensureDebuggerReady when not enabled attaches CDP and enables Debugger', async () => {
  const calls = [];
  const session = {
    send: async (method, params) => { calls.push({ method, params }); },
    on: (_event, _fn) => {},
  };
  const page = mockPage(session);
  const observation = createPageObservation();

  const result = await ensureDebuggerReady(page, observation);

  assert.equal(result, observation);
  assert.equal(observation.cdp, session);
  assert.equal(observation.debuggerEnabled, true);
  assert.deepEqual(calls.map(c => c.method), ['Debugger.enable', 'Runtime.enable']);
});

test('ensureDebuggerReady when already enabled is a no-op', async () => {
  const calls = [];
  const session = {
    send: async (method, params) => { calls.push({ method, params }); },
    on: (_event, _fn) => {},
  };
  const page = mockPage(session);
  const observation = createPageObservation();
  observation.cdp = session;
  observation.debuggerEnabled = true;

  const result = await ensureDebuggerReady(page, observation);

  assert.equal(result, observation);
  assert.equal(calls.length, 0);
});

test('ensureDebuggerReady handles CDP creation failure', async () => {
  const page = {
    context: () => ({
      newCDPSession: async (_page) => { throw new Error('CDP connection lost'); },
    }),
  };
  const observation = createPageObservation();

  await assert.rejects(
    () => ensureDebuggerReady(page, observation),
    { message: 'CDP connection lost' },
  );
});

// --- resumeDebugger ---

test('resumeDebugger sends Debugger.resume and clears paused state', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });
  observation.paused = {
    reason: 'other',
    callFrames: [{ callFrameId: 'cf-1', functionName: 'test', location: { scriptId: '1', lineNumber: 1 }, url: 'test.js' }],
  };

  const result = await resumeDebugger(observation);

  assert.deepEqual(result, { resumed: true });
  assert.equal(observation.paused, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.resume');
});

// --- stepDebugger ---

test('stepDebugger with into sends Debugger.stepInto', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });

  const result = await stepDebugger(observation, 'into');

  assert.deepEqual(result, { step: 'into' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.stepInto');
});

test('stepDebugger with over sends Debugger.stepOver', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });

  const result = await stepDebugger(observation, 'over');

  assert.deepEqual(result, { step: 'over' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.stepOver');
});

test('stepDebugger with out sends Debugger.stepOut', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });

  const result = await stepDebugger(observation, 'out');

  assert.deepEqual(result, { step: 'out' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.stepOut');
});

// --- ensureDebuggerReady event handlers ---

test('ensureDebuggerReady registers scriptParsed handler that populates scripts', async () => {
  const calls = [];
  const listeners = {};
  const session = {
    send: async (method, params) => { calls.push({ method, params }); },
    on: (event, fn) => { listeners[event] = fn; },
  };
  const page = mockPage(session);
  const observation = createPageObservation();

  await ensureDebuggerReady(page, observation);

  // Simulate a Debugger.scriptParsed event
  listeners['Debugger.scriptParsed']({
    scriptId: 'script-1',
    url: 'https://example.com/app.js',
    startLine: 0,
    startColumn: 0,
    endLine: 100,
    endColumn: 0,
    executionContextId: 1,
    hash: 'abc123',
    isModule: true,
    sourceMapURL: 'app.js.map',
  });

  const script = observation.scripts.get('script-1');
  assert.ok(script);
  assert.equal(script.url, 'https://example.com/app.js');
  assert.equal(script.hash, 'abc123');
  assert.equal(script.isModule, true);
  assert.equal(script.sourceMapURL, 'app.js.map');
});

test('ensureDebuggerReady registers paused/resumed handlers that toggle paused state', async () => {
  const calls = [];
  const listeners = {};
  const session = {
    send: async (method, params) => { calls.push({ method, params }); },
    on: (event, fn) => { listeners[event] = fn; },
  };
  const page = mockPage(session);
  const observation = createPageObservation();

  await ensureDebuggerReady(page, observation);

  const pauseEvent = {
    reason: 'breakpoint',
    callFrames: [{ callFrameId: 'cf-1', functionName: 'test', location: { scriptId: '1', lineNumber: 5 }, url: 'test.js' }],
  };
  listeners['Debugger.paused'](pauseEvent);
  assert.equal(observation.paused, pauseEvent);

  listeners['Debugger.resumed']();
  assert.equal(observation.paused, null);
});

// --- breakOnXhrInObservation ---

test('breakOnXhrInObservation sets XHR breakpoint and stores it', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });

  const result = await breakOnXhrInObservation(observation, 'api/users');

  assert.equal(result.type, 'xhr');
  assert.equal(result.query, 'api/users');
  assert.equal(result.id, 'xhr-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DOMDebugger.setXHRBreakpoint');
  assert.equal(calls[0].params.url, 'api/users');
  assert.equal(observation.breakpoints.get('xhr-1'), result);
  assert.equal(observation.nextBreakpointId, 2);
});

// --- removeStoredBreakpoint ---

test('removeStoredBreakpoint throws when breakpoint not found', async () => {
  const observation = observationWithCdp(async () => {});

  await assert.rejects(
    () => removeStoredBreakpoint(observation, 'nonexistent'),
    { message: 'Breakpoint not found: nonexistent' },
  );
});

test('removeStoredBreakpoint removes text breakpoint via CDP', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });
  observation.breakpoints.set('bp-1', {
    id: 'bp-1',
    type: 'text',
    query: 'searchText',
    scriptId: 'script-1',
    url: 'app.js',
    lineNumber: 10,
    columnNumber: 5,
    cdpBreakpointId: 'cdp-bp-1',
  });

  const result = await removeStoredBreakpoint(observation, 'bp-1');

  assert.deepEqual(result, { removed: true, id: 'bp-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Debugger.removeBreakpoint');
  assert.equal(calls[0].params.breakpointId, 'cdp-bp-1');
  assert.equal(observation.breakpoints.has('bp-1'), false);
});

test('removeStoredBreakpoint removes xhr breakpoint via CDP', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
  });
  observation.breakpoints.set('xhr-1', {
    id: 'xhr-1',
    type: 'xhr',
    query: 'api/users',
  });

  const result = await removeStoredBreakpoint(observation, 'xhr-1');

  assert.deepEqual(result, { removed: true, id: 'xhr-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DOMDebugger.removeXHRBreakpoint');
  assert.equal(calls[0].params.url, 'api/users');
  assert.equal(observation.breakpoints.has('xhr-1'), false);
});

// --- pausedInfoFromObservation ---

test('pausedInfoFromObservation returns null when not paused', async () => {
  const observation = observationWithCdp(async () => {});

  const result = await pausedInfoFromObservation(observation);

  assert.equal(result, null);
});

test('pausedInfoFromObservation returns structured info when paused', async () => {
  const calls = [];
  const observation = observationWithCdp(async (method, params) => {
    calls.push({ method, params });
    if (method === 'Debugger.getScriptSource') {
      return { scriptSource: '  const x = 1;\n  debugger;\n  const y = 2;\n' };
    }
    return {};
  });
  observation.scripts.set('script-1', {
    scriptId: 'script-1',
    url: 'app.js',
    startLine: 0,
    startColumn: 0,
    endLine: 100,
    endColumn: 0,
    executionContextId: 1,
    hash: 'abc',
  });
  observation.paused = {
    reason: 'breakpoint',
    hitBreakpoints: ['bp-1'],
    callFrames: [{
      callFrameId: 'cf-1',
      functionName: 'handler',
      location: { scriptId: 'script-1', lineNumber: 1, columnNumber: 2 },
      url: 'app.js',
    }],
  };

  const result = await pausedInfoFromObservation(observation);

  assert.ok(result);
  assert.equal(result.reason, 'breakpoint');
  assert.deepEqual(result.hitBreakpoints, ['bp-1']);
  assert.equal(result.callFrames.length, 1);
  assert.equal(result.callFrames[0].callFrameId, 'cf-1');
  assert.equal(result.callFrames[0].functionName, 'handler');
  assert.equal(result.callFrames[0].url, 'app.js');
  assert.equal(result.callFrames[0].lineNumber, 1);
  assert.equal(result.callFrames[0].columnNumber, 2);
  // source line should be at lineNumber 1, which is "  debugger;" in the mock source
  assert.equal(result.callFrames[0].source.lineNumber, 1);
  assert.equal(result.callFrames[0].source.text, '  debugger;');
});
