import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeOpenApiConsumers,
  analyzeTypeScriptConsumers,
  combineConsumerAnalysisResults,
} from "../dist/index.js";
import {
  runOpenApiAnalyzerComparison,
} from "../../contracts-openapi/dist/index.js";
import {
  discoverTypeScriptProjects,
  evaluateTypeScriptCallableRules,
  runTypeScriptAnalyzerComparison,
} from "../../contracts-typescript/dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);

async function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function typescriptFixture(t, fixture) {
  const base = await temporaryDirectory(t, `bytesmith-consumer-${fixture}-base-`);
  const head = await temporaryDirectory(t, `bytesmith-consumer-${fixture}-head-`);
  await Promise.all([
    fs.cp(path.join(repositoryRoot, "changebench/fixtures", fixture, "before"), base, { recursive: true }),
    fs.cp(path.join(repositoryRoot, "changebench/fixtures", fixture, "after"), head, { recursive: true }),
  ]);
  const configuration = `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["**/*.ts"],
  }, undefined, 2)}\n`;
  await Promise.all([
    write(base, "tsconfig.json", configuration),
    write(head, "tsconfig.json", configuration),
  ]);
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: `repo.consumer-${fixture}`,
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
  return { base, head, analyzed, rules };
}

test("Phase 6A reports the exact direct ChangeBench consumer and excludes unrelated symbols", async (t) => {
  const direct = await typescriptFixture(t, "direct-consumer-affected");
  const first = analyzeTypeScriptConsumers({
    ir: direct.analyzed.ir,
    changes: direct.rules.changes,
    baseAnalysis: direct.analyzed.snapshot.baseAnalysis,
    headAnalysis: direct.analyzed.snapshot.headAnalysis,
    symbolAnalysis: direct.analyzed.snapshot.symbolAnalysis,
    analyzerVersion: "6.0.0-test",
  });
  const second = analyzeTypeScriptConsumers({
    ir: direct.analyzed.ir,
    changes: direct.rules.changes,
    baseAnalysis: direct.analyzed.snapshot.baseAnalysis,
    headAnalysis: direct.analyzed.snapshot.headAnalysis,
    symbolAnalysis: direct.analyzed.snapshot.symbolAnalysis,
    analyzerVersion: "6.0.0-test",
  });
  assert.deepEqual(second, first);
  assert.equal(first.impacts.length, 1);
  assert.equal(first.impacts[0].ruleId, "typescript.direct-consumer");
  assert.equal(first.impacts[0].affectedComponents[0].name, "checkoutTotal");
  assert.equal(first.impacts[0].confidence, "verified");

  const unrelated = await typescriptFixture(t, "unrelated-consumer-forbidden");
  const result = analyzeTypeScriptConsumers({
    ir: unrelated.analyzed.ir,
    changes: unrelated.rules.changes,
    baseAnalysis: unrelated.analyzed.snapshot.baseAnalysis,
    headAnalysis: unrelated.analyzed.snapshot.headAnalysis,
    symbolAnalysis: unrelated.analyzed.snapshot.symbolAnalysis,
  });
  assert.ok(result.impacts.some((impact) => impact.affectedComponents[0].name === "checkoutTotal"));
  assert.equal(result.impacts.some((impact) => impact.affectedComponents[0].name === "renderAdminDashboard"), false);
});

test("Phase 6C reports the outer transitive consumer with a complete deterministic path", async (t) => {
  const fixture = await typescriptFixture(t, "transitive-consumer-affected");
  const result = analyzeTypeScriptConsumers({
    ir: fixture.analyzed.ir,
    changes: fixture.rules.changes,
    baseAnalysis: fixture.analyzed.snapshot.baseAnalysis,
    headAnalysis: fixture.analyzed.snapshot.headAnalysis,
    symbolAnalysis: fixture.analyzed.snapshot.symbolAnalysis,
  });
  assert.equal(result.impacts.length, 1);
  assert.equal(result.impacts[0].ruleId, "typescript.transitive-consumer");
  assert.equal(result.impacts[0].affectedComponents[0].name, "renderProfile");
  const pathRecord = result.paths.find(
    (candidate) => candidate.affectedComponentId === result.impacts[0].affectedComponents[0].id,
  );
  assert.equal(pathRecord.depth, 2);
  assert.equal(pathRecord.edges.length, 2);
  assert.ok(pathRecord.evidenceIds.length >= 2);

  const bounded = analyzeTypeScriptConsumers({
    ir: fixture.analyzed.ir,
    changes: fixture.rules.changes,
    baseAnalysis: fixture.analyzed.snapshot.baseAnalysis,
    headAnalysis: fixture.analyzed.snapshot.headAnalysis,
    symbolAnalysis: fixture.analyzed.snapshot.symbolAnalysis,
    limits: { maxDepth: 1 },
  });
  assert.equal(bounded.status, "incomplete");
  assert.ok(bounded.unknowns.some((unknown) => unknown.summary.includes("1-depth limit")));
});

