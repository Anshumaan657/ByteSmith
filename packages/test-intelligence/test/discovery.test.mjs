import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverTestsAtRevision,
  runTestDiscoveryComparison,
} from "../dist/index.js";

const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);

async function temporaryRepository(t, prefix = "bytesmith-tests-") {
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

test("discovers static Vitest projects, exact test names, commands, and canonical IR", async (t) => {
  const base = await temporaryRepository(t, "bytesmith-vitest-base-");
  const head = await temporaryRepository(t, "bytesmith-vitest-head-");
  for (const root of [base, head]) {
    await write(root, "package.json", {
      name: "fixture",
      private: true,
      packageManager: "pnpm@11.19.0",
      scripts: { "test:unit": "vitest run" },
      devDependencies: { vitest: "4.0.0" },
    });
    await write(
      root,
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.{test,spec}.ts"], exclude: ["src/ignored/**"] } });
`,
    );
    await write(
      root,
      "src/checkout.spec.ts",
      `import { describe, expect, it, test } from "vitest";
describe("checkout", () => {
  it("calculates total", () => expect(2 + 2).toBe(4));
  test.todo("handles refund");
});
`,
    );
    await write(
      root,
      "src/ignored/not-run.test.ts",
      `import { test } from "vitest"; test("ignored", () => {});\n`,
    );
  }

  const first = await runTestDiscoveryComparison({
    repositoryId: "repo.phase6d-vitest",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "6.0.0-test",
  });
  const second = await runTestDiscoveryComparison({
    repositoryId: "repo.phase6d-vitest",
    base: { directory: base, revision: baseRevision },
    head: { directory: head, revision: headRevision },
    analyzerVersion: "6.0.0-test",
  });
  assert.deepEqual(second, first);
  assert.equal(first.headDiscovery.status, "completed");
  assert.equal(first.headDiscovery.projects.length, 1);
  assert.equal(first.headDiscovery.testFiles.length, 1);
  assert.deepEqual(
    first.headDiscovery.testCases.map((item) => item.name).sort(),
    ["checkout > calculates total", "checkout > handles refund"].sort(),
  );
  assert.equal(
    first.headDiscovery.testFiles[0].command,
    "pnpm test:unit -- 'src/checkout.spec.ts'",
  );
  assert.equal(first.ir.tests.length, 4);
  assert.equal(first.ir.gaps.length, 0);
  assert.ok(first.ir.tests.every((item) => item.framework === "vitest"));
  assert.ok(first.ir.tests.every((item) => item.evidenceIds.length === 1));
});

test("discovers a workspace Jest project from static CommonJS configuration", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-jest-");
  await write(root, "package.json", {
    name: "root",
    private: true,
    packageManager: "npm@11.0.0",
    workspaces: ["packages/*"],
  });
  await write(root, "packages/service/package.json", {
    name: "@fixture/service",
    scripts: { test: "jest --runInBand" },
    devDependencies: { jest: "30.0.0" },
  });
  await write(
    root,
    "packages/service/jest.config.cjs",
    `const config = { rootDir: "src", testMatch: ["**/*.check.ts"] };
module.exports = config;
`,
  );
  await write(
    root,
    "packages/service/src/order.check.ts",
    `import { describe, test } from "@jest/globals";
describe("orders", () => test.only("creates an order", () => {}));
`,
  );

  const result = await discoverTestsAtRevision({
    repositoryRoot: root,
    repositoryId: "repo.phase6d-jest",
    revision: headRevision,
  });
  assert.equal(result.packageManager, "npm");
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].rootDirectory, "packages/service/src");
  assert.equal(result.projects[0].packageName, "@fixture/service");
  assert.equal(result.testCases[0].name, "orders > creates an order");
  assert.equal(
    result.testCases[0].command,
    "npm --prefix 'packages/service' run test -- 'src/order.check.ts'",
  );
});

test("configuration is parsed but never executed and dynamic behavior remains a canonical gap", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-dynamic-config-");
  await write(root, "package.json", {
    scripts: { test: "vitest run" },
    devDependencies: { vitest: "4.0.0" },
  });
  await write(
    root,
    "vitest.config.ts",
    `throw new Error("this file must never execute");
export default createConfiguration(process.env.MODE);
`,
  );
  await write(
    root,
    "safe.test.ts",
    `import { test } from "vitest"; test("still discovered", () => {});\n`,
  );

  const result = await runTestDiscoveryComparison({
    repositoryId: "repo.phase6d-dynamic",
    base: { directory: root, revision: baseRevision },
    head: { directory: root, revision: headRevision },
  });
  assert.equal(result.headDiscovery.status, "incomplete");
  assert.equal(result.headDiscovery.testCases[0].name, "still discovered");
  assert.ok(
    result.headDiscovery.diagnostics.some(
      (item) => item.code === "test_config_dynamic",
    ),
  );
  assert.equal(result.ir.gaps.length, 2);
  assert.ok(
    result.ir.gaps.every(
      (item) =>
        item.type === "analyzer_gap" && item.blockingRelevance === "possible",
    ),
  );
});

test("dynamic test names are visible and are not invented", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-dynamic-name-");
  await write(root, "package.json", {
    scripts: { test: "jest" },
    devDependencies: { jest: "30.0.0" },
  });
  await write(
    root,
    "value.test.ts",
    `import { test } from "@jest/globals";
const name = process.env.TEST_NAME;
test(name, () => {});
test("static name", () => {});
`,
  );
  const result = await discoverTestsAtRevision({
    repositoryRoot: root,
    repositoryId: "repo.phase6d-dynamic-name",
    revision: headRevision,
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(
    result.testCases.map((item) => item.name),
    ["static name"],
  );
  assert.ok(
    result.diagnostics.some((item) => item.code === "test_name_dynamic"),
  );
});

test("default discovery separates explicit Jest and Vitest files", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-mixed-tests-");
  await write(root, "package.json", {
    scripts: { jest: "jest", vitest: "vitest run" },
    devDependencies: { jest: "30.0.0", vitest: "4.0.0" },
  });
  await write(
    root,
    "jest-only.test.ts",
    `import { test } from "@jest/globals"; test("jest test", () => {});\n`,
  );
  await write(
    root,
    "vitest-only.test.ts",
    `import { test } from "vitest"; test("vitest test", () => {});\n`,
  );
  const result = await discoverTestsAtRevision({
    repositoryRoot: root,
    repositoryId: "repo.phase6d-mixed",
    revision: headRevision,
  });
  assert.deepEqual(
    result.testCases.map((item) => [item.framework, item.name]),
    [
      ["jest", "jest test"],
      ["vitest", "vitest test"],
    ],
  );
});

test("an explicit Vitest import creates a bounded project without package metadata", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-import-only-");
  await write(
    root,
    "checkout.test.ts",
    `import { test } from "vitest";
test("checkout total test", () => {});
`,
  );
  await write(root, "checkout.ts", "export const checkout = true;\n");
  const result = await discoverTestsAtRevision({
    repositoryRoot: root,
    repositoryId: "repo.phase6d-import-only",
    revision: headRevision,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].framework, "vitest");
  assert.equal(result.testCases[0].name, "checkout total test");
  assert.equal(result.testCases[0].command, undefined);
});
