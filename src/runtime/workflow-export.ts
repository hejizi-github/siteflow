import type { RecordedTarget, SiteflowWorkflow, WorkflowStep } from './workflow-types.js';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function pushArg(args: string[], name: string, value: string): void {
  args.push(name, shellQuote(value));
}

function targetArgs(target: RecordedTarget, command: 'click' | 'type' | 'select'): string[] {
  const args: string[] = [];
  const semantic = target.semantic;
  const structural = target.structural;
  const geometry = target.geometry;

  if (semantic?.aria) {
    pushArg(args, command === 'select' ? '--combobox-text' : '--aria', semantic.aria);
  } else if (semantic?.label) {
    pushArg(args, command === 'select' ? '--combobox-text' : '--aria', semantic.label);
  } else if (semantic?.text) {
    pushArg(args, command === 'select' ? '--combobox-text' : '--text', semantic.text);
  } else if (structural?.selector) {
    pushArg(args, '--selector', structural.selector);
  } else if (geometry) {
    pushArg(args, '--xy', `${geometry.x},${geometry.y}`);
  }

  if (structural?.nth !== undefined && command !== 'select') {
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
      const args = ['siteflow', '--json', 'browser', 'type', ...targetArgs(step.target, 'type'), '--value', shellQuote(step.value)];
      if (step.clear === false) args.push('--no-clear');
      if (step.pressEnter) args.push('--enter');
      return args.join(' ');
    }
    case 'select':
      return ['siteflow', '--json', 'browser', 'select', ...targetArgs(step.target, 'select'), '--option', shellQuote(step.option)].join(' ');
    case 'scroll':
      return `siteflow --json eval ${shellQuote(`window.scrollBy(${step.deltaX}, ${step.deltaY})`)}`;
    case 'wait': {
      const ms = step.ms ?? 1000;
      const expression = `(() => { const pending = Promise.withResolvers(); setTimeout(pending.resolve, ${ms}); return pending.promise; })()`;
      return `siteflow --json eval ${shellQuote(expression)}`;
    }
    case 'screenshot': {
      const args = ['siteflow', '--json', 'browser', 'screenshot', '--out', shellQuote(`${step.id}.png`)];
      if (step.fullPage !== false) args.push('--full-page');
      return args.join(' ');
    }
  }
}

export function exportWorkflowCli(workflow: SiteflowWorkflow): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `# Workflow createdAt: ${workflow.createdAt}`,
    '',
  ];

  for (const step of workflow.steps) {
    if (step.mutating) lines.push(`# MUTATING ${step.id}`);
    lines.push(stepCommand(step));
  }

  return `${lines.join('\n')}\n`;
}
