import { createHash } from "node:crypto";
import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import { createEvidence } from "@bytesmith/evidence";
import type {
  ManifestImpact,
  ManifestTestGap,
  ManifestTestRecommendation,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateStableId,
  type ComponentRef,
  type Evidence,
  type SourceLocation,
} from "@bytesmith/impact-types";
import {
  validateCanonicalIr,
  type CanonicalIr,
  type IrRelationship,
} from "@bytesmith/ir";
import { TestDiscoveryError } from "./errors.js";
import type {
  DiscoveredTestCase,
  RecommendTestsInput,
  TestProject,
  TestRecommendationDecision,
  TestRecommendationLimits,
  TestRecommendationResult,
  TestRecommendationSignal,
} from "./types.js";

interface ImpactGroup {
  component: ComponentRef;
  impacts: ManifestImpact[];
}

interface Candidate {
  test: {
    id: string;
    name: string;
    location: SourceLocation;
    evidenceIds: string[];
    path: string;
    projectId: string;
    command?: string;
    generatedEvidence?: Evidence;
  };
  score: number;
  signals: TestRecommendationSignal[];
  evidenceIds: string[];
}

const defaultLimits: TestRecommendationLimits = {
  maxRecommendationsPerComponent: 5,
};
const relationshipKinds = new Set(["calls", "references", "imports"]);
const tokenStopWords = new Set([
  "a",
  "an",
  "and",
  "index",
  "it",
  "should",
  "spec",
  "src",
  "test",
  "tests",
  "the",
]);

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function digest(value: unknown) {
  return {
    algorithm: "sha256" as const,
    value: createHash("sha256").update(canonicalJson(value)).digest("hex"),
  };
}

function normalizeLimits(
  input: Partial<TestRecommendationLimits> | undefined,
): TestRecommendationLimits {
  const value = {
    ...defaultLimits,
    ...input,
  }.maxRecommendationsPerComponent;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TestDiscoveryError(
      "recommendation_limit_invalid",
      "maxRecommendationsPerComponent must be a positive safe integer.",
    );
  }
  return { maxRecommendationsPerComponent: value };
}

function validateInputs(input: RecommendTestsInput): string {
  try {
    validateCanonicalIr(input.ir);
    validateCanonicalIr(input.testIr);
  } catch (cause) {
    throw new TestDiscoveryError(
      "recommendation_input_invalid",
      "Test recommendations require valid canonical IR inputs.",
      cause,
    );
  }
  if (
    input.ir.repositoryId !== input.testIr.repositoryId ||
    input.ir.repositoryId !== input.discovery.repositoryId ||
    input.ir.repositoryId !== input.consumers.repositoryId ||
    input.ir.baseRevision !== input.testIr.baseRevision ||
    input.ir.baseRevision !== input.consumers.baseRevision ||
    input.ir.headRevision !== input.testIr.headRevision ||
    input.ir.headRevision !== input.discovery.revision ||
    input.ir.headRevision !== input.consumers.headRevision
  ) {
    throw new TestDiscoveryError(
      "recommendation_binding_invalid",
      "Consumer, test-discovery, and IR inputs belong to different exact comparisons.",
    );
  }
  try {
    return normalizeNonEmptyText(
      input.analyzerVersion ?? "0.1.0",
      "Test recommendation analyzer version",
    );
  } catch (cause) {
    throw new TestDiscoveryError(
      "recommendation_input_invalid",
      "Test recommendation analyzer version is invalid.",
      cause,
    );
  }
}

function irComponent(ir: CanonicalIr, id: string): ComponentRef | undefined {
  const symbol = ir.symbols.find((candidate) => candidate.id === id);
  if (symbol) {
    return {
      id: symbol.id,
      kind: "symbol",
      name: symbol.name,
      location: structuredClone(symbol.location),
    };
  }
  const file = ir.files.find((candidate) => candidate.id === id);
  return file
    ? {
        id: file.id,
        kind: "file",
        name: file.location.path,
        location: structuredClone(file.location),
      }
    : undefined;
}

function effectiveComponents(
  input: RecommendTestsInput,
  impact: ManifestImpact,
): ComponentRef[] {
  const testPaths = new Set(
    input.discovery.testFiles.map((testFile) => testFile.path),
  );
  const result: ComponentRef[] = [];
  for (const component of impact.affectedComponents) {
    if (!component.location || !testPaths.has(component.location.path)) {
      result.push(component);
      continue;
    }
    const path = input.consumers.paths.find(
      (candidate) =>
        candidate.affectedComponentId === component.id &&
        candidate.edges[0]?.fromId === component.id,
    );
    const nearestConsumer = path?.edges[0]
      ? irComponent(input.ir, path.edges[0].toId)
      : undefined;
    if (nearestConsumer) result.push(nearestConsumer);
  }
  return result;
}

