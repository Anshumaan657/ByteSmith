import fs from "node:fs/promises";
import path from "node:path";
import { compareCodePoints } from "@bytesmith/impact-types";
import { TypeScriptDiscoveryError } from "./errors.js";
import type { DiscoveryDiagnostic } from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "dist",
  "node_modules",
]);

export function toRepositoryPath(
  repositoryRoot: string,
  absolutePath: string,
): string | undefined {
  const relative = path.relative(repositoryRoot, absolutePath);
  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return relative.length === 0 ? "." : undefined;
  }
  return relative.split(path.sep).join("/").normalize("NFC");
}

export function repositoryDirectory(
  repositoryRoot: string,
  absolutePath: string,
): string | undefined {
  return toRepositoryPath(repositoryRoot, absolutePath);
}

export async function resolveRepositoryRoot(input: string): Promise<string> {
  try {
    const resolved = await fs.realpath(path.resolve(input));
    if (!(await fs.stat(resolved)).isDirectory()) {
      throw new TypeScriptDiscoveryError(
        "repository_path_invalid",
        "TypeScript discovery requires a repository directory.",
      );
    }
    return resolved;
  } catch (cause) {
    if (cause instanceof TypeScriptDiscoveryError) throw cause;
    throw new TypeScriptDiscoveryError(
      "repository_unreadable",
      "The repository directory cannot be read.",
      cause,
    );
  }
}

export interface ScannedRepositoryFiles {
  configFiles: string[];
  packageFiles: string[];
  pnpmWorkspaceFiles: string[];
  yarnLockFiles: string[];
  diagnostics: DiscoveryDiagnostic[];
}

export async function scanRepository(
  repositoryRoot: string,
): Promise<ScannedRepositoryFiles> {
  const result: ScannedRepositoryFiles = {
    configFiles: [],
    packageFiles: [],
    pnpmWorkspaceFiles: [],
    yarnLockFiles: [],
    diagnostics: [],
  };

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepositoryPath(repositoryRoot, absolutePath);
      if (!relativePath) continue;
      if (entry.isSymbolicLink()) {
        result.diagnostics.push({
          code: "filesystem_entry_unsupported",
          severity: "warning",
          path: relativePath,
          summary:
            "Symbolic filesystem entries are not followed during project discovery.",
        });
      } else if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        if (entry.name === "tsconfig.json" || entry.name === "jsconfig.json") {
          result.configFiles.push(absolutePath);
        } else if (entry.name === "package.json") {
          result.packageFiles.push(absolutePath);
        } else if (entry.name === "pnpm-workspace.yaml") {
          result.pnpmWorkspaceFiles.push(absolutePath);
        } else if (entry.name === "yarn.lock") {
          result.yarnLockFiles.push(absolutePath);
        }
      }
    }
  }

  await visit(repositoryRoot);
  return result;
}

export function sortDiagnostics(
  diagnostics: readonly DiscoveryDiagnostic[],
): DiscoveryDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    for (const comparison of [
      compareCodePoints(left.path ?? "", right.path ?? ""),
      (left.line ?? 0) - (right.line ?? 0),
      (left.column ?? 0) - (right.column ?? 0),
      compareCodePoints(left.code, right.code),
      compareCodePoints(left.summary, right.summary),
    ]) {
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}
