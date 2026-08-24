import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTypeScriptStructuralRuleDefinitions,
  createTypeScriptStructuralRuleState,
  evaluateTypeScriptStructuralRules,
  runTypeScriptAnalyzerComparison,
} from "../dist/index.js";

const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

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

const baseModels = `
interface Box<T> { value: T }

export interface Customer {
  readonly id: string;
  phone?: string;
  legacy: string;
  mutable: string | number;
  complex: Box<string>;
}

export type Identifier = string | number;
export interface RemovedShape { value: string }

export class Model {
  public name = "model";
  public legacy = 1;
  public readonly code = "base";
  private secret = "hidden";
}
`;

const headModels = `
interface Container<T> { item: T }

export interface Customer {
  id: string;
  phone: string;
  mutable: string;
  complex: Container<string>;
  addedRequired: boolean;
}

export type Identifier = boolean;
export interface AddedShape { value: string }

export class Model {
  public name = "model";
  public code = "head";
  private secret = "hidden";
}
`;

async function fixture() {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-structural-base-"),
  );
  const head = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-structural-head-"),
  );
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
  await write(base, "package.json", {
    name: "@fixture/structural",
    type: "module",
    exports: {
      ".": "./src/index.ts",
      "./legacy": "./src/legacy.ts",
    },
  });
  await write(head, "package.json", {
    name: "@fixture/structural",
    type: "module",
    exports: {
      ".": "./src/models.ts",
      "./added": "./src/added.ts",
    },
  });
  for (const root of [base, head]) {
    await write(root, "tsconfig.json", configuration);
    await write(
      root,
      "src/api.ts",
      "export function legacyApi(): string { return 'legacy'; }\n",
    );
    await write(root, "src/legacy.ts", "export const legacy = true;\n");
    await write(root, "src/added.ts", "export const added = true;\n");
  }
  await write(base, "src/models.ts", baseModels);
  await write(head, "src/models.ts", headModels);
  await write(
    base,
    "src/index.ts",
    [
      'export { Customer, Identifier, Model, RemovedShape } from "./models.js";',
      'export { legacyApi } from "./api.js";',
      "",
    ].join("\n"),
  );
  await write(
    head,
    "src/index.ts",
    'export { Customer, Identifier, Model, AddedShape } from "./models.js";\n',
  );
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: "repo.structural-rules",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "5.1.0-test",
  });
  assert.ok(analyzed.snapshot);
  return { base, head, analyzed };
}

const fixturePromise = fixture();

after(async () => {
  const records = await fixturePromise;
  await Promise.all([
    fs.rm(records.base, { recursive: true, force: true }),
    fs.rm(records.head, { recursive: true, force: true }),
  ]);
});

function hasFinding(result, ruleId, text, compatibility) {
  return result.findings.some(
    (finding) =>
      finding.ruleId === ruleId &&
      finding.change.summary.includes(text) &&
      finding.change.compatibility === compatibility,
  );
}

test("structural rules detect declaration, field, alias, re-export, and export-map changes", async () => {
  const { analyzed } = await fixturePromise;
  const result = await evaluateTypeScriptStructuralRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  });

  assert.equal(result.executions.length, 5);
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.declarations",
      "RemovedShape was removed",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.declarations",
      "AddedShape was added",
      "compatible",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.fields",
      "Customer.phone changed from optional to required",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.fields",
      "Customer.legacy was removed",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.fields",
      "Customer.addedRequired was added",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.structure.fields",
      "Model.code changed from readonly to mutable",
      "compatible",
    ),
  );
  const aliasFindings = result.findings.filter(
    (finding) => finding.ruleId === "typescript.structure.type-aliases",
  );
  assert.ok(
    aliasFindings.some(
      (finding) =>
        finding.change.component.name === "Identifier" &&
        finding.change.compatibility === "breaking",
    ),
    JSON.stringify(aliasFindings),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.package.re-exports",
      "removed export legacyApi",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.package.exports",
      "Package export ./legacy",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.package.exports",
      "Package export ./added",
      "compatible",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.package.exports",
      "changed target",
      "potentially_breaking",
    ),
  );
  assert.ok(
    result.findings.every(
      (finding) =>
        finding.defaultMode === "advisory" &&
        finding.blockingEligible === false &&
        finding.change.evidenceIds.every((id) =>
          analyzed.ir.evidence.some((evidence) => evidence.id === id),
        ),
    ),
  );
});

test("complex field types remain explicit required unknowns", async () => {
  const { analyzed } = await fixturePromise;
  const result = await evaluateTypeScriptStructuralRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
  });

  assert.equal(result.status, "incomplete");
  assert.ok(
    result.unknowns.some(
      (item) =>
        item.summary.includes("Customer.complex") &&
        item.summary.includes("Box<string>") &&
        item.summary.includes("Container<string>") &&
        item.blockingRelevance === "required",
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.summary.includes("Customer.complex") &&
        change.compatibility === "unknown",
    ),
  );
});

