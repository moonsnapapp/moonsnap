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
