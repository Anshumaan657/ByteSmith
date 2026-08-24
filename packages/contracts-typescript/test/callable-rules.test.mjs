import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTypeScriptCallableRuleDefinitions,
  createTypeScriptCallableRuleState,
  evaluateTypeScriptCallableRules,
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

const baseSource = `
interface Box<T> { value: T }
interface Container<T> { item: T }

export function removed(value: string): string { return value; }
export function requiredAdded(value: string): string { return value; }
export function optionalAdded(value: string): string { return value; }
export function removedParameter(value: string, flag: boolean): string { return flag ? value : ""; }
export function tightened(value: string | number): string { return String(value); }
export function widened(value: string): string { return value; }
export function optionalRequired(value?: string): string { return value ?? ""; }
export function returnsWider(): string { return "value"; }
export function returnsNarrower(): string | number { return "value"; }
export function asyncShift(): string { return "value"; }
export function generic<T extends string | number>(value: T): T { return value; }
export function complex(value: Box<string>): string { return value.value; }

export function overloaded(value: string): string;
export function overloaded(value: number): number;
export function overloaded(value: string | number): string | number { return value; }

export function ambiguous(value: string): string;
export function ambiguous(value: number): number;
export function ambiguous(value: string | number): string | number { return value; }

export class Service {
  execute(value: string): string { return value; }
}
`;

const headSource = `
interface Box<T> { value: T }
interface Container<T> { item: T }

export function requiredAdded(value: string, count: number): string { return value.repeat(count); }
export function optionalAdded(value: string, flag?: boolean): string { return flag ? value : ""; }
export function removedParameter(value: string): string { return value; }
export function tightened(value: string): string { return value; }
export function widened(value: string | number): string { return String(value); }
export function optionalRequired(value: string): string { return value; }
export function returnsWider(): string | number { return "value"; }
export function returnsNarrower(): string { return "value"; }
export async function asyncShift(): Promise<string> { return "value"; }
export function generic<T extends string>(value: T): T { return value; }
export function complex(value: Container<string>): string { return value.item; }

export function overloaded(value: string): string;
export function overloaded(value: string): string { return value; }

export function ambiguous(value: boolean): boolean;
export function ambiguous(value: bigint): bigint;
export function ambiguous(value: boolean | bigint): boolean | bigint { return value; }

export class Service {}
export function added(value: string): string { return value; }
`;

async function fixture() {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-callable-base-"),
  );
  const head = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-callable-head-"),
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
  for (const root of [base, head]) {
    await write(root, "package.json", {
      name: "@fixture/callable-rules",
      type: "module",
      exports: { ".": "./src/index.ts" },
    });
    await write(root, "tsconfig.json", configuration);
  }
  await write(base, "src/index.ts", baseSource);
  await write(head, "src/index.ts", headSource);
  const analyzed = await runTypeScriptAnalyzerComparison({
    repositoryId: "repo.callable-rules",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "5.0.0-test",
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

test("callable rules detect removals, parameters, overloads, generics, returns, and async changes", async () => {
  const { analyzed } = await fixturePromise;
  const result = await evaluateTypeScriptCallableRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  });

  assert.equal(result.executions.length, 5);
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.identity",
      "function removed was removed",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.identity",
      "method Service.execute was removed",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "added required parameter count",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "added optional parameter flag",
      "compatible",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "removed parameter flag",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "from string | number to string",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "from string to string | number",
      "compatible",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.parameters",
      "from optional to required",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.overloads",
      "overloaded removed overload",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.generics",
      "constraint from string | number to string",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.returns",
      "return type from string to string | number",
      "breaking",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.returns",
      "return type from string | number to string",
      "compatible",
    ),
  );
  assert.ok(
    hasFinding(
      result,
      "typescript.callable.returns",
      "synchronous to asynchronous",
      "breaking",
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

test("ambiguous overloads and unprovable complex type relations remain explicit unknowns", async () => {
  const { analyzed } = await fixturePromise;
  const result = await evaluateTypeScriptCallableRules({
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
  });

  assert.equal(result.status, "incomplete");
  assert.ok(
    result.unknowns.some(
      (item) =>
        item.summary.includes("Overload correspondence for ambiguous") &&
        item.blockingRelevance === "required",
    ),
  );
  assert.ok(
    result.unknowns.some(
      (item) =>
        item.summary.includes("complex") &&
        item.summary.includes("Box<string>") &&
        item.summary.includes("Container<string>"),
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.summary.includes("complex") &&
        change.compatibility === "unknown",
    ),
  );
});

test("callable comparison and rule execution are deterministic", async () => {
  const { analyzed } = await fixturePromise;
  const input = {
    ir: analyzed.ir,
    baseAnalysis: analyzed.snapshot.baseAnalysis,
    headAnalysis: analyzed.snapshot.headAnalysis,
    symbolAnalysis: analyzed.snapshot.symbolAnalysis,
  };
  const firstState = createTypeScriptCallableRuleState(input);
  const secondState = createTypeScriptCallableRuleState(input);
  const first = await evaluateTypeScriptCallableRules(input);
  const second = await evaluateTypeScriptCallableRules(input);

  assert.deepEqual(firstState, secondState);
  assert.deepEqual(first, second);
  assert.match(first.semanticDigest.value, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    createTypeScriptCallableRuleDefinitions().map((rule) => rule.id),
    [
      "typescript.callable.generics",
      "typescript.callable.identity",
      "typescript.callable.overloads",
      "typescript.callable.parameters",
      "typescript.callable.returns",
    ],
  );
});

test("callable rules reject analyses outside the canonical IR binding", async () => {
  const { analyzed } = await fixturePromise;
  const mismatched = structuredClone(analyzed.snapshot.headAnalysis);
  mismatched.revision = "c".repeat(40);

  await assert.rejects(
    evaluateTypeScriptCallableRules({
      ir: analyzed.ir,
      baseAnalysis: analyzed.snapshot.baseAnalysis,
      headAnalysis: mismatched,
    }),
    (error) => error?.code === "analysis_comparison_invalid",
  );

  const corruptedMatches = structuredClone(analyzed.snapshot.symbolAnalysis);
  corruptedMatches.matches.pop();
  await assert.rejects(
    evaluateTypeScriptCallableRules({
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
    path.join(os.tmpdir(), `bytesmith-callable-${name}-before-`),
  );
  const afterDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), `bytesmith-callable-${name}-after-`),
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
      analyzerVersion: "5.0.0-changebench",
    });
    assert.ok(analyzed.snapshot);
    return evaluateTypeScriptCallableRules({
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

test("Phase 5B produces the expected ChangeBench callable conclusions", async () => {
  const cases = [
    ["required-parameter-added", "added required parameter", "breaking"],
    ["optional-parameter-added", "added optional parameter", "compatible"],
    ["exported-parameter-removed", "removed parameter", "breaking"],
    ["exported-return-type-changed", "return type", "breaking"],
  ];
  for (const [name, summary, compatibility] of cases) {
    const result = await evaluateChangeBenchCase(name);
    assert.ok(
      result.changes.some(
        (change) =>
          change.summary.includes(summary) &&
          change.compatibility === compatibility,
      ),
      `Expected ${name} to produce ${compatibility}: ${summary}`,
    );
  }

  const safe = await evaluateChangeBenchCase("safe-internal-change");
  assert.deepEqual(safe.changes, []);
  assert.deepEqual(safe.unknowns, []);
  assert.equal(safe.status, "completed");
});
