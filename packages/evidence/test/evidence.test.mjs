import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvidence,
  createEvidenceCollection,
  createEvidenceContext,
  createSourceLocation,
  EvidenceError,
  validateEvidence,
} from "../dist/index.js";

const context = {
  repositoryId: "repo:demo",
  baseRevision: "a".repeat(40),
  headRevision: "b".repeat(40),
  producer: { id: "typescript", version: "1.0.0" },
};

const input = {
  kind: "syntax",
  revision: context.headRevision,
  path: "src/app.ts",
  startLine: 2,
  startColumn: 3,
  endLine: 2,
  endColumn: 12,
  summary: "Exported function declaration",
};

test("evidence is deterministic, revision-bound, normalized, and self-validating", () => {
  const first = createEvidence(context, input);
  const second = createEvidence(context, input);
  assert.deepEqual(second, first);
  assert.match(first.id, /^evidence:[a-f0-9]{64}$/u);
  assert.deepEqual(first.location, {
    repository: context.repositoryId,
    revision: context.headRevision,
    path: input.path,
    startLine: 2,
    startColumn: 3,
    endLine: 2,
    endColumn: 12,
  });
  assert.doesNotThrow(() => validateEvidence(context, first));

  const decomposed = createEvidence(context, {
    ...input,
    path: "src/cafe\u0301.ts",
    summary: "Cafe\u0301 declaration",
  });
  assert.equal(decomposed.location.path, "src/café.ts");
  assert.equal(decomposed.summary, "Café declaration");
});

test("evidence identity changes with producer, location, kind, or summary", () => {
  const original = createEvidence(context, input);
  const variants = [
    createEvidence(
      { ...context, producer: { id: "typescript", version: "2" } },
      input,
    ),
    createEvidence(context, { ...input, startLine: 3, endLine: 3 }),
    createEvidence(context, { ...input, kind: "type" }),
    createEvidence(context, { ...input, summary: "Different observation" }),
  ];
  for (const variant of variants) assert.notEqual(variant.id, original.id);
});

test("evidence collection is sorted and rejects duplicate semantic records", () => {
  const collection = createEvidenceCollection(context, [
    { ...input, path: "src/z.ts" },
    { ...input, path: "src/a.ts" },
  ]);
  assert.deepEqual(
    collection.records.map((record) => record.id),
    collection.records.map((record) => record.id).sort(),
  );
  assert.throws(
    () => createEvidenceCollection(context, [input, input]),
    (error) =>
      error instanceof EvidenceError && error.code === "evidence_duplicate_id",
  );
});

test("invalid revisions, paths, coordinates, and contexts fail closed", () => {
  const invalidOperations = [
    () => createEvidenceContext({ ...context, repositoryId: "bad id" }),
    () => createEvidence(context, { ...input, revision: "c".repeat(40) }),
    () => createEvidence(context, { ...input, path: "../escape.ts" }),
    () => createEvidence(context, { ...input, startLine: 0 }),
    () => createEvidence(context, { ...input, startLine: 5, endLine: 4 }),
    () =>
      createEvidence(context, {
        ...input,
        startLine: undefined,
        startColumn: 1,
      }),
  ];
  for (const operation of invalidOperations) {
    assert.throws(operation, EvidenceError);
  }
});

test("external evidence validation rejects tampering and repository mismatch", () => {
  const evidence = createEvidence(context, input);
  const tampered = [
    { ...evidence, summary: "Changed without changing the ID" },
    {
      ...evidence,
      location: { ...evidence.location, repository: "repo:other" },
    },
    { ...evidence, summary: "Cafe\u0301 declaration" },
  ];
  for (const record of tampered) {
    assert.throws(() => validateEvidence(context, record), EvidenceError);
  }
});

test("source locations accept only selected exact revisions", () => {
  assert.deepEqual(
    createSourceLocation(context, {
      revision: context.baseRevision,
      path: "src/base.ts",
    }),
    {
      repository: context.repositoryId,
      revision: context.baseRevision,
      path: "src/base.ts",
    },
  );
});
