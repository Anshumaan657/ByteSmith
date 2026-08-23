import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTypeScriptCompilerSession,
  matchTypeScriptSymbols,
  TypeScriptDiscoveryError,
} from "../dist/index.js";

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

async function temporaryRepository(t, prefix = "bytesmith-relations-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function analyzeChangeBenchSnapshot(t, fixture, snapshot, revision) {
  const root = await temporaryRepository(
    t,
    `bytesmith-relations-${fixture}-${snapshot}-`,
  );
  await fs.cp(
    path.join(repositoryRoot, "changebench/fixtures", fixture, snapshot),
    root,
    { recursive: true },
  );
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
  return (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: `repo.relationship-${fixture}`,
      revision,
    })
  ).analysis;
}

function symbolNamed(analysis, name) {
  const symbol = analysis.symbols.find(
    (candidate) => candidate.qualifiedName === name,
  );
  assert.ok(symbol, `Expected symbol ${name}`);
  return symbol;
}

function callBetween(analysis, fromName, toName) {
  const from = symbolNamed(analysis, fromName);
  const to = symbolNamed(analysis, toName);
  return analysis.relationships.find(
    (relationship) =>
      relationship.kind === "call" &&
      relationship.fromSymbolId === from.id &&
      relationship.toSymbolId === to.id,
  );
}

test("ChangeBench direct calls and import bindings link consumer symbols authoritatively", async (t) => {
  const analysis = await analyzeChangeBenchSnapshot(
    t,
    "direct-consumer-affected",
    "after",
    headRevision,
  );
  assert.equal(analysis.status, "incomplete");
  assert.ok(analysis.gaps.some((gap) => gap.type === "type_check_failure"));
  const tax = symbolNamed(analysis, "calculateTax");
  const binding = analysis.importBindings.find(
    (candidate) => candidate.localName === "calculateTax",
  );
  assert.ok(binding);
  assert.equal(binding.importedName, "calculateTax");
  assert.equal(binding.resolution, "resolved_internal");
  assert.equal(binding.targetPath, "tax.ts");
  assert.equal(binding.targetSymbolId, tax.id);
  const call = callBetween(analysis, "checkoutTotal", "calculateTax");
  assert.ok(call);
  assert.equal(call.authority, "authoritative");
  assert.equal(call.fromPath, "checkout.ts");
  assert.equal(call.toPath, "tax.ts");
});

test("transitive and unrelated ChangeBench foundations contain only direct edges", async (t) => {
  const transitive = await analyzeChangeBenchSnapshot(
    t,
    "transitive-consumer-affected",
    "after",
    headRevision,
  );
  assert.ok(callBetween(transitive, "getProfile", "loadUser"));
  assert.ok(callBetween(transitive, "renderProfile", "getProfile"));
  assert.equal(
    transitive.relationships.some(
      (relationship) =>
        relationship.kind === "call" &&
        relationship.fromSymbolId ===
          symbolNamed(transitive, "renderProfile").id &&
        relationship.toSymbolId === symbolNamed(transitive, "loadUser").id,
    ),
    false,
  );

  const unrelated = await analyzeChangeBenchSnapshot(
    t,
    "unrelated-consumer-forbidden",
    "after",
    headRevision,
  );
  const admin = symbolNamed(unrelated, "renderAdminDashboard");
  assert.equal(
    unrelated.relationships.some(
      (relationship) => relationship.fromSymbolId === admin.id,
    ),
    false,
  );
});

test("top-level test calls and TypeScript path aliases retain exact targets", async (t) => {
  const tests = await analyzeChangeBenchSnapshot(
    t,
    "relevant-test-selected",
    "after",
    headRevision,
  );
  const checkout = symbolNamed(tests, "checkoutTotal");
  const topLevelCall = tests.relationships.find(
    (relationship) =>
      relationship.kind === "call" &&
      relationship.fromPath === "checkout.test.ts" &&
      relationship.toSymbolId === checkout.id,
  );
  assert.ok(topLevelCall);
  assert.equal(topLevelCall.fromSymbolId, undefined);

  const alias = await analyzeChangeBenchSnapshot(
    t,
    "typescript-path-alias",
    "after",
    headRevision,
  );
  const product = symbolNamed(alias, "getProduct");
  const aliasBinding = alias.importBindings.find(
    (binding) => binding.localName === "getProduct",
  );
  assert.equal(aliasBinding?.targetSymbolId, product.id);
  assert.equal(aliasBinding?.targetPath, "domain/product.ts");
  assert.ok(callBetween(alias, "renderProduct", "getProduct"));
});

