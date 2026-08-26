import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runOpenApiAnalyzerComparison } from "../../contracts-openapi/dist/index.js";
import {
  evaluateTypeScriptCallableRules,
  runTypeScriptAnalyzerComparison,
} from "../../contracts-typescript/dist/index.js";
import {
  evaluatePhase6Quality,
  runPhase6OpenApiIntegration,
  runPhase6TypeScriptIntegration,
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

async function openApiIntegrationInput(t) {
  const base = await temporaryDirectory(t, "bytesmith-6f-openapi-base-");
  const head = await temporaryDirectory(t, "bytesmith-6f-openapi-head-");
  const before = `
openapi: 3.1.0
info: { title: Orders, version: 1 }
paths:
  /orders:
    post:
      requestBody:
        content:
          application/json: { schema: { $ref: '#/components/schemas/CreateOrder' } }
      responses: { '204': { description: accepted } }
components:
  schemas:
    CreateOrder:
      type: object
      properties: { quantity: { type: integer } }
`;
  const after = before.replace("type: integer", "type: string");
  for (const [root, specification] of [
    [base, before],
    [head, after],
  ]) {
    await write(root, "openapi.yaml", specification);
    await write(root, "package.json", {
      name: "fixture-openapi",
      private: true,
      packageManager: "pnpm@11.19.0",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "4.0.0" },
    });
    await write(root, "tsconfig.json", {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["**/*.ts"],
    });
    await write(
      root,
      "client.ts",
      'declare const api: { post(path: string, body: unknown): Promise<unknown> };\nexport async function submitOrder(body: unknown) { return api.post("/orders", body); }\n',
    );
    await write(
      root,
      "client.test.ts",
      'import { submitOrder } from "./client.js";\ntest("submit order contract", async () => { await submitOrder({ quantity: 2 }); });\n',
    );
  }
  const snapshots = {
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
  };
  const [contract, linkage] = await Promise.all([
    runOpenApiAnalyzerComparison({
      repositoryId: "repo.phase6f-openapi",
      ...snapshots,
      analyzerVersion: "6.0.0-test",
    }),
    runTypeScriptAnalyzerComparison({
      repositoryId: "repo.phase6f-openapi",
      ...snapshots,
      analyzerVersion: "6.0.0-test",
    }),
  ]);
  return {
    contractIr: contract.ir,
    linkageIr: linkage.ir,
    changes: contract.rules.changes,
    baseAnalysis: contract.baseAnalysis,
    headAnalysis: contract.headAnalysis,
    ...snapshots,
    analyzerVersion: "6.0.0-test",
  };
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

async function integrationInput(t, fixture) {
  const base = await temporaryDirectory(t, `bytesmith-6f-${fixture}-base-`);
  const head = await temporaryDirectory(t, `bytesmith-6f-${fixture}-head-`);
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
  for (const root of [base, head]) {
    await write(root, "package.json", {
      name: `fixture-${fixture}`,
      private: true,
      packageManager: "pnpm@11.19.0",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "4.0.0" },
    });
    await write(root, "tsconfig.json", {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["**/*.ts"],
    });
  }
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: `repo.phase6f-${fixture}`,
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
  return {
    ir: analyzed.ir,
    changes: rules.changes,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "6.0.0-test",
  };
}

function evidenceIsClosed(result) {
  const available = new Set(result.evidence.map((item) => item.id));
  const referenced = [
    ...result.paths.flatMap((item) => item.evidenceIds),
    ...result.impacts.flatMap((item) => item.evidenceIds),
    ...result.recommendations.flatMap((item) => item.evidenceIds),
    ...result.testGaps.flatMap((item) => item.evidenceIds),
    ...result.unknowns.flatMap((item) => item.evidenceIds),
  ];
  return referenced.every((id) => available.has(id));
}

test("Phase 6F selects the exact affected consumer and relevant test deterministically", async (t) => {
  const input = await integrationInput(t, "relevant-test-selected");
  const first = await runPhase6TypeScriptIntegration(input);
  const second = await runPhase6TypeScriptIntegration(input);

  assert.equal(first.family, "typescript");
  assert.equal(first.status, "completed");
  assert.deepEqual(
    first.impacts.map((impact) => impact.affectedComponents[0].name),
    ["checkoutTotal"],
  );
  assert.equal(first.impacts[0].category, "direct");
  assert.equal(first.recommendations.length, 1);
  assert.equal(first.recommendations[0].test.name, "checkout total test");
  assert.match(first.recommendations[0].command, /checkout\.test\.ts/u);
  assert.match(first.recommendations[0].reason, /checkoutTotal/u);
  assert.equal(first.testGaps.length, 0);
  assert.equal(first.semanticDigest.value, second.semanticDigest.value);
  assert.ok(first.runtime.durationMs >= 0);
  assert.equal(evidenceIsClosed(first), true);
});

