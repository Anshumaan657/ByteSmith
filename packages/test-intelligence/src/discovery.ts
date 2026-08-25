import fs from "node:fs/promises";
import path from "node:path";
import { stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import ts from "typescript";
import { TestDiscoveryError } from "./errors.js";
import { createTestDiscoveryCanonicalIr } from "./projection.js";
import type {
  DiscoveredTestCase,
  DiscoveredTestFile,
  PackageManager,
  RunTestDiscoveryOptions,
  TestCommand,
  TestDiscoveryComparisonResult,
  TestDiscoveryDiagnostic,
  TestFramework,
  TestProject,
  TestRevisionDiscovery,
  TestSnapshotInput,
} from "./types.js";

type JsonObject = Record<string, unknown>;

interface PackageRecord {
  directory: string;
  manifestPath: string;
  name?: string;
  scripts: Record<string, string>;
  frameworks: TestFramework[];
  inlineJest?: JsonObject;
  packageManager?: string;
}

interface ScannedRepository {
  files: string[];
  configFiles: string[];
  packages: PackageRecord[];
  diagnostics: TestDiscoveryDiagnostic[];
}

interface ProjectCandidate {
  framework: TestFramework;
  rootDirectory: string;
  packageRecord?: PackageRecord;
  configPath?: string;
  includePatterns: string[];
  excludePatterns: string[];
}

interface StaticEvaluation {
  value?: unknown;
  dynamic: boolean;
}

const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?)$/u;
const configPattern = /^(jest|vitest)\.config\.(json|[cm]?[jt]s)$/u;
const viteConfigPattern = /^vite\.config\.[cm]?[jt]s$/u;
const supportedModifiers = new Set([
  "concurrent",
  "fails",
  "only",
  "skip",
  "todo",
]);

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function normalizePath(value: string): string {
  const normalized = value.split(path.sep).join("/").normalize("NFC");
  return normalized.length === 0 ? "." : normalized;
}

function repositoryPath(
  root: string,
  absolutePath: string,
): string | undefined {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return normalizePath(relative);
}

function sortDiagnostics(
  diagnostics: readonly TestDiscoveryDiagnostic[],
): TestDiscoveryDiagnostic[] {
  const unique = [
    ...new Map(
      diagnostics.map((item) => [
        JSON.stringify([
          item.code,
          item.severity,
          item.path,
          item.line ?? null,
          item.column ?? null,
          item.summary,
        ]),
        item,
      ]),
    ).values(),
  ];
  return unique.sort((left, right) => {
    for (const comparison of [
      compareCodePoints(left.path, right.path),
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

function frameworkDependencies(manifest: JsonObject): TestFramework[] {
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const name of Object.keys(object(manifest[key]) ?? {}))
      names.add(name);
  }
  const result: TestFramework[] = [];
  if (names.has("jest") || names.has("@jest/globals")) result.push("jest");
  if (names.has("vitest")) result.push("vitest");
  return result;
}

function scriptsOf(manifest: JsonObject): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(manifest.scripts) ?? {})
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .map(
        ([name, value]) =>
          [name.normalize("NFC"), value.normalize("NFC")] as const,
      )
      .sort((left, right) => compareCodePoints(left[0], right[0])),
  );
}

