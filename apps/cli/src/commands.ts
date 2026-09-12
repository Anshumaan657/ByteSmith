import path from "node:path";
import {
  analyzeRepository,
  DEFAULT_CONFIG_RELATIVE_PATH,
  loadConfiguration,
  writeDefaultConfiguration,
} from "@bytesmith/analysis-engine";
import type { ImpactManifest } from "@bytesmith/impact-manifest";
import { SQLiteStore } from "@bytesmith/storage-sqlite";
import {
  assertHeadMatches,
  createRepositoryIdentity,
  discoverGitRepository,
  resolveGitRevision,
} from "@bytesmith/vcs-git";
import {
  defaultBenchmarkPaths,
  runBenchmark,
  type BenchmarkExecution,
} from "./benchmark.js";
import { runDoctor, renderDoctor, type DoctorReport } from "./doctor.js";
import { readManifest } from "./manifest-io.js";
import {
  manifestProjection,
  renderBenchmark,
  renderManifest,
} from "./reporting.js";
import { EXIT_CODES, type ParsedArguments } from "./types.js";

export interface CommandExecution {
  value: unknown;
  text: string;
  exitCode: number;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function exitForConclusion(
  conclusion: ImpactManifest["status"]["conclusion"],
): number {
  return EXIT_CODES[conclusion];
}

function configuredDatabase(
  repository: string,
  configured: string,
  override: string | undefined,
) {
  if (override) return path.resolve(override);
  return path.isAbsolute(configured)
    ? configured
    : path.join(repository, configured);
}

async function init(args: ParsedArguments): Promise<CommandExecution> {
  const repository = await discoverGitRepository(args.repository);
  const existing = await loadConfiguration(
    repository.rootPath,
    args.config
      ? path.resolve(args.config)
      : path.join(repository.rootPath, DEFAULT_CONFIG_RELATIVE_PATH),
  );
  const configuration = existing.exists
    ? existing
    : await writeDefaultConfiguration(repository.rootPath);
  const databasePath = configuredDatabase(
    repository.rootPath,
    configuration.config.cache.databasePath,
    args.database,
  );
  const database = await SQLiteStore.open(databasePath);
  const storage = database.doctor();
  database.close();
  const value = {
    schemaVersion: "1.0.0",
    repository: repository.rootPath,
    configuration: configuration.path,
    configurationCreated: !existing.exists,
    database: databasePath,
    databaseSchemaVersion: storage.schemaVersion,
  };
  return {
    value,
    text: `${existing.exists ? "Using" : "Created"} ByteSmith configuration at ${configuration.path}.\nSQLite is ready at ${databasePath}.\n`,
    exitCode: EXIT_CODES.pass,
  };
}

async function doctor(args: ParsedArguments): Promise<CommandExecution> {
  const repository = await discoverGitRepository(args.repository);
  const configuration = await loadConfiguration(
    repository.rootPath,
    args.config
      ? path.resolve(args.config)
      : path.join(repository.rootPath, DEFAULT_CONFIG_RELATIVE_PATH),
  );
  const value: DoctorReport = await runDoctor({
    repository,
    configuration,
    ...(args.database ? { databasePath: args.database } : {}),
  });
  return {
    value,
    text: renderDoctor(value, !args.noColor),
    exitCode: value.ok ? EXIT_CODES.pass : EXIT_CODES.error,
  };
}

async function analyze(args: ParsedArguments): Promise<CommandExecution> {
  const repository = await discoverGitRepository(args.repository);
  const configuration = await loadConfiguration(
    repository.rootPath,
    args.config
      ? path.resolve(args.config)
      : path.join(repository.rootPath, DEFAULT_CONFIG_RELATIVE_PATH),
  );
  const result = await analyzeRepository({
    repositoryPath: repository.rootPath,
    base: args.base!,
    head: args.head!,
    config: configuration,
    ...(args.database ? { databasePath: args.database } : {}),
    useCache: !args.noCache,
  });
  return {
    value: result.manifest,
    text: renderManifest(result.manifest, "analyze", !args.noColor),
    exitCode: exitForConclusion(result.manifest.status.conclusion),
  };
}

async function verifyRepositoryBinding(
  repositoryPath: string,
  manifest: ImpactManifest,
) {
  const repository = await discoverGitRepository(repositoryPath);
  const identity = await createRepositoryIdentity(repository);
  if (identity.id !== manifest.repository.id) {
    const error = new Error(
      "Impact Manifest belongs to a different Git repository.",
    );
    Object.assign(error, { code: "invalid_manifest" });
    throw error;
  }
  await Promise.all([
    resolveGitRevision(repository, manifest.comparison.baseRevision, "base"),
    resolveGitRevision(repository, manifest.comparison.headRevision, "head"),
  ]);
  await assertHeadMatches(repository, manifest.comparison.headRevision);
}

async function inspectManifest(
  args: ParsedArguments,
): Promise<CommandExecution> {
  const manifest = await readManifest(args.manifest!);
  if (args.command === "verify-impact") {
    await verifyRepositoryBinding(args.repository, manifest);
  }
  const value = manifestProjection(manifest, args.command);
  return {
    value,
    text: renderManifest(manifest, args.command, !args.noColor),
    exitCode: exitForConclusion(manifest.status.conclusion),
  };
}

async function benchmark(args: ParsedArguments): Promise<CommandExecution> {
  const defaults = defaultBenchmarkPaths(args.repository);
  const result: BenchmarkExecution = await runBenchmark({
    fixturesDirectory: path.resolve(
      args.fixtures ?? defaults.fixturesDirectory,
    ),
    schemaDirectory: path.resolve(args.schemas ?? defaults.schemaDirectory),
    repeat: args.repeat,
    ...(args.cases ? { cases: args.cases } : {}),
  });
  const value = {
    schemaVersion: "1.0.0",
    passed: result.passed,
    gates: result.gates,
    report: result.report,
  };
  return {
    value,
    text: renderBenchmark(result.report, !args.noColor),
    exitCode: result.passed ? EXIT_CODES.pass : EXIT_CODES.fail,
  };
}

export async function executeCommand(
  args: ParsedArguments,
): Promise<CommandExecution> {
  if (args.command === "init") return init(args);
  if (args.command === "doctor") return doctor(args);
  if (args.command === "analyze") return analyze(args);
  if (args.command === "benchmark") return benchmark(args);
  return inspectManifest(args);
}

export function serializeExecution(
  execution: CommandExecution,
  format: "text" | "json",
): string {
  return format === "json" ? json(execution.value) : execution.text;
}
