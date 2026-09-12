import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  calculateMetrics,
  canonicalizeSemanticOutput,
  compareChangeBenchBaseline,
  evaluateChangeBenchCase,
  loadChangeBenchCases,
  materializeChangeBenchCase,
  runChangeBench,
  semanticDigest,
  validateMvpCoverage,
  writeChangeBenchReport,
} from "../dist/index.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function loadCases() {
  return loadChangeBenchCases({
    fixturesDirectory: path.join(root, "changebench", "fixtures"),
    schemaDirectory: path.join(root, "schemas"),
  });
}

function emptyActual(coverage) {
  return {
    conclusion: "pass",
    coverage,
    changes: [],
    impacts: [],
    tests: [],
    unknowns: [],
    policies: [],
    waivers: [],
  };
}

test("fixture discovery is sorted, schema-valid, and covers each MVP behavior exactly once", async () => {
  const cases = await loadCases();
  assert.ok(cases.length >= 20);
  assert.deepEqual(
    cases.map((item) => item.definition.id),
    cases.map((item) => item.definition.id).toSorted(),
  );
  assert.doesNotThrow(() => validateMvpCoverage(cases));
});

test("materialization copies immutable snapshots into an isolated temporary root", async () => {
  const fixture = (await loadCases()).find(
    (item) => item.definition.id === "safe-internal-change",
  );
  assert.ok(fixture);
  const materialized = await materializeChangeBenchCase(fixture);
  try {
    assert.notEqual(materialized.beforeDirectory, fixture.beforeDirectory);
    await fs.writeFile(
      path.join(materialized.beforeDirectory, "only-in-copy.txt"),
      "copy",
      "utf8",
    );
    await assert.rejects(
      fs.access(path.join(fixture.beforeDirectory, "only-in-copy.txt")),
    );
  } finally {
    await materialized.cleanup();
  }
  await assert.rejects(fs.access(materialized.rootDirectory));
});

test("structured matcher diagnostics count missing, forbidden, and unexpected findings", async () => {
  const loaded = (await loadCases()).find(
    (item) => item.definition.id === "safe-internal-change",
  );
  assert.ok(loaded);
  const actual = emptyActual(loaded.definition.expected.coverage);
  actual.changes.push({
    id: "change.breaking",
    kind: "symbol",
    compatibility: "breaking",
    summary: "Wrong result",
    component: { id: "symbol.other", kind: "symbol", name: "other" },
  });
  const result = evaluateChangeBenchCase(loaded.definition, actual);
  assert.equal(result.passed, false);
  assert.equal(result.groups.changes.missing, 1);
  assert.equal(result.groups.changes.forbiddenMatched, 1);
  assert.equal(result.groups.changes.unexpected, 1);
  assert.equal(result.falsePositiveCount, 1);
});

