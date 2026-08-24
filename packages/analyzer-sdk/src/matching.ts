import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateStableId,
  type Evidence,
} from "@bytesmith/impact-types";
import { validateCanonicalIr } from "@bytesmith/ir";
import { ContractRuleError } from "./errors.js";
import type {
  ContractArtifact,
  ContractComparison,
  CreateContractComparisonsInput,
} from "./types.js";

function fail(message: string, cause?: unknown): never {
  throw new ContractRuleError("execution_input_invalid", message, cause);
}

function normalizeEvidenceIds(
  values: readonly string[],
  revision: string,
  evidenceById: ReadonlyMap<string, Evidence>,
): string[] {
  if (values.length === 0) {
    fail("Contract comparison artifacts must reference evidence.");
  }
  const ids = values.map((value) => {
    try {
      return validateStableId(value, "Contract artifact evidence ID");
    } catch (cause) {
      fail("Contract comparison artifact evidence is invalid.", cause);
    }
  });
  if (new Set(ids).size !== ids.length) {
    fail("Contract comparison artifact repeats evidence.");
  }
  for (const id of ids) {
    const evidence = evidenceById.get(id);
    if (!evidence || evidence.location.revision !== revision) {
      fail(
        "Contract comparison artifact evidence does not match its revision.",
      );
    }
  }
  if (ids.every((id) => evidenceById.get(id)?.kind === "heuristic")) {
    fail(
      "Contract comparison artifacts cannot rely only on heuristic evidence.",
    );
  }
  return ids.sort(compareCodePoints);
}

function normalizeArtifact<Value>(
  input: ContractArtifact<Value>,
  baseRevision: string,
  headRevision: string,
  evidenceById: ReadonlyMap<string, Evidence>,
): ContractArtifact<Value> {
  if (input.revision !== baseRevision && input.revision !== headRevision) {
    fail("Contract comparison artifact is outside the selected revisions.");
  }
  try {
    canonicalJson(input.value);
    return {
      id: validateStableId(input.id, "Contract artifact ID"),
      revision: input.revision,
      logicalKey: normalizeNonEmptyText(
        input.logicalKey,
        "Contract artifact logical key",
      ),
      value: structuredClone(input.value),
      evidenceIds: normalizeEvidenceIds(
        input.evidenceIds,
        input.revision,
        evidenceById,
      ),
    };
  } catch (cause) {
    if (cause instanceof ContractRuleError) throw cause;
    fail("Contract comparison artifact is invalid.", cause);
  }
}

export function createContractComparisons<Value>(
  input: CreateContractComparisonsInput<Value>,
): ContractComparison<Value>[] {
  try {
    validateCanonicalIr(input.ir);
  } catch (cause) {
    fail("Contract comparison requires valid canonical IR.", cause);
  }
  const binding = {
    repositoryId: input.ir.repositoryId,
    baseRevision: input.ir.baseRevision,
    headRevision: input.ir.headRevision,
  };
  const evidenceById = new Map(
    input.ir.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const artifacts = input.artifacts.map((artifact) =>
    normalizeArtifact(
      artifact,
      binding.baseRevision,
      binding.headRevision,
      evidenceById,
    ),
  );
  if (
    new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length
  ) {
    fail("Contract comparison artifact IDs must be unique.");
  }
  const grouped = new Map<string, ContractArtifact<Value>[]>();
  for (const artifact of artifacts) {
    const values = grouped.get(artifact.logicalKey) ?? [];
    values.push(artifact);
    grouped.set(artifact.logicalKey, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([logicalKey, values]) => {
      const base = values
        .filter((artifact) => artifact.revision === binding.baseRevision)
        .sort((left, right) => compareCodePoints(left.id, right.id));
      const head = values
        .filter((artifact) => artifact.revision === binding.headRevision)
        .sort((left, right) => compareCodePoints(left.id, right.id));
      const status =
        base.length > 1 || head.length > 1
          ? "ambiguous"
          : base.length === 1 && head.length === 1
            ? "matched"
            : base.length === 1
              ? "removed"
              : "added";
      const evidenceIds = [
        ...new Set(
          [...base, ...head].flatMap((artifact) => artifact.evidenceIds),
        ),
      ].sort(compareCodePoints);
      return {
        id: stableId("contract-comparison", {
          binding,
          logicalKey,
          base: base.map((artifact) => ({
            id: artifact.id,
            value: artifact.value,
          })),
          head: head.map((artifact) => ({
            id: artifact.id,
            value: artifact.value,
          })),
        }),
        logicalKey,
        status,
        base,
        head,
        evidenceIds,
      };
    });
}
