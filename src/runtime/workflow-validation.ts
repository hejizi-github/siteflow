import { SiteflowError } from '../shared/errors.js';
import type { SiteflowWorkflow, WorkflowStep, WorkflowStepType } from './workflow-types.js';

const PHASE_1_STEP_TYPES: Record<WorkflowStepType, true> = {
  open: true,
  click: true,
  type: true,
  select: true,
  scroll: true,
  wait: true,
  screenshot: true,
};

function workflowError(code: string, message: string): SiteflowError {
  return new SiteflowError(code, `${code}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw workflowError('BAD_WORKFLOW', `${field} must be a non-empty string.`);
  }
  return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw workflowError('BAD_WORKFLOW', `${field} must be an object.`);
  }
  return value;
}

function validateStep(value: unknown, index: number): WorkflowStep {
  if (!isRecord(value)) throw workflowError('BAD_WORKFLOW', `steps[${index}] must be an object.`);

  const id = requireString(value.id, `steps[${index}].id`);
  const type = requireString(value.type, `steps[${index}].type`) as WorkflowStepType;

  if (PHASE_1_STEP_TYPES[type] !== true) {
    throw workflowError('UNSUPPORTED_WORKFLOW_STEP', `Unsupported workflow step type: ${type}.`);
  }

  if (type === 'open') requireString(value.url, `steps[${index}].url`);

  if (type === 'click' || type === 'type' || type === 'select') {
    requireObject(value.target, `steps[${index}].target`);
  }

  if (type === 'type') requireString(value.value, `steps[${index}].value`);
  if (type === 'select') requireString(value.option, `steps[${index}].option`);

  return { ...value, id, type } as WorkflowStep;
}

export function validateWorkflow(value: unknown): SiteflowWorkflow {
  if (!isRecord(value)) throw workflowError('BAD_WORKFLOW', 'Workflow must be an object.');
  if (value.version !== 1) {
    throw workflowError('WORKFLOW_UNSUPPORTED_VERSION', 'Only workflow version 1 is supported.');
  }
  if (value.kind !== 'siteflow.workflow') {
    throw workflowError('BAD_WORKFLOW', 'Workflow kind must be siteflow.workflow.');
  }

  const createdAt = requireString(value.createdAt, 'createdAt');
  const startUrl = requireString(value.startUrl, 'startUrl');
  const variables = Array.isArray(value.variables) ? value.variables : [];
  if (value.variables !== undefined && !Array.isArray(value.variables)) {
    throw workflowError('BAD_WORKFLOW', 'variables must be an array.');
  }
  if (!Array.isArray(value.steps)) throw workflowError('BAD_WORKFLOW', 'steps must be an array.');

  const evidence = value.evidence === undefined ? {} : requireObject(value.evidence, 'evidence');

  return {
    version: 1,
    kind: 'siteflow.workflow',
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    createdAt,
    startUrl,
    variables: variables as SiteflowWorkflow['variables'],
    steps: value.steps.map(validateStep),
    evidence,
  };
}
