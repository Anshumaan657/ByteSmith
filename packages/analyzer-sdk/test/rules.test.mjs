import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../canonicalization/dist/index.js";
import { createEvidence, validateEvidence } from "../../evidence/dist/index.js";
import {
  createCanonicalIr,
  createIrContract,
  createIrFile,
  createIrSymbol,
} from "../../ir/dist/index.js";
import {
  ContractRuleError,
  ContractRuleRegistry,
  createContractComparisons,
  executeContractRules,
} from "../dist/index.js";

const binding = {
  repositoryId: "repo.contract-rules",
  baseRevision: "a".repeat(40),
  headRevision: "b".repeat(40),
};

function fixture() {
  const evidenceContext = {
    ...binding,
    producer: { id: "typescript", version: "4.0.0" },
  };
  const baseFileEvidence = createEvidence(evidenceContext, {
    kind: "syntax",
    revision: binding.baseRevision,
    path: "src/money.ts",
    summary: "Parsed the base source file.",
  });
  const headFileEvidence = createEvidence(evidenceContext, {
    kind: "syntax",
    revision: binding.headRevision,
    path: "src/money.ts",
    summary: "Parsed the head source file.",
  });
  const baseSymbolEvidence = createEvidence(evidenceContext, {
    kind: "type",
    revision: binding.baseRevision,
    path: "src/money.ts",
    startLine: 1,
    summary: "Resolved the base exported function.",
  });
  const headSymbolEvidence = createEvidence(evidenceContext, {
    kind: "type",
    revision: binding.headRevision,
    path: "src/money.ts",
    startLine: 1,
    summary: "Resolved the head exported function.",
  });
  const baseContractEvidence = createEvidence(evidenceContext, {
    kind: "contract",
    revision: binding.baseRevision,
    path: "src/money.ts",
    startLine: 1,
    summary: "Derived the base public signature.",
  });
  const headContractEvidence = createEvidence(evidenceContext, {
    kind: "contract",
    revision: binding.headRevision,
    path: "src/money.ts",
    startLine: 1,
    summary: "Derived the head public signature.",
  });
  const baseFile = createIrFile(binding, {
    revision: binding.baseRevision,
    path: "src/money.ts",
    evidenceIds: [baseFileEvidence.id],
  });
  const headFile = createIrFile(binding, {
    revision: binding.headRevision,
    path: "src/money.ts",
    evidenceIds: [headFileEvidence.id],
  });
  const baseSymbol = createIrSymbol(binding, {
    revision: binding.baseRevision,
    path: "src/money.ts",
    startLine: 1,
    fileId: baseFile.id,
    kind: "function",
    name: "formatMoney",
    exported: true,
    evidenceIds: [baseSymbolEvidence.id],
  });
  const headSymbol = createIrSymbol(binding, {
    revision: binding.headRevision,
    path: "src/money.ts",
    startLine: 1,
    fileId: headFile.id,
    kind: "function",
    name: "formatMoney",
    exported: true,
    evidenceIds: [headSymbolEvidence.id],
  });
  const baseContract = createIrContract(binding, {
    revision: binding.baseRevision,
    path: "src/money.ts",
    startLine: 1,
    subjectId: baseSymbol.id,
    kind: "function_signature",
    name: "formatMoney(number): string",
    fingerprint: "signature:base",
    evidenceIds: [baseContractEvidence.id],
  });
  const headContract = createIrContract(binding, {
    revision: binding.headRevision,
    path: "src/money.ts",
    startLine: 1,
    subjectId: headSymbol.id,
    kind: "function_signature",
    name: "formatMoney(string): string",
    fingerprint: "signature:head",
    evidenceIds: [headContractEvidence.id],
  });
  return {
    ir: createCanonicalIr(binding, {
      evidence: [
        baseFileEvidence,
        headFileEvidence,
        baseSymbolEvidence,
        headSymbolEvidence,
        baseContractEvidence,
        headContractEvidence,
      ],
      files: [baseFile, headFile],
      symbols: [baseSymbol, headSymbol],
      contracts: [baseContract, headContract],
      relationships: [],
      tests: [],
      gaps: [],
    }),
    baseContractEvidence,
    headContractEvidence,
    headSymbol,
  };
}

