import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
const sitesDir = path.join(repoRoot, 'src/sites');
const allowedDirectClientImports = new Set([
  'src/sites/capabilities.ts',
  'src/sites/runner.ts',
]);

test('direct daemon client imports stay within the explicit allowlist', () => {
  const found = [];
  for (const entry of fs.readdirSync(sitesDir)) {
    if (!entry.endsWith('.ts')) continue;
    const fullPath = path.join(sitesDir, entry);
    const relative = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    const source = fs.readFileSync(fullPath, 'utf8');
    if (source.includes("from '../daemon/client.js'")) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, [...allowedDirectClientImports].sort());
  assert.equal(found.includes('src/sites/xhs.ts'), false);
});

test('site adapters use the capabilities facade instead of helper internals', () => {
  const found = [];
  for (const entry of fs.readdirSync(sitesDir)) {
    if (!entry.endsWith('.ts')) continue;
    const fullPath = path.join(sitesDir, entry);
    const relative = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    const source = fs.readFileSync(fullPath, 'utf8');
    if (source.includes("from './helpers.js'")) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});

test('legacy helper module remains a compatibility shim over capabilities', () => {
  const source = fs.readFileSync(path.join(sitesDir, 'helpers.ts'), 'utf8');
  assert.equal(source.includes("from '../daemon/client.js'"), false);
  assert.equal(source.includes("from './capabilities.js'"), true);
});


test('site http utilities stay browser-kernel neutral', () => {
  const source = fs.readFileSync(path.join(sitesDir, 'http-utils.ts'), 'utf8');
  assert.equal(source.includes("from './capabilities.js'"), false);
  assert.equal(source.includes("from '../daemon/client.js'"), false);
  assert.equal(source.includes('addPageIdOption'), false);
});

test('capabilities facade does not expose legacy daemon-shaped adapter names', () => {
  const source = fs.readFileSync(path.join(sitesDir, 'capabilities.ts'), 'utf8');
  const legacyExports = [
    'browserUpload',
    'evaluate',
    'getNetworkBody',
    'listNetwork',
    'listPages',
    'navigatePage',
    'openPage',
    'reloadPage',
    'requestReplayWithBody',
    'requestReplayWithUrl',
  ];

  const leaked = legacyExports.filter(name => new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(source));
  assert.deepEqual(leaked, []);
});
