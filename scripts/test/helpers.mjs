import { withSemanticDigest } from "../lib/canonicalization.mjs";
import { deriveResult } from "../lib/result-states.mjs";

export const fixedTime = "2026-08-18T08:00:00.000Z";

export function makeBaseManifest() {
  return {
    schemaVersion: "1.0.0",
    manifestId: "manifest.test",
    generatedAt: fixedTime,
    engine: {
      name: "ByteSmith",
      version: "0.0.0-phase0",
      ruleSetVersion: "0.0.0-phase0"
    },
    repository: {
      id: "repo.bytesmith",
      organizationId: "org.bytesmith",
      name: "ByteSmith",
      vcs: "git",
      remote: "https://github.com/Anshumaan657/ByteSmith"
    },
    comparison: {
      baseRevision: "base0001",
      headRevision: "head0002",
      mergeBaseRevision: "base0001",
      pullRequestId: "repo.bytesmith#1"
    },
    configurationDigest: {
      algorithm: "sha256",
      value: "0".repeat(64)
    },
    status: { conclusion: "pass", reasons: [] },
    scope: {
      files: [],
      coverage: {
        totalChangedFiles: 0,
        analyzed: 0,
        partiallyAnalyzed: 0,
        unsupported: 0,
        intentionallyExcluded: 0
      }
    },
    analyzers: [
      {
        id: "analyzer.typescript",
        version: "0.0.0-phase0",
        required: true,
        status: "completed",
        durationMs: 7,
        diagnostics: []
      }
    ],
    evidence: [],
    changes: [],
    impacts: [],
    tests: { recommended: [], gaps: [] },
    unknowns: [],
    policies: [],
    dispositions: [],
    appeals: [],
    waivers: [],
    suspensions: [],
    auditEvents: [],
    integrity: {
      canonicalization: "bytesmith-c14n-1",
      semanticDigest: { algorithm: "sha256", value: "0".repeat(64) }
    }
  };
}

export function addFinding(manifest, {
  policyResult = "warn",
  mode = "advisory",
  enabled = true,
  blockingEligible = false,
  ruleState = "active",
  required = false,
  suspensionId
} = {}) {
  const result = structuredClone(manifest);
  result.scope.files = [
    {
      path: "src/api.ts",
      changeType: "modified",
      coverageClass: "analyzed",
      analyzerIds: ["analyzer.typescript"]
    }
  ];
  result.scope.coverage = {
    totalChangedFiles: 1,
    analyzed: 1,
    partiallyAnalyzed: 0,
    unsupported: 0,
    intentionallyExcluded: 0
  };
  result.evidence.push({
    id: "evidence.api",
    kind: "contract",
    producer: { id: "analyzer.typescript", version: "0.0.0-phase0" },
    location: {
      repository: "repo.bytesmith",
      revision: "head0002",
      path: "src/api.ts",
      startLine: 1,
      endLine: 1
    },
    summary: "Exported field was removed."
  });
  result.changes.push({
    id: "change.api-field",
    kind: "contract",
    summary: "Exported field was removed.",
    compatibility: "breaking",
    component: { id: "symbol.Api.field", kind: "symbol", name: "Api.field" },
    evidenceIds: ["evidence.api"]
  });
  result.impacts.push({
    id: "impact.consumer",
    ruleId: "typescript.export-member-removed",
    ruleVersion: "1.0.0",
    category: "contract",
    severity: "high",
    confidence: "verified",
    summary: "Consumer reads the removed field.",
    sourceChangeIds: ["change.api-field"],
    affectedComponents: [
      { id: "symbol.consumer", kind: "symbol", name: "consumer" }
    ],
    evidenceIds: ["evidence.api"]
  });
  result.policies.push({
    id: "policy.export-member",
    ruleId: "typescript.export-member-removed",
    ruleVersion: "1.0.0",
    required,
    mode,
    enabled,
    blockingEligible,
    ruleState,
    ...(suspensionId ? { suspensionId } : {}),
    result: policyResult,
    findingIds: policyResult === "not_evaluated" ? [] : ["impact.consumer"],
    analysisGapIds: []
  });
  return result;
}

export function sealManifest(manifest) {
  const result = structuredClone(manifest);
  result.status = deriveResult(result);
  return withSemanticDigest(result);
}
