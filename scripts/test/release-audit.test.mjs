import assert from "node:assert/strict";
import test from "node:test";
import { createSchemaValidators } from "../lib/schema-validation.mjs";
import { createReleaseAudit } from "../lib/release-audit.mjs";

const root = new URL("../..", import.meta.url).pathname;

const profiles = [
  "ordinary-typescript",
  "monorepo",
  "api-backend",
  "openapi",
  "older-inconsistent",
];

function benchmark(overrides = {}) {
  return {
    passed: true,
    gates: {
      contractPrecision: true,
      directConsumerPrecision: true,
      testSelectionRecall: true,
      determinism: true,
      crashFree: true,
      smallPullRequestPerformance: true,
      memoryWithinBudget: true,
    },
    report: {
      metrics: {
        contractPrecision: 1,
        directConsumerPrecision: 1,
        testSelectionRecall: 1,
        determinismRate: 1,
        crashRate: 0,
        peakMemoryBytes: 1024,
      },
    },
    ...overrides,
  };
}

function portfolio(completed) {
  return {
    evaluations: profiles.map((profile) => ({
      profile,
      status: completed ? "completed" : "pending",
      repository: completed
        ? `example/${profile}`
        : "REPLACE_WITH_CONSENTED_REPOSITORY",
      reviewer: completed ? "reviewer" : "UNASSIGNED",
      useful: completed,
      observations: completed ? ["Verified a useful finding."] : [],
    })),
  };
}

function usability(completed) {
  return {
    evaluations: Array.from({ length: 5 }, (_, index) => ({
      id: `developer-${index + 1}`,
      status: completed ? "completed" : "pending",
      evaluator: completed ? `evaluator-${index + 1}` : "UNASSIGNED",
      withoutAssistance: completed ? true : null,
      usefulFinding: completed ? "Found an affected consumer." : null,
      observations: completed ? ["Completed without assistance."] : [],
    })),
  };
}

const input = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  revision: "a".repeat(40),
};

test("release audit fails closed while external evidence is pending", () => {
  const result = createReleaseAudit({
    ...input,
    benchmark: benchmark(),
    portfolio: portfolio(false),
    usability: usability(false),
  });
  assert.equal(result.conclusion.releaseReady, false);
  assert.equal(result.conclusion.code, "external_evidence_pending");
  assert.equal(result.externalEvidence.repositoryPortfolio.completed, 0);
  assert.equal(result.externalEvidence.usability.completed, 0);
});

test("release audit accepts only all automated and external gates", () => {
  const result = createReleaseAudit({
    ...input,
    benchmark: benchmark(),
    portfolio: portfolio(true),
    usability: usability(true),
  });
  assert.equal(result.conclusion.releaseReady, true);
  assert.equal(result.conclusion.code, "ready");
});

test("release audit output validates against its published schema", async () => {
  const { validators } = await createSchemaValidators(root);
  const result = createReleaseAudit({
    ...input,
    benchmark: benchmark(),
    portfolio: portfolio(false),
    usability: usability(false),
  });
  assert.equal(validators.releaseAudit(result), true);
});

test("release audit rejects a benchmark threshold regression", () => {
  const result = createReleaseAudit({
    ...input,
    benchmark: benchmark({
      report: {
        metrics: {
          contractPrecision: 0.94,
          directConsumerPrecision: 1,
          testSelectionRecall: 1,
          determinismRate: 1,
          crashRate: 0,
          peakMemoryBytes: 1024,
        },
      },
    }),
    portfolio: portfolio(true),
    usability: usability(true),
  });
  assert.equal(result.conclusion.releaseReady, false);
  assert.equal(result.conclusion.code, "automated_gates_failed");
});
