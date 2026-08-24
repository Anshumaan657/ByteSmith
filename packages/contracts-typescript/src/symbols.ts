import path from "node:path";
import ts from "typescript";
import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import { compareCodePoints } from "@bytesmith/impact-types";
import { toRepositoryPath } from "./path.js";
import type {
  CallableSignature,
  CompilerGap,
  ParameterSignature,
  RepositoryProjectDiscovery,
  TypeMemberSignature,
  TypeParameterSignature,
  TypeScriptContract,
  TypeScriptContractKind,
  TypeScriptExport,
  TypeScriptPackageExport,
  TypeScriptProject,
  TypeScriptSymbol,
  TypeScriptSymbolKind,
  TypeScriptVisibility,
  WorkspacePackage,
} from "./types.js";

export interface ProjectSymbolAnalysis {
  symbols: TypeScriptSymbol[];
  contracts: TypeScriptContract[];
  exports: TypeScriptExport[];
  gaps: CompilerGap[];
  symbolBindings: ReadonlyMap<ts.Symbol, TypeScriptSymbol>;
}

export interface PackageExportAnalysis {
  exports: TypeScriptPackageExport[];
  gaps: CompilerGap[];
}

interface UnsupportedDeclaration {
  node: ts.Node;
  path: string;
  projectId: string;
  summary: string;
  parentSymbolId?: string;
  alwaysPublic?: boolean;
}

interface ContractSeed {
  node: ts.Declaration;
  symbol: ts.Symbol;
  record: TypeScriptSymbol;
  kind: TypeScriptContractKind;
}

interface PackageExportLeaf {
  subpath: string;
  conditions: string[];
  target: string | null;
}

interface UnsupportedPackageExport {
  workspacePackage: WorkspacePackage;
  subpath: string;
  conditions: string[];
}

const typeFormatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(node).some((modifier) => modifier.kind === kind);
}

function visibility(node: ts.Node): TypeScriptVisibility {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return "private";
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return "public";
}

