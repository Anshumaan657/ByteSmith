import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import {
  createContractComparisons,
  executeContractRules,
  type ContractArtifact,
  type ContractComparison,
  type ContractRuleDefinition,
  type ContractRuleEvaluation,
  type ContractRuleFindingInput,
} from "@bytesmith/analyzer-sdk";
import {
  compareCodePoints,
  type SourceLocation,
} from "@bytesmith/impact-types";
import type { CanonicalIr, IrContract } from "@bytesmith/ir";
import { OpenApiAnalyzerError } from "./errors.js";
import type {
  OpenApiOperationContract,
  OpenApiParameterContract,
  OpenApiRevisionAnalysis,
  OpenApiSchemaContract,
  OpenApiSchemaValue,
} from "./types.js";

interface ContractContext {
  irContractId: string;
  name: string;
  location: SourceLocation;
}

interface RouteValue extends ContractContext {
  route: string;
  methods: string[];
}

interface OperationValue extends ContractContext {
  operation: OpenApiOperationContract;
}

interface SchemaValue extends ContractContext {
  schema: OpenApiSchemaContract;
}

interface OpenApiComparisonState {
  routes: ContractComparison<RouteValue>[];
  operations: ContractComparison<OperationValue>[];
  schemas: ContractComparison<SchemaValue>[];
}

function fail(message: string): never {
  throw new OpenApiAnalyzerError("analysis_comparison_invalid", message);
}

function validateBinding(
  ir: CanonicalIr,
  analysis: OpenApiRevisionAnalysis,
): void {
  if (
    analysis.repositoryId !== ir.repositoryId ||
    (analysis.revision !== ir.baseRevision &&
      analysis.revision !== ir.headRevision)
  ) {
    fail(
      "OpenAPI rules require revision analyses and canonical IR for the same exact comparison.",
    );
  }
}

function findIrContract(
  ir: CanonicalIr,
  revision: string,
  path: string,
  kind: IrContract["kind"],
  name: string,
): IrContract {
  const candidates = ir.contracts.filter(
    (contract) =>
      contract.revision === revision &&
      contract.location.path === path &&
      contract.kind === kind &&
      contract.name === name,
  );
  if (candidates.length !== 1)
    fail(
      `OpenAPI contract ${name} does not have exactly one revision-bound IR contract.`,
    );
  return candidates[0]!;
}

function operationName(operation: OpenApiOperationContract): string {
  return `${operation.method.toUpperCase()} ${operation.route}`;
}

function operationArtifacts(
  ir: CanonicalIr,
  analysis: OpenApiRevisionAnalysis,
): ContractArtifact<OperationValue>[] {
  return analysis.operations.map((operation) => {
    const contract = findIrContract(
      ir,
      analysis.revision,
      operation.path,
      "api_operation",
      operationName(operation),
    );
    return {
      id: stableId("openapi-operation-artifact", {
        revision: analysis.revision,
        path: operation.path,
        route: operation.route,
        method: operation.method,
      }),
      revision: analysis.revision,
      logicalKey: `${operation.path}\0${operation.route}\0${operation.method}`,
      value: {
        irContractId: contract.id,
        name: operationName(operation),
        location: structuredClone(contract.location),
        operation: structuredClone(operation),
      },
      evidenceIds: [...contract.evidenceIds],
    };
  });
}

function routeArtifacts(
  ir: CanonicalIr,
  analysis: OpenApiRevisionAnalysis,
): ContractArtifact<RouteValue>[] {
  const groups = new Map<string, OpenApiOperationContract[]>();
  for (const operation of analysis.operations) {
    const key = `${operation.path}\0${operation.route}`;
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }
  return [...groups.entries()].map(([logicalKey, operations]) => {
    operations.sort((left, right) =>
      compareCodePoints(left.method, right.method),
    );
    const first = operations[0]!;
    const contracts = operations.map((operation) =>
      findIrContract(
        ir,
        analysis.revision,
        operation.path,
        "api_operation",
        operationName(operation),
      ),
    );
    return {
      id: stableId("openapi-route-artifact", {
        revision: analysis.revision,
        path: first.path,
        route: first.route,
      }),
      revision: analysis.revision,
      logicalKey,
      value: {
        irContractId: contracts[0]!.id,
        name: first.route,
        location: structuredClone(contracts[0]!.location),
        route: first.route,
        methods: operations.map((operation) => operation.method),
      },
      evidenceIds: [
        ...new Set(contracts.flatMap((contract) => contract.evidenceIds)),
      ].sort(compareCodePoints),
    };
  });
}

