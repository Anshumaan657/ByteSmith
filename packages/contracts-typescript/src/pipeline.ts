import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { canonicalJson, stableId } from "@bytesmith/canonicalization";
import { validateCanonicalIr, type CanonicalIr } from "@bytesmith/ir";
import {
  normalizeNonEmptyText,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import { TypeScriptDiscoveryError } from "./errors.js";
import {
  createContainedTypeScriptIr,
  createTypeScriptManifestProjection,
  projectTypeScriptComparisonToIr,
} from "./projection.js";
import type {
  AnalyzerFailureKind,
  CrossRevisionSymbolAnalysis,
  RunTypeScriptAnalyzerOptions,
  TypeScriptAnalyzerLimits,
  TypeScriptAnalyzerRunResult,
  TypeScriptAnalyzerSnapshot,
  TypeScriptCompilerAnalysis,
} from "./types.js";

const defaultLimits: TypeScriptAnalyzerLimits = {
  timeoutMs: 60_000,
  maxOldGenerationSizeMb: 512,
  maxProjects: 128,
  maxSourceFiles: 50_000,
  maxSymbols: 250_000,
  maxRelationships: 500_000,
  maxDiagnostics: 2_000,
};

const ignoredSnapshotDirectories = new Set([".git", "dist", "node_modules"]);

interface NormalizedAnalyzerOptions {
  repositoryId: string;
  base: { directory: string; revision: string };
  head: { directory: string; revision: string };
  analyzerVersion: string;
  limits: TypeScriptAnalyzerLimits;
  incrementalSeed?: TypeScriptAnalyzerSnapshot;
}

interface AnalyzerWorkerSuccess {
  ok: true;
  baseAnalysis: TypeScriptCompilerAnalysis;
  headAnalysis: TypeScriptCompilerAnalysis;
  symbolAnalysis: CrossRevisionSymbolAnalysis;
}

interface AnalyzerWorkerFailure {
  ok: false;
  error: { name: string; code?: string; message: string };
}

type AnalyzerWorkerMessage = AnalyzerWorkerSuccess | AnalyzerWorkerFailure;

type WorkerOutcome =
  | { kind: "success"; value: AnalyzerWorkerSuccess }
  | {
      kind: "failure";
      failureKind: Exclude<AnalyzerFailureKind, "limit_exceeded">;
      summary: string;
    };

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000);
}

function normalizeLimit(
  value: number,
  name: keyof TypeScriptAnalyzerLimits,
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeScriptDiscoveryError(
      "analyzer_options_invalid",
      `${name} must be a positive safe integer.`,
    );
  }
  if (name === "maxOldGenerationSizeMb" && value < 16) {
    throw new TypeScriptDiscoveryError(
      "analyzer_options_invalid",
      "maxOldGenerationSizeMb must be at least 16.",
    );
  }
  return value;
}

function normalizeOptions(
  options: RunTypeScriptAnalyzerOptions,
): NormalizedAnalyzerOptions {
  try {
    if (
      !isAbsolute(options.base.directory) ||
      !isAbsolute(options.head.directory)
    ) {
      throw new TypeScriptDiscoveryError(
        "analyzer_options_invalid",
        "Analyzer snapshot directories must be absolute paths.",
      );
    }
    const limits = { ...defaultLimits, ...options.limits };
    return {
      repositoryId: validateStableId(options.repositoryId, "Repository ID"),
      base: {
        directory: resolve(options.base.directory),
        revision: validateExactGitRevision(
          options.base.revision,
          "Base revision",
        ),
      },
      head: {
        directory: resolve(options.head.directory),
        revision: validateExactGitRevision(
          options.head.revision,
          "Head revision",
        ),
      },
      analyzerVersion: normalizeNonEmptyText(
        options.analyzerVersion ?? "0.1.0",
        "Analyzer version",
      ),
      limits: {
        timeoutMs: normalizeLimit(limits.timeoutMs, "timeoutMs"),
        maxOldGenerationSizeMb: normalizeLimit(
          limits.maxOldGenerationSizeMb,
          "maxOldGenerationSizeMb",
        ),
        maxProjects: normalizeLimit(limits.maxProjects, "maxProjects"),
        maxSourceFiles: normalizeLimit(limits.maxSourceFiles, "maxSourceFiles"),
        maxSymbols: normalizeLimit(limits.maxSymbols, "maxSymbols"),
        maxRelationships: normalizeLimit(
          limits.maxRelationships,
          "maxRelationships",
        ),
        maxDiagnostics: normalizeLimit(limits.maxDiagnostics, "maxDiagnostics"),
      },
      ...(options.incrementalSeed
        ? { incrementalSeed: options.incrementalSeed }
        : {}),
    };
  } catch (cause) {
    if (cause instanceof TypeScriptDiscoveryError) throw cause;
    throw new TypeScriptDiscoveryError(
      "analyzer_options_invalid",
      "TypeScript analyzer options are invalid.",
      cause,
    );
  }
}

