import { createHash } from "node:crypto";
import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import { createEvidence, createSourceLocation } from "@bytesmith/evidence";
import type {
  ManifestChange,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateStableId,
  type ComponentKind,
  type ComponentRef,
  type Evidence,
  type SourceLocation,
} from "@bytesmith/impact-types";
import { validateCanonicalIr } from "@bytesmith/ir";
import { ContractRuleError } from "./errors.js";
import type {
  ContractRuleDefinition,
  ContractRuleEvaluation,
  ContractRuleExecution,
  ContractRuleExecutionInput,
  ContractRuleExecutionResult,
  ContractRuleExecutionStatus,
  ContractRuleFinding,
  ContractRuleFindingInput,
  ContractRuleMetadata,
  ContractRuleUnknownInput,
  EvidenceRevisionRequirement,
} from "./types.js";

const ruleFamilies = new Set(["shared", "typescript", "openapi"]);
const changeKinds = new Set([
  "symbol",
  "contract",
  "schema",
  "event",
  "configuration",
  "dependency",
  "infrastructure",
]);
const compatibilities = new Set([
  "compatible",
  "potentially_breaking",
  "breaking",
  "unknown",
]);
const componentKinds = new Set<ComponentKind>([
  "file",
  "module",
  "package",
  "symbol",
  "api",
  "graphql",
  "event",
  "database",
  "config",
  "infrastructure",
  "test",
  "service",
  "repository",
]);
const unknownTypes = new Set([
  "unsupported_file",
  "dynamic_import",
  "reflection",
  "generated_code",
  "missing_repository",
  "unresolved_symbol",
  "analyzer_gap",
  "other",
]);
const blockingRelevances = new Set(["none", "possible", "required"]);
const validEvidenceRequirements = new Set<EvidenceRevisionRequirement>([
  "base",
  "head",
]);

interface NormalizedRule<State> extends ContractRuleMetadata {
  evaluate: ContractRuleDefinition<State>["evaluate"];
}

