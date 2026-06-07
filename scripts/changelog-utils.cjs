#!/usr/bin/env node
/**
 * Shared changelog parsing utilities.
 */

const VERSION_HEADER_RE = /^## \[([^\]]+)\]\s*-\s*(.+)$/;
const SECTION_HEADER_RE = /^###\s+(.+)$/;
const BULLET_RE = /^-\s+(.+)$/;
const CONTINUATION_RE = /^\s{2,}(.+)$/;

function createParserState() {
  return {
    entries: [],
    currentEntry: null,
    currentSection: null,
  };
}

function flushSection(state) {
  if (!state.currentEntry || !state.currentSection) {
    return;
  }
  if (state.currentSection.items.length > 0) {
    state.currentEntry.sections.push(state.currentSection);
  }
  state.currentSection = null;
}

function flushEntry(state) {
  flushSection(state);
  if (state.currentEntry) {
    state.entries.push(state.currentEntry);
  }
  state.currentEntry = null;
}

function startEntry(state, versionMatch) {
  flushEntry(state);
  state.currentEntry = {
    version: versionMatch[1].trim(),
    date: versionMatch[2].trim(),
    sections: [],
  };
}

function startSection(state, sectionMatch) {
  flushSection(state);
  state.currentSection = {
    title: sectionMatch[1].trim(),
    items: [],
  };
}

function appendContinuation(section, continuationMatch) {
  if (section.items.length === 0) {
    return;
  }

  const lastIndex = section.items.length - 1;
  section.items[lastIndex] = `${section.items[lastIndex]} ${continuationMatch[1].trim()}`;
}

function processSectionLine(section, line) {
  const bulletMatch = line.match(BULLET_RE);
  if (bulletMatch) {
    section.items.push(bulletMatch[1].trim());
    return;
  }

  const continuationMatch = line.match(CONTINUATION_RE);
  if (continuationMatch) {
    appendContinuation(section, continuationMatch);
  }
}

function processEntryLine(state, line) {
  const sectionMatch = line.match(SECTION_HEADER_RE);
  if (sectionMatch) {
    startSection(state, sectionMatch);
    return;
  }

  if (!state.currentSection) {
    return;
  }

  processSectionLine(state.currentSection, line);
}

function processChangelogLine(state, line) {
  const versionMatch = line.match(VERSION_HEADER_RE);
  if (versionMatch) {
    startEntry(state, versionMatch);
    return;
  }

  if (!state.currentEntry) {
    return;
  }

  processEntryLine(state, line);
}

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
  const state = createParserState();

  for (const line of lines) {
    processChangelogLine(state, line);
  }

  flushEntry(state);

  return {
    source: "CHANGELOG.md",
    entries: state.entries,
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
