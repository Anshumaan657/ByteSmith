import fs from "node:fs/promises";
import path from "node:path";
import { canonicalizeSemanticOutput } from "./canonical.js";
import type { ChangeBenchReport } from "./types.js";

export async function writeChangeBenchReport(
  filePath: string,
  report: ChangeBenchReport,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function withoutRuntimeMeasurements(report: ChangeBenchReport): unknown {
  return {
    ...report,
    metrics: { ...report.metrics, durationMs: 0, peakMemoryBytes: 0 },
    segments: {
      byTag: Object.fromEntries(
        Object.entries(report.segments.byTag).map(([key, metrics]) => [
          key,
          { ...metrics, durationMs: 0, peakMemoryBytes: 0 },
        ]),
      ),
      byCapability: Object.fromEntries(
        Object.entries(report.segments.byCapability).map(([key, metrics]) => [
          key,
          { ...metrics, durationMs: 0, peakMemoryBytes: 0 },
        ]),
      ),
    },
    cases: report.cases.map((result) => ({
      ...result,
      durationMs: 0,
      peakMemoryBytes: 0,
    })),
  };
}

export async function readChangeBenchReport(
  filePath: string,
): Promise<ChangeBenchReport> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as ChangeBenchReport;
}

export function compareChangeBenchBaseline(
  baseline: ChangeBenchReport,
  current: ChangeBenchReport,
): { matched: boolean; message?: string } {
  const baselineSemantic = canonicalizeSemanticOutput(
    withoutRuntimeMeasurements(baseline),
  );
  const currentSemantic = canonicalizeSemanticOutput(
    withoutRuntimeMeasurements(current),
  );
  if (baselineSemantic === currentSemantic) return { matched: true };
  return {
    matched: false,
    message: "Current ChangeBench semantics differ from the stored baseline.",
  };
}
