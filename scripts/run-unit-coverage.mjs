import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseCoverageSummary } from './unit-coverage-lib.mjs';

const repoRoot = process.cwd();
const coverageDir = path.join(repoRoot, 'coverage');
const rawCoverageDir = path.join(coverageDir, 'raw');
const logPath = path.join(coverageDir, 'unit-coverage.txt');
const summaryJsonPath = path.join(coverageDir, 'summary.json');
const summaryMdPath = path.join(coverageDir, 'summary.md');

const thresholdFlags = [
  ['SITEFLOW_COVERAGE_LINES', '--test-coverage-lines'],
  ['SITEFLOW_COVERAGE_BRANCHES', '--test-coverage-branches'],
  ['SITEFLOW_COVERAGE_FUNCTIONS', '--test-coverage-functions'],
].flatMap(([envName, flag]) => {
  const value = process.env[envName]?.trim();
  return value ? [`${flag}=${value}`] : [];
});

async function main() {
  await rm(coverageDir, { recursive: true, force: true });
  await mkdir(rawCoverageDir, { recursive: true });

  await run('npm', ['run', 'build']);

  const testFiles = await collectTestFiles(path.join(repoRoot, 'test', 'unit'));
  if (testFiles.length === 0) {
    throw new Error('No unit test files found under test/unit');
  }

  const log = createWriteStream(logPath, { flags: 'a' });
  try {
    const output = await run(
      process.execPath,
      ['--test', '--experimental-test-coverage', ...thresholdFlags, ...testFiles],
      {
        env: {
          ...process.env,
          NODE_V8_COVERAGE: rawCoverageDir,
        },
        onStdout: chunk => {
          process.stdout.write(chunk);
          log.write(chunk);
        },
        onStderr: chunk => {
          process.stderr.write(chunk);
          log.write(chunk);
        },
      },
    );

    const summary = {
      ...parseCoverageSummary(output.combined),
      thresholds: {
        lines: process.env.SITEFLOW_COVERAGE_LINES ? Number(process.env.SITEFLOW_COVERAGE_LINES) : null,
        branches: process.env.SITEFLOW_COVERAGE_BRANCHES ? Number(process.env.SITEFLOW_COVERAGE_BRANCHES) : null,
        functions: process.env.SITEFLOW_COVERAGE_FUNCTIONS ? Number(process.env.SITEFLOW_COVERAGE_FUNCTIONS) : null,
      },
    };
    await writeSummaryFiles(summary, testFiles.length);
    process.stdout.write(`\nCoverage summary saved to ${path.relative(repoRoot, summaryMdPath)}\n`);
  } finally {
    await new Promise(resolve => log.end(resolve));
  }
}

async function collectTestFiles(root) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', reject);
    child.on('close', code => {
      const combined = `${stdout}${stderr}`;
      if (code === 0) {
        resolve({ stdout, stderr, combined });
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.combined = combined;
      reject(error);
    });
  });
}


async function writeSummaryFiles(summary, testFileCount) {
  const payload = {
    generatedAt: new Date().toISOString(),
    testFileCount,
    coverage: {
      linesPct: summary.linesPct,
      branchesPct: summary.branchesPct,
      functionsPct: summary.functionsPct,
    },
    thresholds: summary.thresholds,
    artifacts: {
      rawCoverageDir: path.relative(repoRoot, rawCoverageDir),
      logPath: path.relative(repoRoot, logPath),
    },
  };

  await writeFile(summaryJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(
    summaryMdPath,
    [
      '# Unit Coverage Summary',
      '',
      `Generated: ${payload.generatedAt}`,
      '',
      '| Metric | Coverage | Threshold |',
      '| --- | ---: | ---: |',
      `| Lines | ${summary.linesPct.toFixed(2)}% | ${formatThreshold(summary.thresholds.lines)} |`,
      `| Branches | ${summary.branchesPct.toFixed(2)}% | ${formatThreshold(summary.thresholds.branches)} |`,
      `| Functions | ${summary.functionsPct.toFixed(2)}% | ${formatThreshold(summary.thresholds.functions)} |`,
      '',
      `Test files: ${testFileCount}`,
      '',
      `Raw V8 coverage: \`${path.relative(repoRoot, rawCoverageDir)}\``,
      `Runner log: \`${path.relative(repoRoot, logPath)}\``,
      '',
    ].join('\n'),
  );
}

function formatThreshold(value) {
  return value == null ? 'n/a' : `${value.toFixed(2)}%`;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
