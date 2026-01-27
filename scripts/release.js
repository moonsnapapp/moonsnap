#!/usr/bin/env node
/**
 * Release script that bumps version in all package files.
 * Works cross-platform (Windows, macOS, Linux).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUMP_TYPE = process.argv[2] || 'patch';

// Paths relative to repo root
const ROOT = path.resolve(__dirname, '..');
const FILES = {
  rootPackage: path.join(ROOT, 'package.json'),
  desktopPackage: path.join(ROOT, 'apps/desktop/package.json'),
  cargoToml: path.join(ROOT, 'apps/desktop/src-tauri/Cargo.toml'),
  tauriConf: path.join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json'),
};

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updateJsonFile(filePath, newVersion) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  content.version = newVersion;
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
}

function updateCargoToml(filePath, newVersion) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Only replace the first version line (package version, not dependencies)
  content = content.replace(/^version = "[^"]*"/m, `version = "${newVersion}"`);
  fs.writeFileSync(filePath, content);
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// Main
try {
  // Read current version
  const rootPackage = JSON.parse(fs.readFileSync(FILES.rootPackage, 'utf8'));
  const currentVersion = rootPackage.version;
  const newVersion = bumpVersion(currentVersion, BUMP_TYPE);

  console.log(`Bumping ${currentVersion} → ${newVersion}`);

  // Update all files
  updateJsonFile(FILES.rootPackage, newVersion);
  updateJsonFile(FILES.desktopPackage, newVersion);
  updateJsonFile(FILES.tauriConf, newVersion);
  updateCargoToml(FILES.cargoToml, newVersion);

  console.log('Updated version files');

  // Git commit and tag
  run('git add -A');
  run(`git commit -m "${newVersion}"`);
  run(`git tag -a "v${newVersion}" -m "v${newVersion}"`);

  console.log(`\nReleased v${newVersion}`);
  console.log('Run "git push && git push --tags" to publish');
} catch (err) {
  console.error('Release failed:', err.message);
  process.exit(1);
}
