export type StableId = string;
export type GitRevision = string;

export type EvidenceKind =
  | "syntax"
  | "type"
  | "call"
  | "import"
  | "contract"
  | "configuration"
  | "coverage"
  | "runtime"
  | "history"
  | "heuristic";

export type ComponentKind =
  | "file"
  | "module"
  | "package"
  | "symbol"
  | "api"
  | "graphql"
  | "event"
  | "database"
  | "config"
  | "infrastructure"
  | "test"
  | "service"
  | "repository";

export type Confidence = "verified" | "high" | "medium" | "low" | "unknown";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type BlockingRelevance = "none" | "possible" | "required";

export interface SourceLocation {
  repository: StableId;
  revision: GitRevision;
  path: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Producer {
  id: StableId;
  version: string;
}

export interface Evidence {
  id: StableId;
  kind: EvidenceKind;
  producer: Producer;
  location: SourceLocation;
  summary: string;
}

export interface ComponentRef {
  id: StableId;
  kind: ComponentKind;
  name: string;
  location?: SourceLocation;
}
