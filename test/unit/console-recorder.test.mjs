import test from 'node:test';
import assert from 'node:assert/strict';

import { createPageObservation } from '../../dist/runtime/page-observation.js';
import { wireConsoleRecorder } from '../../dist/runtime/console-recorder.js';

function mockPage() {
  const listeners = new Map();
  return {
    listeners,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return this;
    },
  };
}

test('wireConsoleRecorder attaches console and pageerror listeners', () => {
  const page = mockPage();
  const observation = createPageObservation();

  wireConsoleRecorder(page, observation);

  assert.ok(page.listeners.has('console'));
  assert.ok(page.listeners.has('pageerror'));
  assert.equal(page.listeners.get('console').length, 1);
  assert.equal(page.listeners.get('pageerror').length, 1);
});

test('wireConsoleRecorder pushes console message entries', () => {
  const page = mockPage();
  const observation = createPageObservation();

  wireConsoleRecorder(page, observation);

  const consoleHandler = page.listeners.get('console')[0];
  const mockMessage = {
    type: () => 'log',
    text: () => 'hello',
    location: () => ({ url: 'https://example.com/script.js', lineNumber: 1 }),
  };

  consoleHandler(mockMessage);

  assert.equal(observation.console.length, 1);
  assert.equal(observation.console[0].type, 'log');
  assert.equal(observation.console[0].text, 'hello');
  assert.deepEqual(observation.console[0].location, { url: 'https://example.com/script.js', lineNumber: 1 });
  assert.equal(observation.console[0].id, 1);
  assert.equal(observation.nextConsoleId, 2);
});

test('wireConsoleRecorder pushes pageerror entries', () => {
  const page = mockPage();
  const observation = createPageObservation();

  wireConsoleRecorder(page, observation);

  const errorHandler = page.listeners.get('pageerror')[0];
  const mockError = new Error('Uncaught TypeError');

  errorHandler(mockError);

  assert.equal(observation.console.length, 1);
  assert.equal(observation.console[0].type, 'pageerror');
  assert.equal(observation.console[0].text, 'Uncaught TypeError');
  assert.equal(observation.console[0].id, 1);
  assert.equal(observation.nextConsoleId, 2);
});

test('wireConsoleRecorder prunes console entries beyond MAX_CONSOLE_ENTRIES', () => {
  const page = mockPage();
  const observation = createPageObservation();

  wireConsoleRecorder(page, observation);

  const consoleHandler = page.listeners.get('console')[0];

  for (let i = 0; i < 1001; i += 1) {
    consoleHandler({
      type: () => 'log',
      text: () => `message-${i}`,
      location: () => ({ url: '', lineNumber: 0 }),
    });
  }

  assert.equal(observation.console.length, 1000);
  assert.equal(observation.console[0].text, 'message-1');
  assert.equal(observation.console.at(-1).text, 'message-1000');
});