async function addFileToHash(
  hash: ReturnType<typeof createHash>,
  absolutePath: string,
): Promise<void> {
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk as Buffer);
  }
}

async function digestSnapshot(directory: string): Promise<string> {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeScriptDiscoveryError(
      "repository_path_invalid",
      "Analyzer snapshot root must be a real directory.",
    );
  }
  const hash = createHash("sha256");
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredSnapshotDirectories.has(entry.name)) {
        continue;
      }
      const absolutePath = resolve(current, entry.name);
      const repositoryPath = relative(root, absolutePath).split(sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`directory\0${repositoryPath}\0`);
        await visit(absolutePath);
      } else if (entry.isFile()) {
        hash.update(`file\0${repositoryPath}\0`);
        await addFileToHash(hash, absolutePath);
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(
          `symlink\0${repositoryPath}\0${await readlink(absolutePath)}\0`,
        );
      } else {
        throw new TypeScriptDiscoveryError(
          "repository_path_invalid",
          "Analyzer snapshot contains an unsupported filesystem entry.",
        );
      }
    }
  };
  await visit(root);
  return hash.digest("hex");
}

function semanticDigest(ir: CanonicalIr): {
  algorithm: "sha256";
  value: string;
} {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonicalJson(ir)).digest("hex"),
  };
}

function sanitizeWorkerMessage(
  message: string,
  options: NormalizedAnalyzerOptions,
): string {
  return message
    .replaceAll(options.base.directory, "[base-snapshot]")
    .replaceAll(options.head.directory, "[head-snapshot]")
    .replaceAll("\\", "/");
}

async function executeWorker(
  options: NormalizedAnalyzerOptions,
): Promise<WorkerOutcome> {
  return new Promise((resolveOutcome) => {
    let settled = false;
    const worker = new Worker(
      new URL("./analyzer-worker.js", import.meta.url),
      {
        // Flags such as `--input-type=module` are valid for the parent process
        // when it evaluates stdin, but Node rejects them for a file-backed
        // worker. Keep ordinary runtime flags while dropping eval-only flags.
        execArgv: process.execArgv.filter(
          (argument) =>
            argument !== "--input-type" &&
            !argument.startsWith("--input-type="),
        ),
        workerData: {
          repositoryId: options.repositoryId,
          base: options.base,
          head: options.head,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: options.limits.maxOldGenerationSizeMb,
        },
      },
    );
    const finish = (outcome: WorkerOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutcome(outcome);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish({
        kind: "failure",
        failureKind: "timeout",
        summary: `TypeScript analyzer exceeded its ${options.limits.timeoutMs}ms time limit.`,
      });
    }, options.limits.timeoutMs);
    timer.unref();
    worker.once("message", (message: AnalyzerWorkerMessage) => {
      if (message.ok) {
        finish({ kind: "success", value: message });
        return;
      }
      const invalidCodes = new Set([
        "repository_unreadable",
        "repository_path_invalid",
        "repository_identity_invalid",
        "revision_invalid",
        "discovery_identity_mismatch",
        "analysis_comparison_invalid",
      ]);
      finish({
        kind: "failure",
        failureKind:
          message.error.code && invalidCodes.has(message.error.code)
            ? "invalid_input"
            : "worker_crash",
        summary: sanitizeWorkerMessage(
          `TypeScript analyzer worker failed (${message.error.code ?? message.error.name}): ${message.error.message}`,
          options,
        ),
      });
    });
    worker.once("error", (error) => {
      finish({
        kind: "failure",
        failureKind: "worker_crash",
        summary: sanitizeWorkerMessage(
          `TypeScript analyzer worker crashed: ${error.message}`,
          options,
        ),
      });
    });
    worker.once("exit", (code) => {
      finish({
        kind: "failure",
        failureKind: "worker_crash",
        summary:
          code === 0
            ? "TypeScript analyzer worker exited without a result."
            : `TypeScript analyzer worker exited with code ${code}.`,
      });
    });
  });
}

function configurationId(
  options: NormalizedAnalyzerOptions,
  baseSnapshotDigest: string,
  headSnapshotDigest: string,
): string {
  return stableId("typescript-analyzer-configuration", {
    repositoryId: options.repositoryId,
    baseRevision: options.base.revision,
    headRevision: options.head.revision,
    baseSnapshotDigest,
    headSnapshotDigest,
    analyzerVersion: options.analyzerVersion,
    limits: options.limits,
  });
}

