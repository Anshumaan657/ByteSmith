import assert from "node:assert/strict";
import test from "node:test";
import { deriveResult } from "../lib/result-states.mjs";
import { addFinding, makeBaseManifest } from "./helpers.mjs";

test("required analyzer error takes highest precedence", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "fail",
    mode: "blocking",
    blockingEligible: true
  });
  manifest.analyzers[0].status = "error";
  assert.equal(deriveResult(manifest).conclusion, "error");
});

test("required incomplete analysis cannot pass", () => {
  const manifest = makeBaseManifest();
  manifest.analyzers[0].status = "incomplete";
  assert.equal(deriveResult(manifest).conclusion, "incomplete");
});

test("required not_evaluated policy is incomplete", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "not_evaluated",
    required: true,
    ruleState: "suspended",
    suspensionId: "suspension.test"
  });
  manifest.policies[0].analysisGapIds = ["unknown.test"];
  assert.equal(deriveResult(manifest).conclusion, "incomplete");
});

test("eligible enabled active unwaived blocking violation fails", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "fail",
    mode: "blocking",
    blockingEligible: true
  });
  assert.equal(deriveResult(manifest).conclusion, "fail");
});

test("active waiver downgrades a blocking finding to warning", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "fail",
    mode: "blocking",
    blockingEligible: true
  });
  manifest.waivers.push({
    id: "waiver.test",
    findingId: "impact.consumer",
    reason: "Temporary migration.",
    actor: "user.owner",
    createdAt: "2026-08-18T07:00:00.000Z",
    startsAt: "2026-08-18T07:30:00.000Z",
    expiresAt: "2026-08-18T09:00:00.000Z",
    scope: "finding",
    status: "active",
    auditEventIds: ["audit.test"]
  });
  assert.equal(deriveResult(manifest).conclusion, "warn");
});

test("expired waiver does not suppress a still-applicable finding", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "fail",
    mode: "blocking",
    blockingEligible: true
  });
  manifest.waivers.push({
    id: "waiver.test",
    findingId: "impact.consumer",
    reason: "Expired migration window.",
    actor: "user.owner",
    createdAt: "2026-08-17T07:00:00.000Z",
    startsAt: "2026-08-17T07:30:00.000Z",
    expiresAt: "2026-08-17T09:00:00.000Z",
    scope: "finding",
    status: "expired",
    auditEventIds: ["audit.test"]
  });
  assert.equal(deriveResult(manifest).conclusion, "fail");
});

test("suspended rule cannot produce a clean pass", () => {
  const manifest = addFinding(makeBaseManifest(), {
    policyResult: "warn",
    ruleState: "suspended",
    suspensionId: "suspension.test"
  });
  assert.equal(deriveResult(manifest).conclusion, "warn");
});

test("empty successful analysis passes only within analyzed scope", () => {
  assert.equal(deriveResult(makeBaseManifest()).conclusion, "pass");
});
