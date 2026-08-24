import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { stableId } from "@bytesmith/canonicalization";
import { compareCodePoints } from "@bytesmith/impact-types";
import { sortDiagnostics, toRepositoryPath } from "./path.js";
import type {
  CompilerOptionSummary,
  DiscoveryDiagnostic,
  TypeScriptProject,
  WorkspacePackage,
} from "./types.js";

interface RawConfig {
  extends?: unknown;
  files?: unknown;
  include?: unknown;
  exclude?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.normalize("NFC"))
    : [];
}

function extendsValues(value: unknown): string[] {
  return typeof value === "string"
    ? [value.normalize("NFC")]
    : stringArray(value);
}

function configCandidate(value: string): string | undefined {
  const candidates = [
    value,
    value.endsWith(".json") ? value : `${value}.json`,
    path.join(value, "tsconfig.json"),
  ];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function resolveExtendedConfig(
  configPath: string,
  specifier: string,
): string | undefined {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return configCandidate(path.resolve(path.dirname(configPath), specifier));
  }
  try {
    return createRequire(configPath).resolve(specifier);
  } catch {
    return undefined;
  }
}

function resolveExtends(
  repositoryRoot: string,
  configPath: string,
  raw: RawConfig,
  diagnostics: DiscoveryDiagnostic[],
): string[] {
  const result = new Set<string>();
  const visited = new Set<string>([configPath]);

  function visit(parentPath: string, values: readonly string[]): void {
    for (const specifier of values) {
      const resolved = resolveExtendedConfig(parentPath, specifier);
      if (!resolved) continue;
      const canonical = fs.realpathSync(resolved);
      const repositoryPath = toRepositoryPath(repositoryRoot, canonical);
      if (!repositoryPath || repositoryPath === ".") {
        const ownerPath = toRepositoryPath(repositoryRoot, configPath);
        diagnostics.push({
          code: "config_path_outside_repository",
          severity: "warning",
          ...(ownerPath && ownerPath !== "." ? { path: ownerPath } : {}),
          summary: `Extended configuration ${specifier} resolves outside the repository.`,
        });
        continue;
      }
      result.add(repositoryPath);
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      const read = ts.readConfigFile(canonical, ts.sys.readFile);
      if (
        !read.error &&
        typeof read.config === "object" &&
        read.config !== null
      ) {
        visit(canonical, extendsValues((read.config as RawConfig).extends));
      }
    }
  }

  visit(configPath, extendsValues(raw.extends));
  return [...result].sort(compareCodePoints);
}

function diagnosticFromTypeScript(
  repositoryRoot: string,
  configPath: string,
  diagnostic: ts.Diagnostic,
): DiscoveryDiagnostic {
  const filePath = diagnostic.file?.fileName ?? configPath;
  const repositoryPath = toRepositoryPath(repositoryRoot, filePath);
  const location =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  const rootWithSeparator = `${repositoryRoot}${path.sep}`;
  const summary = ts
    .flattenDiagnosticMessageText(diagnostic.messageText, " ")
    .replaceAll(rootWithSeparator, "")
    .replaceAll("\\", "/")
    .normalize("NFC");
  return {
    code: "config_invalid",
    severity:
      diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    ...(repositoryPath && repositoryPath !== "."
      ? { path: repositoryPath }
      : {}),
    ...(location
      ? { line: location.line + 1, column: location.character + 1 }
      : {}),
    typescriptCode: diagnostic.code,
    summary,
  };
}

function optionPath(
  repositoryRoot: string,
  value: string | undefined,
  configPath: string,
  name: string,
  diagnostics: DiscoveryDiagnostic[],
): string | undefined {
  if (!value) return undefined;
  const repositoryPath = toRepositoryPath(repositoryRoot, path.resolve(value));
  if (!repositoryPath) {
    const ownerPath = toRepositoryPath(repositoryRoot, configPath);
    diagnostics.push({
      code: "config_path_outside_repository",
      severity: "warning",
      ...(ownerPath && ownerPath !== "." ? { path: ownerPath } : {}),
      summary: `${name} resolves outside the repository.`,
    });
    return undefined;
  }
  return repositoryPath;
}

function enumName(
  enumObject: object,
  value: number | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const candidate = (enumObject as Record<number, unknown>)[value];
  return typeof candidate === "string" ? candidate : String(value);
}

function compilerOptions(
  repositoryRoot: string,
  configPath: string,
  options: ts.CompilerOptions,
  diagnostics: DiscoveryDiagnostic[],
): CompilerOptionSummary {
  const baseUrl = optionPath(
    repositoryRoot,
    options.baseUrl,
    configPath,
    "compilerOptions.baseUrl",
    diagnostics,
  );
  const rootDir = optionPath(
    repositoryRoot,
    options.rootDir,
    configPath,
    "compilerOptions.rootDir",
    diagnostics,
  );
  const outDir = optionPath(
    repositoryRoot,
    options.outDir,
    configPath,
    "compilerOptions.outDir",
    diagnostics,
  );
  const paths = Object.fromEntries(
    Object.entries(options.paths ?? {})
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, values]) => [
        key.normalize("NFC"),
        values.map((value) => value.normalize("NFC")),
      ]),
  );
  const module = enumName(ts.ModuleKind, options.module);
  const moduleResolution = enumName(
    ts.ModuleResolutionKind,
    options.moduleResolution,
  );
  const target = enumName(ts.ScriptTarget, options.target);
  const jsx = enumName(ts.JsxEmit, options.jsx);
  return {
    allowJs: options.allowJs ?? false,
    checkJs: options.checkJs ?? false,
    composite: options.composite ?? false,
    declaration: options.declaration ?? false,
    noEmit: options.noEmit ?? false,
    strict: options.strict ?? false,
    ...(baseUrl ? { baseUrl } : {}),
    ...(rootDir ? { rootDir } : {}),
    ...(outDir ? { outDir } : {}),
    ...(module ? { module } : {}),
    ...(moduleResolution ? { moduleResolution } : {}),
    ...(target ? { target } : {}),
    ...(jsx ? { jsx } : {}),
    paths,
  };
}

