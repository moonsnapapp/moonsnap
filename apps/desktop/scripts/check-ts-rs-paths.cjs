#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const tauriRoot = path.join(appRoot, 'src-tauri');
const repoRoot = path.resolve(appRoot, '..', '..');
const cratesRoot = path.join(tauriRoot, 'crates');
const CRATE_EXPORT_PATH = '../../../../src/types/generated/';

const crateRules = fs.existsSync(cratesRoot)
  ? fs
      .readdirSync(cratesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        label: entry.name,
        root: path.join(cratesRoot, entry.name, 'src'),
        expected: CRATE_EXPORT_PATH,
      }))
  : [];

const rules = [
  {
    label: 'app-shell',
    root: path.join(tauriRoot, 'src'),
    expected: '../../src/types/generated/',
  },
  ...crateRules,
];

const forbiddenGeneratedDirs = [
  path.join(tauriRoot, 'src', 'types', 'generated'),
  path.join(tauriRoot, 'crates', 'src', 'types', 'generated'),
  path.join(repoRoot, 'src', 'types', 'generated'),
];

function walkRustFiles(dir, out) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRustFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.rs')) {
      out.push(fullPath);
    }
  }
}

function relativeToRepo(p) {
  return path.relative(appRoot, p).replace(/\\/g, '/');
}

function assertExportPaths() {
  const errors = [];
  const exportRegex = /export_to\s*=\s*"([^"]+)"/g;

  for (const rule of rules) {
    const rustFiles = [];
    walkRustFiles(rule.root, rustFiles);

    for (const rustFile of rustFiles) {
      const source = fs.readFileSync(rustFile, 'utf8');
      const matches = [...source.matchAll(exportRegex)];
      for (const match of matches) {
        const configured = match[1];
        if (configured !== rule.expected) {
          errors.push(
            `[${rule.label}] ${relativeToRepo(rustFile)} has export_to="${configured}", expected "${rule.expected}"`
          );
        }
      }
    }
  }

  return errors;
}

function assertForbiddenGeneratedDirsEmpty() {
  const errors = [];
  for (const dir of forbiddenGeneratedDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    const stack = [dir];
    let fileCount = 0;
    while (stack.length > 0) {
      const cur = stack.pop();
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else {
          fileCount += 1;
        }
      }
    }

    if (fileCount > 0) {
      errors.push(
        `${relativeToRepo(dir)} contains generated files (${fileCount}). TS types must be generated under src/types/generated at app root.`
      );
    }
  }
  return errors;
}

const errors = [
  ...assertExportPaths(),
  ...assertForbiddenGeneratedDirsEmpty(),
];

if (errors.length > 0) {
  console.error('ts-rs path check failed:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log('ts-rs path check passed.');
