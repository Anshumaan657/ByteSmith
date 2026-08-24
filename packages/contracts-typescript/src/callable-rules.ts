import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import {
  createContractComparisons,
  executeContractRules,
  type ContractArtifact,
  type ContractComparison,
  type ContractRuleDefinition,
  type ContractRuleFindingInput,
  type ContractRuleUnknownInput,
} from "@bytesmith/analyzer-sdk";
import {
  compareCodePoints,
  type SourceLocation,
} from "@bytesmith/impact-types";
import type { CanonicalIr, IrContract, IrSymbol } from "@bytesmith/ir";
import { TypeScriptDiscoveryError } from "./errors.js";
import { matchTypeScriptSymbols } from "./matching.js";
import type {
  CallableSignature,
  EvaluateTypeScriptCallableRulesInput,
  ParameterSignature,
  TypeParameterSignature,
  TypeScriptCallableContractValue,
  TypeScriptCallableRuleResult,
  TypeScriptCallableRuleState,
  TypeScriptCompilerAnalysis,
  TypeScriptContract,
  TypeScriptSymbol,
} from "./types.js";

type CallableComparison = ContractComparison<TypeScriptCallableContractValue>;
type TypeRelation = "equal" | "wider" | "narrower" | "incomparable" | "unknown";

interface SignaturePair {
  base: CallableSignature;
  head: CallableSignature;
  baseIndex: number;
  headIndex: number;
}

interface SignaturePairing {
  pairs: SignaturePair[];
  removed: Array<{ signature: CallableSignature; index: number }>;
  added: Array<{ signature: CallableSignature; index: number }>;
  ambiguous: boolean;
}

interface MutableEvaluation {
  findings: ContractRuleFindingInput[];
  unknowns: ContractRuleUnknownInput[];
  diagnostics: string[];
}

const callableKinds = new Set(["function", "method"]);

function fail(message: string, cause?: unknown): never {
  throw new TypeScriptDiscoveryError(
    "analysis_comparison_invalid",
    message,
    cause,
  );
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
      candidate.exported,
  );
  if (candidates.length !== 1) {
    fail(
      `TypeScript callable ${symbol.qualifiedName} does not have exactly one revision-bound IR symbol.`,
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
      candidate.kind === "function_signature" &&
      candidate.name === contract.name &&
      candidate.fingerprint === contract.fingerprint,
  );
  if (candidates.length !== 1) {
    fail(
      `TypeScript callable ${symbol.qualifiedName} does not have exactly one revision-bound IR contract.`,
    );
  }
  return candidates[0]!;
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
      "TypeScript callable rules require analyses and canonical IR for the same exact comparison.",
    );
  }
}

function logicalKeyForUnmatched(
  repositoryId: string,
  symbol: TypeScriptSymbol,
): string {
  return stableId("typescript-callable-logical", {
    repositoryId,
    kind: symbol.kind,
    qualifiedName: symbol.qualifiedName,
  });
}

function artifactsForAnalysis(
  ir: CanonicalIr,
  analysis: TypeScriptCompilerAnalysis,
  logicalKeys: ReadonlyMap<string, string>,
): ContractArtifact<TypeScriptCallableContractValue>[] {
  const symbols = new Map(
    analysis.symbols.map((symbol) => [symbol.id, symbol]),
  );
  return analysis.contracts
    .filter(
      (contract) => contract.kind === "function_signature" && contract.exported,
    )
    .map((contract) => {
      const symbol = symbols.get(contract.symbolId);
      if (
        !symbol ||
        !symbol.exported ||
        !callableKinds.has(symbol.kind) ||
        (symbol.kind !== "function" && symbol.kind !== "method")
      ) {
        fail(
          `Exported callable contract ${contract.id} has no public callable symbol.`,
        );
      }
      const irSymbol = findIrSymbol(ir, symbol);
      const irContract = findIrContract(ir, symbol, contract, irSymbol);
      const logicalKey =
        logicalKeys.get(symbol.id) ??
        logicalKeyForUnmatched(analysis.repositoryId, symbol);
      return {
        id: stableId("typescript-callable-artifact", {
          repositoryId: analysis.repositoryId,
          revision: analysis.revision,
          symbolId: symbol.id,
          contractId: contract.id,
        }),
        revision: analysis.revision,
        logicalKey,
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
          signatures: structuredClone(contract.signatures),
        },
        evidenceIds: [...irContract.evidenceIds],
      };
    });
}