function projectReferencePath(
  repositoryRoot: string,
  value: string,
): string | undefined {
  const candidate = configCandidate(value);
  if (!candidate) return undefined;
  const relative = toRepositoryPath(repositoryRoot, path.resolve(candidate));
  return relative && relative !== "." ? relative : undefined;
}

function owningPackage(
  configPath: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  const directory = path.posix.dirname(configPath);
  return packages
    .filter((item) => {
      if (item.directory === ".") return true;
      return (
        directory === item.directory ||
        directory.startsWith(`${item.directory}/`)
      );
    })
    .sort(
      (left, right) =>
        right.directory.length - left.directory.length ||
        compareCodePoints(left.directory, right.directory),
    )[0];
}

function sourceLanguage(
  sourceFiles: readonly string[],
): TypeScriptProject["language"] {
  const hasTypeScript = sourceFiles.some((file) =>
    /(?:\.d)?\.(?:ts|tsx|mts|cts)$/u.test(file),
  );
  const hasJavaScript = sourceFiles.some((file) =>
    /\.(?:js|jsx|mjs|cjs)$/u.test(file),
  );
  if (hasTypeScript && hasJavaScript) return "mixed";
  if (hasTypeScript) return "typescript";
  if (hasJavaScript) return "javascript";
  return "empty";
}

export function discoverProjectConfiguration(
  repositoryId: string,
  repositoryRoot: string,
  configPath: string,
  packages: readonly WorkspacePackage[],
): TypeScriptProject {
  const configRepositoryPath = toRepositoryPath(repositoryRoot, configPath)!;
  const configKind =
    path.basename(configPath) === "jsconfig.json" ? "jsconfig" : "tsconfig";
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const readDiagnostics = read.error
    ? [diagnosticFromTypeScript(repositoryRoot, configPath, read.error)]
    : [];
  const raw =
    !read.error && typeof read.config === "object" && read.config !== null
      ? (read.config as RawConfig)
      : {};
  const parsed = ts.parseJsonConfigFileContent(
    read.error ? {} : read.config,
    ts.sys,
    path.dirname(configPath),
    configKind === "jsconfig"
      ? {
          allowJs: true,
          maxNodeModuleJsDepth: 2,
          allowSyntheticDefaultImports: true,
        }
      : undefined,
    configPath,
  );
  const diagnostics = [
    ...readDiagnostics,
    ...parsed.errors.map((diagnostic) =>
      diagnosticFromTypeScript(repositoryRoot, configPath, diagnostic),
    ),
  ];
  const sourceFiles = parsed.fileNames
    .map((file) => {
      const repositoryPath = toRepositoryPath(
        repositoryRoot,
        path.resolve(file),
      );
      if (!repositoryPath || repositoryPath === ".") {
        diagnostics.push({
          code: "config_path_outside_repository",
          severity: "error",
          path: configRepositoryPath,
          summary: "A configured source file resolves outside the repository.",
        });
        return undefined;
      }
      return repositoryPath;
    })
    .filter((file): file is string => file !== undefined)
    .sort(compareCodePoints);
  const projectReferences = (parsed.projectReferences ?? [])
    .map((reference) => {
      const resolved = projectReferencePath(repositoryRoot, reference.path);
      if (!resolved) {
        diagnostics.push({
          code: "config_reference_missing",
          severity: "error",
          path: configRepositoryPath,
          summary: `Project reference ${reference.originalPath ?? reference.path} does not resolve to a configuration file.`,
        });
      }
      return resolved;
    })
    .filter((value): value is string => value !== undefined)
    .sort(compareCodePoints);
  const owner = owningPackage(configRepositoryPath, packages);
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    id: stableId("typescript-project", {
      repositoryId,
      configPath: configRepositoryPath,
    }),
    configPath: configRepositoryPath,
    configKind,
    ...(owner ? { packageId: owner.id } : {}),
    ...(owner?.name ? { packageName: owner.name } : {}),
    language: sourceLanguage(sourceFiles),
    sourceFiles,
    projectReferences,
    extends: extendsValues(raw.extends),
    resolvedExtends: resolveExtends(
      repositoryRoot,
      configPath,
      raw,
      sortedDiagnostics,
    ),
    rawFiles: stringArray(raw.files),
    rawInclude: stringArray(raw.include),
    rawExclude: stringArray(raw.exclude),
    compilerOptions: compilerOptions(
      repositoryRoot,
      configPath,
      parsed.options,
      sortedDiagnostics,
    ),
    diagnostics: sortDiagnostics(sortedDiagnostics),
    status: sortedDiagnostics.some((item) => item.severity === "error")
      ? "incomplete"
      : "completed",
  };
}