function schemaArtifacts(
  ir: CanonicalIr,
  analysis: OpenApiRevisionAnalysis,
): ContractArtifact<SchemaValue>[] {
  return analysis.schemas.map((schema) => {
    const contract = findIrContract(
      ir,
      analysis.revision,
      schema.path,
      "schema",
      schema.name,
    );
    return {
      id: stableId("openapi-schema-artifact", {
        revision: analysis.revision,
        path: schema.path,
        name: schema.name,
      }),
      revision: analysis.revision,
      logicalKey: `${schema.path}\0${schema.name}`,
      value: {
        irContractId: contract.id,
        name: schema.name,
        location: structuredClone(contract.location),
        schema: structuredClone(schema),
      },
      evidenceIds: [...contract.evidenceIds],
    };
  });
}

export function createOpenApiRuleState(input: {
  ir: CanonicalIr;
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
}): OpenApiComparisonState {
  validateBinding(input.ir, input.baseAnalysis);
  validateBinding(input.ir, input.headAnalysis);
  if (
    input.baseAnalysis.revision !== input.ir.baseRevision ||
    input.headAnalysis.revision !== input.ir.headRevision
  ) {
    fail("OpenAPI base and head rule inputs are reversed or stale.");
  }
  return {
    routes: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...routeArtifacts(input.ir, input.baseAnalysis),
        ...routeArtifacts(input.ir, input.headAnalysis),
      ],
    }),
    operations: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...operationArtifacts(input.ir, input.baseAnalysis),
        ...operationArtifacts(input.ir, input.headAnalysis),
      ],
    }),
    schemas: createContractComparisons({
      ir: input.ir,
      artifacts: [
        ...schemaArtifacts(input.ir, input.baseAnalysis),
        ...schemaArtifacts(input.ir, input.headAnalysis),
      ],
    }),
  };
}

function artifact<Value>(
  comparison: ContractComparison<Value>,
  side: "base" | "head",
) {
  return comparison[side][0];
}

function component(
  value: ContractContext,
  name = value.name,
): ContractRuleFindingInput["component"] {
  return {
    id: value.irContractId,
    kind: "api",
    name,
    location: structuredClone(value.location),
  };
}

function finding(
  summary: string,
  compatibility: ContractRuleFindingInput["compatibility"],
  value: ContractContext,
  evidenceIds: readonly string[],
  evidenceRequirements: ContractRuleFindingInput["evidenceRequirements"],
  name = value.name,
): ContractRuleFindingInput {
  return {
    kind:
      summary.includes("schema") || name.includes(".") ? "schema" : "contract",
    summary,
    compatibility,
    component: component(value, name),
    evidenceIds,
    evidenceRequirements,
  };
}

function ambiguousUnknowns<State extends ContractContext>(
  comparisons: readonly ContractComparison<State>[],
) {
  return comparisons
    .filter((comparison) => comparison.status === "ambiguous")
    .map((comparison) => ({
      type: "analyzer_gap" as const,
      summary: `OpenAPI contract ${comparison.logicalKey.replaceAll("\0", " ")} is ambiguous across revisions.`,
      locations: [...comparison.base, ...comparison.head].map(
        (item) => item.value.location,
      ),
      evidenceIds: comparison.evidenceIds,
      blockingRelevance: "required" as const,
    }));
}

function routeRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of state.routes) {
    if (comparison.status !== "removed") continue;
    const base = artifact(comparison, "base")!;
    findings.push(
      finding(
        `OpenAPI route ${base.value.route} was removed.`,
        "breaking",
        base.value,
        base.evidenceIds,
        ["base"],
      ),
    );
  }
  return { findings, unknowns: ambiguousUnknowns(state.routes) };
}

function methodRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  const headRoutes = new Set(
    state.routes
      .filter((item) => item.head.length === 1)
      .map((item) => item.logicalKey),
  );
  for (const comparison of state.operations) {
    if (comparison.status !== "removed") continue;
    const base = artifact(comparison, "base")!;
    const routeKey = `${base.value.operation.path}\0${base.value.operation.route}`;
    if (!headRoutes.has(routeKey)) continue;
    findings.push(
      finding(
        `OpenAPI method ${base.value.operation.method.toUpperCase()} was removed from route ${base.value.operation.route}.`,
        "breaking",
        base.value,
        base.evidenceIds,
        ["base"],
      ),
    );
  }
  return { findings, unknowns: ambiguousUnknowns(state.operations) };
}

function parameterMap(
  values: readonly OpenApiParameterContract[],
): Map<string, OpenApiParameterContract> {
  return new Map(values.map((value) => [`${value.in}:${value.name}`, value]));
}

function parameterRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of state.operations.filter(
    (item) => item.status === "matched",
  )) {
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = parameterMap(base.value.operation.parameters);
    const after = parameterMap(head.value.operation.parameters);
    for (const [key, parameter] of after) {
      const previous = before.get(key);
      const evidenceIds = [...base.evidenceIds, ...head.evidenceIds];
      if (!previous && parameter.required) {
        findings.push(
          finding(
            `OpenAPI operation ${head.value.name} added required ${parameter.in} parameter ${parameter.name}.`,
            "breaking",
            head.value,
            head.evidenceIds,
            ["head"],
          ),
        );
      } else if (!previous) {
        findings.push(
          finding(
            `OpenAPI operation ${head.value.name} added optional ${parameter.in} parameter ${parameter.name}.`,
            "compatible",
            head.value,
            head.evidenceIds,
            ["head"],
          ),
        );
      } else if (!previous.required && parameter.required) {
        findings.push(
          finding(
            `OpenAPI parameter ${parameter.name} changed from optional to required.`,
            "breaking",
            head.value,
            evidenceIds,
            ["base", "head"],
          ),
        );
      } else if (
        canonicalJson(previous.schema) !== canonicalJson(parameter.schema)
      ) {
        findings.push(
          finding(
            `OpenAPI parameter ${parameter.name} schema changed.`,
            "breaking",
            head.value,
            evidenceIds,
            ["base", "head"],
          ),
        );
      }
    }
  }
  return { findings };
}

function requestBodyRule(
  state: OpenApiComparisonState,
): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of state.operations.filter(
    (item) => item.status === "matched",
  )) {
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = base.value.operation.requestBody;
    const after = head.value.operation.requestBody;
    const evidenceIds = [...base.evidenceIds, ...head.evidenceIds];
    if (!before && after?.required) {
      findings.push(
        finding(
          `OpenAPI operation ${head.value.name} added a required request body.`,
          "breaking",
          head.value,
          head.evidenceIds,
          ["head"],
        ),
      );
      continue;
    }
    if (!before || !after) continue;
    if (!before.required && after.required) {
      findings.push(
        finding(
          `OpenAPI operation ${head.value.name} made its request body required.`,
          "breaking",
          head.value,
          evidenceIds,
          ["base", "head"],
        ),
      );
    }
    const afterMedia = new Set(after.content.map((item) => item.mediaType));
    for (const media of before.content) {
      if (!afterMedia.has(media.mediaType)) {
        findings.push(
          finding(
            `OpenAPI operation ${head.value.name} removed request media type ${media.mediaType}.`,
            "breaking",
            head.value,
            evidenceIds,
            ["base", "head"],
          ),
        );
      }
    }
  }
  return { findings };
}

interface FlatField {
  name: string;
  schema: OpenApiSchemaValue;
  required: boolean;
}

