import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import type {
  RecordedEvent,
  RecordedTarget,
  RecorderStartOptions,
  RecorderStatus,
  RecorderStopResult,
  SiteflowWorkflow,
  WorkflowStep,
} from './workflow-types.js';

export interface RecorderSession {
  id: string;
  pageId: number;
  startedAt: string;
  out: string;
  startUrl: string;
  events: RecordedEvent[];
}

const MUTATING_TEXT = /\b(submit|send|publish|save|post|upload)\b/i;
const stoppedSessions = new WeakSet<RecorderSession>();

function nextStepId(steps: WorkflowStep[]): string {
  return `step-${steps.length + 1}`;
}

function targetKey(target: RecordedTarget): string {
  const semantic = target.semantic ?? null;
  const structural = target.structural ?? null;
  if (semantic !== null || structural !== null) return JSON.stringify({ semantic, structural });
  return JSON.stringify({ geometry: target.geometry ?? null });
}

function isMutatingTarget(target: RecordedTarget): boolean {
  const semantic = target.semantic;
  return Boolean(
    (semantic?.text && MUTATING_TEXT.test(semantic.text))
      || (semantic?.aria && MUTATING_TEXT.test(semantic.aria))
      || (semantic?.label && MUTATING_TEXT.test(semantic.label)),
  );
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRecordedEventsWithStats(input: { startUrl: string; events: RecordedEvent[] }): {
  steps: WorkflowStep[];
  unsupportedEvents: number;
} {
  const steps: WorkflowStep[] = [{ id: 'step-1', type: 'open', url: input.startUrl }];
  let unsupportedEvents = 0;
  let lastInputTargetKey: string | undefined;
  let lastInputStep: Extract<WorkflowStep, { type: 'type' }> | undefined;

  for (const event of input.events) {
    if (event.type === 'input' || event.type === 'change') {
      if (!event.target) {
        unsupportedEvents += 1;
        lastInputTargetKey = undefined;
        lastInputStep = undefined;
        continue;
      }

      const key = targetKey(event.target);
      const value = event.value ?? '';
      if (lastInputStep && lastInputTargetKey === key) {
        lastInputStep.value = value;
      } else {
        const step: Extract<WorkflowStep, { type: 'type' }> = {
          id: nextStepId(steps),
          type: 'type',
          target: event.target,
          value,
          clear: true,
        };
        steps.push(step);
        lastInputStep = step;
        lastInputTargetKey = key;
      }
      continue;
    }

    lastInputTargetKey = undefined;
    lastInputStep = undefined;

    if (event.type === 'click') {
      if (!event.target) {
        unsupportedEvents += 1;
        continue;
      }
      const step: Extract<WorkflowStep, { type: 'click' }> = {
        id: nextStepId(steps),
        type: 'click',
        target: event.target,
        ...(isMutatingTarget(event.target) ? { mutating: true } : {}),
      };
      steps.push(step);
      continue;
    }

    if (event.type === 'scroll') {
      steps.push({
        id: nextStepId(steps),
        type: 'scroll',
        deltaX: finiteNumber(event.deltaX, 0),
        deltaY: finiteNumber(event.deltaY, 0),
      });
      continue;
    }

    if (event.type === 'keydown') {
      if (event.key === 'Enter' && event.target) {
        steps.push({
          id: nextStepId(steps),
          type: 'type',
          target: event.target,
          value: '',
          clear: false,
          pressEnter: true,
        });
      } else {
        unsupportedEvents += 1;
      }
    }
  }

  return { steps, unsupportedEvents };
}

export function recorderInjectionSource(): string {
  return `(() => {
  if (window.__siteflowRecorderInstalled === true) return;
  window.__siteflowRecorderInstalled = true;

  const CONTROL_KEYS = new Set(['Enter', 'Escape', 'Tab']);
  let scrollTimer = undefined;
  let scrollDeltaX = 0;
  let scrollDeltaY = 0;
  let lastScrollX = window.scrollX;
  let lastScrollY = window.scrollY;

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function selectorFor(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id) return '#' + cssEscape(element.id);
    const tag = element.localName || element.tagName?.toLowerCase();
    if (!tag) return undefined;
    const name = element.getAttribute('name');
    if (name) return tag + '[name="' + cssEscape(name) + '"]';
    const type = element.getAttribute('type');
    if (type) return tag + '[type="' + cssEscape(type) + '"]';
    return tag;
  }

  function targetFor(rawTarget) {
    const element = rawTarget && rawTarget.nodeType === Node.ELEMENT_NODE ? rawTarget : rawTarget?.parentElement;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    const rect = element.getBoundingClientRect();
    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
    const aria = element.getAttribute('aria-label') || undefined;
    const label = element.labels && element.labels.length > 0 ? Array.from(element.labels).map((item) => item.innerText || item.textContent || '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined : undefined;
    const placeholder = element.getAttribute('placeholder') || undefined;
    const role = element.getAttribute('role') || undefined;
    return {
      semantic: {
        ...(role ? { role } : {}),
        ...(aria ? { aria } : {}),
        ...(label ? { label } : {}),
        ...(text ? { text } : {}),
        ...(placeholder ? { placeholder } : {}),
      },
      structural: {
        ...(selectorFor(element) ? { selector: selectorFor(element) } : {}),
      },
      geometry: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      },
      confidence: selectorFor(element) || aria || label || text ? 'high' : 'low',
    };
  }

  function basePayload(type, target) {
    return {
      ts: new Date().toISOString(),
      type,
      ...(target ? { target } : {}),
      url: window.location.href,
      title: document.title,
    };
  }

  function record(payload) {
    if (!payload || typeof payload.type !== 'string') return;
    if (typeof window.__siteflowRecordEvent === 'function') {
      window.__siteflowRecordEvent(payload).catch(() => {});
    }
  }

  document.addEventListener('click', (event) => {
    record(basePayload('click', targetFor(event.target)));
  }, true);

  function recordValueEvent(event) {
    const target = targetFor(event.target);
    const value = typeof event.target?.value === 'string' ? event.target.value : '';
    record({ ...basePayload(event.type, target), value });
  }

  document.addEventListener('input', recordValueEvent, true);
  document.addEventListener('change', recordValueEvent, true);

  document.addEventListener('keydown', (event) => {
    if (!CONTROL_KEYS.has(event.key)) return;
    record({ ...basePayload('keydown', targetFor(event.target)), key: event.key });
  }, true);

  window.addEventListener('scroll', () => {
    const nextX = window.scrollX;
    const nextY = window.scrollY;
    scrollDeltaX += nextX - lastScrollX;
    scrollDeltaY += nextY - lastScrollY;
    lastScrollX = nextX;
    lastScrollY = nextY;
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      record({ ...basePayload('scroll'), deltaX: scrollDeltaX, deltaY: scrollDeltaY });
      scrollDeltaX = 0;
      scrollDeltaY = 0;
      scrollTimer = undefined;
    }, 150);
  }, { passive: true });
})();`;
}

function isRecordedEvent(value: unknown): value is RecordedEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Partial<RecordedEvent>;
  return (event.type === 'click' || event.type === 'input' || event.type === 'change' || event.type === 'scroll' || event.type === 'keydown')
    && typeof event.ts === 'string'
    && typeof event.url === 'string'
    && typeof event.title === 'string';
}

