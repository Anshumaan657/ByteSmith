import type { BenchmarkMetrics, CaseRunResult } from "./types.js";

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

export function calculateMetrics(results: CaseRunResult[]): BenchmarkMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let requiredTests = 0;
  let matchedTests = 0;
  let unsupported = 0;
  let changedFiles = 0;

  for (const result of results) {
    if (result.evaluation) {
      for (const counts of Object.values(result.evaluation.groups)) {
        truePositives += counts.matched;
        falseNegatives += counts.missing;
      }
      falsePositives += result.evaluation.falsePositiveCount;
      requiredTests += result.evaluation.groups.tests.required;
      matchedTests += result.evaluation.groups.tests.matched;
    }
    unsupported += result.coverage?.unsupported ?? 0;
    changedFiles += result.coverage?.totalChangedFiles ?? 0;
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  const passed = results.filter((result) => result.passed).length;
  const crashed = results.filter((result) => result.crashed).length;
  const incomplete = results.filter(
    (result) => result.conclusion === "incomplete",
  ).length;
  const deterministic = results.filter((result) => result.deterministic).length;

  return {
    cases: results.length,
    passed,
    failed: results.length - passed,
    crashed,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: rounded(precision),
    recall: rounded(recall),
    f1: rounded(f1),
    testSelectionRecall: rounded(ratio(matchedTests, requiredTests)),
    unsupportedRate: rounded(ratio(unsupported, changedFiles)),
    incompleteRate: rounded(ratio(incomplete, results.length)),
    crashRate: rounded(ratio(crashed, results.length)),
    determinismRate: rounded(ratio(deterministic, results.length)),
    durationMs: results.reduce((total, result) => total + result.durationMs, 0),
  };
}

export function segmentMetrics(
  results: CaseRunResult[],
  selector: (result: CaseRunResult) => string[],
): Record<string, BenchmarkMetrics> {
  const segments = new Map<string, CaseRunResult[]>();
  for (const result of results) {
    for (const value of selector(result)) {
      const segment = segments.get(value) ?? [];
      segment.push(result);
      segments.set(value, segment);
    }
  }
  return Object.fromEntries(
    [...segments.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, calculateMetrics(values)]),
  );
}
