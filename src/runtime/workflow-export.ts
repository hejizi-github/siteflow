import type { RecordedTarget, SiteflowWorkflow, WorkflowStep } from './workflow-types.js';
import { SiteflowError } from '../shared/errors.js';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellQuoteTypedValue(value: string): string {
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) return `"${value}"`;
  return shellQuote(value);
}

function sanitizeCommentText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ');
}

function safeScreenshotBasename(id: string): string {
  const basename = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return basename.length > 0 ? basename : 'screenshot';
}

function pushArg(args: string[], name: string, value: string): void {
  args.push(name, shellQuote(value));
}

function unsupportedTarget(command: string, target: RecordedTarget): SiteflowError {
  return new SiteflowError(
    'UNSUPPORTED_WORKFLOW_TARGET',
    `UNSUPPORTED_WORKFLOW_TARGET: Cannot export ${command} target with current command flags.`,
    JSON.stringify(target),
  );
}

function hasUnsupportedSemanticTarget(target: RecordedTarget): boolean {
  const semantic = target.semantic;
  return Boolean(semantic?.role || semantic?.placeholder);
}

function supportsAriaTarget(command: 'click' | 'type' | 'select'): command is 'click' | 'type' {
  return command !== 'select';
}

function waitExpression(step: Extract<WorkflowStep, { type: 'wait' }>): string {
  const ms = step.ms ?? 1000;
  const conditions: string[] = [];

  if (step.selector !== undefined) conditions.push(`document.querySelector(${JSON.stringify(step.selector)}) !== null`);
  if (step.text !== undefined) conditions.push(`document.body?.innerText.includes(${JSON.stringify(step.text)}) === true`);
  if (step.urlContains !== undefined) conditions.push(`window.location.href.includes(${JSON.stringify(step.urlContains)})`);

  if (conditions.length === 0) return `new Promise(resolve => setTimeout(resolve, ${ms}))`;

  const condition = conditions.join(' && ');
  return `new Promise((resolve, reject) => { const deadline = Date.now() + ${ms}; const check = () => { if (${condition}) { resolve(true); return; } if (Date.now() >= deadline) { reject(new Error('Timed out waiting for workflow condition')); return; } setTimeout(check, 50); }; check(); })`;
}

function targetArgs(target: RecordedTarget, command: 'click' | 'type' | 'select'): string[] {
  const args: string[] = [];
  const semantic = target.semantic;
  const structural = target.structural;
  const geometry = target.geometry;

  if (structural?.nth !== undefined && (!Number.isInteger(structural.nth) || structural.nth < 0)) {
    throw unsupportedTarget(command, target);
  }

  if (command === 'select' && structural?.nth !== undefined) {
    throw unsupportedTarget(command, target);
  }

  if (hasUnsupportedSemanticTarget(target)) {
    throw unsupportedTarget(command, target);
  }

  if (semantic?.text) {
    pushArg(args, command === 'select' ? '--combobox-text' : '--text', semantic.text);
  } else if (supportsAriaTarget(command) && semantic?.aria) {
    pushArg(args, '--aria', semantic.aria);
  } else if (supportsAriaTarget(command) && semantic?.label) {
    pushArg(args, '--aria', semantic.label);
  } else if (structural?.selector) {
    pushArg(args, '--selector', structural.selector);
  } else if (geometry && command === 'click' && !hasUnsupportedSemanticTarget(target)) {
    pushArg(args, '--xy', `${geometry.x},${geometry.y}`);
  } else {
    throw unsupportedTarget(command, target);
  }

  if (structural?.nth !== undefined) {
    args.push('--nth', String(structural.nth));
  }

  return args;
}

function stepCommand(step: WorkflowStep): string {
  switch (step.type) {
    case 'open':
      return `siteflow --json browser open ${shellQuote(step.url)}`;
    case 'click': {
      const args = ['siteflow', '--json', 'browser', 'click', ...targetArgs(step.target, 'click')];
      if (step.button && step.button !== 'left') args.push('--button', step.button);
      return args.join(' ');
    }
    case 'type': {
      const args = ['siteflow', '--json', 'browser', 'type', ...targetArgs(step.target, 'type'), '--value', shellQuoteTypedValue(step.value)];
      if (step.clear === false) args.push('--no-clear');
      if (step.pressEnter) args.push('--enter');
      return args.join(' ');
    }
    case 'select':
      return ['siteflow', '--json', 'browser', 'select', ...targetArgs(step.target, 'select'), '--option', shellQuote(step.option)].join(' ');
    case 'scroll':
      return `siteflow --json eval ${shellQuote(`window.scrollBy(${step.deltaX}, ${step.deltaY})`)}`;
    case 'wait': {
      return `siteflow --json eval ${shellQuote(waitExpression(step))}`;
    }
    case 'screenshot': {
      const args = ['siteflow', '--json', 'browser', 'screenshot', '--out', shellQuote(`${safeScreenshotBasename(step.id)}.png`)];
      if (step.fullPage !== false) args.push('--full-page');
      return args.join(' ');
    }
  }
}

function stepComment(step: WorkflowStep): string | undefined {
  if (step.mutating) {
    return step.label ? `# MUTATING ${sanitizeCommentText(step.id)}: ${sanitizeCommentText(step.label)}` : `# MUTATING ${sanitizeCommentText(step.id)}`;
  }
  if (step.label) return `# ${sanitizeCommentText(step.id)}: ${step.type} - ${sanitizeCommentText(step.label)}`;
  return undefined;
}

export function exportWorkflowCli(workflow: SiteflowWorkflow): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `# Workflow createdAt: ${workflow.createdAt}`,
    '',
  ];

  if (workflow.startUrl && workflow.steps[0]?.type !== 'open') {
    lines.push(`siteflow --json browser open ${shellQuote(workflow.startUrl)}`);
  }

  for (const step of workflow.steps) {
    const comment = stepComment(step);
    if (comment) lines.push(comment);
    lines.push(stepCommand(step));
  }

  return `${lines.join('\n')}\n`;
}
