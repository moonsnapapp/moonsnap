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

function isRustFileEntry(entry) {
  return entry.isFile() && entry.name.endsWith('.rs');
}

function visitRustPath(fullPath, entry, out) {
  if (entry.isDirectory()) {
    walkRustFiles(fullPath, out);
    return;
  }

  if (isRustFileEntry(entry)) {
    out.push(fullPath);
  }
}

function walkRustFiles(dir, out) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    visitRustPath(fullPath, entry, out);
  }
}

function relativeToRepo(p) {
  return path.relative(appRoot, p).replace(/\\/g, '/');
}

function getRustFilesForRule(rule) {
  const rustFiles = [];
  walkRustFiles(rule.root, rustFiles);
  return rustFiles;
}

function getTsRsExportMatches(rustFile, exportRegex) {
  const source = fs.readFileSync(rustFile, 'utf8');
  return [...source.matchAll(exportRegex)];
}

function getExportPathError(rule, rustFile, configured) {
  if (configured === rule.expected) {
    return null;
  }

  return `[${rule.label}] ${relativeToRepo(rustFile)} has export_to="${configured}", expected "${rule.expected}"`;
}

function getRustFileExportPathErrors(rule, rustFile, exportRegex) {
  return getTsRsExportMatches(rustFile, exportRegex)
    .map((match) => getExportPathError(rule, rustFile, match[1]))
    .filter(Boolean);
}

function assertExportPaths() {
  const errors = [];
  const exportRegex = /export_to\s*=\s*"([^"]+)"/g;

  for (const rule of rules) {
    for (const rustFile of getRustFilesForRule(rule)) {
      errors.push(...getRustFileExportPathErrors(rule, rustFile, exportRegex));
    }
  }

  return errors;
}

function countFilesRecursively(dir) {
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

  return fileCount;
}

function getForbiddenGeneratedDirError(dir) {
  if (!fs.existsSync(dir)) return null;

  const fileCount = countFilesRecursively(dir);
  return fileCount > 0
    ? `${relativeToRepo(dir)} contains generated files (${fileCount}). TS types must be generated under src/types/generated at app root.`
    : null;
}

function assertForbiddenGeneratedDirsEmpty() {
  const errors = [];
  for (const dir of forbiddenGeneratedDirs) {
    const error = getForbiddenGeneratedDirError(dir);
    if (error) {
      errors.push(error);
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
