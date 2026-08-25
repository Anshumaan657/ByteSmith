import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { stableId } from "@bytesmith/canonicalization";
import type {
  OpenApiOperationContract,
  OpenApiRevisionAnalysis,
  OpenApiSchemaValue,
} from "@bytesmith/contracts-openapi";
import { createEvidence } from "@bytesmith/evidence";
import type {
  ManifestChange,
  ManifestImpact,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import {
  compareCodePoints,
  normalizeRepositoryPath,
  type ComponentRef,
  type Evidence,
} from "@bytesmith/impact-types";
import type { CanonicalIr } from "@bytesmith/ir";
import { ConsumerAnalysisError } from "./errors.js";
import {
  consumerAnalyzerVersion,
  createConsumerImpact,
  finalizeConsumerResult,
  normalizeConsumerLimits,
  relevantChanges,
  validateConsumerIr,
} from "./pipeline.js";
import type {
  ConsumerAnalysisResult,
  ConsumerPath,
  OpenApiClientReference,
  OpenApiConsumerAnalysisInput,
} from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/u;
const testPattern = /(?:^|[./_-])(?:test|spec)(?:[./_-]|$)/iu;
const httpMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);
const clientNames = new Set(["api", "axios", "client", "http", "openapi"]);

interface DiscoveredReference {
  reference: OpenApiClientReference;
  evidence: Evidence;
}

interface DynamicReference {
  path: string;
  line: number;
  column: number;
  evidence: Evidence;
}

function validateBindings(
  ir: CanonicalIr,
  base: OpenApiRevisionAnalysis,
  head: OpenApiRevisionAnalysis,
): void {
  if (
    base.repositoryId !== ir.repositoryId ||
    head.repositoryId !== ir.repositoryId ||
    base.revision !== ir.baseRevision ||
    head.revision !== ir.headRevision
  ) {
    throw new ConsumerAnalysisError(
      "binding_mismatch",
      "OpenAPI consumer inputs belong to a different exact comparison.",
    );
  }
}

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
        await visit(absolute);
      } else if (
        entry.isFile() &&
        sourcePattern.test(entry.name) &&
        !testPattern.test(entry.name)
      ) {
        result.push(absolute);
      }
    }
  };
  await visit(root);
  return result;
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node) {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: location.line + 1, column: location.character + 1 };
}

function staticText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text.normalize("NFC");
  }
  return undefined;
}

function propertyName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text.toLowerCase();
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text.toLowerCase();
  }
  return ts.isIdentifier(node) ? node.text.toLowerCase() : undefined;
}

function clientObjectName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    const expression = node.expression;
    if (ts.isIdentifier(expression)) return expression.text.toLowerCase();
    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text.toLowerCase();
    }
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return node.expression.text.toLowerCase();
  }
  return undefined;
}

function methodFromOptions(
  node: ts.Expression | undefined,
): string | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "method") ||
        (ts.isStringLiteralLike(property.name) &&
          property.name.text === "method"))
    ) {
      return staticText(property.initializer)?.toLowerCase();
    }
  }
  return undefined;
}

function clientCall(node: ts.CallExpression): {
  recognized: boolean;
  route?: string;
  method?: string;
} {
  const name = propertyName(node.expression);
  if (!name) return { recognized: false };
  if (httpMethods.has(name)) {
    const owner = clientObjectName(node.expression);
    if (!owner || !clientNames.has(owner)) return { recognized: false };
    const route = staticText(node.arguments[0]);
    return { recognized: true, ...(route ? { route } : {}), method: name };
  }
  if (name !== "fetch" && name !== "request") return { recognized: false };
  const route = staticText(node.arguments[0]);
  const method = methodFromOptions(node.arguments[1]) ?? "get";
  return {
    recognized: true,
    ...(route ? { route } : {}),
    ...(httpMethods.has(method) ? { method } : {}),
  };
}

function declarationName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text.normalize("NFC");
    }
    if (
      (ts.isMethodDeclaration(current) || ts.isMethodSignature(current)) &&
      current.name &&
      (ts.isIdentifier(current.name) || ts.isStringLiteralLike(current.name))
    ) {
      return current.name.text.normalize("NFC");
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(current.initializer) ||
        ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text.normalize("NFC");
    }
    current = current.parent;
  }
  return undefined;
}

