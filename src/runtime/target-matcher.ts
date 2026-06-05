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
  if (hasValue(semantic?.aria)) return { aria: semantic.aria, exact: true };
  if (hasValue(semantic?.label)) return { aria: semantic.label, exact: true };
  if (hasValue(semantic?.placeholder)) return { selector: `[placeholder="${semantic.placeholder.replace(/[\\"]/g, (char) => `\\${char}`)}"]`, exact: true };
  if (hasValue(semantic?.text)) return { text: semantic.text, exact: true };
  if (hasValue(target.structural?.selector)) return { selector: target.structural.selector, exact: true };
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
