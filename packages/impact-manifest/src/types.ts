import type { CanonicalIr } from "@bytesmith/ir";
import type {
  ComponentRef,
  Evidence,
  SourceLocation,
} from "@bytesmith/impact-types";
import type {
  InventoryPolicy,
  RepositoryInventory,
} from "@bytesmith/repository-inventory";
import type {
  NormalizedGitDiff,
  ResolvedGitComparison,
} from "@bytesmith/vcs-git";

export type Conclusion = "pass" | "warn" | "fail" | "incomplete" | "error";
export type AnalyzerStatus = "completed" | "incomplete" | "error";

export interface Digest {
  algorithm: "sha256";
  value: string;
}

export interface ManifestAnalyzer {
  id: string;
  version: string;
  required: boolean;
  status: AnalyzerStatus;
  durationMs?: number;
  diagnostics: string[];
}

export interface ManifestScopeFile {
  path: string;
  previousPath?: string;
  changeType:
    "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";
  coverageClass:
    | "analyzed"
    | "partially_analyzed"
    | "unsupported"
    | "intentionally_excluded";
  reason?: string;
  analyzerIds: string[];
}

export interface ManifestChange {
  id: string;
  kind:
    | "symbol"
    | "contract"
    | "schema"
    | "event"
    | "configuration"
    | "dependency"
    | "infrastructure";
  summary: string;
  compatibility: "compatible" | "potentially_breaking" | "breaking" | "unknown";
  component: ComponentRef;
  evidenceIds: string[];
}

export interface ManifestImpact {
  id: string;
  ruleId: string;
  ruleVersion: string;
  category:
    "direct" | "transitive" | "contract" | "test_gap" | "policy" | "heuristic";
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: "verified" | "high" | "medium" | "low" | "unknown";
  summary: string;
  sourceChangeIds: string[];
  affectedComponents: ComponentRef[];
  evidenceIds: string[];
}

export interface ManifestTestRecommendation {
  id: string;
  test: ComponentRef;
  command: string;
  reason: string;
  evidenceIds: string[];
}

export interface ManifestTestGap {
  id: string;
  affectedComponent: ComponentRef;
  gapKind: "not_found" | "proven_absent";
  reason: string;
  evidenceIds: string[];
}

export interface ManifestUnknown {
  id: string;
  type:
    | "unsupported_file"
    | "dynamic_import"
    | "reflection"
    | "generated_code"
    | "missing_repository"
    | "unresolved_symbol"
    | "analyzer_gap"
    | "other";
  summary: string;
  locations: SourceLocation[];
  evidenceIds: string[];
  blockingRelevance: "none" | "possible" | "required";
}

export interface ManifestPolicy {
  id: string;
  ruleId: string;
  ruleVersion: string;
  required: boolean;
  mode: "advisory" | "blocking";
  enabled: boolean;
  blockingEligible: boolean;
  ruleState: "active" | "suspended";
  suspensionId?: string;
  result: "pass" | "warn" | "fail" | "not_evaluated";
  findingIds: string[];
  analysisGapIds: string[];
}

export interface AuditEvent {
  id: string;
  entityType: "appeal" | "waiver" | "suspension" | "disposition" | "policy";
  entityId: string;
  action: string;
  actor: string;
  occurredAt: string;
  fromStatus?: string;
  toStatus?: string;
  summary?: string;
}

export interface ManifestDisposition {
  id: string;
  findingId: string;
  type: "accepted" | "appealed" | "waived" | "suppressed" | "resolved";
  actor: string;
  reason: string;
  createdAt: string;
  sourceId: string;
  auditEventIds: string[];
}

export interface ManifestAppeal {
  id: string;
  findingId: string;
  status: "open" | "under_review" | "terminal";
  actor: string;
  reason: string;
  createdAt: string;
  outcome?: "upheld" | "rejected" | "superseded";
  adjudicatedBy?: string;
  adjudicatedAt?: string;
  rationale?: string;
  supersedingFindingId?: string;
  auditEventIds: string[];
}

export interface ManifestWaiver {
  id: string;
  findingId: string;
  reason: string;
  actor: string;
  createdAt: string;
  startsAt: string;
  expiresAt: string;
  scope: "finding" | "pull_request" | "repository" | "organization";
  status: "pending" | "active" | "expired" | "revoked";
  pullRequestId?: string;
  repositoryId?: string;
  organizationId?: string;
  selector?: { ruleId?: string; subjectId?: string };
  approval?: { actor: string; authority: "elevated"; approvedAt: string };
  auditEventIds: string[];
}

export interface ManifestSuspension {
  id: string;
  ruleId: string;
  ruleVersion: string;
  scope: "repository" | "organization" | "global";
  status: "active" | "reinstated";
  repositoryId?: string;
  organizationId?: string;
  reason: string;
  actor: string;
  createdAt: string;
  reinstatedAt?: string;
  reinstatedBy?: string;
  reinstatementCriteria: string;
  evidenceIds: string[];
  auditEventIds: string[];
}

export interface ImpactManifest {
  schemaVersion: "1.0.0";
  manifestId: string;
  generatedAt: string;
  engine: { name: "ByteSmith"; version: string; ruleSetVersion: string };
  repository: {
    id: string;
    organizationId?: string;
    name: string;
    vcs: "git";
    remote?: string;
  };
  comparison: {
    baseRevision: string;
    headRevision: string;
    mergeBaseRevision?: string;
    pullRequestId?: string;
  };
  configurationDigest: Digest;
  status: {
    conclusion: Conclusion;
    reasons: Array<{ code: string; summary: string }>;
  };
  scope: {
    files: ManifestScopeFile[];
    coverage: RepositoryInventory["coverage"];
  };
  analyzers: ManifestAnalyzer[];
  evidence: Evidence[];
  changes: ManifestChange[];
  impacts: ManifestImpact[];
  tests: {
    recommended: ManifestTestRecommendation[];
    gaps: ManifestTestGap[];
  };
  unknowns: ManifestUnknown[];
  policies: ManifestPolicy[];
  dispositions: ManifestDisposition[];
  appeals: ManifestAppeal[];
  waivers: ManifestWaiver[];
  suspensions: ManifestSuspension[];
  auditEvents: AuditEvent[];
  integrity: {
    canonicalization: "bytesmith-c14n-1";
    semanticDigest: Digest;
    signature?: string;
    keyId?: string;
  };
}

export interface ManifestBuildInput {
  manifestId: string;
  generatedAt: string;
  engineVersion: string;
  ruleSetVersion: string;
  comparison: ResolvedGitComparison;
  configurationDigest: Digest;
  inventory: RepositoryInventory;
  ir: CanonicalIr;
  analyzers: readonly ManifestAnalyzer[];
  pullRequestId?: string;
}

export interface Phase3PipelineOptions {
  repositoryPath: string;
  base: string;
  head: string;
  inventoryPolicy: InventoryPolicy;
  analyzers: readonly ManifestAnalyzer[];
  producer: { id: string; version: string };
  engineVersion: string;
  ruleSetVersion: string;
  generatedAt?: string;
  pullRequestId?: string;
  expectedBaseRevision?: string;
  expectedHeadRevision?: string;
  incrementalSeed?: Phase3SemanticSnapshot;
}

export interface Phase3SemanticSnapshot {
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  mergeBaseRevision: string;
  configurationDigest: Digest;
  diff: NormalizedGitDiff;
  inventory: RepositoryInventory;
  ir: CanonicalIr;
}

export interface Phase3PipelineResult {
  manifest: ImpactManifest;
  snapshot: Phase3SemanticSnapshot;
  execution: "clean" | "incremental";
}
