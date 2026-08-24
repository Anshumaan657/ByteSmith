import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeOpenApiRevision,
  createOpenApiRuleDefinitions,
  runOpenApiAnalyzerComparison,
} from "../dist/index.js";

const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function withSnapshots(baseSource, headSource, run, extension = "yaml") {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-openapi-base-"));
  const head = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-openapi-head-"));
  try {
    await fs.writeFile(path.join(base, `openapi.${extension}`), baseSource);
    await fs.writeFile(path.join(head, `openapi.${extension}`), headSource);
    return await run(base, head);
  } finally {
    await Promise.all([
      fs.rm(base, { recursive: true, force: true }),
      fs.rm(head, { recursive: true, force: true }),
    ]);
  }
}

async function analyze(base, head) {
  return runOpenApiAnalyzerComparison({
    repositoryId: "repo.openapi-tests",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "5.0.0-test",
  });
}

function hasFinding(result, ruleId, text, compatibility = "breaking") {
  return result.rules.findings.some(
    (finding) =>
      finding.ruleId === ruleId &&
      finding.change.summary.includes(text) &&
      finding.change.compatibility === compatibility,
  );
}

test("OpenAPI discovery parses JSON/YAML 3.0 and 3.1 and resolves local schema references", async () => {
  const yaml = `
openapi: 3.1.0
info: { title: Orders, version: 1.0.0 }
paths:
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Order' }
      responses: { '204': { description: accepted } }
components:
  schemas:
    Order:
      type: object
      properties:
        id: { type: string }
`;
  await withSnapshots(yaml, yaml, async (base) => {
    const analysis = await analyzeOpenApiRevision("repo.openapi-discovery", {
      directory: base,
      revision: baseRevision,
    });
    assert.equal(analysis.documents[0].version, "3.1");
    assert.equal(analysis.operations.length, 1);
    assert.equal(
      analysis.operations[0].requestBody.content[0].schema.reference,
      "#/components/schemas/Order",
    );
    assert.equal(analysis.operations[0].requestBody.content[0].schema.type, "object");
  });

  const json = JSON.stringify({
    openapi: "3.0.3",
    info: { title: "JSON", version: "1" },
    paths: {},
  });
  await withSnapshots(json, json, async (base) => {
    const analysis = await analyzeOpenApiRevision("repo.openapi-json", {
      directory: base,
      revision: baseRevision,
    });
    assert.equal(analysis.documents[0].version, "3.0");
  }, "json");
});

test("route, method, parameter, request-body, field, type, requiredness, and enum rules execute together", async () => {
  const base = `
openapi: 3.1.0
info: { title: Rules, version: 1 }
paths:
  /legacy:
    get:
      responses: { '200': { description: ok } }
  /orders:
    get:
      responses: { '200': { description: ok } }
    post:
      requestBody:
        required: false
        content:
          application/json: { schema: { type: object } }
          application/xml: { schema: { type: object } }
      responses: { '204': { description: accepted } }
components:
  schemas:
    Order:
      type: object
      properties:
        amount: { type: integer }
        note: { type: string }
        removed: { type: string }
        status: { type: string, enum: [new, paid] }
`;
  const head = `
openapi: 3.1.0
info: { title: Rules, version: 2 }
paths:
  /orders:
    post:
      parameters:
        - { name: tenant, in: query, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json: { schema: { type: object } }
      responses: { '204': { description: accepted } }
components:
  schemas:
    Order:
      type: object
      required: [note, added]
      properties:
        amount: { type: string }
        note: { type: string }
        added: { type: boolean }
        status: { type: string, enum: [paid] }
`;
  await withSnapshots(base, head, async (baseDirectory, headDirectory) => {
    const result = await analyze(baseDirectory, headDirectory);
    assert.equal(result.rules.executions.length, 9);
    assert.equal(result.rules.status, "completed");
    assert.ok(hasFinding(result, "openapi.routes", "route /legacy"));
    assert.ok(hasFinding(result, "openapi.methods", "method GET"));
    assert.ok(hasFinding(result, "openapi.parameters", "required query parameter tenant"));
    assert.ok(hasFinding(result, "openapi.request-bodies", "made its request body required"));
    assert.ok(hasFinding(result, "openapi.request-bodies", "removed request media type application/xml"));
    assert.ok(hasFinding(result, "openapi.schema-fields", "Order.removed"));
    assert.ok(hasFinding(result, "openapi.schema-fields", "Order.added"));
    assert.ok(hasFinding(result, "openapi.schema-types", "Order.amount"));
    assert.ok(hasFinding(result, "openapi.schema-required", "Order.note"));
    assert.ok(hasFinding(result, "openapi.schema-enums", "removed enum value"));
    assert.ok(result.rules.findings.every((finding) => !finding.blockingEligible));
    assert.ok(result.rules.findings.every((finding) => finding.defaultMode === "advisory"));
  });
});

