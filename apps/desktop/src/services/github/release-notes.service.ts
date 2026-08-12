import RELEASE_NOTES_FALLBACK_MARKDOWN from "@/assets/RELEASE_NOTES.md?raw";

const GITHUB_OWNER = "Stivenjs";
const GITHUB_REPO = "savecloud";
const DEFAULT_RELEASE_LIMIT = 10;
const TRAILING_URL_PUNCTUATION = /[),.;!?]+$/;

export interface GitHubReleaseNote {
  id: number;
  name: string;
  tagName: string;
  publishedAt: string | null;
  htmlUrl: string;
  body: string;
  prerelease: boolean;
}

interface GitHubReleaseApiItem {
  id: number;
  name: string | null;
  tag_name: string | null;
  published_at: string | null;
  created_at: string | null;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

function normalizeRelease(release: GitHubReleaseApiItem): GitHubReleaseNote {
  return {
    id: release.id,
    name: release.name?.trim() || release.tag_name?.trim() || `Release ${release.id}`,
    tagName: release.tag_name?.trim() || `release-${release.id}`,
    publishedAt: release.published_at || release.created_at,
    htmlUrl: release.html_url,
    body: release.body?.trim() || "Mejoras y correcciones.",
    prerelease: release.prerelease,
  };
}

function sortByReleaseDateDescending(left: GitHubReleaseApiItem, right: GitHubReleaseApiItem): number {
  const leftTimestamp = new Date(left.published_at || left.created_at || 0).getTime();
  const rightTimestamp = new Date(right.published_at || right.created_at || 0).getTime();
  return rightTimestamp - leftTimestamp;
}

export async function fetchGitHubReleaseNotes(
  limit = DEFAULT_RELEASE_LIMIT,
  signal?: AbortSignal
): Promise<GitHubReleaseNote[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, DEFAULT_RELEASE_LIMIT));
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=${normalizedLimit}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SaveCloud-DesktopApp",
      },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`No se pudieron cargar las notas de versión de GitHub (${response.status} ${response.statusText})`);
  }

  const releases = (await response.json()) as GitHubReleaseApiItem[];
  return releases
    .filter((release) => !release.draft)
    .sort(sortByReleaseDateDescending)
    .slice(0, normalizedLimit)
    .map(normalizeRelease);
}

function splitTrailingPunctuation(rawUrl: string): { url: string; suffix: string } {
  const trimmed = rawUrl.trim();
  const punctuationMatch = trimmed.match(TRAILING_URL_PUNCTUATION);

  if (!punctuationMatch) {
    return { url: trimmed, suffix: "" };
  }

  return {
    url: trimmed.slice(0, -punctuationMatch[0].length),
    suffix: punctuationMatch[0],
  };
}

export function linkifyReleaseMarkdown(markdown: string): string {
  return markdown.replace(/(?<!\]\()https?:\/\/[^\s<>()]+/g, (rawUrl) => {
    const { url, suffix } = splitTrailingPunctuation(rawUrl);
    return `[${url}](${url})${suffix}`;
  });
}

export function getReleaseNotesFallbackMarkdown(): string {
  return RELEASE_NOTES_FALLBACK_MARKDOWN;
}