function schemaReferences(
  schema: OpenApiSchemaValue | undefined,
  result = new Set<string>(),
): Set<string> {
  if (!schema) return result;
  if (schema.reference) result.add(schema.reference);
  for (const property of Object.values(schema.properties)) {
    schemaReferences(property, result);
  }
  schemaReferences(schema.items, result);
  return result;
}

function operationKey(operation: OpenApiOperationContract): string {
  return `${operation.method}\0${operation.route}`;
}

function operationUsesSchema(
  operation: OpenApiOperationContract,
  schemaName: string,
): boolean {
  const target = `#/components/schemas/${schemaName}`;
  for (const media of operation.requestBody?.content ?? []) {
    if (schemaReferences(media.schema).has(target)) return true;
  }
  for (const response of operation.responses) {
    for (const media of response.content) {
      if (schemaReferences(media.schema).has(target)) return true;
    }
  }
  return false;
}

function affectedOperations(
  change: ManifestChange,
  base: OpenApiRevisionAnalysis,
  head: OpenApiRevisionAnalysis,
): Set<string> {
  const operations = [...base.operations, ...head.operations];
  const result = new Set<string>();
  const name = change.component.name;
  for (const operation of operations) {
    const display = `${operation.method.toUpperCase()} ${operation.route}`;
    if (
      name === operation.route ||
      name === display ||
      name.startsWith(`${display} request `) ||
      name.startsWith(`${display} response `)
    ) {
      result.add(operationKey(operation));
    }
  }
  const schemaName = name.split(".")[0]!;
  for (const operation of operations) {
    if (operationUsesSchema(operation, schemaName)) {
      result.add(operationKey(operation));
    }
  }
  return result;
}

function callerIrId(
  ir: CanonicalIr,
  path: string,
  callerName: string | undefined,
): string | undefined {
  if (!callerName) return undefined;
  const candidates = ir.symbols.filter(
    (symbol) =>
      symbol.revision === ir.headRevision &&
      symbol.location.path === path &&
      (symbol.name === callerName || symbol.name.endsWith(`.${callerName}`)),
  );
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}