test("matcher accepts the frozen Impact Manifest result shape", async () => {
  const loaded = (await loadCases()).find(
    (item) => item.definition.id === "unexpected-result-rejected",
  );
  assert.ok(loaded);
  const result = evaluateChangeBenchCase(loaded.definition, {
    status: { conclusion: "pass" },
    scope: {
      coverage: {
        intentionallyExcluded: 0,
        unsupported: 0,
        partiallyAnalyzed: 0,
        analyzed: 1,
        totalChangedFiles: 1,
      },
    },
    changes: [],
    impacts: [],
    tests: { recommended: [], gaps: [] },
    unknowns: [],
    policies: [],
    waivers: [],
  });
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("semantic digest ignores only frozen runtime fields and semantic-set ordering", () => {
  const left = {
    manifestId: "manifest.one",
    generatedAt: "2026-08-20T10:00:00Z",
    status: {
      conclusion: "warn",
      reasons: [
        { code: "b", summary: "B" },
        { code: "a", summary: "A" },
      ],
    },
    analyzers: [{ id: "typescript", version: "1", durationMs: 10 }],
    changes: [{ id: "change.b" }, { id: "change.a" }],
    integrity: { semanticDigest: "runtime" },
  };
  const right = {
    manifestId: "manifest.two",
    generatedAt: "2026-08-20T11:00:00Z",
    status: {
      conclusion: "warn",
      reasons: [
        { code: "a", summary: "A" },
        { code: "b", summary: "B" },
      ],
    },
    analyzers: [{ id: "typescript", version: "1", durationMs: 999 }],
    changes: [{ id: "change.a" }, { id: "change.b" }],
    integrity: { semanticDigest: "different" },
  };
  assert.equal(semanticDigest(left), semanticDigest(right));
  assert.equal(
    semanticDigest({
      occurredAt: "2026-08-20T15:30:00+05:30",
      path: ".\\src\\value.ts",
    }),
    semanticDigest({
      occurredAt: "2026-08-20T10:00:00.000Z",
      path: "src/value.ts",
    }),
  );
  right.status.conclusion = "fail";
  assert.notEqual(semanticDigest(left), semanticDigest(right));
  assert.equal(
    canonicalizeSemanticOutput(JSON.parse(canonicalizeSemanticOutput(left))),
    canonicalizeSemanticOutput(left),
  );
});

test("runner repeats execution, reports deterministic results, metrics, and segments", async () => {
  const fixture = (await loadCases()).find(
    (item) => item.definition.id === "unexpected-result-rejected",
  );
  assert.ok(fixture);
  const report = await runChangeBench({
    cases: [fixture],
    repeat: 3,
    executor: ({ caseDefinition, runIndex }) => ({
      ...emptyActual(caseDefinition.expected.coverage),
      generatedAt: `runtime-${runIndex}`,
    }),
  });
  assert.equal(report.cases[0].passed, true);
  assert.equal(report.cases[0].deterministic, true);
  assert.equal(report.metrics.determinismRate, 1);
  assert.equal(report.metrics.crashRate, 0);
  assert.equal(report.metrics.contractPrecision, 1);
  assert.equal(report.metrics.directConsumerPrecision, 1);
  assert.equal(report.segments.byTag["mvp-20"].cases, 1);
  assert.equal(report.segments.byCapability["changebench.matcher"].cases, 1);
});

test("runner detects semantic nondeterminism and converts executor exceptions into crash metrics", async () => {
  const fixture = (await loadCases()).find(
    (item) => item.definition.id === "unexpected-result-rejected",
  );
  assert.ok(fixture);
  const nondeterministic = await runChangeBench({
    cases: [fixture],
    repeat: 2,
    executor: ({ caseDefinition, runIndex }) => ({
      ...emptyActual(caseDefinition.expected.coverage),
      changes: runIndex === 0 ? [] : [{ id: "change.drift", kind: "symbol" }],
    }),
  });
  assert.equal(nondeterministic.cases[0].deterministic, false);
  assert.equal(nondeterministic.cases[0].passed, false);

  const crashed = await runChangeBench({
    cases: [fixture],
    executor: () => {
      throw new Error("injected analyzer crash");
    },
  });
  assert.equal(crashed.metrics.crashed, 1);
  assert.equal(crashed.metrics.crashRate, 1);
  assert.match(crashed.cases[0].error, /injected analyzer crash/u);
});

test("report baselines ignore durations but reject semantic regressions", async () => {
  const result = {
    id: "case",
    title: "Case",
    tags: ["typescript"],
    capabilities: ["typescript.exports"],
    passed: true,
    crashed: false,
    deterministic: true,
    durationMs: 10,
  };
  const metrics = calculateMetrics([result]);
  const report = {
    schemaVersion: "1.0.0",
    suite: { cases: 1, repeat: 2 },
    metrics,
    segments: {
      byTag: { typescript: metrics },
      byCapability: { "typescript.exports": metrics },
    },
    cases: [result],
  };
  const current = structuredClone(report);
  current.metrics.durationMs = 999;
  current.cases[0].durationMs = 999;
  current.segments.byTag.typescript.durationMs = 999;
  current.segments.byCapability["typescript.exports"].durationMs = 999;
  assert.deepEqual(compareChangeBenchBaseline(report, current), {
    matched: true,
  });
  current.cases[0].passed = false;
  assert.equal(compareChangeBenchBaseline(report, current).matched, false);

  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-report-"),
  );
  try {
    const filePath = path.join(directory, "report.json");
    await writeChangeBenchReport(filePath, report);
    assert.equal(
      JSON.parse(await fs.readFile(filePath, "utf8")).schemaVersion,
      "1.0.0",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
