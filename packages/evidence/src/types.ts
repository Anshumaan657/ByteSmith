import type {
  Evidence,
  EvidenceKind,
  GitRevision,
  Producer,
  StableId,
} from "@bytesmith/impact-types";

export interface RevisionBinding {
  repositoryId: StableId;
  baseRevision: GitRevision;
  headRevision: GitRevision;
}

export interface EvidenceContext extends RevisionBinding {
  producer: Producer;
}

export interface SourceLocationInput {
  revision: GitRevision;
  path: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface EvidenceInput extends SourceLocationInput {
  kind: EvidenceKind;
  summary: string;
}

export interface EvidenceCollection {
  binding: RevisionBinding;
  records: Evidence[];
}
