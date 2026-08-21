import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import { createSourceLocation, validateEvidence } from "@bytesmith/evidence";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateExactGitRevision,
  validateStableId,
  type Evidence,
  type SourceLocation,
  type StableId,
} from "@bytesmith/impact-types";
import { IrError } from "./errors.js";
import type {
  CanonicalIr,
  CanonicalIrRecords,
  IrContext,
  IrContract,
  IrContractInput,
  IrFile,
  IrFileInput,
  IrGap,
  IrGapInput,
  IrRelationship,
  IrRelationshipInput,
  IrSymbol,
  IrSymbolInput,
  IrTest,
  IrTestInput,
} from "./types.js";

const symbolKinds = new Set([
  "function",
  "method",
  "interface",
  "field",
  "type_alias",
  "class",
  "variable",
  "module",
  "other",
]);
const contractKinds = new Set([
  "function_signature",
  "type_shape",
  "api_operation",
  "schema",
  "package_export",
  "other",
]);
const relationshipKinds = new Set([
  "imports",
  "exports",
  "re_exports",
  "calls",
  "references",
  "contains",
  "implements",
  "extends",
  "consumes",
  "tested_by",
  "other",
]);
const gapTypes = new Set([
  "unsupported_file",
  "dynamic_import",
  "reflection",
  "generated_code",
  "missing_repository",
  "unresolved_symbol",
  "analyzer_gap",
  "other",
]);
const blockingRelevances = new Set(["none", "possible", "required"]);

function fail(
  code: ConstructorParameters<typeof IrError>[0],
  message: string,
  cause?: unknown,
): never {
  const error = new IrError(code, message);
  if (cause !== undefined)
    Object.defineProperty(error, "cause", { value: cause });
  throw error;
}

function normalizeContext(context: IrContext): IrContext {
  try {
    return {
      repositoryId: validateStableId(context.repositoryId, "Repository ID"),
      baseRevision: validateExactGitRevision(
        context.baseRevision,
        "Base revision",
      ),
      headRevision: validateExactGitRevision(
        context.headRevision,
        "Head revision",
      ),
    };
  } catch (cause) {
    fail("ir_context_invalid", "Canonical IR context is invalid.", cause);
  }
}

function normalizeText(value: string, description: string): string {
  try {
    return normalizeNonEmptyText(value, description);
  } catch (cause) {
    fail("ir_record_invalid", `${description} is invalid.`, cause);
  }
}

function normalizeRevision(context: IrContext, revision: string): string {
  let normalized: string;
  try {
    normalized = validateExactGitRevision(revision);
  } catch (cause) {
    fail("ir_record_invalid", "IR record revision is invalid.", cause);
  }
  if (
    normalized !== context.baseRevision &&
    normalized !== context.headRevision
  ) {
    fail(
      "ir_record_invalid",
      "IR record revision is outside the selected comparison.",
    );
  }
  return normalized;
}

function normalizeIds(values: readonly string[]): StableId[] {
  if (values.length === 0) {
    fail("ir_record_invalid", "IR records must reference evidence.");
  }
  const result = values.map((value) => {
    try {
      return validateStableId(value, "IR reference ID");
    } catch (cause) {
      fail("ir_record_invalid", "IR reference ID is invalid.", cause);
    }
  });
  if (new Set(result).size !== result.length) {
    fail("ir_record_invalid", "IR reference IDs contain a duplicate.");
  }
  return result.sort(compareCodePoints);
}

function normalizeLocation(
  context: IrContext,
  input: Parameters<typeof createSourceLocation>[1],
): SourceLocation {
  try {
    return createSourceLocation(context, input);
  } catch (cause) {
    fail("ir_record_invalid", "IR source location is invalid.", cause);
  }
}

function locationIdentity(location: SourceLocation): unknown {
  return location;
}