test("unsupported and external constructs become deterministic required unknowns", async () => {
  const source = `
openapi: 3.1.0
info: { title: Unsupported, version: 1 }
paths: {}
components:
  schemas:
    Remote: { $ref: 'https://example.invalid/schema.yaml#/Remote' }
    Choice: { oneOf: [{ type: string }, { type: integer }] }
`;
  await withSnapshots(source, source, async (base, head) => {
    const first = await analyze(base, head);
    const second = await analyze(base, head);
    assert.equal(first.rules.status, "incomplete");
    assert.ok(first.rules.unknowns.some((unknown) => unknown.summary.includes("External OpenAPI reference")));
    assert.ok(first.rules.unknowns.some((unknown) => unknown.summary.includes("keyword oneOf")));
    assert.deepEqual(first.rules.semanticDigest, second.rules.semanticDigest);
    assert.deepEqual(first.ir, second.ir);
  });
});

test("inline request and response payload schemas are compared as first-class contracts", async () => {
  const base = `
openapi: 3.1.0
info: { title: Inline, version: 1 }
paths:
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties: { quantity: { type: integer } }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties: { id: { type: string }, currency: { type: string } }
`;
  const head = base
    .replace("quantity: { type: integer }", "quantity: { type: string }")
    .replace(", currency: { type: string }", "");
  await withSnapshots(base, head, async (baseDirectory, headDirectory) => {
    const result = await analyze(baseDirectory, headDirectory);
    assert.ok(hasFinding(result, "openapi.schema-types", "request application/json.quantity"));
    assert.ok(hasFinding(result, "openapi.schema-fields", "response 200 application/json.currency"));
  });
});

test("OpenAPI rule inputs reject stale or reversed revision bindings", async () => {
  const source = "openapi: 3.1.0\ninfo: { title: Empty, version: 1 }\npaths: {}\n";
  await withSnapshots(source, source, async (base, head) => {
    const result = await analyze(base, head);
    await assert.rejects(
      () =>
        import("../dist/index.js").then(({ evaluateOpenApiContractRules }) =>
          evaluateOpenApiContractRules({
            ir: result.ir,
            baseAnalysis: result.headAnalysis,
            headAnalysis: result.baseAnalysis,
          }),
        ),
      /reversed or stale/u,
    );
  });
});

test("the OpenAPI ChangeBench contract fixtures achieve 100% preliminary precision", async () => {
  const cases = [
    ["openapi-request-field-changed", "CreateOrderRequest.quantity"],
    ["openapi-response-field-removed", "OrderResponse.currency"],
  ];
  let expected = 0;
  let matched = 0;
  let unexpected = 0;
  for (const [caseName, componentName] of cases) {
    const root = path.join(repositoryRoot, "changebench/fixtures", caseName);
    const result = await runOpenApiAnalyzerComparison({
      repositoryId: `repo.${caseName}`,
      base: { directory: path.join(root, "before"), revision: baseRevision },
      head: { directory: path.join(root, "after"), revision: headRevision },
      analyzerVersion: "5.0.0-changebench",
    });
    expected += 1;
    matched += result.rules.changes.filter(
      (change) =>
        change.kind === "schema" &&
        change.compatibility === "breaking" &&
        change.component.name === componentName,
    ).length;
    unexpected += result.rules.changes.filter(
      (change) => change.component.name !== componentName,
    ).length;
  }
  assert.equal(matched, expected);
  assert.equal(unexpected, 0);
  assert.equal(matched / (matched + unexpected), 1);
});

test("all OpenAPI rules are versioned, required, advisory-only, and non-blocking", () => {
  const definitions = createOpenApiRuleDefinitions();
  assert.equal(new Set(definitions.map((rule) => rule.id)).size, 9);
  assert.ok(definitions.every((rule) => rule.version === "1.0.0"));
  assert.ok(definitions.every((rule) => rule.required));
  assert.ok(definitions.every((rule) => rule.defaultMode === "advisory"));
  assert.ok(definitions.every((rule) => rule.blockingEligible === false));
});
