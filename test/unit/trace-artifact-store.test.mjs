import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SiteflowError } from '../../dist/shared/errors.js';

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteflow-traces-'));
  process.env.SITEFLOW_HOME = dir;
  return dir;
}

test('redacts sensitive command arguments before persisting failure receipts', async () => {
  const home = tempHome();
  const {
    redactCommandArgs,
    writeFailureReceipt,
  } = await import('../../dist/traces/artifact-store.js');
  const command = [
    'siteflow',
    'auth',
    '--token',
    'raw-token',
    '--cookie=raw-cookie',
    'https://example.com/path?token=raw-url-token&q=visible',
    '--name',
    'visible-name',
  ];

  assert.deepEqual(redactCommandArgs(command), [
    'siteflow',
    'auth',
    '--token',
    '[REDACTED]',
    '--cookie=[REDACTED]',
    'https://example.com/path?token=%5BREDACTED%5D&q=visible',
    '--name',
    'visible-name',
  ]);

  const result = writeFailureReceipt('default', command, new SiteflowError('TEST_ERROR', 'failed'));
  assert.notEqual(result, null);
  const receiptText = fs.readFileSync(result.receiptPath, 'utf8');
  const summaryText = fs.readFileSync(path.join(path.dirname(result.receiptPath), 'summary.md'), 'utf8');

  for (const text of [receiptText, summaryText]) {
    assert.equal(text.includes('raw-token'), false);
    assert.equal(text.includes('raw-cookie'), false);
    assert.equal(text.includes('raw-url-token'), false);
    assert.equal(text.includes('visible-name'), true);
  }

  fs.rmSync(home, { recursive: true, force: true });
});

test('rejects path traversal trace ids', async () => {
  const home = tempHome();
  const { getTraceReceipt } = await import('../../dist/traces/artifact-store.js');

  assert.throws(
    () => getTraceReceipt('default', '../x'),
    error => error instanceof SiteflowError && error.code === 'TRACE_NOT_FOUND',
  );

  fs.rmSync(home, { recursive: true, force: true });
});

test('skips corrupt trace receipts and malformed event lines', async () => {
  const home = tempHome();
  const {
    appendTraceEvent,
    listTraceEvents,
    listTraceReceipts,
    writeFailureReceipt,
  } = await import('../../dist/traces/artifact-store.js');

  const valid = writeFailureReceipt('default', ['siteflow', 'ok'], new SiteflowError('OK', 'valid'));
  assert.notEqual(valid, null);

  const tracesRoot = path.join(home, 'profiles', 'default', 'traces');
  const corruptDir = path.join(tracesRoot, '20260605T120000-1a2b3c4d');
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, 'receipt.json'), '{not json\n');
  const incompleteDir = path.join(tracesRoot, '20260605T120001-1a2b3c4d');
  fs.mkdirSync(incompleteDir, { recursive: true });
  fs.writeFileSync(path.join(incompleteDir, 'receipt.json'), JSON.stringify({ traceId: 'missing-createdAt' }));

  const receipts = listTraceReceipts('default');
  assert.deepEqual(receipts.map(receipt => receipt.traceId), [valid.traceId]);

  appendTraceEvent('default', 'valid.event', { ok: true });
  fs.appendFileSync(path.join(tracesRoot, 'events.jsonl'), '{not json\n');
  fs.appendFileSync(path.join(tracesRoot, 'events.jsonl'), `${JSON.stringify({ ts: '2026-06-05T00:00:00.000Z', type: 'manual.event', profile: 'default', data: {} })}\n`);

  const events = listTraceEvents('default');
  assert.deepEqual(events.map(event => event.type), ['valid.event', 'manual.event']);

  fs.rmSync(home, { recursive: true, force: true });
});
