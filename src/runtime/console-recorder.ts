import type { Page } from 'playwright';
import type { PageObservation } from './page-observation.js';

const MAX_CONSOLE_ENTRIES = 1000;

export function wireConsoleRecorder(page: Page, observation: PageObservation): void {
  page.on('console', message => {
    observation.console.push({
      id: observation.nextConsoleId++,
      type: message.type(),
      text: message.text(),
      location: message.location(),
      ts: new Date().toISOString(),
    });
    if (observation.console.length > MAX_CONSOLE_ENTRIES) observation.console.shift();
  });

  page.on('pageerror', error => {
    observation.console.push({
      id: observation.nextConsoleId++,
      type: 'pageerror',
      text: error.message,
      ts: new Date().toISOString(),
    });
    if (observation.console.length > MAX_CONSOLE_ENTRIES) observation.console.shift();
  });
}
