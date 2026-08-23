import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateCanonicalIr } from "../../ir/dist/index.js";
import { runTypeScriptAnalyzerComparison } from "../dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);

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

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fixturePair(t, prefix = "bytesmith-pipeline-") {
  const base = await temporaryDirectory(t, `${prefix}base-`);
  const head = await temporaryDirectory(t, `${prefix}head-`);
  const configuration = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  };
  for (const root of [base, head]) {
    await write(root, "package.json", {
      name: "@fixture/pipeline",
      exports: { ".": "./src/index.ts" },
    });
    await write(root, "tsconfig.json", configuration);
  }
  await write(
    base,
    "src/service.ts",
    "export function calculate(value: number): number { return value + 1; }\n",
  );
  await write(
    head,
    "src/service.ts",
    "export function calculate(value: string): string { return `${value}!`; }\n",
  );
  for (const root of [base, head]) {
    await write(
      root,
      "src/index.ts",
      [
        'import { calculate } from "./service.js";',
        "export { calculate };",
        'export function execute(): string { return String(calculate("1")); }',
        "",
      ].join("\n"),
    );
  }
  // Keep the base valid while preserving a contract-only change.
  await write(
    base,
    "src/index.ts",
    [
      'import { calculate } from "./service.js";',
      "export { calculate };",
      "export function execute(): string { return String(calculate(1)); }",
      "",
    ].join("\n"),
  );
  return { base, head };
}

function options(pair, repositoryId = "repo.typescript-pipeline") {
  return {
    repositoryId,
    base: { directory: pair.base, revision: baseRevision },
    head: { directory: pair.head, revision: headRevision },
    analyzerVersion: "4.0.0-test",
  };
}

test("clean analyzer execution produces deterministic revision-bound canonical IR", async (t) => {
  const pair = await fixturePair(t);
  const first = await runTypeScriptAnalyzerComparison(options(pair));
  const second = await runTypeScriptAnalyzerComparison(options(pair));

  assert.equal(first.status, "completed");
  assert.equal(first.execution, "clean");
  assert.ok(first.snapshot);
  assert.ok(first.ir.files.length >= 6);
  assert.ok(first.ir.symbols.some((symbol) => symbol.name === "calculate"));
  assert.ok(
    first.ir.contracts.some((contract) => contract.kind === "package_export"),
  );
  assert.ok(
    first.ir.relationships.some(
      (relationship) => relationship.kind === "calls",
    ),
  );
  assert.deepEqual(first.ir.gaps, []);
  assert.deepEqual(first.semanticDigest, second.semanticDigest);
  assert.equal(first.canonicalIr, second.canonicalIr);
  assert.equal(first.canonicalIr.includes(pair.base), false);
  assert.equal(first.canonicalIr.includes(pair.head), false);
  assert.deepEqual(first.manifestProjection.evidence, first.ir.evidence);
  assert.deepEqual(first.manifestProjection.unknowns, []);
  validateCanonicalIr(first.ir);
});

test("an exact verified snapshot is reused and stale or corrupted seeds run clean", async (t) => {
  const pair = await fixturePair(t, "bytesmith-incremental-");
  const clean = await runTypeScriptAnalyzerComparison(options(pair));
  assert.ok(clean.snapshot);

  const incremental = await runTypeScriptAnalyzerComparison({
    ...options(pair),
    incrementalSeed: clean.snapshot,
  });
  assert.equal(incremental.execution, "incremental");
  assert.deepEqual(incremental.semanticDigest, clean.semanticDigest);
  assert.equal(incremental.canonicalIr, clean.canonicalIr);

  const corrupted = structuredClone(clean.snapshot);
  corrupted.semanticDigest.value = "0".repeat(64);
  const recovered = await runTypeScriptAnalyzerComparison({
    ...options(pair),
    incrementalSeed: corrupted,
  });
  assert.equal(recovered.execution, "clean");
  assert.ok(recovered.diagnostics.some((value) => value.includes("rejected")));

  await write(pair.head, "notes.txt", "snapshot mutation\n");
  const stale = await runTypeScriptAnalyzerComparison({
    ...options(pair),
    incrementalSeed: clean.snapshot,
  });
  assert.equal(stale.execution, "clean");
});

test("resource limits and timeouts fail closed with a required analyzer unknown", async (t) => {
  const pair = await fixturePair(t, "bytesmith-contained-");
  const limited = await runTypeScriptAnalyzerComparison({
    ...options(pair, "repo.typescript-limit"),
    limits: { maxSymbols: 1 },
  });
  assert.equal(limited.status, "incomplete");
  assert.equal(limited.failureKind, "limit_exceeded");
  assert.equal(limited.snapshot, undefined);
  assert.equal(limited.ir.gaps.length, 1);
  assert.equal(limited.ir.gaps[0].type, "analyzer_gap");
  assert.equal(limited.ir.gaps[0].blockingRelevance, "required");
  assert.equal(limited.manifestProjection.analyzer.required, true);
  assert.equal(limited.manifestProjection.analyzer.status, "incomplete");

  const timedOut = await runTypeScriptAnalyzerComparison({
    ...options(pair, "repo.typescript-timeout"),
    limits: { timeoutMs: 1 },
  });
  assert.equal(timedOut.status, "error");
  assert.equal(timedOut.failureKind, "timeout");
  assert.equal(timedOut.ir.gaps[0].blockingRelevance, "required");
  assert.equal(timedOut.manifestProjection.analyzer.status, "error");
});

