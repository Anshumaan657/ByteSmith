import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import {
  createContractComparisons,
  executeContractRules,
  type ContractArtifact,
  type ContractComparison,
  type ContractRuleDefinition,
  type ContractRuleFindingInput,
  type ContractRuleUnknownInput,
  type EvidenceRevisionRequirement,
} from "@bytesmith/analyzer-sdk";
import {
  compareCodePoints,
  type ComponentRef,
  type SourceLocation,
} from "@bytesmith/impact-types";
import type { CanonicalIr, IrContract, IrSymbol } from "@bytesmith/ir";
import { TypeScriptDiscoveryError } from "./errors.js";
import { matchTypeScriptSymbols } from "./matching.js";
import type {
  EvaluateTypeScriptStructuralRulesInput,
  TypeScriptCompilerAnalysis,
  TypeScriptContract,
  TypeScriptExport,
  TypeScriptPackageExport,
  TypeScriptPackageExportValue,
  TypeScriptReExportValue,
  TypeScriptStructuralContractValue,
  TypeScriptStructuralMemberValue,
  TypeScriptStructuralRuleResult,
  TypeScriptStructuralRuleState,
  TypeScriptSymbol,
} from "./types.js";

type StructuralComparison =
  ContractComparison<TypeScriptStructuralContractValue>;
type ReExportComparison = ContractComparison<TypeScriptReExportValue>;
type PackageExportComparison = ContractComparison<TypeScriptPackageExportValue>;
type TypeRelation = "equal" | "wider" | "narrower" | "incomparable" | "unknown";

interface MutableEvaluation {
  findings: ContractRuleFindingInput[];
  unknowns: ContractRuleUnknownInput[];
  diagnostics: string[];
}

const structuralKinds = new Set(["interface", "type_alias", "class"]);

function fail(message: string, cause?: unknown): never {
  throw new TypeScriptDiscoveryError(
    "analysis_comparison_invalid",
    message,
    cause,
  );
}

function validateBindings(
  ir: CanonicalIr,
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): void {
  if (
    base.repositoryId !== ir.repositoryId ||
    head.repositoryId !== ir.repositoryId ||
    base.revision !== ir.baseRevision ||
    head.revision !== ir.headRevision
  ) {
    fail(
      "TypeScript structural rules require analyses and canonical IR for the same exact comparison.",
    );
  }
}

function sameLocation(
  symbol: TypeScriptSymbol,
  candidate: IrSymbol | IrContract,
): boolean {
  return (
    candidate.revision === symbol.revision &&
    candidate.location.path === symbol.path &&
    candidate.location.startLine === symbol.line &&
    candidate.location.startColumn === symbol.column
  );
}

function findIrSymbol(ir: CanonicalIr, symbol: TypeScriptSymbol): IrSymbol {
  const candidates = ir.symbols.filter(
    (candidate) =>
      sameLocation(symbol, candidate) &&
      candidate.kind === symbol.kind &&
      candidate.name === symbol.qualifiedName &&
      candidate.exported === symbol.exported,
  );
  if (candidates.length !== 1) {
    fail(
      `TypeScript symbol ${symbol.qualifiedName} does not have exactly one revision-bound IR symbol.`,
    );
  }
  return candidates[0]!;
}

function findIrContract(
  ir: CanonicalIr,
  symbol: TypeScriptSymbol,
  contract: TypeScriptContract,
  irSymbol: IrSymbol,
): IrContract {
  const candidates = ir.contracts.filter(
    (candidate) =>
      sameLocation(symbol, candidate) &&
      candidate.subjectId === irSymbol.id &&
      candidate.kind === "type_shape" &&
      candidate.name === contract.name &&
      candidate.fingerprint === contract.fingerprint,
  );
  if (candidates.length !== 1) {
    fail(
      `TypeScript structure ${symbol.qualifiedName} does not have exactly one revision-bound IR contract.`,
    );
  }
  return candidates[0]!;
}

