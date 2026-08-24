import { stableId } from "@bytesmith/canonicalization";
import { createEvidence } from "@bytesmith/evidence";
import {
  createCanonicalIr,
  createIrContract,
  createIrFile,
  createIrGap,
  type CanonicalIr,
  type IrContract,
  type IrFile,
  type IrGap,
} from "@bytesmith/ir";
import type { Evidence } from "@bytesmith/impact-types";
import { OpenApiAnalyzerError } from "./errors.js";
import type {
  OpenApiDocumentAnalysis,
  OpenApiRevisionAnalysis,
} from "./types.js";

interface Accumulator {
  evidence: Evidence[];
  files: IrFile[];
  contracts: IrContract[];
  gaps: IrGap[];
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function validateBindings(
  repositoryId: string,
  baseRevision: string,
  headRevision: string,
  analysis: OpenApiRevisionAnalysis,
): void {
  if (
    analysis.repositoryId !== repositoryId ||
    (analysis.revision !== baseRevision && analysis.revision !== headRevision)
  ) {
    throw new OpenApiAnalyzerError(
      "analysis_comparison_invalid",
      "OpenAPI analysis does not match the exact requested comparison.",
    );
  }
}

function projectDocument(
  context: {
    repositoryId: string;
    baseRevision: string;
    headRevision: string;
    analyzerVersion: string;
  },
  document: OpenApiDocumentAnalysis,
  accumulator: Accumulator,
): void {
  const evidenceContext = {
    ...context,
    producer: { id: "bytesmith.openapi", version: context.analyzerVersion },
  };
  const documentEvidence = createEvidence(evidenceContext, {
    kind: "syntax",
    revision: document.revision,
    path: document.path,
    startLine: document.line,
    startColumn: document.column,
    summary: document.version
      ? `Parsed OpenAPI ${document.version} document ${document.path}.`
      : `Inspected unsupported OpenAPI document ${document.path}.`,
  });
  const file = createIrFile(context, {
    revision: document.revision,
    path: document.path,
    mediaType: "application/vnd.oai.openapi",
    evidenceIds: [documentEvidence.id],
  });
  accumulator.evidence.push(documentEvidence);
  accumulator.files.push(file);

  for (const operation of document.operations) {
    const evidence = createEvidence(evidenceContext, {
      kind: "contract",
      revision: operation.revision,
      path: operation.path,
      startLine: operation.line,
      startColumn: operation.column,
      summary: `OpenAPI resolved ${operation.method.toUpperCase()} ${operation.route}.`,
    });
    const contract = createIrContract(context, {
      revision: operation.revision,
      path: operation.path,
      startLine: operation.line,
      startColumn: operation.column,
      subjectId: file.id,
      kind: "api_operation",
      name: `${operation.method.toUpperCase()} ${operation.route}`,
      fingerprint: stableId("openapi-operation-contract", {
        route: operation.route,
        method: operation.method,
        ...(operation.operationId === undefined
          ? {}
          : { operationId: operation.operationId }),
        parameters: operation.parameters,
        ...(operation.requestBody === undefined
          ? {}
          : { requestBody: operation.requestBody }),
        responses: operation.responses,
      }),
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.contracts.push(contract);
  }

  for (const schema of document.schemas) {
    const evidence = createEvidence(evidenceContext, {
      kind: "contract",
      revision: schema.revision,
      path: schema.path,
      startLine: schema.line,
      startColumn: schema.column,
      summary: `OpenAPI resolved component schema ${schema.name}.`,
    });
    const contract = createIrContract(context, {
      revision: schema.revision,
      path: schema.path,
      startLine: schema.line,
      startColumn: schema.column,
      subjectId: file.id,
      kind: "schema",
      name: schema.name,
      fingerprint: stableId("openapi-schema-contract", schema.value),
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.contracts.push(contract);
  }

  for (const gap of document.gaps) {
    const evidence = createEvidence(evidenceContext, {
      kind: gap.code.includes("reference") ? "contract" : "syntax",
      revision: document.revision,
      path: gap.path,
      startLine: gap.line,
      startColumn: gap.column,
      summary: gap.summary,
    });
    accumulator.evidence.push(evidence);
    accumulator.gaps.push(
      createIrGap(context, {
        revision: document.revision,
        type: gap.code.includes("reference")
          ? "unresolved_symbol"
          : "analyzer_gap",
        summary: gap.summary,
        locations: [
          {
            revision: document.revision,
            path: gap.path,
            startLine: gap.line,
            startColumn: gap.column,
          },
        ],
        evidenceIds: [evidence.id],
        blockingRelevance: "required",
      }),
    );
  }
}

export function createOpenApiCanonicalIr(input: {
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
}): CanonicalIr {
  validateBindings(
    input.repositoryId,
    input.baseRevision,
    input.headRevision,
    input.baseAnalysis,
  );
  validateBindings(
    input.repositoryId,
    input.baseRevision,
    input.headRevision,
    input.headAnalysis,
  );
  if (
    input.baseAnalysis.revision !== input.baseRevision ||
    input.headAnalysis.revision !== input.headRevision
  ) {
    throw new OpenApiAnalyzerError(
      "analysis_comparison_invalid",
      "OpenAPI base and head analyses are reversed or stale.",
    );
  }
  const accumulator: Accumulator = {
    evidence: [],
    files: [],
    contracts: [],
    gaps: [],
  };
  for (const analysis of [input.baseAnalysis, input.headAnalysis]) {
    for (const document of analysis.documents)
      projectDocument(input, document, accumulator);
  }
  return createCanonicalIr(input, {
    evidence: uniqueById(accumulator.evidence),
    files: uniqueById(accumulator.files),
    symbols: [],
    contracts: uniqueById(accumulator.contracts),
    relationships: [],
    tests: [],
    gaps: uniqueById(accumulator.gaps),
  });
}
