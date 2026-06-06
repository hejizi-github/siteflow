import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageObservation } from '../../dist/runtime/page-observation.js';
import { captureBufferBody, captureTextBody, MAX_CAPTURED_BODY_BYTES, pruneNetworkObservation, redactHeaders } from '../../dist/runtime/network-recorder.js';

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


test('captureTextBody returns null for empty string', () => {
  assert.equal(captureTextBody(''), null);
  assert.equal(captureTextBody('', 'text/plain'), null);
});

test('captureTextBody wraps text in utf-8 CapturedBody', () => {
  const body = captureTextBody('hello world', 'text/plain');
  assert.deepEqual(body, {
    contentType: 'text/plain',
    bytes: 11,
    truncated: false,
    encoding: 'utf8',
    body: 'hello world',
  });
});

test('captureBufferBody encodes text content as utf-8', () => {
  const body = captureBufferBody(Buffer.from('{"key":"value"}'), 'application/json');
  assert.equal(body.contentType, 'application/json');
  assert.equal(body.bytes, 15);
  assert.equal(body.truncated, false);
  assert.equal(body.encoding, 'utf8');
  assert.equal(body.body, '{"key":"value"}');
});

test('captureBufferBody encodes binary content as base64', () => {
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
  const body = captureBufferBody(binary, 'application/octet-stream');
  assert.equal(body.contentType, 'application/octet-stream');
  assert.equal(body.bytes, 4);
  assert.equal(body.truncated, false);
  assert.equal(body.encoding, 'base64');
  assert.equal(body.body, binary.toString('base64'));
});

test('captureBufferBody detects binary without content type', () => {
  const binary = Buffer.from([0x48, 0x00, 0x4C]);  // H\x00L - null byte signals binary
  const body = captureBufferBody(binary);
  assert.equal(body.contentType, undefined);
  assert.equal(body.encoding, 'base64');
});

test('captureBufferBody truncates large bodies', () => {
  const largeBuffer = Buffer.alloc(MAX_CAPTURED_BODY_BYTES + 100, 0x41);
  const body = captureBufferBody(largeBuffer, 'text/html');
  assert.equal(body.bytes, MAX_CAPTURED_BODY_BYTES + 100);
  assert.equal(body.truncated, true);
  assert.equal(body.body.length, MAX_CAPTURED_BODY_BYTES);
});

test('captureBufferBody preserves contentType for non-text xml', () => {
  const body = captureBufferBody(Buffer.from('<root/>'), 'application/xml');
  assert.equal(body.contentType, 'application/xml');
  assert.equal(body.encoding, 'utf8');
  assert.equal(body.body, '<root/>');
});

test('redactHeaders redacts proxy-authorization and token-containing headers', () => {
  const headers = redactHeaders({
    'proxy-authorization': 'Basic dXNlcjpwYXNz',
    'x-csrf-token': 'abc123',
    'x-my-secret': 'shhh',
    'content-type': 'application/json',
  });
  assert.deepEqual(headers, {
    'proxy-authorization': '[REDACTED:18]',
    'x-csrf-token': '[REDACTED:6]',
    'x-my-secret': '[REDACTED:4]',
    'content-type': 'application/json',
  });
});