function analysisDiagnostics(
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): string[] {
  return [
    ...new Set([
      ...base.diagnostics.map((diagnostic) => `base: ${diagnostic.summary}`),
      ...head.diagnostics.map((diagnostic) => `head: ${diagnostic.summary}`),
    ]),
  ].sort();
}

function exceededLimit(
  options: NormalizedAnalyzerOptions,
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): string | undefined {
  const counts: Array<[keyof TypeScriptAnalyzerLimits, number]> = [
    ["maxProjects", base.projects.length + head.projects.length],
    [
      "maxSourceFiles",
      base.projects.reduce(
        (sum, project) => sum + project.sourceFiles.length,
        0,
      ) +
        head.projects.reduce(
          (sum, project) => sum + project.sourceFiles.length,
          0,
        ),
    ],
    ["maxSymbols", base.symbols.length + head.symbols.length],
    ["maxRelationships", base.relationships.length + head.relationships.length],
    ["maxDiagnostics", base.diagnostics.length + head.diagnostics.length],
  ];
  for (const [name, count] of counts) {
    const limit = options.limits[name];
    if (count > limit) {
      return `TypeScript analyzer limit exceeded: ${name} observed ${count}, limit ${limit}.`;
    }
  }
  return undefined;
}

function containedResult(
  options: NormalizedAnalyzerOptions,
  startedAt: number,
  failureKind: AnalyzerFailureKind,
  summary: string,
): TypeScriptAnalyzerRunResult {
  const durationMs = elapsed(startedAt);
  const ir = createContainedTypeScriptIr(
    {
      repositoryId: options.repositoryId,
      baseRevision: options.base.revision,
      headRevision: options.head.revision,
      analyzerVersion: options.analyzerVersion,
    },
    failureKind,
    summary,
  );
  const status = failureKind === "limit_exceeded" ? "incomplete" : "error";
  return {
    schemaVersion: "1.0.0",
    execution: "clean",
    status,
    durationMs,
    ir,
    semanticDigest: semanticDigest(ir),
    canonicalIr: canonicalJson(ir),
    manifestProjection: createTypeScriptManifestProjection(
      ir,
      options.analyzerVersion,
      status,
      durationMs,
      [summary],
    ),
    diagnostics: [summary],
    failureKind,
  };
}

function canReuseSnapshot(
  seed: TypeScriptAnalyzerSnapshot,
  expectedConfigurationId: string,
  options: NormalizedAnalyzerOptions,
  baseSnapshotDigest: string,
  headSnapshotDigest: string,
): boolean {
  try {
    validateCanonicalIr(seed.ir);
    const digest = semanticDigest(seed.ir);
    return (
      seed.schemaVersion === "1.0.0" &&
      seed.configurationId === expectedConfigurationId &&
      seed.repositoryId === options.repositoryId &&
      seed.baseRevision === options.base.revision &&
      seed.headRevision === options.head.revision &&
      seed.baseSnapshotDigest === baseSnapshotDigest &&
      seed.headSnapshotDigest === headSnapshotDigest &&
      seed.analyzerVersion === options.analyzerVersion &&
      seed.baseAnalysis.repositoryId === options.repositoryId &&
      seed.baseAnalysis.revision === options.base.revision &&
      seed.headAnalysis.repositoryId === options.repositoryId &&
      seed.headAnalysis.revision === options.head.revision &&
      seed.symbolAnalysis.repositoryId === options.repositoryId &&
      seed.symbolAnalysis.baseRevision === options.base.revision &&
      seed.symbolAnalysis.headRevision === options.head.revision &&
      seed.semanticDigest.algorithm === "sha256" &&
      seed.semanticDigest.value === digest.value
    );
  } catch {
    return false;
  }
}

