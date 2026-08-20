import type {
  ActualChange,
  ActualImpact,
  ActualPolicy,
  ActualTest,
  ActualUnknown,
  ActualWaiver,
  AssertionGroup,
  ChangeBenchActual,
  ChangeBenchCase,
  ChangeMatcher,
  EvaluationIssue,
  EvaluationResult,
  GroupCounts,
  ImpactMatcher,
  PolicyMatcher,
  TestMatcher,
  UnknownMatcher,
  WaiverMatcher,
} from "./types.js";

function includesText(value: string | undefined, expected: string): boolean {
  return typeof value === "string" && value.includes(expected);
}

export function matchChange(
  matcher: ChangeMatcher,
  item: ActualChange,
): boolean {
  return (
    (matcher.kind === undefined || matcher.kind === item.kind) &&
    (matcher.compatibility === undefined ||
      matcher.compatibility === item.compatibility) &&
    (matcher.componentKind === undefined ||
      matcher.componentKind === item.component?.kind) &&
    (matcher.componentName === undefined ||
      matcher.componentName === item.component?.name) &&
    (matcher.summaryContains === undefined ||
      includesText(item.summary, matcher.summaryContains))
  );
}

export function matchImpact(
  matcher: ImpactMatcher,
  item: ActualImpact,
): boolean {
  return (
    (matcher.ruleId === undefined || matcher.ruleId === item.ruleId) &&
    (matcher.category === undefined || matcher.category === item.category) &&
    (matcher.severity === undefined || matcher.severity === item.severity) &&
    (matcher.confidence === undefined ||
      matcher.confidence === item.confidence) &&
    (matcher.affectedComponentKind === undefined ||
      item.affectedComponents?.some(
        (component) => component.kind === matcher.affectedComponentKind,
      ) === true) &&
    (matcher.affectedComponentName === undefined ||
      item.affectedComponents?.some(
        (component) => component.name === matcher.affectedComponentName,
      ) === true) &&
    (matcher.summaryContains === undefined ||
      includesText(item.summary, matcher.summaryContains))
  );
}

export function matchTest(matcher: TestMatcher, item: ActualTest): boolean {
  return (
    (matcher.testName === undefined || matcher.testName === item.test?.name) &&
    (matcher.commandContains === undefined ||
      includesText(item.command, matcher.commandContains)) &&
    (matcher.reasonContains === undefined ||
      includesText(item.reason, matcher.reasonContains))
  );
}

export function matchUnknown(
  matcher: UnknownMatcher,
  item: ActualUnknown,
): boolean {
  return (
    (matcher.type === undefined || matcher.type === item.type) &&
    (matcher.path === undefined ||
      item.locations?.some((location) => location.path === matcher.path) ===
        true) &&
    (matcher.summaryContains === undefined ||
      includesText(item.summary, matcher.summaryContains)) &&
    (matcher.blockingRelevance === undefined ||
      matcher.blockingRelevance === item.blockingRelevance)
  );
}

export function matchPolicy(
  matcher: PolicyMatcher,
  item: ActualPolicy,
): boolean {
  return (
    (matcher.ruleId === undefined || matcher.ruleId === item.ruleId) &&
    (matcher.ruleState === undefined || matcher.ruleState === item.ruleState) &&
    (matcher.result === undefined || matcher.result === item.result) &&
    (matcher.required === undefined || matcher.required === item.required) &&
    (matcher.suspensionScope === undefined ||
      matcher.suspensionScope === item.suspensionScope) &&
    (matcher.findingId === undefined ||
      item.findingIds?.includes(matcher.findingId) === true) &&
    (matcher.analysisGapId === undefined ||
      item.analysisGapIds?.includes(matcher.analysisGapId) === true)
  );
}

export function matchWaiver(
  matcher: WaiverMatcher,
  item: ActualWaiver,
): boolean {
  return (
    (matcher.findingId === undefined || matcher.findingId === item.findingId) &&
    (matcher.scope === undefined || matcher.scope === item.scope) &&
    (matcher.status === undefined || matcher.status === item.status)
  );
}

interface GroupDefinition {
  name: AssertionGroup;
  requiredKey: keyof ChangeBenchCase["expected"];
  forbiddenKey?: keyof ChangeBenchCase["expected"];
  matches: (matcher: unknown, value: unknown) => boolean;
}

