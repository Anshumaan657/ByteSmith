import assert from "node:assert/strict";
import test from "node:test";
import { withSemanticDigest } from "../../../packages/canonicalization/dist/index.js";
import {
  parseArguments,
  manifestProjection,
  renderManifest,
  runBenchmark,
} from "../dist/index.js";
import { makeBaseManifest } from "../../../scripts/test/helpers.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("CLI parsing requires explicit comparisons and manifests", () => {
  assert.throws(() => parseArguments([]), /a command is required/u);
  assert.throws(
    () => parseArguments(["analyze", "--base", "main"]),
    /explicit --base and --head/u,
  );
  assert.throws(() => parseArguments(["contracts"]), /explicit --manifest/u);
  assert.throws(
    () => parseArguments(["benchmark", "--repeat", "0"]),
    /positive integer/u,
  );
  assert.deepEqual(
    parseArguments([
      "benchmark",
      "--case",
      "a",
      "--case",
      "b",
      "--repeat",
      "3",
      "--format",
      "json",
      "--no-color",
    ]),
    {
      command: "benchmark",
      repository: process.cwd(),
      cases: ["a", "b"],
      repeat: 3,
      format: "json",
      noColor: true,
      noCache: false,
    },
  );
});

test("focused terminal and JSON reports expose contracts and tests", () => {
  const source = makeBaseManifest();
  source.changes.push({
    id: "change.one",
    kind: "contract",
    summary: "An exported parameter became required.",
    compatibility: "breaking",
    component: { id: "symbol.one", kind: "symbol", name: "checkout" },
    evidenceIds: [],
  });
  source.impacts.push({
    id: "impact.one",
    ruleId: "typescript.direct-consumer",
    ruleVersion: "1.0.0",
    category: "direct",
    severity: "high",
    confidence: "verified",
    summary: "submitOrder calls checkout.",
    sourceChangeIds: ["change.one"],
    affectedComponents: [
      { id: "symbol.two", kind: "symbol", name: "submitOrder" },
    ],
    evidenceIds: [],
  });
  source.tests.recommended.push({
    id: "test.one",
    test: {
      id: "test.symbol",
      kind: "test",
      name: "submit order",
      location: {
        repository: "repo.bytesmith",
        revision: "head0002",
        path: "checkout.test.ts",
        startLine: 1,
        endLine: 1,
      },
    },
    command: "pnpm vitest run checkout.test.ts",
    reason: "Covers submitOrder.",
    evidenceIds: [],
  });
  const manifest = withSemanticDigest(source);
  const contracts = renderManifest(manifest, "contracts", false);
  const tests = renderManifest(manifest, "test-plan", false);
  assert.match(contracts, /Contract changes/u);
  assert.match(contracts, /checkout/u);
  assert.match(contracts, /submitOrder/u);
  assert.match(tests, /pnpm vitest run checkout\.test\.ts/u);
  assert.equal(tests.includes("\u001b["), false);
  assert.equal(manifestProjection(manifest, "contracts").changes.length, 1);
  assert.equal(
    manifestProjection(manifest, "test-plan").tests.recommended.length,
    1,
  );
});

test("benchmark orchestration measures deterministic selected cases and quality gates", async () => {
  const result = await runBenchmark({
    fixturesDirectory: path.join(repositoryRoot, "changebench", "fixtures"),
    schemaDirectory: path.join(repositoryRoot, "schemas"),
    cases: ["unexpected-result-rejected"],
    repeat: 2,
    executor: ({ caseDefinition }) => ({
      conclusion: caseDefinition.expected.conclusion,
      coverage: caseDefinition.expected.coverage,
      changes: [],
      impacts: [],
      tests: [],
      unknowns: [],
      policies: [],
      waivers: [],
    }),
  });
  assert.equal(result.report.metrics.passed, 1);
  assert.equal(result.report.metrics.determinismRate, 1);
  assert.deepEqual(result.gates, {
    contractPrecision: true,
    directConsumerPrecision: true,
    testSelectionRecall: true,
    determinism: true,
    crashFree: true,
    smallPullRequestPerformance: true,
    memoryWithinBudget: true,
  });
  assert.equal(result.passed, true);
});