export function createTypeScriptCallableRuleState(
  input: EvaluateTypeScriptCallableRulesInput,
): TypeScriptCallableRuleState {
  validateBindings(input.ir, input.baseAnalysis, input.headAnalysis);
  const recomputedSymbolAnalysis = matchTypeScriptSymbols(
    input.baseAnalysis,
    input.headAnalysis,
  );
  if (
    input.symbolAnalysis &&
    canonicalJson(input.symbolAnalysis) !==
      canonicalJson(recomputedSymbolAnalysis)
  ) {
    fail("Supplied TypeScript symbol matches do not match the bound analyses.");
  }
  const symbolAnalysis = recomputedSymbolAnalysis;
  if (
    symbolAnalysis.repositoryId !== input.ir.repositoryId ||
    symbolAnalysis.baseRevision !== input.ir.baseRevision ||
    symbolAnalysis.headRevision !== input.ir.headRevision
  ) {
    fail("TypeScript symbol matches belong to a different exact comparison.");
  }
  const logicalKeys = new Map<string, string>();
  for (const match of symbolAnalysis.matches) {
    logicalKeys.set(match.baseSymbolId, match.logicalId);
    logicalKeys.set(match.headSymbolId, match.logicalId);
  }
  const artifacts = [
    ...artifactsForAnalysis(input.ir, input.baseAnalysis, logicalKeys),
    ...artifactsForAnalysis(input.ir, input.headAnalysis, logicalKeys),
  ];
  return {
    comparisons: createContractComparisons({ ir: input.ir, artifacts }),
  };
}

function values(comparison: CallableComparison): {
  base?: TypeScriptCallableContractValue;
  head?: TypeScriptCallableContractValue;
} {
  return {
    ...(comparison.base[0] ? { base: comparison.base[0].value } : {}),
    ...(comparison.head[0] ? { head: comparison.head[0].value } : {}),
  };
}

function component(
  comparison: CallableComparison,
  preferred: "base" | "head" = "head",
): ContractRuleFindingInput["component"] {
  const candidates =
    preferred === "head"
      ? [comparison.head[0], comparison.base[0]]
      : [comparison.base[0], comparison.head[0]];
  const artifact = candidates.find((candidate) => candidate !== undefined);
  if (!artifact) fail("Callable comparison has no component artifact.");
  return {
    id: artifact.value.irSymbolId,
    kind: "symbol",
    name: artifact.value.qualifiedName,
    location: structuredClone(artifact.value.location),
  };
}

function finding(
  comparison: CallableComparison,
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
  preferred: "base" | "head" = "head",
): ContractRuleFindingInput {
  const evidenceRequirements = [
    ...(comparison.base.length > 0 ? (["base"] as const) : []),
    ...(comparison.head.length > 0 ? (["head"] as const) : []),
  ];
  return {
    kind: "contract",
    summary,
    compatibility,
    component: component(comparison, preferred),
    evidenceIds: [...comparison.evidenceIds],
    evidenceRequirements,
  };
}

function locationKey(location: SourceLocation): string {
  return canonicalJson(location);
}

