import type { ChangeBenchReport } from "@bytesmith/changebench";
import type { ImpactManifest } from "@bytesmith/impact-manifest";
import type { Command, ErrorEnvelope } from "./types.js";

const colors = {
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
  reset: "\u001b[0m",
};

function paint(value: string, color: keyof typeof colors, enabled: boolean) {
  return enabled ? `${colors[color]}${value}${colors.reset}` : value;
}

function heading(value: string, color: boolean): string {
  return paint(value, "cyan", color);
}

function conclusion(value: string, color: boolean): string {
  const selected =
    value === "pass" ? "green" : value === "warn" ? "yellow" : "red";
  return paint(value.toUpperCase(), selected, color);
}

function location(value: { location?: { path: string; line?: number } }) {
  const source = value.location;
  if (!source) return "unknown location";
  return `${source.path}${source.line === undefined ? "" : `:${source.line}`}`;
}

function linesForChanges(manifest: ImpactManifest): string[] {
  if (manifest.changes.length === 0) return ["  None"];
  return manifest.changes.map(
    (change) =>
      `  - [${change.compatibility}] ${change.component.name}: ${change.summary}`,
  );
}

function linesForImpacts(manifest: ImpactManifest): string[] {
  if (manifest.impacts.length === 0) return ["  None"];
  return manifest.impacts.flatMap((impact) =>
    impact.affectedComponents.map(
      (component) =>
        `  - [${impact.category}/${impact.confidence}] ${component.name}: ${impact.summary}`,
    ),
  );
}

function linesForTests(manifest: ImpactManifest): string[] {
  const selected = manifest.tests.recommended.flatMap((test) => [
    `  - ${test.test.name} (${location(test.test)})`,
    `    Command: ${test.command}`,
    `    Reason: ${test.reason}`,
  ]);
  const gaps = manifest.tests.gaps.map(
    (gap) => `  - GAP ${gap.affectedComponent.name}: ${gap.reason}`,
  );
  return selected.length + gaps.length === 0
    ? ["  None"]
    : [...selected, ...gaps];
}

function linesForUnknowns(manifest: ImpactManifest): string[] {
  if (manifest.unknowns.length === 0) return ["  None"];
  return manifest.unknowns.map(
    (unknown) =>
      `  - [${unknown.blockingRelevance}] ${unknown.type}: ${unknown.summary}`,
  );
}

export function manifestProjection(
  manifest: ImpactManifest,
  command: Command,
): unknown {
  if (command === "contracts") {
    return {
      schemaVersion: "1.0.0",
      manifestId: manifest.manifestId,
      comparison: manifest.comparison,
      status: manifest.status,
      changes: manifest.changes,
      impacts: manifest.impacts,
      unknowns: manifest.unknowns,
    };
  }
  if (command === "test-plan") {
    return {
      schemaVersion: "1.0.0",
      manifestId: manifest.manifestId,
      comparison: manifest.comparison,
      status: manifest.status,
      impacts: manifest.impacts,
      tests: manifest.tests,
      unknowns: manifest.unknowns,
    };
  }
  if (command === "verify-impact") {
    return {
      schemaVersion: "1.0.0",
      valid: true,
      manifestId: manifest.manifestId,
      repository: manifest.repository,
      comparison: manifest.comparison,
      status: manifest.status,
      integrity: manifest.integrity,
    };
  }
  return manifest;
}

export function renderManifest(
  manifest: ImpactManifest,
  command: Command,
  useColor: boolean,
): string {
  const header = [
    `ByteSmith ${conclusion(manifest.status.conclusion, useColor)}`,
    `Repository: ${manifest.repository.name}`,
    `Comparison: ${manifest.comparison.baseRevision}..${manifest.comparison.headRevision}`,
    `Coverage: ${manifest.scope.coverage.analyzed}/${manifest.scope.coverage.totalChangedFiles} analyzed, ${manifest.scope.coverage.partiallyAnalyzed} partial, ${manifest.scope.coverage.unsupported} unsupported`,
  ];
  if (command === "verify-impact") {
    return `${[
      ...header,
      `Manifest: ${manifest.manifestId}`,
      `Digest: ${manifest.integrity.semanticDigest.value}`,
      "Repository and semantic bindings verified.",
    ].join("\n")}\n`;
  }
  if (command === "contracts") {
    return `${[
      ...header,
      "",
      heading("Contract changes", useColor),
      ...linesForChanges(manifest),
      "",
      heading("Affected consumers", useColor),
      ...linesForImpacts(manifest),
      "",
      heading("Unknowns", useColor),
      ...linesForUnknowns(manifest),
    ].join("\n")}\n`;
  }
  if (command === "test-plan") {
    return `${[
      ...header,
      "",
      heading("Affected consumers", useColor),
      ...linesForImpacts(manifest),
      "",
      heading("Recommended tests and gaps", useColor),
      ...linesForTests(manifest),
      "",
      heading("Unknowns", useColor),
      ...linesForUnknowns(manifest),
    ].join("\n")}\n`;
  }
  const reasons =
    manifest.status.reasons.length === 0
      ? ["  None"]
      : manifest.status.reasons.map(
          (reason) => `  - ${reason.code}: ${reason.summary}`,
        );
  return `${[
    ...header,
    "",
    heading("Status reasons", useColor),
    ...reasons,
    "",
    heading("Contract changes", useColor),
    ...linesForChanges(manifest),
    "",
    heading("Affected consumers", useColor),
    ...linesForImpacts(manifest),
    "",
    heading("Recommended tests and gaps", useColor),
    ...linesForTests(manifest),
    "",
    heading("Unknowns", useColor),
    ...linesForUnknowns(manifest),
  ].join("\n")}\n`;
}

export function renderBenchmark(
  report: ChangeBenchReport,
  useColor: boolean,
): string {
  const metrics = report.metrics;
  const result = metrics.failed === 0 ? "PASS" : "FAIL";
  return `${[
    `ByteSmith ChangeBench ${paint(result, result === "PASS" ? "green" : "red", useColor)}`,
    `Cases: ${metrics.passed}/${metrics.cases} passed`,
    `Precision: ${(metrics.precision * 100).toFixed(2)}%`,
    `Recall: ${(metrics.recall * 100).toFixed(2)}%`,
    `Test-selection recall: ${(metrics.testSelectionRecall * 100).toFixed(2)}%`,
    `Determinism: ${(metrics.determinismRate * 100).toFixed(2)}%`,
    `Crashes: ${metrics.crashed}`,
    `Duration: ${metrics.durationMs}ms`,
  ].join("\n")}\n`;
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    schemaVersion: "1.0.0",
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}