function compareLocations(left: SourceLocation, right: SourceLocation): number {
  for (const comparison of [
    compareCodePoints(left.repository, right.repository),
    compareCodePoints(left.revision, right.revision),
    compareCodePoints(left.path, right.path),
    (left.startLine ?? 0) - (right.startLine ?? 0),
    (left.startColumn ?? 0) - (right.startColumn ?? 0),
    (left.endLine ?? 0) - (right.endLine ?? 0),
    (left.endColumn ?? 0) - (right.endColumn ?? 0),
  ]) {
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function locationFields(location: SourceLocation) {
  return {
    path: location.path,
    ...(location.startLine === undefined
      ? {}
      : { startLine: location.startLine }),
    ...(location.startColumn === undefined
      ? {}
      : { startColumn: location.startColumn }),
    ...(location.endLine === undefined ? {} : { endLine: location.endLine }),
    ...(location.endColumn === undefined
      ? {}
      : { endColumn: location.endColumn }),
  };
}

function fileIdentity(context: IrContext, record: Omit<IrFile, "id">): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    path: record.location.path,
  };
}

function symbolIdentity(
  context: IrContext,
  record: Omit<IrSymbol, "id">,
): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    fileId: record.fileId,
    kind: record.kind,
    name: record.name,
    location: locationIdentity(record.location),
  };
}

function contractIdentity(
  context: IrContext,
  record: Omit<IrContract, "id">,
): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    subjectId: record.subjectId,
    kind: record.kind,
    name: record.name,
    location: locationIdentity(record.location),
  };
}

function relationshipIdentity(
  context: IrContext,
  record: Omit<IrRelationship, "id">,
): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    kind: record.kind,
    fromId: record.fromId,
    toId: record.toId,
    authority: record.authority,
  };
}

function testIdentity(context: IrContext, record: Omit<IrTest, "id">): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    framework: record.framework,
    name: record.name,
    location: locationIdentity(record.location),
  };
}

function gapIdentity(context: IrContext, record: Omit<IrGap, "id">): unknown {
  return {
    repositoryId: context.repositoryId,
    revision: record.revision,
    type: record.type,
    summary: record.summary,
    locations: record.locations,
    blockingRelevance: record.blockingRelevance,
  };
}

export function createIrFile(context: IrContext, input: IrFileInput): IrFile {
  const normalizedContext = normalizeContext(context);
  const revision = normalizeRevision(normalizedContext, input.revision);
  const location = normalizeLocation(normalizedContext, input);
  const record: Omit<IrFile, "id"> = {
    revision,
    location,
    ...(input.mediaType === undefined
      ? {}
      : { mediaType: normalizeText(input.mediaType, "File media type") }),
    evidenceIds: normalizeIds(input.evidenceIds),
  };
  return {
    id: stableId("file", fileIdentity(normalizedContext, record)),
    ...record,
  };
}

export function createIrSymbol(
  context: IrContext,
  input: IrSymbolInput,
): IrSymbol {
  const normalizedContext = normalizeContext(context);
  if (!symbolKinds.has(input.kind))
    fail("ir_record_invalid", "IR symbol kind is invalid.");
  let fileId: string;
  try {
    fileId = validateStableId(input.fileId, "IR file ID");
  } catch (cause) {
    fail("ir_record_invalid", "IR symbol file reference is invalid.", cause);
  }
  const revision = normalizeRevision(normalizedContext, input.revision);
  const record: Omit<IrSymbol, "id"> = {
    revision,
    fileId,
    kind: input.kind,
    name: normalizeText(input.name, "Symbol name"),
    exported: input.exported,
    location: normalizeLocation(normalizedContext, input),
    evidenceIds: normalizeIds(input.evidenceIds),
  };
  return {
    id: stableId("symbol", symbolIdentity(normalizedContext, record)),
    ...record,
  };
}

