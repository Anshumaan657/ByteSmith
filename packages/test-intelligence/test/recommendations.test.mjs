import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeTypeScriptConsumers } from "../../consumer-analysis/dist/index.js";
import {
  evaluateTypeScriptCallableRules,
  runTypeScriptAnalyzerComparison,
} from "../../contracts-typescript/dist/index.js";
import {
  recommendTests,
  runTestDiscoveryComparison,
  TestDiscoveryError,
} from "../dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    typeof contents === "string"
      ? contents
      : `${JSON.stringify(contents, undefined, 2)}\n`,
  );
}

async function fixtureAnalysis(t, fixture, options = {}) {
  const base = await temporaryDirectory(t, `bytesmith-6e-${fixture}-base-`);
  const head = await temporaryDirectory(t, `bytesmith-6e-${fixture}-head-`);
  await Promise.all([
    fs.cp(
      path.join(repositoryRoot, "changebench/fixtures", fixture, "before"),
      base,
      { recursive: true },
    ),
    fs.cp(
      path.join(repositoryRoot, "changebench/fixtures", fixture, "after"),
      head,
      { recursive: true },
    ),
  ]);
  const packageManifest = {
    name: `fixture-${fixture}`,
    private: true,
    packageManager: "pnpm@11.19.0",
    ...(options.withCommand === false
      ? {}
      : { scripts: { test: "vitest run" } }),
    devDependencies: { vitest: "4.0.0" },
  };
  const configuration = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["**/*.ts"],
  };
  for (const root of [base, head]) {
    await write(root, "package.json", packageManifest);
    await write(root, "tsconfig.json", configuration);
    if (options.extraTest) {
      await write(root, options.extraTest.path, options.extraTest.source);
    }
  }
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: `repo.phase6e-${fixture}-${options.suffix ?? "default"}`,
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "6.0.0-test",
  });
  assert.ok(analyzed.snapshot);
  const rules = await evaluateTypeScriptCallableRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  });
  const consumers = analyzeTypeScriptConsumers({
    ir: analyzed.ir,
    changes: rules.changes,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
    analyzerVersion: "6.0.0-test",
  });
  const discovery = await runTestDiscoveryComparison({
    repositoryId: analyzed.ir.repositoryId,
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "6.0.0-test",
  });
  return { analyzed, consumers, discovery };
}

function recommendationInput(fixture, overrides = {}) {
  return {
    ir: fixture.analyzed.ir,
    testIr: fixture.discovery.ir,
    discovery: fixture.discovery.headDiscovery,
    consumers: fixture.consumers,
    analyzerVersion: "6.0.0-test",
    ...overrides,
  };
}

test("ranks the relevant ChangeBench test file using authoritative consumer evidence", async (t) => {
  const fixture = await fixtureAnalysis(t, "relevant-test-selected");
  const first = recommendTests(recommendationInput(fixture));
  const second = recommendTests(recommendationInput(fixture));
  assert.deepEqual(second, first);
  assert.equal(first.status, "completed");
  assert.equal(first.recommendations.length, 1);
  assert.equal(first.recommendations[0].test.name, "checkout total test");
  assert.match(first.recommendations[0].command, /checkout\.test\.ts/u);
  assert.match(first.recommendations[0].reason, /checkoutTotal/u);
  assert.equal(first.decisions[0].confidence, "verified");
  assert.ok(first.decisions[0].signals.includes("direct_reference"));
  assert.equal(first.gaps.length, 0);
  assert.ok(first.recommendations[0].evidenceIds.length >= 3);
});

test("reports one immutable not_found gap without claiming test absence", async (t) => {
  const fixture = await fixtureAnalysis(t, "affected-consumer-no-test");
  const result = recommendTests(recommendationInput(fixture));
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].gapKind, "not_found");
  assert.match(result.gaps[0].reason, /no test found/u);
  assert.doesNotMatch(result.gaps[0].reason, /no test exists/iu);
  assert.equal(result.gaps[0].affectedComponent.name, "notifyCustomer");
});

test("uses naming conventions only as explicit low-confidence fallback evidence", async (t) => {
  const fixture = await fixtureAnalysis(t, "affected-consumer-no-test", {
    suffix: "heuristic",
    extraTest: {
      path: "notification.test.ts",
      source: `test("notify customer behavior", () => {});\n`,
    },
  });
  const result = recommendTests(recommendationInput(fixture));
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.decisions[0].confidence, "low");
  assert.deepEqual(result.decisions[0].signals, [
    "directory_convention",
    "name_convention",
  ]);
  assert.match(result.recommendations[0].reason, /Low-confidence naming/u);
  assert.ok(result.evidence.some((item) => item.kind === "heuristic"));
});

test("a linked test without a repository-owned command produces a gap", async (t) => {
  const fixture = await fixtureAnalysis(t, "relevant-test-selected", {
    suffix: "no-command",
    withCommand: false,
  });
  const result = recommendTests(recommendationInput(fixture));
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.match(result.gaps[0].reason, /no test found/u);
  assert.ok(
    result.diagnostics.some((item) =>
      item.includes("no supported repository-owned runnable command"),
    ),
  );
});

test("bounded equal-ranked recommendations expose truncation", async (t) => {
  const fixture = await fixtureAnalysis(t, "relevant-test-selected", {
    suffix: "bounded",
    extraTest: {
      path: "checkout-copy.test.ts",
      source: `import { checkoutTotal } from "./checkout.js";\nvoid checkoutTotal(100);\n`,
    },
  });
  const result = recommendTests(
    recommendationInput(fixture, {
      limits: { maxRecommendationsPerComponent: 1 },
    }),
  );
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.status, "incomplete");
  assert.match(result.unknowns[0].summary, /1-recommendation limit/u);
});

test("recommendations reject stale revision bindings", async (t) => {
  const fixture = await fixtureAnalysis(t, "affected-consumer-no-test", {
    suffix: "stale",
  });
  assert.throws(
    () =>
      recommendTests(
        recommendationInput(fixture, {
          discovery: {
            ...fixture.discovery.headDiscovery,
            revision: baseRevision,
          },
        }),
      ),
    (error) =>
      error instanceof TestDiscoveryError &&
      error.code === "recommendation_binding_invalid",
  );
});