test("monorepo imports, references, constructors, and methods link across projects", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-relations-monorepo-");
  await write(root, "package.json", {
    name: "relationship-monorepo",
    private: true,
    workspaces: ["packages/*"],
  });
  await write(root, "tsconfig.base.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      baseUrl: ".",
      paths: { "@lib/*": ["packages/lib/src/*"] },
    },
  });
  await write(root, "packages/lib/package.json", { name: "@fixture/lib" });
  await write(root, "packages/lib/tsconfig.json", {
    extends: "../../tsconfig.base.json",
    include: ["src/**/*.ts"],
  });
  await write(
    root,
    "packages/lib/src/index.ts",
    [
      "export function work(): number { return 1; }",
      "export class Worker { run(): number { return work(); } }",
      "",
    ].join("\n"),
  );
  await write(root, "packages/app/package.json", { name: "@fixture/app" });
  await write(root, "packages/app/tsconfig.json", {
    extends: "../../tsconfig.base.json",
    include: ["src/**/*.ts"],
  });
  await write(
    root,
    "packages/app/src/index.ts",
    [
      'import { work, Worker } from "@lib/index";',
      "export const copied = work;",
      "export function execute(): number { return new Worker().run(); }",
      "",
    ].join("\n"),
  );

  const analysis = (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: "repo.relationship-monorepo",
      revision: headRevision,
    })
  ).analysis;
  assert.equal(analysis.status, "completed");
  const work = symbolNamed(analysis, "work");
  const worker = symbolNamed(analysis, "Worker");
  const run = symbolNamed(analysis, "Worker.run");
  const copied = symbolNamed(analysis, "copied");
  const execute = symbolNamed(analysis, "execute");
  assert.notEqual(work.projectId, execute.projectId);
  assert.equal(
    analysis.importBindings.find((binding) => binding.localName === "work")
      ?.targetSymbolId,
    work.id,
  );
  assert.ok(
    analysis.relationships.some(
      (relationship) =>
        relationship.kind === "reference" &&
        relationship.fromSymbolId === copied.id &&
        relationship.toSymbolId === work.id,
    ),
  );
  assert.ok(
    analysis.relationships.some(
      (relationship) =>
        relationship.kind === "call" &&
        relationship.fromSymbolId === execute.id &&
        relationship.toSymbolId === worker.id,
    ),
  );
  assert.ok(
    analysis.relationships.some(
      (relationship) =>
        relationship.kind === "call" &&
        relationship.fromSymbolId === execute.id &&
        relationship.toSymbolId === run.id,
    ),
  );
});

test("cross-revision matching preserves identity while exposing signature changes", async (t) => {
  const before = await analyzeChangeBenchSnapshot(
    t,
    "direct-consumer-affected",
    "before",
    baseRevision,
  );
  const after = await analyzeChangeBenchSnapshot(
    t,
    "direct-consumer-affected",
    "after",
    headRevision,
  );
  const first = matchTypeScriptSymbols(before, after);
  const second = matchTypeScriptSymbols(before, after);
  assert.deepEqual(second, first);

  const baseTax = symbolNamed(before, "calculateTax");
  const baseCheckout = symbolNamed(before, "checkoutTotal");
  const taxMatch = first.matches.find(
    (match) => match.baseSymbolId === baseTax.id,
  );
  const checkoutMatch = first.matches.find(
    (match) => match.baseSymbolId === baseCheckout.id,
  );
  assert.equal(taxMatch?.basis, "project_path_qualified_name");
  assert.equal(taxMatch?.signatureChanged, true);
  assert.equal(taxMatch?.moved, false);
  assert.equal(checkoutMatch?.signatureChanged, false);
  assert.deepEqual(first.unmatched, []);
});

async function analyzeFiles(t, prefix, files, revision) {
  const root = await temporaryRepository(t, prefix);
  await write(root, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  });
  for (const [file, contents] of Object.entries(files)) {
    await write(root, file, contents);
  }
  return (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: "repo.matching-moves",
      revision,
    })
  ).analysis;
}

test("file moves match uniquely while renames and ambiguity remain unmatched", async (t) => {
  const movedBase = await analyzeFiles(
    t,
    "bytesmith-match-moved-base-",
    {
      "src/old.ts":
        "export function stable(value: string): string { return value; }\n",
    },
    baseRevision,
  );
  const movedHead = await analyzeFiles(
    t,
    "bytesmith-match-moved-head-",
    {
      "src/new.ts":
        "\nexport function stable(value: string): string { return value.trim(); }\n",
    },
    headRevision,
  );
  const moved = matchTypeScriptSymbols(movedBase, movedHead);
  assert.equal(moved.matches.length, 1);
  assert.equal(moved.matches[0].basis, "unique_qualified_name");
  assert.equal(moved.matches[0].moved, true);
  assert.equal(moved.matches[0].signatureChanged, false);

  const renamedHead = await analyzeFiles(
    t,
    "bytesmith-match-renamed-head-",
    {
      "src/old.ts":
        "export function renamed(value: string): string { return value; }\n",
    },
    headRevision,
  );
  const renamed = matchTypeScriptSymbols(movedBase, renamedHead);
  assert.equal(renamed.matches.length, 0);
  assert.deepEqual(renamed.unmatched.map((item) => item.reason).sort(), [
    "added",
    "removed",
  ]);

  const ambiguousHead = await analyzeFiles(
    t,
    "bytesmith-match-ambiguous-head-",
    {
      "src/one.ts":
        "export function stable(value: string): string { return value; }\n",
      "src/two.ts":
        "export function stable(value: string): string { return value; }\n",
    },
    headRevision,
  );
  const ambiguous = matchTypeScriptSymbols(movedBase, ambiguousHead);
  assert.equal(ambiguous.matches.length, 0);
  assert.ok(ambiguous.unmatched.every((item) => item.reason === "ambiguous"));

  assert.throws(
    () => matchTypeScriptSymbols(movedBase, movedBase),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "analysis_comparison_invalid",
  );
  assert.throws(
    () =>
      matchTypeScriptSymbols(movedBase, {
        ...movedHead,
        repositoryId: "repo.different",
      }),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "analysis_comparison_invalid",
  );
});