export function normalizeRecordedEvents(input: { startUrl: string; events: RecordedEvent[] }): WorkflowStep[] {
  return normalizeRecordedEventsWithStats(input).steps;
}

export async function startRecorderSession(page: Page, pageId: number, options: RecorderStartOptions): Promise<RecorderSession> {
  const session: RecorderSession = {
    id: randomUUID(),
    pageId,
    startedAt: new Date().toISOString(),
    out: options.out,
    startUrl: options.url ?? page.url(),
    events: [],
  };

  await page.exposeBinding('__siteflowRecordEvent', (_source, event: unknown) => {
    if (!stoppedSessions.has(session) && isRecordedEvent(event)) session.events.push(event);
  });
  const source = recorderInjectionSource();
  await page.addInitScript(source);
  await page.evaluate(source);
  if (options.url) await page.goto(options.url);

  return session;
}

export function recorderStatus(session: RecorderSession | null): RecorderStatus {
  if (!session || stoppedSessions.has(session)) return { recording: false, events: session?.events.length ?? 0 };
  return {
    recording: true,
    sessionId: session.id,
    pageId: session.pageId,
    startedAt: session.startedAt,
    out: session.out,
    events: session.events.length,
  };
}

export async function stopRecorderSession(session: RecorderSession): Promise<RecorderStopResult> {
  stoppedSessions.add(session);
  const normalized = normalizeRecordedEventsWithStats({ startUrl: session.startUrl, events: session.events });
  const workflow: SiteflowWorkflow = {
    version: 1,
    kind: 'siteflow.workflow',
    createdAt: new Date().toISOString(),
    startUrl: session.startUrl,
    variables: [],
    steps: normalized.steps,
    evidence: {},
  };

  await writeFile(session.out, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

  return {
    workflow,
    out: session.out,
    steps: workflow.steps.length,
    variables: workflow.variables.length,
    mutatingSteps: workflow.steps.filter((step) => step.mutating === true).length,
    unsupportedEvents: normalized.unsupportedEvents,
  };
}