function memberValues(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
  parent: TypeScriptSymbol,
  contract: TypeScriptContract,
): TypeScriptStructuralMemberValue[] {
  const candidates = analysis.symbols.filter(
    (symbol) =>
      symbol.parentSymbolId === parent.id &&
      symbol.kind === "field" &&
      symbol.visibility === "public" &&
      symbol.exported,
  );
  return contract.members
    .filter(
      (member) => member.kind === "field" && member.visibility === "public",
    )
    .map((member) => {
      const matching = candidates.filter(
        (symbol) =>
          symbol.name === member.name && symbol.static === member.static,
      );
      if (matching.length !== 1) {
        fail(
          `Public field ${parent.qualifiedName}.${member.name} does not have exactly one structural symbol.`,
        );
      }
      const irSymbol = findIrSymbol(ir, matching[0]!);
      return {
        name: member.name,
        type: member.type,
        optional: member.optional,
        readonly: member.readonly,
        static: member.static,
        irSymbolId: irSymbol.id,
        location: structuredClone(irSymbol.location),
        evidenceIds: [...irSymbol.evidenceIds],
      };
    })
    .sort(
      (left, right) =>
        Number(left.static) - Number(right.static) ||
        compareCodePoints(left.name, right.name) ||
        compareCodePoints(left.irSymbolId, right.irSymbolId),
    );
}

function unmatchedStructureKey(
  repositoryId: string,
  symbol: TypeScriptSymbol,
): string {
  return stableId("typescript-structure-logical", {
    repositoryId,
    kind: symbol.kind,
    qualifiedName: symbol.qualifiedName,
  });
}

function structureArtifacts(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
  logicalKeys: ReadonlyMap<string, string>,
): ContractArtifact<TypeScriptStructuralContractValue>[] {
  const symbols = new Map(
    analysis.symbols.map((symbol) => [symbol.id, symbol]),
  );
  return analysis.contracts
    .filter((contract) => contract.kind === "type_shape" && contract.exported)
    .map((contract) => {
      const symbol = symbols.get(contract.symbolId);
      if (
        !symbol ||
        !symbol.exported ||
        !structuralKinds.has(symbol.kind) ||
        (symbol.kind !== "interface" &&
          symbol.kind !== "type_alias" &&
          symbol.kind !== "class")
      ) {
        fail(
          `Exported structural contract ${contract.id} has no public structural symbol.`,
        );
      }
      const irSymbol = findIrSymbol(ir, symbol);
      const irContract = findIrContract(ir, symbol, contract, irSymbol);
      return {
        id: stableId("typescript-structure-artifact", {
          repositoryId: analysis.repositoryId,
          revision: analysis.revision,
          symbolId: symbol.id,
          contractId: contract.id,
        }),
        revision: analysis.revision,
        logicalKey:
          logicalKeys.get(symbol.id) ??
          unmatchedStructureKey(analysis.repositoryId, symbol),
        value: {
          symbolId: symbol.id,
          contractId: contract.id,
          irSymbolId: irSymbol.id,
          projectId: symbol.projectId,
          path: symbol.path,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          kind: symbol.kind,
          location: structuredClone(irSymbol.location),
          evidenceIds: [...irContract.evidenceIds],
          members: memberValues(ir, analysis, symbol, contract),
          typeParameters: structuredClone(contract.typeParameters),
          heritage: [...contract.heritage],
          ...(contract.aliasedType === undefined
            ? {}
            : { aliasedType: contract.aliasedType }),
        },
        evidenceIds: [...irContract.evidenceIds],
      };
    });
}

function exportEvidenceSummary(value: TypeScriptExport): string {
  return value.targetSymbolId
    ? `Export ${value.exportName} resolves to ${value.targetName}.`
    : `Export ${value.exportName} has an unresolved target ${value.targetName}.`;
}

function findExportEvidenceId(
  ir: CanonicalIr,
  value: TypeScriptExport,
): string {
  const candidates = ir.evidence.filter(
    (evidence) =>
      evidence.kind === "import" &&
      evidence.location.revision === value.revision &&
      evidence.location.path === value.sourcePath &&
      evidence.summary === exportEvidenceSummary(value),
  );
  if (candidates.length !== 1) {
    fail(
      `Re-export ${value.sourcePath}#${value.exportName} does not have exactly one revision-bound evidence record.`,
    );
  }
  return candidates[0]!.id;
}