test("Phase 6F reports an explicit gap without claiming that no test exists", async (t) => {
  const input = await integrationInput(t, "affected-consumer-no-test");
  const result = await runPhase6TypeScriptIntegration(input);

  assert.deepEqual(
    result.impacts.map((impact) => impact.affectedComponents[0].name),
    ["notifyCustomer"],
  );
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.testGaps.length, 1);
  assert.equal(result.testGaps[0].affectedComponent.name, "notifyCustomer");
  assert.match(result.testGaps[0].reason, /no test found/u);
  assert.doesNotMatch(result.testGaps[0].reason, /no test exists/iu);
  assert.equal(evidenceIsClosed(result), true);
});

test("Phase 6F excludes unrelated consumers and preserves transitive classification", async (t) => {
  const unrelatedInput = await integrationInput(
    t,
    "unrelated-consumer-forbidden",
  );
  const unrelated = await runPhase6TypeScriptIntegration(unrelatedInput);
  assert.ok(
    unrelated.impacts.some(
      (impact) => impact.affectedComponents[0].name === "checkoutTotal",
    ),
  );
  assert.equal(
    unrelated.impacts.some(
      (impact) => impact.affectedComponents[0].name === "renderAdminDashboard",
    ),
    false,
  );

  const transitiveInput = await integrationInput(
    t,
    "transitive-consumer-affected",
  );
  const transitive = await runPhase6TypeScriptIntegration(transitiveInput);
  assert.equal(transitive.impacts.length, 1);
  assert.equal(
    transitive.impacts[0].affectedComponents[0].name,
    "renderProfile",
  );
  assert.equal(transitive.impacts[0].category, "transitive");
});

test("Phase 6F links an OpenAPI contract change to its client test", async (t) => {
  const input = await openApiIntegrationInput(t);
  const first = await runPhase6OpenApiIntegration(input);
  const second = await runPhase6OpenApiIntegration(input);

  assert.equal(first.family, "openapi");
  assert.deepEqual(
    first.impacts.map((impact) => impact.affectedComponents[0].name),
    ["submitOrder"],
  );
  assert.equal(first.recommendations.length, 1);
  assert.equal(first.recommendations[0].test.name, "submit order contract");
  assert.match(first.recommendations[0].command, /client\.test\.ts/u);
  assert.equal(first.semanticDigest.value, second.semanticDigest.value);
  assert.equal(evidenceIsClosed(first), true);
});

test("Phase 6F quality gates enforce precision, recall, determinism, and forbidden results", async (t) => {
  const relevantInput = await integrationInput(t, "relevant-test-selected");
  const gapInput = await integrationInput(t, "affected-consumer-no-test");
  const [relevant, relevantRepeat, gap, gapRepeat] = await Promise.all([
    runPhase6TypeScriptIntegration(relevantInput),
    runPhase6TypeScriptIntegration(relevantInput),
    runPhase6TypeScriptIntegration(gapInput),
    runPhase6TypeScriptIntegration(gapInput),
  ]);
  const metrics = evaluatePhase6Quality([
    {
      id: "relevant-test-selected",
      result: relevant,
      repeatResult: relevantRepeat,
      requiredConsumers: [{ name: "checkoutTotal", category: "direct" }],
      forbiddenConsumers: [{ name: "renderAdminDashboard" }],
      requiredTests: [
        {
          name: "checkout total test",
          commandContains: "checkout.test.ts",
          reasonContains: "checkoutTotal",
        },
      ],
      forbiddenTests: [{ name: "admin dashboard test" }],
    },
    {
      id: "affected-consumer-no-test",
      result: gap,
      repeatResult: gapRepeat,
      requiredConsumers: [{ name: "notifyCustomer", category: "direct" }],
      requiredTests: [],
      requiredGapComponents: ["notifyCustomer"],
    },
  ]);

  assert.equal(metrics.directConsumerPrecision, 1);
  assert.equal(metrics.testSelectionRecall, 1);
  assert.equal(metrics.deterministicRate, 1);
  assert.deepEqual(metrics.gates, {
    directConsumerPrecision: true,
    testSelectionRecall: true,
    determinism: true,
    forbiddenResults: true,
  });
  assert.equal(metrics.passedCases, 2);
  assert.equal(metrics.passed, true);

  const missingExpectation = evaluatePhase6Quality([
    {
      id: "missing-required-gap",
      result: relevant,
      repeatResult: relevantRepeat,
      requiredConsumers: [{ name: "checkoutTotal", category: "direct" }],
      requiredTests: [{ name: "checkout total test" }],
      requiredGapComponents: ["checkoutTotal"],
    },
  ]);
  assert.equal(missingExpectation.passedCases, 0);
  assert.equal(missingExpectation.passed, false);
});

test("Phase 6F rejects stale revision bindings", async (t) => {
  const input = await integrationInput(t, "direct-consumer-affected");
  await assert.rejects(
    runPhase6TypeScriptIntegration({
      ...input,
      head: { ...input.head, revision: baseRevision },
    }),
    (error) =>
      error instanceof TestDiscoveryError &&
      error.code === "recommendation_binding_invalid",
  );
});

test("Phase 6F completes a representative repository comparison within its development budget", async (t) => {
  const input = await integrationInput(t, "relevant-test-selected");
  const result = await runPhase6TypeScriptIntegration(input);
  assert.ok(result.runtime.durationMs < 20_000);
});
