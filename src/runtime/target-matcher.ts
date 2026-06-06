import type { BrowserClickOptions, BrowserElementTarget } from '../shared/types.js';
import type { RecordedTarget } from './workflow-types.js';

export type RecordedTargetMatch =
  | 'semantic.aria'
  | 'semantic.label'
  | 'semantic.placeholder'
  | 'semantic.text'
  | 'structural.selector'
  | 'geometry'
  | 'none';

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function attachNth(target: BrowserElementTarget, nth: number | undefined): BrowserElementTarget {
  if (nth !== undefined) target.nth = nth;
  return target;
}


export function matchedByForRecordedTarget(target: RecordedTarget): RecordedTargetMatch {
  const semantic = target.semantic;
  if (hasValue(semantic?.aria)) return 'semantic.aria';
  if (hasValue(semantic?.label)) return 'semantic.label';
  if (hasValue(semantic?.placeholder)) return 'semantic.placeholder';
  if (hasValue(semantic?.text)) return 'semantic.text';
  if (hasValue(target.structural?.selector)) return 'structural.selector';
  if (target.geometry) return 'geometry';
  return 'none';
}

export function browserTargetFromRecordedTarget(target: RecordedTarget): BrowserElementTarget {
  const semantic = target.semantic;
  const nth = target.structural?.nth;
  if (hasValue(semantic?.aria)) return attachNth({ aria: semantic.aria, exact: true }, nth);
  if (hasValue(semantic?.label)) return attachNth({ aria: semantic.label, exact: true }, nth);
  if (hasValue(semantic?.placeholder)) return attachNth({ selector: `[placeholder="${semantic.placeholder.replace(/[\\"]/g, (char) => `\\${char}`)}"]`, exact: true }, nth);
  if (hasValue(semantic?.text)) return attachNth({ text: semantic.text, exact: true }, nth);
  if (hasValue(target.structural?.selector)) return attachNth({ selector: target.structural.selector, exact: true }, nth);
  return { exact: true };
}

export function clickOptionsFromRecordedTarget(target: RecordedTarget): BrowserClickOptions {
  const browserTarget = browserTargetFromRecordedTarget(target);
  if (!browserTarget.selector && !browserTarget.text && !browserTarget.aria && target.geometry) {
    return {
      x: Math.round(target.geometry.x),
      y: Math.round(target.geometry.y),
    };
  }
  return browserTarget;
}
