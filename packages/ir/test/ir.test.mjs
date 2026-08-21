import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../canonicalization/dist/index.js";
import { createEvidence } from "../../evidence/dist/index.js";
import {
  createCanonicalIr,
  createIrContract,
  createIrFile,
  createIrGap,
  createIrRelationship,
  createIrSymbol,
  createIrTest,
  IrError,
  validateCanonicalIr,
} from "../dist/index.js";

const context = {
  repositoryId: "repo:demo",
  baseRevision: "a".repeat(40),
  headRevision: "b".repeat(40),
};
const evidenceContext = {
  ...context,
  producer: { id: "typescript", version: "1.0.0" },
};

function evidence(kind, path, summary) {
  return createEvidence(evidenceContext, {
    kind,
    revision: context.headRevision,
    path,
    startLine: 1,
    summary,
  });
}

function fixture() {
  const fileEvidence = evidence("syntax", "src/app.ts", "Parsed source file");
  const symbolEvidence = evidence(
    "type",
    "src/app.ts",
    "Resolved exported symbol",
  );
  const contractEvidence = evidence(
    "contract",
    "src/app.ts",
    "Derived public signature",
  );
  const relationEvidence = evidence(
    "call",
    "src/app.ts",
    "Resolved direct call",
  );
  const testEvidence = evidence(
    "syntax",
    "test/app.test.ts",
    "Discovered Vitest test",
  );
  const gapEvidence = evidence(
    "configuration",
    "src/app.ts",
    "Dynamic import encountered",
  );
  const file = createIrFile(context, {
    revision: context.headRevision,
    path: "src/app.ts",
    mediaType: "text/typescript",
    evidenceIds: [fileEvidence.id],
  });
  const symbol = createIrSymbol(context, {
    revision: context.headRevision,
    path: "src/app.ts",
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 20,
    fileId: file.id,
    kind: "function",
    name: "calculateTotal",
    exported: true,
    evidenceIds: [symbolEvidence.id],
  });
  const contract = createIrContract(context, {
    revision: context.headRevision,
    path: "src/app.ts",
    startLine: 1,
    subjectId: symbol.id,
    kind: "function_signature",
    name: "calculateTotal(number): number",
    fingerprint: "sha256:signature",
    evidenceIds: [contractEvidence.id],
  });
  const testRecord = createIrTest(context, {
    revision: context.headRevision,
    path: "test/app.test.ts",
    startLine: 1,
    framework: "vitest",
    name: "calculates a total",
    evidenceIds: [testEvidence.id],
  });
  const relationship = createIrRelationship(context, {
    revision: context.headRevision,
    kind: "tested_by",
    fromId: contract.id,
    toId: testRecord.id,
    authority: "authoritative",
    evidenceIds: [relationEvidence.id],
  });
  const gap = createIrGap(context, {
    revision: context.headRevision,
    type: "dynamic_import",
    summary: "Dynamic import target cannot be resolved statically.",
    locations: [
      { revision: context.headRevision, path: "src/app.ts", startLine: 8 },
    ],
    evidenceIds: [gapEvidence.id],
    blockingRelevance: "possible",
  });
  return {
    evidence: [
      fileEvidence,
      symbolEvidence,
      contractEvidence,
      relationEvidence,
      testEvidence,
      gapEvidence,
    ],
    files: [file],
    symbols: [symbol],
    contracts: [contract],
    relationships: [relationship],
    tests: [testRecord],
    gaps: [gap],
  };
}

test("canonical IR covers files, symbols, contracts, relationships, tests, and gaps", () => {
  const records = fixture();
  const ir = createCanonicalIr(context, records);
  assert.equal(ir.repositoryId, context.repositoryId);
  assert.equal(ir.files.length, 1);
  assert.equal(ir.symbols.length, 1);
  assert.equal(ir.contracts.length, 1);
  assert.equal(ir.relationships.length, 1);
  assert.equal(ir.tests.length, 1);
  assert.equal(ir.gaps.length, 1);
  assert.doesNotThrow(() => validateCanonicalIr(ir));
  for (const collection of [
    ir.evidence,
    ir.files,
    ir.symbols,
    ir.contracts,
    ir.relationships,
    ir.tests,
    ir.gaps,
  ]) {
    assert.deepEqual(
      collection.map((record) => record.id),
      collection.map((record) => record.id).sort(),
    );
  }
});

test("canonical IR is identical when semantic-set input order changes", () => {
  const records = fixture();
  const first = createCanonicalIr(context, records);
  const second = createCanonicalIr(context, {
    evidence: [...records.evidence].reverse(),
    files: [...records.files].reverse(),
    symbols: [...records.symbols].reverse(),
    contracts: [...records.contracts].reverse(),
    relationships: [...records.relationships].reverse(),
    tests: [...records.tests].reverse(),
    gaps: [...records.gaps].reverse(),
  });
  assert.equal(canonicalJson(second), canonicalJson(first));
});

