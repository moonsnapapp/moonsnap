#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const RANGE_PREFIX = /^[~^<>=*]/;

function shouldSkipDir(name) {
  return [
    '.git',
    '.next',
    'dist',
    'node_modules',
    'target',
  ].includes(name);
}

function shouldTraverseDir(entry) {
  return entry.isDirectory() && !shouldSkipDir(entry.name);
}

function isPackageJsonFile(entry) {
  return entry.isFile() && entry.name === 'package.json';
}

function collectPackageJsonEntry(dir, entry, files) {
  const fullPath = path.join(dir, entry.name);
  if (shouldTraverseDir(entry)) {
    collectPackageJsonFiles(fullPath, files);
    return;
  }

  if (isPackageJsonFile(entry)) {
    files.push(fullPath);
  }
}

function collectPackageJsonFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    collectPackageJsonEntry(dir, entry, files);
  }

  return files;
}

function isAllowedProtocol(version) {
  return [
    'file:',
    'link:',
    'portal:',
    'workspace:',
  ].some((prefix) => version.startsWith(prefix));
}

const violations = [];

for (const file of collectPackageJsonFiles(ROOT)) {
  const packageJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section];
    if (!dependencies) {
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== 'string' || isAllowedProtocol(version)) {
        continue;
      }

      if (RANGE_PREFIX.test(version) || version.includes(' - ') || version.includes('||')) {
        violations.push({
          file: path.relative(ROOT, file),
          section,
          name,
          version,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Dependency versions must be pinned. Found ranges:');
  for (const violation of violations) {
    console.error(
      `- ${violation.file} ${violation.section}.${violation.name}: ${violation.version}`,
    );
  }
  process.exit(1);
}

console.log('All dependency versions are pinned.');
