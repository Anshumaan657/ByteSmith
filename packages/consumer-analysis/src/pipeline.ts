import { createHash } from "node:crypto";
import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateStableId,
  type ComponentRef,
} from "@bytesmith/impact-types";
import { validateCanonicalIr, type CanonicalIr } from "@bytesmith/ir";
import { ConsumerAnalysisError } from "./errors.js";
import type {
  CombinedConsumerAnalysisResult,
  ConsumerAnalysisResult,
  ConsumerPath,
  ConsumerTraversalLimits,
} from "./types.js";
import type {
  ManifestChange,
  ManifestImpact,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import type { Evidence } from "@bytesmith/impact-types";

export const defaultConsumerLimits: ConsumerTraversalLimits = {
  maxDepth: 8,
  maxConsumers: 10_000,
  maxEdges: 50_000,
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConsumerAnalysisError(
      "limit_invalid",
      `${name} must be a positive safe integer.`,
    );
  }
  return value;
}

export function normalizeConsumerLimits(
  input: Partial<ConsumerTraversalLimits> | undefined,
): ConsumerTraversalLimits {
  const values = { ...defaultConsumerLimits, ...input };
  return {
    maxDepth: positiveInteger(values.maxDepth, "maxDepth"),
    maxConsumers: positiveInteger(values.maxConsumers, "maxConsumers"),
    maxEdges: positiveInteger(values.maxEdges, "maxEdges"),
  };
}

export function validateConsumerIr(ir: CanonicalIr): void {
  try {
    validateCanonicalIr(ir);
  } catch (cause) {
    throw new ConsumerAnalysisError(
      "input_invalid",
      "Consumer analysis requires valid canonical IR.",
      cause,
    );
  }
}

export function consumerAnalyzerVersion(value: string | undefined): string {
  try {
    return normalizeNonEmptyText(value ?? "0.1.0", "Consumer analyzer version");
  } catch (cause) {
    throw new ConsumerAnalysisError(
      "input_invalid",
      "Consumer analyzer version is invalid.",
      cause,
    );
  }
}

export function relevantChanges(
  changes: readonly ManifestChange[],
): ManifestChange[] {
  const result = changes.filter(
    (change) => change.compatibility !== "compatible",
  );
  for (const change of result) {
    try {
      validateStableId(change.id, "Source change ID");
      validateStableId(change.component.id, "Changed component ID");
    } catch (cause) {
      throw new ConsumerAnalysisError(
        "input_invalid",
        "Consumer analysis received an invalid source change.",
        cause,
      );
    }
  }
  return [...result].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
}

export function createConsumerImpact(input: {
  ruleId: string;
  category: ManifestImpact["category"];
  change: ManifestChange;
  component: ComponentRef;
  evidenceIds: readonly string[];
  depth?: number;
}): ManifestImpact {
  const evidenceIds = [...new Set(input.evidenceIds)].sort(compareCodePoints);
  const depth = input.depth ?? 1;
  const summary =
    input.category === "transitive"
      ? `${input.component.name} is affected through a ${depth}-edge consumer path from ${input.change.component.name}.`
      : input.category === "contract"
        ? `Workspace package ${input.component.name} depends on changed contract ${input.change.component.name}.`
        : `${input.component.name} directly consumes changed contract ${input.change.component.name}.`;
  const record = {
    ruleId: input.ruleId,
    ruleVersion: "1.0.0",
    category: input.category,
    severity:
      input.change.compatibility === "breaking"
        ? ("high" as const)
        : input.change.compatibility === "potentially_breaking"
          ? ("medium" as const)
          : ("low" as const),
    confidence: "verified" as const,
    summary,
    sourceChangeIds: [input.change.id],
    affectedComponents: [structuredClone(input.component)],
    evidenceIds,
  };
  return {
    id: stableId("consumer-impact", record),
    ...record,
  };
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function semanticDigest(value: unknown) {
  return {
    algorithm: "sha256" as const,
    value: createHash("sha256").update(canonicalJson(value)).digest("hex"),
  };
}

export function finalizeConsumerResult(input: {
  ir: CanonicalIr;
  analyzerVersion: string;
  family: "openapi" | "typescript";
  paths: readonly ConsumerPath[];
  impacts: readonly ManifestImpact[];
  unknowns: readonly ManifestUnknown[];
  generatedEvidence: readonly Evidence[];
  diagnostics?: readonly string[];
}): ConsumerAnalysisResult {
  const paths = uniqueById(input.paths).sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const impacts = uniqueById(input.impacts).sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const unknowns = uniqueById(input.unknowns).sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const generatedEvidence = uniqueById(input.generatedEvidence).sort(
    (left, right) => compareCodePoints(left.id, right.id),
  );
  const diagnostics = [...new Set(input.diagnostics ?? [])].sort(
    compareCodePoints,
  );
  const result = {
    schemaVersion: "1.0.0" as const,
    repositoryId: input.ir.repositoryId,
    baseRevision: input.ir.baseRevision,
    headRevision: input.ir.headRevision,
    analyzerVersion: input.analyzerVersion,
    family: input.family,
    status: unknowns.some((unknown) => unknown.blockingRelevance !== "none")
      ? ("incomplete" as const)
      : ("completed" as const),
    paths,
    impacts,
    unknowns,
    generatedEvidence,
    diagnostics,
  };
  return { ...result, semanticDigest: semanticDigest(result) };
}

export function combineConsumerAnalysisResults(
  results: readonly ConsumerAnalysisResult[],
): CombinedConsumerAnalysisResult {
  if (results.length === 0) {
    throw new ConsumerAnalysisError(
      "input_invalid",
      "At least one consumer-analysis result is required.",
    );
  }
  const first = results[0]!;
  if (
    results.some(
      (result) =>
        result.repositoryId !== first.repositoryId ||
        result.baseRevision !== first.baseRevision ||
        result.headRevision !== first.headRevision,
    )
  ) {
    throw new ConsumerAnalysisError(
      "binding_mismatch",
      "Consumer-analysis results belong to different exact comparisons.",
    );
  }
  const families = [...new Set(results.map((result) => result.family))].sort(
    compareCodePoints,
  );
  const combinedWithoutDigest = {
    schemaVersion: "1.0.0" as const,
    repositoryId: first.repositoryId,
    baseRevision: first.baseRevision,
    headRevision: first.headRevision,
    analyzerVersion: first.analyzerVersion,
    status: results.some((result) => result.status === "incomplete")
      ? ("incomplete" as const)
      : ("completed" as const),
    families,
    paths: uniqueById(results.flatMap((result) => result.paths)).sort(
      (left, right) => compareCodePoints(left.id, right.id),
    ),
    impacts: uniqueById(results.flatMap((result) => result.impacts)).sort(
      (left, right) => compareCodePoints(left.id, right.id),
    ),
    unknowns: uniqueById(results.flatMap((result) => result.unknowns)).sort(
      (left, right) => compareCodePoints(left.id, right.id),
    ),
    generatedEvidence: uniqueById(
      results.flatMap((result) => result.generatedEvidence),
    ).sort((left, right) => compareCodePoints(left.id, right.id)),
    diagnostics: [
      ...new Set(results.flatMap((result) => result.diagnostics)),
    ].sort(compareCodePoints),
  };
  return {
    ...combinedWithoutDigest,
    semanticDigest: semanticDigest(combinedWithoutDigest),
  };
}