function normalizedTypeText(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
  additionalFlags: ts.TypeFormatFlags = ts.TypeFormatFlags.None,
): string {
  return checker
    .typeToString(type, location, typeFormatFlags | additionalFlags)
    .replaceAll(`${repositoryRoot}${path.sep}`, "")
    .replaceAll("\\", "/")
    .normalize("NFC");
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

function declarationLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Pick<TypeScriptSymbol, "line" | "column" | "endLine" | "endColumn"> {
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

function symbolAtDeclaration(
  checker: ts.TypeChecker,
  node: ts.Declaration,
): ts.Symbol | undefined {
  const named = node as ts.NamedDeclaration;
  return named.name
    ? checker.getSymbolAtLocation(named.name)
    : checker.getSymbolAtLocation(node);
}

function typeParameters(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  values: readonly ts.TypeParameterDeclaration[] | undefined,
): TypeParameterSignature[] {
  return (values ?? []).map((parameter) => ({
    name: parameter.name.text.normalize("NFC"),
    ...(parameter.constraint
      ? {
          constraint: normalizedTypeText(
            repositoryRoot,
            checker,
            checker.getTypeFromTypeNode(parameter.constraint),
            parameter.constraint,
          ),
        }
      : {}),
    ...(parameter.default
      ? {
          default: normalizedTypeText(
            repositoryRoot,
            checker,
            checker.getTypeFromTypeNode(parameter.default),
            parameter.default,
          ),
        }
      : {}),
  }));
}

function parameterSignature(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  parameter: ts.Symbol,
  fallback: ts.Node,
): ParameterSignature {
  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
  const parameterDeclaration =
    declaration && ts.isParameter(declaration) ? declaration : undefined;
  return {
    name: parameter.getName().normalize("NFC"),
    type: normalizedTypeText(
      repositoryRoot,
      checker,
      checker.getTypeOfSymbolAtLocation(parameter, declaration ?? fallback),
      declaration ?? fallback,
    ),
    optional:
      (parameter.flags & ts.SymbolFlags.Optional) !== 0 ||
      parameterDeclaration?.questionToken !== undefined ||
      parameterDeclaration?.initializer !== undefined,
    rest: parameterDeclaration?.dotDotDotToken !== undefined,
  };
}

function callableSignatures(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  signatures: readonly ts.Signature[],
  fallback: ts.Node,
): CallableSignature[] {
  return signatures.map((signature) => {
    const declaration = signature.getDeclaration() ?? fallback;
    return {
      typeParameters: typeParameters(
        repositoryRoot,
        checker,
        signature.getDeclaration()?.typeParameters,
      ),
      parameters: signature
        .getParameters()
        .map((parameter) =>
          parameterSignature(repositoryRoot, checker, parameter, declaration),
        ),
      returnType: normalizedTypeText(
        repositoryRoot,
        checker,
        signature.getReturnType(),
        declaration,
      ),
    };
  });
}

function signaturesForSymbol(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  node: ts.Node,
  construct = false,
): CallableSignature[] {
  const type = checker.getTypeOfSymbolAtLocation(symbol, node);
  return callableSignatures(
    repositoryRoot,
    checker,
    construct ? type.getConstructSignatures() : type.getCallSignatures(),
    node,
  );
}

function memberSignature(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  member: ts.ClassElement | ts.TypeElement,
): TypeMemberSignature | undefined {
  if (!(
    ts.isPropertyDeclaration(member) ||
    ts.isPropertySignature(member) ||
    ts.isMethodDeclaration(member) ||
    ts.isMethodSignature(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  )) {
    return undefined;
  }
  const name = declarationName(member.name);
  if (!name) return undefined;
  const symbol = checker.getSymbolAtLocation(member.name);
  if (!symbol) return undefined;
  const isMethod =
    ts.isMethodDeclaration(member) || ts.isMethodSignature(member);
  const type = checker.getTypeOfSymbolAtLocation(symbol, member);
  return {
    name,
    kind: isMethod ? "method" : "field",
    type: normalizedTypeText(repositoryRoot, checker, type, member),
    optional:
      (symbol.flags & ts.SymbolFlags.Optional) !== 0 ||
      ("questionToken" in member && member.questionToken !== undefined),
    readonly: hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
    static: hasModifier(member, ts.SyntaxKind.StaticKeyword),
    visibility: visibility(member),
    signatures: isMethod
      ? callableSignatures(
          repositoryRoot,
          checker,
          type.getCallSignatures(),
          member,
        )
      : [],
  };
}

function heritageTypes(
  repositoryRoot: string,
  checker: ts.TypeChecker,
  node: ts.InterfaceDeclaration | ts.ClassDeclaration,
): string[] {
  return (node.heritageClauses ?? []).flatMap((clause) =>
    clause.types.map((heritage) =>
      normalizedTypeText(
        repositoryRoot,
        checker,
        checker.getTypeAtLocation(heritage),
        heritage,
      ),
    ),
  );
}

function compareLocated(
  left: {
    path?: string;
    sourcePath?: string;
    line?: number;
    column?: number;
    id: string;
  },
  right: {
    path?: string;
    sourcePath?: string;
    line?: number;
    column?: number;
    id: string;
  },
): number {
  for (const comparison of [
    compareCodePoints(
      left.path ?? left.sourcePath ?? "",
      right.path ?? right.sourcePath ?? "",
    ),
    (left.line ?? 0) - (right.line ?? 0),
    (left.column ?? 0) - (right.column ?? 0),
    compareCodePoints(left.id, right.id),
  ]) {
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function resolvedAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

function contractForSeed(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  checker: ts.TypeChecker,
  seed: ContractSeed,
): TypeScriptContract {
  const node = seed.node;
  let signatureValues: CallableSignature[] = [];
  let memberValues: TypeMemberSignature[] = [];
  let typeParameterValues: TypeParameterSignature[] = [];
  let heritage: string[] = [];
  let aliasedType: string | undefined;
  let valueType: string | undefined;

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node)
  ) {
    signatureValues = signaturesForSymbol(
      repositoryRoot,
      checker,
      seed.symbol,
      node,
    );
    typeParameterValues = typeParameters(
      repositoryRoot,
      checker,
      node.typeParameters,
    );
  } else if (ts.isVariableDeclaration(node)) {
    const type = checker.getTypeOfSymbolAtLocation(seed.symbol, node);
    signatureValues = callableSignatures(
      repositoryRoot,
      checker,
      type.getCallSignatures(),
      node,
    );
    valueType = normalizedTypeText(repositoryRoot, checker, type, node);
  } else if (ts.isTypeAliasDeclaration(node)) {
    typeParameterValues = typeParameters(
      repositoryRoot,
      checker,
      node.typeParameters,
    );
    aliasedType = normalizedTypeText(
      repositoryRoot,
      checker,
      checker.getTypeFromTypeNode(node.type),
      node.type,
      ts.TypeFormatFlags.InTypeAlias,
    );
  } else if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
    typeParameterValues = typeParameters(
      repositoryRoot,
      checker,
      node.typeParameters,
    );
    memberValues = [
      ...new Map(
        node.members
          .map((member) => memberSignature(repositoryRoot, checker, member))
          .filter(
            (member): member is TypeMemberSignature => member !== undefined,
          )
          .map((member) => [canonicalJson(member), member]),
      ).values(),
    ];
    heritage = heritageTypes(repositoryRoot, checker, node);
    if (ts.isClassDeclaration(node)) {
      signatureValues = signaturesForSymbol(
        repositoryRoot,
        checker,
        seed.symbol,
        node,
        true,
      );
    }
  }

  const semanticSignature = {
    kind: seed.kind,
    typeParameters: typeParameterValues,
    signatures: signatureValues,
    members: memberValues,
    heritage,
    aliasedType: aliasedType ?? null,
    valueType: valueType ?? null,
  };
  const canonicalSignature = canonicalJson(semanticSignature);
  return {
    id: stableId("typescript-contract", {
      repositoryId,
      revision,
      projectId: seed.record.projectId,
      symbolId: seed.record.id,
      kind: seed.kind,
    }),
    repositoryId,
    revision,
    projectId: seed.record.projectId,
    symbolId: seed.record.id,
    name: seed.record.qualifiedName,
    kind: seed.kind,
    exported: false,
    canonicalSignature,
    fingerprint: stableId("typescript-signature", semanticSignature),
    typeParameters: typeParameterValues,
    signatures: signatureValues,
    members: memberValues,
    heritage,
    ...(aliasedType !== undefined ? { aliasedType } : {}),
    ...(valueType !== undefined ? { valueType } : {}),
  };
}

export function analyzeProjectSymbols(
  repositoryRoot: string,
  repositoryId: string,
  revision: string,
  project: TypeScriptProject,
  program: ts.Program,
): ProjectSymbolAnalysis {
  const checker = program.getTypeChecker();
  const sourcePaths = new Set(project.sourceFiles);
  const records: TypeScriptSymbol[] = [];
  const contracts: TypeScriptContract[] = [];
  const exportRecords: TypeScriptExport[] = [];
  const unsupported: UnsupportedDeclaration[] = [];
  const symbolRecords = new Map<ts.Symbol, TypeScriptSymbol>();
  const declarationRecords = new Map<ts.Declaration, TypeScriptSymbol>();
  const contractSeeds: ContractSeed[] = [];

  const createRecord = (
    sourceFile: ts.SourceFile,
    repositoryPath: string,
    node: ts.Declaration,
    name: string,
    kind: TypeScriptSymbolKind,
    parent?: TypeScriptSymbol,
  ): TypeScriptSymbol | undefined => {
    const compilerSymbol = symbolAtDeclaration(checker, node);
    if (!compilerSymbol) return undefined;
    const existing = symbolRecords.get(compilerSymbol);
    if (existing) {
      declarationRecords.set(node, existing);
      return existing;
    }
    const record: TypeScriptSymbol = {
      id: stableId("typescript-symbol", {
        repositoryId,
        revision,
        projectId: project.id,
        path: repositoryPath,
        kind,
        name,
        parentSymbolId: parent?.id ?? null,
      }),
      repositoryId,
      revision,
      projectId: project.id,
      path: repositoryPath,
      name,
      qualifiedName: parent ? `${parent.qualifiedName}.${name}` : name,
      kind,
      exported: false,
      defaultExport: false,
      ambient: hasModifier(node, ts.SyntaxKind.DeclareKeyword),
      visibility: visibility(node),
      static: hasModifier(node, ts.SyntaxKind.StaticKeyword),
      readonly: hasModifier(node, ts.SyntaxKind.ReadonlyKeyword),
      optional: "questionToken" in node && node.questionToken !== undefined,
      ...declarationLocation(sourceFile, node),
      ...(parent ? { parentSymbolId: parent.id } : {}),
    };
    records.push(record);
    symbolRecords.set(compilerSymbol, record);
    for (const declaration of compilerSymbol.declarations ?? []) {
      declarationRecords.set(declaration, record);
    }
    declarationRecords.set(node, record);
    return record;
  };

  const addMember = (
    sourceFile: ts.SourceFile,
    repositoryPath: string,
    member: ts.ClassElement | ts.TypeElement,
    parent: TypeScriptSymbol,
  ): void => {
    if (
      ts.isCallSignatureDeclaration(member) ||
      ts.isConstructSignatureDeclaration(member) ||
      ts.isIndexSignatureDeclaration(member)
    ) {
      unsupported.push({
        node: member,
        path: repositoryPath,
        projectId: project.id,
        parentSymbolId: parent.id,
        summary: `Public ${parent.kind} ${parent.name} contains a call, construct, or index signature that Phase 4C does not model structurally.`,
      });
      return;
    }
    if (ts.isConstructorDeclaration(member)) return;
    if (!(
      ts.isPropertyDeclaration(member) ||
      ts.isPropertySignature(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isMethodSignature(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    )) {
      return;
    }
    const name = declarationName(member.name);
    if (!name) {
      unsupported.push({
        node: member,
        path: repositoryPath,
        projectId: project.id,
        parentSymbolId: parent.id,
        summary: `Public ${parent.kind} ${parent.name} contains a computed member name that cannot be represented safely.`,
      });
      return;
    }
    const kind: TypeScriptSymbolKind =
      ts.isMethodDeclaration(member) || ts.isMethodSignature(member)
        ? "method"
        : "field";
    const record = createRecord(
      sourceFile,
      repositoryPath,
      member,
      name,
      kind,
      parent,
    );
    if (record && kind === "method") {
      const compilerSymbol = symbolAtDeclaration(checker, member);
      if (compilerSymbol) {
        contractSeeds.push({
          node: member,
          symbol: compilerSymbol,
          record,
          kind: "function_signature",
        });
      }
    }
  };

  for (const sourceFile of program.getSourceFiles()) {
    const repositoryPath = toRepositoryPath(
      repositoryRoot,
      path.resolve(sourceFile.fileName),
    );
    if (!repositoryPath || !sourcePaths.has(repositoryPath)) continue;

    for (const statement of sourceFile.statements) {
      let node: ts.Declaration | undefined;
      let name: string | undefined;
      let kind: TypeScriptSymbolKind | undefined;
      let contractKind: TypeScriptContractKind | undefined;

      if (ts.isFunctionDeclaration(statement)) {
        node = statement;
        name =
          statement.name?.text ??
          (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
            ? "default"
            : undefined);
        kind = "function";
        contractKind = "function_signature";
      } else if (ts.isInterfaceDeclaration(statement)) {
        node = statement;
        name = statement.name.text;
        kind = "interface";
        contractKind = "type_shape";
      } else if (ts.isTypeAliasDeclaration(statement)) {
        node = statement;
        name = statement.name.text;
        kind = "type_alias";
        contractKind = "type_shape";
      } else if (ts.isClassDeclaration(statement)) {
        node = statement;
        name =
          statement.name?.text ??
          (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
            ? "default"
            : undefined);
        kind = "class";
        contractKind = "type_shape";
      }

      if (node && name && kind && contractKind) {
        const record = createRecord(
          sourceFile,
          repositoryPath,
          node,
          name,
          kind,
        );
        const compilerSymbol = symbolAtDeclaration(checker, node);
        if (record && compilerSymbol) {
          contractSeeds.push({
            node,
            symbol: compilerSymbol,
            record,
            kind: contractKind,
          });
          if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
            for (const member of node.members) {
              addMember(sourceFile, repositoryPath, member, record);
            }
          }
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) {
            if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
              unsupported.push({
                node: declaration,
                path: repositoryPath,
                projectId: project.id,
                alwaysPublic: true,
                summary:
                  "An exported destructuring declaration cannot be represented safely in Phase 4C.",
              });
            }
            continue;
          }
          const compilerSymbol = checker.getSymbolAtLocation(declaration.name);
          if (!compilerSymbol) continue;
          const variableType = checker.getTypeOfSymbolAtLocation(
            compilerSymbol,
            declaration,
          );
          const callable = variableType.getCallSignatures().length > 0;
          const record = createRecord(
            sourceFile,
            repositoryPath,
            declaration,
            declaration.name.text,
            callable ? "function" : "variable",
          );
          if (record) {
            contractSeeds.push({
              node: declaration,
              symbol: compilerSymbol,
              record,
              kind: callable ? "function_signature" : "variable_type",
            });
          }
        }
      }
    }
  }

  for (const seed of new Map(
    contractSeeds.map((seed) => [`${seed.record.id}:${seed.kind}`, seed]),
  ).values()) {
    contracts.push(
      contractForSeed(repositoryRoot, repositoryId, revision, checker, seed),
    );
  }

  for (const sourceFile of program.getSourceFiles()) {
    const sourcePath = toRepositoryPath(
      repositoryRoot,
      path.resolve(sourceFile.fileName),
    );
    if (!sourcePath || !sourcePaths.has(sourcePath)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    const moduleExports = checker
      .getExportsOfModule(moduleSymbol)
      .sort((left, right) =>
        compareCodePoints(left.getName(), right.getName()),
      );
    for (const exportedSymbol of moduleExports) {
      const aliasedExport = (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0;
      const target = resolvedAlias(checker, exportedSymbol);
      const targetRecord =
        symbolRecords.get(target) ??
        target.declarations
          ?.map((declaration) => declarationRecords.get(declaration))
          .find((record) => record !== undefined);
      const targetDeclaration =
        target.valueDeclaration ?? target.declarations?.[0];
      const targetPath = targetDeclaration
        ? toRepositoryPath(
            repositoryRoot,
            path.resolve(targetDeclaration.getSourceFile().fileName),
          )
        : undefined;
      const exportName = exportedSymbol.getName().normalize("NFC");
      const kind =
        exportName === "default"
          ? "default"
          : aliasedExport || (targetPath && targetPath !== sourcePath)
            ? "re_export"
            : "local";
      if (targetRecord) {
        targetRecord.exported = true;
        if (kind === "default") targetRecord.defaultExport = true;
      }
      exportRecords.push({
        id: stableId("typescript-export", {
          repositoryId,
          revision,
          projectId: project.id,
          sourcePath,
          exportName,
          targetName: target.getName(),
          targetPath: targetPath ?? null,
          kind,
        }),
        repositoryId,
        revision,
        projectId: project.id,
        sourcePath,
        exportName,
        targetName: target.getName().normalize("NFC"),
        kind,
        typeOnly: (target.flags & ts.SymbolFlags.Value) === 0,
        ...(targetPath && targetPath !== "." ? { targetPath } : {}),
        ...(targetRecord ? { targetSymbolId: targetRecord.id } : {}),
        ...(project.packageId ? { packageId: project.packageId } : {}),
        ...(project.packageName ? { packageName: project.packageName } : {}),
      });
    }
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (!record.parentSymbolId) continue;
    const parent = recordsById.get(record.parentSymbolId);
    record.exported =
      parent?.exported === true && record.visibility === "public";
  }
  for (const contract of contracts) {
    contract.exported = recordsById.get(contract.symbolId)?.exported ?? false;
  }

  const gaps = unsupported
    .filter(
      (item) =>
        item.alwaysPublic === true ||
        (item.parentSymbolId !== undefined &&
          recordsById.get(item.parentSymbolId)?.exported === true),
    )
    .map((item) => {
      const location = declarationLocation(
        item.node.getSourceFile(),
        item.node,
      );
      return {
        id: stableId("typescript-gap", {
          repositoryId,
          revision,
          projectId: item.projectId,
          type: "unsupported_signature",
          path: item.path,
          ...location,
          parentSymbolId: item.parentSymbolId ?? null,
        }),
        repositoryId,
        revision,
        projectId: item.projectId,
        type: "unsupported_signature" as const,
        blockingRelevance: "required" as const,
        summary: item.summary,
        path: item.path,
        line: location.line,
        column: location.column,
        ...(item.parentSymbolId ? { symbolId: item.parentSymbolId } : {}),
      };
    });

  return {
    symbols: records.sort(compareLocated),
    contracts: contracts.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    exports: exportRecords.sort(compareLocated),
    gaps: gaps.sort(compareLocated),
    symbolBindings: symbolRecords,
  };
}

function flattenPackageExports(
  value: unknown,
  subpath: string,
  conditions: readonly string[],
  result: PackageExportLeaf[],
  unsupported: UnsupportedPackageExport[],
  workspacePackage: WorkspacePackage,
): void {
  if (typeof value === "string" || value === null) {
    result.push({ subpath, conditions: [...conditions], target: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      flattenPackageExports(
        entry,
        subpath,
        [...conditions, `fallback:${index}`],
        result,
        unsupported,
        workspacePackage,
      ),
    );
    return;
  }
  if (typeof value !== "object" || value === undefined) {
    unsupported.push({
      workspacePackage,
      subpath,
      conditions: [...conditions],
    });
    return;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareCodePoints(left, right),
  );
  const usesSubpaths = entries.some(([key]) => key.startsWith("."));
  if (usesSubpaths && entries.some(([key]) => !key.startsWith("."))) {
    unsupported.push({
      workspacePackage,
      subpath,
      conditions: [...conditions],
    });
  }
  for (const [key, entry] of entries) {
    flattenPackageExports(
      entry,
      usesSubpaths ? key.normalize("NFC") : subpath,
      usesSubpaths ? conditions : [...conditions, key.normalize("NFC")],
      result,
      unsupported,
      workspacePackage,
    );
  }
}

function packageLeaves(
  workspacePackage: WorkspacePackage,
  unsupported: UnsupportedPackageExport[],
): PackageExportLeaf[] {
  const result: PackageExportLeaf[] = [];
  if (workspacePackage.exports !== undefined) {
    flattenPackageExports(
      workspacePackage.exports,
      ".",
      [],
      result,
      unsupported,
      workspacePackage,
    );
  } else {
    if (workspacePackage.types) {
      result.push({
        subpath: ".",
        conditions: ["types"],
        target: workspacePackage.types,
      });
    }
    if (workspacePackage.main) {
      result.push({
        subpath: ".",
        conditions: ["main"],
        target: workspacePackage.main,
      });
    }
  }
  return result;
}

export function analyzePackageExports(
  repositoryId: string,
  revision: string,
  discovery: RepositoryProjectDiscovery,
): PackageExportAnalysis {
  const unsupported: UnsupportedPackageExport[] = [];
  const exports = discovery.workspace.packages
    .flatMap((workspacePackage) =>
      packageLeaves(workspacePackage, unsupported).map((leaf) => ({
        id: stableId("typescript-package-export", {
          repositoryId,
          revision,
          packageId: workspacePackage.id,
          subpath: leaf.subpath,
          conditions: leaf.conditions,
          target: leaf.target,
        }),
        repositoryId,
        revision,
        packageId: workspacePackage.id,
        manifestPath: workspacePackage.manifestPath,
        ...(workspacePackage.name
          ? { packageName: workspacePackage.name }
          : {}),
        subpath: leaf.subpath,
        conditions: leaf.conditions,
        target: leaf.target,
      })),
    )
    .sort((left, right) => {
      for (const comparison of [
        compareCodePoints(left.packageId, right.packageId),
        compareCodePoints(left.subpath, right.subpath),
        compareCodePoints(
          left.conditions.join("\0"),
          right.conditions.join("\0"),
        ),
        compareCodePoints(left.target ?? "", right.target ?? ""),
      ]) {
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  const gaps = unsupported
    .map((item) => ({
      id: stableId("typescript-gap", {
        repositoryId,
        revision,
        packageId: item.workspacePackage.id,
        type: "unsupported_signature",
        subpath: item.subpath,
        conditions: item.conditions,
      }),
      repositoryId,
      revision,
      type: "unsupported_signature" as const,
      blockingRelevance: "required" as const,
      summary: `Package export ${item.subpath} uses an unsupported target shape and cannot be modeled safely.`,
      path: item.workspacePackage.manifestPath,
    }))
    .sort(compareLocated);
  return { exports, gaps };
}
