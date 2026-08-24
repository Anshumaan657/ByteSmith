import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stableId } from "@bytesmith/canonicalization";
import {
  compareCodePoints,
  normalizeRepositoryPath,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import { parseDocument } from "yaml";
import { OpenApiAnalyzerError } from "./errors.js";
import type {
  HttpMethod,
  OpenApiDocumentAnalysis,
  OpenApiGap,
  OpenApiMediaContract,
  OpenApiOperationContract,
  OpenApiParameterContract,
  OpenApiRevisionAnalysis,
  OpenApiSchemaContract,
  OpenApiSchemaValue,
  OpenApiVersion,
  OpenApiSnapshotInput,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const ignoredDirectories = new Set([".git", "node_modules"]);
const candidatePattern = /(?:^openapi|^swagger|\.openapi)\.(?:json|ya?ml)$/iu;
const httpMethods = new Set<HttpMethod>([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function scalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function lineOf(source: string, token: string): number {
  const index = source.indexOf(token);
  return index < 0 ? 1 : source.slice(0, index).split("\n").length;
}

function addGap(
  gaps: OpenApiGap[],
  path: string,
  code: OpenApiGap["code"],
  summary: string,
  line = 1,
): void {
  gaps.push({ path, line, column: 1, code, summary });
}

function decodePointerToken(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalReference(
  root: JsonObject,
  reference: string,
): unknown | undefined {
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const token of reference.slice(2).split("/").map(decodePointerToken)) {
    const record = object(current);
    if (!record || !(token in record)) return undefined;
    current = record[token];
  }
  return current;
}

interface SchemaContext {
  root: JsonObject;
  path: string;
  gaps: OpenApiGap[];
  references: string[];
}

function schemaValue(
  input: unknown,
  context: SchemaContext,
): OpenApiSchemaValue | undefined {
  const value = object(input);
  if (!value) return undefined;
  if (typeof value.$ref === "string") {
    const reference = value.$ref.normalize("NFC");
    if (!reference.startsWith("#/")) {
      addGap(
        context.gaps,
        context.path,
        "external_reference",
        `External OpenAPI reference ${reference} is unsupported.`,
      );
      return { nullable: false, required: [], properties: {}, reference };
    }
    if (context.references.includes(reference)) {
      addGap(
        context.gaps,
        context.path,
        "recursive_reference",
        `Recursive OpenAPI reference ${reference} was not expanded.`,
      );
      return { nullable: false, required: [], properties: {}, reference };
    }
    const target = resolveLocalReference(context.root, reference);
    if (target === undefined) {
      addGap(
        context.gaps,
        context.path,
        "unresolved_reference",
        `Local OpenAPI reference ${reference} does not resolve.`,
      );
      return { nullable: false, required: [], properties: {}, reference };
    }
    const resolved = schemaValue(target, {
      ...context,
      references: [...context.references, reference],
    });
    return resolved ? { ...resolved, reference } : undefined;
  }
  for (const keyword of [
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
  ]) {
    if (keyword in value) {
      addGap(
        context.gaps,
        context.path,
        "unsupported_schema",
        `OpenAPI schema keyword ${keyword} is unsupported.`,
      );
    }
  }
  let type: string | undefined;
  let nullable = value.nullable === true;
  if (typeof value.type === "string") {
    type = value.type.normalize("NFC");
  } else if (Array.isArray(value.type)) {
    const types = value.type.filter(
      (item): item is string => typeof item === "string",
    );
    const concrete = types.filter((item) => item !== "null");
    if (concrete.length === 1 && types.includes("null")) {
      type = concrete[0]!.normalize("NFC");
      nullable = true;
    } else {
      addGap(
        context.gaps,
        context.path,
        "unsupported_schema",
        "Multi-type OpenAPI schemas are unsupported unless they only add nullability.",
      );
    }
  }
  const required = Array.isArray(value.required)
    ? [
        ...new Set(
          value.required
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.normalize("NFC")),
        ),
      ].sort(compareCodePoints)
    : [];
  const properties: Record<string, OpenApiSchemaValue> = {};
  for (const [name, property] of Object.entries(
    object(value.properties) ?? {},
  ).sort(([left], [right]) => compareCodePoints(left, right))) {
    const normalized = schemaValue(property, context);
    if (normalized) properties[name.normalize("NFC")] = normalized;
  }
  const enumValues =
    Array.isArray(value.enum) && value.enum.every(scalar)
      ? [...value.enum].sort((left, right) =>
          compareCodePoints(JSON.stringify(left), JSON.stringify(right)),
        )
      : undefined;
  if (Array.isArray(value.enum) && !enumValues) {
    addGap(
      context.gaps,
      context.path,
      "unsupported_schema",
      "OpenAPI enum contains a non-scalar value.",
    );
  }
  const items = schemaValue(value.items, context);
  return {
    ...(type ? { type } : {}),
    ...(typeof value.format === "string"
      ? { format: value.format.normalize("NFC") }
      : {}),
    nullable,
    required,
    ...(enumValues ? { enum: enumValues } : {}),
    properties,
    ...(items ? { items } : {}),
  };
}

function dereferenceObject(
  input: unknown,
  root: JsonObject,
  path: string,
  gaps: OpenApiGap[],
): JsonObject | undefined {
  const value = object(input);
  if (!value || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) {
    addGap(
      gaps,
      path,
      "external_reference",
      `External OpenAPI reference ${value.$ref} is unsupported.`,
    );
    return undefined;
  }
  const resolved = object(resolveLocalReference(root, value.$ref));
  if (!resolved) {
    addGap(
      gaps,
      path,
      "unresolved_reference",
      `Local OpenAPI reference ${value.$ref} does not resolve.`,
    );
  }
  return resolved;
}

function mediaContracts(
  input: unknown,
  context: SchemaContext,
): OpenApiMediaContract[] {
  return Object.entries(object(input) ?? {})
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([mediaType, media]) => {
      const schema = schemaValue(object(media)?.schema, context);
      return {
        mediaType: mediaType.normalize("NFC"),
        ...(schema ? { schema } : {}),
      };
    });
}

function parameters(
  inputs: unknown[],
  root: JsonObject,
  path: string,
  source: string,
  gaps: OpenApiGap[],
): OpenApiParameterContract[] {
  const values: OpenApiParameterContract[] = [];
  for (const input of inputs) {
    const parameter = dereferenceObject(input, root, path, gaps);
    if (!parameter || typeof parameter.name !== "string") continue;
    if (
      !new Set(["cookie", "header", "path", "query"]).has(String(parameter.in))
    ) {
      addGap(
        gaps,
        path,
        "unsupported_schema",
        `OpenAPI parameter ${parameter.name} has an unsupported location.`,
      );
      continue;
    }
    const name = parameter.name.normalize("NFC");
    const schema = schemaValue(parameter.schema, {
      root,
      path,
      gaps,
      references: [],
    });
    values.push({
      name,
      in: parameter.in as OpenApiParameterContract["in"],
      required: parameter.in === "path" || parameter.required === true,
      path,
      line: lineOf(source, name),
      column: 1,
      ...(schema ? { schema } : {}),
    });
  }
  return values.sort((left, right) =>
    compareCodePoints(`${left.in}:${left.name}`, `${right.in}:${right.name}`),
  );
}

function operationContract(
  root: JsonObject,
  route: string,
  method: HttpMethod,
  pathItem: JsonObject,
  raw: unknown,
  revision: string,
  path: string,
  source: string,
  gaps: OpenApiGap[],
): OpenApiOperationContract | undefined {
  const operation = dereferenceObject(raw, root, path, gaps);
  if (!operation) return undefined;
  const inherited = Array.isArray(pathItem.parameters)
    ? pathItem.parameters
    : [];
  const own = Array.isArray(operation.parameters) ? operation.parameters : [];
  const requestBody = dereferenceObject(
    operation.requestBody,
    root,
    path,
    gaps,
  );
  const responses = Object.entries(object(operation.responses) ?? {})
    .sort(([left], [right]) => compareCodePoints(left, right))
    .flatMap(([status, rawResponse]) => {
      const response = dereferenceObject(rawResponse, root, path, gaps);
      return response
        ? [
            {
              status,
              content: mediaContracts(response.content, {
                root,
                path,
                gaps,
                references: [],
              }),
            },
          ]
        : [];
    });
  return {
    id: stableId("openapi-operation", { revision, path, route, method }),
    revision,
    route: route.normalize("NFC"),
    method,
    ...(typeof operation.operationId === "string"
      ? { operationId: operation.operationId.normalize("NFC") }
      : {}),
    parameters: parameters([...inherited, ...own], root, path, source, gaps),
    ...(requestBody
      ? {
          requestBody: {
            required: requestBody.required === true,
            content: mediaContracts(requestBody.content, {
              root,
              path,
              gaps,
              references: [],
            }),
          },
        }
      : {}),
    responses,
    path,
    line: lineOf(source, route),
    column: 1,
  };
}

function detectVersion(value: unknown): OpenApiVersion | undefined {
  if (typeof value !== "string") return undefined;
  if (/^3\.0(?:\.|$)/u.test(value)) return "3.0";
  if (/^3\.1(?:\.|$)/u.test(value)) return "3.1";
  return undefined;
}

function analyzeDocument(
  repositoryPath: string,
  revision: string,
  source: string,
): OpenApiDocumentAnalysis {
  const gaps: OpenApiGap[] = [];
  let root: JsonObject | undefined;
  try {
    const document = parseDocument(source, { strict: true });
    if (document.errors.length > 0) throw document.errors[0];
    root = object(document.toJS({ maxAliasCount: 100 }));
  } catch {
    addGap(
      gaps,
      repositoryPath,
      "invalid_document",
      "OpenAPI document could not be parsed.",
    );
    return {
      id: stableId("openapi-document", { revision, path: repositoryPath }),
      revision,
      path: repositoryPath,
      line: 1,
      column: 1,
      operations: [],
      schemas: [],
      gaps,
    };
  }
  if (!root) {
    addGap(
      gaps,
      repositoryPath,
      "invalid_document",
      "OpenAPI document root must be an object.",
    );
    root = {};
  }
  const version = detectVersion(root.openapi);
  if (!version) {
    addGap(
      gaps,
      repositoryPath,
      "unsupported_version",
      "Only OpenAPI 3.0 and 3.1 documents are supported.",
    );
  }
  const schemas = Object.entries(object(object(root.components)?.schemas) ?? {})
    .sort(([left], [right]) => compareCodePoints(left, right))
    .flatMap(([name, rawSchema]): OpenApiSchemaContract[] => {
      const value = schemaValue(rawSchema, {
        root: root!,
        path: repositoryPath,
        gaps,
        references: [`#/components/schemas/${name}`],
      });
      return value
        ? [
            {
              id: stableId("openapi-schema", {
                revision,
                path: repositoryPath,
                name,
              }),
              revision,
              name: name.normalize("NFC"),
              value,
              path: repositoryPath,
              line: lineOf(source, name),
              column: 1,
            },
          ]
        : [];
    });
  const operations: OpenApiOperationContract[] = [];
  for (const [route, rawPathItem] of Object.entries(
    object(root.paths) ?? {},
  ).sort(([left], [right]) => compareCodePoints(left, right))) {
    const pathItem = dereferenceObject(rawPathItem, root, repositoryPath, gaps);
    if (!pathItem) continue;
    for (const [method, rawOperation] of Object.entries(pathItem).sort(
      ([left], [right]) => compareCodePoints(left, right),
    )) {
      if (!httpMethods.has(method as HttpMethod)) continue;
      const operation = operationContract(
        root,
        route,
        method as HttpMethod,
        pathItem,
        rawOperation,
        revision,
        repositoryPath,
        source,
        gaps,
      );
      if (operation) operations.push(operation);
    }
  }
  for (const operation of operations) {
    for (const media of operation.requestBody?.content ?? []) {
      if (!media.schema || media.schema.reference) continue;
      const name = `${operation.method.toUpperCase()} ${operation.route} request ${media.mediaType}`;
      schemas.push({
        id: stableId("openapi-schema", {
          revision,
          path: repositoryPath,
          name,
        }),
        revision,
        name,
        value: media.schema,
        path: repositoryPath,
        line: operation.line,
        column: operation.column,
      });
    }
    for (const response of operation.responses) {
      for (const media of response.content) {
        if (!media.schema || media.schema.reference) continue;
        const name = `${operation.method.toUpperCase()} ${operation.route} response ${response.status} ${media.mediaType}`;
        schemas.push({
          id: stableId("openapi-schema", {
            revision,
            path: repositoryPath,
            name,
          }),
          revision,
          name,
          value: media.schema,
          path: repositoryPath,
          line: operation.line,
          column: operation.column,
        });
      }
    }
  }
  schemas.sort((left, right) => compareCodePoints(left.name, right.name));
  gaps.sort((left, right) =>
    compareCodePoints(
      `${left.path}:${left.line}:${left.code}:${left.summary}`,
      `${right.path}:${right.line}:${right.code}:${right.summary}`,
    ),
  );
  return {
    id: stableId("openapi-document", { revision, path: repositoryPath }),
    revision,
    ...(version ? { version } : {}),
    path: repositoryPath,
    line: 1,
    column: 1,
    operations: operations.sort((left, right) =>
      compareCodePoints(
        `${left.route}:${left.method}`,
        `${right.route}:${right.method}`,
      ),
    ),
    schemas,
    gaps,
  };
}

async function discoverCandidates(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
        await visit(absolute);
      else if (entry.isFile() && candidatePattern.test(entry.name))
        result.push(absolute);
    }
  };
  await visit(root);
  return result;
}

