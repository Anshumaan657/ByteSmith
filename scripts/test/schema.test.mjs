import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSchemaValidators } from "../lib/schema-validation.mjs";
import { addFinding, makeBaseManifest, sealManifest } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { validators } = await createSchemaValidators(root);

test("all ChangeBench fixtures validate against Draft 2020-12", async () => {
  const directory = path.join(root, "changebench", "fixtures");
  const fixtureIds = await fs.readdir(directory);
  assert.ok(fixtureIds.length >= 8);
  for (const fixtureId of fixtureIds) {
    const data = JSON.parse(await fs.readFile(path.join(directory, fixtureId, "case.json"), "utf8"));
    assert.equal(validators.changebenchCase(data), true, `${fixtureId}: ${JSON.stringify(validators.changebenchCase.errors)}`);
  }
});

test("allowUnexpected is mandatory and true requires a rationale", () => {
  const fixture = {
    schemaVersion: "1.0.0",
    id: "schema-contract",
    title: "Schema contract",
    snapshots: { before: "before", after: "after" },
    capabilities: ["schema"],
    expected: {
      conclusion: "pass",
      coverage: { totalChangedFiles: 0, analyzed: 0, partiallyAnalyzed: 0, unsupported: 0, intentionallyExcluded: 0 },
      requiredChanges: [], forbiddenChanges: [], requiredImpacts: [], forbiddenImpacts: [],
      requiredTests: [], forbiddenTests: [], requiredUnknowns: [], forbiddenUnknowns: [],
      requiredPolicies: [], forbiddenPolicies: [], requiredWaivers: []
    }
  };
  assert.equal(validators.changebenchCase(fixture), false);
  fixture.expected.allowUnexpected = true;
  assert.equal(validators.changebenchCase(fixture), false);
  fixture.unexpectedRationale = "The fixture exercises an intentionally open analyzer frontier.";
  assert.equal(validators.changebenchCase(fixture), true);
});

test("waiver scope fields are conditionally enforced", () => {
  const manifest = addFinding(makeBaseManifest(), { policyResult: "warn" });
  const common = {
    id: "waiver.test",
    findingId: "impact.consumer",
    reason: "Temporary migration window.",
    actor: "user.owner",
    createdAt: "2026-08-18T07:00:00.000Z",
    startsAt: "2026-08-18T07:30:00.000Z",
    expiresAt: "2026-08-18T09:00:00.000Z",
    status: "active",
    auditEventIds: ["audit.waiver-created"]
  };
  manifest.auditEvents.push({
    id: "audit.waiver-created", entityType: "waiver", entityId: "waiver.test",
    action: "waiver.created", actor: "user.owner", occurredAt: "2026-08-18T07:00:00.000Z"
  });

  const validScopes = [
    { ...common, scope: "finding" },
    { ...common, scope: "pull_request", pullRequestId: "repo.bytesmith#1" },
    { ...common, scope: "repository", repositoryId: "repo.bytesmith", selector: { ruleId: "typescript.export-member-removed" } },
    {
      ...common,
      scope: "organization",
      organizationId: "org.bytesmith",
      selector: { subjectId: "symbol.consumer" },
      approval: { actor: "user.admin", authority: "elevated", approvedAt: "2026-08-18T07:15:00.000Z" }
    }
  ];
  for (const waiver of validScopes) {
    const candidate = structuredClone(manifest);
    candidate.waivers = [waiver];
    assert.equal(validators.manifest(sealManifest(candidate)), true, JSON.stringify(validators.manifest.errors));
  }

  const invalidRepository = { ...common, scope: "repository", repositoryId: "repo.bytesmith" };
  const candidate = structuredClone(manifest);
  candidate.waivers = [invalidRepository];
  assert.equal(validators.manifest(sealManifest(candidate)), false);
});
