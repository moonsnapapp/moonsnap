#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const COVERAGE_FILE = path.join(ROOT_DIR, 'coverage', 'coverage-final.json');

const CRITICAL_THRESHOLDS = {
  'src/stores/videoEditor/timelineSlice.ts': {
    statements: 95,
    branches: 80,
    functions: 95,
    lines: 95,
  },
  'src/stores/videoEditor/exportSlice.ts': {
    statements: 80,
    branches: 55,
    functions: 40,
    lines: 80,
  },
  'src/components/VideoEditor/VideoTimeline.tsx': {
    statements: 55,
    branches: 45,
    functions: 50,
    lines: 55,
  },
};

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function percentage(covered, total) {
  if (total <= 0) return 100;
  return (covered / total) * 100;
}

function computeCounterCoverage(counterMap) {
  const values = Object.values(counterMap);
  const total = values.length;
  const covered = values.filter((count) => count > 0).length;
  return percentage(covered, total);
}

function computeBranchCoverage(branchMap) {
  let total = 0;
  let covered = 0;

  for (const counts of Object.values(branchMap)) {
    total += counts.length;
    covered += counts.filter((count) => count > 0).length;
  }

  return percentage(covered, total);
}

function computeLineCoverage(statementMap, statementCounts) {
  const executableLines = new Set();
  const coveredLines = new Set();

  for (const [statementId, loc] of Object.entries(statementMap)) {
    const line = loc.start.line;
    executableLines.add(line);

    if ((statementCounts[statementId] ?? 0) > 0) {
      coveredLines.add(line);
    }
  }

  return percentage(coveredLines.size, executableLines.size);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

if (!fs.existsSync(COVERAGE_FILE)) {
  console.error(`Coverage file not found: ${normalizePath(path.relative(ROOT_DIR, COVERAGE_FILE))}`);
  console.error('Run `bun run test:coverage` first.');
  process.exit(1);
}

const rawCoverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
const failures = [];

for (const [relativeTarget, threshold] of Object.entries(CRITICAL_THRESHOLDS)) {
  const normalizedTarget = normalizePath(path.join(ROOT_DIR, relativeTarget));
  const matchingPath = Object.keys(rawCoverage).find(
    (candidate) => normalizePath(candidate) === normalizedTarget
  );

  if (!matchingPath) {
    failures.push({
      target: relativeTarget,
      message: 'File is missing from coverage report.',
    });
    continue;
  }

  const fileCoverage = rawCoverage[matchingPath];
  const actual = {
    statements: computeCounterCoverage(fileCoverage.s),
    branches: computeBranchCoverage(fileCoverage.b),
    functions: computeCounterCoverage(fileCoverage.f),
    lines: computeLineCoverage(fileCoverage.statementMap, fileCoverage.s),
  };

  for (const metric of Object.keys(threshold)) {
    if (actual[metric] < threshold[metric]) {
      failures.push({
        target: relativeTarget,
        message: `${metric} ${round(actual[metric])}% < ${threshold[metric]}%`,
      });
    }
  }

  console.log(
    `${relativeTarget}: statements ${round(actual.statements)}%, branches ${round(actual.branches)}%, functions ${round(actual.functions)}%, lines ${round(actual.lines)}%`
  );
}

if (failures.length > 0) {
  console.error('\nCritical coverage check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.target}: ${failure.message}`);
  }
  process.exit(1);
}

console.log('\nCritical coverage thresholds satisfied.');