function flattenFields(
  schema: OpenApiSchemaValue,
  prefix = "",
): Map<string, FlatField> {
  const result = new Map<string, FlatField>();
  const required = new Set(schema.required);
  for (const [name, value] of Object.entries(schema.properties)) {
    const fieldName = prefix ? `${prefix}.${name}` : name;
    result.set(fieldName, {
      name: fieldName,
      schema: value,
      required: required.has(name),
    });
    for (const [nestedName, nested] of flattenFields(value, fieldName))
      result.set(nestedName, nested);
  }
  return result;
}

function matchedSchemas(state: OpenApiComparisonState) {
  return state.schemas.filter((comparison) => comparison.status === "matched");
}

function schemaFieldRule(
  state: OpenApiComparisonState,
): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of state.schemas) {
    if (comparison.status === "removed") {
      const base = artifact(comparison, "base")!;
      findings.push(
        finding(
          `OpenAPI schema ${base.value.name} was removed.`,
          "breaking",
          base.value,
          base.evidenceIds,
          ["base"],
        ),
      );
      continue;
    }
    if (comparison.status !== "matched") continue;
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = flattenFields(base.value.schema.value);
    const after = flattenFields(head.value.schema.value);
    for (const [name] of before) {
      if (!after.has(name)) {
        findings.push(
          finding(
            `OpenAPI schema field ${base.value.name}.${name} was removed.`,
            "breaking",
            base.value,
            base.evidenceIds,
            ["base"],
            `${base.value.name}.${name}`,
          ),
        );
      }
    }
    for (const [name, field] of after) {
      if (!before.has(name)) {
        findings.push(
          finding(
            `OpenAPI schema field ${head.value.name}.${name} was added${field.required ? " as required" : " as optional"}.`,
            field.required ? "breaking" : "compatible",
            head.value,
            head.evidenceIds,
            ["head"],
            `${head.value.name}.${name}`,
          ),
        );
      }
    }
  }
  return { findings, unknowns: ambiguousUnknowns(state.schemas) };
}

function schemaTypeRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of matchedSchemas(state)) {
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = flattenFields(base.value.schema.value);
    const after = flattenFields(head.value.schema.value);
    for (const [name, previous] of before) {
      const current = after.get(name);
      if (!current) continue;
      const oldType = `${previous.schema.type ?? "unknown"}${previous.schema.format ? `:${previous.schema.format}` : ""}${previous.schema.nullable ? "?" : ""}`;
      const newType = `${current.schema.type ?? "unknown"}${current.schema.format ? `:${current.schema.format}` : ""}${current.schema.nullable ? "?" : ""}`;
      if (oldType !== newType) {
        findings.push(
          finding(
            `OpenAPI schema field ${head.value.name}.${name} changed type from ${oldType} to ${newType}.`,
            "breaking",
            head.value,
            [...base.evidenceIds, ...head.evidenceIds],
            ["base", "head"],
            `${head.value.name}.${name}`,
          ),
        );
      }
    }
  }
  return { findings };
}

function requiredRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of matchedSchemas(state)) {
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = flattenFields(base.value.schema.value);
    const after = flattenFields(head.value.schema.value);
    for (const [name, current] of after) {
      const previous = before.get(name);
      if (previous && !previous.required && current.required) {
        findings.push(
          finding(
            `OpenAPI schema field ${head.value.name}.${name} changed from optional to required.`,
            "breaking",
            head.value,
            [...base.evidenceIds, ...head.evidenceIds],
            ["base", "head"],
            `${head.value.name}.${name}`,
          ),
        );
      }
    }
  }
  return { findings };
}

