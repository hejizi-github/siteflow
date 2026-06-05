import type { SiteCommandContext, SiteReceipt, SiteStepReceipt } from '../types.js';

export type FlowStepEvidence = Record<string, unknown>;

export interface SiteFlow {
  readonly ctx: SiteCommandContext;
  readonly site: string;
  readonly command: string;
  readonly steps: SiteStepReceipt[];
}

export function defineSiteFlow(ctx: SiteCommandContext, site: string, command: string): SiteFlow {
  return {
    ctx,
    site,
    command,
    steps: [],
  };
}

export function withFlowSteps(receipt: SiteReceipt, steps: SiteStepReceipt[]): SiteReceipt {
  return {
    ...receipt,
    steps,
  };
}
