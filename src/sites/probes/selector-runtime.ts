import { evaluateSiteExpression } from '../capabilities.js';

export type ProbeEvaluate = (profile: string, expression: string, pageId?: number) => Promise<unknown>;

export interface ProbePage {
  profile: string;
  pageId?: number;
  evaluate?: ProbeEvaluate;
}

interface TextFieldSpec {
  kind: 'text';
  selector: string;
  max?: number;
}

interface AttrFieldSpec {
  kind: 'attr';
  selector: string;
  attribute: string;
}

export type ExtractListFieldSpec = TextFieldSpec | AttrFieldSpec;

export interface ExtractListSpec {
  root: string;
  fields: Record<string, ExtractListFieldSpec>;
  limit: number;
  required?: string[];
}

export interface ExtractListResult {
  rows: Array<Record<string, unknown>>;
  evidence: {
    count: number;
    limit: number;
    root: string;
  };
}

export function text(selector: string, options: { max?: number } = {}): ExtractListFieldSpec {
  return {
    kind: 'text',
    selector,
    ...(options.max === undefined ? {} : { max: normalizeLimit(options.max) }),
  };
}

export function attr(selector: string, attribute: string): ExtractListFieldSpec {
  return {
    kind: 'attr',
    selector,
    attribute,
  };
}

export function href(selector: string): ExtractListFieldSpec {
  return attr(selector, 'href');
}

export function createExtractListExpression(spec: ExtractListSpec): string {
  const normalized = normalizeSpec(spec);
  return `(() => {
  const spec = ${JSON.stringify(normalized)};
  const roots = Array.from(document.querySelectorAll(spec.root));
  const limit = Math.min(${normalized.limit}, roots.length);
  if (limit <= 0) return { rows: [], count: 0 };
  const readField = (root, field) => {
    const node = root.querySelector(field.selector);
    if (!node) return '';
    if (field.kind === 'attr') {
      if (field.attribute === 'href' && 'href' in node) return String(node.href || '');
      return String(node.getAttribute(field.attribute) || '');
    }
    const value = String(node.textContent || '').trim();
    return Number.isFinite(field.max) ? value.slice(0, field.max) : value;
  };
  const rows = [];
  for (const root of roots) {
    const row = Object.create(null);
    for (const [name, field] of Object.entries(spec.fields)) {
      row[name] = readField(root, field);
    }
    if (!spec.required.every((name) => Object.hasOwn(row, name) && Boolean(row[name]))) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return { rows, count: rows.length };
})()`;
}

export async function extractList(page: ProbePage, spec: ExtractListSpec): Promise<ExtractListResult> {
  const normalized = normalizeSpec(spec);
  const evaluate = page.evaluate ?? evaluateSiteExpression;
  const evaluated = await evaluate(page.profile, createExtractListExpression(normalized), page.pageId);
  const payload = unwrapEvaluation(evaluated);
  const rows = Array.isArray(payload.rows) ? payload.rows.filter(isRecord) : [];
  const count = typeof payload.count === 'number' && Number.isFinite(payload.count) ? payload.count : rows.length;
  return {
    rows,
    evidence: {
      count,
      limit: normalized.limit,
      root: normalized.root,
    },
  };
}

function normalizeSpec(spec: ExtractListSpec): ExtractListSpec {
  return {
    root: spec.root,
    limit: normalizeLimit(spec.limit),
    fields: normalizeFields(spec.fields),
    required: Array.isArray(spec.required) ? spec.required : [],
  };
}

function normalizeFields(fields: Record<string, ExtractListFieldSpec>): Record<string, ExtractListFieldSpec> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => {
    if (field.kind === 'text') {
      return [name, text(field.selector, { max: field.max })];
    }
    return [name, attr(field.selector, field.attribute)];
  }));
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function unwrapEvaluation(value: unknown): Record<string, unknown> {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!isRecord(current)) return {};
    if ('rows' in current || 'count' in current) return current;
    if (isRecord(current.data)) {
      current = current.data;
      continue;
    }
    if (isRecord(current.value)) {
      current = current.value;
      continue;
    }
    return current;
  }
  return isRecord(current) ? current : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
