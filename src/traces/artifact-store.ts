import * as fs from 'node:fs';
import * as path from 'node:path';
import { SiteflowError } from '../shared/errors.js';
import { profileDir } from '../shared/paths.js';
import type { TraceEvent, TraceReceipt, TraceReplayStep } from '../shared/types.js';

interface FailureReceiptResult {
  traceId: string;
  receiptPath: string;
}

function tracesRoot(profile: string): string {
  return path.join(profileDir(profile), 'traces');
}

function ensureTracesRoot(profile: string): string {
  const root = tracesRoot(profile);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function nowIso(): string {
  return new Date().toISOString();
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

function randomId(): string {
  return Math.random().toString(16).slice(2, 10);
}

function traceDir(profile: string, traceId: string): string {
  return path.join(ensureTracesRoot(profile), traceId);
}

function traceEventPath(profile: string): string {
  return path.join(ensureTracesRoot(profile), 'events.jsonl');
}

function appendJsonLine(filePath: string, value: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function appendTraceEvent(profile: string, type: string, data: Record<string, unknown>, replay?: TraceReplayStep): void {
  const event: TraceEvent = {
    ts: nowIso(),
    type,
    profile,
    data,
    ...(replay ? { replay } : {}),
  };
  appendJsonLine(traceEventPath(profile), event);
}

export function writeFailureReceipt(profile: string, command: string[], error: SiteflowError): FailureReceiptResult | null {
  try {
    const traceId = `${timestampSlug()}-${randomId()}`;
    const dir = traceDir(profile, traceId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const receiptPath = path.join(dir, 'receipt.json');
    const receipt: TraceReceipt = {
      traceId,
      status: 'failure',
      profile,
      command,
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
      createdAt: nowIso(),
      receiptPath,
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const summaryPath = path.join(dir, 'summary.md');
    const summary = [
      `# Siteflow Failure Trace ${traceId}`,
      '',
      `- Profile: ${profile}`,
      `- Created at: ${receipt.createdAt}`,
      `- Command: \`${command.join(' ')}\``,
      `- Error: ${error.code} — ${error.message}`,
      error.hint ? `- Hint: ${error.hint}` : '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(summaryPath, `${summary}\n`, { encoding: 'utf8', mode: 0o600 });
    return { traceId, receiptPath };
  } catch {
    return null;
  }
}

export function listTraceReceipts(profile: string): Array<{ traceId: string; createdAt: string; receiptPath: string }> {
  const root = tracesRoot(profile);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const receiptPath = path.join(root, entry.name, 'receipt.json');
      if (!fs.existsSync(receiptPath)) return null;
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as TraceReceipt;
      return { traceId: receipt.traceId, createdAt: receipt.createdAt, receiptPath };
    })
    .filter((item): item is { traceId: string; createdAt: string; receiptPath: string } => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTraceReceipt(profile: string, traceId: string): TraceReceipt {
  const receiptPath = path.join(tracesRoot(profile), traceId, 'receipt.json');
  if (!fs.existsSync(receiptPath)) throw new SiteflowError('TRACE_NOT_FOUND', `Trace receipt not found for ${traceId}`);
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as TraceReceipt;
}

export function listTraceEvents(profile: string, limit = 100): TraceEvent[] {
  const eventsPath = traceEventPath(profile);
  if (!fs.existsSync(eventsPath)) return [];
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-Math.max(1, limit)).map(line => JSON.parse(line) as TraceEvent);
}

export function exportTraceEvents(profile: string, outDir: string): { outDir: string; eventsPath: string; count: number } {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const events = listTraceEvents(profile, Number.MAX_SAFE_INTEGER);
  const eventsPath = path.join(dir, 'trace-events.json');
  fs.writeFileSync(eventsPath, `${JSON.stringify(events, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { outDir: dir, eventsPath, count: events.length };
}
