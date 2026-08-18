import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  activateWaiver,
  adjudicateAppeal,
  createAppeal,
  createWaiver,
  evaluateFinding,
  expireWaiver,
  startAppealReview
} from "../lib/lifecycle.mjs";
import { createSchemaValidators } from "../lib/schema-validation.mjs";
import { validateManifestSemantics } from "../lib/semantic-validation.mjs";
import { addFinding, makeBaseManifest, sealManifest } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { validators } = await createSchemaValidators(root);

test("appeal reaches terminal outcome with audit history and immutable finding", () => {
  let manifest = addFinding(makeBaseManifest());
  const originalFinding = structuredClone(manifest.impacts[0]);

  const created = createAppeal({
    id: "appeal.test", findingId: "impact.consumer", actor: "user.author",
    reason: "The consumer no longer reads this contract.",
    occurredAt: "2026-08-18T06:00:00.000Z", eventId: "audit.appeal-created"
  });
  const review = startAppealReview(created.appeal, {
    actor: "user.reviewer", occurredAt: "2026-08-18T06:30:00.000Z", eventId: "audit.appeal-review"
  });
  const terminal = adjudicateAppeal(review.appeal, {
    outcome: "rejected", actor: "user.reviewer", rationale: "Deterministic reference evidence confirms consumption.",
    occurredAt: "2026-08-18T07:00:00.000Z", eventId: "audit.appeal-terminal"
  });

  manifest.appeals = [terminal.appeal];
  manifest.auditEvents = [created.auditEvent, review.auditEvent, terminal.auditEvent];
  manifest.dispositions = [{
    id: "disposition.appealed", findingId: "impact.consumer", type: "appealed",
    actor: "user.author", reason: "Appeal recorded separately.", createdAt: "2026-08-18T06:00:00.000Z",
    sourceId: "appeal.test", auditEventIds: ["audit.disposition"]
  }];
  manifest.auditEvents.push({
    id: "audit.disposition", entityType: "disposition", entityId: "disposition.appealed",
    action: "disposition.created", actor: "user.author", occurredAt: "2026-08-18T06:00:00.000Z"
  });
  manifest = sealManifest(manifest);

  assert.deepEqual(manifest.impacts[0], originalFinding);
  assert.equal(terminal.appeal.status, "terminal");
  assert.equal(terminal.appeal.outcome, "rejected");
  assert.equal(validators.manifest(manifest), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(manifest), []);
});

test("temporary waiver activates, expires, and reactivates the finding", () => {
  let manifest = addFinding(makeBaseManifest(), {
    policyResult: "fail", mode: "blocking", blockingEligible: true
  });
  const originalFinding = structuredClone(manifest.impacts[0]);
  const created = createWaiver({
    id: "waiver.test", findingId: "impact.consumer", actor: "user.owner",
    reason: "Temporary migration window.", createdAt: "2026-08-18T06:00:00.000Z",
    startsAt: "2026-08-18T07:00:00.000Z", expiresAt: "2026-08-18T09:00:00.000Z",
    scope: "pull_request", pullRequestId: "repo.bytesmith#1", eventId: "audit.waiver-created"
  });
  const activated = activateWaiver(created.waiver, {
    actor: "user.owner", occurredAt: "2026-08-18T07:00:00.000Z", eventId: "audit.waiver-active"
  });

  manifest.waivers = [activated.waiver];
  manifest.auditEvents = [created.auditEvent, activated.auditEvent];
  manifest = sealManifest(manifest);
  assert.equal(manifest.status.conclusion, "warn");
  assert.equal(evaluateFinding("impact.consumer", manifest.waivers, manifest.generatedAt).active, false);
  assert.deepEqual(manifest.impacts[0], originalFinding);
  assert.equal(validators.manifest(manifest), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(manifest), []);

  const expired = expireWaiver(activated.waiver, {
    actor: "system.clock", occurredAt: "2026-08-18T09:00:00.000Z", eventId: "audit.waiver-expired"
  });
  let reevaluated = structuredClone(manifest);
  reevaluated.manifestId = "manifest.re-evaluated";
  reevaluated.generatedAt = "2026-08-18T09:00:01.000Z";
  reevaluated.waivers = [expired.waiver];
  reevaluated.auditEvents.push(expired.auditEvent);
  reevaluated = sealManifest(reevaluated);

  assert.equal(evaluateFinding("impact.consumer", reevaluated.waivers, reevaluated.generatedAt).active, true);
  assert.equal(reevaluated.status.conclusion, "fail");
  assert.deepEqual(reevaluated.impacts[0], originalFinding);
  assert.equal(validators.manifest(reevaluated), true, JSON.stringify(validators.manifest.errors));
  assert.deepEqual(validateManifestSemantics(reevaluated), []);
});