function impactGroups(input: RecommendTestsInput): ImpactGroup[] {
  const groups = new Map<string, ImpactGroup>();
  for (const impact of [...input.consumers.impacts].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  )) {
    validateStableId(impact.id, "Consumer impact ID");
    if (
      impact.affectedComponents.length === 0 ||
      impact.evidenceIds.length === 0
    ) {
      throw new TestDiscoveryError(
        "recommendation_input_invalid",
        "Consumer impacts require affected components and evidence.",
      );
    }
    for (const evidenceId of impact.evidenceIds) {
      validateStableId(evidenceId, "Consumer impact evidence ID");
    }
    for (const component of effectiveComponents(input, impact)) {
      validateStableId(component.id, "Affected component ID");
      const existing = groups.get(component.id);
      if (existing) {
        if (
          existing.component.kind !== component.kind ||
          existing.component.name !== component.name ||
          canonicalJson(existing.component.location ?? null) !==
            canonicalJson(component.location ?? null)
        ) {
          throw new TestDiscoveryError(
            "recommendation_input_invalid",
            "One affected component ID has conflicting semantic content.",
          );
        }
        existing.impacts.push(impact);
      } else {
        groups.set(component.id, {
          component: structuredClone(component),
          impacts: [impact],
        });
      }
    }
  }
  return [...groups.values()].sort((left, right) =>
    compareCodePoints(left.component.id, right.component.id),
  );
}

function words(value: string): Set<string> {
  const separated = value
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .normalize("NFKD")
    .toLowerCase();
  return new Set(
    separated
      .split(/[^a-z\d]+/u)
      .filter((token) => token.length >= 2 && !tokenStopWords.has(token)),
  );
}

function fileStem(filePath: string): string {
  const name = filePath.split("/").at(-1) ?? filePath;
  return name.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\.(?:spec|test)$/u, "");
}

function overlapScore(
  test: { name: string; path: string },
  component: ComponentRef,
) {
  const componentTokens = words(
    `${component.name} ${component.location ? fileStem(component.location.path) : ""}`,
  );
  const testTokens = words(`${test.name} ${fileStem(test.path)}`);
  if (componentTokens.size === 0) return 0;
  const overlap = [...componentTokens].filter((token) =>
    testTokens.has(token),
  ).length;
  return Math.round((overlap / componentTokens.size) * 20);
}

function testIrRecord(testIr: CanonicalIr, testCase: DiscoveredTestCase) {
  return testIr.tests.find(
    (candidate) =>
      candidate.revision === testCase.revision &&
      candidate.framework === testCase.framework &&
      candidate.location.path === testCase.path &&
      candidate.location.startLine === testCase.line &&
      candidate.location.startColumn === testCase.column &&
      candidate.name === testCase.name,
  );
}

function subjectForTestCase(
  testIr: CanonicalIr,
  testCase: DiscoveredTestCase,
): Candidate["test"] {
  const record = testIrRecord(testIr, testCase);
  if (!record) {
    throw new TestDiscoveryError(
      "recommendation_input_invalid",
      "Discovered test case is missing from canonical test IR.",
    );
  }
  return {
    id: record.id,
    name: record.name,
    location: structuredClone(record.location),
    evidenceIds: [...record.evidenceIds],
    path: testCase.path,
    projectId: testCase.projectId,
    ...(testCase.command ? { command: testCase.command } : {}),
  };
}