function fail(
  code: ConstructorParameters<typeof ContractRuleError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new ContractRuleError(code, message, cause);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function cloneForRule<T>(value: T, description: string): Readonly<T> {
  try {
    return deepFreeze(structuredClone(value));
  } catch (cause) {
    fail(
      "execution_input_invalid",
      `${description} must be structured-cloneable.`,
      cause,
    );
  }
}

function normalizeRule<State>(
  definition: ContractRuleDefinition<State>,
): NormalizedRule<State> {
  try {
    if (!ruleFamilies.has(definition.family)) {
      fail("rule_definition_invalid", "Contract rule family is invalid.");
    }
    if (
      definition.defaultMode !== "advisory" ||
      definition.blockingEligible !== false
    ) {
      fail(
        "rule_definition_invalid",
        "Verify 0.1 contract rules must be advisory and ineligible for blocking.",
      );
    }
    if (typeof definition.required !== "boolean") {
      fail("rule_definition_invalid", "Contract rule requiredness is invalid.");
    }
    if (typeof definition.evaluate !== "function") {
      fail("rule_definition_invalid", "Contract rule evaluator is missing.");
    }
    return Object.freeze({
      id: validateStableId(definition.id, "Contract rule ID"),
      version: normalizeNonEmptyText(
        definition.version,
        "Contract rule version",
      ),
      family: definition.family,
      description: normalizeNonEmptyText(
        definition.description,
        "Contract rule description",
      ),
      required: definition.required,
      defaultMode: "advisory" as const,
      blockingEligible: false as const,
      evaluate: definition.evaluate,
    });
  } catch (cause) {
    if (cause instanceof ContractRuleError) throw cause;
    fail(
      "rule_definition_invalid",
      "Contract rule definition is invalid.",
      cause,
    );
  }
}

function compareRules<State>(
  left: NormalizedRule<State>,
  right: NormalizedRule<State>,
): number {
  return (
    compareCodePoints(left.id, right.id) ||
    compareCodePoints(left.version, right.version)
  );
}

function normalizeEvidenceIds(
  values: readonly string[],
  evidenceById: ReadonlyMap<string, Evidence>,
  description: string,
): string[] {
  if (values.length === 0) {
    fail("rule_output_invalid", `${description} must reference evidence.`);
  }
  const ids = values.map((value) => {
    try {
      return validateStableId(value, `${description} evidence ID`);
    } catch (cause) {
      fail(
        "rule_output_invalid",
        `${description} references invalid evidence.`,
        cause,
      );
    }
  });
  if (new Set(ids).size !== ids.length) {
    fail("rule_output_invalid", `${description} repeats evidence.`);
  }
  for (const id of ids) {
    if (!evidenceById.has(id)) {
      fail(
        "rule_output_invalid",
        `${description} references missing evidence.`,
      );
    }
  }
  if (ids.every((id) => evidenceById.get(id)?.kind === "heuristic")) {
    fail(
      "rule_output_invalid",
      `${description} cannot rely only on heuristic evidence.`,
    );
  }
  return ids.sort(compareCodePoints);
}

function locationFields(location: SourceLocation) {
  return {
    revision: location.revision,
    path: location.path,
    ...(location.startLine === undefined
      ? {}
      : { startLine: location.startLine }),
    ...(location.startColumn === undefined
      ? {}
      : { startColumn: location.startColumn }),
    ...(location.endLine === undefined ? {} : { endLine: location.endLine }),
    ...(location.endColumn === undefined
      ? {}
      : { endColumn: location.endColumn }),
  };
}

function compareLocations(left: SourceLocation, right: SourceLocation): number {
  return (
    compareCodePoints(left.repository, right.repository) ||
    compareCodePoints(left.revision, right.revision) ||
    compareCodePoints(left.path, right.path) ||
    (left.startLine ?? 0) - (right.startLine ?? 0) ||
    (left.startColumn ?? 0) - (right.startColumn ?? 0) ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

function normalizeLocation(
  binding: ContractRuleExecutionResult["binding"],
  location: SourceLocation,
): SourceLocation {
  if (location.repository !== binding.repositoryId) {
    fail(
      "rule_output_invalid",
      "Contract rule location belongs to a different repository.",
    );
  }
  try {
    return createSourceLocation(binding, locationFields(location));
  } catch (cause) {
    fail("rule_output_invalid", "Contract rule location is invalid.", cause);
  }
}

function normalizeComponent(
  binding: ContractRuleExecutionResult["binding"],
  component: ComponentRef,
): ComponentRef {
  try {
    if (!componentKinds.has(component.kind)) {
      fail("rule_output_invalid", "Contract change component kind is invalid.");
    }
    return {
      id: validateStableId(component.id, "Contract change component ID"),
      kind: component.kind,
      name: normalizeNonEmptyText(
        component.name,
        "Contract change component name",
      ),
      ...(component.location
        ? { location: normalizeLocation(binding, component.location) }
        : {}),
    };
  } catch (cause) {
    if (cause instanceof ContractRuleError) throw cause;
    fail("rule_output_invalid", "Contract change component is invalid.", cause);
  }
}

function normalizeRequirements(
  values: readonly EvidenceRevisionRequirement[],
): EvidenceRevisionRequirement[] {
  if (
    values.length === 0 ||
    values.some((value) => !validEvidenceRequirements.has(value))
  ) {
    fail(
      "rule_output_invalid",
      "Contract change evidence requirements are invalid.",
    );
  }
  if (new Set(values).size !== values.length) {
    fail(
      "rule_output_invalid",
      "Contract change evidence requirements contain duplicates.",
    );
  }
  return [...values].sort(compareCodePoints);
}

function normalizeFinding(
  binding: ContractRuleExecutionResult["binding"],
  rule: NormalizedRule<unknown>,
  input: ContractRuleFindingInput,
  evidenceById: ReadonlyMap<string, Evidence>,
): ContractRuleFinding {
  if (!changeKinds.has(input.kind)) {
    fail("rule_output_invalid", "Contract change kind is invalid.");
  }
  if (!compatibilities.has(input.compatibility)) {
    fail("rule_output_invalid", "Contract compatibility is invalid.");
  }
  const summary = normalizeNonEmptyText(
    input.summary,
    "Contract change summary",
  );
  const component = normalizeComponent(binding, input.component);
  const evidenceIds = normalizeEvidenceIds(
    input.evidenceIds,
    evidenceById,
    "Contract change",
  );
  const requirements = normalizeRequirements(input.evidenceRequirements);
  for (const requirement of requirements) {
    const revision =
      requirement === "base" ? binding.baseRevision : binding.headRevision;
    if (
      !evidenceIds.some(
        (id) => evidenceById.get(id)?.location.revision === revision,
      )
    ) {
      fail(
        "rule_output_invalid",
        `Contract change is missing required ${requirement} evidence.`,
      );
    }
  }
  const id = stableId("contract-change", {
    binding,
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: input.kind,
    summary,
    compatibility: input.compatibility,
    component,
    evidenceIds,
  });
  const change: ManifestChange = {
    id,
    kind: input.kind,
    summary,
    compatibility: input.compatibility,
    component,
    evidenceIds,
  };
  return {
    id,
    ruleId: rule.id,
    ruleVersion: rule.version,
    family: rule.family,
    description: rule.description,
    required: rule.required,
    defaultMode: rule.defaultMode,
    blockingEligible: rule.blockingEligible,
    change,
    evidenceRequirements: requirements,
  };
}

function normalizeUnknown(
  binding: ContractRuleExecutionResult["binding"],
  rule: NormalizedRule<unknown>,
  input: ContractRuleUnknownInput,
  evidenceById: ReadonlyMap<string, Evidence>,
): ManifestUnknown {
  if (!unknownTypes.has(input.type)) {
    fail("rule_output_invalid", "Contract rule unknown type is invalid.");
  }
  if (!blockingRelevances.has(input.blockingRelevance)) {
    fail(
      "rule_output_invalid",
      "Contract rule unknown blocking relevance is invalid.",
    );
  }
  const summary = normalizeNonEmptyText(
    input.summary,
    "Contract rule unknown summary",
  );
  const evidenceIds = normalizeEvidenceIds(
    input.evidenceIds,
    evidenceById,
    "Contract rule unknown",
  );
  const locations = input.locations
    .map((location) => normalizeLocation(binding, location))
    .sort(compareLocations);
  return {
    id: stableId("contract-rule-unknown", {
      binding,
      ruleId: rule.id,
      ruleVersion: rule.version,
      type: input.type,
      summary,
      locations,
      evidenceIds,
      blockingRelevance: input.blockingRelevance,
    }),
    type: input.type,
    summary,
    locations,
    evidenceIds,
    blockingRelevance: input.blockingRelevance,
  };
}

function normalizeDiagnostics(values: readonly string[] = []): string[] {
  return [
    ...new Set(
      values.map((value) =>
        normalizeNonEmptyText(value, "Contract rule diagnostic"),
      ),
    ),
  ].sort(compareCodePoints);
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function failureResult<State>(
  binding: ContractRuleExecutionResult["binding"],
  rule: NormalizedRule<State>,
): {
  execution: ContractRuleExecution;
  unknown: ManifestUnknown;
  evidence: Evidence;
} {
  const summary = `Contract rule ${rule.id}@${rule.version} failed during evaluation.`;
  const evidence = createEvidence(
    {
      ...binding,
      producer: { id: rule.id, version: rule.version },
    },
    {
      kind: "runtime",
      revision: binding.headRevision,
      path: "bytesmith-contract-rules",
      summary,
    },
  );
  const unknown: ManifestUnknown = {
    id: stableId("contract-rule-unknown", {
      binding,
      ruleId: rule.id,
      ruleVersion: rule.version,
      type: "analyzer_gap",
      summary,
      locations: [evidence.location],
      evidenceIds: [evidence.id],
      blockingRelevance: rule.required ? "required" : "possible",
    }),
    type: "analyzer_gap",
    summary,
    locations: [evidence.location],
    evidenceIds: [evidence.id],
    blockingRelevance: rule.required ? "required" : "possible",
  };
  return {
    execution: {
      ruleId: rule.id,
      ruleVersion: rule.version,
      family: rule.family,
      required: rule.required,
      status: "error",
      changeIds: [],
      unknownIds: [unknown.id],
      diagnostics: [summary],
    },
    unknown,
    evidence,
  };
}

function digestResult(
  value: Omit<ContractRuleExecutionResult, "semanticDigest">,
): ContractRuleExecutionResult["semanticDigest"] {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonicalJson(value)).digest("hex"),
  };
}

export class ContractRuleRegistry<State> {
  readonly #rules: readonly NormalizedRule<State>[];
  readonly ruleSetId: string;

  constructor(definitions: readonly ContractRuleDefinition<State>[]) {
    const rules = definitions.map(normalizeRule).sort(compareRules);
    const duplicate = rules.find(
      (rule, index) => index > 0 && rules[index - 1]?.id === rule.id,
    );
    if (duplicate) {
      fail(
        "rule_definition_duplicate",
        `Contract rule ID ${duplicate.id} is registered more than once.`,
      );
    }
    this.#rules = Object.freeze(rules);
    this.ruleSetId = stableId(
      "contract-rule-set",
      rules.map(
        ({
          id,
          version,
          family,
          description,
          required,
          defaultMode,
          blockingEligible,
        }) => ({
          id,
          version,
          family,
          description,
          required,
          defaultMode,
          blockingEligible,
        }),
      ),
    );
  }

  list(): ContractRuleMetadata[] {
    return this.#rules.map(
      ({
        id,
        version,
        family,
        description,
        required,
        defaultMode,
        blockingEligible,
      }) => ({
        id,
        version,
        family,
        description,
        required,
        defaultMode,
        blockingEligible,
      }),
    );
  }

  async execute(
    input: ContractRuleExecutionInput<State>,
  ): Promise<ContractRuleExecutionResult> {
    try {
      validateCanonicalIr(input.ir);
    } catch (cause) {
      fail(
        "execution_input_invalid",
        "Contract rules require valid canonical IR.",
        cause,
      );
    }
    const binding = {
      repositoryId: input.ir.repositoryId,
      baseRevision: input.ir.baseRevision,
      headRevision: input.ir.headRevision,
    };
    const evidenceById = new Map(
      input.ir.evidence.map((evidence) => [evidence.id, evidence]),
    );
    const ir = cloneForRule(input.ir, "Canonical IR");
    const cloneableState = cloneForRule(input.state, "Contract rule state");
    const executions: ContractRuleExecution[] = [];
    const findings: ContractRuleFinding[] = [];
    const unknowns: ManifestUnknown[] = [];
    const generatedEvidence: Evidence[] = [];

    for (const rule of this.#rules) {
      try {
        const state = cloneForRule(cloneableState, "Contract rule state");
        const evaluation: ContractRuleEvaluation = await rule.evaluate({
          binding,
          ir,
          state,
          rule,
        });
        if (typeof evaluation !== "object" || evaluation === null) {
          fail("rule_output_invalid", "Contract rule result is invalid.");
        }
        const ruleForNormalization = rule as NormalizedRule<unknown>;
        const ruleFindings = uniqueById(
          (evaluation.findings ?? []).map((finding) =>
            normalizeFinding(
              binding,
              ruleForNormalization,
              finding,
              evidenceById,
            ),
          ),
        );
        const ruleUnknowns = uniqueById(
          (evaluation.unknowns ?? []).map((unknown) =>
            normalizeUnknown(
              binding,
              ruleForNormalization,
              unknown,
              evidenceById,
            ),
          ),
        );
        const diagnostics = normalizeDiagnostics(evaluation.diagnostics);
        ruleFindings.sort((left, right) =>
          compareCodePoints(left.id, right.id),
        );
        ruleUnknowns.sort((left, right) =>
          compareCodePoints(left.id, right.id),
        );
        findings.push(...ruleFindings);
        unknowns.push(...ruleUnknowns);
        executions.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          family: rule.family,
          required: rule.required,
          status:
            ruleFindings.some(
              (finding) => finding.change.compatibility === "unknown",
            ) ||
            ruleUnknowns.some((unknown) => unknown.blockingRelevance !== "none")
              ? "incomplete"
              : "completed",
          changeIds: ruleFindings.map((finding) => finding.change.id),
          unknownIds: ruleUnknowns.map((unknown) => unknown.id),
          diagnostics,
        });
      } catch {
        const failure = failureResult(binding, rule);
        executions.push(failure.execution);
        unknowns.push(failure.unknown);
        generatedEvidence.push(failure.evidence);
      }
    }

    findings.sort((left, right) => compareCodePoints(left.id, right.id));
    unknowns.sort((left, right) => compareCodePoints(left.id, right.id));
    generatedEvidence.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    );
    const changes = findings.map((finding) => finding.change);
    const status: ContractRuleExecutionStatus = executions.some(
      (execution) => execution.required && execution.status === "error",
    )
      ? "error"
      : executions.some((execution) => execution.status !== "completed")
        ? "incomplete"
        : "completed";
    const resultWithoutDigest = {
      schemaVersion: "1.0.0" as const,
      binding,
      ruleSetId: this.ruleSetId,
      status,
      executions,
      findings,
      changes,
      unknowns,
      generatedEvidence,
    };
    return {
      ...resultWithoutDigest,
      semanticDigest: digestResult(resultWithoutDigest),
    };
  }
}

export async function executeContractRules<State>(
  definitions: readonly ContractRuleDefinition<State>[],
  input: ContractRuleExecutionInput<State>,
): Promise<ContractRuleExecutionResult> {
  return new ContractRuleRegistry(definitions).execute(input);
}
