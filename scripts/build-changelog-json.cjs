#!/usr/bin/env node
/**
 * Build a structured changelog JSON file from CHANGELOG.md.
 */

const fs = require("fs");
const path = require("path");
const { parseChangelogMarkdown } = require("./changelog-utils.cjs");

const ROOT = path.resolve(__dirname, "..");
const changelogPath = path.join(ROOT, "CHANGELOG.md");
const outPath = path.join(
  ROOT,
  "packages",
  "changelog",
  "src",
  "changelog.generated.json",
);

const markdown = fs.readFileSync(changelogPath, "utf8");
const parsed = parseChangelogMarkdown(markdown);

if (parsed.entries.length === 0) {
  console.error("No changelog entries found in CHANGELOG.md");
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

console.log(
  `Generated ${path.relative(ROOT, outPath)} (${parsed.entries.length} entries)`,
);

