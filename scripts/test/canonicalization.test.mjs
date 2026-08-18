import assert from "node:assert/strict";
import test from "node:test";
import { canonicalBytes, computeSemanticDigest, withSemanticDigest } from "../lib/canonicalization.mjs";
import { addFinding, makeBaseManifest, sealManifest } from "./helpers.mjs";

test("runtime fields do not alter semantic digest", () => {
  const first = sealManifest(addFinding(makeBaseManifest()));
  const second = structuredClone(first);
  second.manifestId = "manifest.other-run";
  second.generatedAt = "2026-08-18T08:00:00Z";
  second.analyzers[0].durationMs = 9999;
  second.integrity.signature = "runtime-signature";
  second.integrity.keyId = "key.test";
  assert.equal(computeSemanticDigest(first), computeSemanticDigest(second));
});

test("semantic-set ordering does not alter digest", () => {
  const first = addFinding(makeBaseManifest());
  first.status.reasons = [
    { code: "z-reason", summary: "Last" },
    { code: "a-reason", summary: "First" }
  ];
  const second = structuredClone(first);
  second.status.reasons.reverse();
  assert.equal(computeSemanticDigest(first), computeSemanticDigest(second));
});

test("conclusion-relevant changes alter digest", () => {
  const manifest = sealManifest(addFinding(makeBaseManifest()));
  const changed = structuredClone(manifest);
  changed.impacts[0].severity = "critical";
  assert.notEqual(computeSemanticDigest(manifest), computeSemanticDigest(changed));
});

test("canonicalization is idempotent and stored digest verifies", () => {
  const manifest = sealManifest(addFinding(makeBaseManifest()));
  assert.deepEqual(canonicalBytes(manifest), canonicalBytes(JSON.parse(canonicalBytes(manifest).toString("utf8"))));
  assert.equal(manifest.integrity.semanticDigest.value, computeSemanticDigest(manifest));
  assert.deepEqual(withSemanticDigest(manifest), manifest);
});
