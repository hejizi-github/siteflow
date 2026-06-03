import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(repoRoot, 'test/fixtures/basic');
const cli = path.join(repoRoot, 'dist/cli/main.js');
const siteflowHome = await fs.mkdtemp(path.join(os.tmpdir(), 'siteflow-fixture-'));
const profile = 'fixture-smoke';

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = path.resolve(fixtureRoot, `.${pathname}`);
      if (!target.startsWith(fixtureRoot + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await fs.readFile(target);
      res.writeHead(200, { 'content-type': contentType(target) }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function runSiteflow(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--profile', profile, '--json', ...args], {
      cwd: repoRoot,
      env: { ...process.env, SITEFLOW_HOME: siteflowHome },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout || 45_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`siteflow ${args.join(' ')} exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`siteflow ${args.join(' ')} returned non-JSON output: ${stdout}\n${error}`));
      }
    });
  });
}

const server = await createServer();
const port = server.address().port;
const fixtureUrl = `http://127.0.0.1:${port}/index.html`;

try {
  const start = await runSiteflow(['daemon', 'start']);
  assert.equal(start.ok, true);

  const opened = await runSiteflow(['browser', 'open', fixtureUrl]);
  assert.equal(opened.ok, true);
  assert.equal(opened.data.url, fixtureUrl);

  const typed = await runSiteflow(['browser', 'type', '--selector', '#message', '--value', 'hello fixture']);
  assert.equal(typed.ok, true);

  const clicked = await runSiteflow(['browser', 'click', '--selector', '#run', '--expect-text', 'ran']);
  assert.equal(clicked.ok, true);

  const evaluated = await runSiteflow(['eval', '({ title: document.title, status: document.querySelector("#status")?.textContent, message: window.__siteflowFixtureState?.message, count: window.__siteflowFixtureState?.count })']);
  assert.equal(evaluated.ok, true);
  assert.deepEqual(evaluated.data.value, {
    title: 'siteflow basic fixture',
    status: 'ran',
    message: 'hello fixture',
    count: 1,
  });

  const consoleList = await runSiteflow(['console', 'list', '--limit', '10']);
  assert.equal(consoleList.ok, true);
  assert.equal(consoleList.data.some(entry => String(entry.text).includes('SITEFLOW_BREAKPOINT_MARKER:1')), true);

  const networkList = await runSiteflow(['network', 'list', '--limit', '20']);
  assert.equal(networkList.ok, true);
  assert.equal(networkList.data.some(entry => String(entry.url).endsWith('/data.json')), true);
} finally {
  await runSiteflow(['daemon', 'stop']).catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
  await fs.rm(siteflowHome, { recursive: true, force: true });
}