function targetIrSymbolId(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
  value: TypeScriptExport,
): string | undefined {
  if (!value.targetSymbolId) return undefined;
  const symbol = analysis.symbols.find(
    (candidate) => candidate.id === value.targetSymbolId,
  );
  return symbol ? findIrSymbol(ir, symbol).id : undefined;
}

function reExportKey(value: TypeScriptExport): string {
  return stableId("typescript-re-export-logical", {
    projectId: value.projectId,
    sourcePath: value.sourcePath,
    exportName: value.exportName,
  });
}

function reExportArtifacts(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
): ContractArtifact<TypeScriptReExportValue>[] {
  return analysis.exports
    .filter((value) => value.kind === "re_export")
    .map((value) => {
      const evidenceId = findExportEvidenceId(ir, value);
      const evidence = ir.evidence.find(
        (candidate) => candidate.id === evidenceId,
      )!;
      const target = targetIrSymbolId(ir, analysis, value);
      return {
        id: stableId("typescript-re-export-artifact", {
          repositoryId: analysis.repositoryId,
          revision: analysis.revision,
          exportId: value.id,
        }),
        revision: analysis.revision,
        logicalKey: reExportKey(value),
        value: {
          id: value.id,
          projectId: value.projectId,
          sourcePath: value.sourcePath,
          exportName: value.exportName,
          targetName: value.targetName,
          typeOnly: value.typeOnly,
          ...(value.packageId ? { packageId: value.packageId } : {}),
          ...(value.packageName ? { packageName: value.packageName } : {}),
          ...(value.targetPath ? { targetPath: value.targetPath } : {}),
          ...(value.targetSymbolId
            ? { targetSymbolId: value.targetSymbolId }
            : {}),
          ...(target ? { targetIrSymbolId: target } : {}),
          location: structuredClone(evidence.location),
        },
        evidenceIds: [evidenceId],
      };
    });
}

function packageExportName(value: TypeScriptPackageExport): string {
  const conditions =
    value.conditions.length === 0 ? "default" : value.conditions.join(",");
  return `${value.packageName ?? value.packageId}#${value.subpath}[${conditions}]`;
}

function findPackageExportContract(
  ir: CanonicalIr,
  value: TypeScriptPackageExport,
): IrContract {
  const fingerprint = stableId("typescript-package-export-signature", {
    subpath: value.subpath,
    conditions: value.conditions,
    target: value.target,
  });
  const candidates = ir.contracts.filter(
    (contract) =>
      contract.revision === value.revision &&
      contract.location.path === value.manifestPath &&
      contract.kind === "package_export" &&
      contract.name === packageExportName(value) &&
      contract.fingerprint === fingerprint,
  );
  if (candidates.length !== 1) {
    fail(
      `Package export ${packageExportName(value)} does not have exactly one revision-bound IR contract.`,
    );
  }
  return candidates[0]!;
}

function packageExportKey(value: TypeScriptPackageExport): string {
  return stableId("typescript-package-export-logical", {
    packageId: value.packageId,
    subpath: value.subpath,
    conditions: value.conditions,
  });
}

function packageExportArtifacts(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
): ContractArtifact<TypeScriptPackageExportValue>[] {
  return analysis.packageExports.map((value) => {
    const contract = findPackageExportContract(ir, value);
    return {
      id: stableId("typescript-package-export-artifact", {
        repositoryId: analysis.repositoryId,
        revision: analysis.revision,
        exportId: value.id,
      }),
      revision: analysis.revision,
      logicalKey: packageExportKey(value),
      value: {
        id: value.id,
        packageId: value.packageId,
        ...(value.packageName ? { packageName: value.packageName } : {}),
        manifestPath: value.manifestPath,
        subpath: value.subpath,
        conditions: [...value.conditions],
        target: value.target,
        irContractId: contract.id,
        location: structuredClone(contract.location),
      },
      evidenceIds: [...contract.evidenceIds],
    };
  });
}

