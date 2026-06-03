export type JsonObject = Record<string, unknown>;

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  data: T;
  meta: JsonObject;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    receipt?: string;
  };
  meta: JsonObject;
}

export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export interface DaemonInfo {
  pid: number;
  port: number;
  profile: string;
  startedAt: string;
  baseUrl: string;
}

export interface PageInfo {
  id: number;
  url: string;
  title: string;
  selected: boolean;
}

export interface BrowserElementTarget {
  pageId?: number;
  selector?: string;
  text?: string;
  aria?: string;
  exact?: boolean;
  nth?: number;
  includeHidden?: boolean;
}

export interface BrowserClickOptions extends BrowserElementTarget {
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  force?: boolean;
  clickableParent?: boolean;
  expectUrlContains?: string;
  expectText?: string;
  expectSelector?: string;
  timeoutMs?: number;
}

export interface BrowserTypeOptions extends BrowserElementTarget {
  value: string;
  clear?: boolean;
  pressEnter?: boolean;
  timeoutMs?: number;
}

export interface BrowserUploadOptions extends BrowserElementTarget {
  files: string[];
  timeoutMs?: number;
}

export interface BrowserSelectOptions {
  pageId?: number;
  selector?: string;
  comboboxText?: string;
  option: string;
  exact?: boolean;
  force?: boolean;
  verify?: boolean;
  timeoutMs?: number;
}

export interface BrowserActionResult {
  action: 'click' | 'type' | 'select' | 'upload';
  page: PageInfo;
  target: string;
  text?: string;
  files?: string[];
  url: string;
}

export interface BrowserScreenshotResult {
  page: PageInfo;
  mimeType: 'image/png';
  bytes: number;
  base64: string;
}

export interface BrowserTargetCandidate {
  index: number;
  tag: string;
  role?: string | null;
  text: string;
  aria?: string | null;
  id?: string;
  className?: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
  topElement?: {
    tag: string;
    role?: string | null;
    text: string;
    id?: string;
    className?: string;
  } | null;
  clickableParent?: {
    tag: string;
    role?: string | null;
    text: string;
    id?: string;
    className?: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null;
}

export interface BrowserInspectResult {
  page: PageInfo;
  target: string;
  candidates: BrowserTargetCandidate[];
}

export interface ScriptInfo {
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

export interface ScriptSearchMatch {
  scriptId: string;
  url: string;
  lineNumber: number;
  line: string;
}

export interface ConsoleEntry {
  id: number;
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  ts: string;
}

export interface NetworkEntry {
  id: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  failure?: string;
  startedAt: string;
  finishedAt?: string;
  requestBody?: BodySummary;
  responseBody?: BodySummary;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface BodySummary {
  available: boolean;
  bytes?: number;
  truncated?: boolean;
  encoding?: 'utf8' | 'base64';
  error?: string;
}

export interface NetworkBody {
  id: number;
  url: string;
  method: string;
  part: 'request' | 'response';
  contentType?: string;
  status?: number;
  bytes: number;
  truncated: boolean;
  encoding: 'utf8' | 'base64';
  body: string;
}

export interface RequestCurl {
  id: number;
  command: string;
  redacted: boolean;
}

export interface RequestReplayResult {
  id: number;
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: BodySummary & { body?: string };
}

export interface HookInfo {
  name: 'fetch' | 'xhr' | 'crypto';
  installed: boolean;
  note: string;
}

export interface AuthStatus {
  mode: 'none' | 'dedicated-profile' | 'cdp-attach';
  browserUrl?: string;
  cookieCount: number;
  note: string;
}

export interface RedactedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CookieExportResult {
  out: string;
  count: number;
  domains: string[];
  warning: string;
}

export interface CookieImportResult {
  imported: boolean;
  count: number;
  domains: string[];
  source: string;
  note: string;
}

export interface StorageSnapshot {
  url: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface SavedState {
  version: 1;
  savedAt: string;
  pages: Array<{ url: string; selected: boolean }>;
  cookies?: RedactedCookie[];
  includeCookies: boolean;
}

export interface BreakpointInfo {
  id: string;
  type: 'text' | 'xhr';
  query: string;
  scriptId?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  cdpBreakpointId?: string;
}

export interface PausedInfo {
  reason: string;
  data?: unknown;
  hitBreakpoints: string[];
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    source?: {
      lineNumber: number;
      text: string;
    };
    snippet?: Array<{
      lineNumber: number;
      text: string;
    }>;
  }>;
}

export interface TraceReceipt {
  traceId: string;
  status: 'failure';
  profile: string;
  command: string[];
  error: {
    code: string;
    message: string;
    hint?: string;
  };
  createdAt: string;
  receiptPath: string;
}

export interface TraceEvent {
  ts: string;
  type: string;
  profile: string;
  data: Record<string, unknown>;
  replay?: TraceReplayStep;
}

export interface TraceReplayStep {
  command: string;
  args: Record<string, unknown>;
}
