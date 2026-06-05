export type WorkflowStepType = 'open' | 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'screenshot';

export interface WorkflowVariable {
  name: string;
  source: 'input' | 'file' | 'env';
  sensitive: boolean;
  required: boolean;
}

export interface RecordedTarget {
  semantic?: {
    role?: string;
    aria?: string;
    label?: string;
    text?: string;
    placeholder?: string;
  };
  structural?: {
    selector?: string;
    xpath?: string;
    nth?: number;
  };
  geometry?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  confidence: 'high' | 'medium' | 'low';
}

export interface StepEvidence {
  before?: {
    url: string;
    title: string;
    activeElement?: string;
    networkLastId?: number;
  };
  after?: {
    url: string;
    title: string;
    networkLastId?: number;
    visibleTextHash?: string;
  };
  networkIds?: number[];
  consoleIds?: number[];
}

export interface BaseWorkflowStep {
  id: string;
  type: WorkflowStepType;
  label?: string;
  urlBefore?: string;
  urlAfter?: string;
  target?: RecordedTarget;
  evidence?: StepEvidence;
  mutating?: boolean;
}

export interface OpenWorkflowStep extends BaseWorkflowStep {
  type: 'open';
  url: string;
}

export interface ClickWorkflowStep extends BaseWorkflowStep {
  type: 'click';
  target: RecordedTarget;
  button?: 'left' | 'right' | 'middle';
}

export interface TypeWorkflowStep extends BaseWorkflowStep {
  type: 'type';
  target: RecordedTarget;
  value: string;
  clear?: boolean;
  pressEnter?: boolean;
}

export interface SelectWorkflowStep extends BaseWorkflowStep {
  type: 'select';
  target: RecordedTarget;
  option: string;
}

export interface ScrollWorkflowStep extends BaseWorkflowStep {
  type: 'scroll';
  deltaX: number;
  deltaY: number;
}

export interface WaitWorkflowStep extends BaseWorkflowStep {
  type: 'wait';
  ms?: number;
  urlContains?: string;
  text?: string;
  selector?: string;
}

export interface ScreenshotWorkflowStep extends BaseWorkflowStep {
  type: 'screenshot';
  fullPage?: boolean;
}

export type WorkflowStep =
  | OpenWorkflowStep
  | ClickWorkflowStep
  | TypeWorkflowStep
  | SelectWorkflowStep
  | ScrollWorkflowStep
  | WaitWorkflowStep
  | ScreenshotWorkflowStep;

export interface SiteflowWorkflow {
  version: 1;
  kind: 'siteflow.workflow';
  name?: string;
  createdAt: string;
  startUrl: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  evidence: Record<string, unknown>;
}

export interface RecordedEvent {
  ts: string;
  type: 'click' | 'input' | 'change' | 'scroll' | 'keydown' | 'unsupported';
  target?: RecordedTarget;
  value?: string;
  control?: 'input' | 'textarea' | 'select' | 'contenteditable';
  option?: string;
  sensitive?: boolean;
  mutating?: boolean;
  url: string;
  title: string;
  networkLastId?: number;
  consoleLastId?: number;
  key?: string;
  deltaX?: number;
  deltaY?: number;
}

export interface RecorderStartOptions {
  url?: string;
  pageId?: number;
  out: string;
}

export interface RecorderStatus {
  recording: boolean;
  sessionId?: string;
  pageId?: number;
  startedAt?: string;
  out?: string;
  events: number;
}

export interface RecorderStopResult {
  workflow: SiteflowWorkflow;
  out: string;
  steps: number;
  variables: number;
  mutatingSteps: number;
  unsupportedEvents: number;
}

export interface ReplayStepReceipt {
  stepId: string;
  type: WorkflowStepType;
  ok: boolean;
  targetMatchedBy?: string;
  urlBefore?: string;
  urlAfter?: string;
  networkDelta?: number;
  consoleDelta?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface ReplayRunOptions {
  envFile?: string;
  dryRun?: boolean;
  stopBeforeMutating?: boolean;
  requireMutatingConfirmation?: boolean;
}

export interface ReplayRunResult {
  ok: boolean;
  workflow: {
    version: 1;
    steps: number;
    startUrl: string;
  };
  steps: ReplayStepReceipt[];
}