export function createTypeScriptStructuralRuleState(
  input: EvaluateTypeScriptStructuralRulesInput,
): TypeScriptStructuralRuleState {
  validateBindings(input.ir, input.baseAnalysis, input.headAnalysis);
  const recomputed = matchTypeScriptSymbols(
    input.baseAnalysis,
    input.headAnalysis,
  );
  if (
    input.symbolAnalysis &&
    canonicalJson(input.symbolAnalysis) !== canonicalJson(recomputed)
  ) {
    fail("Supplied TypeScript symbol matches do not match the bound analyses.");
  }
  const logicalKeys = new Map<string, string>();
  for (const match of recomputed.matches) {
    logicalKeys.set(match.baseSymbolId, match.logicalId);
    logicalKeys.set(match.headSymbolId, match.logicalId);
  }
  return {
    structures: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...structureArtifacts(input.ir, input.baseAnalysis, logicalKeys),
        ...structureArtifacts(input.ir, input.headAnalysis, logicalKeys),
      ],
    }),
    reExports: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...reExportArtifacts(input.ir, input.baseAnalysis),
        ...reExportArtifacts(input.ir, input.headAnalysis),
      ],
    }),
    packageExports: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...packageExportArtifacts(input.ir, input.baseAnalysis),
        ...packageExportArtifacts(input.ir, input.headAnalysis),
      ],
    }),
  };
}

function evaluation(): MutableEvaluation {
  return { findings: [], unknowns: [], diagnostics: [] };
}

function evidenceRequirements<Value>(
  comparison: ContractComparison<Value>,
): EvidenceRevisionRequirement[] {
  return [
    ...(comparison.base.length > 0 ? (["base"] as const) : []),
    ...(comparison.head.length > 0 ? (["head"] as const) : []),
  ];
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

function uniqueLocations(values: readonly SourceLocation[]): SourceLocation[] {
  return [
    ...new Map(
      values.map((location) => [canonicalJson(location), location]),
    ).values(),
  ].sort(
    (left, right) =>
      compareCodePoints(left.revision, right.revision) ||
      compareCodePoints(left.path, right.path) ||
      (left.startLine ?? 0) - (right.startLine ?? 0) ||
      (left.startColumn ?? 0) - (right.startColumn ?? 0),
  );
}

function structuralComponent(
  comparison: StructuralComparison,
  preferred: "base" | "head" = "head",
): ComponentRef {
  const artifact =
    preferred === "head"
      ? (comparison.head[0] ?? comparison.base[0])
      : (comparison.base[0] ?? comparison.head[0]);
  if (!artifact) fail("Structural comparison has no component artifact.");
  return {
    id: artifact.value.irSymbolId,
    kind: "symbol",
    name: artifact.value.qualifiedName,
    location: structuredClone(artifact.value.location),
  };
}

function structuralFinding(
  comparison: StructuralComparison,
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
  preferred: "base" | "head" = "head",
): ContractRuleFindingInput {
  return {
    kind: "contract",
    summary,
    compatibility,
    component: structuralComponent(comparison, preferred),
    evidenceIds: [...comparison.evidenceIds],
    evidenceRequirements: evidenceRequirements(comparison),
  };
}

function memberComponent(
  parentName: string,
  before: TypeScriptStructuralMemberValue | undefined,
  after: TypeScriptStructuralMemberValue | undefined,
): ComponentRef {
  const value = after ?? before;
  if (!value) fail("Structural field comparison has no component.");
  return {
    id: value.irSymbolId,
    kind: "symbol",
    name: `${parentName}.${value.name}`,
    location: structuredClone(value.location),
  };
}

function memberFinding(
  comparison: StructuralComparison,
  parentName: string,
  before: TypeScriptStructuralMemberValue | undefined,
  after: TypeScriptStructuralMemberValue | undefined,
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
): ContractRuleFindingInput {
  return {
    kind: "contract",
    summary,
    compatibility,
    component: memberComponent(parentName, before, after),
    evidenceIds: uniqueIds([
      ...comparison.evidenceIds,
      ...(before?.evidenceIds ?? []),
      ...(after?.evidenceIds ?? []),
    ]),
    evidenceRequirements: ["base", "head"],
  };
}

function comparisonUnknown<Value>(
  comparison: ContractComparison<Value>,
  summary: string,
  locations: readonly SourceLocation[],
  evidenceIds: readonly string[] = comparison.evidenceIds,
): ContractRuleUnknownInput {
  return {
    type: "other",
    summary,
    locations: uniqueLocations(locations),
    evidenceIds: uniqueIds(evidenceIds),
    blockingRelevance: "required",
  };
}

function splitTopLevelUnion(value: string): string[] | undefined {
  const normalized = value.trim();
  const parts: string[] = [];
  let start = 0;
  let angle = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote: string | undefined;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (quote) {
      if (character === quote && normalized[index - 1] !== "\\")
        quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "<") angle += 1;
    else if (character === ">") angle -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "{") curly += 1;
    else if (character === "}") curly -= 1;
    else if (
      character === "|" &&
      angle === 0 &&
      round === 0 &&
      square === 0 &&
      curly === 0
    ) {
      parts.push(normalized.slice(start, index).trim());
      start = index + 1;
    }
    if (angle < 0 || round < 0 || square < 0 || curly < 0) return undefined;
  }
  if (quote || angle !== 0 || round !== 0 || square !== 0 || curly !== 0) {
    return undefined;
  }
  parts.push(normalized.slice(start).trim());
  if (parts.some((part) => part.length === 0)) return undefined;
  return [...new Set(parts)].sort(compareCodePoints);
}

