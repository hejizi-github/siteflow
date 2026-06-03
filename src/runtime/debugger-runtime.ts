import type { Page } from 'playwright';
import type { BreakpointInfo, PausedInfo, ScriptInfo } from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';
import { getScriptSnippet, getScriptSource } from './debugger-source.js';
import type { DebuggerPausedEvent, PageObservation } from './page-observation.js';

interface ScriptParsedEvent {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  isModule?: boolean;
  sourceMapURL?: string;
}

export async function ensureDebuggerReady(page: Page, observation: PageObservation): Promise<PageObservation> {
  if (!observation.cdp) {
    observation.cdp = await page.context().newCDPSession(page);
  }
  if (observation.debuggerEnabled) return observation;

  observation.cdp.on('Debugger.scriptParsed', (event: ScriptParsedEvent) => {
    observation.scripts.set(event.scriptId, {
      scriptId: event.scriptId,
      url: event.url || '',
      startLine: event.startLine,
      startColumn: event.startColumn,
      endLine: event.endLine,
      endColumn: event.endColumn,
      executionContextId: event.executionContextId,
      hash: event.hash,
      isModule: event.isModule,
      sourceMapURL: event.sourceMapURL,
    });
  });
  observation.cdp.on('Debugger.paused', (event: DebuggerPausedEvent) => {
    observation.paused = event;
  });
  observation.cdp.on('Debugger.resumed', () => {
    observation.paused = null;
  });
  await observation.cdp.send('Debugger.enable');
  await observation.cdp.send('Runtime.enable');
  observation.debuggerEnabled = true;
  return observation;
}

export async function breakOnTextInObservation(
  observation: PageObservation,
  query: string,
  scriptUrl: string | undefined,
): Promise<BreakpointInfo[]> {
  const created: BreakpointInfo[] = [];
  const scripts = [...observation.scripts.values()];

  for (const script of scripts) {
    if (scriptUrl && !script.url.includes(scriptUrl)) continue;
    let source: string;
    try {
      source = await getScriptSource(observation.cdp!, script.scriptId);
    } catch {
      continue;
    }
    const lines = source.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const columnIndex = lines[lineIndex].indexOf(query);
      if (columnIndex === -1) continue;
      const response = await observation.cdp!.send('Debugger.setBreakpoint', {
        location: {
          scriptId: script.scriptId,
          lineNumber: script.startLine + lineIndex,
          columnNumber: Math.max(0, columnIndex),
        },
      }) as { breakpointId: string; actualLocation: { scriptId: string; lineNumber: number; columnNumber: number } };
      const id = `bp-${observation.nextBreakpointId++}`;
      const breakpoint: BreakpointInfo = {
        id,
        type: 'text',
        query,
        scriptId: response.actualLocation.scriptId,
        url: script.url,
        lineNumber: response.actualLocation.lineNumber,
        columnNumber: response.actualLocation.columnNumber,
        cdpBreakpointId: response.breakpointId,
      };
      observation.breakpoints.set(id, breakpoint);
      created.push(breakpoint);
      break;
    }
  }

  if (created.length === 0) {
    throw new SiteflowError('TEXT_NOT_FOUND', `No loaded script text matched: ${query}`);
  }
  return created;
}

export async function breakOnXhrInObservation(observation: PageObservation, urlSubstring: string): Promise<BreakpointInfo> {
  await observation.cdp!.send('DOMDebugger.setXHRBreakpoint', { url: urlSubstring });
  const id = `xhr-${observation.nextBreakpointId++}`;
  const breakpoint: BreakpointInfo = {
    id,
    type: 'xhr',
    query: urlSubstring,
  };
  observation.breakpoints.set(id, breakpoint);
  return breakpoint;
}