export async function analyzeOpenApiRevision(
  repositoryId: string,
  snapshot: OpenApiSnapshotInput,
): Promise<OpenApiRevisionAnalysis> {
  let normalizedRepositoryId: string;
  let revision: string;
  if (!isAbsolute(snapshot.directory)) {
    throw new OpenApiAnalyzerError(
      "analyzer_options_invalid",
      "OpenAPI snapshot directory must be absolute.",
    );
  }
  try {
    normalizedRepositoryId = validateStableId(repositoryId, "Repository ID");
    revision = validateExactGitRevision(snapshot.revision, "Revision");
  } catch (cause) {
    throw new OpenApiAnalyzerError(
      "analyzer_options_invalid",
      "OpenAPI analyzer identity is invalid.",
      cause,
    );
  }
  const root = resolve(snapshot.directory);
  let candidates: string[];
  try {
    candidates = await discoverCandidates(root);
  } catch (cause) {
    throw new OpenApiAnalyzerError(
      "repository_unreadable",
      "OpenAPI snapshot cannot be read.",
      cause,
    );
  }
  const documents: OpenApiDocumentAnalysis[] = [];
  for (const absolutePath of candidates) {
    const repositoryPath = normalizeRepositoryPath(
      relative(root, absolutePath).split(sep).join("/"),
    );
    documents.push(
      analyzeDocument(
        repositoryPath,
        revision,
        await readFile(absolutePath, "utf8"),
      ),
    );
  }
  documents.sort((left, right) => compareCodePoints(left.path, right.path));
  return {
    repositoryId: normalizedRepositoryId,
    revision,
    documents,
    operations: documents.flatMap((document) => document.operations),
    schemas: documents.flatMap((document) => document.schemas),
    gaps: documents.flatMap((document) => document.gaps),
  };
}