function primitiveCategory(value: string): string | undefined {
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/u.test(value)) {
    return "string";
  }
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)) return "number";
  if (/^-?\d+n$/u.test(value)) return "bigint";
  if (value === "true" || value === "false") return "boolean";
  if (
    [
      "string",
      "number",
      "bigint",
      "boolean",
      "symbol",
      "null",
      "undefined",
      "void",
      "object",
      "never",
      "unknown",
      "any",
    ].includes(value)
  ) {
    return value;
  }
  return undefined;
}

function atomSubtype(left: string, right: string): boolean | undefined {
  if (left === right || left === "never" || right === "unknown") return true;
  if (left === "any" || right === "any") return undefined;
  if (left === "unknown" || right === "never") return false;
  const leftCategory = primitiveCategory(left);
  const rightCategory = primitiveCategory(right);
  if (!leftCategory || !rightCategory) return undefined;
  return leftCategory === right ? true : false;
}

function isSubtype(
  left: readonly string[],
  right: readonly string[],
): boolean | undefined {
  let uncertain = false;
  for (const leftPart of left) {
    let matched = false;
    let partUncertain = false;
    for (const rightPart of right) {
      const relation = atomSubtype(leftPart, rightPart);
      if (relation === true) {
        matched = true;
        break;
      }
      if (relation === undefined) partUncertain = true;
    }
    if (!matched) {
      if (partUncertain) uncertain = true;
      else return false;
    }
  }
  return uncertain ? undefined : true;
}

function typeRelation(baseType: string, headType: string): TypeRelation {
  const base = splitTopLevelUnion(baseType);
  const head = splitTopLevelUnion(headType);
  if (!base || !head) return "unknown";
  if (canonicalJson(base) === canonicalJson(head)) return "equal";
  const headWithinBase = isSubtype(head, base);
  const baseWithinHead = isSubtype(base, head);
  if (headWithinBase === true && baseWithinHead === true) return "equal";
  if (baseWithinHead === true) return "wider";
  if (headWithinBase === true) return "narrower";
  if (headWithinBase === false && baseWithinHead === false)
    return "incomparable";
  return "unknown";
}

function matchedStructures(
  state: TypeScriptStructuralRuleState,
): StructuralComparison[] {
  return state.structures.filter(
    (comparison) =>
      comparison.status === "matched" &&
      comparison.base.length === 1 &&
      comparison.head.length === 1,
  );
}