test("factories reject out-of-comparison revisions and incomplete records", () => {
  const records = fixture();
  assert.throws(
    () =>
      createIrFile(context, {
        revision: "c".repeat(40),
        path: "src/app.ts",
        evidenceIds: [records.evidence[0].id],
      }),
    (error) => error instanceof IrError && error.code === "ir_record_invalid",
  );
  assert.throws(
    () =>
      createIrSymbol(context, {
        revision: context.headRevision,
        path: "src/app.ts",
        fileId: records.files[0].id,
        kind: "function",
        name: " ",
        exported: true,
        evidenceIds: [records.evidence[0].id],
      }),
    IrError,
  );
});

test("canonical IR rejects missing entity and evidence references", () => {
  const records = fixture();
  const missingFile = structuredClone(records);
  missingFile.symbols[0] = createIrSymbol(context, {
    revision: context.headRevision,
    path: "src/app.ts",
    fileId: "file:" + "0".repeat(64),
    kind: "function",
    name: "calculateTotal",
    exported: true,
    evidenceIds: [records.evidence[1].id],
  });
  assert.throws(
    () => createCanonicalIr(context, missingFile),
    (error) =>
      error instanceof IrError && error.code === "ir_reference_missing",
  );

  const missingEvidence = structuredClone(records);
  missingEvidence.files[0].evidenceIds = ["evidence:" + "0".repeat(64)];
  assert.throws(
    () => createCanonicalIr(context, missingEvidence),
    (error) =>
      error instanceof IrError && error.code === "ir_reference_missing",
  );
});

test("canonical IR rejects cross-revision evidence and relationships", () => {
  const records = fixture();
  const baseEvidence = createEvidence(evidenceContext, {
    kind: "syntax",
    revision: context.baseRevision,
    path: "src/app.ts",
    summary: "Base observation",
  });
  const mismatchedEvidence = structuredClone(records);
  mismatchedEvidence.evidence.push(baseEvidence);
  mismatchedEvidence.files[0].evidenceIds = [baseEvidence.id];
  assert.throws(
    () => createCanonicalIr(context, mismatchedEvidence),
    (error) => error instanceof IrError && error.code === "ir_evidence_invalid",
  );

  const baseFile = createIrFile(context, {
    revision: context.baseRevision,
    path: "src/base.ts",
    evidenceIds: [baseEvidence.id],
  });
  const crossRevision = structuredClone(records);
  crossRevision.evidence.push(baseEvidence);
  crossRevision.files.push(baseFile);
  crossRevision.relationships[0] = createIrRelationship(context, {
    revision: context.headRevision,
    kind: "references",
    fromId: records.symbols[0].id,
    toId: baseFile.id,
    authority: "authoritative",
    evidenceIds: [records.evidence[3].id],
  });
  assert.throws(
    () => createCanonicalIr(context, crossRevision),
    (error) => error instanceof IrError && error.code === "ir_record_invalid",
  );
});

test("heuristic evidence cannot independently authorize a relationship", () => {
  const records = fixture();
  const heuristic = createEvidence(evidenceContext, {
    kind: "heuristic",
    revision: context.headRevision,
    path: "src/app.ts",
    summary: "Similarity guess",
  });
  const unsafe = structuredClone(records);
  unsafe.evidence.push(heuristic);
  unsafe.relationships[0] = createIrRelationship(context, {
    ...unsafe.relationships[0],
    authority: "authoritative",
    evidenceIds: [heuristic.id],
  });
  assert.throws(
    () => createCanonicalIr(context, unsafe),
    (error) => error instanceof IrError && error.code === "ir_evidence_invalid",
  );

  const heuristicFile = structuredClone(records);
  heuristicFile.evidence.push(heuristic);
  heuristicFile.files[0] = createIrFile(context, {
    revision: context.headRevision,
    path: "src/app.ts",
    mediaType: "text/typescript",
    evidenceIds: [heuristic.id],
  });
  assert.throws(
    () => createCanonicalIr(context, heuristicFile),
    (error) => error instanceof IrError && error.code === "ir_evidence_invalid",
  );
});

test("external validation rejects tampered IDs, locations, and ordering", () => {
  const original = createCanonicalIr(context, fixture());
  const tamperedId = structuredClone(original);
  tamperedId.files[0].id = "file:" + "0".repeat(64);
  assert.throws(
    () => validateCanonicalIr(tamperedId),
    (error) => error instanceof IrError && error.code === "ir_id_invalid",
  );

  const tamperedRepository = structuredClone(original);
  tamperedRepository.files[0].location.repository = "repo:other";
  assert.throws(() => validateCanonicalIr(tamperedRepository), IrError);

  const unsorted = structuredClone(original);
  unsorted.evidence.reverse();
  assert.throws(
    () => validateCanonicalIr(unsorted),
    (error) => error instanceof IrError && error.code === "ir_record_invalid",
  );
});
