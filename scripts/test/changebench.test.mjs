import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateChangeBenchCase } from "../lib/changebench.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function loadCase(id) {
  return JSON.parse(await fs.readFile(path.join(root, "changebench", "fixtures", id, "case.json"), "utf8"));
}

const emptyActual = {
  conclusion: "pass",
  coverage: {
    totalChangedFiles: 1,
    analyzed: 1,
    partiallyAnalyzed: 0,
    unsupported: 0,
    intentionallyExcluded: 0
  },
  changes: [],
  impacts: [],
  tests: [],
  unknowns: [],
  policies: [],
  waivers: []
};

test("allowUnexpected false counts unmatched output as a false positive", async () => {
  const fixture = await loadCase("unexpected-result-rejected");
  const actual = structuredClone(emptyActual);
  actual.changes.push({
    id: "change.unexpected",
    kind: "symbol",
    compatibility: "compatible",
    summary: "Unexpected result",
    component: { id: "symbol.value", kind: "symbol", name: "value" }
  });
  const result = evaluateChangeBenchCase(fixture, actual);
  assert.equal(result.passed, false);
  assert.equal(result.falsePositiveCount, 1);
  assert.ok(result.errors.some((error) => error.includes("Unexpected changes result")));
});

test("a required matcher labels the corresponding output", async () => {
  const fixture = await loadCase("unexpected-result-rejected");
  fixture.expected.requiredChanges = [{ kind: "symbol", componentName: "value" }];
  const actual = structuredClone(emptyActual);
  actual.changes.push({
    id: "change.value",
    kind: "symbol",
    compatibility: "compatible",
    summary: "Value changed",
    component: { id: "symbol.value", kind: "symbol", name: "value" }
  });
  const result = evaluateChangeBenchCase(fixture, actual);
  assert.equal(result.passed, true, result.errors.join("\n"));
  assert.equal(result.falsePositiveCount, 0);
});

test("suspended-rule fixture requires warning visibility and forbids failure", async () => {
  const fixture = await loadCase("suspended-rule-visible");
  assert.equal(fixture.expected.conclusion, "warn");
  assert.ok(fixture.expected.requiredPolicies.some((item) => item.ruleState === "suspended" && item.result === "warn"));
  assert.ok(fixture.expected.forbiddenPolicies.some((item) => item.result === "fail"));
});