function declarationRule(): ContractRuleDefinition<TypeScriptStructuralRuleState> {
  return {
    id: "typescript.structure.declarations",
    version: "1.0.0",
    family: "typescript",
    description:
      "Detect exported structural declaration and inheritance changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of state.structures) {
        if (comparison.status === "removed") {
          const before = comparison.base[0]!.value;
          result.findings.push(
            structuralFinding(
              comparison,
              `Exported ${before.kind} ${before.qualifiedName} was removed.`,
              "breaking",
              "base",
            ),
          );
        } else if (comparison.status === "added") {
          const after = comparison.head[0]!.value;
          result.findings.push(
            structuralFinding(
              comparison,
              `Exported ${after.kind} ${after.qualifiedName} was added.`,
              "compatible",
            ),
          );
        } else if (comparison.status === "ambiguous") {
          result.unknowns.push(
            comparisonUnknown(
              comparison,
              `Structural identity for ${comparison.logicalKey} is ambiguous across revisions.`,
              [...comparison.base, ...comparison.head].map(
                (artifact) => artifact.value.location,
              ),
            ),
          );
        }
      }
      for (const comparison of matchedStructures(state)) {
        const before = comparison.base[0]!.value;
        const after = comparison.head[0]!.value;
        if (canonicalJson(before.heritage) !== canonicalJson(after.heritage)) {
          result.findings.push(
            structuralFinding(
              comparison,
              `Exported ${after.kind} ${after.qualifiedName} changed its heritage contract.`,
              "potentially_breaking",
            ),
          );
        }
        if (
          canonicalJson(before.typeParameters) !==
          canonicalJson(after.typeParameters)
        ) {
          result.findings.push(
            structuralFinding(
              comparison,
              `Exported ${after.kind} ${after.qualifiedName} changed its type parameters.`,
              "potentially_breaking",
            ),
          );
        }
      }
      return result;
    },
  };
}

function fieldKey(value: TypeScriptStructuralMemberValue): string {
  return `${value.static ? "static" : "instance"}\0${value.name}`;
}

function fieldGroups(
  values: readonly TypeScriptStructuralMemberValue[],
): Map<string, TypeScriptStructuralMemberValue[]> {
  const groups = new Map<string, TypeScriptStructuralMemberValue[]>();
  for (const value of values) {
    const key = fieldKey(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function fieldsRule(): ContractRuleDefinition<TypeScriptStructuralRuleState> {
  return {
    id: "typescript.structure.fields",
    version: "1.0.0",
    family: "typescript",
    description:
      "Detect public TypeScript field surface compatibility changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedStructures(state)) {
        const beforeParent = comparison.base[0]!.value;
        const afterParent = comparison.head[0]!.value;
        const beforeGroups = fieldGroups(beforeParent.members);
        const afterGroups = fieldGroups(afterParent.members);
        const keys = [
          ...new Set([...beforeGroups.keys(), ...afterGroups.keys()]),
        ].sort(compareCodePoints);
        for (const key of keys) {
          const beforeValues = beforeGroups.get(key) ?? [];
          const afterValues = afterGroups.get(key) ?? [];
          if (beforeValues.length > 1 || afterValues.length > 1) {
            const members = [...beforeValues, ...afterValues];
            result.unknowns.push(
              comparisonUnknown(
                comparison,
                `Field identity ${afterParent.qualifiedName}.${members[0]!.name} is ambiguous across revisions.`,
                members.map((member) => member.location),
                uniqueIds([
                  ...comparison.evidenceIds,
                  ...members.flatMap((member) => member.evidenceIds),
                ]),
              ),
            );
            continue;
          }
          const before = beforeValues[0];
          const after = afterValues[0];
          const name = `${afterParent.qualifiedName}.${after?.name ?? before?.name}`;
          if (before && !after) {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                undefined,
                `Public field ${name} was removed.`,
                before.optional ? "potentially_breaking" : "breaking",
              ),
            );
            continue;
          }
          if (!before && after) {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                undefined,
                after,
                `Public ${after.optional ? "optional" : "required"} field ${name} was added.`,
                after.optional ? "compatible" : "breaking",
              ),
            );
            continue;
          }
          if (!before || !after) continue;
          if (before.optional !== after.optional) {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                after,
                `Public field ${name} changed from ${before.optional ? "optional" : "required"} to ${after.optional ? "optional" : "required"}.`,
                "breaking",
              ),
            );
          }
          if (before.readonly !== after.readonly) {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                after,
                `Public field ${name} changed from ${before.readonly ? "readonly" : "mutable"} to ${after.readonly ? "readonly" : "mutable"}.`,
                after.readonly ? "breaking" : "compatible",
              ),
            );
          }
          if (before.type === after.type) continue;
          const relation = typeRelation(before.type, after.type);
          if (relation === "equal") continue;
          const summary = `Public field ${name} changed type from ${before.type} to ${after.type}.`;
          if (relation === "unknown") {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                after,
                summary,
                "unknown",
              ),
            );
            result.unknowns.push(
              comparisonUnknown(
                comparison,
                summary,
                [before.location, after.location],
                uniqueIds([
                  ...comparison.evidenceIds,
                  ...before.evidenceIds,
                  ...after.evidenceIds,
                ]),
              ),
            );
          } else if (before.readonly && after.readonly) {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                after,
                summary,
                relation === "narrower" ? "compatible" : "breaking",
              ),
            );
          } else {
            result.findings.push(
              memberFinding(
                comparison,
                afterParent.qualifiedName,
                before,
                after,
                summary,
                relation === "incomparable"
                  ? "breaking"
                  : "potentially_breaking",
              ),
            );
          }
        }
      }
      return result;
    },
  };
}

