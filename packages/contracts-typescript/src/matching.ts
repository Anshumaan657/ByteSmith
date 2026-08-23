import { stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import { TypeScriptDiscoveryError } from "./errors.js";
import type {
  CrossRevisionSymbolAnalysis,
  CrossRevisionSymbolMatch,
  SymbolMatchBasis,
  TypeScriptCompilerAnalysis,
  TypeScriptContract,
  TypeScriptSymbol,
  UnmatchedTypeScriptSymbol,
} from "./types.js";

interface MatchedPair {
  base: TypeScriptSymbol;
  head: TypeScriptSymbol;
  basis: SymbolMatchBasis;
}

function exactKey(symbol: TypeScriptSymbol): string {
  return [
    symbol.projectId,
    symbol.path,
    symbol.kind,
    symbol.qualifiedName,
  ].join("\0");
}

function movedKey(symbol: TypeScriptSymbol): string {
  return [symbol.kind, symbol.qualifiedName].join("\0");
}

function groupBy(
  symbols: readonly TypeScriptSymbol[],
  key: (symbol: TypeScriptSymbol) => string,
): Map<string, TypeScriptSymbol[]> {
  const result = new Map<string, TypeScriptSymbol[]>();
  for (const symbol of symbols) {
    const value = key(symbol);
    const group = result.get(value) ?? [];
    group.push(symbol);
    result.set(value, group);
  }
  return result;
}

function contractFingerprints(
  contracts: readonly TypeScriptContract[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const contract of contracts) {
    const values = result.get(contract.symbolId) ?? [];
    values.push(contract.fingerprint);
    result.set(contract.symbolId, values);
  }
  for (const values of result.values()) values.sort(compareCodePoints);
  return result;
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return (
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
}

function validateComparison(
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): void {
  try {
    validateStableId(base.repositoryId, "Base repository ID");
    validateStableId(head.repositoryId, "Head repository ID");
    validateExactGitRevision(base.revision, "Base revision");
    validateExactGitRevision(head.revision, "Head revision");
  } catch (cause) {
    throw new TypeScriptDiscoveryError(
      "analysis_comparison_invalid",
      "Cross-revision symbol analysis contains an invalid identity binding.",
      cause,
    );
  }
  if (base.repositoryId !== head.repositoryId) {
    throw new TypeScriptDiscoveryError(
      "analysis_comparison_invalid",
      "Cross-revision symbol matching requires one repository identity.",
    );
  }
  if (base.revision === head.revision) {
    throw new TypeScriptDiscoveryError(
      "analysis_comparison_invalid",
      "Cross-revision symbol matching requires two different exact revisions.",
    );
  }
  if (
    base.symbols.some(
      (symbol) =>
        symbol.repositoryId !== base.repositoryId ||
        symbol.revision !== base.revision,
    ) ||
    head.symbols.some(
      (symbol) =>
        symbol.repositoryId !== head.repositoryId ||
        symbol.revision !== head.revision,
    )
  ) {
    throw new TypeScriptDiscoveryError(
      "analysis_comparison_invalid",
      "A symbol is bound to a different repository or revision than its analysis.",
    );
  }
}

export function matchTypeScriptSymbols(
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): CrossRevisionSymbolAnalysis {
  validateComparison(base, head);
  const matchedBase = new Set<string>();
  const matchedHead = new Set<string>();
  const pairs: MatchedPair[] = [];

  const baseExact = groupBy(base.symbols, exactKey);
  const headExact = groupBy(head.symbols, exactKey);
  for (const [key, baseCandidates] of baseExact) {
    const headCandidates = headExact.get(key) ?? [];
    if (baseCandidates.length !== 1 || headCandidates.length !== 1) continue;
    const baseSymbol = baseCandidates[0]!;
    const headSymbol = headCandidates[0]!;
    pairs.push({
      base: baseSymbol,
      head: headSymbol,
      basis: "project_path_qualified_name",
    });
    matchedBase.add(baseSymbol.id);
    matchedHead.add(headSymbol.id);
  }

  const remainingBase = base.symbols.filter(
    (symbol) => !matchedBase.has(symbol.id),
  );
  const remainingHead = head.symbols.filter(
    (symbol) => !matchedHead.has(symbol.id),
  );
  const baseMoved = groupBy(remainingBase, movedKey);
  const headMoved = groupBy(remainingHead, movedKey);
  for (const [key, baseCandidates] of baseMoved) {
    const headCandidates = headMoved.get(key) ?? [];
    if (baseCandidates.length !== 1 || headCandidates.length !== 1) continue;
    const baseSymbol = baseCandidates[0]!;
    const headSymbol = headCandidates[0]!;
    pairs.push({
      base: baseSymbol,
      head: headSymbol,
      basis: "unique_qualified_name",
    });
    matchedBase.add(baseSymbol.id);
    matchedHead.add(headSymbol.id);
  }

  const baseContracts = contractFingerprints(base.contracts);
  const headContracts = contractFingerprints(head.contracts);
  const matches: CrossRevisionSymbolMatch[] = pairs
    .map((pair) => {
      const logicalInput =
        pair.basis === "project_path_qualified_name"
          ? {
              repositoryId: base.repositoryId,
              projectId: pair.base.projectId,
              path: pair.base.path,
              kind: pair.base.kind,
              qualifiedName: pair.base.qualifiedName,
            }
          : {
              repositoryId: base.repositoryId,
              kind: pair.base.kind,
              qualifiedName: pair.base.qualifiedName,
            };
      const logicalId = stableId("typescript-logical-symbol", logicalInput);
      return {
        id: stableId("typescript-symbol-match", {
          repositoryId: base.repositoryId,
          baseRevision: base.revision,
          headRevision: head.revision,
          baseSymbolId: pair.base.id,
          headSymbolId: pair.head.id,
          basis: pair.basis,
        }),
        logicalId,
        repositoryId: base.repositoryId,
        baseRevision: base.revision,
        headRevision: head.revision,
        baseSymbolId: pair.base.id,
        headSymbolId: pair.head.id,
        basis: pair.basis,
        moved: pair.base.path !== pair.head.path,
        signatureChanged: !sameStrings(
          baseContracts.get(pair.base.id),
          headContracts.get(pair.head.id),
        ),
      };
    })
    .sort((left, right) => compareCodePoints(left.logicalId, right.logicalId));

  const unmatched: UnmatchedTypeScriptSymbol[] = [];
  for (const symbol of base.symbols) {
    if (matchedBase.has(symbol.id)) continue;
    const candidates = headMoved.get(movedKey(symbol)) ?? [];
    unmatched.push({
      symbolId: symbol.id,
      side: "base",
      reason: candidates.length > 0 ? "ambiguous" : "removed",
    });
  }
  for (const symbol of head.symbols) {
    if (matchedHead.has(symbol.id)) continue;
    const candidates = baseMoved.get(movedKey(symbol)) ?? [];
    unmatched.push({
      symbolId: symbol.id,
      side: "head",
      reason: candidates.length > 0 ? "ambiguous" : "added",
    });
  }
  unmatched.sort((left, right) => {
    const side = compareCodePoints(left.side, right.side);
    return side !== 0 ? side : compareCodePoints(left.symbolId, right.symbolId);
  });

  return {
    schemaVersion: "1.0.0",
    repositoryId: base.repositoryId,
    baseRevision: base.revision,
    headRevision: head.revision,
    matches,
    unmatched,
  };
}