async function discoverClientReferences(input: {
  ir: CanonicalIr;
  directory: string;
  analyzerVersion: string;
}): Promise<{
  references: DiscoveredReference[];
  dynamic: DynamicReference[];
}> {
  const root = resolve(input.directory);
  const evidenceContext = {
    repositoryId: input.ir.repositoryId,
    baseRevision: input.ir.baseRevision,
    headRevision: input.ir.headRevision,
    producer: {
      id: "bytesmith.consumer-analysis",
      version: input.analyzerVersion,
    },
  };
  let files: string[];
  try {
    files = await sourceFiles(root);
  } catch (cause) {
    throw new ConsumerAnalysisError(
      "repository_unreadable",
      "OpenAPI client source snapshot cannot be read.",
      cause,
    );
  }
  const references: DiscoveredReference[] = [];
  const dynamic: DynamicReference[] = [];
  for (const absolute of files) {
    const path = normalizeRepositoryPath(
      relative(root, absolute).split(sep).join("/"),
    );
    const contents = await readFile(absolute, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      contents,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const call = clientCall(node);
        if (call.recognized) {
          const location = sourceLocation(sourceFile, node);
          const callerName = declarationName(node);
          if (call.route && call.method) {
            const evidence = createEvidence(evidenceContext, {
              kind: "call",
              revision: input.ir.headRevision,
              path,
              startLine: location.line,
              startColumn: location.column,
              summary: `Static OpenAPI client call resolves to ${call.method.toUpperCase()} ${call.route}.`,
            });
            const recordWithoutId = {
              revision: input.ir.headRevision,
              path,
              line: location.line,
              column: location.column,
              route: call.route,
              method: call.method,
              ...(callerName ? { callerName } : {}),
              ...(callerName
                ? {
                    callerIrId: callerIrId(input.ir, path, callerName),
                  }
                : {}),
              evidenceId: evidence.id,
            };
            const normalized = Object.fromEntries(
              Object.entries(recordWithoutId).filter(
                ([, value]) => value !== undefined,
              ),
            ) as Omit<OpenApiClientReference, "id">;
            references.push({
              reference: {
                id: stableId("openapi-client-reference", normalized),
                ...normalized,
              },
              evidence,
            });
          } else {
            const evidence = createEvidence(evidenceContext, {
              kind: "call",
              revision: input.ir.headRevision,
              path,
              startLine: location.line,
              startColumn: location.column,
              summary:
                "OpenAPI-like client call uses a dynamic route or HTTP method.",
            });
            dynamic.push({ path, ...location, evidence });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  references.sort((left, right) =>
    compareCodePoints(left.reference.id, right.reference.id),
  );
  dynamic.sort((left, right) =>
    compareCodePoints(left.evidence.id, right.evidence.id),
  );
  return { references, dynamic };
}

function componentForReference(
  ir: CanonicalIr,
  reference: OpenApiClientReference,
): ComponentRef {
  const symbol = reference.callerIrId
    ? ir.symbols.find((candidate) => candidate.id === reference.callerIrId)
    : undefined;
  if (symbol) {
    return {
      id: symbol.id,
      kind: "symbol",
      name: symbol.name,
      location: structuredClone(symbol.location),
    };
  }
  const name = reference.callerName ?? reference.path;
  return {
    id: stableId("openapi-client-component", {
      repositoryId: ir.repositoryId,
      revision: reference.revision,
      path: reference.path,
      name,
    }),
    kind: reference.callerName ? "symbol" : "file",
    name,
    location: {
      repository: ir.repositoryId,
      revision: reference.revision,
      path: reference.path,
      startLine: reference.line,
      startColumn: reference.column,
    },
  };
}

export async function analyzeOpenApiConsumers(
  input: OpenApiConsumerAnalysisInput,
): Promise<ConsumerAnalysisResult> {
  validateConsumerIr(input.ir);
  validateBindings(input.ir, input.baseAnalysis, input.headAnalysis);
  if (!isAbsolute(input.headDirectory)) {
    throw new ConsumerAnalysisError(
      "input_invalid",
      "OpenAPI client snapshot directory must be absolute.",
    );
  }
  normalizeConsumerLimits(input.limits);
  const analyzerVersion = consumerAnalyzerVersion(input.analyzerVersion);
  const changes = relevantChanges(input.changes);
  const discovered = await discoverClientReferences({
    ir: input.ir,
    directory: input.headDirectory,
    analyzerVersion,
  });
  const paths: ConsumerPath[] = [];
  const impacts: ManifestImpact[] = [];
  const usedEvidence = new Set<string>();
  for (const change of changes) {
    const affected = affectedOperations(
      change,
      input.baseAnalysis,
      input.headAnalysis,
    );
    for (const { reference } of discovered.references) {
      if (!affected.has(`${reference.method}\0${reference.route}`)) continue;
      const component = componentForReference(input.ir, reference);
      const edge = {
        relationshipId: reference.id,
        fromId: component.id,
        toId: change.component.id,
        evidenceIds: [reference.evidenceId],
      };
      const record = {
        sourceChangeId: change.id,
        category: "direct" as const,
        affectedComponentId: component.id,
        depth: 1,
        edges: [edge],
        evidenceIds: [reference.evidenceId],
      };
      paths.push({ id: stableId("consumer-path", record), ...record });
      impacts.push(
        createConsumerImpact({
          ruleId: "openapi.direct-consumer",
          category: "direct",
          change,
          component,
          evidenceIds: [reference.evidenceId],
        }),
      );
      usedEvidence.add(reference.evidenceId);
    }
  }
  const unknowns: ManifestUnknown[] = discovered.dynamic.map((dynamic) => {
    usedEvidence.add(dynamic.evidence.id);
    const record = {
      type: "analyzer_gap" as const,
      summary:
        "A dynamic OpenAPI-like client call could not be linked to a specific changed operation.",
      locations: [
        {
          repository: input.ir.repositoryId,
          revision: input.ir.headRevision,
          path: dynamic.path,
          startLine: dynamic.line,
          startColumn: dynamic.column,
        },
      ],
      evidenceIds: [dynamic.evidence.id],
      blockingRelevance: "possible" as const,
    };
    return { id: stableId("consumer-unknown", record), ...record };
  });
  const generatedEvidence = [
    ...discovered.references.map((value) => value.evidence),
    ...discovered.dynamic.map((value) => value.evidence),
  ].filter((evidence) => usedEvidence.has(evidence.id));
  return finalizeConsumerResult({
    ir: input.ir,
    analyzerVersion,
    family: "openapi",
    paths,
    impacts,
    unknowns,
    generatedEvidence,
  });
}
