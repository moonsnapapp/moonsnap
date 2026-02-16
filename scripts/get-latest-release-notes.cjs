#!/usr/bin/env node
/**
 * Emit markdown release notes from the latest changelog entry.
 */

const fs = require("fs");
const path = require("path");
const {
  parseChangelogMarkdown,
  renderReleaseMarkdown,
} = require("./changelog-utils.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version") {
      args.version = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const ROOT = path.resolve(__dirname, "..");
const changelogPath = path.join(ROOT, "CHANGELOG.md");
const markdown = fs.readFileSync(changelogPath, "utf8");
const parsed = parseChangelogMarkdown(markdown);
const latest = parsed.entries[0];
const { version: expectedVersion } = parseArgs(process.argv);

if (!latest) {
  console.error("No changelog entries found in CHANGELOG.md");
  process.exit(1);
}

if (expectedVersion && latest.version !== expectedVersion) {
  console.error(
    `Latest changelog version (${latest.version}) does not match requested release version (${expectedVersion}).`,
  );
  process.exit(1);
}

process.stdout.write(renderReleaseMarkdown(latest));

