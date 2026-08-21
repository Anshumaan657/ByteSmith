import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalManifestJson,
  computeSemanticDigest,
  withSemanticDigest,
} from "../dist/index.js";

test("manifest canonicalization excludes runtime fields and sorts semantic sets", () => {
  const first = {
    manifestId: "manifest.one",
    generatedAt: "2026-08-22T10:00:00+05:30",
    status: {
      conclusion: "warn",
      reasons: [
        { code: "zeta", summary: "Z" },
        { code: "alpha", summary: "A" },
      ],
    },
    scope: {
      files: [
        { path: "src/z.ts", changeType: "modified", analyzerIds: ["z", "a"] },
        { path: "src/a.ts", changeType: "added", analyzerIds: [] },
      ],
    },
    analyzers: [
      { id: "z", version: "1", durationMs: 99 },
      { id: "a", version: "1", durationMs: 1 },
    ],
    integrity: { semanticDigest: { algorithm: "sha256", value: "runtime" } },
  };
  const second = structuredClone(first);
  second.manifestId = "manifest.two";
  second.generatedAt = "2030-01-01T00:00:00.000Z";
  second.status.reasons.reverse();
  second.scope.files.reverse();
  second.scope.files[1].analyzerIds.reverse();
  second.analyzers.reverse();
  second.analyzers[0].durationMs = 500;

  assert.equal(canonicalManifestJson(second), canonicalManifestJson(first));
  assert.equal(computeSemanticDigest(second), computeSemanticDigest(first));
});

test("manifest digest is idempotent and changes for semantic content", () => {
  const source = {
    manifestId: "manifest.one",
    generatedAt: "2026-08-22T00:00:00.000Z",
    status: { conclusion: "pass", reasons: [] },
  };
  const sealed = withSemanticDigest(source);
  const resealed = withSemanticDigest(sealed);
  assert.equal(
    resealed.integrity.semanticDigest.value,
    sealed.integrity.semanticDigest.value,
  );
  const changed = structuredClone(sealed);
  changed.status.conclusion = "warn";
  assert.notEqual(
    computeSemanticDigest(changed),
    computeSemanticDigest(sealed),
  );
});