test("invalid analyzer identities are rejected and unreadable snapshots fail closed", async (t) => {
  const pair = await fixturePair(t, "bytesmith-invalid-input-");
  await assert.rejects(
    runTypeScriptAnalyzerComparison({
      ...options(pair),
      base: { directory: pair.base, revision: "main" },
    }),
    (error) => error?.code === "analyzer_options_invalid",
  );

  const missing = await runTypeScriptAnalyzerComparison({
    ...options(pair, "repo.typescript-missing-snapshot"),
    head: {
      directory: path.join(pair.head, "missing"),
      revision: headRevision,
    },
  });
  assert.equal(missing.status, "error");
  assert.equal(missing.failureKind, "invalid_input");
  assert.equal(missing.ir.gaps[0].blockingRelevance, "required");
  assert.equal(missing.canonicalIr.includes(pair.head), false);
});

test("reflection, dependency injection, and generated code remain explicit unknowns", async (t) => {
  const pair = await fixturePair(t, "bytesmith-runtime-gaps-");
  for (const root of [pair.base, pair.head]) {
    await write(
      root,
      "src/generated-client.ts",
      [
        "// @generated — do not edit",
        "declare const container: { resolve(value: string): unknown };",
        'export const dependency = container.resolve("service");',
        'export const reflected = Reflect.get({ value: 1 }, "value");',
        "",
      ].join("\n"),
    );
  }
  const result = await runTypeScriptAnalyzerComparison(
    options(pair, "repo.typescript-runtime-gaps"),
  );
  assert.equal(result.status, "incomplete");
  const types = new Set(
    result.manifestProjection.unknowns.map((gap) => gap.type),
  );
  assert.ok(types.has("generated_code"));
  assert.ok(types.has("reflection"));
  assert.ok(types.has("analyzer_gap"));
  assert.ok(
    result.manifestProjection.unknowns.every(
      (gap) => gap.blockingRelevance === "required",
    ),
  );
});

async function changeBenchPair(t, fixture) {
  const base = await temporaryDirectory(t, `bytesmith-${fixture}-base-`);
  const head = await temporaryDirectory(t, `bytesmith-${fixture}-head-`);
  await fs.cp(
    path.join(repositoryRoot, "changebench/fixtures", fixture, "before"),
    base,
    { recursive: true },
  );
  await fs.cp(
    path.join(repositoryRoot, "changebench/fixtures", fixture, "after"),
    head,
    { recursive: true },
  );
  for (const root of [base, head]) {
    try {
      await fs.access(path.join(root, "tsconfig.json"));
    } catch {
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
  }
  return { base, head };
}

test("ChangeBench path aliases and dynamic imports cross the complete analyzer boundary", async (t) => {
  const aliasPair = await changeBenchPair(t, "typescript-path-alias");
  const alias = await runTypeScriptAnalyzerComparison(
    options(aliasPair, "repo.changebench-path-alias-pipeline"),
  );
  // The fixture intentionally makes the consumer fail type-checking after the
  // aliased contract changes, so the aggregate must remain incomplete.
  assert.equal(alias.status, "incomplete");
  assert.equal(
    alias.ir.gaps.some((gap) => gap.type === "unresolved_symbol"),
    false,
    JSON.stringify(alias.ir.gaps),
  );
  assert.ok(alias.ir.relationships.some((value) => value.kind === "calls"));

  const dynamicPair = await changeBenchPair(t, "dynamic-import-unknown");
  const dynamic = await runTypeScriptAnalyzerComparison(
    options(dynamicPair, "repo.changebench-dynamic-pipeline"),
  );
  assert.equal(dynamic.status, "incomplete");
  assert.ok(dynamic.ir.gaps.some((gap) => gap.type === "dynamic_import"));
});

test("a medium deterministic fixture stays inside the Phase 4E performance budget", async (t) => {
  const pair = await fixturePair(t, "bytesmith-performance-");
  for (const root of [pair.base, pair.head]) {
    for (let index = 0; index < 40; index += 1) {
      await write(
        root,
        `src/modules/module-${index}.ts`,
        `export function value${index}(input: number): number { return input + ${index}; }\n`,
      );
    }
  }
  const result = await runTypeScriptAnalyzerComparison(
    options(pair, "repo.typescript-performance"),
  );
  assert.equal(result.status, "completed");
  assert.ok(result.ir.symbols.length >= 80);
  assert.ok(result.durationMs < 30_000, `analysis took ${result.durationMs}ms`);
});
