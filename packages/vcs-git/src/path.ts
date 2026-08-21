import { GitError } from "./errors.js";

export function normalizeGitPath(value: string): string {
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    throw new GitError(
      "diff_path_invalid",
      "Git returned an invalid repository-relative path.",
      {
        operation: "normalize_diff_path",
      },
    );
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new GitError(
      "diff_path_invalid",
      "Git returned an invalid repository-relative path.",
      {
        operation: "normalize_diff_path",
      },
    );
  }
  return normalized;
}

export function compareGitPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
