import fs from "node:fs/promises";
import path from "node:path";
import { stableId } from "@bytesmith/canonicalization";
import { compareCodePoints } from "@bytesmith/impact-types";
import { sortDiagnostics, toRepositoryPath } from "./path.js";
import type {
  DiscoveryDiagnostic,
  WorkspaceDiscovery,
  WorkspaceManager,
  WorkspacePackage,
} from "./types.js";

interface PackageJson {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;
  main?: unknown;
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
  packageManager?: unknown;
  workspaces?: unknown;
}

interface WorkspaceResult {
  workspace: WorkspaceDiscovery;
  diagnostics: DiscoveryDiagnostic[];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.normalize("NFC")
    : undefined;
}

async function readPackageJson(
  repositoryRoot: string,
  filePath: string,
  diagnostics: DiscoveryDiagnostic[],
): Promise<PackageJson | undefined> {
  const relativePath = toRepositoryPath(repositoryRoot, filePath);
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Package manifest is not an object.");
    }
    return value as PackageJson;
  } catch {
    diagnostics.push({
      code: "package_json_invalid",
      severity: "error",
      ...(relativePath ? { path: relativePath } : {}),
      summary: "package.json is not valid JSON object data.",
    });
    return undefined;
  }
}

function packageWorkspacePatterns(value: unknown): string[] | undefined {
  const candidate = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && "packages" in value
      ? (value as { packages?: unknown }).packages
      : undefined;
  if (!Array.isArray(candidate)) return undefined;
  if (!candidate.every((item) => typeof item === "string")) return undefined;
  return candidate.map((item) => item.normalize("NFC"));
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineYamlList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) return [];
  return body.split(",").map((item) => unquoteYaml(item).normalize("NFC"));
}

function parsePnpmWorkspace(text: string): string[] | undefined {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^packages\s*:/u.test(line));
  if (start < 0) return undefined;
  const declaration = lines[start]!;
  const inline = parseInlineYamlList(
    declaration.slice(declaration.indexOf(":") + 1),
  );
  if (inline) return inline;
  const patterns: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    if (!/^\s+/u.test(line)) break;
    const match = /^\s*-\s*(.+?)\s*(?:#.*)?$/u.exec(line);
    if (!match?.[1]) return undefined;
    patterns.push(unquoteYaml(match[1]).normalize("NFC"));
  }
  return patterns;
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/u.exec(pattern);
  if (!match || match.index === undefined) return [pattern];
  const choices = match[1]!.split(",");
  return choices.flatMap((choice) =>
    expandBraces(
      `${pattern.slice(0, match.index)}${choice}${pattern.slice(match.index + match[0].length)}`,
    ),
  );
}

function globExpression(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function normalizedPattern(value: string): string | undefined {
  const negated = value.startsWith("!");
  const body = (negated ? value.slice(1) : value)
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/$/u, "");
  if (
    body.length === 0 ||
    body.startsWith("/") ||
    body.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return undefined;
  }
  return `${negated ? "!" : ""}${body}`;
}

function matchesWorkspace(
  directory: string,
  patterns: readonly string[],
): boolean {
  let included = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith("!");
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    if (
      expandBraces(pattern).some((expanded) =>
        globExpression(expanded).test(directory),
      )
    ) {
      included = !negated;
    }
  }
  return included;
}

function managerFromPackageManager(
  value: unknown,
): WorkspaceManager | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.split("@")[0];
  return name === "npm" || name === "pnpm" || name === "yarn"
    ? name
    : undefined;
}

function packageRecord(
  repositoryId: string,
  repositoryRoot: string,
  filePath: string,
  manifest: PackageJson,
  patterns: readonly string[],
): WorkspacePackage {
  const manifestPath = toRepositoryPath(repositoryRoot, filePath)!;
  const relativeDirectory = toRepositoryPath(
    repositoryRoot,
    path.dirname(filePath),
  )!;
  const directory = relativeDirectory === "." ? "." : relativeDirectory;
  const workspaceMember =
    directory !== "." && matchesWorkspace(directory, patterns);
  const name = stringValue(manifest.name);
  const version = stringValue(manifest.version);
  const main = stringValue(manifest.main);
  const types = stringValue(manifest.types) ?? stringValue(manifest.typings);
  const moduleType =
    manifest.type === "module"
      ? "module"
      : manifest.type === "commonjs"
        ? "commonjs"
        : undefined;
  return {
    id: stableId("workspace-package", {
      repositoryId,
      directory,
    }),
    directory,
    manifestPath,
    workspaceMember,
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
    ...(typeof manifest.private === "boolean"
      ? { private: manifest.private }
      : {}),
    ...(moduleType ? { moduleType } : {}),
    ...(main ? { main } : {}),
    ...(types ? { types } : {}),
    ...(manifest.exports === undefined
      ? {}
      : { exports: structuredClone(manifest.exports) }),
  };
}

