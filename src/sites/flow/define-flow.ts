import type { SiteCommandContext, SiteReceipt, SiteStepReceipt } from '../capabilities.js';

export type FlowStepEvidence = Record<string, unknown>;
export interface FlowEvidenceValue<T> {
  value: T;
  evidence: FlowStepEvidence;
}

export type SiteFlowStepResult<T> = T | FlowEvidenceValue<T>;
export type SiteFlowStepHandler<T> = (flow: SiteFlowRunner) => SiteFlowStepResult<T> | Promise<SiteFlowStepResult<T>>;
export type SiteFlowReceiptBuilder = (flow: SiteFlowRunner) => SiteReceipt | Promise<SiteReceipt>;

interface QueuedFlowStep {
  name: string;
  handler: SiteFlowStepHandler<unknown>;
}

export class SiteFlowRunner {
  readonly steps: SiteStepReceipt[] = [];

  private readonly queuedSteps: QueuedFlowStep[] = [];
  private readonly results = new Map<string, unknown>();
  private executed = false;

  constructor(
    readonly ctx: SiteCommandContext,
    readonly site: string,
    readonly command: string,
  ) {}

  step<T>(name: string, handler: SiteFlowStepHandler<T>): this {
    if (this.executed) throw new Error('SiteFlowRunner already executed');
    this.queuedSteps.push({ name, handler: handler as SiteFlowStepHandler<unknown> });
    return this;
  }

  get<T = unknown>(name: string): T {
    return this.results.get(name) as T;
  }

  async receipt(builder: SiteFlowReceiptBuilder): Promise<SiteReceipt> {
    if (this.executed) throw new Error('SiteFlowRunner already executed');
    this.executed = true;
    await this.runSteps();
    return withFlowSteps(await builder(this), this.steps);
  }

  private async runSteps(): Promise<void> {
    for (const step of this.queuedSteps) {
      const startedAt = new Date().toISOString();
      try {
        const result = unwrapStepResult(await step.handler(this));
        this.results.set(step.name, result.value);
        const stepReceipt: SiteStepReceipt = {
          name: step.name,
          ok: true,
          state: `${step.name}_ok`,
          startedAt,
          endedAt: new Date().toISOString(),
        };
        if (result.evidence) stepReceipt.evidence = result.evidence;
        this.steps.push(stepReceipt);
      } catch (error) {
        this.steps.push({
          name: step.name,
          ok: false,
          state: `${step.name}_failed`,
          startedAt,
          endedAt: new Date().toISOString(),
          error: {
            code: 'SITE_FLOW_STEP_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    }
  }
}

export type SiteFlow = SiteFlowRunner;

export function defineSiteFlow(ctx: SiteCommandContext, site: string, command: string): SiteFlowRunner {
  return new SiteFlowRunner(ctx, site, command);
}

export function flowEvidence<T>(value: T, evidence?: FlowStepEvidence): FlowEvidenceValue<T> {
  return {
    value,
    evidence: evidence ?? toStepEvidence(value),
  };
}

export function withFlowSteps(receipt: SiteReceipt, steps: SiteStepReceipt[]): SiteReceipt {
  return {
    ...receipt,
    steps,
  };
}

function isFlowEvidenceValue(value: unknown): value is FlowEvidenceValue<unknown> {
  return value !== null
    && typeof value === 'object'
    && 'value' in value
    && 'evidence' in value;
}

function unwrapStepResult(value: unknown): { value: unknown; evidence?: FlowStepEvidence } {
  if (isFlowEvidenceValue(value)) return value;
  return { value };
}

function toStepEvidence(value: unknown): FlowStepEvidence {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as FlowStepEvidence;
  }
  return { value };
}
