import type { OpenApiRevisionAnalysis } from "@bytesmith/contracts-openapi";
import type {
  CrossRevisionSymbolAnalysis,
  RepositoryProjectDiscovery,
  TypeScriptCompilerAnalysis,
} from "@bytesmith/contracts-typescript";
import type {
  Digest,
  ManifestChange,
  ManifestImpact,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import type { Evidence, SourceLocation } from "@bytesmith/impact-types";
import type { CanonicalIr } from "@bytesmith/ir";

export interface ConsumerTraversalLimits {
  maxDepth: number;
  maxConsumers: number;
  maxEdges: number;
}

export interface TypeScriptConsumerAnalysisInput {
  ir: CanonicalIr;
  changes: readonly ManifestChange[];
  baseAnalysis: TypeScriptCompilerAnalysis;
  headAnalysis: TypeScriptCompilerAnalysis;
  symbolAnalysis: CrossRevisionSymbolAnalysis;
  headDiscovery?: RepositoryProjectDiscovery;
  limits?: Partial<ConsumerTraversalLimits>;
  analyzerVersion?: string;
}

export interface OpenApiConsumerAnalysisInput {
  ir: CanonicalIr;
  changes: readonly ManifestChange[];
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
  headDirectory: string;
  limits?: Partial<ConsumerTraversalLimits>;
  analyzerVersion?: string;
}

export interface ConsumerPathEdge {
  relationshipId: string;
  fromId: string;
  toId: string;
  evidenceIds: string[];
}

export interface ConsumerPath {
  id: string;
  sourceChangeId: string;
  category: "direct" | "transitive" | "contract";
  affectedComponentId: string;
  depth: number;
  edges: ConsumerPathEdge[];
  evidenceIds: string[];
}

export interface OpenApiClientReference {
  id: string;
  revision: string;
  path: string;
  line: number;
  column: number;
  route: string;
  method: string;
  callerName?: string;
  callerIrId?: string;
  evidenceId: string;
}

export interface ConsumerAnalysisResult {
  schemaVersion: "1.0.0";
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
  family: "openapi" | "typescript";
  status: "completed" | "incomplete";
  paths: ConsumerPath[];
  impacts: ManifestImpact[];
  unknowns: ManifestUnknown[];
  generatedEvidence: Evidence[];
  diagnostics: string[];
  semanticDigest: Digest;
}

export interface ConsumerGraphNode {
  id: string;
  revision: string;
  name: string;
  kind: "file" | "module" | "package" | "symbol" | "api";
  location?: SourceLocation;
}

export interface CombinedConsumerAnalysisResult extends Omit<
  ConsumerAnalysisResult,
  "family"
> {
  families: Array<"openapi" | "typescript">;
}
