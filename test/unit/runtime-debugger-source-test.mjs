import test from 'node:test';
import assert from 'node:assert/strict';
import { getScriptSource } from '../../dist/runtime/debugger-source.js';

function mockCdp(sendResult) {
  return { send: sendResult };
}

test('getScriptSource returns source from CDP result', async () => {
  const cdp = mockCdp(async () => ({ scriptSource: 'console.log("hello");' }));
  const source = await getScriptSource(cdp, 'script-1');
  assert.equal(source, 'console.log("hello");');
});

test('getScriptSource propagates CDP error', async () => {
  const cdp = mockCdp(async () => { throw new Error('CDP failure'); });
  await assert.rejects(
    () => getScriptSource(cdp, 'script-2'),
    /CDP failure/,
  );
});

test('getScriptSource handles missing scriptSource field', async () => {
  const cdp = mockCdp(async () => ({}));
  const source = await getScriptSource(cdp, 'script-3');
  assert.equal(source, undefined);
});