export function createIrContract(
  context: IrContext,
  input: IrContractInput,
): IrContract {
  const normalizedContext = normalizeContext(context);
  if (!contractKinds.has(input.kind))
    fail("ir_record_invalid", "IR contract kind is invalid.");
  let subjectId: string;
  try {
    subjectId = validateStableId(input.subjectId, "IR subject ID");
  } catch (cause) {
    fail("ir_record_invalid", "IR contract subject is invalid.", cause);
  }
  const revision = normalizeRevision(normalizedContext, input.revision);
  const record: Omit<IrContract, "id"> = {
    revision,
    subjectId,
    kind: input.kind,
    name: normalizeText(input.name, "Contract name"),
    fingerprint: normalizeText(input.fingerprint, "Contract fingerprint"),
    location: normalizeLocation(normalizedContext, input),
    evidenceIds: normalizeIds(input.evidenceIds),
  };
  return {
    id: stableId("contract", contractIdentity(normalizedContext, record)),
    ...record,
  };
}

export function createIrRelationship(
  context: IrContext,
  input: IrRelationshipInput,
): IrRelationship {
  const normalizedContext = normalizeContext(context);
  if (!relationshipKinds.has(input.kind))
    fail("ir_record_invalid", "IR relationship kind is invalid.");
  if (input.authority !== "authoritative" && input.authority !== "heuristic")
    fail("ir_record_invalid", "IR relationship authority is invalid.");
  let fromId: string;
  let toId: string;
  try {
    fromId = validateStableId(input.fromId, "Relationship source ID");
    toId = validateStableId(input.toId, "Relationship target ID");
  } catch (cause) {
    fail("ir_record_invalid", "IR relationship endpoint is invalid.", cause);
  }
  const record: Omit<IrRelationship, "id"> = {
    revision: normalizeRevision(normalizedContext, input.revision),
    kind: input.kind,
    fromId,
    toId,
    authority: input.authority,
    evidenceIds: normalizeIds(input.evidenceIds),
  };
  return {
    id: stableId(
      "relationship",
      relationshipIdentity(normalizedContext, record),
    ),
    ...record,
  };
}

export function createIrTest(context: IrContext, input: IrTestInput): IrTest {
  const normalizedContext = normalizeContext(context);
  if (!new Set(["jest", "vitest", "other"]).has(input.framework))
    fail("ir_record_invalid", "IR test framework is invalid.");
  const record: Omit<IrTest, "id"> = {
    revision: normalizeRevision(normalizedContext, input.revision),
    framework: input.framework,
    name: normalizeText(input.name, "Test name"),
    location: normalizeLocation(normalizedContext, input),
    evidenceIds: normalizeIds(input.evidenceIds),
  };
  return {
    id: stableId("test", testIdentity(normalizedContext, record)),
    ...record,
  };
}

export function createIrGap(context: IrContext, input: IrGapInput): IrGap {
  const normalizedContext = normalizeContext(context);
  if (!gapTypes.has(input.type))
    fail("ir_record_invalid", "IR gap type is invalid.");
  if (!blockingRelevances.has(input.blockingRelevance))
    fail("ir_record_invalid", "IR gap blocking relevance is invalid.");
  const revision = normalizeRevision(normalizedContext, input.revision);
  const locations = input.locations
    .map((location) => normalizeLocation(normalizedContext, location))
    .sort(compareLocations);
  for (let index = 1; index < locations.length; index += 1) {
    if (compareLocations(locations[index - 1]!, locations[index]!) === 0) {
      fail("ir_record_invalid", "IR gap contains a duplicate source location.");
    }
  }
  if (locations.some((location) => location.revision !== revision)) {
    fail("ir_record_invalid", "IR gap locations must use its revision.");
  }
  const record: Omit<IrGap, "id"> = {
    revision,
    type: input.type,
    summary: normalizeText(input.summary, "Gap summary"),
    locations,
    evidenceIds: normalizeIds(input.evidenceIds),
    blockingRelevance: input.blockingRelevance,
  };
  return {
    id: stableId("gap", gapIdentity(normalizedContext, record)),
    ...record,
  };
}

function sortedRecords<T extends { id: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
}

