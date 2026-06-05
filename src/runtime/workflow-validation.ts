import { SiteflowError } from '../shared/errors.js';
import type { RecordedTarget, SiteflowWorkflow, WorkflowStep, WorkflowStepType, WorkflowVariable } from './workflow-types.js';

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

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw workflowError('BAD_WORKFLOW', `${field} must be a boolean.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw workflowError('BAD_WORKFLOW', `${field} must be a finite number.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw workflowError('BAD_WORKFLOW', `${field} must be a string.`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteNumber(value, field);
}

function validateTargetSemantic(value: unknown, field: string): RecordedTarget['semantic'] {
  if (value === undefined) return undefined;
  const semantic = requireObject(value, field);
  const role = optionalString(semantic.role, `${field}.role`);
  const aria = optionalString(semantic.aria, `${field}.aria`);
  const label = optionalString(semantic.label, `${field}.label`);
  const text = optionalString(semantic.text, `${field}.text`);
  const placeholder = optionalString(semantic.placeholder, `${field}.placeholder`);

  return {
    ...(role === undefined ? {} : { role }),
    ...(aria === undefined ? {} : { aria }),
    ...(label === undefined ? {} : { label }),
    ...(text === undefined ? {} : { text }),
    ...(placeholder === undefined ? {} : { placeholder }),
  };
}

function validateTargetStructural(value: unknown, field: string): RecordedTarget['structural'] {
  if (value === undefined) return undefined;
  const structural = requireObject(value, field);
  const selector = optionalString(structural.selector, `${field}.selector`);
  const xpath = optionalString(structural.xpath, `${field}.xpath`);
  const nth = optionalFiniteNumber(structural.nth, `${field}.nth`);

  return {
    ...(selector === undefined ? {} : { selector }),
    ...(xpath === undefined ? {} : { xpath }),
    ...(nth === undefined ? {} : { nth }),
  };
}

function validateTargetGeometry(value: unknown, field: string): RecordedTarget['geometry'] {
  if (value === undefined) return undefined;
  const geometry = requireObject(value, field);
  const width = optionalFiniteNumber(geometry.width, `${field}.width`);
  const height = optionalFiniteNumber(geometry.height, `${field}.height`);

  return {
    x: requireFiniteNumber(geometry.x, `${field}.x`),
    y: requireFiniteNumber(geometry.y, `${field}.y`),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function validateVariable(value: unknown, index: number): WorkflowVariable {
  const variable = requireObject(value, `variables[${index}]`);
  const name = requireString(variable.name, `variables[${index}].name`);
  const source = requireString(variable.source, `variables[${index}].source`);
  if (source !== 'input' && source !== 'file' && source !== 'env') {
    throw workflowError('BAD_WORKFLOW', `variables[${index}].source must be input, file, or env.`);
  }

  return {
    name,
    source,
    sensitive: requireBoolean(variable.sensitive, `variables[${index}].sensitive`),
    required: requireBoolean(variable.required, `variables[${index}].required`),
  };
}

function validateTarget(value: unknown, field: string): RecordedTarget {
  const target = requireObject(value, field);
  const confidence = requireString(target.confidence, `${field}.confidence`);
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    throw workflowError('BAD_WORKFLOW', `${field}.confidence must be high, medium, or low.`);
  }

  const semantic = validateTargetSemantic(target.semantic, `${field}.semantic`);
  const structural = validateTargetStructural(target.structural, `${field}.structural`);
  const geometry = validateTargetGeometry(target.geometry, `${field}.geometry`);

  return {
    ...(semantic === undefined ? {} : { semantic }),
    ...(structural === undefined ? {} : { structural }),
    ...(geometry === undefined ? {} : { geometry }),
    confidence,
  };
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
    validateTarget(value.target, `steps[${index}].target`);
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
  let name: string | undefined;
  if (value.name !== undefined) {
    if (typeof value.name !== 'string') {
      throw workflowError('BAD_WORKFLOW', 'name must be a string.');
    }
    name = value.name;
  }
  if (!Array.isArray(value.steps)) throw workflowError('BAD_WORKFLOW', 'steps must be an array.');

  const evidence = value.evidence === undefined ? {} : requireObject(value.evidence, 'evidence');

  return {
    version: 1,
    kind: 'siteflow.workflow',
    ...(name === undefined ? {} : { name }),
    createdAt,
    startUrl,
    variables: variables.map(validateVariable),
    steps: value.steps.map(validateStep),
    evidence,
  };
}
