import { createHash } from "node:crypto";
import path from "node:path";
import { executeGit } from "./command.js";
import { GitError } from "./errors.js";
import type {
  GitRepository,
  RepositoryIdentity,
  RepositoryRemote,
} from "./types.js";

function normalizedPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "")
    .replace(/\.git$/u, "");
}

function remoteName(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\0\r\n]/u.test(trimmed)) return undefined;

  const scpStyle = trimmed.includes("://")
    ? null
    : /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u.exec(trimmed);
  const candidate = scpStyle ? `ssh://${scpStyle[1]}/${scpStyle[2]}` : trimmed;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (!new Set(["https:", "http:", "ssh:", "git:"]).has(url.protocol))
    return undefined;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = normalizedPath(url.pathname);
  return url.toString().replace(/\/$/u, "");
}

async function preferredRemote(
  repository: GitRepository,
): Promise<RepositoryRemote | undefined> {
  const remotesResult = await executeGit(repository.rootPath, ["remote"]);
  if (remotesResult.exitCode !== 0) return undefined;
  const names = remotesResult.stdout.split(/\s+/u).filter(Boolean).sort();
  const ordered = names.includes("origin")
    ? ["origin", ...names.filter((name) => name !== "origin")]
    : names;
  for (const name of ordered) {
    const urlResult = await executeGit(repository.rootPath, [
      "remote",
      "get-url",
      name,
    ]);
    if (urlResult.exitCode !== 0) continue;
    const url = normalizeRemoteUrl(urlResult.stdout);
    if (url) return { name, url };
  }
  return undefined;
}

async function historyLocator(repository: GitRepository): Promise<string> {
  const result = await executeGit(repository.rootPath, [
    "rev-list",
    "--max-parents=0",
    "HEAD",
  ]);
  const roots = [
    ...new Set(
      result.stdout
        .split(/\s+/u)
        .filter(Boolean)
        .map((value) => value.toLowerCase()),
    ),
  ].sort();
  if (result.exitCode !== 0 || roots.length === 0) {
    throw new GitError(
      "repository_identity_unavailable",
      "Repository identity requires a sanitized remote or committed history.",
      { operation: "create_repository_identity", exitCode: result.exitCode },
    );
  }
  return `git-history:${roots.join(",")}`;
}

export async function createRepositoryIdentity(
  repository: GitRepository,
): Promise<RepositoryIdentity> {
  const remote = await preferredRemote(repository);
  const canonicalLocator = remote?.url ?? (await historyLocator(repository));
  const digest = createHash("sha256")
    .update(canonicalLocator.normalize("NFC"), "utf8")
    .digest("hex");
  const fallbackName = path.basename(repository.rootPath).normalize("NFC");
  return {
    id: `repository.${digest}`,
    name: remote ? remoteName(remote.url, fallbackName) : fallbackName,
    source: remote ? "remote" : "history",
    canonicalLocator,
    ...(remote ? { remote } : {}),
  };
}
