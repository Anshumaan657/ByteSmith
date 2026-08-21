import { stableId, verifyStableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  normalizeRepositoryPath,
  validateExactGitRevision,
  validateStableId,
  type Evidence,
  type EvidenceKind,
  type Producer,
  type SourceLocation,
} from "@bytesmith/impact-types";
import { EvidenceError } from "./errors.js";
import type {
  EvidenceCollection,
  EvidenceContext,
  EvidenceInput,
  RevisionBinding,
  SourceLocationInput,
} from "./types.js";

const evidenceKinds = new Set<EvidenceKind>([
  "syntax",
  "type",
  "call",
  "import",
  "contract",
  "configuration",
  "coverage",
  "runtime",
  "history",
  "heuristic",
]);

function evidenceFailure(
  code: ConstructorParameters<typeof EvidenceError>[0],
  message: string,
  cause?: unknown,
): never {
  const error = new EvidenceError(code, message);
  if (cause !== undefined)
    Object.defineProperty(error, "cause", { value: cause });
  throw error;
}

function normalizeBinding(binding: RevisionBinding): RevisionBinding {
  try {
    return {
      repositoryId: validateStableId(binding.repositoryId, "Repository ID"),
      baseRevision: validateExactGitRevision(
        binding.baseRevision,
        "Base revision",
      ),
      headRevision: validateExactGitRevision(
        binding.headRevision,
        "Head revision",
      ),
    };
  } catch (cause) {
    evidenceFailure(
      "evidence_binding_invalid",
      "Evidence revision binding is invalid.",
      cause,
    );
  }
}

function normalizeProducer(producer: Producer): Producer {
  try {
    return {
      id: validateStableId(producer.id, "Producer ID"),
      version: normalizeNonEmptyText(producer.version, "Producer version"),
    };
  } catch (cause) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence producer is invalid.",
      cause,
    );
  }
}

function validateCoordinate(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    evidenceFailure(
      "evidence_input_invalid",
      `${name} must be a positive safe integer.`,
    );
  }
}

function normalizeLocation(
  binding: RevisionBinding,
  input: SourceLocationInput,
): SourceLocation {
  const normalizedBinding = normalizeBinding(binding);
  let revision: string;
  let path: string;
  try {
    revision = validateExactGitRevision(input.revision);
    path = normalizeRepositoryPath(input.path);
  } catch (cause) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence source location is invalid.",
      cause,
    );
  }
  if (
    revision !== normalizedBinding.baseRevision &&
    revision !== normalizedBinding.headRevision
  ) {
    evidenceFailure(
      "evidence_revision_mismatch",
      "Evidence revision is outside the selected comparison.",
    );
  }
  validateCoordinate(input.startLine, "Start line");
  validateCoordinate(input.startColumn, "Start column");
  validateCoordinate(input.endLine, "End line");
  validateCoordinate(input.endColumn, "End column");
  if (
    (input.startColumn !== undefined && input.startLine === undefined) ||
    (input.endLine !== undefined && input.startLine === undefined) ||
    (input.endColumn !== undefined && input.endLine === undefined)
  ) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence source coordinates are incomplete.",
    );
  }
  if (
    input.startLine !== undefined &&
    input.endLine !== undefined &&
    (input.endLine < input.startLine ||
      (input.endLine === input.startLine &&
        input.startColumn !== undefined &&
        input.endColumn !== undefined &&
        input.endColumn < input.startColumn))
  ) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence source range ends before it starts.",
    );
  }
  return {
    repository: normalizedBinding.repositoryId,
    revision,
    path,
    ...(input.startLine === undefined ? {} : { startLine: input.startLine }),
    ...(input.startColumn === undefined
      ? {}
      : { startColumn: input.startColumn }),
    ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
    ...(input.endColumn === undefined ? {} : { endColumn: input.endColumn }),
  };
}

function evidencePayload(record: Omit<Evidence, "id">): unknown {
  return record;
}

function locationsEqual(left: SourceLocation, right: SourceLocation): boolean {
  return (
    left.repository === right.repository &&
    left.revision === right.revision &&
    left.path === right.path &&
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

export function createEvidenceContext(
  context: EvidenceContext,
): EvidenceContext {
  return {
    ...normalizeBinding(context),
    producer: normalizeProducer(context.producer),
  };
}

export function createSourceLocation(
  binding: RevisionBinding,
  input: SourceLocationInput,
): SourceLocation {
  return normalizeLocation(binding, input);
}

export function createEvidence(
  context: EvidenceContext,
  input: EvidenceInput,
): Evidence {
  const normalizedContext = createEvidenceContext(context);
  if (!evidenceKinds.has(input.kind)) {
    evidenceFailure("evidence_input_invalid", "Evidence kind is invalid.");
  }
  let summary: string;
  try {
    summary = normalizeNonEmptyText(input.summary, "Evidence summary");
  } catch (cause) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence summary is invalid.",
      cause,
    );
  }
  const record = {
    kind: input.kind,
    producer: normalizedContext.producer,
    location: normalizeLocation(normalizedContext, input),
    summary,
  } satisfies Omit<Evidence, "id">;
  return { id: stableId("evidence", evidencePayload(record)), ...record };
}

export function validateEvidence(
  binding: RevisionBinding,
  evidence: Evidence,
): void {
  const normalizedBinding = normalizeBinding(binding);
  if (evidence.location.repository !== normalizedBinding.repositoryId) {
    evidenceFailure(
      "evidence_revision_mismatch",
      "Evidence repository is outside the selected comparison.",
    );
  }
  const location = normalizeLocation(normalizedBinding, evidence.location);
  const producer = normalizeProducer(evidence.producer);
  if (!evidenceKinds.has(evidence.kind)) {
    evidenceFailure("evidence_input_invalid", "Evidence kind is invalid.");
  }
  let summary: string;
  try {
    summary = normalizeNonEmptyText(evidence.summary, "Evidence summary");
    validateStableId(evidence.id, "Evidence ID");
  } catch (cause) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence record is invalid.",
      cause,
    );
  }
  if (
    !locationsEqual(location, evidence.location) ||
    producer.id !== evidence.producer.id ||
    producer.version !== evidence.producer.version ||
    summary !== evidence.summary
  ) {
    evidenceFailure(
      "evidence_input_invalid",
      "Evidence record is not canonically normalized.",
    );
  }
  const payload = { kind: evidence.kind, producer, location, summary };
  if (!verifyStableId(evidence.id, "evidence", payload)) {
    evidenceFailure(
      "evidence_id_invalid",
      "Evidence ID does not match its semantic content.",
    );
  }
}

export function createEvidenceCollection(
  context: EvidenceContext,
  inputs: readonly EvidenceInput[],
): EvidenceCollection {
  const normalizedContext = createEvidenceContext(context);
  const records = inputs
    .map((input) => createEvidence(normalizedContext, input))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      evidenceFailure(
        "evidence_duplicate_id",
        "Evidence collection contains a duplicate semantic record.",
      );
    }
    ids.add(record.id);
  }
  return {
    binding: {
      repositoryId: normalizedContext.repositoryId,
      baseRevision: normalizedContext.baseRevision,
      headRevision: normalizedContext.headRevision,
    },
    records,
  };
}
