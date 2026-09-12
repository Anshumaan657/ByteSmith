import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";
import { stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import { discoverTypeScriptProjects } from "./discovery.js";
import { TypeScriptDiscoveryError } from "./errors.js";
import { resolveRepositoryRoot, toRepositoryPath } from "./path.js";
import { analyzeProjectRelationships } from "./relationships.js";
import { analyzePackageExports, analyzeProjectSymbols } from "./symbols.js";
import type {
  CompilerDiagnostic,
  CompilerDiagnosticCategory,
  CompilerDiagnosticPhase,
  CompilerGap,
  CompilerGapType,
  CompilerProjectAnalysis,
  CreateTypeScriptCompilerSessionOptions,
  ModuleReference,
  ModuleReferenceKind,
  RepositoryProjectDiscovery,
  TypeScriptContract,
  TypeScriptExport,
  TypeScriptImportBinding,
  TypeScriptCompilerSession,
  TypeScriptProject,
  TypeScriptRelationship,
  TypeScriptSymbol,
} from "./types.js";

interface ParsedProject {
  options: ts.CompilerOptions;
  errors: readonly ts.Diagnostic[];
}

interface ProjectResult {
  summary: CompilerProjectAnalysis;
  diagnostics: CompilerDiagnostic[];
  moduleReferences: ModuleReference[];
  symbols: TypeScriptSymbol[];
  contracts: TypeScriptContract[];
  exports: TypeScriptExport[];
  importBindings: TypeScriptImportBinding[];
  relationships: TypeScriptRelationship[];
  gaps: CompilerGap[];
  program: ts.Program;
  project: TypeScriptProject;
  symbolBindings: ReadonlyMap<ts.Symbol, TypeScriptSymbol>;
}

const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

function categoryName(
  category: ts.DiagnosticCategory,
): CompilerDiagnosticCategory {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    default:
      return "message";
  }
}

function normalizeSummary(repositoryRoot: string, value: string): string {
  const rootWithSeparator = `${repositoryRoot}${path.sep}`;
  return value
    .replaceAll(rootWithSeparator, "")
    .replaceAll("\\", "/")
    .normalize("NFC");
}

function compilerDiagnostic(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  projectId: string,
  phase: CompilerDiagnosticPhase,
  diagnostic: ts.Diagnostic,
): CompilerDiagnostic {
  const repositoryPath = diagnostic.file
    ? toRepositoryPath(repositoryRoot, path.resolve(diagnostic.file.fileName))
    : undefined;
  const location =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  const summary = normalizeSummary(
    repositoryRoot,
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  );
  const semanticInput = {
    repositoryId,
    revision,
    projectId,
    phase,
    code: diagnostic.code,
    category: categoryName(diagnostic.category),
    path: repositoryPath ?? null,
    line: location ? location.line + 1 : null,
    column: location ? location.character + 1 : null,
    summary,
  };
  return {
    id: stableId("typescript-diagnostic", semanticInput),
    repositoryId,
    revision,
    projectId,
    phase,
    code: diagnostic.code,
    category: semanticInput.category,
    summary,
    ...(repositoryPath && repositoryPath !== "."
      ? { path: repositoryPath }
      : {}),
    ...(location
      ? { line: location.line + 1, column: location.character + 1 }
      : {}),
  };
}

