import { changelog as localChangelog } from "@moonsnap/changelog";
import type { ChangelogDocument } from "@moonsnap/changelog";

const RELEASE_REPO = process.env.NEXT_PUBLIC_RELEASE_REPO ?? "moonsnapapp/moonsnap";
const CHANGELOG_ASSET_NAME = process.env.NEXT_PUBLIC_CHANGELOG_ASSET_NAME ?? "changelog.generated.json";
const CHANGELOG_REPO = process.env.MOONSNAP_CHANGELOG_REPO ?? "moonsnapapp/moonsnap";
const CHANGELOG_BRANCH = process.env.MOONSNAP_CHANGELOG_BRANCH ?? "main";
const CHANGELOG_FILE_PATH =
  process.env.MOONSNAP_CHANGELOG_FILE_PATH ?? "packages/changelog/src/changelog.generated.json";
const GITHUB_TOKEN = process.env.MOONSNAP_GITHUB_TOKEN;
const REVALIDATE_SECONDS = 900;

interface LatestJsonPayload {
  version?: unknown;
}

const normalizeReleaseVersion = (version: string): string => version.replace(/^v/, "");

const isChangelogDocument = (value: unknown): value is ChangelogDocument => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChangelogDocument>;
  return typeof candidate.source === "string" && Array.isArray(candidate.entries);
};

const fetchChangelogDocument = async (
  url: string,
  init?: RequestInit,
): Promise<ChangelogDocument | null> => {
  try {
    const response = await fetch(url, {
      ...init,
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    return isChangelogDocument(payload) ? payload : null;
  } catch {
    return null;
  }
};

const getChangelogApiHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "moonsnap-web",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  return headers;
};

export const getLatestReleaseVersion = async (): Promise<string | null> => {
  const url = `https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`;

  try {
    const response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as LatestJsonPayload;
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
};

export const getWindowsInstallerDownloadUrl = (version: string | null | undefined): string | null => {
  if (!version) {
    return null;
  }

  const normalizedVersion = normalizeReleaseVersion(version);
  return `https://github.com/${RELEASE_REPO}/releases/download/v${normalizedVersion}/MoonSnap_${normalizedVersion}_x64-setup.exe`;
};

export const getChangelogDocument = async (): Promise<ChangelogDocument> => {
  const releaseAssetUrl = `https://github.com/${RELEASE_REPO}/releases/latest/download/${CHANGELOG_ASSET_NAME}`;
  const releaseChangelog = await fetchChangelogDocument(releaseAssetUrl);
  if (releaseChangelog) {
    return releaseChangelog;
  }

  const url = `https://api.github.com/repos/${CHANGELOG_REPO}/contents/${CHANGELOG_FILE_PATH}?ref=${CHANGELOG_BRANCH}`;
  return await fetchChangelogDocument(url, { headers: getChangelogApiHeaders() }) ?? localChangelog;
};

export const RELEASE_REVALIDATE_SECONDS = REVALIDATE_SECONDS;
