/**
 * Local Update Test Server
 *
 * Usage:
 *   node scripts/update-test-server.js
 *
 * This serves a mock latest.json for testing the auto-update flow.
 *
 * To test:
 * 1. Temporarily change tauri.conf.json endpoint to: "http://localhost:3007/latest.json"
 * 2. Run this server: node scripts/update-test-server.js
 * 3. Run your app: npm run tauri dev
 * 4. Wait 5 seconds (or trigger manual check) - you should see the update toast
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3007;

// Read current version from tauri.conf.json
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src-tauri/tauri.conf.json'), 'utf8')
);
const currentVersion = tauriConfig.version;

// Mock a higher version for testing
const [major, minor, patch] = currentVersion.split('.').map(Number);
const mockVersion = `${major}.${minor}.${patch + 1}`;

// Mock update manifest
const latestJson = {
  version: mockVersion,
  notes: `Test update from ${currentVersion} to ${mockVersion}\n\n- This is a mock update for testing\n- No actual files will be downloaded`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: 'MOCK_SIGNATURE_FOR_TESTING',
      url: `http://localhost:${PORT}/mock-update.nsis.zip`
    }
  }
};

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function sendMockUpdateManifest(res) {
  sendJson(res, latestJson);
  console.log(`  -> Served update manifest (v${mockVersion})`);
}

function sendNoUpdateManifest(res) {
  sendJson(res, { ...latestJson, version: currentVersion });
  console.log(`  -> Served no-update manifest (v${currentVersion})`);
}

function sendMockDownload(res) {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': '0'
  });
  res.end();
  console.log('  -> Mock download requested (will fail signature verification - this is expected)');
}

function sendNotFound(res) {
  res.writeHead(404);
  res.end('Not found');
}

const routeHandlers = {
  '/latest.json': sendMockUpdateManifest,
  '/no-update': sendNoUpdateManifest,
  '/mock-update.nsis.zip': sendMockDownload
};

function applyCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handleOptionsRequest(res) {
  res.writeHead(204);
  res.end();
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  applyCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    handleOptionsRequest(res);
    return;
  }

  const routeHandler = routeHandlers[req.url];
  if (routeHandler) {
    routeHandler(res);
    return;
  }

  sendNotFound(res);
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   Update Test Server                           ║
╠════════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                      ║
║                                                                ║
║  Current app version: ${currentVersion.padEnd(39)}║
║  Mock update version: ${mockVersion.padEnd(39)}║
║                                                                ║
║  Endpoints:                                                    ║
║    /latest.json     → Returns mock update (v${mockVersion})            ║
║    /no-update       → Returns current version (no update)     ║
║                                                                ║
║  To test:                                                      ║
║  1. Update tauri.conf.json endpoint to:                        ║
║     "http://localhost:${PORT}/latest.json"                        ║
║  2. Run: npm run tauri dev                                     ║
║  3. Watch for update toast after 5 seconds                     ║
║                                                                ║
║  Note: Download will fail (expected) - this tests detection    ║
╚════════════════════════════════════════════════════════════════╝
`);
});
