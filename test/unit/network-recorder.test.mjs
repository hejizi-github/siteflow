import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageObservation } from '../../dist/runtime/page-observation.js';
import { captureBufferBody, captureTextBody, MAX_CAPTURED_BODY_BYTES, pruneNetworkObservation, redactHeaders } from '../../dist/runtime/network-recorder.js';
import { wireNetworkRecorder } from '../../dist/runtime/network-recorder.js';

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

// --- wireNetworkRecorder helpers ---

function mockPage() {
  const handlers = {};
  return {
    handlers,
    on(event, fn) {
      (handlers[event] ??= []).push(fn);
      return this;
    },
    emit(event, ...args) {
      for (const fn of (handlers[event] || [])) fn(...args);
    },
  };
}

function mockRequest(overrides = {}) {
  return {
    url: () => overrides.url ?? 'https://example.com/api',
    method: () => overrides.method ?? 'GET',
    headers: () => overrides.headers ?? {},
    postData: () => overrides.postData ?? '',
    resourceType: () => overrides.resourceType ?? 'xhr',
    failure: () => overrides.failure ?? null,
  };
}

function mockResponse(request, overrides = {}) {
  return {
    request: () => request,
    status: () => overrides.status ?? 200,
    statusText: () => overrides.statusText ?? 'OK',
    headers: () => overrides.headers ?? { 'content-type': 'text/html' },
    body: overrides.body ?? (() => Promise.resolve(Buffer.from('<html></html>'))),
  };
}

// --- wireNetworkRecorder tests ---

test('wireNetworkRecorder attaches request handler', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);
  assert.ok(Array.isArray(page.handlers.request), 'request handler registered');
  assert.equal(page.handlers.request.length, 1);
});

test('wireNetworkRecorder attaches response handler', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);
  assert.ok(Array.isArray(page.handlers.response), 'response handler registered');
  assert.equal(page.handlers.response.length, 1);
});

test('wireNetworkRecorder attaches requestfailed handler', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);
  assert.ok(Array.isArray(page.handlers.requestfailed), 'requestfailed handler registered');
  assert.equal(page.handlers.requestfailed.length, 1);
});

test('request event records observation entry with body', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest({
    url: 'https://example.com/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    postData: '{"user":"test"}',
    resourceType: 'fetch',
  });
  page.emit('request', req);

  assert.equal(observation.network.length, 1);
  const entry = observation.network[0];
  assert.equal(entry.id, 1);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.url, 'https://example.com/login');
  assert.equal(entry.resourceType, 'fetch');
  assert.ok(entry.startedAt);
  assert.deepEqual(entry.requestHeaders, { 'content-type': 'application/json' });
  assert.ok(entry.requestBody?.available);
  assert.equal(entry.requestBody.bytes, 15);

  assert.equal(observation.nextNetworkId, 2);
  assert.ok(observation.networkBodies.has(1));
  assert.equal(observation.networkBodies.get(1).request.body, '{"user":"test"}');
  assert.deepEqual(observation.networkDetails.get(1), {
    requestHeaders: { 'content-type': 'application/json' },
    postData: '{"user":"test"}',
  });
});

test('request event without postData omits body from entry', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest({
    method: 'GET',
    postData: '',
  });
  page.emit('request', req);

  const entry = observation.network[0];
  assert.equal(entry.method, 'GET');
  assert.equal(entry.requestBody, undefined);
  assert.equal(observation.networkBodies.has(1), false);
});

test('response event updates entry with status and headers', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest({ url: 'https://example.com/data' });
  page.emit('request', req);

  const res = mockResponse(req, {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/json', 'x-custom': 'val' },
  });
  page.emit('response', res);

  assert.equal(observation.network.length, 1);
  const entry = observation.network[0];
  assert.equal(entry.status, 201);
  assert.equal(entry.statusText, 'Created');
  assert.equal(entry.contentType, 'application/json');
  assert.ok(entry.finishedAt);
  // sensitive header values are redacted, safe ones preserved
  assert.equal(entry.responseHeaders['x-custom'], 'val');
});

test('response event captures body via async processing', async () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest();
  page.emit('request', req);

  let resolveBody;
  const bodyPromise = new Promise(r => { resolveBody = r; });
  const res = mockResponse(req, {
    headers: { 'content-type': 'text/plain' },
    body: () => bodyPromise,
  });
  page.emit('response', res);
  resolveBody(Buffer.from('hello, world!'));
  await bodyPromise;

  const entry = observation.network[0];
  assert.equal(entry.contentType, 'text/plain');
  assert.ok(entry.responseBody?.available);
  assert.equal(entry.responseBody.bytes, 13);
  assert.equal(observation.networkBodies.get(1).response.body, 'hello, world!');
});

test('response event with body error records error in captured body', async () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest();
  page.emit('request', req);

  const res = mockResponse(req, {
    body: () => Promise.reject(new Error('connection reset')),
  });
  page.emit('response', res);

  // allow microtask execution
  await new Promise(r => setTimeout(r, 10));

  const entry = observation.network[0];
  assert.ok(entry.responseBody);
  assert.equal(entry.responseBody.available, false);
  assert.equal(entry.responseBody.error, 'connection reset');
  assert.equal(observation.networkBodies.get(1).response.error, 'connection reset');
});

test('response event ignores unknown request', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const orphanReq = mockRequest();
  const res = mockResponse(orphanReq);
  page.emit('response', res);

  // no request was stored first, so response should be a no-op
  assert.equal(observation.network.length, 0);
});

test('requestfailed event records failure', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest();
  page.emit('request', req);

  const failedReq = mockRequest({ failure: { errorText: 'net::ERR_CONNECTION_REFUSED' } });
  // The failed request object must be the same object stored in requestIds
  // Since the original mockRequest creates a new object, we need to emit
  // requestfailed with the SAME request object used for the initial request
  page.emit('requestfailed', req);

  const entry = observation.network[0];
  assert.equal(entry.failure, 'request failed');
  assert.ok(entry.finishedAt);
});

test('requestfailed with failure errorText records specific message', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const req = mockRequest();
  page.emit('request', req);

  // Same object — override failure returns to simulate network error
  req.failure = () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED' });
  page.emit('requestfailed', req);

  const entry = observation.network[0];
  assert.equal(entry.failure, 'net::ERR_NAME_NOT_RESOLVED');
});

test('requestfailed event ignores unknown request', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const orphanReq = mockRequest();
  page.emit('requestfailed', orphanReq);

  assert.equal(observation.network.length, 0);
});

test('request body respects MAX_CAPTURED_BODY_BYTES truncation', () => {
  const page = mockPage();
  const observation = createPageObservation();
  wireNetworkRecorder(page, observation);

  const largeBody = 'x'.repeat(MAX_CAPTURED_BODY_BYTES + 100);
  const req = mockRequest({
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    postData: largeBody,
  });
  page.emit('request', req);

  const entry = observation.network[0];
  assert.equal(entry.requestBody.truncated, true);
  assert.equal(entry.requestBody.bytes, MAX_CAPTURED_BODY_BYTES + 100);
  assert.equal(observation.networkBodies.get(1).request.body.length, MAX_CAPTURED_BODY_BYTES);
});