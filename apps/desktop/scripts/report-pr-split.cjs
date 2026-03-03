#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = execSync('git rev-parse --show-toplevel', {
  cwd: appRoot,
  encoding: 'utf8',
}).trim();

const statusOutput = execSync('git status --porcelain', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trimEnd();

/**
 * Bucket labels:
 * - PR1: crate scaffolding + app compatibility shims
 * - PR2: capture runtime extraction
 * - PR3: export runtime extraction
 * - PR4: ts-rs/typegen guardrails + generated types + planning docs
 */
const bucketRules = [
  {
    bucket: 'PR4',
    test: (p) =>
      p === 'AGENTS.md' ||
      p === '.github/workflows/ci.yml' ||
      p === 'apps/desktop/package.json' ||
      p === 'apps/desktop/scripts/check-ts-rs-paths.cjs' ||
      p === 'apps/desktop/scripts/report-pr-split.cjs' ||
      p === 'apps/desktop/src-tauri/.gitignore' ||
      p === 'apps/desktop/src-tauri/crates/LIB_EXTRACTION_PLAN.md' ||
      p === 'apps/desktop/src-tauri/crates/SEMVER_POLICY.md' ||
      p === 'apps/desktop/src-tauri/crates/PR_SPLIT_PLAN.md' ||
      p === 'apps/desktop/src-tauri/crates/PR_SPLIT_REPORT.md' ||
      p.startsWith('apps/desktop/src/types/generated/'),
  },
  {
    bucket: 'PR2',
    test: (p) =>
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-capture/') ||
      p.startsWith('apps/desktop/src-tauri/src/commands/video_recording/') ||
      p === 'apps/desktop/src-tauri/src/config/recording.rs' ||
      p === 'apps/desktop/src-tauri/src/config/webcam.rs' ||
      p === 'apps/desktop/src-tauri/src/lib.rs',
  },
  {
    bucket: 'PR3',
    test: (p) =>
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-export/') ||
      p.startsWith('apps/desktop/src-tauri/src/rendering/exporter/') ||
      p === 'apps/desktop/src-tauri/src/rendering/prerendered_text.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/cursor.rs',
  },
  {
    bucket: 'PR1',
    test: (p) =>
      p === 'apps/desktop/src-tauri/Cargo.toml' ||
      p === 'apps/desktop/src-tauri/Cargo.lock' ||
      p === 'apps/desktop/src-tauri/crates/README.md' ||
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-core/') ||
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-domain/') ||
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-media/') ||
      p.startsWith('apps/desktop/src-tauri/crates/moonsnap-render/') ||
      p === 'apps/desktop/src-tauri/src/error.rs' ||
      p === 'apps/desktop/src-tauri/src/app/tray.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/AGENTS.md' ||
      p === 'apps/desktop/src-tauri/src/commands/captions/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/captions/audio.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/capture/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/capture/fallback.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/text_prerender.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/preview.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/window/capture.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/captions/types.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/capture/types.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/capture_settings.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/storage/ffmpeg.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/storage/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/storage/operations.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/storage/tests.rs' ||
      p === 'apps/desktop/src-tauri/src/commands/storage/types.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/background.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/caption_layer.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/caption_parity_test.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/caption_pixel_test.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/compositor.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/coord.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/decoder.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/editor_instance.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/nv12_converter.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/parity.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/scene.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/stream_decoder.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/text_overlay_layer.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/text.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/text_layer.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/types.rs' ||
      p === 'apps/desktop/src-tauri/src/rendering/zoom.rs' ||
      p === 'apps/desktop/src-tauri/src/preview/mod.rs' ||
      p === 'apps/desktop/src-tauri/src/preview/native_surface.rs',
  },
];

const bucketPathspecs = {
  PR1: [
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock',
    'apps/desktop/src-tauri/crates/README.md',
    'apps/desktop/src-tauri/crates/moonsnap-core',
    'apps/desktop/src-tauri/crates/moonsnap-domain',
    'apps/desktop/src-tauri/crates/moonsnap-media',
    'apps/desktop/src-tauri/crates/moonsnap-render',
    'apps/desktop/src-tauri/src/error.rs',
    'apps/desktop/src-tauri/src/app/tray.rs',
    'apps/desktop/src-tauri/src/commands/AGENTS.md',
    'apps/desktop/src-tauri/src/commands/captions/mod.rs',
    'apps/desktop/src-tauri/src/commands/captions/audio.rs',
    'apps/desktop/src-tauri/src/commands/capture/mod.rs',
    'apps/desktop/src-tauri/src/commands/capture/fallback.rs',
    'apps/desktop/src-tauri/src/commands/text_prerender.rs',
    'apps/desktop/src-tauri/src/commands/preview.rs',
    'apps/desktop/src-tauri/src/commands/window/capture.rs',
    'apps/desktop/src-tauri/src/commands/captions/types.rs',
    'apps/desktop/src-tauri/src/commands/capture/types.rs',
    'apps/desktop/src-tauri/src/commands/mod.rs',
    'apps/desktop/src-tauri/src/commands/capture_settings.rs',
    'apps/desktop/src-tauri/src/commands/storage/ffmpeg.rs',
    'apps/desktop/src-tauri/src/commands/storage/mod.rs',
    'apps/desktop/src-tauri/src/commands/storage/operations.rs',
    'apps/desktop/src-tauri/src/commands/storage/tests.rs',
    'apps/desktop/src-tauri/src/commands/storage/types.rs',
    'apps/desktop/src-tauri/src/rendering/background.rs',
    'apps/desktop/src-tauri/src/rendering/caption_layer.rs',
    'apps/desktop/src-tauri/src/rendering/caption_parity_test.rs',
    'apps/desktop/src-tauri/src/rendering/caption_pixel_test.rs',
    'apps/desktop/src-tauri/src/rendering/compositor.rs',
    'apps/desktop/src-tauri/src/rendering/coord.rs',
    'apps/desktop/src-tauri/src/rendering/decoder.rs',
    'apps/desktop/src-tauri/src/rendering/editor_instance.rs',
    'apps/desktop/src-tauri/src/rendering/mod.rs',
    'apps/desktop/src-tauri/src/rendering/nv12_converter.rs',
    'apps/desktop/src-tauri/src/rendering/parity.rs',
    'apps/desktop/src-tauri/src/rendering/scene.rs',
    'apps/desktop/src-tauri/src/rendering/stream_decoder.rs',
    'apps/desktop/src-tauri/src/rendering/text_overlay_layer.rs',
    'apps/desktop/src-tauri/src/rendering/text.rs',
    'apps/desktop/src-tauri/src/rendering/text_layer.rs',
    'apps/desktop/src-tauri/src/rendering/types.rs',
    'apps/desktop/src-tauri/src/rendering/zoom.rs',
    'apps/desktop/src-tauri/src/preview/mod.rs',
    'apps/desktop/src-tauri/src/preview/native_surface.rs',
  ],
  PR2: [
    'apps/desktop/src-tauri/crates/moonsnap-capture',
    'apps/desktop/src-tauri/src/commands/video_recording',
    'apps/desktop/src-tauri/src/config/recording.rs',
    'apps/desktop/src-tauri/src/config/webcam.rs',
    'apps/desktop/src-tauri/src/lib.rs',
  ],
  PR3: [
    'apps/desktop/src-tauri/crates/moonsnap-export',
    'apps/desktop/src-tauri/src/rendering/exporter',
    'apps/desktop/src-tauri/src/rendering/cursor.rs',
    'apps/desktop/src-tauri/src/rendering/prerendered_text.rs',
  ],
  PR4: [
    'AGENTS.md',
    '.github/workflows/ci.yml',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/.gitignore',
    'apps/desktop/scripts/check-ts-rs-paths.cjs',
    'apps/desktop/scripts/report-pr-split.cjs',
    'apps/desktop/src-tauri/crates/LIB_EXTRACTION_PLAN.md',
    'apps/desktop/src-tauri/crates/SEMVER_POLICY.md',
    'apps/desktop/src-tauri/crates/PR_SPLIT_PLAN.md',
    'apps/desktop/src-tauri/crates/PR_SPLIT_REPORT.md',
    'apps/desktop/src/types/generated',
  ],
};

function parseStatusLine(line) {
  // format: XY <path> OR XY <old> -> <new>
  const status = line.slice(0, 2);
  const raw = line.slice(3).trim();
  const pathPart = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
  return {
    status,
    path: pathPart.replace(/\\/g, '/'),
  };
}

const parsed = statusOutput
  ? statusOutput
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseStatusLine)
  : [];