function assertUniqueIds(
  collections: readonly (readonly { id: string }[])[],
): void {
  const ids = new Set<string>();
  for (const collection of collections) {
    for (const record of collection) {
      if (ids.has(record.id))
        fail("ir_duplicate_id", "Canonical IR contains a duplicate ID.");
      ids.add(record.id);
    }
  }
}

function assertSortedById(records: readonly { id: string }[]): void {
  for (let index = 1; index < records.length; index += 1) {
    if (compareCodePoints(records[index - 1]!.id, records[index]!.id) >= 0) {
      fail(
        "ir_record_invalid",
        "Canonical IR collection is not strictly sorted.",
      );
    }
  }
}

function assertCanonicalRecord(
  actual: { id: string },
  expected: { id: string },
): void {
  if (actual.id !== expected.id) {
    fail("ir_id_invalid", "Canonical IR ID does not match semantic identity.");
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("ir_record_invalid", "Canonical IR record is not normalized.");
  }
}

function assertEvidenceReferences(
  records: readonly { revision: string; evidenceIds: readonly string[] }[],
  evidenceById: ReadonlyMap<string, Evidence>,
): void {
  for (const record of records) {
    if (record.evidenceIds.length === 0)
      fail("ir_evidence_invalid", "IR record has no evidence reference.");
    for (const evidenceId of record.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence)
        fail("ir_reference_missing", "IR evidence reference does not resolve.");
      if (evidence.location.revision !== record.revision) {
        fail(
          "ir_evidence_invalid",
          "IR evidence reference uses a different revision than its record.",
        );
      }
    }
  }
}

function assertNonHeuristicEvidence(
  record: { evidenceIds: readonly string[] },
  evidenceById: ReadonlyMap<string, Evidence>,
  description: string,
): void {
  if (
    record.evidenceIds
      .map((id) => evidenceById.get(id))
      .every((evidence) => evidence?.kind === "heuristic")
  ) {
    fail(
      "ir_evidence_invalid",
      `${description} cannot rely only on heuristic evidence.`,
    );
  }
}