function completedResult(
  options: NormalizedAnalyzerOptions,
  startedAt: number,
  configuration: string,
  baseSnapshotDigest: string,
  headSnapshotDigest: string,
  baseAnalysis: TypeScriptCompilerAnalysis,
  headAnalysis: TypeScriptCompilerAnalysis,
  symbolAnalysis: CrossRevisionSymbolAnalysis,
  ir: CanonicalIr,
  execution: "clean" | "incremental",
  extraDiagnostics: readonly string[] = [],
): TypeScriptAnalyzerRunResult {
  const durationMs = elapsed(startedAt);
  const status =
    baseAnalysis.status === "completed" &&
    headAnalysis.status === "completed" &&
    !ir.gaps.some((gap) => gap.blockingRelevance === "required")
      ? "completed"
      : "incomplete";
  const diagnostics = [
    ...analysisDiagnostics(baseAnalysis, headAnalysis),
    ...extraDiagnostics,
  ];
  const digest = semanticDigest(ir);
  const snapshot: TypeScriptAnalyzerSnapshot = {
    schemaVersion: "1.0.0",
    configurationId: configuration,
    repositoryId: options.repositoryId,
    baseRevision: options.base.revision,
    headRevision: options.head.revision,
    baseSnapshotDigest,
    headSnapshotDigest,
    analyzerVersion: options.analyzerVersion,
    baseAnalysis: structuredClone(baseAnalysis),
    headAnalysis: structuredClone(headAnalysis),
    symbolAnalysis: structuredClone(symbolAnalysis),
    ir: structuredClone(ir),
    semanticDigest: digest,
  };
  return {
    schemaVersion: "1.0.0",
    execution,
    status,
    durationMs,
    ir,
    semanticDigest: digest,
    canonicalIr: canonicalJson(ir),
    manifestProjection: createTypeScriptManifestProjection(
      ir,
      options.analyzerVersion,
      status,
      durationMs,
      diagnostics,
    ),
    diagnostics,
    snapshot,
  };
}

export async function runTypeScriptAnalyzerComparison(
  input: RunTypeScriptAnalyzerOptions,
): Promise<TypeScriptAnalyzerRunResult> {
  const startedAt = performance.now();
  const options = normalizeOptions(input);
  let initialBaseDigest: string;
  let initialHeadDigest: string;
  try {
    [initialBaseDigest, initialHeadDigest] = await Promise.all([
      digestSnapshot(options.base.directory),
      digestSnapshot(options.head.directory),
    ]);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Snapshot is unreadable.";
    return containedResult(
      options,
      startedAt,
      "invalid_input",
      sanitizeWorkerMessage(
        `TypeScript analyzer input is invalid: ${message}`,
        options,
      ),
    );
  }
  const configuration = configurationId(
    options,
    initialBaseDigest,
    initialHeadDigest,
  );
  if (
    options.incrementalSeed &&
    canReuseSnapshot(
      options.incrementalSeed,
      configuration,
      options,
      initialBaseDigest,
      initialHeadDigest,
    )
  ) {
    const seed = options.incrementalSeed;
    return completedResult(
      options,
      startedAt,
      configuration,
      initialBaseDigest,
      initialHeadDigest,
      seed.baseAnalysis,
      seed.headAnalysis,
      seed.symbolAnalysis,
      structuredClone(seed.ir),
      "incremental",
    );
  }
  const rejectedSeedDiagnostic = options.incrementalSeed
    ? ["Incremental seed was rejected; a clean analysis was executed."]
    : [];
  const workerOutcome = await executeWorker(options);
  if (workerOutcome.kind === "failure") {
    return containedResult(
      options,
      startedAt,
      workerOutcome.failureKind,
      workerOutcome.summary,
    );
  }
  const limitFailure = exceededLimit(
    options,
    workerOutcome.value.baseAnalysis,
    workerOutcome.value.headAnalysis,
  );
  if (limitFailure) {
    return containedResult(options, startedAt, "limit_exceeded", limitFailure);
  }
  let finalBaseDigest: string;
  let finalHeadDigest: string;
  try {
    [finalBaseDigest, finalHeadDigest] = await Promise.all([
      digestSnapshot(options.base.directory),
      digestSnapshot(options.head.directory),
    ]);
  } catch {
    return containedResult(
      options,
      startedAt,
      "invalid_input",
      "TypeScript analyzer snapshot became unreadable during analysis.",
    );
  }
  if (
    finalBaseDigest !== initialBaseDigest ||
    finalHeadDigest !== initialHeadDigest
  ) {
    return containedResult(
      options,
      startedAt,
      "invalid_input",
      "TypeScript analyzer snapshot changed during analysis.",
    );
  }
  try {
    const ir = projectTypeScriptComparisonToIr(
      {
        repositoryId: options.repositoryId,
        baseRevision: options.base.revision,
        headRevision: options.head.revision,
        analyzerVersion: options.analyzerVersion,
      },
      workerOutcome.value.baseAnalysis,
      workerOutcome.value.headAnalysis,
    );
    validateCanonicalIr(ir);
    return completedResult(
      options,
      startedAt,
      configuration,
      initialBaseDigest,
      initialHeadDigest,
      workerOutcome.value.baseAnalysis,
      workerOutcome.value.headAnalysis,
      workerOutcome.value.symbolAnalysis,
      ir,
      "clean",
      rejectedSeedDiagnostic,
    );
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "IR projection failed.";
    return containedResult(
      options,
      startedAt,
      "worker_crash",
      sanitizeWorkerMessage(
        `TypeScript analyzer could not produce canonical IR: ${message}`,
        options,
      ),
    );
  }
}
