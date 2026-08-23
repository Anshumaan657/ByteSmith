import path from "node:path";
import ts from "typescript";
import { stableId } from "@bytesmith/canonicalization";
import { compareCodePoints } from "@bytesmith/impact-types";
import { toRepositoryPath } from "./path.js";
import type {
  CompilerGap,
  ModuleReference,
  TypeScriptImportBinding,
  TypeScriptImportKind,
  TypeScriptProject,
  TypeScriptRelationship,
  TypeScriptRelationshipKind,
  TypeScriptSymbol,
  TypeScriptSymbolKind,
} from "./types.js";

export interface ProjectRelationshipAnalysis {
  importBindings: TypeScriptImportBinding[];
  relationships: TypeScriptRelationship[];
  gaps: CompilerGap[];
}

interface DeclarationIdentity {
  path: string;
  name: string;
  qualifiedName: string;
  kind: TypeScriptSymbolKind;
}

interface TargetResolution {
  compilerSymbol: ts.Symbol;
  declaration?: DeclarationIdentity;
  record?: TypeScriptSymbol;
}

function compareLocated(
  left: {
    sourcePath?: string;
    fromPath?: string;
    line?: number;
    column?: number;
    id: string;
  },
  right: {
    sourcePath?: string;
    fromPath?: string;
    line?: number;
    column?: number;
    id: string;
  },
): number {
  for (const comparison of [
    compareCodePoints(
      left.sourcePath ?? left.fromPath ?? "",
      right.sourcePath ?? right.fromPath ?? "",
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

function resolvedAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

function declarationName(
  name: ts.DeclarationName | undefined,
): string | undefined {
  if (!name) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text.normalize("NFC");
  }
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteralLike(name.expression) ||
      ts.isNumericLiteral(name.expression))
  ) {
    return name.expression.text.normalize("NFC");
  }
  return undefined;
}

function topLevelVariable(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  );
}

function declarationIdentity(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
): DeclarationIdentity | undefined {
  const repositoryPath = toRepositoryPath(
    repositoryRoot,
    path.resolve(declaration.getSourceFile().fileName),
  );
  if (!repositoryPath || repositoryPath === ".") return undefined;

  let name: string | undefined;
  let kind: TypeScriptSymbolKind | undefined;
  if (ts.isFunctionDeclaration(declaration)) {
    name = declaration.name?.text ?? "default";
    kind = "function";
  } else if (
    ts.isVariableDeclaration(declaration) &&
    topLevelVariable(declaration)
  ) {
    name = declarationName(declaration.name);
    if (name) {
      const symbol = checker.getSymbolAtLocation(declaration.name);
      const callable = symbol
        ? checker
            .getTypeOfSymbolAtLocation(symbol, declaration)
            .getCallSignatures().length > 0
        : false;
      kind = callable ? "function" : "variable";
    }
  } else if (ts.isInterfaceDeclaration(declaration)) {
    name = declaration.name.text;
    kind = "interface";
  } else if (ts.isTypeAliasDeclaration(declaration)) {
    name = declaration.name.text;
    kind = "type_alias";
  } else if (ts.isClassDeclaration(declaration)) {
    name = declaration.name?.text ?? "default";
    kind = "class";
  } else if (
    ts.isMethodDeclaration(declaration) ||
    ts.isMethodSignature(declaration)
  ) {
    name = declarationName(declaration.name);
    kind = "method";
  } else if (
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isSetAccessorDeclaration(declaration)
  ) {
    name = declarationName(declaration.name);
    kind = "field";
  }
  if (!name || !kind) return undefined;

  const parent = declaration.parent;
  const parentName =
    ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)
      ? (parent.name?.text ?? "default")
      : undefined;
  return {
    path: repositoryPath,
    name,
    qualifiedName: parentName ? `${parentName}.${name}` : name,
    kind,
  };
}

function symbolIndexKey(value: DeclarationIdentity): string {
  return [value.path, value.kind, value.qualifiedName].join("\0");
}

function buildGlobalSymbolIndex(
  symbols: readonly TypeScriptSymbol[],
): Map<string, TypeScriptSymbol[]> {
  const result = new Map<string, TypeScriptSymbol[]>();
  for (const symbol of symbols) {
    const key = symbolIndexKey(symbol);
    const values = result.get(key) ?? [];
    values.push(symbol);
    result.set(key, values);
  }
  return result;
}

