import { setTimeout as sleep } from 'node:timers/promises';

import { SiteflowError } from '../shared/errors.js';
import type {
  BrowserActionResult,
  BrowserClickOptions,
  BrowserScreenshotResult,
  BrowserSelectOptions,
  BrowserTypeOptions,
  PageInfo,
} from '../shared/types.js';
import {
  browserTargetFromRecordedTarget,
  clickOptionsFromRecordedTarget,
  matchedByForRecordedTarget,
} from './target-matcher.js';
import { validateWorkflow } from './workflow-validation.js';
import type {
  ClickWorkflowStep,
  RecordedTarget,
  ReplayRunOptions,
  ReplayRunResult,
  ReplayStepReceipt,
  SelectWorkflowStep,
  WaitWorkflowStep,
  SiteflowWorkflow,
  TypeWorkflowStep,
  WorkflowStep,
} from './workflow-types.js';

export interface ReplayDriver {
  open(url: string): Promise<PageInfo>;
  click(options: BrowserClickOptions): Promise<BrowserActionResult>;
  type(options: BrowserTypeOptions): Promise<BrowserActionResult>;
  select(options: BrowserSelectOptions): Promise<BrowserActionResult>;
  screenshot(fullPage: boolean): Promise<BrowserScreenshotResult | { bytes: number }>;
  scroll(deltaX: number, deltaY: number): Promise<void>;
  waitFor?(condition: { ms: number; selector?: string; text?: string; urlContains?: string }): Promise<void>;
}

function successReceipt(step: WorkflowStep, target?: RecordedTarget): ReplayStepReceipt {
  return {
    stepId: step.id,
    type: step.type,
    ok: true,
    ...(target === undefined ? {} : { targetMatchedBy: matchedByForRecordedTarget(target) }),
  };
}

function failedReceipt(step: WorkflowStep, error: unknown): ReplayStepReceipt {
  if (error instanceof SiteflowError) {
    return {
      stepId: step.id,
      type: step.type,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    stepId: step.id,
    type: step.type,
    ok: false,
    error: {
      code: 'REPLAY_STEP_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function mutatingStopReceipt(step: WorkflowStep): ReplayStepReceipt {
  return {
    stepId: step.id,
    type: step.type,
    ok: false,
    error: {
      code: 'STOPPED_BEFORE_MUTATING',
      message: `Stopped before mutating workflow step ${step.id}.`,
    },
  };
}

function clickOptionsFromStep(step: ClickWorkflowStep): BrowserClickOptions {
  return {
    ...clickOptionsFromRecordedTarget(step.target),
    ...(step.button === undefined ? {} : { button: step.button }),
  };
}

function typeOptionsFromStep(step: TypeWorkflowStep): BrowserTypeOptions {
  return {
    ...browserTargetFromRecordedTarget(step.target),
    value: step.value,
    ...(step.clear === undefined ? {} : { clear: step.clear }),
    ...(step.pressEnter === undefined ? {} : { pressEnter: step.pressEnter }),
  };
}

function selectOptionsFromStep(step: SelectWorkflowStep): BrowserSelectOptions {
  const target = browserTargetFromRecordedTarget(step.target);
  return {
    ...(target.selector === undefined ? {} : { selector: target.selector }),
    ...(target.selector !== undefined || (target.text ?? target.aria) === undefined ? {} : { comboboxText: target.text ?? target.aria }),
    option: step.option,
    ...(target.exact === undefined ? {} : { exact: target.exact }),
  };
}

function waitHasCondition(step: WaitWorkflowStep): boolean {
  return step.selector !== undefined || step.text !== undefined || step.urlContains !== undefined;
}

function waitConditionFromStep(step: WaitWorkflowStep): { ms: number; selector?: string; text?: string; urlContains?: string } {
  return {
    ms: step.ms ?? 1000,
    ...(step.selector === undefined ? {} : { selector: step.selector }),
    ...(step.text === undefined ? {} : { text: step.text }),
    ...(step.urlContains === undefined ? {} : { urlContains: step.urlContains }),
  };
}

async function runStep(driver: ReplayDriver, step: WorkflowStep): Promise<ReplayStepReceipt> {
  switch (step.type) {
    case 'open':
      const page = await driver.open(step.url);
      return { ...successReceipt(step), urlAfter: page.url };
    case 'click':
      await driver.click(clickOptionsFromStep(step));
      return successReceipt(step, step.target);
    case 'type':
      await driver.type(typeOptionsFromStep(step));
      return successReceipt(step, step.target);
    case 'select':
      await driver.select(selectOptionsFromStep(step));
      return successReceipt(step, step.target);
    case 'wait':
      if (waitHasCondition(step)) {
        if (driver.waitFor === undefined) {
          throw new SiteflowError('REPLAY_WAIT_UNSUPPORTED', 'Replay driver does not support conditional waits.');
        }
        await driver.waitFor(waitConditionFromStep(step));
        return successReceipt(step);
      }
      await sleep(step.ms ?? 1000);
      return successReceipt(step);
    case 'screenshot':
      await driver.screenshot(step.fullPage !== false);
      return successReceipt(step);
    case 'scroll':
      await driver.scroll(step.deltaX, step.deltaY);
      return successReceipt(step);
  }
}

export async function runWorkflow(
  driver: ReplayDriver,
  workflow: SiteflowWorkflow,
  options: ReplayRunOptions = {},
): Promise<ReplayRunResult> {
  const validated = validateWorkflow(workflow);
  const receipts: ReplayStepReceipt[] = [];

  for (const step of validated.steps) {
    if (options.dryRun === true) {
      const receipt = step.type === 'wait' && waitHasCondition(step) && driver.waitFor === undefined
        ? failedReceipt(step, new SiteflowError('REPLAY_WAIT_UNSUPPORTED', 'Replay driver does not support conditional waits.'))
        : successReceipt(step, step.target);
      receipts.push(receipt);
      if (!receipt.ok) break;
      continue;
    }

    if (options.stopBeforeMutating === true && step.mutating === true) {
      receipts.push(mutatingStopReceipt(step));
      break;
    }

    const receipt = await runStep(driver, step).catch((error: unknown) => failedReceipt(step, error));
    receipts.push(receipt);
    if (!receipt.ok) break;
  }

  return {
    ok: receipts.every((receipt) => receipt.ok),
    workflow: {
      version: 1,
      steps: validated.steps.length,
      startUrl: validated.startUrl,
    },
    steps: receipts,
  };
}
