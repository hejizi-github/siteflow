import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
const SENSITIVE_FIELD = /(?:password|token|secret|api[\s_-]*key|\bkey\b|otp|one[\s_-]*time[\s_-]*code|card|cvv)/i;

function hasSensitiveMarker(value: string | undefined): boolean {
  return typeof value === 'string' && SENSITIVE_FIELD.test(value);
}

function isSensitiveRecordedEvent(event: RecordedEvent): boolean {
  if (event.sensitive === true) return true;
  if (!event.target) return false;
  const semantic = event.target.semantic;
  const structural = event.target.structural;
  return hasSensitiveMarker(semantic?.aria)
    || hasSensitiveMarker(semantic?.label)
    || hasSensitiveMarker(semantic?.placeholder)
    || hasSensitiveMarker(semantic?.text)
    || hasSensitiveMarker(structural?.selector);
}
const stoppedSessions = new WeakSet<RecorderSession>();
const activeRecorderSessions = new WeakMap<Page, RecorderSession | null>();
const pagesWithRecorderBinding = new WeakSet<Page>();
const recorderSessionPages = new WeakMap<RecorderSession, Page>();


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

function hasReplayableContentEditableTarget(target: RecordedTarget): boolean {
  return Boolean(target.structural?.selector || target.semantic?.aria || target.semantic?.label);
}

function hasReplayableTypeTarget(target: RecordedTarget): boolean {
  return Boolean(target.structural?.selector || target.semantic?.aria || target.semantic?.label || target.semantic?.text);
}

function hasSameGeometry(left: RecordedTarget | undefined, right: RecordedTarget): boolean {
  return left?.geometry !== undefined
    && right.geometry !== undefined
    && left.geometry.x === right.geometry.x
    && left.geometry.y === right.geometry.y
    && left.geometry.width === right.geometry.width
    && left.geometry.height === right.geometry.height;
}

function hasSameSelectTarget(left: RecordedTarget | undefined, right: RecordedTarget): boolean {
  return hasSameStructuralSelector(left, right) || (!left?.structural?.selector && !right.structural?.selector && hasSameGeometry(left, right));
}

function hasSameStructuralSelector(left: RecordedTarget | undefined, right: RecordedTarget): boolean {
  return Boolean(left?.structural?.selector && left.structural.selector === right.structural?.selector);
}

