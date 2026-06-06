import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const cli = join(root, 'dist/cli/main.js');

function run(args, env) {
  const result = spawnSync(process.execPath, [cli, '--profile', 'auth-import-smoke', '--json', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('auth import-browser previews fake chromium source without secrets in output', () => {
  const home = mkdtempSync(join(tmpdir(), 'siteflow-auth-import-home-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'siteflow-fake-chrome-'));
  const env = { ...process.env, SITEFLOW_HOME: home, SITEFLOW_HEADLESS: 'true' };
  try {
    mkdirSync(join(sourceRoot, 'Default', 'Network'), { recursive: true });
    mkdirSync(join(sourceRoot, 'Default', 'Local Storage', 'leveldb'), { recursive: true });
    writeFileSync(join(sourceRoot, 'Local State'), JSON.stringify({ profile: { last_used: 'Default', info_cache: { Default: { active_time: 1 } } } }));
    writeFileSync(join(sourceRoot, 'Default', 'Local Storage', 'leveldb', '000003.log'), 'https://example.test token secret');
    const sources = run(['auth', 'sources', '--profile-source-root', sourceRoot], env);
    assert.equal(sources.ok, true);
    assert.ok(sources.data.sources.some(source => source.id === 'chrome:Default'));

    const preview = run(['auth', 'import-browser', '--preview', '--source', 'chrome:Default', '--profile-source-root', sourceRoot, '--domain', 'example.test'], env);
    assert.equal(preview.ok, true);
    assert.equal(preview.data.preview, true);
    assert.equal(JSON.stringify(preview).includes('secret'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});
