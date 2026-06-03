import type { Page } from 'playwright';
import type { CapturedBody, PageObservation } from './page-observation.js';
import { toBodySummary } from './page-observation.js';

export const MAX_CAPTURED_BODY_BYTES = 2 * 1024 * 1024;
const MAX_NETWORK_ENTRIES = 2000;

export function wireNetworkRecorder(page: Page, observation: PageObservation): void {
  page.on('request', request => {
    const id = observation.nextNetworkId++;
    observation.requestIds.set(request, id);
    const requestBody = captureTextBody(request.postData() || '', request.headers()['content-type']);
    if (requestBody) observation.networkBodies.set(id, { request: requestBody });
    observation.networkDetails.set(id, {
      requestHeaders: request.headers(),
      postData: request.postData() || undefined,
    });
    observation.network.push({
      id,
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      startedAt: new Date().toISOString(),
      ...(requestBody ? { requestBody: toBodySummary(requestBody) } : {}),
      requestHeaders: redactHeaders(request.headers()),
    });
    pruneNetworkObservation(observation);
  });

  page.on('response', response => {
    const request = response.request();
    const id = observation.requestIds.get(request);
    if (!id) return;
    const entry = observation.network.find(item => item.id === id);
    if (!entry) return;
    entry.status = response.status();
    entry.statusText = response.statusText();
    entry.contentType = response.headers()['content-type'];
    entry.responseHeaders = redactHeaders(response.headers());
    const details = observation.networkDetails.get(id);
    if (details) details.responseHeaders = response.headers();
    entry.finishedAt = new Date().toISOString();
    void response.body()
      .then(buffer => {
        const captured = captureBufferBody(buffer, entry.contentType);
        const existing = observation.networkBodies.get(id) || {};
        observation.networkBodies.set(id, { ...existing, response: captured });
        entry.responseBody = toBodySummary(captured);
      })
      .catch(error => {
        const captured: CapturedBody = {
          bytes: 0,
          truncated: false,
          encoding: 'utf8',
          body: '',
          error: error instanceof Error ? error.message : String(error),
        };
        const existing = observation.networkBodies.get(id) || {};
        observation.networkBodies.set(id, { ...existing, response: captured });
        entry.responseBody = toBodySummary(captured);
      });
  });

  page.on('requestfailed', request => {
    const id = observation.requestIds.get(request);
    if (!id) return;
    const entry = observation.network.find(item => item.id === id);
    if (!entry) return;
    entry.failure = request.failure()?.errorText || 'request failed';
    entry.finishedAt = new Date().toISOString();
  });
}

export function pruneNetworkObservation(observation: PageObservation): void {
  while (observation.network.length > MAX_NETWORK_ENTRIES) {
    const evicted = observation.network.shift();
    if (!evicted) break;
    observation.networkBodies.delete(evicted.id);
    observation.networkDetails.delete(evicted.id);
  }
}

export function captureTextBody(body: string, contentType?: string): CapturedBody | null {
  if (!body) return null;
  return captureBufferBody(Buffer.from(body, 'utf-8'), contentType);
}

export function captureBufferBody(buffer: Buffer, contentType?: string): CapturedBody {
  const truncated = buffer.length > MAX_CAPTURED_BODY_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_CAPTURED_BODY_BYTES) : buffer;
  const textLike = isTextLike(contentType, slice);
  return {
    ...(contentType ? { contentType } : {}),
    bytes: buffer.length,
    truncated,
    encoding: textLike ? 'utf8' : 'base64',
    body: textLike ? slice.toString('utf-8') : slice.toString('base64'),
  };
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = isSensitiveHeader(name) ? `[REDACTED:${value.length}]` : value;
  }
  return redacted;
}

function isTextLike(contentType: string | undefined, buffer: Buffer): boolean {
  const type = (contentType || '').toLowerCase();
  if (type.startsWith('text/') || type.includes('json') || type.includes('javascript') || type.includes('xml') || type.includes('form-urlencoded')) {
    return true;
  }
  if (!type) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    return !sample.includes(0);
  }
  return false;
}

function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'cookie' || lower === 'authorization' || lower === 'proxy-authorization' || lower.includes('token') || lower.includes('secret');
}
