import test from 'node:test';
import assert from 'node:assert/strict';

import { createPageObservation } from '../../dist/runtime/page-observation.js';
import { pruneNetworkObservation, redactHeaders } from '../../dist/runtime/network-recorder.js';

function makeEntry(id) {
  return {
    id,
    method: 'GET',
    url: `https://example.com/${id}`,
    resourceType: 'xhr',
    startedAt: new Date(0).toISOString(),
  };
}

test('pruneNetworkObservation keeps network entries and maps in sync', () => {
  const observation = createPageObservation();

  for (let id = 1; id <= 2001; id += 1) {
    observation.network.push(makeEntry(id));
    observation.networkBodies.set(id, { response: { bytes: id, truncated: false, encoding: 'utf8', body: `body-${id}` } });
    observation.networkDetails.set(id, { requestHeaders: { 'x-id': String(id) } });
  }

  pruneNetworkObservation(observation);

  assert.equal(observation.network.length, 2000);
  assert.equal(observation.network[0].id, 2);
  assert.equal(observation.network.at(-1).id, 2001);
  assert.equal(observation.networkBodies.has(1), false);
  assert.equal(observation.networkDetails.has(1), false);
  assert.equal(observation.networkBodies.get(2)?.response?.body, 'body-2');
  assert.deepEqual(observation.networkDetails.get(2001), { requestHeaders: { 'x-id': '2001' } });
});

test('redactHeaders hides sensitive values and preserves safe ones', () => {
  const headers = redactHeaders({
    authorization: 'Bearer secret-token',
    cookie: 'session=abc',
    'x-api-token': 'xyz',
    accept: 'application/json',
  });

  assert.deepEqual(headers, {
    authorization: '[REDACTED:19]',
    cookie: '[REDACTED:11]',
    'x-api-token': '[REDACTED:3]',
    accept: 'application/json',
  });
});
