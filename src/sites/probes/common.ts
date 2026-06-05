import { evaluateSiteExpression } from '../capabilities.js';
import type { ProbePage } from './selector-runtime.js';

export const defaultScrollExpression = `(() => {
  const before = window.scrollY || document.documentElement.scrollTop || 0;
  const height = Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0);
  window.scrollTo(0, Math.max(height * 0.75, before + 1200));
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  return { y, height };
})()`;

export async function scrollPage(page: ProbePage, expression = defaultScrollExpression): Promise<Record<string, unknown>> {
  const evaluate = page.evaluate ?? evaluateSiteExpression;
  const evaluated = await evaluate(page.profile, expression, page.pageId);
  const payload = unwrapEvaluation(evaluated);
  return isRecord(payload) ? payload : {};
}

function unwrapEvaluation(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!isRecord(current)) return current;
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
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
