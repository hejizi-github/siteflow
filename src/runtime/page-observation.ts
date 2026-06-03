import type { CDPSession, Request } from 'playwright';
import type { BodySummary, BreakpointInfo, ConsoleEntry, HookInfo, NetworkEntry, ScriptInfo } from '../shared/types.js';

export interface CapturedBody {
  contentType?: string;
  bytes: number;
  truncated: boolean;
  encoding: 'utf8' | 'base64';
  body: string;
  error?: string;
}

export interface NetworkDetails {
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
}

export interface DebuggerPausedEvent {
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    location: { scriptId: string; lineNumber: number; columnNumber?: number };
    url: string;
  }>;
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
}

export interface PageObservation {
  cdp?: CDPSession;
  debuggerEnabled: boolean;
  scripts: Map<string, ScriptInfo>;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  networkBodies: Map<number, { request?: CapturedBody; response?: CapturedBody }>;
  networkDetails: Map<number, NetworkDetails>;
  requestIds: WeakMap<Request, number>;
  hooks: Set<HookInfo['name']>;
  breakpoints: Map<string, BreakpointInfo>;
  paused: DebuggerPausedEvent | null;
  nextConsoleId: number;
  nextNetworkId: number;
  nextBreakpointId: number;
}

export function createPageObservation(): PageObservation {
  return {
    debuggerEnabled: false,
    scripts: new Map(),
    console: [],
    network: [],
    networkBodies: new Map(),
    networkDetails: new Map(),
    requestIds: new WeakMap(),
    hooks: new Set(),
    breakpoints: new Map(),
    paused: null,
    nextConsoleId: 1,
    nextNetworkId: 1,
    nextBreakpointId: 1,
  };
}

export function toBodySummary(body: CapturedBody): BodySummary {
  return {
    available: !body.error,
    bytes: body.bytes,
    truncated: body.truncated,
    encoding: body.encoding,
    ...(body.error ? { error: body.error } : {}),
  };
}