async function scanRepository(root: string): Promise<ScannedRepository> {
  const result: ScannedRepository = {
    files: [],
    configFiles: [],
    packages: [],
    diagnostics: [],
  };

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = repositoryPath(root, absolute);
      if (!relative) continue;
      if (entry.isSymbolicLink()) {
        result.diagnostics.push({
          code: "filesystem_entry_unsupported",
          severity: "warning",
          path: relative,
          summary:
            "Symbolic filesystem entries are not followed during test discovery.",
        });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      result.files.push(relative);
      if (
        configPattern.test(entry.name) ||
        viteConfigPattern.test(entry.name)
      ) {
        result.configFiles.push(relative);
      }
      if (entry.name !== "package.json") continue;
      try {
        const manifest = object(
          JSON.parse(await fs.readFile(absolute, "utf8")),
        );
        if (!manifest)
          throw new TypeError("Package manifest is not an object.");
        const directoryPath = normalizePath(path.dirname(relative));
        const scripts = scriptsOf(manifest);
        const frameworks = frameworkDependencies(manifest);
        if (
          Object.values(scripts).some((value) =>
            /(?:^|[\s/])jest(?:$|[\s/])/u.test(value),
          )
        ) {
          frameworks.push("jest");
        }
        if (
          Object.values(scripts).some((value) =>
            /(?:^|[\s/])vitest(?:$|[\s/])/u.test(value),
          )
        ) {
          frameworks.push("vitest");
        }
        const inlineJest = object(manifest.jest);
        if (inlineJest) frameworks.push("jest");
        result.packages.push({
          directory: directoryPath,
          manifestPath: relative,
          ...(typeof manifest.name === "string"
            ? { name: manifest.name.normalize("NFC") }
            : {}),
          scripts,
          frameworks: [...new Set(frameworks)].sort(compareCodePoints),
          ...(inlineJest ? { inlineJest } : {}),
          ...(typeof manifest.packageManager === "string"
            ? { packageManager: manifest.packageManager.normalize("NFC") }
            : {}),
        });
      } catch {
        result.diagnostics.push({
          code: "package_manifest_invalid",
          severity: "error",
          path: relative,
          summary:
            "Package manifest is not valid JSON and was not used for test discovery.",
        });
      }
    }
  }

  await visit(root);
  result.files.sort(compareCodePoints);
  result.configFiles.sort(compareCodePoints);
  result.packages.sort((left, right) =>
    compareCodePoints(left.directory, right.directory),
  );
  return result;
}

function evaluateExpression(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): StaticEvaluation {
  if (ts.isParenthesizedExpression(expression)) {
    return evaluateExpression(expression.expression, bindings, seen);
  }
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return { value: expression.text.normalize("NFC"), dynamic: false };
  }
  if (ts.isNumericLiteral(expression)) {
    return { value: Number(expression.text), dynamic: false };
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword)
    return { value: true, dynamic: false };
  if (expression.kind === ts.SyntaxKind.FalseKeyword)
    return { value: false, dynamic: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword)
    return { value: null, dynamic: false };
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return { dynamic: true };
    const binding = bindings.get(expression.text);
    if (!binding) return { dynamic: true };
    return evaluateExpression(
      binding,
      bindings,
      new Set([...seen, expression.text]),
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const output: unknown[] = [];
    let dynamic = false;
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        dynamic = true;
        continue;
      }
      const evaluated = evaluateExpression(element, bindings, seen);
      dynamic ||= evaluated.dynamic;
      if (evaluated.value !== undefined) output.push(evaluated.value);
    }
    return { value: output, dynamic };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const output: JsonObject = {};
    let dynamic = false;
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        dynamic = true;
        continue;
      }
      const name = ts.isComputedPropertyName(property.name)
        ? undefined
        : property.name.getText().replace(/^['"]|['"]$/gu, "");
      if (!name) {
        dynamic = true;
        continue;
      }
      const evaluated = evaluateExpression(
        property.initializer,
        bindings,
        seen,
      );
      dynamic ||= evaluated.dynamic;
      if (evaluated.value !== undefined)
        output[name.normalize("NFC")] = evaluated.value;
    }
    return { value: output, dynamic };
  }
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    ts.isIdentifier(expression.expression) &&
    ["defineConfig", "defineProject"].includes(expression.expression.text)
  ) {
    return evaluateExpression(expression.arguments[0]!, bindings, seen);
  }
  return { dynamic: true };
}

function parseScriptConfiguration(
  source: string,
  fileName: string,
): StaticEvaluation {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const bindings = new Map<string, ts.Expression>();
  let root: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          bindings.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      root = statement.expression;
    } else if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(sourceFile) === "module.exports"
    ) {
      root = statement.expression.right;
    }
  }
  return root ? evaluateExpression(root, bindings) : { dynamic: true };
}