const buckets = {
  PR1: [],
  PR2: [],
  PR3: [],
  PR4: [],
  UNASSIGNED: [],
};

for (const item of parsed) {
  const rule = bucketRules.find((r) => r.test(item.path));
  if (rule) {
    buckets[rule.bucket].push(item);
  } else {
    buckets.UNASSIGNED.push(item);
  }
}

const summary = Object.entries(buckets)
  .map(([name, items]) => `${name}: ${items.length}`)
  .join(' | ');

console.log(summary);

for (const name of ['PR1', 'PR2', 'PR3', 'PR4', 'UNASSIGNED']) {
  const items = buckets[name];
  if (items.length === 0) continue;
  console.log(`\n[${name}]`);
  for (const item of items) {
    console.log(`- ${item.status} ${item.path}`);
  }
}

const reportPath = path.join(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'crates',
  'PR_SPLIT_REPORT.md'
);

const lines = [];
lines.push('# PR Split Report');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push(`Summary: ${summary}`);
lines.push('');

for (const name of ['PR1', 'PR2', 'PR3', 'PR4', 'UNASSIGNED']) {
  const items = buckets[name];
  lines.push(`## ${name}`);
  if (items.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of items) {
      lines.push(`- \`${item.status}\` ${item.path}`);
    }
  }
  lines.push('');
}

lines.push('## Suggested Staging Commands');
lines.push('');
for (const name of ['PR1', 'PR2', 'PR3', 'PR4']) {
  const specs = bucketPathspecs[name] || [];
  lines.push(`### ${name}`);
  if (specs.length === 0) {
    lines.push('- (none)');
    lines.push('');
    continue;
  }

  const command = `git add ${specs.join(' ')}`;
  lines.push('```bash');
  lines.push(command);
  lines.push('```');
  lines.push('');
}

fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`\nWrote ${path.relative(repoRoot, reportPath).replace(/\\/g, '/')}`);

if (buckets.UNASSIGNED.length > 0) {
  process.exitCode = 2;
}
