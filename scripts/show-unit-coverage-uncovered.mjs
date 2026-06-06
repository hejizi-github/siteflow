import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { formatUncoveredReport, parseCoverageFiles } from './unit-coverage-lib.mjs';

const repoRoot = process.cwd();
const coverageDir = path.join(repoRoot, 'coverage');
const logPath = path.join(coverageDir, 'unit-coverage.txt');
const uncoveredMdPath = path.join(coverageDir, 'uncovered-lines.md');
const uncoveredJsonPath = path.join(coverageDir, 'uncovered-lines.json');

async function main() {
  if (!existsSync(logPath)) {
    process.stdout.write('No coverage log found. Running npm run test:coverage first...\n');
    await run('npm', ['run', 'test:coverage']);
  }

  const output = readFileSync(logPath, 'utf8');
  const files = parseCoverageFiles(output)
    .filter(file => file.uncovered)
    .sort((a, b) => a.linePct - b.linePct || a.path.localeCompare(b.path));

  const report = formatUncoveredReport(files);
  const payload = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
  };

  await writeFile(uncoveredJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(uncoveredMdPath, `# Uncovered Unit Coverage Lines\n\n${report}\n`);

  process.stdout.write(`${report}\n\nSaved:\n- ${path.relative(repoRoot, uncoveredMdPath)}\n- ${path.relative(repoRoot, uncoveredJsonPath)}\n`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