function definition(id, evaluate, overrides = {}) {
  return {
    id,
    version: "1.0.0",
    family: "typescript",
    description: `Evaluate ${id}.`,
    required: true,
    defaultMode: "advisory",
    blockingEligible: false,
    evaluate,
    ...overrides,
  };
}

function finding(records, compatibility, summary) {
  return {
    kind: "contract",
    summary,
    compatibility,
    component: {
      id: records.headSymbol.id,
      kind: "symbol",
      name: records.headSymbol.name,
      location: records.headSymbol.location,
    },
    evidenceIds: [
      records.headContractEvidence.id,
      records.baseContractEvidence.id,
    ],
    evidenceRequirements: ["head", "base"],
  };
}

test("registry execution is deterministic, versioned, advisory, and manifest-ready", async () => {
  const records = fixture();
  const alphaFinding = finding(
    records,
    "breaking",
    "The public input type changed.",
  );
  const alpha = definition("typescript.alpha", async () => ({
    findings: [alphaFinding, alphaFinding],
    diagnostics: ["evaluated", "evaluated"],
  }));
  const zeta = definition("typescript.zeta", () => ({
    findings: [
      finding(
        records,
        "compatible",
        "The supported output remains compatible.",
      ),
    ],
  }));
  const first = await executeContractRules([zeta, alpha], {
    ir: records.ir,
    state: { candidates: ["head", "base"] },
  });
  const second = await executeContractRules([alpha, zeta], {
    ir: records.ir,
    state: { candidates: ["head", "base"] },
  });

  assert.equal(first.status, "completed");
  assert.deepEqual(
    first.executions.map((execution) => execution.ruleId),
    ["typescript.alpha", "typescript.zeta"],
  );
  assert.deepEqual(first.executions[0].diagnostics, ["evaluated"]);
  assert.equal(first.findings.length, 2);
  assert.deepEqual(
    first.changes,
    first.findings.map((record) => record.change),
  );
  assert.ok(
    first.findings.every(
      (record) =>
        record.defaultMode === "advisory" &&
        record.blockingEligible === false &&
        record.ruleVersion === "1.0.0",
    ),
  );
  assert.match(first.semanticDigest.value, /^[0-9a-f]{64}$/u);
  assert.equal(first.ruleSetId, second.ruleSetId);
  assert.deepEqual(first.semanticDigest, second.semanticDigest);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("finding, unknown, location, and diagnostic ordering is semantic-set stable", async () => {
  const records = fixture();
  const ordered = definition("typescript.ordering", (context) => {
    const findings = [
      finding(records, "compatible", "First compatible observation."),
      finding(
        records,
        "potentially_breaking",
        "Second compatibility observation.",
      ),
    ];
    const unknowns = [
      {
        type: "other",
        summary: "First non-blocking limitation.",
        locations: [records.baseContractEvidence.location],
        evidenceIds: [records.baseContractEvidence.id],
        blockingRelevance: "none",
      },
      {
        type: "other",
        summary: "Second non-blocking limitation.",
        locations: [records.headContractEvidence.location],
        evidenceIds: [records.headContractEvidence.id],
        blockingRelevance: "none",
      },
    ];
    return {
      findings: context.state.reverse ? findings.reverse() : findings,
      unknowns: context.state.reverse ? unknowns.reverse() : unknowns,
      diagnostics: context.state.reverse
        ? ["zeta", "alpha"]
        : ["alpha", "zeta"],
    };
  });
  const registry = new ContractRuleRegistry([ordered]);
  const first = await registry.execute({
    ir: records.ir,
    state: { reverse: false },
  });
  const second = await registry.execute({
    ir: records.ir,
    state: { reverse: true },
  });

  assert.equal(first.status, "completed");
  assert.deepEqual(first.semanticDigest, second.semanticDigest);
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("contract artifacts match conservatively by family-owned logical keys", () => {
  const records = fixture();
  const artifact = (id, revision, logicalKey, evidence, value = {}) => ({
    id,
    revision,
    logicalKey,
    value,
    evidenceIds: [evidence.id],
  });
  const artifacts = [
    artifact(
      "artifact:removed-base",
      binding.baseRevision,
      "removed",
      records.baseContractEvidence,
    ),
    artifact(
      "artifact:matched-head",
      binding.headRevision,
      "matched",
      records.headContractEvidence,
      { signature: "head" },
    ),
    artifact(
      "artifact:ambiguous-head-b",
      binding.headRevision,
      "ambiguous",
      records.headContractEvidence,
    ),
    artifact(
      "artifact:added-head",
      binding.headRevision,
      "added",
      records.headContractEvidence,
    ),
    artifact(
      "artifact:matched-base",
      binding.baseRevision,
      "matched",
      records.baseContractEvidence,
      { signature: "base" },
    ),
    artifact(
      "artifact:ambiguous-head-a",
      binding.headRevision,
      "ambiguous",
      records.headContractEvidence,
    ),
    artifact(
      "artifact:ambiguous-base",
      binding.baseRevision,
      "ambiguous",
      records.baseContractEvidence,
    ),
  ];
  const first = createContractComparisons({ ir: records.ir, artifacts });
  const second = createContractComparisons({
    ir: records.ir,
    artifacts: [...artifacts].reverse(),
  });

  assert.deepEqual(
    first.map((comparison) => [comparison.logicalKey, comparison.status]),
    [
      ["added", "added"],
      ["ambiguous", "ambiguous"],
      ["matched", "matched"],
      ["removed", "removed"],
    ],
  );
  assert.equal(first[1].head.length, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(artifacts[1].value, { signature: "head" });
});

test("contract matching rejects cross-revision, duplicate, and unprovable artifacts", () => {
  const records = fixture();
  const valid = {
    id: "artifact:valid",
    revision: binding.baseRevision,
    logicalKey: "valid",
    value: {},
    evidenceIds: [records.baseContractEvidence.id],
  };
  assert.throws(
    () =>
      createContractComparisons({
        ir: records.ir,
        artifacts: [{ ...valid, revision: "c".repeat(40) }],
      }),
    (error) =>
      error instanceof ContractRuleError &&
      error.code === "execution_input_invalid",
  );
  assert.throws(
    () =>
      createContractComparisons({
        ir: records.ir,
        artifacts: [valid, { ...valid }],
      }),
    ContractRuleError,
  );
  assert.throws(
    () =>
      createContractComparisons({
        ir: records.ir,
        artifacts: [
          {
            ...valid,
            evidenceIds: [records.headContractEvidence.id],
          },
        ],
      }),
    ContractRuleError,
  );
  assert.throws(
    () =>
      createContractComparisons({
        ir: records.ir,
        artifacts: [{ ...valid, value: { callback: () => undefined } }],
      }),
    ContractRuleError,
  );
});

test("evidence revision requirements are enforced for each finding", async () => {
  const records = fixture();
  const missingBase = definition("typescript.missing-base", () => ({
    findings: [
      {
        ...finding(records, "breaking", "The contract changed."),
        evidenceIds: [records.headContractEvidence.id],
      },
    ],
  }));
  const result = await executeContractRules([missingBase], {
    ir: records.ir,
    state: {},
  });

  assert.equal(result.status, "error");
  assert.deepEqual(result.changes, []);
  assert.equal(result.executions[0].status, "error");
  assert.equal(result.unknowns[0].type, "analyzer_gap");
  assert.equal(result.unknowns[0].blockingRelevance, "required");
  assert.equal(result.generatedEvidence.length, 1);
  assert.doesNotThrow(() =>
    validateEvidence(binding, result.generatedEvidence[0]),
  );
});

test("ambiguity stays unknown and makes execution incomplete", async () => {
  const records = fixture();
  const ambiguous = definition("typescript.ambiguous", () => ({
    findings: [
      finding(
        records,
        "unknown",
        "Two head contracts are equally plausible matches.",
      ),
    ],
    unknowns: [
      {
        type: "other",
        summary: "Contract identity is ambiguous across revisions.",
        locations: [
          records.headContractEvidence.location,
          records.baseContractEvidence.location,
        ].reverse(),
        evidenceIds: [
          records.baseContractEvidence.id,
          records.headContractEvidence.id,
        ],
        blockingRelevance: "required",
      },
    ],
  }));
  const result = await executeContractRules([ambiguous], {
    ir: records.ir,
    state: {},
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.executions[0].status, "incomplete");
  assert.equal(result.changes[0].compatibility, "unknown");
  assert.equal(result.unknowns[0].blockingRelevance, "required");
  assert.deepEqual(
    result.unknowns[0].locations.map((location) => location.revision),
    [binding.baseRevision, binding.headRevision],
  );
});

test("a crashing required rule fails closed without stopping later rules", async () => {
  const records = fixture();
  const crash = definition("typescript.a-crash", () => {
    throw new Error("host path: /Users/private/repository");
  });
  const healthy = definition("typescript.z-healthy", () => ({
    findings: [
      finding(records, "compatible", "The contract remains compatible."),
    ],
  }));
  const result = await executeContractRules([healthy, crash], {
    ir: records.ir,
    state: {},
  });

  assert.equal(result.status, "error");
  assert.deepEqual(
    result.executions.map((execution) => execution.status),
    ["error", "completed"],
  );
  assert.equal(result.changes.length, 1);
  assert.equal(result.unknowns[0].blockingRelevance, "required");
  assert.equal(canonicalJson(result).includes("/Users/private"), false);
});

test("rule inputs are isolated and frozen", async () => {
  const records = fixture();
  const mutate = definition("typescript.a-mutate", (context) => {
    context.state.values.push("mutated");
    return {};
  });
  const observe = definition("typescript.z-observe", (context) => {
    assert.deepEqual(context.state.values, ["original"]);
    assert.equal(Object.isFrozen(context.state), true);
    assert.equal(Object.isFrozen(context.ir), true);
    return {};
  });
  const sourceState = { values: ["original"] };
  const result = await executeContractRules([mutate, observe], {
    ir: records.ir,
    state: sourceState,
  });

  assert.equal(result.status, "error");
  assert.deepEqual(sourceState, { values: ["original"] });
  assert.deepEqual(
    result.executions.map((execution) => execution.status),
    ["error", "completed"],
  );
});

test("optional rule failures are visible but do not become required gaps", async () => {
  const records = fixture();
  const optional = definition(
    "typescript.optional",
    () => {
      throw new Error("optional failure");
    },
    { required: false },
  );
  const result = await executeContractRules([optional], {
    ir: records.ir,
    state: {},
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.executions[0].status, "error");
  assert.equal(result.unknowns[0].blockingRelevance, "possible");
});

test("registry rejects duplicate IDs and non-advisory Verify 0.1 rules", () => {
  const empty = definition("typescript.duplicate", () => ({}));
  assert.throws(
    () => new ContractRuleRegistry([empty, { ...empty, version: "2.0.0" }]),
    (error) =>
      error instanceof ContractRuleError &&
      error.code === "rule_definition_duplicate",
  );
  assert.throws(
    () =>
      new ContractRuleRegistry([
        { ...empty, blockingEligible: true, defaultMode: "blocking" },
      ]),
    (error) =>
      error instanceof ContractRuleError &&
      error.code === "rule_definition_invalid",
  );
});

test("rule versions change rule-set and finding identity", async () => {
  const records = fixture();
  const evaluator = () => ({
    findings: [finding(records, "breaking", "The public contract changed.")],
  });
  const first = await executeContractRules(
    [definition("typescript.versioned", evaluator)],
    { ir: records.ir, state: {} },
  );
  const second = await executeContractRules(
    [definition("typescript.versioned", evaluator, { version: "2.0.0" })],
    { ir: records.ir, state: {} },
  );

  assert.notEqual(first.ruleSetId, second.ruleSetId);
  assert.notEqual(first.changes[0].id, second.changes[0].id);
  assert.notDeepEqual(first.semanticDigest, second.semanticDigest);
});

test("invalid canonical IR and non-cloneable state are rejected before rules run", async () => {
  const records = fixture();
  const empty = definition("typescript.empty", () => ({}));
  const tampered = structuredClone(records.ir);
  tampered.evidence.reverse();
  await assert.rejects(
    executeContractRules([empty], { ir: tampered, state: {} }),
    (error) =>
      error instanceof ContractRuleError &&
      error.code === "execution_input_invalid",
  );
  await assert.rejects(
    executeContractRules([empty], {
      ir: records.ir,
      state: { callback: () => undefined },
    }),
    (error) =>
      error instanceof ContractRuleError &&
      error.code === "execution_input_invalid",
  );
});

test("an empty registry produces an explicit deterministic completed result", async () => {
  const records = fixture();
  const registry = new ContractRuleRegistry([]);
  const result = await registry.execute({ ir: records.ir, state: {} });

  assert.deepEqual(registry.list(), []);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.executions, []);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.unknowns, []);
  assert.match(result.ruleSetId, /^contract-rule-set:/u);
});