function hasSameRecordedTarget(left: RecordedTarget | undefined, right: RecordedTarget): boolean {
  return hasSameStructuralSelector(left, right) || hasSameGeometry(left, right);
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
  let lastSelectTargetKey: string | undefined;
  let lastSelectStep: Extract<WorkflowStep, { type: 'select' }> | undefined;

  for (const event of input.events) {
    if (event.type === 'input' || event.type === 'change') {
      if (!event.target || isSensitiveRecordedEvent(event)) {
        unsupportedEvents += 1;
        lastInputTargetKey = undefined;
        lastInputStep = undefined;
        lastSelectTargetKey = undefined;
        lastSelectStep = undefined;
        continue;
      }

      if (event.control === 'select') {
        const previousSelectClickStep = steps[steps.length - 1];
        if (!event.target.structural?.selector) {
          if (previousSelectClickStep?.type === 'click' && hasSameSelectTarget(previousSelectClickStep.target, event.target)) {
            steps.pop();
          }
          unsupportedEvents += 1;
          lastInputTargetKey = undefined;
          lastInputStep = undefined;
          lastSelectTargetKey = undefined;
          lastSelectStep = undefined;
          continue;
        }
        const key = targetKey(event.target);
        if (previousSelectClickStep?.type === 'click' && hasSameSelectTarget(previousSelectClickStep.target, event.target)) {
          steps.pop();
        }
        const option = event.option ?? event.value ?? '';
        if (lastSelectStep && lastSelectTargetKey === key) {
          lastSelectStep.option = option;
        } else {
          const step: Extract<WorkflowStep, { type: 'select' }> = {
            id: nextStepId(steps),
            type: 'select',
            target: event.target,
            option,
          };
          steps.push(step);
          lastSelectStep = step;
          lastSelectTargetKey = key;
        }
        lastInputTargetKey = undefined;
        lastInputStep = undefined;
        continue;
      }

      if (event.control === 'contenteditable' && !hasReplayableContentEditableTarget(event.target)) {
        unsupportedEvents += 1;
        lastInputTargetKey = undefined;
        lastInputStep = undefined;
        lastSelectTargetKey = undefined;
        lastSelectStep = undefined;
        continue;
      }
      if (event.control !== 'contenteditable' && !hasReplayableTypeTarget(event.target)) {
        unsupportedEvents += 1;
        lastInputTargetKey = undefined;
        lastInputStep = undefined;
        lastSelectTargetKey = undefined;
        lastSelectStep = undefined;
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
      lastSelectTargetKey = undefined;
      lastSelectStep = undefined;
      continue;
    }

    lastInputTargetKey = undefined;
    lastInputStep = undefined;
    lastSelectTargetKey = undefined;
    lastSelectStep = undefined;

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

    if (event.type === 'unsupported') {
      const previousStep = steps[steps.length - 1];
      if (previousStep?.type === 'click' && event.target && hasSameRecordedTarget(previousStep.target, event.target)) {
        steps.pop();
      }
      unsupportedEvents += 1;
      continue;
    }

    if (event.type === 'keydown') {
      if (isSensitiveRecordedEvent(event)) {
        unsupportedEvents += 1;
        continue;
      }
      if (event.key === 'Enter' && (event.control === 'textarea' || event.control === 'contenteditable')) {
        continue;
      }
      if (event.key === 'Enter' && event.control === 'input' && event.target && hasReplayableTypeTarget(event.target)) {
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
    if (type && !isTextLikeInput(element)) return tag + '[type="' + cssEscape(type) + '"]';
    return undefined;
  }

  const SENSITIVE_FIELD = /(?:password|token|secret|api[\\s_-]*key|\\bkey\\b|otp|one[\\s_-]*time[\\s_-]*code|card|cvv)/i;

  function elementFor(rawTarget) {
    return rawTarget && rawTarget.nodeType === Node.ELEMENT_NODE ? rawTarget : rawTarget?.parentElement;
  }

  function labelFor(element) {
    return element.labels && element.labels.length > 0 ? Array.from(element.labels).map((item) => item.innerText || item.textContent || '').join(' ').trim().replace(/\\s+/g, ' ').slice(0, 120) || undefined : undefined;
  }

  function normalizedText(value) {
    return (value || '').trim().replace(/\\s+/g, ' ');
  }

  function selectedOptionTextFor(element) {
    return element instanceof HTMLSelectElement && element.selectedOptions.length > 0
      ? normalizedText(element.selectedOptions[0].innerText || element.selectedOptions[0].textContent || '').slice(0, 120) || undefined
      : undefined;
  }

  function actionInputTextFor(element) {
    if (!(element instanceof HTMLInputElement)) return undefined;
    const type = (element.getAttribute('type') || element.type || 'submit').toLowerCase();
    if (type !== 'submit' && type !== 'button' && type !== 'reset') return undefined;
    return normalizedText(element.value || element.getAttribute('value') || '').slice(0, 120) || undefined;
  }

  function contenteditableValueFor(element) {
    const value = typeof element.innerText === 'string' ? element.innerText : element.textContent;
    return typeof value === 'string' ? value : '';
  }

  function hasSensitiveMarker(value) {
    return typeof value === 'string' && SENSITIVE_FIELD.test(value);
  }

  function isSensitiveControl(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element instanceof HTMLInputElement && element.type === 'password') return true;
    return hasSensitiveMarker(element.getAttribute('name'))
      || hasSensitiveMarker(element.id)
      || hasSensitiveMarker(element.getAttribute('autocomplete'))
      || hasSensitiveMarker(element.getAttribute('aria-label'))
      || hasSensitiveMarker(labelFor(element))
      || hasSensitiveMarker(element.getAttribute('placeholder'));
  }

  function isTextLikeInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const type = (element.getAttribute('type') || element.type || 'text').toLowerCase();
    return type === 'text'
      || type === 'search'
      || type === 'email'
      || type === 'url'
      || type === 'tel'
      || type === 'number'
      || type === 'password';
  }


  function editableAncestorFor(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.isContentEditable) return element;
    const editable = element.closest('[contenteditable]');
    return editable && editable.getAttribute('contenteditable') !== 'false' ? editable : undefined;
  }

  function controlInfoFor(rawTarget) {
    const element = elementFor(rawTarget);
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return {};
    if (element instanceof HTMLSelectElement) {
      const option = selectedOptionTextFor(element);
      return { element, control: 'select', option, sensitive: isSensitiveControl(element) };
    }
    if (element instanceof HTMLTextAreaElement) return { element, control: 'textarea', sensitive: isSensitiveControl(element) };
    if (element instanceof HTMLInputElement) {
      const type = (element.getAttribute('type') || element.type || 'text').toLowerCase();
      if (!isTextLikeInput(element) && type !== 'submit' && type !== 'button' && type !== 'reset') return { element, unsupported: true, sensitive: isSensitiveControl(element) };
      if (!isTextLikeInput(element)) return { element, sensitive: isSensitiveControl(element) };
      return { element, control: 'input', sensitive: isSensitiveControl(element) };
    }
    const editable = editableAncestorFor(element);
    if (editable) return { element: editable, control: 'contenteditable', sensitive: isSensitiveControl(editable) };
    return { element, sensitive: isSensitiveControl(element) };
  }

  function targetFor(rawTarget, control) {
    const element = elementFor(rawTarget);
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    const rect = element.getBoundingClientRect();
    const selector = selectorFor(element);
    const selectedOptionText = control === 'select' && !selector ? selectedOptionTextFor(element) : undefined;
    const text = control ? selectedOptionText : actionInputTextFor(element) || normalizedText(element.innerText || element.textContent || '').slice(0, 120) || undefined;
    const aria = element.getAttribute('aria-label') || undefined;
    const label = labelFor(element);
    return {
      semantic: {
        ...(aria ? { aria } : {}),
        ...(label ? { label } : {}),
        ...(text ? { text } : {}),
      },
      structural: {
        ...(selector ? { selector } : {}),
      },
      geometry: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      },
      confidence: selector || aria || label || text ? 'high' : 'low',
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
    if (!payload || typeof payload.type !== 'string') return undefined;
    if (typeof window.__siteflowRecordEvent === 'function') {
      return window.__siteflowRecordEvent(payload).catch(() => {});
    }
    return undefined;
  }

  document.addEventListener('click', (event) => {
    const info = controlInfoFor(event.target);
    record(basePayload(info.unsupported ? 'unsupported' : 'click', targetFor(info.element || event.target)));
  }, true);

  function recordValueEvent(event) {
    const info = controlInfoFor(event.target);
    if (info.unsupported) {
      record(basePayload('unsupported', targetFor(info.element || event.target)));
      return;
    }
    const target = targetFor(info.element || event.target, info.control);
    const value = info.control === 'contenteditable' && info.element
      ? contenteditableValueFor(info.element)
      : (typeof info.element?.value === 'string' ? info.element.value : '');
    const payload = {
      ...basePayload(event.type, target),
      ...(info.control ? { control: info.control } : {}),
      ...(info.option ? { option: info.option } : {}),
      ...(info.sensitive ? { sensitive: true } : { value }),
    };
    record(payload);
  }

  document.addEventListener('input', recordValueEvent, true);
  document.addEventListener('change', recordValueEvent, true);

  document.addEventListener('keydown', (event) => {
    if (!CONTROL_KEYS.has(event.key)) return;
    const info = controlInfoFor(event.target);
    if (info.unsupported) {
      record(basePayload('unsupported', targetFor(info.element || event.target)));
      return;
    }
    if (event.key === 'Enter' && (info.control === 'textarea' || info.control === 'contenteditable')) return;
    record({
      ...basePayload('keydown', targetFor(info.element || event.target, info.control)),
      key: event.key,
      ...(info.control ? { control: info.control } : {}),
      ...(info.sensitive ? { sensitive: true } : {}),
    });
  }, true);


  function flushPendingScroll() {
    if (scrollTimer === undefined) return undefined;
    window.clearTimeout(scrollTimer);
    scrollTimer = undefined;
    const deltaX = scrollDeltaX;
    const deltaY = scrollDeltaY;
    scrollDeltaX = 0;
    scrollDeltaY = 0;
    if (deltaX === 0 && deltaY === 0) return undefined;
    return record({ ...basePayload('scroll'), deltaX, deltaY });
  }

  window.__siteflowFlushRecorder = flushPendingScroll;

  window.addEventListener('scroll', () => {
    const nextX = window.scrollX;
    const nextY = window.scrollY;
    scrollDeltaX += nextX - lastScrollX;
    scrollDeltaY += nextY - lastScrollY;
    lastScrollX = nextX;
    lastScrollY = nextY;
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      flushPendingScroll();
    }, 150);
  }, { passive: true });
})();`;
}

function isRecordedEvent(value: unknown): value is RecordedEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Partial<RecordedEvent>;
  return (event.type === 'click' || event.type === 'input' || event.type === 'change' || event.type === 'scroll' || event.type === 'keydown' || event.type === 'unsupported')
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

  if (!pagesWithRecorderBinding.has(page)) {
    await page.exposeBinding('__siteflowRecordEvent', (_source, event: unknown) => {
      const activeSession = activeRecorderSessions.get(page);
      if (activeSession && !stoppedSessions.has(activeSession) && isRecordedEvent(event)) activeSession.events.push(event);
    });
    pagesWithRecorderBinding.add(page);
  }
  activeRecorderSessions.set(page, session);
  recorderSessionPages.set(session, page);
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
  const page = recorderSessionPages.get(session);
  if (page && activeRecorderSessions.get(page) === session) {
    try {
      await page.evaluate(() => (globalThis.window as typeof globalThis.window & { __siteflowFlushRecorder?: () => unknown }).__siteflowFlushRecorder?.());
    } catch {
      // The page may already be closed or navigated away; stopping should still serialize captured events.
    }
  }
  stoppedSessions.add(session);
  if (page && activeRecorderSessions.get(page) === session) activeRecorderSessions.set(page, null);
  recorderSessionPages.delete(session);
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

  await mkdir(dirname(session.out), { recursive: true });

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
