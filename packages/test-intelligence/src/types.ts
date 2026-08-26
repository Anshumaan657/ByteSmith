import type { CanonicalIr } from "@bytesmith/ir";
import type {
  CombinedConsumerAnalysisResult,
  ConsumerAnalysisResult,
  ConsumerPath,
  ConsumerTraversalLimits,
} from "@bytesmith/consumer-analysis";
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

export interface Phase6IntegrationRuntime {
  durationMs: number;
}

export interface Phase6IntegrationResult {
  schemaVersion: "1.0.0";
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
  family: "openapi" | "typescript";
  status: "completed" | "incomplete";
  discovery: TestRevisionDiscovery;
  paths: ConsumerPath[];
  impacts: ManifestImpact[];
  recommendations: ManifestTestRecommendation[];
  decisions: TestRecommendationDecision[];
  testGaps: ManifestTestGap[];
  unknowns: ManifestUnknown[];
  evidence: Evidence[];
  diagnostics: string[];
  semanticDigest: Digest;
  runtime: Phase6IntegrationRuntime;
}

export interface RunPhase6TypeScriptOptions {
  ir: CanonicalIr;
  changes: readonly ManifestChange[];
  baseAnalysis: TypeScriptCompilerAnalysis;
  headAnalysis: TypeScriptCompilerAnalysis;
  symbolAnalysis: CrossRevisionSymbolAnalysis;
  projectDiscovery?: RepositoryProjectDiscovery;
  base: TestSnapshotInput;
  head: TestSnapshotInput;
  consumerLimits?: Partial<ConsumerTraversalLimits>;
  recommendationLimits?: Partial<TestRecommendationLimits>;
  analyzerVersion?: string;
}

export interface RunPhase6OpenApiOptions {
  contractIr: CanonicalIr;
  linkageIr: CanonicalIr;
  changes: readonly ManifestChange[];
  baseAnalysis: OpenApiRevisionAnalysis;
  headAnalysis: OpenApiRevisionAnalysis;
  base: TestSnapshotInput;
  head: TestSnapshotInput;
  consumerLimits?: Partial<ConsumerTraversalLimits>;
  recommendationLimits?: Partial<TestRecommendationLimits>;
  analyzerVersion?: string;
}

export interface Phase6ExpectedConsumer {
  name: string;
  category?: "direct" | "transitive" | "contract";
}

export interface Phase6ExpectedTest {
  name: string;
  commandContains?: string;
  reasonContains?: string;
}

export interface Phase6QualityCase {
  id: string;
  result: Phase6IntegrationResult;
  repeatResult?: Phase6IntegrationResult;
  requiredConsumers: Phase6ExpectedConsumer[];
  forbiddenConsumers?: Phase6ExpectedConsumer[];
  requiredTests: Phase6ExpectedTest[];
  forbiddenTests?: Phase6ExpectedTest[];
  requiredGapComponents?: string[];
}

export interface Phase6QualityCaseResult {
  id: string;
  passed: boolean;
  consumerTruePositives: number;
  consumerFalsePositives: number;
  consumerFalseNegatives: number;
  testTruePositives: number;
  testFalsePositives: number;
  testFalseNegatives: number;
  missingGapComponents: string[];
  forbiddenConsumerMatches: string[];
  forbiddenTestMatches: string[];
}

export interface Phase6QualityMetrics {
  schemaVersion: "1.0.0";
  cases: number;
  passedCases: number;
  directConsumerPrecision: number;
  consumerRecall: number;
  testSelectionRecall: number;
  testPrecision: number;
  deterministicRate: number;
  gates: {
    directConsumerPrecision: boolean;
    testSelectionRecall: boolean;
    determinism: boolean;
    forbiddenResults: boolean;
  };
  passed: boolean;
  caseResults: Phase6QualityCaseResult[];
  semanticDigest: Digest;
}
