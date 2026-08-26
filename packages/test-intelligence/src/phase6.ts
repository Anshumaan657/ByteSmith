import { performance } from "node:perf_hooks";
import { stableId } from "@bytesmith/canonicalization";
import {
  analyzeOpenApiConsumers,
  analyzeTypeScriptConsumers,
  type ConsumerAnalysisResult,
} from "@bytesmith/consumer-analysis";
import type {
  ManifestImpact,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  type ComponentRef,
  type Evidence,
} from "@bytesmith/impact-types";
import { validateCanonicalIr, type CanonicalIr } from "@bytesmith/ir";
import { TestDiscoveryError } from "./errors.js";
import { runTestDiscoveryComparison } from "./discovery.js";
import { recommendTests } from "./recommendations.js";
import type {
  Phase6ExpectedConsumer,
  Phase6ExpectedTest,
  Phase6IntegrationResult,
  Phase6QualityCase,
  Phase6QualityCaseResult,
  Phase6QualityMetrics,
  RunPhase6OpenApiOptions,
  RunPhase6TypeScriptOptions,
  TestDiscoveryComparisonResult,
  TestRecommendationResult,
} from "./types.js";

interface NormalizedConsumers {
  result: ConsumerAnalysisResult;
  integrationUnknowns: ManifestUnknown[];
  diagnostics: string[];
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function semanticDigest(value: unknown) {
  return {
    algorithm: "sha256" as const,
    value: stableId("phase6-semantic", value).slice("phase6-semantic:".length),
  };
}

function analyzerVersion(value: string | undefined): string {
  try {
    return normalizeNonEmptyText(value ?? "0.1.0", "Phase 6 analyzer version");
  } catch (cause) {
    throw new TestDiscoveryError(
      "phase6_input_invalid",
      "Phase 6 analyzer version is invalid.",
      cause,
    );
  }
}

function componentForNode(
  ir: CanonicalIr,
  nodeId: string,
): ComponentRef | undefined {
  const symbol = ir.symbols.find((candidate) => candidate.id === nodeId);
  if (symbol) {
    return {
      id: symbol.id,
      kind: "symbol",
      name: symbol.name,
      location: structuredClone(symbol.location),
    };
  }
  const file = ir.files.find((candidate) => candidate.id === nodeId);
  if (file) {
    return {
      id: file.id,
      kind: "file",
      name: file.location.path,
      location: structuredClone(file.location),
    };
  }
  const contract = ir.contracts.find((candidate) => candidate.id === nodeId);
  return contract
    ? {
        id: contract.id,
        kind: "symbol",
        name: contract.name,
        location: structuredClone(contract.location),
      }
    : undefined;
}

function normalizedImpact(input: {
  impact: ManifestImpact;
  component: ComponentRef;
  depth: number;
  evidenceIds: readonly string[];
  testPath: string;
}): ManifestImpact {
  const category =
    input.depth <= 1 ? ("direct" as const) : ("transitive" as const);
  const record = {
    ruleId:
      category === "direct"
        ? "phase6.nearest-direct-consumer"
        : "phase6.nearest-transitive-consumer",
    ruleVersion: "1.0.0",
    category,
    severity: input.impact.severity,
    confidence: input.impact.confidence,
    summary: `${input.component.name} is the nearest non-test consumer covered by ${input.testPath}.`,
    sourceChangeIds: [...input.impact.sourceChangeIds].sort(compareCodePoints),
    affectedComponents: [structuredClone(input.component)],
    evidenceIds: [...new Set(input.evidenceIds)].sort(compareCodePoints),
  };
  return { id: stableId("phase6-consumer-impact", record), ...record };
}

function normalizeTerminalTestConsumers(
  ir: CanonicalIr,
  consumers: ConsumerAnalysisResult,
  discovery: TestDiscoveryComparisonResult,
): NormalizedConsumers {
  const testPaths = new Set(
    discovery.headDiscovery.testFiles.map((testFile) => testFile.path),
  );
  const impacts: ManifestImpact[] = [];
  const integrationUnknowns: ManifestUnknown[] = [];
  const diagnostics: string[] = [];
  for (const impact of consumers.impacts) {
    for (const component of impact.affectedComponents) {
      if (!component.location || !testPaths.has(component.location.path)) {
        impacts.push(
          impact.affectedComponents.length === 1
            ? structuredClone(impact)
            : {
                ...structuredClone(impact),
                id: stableId("phase6-consumer-impact", {
                  sourceImpactId: impact.id,
                  component,
                }),
                affectedComponents: [structuredClone(component)],
              },
        );
        continue;
      }
      const path = consumers.paths.find(
        (candidate) =>
          candidate.affectedComponentId === component.id &&
          candidate.edges[0]?.fromId === component.id,
      );
      const firstEdge = path?.edges[0];
      const nearest = firstEdge
        ? componentForNode(ir, firstEdge.toId)
        : undefined;
      if (!path || !firstEdge || !nearest) {
        const summary = `Phase 6 could not resolve the non-test consumer covered by ${component.location.path}.`;
        const record = {
          type: "analyzer_gap" as const,
          summary,
          locations: [structuredClone(component.location)],
          evidenceIds: [...impact.evidenceIds].sort(compareCodePoints),
          blockingRelevance: "possible" as const,
        };
        integrationUnknowns.push({
          id: stableId("phase6-integration-unknown", record),
          ...record,
        });
        diagnostics.push(summary);
        continue;
      }
      const remainingEvidence = path.edges
        .slice(1)
        .flatMap((edge) => edge.evidenceIds);
      impacts.push(
        normalizedImpact({
          impact,
          component: nearest,
          depth: Math.max(1, path.depth - 1),
          evidenceIds:
            remainingEvidence.length > 0
              ? remainingEvidence
              : impact.evidenceIds,
          testPath: component.location.path,
        }),
      );
    }
  }
  const normalizedWithoutDigest = {
    ...consumers,
    impacts: uniqueById(impacts).sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    unknowns: uniqueById([...consumers.unknowns, ...integrationUnknowns]).sort(
      (left, right) => compareCodePoints(left.id, right.id),
    ),
    diagnostics: [...new Set([...consumers.diagnostics, ...diagnostics])].sort(
      compareCodePoints,
    ),
  };
  const { semanticDigest: previousDigest, ...semantic } =
    normalizedWithoutDigest;
  void previousDigest;
  return {
    result: { ...semantic, semanticDigest: semanticDigest(semantic) },
    integrationUnknowns,
    diagnostics,
  };
}

function gapUnknowns(
  discovery: TestDiscoveryComparisonResult,
): ManifestUnknown[] {
  return discovery.ir.gaps
    .filter((gap) => gap.revision === discovery.ir.headRevision)
    .map((gap) => ({
      id: gap.id,
      type: gap.type,
      summary: gap.summary,
      locations: structuredClone(gap.locations),
      evidenceIds: [...gap.evidenceIds],
      blockingRelevance: gap.blockingRelevance,
    }));
}

function referencedEvidenceIds(input: {
  consumers: ConsumerAnalysisResult;
  tests: TestRecommendationResult;
  unknowns: readonly ManifestUnknown[];
}): Set<string> {
  return new Set([
    ...input.consumers.paths.flatMap((path) => path.evidenceIds),
    ...input.consumers.impacts.flatMap((impact) => impact.evidenceIds),
    ...input.tests.recommendations.flatMap((item) => item.evidenceIds),
    ...input.tests.gaps.flatMap((gap) => gap.evidenceIds),
    ...input.unknowns.flatMap((unknown) => unknown.evidenceIds),
  ]);
}

function finalizeIntegration(input: {
  family: "openapi" | "typescript";
  analysisIr: CanonicalIr;
  linkageIr: CanonicalIr;
  consumers: ConsumerAnalysisResult;
  discovery: TestDiscoveryComparisonResult;
  tests: TestRecommendationResult;
  analyzerVersion: string;
  startedAt: number;
}): Phase6IntegrationResult {
  const discoveryUnknowns = gapUnknowns(input.discovery);
  const unknowns = uniqueById([
    ...input.consumers.unknowns,
    ...discoveryUnknowns,
    ...input.tests.unknowns,
  ]).sort((left, right) => compareCodePoints(left.id, right.id));
  const evidenceById = new Map<string, Evidence>(
    uniqueById([
      ...input.analysisIr.evidence,
      ...input.linkageIr.evidence,
      ...input.discovery.ir.evidence,
      ...input.consumers.generatedEvidence,
      ...input.tests.evidence,
    ]).map((evidence) => [evidence.id, evidence]),
  );
  const referencedIds = referencedEvidenceIds({
    consumers: input.consumers,
    tests: input.tests,
    unknowns,
  });
  const missing = [...referencedIds].filter((id) => !evidenceById.has(id));
  if (missing.length > 0) {
    throw new TestDiscoveryError(
      "phase6_input_invalid",
      `Phase 6 integration references missing evidence ${missing.sort(compareCodePoints)[0]}.`,
    );
  }
  const diagnostics = [
    ...new Set([
      ...input.consumers.diagnostics,
      ...input.discovery.headDiscovery.diagnostics.map(
        (diagnostic) => diagnostic.summary,
      ),
      ...input.tests.diagnostics,
    ]),
  ].sort(compareCodePoints);
  const semantic = {
    schemaVersion: "1.0.0" as const,
    repositoryId: input.linkageIr.repositoryId,
    baseRevision: input.linkageIr.baseRevision,
    headRevision: input.linkageIr.headRevision,
    analyzerVersion: input.analyzerVersion,
    family: input.family,
    status:
      input.consumers.status === "incomplete" ||
      input.discovery.headDiscovery.status === "incomplete" ||
      input.tests.status === "incomplete" ||
      unknowns.some((unknown) => unknown.blockingRelevance !== "none")
        ? ("incomplete" as const)
        : ("completed" as const),
    discovery: structuredClone(input.discovery.headDiscovery),
    paths: structuredClone(input.consumers.paths),
    impacts: structuredClone(input.consumers.impacts),
    recommendations: structuredClone(input.tests.recommendations),
    decisions: structuredClone(input.tests.decisions),
    testGaps: structuredClone(input.tests.gaps),
    unknowns,
    evidence: [...referencedIds]
      .map((id) => evidenceById.get(id)!)
      .sort((left, right) => compareCodePoints(left.id, right.id)),
    diagnostics,
  };
  return {
    ...semantic,
    semanticDigest: semanticDigest(semantic),
    runtime: { durationMs: Math.max(0, performance.now() - input.startedAt) },
  };
}

function validateLinkageBindings(
  contractIr: CanonicalIr,
  linkageIr: CanonicalIr,
): void {
  try {
    validateCanonicalIr(contractIr);
    validateCanonicalIr(linkageIr);
  } catch (cause) {
    throw new TestDiscoveryError(
      "phase6_input_invalid",
      "Phase 6 requires valid canonical contract and linkage IR.",
      cause,
    );
  }
  if (
    contractIr.repositoryId !== linkageIr.repositoryId ||
    contractIr.baseRevision !== linkageIr.baseRevision ||
    contractIr.headRevision !== linkageIr.headRevision
  ) {
    throw new TestDiscoveryError(
      "phase6_input_invalid",
      "Phase 6 contract and linkage IR use different exact comparisons.",
    );
  }
}

export async function runPhase6TypeScriptIntegration(
  options: RunPhase6TypeScriptOptions,
): Promise<Phase6IntegrationResult> {
  const startedAt = performance.now();
  const version = analyzerVersion(options.analyzerVersion);
  const rawConsumers = analyzeTypeScriptConsumers({
    ir: options.ir,
    changes: options.changes,
    baseAnalysis: options.baseAnalysis,
    headAnalysis: options.headAnalysis,
    symbolAnalysis: options.symbolAnalysis,
    ...(options.projectDiscovery
      ? { headDiscovery: options.projectDiscovery }
      : {}),
    ...(options.consumerLimits ? { limits: options.consumerLimits } : {}),
    analyzerVersion: version,
  });
  const discovery = await runTestDiscoveryComparison({
    repositoryId: options.ir.repositoryId,
    base: options.base,
    head: options.head,
    analyzerVersion: version,
  });
  const normalized = normalizeTerminalTestConsumers(
    options.ir,
    rawConsumers,
    discovery,
  );
  const tests = recommendTests({
    ir: options.ir,
    testIr: discovery.ir,
    discovery: discovery.headDiscovery,
    consumers: normalized.result,
    ...(options.recommendationLimits
      ? { limits: options.recommendationLimits }
      : {}),
    analyzerVersion: version,
  });
  return finalizeIntegration({
    family: "typescript",
    analysisIr: options.ir,
    linkageIr: options.ir,
    consumers: normalized.result,
    discovery,
    tests,
    analyzerVersion: version,
    startedAt,
  });
}

export async function runPhase6OpenApiIntegration(
  options: RunPhase6OpenApiOptions,
): Promise<Phase6IntegrationResult> {
  const startedAt = performance.now();
  const version = analyzerVersion(options.analyzerVersion);
  validateLinkageBindings(options.contractIr, options.linkageIr);
  const consumers = await analyzeOpenApiConsumers({
    ir: options.contractIr,
    changes: options.changes,
    baseAnalysis: options.baseAnalysis,
    headAnalysis: options.headAnalysis,
    headDirectory: options.head.directory,
    ...(options.consumerLimits ? { limits: options.consumerLimits } : {}),
    analyzerVersion: version,
  });
  const discovery = await runTestDiscoveryComparison({
    repositoryId: options.linkageIr.repositoryId,
    base: options.base,
    head: options.head,
    analyzerVersion: version,
  });
  const tests = recommendTests({
    ir: options.linkageIr,
    testIr: discovery.ir,
    discovery: discovery.headDiscovery,
    consumers,
    ...(options.recommendationLimits
      ? { limits: options.recommendationLimits }
      : {}),
    analyzerVersion: version,
  });
  return finalizeIntegration({
    family: "openapi",
    analysisIr: options.contractIr,
    linkageIr: options.linkageIr,
    consumers,
    discovery,
    tests,
    analyzerVersion: version,
    startedAt,
  });
}

function matchesConsumer(
  expected: Phase6ExpectedConsumer,
  impact: ManifestImpact,
): boolean {
  return (
    (expected.category === undefined ||
      impact.category === expected.category) &&
    impact.affectedComponents.some(
      (component) => component.name === expected.name,
    )
  );
}

function matchesTest(
  expected: Phase6ExpectedTest,
  recommendation: Phase6IntegrationResult["recommendations"][number],
): boolean {
  return (
    recommendation.test.name === expected.name &&
    (expected.commandContains === undefined ||
      recommendation.command.includes(expected.commandContains)) &&
    (expected.reasonContains === undefined ||
      recommendation.reason.includes(expected.reasonContains))
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

export function evaluatePhase6Quality(
  cases: readonly Phase6QualityCase[],
): Phase6QualityMetrics {
  if (cases.length === 0) {
    throw new TestDiscoveryError(
      "phase6_input_invalid",
      "Phase 6 quality evaluation requires at least one case.",
    );
  }
  const caseResults: Phase6QualityCaseResult[] = [];
  let directTruePositives = 0;
  let directFalsePositives = 0;
  let consumerTruePositives = 0;
  let consumerFalseNegatives = 0;
  let testTruePositives = 0;
  let testFalsePositives = 0;
  let testFalseNegatives = 0;
  let deterministic = 0;

  for (const qualityCase of [...cases].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  )) {
    const actualImpacts = qualityCase.result.impacts;
    const actualTests = qualityCase.result.recommendations;
    const consumerTp = qualityCase.requiredConsumers.filter((expected) =>
      actualImpacts.some((impact) => matchesConsumer(expected, impact)),
    ).length;
    const consumerFn = qualityCase.requiredConsumers.length - consumerTp;
    const consumerFp = actualImpacts.filter(
      (impact) =>
        !qualityCase.requiredConsumers.some((expected) =>
          matchesConsumer(expected, impact),
        ),
    ).length;
    const testTp = qualityCase.requiredTests.filter((expected) =>
      actualTests.some((recommendation) =>
        matchesTest(expected, recommendation),
      ),
    ).length;
    const testFn = qualityCase.requiredTests.length - testTp;
    const testFp = actualTests.filter(
      (recommendation) =>
        !qualityCase.requiredTests.some((expected) =>
          matchesTest(expected, recommendation),
        ),
    ).length;
    const forbiddenConsumerMatches = (qualityCase.forbiddenConsumers ?? [])
      .filter((expected) =>
        actualImpacts.some((impact) => matchesConsumer(expected, impact)),
      )
      .map((expected) => expected.name)
      .sort(compareCodePoints);
    const forbiddenTestMatches = (qualityCase.forbiddenTests ?? [])
      .filter((expected) =>
        actualTests.some((recommendation) =>
          matchesTest(expected, recommendation),
        ),
      )
      .map((expected) => expected.name)
      .sort(compareCodePoints);
    const missingGapComponents = (qualityCase.requiredGapComponents ?? [])
      .filter(
        (name) =>
          !qualityCase.result.testGaps.some(
            (gap) => gap.affectedComponent.name === name,
          ),
      )
      .sort(compareCodePoints);
    const deterministicCase =
      qualityCase.repeatResult !== undefined &&
      qualityCase.repeatResult.semanticDigest.value ===
        qualityCase.result.semanticDigest.value;
    if (deterministicCase) deterministic += 1;
    const value = {
      id: qualityCase.id.normalize("NFC"),
      passed:
        consumerFn === 0 &&
        consumerFp === 0 &&
        testFn === 0 &&
        testFp === 0 &&
        missingGapComponents.length === 0 &&
        forbiddenConsumerMatches.length === 0 &&
        forbiddenTestMatches.length === 0 &&
        deterministicCase,
      consumerTruePositives: consumerTp,
      consumerFalsePositives: consumerFp,
      consumerFalseNegatives: consumerFn,
      testTruePositives: testTp,
      testFalsePositives: testFp,
      testFalseNegatives: testFn,
      missingGapComponents,
      forbiddenConsumerMatches,
      forbiddenTestMatches,
    };
    caseResults.push(value);
    consumerTruePositives += consumerTp;
    consumerFalseNegatives += consumerFn;
    testTruePositives += testTp;
    testFalsePositives += testFp;
    testFalseNegatives += testFn;
    const directActual = actualImpacts.filter(
      (impact) => impact.category === "direct",
    );
    directTruePositives += directActual.filter((impact) =>
      qualityCase.requiredConsumers.some(
        (expected) =>
          (expected.category === undefined || expected.category === "direct") &&
          matchesConsumer(expected, impact),
      ),
    ).length;
    directFalsePositives += directActual.filter(
      (impact) =>
        !qualityCase.requiredConsumers.some(
          (expected) =>
            (expected.category === undefined ||
              expected.category === "direct") &&
            matchesConsumer(expected, impact),
        ),
    ).length;
  }

  const directConsumerPrecision = rounded(
    ratio(directTruePositives, directTruePositives + directFalsePositives),
  );
  const testSelectionRecall = rounded(
    ratio(testTruePositives, testTruePositives + testFalseNegatives),
  );
  const deterministicRate = rounded(ratio(deterministic, cases.length));
  const gates = {
    directConsumerPrecision: directConsumerPrecision >= 0.9,
    testSelectionRecall: testSelectionRecall >= 0.8,
    determinism: deterministicRate === 1,
    forbiddenResults: caseResults.every(
      (result) =>
        result.forbiddenConsumerMatches.length === 0 &&
        result.forbiddenTestMatches.length === 0,
    ),
  };
  const semantic = {
    schemaVersion: "1.0.0" as const,
    cases: cases.length,
    passedCases: caseResults.filter((result) => result.passed).length,
    directConsumerPrecision,
    consumerRecall: rounded(
      ratio(
        consumerTruePositives,
        consumerTruePositives + consumerFalseNegatives,
      ),
    ),
    testSelectionRecall,
    testPrecision: rounded(
      ratio(testTruePositives, testTruePositives + testFalsePositives),
    ),
    deterministicRate,
    gates,
    passed:
      Object.values(gates).every(Boolean) &&
      caseResults.every((result) => result.passed),
    caseResults: caseResults.sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
  };
  return { ...semantic, semanticDigest: semanticDigest(semantic) };
}