function enumRule(state: OpenApiComparisonState): ContractRuleEvaluation {
  const findings: ContractRuleFindingInput[] = [];
  for (const comparison of matchedSchemas(state)) {
    const base = artifact(comparison, "base")!;
    const head = artifact(comparison, "head")!;
    const before = flattenFields(base.value.schema.value);
    const after = flattenFields(head.value.schema.value);
    for (const [name, previous] of before) {
      const current = after.get(name);
      if (!current || !previous.schema.enum || !current.schema.enum) continue;
      const currentValues = new Set(
        current.schema.enum.map((value) => JSON.stringify(value)),
      );
      const removed = previous.schema.enum.filter(
        (value) => !currentValues.has(JSON.stringify(value)),
      );
      if (removed.length > 0) {
        findings.push(
          finding(
            `OpenAPI schema field ${head.value.name}.${name} removed enum value${removed.length === 1 ? "" : "s"} ${removed.map((value) => JSON.stringify(value)).join(", ")}.`,
            "breaking",
            head.value,
            [...base.evidenceIds, ...head.evidenceIds],
            ["base", "head"],
            `${head.value.name}.${name}`,
          ),
        );
      }
    }
  }
  return { findings };
}

function supportRule(ir: CanonicalIr): ContractRuleEvaluation {
  return {
    unknowns: ir.gaps
      .filter((gap) =>
        gap.evidenceIds.some(
          (id) =>
            ir.evidence.find((evidence) => evidence.id === id)?.producer.id ===
            "bytesmith.openapi",
        ),
      )
      .map((gap) => ({
        type: gap.type,
        summary: gap.summary,
        locations: gap.locations,
        evidenceIds: gap.evidenceIds,
        blockingRelevance: gap.blockingRelevance,
      })),
  };
}

const metadata = {
  version: "1.0.0",
  family: "openapi" as const,
  required: true,
  defaultMode: "advisory" as const,
  blockingEligible: false as const,
};

export function createOpenApiRuleDefinitions(): ContractRuleDefinition<OpenApiComparisonState>[] {
  return [
    {
      ...metadata,
      id: "openapi.support",
      description:
        "Expose unsupported, unresolved, and ambiguous OpenAPI constructs.",
      evaluate: ({ ir }) => supportRule(ir),
    },
    {
      ...metadata,
      id: "openapi.routes",
      description: "Detect removed OpenAPI routes.",
      evaluate: ({ state }) => routeRule(state),
    },
    {
      ...metadata,
      id: "openapi.methods",
      description: "Detect removed HTTP methods on retained routes.",
      evaluate: ({ state }) => methodRule(state),
    },
    {
      ...metadata,
      id: "openapi.parameters",
      description: "Evaluate operation parameter compatibility.",
      evaluate: ({ state }) => parameterRule(state),
    },
    {
      ...metadata,
      id: "openapi.request-bodies",
      description:
        "Evaluate request-body requiredness and media compatibility.",
      evaluate: ({ state }) => requestBodyRule(state),
    },
    {
      ...metadata,
      id: "openapi.schema-fields",
      description: "Detect removed, added, and missing OpenAPI schema fields.",
      evaluate: ({ state }) => schemaFieldRule(state),
    },
    {
      ...metadata,
      id: "openapi.schema-types",
      description: "Detect incompatible OpenAPI field type changes.",
      evaluate: ({ state }) => schemaTypeRule(state),
    },
    {
      ...metadata,
      id: "openapi.schema-required",
      description: "Detect optional OpenAPI fields made required.",
      evaluate: ({ state }) => requiredRule(state),
    },
    {
      ...metadata,
      id: "openapi.schema-enums",
      description: "Detect removed OpenAPI enum values.",
      evaluate: ({ state }) => enumRule(state),
    },
  ];
}

export async function evaluateOpenApiContractRules(input: {
  ir: CanonicalIr;
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
}) {
  const state = createOpenApiRuleState(input);
  return executeContractRules(createOpenApiRuleDefinitions(), {
    ir: input.ir,
    state,
  });
}

export function openApiRuleSemanticKey(
  result: Awaited<ReturnType<typeof evaluateOpenApiContractRules>>,
): string {
  return canonicalJson({
    status: result.status,
    changes: result.changes,
    unknowns: result.unknowns,
    semanticDigest: result.semanticDigest,
  });
}