function aliasRule(): ContractRuleDefinition<TypeScriptStructuralRuleState> {
  return {
    id: "typescript.structure.type-aliases",
    version: "1.0.0",
    family: "typescript",
    description: "Detect exported TypeScript type-alias compatibility changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedStructures(state)) {
        const before = comparison.base[0]!.value;
        const after = comparison.head[0]!.value;
        if (
          before.kind !== "type_alias" ||
          after.kind !== "type_alias" ||
          before.aliasedType === after.aliasedType
        ) {
          continue;
        }
        if (
          before.aliasedType === undefined ||
          after.aliasedType === undefined
        ) {
          const summary = `Exported type alias ${after.qualifiedName} cannot be compared structurally.`;
          result.findings.push(
            structuralFinding(comparison, summary, "unknown"),
          );
          result.unknowns.push(
            comparisonUnknown(comparison, summary, [
              before.location,
              after.location,
            ]),
          );
          continue;
        }
        const relation = typeRelation(before.aliasedType, after.aliasedType);
        if (relation === "equal") continue;
        const summary = `Exported type alias ${after.qualifiedName} changed from ${before.aliasedType} to ${after.aliasedType}.`;
        if (relation === "unknown") {
          result.findings.push(
            structuralFinding(comparison, summary, "unknown"),
          );
          result.unknowns.push(
            comparisonUnknown(comparison, summary, [
              before.location,
              after.location,
            ]),
          );
        } else {
          result.findings.push(
            structuralFinding(
              comparison,
              summary,
              relation === "incomparable" ? "breaking" : "potentially_breaking",
            ),
          );
        }
      }
      return result;
    },
  };
}

function reExportComponent(
  comparison: ReExportComparison,
  preferred: "base" | "head" = "head",
): ComponentRef {
  const artifact =
    preferred === "head"
      ? (comparison.head[0] ?? comparison.base[0])
      : (comparison.base[0] ?? comparison.head[0]);
  if (!artifact) fail("Re-export comparison has no component artifact.");
  const value = artifact.value;
  const owner = value.packageName ?? value.packageId ?? value.sourcePath;
  return {
    id: stableId("typescript-re-export-component", {
      projectId: value.projectId,
      sourcePath: value.sourcePath,
      exportName: value.exportName,
    }),
    kind: "package",
    name: `${owner}#${value.exportName}`,
    location: structuredClone(value.location),
  };
}

function reExportFinding(
  comparison: ReExportComparison,
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
  preferred: "base" | "head" = "head",
): ContractRuleFindingInput {
  return {
    kind: "dependency",
    summary,
    compatibility,
    component: reExportComponent(comparison, preferred),
    evidenceIds: [...comparison.evidenceIds],
    evidenceRequirements: evidenceRequirements(comparison),
  };
}

