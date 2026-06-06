import test from 'node:test';
import assert from 'node:assert/strict';

import { hookSource } from '../../dist/runtime/hook-runtime.js';

test('hookSource("fetch") returns a non-empty string containing "fetch"', () => {
  const src = hookSource('fetch');
  assert.ok(typeof src === 'string', 'should return a string');
  assert.ok(src.length > 0, 'should be non-empty');
  assert.ok(src.includes('fetch'), 'should contain fetch');
  assert.ok(src.startsWith("(() => {"), 'should start with IIFE');
});

test('hookSource("xhr") returns a non-empty string containing "xhr"', () => {
  const src = hookSource('xhr');
  assert.ok(typeof src === 'string', 'should return a string');
  assert.ok(src.length > 0, 'should be non-empty');
  assert.ok(src.includes('xhr'), 'should contain xhr');
  assert.ok(src.startsWith("(() => {"), 'should start with IIFE');
});

test('hookSource("crypto") returns a non-empty string containing "crypto"', () => {
  const src = hookSource('crypto');
  assert.ok(typeof src === 'string', 'should return a string');
  assert.ok(src.length > 0, 'should be non-empty');
  assert.ok(src.includes('crypto'), 'should contain crypto');
  assert.ok(src.startsWith("(() => {"), 'should start with IIFE');
});

test('hookSource("unknown") returns a non-empty string from default case', () => {
  const src = hookSource('unknown');
  assert.ok(typeof src === 'string', 'should return a string');
  assert.ok(src.length > 0, 'should be non-empty');
  assert.ok(src.startsWith("(() => {"), 'should start with IIFE');
});

test('each hook source starts with "(() => {"', () => {
  for (const name of ['fetch', 'xhr', 'crypto', 'unknown']) {
    const src = hookSource(name);
    assert.ok(src.startsWith("(() => {"), `${name} hook should start with IIFE`);
  }
});