export async function removeStoredBreakpoint(observation: PageObservation, id: string): Promise<{ removed: boolean; id: string }> {
  const breakpoint = observation.breakpoints.get(id);
  if (!breakpoint) throw new SiteflowError('BREAKPOINT_NOT_FOUND', `Breakpoint not found: ${id}`);
  if (breakpoint.type === 'text' && breakpoint.cdpBreakpointId) {
    await observation.cdp!.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.cdpBreakpointId });
  } else if (breakpoint.type === 'xhr') {
    await observation.cdp!.send('DOMDebugger.removeXHRBreakpoint', { url: breakpoint.query });
  }
  observation.breakpoints.delete(id);
  return { removed: true, id };
}

export async function pausedInfoFromObservation(observation: PageObservation): Promise<PausedInfo | null> {
  if (!observation.paused) return null;
  const event = observation.paused;
  return {
    reason: event.reason,
    data: event.data,
    hitBreakpoints: event.hitBreakpoints || [],
    callFrames: await Promise.all(event.callFrames.map(async frame => {
      const script = observation.scripts.get(frame.location.scriptId);
      const snippet = await getScriptSnippet(observation.cdp, script, frame.location.scriptId, frame.location.lineNumber);
      const source = snippet.find(line => line.lineNumber === frame.location.lineNumber);
      return {
        callFrameId: frame.callFrameId,
        functionName: frame.functionName,
        scriptId: frame.location.scriptId,
        url: frame.url || script?.url || '',
        lineNumber: frame.location.lineNumber,
        columnNumber: frame.location.columnNumber ?? 0,
        ...(source ? { source } : {}),
        ...(snippet.length > 0 ? { snippet } : {}),
      };
    })),
  };
}

export async function resumeDebugger(observation: PageObservation): Promise<{ resumed: boolean }> {
  await observation.cdp!.send('Debugger.resume');
  observation.paused = null;
  return { resumed: true };
}

export async function stepDebugger(observation: PageObservation, kind: 'into' | 'over' | 'out'): Promise<{ step: string }> {
  const method = kind === 'into'
    ? 'Debugger.stepInto'
    : kind === 'over'
      ? 'Debugger.stepOver'
      : 'Debugger.stepOut';
  await observation.cdp!.send(method as 'Debugger.stepInto');
  return { step: kind };
}

function shouldEvaluateOnPausedFrame(paused: DebuggerPausedEvent): boolean {
  return paused.reason === 'XHR' || Boolean(paused.hitBreakpoints?.length);
}

export async function evaluateDebuggerExpression(observation: PageObservation, expression: string): Promise<unknown> {
  const paused = observation.paused;
  const callFrameId = paused?.callFrames[0]?.callFrameId;
  if (paused && callFrameId && shouldEvaluateOnPausedFrame(paused)) {
    const params = {
      callFrameId,
      expression,
      returnByValue: true,
      silent: false,
      awaitPromise: true,
    };
    const result = await observation.cdp!.send('Debugger.evaluateOnCallFrame', params) as { result: { value?: unknown; description?: string; type: string }; exceptionDetails?: unknown };
    if (result.exceptionDetails) return { exceptionDetails: result.exceptionDetails };
    return result.result.value ?? result.result.description ?? null;
  }

  if (paused) {
    await observation.cdp!.send('Debugger.resume').catch(() => undefined);
    observation.paused = null;
  }

  const skipPausesForRuntime = Boolean(paused) || /^\s*\(?\s*async\b/.test(expression) || /\bfetch\s*\(/.test(expression);
  if (skipPausesForRuntime) await observation.cdp!.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => undefined);
  try {
    const result = await observation.cdp!.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result: { value?: unknown; description?: string; type: string }; exceptionDetails?: unknown };
    if (result.exceptionDetails) return { exceptionDetails: result.exceptionDetails };
    return result.result.value ?? result.result.description ?? null;
  } finally {
    if (skipPausesForRuntime) await observation.cdp!.send('Debugger.setSkipAllPauses', { skip: false }).catch(() => undefined);
  }
}
