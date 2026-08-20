export type Conclusion = "pass" | "warn" | "fail" | "incomplete" | "error";

export interface Coverage {
  totalChangedFiles: number;
  analyzed: number;
  partiallyAnalyzed: number;
  unsupported: number;
  intentionallyExcluded: number;
}

export interface ChangeMatcher {
  kind?: string;
  compatibility?: string;
  componentKind?: string;
  componentName?: string;
  summaryContains?: string;
}

export interface ImpactMatcher {
  ruleId?: string;
  category?: string;
  severity?: string;
  confidence?: string;
  affectedComponentKind?: string;
  affectedComponentName?: string;
  summaryContains?: string;
}

export interface TestMatcher {
  testName?: string;
  commandContains?: string;
  reasonContains?: string;
}

export interface UnknownMatcher {
  type?: string;
  path?: string;
  summaryContains?: string;
  blockingRelevance?: string;
}

export interface PolicyMatcher {
  ruleId?: string;
  ruleState?: string;
  result?: string;
  required?: boolean;
  suspensionScope?: string;
  findingId?: string;
  analysisGapId?: string;
}

export interface WaiverMatcher {
  findingId?: string;
  scope?: string;
  status?: string;
}

export interface ChangeBenchExpected {
  conclusion: Conclusion;
  coverage: Coverage;
  requiredChanges: ChangeMatcher[];
  forbiddenChanges: ChangeMatcher[];
  requiredImpacts: ImpactMatcher[];
  forbiddenImpacts: ImpactMatcher[];
  requiredTests: TestMatcher[];
  forbiddenTests: TestMatcher[];
  requiredUnknowns: UnknownMatcher[];
  forbiddenUnknowns: UnknownMatcher[];
  requiredPolicies: PolicyMatcher[];
  forbiddenPolicies: PolicyMatcher[];
  requiredWaivers: WaiverMatcher[];
  allowUnexpected: boolean;
}

export interface ChangeBenchCase {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  description?: string;
  unexpectedRationale?: string;
  tags?: string[];
  snapshots: { before: string; after: string };
  capabilities: string[];
  expected: ChangeBenchExpected;
}

export interface ComponentRef {
  id?: string;
  kind?: string;
  name?: string;
}

export interface ActualChange {
  id?: string;
  kind?: string;
  compatibility?: string;
  summary?: string;
  component?: ComponentRef;
  [key: string]: unknown;
}

export interface ActualImpact {
  id?: string;
  ruleId?: string;
  category?: string;
  severity?: string;
  confidence?: string;
  summary?: string;
  affectedComponents?: ComponentRef[];
  [key: string]: unknown;
}

export interface ActualTest {
  id?: string;
  test?: ComponentRef;
  command?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ActualUnknown {
  id?: string;
  type?: string;
  summary?: string;
  locations?: Array<{ path?: string; [key: string]: unknown }>;
  blockingRelevance?: string;
  [key: string]: unknown;
}

export interface ActualPolicy {
  id?: string;
  ruleId?: string;
  ruleState?: string;
  result?: string;
  required?: boolean;
  suspensionScope?: string;
  findingIds?: string[];
  analysisGapIds?: string[];
  [key: string]: unknown;
}

export interface ActualWaiver {
  id?: string;
  findingId?: string;
  scope?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ChangeBenchActual {
  conclusion?: Conclusion;
  coverage?: Coverage;
  status?: { conclusion: Conclusion; [key: string]: unknown };
  scope?: { coverage: Coverage; [key: string]: unknown };
  changes?: ActualChange[];
  impacts?: ActualImpact[];
  tests?: ActualTest[] | { recommended: ActualTest[]; [key: string]: unknown };
  unknowns?: ActualUnknown[];
  policies?: ActualPolicy[];
  waivers?: ActualWaiver[];
  [key: string]: unknown;
}

export type AssertionGroup =
  "changes" | "impacts" | "tests" | "unknowns" | "policies" | "waivers";
export type EvaluationIssueKind =
  "conclusion" | "coverage" | "missing" | "forbidden" | "unexpected";

export interface EvaluationIssue {
  kind: EvaluationIssueKind;
  group?: AssertionGroup;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface GroupCounts {
  required: number;
  matched: number;
  missing: number;
  forbiddenMatched: number;
  unexpected: number;
}

export interface EvaluationResult {
  passed: boolean;
  errors: string[];
  issues: EvaluationIssue[];
  falsePositiveCount: number;
  groups: Record<AssertionGroup, GroupCounts>;
}

export interface LoadedChangeBenchCase {
  definition: ChangeBenchCase;
  directory: string;
  beforeDirectory: string;
  afterDirectory: string;
}

export interface MaterializedCase {
  rootDirectory: string;
  beforeDirectory: string;
  afterDirectory: string;
  cleanup(): Promise<void>;
}

export interface ExecutorContext {
  caseDefinition: ChangeBenchCase;
  beforeDirectory: string;
  afterDirectory: string;
  runIndex: number;
}

export type ChangeBenchExecutor = (
  context: ExecutorContext,
) => Promise<ChangeBenchActual> | ChangeBenchActual;

export interface CaseRunResult {
  id: string;
  title: string;
  tags: string[];
  capabilities: string[];
  passed: boolean;
  crashed: boolean;
  deterministic: boolean;
  semanticDigest?: string;
  durationMs: number;
  conclusion?: Conclusion;
  coverage?: Coverage;
  evaluation?: EvaluationResult;
  error?: string;
}

export interface BenchmarkMetrics {
  cases: number;
  passed: number;
  failed: number;
  crashed: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  testSelectionRecall: number;
  unsupportedRate: number;
  incompleteRate: number;
  crashRate: number;
  determinismRate: number;
  durationMs: number;
}

export interface ChangeBenchReport {
  schemaVersion: "1.0.0";
  suite: { cases: number; repeat: number };
  metrics: BenchmarkMetrics;
  segments: {
    byTag: Record<string, BenchmarkMetrics>;
    byCapability: Record<string, BenchmarkMetrics>;
  };
  cases: CaseRunResult[];
}