const groupDefinitions: GroupDefinition[] = [
  {
    name: "changes",
    requiredKey: "requiredChanges",
    forbiddenKey: "forbiddenChanges",
    matches: (matcher, value) =>
      matchChange(matcher as ChangeMatcher, value as ActualChange),
  },
  {
    name: "impacts",
    requiredKey: "requiredImpacts",
    forbiddenKey: "forbiddenImpacts",
    matches: (matcher, value) =>
      matchImpact(matcher as ImpactMatcher, value as ActualImpact),
  },
  {
    name: "tests",
    requiredKey: "requiredTests",
    forbiddenKey: "forbiddenTests",
    matches: (matcher, value) =>
      matchTest(matcher as TestMatcher, value as ActualTest),
  },
  {
    name: "unknowns",
    requiredKey: "requiredUnknowns",
    forbiddenKey: "forbiddenUnknowns",
    matches: (matcher, value) =>
      matchUnknown(matcher as UnknownMatcher, value as ActualUnknown),
  },
  {
    name: "policies",
    requiredKey: "requiredPolicies",
    forbiddenKey: "forbiddenPolicies",
    matches: (matcher, value) =>
      matchPolicy(matcher as PolicyMatcher, value as ActualPolicy),
  },
  {
    name: "waivers",
    requiredKey: "requiredWaivers",
    matches: (matcher, value) =>
      matchWaiver(matcher as WaiverMatcher, value as ActualWaiver),
  },
];

function emptyCounts(): Record<AssertionGroup, GroupCounts> {
  return {
    changes: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
    impacts: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
    tests: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
    unknowns: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
    policies: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
    waivers: {
      required: 0,
      matched: 0,
      missing: 0,
      forbiddenMatched: 0,
      unexpected: 0,
    },
  };
}

function coverageMatches(
  expected: ChangeBenchCase["expected"]["coverage"],
  actual: unknown,
): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const value = actual as Record<string, unknown>;
  return (
    expected.totalChangedFiles === value.totalChangedFiles &&
    expected.analyzed === value.analyzed &&
    expected.partiallyAnalyzed === value.partiallyAnalyzed &&
    expected.unsupported === value.unsupported &&
    expected.intentionallyExcluded === value.intentionallyExcluded
  );
}

function actualValues(
  actual: ChangeBenchActual,
  group: AssertionGroup,
): unknown[] {
  const value = actual[group];
  if (group === "tests" && !Array.isArray(value)) {
    return value?.recommended ?? [];
  }
  return Array.isArray(value) ? value : [];
}

export function evaluateChangeBenchCase(
  caseDefinition: ChangeBenchCase,
  actual: ChangeBenchActual,
): EvaluationResult {
  const issues: EvaluationIssue[] = [];
  const groups = emptyCounts();
  let falsePositiveCount = 0;
  const actualConclusion = actual.conclusion ?? actual.status?.conclusion;
  const actualCoverage = actual.coverage ?? actual.scope?.coverage;

  if (caseDefinition.expected.conclusion !== actualConclusion) {
    issues.push({
      kind: "conclusion",
      message: `Expected conclusion ${caseDefinition.expected.conclusion}, received ${String(actualConclusion)}.`,
      expected: caseDefinition.expected.conclusion,
      actual: actualConclusion,
    });
  }
  if (!coverageMatches(caseDefinition.expected.coverage, actualCoverage)) {
    issues.push({
      kind: "coverage",
      message: "Coverage did not match the exact expectation.",
      expected: caseDefinition.expected.coverage,
      actual: actualCoverage,
    });
  }

  for (const definition of groupDefinitions) {
    const required = caseDefinition.expected[
      definition.requiredKey
    ] as unknown[];
    const forbidden = definition.forbiddenKey
      ? (caseDefinition.expected[definition.forbiddenKey] as unknown[])
      : [];
    const values = actualValues(actual, definition.name);
    const counts = groups[definition.name];
    counts.required = required.length;

    for (const expected of required) {
      if (values.some((value) => definition.matches(expected, value))) {
        counts.matched += 1;
      } else {
        counts.missing += 1;
        issues.push({
          kind: "missing",
          group: definition.name,
          message: `Required ${definition.name} matcher did not match: ${JSON.stringify(expected)}`,
          expected,
        });
      }
    }

    for (const prohibited of forbidden) {
      if (values.some((value) => definition.matches(prohibited, value))) {
        counts.forbiddenMatched += 1;
        issues.push({
          kind: "forbidden",
          group: definition.name,
          message: `Forbidden ${definition.name} matcher matched: ${JSON.stringify(prohibited)}`,
          expected: prohibited,
        });
      }
    }

    for (const value of values) {
      const forbiddenValue = forbidden.some((prohibited) =>
        definition.matches(prohibited, value),
      );
      const unexpectedValue =
        !caseDefinition.expected.allowUnexpected &&
        !required.some((expected) => definition.matches(expected, value));
      if (unexpectedValue) {
        counts.unexpected += 1;
        issues.push({
          kind: "unexpected",
          group: definition.name,
          message: `Unexpected ${definition.name} result: ${JSON.stringify(value)}`,
          actual: value,
        });
      }
      if (forbiddenValue || unexpectedValue) falsePositiveCount += 1;
    }
  }

  return {
    passed: issues.length === 0,
    errors: issues.map((issue) => issue.message),
    issues,
    falsePositiveCount,
    groups,
  };
}