export function validateCanonicalIr(value: CanonicalIr): void {
  const context = normalizeContext(value);
  assertUniqueIds([
    value.evidence,
    value.files,
    value.symbols,
    value.contracts,
    value.relationships,
    value.tests,
    value.gaps,
  ]);
  for (const collection of [
    value.evidence,
    value.files,
    value.symbols,
    value.contracts,
    value.relationships,
    value.tests,
    value.gaps,
  ]) {
    assertSortedById(collection);
  }
  const evidenceById = new Map<string, Evidence>();
  for (const evidence of value.evidence) {
    try {
      validateEvidence(context, evidence);
    } catch (cause) {
      fail("ir_evidence_invalid", "Canonical IR evidence is invalid.", cause);
    }
    evidenceById.set(evidence.id, evidence);
  }
  const recordsWithEvidence = [
    ...value.files,
    ...value.symbols,
    ...value.contracts,
    ...value.relationships,
    ...value.tests,
    ...value.gaps,
  ];
  assertEvidenceReferences(recordsWithEvidence, evidenceById);
  const components = new Map<string, { revision: string; path?: string }>();
  const files = new Map<string, IrFile>();
  const fileLocations = new Set<string>();
  for (const file of value.files) {
    const recreated = createIrFile(context, {
      revision: file.revision,
      ...locationFields(file.location),
      ...(file.mediaType === undefined ? {} : { mediaType: file.mediaType }),
      evidenceIds: file.evidenceIds,
    });
    assertCanonicalRecord(file, recreated);
    assertNonHeuristicEvidence(file, evidenceById, "IR file");
    const key = `${file.revision}\0${file.location.path}`;
    if (fileLocations.has(key))
      fail(
        "ir_duplicate_id",
        "Canonical IR contains a duplicate file location.",
      );
    fileLocations.add(key);
    files.set(file.id, file);
    components.set(file.id, {
      revision: file.revision,
      path: file.location.path,
    });
  }
  for (const symbol of value.symbols) {
    const recreated = createIrSymbol(context, {
      revision: symbol.revision,
      ...locationFields(symbol.location),
      fileId: symbol.fileId,
      kind: symbol.kind,
      name: symbol.name,
      exported: symbol.exported,
      evidenceIds: symbol.evidenceIds,
    });
    assertCanonicalRecord(symbol, recreated);
    assertNonHeuristicEvidence(symbol, evidenceById, "IR symbol");
    const file = files.get(symbol.fileId);
    if (!file)
      fail(
        "ir_reference_missing",
        "IR symbol file reference does not resolve.",
      );
    if (
      file.revision !== symbol.revision ||
      file.location.path !== symbol.location.path
    ) {
      fail(
        "ir_record_invalid",
        "IR symbol and containing file use different locations.",
      );
    }
    components.set(symbol.id, {
      revision: symbol.revision,
      path: symbol.location.path,
    });
  }
  for (const contract of value.contracts) {
    const recreated = createIrContract(context, {
      revision: contract.revision,
      ...locationFields(contract.location),
      subjectId: contract.subjectId,
      kind: contract.kind,
      name: contract.name,
      fingerprint: contract.fingerprint,
      evidenceIds: contract.evidenceIds,
    });
    assertCanonicalRecord(contract, recreated);
    assertNonHeuristicEvidence(contract, evidenceById, "IR contract");
    const subject = components.get(contract.subjectId);
    if (!subject)
      fail("ir_reference_missing", "IR contract subject does not resolve.");
    if (subject.revision !== contract.revision) {
      fail("ir_record_invalid", "IR contract subject uses another revision.");
    }
    components.set(contract.id, {
      revision: contract.revision,
      path: contract.location.path,
    });
  }
  for (const test of value.tests) {
    const recreated = createIrTest(context, {
      revision: test.revision,
      ...locationFields(test.location),
      framework: test.framework,
      name: test.name,
      evidenceIds: test.evidenceIds,
    });
    assertCanonicalRecord(test, recreated);
    assertNonHeuristicEvidence(test, evidenceById, "IR test");
    components.set(test.id, {
      revision: test.revision,
      path: test.location.path,
    });
  }
  for (const relationship of value.relationships) {
    const recreated = createIrRelationship(context, relationship);
    assertCanonicalRecord(relationship, recreated);
    const from = components.get(relationship.fromId);
    const to = components.get(relationship.toId);
    if (!from || !to) {
      fail(
        "ir_reference_missing",
        "IR relationship endpoint does not resolve.",
      );
    }
    if (
      from.revision !== relationship.revision ||
      to.revision !== relationship.revision
    ) {
      fail("ir_record_invalid", "IR relationship crosses exact revisions.");
    }
    if (relationship.authority === "authoritative") {
      assertNonHeuristicEvidence(
        relationship,
        evidenceById,
        "Authoritative relationship",
      );
    }
  }
  for (const gap of value.gaps) {
    const recreated = createIrGap(context, {
      revision: gap.revision,
      type: gap.type,
      summary: gap.summary,
      locations: gap.locations.map((location) => ({
        revision: location.revision,
        ...locationFields(location),
      })),
      evidenceIds: gap.evidenceIds,
      blockingRelevance: gap.blockingRelevance,
    });
    assertCanonicalRecord(gap, recreated);
  }
}

export function createCanonicalIr(
  context: IrContext,
  records: CanonicalIrRecords,
): CanonicalIr {
  const normalizedContext = normalizeContext(context);
  const result: CanonicalIr = {
    ...normalizedContext,
    evidence: sortedRecords(records.evidence),
    files: sortedRecords(records.files),
    symbols: sortedRecords(records.symbols),
    contracts: sortedRecords(records.contracts),
    relationships: sortedRecords(records.relationships),
    tests: sortedRecords(records.tests),
    gaps: sortedRecords(records.gaps),
  };
  validateCanonicalIr(result);
  return result;
}