function compareLocated(
  left: {
    path?: string;
    fromPath?: string;
    line?: number;
    column?: number;
    id: string;
  },
  right: {
    path?: string;
    fromPath?: string;
    line?: number;
    column?: number;
    id: string;
  },
): number {
  for (const comparison of [
    compareCodePoints(
      left.path ?? left.fromPath ?? "",
      right.path ?? right.fromPath ?? "",
    ),
    (left.line ?? 0) - (right.line ?? 0),
    (left.column ?? 0) - (right.column ?? 0),
    compareCodePoints(left.id, right.id),
  ]) {
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function parseProject(
  repositoryRoot: string,
  project: TypeScriptProject,
): ParsedProject {
  const configPath = path.join(repositoryRoot, project.configPath);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const defaults =
    project.configKind === "jsconfig"
      ? {
          allowJs: true,
          maxNodeModuleJsDepth: 2,
          allowSyntheticDefaultImports: true,
        }
      : undefined;
  const parsed = ts.parseJsonConfigFileContent(
    read.error ? {} : read.config,
    ts.sys,
    path.dirname(configPath),
    defaults,
    configPath,
  );
  return {
    options: {
      ...parsed.options,
      // TypeScript 6 reports `baseUrl` as a migration error even though it is
      // still operational in supported projects. The analyzer pins TS 6 and
      // silences only that compiler version's deprecation gate.
      ignoreDeprecations: parsed.options.ignoreDeprecations ?? "6.0",
    },
    errors: [...(read.error ? [read.error] : []), ...parsed.errors],
  };
}

function diagnosticGap(
  repositoryId: string,
  revision: string,
  diagnostic: CompilerDiagnostic,
): CompilerGap | undefined {
  if (diagnostic.category !== "error") return undefined;
  if (
    diagnostic.phase === "semantic" &&
    [2307, 2792, 7016].includes(diagnostic.code)
  ) {
    return undefined;
  }
  const type: CompilerGapType =
    diagnostic.phase === "syntactic"
      ? "parse_failure"
      : diagnostic.phase === "semantic"
        ? "type_check_failure"
        : "configuration_failure";
  const summary =
    type === "parse_failure"
      ? `TypeScript could not parse part of ${diagnostic.path ?? "the configured project"}: ${diagnostic.summary}`
      : type === "type_check_failure"
        ? `TypeScript could not safely type-check ${diagnostic.path ?? "the configured project"}: ${diagnostic.summary}`
        : `TypeScript could not fully configure the project: ${diagnostic.summary}`;
  const semanticInput = {
    repositoryId,
    revision,
    projectId: diagnostic.projectId,
    type,
    diagnosticId: diagnostic.id,
  };
  return {
    id: stableId("typescript-gap", semanticInput),
    repositoryId,
    revision,
    projectId: diagnostic.projectId,
    type,
    blockingRelevance: "required",
    summary,
    ...(diagnostic.path ? { path: diagnostic.path } : {}),
    ...(diagnostic.line ? { line: diagnostic.line } : {}),
    ...(diagnostic.column ? { column: diagnostic.column } : {}),
    diagnosticIds: [diagnostic.id],
  };
}

function externalPackageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  if (specifier.startsWith("node:")) return specifier;
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : specifier
    : parts[0];
}

function realPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: location.line + 1, column: location.character + 1 };
}

function moduleReference(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  projectId: string,
  sourceFile: ts.SourceFile,
  fromPath: string,
  node: ts.Node,
  kind: ModuleReferenceKind,
  typeOnly: boolean,
  specifier: string | undefined,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  cache: ts.ModuleResolutionCache,
): { reference: ModuleReference; gap?: CompilerGap } {
  const location = sourceLocation(sourceFile, node);
  let resolution: ModuleReference["resolution"] = "dynamic";
  let resolvedPath: string | undefined;
  let externalPackage: string | undefined;

  if (kind !== "dynamic_import" && specifier !== undefined) {
    if (builtins.has(specifier)) {
      resolution = "resolved_external";
      externalPackage = specifier.startsWith("node:")
        ? specifier
        : `node:${specifier}`;
    } else {
      const resolved = ts.resolveModuleName(
        specifier,
        sourceFile.fileName,
        options,
        host,
        cache,
      ).resolvedModule;
      if (!resolved) {
        resolution = "unresolved";
      } else {
        const canonical = realPath(resolved.resolvedFileName);
        const repositoryPath = toRepositoryPath(repositoryRoot, canonical);
        if (
          repositoryPath &&
          repositoryPath !== "." &&
          !repositoryPath.split("/").includes("node_modules")
        ) {
          resolution = "resolved_internal";
          resolvedPath = repositoryPath;
        } else {
          resolution = "resolved_external";
          externalPackage = externalPackageName(specifier) ?? specifier;
        }
      }
    }
  }

  const semanticInput = {
    repositoryId,
    revision,
    projectId,
    fromPath,
    kind,
    typeOnly,
    specifier: specifier ?? null,
    resolution,
    resolvedPath: resolvedPath ?? null,
    externalPackage: externalPackage ?? null,
    ...location,
  };
  const reference: ModuleReference = {
    id: stableId("typescript-module-reference", semanticInput),
    repositoryId,
    revision,
    projectId,
    fromPath,
    kind,
    typeOnly,
    resolution,
    ...location,
    ...(specifier !== undefined
      ? { specifier: specifier.normalize("NFC") }
      : {}),
    ...(resolvedPath ? { resolvedPath } : {}),
    ...(externalPackage ? { externalPackage } : {}),
  };
  if (resolution !== "unresolved" && resolution !== "dynamic") {
    return { reference };
  }
  const computed = specifier === undefined;
  const type: CompilerGapType =
    resolution === "dynamic" ? "dynamic_import" : "unresolved_module";
  const summary =
    type === "dynamic_import"
      ? computed
        ? `A computed ${kind === "require" ? "require" : "dynamic import"} cannot be resolved statically.`
        : `Dynamic import ${specifier} is retained as an explicit unknown instead of a guessed edge.`
      : `Module ${specifier} imported by ${fromPath} could not be resolved.`;
  return {
    reference,
    gap: {
      id: stableId("typescript-gap", {
        repositoryId,
        revision,
        projectId,
        type,
        moduleReferenceId: reference.id,
      }),
      repositoryId,
      revision,
      projectId,
      type,
      blockingRelevance: "required",
      summary,
      path: fromPath,
      ...location,
      moduleReferenceId: reference.id,
    },
  };
}

