import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'dist/cli/main.js');
const fixturePath = path.join(repoRoot, 'test/fixtures/basic/recorder.html');
const profile = 'recorder-e2e';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseEnvelope(result) {
  const output = result.stdout.trim();
  assert.notEqual(output, '', `Expected JSON output. stderr:\n${result.stderr}`);
  return JSON.parse(output);
}

function runSiteflow(args, { siteflowHome, timeout = 30_000, allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cliPath, '--json', '--profile', profile, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SITEFLOW_HOME: siteflowHome,
      SITEFLOW_HEADLESS: '1',
    },
    encoding: 'utf8',
    timeout,
  });

  if (!allowFailure && result.status !== 0) {
    assert.fail([
      `siteflow ${args.join(' ')} exited ${result.status}`,
      result.error ? `error: ${result.error.message}` : '',
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].filter(Boolean).join('\n'));
  }

  return { result, envelope: parseEnvelope(result) };
}

function waitForDaemon(siteflowHome) {
  const deadline = Date.now() + 10_000;
  let lastEnvelope;
  while (Date.now() < deadline) {
    const { result, envelope } = runSiteflow(['daemon', 'status'], { siteflowHome, allowFailure: true, timeout: 5_000 });
    lastEnvelope = envelope;
    if (result.status === 0 && envelope.ok === true && envelope.data?.running === true) return envelope.data;
    sleepSync(100);
  }
  assert.fail(`daemon did not become ready: ${JSON.stringify(lastEnvelope)}`);
}

function assertOk(envelope, command) {
  assert.equal(envelope.ok, true, `${command} failed: ${JSON.stringify(envelope)}`);
  return envelope.data;
}

test('records, replays, and exports a browser fixture workflow', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'siteflow-recorder-e2e-'));
  const siteflowHome = path.join(tempRoot, 'home');
  const workflowPath = path.join(tempRoot, 'flow.json');
  const scriptPath = path.join(tempRoot, 'flow.sh');

  try {
    assertOk(runSiteflow(['daemon', 'start'], { siteflowHome }).envelope, 'daemon start');
    waitForDaemon(siteflowHome);

    assertOk(runSiteflow([
      'recorder', 'start',
      '--url', pathToFileURL(fixturePath).href,
      '--out', workflowPath,
    ], { siteflowHome, timeout: 60_000 }).envelope, 'recorder start');

    assertOk(runSiteflow(['browser', 'type', '--selector', '#name', '--value', 'Alice', '--timeout', '30000'], { siteflowHome, timeout: 40_000 }).envelope, 'browser type');
    assertOk(runSiteflow(['browser', 'select', '--selector', '#mode', '--option', 'Advanced', '--timeout', '30000'], { siteflowHome, timeout: 40_000 }).envelope, 'browser select');
    assertOk(runSiteflow([
      'browser', 'click',
      '--selector', '#continue',
      '--expect-text', 'Continued Alice in Advanced',
      '--timeout', '30000',
    ], { siteflowHome, timeout: 40_000 }).envelope, 'browser click');

    const stopResult = assertOk(runSiteflow(['recorder', 'stop'], { siteflowHome }).envelope, 'recorder stop');
    assert.equal(stopResult.out, workflowPath);
    assert.equal(existsSync(workflowPath), true);

    const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));
    assert.equal(workflow.kind, 'siteflow.workflow');
    assert.equal(workflow.version, 1);
    assert.equal(workflow.startUrl, pathToFileURL(fixturePath).href);

    const stepTypes = workflow.steps.map(step => step.type);
    assert.equal(stepTypes[0], 'open');
    assert.ok(stepTypes.includes('type'), `recorded steps missing type: ${stepTypes.join(',')}`);
    assert.ok(stepTypes.includes('select'), `recorded steps missing select: ${stepTypes.join(',')}`);
    assert.ok(stepTypes.includes('click'), `recorded steps missing click: ${stepTypes.join(',')}`);
    assert.equal(workflow.steps.find(step => step.type === 'type')?.value, 'Alice');
    assert.equal(workflow.steps.find(step => step.type === 'select')?.option, 'Advanced');
    assert.ok(workflow.steps.find(step => step.type === 'click')?.target, 'recorded click step has a target');

    const replayResult = assertOk(runSiteflow(['replay', 'run', workflowPath], { siteflowHome, timeout: 60_000 }).envelope, 'replay run');
    assert.equal(replayResult.ok, true);
    const replayStepTypes = replayResult.steps.map(step => step.type);
    assert.equal(replayStepTypes[0], 'open');
    assert.ok(replayStepTypes.includes('type'), `replay steps missing type: ${replayStepTypes.join(',')}`);
    assert.ok(replayStepTypes.includes('select'), `replay steps missing select: ${replayStepTypes.join(',')}`);
    assert.ok(replayStepTypes.includes('click'), `replay steps missing click: ${replayStepTypes.join(',')}`);

    const exportResult = assertOk(runSiteflow(['replay', 'export-cli', workflowPath, '--out', scriptPath], { siteflowHome }).envelope, 'replay export-cli');
    assert.equal(exportResult.out, scriptPath);
    assert.equal(existsSync(scriptPath), true);
    const script = readFileSync(scriptPath, 'utf8');
    assert.match(script, /siteflow --json browser/);
  } finally {
    runSiteflow(['daemon', 'stop'], { siteflowHome, allowFailure: true, timeout: 10_000 });
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
