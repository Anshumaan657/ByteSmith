import type { CanonicalIr } from "@bytesmith/ir";
import type {
  CombinedConsumerAnalysisResult,
  ConsumerAnalysisResult,
} from "@bytesmith/consumer-analysis";
import type {
  Digest,
  ManifestTestGap,
  ManifestTestRecommendation,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import type { Evidence } from "@bytesmith/impact-types";

export type TestFramework = "jest" | "vitest";
export type TestDiscoveryStatus = "completed" | "incomplete";
export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown";

export type TestDiscoveryDiagnosticCode =
  | "filesystem_entry_unsupported"
  | "package_manifest_invalid"
  | "test_config_invalid"
  | "test_config_dynamic"
  | "test_pattern_unsupported"
  | "test_name_dynamic"
  | "framework_ambiguous";

export interface TestDiscoveryDiagnostic {
  code: TestDiscoveryDiagnosticCode;
  severity: "warning" | "error";
  summary: string;
  path: string;
  line?: number;
  column?: number;
}

export interface TestCommand {
  id: string;
  packageDirectory: string;
  script: string;
  framework: TestFramework;
  commandTemplate: string;
}

export interface DiscoveredTestCase {
  id: string;
  projectId: string;
  framework: TestFramework;
  revision: string;
  path: string;
  name: string;
  line: number;
  column: number;
  command?: string;
}

export interface DiscoveredTestFile {
  id: string;
  projectId: string;
  framework: TestFramework;
  revision: string;
  path: string;
  testCaseIds: string[];
  command?: string;
}

export interface TestProject {
  id: string;
  framework: TestFramework;
  revision: string;
  rootDirectory: string;
  packageDirectory: string;
  packageName?: string;
  packageManifestPath?: string;
  configPath?: string;
  includePatterns: string[];
  excludePatterns: string[];
  command?: TestCommand;
  testFileIds: string[];
}

export interface TestRevisionDiscovery {
  schemaVersion: "1.0.0";
  repositoryId: string;
  revision: string;
  packageManager: PackageManager;
  projects: TestProject[];
  testFiles: DiscoveredTestFile[];
  testCases: DiscoveredTestCase[];
  diagnostics: TestDiscoveryDiagnostic[];
  status: TestDiscoveryStatus;
}

export interface TestSnapshotInput {
  directory: string;
  revision: string;
}

export interface RunTestDiscoveryOptions {
  repositoryId: string;
  base: TestSnapshotInput;
  head: TestSnapshotInput;
  analyzerVersion?: string;
}

export interface TestDiscoveryComparisonResult {
  baseDiscovery: TestRevisionDiscovery;
  headDiscovery: TestRevisionDiscovery;
  ir: CanonicalIr;
}

export interface TestRecommendationLimits {
  maxRecommendationsPerComponent: number;
}

export type TestRecommendationSignal =
  | "direct_reference"
  | "direct_import"
  | "module_import"
  | "directory_convention"
  | "name_convention"
  | "package_convention";

export interface TestRecommendationDecision {
  recommendationId: string;
  affectedComponentId: string;
  sourceImpactIds: string[];
  rank: number;
  score: number;
  confidence: "verified" | "high" | "low";
  signals: TestRecommendationSignal[];
}

export interface RecommendTestsInput {
  ir: CanonicalIr;
  testIr: CanonicalIr;
  discovery: TestRevisionDiscovery;
  consumers: ConsumerAnalysisResult | CombinedConsumerAnalysisResult;
  limits?: Partial<TestRecommendationLimits>;
  analyzerVersion?: string;
}

export interface TestRecommendationResult {
  schemaVersion: "1.0.0";
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
  status: "completed" | "incomplete";
  recommendations: ManifestTestRecommendation[];
  decisions: TestRecommendationDecision[];
  gaps: ManifestTestGap[];
  unknowns: ManifestUnknown[];
  evidence: Evidence[];
  diagnostics: string[];
  semanticDigest: Digest;
}