test("Phase 6B reports a cross-workspace package dependency", async (t) => {
  const base = await temporaryDirectory(t, "bytesmith-workspace-consumer-base-");
  const head = await temporaryDirectory(t, "bytesmith-workspace-consumer-head-");
  const rootManifest = `${JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }, undefined, 2)}\n`;
  const baseConfig = `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      baseUrl: ".",
      paths: { "@fixture/contracts": ["packages/contracts/src/index.ts"] },
    },
  }, undefined, 2)}\n`;
  for (const root of [base, head]) {
    await write(root, "package.json", rootManifest);
    await write(root, "tsconfig.base.json", baseConfig);
    await write(root, "packages/contracts/package.json", '{"name":"@fixture/contracts"}\n');
    await write(root, "packages/contracts/tsconfig.json", '{"extends":"../../tsconfig.base.json","include":["src/**/*.ts"]}\n');
    await write(root, "packages/app/package.json", '{"name":"@fixture/app"}\n');
    await write(root, "packages/app/tsconfig.json", '{"extends":"../../tsconfig.base.json","include":["src/**/*.ts"]}\n');
    await write(root, "packages/app/src/index.ts", 'import { price } from "@fixture/contracts";\nexport const checkout = (): number => price(2);\n');
  }
  await write(base, "packages/contracts/src/index.ts", "export const price = (quantity: number, rate: number): number => quantity * rate;\n");
  await write(head, "packages/contracts/src/index.ts", "export const price = (quantity: number): number => quantity * 2;\n");
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: "repo.workspace-consumer",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
  });
  assert.ok(analyzed.snapshot);
  const rules = await evaluateTypeScriptCallableRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  });
  const discovery = await discoverTypeScriptProjects({
    repositoryRoot: head,
    repositoryId: "repo.workspace-consumer",
  });
  const result = analyzeTypeScriptConsumers({
    ir: analyzed.ir,
    changes: rules.changes,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
    headDiscovery: discovery,
  });
  assert.ok(
    result.impacts.some(
      (impact) =>
        impact.ruleId === "typescript.workspace-dependent" &&
        impact.affectedComponents[0].name === "@fixture/app",
    ),
  );
});

test("Phase 6B links static OpenAPI clients and exposes dynamic endpoints", async (t) => {
  const base = await temporaryDirectory(t, "bytesmith-openapi-consumer-base-");
  const head = await temporaryDirectory(t, "bytesmith-openapi-consumer-head-");
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
  for (const [root, specification] of [[base, before], [head, after]]) {
    await write(root, "openapi.yaml", specification);
    await write(root, "client.ts", 'export async function submitOrder(body: unknown) { return api.post("/orders", body); }\n');
  }
  const analyzed = await runOpenApiAnalyzerComparison({
    repositoryId: "repo.openapi-consumer",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
  });
  const result = await analyzeOpenApiConsumers({
    ir: analyzed.ir,
    changes: analyzed.rules.changes,
    baseAnalysis: analyzed.baseAnalysis,
    headAnalysis: analyzed.headAnalysis,
    headDirectory: head,
  });
  assert.equal(result.impacts.length, 1);
  assert.equal(result.impacts[0].ruleId, "openapi.direct-consumer");
  assert.equal(result.impacts[0].affectedComponents[0].name, "submitOrder");
  assert.equal(result.generatedEvidence.length, 1);

  await write(head, "dynamic.ts", "export const load = (endpoint: string) => fetch(endpoint);\n");
  const dynamic = await analyzeOpenApiConsumers({
    ir: analyzed.ir,
    changes: analyzed.rules.changes,
    baseAnalysis: analyzed.baseAnalysis,
    headAnalysis: analyzed.headAnalysis,
    headDirectory: head,
  });
  assert.equal(dynamic.status, "incomplete");
  assert.ok(dynamic.unknowns.some((unknown) => unknown.summary.includes("dynamic OpenAPI-like")));

  const combined = combineConsumerAnalysisResults([result, dynamic]);
  assert.deepEqual(combined.families, ["openapi"]);
});

test("consumer analysis rejects mismatched exact revisions", async (t) => {
  const fixture = await typescriptFixture(t, "direct-consumer-affected");
  const stale = structuredClone(fixture.analyzed.snapshot.symbolAnalysis);
  stale.headRevision = "c".repeat(40);
  assert.throws(
    () =>
      analyzeTypeScriptConsumers({
        ir: fixture.analyzed.ir,
        changes: fixture.rules.changes,
        baseAnalysis: fixture.analyzed.snapshot.baseAnalysis,
        headAnalysis: fixture.analyzed.snapshot.headAnalysis,
        symbolAnalysis: stale,
      }),
    /different exact comparison/u,
  );
});