export async function discoverWorkspace(
  repositoryId: string,
  repositoryRoot: string,
  packageFiles: readonly string[],
  pnpmWorkspaceFiles: readonly string[],
  yarnLockFiles: readonly string[],
): Promise<WorkspaceResult> {
  const diagnostics: DiscoveryDiagnostic[] = [];
  const rootManifestPath = path.join(repositoryRoot, "package.json");
  const rootPackageFile = packageFiles.find(
    (file) => file === rootManifestPath,
  );
  const rootManifest = rootPackageFile
    ? await readPackageJson(repositoryRoot, rootPackageFile, diagnostics)
    : undefined;
  const packagePatterns = rootManifest
    ? packageWorkspacePatterns(rootManifest.workspaces)
    : undefined;
  if (rootManifest?.workspaces !== undefined && packagePatterns === undefined) {
    diagnostics.push({
      code: "workspace_definition_invalid",
      severity: "error",
      path: "package.json",
      summary:
        "package.json workspaces must be an array or an object with a packages array.",
    });
  }

  const rootPnpmPath = path.join(repositoryRoot, "pnpm-workspace.yaml");
  const hasPnpmWorkspace = pnpmWorkspaceFiles.includes(rootPnpmPath);
  let pnpmPatterns: string[] | undefined;
  if (hasPnpmWorkspace) {
    pnpmPatterns = parsePnpmWorkspace(await fs.readFile(rootPnpmPath, "utf8"));
    if (!pnpmPatterns) {
      diagnostics.push({
        code: "workspace_definition_invalid",
        severity: "error",
        path: "pnpm-workspace.yaml",
        summary:
          "pnpm-workspace.yaml must contain a supported top-level packages list.",
      });
    }
  }

  const declaredManager = managerFromPackageManager(
    rootManifest?.packageManager,
  );
  const rootYarnLock = yarnLockFiles.includes(
    path.join(repositoryRoot, "yarn.lock"),
  );
  const manager: WorkspaceManager = hasPnpmWorkspace
    ? "pnpm"
    : (declaredManager ??
      (rootYarnLock ? "yarn" : packagePatterns ? "npm" : "none"));
  const managerSignals = new Set<WorkspaceManager>([
    ...(hasPnpmWorkspace ? (["pnpm"] as const) : []),
    ...(declaredManager ? [declaredManager] : []),
    ...(rootYarnLock ? (["yarn"] as const) : []),
  ]);
  if (managerSignals.size > 1) {
    diagnostics.push({
      code: "workspace_manager_conflict",
      severity: "warning",
      summary: `Conflicting workspace-manager signals were found; ${manager} takes precedence.`,
    });
  }

  const rawPatterns =
    manager === "pnpm" ? (pnpmPatterns ?? []) : (packagePatterns ?? []);
  const patterns: string[] = [];
  for (const pattern of rawPatterns) {
    const normalized = normalizedPattern(pattern);
    if (!normalized) {
      diagnostics.push({
        code: "workspace_definition_invalid",
        severity: "error",
        summary: `Workspace pattern ${JSON.stringify(pattern)} is not repository-relative.`,
      });
    } else {
      patterns.push(normalized);
    }
  }

  const packages: WorkspacePackage[] = [];
  for (const filePath of packageFiles) {
    const manifest =
      filePath === rootPackageFile && rootManifest
        ? rootManifest
        : await readPackageJson(repositoryRoot, filePath, diagnostics);
    if (!manifest) continue;
    const record = packageRecord(
      repositoryId,
      repositoryRoot,
      filePath,
      manifest,
      patterns,
    );
    if (record.workspaceMember && !record.name) {
      diagnostics.push({
        code: "workspace_package_invalid",
        severity: "error",
        path: record.manifestPath,
        summary: "Workspace packages must declare a non-empty package name.",
      });
    }
    packages.push(record);
  }
  packages.sort((left, right) =>
    compareCodePoints(left.directory, right.directory),
  );

  const names = new Map<string, WorkspacePackage>();
  for (const item of packages.filter(
    (candidate) => candidate.workspaceMember,
  )) {
    if (!item.name) continue;
    const previous = names.get(item.name);
    if (previous) {
      diagnostics.push({
        code: "workspace_package_duplicate",
        severity: "error",
        path: item.manifestPath,
        summary: `Workspace package name ${item.name} is also declared by ${previous.manifestPath}.`,
      });
    } else {
      names.set(item.name, item);
    }
  }

  return {
    workspace: {
      manager,
      ...(rootPackageFile ? { rootManifestPath: "package.json" } : {}),
      patterns,
      packages,
    },
    diagnostics: sortDiagnostics(diagnostics),
  };
}
