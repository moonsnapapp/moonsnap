import changelogData from './changelog.generated.json';

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export interface ChangelogDocument {
  source: string;
  entries: ChangelogEntry[];
}

export const changelog = changelogData as ChangelogDocument;
export const latestRelease: ChangelogEntry | null = changelog.entries[0] ?? null;