function collectModuleReferences(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  project: TypeScriptProject,
  program: ts.Program,
  host: ts.CompilerHost,
  options: ts.CompilerOptions,
): { references: ModuleReference[]; gaps: CompilerGap[] } {
  const sourcePaths = new Set(project.sourceFiles);
  const cache = ts.createModuleResolutionCache(
    repositoryRoot,
    (fileName) => fileName,
    options,
  );
  const references: ModuleReference[] = [];
  const gaps: CompilerGap[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const fromPath = toRepositoryPath(
      repositoryRoot,
      realPath(sourceFile.fileName),
    );
    if (!fromPath || !sourcePaths.has(fromPath)) continue;

    const add = (
      node: ts.Node,
      kind: ModuleReferenceKind,
      typeOnly: boolean,
      specifier: string | undefined,
    ): void => {
      const result = moduleReference(
        repositoryRoot,
        repositoryId,
        revision,
        project.id,
        sourceFile,
        fromPath,
        node,
        kind,
        typeOnly,
        specifier,
        options,
        host,
        cache,
      );
      references.push(result.reference);
      if (result.gap) gaps.push(result.gap);
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        add(
          node,
          "import",
          node.importClause?.isTypeOnly ?? false,
          node.moduleSpecifier.text,
        );
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        add(node, "export", node.isTypeOnly, node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        add(
          node,
          "import_equals",
          node.isTypeOnly,
          node.moduleReference.expression.text,
        );
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments[0];
        add(
          node,
          "dynamic_import",
          false,
          argument && ts.isStringLiteralLike(argument)
            ? argument.text
            : undefined,
        );
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        const argument = node.arguments[0];
        add(
          node,
          "require",
          false,
          argument && ts.isStringLiteralLike(argument)
            ? argument.text
            : undefined,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    references: uniqueById(references).sort(compareLocated),
    gaps: uniqueById(gaps).sort(compareLocated),
  };
}

function runtimeBoundaryGaps(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  project: TypeScriptProject,
  program: ts.Program,
): CompilerGap[] {
  const sourcePaths = new Set(project.sourceFiles);
  const gaps: CompilerGap[] = [];
  const add = (
    sourceFile: ts.SourceFile,
    path: string,
    node: ts.Node,
    type: Extract<
      CompilerGapType,
      "reflection" | "complex_dependency_injection" | "generated_code"
    >,
    summary: string,
  ): void => {
    const location = sourceLocation(sourceFile, node);
    gaps.push({
      id: stableId("typescript-gap", {
        repositoryId,
        revision,
        projectId: project.id,
        type,
        path,
        ...location,
      }),
      repositoryId,
      revision,
      projectId: project.id,
      type,
      blockingRelevance: "required",
      summary,
      path,
      ...location,
    });
  };

  for (const sourceFile of program.getSourceFiles()) {
    const repositoryPath = toRepositoryPath(
      repositoryRoot,
      realPath(sourceFile.fileName),
    );
    if (!repositoryPath || !sourcePaths.has(repositoryPath)) continue;
    if (
      /(?:^|[/._-])generated(?:[._-]|$)/iu.test(repositoryPath) ||
      /(?:@generated|code generated|auto-generated|automatically generated)/iu.test(
        sourceFile.text.slice(0, 1_024),
      )
    ) {
      add(
        sourceFile,
        repositoryPath,
        sourceFile,
        "generated_code",
        "Generated TypeScript or JavaScript is retained as an explicit unknown because its source contract may live outside this snapshot.",
      );
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const reflection =
          (ts.isIdentifier(expression) && expression.text === "eval") ||
          (ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            expression.expression.text === "Reflect");
        if (reflection) {
          add(
            sourceFile,
            repositoryPath,
            node,
            "reflection",
            "Runtime reflection cannot be converted into an authoritative static relationship.",
          );
        }
        if (
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "container" &&
          ["get", "resolve"].includes(expression.name.text)
        ) {
          add(
            sourceFile,
            repositoryPath,
            node,
            "complex_dependency_injection",
            "Runtime dependency-injection container resolution cannot be linked to one authoritative declaration.",
          );
        }
      }
      if (ts.canHaveDecorators(node)) {
        for (const decorator of ts.getDecorators(node) ?? []) {
          const expression = ts.isCallExpression(decorator.expression)
            ? decorator.expression.expression
            : decorator.expression;
          const name = ts.isIdentifier(expression)
            ? expression.text
            : ts.isPropertyAccessExpression(expression)
              ? expression.name.text
              : undefined;
          if (name && ["Inject", "Injectable", "Autowired"].includes(name)) {
            add(
              sourceFile,
              repositoryPath,
              decorator,
              "complex_dependency_injection",
              "Decorator-driven dependency injection cannot be linked to one authoritative runtime implementation.",
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return uniqueById(gaps).sort(compareLocated);
}

function analyzeProject(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  project: TypeScriptProject,
): ProjectResult {
  const parsed = parseProject(repositoryRoot, project);
  const host = ts.createCompilerHost(parsed.options, true);
  const bundledLibraryDirectory =
    process.env.BYTESMITH_TYPESCRIPT_LIB_DIRECTORY;
  if (bundledLibraryDirectory) {
    host.getDefaultLibFileName = (options) =>
      path.join(
        path.resolve(bundledLibraryDirectory),
        ts.getDefaultLibFileName(options),
      );
  }
  const rootNames = project.sourceFiles.map((file) =>
    path.join(repositoryRoot, file),
  );
  const program = ts.createProgram({
    rootNames,
    options: parsed.options,
    host,
    configFileParsingDiagnostics: parsed.errors,
  });
  const diagnosticInputs: [
    CompilerDiagnosticPhase,
    readonly ts.Diagnostic[],
  ][] = [
    ["configuration", program.getConfigFileParsingDiagnostics()],
    ["options", program.getOptionsDiagnostics()],
    ["global", program.getGlobalDiagnostics()],
    ["syntactic", program.getSyntacticDiagnostics()],
    ["semantic", program.getSemanticDiagnostics()],
  ];
  const diagnostics = uniqueById(
    diagnosticInputs.flatMap(([phase, values]) =>
      values.map((diagnostic) =>
        compilerDiagnostic(
          repositoryRoot,
          repositoryId,
          revision,
          project.id,
          phase,
          diagnostic,
        ),
      ),
    ),
  ).sort(compareLocated);
  const modules = collectModuleReferences(
    repositoryRoot,
    repositoryId,
    revision,
    project,
    program,
    host,
    parsed.options,
  );
  const runtimeGaps = runtimeBoundaryGaps(
    repositoryRoot,
    repositoryId,
    revision,
    project,
    program,
  );
  const semantics = analyzeProjectSymbols(
    repositoryRoot,
    repositoryId,
    revision,
    project,
    program,
  );
  const gaps = uniqueById([
    ...diagnostics
      .map((diagnostic) => diagnosticGap(repositoryId, revision, diagnostic))
      .filter((gap): gap is CompilerGap => gap !== undefined),
    ...modules.gaps,
    ...runtimeGaps,
    ...semantics.gaps,
  ]).sort(compareLocated);
  const loadedSourceFileCount = program
    .getSourceFiles()
    .map((sourceFile) =>
      toRepositoryPath(repositoryRoot, realPath(sourceFile.fileName)),
    )
    .filter(
      (file): file is string =>
        file !== undefined && file !== "." && !file.includes("node_modules/"),
    ).length;
  const status =
    project.status === "incomplete" ||
    diagnostics.some((diagnostic) => diagnostic.category === "error") ||
    gaps.length > 0
      ? "incomplete"
      : "completed";
  return {
    program,
    project,
    symbolBindings: semantics.symbolBindings,
    diagnostics,
    moduleReferences: modules.references,
    symbols: semantics.symbols,
    contracts: semantics.contracts,
    exports: semantics.exports,
    importBindings: [],
    relationships: [],
    gaps,
    summary: {
      projectId: project.id,
      configPath: project.configPath,
      sourceFiles: [...project.sourceFiles],
      rootFileCount: rootNames.length,
      loadedSourceFileCount,
      diagnosticCount: diagnostics.length,
      moduleReferenceCount: modules.references.length,
      symbolCount: semantics.symbols.length,
      contractCount: semantics.contracts.length,
      exportCount: semantics.exports.length,
      importBindingCount: 0,
      relationshipCount: 0,
      gapCount: gaps.length,
      status,
    },
  };
}

function discoveryGaps(
  repositoryId: string,
  revision: string,
  discovery: RepositoryProjectDiscovery,
): CompilerGap[] {
  return discovery.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => ({
      id: stableId("typescript-gap", {
        repositoryId,
        revision,
        type: "configuration_failure",
        diagnostic,
      }),
      repositoryId,
      revision,
      type: "configuration_failure" as const,
      blockingRelevance: "required" as const,
      summary: `Project discovery could not establish a complete compiler input: ${diagnostic.summary}`,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
      ...(diagnostic.line ? { line: diagnostic.line } : {}),
      ...(diagnostic.column ? { column: diagnostic.column } : {}),
    }))
    .sort(compareLocated);
}

export async function createTypeScriptCompilerSession(
  options: CreateTypeScriptCompilerSessionOptions,
): Promise<TypeScriptCompilerSession> {
  let repositoryId: string;
  let revision: string;
  try {
    repositoryId = validateStableId(options.repositoryId, "Repository ID");
  } catch (cause) {
    throw new TypeScriptDiscoveryError(
      "repository_identity_invalid",
      "TypeScript compilation requires the stable repository ID from Phase 3.",
      cause,
    );
  }
  try {
    revision = validateExactGitRevision(options.revision);
  } catch (cause) {
    throw new TypeScriptDiscoveryError(
      "revision_invalid",
      "TypeScript compilation requires an exact Git object ID.",
      cause,
    );
  }
  const repositoryRoot = await resolveRepositoryRoot(options.repositoryRoot);
  const discovery =
    options.discovery ??
    (await discoverTypeScriptProjects({ repositoryRoot, repositoryId }));
  if (discovery.repositoryId !== repositoryId) {
    throw new TypeScriptDiscoveryError(
      "discovery_identity_mismatch",
      "Compiler discovery belongs to a different repository identity.",
    );
  }

  const programs = new Map<string, ts.Program>();
  const results = discovery.projects.map((project) => {
    const result = analyzeProject(
      repositoryRoot,
      repositoryId,
      revision,
      project,
    );
    programs.set(project.id, result.program);
    return result;
  });
  const diagnostics = uniqueById(
    results.flatMap((result) => result.diagnostics),
  ).sort(compareLocated);
  const moduleReferences = uniqueById(
    results.flatMap((result) => result.moduleReferences),
  ).sort(compareLocated);
  const symbols = uniqueById(results.flatMap((result) => result.symbols)).sort(
    compareLocated,
  );
  const contracts = uniqueById(
    results.flatMap((result) => result.contracts),
  ).sort((left, right) => compareCodePoints(left.id, right.id));
  const exports = uniqueById(results.flatMap((result) => result.exports)).sort(
    compareLocated,
  );
  for (const result of results) {
    const relationshipAnalysis = analyzeProjectRelationships(
      repositoryRoot,
      repositoryId,
      revision,
      result.project,
      result.program,
      result.symbolBindings,
      symbols,
      result.moduleReferences,
    );
    result.importBindings = relationshipAnalysis.importBindings;
    result.relationships = relationshipAnalysis.relationships;
    result.gaps = uniqueById([
      ...result.gaps,
      ...relationshipAnalysis.gaps,
    ]).sort(compareLocated);
    result.summary.importBindingCount = result.importBindings.length;
    result.summary.relationshipCount = result.relationships.length;
    result.summary.gapCount = result.gaps.length;
    if (relationshipAnalysis.gaps.length > 0) {
      result.summary.status = "incomplete";
    }
  }
  const importBindings = uniqueById(
    results.flatMap((result) => result.importBindings),
  ).sort(compareLocated);
  const relationships = uniqueById(
    results.flatMap((result) => result.relationships),
  ).sort(compareLocated);
  const packageAnalysis = analyzePackageExports(
    repositoryId,
    revision,
    discovery,
  );
  const gaps = uniqueById([
    ...discoveryGaps(repositoryId, revision, discovery),
    ...results.flatMap((result) => result.gaps),
    ...packageAnalysis.gaps,
  ]).sort(compareLocated);
  const projects = results.map((result) => result.summary);
  const status =
    discovery.status === "incomplete" ||
    projects.some((project) => project.status === "incomplete") ||
    gaps.length > 0
      ? "incomplete"
      : "completed";
  return {
    discovery,
    analysis: {
      schemaVersion: "1.0.0",
      repositoryId,
      revision,
      compilerVersion: ts.version,
      discoveryStatus: discovery.status,
      projects,
      diagnostics,
      moduleReferences,
      symbols,
      contracts,
      exports,
      packageExports: packageAnalysis.exports,
      importBindings,
      relationships,
      gaps,
      status,
    },
    getProgram(projectId: string): ts.Program | undefined {
      return programs.get(projectId);
    },
  };
}
