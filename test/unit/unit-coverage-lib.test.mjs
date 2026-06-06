import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUncoveredReport, parseCoverageFiles, parseCoverageSummary } from '../../scripts/unit-coverage-lib.mjs';

const sampleOutput = `ℹ start of coverage report
ℹ ---------------------------------------------------------------------
ℹ file                         | line % | branch % | funcs % | uncovered lines
ℹ ---------------------------------------------------------------------
ℹ dist                         |        |          |         |
ℹ  runtime                     |        |          |         |
ℹ   browser-runtime.js         |  31.26 |    71.43 |   31.71 | 47-48 52-62
ℹ   replay-runtime.js          |  98.60 |    90.63 |  100.00 | 97-98
ℹ  sites                       |        |          |         |
ℹ   youtube.js                 |  87.61 |    79.69 |   80.85 | 33-35 49-72
ℹ all files                    |  35.30 |    77.58 |   37.64 |
ℹ ---------------------------------------------------------------------
ℹ end of coverage report`;

test('parseCoverageSummary reads all-files percentages', () => {
  assert.deepEqual(parseCoverageSummary(sampleOutput), {
    linesPct: 35.3,
    branchesPct: 77.58,
    functionsPct: 37.64,
  });
});

test('parseCoverageFiles reconstructs nested paths and uncovered lines', () => {
  assert.deepEqual(parseCoverageFiles(sampleOutput), [
    {
      path: 'dist/runtime/browser-runtime.js',
      linePct: 31.26,
      branchesPct: 71.43,
      functionsPct: 31.71,
      uncovered: '47-48 52-62',
    },
    {
      path: 'dist/runtime/replay-runtime.js',
      linePct: 98.6,
      branchesPct: 90.63,
      functionsPct: 100,
      uncovered: '97-98',
    },
    {
      path: 'dist/sites/youtube.js',
      linePct: 87.61,
      branchesPct: 79.69,
      functionsPct: 80.85,
      uncovered: '33-35 49-72',
    },
  ]);
});

test('formatUncoveredReport sorts by lowest line coverage first', () => {
  const report = formatUncoveredReport(parseCoverageFiles(sampleOutput));
  assert.match(report, /^1\. dist\/runtime\/browser-runtime\.js/m);
  assert.match(report, /2\. dist\/sites\/youtube\.js/m);
  assert.match(report, /3\. dist\/runtime\/replay-runtime\.js/m);
});