function comparisonLocations(comparison: CallableComparison): SourceLocation[] {
  return [
    ...new Map(
      [...comparison.base, ...comparison.head].map((artifact) => [
        locationKey(artifact.value.location),
        structuredClone(artifact.value.location),
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      compareCodePoints(left.revision, right.revision) ||
      compareCodePoints(left.path, right.path) ||
      (left.startLine ?? 0) - (right.startLine ?? 0) ||
      (left.startColumn ?? 0) - (right.startColumn ?? 0),
  );
}

function unknown(
  comparison: CallableComparison,
  summary: string,
): ContractRuleUnknownInput {
  return {
    type: "other",
    summary,
    locations: comparisonLocations(comparison),
    evidenceIds: [...comparison.evidenceIds],
    blockingRelevance: "required",
  };
}

function signatureText(signature: CallableSignature): string {
  const parameters = signature.parameters
    .map((parameter) => {
      const prefix = parameter.rest ? "..." : "";
      const suffix = parameter.optional ? "?" : "";
      return `${prefix}${parameter.name}${suffix}: ${parameter.type}`;
    })
    .join(", ");
  return `(${parameters}) => ${signature.returnType}`;
}

function signatureKey(signature: CallableSignature): string {
  return canonicalJson(signature);
}

function signatureShape(signature: CallableSignature): string {
  return canonicalJson({
    typeParameterCount: signature.typeParameters.length,
    parameters: signature.parameters.map((parameter) => ({
      optional: parameter.optional,
      rest: parameter.rest,
    })),
  });
}

function sortedSignatures(signatures: readonly CallableSignature[]): Array<{
  signature: CallableSignature;
  index: number;
}> {
  return signatures
    .map((signature, index) => ({ signature, index }))
    .sort(
      (left, right) =>
        compareCodePoints(
          signatureKey(left.signature),
          signatureKey(right.signature),
        ) || left.index - right.index,
    );
}

function pairSignatures(
  baseSignatures: readonly CallableSignature[],
  headSignatures: readonly CallableSignature[],
): SignaturePairing {
  let base = sortedSignatures(baseSignatures);
  let head = sortedSignatures(headSignatures);
  const pairs: SignaturePair[] = [];

  const consumeUniqueMatches = (
    key: (signature: CallableSignature) => string,
  ): void => {
    const baseGroups = new Map<string, typeof base>();
    const headGroups = new Map<string, typeof head>();
    for (const entry of base) {
      const value = key(entry.signature);
      baseGroups.set(value, [...(baseGroups.get(value) ?? []), entry]);
    }
    for (const entry of head) {
      const value = key(entry.signature);
      headGroups.set(value, [...(headGroups.get(value) ?? []), entry]);
    }
    const consumedBase = new Set<number>();
    const consumedHead = new Set<number>();
    for (const [value, baseEntries] of baseGroups) {
      const headEntries = headGroups.get(value) ?? [];
      if (baseEntries.length !== 1 || headEntries.length !== 1) continue;
      const baseEntry = baseEntries[0]!;
      const headEntry = headEntries[0]!;
      pairs.push({
        base: baseEntry.signature,
        head: headEntry.signature,
        baseIndex: baseEntry.index,
        headIndex: headEntry.index,
      });
      consumedBase.add(baseEntry.index);
      consumedHead.add(headEntry.index);
    }
    base = base.filter((entry) => !consumedBase.has(entry.index));
    head = head.filter((entry) => !consumedHead.has(entry.index));
  };

  consumeUniqueMatches(signatureKey);
  consumeUniqueMatches(signatureShape);
  if (base.length === 1 && head.length === 1) {
    const baseEntry = base[0]!;
    const headEntry = head[0]!;
    pairs.push({
      base: baseEntry.signature,
      head: headEntry.signature,
      baseIndex: baseEntry.index,
      headIndex: headEntry.index,
    });
    base = [];
    head = [];
  }
  const ambiguous = base.length > 0 && head.length > 0;
  return {
    pairs: pairs.sort((left, right) => left.baseIndex - right.baseIndex),
    removed: ambiguous
      ? []
      : base.map((entry) => ({
          signature: entry.signature,
          index: entry.index,
        })),
    added: ambiguous
      ? []
      : head.map((entry) => ({
          signature: entry.signature,
          index: entry.index,
        })),
    ambiguous,
  };
}

function stripOuterParentheses(value: string): string {
  let result = value.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    for (let index = 0; index < result.length; index += 1) {
      const character = result[index];
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        balanced = false;
        break;
      }
    }
    if (!balanced || depth !== 0) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function splitTopLevelUnion(value: string): string[] | undefined {
  const normalized = stripOuterParentheses(value);
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
  if (
    /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)$/u.test(value)
  ) {
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
  if (leftCategory === right) return true;
  return false;
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

function equivalentIgnoringUndefined(left: string, right: string): boolean {
  const leftParts = splitTopLevelUnion(left)?.filter(
    (part) => part !== "undefined",
  );
  const rightParts = splitTopLevelUnion(right)?.filter(
    (part) => part !== "undefined",
  );
  return Boolean(
    leftParts &&
    rightParts &&
    canonicalJson(leftParts) === canonicalJson(rightParts),
  );
}

function promiseInner(value: string): string | undefined {
  const normalized = value.trim();
  for (const prefix of ["Promise<", "PromiseLike<"] as const) {
    if (normalized.startsWith(prefix) && normalized.endsWith(">")) {
      const inner = normalized.slice(prefix.length, -1).trim();
      return inner.length > 0 ? inner : undefined;
    }
  }
  return undefined;
}

function matchedComparisons(
  state: TypeScriptCallableRuleState,
): CallableComparison[] {
  return state.comparisons.filter(
    (comparison) =>
      comparison.status === "matched" &&
      comparison.base.length === 1 &&
      comparison.head.length === 1,
  );
}

function evaluation(): MutableEvaluation {
  return { findings: [], unknowns: [], diagnostics: [] };
}

function addUnprovableType(
  result: MutableEvaluation,
  comparison: CallableComparison,
  summary: string,
): void {
  result.findings.push(finding(comparison, summary, "unknown"));
  result.unknowns.push(unknown(comparison, summary));
}

function identityRule(): ContractRuleDefinition<TypeScriptCallableRuleState> {
  return {
    id: "typescript.callable.identity",
    version: "1.0.0",
    family: "typescript",
    description: "Detect removed or ambiguous exported TypeScript callables.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of state.comparisons) {
        if (comparison.status === "removed") {
          const base = comparison.base[0]!.value;
          result.findings.push(
            finding(
              comparison,
              `Exported ${base.kind} ${base.qualifiedName} was removed.`,
              "breaking",
              "base",
            ),
          );
        } else if (comparison.status === "ambiguous") {
          result.unknowns.push(
            unknown(
              comparison,
              `Callable identity for ${comparison.logicalKey} is ambiguous across revisions.`,
            ),
          );
        }
      }
      return result;
    },
  };
}

function overloadRule(): ContractRuleDefinition<TypeScriptCallableRuleState> {
  return {
    id: "typescript.callable.overloads",
    version: "1.0.0",
    family: "typescript",
    description:
      "Detect removed, added, or ambiguous TypeScript call overloads.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedComparisons(state)) {
        const { base, head } = values(comparison);
        const pairing = pairSignatures(base!.signatures, head!.signatures);
        if (pairing.ambiguous) {
          result.unknowns.push(
            unknown(
              comparison,
              `Overload correspondence for ${head!.qualifiedName} cannot be proven uniquely.`,
            ),
          );
          continue;
        }
        for (const removed of pairing.removed) {
          result.findings.push(
            finding(
              comparison,
              `Exported callable ${head!.qualifiedName} removed overload ${signatureText(removed.signature)}.`,
              "breaking",
            ),
          );
        }
        for (const added of pairing.added) {
          result.findings.push(
            finding(
              comparison,
              `Exported callable ${head!.qualifiedName} added overload ${signatureText(added.signature)}.`,
              "compatible",
            ),
          );
        }
      }
      return result;
    },
  };
}

