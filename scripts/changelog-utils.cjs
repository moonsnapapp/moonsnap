#!/usr/bin/env node
/**
 * Shared changelog parsing utilities.
 */

const VERSION_HEADER_RE = /^## \[([^\]]+)\]\s*-\s*(.+)$/;
const SECTION_HEADER_RE = /^###\s+(.+)$/;
const BULLET_RE = /^-\s+(.+)$/;
const CONTINUATION_RE = /^\s{2,}(.+)$/;

/**
 * Parse a Keep a Changelog style markdown file.
 * @param {string} markdown
 * @returns {{
 *   source: string;
 *   entries: Array<{
 *     version: string;
 *     date: string;
 *     sections: Array<{ title: string; items: string[] }>;
 *   }>;
 * }}
 */
function parseChangelogMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries = [];

  let currentEntry = null;
  let currentSection = null;

  const flushSection = () => {
    if (!currentEntry || !currentSection) {
      return;
    }
    if (currentSection.items.length > 0) {
      currentEntry.sections.push(currentSection);
    }
    currentSection = null;
  };

  const flushEntry = () => {
    flushSection();
    if (currentEntry) {
      entries.push(currentEntry);
    }
    currentEntry = null;
  };

  for (const line of lines) {
    const versionMatch = line.match(VERSION_HEADER_RE);
    if (versionMatch) {
      flushEntry();
      currentEntry = {
        version: versionMatch[1].trim(),
        date: versionMatch[2].trim(),
        sections: [],
      };
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    const sectionMatch = line.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      flushSection();
      currentSection = {
        title: sectionMatch[1].trim(),
        items: [],
      };
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      currentSection.items.push(bulletMatch[1].trim());
      continue;
    }

    const continuationMatch = line.match(CONTINUATION_RE);
    if (continuationMatch && currentSection.items.length > 0) {
      const lastIndex = currentSection.items.length - 1;
      currentSection.items[lastIndex] = `${currentSection.items[lastIndex]} ${continuationMatch[1].trim()}`;
    }
  }

  flushEntry();

  return {
    source: "CHANGELOG.md",
    entries,
  };
}

/**
 * Render one changelog entry as release markdown.
 * @param {{version: string; date: string; sections: Array<{title: string; items: string[]}>}} entry
 * @returns {string}
 */
function renderReleaseMarkdown(entry) {
  const lines = [`## MoonSnap v${entry.version} (${entry.date})`, ""];

  for (const section of entry.sections) {
    if (section.items.length === 0) {
      continue;
    }
    lines.push(`### ${section.title}`);
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  parseChangelogMarkdown,
  renderReleaseMarkdown,
};
