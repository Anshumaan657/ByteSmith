import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSchemaValidators } from "../lib/schema-validation.mjs";
import { validateManifestSemantics } from "../lib/semantic-validation.mjs";
import { addFinding, makeBaseManifest, sealManifest } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { validators } = await createSchemaValidators(root);

test("a structurally and semantically valid manifest passes", () => {
  const manifest = sealManifest(addFinding(makeBaseManifest()));
  assert.equal(validators.manifest(manifest), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(manifest), []);
});

test("coverage arithmetic is checked beyond JSON Schema", () => {
  const manifest = sealManifest(addFinding(makeBaseManifest()));
  manifest.scope.coverage.totalChangedFiles = 2;
  const errors = validateManifestSemantics(manifest);
  assert.ok(errors.some((error) => error.code === "coverage-total"));
  assert.ok(errors.some((error) => error.code === "digest-mismatch"));
});

test("missing evidence references are rejected", () => {
  const manifest = sealManifest(addFinding(makeBaseManifest()));
  manifest.impacts[0].evidenceIds = ["evidence.missing"];
  const errors = validateManifestSemantics(manifest, { verifyDigest: false });
  assert.ok(errors.some((error) => error.code === "missing-reference"));
});

test("suspended safe execution retains its finding and warning", () => {
  let manifest = addFinding(makeBaseManifest(), {
    policyResult: "warn",
    ruleState: "suspended",
    suspensionId: "suspension.test"
  });
  manifest.auditEvents.push({
    id: "audit.suspension", entityType: "suspension", entityId: "suspension.test",
    action: "suspension.created", actor: "user.admin", occurredAt: "2026-08-18T07:00:00.000Z"
  });
  manifest.suspensions.push({
    id: "suspension.test",
    ruleId: "typescript.export-member-removed",
    ruleVersion: "1.0.0",
    scope: "repository",
    status: "active",
    repositoryId: "repo.bytesmith",
    reason: "Regression under investigation.",
    actor: "user.admin",
    createdAt: "2026-08-18T07:00:00.000Z",
    reinstatementCriteria: "Regression fixture passes in a released analyzer.",
    evidenceIds: ["evidence.api"],
    auditEventIds: ["audit.suspension"]
  });
  manifest = sealManifest(manifest);
  assert.equal(manifest.status.conclusion, "warn");
  assert.equal(validators.manifest(manifest), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(manifest), []);
});

test("unsafe required suspended execution requires a gap and derives incomplete", () => {
  let manifest = addFinding(makeBaseManifest(), {
    policyResult: "not_evaluated",
    required: true,
    ruleState: "suspended",
    suspensionId: "suspension.test"
  });
  manifest.unknowns.push({
    id: "unknown.unsafe",
    type: "analyzer_gap",
    summary: "Rule execution is unsafe for this repository shape.",
    locations: [],
    evidenceIds: [],
    blockingRelevance: "required"
  });
  manifest.policies[0].analysisGapIds = ["unknown.unsafe"];
  manifest.auditEvents.push({
    id: "audit.suspension", entityType: "suspension", entityId: "suspension.test",
    action: "suspension.created", actor: "user.admin", occurredAt: "2026-08-18T07:00:00.000Z"
  });
  manifest.suspensions.push({
    id: "suspension.test",
    ruleId: "typescript.export-member-removed",
    ruleVersion: "1.0.0",
    scope: "repository",
    status: "active",
    repositoryId: "repo.bytesmith",
    reason: "Unsafe execution path.",
    actor: "user.admin",
    createdAt: "2026-08-18T07:00:00.000Z",
    reinstatementCriteria: "Safe execution is restored.",
    evidenceIds: ["evidence.api"],
    auditEventIds: ["audit.suspension"]
  });
  manifest = sealManifest(manifest);
  assert.equal(manifest.status.conclusion, "incomplete");
  assert.equal(validators.manifest(manifest), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(manifest), []);
});

test("repository suspension identity cannot silently widen", () => {
  let manifest = addFinding(makeBaseManifest(), {
    policyResult: "warn",
    ruleState: "suspended",
    suspensionId: "suspension.test"
  });
  manifest.auditEvents.push({
    id: "audit.suspension", entityType: "suspension", entityId: "suspension.test",
    action: "suspension.created", actor: "user.admin", occurredAt: "2026-08-18T07:00:00.000Z"
  });
  manifest.suspensions.push({
    id: "suspension.test", ruleId: "typescript.export-member-removed", ruleVersion: "1.0.0",
    scope: "repository", status: "active", repositoryId: "repo.other",
    reason: "Repository-specific regression.", actor: "user.admin",
    createdAt: "2026-08-18T07:00:00.000Z", reinstatementCriteria: "Fix verified.",
    evidenceIds: ["evidence.api"], auditEventIds: ["audit.suspension"]
  });
  manifest = sealManifest(manifest);
  const errors = validateManifestSemantics(manifest);
  assert.ok(errors.some((error) => error.code === "suspension-repository"));
});
