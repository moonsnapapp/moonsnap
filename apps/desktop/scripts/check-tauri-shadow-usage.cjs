#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const BASELINE_PATH = path.join(__dirname, 'tauri-shadow-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');
const ALLOW_TOKEN = 'tauri-shadow-allow';

const FILE_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);
const PROPERTY_PATTERNS = [/\bbox-shadow\s*:/, /\bboxShadow\s*:/];

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name);
    if (FILE_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeLine(line) {
  return line.trim().replace(/\s+/g, ' ');
}

function collectCounts() {
  const counts = {};
  const files = walkFiles(SRC_DIR);

  for (const filePath of files) {
    const relativePath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      if (line.includes(ALLOW_TOKEN)) {
        continue;
      }

      const hasShadowProperty = PROPERTY_PATTERNS.some((pattern) => pattern.test(line));
      if (!hasShadowProperty) {
        continue;
      }

      const key = `${relativePath}::${normalizeLine(line)}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Baseline is not a JSON object');
    }
    return parsed;
  } catch (error) {
    console.error(`Failed to read ${BASELINE_PATH}:`, error.message);
    process.exit(1);
  }
}

function writeBaseline(counts) {
  const sortedKeys = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  const output = {};
  for (const key of sortedKeys) {
    output[key] = counts[key];
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(output, null, 2)}\n`);
}

const currentCounts = collectCounts();

if (UPDATE_BASELINE) {
  writeBaseline(currentCounts);
  console.log(`Updated baseline at ${path.relative(ROOT_DIR, BASELINE_PATH).replace(/\\/g, '/')}`);
  process.exit(0);
}

const baselineCounts = readBaseline();
const newFindings = [];

for (const [key, count] of Object.entries(currentCounts)) {
  const baselineCount = baselineCounts[key] ?? 0;
  if (count > baselineCount) {
    const [file, snippet] = key.split('::');
    newFindings.push({ file, snippet, added: count - baselineCount });
  }
}

if (newFindings.length > 0) {
  console.error('Found new box-shadow usage beyond baseline. Use drop-shadow() for Tauri external shadows.');
  for (const finding of newFindings) {
    console.error(`- ${finding.file} (+${finding.added}): ${finding.snippet}`);
  }
  console.error('If intentional, append "tauri-shadow-allow" to the line or update baseline with:');
  console.error('  node scripts/check-tauri-shadow-usage.cjs --update-baseline');
  process.exit(1);
}

console.log('No new box-shadow usage beyond baseline.');