function parameterLabel(parameter: ParameterSignature, index: number): string {
  return `${parameter.name} at position ${index + 1}`;
}

function parameterRule(): ContractRuleDefinition<TypeScriptCallableRuleState> {
  return {
    id: "typescript.callable.parameters",
    version: "1.0.0",
    family: "typescript",
    description: "Detect TypeScript callable parameter compatibility changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedComparisons(state)) {
        const { base, head } = values(comparison);
        const pairing = pairSignatures(base!.signatures, head!.signatures);
        if (pairing.ambiguous) continue;
        for (const pair of pairing.pairs) {
          const count = Math.max(
            pair.base.parameters.length,
            pair.head.parameters.length,
          );
          for (let index = 0; index < count; index += 1) {
            const before = pair.base.parameters[index];
            const after = pair.head.parameters[index];
            if (!before && after) {
              const compatible = after.optional || after.rest;
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} added ${compatible ? "optional" : "required"} parameter ${parameterLabel(after, index)}.`,
                  compatible ? "compatible" : "breaking",
                ),
              );
              continue;
            }
            if (before && !after) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} removed parameter ${parameterLabel(before, index)}.`,
                  "breaking",
                ),
              );
              continue;
            }
            if (!before || !after) continue;
            const optionalityChanged = before.optional !== after.optional;
            if (before.optional !== after.optional) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} changed parameter ${parameterLabel(after, index)} from ${before.optional ? "optional" : "required"} to ${after.optional ? "optional" : "required"}.`,
                  before.optional ? "breaking" : "compatible",
                ),
              );
            }
            if (before.rest !== after.rest) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} changed parameter ${parameterLabel(after, index)} from ${before.rest ? "rest" : "fixed"} to ${after.rest ? "rest" : "fixed"}.`,
                  after.rest ? "compatible" : "breaking",
                ),
              );
            }
            if (before.type === after.type) continue;
            if (
              optionalityChanged &&
              equivalentIgnoringUndefined(before.type, after.type)
            ) {
              continue;
            }
            const relation = typeRelation(before.type, after.type);
            const summary = `Exported callable ${head!.qualifiedName} changed parameter ${parameterLabel(after, index)} from ${before.type} to ${after.type}.`;
            if (relation === "wider") {
              result.findings.push(finding(comparison, summary, "compatible"));
            } else if (relation === "narrower" || relation === "incomparable") {
              result.findings.push(finding(comparison, summary, "breaking"));
            } else if (relation === "unknown") {
              addUnprovableType(result, comparison, summary);
            }
          }
        }
      }
      return result;
    },
  };
}

function typeParameterAt(
  values: readonly TypeParameterSignature[],
  index: number,
): TypeParameterSignature | undefined {
  return values[index];
}