test("structural state and rule execution are deterministic", async () => {
  const { analyzed } = await fixturePromise;
  const input = {
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  };
  const firstState = createTypeScriptStructuralRuleState(input);
  const secondState = createTypeScriptStructuralRuleState(input);
  const first = await evaluateTypeScriptStructuralRules(input);
  const second = await evaluateTypeScriptStructuralRules(input);

  assert.deepEqual(firstState, secondState);
  assert.deepEqual(first, second);
  assert.match(first.semanticDigest.value, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    createTypeScriptStructuralRuleDefinitions().map((rule) => rule.id),
    [
      "typescript.structure.declarations",
      "typescript.structure.fields",
      "typescript.structure.type-aliases",
      "typescript.package.re-exports",
      "typescript.package.exports",
    ],
  );
});

test("structural rules reject mismatched analyses and supplied symbol matches", async () => {
  const { analyzed } = await fixturePromise;
  const mismatched = structuredClone(analyzed.snapshot.headAnalysis);
  mismatched.revision = "c".repeat(40);
  await assert.rejects(
    evaluateTypeScriptStructuralRules({
      ir: analyzed.ir,
      baseAnalysis: analyzed.snapshot.baseAnalysis,
      headAnalysis: mismatched,
    }),
    (error) => error?.code === "analysis_comparison_invalid",
  );

  const corruptedMatches = structuredClone(analyzed.snapshot.symbolAnalysis);
  corruptedMatches.matches.pop();
  await assert.rejects(
    evaluateTypeScriptStructuralRules({
      ir: analyzed.ir,
      baseAnalysis: analyzed.snapshot.baseAnalysis,
      headAnalysis: analyzed.snapshot.headAnalysis,
      symbolAnalysis: corruptedMatches,
    }),
    (error) => error?.code === "analysis_comparison_invalid",
  );
});

async function evaluateChangeBenchCase(name) {
  const before = await fs.mkdtemp(
    path.join(os.tmpdir(), `bytesmith-structural-${name}-before-`),
  );
  const afterDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), `bytesmith-structural-${name}-after-`),
  );
  try {
    await Promise.all([
      fs.cp(
        path.join(repositoryRoot, "changebench/fixtures", name, "before"),
        before,
        { recursive: true },
      ),
      fs.cp(
        path.join(repositoryRoot, "changebench/fixtures", name, "after"),
        afterDirectory,
        { recursive: true },
      ),
    ]);
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
    await Promise.all([
      write(before, "tsconfig.json", configuration),
      write(afterDirectory, "tsconfig.json", configuration),
    ]);
    const analyzed = await runTypeScriptAnalyzerComparison({
      repositoryId: `repo.changebench-${name}`,
      base: { directory: before, revision: baseRevision },
      head: { directory: afterDirectory, revision: headRevision },
      analyzerVersion: "5.1.0-changebench",
    });
    assert.ok(analyzed.snapshot);
    return evaluateTypeScriptStructuralRules({
      ir: analyzed.ir,
      baseAnalysis: analyzed.snapshot.baseAnalysis,
      headAnalysis: analyzed.snapshot.headAnalysis,
      symbolAnalysis: analyzed.snapshot.symbolAnalysis,
    });
  } finally {
    await Promise.all([
      fs.rm(before, { recursive: true, force: true }),
      fs.rm(afterDirectory, { recursive: true, force: true }),
    ]);
  }
}

test("Phase 5C produces the expected ChangeBench structural conclusions", async () => {
  const optional = await evaluateChangeBenchCase(
    "optional-field-made-required",
  );
  assert.ok(
    optional.changes.some(
      (change) =>
        change.component.name === "Customer.phone" &&
        change.compatibility === "breaking",
    ),
  );

  const removedField = await evaluateChangeBenchCase(
    "typescript-export-removed",
  );
  assert.ok(
    removedField.changes.some(
      (change) =>
        change.component.name === "PaymentResponse.currency" &&
        change.compatibility === "breaking",
    ),
  );

  const removedExport = await evaluateChangeBenchCase("package-export-removed");
  assert.ok(
    removedExport.changes.some(
      (change) =>
        change.kind === "dependency" &&
        change.summary.includes("removed export createOrder") &&
        change.compatibility === "breaking",
    ),
  );

  const safe = await evaluateChangeBenchCase("safe-internal-change");
  assert.deepEqual(safe.changes, []);
  assert.deepEqual(safe.unknowns, []);
  assert.equal(safe.status, "completed");
});
