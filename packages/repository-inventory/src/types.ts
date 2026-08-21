import type { GitChangedFile, GitObjectId } from "@bytesmith/vcs-git";

export type CoverageClass =
  "analyzed" | "partially_analyzed" | "unsupported" | "intentionally_excluded";

export interface CoverageSummary {
  totalChangedFiles: number;
  analyzed: number;
  partiallyAnalyzed: number;
  unsupported: number;
  intentionallyExcluded: number;
}

export interface InventoryFile extends GitChangedFile {
  coverageClass: CoverageClass;
  reason?: string;
  analyzerIds: string[];
}

export interface RepositoryInventory {
  fromCommit: GitObjectId;
  toCommit: GitObjectId;
  files: InventoryFile[];
  coverage: CoverageSummary;
}

export interface PathMatcher {
  exactPaths?: readonly string[];
  pathPrefixes?: readonly string[];
  fileNames?: readonly string[];
  extensions?: readonly string[];
  pathSegments?: readonly string[];
}

export interface AnalyzerCoverageClaim {
  analyzerId: string;
  matcher: PathMatcher;
}

export type InventoryRuleKind =
  "generated" | "ignored" | "excluded" | "unsupported" | "partially_analyzed";

export interface InventoryRule {
  id: string;
  kind: InventoryRuleKind;
  reason: string;
  matcher: PathMatcher;
  analyzerIds?: readonly string[];
}

export interface InventoryPolicy {
  analyzerClaims: readonly AnalyzerCoverageClaim[];
  rules?: readonly InventoryRule[];
}
