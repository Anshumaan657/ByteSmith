import { performance } from "node:perf_hooks";
import { semanticDigest } from "./canonical.js";
import { evaluateChangeBenchCase } from "./matcher.js";
import { materializeChangeBenchCase } from "./materialize.js";
import { calculateMetrics, segmentMetrics } from "./metrics.js";
import type {
  CaseRunResult,
  ChangeBenchExecutor,
  ChangeBenchReport,
  LoadedChangeBenchCase,
} from "./types.js";

export interface RunChangeBenchOptions {
  cases: LoadedChangeBenchCase[];
  executor: ChangeBenchExecutor;
  repeat?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runCase(
  loadedCase: LoadedChangeBenchCase,
  executor: ChangeBenchExecutor,
  repeat: number,
): Promise<CaseRunResult> {
  const start = performance.now();
  const materialized = await materializeChangeBenchCase(loadedCase);
  try {
    const outputs = [];
    for (let runIndex = 0; runIndex < repeat; runIndex += 1) {
      outputs.push(
        await executor({
          caseDefinition: loadedCase.definition,
          beforeDirectory: materialized.beforeDirectory,
          afterDirectory: materialized.afterDirectory,
          runIndex,
        }),
      );
    }
    const first = outputs[0];
    if (!first) throw new Error("Executor produced no output.");
    const digests = outputs.map((output) => semanticDigest(output));
    const deterministic = digests.every((digest) => digest === digests[0]);
    const evaluation = evaluateChangeBenchCase(loadedCase.definition, first);
    const conclusion = first.conclusion ?? first.status?.conclusion;
    const coverage = first.coverage ?? first.scope?.coverage;
    return {
      id: loadedCase.definition.id,
      title: loadedCase.definition.title,
      tags: loadedCase.definition.tags ?? [],
      capabilities: loadedCase.definition.capabilities,
      passed: evaluation.passed && deterministic,
      crashed: false,
      deterministic,
      semanticDigest: digests[0]!,
      durationMs: Math.round(performance.now() - start),
      ...(conclusion ? { conclusion } : {}),
      ...(coverage ? { coverage } : {}),
      evaluation,
      ...(deterministic
        ? {}
        : { error: "Executor semantic output changed across repeated runs." }),
    };
  } catch (error) {
    return {
      id: loadedCase.definition.id,
      title: loadedCase.definition.title,
      tags: loadedCase.definition.tags ?? [],
      capabilities: loadedCase.definition.capabilities,
      passed: false,
      crashed: true,
      deterministic: false,
      durationMs: Math.round(performance.now() - start),
      error: errorMessage(error),
    };
  } finally {
    await materialized.cleanup();
  }
}

export async function runChangeBench(
  options: RunChangeBenchOptions,
): Promise<ChangeBenchReport> {
  const repeat = options.repeat ?? 2;
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new RangeError("repeat must be a positive integer.");
  const orderedCases = [...options.cases].sort((left, right) =>
    left.definition.id.localeCompare(right.definition.id),
  );
  const results: CaseRunResult[] = [];
  for (const loadedCase of orderedCases)
    results.push(await runCase(loadedCase, options.executor, repeat));
  return {
    schemaVersion: "1.0.0",
    suite: { cases: results.length, repeat },
    metrics: calculateMetrics(results),
    segments: {
      byTag: segmentMetrics(results, (result) => result.tags),
      byCapability: segmentMetrics(results, (result) => result.capabilities),
    },
    cases: results,
  };
}
