import test from 'node:test';
import assert from 'node:assert/strict';

import {
  launchDedicatedProfileContext,
  attachBrowserContext,
} from '../../dist/runtime/browser-session.js';

test('launchDedicatedProfileContext is an async function', () => {
  assert.equal(typeof launchDedicatedProfileContext, 'function');
  assert.equal(launchDedicatedProfileContext.constructor.name, 'AsyncFunction');
});

test('attachBrowserContext is an async function', () => {
  assert.equal(typeof attachBrowserContext, 'function');
  assert.equal(attachBrowserContext.constructor.name, 'AsyncFunction');
});
