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
const supportModules = new Set([
  'src/sites/capabilities.ts',
  'src/sites/flow/define-flow.ts',
  'src/sites/helpers.ts',
  'src/sites/http-utils.ts',
  'src/sites/probes/selector-runtime.ts',
  'src/sites/registry.ts',
  'src/sites/runner.ts',
  'src/sites/types.ts',
]);

function siteSourceFiles() {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const relative = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      files.push({ fullPath, relative, source: fs.readFileSync(fullPath, 'utf8') });
    }
  }
  visit(sitesDir);
  return files;
}

function adapterSourceFiles() {
  return siteSourceFiles().filter(file => !supportModules.has(file.relative));
}

test('direct daemon client imports stay within the explicit allowlist', () => {
  const found = [];
  for (const { relative, source } of siteSourceFiles()) {
    if (/from ['"](?:\.\.\/)+daemon\/client\.js['"]/.test(source)) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, [...allowedDirectClientImports].sort());
  assert.equal(found.includes('src/sites/xhs.ts'), false);
});

test('site adapters use the capabilities facade instead of helper internals', () => {
  const found = [];
  for (const { relative, source } of siteSourceFiles()) {
    if (/from ['"](?:\.\/|(?:\.\.\/)+)helpers\.js['"]/.test(source)) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});


test('site-facing modules use the capabilities facade instead of runner internals', () => {
  const found = [];
  for (const { relative, source } of siteSourceFiles()) {
    if (relative === 'src/sites/capabilities.ts') continue;
    if (/from ['"]\.\/runner\.js['"]/.test(source) || /import\(['"]\.\/runner\.js['"]\)/.test(source)) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});

test('site adapters use the capabilities facade instead of http utility internals', () => {
  const found = [];
  for (const { relative, source } of adapterSourceFiles()) {
    if (/from ['"]\.\/http-utils\.js['"]/.test(source)) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});

test('every site adapter imports the capabilities facade', () => {
  const missing = [];
  for (const { relative, source } of adapterSourceFiles()) {
    if (!/from ['"]\.\/capabilities\.js['"]/.test(source)) {
      missing.push(relative);
    }
  }

  missing.sort();
  assert.deepEqual(missing, []);
});

test('site-facing modules take site-facing types from the capabilities facade', () => {
  const found = [];
  for (const { relative, source } of siteSourceFiles()) {
    if (relative === 'src/sites/capabilities.ts' || relative === 'src/sites/runner.ts') continue;
    if (/from ['"]\.\/types\.js['"]/.test(source)) {
      found.push(relative);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});

test('site adapters do not import browser kernel or runtime internals directly', () => {
  const found = [];
  for (const { relative, source } of siteSourceFiles()) {
    const matches = source.matchAll(/from ['"]\.\.\/(runtime|daemon)\/([^'"]+)['"]/g);
    for (const match of matches) {
      const importPath = `../${match[1]}/${match[2]}`;
      if (importPath === '../daemon/client.js' && allowedDirectClientImports.has(relative)) continue;
      found.push(`${relative} -> ${importPath}`);
    }
  }

  found.sort();
  assert.deepEqual(found, []);
});

test('site adapters do not import shared internals directly', () => {
  const found = [];
  for (const { relative, source } of adapterSourceFiles()) {
    const matches = source.matchAll(/from ['"]\.\.\/shared\/([^'"]+)['"]/g);
    for (const match of matches) {
      found.push(`${relative} -> ../shared/${match[1]}`);
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
