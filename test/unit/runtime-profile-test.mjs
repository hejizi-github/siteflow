import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveProfile } from '../../dist/runtime/profile.js';

const savedHome = process.env.HOME;
const savedSiteflowHome = process.env.SITEFLOW_HOME;

function cleanup(prefix) {
  try { fs.rmSync(prefix, { recursive: true, force: true }); } catch { /* ok */ }
}

test('resolveProfile("default") returns paths under ~/.siteflow/profiles/default', () => {
  const tmpHome = path.join(os.tmpdir(), 'siteflow-test-' + Date.now());
  delete process.env.SITEFLOW_HOME;
  process.env.HOME = tmpHome;

  try {
    const result = resolveProfile('default');

    assert.equal(result.profileDir, path.join(tmpHome, '.siteflow', 'profiles', 'default'));
    assert.equal(result.browserProfileDir, path.join(tmpHome, '.siteflow', 'profiles', 'default', 'browser-profile'));

    // Directories should exist (ensureProfileDirs was called)
    assert.equal(fs.existsSync(result.profileDir), true);
    assert.equal(fs.existsSync(result.browserProfileDir), true);
  } finally {
    process.env.HOME = savedHome;
    if (savedSiteflowHome) process.env.SITEFLOW_HOME = savedSiteflowHome;
    cleanup(tmpHome);
  }
});

test('resolveProfile with SITEFLOW_HOME overrides home directory', () => {
  const customHome = path.join(os.tmpdir(), 'sf-custom-' + Date.now());
  process.env.SITEFLOW_HOME = customHome;

  try {
    const result = resolveProfile('work');

    assert.equal(result.profileDir, path.join(customHome, 'profiles', 'work'));
    assert.equal(result.browserProfileDir, path.join(customHome, 'profiles', 'work', 'browser-profile'));
    assert.equal(fs.existsSync(result.profileDir), true);
  } finally {
    delete process.env.SITEFLOW_HOME;
    if (savedSiteflowHome) process.env.SITEFLOW_HOME = savedSiteflowHome;
    cleanup(customHome);
  }
});