async function loadStaticConfiguration(
  root: string,
  configPath: string,
  diagnostics: TestDiscoveryDiagnostic[],
): Promise<JsonObject | undefined> {
  try {
    const source = await fs.readFile(path.join(root, configPath), "utf8");
    const evaluated = configPath.endsWith(".json")
      ? { value: JSON.parse(source) as unknown, dynamic: false }
      : parseScriptConfiguration(source, configPath);
    const value = object(evaluated.value);
    if (!value) {
      diagnostics.push({
        code: "test_config_dynamic",
        severity: "warning",
        path: configPath,
        summary:
          "Test configuration is dynamic or unsupported and was not executed.",
      });
      return undefined;
    }
    if (evaluated.dynamic) {
      diagnostics.push({
        code: "test_config_dynamic",
        severity: "warning",
        path: configPath,
        summary: "Dynamic parts of the test configuration were not evaluated.",
      });
    }
    return value;
  } catch {
    diagnostics.push({
      code: "test_config_invalid",
      severity: "error",
      path: configPath,
      summary: "Test configuration could not be parsed statically.",
    });
    return undefined;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.normalize("NFC"))
    : [];
}

function nearestPackage(
  configPath: string,
  packages: readonly PackageRecord[],
): PackageRecord | undefined {
  const directory = normalizePath(path.posix.dirname(configPath));
  return [...packages]
    .filter(
      (candidate) =>
        candidate.directory === "." ||
        directory === candidate.directory ||
        directory.startsWith(`${candidate.directory}/`),
    )
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function configFramework(configPath: string): TestFramework {
  return path.posix.basename(configPath).startsWith("jest") ? "jest" : "vitest";
}

function normalizeConfiguredRoot(
  configPath: string,
  configuredRoot: unknown,
): string {
  const configDirectory = normalizePath(path.posix.dirname(configPath));
  if (typeof configuredRoot !== "string") return configDirectory;
  if (configuredRoot.includes("<rootDir>")) {
    return normalizePath(
      path.posix.normalize(
        configuredRoot.replaceAll("<rootDir>", configDirectory),
      ),
    );
  }
  return normalizePath(
    path.posix.normalize(path.posix.join(configDirectory, configuredRoot)),
  );
}

function projectPatterns(
  framework: TestFramework,
  configuration: JsonObject | undefined,
): {
  root?: unknown;
  includes: string[];
  excludes: string[];
  unsupported: string[];
} {
  const options =
    framework === "vitest" ? object(configuration?.test) : configuration;
  return {
    root: options?.root ?? options?.rootDir,
    includes: stringList(
      framework === "jest" ? options?.testMatch : options?.include,
    ),
    excludes: framework === "jest" ? [] : stringList(options?.exclude),
    unsupported:
      framework === "jest"
        ? [
            ...stringList(options?.testRegex),
            ...stringList(options?.testPathIgnorePatterns),
          ]
        : [],
  };
}

function unsupportedPattern(pattern: string): boolean {
  return /[()[\]!+@]/u.test(pattern) || pattern.includes("\\");
}

async function createProjectCandidates(
  root: string,
  scanned: ScannedRepository,
): Promise<ProjectCandidate[]> {
  const candidates: ProjectCandidate[] = [];
  const configured = new Set<string>();
  for (const configPath of scanned.configFiles) {
    const framework = configFramework(configPath);
    const configuration = await loadStaticConfiguration(
      root,
      configPath,
      scanned.diagnostics,
    );
    const patterns = projectPatterns(framework, configuration);
    for (const pattern of patterns.unsupported) {
      scanned.diagnostics.push({
        code: "test_pattern_unsupported",
        severity: "warning",
        path: configPath,
        summary: `Jest regular-expression pattern ${pattern} is not evaluated by static discovery.`,
      });
    }
    for (const pattern of [...patterns.includes, ...patterns.excludes]) {
      if (unsupportedPattern(pattern)) {
        scanned.diagnostics.push({
          code: "test_pattern_unsupported",
          severity: "warning",
          path: configPath,
          summary: `Test pattern ${pattern} uses unsupported matching syntax.`,
        });
      }
    }
    const packageRecord = nearestPackage(configPath, scanned.packages);
    const rootDirectory = normalizeConfiguredRoot(configPath, patterns.root);
    candidates.push({
      framework,
      rootDirectory,
      ...(packageRecord ? { packageRecord } : {}),
      configPath,
      includePatterns: patterns.includes.filter(
        (item) => !unsupportedPattern(item),
      ),
      excludePatterns: patterns.excludes.filter(
        (item) => !unsupportedPattern(item),
      ),
    });
    configured.add(
      `${packageRecord?.directory ?? rootDirectory}\0${framework}`,
    );
  }
  for (const packageRecord of scanned.packages) {
    for (const framework of packageRecord.frameworks) {
      const key = `${packageRecord.directory}\0${framework}`;
      if (configured.has(key)) continue;
      const patterns =
        framework === "jest" && packageRecord.inlineJest
          ? projectPatterns(framework, packageRecord.inlineJest)
          : { root: undefined, includes: [], excludes: [], unsupported: [] };
      for (const pattern of patterns.unsupported) {
        scanned.diagnostics.push({
          code: "test_pattern_unsupported",
          severity: "warning",
          path: packageRecord.manifestPath,
          summary: `Jest regular-expression pattern ${pattern} is not evaluated by static discovery.`,
        });
      }
      const configuredRoot =
        typeof patterns.root === "string"
          ? patterns.root.includes("<rootDir>")
            ? patterns.root.replaceAll("<rootDir>", packageRecord.directory)
            : path.posix.join(packageRecord.directory, patterns.root)
          : packageRecord.directory;
      candidates.push({
        framework,
        rootDirectory: normalizePath(path.posix.normalize(configuredRoot)),
        packageRecord,
        includePatterns: patterns.includes.filter(
          (item) => !unsupportedPattern(item),
        ),
        excludePatterns: patterns.excludes.filter(
          (item) => !unsupportedPattern(item),
        ),
      });
    }
  }

  for (const filePath of scanned.files.filter((item) =>
    sourceExtensionPattern.test(item),
  )) {
    const source = await fs.readFile(path.join(root, filePath), "utf8");
    const explicit = explicitFrameworks(source);
    for (const framework of explicit) {
      if (
        candidates.some(
          (candidate) =>
            candidate.framework === framework &&
            underDirectory(filePath, candidate.rootDirectory),
        )
      ) {
        continue;
      }
      const packageRecord = nearestPackage(filePath, scanned.packages);
      const rootDirectory = packageRecord?.directory ?? ".";
      if (
        candidates.some(
          (candidate) =>
            candidate.framework === framework &&
            candidate.rootDirectory === rootDirectory,
        )
      ) {
        continue;
      }
      candidates.push({
        framework,
        rootDirectory,
        ...(packageRecord ? { packageRecord } : {}),
        includePatterns: [],
        excludePatterns: [],
      });
    }
    if (
      explicit.length === 0 &&
      defaultTestFile(filePath, "jest") &&
      !candidates.some((candidate) =>
        underDirectory(filePath, candidate.rootDirectory),
      )
    ) {
      scanned.diagnostics.push({
        code: "framework_ambiguous",
        severity: "warning",
        path: filePath,
        summary:
          "Test-like file has no statically provable Jest or Vitest project.",
      });
    }
  }
  return candidates.sort((left, right) => {
    for (const comparison of [
      compareCodePoints(left.rootDirectory, right.rootDirectory),
      compareCodePoints(left.framework, right.framework),
      compareCodePoints(left.configPath ?? "", right.configPath ?? ""),
    ]) {
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/u.exec(pattern);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1]!
    .split(",")
    .flatMap((choice) => expandBraces(`${before}${choice}${after}`));
}

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}

function globRegex(pattern: string): RegExp {
  let source = "^";
  const normalized = pattern.replace(/^\.\//u, "").replaceAll("<rootDir>/", "");
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += escapeRegex(character);
  }
  return new RegExp(`${source}$`, "u");
}

function matchesGlob(value: string, pattern: string): boolean {
  return expandBraces(pattern).some((candidate) =>
    globRegex(candidate).test(value),
  );
}

function defaultTestFile(filePath: string, framework: TestFramework): boolean {
  const name = path.posix.basename(filePath);
  if (framework === "jest" && filePath.split("/").includes("__tests__")) {
    return sourceExtensionPattern.test(name);
  }
  return /(?:^|\.)(?:spec|test)\.[cm]?[jt]sx?$/u.test(name);
}

function underDirectory(filePath: string, directory: string): boolean {
  return directory === "." || filePath.startsWith(`${directory}/`);
}

function relativeToDirectory(filePath: string, directory: string): string {
  return directory === "." ? filePath : filePath.slice(directory.length + 1);
}

function explicitFrameworks(source: string): TestFramework[] {
  const result: TestFramework[] = [];
  if (/['"]vitest['"]/u.test(source)) result.push("vitest");
  if (/['"]@jest\/globals['"]|\bjest\s*\./u.test(source)) result.push("jest");
  return result;
}

function literalName(
  expression: ts.Expression | undefined,
): string | undefined {
  return expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text.normalize("NFC")
    : undefined;
}

function callFamily(
  expression: ts.Expression,
): "test" | "describe" | undefined {
  if (ts.isIdentifier(expression)) {
    if (expression.text === "test" || expression.text === "it") return "test";
    if (expression.text === "describe") return "describe";
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    if (
      !supportedModifiers.has(expression.name.text) &&
      expression.name.text !== "each"
    ) {
      return undefined;
    }
    return callFamily(expression.expression);
  }
  if (ts.isCallExpression(expression)) return callFamily(expression.expression);
  return undefined;
}

function position(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const value = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: value.line + 1, column: value.character + 1 };
}

function extractTestCases(input: {
  repositoryId: string;
  revision: string;
  projectId: string;
  framework: TestFramework;
  path: string;
  source: string;
  command?: string;
  diagnostics: TestDiscoveryDiagnostic[];
}): DiscoveredTestCase[] {
  const sourceFile = ts.createSourceFile(
    input.path,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    input.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result: DiscoveredTestCase[] = [];

  function visit(node: ts.Node, suites: readonly string[]): void {
    if (ts.isCallExpression(node)) {
      const family = callFamily(node.expression);
      if (family) {
        const name = literalName(node.arguments[0]);
        if (!name) {
          const at = position(sourceFile, node);
          input.diagnostics.push({
            code: "test_name_dynamic",
            severity: "warning",
            path: input.path,
            ...at,
            summary: `Dynamic ${family} name was not converted into canonical test IR.`,
          });
        } else if (family === "test") {
          const at = position(sourceFile, node.arguments[0]!);
          const fullName = [...suites, name].join(" > ");
          result.push({
            id: stableId("test-case-discovery", {
              repositoryId: input.repositoryId,
              revision: input.revision,
              framework: input.framework,
              path: input.path,
              name: fullName,
              ...at,
            }),
            projectId: input.projectId,
            framework: input.framework,
            revision: input.revision,
            path: input.path,
            name: fullName,
            ...at,
            ...(input.command ? { command: input.command } : {}),
          });
        } else {
          const callback = node.arguments.find(
            (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
              ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
          );
          if (callback) {
            visit(callback.body, [...suites, name]);
            return;
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, suites));
  }

  visit(sourceFile, []);
  return result.sort((left, right) => {
    for (const comparison of [
      left.line - right.line,
      left.column - right.column,
      compareCodePoints(left.name, right.name),
    ]) {
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function packageManager(scanned: ScannedRepository): PackageManager {
  const root = scanned.packages.find((item) => item.directory === ".");
  const declared = root?.packageManager?.split("@")[0];
  if (declared === "npm" || declared === "pnpm" || declared === "yarn")
    return declared;
  if (scanned.files.includes("pnpm-lock.yaml")) return "pnpm";
  if (scanned.files.includes("yarn.lock")) return "yarn";
  if (scanned.files.includes("package-lock.json")) return "npm";
  return "unknown";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandFor(
  repositoryId: string,
  revision: string,
  manager: PackageManager,
  candidate: ProjectCandidate,
): TestCommand | undefined {
  const packageRecord = candidate.packageRecord;
  if (!packageRecord || manager === "unknown") return undefined;
  const scripts = Object.entries(packageRecord.scripts)
    .filter(([, command]) =>
      new RegExp(`(?:^|[/\\s])${candidate.framework}(?:$|[/\\s])`, "u").test(
        command,
      ),
    )
    .sort(([left], [right]) => {
      const leftScore = left === "test" ? 0 : left.startsWith("test:") ? 1 : 2;
      const rightScore =
        right === "test" ? 0 : right.startsWith("test:") ? 1 : 2;
      return leftScore - rightScore || compareCodePoints(left, right);
    });
  const script = scripts[0]?.[0];
  if (!script) return undefined;
  const directory = packageRecord.directory;
  const quotedDirectory = shellQuote(directory);
  const template =
    manager === "pnpm"
      ? directory === "."
        ? `pnpm ${script} -- {testPath}`
        : `pnpm --dir ${quotedDirectory} ${script} -- {testPath}`
      : manager === "npm"
        ? directory === "."
          ? `npm run ${script} -- {testPath}`
          : `npm --prefix ${quotedDirectory} run ${script} -- {testPath}`
        : directory === "."
          ? `yarn ${script} {testPath}`
          : `yarn --cwd ${quotedDirectory} ${script} {testPath}`;
  return {
    id: stableId("test-command", {
      repositoryId,
      revision,
      framework: candidate.framework,
      directory,
      script,
      template,
    }),
    packageDirectory: directory,
    script,
    framework: candidate.framework,
    commandTemplate: template,
  };
}

function projectId(
  repositoryId: string,
  revision: string,
  candidate: ProjectCandidate,
): string {
  return stableId("test-project", {
    repositoryId,
    revision,
    framework: candidate.framework,
    rootDirectory: candidate.rootDirectory,
    packageDirectory:
      candidate.packageRecord?.directory ?? candidate.rootDirectory,
    configPath: candidate.configPath ?? null,
  });
}

export async function discoverTestsAtRevision(input: {
  repositoryRoot: string;
  repositoryId: string;
  revision: string;
}): Promise<TestRevisionDiscovery> {
  let repositoryId: string;
  let revision: string;
  let root: string;
  try {
    repositoryId = validateStableId(input.repositoryId, "Repository ID");
    revision = validateExactGitRevision(
      input.revision,
      "Test snapshot revision",
    );
    root = await fs.realpath(path.resolve(input.repositoryRoot));
    if (!(await fs.stat(root)).isDirectory())
      throw new TypeError("Not a directory.");
  } catch (cause) {
    throw new TestDiscoveryError(
      "repository_unreadable",
      "Test discovery requires a readable revision snapshot directory.",
      cause,
    );
  }
  const scanned = await scanRepository(root);
  const manager = packageManager(scanned);
  const candidates = await createProjectCandidates(root, scanned);
  const projects: TestProject[] = [];
  const testFiles: DiscoveredTestFile[] = [];
  const testCases: DiscoveredTestCase[] = [];

  for (const candidate of candidates) {
    const id = projectId(repositoryId, revision, candidate);
    const command = commandFor(repositoryId, revision, manager, candidate);
    const fileIds: string[] = [];
    for (const filePath of scanned.files) {
      if (
        !sourceExtensionPattern.test(filePath) ||
        !underDirectory(filePath, candidate.rootDirectory)
      ) {
        continue;
      }
      const relative = relativeToDirectory(filePath, candidate.rootDirectory);
      const included = candidate.includePatterns.length
        ? candidate.includePatterns.some((pattern) =>
            matchesGlob(relative, pattern),
          )
        : defaultTestFile(relative, candidate.framework);
      if (
        !included ||
        candidate.excludePatterns.some((pattern) =>
          matchesGlob(relative, pattern),
        )
      ) {
        continue;
      }
      const source = await fs.readFile(path.join(root, filePath), "utf8");
      const explicit = explicitFrameworks(source);
      if (explicit.length && !explicit.includes(candidate.framework)) continue;
      if (explicit.length > 1) {
        scanned.diagnostics.push({
          code: "framework_ambiguous",
          severity: "warning",
          path: filePath,
          summary:
            "Test file imports both Jest and Vitest APIs and was retained in both explicit projects.",
        });
      }
      const runnable = command?.commandTemplate.replace(
        "{testPath}",
        shellQuote(
          candidate.packageRecord
            ? relativeToDirectory(filePath, candidate.packageRecord.directory)
            : filePath,
        ),
      );
      const cases = extractTestCases({
        repositoryId,
        revision,
        projectId: id,
        framework: candidate.framework,
        path: filePath,
        source,
        ...(runnable ? { command: runnable } : {}),
        diagnostics: scanned.diagnostics,
      });
      const fileId = stableId("test-file-discovery", {
        repositoryId,
        revision,
        framework: candidate.framework,
        projectId: id,
        path: filePath,
      });
      fileIds.push(fileId);
      testFiles.push({
        id: fileId,
        projectId: id,
        framework: candidate.framework,
        revision,
        path: filePath,
        testCaseIds: cases.map((item) => item.id),
        ...(runnable ? { command: runnable } : {}),
      });
      testCases.push(...cases);
    }
    projects.push({
      id,
      framework: candidate.framework,
      revision,
      rootDirectory: candidate.rootDirectory,
      packageDirectory:
        candidate.packageRecord?.directory ?? candidate.rootDirectory,
      ...(candidate.packageRecord?.name
        ? { packageName: candidate.packageRecord.name }
        : {}),
      ...(candidate.packageRecord
        ? { packageManifestPath: candidate.packageRecord.manifestPath }
        : {}),
      ...(candidate.configPath ? { configPath: candidate.configPath } : {}),
      includePatterns: [...candidate.includePatterns].sort(compareCodePoints),
      excludePatterns: [...candidate.excludePatterns].sort(compareCodePoints),
      ...(command ? { command } : {}),
      testFileIds: fileIds.sort(compareCodePoints),
    });
  }

  const diagnostics = sortDiagnostics(scanned.diagnostics);
  return {
    schemaVersion: "1.0.0",
    repositoryId,
    revision,
    packageManager: manager,
    projects: projects.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    testFiles: testFiles.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    testCases: testCases.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    diagnostics,
    status: diagnostics.length > 0 ? "incomplete" : "completed",
  };
}

function validateOptions(options: RunTestDiscoveryOptions): {
  repositoryId: string;
  base: TestSnapshotInput;
  head: TestSnapshotInput;
  analyzerVersion: string;
} {
  try {
    return {
      repositoryId: validateStableId(options.repositoryId, "Repository ID"),
      base: {
        directory: options.base.directory,
        revision: validateExactGitRevision(
          options.base.revision,
          "Base revision",
        ),
      },
      head: {
        directory: options.head.directory,
        revision: validateExactGitRevision(
          options.head.revision,
          "Head revision",
        ),
      },
      analyzerVersion: normalizeNonEmptyText(
        options.analyzerVersion ?? "0.1.0",
        "Test analyzer version",
      ),
    };
  } catch (cause) {
    throw new TestDiscoveryError(
      "discovery_options_invalid",
      "Test discovery comparison options are invalid.",
      cause,
    );
  }
}

export async function runTestDiscoveryComparison(
  options: RunTestDiscoveryOptions,
): Promise<TestDiscoveryComparisonResult> {
  const normalized = validateOptions(options);
  const [baseDiscovery, headDiscovery] = await Promise.all([
    discoverTestsAtRevision({
      repositoryRoot: normalized.base.directory,
      repositoryId: normalized.repositoryId,
      revision: normalized.base.revision,
    }),
    discoverTestsAtRevision({
      repositoryRoot: normalized.head.directory,
      repositoryId: normalized.repositoryId,
      revision: normalized.head.revision,
    }),
  ]);
  const ir = createTestDiscoveryCanonicalIr({
    repositoryId: normalized.repositoryId,
    baseRevision: normalized.base.revision,
    headRevision: normalized.head.revision,
    analyzerVersion: normalized.analyzerVersion,
    baseDiscovery,
    headDiscovery,
  });
  return { baseDiscovery, headDiscovery, ir };
}
