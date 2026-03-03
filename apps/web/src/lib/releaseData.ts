import { changelog as localChangelog } from "@moonsnap/changelog";
import type { ChangelogDocument } from "@moonsnap/changelog";

const RELEASE_REPO = process.env.NEXT_PUBLIC_RELEASE_REPO ?? "walterlow/moonsnap-releases";
const CHANGELOG_ASSET_NAME = process.env.NEXT_PUBLIC_CHANGELOG_ASSET_NAME ?? "changelog.generated.json";
const CHANGELOG_REPO = process.env.MOONSNAP_CHANGELOG_REPO ?? "walterlow/moonsnap";
const CHANGELOG_BRANCH = process.env.MOONSNAP_CHANGELOG_BRANCH ?? "main";
const CHANGELOG_FILE_PATH =
  process.env.MOONSNAP_CHANGELOG_FILE_PATH ?? "packages/changelog/src/changelog.generated.json";
const GITHUB_TOKEN = process.env.MOONSNAP_GITHUB_TOKEN;
const REVALIDATE_SECONDS = 900;

interface LatestJsonPayload {
  version?: unknown;
}

const isChangelogDocument = (value: unknown): value is ChangelogDocument => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChangelogDocument>;
  return typeof candidate.source === "string" && Array.isArray(candidate.entries);
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

export const getChangelogDocument = async (): Promise<ChangelogDocument> => {
  const releaseAssetUrl = `https://github.com/${RELEASE_REPO}/releases/latest/download/${CHANGELOG_ASSET_NAME}`;
  try {
    const response = await fetch(releaseAssetUrl, {
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (response.ok) {
      const payload = (await response.json()) as unknown;
      if (isChangelogDocument(payload)) {
        return payload;
      }
    }
  } catch {
    // Fall through to GitHub API lookup.
  }

  const url = `https://api.github.com/repos/${CHANGELOG_REPO}/contents/${CHANGELOG_FILE_PATH}?ref=${CHANGELOG_BRANCH}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "moonsnap-web",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(url, {
      headers,
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return localChangelog;
    }

    const payload = (await response.json()) as unknown;
    return isChangelogDocument(payload) ? payload : localChangelog;
  } catch {
    return localChangelog;
  }
};

export const RELEASE_REVALIDATE_SECONDS = REVALIDATE_SECONDS;