function recommendationTestName(componentName: string): string {
  const logicalName = componentName.split(/[.#]/u).at(-1) ?? componentName;
  const normalized = logicalName
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/[^A-Za-z\d]+/gu, " ")
    .trim()
    .toLowerCase();
  return `${normalized || "affected component"} test`;
}

function subjectsForGroup(
  input: RecommendTestsInput,
  group: ImpactGroup,
  analyzerVersion: string,
): Candidate["test"][] {
  const subjects = input.discovery.testCases.map((testCase) =>
    subjectForTestCase(input.testIr, testCase),
  );
  for (const testFile of input.discovery.testFiles.filter(
    (candidate) => candidate.testCaseIds.length === 0,
  )) {
    const name = recommendationTestName(group.component.name);
    const evidence = createEvidence(
      {
        repositoryId: input.ir.repositoryId,
        baseRevision: input.ir.baseRevision,
        headRevision: input.ir.headRevision,
        producer: {
          id: "bytesmith.test-intelligence",
          version: analyzerVersion,
        },
      },
      {
        kind: "syntax",
        revision: input.ir.headRevision,
        path: testFile.path,
        summary: `Discovered ${testFile.framework} test file ${testFile.path}.`,
      },
    );
    subjects.push({
      id: stableId("test-file-component", {
        repositoryId: input.ir.repositoryId,
        revision: input.ir.headRevision,
        framework: testFile.framework,
        path: testFile.path,
        name,
        affectedComponentId: group.component.id,
      }),
      name,
      location: {
        repository: input.ir.repositoryId,
        revision: input.ir.headRevision,
        path: testFile.path,
      },
      evidenceIds: [evidence.id],
      path: testFile.path,
      projectId: testFile.projectId,
      ...(testFile.command ? { command: testFile.command } : {}),
      generatedEvidence: evidence,
    });
  }
  return subjects.sort((left, right) => compareCodePoints(left.id, right.id));
}

function sourceNodeIds(ir: CanonicalIr, filePath: string): Set<string> {
  return new Set([
    ...ir.files
      .filter(
        (item) =>
          item.revision === ir.headRevision && item.location.path === filePath,
      )
      .map((item) => item.id),
    ...ir.symbols
      .filter(
        (item) =>
          item.revision === ir.headRevision && item.location.path === filePath,
      )
      .map((item) => item.id),
  ]);
}

function targetNodeIds(ir: CanonicalIr, component: ComponentRef): Set<string> {
  const result = new Set<string>();
  for (const collection of [ir.files, ir.symbols, ir.contracts]) {
    for (const item of collection) {
      if (item.revision !== ir.headRevision) continue;
      if (item.id === component.id) result.add(item.id);
      if (
        component.location &&
        item.location.path === component.location.path
      ) {
        result.add(item.id);
      }
    }
  }
  return result;
}

function linkingRelationships(
  ir: CanonicalIr,
  testPath: string,
  component: ComponentRef,
): IrRelationship[] {
  const sources = sourceNodeIds(ir, testPath);
  const targets = targetNodeIds(ir, component);
  return ir.relationships
    .filter(
      (relationship) =>
        relationship.revision === ir.headRevision &&
        relationship.authority === "authoritative" &&
        relationshipKinds.has(relationship.kind) &&
        sources.has(relationship.fromId) &&
        targets.has(relationship.toId),
    )
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

function packageConvention(
  project: TestProject | undefined,
  component: ComponentRef,
): boolean {
  if (!project || component.kind !== "package" || !component.location) {
    return false;
  }
  return (
    project.packageManifestPath === component.location.path ||
    project.packageDirectory ===
      component.location.path.replace(/\/package\.json$/u, "")
  );
}

function directoryConvention(
  testPath: string,
  component: ComponentRef,
): boolean {
  if (!component.location) return false;
  const testDirectory = testPath.includes("/")
    ? testPath.slice(0, testPath.lastIndexOf("/"))
    : ".";
  const componentPath = component.location.path;
  const componentDirectory = componentPath.includes("/")
    ? componentPath.slice(0, componentPath.lastIndexOf("/"))
    : ".";
  return (
    testDirectory === componentDirectory ||
    testDirectory === `${componentDirectory}/__tests__`
  );
}

function createCandidate(
  input: RecommendTestsInput,
  group: ImpactGroup,
  test: Candidate["test"],
): Candidate | undefined {
  const relationships = linkingRelationships(
    input.ir,
    test.path,
    group.component,
  );
  const signals = new Set<TestRecommendationSignal>();
  let score = 0;
  for (const relationship of relationships) {
    if (relationship.kind === "calls" || relationship.kind === "references") {
      signals.add("direct_reference");
      score = Math.max(
        score,
        relationship.toId === group.component.id ? 100 : 95,
      );
    } else if (relationship.toId === group.component.id) {
      signals.add("direct_import");
      score = Math.max(score, 90);
    } else {
      signals.add("module_import");
      score = Math.max(score, 80);
    }
  }
  const nameScore = overlapScore(test, group.component);
  if (nameScore > 0) {
    signals.add("name_convention");
    score += nameScore;
    if (directoryConvention(test.path, group.component)) {
      signals.add("directory_convention");
      score += 5;
    }
  }
  const project = input.discovery.projects.find(
    (candidate) => candidate.id === test.projectId,
  );
  if (packageConvention(project, group.component)) {
    signals.add("package_convention");
    score = Math.max(score, 30);
  }
  if (relationships.length === 0 && nameScore === 0 && score === 0) {
    return undefined;
  }
  const impactEvidence = group.impacts.flatMap((impact) => impact.evidenceIds);
  return {
    test,
    score: relationships.length === 0 ? Math.max(score, 40) : score,
    signals: [...signals].sort(compareCodePoints),
    evidenceIds: [
      ...new Set([
        ...test.evidenceIds,
        ...impactEvidence,
        ...relationships.flatMap((relationship) => relationship.evidenceIds),
      ]),
    ].sort(compareCodePoints),
  };
}

function recommendationReason(
  candidate: Candidate,
  component: ComponentRef,
): string {
  if (candidate.signals.includes("direct_reference")) {
    return `${candidate.test.name} directly references affected consumer ${component.name}.`;
  }
  if (
    candidate.signals.includes("direct_import") ||
    candidate.signals.includes("module_import")
  ) {
    return `The file containing ${candidate.test.name} imports the module for affected consumer ${component.name}.`;
  }
  if (candidate.signals.includes("package_convention")) {
    return `Low-confidence package convention links ${candidate.test.name} to affected component ${component.name}.`;
  }
  return `Low-confidence naming convention links ${candidate.test.name} to affected component ${component.name}.`;
}

function confidence(candidate: Candidate): "verified" | "high" | "low" {
  if (candidate.signals.includes("direct_reference")) return "verified";
  if (
    candidate.signals.includes("direct_import") ||
    candidate.signals.includes("module_import")
  ) {
    return "high";
  }
  return "low";
}

function recommendationRecord(
  candidate: Candidate,
  component: ComponentRef,
  evidenceIds: readonly string[],
): ManifestTestRecommendation {
  const record = {
    test: {
      id: candidate.test.id,
      kind: "test" as const,
      name: candidate.test.name,
      location: structuredClone(candidate.test.location),
    },
    command: candidate.test.command!,
    reason: recommendationReason(candidate, component),
    evidenceIds: [...new Set(evidenceIds)].sort(compareCodePoints),
  };
  return { id: stableId("test-recommendation", record), ...record };
}

function gapRecord(group: ImpactGroup): ManifestTestGap {
  const evidenceIds = [
    ...new Set(group.impacts.flatMap((impact) => impact.evidenceIds)),
  ].sort(compareCodePoints);
  const record = {
    affectedComponent: structuredClone(group.component),
    gapKind: "not_found" as const,
    reason: `no test found for affected component ${group.component.name} within supported Jest/Vitest discovery and linkage.`,
    evidenceIds,
  };
  return { id: stableId("test-gap", record), ...record };
}

function truncationUnknown(input: {
  component: ComponentRef;
  candidate: Candidate;
  limit: number;
}): ManifestUnknown {
  const summary = `Test ranking for ${input.component.name} exceeded the ${input.limit}-recommendation limit.`;
  const record = {
    type: "analyzer_gap" as const,
    summary,
    locations: [structuredClone(input.candidate.test.location)],
    evidenceIds: [...input.candidate.evidenceIds],
    blockingRelevance: "possible" as const,
  };
  return { id: stableId("test-recommendation-unknown", record), ...record };
}

function heuristicEvidence(input: {
  ir: CanonicalIr;
  analyzerVersion: string;
  component: ComponentRef;
  candidate: Candidate;
}): Evidence | undefined {
  if (
    input.candidate.signals.includes("direct_reference") ||
    input.candidate.signals.includes("direct_import") ||
    input.candidate.signals.includes("module_import")
  ) {
    return undefined;
  }
  return createEvidence(
    {
      repositoryId: input.ir.repositoryId,
      baseRevision: input.ir.baseRevision,
      headRevision: input.ir.headRevision,
      producer: {
        id: "bytesmith.test-intelligence",
        version: input.analyzerVersion,
      },
    },
    {
      kind: "heuristic",
      revision: input.ir.headRevision,
      path: input.candidate.test.location.path,
      ...(input.candidate.test.location.startLine === undefined
        ? {}
        : { startLine: input.candidate.test.location.startLine }),
      ...(input.candidate.test.location.startColumn === undefined
        ? {}
        : { startColumn: input.candidate.test.location.startColumn }),
      summary: `Low-confidence convention links ${input.candidate.test.name} to ${input.component.name}.`,
    },
  );
}

function assertEvidence(
  records: ReadonlyMap<string, Evidence>,
  ids: readonly string[],
): void {
  for (const id of ids) {
    if (!records.has(id)) {
      throw new TestDiscoveryError(
        "recommendation_evidence_missing",
        `Test recommendation references missing evidence ${id}.`,
      );
    }
  }
}

export function recommendTests(
  input: RecommendTestsInput,
): TestRecommendationResult {
  const analyzerVersion = validateInputs(input);
  const limits = normalizeLimits(input.limits);
  const evidenceById = new Map(
    uniqueById([
      ...input.ir.evidence,
      ...input.testIr.evidence,
      ...input.consumers.generatedEvidence,
    ]).map((item) => [item.id, item]),
  );
  const recommendations: ManifestTestRecommendation[] = [];
  const decisions: TestRecommendationDecision[] = [];
  const gaps: ManifestTestGap[] = [];
  const unknowns: ManifestUnknown[] = [];
  const diagnostics: string[] = [];
  const selectedEvidenceIds = new Set<string>();

  for (const group of impactGroups(input)) {
    const candidates: Candidate[] = [];
    let linkedWithoutCommand = false;
    for (const test of subjectsForGroup(input, group, analyzerVersion)) {
      if (test.generatedEvidence) {
        evidenceById.set(test.generatedEvidence.id, test.generatedEvidence);
      }
      const candidate = createCandidate(input, group, test);
      if (!candidate) continue;
      if (!test.command) {
        linkedWithoutCommand = true;
        continue;
      }
      candidates.push(candidate);
    }
    candidates.sort(
      (left, right) =>
        right.score - left.score ||
        compareCodePoints(left.test.id, right.test.id),
    );
    const bestScore = candidates[0]?.score;
    const best =
      bestScore === undefined
        ? []
        : candidates.filter((candidate) => candidate.score === bestScore);
    const selected = best.slice(0, limits.maxRecommendationsPerComponent);
    if (best.length > selected.length) {
      const firstOmitted = best[selected.length]!;
      const unknown = truncationUnknown({
        component: group.component,
        candidate: firstOmitted,
        limit: limits.maxRecommendationsPerComponent,
      });
      unknowns.push(unknown);
      for (const id of unknown.evidenceIds) selectedEvidenceIds.add(id);
      diagnostics.push(unknown.summary);
    }
    if (selected.length === 0) {
      const gap = gapRecord(group);
      gaps.push(gap);
      for (const id of gap.evidenceIds) selectedEvidenceIds.add(id);
      if (linkedWithoutCommand) {
        diagnostics.push(
          `A linked test for ${group.component.name} has no supported repository-owned runnable command.`,
        );
      }
      continue;
    }
    for (const [index, candidate] of selected.entries()) {
      const generated = heuristicEvidence({
        ir: input.ir,
        analyzerVersion,
        component: group.component,
        candidate,
      });
      if (generated) evidenceById.set(generated.id, generated);
      const evidenceIds = generated
        ? [...candidate.evidenceIds, generated.id]
        : candidate.evidenceIds;
      const recommendation = recommendationRecord(
        candidate,
        group.component,
        evidenceIds,
      );
      recommendations.push(recommendation);
      decisions.push({
        recommendationId: recommendation.id,
        affectedComponentId: group.component.id,
        sourceImpactIds: group.impacts
          .map((impact) => impact.id)
          .sort(compareCodePoints),
        rank: index + 1,
        score: candidate.score,
        confidence: confidence(candidate),
        signals: [...candidate.signals],
      });
      for (const id of recommendation.evidenceIds) selectedEvidenceIds.add(id);
    }
  }

  for (const recommendation of recommendations) {
    assertEvidence(evidenceById, recommendation.evidenceIds);
  }
  for (const gap of gaps) assertEvidence(evidenceById, gap.evidenceIds);
  for (const unknown of unknowns)
    assertEvidence(evidenceById, unknown.evidenceIds);
  const evidence = [...selectedEvidenceIds]
    .map((id) => evidenceById.get(id)!)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const normalized = {
    schemaVersion: "1.0.0" as const,
    repositoryId: input.ir.repositoryId,
    baseRevision: input.ir.baseRevision,
    headRevision: input.ir.headRevision,
    analyzerVersion,
    status:
      input.discovery.status === "incomplete" ||
      input.consumers.status === "incomplete" ||
      unknowns.length > 0
        ? ("incomplete" as const)
        : ("completed" as const),
    recommendations: uniqueById(recommendations).sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    decisions: [...decisions].sort(
      (left, right) =>
        compareCodePoints(
          left.affectedComponentId,
          right.affectedComponentId,
        ) ||
        left.rank - right.rank ||
        compareCodePoints(left.recommendationId, right.recommendationId),
    ),
    gaps: uniqueById(gaps).sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    unknowns: uniqueById(unknowns).sort((left, right) =>
      compareCodePoints(left.id, right.id),
    ),
    evidence,
    diagnostics: [...new Set(diagnostics)].sort(compareCodePoints),
  };
  return { ...normalized, semanticDigest: digest(normalized) };
}