function resolveTarget(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  projectId: string,
  compilerSymbol: ts.Symbol,
  localBindings: ReadonlyMap<ts.Symbol, TypeScriptSymbol>,
  globalIndex: ReadonlyMap<string, TypeScriptSymbol[]>,
): TargetResolution {
  const target = resolvedAlias(checker, compilerSymbol);
  const local = localBindings.get(target);
  if (local) return { compilerSymbol: target, record: local };
  const declaration = target.valueDeclaration ?? target.declarations?.[0];
  if (!declaration) return { compilerSymbol: target };
  const identity = declarationIdentity(repositoryRoot, checker, declaration);
  if (!identity) return { compilerSymbol: target };
  const candidates = globalIndex.get(symbolIndexKey(identity)) ?? [];
  const projectCandidate = candidates.filter(
    (candidate) => candidate.projectId === projectId,
  );
  const record =
    projectCandidate.length === 1
      ? projectCandidate[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined;
  return {
    compilerSymbol: target,
    declaration: identity,
    ...(record ? { record } : {}),
  };
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number; endLine: number; endColumn: number } {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function isNamedDeclarationNode(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isTypeParameterDeclaration(node)
  );
}

function enclosingSymbol(
  checker: ts.TypeChecker,
  node: ts.Node,
  bindings: ReadonlyMap<ts.Symbol, TypeScriptSymbol>,
): TypeScriptSymbol | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (isNamedDeclarationNode(current)) {
      const symbol = current.name
        ? checker.getSymbolAtLocation(current.name)
        : undefined;
      if (symbol) {
        const record = bindings.get(resolvedAlias(checker, symbol));
        if (record) return record;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function insideImportOrExport(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isExportDeclaration(current) ||
      ts.isExportAssignment(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function declarationNameNode(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  return isNamedDeclarationNode(parent) && parent.name === node;
}

function callTarget(
  node: ts.CallExpression | ts.NewExpression,
): ts.Node | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
    return expression;
  }
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression
  ) {
    return expression.argumentExpression;
  }
  return undefined;
}

function moduleReferenceFor(
  references: readonly ModuleReference[],
  sourcePath: string,
  line: number,
  specifier: string,
): ModuleReference | undefined {
  return references.find(
    (reference) =>
      reference.fromPath === sourcePath &&
      reference.line === line &&
      reference.specifier === specifier,
  );
}

export function analyzeProjectRelationships(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  project: TypeScriptProject,
  program: ts.Program,
  localBindings: ReadonlyMap<ts.Symbol, TypeScriptSymbol>,
  allSymbols: readonly TypeScriptSymbol[],
  moduleReferences: readonly ModuleReference[],
): ProjectRelationshipAnalysis {
  const checker = program.getTypeChecker();
  const sourcePaths = new Set(project.sourceFiles);
  const globalIndex = buildGlobalSymbolIndex(allSymbols);
  const importBindings: TypeScriptImportBinding[] = [];
  const relationships: TypeScriptRelationship[] = [];
  const gaps: CompilerGap[] = [];

  const addUnresolvedGap = (
    sourcePath: string,
    node: ts.Node,
    summary: string,
    relationshipId?: string,
  ): void => {
    const location = sourceLocation(node.getSourceFile(), node);
    gaps.push({
      id: stableId("typescript-gap", {
        repositoryId,
        revision,
        projectId: project.id,
        type: "unresolved_symbol",
        sourcePath,
        line: location.line,
        column: location.column,
        summary,
      }),
      repositoryId,
      revision,
      projectId: project.id,
      type: "unresolved_symbol",
      blockingRelevance: "required",
      summary,
      path: sourcePath,
      line: location.line,
      column: location.column,
      ...(relationshipId ? { relationshipId } : {}),
    });
  };

  const addImportBinding = (
    sourceFile: ts.SourceFile,
    sourcePath: string,
    declaration: ts.ImportDeclaration | ts.ImportEqualsDeclaration,
    identifier: ts.Identifier,
    importedName: string,
    kind: TypeScriptImportKind,
    typeOnly: boolean,
    specifier: string,
  ): void => {
    const location = sourceLocation(sourceFile, identifier);
    const compilerSymbol = checker.getSymbolAtLocation(identifier);
    const target = compilerSymbol
      ? resolveTarget(
          repositoryRoot,
          checker,
          project.id,
          compilerSymbol,
          localBindings,
          globalIndex,
        )
      : undefined;
    const declarationLine = sourceLocation(sourceFile, declaration).line;
    const moduleReference = moduleReferenceFor(
      moduleReferences,
      sourcePath,
      declarationLine,
      specifier,
    );
    const binding: TypeScriptImportBinding = {
      id: stableId("typescript-import-binding", {
        repositoryId,
        revision,
        projectId: project.id,
        sourcePath,
        localName: identifier.text,
        importedName,
        kind,
        typeOnly,
        line: location.line,
        column: location.column,
      }),
      repositoryId,
      revision,
      projectId: project.id,
      sourcePath,
      localName: identifier.text.normalize("NFC"),
      importedName: importedName.normalize("NFC"),
      kind,
      typeOnly,
      resolution: moduleReference?.resolution ?? "unresolved",
      line: location.line,
      column: location.column,
      ...(moduleReference ? { moduleReferenceId: moduleReference.id } : {}),
      ...(target?.declaration ? { targetPath: target.declaration.path } : {}),
      ...(target?.record
        ? {
            targetPath: target.record.path,
            targetSymbolId: target.record.id,
          }
        : {}),
    };
    importBindings.push(binding);
    if (
      binding.resolution === "resolved_internal" &&
      kind !== "namespace" &&
      kind !== "import_equals" &&
      !binding.targetSymbolId
    ) {
      addUnresolvedGap(
        sourcePath,
        identifier,
        `Imported symbol ${importedName} from ${specifier} could not be linked to a supported declaration.`,
        binding.id,
      );
    }
  };

  for (const sourceFile of program.getSourceFiles()) {
    const sourcePath = toRepositoryPath(
      repositoryRoot,
      path.resolve(sourceFile.fileName),
    );
    if (!sourcePath || !sourcePaths.has(sourcePath)) continue;

    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.importClause
      ) {
        const specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (clause.name) {
          addImportBinding(
            sourceFile,
            sourcePath,
            statement,
            clause.name,
            "default",
            "default",
            clause.isTypeOnly,
            specifier,
          );
        }
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            addImportBinding(
              sourceFile,
              sourcePath,
              statement,
              clause.namedBindings.name,
              "*",
              "namespace",
              clause.isTypeOnly,
              specifier,
            );
          } else {
            for (const element of clause.namedBindings.elements) {
              addImportBinding(
                sourceFile,
                sourcePath,
                statement,
                element.name,
                element.propertyName?.text ?? element.name.text,
                "named",
                clause.isTypeOnly || element.isTypeOnly,
                specifier,
              );
            }
          }
        }
      } else if (
        ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression &&
        ts.isStringLiteralLike(statement.moduleReference.expression)
      ) {
        addImportBinding(
          sourceFile,
          sourcePath,
          statement,
          statement.name,
          "export=",
          "import_equals",
          statement.isTypeOnly,
          statement.moduleReference.expression.text,
        );
      }
    }

    const callTargets = new Set<ts.Node>();
    const addRelationship = (
      node: ts.Node,
      kind: TypeScriptRelationshipKind,
    ): void => {
      const compilerSymbol = checker.getSymbolAtLocation(node);
      if (!compilerSymbol) return;
      const target = resolveTarget(
        repositoryRoot,
        checker,
        project.id,
        compilerSymbol,
        localBindings,
        globalIndex,
      );
      if (!target.record) {
        if (target.declaration) {
          addUnresolvedGap(
            sourcePath,
            node,
            `Referenced repository symbol ${target.declaration.qualifiedName} could not be linked to a supported declaration.`,
          );
        }
        return;
      }
      const from = enclosingSymbol(checker, node, localBindings);
      const location = sourceLocation(sourceFile, node);
      relationships.push({
        id: stableId("typescript-relationship", {
          repositoryId,
          revision,
          projectId: project.id,
          kind,
          fromPath: sourcePath,
          fromSymbolId: from?.id ?? null,
          toSymbolId: target.record.id,
          ...location,
        }),
        repositoryId,
        revision,
        projectId: project.id,
        kind,
        authority: "authoritative",
        fromPath: sourcePath,
        toPath: target.record.path,
        toName: target.record.qualifiedName,
        toSymbolId: target.record.id,
        ...location,
        ...(from ? { fromSymbolId: from.id } : {}),
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = callTarget(node);
        if (target) {
          callTargets.add(target);
          addRelationship(target, "call");
        }
      }
      if (
        (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
        !callTargets.has(node) &&
        !declarationNameNode(node) &&
        !insideImportOrExport(node)
      ) {
        addRelationship(node, "reference");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    importBindings: uniqueById(importBindings).sort(compareLocated),
    relationships: uniqueById(relationships).sort(compareLocated),
    gaps: uniqueById(gaps).sort(compareLocated),
  };
}