function genericRule(): ContractRuleDefinition<TypeScriptCallableRuleState> {
  return {
    id: "typescript.callable.generics",
    version: "1.0.0",
    family: "typescript",
    description:
      "Detect TypeScript callable generic parameter and constraint changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedComparisons(state)) {
        const { base, head } = values(comparison);
        const pairing = pairSignatures(base!.signatures, head!.signatures);
        if (pairing.ambiguous) continue;
        for (const pair of pairing.pairs) {
          const count = Math.max(
            pair.base.typeParameters.length,
            pair.head.typeParameters.length,
          );
          for (let index = 0; index < count; index += 1) {
            const before = typeParameterAt(pair.base.typeParameters, index);
            const after = typeParameterAt(pair.head.typeParameters, index);
            if (!before && after) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} added ${after.default === undefined ? "required" : "defaulted"} type parameter ${after.name}.`,
                  after.default === undefined ? "breaking" : "compatible",
                ),
              );
              continue;
            }
            if (before && !after) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} removed type parameter ${before.name}.`,
                  "breaking",
                ),
              );
              continue;
            }
            if (!before || !after) continue;
            const beforeConstraint = before.constraint ?? "unknown";
            const afterConstraint = after.constraint ?? "unknown";
            if (beforeConstraint !== afterConstraint) {
              const relation = typeRelation(beforeConstraint, afterConstraint);
              const summary = `Exported callable ${head!.qualifiedName} changed type parameter ${after.name} constraint from ${beforeConstraint} to ${afterConstraint}.`;
              if (relation === "wider") {
                result.findings.push(
                  finding(comparison, summary, "compatible"),
                );
              } else if (
                relation === "narrower" ||
                relation === "incomparable"
              ) {
                result.findings.push(finding(comparison, summary, "breaking"));
              } else if (relation === "unknown") {
                addUnprovableType(result, comparison, summary);
              }
            }
            if (before.default !== after.default) {
              result.findings.push(
                finding(
                  comparison,
                  `Exported callable ${head!.qualifiedName} changed the default for type parameter ${after.name}.`,
                  "potentially_breaking",
                ),
              );
            }
          }
        }
      }
      return result;
    },
  };
}

function returnRule(): ContractRuleDefinition<TypeScriptCallableRuleState> {
  return {
    id: "typescript.callable.returns",
    version: "1.0.0",
    family: "typescript",
    description:
      "Detect TypeScript callable return and async contract changes.",
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate: ({ state }) => {
      const result = evaluation();
      for (const comparison of matchedComparisons(state)) {
        const { base, head } = values(comparison);
        const pairing = pairSignatures(base!.signatures, head!.signatures);
        if (pairing.ambiguous) continue;
        for (const pair of pairing.pairs) {
          if (pair.base.returnType === pair.head.returnType) continue;
          const basePromise = promiseInner(pair.base.returnType);
          const headPromise = promiseInner(pair.head.returnType);
          if ((basePromise === undefined) !== (headPromise === undefined)) {
            result.findings.push(
              finding(
                comparison,
                `Exported callable ${head!.qualifiedName} changed from ${basePromise === undefined ? "synchronous" : "asynchronous"} to ${headPromise === undefined ? "synchronous" : "asynchronous"}.`,
                "breaking",
              ),
            );
            continue;
          }
          const before = basePromise ?? pair.base.returnType;
          const after = headPromise ?? pair.head.returnType;
          const relation = typeRelation(before, after);
          const summary = `Exported callable ${head!.qualifiedName} changed its return type from ${pair.base.returnType} to ${pair.head.returnType}.`;
          if (relation === "narrower") {
            result.findings.push(finding(comparison, summary, "compatible"));
          } else if (relation === "wider" || relation === "incomparable") {
            result.findings.push(finding(comparison, summary, "breaking"));
          } else if (relation === "unknown") {
            addUnprovableType(result, comparison, summary);
          }
        }
      }
      return result;
    },
  };
}

export function createTypeScriptCallableRuleDefinitions(): ContractRuleDefinition<TypeScriptCallableRuleState>[] {
  return [
    genericRule(),
    identityRule(),
    overloadRule(),
    parameterRule(),
    returnRule(),
  ];
}

export async function evaluateTypeScriptCallableRules(
  input: EvaluateTypeScriptCallableRulesInput,
): Promise<TypeScriptCallableRuleResult> {
  return executeContractRules(createTypeScriptCallableRuleDefinitions(), {
    ir: input.ir,
    state: createTypeScriptCallableRuleState(input),
  });
}
