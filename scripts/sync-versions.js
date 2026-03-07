#!/usr/bin/env node
/**
 * Syncs version from root package.json to all other version files.
 * Called automatically by npm version lifecycle hook.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;

// ---------------------------------------------------------------------------
// Pre-flight: ensure CHANGELOG.md has an entry for this version
// ---------------------------------------------------------------------------
const changelogPath = path.join(ROOT, 'CHANGELOG.md');
const changelogMd = fs.readFileSync(changelogPath, 'utf8');
const versionHeaderRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm');

const isPrerelease = version.includes('-');
if (!isPrerelease && !versionHeaderRe.test(changelogMd)) {
  console.error(
    `\n  ERROR: CHANGELOG.md has no entry for version ${version}.\n` +
    `  Add a "## [${version}] - YYYY-MM-DD" section before running \`bun run release\`.\n`,
  );
  process.exit(1);
}

// Sync apps/desktop/package.json
const desktopPkg = path.join(ROOT, 'apps/desktop/package.json');
const desktopContent = JSON.parse(fs.readFileSync(desktopPkg, 'utf8'));
desktopContent.version = version;
fs.writeFileSync(desktopPkg, JSON.stringify(desktopContent, null, 2) + '\n');

// Sync apps/desktop/src-tauri/tauri.conf.json
const tauriConf = path.join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const tauriContent = JSON.parse(fs.readFileSync(tauriConf, 'utf8'));
tauriContent.version = version;
fs.writeFileSync(tauriConf, JSON.stringify(tauriContent, null, 2) + '\n');

// Sync apps/desktop/src-tauri/Cargo.toml (first version line only)
const cargoToml = path.join(ROOT, 'apps/desktop/src-tauri/Cargo.toml');
let cargoContent = fs.readFileSync(cargoToml, 'utf8');
cargoContent = cargoContent.replace(/^version = "[^"]*"/m, `version = "${version}"`);
fs.writeFileSync(cargoToml, cargoContent);

// Update Cargo.lock by running cargo metadata (fast, just updates lockfile)
const tauriDir = path.join(ROOT, 'apps/desktop/src-tauri');
try {
  execSync('cargo metadata --format-version=1', {
    cwd: tauriDir,
    stdio: 'ignore',
  });
} catch {
  // Ignore errors - Cargo.lock will be updated on next build anyway
}

console.log(`Synced version ${version} to all files`);
