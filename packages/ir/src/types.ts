import type { RevisionBinding, SourceLocationInput } from "@bytesmith/evidence";
import type {
  BlockingRelevance,
  Evidence,
  GitRevision,
  SourceLocation,
  StableId,
} from "@bytesmith/impact-types";

export type IrSymbolKind =
  | "function"
  | "method"
  | "interface"
  | "field"
  | "type_alias"
  | "class"
  | "variable"
  | "module"
  | "other";

export type IrContractKind =
  | "function_signature"
  | "type_shape"
  | "api_operation"
  | "schema"
  | "package_export"
  | "other";

export type IrRelationshipKind =
  | "imports"
  | "exports"
  | "re_exports"
  | "calls"
  | "references"
  | "contains"
  | "implements"
  | "extends"
  | "consumes"
  | "tested_by"
  | "other";

export type IrGapType =
  | "unsupported_file"
  | "dynamic_import"
  | "reflection"
  | "generated_code"
  | "missing_repository"
  | "unresolved_symbol"
  | "analyzer_gap"
  | "other";

export type IrContext = RevisionBinding;

export interface IrFileInput extends SourceLocationInput {
  mediaType?: string;
  evidenceIds: readonly StableId[];
}

export interface IrFile {
  id: StableId;
  revision: GitRevision;
  location: SourceLocation;
  mediaType?: string;
  evidenceIds: StableId[];
}

export interface IrSymbolInput extends SourceLocationInput {
  fileId: StableId;
  kind: IrSymbolKind;
  name: string;
  exported: boolean;
  evidenceIds: readonly StableId[];
}

export interface IrSymbol {
  id: StableId;
  revision: GitRevision;
  fileId: StableId;
  kind: IrSymbolKind;
  name: string;
  exported: boolean;
  location: SourceLocation;
  evidenceIds: StableId[];
}

export interface IrContractInput extends SourceLocationInput {
  subjectId: StableId;
  kind: IrContractKind;
  name: string;
  fingerprint: string;
  evidenceIds: readonly StableId[];
}

export interface IrContract {
  id: StableId;
  revision: GitRevision;
  subjectId: StableId;
  kind: IrContractKind;
  name: string;
  fingerprint: string;
  location: SourceLocation;
  evidenceIds: StableId[];
}

export interface IrRelationshipInput {
  revision: GitRevision;
  kind: IrRelationshipKind;
  fromId: StableId;
  toId: StableId;
  authority: "authoritative" | "heuristic";
  evidenceIds: readonly StableId[];
}

export interface IrRelationship extends IrRelationshipInput {
  id: StableId;
  evidenceIds: StableId[];
}

export interface IrTestInput extends SourceLocationInput {
  framework: "jest" | "vitest" | "other";
  name: string;
  evidenceIds: readonly StableId[];
}

export interface IrTest {
  id: StableId;
  revision: GitRevision;
  framework: "jest" | "vitest" | "other";
  name: string;
  location: SourceLocation;
  evidenceIds: StableId[];
}

export interface IrGapInput {
  revision: GitRevision;
  type: IrGapType;
  summary: string;
  locations: readonly SourceLocationInput[];
  evidenceIds: readonly StableId[];
  blockingRelevance: BlockingRelevance;
}

export interface IrGap {
  id: StableId;
  revision: GitRevision;
  type: IrGapType;
  summary: string;
  locations: SourceLocation[];
  evidenceIds: StableId[];
  blockingRelevance: BlockingRelevance;
}

export interface CanonicalIrRecords {
  evidence: readonly Evidence[];
  files: readonly IrFile[];
  symbols: readonly IrSymbol[];
  contracts: readonly IrContract[];
  relationships: readonly IrRelationship[];
  tests: readonly IrTest[];
  gaps: readonly IrGap[];
}

export interface CanonicalIr extends IrContext {
  evidence: Evidence[];
  files: IrFile[];
  symbols: IrSymbol[];
  contracts: IrContract[];
  relationships: IrRelationship[];
  tests: IrTest[];
  gaps: IrGap[];
}
