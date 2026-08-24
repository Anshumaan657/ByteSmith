import type { ContractRuleExecutionResult } from "@bytesmith/analyzer-sdk";
import type { CanonicalIr } from "@bytesmith/ir";

export type OpenApiVersion = "3.0" | "3.1";
export type HttpMethod =
  "delete" | "get" | "head" | "options" | "patch" | "post" | "put" | "trace";

export interface OpenApiSource {
  path: string;
  line: number;
  column: number;
}

export interface OpenApiGap extends OpenApiSource {
  code:
    | "invalid_document"
    | "unsupported_version"
    | "external_reference"
    | "unresolved_reference"
    | "recursive_reference"
    | "unsupported_schema";
  summary: string;
}

export interface OpenApiSchemaValue {
  type?: string;
  format?: string;
  nullable: boolean;
  required: string[];
  enum?: Array<string | number | boolean | null>;
  properties: Record<string, OpenApiSchemaValue>;
  items?: OpenApiSchemaValue;
  reference?: string;
}

export interface OpenApiSchemaContract extends OpenApiSource {
  id: string;
  revision: string;
  name: string;
  value: OpenApiSchemaValue;
}

export interface OpenApiParameterContract extends OpenApiSource {
  name: string;
  in: "cookie" | "header" | "path" | "query";
  required: boolean;
  schema?: OpenApiSchemaValue;
}

export interface OpenApiMediaContract {
  mediaType: string;
  schema?: OpenApiSchemaValue;
}

export interface OpenApiOperationContract extends OpenApiSource {
  id: string;
  revision: string;
  route: string;
  method: HttpMethod;
  operationId?: string;
  parameters: OpenApiParameterContract[];
  requestBody?: {
    required: boolean;
    content: OpenApiMediaContract[];
  };
  responses: Array<{
    status: string;
    content: OpenApiMediaContract[];
  }>;
}

export interface OpenApiDocumentAnalysis extends OpenApiSource {
  id: string;
  revision: string;
  version?: OpenApiVersion;
  operations: OpenApiOperationContract[];
  schemas: OpenApiSchemaContract[];
  gaps: OpenApiGap[];
}

export interface OpenApiRevisionAnalysis {
  repositoryId: string;
  revision: string;
  documents: OpenApiDocumentAnalysis[];
  operations: OpenApiOperationContract[];
  schemas: OpenApiSchemaContract[];
  gaps: OpenApiGap[];
}

export interface OpenApiSnapshotInput {
  directory: string;
  revision: string;
}

export interface RunOpenApiAnalyzerOptions {
  repositoryId: string;
  base: OpenApiSnapshotInput;
  head: OpenApiSnapshotInput;
  analyzerVersion?: string;
}

export interface OpenApiRuleState {
  base: OpenApiRevisionAnalysis;
  head: OpenApiRevisionAnalysis;
}

export interface OpenApiAnalyzerResult {
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
  ir: CanonicalIr;
  rules: ContractRuleExecutionResult;
}