function reExportRule(): ContractRuleDefinition<TypeScriptStructuralRuleState> {
  return {
    id: "typescript.package.re-exports",
    version: "1.0.0",
    family: "typescript",
    description: "Detect TypeScript package entry-point re-export changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of state.reExports) {
        if (comparison.status === "removed") {
          const before = comparison.base[0]!.value;
          result.findings.push(
            reExportFinding(
              comparison,
              `Package entry point ${before.sourcePath} removed export ${before.exportName}.`,
              "breaking",
              "base",
            ),
          );
        } else if (comparison.status === "added") {
          const after = comparison.head[0]!.value;
          result.findings.push(
            reExportFinding(
              comparison,
              `Package entry point ${after.sourcePath} added export ${after.exportName}.`,
              "compatible",
            ),
          );
        } else if (comparison.status === "ambiguous") {
          result.unknowns.push(
            comparisonUnknown(
              comparison,
              `Re-export identity ${comparison.logicalKey} is ambiguous across revisions.`,
              [...comparison.base, ...comparison.head].map(
                (artifact) => artifact.value.location,
              ),
            ),
          );
        } else {
          const before = comparison.base[0]!.value;
          const after = comparison.head[0]!.value;
          if (
            before.targetName !== after.targetName ||
            before.targetPath !== after.targetPath ||
            before.typeOnly !== after.typeOnly
          ) {
            result.findings.push(
              reExportFinding(
                comparison,
                `Package export ${after.exportName} changed its target or type-only contract.`,
                "potentially_breaking",
              ),
            );
          }
        }
      }
      return result;
    },
  };
}

function packageComponent(
  comparison: PackageExportComparison,
  preferred: "base" | "head" = "head",
): ComponentRef {
  const artifact =
    preferred === "head"
      ? (comparison.head[0] ?? comparison.base[0])
      : (comparison.base[0] ?? comparison.head[0]);
  if (!artifact) fail("Package-export comparison has no component artifact.");
  const value = artifact.value;
  const conditions =
    value.conditions.length === 0 ? "default" : value.conditions.join(",");
  return {
    id: stableId("typescript-package-export-component", {
      packageId: value.packageId,
      subpath: value.subpath,
      conditions: value.conditions,
    }),
    kind: "package",
    name: `${value.packageName ?? value.packageId}#${value.subpath}[${conditions}]`,
    location: structuredClone(value.location),
  };
}

function packageFinding(
  comparison: PackageExportComparison,
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
  preferred: "base" | "head" = "head",
): ContractRuleFindingInput {
  return {
    kind: "dependency",
    summary,
    compatibility,
    component: packageComponent(comparison, preferred),
    evidenceIds: [...comparison.evidenceIds],
    evidenceRequirements: evidenceRequirements(comparison),
  };
}

function packageExportRule(): ContractRuleDefinition<TypeScriptStructuralRuleState> {
  return {
    id: "typescript.package.exports",
    version: "1.0.0",
    family: "typescript",
    description: "Detect package.json export-map compatibility changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of state.packageExports) {
        if (comparison.status === "removed") {
          const before = comparison.base[0]!.value;
          result.findings.push(
            packageFinding(
              comparison,
              `Package export ${before.subpath} with conditions ${before.conditions.join(",") || "default"} was removed.`,
              "breaking",
              "base",
            ),
          );
        } else if (comparison.status === "added") {
          const after = comparison.head[0]!.value;
          result.findings.push(
            packageFinding(
              comparison,
              `Package export ${after.subpath} with conditions ${after.conditions.join(",") || "default"} was added.`,
              "compatible",
            ),
          );
        } else if (comparison.status === "ambiguous") {
          result.unknowns.push(
            comparisonUnknown(
              comparison,
              `Package-export identity ${comparison.logicalKey} is ambiguous across revisions.`,
              [...comparison.base, ...comparison.head].map(
                (artifact) => artifact.value.location,
              ),
            ),
          );
        } else {
          const before = comparison.base[0]!.value;
          const after = comparison.head[0]!.value;
          if (before.target !== after.target) {
            result.findings.push(
              packageFinding(
                comparison,
                `Package export ${after.subpath} changed target from ${before.target ?? "blocked"} to ${after.target ?? "blocked"}.`,
                after.target === null ? "breaking" : "potentially_breaking",
              ),
            );
          }
        }
      }
      return result;
    },
  };
}

export function createTypeScriptStructuralRuleDefinitions(): ContractRuleDefinition<TypeScriptStructuralRuleState>[] {
  return [
    declarationRule(),
    fieldsRule(),
    aliasRule(),
    reExportRule(),
    packageExportRule(),
  ];
}

export async function evaluateTypeScriptStructuralRules(
  input: EvaluateTypeScriptStructuralRulesInput,
): Promise<TypeScriptStructuralRuleResult> {
  return executeContractRules(createTypeScriptStructuralRuleDefinitions(), {
    ir: input.ir,
    state: createTypeScriptStructuralRuleState(input),
  });
}
